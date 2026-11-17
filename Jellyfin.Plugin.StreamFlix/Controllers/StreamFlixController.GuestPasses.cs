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


// Temporary Guest Passes, QR Share Links & Scoped Handoff Sessions
public partial class StreamFlixController
{
    [HttpGet("GuestPasses")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ListGuestPasses()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!CanCallerManageGuestPasses(config, caller))
        {
            return StatusCode(403, new { code = "guest_pass_permission_required", message = "This profile does not have permission to manage Guest Passes." });
        }

        List<string> prunedIds;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (PruneDeadGuestPassesNoLock(config, out prunedIds) > 0)
            {
                Plugin.Instance?.SaveConfiguration();
            }
        }
        finally
        {
            SyncLock.Release();
        }

        foreach (var gpId in prunedIds)
        {
            await RevokeGuestJellyfinSessionsAsync(gpId).ConfigureAwait(false);
        }

        var eligibleProfiles = (config.Profiles ?? new List<StreamFlixProfileConfig>())
            .Where(p => !IsProfileLinkedToAdmin(p))
            .Select(p => new
            {
                id = p.Id,
                name = p.Name,
                avatarEmoji = p.AvatarEmoji,
                avatarColorHex = SanitizeHexColor(p.AvatarColorHex),
                isKids = p.IsKids,
            })
            .ToList();

        var passes = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
            .OrderByDescending(p => p.CreatedAtUtc, StringComparer.Ordinal)
            .Select(p => MapGuestPassAdmin(config, p))
            .ToList();

        return Ok(new
        {
            passes,
            eligibleProfiles,
        });
    }

    [HttpPost("GuestPasses/Create")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> CreateGuestPass([FromBody] CreateGuestPassRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || string.IsNullOrWhiteSpace(request.ProfileId))
        {
            return BadRequest(new { message = "Choose a non-administrator profile for the Guest Pass." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!CanCallerManageGuestPasses(config, caller))
        {
            return StatusCode(403, new { code = "guest_pass_permission_required", message = "This profile does not have permission to create Guest Passes." });
        }

        if (!config.EnableGuestPasses)
        {
            return BadRequest(new { code = "guest_passes_disabled", message = "Temporary Guest Passes are turned off in StreamFlix settings." });
        }

        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);

        var profile = FindProfile(config, request.ProfileId);
        if (profile == null)
        {
            return NotFound(new { message = "Selected profile was not found." });
        }

        if (IsProfileLinkedToAdmin(profile))
        {
            return BadRequest(new
            {
                code = "admin_profile_forbidden",
                message = "Guest Passes can only be created for non-administrator profiles. Select or create a standard viewer/Guest profile.",
            });
        }

        var hours = Math.Clamp(request.DurationHours <= 0 ? 24 : request.DurationHours, 1, 720);
        var maxRedemptions = Math.Clamp(request.MaxRedemptions, 0, 100);
        var rawLabel = (request.Label ?? string.Empty).Trim();
        if (rawLabel.Length > 48)
        {
            rawLabel = rawLabel.Substring(0, 48).Trim();
        }

        var now = DateTimeOffset.UtcNow;
        var pass = new StreamFlixGuestPass
        {
            Id = "gp_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant(),
            Label = string.IsNullOrEmpty(rawLabel) ? $"{profile.Name} Pass" : rawLabel,
            ProfileId = profile.Id,
            ProfileNameSnapshot = profile.Name,
            CreatedAtUtc = now.ToString("O"),
            ExpiresAtUtc = now.AddHours(hours).ToString("O"),
            MaxRedemptions = maxRedemptions,
            RedemptionCount = 0,
            Revoked = false,
            SecretNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(18)),
        };

        string code;
        List<string> prunedCreateIds;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            config.GuestPasses ??= new List<StreamFlixGuestPass>();
            PruneDeadGuestPassesNoLock(config, out prunedCreateIds);
            var activeCount = config.GuestPasses.Count(g => GetGuestPassStatus(g) == "active");
            if (activeCount >= MaxActiveGuestPasses)
            {
                return BadRequest(new { message = $"You already have {MaxActiveGuestPasses} active Guest Passes. Revoke old passes first." });
            }

            if (config.GuestPasses.Count >= MaxStoredGuestPasses)
            {
                var removable = config.GuestPasses
                    .Where(g => GetGuestPassStatus(g) != "active")
                    .OrderBy(g => g.CreatedAtUtc, StringComparer.Ordinal)
                    .Take((config.GuestPasses.Count - MaxStoredGuestPasses) + 1)
                    .ToList();
                foreach (var old in removable)
                {
                    if (!string.IsNullOrWhiteSpace(old.Id))
                    {
                        prunedCreateIds.Add(old.Id);
                    }

                    config.GuestPasses.Remove(old);
                }
            }

            config.GuestPasses.Insert(0, pass);
            code = StreamFlixSessionService.ComputeGuestPassCode(config, pass);
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        foreach (var gpId in prunedCreateIds)
        {
            await RevokeGuestJellyfinSessionsAsync(gpId).ConfigureAwait(false);
        }

        var shareUrl = BuildAbsoluteGuestPassUri(code);
        var qrSvg = StreamFlixQrCode.GenerateSvg(shareUrl);

        return Ok(new
        {
            pass = MapGuestPassAdmin(config, pass),
            code,
            shareUrl,
            qrSvg,
        });
    }

    [HttpGet("GuestPasses/{id}/ShareInfo")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetGuestPassShareInfo([FromRoute] string id)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!CanCallerManageGuestPasses(config, caller))
        {
            return StatusCode(403, new { code = "guest_pass_permission_required", message = "This profile does not have permission to view Guest Pass QR codes." });
        }

        var pass = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
            .FirstOrDefault(g => string.Equals(g.Id, (id ?? string.Empty).Trim(), StringComparison.Ordinal));
        if (pass == null)
        {
            return NotFound(new { message = "Guest Pass not found." });
        }

        var code = StreamFlixSessionService.ComputeGuestPassCode(config, pass);
        var shareUrl = BuildAbsoluteGuestPassUri(code);
        var qrSvg = StreamFlixQrCode.GenerateSvg(shareUrl);

        return Ok(new
        {
            pass = MapGuestPassAdmin(config, pass),
            code,
            shareUrl,
            qrSvg,
        });
    }

    [HttpPost("GuestPasses/Revoke")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RevokeGuestPass([FromBody] RevokeGuestPassRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var passId = (request?.Id ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(passId))
        {
            return BadRequest(new { message = "Missing Guest Pass ID." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!CanCallerManageGuestPasses(config, caller))
        {
            return StatusCode(403, new { code = "guest_pass_permission_required", message = "This profile does not have permission to revoke Guest Passes." });
        }

        StreamFlixGuestPass? targetPass = null;
        List<string> prunedRevokeIds;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            targetPass = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
                .FirstOrDefault(g => string.Equals(g.Id, passId, StringComparison.Ordinal));
            if (targetPass == null)
            {
                return NotFound(new { message = "Guest Pass not found." });
            }

            config.GuestPasses!.Remove(targetPass);
            PruneDeadGuestPassesNoLock(config, out prunedRevokeIds);
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        var terminatedSessions = await RevokeGuestJellyfinSessionsAsync(targetPass.Id).ConfigureAwait(false);
        foreach (var gpId in prunedRevokeIds)
        {
            terminatedSessions += await RevokeGuestJellyfinSessionsAsync(gpId).ConfigureAwait(false);
        }

        _logger.LogInformation("StreamFlix: deleted/revoked Guest Pass '{PassId}' ({Label}).", targetPass.Id, targetPass.Label);

        var passes = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
            .OrderByDescending(p => p.CreatedAtUtc, StringComparer.Ordinal)
            .Select(p => MapGuestPassAdmin(config, p))
            .ToList();
        return Ok(new { revoked = true, deleted = true, terminatedSessions, passes });
    }

    [HttpGet("Guest/{code}")]
    [AllowAnonymous]
    public ActionResult StartGuestPassHandoff([FromRoute] string code, [FromQuery] string? watchparty = null, [FromQuery] string? wpitem = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var safeWebBase = ResolveSafeRelativeWebPath(null);
        var validWpCode = StreamFlixWatchPartyService.SanitizeRoomCode(watchparty);
        Guid? validWpItem = Guid.TryParse((wpitem ?? string.Empty).Trim(), out var parsedItem) ? parsedItem : null;

        if (!config.EnableGuestPasses)
        {
            return Redirect(BuildGuestReturnUrl(safeWebBase, "Temporary Guest Passes are turned off on this server."));
        }

        var lockKey = "guest|" + StreamFlixSessionService.GetRateLimitClientKey(HttpContext);
        if (StreamFlixSessionService.IsGuestLockedOut(lockKey, out var retryAfter))
        {
            var mins = Math.Max(1, ((int)Math.Ceiling(retryAfter.TotalSeconds) + 59) / 60);
            return Redirect(BuildGuestReturnUrl(safeWebBase, $"Too many Guest Pass attempts. Please wait {mins} min and try again."));
        }

        if (!StreamFlixSessionService.TryVerifyGuestPassForRedemption(config, code, out var pass, out var failureReason)
            || pass == null)
        {
            StreamFlixSessionService.RegisterGuestFailure(lockKey);
            return Redirect(BuildGuestReturnUrl(safeWebBase, failureReason));
        }

        var profile = FindProfile(config, pass.ProfileId);
        if (profile == null || IsProfileLinkedToAdmin(profile))
        {
            return Redirect(BuildGuestReturnUrl(safeWebBase, "This Guest Pass is no longer linked to an eligible profile."));
        }

        // Issue a 90-second HttpOnly handoff cookie; RedemptionCount is only incremented when the real browser
        // calls POST /StreamFlix/Guest/Complete so chat preview / link-unfurler bots never burn redemptions.
        var handoffPayload = new StreamFlixSessionService.GuestHandoffPayload(
            PassId: pass.Id,
            Code: StreamFlixSessionService.ExtractGuestPassCode(code),
            CreatedAt: DateTimeOffset.UtcNow.ToString("O"));
        var signedCookie = StreamFlixSessionService.SignShortLivedPayload(
            config,
            StreamFlixSessionService.GuestHandoffTokenPurpose,
            handoffPayload,
            TimeSpan.FromSeconds(90));

        if (Request.Cookies.ContainsKey(StreamFlixSessionService.GuestHandoffCookieName))
        {
            DeleteLegacyRootCookie(StreamFlixSessionService.GuestHandoffCookieName);
        }

        Response.Cookies.Append(
            StreamFlixSessionService.GuestHandoffCookieName,
            signedCookie,
            BuildGuestCookieOptions(TimeSpan.FromSeconds(90)));

        return Redirect(BuildGuestReturnUrl(safeWebBase, errorMessage: null, validWpCode, validWpItem));
    }

    [HttpPost("Guest/Complete")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> CompleteGuestPassHandoff([FromBody] RedeemGuestPassRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var rawCookie = Request.Cookies[StreamFlixSessionService.GuestHandoffCookieName];
        DeleteGuestCookie(StreamFlixSessionService.GuestHandoffCookieName);
        DeleteLegacyRootCookie(StreamFlixSessionService.GuestHandoffCookieName);

        var handoff = StreamFlixSessionService.VerifyShortLivedPayload<StreamFlixSessionService.GuestHandoffPayload>(
            config,
            StreamFlixSessionService.GuestHandoffTokenPurpose,
            rawCookie);
        if (handoff == null || string.IsNullOrWhiteSpace(handoff.Code))
        {
            return StatusCode(401, new
            {
                verified = false,
                code = "guest_handoff_expired",
                message = "Guest Pass link session expired or cookies were blocked. Open the Guest Pass link again or enter the pass code.",
            });
        }

        return await RedeemGuestPassAndActivateAsync(config, handoff.Code, request).ConfigureAwait(false);
    }

    [HttpPost("Guest/Redeem")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RedeemGuestPassByCode([FromBody] RedeemGuestPassRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (string.IsNullOrWhiteSpace(request?.Code))
        {
            return BadRequest(new { verified = false, message = "Enter your Guest Pass code or invite link." });
        }

        var config = Config;
        return await RedeemGuestPassAndActivateAsync(config, request!.Code, request).ConfigureAwait(false);
    }

    private int PruneDeadGuestPassesNoLock(PluginConfiguration config) =>
        PruneDeadGuestPassesNoLock(config, out _);

    private int PruneDeadGuestPassesNoLock(PluginConfiguration config, out List<string> prunedIds)
    {
        prunedIds = new List<string>();
        if (config.GuestPasses == null || config.GuestPasses.Count == 0)
        {
            return 0;
        }

        var collected = prunedIds;
        return config.GuestPasses.RemoveAll(g =>
        {
            var status = GetGuestPassStatus(g);
            var dead = status == "revoked" || status == "expired";
            if (!dead)
            {
                var prof = FindProfile(config, g.ProfileId);
                dead = prof == null || IsProfileLinkedToAdmin(prof);
            }

            if (dead && !string.IsNullOrWhiteSpace(g.Id))
            {
                collected.Add(g.Id);
            }

            return dead;
        });
    }

    private CookieOptions BuildGuestCookieOptions(TimeSpan maxAge)
    {
        return new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsEffectiveHttps(),
            Path = GetScopedCookiePath("/StreamFlix/Guest"),
            MaxAge = maxAge,
            IsEssential = true,
        };
    }

    private void DeleteGuestCookie(string cookieName)
    {
        Response.Cookies.Delete(cookieName, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsEffectiveHttps(),
            Path = GetScopedCookiePath("/StreamFlix/Guest"),
            IsEssential = true,
        });
    }

    private static bool IsGuestSession(CallerContext caller)
    {
        return !caller.IsAdmin
            && caller.Session != null
            && string.Equals(caller.Session.AuthKind, StreamFlixSessionService.AuthKindGuestPass, StringComparison.Ordinal);
    }

    private static bool IsEffectiveActiveAdmin(CallerContext caller)
    {
        if (caller.IsJellyfinAuthenticated && caller.JellyfinUser != null)
        {
            return StreamFlixStartupTask.IsUserAdminCompat(caller.JellyfinUser);
        }

        return caller.IsAdmin;
    }

    private bool IsProfileAllowedGuestPassManager(PluginConfiguration config, StreamFlixProfileConfig? profile)
    {
        if (profile == null || profile.IsKids || string.IsNullOrWhiteSpace(profile.Id) || IsProfileLinkedToAdmin(profile))
        {
            return false;
        }

        return (config.GuestPassManagerProfileIds ?? new List<string>())
            .Any(id => string.Equals(id?.Trim(), profile.Id, StringComparison.OrdinalIgnoreCase));
    }

    private bool CanCallerManageGuestPasses(PluginConfiguration config, CallerContext caller)
    {
        if (!HasHouseholdAccess(config, caller) || IsGuestSession(caller))
        {
            return false;
        }

        if (caller.IsJellyfinAuthenticated && caller.JellyfinUser != null)
        {
            if (StreamFlixStartupTask.IsUserAdminCompat(caller.JellyfinUser))
            {
                return true;
            }

            var activeUid = caller.JellyfinUser.Id.ToString("N");
            return (config.Profiles ?? new List<StreamFlixProfileConfig>())
                .Any(p => string.Equals(p.JellyfinUserId, activeUid, StringComparison.OrdinalIgnoreCase)
                    && IsProfileAllowedGuestPassManager(config, p));
        }

        return caller.IsAdmin;
    }

    private static string GetGuestPassStatus(StreamFlixGuestPass pass)
    {
        if (pass.Revoked)
        {
            return "revoked";
        }

        if (!DateTimeOffset.TryParse(pass.ExpiresAtUtc, out var exp) || exp <= DateTimeOffset.UtcNow)
        {
            return "expired";
        }

        if (pass.MaxRedemptions > 0 && pass.RedemptionCount >= pass.MaxRedemptions)
        {
            return "exhausted";
        }

        return "active";
    }

    private object MapGuestPassAdmin(PluginConfiguration config, StreamFlixGuestPass pass)
    {
        var liveProfile = FindProfile(config, pass.ProfileId);
        var status = GetGuestPassStatus(pass);
        var code = !pass.Revoked ? StreamFlixSessionService.ComputeGuestPassCode(config, pass) : string.Empty;
        var shareUrl = !string.IsNullOrEmpty(code) ? BuildAbsoluteGuestPassUri(code) : string.Empty;
        return new
        {
            id = pass.Id,
            label = pass.Label,
            profileId = pass.ProfileId,
            profileName = liveProfile?.Name ?? pass.ProfileNameSnapshot,
            profileEmoji = liveProfile?.AvatarEmoji ?? "🎬",
            profileColorHex = SanitizeHexColor(liveProfile?.AvatarColorHex),
            createdAtUtc = pass.CreatedAtUtc,
            expiresAtUtc = pass.ExpiresAtUtc,
            maxRedemptions = pass.MaxRedemptions,
            redemptionCount = pass.RedemptionCount,
            lastRedeemedAtUtc = pass.LastRedeemedAtUtc,
            revoked = pass.Revoked,
            revokedAtUtc = pass.RevokedAtUtc,
            status,
            code,
            shareUrl,
        };
    }

    private string BuildAbsolutePublicBaseUrl()
    {
        var scheme = Request.Scheme;
        var host = Request.Host.Value;
        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;

        var remoteIp = HttpContext.Connection.RemoteIpAddress;
        if (remoteIp != null && StreamFlixSessionService.IsPrivateOrLoopbackIp(remoteIp))
        {
            var fwdProto = Request.Headers["X-Forwarded-Proto"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (fwdProto != null && (string.Equals(fwdProto, "https", StringComparison.OrdinalIgnoreCase)
                || string.Equals(fwdProto, "http", StringComparison.OrdinalIgnoreCase)))
            {
                scheme = fwdProto.ToLowerInvariant();
            }
            else if (string.Equals(Request.Headers["X-Forwarded-Ssl"].ToString().Trim(), "on", StringComparison.OrdinalIgnoreCase)
                || Request.Headers["CF-Visitor"].ToString().Contains("\"https\"", StringComparison.OrdinalIgnoreCase))
            {
                scheme = "https";
            }

            var fwdHost = Request.Headers["X-Forwarded-Host"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(fwdHost) && IsSafeHostHeader(fwdHost))
            {
                host = fwdHost;
            }

            if (string.IsNullOrEmpty(pathBase))
            {
                var fwdPrefix = Request.Headers["X-Forwarded-Prefix"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
                if (!string.IsNullOrWhiteSpace(fwdPrefix) && fwdPrefix.StartsWith('/') && !fwdPrefix.StartsWith("//", StringComparison.Ordinal) && !fwdPrefix.Contains('\\'))
                {
                    pathBase = fwdPrefix.TrimEnd('/');
                }
            }
        }

        if (string.Equals(scheme, "http", StringComparison.OrdinalIgnoreCase))
        {
            var originHeader = Request.Headers.Origin.ToString().Trim();
            if (string.IsNullOrEmpty(originHeader))
            {
                originHeader = Request.Headers.Referer.ToString().Trim();
            }

            if (Uri.TryCreate(originHeader, UriKind.Absolute, out var originUri)
                && string.Equals(originUri.Scheme, "https", StringComparison.OrdinalIgnoreCase)
                && string.Equals(originUri.Authority, host, StringComparison.OrdinalIgnoreCase))
            {
                scheme = "https";
            }
        }

        return $"{scheme}://{host}{pathBase.TrimEnd('/')}";
    }

    private string BuildAbsoluteGuestPassUri(string code)
    {
        return $"{BuildAbsolutePublicBaseUrl()}/StreamFlix/Guest/{Uri.EscapeDataString(code)}";
    }

    private static string BuildGuestReturnUrl(string safeRelativeWebPath, string? errorMessage, string? watchPartyCode = null, Guid? watchPartyItemId = null)
    {
        if (string.IsNullOrWhiteSpace(errorMessage))
        {
            var wpParams = (!string.IsNullOrWhiteSpace(watchPartyCode) ? $"&watchparty={Uri.EscapeDataString(watchPartyCode)}" : string.Empty)
                + (watchPartyItemId.HasValue ? $"&wpitem={watchPartyItemId.Value:D}" : string.Empty);
            return $"{safeRelativeWebPath}?sf_guest=1{wpParams}#/home";
        }

        return $"{safeRelativeWebPath}?sf_guest_error={Uri.EscapeDataString(errorMessage.Trim())}#/home";
    }

    private static string BuildGuestDeviceId(string passId, string? clientDeviceId)
    {
        var suffix = string.Empty;
        if (!string.IsNullOrWhiteSpace(clientDeviceId))
        {
            var chars = clientDeviceId.Trim()
                .Where(c => char.IsLetterOrDigit(c) || c == '-')
                .Take(24)
                .ToArray();
            suffix = new string(chars);
        }

        if (string.IsNullOrEmpty(suffix))
        {
            suffix = Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();
        }

        return $"streamflix-guest-{passId}-{suffix}";
    }

    private static void TrackGuestAccessToken(string passId, string accessToken)
    {
        if (string.IsNullOrWhiteSpace(passId) || string.IsNullOrWhiteSpace(accessToken))
        {
            return;
        }

        if (ActiveGuestTokens.Count > 256)
        {
            ActiveGuestTokens.Clear();
        }

        var bag = ActiveGuestTokens.GetOrAdd(passId, _ => new ConcurrentBag<string>());
        if (bag.Count < 64)
        {
            bag.Add(accessToken);
        }
    }

    private async Task<int> RevokeGuestJellyfinSessionsAsync(string passId)
    {
        if (string.IsNullOrWhiteSpace(passId))
        {
            return 0;
        }

        var tokensToRevoke = new HashSet<string>(StringComparer.Ordinal);
        if (ActiveGuestTokens.TryRemove(passId, out var trackedBag))
        {
            foreach (var tok in trackedBag)
            {
                if (!string.IsNullOrWhiteSpace(tok))
                {
                    tokensToRevoke.Add(tok);
                }
            }
        }

        var devicePrefix = $"streamflix-guest-{passId}-";
        try
        {
            var liveSessions = _sessionManager.Sessions?.ToList();
            if (liveSessions != null)
            {
                foreach (var sess in liveSessions)
                {
                    if (sess?.DeviceId == null || !sess.DeviceId.StartsWith(devicePrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (sess.GetType().GetProperty("AccessToken")?.GetValue(sess) is string liveTok
                        && !string.IsNullOrWhiteSpace(liveTok))
                    {
                        tokensToRevoke.Add(liveTok);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error scanning live sessions during Guest Pass revocation.");
        }

        var revokedCount = 0;
        foreach (var tok in tokensToRevoke)
        {
            if (await LogoutSingleJellyfinTokenAsync(tok).ConfigureAwait(false))
            {
                revokedCount++;
            }
        }

        return revokedCount;
    }

    private async Task<ActionResult<object>> RedeemGuestPassAndActivateAsync(
        PluginConfiguration config,
        string rawCode,
        RedeemGuestPassRequest? request)
    {
        var lockKey = "guest|" + StreamFlixSessionService.GetRateLimitClientKey(HttpContext);
        if (StreamFlixSessionService.IsGuestLockedOut(lockKey, out var retryAfter))
        {
            var secs = (int)Math.Ceiling(retryAfter.TotalSeconds);
            Response.Headers["Retry-After"] = secs.ToString(CultureInfo.InvariantCulture);
            return StatusCode(429, new
            {
                verified = false,
                code = "guest_locked",
                retryAfterSeconds = secs,
                message = $"Too many failed Guest Pass attempts. Try again in {Math.Max(1, (secs + 59) / 60)} min.",
            });
        }

        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);

        StreamFlixGuestPass? pass = null;
        StreamFlixProfileConfig? profile = null;
        StreamFlixSessionService.SessionInfo? guestSession = null;
        var sessionToken = string.Empty;
        List<string> prunedRedeemIds;

        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!StreamFlixSessionService.TryVerifyGuestPassForRedemption(config, rawCode, out pass, out var failureReason)
                || pass == null)
            {
                StreamFlixSessionService.RegisterGuestFailure(lockKey);
                return StatusCode(403, new
                {
                    verified = false,
                    code = "guest_invalid",
                    message = failureReason,
                });
            }

            profile = FindProfile(config, pass.ProfileId);
            if (profile == null || IsProfileLinkedToAdmin(profile))
            {
                return StatusCode(403, new
                {
                    verified = false,
                    code = "guest_profile_invalid",
                    message = "This Guest Pass is no longer linked to an eligible non-administrator profile.",
                });
            }

            pass.RedemptionCount = Math.Max(0, pass.RedemptionCount) + 1;
            pass.LastRedeemedAtUtc = DateTimeOffset.UtcNow.ToString("O");
            guestSession = StreamFlixSessionService.IssueGuestPassSession(config, pass, profile, out sessionToken);
            PruneDeadGuestPassesNoLock(config, out prunedRedeemIds);
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        foreach (var gpId in prunedRedeemIds)
        {
            await RevokeGuestJellyfinSessionsAsync(gpId).ConfigureAwait(false);
        }

        StreamFlixSessionService.ResetGuestFailures(lockKey);

        // Resolve the assigned non-administrator Jellyfin user and sign the guest directly into it (never create users during guest redemption)
        var primaryAdmin = StreamFlixStartupTask.GetPrimaryAdminUserCompat(_userManager);
        var user = (!string.IsNullOrWhiteSpace(profile.JellyfinUserId) && Guid.TryParse(profile.JellyfinUserId, out var parsedUid))
            ? _userManager.GetUserById(parsedUid)
            : null;
        if (user == null)
        {
            var targetName = !string.IsNullOrWhiteSpace(profile.JellyfinUsername) ? profile.JellyfinUsername.Trim() : profile.Name.Trim();
            user = StreamFlixStartupTask.FindSafeUserByName(_userManager, config, profile, targetName, profile.Name);
            if (user != null)
            {
                profile.IsPluginCreatedJellyfinUser = false;
            }
        }

        if (user == null || StreamFlixStartupTask.IsUserDisabledCompat(user) || StreamFlixStartupTask.IsUserAdminCompat(user))
        {
            return StatusCode(403, new
            {
                verified = false,
                code = "guest_user_unavailable",
                message = "The Jellyfin account for this Guest Pass is currently unavailable.",
            });
        }

        var needsUpdate = false;
        if (profile.IsPluginCreatedJellyfinUser)
        {
            var desiredAge = StreamFlixStartupTask.ParentalAgeFromMaturity(profile.MaturityRating, profile.IsKids);
            if (StreamFlixStartupTask.TryGetMaxParentalAge(user) != desiredAge && StreamFlixStartupTask.TrySetMaxParentalAge(user, desiredAge))
            {
                needsUpdate = true;
            }

            if (!profile.PermissionsInitialized)
            {
                if (StreamFlixStartupTask.InitializeNewPluginUserPermissions(user, primaryAdmin, profile.AllowedLibraryIds))
                {
                    needsUpdate = true;
                }

                profile.PermissionsInitialized = true;
                Plugin.Instance?.SaveConfiguration();
            }
            else if (JellyfinCompat.SyncUserLibraryRestriction(user, profile.AllowedLibraryIds))
            {
                needsUpdate = true;
            }

            if (StreamFlixStartupTask.EnsureUserSyncPlayAccess(user, allowCreateAndJoin: !profile.IsKids))
            {
                needsUpdate = true;
            }
        }

        if (needsUpdate)
        {
            await _userManager.UpdateUserAsync(user).ConfigureAwait(false);
        }

        var deviceId = BuildGuestDeviceId(pass.Id, request?.DeviceId);
        var authRequest = new AuthenticationRequest
        {
            App = !string.IsNullOrWhiteSpace(request?.AppName) ? request!.AppName!.Trim() : "Jellyfin Web",
            AppVersion = !string.IsNullOrWhiteSpace(request?.AppVersion) ? request!.AppVersion!.Trim() : "10.11.0",
            DeviceId = deviceId,
            DeviceName = $"StreamFlix Guest ({(string.IsNullOrWhiteSpace(pass.Label) ? profile.Name : pass.Label)})",
            UserId = user.Id,
            Username = user.Username,
            RemoteEndPoint = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1",
        };

        AuthenticationResult authResult;
        try
        {
            authResult = await _sessionManager.AuthenticateDirect(authRequest).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Guest Pass AuthenticateDirect failed for '{Username}'.", user.Username);
            return StatusCode(403, new
            {
                verified = false,
                code = "guest_auth_failed",
                message = "Could not start the Guest Pass media session.",
            });
        }

        if (!string.IsNullOrWhiteSpace(authResult.AccessToken))
        {
            TrackGuestAccessToken(pass.Id, authResult.AccessToken);
        }

        var guestCaller = new CallerContext(guestSession, true, false, StreamFlixSessionService.IsLocalLanRequest(HttpContext), user);
        var mappedProfile = MapProfilePublic(config, profile, guestCaller);

        return Ok(new
        {
            verified = true,
            authKind = StreamFlixSessionService.AuthKindGuestPass,
            sessionToken,
            expiresAt = guestSession.ExpiresAt,
            guestPassId = pass.Id,
            guestPassLabel = pass.Label,
            lockedProfileId = profile.Id,
            activation = new
            {
                userId = user.Id.ToString("N"),
                userName = user.Username,
                jellyfinUsername = user.Username,
                accessToken = authResult.AccessToken,
                serverId = _appHost.SystemId,
                serverName = _appHost.FriendlyName,
                user = authResult.User,
                sessionInfo = authResult.SessionInfo,
                profile = mappedProfile,
            },
        });
    }
}
