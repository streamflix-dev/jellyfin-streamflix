using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Mime;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;
using Jellyfin.Plugin.StreamFlix.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Authentication;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

#if JF1011 || JF12
using JUser = Jellyfin.Database.Implementations.Entities.User;
#else
using JUser = Jellyfin.Data.Entities.User;
#endif

namespace Jellyfin.Plugin.StreamFlix.Controllers;


// Jellyseerr / Overseerr Media Requests, Popularity Scoring & Showcase
public partial class StreamFlixController
{
    [HttpGet("PopularScores")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetPopularScores()
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        var scores = GetPopularScoresCached(_libraryManager, _userManager, _userDataManager);
        return Ok(new
        {
            mode = NormalizeTop10Mode(config.Top10SelectionMode),
            scores,
        });
    }

    [HttpPost("Seerr/Test")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> TestSeerrConfig([FromBody] TestSeerrConfigRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can test Seerr settings." });
        }

        var url = !string.IsNullOrWhiteSpace(request?.SeerrUrl) ? request!.SeerrUrl : config.SeerrUrl;
        var rawKey = (request?.SeerrApiKey ?? string.Empty).Trim();
        var apiKey = string.IsNullOrEmpty(rawKey) || string.Equals(rawKey, "__KEEP__", StringComparison.Ordinal)
            ? config.SeerrApiKey
            : rawKey;

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
        cts.CancelAfter(TimeSpan.FromSeconds(10));

        var (status, summary, checks) = await StreamFlixSeerrService.TestConnectionAsync(url, apiKey, cts.Token).ConfigureAwait(false);
        return Ok(new
        {
            status,
            summary,
            checks = checks.Select(c => new
            {
                status = c.Status,
                label = c.Label,
                detail = c.Detail,
            }).ToList(),
        });
    }

    [HttpGet("Seerr/Search")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SearchSeerr(
        [FromQuery] string? query = null,
        [FromQuery] string? profileId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var (allowed, isKids, _, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, profileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { code = "seerr_forbidden", message = denyReason });
        }

        var q = (query ?? string.Empty).Trim();
        if (q.Length < 2)
        {
            return Ok(new { results = Array.Empty<object>() });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromMilliseconds(6500));
            var items = await StreamFlixSeerrService.SearchAsync(config, q, isKids, cts.Token).ConfigureAwait(false);
            return Ok(new
            {
                results = items.Select(i => new
                {
                    tmdbId = i.TmdbId,
                    mediaType = i.MediaType,
                    title = i.Title,
                    year = i.Year,
                    overview = i.Overview,
                    rating = i.Rating,
                    posterUrl = i.PosterUrl,
                    backdropUrl = i.BackdropUrl,
                    mediaStatus = i.MediaStatus,
                    statusLabel = i.StatusLabel,
                    downloadProgress = i.DownloadProgress,
                    jellyfinMediaId = VerifyLocalJellyfinMediaId(i.JellyfinMediaId),
                }).ToList(),
            });
        }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
        {
            return Ok(new { results = Array.Empty<object>() });
        }
        catch (OperationCanceledException)
        {
            return StatusCode(504, new { code = "seerr_timeout", message = "Seerr search timed out. Verify your Seerr URL is reachable from the Jellyfin server." });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr search failed.");
            return StatusCode(502, new { code = "seerr_unreachable", message = ex.Message });
        }
    }

    [HttpGet("Seerr/Details/{mediaType}/{tmdbId:int}")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetSeerrMediaDetails(
        [FromRoute] string mediaType,
        [FromRoute] int tmdbId,
        [FromQuery] string? profileId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var (allowed, _, _, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, profileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { code = "seerr_forbidden", message = denyReason });
        }

        var cleanType = (mediaType ?? string.Empty).Trim().ToLowerInvariant();
        if (cleanType is not ("movie" or "tv") || tmdbId <= 0)
        {
            return BadRequest(new { code = "invalid_media", message = "Specify 'movie' or 'tv' and a valid TMDB ID." });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(10));
            var detail = await StreamFlixSeerrService.GetMediaDetailsAsync(config, cleanType, tmdbId, cts.Token).ConfigureAwait(false);
            return Ok(SerializeSeerrDetail(detail));
        }
        catch (OperationCanceledException) when (!HttpContext.RequestAborted.IsCancellationRequested)
        {
            return StatusCode(504, new { code = "seerr_timeout", message = "Loading details from Seerr timed out. Check your Seerr URL and TMDB connectivity." });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr detail lookup failed for {MediaType} TMDB {TmdbId}.", cleanType, tmdbId);
            return StatusCode(502, new { code = "seerr_unreachable", message = ex.Message });
        }
    }

    [HttpGet("Seerr/Tv/{tmdbId:int}")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public Task<ActionResult<object>> GetSeerrTvDetails(
        [FromRoute] int tmdbId,
        [FromQuery] string? profileId = null)
    {
        return GetSeerrMediaDetails("tv", tmdbId, profileId);
    }

    [HttpGet("Seerr/Requests")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ListSeerrRequests([FromQuery] string? profileId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var (allowed, isKids, _, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, profileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { code = "seerr_forbidden", message = denyReason });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(12));
            var list = await StreamFlixSeerrService.GetRecentRequestsAsync(config, isKids, cts.Token).ConfigureAwait(false);
            return Ok(new
            {
                requests = list.Select(r => new
                {
                    requestId = r.RequestId,
                    tmdbId = r.TmdbId,
                    mediaType = r.MediaType,
                    title = r.Title,
                    year = r.Year,
                    posterUrl = r.PosterUrl,
                    backdropUrl = r.BackdropUrl,
                    requestStatus = r.RequestStatus,
                    mediaStatus = r.MediaStatus,
                    statusKey = r.StatusKey,
                    statusLabel = r.StatusLabel,
                    downloadProgress = r.DownloadProgress,
                    seasons = r.Seasons,
                    createdAt = r.CreatedAt,
                    jellyfinMediaId = VerifyLocalJellyfinMediaId(r.JellyfinMediaId),
                }).ToList(),
            });
        }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
        {
            return Ok(new { requests = Array.Empty<object>() });
        }
        catch (OperationCanceledException)
        {
            return StatusCode(504, new { code = "seerr_timeout", message = "Connecting to Seerr timed out — check Dashboard → Plugins → StreamFlix → Seerr URL (e.g. http://127.0.0.1:5055 or your Seerr container name)." });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr recent requests lookup failed.");
            return StatusCode(502, new { code = "seerr_unreachable", message = ex.Message });
        }
    }

    [HttpPost("Seerr/Request")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SubmitSeerrRequest([FromBody] SubmitSeerrMediaRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || request.TmdbId <= 0 || string.IsNullOrWhiteSpace(request.MediaType))
        {
            return BadRequest(new { ok = false, message = "Missing media details for request." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var (allowed, _, resolvedProfile, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, request.ProfileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { ok = false, code = "seerr_forbidden", message = denyReason });
        }

        if (!caller.IsAdmin && resolvedProfile is { SeerrRequestQuota: > 0 })
        {
            var used7d = CountRecentProfileSeerrRequests(resolvedProfile.Id);
            if (used7d >= resolvedProfile.SeerrRequestQuota)
            {
                return StatusCode(429, new
                {
                    ok = false,
                    code = "seerr_quota_exceeded",
                    message = $"\"{resolvedProfile.Name}\" has reached its 7-day request limit ({used7d}/{resolvedProfile.SeerrRequestQuota} requests).",
                });
            }
        }

        var rateKey = "seerr|" + StreamFlixSessionService.GetRateLimitClientKey(HttpContext);
        if (!AllowSeerrSubmitRate(rateKey))
        {
            return StatusCode(429, new { ok = false, code = "rate_limited", message = "Too many media requests submitted recently. Please wait a couple of minutes." });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(25));
            var res = await StreamFlixSeerrService.SubmitRequestAsync(
                config,
                request.TmdbId,
                request.MediaType,
                request.Seasons,
                request.Is4k,
                request.ServerId,
                resolvedProfile,
                caller.Session?.Email,
                cts.Token).ConfigureAwait(false);

            if (res.Ok && resolvedProfile != null && !string.IsNullOrWhiteSpace(resolvedProfile.Id))
            {
                RecordProfileSeerrRequest(resolvedProfile.Id);
            }

            return Ok(new
            {
                ok = res.Ok,
                requestId = res.RequestId,
                mediaStatus = res.MediaStatus,
                statusLabel = res.StatusLabel,
                message = res.Message,
            });
        }
        catch (OperationCanceledException) when (!HttpContext.RequestAborted.IsCancellationRequested)
        {
            return StatusCode(504, new { ok = false, code = "seerr_timeout", message = "Seerr took too long to respond while contacting Radarr/Sonarr — check Media Requests in a moment to see if it was queued." });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr request failed for TMDB {TmdbId}.", request.TmdbId);
            return StatusCode(502, new { ok = false, code = "seerr_request_failed", message = ex.Message });
        }
    }

    [HttpPost("Seerr/Cancel")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> CancelSeerrRequest([FromBody] CancelSeerrMediaRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || request.RequestId <= 0)
        {
            return BadRequest(new { ok = false, message = "Invalid request ID." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var (allowed, _, _, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, request.ProfileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { ok = false, code = "seerr_forbidden", message = denyReason });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(12));
            var (ok, message) = await StreamFlixSeerrService.CancelRequestAsync(config, request.RequestId, cts.Token).ConfigureAwait(false);
            return Ok(new { ok, message });
        }
        catch (OperationCanceledException) when (!HttpContext.RequestAborted.IsCancellationRequested)
        {
            return StatusCode(504, new { ok = false, code = "seerr_timeout", message = "Timed out while cancelling the request in Seerr." });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr cancel failed for Request {RequestId}.", request.RequestId);
            return StatusCode(502, new { ok = false, code = "seerr_cancel_failed", message = ex.Message });
        }
    }

    private static string NormalizeTop10Mode(string? raw)
    {
        var s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "community_rating" => "community_rating",
            "recently_added" => "recently_added",
            "daily_random" => "daily_random",
            "session_random" => "session_random",
            _ => "most_played",
        };
    }

    private static string NormalizeHeroSelectionMode(string? raw)
    {
        var s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "random" => "random",
            "top_rated" => "top_rated",
            "top10" => "top10",
            _ => "recent",
        };
    }

    private static string NormalizeHeroContentType(string? raw)
    {
        var s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "movies" => "movies",
            "series" => "series",
            _ => "all",
        };
    }

    private static Dictionary<string, double> GetPopularScoresCached(
        ILibraryManager libraryManager,
        IUserManager userManager,
        IUserDataManager userDataManager)
    {
        lock (PopularCacheLock)
        {
            if (DateTime.UtcNow - _popularCachedAtUtc < TimeSpan.FromMinutes(3) && _popularScoresCache.Count > 0)
            {
                return _popularScoresCache;
            }
        }

        var fresh = ComputePopularScoresCompat(libraryManager, userManager, userDataManager);
        lock (PopularCacheLock)
        {
            _popularScoresCache = fresh;
            _popularCachedAtUtc = DateTime.UtcNow;
        }

        return fresh;
    }

    private static Dictionary<string, double> ComputePopularScoresCompat(
        ILibraryManager libraryManager,
        IUserManager userManager,
        IUserDataManager userDataManager)
    {
        var totals = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var users = StreamFlixStartupTask.GetAllUsersCompat(userManager);
            if (users.Count == 0)
            {
                return totals;
            }

            var queryType = typeof(ILibraryManager).Assembly.GetType("MediaBrowser.Controller.Entities.InternalItemsQuery");
            var getItemList = queryType != null ? typeof(ILibraryManager).GetMethod("GetItemList", new[] { queryType }) : null;
            if (queryType == null || getItemList == null)
            {
                return totals;
            }

            var getUserDataMethod = typeof(IUserDataManager).GetMethods()
                .FirstOrDefault(m => m.Name == "GetUserData" && m.GetParameters().Length == 2)
                ?? userDataManager.GetType().GetMethods()
                    .FirstOrDefault(m => m.Name == "GetUserData" && m.GetParameters().Length == 2);

            var includeProp = queryType.GetProperty("IncludeItemTypes");
            var elemType = includeProp?.PropertyType.IsArray == true ? includeProp.PropertyType.GetElementType() : null;
            Array? movieSeriesEpisodeArr = null;
            Array? movieSeriesArr = null;
            if (elemType != null
                && elemType.IsEnum
                && Enum.TryParse(elemType, "Movie", ignoreCase: true, out var movieKind)
                && Enum.TryParse(elemType, "Series", ignoreCase: true, out var seriesKind)
                && movieKind != null
                && seriesKind != null)
            {
                movieSeriesArr = Array.CreateInstance(elemType, 2);
                movieSeriesArr.SetValue(movieKind, 0);
                movieSeriesArr.SetValue(seriesKind, 1);

                if (Enum.TryParse(elemType, "Episode", ignoreCase: true, out var epKind) && epKind != null)
                {
                    movieSeriesEpisodeArr = Array.CreateInstance(elemType, 3);
                    movieSeriesEpisodeArr.SetValue(movieKind, 0);
                    movieSeriesEpisodeArr.SetValue(seriesKind, 1);
                    movieSeriesEpisodeArr.SetValue(epKind, 2);
                }
                else
                {
                    movieSeriesEpisodeArr = movieSeriesArr;
                }
            }

            var perTitlePerUser = new Dictionary<string, Dictionary<Guid, UserTitleEngagement>>(StringComparer.OrdinalIgnoreCase);
            var nowUtc = DateTime.UtcNow;

            foreach (var user in users)
            {
                if (user == null)
                {
                    continue;
                }

                var seenItemIds = new HashSet<Guid>();
                var userCtor = queryType.GetConstructor(new[] { user.GetType() });

                object? CreateUserQuery(Array? kinds, string filterPropName, int limit)
                {
                    var q = userCtor != null
                        ? userCtor.Invoke(new object[] { user })
                        : Activator.CreateInstance(queryType);
                    if (q == null)
                    {
                        return null;
                    }

                    if (userCtor == null)
                    {
                        queryType.GetProperty("User")?.SetValue(q, user);
                    }

                    queryType.GetProperty("Recursive")?.SetValue(q, true);
                    queryType.GetProperty("Limit")?.SetValue(q, limit);
                    if (kinds != null)
                    {
                        includeProp?.SetValue(q, kinds);
                    }

                    queryType.GetProperty(filterPropName)?.SetValue(q, true);
                    return q;
                }

                foreach (var q in new[]
                {
                    CreateUserQuery(movieSeriesEpisodeArr, "IsPlayed", 400),
                    CreateUserQuery(movieSeriesEpisodeArr, "IsResumable", 100),
                    CreateUserQuery(movieSeriesArr, "IsFavorite", 100),
                })
                {
                    if (q == null || getItemList.Invoke(libraryManager, new[] { q }) is not System.Collections.IEnumerable list)
                    {
                        continue;
                    }

                    foreach (var item in list)
                    {
                        if (item == null)
                        {
                            continue;
                        }

                        var itemType = item.GetType();
                        if (itemType.GetProperty("Id")?.GetValue(item) is not Guid itemId || itemId == Guid.Empty || !seenItemIds.Add(itemId))
                        {
                            continue;
                        }

                        var isEpisode = string.Equals(itemType.Name, "Episode", StringComparison.OrdinalIgnoreCase);
                        Guid targetGuid = itemId;
                        if (isEpisode)
                        {
                            if (itemType.GetProperty("SeriesId")?.GetValue(item) is Guid sId && sId != Guid.Empty)
                            {
                                targetGuid = sId;
                            }
                            else
                            {
                                continue;
                            }
                        }

                        var playCount = 0;
                        var played = false;
                        long posTicks = 0;
                        var isFav = false;
                        DateTime? lastPlayed = null;

                        if (getUserDataMethod != null)
                        {
                            try
                            {
                                var firstParamType = getUserDataMethod.GetParameters()[0].ParameterType;
                                var arg0 = firstParamType == typeof(Guid) ? (object)user.Id : user;
                                var ud = getUserDataMethod.Invoke(userDataManager, new[] { arg0, item });
                                if (ud != null)
                                {
                                    var udt = ud.GetType();
                                    if (udt.GetProperty("PlayCount")?.GetValue(ud) is int pc)
                                    {
                                        playCount = pc;
                                    }

                                    if (udt.GetProperty("Played")?.GetValue(ud) is bool pl)
                                    {
                                        played = pl;
                                    }

                                    if (udt.GetProperty("PlaybackPositionTicks")?.GetValue(ud) is long pt)
                                    {
                                        posTicks = pt;
                                    }

                                    if (udt.GetProperty("IsFavorite")?.GetValue(ud) is bool fv)
                                    {
                                        isFav = fv;
                                    }

                                    if (udt.GetProperty("LastPlayedDate")?.GetValue(ud) is DateTime lp)
                                    {
                                        lastPlayed = lp;
                                    }
                                }
                            }
                            catch
                            {
                            }
                        }

                        if (!played && playCount <= 0 && posTicks <= 0 && !isFav)
                        {
                            continue;
                        }

                        var targetKey = targetGuid.ToString("N");
                        if (!perTitlePerUser.TryGetValue(targetKey, out var byUser))
                        {
                            byUser = new Dictionary<Guid, UserTitleEngagement>();
                            perTitlePerUser[targetKey] = byUser;
                        }

                        if (!byUser.TryGetValue(user.Id, out var eng))
                        {
                            eng = new UserTitleEngagement();
                            byUser[user.Id] = eng;
                        }

                        if (isEpisode)
                        {
                            var epUnits = Math.Min(3.0, Math.Max(played ? 1 : 0, playCount) * 1.5);
                            eng.PlayUnits = Math.Min(12.0, eng.PlayUnits + epUnits);
                        }
                        else
                        {
                            var movieUnits = Math.Min(16.0, Math.Max(played ? 1 : 0, playCount) * 4.0);
                            eng.PlayUnits = Math.Max(eng.PlayUnits, movieUnits);
                        }

                        if (posTicks > 0)
                        {
                            eng.ResumeBonus = 2.5;
                        }

                        if (isFav)
                        {
                            eng.FavBonus = 3.0;
                        }

                        if (lastPlayed.HasValue)
                        {
                            var ageDays = (nowUtc - lastPlayed.Value.ToUniversalTime()).TotalDays;
                            var rec = ageDays <= 7 ? 3.0 : (ageDays <= 30 ? 1.5 : 0.0);
                            if (rec > eng.RecencyBonus)
                            {
                                eng.RecencyBonus = rec;
                            }
                        }
                    }
                }
            }

            foreach (var kvp in perTitlePerUser)
            {
                var score = 0.0;
                foreach (var uEng in kvp.Value.Values)
                {
                    score += 10.0 + uEng.PlayUnits + uEng.ResumeBonus + uEng.FavBonus + uEng.RecencyBonus;
                }

                if (score > 0)
                {
                    totals[kvp.Key] = Math.Round(score, 2);
                }
            }
        }
        catch
        {
        }

        return totals;
    }

    private sealed class UserTitleEngagement
    {
        public double PlayUnits { get; set; }

        public double ResumeBonus { get; set; }

        public double FavBonus { get; set; }

        public double RecencyBonus { get; set; }
    }

    private static List<object> GetShowcaseItemsCached(ILibraryManager libraryManager)
    {
        lock (ShowcaseCacheLock)
        {
            if (DateTime.UtcNow - _showcaseCachedAtUtc < TimeSpan.FromMinutes(10) && _showcaseCache.Count > 0)
            {
                return _showcaseCache;
            }
        }

        var fresh = JellyfinCompat.GetShowcaseItems(libraryManager);
        lock (ShowcaseCacheLock)
        {
            _showcaseCache = fresh;
            _showcaseCachedAtUtc = DateTime.UtcNow;
        }

        return fresh;
    }

    private object SerializeSeerrDetail(StreamFlixSeerrService.SeerrMediaDetail d)
    {
        return new
        {
            tmdbId = d.TmdbId,
            mediaType = d.MediaType,
            title = d.Title,
            tagline = d.Tagline,
            year = d.Year,
            runtimeMinutes = d.RuntimeMinutes,
            rating = d.Rating,
            genres = d.Genres,
            overview = d.Overview,
            posterUrl = d.PosterUrl,
            backdropUrl = d.BackdropUrl,
            mediaStatus = d.MediaStatus,
            mediaStatus4k = d.MediaStatus4k,
            statusLabel = d.StatusLabel,
            downloadProgress = d.DownloadProgress,
            activeRequestId = d.ActiveRequestId,
            jellyfinMediaId = VerifyLocalJellyfinMediaId(d.JellyfinMediaId),
            partialRequestsEnabled = d.PartialRequestsEnabled,
            seasons = d.Seasons.Select(s => new
            {
                seasonNumber = s.SeasonNumber,
                name = s.Name,
                episodeCount = s.EpisodeCount,
                year = s.Year,
                status = s.Status,
                statusLabel = s.StatusLabel,
            }).ToList(),
            servers = d.Servers.Select(sv => new
            {
                id = sv.Id,
                name = sv.Name,
                is4k = sv.Is4k,
                isDefault = sv.IsDefault,
            }).ToList(),
        };
    }

    private string? VerifyLocalJellyfinMediaId(string? rawId)
    {
        if (string.IsNullOrWhiteSpace(rawId))
        {
            return null;
        }

        if (!Guid.TryParse(rawId.Trim(), out var itemGuid) || itemGuid == Guid.Empty)
        {
            return null;
        }

        try
        {
            var existing = _libraryManager.GetItemById(itemGuid);
            return existing != null ? itemGuid.ToString("N") : null;
        }
        catch
        {
            return null;
        }
    }

    private Task<(bool Allowed, bool IsKids, StreamFlixProfileConfig? Profile, string DenyReason)> EvaluateSeerrPermissionAsync(
        PluginConfiguration config,
        CallerContext caller,
        string? requestedProfileId)
    {
        if (!HasHouseholdAccess(config, caller))
        {
            return Task.FromResult<(bool, bool, StreamFlixProfileConfig?, string)>((false, false, null, "Sign in to StreamFlix first."));
        }

        if (!StreamFlixSeerrService.IsConfigured(config))
        {
            return Task.FromResult<(bool, bool, StreamFlixProfileConfig?, string)>((false, false, null, "Seerr / Jellyseerr integration is not enabled on this server."));
        }

        var isGuest = IsGuestSession(caller);
        if (isGuest && !config.SeerrAllowGuests)
        {
            return Task.FromResult<(bool, bool, StreamFlixProfileConfig?, string)>((false, false, null, "Media requests are disabled for Guest Pass sessions."));
        }

        var effectiveProfileId = isGuest ? caller.Session?.LockedProfileId : requestedProfileId;
        var profile = FindProfile(config, effectiveProfileId);
        if (profile == null && caller.JellyfinUser != null)
        {
            var callerUid = caller.JellyfinUser.Id.ToString("N");
            profile = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                .FirstOrDefault(p => string.Equals(p.JellyfinUserId, callerUid, StringComparison.OrdinalIgnoreCase));
        }

        var isKids = profile?.IsKids == true;
        if (isKids && !config.SeerrAllowKids)
        {
            return Task.FromResult<(bool, bool, StreamFlixProfileConfig?, string)>((false, true, profile, "Media requests are disabled for Kids profiles."));
        }

        if (!caller.IsAdmin && profile is { SeerrRequestQuota: < 0 })
        {
            return Task.FromResult<(bool, bool, StreamFlixProfileConfig?, string)>((false, isKids, profile, $"Media requests are disabled for \"{profile.Name}\"."));
        }

        return Task.FromResult<(bool, bool, StreamFlixProfileConfig?, string)>((true, isKids, profile, string.Empty));
    }

    private static readonly ConcurrentDictionary<string, List<DateTimeOffset>> ProfileSeerrQuotaLog = new(StringComparer.OrdinalIgnoreCase);

    private static int CountRecentProfileSeerrRequests(string profileId)
    {
        if (string.IsNullOrWhiteSpace(profileId) || !ProfileSeerrQuotaLog.TryGetValue(profileId.Trim(), out var list))
        {
            return 0;
        }

        var cutoff = DateTimeOffset.UtcNow.AddDays(-7);
        lock (list)
        {
            list.RemoveAll(ts => ts < cutoff);
            return list.Count;
        }
    }

    private static void RecordProfileSeerrRequest(string profileId)
    {
        if (string.IsNullOrWhiteSpace(profileId))
        {
            return;
        }

        if (ProfileSeerrQuotaLog.Count > 256)
        {
            ProfileSeerrQuotaLog.Clear();
        }

        var list = ProfileSeerrQuotaLog.GetOrAdd(profileId.Trim(), _ => new List<DateTimeOffset>());
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddDays(-7);
        lock (list)
        {
            list.RemoveAll(ts => ts < cutoff);
            list.Add(now);
        }
    }

    private static bool AllowSeerrSubmitRate(string key)
    {
        if (SeerrRequestRateMap.Count > 512)
        {
            SeerrRequestRateMap.Clear();
        }

        var now = DateTimeOffset.UtcNow;
        var window = TimeSpan.FromMinutes(5);
        var updated = SeerrRequestRateMap.AddOrUpdate(
            key,
            _ => (1, now.Add(window)),
            (_, existing) => existing.WindowReset <= now
                ? (1, now.Add(window))
                : (existing.Count + 1, existing.WindowReset));
        return updated.Count <= 20;
    }
}
