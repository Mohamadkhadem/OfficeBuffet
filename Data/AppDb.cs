using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace OfficeBuffet.Data;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<AdminUser> AdminUsers => Set<AdminUser>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<Item> Items => Set<Item>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<Settlement> Settlements => Set<Settlement>();
    public DbSet<PantryRequest> Requests => Set<PantryRequest>();
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<PaymentCard> PaymentCards => Set<PaymentCard>();
    public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    public DbSet<PersonGroup> PersonGroups => Set<PersonGroup>();
    public DbSet<SettlementDrive> SettlementDrives => Set<SettlementDrive>();
    public DbSet<PaymentClaim> PaymentClaims => Set<PaymentClaim>();
    public DbSet<AuditEntry> AuditLog => Set<AuditEntry>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // SQLite drops DateTimeKind; everything is stored as UTC, so mark it as such on read.
        builder.Properties<DateTime>().HaveConversion<UtcConverter>();
        builder.Properties<DateTime?>().HaveConversion<UtcConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AdminUser>().HasIndex(x => x.Username).IsUnique();
        b.Entity<Person>().HasIndex(x => x.Name).IsUnique();
        b.Entity<Person>().HasIndex(x => x.NationalCode).IsUnique();
        b.Entity<Person>().Property(x => x.NationalCode).HasMaxLength(10);
        b.Entity<Item>().HasIndex(x => x.Name).IsUnique();
        b.Entity<PaymentCard>().HasIndex(x => x.Number).IsUnique();
        b.Entity<PersonGroup>().HasIndex(x => x.Name).IsUnique();
        b.Entity<MenuCategory>().HasIndex(x => x.Name).IsUnique();
        // Deleting a group or category that is still in use is refused by the API, so Restrict is only a safety net.
        b.Entity<MenuCategory>().HasOne(x => x.PersonGroup).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<Item>().HasOne(x => x.Category).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<Person>().HasOne(x => x.Group).WithMany().OnDelete(DeleteBehavior.Restrict);
        // Removing a card leaves its categories and payments as "general" (not tied to a card).
        b.Entity<MenuCategory>().HasOne(x => x.PaymentCard).WithMany().OnDelete(DeleteBehavior.SetNull);
        b.Entity<Payment>().HasOne(x => x.PaymentCard).WithMany().OnDelete(DeleteBehavior.SetNull);
        b.Entity<Order>().HasIndex(x => x.PantryRequestId);
        b.Entity<Order>().HasIndex(x => x.CreatedAt);
        b.Entity<Order>().HasIndex(x => x.PersonId);
        b.Entity<Payment>().HasIndex(x => x.CreatedAt);
        b.Entity<Payment>().HasIndex(x => x.PersonId);
        b.Entity<Order>().HasOne(x => x.Person).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<Payment>().HasOne(x => x.Person).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<Settlement>().HasIndex(x => x.PersonId);
        b.Entity<Settlement>().HasOne(x => x.Person).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<PantryRequest>().HasIndex(x => new { x.Status, x.CreatedAt });
        b.Entity<PantryRequest>().HasIndex(x => x.PersonId);
        b.Entity<PantryRequest>().HasOne(x => x.Person).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<PantryRequest>().HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.PantryRequestId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PaymentClaim>().HasIndex(x => new { x.Status, x.CreatedAt });
        b.Entity<PaymentClaim>().HasIndex(x => x.PersonId);
        b.Entity<PaymentClaim>().HasIndex(x => x.PaymentId);
        b.Entity<PaymentClaim>().HasOne(x => x.Person).WithMany().OnDelete(DeleteBehavior.Restrict);
        b.Entity<PaymentClaim>().HasOne(x => x.PaymentCard).WithMany().OnDelete(DeleteBehavior.SetNull);
        b.Entity<PaymentClaim>().HasOne(x => x.Payment).WithMany().OnDelete(DeleteBehavior.SetNull);
        b.Entity<PaymentClaim>().Property(x => x.ReceiptFile).HasMaxLength(200);
        b.Entity<PaymentClaim>().Property(x => x.ReceiptContentType).HasMaxLength(40);
        b.Entity<PaymentClaim>().Property(x => x.ReceiptSha256).HasMaxLength(64);
        b.Entity<PaymentClaim>().HasIndex(x => x.ReceiptSha256);
        // Approving/rejecting/accepting only succeeds if nobody changed the status in between
        // (UPDATE … WHERE Status = @old), so a double click can never record a payment or an order twice.
        b.Entity<PaymentClaim>().Property(x => x.Status).IsConcurrencyToken();
        b.Entity<PantryRequest>().Property(x => x.Status).IsConcurrencyToken();
        b.Entity<AdminUser>().Property(x => x.SecurityStamp).HasMaxLength(64);
        b.Entity<AuditEntry>().ToTable("AuditLog");
        b.Entity<AuditEntry>().HasIndex(x => x.At);
        b.Entity<AuditEntry>().Property(x => x.Actor).HasMaxLength(100);
        b.Entity<AuditEntry>().Property(x => x.Action).HasMaxLength(50);
        b.Entity<AuditEntry>().Property(x => x.Details).HasMaxLength(500);
        b.Entity<AuditEntry>().Property(x => x.Ip).HasMaxLength(64);
        b.Entity<PushSubscription>().HasIndex(x => x.Endpoint).IsUnique();
        b.Entity<PushSubscription>().HasOne(x => x.AdminUser).WithMany().OnDelete(DeleteBehavior.Cascade);
        b.Entity<PushSubscription>().HasOne(x => x.Person).WithMany().OnDelete(DeleteBehavior.Cascade);
    }

    /// <summary>Keeps only records not covered by any (non-voided) settlement of their person.</summary>
    public IQueryable<Order> UnsettledOrders(IQueryable<Order> q) =>
        q.Where(o => !Settlements.Any(s => s.PersonId == o.PersonId && s.VoidedAt == null && s.Until > o.CreatedAt));

    public IQueryable<Payment> UnsettledPayments(IQueryable<Payment> q) =>
        q.Where(p => !Settlements.Any(s => s.PersonId == p.PersonId && s.VoidedAt == null && s.Until > p.CreatedAt));

    private class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}
