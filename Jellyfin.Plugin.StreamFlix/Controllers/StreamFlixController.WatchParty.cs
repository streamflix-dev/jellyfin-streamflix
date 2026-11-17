using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Mime;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;
using Jellyfin.Plugin.StreamFlix.Services;
using MediaBrowser.Controller.Entities.TV;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.StreamFlix.Controllers;

// Real-Time Server-Authoritative Watch Together (Watch Party) Engine
public partial class StreamFlixController
{
    [HttpGet("WatchParty/Rooms")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> ListWatchPartyRooms([FromQuery] string? profileId = null)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var authError = ValidateWatchPartyAccess(config, caller, profileId, out _);
        if (authError != null)
        {
            return authError;
        }

        var rooms = StreamFlixWatchPartyService.ListActiveRooms();
        return Ok(new
        {
            serverNowUtcMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            rooms,
        });
    }

    [HttpPost("WatchParty/Create")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> CreateWatchParty([FromBody] CreateWatchPartyRoomRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var authError = ValidateWatchPartyAccess(config, caller, request?.ProfileId, out var resolvedProfile);
        if (authError != null)
        {
            return authError;
        }

        var participant = BuildParticipantIdentity(
            caller,
            resolvedProfile,
            request?.ParticipantId,
            request?.DisplayName,
            request?.AvatarEmoji,
            request?.AvatarColorHex,
            request?.StartPositionSeconds,
            isBuffering: false);

        var (itemId, itemName, seriesName, seasonNum, episodeNum, itemType, runTimeTicks) = EnrichMediaMetadata(
            request?.ItemId,
            request?.ItemName,
            request?.SeriesName,
            request?.SeasonNumber,
            request?.EpisodeNumber,
            request?.ItemType,
            request?.RunTimeTicks);

        var (room, errorMessage) = StreamFlixWatchPartyService.CreateRoom(
            new StreamFlixWatchPartyService.CreateRoomInput
            {
                Name = request?.Name ?? string.Empty,
                HostControlOnly = request?.HostControlOnly == true,
                ItemId = itemId,
                ItemName = itemName,
                SeriesName = seriesName,
                SeasonNumber = seasonNum,
                EpisodeNumber = episodeNum,
                ItemType = itemType,
                RunTimeTicks = runTimeTicks,
                StartPositionSeconds = request?.StartPositionSeconds,
                IsPlaying = request?.IsPlaying,
            },
            participant);

        if (room == null)
        {
            return BadRequest(new { message = errorMessage ?? "Could not create Watch Party room." });
        }

        return Ok(new
        {
            active = true,
            participantId = participant.ParticipantId,
            room,
            rooms = StreamFlixWatchPartyService.ListActiveRooms(),
        });
    }

    [HttpPost("WatchParty/Join")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> JoinWatchParty([FromBody] JoinWatchPartyRoomRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || string.IsNullOrWhiteSpace(request.RoomId))
        {
            return BadRequest(new { message = "Enter a Watch Party room code to join." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var authError = ValidateWatchPartyAccess(config, caller, request.ProfileId, out var resolvedProfile);
        if (authError != null)
        {
            return authError;
        }

        var participant = BuildParticipantIdentity(
            caller,
            resolvedProfile,
            request.ParticipantId,
            request.DisplayName,
            request.AvatarEmoji,
            request.AvatarColorHex,
            positionSeconds: null,
            isBuffering: false);

        var (room, errorMessage) = StreamFlixWatchPartyService.JoinRoom(request.RoomId, participant);
        if (room == null)
        {
            return NotFound(new { code = "room_not_found", message = errorMessage ?? "That Watch Party room is no longer active." });
        }

        return Ok(new
        {
            active = true,
            participantId = participant.ParticipantId,
            room,
            rooms = StreamFlixWatchPartyService.ListActiveRooms(),
        });
    }

    [HttpPost("WatchParty/Leave")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> LeaveWatchParty([FromBody] LeaveWatchPartyRoomRequest? request)
    {
        SetNoStoreSecurityHeaders();
        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        var resolvedProfile = ResolveWatchPartyProfile(config, caller, request?.ProfileId);
        var participant = BuildParticipantIdentity(
            caller,
            resolvedProfile,
            request?.ParticipantId,
            displayNameOverride: null,
            emojiOverride: null,
            colorOverride: null,
            positionSeconds: null,
            isBuffering: null);

        var isLeaveAdmin = IsEffectiveActiveAdmin(caller);
        StreamFlixWatchPartyService.LeaveRoom(
            request?.RoomId,
            participant.ParticipantId,
            request?.CloseRoom == true,
            participant.ProfileId,
            isLeaveAdmin);
        return Ok(new
        {
            active = false,
            rooms = StreamFlixWatchPartyService.ListActiveRooms(),
        });
    }

    [HttpPost("WatchParty/Delete")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> DeleteWatchParty([FromBody] DeleteWatchPartyRoomRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || string.IsNullOrWhiteSpace(request.RoomId))
        {
            return BadRequest(new { message = "Missing Watch Party room code." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        var resolvedProfile = ResolveWatchPartyProfile(config, caller, request.ProfileId);
        var participant = BuildParticipantIdentity(
            caller,
            resolvedProfile,
            request.ParticipantId,
            displayNameOverride: null,
            emojiOverride: null,
            colorOverride: null,
            positionSeconds: null,
            isBuffering: null);

        var isGuest = IsGuestSession(caller);
        var isAdmin = !isGuest && IsEffectiveActiveAdmin(caller);
        var (deleted, statusCode, errorMessage) = StreamFlixWatchPartyService.DeleteRoom(
            request.RoomId,
            participant,
            isAdmin,
            isGuest);

        if (!deleted || statusCode != 200)
        {
            return StatusCode(statusCode == 200 ? 403 : statusCode, new
            {
                deleted = false,
                message = errorMessage ?? "Could not delete Watch Party room.",
                rooms = StreamFlixWatchPartyService.ListActiveRooms(),
            });
        }

        return Ok(new
        {
            deleted = true,
            active = false,
            rooms = StreamFlixWatchPartyService.ListActiveRooms(),
        });
    }

    [HttpPost("WatchParty/Command")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> SendWatchPartyCommand([FromBody] WatchPartyCommandRequest? request)
    {
        SetNoStoreSecurityHeaders();
        if (request == null || string.IsNullOrWhiteSpace(request.RoomId) || string.IsNullOrWhiteSpace(request.Action))
        {
            return BadRequest(new { message = "Missing Watch Party room or command." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var authError = ValidateWatchPartyAccess(config, caller, request.ProfileId, out var resolvedProfile);
        if (authError != null)
        {
            return authError;
        }

        var participant = BuildParticipantIdentity(
            caller,
            resolvedProfile,
            request.ParticipantId,
            request.DisplayName,
            request.AvatarEmoji,
            request.AvatarColorHex,
            request.PositionSeconds,
            request.IsBuffering);

        var (itemId, itemName, seriesName, seasonNum, episodeNum, itemType, runTimeTicks) = string.Equals(request.Action.Trim(), "set_media", StringComparison.OrdinalIgnoreCase)
            ? EnrichMediaMetadata(
                request.ItemId,
                request.ItemName,
                request.SeriesName,
                request.SeasonNumber,
                request.EpisodeNumber,
                request.ItemType,
                request.RunTimeTicks)
            : (request.ItemId, request.ItemName, request.SeriesName, request.SeasonNumber, request.EpisodeNumber, request.ItemType, request.RunTimeTicks);

        var (room, statusCode, errorMessage) = StreamFlixWatchPartyService.ApplyCommand(
            request.RoomId,
            participant,
            new StreamFlixWatchPartyService.CommandInput
            {
                Action = request.Action,
                ActionId = request.ActionId,
                PositionSeconds = request.PositionSeconds,
                IsPlaying = request.IsPlaying,
                HostControlOnly = request.HostControlOnly,
                ItemId = itemId,
                ItemName = itemName,
                SeriesName = seriesName,
                SeasonNumber = seasonNum,
                EpisodeNumber = episodeNum,
                ItemType = itemType,
                RunTimeTicks = runTimeTicks,
                IsBuffering = request.IsBuffering,
            },
            IsEffectiveActiveAdmin(caller));

        if (statusCode != 200 || room == null)
        {
            return StatusCode(statusCode == 200 ? 404 : statusCode, new
            {
                active = room != null,
                room,
                message = errorMessage ?? "Watch Party command could not be applied.",
            });
        }

        return Ok(new
        {
            active = true,
            participantId = participant.ParticipantId,
            room,
        });
    }

    [HttpGet("WatchParty/State")]
    [AllowAnonymous]
    [Produces(MediaTypeNames.Application.Json)]
    public async Task<ActionResult<object>> GetWatchPartyState(
        [FromQuery] string roomId,
        [FromQuery] string? participantId = null,
        [FromQuery] string? profileId = null,
        [FromQuery] long sinceVersion = 0,
        [FromQuery] int waitMs = 0,
        [FromQuery] double? pos = null,
        [FromQuery] bool? buffering = null)
    {
        SetNoStoreSecurityHeaders();
        if (string.IsNullOrWhiteSpace(roomId))
        {
            return BadRequest(new { active = false, message = "Missing roomId." });
        }

        var config = Config;
        var caller = await GetCallerAsync(config).ConfigureAwait(false);
        var authError = ValidateWatchPartyAccess(config, caller, profileId, out var resolvedProfile);
        if (authError != null)
        {
            return authError;
        }

        var participant = !string.IsNullOrWhiteSpace(participantId)
            ? BuildParticipantIdentity(
                caller,
                resolvedProfile,
                participantId,
                displayNameOverride: null,
                emojiOverride: null,
                colorOverride: null,
                positionSeconds: pos,
                isBuffering: buffering)
            : null;

        var room = await StreamFlixWatchPartyService.WaitForRoomStateAsync(
            roomId,
            participant,
            sinceVersion,
            waitMs,
            HttpContext.RequestAborted).ConfigureAwait(false);

        if (room == null)
        {
            return Ok(new
            {
                active = false,
                serverNowUtcMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                room = (object?)null,
            });
        }

        return Ok(new
        {
            active = true,
            serverNowUtcMs = room.ServerNowUtcMs,
            room,
        });
    }

    private ActionResult? ValidateWatchPartyAccess(
        PluginConfiguration config,
        CallerContext caller,
        string? requestedProfileId,
        out StreamFlixProfileConfig? resolvedProfile)
    {
        resolvedProfile = null;
        if (!HasHouseholdAccess(config, caller))
        {
            return GoogleRequired(config);
        }

        if (!config.EnableWatchTogether)
        {
            return StatusCode(403, new { code = "watchparty_disabled", message = "Watch Together is turned off in StreamFlix settings." });
        }

        resolvedProfile = ResolveWatchPartyProfile(config, caller, requestedProfileId);
        if (resolvedProfile?.IsKids == true)
        {
            return StatusCode(403, new { code = "kids_forbidden", message = "Watch Together is disabled for Kids profiles." });
        }

        return null;
    }

    private StreamFlixProfileConfig? ResolveWatchPartyProfile(
        PluginConfiguration config,
        CallerContext caller,
        string? requestedProfileId)
    {
        if (IsGuestSession(caller))
        {
            return FindProfile(config, caller.Session?.LockedProfileId);
        }

        if (!IsEffectiveActiveAdmin(caller) && caller.JellyfinUser != null)
        {
            var callerUid = caller.JellyfinUser.Id.ToString("N");
            var candidates = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                .Where(p => string.Equals(p.JellyfinUserId, callerUid, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (!string.IsNullOrWhiteSpace(requestedProfileId))
            {
                var matchedRequested = candidates.FirstOrDefault(p =>
                    string.Equals(p.Id, requestedProfileId, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(p.Name, requestedProfileId, StringComparison.OrdinalIgnoreCase));
                if (matchedRequested != null)
                {
                    return matchedRequested;
                }
            }

            return candidates.FirstOrDefault();
        }

        var profile = FindProfile(config, requestedProfileId);
        if (profile == null && caller.JellyfinUser != null)
        {
            var callerUid = caller.JellyfinUser.Id.ToString("N");
            profile = (config.Profiles ?? new List<StreamFlixProfileConfig>())
                .FirstOrDefault(p => string.Equals(p.JellyfinUserId, callerUid, StringComparison.OrdinalIgnoreCase));
        }

        return profile;
    }

    private StreamFlixWatchPartyService.ParticipantUpdateInput BuildParticipantIdentity(
        CallerContext caller,
        StreamFlixProfileConfig? profile,
        string? rawParticipantId,
        string? displayNameOverride,
        string? emojiOverride,
        string? colorOverride,
        double? positionSeconds,
        bool? isBuffering)
    {
        var jfUid = caller.JellyfinUser != null
            ? caller.JellyfinUser.Id.ToString("N")
            : (profile?.JellyfinUserId ?? caller.Session?.JellyfinUserId ?? string.Empty);

        var seed = !string.IsNullOrEmpty(profile?.Id)
            ? profile!.Id
            : (!string.IsNullOrEmpty(jfUid) ? jfUid : (caller.Session?.GuestPassId ?? "viewer"));

        var participantId = StreamFlixWatchPartyService.SanitizeParticipantId(rawParticipantId, seed);
        var displayName = !string.IsNullOrWhiteSpace(profile?.Name)
            ? profile!.Name
            : (!string.IsNullOrWhiteSpace(displayNameOverride)
                ? displayNameOverride!.Trim()
                : (caller.JellyfinUser?.Username ?? caller.Session?.Username ?? "Viewer"));

        var emoji = !string.IsNullOrWhiteSpace(profile?.AvatarEmoji)
            ? profile!.AvatarEmoji
            : (!string.IsNullOrWhiteSpace(emojiOverride) ? emojiOverride!.Trim() : "🎬");

        var color = SanitizeHexColor(!string.IsNullOrWhiteSpace(profile?.AvatarColorHex) ? profile!.AvatarColorHex : colorOverride);

        return new StreamFlixWatchPartyService.ParticipantUpdateInput
        {
            ParticipantId = participantId,
            JellyfinUserId = jfUid,
            ProfileId = profile?.Id ?? string.Empty,
            DisplayName = displayName,
            AvatarEmoji = emoji,
            AvatarColorHex = color,
            PositionSeconds = positionSeconds,
            IsBuffering = isBuffering,
        };
    }

    private (string? ItemId, string? ItemName, string? SeriesName, int? SeasonNumber, int? EpisodeNumber, string? ItemType, long? RunTimeTicks) EnrichMediaMetadata(
        string? itemId,
        string? itemName,
        string? seriesName,
        int? seasonNumber,
        int? episodeNumber,
        string? itemType,
        long? runTimeTicks)
    {
        if (string.IsNullOrWhiteSpace(itemId) || !Guid.TryParse(itemId.Trim(), out var parsedId))
        {
            return (itemId, itemName, seriesName, seasonNumber, episodeNumber, itemType, runTimeTicks);
        }

        try
        {
            var libItem = _libraryManager.GetItemById(parsedId);
            if (libItem != null)
            {
                var resolvedName = !string.IsNullOrWhiteSpace(itemName) ? itemName : libItem.Name;
                var resolvedType = !string.IsNullOrWhiteSpace(itemType) ? itemType : libItem.GetType().Name;
                var resolvedTicks = runTimeTicks is > 0 ? runTimeTicks : libItem.RunTimeTicks;
                var resolvedSeason = seasonNumber ?? libItem.ParentIndexNumber;
                var resolvedEp = episodeNumber ?? libItem.IndexNumber;
                var resolvedSeries = seriesName;
                if (string.IsNullOrWhiteSpace(resolvedSeries) && libItem is Episode ep)
                {
                    resolvedSeries = ep.SeriesName;
                }

                return (parsedId.ToString("N"), resolvedName, resolvedSeries, resolvedSeason, resolvedEp, resolvedType, resolvedTicks);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: non-fatal lookup skipped for Watch Party item {ItemId}.", itemId);
        }

        return (parsedId.ToString("N"), itemName, seriesName, seasonNumber, episodeNumber, itemType, runTimeTicks);
    }
}
