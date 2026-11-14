using System.Collections.Concurrent;

namespace OfficeBuffet.Services;

/// <summary>
/// Counts failed logins in memory and locks a key (an admin username, or a client IP) for a while after too many.
/// Complements the request rate limiter: that one caps all attempts, this one stops guessing a password or
/// trying national codes one after another. A restart clears it, which is fine for an office server.
/// </summary>
public sealed class LoginGuard
{
    private sealed class Counter
    {
        public int Failures;
        public DateTime WindowStart;
        public DateTime LockedUntil;
    }

    private readonly ConcurrentDictionary<string, Counter> _counters = new();
    private readonly TimeProvider _time;

    public LoginGuard(TimeProvider? time = null) => _time = time ?? TimeProvider.System;

    /// <summary>Seconds until the key may try again, or 0 when it isn't locked.</summary>
    public int LockedFor(string key)
    {
        if (!_counters.TryGetValue(key, out var c)) return 0;
        lock (c)
        {
            var left = c.LockedUntil - Now;
            return left > TimeSpan.Zero ? (int)Math.Ceiling(left.TotalSeconds) : 0;
        }
    }

    /// <summary>Records a failure; locks the key for <paramref name="lockFor"/> once <paramref name="limit"/> failures fall within <paramref name="window"/>.</summary>
    public void Fail(string key, int limit, TimeSpan window, TimeSpan lockFor)
    {
        var c = _counters.GetOrAdd(key, _ => new Counter { WindowStart = Now });
        lock (c)
        {
            var now = Now;
            if (now - c.WindowStart > window) { c.WindowStart = now; c.Failures = 0; }
            if (++c.Failures >= limit)
            {
                c.LockedUntil = now + lockFor;
                c.Failures = 0;
                c.WindowStart = now;
            }
        }
        if (_counters.Count > 10_000) Prune();
    }

    public void Succeed(string key) => _counters.TryRemove(key, out _);

    private DateTime Now => _time.GetUtcNow().UtcDateTime;

    private void Prune()
    {
        var now = Now;
        foreach (var (key, c) in _counters)
            if (c.LockedUntil < now && now - c.WindowStart > TimeSpan.FromHours(1)) _counters.TryRemove(key, out _);
    }
}
