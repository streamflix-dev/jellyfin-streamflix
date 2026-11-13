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

    public string MaturityRating { get; set; } = "TV-MA / R (All Maturity Levels)";

    public string? PinCode { get; set; }

    /// <summary>
    /// Gets or sets an optional Google account that this profile is locked to. When set, the profile can only be
    /// opened by a browser that has signed in with this exact Google account (verified server-side).
    /// </summary>
    public string? GoogleAccountEmail { get; set; }

    public bool AutoplayNextEpisode { get; set; } = true;

    public bool AutoplayPreviews { get; set; } = true;

    public string? JellyfinUserId { get; set; }

    public string? JellyfinUsername { get; set; }
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
        RequireGoogleAuth = true;
        EnableGoogleSignIn = true;
        AllowStandardJellyfinLogin = false;
        AllowAdminFallbackLogin = false;
        AdminFallbackLanOnly = false;
        BypassLoginGateOnLan = false;
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
        EnableCustomOidc = false;
        OidcProviderName = string.Empty;
        OidcIssuerUrl = string.Empty;
        OidcClientId = string.Empty;
        OidcClientSecret = string.Empty;
        OidcRequireAllowlist = false;
        ApprovedOidcUsers = new List<string>();
        MigratedV7 = false;
    }

    public bool EnableStreamFlixUi { get; set; }

    /// <summary>
    /// Gets or sets optional custom logo/brand text shown in the upper-left corner and across the StreamFlix UI.
    /// Defaults to "STREAMFLIX" / "StreamFlix" when empty.
    /// </summary>
    public string CustomBrandName { get; set; }

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
    /// Gets or sets a value indicating whether the one-time v7 configuration migration has run.
    /// </summary>
    public bool MigratedV7 { get; set; }

    public static List<StreamFlixProfileConfig> CreateDefaultProfiles()
    {
        return new List<StreamFlixProfileConfig>();
    }
}
