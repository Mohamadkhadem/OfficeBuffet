using System.Globalization;
using System.Text.RegularExpressions;
using OfficeBuffet.Data;
using OfficeBuffet.Services;
using Microsoft.EntityFrameworkCore;

namespace OfficeBuffet.Endpoints;

/// <summary>Balances split by bank card, and the "settlement drive" (pay up before ordering again).</summary>
public static class BalanceEndpoints
{
    public static void MapBalances(this IEndpointRouteBuilder app)
    {
        // One person's open balance, total and per card. Employees always get their own.
        app.MapGet("/api/report/balance", async (int? personId, HttpContext ctx, AppDb db) =>
        {
            var id = AuthEndpoints.EmployeePersonId(ctx.User) ?? personId;
            if (id == null) return ApiErrors.Bad("شخص مشخص نیست.");
            var parts = (await Balances.ByCard(db, id)).GetValueOrDefault(id.Value) ?? [];
            var cards = await db.PaymentCards.OrderBy(c => c.Id).ToListAsync();
            var drive = await Balances.ActiveDrive(db);
            return Results.Ok(new
            {
                total = parts.Values.Sum(),
                cards = cards.Select(c => new { c.Id, c.Title, c.Number, balance = parts.GetValueOrDefault(c.Id) }),
                // Purchases from categories without a card, minus payments not tied to a card.
                general = parts.GetValueOrDefault(Balances.General),
                drive = DriveDto(drive),
                // What this person must pay before ordering again (0 = free to order).
                due = drive == null ? 0 : (await Balances.DueForDrive(db, drive, id)).GetValueOrDefault(id.Value),
            });
        }).RequireAuthorization();

        app.MapGet("/api/report/drive", async (AppDb db) => DriveDto(await Balances.ActiveDrive(db))).RequireAuthorization();

        var g = app.MapGroup("/api/admin/drive").RequireAuthorization(Roles.Admin);

        // Starts a drive for purchases up to the end of the chosen day; only people who owe for that period are notified.
        g.MapPost("/start", async (DriveStartRequest req, HttpContext ctx, AppDb db, WebPush push) =>
        {
            if (await Balances.ActiveDrive(db) != null) return ApiErrors.Conflict("تسویه از قبل شروع شده است.");
            if (!DateTimeOffset.TryParse(req.Until, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var until)
                || !Regex.IsMatch(req.UntilLabel ?? "", @"^\d{4}/\d{2}/\d{2}$"))
                return ApiErrors.Bad("تاریخ نامعتبر است.");
            if (until.UtcDateTime > DateTime.UtcNow.AddDays(1)) return ApiErrors.Bad("تاریخ تسویه نمی‌تواند در آینده باشد.");

            var drive = new SettlementDrive { StartedBy = ctx.User.Identity!.Name!, Until = until.UtcDateTime, UntilLabel = req.UntilLabel };
            db.SettlementDrives.Add(drive);
            await db.SaveChangesAsync();
            var debtors = await Balances.DueForDrive(db, drive);
            foreach (var (personId, due) in debtors)
                _ = push.NotifyPerson(personId, new
                {
                    title = "💳 درخواست تسویه حساب",
                    body = $"مسئول بوفه درخواست تسویه‌ی خریدهای تا {FaDigits(drive.UntilLabel!)} را ارسال کرده است. " +
                           $"بدهی شما {FaDigits(due.ToString("N0", CultureInfo.InvariantCulture))} تومان است؛ با احترام، تا پرداخت آن سفارش جدید پذیرفته نمی‌شود.",
                    tag = "settlement-drive",
                    url = "/#/pay",
                });
            return Results.Ok(new { drive = DriveDto(drive), notified = debtors.Count });
        });

        // Ends the drive quietly: ordering simply becomes free again, nobody is notified.
        g.MapPost("/end", async (HttpContext ctx, AppDb db) =>
        {
            var drive = await Balances.ActiveDrive(db);
            if (drive == null) return ApiErrors.Conflict("تسویه‌ای در جریان نیست.");
            drive.EndedAt = DateTime.UtcNow;
            drive.EndedBy = ctx.User.Identity!.Name;
            await db.SaveChangesAsync();
            return Results.Ok(new { drive = DriveDto(null), notified = 0 });
        });

        // Who still owes for the drive's period, for the manager while a drive is running.
        g.MapGet("/debtors", async (AppDb db) =>
        {
            var drive = await Balances.ActiveDrive(db);
            if (drive == null) return [];
            var due = await Balances.DueForDrive(db, drive);
            var names = await db.People.ToDictionaryAsync(p => p.Id, p => p.Name);
            return due.OrderByDescending(x => x.Value)
                .Select(x => (object)new { personId = x.Key, name = names.GetValueOrDefault(x.Key), balance = x.Value }).ToList();
        });
    }

    private static object DriveDto(SettlementDrive? d) =>
        new { active = d != null, startedAt = d?.StartedAt, startedBy = d?.StartedBy, until = d == null ? (DateTime?)null : d.Until ?? d.StartedAt, untilLabel = d?.UntilLabel };

    private static string FaDigits(string s) => string.Concat(s.Select(c => c is >= '0' and <= '9' ? (char)('۰' + c - '0') : c == ',' ? '٬' : c));

    /// <summary>Refusal message for a request while a drive is on and the person still owes money.</summary>
    public static string BlockedMessage(long due, SettlementDrive drive) =>
        $"حالت تسویه فعال است و بابت خریدهای {(drive.UntilLabel != null ? $"تا {FaDigits(drive.UntilLabel)}" : "قبل از شروع تسویه")}، " +
        $"{FaDigits(due.ToString("N0", CultureInfo.InvariantCulture))} تومان بدهکارید؛ تا آن را پرداخت نکنید، درخواست جدید پذیرفته نمی‌شود.";
}
