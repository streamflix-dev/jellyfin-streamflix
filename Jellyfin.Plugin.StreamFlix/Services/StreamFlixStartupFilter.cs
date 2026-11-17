using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Request-time ASP.NET Core middleware (<see cref="IStartupFilter"/>) that injects the StreamFlix
/// Netflix UI stylesheet and script into Jellyfin's <c>/web/index.html</c> response while composing
/// cooperatively with other web-rewriting plugins (such as WebGPU Player and File Transformation).
/// </summary>
public class StreamFlixStartupFilter : IStartupFilter
{
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);
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

        // Never hijack /Branding/Css: native desktop/TV/mobile clients (such as Jellyfin Media Player for Windows)
        // fetch /Branding/Css without loading /StreamFlix/ClientScript, whereas web clients load ClientStyles via index.html.
        // Also skip StreamFlix HTML injection for Jellyfin Media Player desktop native shell so its mpv/tile shell runs natively.
        var ua = context.Request.Headers.UserAgent.ToString();
        if (!string.IsNullOrEmpty(ua)
            && (ua.Contains("JellyfinMediaPlayer", StringComparison.OrdinalIgnoreCase)
                || ua.Contains("JMP/", StringComparison.OrdinalIgnoreCase)))
        {
            await nextMw().ConfigureAwait(false);
            return;
        }

        if (!IsIndexRequest(reqPath))
        {
            await nextMw().ConfigureAwait(false);
            return;
        }

        // Capture client ETag validator before stripping conditional/compression headers for downstream middleware
        // (so WebGPU Player, File Transformation, and StaticFileMiddleware all emit uncompressed 200 HTML into our buffer).
        var clientIfNoneMatch = context.Request.Headers["If-None-Match"].ToString();
        context.Request.Headers.Remove("Accept-Encoding");
        context.Request.Headers.Remove("Range");
        context.Request.Headers.Remove("If-Range");
        context.Request.Headers.Remove("If-None-Match");
        context.Request.Headers.Remove("If-Modified-Since");
        context.Request.Headers.Remove("If-Match");
        context.Request.Headers.Remove("If-Unmodified-Since");

        var originalBody = context.Response.Body;
        var originalBodyFeature = context.Features.Get<IHttpResponseBodyFeature>();
        using var buffer = new MemoryStream();
        context.Features.Set<IHttpResponseBodyFeature>(new StreamResponseBodyFeature(buffer));
        context.Response.Body = buffer;
        try
        {
            await nextMw().ConfigureAwait(false);
        }
        finally
        {
            context.Response.Body = originalBody;
            if (originalBodyFeature != null)
            {
                context.Features.Set<IHttpResponseBodyFeature>(originalBodyFeature);
            }
        }

        // Preserve redirects (e.g. /web -> /web/ so WebGPU Player's /web/ base path resolution stays intact) and non-200 responses
        if (context.Response.StatusCode != StatusCodes.Status200OK)
        {
            if (buffer.Length > 0)
            {
                buffer.Seek(0, SeekOrigin.Begin);
                await buffer.CopyToAsync(originalBody).ConfigureAwait(false);
            }

            return;
        }

        // If downstream left body empty despite 200 OK, fall back to reading index.html from WebPath on disk
        string? html = null;
        if (buffer.Length == 0)
        {
            var diskIndex = Plugin.Instance?.IndexHtmlPath;
            if (!string.IsNullOrEmpty(diskIndex) && File.Exists(diskIndex))
            {
                try
                {
                    html = await File.ReadAllTextAsync(diskIndex, Encoding.UTF8).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "StreamFlix: fallback disk read for index.html failed.");
                }
            }
        }
        else
        {
            var isHtml = (context.Response.ContentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) ?? false)
                || string.IsNullOrEmpty(context.Response.ContentType);
            var isUncompressed = string.IsNullOrEmpty(context.Response.Headers["Content-Encoding"].ToString());

            if (!isHtml || !isUncompressed)
            {
                buffer.Seek(0, SeekOrigin.Begin);
                await buffer.CopyToAsync(originalBody).ConfigureAwait(false);
                return;
            }

            buffer.Seek(0, SeekOrigin.Begin);
            using var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 1024, leaveOpen: true);
            html = await reader.ReadToEndAsync().ConfigureAwait(false);
            if (string.IsNullOrEmpty(context.Response.ContentType)
                && !html.Contains("</body>", StringComparison.OrdinalIgnoreCase)
                && !html.Contains("<html", StringComparison.OrdinalIgnoreCase))
            {
                buffer.Seek(0, SeekOrigin.Begin);
                await buffer.CopyToAsync(originalBody).ConfigureAwait(false);
                return;
            }
        }

        if (string.IsNullOrEmpty(html))
        {
            return;
        }

        var injectedHtml = InjectBundleIfNeeded(html);
        var bytes = Utf8NoBom.GetBytes(injectedHtml);
        var computedEtag = ComputeStrongEtag(bytes);

        context.Response.Headers.Remove("Last-Modified");
        context.Response.Headers.Remove("Accept-Ranges");
        context.Response.Headers["Cache-Control"] = "no-cache";
        context.Response.Headers["ETag"] = computedEtag;

        if (!string.IsNullOrEmpty(clientIfNoneMatch) && clientIfNoneMatch.Contains(computedEtag, StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status304NotModified;
            context.Response.ContentLength = null;
            return;
        }

        context.Response.ContentType = "text/html;charset=utf-8";
        context.Response.ContentLength = bytes.Length;
        await originalBody.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
    }

    private static string ComputeStrongEtag(ReadOnlySpan<byte> content)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(content, hash);
        return "\"sf-" + Convert.ToHexString(hash.Slice(0, 8)).ToLowerInvariant() + "\"";
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
                    _logger.LogInformation("StreamFlix: injected Netflix UI & SSO gate into index.html via composable StreamFlixStartupFilter.");
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
