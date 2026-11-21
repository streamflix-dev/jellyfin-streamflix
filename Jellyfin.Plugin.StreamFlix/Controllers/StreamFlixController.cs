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
[StreamFlixErrorEnvelope]
public partial class StreamFlixController : ControllerBase
{
    private const int MaxProfilesCount = 24;
    private const int MaxStoredGuestPasses = 100;
    private const int MaxActiveGuestPasses = 50;

    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(8) };

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

    private static int _showcaseRefreshInFlight;

    private static int _popularRefreshInFlight;

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
        return ServeAsset(Plugin.GetEmbeddedScriptBundle(), "application/javascript; charset=utf-8");
    }

    [HttpGet("ClientStyles")]
    [AllowAnonymous]
    public ActionResult GetClientStyles()
    {
        return ServeAsset(Plugin.GetEmbeddedStylesheetBundle(), "text/css; charset=utf-8");
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
        if (HasHouseholdAccess(config, caller))
        {
            await SyncProfilesAsync(config, force: false).ConfigureAwait(false);
        }

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
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can read StreamFlix admin configuration." });
        }

        return Ok(BuildAdminConfigResponse(config));
    }

    [HttpGet("AdminPageHtml")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetAdminPageHtml()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can open StreamFlix settings." });
        }

        return Ok(new { html = Plugin.GetEmbeddedConfigPageBundle().Text });
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
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can update StreamFlix settings." });
        }

        List<string>? guestPassIdsToDisconnect = null;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            config.EnableStreamFlixUi = request.EnableStreamFlixUi;
            var brand = (request.CustomBrandName ?? string.Empty).Trim();
            config.CustomBrandName = brand.Length > 32 ? brand.Substring(0, 32).Trim() : brand;
            if (!string.IsNullOrWhiteSpace(request.CustomAccentColor))
            {
                config.CustomAccentColor = SanitizeHexColor(request.CustomAccentColor);
            }

            // Household sign-in before "Who's watching?" is always enforced for security
            config.RequireGoogleAuth = true;
            config.EnableGoogleSignIn = request.EnableGoogleSignIn;
            config.AllowStandardJellyfinLogin = request.AllowStandardJellyfinLogin;
            config.AllowAdminFallbackLogin = request.AllowAdminFallbackLogin;
            config.AdminFallbackLanOnly = request.AdminFallbackLanOnly;
            config.BypassLoginGateOnLan = request.BypassLoginGateOnLan;
            if (request.TreatTailscaleAsLocalLan.HasValue)
            {
                config.TreatTailscaleAsLocalLan = request.TreatTailscaleAsLocalLan.Value;
            }

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

            config.ShowLibrariesInNav = request.ShowLibrariesInNav;
            if (request.NavHiddenBuiltIns != null)
            {
                config.NavHiddenBuiltIns = NormalizeNavHiddenBuiltIns(request.NavHiddenBuiltIns);
            }

            if (request.NavLibraryIds != null)
            {
                config.NavLibraryIds = request.NavLibraryIds
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Select(id => id.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            config.EnableHeroTrailerPreview = request.EnableHeroTrailerPreview;
            config.MigratedHeroYouTubeTrailers = true;
            if (request.HomeRowOrder != null)
            {
                config.HomeRowOrder = NormalizeHomeRowIds(request.HomeRowOrder);
            }

            if (request.HomeHiddenRows != null)
            {
                config.HomeHiddenRows = NormalizeHomeRowIds(request.HomeHiddenRows);
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
            StreamFlixSeerrService.ResetTransientCaches();

            var wasGuestPassesEnabled = config.EnableGuestPasses;
            config.EnableGuestPasses = request.EnableGuestPasses;
            if (request.GuestPassManagerProfileIds != null)
            {
                var eligibleIds = new HashSet<string>(
                    (config.Profiles ?? new List<StreamFlixProfileConfig>())
                        .Where(p => !p.IsKids && !IsProfileLinkedToAdmin(p) && !string.IsNullOrWhiteSpace(p.Id))
                        .Select(p => p.Id.Trim()),
                    StringComparer.OrdinalIgnoreCase);
                config.GuestPassManagerProfileIds = request.GuestPassManagerProfileIds
                    .Where(id => !string.IsNullOrWhiteSpace(id) && eligibleIds.Contains(id.Trim()))
                    .Select(id => id.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            config.EnableWatchTogether = request.EnableWatchTogether;
            config.EnableLiveTv = request.EnableLiveTv;

            Plugin.Instance?.SaveConfiguration();
            if (StreamFlixOidcService.IsConfigured(config))
            {
                StreamFlixOidcService.WarmDiscoveryInBackground(config);
            }
            if (wasGuestPassesEnabled && !config.EnableGuestPasses && config.GuestPasses != null)
            {
                guestPassIdsToDisconnect = config.GuestPasses
                    .Where(gp => !string.IsNullOrWhiteSpace(gp.Id))
                    .Select(gp => gp.Id)
                    .ToList();
            }
        }
        finally
        {
            SyncLock.Release();
        }

        if (guestPassIdsToDisconnect != null)
        {
            foreach (var gpId in guestPassIdsToDisconnect)
            {
                await RevokeGuestJellyfinSessionsAsync(gpId).ConfigureAwait(false);
            }
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
        if (!IsEffectiveActiveAdmin(caller))
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

        config.RequireGoogleAuth = true;

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

    private static bool IsGateUnconfigured(PluginConfiguration config)
    {
        return (!config.EnableGoogleSignIn || string.IsNullOrWhiteSpace(config.GoogleClientId))
            && !StreamFlixOidcService.IsConfigured(config)
            && !config.AllowStandardJellyfinLogin;
    }

    private static bool IsJellyfinUserHouseholdMember(PluginConfiguration config, JUser? user)
    {
        if (user == null || StreamFlixStartupTask.IsUserDisabledCompat(user))
        {
            return false;
        }

        if (StreamFlixStartupTask.IsUserAdminCompat(user))
        {
            return true;
        }

        return (config.Profiles ?? new List<StreamFlixProfileConfig>())
            .Any(p => !string.IsNullOrWhiteSpace(p.JellyfinUserId)
                && Guid.TryParse(p.JellyfinUserId, out var linkedUid)
                && linkedUid == user.Id);
    }

    private static bool HasHouseholdAccess(PluginConfiguration config, CallerContext caller)
    {
        if (caller.IsAdmin)
        {
            return true;
        }

        if (IsGateUnconfigured(config))
        {
            return false;
        }

        return (config.BypassLoginGateOnLan && caller.IsLocalLan)
            || caller.Session != null
            || (config.AllowStandardJellyfinLogin
                && caller.IsJellyfinAuthenticated
                && IsJellyfinUserHouseholdMember(config, caller.JellyfinUser));
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

    private async Task<CallerContext> GetCallerAsync(PluginConfiguration config)
    {
        var isLocalLan = StreamFlixSessionService.IsLocalLanRequest(HttpContext, config.TreatTailscaleAsLocalLan);
        var token = Request.Headers[StreamFlixSessionService.HeaderName].FirstOrDefault();
        var session = StreamFlixSessionService.Validate(config, token);
        var sessionIsAdmin = false;

        if (session != null)
        {
            if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindGoogle, StringComparison.Ordinal))
            {
                if (!config.EnableGoogleSignIn)
                {
                    session = null;
                }
                else if (IsVerifiedSsoAdminOwner(config, session))
                {
                    sessionIsAdmin = true;
                }
            }
            else if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal))
            {
                if (!StreamFlixOidcService.IsConfigured(config))
                {
                    session = null;
                }
                else if (IsVerifiedSsoAdminOwner(config, session))
                {
                    sessionIsAdmin = true;
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
                    else if (!config.AllowStandardJellyfinLogin || !IsJellyfinUserHouseholdMember(config, u))
                    {
                        session = null;
                    }
                }
            }
            else if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindGuestPass, StringComparison.Ordinal))
            {
                if (!config.EnableGuestPasses)
                {
                    session = null;
                }
                else
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
        }

        var isAuthenticated = false;
        var isAdmin = sessionIsAdmin;
        JUser? jellyfinAuthUser = null;
        try
        {
            var info = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (info != null && info.IsAuthenticated && (info.IsApiKey || !StreamFlixStartupTask.IsUserDisabledCompat(info.User)))
            {
                var isOrphanGuestDevice = !info.IsApiKey
                    && session == null
                    && !string.IsNullOrEmpty(info.DeviceId)
                    && info.DeviceId.StartsWith("streamflix-guest-", StringComparison.OrdinalIgnoreCase);
                if (isOrphanGuestDevice)
                {
                    if (!string.IsNullOrWhiteSpace(info.Token))
                    {
                        await LogoutSingleJellyfinTokenAsync(info.Token).ConfigureAwait(false);
                    }
                }
                else
                {
                    isAuthenticated = true;
                    jellyfinAuthUser = info.User;
                    isAdmin = isAdmin || info.IsApiKey || StreamFlixStartupTask.IsUserAdminCompat(info.User);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: could not read Jellyfin authorization info.");
        }

        return new CallerContext(session, isAuthenticated, isAdmin, isLocalLan, jellyfinAuthUser);
    }

    private object BuildPublicState(PluginConfiguration config, CallerContext caller)
    {
        var hasAccess = HasHouseholdAccess(config, caller);
        var isGuestPass = IsGuestSession(caller);
        var isUnconfiguredGate = IsGateUnconfigured(config);
        var canShowAdminFallback = isUnconfiguredGate
            || (config.AllowAdminFallbackLogin && (!config.AdminFallbackLanOnly || caller.IsLocalLan));
        var effectiveAdmin = IsEffectiveActiveAdmin(caller);

        // The full Jellyfin user list is only needed (and only shown) to active administrators choosing a profile's account.
        var serverUsers = hasAccess && effectiveAdmin
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
        else if (!caller.IsAdmin)
        {
            var isLanBypassOnly = caller.Session == null && config.BypassLoginGateOnLan && caller.IsLocalLan;
            var isNonAdminJfSession = (caller.Session != null && string.Equals(caller.Session.AuthKind, StreamFlixSessionService.AuthKindJellyfin, StringComparison.Ordinal))
                || (caller.Session == null && !isLanBypassOnly && caller.IsJellyfinAuthenticated && caller.JellyfinUser != null);
            if (isNonAdminJfSession)
            {
                Guid? scopedUid = null;
                if (caller.Session != null && Guid.TryParse(caller.Session.JellyfinUserId, out var parsedSessUid))
                {
                    scopedUid = parsedSessUid;
                }
                else if (caller.JellyfinUser != null)
                {
                    scopedUid = caller.JellyfinUser.Id;
                }

                profilesSnapshot = scopedUid.HasValue
                    ? profilesSnapshot
                        .Where(p => !IsProfileLinkedToAdmin(p)
                            && !string.IsNullOrWhiteSpace(p.JellyfinUserId)
                            && Guid.TryParse(p.JellyfinUserId, out var pUid)
                            && pUid == scopedUid.Value)
                        .ToList()
                    : new List<StreamFlixProfileConfig>();
            }
        }

        var activeGuestPass = isGuestPass && !string.IsNullOrWhiteSpace(caller.Session?.GuestPassId)
            ? (config.GuestPasses ?? new List<StreamFlixGuestPass>())
                .FirstOrDefault(g => string.Equals(g.Id, caller.Session!.GuestPassId, StringComparison.Ordinal))
            : null;

        var approvedSnapshot = (config.ApprovedGoogleAccounts ?? new List<string>()).ToList();
        var approvedOidcSnapshot = (config.ApprovedOidcUsers ?? new List<string>()).ToList();
        var oidcConfigured = StreamFlixOidcService.IsConfigured(config);
        var oidcProviderName = StreamFlixOidcService.GetDisplayProviderName(config);
        if (oidcConfigured && !hasAccess)
        {
            StreamFlixOidcService.WarmDiscoveryInBackground(config);
        }
        var seerrConfigured = StreamFlixSeerrService.IsConfigured(config);
        var seerrEnabled = hasAccess && seerrConfigured && (!isGuestPass || config.SeerrAllowGuests);
        var heroLibrariesSnapshot = (config.HeroLibraryIds ?? new List<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var navHiddenBuiltInsSnapshot = (config.NavHiddenBuiltIns ?? new List<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim().ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var navLibraryIdsSnapshot = (config.NavLibraryIds ?? new List<string>())
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
            customAccentColor = SanitizeHexColor(config.CustomAccentColor),
            enableStreamFlixUi = config.EnableStreamFlixUi,
            requireGoogleAuth = true,
            enableGoogleSignIn = config.EnableGoogleSignIn,
            enableCustomOidc = config.EnableCustomOidc,
            oidcConfigured,
            oidcProviderName,
            oidcRequireAllowlist = config.OidcRequireAllowlist,
            hasOidcClientSecret = effectiveAdmin && !string.IsNullOrWhiteSpace(config.OidcClientSecret),
            allowStandardJellyfinLogin = config.AllowStandardJellyfinLogin,
            allowAdminFallbackLogin = config.AllowAdminFallbackLogin,
            adminFallbackLanOnly = config.AdminFallbackLanOnly,
            bypassLoginGateOnLan = config.BypassLoginGateOnLan,
            treatTailscaleAsLocalLan = config.TreatTailscaleAsLocalLan,
            isLocalLan = caller.IsLocalLan,
            canShowAdminFallback,
            googleClientId = effectiveAdmin || config.EnableGoogleSignIn ? config.GoogleClientId : string.Empty,
            googleConfigured = !string.IsNullOrWhiteSpace(config.GoogleClientId),
            hasGoogleClientSecret = effectiveAdmin && !string.IsNullOrWhiteSpace(config.GoogleClientSecret),
            hasAccess,
            isAdmin = effectiveAdmin,
            enableGuestPasses = config.EnableGuestPasses,
            guestPassManagerProfileIds = hasAccess && effectiveAdmin ? (config.GuestPassManagerProfileIds ?? new List<string>()).ToList() : new List<string>(),
            enableWatchTogether = config.EnableWatchTogether,
            enableLiveTv = config.EnableLiveTv,
            hasAnyAdultPin = hasAccess && !isGuestPass && (config.Profiles ?? new List<StreamFlixProfileConfig>()).Any(p => !p.IsKids && !string.IsNullOrWhiteSpace(p.PinCode)),
            isGuestPass,
            guestPassLabel = activeGuestPass?.Label,
            guestPassExpiresAt = activeGuestPass?.ExpiresAtUtc ?? caller.Session?.ExpiresAt.ToString("O"),
            lockedProfileId = isGuestPass ? caller.Session?.LockedProfileId : null,
            seerrConfigured = effectiveAdmin && seerrConfigured,
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
            enableHeroTrailerPreview = config.EnableHeroTrailerPreview,
            homeRowOrder = NormalizeHomeRowIds(config.HomeRowOrder),
            homeHiddenRows = NormalizeHomeRowIds(config.HomeHiddenRows),
            showLibrariesInNav = config.ShowLibrariesInNav,
            navHiddenBuiltIns = navHiddenBuiltInsSnapshot,
            navLibraryIds = navLibraryIdsSnapshot,
            approvedGoogleAccounts = hasAccess && effectiveAdmin ? approvedSnapshot : new List<string>(),
            approvedOidcUsers = hasAccess && effectiveAdmin ? approvedOidcSnapshot : new List<string>(),
            serverUsers,
            serverLibraries = hasAccess ? JellyfinCompat.GetServerMediaLibraries(_libraryManager) : new List<object>(),
            profiles = hasAccess ? profilesSnapshot.Select(p => MapProfilePublic(config, p, caller)).ToList() : new List<object>(),
            showcaseItems = hasAccess && !isGuestPass ? GetShowcaseItemsCached(_libraryManager) : new List<object>(),
        };
    }

    internal static List<string> NormalizeNavHiddenBuiltIns(IEnumerable<string?>? raw)
    {
        if (raw == null)
        {
            return new List<string>();
        }

        var allowedBuiltIns = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "series",
            "movies",
            "hot",
            "livetv",
            "collections",
            "top10",
            "mylist",
        };
        return raw
            .Where(id => !string.IsNullOrWhiteSpace(id) && allowedBuiltIns.Contains(id!.Trim()))
            .Select(id => id!.Trim().ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    internal static List<string> NormalizeHomeRowIds(IEnumerable<string?>? raw)
    {
        if (raw == null)
        {
            return new List<string>();
        }

        var allowedRowIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "resume",
            "nextup",
            "livetv",
            "personal",
            "top10",
            "mylist",
            "acclaimed",
            "movies",
            "series",
            "gems",
            "collections",
            "watchagain",
        };
        return raw
            .Where(id => !string.IsNullOrWhiteSpace(id) && allowedRowIds.Contains(id!.Trim()))
            .Select(id => id!.Trim().ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private void SetNoStoreSecurityHeaders()
    {
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    private static object BuildAdminConfigResponse(PluginConfiguration config)
    {
        return new
        {
            version = Plugin.VersionString,
            enableStreamFlixUi = config.EnableStreamFlixUi,
            customBrandName = config.CustomBrandName ?? string.Empty,
            customAccentColor = SanitizeHexColor(config.CustomAccentColor),
            requireGoogleAuth = true,
            enableGoogleSignIn = config.EnableGoogleSignIn,
            allowStandardJellyfinLogin = config.AllowStandardJellyfinLogin,
            allowAdminFallbackLogin = config.AllowAdminFallbackLogin,
            adminFallbackLanOnly = config.AdminFallbackLanOnly,
            bypassLoginGateOnLan = config.BypassLoginGateOnLan,
            treatTailscaleAsLocalLan = config.TreatTailscaleAsLocalLan,
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
            enableHeroTrailerPreview = config.EnableHeroTrailerPreview,
            homeRowOrder = NormalizeHomeRowIds(config.HomeRowOrder),
            homeHiddenRows = NormalizeHomeRowIds(config.HomeHiddenRows),
            showLibrariesInNav = config.ShowLibrariesInNav,
            navHiddenBuiltIns = (config.NavHiddenBuiltIns ?? new List<string>()).ToList(),
            navLibraryIds = (config.NavLibraryIds ?? new List<string>()).ToList(),
            enableCustomOidc = config.EnableCustomOidc,
            oidcProviderName = config.OidcProviderName ?? string.Empty,
            oidcIssuerUrl = config.OidcIssuerUrl ?? string.Empty,
            oidcClientId = config.OidcClientId ?? string.Empty,
            hasOidcClientSecret = !string.IsNullOrWhiteSpace(config.OidcClientSecret),
            oidcRequireAllowlist = config.OidcRequireAllowlist,
            approvedOidcUsers = (config.ApprovedOidcUsers ?? new List<string>()).ToList(),
            enableGuestPasses = config.EnableGuestPasses,
            guestPassManagerProfileIds = (config.GuestPassManagerProfileIds ?? new List<string>()).ToList(),
            enableWatchTogether = config.EnableWatchTogether,
            enableLiveTv = config.EnableLiveTv,
            enableSeerr = config.EnableSeerr,
            seerrUrl = config.SeerrUrl ?? string.Empty,
            hasSeerrApiKey = !string.IsNullOrWhiteSpace(config.SeerrApiKey),
            seerrAllowKids = config.SeerrAllowKids,
            seerrAllowGuests = config.SeerrAllowGuests,
        };
    }

    private ActionResult ServeAsset((string Text, byte[] Bytes, string ETag) asset, string contentType)
    {
        // Always use ETag revalidation ("no-cache") rather than long-lived immutable caching so disabling the plugin
        // in Jellyfin immediately causes browsers to revalidate and stop executing cached StreamFlix assets.
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["ETag"] = asset.ETag;

        var ifNoneMatch = Request.Headers["If-None-Match"].ToString();
        if (!string.IsNullOrEmpty(ifNoneMatch) && ifNoneMatch.Contains(asset.ETag, StringComparison.Ordinal))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }

        return Content(asset.Text, contentType);
    }

    private sealed record CallerContext(
        StreamFlixSessionService.SessionInfo? Session,
        bool IsJellyfinAuthenticated,
        bool IsAdmin,
        bool IsLocalLan = false,
        JUser? JellyfinUser = null);
}
