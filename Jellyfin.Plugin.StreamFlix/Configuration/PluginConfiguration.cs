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
        RequireGoogleAuth = true;
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
        MigratedV7 = false;
    }

    public bool EnableStreamFlixUi { get; set; }

    public bool RequireGoogleAuth { get; set; }

    public bool AutoProvisionJellyfinUsers { get; set; }

    public bool ProfilesSeeded { get; set; }

    public string GoogleClientId { get; set; }

    public string GoogleClientSecret { get; set; }

    public List<string> ApprovedGoogleAccounts { get; set; }

    public List<StreamFlixProfileConfig> Profiles { get; set; }

    public List<string> DeletedProfileIds { get; set; }

    /// <summary>
    /// Gets or sets the server-only HMAC key used to sign StreamFlix household sessions issued after Google sign-in.
    /// Generated automatically on first use. Never sent to browsers.
    /// </summary>
    public string SessionSigningKey { get; set; }

    /// <summary>
    /// Gets or sets the session generation. Incrementing it ("Sign out all devices") invalidates every issued session.
    /// </summary>
    public int SessionVersion { get; set; }

    /// <summary>
    /// Gets or sets how many days a Google sign-in stays valid on a device before the user must sign in again.
    /// </summary>
    public int SessionLifetimeDays { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the one-time v7 configuration migration has run.
    /// </summary>
    public bool MigratedV7 { get; set; }

    public static List<StreamFlixProfileConfig> CreateDefaultProfiles()
    {
        return new List<StreamFlixProfileConfig>();
    }
}
