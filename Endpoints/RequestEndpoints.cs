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

            var itemIds = lines.Select(l => l.ItemId).ToList();
            var items = await db.Items.Where(i => itemIds.Contains(i.Id) && i.IsActive).ToDictionaryAsync(i => i.Id);
            if (items.Count != itemIds.Count) return ApiErrors.Bad("یکی از اقلام انتخاب‌شده معتبر یا فعال نیست.");

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
            await db.SaveChangesAsync();
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
            await db.SaveChangesAsync();
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
            }).ToList();
            db.Orders.AddRange(orders);
            request.Status = RequestStatus.Done;
            request.HandledAt = now;
            request.HandledBy = by;
            await db.SaveChangesAsync();

            _ = push.NotifyPerson(request.PersonId, new
            {
                title = "☕ درخواستت دیده شد",
                body = FaDigits($"{Describe(request)} — تا دقایقی دیگر آماده می‌شود."),
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
            await db.SaveChangesAsync();

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
            if (!Uri.TryCreate(req.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps
                || string.IsNullOrEmpty(req.Keys?.P256dh) || string.IsNullOrEmpty(req.Keys.Auth))
                return ApiErrors.Bad("اطلاعات اشتراک اعلان معتبر نیست.");
            var sub = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
            if (sub == null) db.PushSubscriptions.Add(sub = new PushSubscription { Endpoint = req.Endpoint });
            // A shared device belongs to whoever subscribed last.
            var isAdmin = ctx.User.IsInRole(Roles.Admin);
            sub.AdminUserId = isAdmin ? AdminId(ctx.User) : null;
            sub.PersonId = isAdmin ? null : AuthEndpoints.EmployeePersonId(ctx.User);
            sub.P256dh = req.Keys.P256dh;
            sub.Auth = req.Keys.Auth;
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        g.MapPost("/unsubscribe", async (PushUnsubscribeRequest req, AppDb db) =>
        {
            await db.PushSubscriptions.Where(s => s.Endpoint == req.Endpoint).ExecuteDeleteAsync();
            return Results.Ok();
        });
    }

    private static IQueryable<object> Project(IQueryable<PantryRequest> q, AppDb db) =>
        q.Select(r => new
        {
            r.Id, r.PersonId, personName = r.Person.Name, r.Note, r.Status, r.CreatedAt, r.HandledAt, r.HandledBy, r.RejectReason,
            r.RemindedAt, r.RemindCount,
            lines = r.Lines.Select(l => new
            {
                l.ItemId, l.ItemName, l.Quantity,
                // Current price, i.e. what accepting it now would bill.
                unitPrice = db.Items.Where(i => i.Id == l.ItemId).Select(i => (long?)i.Price).FirstOrDefault(),
            }).ToList(),
        });

    private static string Describe(PantryRequest r) =>
        string.Join("، ", r.Lines.Select(l => l.Quantity == 1 ? l.ItemName : $"{l.Quantity} × {l.ItemName}"));

    private static int AdminId(ClaimsPrincipal user) => int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static string FaDigits(string s) => string.Concat(s.Select(c => c is >= '0' and <= '9' ? (char)('۰' + (c - '0')) : c));

    private static string? Clip(string? text)
    {
        text = text?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        return text.Length > MaxNoteLength ? text[..MaxNoteLength] : text;
    }
}
