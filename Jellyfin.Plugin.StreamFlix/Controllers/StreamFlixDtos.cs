using System.Collections.Generic;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.StreamFlix.Configuration;

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

    public string? ClientName { get; set; }

    public string? ClientVersion { get; set; }
}

public class ElevateAdminRequest
{
    public string? DeviceId { get; set; }

    public string? DeviceName { get; set; }

    public string? AppName { get; set; }

    public string? AppVersion { get; set; }

    public string? Pin { get; set; }
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

public class BeginOidcRequest
{
    public string? ReturnWebBase { get; set; }

    public string? PendingProfileId { get; set; }

    public string? LoginHint { get; set; }
}

public class CompleteOidcRequest
{
    public string? StateId { get; set; }

    public string? PollSecret { get; set; }
}

public class ActivateProfileRequest
{
    public string ProfileId { get; set; } = string.Empty;

    public string? Pin { get; set; }

    public string? PinCode { get; set; }

    public string? ExitingKidsProfileId { get; set; }

    public string? AdultExitPin { get; set; }

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

public class VerifyAdultPinRequest
{
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

    public bool? KidsExitPinRequired { get; set; }

    public string? MaturityRating { get; set; }

    public string? Pin { get; set; }

    public string? PinCode { get; set; }

    /// <summary>
    /// Gets or sets the profile's current PIN, required to edit a PIN-protected profile unless the caller is an admin.
    /// </summary>
    public string? CurrentPin { get; set; }

    /// <summary>
    /// Gets or sets the profile account lock identifier (email or username). <c>null</c> leaves it unchanged, an empty string clears it.
    /// </summary>
    public string? GoogleAccountEmail { get; set; }

    /// <summary>
    /// Gets or sets the optional authentication provider kind for <see cref="GoogleAccountEmail"/> (<c>google</c>, <c>oidc</c>, <c>jellyfin</c>, or empty).
    /// </summary>
    public string? AccountLockKind { get; set; }

    public bool AutoplayNextEpisode { get; set; } = true;

    public bool AutoplayPreviews { get; set; } = true;

    public List<string>? AllowedLibraryIds { get; set; }

    public int? SeerrRequestQuota { get; set; }

    public string? BedtimeStart { get; set; }

    public string? BedtimeEnd { get; set; }

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

    public string? CustomAccentColor { get; set; }

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

    public bool ShowLibrariesInNav { get; set; } = true;

    public List<string>? NavHiddenBuiltIns { get; set; }

    public List<string>? NavLibraryIds { get; set; }

    public bool EnableCustomOidc { get; set; }

    public string? OidcProviderName { get; set; }

    public string? OidcIssuerUrl { get; set; }

    public string? OidcClientId { get; set; }

    public string? OidcClientSecret { get; set; }

    public bool ClearOidcClientSecret { get; set; }

    public bool OidcRequireAllowlist { get; set; }

    public List<string>? ApprovedOidcUsers { get; set; }

    public bool EnableGuestPasses { get; set; } = true;

    public bool EnableWatchTogether { get; set; } = true;

    public bool EnableSeerr { get; set; }

    public string? SeerrUrl { get; set; }

    public string? SeerrApiKey { get; set; }

    public bool ClearSeerrApiKey { get; set; }

    public bool SeerrAllowKids { get; set; }

    public bool SeerrAllowGuests { get; set; }
}

public class ImportConfigBackupRequest
{
    public string? CustomBrandName { get; set; }

    public string? CustomAccentColor { get; set; }

    public bool? EnableStreamFlixUi { get; set; }

    public bool? EnableGoogleSignIn { get; set; }

    public bool? AllowStandardJellyfinLogin { get; set; }

    public bool? AllowAdminFallbackLogin { get; set; }

    public bool? AdminFallbackLanOnly { get; set; }

    public bool? BypassLoginGateOnLan { get; set; }

    public bool? AutoProvisionJellyfinUsers { get; set; }

    public List<string>? ApprovedGoogleAccounts { get; set; }

    public int? SessionLifetimeDays { get; set; }

    public string? Top10SelectionMode { get; set; }

    public int? HeroRotationSeconds { get; set; }

    public int? HeroSlideCount { get; set; }

    public string? HeroSelectionMode { get; set; }

    public string? HeroContentType { get; set; }

    public List<string>? HeroLibraryIds { get; set; }

    public bool? ShowLibrariesInNav { get; set; }

    public List<string>? NavHiddenBuiltIns { get; set; }

    public List<string>? NavLibraryIds { get; set; }

    public bool? EnableCustomOidc { get; set; }

    public string? OidcProviderName { get; set; }

    public string? OidcIssuerUrl { get; set; }

    public string? OidcClientId { get; set; }

    public bool? OidcRequireAllowlist { get; set; }

    public List<string>? ApprovedOidcUsers { get; set; }

    public bool? EnableGuestPasses { get; set; }

    public bool? EnableWatchTogether { get; set; }

    public bool? EnableSeerr { get; set; }

    public string? SeerrUrl { get; set; }

    public bool? SeerrAllowKids { get; set; }

    public bool? SeerrAllowGuests { get; set; }

    public List<StreamFlixProfileConfig>? Profiles { get; set; }
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

public class TestSeerrConfigRequest
{
    [JsonPropertyName("seerrUrl")]
    public string? SeerrUrl { get; set; }

    [JsonPropertyName("seerrApiKey")]
    public string? SeerrApiKey { get; set; }
}

public class SubmitSeerrMediaRequest
{
    [JsonPropertyName("tmdbId")]
    public int TmdbId { get; set; }

    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = string.Empty;

    [JsonPropertyName("seasons")]
    public List<int>? Seasons { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }

    [JsonPropertyName("is4k")]
    public bool? Is4k { get; set; }

    [JsonPropertyName("serverId")]
    public int? ServerId { get; set; }
}

public class CancelSeerrMediaRequest
{
    [JsonPropertyName("requestId")]
    public int RequestId { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }
}

public class RevokeDeviceRequest
{
    public string DeviceId { get; set; } = string.Empty;

    public string? UserId { get; set; }
}

public class CreateWatchPartyRoomRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("participantId")]
    public string? ParticipantId { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }

    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }

    [JsonPropertyName("avatarEmoji")]
    public string? AvatarEmoji { get; set; }

    [JsonPropertyName("avatarColorHex")]
    public string? AvatarColorHex { get; set; }

    [JsonPropertyName("hostControlOnly")]
    public bool HostControlOnly { get; set; }

    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    [JsonPropertyName("itemName")]
    public string? ItemName { get; set; }

    [JsonPropertyName("seriesName")]
    public string? SeriesName { get; set; }

    [JsonPropertyName("seasonNumber")]
    public int? SeasonNumber { get; set; }

    [JsonPropertyName("episodeNumber")]
    public int? EpisodeNumber { get; set; }

    [JsonPropertyName("itemType")]
    public string? ItemType { get; set; }

    [JsonPropertyName("runTimeTicks")]
    public long? RunTimeTicks { get; set; }

    [JsonPropertyName("startPositionSeconds")]
    public double? StartPositionSeconds { get; set; }

    [JsonPropertyName("isPlaying")]
    public bool? IsPlaying { get; set; }
}

public class JoinWatchPartyRoomRequest
{
    [JsonPropertyName("roomId")]
    public string RoomId { get; set; } = string.Empty;

    [JsonPropertyName("participantId")]
    public string? ParticipantId { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }

    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }

    [JsonPropertyName("avatarEmoji")]
    public string? AvatarEmoji { get; set; }

    [JsonPropertyName("avatarColorHex")]
    public string? AvatarColorHex { get; set; }
}

public class LeaveWatchPartyRoomRequest
{
    [JsonPropertyName("roomId")]
    public string? RoomId { get; set; }

    [JsonPropertyName("participantId")]
    public string? ParticipantId { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }

    [JsonPropertyName("closeRoom")]
    public bool CloseRoom { get; set; }
}

public class WatchPartyCommandRequest
{
    [JsonPropertyName("roomId")]
    public string RoomId { get; set; } = string.Empty;

    [JsonPropertyName("participantId")]
    public string? ParticipantId { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }

    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }

    [JsonPropertyName("avatarEmoji")]
    public string? AvatarEmoji { get; set; }

    [JsonPropertyName("avatarColorHex")]
    public string? AvatarColorHex { get; set; }

    [JsonPropertyName("action")]
    public string Action { get; set; } = string.Empty;

    [JsonPropertyName("actionId")]
    public string? ActionId { get; set; }

    [JsonPropertyName("positionSeconds")]
    public double? PositionSeconds { get; set; }

    [JsonPropertyName("isPlaying")]
    public bool? IsPlaying { get; set; }

    [JsonPropertyName("hostControlOnly")]
    public bool? HostControlOnly { get; set; }

    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    [JsonPropertyName("itemName")]
    public string? ItemName { get; set; }

    [JsonPropertyName("seriesName")]
    public string? SeriesName { get; set; }

    [JsonPropertyName("seasonNumber")]
    public int? SeasonNumber { get; set; }

    [JsonPropertyName("episodeNumber")]
    public int? EpisodeNumber { get; set; }

    [JsonPropertyName("itemType")]
    public string? ItemType { get; set; }

    [JsonPropertyName("runTimeTicks")]
    public long? RunTimeTicks { get; set; }

    [JsonPropertyName("isBuffering")]
    public bool? IsBuffering { get; set; }
}

public class DeleteWatchPartyRoomRequest
{
    [JsonPropertyName("roomId")]
    public string RoomId { get; set; } = string.Empty;

    [JsonPropertyName("participantId")]
    public string? ParticipantId { get; set; }

    [JsonPropertyName("profileId")]
    public string? ProfileId { get; set; }
}
