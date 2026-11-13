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
    public const string AuthKindOidc = "oidc";
    public const string AuthKindJellyfin = "jellyfin";
    public const string AuthKindJellyfinAdmin = "jellyfin_admin";
    public const string AuthKindGuestPass = "guest_pass";
    public const string GuestHandoffCookieName = "sf_guest_handoff";
    public const string GuestHandoffTokenPurpose = "guest_handoff";

    private const int MaxPinFailures = 5;
    private const int MaxPinTargetFailures = 14;
    private const int MaxLoginFailures = 6;
    private const int MaxGuestFailures = 8;

    private static readonly TimeSpan PinLockout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan LoginLockout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan GuestLockout = TimeSpan.FromMinutes(5);

    private static readonly ConcurrentDictionary<string, PinAttemptState> PinAttempts = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, PinAttemptState> PinTargetAttempts = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, PinAttemptState> LoginAttempts = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, PinAttemptState> GuestAttempts = new(StringComparer.OrdinalIgnoreCase);

    private static readonly object KeyLock = new();

    /// <summary>
    /// A validated household or guest session.
    /// </summary>
    public sealed record SessionInfo(
        string Email,
        DateTimeOffset ExpiresAt,
        string AuthKind = AuthKindGoogle,
        string? JellyfinUserId = null,
        string? Username = null,
        string? GuestPassId = null,
        string? LockedProfileId = null);

    /// <summary>
    /// Short-lived HttpOnly cookie payload used to complete 1-click Guest Pass link/QR redemption.
    /// </summary>
    public sealed record GuestHandoffPayload(
        string PassId,
        string Code,
        string CreatedAt);

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
    /// Returns true when the OIDC user is permitted under current OIDC allowlist configuration.
    /// </summary>
    public static bool IsOidcUserApproved(PluginConfiguration config, string? email, string? username, string? subject)
    {
        if (!config.OidcRequireAllowlist)
        {
            return !string.IsNullOrWhiteSpace(email)
                || !string.IsNullOrWhiteSpace(username)
                || !string.IsNullOrWhiteSpace(subject);
        }

        var approved = config.ApprovedOidcUsers ?? new();
        bool MatchesAllowlist(string? candidate)
        {
            if (string.IsNullOrWhiteSpace(candidate))
            {
                return false;
            }

            var norm = candidate.Trim();
            return approved.Any(a => string.Equals(a?.Trim(), norm, StringComparison.OrdinalIgnoreCase));
        }

        if (MatchesAllowlist(email) || MatchesAllowlist(username) || MatchesAllowlist(subject))
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(email))
        {
            var normEmail = email.Trim();
            return (config.Profiles ?? new())
                .Any(p => !string.IsNullOrWhiteSpace(p.GoogleAccountEmail)
                    && string.Equals(p.GoogleAccountEmail.Trim(), normEmail, StringComparison.OrdinalIgnoreCase));
        }

        return false;
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
    /// Issues a new signed household session backed by a server-verified OpenID Connect (OIDC) login.
    /// </summary>
    public static SessionInfo IssueOidcSession(
        PluginConfiguration config,
        string? verifiedEmail,
        string? username,
        string subject,
        out string token)
    {
        var key = GetOrCreateKey(config);
        var lifetimeDays = Math.Clamp(config.SessionLifetimeDays <= 0 ? 30 : config.SessionLifetimeDays, 1, 365);
        var expires = DateTimeOffset.UtcNow.AddDays(lifetimeDays);
        var cleanEmail = string.IsNullOrWhiteSpace(verifiedEmail) ? string.Empty : verifiedEmail.Trim().ToLowerInvariant();
        var cleanUser = string.IsNullOrWhiteSpace(username) ? cleanEmail : username.Trim();
        var cleanSub = (subject ?? string.Empty).Trim();

        var payload = JsonSerializer.SerializeToUtf8Bytes(new SessionPayload
        {
            K = AuthKindOidc,
            E = cleanEmail,
            U = cleanSub,
            Un = cleanUser,
            X = expires.ToUnixTimeSeconds(),
            V = config.SessionVersion,
            N = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
        });

        var body = Base64UrlEncode(payload);
        var sig = Base64UrlEncode(Sign(key, body));
        token = body + "." + sig;
        return new SessionInfo(cleanEmail, expires, AuthKindOidc, cleanSub, cleanUser);
    }

    /// <summary>
    /// Computes the unforgeable shareable code (<c>{passId}-{24HexMac}</c>) for a Guest Pass.
    /// </summary>
    public static string ComputeGuestPassCode(PluginConfiguration config, StreamFlixGuestPass pass)
    {
        var key = GetOrCreateKey(config);
        var material = $"guest_pass_code:v1:{pass.Id}:{pass.ProfileId}:{pass.SecretNonce}:{pass.ExpiresAtUtc}";
        var mac = Sign(key, material);
        var shortMac = Convert.ToHexString(mac, 0, 12).ToLowerInvariant();
        return $"{pass.Id}-{shortMac}";
    }

    /// <summary>
    /// Normalizes a raw Guest Pass input (accepts either the bare pass code or a full <c>/StreamFlix/Guest/{code}</c> URL).
    /// </summary>
    public static string ExtractGuestPassCode(string? rawInput)
    {
        if (string.IsNullOrWhiteSpace(rawInput))
        {
            return string.Empty;
        }

        var trimmed = rawInput.Trim();
        var guestIdx = trimmed.LastIndexOf("/StreamFlix/Guest/", StringComparison.OrdinalIgnoreCase);
        if (guestIdx >= 0)
        {
            trimmed = trimmed.Substring(guestIdx + "/StreamFlix/Guest/".Length);
        }

        var qIdx = trimmed.IndexOfAny(new[] { '?', '#', '/' });
        if (qIdx >= 0)
        {
            trimmed = trimmed.Substring(0, qIdx);
        }

        return Uri.UnescapeDataString(trimmed).Trim();
    }

    /// <summary>
    /// Verifies a Guest Pass code for redemption (checking HMAC signature, revocation, expiry, and redemption cap).
    /// </summary>
    public static bool TryVerifyGuestPassForRedemption(
        PluginConfiguration config,
        string? rawInput,
        out StreamFlixGuestPass? matchedPass,
        out string failureReason)
    {
        matchedPass = null;
        failureReason = "Invalid or expired Guest Pass.";

        if (!config.EnableGuestPasses)
        {
            failureReason = "Temporary Guest Passes are turned off on this server.";
            return false;
        }

        var code = ExtractGuestPassCode(rawInput);
        var dashIdx = code.LastIndexOf('-');
        if (dashIdx <= 0 || dashIdx >= code.Length - 8)
        {
            return false;
        }

        var passId = code.Substring(0, dashIdx);
        var pass = (config.GuestPasses ?? new())
            .FirstOrDefault(g => string.Equals(g.Id, passId, StringComparison.Ordinal));
        if (pass == null || string.IsNullOrWhiteSpace(pass.SecretNonce) || string.IsNullOrWhiteSpace(pass.ProfileId))
        {
            return false;
        }

        var expectedCode = ComputeGuestPassCode(config, pass);
        var normalizedExpectedBytes = Encoding.UTF8.GetBytes(expectedCode.ToLowerInvariant());
        var suppliedBytes = Encoding.UTF8.GetBytes(code.ToLowerInvariant());
        if (!CryptographicOperations.FixedTimeEquals(normalizedExpectedBytes, suppliedBytes))
        {
            return false;
        }

        if (pass.Revoked)
        {
            failureReason = "This Guest Pass has been revoked.";
            return false;
        }

        if (!DateTimeOffset.TryParse(pass.ExpiresAtUtc, out var expiresAt) || expiresAt <= DateTimeOffset.UtcNow)
        {
            failureReason = "This Guest Pass has expired.";
            return false;
        }

        if (pass.MaxRedemptions > 0 && pass.RedemptionCount >= pass.MaxRedemptions)
        {
            failureReason = "This Guest Pass has already reached its maximum number of redemptions.";
            return false;
        }

        matchedPass = pass;
        failureReason = string.Empty;
        return true;
    }

    /// <summary>
    /// Issues a signed Guest Pass session locked strictly to <paramref name="profile"/> until <paramref name="pass"/> expires or is revoked.
    /// </summary>
    public static SessionInfo IssueGuestPassSession(
        PluginConfiguration config,
        StreamFlixGuestPass pass,
        StreamFlixProfileConfig profile,
        out string token)
    {
        var key = GetOrCreateKey(config);
        var maxAllowed = DateTimeOffset.UtcNow.AddDays(30);
        var passExpires = DateTimeOffset.TryParse(pass.ExpiresAtUtc, out var parsedExp)
            ? parsedExp
            : DateTimeOffset.UtcNow.AddHours(24);
        var expires = passExpires < maxAllowed ? passExpires : maxAllowed;
        var label = string.IsNullOrWhiteSpace(pass.Label) ? profile.Name : pass.Label.Trim();

        var payload = JsonSerializer.SerializeToUtf8Bytes(new SessionPayload
        {
            K = AuthKindGuestPass,
            E = string.Empty,
            U = (profile.JellyfinUserId ?? string.Empty).Trim(),
            Un = label,
            Gp = pass.Id,
            Lp = profile.Id,
            X = expires.ToUnixTimeSeconds(),
            V = config.SessionVersion,
            N = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
        });

        var body = Base64UrlEncode(payload);
        var sig = Base64UrlEncode(Sign(key, body));
        token = body + "." + sig;
        return new SessionInfo(
            string.Empty,
            expires,
            AuthKindGuestPass,
            (profile.JellyfinUserId ?? string.Empty).Trim(),
            label,
            pass.Id,
            profile.Id);
    }

    /// <summary>
    /// Signs a short-lived, domain-separated token (e.g. OIDC PKCE state or single-use callback handoff cookie).
    /// </summary>
    public static string SignShortLivedPayload<T>(PluginConfiguration config, string purpose, T data, TimeSpan ttl)
    {
        var key = GetOrCreateKey(config);
        var exp = DateTimeOffset.UtcNow.Add(ttl).ToUnixTimeSeconds();
        var envBytes = JsonSerializer.SerializeToUtf8Bytes(new ShortLivedEnvelope<T>
        {
            P = purpose,
            X = exp,
            V = config.SessionVersion,
            D = data,
        });
        var body = Base64UrlEncode(envBytes);
        var sig = Base64UrlEncode(Sign(key, purpose + ":" + body));
        return body + "." + sig;
    }

    /// <summary>
    /// Verifies and unpacks a short-lived, domain-separated token created by <see cref="SignShortLivedPayload{T}"/>.
    /// </summary>
    public static T? VerifyShortLivedPayload<T>(PluginConfiguration config, string purpose, string? token)
        where T : class
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
            var expected = Sign(key, purpose + ":" + parts[0]);
            var provided = Base64UrlDecode(parts[1]);
            if (!CryptographicOperations.FixedTimeEquals(expected, provided))
            {
                return null;
            }

            var env = JsonSerializer.Deserialize<ShortLivedEnvelope<T>>(Base64UrlDecode(parts[0]));
            if (env == null
                || !string.Equals(env.P, purpose, StringComparison.Ordinal)
                || env.V != config.SessionVersion
                || DateTimeOffset.FromUnixTimeSeconds(env.X) <= DateTimeOffset.UtcNow)
            {
                return null;
            }

            return env.D;
        }
        catch
        {
            return null;
        }
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

            if (string.Equals(kind, AuthKindOidc, StringComparison.Ordinal))
            {
                if (!config.EnableCustomOidc
                    || string.IsNullOrWhiteSpace(config.OidcIssuerUrl)
                    || string.IsNullOrWhiteSpace(config.OidcClientId)
                    || !IsOidcUserApproved(config, payload.E, payload.Un, payload.U))
                {
                    return null;
                }

                return new SessionInfo(payload.E ?? string.Empty, expires, AuthKindOidc, payload.U, payload.Un);
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

            if (string.Equals(kind, AuthKindGuestPass, StringComparison.Ordinal))
            {
                if (!config.EnableGuestPasses || string.IsNullOrWhiteSpace(payload.Gp) || string.IsNullOrWhiteSpace(payload.Lp))
                {
                    return null;
                }

                var pass = (config.GuestPasses ?? new())
                    .FirstOrDefault(g => string.Equals(g.Id, payload.Gp, StringComparison.Ordinal));
                if (pass == null
                    || pass.Revoked
                    || !string.Equals(pass.ProfileId, payload.Lp, StringComparison.Ordinal)
                    || !DateTimeOffset.TryParse(pass.ExpiresAtUtc, out var passExpires)
                    || passExpires <= DateTimeOffset.UtcNow)
                {
                    return null;
                }

                var lockedProfile = (config.Profiles ?? new())
                    .FirstOrDefault(p => string.Equals(p.Id, payload.Lp, StringComparison.Ordinal));
                if (lockedProfile == null)
                {
                    return null;
                }

                var effectiveExpires = passExpires < expires ? passExpires : expires;
                return new SessionInfo(
                    string.Empty,
                    effectiveExpires,
                    AuthKindGuestPass,
                    payload.U,
                    payload.Un,
                    pass.Id,
                    lockedProfile.Id);
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
    /// when a local proxy forwards an external <c>Forwarded</c> (RFC 7239), <c>X-Forwarded-For</c>, <c>X-Real-IP</c>,
    /// <c>CF-Connecting-IP</c>, <c>True-Client-IP</c>, or <c>X-Client-IP</c> header.
    /// </summary>
    public static bool IsLocalLanRequest(HttpContext? httpContext)
    {
        var remoteIp = httpContext?.Connection?.RemoteIpAddress;
        if (remoteIp == null || !IsPrivateOrLoopbackIp(remoteIp))
        {
            return false;
        }

        var headers = httpContext!.Request.Headers;
        foreach (var headerName in new[] { "CF-Connecting-IP", "True-Client-IP", "X-Client-IP", "X-Real-IP", "X-Forwarded-For" })
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

        var rfcForwarded = headers["Forwarded"].ToString();
        if (!string.IsNullOrWhiteSpace(rfcForwarded))
        {
            var sawForToken = false;
            foreach (var entry in rfcForwarded.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                foreach (var param in entry.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    if (!param.StartsWith("for=", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    sawForToken = true;
                    var rawVal = param.Substring(4).Trim().Trim('"');
                    var candidate = StripOptionalPort(rawVal);
                    if (!IPAddress.TryParse(candidate, out var forwardedIp) || !IsPrivateOrLoopbackIp(forwardedIp))
                    {
                        return false;
                    }
                }
            }

            if (!sawForToken)
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Builds a spoof-resistant rate-limit key for PIN, password login, and Guest Pass attempts: keys directly on the socket IP
    /// for public/external connections (preventing header spoofing), and sub-keys on the rightmost external forwarded IP
    /// when Jellyfin sits behind a localhost, Docker bridge, or LAN reverse proxy.
    /// </summary>
    public static string GetRateLimitClientKey(HttpContext? httpContext)
    {
        var remoteIp = httpContext?.Connection?.RemoteIpAddress;
        if (remoteIp == null)
        {
            return "unknown";
        }

        var normalizedRemote = remoteIp.IsIPv4MappedToIPv6 ? remoteIp.MapToIPv4() : remoteIp;
        if (!IsPrivateOrLoopbackIp(normalizedRemote))
        {
            return normalizedRemote.ToString();
        }

        var headers = httpContext!.Request.Headers;
        foreach (var singleHeader in new[] { "CF-Connecting-IP", "True-Client-IP", "X-Real-IP" })
        {
            var raw = headers[singleHeader].ToString();
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length > 0 && IPAddress.TryParse(StripOptionalPort(parts[^1]), out var fwdIp))
            {
                var normFwd = fwdIp.IsIPv4MappedToIPv6 ? fwdIp.MapToIPv4() : fwdIp;
                return normalizedRemote + "|" + normFwd;
            }
        }

        var xff = headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrWhiteSpace(xff))
        {
            var parts = xff.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            IPAddress? fallbackPrivate = null;
            for (var i = parts.Length - 1; i >= 0; i--)
            {
                if (!IPAddress.TryParse(StripOptionalPort(parts[i]), out var hopIp))
                {
                    continue;
                }

                var normHop = hopIp.IsIPv4MappedToIPv6 ? hopIp.MapToIPv4() : hopIp;
                if (!IsPrivateOrLoopbackIp(normHop))
                {
                    return normalizedRemote + "|" + normHop;
                }

                fallbackPrivate ??= normHop;
            }

            if (fallbackPrivate != null)
            {
                return normalizedRemote + "|" + fallbackPrivate;
            }
        }

        return normalizedRemote.ToString();
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

    public static bool IsPinTargetLockedOut(string profileId, out TimeSpan retryAfter) =>
        IsAttemptLockedOut(PinTargetAttempts, "profile:" + profileId, out retryAfter);

    public static void RegisterPinTargetFailure(string profileId) =>
        RegisterAttemptFailure(PinTargetAttempts, "profile:" + profileId, MaxPinTargetFailures, PinLockout);

    public static void ResetPinTargetFailures(string profileId) =>
        PinTargetAttempts.TryRemove("profile:" + profileId, out _);

    public static bool IsLoginLockedOut(string key, out TimeSpan retryAfter) =>
        IsAttemptLockedOut(LoginAttempts, key, out retryAfter);

    public static void RegisterLoginFailure(string key) =>
        RegisterAttemptFailure(LoginAttempts, key, MaxLoginFailures, LoginLockout);

    public static void ResetLoginFailures(string key) =>
        LoginAttempts.TryRemove(key, out _);

    public static bool IsGuestLockedOut(string key, out TimeSpan retryAfter) =>
        IsAttemptLockedOut(GuestAttempts, key, out retryAfter);

    public static void RegisterGuestFailure(string key) =>
        RegisterAttemptFailure(GuestAttempts, key, MaxGuestFailures, GuestLockout);

    public static void ResetGuestFailures(string key) =>
        GuestAttempts.TryRemove(key, out _);

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
        var s = raw.Trim().Trim('"');
        if (s.StartsWith('[') && s.Contains(']'))
        {
            var close = s.IndexOf(']');
            s = s.Substring(1, close - 1);
        }
        else
        {
            var firstColon = s.IndexOf(':');
            var lastColon = s.LastIndexOf(':');
            if (firstColon > 0 && firstColon == lastColon)
            {
                s = s.Substring(0, firstColon);
            }
        }

        var zoneIdx = s.IndexOf('%');
        if (zoneIdx > 0)
        {
            s = s.Substring(0, zoneIdx);
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

        public string? Gp { get; set; }

        public string? Lp { get; set; }

        public long X { get; set; }

        public int V { get; set; }

        public string N { get; set; } = string.Empty;
    }

    private sealed class ShortLivedEnvelope<T>
    {
        public string P { get; set; } = string.Empty;

        public long X { get; set; }

        public int V { get; set; }

        public T? D { get; set; }
    }
}
