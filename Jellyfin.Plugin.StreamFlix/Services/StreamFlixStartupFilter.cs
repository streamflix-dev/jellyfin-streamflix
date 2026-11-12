using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Request-time ASP.NET Core middleware (<see cref="IStartupFilter"/>) that injects the StreamFlix
/// Netflix UI stylesheet and script into Jellyfin's <c>/web/index.html</c> response and prevents
/// stale 304 browser cache hits from serving un-injected HTML.
/// </summary>
public class StreamFlixStartupFilter : IStartupFilter
{
    private readonly ILogger<StreamFlixStartupFilter> _logger;
    private int _loggedOnce;

    public StreamFlixStartupFilter(ILogger<StreamFlixStartupFilter> logger)
    {
        _logger = logger;
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.Use(InvokeAsync);
            next(app);
        };
    }

    private async Task InvokeAsync(HttpContext context, Func<Task> nextMw)
    {
        var reqPath = context.Request.Path.Value;
        if (!HttpMethods.IsGet(reqPath != null ? context.Request.Method : string.Empty))
        {
            await nextMw().ConfigureAwait(false);
            return;
        }

        var config = Plugin.Instance?.Configuration;
        if (config != null && !config.EnableStreamFlixUi)
        {
            await nextMw().ConfigureAwait(false);
            return;
        }

        // Serve StreamFlix stylesheet directly on /Branding/Css with ETag caching so Jellyfin Mobile / Desktop / TV apps
        // that load server branding CSS always receive the live StreamFlix stylesheet without re-allocating on repeat loads.
        if (IsBrandingCssRequest(reqPath))
        {
            var (cssBytes, etag) = Plugin.GetEmbeddedStylesheetAsset();
            if (cssBytes.Length > 0)
            {
                context.Response.Headers["Cache-Control"] = "no-cache";
                if (!string.IsNullOrEmpty(etag))
                {
                    context.Response.Headers["ETag"] = etag;
                    var inm = context.Request.Headers["If-None-Match"].ToString();
                    if (!string.IsNullOrEmpty(inm) && inm.Contains(etag, StringComparison.Ordinal))
                    {
                        context.Response.StatusCode = StatusCodes.Status304NotModified;
                        return;
                    }
                }

                context.Response.StatusCode = StatusCodes.Status200OK;
                context.Response.ContentType = "text/css;charset=utf-8";
                context.Response.ContentLength = cssBytes.Length;
                await context.Response.Body.WriteAsync(cssBytes, 0, cssBytes.Length).ConfigureAwait(false);
                return;
            }
        }

        if (!IsIndexRequest(reqPath))
        {
            await nextMw().ConfigureAwait(false);
            return;
        }

        // Strip conditional cache headers and compression/range headers so the browser
        // never receives a 304 Not Modified with an old cached un-injected index.html.
        context.Request.Headers.Remove("Accept-Encoding");
        context.Request.Headers.Remove("Range");
        context.Request.Headers.Remove("If-Range");
        context.Request.Headers.Remove("If-None-Match");
        context.Request.Headers.Remove("If-Modified-Since");

        // Fast & reliable path: if index.html exists on disk in WebPath, read and serve it
        // directly with the StreamFlix bundle injected so Kestrel's SendFileAsync cannot bypass us.
        var diskIndex = Plugin.Instance?.IndexHtmlPath;
        if (!string.IsNullOrEmpty(diskIndex) && File.Exists(diskIndex))
        {
            try
            {
                var diskHtml = await File.ReadAllTextAsync(diskIndex, Encoding.UTF8).ConfigureAwait(false);
                var injectedHtml = InjectBundleIfNeeded(diskHtml);
                var diskBytes = Encoding.UTF8.GetBytes(injectedHtml);

                context.Response.StatusCode = 200;
                context.Response.ContentType = "text/html;charset=utf-8";
                context.Response.ContentLength = diskBytes.Length;
                context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
                context.Response.Headers["Pragma"] = "no-cache";
                context.Response.Headers["Expires"] = "0";
                context.Response.Headers.Remove("ETag");
                context.Response.Headers.Remove("Last-Modified");
                context.Response.Headers.Remove("Accept-Ranges");

                await context.Response.Body.WriteAsync(diskBytes, 0, diskBytes.Length).ConfigureAwait(false);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "StreamFlix: falling back to buffered downstream response for index.html.");
            }
        }

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await nextMw().ConfigureAwait(false);
        }
        catch
        {
            context.Response.Body = originalBody;
            throw;
        }

        context.Response.Body = originalBody;
        buffer.Seek(0, SeekOrigin.Begin);

        var isHtml = context.Response.StatusCode == 200
            && (context.Response.ContentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) ?? false);

        if (!isHtml)
        {
            await buffer.CopyToAsync(originalBody).ConfigureAwait(false);
            return;
        }

        string html;
        using (var reader = new StreamReader(buffer, Encoding.UTF8, true, 1024, leaveOpen: true))
        {
            html = await reader.ReadToEndAsync().ConfigureAwait(false);
        }

        html = InjectBundleIfNeeded(html);

        var bytes = Encoding.UTF8.GetBytes(html);
        context.Response.ContentType = "text/html;charset=utf-8";
        context.Response.ContentLength = bytes.Length;
        context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        context.Response.Headers["Pragma"] = "no-cache";
        context.Response.Headers["Expires"] = "0";
        context.Response.Headers.Remove("ETag");
        context.Response.Headers.Remove("Last-Modified");
        context.Response.Headers.Remove("Accept-Ranges");
        await originalBody.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
    }

    private string InjectBundleIfNeeded(string html)
    {
        try
        {
            var injectionBlock = Plugin.BuildInjectionBlock();
            if (html.Contains(injectionBlock, StringComparison.Ordinal))
            {
                return html;
            }

            if (html.Contains(Plugin.StartComment, StringComparison.Ordinal))
            {
                var startIdx = html.IndexOf(Plugin.StartComment, StringComparison.Ordinal);
                var endIdx = html.IndexOf(Plugin.EndComment, startIdx, StringComparison.Ordinal);
                if (startIdx >= 0 && endIdx > startIdx)
                {
                    html = html.Remove(startIdx, (endIdx + Plugin.EndComment.Length) - startIdx);
                }
            }

            var bodyClose = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            if (bodyClose >= 0)
            {
                html = html.Substring(0, bodyClose) + injectionBlock + "\n" + html.Substring(bodyClose);
                if (Interlocked.Exchange(ref _loggedOnce, 1) == 0)
                {
                    _logger.LogInformation("StreamFlix: injected Netflix UI & Google OAuth gate into index.html via StreamFlixStartupFilter.");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "StreamFlix: script injection error; serving original index.html.");
        }

        return html;
    }

    private static bool IsBrandingCssRequest(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return false;
        }

        var trimmed = path.TrimEnd('/');
        return trimmed.EndsWith("/Branding/Css", StringComparison.OrdinalIgnoreCase)
            || trimmed.EndsWith("/Branding/Css.css", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "/Branding/Css", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsIndexRequest(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return false;
        }

        return path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web", StringComparison.OrdinalIgnoreCase)
            || string.Equals(path, "/index.html", StringComparison.OrdinalIgnoreCase);
    }
}
