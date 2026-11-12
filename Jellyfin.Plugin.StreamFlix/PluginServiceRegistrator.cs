using Jellyfin.Plugin.StreamFlix.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.StreamFlix;

/// <summary>
/// Registers StreamFlix request-time web injection middleware and startup profile provisioning task.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<IStartupFilter, StreamFlixStartupFilter>();
    }
}
