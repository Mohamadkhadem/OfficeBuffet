using System.Buffers.Binary;
using System.Security.Cryptography;

namespace OfficeBuffet.Services;

/// <summary>
/// Receipt photos live as plain files in a "receipts" folder next to the database (like the login keys),
/// one folder per month: receipts/2026/11/{random}.jpg. The database keeps only that relative path, so
/// photos never make the database bigger or slower, and backing up means copying this folder too.
/// The browser already shrinks a photo (about 1600px, JPEG) before upload; here it is only checked.
/// </summary>
public class ReceiptStore(string root)
{
    public const long MaxBytes = 3 * 1024 * 1024;
    private const int MaxSide = 20_000;

    public string Root { get; } = Path.GetFullPath(root);

    public record Saved(string File, string ContentType, long Bytes, string Sha256);

    /// <summary>Checks an uploaded image without storing it; the error message is for the user, null when acceptable.</summary>
    public static async Task<(byte[]? Data, string? Ext, string? Type, string? Error)> Read(Stream data)
    {
        // Never read more than the limit, whatever the request claimed about its size.
        var buffer = new byte[MaxBytes + 1];
        var length = 0;
        int n;
        while (length < buffer.Length && (n = await data.ReadAsync(buffer.AsMemory(length))) > 0) length += n;
        if (length == 0) return (null, null, null, "عکس فیش را انتخاب کنید.");
        if (length > MaxBytes) return (null, null, null, "حجم عکس حداکثر ۳ مگابایت است.");
        var bytes = buffer.AsSpan(0, length).ToArray();

        // Trust the bytes, not the file name or the browser's content type, and check the whole structure
        // (dimensions, end marker), so a script or web page disguised with an image header is refused.
        var (ext, type) = Detect(bytes);
        if (ext == null) return (null, null, null, "فقط عکس (JPG، PNG یا WebP) قابل قبول است.");
        return (bytes, ext, type, null);
    }

    /// <summary>Stores a checked image under a random name.</summary>
    public async Task<Saved> Save(byte[] data, string ext, string type)
    {
        var now = DateTime.UtcNow;
        var relative = Path.Combine(now.ToString("yyyy"), now.ToString("MM"), $"{Guid.NewGuid():N}{ext}");
        var full = FullPath(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, data);
        return new Saved(relative.Replace('\\', '/'), type, data.Length, Hash(data));
    }

    public static string Hash(byte[] data) => Convert.ToHexStringLower(SHA256.HashData(data));

    /// <summary>Absolute path of a stored receipt; refuses anything outside the receipts folder.</summary>
    public string FullPath(string relative)
    {
        var full = Path.GetFullPath(Path.Combine(Root, relative));
        if (!full.StartsWith(Root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Receipt path outside the receipts folder.");
        return full;
    }

    public void Delete(string relative)
    {
        try { File.Delete(FullPath(relative)); } catch (IOException) { /* already gone or in use; harmless */ }
    }

    private static (string? Ext, string? Type) Detect(byte[] b)
    {
        if (IsJpeg(b)) return (".jpg", "image/jpeg");
        if (IsPng(b)) return (".png", "image/png");
        if (IsWebp(b)) return (".webp", "image/webp");
        return (null, null);
    }

    private static bool SaneSize(int w, int h) => w is > 0 and <= MaxSide && h is > 0 and <= MaxSide;

    /// <summary>SOI, a frame header with sane dimensions, and the EOI marker at the end (zero padding allowed).</summary>
    private static bool IsJpeg(byte[] b)
    {
        if (b.Length < 128 || b[0] != 0xFF || b[1] != 0xD8 || b[2] != 0xFF) return false;
        var end = b.Length;
        while (end > 2 && b[end - 1] == 0) end--;
        if (b[end - 2] != 0xFF || b[end - 1] != 0xD9) return false;
        // Walk the marker segments up to the frame header (SOFn).
        var i = 2;
        while (i + 9 < end)
        {
            if (b[i] != 0xFF) return false;
            var marker = b[i + 1];
            if (marker == 0xFF) { i++; continue; } // fill byte
            if (marker is 0xD8 or 0x01 or (>= 0xD0 and <= 0xD7)) { i += 2; continue; }
            var len = BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(i + 2));
            if (len < 2 || i + 2 + len > end) return false;
            if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
                return SaneSize(BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(i + 7)), BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(i + 5)));
            if (marker == 0xDA) return false; // image data before any frame header
            i += 2 + len;
        }
        return false;
    }

    /// <summary>Signature, IHDR first with sane dimensions, IEND as the last chunk.</summary>
    private static bool IsPng(byte[] b)
    {
        ReadOnlySpan<byte> sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (b.Length < 57 || !b.AsSpan(0, 8).SequenceEqual(sig) || !b.AsSpan(12, 4).SequenceEqual("IHDR"u8)) return false;
        if (!b.AsSpan(b.Length - 8, 4).SequenceEqual("IEND"u8)) return false;
        return SaneSize((int)Math.Min(BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(16)), int.MaxValue),
                        (int)Math.Min(BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(20)), int.MaxValue));
    }

    /// <summary>RIFF/WEBP whose RIFF size matches the file, with a VP8, VP8L or VP8X first chunk.</summary>
    private static bool IsWebp(byte[] b)
    {
        if (b.Length < 30 || !b.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !b.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return false;
        var riff = BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(4));
        if (riff + 8 != b.Length && riff + 9 != b.Length) return false;
        var chunk = b.AsSpan(12, 4);
        return chunk.SequenceEqual("VP8 "u8) || chunk.SequenceEqual("VP8L"u8) || chunk.SequenceEqual("VP8X"u8);
    }
}
