using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Full-compatibility server-side client for Seerr, Jellyseerr, and Overseerr (<c>/api/v1</c>).
/// Handles IPv4-preferred socket transport, Docker localhost bridging, safe same-host POST/DELETE redirects,
/// deleted-user-#1 X-Api-User recovery, per-profile Seerr user attribution &amp; permission enforcement,
/// Radarr/Sonarr un-defaulted &amp; 4K server auto-selection, and instant search/metadata caching.
/// </summary>
public static class StreamFlixSeerrService
{
    private static readonly HttpClient SeerrHttp = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(4), // Safely under Node.js 5s keepAliveTimeout
        ConnectTimeout = TimeSpan.FromSeconds(4),
        ConnectCallback = ConnectSeerrSocketAsync,
        SslOptions = new SslClientAuthenticationOptions
        {
            RemoteCertificateValidationCallback = ValidateSeerrCertificate,
        },
    })
    {
        Timeout = Timeout.InfiniteTimeSpan,
        DefaultRequestVersion = HttpVersion.Version11,
        DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower,
    };

    private static readonly Regex SafeTmdbImagePathRegex = new(@"^/[a-zA-Z0-9._-]+$", RegexOptions.Compiled);

    private static readonly ConcurrentDictionary<string, CachedHostAddresses> DnsCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedApiAuthContext> ApiAuthCache = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, CachedSeerrUsers> UsersCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedServiceServers> ServersCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedPublicSettings> PublicSettingsCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedMediaMeta> MediaMetaCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedSearchResult> SearchCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedRequestsResult> RecentRequestsCache = new(StringComparer.OrdinalIgnoreCase);

    private static string _unreachableBaseUrl = string.Empty;
    private static long _unreachableUntilTicks;

    private sealed record CachedHostAddresses(IPAddress[] Addresses, DateTime ExpiresAtUtc);

    private sealed record CachedApiAuthContext(string? ApiUserHeader, int AdminUserId, DateTime ExpiresAtUtc);

    private sealed record SeerrUserSummary(int Id, string JellyfinUserIdNorm, string Username, string Email, int Permissions);

    private sealed record CachedSeerrUsers(List<SeerrUserSummary> Users, DateTime ExpiresAtUtc);

    private sealed record CachedServiceServers(List<SeerrServiceServer> Servers, DateTime ExpiresAtUtc);

    private sealed record CachedPublicSettings(bool PartialRequestsEnabled, DateTime ExpiresAtUtc);

    private sealed record CachedMediaMeta(
        string Title,
        string Year,
        string PosterUrl,
        string BackdropUrl,
        int? TvdbId,
        bool IsAdult,
        bool IsMatureForKids,
        DateTime ExpiresAtUtc);

    private sealed record CachedSearchResult(List<SeerrMediaItem> Items, DateTime ExpiresAtUtc);

    private sealed record CachedRequestsResult(List<SeerrRequestEntry> Entries, DateTime ExpiresAtUtc);

    public sealed record SeerrDiagnosticCheck(string Status, string Label, string Detail);

    public sealed record SeerrServiceServer(
        int Id,
        string Name,
        bool Is4k,
        bool IsDefault,
        int ActiveProfileId,
        string ActiveDirectory);

    public sealed record SeerrMediaItem(
        int TmdbId,
        string MediaType,
        string Title,
        string Year,
        string Overview,
        double Rating,
        string PosterUrl,
        string BackdropUrl,
        int MediaStatus,
        string StatusLabel,
        int? DownloadProgress,
        string? JellyfinMediaId);

    public sealed record SeerrSeasonItem(
        int SeasonNumber,
        string Name,
        int EpisodeCount,
        string Year,
        int Status,
        string StatusLabel);

    public sealed record SeerrMediaDetail(
        int TmdbId,
        string MediaType,
        string Title,
        string Tagline,
        string Year,
        int RuntimeMinutes,
        double Rating,
        List<string> Genres,
        string Overview,
        string PosterUrl,
        string BackdropUrl,
        int MediaStatus,
        int MediaStatus4k,
        string StatusLabel,
        int? DownloadProgress,
        int? ActiveRequestId,
        string? JellyfinMediaId,
        bool PartialRequestsEnabled,
        List<SeerrSeasonItem> Seasons,
        List<SeerrServiceServer> Servers,
        int? TvdbId = null);

    public sealed record SeerrRequestEntry(
        int RequestId,
        int TmdbId,
        string MediaType,
        string Title,
        string Year,
        string PosterUrl,
        string BackdropUrl,
        int RequestStatus,
        int MediaStatus,
        string StatusKey,
        string StatusLabel,
        int? DownloadProgress,
        List<int> Seasons,
        string CreatedAt,
        string? JellyfinMediaId,
        int? RequestedByUserId = null,
        bool CanCancel = true);

    public sealed record SeerrSubmitResult(
        bool Ok,
        int? RequestId,
        int MediaStatus,
        string StatusLabel,
        string Message);

    public static bool IsConfigured(PluginConfiguration config)
    {
        return config.EnableSeerr
            && !string.IsNullOrWhiteSpace(config.SeerrUrl)
            && !string.IsNullOrWhiteSpace(config.SeerrApiKey);
    }

    public static void ResetTransientCaches()
    {
        Interlocked.Exchange(ref _unreachableUntilTicks, 0);
        _unreachableBaseUrl = string.Empty;
        DnsCache.Clear();
        ApiAuthCache.Clear();
        UsersCache.Clear();
        ServersCache.Clear();
        PublicSettingsCache.Clear();
        SearchCache.Clear();
        RecentRequestsCache.Clear();
    }

    public static string NormalizeBaseUrl(string? rawUrl)
    {
        var s = (rawUrl ?? string.Empty).Trim().TrimEnd('/');
        if (s.EndsWith("/api/v1", StringComparison.OrdinalIgnoreCase))
        {
            s = s.Substring(0, s.Length - 7).TrimEnd('/');
        }

        return s;
    }

    public static int NormalizeMediaStatus(int rawStatus)
    {
        // Seerr / Jellyseerr MediaStatus: 1=Unknown, 2=Pending, 3=Processing, 4=PartiallyAvailable, 5=Available, 6=Blocklisted, 7=Deleted
        if (rawStatus <= 0 || rawStatus == 7)
        {
            return 1;
        }

        return Math.Clamp(rawStatus, 1, 6);
    }

    public static string MapStatusLabel(int status) => NormalizeMediaStatus(status) switch
    {
        2 => "Pending",
        3 => "Processing",
        4 => "Partially Available",
        5 => "Available",
        6 => "Unavailable",
        _ => "Not Requested",
    };

    public static async Task<(string Status, string Summary, List<SeerrDiagnosticCheck> Checks)> TestConnectionAsync(
        string? rawUrl,
        string? rawApiKey,
        CancellationToken cancellationToken = default)
    {
        ResetTransientCaches();

        var checks = new List<SeerrDiagnosticCheck>();
        var baseUrl = NormalizeBaseUrl(rawUrl);
        var apiKey = (rawApiKey ?? string.Empty).Trim();

        if (string.IsNullOrEmpty(baseUrl))
        {
            checks.Add(new("error", "Seerr URL", "Enter your Seerr / Jellyseerr URL (e.g. http://127.0.0.1:5055 or https://requests.example.com)."));
        }
        else
        {
            try
            {
                await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);
                checks.Add(new("ok", "Seerr URL", $"Base URL validated ({baseUrl})."));
            }
            catch (Exception ex)
            {
                checks.Add(new("error", "Seerr URL", ex.Message));
            }
        }

        if (string.IsNullOrEmpty(apiKey))
        {
            checks.Add(new("error", "API Key", "Paste your Seerr / Jellyseerr API Key (found in Seerr → Settings → General → API Key)."));
        }
        else if (apiKey.Length < 16)
        {
            checks.Add(new("warn", "API Key", "API key looks unusually short — verify you copied the full key from Seerr → Settings → General."));
        }
        else
        {
            checks.Add(new("ok", "API Key format", "API key provided (stored server-side only)."));
        }

        if (checks.All(c => c.Status != "error"))
        {
            try
            {
                using var statusResp = await SendSeerrAsync(HttpMethod.Get, baseUrl + "/api/v1/status", apiKey, null, null, cancellationToken).ConfigureAwait(false);
                if (!statusResp.IsSuccessStatusCode)
                {
                    checks.Add(new("error", "Server Reachability", $"Seerr /api/v1/status returned HTTP {(int)statusResp.StatusCode}. Check the URL and port."));
                }
                else
                {
                    var body = await statusResp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                    using var doc = JsonDocument.Parse(body);
                    var ver = JsonStr(doc.RootElement, "version");
                    checks.Add(new("ok", "Server Reachability", string.IsNullOrEmpty(ver)
                        ? "Connected to Seerr /api/v1/status."
                        : $"Connected to Seerr v{ver}."));

                    var authCtx = await ResolveApiAuthContextAsync(baseUrl, apiKey, cancellationToken).ConfigureAwait(false);
                    if (authCtx != null)
                    {
                        var extra = authCtx.ApiUserHeader != null ? $" (auto-bound to Seerr admin user #{authCtx.AdminUserId})" : string.Empty;
                        checks.Add(new("ok", "API Key Authentication", $"API key verified against Seerr{extra}."));

                        var radarr = await GetServiceServersAsync(baseUrl, apiKey, authCtx.ApiUserHeader, "movie", cancellationToken).ConfigureAwait(false);
                        var sonarr = await GetServiceServersAsync(baseUrl, apiKey, authCtx.ApiUserHeader, "tv", cancellationToken).ConfigureAwait(false);
                        checks.Add(new(
                            radarr.Count + sonarr.Count > 0 ? "ok" : "warn",
                            "Radarr / Sonarr Services",
                            radarr.Count + sonarr.Count > 0
                                ? $"Detected {radarr.Count} Radarr and {sonarr.Count} Sonarr server(s) in Seerr."
                                : "Connected, but no Radarr or Sonarr server is configured in Seerr yet (requests will stay Pending until configured)."));
                    }
                    else
                    {
                        checks.Add(new("error", "API Key Authentication", "Seerr rejected the API key (HTTP 401/403). Copy the Main API Key from Seerr → Settings → General → API Key."));
                    }
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                checks.Add(new("error", "Server Reachability", "Connection to Seerr timed out. Verify the host/IP and port are reachable from the Jellyfin server."));
            }
            catch (Exception ex)
            {
                checks.Add(new("error", "Server Reachability", $"Could not connect to Seerr: {ex.Message}"));
            }
        }

        var hasErr = checks.Any(c => c.Status == "error");
        var hasWarn = checks.Any(c => c.Status == "warn");
        var overall = hasErr ? "error" : (hasWarn ? "warn" : "ok");
        var summary = hasErr
            ? "Seerr connection test failed — review the checks below."
            : (hasWarn
                ? "Connected to Seerr with warnings."
                : "Seerr connection & API key verified! Save settings to enable search requests.");

        return (overall, summary, checks);
    }

    public static async Task<List<SeerrMediaItem>> SearchAsync(
        PluginConfiguration config,
        string query,
        bool isKidsProfile,
        CancellationToken cancellationToken = default)
    {
        var items = new List<SeerrMediaItem>();
        var q = (query ?? string.Empty).Trim();
        if (q.Length < 2 || !IsConfigured(config))
        {
            return items;
        }

        if (q.Length > 100)
        {
            q = q.Substring(0, 100).Trim();
        }

        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var cacheKey = $"{baseUrl}|{(isKidsProfile ? "1" : "0")}|{q.ToLowerInvariant()}";
        if (SearchCache.TryGetValue(cacheKey, out var cachedSearch) && cachedSearch.ExpiresAtUtc > DateTime.UtcNow)
        {
            return cachedSearch.Items;
        }

        if (IsTemporarilyUnreachable(baseUrl))
        {
            throw new InvalidOperationException("Seerr is temporarily unreachable — retrying shortly.");
        }

        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);
        var authCtx = await ResolveApiAuthContextAsync(baseUrl, apiKey, cancellationToken).ConfigureAwait(false);

        // Match Seerr's own encodeURIExtraParams (encoding parentheses, !, * cleanly and letting Seerr apply its configured locale)
        var url = $"{baseUrl}/api/v1/search?page=1&query={EncodeSeerrQueryParam(q)}";
        using var resp = await SendSeerrWithCircuitBreakerAsync(HttpMethod.Get, url, baseUrl, apiKey, authCtx?.ApiUserHeader, null, cancellationToken).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Seerr search returned HTTP {(int)resp.StatusCode}.");
        }

        var raw = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(raw);
        if (!doc.RootElement.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
        {
            return items;
        }

        foreach (var el in results.EnumerateArray())
        {
            var mediaType = JsonStr(el, "mediaType").Trim().ToLowerInvariant();
            if (mediaType is not ("movie" or "tv"))
            {
                continue;
            }

            if (JsonBool(el, "adult"))
            {
                continue;
            }

            if (isKidsProfile && HasMatureTmdbGenre(el))
            {
                continue;
            }

            var tmdbId = JsonInt(el, "id");
            if (tmdbId <= 0)
            {
                continue;
            }

            var title = FirstNonEmpty(JsonStr(el, "title"), JsonStr(el, "name"), JsonStr(el, "originalTitle"), JsonStr(el, "originalName"));
            if (string.IsNullOrEmpty(title))
            {
                continue;
            }

            var dateRaw = FirstNonEmpty(JsonStr(el, "releaseDate"), JsonStr(el, "firstAirDate"));
            var year = dateRaw.Length >= 4 && int.TryParse(dateRaw.AsSpan(0, 4), out var yr) && yr >= 1888 && yr <= 2100
                ? yr.ToString(CultureInfo.InvariantCulture)
                : string.Empty;

            var overview = JsonStr(el, "overview").Trim();
            var rating = Math.Round(Math.Clamp(JsonDouble(el, "voteAverage"), 0, 10), 1);
            var posterUrl = BuildSafeTmdbImageUrl(JsonStr(el, "posterPath"), "w342");
            var backdropUrl = BuildSafeTmdbImageUrl(JsonStr(el, "backdropPath"), "w1280");

            var mediaStatus = 1;
            int? downloadProgress = null;
            var isDownloading = false;
            string? jfMediaId = null;
            int? tvdbId = null;
            if (el.TryGetProperty("mediaInfo", out var mi) && mi.ValueKind == JsonValueKind.Object)
            {
                var stStandard = NormalizeMediaStatus(JsonInt(mi, "status", 1));
                var st4k = NormalizeMediaStatus(JsonInt(mi, "status4k", 1));
                mediaStatus = stStandard != 1 ? stStandard : st4k;
                (isDownloading, downloadProgress) = ExtractDownloadProgress(mi);
                var jfId = FirstNonEmpty(JsonStr(mi, "jellyfinMediaId"), JsonStr(mi, "jellyfinMediaId4k"));
                if (!string.IsNullOrEmpty(jfId))
                {
                    jfMediaId = jfId;
                }

                var rawTvdb = JsonInt(mi, "tvdbId", 0);
                if (rawTvdb > 0)
                {
                    tvdbId = rawTvdb;
                }
            }

            StoreCachedMediaMeta(mediaType, tmdbId, title, year, posterUrl, backdropUrl, tvdbId, isAdult: false, isMatureForKids: HasMatureTmdbGenre(el));

            var statusLabel = isDownloading && mediaStatus is 2 or 3
                ? (downloadProgress.HasValue && downloadProgress.Value > 0 ? $"Downloading · {downloadProgress.Value}%" : "Downloading")
                : MapStatusLabel(mediaStatus);

            items.Add(new SeerrMediaItem(
                TmdbId: tmdbId,
                MediaType: mediaType,
                Title: title,
                Year: year,
                Overview: overview,
                Rating: rating,
                PosterUrl: posterUrl,
                BackdropUrl: backdropUrl,
                MediaStatus: mediaStatus,
                StatusLabel: statusLabel,
                DownloadProgress: isDownloading ? downloadProgress : null,
                JellyfinMediaId: jfMediaId));

            if (items.Count >= 24)
            {
                break;
            }
        }

        PruneSearchCacheIfNeeded();
        SearchCache[cacheKey] = new CachedSearchResult(items, DateTime.UtcNow.AddSeconds(75));
        return items;
    }

    public static async Task<SeerrMediaDetail> GetMediaDetailsAsync(
        PluginConfiguration config,
        string mediaType,
        int tmdbId,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(tmdbId));
        }

        var cleanType = (mediaType ?? string.Empty).Trim().ToLowerInvariant() == "tv" ? "tv" : "movie";
        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);
        var authCtx = await ResolveApiAuthContextAsync(baseUrl, apiKey, cancellationToken).ConfigureAwait(false);

        var detailUrl = $"{baseUrl}/api/v1/{cleanType}/{tmdbId.ToString(CultureInfo.InvariantCulture)}";
        var detailTask = SendSeerrWithCircuitBreakerAsync(HttpMethod.Get, detailUrl, baseUrl, apiKey, authCtx?.ApiUserHeader, null, cancellationToken);
        var serversTask = GetServiceServersAsync(baseUrl, apiKey, authCtx?.ApiUserHeader, cleanType, cancellationToken);
        var publicSettingsTask = GetPublicSettingsAsync(baseUrl, apiKey, authCtx?.ApiUserHeader, cancellationToken);

        await Task.WhenAll(detailTask, serversTask, publicSettingsTask).ConfigureAwait(false);

        using var resp = await detailTask.ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Could not load {cleanType} details from Seerr (HTTP {(int)resp.StatusCode}).");
        }

        var servers = await serversTask.ConfigureAwait(false);
        var partialRequestsEnabled = await publicSettingsTask.ConfigureAwait(false);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
        var root = doc.RootElement;

        var title = FirstNonEmpty(JsonStr(root, "title"), JsonStr(root, "name"), JsonStr(root, "originalTitle"), JsonStr(root, "originalName"), "Untitled");
        var tagline = JsonStr(root, "tagline").Trim();
        var dateRaw = FirstNonEmpty(JsonStr(root, "releaseDate"), JsonStr(root, "firstAirDate"));
        var year = dateRaw.Length >= 4 ? dateRaw.Substring(0, 4) : string.Empty;
        var runtimeMinutes = Math.Max(0, JsonInt(root, "runtime", 0));
        if (runtimeMinutes == 0 && root.TryGetProperty("episodeRunTime", out var epRt) && epRt.ValueKind == JsonValueKind.Array)
        {
            foreach (var rtEl in epRt.EnumerateArray())
            {
                if (rtEl.ValueKind == JsonValueKind.Number && rtEl.TryGetInt32(out var rtVal) && rtVal > 0)
                {
                    runtimeMinutes = rtVal;
                    break;
                }
            }
        }

        var rating = Math.Round(Math.Clamp(JsonDouble(root, "voteAverage"), 0, 10), 1);
        var genres = new List<string>();
        if (root.TryGetProperty("genres", out var gArr) && gArr.ValueKind == JsonValueKind.Array)
        {
            foreach (var gEl in gArr.EnumerateArray())
            {
                var gName = JsonStr(gEl, "name").Trim();
                if (!string.IsNullOrEmpty(gName) && genres.Count < 4)
                {
                    genres.Add(gName);
                }
            }
        }

        var overview = JsonStr(root, "overview").Trim();
        var posterUrl = BuildSafeTmdbImageUrl(JsonStr(root, "posterPath"), "w342");
        var backdropUrl = BuildSafeTmdbImageUrl(JsonStr(root, "backdropPath"), "w1280");

        int? tvdbId = null;
        if (root.TryGetProperty("externalIds", out var extIds) && extIds.ValueKind == JsonValueKind.Object)
        {
            var extTvdb = JsonInt(extIds, "tvdbId", 0);
            if (extTvdb > 0)
            {
                tvdbId = extTvdb;
            }
        }

        var mediaStatus = 1;
        var mediaStatus4k = 1;
        int? downloadProgress = null;
        var isDownloading = false;
        int? activeRequestId = null;
        string? jfMediaId = null;
        var seasonStatuses = new Dictionary<int, int>();

        if (root.TryGetProperty("mediaInfo", out var mi) && mi.ValueKind == JsonValueKind.Object)
        {
            mediaStatus = NormalizeMediaStatus(JsonInt(mi, "status", 1));
            mediaStatus4k = NormalizeMediaStatus(JsonInt(mi, "status4k", 1));
            (isDownloading, downloadProgress) = ExtractDownloadProgress(mi);
            var rawJfId = FirstNonEmpty(JsonStr(mi, "jellyfinMediaId"), JsonStr(mi, "jellyfinMediaId4k"));
            if (!string.IsNullOrEmpty(rawJfId))
            {
                jfMediaId = rawJfId;
            }

            if (!tvdbId.HasValue)
            {
                var miTvdb = JsonInt(mi, "tvdbId", 0);
                if (miTvdb > 0)
                {
                    tvdbId = miTvdb;
                }
            }

            if (mi.TryGetProperty("seasons", out var miSeasons) && miSeasons.ValueKind == JsonValueKind.Array)
            {
                foreach (var ms in miSeasons.EnumerateArray())
                {
                    var sNum = JsonInt(ms, "seasonNumber", -1);
                    var sSt = NormalizeMediaStatus(JsonInt(ms, "status", 1));
                    if (sNum > 0)
                    {
                        seasonStatuses[sNum] = sSt;
                    }
                }
            }

            if (mi.TryGetProperty("requests", out var reqsArr) && reqsArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var rEl in reqsArr.EnumerateArray())
                {
                    var rId = JsonInt(rEl, "id", 0);
                    var rStatus = JsonInt(rEl, "status", 0); // 1=PENDING, 2=APPROVED, 3=DECLINED, 4=FAILED, 5=COMPLETED
                    if (rId > 0 && rStatus == 1 && !activeRequestId.HasValue)
                    {
                        activeRequestId = rId;
                    }

                    // Also mark seasons that have an active PENDING or APPROVED SeasonRequest so UI shows them as already requested!
                    if (rStatus is 1 or 2 && rEl.TryGetProperty("seasons", out var rSeasons) && rSeasons.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var rs in rSeasons.EnumerateArray())
                        {
                            var rSn = JsonInt(rs, "seasonNumber", -1);
                            var rsStatus = JsonInt(rs, "status", rStatus);
                            if (rSn > 0 && rsStatus is 1 or 2)
                            {
                                if (!seasonStatuses.TryGetValue(rSn, out var curSt) || curSt == 1)
                                {
                                    seasonStatuses[rSn] = rsStatus == 2 ? 3 : 2;
                                }
                            }
                        }
                    }
                }
            }
        }

        StoreCachedMediaMeta(cleanType, tmdbId, title, year, posterUrl, backdropUrl, tvdbId, JsonBool(root, "adult"), HasMatureDetailGenres(root));

        var seasons = new List<SeerrSeasonItem>();
        if (cleanType == "tv" && root.TryGetProperty("seasons", out var seasonsArr) && seasonsArr.ValueKind == JsonValueKind.Array)
        {
            foreach (var sEl in seasonsArr.EnumerateArray())
            {
                var sNum = JsonInt(sEl, "seasonNumber", -1);
                if (sNum <= 0)
                {
                    continue; // Skip Season 0 (Specials)
                }

                var epCount = Math.Max(0, JsonInt(sEl, "episodeCount", 0));
                var sName = FirstNonEmpty(JsonStr(sEl, "name"), $"Season {sNum}");
                var airRaw = JsonStr(sEl, "airDate");
                var sYear = airRaw.Length >= 4 ? airRaw.Substring(0, 4) : string.Empty;
                var st = seasonStatuses.TryGetValue(sNum, out var foundSt) ? foundSt : 1;

                seasons.Add(new SeerrSeasonItem(
                    SeasonNumber: sNum,
                    Name: sName,
                    EpisodeCount: epCount,
                    Year: sYear,
                    Status: st,
                    StatusLabel: epCount == 0 && st == 1 ? "TBA" : MapStatusLabel(st)));
            }

            seasons.Sort((a, b) => a.SeasonNumber.CompareTo(b.SeasonNumber));
        }

        var effectiveStatus = mediaStatus != 1 ? mediaStatus : mediaStatus4k;
        var statusLabel = isDownloading && effectiveStatus is 2 or 3
            ? (downloadProgress.HasValue && downloadProgress.Value > 0 ? $"Downloading · {downloadProgress.Value}%" : "Downloading")
            : MapStatusLabel(effectiveStatus);

        return new SeerrMediaDetail(
            TmdbId: tmdbId,
            MediaType: cleanType,
            Title: title,
            Tagline: tagline,
            Year: year,
            RuntimeMinutes: runtimeMinutes,
            Rating: rating,
            Genres: genres,
            Overview: overview,
            PosterUrl: posterUrl,
            BackdropUrl: backdropUrl,
            MediaStatus: mediaStatus,
            MediaStatus4k: mediaStatus4k,
            StatusLabel: statusLabel,
            DownloadProgress: isDownloading ? downloadProgress : null,
            ActiveRequestId: activeRequestId,
            JellyfinMediaId: jfMediaId,
            PartialRequestsEnabled: partialRequestsEnabled,
            Seasons: seasons,
            Servers: servers,
            TvdbId: tvdbId);
    }

    public static Task<SeerrMediaDetail> GetTvDetailsAsync(
        PluginConfiguration config,
        int tmdbId,
        CancellationToken cancellationToken = default)
    {
        return GetMediaDetailsAsync(config, "tv", tmdbId, cancellationToken);
    }

    public static async Task<List<SeerrRequestEntry>> GetRecentRequestsAsync(
        PluginConfiguration config,
        bool isKidsProfile,
        bool callerIsAdmin = true,
        StreamFlixProfileConfig? callerProfile = null,
        string? callerEmail = null,
        CancellationToken cancellationToken = default)
    {
        var entries = new List<SeerrRequestEntry>();
        if (!IsConfigured(config))
        {
            return entries;
        }

        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);
        var authCtx = await ResolveApiAuthContextAsync(baseUrl, apiKey, cancellationToken).ConfigureAwait(false);

        int? callerSeerrUserId = null;
        if (!callerIsAdmin)
        {
            callerSeerrUserId = await ResolveMatchingSeerrUserIdAsync(
                baseUrl,
                apiKey,
                authCtx?.ApiUserHeader,
                authCtx?.AdminUserId,
                callerProfile,
                callerEmail,
                callerIsAdmin: false,
                cancellationToken).ConfigureAwait(false);
            if (!callerSeerrUserId.HasValue)
            {
                return entries;
            }
        }

        var scopeTag = callerIsAdmin
            ? "admin"
            : $"u:{callerSeerrUserId!.Value.ToString(CultureInfo.InvariantCulture)}";
        var reqCacheKey = $"{baseUrl}|{(isKidsProfile ? "1" : "0")}|{scopeTag}";
        List<SeerrRequestEntry>? staleFallback = null;
        if (RecentRequestsCache.TryGetValue(reqCacheKey, out var cachedReqs))
        {
            if (cachedReqs.ExpiresAtUtc > DateTime.UtcNow)
            {
                return cachedReqs.Entries;
            }

            if (DateTime.UtcNow - cachedReqs.ExpiresAtUtc < TimeSpan.FromMinutes(10))
            {
                staleFallback = cachedReqs.Entries;
            }
        }

        var listUrl = callerIsAdmin
            ? $"{baseUrl}/api/v1/request?take=15&skip=0&sort=added"
            : $"{baseUrl}/api/v1/request?take=15&skip=0&sort=added&requestedBy={callerSeerrUserId!.Value.ToString(CultureInfo.InvariantCulture)}";

        string raw;
        try
        {
            using var listCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            listCts.CancelAfter(TimeSpan.FromSeconds(22));
            using var resp = await SendSeerrWithCircuitBreakerAsync(
                HttpMethod.Get,
                listUrl,
                baseUrl,
                apiKey,
                authCtx?.ApiUserHeader,
                null,
                listCts.Token).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Seerr requests endpoint returned HTTP {(int)resp.StatusCode}.");
            }

            raw = await resp.Content.ReadAsStringAsync(listCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && staleFallback != null)
        {
            return staleFallback;
        }
        using var doc = JsonDocument.Parse(raw);
        if (!doc.RootElement.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
        {
            return entries;
        }

        var parsedRows = new List<(
            int RequestId,
            int RequestStatus,
            string MediaType,
            int TmdbId,
            int MediaStatus,
            bool IsDownloading,
            int? DownloadProgress,
            string? JellyfinMediaId,
            List<int> Seasons,
            string CreatedAt,
            int? RequestedByUserId)>();

        foreach (var el in results.EnumerateArray())
        {
            var reqId = JsonInt(el, "id", 0);
            var reqStatus = Math.Clamp(JsonInt(el, "status", 1), 1, 5);
            var createdAt = JsonStr(el, "createdAt");
            var is4kReq = JsonBool(el, "is4k");

            int? reqById = null;
            if (el.TryGetProperty("requestedBy", out var rbEl) && rbEl.ValueKind == JsonValueKind.Object)
            {
                var parsedRb = JsonInt(rbEl, "id", 0);
                if (parsedRb > 0)
                {
                    reqById = parsedRb;
                }
            }

            if (!callerIsAdmin && (!callerSeerrUserId.HasValue || reqById != callerSeerrUserId.Value))
            {
                continue;
            }

            var mediaType = FirstNonEmpty(JsonStr(el, "type")).ToLowerInvariant();
            var tmdbId = 0;
            var mediaStatus = 2;
            var isDownloading = false;
            int? dlProgress = null;
            string? jfMediaId = null;

            if (el.TryGetProperty("media", out var mediaEl) && mediaEl.ValueKind == JsonValueKind.Object)
            {
                tmdbId = JsonInt(mediaEl, "tmdbId", 0);
                if (string.IsNullOrEmpty(mediaType))
                {
                    mediaType = JsonStr(mediaEl, "mediaType").Trim().ToLowerInvariant();
                }

                var rawSt = is4kReq ? JsonInt(mediaEl, "status4k", JsonInt(mediaEl, "status", 2)) : JsonInt(mediaEl, "status", 2);
                mediaStatus = NormalizeMediaStatus(rawSt);
                (isDownloading, dlProgress) = ExtractDownloadProgress(mediaEl);
                var jfId = FirstNonEmpty(JsonStr(mediaEl, "jellyfinMediaId"), JsonStr(mediaEl, "jellyfinMediaId4k"));
                if (!string.IsNullOrEmpty(jfId))
                {
                    jfMediaId = jfId;
                }

                var inlineTitle = FirstNonEmpty(JsonStr(mediaEl, "title"), JsonStr(mediaEl, "name"));
                if (tmdbId > 0 && !string.IsNullOrEmpty(inlineTitle) && mediaType is "movie" or "tv")
                {
                    var inlinePoster = BuildSafeTmdbImageUrl(JsonStr(mediaEl, "posterPath"), "w342");
                    var inlineBackdrop = BuildSafeTmdbImageUrl(JsonStr(mediaEl, "backdropPath"), "w1280");
                    StoreCachedMediaMeta(mediaType, tmdbId, inlineTitle, string.Empty, inlinePoster, inlineBackdrop, null, false, false);
                }
            }

            if (tmdbId <= 0 || mediaType is not ("movie" or "tv"))
            {
                continue;
            }

            var reqSeasons = new List<int>();
            if (el.TryGetProperty("seasons", out var sArr) && sArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var sEl in sArr.EnumerateArray())
                {
                    var sn = sEl.ValueKind == JsonValueKind.Number
                        ? (sEl.TryGetInt32(out var directSn) ? directSn : 0)
                        : JsonInt(sEl, "seasonNumber", 0);
                    if (sn > 0 && sn <= 200 && !reqSeasons.Contains(sn))
                    {
                        reqSeasons.Add(sn);
                    }
                }

                reqSeasons.Sort();
            }

            parsedRows.Add((reqId, reqStatus, mediaType, tmdbId, mediaStatus, isDownloading, dlProgress, jfMediaId, reqSeasons, createdAt, reqById));
            if (parsedRows.Count >= 18)
            {
                break;
            }
        }

        if (parsedRows.Count == 0)
        {
            return entries;
        }

        var uncachedPairs = parsedRows
            .Select(r => (r.MediaType, r.TmdbId))
            .Distinct()
            .Where(pair =>
            {
                var ck = $"{pair.MediaType}:{pair.TmdbId.ToString(CultureInfo.InvariantCulture)}";
                return !MediaMetaCache.TryGetValue(ck, out var c) || c.ExpiresAtUtc <= DateTime.UtcNow;
            })
            .Take(6)
            .ToList();

        if (uncachedPairs.Count > 0)
        {
            using var metaCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            metaCts.CancelAfter(TimeSpan.FromSeconds(4));
            using var gate = new SemaphoreSlim(6, 6);

            var fetchTasks = uncachedPairs.Select(async pair =>
            {
                var acquired = false;
                try
                {
                    await gate.WaitAsync(metaCts.Token).ConfigureAwait(false);
                    acquired = true;

                    var cacheKey = $"{pair.MediaType}:{pair.TmdbId.ToString(CultureInfo.InvariantCulture)}";
                    if (MediaMetaCache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAtUtc > DateTime.UtcNow)
                    {
                        return;
                    }

                    var metaUrl = $"{baseUrl}/api/v1/{pair.MediaType}/{pair.TmdbId.ToString(CultureInfo.InvariantCulture)}";
                    using var metaResp = await SendSeerrAsync(HttpMethod.Get, metaUrl, apiKey, authCtx?.ApiUserHeader, null, metaCts.Token).ConfigureAwait(false);
                    if (!metaResp.IsSuccessStatusCode)
                    {
                        return;
                    }

                    using var mDoc = JsonDocument.Parse(await metaResp.Content.ReadAsStringAsync(metaCts.Token).ConfigureAwait(false));
                    var mRoot = mDoc.RootElement;
                    var mTitle = FirstNonEmpty(JsonStr(mRoot, "title"), JsonStr(mRoot, "name"), JsonStr(mRoot, "originalTitle"), JsonStr(mRoot, "originalName"));
                    var mDate = FirstNonEmpty(JsonStr(mRoot, "releaseDate"), JsonStr(mRoot, "firstAirDate"));
                    var mYear = mDate.Length >= 4 && int.TryParse(mDate.AsSpan(0, 4), out var yr) && yr >= 1888 && yr <= 2100
                        ? yr.ToString(CultureInfo.InvariantCulture)
                        : string.Empty;
                    var mPoster = BuildSafeTmdbImageUrl(JsonStr(mRoot, "posterPath"), "w342");
                    var mBackdrop = BuildSafeTmdbImageUrl(JsonStr(mRoot, "backdropPath"), "w1280");
                    int? mTvdb = null;
                    if (mRoot.TryGetProperty("externalIds", out var extIds) && extIds.ValueKind == JsonValueKind.Object)
                    {
                        var tvdbVal = JsonInt(extIds, "tvdbId", 0);
                        if (tvdbVal > 0)
                        {
                            mTvdb = tvdbVal;
                        }
                    }

                    StoreCachedMediaMeta(pair.MediaType, pair.TmdbId, mTitle, mYear, mPoster, mBackdrop, mTvdb, JsonBool(mRoot, "adult"), HasMatureDetailGenres(mRoot));
                }
                catch
                {
                }
                finally
                {
                    if (acquired)
                    {
                        gate.Release();
                    }
                }
            });

            await Task.WhenAll(fetchTasks).ConfigureAwait(false);
        }

        foreach (var row in parsedRows)
        {
            var cacheKey = $"{row.MediaType}:{row.TmdbId.ToString(CultureInfo.InvariantCulture)}";
            MediaMetaCache.TryGetValue(cacheKey, out var meta);
            if (meta != null && (meta.IsAdult || (isKidsProfile && meta.IsMatureForKids)))
            {
                continue;
            }

            var title = meta != null && !string.IsNullOrEmpty(meta.Title)
                ? meta.Title
                : $"{(row.MediaType == "tv" ? "Series" : "Movie")} #{row.TmdbId.ToString(CultureInfo.InvariantCulture)}";
            var year = meta?.Year ?? string.Empty;
            var posterUrl = meta?.PosterUrl ?? string.Empty;
            var backdropUrl = meta?.BackdropUrl ?? string.Empty;

            string statusKey;
            string statusLabel;
            if (row.RequestStatus == 3)
            {
                statusKey = "declined";
                statusLabel = "Declined";
            }
            else if (row.RequestStatus == 4)
            {
                statusKey = "failed";
                statusLabel = "Failed";
            }
            else if (row.MediaStatus == 5)
            {
                statusKey = "available";
                statusLabel = "Available";
            }
            else if (row.MediaStatus == 4)
            {
                statusKey = "partial";
                statusLabel = "Partially Available";
            }
            else if (row.IsDownloading)
            {
                statusKey = "downloading";
                statusLabel = row.DownloadProgress.HasValue && row.DownloadProgress.Value > 0
                    ? $"Downloading · {row.DownloadProgress.Value}%"
                    : "Downloading";
            }
            else if (row.RequestStatus == 1)
            {
                statusKey = "pending";
                statusLabel = "Pending Approval";
            }
            else if (row.MediaStatus == 3)
            {
                statusKey = "processing";
                statusLabel = "Processing";
            }
            else
            {
                statusKey = "approved";
                statusLabel = "Approved · Queued";
            }

            var canCancelRow = callerIsAdmin
                || (row.RequestStatus == 1 && callerSeerrUserId.HasValue && row.RequestedByUserId == callerSeerrUserId.Value);

            entries.Add(new SeerrRequestEntry(
                RequestId: row.RequestId,
                TmdbId: row.TmdbId,
                MediaType: row.MediaType,
                Title: title,
                Year: year,
                PosterUrl: posterUrl,
                BackdropUrl: backdropUrl,
                RequestStatus: row.RequestStatus,
                MediaStatus: row.MediaStatus,
                StatusKey: statusKey,
                StatusLabel: statusLabel,
                DownloadProgress: row.IsDownloading ? row.DownloadProgress : null,
                Seasons: row.Seasons,
                CreatedAt: row.CreatedAt,
                JellyfinMediaId: row.JellyfinMediaId,
                RequestedByUserId: row.RequestedByUserId,
                CanCancel: canCancelRow));
        }

        RecentRequestsCache[reqCacheKey] = new CachedRequestsResult(entries, DateTime.UtcNow.AddSeconds(15));
        return entries;
    }

    public static async Task<SeerrSubmitResult> SubmitRequestAsync(
        PluginConfiguration config,
        int tmdbId,
        string mediaType,
        List<int>? requestedSeasons,
        bool? requestedIs4k,
        int? requestedServerId,
        StreamFlixProfileConfig? callerProfile,
        string? callerEmail,
        bool callerIsAdmin = false,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
        {
            throw new InvalidOperationException("Invalid media identifier.");
        }

        var cleanType = (mediaType ?? string.Empty).Trim().ToLowerInvariant();
        if (cleanType is not ("movie" or "tv"))
        {
            throw new InvalidOperationException("Media type must be 'movie' or 'tv'.");
        }

        if (!callerIsAdmin)
        {
            requestedServerId = null;
        }

        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);
        var authCtx = await ResolveApiAuthContextAsync(baseUrl, apiKey, cancellationToken).ConfigureAwait(false);

        // 1. Inspect available Radarr / Sonarr servers in Seerr so un-defaulted or 4K-only setups ALWAYS work!
        var servers = await GetServiceServersAsync(baseUrl, apiKey, authCtx?.ApiUserHeader, cleanType, cancellationToken).ConfigureAwait(false);
        SeerrServiceServer? chosenServer = null;
        if (callerIsAdmin && requestedServerId.HasValue && requestedServerId.Value >= 0)
        {
            chosenServer = servers.FirstOrDefault(s => s.Id == requestedServerId.Value);
        }

        bool effectiveIs4k;
        if (chosenServer != null)
        {
            effectiveIs4k = chosenServer.Is4k;
        }
        else if (requestedIs4k.HasValue)
        {
            effectiveIs4k = requestedIs4k.Value;
            chosenServer = servers.FirstOrDefault(s => s.Is4k == effectiveIs4k && s.IsDefault)
                ?? servers.FirstOrDefault(s => s.Is4k == effectiveIs4k);
        }
        else
        {
            var stdDefault = servers.FirstOrDefault(s => !s.Is4k && s.IsDefault) ?? servers.FirstOrDefault(s => !s.Is4k);
            if (stdDefault != null)
            {
                effectiveIs4k = false;
                chosenServer = stdDefault;
            }
            else
            {
                var only4k = servers.FirstOrDefault(s => s.Is4k && s.IsDefault) ?? servers.FirstOrDefault(s => s.Is4k);
                effectiveIs4k = only4k != null;
                chosenServer = only4k;
            }
        }

        // Only attach explicit serverId/profileId/rootFolder for administrators (or when Seerr has NO default server marked for an admin submission).
        var tierHasDefault = servers.Any(s => s.Is4k == effectiveIs4k && s.IsDefault);
        var attachExplicitService = callerIsAdmin && chosenServer != null && (requestedServerId.HasValue || !tierHasDefault);

        // 2. Resolve the requesting household profile's imported Seerr User ID and enforce Seerr user permissions & quotas!
        int? targetSeerrUserId = await ResolveMatchingSeerrUserIdAsync(
            baseUrl,
            apiKey,
            authCtx?.ApiUserHeader,
            authCtx?.AdminUserId,
            callerProfile,
            callerEmail,
            callerIsAdmin,
            cancellationToken).ConfigureAwait(false);

        if (!callerIsAdmin)
        {
            if (!targetSeerrUserId.HasValue || (authCtx != null && targetSeerrUserId.Value == authCtx.AdminUserId))
            {
                throw new UnauthorizedAccessException("Your Jellyfin account has not been imported into Seerr yet. Ask an administrator to import users in Seerr → Users.");
            }
        }
        else if (targetSeerrUserId.HasValue && authCtx != null && targetSeerrUserId.Value == authCtx.AdminUserId)
        {
            targetSeerrUserId = null;
        }

        // 3. For TV shows, resolve unrequested aired seasons & tvdbId cleanly
        List<int>? finalSeasons = null;
        int? tvdbId = null;
        if (cleanType == "tv")
        {
            var partialEnabled = await GetPublicSettingsAsync(baseUrl, apiKey, authCtx?.ApiUserHeader, cancellationToken).ConfigureAwait(false);
            var seasons = (requestedSeasons ?? new List<int>())
                .Where(s => s > 0 && s <= 200)
                .Distinct()
                .OrderBy(s => s)
                .ToList();

            var metaKey = $"tv:{tmdbId.ToString(CultureInfo.InvariantCulture)}";
            MediaMetaCache.TryGetValue(metaKey, out var cachedMeta);
            tvdbId = cachedMeta?.TvdbId;

            if (seasons.Count == 0 || !partialEnabled || !tvdbId.HasValue)
            {
                try
                {
                    using var tvCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    tvCts.CancelAfter(TimeSpan.FromSeconds(8));
                    var tvDetail = await GetMediaDetailsAsync(config, "tv", tmdbId, tvCts.Token).ConfigureAwait(false);
                    if (tvDetail.TvdbId.HasValue && tvDetail.TvdbId.Value > 0)
                    {
                        tvdbId = tvDetail.TvdbId;
                    }

                    if (seasons.Count == 0 || !partialEnabled)
                    {
                        var airedRequestable = tvDetail.Seasons
                            .Where(s => s.EpisodeCount > 0 && s.Status is 1 or 4)
                            .Select(s => s.SeasonNumber)
                            .ToList();
                        if (airedRequestable.Count == 0)
                        {
                            airedRequestable = tvDetail.Seasons
                                .Where(s => s.Status is 1 or 4)
                                .Select(s => s.SeasonNumber)
                                .ToList();
                        }

                        if (airedRequestable.Count == 0 && tvDetail.Seasons.Count > 0)
                        {
                            airedRequestable = tvDetail.Seasons
                                .Where(s => s.Status != 5)
                                .Select(s => s.SeasonNumber)
                                .ToList();
                        }

                        if (airedRequestable.Count > 0)
                        {
                            seasons = airedRequestable;
                        }
                    }
                }
                catch
                {
                }
            }

            if (seasons.Count == 0)
            {
                seasons.Add(1);
            }

            finalSeasons = seasons;
        }

        string BuildRequestBodyJson(int? forUserId)
        {
            var dict = new Dictionary<string, object>
            {
                ["mediaType"] = cleanType,
                ["mediaId"] = tmdbId,
                ["is4k"] = effectiveIs4k,
            };

            if (cleanType == "tv" && finalSeasons != null)
            {
                dict["seasons"] = finalSeasons;
                if (tvdbId.HasValue && tvdbId.Value > 0)
                {
                    dict["tvdbId"] = tvdbId.Value;
                }
            }

            if (attachExplicitService && chosenServer != null)
            {
                dict["serverId"] = chosenServer.Id;
                if (chosenServer.ActiveProfileId > 0)
                {
                    dict["profileId"] = chosenServer.ActiveProfileId;
                }

                if (!string.IsNullOrWhiteSpace(chosenServer.ActiveDirectory))
                {
                    dict["rootFolder"] = chosenServer.ActiveDirectory;
                }
            }

            if (forUserId.HasValue && forUserId.Value > 0)
            {
                dict["userId"] = forUserId.Value;
            }

            return JsonSerializer.Serialize(dict);
        }

        // Authenticate as the target Seerr user via X-Api-User for non-admin callers so Seerr enforces their REQUEST permission, quotas, and AUTO_APPROVE policy.
        var submitApiUserHeader = !callerIsAdmin && targetSeerrUserId.HasValue
            ? targetSeerrUserId.Value.ToString(CultureInfo.InvariantCulture)
            : authCtx?.ApiUserHeader;
        var payloadJson = BuildRequestBodyJson(callerIsAdmin ? targetSeerrUserId : null);

        using var resp = await SendSeerrWithCircuitBreakerAsync(
            HttpMethod.Post,
            baseUrl + "/api/v1/request",
            baseUrl,
            apiKey,
            submitApiUserHeader,
            payloadJson,
            cancellationToken).ConfigureAwait(false);

        var respBody = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        SearchCache.Clear();
        RecentRequestsCache.Clear();

        if ((int)resp.StatusCode == 409)
        {
            return new SeerrSubmitResult(true, null, 2, "Requested", "This title has already been requested in Seerr.");
        }

        if ((int)resp.StatusCode == 202)
        {
            var note = ExtractSeerrError(respBody) ?? "All available seasons are already requested or in your library.";
            return new SeerrSubmitResult(true, null, 2, "Requested", note);
        }

        if ((int)resp.StatusCode is 401 or 403)
        {
            var permErr = ExtractSeerrError(respBody) ?? "You do not have permission or remaining quota in Seerr to submit this request.";
            throw new UnauthorizedAccessException(permErr);
        }

        if (!resp.IsSuccessStatusCode)
        {
            var errMsg = ExtractSeerrError(respBody) ?? $"Seerr returned HTTP {(int)resp.StatusCode}.";
            throw new InvalidOperationException(errMsg);
        }

        int? createdReqId = null;
        var reqStatus = 2; // 1=PENDING, 2=APPROVED
        var newMediaStatus = 2;
        try
        {
            using var doc = JsonDocument.Parse(respBody);
            var root = doc.RootElement;

            // Guard against misconfigured reverse proxies that turned POST /api/v1/request into GET /api/v1/request
            if (root.TryGetProperty("results", out _) && !root.TryGetProperty("id", out _))
            {
                throw new InvalidOperationException("Seerr URL redirected POST to GET — update your Seerr URL in StreamFlix settings to the direct https:// or http://ip:port address.");
            }

            var parsedId = JsonInt(root, "id", 0);
            if (parsedId > 0)
            {
                createdReqId = parsedId;
            }

            reqStatus = JsonInt(root, "status", 2);
            if (root.TryGetProperty("media", out var mediaEl) && mediaEl.ValueKind == JsonValueKind.Object)
            {
                var rawMSt = effectiveIs4k
                    ? JsonInt(mediaEl, "status4k", JsonInt(mediaEl, "status", 2))
                    : JsonInt(mediaEl, "status", 2);
                newMediaStatus = Math.Clamp(NormalizeMediaStatus(rawMSt), 2, 5);
            }
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch
        {
        }

        var statusLabel = reqStatus == 1
            ? "Pending Approval"
            : (newMediaStatus >= 3 ? "Processing" : "Requested");
        var toastMsg = reqStatus == 1
            ? "Request submitted (awaiting approval in Seerr)!"
            : "Request approved & sent to Seerr!";

        return new SeerrSubmitResult(true, createdReqId, newMediaStatus, statusLabel, toastMsg);
    }

    public static async Task<(bool Ok, string Message)> CancelRequestAsync(
        PluginConfiguration config,
        int requestId,
        bool callerIsAdmin = true,
        StreamFlixProfileConfig? callerProfile = null,
        string? callerEmail = null,
        CancellationToken cancellationToken = default)
    {
        if (requestId <= 0)
        {
            throw new InvalidOperationException("Invalid request ID.");
        }

        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);
        var authCtx = await ResolveApiAuthContextAsync(baseUrl, apiKey, cancellationToken).ConfigureAwait(false);

        var deleteApiUserHeader = authCtx?.ApiUserHeader;
        if (!callerIsAdmin)
        {
            var callerSeerrUserId = await ResolveMatchingSeerrUserIdAsync(
                baseUrl,
                apiKey,
                authCtx?.ApiUserHeader,
                authCtx?.AdminUserId,
                callerProfile,
                callerEmail,
                callerIsAdmin: false,
                cancellationToken).ConfigureAwait(false);
            if (!callerSeerrUserId.HasValue)
            {
                throw new UnauthorizedAccessException("You can only cancel media requests submitted by your own account.");
            }

            using (var inspectResp = await SendSeerrWithCircuitBreakerAsync(
                HttpMethod.Get,
                $"{baseUrl}/api/v1/request/{requestId.ToString(CultureInfo.InvariantCulture)}",
                baseUrl,
                apiKey,
                authCtx?.ApiUserHeader,
                null,
                cancellationToken).ConfigureAwait(false))
            {
                if ((int)inspectResp.StatusCode == 404)
                {
                    return (true, "Request was already removed.");
                }

                if (!inspectResp.IsSuccessStatusCode)
                {
                    throw new InvalidOperationException($"Could not inspect request in Seerr (HTTP {(int)inspectResp.StatusCode}).");
                }

                var inspectRaw = await inspectResp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                using var inspectDoc = JsonDocument.Parse(inspectRaw);
                var inspectRoot = inspectDoc.RootElement;
                var reqStatus = JsonInt(inspectRoot, "status", 0);
                var reqById = inspectRoot.TryGetProperty("requestedBy", out var rbEl) && rbEl.ValueKind == JsonValueKind.Object
                    ? JsonInt(rbEl, "id", 0)
                    : 0;

                if (reqById <= 0 || reqById != callerSeerrUserId.Value)
                {
                    throw new UnauthorizedAccessException("You can only cancel media requests that you submitted.");
                }

                if (reqStatus != 1)
                {
                    throw new UnauthorizedAccessException("Only pending requests can be canceled by non-administrators.");
                }
            }

            deleteApiUserHeader = callerSeerrUserId.Value.ToString(CultureInfo.InvariantCulture);
        }

        using var resp = await SendSeerrWithCircuitBreakerAsync(
            HttpMethod.Delete,
            $"{baseUrl}/api/v1/request/{requestId.ToString(CultureInfo.InvariantCulture)}",
            baseUrl,
            apiKey,
            deleteApiUserHeader,
            null,
            cancellationToken).ConfigureAwait(false);

        SearchCache.Clear();
        RecentRequestsCache.Clear();

        if ((int)resp.StatusCode == 404)
        {
            return (true, "Request was already removed.");
        }

        if ((int)resp.StatusCode is 401 or 403)
        {
            var body = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new UnauthorizedAccessException(ExtractSeerrError(body) ?? "You do not have permission to cancel this request.");
        }

        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new InvalidOperationException(ExtractSeerrError(body) ?? $"Could not cancel request (HTTP {(int)resp.StatusCode}).");
        }

        return (true, "Request canceled.");
    }

    private static async Task<CachedApiAuthContext?> ResolveApiAuthContextAsync(
        string baseUrl,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var cacheKey = $"{baseUrl}|{apiKey.GetHashCode(StringComparison.Ordinal)}";
        if (ApiAuthCache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAtUtc > DateTime.UtcNow)
        {
            return cached;
        }

        // 1. Standard check without X-Api-User (works when Seerr user #1 exists)
        using (var meResp = await SendSeerrAsync(HttpMethod.Get, baseUrl + "/api/v1/auth/me", apiKey, null, null, cancellationToken).ConfigureAwait(false))
        {
            if (meResp.IsSuccessStatusCode)
            {
                var adminId = 1;
                try
                {
                    using var doc = JsonDocument.Parse(await meResp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
                    adminId = Math.Max(1, JsonInt(doc.RootElement, "id", 1));
                }
                catch
                {
                }

                var okCtx = new CachedApiAuthContext(null, adminId, DateTime.UtcNow.AddMinutes(15));
                ApiAuthCache[cacheKey] = okCtx;
                return okCtx;
            }
        }

        // 2. Recovery when initial Seerr setup user #1 was deleted: query /api/v1/user once to locate an admin ID, then fall back to a brief bounded probe.
        try
        {
            using var usersCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            usersCts.CancelAfter(TimeSpan.FromSeconds(4));
            using var usersResp = await SendSeerrAsync(HttpMethod.Get, baseUrl + "/api/v1/user?take=100&skip=0", apiKey, null, null, usersCts.Token).ConfigureAwait(false);
            if (usersResp.IsSuccessStatusCode)
            {
                using var uDoc = JsonDocument.Parse(await usersResp.Content.ReadAsStringAsync(usersCts.Token).ConfigureAwait(false));
                if (uDoc.RootElement.TryGetProperty("results", out var uResults) && uResults.ValueKind == JsonValueKind.Array)
                {
                    foreach (var uEl in uResults.EnumerateArray())
                    {
                        var uid = JsonInt(uEl, "id", 0);
                        var uPerms = JsonInt(uEl, "permissions", 0);
                        if (uid > 0 && (uPerms & 2) != 0)
                        {
                            var headerVal = uid.ToString(CultureInfo.InvariantCulture);
                            var recoveredFromList = new CachedApiAuthContext(headerVal, uid, DateTime.UtcNow.AddMinutes(15));
                            ApiAuthCache[cacheKey] = recoveredFromList;
                            return recoveredFromList;
                        }
                    }
                }
            }
        }
        catch
        {
        }

        for (var candidateId = 2; candidateId <= 6; candidateId++)
        {
            var headerVal = candidateId.ToString(CultureInfo.InvariantCulture);
            try
            {
                using var probeCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                probeCts.CancelAfter(TimeSpan.FromSeconds(2));
                using var probeResp = await SendSeerrAsync(HttpMethod.Get, baseUrl + "/api/v1/auth/me", apiKey, headerVal, null, probeCts.Token).ConfigureAwait(false);
                if (!probeResp.IsSuccessStatusCode)
                {
                    continue;
                }

                using var doc = JsonDocument.Parse(await probeResp.Content.ReadAsStringAsync(probeCts.Token).ConfigureAwait(false));
                var foundId = JsonInt(doc.RootElement, "id", candidateId);
                var perms = JsonInt(doc.RootElement, "permissions", 0);
                if ((perms & 2) != 0 || candidateId == 2)
                {
                    var recovered = new CachedApiAuthContext(headerVal, foundId, DateTime.UtcNow.AddMinutes(15));
                    ApiAuthCache[cacheKey] = recovered;
                    return recovered;
                }
            }
            catch
            {
            }
        }

        var defaultFallback = new CachedApiAuthContext(null, 1, DateTime.UtcNow.AddMinutes(3));
        ApiAuthCache[cacheKey] = defaultFallback;
        return defaultFallback;
    }

    private static async Task<List<SeerrServiceServer>> GetServiceServersAsync(
        string baseUrl,
        string apiKey,
        string? apiUserHeader,
        string mediaType,
        CancellationToken cancellationToken)
    {
        var serviceKind = mediaType == "tv" ? "sonarr" : "radarr";
        var cacheKey = $"{baseUrl}|{serviceKind}";
        if (ServersCache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAtUtc > DateTime.UtcNow)
        {
            return cached.Servers;
        }

        var list = new List<SeerrServiceServer>();
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(4));
            using var resp = await SendSeerrAsync(HttpMethod.Get, $"{baseUrl}/api/v1/service/{serviceKind}", apiKey, apiUserHeader, null, cts.Token).ConfigureAwait(false);
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false));
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        var id = JsonInt(el, "id", -1);
                        if (id < 0)
                        {
                            continue;
                        }

                        var name = FirstNonEmpty(JsonStr(el, "name"), serviceKind == "sonarr" ? "Sonarr" : "Radarr");
                        var is4k = JsonBool(el, "is4k");
                        var isDefault = JsonBool(el, "isDefault");
                        var activeProfileId = JsonInt(el, "activeProfileId", 0);
                        var activeDir = JsonStr(el, "activeDirectory").Trim();
                        list.Add(new SeerrServiceServer(id, name, is4k, isDefault, activeProfileId, activeDir));
                    }
                }
            }
        }
        catch
        {
        }

        ServersCache[cacheKey] = new CachedServiceServers(list, DateTime.UtcNow.AddMinutes(2));
        return list;
    }

    private static async Task<bool> GetPublicSettingsAsync(
        string baseUrl,
        string apiKey,
        string? apiUserHeader,
        CancellationToken cancellationToken)
    {
        if (PublicSettingsCache.TryGetValue(baseUrl, out var cached) && cached.ExpiresAtUtc > DateTime.UtcNow)
        {
            return cached.PartialRequestsEnabled;
        }

        var partialEnabled = true;
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(3));
            using var resp = await SendSeerrAsync(HttpMethod.Get, baseUrl + "/api/v1/settings/public", apiKey, apiUserHeader, null, cts.Token).ConfigureAwait(false);
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false));
                if (doc.RootElement.TryGetProperty("partialRequestsEnabled", out var prop)
                    && (prop.ValueKind == JsonValueKind.True || prop.ValueKind == JsonValueKind.False))
                {
                    partialEnabled = prop.GetBoolean();
                }
            }
        }
        catch
        {
        }

        PublicSettingsCache[baseUrl] = new CachedPublicSettings(partialEnabled, DateTime.UtcNow.AddMinutes(5));
        return partialEnabled;
    }

    private static async Task<int?> ResolveMatchingSeerrUserIdAsync(
        string baseUrl,
        string apiKey,
        string? apiUserHeader,
        int? adminUserId,
        StreamFlixProfileConfig? profile,
        string? callerEmail,
        bool callerIsAdmin,
        CancellationToken cancellationToken)
    {
        if (profile == null && string.IsNullOrWhiteSpace(callerEmail))
        {
            return null;
        }

        var users = await GetSeerrUsersCachedAsync(baseUrl, apiKey, apiUserHeader, cancellationToken).ConfigureAwait(false);
        if (users.Count == 0)
        {
            return null;
        }

        bool IsEligibleUser(SeerrUserSummary u)
        {
            if (callerIsAdmin)
            {
                return true;
            }

            // Seerr Permission.ADMIN == 2; non-admin Jellyfin callers may never map onto a Seerr administrator account.
            if ((u.Permissions & 2) != 0)
            {
                return false;
            }

            if (adminUserId.HasValue && u.Id == adminUserId.Value)
            {
                return false;
            }

            return true;
        }

        var jfNorm = NormalizeHexGuid(profile?.JellyfinUserId);
        if (!string.IsNullOrEmpty(jfNorm))
        {
            var byJf = users.FirstOrDefault(u => string.Equals(u.JellyfinUserIdNorm, jfNorm, StringComparison.OrdinalIgnoreCase));
            if (byJf != null)
            {
                return IsEligibleUser(byJf) ? byJf.Id : null;
            }
        }

        if (!string.IsNullOrEmpty(jfNorm) && !string.IsNullOrWhiteSpace(profile?.JellyfinUsername))
        {
            var verifiedJfUsername = profile!.JellyfinUsername.Trim();
            var byVerifiedUsername = users.FirstOrDefault(u =>
                string.IsNullOrEmpty(u.JellyfinUserIdNorm)
                && string.Equals(u.Username, verifiedJfUsername, StringComparison.OrdinalIgnoreCase));
            if (byVerifiedUsername != null)
            {
                return IsEligibleUser(byVerifiedUsername) ? byVerifiedUsername.Id : null;
            }
        }

        var verifiedEmail = (callerEmail ?? string.Empty).Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(verifiedEmail))
        {
            var byEmail = users.FirstOrDefault(u => string.Equals(u.Email, verifiedEmail, StringComparison.OrdinalIgnoreCase));
            if (byEmail != null)
            {
                return IsEligibleUser(byEmail) ? byEmail.Id : null;
            }
        }

        return null;
    }

    private static async Task<List<SeerrUserSummary>> GetSeerrUsersCachedAsync(
        string baseUrl,
        string apiKey,
        string? apiUserHeader,
        CancellationToken cancellationToken)
    {
        if (UsersCache.TryGetValue(baseUrl, out var cached) && cached.ExpiresAtUtc > DateTime.UtcNow)
        {
            return cached.Users;
        }

        var list = new List<SeerrUserSummary>();
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(4));
            using var resp = await SendSeerrAsync(HttpMethod.Get, baseUrl + "/api/v1/user?take=100&skip=0", apiKey, apiUserHeader, null, cts.Token).ConfigureAwait(false);
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false));
                if (doc.RootElement.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array)
                {
                    foreach (var uEl in results.EnumerateArray())
                    {
                        var id = JsonInt(uEl, "id", 0);
                        if (id <= 0)
                        {
                            continue;
                        }

                        var jfId = NormalizeHexGuid(JsonStr(uEl, "jellyfinUserId"));
                        var uname = FirstNonEmpty(JsonStr(uEl, "jellyfinUsername"), JsonStr(uEl, "username"), JsonStr(uEl, "displayName"));
                        var email = JsonStr(uEl, "email").Trim();
                        var perms = JsonInt(uEl, "permissions", 0);
                        list.Add(new SeerrUserSummary(id, jfId, uname, email, perms));
                    }
                }
            }
        }
        catch
        {
        }

        UsersCache[baseUrl] = new CachedSeerrUsers(list, DateTime.UtcNow.AddMinutes(5));
        return list;
    }

    private static string NormalizeHexGuid(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        return raw.Trim().Replace("-", string.Empty, StringComparison.Ordinal).ToLowerInvariant();
    }

    private static string EncodeSeerrQueryParam(string value)
    {
        return Uri.EscapeDataString(value)
            .Replace("(", "%28", StringComparison.Ordinal)
            .Replace(")", "%29", StringComparison.Ordinal)
            .Replace("!", "%21", StringComparison.Ordinal)
            .Replace("*", "%2A", StringComparison.Ordinal);
    }

    private static bool ValidateSeerrCertificate(object sender, X509Certificate? certificate, X509Chain? chain, SslPolicyErrors sslPolicyErrors)
    {
        if (sslPolicyErrors == SslPolicyErrors.None)
        {
            return true;
        }

        // Allow self-signed / local reverse-proxy certificates ONLY on private RFC1918, loopback, or internal single-label Docker hosts
        if (sender is SslStream sslStream)
        {
            var targetHost = sslStream.TargetHostName ?? string.Empty;
            if (string.Equals(targetHost, "localhost", StringComparison.OrdinalIgnoreCase)
                || string.Equals(targetHost, "host.docker.internal", StringComparison.OrdinalIgnoreCase)
                || !targetHost.Contains('.', StringComparison.Ordinal)
                || targetHost.EndsWith(".local", StringComparison.OrdinalIgnoreCase)
                || targetHost.EndsWith(".lan", StringComparison.OrdinalIgnoreCase)
                || targetHost.EndsWith(".internal", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (IPAddress.TryParse(targetHost, out var ip) && IsPrivateOrLoopbackIp(ip))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsPrivateOrLoopbackIp(IPAddress rawIp)
    {
        var ip = rawIp.IsIPv4MappedToIPv6 ? rawIp.MapToIPv4() : rawIp;
        if (IPAddress.IsLoopback(ip))
        {
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return b[0] == 10
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127); // Tailscale / CGNAT
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var b = ip.GetAddressBytes();
            return (b[0] & 0xfe) == 0xfc; // ULA fc00::/7
        }

        return false;
    }

    public static async Task ValidateSafeSeerrBaseUrlAsync(string rawBaseUrl, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(rawBaseUrl, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException("Seerr URL must be a valid http:// or https:// address.");
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Only http:// or https:// Seerr URLs are supported.");
        }

        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new InvalidOperationException("Seerr URL must not embed credentials, query parameters, or URL fragments.");
        }

        await ResolveAndValidateHostAddressesAsync(uri.DnsSafeHost, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<IPAddress[]> ResolveAndValidateHostAddressesAsync(string host, CancellationToken cancellationToken)
    {
        if (IPAddress.TryParse(host, out var literalIp))
        {
            var norm = literalIp.IsIPv4MappedToIPv6 ? literalIp.MapToIPv4() : literalIp;
            if (IsForbiddenMetadataOrUnspecifiedIp(norm))
            {
                throw new InvalidOperationException("Seerr target IP is blocked by SSRF security policy.");
            }

            return new[] { norm };
        }

        if (DnsCache.TryGetValue(host, out var cached) && cached.ExpiresAtUtc > DateTime.UtcNow && cached.Addresses.Length > 0)
        {
            return cached.Addresses;
        }

        var rawAddrs = await Dns.GetHostAddressesAsync(host, cancellationToken).ConfigureAwait(false);
        if (rawAddrs.Length == 0)
        {
            throw new InvalidOperationException($"Could not resolve Seerr host '{host}'.");
        }

        var ordered = new List<IPAddress>(rawAddrs.Length);
        foreach (var rawIp in rawAddrs)
        {
            var ip = rawIp.IsIPv4MappedToIPv6 ? rawIp.MapToIPv4() : rawIp;
            if (IsForbiddenMetadataOrUnspecifiedIp(ip))
            {
                throw new InvalidOperationException("Seerr target IP is blocked by SSRF security policy.");
            }

            ordered.Add(ip);
        }

        var sorted = ordered
            .OrderBy(a => a.AddressFamily == AddressFamily.InterNetwork ? 0 : 1)
            .ToArray();

        if (DnsCache.Count > 64)
        {
            DnsCache.Clear();
        }

        DnsCache[host] = new CachedHostAddresses(sorted, DateTime.UtcNow.AddMinutes(2));
        return sorted;
    }

    private static async ValueTask<Stream> ConnectSeerrSocketAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var host = context.DnsEndPoint.Host;
        var port = context.DnsEndPoint.Port;
        var addresses = await ResolveAndValidateHostAddressesAsync(host, cancellationToken).ConfigureAwait(false);

        Exception? lastEx = null;
        var sawConnectionRefused = false;

        foreach (var ip in addresses)
        {
            var socket = new Socket(ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
            {
                NoDelay = true,
            };

            try
            {
                using var perIpCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                perIpCts.CancelAfter(TimeSpan.FromMilliseconds(2500));
                await socket.ConnectAsync(new IPEndPoint(ip, port), perIpCts.Token).ConfigureAwait(false);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception ex)
            {
                socket.Dispose();
                if (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }

                if (ex is SocketException se && se.SocketErrorCode == SocketError.ConnectionRefused)
                {
                    sawConnectionRefused = true;
                }

                lastEx = ex;
            }
        }

        if (sawConnectionRefused
            && (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) || string.Equals(host, "127.0.0.1", StringComparison.Ordinal)))
        {
            try
            {
                var dockerHostIps = await ResolveAndValidateHostAddressesAsync("host.docker.internal", cancellationToken).ConfigureAwait(false);
                foreach (var dip in dockerHostIps)
                {
                    var dSocket = new Socket(dip.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                    try
                    {
                        using var dCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                        dCts.CancelAfter(TimeSpan.FromMilliseconds(2000));
                        await dSocket.ConnectAsync(new IPEndPoint(dip, port), dCts.Token).ConfigureAwait(false);
                        return new NetworkStream(dSocket, ownsSocket: true);
                    }
                    catch
                    {
                        dSocket.Dispose();
                    }
                }
            }
            catch
            {
            }
        }

        throw lastEx ?? new SocketException((int)SocketError.HostUnreachable);
    }

    private static async Task<HttpResponseMessage> SendSeerrWithCircuitBreakerAsync(
        HttpMethod method,
        string url,
        string baseUrl,
        string apiKey,
        string? apiUserHeader,
        string? jsonBody,
        CancellationToken cancellationToken)
    {
        try
        {
            var resp = await SendSeerrAsync(method, url, apiKey, apiUserHeader, jsonBody, cancellationToken).ConfigureAwait(false);
            if (string.Equals(_unreachableBaseUrl, baseUrl, StringComparison.OrdinalIgnoreCase))
            {
                Interlocked.Exchange(ref _unreachableUntilTicks, 0);
            }

            return resp;
        }
        catch (HttpRequestException)
        {
            MarkTemporarilyUnreachable(baseUrl);
            throw;
        }
        catch (SocketException)
        {
            MarkTemporarilyUnreachable(baseUrl);
            throw;
        }
    }

    private static async Task<HttpResponseMessage> SendSeerrAsync(
        HttpMethod method,
        string url,
        string apiKey,
        string? apiUserHeader,
        string? jsonBody,
        CancellationToken cancellationToken)
    {
        var currentUri = new Uri(url, UriKind.Absolute);
        var initialHost = currentUri.DnsSafeHost;

        for (var hop = 0; hop <= 3; hop++)
        {
            using var req = new HttpRequestMessage(method, currentUri);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var isTrustedSameHost = string.Equals(currentUri.DnsSafeHost, initialHost, StringComparison.OrdinalIgnoreCase)
                || string.Equals(currentUri.DnsSafeHost, "www." + initialHost, StringComparison.OrdinalIgnoreCase)
                || string.Equals("www." + currentUri.DnsSafeHost, initialHost, StringComparison.OrdinalIgnoreCase);

            if (isTrustedSameHost && !string.IsNullOrEmpty(apiKey))
            {
                req.Headers.TryAddWithoutValidation("X-Api-Key", apiKey);
                if (!string.IsNullOrEmpty(apiUserHeader))
                {
                    req.Headers.TryAddWithoutValidation("X-Api-User", apiUserHeader);
                }
            }

            if (jsonBody != null && (method == HttpMethod.Post || method == HttpMethod.Put))
            {
                req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
            }

            var resp = await SeerrHttp.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            var code = (int)resp.StatusCode;
            if (code is not (301 or 302 or 303 or 307 or 308) || resp.Headers.Location == null || hop == 3)
            {
                return resp;
            }

            var loc = resp.Headers.Location;
            resp.Dispose();

            var nextUri = loc.IsAbsoluteUri ? loc : new Uri(currentUri, loc);
            if (!string.Equals(nextUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(nextUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Seerr redirect pointed to an unsupported URL scheme.");
            }

            await ResolveAndValidateHostAddressesAsync(nextUri.DnsSafeHost, cancellationToken).ConfigureAwait(false);

            // Never silently turn a POST/DELETE API mutation into a GET on redirect; if redirected off-host, reject explicitly
            var nextTrusted = string.Equals(nextUri.DnsSafeHost, initialHost, StringComparison.OrdinalIgnoreCase)
                || string.Equals(nextUri.DnsSafeHost, "www." + initialHost, StringComparison.OrdinalIgnoreCase)
                || string.Equals("www." + nextUri.DnsSafeHost, initialHost, StringComparison.OrdinalIgnoreCase);
            if (!nextTrusted && method != HttpMethod.Get)
            {
                throw new InvalidOperationException($"Seerr redirected API request to a different host ('{nextUri.DnsSafeHost}'). Update your Seerr URL in StreamFlix settings.");
            }

            currentUri = nextUri;
        }

        throw new InvalidOperationException("Too many redirects from Seerr.");
    }

    private static bool IsTemporarilyUnreachable(string baseUrl)
    {
        var until = Interlocked.Read(ref _unreachableUntilTicks);
        return until > DateTime.UtcNow.Ticks && string.Equals(_unreachableBaseUrl, baseUrl, StringComparison.OrdinalIgnoreCase);
    }

    private static void MarkTemporarilyUnreachable(string baseUrl)
    {
        _unreachableBaseUrl = baseUrl;
        Interlocked.Exchange(ref _unreachableUntilTicks, DateTime.UtcNow.AddSeconds(12).Ticks);
    }

    private static void PruneSearchCacheIfNeeded()
    {
        if (SearchCache.Count <= 96)
        {
            return;
        }

        var now = DateTime.UtcNow;
        foreach (var kv in SearchCache)
        {
            if (kv.Value.ExpiresAtUtc <= now)
            {
                SearchCache.TryRemove(kv.Key, out _);
            }
        }
    }

    private static void StoreCachedMediaMeta(
        string mediaType,
        int tmdbId,
        string title,
        string year,
        string posterUrl,
        string backdropUrl,
        int? tvdbId,
        bool isAdult,
        bool isMatureForKids)
    {
        if (tmdbId <= 0 || string.IsNullOrEmpty(title))
        {
            return;
        }

        if (MediaMetaCache.Count > 500)
        {
            var now = DateTime.UtcNow;
            foreach (var kv in MediaMetaCache)
            {
                if (kv.Value.ExpiresAtUtc <= now)
                {
                    MediaMetaCache.TryRemove(kv.Key, out _);
                }
            }
        }

        var key = $"{mediaType}:{tmdbId.ToString(CultureInfo.InvariantCulture)}";
        MediaMetaCache.TryGetValue(key, out var existing);
        MediaMetaCache[key] = new CachedMediaMeta(
            Title: title,
            Year: !string.IsNullOrEmpty(year) ? year : (existing?.Year ?? string.Empty),
            PosterUrl: !string.IsNullOrEmpty(posterUrl) ? posterUrl : (existing?.PosterUrl ?? string.Empty),
            BackdropUrl: !string.IsNullOrEmpty(backdropUrl) ? backdropUrl : (existing?.BackdropUrl ?? string.Empty),
            TvdbId: tvdbId ?? existing?.TvdbId,
            IsAdult: isAdult,
            IsMatureForKids: isMatureForKids,
            ExpiresAtUtc: DateTime.UtcNow.AddMinutes(60));
    }

    private static (bool IsDownloading, int? ProgressPercent) ExtractDownloadProgress(JsonElement mediaObj)
    {
        if (mediaObj.ValueKind != JsonValueKind.Object)
        {
            return (false, null);
        }

        long totalSize = 0;
        long totalLeft = 0;
        var hasAnyItem = false;

        foreach (var propName in new[] { "downloadStatus", "downloadStatus4k" })
        {
            if (!mediaObj.TryGetProperty(propName, out var arr) || arr.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                hasAnyItem = true;
                var size = JsonLong(item, "size");
                var left = JsonLong(item, "sizeLeft");
                if (size > 0)
                {
                    totalSize += size;
                    totalLeft += Math.Clamp(left, 0, size);
                }
            }
        }

        if (!hasAnyItem)
        {
            return (false, null);
        }

        if (totalSize > 0)
        {
            var pct = (int)Math.Clamp(Math.Round((1.0 - ((double)totalLeft / totalSize)) * 100.0), 0, 100);
            return (true, pct);
        }

        return (true, null);
    }

    private static bool HasMatureDetailGenres(JsonElement root)
    {
        if (HasMatureTmdbGenre(root))
        {
            return true;
        }

        if (root.TryGetProperty("genres", out var gArr) && gArr.ValueKind == JsonValueKind.Array)
        {
            foreach (var g in gArr.EnumerateArray())
            {
                var gid = JsonInt(g, "id", 0);
                var gName = JsonStr(g, "name");
                if (gid == 27 || string.Equals(gName, "Horror", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static string BuildSafeTmdbImageUrl(string rawPath, string sizeBucket)
    {
        var trimmed = (rawPath ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(trimmed) || !SafeTmdbImagePathRegex.IsMatch(trimmed))
        {
            return string.Empty;
        }

        return $"https://image.tmdb.org/t/p/{sizeBucket}{trimmed}";
    }

    private static bool HasMatureTmdbGenre(JsonElement el)
    {
        if (!el.TryGetProperty("genreIds", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var gid))
            {
                if (gid == 27)
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static string? ExtractSeerrError(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var msg = FirstNonEmpty(JsonStr(root, "message"), JsonStr(root, "error"));
            if (root.TryGetProperty("errors", out var errs) && errs.ValueKind == JsonValueKind.Array)
            {
                foreach (var eEl in errs.EnumerateArray())
                {
                    var sub = eEl.ValueKind == JsonValueKind.String ? eEl.GetString() : JsonStr(eEl, "message");
                    if (!string.IsNullOrWhiteSpace(sub))
                    {
                        msg = string.IsNullOrWhiteSpace(msg) ? sub! : $"{msg} ({sub})";
                        break;
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(msg))
            {
                return msg.Length > 220 ? msg.Substring(0, 220) : msg;
            }
        }
        catch
        {
        }

        return null;
    }

    private static bool IsForbiddenMetadataOrUnspecifiedIp(IPAddress ip)
    {
        if (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast))
        {
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            if (b[0] == 0 || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] == 100 && b[2] == 100 && b[3] == 200))
            {
                return true;
            }
        }
        else if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6Multicast)
            {
                return true;
            }

            var b = ip.GetAddressBytes();
            if (b[0] == 0xfd && b[1] == 0x00 && b[2] == 0x0e && b[3] == 0xc2)
            {
                return true;
            }
        }

        return false;
    }

    private static string JsonStr(JsonElement obj, string propName)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(propName, out var prop))
        {
            return prop.ValueKind switch
            {
                JsonValueKind.String => prop.GetString() ?? string.Empty,
                JsonValueKind.Number => prop.GetRawText(),
                _ => string.Empty,
            };
        }

        return string.Empty;
    }

    private static int JsonInt(JsonElement obj, string propName, int fallback = 0)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(propName, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out var v))
            {
                return v;
            }

            if (prop.ValueKind == JsonValueKind.String && int.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv))
            {
                return sv;
            }
        }

        return fallback;
    }

    private static long JsonLong(JsonElement obj, string propName, long fallback = 0)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(propName, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt64(out var v))
            {
                return v;
            }

            if (prop.ValueKind == JsonValueKind.String && long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv))
            {
                return sv;
            }
        }

        return fallback;
    }

    private static double JsonDouble(JsonElement obj, string propName)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(propName, out var prop) && prop.ValueKind == JsonValueKind.Number && prop.TryGetDouble(out var d))
        {
            return d;
        }

        return 0;
    }

    private static bool JsonBool(JsonElement obj, string propName)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(propName, out var prop))
        {
            return prop.ValueKind == JsonValueKind.True;
        }

        return false;
    }

    private static string FirstNonEmpty(params string?[] vals)
    {
        foreach (var v in vals)
        {
            if (!string.IsNullOrWhiteSpace(v))
            {
                return v.Trim();
            }
        }

        return string.Empty;
    }
}
