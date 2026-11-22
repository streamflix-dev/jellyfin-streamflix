using System.Collections.Generic;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.StreamFlix.Configuration;

/// <summary>
/// Represents a StreamFlix profile backed by a real Jellyfin Server User so each profile has
/// its own independent Watch History (`Continue Watching`, `Next Up`, `Played`, `Favorites`).
/// </summary>
public class StreamFlixProfileConfig
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int AvatarColorIndex { get; set; }

    public int AvatarIconIndex { get; set; }

    public string AvatarEmoji { get; set; } = "🎬";

    public string AvatarColorHex { get; set; } = "#E50914";

    public bool IsKids { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether exiting this Kids profile requires an adult profile PIN (or grown-up verification check).
    /// </summary>
    public bool KidsExitPinRequired { get; set; } = true;

    public string MaturityRating { get; set; } = "TV-MA / R (All Maturity Levels)";

    public string? PinCode { get; set; }

    /// <summary>
    /// Gets or sets an optional account identifier (email or username) that this profile is locked to.
    /// Kept under the XML property name <c>GoogleAccountEmail</c> for backward compatibility.
    /// </summary>
    public string? GoogleAccountEmail { get; set; }

    /// <summary>
    /// Gets or sets the optional authentication provider kind for <see cref="GoogleAccountEmail"/>:
    /// <c>google</c>, <c>oidc</c>, <c>jellyfin</c>, or empty/null for automatic SSO email resolution.
    /// </summary>
    public string? AccountLockKind { get; set; }

    public bool AutoplayNextEpisode { get; set; } = true;

    public bool AutoplayPreviews { get; set; } = true;

    /// <summary>
    /// Gets or sets optional Jellyfin Library/View IDs that this profile is permitted to access. Empty means all libraries.
    /// </summary>
    public List<string> AllowedLibraryIds { get; set; } = new();

    /// <summary>
    /// Gets or sets the Seerr request quota per rolling 7 days for this profile (<c>0</c> = unlimited, <c>-1</c> = disabled for this profile).
    /// </summary>
    public int SeerrRequestQuota { get; set; }

    /// <summary>
    /// Gets or sets optional daily bedtime lock start in 24-hour <c>HH:mm</c> local time (e.g. <c>20:30</c>). Empty disables bedtime lock.
    /// </summary>
    public string BedtimeStart { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets optional daily bedtime lock end in 24-hour <c>HH:mm</c> local time (e.g. <c>06:30</c>).
    /// </summary>
    public string BedtimeEnd { get; set; } = string.Empty;

    public string? JellyfinUserId { get; set; }

    public string? JellyfinUsername { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the linked Jellyfin Server User was automatically provisioned by StreamFlix
    /// (rather than created manually by the server owner in Jellyfin Dashboard -> Users).
    /// </summary>
    public bool IsPluginCreatedJellyfinUser { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether initial playback permissions have already been applied to a plugin-created Jellyfin user,
    /// ensuring subsequent permission adjustments made by an administrator in Jellyfin Dashboard are preserved.
    /// </summary>
    public bool PermissionsInitialized { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether initial Live TV access permission has been synchronized on a plugin-created Jellyfin user,
    /// ensuring pre-existing plugin-managed household profiles receive Live TV access once when Live TV is enabled while preserving subsequent admin changes.
    /// </summary>
    public bool LiveTvPermissionInitialized { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this profile was automatically provisioned on demand when an existing Jellyfin user signed in,
    /// keeping remote/personal Jellyfin accounts scoped to their own owner (and Administrators) without cluttering shared LAN-bypass household pickers.
    /// </summary>
    public bool AutoProvisionedFromJellyfinLogin { get; set; }
}

/// <summary>
/// Represents a time-limited, revocable Guest Pass locked to a single non-administrator StreamFlix profile.
/// </summary>
public class StreamFlixGuestPass
{
    public string Id { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public string ProfileId { get; set; } = string.Empty;

    public string ProfileNameSnapshot { get; set; } = string.Empty;

    public string CreatedAtUtc { get; set; } = string.Empty;

    public string ExpiresAtUtc { get; set; } = string.Empty;

    public int MaxRedemptions { get; set; }

    public int RedemptionCount { get; set; }

    public string? LastRedeemedAtUtc { get; set; }

    public bool Revoked { get; set; }

    public string? RevokedAtUtc { get; set; }

    public string SecretNonce { get; set; } = string.Empty;
}

/// <summary>
/// Plugin configuration stored directly on the Jellyfin Server (`plugins/configurations/Jellyfin.Plugin.StreamFlix.xml`).
/// Lists are initialized empty in the parameterless constructor so .NET XmlSerializer does not re-add deleted
/// default profiles when deserializing configuration from disk.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    public PluginConfiguration()
    {
        EnableStreamFlixUi = true;
        CustomBrandName = string.Empty;
        CustomAccentColor = "#E50914";
        RequireGoogleAuth = true;
        EnableGoogleSignIn = true;
        AllowStandardJellyfinLogin = false;
        AllowAdminFallbackLogin = false;
        AdminFallbackLanOnly = false;
        BypassLoginGateOnLan = false;
        TreatTailscaleAsLocalLan = true;
        FirstGoogleAccountClaimed = false;
        AutoProvisionJellyfinUsers = true;
        ProfilesSeeded = false;
        GoogleClientId = string.Empty;
        GoogleClientSecret = string.Empty;
        ApprovedGoogleAccounts = new List<string>();
        Profiles = new List<StreamFlixProfileConfig>();
        DeletedProfileIds = new List<string>();
        SessionSigningKey = string.Empty;
        SessionVersion = 1;
        SessionLifetimeDays = 30;
        Top10SelectionMode = "most_played";
        HeroRotationSeconds = 9;
        HeroSlideCount = 8;
        HeroSelectionMode = "recent";
        HeroContentType = "all";
        HeroLibraryIds = new List<string>();
        EnableHeroTrailerPreview = true;
        MigratedHeroYouTubeTrailers = false;
        HomeRowOrder = new List<string>();
        HomeHiddenRows = new List<string>();
        ShowLibrariesInNav = true;
        NavHiddenBuiltIns = new List<string>();
        NavLibraryIds = new List<string>();
        EnableCustomOidc = false;
        OidcProviderName = string.Empty;
        OidcIssuerUrl = string.Empty;
        OidcClientId = string.Empty;
        OidcClientSecret = string.Empty;
        OidcRequireAllowlist = false;
        ApprovedOidcUsers = new List<string>();
        EnableGuestPasses = true;
        GuestPassManagerProfileIds = new List<string>();
        EnableWatchTogether = true;
        EnableLiveTv = false;
        GuestPasses = new List<StreamFlixGuestPass>();
        EnableSeerr = false;
        SeerrUrl = string.Empty;
        SeerrApiKey = string.Empty;
        SeerrAllowKids = false;
        SeerrAllowGuests = false;
        MigratedV7 = false;
    }

    public bool EnableStreamFlixUi { get; set; }

    /// <summary>
    /// Gets or sets optional custom logo/brand text shown in the upper-left corner and across the StreamFlix UI.
    /// Defaults to "STREAMFLIX" / "StreamFlix" when empty.
    /// </summary>
    public string CustomBrandName { get; set; }

    /// <summary>
    /// Gets or sets the primary brand accent hex color (defaults to Netflix Red <c>#E50914</c>).
    /// </summary>
    public string CustomAccentColor { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the household sign-in gate is required before "Who's watching?".
    /// </summary>
    public bool RequireGoogleAuth { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether "Continue with Google" is shown on the sign-in screen when configured.
    /// </summary>
    public bool EnableGoogleSignIn { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether standard Jellyfin username/password login is allowed to unlock
    /// the "Who's watching?" screen (either alongside Google Sign-In in Hybrid Mode or instead of Google Sign-In).
    /// </summary>
    public bool AllowStandardJellyfinLogin { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether an opt-in "Admin Sign-In" link (disabled by default) is shown on the
    /// Google Sign-In screen allowing Jellyfin Administrator accounts to authenticate directly with their Jellyfin password.
    /// </summary>
    public bool AllowAdminFallbackLogin { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether at least one Google account has ever been claimed or configured,
    /// preventing first-run auto-claim from re-triggering if an administrator later empties the allowlist.
    /// </summary>
    public bool FirstGoogleAccountClaimed { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the "Admin Sign-In" fallback is restricted to local LAN IP addresses.
    /// </summary>
    public bool AdminFallbackLanOnly { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether clients connecting from local LAN IP addresses bypass the login gate
    /// and jump straight to the "Who's watching?" profile picker.
    /// </summary>
    public bool BypassLoginGateOnLan { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Tailscale / RFC 6598 CGNAT addresses (<c>100.64.0.0/10</c>)
    /// are treated as trusted private LAN connections alongside RFC 1918 subnets.
    /// </summary>
    public bool TreatTailscaleAsLocalLan { get; set; } = true;

    public bool AutoProvisionJellyfinUsers { get; set; }

    public bool ProfilesSeeded { get; set; }

    public string GoogleClientId { get; set; }

    public string GoogleClientSecret { get; set; }

    public List<string> ApprovedGoogleAccounts { get; set; }

    public List<StreamFlixProfileConfig> Profiles { get; set; }

    public List<string> DeletedProfileIds { get; set; }

    /// <summary>
    /// Gets or sets the server-only HMAC key used to sign StreamFlix household sessions.
    /// Generated automatically on first use. Never sent to browsers.
    /// </summary>
    public string SessionSigningKey { get; set; }

    /// <summary>
    /// Gets or sets the session generation. Incrementing it ("Sign out all devices") invalidates every issued session.
    /// </summary>
    public int SessionVersion { get; set; }

    /// <summary>
    /// Gets or sets how many days a household sign-in stays valid on a device before the user must sign in again.
    /// </summary>
    public int SessionLifetimeDays { get; set; }

    /// <summary>
    /// Gets or sets how the "Top 10" row selects and ranks items:
    /// <c>most_played</c>, <c>community_rating</c>, <c>recently_added</c>, <c>daily_random</c>, or <c>session_random</c>.
    /// </summary>
    public string Top10SelectionMode { get; set; }

    /// <summary>
    /// Gets or sets the hero billboard auto-rotation interval in seconds (<c>0</c> disables auto-rotation).
    /// </summary>
    public int HeroRotationSeconds { get; set; }

    /// <summary>
    /// Gets or sets the maximum number of featured slides shown in the hero billboard (1–15).
    /// </summary>
    public int HeroSlideCount { get; set; }

    /// <summary>
    /// Gets or sets how hero billboard featured titles are chosen:
    /// <c>recent</c>, <c>random</c>, <c>top_rated</c>, or <c>top10</c>.
    /// </summary>
    public string HeroSelectionMode { get; set; }

    /// <summary>
    /// Gets or sets which media types appear in the Home hero billboard: <c>all</c>, <c>movies</c>, or <c>series</c>.
    /// </summary>
    public string HeroContentType { get; set; }

    /// <summary>
    /// Gets or sets optional Jellyfin Library/View IDs allowed in the hero billboard. Empty means all libraries.
    /// </summary>
    public List<string> HeroLibraryIds { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether muted official YouTube trailer previews play on the Home Hero Billboard after resting on a slide.
    /// </summary>
    public bool EnableHeroTrailerPreview { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the one-time v0.9.3.1 YouTube Hero Trailer default migration has been applied.
    /// </summary>
    public bool MigratedHeroYouTubeTrailers { get; set; }

    /// <summary>
    /// Gets or sets the server-default ordering of Home page rows (empty uses the built-in default order).
    /// </summary>
    public List<string> HomeRowOrder { get; set; }

    /// <summary>
    /// Gets or sets Home page row IDs hidden by default across the server.
    /// </summary>
    public List<string> HomeHiddenRows { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether configured Jellyfin media libraries appear as navigation pills in the top bar (respecting per-user library access).
    /// </summary>
    public bool ShowLibrariesInNav { get; set; }

    /// <summary>
    /// Gets or sets built-in navigation pill IDs hidden from the top navigation bar (<c>series</c>, <c>movies</c>, <c>collections</c>, <c>top10</c>, <c>mylist</c>).
    /// </summary>
    public List<string> NavHiddenBuiltIns { get; set; }

    /// <summary>
    /// Gets or sets optional Jellyfin Library/View IDs to display in the top navigation bar when <see cref="ShowLibrariesInNav"/> is enabled. Empty means all accessible video libraries.
    /// </summary>
    public List<string> NavLibraryIds { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Beta Custom OpenID Connect (OIDC) SSO sign-in is enabled.
    /// Disabled by default.
    /// </summary>
    public bool EnableCustomOidc { get; set; }

    /// <summary>
    /// Gets or sets the display name of the Custom OIDC provider (e.g. "Authentik", "Authelia", "Pocket ID", "SSO").
    /// </summary>
    public string OidcProviderName { get; set; }

    /// <summary>
    /// Gets or sets the OIDC Issuer or <c>/.well-known/openid-configuration</c> URL.
    /// </summary>
    public string OidcIssuerUrl { get; set; }

    /// <summary>
    /// Gets or sets the OIDC Relying Party Client ID.
    /// </summary>
    public string OidcClientId { get; set; }

    /// <summary>
    /// Gets or sets the optional OIDC Client Secret for confidential clients (never exposed to non-admin clients).
    /// </summary>
    public string OidcClientSecret { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether OIDC logins must match <see cref="ApprovedOidcUsers"/> (or a profile's email lock).
    /// </summary>
    public bool OidcRequireAllowlist { get; set; }

    /// <summary>
    /// Gets or sets optional approved OIDC emails, preferred_usernames, or subjects (one per line).
    /// </summary>
    public List<string> ApprovedOidcUsers { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Temporary Guest Passes (creation, invite links, QR codes, and guest sessions) are enabled.
    /// </summary>
    public bool EnableGuestPasses { get; set; }

    /// <summary>
    /// Gets or sets non-administrator adult profile IDs allowed to create, view, share, and revoke Guest Passes.
    /// Empty by default (only Administrator profiles can manage Guest Passes).
    /// </summary>
    public List<string> GuestPassManagerProfileIds { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether StreamFlix Watch Together (SyncPlay rooms) is enabled for non-Kids profiles.
    /// </summary>
    public bool EnableWatchTogether { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether opt-in Live TV compatibility (top navigation tab, live channels, On Now, recordings, and EPG guide access) is enabled.
    /// Defaults to <c>false</c> so administrators must explicitly turn it on.
    /// </summary>
    public bool EnableLiveTv { get; set; }

    /// <summary>
    /// Gets or sets temporary, revocable Guest Passes issued by administrators.
    /// </summary>
    public List<StreamFlixGuestPass> GuestPasses { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Seerr / Jellyseerr / Overseerr media request integration is enabled.
    /// </summary>
    public bool EnableSeerr { get; set; }

    /// <summary>
    /// Gets or sets the base URL of the Seerr / Jellyseerr / Overseerr instance (e.g. <c>http://localhost:5055</c>).
    /// </summary>
    public string SeerrUrl { get; set; }

    /// <summary>
    /// Gets or sets the server-only Seerr / Jellyseerr API key (<c>X-Api-Key</c>). Never sent to browsers.
    /// </summary>
    public string SeerrApiKey { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Kids profiles are allowed to see and submit Seerr requests.
    /// </summary>
    public bool SeerrAllowKids { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Guest Pass viewers are allowed to see and submit Seerr requests.
    /// </summary>
    public bool SeerrAllowGuests { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the one-time v7 configuration migration has run.
    /// </summary>
    public bool MigratedV7 { get; set; }

    public static List<StreamFlixProfileConfig> CreateDefaultProfiles()
    {
        return new List<StreamFlixProfileConfig>();
    }
}
