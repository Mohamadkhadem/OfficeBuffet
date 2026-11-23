using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using OfficeBuffet.Data;
using OfficeBuffet.Services;

namespace OfficeBuffet.Endpoints;

/// <summary>
/// Employees report a payment with a photo of the bank receipt; the manager looks at the photo and approves it
/// (it becomes a <see cref="Payment"/> and the debt goes down) or rejects it with a reason. Payments the manager
/// records directly (AdminEndpoints) need no receipt and count at once.
/// </summary>
public static class PaymentClaimEndpoints
{
    private const int MaxPendingPerPerson = 3;
    private const int MaxNoteLength = 200;
    private const long MaxAmount = 1_000_000_000;
    private const int RecentCount = 30;

    public static void MapPaymentClaims(this IEndpointRouteBuilder app)
    {
        MapEmployee(app.MapGroup("/api/payment-claims").RequireAuthorization(Roles.Employee));
        MapAdmin(app.MapGroup("/api/admin/payment-claims").RequireAuthorization(Roles.Admin));

        // The photo itself: the manager sees any, an employee only their own. The browser keeps a copy but asks
        // every time (a tiny "304 Not Modified" when it has it), so permission is always checked, also after logout.
        app.MapGet("/api/receipts/{id:int}", async (int id, HttpContext ctx, AppDb db, ReceiptStore store) =>
        {
            var claim = await db.PaymentClaims.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
            var own = AuthEndpoints.EmployeePersonId(ctx.User);
            if (claim == null || (own != null && claim.PersonId != own)) return ApiErrors.NotFound("فیش پیدا نشد.");
            var path = store.FullPath(claim.ReceiptFile);
            if (!File.Exists(path)) return ApiErrors.NotFound("فایل این فیش پیدا نشد.");
            ctx.Response.Headers.CacheControl = "private, no-cache";
            ctx.Response.Headers.XContentTypeOptions = "nosniff";
            // Even if a file somehow held a page or script, opened directly it runs nothing and can reach nothing.
            ctx.Response.Headers.ContentSecurityPolicy = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
            ctx.Response.Headers.ContentDisposition = $"inline; filename=\"receipt-{claim.Id}{Path.GetExtension(claim.ReceiptFile)}\"";
            // A stored receipt never changes, so its id and size identify the bytes.
            return Results.File(path, claim.ReceiptContentType,
                entityTag: new EntityTagHeaderValue($"\"r{claim.Id}-{claim.ReceiptBytes}\""));
        }).RequireAuthorization();
    }

    private static void MapEmployee(RouteGroupBuilder g)
    {
        g.MapGet("", async (HttpContext ctx, AppDb db) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            return await Project(db.PaymentClaims.Where(c => c.PersonId == personId)
                .OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id).Take(RecentCount)).ToListAsync();
        });

        // multipart/form-data: receipt (image), amount, cardId (optional), note (optional).
        g.MapPost("", async (HttpContext ctx, AppDb db, ReceiptStore store, WebPush push) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            if (!ctx.Request.HasFormContentType) return ApiErrors.Bad("عکس فیش و مبلغ را بفرستید.");
            if (ctx.Request.ContentLength > MaxUploadBytes) return ApiErrors.Bad("حجم عکس حداکثر ۳ مگابایت است.");
            IFormCollection form;
            try { form = await ctx.Request.ReadFormAsync(); }
            catch (Exception e) when (e is InvalidDataException or BadHttpRequestException or IOException)
            {
                return ApiErrors.Bad("حجم عکس حداکثر ۳ مگابایت است.");
            }
            var file = form.Files.GetFile("receipt");
            if (file == null || file.Length == 0) return ApiErrors.Bad("عکس فیش واریزی را پیوست کنید.");
            if (form.Files.Count > 1) return ApiErrors.Bad("فقط یک عکس فیش بفرستید.");
            if (file.Length > ReceiptStore.MaxBytes) return ApiErrors.Bad("حجم عکس حداکثر ۳ مگابایت است.");
            if (!long.TryParse(form["amount"], NumberStyles.None, CultureInfo.InvariantCulture, out var amount) || amount <= 0 || amount > MaxAmount)
                return ApiErrors.Bad("مبلغ واریزی را درست وارد کنید.");
            int? cardId = int.TryParse(form["cardId"], NumberStyles.None, CultureInfo.InvariantCulture, out var c) ? c : null;
            if (cardId != null && !await db.PaymentCards.AnyAsync(x => x.Id == cardId)) return ApiErrors.Bad("کارت انتخاب‌شده وجود ندارد.");
            if (await db.PaymentClaims.CountAsync(x => x.PersonId == personId && x.Status == ClaimStatus.Pending) >= MaxPendingPerPerson)
                return ApiErrors.Bad($"شما {MaxPendingPerPerson} پرداخت در انتظار بررسی دارید؛ صبر کنید تا بررسی شوند.");

            await using var data = file.OpenReadStream();
            var (bytes, ext, type, error) = await ReceiptStore.Read(data);
            if (error != null) return ApiErrors.Bad(error);
            // The same photo can't pay off a debt twice (a rejected one may be sent again, e.g. with the right amount).
            var sha = ReceiptStore.Hash(bytes!);
            if (await db.PaymentClaims.AnyAsync(x => x.ReceiptSha256 == sha && (x.Status == ClaimStatus.Pending || x.Status == ClaimStatus.Approved)))
                return ApiErrors.Conflict("این عکس فیش قبلاً ثبت شده است؛ برای هر واریز عکس فیش همان واریز را بفرستید.");
            var saved = await store.Save(bytes!, ext!, type!);

            var claim = new PaymentClaim
            {
                PersonId = personId, Amount = amount, PaymentCardId = cardId, Note = Clip(form["note"]),
                ReceiptFile = saved.File, ReceiptContentType = saved.ContentType, ReceiptBytes = saved.Bytes, ReceiptSha256 = saved.Sha256,
            };
            db.PaymentClaims.Add(claim);
            await db.SaveChangesAsync();

            _ = push.NotifyAdmins(new
            {
                title = $"{ctx.User.Identity!.Name} پرداخت ثبت کرد",
                body = FaDigits($"{Money(amount)} — فیش منتظر بررسی است."),
                tag = $"claim-{claim.Id}",
                url = "/#/claims",
            });
            return Results.Ok(new { claim.Id });
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxUploadBytes));

        // Withdrawn before review: nothing was paid on record, so the photo is not kept.
        g.MapPost("/{id:int}/cancel", async (int id, HttpContext ctx, AppDb db, ReceiptStore store) =>
        {
            var personId = AuthEndpoints.EmployeePersonId(ctx.User)!.Value;
            var claim = await db.PaymentClaims.FirstOrDefaultAsync(x => x.Id == id && x.PersonId == personId);
            if (claim == null) return ApiErrors.NotFound("پرداخت پیدا نشد.");
            if (claim.Status != ClaimStatus.Pending) return ApiErrors.Conflict("این پرداخت قبلاً بررسی شده است.");
            claim.Status = ClaimStatus.Cancelled;
            claim.ReviewedAt = DateTime.UtcNow;
            claim.ReviewedBy = ctx.User.Identity!.Name;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این پرداخت همین الان بررسی شد.");
            store.Delete(claim.ReceiptFile);
            return Results.Ok();
        });
    }

    private static void MapAdmin(RouteGroupBuilder g)
    {
        g.MapGet("", async (AppDb db) => new
        {
            pending = await PendingWithLookalikes(db),
            recent = await Project(db.PaymentClaims.Where(c => c.Status == ClaimStatus.Approved || c.Status == ClaimStatus.Rejected)
                .OrderByDescending(c => c.ReviewedAt).ThenByDescending(c => c.Id).Take(RecentCount)).ToListAsync(),
        });

        // Approving records the payment: the person's debt goes down by the amount, on the chosen card.
        g.MapPost("/{id:int}/approve", async (int id, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var claim = await db.PaymentClaims.Include(c => c.Person).FirstOrDefaultAsync(c => c.Id == id);
            if (claim == null) return ApiErrors.NotFound("پرداخت پیدا نشد.");
            if (claim.Status != ClaimStatus.Pending) return ApiErrors.Conflict("این پرداخت قبلاً بررسی شده است.");
            var now = DateTime.UtcNow;
            var by = ctx.User.Identity!.Name!;
            var payment = new Payment
            {
                PersonId = claim.PersonId, Amount = claim.Amount, PaymentCardId = claim.PaymentCardId,
                Note = claim.Note == null ? "با فیش ارسالی" : $"با فیش ارسالی — {claim.Note}", CreatedAt = now, CreatedBy = by,
            };
            db.Payments.Add(payment);
            claim.Payment = payment;
            claim.Status = ClaimStatus.Approved;
            claim.ReviewedAt = now;
            claim.ReviewedBy = by;
            // Status is a concurrency token: if a second click got here first, nothing (not even the payment) is saved.
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این پرداخت همین الان بررسی شد.");

            _ = push.NotifyPerson(claim.PersonId, new
            {
                title = "پرداختت تأیید شد",
                body = FaDigits($"{Money(claim.Amount)} از بدهی‌ات کم شد. ممنون!"),
                tag = $"claim-{claim.Id}",
                url = "/#/pay",
            });
            return Results.Ok(new { personName = claim.Person.Name, claim.Amount });
        });

        // Correct the amount or card of a receipt, before or after approval. After approval the recorded payment is
        // voided (kept in history with the reason) and a corrected one takes its place, on the same date.
        g.MapPut("/{id:int}", async (int id, ClaimEditRequest req, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var claim = await db.PaymentClaims.Include(c => c.Person).Include(c => c.Payment).FirstOrDefaultAsync(c => c.Id == id);
            if (claim == null) return ApiErrors.NotFound("فیش پیدا نشد.");
            if (claim.Status is not (ClaimStatus.Pending or ClaimStatus.Approved))
                return ApiErrors.Conflict("فقط فیش در انتظار یا تأییدشده را می‌شود اصلاح کرد.");
            if (req.Amount <= 0 || req.Amount > MaxAmount) return ApiErrors.Bad("مبلغ را درست وارد کنید.");
            if (req.CardId != null && !await db.PaymentCards.AnyAsync(x => x.Id == req.CardId)) return ApiErrors.Bad("کارت انتخاب‌شده وجود ندارد.");
            if (req.Amount == claim.Amount && req.CardId == claim.PaymentCardId) return ApiErrors.Bad("چیزی تغییر نکرده است.");
            var reason = Clip(req.Reason);
            var approved = claim.Status == ClaimStatus.Approved;
            if (approved && reason == null) return ApiErrors.Bad("دلیل اصلاح را بنویسید؛ در سابقه‌ی پرداخت می‌ماند.");
            if (approved && await SettledAfter(db, claim) is { } settledUntil)
                return ApiErrors.Conflict($"حساب این شخص تا {FaDigits(settledUntil)} تسویه شده و این پرداخت جزو آن است؛ اول آن تسویه را ابطال کنید.");

            var now = DateTime.UtcNow;
            var by = ctx.User.Identity!.Name!;
            var before = $"{Money(claim.Amount)}{(claim.PaymentCardId == null ? "" : $" (کارت {claim.PaymentCardId})")}";
            var after = $"{Money(req.Amount)}{(req.CardId == null ? "" : $" (کارت {req.CardId})")}";
            await using var tx = await db.Database.BeginTransactionAsync();
            if (approved && claim.Payment is { VoidedAt: null } old)
            {
                // Only one of two simultaneous corrections may void the payment.
                var voided = await db.Payments.Where(p => p.Id == old.Id && p.VoidedAt == null).ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.VoidedAt, now).SetProperty(p => p.VoidedBy, by)
                    .SetProperty(p => p.VoidReason, Clip($"اصلاح فیش: {before} ← {after} — {reason}")));
                if (voided == 0) return ApiErrors.Conflict("این فیش همین الان اصلاح شد؛ صفحه را تازه کنید.");
            }
            if (approved)
            {
                var payment = new Payment
                {
                    PersonId = claim.PersonId, Amount = req.Amount, PaymentCardId = req.CardId,
                    Note = claim.Note == null ? "با فیش ارسالی (اصلاح‌شده)" : $"با فیش ارسالی (اصلاح‌شده) — {claim.Note}",
                    CreatedAt = claim.Payment?.CreatedAt ?? now, CreatedBy = by,
                };
                db.Payments.Add(payment);
                claim.Payment = payment;
            }
            claim.OriginalAmount ??= claim.Amount;
            claim.Amount = req.Amount;
            claim.PaymentCardId = req.CardId;
            claim.EditedAt = now;
            claim.EditedBy = by;
            Audit.Add(db, ctx, "claim.edit", $"فیش {claim.Id} «{claim.Person.Name}»: {before} ← {after}{(reason == null ? "" : $" — {reason}")}");
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این فیش همین الان بررسی شد؛ صفحه را تازه کنید.");
            await tx.CommitAsync();

            _ = push.NotifyPerson(claim.PersonId, new
            {
                title = "مبلغ فیشت اصلاح شد",
                body = FaDigits(approved ? $"مبلغ ثبت‌شده: {Money(req.Amount)} — {reason}" : $"مبلغ فیش: {Money(req.Amount)}؛ هنوز در انتظار بررسی است."),
                tag = $"claim-{claim.Id}",
                url = "/#/pay",
            });
            return Results.Ok(new { claim.Amount });
        });

        // Undo a review: an approved receipt's payment is voided (kept in history) and it goes back to the queue,
        // where it can be approved again, corrected or rejected. A rejected one simply goes back to the queue.
        g.MapPost("/{id:int}/reopen", async (int id, VoidRequest req, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var claim = await db.PaymentClaims.Include(c => c.Person).Include(c => c.Payment).FirstOrDefaultAsync(c => c.Id == id);
            if (claim == null) return ApiErrors.NotFound("فیش پیدا نشد.");
            if (claim.Status is not (ClaimStatus.Approved or ClaimStatus.Rejected))
                return ApiErrors.Conflict("فقط فیش تأییدشده یا ردشده را می‌شود برگرداند.");
            var reason = Clip(req.Reason);
            var approved = claim.Status == ClaimStatus.Approved;
            if (approved && reason == null) return ApiErrors.Bad("دلیل برگرداندن را بنویسید؛ در سابقه‌ی پرداخت می‌ماند.");
            if (approved && await SettledAfter(db, claim) is { } settledUntil)
                return ApiErrors.Conflict($"حساب این شخص تا {FaDigits(settledUntil)} تسویه شده و این پرداخت جزو آن است؛ اول آن تسویه را ابطال کنید.");

            var now = DateTime.UtcNow;
            var by = ctx.User.Identity!.Name!;
            await using var tx = await db.Database.BeginTransactionAsync();
            if (claim.Payment is { VoidedAt: null } payment)
                await db.Payments.Where(p => p.Id == payment.Id && p.VoidedAt == null).ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.VoidedAt, now).SetProperty(p => p.VoidedBy, by)
                    .SetProperty(p => p.VoidReason, Clip($"برگرداندن تأیید فیش — {reason}")));
            claim.Status = ClaimStatus.Pending;
            claim.PaymentId = null;
            claim.Payment = null;
            claim.RejectReason = null;
            claim.ReviewedAt = null;
            claim.ReviewedBy = null;
            Audit.Add(db, ctx, "claim.reopen", $"فیش {claim.Id} «{claim.Person.Name}» {Money(claim.Amount)} ({(approved ? "تأییدشده" : "ردشده")}){(reason == null ? "" : $" — {reason}")}");
            // Status is the concurrency token: of two simultaneous undos (or undo + another action) only one wins.
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این فیش همین الان تغییر کرد؛ صفحه را تازه کنید.");
            await tx.CommitAsync();

            if (approved)
                _ = push.NotifyPerson(claim.PersonId, new
                {
                    title = "تأیید فیشت برگردانده شد",
                    body = FaDigits($"{Money(claim.Amount)} دوباره در انتظار بررسی است — {reason}"),
                    tag = $"claim-{claim.Id}",
                    url = "/#/pay",
                });
            return Results.Ok();
        });

        g.MapPost("/{id:int}/reject", async (int id, VoidRequest req, HttpContext ctx, AppDb db, WebPush push) =>
        {
            var claim = await db.PaymentClaims.FirstOrDefaultAsync(c => c.Id == id);
            if (claim == null) return ApiErrors.NotFound("پرداخت پیدا نشد.");
            if (claim.Status != ClaimStatus.Pending) return ApiErrors.Conflict("این پرداخت قبلاً بررسی شده است.");
            var reason = Clip(req.Reason);
            if (reason == null) return ApiErrors.Bad("دلیل رد را بنویسید تا همکار بداند چه کند.");
            claim.Status = ClaimStatus.Rejected;
            claim.RejectReason = reason;
            claim.ReviewedAt = DateTime.UtcNow;
            claim.ReviewedBy = ctx.User.Identity!.Name;
            if (!await db.SaveIfUnchanged()) return ApiErrors.Conflict("این پرداخت همین الان بررسی شد.");

            _ = push.NotifyPerson(claim.PersonId, new
            {
                title = "پرداختت تأیید نشد",
                body = FaDigits($"{Money(claim.Amount)} — دلیل: {reason}"),
                tag = $"claim-{claim.Id}",
                url = "/#/pay",
            });
            return Results.Ok();
        });
    }

    private record ClaimRow(int Id, int PersonId, string PersonName, long Amount, int? PaymentCardId, string? CardTitle,
        string? Note, string Status, DateTime CreatedAt, DateTime? ReviewedAt, string? ReviewedBy, string? RejectReason,
        long ReceiptBytes, int? PaymentId, long? OriginalAmount, DateTime? EditedAt, string? EditedBy)
    {
        /// <summary>Admin list only: a similar claim (see <see cref="PendingWithLookalikes"/>).</summary>
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public int? LookalikeId { get; init; }
    }

    private static IQueryable<ClaimRow> Project(IQueryable<PaymentClaim> q) =>
        q.Select(c => new ClaimRow(c.Id, c.PersonId, c.Person.Name, c.Amount, c.PaymentCardId, c.PaymentCard!.Title,
            c.Note, c.Status, c.CreatedAt, c.ReviewedAt, c.ReviewedBy, c.RejectReason, c.ReceiptBytes, c.PaymentId,
            c.OriginalAmount, c.EditedAt, c.EditedBy));

    /// <summary>
    /// The label of a settlement that already closed the period of this receipt's payment, if any: changing that
    /// payment would silently change a closed account, so the settlement has to be voided first.
    /// </summary>
    private static async Task<string?> SettledAfter(AppDb db, PaymentClaim claim)
    {
        if (claim.Payment == null) return null;
        var at = claim.Payment.CreatedAt;
        return await db.Settlements.Where(s => s.PersonId == claim.PersonId && s.VoidedAt == null && s.Until > at)
            .OrderByDescending(s => s.Until).Select(s => s.UntilLabel).FirstOrDefaultAsync();
    }

    /// <summary>
    /// Pending claims, each with <c>lookalikeId</c>: another pending or approved claim of the same person for the same
    /// amount within a week, so the manager notices a payment reported twice with two different photos.
    /// </summary>
    private static async Task<List<object>> PendingWithLookalikes(AppDb db)
    {
        var pending = await db.PaymentClaims.Where(c => c.Status == ClaimStatus.Pending)
            .Select(c => new { c.PersonId, c.CreatedAt }).ToListAsync();
        var people = pending.Select(c => c.PersonId).Distinct().ToList();
        var since = pending.Count == 0 ? DateTime.UtcNow : pending.Min(c => c.CreatedAt).AddDays(-LookalikeDays);
        var others = await db.PaymentClaims
            .Where(c => people.Contains(c.PersonId) && c.CreatedAt >= since && (c.Status == ClaimStatus.Pending || c.Status == ClaimStatus.Approved))
            .Select(c => new { c.Id, c.PersonId, c.Amount, c.CreatedAt }).ToListAsync();
        var rows = await Project(db.PaymentClaims.Where(c => c.Status == ClaimStatus.Pending).OrderBy(c => c.CreatedAt).ThenBy(c => c.Id)).ToListAsync();
        return rows.Select(r => r with
        {
            LookalikeId = others.FirstOrDefault(o => o.Id != r.Id && o.PersonId == r.PersonId && o.Amount == r.Amount
                && Math.Abs((o.CreatedAt - r.CreatedAt).TotalDays) <= LookalikeDays)?.Id,
        }).ToList<object>();
    }

    private const int LookalikeDays = 7;
    private const long MaxUploadBytes = ReceiptStore.MaxBytes + 64 * 1024;

    private static string Money(long amount) => $"{amount.ToString("N0", CultureInfo.InvariantCulture)} تومان";

    private static string FaDigits(string s) => string.Concat(s.Select(ch => ch is >= '0' and <= '9' ? (char)('۰' + (ch - '0')) : ch));

    private static string? Clip(string? text)
    {
        text = text?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        return text.Length > MaxNoteLength ? text[..MaxNoteLength] : text;
    }
}
