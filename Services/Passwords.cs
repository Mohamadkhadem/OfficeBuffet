using System.Security.Cryptography;

namespace OfficeBuffet.Services;

/// <summary>PBKDF2-SHA256 password hashing, stored as "iterations.salt.hash".</summary>
public static class Passwords
{
    /// <summary>OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. Older hashes are upgraded at the next login.</summary>
    private const int Iterations = 600_000;

    /// <summary>Longer input is refused before hashing; nobody types more, and it keeps each attempt cheap.</summary>
    public const int MaxLength = 128;

    // Checked against when the username doesn't exist, so a wrong username takes as long as a wrong password.
    private static readonly Lazy<string> Dummy = new(() => Hash(Convert.ToBase64String(RandomNumberGenerator.GetBytes(12))));

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        if (password.Length > MaxLength) return false;
        var parts = stored.Split('.');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var iterations) || iterations is < 1 or > 10_000_000) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[1]);
            var expected = Convert.FromBase64String(parts[2]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }

    /// <summary>Spends the same time as a real check; for logins with an unknown username.</summary>
    public static void VerifyDummy(string password) => Verify(password.Length > MaxLength ? "" : password, Dummy.Value);

    /// <summary>True when the hash uses fewer iterations than today's setting.</summary>
    public static bool NeedsRehash(string stored) =>
        !int.TryParse(stored.Split('.')[0], out var iterations) || iterations < Iterations;

    public static string NewStamp() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
}
