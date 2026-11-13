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
        Plugin.Instance?.EnsureInjectedThrottled();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        await SyncProfilesAsync(config, force: false).ConfigureAwait(false);
        return Ok(BuildPublicState(config, caller));
    }

    [HttpPost("SetupSecrets")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SetupSecrets([FromBody] SetupSecretsRequest? request)
    {
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
        var deviceId = !string.IsNullOrWhiteSpace(request?.DeviceId) ? request!.DeviceId!.Trim() : $"streamflix-profile-{profile.Id}";
        var deviceName = !string.IsNullOrWhiteSpace(request?.DeviceName) ? request!.DeviceName!.Trim() : $"StreamFlix ({profile.Name})";

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
    public async Task<ActionResult<object>> VerifyPin([FromBody] VerifyPinRequest? request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
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
    public async Task<ActionResult<object>> ReorderProfiles([FromBody] ReorderProfilesRequest? request)
    {
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
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
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
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

    private static bool IsGateUnconfigured(PluginConfiguration config)
    {
        return config.RequireGoogleAuth
            && (!config.EnableGoogleSignIn || string.IsNullOrWhiteSpace(config.GoogleClientId))
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
        var msg = cfg.EnableGoogleSignIn && cfg.AllowStandardJellyfinLogin
            ? "Please sign in with Google or your Jellyfin account to continue."
            : (cfg.AllowStandardJellyfinLogin && !cfg.EnableGoogleSignIn
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
        }

        var isAuthenticated = false;
        var isAdmin = sessionIsAdmin;
        try
        {
            var info = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (info != null && info.IsAuthenticated && (info.IsApiKey || !StreamFlixStartupTask.IsUserDisabledCompat(info.User)))
            {
                isAuthenticated = true;
                isAdmin = isAdmin || info.IsApiKey || StreamFlixStartupTask.IsUserAdminCompat(info.User);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: could not read Jellyfin authorization info.");
        }

        return new CallerContext(session, isAuthenticated, isAdmin, isLocalLan);
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
        var approvedSnapshot = (config.ApprovedGoogleAccounts ?? new List<string>()).ToList();
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
            allowStandardJellyfinLogin = config.AllowStandardJellyfinLogin,
            allowAdminFallbackLogin = config.AllowAdminFallbackLogin,
            adminFallbackLanOnly = config.AdminFallbackLanOnly,
            bypassLoginGateOnLan = config.BypassLoginGateOnLan,
            isLocalLan = caller.IsLocalLan,
            canShowAdminFallback,
            googleClientId = caller.IsAdmin || config.EnableGoogleSignIn ? config.GoogleClientId : string.Empty,
            googleConfigured = !string.IsNullOrWhiteSpace(config.GoogleClientId),
            hasGoogleClientSecret = !string.IsNullOrWhiteSpace(config.GoogleClientSecret),
            hasAccess,
            isAdmin = caller.IsAdmin,
            session = caller.Session == null
                ? null
                : new
                {
                    authKind = caller.Session.AuthKind,
                    email = caller.Session.Email,
                    username = caller.Session.Username,
                    userId = caller.Session.JellyfinUserId,
                    expiresAt = caller.Session.ExpiresAt,
                },
            top10SelectionMode = NormalizeTop10Mode(config.Top10SelectionMode),
            heroRotationSeconds = Math.Clamp(config.HeroRotationSeconds, 0, 120),
            heroSlideCount = Math.Clamp(config.HeroSlideCount <= 0 ? 8 : config.HeroSlideCount, 1, 15),
            heroSelectionMode = NormalizeHeroSelectionMode(config.HeroSelectionMode),
            heroContentType = NormalizeHeroContentType(config.HeroContentType),
            heroLibraryIds = heroLibrariesSnapshot,
            approvedGoogleAccounts = hasAccess && caller.IsAdmin ? approvedSnapshot : new List<string>(),
            serverUsers,
            profiles = hasAccess ? profilesSnapshot.Select(p => MapProfilePublic(p, caller)).ToList() : new List<object>(),
            showcaseItems = hasAccess ? GetShowcaseItemsCached(_libraryManager) : new List<object>(),
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
            avatarColorHex = SanitizeHexColor(p.AvatarColorHex),
            isKids = p.IsKids,
            isAdmin,
            isOwner = StreamFlixStartupTask.IsOwnerProfile(p),
            maturityRating = p.MaturityRating,
            hasPin = !string.IsNullOrWhiteSpace(p.PinCode),
            pinLength = string.IsNullOrWhiteSpace(p.PinCode) ? 0 : p.PinCode.Trim().Length,
            googleLocked = lockEmail != null,
            googleAccountEmail = lockEmail != null && (caller.IsAdmin || callerOwnsLock) ? lockEmail : null,
            googleAccountHint = lockEmail != null ? StreamFlixSessionService.MaskEmail(lockEmail) : null,
            googleLockSatisfied = lockEmail == null || callerOwnsLock || caller.IsAdmin,
            autoplayNextEpisode = p.AutoplayNextEpisode,
            autoplayPreviews = p.AutoplayPreviews,
            jellyfinUserId = p.JellyfinUserId,
            jellyfinUsername = p.JellyfinUsername,
        };
    }

    private ActionResult ServeAsset(EmbeddedAsset asset, string contentType)
    {
        var requestedVer = Request.Query["v"].ToString();
        Response.Headers["Cache-Control"] = !string.IsNullOrEmpty(requestedVer)
            && string.Equals(requestedVer, Plugin.AssetCacheVersion, StringComparison.Ordinal)
            ? "public, max-age=86400"
            : "no-cache";
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
        bool IsLocalLan = false);

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
