namespace OfficeBuffet.Data;

public class AdminUser
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>
    /// Changes when the password changes; logins carry it, so every other session of this account ends.
    /// Empty for accounts from before it existed (their current logins stay valid until the next change).
    /// </summary>
    public string SecurityStamp { get; set; } = "";
}

public class Person
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>10-digit Iranian national code; the employee logs in with it. Null = cannot log in.</summary>
    public string? NationalCode { get; set; }
    public bool IsActive { get; set; } = true;
    /// <summary>Optional staff group; menu categories can be limited to one group.</summary>
    public int? GroupId { get; set; }
    public PersonGroup? Group { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A group of staff (e.g. "شیفت شب"), used to offer some menu categories only to them.</summary>
public class PersonGroup
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A menu section (e.g. "صبحانه"). Optionally open only between two times of day, and optionally only for
/// one staff group; without those it is open all day, for everyone.
/// </summary>
public class MenuCategory
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
    /// <summary>Local (server) time of day the category opens; null together with <see cref="EndTime"/> = always open.</summary>
    public TimeOnly? StartTime { get; set; }
    /// <summary>Closing time (exclusive). Earlier than <see cref="StartTime"/> means the window runs past midnight.</summary>
    public TimeOnly? EndTime { get; set; }
    public int? PersonGroupId { get; set; }
    public PersonGroup? PersonGroup { get; set; }
    /// <summary>The bank card this category's purchases are paid into; debts are shown per card.</summary>
    public int? PaymentCardId { get; set; }
    public PaymentCard? PaymentCard { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public bool IsOpenAt(TimeOnly time) =>
        StartTime is not { } start || EndTime is not { } end
        || (start <= end ? time >= start && time < end : time >= start || time < end);

    /// <summary>Whether a person in this group may order from the category (no group = everyone).</summary>
    public bool IsFor(int? groupId) => PersonGroupId == null || PersonGroupId == groupId;
}

/// <summary>A bank card colleagues pay into, shown with its title on their account page (e.g. "کارت صبحانه").</summary>
public class PaymentCard
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    /// <summary>16 digits, no separators.</summary>
    public string Number { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Item
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Menu category; null = "سایر" (always open, for everyone).</summary>
    public int? CategoryId { get; set; }
    public MenuCategory? Category { get; set; }
    /// <summary>Price in Toman.</summary>
    public long Price { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One consumed item. Name and price are copied at the time of ordering so later
/// price changes never alter past bills. Records are never deleted, only voided.
/// </summary>
public class Order
{
    public int Id { get; set; }
    public int PersonId { get; set; }
    public Person Person { get; set; } = null!;
    public int ItemId { get; set; }
    public string ItemName { get; set; } = "";
    public long UnitPrice { get; set; }
    public int Quantity { get; set; }
    public long Total { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "";
    /// <summary>When the order was actually typed in, if it was recorded later for an earlier day (from a paper list).</summary>
    public DateTime? EnteredAt { get; set; }
    /// <summary>The request this order was created from, so accepting can be undone.</summary>
    public int? PantryRequestId { get; set; }
    public DateTime? VoidedAt { get; set; }
    public string? VoidedBy { get; set; }
    public string? VoidReason { get; set; }
}

/// <summary>
/// A period in which the pantry manager asks everyone to pay up: while it is active (not ended), anyone with
/// an open debt cannot send new requests.
/// </summary>
public class SettlementDrive
{
    public int Id { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public string StartedBy { get; set; } = "";
    /// <summary>
    /// Only purchases before this moment (end of the chosen day) must be paid; orders after it don't block anyone.
    /// Null on drives started before the cutoff existed: then the start time is the cutoff.
    /// </summary>
    public DateTime? Until { get; set; }
    /// <summary>The chosen Jalali day as shown to people, e.g. "1405/08/23".</summary>
    public string? UntilLabel { get; set; }
    public DateTime? EndedAt { get; set; }
    public string? EndedBy { get; set; }
}

/// <summary>
/// "Settled up to a date": every order and payment of the person before <see cref="Until"/> is
/// considered closed, whatever was actually paid. The balance only counts records after the latest one.
/// </summary>
public class Settlement
{
    public int Id { get; set; }
    public int PersonId { get; set; }
    public Person Person { get; set; } = null!;
    /// <summary>Exclusive cutoff instant (start of the day after the chosen date), UTC.</summary>
    public DateTime Until { get; set; }
    /// <summary>The chosen Jalali date as shown to users, e.g. "1405/08/05".</summary>
    public string UntilLabel { get; set; } = "";
    /// <summary>Open balance that this settlement cleared, kept for the record.</summary>
    public long ClearedAmount { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "";
    public DateTime? VoidedAt { get; set; }
    public string? VoidedBy { get; set; }
    public string? VoidReason { get; set; }
}

public class Payment
{
    public int Id { get; set; }
    public int PersonId { get; set; }
    public Person Person { get; set; } = null!;
    public long Amount { get; set; }
    /// <summary>The bank card this was paid into; null = general (not tied to a card).</summary>
    public int? PaymentCardId { get; set; }
    public PaymentCard? PaymentCard { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "";
    public DateTime? VoidedAt { get; set; }
    public string? VoidedBy { get; set; }
    public string? VoidReason { get; set; }
}

public static class ClaimStatus
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Rejected = "rejected";
    public const string Cancelled = "cancelled";
}

/// <summary>
/// "I paid": an employee reports a transfer with a photo of the bank receipt. It only becomes a
/// <see cref="Payment"/> when the manager approves it. The photo is a file on disk (see ReceiptStore),
/// never stored in the database, so the database stays small and fast however many receipts pile up.
/// </summary>
public class PaymentClaim
{
    public int Id { get; set; }
    public int PersonId { get; set; }
    public Person Person { get; set; } = null!;
    public long Amount { get; set; }
    public int? PaymentCardId { get; set; }
    public PaymentCard? PaymentCard { get; set; }
    public string? Note { get; set; }
    /// <summary>Path of the receipt image relative to the receipts folder, e.g. "2026/11/3f…a1.jpg".</summary>
    public string ReceiptFile { get; set; } = "";
    public string ReceiptContentType { get; set; } = "";
    public long ReceiptBytes { get; set; }
    /// <summary>SHA-256 (hex) of the stored image, so the same receipt can't be paid off twice. Null for older claims.</summary>
    public string? ReceiptSha256 { get; set; }
    public string Status { get; set; } = ClaimStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
    public string? RejectReason { get; set; }
    /// <summary>The payment recorded when this was approved.</summary>
    public int? PaymentId { get; set; }
    public Payment? Payment { get; set; }
}

public static class RequestStatus
{
    public const string Pending = "pending";
    public const string Done = "done";
    public const string Rejected = "rejected";
    public const string Cancelled = "cancelled";
}

/// <summary>
/// An employee asking the pantry for something ("Ali wants a coffee"). It only becomes billable
/// orders when the admin accepts it, at the prices of that moment.
/// </summary>
public class PantryRequest
{
    public int Id { get; set; }
    public int PersonId { get; set; }
    public Person Person { get; set; } = null!;
    public List<PantryRequestLine> Lines { get; set; } = [];
    public string? Note { get; set; }
    public string Status { get; set; } = RequestStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? HandledAt { get; set; }
    public string? HandledBy { get; set; }
    public string? RejectReason { get; set; }
    /// <summary>Last time the employee nudged the admin about this request (re-sends the notification).</summary>
    public DateTime? RemindedAt { get; set; }
    public int RemindCount { get; set; }
    /// <summary>Set when the admin changed the lines (e.g. an item was out of stock).</summary>
    public DateTime? EditedAt { get; set; }
    public string? EditedBy { get; set; }
}

public class PantryRequestLine
{
    public int Id { get; set; }
    public int PantryRequestId { get; set; }
    public int ItemId { get; set; }
    public string ItemName { get; set; } = "";
    public int Quantity { get; set; }
}

/// <summary>A browser (usually the admin's phone) that receives Web Push notifications for new requests.</summary>
/// <summary>A device that receives notifications: an admin's (new requests) or an employee's (answers to their requests).</summary>
public class PushSubscription
{
    public int Id { get; set; }
    public int? AdminUserId { get; set; }
    public AdminUser? AdminUser { get; set; }
    public int? PersonId { get; set; }
    public Person? Person { get; set; }
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Append-only record of security-relevant events: logins, password and account changes, bank cards, prices.
/// There is no API to change or delete it, and database triggers refuse UPDATE and DELETE.
/// </summary>
public class AuditEntry
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    /// <summary>Who did it: admin username, employee name, or "-" for a failed anonymous attempt.</summary>
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Details { get; set; }
    public string? Ip { get; set; }
}
