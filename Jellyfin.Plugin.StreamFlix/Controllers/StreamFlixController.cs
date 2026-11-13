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

public class PasswordLoginRequest
{
    public string Username { get; set; } = string.Empty;

    public string? Password { get; set; }

    public string? DeviceId { get; set; }

    public string? DeviceName { get; set; }

    public string? AppName { get; set; }

    public string? AppVersion { get; set; }
}

public class TestOAuthConfigRequest
{
    public string? GoogleClientId { get; set; }

    public string? OriginUri { get; set; }

    public List<string>? RedirectUris { get; set; }

    public List<string>? ApprovedEmails { get; set; }
}

public class TestOidcConfigRequest
{
    public string? OidcIssuerUrl { get; set; }

    public string? OidcClientId { get; set; }

    public string? CallbackUri { get; set; }

    public bool OidcRequireAllowlist { get; set; }

    public List<string>? ApprovedOidcUsers { get; set; }
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

public class SaveAdminConfigRequest
{
    public bool EnableStreamFlixUi { get; set; } = true;

    public string? CustomBrandName { get; set; }

    public bool RequireGoogleAuth { get; set; } = true;

    public bool EnableGoogleSignIn { get; set; } = true;

    public bool AllowStandardJellyfinLogin { get; set; }

    public bool AllowAdminFallbackLogin { get; set; }

    public bool AdminFallbackLanOnly { get; set; }

    public bool BypassLoginGateOnLan { get; set; }

    public bool AutoProvisionJellyfinUsers { get; set; } = true;

    public string? GoogleClientId { get; set; }

    public string? GoogleClientSecret { get; set; }

    public bool ClearGoogleClientSecret { get; set; }

    public List<string>? ApprovedGoogleAccounts { get; set; }

    public int SessionLifetimeDays { get; set; } = 30;

    public string? Top10SelectionMode { get; set; }

    public int HeroRotationSeconds { get; set; } = 9;

    public int HeroSlideCount { get; set; } = 8;

    public string? HeroSelectionMode { get; set; }

    public string? HeroContentType { get; set; }

    public List<string>? HeroLibraryIds { get; set; }

    public bool EnableCustomOidc { get; set; }

    public string? OidcProviderName { get; set; }

    public string? OidcIssuerUrl { get; set; }

    public string? OidcClientId { get; set; }

    public string? OidcClientSecret { get; set; }

    public bool ClearOidcClientSecret { get; set; }

    public bool OidcRequireAllowlist { get; set; }

    public List<string>? ApprovedOidcUsers { get; set; }

    public bool EnableSeerr { get; set; }

    public string? SeerrUrl { get; set; }

    public string? SeerrApiKey { get; set; }

    public bool ClearSeerrApiKey { get; set; }

    public bool SeerrAllowKids { get; set; }

    public bool SeerrAllowGuests { get; set; }
}

public class CreateGuestPassRequest
{
    public string? Label { get; set; }

    public string ProfileId { get; set; } = string.Empty;

    public int DurationHours { get; set; } = 24;

    public int MaxRedemptions { get; set; } = 2;
}

public class RevokeGuestPassRequest
{
    public string Id { get; set; } = string.Empty;
}

public class RedeemGuestPassRequest
{
    public string Code { get; set; } = string.Empty;

    public string? DeviceId { get; set; }

    public string? DeviceName { get; set; }

    public string? AppName { get; set; }

    public string? AppVersion { get; set; }
}

public class MovieNightCandidatesRequest
{
    public List<string>? ProfileIds { get; set; }

    public string? MediaType { get; set; }

    public string? Genre { get; set; }

    public int MaxRuntimeMinutes { get; set; }

    public bool OnlyUnwatched { get; set; } = true;

    public int Count { get; set; } = 8;
}

public class TestSeerrConfigRequest
{
    public string? SeerrUrl { get; set; }

    public string? SeerrApiKey { get; set; }
}

public class SubmitSeerrMediaRequest
{
    public int TmdbId { get; set; }

    public string MediaType { get; set; } = string.Empty;

    public List<int>? Seasons { get; set; }

    public string? ProfileId { get; set; }
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
    private const int MaxProfilesCount = 24;
    private const int MaxStoredGuestPasses = 100;
    private const int MaxActiveGuestPasses = 50;

    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(8) };

    private static readonly Lazy<EmbeddedAsset> ScriptAsset = new(() => EmbeddedAsset.Load("Jellyfin.Plugin.StreamFlix.Web.streamflix.js"));

    private static readonly Lazy<EmbeddedAsset> StyleAsset = new(() => EmbeddedAsset.Load("Jellyfin.Plugin.StreamFlix.Web.streamflix.css"));

    private static readonly SemaphoreSlim SyncLock = new(1, 1);

    private static readonly ConcurrentDictionary<string, ConcurrentBag<string>> ActiveGuestTokens = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, (int Count, DateTimeOffset WindowReset)> SeerrRequestRateMap = new(StringComparer.OrdinalIgnoreCase);

    private static readonly Regex EmailRegex = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    private static readonly Regex PinRegex = new(@"^\d{4,8}$", RegexOptions.Compiled);

    private static readonly Regex HexColorRegex = new(@"^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$", RegexOptions.Compiled);

    private static readonly Regex GoogleClientIdRegex = new(@"^[0-9]{6,}-[a-zA-Z0-9_-]{8,}\.apps\.googleusercontent\.com$", RegexOptions.Compiled);

    private static readonly object PopularCacheLock = new();

    private static readonly object ShowcaseCacheLock = new();

    private static DateTime _lastSyncUtc = DateTime.MinValue;

    private static DateTime _showcaseCachedAtUtc = DateTime.MinValue;

    private static List<object> _showcaseCache = new();

    private static DateTime _popularCachedAtUtc = DateTime.MinValue;

    private static Dictionary<string, double> _popularScoresCache = new(StringComparer.OrdinalIgnoreCase);

    private readonly IUserManager _userManager;
    private readonly IUserDataManager _userDataManager;
    private readonly ISessionManager _sessionManager;
    private readonly IServerApplicationHost _appHost;
    private readonly ILibraryManager _libraryManager;
    private readonly IAuthorizationContext _authContext;
    private readonly ILogger<StreamFlixController> _logger;

    public StreamFlixController(
        IUserManager userManager,
        IUserDataManager userDataManager,
        ISessionManager sessionManager,
        IServerApplicationHost appHost,
        ILibraryManager libraryManager,
        IAuthorizationContext authContext,
        ILogger<StreamFlixController> logger)
    {
        _userManager = userManager;
        _userDataManager = userDataManager;
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
        SetNoStoreSecurityHeaders();
        Plugin.Instance?.EnsureInjectedThrottled();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);
        return Ok(BuildPublicState(config, caller));
    }

    [HttpGet("AdminConfig")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetAdminConfig()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can read StreamFlix admin configuration." });
        }

        return Ok(BuildAdminConfigResponse(config));
    }

    [HttpPost("AdminConfig")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SaveAdminConfig([FromBody] SaveAdminConfigRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null)
        {
            return BadRequest(new { message = "Missing configuration payload." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can update StreamFlix settings." });
        }

        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            config.EnableStreamFlixUi = request.EnableStreamFlixUi;
            var brand = (request.CustomBrandName ?? string.Empty).Trim();
            config.CustomBrandName = brand.Length > 32 ? brand.Substring(0, 32).Trim() : brand;

            config.RequireGoogleAuth = request.RequireGoogleAuth;
            config.EnableGoogleSignIn = request.EnableGoogleSignIn;
            config.AllowStandardJellyfinLogin = request.AllowStandardJellyfinLogin;
            config.AllowAdminFallbackLogin = request.AllowAdminFallbackLogin;
            config.AdminFallbackLanOnly = request.AdminFallbackLanOnly;
            config.BypassLoginGateOnLan = request.BypassLoginGateOnLan;
            config.AutoProvisionJellyfinUsers = request.AutoProvisionJellyfinUsers;

            config.GoogleClientId = (request.GoogleClientId ?? string.Empty).Trim();
            if (request.ClearGoogleClientSecret)
            {
                config.GoogleClientSecret = string.Empty;
            }
            else if (!string.IsNullOrWhiteSpace(request.GoogleClientSecret)
                && !string.Equals(request.GoogleClientSecret.Trim(), "__KEEP__", StringComparison.Ordinal))
            {
                config.GoogleClientSecret = request.GoogleClientSecret.Trim();
            }

            if (request.ApprovedGoogleAccounts != null)
            {
                config.ApprovedGoogleAccounts = request.ApprovedGoogleAccounts
                    .Select(e => (e ?? string.Empty).Trim().ToLowerInvariant())
                    .Where(e => EmailRegex.IsMatch(e))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (config.ApprovedGoogleAccounts.Count > 0)
                {
                    config.FirstGoogleAccountClaimed = true;
                }
            }

            config.SessionLifetimeDays = Math.Clamp(request.SessionLifetimeDays <= 0 ? 30 : request.SessionLifetimeDays, 1, 365);
            config.Top10SelectionMode = NormalizeTop10Mode(request.Top10SelectionMode);
            config.HeroRotationSeconds = Math.Clamp(request.HeroRotationSeconds, 0, 120);
            config.HeroSlideCount = Math.Clamp(request.HeroSlideCount <= 0 ? 8 : request.HeroSlideCount, 1, 15);
            config.HeroSelectionMode = NormalizeHeroSelectionMode(request.HeroSelectionMode);
            config.HeroContentType = NormalizeHeroContentType(request.HeroContentType);

            if (request.HeroLibraryIds != null)
            {
                config.HeroLibraryIds = request.HeroLibraryIds
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Select(id => id.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            config.EnableCustomOidc = request.EnableCustomOidc;
            var oidcName = (request.OidcProviderName ?? string.Empty).Trim();
            config.OidcProviderName = oidcName.Length > 32 ? oidcName.Substring(0, 32).Trim() : oidcName;
            config.OidcIssuerUrl = (request.OidcIssuerUrl ?? string.Empty).Trim();
            config.OidcClientId = (request.OidcClientId ?? string.Empty).Trim();
            if (request.ClearOidcClientSecret)
            {
                config.OidcClientSecret = string.Empty;
            }
            else if (!string.IsNullOrWhiteSpace(request.OidcClientSecret)
                && !string.Equals(request.OidcClientSecret.Trim(), "__KEEP__", StringComparison.Ordinal))
            {
                config.OidcClientSecret = request.OidcClientSecret.Trim();
            }

            config.OidcRequireAllowlist = request.OidcRequireAllowlist;
            if (request.ApprovedOidcUsers != null)
            {
                config.ApprovedOidcUsers = request.ApprovedOidcUsers
                    .Select(u => (u ?? string.Empty).Trim())
                    .Where(u => !string.IsNullOrEmpty(u))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            config.EnableSeerr = request.EnableSeerr;
            config.SeerrUrl = StreamFlixSeerrService.NormalizeBaseUrl(request.SeerrUrl);
            if (request.ClearSeerrApiKey)
            {
                config.SeerrApiKey = string.Empty;
            }
            else if (!string.IsNullOrWhiteSpace(request.SeerrApiKey)
                && !string.Equals(request.SeerrApiKey.Trim(), "__KEEP__", StringComparison.Ordinal))
            {
                config.SeerrApiKey = request.SeerrApiKey.Trim();
            }

            config.SeerrAllowKids = request.SeerrAllowKids;
            config.SeerrAllowGuests = request.SeerrAllowGuests;

            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        Plugin.Instance?.InjectScriptIntoDiskIndexIfWritable();
        await SyncProfilesAsync(config, force: true).ConfigureAwait(false);
        return Ok(BuildAdminConfigResponse(config));
    }

    [HttpPost("SetupSecrets")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SetupSecrets([FromBody] SetupSecretsRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null)
        {
            return BadRequest(new { message = "Missing request payload." });
        }

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
            if (config.ApprovedGoogleAccounts.Count > 0)
            {
                config.FirstGoogleAccountClaimed = true;
            }
        }

        Plugin.Instance?.InjectScriptIntoDiskIndexIfWritable();
        await SyncProfilesAsync(config, force: true).ConfigureAwait(false);
        Plugin.Instance?.SaveConfiguration();

        return Ok(BuildPublicState(config, caller));
    }

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
        if (config.RequireGoogleAuth && !config.EnableGoogleSignIn)
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
                return StatusCode(403, new
                {
                    verified = false,
                    unapproved = true,
                    email,
                    message = $"{email} isn't approved for this StreamFlix server. Ask the owner to add it in Dashboard → Plugins → StreamFlix.",
                });
            }

            if (!config.FirstGoogleAccountClaimed)
            {
                config.FirstGoogleAccountClaimed = true;
                Plugin.Instance?.SaveConfiguration();
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
        var isAdmin = StreamFlixStartupTask.IsUserAdminCompat(user);
        var kind = isAdmin
            ? StreamFlixSessionService.AuthKindJellyfinAdmin
            : StreamFlixSessionService.AuthKindJellyfin;
        var session = StreamFlixSessionService.IssueJellyfinSession(
            config,
            kind,
            user.Id.ToString("N"),
            user.Username,
            out var sessionToken);

        string? jellyfinAccessToken = null;
        if (isAdmin)
        {
            jellyfinAccessToken = await TryMintAdminJellyfinTokenAsync(user, request, remoteIp).ConfigureAwait(false);
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
            jellyfinAccessToken,
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

        var isLocalLan = StreamFlixSessionService.IsLocalLanRequest(HttpContext);
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
        var session = StreamFlixSessionService.IssueJellyfinSession(
            config,
            StreamFlixSessionService.AuthKindJellyfinAdmin,
            user.Id.ToString("N"),
            user.Username,
            out var sessionToken);

        var jellyfinAccessToken = await TryMintAdminJellyfinTokenAsync(user, request, remoteIp).ConfigureAwait(false);

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
            jellyfinAccessToken,
            serverId = _appHost.SystemId,
        });
    }

    [HttpPost("TestOAuthConfig")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> TestOAuthConfig([FromBody] TestOAuthConfigRequest request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
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

    [HttpGet("Oidc/Start")]
    [AllowAnonymous]
    public async Task<ActionResult> StartOidcSignIn(
        [FromQuery] string? returnWebBase = null,
        [FromQuery] string? pendingProfileId = null,
        [FromQuery] string? loginHint = null)
    {
        Response.Headers["Cache-Control"] = "no-store";
        var config = Config;
        var safeWebBase = ResolveSafeRelativeWebPath(returnWebBase);

        if (!StreamFlixOidcService.IsConfigured(config))
        {
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: "OpenID Connect sign-in is not enabled on this server."));
        }

        try
        {
            var callbackUri = BuildAbsoluteOidcCallbackUri();
            var (authUrl, signedStateCookie) = await StreamFlixOidcService.CreateAuthorizationRedirectAsync(
                config,
                callbackUri,
                safeWebBase,
                loginHint,
                pendingProfileId,
                HttpContext.RequestAborted).ConfigureAwait(false);

            Response.Cookies.Append(
                StreamFlixOidcService.StateCookieName,
                signedStateCookie,
                BuildOidcCookieOptions(TimeSpan.FromMinutes(10)));

            return Redirect(authUrl);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: failed to initiate OIDC authorization redirect.");
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: ex.Message));
        }
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
        var config = Config;
        var rawStateCookie = Request.Cookies[StreamFlixOidcService.StateCookieName];
        DeleteOidcCookie(StreamFlixOidcService.StateCookieName);

        var statePayload = StreamFlixSessionService.VerifyShortLivedPayload<StreamFlixOidcService.OidcStatePayload>(
            config,
            StreamFlixOidcService.StateTokenPurpose,
            rawStateCookie);
        var safeWebBase = ResolveSafeRelativeWebPath(statePayload?.ReturnWebBase);

        if (!StreamFlixOidcService.IsConfigured(config))
        {
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

            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: friendly));
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
                return Redirect(BuildOidcReturnUrl(
                    safeWebBase,
                    errorMessage: $"{who} isn't on the approved OIDC allowlist for this StreamFlix server. Ask the owner to add it in Dashboard → Plugins → StreamFlix."));
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

            var signedHandoff = StreamFlixSessionService.SignShortLivedPayload(
                config,
                StreamFlixOidcService.HandoffTokenPurpose,
                handoffPayload,
                TimeSpan.FromSeconds(75));

            Response.Cookies.Append(
                StreamFlixOidcService.HandoffCookieName,
                signedHandoff,
                BuildOidcCookieOptions(TimeSpan.FromSeconds(75)));

            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: null));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: OIDC callback verification failed.");
            return Redirect(BuildOidcReturnUrl(safeWebBase, errorMessage: ex.Message));
        }
    }

    [HttpPost("Oidc/Complete")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<object> CompleteOidcHandoff()
    {
        Response.Headers["Cache-Control"] = "no-store";
        var config = Config;
        var rawHandoff = Request.Cookies[StreamFlixOidcService.HandoffCookieName];
        DeleteOidcCookie(StreamFlixOidcService.HandoffCookieName);

        var handoff = StreamFlixSessionService.VerifyShortLivedPayload<StreamFlixOidcService.OidcHandoffPayload>(
            config,
            StreamFlixOidcService.HandoffTokenPurpose,
            rawHandoff);

        if (handoff == null || string.IsNullOrWhiteSpace(handoff.SessionToken))
        {
            return StatusCode(401, new
            {
                verified = false,
                code = "oidc_handoff_expired",
                message = "OpenID Connect sign-in handoff expired. Please sign in again.",
            });
        }

        // Re-validate the minted session against current config before handing it to the browser
        var validated = StreamFlixSessionService.Validate(config, handoff.SessionToken);
        if (validated == null)
        {
            return StatusCode(401, new
            {
                verified = false,
                code = "oidc_session_invalid",
                message = "OpenID Connect session is no longer valid.",
            });
        }

        return Ok(new
        {
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
        if (!caller.IsAdmin)
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

    [HttpPost("Sessions/RevokeAll")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RevokeAllSessions()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can sign out all devices." });
        }

        config.SessionVersion = Math.Max(1, config.SessionVersion) + 1;
        Plugin.Instance?.SaveConfiguration();
        _logger.LogInformation("StreamFlix: all household sessions revoked by an administrator (session version {Version}).", config.SessionVersion);
        return Ok(new { revoked = true, sessionVersion = config.SessionVersion });
    }

    [HttpPost("Profiles/Activate")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ActivateProfile([FromBody] ActivateProfileRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);

        var profile = FindProfile(config, request?.ProfileId);
        if (profile == null)
        {
            return NotFound(new { code = "profile_not_found", message = "That profile no longer exists." });
        }

        var isGuest = IsGuestSession(caller);
        if (isGuest)
        {
            if (!string.Equals(profile.Id, caller.Session?.LockedProfileId, StringComparison.Ordinal)
                || IsProfileLinkedToAdmin(profile))
            {
                return StatusCode(403, new
                {
                    code = "guest_profile_locked",
                    message = "This Guest Pass only grants access to its assigned profile.",
                });
            }
        }
        else
        {
            var lockResult = CheckGoogleLock(profile, caller);
            if (lockResult != null)
            {
                return lockResult;
            }

            var suppliedPin = (!string.IsNullOrWhiteSpace(request?.Pin) ? request!.Pin : request?.PinCode) ?? string.Empty;
            var pinResult = CheckPin(profile, suppliedPin);
            if (pinResult != null)
            {
                return pinResult;
            }
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

        if (StreamFlixStartupTask.IsUserDisabledCompat(user))
        {
            return StatusCode(403, new { code = "user_disabled", message = $"The Jellyfin user \"{user.Username}\" is currently disabled in Server Dashboard → Users." });
        }

        var isAdminUser = (primaryAdmin != null && user.Id == primaryAdmin.Id) || StreamFlixStartupTask.IsUserAdminCompat(user);
        if (isGuest && isAdminUser)
        {
            return StatusCode(403, new
            {
                code = "guest_admin_forbidden",
                message = "Guest Passes cannot sign in to an administrator account.",
            });
        }

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

        var appName = !string.IsNullOrWhiteSpace(request?.AppName) ? request!.AppName!.Trim() : "Jellyfin Web";
        var appVersion = !string.IsNullOrWhiteSpace(request?.AppVersion) ? request!.AppVersion!.Trim() : "10.11.0";
        var deviceId = isGuest && !string.IsNullOrWhiteSpace(caller.Session?.GuestPassId)
            ? BuildGuestDeviceId(caller.Session!.GuestPassId!, request?.DeviceId)
            : (!string.IsNullOrWhiteSpace(request?.DeviceId) ? request!.DeviceId!.Trim() : $"streamflix-profile-{profile.Id}");
        var deviceName = isGuest
            ? $"StreamFlix Guest ({(string.IsNullOrWhiteSpace(caller.Session?.Username) ? profile.Name : caller.Session!.Username)})"
            : (!string.IsNullOrWhiteSpace(request?.DeviceName) ? request!.DeviceName!.Trim() : $"StreamFlix ({profile.Name})");

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

        if (isGuest && !string.IsNullOrWhiteSpace(caller.Session?.GuestPassId) && !string.IsNullOrWhiteSpace(authResult.AccessToken))
        {
            TrackGuestAccessToken(caller.Session!.GuestPassId!, authResult.AccessToken);
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
    public async Task<ActionResult<object>> VerifyPin([FromBody] VerifyPinRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (IsGuestSession(caller))
        {
            return StatusCode(403, new { code = "guest_pass_restricted", message = "Guest Pass sessions cannot access PIN-protected profiles." });
        }

        var profile = FindProfile(config, request?.ProfileId);
        if (profile == null)
        {
            return NotFound(new { code = "profile_not_found", message = "That profile no longer exists." });
        }

        var lockResult = CheckGoogleLock(profile, caller);
        if (lockResult != null)
        {
            return lockResult;
        }

        return CheckPin(profile, request?.Pin ?? string.Empty) ?? Ok(new { ok = true });
    }

    [HttpPost("Profiles/Save")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SaveProfile([FromBody] SaveProfileRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null)
        {
            return BadRequest(new { message = "Missing profile payload." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (IsGuestSession(caller))
        {
            return StatusCode(403, new { code = "guest_pass_restricted", message = "Guest Pass sessions cannot create or edit profiles." });
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
        if (isNewProfile && config.Profiles.Count >= MaxProfilesCount)
        {
            return BadRequest(new { message = $"You can create at most {MaxProfilesCount} profiles." });
        }

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

        var autoRevokedPassIds = new List<string>();
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (existing == null)
            {
                if (config.Profiles.Count >= MaxProfilesCount)
                {
                    return BadRequest(new { message = $"You can create at most {MaxProfilesCount} profiles." });
                }

                existing = new StreamFlixProfileConfig
                {
                    Id = $"streamflix_{Guid.NewGuid():N}",
                };
                config.Profiles.Add(existing);
            }

            existing.Name = cleanName;
            existing.AvatarColorIndex = Math.Clamp(request.AvatarColorIndex, 0, 64);
            existing.AvatarIconIndex = Math.Clamp(request.AvatarIconIndex, 0, 128);
            var trimmedEmoji = request.AvatarEmoji?.Trim();
            existing.AvatarEmoji = !string.IsNullOrEmpty(trimmedEmoji)
                ? (trimmedEmoji.Length > 16 ? trimmedEmoji.Substring(0, 16) : trimmedEmoji)
                : (request.IsKids ? "🦊" : "🎬");
            existing.AvatarColorHex = SanitizeHexColor(request.AvatarColorHex);
            existing.IsKids = request.IsKids;
            var trimmedMaturity = request.MaturityRating?.Trim();
            existing.MaturityRating = !string.IsNullOrEmpty(trimmedMaturity)
                ? (trimmedMaturity.Length > 60 ? trimmedMaturity.Substring(0, 60) : trimmedMaturity)
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

            // Never allow active Guest Passes to remain active if a profile is re-linked to an administrator account
            if (IsProfileLinkedToAdmin(existing) && config.GuestPasses != null)
            {
                var nowIso = DateTimeOffset.UtcNow.ToString("O");
                foreach (var gp in config.GuestPasses)
                {
                    if (!gp.Revoked && string.Equals(gp.ProfileId, existing.Id, StringComparison.OrdinalIgnoreCase))
                    {
                        gp.Revoked = true;
                        gp.RevokedAtUtc = nowIso;
                        autoRevokedPassIds.Add(gp.Id);
                    }
                }
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

        foreach (var revokedId in autoRevokedPassIds)
        {
            await RevokeGuestJellyfinSessionsAsync(revokedId).ConfigureAwait(false);
        }

        return Ok(BuildPublicState(config, caller));
    }

    [HttpPost("Profiles/Reorder")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ReorderProfiles([FromBody] ReorderProfilesRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (IsGuestSession(caller))
        {
            return StatusCode(403, new { code = "guest_pass_restricted", message = "Guest Pass sessions cannot reorder profiles." });
        }

        if (request?.ProfileIds != null && request.ProfileIds.Count > 0 && config.Profiles.Count > 1)
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
    public async Task<ActionResult<object>> DeleteProfile([FromBody] DeleteProfileRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (IsGuestSession(caller))
        {
            return StatusCode(403, new { code = "guest_pass_restricted", message = "Guest Pass sessions cannot delete profiles." });
        }

        if (config.Profiles.Count <= 1)
        {
            return BadRequest(new { message = "You can't delete the last remaining profile." });
        }

        var target = FindProfile(config, request?.ProfileId);
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

            var pinResult = CheckPin(target, request?.CurrentPin ?? string.Empty);
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

        var revokedForDeletedProfile = new List<string>();
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

            if (config.GuestPasses != null)
            {
                var nowIso = DateTimeOffset.UtcNow.ToString("O");
                foreach (var gp in config.GuestPasses)
                {
                    if (!gp.Revoked && string.Equals(gp.ProfileId, target.Id, StringComparison.OrdinalIgnoreCase))
                    {
                        gp.Revoked = true;
                        gp.RevokedAtUtc = nowIso;
                        revokedForDeletedProfile.Add(gp.Id);
                    }
                }
            }

            config.Profiles.Remove(target);
            deletedUserId = target.JellyfinUserId;
            shouldDeleteUser = request?.DeleteJellyfinUser == true
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

        foreach (var passId in revokedForDeletedProfile)
        {
            await RevokeGuestJellyfinSessionsAsync(passId).ConfigureAwait(false);
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

    [HttpGet("GuestPasses")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ListGuestPasses()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can manage Guest Passes." });
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
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can create Guest Passes." });
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
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            config.GuestPasses ??= new List<StreamFlixGuestPass>();
            var activeCount = config.GuestPasses.Count(g => GetGuestPassStatus(g) == "active");
            if (activeCount >= MaxActiveGuestPasses)
            {
                return BadRequest(new { message = $"You already have {MaxActiveGuestPasses} active Guest Passes. Revoke or clear old passes first." });
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
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can view Guest Pass QR codes." });
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
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can revoke Guest Passes." });
        }

        StreamFlixGuestPass? targetPass = null;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            targetPass = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
                .FirstOrDefault(g => string.Equals(g.Id, passId, StringComparison.Ordinal));
            if (targetPass == null)
            {
                return NotFound(new { message = "Guest Pass not found." });
            }

            targetPass.Revoked = true;
            targetPass.RevokedAtUtc = DateTimeOffset.UtcNow.ToString("O");
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        await RevokeGuestJellyfinSessionsAsync(targetPass.Id).ConfigureAwait(false);
        _logger.LogInformation("StreamFlix: revoked Guest Pass '{PassId}' ({Label}).", targetPass.Id, targetPass.Label);

        var passes = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
            .OrderByDescending(p => p.CreatedAtUtc, StringComparer.Ordinal)
            .Select(p => MapGuestPassAdmin(config, p))
            .ToList();
        return Ok(new { revoked = true, passes });
    }

    [HttpPost("GuestPasses/Purge")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> PurgeInactiveGuestPasses()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!caller.IsAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can clear Guest Passes." });
        }

        var removed = 0;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (config.GuestPasses != null)
            {
                removed = config.GuestPasses.RemoveAll(g => GetGuestPassStatus(g) != "active");
                if (removed > 0)
                {
                    Plugin.Instance?.SaveConfiguration();
                }
            }
        }
        finally
        {
            SyncLock.Release();
        }

        var passes = (config.GuestPasses ?? new List<StreamFlixGuestPass>())
            .OrderByDescending(p => p.CreatedAtUtc, StringComparer.Ordinal)
            .Select(p => MapGuestPassAdmin(config, p))
            .ToList();
        return Ok(new { removed, passes });
    }

    [HttpGet("Guest/{code}")]
    [AllowAnonymous]
    public ActionResult StartGuestPassHandoff([FromRoute] string code)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var safeWebBase = ResolveSafeRelativeWebPath(null);

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

        Response.Cookies.Append(
            StreamFlixSessionService.GuestHandoffCookieName,
            signedCookie,
            BuildOidcCookieOptions(TimeSpan.FromSeconds(90)));

        return Redirect(BuildGuestReturnUrl(safeWebBase, errorMessage: null));
    }

    [HttpPost("Guest/Complete")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> CompleteGuestPassHandoff([FromBody] RedeemGuestPassRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var rawCookie = Request.Cookies[StreamFlixSessionService.GuestHandoffCookieName];
        DeleteOidcCookie(StreamFlixSessionService.GuestHandoffCookieName);

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

    [HttpPost("MovieNight/Candidates")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetMovieNightCandidates([FromBody] MovieNightCandidatesRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (IsGuestSession(caller))
        {
            return StatusCode(403, new { code = "guest_pass_restricted", message = "Movie Night Matcher requires full household profile access." });
        }

        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);

        var requestedIds = (request?.ProfileIds ?? new List<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(6)
            .ToList();

        var selectedProfiles = new List<StreamFlixProfileConfig>();
        foreach (var pid in requestedIds)
        {
            var p = FindProfile(config, pid);
            if (p != null && selectedProfiles.All(x => !string.Equals(x.Id, p.Id, StringComparison.OrdinalIgnoreCase)))
            {
                selectedProfiles.Add(p);
            }
        }

        if (selectedProfiles.Count < 2)
        {
            return BadRequest(new { message = "Select at least 2 household profiles to start Movie Night Matcher." });
        }

        var result = ComputeMovieNightCandidates(selectedProfiles, request ?? new MovieNightCandidatesRequest());
        return Ok(result);
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
        var (allowed, isKids, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, profileId).ConfigureAwait(false);
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
            cts.CancelAfter(TimeSpan.FromSeconds(8));
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
                    jellyfinMediaId = i.JellyfinMediaId,
                }).ToList(),
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr search failed.");
            return StatusCode(502, new { code = "seerr_unreachable", message = ex.Message });
        }
    }

    [HttpGet("Seerr/Tv/{tmdbId:int}")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetSeerrTvDetails(
        [FromRoute] int tmdbId,
        [FromQuery] string? profileId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var (allowed, _, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, profileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { code = "seerr_forbidden", message = denyReason });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(8));
            var tv = await StreamFlixSeerrService.GetTvDetailsAsync(config, tmdbId, cts.Token).ConfigureAwait(false);
            return Ok(new
            {
                tmdbId = tv.TmdbId,
                title = tv.Title,
                year = tv.Year,
                overview = tv.Overview,
                backdropUrl = tv.BackdropUrl,
                mediaStatus = tv.MediaStatus,
                statusLabel = tv.StatusLabel,
                seasons = tv.Seasons.Select(s => new
                {
                    seasonNumber = s.SeasonNumber,
                    name = s.Name,
                    episodeCount = s.EpisodeCount,
                    year = s.Year,
                    status = s.Status,
                    statusLabel = s.StatusLabel,
                }).ToList(),
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr TV detail lookup failed for TMDB {TmdbId}.", tmdbId);
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
        var (allowed, _, denyReason) = await EvaluateSeerrPermissionAsync(config, caller, request.ProfileId).ConfigureAwait(false);
        if (!allowed)
        {
            return StatusCode(403, new { ok = false, code = "seerr_forbidden", message = denyReason });
        }

        var rateKey = "seerr|" + StreamFlixSessionService.GetRateLimitClientKey(HttpContext);
        if (!AllowSeerrSubmitRate(rateKey))
        {
            return StatusCode(429, new { ok = false, code = "rate_limited", message = "Too many media requests submitted recently. Please wait a couple of minutes." });
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(12));
            var (ok, mediaStatus, statusLabel, message) = await StreamFlixSeerrService.SubmitRequestAsync(
                config,
                request.TmdbId,
                request.MediaType,
                request.Seasons,
                cts.Token).ConfigureAwait(false);

            return Ok(new
            {
                ok,
                mediaStatus,
                statusLabel,
                message,
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: Seerr request failed for TMDB {TmdbId}.", request.TmdbId);
            return StatusCode(502, new { ok = false, code = "seerr_request_failed", message = ex.Message });
        }
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

    private static bool IsGateUnconfigured(PluginConfiguration config)
    {
        return config.RequireGoogleAuth
            && (!config.EnableGoogleSignIn || string.IsNullOrWhiteSpace(config.GoogleClientId))
            && !StreamFlixOidcService.IsConfigured(config)
            && !config.AllowStandardJellyfinLogin;
    }

    private static bool HasHouseholdAccess(PluginConfiguration config, CallerContext caller)
    {
        return !config.RequireGoogleAuth
            || (config.BypassLoginGateOnLan && caller.IsLocalLan)
            || caller.Session != null
            || caller.IsAdmin;
    }

    private ObjectResult GoogleRequired(PluginConfiguration? config = null)
    {
        var cfg = config ?? Config;
        var hasGoogle = cfg.EnableGoogleSignIn && !string.IsNullOrWhiteSpace(cfg.GoogleClientId);
        var hasOidc = StreamFlixOidcService.IsConfigured(cfg);
        var msg = (hasGoogle || hasOidc) && cfg.AllowStandardJellyfinLogin
            ? "Please sign in to unlock StreamFlix."
            : (cfg.AllowStandardJellyfinLogin && !hasGoogle && !hasOidc
                ? "Please sign in with your Jellyfin account to continue."
                : "Please sign in to continue.");
        return StatusCode(401, new { code = "google_required", message = msg });
    }

    private async Task<string?> TryMintAdminJellyfinTokenAsync(JUser user, PasswordLoginRequest? request, string remoteIp)
    {
        try
        {
            var authReq = new AuthenticationRequest
            {
                App = !string.IsNullOrWhiteSpace(request?.AppName) ? request!.AppName!.Trim() : "Jellyfin Web",
                AppVersion = !string.IsNullOrWhiteSpace(request?.AppVersion) ? request!.AppVersion!.Trim() : "10.11.0",
                DeviceId = !string.IsNullOrWhiteSpace(request?.DeviceId) ? request!.DeviceId!.Trim() : $"streamflix-admin-{user.Id:N}",
                DeviceName = !string.IsNullOrWhiteSpace(request?.DeviceName) ? request!.DeviceName!.Trim() : $"StreamFlix Admin ({user.Username})",
                UserId = user.Id,
                Username = user.Username,
                RemoteEndPoint = remoteIp,
            };
            var res = await _sessionManager.AuthenticateDirect(authReq).ConfigureAwait(false);
            return res?.AccessToken;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: optional AuthenticateDirect token mint skipped for '{Username}'.", user.Username);
            return null;
        }
    }

    private ObjectResult? CheckGoogleLock(StreamFlixProfileConfig profile, CallerContext caller)
    {
        if (string.IsNullOrWhiteSpace(profile.GoogleAccountEmail) || caller.IsAdmin)
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

        var lockKey = StreamFlixSessionService.GetRateLimitClientKey(HttpContext) + "|" + profile.Id;
        if (StreamFlixSessionService.IsPinLockedOut(lockKey, out var retryAfter)
            || StreamFlixSessionService.IsPinTargetLockedOut(profile.Id, out retryAfter))
        {
            var secs = (int)Math.Ceiling(retryAfter.TotalSeconds);
            Response.Headers["Retry-After"] = secs.ToString(CultureInfo.InvariantCulture);
            return StatusCode(429, new { code = "pin_locked", retryAfterSeconds = secs, message = $"Too many wrong PINs. Try again in {Math.Max(1, (secs + 59) / 60)} min." });
        }

        if (string.IsNullOrEmpty(suppliedPin))
        {
            return StatusCode(403, new { code = "pin_required", message = "Enter the profile PIN." });
        }

        if (!StreamFlixSessionService.ConstantTimePinEquals(profile.PinCode, suppliedPin))
        {
            StreamFlixSessionService.RegisterPinFailure(lockKey);
            StreamFlixSessionService.RegisterPinTargetFailure(profile.Id);
            return StatusCode(403, new { code = "pin_invalid", message = "Incorrect PIN. Please try again." });
        }

        StreamFlixSessionService.ResetPinFailures(lockKey);
        StreamFlixSessionService.ResetPinTargetFailures(profile.Id);
        return null;
    }

    private async Task<CallerContext> GetCallerAsync(PluginConfiguration config)
    {
        var isLocalLan = StreamFlixSessionService.IsLocalLanRequest(HttpContext);
        var token = Request.Headers[StreamFlixSessionService.HeaderName].FirstOrDefault();
        var session = StreamFlixSessionService.Validate(config, token);
        var sessionIsAdmin = false;

        if (session != null)
        {
            if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindGoogle, StringComparison.Ordinal))
            {
                if (config.RequireGoogleAuth && !config.EnableGoogleSignIn)
                {
                    session = null;
                }
            }
            else if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal))
            {
                if (config.RequireGoogleAuth && !StreamFlixOidcService.IsConfigured(config))
                {
                    session = null;
                }
            }
            else if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindJellyfinAdmin, StringComparison.Ordinal))
            {
                if (!Guid.TryParse(session.JellyfinUserId, out var adminUid))
                {
                    session = null;
                }
                else
                {
                    var u = _userManager.GetUserById(adminUid);
                    if (u == null || StreamFlixStartupTask.IsUserDisabledCompat(u) || !StreamFlixStartupTask.IsUserAdminCompat(u))
                    {
                        session = null;
                    }
                    else if (config.AdminFallbackLanOnly && !IsGateUnconfigured(config) && !config.AllowStandardJellyfinLogin && !isLocalLan)
                    {
                        session = null;
                    }
                    else
                    {
                        sessionIsAdmin = true;
                    }
                }
            }
            else if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindJellyfin, StringComparison.Ordinal))
            {
                if (!Guid.TryParse(session.JellyfinUserId, out var jfUid))
                {
                    session = null;
                }
                else
                {
                    var u = _userManager.GetUserById(jfUid);
                    if (u == null || StreamFlixStartupTask.IsUserDisabledCompat(u))
                    {
                        session = null;
                    }
                    else if (StreamFlixStartupTask.IsUserAdminCompat(u))
                    {
                        sessionIsAdmin = true;
                    }
                }
            }
            else if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindGuestPass, StringComparison.Ordinal))
            {
                var lockedProf = FindProfile(config, session.LockedProfileId);
                if (lockedProf == null || IsProfileLinkedToAdmin(lockedProf))
                {
                    session = null;
                }
                else if (!string.IsNullOrWhiteSpace(lockedProf.JellyfinUserId)
                    && Guid.TryParse(lockedProf.JellyfinUserId, out var gpUid))
                {
                    var gpUser = _userManager.GetUserById(gpUid);
                    if (gpUser != null && (StreamFlixStartupTask.IsUserDisabledCompat(gpUser) || StreamFlixStartupTask.IsUserAdminCompat(gpUser)))
                    {
                        session = null;
                    }
                }
            }
        }

        var isAuthenticated = false;
        var isAdmin = sessionIsAdmin;
        JUser? jellyfinAuthUser = null;
        try
        {
            var info = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (info != null && info.IsAuthenticated && (info.IsApiKey || !StreamFlixStartupTask.IsUserDisabledCompat(info.User)))
            {
                isAuthenticated = true;
                jellyfinAuthUser = info.User;
                isAdmin = isAdmin || info.IsApiKey || StreamFlixStartupTask.IsUserAdminCompat(info.User);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: could not read Jellyfin authorization info.");
        }

        return new CallerContext(session, isAuthenticated, isAdmin, isLocalLan, jellyfinAuthUser);
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

    private object BuildPublicState(PluginConfiguration config, CallerContext caller)
    {
        var hasAccess = HasHouseholdAccess(config, caller);
        var isGuestPass = IsGuestSession(caller);
        var isUnconfiguredGate = IsGateUnconfigured(config);
        var canShowAdminFallback = isUnconfiguredGate
            || (config.AllowAdminFallbackLogin && (!config.AdminFallbackLanOnly || caller.IsLocalLan));

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
        if (isGuestPass)
        {
            profilesSnapshot = profilesSnapshot
                .Where(p => string.Equals(p.Id, caller.Session?.LockedProfileId, StringComparison.Ordinal) && !IsProfileLinkedToAdmin(p))
                .ToList();
        }

        var activeGuestPass = isGuestPass && !string.IsNullOrWhiteSpace(caller.Session?.GuestPassId)
            ? (config.GuestPasses ?? new List<StreamFlixGuestPass>())
                .FirstOrDefault(g => string.Equals(g.Id, caller.Session!.GuestPassId, StringComparison.Ordinal))
            : null;

        var approvedSnapshot = (config.ApprovedGoogleAccounts ?? new List<string>()).ToList();
        var approvedOidcSnapshot = (config.ApprovedOidcUsers ?? new List<string>()).ToList();
        var oidcConfigured = StreamFlixOidcService.IsConfigured(config);
        var oidcProviderName = StreamFlixOidcService.GetDisplayProviderName(config);
        var seerrConfigured = StreamFlixSeerrService.IsConfigured(config);
        var seerrEnabled = hasAccess && seerrConfigured && (!isGuestPass || config.SeerrAllowGuests);
        var heroLibrariesSnapshot = (config.HeroLibraryIds ?? new List<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new
        {
            version = Plugin.VersionString,
            assetVersion = Plugin.AssetCacheVersion,
            serverId = _appHost.SystemId,
            serverName = _appHost.FriendlyName,
            customBrandName = (config.CustomBrandName ?? string.Empty).Trim(),
            enableStreamFlixUi = config.EnableStreamFlixUi,
            requireGoogleAuth = config.RequireGoogleAuth,
            enableGoogleSignIn = config.EnableGoogleSignIn,
            enableCustomOidc = config.EnableCustomOidc,
            oidcConfigured,
            oidcProviderName,
            oidcRequireAllowlist = config.OidcRequireAllowlist,
            hasOidcClientSecret = caller.IsAdmin && !string.IsNullOrWhiteSpace(config.OidcClientSecret),
            allowStandardJellyfinLogin = config.AllowStandardJellyfinLogin,
            allowAdminFallbackLogin = config.AllowAdminFallbackLogin,
            adminFallbackLanOnly = config.AdminFallbackLanOnly,
            bypassLoginGateOnLan = config.BypassLoginGateOnLan,
            isLocalLan = caller.IsLocalLan,
            canShowAdminFallback,
            googleClientId = caller.IsAdmin || config.EnableGoogleSignIn ? config.GoogleClientId : string.Empty,
            googleConfigured = !string.IsNullOrWhiteSpace(config.GoogleClientId),
            hasGoogleClientSecret = caller.IsAdmin && !string.IsNullOrWhiteSpace(config.GoogleClientSecret),
            hasAccess,
            isAdmin = caller.IsAdmin,
            isGuestPass,
            guestPassLabel = activeGuestPass?.Label,
            guestPassExpiresAt = activeGuestPass?.ExpiresAtUtc ?? caller.Session?.ExpiresAt.ToString("O"),
            lockedProfileId = isGuestPass ? caller.Session?.LockedProfileId : null,
            seerrConfigured = caller.IsAdmin && seerrConfigured,
            seerrEnabled,
            seerrAllowKids = config.SeerrAllowKids,
            seerrAllowGuests = config.SeerrAllowGuests,
            session = caller.Session == null
                ? null
                : new
                {
                    authKind = caller.Session.AuthKind,
                    providerName = string.Equals(caller.Session.AuthKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal) ? oidcProviderName : null,
                    email = caller.Session.Email,
                    username = caller.Session.Username,
                    userId = caller.Session.JellyfinUserId,
                    guestPassId = caller.Session.GuestPassId,
                    lockedProfileId = caller.Session.LockedProfileId,
                    expiresAt = caller.Session.ExpiresAt,
                },
            top10SelectionMode = NormalizeTop10Mode(config.Top10SelectionMode),
            heroRotationSeconds = Math.Clamp(config.HeroRotationSeconds, 0, 120),
            heroSlideCount = Math.Clamp(config.HeroSlideCount <= 0 ? 8 : config.HeroSlideCount, 1, 15),
            heroSelectionMode = NormalizeHeroSelectionMode(config.HeroSelectionMode),
            heroContentType = NormalizeHeroContentType(config.HeroContentType),
            heroLibraryIds = heroLibrariesSnapshot,
            approvedGoogleAccounts = hasAccess && caller.IsAdmin ? approvedSnapshot : new List<string>(),
            approvedOidcUsers = hasAccess && caller.IsAdmin ? approvedOidcSnapshot : new List<string>(),
            serverUsers,
            profiles = hasAccess ? profilesSnapshot.Select(p => MapProfilePublic(p, caller)).ToList() : new List<object>(),
            showcaseItems = hasAccess && !isGuestPass ? GetShowcaseItemsCached(_libraryManager) : new List<object>(),
        };
    }

    private string BuildAbsoluteOidcCallbackUri()
    {
        var scheme = Request.Scheme;
        var host = Request.Host.Value;
        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;

        // When behind a local/Docker reverse proxy (e.g. Caddy, Nginx, Traefik), honor forwarded scheme/host/prefix safely
        var remoteIp = HttpContext.Connection.RemoteIpAddress;
        if (remoteIp != null && StreamFlixSessionService.IsPrivateOrLoopbackIp(remoteIp))
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

    private static string BuildOidcReturnUrl(string safeRelativeWebPath, string? errorMessage)
    {
        if (string.IsNullOrWhiteSpace(errorMessage))
        {
            return $"{safeRelativeWebPath}?sf_oidc=1#/home";
        }

        return $"{safeRelativeWebPath}?sf_oidc_error={Uri.EscapeDataString(errorMessage.Trim())}#/home";
    }

    private bool IsEffectiveHttps()
    {
        if (Request.IsHttps)
        {
            return true;
        }

        var remoteIp = HttpContext.Connection.RemoteIpAddress;
        if (remoteIp != null && StreamFlixSessionService.IsPrivateOrLoopbackIp(remoteIp))
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

    private CookieOptions BuildOidcCookieOptions(TimeSpan maxAge)
    {
        return new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsEffectiveHttps(),
            Path = GetCookieBasePath(),
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

    private static string SanitizeHexColor(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw))
        {
            var trimmed = raw.Trim();
            if (HexColorRegex.IsMatch(trimmed))
            {
                return trimmed;
            }
        }

        return "#E50914";
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

        var fresh = GetShowcaseItemsCompat(libraryManager);
        lock (ShowcaseCacheLock)
        {
            _showcaseCache = fresh;
            _showcaseCachedAtUtc = DateTime.UtcNow;
        }

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

        var isGuest = IsGuestSession(caller);
        var lockEmail = isGuest || string.IsNullOrWhiteSpace(p.GoogleAccountEmail) ? null : p.GoogleAccountEmail.Trim();
        var callerOwnsLock = lockEmail != null && caller.Session != null
            && string.Equals(caller.Session.Email, lockEmail, StringComparison.OrdinalIgnoreCase);

        return new
        {
            id = p.Id,
            name = p.Name,
            avatarColorIndex = p.AvatarColorIndex,
            avatarIconIndex = p.AvatarIconIndex,
            avatarEmoji = p.AvatarEmoji,
            avatarColorHex = SanitizeHexColor(p.AvatarColorHex),
            isKids = p.IsKids,
            isAdmin,
            isOwner = StreamFlixStartupTask.IsOwnerProfile(p),
            maturityRating = p.MaturityRating,
            hasPin = !isGuest && !string.IsNullOrWhiteSpace(p.PinCode),
            pinLength = isGuest || string.IsNullOrWhiteSpace(p.PinCode) ? 0 : p.PinCode.Trim().Length,
            googleLocked = !isGuest && lockEmail != null,
            googleAccountEmail = lockEmail != null && (caller.IsAdmin || callerOwnsLock) ? lockEmail : null,
            googleAccountHint = lockEmail != null ? StreamFlixSessionService.MaskEmail(lockEmail) : null,
            googleLockSatisfied = isGuest || lockEmail == null || callerOwnsLock || caller.IsAdmin,
            autoplayNextEpisode = p.AutoplayNextEpisode,
            autoplayPreviews = p.AutoplayPreviews,
            jellyfinUserId = p.JellyfinUserId,
            jellyfinUsername = p.JellyfinUsername,
        };
    }

    private void SetNoStoreSecurityHeaders()
    {
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    private static bool IsGuestSession(CallerContext caller)
    {
        return !caller.IsAdmin
            && caller.Session != null
            && string.Equals(caller.Session.AuthKind, StreamFlixSessionService.AuthKindGuestPass, StringComparison.Ordinal);
    }

    private static object BuildAdminConfigResponse(PluginConfiguration config)
    {
        return new
        {
            version = Plugin.VersionString,
            enableStreamFlixUi = config.EnableStreamFlixUi,
            customBrandName = config.CustomBrandName ?? string.Empty,
            requireGoogleAuth = config.RequireGoogleAuth,
            enableGoogleSignIn = config.EnableGoogleSignIn,
            allowStandardJellyfinLogin = config.AllowStandardJellyfinLogin,
            allowAdminFallbackLogin = config.AllowAdminFallbackLogin,
            adminFallbackLanOnly = config.AdminFallbackLanOnly,
            bypassLoginGateOnLan = config.BypassLoginGateOnLan,
            autoProvisionJellyfinUsers = config.AutoProvisionJellyfinUsers,
            googleClientId = config.GoogleClientId ?? string.Empty,
            hasGoogleClientSecret = !string.IsNullOrWhiteSpace(config.GoogleClientSecret),
            approvedGoogleAccounts = (config.ApprovedGoogleAccounts ?? new List<string>()).ToList(),
            sessionLifetimeDays = Math.Clamp(config.SessionLifetimeDays <= 0 ? 30 : config.SessionLifetimeDays, 1, 365),
            sessionVersion = Math.Max(1, config.SessionVersion),
            top10SelectionMode = NormalizeTop10Mode(config.Top10SelectionMode),
            heroRotationSeconds = Math.Clamp(config.HeroRotationSeconds, 0, 120),
            heroSlideCount = Math.Clamp(config.HeroSlideCount <= 0 ? 8 : config.HeroSlideCount, 1, 15),
            heroSelectionMode = NormalizeHeroSelectionMode(config.HeroSelectionMode),
            heroContentType = NormalizeHeroContentType(config.HeroContentType),
            heroLibraryIds = (config.HeroLibraryIds ?? new List<string>()).ToList(),
            enableCustomOidc = config.EnableCustomOidc,
            oidcProviderName = config.OidcProviderName ?? string.Empty,
            oidcIssuerUrl = config.OidcIssuerUrl ?? string.Empty,
            oidcClientId = config.OidcClientId ?? string.Empty,
            hasOidcClientSecret = !string.IsNullOrWhiteSpace(config.OidcClientSecret),
            oidcRequireAllowlist = config.OidcRequireAllowlist,
            approvedOidcUsers = (config.ApprovedOidcUsers ?? new List<string>()).ToList(),
            enableSeerr = config.EnableSeerr,
            seerrUrl = config.SeerrUrl ?? string.Empty,
            hasSeerrApiKey = !string.IsNullOrWhiteSpace(config.SeerrApiKey),
            seerrAllowKids = config.SeerrAllowKids,
            seerrAllowGuests = config.SeerrAllowGuests,
        };
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

    private static object MapGuestPassAdmin(PluginConfiguration config, StreamFlixGuestPass pass)
    {
        var liveProfile = FindProfile(config, pass.ProfileId);
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
            status = GetGuestPassStatus(pass),
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

        return $"{scheme}://{host}{pathBase.TrimEnd('/')}";
    }

    private string BuildAbsoluteGuestPassUri(string code)
    {
        return $"{BuildAbsolutePublicBaseUrl()}/StreamFlix/Guest/{Uri.EscapeDataString(code)}";
    }

    private static string BuildGuestReturnUrl(string safeRelativeWebPath, string? errorMessage)
    {
        if (string.IsNullOrWhiteSpace(errorMessage))
        {
            return $"{safeRelativeWebPath}?sf_guest=1#/home";
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

    private async Task RevokeGuestJellyfinSessionsAsync(string passId)
    {
        if (string.IsNullOrWhiteSpace(passId))
        {
            return;
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

        var logoutStringMethod = typeof(ISessionManager).GetMethod("Logout", new[] { typeof(string) })
            ?? _sessionManager.GetType().GetMethod("Logout", new[] { typeof(string) });

        if (logoutStringMethod != null)
        {
            foreach (var tok in tokensToRevoke)
            {
                try
                {
                    if (logoutStringMethod.Invoke(_sessionManager, new object[] { tok }) is Task logoutTask)
                    {
                        await logoutTask.ConfigureAwait(false);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "StreamFlix: non-fatal error logging out Guest Pass Jellyfin token.");
                }
            }
        }
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
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        StreamFlixSessionService.ResetGuestFailures(lockKey);

        // Resolve or auto-provision the assigned non-administrator Jellyfin user and sign the guest directly into it
        var primaryAdmin = StreamFlixStartupTask.GetPrimaryAdminUserCompat(_userManager);
        var user = (!string.IsNullOrWhiteSpace(profile.JellyfinUserId) && Guid.TryParse(profile.JellyfinUserId, out var parsedUid))
            ? _userManager.GetUserById(parsedUid)
            : null;
        if (user == null)
        {
            var targetName = !string.IsNullOrWhiteSpace(profile.JellyfinUsername) ? profile.JellyfinUsername.Trim() : profile.Name.Trim();
            user = StreamFlixStartupTask.FindSafeUserByName(_userManager, config, profile, targetName, profile.Name);
            if (user == null && config.AutoProvisionJellyfinUsers)
            {
                try
                {
                    user = await _userManager.CreateUserAsync(StreamFlixStartupTask.GetAvailableUsername(_userManager, targetName)).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "StreamFlix: could not auto-provision Jellyfin user '{TargetName}' for Guest Pass.", targetName);
                }
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
        var desiredAge = StreamFlixStartupTask.ParentalAgeFromMaturity(profile.MaturityRating, profile.IsKids);
        if (StreamFlixStartupTask.TryGetMaxParentalAge(user) != desiredAge && StreamFlixStartupTask.TrySetMaxParentalAge(user, desiredAge))
        {
            needsUpdate = true;
        }

        if (StreamFlixStartupTask.EnsureUserLibraryAccessAndPermissions(user, primaryAdmin))
        {
            needsUpdate = true;
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
        var mappedProfile = MapProfilePublic(profile, guestCaller);

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

    private Task<(bool Allowed, bool IsKids, string DenyReason)> EvaluateSeerrPermissionAsync(
        PluginConfiguration config,
        CallerContext caller,
        string? requestedProfileId)
    {
        if (!HasHouseholdAccess(config, caller))
        {
            return Task.FromResult((false, false, "Sign in to StreamFlix first."));
        }

        if (!StreamFlixSeerrService.IsConfigured(config))
        {
            return Task.FromResult((false, false, "Seerr / Jellyseerr integration is not enabled on this server."));
        }

        var isGuest = IsGuestSession(caller);
        if (isGuest && !config.SeerrAllowGuests)
        {
            return Task.FromResult((false, false, "Media requests are disabled for Guest Pass sessions."));
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
            return Task.FromResult((false, true, "Media requests are disabled for Kids profiles."));
        }

        return Task.FromResult((true, isKids, string.Empty));
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

    private object ComputeMovieNightCandidates(
        List<StreamFlixProfileConfig> selectedProfiles,
        MovieNightCandidatesRequest request)
    {
        var candidates = new List<(double Score, string GenreCsv, object Dto)>();
        var allGenres = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totalLibraryMatched = 0;

        try
        {
            var watcherPairs = new List<(StreamFlixProfileConfig Profile, JUser? User, int? ParentalAge)>();
            int? strictestAge = null;
            JUser? mostRestrictedUser = null;

            foreach (var p in selectedProfiles)
            {
                JUser? u = null;
                if (!string.IsNullOrWhiteSpace(p.JellyfinUserId) && Guid.TryParse(p.JellyfinUserId, out var uid))
                {
                    u = _userManager.GetUserById(uid);
                }

                var age = IsProfileLinkedToAdmin(p)
                    ? null
                    : StreamFlixStartupTask.ParentalAgeFromMaturity(p.MaturityRating, p.IsKids);
                if (age.HasValue && (!strictestAge.HasValue || age.Value < strictestAge.Value))
                {
                    strictestAge = age.Value;
                    if (u != null)
                    {
                        mostRestrictedUser = u;
                    }
                }
                else if (mostRestrictedUser == null && u != null && !StreamFlixStartupTask.IsUserAdminCompat(u))
                {
                    mostRestrictedUser = u;
                }

                watcherPairs.Add((p, u, age));
            }

            mostRestrictedUser ??= watcherPairs.Select(w => w.User).FirstOrDefault(u => u != null);

            var queryType = typeof(ILibraryManager).Assembly.GetType("MediaBrowser.Controller.Entities.InternalItemsQuery");
            var getItemList = queryType != null ? typeof(ILibraryManager).GetMethod("GetItemList", new[] { queryType }) : null;
            if (queryType == null || getItemList == null)
            {
                return new { candidates = Array.Empty<object>(), availableGenres = Array.Empty<string>(), bracketSize = 0, totalMatched = 0 };
            }

            var userCtor = mostRestrictedUser != null ? queryType.GetConstructor(new[] { mostRestrictedUser.GetType() }) : null;
            var query = userCtor != null && mostRestrictedUser != null
                ? userCtor.Invoke(new object[] { mostRestrictedUser })
                : Activator.CreateInstance(queryType);
            if (query == null)
            {
                return new { candidates = Array.Empty<object>(), availableGenres = Array.Empty<string>(), bracketSize = 0, totalMatched = 0 };
            }

            if (userCtor == null && mostRestrictedUser != null)
            {
                queryType.GetProperty("User")?.SetValue(query, mostRestrictedUser);
            }

            queryType.GetProperty("Recursive")?.SetValue(query, true);
            queryType.GetProperty("Limit")?.SetValue(query, 800);

            var mediaTypeMode = (request.MediaType ?? "all").Trim().ToLowerInvariant();
            var includeProp = queryType.GetProperty("IncludeItemTypes");
            var elemType = includeProp?.PropertyType.IsArray == true ? includeProp.PropertyType.GetElementType() : null;
            if (elemType != null && elemType.IsEnum)
            {
                var desiredTypeNames = mediaTypeMode switch
                {
                    "movie" or "movies" => new[] { "Movie" },
                    "series" or "tv" => new[] { "Series" },
                    _ => new[] { "Movie", "Series" },
                };

                var parsedEnums = new List<object>();
                foreach (var tn in desiredTypeNames)
                {
                    if (Enum.TryParse(elemType, tn, ignoreCase: true, out var val) && val != null)
                    {
                        parsedEnums.Add(val);
                    }
                }

                if (parsedEnums.Count > 0)
                {
                    var arr = Array.CreateInstance(elemType, parsedEnums.Count);
                    for (var i = 0; i < parsedEnums.Count; i++)
                    {
                        arr.SetValue(parsedEnums[i], i);
                    }

                    includeProp!.SetValue(query, arr);
                }
            }

            var getUserDataMethod = typeof(IUserDataManager).GetMethods()
                .FirstOrDefault(m => m.Name == "GetUserData" && m.GetParameters().Length == 2)
                ?? _userDataManager.GetType().GetMethods()
                    .FirstOrDefault(m => m.Name == "GetUserData" && m.GetParameters().Length == 2);

            var requestedGenre = (request.Genre ?? string.Empty).Trim();
            if (string.Equals(requestedGenre, "all", StringComparison.OrdinalIgnoreCase))
            {
                requestedGenre = string.Empty;
            }

            var maxRuntime = request.MaxRuntimeMinutes > 0 ? request.MaxRuntimeMinutes : 0;

            if (getItemList.Invoke(_libraryManager, new[] { query }) is System.Collections.IEnumerable rawItems)
            {
                foreach (var item in rawItems)
                {
                    if (item == null)
                    {
                        continue;
                    }

                    var it = item.GetType();
                    var typeName = it.Name;
                    if (!string.Equals(typeName, "Movie", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(typeName, "Series", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (it.GetProperty("Id")?.GetValue(item) is not Guid id || id == Guid.Empty)
                    {
                        continue;
                    }

                    var officialRating = (it.GetProperty("OfficialRating")?.GetValue(item)?.ToString() ?? string.Empty).Trim();
                    if (strictestAge.HasValue && !IsOfficialRatingAllowedForAge(officialRating, strictestAge.Value))
                    {
                        continue;
                    }

                    var runTimeMinutes = 0;
                    if (it.GetProperty("RunTimeTicks")?.GetValue(item) is long ticks && ticks > 0)
                    {
                        runTimeMinutes = (int)Math.Round(ticks / 600_000_000.0);
                    }

                    if (maxRuntime > 0
                        && string.Equals(typeName, "Movie", StringComparison.OrdinalIgnoreCase)
                        && runTimeMinutes > maxRuntime)
                    {
                        continue;
                    }

                    // Check watch state & My List status across every selected watcher
                    var playedByAny = false;
                    var favoritedBy = new List<string>();
                    foreach (var (prof, u, _) in watcherPairs)
                    {
                        if (u == null || getUserDataMethod == null)
                        {
                            continue;
                        }

                        try
                        {
                            var firstParamType = getUserDataMethod.GetParameters()[0].ParameterType;
                            var arg0 = firstParamType == typeof(Guid) ? (object)u.Id : u;
                            var ud = getUserDataMethod.Invoke(_userDataManager, new[] { arg0, item });
                            if (ud != null)
                            {
                                var udt = ud.GetType();
                                var pl = udt.GetProperty("Played")?.GetValue(ud) is bool bPl && bPl;
                                var pc = udt.GetProperty("PlayCount")?.GetValue(ud) is int iPc ? iPc : 0;
                                if (pl || pc > 0)
                                {
                                    playedByAny = true;
                                    if (request.OnlyUnwatched)
                                    {
                                        break;
                                    }
                                }

                                if (udt.GetProperty("IsFavorite")?.GetValue(ud) is bool bFav && bFav)
                                {
                                    favoritedBy.Add(prof.Name);
                                }
                            }
                        }
                        catch
                        {
                        }
                    }

                    if (request.OnlyUnwatched && playedByAny)
                    {
                        continue;
                    }

                    var itemGenres = new List<string>();
                    if (it.GetProperty("Genres")?.GetValue(item) is IEnumerable<string> gEnum)
                    {
                        foreach (var g in gEnum)
                        {
                            if (!string.IsNullOrWhiteSpace(g))
                            {
                                var cg = g.Trim();
                                itemGenres.Add(cg);
                                allGenres.Add(cg);
                            }
                        }
                    }

                    if (!string.IsNullOrEmpty(requestedGenre)
                        && !itemGenres.Any(g => string.Equals(g, requestedGenre, StringComparison.OrdinalIgnoreCase)))
                    {
                        continue;
                    }

                    totalLibraryMatched++;

                    var name = it.GetProperty("Name")?.GetValue(item)?.ToString() ?? "Untitled";
                    var year = it.GetProperty("ProductionYear")?.GetValue(item) is int yr && yr > 1880 ? yr : (int?)null;
                    var communityRating = it.GetProperty("CommunityRating")?.GetValue(item) switch
                    {
                        float f => Math.Round(f, 1),
                        double d => Math.Round(d, 1),
                        _ => 0.0,
                    };
                    var overview = (it.GetProperty("Overview")?.GetValue(item)?.ToString() ?? string.Empty).Trim();
                    string? tagline = null;
                    if (it.GetProperty("Taglines")?.GetValue(item) is IEnumerable<string> tags)
                    {
                        tagline = tags.FirstOrDefault(t => !string.IsNullOrWhiteSpace(t))?.Trim();
                    }

                    var hasBackdrop = it.GetProperty("BackdropImageTags")?.GetValue(item) is System.Collections.ICollection bdCol && bdCol.Count > 0;
                    var hasLogo = false;
                    if (it.GetProperty("ImageTags")?.GetValue(item) is System.Collections.IDictionary imgDict)
                    {
                        foreach (var k in imgDict.Keys)
                        {
                            if (string.Equals(k?.ToString(), "Logo", StringComparison.OrdinalIgnoreCase))
                            {
                                hasLogo = true;
                                break;
                            }
                        }
                    }

                    var score = (favoritedBy.Count * 24.0)
                        + (communityRating * 1.5)
                        + (playedByAny ? -12.0 : 6.0)
                        + (Random.Shared.NextDouble() * 20.0);

                    var dto = new
                    {
                        id = id.ToString("N"),
                        name,
                        type = typeName,
                        year,
                        officialRating,
                        communityRating = communityRating > 0 ? (double?)communityRating : null,
                        runTimeMinutes = runTimeMinutes > 0 ? (int?)runTimeMinutes : null,
                        overview,
                        tagline,
                        genres = itemGenres.Take(4).ToArray(),
                        hasBackdrop,
                        hasLogo,
                        sharedFavoriteCount = favoritedBy.Count,
                        favoritedBy = favoritedBy.ToArray(),
                    };

                    candidates.Add((score, string.Join("|", itemGenres), dto));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: error computing Movie Night Matcher candidates.");
        }

        var desiredCount = Math.Clamp(request.Count <= 0 ? 8 : request.Count, 2, 16);
        var bracketSize = candidates.Count >= 8 && desiredCount >= 8
            ? 8
            : (candidates.Count >= 4 && desiredCount >= 4
                ? 4
                : (candidates.Count >= 2 ? 2 : candidates.Count));

        var picked = candidates
            .OrderByDescending(c => c.Score)
            .Take(bracketSize)
            .Select(c => c.Dto)
            .ToList();

        var sortedGenres = allGenres
            .OrderBy(g => g, StringComparer.OrdinalIgnoreCase)
            .Take(40)
            .ToArray();

        return new
        {
            candidates = picked,
            bracketSize,
            totalMatched = totalLibraryMatched,
            availableGenres = sortedGenres,
            watchers = selectedProfiles.Select(p => new
            {
                id = p.Id,
                name = p.Name,
                avatarEmoji = p.AvatarEmoji,
                avatarColorHex = SanitizeHexColor(p.AvatarColorHex),
            }).ToArray(),
        };
    }

    private static bool IsOfficialRatingAllowedForAge(string officialRating, int maxAge)
    {
        if (string.IsNullOrWhiteSpace(officialRating))
        {
            return maxAge >= 13;
        }

        var r = officialRating.Trim().ToUpperInvariant();
        var requiredAge = r switch
        {
            "G" or "TV-Y" or "TV-G" or "U" or "ALL" or "APPROVED" => 0,
            "TV-Y7" or "TV-Y7-FV" or "PG" or "TV-PG" or "7" or "10" => 8,
            "PG-13" or "TV-14" or "12" or "12A" or "13" or "14" or "14A" => 13,
            "R" or "TV-MA" or "15" or "16" or "17" or "18" or "MA15+" => 17,
            "NC-17" or "X" or "XXX" or "AO" or "R18+" => 21,
            _ => 13,
        };
        return requiredAge <= maxAge;
    }

    private ActionResult ServeAsset(EmbeddedAsset asset, string contentType)
    {
        var requestedVer = Request.Query["v"].ToString();
        Response.Headers["Cache-Control"] = !string.IsNullOrEmpty(requestedVer)
            && string.Equals(requestedVer, Plugin.AssetCacheVersion, StringComparison.Ordinal)
            ? "public, max-age=86400"
            : "no-cache";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["ETag"] = asset.ETag;

        var ifNoneMatch = Request.Headers["If-None-Match"].ToString();
        if (!string.IsNullOrEmpty(ifNoneMatch) && ifNoneMatch.Contains(asset.ETag, StringComparison.Ordinal))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }

        return Content(asset.Content, contentType);
    }

    private sealed record CallerContext(
        StreamFlixSessionService.SessionInfo? Session,
        bool IsJellyfinAuthenticated,
        bool IsAdmin,
        bool IsLocalLan = false,
        JUser? JellyfinUser = null);

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
