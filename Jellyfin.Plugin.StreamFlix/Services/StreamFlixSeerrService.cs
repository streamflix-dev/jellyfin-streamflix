using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Server-side client for Seerr / Jellyseerr / Overseerr (<c>/api/v1</c>).
/// Keeps the configured API key strictly on the Jellyfin server, enforces SSRF protections,
/// and normalizes search, TV season inspection, and media request operations.
/// </summary>
public static class StreamFlixSeerrService
{
    private static readonly HttpClient SeerrHttp = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectTimeout = TimeSpan.FromSeconds(5),
    })
    {
        Timeout = TimeSpan.FromSeconds(10),
    };

    private static readonly Regex SafeTmdbImagePathRegex = new(@"^/[a-zA-Z0-9._-]+$", RegexOptions.Compiled);

    public sealed record SeerrDiagnosticCheck(string Status, string Label, string Detail);

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
        string? JellyfinMediaId);

    public sealed record SeerrSeasonItem(
        int SeasonNumber,
        string Name,
        int EpisodeCount,
        string Year,
        int Status,
        string StatusLabel);

    public sealed record SeerrTvDetail(
        int TmdbId,
        string Title,
        string Year,
        string Overview,
        string BackdropUrl,
        int MediaStatus,
        string StatusLabel,
        List<SeerrSeasonItem> Seasons);

    public static bool IsConfigured(PluginConfiguration config)
    {
        return config.EnableSeerr
            && !string.IsNullOrWhiteSpace(config.SeerrUrl)
            && !string.IsNullOrWhiteSpace(config.SeerrApiKey);
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

    public static string MapStatusLabel(int status) => status switch
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
        var checks = new List<SeerrDiagnosticCheck>();
        var baseUrl = NormalizeBaseUrl(rawUrl);
        var apiKey = (rawApiKey ?? string.Empty).Trim();

        if (string.IsNullOrEmpty(baseUrl))
        {
            checks.Add(new("error", "Seerr URL", "Enter your Seerr / Jellyseerr URL (e.g. http://localhost:5055 or https://requests.example.com)."));
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
                using var statusReq = BuildGetRequest(baseUrl + "/api/v1/status", apiKey);
                using var statusResp = await SeerrHttp.SendAsync(statusReq, cancellationToken).ConfigureAwait(false);
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

                    // Verify API Key authorization on a protected endpoint (/api/v1/auth/me or /api/v1/request/count)
                    using var authReq = BuildGetRequest(baseUrl + "/api/v1/auth/me", apiKey);
                    using var authResp = await SeerrHttp.SendAsync(authReq, cancellationToken).ConfigureAwait(false);
                    if (authResp.IsSuccessStatusCode)
                    {
                        checks.Add(new("ok", "API Key Authentication", "API key verified successfully against /api/v1/auth/me."));
                    }
                    else
                    {
                        using var fallbackReq = BuildGetRequest(baseUrl + "/api/v1/request/count", apiKey);
                        using var fallbackResp = await SeerrHttp.SendAsync(fallbackReq, cancellationToken).ConfigureAwait(false);
                        if (fallbackResp.IsSuccessStatusCode)
                        {
                            checks.Add(new("ok", "API Key Authentication", "API key verified successfully against /api/v1/request/count."));
                        }
                        else if ((int)authResp.StatusCode is 401 or 403 || (int)fallbackResp.StatusCode is 401 or 403)
                        {
                            checks.Add(new("error", "API Key Authentication", "Seerr rejected the API key (HTTP 401/403). Copy the key from Seerr → Settings → General → API Key."));
                        }
                        else
                        {
                            checks.Add(new("warn", "API Key Authentication", $"Protected endpoint returned HTTP {(int)authResp.StatusCode}; verify request permissions."));
                        }
                    }
                }
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
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);

        var url = $"{baseUrl}/api/v1/search?query={Uri.EscapeDataString(q)}&page=1&language=en";
        using var req = BuildGetRequest(url, apiKey);
        using var resp = await SeerrHttp.SendAsync(req, cancellationToken).ConfigureAwait(false);
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

            // Extra safety for Kids profiles when SeerrAllowKids is enabled: skip titles whose TMDB genreIds include Horror (27) / Crime (80)
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
            var posterUrl = BuildSafeTmdbImageUrl(JsonStr(el, "posterPath"), "w500");
            var backdropUrl = BuildSafeTmdbImageUrl(JsonStr(el, "backdropPath"), "w1280");

            var mediaStatus = 1;
            string? jfMediaId = null;
            if (el.TryGetProperty("mediaInfo", out var mi) && mi.ValueKind == JsonValueKind.Object)
            {
                mediaStatus = Math.Clamp(JsonInt(mi, "status", 1), 1, 6);
                var jfId = FirstNonEmpty(JsonStr(mi, "jellyfinMediaId"), JsonStr(mi, "jellyfinMediaId4k"));
                if (!string.IsNullOrEmpty(jfId))
                {
                    jfMediaId = jfId;
                }
            }

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
                StatusLabel: MapStatusLabel(mediaStatus),
                JellyfinMediaId: jfMediaId));

            if (items.Count >= 24)
            {
                break;
            }
        }

        return items;
    }

    public static async Task<SeerrTvDetail> GetTvDetailsAsync(
        PluginConfiguration config,
        int tmdbId,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(tmdbId));
        }

        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);

        using var req = BuildGetRequest($"{baseUrl}/api/v1/tv/{tmdbId.ToString(CultureInfo.InvariantCulture)}", apiKey);
        using var resp = await SeerrHttp.SendAsync(req, cancellationToken).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Could not load TV seasons from Seerr (HTTP {(int)resp.StatusCode}).");
        }

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
        var root = doc.RootElement;

        var title = FirstNonEmpty(JsonStr(root, "name"), JsonStr(root, "originalName"), "Series");
        var dateRaw = JsonStr(root, "firstAirDate");
        var year = dateRaw.Length >= 4 ? dateRaw.Substring(0, 4) : string.Empty;
        var overview = JsonStr(root, "overview").Trim();
        var backdropUrl = BuildSafeTmdbImageUrl(JsonStr(root, "backdropPath"), "w1280");

        var mediaStatus = 1;
        var seasonStatuses = new Dictionary<int, int>();
        if (root.TryGetProperty("mediaInfo", out var mi) && mi.ValueKind == JsonValueKind.Object)
        {
            mediaStatus = Math.Clamp(JsonInt(mi, "status", 1), 1, 6);
            if (mi.TryGetProperty("seasons", out var miSeasons) && miSeasons.ValueKind == JsonValueKind.Array)
            {
                foreach (var ms in miSeasons.EnumerateArray())
                {
                    var sNum = JsonInt(ms, "seasonNumber", -1);
                    var sSt = Math.Clamp(JsonInt(ms, "status", 1), 1, 6);
                    if (sNum >= 0)
                    {
                        seasonStatuses[sNum] = sSt;
                    }
                }
            }
        }

        var seasons = new List<SeerrSeasonItem>();
        if (root.TryGetProperty("seasons", out var seasonsArr) && seasonsArr.ValueKind == JsonValueKind.Array)
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
                    StatusLabel: MapStatusLabel(st)));
            }
        }

        seasons.Sort((a, b) => a.SeasonNumber.CompareTo(b.SeasonNumber));
        return new SeerrTvDetail(
            TmdbId: tmdbId,
            Title: title,
            Year: year,
            Overview: overview,
            BackdropUrl: backdropUrl,
            MediaStatus: mediaStatus,
            StatusLabel: MapStatusLabel(mediaStatus),
            Seasons: seasons);
    }

    public static async Task<(bool Ok, int MediaStatus, string StatusLabel, string Message)> SubmitRequestAsync(
        PluginConfiguration config,
        int tmdbId,
        string mediaType,
        List<int>? requestedSeasons,
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

        var baseUrl = NormalizeBaseUrl(config.SeerrUrl);
        var apiKey = config.SeerrApiKey.Trim();
        await ValidateSafeSeerrBaseUrlAsync(baseUrl, cancellationToken).ConfigureAwait(false);

        object payloadObj;
        if (cleanType == "movie")
        {
            payloadObj = new
            {
                mediaType = "movie",
                mediaId = tmdbId,
            };
        }
        else
        {
            var seasons = (requestedSeasons ?? new List<int>())
                .Where(s => s > 0 && s <= 200)
                .Distinct()
                .OrderBy(s => s)
                .ToList();

            // Resolve explicit non-zero season numbers from /api/v1/tv/{tmdbId} when empty ("All Seasons")
            // so both Jellyseerr, Overseerr, and unified Seerr accept the payload cleanly.
            if (seasons.Count == 0)
            {
                var tvDetail = await GetTvDetailsAsync(config, tmdbId, cancellationToken).ConfigureAwait(false);
                seasons = tvDetail.Seasons
                    .Where(s => s.Status is not (4 or 5))
                    .Select(s => s.SeasonNumber)
                    .ToList();
                if (seasons.Count == 0 && tvDetail.Seasons.Count > 0)
                {
                    seasons = tvDetail.Seasons.Select(s => s.SeasonNumber).ToList();
                }
            }

            if (seasons.Count == 0)
            {
                seasons.Add(1);
            }

            payloadObj = new
            {
                mediaType = "tv",
                mediaId = tmdbId,
                seasons,
            };
        }

        using var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/api/v1/request")
        {
            Content = new StringContent(JsonSerializer.Serialize(payloadObj), Encoding.UTF8, "application/json"),
        };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.TryAddWithoutValidation("X-Api-Key", apiKey);

        using var resp = await SeerrHttp.SendAsync(req, cancellationToken).ConfigureAwait(false);
        var respBody = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if ((int)resp.StatusCode == 409)
        {
            return (true, 2, "Requested", "This title has already been requested.");
        }

        if (!resp.IsSuccessStatusCode)
        {
            var errMsg = ExtractSeerrError(respBody) ?? $"Seerr returned HTTP {(int)resp.StatusCode}.";
            throw new InvalidOperationException(errMsg);
        }

        var newStatus = 2;
        try
        {
            using var doc = JsonDocument.Parse(respBody);
            if (doc.RootElement.TryGetProperty("media", out var mediaEl) && mediaEl.ValueKind == JsonValueKind.Object)
            {
                newStatus = Math.Clamp(JsonInt(mediaEl, "status", 2), 2, 5);
            }
        }
        catch
        {
        }

        return (true, newStatus, MapStatusLabel(newStatus), "Request submitted to Seerr!");
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

        IPAddress[] addrs;
        if (IPAddress.TryParse(uri.DnsSafeHost, out var literalIp))
        {
            addrs = new[] { literalIp };
        }
        else
        {
            addrs = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, cancellationToken).ConfigureAwait(false);
        }

        if (addrs.Length == 0)
        {
            throw new InvalidOperationException($"Could not resolve Seerr host '{uri.DnsSafeHost}'.");
        }

        foreach (var rawIp in addrs)
        {
            var ip = rawIp.IsIPv4MappedToIPv6 ? rawIp.MapToIPv4() : rawIp;
            if (IsForbiddenMetadataOrUnspecifiedIp(ip))
            {
                throw new InvalidOperationException("Seerr target IP is blocked by SSRF security policy.");
            }
        }
    }

    private static HttpRequestMessage BuildGetRequest(string url, string apiKey)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.TryAddWithoutValidation("X-Api-Key", apiKey);
        return req;
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
                // TMDB Genre 27 = Horror
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
            var msg = JsonStr(doc.RootElement, "message");
            if (!string.IsNullOrWhiteSpace(msg))
            {
                return msg.Length > 180 ? msg.Substring(0, 180) : msg;
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
