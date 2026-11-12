using System.Globalization;
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
            });
        }).RequireAuthorization();

        app.MapGet("/api/report/drive", async (AppDb db) => DriveDto(await Balances.ActiveDrive(db))).RequireAuthorization();

        var g = app.MapGroup("/api/admin/drive").RequireAuthorization(Roles.Admin);

        g.MapPost("/start", async (HttpContext ctx, AppDb db, WebPush push) =>
        {
            if (await Balances.ActiveDrive(db) != null) return ApiErrors.Conflict("تسویه از قبل شروع شده است.");
            var drive = new SettlementDrive { StartedBy = ctx.User.Identity!.Name! };
            db.SettlementDrives.Add(drive);
            await db.SaveChangesAsync();
            _ = push.NotifyAllPeople(new
            {
                title = "💳 درخواست تسویه حساب",
                body = "مسئول بوفه درخواست تسویه حساب ارسال کرده است. با احترام، در صورت عدم پرداخت، سفارشات جدید پذیرفته نخواهد شد.",
                tag = "settlement-drive",
                url = "/#/me",
            });
            return Results.Ok(DriveDto(drive));
        });

        g.MapPost("/end", async (HttpContext ctx, AppDb db, WebPush push) =>
        {
            var drive = await Balances.ActiveDrive(db);
            if (drive == null) return ApiErrors.Conflict("تسویه‌ای در جریان نیست.");
            drive.EndedAt = DateTime.UtcNow;
            drive.EndedBy = ctx.User.Identity!.Name;
            await db.SaveChangesAsync();
            _ = push.NotifyAllPeople(new
            {
                title = "✅ پایان تسویه حساب",
                body = "دوره‌ی تسویه تمام شد؛ ثبت درخواست برای همه آزاد است.",
                tag = "settlement-drive",
                url = "/#/prices",
            });
            return Results.Ok(DriveDto(null));
        });

        // Who still owes money, for the manager while a drive is running.
        g.MapGet("/debtors", async (AppDb db) =>
        {
            var totals = (await Balances.ByCard(db)).ToDictionary(x => x.Key, x => x.Value.Values.Sum());
            var names = await db.People.ToDictionaryAsync(p => p.Id, p => p.Name);
            return totals.Where(x => x.Value > 0).OrderByDescending(x => x.Value)
                .Select(x => new { personId = x.Key, name = names.GetValueOrDefault(x.Key), balance = x.Value });
        });
    }

    private static object DriveDto(SettlementDrive? d) =>
        new { active = d != null, startedAt = d?.StartedAt, startedBy = d?.StartedBy };

    /// <summary>Refusal message for a request while a drive is on and the person still owes money.</summary>
    public static string BlockedMessage(long balance) =>
        $"حالت تسویه فعال است و حساب شما {balance.ToString("N0", CultureInfo.InvariantCulture)} تومان بدهکار است؛ " +
        "تا بدهی را پرداخت نکنید، درخواست جدید پذیرفته نمی‌شود.";
}
