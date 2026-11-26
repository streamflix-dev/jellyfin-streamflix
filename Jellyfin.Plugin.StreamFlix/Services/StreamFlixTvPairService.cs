using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Manages short-lived Smart TV / Google TV Scan-to-Sign-In QR pairing codes (5-minute TTL, one-time poll claim).
/// </summary>
public static class StreamFlixTvPairService
{
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static readonly ConcurrentDictionary<string, PendingTvPair> PairsById = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, string> PairIdByCode = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object SyncLock = new();

    public sealed record TvPairBeginResult(
        string PairId,
        string Code,
        string PollSecret,
        string PairUrl,
        string QrSvg,
        DateTimeOffset ExpiresAt);

    public sealed record TvPairApprovedSession(
        string SessionToken,
        string AuthKind,
        string ProviderName,
        string Email,
        string Username,
        string UserId,
        string Name,
        string Picture,
        bool IsAdmin,
        DateTimeOffset ExpiresAt);

    public sealed record TvPairPollResult(
        string Status,
        TvPairApprovedSession? Session);

    private sealed class PendingTvPair
    {
        public required string PairId { get; init; }

        public required string NormalizedCode { get; init; }

        public required string DisplayCode { get; init; }

        public required byte[] PollSecretHash { get; init; }

        public required DateTimeOffset ExpiresAt { get; init; }

        public bool Claimed { get; set; }

        public TvPairApprovedSession? ApprovedSession { get; set; }
    }

    public static string NormalizePairCode(string? rawCode)
    {
        if (string.IsNullOrWhiteSpace(rawCode))
        {
            return string.Empty;
        }

        var sb = new StringBuilder(8);
        foreach (var ch in rawCode.Trim().ToUpperInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(ch);
            }
        }

        return sb.ToString();
    }

    public static string FormatDisplayCode(string normalized)
    {
        var clean = NormalizePairCode(normalized);
        if (clean.Length == 6)
        {
            return clean.Substring(0, 3) + "-" + clean.Substring(3, 3);
        }

        return clean;
    }

    public static TvPairBeginResult BeginPair(string baseServerOriginAndPath)
    {
        PruneExpired();
        lock (SyncLock)
        {
            if (PairsById.Count >= 128)
            {
                var oldest = PairsById.OrderBy(kv => kv.Value.ExpiresAt).Take(32).Select(kv => kv.Value).ToList();
                foreach (var old in oldest)
                {
                    PairsById.TryRemove(old.PairId, out _);
                    PairIdByCode.TryRemove(old.NormalizedCode, out _);
                }
            }

            var pairId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            var pollSecret = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            var pollHash = SHA256.HashData(Encoding.ASCII.GetBytes(pollSecret));

            string normCode;
            do
            {
                var chars = new char[6];
                for (var i = 0; i < chars.Length; i++)
                {
                    chars[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
                }

                normCode = new string(chars);
            }
            while (PairIdByCode.ContainsKey(normCode));

            var displayCode = normCode.Substring(0, 3) + "-" + normCode.Substring(3, 3);
            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(5);
            var pairUrl = $"{baseServerOriginAndPath.TrimEnd('/')}/StreamFlix/Auth/TvPair/{displayCode}";
            var qrSvg = StreamFlixQrCode.GenerateSvg(pairUrl);

            var entry = new PendingTvPair
            {
                PairId = pairId,
                NormalizedCode = normCode,
                DisplayCode = displayCode,
                PollSecretHash = pollHash,
                ExpiresAt = expiresAt,
            };
            PairsById[pairId] = entry;
            PairIdByCode[normCode] = pairId;

            return new TvPairBeginResult(pairId, displayCode, pollSecret, pairUrl, qrSvg, expiresAt);
        }
    }

    public static bool IsCodePending(string? rawCode, out string displayCode)
    {
        displayCode = string.Empty;
        var norm = NormalizePairCode(rawCode);
        if (norm.Length != 6)
        {
            return false;
        }

        PruneExpired();
        lock (SyncLock)
        {
            if (PairIdByCode.TryGetValue(norm, out var pid)
                && PairsById.TryGetValue(pid, out var entry)
                && !entry.Claimed
                && entry.ApprovedSession == null
                && DateTimeOffset.UtcNow < entry.ExpiresAt)
            {
                displayCode = entry.DisplayCode;
                return true;
            }
        }

        return false;
    }

    public static bool ApprovePair(string? rawCode, TvPairApprovedSession approved)
    {
        var norm = NormalizePairCode(rawCode);
        if (norm.Length != 6 || approved == null || string.IsNullOrWhiteSpace(approved.SessionToken))
        {
            return false;
        }

        PruneExpired();
        lock (SyncLock)
        {
            if (!PairIdByCode.TryGetValue(norm, out var pid) || !PairsById.TryGetValue(pid, out var entry))
            {
                return false;
            }

            if (entry.Claimed || DateTimeOffset.UtcNow >= entry.ExpiresAt)
            {
                PairsById.TryRemove(pid, out _);
                PairIdByCode.TryRemove(norm, out _);
                return false;
            }

            entry.ApprovedSession = approved;
            PairIdByCode.TryRemove(norm, out _);
            return true;
        }
    }

    public static TvPairPollResult PollPair(string? rawPairId, string? rawPollSecret)
    {
        var cleanId = (rawPairId ?? string.Empty).Trim().ToLowerInvariant();
        var cleanSecret = (rawPollSecret ?? string.Empty).Trim();
        if (cleanId.Length < 16 || cleanId.Length > 64 || cleanSecret.Length < 24 || cleanSecret.Length > 128)
        {
            return new TvPairPollResult("invalid", null);
        }

        var candidateHash = SHA256.HashData(Encoding.ASCII.GetBytes(cleanSecret));
        PruneExpired();

        lock (SyncLock)
        {
            if (!PairsById.TryGetValue(cleanId, out var entry))
            {
                return new TvPairPollResult("expired", null);
            }

            if (!CryptographicOperations.FixedTimeEquals(candidateHash, entry.PollSecretHash))
            {
                return new TvPairPollResult("invalid", null);
            }

            if (entry.Claimed || DateTimeOffset.UtcNow >= entry.ExpiresAt)
            {
                PairsById.TryRemove(cleanId, out _);
                PairIdByCode.TryRemove(entry.NormalizedCode, out _);
                return new TvPairPollResult("expired", null);
            }

            if (entry.ApprovedSession != null)
            {
                var approved = entry.ApprovedSession;
                entry.Claimed = true;
                PairsById.TryRemove(cleanId, out _);
                PairIdByCode.TryRemove(entry.NormalizedCode, out _);
                return new TvPairPollResult("complete", approved);
            }

            return new TvPairPollResult("pending", null);
        }
    }

    private static void PruneExpired()
    {
        if (PairsById.IsEmpty)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        foreach (var kv in PairsById)
        {
            if (kv.Value.Claimed || now >= kv.Value.ExpiresAt)
            {
                PairsById.TryRemove(kv.Key, out _);
                PairIdByCode.TryRemove(kv.Value.NormalizedCode, out _);
            }
        }
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
