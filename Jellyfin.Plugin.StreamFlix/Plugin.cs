using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Xml.Linq;
using Jellyfin.Plugin.StreamFlix.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.StreamFlix;

/// <summary>
/// StreamFlix Plugin for Jellyfin — transforms Jellyfin Web into a Netflix UI with flexible authentication
/// (Google OAuth 2.0, Standard Jellyfin Login, Admin Fallback, LAN Bypass) and real Jellyfin Server User profiles.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public const string StartComment = "<!-- BEGIN StreamFlix Plugin -->";
    public const string EndComment = "<!-- END StreamFlix Plugin -->";

    private static readonly object DiskIndexLock = new();
    private static readonly object ConfigPersistLock = new();
    private static readonly JsonSerializerOptions BackupJsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private static long _lastInjectTicks;

    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<Plugin> _logger;

    public Plugin(
        IApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _appPaths = applicationPaths;
        _logger = logger;

        // Snapshot any pre-existing XML before BasePlugin lazy-loads Configuration (BasePlugin overwrites XML on parse error)
        SnapshotExistingXmlBeforeLoad();
        EnsureConfigurationRecoveredOnStartup();
        RunV7MigrationIfNeeded();

        // Immediately inject into index.html on disk if writable at plugin startup
        InjectScriptIntoDiskIndexIfWritable();
    }

    /// <summary>
    /// Gets the plugin version as a short string (e.g. <c>0.5.6</c>) for UI display.
    /// </summary>
    public static string VersionString
    {
        get
        {
            var v = typeof(Plugin).Assembly.GetName().Version;
            if (v == null)
            {
                return "0.0.0";
            }

            return v.Revision > 0
                ? $"{v.Major}.{v.Minor}.{v.Build}.{v.Revision}"
                : $"{v.Major}.{v.Minor}.{v.Build}";
        }
    }

    /// <summary>
    /// Gets the cache-busting version token appended to injected JS/CSS URLs (<c>?v=...</c>) so browsers
    /// automatically load updated Web UI assets immediately after any plugin update without a hard refresh.
    /// </summary>
    public static string AssetCacheVersion => AssetVersionCache.Value;

    public static Plugin? Instance { get; private set; }

    public override string Name => "StreamFlix";

    public override Guid Id => Guid.Parse("7cc1a505-91f6-4661-b4f9-7eee8be33b19");

    public override string ConfigurationFileName => "Jellyfin.Plugin.StreamFlix.xml";

    public override string Description =>
        "Transforms Jellyfin Web into StreamFlix with a Netflix UI, flexible Google OAuth / Jellyfin sign-in, and real Jellyfin Server User profiles with separate watch history.";

    public string IndexHtmlPath => Path.Combine(_appPaths.WebPath, "index.html");

    private string PersistentBackupJsonPath => Path.Combine(_appPaths.DataPath, "StreamFlix", "config-backup.json");

    private string XmlBackupFilePath => ConfigurationFilePath + ".bak";

    public static string BuildInjectionBlock()
    {
        var v = Uri.EscapeDataString(AssetCacheVersion);
        return $"{StartComment}\n<link rel=\"stylesheet\" href=\"/StreamFlix/ClientStyles?v={v}\" />\n<script src=\"/StreamFlix/ClientScript?v={v}\" defer></script>\n{EndComment}";
    }

    /// <inheritdoc />
    public override void SaveConfiguration(PluginConfiguration config)
    {
        ArgumentNullException.ThrowIfNull(config);

        lock (ConfigPersistLock)
        {
            try
            {
                var configPath = ConfigurationFilePath;
                var configDir = Path.GetDirectoryName(configPath);
                if (!string.IsNullOrEmpty(configDir))
                {
                    Directory.CreateDirectory(configDir);
                }

                // Write to a temporary sibling file first, then atomically replace the live XML file so a server
                // restart during a plugin update can never leave a truncated XML file that Jellyfin wipes on boot.
                var tmpXmlPath = configPath + ".tmp";
                XmlSerializer.SerializeToFile(config, tmpXmlPath);
                File.Move(tmpXmlPath, configPath, overwrite: true);
            }
            catch
            {
                base.SaveConfiguration(config);
            }

            if (HasMeaningfulUserConfig(config))
            {
                WriteShadowBackupsSafe(config);
            }
        }
    }

    /// <inheritdoc />
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        lock (ConfigPersistLock)
        {
            if (configuration is PluginConfiguration incoming)
            {
                var existing = Configuration;
                if (existing != null)
                {
                    // Guard against partial/stale configuration posts wiping profiles, guest passes, secrets, or session keys
                    if ((incoming.Profiles == null || incoming.Profiles.Count == 0)
                        && existing.Profiles != null
                        && existing.Profiles.Count > 0)
                    {
                        incoming.Profiles = existing.Profiles;
                        incoming.ProfilesSeeded = existing.ProfilesSeeded;
                    }

                    if ((incoming.DeletedProfileIds == null || incoming.DeletedProfileIds.Count == 0)
                        && existing.DeletedProfileIds != null
                        && existing.DeletedProfileIds.Count > 0)
                    {
                        incoming.DeletedProfileIds = existing.DeletedProfileIds;
                    }

                    if ((incoming.GuestPasses == null || incoming.GuestPasses.Count == 0)
                        && existing.GuestPasses != null
                        && existing.GuestPasses.Count > 0)
                    {
                        incoming.GuestPasses = existing.GuestPasses;
                    }

                    if (string.IsNullOrWhiteSpace(incoming.SessionSigningKey) && !string.IsNullOrWhiteSpace(existing.SessionSigningKey))
                    {
                        incoming.SessionSigningKey = existing.SessionSigningKey;
                    }

                    if (string.Equals(incoming.GoogleClientSecret, "__KEEP__", StringComparison.Ordinal))
                    {
                        incoming.GoogleClientSecret = existing.GoogleClientSecret;
                    }

                    if (string.Equals(incoming.OidcClientSecret, "__KEEP__", StringComparison.Ordinal))
                    {
                        incoming.OidcClientSecret = existing.OidcClientSecret;
                    }

                    if (string.Equals(incoming.SeerrApiKey, "__KEEP__", StringComparison.Ordinal))
                    {
                        incoming.SeerrApiKey = existing.SeerrApiKey;
                    }

                    if (incoming.SessionVersion <= 1 && existing.SessionVersion > 1)
                    {
                        incoming.SessionVersion = existing.SessionVersion;
                    }

                    if (!incoming.MigratedV7 && existing.MigratedV7)
                    {
                        incoming.MigratedV7 = true;
                    }

                    if (!incoming.FirstGoogleAccountClaimed && (existing.FirstGoogleAccountClaimed || (incoming.ApprovedGoogleAccounts != null && incoming.ApprovedGoogleAccounts.Count > 0)))
                    {
                        incoming.FirstGoogleAccountClaimed = true;
                    }
                }
                else if (incoming.ApprovedGoogleAccounts != null && incoming.ApprovedGoogleAccounts.Count > 0)
                {
                    incoming.FirstGoogleAccountClaimed = true;
                }
            }

            base.UpdateConfiguration(configuration);

            if (configuration is PluginConfiguration savedCfg)
            {
                WriteShadowBackupsSafe(savedCfg);
            }
        }
    }

    /// <summary>
    /// Re-runs the on-disk injection at most every 10 minutes (it touches index.html and branding.xml, so it should not
    /// run on every page load).
    /// </summary>
    public void EnsureInjectedThrottled()
    {
        var now = DateTime.UtcNow.Ticks;
        var last = Interlocked.Read(ref _lastInjectTicks);
        if (now - last < TimeSpan.FromMinutes(10).Ticks)
        {
            return;
        }

        if (Interlocked.CompareExchange(ref _lastInjectTicks, now, last) == last)
        {
            InjectScriptIntoDiskIndexIfWritable();
        }
    }

    private static bool HasMeaningfulUserConfig(PluginConfiguration? cfg)
    {
        if (cfg == null)
        {
            return false;
        }

        return (cfg.Profiles != null && cfg.Profiles.Count > 0)
            || (cfg.GuestPasses != null && cfg.GuestPasses.Count > 0)
            || !string.IsNullOrWhiteSpace(cfg.GoogleClientId)
            || !string.IsNullOrWhiteSpace(cfg.GoogleClientSecret)
            || (cfg.ApprovedGoogleAccounts != null && cfg.ApprovedGoogleAccounts.Count > 0)
            || cfg.EnableCustomOidc
            || !string.IsNullOrWhiteSpace(cfg.OidcIssuerUrl)
            || !string.IsNullOrWhiteSpace(cfg.OidcClientId)
            || cfg.EnableSeerr
            || !string.IsNullOrWhiteSpace(cfg.SeerrUrl)
            || !string.IsNullOrWhiteSpace(cfg.SeerrApiKey)
            || !string.IsNullOrWhiteSpace(cfg.CustomBrandName)
            || !string.IsNullOrWhiteSpace(cfg.SessionSigningKey)
            || cfg.AllowStandardJellyfinLogin
            || cfg.AllowAdminFallbackLogin
            || cfg.AdminFallbackLanOnly
            || cfg.BypassLoginGateOnLan
            || !cfg.RequireGoogleAuth
            || !cfg.EnableGoogleSignIn
            || !cfg.EnableStreamFlixUi;
    }

    private void SnapshotExistingXmlBeforeLoad()
    {
        try
        {
            var xmlPath = ConfigurationFilePath;
            if (!File.Exists(xmlPath))
            {
                return;
            }

            var xmlText = File.ReadAllText(xmlPath, Encoding.UTF8);
            if (string.IsNullOrWhiteSpace(xmlText))
            {
                return;
            }

            // Only snapshot non-blank XML that has already been migrated or populated with user settings/profiles
            if (xmlText.Contains("<StreamFlixProfileConfig>", StringComparison.OrdinalIgnoreCase)
                || xmlText.Contains("<StreamFlixGuestPass>", StringComparison.OrdinalIgnoreCase)
                || xmlText.Contains("<SessionSigningKey>", StringComparison.OrdinalIgnoreCase)
                || xmlText.Contains("<GoogleClientId>", StringComparison.OrdinalIgnoreCase)
                || xmlText.Contains("<OidcIssuerUrl>", StringComparison.OrdinalIgnoreCase)
                || xmlText.Contains("<SeerrUrl>", StringComparison.OrdinalIgnoreCase)
                || xmlText.Contains("<MigratedV7>true</MigratedV7>", StringComparison.OrdinalIgnoreCase))
            {
                File.WriteAllText(XmlBackupFilePath, xmlText, Encoding.UTF8);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: pre-load XML snapshot skipped.");
        }
    }

    private void EnsureConfigurationRecoveredOnStartup()
    {
        try
        {
            var current = Configuration;
            if (HasMeaningfulUserConfig(current))
            {
                // Keep persistent shadow backup synced on startup for existing installations upgrading to this build
                WriteShadowBackupsSafe(current);
                return;
            }

            // Current loaded config appears blank/fresh — check if a persistent backup exists from before a plugin update
            PluginConfiguration? recovered = TryLoadJsonShadowBackup() ?? TryRecoverFromXmlBackup();
            if (recovered != null && HasMeaningfulUserConfig(recovered))
            {
                Configuration = recovered;
                SaveConfiguration(recovered);
                _logger.LogInformation("StreamFlix: recovered plugin configuration ({ProfileCount} profiles) from backup after plugin update.", recovered.Profiles?.Count ?? 0);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: configuration recovery check encountered a non-fatal error.");
        }
    }

    private void WriteShadowBackupsSafe(PluginConfiguration config)
    {
        try
        {
            var jsonPath = PersistentBackupJsonPath;
            var jsonDir = Path.GetDirectoryName(jsonPath);
            if (!string.IsNullOrEmpty(jsonDir))
            {
                Directory.CreateDirectory(jsonDir);
            }

            var tmpJson = jsonPath + ".tmp";
            File.WriteAllText(tmpJson, JsonSerializer.Serialize(config, BackupJsonOptions), Encoding.UTF8);
            File.Move(tmpJson, jsonPath, overwrite: true);

            if (File.Exists(ConfigurationFilePath))
            {
                File.Copy(ConfigurationFilePath, XmlBackupFilePath, overwrite: true);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: could not write configuration shadow backup.");
        }
    }

    private PluginConfiguration? TryLoadJsonShadowBackup()
    {
        try
        {
            var jsonPath = PersistentBackupJsonPath;
            if (!File.Exists(jsonPath))
            {
                return null;
            }

            var raw = File.ReadAllText(jsonPath, Encoding.UTF8);
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            return JsonSerializer.Deserialize<PluginConfiguration>(raw, BackupJsonOptions);
        }
        catch
        {
            return null;
        }
    }

    private PluginConfiguration? TryRecoverFromXmlBackup()
    {
        try
        {
            var bakPath = XmlBackupFilePath;
            if (!File.Exists(bakPath))
            {
                return null;
            }

            try
            {
                if (XmlSerializer.DeserializeFromFile(typeof(PluginConfiguration), bakPath) is PluginConfiguration deserialized
                    && HasMeaningfulUserConfig(deserialized))
                {
                    return deserialized;
                }
            }
            catch
            {
                // Fall through to tolerant XDocument element-by-element recovery
            }

            var doc = XDocument.Load(bakPath);
            var root = doc.Root;
            if (root == null)
            {
                return null;
            }

            static string? Val(XElement parent, string name) =>
                parent.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, name, StringComparison.OrdinalIgnoreCase))?.Value;

            static bool BoolVal(XElement parent, string name, bool fallback) =>
                bool.TryParse(Val(parent, name), out var b) ? b : fallback;

            static int IntVal(XElement parent, string name, int fallback) =>
                int.TryParse(Val(parent, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : fallback;

            var cfg = new PluginConfiguration
            {
                EnableStreamFlixUi = BoolVal(root, nameof(PluginConfiguration.EnableStreamFlixUi), true),
                CustomBrandName = Val(root, nameof(PluginConfiguration.CustomBrandName)) ?? string.Empty,
                RequireGoogleAuth = BoolVal(root, nameof(PluginConfiguration.RequireGoogleAuth), true),
                EnableGoogleSignIn = BoolVal(root, nameof(PluginConfiguration.EnableGoogleSignIn), true),
                AllowStandardJellyfinLogin = BoolVal(root, nameof(PluginConfiguration.AllowStandardJellyfinLogin), false),
                AllowAdminFallbackLogin = BoolVal(root, nameof(PluginConfiguration.AllowAdminFallbackLogin), false),
                AdminFallbackLanOnly = BoolVal(root, nameof(PluginConfiguration.AdminFallbackLanOnly), false),
                BypassLoginGateOnLan = BoolVal(root, nameof(PluginConfiguration.BypassLoginGateOnLan), false),
                FirstGoogleAccountClaimed = BoolVal(root, nameof(PluginConfiguration.FirstGoogleAccountClaimed), false),
                AutoProvisionJellyfinUsers = BoolVal(root, nameof(PluginConfiguration.AutoProvisionJellyfinUsers), true),
                ProfilesSeeded = BoolVal(root, nameof(PluginConfiguration.ProfilesSeeded), false),
                GoogleClientId = Val(root, nameof(PluginConfiguration.GoogleClientId)) ?? string.Empty,
                GoogleClientSecret = Val(root, nameof(PluginConfiguration.GoogleClientSecret)) ?? string.Empty,
                SessionSigningKey = Val(root, nameof(PluginConfiguration.SessionSigningKey)) ?? string.Empty,
                SessionVersion = IntVal(root, nameof(PluginConfiguration.SessionVersion), 1),
                SessionLifetimeDays = IntVal(root, nameof(PluginConfiguration.SessionLifetimeDays), 30),
                Top10SelectionMode = Val(root, nameof(PluginConfiguration.Top10SelectionMode)) ?? "most_played",
                HeroRotationSeconds = IntVal(root, nameof(PluginConfiguration.HeroRotationSeconds), 9),
                HeroSlideCount = IntVal(root, nameof(PluginConfiguration.HeroSlideCount), 8),
                HeroSelectionMode = Val(root, nameof(PluginConfiguration.HeroSelectionMode)) ?? "recent",
                HeroContentType = Val(root, nameof(PluginConfiguration.HeroContentType)) ?? "all",
                EnableCustomOidc = BoolVal(root, nameof(PluginConfiguration.EnableCustomOidc), false),
                OidcProviderName = Val(root, nameof(PluginConfiguration.OidcProviderName)) ?? string.Empty,
                OidcIssuerUrl = Val(root, nameof(PluginConfiguration.OidcIssuerUrl)) ?? string.Empty,
                OidcClientId = Val(root, nameof(PluginConfiguration.OidcClientId)) ?? string.Empty,
                OidcClientSecret = Val(root, nameof(PluginConfiguration.OidcClientSecret)) ?? string.Empty,
                OidcRequireAllowlist = BoolVal(root, nameof(PluginConfiguration.OidcRequireAllowlist), false),
                EnableSeerr = BoolVal(root, nameof(PluginConfiguration.EnableSeerr), false),
                SeerrUrl = Val(root, nameof(PluginConfiguration.SeerrUrl)) ?? string.Empty,
                SeerrApiKey = Val(root, nameof(PluginConfiguration.SeerrApiKey)) ?? string.Empty,
                SeerrAllowKids = BoolVal(root, nameof(PluginConfiguration.SeerrAllowKids), false),
                SeerrAllowGuests = BoolVal(root, nameof(PluginConfiguration.SeerrAllowGuests), false),
                MigratedV7 = BoolVal(root, nameof(PluginConfiguration.MigratedV7), true),
            };

            var approvedOidcEl = root.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, nameof(PluginConfiguration.ApprovedOidcUsers), StringComparison.OrdinalIgnoreCase));
            if (approvedOidcEl != null)
            {
                cfg.ApprovedOidcUsers = approvedOidcEl.Elements()
                    .Select(x => (x.Value ?? string.Empty).Trim())
                    .Where(x => !string.IsNullOrEmpty(x))
                    .ToList();
            }

            var approvedEl = root.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, nameof(PluginConfiguration.ApprovedGoogleAccounts), StringComparison.OrdinalIgnoreCase));
            if (approvedEl != null)
            {
                cfg.ApprovedGoogleAccounts = approvedEl.Elements()
                    .Select(x => (x.Value ?? string.Empty).Trim())
                    .Where(x => !string.IsNullOrEmpty(x))
                    .ToList();
            }

            var heroLibsEl = root.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, nameof(PluginConfiguration.HeroLibraryIds), StringComparison.OrdinalIgnoreCase));
            if (heroLibsEl != null)
            {
                cfg.HeroLibraryIds = heroLibsEl.Elements()
                    .Select(x => (x.Value ?? string.Empty).Trim())
                    .Where(x => !string.IsNullOrEmpty(x))
                    .ToList();
            }

            var deletedEl = root.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, nameof(PluginConfiguration.DeletedProfileIds), StringComparison.OrdinalIgnoreCase));
            if (deletedEl != null)
            {
                cfg.DeletedProfileIds = deletedEl.Elements()
                    .Select(x => (x.Value ?? string.Empty).Trim())
                    .Where(x => !string.IsNullOrEmpty(x))
                    .ToList();
            }

            var profilesEl = root.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, nameof(PluginConfiguration.Profiles), StringComparison.OrdinalIgnoreCase));
            if (profilesEl != null)
            {
                foreach (var pEl in profilesEl.Elements())
                {
                    var pName = Val(pEl, nameof(StreamFlixProfileConfig.Name)) ?? string.Empty;
                    if (string.IsNullOrWhiteSpace(pName))
                    {
                        continue;
                    }

                    cfg.Profiles.Add(new StreamFlixProfileConfig
                    {
                        Id = Val(pEl, nameof(StreamFlixProfileConfig.Id)) ?? string.Empty,
                        Name = pName,
                        AvatarColorIndex = IntVal(pEl, nameof(StreamFlixProfileConfig.AvatarColorIndex), 0),
                        AvatarIconIndex = IntVal(pEl, nameof(StreamFlixProfileConfig.AvatarIconIndex), 0),
                        AvatarEmoji = Val(pEl, nameof(StreamFlixProfileConfig.AvatarEmoji)) ?? "🎬",
                        AvatarColorHex = Val(pEl, nameof(StreamFlixProfileConfig.AvatarColorHex)) ?? "#E50914",
                        IsKids = BoolVal(pEl, nameof(StreamFlixProfileConfig.IsKids), false),
                        MaturityRating = Val(pEl, nameof(StreamFlixProfileConfig.MaturityRating)) ?? "TV-MA / R (All Maturity Levels)",
                        PinCode = Val(pEl, nameof(StreamFlixProfileConfig.PinCode)),
                        GoogleAccountEmail = Val(pEl, nameof(StreamFlixProfileConfig.GoogleAccountEmail)),
                        AutoplayNextEpisode = BoolVal(pEl, nameof(StreamFlixProfileConfig.AutoplayNextEpisode), true),
                        AutoplayPreviews = BoolVal(pEl, nameof(StreamFlixProfileConfig.AutoplayPreviews), true),
                        JellyfinUserId = Val(pEl, nameof(StreamFlixProfileConfig.JellyfinUserId)),
                        JellyfinUsername = Val(pEl, nameof(StreamFlixProfileConfig.JellyfinUsername)),
                    });
                }
            }

            var guestPassesEl = root.Elements().FirstOrDefault(e => string.Equals(e.Name.LocalName, nameof(PluginConfiguration.GuestPasses), StringComparison.OrdinalIgnoreCase));
            if (guestPassesEl != null)
            {
                foreach (var gpEl in guestPassesEl.Elements())
                {
                    var gpId = Val(gpEl, nameof(StreamFlixGuestPass.Id)) ?? string.Empty;
                    var gpProfileId = Val(gpEl, nameof(StreamFlixGuestPass.ProfileId)) ?? string.Empty;
                    if (string.IsNullOrWhiteSpace(gpId) || string.IsNullOrWhiteSpace(gpProfileId))
                    {
                        continue;
                    }

                    cfg.GuestPasses.Add(new StreamFlixGuestPass
                    {
                        Id = gpId,
                        Label = Val(gpEl, nameof(StreamFlixGuestPass.Label)) ?? string.Empty,
                        ProfileId = gpProfileId,
                        ProfileNameSnapshot = Val(gpEl, nameof(StreamFlixGuestPass.ProfileNameSnapshot)) ?? string.Empty,
                        CreatedAtUtc = Val(gpEl, nameof(StreamFlixGuestPass.CreatedAtUtc)) ?? string.Empty,
                        ExpiresAtUtc = Val(gpEl, nameof(StreamFlixGuestPass.ExpiresAtUtc)) ?? string.Empty,
                        MaxRedemptions = IntVal(gpEl, nameof(StreamFlixGuestPass.MaxRedemptions), 0),
                        RedemptionCount = IntVal(gpEl, nameof(StreamFlixGuestPass.RedemptionCount), 0),
                        LastRedeemedAtUtc = Val(gpEl, nameof(StreamFlixGuestPass.LastRedeemedAtUtc)),
                        Revoked = BoolVal(gpEl, nameof(StreamFlixGuestPass.Revoked), false),
                        RevokedAtUtc = Val(gpEl, nameof(StreamFlixGuestPass.RevokedAtUtc)),
                        SecretNonce = Val(gpEl, nameof(StreamFlixGuestPass.SecretNonce)) ?? string.Empty,
                    });
                }
            }

            return cfg;
        }
        catch
        {
            return null;
        }
    }

    private void RunV7MigrationIfNeeded()
    {
        try
        {
            var cfg = Configuration;
            var dirty = false;

            if (cfg.SessionVersion <= 0)
            {
                cfg.SessionVersion = 1;
                dirty = true;
            }

            if (cfg.SessionLifetimeDays <= 0)
            {
                cfg.SessionLifetimeDays = 30;
                dirty = true;
            }

            if (cfg.HeroRotationSeconds < 0)
            {
                cfg.HeroRotationSeconds = 9;
                dirty = true;
            }

            if (cfg.HeroSlideCount <= 0)
            {
                cfg.HeroSlideCount = 8;
                dirty = true;
            }

            if (string.IsNullOrWhiteSpace(cfg.Top10SelectionMode))
            {
                cfg.Top10SelectionMode = "most_played";
                dirty = true;
            }

            if (string.IsNullOrWhiteSpace(cfg.HeroSelectionMode))
            {
                cfg.HeroSelectionMode = "recent";
                dirty = true;
            }

            if (string.IsNullOrWhiteSpace(cfg.HeroContentType))
            {
                cfg.HeroContentType = "all";
                dirty = true;
            }

            if (cfg.GuestPasses == null)
            {
                cfg.GuestPasses = new List<StreamFlixGuestPass>();
                dirty = true;
            }

            if (!cfg.MigratedV7)
            {
                cfg.MigratedV7 = true;
                dirty = true;
            }

            if (dirty)
            {
                SaveConfiguration();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: configuration migration failed (non-fatal).");
        }
    }

    private static readonly Lazy<string> AssetVersionCache = new(() =>
    {
        var v = typeof(Plugin).Assembly.GetName().Version;
        var fullVer = v == null ? "0.0.0.0" : $"{v.Major}.{v.Minor}.{v.Build}.{Math.Max(0, v.Revision)}";
        try
        {
            var asm = typeof(Plugin).Assembly;
            using var sha = SHA256.Create();
            foreach (var resName in new[] { "Jellyfin.Plugin.StreamFlix.Web.streamflix.css", "Jellyfin.Plugin.StreamFlix.Web.streamflix.js" })
            {
                using var s = asm.GetManifestResourceStream(resName);
                if (s != null)
                {
                    var buf = new byte[8192];
                    int read;
                    while ((read = s.Read(buf, 0, buf.Length)) > 0)
                    {
                        sha.TransformBlock(buf, 0, read, null, 0);
                    }
                }
            }

            sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
            var shortHash = Convert.ToHexString(sha.Hash ?? Array.Empty<byte>(), 0, 4).ToLowerInvariant();
            return string.IsNullOrEmpty(shortHash) ? fullVer : $"{fullVer}-{shortHash}";
        }
        catch
        {
            return fullVer;
        }
    });

    private static readonly Lazy<(string Text, byte[] Bytes, string ETag)> EmbeddedStylesheet = new(() =>
    {
        try
        {
            var asm = typeof(Plugin).Assembly;
            using var stream = asm.GetManifestResourceStream("Jellyfin.Plugin.StreamFlix.Web.streamflix.css");
            if (stream != null)
            {
                using var reader = new StreamReader(stream, Encoding.UTF8);
                var text = reader.ReadToEnd();
                var bytes = Encoding.UTF8.GetBytes(text);
                var hash = SHA256.HashData(bytes);
                var etag = "\"" + Convert.ToHexString(hash, 0, 12).ToLowerInvariant() + "\"";
                return (text, bytes, etag);
            }
        }
        catch
        {
            // Ignore resource read error
        }

        return (string.Empty, Array.Empty<byte>(), string.Empty);
    });

    public static string GetEmbeddedStylesheetContent() => EmbeddedStylesheet.Value.Text;

    public static (byte[] Bytes, string ETag) GetEmbeddedStylesheetAsset() =>
        (EmbeddedStylesheet.Value.Bytes, EmbeddedStylesheet.Value.ETag);

    public void CleanConflictingBrandingCssIfPresent()
    {
        try
        {
            var brandingPath = Path.Combine(_appPaths.ConfigurationDirectoryPath, "branding.xml");
            var css = GetEmbeddedStylesheetContent();
            if (string.IsNullOrWhiteSpace(css))
            {
                return;
            }

            var escapedCss = System.Security.SecurityElement.Escape(css) ?? string.Empty;
            var customCssTag = $"<CustomCss>{escapedCss}</CustomCss>";

            if (!File.Exists(brandingPath))
            {
                var defaultXml = $"<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<BrandingOptions xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\">\n  <LoginDisclaimer />\n  {customCssTag}\n  <SplashscreenEnabled>false</SplashscreenEnabled>\n</BrandingOptions>";
                File.WriteAllText(brandingPath, defaultXml);
                _logger.LogInformation("StreamFlix: created branding.xml with StreamFlix CustomCss for Jellyfin App support.");
                return;
            }

            var xml = File.ReadAllText(brandingPath);
            string updated;
            if (Regex.IsMatch(xml, "<CustomCss>[\\s\\S]*?</CustomCss>", RegexOptions.IgnoreCase))
            {
                updated = Regex.Replace(
                    xml,
                    "<CustomCss>[\\s\\S]*?</CustomCss>",
                    _ => customCssTag,
                    RegexOptions.IgnoreCase);
            }
            else if (Regex.IsMatch(xml, "<CustomCss\\s*/>", RegexOptions.IgnoreCase))
            {
                updated = Regex.Replace(
                    xml,
                    "<CustomCss\\s*/>",
                    _ => customCssTag,
                    RegexOptions.IgnoreCase);
            }
            else
            {
                var closeIdx = xml.LastIndexOf("</BrandingOptions>", StringComparison.OrdinalIgnoreCase);
                updated = closeIdx >= 0
                    ? xml.Substring(0, closeIdx) + "  " + customCssTag + "\n" + xml.Substring(closeIdx)
                    : xml;
            }

            if (!string.Equals(xml, updated, StringComparison.Ordinal))
            {
                File.WriteAllText(brandingPath, updated);
                _logger.LogInformation("StreamFlix: synced StreamFlix CustomCss into branding.xml for Jellyfin App parity.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: could not sync branding.xml.");
        }
    }

    public bool InjectScriptIntoDiskIndexIfWritable()
    {
        lock (DiskIndexLock)
        {
            CleanConflictingBrandingCssIfPresent();
            try
            {
                var indexPath = IndexHtmlPath;
                if (!File.Exists(indexPath))
                {
                    _logger.LogWarning("StreamFlix: index.html not found at {Path}", indexPath);
                    return false;
                }

                var injectionBlock = BuildInjectionBlock();
                var content = File.ReadAllText(indexPath);
                if (content.Contains(injectionBlock, StringComparison.Ordinal))
                {
                    return true;
                }

                var cleanupRegex = new Regex($"{Regex.Escape(StartComment)}[\\s\\S]*?{Regex.Escape(EndComment)}\\s*", RegexOptions.Multiline);
                content = cleanupRegex.Replace(content, string.Empty);

                const string closingBody = "</body>";
                var idx = content.LastIndexOf(closingBody, StringComparison.OrdinalIgnoreCase);
                if (idx >= 0)
                {
                    content = content.Substring(0, idx) + injectionBlock + "\n" + content.Substring(idx);
                    File.WriteAllText(indexPath, content);
                    _logger.LogInformation("StreamFlix: injected client bundle ({AssetVersion}) into {Path}", AssetCacheVersion, indexPath);
                    return true;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "StreamFlix: index.html is read-only on disk; using request-time IStartupFilter middleware.");
            }

            return false;
        }
    }

    public override void OnUninstalling()
    {
        // Note: Intentionally never touch ConfigurationFilePath or PersistentBackupJsonPath so plugin updates
        // or reinstalls never lose the administrator's StreamFlix configuration or household profiles.
        try
        {
            var indexPath = IndexHtmlPath;
            if (File.Exists(indexPath))
            {
                var content = File.ReadAllText(indexPath);
                var cleanupRegex = new Regex($"{Regex.Escape(StartComment)}[\\s\\S]*?{Regex.Escape(EndComment)}\\s*", RegexOptions.Multiline);
                if (cleanupRegex.IsMatch(content))
                {
                    content = cleanupRegex.Replace(content, string.Empty);
                    File.WriteAllText(indexPath, content);
                }
            }

            var brandingPath = Path.Combine(_appPaths.ConfigurationDirectoryPath, "branding.xml");
            if (File.Exists(brandingPath))
            {
                var xml = File.ReadAllText(brandingPath);
                if (xml.IndexOf("STREAMFLIX", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    var cleaned = Regex.Replace(
                        xml,
                        "<CustomCss>[\\s\\S]*?</CustomCss>",
                        "<CustomCss />",
                        RegexOptions.IgnoreCase);
                    File.WriteAllText(brandingPath, cleaned);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: could not clean up index.html during uninstall.");
        }

        base.OnUninstalling();
    }

    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = Name,
                DisplayName = "StreamFlix",
                EnableInMainMenu = true,
                MenuSection = "server",
                MenuIcon = "movie_filter",
                EmbeddedResourcePath = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}.Configuration.configPage.html",
                    GetType().Namespace),
            },
        };
    }
}
