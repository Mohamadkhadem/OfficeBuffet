using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;

namespace OfficeBuffet.Endpoints;

/// <summary>
/// Menu categories (with optional opening hours and staff group) and staff groups. Admin only; the rules
/// themselves are applied where orders and requests are created.
/// </summary>
public static class MenuEndpoints
{
    private const int MaxNameLength = 40;

    public static void MapMenu(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/admin").RequireAuthorization(Roles.Admin);
        MapCategories(g);
        MapGroups(g);
    }

    /// <summary>The server's local time of day; opening hours are in office (server) time.</summary>
    public static TimeOnly Now() => TimeOnly.FromDateTime(DateTime.Now);

    public static string? Hhmm(TimeOnly? t) => t?.ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary>Category as the pages see it; `open` is for the moment of the request.</summary>
    public static object Dto(MenuCategory c, int itemCount = 0) => new
    {
        c.Id, c.Name, c.SortOrder,
        startTime = Hhmm(c.StartTime), endTime = Hhmm(c.EndTime),
        c.PersonGroupId, personGroup = c.PersonGroup?.Name,
        itemCount, open = c.IsOpenAt(Now()),
    };

    /// <summary>"سفارش «صبحانه» فقط از ۰۷:۰۰ تا ۱۰:۰۰ ممکن است." — for refusing an order outside the hours.</summary>
    public static string ClosedMessage(MenuCategory c) =>
        $"سفارش از دسته‌ی «{c.Name}» فقط از {FaDigits(Hhmm(c.StartTime)!)} تا {FaDigits(Hhmm(c.EndTime)!)} ممکن است.";

    private static void MapCategories(RouteGroupBuilder g)
    {
        g.MapGet("/categories", async (AppDb db) =>
        {
            var counts = await db.Items.Where(i => i.CategoryId != null).GroupBy(i => i.CategoryId)
                .Select(x => new { Id = x.Key!.Value, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count);
            var list = await db.MenuCategories.Include(c => c.PersonGroup).OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync();
            return list.Select(c => Dto(c, counts.GetValueOrDefault(c.Id)));
        });

        g.MapPost("/categories", async (MenuCategoryRequest req, AppDb db) =>
        {
            var category = new MenuCategory { SortOrder = (await db.MenuCategories.MaxAsync(c => (int?)c.SortOrder) ?? 0) + 1 };
            var error = await Apply(req, category, db);
            if (error != null) return ApiErrors.Bad(error);
            db.MenuCategories.Add(category);
            await db.SaveChangesAsync();
            return Results.Ok(new { category.Id });
        });

        g.MapPut("/categories/{id:int}", async (int id, MenuCategoryRequest req, AppDb db) =>
        {
            var category = await db.MenuCategories.FindAsync(id);
            if (category == null) return ApiErrors.NotFound("دسته پیدا نشد.");
            var error = await Apply(req, category, db);
            if (error != null) return ApiErrors.Bad(error);
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        g.MapDelete("/categories/{id:int}", async (int id, AppDb db) =>
        {
            var category = await db.MenuCategories.FindAsync(id);
            if (category == null) return ApiErrors.NotFound("دسته پیدا نشد.");
            var items = await db.Items.CountAsync(i => i.CategoryId == id);
            if (items > 0)
                return ApiErrors.Conflict($"{items} کالا در این دسته است؛ اول آن‌ها را به دسته‌ی دیگری ببرید یا «بدون دسته» کنید.");
            db.MenuCategories.Remove(category);
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // Moves a category one place up (-1) or down (+1) in the menu.
        g.MapPost("/categories/{id:int}/move", async (int id, MoveRequest req, AppDb db) =>
        {
            var list = await db.MenuCategories.OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync();
            var i = list.FindIndex(c => c.Id == id);
            if (i < 0) return ApiErrors.NotFound("دسته پیدا نشد.");
            var j = i + Math.Sign(req.Direction);
            if (j >= 0 && j < list.Count) (list[i], list[j]) = (list[j], list[i]);
            for (var k = 0; k < list.Count; k++) list[k].SortOrder = k + 1;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static async Task<string?> Apply(MenuCategoryRequest req, MenuCategory category, AppDb db)
    {
        var name = (req.Name ?? "").Trim();
        if (name.Length == 0) return "نام دسته را وارد کنید.";
        if (name.Length > MaxNameLength) return $"نام دسته حداکثر {MaxNameLength} حرف است.";
        if (await db.MenuCategories.AnyAsync(c => c.Name == name && c.Id != category.Id)) return "دسته‌ای با این نام وجود دارد.";

        var hasStart = !string.IsNullOrWhiteSpace(req.StartTime);
        var hasEnd = !string.IsNullOrWhiteSpace(req.EndTime);
        TimeOnly? start = null, end = null;
        if (hasStart || hasEnd)
        {
            if (!hasStart || !hasEnd) return "برای زمان‌بندی، هم ساعت شروع و هم ساعت پایان را وارد کنید (یا هر دو را خالی بگذارید).";
            if (!TryParseTime(req.StartTime!, out var s) || !TryParseTime(req.EndTime!, out var e)) return "ساعت را به شکل ۰۷:۳۰ وارد کنید.";
            if (s == e) return "ساعت شروع و پایان نمی‌تواند یکی باشد.";
            (start, end) = (s, e);
        }

        if (req.PersonGroupId is { } groupId && !await db.PersonGroups.AnyAsync(x => x.Id == groupId))
            return "گروه پرسنلی انتخاب‌شده وجود ندارد.";

        category.Name = name;
        category.StartTime = start;
        category.EndTime = end;
        category.PersonGroupId = req.PersonGroupId;
        return null;
    }

    private static void MapGroups(RouteGroupBuilder g)
    {
        g.MapGet("/groups", async (AppDb db) =>
        {
            var members = await db.People.Where(p => p.GroupId != null).GroupBy(p => p.GroupId)
                .Select(x => new { Id = x.Key!.Value, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count);
            var categories = await db.MenuCategories.Where(c => c.PersonGroupId != null).GroupBy(c => c.PersonGroupId)
                .Select(x => new { Id = x.Key!.Value, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count);
            return (await db.PersonGroups.OrderBy(x => x.Name).ToListAsync()).Select(x => new
            {
                x.Id, x.Name,
                memberCount = members.GetValueOrDefault(x.Id),
                categoryCount = categories.GetValueOrDefault(x.Id),
            });
        });

        g.MapPost("/groups", async (PersonGroupRequest req, AppDb db) =>
        {
            var group = new PersonGroup();
            var error = await ApplyGroup(req, group, db);
            if (error != null) return ApiErrors.Bad(error);
            db.PersonGroups.Add(group);
            await db.SaveChangesAsync();
            return Results.Ok(new { group.Id });
        });

        g.MapPut("/groups/{id:int}", async (int id, PersonGroupRequest req, AppDb db) =>
        {
            var group = await db.PersonGroups.FindAsync(id);
            if (group == null) return ApiErrors.NotFound("گروه پیدا نشد.");
            var error = await ApplyGroup(req, group, db);
            if (error != null) return ApiErrors.Bad(error);
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        g.MapDelete("/groups/{id:int}", async (int id, AppDb db) =>
        {
            var group = await db.PersonGroups.FindAsync(id);
            if (group == null) return ApiErrors.NotFound("گروه پیدا نشد.");
            // Removing a group that a category is limited to would silently open that category to everyone.
            var categories = await db.MenuCategories.Where(c => c.PersonGroupId == id).Select(c => c.Name).ToListAsync();
            if (categories.Count > 0)
                return ApiErrors.Conflict($"دسته‌های منوی «{string.Join("، ", categories)}» به این گروه اختصاص دارند؛ اول گروه آن‌ها را عوض کنید.");
            await db.People.Where(p => p.GroupId == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.GroupId, (int?)null));
            db.PersonGroups.Remove(group);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static async Task<string?> ApplyGroup(PersonGroupRequest req, PersonGroup group, AppDb db)
    {
        var name = (req.Name ?? "").Trim();
        if (name.Length == 0) return "نام گروه را وارد کنید.";
        if (name.Length > MaxNameLength) return $"نام گروه حداکثر {MaxNameLength} حرف است.";
        if (await db.PersonGroups.AnyAsync(x => x.Name == name && x.Id != group.Id)) return "گروهی با این نام وجود دارد.";
        group.Name = name;
        return null;
    }

    private static bool TryParseTime(string text, out TimeOnly time)
    {
        var latin = string.Concat(text.Trim().Select(c => c switch
        {
            >= '۰' and <= '۹' => (char)('0' + (c - '۰')),
            >= '٠' and <= '٩' => (char)('0' + (c - '٠')),
            _ => c,
        }));
        return TimeOnly.TryParseExact(latin, ["H:mm", "HH:mm", "HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out time);
    }

    private static string FaDigits(string s) => string.Concat(s.Select(c => c is >= '0' and <= '9' ? (char)('۰' + (c - '0')) : c));
}
