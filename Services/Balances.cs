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
        var orders = db.UnsettledOrders(db.Orders.Where(o => o.VoidedAt == null && (personId == null || o.PersonId == personId)));
        var consumed = await (
                from o in orders
                join i in db.Items on o.ItemId equals i.Id
                select new { o.PersonId, CardId = i.Category == null ? null : i.Category.PaymentCardId, o.Total })
            .GroupBy(x => new { x.PersonId, x.CardId })
            .Select(x => new { x.Key.PersonId, x.Key.CardId, Total = x.Sum(o => o.Total) })
            .ToListAsync();
        var paid = await db.UnsettledPayments(db.Payments.Where(p => p.VoidedAt == null && (personId == null || p.PersonId == personId)))
            .GroupBy(p => new { p.PersonId, p.PaymentCardId })
            .Select(x => new { x.Key.PersonId, CardId = x.Key.PaymentCardId, Total = x.Sum(p => p.Amount) })
            .ToListAsync();

        var result = new Dictionary<int, Dictionary<int, long>>();
        void Add(int person, int? card, long amount)
        {
            if (!result.TryGetValue(person, out var cards)) result[person] = cards = [];
            var key = card ?? General;
            cards[key] = cards.GetValueOrDefault(key) + amount;
        }
        foreach (var c in consumed) Add(c.PersonId, c.CardId, c.Total);
        foreach (var p in paid) Add(p.PersonId, p.CardId, -p.Total);
        foreach (var parts in result.Values) ApplyGeneralCredit(parts);
        return result;
    }

    /// <summary>
    /// Money paid without naming a card is not left as a "general credit" next to card debts: it pays off the
    /// card debts in card order. The parts still add up to the same total.
    /// </summary>
    private static void ApplyGeneralCredit(Dictionary<int, long> parts)
    {
        var credit = -parts.GetValueOrDefault(General);
        if (credit <= 0) return;
        foreach (var card in parts.Keys.Where(k => k != General && parts[k] > 0).Order().ToList())
        {
            var used = Math.Min(credit, parts[card]);
            parts[card] -= used;
            credit -= used;
            if (credit == 0) break;
        }
        parts[General] = -credit;
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

    /// <summary>The settlement drive in progress, if the pantry manager started one and has not ended it.</summary>
    public static Task<SettlementDrive?> ActiveDrive(AppDb db) =>
        db.SettlementDrives.Where(d => d.EndedAt == null).OrderByDescending(d => d.Id).FirstOrDefaultAsync();
}
