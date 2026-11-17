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


// Household Profile CRUD, Jellyfin User Sync, PIN Verification & Account Locks
public partial class StreamFlixController
{
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
            var lockResult = CheckGoogleLock(config, profile, caller);
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

            if (!profile.IsKids && !string.IsNullOrWhiteSpace(request?.ExitingKidsProfileId))
            {
                var exitingKids = FindProfile(config, request!.ExitingKidsProfileId);
                if (exitingKids is { IsKids: true, KidsExitPinRequired: true } && string.IsNullOrWhiteSpace(profile.PinCode))
                {
                    var adultExitPin = !string.IsNullOrWhiteSpace(request.AdultExitPin) ? request.AdultExitPin! : suppliedPin;
                    var adultPinResult = CheckAdultPin(config, adultExitPin);
                    if (adultPinResult != null)
                    {
                        return adultPinResult;
                    }
                }
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

        // 2. Otherwise match by username, or (for administrators only) create a dedicated user. Never silently fall back to the admin account.
        if (user == null)
        {
            var targetName = !string.IsNullOrWhiteSpace(profile.JellyfinUsername)
                ? profile.JellyfinUsername.Trim()
                : profile.Name.Trim();

            // Safe match only: never hand out an administrator's (or another profile's) account by name.
            user = StreamFlixStartupTask.FindSafeUserByName(_userManager, config, profile, targetName, profile.Name);
            if (user != null)
            {
                profile.IsPluginCreatedJellyfinUser = false;
            }

            if (user == null && IsEffectiveActiveAdmin(caller) && config.AutoProvisionJellyfinUsers)
            {
                try
                {
                    user = await StreamFlixStartupTask.CreatePluginManagedUserAsync(_userManager, StreamFlixStartupTask.GetAvailableUsername(_userManager, targetName), _logger).ConfigureAwait(false);
                    profile.IsPluginCreatedJellyfinUser = true;
                    profile.PermissionsInitialized = true;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "StreamFlix: could not create Jellyfin user '{TargetName}'.", targetName);
                }
            }
        }

        if (user == null)
        {
            return StatusCode(409, new { code = "profile_unlinked", message = $"\"{profile.Name}\" isn't linked to a Jellyfin user yet. An administrator can link an account in Manage Profiles." });
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

        if (!CanCallerActivateProfile(config, profile, user, isAdminUser, caller, out var activationAuthError))
        {
            return activationAuthError!;
        }

        var needsUserUpdate = false;
        var needsConfigSave = false;
        if (!isAdminUser && profile.IsPluginCreatedJellyfinUser)
        {
            var desiredAge = StreamFlixStartupTask.ParentalAgeFromMaturity(profile.MaturityRating, profile.IsKids);
            if (StreamFlixStartupTask.TryGetMaxParentalAge(user) != desiredAge && StreamFlixStartupTask.TrySetMaxParentalAge(user, desiredAge))
            {
                needsUserUpdate = true;
            }

            if (!profile.PermissionsInitialized)
            {
                if (StreamFlixStartupTask.InitializeNewPluginUserPermissions(user, primaryAdmin, profile.AllowedLibraryIds))
                {
                    needsUserUpdate = true;
                }

                profile.PermissionsInitialized = true;
                needsConfigSave = true;
            }
            else if (JellyfinCompat.SyncUserLibraryRestriction(user, profile.AllowedLibraryIds))
            {
                needsUserUpdate = true;
            }

            if (StreamFlixStartupTask.EnsureUserSyncPlayAccess(user, allowCreateAndJoin: !profile.IsKids))
            {
                needsUserUpdate = true;
            }
        }

        if (needsUserUpdate)
        {
            await _userManager.UpdateUserAsync(user).ConfigureAwait(false);
        }

        if (needsConfigSave
            || !string.Equals(profile.JellyfinUserId, user.Id.ToString("N"), StringComparison.OrdinalIgnoreCase)
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
            profile = MapProfilePublic(config, profile, caller),
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

        var lockResult = CheckGoogleLock(config, profile, caller);
        if (lockResult != null)
        {
            return lockResult;
        }

        return CheckPin(profile, request?.Pin ?? string.Empty) ?? Ok(new { ok = true });
    }

    [HttpPost("Profiles/VerifyAdultPin")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> VerifyAdultPin([FromBody] VerifyAdultPinRequest? request)
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
            return StatusCode(403, new { code = "guest_pass_restricted", message = "Guest Pass sessions cannot unlock adult profiles." });
        }

        return CheckAdultPin(config, request?.Pin ?? string.Empty) ?? Ok(new { ok = true });
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

        var effectiveAdmin = IsEffectiveActiveAdmin(caller);
        var existing = !string.IsNullOrWhiteSpace(request.Id) ? FindProfile(config, request.Id) : null;
        var isNewProfile = existing == null;
        if (isNewProfile && !effectiveAdmin)
        {
            return StatusCode(403, new { code = "admin_required", message = "Switch to an administrator profile to create new household profiles." });
        }

        if (isNewProfile && config.Profiles.Count >= MaxProfilesCount)
        {
            return BadRequest(new { message = $"You can create at most {MaxProfilesCount} profiles." });
        }

        // Non-administrators may only edit safe cosmetic preferences & PIN on their own non-Kids, non-Admin profile.
        if (existing != null && !effectiveAdmin)
        {
            if (IsProfileLinkedToAdmin(existing))
            {
                return StatusCode(403, new { code = "admin_required", message = "Switch to an administrator profile first to edit an administrator profile." });
            }

            if (existing.IsKids)
            {
                return StatusCode(403, new { code = "admin_required", message = "Only an administrator can edit a Kids profile." });
            }

            var existingLinkedUser = (!string.IsNullOrWhiteSpace(existing.JellyfinUserId) && Guid.TryParse(existing.JellyfinUserId, out var existingUid))
                ? _userManager.GetUserById(existingUid)
                : null;
            if (!CanCallerActivateProfile(config, existing, existingLinkedUser, isAdminUser: false, caller, out var saveAuthErr))
            {
                return saveAuthErr!;
            }

            if (caller.JellyfinUser != null
                && existingLinkedUser != null
                && caller.JellyfinUser.Id != existingLinkedUser.Id)
            {
                return StatusCode(403, new { code = "profile_account_mismatch", message = "Switch into this profile first before editing its preferences." });
            }

            var lockResult = CheckGoogleLock(config, existing, caller);
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

        // Validate an account lock change before mutating anything.
        string? newLock = existing?.GoogleAccountEmail;
        string? newLockKind = existing?.AccountLockKind;
        if (request.GoogleAccountEmail != null)
        {
            var requested = request.GoogleAccountEmail.Trim();
            newLock = string.IsNullOrEmpty(requested) ? null : requested;
            if (newLock == null)
            {
                newLockKind = null;
            }
            else
            {
                if (newLock.Length > 128 || newLock.Any(char.IsControl))
                {
                    return BadRequest(new { message = "Enter a valid account email or username for the profile lock." });
                }

                var rawKind = NormalizeAccountLockKind(request.AccountLockKind ?? existing?.AccountLockKind);
                if (EmailRegex.IsMatch(newLock))
                {
                    newLock = newLock.ToLowerInvariant();
                }
                else if (!string.Equals(rawKind, "oidc", StringComparison.Ordinal)
                    && !string.Equals(rawKind, "jellyfin", StringComparison.Ordinal))
                {
                    return BadRequest(new { message = "Enter a valid account email for the profile lock." });
                }

                newLockKind = string.IsNullOrEmpty(rawKind) ? null : rawKind;

                var changed = !string.Equals(newLock, existing?.GoogleAccountEmail, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(newLockKind ?? string.Empty, existing?.AccountLockKind ?? string.Empty, StringComparison.OrdinalIgnoreCase);
                if (changed && !effectiveAdmin && !DoesCallerOwnExplicitLock(config, newLock, newLockKind, caller))
                {
                    return StatusCode(403, new { code = "google_lock_forbidden", message = "You can only lock a profile to the account you're currently signed in with." });
                }
            }
        }

        // Resolve which Jellyfin user this profile should be linked to.
        // Security: only active administrators may choose, change, or create Jellyfin accounts.
        var currentLinkedId = existing?.JellyfinUserId;
        var requestedLink = request.JellyfinUserId?.Trim() ?? string.Empty;
        var wantsCreate = false;
        var explicitUid = Guid.Empty;
        JUser? targetUser = null;
        var createName = cleanName;

        if (effectiveAdmin)
        {
            wantsCreate = string.Equals(requestedLink, "__CREATE__", StringComparison.OrdinalIgnoreCase)
                || (isNewProfile && string.IsNullOrEmpty(requestedLink));
            if (!wantsCreate && !string.IsNullOrEmpty(requestedLink) && !Guid.TryParse(requestedLink, out explicitUid))
            {
                return BadRequest(new { code = "invalid_link", message = "That Jellyfin account isn't valid." });
            }

            createName = !string.IsNullOrWhiteSpace(request.JellyfinUsername) ? request.JellyfinUsername.Trim() : cleanName;
            if (explicitUid != Guid.Empty)
            {
                targetUser = _userManager.GetUserById(explicitUid);
                if (targetUser == null)
                {
                    return BadRequest(new { code = "invalid_link", message = "That Jellyfin account no longer exists." });
                }
            }
            else if (isNewProfile
                && !request.IsKids
                && string.IsNullOrEmpty(requestedLink)
                && !config.Profiles.Any(p => StreamFlixStartupTask.IsOwnerProfile(p) || IsProfileLinkedToAdmin(p)))
            {
                JUser? adminCandidate = null;
                if (caller.Session != null && Guid.TryParse(caller.Session.JellyfinUserId, out var sessAdminGuid))
                {
                    var cand = _userManager.GetUserById(sessAdminGuid);
                    if (cand != null && !StreamFlixStartupTask.IsUserDisabledCompat(cand) && StreamFlixStartupTask.IsUserAdminCompat(cand))
                    {
                        adminCandidate = cand;
                    }
                }

                if (adminCandidate == null && caller.JellyfinUser != null && !StreamFlixStartupTask.IsUserDisabledCompat(caller.JellyfinUser) && StreamFlixStartupTask.IsUserAdminCompat(caller.JellyfinUser))
                {
                    adminCandidate = caller.JellyfinUser;
                }

                adminCandidate ??= StreamFlixStartupTask.GetPrimaryAdminUserCompat(_userManager);
                if (adminCandidate != null && StreamFlixStartupTask.IsUserAdminCompat(adminCandidate))
                {
                    targetUser = adminCandidate;
                    wantsCreate = false;
                }
                else
                {
                    createName = StreamFlixStartupTask.GetAvailableUsername(_userManager, createName);
                }
            }
            else if (wantsCreate)
            {
                createName = StreamFlixStartupTask.GetAvailableUsername(_userManager, createName);
            }
        }
        else if (!string.IsNullOrEmpty(requestedLink)
            && !string.Equals(requestedLink, currentLinkedId ?? string.Empty, StringComparison.OrdinalIgnoreCase))
        {
            return LinkChangeForbidden();
        }

        var createdByPlugin = false;
        if (effectiveAdmin && targetUser == null && wantsCreate)
        {
            try
            {
                targetUser = await StreamFlixStartupTask.CreatePluginManagedUserAsync(_userManager, createName, _logger).ConfigureAwait(false);
                createdByPlugin = true;
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
                if (!effectiveAdmin)
                {
                    return StatusCode(403, new { code = "admin_required", message = "Switch to an administrator profile to create new household profiles." });
                }

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
                : (existing.IsKids || (effectiveAdmin && request.IsKids) ? "🦊" : "🎬");
            existing.AvatarColorHex = SanitizeHexColor(request.AvatarColorHex);

            if (effectiveAdmin)
            {
                existing.IsKids = request.IsKids;
                if (request.KidsExitPinRequired.HasValue)
                {
                    existing.KidsExitPinRequired = request.KidsExitPinRequired.Value;
                }

                var trimmedMaturity = request.MaturityRating?.Trim();
                existing.MaturityRating = !string.IsNullOrEmpty(trimmedMaturity)
                    ? (trimmedMaturity.Length > 60 ? trimmedMaturity.Substring(0, 60) : trimmedMaturity)
                    : (request.IsKids ? "Older Kids (TV-Y7 / PG)" : "TV-MA / R (All Maturity Levels)");
            }

            existing.GoogleAccountEmail = newLock;
            existing.AccountLockKind = newLock == null ? null : newLockKind;

            if (cleanPin != null)
            {
                existing.PinCode = cleanPin == "__CLEAR__" ? null : cleanPin;
            }

            existing.AutoplayNextEpisode = request.AutoplayNextEpisode;
            existing.AutoplayPreviews = request.AutoplayPreviews;

            if (effectiveAdmin)
            {
                if (request.AllowedLibraryIds != null)
                {
                    existing.AllowedLibraryIds = request.AllowedLibraryIds
                        .Where(id => !string.IsNullOrWhiteSpace(id))
                        .Select(id => id.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                }

                if (request.SeerrRequestQuota.HasValue)
                {
                    existing.SeerrRequestQuota = Math.Clamp(request.SeerrRequestQuota.Value, -1, 500);
                }
            }

            if (request.BedtimeStart != null || request.BedtimeEnd != null)
            {
                var nextStart = NormalizeTimeString(request.BedtimeStart ?? existing.BedtimeStart);
                var nextEnd = NormalizeTimeString(request.BedtimeEnd ?? existing.BedtimeEnd);
                var hadExistingKidsBedtime = existing.IsKids
                    && !string.IsNullOrEmpty(existing.BedtimeStart)
                    && !string.IsNullOrEmpty(existing.BedtimeEnd);
                var canModifyKidsBedtime = effectiveAdmin
                    || !hadExistingKidsBedtime
                    || CheckAdultPin(config, request.CurrentPin ?? string.Empty) == null;
                if (canModifyKidsBedtime)
                {
                    existing.BedtimeStart = string.IsNullOrEmpty(nextStart) || string.IsNullOrEmpty(nextEnd) ? string.Empty : nextStart;
                    existing.BedtimeEnd = string.IsNullOrEmpty(nextStart) || string.IsNullOrEmpty(nextEnd) ? string.Empty : nextEnd;
                }
            }

            if (effectiveAdmin && targetUser != null)
            {
                var targetIdStr = targetUser.Id.ToString("N");
                if (createdByPlugin)
                {
                    existing.IsPluginCreatedJellyfinUser = true;
                    existing.PermissionsInitialized = true;
                }
                else if (!string.Equals(targetIdStr, currentLinkedId, StringComparison.OrdinalIgnoreCase))
                {
                    existing.IsPluginCreatedJellyfinUser = false;
                }

                existing.JellyfinUserId = targetIdStr;
                existing.JellyfinUsername = targetUser.Username;
            }

            if ((existing.IsKids || IsProfileLinkedToAdmin(existing)) && config.GuestPassManagerProfileIds != null)
            {
                config.GuestPassManagerProfileIds.RemoveAll(id => string.Equals(id, existing.Id, StringComparison.OrdinalIgnoreCase));
            }

            // Never allow active Guest Passes to remain if a profile is re-linked to an administrator account
            if (IsProfileLinkedToAdmin(existing) && config.GuestPasses != null)
            {
                foreach (var gp in config.GuestPasses.Where(g => string.Equals(g.ProfileId, existing.Id, StringComparison.OrdinalIgnoreCase)).ToList())
                {
                    autoRevokedPassIds.Add(gp.Id);
                    config.GuestPasses.Remove(gp);
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

        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Switch to an administrator profile to reorder household profiles." });
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

        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Switch to an administrator profile to delete household profiles." });
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

            config.GuestPassManagerProfileIds?.RemoveAll(id => string.Equals(id, target.Id, StringComparison.OrdinalIgnoreCase));

            if (config.GuestPasses != null)
            {
                foreach (var gp in config.GuestPasses.Where(g => string.Equals(g.ProfileId, target.Id, StringComparison.OrdinalIgnoreCase)).ToList())
                {
                    revokedForDeletedProfile.Add(gp.Id);
                    config.GuestPasses.Remove(gp);
                }
            }

            config.Profiles.Remove(target);
            deletedUserId = target.JellyfinUserId;
            shouldDeleteUser = request?.DeleteJellyfinUser == true
                && IsEffectiveActiveAdmin(caller)
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

    private static string NormalizeAccountLockKind(string? rawKind)
    {
        var k = (rawKind ?? string.Empty).Trim().ToLowerInvariant();
        return k switch
        {
            "google" => "google",
            "oidc" => "oidc",
            "jellyfin" => "jellyfin",
            _ => string.Empty,
        };
    }

    private static string ResolveEffectiveLockKind(PluginConfiguration config, StreamFlixProfileConfig profile)
    {
        if (string.IsNullOrWhiteSpace(profile.GoogleAccountEmail))
        {
            return string.Empty;
        }

        var lockVal = profile.GoogleAccountEmail.Trim();
        var rawKind = NormalizeAccountLockKind(profile.AccountLockKind);
        var isEmail = EmailRegex.IsMatch(lockVal);
        var googleOn = config.EnableGoogleSignIn && !string.IsNullOrWhiteSpace(config.GoogleClientId);
        var oidcOn = config.EnableCustomOidc && !string.IsNullOrWhiteSpace(config.OidcIssuerUrl) && !string.IsNullOrWhiteSpace(config.OidcClientId);
        var jfOn = config.AllowStandardJellyfinLogin;

        if (rawKind == "jellyfin")
        {
            return "jellyfin";
        }

        if (!isEmail)
        {
            if (rawKind == "oidc" || (oidcOn && !jfOn))
            {
                return "oidc";
            }

            return jfOn ? "jellyfin" : "oidc";
        }

        if (rawKind == "oidc")
        {
            return (oidcOn || config.EnableCustomOidc || !googleOn) ? "oidc" : "google";
        }

        if (rawKind == "google")
        {
            if (googleOn || (!oidcOn && !jfOn))
            {
                return "google";
            }

            return oidcOn ? "oidc" : "jellyfin";
        }

        if (oidcOn && !googleOn)
        {
            return "oidc";
        }

        if (googleOn && !oidcOn)
        {
            return "google";
        }

        if (googleOn && oidcOn)
        {
            return "sso";
        }

        if (config.EnableCustomOidc && !config.EnableGoogleSignIn)
        {
            return "oidc";
        }

        if (jfOn && !config.EnableGoogleSignIn && !config.EnableCustomOidc)
        {
            return "jellyfin";
        }

        return config.EnableGoogleSignIn ? "google" : "sso";
    }

    private static bool DoesCallerOwnExplicitLock(
        PluginConfiguration config,
        string lockTarget,
        string? explicitKind,
        CallerContext caller)
    {
        if (string.IsNullOrWhiteSpace(lockTarget))
        {
            return true;
        }

        var target = lockTarget.Trim();
        var normKind = NormalizeAccountLockKind(explicitKind);
        var s = caller.Session;
        if (s == null)
        {
            return false;
        }

        var sessKind = s.AuthKind ?? string.Empty;
        if (string.Equals(sessKind, StreamFlixSessionService.AuthKindGuestPass, StringComparison.Ordinal))
        {
            return false;
        }

        if (normKind == "jellyfin")
        {
            return (string.Equals(sessKind, StreamFlixSessionService.AuthKindJellyfin, StringComparison.Ordinal)
                    || string.Equals(sessKind, StreamFlixSessionService.AuthKindJellyfinAdmin, StringComparison.Ordinal))
                && !string.IsNullOrWhiteSpace(s.Username)
                && string.Equals(s.Username.Trim(), target, StringComparison.OrdinalIgnoreCase);
        }

        if (normKind == "oidc")
        {
            if (string.Equals(sessKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal))
            {
                if (EmailRegex.IsMatch(target))
                {
                    return !string.IsNullOrWhiteSpace(s.Email) && string.Equals(s.Email.Trim(), target, StringComparison.OrdinalIgnoreCase);
                }

                return (!string.IsNullOrWhiteSpace(s.Username) && !s.Username.Contains('@') && string.Equals(s.Username.Trim(), target, StringComparison.OrdinalIgnoreCase))
                    || (!string.IsNullOrWhiteSpace(s.JellyfinUserId) && string.Equals(s.JellyfinUserId.Trim(), target, StringComparison.OrdinalIgnoreCase));
            }

            // If OIDC was subsequently turned off by the admin and Google is active, allow verified Google email match
            var oidcActive = config.EnableCustomOidc && !string.IsNullOrWhiteSpace(config.OidcIssuerUrl) && !string.IsNullOrWhiteSpace(config.OidcClientId);
            if (!oidcActive
                && string.Equals(sessKind, StreamFlixSessionService.AuthKindGoogle, StringComparison.Ordinal)
                && EmailRegex.IsMatch(target))
            {
                return !string.IsNullOrWhiteSpace(s.Email) && string.Equals(s.Email.Trim(), target, StringComparison.OrdinalIgnoreCase);
            }

            return false;
        }

        if (normKind == "google")
        {
            if (string.Equals(sessKind, StreamFlixSessionService.AuthKindGoogle, StringComparison.Ordinal))
            {
                return !string.IsNullOrWhiteSpace(s.Email) && string.Equals(s.Email.Trim(), target, StringComparison.OrdinalIgnoreCase);
            }

            // If Google was subsequently turned off by the admin and OIDC is active, allow verified OIDC email match
            var googleActive = config.EnableGoogleSignIn && !string.IsNullOrWhiteSpace(config.GoogleClientId);
            if (!googleActive
                && string.Equals(sessKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal)
                && EmailRegex.IsMatch(target))
            {
                return !string.IsNullOrWhiteSpace(s.Email) && string.Equals(s.Email.Trim(), target, StringComparison.OrdinalIgnoreCase);
            }

            return false;
        }

        // Legacy / shared SSO email lock: matches verified email from Google or OIDC
        if (!string.IsNullOrWhiteSpace(s.Email) && string.Equals(s.Email.Trim(), target, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // If both SSO methods are disabled and only Standard Jellyfin login is active, allow matching verified Jellyfin username
        if (!config.EnableGoogleSignIn
            && !config.EnableCustomOidc
            && config.AllowStandardJellyfinLogin
            && (string.Equals(sessKind, StreamFlixSessionService.AuthKindJellyfin, StringComparison.Ordinal)
                || string.Equals(sessKind, StreamFlixSessionService.AuthKindJellyfinAdmin, StringComparison.Ordinal))
            && !string.IsNullOrWhiteSpace(s.Username)
            && string.Equals(s.Username.Trim(), target, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return false;
    }

    private ObjectResult? CheckGoogleLock(PluginConfiguration config, StreamFlixProfileConfig profile, CallerContext caller)
    {
        if (string.IsNullOrWhiteSpace(profile.GoogleAccountEmail) || caller.IsAdmin)
        {
            return null;
        }

        if (DoesCallerOwnExplicitLock(config, profile.GoogleAccountEmail, profile.AccountLockKind, caller))
        {
            return null;
        }

        var effKind = ResolveEffectiveLockKind(config, profile);
        var providerLabel = effKind switch
        {
            "oidc" => string.IsNullOrWhiteSpace(config.OidcProviderName) ? "SSO" : config.OidcProviderName.Trim(),
            "jellyfin" => "Jellyfin",
            "sso" => "SSO",
            _ => "Google",
        };
        var hint = StreamFlixSessionService.MaskEmail(profile.GoogleAccountEmail);

        return StatusCode(403, new
        {
            code = "google_lock",
            accountLockKind = effKind,
            requiredEmailHint = hint,
            message = $"\"{profile.Name}\" is locked to the {providerLabel} account {hint}.",
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

    private ObjectResult? CheckAdultPin(PluginConfiguration config, string suppliedPin)
    {
        var adultPinProfiles = (config.Profiles ?? new List<StreamFlixProfileConfig>())
            .Where(p => !p.IsKids && !string.IsNullOrWhiteSpace(p.PinCode))
            .ToList();
        if (adultPinProfiles.Count == 0)
        {
            return null;
        }

        const string targetKey = "__adult_exit__";
        var lockKey = StreamFlixSessionService.GetRateLimitClientKey(HttpContext) + "|" + targetKey;
        if (StreamFlixSessionService.IsPinLockedOut(lockKey, out var retryAfter)
            || StreamFlixSessionService.IsPinTargetLockedOut(targetKey, out retryAfter))
        {
            var secs = (int)Math.Ceiling(retryAfter.TotalSeconds);
            Response.Headers["Retry-After"] = secs.ToString(CultureInfo.InvariantCulture);
            return StatusCode(429, new { code = "pin_locked", retryAfterSeconds = secs, message = $"Too many wrong PINs. Try again in {Math.Max(1, (secs + 59) / 60)} min." });
        }

        var cleanPin = (suppliedPin ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(cleanPin))
        {
            return StatusCode(403, new { code = "adult_pin_required", message = "Enter an adult profile PIN to exit Kids mode." });
        }

        var matched = false;
        foreach (var ap in adultPinProfiles)
        {
            if (StreamFlixSessionService.ConstantTimePinEquals(ap.PinCode ?? string.Empty, cleanPin))
            {
                matched = true;
            }
        }

        if (!matched)
        {
            StreamFlixSessionService.RegisterPinFailure(lockKey);
            StreamFlixSessionService.RegisterPinTargetFailure(targetKey);
            return StatusCode(403, new { code = "pin_invalid", message = "Incorrect adult PIN. Please try again." });
        }

        StreamFlixSessionService.ResetPinFailures(lockKey);
        StreamFlixSessionService.ResetPinTargetFailures(targetKey);
        return null;
    }

    private async Task SyncProfilesAsync(PluginConfiguration config, bool force)
    {
        if (!force && DateTime.UtcNow - _lastSyncUtc < TimeSpan.FromSeconds(60))
        {
            return;
        }

        List<string>? prunedPassIds = null;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!force && DateTime.UtcNow - _lastSyncUtc < TimeSpan.FromSeconds(60))
            {
                return;
            }

            await StreamFlixStartupTask.SyncAllProfilesWithJellyfinUsersAsync(_userManager, config, _logger, allowCreateMissingUsers: false).ConfigureAwait(false);
            if (PruneDeadGuestPassesNoLock(config, out var newlyPruned) > 0)
            {
                prunedPassIds = newlyPruned;
                Plugin.Instance?.SaveConfiguration();
            }

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

        if (prunedPassIds != null)
        {
            foreach (var gpId in prunedPassIds)
            {
                await RevokeGuestJellyfinSessionsAsync(gpId).ConfigureAwait(false);
            }
        }
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

    private bool CanCallerActivateProfile(
        PluginConfiguration config,
        StreamFlixProfileConfig profile,
        JUser? resolvedUser,
        bool isAdminUser,
        CallerContext caller,
        out ObjectResult? errorResult)
    {
        errorResult = null;
        if (caller.IsAdmin)
        {
            return true;
        }

        if (IsGuestSession(caller))
        {
            if (isAdminUser || !string.Equals(profile.Id, caller.Session?.LockedProfileId, StringComparison.Ordinal))
            {
                errorResult = StatusCode(403, new
                {
                    code = "guest_profile_locked",
                    message = "This Guest Pass only grants access to its assigned profile.",
                });
                return false;
            }

            return true;
        }

        var sess = caller.Session;
        var sessKind = sess?.AuthKind ?? string.Empty;

        if (isAdminUser)
        {
            var isSsoSession = sess != null
                && (string.Equals(sessKind, StreamFlixSessionService.AuthKindGoogle, StringComparison.Ordinal)
                    || string.Equals(sessKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal));

            if (isSsoSession)
            {
                if (!string.IsNullOrWhiteSpace(profile.GoogleAccountEmail))
                {
                    if (DoesCallerOwnExplicitLock(config, profile.GoogleAccountEmail, profile.AccountLockKind, caller))
                    {
                        return true;
                    }
                }
                else if (IsPrimaryClaimedSsoOwner(config, sess!))
                {
                    return true;
                }
            }

            errorResult = StatusCode(403, new
            {
                code = "admin_profile_required",
                message = "Sign in with an administrator account to use this profile.",
            });
            return false;
        }

        var isLanBypassOnly = sess == null && config.BypassLoginGateOnLan && caller.IsLocalLan;
        var isNonAdminJfLogin = string.Equals(sessKind, StreamFlixSessionService.AuthKindJellyfin, StringComparison.Ordinal)
            || (sess == null && !isLanBypassOnly && caller.IsJellyfinAuthenticated && caller.JellyfinUser != null);

        if (isNonAdminJfLogin)
        {
            Guid? callerJfUid = null;
            if (sess != null && Guid.TryParse(sess.JellyfinUserId, out var parsedSessUid))
            {
                callerJfUid = parsedSessUid;
            }
            else if (caller.JellyfinUser != null)
            {
                callerJfUid = caller.JellyfinUser.Id;
            }

            if (resolvedUser == null || !callerJfUid.HasValue || resolvedUser.Id != callerJfUid.Value)
            {
                errorResult = StatusCode(403, new
                {
                    code = "profile_account_mismatch",
                    message = "Sign in with that Jellyfin account (or an administrator account) to switch to this profile.",
                });
                return false;
            }

            return true;
        }

        var isOpenOidcGate = string.Equals(sessKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal)
            && !config.OidcRequireAllowlist;

        if (!profile.IsPluginCreatedJellyfinUser || isOpenOidcGate)
        {
            var hasOwnedExplicitLock = !string.IsNullOrWhiteSpace(profile.GoogleAccountEmail)
                && DoesCallerOwnExplicitLock(config, profile.GoogleAccountEmail, profile.AccountLockKind, caller);
            var hasConfiguredPin = !string.IsNullOrWhiteSpace(profile.PinCode);
            if (!hasOwnedExplicitLock && !hasConfiguredPin)
            {
                errorResult = StatusCode(403, new
                {
                    code = "profile_protection_required",
                    message = $"\"{profile.Name}\" is linked to an existing server account and requires a PIN or account lock before non-admin household switching is allowed.",
                });
                return false;
            }
        }

        return true;
    }

    private static bool IsPrimaryClaimedSsoOwner(
        PluginConfiguration config,
        StreamFlixSessionService.SessionInfo session)
    {
        if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindGoogle, StringComparison.Ordinal))
        {
            var primaryEmail = (config.ApprovedGoogleAccounts ?? new List<string>())
                .Select(a => (a ?? string.Empty).Trim())
                .FirstOrDefault(a => !string.IsNullOrEmpty(a));
            return !string.IsNullOrEmpty(primaryEmail)
                && !string.IsNullOrWhiteSpace(session.Email)
                && string.Equals(session.Email.Trim(), primaryEmail, StringComparison.OrdinalIgnoreCase);
        }

        if (string.Equals(session.AuthKind, StreamFlixSessionService.AuthKindOidc, StringComparison.Ordinal))
        {
            if (!config.OidcRequireAllowlist)
            {
                return false;
            }

            var primaryOidc = (config.ApprovedOidcUsers ?? new List<string>())
                .Select(a => (a ?? string.Empty).Trim())
                .FirstOrDefault(a => !string.IsNullOrEmpty(a));
            if (string.IsNullOrEmpty(primaryOidc))
            {
                return false;
            }

            if (primaryOidc.Contains('@', StringComparison.Ordinal))
            {
                return !string.IsNullOrWhiteSpace(session.Email)
                    && string.Equals(session.Email.Trim(), primaryOidc, StringComparison.OrdinalIgnoreCase);
            }

            return (!string.IsNullOrWhiteSpace(session.Username)
                    && !session.Username.Contains('@', StringComparison.Ordinal)
                    && string.Equals(session.Username.Trim(), primaryOidc, StringComparison.OrdinalIgnoreCase))
                || (!string.IsNullOrWhiteSpace(session.JellyfinUserId)
                    && string.Equals(session.JellyfinUserId.Trim(), primaryOidc, StringComparison.OrdinalIgnoreCase));
        }

        return false;
    }

    private object MapProfilePublic(PluginConfiguration config, StreamFlixProfileConfig p, CallerContext caller)
    {
        JUser? linkedUser = null;
        var isAdmin = StreamFlixStartupTask.IsOwnerProfile(p);
        if (!string.IsNullOrWhiteSpace(p.JellyfinUserId) && Guid.TryParse(p.JellyfinUserId, out var uid))
        {
            linkedUser = _userManager.GetUserById(uid);
            if (linkedUser != null)
            {
                isAdmin = StreamFlixStartupTask.IsUserAdminCompat(linkedUser);
            }
        }

        var isGuest = IsGuestSession(caller);
        var lockEmail = isGuest || string.IsNullOrWhiteSpace(p.GoogleAccountEmail) ? null : p.GoogleAccountEmail.Trim();
        var callerOwnsLock = lockEmail != null && DoesCallerOwnExplicitLock(config, lockEmail, p.AccountLockKind, caller);
        var effectiveLockKind = lockEmail != null ? ResolveEffectiveLockKind(config, p) : string.Empty;
        var canActivate = CanCallerActivateProfile(config, p, linkedUser, isAdmin, caller, out _);
        var canManageGuestPasses = !isGuest && !p.IsKids && (isAdmin || IsProfileAllowedGuestPassManager(config, p));

        return new
        {
            id = p.Id,
            name = p.Name,
            avatarColorIndex = p.AvatarColorIndex,
            avatarIconIndex = p.AvatarIconIndex,
            avatarEmoji = p.AvatarEmoji,
            avatarColorHex = SanitizeHexColor(p.AvatarColorHex),
            isKids = p.IsKids,
            kidsExitPinRequired = p.IsKids && p.KidsExitPinRequired,
            isAdmin,
            isOwner = StreamFlixStartupTask.IsOwnerProfile(p),
            canActivate,
            canManageGuestPasses,
            maturityRating = p.MaturityRating,
            hasPin = !isGuest && !string.IsNullOrWhiteSpace(p.PinCode),
            pinLength = isGuest || string.IsNullOrWhiteSpace(p.PinCode) ? 0 : p.PinCode.Trim().Length,
            googleLocked = !isGuest && lockEmail != null,
            accountLockKind = effectiveLockKind,
            googleAccountEmail = lockEmail != null && (IsEffectiveActiveAdmin(caller) || callerOwnsLock) ? lockEmail : null,
            googleAccountHint = lockEmail != null ? StreamFlixSessionService.MaskEmail(lockEmail) : null,
            googleLockSatisfied = isGuest || lockEmail == null || callerOwnsLock || caller.IsAdmin,
            autoplayNextEpisode = p.AutoplayNextEpisode,
            autoplayPreviews = p.AutoplayPreviews,
            allowedLibraryIds = (p.AllowedLibraryIds ?? new List<string>()).ToList(),
            seerrRequestQuota = p.SeerrRequestQuota,
            bedtimeStart = NormalizeTimeString(p.BedtimeStart),
            bedtimeEnd = NormalizeTimeString(p.BedtimeEnd),
            jellyfinUserId = p.JellyfinUserId,
            jellyfinUsername = p.JellyfinUsername,
        };
    }
}
