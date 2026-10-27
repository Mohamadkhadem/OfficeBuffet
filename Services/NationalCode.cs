namespace OfficeBuffet.Services;

/// <summary>Iranian national code (کد ملی) helpers.</summary>
public static class NationalCode
{
    /// <summary>Keeps only the digits (Latin, Persian or Arabic-Indic), so "۰۰۱-۲۳۴..." becomes "001234...".</summary>
    public static string Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "";
        var chars = new List<char>(10);
        foreach (var c in input)
        {
            if (c is >= '0' and <= '9') chars.Add(c);
            else if (c is >= '۰' and <= '۹') chars.Add((char)('0' + (c - '۰')));
            else if (c is >= '٠' and <= '٩') chars.Add((char)('0' + (c - '٠')));
        }
        return new string(chars.ToArray());
    }

    /// <summary>Standard check-digit rule; catches most typos when the admin enters a code.</summary>
    public static bool IsValid(string code)
    {
        if (code.Length != 10 || !code.All(char.IsAsciiDigit) || code.Distinct().Count() == 1) return false;
        var sum = 0;
        for (var i = 0; i < 9; i++) sum += (code[i] - '0') * (10 - i);
        var r = sum % 11;
        var check = code[9] - '0';
        return r < 2 ? check == r : check == 11 - r;
    }
}
