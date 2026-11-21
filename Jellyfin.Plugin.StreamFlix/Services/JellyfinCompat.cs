using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

#if JF1011 || JF12
using JUser = Jellyfin.Database.Implementations.Entities.User;
using JSortBy = Jellyfin.Data.Enums.ItemSortBy;
using JSortOrder = Jellyfin.Database.Implementations.Enums.SortOrder;
#else
using JUser = Jellyfin.Data.Entities.User;
using JSortBy = Jellyfin.Data.Enums.ItemSortBy;
using JSortOrder = Jellyfin.Data.Enums.SortOrder;
#endif

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Compile-time strongly-typed adapter across Jellyfin 10.9/10.10 (<c>JF109</c>), 10.11 (<c>JF1011</c>),
/// and 12.x (<c>JF12</c>) so SDK changes surface at build time rather than silently failing via reflection.
/// </summary>
public static class JellyfinCompat
{
    public static List<object> GetShowcaseItems(ILibraryManager libraryManager)
    {
        var withBackdrop = new List<object>(36);
        var withoutBackdrop = new List<object>(36);
        try
        {
            var query = new InternalItemsQuery
            {
                Recursive = true,
                IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
                Limit = 72,
                OrderBy = new[]
                {
                    (JSortBy.DateCreated, JSortOrder.Descending),
                    (JSortBy.SortName, JSortOrder.Ascending),
                },
            };

            var items = libraryManager.GetItemList(query);
            foreach (var item in items)
            {
                if (item == null || item.Id == Guid.Empty)
                {
                    continue;
                }

                var hasBackdrop = HasBackdropImage(item);
                var hasPrimary = HasPrimaryImage(item);
                var typeName = item is Series ? "Series" : "Movie";
                var dto = new
                {
                    id = item.Id.ToString("N"),
                    name = item.Name ?? string.Empty,
                    type = typeName,
                    hasBackdrop,
                    hasPrimary,
                };

                if (hasBackdrop)
                {
                    withBackdrop.Add(dto);
                    if (withBackdrop.Count >= 36)
                    {
                        break;
                    }
                }
                else if (hasPrimary && withoutBackdrop.Count < 36)
                {
                    withoutBackdrop.Add(dto);
                }
            }

            if (withBackdrop.Count < 36 && withoutBackdrop.Count > 0)
            {
                foreach (var fallback in withoutBackdrop)
                {
                    withBackdrop.Add(fallback);
                    if (withBackdrop.Count >= 36)
                    {
                        break;
                    }
                }
            }
        }
        catch
        {
        }

        return withBackdrop;
    }

    public static List<object> GetServerMediaLibraries(ILibraryManager libraryManager)
    {
        var list = new List<object>();
        try
        {
            var root = libraryManager.GetUserRootFolder();
            if (root?.Children != null)
            {
                foreach (var child in root.Children.OrderBy(c => c.SortName ?? c.Name, StringComparer.OrdinalIgnoreCase))
                {
                    if (child is not CollectionFolder cf || cf.Id == Guid.Empty)
                    {
                        continue;
                    }

                    var rawType = (cf.CollectionType?.ToString() ?? string.Empty).ToLowerInvariant();
                    if (rawType is "music" or "books" or "audiobooks" or "photos" or "playlists" or "livetv")
                    {
                        continue;
                    }

                    list.Add(new
                    {
                        id = cf.Id.ToString("N"),
                        name = cf.Name ?? "Library",
                        collectionType = rawType,
                    });
                }
            }
        }
        catch
        {
        }

        return list;
    }

    public static object BuildHubBootstrap(
        ILibraryManager libraryManager,
        IUserDataManager userDataManager,
        JUser user,
        string serverId,
        IReadOnlyList<string>? profileAllowedLibIds,
        IReadOnlyList<string>? heroLibraryIds,
        IReadOnlyDictionary<string, double> popularScores)
    {
        var allowedSet = BuildNormalizedIdSet(profileAllowedLibIds);
        var accessibleFolders = ResolveAccessibleLibraryFolders(libraryManager, user, allowedSet);

        var viewsPayload = accessibleFolders.Select(cf =>
        {
            var ct = (cf.CollectionType?.ToString() ?? string.Empty).ToLowerInvariant();
            return (object)new
            {
                Id = cf.Id.ToString("N"),
                ServerId = serverId,
                Name = cf.Name ?? "Library",
                Type = "CollectionFolder",
                CollectionType = string.IsNullOrEmpty(ct) ? null : ct,
            };
        }).ToList();

        // Scope queries strictly to allowed folders when a profile has explicit library restrictions
        Guid[]? ancestorScope = allowedSet.Count > 0
            ? accessibleFolders.Select(f => f.Id).ToArray()
            : null;

        if (allowedSet.Count > 0 && (ancestorScope == null || ancestorScope.Length == 0))
        {
            return new
            {
                userId = user.Id.ToString("N"),
                serverId,
                views = viewsPayload,
                resumeItems = Array.Empty<object>(),
                nextUpItems = Array.Empty<object>(),
                favoriteItems = Array.Empty<object>(),
                allMovies = Array.Empty<object>(),
                allSeries = Array.Empty<object>(),
                collectionsItems = Array.Empty<object>(),
                filteredHeroPool = Array.Empty<object>(),
                totalMoviesCount = 0,
                totalSeriesCount = 0,
                totalCollectionsCount = 0,
                popularScores,
            };
        }

        var moviesCountQuery = CreateScopedQuery(user, new[] { BaseItemKind.Movie }, ancestorScope);
        var totalMoviesCount = SafeGetCount(libraryManager, moviesCountQuery);

        var moviesQuery = CreateScopedQuery(user, new[] { BaseItemKind.Movie }, ancestorScope);
        moviesQuery.Limit = 120;
        moviesQuery.OrderBy = new[]
        {
            (JSortBy.DateCreated, JSortOrder.Descending),
            (JSortBy.SortName, JSortOrder.Ascending),
        };
        var movieItems = SafeGetItems(libraryManager, moviesQuery);

        var seriesCountQuery = CreateScopedQuery(user, new[] { BaseItemKind.Series }, ancestorScope);
        var totalSeriesCount = SafeGetCount(libraryManager, seriesCountQuery);

        var seriesQuery = CreateScopedQuery(user, new[] { BaseItemKind.Series }, ancestorScope);
        seriesQuery.Limit = 120;
        seriesQuery.OrderBy = new[]
        {
            (JSortBy.DateCreated, JSortOrder.Descending),
            (JSortBy.SortName, JSortOrder.Ascending),
        };
        var seriesItems = SafeGetItems(libraryManager, seriesQuery);

        var collectionsCountQuery = CreateScopedQuery(user, new[] { BaseItemKind.BoxSet }, ancestorScope);
        var totalCollectionsCount = SafeGetCount(libraryManager, collectionsCountQuery);

        var collectionsQuery = CreateScopedQuery(user, new[] { BaseItemKind.BoxSet }, ancestorScope);
        collectionsQuery.Limit = 100;
        collectionsQuery.OrderBy = new[]
        {
            (JSortBy.SortName, JSortOrder.Ascending),
        };
        var collectionItems = SafeGetItems(libraryManager, collectionsQuery);

        var resumeQuery = CreateScopedQuery(user, new[] { BaseItemKind.Movie, BaseItemKind.Episode, BaseItemKind.Video }, ancestorScope);
        resumeQuery.IsResumable = true;
        resumeQuery.Limit = 12;
        resumeQuery.OrderBy = new[]
        {
            (JSortBy.DatePlayed, JSortOrder.Descending),
        };
        var resumeItems = SafeGetItems(libraryManager, resumeQuery);

        var favQuery = CreateScopedQuery(user, new[] { BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode, BaseItemKind.BoxSet }, ancestorScope);
        favQuery.IsFavorite = true;
        favQuery.Limit = 48;
        favQuery.OrderBy = new[]
        {
            (JSortBy.SortName, JSortOrder.Ascending),
        };
        var favItems = SafeGetItems(libraryManager, favQuery);

        var nextUpItems = ComputeNextUpEpisodes(libraryManager, userDataManager, user, ancestorScope);

        var filteredHeroPool = new List<BaseItem>();
        var heroSet = BuildNormalizedIdSet(heroLibraryIds);
        if (heroSet.Count > 0)
        {
            var matchingHeroFolders = accessibleFolders
                .Where(f => heroSet.Contains(NormalizeGuid(f.Id)))
                .Select(f => f.Id)
                .ToArray();
            if (matchingHeroFolders.Length > 0)
            {
                var heroQuery = CreateScopedQuery(user, new[] { BaseItemKind.Movie, BaseItemKind.Series }, matchingHeroFolders);
                heroQuery.Limit = 60;
                heroQuery.OrderBy = new[]
                {
                    (JSortBy.DateCreated, JSortOrder.Descending),
                    (JSortBy.SortName, JSortOrder.Ascending),
                };
                filteredHeroPool = SafeGetItems(libraryManager, heroQuery).ToList();
            }
        }

        return new
        {
            userId = user.Id.ToString("N"),
            serverId,
            views = viewsPayload,
            resumeItems = resumeItems.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            nextUpItems = nextUpItems.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            favoriteItems = favItems.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            allMovies = movieItems.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            allSeries = seriesItems.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            collectionsItems = collectionItems.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            filteredHeroPool = filteredHeroPool.Select(i => MapItemSummaryDto(i, user, userDataManager, libraryManager, serverId)).ToList(),
            totalMoviesCount = Math.Max(totalMoviesCount, movieItems.Count),
            totalSeriesCount = Math.Max(totalSeriesCount, seriesItems.Count),
            totalCollectionsCount = Math.Max(totalCollectionsCount, collectionItems.Count),
            popularScores,
        };
    }

    public static bool SyncUserLibraryRestriction(JUser user, IReadOnlyList<string>? allowedLibraryIds)
    {
        if (user == null || StreamFlixStartupTask.IsUserAdminCompat(user))
        {
            return false;
        }

        var validGuids = new List<Guid>();
        if (allowedLibraryIds != null)
        {
            foreach (var raw in allowedLibraryIds)
            {
                if (!string.IsNullOrWhiteSpace(raw) && Guid.TryParse(raw.Trim(), out var g) && g != Guid.Empty && !validGuids.Contains(g))
                {
                    validGuids.Add(g);
                }
            }
        }

        var wantEnableAll = validGuids.Count == 0;
        var changed = false;

        try
        {
            var t = user.GetType();
            var enableAllProp = t.GetProperty("EnableAllFolders");
            if (enableAllProp != null && enableAllProp.CanWrite && enableAllProp.GetValue(user) is bool curAll && curAll != wantEnableAll)
            {
                enableAllProp.SetValue(user, wantEnableAll);
                changed = true;
            }

            // Also sync PermissionKind.EnableAllFolders on Jellyfin 10.9–12.x User.Permissions
            StreamFlixStartupTask.SetSingleUserPermissionCompat(user, "EnableAllFolders", wantEnableAll, ref changed);

            if (!wantEnableAll)
            {
                var enabledFoldersProp = t.GetProperty("EnabledFolders");
                if (enabledFoldersProp != null)
                {
                    if (enabledFoldersProp.PropertyType == typeof(Guid[]) && enabledFoldersProp.CanWrite)
                    {
                        var curArr = enabledFoldersProp.GetValue(user) as Guid[] ?? Array.Empty<Guid>();
                        if (!curArr.OrderBy(x => x).SequenceEqual(validGuids.OrderBy(x => x)))
                        {
                            enabledFoldersProp.SetValue(user, validGuids.ToArray());
                            changed = true;
                        }
                    }
                    else if (enabledFoldersProp.PropertyType == typeof(string[]) && enabledFoldersProp.CanWrite)
                    {
                        var wantStrs = validGuids.Select(g => g.ToString("N")).ToArray();
                        var curStrs = enabledFoldersProp.GetValue(user) as string[] ?? Array.Empty<string>();
                        if (!curStrs.OrderBy(x => x, StringComparer.OrdinalIgnoreCase).SequenceEqual(wantStrs.OrderBy(x => x, StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase))
                        {
                            enabledFoldersProp.SetValue(user, wantStrs);
                            changed = true;
                        }
                    }
                }
            }
        }
        catch
        {
        }

        return changed;
    }

    private static InternalItemsQuery CreateScopedQuery(JUser user, BaseItemKind[] itemTypes, Guid[]? ancestorIds)
    {
        var q = new InternalItemsQuery(user)
        {
            Recursive = true,
            IncludeItemTypes = itemTypes,
        };
        if (ancestorIds is { Length: > 0 })
        {
            q.AncestorIds = ancestorIds;
        }

        return q;
    }

    private static IReadOnlyList<BaseItem> SafeGetItems(ILibraryManager libraryManager, InternalItemsQuery query)
    {
        try
        {
            var list = libraryManager.GetItemList(query);
            if (list.Count <= 1)
            {
                return list;
            }

            var seen = new HashSet<Guid>();
            var deduped = new List<BaseItem>(list.Count);
            foreach (var item in list)
            {
                if (item != null && item.Id != Guid.Empty && seen.Add(item.Id))
                {
                    deduped.Add(item);
                }
            }

            return deduped;
        }
        catch
        {
            return Array.Empty<BaseItem>();
        }
    }

    private static int SafeGetCount(ILibraryManager libraryManager, InternalItemsQuery query)
    {
        try
        {
            return libraryManager.GetCount(query);
        }
        catch
        {
            return 0;
        }
    }

    private static List<CollectionFolder> ResolveAccessibleLibraryFolders(
        ILibraryManager libraryManager,
        JUser user,
        HashSet<string> profileAllowedSet)
    {
        var result = new List<CollectionFolder>();
        try
        {
            var root = libraryManager.GetUserRootFolder();
            IEnumerable<BaseItem> children = root != null
                ? root.GetChildren(user, true)
                : Array.Empty<BaseItem>();

            foreach (var child in children.OrderBy(c => c.SortName ?? c.Name, StringComparer.OrdinalIgnoreCase))
            {
                if (child is not CollectionFolder cf || cf.Id == Guid.Empty)
                {
                    continue;
                }

                if (profileAllowedSet.Count > 0 && !profileAllowedSet.Contains(NormalizeGuid(cf.Id)))
                {
                    continue;
                }

                result.Add(cf);
            }
        }
        catch
        {
        }

        return result;
    }

    private static List<BaseItem> ComputeNextUpEpisodes(
        ILibraryManager libraryManager,
        IUserDataManager userDataManager,
        JUser user,
        Guid[]? ancestorScope)
    {
        var results = new List<BaseItem>(12);
        try
        {
            var playedQuery = CreateScopedQuery(user, new[] { BaseItemKind.Episode }, ancestorScope);
            playedQuery.IsPlayed = true;
            playedQuery.Limit = 36;
            playedQuery.OrderBy = new[] { (JSortBy.DatePlayed, JSortOrder.Descending) };
            var recentPlayed = SafeGetItems(libraryManager, playedQuery);

            var seenSeries = new HashSet<Guid>();
            foreach (var epItem in recentPlayed)
            {
                if (epItem is not Episode playedEp || playedEp.SeriesId == Guid.Empty || !seenSeries.Add(playedEp.SeriesId))
                {
                    continue;
                }

                var nextQuery = new InternalItemsQuery(user)
                {
                    Recursive = true,
                    AncestorIds = new[] { playedEp.SeriesId },
                    IncludeItemTypes = new[] { BaseItemKind.Episode },
                    IsPlayed = false,
                    Limit = 1,
                    OrderBy = new[]
                    {
                        (JSortBy.ParentIndexNumber, JSortOrder.Ascending),
                        (JSortBy.IndexNumber, JSortOrder.Ascending),
                    },
                };
                var nextCand = SafeGetItems(libraryManager, nextQuery).FirstOrDefault();
                if (nextCand != null)
                {
                    var ud = userDataManager.GetUserData(user, nextCand);
                    if (ud == null || ud.PlaybackPositionTicks <= 0)
                    {
                        results.Add(nextCand);
                        if (results.Count >= 12)
                        {
                            break;
                        }
                    }
                }
            }
        }
        catch
        {
        }

        return results;
    }

    private static object MapItemSummaryDto(
        BaseItem item,
        JUser user,
        IUserDataManager userDataManager,
        ILibraryManager libraryManager,
        string serverId)
    {
        var typeName = item switch
        {
            Movie => "Movie",
            Series => "Series",
            Episode => "Episode",
            BoxSet => "BoxSet",
            _ => item.GetType().Name,
        };

        var imageTags = new Dictionary<string, string>(StringComparer.Ordinal);
        if (HasPrimaryImage(item))
        {
            imageTags["Primary"] = ComputeImageTag(item, "Primary");
        }

        if (item.HasImage(ImageType.Logo, 0))
        {
            imageTags["Logo"] = ComputeImageTag(item, "Logo");
        }

        if (item.HasImage(ImageType.Thumb, 0))
        {
            imageTags["Thumb"] = ComputeImageTag(item, "Thumb");
        }

        var backdropTags = GetBackdropTags(item);

        string? parentBackdropItemId = null;
        var parentBackdropTags = Array.Empty<string>();
        string? seriesId = null;
        string? seriesName = null;
        string? seriesPrimaryTag = null;
        int? childCount = null;
        string? seriesStatus = null;

        if (item is Episode ep)
        {
            if (ep.SeriesId != Guid.Empty)
            {
                seriesId = ep.SeriesId.ToString("N");
                seriesName = ep.SeriesName;
                var parentSeries = libraryManager.GetItemById(ep.SeriesId);
                if (parentSeries != null)
                {
                    if (HasPrimaryImage(parentSeries))
                    {
                        seriesPrimaryTag = ComputeImageTag(parentSeries, "Primary");
                    }

                    if (backdropTags.Count == 0 && HasBackdropImage(parentSeries))
                    {
                        parentBackdropItemId = parentSeries.Id.ToString("N");
                        parentBackdropTags = GetBackdropTags(parentSeries).ToArray();
                    }
                }
            }
        }
        else if (item is Series ser)
        {
            seriesStatus = ser.Status?.ToString();
        }

        var ud = userDataManager.GetUserData(user, item);
        var posTicks = ud?.PlaybackPositionTicks ?? 0L;
        var runTicks = item.RunTimeTicks ?? 0L;
        double? playedPct = posTicks > 0 && runTicks > 0
            ? Math.Clamp((double)posTicks / runTicks * 100.0, 1.0, 100.0)
            : null;

        var remoteTrailers = (item.RemoteTrailers ?? Array.Empty<MediaUrl>())
            .Where(rt => !string.IsNullOrWhiteSpace(rt?.Url))
            .Select(rt => new { Url = rt.Url!, Name = rt.Name ?? string.Empty })
            .ToArray();

        return new
        {
            Id = item.Id.ToString("N"),
            ServerId = serverId,
            Name = item.Name ?? string.Empty,
            Type = typeName,
            Overview = item.Overview,
            ProductionYear = item.ProductionYear,
            PremiereDate = item.PremiereDate?.ToString("O"),
            DateCreated = item.DateCreated.ToString("O"),
            OfficialRating = item.OfficialRating,
            CommunityRating = item.CommunityRating,
            RunTimeTicks = item.RunTimeTicks,
            Genres = item.Genres ?? Array.Empty<string>(),
            Taglines = item.Tagline is { Length: > 0 } tl ? new[] { tl } : Array.Empty<string>(),
            RemoteTrailers = remoteTrailers,
            Status = seriesStatus,
            ChildCount = childCount,
            SeriesId = seriesId,
            SeriesName = seriesName,
            SeriesPrimaryImageTag = seriesPrimaryTag,
            ParentIndexNumber = item.ParentIndexNumber,
            IndexNumber = item.IndexNumber,
            ImageTags = imageTags,
            BackdropImageTags = backdropTags,
            ParentBackdropItemId = parentBackdropItemId,
            ParentBackdropImageTags = parentBackdropTags,
            UserData = new
            {
                PlaybackPositionTicks = posTicks,
                PlayCount = ud?.PlayCount ?? 0,
                IsFavorite = ud?.IsFavorite ?? false,
                Played = ud?.Played ?? false,
                PlayedPercentage = playedPct,
            },
        };
    }

    private static List<string> GetBackdropTags(BaseItem item)
    {
        var tags = new List<string>();
        try
        {
            var idx = 0;
            foreach (var img in item.GetImages(ImageType.Backdrop))
            {
                if (img != null && !string.IsNullOrWhiteSpace(img.Path))
                {
                    tags.Add(ComputePathTag(img.Path, idx));
                    idx++;
                }
            }
        }
        catch
        {
            if (item.HasImage(ImageType.Backdrop, 0))
            {
                tags.Add(ComputeImageTag(item, "Backdrop"));
            }
        }

        return tags;
    }

    private static bool HasBackdropImage(BaseItem item)
    {
        return item.HasImage(ImageType.Backdrop, 0);
    }

    private static bool HasPrimaryImage(BaseItem item)
    {
        return !string.IsNullOrWhiteSpace(item.PrimaryImagePath) || item.HasImage(ImageType.Primary, 0);
    }

    private static string ComputeImageTag(BaseItem item, string kind)
    {
        var ticks = item.DateModified.Ticks;
        var hash = unchecked((uint)(ticks ^ (ticks >> 32) ^ kind.GetHashCode(StringComparison.Ordinal)));
        return hash.ToString("x8", CultureInfo.InvariantCulture);
    }

    private static string ComputePathTag(string path, int idx)
    {
        var hash = unchecked((uint)(path.GetHashCode(StringComparison.OrdinalIgnoreCase) ^ (idx * 397)));
        return hash.ToString("x8", CultureInfo.InvariantCulture);
    }

    private static HashSet<string> BuildNormalizedIdSet(IReadOnlyList<string>? ids)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (ids == null)
        {
            return set;
        }

        foreach (var id in ids)
        {
            if (!string.IsNullOrWhiteSpace(id) && !string.Equals(id.Trim(), "__NONE__", StringComparison.OrdinalIgnoreCase))
            {
                var norm = id.Replace("-", string.Empty, StringComparison.Ordinal).Trim().ToLowerInvariant();
                if (norm.Length > 0)
                {
                    set.Add(norm);
                }
            }
        }

        return set;
    }

    private static string NormalizeGuid(Guid g) => g.ToString("N").ToLowerInvariant();
}
