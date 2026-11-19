using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;
using Jellyfin.Plugin.StreamFlix.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.StreamFlix.Controllers;

// Single-Request Home Hub Bootstrap & Portable JSON Configuration Backup / Restore
public partial class StreamFlixController
{
    [HttpGet("Hub/Bootstrap")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetHubBootstrap([FromQuery] string? profileId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (caller.JellyfinUser == null)
        {
            return StatusCode(401, new { code = "jellyfin_auth_required", message = "Active Jellyfin user session is required." });
        }

        StreamFlixProfileConfig? profile = null;
        if (IsGuestSession(caller))
        {
            profile = FindProfile(config, caller.Session?.LockedProfileId);
        }
        else if (IsEffectiveActiveAdmin(caller))
        {
            profile = FindProfile(config, profileId);
            if (profile == null)
            {
                var adminUid = caller.JellyfinUser.Id.ToString("N");
                profile = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                    .FirstOrDefault(p => string.Equals(p.JellyfinUserId, adminUid, StringComparison.OrdinalIgnoreCase));
            }
        }
        else
        {
            var callerUid = caller.JellyfinUser.Id.ToString("N");
            var requested = FindProfile(config, profileId);
            if (requested != null && string.Equals(requested.JellyfinUserId, callerUid, StringComparison.OrdinalIgnoreCase))
            {
                profile = requested;
            }
            else
            {
                profile = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                    .FirstOrDefault(p => string.Equals(p.JellyfinUserId, callerUid, StringComparison.OrdinalIgnoreCase));
            }
        }

        var scores = GetPopularScoresCached(_libraryManager, _userManager, _userDataManager);
        var payload = JellyfinCompat.BuildHubBootstrap(
            _libraryManager,
            _userDataManager,
            caller.JellyfinUser,
            _appHost.SystemId,
            profile?.AllowedLibraryIds,
            config.HeroLibraryIds,
            scores);

        return Ok(payload);
    }

    [HttpGet("AdminConfig/Export")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ExportAdminConfigBackup()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only an active Jellyfin administrator profile can export StreamFlix backups." });
        }

        var exportedProfiles = (config.Profiles ?? new List<StreamFlixProfileConfig>()).Select(p => new
        {
            id = p.Id,
            name = p.Name,
            avatarColorIndex = p.AvatarColorIndex,
            avatarIconIndex = p.AvatarIconIndex,
            avatarEmoji = p.AvatarEmoji,
            avatarColorHex = SanitizeHexColor(p.AvatarColorHex),
            isKids = p.IsKids,
            kidsExitPinRequired = p.KidsExitPinRequired,
            maturityRating = p.MaturityRating,
            pinCode = p.PinCode,
            googleAccountEmail = p.GoogleAccountEmail,
            accountLockKind = p.AccountLockKind,
            autoplayNextEpisode = p.AutoplayNextEpisode,
            autoplayPreviews = p.AutoplayPreviews,
            allowedLibraryIds = (p.AllowedLibraryIds ?? new List<string>()).ToList(),
            seerrRequestQuota = p.SeerrRequestQuota,
            bedtimeStart = p.BedtimeStart ?? string.Empty,
            bedtimeEnd = p.BedtimeEnd ?? string.Empty,
            jellyfinUsername = p.JellyfinUsername,
        }).ToList();

        return Ok(new
        {
            backupSchema = 1,
            exportedAtUtc = DateTime.UtcNow.ToString("O"),
            pluginVersion = Plugin.VersionString,
            enableStreamFlixUi = config.EnableStreamFlixUi,
            customBrandName = config.CustomBrandName ?? string.Empty,
            customAccentColor = SanitizeHexColor(config.CustomAccentColor),
            enableGoogleSignIn = config.EnableGoogleSignIn,
            allowStandardJellyfinLogin = config.AllowStandardJellyfinLogin,
            allowAdminFallbackLogin = config.AllowAdminFallbackLogin,
            adminFallbackLanOnly = config.AdminFallbackLanOnly,
            bypassLoginGateOnLan = config.BypassLoginGateOnLan,
            treatTailscaleAsLocalLan = config.TreatTailscaleAsLocalLan,
            autoProvisionJellyfinUsers = config.AutoProvisionJellyfinUsers,
            approvedGoogleAccounts = (config.ApprovedGoogleAccounts ?? new List<string>()).ToList(),
            sessionLifetimeDays = Math.Clamp(config.SessionLifetimeDays <= 0 ? 30 : config.SessionLifetimeDays, 1, 365),
            top10SelectionMode = NormalizeTop10Mode(config.Top10SelectionMode),
            heroRotationSeconds = Math.Clamp(config.HeroRotationSeconds, 0, 120),
            heroSlideCount = Math.Clamp(config.HeroSlideCount <= 0 ? 8 : config.HeroSlideCount, 1, 15),
            heroSelectionMode = NormalizeHeroSelectionMode(config.HeroSelectionMode),
            heroContentType = NormalizeHeroContentType(config.HeroContentType),
            heroLibraryIds = (config.HeroLibraryIds ?? new List<string>()).ToList(),
            showLibrariesInNav = config.ShowLibrariesInNav,
            navHiddenBuiltIns = (config.NavHiddenBuiltIns ?? new List<string>()).ToList(),
            navLibraryIds = (config.NavLibraryIds ?? new List<string>()).ToList(),
            enableCustomOidc = config.EnableCustomOidc,
            oidcProviderName = config.OidcProviderName ?? string.Empty,
            oidcIssuerUrl = config.OidcIssuerUrl ?? string.Empty,
            oidcClientId = config.OidcClientId ?? string.Empty,
            oidcRequireAllowlist = config.OidcRequireAllowlist,
            approvedOidcUsers = (config.ApprovedOidcUsers ?? new List<string>()).ToList(),
            enableGuestPasses = config.EnableGuestPasses,
            guestPassManagerProfileIds = (config.GuestPassManagerProfileIds ?? new List<string>()).ToList(),
            enableWatchTogether = config.EnableWatchTogether,
            enableSeerr = config.EnableSeerr,
            seerrUrl = config.SeerrUrl ?? string.Empty,
            seerrAllowKids = config.SeerrAllowKids,
            seerrAllowGuests = config.SeerrAllowGuests,
            profiles = exportedProfiles,
        });
    }

    [HttpPost("AdminConfig/Import")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ImportAdminConfigBackup([FromBody] ImportConfigBackupRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null)
        {
            return BadRequest(new { message = "Missing backup JSON payload." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only an active Jellyfin administrator profile can import StreamFlix backups." });
        }

        var importedProfilesCount = 0;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (request.EnableStreamFlixUi.HasValue)
            {
                config.EnableStreamFlixUi = request.EnableStreamFlixUi.Value;
            }

            if (request.CustomBrandName != null)
            {
                var brand = request.CustomBrandName.Trim();
                config.CustomBrandName = brand.Length > 32 ? brand.Substring(0, 32).Trim() : brand;
            }

            if (request.CustomAccentColor != null)
            {
                config.CustomAccentColor = SanitizeHexColor(request.CustomAccentColor);
            }

            if (request.EnableGoogleSignIn.HasValue)
            {
                config.EnableGoogleSignIn = request.EnableGoogleSignIn.Value;
            }

            if (request.AllowStandardJellyfinLogin.HasValue)
            {
                config.AllowStandardJellyfinLogin = request.AllowStandardJellyfinLogin.Value;
            }

            if (request.AllowAdminFallbackLogin.HasValue)
            {
                config.AllowAdminFallbackLogin = request.AllowAdminFallbackLogin.Value;
            }

            if (request.AdminFallbackLanOnly.HasValue)
            {
                config.AdminFallbackLanOnly = request.AdminFallbackLanOnly.Value;
            }

            if (request.BypassLoginGateOnLan.HasValue)
            {
                config.BypassLoginGateOnLan = request.BypassLoginGateOnLan.Value;
            }

            if (request.TreatTailscaleAsLocalLan.HasValue)
            {
                config.TreatTailscaleAsLocalLan = request.TreatTailscaleAsLocalLan.Value;
            }

            if (request.AutoProvisionJellyfinUsers.HasValue)
            {
                config.AutoProvisionJellyfinUsers = request.AutoProvisionJellyfinUsers.Value;
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

            if (request.SessionLifetimeDays.HasValue)
            {
                config.SessionLifetimeDays = Math.Clamp(request.SessionLifetimeDays.Value, 1, 365);
            }

            if (request.Top10SelectionMode != null)
            {
                config.Top10SelectionMode = NormalizeTop10Mode(request.Top10SelectionMode);
            }

            if (request.HeroRotationSeconds.HasValue)
            {
                config.HeroRotationSeconds = Math.Clamp(request.HeroRotationSeconds.Value, 0, 120);
            }

            if (request.HeroSlideCount.HasValue)
            {
                config.HeroSlideCount = Math.Clamp(request.HeroSlideCount.Value, 1, 15);
            }

            if (request.HeroSelectionMode != null)
            {
                config.HeroSelectionMode = NormalizeHeroSelectionMode(request.HeroSelectionMode);
            }

            if (request.HeroContentType != null)
            {
                config.HeroContentType = NormalizeHeroContentType(request.HeroContentType);
            }

            if (request.HeroLibraryIds != null)
            {
                config.HeroLibraryIds = request.HeroLibraryIds
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Select(id => id.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            if (request.ShowLibrariesInNav.HasValue)
            {
                config.ShowLibrariesInNav = request.ShowLibrariesInNav.Value;
            }

            if (request.NavHiddenBuiltIns != null)
            {
                var allowedBuiltIns = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "series", "movies", "collections", "top10", "mylist", "hot" };
                config.NavHiddenBuiltIns = request.NavHiddenBuiltIns
                    .Where(id => !string.IsNullOrWhiteSpace(id) && allowedBuiltIns.Contains(id.Trim()))
                    .Select(id => id.Trim().ToLowerInvariant())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            if (request.NavLibraryIds != null)
            {
                config.NavLibraryIds = request.NavLibraryIds
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Select(id => id.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            if (request.EnableCustomOidc.HasValue)
            {
                config.EnableCustomOidc = request.EnableCustomOidc.Value;
            }

            if (request.OidcProviderName != null)
            {
                var oidcName = request.OidcProviderName.Trim();
                config.OidcProviderName = oidcName.Length > 32 ? oidcName.Substring(0, 32).Trim() : oidcName;
            }

            if (request.OidcIssuerUrl != null)
            {
                config.OidcIssuerUrl = request.OidcIssuerUrl.Trim();
            }

            if (request.OidcClientId != null)
            {
                config.OidcClientId = request.OidcClientId.Trim();
            }

            if (request.OidcRequireAllowlist.HasValue)
            {
                config.OidcRequireAllowlist = request.OidcRequireAllowlist.Value;
            }

            if (request.ApprovedOidcUsers != null)
            {
                config.ApprovedOidcUsers = request.ApprovedOidcUsers
                    .Select(u => (u ?? string.Empty).Trim())
                    .Where(u => !string.IsNullOrEmpty(u))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            if (request.EnableGuestPasses.HasValue)
            {
                config.EnableGuestPasses = request.EnableGuestPasses.Value;
            }

            if (request.EnableWatchTogether.HasValue)
            {
                config.EnableWatchTogether = request.EnableWatchTogether.Value;
            }

            if (request.EnableSeerr.HasValue)
            {
                config.EnableSeerr = request.EnableSeerr.Value;
            }

            if (request.SeerrUrl != null)
            {
                config.SeerrUrl = StreamFlixSeerrService.NormalizeBaseUrl(request.SeerrUrl);
            }

            if (request.SeerrAllowKids.HasValue)
            {
                config.SeerrAllowKids = request.SeerrAllowKids.Value;
            }

            if (request.SeerrAllowGuests.HasValue)
            {
                config.SeerrAllowGuests = request.SeerrAllowGuests.Value;
            }

            if (request.Profiles is { Count: > 0 })
            {
                var nextProfiles = new List<StreamFlixProfileConfig>();
                var existingById = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                    .Where(p => !string.IsNullOrWhiteSpace(p.Id))
                    .ToDictionary(p => p.Id, p => p, StringComparer.OrdinalIgnoreCase);

                foreach (var src in request.Profiles.Take(MaxProfilesCount))
                {
                    if (src == null || string.IsNullOrWhiteSpace(src.Name))
                    {
                        continue;
                    }

                    var pid = !string.IsNullOrWhiteSpace(src.Id) ? src.Id.Trim() : $"streamflix_{Guid.NewGuid():N}";
                    existingById.TryGetValue(pid, out var prevProf);
                    var cleanName = src.Name.Trim();
                    if (cleanName.Length > 40)
                    {
                        cleanName = cleanName.Substring(0, 40).Trim();
                    }

                    var cleanPin = !string.IsNullOrWhiteSpace(src.PinCode) && PinRegex.IsMatch(src.PinCode.Trim())
                        ? src.PinCode.Trim()
                        : prevProf?.PinCode;

                    nextProfiles.Add(new StreamFlixProfileConfig
                    {
                        Id = pid,
                        Name = cleanName,
                        AvatarColorIndex = Math.Clamp(src.AvatarColorIndex, 0, 64),
                        AvatarIconIndex = Math.Clamp(src.AvatarIconIndex, 0, 128),
                        AvatarEmoji = string.IsNullOrWhiteSpace(src.AvatarEmoji) ? "🎬" : src.AvatarEmoji.Trim(),
                        AvatarColorHex = SanitizeHexColor(src.AvatarColorHex),
                        IsKids = src.IsKids,
                        KidsExitPinRequired = src.KidsExitPinRequired,
                        MaturityRating = string.IsNullOrWhiteSpace(src.MaturityRating) ? "TV-MA / R (All Maturity Levels)" : src.MaturityRating.Trim(),
                        PinCode = cleanPin,
                        GoogleAccountEmail = string.IsNullOrWhiteSpace(src.GoogleAccountEmail) ? null : src.GoogleAccountEmail.Trim(),
                        AccountLockKind = string.IsNullOrWhiteSpace(src.AccountLockKind) ? null : src.AccountLockKind.Trim().ToLowerInvariant(),
                        AutoplayNextEpisode = src.AutoplayNextEpisode,
                        AutoplayPreviews = src.AutoplayPreviews,
                        AllowedLibraryIds = (src.AllowedLibraryIds ?? new List<string>())
                            .Where(x => !string.IsNullOrWhiteSpace(x))
                            .Select(x => x.Trim())
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList(),
                        SeerrRequestQuota = Math.Clamp(src.SeerrRequestQuota, -1, 500),
                        BedtimeStart = NormalizeTimeString(src.BedtimeStart),
                        BedtimeEnd = NormalizeTimeString(src.BedtimeEnd),
                        JellyfinUserId = prevProf?.JellyfinUserId,
                        JellyfinUsername = !string.IsNullOrWhiteSpace(src.JellyfinUsername) ? src.JellyfinUsername.Trim() : prevProf?.JellyfinUsername,
                        IsPluginCreatedJellyfinUser = prevProf?.IsPluginCreatedJellyfinUser ?? false,
                        PermissionsInitialized = prevProf?.PermissionsInitialized ?? false,
                    });
                }

                if (nextProfiles.Count > 0)
                {
                    config.Profiles = nextProfiles;
                    importedProfilesCount = nextProfiles.Count;
                }
            }

            if (request.GuestPassManagerProfileIds != null)
            {
                var eligibleIds = new HashSet<string>(
                    (config.Profiles ?? new List<StreamFlixProfileConfig>())
                        .Where(p => !p.IsKids && !IsProfileLinkedToAdmin(p) && !string.IsNullOrWhiteSpace(p.Id))
                        .Select(p => p.Id),
                    StringComparer.OrdinalIgnoreCase);
                config.GuestPassManagerProfileIds = request.GuestPassManagerProfileIds
                    .Select(id => (id ?? string.Empty).Trim())
                    .Where(id => !string.IsNullOrEmpty(id) && eligibleIds.Contains(id))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        await SyncProfilesAsync(config, force: true).ConfigureAwait(false);
        return Ok(new
        {
            ok = true,
            importedProfilesCount,
            adminConfig = BuildAdminConfigResponse(config),
        });
    }

    internal static string NormalizeTimeString(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var trimmed = raw.Trim();
        if (TimeSpan.TryParseExact(trimmed, @"hh\:mm", System.Globalization.CultureInfo.InvariantCulture, out var ts)
            && ts.TotalHours >= 0 && ts.TotalHours < 24)
        {
            return $"{ts.Hours:D2}:{ts.Minutes:D2}";
        }

        return string.Empty;
    }

    [HttpGet("AdminConfig/HealthCheck")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RunAdminHealthCheck()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new
            {
                code = "admin_required",
                errorCode = StreamFlixErrorCodes.AdminRequired,
                message = "Only an active Jellyfin administrator profile can run the StreamFlix Health Check.",
            });
        }

        var checks = new List<object>();
        var overallStatus = "ok";
        void AddCheck(string status, string diagCode, string label, string detail)
        {
            checks.Add(new
            {
                status,
                code = diagCode,
                label,
                detail,
            });
            if (status == "error")
            {
                overallStatus = "error";
            }
            else if (status == "warn" && overallStatus == "ok")
            {
                overallStatus = "warn";
            }
        }

        // 1. Embedded Web Assets & index.html Injection Check (SF-HC-01)
        var scriptAsset = Plugin.GetEmbeddedScriptBundle();
        var styleAsset = Plugin.GetEmbeddedStylesheetBundle();
        var diskIndexPath = Plugin.Instance?.IndexHtmlPath ?? string.Empty;
        var diskHasTag = false;
        if (!string.IsNullOrEmpty(diskIndexPath) && System.IO.File.Exists(diskIndexPath))
        {
            try
            {
                var idxText = await System.IO.File.ReadAllTextAsync(diskIndexPath).ConfigureAwait(false);
                diskHasTag = idxText.Contains(Plugin.StartComment, StringComparison.Ordinal);
            }
            catch
            {
            }
        }

        if (scriptAsset.Bytes.Length > 10_000 && styleAsset.Bytes.Length > 5_000)
        {
            var modeDesc = diskHasTag
                ? "Disk index.html + in-memory IStartupFilter both active"
                : "In-memory IStartupFilter active (read-only container web root)";
            AddCheck("ok", "SF-HC-01", "Web UI Bundle & Injection", $"JS ({scriptAsset.Bytes.Length / 1024} KB) & CSS ({styleAsset.Bytes.Length / 1024} KB) ready · {modeDesc} · v={Plugin.AssetCacheVersion}.");
        }
        else
        {
            AddCheck("error", "SF-HC-01", "Web UI Bundle & Injection", "Embedded ClientScript or ClientStyles resource is unexpectedly small or missing.");
        }

        // 2. XML Configuration & Shadow Backup Persistence Check (SF-HC-02)
        var xmlExists = Plugin.Instance != null && System.IO.File.Exists(Plugin.Instance.ConfigurationFilePath);
        var shadowJsonExists = Plugin.Instance != null && System.IO.File.Exists(Plugin.Instance.PersistentBackupJsonPath);
        var hasSigningKey = !string.IsNullOrWhiteSpace(config.SessionSigningKey) && config.SessionSigningKey.Length >= 32;
        if (xmlExists && hasSigningKey)
        {
            AddCheck("ok", "SF-HC-02", "Config & Signing Persistence", $"XML config saved · Shadow JSON backup {(shadowJsonExists ? "present" : "will write on next save")} · HMAC session key healthy.");
        }
        else
        {
            AddCheck("warn", "SF-HC-02", "Config & Signing Persistence", $"XML file {(xmlExists ? "present" : "not written yet")} · Save settings once to initialize persistent backups.");
        }

        // 3. Household Gate & Owner Protection Check (SF-HC-03)
        var googleReady = config.EnableGoogleSignIn && !string.IsNullOrWhiteSpace(config.GoogleClientId);
        var oidcReady = StreamFlixOidcService.IsConfigured(config);
        var stdReady = config.AllowStandardJellyfinLogin;
        var lanBypass = config.BypassLoginGateOnLan;
        if (!googleReady && !oidcReady && !stdReady && !lanBypass)
        {
            AddCheck("warn", StreamFlixErrorCodes.GateUnconfiguredOrOwnerUnprotected, "Household Sign-In Gate", "No primary sign-in method is configured yet (only Administrator fallback is active). Enable Google, OIDC, or Standard Jellyfin login.");
        }
        else
        {
            var unprotectedAdminProfiles = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                .Where(p => IsProfileLinkedToAdmin(p) && string.IsNullOrWhiteSpace(p.PinCode) && string.IsNullOrWhiteSpace(p.GoogleAccountEmail))
                .Select(p => p.Name)
                .ToList();
            if (unprotectedAdminProfiles.Count > 0)
            {
                AddCheck("warn", StreamFlixErrorCodes.GateUnconfiguredOrOwnerUnprotected, "Admin Profile Lock", $"Admin-linked profile(s) ({string.Join(", ", unprotectedAdminProfiles)}) have no PIN or Account Lock set.");
            }
            else
            {
                AddCheck("ok", "SF-HC-03", "Household Sign-In & Admin Security", "Sign-in gate is active and administrator profiles are protected.");
            }
        }

        // 4. Profile <-> Jellyfin User Integrity Check (SF-HC-04)
        var profilesList = config.Profiles ?? new List<StreamFlixProfileConfig>();
        var brokenProfiles = new List<string>();
        var disabledProfiles = new List<string>();
        foreach (var p in profilesList)
        {
            if (string.IsNullOrWhiteSpace(p.JellyfinUserId) || !Guid.TryParse(p.JellyfinUserId, out var pGuid))
            {
                brokenProfiles.Add($"{p.Name} ({StreamFlixErrorCodes.ProfileUnlinked})");
                continue;
            }

            var u = _userManager.GetUserById(pGuid);
            if (u == null)
            {
                brokenProfiles.Add($"{p.Name} ({StreamFlixErrorCodes.ProfileUnlinked}: missing Jellyfin user)");
            }
            else if (StreamFlixStartupTask.IsUserDisabledCompat(u))
            {
                disabledProfiles.Add($"{p.Name} ({StreamFlixErrorCodes.ProfileJellyfinUserDisabled})");
            }
        }

        if (brokenProfiles.Count > 0 || disabledProfiles.Count > 0)
        {
            var issues = brokenProfiles.Concat(disabledProfiles);
            AddCheck("warn", StreamFlixErrorCodes.ProfileUnlinked, "Profile ↔ Jellyfin User Links", $"Attention needed on: {string.Join("; ", issues)}.");
        }
        else
        {
            AddCheck("ok", "SF-HC-04", "Profile ↔ Jellyfin User Links", $"All {profilesList.Count} profile(s) are linked to active Jellyfin server users.");
        }

        // 5. Media Libraries & Compile-Time Adapter Check (SF-HC-05)
        var libs = JellyfinCompat.GetServerMediaLibraries(_libraryManager);
        var showcase = GetShowcaseItemsCached(_libraryManager);
        if (libs.Count > 0)
        {
            AddCheck("ok", "SF-HC-05", "Media Libraries & Hub Adapter", $"{libs.Count} media library folder(s) accessible · {showcase.Count} showcase title(s) cached.");
        }
        else
        {
            AddCheck("warn", "SF-HC-05", "Media Libraries & Hub Adapter", "0 media libraries found in Jellyfin yet. Add Movies or Shows in Dashboard → Libraries.");
        }

        // 6. Reverse Proxy & HTTPS Scheme Check (SF-HC-06)
        var fwdProto = Request.Headers["X-Forwarded-Proto"].FirstOrDefault();
        var effectiveHttps = Request.IsHttps || string.Equals(fwdProto, "https", StringComparison.OrdinalIgnoreCase);
        if ((googleReady || oidcReady) && !effectiveHttps && !StreamFlixSessionService.IsLocalLanRequest(HttpContext, config.TreatTailscaleAsLocalLan))
        {
            AddCheck("warn", StreamFlixErrorCodes.OidcProxyHeaderMismatch, "Reverse Proxy & HTTPS Headers", $"Request arrived over plain HTTP without X-Forwarded-Proto: https (Host: {Request.Host}). OAuth/OIDC providers usually require HTTPS or ForwardedHeaders configured.");
        }
        else
        {
            AddCheck("ok", "SF-HC-06", "Origin & Proxy Headers", $"Host: {Request.Host} · Scheme: {(effectiveHttps ? "HTTPS" : "HTTP (Local/LAN)")}.");
        }

        // 7. Custom OIDC Live Check if enabled (SF-HC-07)
        if (config.EnableCustomOidc)
        {
            if (!oidcReady)
            {
                AddCheck("error", StreamFlixErrorCodes.OidcNotConfigured, "Custom OIDC SSO", "Custom OIDC is enabled, but Issuer URL or Client ID is empty.");
            }
            else
            {
                try
                {
                    using var oidcCts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
                    oidcCts.CancelAfter(TimeSpan.FromSeconds(5));
                    var cbUri = $"{(effectiveHttps ? "https" : Request.Scheme)}://{Request.Host}/StreamFlix/Oidc/Callback";
                    var (oSt, oSum, _) = await StreamFlixOidcService.TestDiscoveryAsync(
                        config.OidcIssuerUrl,
                        config.OidcClientId,
                        cbUri,
                        config.OidcRequireAllowlist,
                        config.ApprovedOidcUsers?.Count ?? 0,
                        oidcCts.Token).ConfigureAwait(false);
                    AddCheck(oSt, oSt == "ok" ? "SF-HC-07" : StreamFlixErrorCodes.OidcDiscoveryFailed, $"OIDC ({StreamFlixOidcService.GetDisplayProviderName(config)})", oSum);
                }
                catch (Exception ex)
                {
                    AddCheck("error", StreamFlixErrorCodes.OidcDiscoveryFailed, "Custom OIDC SSO", ex.Message);
                }
            }
        }

        // 8. Seerr Live Check if enabled (SF-HC-08)
        if (config.EnableSeerr)
        {
            if (!StreamFlixSeerrService.IsConfigured(config))
            {
                AddCheck("error", StreamFlixErrorCodes.SeerrForbidden, "Seerr Integration", "Seerr is enabled, but URL or API Key is missing.");
            }
            else
            {
                try
                {
                    using var seerrCts = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
                    seerrCts.CancelAfter(TimeSpan.FromSeconds(5));
                    var (sSt, sSum, _) = await StreamFlixSeerrService.TestConnectionAsync(config.SeerrUrl, config.SeerrApiKey, seerrCts.Token).ConfigureAwait(false);
                    AddCheck(sSt, sSt == "ok" ? "SF-HC-08" : StreamFlixErrorCodes.SeerrUnreachable, "Seerr Integration", sSum);
                }
                catch (Exception ex)
                {
                    AddCheck("error", StreamFlixErrorCodes.SeerrUnreachable, "Seerr Integration", ex.Message);
                }
            }
        }

        var abiLabel =
#if JF12
            "Jellyfin 12.x (.NET 10)";
#elif JF1011
            "Jellyfin 10.11 (.NET 9)";
#else
            "Jellyfin 10.9/10.10 (.NET 8)";
#endif

        var summaryText = overallStatus == "ok"
            ? $"All {checks.Count} release health checks passed on {abiLabel} (v{Plugin.VersionString})."
            : (overallStatus == "warn"
                ? $"Health check completed with warnings on {abiLabel} (v{Plugin.VersionString}). Review highlighted items below."
                : $"Health check detected configuration errors on {abiLabel} (v{Plugin.VersionString}).");

        return Ok(new
        {
            status = overallStatus,
            version = Plugin.VersionString,
            serverAbi = abiLabel,
            checkedAtUtc = DateTime.UtcNow.ToString("O"),
            summary = summaryText,
            checks,
        });
    }
}
