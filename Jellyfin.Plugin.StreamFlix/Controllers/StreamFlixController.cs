using System;
using System.Collections.Generic;
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

public class SetupSecretsRequest
{
    public string? GoogleClientId { get; set; }

    public string? GoogleClientSecret { get; set; }

    public bool? RequireGoogleAuth { get; set; }

    public List<string>? ApprovedGoogleAccounts { get; set; }
}

public class VerifyGoogleRequest
{
    public string AccessToken { get; set; } = string.Empty;

    public bool ApproveIfUnlisted { get; set; }
}

public class ActivateProfileRequest
{
    public string ProfileId { get; set; } = string.Empty;

    public string? Pin { get; set; }

    public string? PinCode { get; set; }

    public string? DeviceId { get; set; }

    public string? DeviceName { get; set; }

    public string? AppName { get; set; }

    public string? AppVersion { get; set; }
}

public class VerifyPinRequest
{
    public string ProfileId { get; set; } = string.Empty;

    public string? Pin { get; set; }
}

public class SaveProfileRequest
{
    public string? Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public int AvatarColorIndex { get; set; }

    public int AvatarIconIndex { get; set; }

    public string? AvatarEmoji { get; set; }

    public string? AvatarColorHex { get; set; }

    public bool IsKids { get; set; }

    public string? MaturityRating { get; set; }

    public string? Pin { get; set; }

    public string? PinCode { get; set; }

    /// <summary>
    /// Gets or sets the profile's current PIN, required to edit a PIN-protected profile unless the caller is an admin.
    /// </summary>
    public string? CurrentPin { get; set; }

    /// <summary>
    /// Gets or sets the Google account lock. <c>null</c> leaves it unchanged, an empty string clears it.
    /// </summary>
    public string? GoogleAccountEmail { get; set; }

    public bool AutoplayNextEpisode { get; set; } = true;

    public bool AutoplayPreviews { get; set; } = true;

    public string? JellyfinUserId { get; set; }

    public string? JellyfinUsername { get; set; }
}

public class ReorderProfilesRequest
{
    public List<string> ProfileIds { get; set; } = new();
}

public class DeleteProfileRequest
{
    public string ProfileId { get; set; } = string.Empty;

    public bool DeleteJellyfinUser { get; set; }

    public string? CurrentPin { get; set; }
}

/// <summary>
/// Serves the embedded StreamFlix Netflix UI script &amp; styles, verifies Google OAuth 2.0 tokens and issues signed
/// household sessions, and provisions/activates real Jellyfin Server Users per profile so every profile has its own
/// independent Watch History, Continue Watching, Next Up, and Favorites.
/// </summary>
/// <remarks>
/// Access model (v7):
/// <list type="bullet">
/// <item>Household access = a valid signed StreamFlix session (from Google sign-in), OR a Jellyfin administrator token,
/// OR the Google gate is switched off.</item>
/// <item>Profiles can additionally be locked with a PIN and/or to one specific Google account.</item>
/// <item>Only administrators may link profiles to administrator accounts, delete Jellyfin users, or change secrets.</item>
/// </list>
/// </remarks>
[ApiController]
[Route("StreamFlix")]
public class StreamFlixController : ControllerBase
{
    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(8) };

    private static readonly Lazy<EmbeddedAsset> ScriptAsset = new(() => EmbeddedAsset.Load("Jellyfin.Plugin.StreamFlix.Web.streamflix.js"));

    private static readonly Lazy<EmbeddedAsset> StyleAsset = new(() => EmbeddedAsset.Load("Jellyfin.Plugin.StreamFlix.Web.streamflix.css"));

    private static readonly SemaphoreSlim SyncLock = new(1, 1);

    private static readonly Regex EmailRegex = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    private static readonly Regex PinRegex = new(@"^\d{4,8}$", RegexOptions.Compiled);

    private static DateTime _lastSyncUtc = DateTime.MinValue;

    private static DateTime _showcaseCachedAtUtc = DateTime.MinValue;

    private static List<object> _showcaseCache = new();

    private readonly IUserManager _userManager;
    private readonly ISessionManager _sessionManager;
    private readonly IServerApplicationHost _appHost;
    private readonly ILibraryManager _libraryManager;
    private readonly IAuthorizationContext _authContext;
    private readonly ILogger<StreamFlixController> _logger;

    public StreamFlixController(
        IUserManager userManager,
        ISessionManager sessionManager,
        IServerApplicationHost appHost,
        ILibraryManager libraryManager,
        IAuthorizationContext authContext,
        ILogger<StreamFlixController> logger)
    {
        _userManager = userManager;
        _sessionManager = sessionManager;
        _appHost = appHost;
        _libraryManager = libraryManager;
        _authContext = authContext;
        _logger = logger;
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    [HttpGet("ClientScript")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        return ServeAsset(ScriptAsset.Value, "application/javascript; charset=utf-8");
    }

    [HttpGet("ClientStyles")]
    [AllowAnonymous]
    public ActionResult GetClientStyles()
    {
        return ServeAsset(StyleAsset.Value, "text/css; charset=utf-8");
    }

    [HttpGet("PublicConfig")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetPublicConfig()
    {
        Plugin.Instance?.EnsureInjectedThrottled();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);
        return Ok(BuildPublicState(config, caller));
    }

    [HttpPost("SetupSecrets")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SetupSecrets([FromBody] SetupSecretsRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can change StreamFlix secrets." });
        }

        if (request.GoogleClientId != null)
        {
            config.GoogleClientId = request.GoogleClientId.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.GoogleClientSecret))
        {
            config.GoogleClientSecret = request.GoogleClientSecret.Trim();
        }

        if (request.RequireGoogleAuth.HasValue)
        {
            config.RequireGoogleAuth = request.RequireGoogleAuth.Value;
        }

        if (request.ApprovedGoogleAccounts != null)
        {
            config.ApprovedGoogleAccounts = request.ApprovedGoogleAccounts
                .Select(e => (e ?? string.Empty).Trim().ToLowerInvariant())
                .Where(e => EmailRegex.IsMatch(e))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        Plugin.Instance?.InjectScriptIntoDiskIndexIfWritable();
        await SyncProfilesAsync(config, force: true).ConfigureAwait(false);
        Plugin.Instance?.SaveConfiguration();

        return Ok(BuildPublicState(config, caller));
    }

    [HttpPost("VerifyGoogle")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> VerifyGoogle([FromBody] VerifyGoogleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.AccessToken))
        {
            return BadRequest(new { verified = false, message = "Missing Google OAuth access token." });
        }

        var config = Config;
        var accessToken = request.AccessToken.Trim();

        try
        {
            // 1. Make sure the token was minted for *this* server's OAuth client (prevents token substitution
            //    from other Google apps the user has signed into).
            var configuredClientId = (config.GoogleClientId ?? string.Empty).Trim();
            using (var infoResp = await HttpClient.GetAsync("https://oauth2.googleapis.com/tokeninfo?access_token=" + Uri.EscapeDataString(accessToken)).ConfigureAwait(false))
            {
                if (!infoResp.IsSuccessStatusCode)
                {
                    return StatusCode(401, new { verified = false, message = "Google rejected this sign-in. Please try again." });
                }

                if (!string.IsNullOrEmpty(configuredClientId))
                {
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
            var emailVerified = !root.TryGetProperty("email_verified", out var evProp)
                || evProp.ValueKind == JsonValueKind.True
                || (evProp.ValueKind == JsonValueKind.String && string.Equals(evProp.GetString(), "true", StringComparison.OrdinalIgnoreCase));

            if (string.IsNullOrEmpty(email) || !emailVerified)
            {
                return StatusCode(401, new { verified = false, message = "Your Google account needs a verified email address." });
            }

            // 3. First-run claim: on a brand-new install (no approved accounts and no session ever issued), the first
            //    verified Google account becomes the owner. Once any session exists this never happens again, so an
            //    emptied allowlist can't be claimed by a stranger.
            var nobodyApproved = (config.ApprovedGoogleAccounts == null || config.ApprovedGoogleAccounts.Count == 0)
                && !(config.Profiles ?? new()).Any(p => !string.IsNullOrWhiteSpace(p.GoogleAccountEmail))
                && string.IsNullOrWhiteSpace(config.SessionSigningKey);
            if (nobodyApproved)
            {
                config.ApprovedGoogleAccounts = new List<string> { email };
                Plugin.Instance?.SaveConfiguration();
                _logger.LogInformation("StreamFlix: first sign-in claimed by {Email}; added to Approved Google Accounts.", email);
            }

            if (!StreamFlixSessionService.IsEmailApproved(config, email))
            {
                return StatusCode(403, new
                {
                    verified = false,
                    unapproved = true,
                    email,
                    message = $"{email} isn't approved for this StreamFlix server. Ask the owner to add it in Dashboard → Plugins → StreamFlix.",
                });
            }

            var session = StreamFlixSessionService.Issue(config, email, out var sessionToken);

            return Ok(new
            {
                verified = true,
                email,
                name,
                picture,
                sessionToken,
                expiresAt = session.ExpiresAt,
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: error verifying Google OAuth token.");
            return StatusCode(500, new { verified = false, message = "Could not reach Google to verify your sign-in. Please try again." });
        }
    }

    [HttpPost("Sessions/RevokeAll")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RevokeAllSessions()
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can sign out all devices." });
        }

        config.SessionVersion = Math.Max(1, config.SessionVersion) + 1;
        Plugin.Instance?.SaveConfiguration();
        _logger.LogInformation("StreamFlix: all Google sessions revoked by an administrator (session version {Version}).", config.SessionVersion);
        return Ok(new { revoked = true, sessionVersion = config.SessionVersion });
    }

    [HttpPost("Profiles/Activate")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ActivateProfile([FromBody] ActivateProfileRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired();
        }

        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);

        var profile = FindProfile(config, request.ProfileId);
        if (profile == null)
        {
            return NotFound(new { code = "profile_not_found", message = "That profile no longer exists." });
        }

        var lockResult = CheckGoogleLock(profile, caller);
        if (lockResult != null)
        {
            return lockResult;
        }

        var suppliedPin = (!string.IsNullOrWhiteSpace(request.Pin) ? request.Pin : request.PinCode) ?? string.Empty;
        var pinResult = CheckPin(profile, suppliedPin);
        if (pinResult != null)
        {
            return pinResult;
        }

        var primaryAdmin = StreamFlixStartupTask.GetPrimaryAdminUserCompat(_userManager);
        var isOwner = StreamFlixStartupTask.IsOwnerProfile(profile);

        // 1. Honor the profile's existing linked JellyfinUserId, unless the Owner was accidentally linked to a non-admin duplicate
        var user = (!string.IsNullOrWhiteSpace(profile.JellyfinUserId) && Guid.TryParse(profile.JellyfinUserId, out var parsedUid))
            ? _userManager.GetUserById(parsedUid)
            : null;

        if (isOwner && primaryAdmin != null && StreamFlixStartupTask.IsUserAdminCompat(primaryAdmin))
        {
            if (user == null || (!StreamFlixStartupTask.IsUserAdminCompat(user) && user.Id != primaryAdmin.Id))
            {
                user = primaryAdmin;
            }
        }

        // 2. Otherwise match by username, or create a dedicated user. Never silently fall back to the admin account.
        if (user == null)
        {
            var targetName = !string.IsNullOrWhiteSpace(profile.JellyfinUsername)
                ? profile.JellyfinUsername.Trim()
                : profile.Name.Trim();

            // Safe match only: never hand out an administrator's (or another profile's) account by name.
            user = StreamFlixStartupTask.FindSafeUserByName(_userManager, config, profile, targetName, profile.Name);

            if (user == null && config.AutoProvisionJellyfinUsers)
            {
                try
                {
                    user = await _userManager.CreateUserAsync(StreamFlixStartupTask.GetAvailableUsername(_userManager, targetName)).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "StreamFlix: could not create Jellyfin user '{TargetName}'.", targetName);
                }
            }
        }

        if (user == null)
        {
            return StatusCode(409, new { code = "profile_unlinked", message = $"\"{profile.Name}\" isn't linked to a Jellyfin user yet. Edit the profile and choose an account." });
        }

        var isAdminUser = (primaryAdmin != null && user.Id == primaryAdmin.Id) || StreamFlixStartupTask.IsUserAdminCompat(user);
        var needsUserUpdate = false;
        if (isAdminUser)
        {
            if (StreamFlixStartupTask.TryGetMaxParentalAge(user) != null && StreamFlixStartupTask.TrySetMaxParentalAge(user, null))
            {
                needsUserUpdate = true;
            }
        }
        else
        {
            var desiredAge = StreamFlixStartupTask.ParentalAgeFromMaturity(profile.MaturityRating, profile.IsKids);
            if (StreamFlixStartupTask.TryGetMaxParentalAge(user) != desiredAge && StreamFlixStartupTask.TrySetMaxParentalAge(user, desiredAge))
            {
                needsUserUpdate = true;
            }

            if (StreamFlixStartupTask.EnsureUserLibraryAccessAndPermissions(user, primaryAdmin))
            {
                needsUserUpdate = true;
            }
        }

        if (needsUserUpdate)
        {
            await _userManager.UpdateUserAsync(user).ConfigureAwait(false);
        }

        if (!string.Equals(profile.JellyfinUserId, user.Id.ToString("N"), StringComparison.OrdinalIgnoreCase)
            || !string.Equals(profile.JellyfinUsername, user.Username, StringComparison.Ordinal))
        {
            profile.JellyfinUserId = user.Id.ToString("N");
            profile.JellyfinUsername = user.Username;
            Plugin.Instance?.SaveConfiguration();
        }

        var appName = !string.IsNullOrWhiteSpace(request.AppName) ? request.AppName.Trim() : "Jellyfin Web";
        var appVersion = !string.IsNullOrWhiteSpace(request.AppVersion) ? request.AppVersion.Trim() : "10.11.0";
        var deviceId = !string.IsNullOrWhiteSpace(request.DeviceId) ? request.DeviceId.Trim() : $"streamflix-profile-{profile.Id}";
        var deviceName = !string.IsNullOrWhiteSpace(request.DeviceName) ? request.DeviceName.Trim() : $"StreamFlix ({profile.Name})";

        var authRequest = new AuthenticationRequest
        {
            App = appName,
            AppVersion = appVersion,
            DeviceId = deviceId,
            DeviceName = deviceName,
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
            _logger.LogWarning(ex, "StreamFlix: direct authentication failed for profile '{ProfileName}' (Jellyfin user '{Username}').", profile.Name, user.Username);
            return StatusCode(403, new { code = "auth_failed", message = $"Could not sign in to Jellyfin as \"{user.Username}\". Ensure the account is enabled in Server Dashboard → Users." });
        }

        return Ok(new
        {
            userId = user.Id.ToString("N"),
            userName = user.Username,
            jellyfinUsername = user.Username,
            accessToken = authResult.AccessToken,
            serverId = _appHost.SystemId,
            serverName = _appHost.FriendlyName,
            user = authResult.User,
            sessionInfo = authResult.SessionInfo,
            profile = MapProfilePublic(profile, caller),
        });
    }

    [HttpPost("Profiles/VerifyPin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> VerifyPin([FromBody] VerifyPinRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired();
        }

        var profile = FindProfile(config, request.ProfileId);
        if (profile == null)
        {
            return NotFound(new { code = "profile_not_found", message = "That profile no longer exists." });
        }

        return CheckPin(profile, request.Pin ?? string.Empty) ?? Ok(new { ok = true });
    }

    [HttpPost("Profiles/Save")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SaveProfile([FromBody] SaveProfileRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired();
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { message = "Profile name is required." });
        }

        var cleanName = request.Name.Trim();
        if (cleanName.Length > 40)
        {
            return BadRequest(new { message = "Profile names can be at most 40 characters." });
        }

        var rawPin = !string.IsNullOrWhiteSpace(request.Pin) ? request.Pin : request.PinCode;
        var cleanPin = !string.IsNullOrWhiteSpace(rawPin) ? rawPin.Trim() : null;
        if (cleanPin != null && cleanPin != "__CLEAR__" && !PinRegex.IsMatch(cleanPin))
        {
            return BadRequest(new { message = "PINs must be 4 to 8 digits." });
        }

        var existing = !string.IsNullOrWhiteSpace(request.Id) ? FindProfile(config, request.Id) : null;
        var isNewProfile = existing == null;

        // Administrator/owner profiles can only be edited while signed in to an administrator profile,
        // and protected profiles can only be edited by someone who can open them.
        if (existing != null && !caller.IsAdmin)
        {
            if (IsProfileLinkedToAdmin(existing))
            {
                return StatusCode(403, new { code = "admin_required", message = "Switch to an administrator profile first to edit an administrator profile." });
            }

            var lockResult = CheckGoogleLock(existing, caller);
            if (lockResult != null)
            {
                return lockResult;
            }

            var pinResult = CheckPin(existing, request.CurrentPin ?? string.Empty);
            if (pinResult != null)
            {
                return pinResult;
            }
        }

        // Validate a Google lock change before mutating anything.
        string? newLock = existing?.GoogleAccountEmail;
        if (request.GoogleAccountEmail != null)
        {
            var requested = request.GoogleAccountEmail.Trim().ToLowerInvariant();
            newLock = string.IsNullOrEmpty(requested) ? null : requested;
            if (newLock != null && !EmailRegex.IsMatch(newLock))
            {
                return BadRequest(new { message = "Enter a valid Google account email for the profile lock." });
            }

            var changed = !string.Equals(newLock, existing?.GoogleAccountEmail, StringComparison.OrdinalIgnoreCase);
            if (changed && newLock != null && !caller.IsAdmin
                && !string.Equals(caller.Session?.Email, newLock, StringComparison.OrdinalIgnoreCase))
            {
                return StatusCode(403, new { code = "google_lock_forbidden", message = "You can only lock a profile to the Google account you're signed in with." });
            }
        }

        // Resolve which Jellyfin user this profile should be linked to.
        // Security: only administrators may choose or change the linked Jellyfin account. Everyone else keeps the
        // current link on existing profiles, and new profiles always get a brand-new dedicated Jellyfin user, so a
        // household member can never point a profile at an administrator's (or anyone else's) account.
        var currentLinkedId = existing?.JellyfinUserId;
        var requestedLink = request.JellyfinUserId?.Trim() ?? string.Empty;
        var wantsCreate = string.Equals(requestedLink, "__CREATE__", StringComparison.OrdinalIgnoreCase)
            || (isNewProfile && string.IsNullOrEmpty(requestedLink));
        var explicitUid = Guid.Empty;
        if (!wantsCreate && !string.IsNullOrEmpty(requestedLink) && !Guid.TryParse(requestedLink, out explicitUid))
        {
            return BadRequest(new { code = "invalid_link", message = "That Jellyfin account isn't valid." });
        }

        JUser? targetUser = null;
        var createName = cleanName;

        if (caller.IsAdmin)
        {
            createName = !string.IsNullOrWhiteSpace(request.JellyfinUsername) ? request.JellyfinUsername.Trim() : cleanName;
            if (explicitUid != Guid.Empty)
            {
                targetUser = _userManager.GetUserById(explicitUid);
                if (targetUser == null)
                {
                    return BadRequest(new { code = "invalid_link", message = "That Jellyfin account no longer exists." });
                }
            }
            else if (wantsCreate)
            {
                createName = StreamFlixStartupTask.GetAvailableUsername(_userManager, createName);
            }
        }
        else if (isNewProfile)
        {
            if (!wantsCreate)
            {
                return LinkChangeForbidden();
            }

            // Always a fresh, dedicated user — never an existing account that happens to share the name.
            createName = StreamFlixStartupTask.GetAvailableUsername(_userManager, cleanName);
        }
        else
        {
            var hasCurrentUid = Guid.TryParse(currentLinkedId, out var currentUid);
            var currentValid = hasCurrentUid && _userManager.GetUserById(currentUid) != null;
            if (explicitUid != Guid.Empty && (!hasCurrentUid || explicitUid != currentUid))
            {
                return LinkChangeForbidden();
            }

            if (string.Equals(requestedLink, "__CREATE__", StringComparison.OrdinalIgnoreCase) && currentValid)
            {
                return LinkChangeForbidden();
            }

            // Keep the current link. Only a profile whose account was removed gets a fresh dedicated user.
            wantsCreate = wantsCreate && !currentValid;
            if (wantsCreate)
            {
                createName = StreamFlixStartupTask.GetAvailableUsername(_userManager, cleanName);
            }
        }

        if (targetUser != null
            && !caller.IsAdmin
            && StreamFlixStartupTask.IsUserAdminCompat(targetUser)
            && !string.Equals(targetUser.Id.ToString("N"), currentLinkedId, StringComparison.OrdinalIgnoreCase))
        {
            return StatusCode(403, new { code = "admin_link_forbidden", message = "Only an administrator can link a profile to an administrator account." });
        }

        if (targetUser == null && wantsCreate)
        {
            try
            {
                targetUser = await _userManager.CreateUserAsync(createName).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "StreamFlix: could not create Jellyfin user '{DesiredUsername}'.", createName);
                return StatusCode(409, new { message = $"Couldn't create a Jellyfin user named \"{createName}\". Try a different name." });
            }
        }

        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (existing == null)
            {
                existing = new StreamFlixProfileConfig
                {
                    Id = $"streamflix_{Guid.NewGuid():N}",
                };
                config.Profiles.Add(existing);
            }

            existing.Name = cleanName;
            existing.AvatarColorIndex = request.AvatarColorIndex;
            existing.AvatarIconIndex = request.AvatarIconIndex;
            existing.AvatarEmoji = !string.IsNullOrWhiteSpace(request.AvatarEmoji)
                ? request.AvatarEmoji!
                : (request.IsKids ? "🦊" : "🎬");
            existing.AvatarColorHex = !string.IsNullOrWhiteSpace(request.AvatarColorHex)
                ? request.AvatarColorHex!
                : "#E50914";
            existing.IsKids = request.IsKids;
            existing.MaturityRating = !string.IsNullOrWhiteSpace(request.MaturityRating)
                ? request.MaturityRating!
                : (request.IsKids ? "Older Kids (TV-Y7 / PG)" : "TV-MA / R (All Maturity Levels)");
            existing.GoogleAccountEmail = newLock;

            if (cleanPin != null)
            {
                existing.PinCode = cleanPin == "__CLEAR__" ? null : cleanPin;
            }

            existing.AutoplayNextEpisode = request.AutoplayNextEpisode;
            existing.AutoplayPreviews = request.AutoplayPreviews;

            if (targetUser != null)
            {
                existing.JellyfinUserId = targetUser.Id.ToString("N");
                existing.JellyfinUsername = targetUser.Username;
            }

            config.DeletedProfileIds?.RemoveAll(d =>
                string.Equals(d, existing.Id, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(d, existing.Name, StringComparison.OrdinalIgnoreCase));

            await StreamFlixStartupTask.SyncAllProfilesWithJellyfinUsersAsync(_userManager, config, _logger, allowCreateMissingUsers: false).ConfigureAwait(false);
            _lastSyncUtc = DateTime.UtcNow;
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        return Ok(BuildPublicState(config, caller));
    }

    [HttpPost("Profiles/Reorder")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ReorderProfiles([FromBody] ReorderProfilesRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired();
        }

        if (request.ProfileIds != null && request.ProfileIds.Count > 0 && config.Profiles.Count > 1)
        {
            await SyncLock.WaitAsync().ConfigureAwait(false);
            try
            {
                var currentProfiles = config.Profiles.ToList();
                var byId = currentProfiles
                    .GroupBy(p => p.Id, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                var reordered = new List<StreamFlixProfileConfig>();
                var added = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (var id in request.ProfileIds)
                {
                    if (!string.IsNullOrWhiteSpace(id) && byId.TryGetValue(id.Trim(), out var prof) && added.Add(prof.Id))
                    {
                        reordered.Add(prof);
                    }
                }

                foreach (var prof in currentProfiles)
                {
                    if (added.Add(prof.Id))
                    {
                        reordered.Add(prof);
                    }
                }

                config.Profiles = reordered;
                Plugin.Instance?.SaveConfiguration();
            }
            finally
            {
                SyncLock.Release();
            }
        }

        return Ok(BuildPublicState(config, caller));
    }

    [HttpPost("Profiles/Delete")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> DeleteProfile([FromBody] DeleteProfileRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired();
        }

        if (config.Profiles.Count <= 1)
        {
            return BadRequest(new { message = "You can't delete the last remaining profile." });
        }

        var target = FindProfile(config, request.ProfileId);
        if (target == null)
        {
            return NotFound(new { code = "profile_not_found", message = "Profile not found." });
        }

        if (!caller.IsAdmin)
        {
            var lockResult = CheckGoogleLock(target, caller);
            if (lockResult != null)
            {
                return lockResult;
            }

            var pinResult = CheckPin(target, request.CurrentPin ?? string.Empty);
            if (pinResult != null)
            {
                return pinResult;
            }

            if (IsProfileLinkedToAdmin(target))
            {
                return StatusCode(403, new { code = "admin_required", message = "Only an administrator can delete an administrator profile." });
            }
        }

        string? deletedUserId = null;
        var shouldDeleteUser = false;

        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (config.Profiles.Count <= 1)
            {
                return BadRequest(new { message = "You can't delete the last remaining profile." });
            }

            config.DeletedProfileIds ??= new List<string>();
            if (!string.IsNullOrWhiteSpace(target.Id))
            {
                config.DeletedProfileIds.Add(target.Id);
            }

            config.Profiles.Remove(target);
            deletedUserId = target.JellyfinUserId;
            shouldDeleteUser = request.DeleteJellyfinUser
                && caller.IsAdmin
                && !string.IsNullOrWhiteSpace(deletedUserId)
                && !config.Profiles.Any(p => string.Equals(p.JellyfinUserId, deletedUserId, StringComparison.OrdinalIgnoreCase));

            await StreamFlixStartupTask.SyncAllProfilesWithJellyfinUsersAsync(_userManager, config, _logger, allowCreateMissingUsers: false).ConfigureAwait(false);
            _lastSyncUtc = DateTime.UtcNow;
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        // Only delete the underlying Jellyfin user if an admin explicitly asked and it isn't shared by another profile
        if (shouldDeleteUser && Guid.TryParse(deletedUserId, out var jfUid))
        {
            var primaryAdmin = StreamFlixStartupTask.GetPrimaryAdminUserCompat(_userManager);
            if (primaryAdmin == null || primaryAdmin.Id != jfUid)
            {
                await StreamFlixStartupTask.DeleteJellyfinUserCompatAsync(_userManager, jfUid, _logger).ConfigureAwait(false);
            }
        }

        return Ok(BuildPublicState(config, caller));
    }

    private bool IsProfileLinkedToAdmin(StreamFlixProfileConfig? profile)
    {
        if (profile == null)
        {
            return false;
        }

        if (StreamFlixStartupTask.IsOwnerProfile(profile))
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(profile.JellyfinUserId) && Guid.TryParse(profile.JellyfinUserId, out var uid))
        {
            var u = _userManager.GetUserById(uid);
            if (u != null && StreamFlixStartupTask.IsUserAdminCompat(u))
            {
                return true;
            }
        }

        return false;
    }

    private ObjectResult LinkChangeForbidden()
    {
        return StatusCode(403, new { code = "link_change_forbidden", message = "Only an administrator can change which Jellyfin account a profile uses." });
    }

    private static StreamFlixProfileConfig? FindProfile(PluginConfiguration config, string? idOrName)
    {
        if (string.IsNullOrWhiteSpace(idOrName))
        {
            return null;
        }

        return config.Profiles.FirstOrDefault(p => string.Equals(p.Id, idOrName, StringComparison.OrdinalIgnoreCase))
            ?? config.Profiles.FirstOrDefault(p => string.Equals(p.Name, idOrName, StringComparison.OrdinalIgnoreCase));
    }

    private static bool HasHouseholdAccess(PluginConfiguration config, CallerContext caller)
    {
        return !config.RequireGoogleAuth || caller.Session != null || caller.IsAdmin;
    }

    private ObjectResult GoogleRequired()
    {
        return StatusCode(401, new { code = "google_required", message = "Please sign in with Google to continue." });
    }

    private ObjectResult? CheckGoogleLock(StreamFlixProfileConfig profile, CallerContext caller)
    {
        if (string.IsNullOrWhiteSpace(profile.GoogleAccountEmail))
        {
            return null;
        }

        if (caller.Session != null && string.Equals(caller.Session.Email, profile.GoogleAccountEmail.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return StatusCode(403, new
        {
            code = "google_lock",
            requiredEmailHint = StreamFlixSessionService.MaskEmail(profile.GoogleAccountEmail),
            message = $"\"{profile.Name}\" is locked to the Google account {StreamFlixSessionService.MaskEmail(profile.GoogleAccountEmail)}.",
        });
    }

    private ObjectResult? CheckPin(StreamFlixProfileConfig profile, string suppliedPin)
    {
        if (string.IsNullOrWhiteSpace(profile.PinCode))
        {
            return null;
        }

        var lockKey = (HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown") + "|" + profile.Id;
        if (StreamFlixSessionService.IsPinLockedOut(lockKey, out var retryAfter))
        {
            var secs = (int)Math.Ceiling(retryAfter.TotalSeconds);
            Response.Headers["Retry-After"] = secs.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return StatusCode(429, new { code = "pin_locked", retryAfterSeconds = secs, message = $"Too many wrong PINs. Try again in {Math.Max(1, (secs + 59) / 60)} min." });
        }

        if (string.IsNullOrEmpty(suppliedPin))
        {
            return StatusCode(403, new { code = "pin_required", message = "Enter the profile PIN." });
        }

        if (!StreamFlixSessionService.ConstantTimePinEquals(profile.PinCode, suppliedPin))
        {
            StreamFlixSessionService.RegisterPinFailure(lockKey);
            return StatusCode(403, new { code = "pin_invalid", message = "Incorrect PIN. Please try again." });
        }

        StreamFlixSessionService.ResetPinFailures(lockKey);
        return null;
    }

    private async Task<CallerContext> GetCallerAsync(PluginConfiguration config)
    {
        var token = Request.Headers[StreamFlixSessionService.HeaderName].FirstOrDefault();
        var session = StreamFlixSessionService.Validate(config, token);

        var isAuthenticated = false;
        var isAdmin = false;
        try
        {
            var info = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (info != null && info.IsAuthenticated)
            {
                isAuthenticated = true;
                isAdmin = info.IsApiKey || StreamFlixStartupTask.IsUserAdminCompat(info.User);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: could not read Jellyfin authorization info.");
        }

        return new CallerContext(session, isAuthenticated, isAdmin);
    }

    private async Task SyncProfilesAsync(PluginConfiguration config, bool force)
    {
        if (!force && DateTime.UtcNow - _lastSyncUtc < TimeSpan.FromSeconds(60))
        {
            return;
        }

        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!force && DateTime.UtcNow - _lastSyncUtc < TimeSpan.FromSeconds(60))
            {
                return;
            }

            await StreamFlixStartupTask.SyncAllProfilesWithJellyfinUsersAsync(_userManager, config, _logger, allowCreateMissingUsers: false).ConfigureAwait(false);
            _lastSyncUtc = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: non-fatal error syncing profiles.");
        }
        finally
        {
            SyncLock.Release();
        }
    }

    private object BuildPublicState(PluginConfiguration config, CallerContext caller)
    {
        var hasAccess = HasHouseholdAccess(config, caller);

        // The full Jellyfin user list is only needed (and only shown) to administrators choosing a profile's account.
        var serverUsers = hasAccess && caller.IsAdmin
            ? StreamFlixStartupTask.GetAllUsersCompat(_userManager)
                .OrderByDescending(u => StreamFlixStartupTask.IsUserAdminCompat(u))
                .ThenBy(u => StreamFlixStartupTask.GetInternalIdCompat(u))
                .Select(u => (object)new
                {
                    id = u.Id.ToString("N"),
                    name = u.Username,
                    isAdmin = StreamFlixStartupTask.IsUserAdminCompat(u),
                })
                .ToList()
            : new List<object>();

        var profilesSnapshot = (config.Profiles ?? new List<StreamFlixProfileConfig>()).ToList();
        var approvedSnapshot = (config.ApprovedGoogleAccounts ?? new List<string>()).ToList();

        return new
        {
            version = Plugin.VersionString,
            serverId = _appHost.SystemId,
            serverName = _appHost.FriendlyName,
            customBrandName = (config.CustomBrandName ?? string.Empty).Trim(),
            enableStreamFlixUi = config.EnableStreamFlixUi,
            requireGoogleAuth = config.RequireGoogleAuth,
            googleClientId = config.GoogleClientId,
            googleConfigured = !string.IsNullOrWhiteSpace(config.GoogleClientId),
            hasGoogleClientSecret = !string.IsNullOrWhiteSpace(config.GoogleClientSecret),
            hasAccess,
            isAdmin = caller.IsAdmin,
            session = caller.Session == null ? null : new { email = caller.Session.Email, expiresAt = caller.Session.ExpiresAt },
            approvedGoogleAccounts = hasAccess && caller.IsAdmin ? approvedSnapshot : new List<string>(),
            serverUsers,
            profiles = hasAccess ? profilesSnapshot.Select(p => MapProfilePublic(p, caller)).ToList() : new List<object>(),
            showcaseItems = hasAccess ? GetShowcaseItemsCached(_libraryManager) : new List<object>(),
        };
    }

    private static List<object> GetShowcaseItemsCached(ILibraryManager libraryManager)
    {
        if (DateTime.UtcNow - _showcaseCachedAtUtc < TimeSpan.FromMinutes(10) && _showcaseCache.Count > 0)
        {
            return _showcaseCache;
        }

        var fresh = GetShowcaseItemsCompat(libraryManager);
        _showcaseCache = fresh;
        _showcaseCachedAtUtc = DateTime.UtcNow;
        return fresh;
    }

    private static List<object> GetShowcaseItemsCompat(ILibraryManager libraryManager)
    {
        var result = new List<object>();
        try
        {
            var queryType = typeof(ILibraryManager).Assembly.GetType("MediaBrowser.Controller.Entities.InternalItemsQuery");
            if (queryType == null)
            {
                return result;
            }

            var query = Activator.CreateInstance(queryType);
            if (query == null)
            {
                return result;
            }

            queryType.GetProperty("Recursive")?.SetValue(query, true);

            var includeProp = queryType.GetProperty("IncludeItemTypes");
            if (includeProp != null && includeProp.PropertyType.IsArray)
            {
                var elemType = includeProp.PropertyType.GetElementType();
                if (elemType != null
                    && elemType.IsEnum
                    && Enum.TryParse(elemType, "Movie", ignoreCase: true, out var movieEnum)
                    && Enum.TryParse(elemType, "Series", ignoreCase: true, out var seriesEnum)
                    && movieEnum != null
                    && seriesEnum != null)
                {
                    var arr = Array.CreateInstance(elemType, 2);
                    arr.SetValue(movieEnum, 0);
                    arr.SetValue(seriesEnum, 1);
                    includeProp.SetValue(query, arr);
                }
            }

            queryType.GetProperty("Limit")?.SetValue(query, 48);

            var getItemList = typeof(ILibraryManager).GetMethod("GetItemList", new[] { queryType });
            if (getItemList?.Invoke(libraryManager, new[] { query }) is System.Collections.IEnumerable items)
            {
                foreach (var item in items)
                {
                    if (item == null)
                    {
                        continue;
                    }

                    var idProp = item.GetType().GetProperty("Id");
                    var nameProp = item.GetType().GetProperty("Name");
                    if (idProp?.GetValue(item) is Guid id && id != Guid.Empty)
                    {
                        var name = nameProp?.GetValue(item)?.ToString() ?? string.Empty;
                        var typeName = item.GetType().Name;
                        if (string.Equals(typeName, "Movie", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(typeName, "Series", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(typeName, "Video", StringComparison.OrdinalIgnoreCase))
                        {
                            result.Add(new
                            {
                                id = id.ToString("N"),
                                name,
                                type = typeName,
                            });
                            if (result.Count >= 36)
                            {
                                break;
                            }
                        }
                    }
                }
            }
        }
        catch
        {
        }

        return result;
    }

    private object MapProfilePublic(StreamFlixProfileConfig p, CallerContext caller)
    {
        var isAdmin = StreamFlixStartupTask.IsOwnerProfile(p);
        if (!string.IsNullOrWhiteSpace(p.JellyfinUserId) && Guid.TryParse(p.JellyfinUserId, out var uid))
        {
            var u = _userManager.GetUserById(uid);
            if (u != null)
            {
                isAdmin = StreamFlixStartupTask.IsUserAdminCompat(u);
            }
        }

        var lockEmail = string.IsNullOrWhiteSpace(p.GoogleAccountEmail) ? null : p.GoogleAccountEmail.Trim();
        var callerOwnsLock = lockEmail != null && caller.Session != null
            && string.Equals(caller.Session.Email, lockEmail, StringComparison.OrdinalIgnoreCase);

        return new
        {
            id = p.Id,
            name = p.Name,
            avatarColorIndex = p.AvatarColorIndex,
            avatarIconIndex = p.AvatarIconIndex,
            avatarEmoji = p.AvatarEmoji,
            avatarColorHex = string.IsNullOrWhiteSpace(p.AvatarColorHex) ? "#E50914" : p.AvatarColorHex,
            isKids = p.IsKids,
            isAdmin,
            isOwner = StreamFlixStartupTask.IsOwnerProfile(p),
            maturityRating = p.MaturityRating,
            hasPin = !string.IsNullOrWhiteSpace(p.PinCode),
            pinLength = string.IsNullOrWhiteSpace(p.PinCode) ? 0 : p.PinCode.Trim().Length,
            googleLocked = lockEmail != null,
            googleAccountEmail = lockEmail != null && (caller.IsAdmin || callerOwnsLock) ? lockEmail : null,
            googleAccountHint = lockEmail != null ? StreamFlixSessionService.MaskEmail(lockEmail) : null,
            googleLockSatisfied = lockEmail == null || callerOwnsLock,
            autoplayNextEpisode = p.AutoplayNextEpisode,
            autoplayPreviews = p.AutoplayPreviews,
            jellyfinUserId = p.JellyfinUserId,
            jellyfinUsername = p.JellyfinUsername,
        };
    }

    private ActionResult ServeAsset(EmbeddedAsset asset, string contentType)
    {
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["ETag"] = asset.ETag;

        var ifNoneMatch = Request.Headers["If-None-Match"].ToString();
        if (!string.IsNullOrEmpty(ifNoneMatch) && ifNoneMatch.Contains(asset.ETag, StringComparison.Ordinal))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }

        return Content(asset.Content, contentType);
    }

    private sealed record CallerContext(StreamFlixSessionService.SessionInfo? Session, bool IsJellyfinAuthenticated, bool IsAdmin);

    private sealed class EmbeddedAsset
    {
        private EmbeddedAsset(string content)
        {
            Content = content;
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(content));
            ETag = "\"" + Convert.ToHexString(hash, 0, 12).ToLowerInvariant() + "\"";
        }

        public string Content { get; }

        public string ETag { get; }

        public static EmbeddedAsset Load(string resourceName)
        {
            var assembly = Assembly.GetExecutingAssembly();
            using var stream = assembly.GetManifestResourceStream(resourceName);
            if (stream == null)
            {
                return new EmbeddedAsset(string.Empty);
            }

            using var reader = new StreamReader(stream, Encoding.UTF8);
            return new EmbeddedAsset(reader.ReadToEnd());
        }
    }
}
