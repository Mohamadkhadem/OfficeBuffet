using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;

namespace OfficeBuffet.Services;

/// <summary>
/// Open balances (consumed − paid since the person's latest settlement), split by the bank card each
/// purchase belongs to. An order counts towards the card of its item's menu category; a payment towards the
/// card it was paid into. <see cref="General"/> = not tied to a card (category without a card, or such a payment).
/// </summary>
public static class Balances
{
    /// <summary>Key for the part of a balance not tied to any card (card ids start at 1).</summary>
    public const int General = 0;

    /// <summary>personId → (cardId or <see cref="General"/> → open amount). Only people with any open record appear.</summary>
    public static async Task<Dictionary<int, Dictionary<int, long>>> ByCard(AppDb db, int? personId = null)
    {
        var orders = await (
                from o in db.UnsettledOrders(db.Orders.Where(o => o.VoidedAt == null && (personId == null || o.PersonId == personId)))
                join i in db.Items on o.ItemId equals i.Id
                select new OpenOrder(o.PersonId, i.Category == null ? null : i.Category.PaymentCardId, o.CreatedAt, o.Id, o.Total))
            .ToListAsync();
        var paid = await db.UnsettledPayments(db.Payments.Where(p => p.VoidedAt == null && (personId == null || p.PersonId == personId)))
            .GroupBy(p => new { p.PersonId, p.PaymentCardId })
            .Select(x => new { x.Key.PersonId, CardId = x.Key.PaymentCardId, Total = x.Sum(p => p.Amount) })
            .ToListAsync();

        var result = new Dictionary<int, Dictionary<int, long>>();
        var ordersByPerson = orders.ToLookup(o => o.PersonId);
        var paidByPerson = paid.ToLookup(p => p.PersonId, p => (Card: p.CardId ?? General, p.Total));
        foreach (var person in ordersByPerson.Select(g => g.Key).Union(paidByPerson.Select(g => g.Key)))
            result[person] = Allocate(ordersByPerson[person], paidByPerson[person]);
        return result;
    }

    private record OpenOrder(int PersonId, int? CardId, DateTime CreatedAt, int Id, long Total);

    /// <summary>
    /// Which purchases are still unpaid, so the open balance can be split by card the way people think of it:
    /// <list type="number">
    /// <item>Money paid into a card pays that card's purchases, oldest first.</item>
    /// <item>Money paid without a card, and anything paid into a card beyond its purchases, pays the oldest
    /// unpaid purchases first, whatever card they belong to (e.g. 250,000 paid for last week's coffees settles
    /// those coffees, not this week's breakfasts).</item>
    /// <item>What is left unpaid is the debt, per card; money left after everything is paid is a credit
    /// (<see cref="General"/>).</item>
    /// </list>
    /// The parts always add up to purchases − payments.
    /// </summary>
    private static Dictionary<int, long> Allocate(IEnumerable<OpenOrder> orders, IEnumerable<(int Card, long Total)> payments)
    {
        var open = orders.OrderBy(o => o.CreatedAt).ThenBy(o => o.Id)
            .Select(o => (Card: o.CardId ?? General, Left: o.Total)).ToArray();
        var pool = 0L; // money not (or no longer) tied to a card

        long PayOldest(long money, int? onlyCard)
        {
            for (var i = 0; i < open.Length && money > 0; i++)
            {
                if (open[i].Left <= 0 || (onlyCard != null && open[i].Card != onlyCard)) continue;
                var used = Math.Min(money, open[i].Left);
                open[i].Left -= used;
                money -= used;
            }
            return money;
        }

        foreach (var (card, total) in payments)
            pool += card == General ? total : PayOldest(total, card);
        pool = PayOldest(pool, null);

        var parts = new Dictionary<int, long>();
        foreach (var o in open) parts[o.Card] = parts.GetValueOrDefault(o.Card) + o.Left;
        foreach (var (card, _) in payments) parts.TryAdd(card, 0);
        parts[General] = parts.GetValueOrDefault(General) - pool;
        return parts;
    }

    /// <summary>The person's total open balance; positive = owes money.</summary>
    public static async Task<long> Total(AppDb db, int personId) =>
        (await ByCard(db, personId)).GetValueOrDefault(personId)?.Values.Sum() ?? 0;

    /// <summary>
    /// What each person still owes for the drive: purchases up to the drive's cutoff, minus every payment so far
    /// (a payment made during the drive pays the old debt first). Only people who owe something appear.
    /// Orders after the cutoff are left out, so someone who has paid can keep ordering.
    /// </summary>
    public static async Task<Dictionary<int, long>> DueForDrive(AppDb db, SettlementDrive drive, int? personId = null)
    {
        var cutoff = drive.Until ?? drive.StartedAt;
        var consumed = await db.UnsettledOrders(db.Orders.Where(o => o.VoidedAt == null && o.CreatedAt < cutoff && (personId == null || o.PersonId == personId)))
            .GroupBy(o => o.PersonId).Select(x => new { PersonId = x.Key, Total = x.Sum(o => o.Total) })
            .ToDictionaryAsync(x => x.PersonId, x => x.Total);
        var paid = await db.UnsettledPayments(db.Payments.Where(p => p.VoidedAt == null && (personId == null || p.PersonId == personId)))
            .GroupBy(p => p.PersonId).Select(x => new { PersonId = x.Key, Total = x.Sum(p => p.Amount) })
            .ToDictionaryAsync(x => x.PersonId, x => x.Total);
        return consumed.Select(x => (x.Key, Due: x.Value - paid.GetValueOrDefault(x.Key)))
            .Where(x => x.Due > 0).ToDictionary(x => x.Key, x => x.Due);
    }

    /// <summary>
    /// Allowed debt during a drive per person (their staff group's <see cref="PersonGroup.DebtLimit"/>; 0 without a
    /// group). A person is blocked from ordering only while their drive debt is above it.
    /// </summary>
    public static Task<Dictionary<int, long>> DebtLimits(AppDb db, int? personId = null) =>
        db.People.Where(p => personId == null || p.Id == personId)
            .Select(p => new { p.Id, Limit = p.Group == null ? 0L : p.Group.DebtLimit })
            .ToDictionaryAsync(x => x.Id, x => x.Limit);

    /// <summary>The settlement drive in progress, if the pantry manager started one and has not ended it.</summary>
    public static Task<SettlementDrive?> ActiveDrive(AppDb db) =>
        db.SettlementDrives.Where(d => d.EndedAt == null).OrderByDescending(d => d.Id).FirstOrDefaultAsync();
}
