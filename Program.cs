using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;
using OfficeBuffet.Endpoints;
using OfficeBuffet.Services;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // As a Windows service the working directory is System32; keep paths relative to the app folder.
    ContentRootPath = Microsoft.Extensions.Hosting.WindowsServices.WindowsServiceHelpers.IsWindowsService() ? AppContext.BaseDirectory : null,
});
builder.Host.UseWindowsService(); // no-op unless started by the Windows Service Control Manager
// HTTPS certificate made by tools/new-certificate.ps1; used automatically when the certs folder is present.
builder.Configuration.AddJsonFile(Path.Combine(builder.Environment.ContentRootPath, "certs", "kestrel.json"), optional: true);

// The largest request is an Excel import (5 MB); receipts are 3 MB. Anything bigger is refused before it is read.
const long MaxRequestBytes = 6 * 1024 * 1024;
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = MaxRequestBytes;
    o.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
});
builder.Services.Configure<IISServerOptions>(o => o.MaxRequestBodySize = MaxRequestBytes);
builder.Services.Configure<FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = ReceiptStore.MaxBytes + 64 * 1024;
    o.ValueCountLimit = 20;
    o.ValueLengthLimit = 4 * 1024;
});
// Optional: "Security": { "RequireHttps": true } once the HTTPS certificate works on every phone.
var requireHttps = builder.Configuration.GetValue<bool>("Security:RequireHttps");

var dbPath = builder.Configuration["DbPath"] ?? DefaultDbPath(Path.Combine(builder.Environment.ContentRootPath, "App_Data"));
Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={dbPath}"));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "officebite.auth"; // name from before the OfficeBuffet rename; changing it would log everyone out
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // "Secure" whenever the app is opened over HTTPS
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
        // This is an API: answer with status codes instead of redirecting to a login page.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
        o.Events.OnValidatePrincipal = AuthEndpoints.ValidatePrincipal;
    });
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy(Roles.Admin, p => p.RequireRole(Roles.Admin));
    o.AddPolicy(Roles.Employee, p => p.RequireRole(Roles.Employee));
});

// Cookies are encrypted with these keys; keeping them next to the database means a restart,
// redeploy or IIS app-pool recycle never logs anyone out.
var dataProtection = builder.Services.AddDataProtection()
    .SetApplicationName("OfficeBite") // kept from before the OfficeBuffet rename; a new name would invalidate every login
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(dbPath))!, "keys")));
// New keys are encrypted for this Windows machine, so a copied App_Data folder (e.g. a backup) can't be used to
// forge a manager login. Moving App_Data to another server then only means everyone logs in once more.
if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi(protectToLocalMachine: true);

// Push notifications to the admin's phone; its VAPID keys also live next to the database.
builder.Services.AddSingleton(sp => new WebPush(
    Path.Combine(Path.GetDirectoryName(Path.GetFullPath(dbPath))!, "vapid.json"),
    builder.Configuration["Push:Subject"] ?? "mailto:officebuffet@example.com",
    sp.GetRequiredService<IServiceScopeFactory>(), sp.GetRequiredService<ILogger<WebPush>>()));

builder.Services.AddSingleton<LoginGuard>(); // failed-login counters (see AuthEndpoints)
// Receipt photos for payments employees report; files next to the database, not inside it.
builder.Services.AddSingleton(new ReceiptStore(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(dbPath))!, "receipts")));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(5) }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    BaselineLegacyDatabase(db);
    db.Database.Migrate();
}

var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".webmanifest"] = "application/manifest+json";

app.UseSecurityHeaders(hsts: requireHttps);
if (requireHttps) app.UseHttpsRedirection();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    // Always revalidate so a new deploy reaches users; the service worker handles offline caching.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});
app.UseCsrfProtection();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuth();
app.MapReports();
app.MapAdmin();
app.MapRequests();
app.MapImport();
app.MapMenu();
app.MapBalances();
app.MapPaymentClaims();
// "/" and app routes are served here; revalidate them like the other static files so a new deploy shows at once.
app.MapFallbackToFile("index.html", new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

app.Run();

// Installs from before the OfficeBuffet rename keep using their officebite.db, so an update never starts with an empty database.
static string DefaultDbPath(string dataDir)
{
    var legacy = Path.Combine(dataDir, "officebite.db");
    var current = Path.Combine(dataDir, "officebuffet.db");
    return File.Exists(legacy) && !File.Exists(current) ? legacy : current;
}

// Databases made by the first version (EnsureCreated) have the tables but no migration history.
// Mark the initial migration as applied so Migrate() only adds what came later.
static void BaselineLegacyDatabase(AppDb db)
{
    var conn = db.Database.GetDbConnection();
    conn.Open();
    try
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'People'),
                   (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '__EFMigrationsHistory')
            """;
        using (var r = cmd.ExecuteReader())
        {
            r.Read();
            if (r.GetInt64(0) == 0 || r.GetInt64(1) == 1) return;
        }
        var initial = db.Database.GetMigrations().First();
        var version = typeof(DbContext).Assembly.GetName().Version!.ToString(3);
        cmd.CommandText = $"""
            CREATE TABLE "__EFMigrationsHistory" ("MigrationId" TEXT NOT NULL CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY, "ProductVersion" TEXT NOT NULL);
            INSERT INTO "__EFMigrationsHistory" VALUES ('{initial}', '{version}');
            """;
        cmd.ExecuteNonQuery();
    }
    finally
    {
        conn.Close();
    }
}
