namespace OfficeBuffet.Data;

public class AdminUser
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Person
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>10-digit Iranian national code; the employee logs in with it. Null = cannot log in.</summary>
    public string? NationalCode { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
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
    public string Category { get; set; } = "";
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
    public DateTime? VoidedAt { get; set; }
    public string? VoidedBy { get; set; }
    public string? VoidReason { get; set; }
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
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "";
    public DateTime? VoidedAt { get; set; }
    public string? VoidedBy { get; set; }
    public string? VoidReason { get; set; }
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
