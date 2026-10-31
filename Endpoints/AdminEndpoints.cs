using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;
using OfficeBuffet.Services;

namespace OfficeBuffet.Endpoints;

/// <summary>Everything the responsible person (admin) can do. All routes require login.</summary>
public static class AdminEndpoints
{
    private const int MaxQuantity = 50;
    private const int MaxBackdateDays = 60;
    private const int MaxNoteLength = 200;

    public static void MapAdmin(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/admin").RequireAuthorization(Roles.Admin);
        MapItems(g);
        MapPeople(g);
        MapOrders(g);
        MapPayments(g);
        MapSettlements(g);
        MapUsers(g);
        MapCards(g);
    }

    private static void MapCards(RouteGroupBuilder g)
    {
        g.MapGet("/cards", async (AppDb db) => await db.PaymentCards.OrderBy(c => c.Id).ToListAsync());

        g.MapPost("/cards", async (PaymentCardRequest req, AppDb db) =>
        {
            var (card, error) = await ValidateCard(req, null, db);
            if (error != null) return error == CheckDigitFailed ? CheckDigitResult() : ApiErrors.Bad(error);
            db.PaymentCards.Add(card!);
            await db.SaveChangesAsync();
            return Results.Ok(card);
        });

        g.MapPut("/cards/{id:int}", async (int id, PaymentCardRequest req, AppDb db) =>
        {
            var card = await db.PaymentCards.FindAsync(id);
            if (card == null) return ApiErrors.NotFound("کارت پیدا نشد.");
            var (valid, error) = await ValidateCard(req, id, db);
            if (error != null) return error == CheckDigitFailed ? CheckDigitResult() : ApiErrors.Bad(error);
            card.Title = valid!.Title;
            card.Number = valid.Number;
            await db.SaveChangesAsync();
            return Results.Ok(card);
        });

        g.MapDelete("/cards/{id:int}", async (int id, AppDb db) =>
        {
            var card = await db.PaymentCards.FindAsync(id);
            if (card == null) return ApiErrors.NotFound("کارت پیدا نشد.");
            db.PaymentCards.Remove(card);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static async Task<(PaymentCard? Card, string? Error)> ValidateCard(PaymentCardRequest req, int? id, AppDb db)
    {
        var title = (req.Title ?? "").Trim();
        if (title.Length == 0) return (null, "عنوان کارت را وارد کنید (مثلاً «کارت صبحانه»).");
        if (title.Length > 60) return (null, "عنوان کارت حداکثر ۶۰ حرف است.");
        var number = NationalCode.Normalize(req.Number); // keeps only the digits, Persian or Latin
        if (number.Length != 16) return (null, "شماره کارت باید ۱۶ رقم باشد.");
        if (await db.PaymentCards.AnyAsync(c => c.Number == number && c.Id != id)) return (null, "این شماره کارت قبلاً ثبت شده است.");
        if (!req.Force && !IsValidCardNumber(number)) return (null, CheckDigitFailed);
        return (new PaymentCard { Title = title, Number = number }, null);
    }

    private const string CheckDigitFailed = "شماره کارت با رقم کنترل جور نیست؛ احتمالاً یک رقم اشتباه تایپ شده است.";

    /// <summary>A typo is likely but not certain, so the page asks the admin and can resend with Force.</summary>
    private static IResult CheckDigitResult() =>
        Results.BadRequest(new { error = CheckDigitFailed, confirm = true });

    /// <summary>Luhn check digit, which Iranian bank card numbers follow; catches most typos.</summary>
    private static bool IsValidCardNumber(string digits)
    {
        var sum = 0;
        for (var i = 0; i < digits.Length; i++)
        {
            var d = digits[digits.Length - 1 - i] - '0';
            if (i % 2 == 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        return sum % 10 == 0;
    }

    private static void MapItems(RouteGroupBuilder g)
    {
        g.MapGet("/items", async (AppDb db) =>
            await db.Items.OrderBy(i => i.Category).ThenBy(i => i.Name).ToListAsync());

        g.MapPost("/items", async (ItemRequest req, AppDb db) =>
        {
            var error = await ValidateItem(req, null, db);
            if (error != null) return ApiErrors.Bad(error);
            var item = new Item { Name = req.Name.Trim(), Category = (req.Category ?? "").Trim(), Price = req.Price, IsActive = req.IsActive };
            db.Items.Add(item);
            await db.SaveChangesAsync();
            return Results.Ok(item);
        });

        g.MapPut("/items/{id:int}", async (int id, ItemRequest req, AppDb db) =>
        {
            var item = await db.Items.FindAsync(id);
            if (item == null) return ApiErrors.NotFound("کالا پیدا نشد.");
            var error = await ValidateItem(req, id, db);
            if (error != null) return ApiErrors.Bad(error);
            item.Name = req.Name.Trim();
            item.Category = (req.Category ?? "").Trim();
            item.Price = req.Price;
            item.IsActive = req.IsActive;
            await db.SaveChangesAsync();
            return Results.Ok(item);
        });

        g.MapDelete("/items/{id:int}", async (int id, AppDb db) =>
        {
            var item = await db.Items.FindAsync(id);
            if (item == null) return ApiErrors.NotFound("کالا پیدا نشد.");
            if (await db.Orders.AnyAsync(o => o.ItemId == id))
                return ApiErrors.Conflict("این کالا در سفارش‌ها استفاده شده و قابل حذف نیست؛ به‌جای حذف، غیرفعالش کنید.");
            db.Items.Remove(item);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static async Task<string?> ValidateItem(ItemRequest req, int? id, AppDb db)
    {
        var name = (req.Name ?? "").Trim();
        if (name.Length == 0) return "نام کالا را وارد کنید.";
        if (req.Price < 0) return "قیمت نمی‌تواند منفی باشد.";
        if (await db.Items.AnyAsync(i => i.Name == name && i.Id != id)) return "کالایی با این نام وجود دارد.";
        return null;
    }

    private static void MapPeople(RouteGroupBuilder g)
    {
        g.MapGet("/people", async (AppDb db) => await db.People.OrderBy(p => p.Name).ToListAsync());

        g.MapPost("/people", async (PersonRequest req, AppDb db) =>
        {
            var error = await ValidatePerson(req, null, db);
            if (error != null) return ApiErrors.Bad(error);
            var person = new Person { Name = req.Name.Trim(), NationalCode = NormalizedCode(req), IsActive = req.IsActive };
            db.People.Add(person);
            await db.SaveChangesAsync();
            return Results.Ok(person);
        });

        g.MapPut("/people/{id:int}", async (int id, PersonRequest req, AppDb db) =>
        {
            var person = await db.People.FindAsync(id);
            if (person == null) return ApiErrors.NotFound("شخص پیدا نشد.");
            var error = await ValidatePerson(req, id, db);
            if (error != null) return ApiErrors.Bad(error);
            person.Name = req.Name.Trim();
            person.NationalCode = NormalizedCode(req);
            person.IsActive = req.IsActive;
            await db.SaveChangesAsync();
            return Results.Ok(person);
        });

        g.MapDelete("/people/{id:int}", async (int id, AppDb db) =>
        {
            var person = await db.People.FindAsync(id);
            if (person == null) return ApiErrors.NotFound("شخص پیدا نشد.");
            if (await db.Orders.AnyAsync(o => o.PersonId == id) || await db.Payments.AnyAsync(p => p.PersonId == id)
                || await db.Settlements.AnyAsync(s => s.PersonId == id) || await db.Requests.AnyAsync(r => r.PersonId == id))
                return ApiErrors.Conflict("این شخص سابقه‌ی سفارش یا پرداخت دارد و قابل حذف نیست؛ به‌جای حذف، غیرفعالش کنید.");
            db.People.Remove(person);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static async Task<string?> ValidatePerson(PersonRequest req, int? id, AppDb db)
    {
        var name = (req.Name ?? "").Trim();
        if (name.Length == 0) return "نام شخص را وارد کنید.";
        if (await db.People.AnyAsync(p => p.Name == name && p.Id != id)) return "شخصی با این نام وجود دارد.";
        var code = NormalizedCode(req);
        if (code != null)
        {
            if (!NationalCode.IsValid(code)) return "کد ملی معتبر نیست؛ ۱۰ رقم آن را دوباره بررسی کنید.";
            var owner = await db.People.Where(p => p.NationalCode == code && p.Id != id).Select(p => p.Name).FirstOrDefaultAsync();
            if (owner != null) return $"این کد ملی قبلاً برای «{owner}» ثبت شده است.";
        }
        return null;
    }

    private static string? NormalizedCode(PersonRequest req)
    {
        var code = NationalCode.Normalize(req.NationalCode);
        return code.Length == 0 ? null : code;
    }

    private static void MapOrders(RouteGroupBuilder g)
    {
        g.MapPost("/orders", async (OrderRequest req, HttpContext ctx, AppDb db) =>
        {
            var person = await db.People.FindAsync(req.PersonId);
            if (person == null || !person.IsActive) return ApiErrors.Bad("شخص انتخاب‌شده معتبر نیست.");
            var lines = (req.Lines ?? []).Where(l => l.Quantity > 0).ToList();
            if (lines.Count == 0) return ApiErrors.Bad("حداقل یک قلم انتخاب کنید.");
            if (lines.Any(l => l.Quantity > MaxQuantity)) return ApiErrors.Bad($"تعداد هر قلم حداکثر {MaxQuantity} است.");

            var itemIds = lines.Select(l => l.ItemId).Distinct().ToList();
            var items = await db.Items.Where(i => itemIds.Contains(i.Id) && i.IsActive).ToDictionaryAsync(i => i.Id);
            if (items.Count != itemIds.Count) return ApiErrors.Bad("یکی از اقلام انتخاب‌شده معتبر یا فعال نیست.");

            var now = DateTime.UtcNow;
            var at = now;
            DateTime? enteredAt = null;
            // An earlier day, for orders written on paper while nobody could use the app.
            if (!string.IsNullOrWhiteSpace(req.Date))
            {
                if (!TryParseUtc(req.Date, out at)) return ApiErrors.Bad("تاریخ نامعتبر است.");
                if (at > now.AddMinutes(5)) return ApiErrors.Bad("ثبت سفارش برای تاریخ آینده ممکن نیست.");
                if (at < now.AddDays(-MaxBackdateDays)) return ApiErrors.Bad($"سفارش را حداکثر تا {MaxBackdateDays} روز قبل می‌توان ثبت کرد.");
                var latest = await LatestSettlement(db, person.Id);
                if (latest != null && latest.Until > at)
                    return ApiErrors.Bad($"حساب این شخص تا {latest.UntilLabel} تسویه شده؛ برای قبل از آن نمی‌توان سفارش ثبت کرد.");
                if (at < now.AddMinutes(-5)) enteredAt = now;
                else at = now;
            }

            var note = Clip(req.Note);
            var by = ctx.User.Identity!.Name!;
            var orders = lines.GroupBy(l => l.ItemId).Select(grp =>
            {
                var item = items[grp.Key];
                var qty = grp.Sum(l => l.Quantity);
                return new Order
                {
                    PersonId = person.Id, ItemId = item.Id, ItemName = item.Name, UnitPrice = item.Price,
                    Quantity = qty, Total = item.Price * qty, Note = note, CreatedAt = at, CreatedBy = by, EnteredAt = enteredAt,
                };
            }).ToList();
            db.Orders.AddRange(orders);
            await db.SaveChangesAsync();
            return Results.Ok(new { count = orders.Count, total = orders.Sum(o => o.Total) });
        });

        g.MapPost("/orders/{id:int}/void", async (int id, VoidRequest req, HttpContext ctx, AppDb db) =>
        {
            var order = await db.Orders.FindAsync(id);
            if (order == null) return ApiErrors.NotFound("سفارش پیدا نشد.");
            if (order.VoidedAt != null) return ApiErrors.Conflict("این سفارش قبلاً ابطال شده است.");
            var reason = Clip(req.Reason);
            if (reason == null) return ApiErrors.Bad("دلیل ابطال را بنویسید.");
            order.VoidedAt = DateTime.UtcNow;
            order.VoidedBy = ctx.User.Identity!.Name;
            order.VoidReason = reason;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static void MapPayments(RouteGroupBuilder g)
    {
        g.MapPost("/payments", async (PaymentRequest req, HttpContext ctx, AppDb db) =>
        {
            var person = await db.People.FindAsync(req.PersonId);
            if (person == null) return ApiErrors.Bad("شخص انتخاب‌شده معتبر نیست.");
            if (req.Amount <= 0) return ApiErrors.Bad("مبلغ پرداخت باید بیشتر از صفر باشد.");
            var payment = new Payment { PersonId = person.Id, Amount = req.Amount, Note = Clip(req.Note), CreatedBy = ctx.User.Identity!.Name! };
            db.Payments.Add(payment);
            await db.SaveChangesAsync();
            return Results.Ok(new { payment.Id });
        });

        g.MapPost("/payments/{id:int}/void", async (int id, VoidRequest req, HttpContext ctx, AppDb db) =>
        {
            var payment = await db.Payments.FindAsync(id);
            if (payment == null) return ApiErrors.NotFound("پرداخت پیدا نشد.");
            if (payment.VoidedAt != null) return ApiErrors.Conflict("این پرداخت قبلاً ابطال شده است.");
            var reason = Clip(req.Reason);
            if (reason == null) return ApiErrors.Bad("دلیل ابطال را بنویسید.");
            payment.VoidedAt = DateTime.UtcNow;
            payment.VoidedBy = ctx.User.Identity!.Name;
            payment.VoidReason = reason;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static void MapSettlements(RouteGroupBuilder g)
    {
        // How much is open (unsettled) for the person up to the cutoff, so the admin sees what a settlement clears.
        g.MapGet("/settlements/preview", async (int personId, string until, AppDb db) =>
        {
            if (!TryParseUtc(until, out var cutoff)) return ApiErrors.Bad("تاریخ نامعتبر است.");
            var latest = await LatestSettlement(db, personId);
            return Results.Ok(new { openAmount = await OpenAmount(db, personId, cutoff), settledUntil = latest?.UntilLabel });
        });

        g.MapPost("/settlements", async (SettlementRequest req, HttpContext ctx, AppDb db) =>
        {
            var person = await db.People.FindAsync(req.PersonId);
            if (person == null) return ApiErrors.Bad("شخص انتخاب‌شده معتبر نیست.");
            if (!TryParseUtc(req.Until, out var cutoff) || !Regex.IsMatch(req.UntilLabel ?? "", @"^\d{4}/\d{2}/\d{2}$"))
                return ApiErrors.Bad("تاریخ نامعتبر است.");
            if (cutoff > DateTime.UtcNow.AddDays(1)) return ApiErrors.Bad("تسویه برای تاریخ آینده ممکن نیست.");
            var latest = await LatestSettlement(db, person.Id);
            if (latest != null && latest.Until >= cutoff)
                return ApiErrors.Bad($"حساب این شخص قبلاً تا {latest.UntilLabel} تسویه شده است.");

            var settlement = new Settlement
            {
                PersonId = person.Id, Until = cutoff, UntilLabel = req.UntilLabel!,
                ClearedAmount = await OpenAmount(db, person.Id, cutoff),
                Note = Clip(req.Note), CreatedBy = ctx.User.Identity!.Name!,
            };
            db.Settlements.Add(settlement);
            await db.SaveChangesAsync();
            return Results.Ok(new { settlement.Id, settlement.ClearedAmount });
        });

        g.MapPost("/settlements/{id:int}/void", async (int id, VoidRequest req, HttpContext ctx, AppDb db) =>
        {
            var settlement = await db.Settlements.FindAsync(id);
            if (settlement == null) return ApiErrors.NotFound("تسویه پیدا نشد.");
            if (settlement.VoidedAt != null) return ApiErrors.Conflict("این تسویه قبلاً ابطال شده است.");
            var reason = Clip(req.Reason);
            if (reason == null) return ApiErrors.Bad("دلیل ابطال را بنویسید.");
            settlement.VoidedAt = DateTime.UtcNow;
            settlement.VoidedBy = ctx.User.Identity!.Name;
            settlement.VoidReason = reason;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static Task<Settlement?> LatestSettlement(AppDb db, int personId) =>
        db.Settlements.Where(s => s.PersonId == personId && s.VoidedAt == null)
            .OrderByDescending(s => s.Until).FirstOrDefaultAsync();

    private static async Task<long> OpenAmount(AppDb db, int personId, DateTime cutoff)
    {
        var consumed = await db.UnsettledOrders(db.Orders)
            .Where(o => o.PersonId == personId && o.VoidedAt == null && o.CreatedAt < cutoff).SumAsync(o => o.Total);
        var paid = await db.UnsettledPayments(db.Payments)
            .Where(p => p.PersonId == personId && p.VoidedAt == null && p.CreatedAt < cutoff).SumAsync(p => p.Amount);
        return consumed - paid;
    }

    private static bool TryParseUtc(string? value, out DateTime utc)
    {
        var ok = DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d);
        utc = ok ? d.UtcDateTime : default;
        return ok;
    }

    private static void MapUsers(RouteGroupBuilder g)
    {
        g.MapGet("/users", async (AppDb db) =>
            await db.AdminUsers.OrderBy(u => u.Id).Select(u => new { u.Id, u.Username, u.CreatedAt }).ToListAsync());

        g.MapPost("/users", async (UserRequest req, AppDb db) =>
        {
            var error = AuthEndpoints.ValidateCredentials(req.Username, req.Password);
            if (error != null) return ApiErrors.Bad(error);
            var username = req.Username.Trim();
            if (await db.AdminUsers.AnyAsync(u => u.Username == username)) return ApiErrors.Bad("این نام کاربری وجود دارد.");
            var user = new AdminUser { Username = username, PasswordHash = Passwords.Hash(req.Password) };
            db.AdminUsers.Add(user);
            await db.SaveChangesAsync();
            return Results.Ok(new { user.Id, user.Username, user.CreatedAt });
        });

        g.MapDelete("/users/{id:int}", async (int id, HttpContext ctx, AppDb db) =>
        {
            var user = await db.AdminUsers.FindAsync(id);
            if (user == null) return ApiErrors.NotFound("کاربر پیدا نشد.");
            if (user.Username == ctx.User.Identity!.Name) return ApiErrors.Bad("نمی‌توانید حساب خودتان را حذف کنید.");
            db.AdminUsers.Remove(user);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static string? Clip(string? text)
    {
        text = text?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        return text.Length > MaxNoteLength ? text[..MaxNoteLength] : text;
    }
}
