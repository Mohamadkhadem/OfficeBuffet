using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using OfficeBuffet.Data;

namespace OfficeBuffet.Services;

/// <summary>
/// Minimal Web Push sender: RFC 8291 payload encryption ("aes128gcm") and RFC 8292 VAPID, so no
/// third-party package is needed. The VAPID key pair is created on first run and kept next to the
/// database; losing it only means every device has to turn notifications on again.
/// </summary>
public sealed class WebPush
{
    private static readonly ECCurve P256 = ECCurve.NamedCurves.nistP256;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly ECDsa _vapid;
    private readonly string _subject;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<WebPush> _log;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };

    /// <summary>VAPID public key (base64url, uncompressed P-256 point) the browser subscribes with.</summary>
    public string PublicKey { get; }

    public WebPush(string keyFile, string subject, IServiceScopeFactory scopes, ILogger<WebPush> log)
    {
        _vapid = LoadOrCreateKey(keyFile);
        PublicKey = Base64Url.EncodeToString(Point(_vapid.ExportParameters(false).Q));
        _subject = subject;
        _scopes = scopes;
        _log = log;
    }

    /// <summary>
    /// Sends the message to every admin device (or only one admin's) and drops subscriptions the
    /// push service reports as gone. Never throws: a failed notification must not fail the request.
    /// </summary>
    public Task<(int Sent, int Failed)> NotifyAdmins(object message, int? adminUserId = null) =>
        Notify(message, s => s.AdminUserId != null && (adminUserId == null || s.AdminUserId == adminUserId));

    /// <summary>Sends to the devices where this employee turned notifications on.</summary>
    public Task<(int Sent, int Failed)> NotifyPerson(int personId, object message) =>
        Notify(message, s => s.PersonId == personId);

    private async Task<(int Sent, int Failed)> Notify(object message, System.Linq.Expressions.Expression<Func<PushSubscription, bool>> to)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            var subs = await db.PushSubscriptions.Where(to).ToListAsync();
            var payload = JsonSerializer.SerializeToUtf8Bytes(message, Json);
            var statuses = await Task.WhenAll(subs.Select(s => Send(s, payload)));

            var gone = subs.Where((_, i) => statuses[i] is 404 or 410).ToList();
            if (gone.Count > 0)
            {
                db.PushSubscriptions.RemoveRange(gone);
                await db.SaveChangesAsync();
            }
            var sent = statuses.Count(s => s is >= 200 and < 300);
            return (sent, statuses.Length - sent);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Sending push notifications failed");
            return (0, 0);
        }
    }

    private async Task<int> Send(PushSubscription sub, byte[] payload)
    {
        try
        {
            var endpoint = new Uri(sub.Endpoint);
            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new ByteArrayContent(Encrypt(Base64Url.DecodeFromChars(sub.P256dh), Base64Url.DecodeFromChars(sub.Auth), payload)),
            };
            req.Content.Headers.ContentType = new("application/octet-stream");
            req.Content.Headers.ContentEncoding.Add("aes128gcm");
            req.Headers.Add("TTL", "86400");
            req.Headers.Add("Urgency", "high");
            req.Headers.TryAddWithoutValidation("Authorization", $"vapid t={VapidToken(endpoint)}, k={PublicKey}");

            using var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
                _log.LogWarning("Push to {Host} failed: {Status} {Body}", endpoint.Host, (int)res.StatusCode, await res.Content.ReadAsStringAsync());
            return (int)res.StatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning("Push to {Endpoint} failed: {Error}", sub.Endpoint, ex.Message);
            return 0;
        }
    }

    /// <summary>RFC 8292: a short-lived ES256 JWT for the push service's origin.</summary>
    private string VapidToken(Uri endpoint)
    {
        var header = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new { typ = "JWT", alg = "ES256" }));
        var claims = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new
        {
            aud = endpoint.GetLeftPart(UriPartial.Authority),
            exp = DateTimeOffset.UtcNow.AddHours(12).ToUnixTimeSeconds(),
            sub = _subject,
        }));
        var unsigned = $"{header}.{claims}";
        // .NET signs in IEEE P1363 (r || s) format, which is what JWS ES256 expects.
        var signature = _vapid.SignData(Encoding.ASCII.GetBytes(unsigned), HashAlgorithmName.SHA256);
        return $"{unsigned}.{Base64Url.EncodeToString(signature)}";
    }

    /// <summary>RFC 8291 encryption of one message as a single aes128gcm record.</summary>
    public static byte[] Encrypt(byte[] uaPublic, byte[] authSecret, byte[] plaintext)
    {
        using var ua = ECDiffieHellman.Create(new ECParameters { Curve = P256, Q = new ECPoint { X = uaPublic[1..33], Y = uaPublic[33..65] } });
        using var local = ECDiffieHellman.Create(P256);
        var asPublic = Point(local.ExportParameters(false).Q);
        var shared = local.DeriveRawSecretAgreement(ua.PublicKey);
        var salt = RandomNumberGenerator.GetBytes(16);

        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, authSecret, [.. "WebPush: info\0"u8, .. uaPublic, .. asPublic]);
        var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, "Content-Encoding: nonce\0"u8.ToArray());

        byte[] record = [.. plaintext, 0x02]; // 0x02 = last (and only) record, no padding
        var cipher = new byte[record.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(cek, 16)) aes.Encrypt(nonce, record, cipher, tag);

        var recordSize = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(recordSize, 4096);
        return [.. salt, .. recordSize, (byte)asPublic.Length, .. asPublic, .. cipher, .. tag];
    }

    private static ECDsa LoadOrCreateKey(string file)
    {
        if (File.Exists(file))
        {
            var saved = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file))!;
            var pub = Base64Url.DecodeFromChars(saved["publicKey"]);
            return ECDsa.Create(new ECParameters
            {
                Curve = P256,
                D = Base64Url.DecodeFromChars(saved["privateKey"]),
                Q = new ECPoint { X = pub[1..33], Y = pub[33..65] },
            });
        }
        var key = ECDsa.Create(P256);
        var p = key.ExportParameters(true);
        File.WriteAllText(file, JsonSerializer.Serialize(new { publicKey = Base64Url.EncodeToString(Point(p.Q)), privateKey = Base64Url.EncodeToString(p.D) }));
        return key;
    }

    private static byte[] Point(ECPoint q) => [0x04, .. q.X!, .. q.Y!];
}
