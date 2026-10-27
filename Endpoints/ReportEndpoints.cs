using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;

namespace OfficeBuffet.Endpoints;

/// <summary>Read-only reports. Admins see everyone; a logged-in employee only ever sees their own records.</summary>
public static class ReportEndpoints
{
    private const int MaxEntries = 500;

    public static void MapReports(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/report").RequireAuthorization();

        // Per-person totals for the range, plus each person's open balance (consumed − paid since their last settlement).
        g.MapGet("/summary", async (string? from, string? to, HttpContext ctx, AppDb db) =>
        {
            var (start, end) = ParseRange(from, to);
            var own = AuthEndpoints.EmployeePersonId(ctx.User);
            var orders = db.Orders.Where(o => o.VoidedAt == null && (own == null || o.PersonId == own));
            var payments = db.Payments.Where(p => p.VoidedAt == null && (own == null || p.PersonId == own));
            var rangedOrders = InRange(orders, start, end);
            var rangedPayments = InRange(payments, start, end);

            var consumed = await rangedOrders.GroupBy(o => o.PersonId)
                .Select(x => new { PersonId = x.Key, Qty = x.Sum(o => o.Quantity), Total = x.Sum(o => o.Total) })
                .ToDictionaryAsync(x => x.PersonId);
            var paid = await rangedPayments.GroupBy(p => p.PersonId)
                .Select(x => new { PersonId = x.Key, Total = x.Sum(p => p.Amount) })
                .ToDictionaryAsync(x => x.PersonId, x => x.Total);
            // Balance ignores everything covered by a settlement, regardless of what was actually paid.
            var openConsumed = await db.UnsettledOrders(orders).GroupBy(o => o.PersonId)
                .Select(x => new { PersonId = x.Key, Total = x.Sum(o => o.Total) })
                .ToDictionaryAsync(x => x.PersonId, x => x.Total);
            var openPaid = await db.UnsettledPayments(payments).GroupBy(p => p.PersonId)
                .Select(x => new { PersonId = x.Key, Total = x.Sum(p => p.Amount) })
                .ToDictionaryAsync(x => x.PersonId, x => x.Total);
            var settledUntil = (await db.Settlements.Where(s => s.VoidedAt == null && (own == null || s.PersonId == own))
                    .Select(s => new { s.PersonId, s.Until, s.UntilLabel }).ToListAsync())
                .GroupBy(s => s.PersonId)
                .ToDictionary(x => x.Key, x => x.MaxBy(s => s.Until)!.UntilLabel);

            var people = (await db.People.Where(p => own == null || p.Id == own).ToListAsync())
                .Select(p => new
                {
                    p.Id,
                    p.Name,
                    p.IsActive,
                    qty = consumed.GetValueOrDefault(p.Id)?.Qty ?? 0,
                    consumed = consumed.GetValueOrDefault(p.Id)?.Total ?? 0,
                    paid = paid.GetValueOrDefault(p.Id),
                    balance = openConsumed.GetValueOrDefault(p.Id) - openPaid.GetValueOrDefault(p.Id),
                    settledUntil = settledUntil.GetValueOrDefault(p.Id),
                })
                .Where(r => own != null || r.IsActive || r.qty > 0 || r.paid > 0 || r.balance != 0)
                .ToList();

            var byItem = await rangedOrders.GroupBy(o => o.ItemName)
                .Select(x => new { name = x.Key, qty = x.Sum(o => o.Quantity), total = x.Sum(o => o.Total) })
                .OrderByDescending(x => x.qty)
                .ToListAsync();

            return new { people, byItem };
        });

        // Raw records (including voided ones, so every correction stays visible).
        g.MapGet("/entries", async (int? personId, string? from, string? to, HttpContext ctx, AppDb db) =>
        {
            var (start, end) = ParseRange(from, to);
            personId = AuthEndpoints.EmployeePersonId(ctx.User) ?? personId;
            var orders = InRange(db.Orders.AsQueryable(), start, end);
            var payments = InRange(db.Payments.AsQueryable(), start, end);
            var settlements = db.Settlements.AsQueryable();
            if (start != null) settlements = settlements.Where(s => s.CreatedAt >= start);
            if (end != null) settlements = settlements.Where(s => s.CreatedAt < end);
            if (personId != null)
            {
                orders = orders.Where(o => o.PersonId == personId);
                payments = payments.Where(p => p.PersonId == personId);
                settlements = settlements.Where(s => s.PersonId == personId);
            }

            return new
            {
                orders = await orders.OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id).Take(MaxEntries)
                    .Select(o => new
                    {
                        o.Id, o.PersonId, personName = o.Person.Name, o.ItemName, o.UnitPrice, o.Quantity, o.Total,
                        o.Note, o.CreatedAt, o.CreatedBy, o.EnteredAt, o.VoidedAt, o.VoidedBy, o.VoidReason,
                        settled = db.Settlements.Any(s => s.PersonId == o.PersonId && s.VoidedAt == null && s.Until > o.CreatedAt),
                    }).ToListAsync(),
                payments = await payments.OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id).Take(MaxEntries)
                    .Select(p => new
                    {
                        p.Id, p.PersonId, personName = p.Person.Name, p.Amount,
                        p.Note, p.CreatedAt, p.CreatedBy, p.VoidedAt, p.VoidedBy, p.VoidReason,
                        settled = db.Settlements.Any(s => s.PersonId == p.PersonId && s.VoidedAt == null && s.Until > p.CreatedAt),
                    }).ToListAsync(),
                settlements = await settlements.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id).Take(MaxEntries)
                    .Select(s => new
                    {
                        s.Id, s.PersonId, personName = s.Person.Name, s.UntilLabel, s.ClearedAmount,
                        s.Note, s.CreatedAt, s.CreatedBy, s.VoidedAt, s.VoidedBy, s.VoidReason,
                    }).ToListAsync(),
            };
        });

        // Price list of what can be ordered right now; open to employees too.
        g.MapGet("/prices", async (AppDb db) =>
            await db.Items.Where(i => i.IsActive).OrderBy(i => i.Category).ThenBy(i => i.Name)
                .Select(i => new { i.Id, i.Name, i.Category, i.Price }).ToListAsync());
    }

    private static IQueryable<Order> InRange(IQueryable<Order> q, DateTime? start, DateTime? end)
    {
        if (start != null) q = q.Where(o => o.CreatedAt >= start);
        if (end != null) q = q.Where(o => o.CreatedAt < end);
        return q;
    }

    private static IQueryable<Payment> InRange(IQueryable<Payment> q, DateTime? start, DateTime? end)
    {
        if (start != null) q = q.Where(p => p.CreatedAt >= start);
        if (end != null) q = q.Where(p => p.CreatedAt < end);
        return q;
    }

    private static (DateTime?, DateTime?) ParseRange(string? from, string? to) => (ParseUtc(from), ParseUtc(to));

    private static DateTime? ParseUtc(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d)
            ? d.UtcDateTime
            : null;
}
