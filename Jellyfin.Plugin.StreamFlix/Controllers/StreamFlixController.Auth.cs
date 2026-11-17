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

        var (stateId, pollSecret) = StreamFlixOidcService.CreateDesktopRelayFlow(request?.PendingProfileId);
        return Ok(new
        {
            stateId,
            pollSecret,
        });
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
        if (!isAdmin && !IsJellyfinUserHouseholdMember(config, user))
        {
            return StatusCode(403, new
            {
                verified = false,
                code = "not_household_member",
                message = $"\"{user.Username}\" isn't linked to a StreamFlix household profile on this server. Ask an administrator to link a profile in Manage Profiles.",
            });
        }

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
