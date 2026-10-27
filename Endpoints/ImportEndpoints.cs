using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;
using OfficeBuffet.Services;

namespace OfficeBuffet.Endpoints;

/// <summary>
/// Excel/CSV import of items and people. The browser uploads the file once (parse), lets the admin pick which
/// column is which, then sends the mapped rows to preview and, after confirmation, to apply.
/// Re-importing the same file is safe: rows are matched by name (and national code), never added twice.
/// </summary>
public static class ImportEndpoints
{
    private const long MaxFileBytes = 5 * 1024 * 1024;
    private const int MaxNameLength = 80;

    private static class Status
    {
        public const string New = "new", Update = "update", Same = "same", Warn = "warn", Error = "error";
    }

    /// <param name="Changes">Applying this row adds or changes something (a warning may or may not).</param>
    private record RowResult(int Row, string Name, string Value, string Status, string? Message, bool Changes = false);

    public static void MapImport(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/admin/import").RequireAuthorization(Roles.Admin);

        // The raw file is the request body (no multipart form), with its name in the query for the type.
        g.MapPost("/parse", async (string name, HttpRequest request) =>
        {
            if (request.ContentLength > MaxFileBytes) return ApiErrors.Bad("حجم فایل حداکثر ۵ مگابایت است.");
            using var buffer = new MemoryStream();
            await request.Body.CopyToAsync(buffer);
            if (buffer.Length > MaxFileBytes) return ApiErrors.Bad("حجم فایل حداکثر ۵ مگابایت است.");
            buffer.Position = 0;
            try
            {
                var rows = Spreadsheet.Read(buffer, name);
                return rows.Count == 0 ? ApiErrors.Bad("فایل خالی است.") : Results.Ok(new { rows });
            }
            catch (InvalidDataException e) { return ApiErrors.Bad(e.Message); }
        });

        g.MapPost("/items", async (ImportItemsRequest req, AppDb db) =>
        {
            var items = await db.Items.ToListAsync();
            var byName = items.GroupBy(i => Norm(i.Name)).ToDictionary(x => x.Key, x => x.First());
            var seen = new Dictionary<string, int>();
            var results = new List<RowResult>();
            foreach (var r in req.Rows ?? [])
            {
                var name = Norm(r.Name);
                var priceText = r.Price ?? "";
                if (name.Length == 0)
                {
                    if (!string.IsNullOrWhiteSpace(priceText) || !string.IsNullOrWhiteSpace(r.Category))
                        results.Add(new(r.Row, "", priceText, Status.Error, "عنوان خالی است."));
                    continue; // blank line
                }
                if (name.Length > MaxNameLength) { results.Add(new(r.Row, name, priceText, Status.Error, $"عنوان بیشتر از {MaxNameLength} حرف است.")); continue; }
                if (seen.TryGetValue(name, out var first)) { results.Add(new(r.Row, name, priceText, Status.Error, $"تکراری در فایل (همان ردیف {first})؛ ثبت نمی‌شود.")); continue; }
                seen[name] = r.Row;
                if (!TryParsePrice(priceText, out var price)) { results.Add(new(r.Row, name, priceText, Status.Error, $"مبلغ «{priceText}» عدد نیست.")); continue; }
                var category = Norm(r.Category);
                var shown = price == 0 ? "رایگان" : price.ToString("N0", CultureInfo.InvariantCulture);

                if (byName.TryGetValue(name, out var item))
                {
                    var changes = new List<string>();
                    if (item.Price != price) changes.Add($"مبلغ {Money(item.Price)} ← {Money(price)}");
                    if (category.Length > 0 && item.Category != category) changes.Add($"دسته «{category}»");
                    if (changes.Count == 0) { results.Add(new(r.Row, name, shown, Status.Same, "بدون تغییر")); continue; }
                    results.Add(new(r.Row, name, shown, Status.Update, string.Join("، ", changes), true));
                    if (req.Apply)
                    {
                        item.Price = price;
                        if (category.Length > 0) item.Category = category;
                    }
                }
                else
                {
                    results.Add(new(r.Row, name, shown, Status.New, price == 0 ? "کالای رایگان" : null, true));
                    if (req.Apply) db.Items.Add(new Item { Name = name, Category = category, Price = price });
                }
            }
            return await Finish(req.Apply, results, db);
        });

        g.MapPost("/people", async (ImportPeopleRequest req, AppDb db) =>
        {
            var people = await db.People.ToListAsync();
            var byName = people.GroupBy(p => Norm(p.Name)).ToDictionary(x => x.Key, x => x.First());
            var byCode = people.Where(p => p.NationalCode != null).GroupBy(p => p.NationalCode!).ToDictionary(x => x.Key, x => x.First());
            var seenName = new Dictionary<string, int>();
            var seenCode = new Dictionary<string, int>();
            var results = new List<RowResult>();
            foreach (var r in req.Rows ?? [])
            {
                var name = Norm(r.Name);
                var raw = (r.NationalCode ?? "").Trim();
                var code = NationalCode.Normalize(raw);
                // Excel stores codes as numbers and drops leading zeros (0012345678 → 12345678).
                if (code.Length is 8 or 9) code = code.PadLeft(10, '0');
                var shown = code.Length > 0 ? code : raw;
                if (name.Length == 0)
                {
                    if (raw.Length > 0) results.Add(new(r.Row, "", shown, Status.Error, "نام خالی است."));
                    continue; // blank line
                }
                if (name.Length > MaxNameLength) { results.Add(new(r.Row, name, shown, Status.Error, $"نام بیشتر از {MaxNameLength} حرف است.")); continue; }
                if (seenName.TryGetValue(name, out var firstName)) { results.Add(new(r.Row, name, shown, Status.Error, $"نام تکراری در فایل (همان ردیف {firstName})؛ ثبت نمی‌شود.")); continue; }
                seenName[name] = r.Row;
                if (raw.Length > 0 && !NationalCode.IsValid(code)) { results.Add(new(r.Row, name, raw, Status.Error, "کد ملی نامعتبر است (تعداد رقم یا رقم کنترل اشتباه است).")); continue; }
                if (code.Length > 0)
                {
                    if (seenCode.TryGetValue(code, out var firstCode)) { results.Add(new(r.Row, name, shown, Status.Error, $"کد ملی تکراری در فایل (همان ردیف {firstCode}).")); continue; }
                    seenCode[code] = r.Row;
                    if (byCode.TryGetValue(code, out var owner) && Norm(owner.Name) != name)
                    { results.Add(new(r.Row, name, shown, Status.Error, $"این کد ملی قبلاً برای «{owner.Name}» ثبت شده است.")); continue; }
                }

                if (byName.TryGetValue(name, out var person))
                {
                    if (code.Length == 0 || code == person.NationalCode)
                    {
                        results.Add(person.NationalCode == null
                            ? new(r.Row, name, shown, Status.Warn, "قبلاً ثبت شده ولی کد ملی ندارد؛ نمی‌تواند وارد شود.")
                            : new(r.Row, name, shown, Status.Same, "بدون تغییر"));
                        continue;
                    }
                    results.Add(new(r.Row, name, shown, Status.Update, person.NationalCode == null ? "کد ملی اضافه می‌شود" : $"کد ملی {person.NationalCode} ← {code}", true));
                    if (req.Apply) person.NationalCode = code;
                }
                else
                {
                    results.Add(code.Length == 0
                        ? new(r.Row, name, shown, Status.Warn, "بدون کد ملی اضافه می‌شود؛ تا کد ملی ثبت نشود نمی‌تواند وارد شود.", true)
                        : new(r.Row, name, shown, Status.New, null, true));
                    if (req.Apply) db.People.Add(new Person { Name = name, NationalCode = code.Length == 0 ? null : code });
                }
            }
            return await Finish(req.Apply, results, db);
        });
    }

    private static async Task<IResult> Finish(bool apply, List<RowResult> results, AppDb db)
    {
        if (apply) await db.SaveChangesAsync();
        var counts = results.GroupBy(r => r.Status).ToDictionary(x => x.Key, x => x.Count());
        return Results.Ok(new { applied = apply, counts, changes = results.Count(r => r.Changes), rows = results });
    }

    /// <summary>Trims, collapses spaces and unifies Arabic ي/ك with Persian ی/ک, so "چاي" and "چای" are the same item.</summary>
    private static string Norm(string? s) => string.Join(' ', (s ?? "")
        .Replace('ي', 'ی').Replace('ى', 'ی').Replace('ك', 'ک').Replace(' ', ' ')
        .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

    /// <summary>"۲۰٬۰۰۰ تومان", "20,000" or "20000.0" → 20000. Empty means 0, i.e. free.</summary>
    private static bool TryParsePrice(string text, out long price)
    {
        var t = string.IsNullOrWhiteSpace(text) ? "0" : text;
        var digits = new string(t.Replace("تومان", "").Select(c => c switch
        {
            >= '۰' and <= '۹' => (char)('0' + (c - '۰')),
            >= '٠' and <= '٩' => (char)('0' + (c - '٠')),
            _ => c,
        }).Where(c => c is not (',' or '٬' or '،' or ' ' or ' ')).ToArray());
        if (decimal.TryParse(digits, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var d)
            && d >= 0 && d == decimal.Truncate(d) && d < 1_000_000_000_000m)
        {
            price = (long)d;
            return true;
        }
        price = 0;
        return false;
    }

    private static string Money(long n) => n == 0 ? "رایگان" : n.ToString("N0", CultureInfo.InvariantCulture);
}
