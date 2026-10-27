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
