using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;
using OfficeBuffet.Services;

namespace OfficeBuffet.Endpoints;

public static class Roles
{
    public const string Admin = "admin";
    public const string Employee = "employee";
}

public static class AuthEndpoints
{
    public const int MinPasswordLength = 8;
    private const string NationalCodeClaim = "national_code";
    private const string StampClaim = "stamp";

    // Failed-login limits (in addition to the "login" rate limit of 20 requests / 5 min per IP).
    private const int AdminFailuresPerUser = 5, AdminFailuresPerIp = 20, EmployeeFailuresPerIp = 10;
    private static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan AdminLock = TimeSpan.FromMinutes(15), EmployeeLock = TimeSpan.FromMinutes(30);
    private static readonly SemaphoreSlim SetupLock = new(1, 1);

    /// <summary>
    /// Everyone stays logged in for good: browsers cap cookies at ~400 days, and the cookie is
    /// re-issued at least weekly while the app is used (see <see cref="ValidatePrincipal"/>).
    /// </summary>
    private static readonly TimeSpan PersistentSession = TimeSpan.FromDays(400);
    private static readonly TimeSpan RenewEvery = TimeSpan.FromDays(7);

    /// <summary>The &lt;Version&gt; from the project file, e.g. "1.0.0" (without the "+commit" build suffix).</summary>
    public static readonly string AppVersion =
        (typeof(AuthEndpoints).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0")
        .Split('+')[0];

    public static void MapAuth(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/auth");

        g.MapGet("/me", async (HttpContext ctx, AppDb db) =>
        {
            var role = ctx.User.FindFirstValue(ClaimTypes.Role);
            return new
            {
                loggedIn = role != null,
                role,
                username = role == Roles.Admin ? ctx.User.Identity!.Name : null,
                personId = role == Roles.Employee ? EmployeePersonId(ctx.User) : null,
                personName = role == Roles.Employee ? ctx.User.Identity!.Name : null,
                needsSetup = !await db.AdminUsers.AnyAsync(),
                version = AppVersion,
            };
        });

        // First run only: creates the first admin account when none exists.
        g.MapPost("/setup", async (LoginRequest req, HttpContext ctx, AppDb db) =>
        {
            var error = ValidateCredentials(req.Username, req.Password);
            if (error != null) return ApiErrors.Bad(error);
            // One at a time, so two people opening a fresh install at once can't both become the first manager.
            await SetupLock.WaitAsync();
            try
            {
                if (await db.AdminUsers.AnyAsync()) return ApiErrors.Conflict("حساب مسئول قبلاً ساخته شده است.");
                var user = new AdminUser { Username = req.Username.Trim(), PasswordHash = Passwords.Hash(req.Password), SecurityStamp = Passwords.NewStamp() };
                db.AdminUsers.Add(user);
                Audit.Add(db, ctx, "admin.setup", $"اولین حساب مسئول: {user.Username}", user.Username);
                await db.SaveChangesAsync();
                await SignInAdmin(ctx, user);
                return Results.Ok(new { username = user.Username });
            }
            finally { SetupLock.Release(); }
        }).RequireRateLimiting("login");

        g.MapPost("/login", async (LoginRequest req, HttpContext ctx, AppDb db, LoginGuard guard) =>
        {
            var username = (req.Username ?? "").Trim();
            var password = req.Password ?? "";
            var userKey = "admin:" + username.ToLowerInvariant();
            var ipKey = "admin-ip:" + ClientIp(ctx);
            if (Math.Max(guard.LockedFor(userKey), guard.LockedFor(ipKey)) is var wait and > 0)
                return Locked(wait);

            var user = username.Length is > 0 and <= 100 ? await db.AdminUsers.FirstOrDefaultAsync(u => u.Username == username) : null;
            if (user == null) Passwords.VerifyDummy(password);
            if (user == null || !Passwords.Verify(password, user.PasswordHash))
            {
                guard.Fail(userKey, AdminFailuresPerUser, FailureWindow, AdminLock);
                guard.Fail(ipKey, AdminFailuresPerIp, FailureWindow, AdminLock);
                await Audit.Write(db, ctx, "admin.login_failed", $"نام کاربری: {Clip(username, 60)}");
                return Results.Json(new { error = "نام کاربری یا رمز عبور اشتباه است." }, statusCode: 401);
            }
            guard.Succeed(userKey);
            // Hashes made with fewer iterations are upgraded now that the password is at hand.
            if (Passwords.NeedsRehash(user.PasswordHash)) user.PasswordHash = Passwords.Hash(password);
            Audit.Add(db, ctx, "admin.login", UserAgent(ctx), user.Username);
            await db.SaveChangesAsync();
            await SignInAdmin(ctx, user);
            return Results.Ok(new { username = user.Username });
        }).RequireRateLimiting("login");

        // Employees log in with their national code only (by design: no password). Trying codes one after
        // another locks that IP for a while, and every login is in the manager's security log.
        g.MapPost("/employee-login", async (EmployeeLoginRequest req, HttpContext ctx, AppDb db, LoginGuard guard) =>
        {
            var ipKey = "employee-ip:" + ClientIp(ctx);
            if (guard.LockedFor(ipKey) is var wait and > 0) return Locked(wait);
            var code = NationalCode.Normalize(req.NationalCode);
            var person = code.Length == 10 ? await db.People.FirstOrDefaultAsync(p => p.NationalCode == code && p.IsActive) : null;
            if (person == null)
            {
                guard.Fail(ipKey, EmployeeFailuresPerIp, FailureWindow, EmployeeLock);
                await Audit.Write(db, ctx, "employee.login_failed", $"کد ملی: {Audit.MaskCode(Clip(code, 10))}");
                return Results.Json(new { error = "این کد ملی ثبت نشده است. اگر درست وارد کرده‌اید به مسئول بوفه اطلاع دهید." }, statusCode: 401);
            }
            await Audit.Write(db, ctx, "employee.login", UserAgent(ctx), person.Name);
            await SignInEmployee(ctx, person);
            return Results.Ok(new { personId = person.Id, personName = person.Name });
        }).RequireRateLimiting("login");

        g.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok();
        });

        g.MapPost("/password", async (ChangePasswordRequest req, HttpContext ctx, AppDb db) =>
        {
            var user = await db.AdminUsers.FirstOrDefaultAsync(u => u.Username == ctx.User.Identity!.Name);
            if (user == null) return Results.Unauthorized();
            if (!Passwords.Verify(req.Current ?? "", user.PasswordHash))
            {
                await Audit.Write(db, ctx, "admin.password_failed", "رمز فعلی اشتباه وارد شد");
                return ApiErrors.Bad("رمز فعلی اشتباه است.");
            }
            if (PasswordError(req.New) is { } error) return ApiErrors.Bad(error);
            user.PasswordHash = Passwords.Hash(req.New!);
            // Every other device logged in to this account is signed out; this one gets a fresh cookie.
            user.SecurityStamp = Passwords.NewStamp();
            Audit.Add(db, ctx, "admin.password", "رمز عوض شد؛ نشست‌های دیگر این حساب بسته شدند");
            await db.SaveChangesAsync();
            await SignInAdmin(ctx, user);
            return Results.Ok();
        }).RequireAuthorization(Roles.Admin).RequireRateLimiting("login");
    }

    /// <summary>The logged-in employee's person id, or null for admins.</summary>
    public static int? EmployeePersonId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Role) == Roles.Employee && int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? id : null;

    /// <summary>
    /// Runs on every request: a session only stays valid while its admin account exists, or while the
    /// employee is active and still has the same national code. Also keeps cookies fresh.
    /// </summary>
    public static async Task ValidatePrincipal(CookieValidatePrincipalContext ctx)
    {
        var user = ctx.Principal;
        var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
        var id = int.TryParse(user?.FindFirstValue(ClaimTypes.NameIdentifier), out var v) ? v : 0;
        var role = user?.FindFirstValue(ClaimTypes.Role);
        var valid = role switch
        {
            Roles.Admin => await IsAdmin(db, id, user!.Identity?.Name, user.FindFirstValue(StampClaim) ?? ""),
            Roles.Employee => await IsEmployee(db, id, user!.FindFirstValue(NationalCodeClaim)),
            _ => false,
        };
        if (!valid)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }
        if (ctx.Properties.IssuedUtc < DateTimeOffset.UtcNow - RenewEvery)
            ctx.ShouldRenew = true;
    }

    // Logins from before the stamp existed carry none, which matches the empty stamp of accounts not changed since.
    private static Task<bool> IsAdmin(AppDb db, int id, string? username, string stamp) =>
        db.AdminUsers.AnyAsync(u => u.Id == id && u.Username == username && u.SecurityStamp == stamp);

    private static Task<bool> IsEmployee(AppDb db, int id, string? code) =>
        db.People.AnyAsync(p => p.Id == id && p.IsActive && p.NationalCode == code);

    public static string? ValidateCredentials(string? username, string? password)
    {
        if (string.IsNullOrWhiteSpace(username) || username.Trim().Length < 3) return "نام کاربری باید حداقل ۳ کاراکتر باشد.";
        if (username.Trim().Length > 50) return "نام کاربری حداکثر ۵۰ کاراکتر است.";
        return PasswordError(password);
    }

    public static string? PasswordError(string? password)
    {
        if ((password ?? "").Length < MinPasswordLength) return $"رمز عبور باید حداقل {MinPasswordLength} کاراکتر باشد.";
        if (password!.Length > Passwords.MaxLength) return $"رمز عبور حداکثر {Passwords.MaxLength} کاراکتر است.";
        return null;
    }

    private static IResult Locked(int seconds) => Results.Json(new
    {
        error = $"به‌خاطر چند تلاش ناموفق، ورود موقتاً بسته شد؛ {FaDigits(Math.Max(1, (int)Math.Ceiling(seconds / 60.0)).ToString())} دقیقه‌ی دیگر دوباره امتحان کنید.",
    }, statusCode: StatusCodes.Status429TooManyRequests);

    public static string ClientIp(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static string UserAgent(HttpContext ctx) => Clip(ctx.Request.Headers.UserAgent.ToString(), 200);

    private static string Clip(string s, int max) => s.Length > max ? s[..max] : s;

    private static string FaDigits(string s) => string.Concat(s.Select(c => c is >= '0' and <= '9' ? (char)('۰' + (c - '0')) : c));

    private static Task SignInAdmin(HttpContext ctx, AdminUser user) =>
        SignIn(ctx, [
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Role, Roles.Admin),
            new Claim(StampClaim, user.SecurityStamp),
        ], new AuthenticationProperties { IsPersistent = true, ExpiresUtc = DateTimeOffset.UtcNow.Add(PersistentSession) });

    private static Task SignInEmployee(HttpContext ctx, Person person) =>
        SignIn(ctx, [
            new Claim(ClaimTypes.Name, person.Name),
            new Claim(ClaimTypes.NameIdentifier, person.Id.ToString()),
            new Claim(ClaimTypes.Role, Roles.Employee),
            new Claim(NationalCodeClaim, person.NationalCode!),
        ], new AuthenticationProperties { IsPersistent = true, ExpiresUtc = DateTimeOffset.UtcNow.Add(PersistentSession) });

    private static Task SignIn(HttpContext ctx, Claim[] claims, AuthenticationProperties props) =>
        ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)), props);
}
