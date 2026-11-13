using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.StreamFlix.Configuration;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Issues and validates the signed household sessions that StreamFlix hands out after Google sign-in,
/// Standard Jellyfin sign-in, or Administrator fallback sign-in has been verified server-side.
/// </summary>
public static class StreamFlixSessionService
{
    public const string HeaderName = "X-StreamFlix-Session";
    public const string AuthKindGoogle = "google";
    public const string AuthKindJellyfin = "jellyfin";
    public const string AuthKindJellyfinAdmin = "jellyfin_admin";

    private const int MaxPinFailures = 5;
    private const int MaxLoginFailures = 6;

    private static readonly TimeSpan PinLockout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan LoginLockout = TimeSpan.FromMinutes(5);

    private static readonly ConcurrentDictionary<string, PinAttemptState> PinAttempts = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, PinAttemptState> LoginAttempts = new(StringComparer.OrdinalIgnoreCase);

    private static readonly object KeyLock = new();

    /// <summary>
    /// A validated household session.
    /// </summary>
    public sealed record SessionInfo(
        string Email,
        DateTimeOffset ExpiresAt,
        string AuthKind = AuthKindGoogle,
        string? JellyfinUserId = null,
        string? Username = null);

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
        var normalizedEmail = email.Trim().ToLowerInvariant();

        var payload = JsonSerializer.SerializeToUtf8Bytes(new SessionPayload
        {
            K = AuthKindGoogle,
            E = normalizedEmail,
            X = expires.ToUnixTimeSeconds(),
            V = config.SessionVersion,
            N = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
        });

        var body = Base64UrlEncode(payload);
        var sig = Base64UrlEncode(Sign(key, body));
        token = body + "." + sig;
        return new SessionInfo(normalizedEmail, expires, AuthKindGoogle, null, null);
    }

    /// <summary>
    /// Issues a new signed household session backed by a server-verified Jellyfin user login
    /// (<see cref="AuthKindJellyfin"/> or <see cref="AuthKindJellyfinAdmin"/>).
    /// </summary>
    public static SessionInfo IssueJellyfinSession(
        PluginConfiguration config,
        string authKind,
        string jellyfinUserId,
        string username,
        out string token)
    {
        var key = GetOrCreateKey(config);
        var lifetimeDays = Math.Clamp(config.SessionLifetimeDays <= 0 ? 30 : config.SessionLifetimeDays, 1, 365);
        var expires = DateTimeOffset.UtcNow.AddDays(lifetimeDays);
        var cleanKind = string.Equals(authKind, AuthKindJellyfinAdmin, StringComparison.Ordinal)
            ? AuthKindJellyfinAdmin
            : AuthKindJellyfin;

        var payload = JsonSerializer.SerializeToUtf8Bytes(new SessionPayload
        {
            K = cleanKind,
            E = string.Empty,
            U = jellyfinUserId.Trim(),
            Un = username.Trim(),
            X = expires.ToUnixTimeSeconds(),
            V = config.SessionVersion,
            N = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
        });

        var body = Base64UrlEncode(payload);
        var sig = Base64UrlEncode(Sign(key, body));
        token = body + "." + sig;
        return new SessionInfo(string.Empty, expires, cleanKind, jellyfinUserId.Trim(), username.Trim());
    }

    /// <summary>
    /// Validates a session token. Returns null when it is missing, forged, expired, revoked, or no longer permitted.
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
            if (payload == null || payload.V != config.SessionVersion)
            {
                return null;
            }

            var expires = DateTimeOffset.FromUnixTimeSeconds(payload.X);
            if (expires <= DateTimeOffset.UtcNow)
            {
                return null;
            }

            var kind = string.IsNullOrWhiteSpace(payload.K) ? AuthKindGoogle : payload.K;
            if (string.Equals(kind, AuthKindGoogle, StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(payload.E) || !IsEmailApproved(config, payload.E))
                {
                    return null;
                }

                return new SessionInfo(payload.E, expires, AuthKindGoogle, null, null);
            }

            if (string.Equals(kind, AuthKindJellyfin, StringComparison.Ordinal))
            {
                if (!config.AllowStandardJellyfinLogin || string.IsNullOrWhiteSpace(payload.U))
                {
                    return null;
                }

                return new SessionInfo(string.Empty, expires, AuthKindJellyfin, payload.U, payload.Un);
            }

            if (string.Equals(kind, AuthKindJellyfinAdmin, StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(payload.U))
                {
                    return null;
                }

                return new SessionInfo(string.Empty, expires, AuthKindJellyfinAdmin, payload.U, payload.Un);
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Determines whether an incoming HTTP request originates from a private/loopback local LAN IP address.
    /// Rejects external WAN clients even if they spoof forwarded headers, and detects reverse-proxied WAN clients
    /// when a local proxy forwards an external <c>X-Forwarded-For</c>, <c>X-Real-IP</c>, or <c>CF-Connecting-IP</c>.
    /// </summary>
    public static bool IsLocalLanRequest(HttpContext? httpContext)
    {
        var remoteIp = httpContext?.Connection?.RemoteIpAddress;
        if (remoteIp == null || !IsPrivateOrLoopbackIp(remoteIp))
        {
            return false;
        }

        var headers = httpContext!.Request.Headers;
        foreach (var headerName in new[] { "CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP" })
        {
            var raw = headers[headerName].ToString();
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var candidate = StripOptionalPort(part);
                if (!IPAddress.TryParse(candidate, out var forwardedIp) || !IsPrivateOrLoopbackIp(forwardedIp))
                {
                    return false;
                }
            }
        }

        return true;
    }

    public static bool IsPrivateOrLoopbackIp(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip))
        {
            return true;
        }

        if (ip.IsIPv4MappedToIPv6)
        {
            ip = ip.MapToIPv4();
        }

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return b[0] == 10
                || b[0] == 127
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 169 && b[1] == 254);
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal)
            {
                return true;
            }

            var b = ip.GetAddressBytes();
            // RFC 4193 Unique Local Addresses: fc00::/7
            return (b[0] & 0xFE) == 0xFC;
        }

        return false;
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

    public static bool IsPinLockedOut(string key, out TimeSpan retryAfter) =>
        IsAttemptLockedOut(PinAttempts, key, out retryAfter);

    public static void RegisterPinFailure(string key) =>
        RegisterAttemptFailure(PinAttempts, key, MaxPinFailures, PinLockout);

    public static void ResetPinFailures(string key) =>
        PinAttempts.TryRemove(key, out _);

    public static bool IsLoginLockedOut(string key, out TimeSpan retryAfter) =>
        IsAttemptLockedOut(LoginAttempts, key, out retryAfter);

    public static void RegisterLoginFailure(string key) =>
        RegisterAttemptFailure(LoginAttempts, key, MaxLoginFailures, LoginLockout);

    public static void ResetLoginFailures(string key) =>
        LoginAttempts.TryRemove(key, out _);

    private static bool IsAttemptLockedOut(ConcurrentDictionary<string, PinAttemptState> map, string key, out TimeSpan retryAfter)
    {
        retryAfter = TimeSpan.Zero;
        if (map.TryGetValue(key, out var st))
        {
            var now = DateTimeOffset.UtcNow;
            if (st.LockedUntil > now)
            {
                retryAfter = st.LockedUntil - now;
                return true;
            }

            if (st.LockedUntil > DateTimeOffset.MinValue && st.LockedUntil <= now)
            {
                map.TryRemove(key, out _);
            }
        }

        return false;
    }

    private static void RegisterAttemptFailure(ConcurrentDictionary<string, PinAttemptState> map, string key, int maxFailures, TimeSpan lockout)
    {
        PruneExpiredAttemptsIfNeeded(map);
        var now = DateTimeOffset.UtcNow;
        map.AddOrUpdate(
            key,
            _ => new PinAttemptState(1, DateTimeOffset.MinValue, now),
            (_, st) =>
            {
                var failures = st.LockedUntil > DateTimeOffset.MinValue && st.LockedUntil <= now ? 1 : st.Failures + 1;
                return failures >= maxFailures
                    ? new PinAttemptState(0, now.Add(lockout), now)
                    : new PinAttemptState(failures, DateTimeOffset.MinValue, now);
            });
    }

    private static void PruneExpiredAttemptsIfNeeded(ConcurrentDictionary<string, PinAttemptState> map)
    {
        if (map.Count < 256)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var staleCutoff = now - TimeSpan.FromHours(1);
        foreach (var kvp in map)
        {
            var st = kvp.Value;
            if ((st.LockedUntil > DateTimeOffset.MinValue && st.LockedUntil <= now)
                || (st.LockedUntil == DateTimeOffset.MinValue && st.UpdatedAt <= staleCutoff))
            {
                map.TryRemove(kvp.Key, out _);
            }
        }
    }

    private static string StripOptionalPort(string raw)
    {
        var s = raw.Trim();
        if (s.StartsWith('[') && s.Contains(']'))
        {
            var close = s.IndexOf(']');
            return s.Substring(1, close - 1);
        }

        var firstColon = s.IndexOf(':');
        var lastColon = s.LastIndexOf(':');
        if (firstColon > 0 && firstColon == lastColon)
        {
            return s.Substring(0, firstColon);
        }

        return s;
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
        public string K { get; set; } = AuthKindGoogle;

        public string E { get; set; } = string.Empty;

        public string? U { get; set; }

        public string? Un { get; set; }

        public long X { get; set; }

        public int V { get; set; }

        public string N { get; set; } = string.Empty;
    }
}
