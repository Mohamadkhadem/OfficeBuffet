using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;

namespace OfficeBuffet.Services;

/// <summary>
/// The money unit shown everywhere (تومان or ریال), chosen by the pantry supervisor. Amounts are always stored in
/// toman; only display and input change, so switching the unit never changes a balance.
/// </summary>
public static class Currency
{
    public const string SettingKey = "currency";
    public const string Toman = "toman", Rial = "rial";

    public static async Task<string> Get(AppDb db) =>
        await db.Settings.Where(s => s.Key == SettingKey).Select(s => s.Value).FirstOrDefaultAsync() == Rial ? Rial : Toman;

    public static async Task<bool> IsRial(AppDb db) => await Get(db) == Rial;

    public static string UnitName(bool rial) => rial ? "ریال" : "تومان";

    /// <summary>A toman amount in the shown unit, with separators: 12500 → "12,500" (toman) or "125,000" (rial).</summary>
    public static string Number(long toman, bool rial) => (rial ? toman * 10 : toman).ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>"12,500 تومان" / "125,000 ریال".</summary>
    public static string Format(long toman, bool rial) => $"{Number(toman, rial)} {UnitName(rial)}";
}
