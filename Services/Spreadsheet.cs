using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml.Linq;

namespace OfficeBuffet.Services;

/// <summary>
/// Reads the first sheet of an Excel (.xlsx) or CSV file into rows of text cells.
/// Hand-rolled on purpose: an xlsx is a zip of XML files and only plain cell values are needed.
/// </summary>
public static class Spreadsheet
{
    public const int MaxRows = 5000;

    /// <exception cref="InvalidDataException">The file is not a readable .xlsx or .csv; the message is for the user.</exception>
    public static List<List<string>> Read(Stream file, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        var rows = ext switch
        {
            ".xlsx" or ".xlsm" => ReadXlsx(file),
            ".csv" or ".txt" => ReadCsv(file),
            ".xls" => throw new InvalidDataException("فایل‌های قدیمی .xls پشتیبانی نمی‌شوند؛ در Excel با Save As به‌صورت .xlsx ذخیره کنید."),
            _ => throw new InvalidDataException("فقط فایل Excel (.xlsx) یا CSV قابل خواندن است."),
        };
        // Drop trailing empty rows and cells so the preview only shows real data.
        foreach (var row in rows)
            while (row.Count > 0 && string.IsNullOrWhiteSpace(row[^1])) row.RemoveAt(row.Count - 1);
        while (rows.Count > 0 && rows[^1].Count == 0) rows.RemoveAt(rows.Count - 1);
        if (rows.Count > MaxRows) throw new InvalidDataException($"فایل بیشتر از {MaxRows} ردیف دارد.");
        return rows;
    }

    private static List<List<string>> ReadXlsx(Stream file)
    {
        ZipArchive zip;
        try { zip = new ZipArchive(file, ZipArchiveMode.Read); }
        catch (InvalidDataException) { throw new InvalidDataException("فایل Excel خراب است یا با رمز محافظت شده است."); }
        using (zip)
        {
            var shared = new List<string>();
            var sst = zip.GetEntry("xl/sharedStrings.xml");
            if (sst != null)
                shared = Load(sst).Root!.Elements().Where(e => e.Name.LocalName == "si").Select(TextOf).ToList();

            var sheet = zip.GetEntry(FirstSheetPath(zip)) ?? throw new InvalidDataException("برگه‌ای در فایل Excel پیدا نشد.");
            var rows = new List<List<string>>();
            foreach (var row in Load(sheet).Descendants().Where(e => e.Name.LocalName == "row"))
            {
                // Rows and cells may skip empty positions; place each by its reference ("C7").
                var index = int.TryParse(row.Attribute("r")?.Value, out var r) ? r - 1 : rows.Count;
                if (index >= MaxRows + 1) throw new InvalidDataException($"فایل بیشتر از {MaxRows} ردیف دارد.");
                while (rows.Count <= index) rows.Add([]);
                var cells = rows[index];
                foreach (var c in row.Elements().Where(e => e.Name.LocalName == "c"))
                {
                    var col = ColumnIndex(c.Attribute("r")?.Value) ?? cells.Count;
                    if (col > 200) continue;
                    while (cells.Count <= col) cells.Add("");
                    cells[col] = CellValue(c, shared).Trim();
                }
            }
            return rows;
        }
    }

    private static string FirstSheetPath(ZipArchive zip)
    {
        var workbook = zip.GetEntry("xl/workbook.xml");
        var rels = zip.GetEntry("xl/_rels/workbook.xml.rels");
        if (workbook == null || rels == null) return "xl/worksheets/sheet1.xml";
        var first = Load(workbook).Descendants().FirstOrDefault(e => e.Name.LocalName == "sheet");
        var id = first?.Attributes().FirstOrDefault(a => a.Name.LocalName == "id")?.Value;
        var target = Load(rels).Root!.Elements().FirstOrDefault(e => e.Attribute("Id")?.Value == id)?.Attribute("Target")?.Value;
        if (target == null) return "xl/worksheets/sheet1.xml";
        return target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target;
    }

    private static string CellValue(XElement c, List<string> shared)
    {
        var type = c.Attribute("t")?.Value;
        var v = c.Elements().FirstOrDefault(e => e.Name.LocalName == "v")?.Value ?? "";
        switch (type)
        {
            case "s":
                return int.TryParse(v, out var i) && i >= 0 && i < shared.Count ? shared[i] : "";
            case "inlineStr":
                var inline = c.Elements().FirstOrDefault(e => e.Name.LocalName == "is");
                return inline == null ? "" : TextOf(inline);
            case "str" or "b" or "e":
                return v;
            default:
                // Numbers: "1234567890" or "1.2E+9"; whole numbers are written without decimals or exponent.
                if (decimal.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                    return d == decimal.Truncate(d) ? decimal.Truncate(d).ToString(CultureInfo.InvariantCulture) : d.ToString(CultureInfo.InvariantCulture);
                return v;
        }
    }

    /// <summary>Text of a shared or inline string, including rich-text runs but not phonetic hints.</summary>
    private static string TextOf(XElement si) => string.Concat(si.Descendants()
        .Where(e => e.Name.LocalName == "t" && e.Ancestors().All(a => a.Name.LocalName != "rPh"))
        .Select(e => e.Value));

    private static int? ColumnIndex(string? reference)
    {
        if (string.IsNullOrEmpty(reference)) return null;
        var n = 0;
        foreach (var ch in reference)
        {
            if (ch is < 'A' or > 'Z') break;
            n = n * 26 + (ch - 'A' + 1);
        }
        return n == 0 ? null : n - 1;
    }

    private static XDocument Load(ZipArchiveEntry entry)
    {
        // The upload is untrusted: no DTDs, and a cap on the unzipped size (zip bombs).
        if (entry.Length > 50_000_000) throw new InvalidDataException("فایل Excel بیش از حد بزرگ است.");
        using var s = entry.Open();
        using var reader = System.Xml.XmlReader.Create(s, new System.Xml.XmlReaderSettings { DtdProcessing = System.Xml.DtdProcessing.Prohibit, XmlResolver = null });
        try { return XDocument.Load(reader); }
        catch (System.Xml.XmlException) { throw new InvalidDataException("فایل Excel خراب است."); }
    }

    private static List<List<string>> ReadCsv(Stream file)
    {
        using var ms = new MemoryStream();
        file.CopyTo(ms);
        var bytes = ms.ToArray();
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException)
        {
            // Excel on Persian Windows saves CSV as Windows-1256 unless "CSV UTF-8" is chosen.
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            text = Encoding.GetEncoding(1256).GetString(bytes);
        }
        text = text.TrimStart('﻿');
        var firstLine = text.Split('\n', 2)[0];
        var sep = new[] { ',', ';', '\t', '،' }.MaxBy(c => firstLine.Count(x => x == c));

        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"' && i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                else if (ch == '"') quoted = false;
                else cell.Append(ch);
            }
            else if (ch == '"' && cell.Length == 0) quoted = true;
            else if (ch == sep) { row.Add(cell.ToString().Trim()); cell.Clear(); }
            else if (ch == '\n')
            {
                row.Add(cell.ToString().Trim()); cell.Clear();
                rows.Add(row); row = [];
                if (rows.Count > MaxRows + 1) throw new InvalidDataException($"فایل بیشتر از {MaxRows} ردیف دارد.");
            }
            else if (ch != '\r') cell.Append(ch);
        }
        if (cell.Length > 0 || row.Count > 0) { row.Add(cell.ToString().Trim()); rows.Add(row); }
        return rows;
    }
}
