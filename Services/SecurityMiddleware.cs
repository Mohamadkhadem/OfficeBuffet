namespace OfficeBuffet.Services;

/// <summary>Response security headers and cross-site request forgery protection for the API.</summary>
public static class SecurityMiddleware
{
    /// <summary>Header the app's own fetch() sends on every API call. A form or image on another site can't add it,
    /// and a cross-origin script that tries needs a CORS preflight, which this server never allows.</summary>
    public const string CsrfHeader = "X-Buffet";

    // Only files from this server; inline style attributes are used by the icon sprite and a few widgets.
    // Receipt previews use blob: URLs; the compressed photo is drawn from one.
    private const string Csp =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; " +
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app, bool hsts) => app.Use((ctx, next) =>
    {
        ctx.Response.OnStarting(() =>
        {
            var h = ctx.Response.Headers;
            h.XContentTypeOptions = "nosniff";
            h.XFrameOptions = "DENY";
            if (!h.ContainsKey("Content-Security-Policy")) h.ContentSecurityPolicy = Csp;
            h["Referrer-Policy"] = "no-referrer";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
            h["Cross-Origin-Opener-Policy"] = "same-origin";
            h["Cross-Origin-Resource-Policy"] = "same-origin";
            if (hsts && ctx.Request.IsHttps) h.StrictTransportSecurity = "max-age=31536000";
            return Task.CompletedTask;
        });
        return next();
    });

    /// <summary>
    /// Every state-changing API call must come from this app's own pages: it must carry <see cref="CsrfHeader"/>,
    /// and if the browser says where it came from (Origin / Sec-Fetch-Site), that must be this same origin.
    /// SameSite=Strict cookies alone don't cover other apps on the same host (another port) or sibling subdomains.
    /// </summary>
    public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var req = ctx.Request;
        if (req.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(req.Method) && !HttpMethods.IsHead(req.Method)
            && !HttpMethods.IsOptions(req.Method) && !IsSameOrigin(req))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new { error = "درخواست از صفحه‌ی خود برنامه نیامده است؛ صفحه را دوباره باز کنید." });
            return;
        }
        await next();
    });

    private static bool IsSameOrigin(HttpRequest req)
    {
        if (req.Headers[CsrfHeader] != "1") return false;
        var site = req.Headers["Sec-Fetch-Site"].ToString();
        if (site is "cross-site" or "same-site") return false;
        var origin = req.Headers.Origin.ToString();
        if (origin.Length == 0) return true; // older browsers on same-origin requests
        // Host (and port) must match; the scheme isn't compared, so a proxy that ends HTTPS in front of the app still works.
        return Uri.TryCreate(origin, UriKind.Absolute, out var o)
            && string.Equals(o.IsDefaultPort ? o.Host : $"{o.Host}:{o.Port}", req.Host.Value, StringComparison.OrdinalIgnoreCase);
    }
}
