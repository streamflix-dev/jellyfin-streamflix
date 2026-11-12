using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using Jellyfin.Plugin.StreamFlix.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.StreamFlix;

/// <summary>
/// StreamFlix Plugin for Jellyfin — transforms Jellyfin Web into a Netflix UI with Google OAuth 2.0
/// allowlist authentication and real Jellyfin Server User profiles with independent watch history.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public const string StartComment = "<!-- BEGIN StreamFlix Plugin -->";
    public const string EndComment = "<!-- END StreamFlix Plugin -->";

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

        RunV7MigrationIfNeeded();

        // Immediately inject into index.html on disk if writable at plugin startup
        InjectScriptIntoDiskIndexIfWritable();
    }

    /// <summary>
    /// Gets the plugin version as a short string (e.g. <c>7.0.0</c>), used for cache-busting the injected assets.
    /// </summary>
    public static string VersionString
    {
        get
        {
            var v = typeof(Plugin).Assembly.GetName().Version;
            return v == null ? "0.0.0" : $"{v.Major}.{v.Minor}.{v.Build}";
        }
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "StreamFlix";

    public override Guid Id => Guid.Parse("7cc1a505-91f6-4661-b4f9-7eee8be33b19");

    public override string Description =>
        "Transforms Jellyfin Web into StreamFlix with a Netflix UI, Google OAuth 2.0 allowlist sign-in, and real Jellyfin Server User profiles with separate watch history.";

    public string IndexHtmlPath => Path.Combine(_appPaths.WebPath, "index.html");

    public static string BuildInjectionBlock()
    {
        var v = VersionString;
        return $"{StartComment}\n<link rel=\"stylesheet\" href=\"/StreamFlix/ClientStyles?v={v}\" />\n<script src=\"/StreamFlix/ClientScript?v={v}\" defer></script>\n{EndComment}";
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

    private void RunV7MigrationIfNeeded()
    {
        try
        {
            var cfg = Configuration;
            if (cfg.MigratedV7)
            {
                return;
            }

            if (cfg.SessionVersion <= 0)
            {
                cfg.SessionVersion = 1;
            }

            if (cfg.SessionLifetimeDays <= 0)
            {
                cfg.SessionLifetimeDays = 30;
            }

            cfg.MigratedV7 = true;
            SaveConfiguration();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: v7 configuration migration failed (non-fatal).");
        }
    }

    public static string GetEmbeddedStylesheetContent()
    {
        try
        {
            var asm = typeof(Plugin).Assembly;
            using var stream = asm.GetManifestResourceStream("Jellyfin.Plugin.StreamFlix.Web.streamflix.css");
            if (stream != null)
            {
                using var reader = new StreamReader(stream);
                return reader.ReadToEnd();
            }
        }
        catch
        {
            // Ignore resource read error
        }

        return string.Empty;
    }

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
                updated = xml;
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
                _logger.LogInformation("StreamFlix: injected client bundle into {Path}", indexPath);
                return true;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "StreamFlix: index.html is read-only on disk; using request-time IStartupFilter middleware.");
        }

        return false;
    }

    public override void OnUninstalling()
    {
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
