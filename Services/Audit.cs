using System.Security.Claims;
using OfficeBuffet.Data;

namespace OfficeBuffet.Services;

/// <summary>Writes to the append-only <see cref="AuditEntry"/> log. Saved together with the caller's SaveChanges.</summary>
public static class Audit
{
    public const int MaxDetails = 500;

    /// <summary>Adds an entry; it is stored by the caller's next SaveChangesAsync (so it commits with the change itself).</summary>
    public static void Add(AppDb db, HttpContext ctx, string action, string? details = null, string? actor = null)
    {
        details = details?.Trim();
        if (details?.Length > MaxDetails) details = details[..MaxDetails];
        db.AuditLog.Add(new AuditEntry
        {
            Actor = Clip(actor ?? ActorOf(ctx.User), 100),
            Action = action,
            Details = string.IsNullOrEmpty(details) ? null : details,
            Ip = Clip(ctx.Connection.RemoteIpAddress?.ToString() ?? "", 64),
        });
    }

    /// <summary>Adds and saves at once, for events with no other change (logins, failed attempts).</summary>
    public static async Task Write(AppDb db, HttpContext ctx, string action, string? details = null, string? actor = null)
    {
        Add(db, ctx, action, details, actor);
        await db.SaveChangesAsync();
    }

    private static string ActorOf(ClaimsPrincipal user) => user.Identity?.IsAuthenticated == true ? user.Identity.Name ?? "-" : "-";

    /// <summary>"0012345678" → "*******678": enough to recognize a typo, not enough to log in with.</summary>
    public static string MaskCode(string? code) =>
        string.IsNullOrEmpty(code) ? "" : code.Length <= 3 ? new string('*', code.Length) : new string('*', code.Length - 3) + code[^3..];

    /// <summary>Card numbers are shown to employees anyway; the log keeps the first 6 and last 4 digits.</summary>
    public static string MaskCard(string? number) =>
        string.IsNullOrEmpty(number) || number.Length < 10 ? number ?? "" : $"{number[..6]}…{number[^4..]}";

    private static string Clip(string s, int max) => s.Length > max ? s[..max] : s;
}
