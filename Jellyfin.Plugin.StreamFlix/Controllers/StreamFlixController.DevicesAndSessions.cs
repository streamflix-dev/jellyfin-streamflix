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


// Active Devices Inspector & Session/Device Revocation
public partial class StreamFlixController
{
    [HttpPost("Sessions/RevokeAll")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RevokeAllSessions()
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can sign out all devices." });
        }

        int newVersion;
        await SyncLock.WaitAsync().ConfigureAwait(false);
        try
        {
            config.SessionVersion = Math.Max(1, config.SessionVersion) + 1;
            newVersion = config.SessionVersion;
            ActiveGuestTokens.Clear();
            PruneDeadGuestPassesNoLock(config, out _);
            Plugin.Instance?.SaveConfiguration();
        }
        finally
        {
            SyncLock.Release();
        }

        var revokedSessions = await RevokeAllJellyfinSessionsAsync().ConfigureAwait(false);
        _logger.LogInformation(
            "StreamFlix: all household and Jellyfin device sessions revoked by an administrator (session version {Version}, Jellyfin tokens/sessions revoked: {Count}).",
            newVersion,
            revokedSessions);
        return Ok(new { revoked = true, sessionVersion = newVersion, revokedSessions });
    }

    [HttpGet("Devices")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ListActiveDevices([FromQuery] string? currentDeviceId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can view active devices." });
        }

        var devices = await BuildActiveDevicesListAsync(config, currentDeviceId).ConfigureAwait(false);
        return Ok(new { devices });
    }

    [HttpPost("Devices/Revoke")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> RevokeSingleDevice([FromBody] RevokeDeviceRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!IsEffectiveActiveAdmin(caller))
        {
            return StatusCode(403, new { code = "admin_required", message = "Only a Jellyfin administrator can sign out devices." });
        }

        var targetDeviceId = (request?.DeviceId ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(targetDeviceId) || targetDeviceId.Length > 256)
        {
            return BadRequest(new { revoked = false, message = "A valid device identifier is required." });
        }

        Guid? targetUserId = null;
        if (!string.IsNullOrWhiteSpace(request?.UserId) && Guid.TryParse(request.UserId.Trim(), out var parsedUid) && parsedUid != Guid.Empty)
        {
            targetUserId = parsedUid;
        }

        var (revokedCount, wasCurrentDevice) = await RevokeSingleJellyfinDeviceAsync(targetDeviceId, targetUserId).ConfigureAwait(false);
        _logger.LogInformation(
            "StreamFlix: administrator signed out device '{DeviceId}' (user filter: {UserId}, tokens/sessions revoked: {Count}).",
            targetDeviceId,
            targetUserId?.ToString("N") ?? "any",
            revokedCount);

        return Ok(new
        {
            revoked = true,
            revokedCount,
            wasCurrentDevice,
        });
    }

    private async Task<bool> LogoutSingleJellyfinTokenAsync(string? accessToken)
    {
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return false;
        }

        try
        {
            var logoutStringMethod = typeof(ISessionManager).GetMethod("Logout", new[] { typeof(string) })
                ?? _sessionManager.GetType().GetMethod("Logout", new[] { typeof(string) });
            if (logoutStringMethod != null
                && logoutStringMethod.Invoke(_sessionManager, new object[] { accessToken }) is Task logoutTask)
            {
                await logoutTask.ConfigureAwait(false);
                return true;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error logging out Jellyfin token.");
        }

        return false;
    }

    private async Task<int> RevokeAllJellyfinSessionsAsync()
    {
        var liveTokens = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            var callerInfo = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (callerInfo != null && !callerInfo.IsApiKey && !string.IsNullOrWhiteSpace(callerInfo.Token))
            {
                liveTokens.Add(callerInfo.Token);
            }
        }
        catch
        {
        }

        try
        {
            var liveSessions = _sessionManager.Sessions?.ToList();
            if (liveSessions != null)
            {
                foreach (var sess in liveSessions)
                {
                    if (sess == null)
                    {
                        continue;
                    }

                    if (sess.GetType().GetProperty("AccessToken")?.GetValue(sess) is string liveTok
                        && !string.IsNullOrWhiteSpace(liveTok))
                    {
                        liveTokens.Add(liveTok);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error enumerating live sessions during RevokeAll.");
        }

        var revokedUsers = 0;
        try
        {
            var revoke2 = typeof(ISessionManager).GetMethod("RevokeUserTokens", new[] { typeof(Guid), typeof(string) })
                ?? _sessionManager.GetType().GetMethod("RevokeUserTokens", new[] { typeof(Guid), typeof(string) });
            var revoke1 = revoke2 == null
                ? (typeof(ISessionManager).GetMethod("RevokeUserTokens", new[] { typeof(Guid) })
                    ?? _sessionManager.GetType().GetMethod("RevokeUserTokens", new[] { typeof(Guid) }))
                : null;

            if (revoke2 != null || revoke1 != null)
            {
                foreach (var u in StreamFlixStartupTask.GetAllUsersCompat(_userManager))
                {
                    try
                    {
                        var task = revoke2 != null
                            ? revoke2.Invoke(_sessionManager, new object?[] { u.Id, null }) as Task
                            : revoke1!.Invoke(_sessionManager, new object[] { u.Id }) as Task;
                        if (task != null)
                        {
                            await task.ConfigureAwait(false);
                            revokedUsers++;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(ex, "StreamFlix: non-fatal error revoking Jellyfin tokens for user '{Username}'.", u.Username);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error invoking RevokeUserTokens.");
        }

        var loggedOutTokens = 0;
        foreach (var tok in liveTokens)
        {
            if (await LogoutSingleJellyfinTokenAsync(tok).ConfigureAwait(false))
            {
                loggedOutTokens++;
            }
        }

        return Math.Max(revokedUsers, loggedOutTokens);
    }

    private sealed class MergedDeviceRecord
    {
        public string DeviceId { get; set; } = string.Empty;

        public string DeviceName { get; set; } = string.Empty;

        public string AppName { get; set; } = string.Empty;

        public string AppVersion { get; set; } = string.Empty;

        public Guid UserId { get; set; }

        public string UserName { get; set; } = string.Empty;

        public DateTime LastActivityUtc { get; set; }

        public bool IsLive { get; set; }

        public string NowPlaying { get; set; } = string.Empty;

        public bool IsCurrentDevice { get; set; }
    }

    private async Task<List<object>> BuildActiveDevicesListAsync(PluginConfiguration config, string? clientDeviceId)
    {
        string? callerToken = null;
        string? callerAuthDeviceId = null;
        Guid callerAuthUserId = Guid.Empty;
        try
        {
            var info = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (info != null && !info.IsApiKey)
            {
                callerToken = info.Token;
                callerAuthDeviceId = info.DeviceId;
                callerAuthUserId = info.UserId;
            }
        }
        catch
        {
        }

        var effectiveCallerDeviceId = !string.IsNullOrWhiteSpace(clientDeviceId)
            ? clientDeviceId.Trim()
            : callerAuthDeviceId;

        var profilesByJfUser = new Dictionary<Guid, StreamFlixProfileConfig>();
        if (config.Profiles != null)
        {
            foreach (var p in config.Profiles)
            {
                if (!string.IsNullOrWhiteSpace(p.JellyfinUserId)
                    && Guid.TryParse(p.JellyfinUserId, out var pUid)
                    && pUid != Guid.Empty
                    && !profilesByJfUser.ContainsKey(pUid))
                {
                    profilesByJfUser[pUid] = p;
                }
            }
        }

        var guestPassesById = new Dictionary<string, StreamFlixGuestPass>(StringComparer.OrdinalIgnoreCase);
        if (config.GuestPasses != null)
        {
            foreach (var gp in config.GuestPasses)
            {
                if (!string.IsNullOrWhiteSpace(gp.Id))
                {
                    guestPassesById[gp.Id] = gp;
                }
            }
        }

        var merged = new Dictionary<string, MergedDeviceRecord>(StringComparer.OrdinalIgnoreCase);

        var persistedEntities = await GetPersistedJellyfinDevicesAsync().ConfigureAwait(false);
        foreach (var entity in persistedEntities)
        {
            if (entity == null)
            {
                continue;
            }

            var devId = ReadObjStr(entity, "DeviceId", "Id");
            if (string.IsNullOrWhiteSpace(devId))
            {
                continue;
            }

            var uid = ReadObjGuid(entity, "UserId", "LastUserId");
            var devName = ReadObjStr(entity, "CustomName", "DeviceName", "Name");
            var appName = ReadObjStr(entity, "AppName");
            var appVer = ReadObjStr(entity, "AppVersion");
            var lastAct = ReadObjDateUtc(entity, "DateLastActivity", "DateModified", "DateCreated");
            var entityTok = ReadObjStr(entity, "AccessToken");

            var key = $"{devId}|{uid:N}";
            if (!merged.TryGetValue(key, out var rec))
            {
                rec = new MergedDeviceRecord
                {
                    DeviceId = devId,
                    DeviceName = devName,
                    AppName = appName,
                    AppVersion = appVer,
                    UserId = uid,
                    LastActivityUtc = lastAct,
                };
                merged[key] = rec;
            }
            else if (lastAct > rec.LastActivityUtc)
            {
                rec.LastActivityUtc = lastAct;
                if (!string.IsNullOrWhiteSpace(devName))
                {
                    rec.DeviceName = devName;
                }

                if (!string.IsNullOrWhiteSpace(appName))
                {
                    rec.AppName = appName;
                }
            }

            if (!string.IsNullOrWhiteSpace(callerToken)
                && !string.IsNullOrWhiteSpace(entityTok)
                && string.Equals(callerToken, entityTok, StringComparison.Ordinal))
            {
                rec.IsCurrentDevice = true;
            }
        }

        try
        {
            var liveSessions = _sessionManager.Sessions?.ToList();
            if (liveSessions != null)
            {
                var liveCutoff = DateTime.UtcNow.AddMinutes(-20);
                foreach (var sess in liveSessions)
                {
                    if (sess == null || string.IsNullOrWhiteSpace(sess.DeviceId))
                    {
                        continue;
                    }

                    var uid = sess.UserId;
                    if (uid == Guid.Empty)
                    {
                        continue;
                    }

                    var key = $"{sess.DeviceId}|{uid:N}";
                    var sessLastUtc = sess.LastActivityDate.Kind == DateTimeKind.Utc
                        ? sess.LastActivityDate
                        : sess.LastActivityDate.ToUniversalTime();

                    if (!merged.TryGetValue(key, out var rec))
                    {
                        rec = new MergedDeviceRecord
                        {
                            DeviceId = sess.DeviceId,
                            DeviceName = sess.DeviceName ?? string.Empty,
                            AppName = sess.Client ?? string.Empty,
                            AppVersion = sess.ApplicationVersion ?? string.Empty,
                            UserId = uid,
                            UserName = sess.UserName ?? string.Empty,
                            LastActivityUtc = sessLastUtc,
                        };
                        merged[key] = rec;
                    }
                    else
                    {
                        if (sessLastUtc > rec.LastActivityUtc)
                        {
                            rec.LastActivityUtc = sessLastUtc;
                        }

                        if (string.IsNullOrWhiteSpace(rec.DeviceName) && !string.IsNullOrWhiteSpace(sess.DeviceName))
                        {
                            rec.DeviceName = sess.DeviceName;
                        }

                        if (string.IsNullOrWhiteSpace(rec.AppName) && !string.IsNullOrWhiteSpace(sess.Client))
                        {
                            rec.AppName = sess.Client;
                        }

                        if (string.IsNullOrWhiteSpace(rec.AppVersion) && !string.IsNullOrWhiteSpace(sess.ApplicationVersion))
                        {
                            rec.AppVersion = sess.ApplicationVersion;
                        }

                        if (string.IsNullOrWhiteSpace(rec.UserName) && !string.IsNullOrWhiteSpace(sess.UserName))
                        {
                            rec.UserName = sess.UserName;
                        }
                    }

                    if (sessLastUtc >= liveCutoff || sess.NowPlayingItem != null)
                    {
                        rec.IsLive = true;
                    }

                    if (sess.NowPlayingItem != null)
                    {
                        var npSeries = ReadObjStr(sess.NowPlayingItem, "SeriesName");
                        var npTitle = ReadObjStr(sess.NowPlayingItem, "Name");
                        rec.NowPlaying = !string.IsNullOrWhiteSpace(npSeries) && !string.IsNullOrWhiteSpace(npTitle)
                            ? $"{npSeries} · {npTitle}"
                            : (!string.IsNullOrWhiteSpace(npTitle) ? npTitle : npSeries);
                    }

                    var liveTok = ReadObjStr(sess, "AccessToken");
                    if (!string.IsNullOrWhiteSpace(callerToken)
                        && !string.IsNullOrWhiteSpace(liveTok)
                        && string.Equals(callerToken, liveTok, StringComparison.Ordinal))
                    {
                        rec.IsCurrentDevice = true;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error scanning live sessions for Active Devices.");
        }

        foreach (var rec in merged.Values)
        {
            if (!rec.IsCurrentDevice
                && !string.IsNullOrWhiteSpace(effectiveCallerDeviceId)
                && string.Equals(rec.DeviceId, effectiveCallerDeviceId, StringComparison.OrdinalIgnoreCase)
                && (callerAuthUserId == Guid.Empty || rec.UserId == callerAuthUserId))
            {
                rec.IsCurrentDevice = true;
            }
        }

        var sorted = merged.Values
            .OrderByDescending(r => r.IsCurrentDevice)
            .ThenByDescending(r => !string.IsNullOrEmpty(r.NowPlaying))
            .ThenByDescending(r => r.IsLive)
            .ThenByDescending(r => r.LastActivityUtc)
            .Take(80)
            .ToList();

        var output = new List<object>(sorted.Count);
        foreach (var rec in sorted)
        {
            var jfUser = rec.UserId != Guid.Empty ? _userManager.GetUserById(rec.UserId) : null;
            var jfUsername = jfUser?.Username ?? rec.UserName;
            var isAdminUser = jfUser != null && StreamFlixStartupTask.IsUserAdminCompat(jfUser);
            profilesByJfUser.TryGetValue(rec.UserId, out var linkedProfile);

            var isGuestPass = false;
            string? guestPassId = null;
            string? guestPassLabel = null;
            if (rec.DeviceId.StartsWith("streamflix-guest-", StringComparison.OrdinalIgnoreCase))
            {
                isGuestPass = true;
                var rest = rec.DeviceId.Substring("streamflix-guest-".Length);
                var dashIdx = rest.IndexOf('-');
                var rawGpId = dashIdx > 0 ? rest.Substring(0, dashIdx) : rest;
                if (!string.IsNullOrWhiteSpace(rawGpId))
                {
                    guestPassId = rawGpId;
                    if (guestPassesById.TryGetValue(rawGpId, out var gp))
                    {
                        guestPassLabel = gp.Label;
                    }
                }
            }

            output.Add(new
            {
                deviceId = rec.DeviceId,
                deviceName = string.IsNullOrWhiteSpace(rec.DeviceName) ? "Unknown Device" : rec.DeviceName,
                appName = string.IsNullOrWhiteSpace(rec.AppName) ? "Jellyfin Client" : rec.AppName,
                appVersion = rec.AppVersion,
                userId = rec.UserId != Guid.Empty ? rec.UserId.ToString("N") : string.Empty,
                jellyfinUsername = jfUsername,
                isAdminUser,
                profileId = linkedProfile?.Id,
                profileName = linkedProfile?.Name,
                profileEmoji = linkedProfile?.AvatarEmoji,
                profileColorHex = SanitizeHexColor(linkedProfile?.AvatarColorHex),
                isKids = linkedProfile?.IsKids ?? false,
                isGuestPass,
                guestPassId,
                guestPassLabel,
                isLive = rec.IsLive,
                nowPlaying = rec.NowPlaying,
                isCurrentDevice = rec.IsCurrentDevice,
                lastActivityUtc = rec.LastActivityUtc > DateTime.MinValue
                    ? rec.LastActivityUtc.ToString("O", CultureInfo.InvariantCulture)
                    : string.Empty,
            });
        }

        return output;
    }

    private async Task<(int RevokedCount, bool WasCurrentDevice)> RevokeSingleJellyfinDeviceAsync(string targetDeviceId, Guid? targetUserId)
    {
        string? callerToken = null;
        string? callerDeviceId = null;
        try
        {
            var callerInfo = await _authContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
            if (callerInfo != null && !callerInfo.IsApiKey)
            {
                callerToken = callerInfo.Token;
                callerDeviceId = callerInfo.DeviceId;
            }
        }
        catch
        {
        }

        var wasCurrent = !string.IsNullOrWhiteSpace(callerDeviceId)
            && string.Equals(callerDeviceId, targetDeviceId, StringComparison.OrdinalIgnoreCase);

        var tokensToRevoke = new HashSet<string>(StringComparer.Ordinal);
        var entitiesToDelete = new List<object>();

        var persistedEntities = await GetPersistedJellyfinDevicesAsync().ConfigureAwait(false);
        foreach (var entity in persistedEntities)
        {
            if (entity == null)
            {
                continue;
            }

            var devId = ReadObjStr(entity, "DeviceId", "Id");
            if (!string.Equals(devId, targetDeviceId, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var uid = ReadObjGuid(entity, "UserId", "LastUserId");
            if (targetUserId.HasValue && uid != Guid.Empty && uid != targetUserId.Value)
            {
                continue;
            }

            var tok = ReadObjStr(entity, "AccessToken");
            if (!string.IsNullOrWhiteSpace(tok))
            {
                tokensToRevoke.Add(tok);
                if (!string.IsNullOrWhiteSpace(callerToken) && string.Equals(tok, callerToken, StringComparison.Ordinal))
                {
                    wasCurrent = true;
                }
            }

            entitiesToDelete.Add(entity);
        }

        try
        {
            var liveSessions = _sessionManager.Sessions?.ToList();
            if (liveSessions != null)
            {
                foreach (var sess in liveSessions)
                {
                    if (sess == null || !string.Equals(sess.DeviceId, targetDeviceId, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (targetUserId.HasValue && sess.UserId != Guid.Empty && sess.UserId != targetUserId.Value)
                    {
                        continue;
                    }

                    var liveTok = ReadObjStr(sess, "AccessToken");
                    if (!string.IsNullOrWhiteSpace(liveTok))
                    {
                        tokensToRevoke.Add(liveTok);
                        if (!string.IsNullOrWhiteSpace(callerToken) && string.Equals(liveTok, callerToken, StringComparison.Ordinal))
                        {
                            wasCurrent = true;
                        }
                    }

                    try
                    {
                        await _sessionManager.ReportSessionEnded(sess.Id).ConfigureAwait(false);
                    }
                    catch
                    {
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error scanning live sessions during single-device revoke.");
        }

        var revokedCount = 0;
        foreach (var tok in tokensToRevoke)
        {
            if (await LogoutSingleJellyfinTokenAsync(tok).ConfigureAwait(false))
            {
                revokedCount++;
            }
        }

        // On Jellyfin 10.11+ / 12.x, also invoke IDeviceManager.DeleteDevice(entity) if available
        if (entitiesToDelete.Count > 0)
        {
            try
            {
                var dm = HttpContext.RequestServices.GetService(typeof(MediaBrowser.Controller.Devices.IDeviceManager));
                if (dm != null)
                {
                    var deleteMethod = dm.GetType().GetMethods()
                        .FirstOrDefault(m => string.Equals(m.Name, "DeleteDevice", StringComparison.Ordinal) && m.GetParameters().Length == 1);
                    if (deleteMethod != null)
                    {
                        var expectedType = deleteMethod.GetParameters()[0].ParameterType;
                        foreach (var entity in entitiesToDelete)
                        {
                            if (!expectedType.IsInstanceOfType(entity))
                            {
                                continue;
                            }

                            try
                            {
                                var delRes = deleteMethod.Invoke(dm, new[] { entity });
                                if (delRes is Task delTask)
                                {
                                    await delTask.ConfigureAwait(false);
                                }

                                revokedCount = Math.Max(1, revokedCount);
                            }
                            catch
                            {
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "StreamFlix: non-fatal error invoking DeleteDevice during single-device revoke.");
            }
        }

        if (targetDeviceId.StartsWith("streamflix-guest-", StringComparison.OrdinalIgnoreCase) && tokensToRevoke.Count > 0)
        {
            foreach (var kv in ActiveGuestTokens.ToArray())
            {
                var remaining = kv.Value.Where(t => !tokensToRevoke.Contains(t)).ToList();
                if (remaining.Count == 0)
                {
                    ActiveGuestTokens.TryRemove(kv.Key, out _);
                }
                else if (remaining.Count != kv.Value.Count)
                {
                    ActiveGuestTokens[kv.Key] = new ConcurrentBag<string>(remaining);
                }
            }
        }

        return (revokedCount, wasCurrent);
    }

    private async Task<List<object>> GetPersistedJellyfinDevicesAsync()
    {
        var list = new List<object>();
        try
        {
            var dmType = typeof(MediaBrowser.Controller.Devices.IDeviceManager);
            var dm = HttpContext.RequestServices.GetService(dmType);
            if (dm == null)
            {
                return list;
            }

            var getDevicesMethod = dmType.GetMethods()
                .FirstOrDefault(m => string.Equals(m.Name, "GetDevices", StringComparison.Ordinal) && m.GetParameters().Length == 1)
                ?? dm.GetType().GetMethods()
                    .FirstOrDefault(m => string.Equals(m.Name, "GetDevices", StringComparison.Ordinal) && m.GetParameters().Length == 1);

            if (getDevicesMethod != null)
            {
                var queryType = getDevicesMethod.GetParameters()[0].ParameterType;
                var queryInstance = Activator.CreateInstance(queryType);
                if (queryInstance != null)
                {
                    var callResult = getDevicesMethod.Invoke(dm, new[] { queryInstance });
                    if (callResult is Task taskResult)
                    {
                        await taskResult.ConfigureAwait(false);
                        callResult = taskResult.GetType().GetProperty("Result")?.GetValue(taskResult);
                    }

                    var itemsProp = callResult?.GetType().GetProperty("Items")?.GetValue(callResult) as System.Collections.IEnumerable
                        ?? (callResult as System.Collections.IEnumerable);
                    if (itemsProp != null)
                    {
                        foreach (var item in itemsProp)
                        {
                            if (item != null)
                            {
                                list.Add(item);
                            }
                        }

                        return list;
                    }
                }
            }

            var fallbackMethod = dmType.GetMethod("GetDevicesForUser", new[] { typeof(Guid?) })
                ?? dm.GetType().GetMethod("GetDevicesForUser", new[] { typeof(Guid?) });
            if (fallbackMethod != null)
            {
                var fbResult = fallbackMethod.Invoke(dm, new object?[] { null });
                if (fbResult is Task fbTask)
                {
                    await fbTask.ConfigureAwait(false);
                    fbResult = fbTask.GetType().GetProperty("Result")?.GetValue(fbTask);
                }

                if (fbResult is System.Collections.IEnumerable fbItems)
                {
                    foreach (var item in fbItems)
                    {
                        if (item != null)
                        {
                            list.Add(item);
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal error reading persisted devices from IDeviceManager.");
        }

        return list;
    }

    private static string ReadObjStr(object obj, params string[] propNames)
    {
        var t = obj.GetType();
        foreach (var name in propNames)
        {
            var p = t.GetProperty(name);
            if (p != null && p.GetValue(obj) is object val)
            {
                var s = val.ToString();
                if (!string.IsNullOrWhiteSpace(s))
                {
                    return s.Trim();
                }
            }
        }

        return string.Empty;
    }

    private static Guid ReadObjGuid(object obj, params string[] propNames)
    {
        var t = obj.GetType();
        foreach (var name in propNames)
        {
            var p = t.GetProperty(name);
            if (p == null)
            {
                continue;
            }

            var raw = p.GetValue(obj);
            if (raw is Guid g && g != Guid.Empty)
            {
                return g;
            }

            if (raw != null && Guid.TryParse(raw.ToString(), out var parsed) && parsed != Guid.Empty)
            {
                return parsed;
            }
        }

        return Guid.Empty;
    }

    private static DateTime ReadObjDateUtc(object obj, params string[] propNames)
    {
        var t = obj.GetType();
        foreach (var name in propNames)
        {
            var p = t.GetProperty(name);
            if (p == null)
            {
                continue;
            }

            var raw = p.GetValue(obj);
            if (raw is DateTime dt && dt > DateTime.MinValue)
            {
                return dt.Kind == DateTimeKind.Utc ? dt : dt.ToUniversalTime();
            }

            if (raw is DateTimeOffset dto && dto > DateTimeOffset.MinValue)
            {
                return dto.UtcDateTime;
            }
        }

        return DateTime.MinValue;
    }
}
