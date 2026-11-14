using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;
using OfficeBuffet.Services;

namespace OfficeBuffet.Endpoints;

/// <summary>
/// Employees ask the pantry for something from their phone; the admin gets a push notification and
/// either records it as orders or turns it down.
/// </summary>
public static class RequestEndpoints
{
    private const int MaxLines = 10;
    private const int MaxQuantity = 10;
    private const int MaxPendingPerPerson = 3;
    private const int MaxNoteLength = 200;
    private const int RecentCount = 30;
    private static readonly TimeSpan RemindEvery = TimeSpan.FromMinutes(2);
    private const int MaxReminders = 2;
    private const int MaxDevices = 10;

    public static void MapRequests(this IEndpointRouteBuilder app)
    {
        MapEmployee(app.MapGroup("/api/requests").RequireAuthorization(Roles.Employee));
        MapAdmin(app.MapGroup("/api/admin/requests").RequireAuthorization(Roles.Admin));
        // Admins subscribe for new requests, employees for answers to theirs.
        MapPush(app.MapGroup("/api/push").RequireAuthorization());
        app.MapPost("/api/admin/push/test", async (HttpContext ctx, WebPush push) =>
        {
            var (sent, failed) = await push.NotifyAdmins(new
            {
                title = "اعلان آزمایشی بوفه",
                body = "اعلان‌ها روی این دستگاه فعال است.",
                tag = "test",
                url = "/#/requests",
            }, AdminId(ctx.User));
            return Results.Ok(new { sent, failed });
        }).RequireAuthorization(Roles.Admin);
    }

    private static void MapEmployee(RouteGroupBuilder g)
    {
        g.MapGet("", async (HttpContext ctx, AppDb db) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            return await Project(db.Requests.Where(r => r.PersonId == personId)
                .OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id).Take(RecentCount), db).ToListAsync();
        });

        g.MapPost("", async (NewPantryRequest req, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            var lines = (req.Lines ?? []).Where(l => l.Quantity > 0)
                .GroupBy(l => l.ItemId).Select(x => new OrderLine(x.Key, x.Sum(l => l.Quantity))).ToList();
            if (lines.Count == 0) return ApiErrors.Bad("حداقل یک قلم انتخاب کنید.");
            if (lines.Count > MaxLines) return ApiErrors.Bad($"حداکثر {MaxLines} قلم در هر درخواست.");
            if (lines.Any(l => l.Quantity > MaxQuantity)) return ApiErrors.Bad($"تعداد هر قلم حداکثر {MaxQuantity} است.");
            if (await db.Requests.CountAsync(r => r.PersonId == personId && r.Status == RequestStatus.Pending) >= MaxPendingPerPerson)
                return ApiErrors.Bad($"شما {MaxPendingPerPerson} درخواست در انتظار دارید؛ صبر کنید تا رسیدگی شوند.");
            // During a settlement drive whoever still owes for purchases up to its cutoff can't order anything,
            // free items included. Orders after the cutoff don't count.
            if (await Balances.ActiveDrive(db) is { } drive
                && (await Balances.DueForDrive(db, drive, personId)).GetValueOrDefault(personId) is var due and > 0)
                return ApiErrors.Bad(BalanceEndpoints.BlockedMessage(due, drive));

            var itemIds = lines.Select(l => l.ItemId).ToList();
            var items = await db.Items.Include(i => i.Category).Where(i => itemIds.Contains(i.Id) && i.IsActive).ToDictionaryAsync(i => i.Id);
            if (items.Count != itemIds.Count) return ApiErrors.Bad("یکی از اقلام انتخاب‌شده معتبر یا فعال نیست.");

            // Menu rules: a category limited to a staff group, or open only at certain hours.
            var groupId = await db.People.Where(p => p.Id == personId).Select(p => p.GroupId).FirstOrDefaultAsync();
            var now = MenuEndpoints.Now();
            foreach (var category in items.Values.Select(i => i.Category).OfType<MenuCategory>().DistinctBy(c => c.Id))
            {
                if (!category.IsFor(groupId)) return ApiErrors.Bad($"دسته‌ی «{category.Name}» برای گروه شما نیست.");
                if (!category.IsOpenAt(now)) return ApiErrors.Bad(MenuEndpoints.ClosedMessage(category));
            }

            var request = new PantryRequest
            {
                PersonId = personId,
                Note = Clip(req.Note),
                Lines = lines.Select(l => new PantryRequestLine { ItemId = l.ItemId, ItemName = items[l.ItemId].Name, Quantity = l.Quantity }).ToList(),
            };
            db.Requests.Add(request);
            await db.SaveChangesAsync();

            _ = push.NotifyAdmins(new
            {
                title = $"{ctx.User.Identity!.Name} درخواست دارد",
                body = FaDigits(request.Note == null ? Describe(request) : $"{Describe(request)} — {request.Note}"),
                tag = $"request-{request.Id}",
                url = "/#/requests",
            });
            return Results.Ok(new { request.Id });
        });

        // "Still waiting": rings the admin's devices again, at most every couple of minutes.
        g.MapPost("/{id:int}/remind", async (int id, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            var request = await db.Requests.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id && r.PersonId == personId);
            if (request == null) return ApiErrors.NotFound("درخواست پیدا نشد.");
            if (request.Status != RequestStatus.Pending) return ApiErrors.Conflict("این درخواست قبلاً رسیدگی شده است.");
            if (request.RemindCount >= MaxReminders) return ApiErrors.Bad("به نظر می‌رسه مسئول بوفه سرش خیلی شلوغه؛ بهتره یه سر حضوری بزنی 🚶");
            var now = DateTime.UtcNow;
            var next = (request.RemindedAt ?? request.CreatedAt) + RemindEvery;
            if (now < next)
                return ApiErrors.Bad($"کمی صبر کنید؛ {Math.Ceiling((next - now).TotalSeconds)} ثانیه‌ی دیگر می‌توانید دوباره یادآوری کنید.");

            request.RemindedAt = now;
            request.RemindCount++;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این درخواست همین الان تغییر کرد؛ صفحه را تازه کنید.");
            var waited = (int)(now - request.CreatedAt).TotalMinutes;
            _ = push.NotifyAdmins(new
            {
                title = $"👋 {ctx.User.Identity!.Name} هنوز منتظر است",
                body = FaDigits($"{Describe(request)} — {waited} دقیقه است منتظر است"),
                tag = $"request-{request.Id}",
                url = "/#/requests",
            });
            return Results.Ok(new { request.RemindedAt, request.RemindCount, nextAt = now + RemindEvery });
        });

        g.MapPost("/{id:int}/cancel", async (int id, HttpContext ctx, AppDb db) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            var request = await db.Requests.FirstOrDefaultAsync(r => r.Id == id && r.PersonId == personId);
            if (request == null) return ApiErrors.NotFound("درخواست پیدا نشد.");
            if (request.Status != RequestStatus.Pending) return ApiErrors.Conflict("این درخواست قبلاً رسیدگی شده است.");
            request.Status = RequestStatus.Cancelled;
            request.HandledAt = DateTime.UtcNow;
            request.HandledBy = ctx.User.Identity!.Name;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این درخواست همین الان تغییر کرد؛ صفحه را تازه کنید.");
            return Results.Ok();
        });
    }

    private static void MapAdmin(RouteGroupBuilder g)
    {
        g.MapGet("", async (AppDb db) => new
        {
            pending = await Project(db.Requests.Where(r => r.Status == RequestStatus.Pending)
                .OrderBy(r => r.CreatedAt).ThenBy(r => r.Id), db).ToListAsync(),
            recent = await Project(db.Requests.Where(r => r.Status != RequestStatus.Pending)
                .OrderByDescending(r => r.HandledAt).ThenByDescending(r => r.Id).Take(RecentCount), db).ToListAsync(),
        });

        // Polled by open admin pages to show the badge and play a sound.
        g.MapGet("/pending", async (AppDb db) => new
        {
            count = await db.Requests.CountAsync(r => r.Status == RequestStatus.Pending),
            latestId = await db.Requests.Where(r => r.Status == RequestStatus.Pending).MaxAsync(r => (int?)r.Id) ?? 0,
            lastReminder = await db.Requests.Where(r => r.Status == RequestStatus.Pending).MaxAsync(r => r.RemindedAt),
            // Payments employees reported with a receipt, waiting for the manager (badge on the payments tab).
            claims = await db.PaymentClaims.CountAsync(c => c.Status == ClaimStatus.Pending),
            latestClaimId = await db.PaymentClaims.Where(c => c.Status == ClaimStatus.Pending).MaxAsync(c => (int?)c.Id) ?? 0,
        });

        // The manager changes a pending request before accepting it: fewer or more of an item, an item removed
        // (e.g. out of stock) or added. Staff-group limits still apply; opening hours don't (like manual orders).
        g.MapPut("/{id:int}", async (int id, EditRequestLines req, HttpContext ctx, AppDb db) =>
        {
            var request = await db.Requests.Include(r => r.Lines).Include(r => r.Person).FirstOrDefaultAsync(r => r.Id == id);
            if (request == null) return ApiErrors.NotFound("درخواست پیدا نشد.");
            if (request.Status != RequestStatus.Pending) return ApiErrors.Conflict("فقط درخواست در انتظار قابل ویرایش است؛ اول «بازگشت از تأیید» را بزنید.");
            var lines = (req.Lines ?? []).Where(l => l.Quantity > 0)
                .GroupBy(l => l.ItemId).Select(x => new OrderLine(x.Key, x.Sum(l => l.Quantity))).ToList();
            if (lines.Count == 0) return ApiErrors.Bad("درخواست بدون قلم نمی‌شود؛ اگر هیچ‌کدام موجود نیست، درخواست را رد کنید.");
            if (lines.Count > MaxLines) return ApiErrors.Bad($"حداکثر {MaxLines} قلم در هر درخواست.");
            if (lines.Any(l => l.Quantity > MaxQuantity)) return ApiErrors.Bad($"تعداد هر قلم حداکثر {MaxQuantity} است.");

            var itemIds = lines.Select(l => l.ItemId).ToList();
            var items = await db.Items.Include(i => i.Category).Where(i => itemIds.Contains(i.Id) && i.IsActive).ToDictionaryAsync(i => i.Id);
            if (items.Count != itemIds.Count) return ApiErrors.Bad("یکی از اقلام انتخاب‌شده معتبر یا فعال نیست.");
            var notForPerson = items.Values.FirstOrDefault(i => i.Category != null && !i.Category.IsFor(request.Person.GroupId));
            if (notForPerson != null)
                return ApiErrors.Bad($"«{notForPerson.Name}» از دسته‌ی «{notForPerson.Category!.Name}» است که برای گروه این شخص نیست.");

            db.RemoveRange(request.Lines);
            request.Lines = lines.Select(l => new PantryRequestLine { ItemId = l.ItemId, ItemName = items[l.ItemId].Name, Quantity = l.Quantity }).ToList();
            request.EditedAt = DateTime.UtcNow;
            request.EditedBy = ctx.User.Identity!.Name;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این درخواست همین الان تغییر کرد؛ صفحه را تازه کنید.");
            return Results.Ok();
        });

        // Undo: a handled request goes back to pending so it can be edited and accepted again. For an accepted
        // one, the orders it created are voided (kept in history with the reason, like any void).
        g.MapPost("/{id:int}/reopen", async (int id, HttpContext ctx, AppDb db) =>
        {
            var request = await db.Requests.FindAsync(id);
            if (request == null) return ApiErrors.NotFound("درخواست پیدا نشد.");
            if (request.Status is not (RequestStatus.Done or RequestStatus.Rejected))
                return ApiErrors.Conflict("فقط درخواست ثبت‌شده یا ردشده را می‌شود برگرداند.");
            var by = ctx.User.Identity!.Name;
            if (request.Status == RequestStatus.Done)
            {
                var orders = await db.Orders.Where(o => o.PantryRequestId == id && o.VoidedAt == null).ToListAsync();
                if (orders.Count == 0)
                    return ApiErrors.Conflict("سفارش‌های این درخواست پیدا نشد (احتمالاً پیش از این نسخه ثبت شده یا دستی ابطال شده)؛ از «گزارش» اصلاح کنید.");
                var orderedAt = orders.Min(o => o.CreatedAt);
                if (await db.Settlements.AnyAsync(s => s.PersonId == request.PersonId && s.VoidedAt == null && orderedAt < s.Until))
                    return ApiErrors.Conflict("حساب این شخص بعد از این سفارش تسویه شده؛ بازگشت ممکن نیست.");
                var now = DateTime.UtcNow;
                foreach (var o in orders)
                {
                    o.VoidedAt = now;
                    o.VoidedBy = by;
                    o.VoidReason = "بازگشت از تأیید درخواست برای ویرایش";
                }
            }
            request.Status = RequestStatus.Pending;
            request.HandledAt = null;
            request.HandledBy = null;
            request.RejectReason = null;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این درخواست همین الان تغییر کرد؛ صفحه را تازه کنید.");
            return Results.Ok();
        });

        // Accepting records the request as orders at today's prices.
        g.MapPost("/{id:int}/accept", async (int id, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var request = await db.Requests.Include(r => r.Lines).Include(r => r.Person).FirstOrDefaultAsync(r => r.Id == id);
            if (request == null) return ApiErrors.NotFound("درخواست پیدا نشد.");
            if (request.Status != RequestStatus.Pending) return ApiErrors.Conflict("این درخواست قبلاً رسیدگی شده است.");
            if (!request.Person.IsActive) return ApiErrors.Bad("این شخص غیرفعال است.");

            var itemIds = request.Lines.Select(l => l.ItemId).ToList();
            var items = await db.Items.Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
            var missing = request.Lines.FirstOrDefault(l => !items.ContainsKey(l.ItemId));
            if (missing != null) return ApiErrors.Bad($"کالای «{missing.ItemName}» دیگر وجود ندارد؛ درخواست را رد کنید و دستی ثبت کنید.");

            var now = DateTime.UtcNow;
            var by = ctx.User.Identity!.Name!;
            var orders = request.Lines.Select(l => new Order
            {
                PersonId = request.PersonId, ItemId = l.ItemId, ItemName = items[l.ItemId].Name, UnitPrice = items[l.ItemId].Price,
                Quantity = l.Quantity, Total = items[l.ItemId].Price * l.Quantity, Note = request.Note, CreatedAt = now, CreatedBy = by,
                PantryRequestId = request.Id,
            }).ToList();
            db.Orders.AddRange(orders);
            request.Status = RequestStatus.Done;
            request.HandledAt = now;
            request.HandledBy = by;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این درخواست همین الان تغییر کرد؛ صفحه را تازه کنید.");

            _ = push.NotifyPerson(request.PersonId, new
            {
                title = "☕ درخواستت دیده شد",
                body = FaDigits($"{Describe(request)}{(request.EditedAt != null ? " (با تغییر مسئول)" : "")} — تا دقایقی دیگر آماده می‌شود."),
                tag = $"request-{request.Id}",
                url = "/#/prices",
            });
            return Results.Ok(new { personName = request.Person.Name, total = orders.Sum(o => o.Total) });
        });

        g.MapPost("/{id:int}/reject", async (int id, VoidRequest req, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var request = await db.Requests.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id);
            if (request == null) return ApiErrors.NotFound("درخواست پیدا نشد.");
            if (request.Status != RequestStatus.Pending) return ApiErrors.Conflict("این درخواست قبلاً رسیدگی شده است.");
            request.Status = RequestStatus.Rejected;
            request.RejectReason = Clip(req.Reason);
            request.HandledAt = DateTime.UtcNow;
            request.HandledBy = ctx.User.Identity!.Name;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این درخواست همین الان تغییر کرد؛ صفحه را تازه کنید.");

            _ = push.NotifyPerson(request.PersonId, new
            {
                title = "✋ درخواستت رد شد",
                body = FaDigits(request.RejectReason == null ? Describe(request) : $"{Describe(request)} — دلیل: {request.RejectReason}"),
                tag = $"request-{request.Id}",
                url = "/#/prices",
            });
            return Results.Ok();
        });
    }

    private static void MapPush(RouteGroupBuilder g)
    {
        g.MapGet("/key", (WebPush push) => new { publicKey = push.PublicKey });

        g.MapPost("/subscribe", async (PushSubscribeRequest req, HttpContext ctx, AppDb db) =>
        {
            // The server will POST to this URL, so it must really be a browser push service, not any address
            // (e.g. a machine inside the office network).
            if (!WebPush.IsValidSubscription(req.Endpoint, req.Keys?.P256dh, req.Keys?.Auth))
                return ApiErrors.Bad("اطلاعات اشتراک اعلان معتبر نیست.");
            var sub = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
            if (sub == null) db.PushSubscriptions.Add(sub = new PushSubscription { Endpoint = req.Endpoint });
            // A shared device belongs to whoever subscribed last.
            var isAdmin = ctx.User.IsInRole(Roles.Admin);
            int? adminId = isAdmin ? AdminId(ctx.User) : null;
            var personId = isAdmin ? null : AuthEndpoints.EmployeePersonId(ctx.User);
            sub.AdminUserId = adminId;
            sub.PersonId = personId;
            sub.P256dh = req.Keys!.P256dh;
            sub.Auth = req.Keys.Auth;
            sub.CreatedAt = DateTime.UtcNow;
            // A few devices per account are plenty; the oldest go first.
            var stale = await db.PushSubscriptions
                .Where(s => s.Id != sub.Id && (adminId != null ? s.AdminUserId == adminId : s.PersonId == personId))
                .OrderByDescending(s => s.CreatedAt).Skip(MaxDevices - 1).ToListAsync();
            db.PushSubscriptions.RemoveRange(stale);
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // Only the account that owns a device's subscription can remove it.
        g.MapPost("/unsubscribe", async (PushUnsubscribeRequest req, HttpContext ctx, AppDb db) =>
        {
            var isAdmin = ctx.User.IsInRole(Roles.Admin);
            int? adminId = isAdmin ? AdminId(ctx.User) : null;
            var personId = isAdmin ? null : AuthEndpoints.EmployeePersonId(ctx.User);
            await db.PushSubscriptions
                .Where(s => s.Endpoint == req.Endpoint && (adminId != null ? s.AdminUserId == adminId : s.PersonId == personId))
                .ExecuteDeleteAsync();
            return Results.Ok();
        });
    }

    private static IQueryable<object> Project(IQueryable<PantryRequest> q, AppDb db) =>
        q.Select(r => new
        {
            r.Id, r.PersonId, personName = r.Person.Name, r.Note, r.Status, r.CreatedAt, r.HandledAt, r.HandledBy, r.RejectReason,
            r.RemindedAt, r.RemindCount, r.EditedAt, r.EditedBy,
            lines = r.Lines.Select(l => new
            {
                l.ItemId, l.ItemName, l.Quantity,
                // Current price, i.e. what accepting it now would bill.
                unitPrice = db.Items.Where(i => i.Id == l.ItemId).Select(i => (long?)i.Price).FirstOrDefault(),
            }).ToList(),
        });

    // "۲ عدد قهوه" rather than "2 × قهوه": the "×" form gets reordered in right-to-left notifications.
    private static string Describe(PantryRequest r) =>
        string.Join("، ", r.Lines.Select(l => $"{l.Quantity} عدد {l.ItemName}"));

    private static int AdminId(ClaimsPrincipal user) => int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static string FaDigits(string s) => string.Concat(s.Select(c => c is >= '0' and <= '9' ? (char)('۰' + (c - '0')) : c));

    private static string? Clip(string? text)
    {
        text = text?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        return text.Length > MaxNoteLength ? text[..MaxNoteLength] : text;
    }
}
