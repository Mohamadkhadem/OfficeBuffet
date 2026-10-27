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
    public const int MinPasswordLength = 6;
    private const string NationalCodeClaim = "national_code";

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
            if (await db.AdminUsers.AnyAsync()) return ApiErrors.Conflict("حساب مسئول قبلاً ساخته شده است.");
            var error = ValidateCredentials(req.Username, req.Password);
            if (error != null) return ApiErrors.Bad(error);

            var user = new AdminUser { Username = req.Username.Trim(), PasswordHash = Passwords.Hash(req.Password) };
            db.AdminUsers.Add(user);
            await db.SaveChangesAsync();
            await SignInAdmin(ctx, user);
            return Results.Ok(new { username = user.Username });
        }).RequireRateLimiting("login");

        g.MapPost("/login", async (LoginRequest req, HttpContext ctx, AppDb db) =>
        {
            var username = (req.Username ?? "").Trim();
            var user = await db.AdminUsers.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null || !Passwords.Verify(req.Password ?? "", user.PasswordHash))
                return Results.Json(new { error = "نام کاربری یا رمز عبور اشتباه است." }, statusCode: 401);
            await SignInAdmin(ctx, user);
            return Results.Ok(new { username = user.Username });
        }).RequireRateLimiting("login");

        // Employees log in with their national code only (by design: no password).
        g.MapPost("/employee-login", async (EmployeeLoginRequest req, HttpContext ctx, AppDb db) =>
        {
            var code = NationalCode.Normalize(req.NationalCode);
            var person = code.Length == 10 ? await db.People.FirstOrDefaultAsync(p => p.NationalCode == code && p.IsActive) : null;
            if (person == null)
                return Results.Json(new { error = "این کد ملی ثبت نشده است. اگر درست وارد کرده‌اید به مسئول بوفه اطلاع دهید." }, statusCode: 401);
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
            if (!Passwords.Verify(req.Current ?? "", user.PasswordHash)) return ApiErrors.Bad("رمز فعلی اشتباه است.");
            if ((req.New ?? "").Length < MinPasswordLength) return ApiErrors.Bad($"رمز جدید باید حداقل {MinPasswordLength} کاراکتر باشد.");
            user.PasswordHash = Passwords.Hash(req.New!);
            await db.SaveChangesAsync();
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
            Roles.Admin => await IsAdmin(db, id, user!.Identity?.Name),
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

    private static Task<bool> IsAdmin(AppDb db, int id, string? username) =>
        db.AdminUsers.AnyAsync(u => u.Id == id && u.Username == username);

    private static Task<bool> IsEmployee(AppDb db, int id, string? code) =>
        db.People.AnyAsync(p => p.Id == id && p.IsActive && p.NationalCode == code);

    public static string? ValidateCredentials(string? username, string? password)
    {
        if (string.IsNullOrWhiteSpace(username) || username.Trim().Length < 3) return "نام کاربری باید حداقل ۳ کاراکتر باشد.";
        if ((password ?? "").Length < MinPasswordLength) return $"رمز عبور باید حداقل {MinPasswordLength} کاراکتر باشد.";
        return null;
    }

    private static Task SignInAdmin(HttpContext ctx, AdminUser user) =>
        SignIn(ctx, [
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Role, Roles.Admin),
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
