using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Mime;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.StreamFlix.Controllers;

// YouTube Trailer Resolution (Jellyfin RemoteTrailers + Embeddable YouTube Search Fallback) & Error-153-Safe Embed Relay
public partial class StreamFlixController
{
    private static readonly Regex YouTubeIdRegex = new(@"^[A-Za-z0-9_-]{11}$", RegexOptions.Compiled);

    private static readonly Regex YouTubeSearchVideoIdRegex = new(@"""videoId""\s*:\s*""([A-Za-z0-9_-]{11})""", RegexOptions.Compiled);

    private static readonly HttpClient TrailerHttpClient = CreateTrailerHttpClient();

    private static readonly ConcurrentDictionary<string, CachedTrailerEntry> TrailerResolveCache = new(StringComparer.OrdinalIgnoreCase);

    internal enum YouTubeEmbedStatus
    {
        Allowed,
        Blocked,
        UnknownNetwork,
    }

    private sealed record CachedTrailerEntry(
        bool Found,
        string Kind,
        string? YouTubeId,
        string? LocalTrailerId,
        string? Title,
        string Source,
        DateTimeOffset ExpiresAtUtc);

    private static HttpClient CreateTrailerHttpClient()
    {
        var handler = new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            AllowAutoRedirect = true,
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        };
        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(5),
        };
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
        return client;
    }

    internal static string? ExtractYouTubeVideoId(string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
        {
            return null;
        }

        var trimmed = rawUrl.Trim();
        if (YouTubeIdRegex.IsMatch(trimmed))
        {
            return trimmed;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            return null;
        }

        var host = (uri.Host ?? string.Empty).ToLowerInvariant();
        if (host.StartsWith("www.", StringComparison.Ordinal))
        {
            host = host.Substring(4);
        }
        else if (host.StartsWith("m.", StringComparison.Ordinal))
        {
            host = host.Substring(2);
        }

        string? candidate = null;
        if (string.Equals(host, "youtu.be", StringComparison.Ordinal))
        {
            var seg = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            candidate = seg;
        }
        else if (string.Equals(host, "youtube.com", StringComparison.Ordinal)
            || string.Equals(host, "youtube-nocookie.com", StringComparison.Ordinal))
        {
            var path = uri.AbsolutePath.Trim('/');
            if (string.Equals(path, "watch", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(uri.Query))
            {
                var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
                foreach (var kv in query)
                {
                    var eq = kv.IndexOf('=', StringComparison.Ordinal);
                    if (eq > 0)
                    {
                        var k = Uri.UnescapeDataString(kv.Substring(0, eq));
                        if (string.Equals(k, "v", StringComparison.OrdinalIgnoreCase))
                        {
                            candidate = Uri.UnescapeDataString(kv.Substring(eq + 1));
                            break;
                        }
                    }
                }
            }
            else
            {
                var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2 && (
                    string.Equals(parts[0], "embed", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(parts[0], "v", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(parts[0], "shorts", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(parts[0], "live", StringComparison.OrdinalIgnoreCase)))
                {
                    candidate = parts[1];
                }
            }
        }

        return !string.IsNullOrEmpty(candidate) && YouTubeIdRegex.IsMatch(candidate) ? candidate : null;
    }

    [HttpGet("Trailers/Resolve")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ResolveItemTrailer([FromQuery] string? itemId = null, CancellationToken cancellationToken = default)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (string.IsNullOrWhiteSpace(itemId) || !Guid.TryParse(itemId.Trim(), out var parsedGuid) || parsedGuid == Guid.Empty)
        {
            return BadRequest(new { ok = false, code = "invalid_item_id", message = "A valid Jellyfin itemId is required." });
        }

        var item = _libraryManager.GetItemById(parsedGuid);
        if (item == null)
        {
            return NotFound(new { ok = false, code = "item_not_found", message = "Media item was not found." });
        }

        var targetItem = item;
        if (item is Episode ep && ep.SeriesId != Guid.Empty && (item.RemoteTrailers == null || item.RemoteTrailers.Count == 0))
        {
            var parentSeries = _libraryManager.GetItemById(ep.SeriesId);
            if (parentSeries != null)
            {
                targetItem = parentSeries;
            }
        }

        var cacheKey = targetItem.Id.ToString("N");
        var now = DateTimeOffset.UtcNow;
        if (TrailerResolveCache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAtUtc > now)
        {
            return Ok(BuildTrailerResolveResponse(cached));
        }

        // Trim cache if it exceeds 2,000 entries
        if (TrailerResolveCache.Count > 2000)
        {
            foreach (var staleKey in TrailerResolveCache.Keys.Take(400))
            {
                TrailerResolveCache.TryRemove(staleKey, out _);
            }
        }

        CachedTrailerEntry? resolved = null;

        // 1. Check Jellyfin RemoteTrailers metadata first (YouTube URLs scraped by TMDB / OMDb)
        var remoteCandidates = new List<string>();
        foreach (var rt in targetItem.RemoteTrailers ?? Array.Empty<MediaUrl>())
        {
            var ytId = ExtractYouTubeVideoId(rt?.Url);
            if (!string.IsNullOrEmpty(ytId) && !remoteCandidates.Contains(ytId, StringComparer.Ordinal))
            {
                remoteCandidates.Add(ytId);
            }
        }

        foreach (var ytId in remoteCandidates)
        {
            var (status, ytTitle) = await VerifyYouTubeEmbeddableAsync(ytId, cancellationToken).ConfigureAwait(false);
            if (status == YouTubeEmbedStatus.Allowed || status == YouTubeEmbedStatus.UnknownNetwork)
            {
                resolved = new CachedTrailerEntry(
                    Found: true,
                    Kind: "youtube",
                    YouTubeId: ytId,
                    LocalTrailerId: null,
                    Title: ytTitle ?? targetItem.Name,
                    Source: "jellyfin_remote_trailer",
                    ExpiresAtUtc: now.AddHours(12));
                break;
            }
        }

        // 2. Universal YouTube Official Trailer Search Fallback (handles libraries without scraped RemoteTrailers or blocked studio uploads)
        if (resolved == null && !string.IsNullOrWhiteSpace(targetItem.Name))
        {
            var searched = await SearchYouTubeOfficialTrailerAsync(
                targetItem.Name,
                targetItem.ProductionYear,
                targetItem is Series,
                remoteCandidates,
                cancellationToken).ConfigureAwait(false);
            if (searched.HasValue)
            {
                resolved = new CachedTrailerEntry(
                    Found: true,
                    Kind: "youtube",
                    YouTubeId: searched.Value.YouTubeId,
                    LocalTrailerId: null,
                    Title: searched.Value.Title ?? targetItem.Name,
                    Source: "youtube_search",
                    ExpiresAtUtc: now.AddHours(12));
            }
        }

        resolved ??= new CachedTrailerEntry(
            Found: false,
            Kind: "none",
            YouTubeId: null,
            LocalTrailerId: null,
            Title: null,
            Source: "none",
            ExpiresAtUtc: now.AddMinutes(15));

        TrailerResolveCache[cacheKey] = resolved;
        return Ok(BuildTrailerResolveResponse(resolved));
    }

    [HttpGet("Trailers/Embed/{youtubeId}")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Text.Html)]
    public IActionResult ServeYouTubeTrailerEmbedRelay(
        [FromRoute] string youtubeId,
        [FromQuery] int autoplay = 1,
        [FromQuery] int mute = 1,
        [FromQuery] int controls = 0,
        [FromQuery] int loop = 0)
    {
        if (string.IsNullOrWhiteSpace(youtubeId) || !YouTubeIdRegex.IsMatch(youtubeId.Trim()))
        {
            return BadRequest("Invalid YouTube video ID.");
        }

        var cleanId = youtubeId.Trim();
        Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        Response.Headers["Cache-Control"] = "public, max-age=3600";
        Response.Headers["X-Content-Type-Options"] = "nosniff";

        var html = BuildYouTubeEmbedRelayHtml(
            cleanId,
            autoplay != 0,
            mute != 0,
            controls != 0,
            loop != 0);
        return Content(html, "text/html; charset=utf-8", Encoding.UTF8);
    }

    internal static string BuildYouTubeEmbedRelayHtml(
        string youtubeId,
        bool autoplay,
        bool mute,
        bool controls,
        bool loop)
    {
        var ap = autoplay ? "1" : "0";
        var mu = mute ? "1" : "0";
        var ct = controls ? "1" : "0";
        var lp = loop ? $"&loop=1&playlist={youtubeId}" : string.Empty;

        return $@"<!DOCTYPE html>
<html lang=""en"">
<head>
<meta charset=""utf-8"" />
<meta name=""viewport"" content=""width=device-width,initial-scale=1"" />
<meta name=""referrer"" content=""strict-origin-when-cross-origin"" />
<title>Trailer</title>
<style>
html,body{{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}}
iframe{{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;border:0;display:block;}}
</style>
</head>
<body>
<iframe id=""yt"" referrerpolicy=""strict-origin-when-cross-origin"" allow=""accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"" allowfullscreen></iframe>
<script>
(function(){{
  var vid = '{youtubeId}';
  var f = document.getElementById('yt');
  var acked = false;
  var hsTimer = null;
  var hsCount = 0;
  var originParam = '';
  try {{
    if (window.location && /^https?:/i.test(window.location.protocol)) {{
      originParam = '&origin=' + encodeURIComponent(window.location.origin);
    }}
  }} catch (e) {{}}

  function postYt(obj) {{
    try {{
      if (f && f.contentWindow) {{
        f.contentWindow.postMessage(JSON.stringify(obj), '*');
      }}
    }} catch (e) {{}}
  }}

  function postParent(obj) {{
    try {{
      if (window.parent && window.parent !== window) {{
        obj.source = 'streamflix-yt';
        obj.videoId = vid;
        window.parent.postMessage(obj, '*');
      }}
    }} catch (e) {{}}
  }}

  function sendHandshake() {{
    if (acked || hsCount >= 12) {{
      if (hsTimer) {{ clearInterval(hsTimer); hsTimer = null; }}
      return;
    }}
    hsCount++;
    postYt({{ event: 'listening', id: 1, channel: 'widget' }});
    postYt({{ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' }});
    postYt({{ event: 'command', func: 'addEventListener', args: ['onError'], id: 1, channel: 'widget' }});
  }}

  window.addEventListener('message', function(ev) {{
    if (ev.source === f.contentWindow) {{
      var d = ev.data;
      if (typeof d === 'string') {{
        try {{ d = JSON.parse(d); }} catch (e) {{ return; }}
      }}
      if (!d || typeof d !== 'object') return;
      acked = true;
      if (hsTimer) {{ clearInterval(hsTimer); hsTimer = null; }}
      if (d.event === 'onReady' || d.event === 'initialDelivery') {{
        postParent({{ event: 'ready' }});
      }}
      if (d.event === 'infoDelivery' && d.info) {{
        if (typeof d.info.playerState === 'number') {{
          postParent({{ event: 'state', state: d.info.playerState }});
        }}
      }} else if (d.event === 'onStateChange' && typeof d.info === 'number') {{
        postParent({{ event: 'state', state: d.info }});
      }} else if (d.event === 'onError') {{
        postParent({{ event: 'error', code: d.info }});
      }}
      return;
    }}
    var cmdMsg = ev.data;
    if (typeof cmdMsg === 'string') {{
      try {{ cmdMsg = JSON.parse(cmdMsg); }} catch (e) {{ return; }}
    }}
    if (cmdMsg && cmdMsg.target === 'streamflix-yt' && cmdMsg.cmd) {{
      postYt({{ event: 'command', func: String(cmdMsg.cmd), args: Array.isArray(cmdMsg.args) ? cmdMsg.args : [] }});
    }}
  }});

  f.addEventListener('load', function() {{
    sendHandshake();
    if (!hsTimer) {{
      hsTimer = setInterval(sendHandshake, 350);
    }}
  }});

  f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(vid)
    + '?enablejsapi=1&autoplay={ap}&mute={mu}&controls={ct}&rel=0&playsinline=1&iv_load_policy=3&modestbranding=1{lp}'
    + originParam;
}})();
</script>
</body>
</html>";
    }

    private static object BuildTrailerResolveResponse(CachedTrailerEntry entry)
    {
        if (!entry.Found)
        {
            return new { ok = false, kind = "none" };
        }

        if (string.Equals(entry.Kind, "youtube", StringComparison.Ordinal) && !string.IsNullOrEmpty(entry.YouTubeId))
        {
            return new
            {
                ok = true,
                kind = "youtube",
                youtubeId = entry.YouTubeId,
                title = entry.Title ?? string.Empty,
                source = entry.Source,
                embedPath = $"/StreamFlix/Trailers/Embed/{entry.YouTubeId}",
            };
        }

        return new
        {
            ok = true,
            kind = "local",
            localTrailerId = entry.LocalTrailerId ?? string.Empty,
            title = entry.Title ?? string.Empty,
            source = entry.Source,
        };
    }

    private static async Task<(YouTubeEmbedStatus Status, string? Title)> VerifyYouTubeEmbeddableAsync(
        string youtubeId,
        CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromMilliseconds(3200));
        try
        {
            var watchUrl = $"https://www.youtube.com/watch?v={youtubeId}";
            var oembedUrl = $"https://www.youtube.com/oembed?url={Uri.EscapeDataString(watchUrl)}&format=json";
            using var req = new HttpRequestMessage(HttpMethod.Get, oembedUrl);
            using var resp = await TrailerHttpClient.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token).ConfigureAwait(false);
            if (resp.StatusCode == HttpStatusCode.OK)
            {
                var json = await resp.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
                string? title = null;
                try
                {
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("title", out var tProp) && tProp.ValueKind == JsonValueKind.String)
                    {
                        title = tProp.GetString();
                    }
                }
                catch
                {
                }

                return (YouTubeEmbedStatus.Allowed, title);
            }

            if (resp.StatusCode == HttpStatusCode.Unauthorized
                || resp.StatusCode == HttpStatusCode.Forbidden
                || resp.StatusCode == HttpStatusCode.NotFound
                || resp.StatusCode == HttpStatusCode.BadRequest)
            {
                return (YouTubeEmbedStatus.Blocked, null);
            }

            return (YouTubeEmbedStatus.UnknownNetwork, null);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return (YouTubeEmbedStatus.UnknownNetwork, null);
        }
    }

    private static async Task<(string YouTubeId, string? Title)?> SearchYouTubeOfficialTrailerAsync(
        string itemName,
        int? productionYear,
        bool isSeries,
        IReadOnlyCollection<string> alreadyCheckedIds,
        CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromMilliseconds(4500));
        try
        {
            var yearPart = productionYear is > 1900 and < 2100
                ? $" {productionYear.Value.ToString(CultureInfo.InvariantCulture)}"
                : string.Empty;
            var kindSuffix = isSeries ? "Official Series Trailer" : "Official Trailer";
            var searchQuery = $"{itemName.Trim()}{yearPart} {kindSuffix}";
            var searchUrl = $"https://www.youtube.com/results?search_query={Uri.EscapeDataString(searchQuery)}&sp=EgIQAQ%253D%253D";

            using var req = new HttpRequestMessage(HttpMethod.Get, searchUrl);
            req.Headers.TryAddWithoutValidation("Cookie", "SOCS=CAI; CONSENT=YES+cb");
            using var resp = await TrailerHttpClient.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return null;
            }

            var html = await resp.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
            if (string.IsNullOrEmpty(html))
            {
                return null;
            }

            var candidates = new List<string>(5);
            var seen = new HashSet<string>(alreadyCheckedIds, StringComparer.Ordinal);
            foreach (Match m in YouTubeSearchVideoIdRegex.Matches(html))
            {
                if (m.Success && m.Groups.Count > 1)
                {
                    var id = m.Groups[1].Value;
                    if (YouTubeIdRegex.IsMatch(id) && seen.Add(id))
                    {
                        candidates.Add(id);
                        if (candidates.Count >= 5)
                        {
                            break;
                        }
                    }
                }
            }

            foreach (var candidateId in candidates)
            {
                var (status, title) = await VerifyYouTubeEmbeddableAsync(candidateId, cts.Token).ConfigureAwait(false);
                if (status == YouTubeEmbedStatus.Allowed)
                {
                    return (candidateId, title);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
        }

        return null;
    }
}
