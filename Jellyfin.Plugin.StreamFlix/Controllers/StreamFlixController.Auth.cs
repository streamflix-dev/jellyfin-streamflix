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


// Google OAuth 2.0, Standard/Admin Jellyfin Login & Custom OpenID Connect (OIDC)
public partial class StreamFlixController
{
    [HttpPost("VerifyGoogle")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> VerifyGoogle([FromBody] VerifyGoogleRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (string.IsNullOrWhiteSpace(request?.AccessToken))
        {
            return BadRequest(new { verified = false, message = "Missing Google OAuth access token." });
        }

        var config = Config;
        if (!config.EnableGoogleSignIn)
        {
            return StatusCode(403, new { verified = false, code = "google_disabled", message = "Google Sign-In is currently disabled in StreamFlix settings." });
        }

        var configuredClientId = (config.GoogleClientId ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(configuredClientId))
        {
            return StatusCode(403, new { verified = false, code = "google_not_configured", message = "Google OAuth Client ID is not configured on this server yet." });
        }

        var accessToken = request!.AccessToken!.Trim();

        try
        {
            // 1. Make sure the token was minted for *this* server's OAuth client (prevents token substitution
            //    from other Google apps the user has signed into).
            using (var infoResp = await HttpClient.GetAsync("https://oauth2.googleapis.com/tokeninfo?access_token=" + Uri.EscapeDataString(accessToken)).ConfigureAwait(false))
            {
                if (!infoResp.IsSuccessStatusCode)
                {
                    return StatusCode(401, new { verified = false, message = "Google rejected this sign-in. Please try again." });
                }

                using var infoDoc = JsonDocument.Parse(await infoResp.Content.ReadAsStringAsync().ConfigureAwait(false));
                var infoRoot = infoDoc.RootElement;
                var aud = infoRoot.TryGetProperty("aud", out var audProp) ? audProp.GetString() : null;
                var azp = infoRoot.TryGetProperty("azp", out var azpProp) ? azpProp.GetString() : null;
                var issuedTo = infoRoot.TryGetProperty("issued_to", out var itProp) ? itProp.GetString() : null;
                var audience = infoRoot.TryGetProperty("audience", out var auProp) ? auProp.GetString() : null;
                if (!string.Equals(aud, configuredClientId, StringComparison.Ordinal)
                    && !string.Equals(azp, configuredClientId, StringComparison.Ordinal)
                    && !string.Equals(issuedTo, configuredClientId, StringComparison.Ordinal)
                    && !string.Equals(audience, configuredClientId, StringComparison.Ordinal))
                {
                    return StatusCode(401, new { verified = false, message = "This Google token was issued for a different app." });
                }
            }

            // 2. Fetch the verified identity.
            using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.googleapis.com/oauth2/v3/userinfo");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var resp = await HttpClient.SendAsync(req).ConfigureAwait(false);

            if (!resp.IsSuccessStatusCode)
            {
                return StatusCode(401, new { verified = false, message = $"Google UserInfo endpoint returned HTTP {(int)resp.StatusCode}." });
            }

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
            var root = doc.RootElement;
            var email = root.TryGetProperty("email", out var emailProp) ? (emailProp.GetString() ?? string.Empty).Trim().ToLowerInvariant() : string.Empty;
            var name = root.TryGetProperty("name", out var nameProp) ? (nameProp.GetString() ?? string.Empty) : email;
            var picture = root.TryGetProperty("picture", out var picProp) ? (picProp.GetString() ?? string.Empty) : string.Empty;
            var emailVerified = root.TryGetProperty("email_verified", out var evProp)
                && (evProp.ValueKind == JsonValueKind.True
                    || (evProp.ValueKind == JsonValueKind.String && string.Equals(evProp.GetString(), "true", StringComparison.OrdinalIgnoreCase)));

            if (string.IsNullOrEmpty(email) || !emailVerified)
            {
                return StatusCode(401, new { verified = false, message = "Your Google account needs a verified email address." });
            }

            // 3. First-run claim: on a brand-new install (no approved accounts and no Google account ever claimed),
            //    the first verified Google account becomes approved. Once claimed, an emptied allowlist can't be claimed by a stranger.
            var nobodyApproved = (config.ApprovedGoogleAccounts == null || config.ApprovedGoogleAccounts.Count == 0)
                && !(config.Profiles ?? new()).Any(p => !string.IsNullOrWhiteSpace(p.GoogleAccountEmail))
                && !config.FirstGoogleAccountClaimed;
            if (nobodyApproved)
            {
                config.ApprovedGoogleAccounts = new List<string> { email };
                config.FirstGoogleAccountClaimed = true;
                Plugin.Instance?.SaveConfiguration();
                _logger.LogInformation("StreamFlix: first sign-in claimed by {Email}; added to Approved Google Accounts.", email);
            }

            if (!StreamFlixSessionService.IsEmailApproved(config, email))
            {
                var unapprovedMsg = $"{email} isn't approved for this StreamFlix server. Ask the owner to add it in Dashboard → Plugins → StreamFlix.";
                if (!string.IsNullOrWhiteSpace(request.DesktopRelayStateId))
                {
                    StreamFlixOidcService.StoreCompletedFlow(request.DesktopRelayStateId, null, unapprovedMsg);
                }

                return StatusCode(403, new
                {
                    verified = false,
                    unapproved = true,
                    email,
                    message = unapprovedMsg,
                });
            }

            if (!config.FirstGoogleAccountClaimed)
            {
                config.FirstGoogleAccountClaimed = true;
                Plugin.Instance?.SaveConfiguration();
            }

            var session = StreamFlixSessionService.Issue(config, email, out var sessionToken);
            var relayedPendingProfileId = string.Empty;
            if (!string.IsNullOrWhiteSpace(request.DesktopRelayStateId))
            {
                relayedPendingProfileId = StreamFlixOidcService.PeekPendingProfileId(request.DesktopRelayStateId) ?? string.Empty;
                var relayHandoff = new StreamFlixOidcService.OidcHandoffPayload(
                    SessionToken: sessionToken,
                    ProviderName: "Google",
                    Email: email,
                    Username: string.Empty,
                    Name: name,
                    Picture: picture,
                    ExpiresAt: session.ExpiresAt.ToString("O"),
                    PendingProfileId: relayedPendingProfileId);
                StreamFlixOidcService.StoreCompletedFlow(request.DesktopRelayStateId, relayHandoff, errorMessage: null);
            }

            return Ok(new
            {
                verified = true,
                email,
                name,
                picture,
                sessionToken,
                expiresAt = session.ExpiresAt,
                desktopRelayCompleted = !string.IsNullOrWhiteSpace(request.DesktopRelayStateId),
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: error verifying Google OAuth token.");
            if (!string.IsNullOrWhiteSpace(request.DesktopRelayStateId))
            {
                StreamFlixOidcService.StoreCompletedFlow(request.DesktopRelayStateId, null, "Could not reach Google to verify your sign-in. Please try again.");
            }

            return StatusCode(500, new { verified = false, message = "Could not reach Google to verify your sign-in. Please try again." });
        }
    }

    [HttpPost("Auth/GoogleDesktopBegin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<object> BeginGoogleDesktopRelay([FromBody] BeginOidcRequest? request = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        if (!config.EnableGoogleSignIn || string.IsNullOrWhiteSpace(config.GoogleClientId))
        {
            return StatusCode(403, new { code = "google_disabled", message = "Google Sign-In is not enabled on this server." });
        }

        var (stateId, pollSecret) = StreamFlixOidcService.CreateDesktopRelayFlow(request?.PendingProfileId, request?.LoginHint);
        return Ok(new
        {
            stateId,
            pollSecret,
        });
    }

    [HttpGet("Auth/DesktopRelayStatus")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<object> GetDesktopRelayStatus([FromQuery] string? stateId = null)
    {
        SetNoStoreSecurityHeaders();
        var statusEntry = StreamFlixOidcService.PeekDesktopRelayStatus(stateId);
        return Ok(new
        {
            status = statusEntry.Status,
            who = statusEntry.Who,
            message = statusEntry.ErrorMessage,
        });
    }

    [HttpGet("Auth/DesktopLaunch")]
    [AllowAnonymous]
    public ContentResult LaunchDesktopSsoTab(
        [FromQuery] string? kind = null,
        [FromQuery] string? stateId = null,
        [FromQuery] string? returnWebBase = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var cleanKind = (kind ?? "google").Trim().ToLowerInvariant();
        var cleanState = (stateId ?? string.Empty).Trim().ToLowerInvariant();
        var safeWebBase = ResolveSafeRelativeWebPath(returnWebBase);
        var info = StreamFlixOidcService.TryGetPendingDesktopLaunchInfo(cleanState);

        if (!info.Found)
        {
            return Content(
                BuildDesktopLauncherHtml(config, cleanState, string.Empty, string.Empty, string.Empty, "Sign-in session expired. Start sign-in again from Jellyfin Media Player."),
                "text/html; charset=utf-8");
        }

        if (string.Equals(cleanKind, "oidc", StringComparison.Ordinal))
        {
            if (!StreamFlixOidcService.IsConfigured(config) || string.IsNullOrWhiteSpace(info.AuthRedirectUrl))
            {
                return Content(
                    BuildDesktopLauncherHtml(config, cleanState, string.Empty, string.Empty, string.Empty, "OpenID Connect sign-in is not available on this server."),
                    "text/html; charset=utf-8");
            }

            var providerLabel = StreamFlixOidcService.GetDisplayProviderName(config);
            return Content(
                BuildDesktopLauncherHtml(config, cleanState, providerLabel, info.AuthRedirectUrl, safeWebBase, null),
                "text/html; charset=utf-8");
        }

        var googleClientId = (config.GoogleClientId ?? string.Empty).Trim();
        if (!config.EnableGoogleSignIn || string.IsNullOrEmpty(googleClientId))
        {
            return Content(
                BuildDesktopLauncherHtml(config, cleanState, string.Empty, string.Empty, string.Empty, "Google Sign-In is not enabled on this server."),
                "text/html; charset=utf-8");
        }

        return Content(
            BuildDesktopLauncherHtml(config, cleanState, "Google", string.Empty, safeWebBase, null, googleClientId, info.LoginHint),
            "text/html; charset=utf-8");
    }

    [HttpPost("Auth/GoogleDesktopPoll")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<object> PollGoogleDesktopRelay([FromBody] CompleteOidcRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || string.IsNullOrWhiteSpace(request.StateId) || string.IsNullOrWhiteSpace(request.PollSecret))
        {
            return BadRequest(new { status = "invalid", verified = false, message = "Missing stateId or pollSecret." });
        }

        var config = Config;
        var pollRes = StreamFlixOidcService.PollOrClaimFlow(request.StateId, request.PollSecret);
        if (string.Equals(pollRes.Status, "pending", StringComparison.Ordinal))
        {
            return Ok(new { status = "pending", verified = false });
        }

        if (string.Equals(pollRes.Status, "error", StringComparison.Ordinal))
        {
            return Ok(new
            {
                status = "error",
                verified = false,
                message = pollRes.ErrorMessage ?? "Google sign-in failed.",
            });
        }

        if (string.Equals(pollRes.Status, "complete", StringComparison.Ordinal) && pollRes.Handoff != null)
        {
            var validated = StreamFlixSessionService.Validate(config, pollRes.Handoff.SessionToken);
            if (validated == null)
            {
                return StatusCode(401, new { status = "error", verified = false, message = "Google session is no longer valid." });
            }

            return Ok(new
            {
                status = "complete",
                verified = true,
                email = pollRes.Handoff.Email,
                name = pollRes.Handoff.Name,
                picture = pollRes.Handoff.Picture,
                sessionToken = pollRes.Handoff.SessionToken,
                expiresAt = pollRes.Handoff.ExpiresAt,
                pendingProfileId = pollRes.Handoff.PendingProfileId,
            });
        }

        return Ok(new { status = "expired", verified = false });
    }

    [HttpPost("Auth/StandardLogin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> StandardLogin([FromBody] PasswordLoginRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        if (!config.AllowStandardJellyfinLogin)
        {
            return StatusCode(403, new
            {
                verified = false,
                code = "standard_login_disabled",
                message = "Standard Jellyfin account sign-in is disabled on this server.",
            });
        }

        var username = (request?.Username ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(username))
        {
            return BadRequest(new { verified = false, message = "Enter your Jellyfin username." });
        }

        var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1";
        var lockKey = "std|" + StreamFlixSessionService.GetRateLimitClientKey(HttpContext);
        if (StreamFlixSessionService.IsLoginLockedOut(lockKey, out var retryAfter))
        {
            var secs = (int)Math.Ceiling(retryAfter.TotalSeconds);
            Response.Headers["Retry-After"] = secs.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return StatusCode(429, new
            {
                verified = false,
                code = "login_locked",
                retryAfterSeconds = secs,
                message = $"Too many failed sign-in attempts. Try again in {Math.Max(1, (secs + 59) / 60)} min.",
            });
        }

        var user = await StreamFlixStartupTask.AuthenticateUserCompatAsync(
            _userManager,
            username,
            request?.Password ?? string.Empty,
            remoteIp,
            _logger).ConfigureAwait(false);

        if (user == null)
        {
            StreamFlixSessionService.RegisterLoginFailure(lockKey);
            return StatusCode(401, new
            {
                verified = false,
                code = "invalid_credentials",
                message = "Invalid Jellyfin username or password.",
            });
        }

        StreamFlixSessionService.ResetLoginFailures(lockKey);
        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);
        var isAdmin = StreamFlixStartupTask.IsUserAdminCompat(user);
        var isLocalLan = StreamFlixSessionService.IsLocalLanRequest(HttpContext, config.TreatTailscaleAsLocalLan);
        if (!isAdmin && !isLocalLan && !StreamFlixStartupTask.HasRemoteAccessCompat(user))
        {
            return StatusCode(403, new
            {
                verified = false,
                code = "remote_access_disabled",
                message = $"Remote connections are disabled for \"{user.Username}\" in Jellyfin User Settings.",
            });
        }

        await EnsureProfileForJellyfinUserAsync(config, user).ConfigureAwait(false);

        var kind = isAdmin
            ? StreamFlixSessionService.AuthKindJellyfinAdmin
            : StreamFlixSessionService.AuthKindJellyfin;
        var session = StreamFlixSessionService.IssueJellyfinSession(
            config,
            kind,
            user.Id.ToString("N"),
            user.Username,
            out var sessionToken);

        AuthenticationResult? adminAuth = null;
        if (isAdmin)
        {
            adminAuth = await TryMintAdminJellyfinAuthAsync(user, request, remoteIp).ConfigureAwait(false);
        }

        return Ok(new
        {
            verified = true,
            authKind = session.AuthKind,
            userId = user.Id.ToString("N"),
            username = user.Username,
            name = user.Username,
            isAdmin,
            sessionToken,
            expiresAt = session.ExpiresAt,
            jellyfinAccessToken = adminAuth?.AccessToken,
            user = adminAuth?.User,
            sessionInfo = adminAuth?.SessionInfo,
            serverId = _appHost.SystemId,
        });
    }

    [HttpPost("Auth/AdminLogin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> AdminLogin([FromBody] PasswordLoginRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var isUnconfiguredGate = IsGateUnconfigured(config);
        if (!config.AllowAdminFallbackLogin && !isUnconfiguredGate)
        {
            return StatusCode(403, new
            {
                verified = false,
                code = "admin_fallback_disabled",
                message = "Admin Sign-In is disabled in StreamFlix settings.",
            });
        }

        var isLocalLan = StreamFlixSessionService.IsLocalLanRequest(HttpContext, config.TreatTailscaleAsLocalLan);
        if (config.AdminFallbackLanOnly && !isUnconfiguredGate && !isLocalLan)
        {
            return StatusCode(403, new
            {
                verified = false,
                code = "lan_only",
                message = "Admin Sign-In is restricted to local network (LAN) connections.",
            });
        }

        var username = (request?.Username ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(username))
        {
            return BadRequest(new { verified = false, message = "Enter an Administrator username." });
        }

        var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1";
        var lockKey = "adm|" + StreamFlixSessionService.GetRateLimitClientKey(HttpContext);
        if (StreamFlixSessionService.IsLoginLockedOut(lockKey, out var retryAfter))
        {
            var secs = (int)Math.Ceiling(retryAfter.TotalSeconds);
            Response.Headers["Retry-After"] = secs.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return StatusCode(429, new
            {
                verified = false,
                code = "login_locked",
                retryAfterSeconds = secs,
                message = $"Too many failed sign-in attempts. Try again in {Math.Max(1, (secs + 59) / 60)} min.",
            });
        }

        var user = await StreamFlixStartupTask.AuthenticateUserCompatAsync(
            _userManager,
            username,
            request?.Password ?? string.Empty,
            remoteIp,
            _logger).ConfigureAwait(false);

        if (user == null)
        {
            StreamFlixSessionService.RegisterLoginFailure(lockKey);
            return StatusCode(401, new
            {
                verified = false,
                code = "invalid_credentials",
                message = "Invalid Jellyfin username or password.",
            });
        }

        // Strict backend Administrator privilege enforcement — non-admin Jellyfin accounts are never allowed here
        if (!StreamFlixStartupTask.IsUserAdminCompat(user))
        {
            StreamFlixSessionService.RegisterLoginFailure(lockKey);
            _logger.LogWarning("StreamFlix: denied Admin Sign-In attempt for non-administrator Jellyfin user '{Username}'.", user.Username);
            return StatusCode(403, new
            {
                verified = false,
                code = "admin_only",
                message = "Access denied: Only Jellyfin accounts with Administrator privileges can sign in through Admin Sign-In.",
            });
        }

        StreamFlixSessionService.ResetLoginFailures(lockKey);
        await SyncProfilesAsync(config, force: true).ConfigureAwait(false);
        var session = StreamFlixSessionService.IssueJellyfinSession(
            config,
            StreamFlixSessionService.AuthKindJellyfinAdmin,
            user.Id.ToString("N"),
            user.Username,
            out var sessionToken);

        var adminAuth = await TryMintAdminJellyfinAuthAsync(user, request, remoteIp).ConfigureAwait(false);

        return Ok(new
        {
            verified = true,
            authKind = session.AuthKind,
            userId = user.Id.ToString("N"),
            username = user.Username,
            name = user.Username,
            isAdmin = true,
            sessionToken,
            expiresAt = session.ExpiresAt,
            jellyfinAccessToken = adminAuth?.AccessToken,
            user = adminAuth?.User,
            sessionInfo = adminAuth?.SessionInfo,
            serverId = _appHost.SystemId,
        });
    }

    [HttpPost("Auth/ElevateAdmin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ElevateAdminForDashboard([FromBody] ElevateAdminRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller) || !IsEffectiveActiveAdmin(caller) || IsGuestSession(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Switch to an Administrator profile first to open Server Settings." });
        }

        await SyncProfilesAsync(config, force: true).ConfigureAwait(false);

        var ownerProfile = (config.Profiles ?? new List<StreamFlixProfileConfig>())
            .FirstOrDefault(p => StreamFlixStartupTask.IsOwnerProfile(p) || IsProfileLinkedToAdmin(p));

        JUser? adminUser = caller.JellyfinUser;
        if (adminUser == null
            || StreamFlixStartupTask.IsUserDisabledCompat(adminUser)
            || !StreamFlixStartupTask.IsUserAdminCompat(adminUser))
        {
            adminUser = caller.Session != null && Guid.TryParse(caller.Session.JellyfinUserId, out var sessUid)
                ? _userManager.GetUserById(sessUid)
                : null;
        }

        if (adminUser == null || StreamFlixStartupTask.IsUserDisabledCompat(adminUser) || !StreamFlixStartupTask.IsUserAdminCompat(adminUser))
        {
            return StatusCode(403, new { code = "admin_not_found", message = "No active Jellyfin Administrator account was found." });
        }

        var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1";
        var pwdReq = new PasswordLoginRequest
        {
            AppName = request?.AppName,
            AppVersion = request?.AppVersion,
            DeviceId = request?.DeviceId,
            DeviceName = request?.DeviceName,
        };
        var authRes = await TryMintAdminJellyfinAuthAsync(adminUser, pwdReq, remoteIp).ConfigureAwait(false);
        if (authRes == null || string.IsNullOrWhiteSpace(authRes.AccessToken))
        {
            return StatusCode(500, new { code = "admin_token_failed", message = "Could not mint Jellyfin Administrator session." });
        }

        return Ok(new
        {
            ok = true,
            userId = adminUser.Id.ToString("N"),
            userName = adminUser.Username,
            jellyfinUsername = adminUser.Username,
            accessToken = authRes.AccessToken,
            serverId = _appHost.SystemId,
            serverName = _appHost.FriendlyName,
            user = authRes.User,
            sessionInfo = authRes.SessionInfo,
            profile = ownerProfile != null ? MapProfilePublic(config, ownerProfile, caller) : null,
        });
    }

    [HttpPost("TestOAuthConfig")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> TestOAuthConfig([FromBody] TestOAuthConfigRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can validate OAuth settings." });
        }

        var checks = new List<object>();
        var hasError = false;
        var hasWarn = false;

        void AddCheck(string label, string status, string detail)
        {
            if (status == "error")
            {
                hasError = true;
            }
            else if (status == "warn")
            {
                hasWarn = true;
            }

            checks.Add(new { label, status, detail });
        }

        // 1. Validate Google Client ID format
        var rawClientId = request?.GoogleClientId ?? string.Empty;
        var clientId = rawClientId.Trim();
        if (string.IsNullOrEmpty(clientId))
        {
            AddCheck("OAuth Client ID", "error", "Client ID is empty. Paste your Web application Client ID ending in .apps.googleusercontent.com.");
        }
        else if (clientId.StartsWith("{", StringComparison.Ordinal) || clientId.Contains("\"client_id\"", StringComparison.OrdinalIgnoreCase))
        {
            AddCheck("OAuth Client ID", "error", "It looks like full JSON was pasted. Paste only the client_id value (123456-abc.apps.googleusercontent.com).");
        }
        else if (clientId.StartsWith("GOCSPX-", StringComparison.OrdinalIgnoreCase))
        {
            AddCheck("OAuth Client ID", "error", "That value is a Client Secret (GOCSPX-...), not a Client ID. Move it to Client Secret and paste your .apps.googleusercontent.com Client ID above.");
        }
        else if (!GoogleClientIdRegex.IsMatch(clientId))
        {
            AddCheck("OAuth Client ID", "error", $"\"{clientId}\" does not match Google's Web OAuth Client ID format (<project-number>-<id>.apps.googleusercontent.com).");
        }
        else if (!string.Equals(rawClientId, clientId, StringComparison.Ordinal))
        {
            AddCheck("OAuth Client ID", "ok", "Valid Google Web Client ID format (extra leading/trailing spaces will be trimmed automatically on Save).");
        }
        else
        {
            AddCheck("OAuth Client ID", "ok", "Valid Google Web Client ID format.");
        }

        // 2. Validate Authorized JavaScript Origin
        var originRaw = (request?.OriginUri ?? string.Empty).Trim();
        Uri? originParsed = null;
        if (string.IsNullOrEmpty(originRaw) || !Uri.TryCreate(originRaw, UriKind.Absolute, out originParsed))
        {
            AddCheck("JavaScript Origin", "error", "Browser origin URL could not be parsed as a valid http(s) origin.");
        }
        else
        {
            var authority = originParsed.GetLeftPart(UriPartial.Authority);
            var isHttps = string.Equals(originParsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
            var isHttp = string.Equals(originParsed.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase);
            var isLocalhost = string.Equals(originParsed.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || string.Equals(originParsed.Host, "127.0.0.1", StringComparison.Ordinal);
            var isRawIp = System.Net.IPAddress.TryParse(originParsed.Host, out _);

            if (!string.Equals(originRaw, authority, StringComparison.Ordinal) || !string.IsNullOrEmpty(originParsed.Query) || !string.IsNullOrEmpty(originParsed.Fragment))
            {
                AddCheck("JavaScript Origin", "error", $"Origin must be scheme + host (+ optional port) with no path or trailing slash: {authority}");
            }
            else if (isHttps && !isRawIp)
            {
                AddCheck("JavaScript Origin", "ok", $"Valid HTTPS domain origin ({authority}). Ensure this exact URL is listed under Authorized JavaScript origins in Google Cloud Console.");
            }
            else if (isHttp && isLocalhost)
            {
                AddCheck("JavaScript Origin", "ok", $"Localhost HTTP origin ({authority}) is accepted by Google OAuth for local browser testing.");
            }
            else if (isRawIp)
            {
                AddCheck("JavaScript Origin", "warn", $"You are currently browsing via a raw IP address ({authority}). Google Cloud Console rejects raw IP addresses (except localhost) in Web OAuth origins — open Jellyfin via an HTTPS domain for Google Sign-In, or enable Standard Jellyfin Login / LAN Bypass for local IP access.");
            }
            else if (isHttp)
            {
                AddCheck("JavaScript Origin", "warn", $"Current origin uses plain HTTP ({authority}). Google Cloud Console requires HTTPS for non-localhost Web OAuth origins.");
            }
            else
            {
                AddCheck("JavaScript Origin", "error", $"Unsupported URI scheme '{originParsed.Scheme}'.");
            }
        }

        // 3. Validate Authorized Redirect URIs
        var redirects = (request?.RedirectUris ?? new List<string>())
            .Select(u => (u ?? string.Empty).Trim())
            .Where(u => !string.IsNullOrEmpty(u))
            .ToList();
        if (redirects.Count == 0)
        {
            AddCheck("Redirect URIs", "error", "No redirect URIs provided.");
        }
        else
        {
            var badRedirect = redirects.FirstOrDefault(r =>
                !Uri.TryCreate(r, UriKind.Absolute, out var ru)
                || !string.IsNullOrEmpty(ru.Fragment)
                || (originParsed != null && !string.Equals(ru.GetLeftPart(UriPartial.Authority), originParsed.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)));

            if (badRedirect != null)
            {
                AddCheck("Redirect URIs", "error", $"Redirect URI \"{badRedirect}\" is malformed, contains a #fragment, or does not match the JavaScript origin.");
            }
            else
            {
                AddCheck("Redirect URIs", "ok", $"{redirects.Count} redirect URI(s) properly formatted and matched to origin.");
            }
        }

        // 4. Validate Approved Google Accounts list
        var rawEmails = request?.ApprovedEmails ?? new List<string>();
        var validEmails = new List<string>();
        var invalidEmails = new List<string>();
        foreach (var entry in rawEmails)
        {
            var e = (entry ?? string.Empty).Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(e))
            {
                continue;
            }

            if (EmailRegex.IsMatch(e))
            {
                if (!validEmails.Contains(e, StringComparer.OrdinalIgnoreCase))
                {
                    validEmails.Add(e);
                }
            }
            else
            {
                invalidEmails.Add(entry?.Trim() ?? string.Empty);
            }
        }

        var lockedProfileCount = (config.Profiles ?? new List<StreamFlixProfileConfig>())
            .Count(p => !string.IsNullOrWhiteSpace(p.GoogleAccountEmail));
        if (invalidEmails.Count > 0)
        {
            AddCheck("Approved Google Accounts", "error", $"Invalid email syntax: {string.Join(", ", invalidEmails.Take(4))}");
        }
        else if (validEmails.Count == 0 && lockedProfileCount == 0)
        {
            AddCheck("Approved Google Accounts", "warn", "Allowlist is empty. Add at least one Gmail / Google Workspace address before enabling Google Sign-In.");
        }
        else
        {
            AddCheck("Approved Google Accounts", "ok", $"{validEmails.Count} approved email(s) valid" + (lockedProfileCount > 0 ? $" (+ {lockedProfileCount} profile-locked email(s))." : "."));
        }

        // 5. Probe outbound HTTPS reachability from Jellyfin Server to Google OAuth
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var probeResp = await HttpClient.GetAsync("https://accounts.google.com/.well-known/openid-configuration", cts.Token).ConfigureAwait(false);
            sw.Stop();
            if (probeResp.IsSuccessStatusCode)
            {
                AddCheck("Server → Google HTTPS", "ok", $"Jellyfin server reached Google OAuth endpoints in {sw.ElapsedMilliseconds} ms.");
            }
            else
            {
                AddCheck("Server → Google HTTPS", "warn", $"Google discovery endpoint returned HTTP {(int)probeResp.StatusCode} ({sw.ElapsedMilliseconds} ms).");
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            AddCheck("Server → Google HTTPS", "error", $"Jellyfin server cannot reach accounts.google.com over HTTPS ({ex.GetType().Name}). Check container DNS / outbound firewall rules.");
        }

        var overall = hasError ? "error" : (hasWarn ? "warn" : "ok");
        var summary = overall == "ok"
            ? "All OAuth format & server connectivity checks passed."
            : (overall == "warn"
                ? "Configuration is syntactically valid, with warnings to review below."
                : "One or more OAuth configuration issues must be fixed before Google Sign-In will work.");

        return Ok(new
        {
            status = overall,
            summary,
            checks,
        });
    }

    [HttpPost("Oidc/Begin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> BeginOidcSignIn([FromBody] BeginOidcRequest? request)
    {
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        var config = Config;
        var safeWebBase = ResolveSafeRelativeWebPath(request?.ReturnWebBase);

        if (!StreamFlixOidcService.IsConfigured(config))
        {
            return BadRequest(new
            {
                code = "oidc_disabled",
                message = "OpenID Connect sign-in is not enabled on this server.",
            });
        }

        try
        {
            var (authUrl, stateId, pollSecret) = await PrepareOidcAuthorizationSessionAsync(
                config,
                safeWebBase,
                request?.LoginHint,
                request?.PendingProfileId,
                request?.DesktopRelay == true).ConfigureAwait(false);
            return Ok(new
            {
                authorizeUrl = authUrl,
                stateId,
                pollSecret,
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: failed to prepare OIDC authorization redirect.");
            return StatusCode(502, new
            {
                code = "oidc_begin_failed",
                message = ex.Message,
            });
        }
    }

    [HttpGet("Oidc/Start")]
    [AllowAnonymous]
    public async Task<ActionResult> StartOidcSignIn(
        [FromQuery] string? returnWebBase = null,
        [FromQuery] string? pendingProfileId = null,
        [FromQuery] string? loginHint = null)
    {
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        var config = Config;
        var safeWebBase = ResolveSafeRelativeWebPath(returnWebBase);

        if (!StreamFlixOidcService.IsConfigured(config))
        {
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: "OpenID Connect sign-in is not enabled on this server."));
        }

        try
        {
            var (authUrl, _, _) = await PrepareOidcAuthorizationSessionAsync(
                config,
                safeWebBase,
                loginHint,
                pendingProfileId).ConfigureAwait(false);
            return Redirect(authUrl);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: failed to initiate OIDC authorization redirect.");
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: ex.Message));
        }
    }

    private async Task<(string AuthUrl, string StateId, string PollSecret)> PrepareOidcAuthorizationSessionAsync(
        PluginConfiguration config,
        string safeWebBase,
        string? loginHint,
        string? pendingProfileId,
        bool desktopRelay = false)
    {
        var callbackUri = BuildAbsoluteOidcCallbackUri();
        var (authUrl, stateId, signedStateCookie, pollSecret) = await StreamFlixOidcService.CreateAuthorizationRedirectAsync(
            config,
            callbackUri,
            safeWebBase,
            loginHint,
            pendingProfileId,
            HttpContext.RequestAborted,
            desktopRelay).ConfigureAwait(false);

        // Clean up any legacy root-scoped state cookies (Path=/) and keep at most 2 concurrent per-tab state cookies
        if (Request.Cookies.ContainsKey(StreamFlixOidcService.StateCookieName))
        {
            DeleteLegacyRootCookie(StreamFlixOidcService.StateCookieName);
            DeleteOidcCookie(StreamFlixOidcService.StateCookieName);
        }

        var existingScopedStateCookies = Request.Cookies.Keys
            .Where(k => k.StartsWith(StreamFlixOidcService.StateCookiePrefix, StringComparison.Ordinal))
            .ToList();
        if (existingScopedStateCookies.Count >= 2)
        {
            foreach (var oldKey in existingScopedStateCookies.Take(existingScopedStateCookies.Count - 1))
            {
                DeleteOidcCookie(oldKey);
            }
        }

        var stateCookieName = StreamFlixOidcService.GetStateCookieName(stateId);
        Response.Cookies.Append(
            stateCookieName,
            signedStateCookie,
            BuildOidcCookieOptions(TimeSpan.FromMinutes(10)));

        return (authUrl, stateId, pollSecret);
    }

    [HttpGet("Oidc/Callback")]
    [AllowAnonymous]
    public async Task<ActionResult> CompleteOidcCallback(
        [FromQuery] string? code = null,
        [FromQuery] string? state = null,
        [FromQuery] string? error = null,
        [FromQuery(Name = "error_description")] string? errorDescription = null)
    {
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        var config = Config;
        var scopedCookieName = StreamFlixOidcService.GetStateCookieName(state);
        var rawStateCookie = Request.Cookies[scopedCookieName];
        if (string.IsNullOrEmpty(rawStateCookie)
            && !string.Equals(scopedCookieName, StreamFlixOidcService.StateCookieName, StringComparison.Ordinal))
        {
            rawStateCookie = Request.Cookies[StreamFlixOidcService.StateCookieName];
        }

        DeleteOidcCookie(scopedCookieName);
        if (Request.Cookies.ContainsKey(StreamFlixOidcService.StateCookieName))
        {
            DeleteOidcCookie(StreamFlixOidcService.StateCookieName);
            DeleteLegacyRootCookie(StreamFlixOidcService.StateCookieName);
        }

        var statePayload = StreamFlixSessionService.VerifyShortLivedPayload<StreamFlixOidcService.OidcStatePayload>(
            config,
            StreamFlixOidcService.StateTokenPurpose,
            rawStateCookie);
        if (statePayload != null)
        {
            StreamFlixOidcService.MarkPendingStateConsumed(statePayload.StateId);
        }
        else
        {
            // Mobile WebView fallback (iOS WKWebView ITP / hardened Android WebView / external browser):
            // recover the one-time pending PKCE state keyed by the cryptographic state parameter.
            statePayload = StreamFlixOidcService.TryConsumePendingState(state);
        }

        var safeWebBase = ResolveSafeRelativeWebPath(statePayload?.ReturnWebBase);

        if (!StreamFlixOidcService.IsConfigured(config))
        {
            StreamFlixOidcService.StoreCompletedFlow(state, null, "OpenID Connect sign-in is disabled on this server.");
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: "OpenID Connect sign-in is disabled on this server."));
        }

        if (statePayload == null)
        {
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: "Sign-in session expired or cookies were blocked. Please try signing in again."));
        }

        if (!string.IsNullOrWhiteSpace(error))
        {
            var friendly = string.Equals(error.Trim(), "access_denied", StringComparison.OrdinalIgnoreCase)
                ? "Sign-in was canceled."
                : (!string.IsNullOrWhiteSpace(errorDescription) ? errorDescription.Trim() : $"Identity provider returned error: {error.Trim()}");
            if (friendly.Length > 220)
            {
                friendly = friendly.Substring(0, 220);
            }

            StreamFlixOidcService.StoreCompletedFlow(statePayload.StateId, null, friendly);
            if (statePayload.DesktopRelay)
            {
                return Content(BuildDesktopRelayPopupCompleteHtml(config, string.Empty, statePayload.StateId, friendly), "text/html; charset=utf-8");
            }

            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: friendly, stateId: statePayload.StateId));
        }

        try
        {
            var identity = await StreamFlixOidcService.CompleteCallbackAsync(
                config,
                code ?? string.Empty,
                state ?? string.Empty,
                statePayload,
                HttpContext.RequestAborted).ConfigureAwait(false);

            var verifiedEmail = identity.EmailVerified && !string.IsNullOrWhiteSpace(identity.Email)
                ? identity.Email.Trim().ToLowerInvariant()
                : null;

            if (!StreamFlixSessionService.IsOidcUserApproved(config, verifiedEmail, identity.Username, identity.Subject))
            {
                var who = !string.IsNullOrWhiteSpace(identity.Email)
                    ? identity.Email
                    : (!string.IsNullOrWhiteSpace(identity.Username) ? identity.Username : identity.Subject);
                var denyMsg = $"{who} isn't on the approved OIDC allowlist for this StreamFlix server. Ask the owner to add it in Dashboard → Plugins → StreamFlix.";
                StreamFlixOidcService.StoreCompletedFlow(statePayload.StateId, null, denyMsg);
                if (statePayload.DesktopRelay)
                {
                    return Content(BuildDesktopRelayPopupCompleteHtml(config, string.Empty, statePayload.StateId, denyMsg), "text/html; charset=utf-8");
                }

                return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: denyMsg, stateId: statePayload.StateId));
            }

            var session = StreamFlixSessionService.IssueOidcSession(
                config,
                verifiedEmail,
                identity.Username,
                identity.Subject,
                out var sessionToken);

            var providerName = StreamFlixOidcService.GetDisplayProviderName(config);
            var handoffPayload = new StreamFlixOidcService.OidcHandoffPayload(
                SessionToken: sessionToken,
                ProviderName: providerName,
                Email: verifiedEmail ?? string.Empty,
                Username: identity.Username,
                Name: identity.Name,
                Picture: identity.Picture,
                ExpiresAt: session.ExpiresAt.ToString("O"),
                PendingProfileId: statePayload.PendingProfileId ?? string.Empty);

            StreamFlixOidcService.StoreCompletedFlow(statePayload.StateId, handoffPayload, errorMessage: null);

            if (statePayload.DesktopRelay)
            {
                var whoSuccess = verifiedEmail ?? (!string.IsNullOrWhiteSpace(identity.Username) ? identity.Username : identity.Name);
                return Content(BuildDesktopRelayPopupCompleteHtml(config, whoSuccess ?? string.Empty, statePayload.StateId, null), "text/html; charset=utf-8");
            }

            var signedHandoff = StreamFlixSessionService.SignShortLivedPayload(
                config,
                StreamFlixOidcService.HandoffTokenPurpose,
                handoffPayload,
                TimeSpan.FromSeconds(75));

            if (Request.Cookies.ContainsKey(StreamFlixOidcService.HandoffCookieName))
            {
                DeleteLegacyRootCookie(StreamFlixOidcService.HandoffCookieName);
            }

            Response.Cookies.Append(
                StreamFlixOidcService.HandoffCookieName,
                signedHandoff,
                BuildOidcCookieOptions(TimeSpan.FromSeconds(75)));

            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: null, stateId: statePayload.StateId, desktopRelay: statePayload.DesktopRelay));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: OIDC callback verification failed.");
            StreamFlixOidcService.StoreCompletedFlow(statePayload.StateId, null, ex.Message);
            if (statePayload.DesktopRelay)
            {
                return Content(BuildDesktopRelayPopupCompleteHtml(config, string.Empty, statePayload.StateId, ex.Message), "text/html; charset=utf-8");
            }

            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: ex.Message, stateId: statePayload.StateId, desktopRelay: statePayload.DesktopRelay));
        }
    }

    [HttpPost("Oidc/Complete")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<object> CompleteOidcHandoff([FromBody] CompleteOidcRequest? request = null)
    {
        Response.Headers["Cache-Control"] = "no-store";
        var config = Config;
        var rawHandoff = Request.Cookies[StreamFlixOidcService.HandoffCookieName];
        DeleteOidcCookie(StreamFlixOidcService.HandoffCookieName);
        DeleteLegacyRootCookie(StreamFlixOidcService.HandoffCookieName);

        var handoff = StreamFlixSessionService.VerifyShortLivedPayload<StreamFlixOidcService.OidcHandoffPayload>(
            config,
            StreamFlixOidcService.HandoffTokenPurpose,
            rawHandoff);

        // If cookies worked in this same WebView/browser AND the caller also supplied its pollSecret, retire the server-side entry too
        if (handoff != null && !string.IsNullOrWhiteSpace(request?.StateId) && !string.IsNullOrWhiteSpace(request?.PollSecret))
        {
            _ = StreamFlixOidcService.PollOrClaimFlow(request.StateId, request.PollSecret);
        }
        else if (handoff == null && !string.IsNullOrWhiteSpace(request?.StateId) && !string.IsNullOrWhiteSpace(request?.PollSecret))
        {
            // Cookie-blocked mobile WebView fallback: verify one-time cryptographic pollSecret
            var pollRes = StreamFlixOidcService.PollOrClaimFlow(request.StateId, request.PollSecret);
            if (string.Equals(pollRes.Status, "complete", StringComparison.Ordinal))
            {
                handoff = pollRes.Handoff;
            }
            else if (string.Equals(pollRes.Status, "error", StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(pollRes.ErrorMessage))
            {
                return StatusCode(401, new
                {
                    verified = false,
                    code = "oidc_callback_error",
                    message = pollRes.ErrorMessage,
                });
            }
        }

        if (handoff == null || string.IsNullOrWhiteSpace(handoff.SessionToken))
        {
            return StatusCode(401, new
            {
                verified = false,
                code = "oidc_handoff_expired",
                message = "OpenID Connect sign-in handoff expired. Please sign in again.",
            });
        }

        return BuildVerifiedOidcHandoffResult(config, handoff);
    }

    [HttpPost("Oidc/Poll")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<object> PollOidcHandoff([FromBody] CompleteOidcRequest? request)
    {
        Response.Headers["Cache-Control"] = "no-store";
        if (request == null || string.IsNullOrWhiteSpace(request.StateId) || string.IsNullOrWhiteSpace(request.PollSecret))
        {
            return BadRequest(new { status = "invalid", verified = false, message = "Missing stateId or pollSecret." });
        }

        var config = Config;
        var pollRes = StreamFlixOidcService.PollOrClaimFlow(request.StateId, request.PollSecret);
        if (string.Equals(pollRes.Status, "pending", StringComparison.Ordinal))
        {
            return Ok(new { status = "pending", verified = false });
        }

        if (string.Equals(pollRes.Status, "error", StringComparison.Ordinal))
        {
            return Ok(new
            {
                status = "error",
                verified = false,
                message = pollRes.ErrorMessage ?? "OpenID Connect sign-in failed.",
            });
        }

        if (string.Equals(pollRes.Status, "complete", StringComparison.Ordinal) && pollRes.Handoff != null)
        {
            return BuildVerifiedOidcHandoffResult(config, pollRes.Handoff, includeCompleteStatus: true);
        }

        return Ok(new { status = "expired", verified = false });
    }

    private ActionResult<object> BuildVerifiedOidcHandoffResult(
        PluginConfiguration config,
        StreamFlixOidcService.OidcHandoffPayload handoff,
        bool includeCompleteStatus = false)
    {
        // Re-validate the minted session against current config before handing it to the client
        var validated = StreamFlixSessionService.Validate(config, handoff.SessionToken);
        if (validated == null)
        {
            return StatusCode(401, new
            {
                status = "error",
                verified = false,
                code = "oidc_session_invalid",
                message = "OpenID Connect session is no longer valid.",
            });
        }

        return Ok(new
        {
            status = includeCompleteStatus ? "complete" : null,
            verified = true,
            authKind = StreamFlixSessionService.AuthKindOidc,
            providerName = handoff.ProviderName,
            email = handoff.Email,
            username = !string.IsNullOrWhiteSpace(handoff.Username) ? handoff.Username : (validated.Username ?? string.Empty),
            name = handoff.Name,
            picture = handoff.Picture,
            sessionToken = handoff.SessionToken,
            expiresAt = handoff.ExpiresAt,
            pendingProfileId = handoff.PendingProfileId,
        });
    }

    [HttpPost("TestOidcConfig")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> TestOidcConfig([FromBody] TestOidcConfigRequest? request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can validate OIDC settings." });
        }

        var cleanAllowlist = (request?.ApprovedOidcUsers ?? new List<string>())
            .Select(u => (u ?? string.Empty).Trim())
            .Where(u => !string.IsNullOrEmpty(u))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var callbackUri = !string.IsNullOrWhiteSpace(request?.CallbackUri)
            ? request!.CallbackUri!.Trim()
            : BuildAbsoluteOidcCallbackUri();

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
        cts.CancelAfter(TimeSpan.FromSeconds(10));

        var (status, summary, checks) = await StreamFlixOidcService.TestDiscoveryAsync(
            request?.OidcIssuerUrl,
            request?.OidcClientId,
            callbackUri,
            request?.OidcRequireAllowlist == true,
            cleanAllowlist.Count,
            cts.Token).ConfigureAwait(false);

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

    private async Task<AuthenticationResult?> TryMintAdminJellyfinAuthAsync(JUser user, PasswordLoginRequest? request, string remoteIp)
    {
        try
        {
            var appName = !string.IsNullOrWhiteSpace(request?.AppName)
                ? request!.AppName!.Trim()
                : (!string.IsNullOrWhiteSpace(request?.ClientName) ? request!.ClientName!.Trim() : "Jellyfin Web");
            var appVer = !string.IsNullOrWhiteSpace(request?.AppVersion)
                ? request!.AppVersion!.Trim()
                : (!string.IsNullOrWhiteSpace(request?.ClientVersion) ? request!.ClientVersion!.Trim() : "10.11.0");
            var authReq = new AuthenticationRequest
            {
                App = appName,
                AppVersion = appVer,
                DeviceId = !string.IsNullOrWhiteSpace(request?.DeviceId) ? request!.DeviceId!.Trim() : $"streamflix-admin-{user.Id:N}",
                DeviceName = !string.IsNullOrWhiteSpace(request?.DeviceName) ? request!.DeviceName!.Trim() : $"StreamFlix Admin ({user.Username})",
                UserId = user.Id,
                Username = user.Username,
                RemoteEndPoint = remoteIp,
            };
            return await _sessionManager.AuthenticateDirect(authReq).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: optional AuthenticateDirect token mint skipped for '{Username}'.", user.Username);
            return null;
        }
    }

    private string BuildAbsoluteOidcCallbackUri()
    {
        var scheme = Request.Scheme;
        var host = Request.Host.Value;
        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;

        // When behind a local/Docker/Tailscale reverse proxy (e.g. Caddy, Nginx, Traefik), honor forwarded scheme/host/prefix safely
        var remoteIp = HttpContext.Connection.RemoteIpAddress;
        if (remoteIp != null && StreamFlixSessionService.IsPrivateOrLoopbackIp(remoteIp, Config.TreatTailscaleAsLocalLan))
        {
            var fwdProto = Request.Headers["X-Forwarded-Proto"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (fwdProto != null && (string.Equals(fwdProto, "https", StringComparison.OrdinalIgnoreCase)
                || string.Equals(fwdProto, "http", StringComparison.OrdinalIgnoreCase)))
            {
                scheme = fwdProto.ToLowerInvariant();
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

        return $"{scheme}://{host}{pathBase.TrimEnd('/')}/StreamFlix/Oidc/Callback";
    }

    private string ResolveSafeRelativeWebPath(string? requested)
    {
        var defaultWebPath = (Request.PathBase.HasValue ? Request.PathBase.Value.TrimEnd('/') : string.Empty) + "/web/index.html";
        if (string.IsNullOrWhiteSpace(requested))
        {
            return defaultWebPath;
        }

        var trimmed = requested.Trim();
        var qIdx = trimmed.IndexOfAny(new[] { '?', '#' });
        if (qIdx >= 0)
        {
            trimmed = trimmed.Substring(0, qIdx);
        }

        if (trimmed.Length == 0
            || trimmed.Length > 200
            || !trimmed.StartsWith('/')
            || trimmed.StartsWith("//", StringComparison.Ordinal)
            || trimmed.Contains('\\')
            || trimmed.Contains(':')
            || trimmed.Any(c => char.IsControl(c)))
        {
            return defaultWebPath;
        }

        return trimmed;
    }

    private static string BuildOidcReturnUrl(string safeRelativeWebPath, string? errorMessage, string? stateId = null, bool desktopRelay = false)
    {
        var stateSuffix = !string.IsNullOrWhiteSpace(stateId)
            ? $"&sf_state={Uri.EscapeDataString(stateId.Trim())}"
            : string.Empty;
        var desktopSuffix = desktopRelay ? "&sf_desktop=1" : string.Empty;
        if (string.IsNullOrWhiteSpace(errorMessage))
        {
            return $"{safeRelativeWebPath}?sf_oidc=1{stateSuffix}{desktopSuffix}#/home";
        }

        return $"{safeRelativeWebPath}?sf_oidc_error={Uri.EscapeDataString(errorMessage.Trim())}{stateSuffix}{desktopSuffix}#/home";
    }

    private bool IsEffectiveHttps()
    {
        if (Request.IsHttps)
        {
            return true;
        }

        var remoteIp = HttpContext.Connection.RemoteIpAddress;
        if (remoteIp != null && StreamFlixSessionService.IsPrivateOrLoopbackIp(remoteIp, Config.TreatTailscaleAsLocalLan))
        {
            var fwdProto = Request.Headers["X-Forwarded-Proto"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (string.Equals(fwdProto, "https", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private string GetCookieBasePath()
    {
        var pb = Request.PathBase.HasValue ? Request.PathBase.Value.TrimEnd('/') : string.Empty;
        return string.IsNullOrEmpty(pb) ? "/" : pb;
    }

    private string GetScopedCookiePath(string subPath)
    {
        var pb = Request.PathBase.HasValue ? Request.PathBase.Value.TrimEnd('/') : string.Empty;
        return pb + subPath;
    }

    private CookieOptions BuildOidcCookieOptions(TimeSpan maxAge)
    {
        return new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsEffectiveHttps(),
            Path = GetScopedCookiePath("/StreamFlix/Oidc"),
            MaxAge = maxAge,
            IsEssential = true,
        };
    }

    private void DeleteOidcCookie(string cookieName)
    {
        Response.Cookies.Delete(cookieName, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsEffectiveHttps(),
            Path = GetScopedCookiePath("/StreamFlix/Oidc"),
            IsEssential = true,
        });
    }

    private void DeleteLegacyRootCookie(string cookieName)
    {
        Response.Cookies.Delete(cookieName, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsEffectiveHttps(),
            Path = GetCookieBasePath(),
            IsEssential = true,
        });
    }

    private string BuildDesktopLauncherHtml(
        PluginConfiguration config,
        string stateId,
        string providerLabel,
        string directAuthUrl,
        string safeWebBase,
        string? initialError,
        string? googleClientId = null,
        string? loginHint = null)
    {
        var brand = string.IsNullOrWhiteSpace(config.CustomBrandName) ? "StreamFlix" : config.CustomBrandName.Trim();
        var accent = NormalizeSafeHexColor(config.CustomAccentColor);
        var encBrand = System.Net.WebUtility.HtmlEncode(brand);
        var encBrandUpper = System.Net.WebUtility.HtmlEncode(brand.ToUpperInvariant());
        var encProvider = System.Net.WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(providerLabel) ? "Single Sign-On" : providerLabel);
        var basePath = Request.PathBase.HasValue ? Request.PathBase.Value.TrimEnd('/') : string.Empty;
        var statusEndpoint = $"{basePath}/StreamFlix/Auth/DesktopRelayStatus?stateId={Uri.EscapeDataString(stateId)}";

        var jsState = JsonSerializer.Serialize(stateId);
        var jsDirectUrl = JsonSerializer.Serialize(directAuthUrl ?? string.Empty);
        var jsSafeWebBase = JsonSerializer.Serialize(safeWebBase ?? "/web/index.html");
        var jsGoogleClientId = JsonSerializer.Serialize(googleClientId ?? string.Empty);
        var jsLoginHint = JsonSerializer.Serialize(loginHint ?? string.Empty);
        var jsStatusUrl = JsonSerializer.Serialize(statusEndpoint);
        var jsInitialErr = JsonSerializer.Serialize(initialError ?? string.Empty);
        var jsProvider = JsonSerializer.Serialize(string.IsNullOrWhiteSpace(providerLabel) ? "Single Sign-On" : providerLabel);
        var jsBrandUpper = JsonSerializer.Serialize(brand.ToUpperInvariant());

        return $@"<!DOCTYPE html>
<html lang=""en"">
<head>
<meta charset=""utf-8"" />
<meta name=""viewport"" content=""width=device-width, initial-scale=1"" />
<title>Sign in to {encBrand}</title>
<style>
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0; padding: 0; min-height: 100vh;
    background: radial-gradient(circle at 50% 0%, rgba(229,9,20,0.16), transparent 52%), #0d0d10;
    color: #f3f4f6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }}
  .sf-card {{
    width: 100%; max-width: 440px; background: rgba(20,20,25,0.96);
    border: 1px solid rgba(255,255,255,0.10); border-radius: 18px;
    padding: 34px 32px 28px; text-align: center;
    box-shadow: 0 28px 80px rgba(0,0,0,0.68);
  }}
  .sf-brand {{
    display: inline-block; font-weight: 900; font-size: 13px; letter-spacing: 0.2em;
    color: {accent}; margin-bottom: 18px;
  }}
  .sf-badge {{
    width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 18px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(34,197,94,0.18); border: 1px solid rgba(34,197,94,0.42); color: #4ade80;
    box-shadow: 0 0 28px rgba(34,197,94,0.25);
  }}
  .sf-badge.err {{ background: rgba(239,68,68,0.16); border-color: rgba(239,68,68,0.42); color: #f87171; box-shadow: none; }}
  h1 {{ margin: 0 0 10px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: #fff; }}
  p {{ margin: 0 0 24px; font-size: 14.5px; line-height: 1.55; color: rgba(255,255,255,0.72); }}
  p strong {{ color: #fff; }}
  .sf-btn {{
    width: 100%; height: 46px; border-radius: 11px; border: 0; cursor: pointer;
    font: inherit; font-size: 15px; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    transition: transform 0.12s ease, opacity 0.15s ease, background 0.15s ease;
  }}
  .sf-btn:active {{ transform: scale(0.985); }}
  .sf-btn-primary {{ background: #fff; color: #111827; margin-bottom: 10px; }}
  .sf-btn-primary:hover {{ background: #f3f4f6; }}
  .sf-btn-accent {{ background: {accent}; color: #fff; margin-bottom: 10px; }}
  .sf-btn-accent:hover {{ opacity: 0.92; }}
  .sf-btn-ghost {{
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.82);
    border: 1px solid rgba(255,255,255,0.12);
  }}
  .sf-btn-ghost:hover {{ background: rgba(255,255,255,0.11); color: #fff; }}
  .sf-hint {{ margin-top: 12px; font-size: 12.5px; color: rgba(255,255,255,0.52); min-height: 18px; }}
  .hide {{ display: none !important; }}
</style>
</head>
<body>
  <div class=""sf-card"" id=""sf-card"">
    <div class=""sf-brand"">{encBrandUpper}</div>
    <div class=""sf-badge hide"" id=""sf-done-badge"">
      <svg width=""28"" height=""28"" viewBox=""0 0 24 24"" fill=""none"" stroke=""currentColor"" stroke-width=""2.6"" stroke-linecap=""round"" stroke-linejoin=""round""><path d=""M5 12.5l4.5 4.5L19 7.5""/></svg>
    </div>
    <h1 id=""sf-title"">Continue to {encProvider}</h1>
    <p id=""sf-desc"">Complete your sign-in to unlock <strong>{encBrand}</strong> in the desktop app. This browser tab will close automatically when finished.</p>
    <button type=""button"" class=""sf-btn sf-btn-primary"" id=""sf-launch-btn"">Continue with {encProvider}</button>
    <button type=""button"" class=""sf-btn sf-btn-ghost"" id=""sf-close-btn"">Close Tab</button>
    <div class=""sf-hint"" id=""sf-hint""></div>
  </div>
<script>
(function() {{
  var stateId = {jsState};
  var directAuthUrl = {jsDirectUrl};
  var safeWebBase = {jsSafeWebBase};
  var googleClientId = {jsGoogleClientId};
  var loginHint = {jsLoginHint};
  var statusUrl = {jsStatusUrl};
  var initialErr = {jsInitialErr};
  var providerName = {jsProvider};
  var brandUpper = {jsBrandUpper};
  var popupWin = null;
  var finished = false;
  var pollTimer = null;

  var titleEl = document.getElementById('sf-title');
  var descEl = document.getElementById('sf-desc');
  var badgeEl = document.getElementById('sf-done-badge');
  var launchBtn = document.getElementById('sf-launch-btn');
  var closeBtn = document.getElementById('sf-close-btn');
  var hintEl = document.getElementById('sf-hint');

  function esc(s) {{
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/""/g, '&quot;');
  }}

  function buildAuthUrl() {{
    if (directAuthUrl) return directAuthUrl;
    if (!googleClientId) return '';
    var redirectUri = window.location.origin + safeWebBase;
    return 'https://accounts.google.com/o/oauth2/v2/auth'
      + '?client_id=' + encodeURIComponent(googleClientId)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&response_type=token'
      + '&scope=' + encodeURIComponent('openid email profile')
      + '&state=' + encodeURIComponent('sf_jmp_' + stateId)
      + '&include_granted_scopes=true'
      + '&prompt=select_account'
      + (loginHint ? '&login_hint=' + encodeURIComponent(loginHint) : '');
  }}

  function tryCloseSelf(fromUserClick) {{
    try {{ if (popupWin && !popupWin.closed) popupWin.close(); }} catch (e0) {{}}
    try {{ window.close(); }} catch (e1) {{}}
    try {{ var s = window.open('', '_self'); if (s) s.close(); }} catch (e2) {{}}
    if (fromUserClick) {{
      setTimeout(function() {{
        if (!window.closed && hintEl) {{
          var shortcut = /Mac|iPhone|iPad/i.test(navigator.platform || '') ? '⌘W' : 'Ctrl+W';
          hintEl.textContent = 'Your browser kept this tab open — press ' + shortcut + ' to close it.';
        }}
      }}, 160);
    }}
  }}

  function showCompletedAndAutoClose(who) {{
    if (finished) return;
    finished = true;
    if (pollTimer) {{ clearInterval(pollTimer); pollTimer = null; }}
    tryCloseSelf(false);
    setTimeout(function() {{ tryCloseSelf(false); }}, 60);
    setTimeout(function() {{ tryCloseSelf(false); }}, 180);

    badgeEl.classList.remove('hide', 'err');
    titleEl.textContent = 'Signed in to ' + brandUpper;
    descEl.innerHTML = (who ? ('Signed in as <strong>' + esc(who) + '</strong>. ') : '')
      + 'Jellyfin Media Player has been unlocked automatically — you can close this browser tab.';
    launchBtn.classList.add('hide');
    closeBtn.className = 'sf-btn sf-btn-accent';
    closeBtn.focus();
  }}

  function showErrorState(msg) {{
    if (finished) return;
    finished = true;
    if (pollTimer) {{ clearInterval(pollTimer); pollTimer = null; }}
    try {{ if (popupWin && !popupWin.closed) popupWin.close(); }} catch (e0) {{}}
    badgeEl.innerHTML = '!';
    badgeEl.style.fontSize = '24px';
    badgeEl.style.fontWeight = '900';
    badgeEl.classList.remove('hide');
    badgeEl.classList.add('err');
    titleEl.textContent = 'Sign-in could not finish';
    descEl.textContent = msg || 'Please return to Jellyfin Media Player and try again.';
    launchBtn.classList.add('hide');
    closeBtn.className = 'sf-btn sf-btn-accent';
  }}

  function openPopupFlow() {{
    var targetUrl = buildAuthUrl();
    if (!targetUrl) {{
      showErrorState('Sign-in URL is not available.');
      return false;
    }}
    var w = 520, h = 660;
    var left = Math.max(0, Math.round((window.screen.width - w) / 2));
    var top = Math.max(0, Math.round((window.screen.height - h) / 2));
    try {{
      popupWin = window.open(targetUrl, 'sf_desktop_sso_' + stateId.slice(0, 8), 'popup=1,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    }} catch (e) {{
      popupWin = null;
    }}
    if (popupWin) {{
      try {{ popupWin.focus(); }} catch (ef) {{}}
      titleEl.textContent = 'Completing sign-in…';
      descEl.innerHTML = 'Finish signing in with <strong>' + esc(providerName) + '</strong> in the popup window. Both windows will close automatically as soon as you finish.';
      launchBtn.textContent = 'Reopen ' + providerName + ' Window';
      hintEl.textContent = '';
      return true;
    }}
    return false;
  }}

  closeBtn.addEventListener('click', function() {{ tryCloseSelf(true); }});
  launchBtn.addEventListener('click', function() {{ openPopupFlow(); }});

  if (initialErr) {{
    showErrorState(initialErr);
    return;
  }}

  try {{
    if (typeof BroadcastChannel === 'function') {{
      var bc = new BroadcastChannel('streamflix_desktop_sso_v1');
      bc.onmessage = function(ev) {{
        var d = ev && ev.data;
        if (d && (!d.stateId || d.stateId === stateId)) {{
          if (d.type === 'desktop_sso_complete') showCompletedAndAutoClose(d.who || '');
          else if (d.type === 'desktop_sso_error') showErrorState(d.message || '');
        }}
      }};
    }}
  }} catch (eBc) {{}}

  window.addEventListener('storage', function(ev) {{
    if (!ev || ev.key !== 'streamflix_desktop_sso_done_v1' || !ev.newValue) return;
    try {{
      var d = JSON.parse(ev.newValue);
      if (d && (!d.stateId || d.stateId === stateId)) {{
        if (d.type === 'desktop_sso_complete') showCompletedAndAutoClose(d.who || '');
        else if (d.type === 'desktop_sso_error') showErrorState(d.message || '');
      }}
    }} catch (eSt) {{}}
  }});

  pollTimer = setInterval(function() {{
    if (finished || !stateId) return;
    fetch(statusUrl, {{ cache: 'no-store', credentials: 'same-origin' }})
      .then(function(r) {{ return r.ok ? r.json() : null; }})
      .then(function(res) {{
        if (!res || !res.status || res.status === 'pending') return;
        if (res.status === 'complete') showCompletedAndAutoClose(res.who || '');
        else if (res.status === 'error') showErrorState(res.message || '');
      }})
      .catch(function() {{}});
  }}, 650);

  if (!openPopupFlow()) {{
    try {{ launchBtn.focus(); }} catch (eF) {{}}
  }}
}})();
</script>
</body>
</html>";
    }

    private static string BuildDesktopRelayPopupCompleteHtml(PluginConfiguration config, string whoLabel, string stateId, string? errorMessage)
    {
        var brand = string.IsNullOrWhiteSpace(config.CustomBrandName) ? "StreamFlix" : config.CustomBrandName.Trim();
        var accent = NormalizeSafeHexColor(config.CustomAccentColor);
        var encBrandUpper = System.Net.WebUtility.HtmlEncode(brand.ToUpperInvariant());
        var encWho = System.Net.WebUtility.HtmlEncode(whoLabel ?? string.Empty);
        var encErr = System.Net.WebUtility.HtmlEncode(errorMessage ?? string.Empty);
        var isErr = !string.IsNullOrWhiteSpace(errorMessage);
        var jsPayload = JsonSerializer.Serialize(new
        {
            type = isErr ? "desktop_sso_error" : "desktop_sso_complete",
            stateId = stateId ?? string.Empty,
            who = whoLabel ?? string.Empty,
            message = errorMessage ?? string.Empty,
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });

        var heading = isErr ? "Sign-in could not finish" : $"Signed in to {encBrandUpper}";
        var bodyCopy = isErr
            ? encErr
            : ((string.IsNullOrEmpty(encWho) ? string.Empty : $"Signed in as <strong>{encWho}</strong>. ")
                + "Jellyfin Media Player has been unlocked automatically — closing this window…");

        return $@"<!DOCTYPE html>
<html lang=""en"">
<head>
<meta charset=""utf-8"" />
<meta name=""viewport"" content=""width=device-width, initial-scale=1"" />
<title>{heading}</title>
<style>
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0; padding: 0; min-height: 100vh; background: #0d0d10; color: #f3f4f6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }}
  .sf-card {{
    width: 100%; max-width: 420px; background: #16161b; border: 1px solid rgba(255,255,255,0.10);
    border-radius: 18px; padding: 32px 28px; text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,0.65);
  }}
  h1 {{ margin: 0 0 10px; font-size: 22px; font-weight: 800; color: #fff; }}
  p {{ margin: 0 0 22px; font-size: 14px; line-height: 1.5; color: rgba(255,255,255,0.74); }}
  p strong {{ color: #fff; }}
  button {{
    width: 100%; height: 44px; border-radius: 10px; border: 0; cursor: pointer;
    background: {accent}; color: #fff; font: inherit; font-size: 14.5px; font-weight: 700;
  }}
  .sf-hint {{ margin-top: 10px; font-size: 12px; color: rgba(255,255,255,0.5); min-height: 16px; }}
</style>
</head>
<body>
  <div class=""sf-card"">
    <h1>{heading}</h1>
    <p>{bodyCopy}</p>
    <button type=""button"" id=""sf-close"">Close Window</button>
    <div class=""sf-hint"" id=""sf-hint""></div>
  </div>
<script>
(function() {{
  var msg = {jsPayload};
  try {{ if (typeof BroadcastChannel === 'function') new BroadcastChannel('streamflix_desktop_sso_v1').postMessage(msg); }} catch (e1) {{}}
  try {{ localStorage.setItem('streamflix_desktop_sso_done_v1', JSON.stringify(msg)); }} catch (e2) {{}}
  function closeNow(manual) {{
    try {{ window.close(); }} catch (e3) {{}}
    try {{ var s = window.open('', '_self'); if (s) s.close(); }} catch (e4) {{}}
    if (manual) {{
      setTimeout(function() {{
        var h = document.getElementById('sf-hint');
        if (!window.closed && h) {{
          h.textContent = 'Press ' + (/Mac|iPhone|iPad/i.test(navigator.platform || '') ? '⌘W' : 'Ctrl+W') + ' to close this tab.';
        }}
      }}, 150);
    }}
  }}
  document.getElementById('sf-close').addEventListener('click', function() {{ closeNow(true); }});
  closeNow(false);
  setTimeout(function() {{ closeNow(false); }}, 50);
  setTimeout(function() {{ closeNow(false); }}, 180);
}})();
</script>
</body>
</html>";
    }

    private static string NormalizeSafeHexColor(string? raw)
    {
        var s = (raw ?? string.Empty).Trim();
        if (s.Length == 7 && s[0] == '#' && s.Skip(1).All(Uri.IsHexDigit))
        {
            return s;
        }

        return "#E50914";
    }

    private static bool IsSafeHostHeader(string raw)
    {
        if (raw.Length == 0 || raw.Length > 255)
        {
            return false;
        }

        foreach (var ch in raw)
        {
            if (!(char.IsLetterOrDigit(ch) || ch is '.' or '-' or ':' or '[' or ']'))
            {
                return false;
            }
        }

        return true;
    }
}
