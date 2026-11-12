using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.StreamFlix.Configuration;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Issues and validates the signed household sessions that StreamFlix hands out after a Google sign-in has been
/// verified server-side. The browser stores the opaque token and sends it back in the <c>X-StreamFlix-Session</c>
/// header; every privileged StreamFlix endpoint re-validates it, so the Google gate can no longer be skipped by
/// editing localStorage or calling the API directly.
/// </summary>
public static class StreamFlixSessionService
{
    public const string HeaderName = "X-StreamFlix-Session";

    private const int MaxPinFailures = 5;

    private static readonly TimeSpan PinLockout = TimeSpan.FromMinutes(5);

    private static readonly ConcurrentDictionary<string, PinAttemptState> PinAttempts = new(StringComparer.OrdinalIgnoreCase);

    private static readonly object KeyLock = new();

    /// <summary>
    /// A validated household session.
    /// </summary>
    public sealed record SessionInfo(string Email, DateTimeOffset ExpiresAt);

    /// <summary>
    /// Returns true when the email is on the allowlist or is the Google lock of any profile.
    /// </summary>
    public static bool IsEmailApproved(PluginConfiguration config, string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        var normalized = email.Trim();
        return (config.ApprovedGoogleAccounts ?? new())
                .Any(a => string.Equals(a?.Trim(), normalized, StringComparison.OrdinalIgnoreCase))
            || (config.Profiles ?? new())
                .Any(p => !string.IsNullOrWhiteSpace(p.GoogleAccountEmail)
                    && string.Equals(p.GoogleAccountEmail.Trim(), normalized, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Issues a new signed session for a verified Google email.
    /// </summary>
    public static SessionInfo Issue(PluginConfiguration config, string email, out string token)
    {
        var key = GetOrCreateKey(config);
        var lifetimeDays = Math.Clamp(config.SessionLifetimeDays <= 0 ? 30 : config.SessionLifetimeDays, 1, 365);
        var expires = DateTimeOffset.UtcNow.AddDays(lifetimeDays);

        var payload = JsonSerializer.SerializeToUtf8Bytes(new SessionPayload
        {
            E = email.Trim().ToLowerInvariant(),
            X = expires.ToUnixTimeSeconds(),
            V = config.SessionVersion,
            N = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
        });

        var body = Base64UrlEncode(payload);
        var sig = Base64UrlEncode(Sign(key, body));
        token = body + "." + sig;
        return new SessionInfo(email.Trim().ToLowerInvariant(), expires);
    }

    /// <summary>
    /// Validates a session token. Returns null when it is missing, forged, expired, revoked, or the email
    /// has since been removed from the allowlist.
    /// </summary>
    public static SessionInfo? Validate(PluginConfiguration config, string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(config.SessionSigningKey))
        {
            return null;
        }

        var parts = token.Trim().Split('.');
        if (parts.Length != 2)
        {
            return null;
        }

        try
        {
            var key = Convert.FromBase64String(config.SessionSigningKey);
            var expected = Sign(key, parts[0]);
            var provided = Base64UrlDecode(parts[1]);
            if (!CryptographicOperations.FixedTimeEquals(expected, provided))
            {
                return null;
            }

            var payload = JsonSerializer.Deserialize<SessionPayload>(Base64UrlDecode(parts[0]));
            if (payload == null || string.IsNullOrWhiteSpace(payload.E) || payload.V != config.SessionVersion)
            {
                return null;
            }

            var expires = DateTimeOffset.FromUnixTimeSeconds(payload.X);
            if (expires <= DateTimeOffset.UtcNow)
            {
                return null;
            }

            if (!IsEmailApproved(config, payload.E))
            {
                return null;
            }

            return new SessionInfo(payload.E, expires);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Masks an email for display to users who are not signed in as it, e.g. <c>u•••r@example.com</c>.
    /// </summary>
    public static string MaskEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return string.Empty;
        }

        var at = email.IndexOf('@');
        if (at <= 0)
        {
            return "•••";
        }

        var local = email.Substring(0, at);
        var domain = email.Substring(at);
        return local.Length <= 2
            ? local[0] + "•••" + domain
            : local[0] + "•••" + local[^1] + domain;
    }

    /// <summary>
    /// Compares two PIN strings in constant time without leaking PIN length (4-8 digits).
    /// </summary>
    public static bool ConstantTimePinEquals(string expectedPin, string suppliedPin)
    {
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expectedPin.Trim()));
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(suppliedPin.Trim()));
        return CryptographicOperations.FixedTimeEquals(expectedHash, suppliedHash);
    }

    /// <summary>
    /// Returns true if PIN attempts for this key are currently locked out after repeated failures.
    /// </summary>
    public static bool IsPinLockedOut(string key, out TimeSpan retryAfter)
    {
        retryAfter = TimeSpan.Zero;
        if (PinAttempts.TryGetValue(key, out var st))
        {
            var now = DateTimeOffset.UtcNow;
            if (st.LockedUntil > now)
            {
                retryAfter = st.LockedUntil - now;
                return true;
            }

            if (st.LockedUntil > DateTimeOffset.MinValue && st.LockedUntil <= now)
            {
                PinAttempts.TryRemove(key, out _);
            }
        }

        return false;
    }

    public static void RegisterPinFailure(string key)
    {
        PruneExpiredPinAttemptsIfNeeded();
        var now = DateTimeOffset.UtcNow;
        PinAttempts.AddOrUpdate(
            key,
            _ => new PinAttemptState(1, DateTimeOffset.MinValue, now),
            (_, st) =>
            {
                var failures = st.LockedUntil > DateTimeOffset.MinValue && st.LockedUntil <= now ? 1 : st.Failures + 1;
                return failures >= MaxPinFailures
                    ? new PinAttemptState(0, now.Add(PinLockout), now)
                    : new PinAttemptState(failures, DateTimeOffset.MinValue, now);
            });
    }

    public static void ResetPinFailures(string key)
    {
        PinAttempts.TryRemove(key, out _);
    }

    private static void PruneExpiredPinAttemptsIfNeeded()
    {
        if (PinAttempts.Count < 256)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var staleCutoff = now - TimeSpan.FromHours(1);
        foreach (var kvp in PinAttempts)
        {
            var st = kvp.Value;
            if ((st.LockedUntil > DateTimeOffset.MinValue && st.LockedUntil <= now)
                || (st.LockedUntil == DateTimeOffset.MinValue && st.UpdatedAt <= staleCutoff))
            {
                PinAttempts.TryRemove(kvp.Key, out _);
            }
        }
    }

    private static byte[] GetOrCreateKey(PluginConfiguration config)
    {
        lock (KeyLock)
        {
            if (string.IsNullOrWhiteSpace(config.SessionSigningKey))
            {
                config.SessionSigningKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
                if (config.SessionVersion <= 0)
                {
                    config.SessionVersion = 1;
                }

                Plugin.Instance?.SaveConfiguration();
            }

            return Convert.FromBase64String(config.SessionSigningKey);
        }
    }

    private static byte[] Sign(byte[] key, string body)
    {
        using var hmac = new HMACSHA256(key);
        return hmac.ComputeHash(Encoding.ASCII.GetBytes(body));
    }

    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static byte[] Base64UrlDecode(string data)
    {
        var s = data.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
        }

        return Convert.FromBase64String(s);
    }

    private sealed record PinAttemptState(int Failures, DateTimeOffset LockedUntil, DateTimeOffset UpdatedAt);

    private sealed class SessionPayload
    {
        public string E { get; set; } = string.Empty;

        public long X { get; set; }

        public int V { get; set; }

        public string N { get; set; } = string.Empty;
    }
}
