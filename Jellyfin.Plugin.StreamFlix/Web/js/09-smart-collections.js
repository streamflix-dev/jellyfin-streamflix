/* StreamFlix Client (09/14) — Smart Collections & Curated Genre Rows */
    /* ----------------------------------------------------------------------
       v7.3 — Smart collections: rows built automatically from your library
       ---------------------------------------------------------------------- */
    var SMART_MIN_ITEMS = 6;
    var FAMILY_RATINGS = { 'G': 1, 'PG': 1, 'TV-G': 1, 'TV-Y': 1, 'TV-Y7': 1, 'TV-Y7-FV': 1, 'TV-PG': 1, 'U': 1, 'PG-8': 1, 'ALL': 1 };

    function smartByRating(a, b) {
        return (Number(b.CommunityRating) || 0) - (Number(a.CommunityRating) || 0);
    }

    function buildSmartCollections(d) {
        d = d || state.hubData || {};
        var movies = (d.allMovies || []).filter(function (it) { return it && it.Id; });
        var series = (d.allSeries || []).filter(function (it) { return it && it.Id; });
        var sig = movies.length + ':' + series.length + ':' + (movies[0] ? movies[0].Id : '') + ':' + (series[0] ? series[0].Id : '');
        if (state.smartCache && state.smartCache.sig === sig && state.smartCache.movies === d.allMovies) {
            return state.smartCache.rows;
        }
        var rows = [];
        var add = function (id, title, items, scope) {
            if (items.length >= SMART_MIN_ITEMS) {
                rows.push({ id: id, title: title, items: items.slice(0, 24), scope: scope });
            }
        };
        var rated = function (it, min) { return Number(it.CommunityRating) >= min; };
        var played = function (it) { return Boolean(it.UserData && it.UserData.Played); };
        var now = Date.now();
        var oldEnough = function (it) {
            var t = it.DateCreated ? Date.parse(it.DateCreated) : NaN;
            return isNaN(t) || now - t > 60 * 24 * 3600 * 1000;
        };

        var acclaimedMovies = movies.filter(function (it) { return rated(it, 7.5); }).sort(smartByRating);
        var acclaimedShows = series.filter(function (it) { return rated(it, 7.5); }).sort(smartByRating);
        add('smart-acclaimed', 'Critically Acclaimed', movies.concat(series).filter(function (it) { return rated(it, 7.5); }).sort(smartByRating), 'home');
        add('smart-acclaimed-movies', 'Critically Acclaimed Movies', acclaimedMovies, 'movies');
        add('smart-acclaimed-shows', 'Critically Acclaimed Shows', acclaimedShows, 'series');
        add('smart-gems', 'Hidden Gems', movies.concat(series).filter(function (it) {
            return !played(it) && rated(it, 7) && oldEnough(it);
        }).sort(smartByRating), 'home');
        add('smart-short', 'Under 90 Minutes', movies.filter(function (it) {
            var ticks = Number(it.RunTimeTicks) || 0;
            return ticks > 0 && ticks <= 95 * 60 * 10000000;
        }).sort(smartByRating), 'movies');

        var thisDecade = Math.floor(new Date().getFullYear() / 10) * 10;
        var decades = {};
        movies.forEach(function (it) {
            var y = Number(it.ProductionYear) || 0;
            if (!y) {
                return;
            }
            var dec = y < 1970 ? 1900 : Math.floor(y / 10) * 10;
            if (dec >= thisDecade) {
                return;
            }
            (decades[dec] = decades[dec] || []).push(it);
        });
        Object.keys(decades).map(Number).filter(function (dec) {
            return decades[dec].length >= SMART_MIN_ITEMS;
        }).sort(function (a, b) {
            return decades[b].length - decades[a].length;
        }).slice(0, 2).sort(function (a, b) { return a - b; }).forEach(function (dec) {
            var label = dec === 1900 ? 'Classics' : (dec < 2000 ? '\u2019' + String(dec).slice(2) + 's Favourites' : dec + 's Favourites');
            add('smart-decade-' + dec, label, decades[dec].slice().sort(smartByRating), 'movies');
        });

        add('smart-family', 'Family Night', movies.concat(series).filter(function (it) {
            return FAMILY_RATINGS[String(it.OfficialRating || '').toUpperCase()] === 1;
        }).sort(smartByRating), 'movies');

        var binge = series.filter(function (it) {
            return String(it.Status || '') === 'Ended' && (Number(it.ChildCount) || 0) >= 2;
        });
        if (binge.length < SMART_MIN_ITEMS) {
            binge = series.filter(function (it) { return (Number(it.ChildCount) || 0) >= 3; });
        }
        add('smart-binge', 'Binge-Worthy Series', binge.sort(smartByRating), 'series');

        state.smartCache = { sig: sig, movies: d.allMovies, rows: rows };
        return rows;
    }

    function smartRowsHtml(ids) {
        var rows = buildSmartCollections();
        return rows.filter(function (r) {
            return ids === '*' || ids.indexOf(r.id) !== -1 || (ids.indexOf('smart-decade') !== -1 && r.id.indexOf('smart-decade-') === 0);
        }).map(function (r) {
            return buildRowHtml(r.id, rowTitle(r.title), r.items.map(buildPosterCardHtml).join(''), { className: 'streamflix-row-smart' });
        }).join('');
    }

    function buildGenreCollectionRowsHtml(itemsPool) {
        if (!Array.isArray(itemsPool) || itemsPool.length === 0) {
            return '';
        }
        var genreBuckets = {};
        var genreOrder = [];
        itemsPool.forEach(function (it) {
            if (!it || !Array.isArray(it.Genres)) {
                return;
            }
            it.Genres.forEach(function (g) {
                var gClean = String(g || '').trim();
                if (!gClean) {
                    return;
                }
                if (!genreBuckets[gClean]) {
                    genreBuckets[gClean] = [];
                    genreOrder.push(gClean);
                }
                if (genreBuckets[gClean].length < 20) {
                    genreBuckets[gClean].push(it);
                }
            });
        });
        genreOrder.sort(function (a, b) {
            return genreBuckets[b].length - genreBuckets[a].length;
        });
        return genreOrder.slice(0, 6).map(function (gName, idx) {
            if (genreBuckets[gName].length < 2 && genreOrder.length > 3) {
                return '';
            }
            return buildRowHtml('genre-' + idx, rowTitle(gName), genreBuckets[gName].map(buildPosterCardHtml).join(''));
        }).join('');
    }

    function updatePaddleState(wrap) {
        var track = wrap && wrap.querySelector('.streamflix-carousel-track');
        if (!track) {
            return;
        }
        var max = track.scrollWidth - track.clientWidth;
        wrap.classList.toggle('at-start', track.scrollLeft <= 4);
        wrap.classList.toggle('at-end', track.scrollLeft >= max - 4);
        wrap.classList.toggle('no-scroll', max <= 4);
    }

    function collectLibraryViewCachedItems() {
        var out = [];
        var map = state.libraryViewData || {};
        Object.keys(map).forEach(function (k) {
            var entry = map[k];
            if (entry && Array.isArray(entry.items)) {
                out = out.concat(entry.items);
            }
        });
        return out;
    }

    function bindInteractiveCardsInContainer(containerEl, extraItemsList, onAfterPlay) {
        if (!containerEl) {
            return;
        }
        var d = state.hubData || {};
        var itemMap = {};
        [
            d.heroItems, d.resumeItems, d.nextUpItems, d.top10Items,
            d.favoriteItems, d.recentMovies, d.recentSeries,
            d.allMovies, d.allSeries, d.collectionsItems,
            state.searchResults || [], (state.browseFilter && state.browseFilter.items) || [],
            (state.libraryBrowser && state.libraryBrowser.items) || [], collectLibraryViewCachedItems(),
            personalRowItems(), extraItemsList || []
        ].forEach(function (arr) {
            (arr || []).forEach(function (it) {
                if (it && it.Id) {
                    // The same title can sit in several rows; keep the copy that knows how far in you are
                    var prev = itemMap[it.Id];
                    var prevPct = prev && prev.UserData && prev.UserData.PlayedPercentage;
                    if (!prevPct || (it.UserData && it.UserData.PlayedPercentage)) {
                        itemMap[it.Id] = it;
                    }
                }
            });
        });

        Array.prototype.forEach.call(containerEl.querySelectorAll('.streamflix-paddle'), function (paddle) {
            paddle.addEventListener('click', function () {
                var dir = parseInt(paddle.getAttribute('data-scroll-dir'), 10) || 1;
                var track = paddle.parentNode && paddle.parentNode.querySelector('.streamflix-carousel-track');
                if (track) {
                    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.86), behavior: 'smooth' });
                }
            });
        });

        Array.prototype.forEach.call(containerEl.querySelectorAll('.streamflix-carousel-wrap'), function (wrap) {
            var track = wrap.querySelector('.streamflix-carousel-track');
            if (!track) {
                return;
            }
            var pending = false;
            track.addEventListener('scroll', function () {
                if (pending) {
                    return;
                }
                pending = true;
                (window.requestAnimationFrame || setTimeout)(function () {
                    pending = false;
                    updatePaddleState(wrap);
                });
            }, { passive: true });
            updatePaddleState(wrap);
        });

        Array.prototype.forEach.call(containerEl.querySelectorAll('[data-item-id]'), function (card) {
            var itemId = card.getAttribute('data-item-id');
            var item = itemMap[itemId] || findCachedItemById(itemId) || { Id: itemId };
            card.__bfxItem = item;

            card.addEventListener('click', function (ev) {
                var actionBtn = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
                if (actionBtn) {
                    ev.stopPropagation();
                    var act = actionBtn.getAttribute('data-action');
                    if (act === 'play') {
                        if (typeof onAfterPlay === 'function') {
                            onAfterPlay();
                        }
                        navigateOrPlayItem(item);
                    } else if (act === 'fav') {
                        toggleFavoriteItem(item, actionBtn);
                    } else if (act === 'played') {
                        togglePlayedItem(item, actionBtn);
                    } else if (act === 'remove-resume') {
                        removeFromContinueWatching(item);
                    } else if (act === 'info') {
                        openHeroDetailModal(item);
                    }
                    return;
                }
                openHeroDetailModal(item);
            });
            card.addEventListener('keydown', function (ev) {
                if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === card) {
                    ev.preventDefault();
                    openHeroDetailModal(item);
                }
            });
        });
        hydrateCompleteImages(containerEl);
    }

    function getActiveHeroItems() {
        var d = state.hubData;
        var limit = getHeroSlideLimit();
        var cat = state.activeCategory || 'all';
        if (cat.indexOf('lib:') === 0) {
            var libId = cat.slice(4);
            var libEntry = state.libraryViewData && state.libraryViewData[normalizeGuid(libId)];
            if (libEntry && Array.isArray(libEntry.heroItems) && libEntry.heroItems.length > 0) {
                return libEntry.heroItems.slice(0, limit);
            }
            return [];
        }
        if (cat === 'movies') {
            return (d.recentMovies && d.recentMovies.length) ? d.recentMovies.slice(0, limit) : (d.heroItems || []).slice(0, limit);
        }
        if (cat === 'series') {
            return (d.recentSeries && d.recentSeries.length) ? d.recentSeries.slice(0, limit) : (d.heroItems || []).slice(0, limit);
        }
        if (cat === 'collections' || cat === 'mylist' || cat === 'top10' || cat === 'hot') {
            return [];
        }
        if (d.heroItems && d.heroItems.length) {
            return d.heroItems.slice(0, limit);
        }
        return (d.recentMovies || []).concat(d.recentSeries || []).slice(0, limit);
    }

    function pickSurpriseTitle() {
        var d = state.hubData || {};
        var cat = state.activeCategory || 'all';
        var basePool = [];
        if (cat.indexOf('lib:') === 0) {
            var libEntry = state.libraryViewData && state.libraryViewData[normalizeGuid(cat.slice(4))];
            if (libEntry && Array.isArray(libEntry.items) && libEntry.items.length >= 2) {
                basePool = dedupeMediaItems(libEntry.items);
            }
        }
        if (!basePool.length && cat === 'movies' && Array.isArray(d.allMovies) && d.allMovies.length >= 2) {
            basePool = dedupeMediaItems(d.allMovies);
        } else if (!basePool.length && cat === 'series' && Array.isArray(d.allSeries) && d.allSeries.length >= 2) {
            basePool = dedupeMediaItems(d.allSeries);
        } else if (!basePool.length) {
            basePool = dedupeMediaItems([].concat(d.allMovies || [], d.allSeries || []));
        }
        if (!basePool.length) {
            return null;
        }
        var unwatched = basePool.filter(function (it) {
            return !(it.UserData && it.UserData.Played);
        });
        var candidatePool = unwatched.length >= 2 ? unwatched : basePool;
        if (candidatePool.length > 1 && state.lastSurpriseId) {
            var lastNorm = normalizeGuid(state.lastSurpriseId);
            var filtered = candidatePool.filter(function (it) {
                return normalizeGuid(it.Id) !== lastNorm;
            });
            if (filtered.length > 0) {
                candidatePool = filtered;
            }
        }
        var picked = candidatePool[Math.floor(Math.random() * candidatePool.length)];
        if (picked && picked.Id) {
            state.lastSurpriseId = picked.Id;
        }
        return picked || null;
    }

    function triggerSurpriseMe() {
        var chosen = pickSurpriseTitle();
        if (!chosen) {
            showToast('Add a few movies or shows to use Surprise Me.', 'info');
            return;
        }
        openHeroDetailModal(chosen, { fromSurprise: true });
    }

    function applyBrowseFilter(filterSpec) {
        if (!filterSpec || !filterSpec.name) {
            return;
        }
        cancelPendingSearch();
        var reqId = (state.browseFilterSeq = (state.browseFilterSeq || 0) + 1);
        state.searchQuery = '';
        state.searchResults = null;
        state.seerrSearchResults = null;
        state.browseFilter = {
            kind: filterSpec.kind || 'genre',
            role: filterSpec.role || '',
            name: String(filterSpec.name).trim(),
            id: filterSpec.id ? String(filterSpec.id).trim() : '',
            loading: true,
            items: []
        };

        if (!isOnHomeRoute()) {
            window.location.hash = '#/home';
        }
        ensureCinemaHubMounted();
        renderCinemaHubContents();
        try {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        } catch (e) {
            window.scrollTo(0, 0);
        }

        var d = state.hubData || {};
        var fullLocalPool = dedupeMediaItems([].concat(d.allMovies || [], d.allSeries || []));
        var auth = getJellyfinAuthContext();
        var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated';
        var targetLower = state.browseFilter.name.toLowerCase();

        var finish = function (serverItems, localFallback) {
            if (state.browseFilterSeq !== reqId || !state.browseFilter) {
                return;
            }
            state.browseFilter.items = dedupeMediaItems([].concat(serverItems || [], localFallback || []));
            state.browseFilter.loading = false;
            renderCinemaHubContents();
        };

        if (state.browseFilter.kind === 'genre') {
            var localGenreHits = fullLocalPool.filter(function (it) {
                return Array.isArray(it.Genres) && it.Genres.some(function (g) {
                    return String(g || '').toLowerCase() === targetLower;
                });
            });
            if (!uid) {
                finish([], localGenreHits);
                return;
            }
            fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&Genres=' + encodeURIComponent(state.browseFilter.name) + '&SortBy=CommunityRating,DateCreated&SortOrder=Descending&Limit=100&Fields=' + fields)
                .then(function (res) {
                    finish((res && res.Items) || [], localGenreHits);
                })
                .catch(function () {
                    finish([], localGenreHits);
                });
            return;
        }

        // Person filter (Director / Cast)
        if (!uid) {
            finish([], []);
            return;
        }
        var personNameEnc = encodeURIComponent(state.browseFilter.name);
        var personByIdPromise = state.browseFilter.id
            ? fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&PersonIds=' + encodeURIComponent(state.browseFilter.id) + '&SortBy=CommunityRating,DateCreated&SortOrder=Descending&Limit=100&Fields=' + fields)
            : Promise.resolve({ Items: [] });

        personByIdPromise.then(function (resById) {
            var byIdItems = (resById && resById.Items) || [];
            if (byIdItems.length > 0) {
                finish(byIdItems, []);
                return null;
            }
            return fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&Person=' + personNameEnc + '&SortBy=CommunityRating,DateCreated&SortOrder=Descending&Limit=100&Fields=' + fields)
                .then(function (resByName) {
                    finish((resByName && resByName.Items) || [], []);
                });
        }).catch(function () {
            finish([], []);
        });
    }

    /* ----------------------------------------------------------------------
       Top Navigation Customization, User Library Views & Full Library Browser
       ---------------------------------------------------------------------- */
    var LIBRARY_BROWSER_PAGE_SIZE = 60;
    var LIBRARY_BROWSER_SORTS = [
        { key: 'date_desc', label: 'Date Added (Newest)', sortBy: 'DateCreated,SortName', sortOrder: 'Descending' },
        { key: 'date_asc', label: 'Date Added (Oldest)', sortBy: 'DateCreated,SortName', sortOrder: 'Ascending' },
        { key: 'alpha_asc', label: 'Alphabetical (A–Z)', sortBy: 'SortName', sortOrder: 'Ascending' },
        { key: 'alpha_desc', label: 'Alphabetical (Z–A)', sortBy: 'SortName', sortOrder: 'Descending' },
        { key: 'year_desc', label: 'Release Year (Newest)', sortBy: 'ProductionYear,PremiereDate,SortName', sortOrder: 'Descending' },
        { key: 'year_asc', label: 'Release Year (Oldest)', sortBy: 'ProductionYear,PremiereDate,SortName', sortOrder: 'Ascending' },
        { key: 'rating_desc', label: 'Community Rating', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' },
        { key: 'critic_desc', label: 'Critic Rating', sortBy: 'CriticRating,CommunityRating,SortName', sortOrder: 'Descending' },
        { key: 'runtime_desc', label: 'Runtime (Longest)', sortBy: 'RunTimeTicks,SortName', sortOrder: 'Descending' },
        { key: 'runtime_asc', label: 'Runtime (Shortest)', sortBy: 'RunTimeTicks,SortName', sortOrder: 'Ascending' },
        { key: 'random', label: 'Random Shuffle', sortBy: 'Random', sortOrder: 'Descending' }
    ];

    function getCurrentServerNavSig() {
        var cfg = state.config || {};
        var showLibs = cfg.showLibrariesInNav !== false;
        var hid = Array.isArray(cfg.navHiddenBuiltIns) ? cfg.navHiddenBuiltIns.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean).join(',') : '';
        var libs = Array.isArray(cfg.navLibraryIds) ? cfg.navLibraryIds.map(function (x) { return normalizeGuid(x) || String(x || '').trim(); }).filter(Boolean).join(',') : '';
        return String(showLibs) + '|' + hid + '|' + libs;
    }

    function getProfileNavPrefs() {
        var pid = state.activeProfile && state.activeProfile.id;
        if (!pid) {
            return null;
        }
        var stored = loadJson(NAV_PROFILE_PREF_PREFIX + pid, null);
        if (!stored || typeof stored !== 'object' || !stored.customized) {
            return null;
        }
        if (stored.serverNavSig !== getCurrentServerNavSig()) {
            return null;
        }
        return stored;
    }

    function saveProfileNavPrefs(prefs) {
        var pid = state.activeProfile && state.activeProfile.id;
        if (!pid) {
            return;
        }
        if (prefs && typeof prefs === 'object') {
            prefs.serverNavSig = getCurrentServerNavSig();
        }
        saveJson(NAV_PROFILE_PREF_PREFIX + pid, prefs || null);
    }

    function getEffectiveHiddenBuiltInNavMap() {
        var map = {};
        var profPrefs = getProfileNavPrefs();
        var list = profPrefs && Array.isArray(profPrefs.hiddenBuiltIns)
            ? profPrefs.hiddenBuiltIns
            : ((state.config && Array.isArray(state.config.navHiddenBuiltIns)) ? state.config.navHiddenBuiltIns : []);
        list.forEach(function (id) {
            var clean = String(id || '').trim().toLowerCase();
            if (clean && clean !== 'all') {
                map[clean] = true;
            }
        });
        return map;
    }

    function isNavBuiltInHidden(builtInId) {
        var map = getEffectiveHiddenBuiltInNavMap();
        return Boolean(map[String(builtInId || '').toLowerCase()]);
    }

    function getEligibleUserLibraryViews(d) {
        var views = (d && Array.isArray(d.views)) ? d.views : ((state.hubData && Array.isArray(state.hubData.views)) ? state.hubData.views : []);
        var excluded = { music: 1, books: 1, audiobooks: 1, photos: 1, playlists: 1, livetv: 1 };
        return views.filter(function (v) {
            if (!v || !v.Id || !v.Name) {
                return false;
            }
            var ct = String(v.CollectionType || '').toLowerCase();
            return !excluded[ct];
        });
    }

    function matchBuiltInKindForView(view) {
        if (!view) {
            return '';
        }
        var low = String(view.Name || '').trim().toLowerCase();
        var ct = String(view.CollectionType || '').trim().toLowerCase();
        if (low === 'movies' || low === 'films') {
            return 'movies';
        }
        if (low === 'shows' || low === 'tv shows' || low === 'tv' || low === 'series') {
            return 'series';
        }
        if (low === 'collections' || low === 'boxsets' || low === 'box sets' || ct === 'boxsets') {
            return 'collections';
        }
        return '';
    }

    function isDuplicateBuiltInLibraryName(viewName, hiddenBuiltInMap) {
        var low = String(viewName || '').trim().toLowerCase();
        if (!hiddenBuiltInMap.movies && (low === 'movies' || low === 'films')) {
            return true;
        }
        if (!hiddenBuiltInMap.series && (low === 'shows' || low === 'tv shows' || low === 'tv' || low === 'series')) {
            return true;
        }
        if (!hiddenBuiltInMap.collections && (low === 'collections' || low === 'boxsets' || low === 'box sets')) {
            return true;
        }
        return false;
    }

    function getDefaultVisibleLibraryIdsMap(views, hiddenBuiltInMap) {
        var out = {};
        var cfg = state.config || {};
        if (cfg.showLibrariesInNav === false) {
            return out;
        }
        var cfgLibIds = Array.isArray(cfg.navLibraryIds) ? cfg.navLibraryIds : [];
        if (cfgLibIds.length > 0) {
            if (cfgLibIds.indexOf('__NONE__') !== -1) {
                return out;
            }
            var allow = {};
            cfgLibIds.forEach(function (id) {
                var norm = normalizeGuid(id);
                if (norm) {
                    allow[norm] = true;
                }
            });
            views.forEach(function (v) {
                var norm = normalizeGuid(v.Id);
                if (allow[norm]) {
                    out[norm] = true;
                }
            });
            return out;
        }
        // Smart default when uncustomized: surface all custom/additional libraries (e.g. "Anime", "Anime Movies", "4K")
        // without duplicating a single standard "Movies" or "Shows" pill already shown in the nav bar.
        views.forEach(function (v) {
            if (!isDuplicateBuiltInLibraryName(v.Name, hiddenBuiltInMap)) {
                out[normalizeGuid(v.Id)] = true;
            }
        });
        return out;
    }

    function getConfiguredNavPills(d) {
        d = d || state.hubData || {};
        var cfg = state.config || {};
        var hiddenBuiltInMap = getEffectiveHiddenBuiltInNavMap();
        var eligibleViews = getEligibleUserLibraryViews(d);
        var profPrefs = getProfileNavPrefs();
        var visibleLibMap = {};
        var showLibsInNav = cfg.showLibrariesInNav !== false;
        var cfgLibIds = Array.isArray(cfg.navLibraryIds) ? cfg.navLibraryIds : [];
        var hasExplicitServerLibs = showLibsInNav && cfgLibIds.length > 0;

        if (profPrefs && Array.isArray(profPrefs.libraryIds)) {
            profPrefs.libraryIds.forEach(function (id) {
                var norm = normalizeGuid(id);
                if (norm) {
                    visibleLibMap[norm] = true;
                }
            });
        } else {
            visibleLibMap = getDefaultVisibleLibraryIdsMap(eligibleViews, hiddenBuiltInMap);
        }

        // Prevent duplicate tabs AND honor explicit unchecking of Movies / TV Shows / Collections under "Visible Jellyfin libraries"
        var suppressBuiltIn = {};
        if (showLibsInNav) {
            eligibleViews.forEach(function (v) {
                var kind = matchBuiltInKindForView(v);
                if (!kind) {
                    return;
                }
                var normId = normalizeGuid(v.Id);
                if (visibleLibMap[normId]) {
                    suppressBuiltIn[kind] = true;
                } else if (hasExplicitServerLibs && !profPrefs) {
                    suppressBuiltIn[kind] = true;
                }
            });
        }

        var pills = [{ id: 'all', label: 'Home', hide: false }];
        if (!hiddenBuiltInMap.series && !suppressBuiltIn.series) {
            pills.push({ id: 'series', label: 'Shows', hide: !d.allSeries.length });
        }
        if (!hiddenBuiltInMap.movies && !suppressBuiltIn.movies) {
            pills.push({ id: 'movies', label: 'Movies', hide: !d.allMovies.length });
        }
        if (!hiddenBuiltInMap.hot) {
            pills.push({ id: 'hot', label: 'New & Popular', hide: !(d.allMovies.length || d.allSeries.length) });
        }

        eligibleViews.forEach(function (v) {
            var normId = normalizeGuid(v.Id);
            if (visibleLibMap[normId]) {
                pills.push({
                    id: 'lib:' + v.Id,
                    label: String(v.Name || 'Library'),
                    view: v,
                    hide: false
                });
            }
        });

        if (!hiddenBuiltInMap.collections && !suppressBuiltIn.collections) {
            pills.push({
                id: 'collections',
                label: 'Collections',
                hide: !d.collectionsItems.length && !buildSmartCollections(d).length
            });
        }
        if (!hiddenBuiltInMap.top10) {
            pills.push({ id: 'top10', label: 'Top 10', hide: !d.top10Items.length });
        }
        if (!hiddenBuiltInMap.mylist) {
            pills.push({ id: 'mylist', label: 'My List', hide: false });
        }
        return pills;
    }

    function openNavCustomizeModal() {
        var d = state.hubData || {};
        var eligibleViews = getEligibleUserLibraryViews(d);
        var profPrefs = getProfileNavPrefs();
        var hiddenMap = getEffectiveHiddenBuiltInNavMap();
        var visibleLibMap = (profPrefs && Array.isArray(profPrefs.libraryIds))
            ? (function () {
                var m = {};
                profPrefs.libraryIds.forEach(function (id) { m[normalizeGuid(id)] = true; });
                return m;
            })()
            : getDefaultVisibleLibraryIdsMap(eligibleViews, hiddenMap);

        var builtIns = [
            { id: 'series', label: 'Shows' },
            { id: 'movies', label: 'Movies' },
            { id: 'hot', label: 'New & Popular' },
            { id: 'collections', label: 'Collections' },
            { id: 'top10', label: 'Top 10' },
            { id: 'mylist', label: 'My List' }
        ];

        var builtInRowsHtml = ''
            + '<label class="bfx-nav-cust-chip is-locked">'
            + '  <input type="checkbox" checked disabled />'
            + '  <span>Home</span><small>Pinned</small>'
            + '</label>'
            + builtIns.map(function (b) {
                var on = !hiddenMap[b.id];
                return ''
                    + '<label class="bfx-nav-cust-chip">'
                    + '  <input type="checkbox" data-nav-builtin="' + escapeHtml(b.id) + '"' + (on ? ' checked' : '') + ' />'
                    + '  <span>' + escapeHtml(b.label) + '</span>'
                    + '</label>';
            }).join('');

        var libRowsHtml = eligibleViews.length > 0
            ? eligibleViews.map(function (v) {
                var norm = normalizeGuid(v.Id);
                var on = Boolean(visibleLibMap[norm]);
                var ct = String(v.CollectionType || '').toLowerCase();
                var badge = ct === 'tvshows' ? 'TV' : (ct === 'movies' ? 'Movies' : (ct === 'boxsets' ? 'BoxSets' : 'Library'));
                return ''
                    + '<label class="bfx-nav-cust-chip">'
                    + '  <input type="checkbox" data-nav-lib-id="' + escapeHtml(v.Id) + '"' + (on ? ' checked' : '') + ' />'
                    + '  <span>' + escapeHtml(v.Name) + '</span><small>' + escapeHtml(badge) + '</small>'
                    + '</label>';
            }).join('')
            : '<div class="streamflix-modal-text" style="margin:4px 0 0;">No accessible media libraries loaded yet.</div>';

        var profName = (state.activeProfile && state.activeProfile.name) || 'this profile';
        var m = openModal(''
            + '<div class="bfx-cs-head">'
            + '  <div class="bfx-cs-head-ico">' + icon('sliders') + '</div>'
            + '  <div class="bfx-cs-head-copy">'
            + '    <h2>Navigation Bar</h2>'
            + '    <p class="streamflix-modal-text">Choose which built-in categories and Jellyfin libraries appear in the top bar for <strong>' + escapeHtml(profName) + '</strong>.</p>'
            + '  </div>'
            + '</div>'
            + '<div class="bfx-nav-cust-section">'
            + '  <div class="bfx-nav-cust-label">Built-In Tabs</div>'
            + '  <div class="bfx-nav-cust-grid">' + builtInRowsHtml + '</div>'
            + '</div>'
            + '<div class="bfx-nav-cust-section">'
            + '  <div class="bfx-nav-cust-label">Your Jellyfin Libraries</div>'
            + '  <div class="bfx-nav-cust-grid">' + libRowsHtml + '</div>'
            + '</div>'
            + '<div class="streamflix-modal-actions" style="justify-content:space-between;">'
            + (profPrefs
                ? '  <button type="button" class="streamflix-ghost-btn" data-nav-act="reset">Use Server Default</button>'
                : '  <span></span>')
            + '  <div style="display:flex;gap:8px;">'
            + '    <button type="button" class="streamflix-ghost-btn" data-nav-act="cancel">Cancel</button>'
            + '    <button type="button" class="streamflix-btn-primary" data-nav-act="save">Save</button>'
            + '  </div>'
            + '</div>', { className: 'bfx-nav-customize-modal' });

        var cancelBtn = m.modal.querySelector('[data-nav-act="cancel"]');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () { m.close(false); });
        }
        var resetBtn = m.modal.querySelector('[data-nav-act="reset"]');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                saveProfileNavPrefs(null);
                m.close(true);
                if (document.getElementById('streamflix-cinema-hub')) {
                    renderCinemaHubContents();
                }
                showToast('Navigation bar reset to server defaults.', 'info');
            });
        }
        var saveBtn = m.modal.querySelector('[data-nav-act="save"]');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var nextHidden = [];
                Array.prototype.forEach.call(m.modal.querySelectorAll('input[data-nav-builtin]'), function (cb) {
                    if (!cb.checked) {
                        nextHidden.push(cb.getAttribute('data-nav-builtin'));
                    }
                });
                var nextLibs = [];
                Array.prototype.forEach.call(m.modal.querySelectorAll('input[data-nav-lib-id]:checked'), function (cb) {
                    var lid = cb.getAttribute('data-nav-lib-id');
                    if (lid) {
                        nextLibs.push(lid);
                    }
                });
                saveProfileNavPrefs({
                    customized: true,
                    hiddenBuiltIns: nextHidden,
                    libraryIds: nextLibs
                });
                m.close(true);
                if (document.getElementById('streamflix-cinema-hub')) {
                    renderCinemaHubContents();
                }
                showToast('Navigation bar updated.', 'success');
            });
        }
        return m;
    }

    function findLibraryViewById(viewId) {
        var norm = normalizeGuid(viewId);
        if (!norm) {
            return null;
        }
        var views = getEligibleUserLibraryViews(state.hubData);
        for (var i = 0; i < views.length; i++) {
            if (normalizeGuid(views[i].Id) === norm) {
                return views[i];
            }
        }
        return null;
    }

    function resolveItemTypesForLibraryView(view) {
        var ct = String((view && view.CollectionType) || '').toLowerCase();
        if (ct === 'movies') {
            return 'Movie';
        }
        if (ct === 'tvshows') {
            return 'Series';
        }
        if (ct === 'boxsets') {
            return 'BoxSet';
        }
        return 'Movie,Series,BoxSet,Video';
    }

    function ensureLibraryCategoryLoaded(view) {
        if (!view || !view.Id) {
            return null;
        }
        var norm = normalizeGuid(view.Id);
        if (!state.libraryViewData) {
            state.libraryViewData = {};
        }
        var existing = state.libraryViewData[norm];
        if (existing && (existing.loaded || existing.loading)) {
            return existing;
        }
        var auth = getJellyfinAuthContext();
        if (!auth || !auth.userId) {
            return null;
        }
        var entry = {
            id: view.Id,
            name: view.Name || 'Library',
            collectionType: String(view.CollectionType || '').toLowerCase(),
            itemTypes: resolveItemTypesForLibraryView(view),
            loading: true,
            loaded: false,
            items: [],
            recentItems: [],
            topRatedItems: [],
            heroItems: [],
            totalCount: 0
        };
        state.libraryViewData[norm] = entry;

        var uid = encodeURIComponent(auth.userId);
        var pid = encodeURIComponent(view.Id);
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated,ChildCount';
        var itemTypes = entry.itemTypes;

        var pRecent = fetchUserItems(uid, 'ParentId=' + pid + '&Recursive=true&IncludeItemTypes=' + encodeURIComponent(itemTypes) + '&Limit=60&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
        var pRated = fetchUserItems(uid, 'ParentId=' + pid + '&Recursive=true&IncludeItemTypes=' + encodeURIComponent(itemTypes) + '&Limit=24&SortBy=CommunityRating,DateCreated&SortOrder=Descending&Fields=' + fields)
            .catch(function () { return { Items: [] }; });

        Promise.all([pRecent, pRated]).then(function (resList) {
            var kFilter = typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode : function (arr) { return arr || []; };
            var kidsActive = typeof isKidsProfileActive === 'function' && isKidsProfileActive();
            var recentItems = kFilter((resList[0] && resList[0].Items) || []);
            var ratedItems = kFilter((resList[1] && resList[1].Items) || []).filter(function (it) {
                return (Number(it.CommunityRating) || 0) >= 6.8;
            });
            var rawTotal = Number(resList[0] && resList[0].TotalRecordCount) || 0;

            entry.items = dedupeMediaItems(recentItems.concat(ratedItems));
            entry.recentItems = recentItems.slice(0, 24);
            entry.topRatedItems = ratedItems.slice(0, 20);
            entry.heroItems = recentItems.filter(function (it) {
                return (Array.isArray(it.BackdropImageTags) && it.BackdropImageTags.length > 0)
                    || (it.ImageTags && it.ImageTags.Primary);
            }).slice(0, 12);
            entry.totalCount = kidsActive ? recentItems.length : Math.max(rawTotal, recentItems.length);
            entry.loading = false;
            entry.loaded = true;
            if (document.getElementById('streamflix-cinema-hub') && state.activeCategory === ('lib:' + view.Id)) {
                renderCinemaHubContents();
            }
        }).catch(function () {
            entry.loading = false;
            entry.loaded = true;
            if (document.getElementById('streamflix-cinema-hub') && state.activeCategory === ('lib:' + view.Id)) {
                renderCinemaHubContents();
            }
        });

        return entry;
    }

    function disconnectLibraryBrowserObserver() {
        if (state.libraryBrowserObserver) {
            try { state.libraryBrowserObserver.disconnect(); } catch (eObs) {}
            state.libraryBrowserObserver = null;
        }
    }

    function getLibraryBrowserSortSpec(sortKey) {
        for (var i = 0; i < LIBRARY_BROWSER_SORTS.length; i++) {
            if (LIBRARY_BROWSER_SORTS[i].key === sortKey) {
                return LIBRARY_BROWSER_SORTS[i];
            }
        }
        return LIBRARY_BROWSER_SORTS[0];
    }

    function openLibraryBrowser(opts) {
        opts = opts || {};
        disconnectLibraryBrowserObserver();
        state.browseFilter = null;
        state.libraryBrowser = {
            active: true,
            scopeKey: String(opts.scopeKey || 'movies'),
            title: String(opts.title || 'Library'),
            parentId: String(opts.parentId || ''),
            itemTypes: String(opts.itemTypes || 'Movie,Series'),
            sortKey: String(opts.initialSort || 'alpha_asc'),
            genre: String(opts.initialGenre || ''),
            yearFilter: '',
            watchState: 'all',
            officialRating: '',
            studioId: '',
            startLetter: '',
            items: [],
            totalCount: 0,
            startIndex: 0,
            hasMore: false,
            loading: true,
            loadingMore: false,
            facetsLoaded: false,
            genres: [],
            years: [],
            decades: [],
            officialRatings: [],
            studios: []
        };
        renderCinemaHubContents();
        loadLibraryBrowserFacets();
        fetchLibraryBrowserPage(true);
        try {
            var hubEl = document.getElementById('streamflix-cinema-hub');
            if (hubEl) {
                hubEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
            }
        } catch (eSc) {}
    }

    function closeLibraryBrowser() {
        disconnectLibraryBrowserObserver();
        state.libraryBrowser = null;
        renderCinemaHubContents();
    }

    function loadLibraryBrowserFacets() {
        var lb = state.libraryBrowser;
        var auth = getJellyfinAuthContext();
        if (!lb || !auth || !auth.userId) {
            return;
        }
        var uid = encodeURIComponent(auth.userId);
        var qsBase = 'userId=' + uid
            + (lb.parentId ? ('&parentId=' + encodeURIComponent(lb.parentId)) : '')
            + (lb.itemTypes ? ('&includeItemTypes=' + encodeURIComponent(lb.itemTypes)) : '');

        var pFilters = apiFetch('/Items/Filters?' + qsBase).catch(function () { return null; });
        var pStudios = apiFetch('/Studios?userId=' + uid
            + (lb.parentId ? ('&parentId=' + encodeURIComponent(lb.parentId)) : '')
            + (lb.itemTypes ? ('&includeItemTypes=' + encodeURIComponent(lb.itemTypes)) : '')
            + '&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=100')
            .catch(function () { return null; });

        Promise.all([pFilters, pStudios]).then(function (resArr) {
            if (!state.libraryBrowser || state.libraryBrowser !== lb) {
                return;
            }
            var fData = resArr[0] || {};
            var sData = resArr[1] || {};

            var genres = Array.isArray(fData.Genres) ? fData.Genres.filter(Boolean) : [];
            if (!genres.length) {
                var gSeen = {};
                var d = state.hubData || {};
                [].concat(d.allMovies || [], d.allSeries || []).forEach(function (it) {
                    (it.Genres || []).forEach(function (g) {
                        var gc = String(g || '').trim();
                        if (gc && !gSeen[gc]) {
                            gSeen[gc] = true;
                            genres.push(gc);
                        }
                    });
                });
                genres.sort();
            }

            var rawYears = Array.isArray(fData.Years)
                ? fData.Years.map(function (y) { return Number(y); }).filter(function (y) { return y > 1880 && y < 2100; })
                : [];
            rawYears.sort(function (a, b) { return b - a; });
            var decSeen = {};
            var decades = [];
            rawYears.forEach(function (y) {
                var dec = Math.floor(y / 10) * 10;
                if (!decSeen[dec]) {
                    decSeen[dec] = true;
                    decades.push(dec);
                }
            });

            var ratings = Array.isArray(fData.OfficialRatings) ? fData.OfficialRatings.filter(Boolean) : [];
            var studios = Array.isArray(sData.Items)
                ? sData.Items.filter(function (st) { return st && st.Id && st.Name; }).map(function (st) {
                    return { id: String(st.Id), name: String(st.Name) };
                })
                : [];

            lb.genres = genres;
            lb.years = rawYears;
            lb.decades = decades;
            lb.officialRatings = ratings;
            lb.studios = studios;
            lb.facetsLoaded = true;
            syncLibraryBrowserSelectOptionsInPlace();
        });
    }

    function expandYearFilterToCsv(yearFilter) {
        var val = String(yearFilter || '').trim();
        if (!val) {
            return '';
        }
        if (val.indexOf('decade:') === 0) {
            var start = parseInt(val.slice(7), 10);
            if (!isNaN(start) && start >= 1900 && start <= 2100) {
                var yrs = [];
                for (var y = start; y < start + 10; y++) {
                    yrs.push(String(y));
                }
                return yrs.join(',');
            }
            return '';
        }
        return /^\d{4}$/.test(val) ? val : '';
    }

    function fetchLibraryBrowserPage(reset) {
        var lb = state.libraryBrowser;
        if (!lb || !lb.active) {
            return;
        }
        var auth = getJellyfinAuthContext();
        if (!auth || !auth.userId) {
            lb.loading = false;
            lb.loadingMore = false;
            renderCinemaHubContents();
            return;
        }
        if (!reset && (lb.loading || lb.loadingMore || !lb.hasMore)) {
            return;
        }

        var reqId = (state.libraryBrowserSeq = (state.libraryBrowserSeq || 0) + 1);
        var startIdx = reset ? 0 : lb.startIndex;
        if (reset) {
            disconnectLibraryBrowserObserver();
            lb.loading = true;
            lb.loadingMore = false;
            lb.items = [];
            lb.startIndex = 0;
            lb.hasMore = false;
            renderCinemaHubContents();
        } else {
            lb.loadingMore = true;
            updateLibraryBrowserFooterInPlace();
        }

        var uid = encodeURIComponent(auth.userId);
        var sortSpec = getLibraryBrowserSortSpec(lb.sortKey);
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated,ChildCount,OfficialRating,RunTimeTicks,ProductionYear,CommunityRating';
        var params = [
            'Recursive=true',
            'StartIndex=' + startIdx,
            'Limit=' + LIBRARY_BROWSER_PAGE_SIZE,
            'SortBy=' + encodeURIComponent(sortSpec.sortBy),
            'SortOrder=' + encodeURIComponent(sortSpec.sortOrder),
            'Fields=' + fields
        ];
        if (lb.parentId) {
            params.push('ParentId=' + encodeURIComponent(lb.parentId));
        }
        if (lb.itemTypes) {
            params.push('IncludeItemTypes=' + encodeURIComponent(lb.itemTypes));
        }
        if (lb.genre) {
            params.push('Genres=' + encodeURIComponent(lb.genre));
        }
        var yearsCsv = expandYearFilterToCsv(lb.yearFilter);
        if (yearsCsv) {
            params.push('Years=' + encodeURIComponent(yearsCsv));
        }
        var jfFilters = [];
        if (lb.watchState === 'unplayed') {
            jfFilters.push('IsUnplayed');
        } else if (lb.watchState === 'played') {
            jfFilters.push('IsPlayed');
        } else if (lb.watchState === 'favorites') {
            jfFilters.push('IsFavorite');
        } else if (lb.watchState === 'resumable') {
            jfFilters.push('IsResumable');
        }
        if (jfFilters.length > 0) {
            params.push('Filters=' + jfFilters.join(','));
        }
        if (lb.officialRating) {
            params.push('OfficialRatings=' + encodeURIComponent(lb.officialRating));
        }
        if (lb.studioId) {
            params.push('StudioIds=' + encodeURIComponent(lb.studioId));
        }
        if (lb.startLetter === '#') {
            params.push('NameLessThan=A');
        } else if (/^[A-Z]$/.test(lb.startLetter)) {
            params.push('NameStartsWith=' + lb.startLetter);
        }

        fetchUserItems(uid, params.join('&')).then(function (res) {
            if (state.libraryBrowserSeq !== reqId || state.libraryBrowser !== lb) {
                return;
            }
            var rawPage = (res && Array.isArray(res.Items)) ? res.Items : [];
            var kFilter = typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode : function (arr) { return arr || []; };
            var kidsActive = typeof isKidsProfileActive === 'function' && isKidsProfileActive();
            var filteredPage = kFilter(rawPage);
            var apiTotal = Number(res && res.TotalRecordCount) || 0;

            lb.startIndex = startIdx + rawPage.length;
            lb.loading = false;
            lb.loadingMore = false;

            if (reset) {
                lb.items = filteredPage;
            } else {
                var existingSeen = {};
                lb.items.forEach(function (it) {
                    if (it && it.Id) {
                        existingSeen[normalizeGuid(it.Id)] = true;
                    }
                });
                var newlyAdded = [];
                filteredPage.forEach(function (it) {
                    if (it && it.Id && !existingSeen[normalizeGuid(it.Id)]) {
                        existingSeen[normalizeGuid(it.Id)] = true;
                        lb.items.push(it);
                        newlyAdded.push(it);
                    }
                });
                lb.totalCount = kidsActive
                    ? (rawPage.length < LIBRARY_BROWSER_PAGE_SIZE ? lb.items.length : Math.max(apiTotal, lb.items.length))
                    : Math.max(apiTotal, lb.items.length);
                lb.hasMore = rawPage.length >= LIBRARY_BROWSER_PAGE_SIZE && lb.startIndex < Math.max(apiTotal, lb.startIndex);
                appendLibraryBrowserCardsInPlace(newlyAdded);
                return;
            }

            lb.totalCount = kidsActive
                ? (rawPage.length < LIBRARY_BROWSER_PAGE_SIZE ? lb.items.length : Math.max(apiTotal, lb.items.length))
                : Math.max(apiTotal, lb.items.length);
            lb.hasMore = rawPage.length >= LIBRARY_BROWSER_PAGE_SIZE && lb.startIndex < Math.max(apiTotal, lb.startIndex);
            renderCinemaHubContents();
        }).catch(function () {
            if (state.libraryBrowserSeq !== reqId || state.libraryBrowser !== lb) {
                return;
            }
            lb.loading = false;
            lb.loadingMore = false;
            lb.hasMore = false;
            if (reset) {
                renderCinemaHubContents();
            } else {
                updateLibraryBrowserFooterInPlace();
            }
        });
    }

    function hasActiveLibraryBrowserFilter(lb) {
        if (!lb) {
            return false;
        }
        return Boolean(lb.genre || lb.yearFilter || (lb.watchState && lb.watchState !== 'all') || lb.officialRating || lb.studioId || lb.startLetter);
    }

    function buildLibraryBrowserSelectOptionsHtml(lb) {
        var genreOpts = '<option value="">All Genres</option>' + (lb.genres || []).map(function (g) {
            return '<option value="' + escapeHtml(g) + '"' + (lb.genre === g ? ' selected' : '') + '>' + escapeHtml(g) + '</option>';
        }).join('');

        var yearOpts = '<option value="">Any Year</option>';
        if (lb.decades && lb.decades.length > 0) {
            yearOpts += '<optgroup label="Decades">' + lb.decades.map(function (dec) {
                var dVal = 'decade:' + dec;
                return '<option value="' + dVal + '"' + (lb.yearFilter === dVal ? ' selected' : '') + '>' + dec + 's</option>';
            }).join('') + '</optgroup>';
        }
        if (lb.years && lb.years.length > 0) {
            yearOpts += '<optgroup label="Release Year">' + lb.years.map(function (yr) {
                var yVal = String(yr);
                return '<option value="' + yVal + '"' + (lb.yearFilter === yVal ? ' selected' : '') + '>' + yVal + '</option>';
            }).join('') + '</optgroup>';
        }

        var ratingOpts = '<option value="">Any Rating</option>' + (lb.officialRatings || []).map(function (r) {
            return '<option value="' + escapeHtml(r) + '"' + (lb.officialRating === r ? ' selected' : '') + '>' + escapeHtml(r) + '</option>';
        }).join('');

        var studioOpts = '<option value="">All Studios</option>' + (lb.studios || []).map(function (st) {
            return '<option value="' + escapeHtml(st.id) + '"' + (lb.studioId === st.id ? ' selected' : '') + '>' + escapeHtml(st.name) + '</option>';
        }).join('');

        return {
            genreOpts: genreOpts,
            yearOpts: yearOpts,
            ratingOpts: ratingOpts,
            studioOpts: studioOpts
        };
    }

    function syncLibraryBrowserSelectOptionsInPlace() {
        var lb = state.libraryBrowser;
        if (!lb) {
            return;
        }
        var built = buildLibraryBrowserSelectOptionsHtml(lb);
        var gSel = document.getElementById('bfx-lb-genre');
        if (gSel) { gSel.innerHTML = built.genreOpts; }
        var ySel = document.getElementById('bfx-lb-year');
        if (ySel) { ySel.innerHTML = built.yearOpts; }
        var rSel = document.getElementById('bfx-lb-rating');
        if (rSel) { rSel.innerHTML = built.ratingOpts; }
        var stSel = document.getElementById('bfx-lb-studio');
        if (stSel) {
            stSel.innerHTML = built.studioOpts;
            stSel.style.display = (lb.studios && lb.studios.length > 0) ? '' : 'none';
        }
    }

    function buildLibraryBrowserFooterHtml(lb) {
        if (!lb || lb.loading || !lb.items.length) {
            return '';
        }
        var shown = lb.items.length;
        var total = Math.max(lb.totalCount || 0, shown);
        return ''
            + '<div class="bfx-lb-footer" id="bfx-lb-footer">'
            + '  <div class="bfx-lb-progress-text" id="bfx-lb-status">Showing <strong>' + shown + '</strong> of <strong>' + total + '</strong> titles</div>'
            + (lb.hasMore
                ? ('  <button type="button" class="streamflix-ghost-btn bfx-lb-more-btn" id="bfx-lb-more-btn"' + (lb.loadingMore ? ' disabled' : '') + '>'
                    + (lb.loadingMore ? '<span class="bfx-mini-ring"></span><span>Loading more…</span>' : '<span>Load More Titles</span>')
                    + '</button>'
                    + '  <div class="bfx-lb-sentinel" id="bfx-lb-sentinel" aria-hidden="true"></div>')
                : '')
            + '</div>';
    }

    function updateLibraryBrowserFooterInPlace() {
        var lb = state.libraryBrowser;
        var host = document.getElementById('bfx-lb-footer-wrap');
        if (!lb || !host) {
            return;
        }
        host.innerHTML = buildLibraryBrowserFooterHtml(lb);
        var moreBtn = document.getElementById('bfx-lb-more-btn');
        if (moreBtn) {
            moreBtn.addEventListener('click', function () {
                fetchLibraryBrowserPage(false);
            });
        }
        connectLibraryBrowserInfiniteScroll();
    }

    function appendLibraryBrowserCardsInPlace(newItems) {
        var lb = state.libraryBrowser;
        var grid = document.getElementById('bfx-lb-grid');
        if (!lb || !grid) {
            renderCinemaHubContents();
            return;
        }
        if (newItems && newItems.length > 0) {
            var tempWrap = document.createElement('div');
            tempWrap.innerHTML = newItems.map(buildPosterCardHtml).join('');
            bindInteractiveCardsInContainer(tempWrap, newItems, null);
            while (tempWrap.firstChild) {
                grid.appendChild(tempWrap.firstChild);
            }
        }
        var countBadge = document.getElementById('bfx-lb-total-badge');
        if (countBadge) {
            countBadge.textContent = String(lb.totalCount || lb.items.length);
        }
        updateLibraryBrowserFooterInPlace();
    }

    function connectLibraryBrowserInfiniteScroll() {
        disconnectLibraryBrowserObserver();
        var lb = state.libraryBrowser;
        if (!lb || !lb.hasMore || lb.loading || lb.loadingMore || typeof IntersectionObserver === 'undefined') {
            return;
        }
        var sentinel = document.getElementById('bfx-lb-sentinel');
        if (!sentinel) {
            return;
        }
        state.libraryBrowserObserver = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    fetchLibraryBrowserPage(false);
                    break;
                }
            }
        }, { rootMargin: '650px 0px' });
        state.libraryBrowserObserver.observe(sentinel);
    }

    function buildLibraryBrowserHtml(lb) {
        var sortOpts = LIBRARY_BROWSER_SORTS.map(function (s) {
            return '<option value="' + s.key + '"' + (lb.sortKey === s.key ? ' selected' : '') + '>' + escapeHtml(s.label) + '</option>';
        }).join('');
        var watchOpts = [
            { val: 'all', label: 'All Watch States' },
            { val: 'unplayed', label: 'Unwatched' },
            { val: 'played', label: 'Watched' },
            { val: 'favorites', label: 'Favorites (My List)' },
            { val: 'resumable', label: 'Continue Watching' }
        ].map(function (w) {
            return '<option value="' + w.val + '"' + (lb.watchState === w.val ? ' selected' : '') + '>' + w.label + '</option>';
        }).join('');

        var selHtml = buildLibraryBrowserSelectOptionsHtml(lb);
        var letters = [''].concat(['#'], 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
        var alphaHtml = letters.map(function (ch) {
            var label = ch === '' ? 'All' : ch;
            var active = lb.startLetter === ch;
            return '<button type="button" class="bfx-lb-alpha-btn' + (active ? ' active' : '') + '" data-lb-letter="' + escapeHtml(ch) + '">' + escapeHtml(label) + '</button>';
        }).join('');

        var hasFilters = hasActiveLibraryBrowserFilter(lb);
        var countVal = !lb.loading ? (lb.totalCount || lb.items.length) : null;

        return ''
            + '<section class="streamflix-row streamflix-row-grid bfx-lib-browser" data-row-id="library-browser">'
            + '  <div class="bfx-lb-header">'
            + '    <div class="bfx-lb-title-wrap">'
            + '      <span class="streamflix-filter-kicker">Full Catalog Browser</span>'
            + '      <h2 class="streamflix-row-title">' + escapeHtml(lb.title)
            + (countVal !== null ? '<span class="streamflix-row-count" id="bfx-lb-total-badge">' + countVal + '</span>' : '')
            + '      </h2>'
            + '    </div>'
            + '    <div class="bfx-lb-header-actions">'
            + (hasFilters ? '<button type="button" class="streamflix-ghost-btn bfx-btn-xs" id="bfx-lb-reset-filters">' + icon('refresh') + '<span>Reset Filters</span></button>' : '')
            + '      <button type="button" class="streamflix-ghost-btn streamflix-filter-clear-btn" id="bfx-lb-close-btn">' + icon('chevronLeft') + '<span>Back to Featured</span></button>'
            + '    </div>'
            + '  </div>'
            + '  <div class="bfx-lb-toolbar" role="region" aria-label="Sort and filter library">'
            + '    <label class="bfx-lb-control"><span class="bfx-lb-control-lbl">Sort</span><select id="bfx-lb-sort" class="bfx-lb-select">' + sortOpts + '</select></label>'
            + '    <label class="bfx-lb-control"><span class="bfx-lb-control-lbl">Genre</span><select id="bfx-lb-genre" class="bfx-lb-select">' + selHtml.genreOpts + '</select></label>'
            + '    <label class="bfx-lb-control"><span class="bfx-lb-control-lbl">Year</span><select id="bfx-lb-year" class="bfx-lb-select">' + selHtml.yearOpts + '</select></label>'
            + '    <label class="bfx-lb-control"><span class="bfx-lb-control-lbl">Status</span><select id="bfx-lb-watch" class="bfx-lb-select">' + watchOpts + '</select></label>'
            + '    <label class="bfx-lb-control"><span class="bfx-lb-control-lbl">Rating</span><select id="bfx-lb-rating" class="bfx-lb-select">' + selHtml.ratingOpts + '</select></label>'
            + '    <label class="bfx-lb-control" id="bfx-lb-studio-wrap" style="' + ((lb.studios && lb.studios.length > 0) ? '' : 'display:none;') + '"><span class="bfx-lb-control-lbl">Studio</span><select id="bfx-lb-studio" class="bfx-lb-select">' + selHtml.studioOpts + '</select></label>'
            + '  </div>'
            + '  <div class="bfx-lb-alpha-bar" role="navigation" aria-label="Jump by first letter">' + alphaHtml + '</div>'
            + (lb.loading
                ? '  <div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Loading catalog…</span></div>'
                : (lb.items.length > 0
                    ? '  <div class="streamflix-grid bfx-lib-browser-grid" id="bfx-lb-grid">' + lb.items.map(buildPosterCardHtml).join('') + '</div>'
                    : buildEmptyStateHtml('film', 'No matching titles', hasFilters ? 'Try adjusting or resetting your active filters above.' : 'This library doesn\'t have any matching items yet.')))
            + '  <div id="bfx-lb-footer-wrap">' + buildLibraryBrowserFooterHtml(lb) + '</div>'
            + '</section>';
    }

    function bindLibraryBrowserInteractive(rowsScope) {
        var lb = state.libraryBrowser;
        if (!lb || !rowsScope) {
            return;
        }
        var closeBtn = rowsScope.querySelector('#bfx-lb-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeLibraryBrowser);
        }
        var resetBtn = rowsScope.querySelector('#bfx-lb-reset-filters');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                lb.genre = '';
                lb.yearFilter = '';
                lb.watchState = 'all';
                lb.officialRating = '';
                lb.studioId = '';
                lb.startLetter = '';
                fetchLibraryBrowserPage(true);
            });
        }
        var bindSel = function (id, prop) {
            var el = rowsScope.querySelector('#' + id);
            if (el) {
                el.addEventListener('change', function () {
                    lb[prop] = el.value || '';
                    fetchLibraryBrowserPage(true);
                });
            }
        };
        bindSel('bfx-lb-sort', 'sortKey');
        bindSel('bfx-lb-genre', 'genre');
        bindSel('bfx-lb-year', 'yearFilter');
        bindSel('bfx-lb-watch', 'watchState');
        bindSel('bfx-lb-rating', 'officialRating');
        bindSel('bfx-lb-studio', 'studioId');

        Array.prototype.forEach.call(rowsScope.querySelectorAll('[data-lb-letter]'), function (btn) {
            btn.addEventListener('click', function () {
                var picked = btn.getAttribute('data-lb-letter') || '';
                lb.startLetter = (lb.startLetter === picked && picked !== '') ? '' : picked;
                if (lb.startLetter && lb.sortKey.indexOf('alpha_') !== 0) {
                    lb.sortKey = 'alpha_asc';
                }
                fetchLibraryBrowserPage(true);
            });
        });

        var moreBtn = rowsScope.querySelector('#bfx-lb-more-btn');
        if (moreBtn) {
            moreBtn.addEventListener('click', function () {
                fetchLibraryBrowserPage(false);
            });
        }
        connectLibraryBrowserInfiniteScroll();
    }

    function buildBrowseCatalogBtnHtml(scopeKey, title, parentId, itemTypes, totalCount, isFooter) {
        var countLabel = totalCount > 0 ? ('All ' + totalCount + ' ') : 'Full ';
        var label = isFooter
            ? ('Browse ' + countLabel + 'Titles with Sort & Filter')
            : ('Browse All' + (totalCount > 0 ? (' (' + totalCount + ')') : '') + ' · Sort & Filter');
        return '<button type="button" class="' + (isFooter ? 'streamflix-btn-primary bfx-browse-all-footer-btn' : 'streamflix-ghost-btn bfx-browse-all-hdr-btn') + '"'
            + ' data-open-lib-browser="1"'
            + ' data-lb-scope="' + escapeHtml(scopeKey) + '"'
            + ' data-lb-title="' + escapeHtml(title) + '"'
            + ' data-lb-parent="' + escapeHtml(parentId || '') + '"'
            + ' data-lb-types="' + escapeHtml(itemTypes || 'Movie,Series') + '">'
            + icon('sliders') + '<span>' + escapeHtml(label) + '</span>'
            + '</button>';
    }

    function ensureHotTabExtraLoaded() {
        var auth = getJellyfinAuthContext();
        if (!auth || !auth.userId || !auth.token) {
            return;
        }
        var cacheKey = normalizeGuid(auth.userId) + ':' + ((state.activeProfile && state.activeProfile.id) || '');
        if (!state.hotTabExtra) {
            state.hotTabExtra = { loading: false, loadedForUser: '', upcomingEpisodes: [], seerrComingSoon: [] };
        }
        if (state.hotTabExtra.loading || state.hotTabExtra.loadedForUser === cacheKey) {
            return;
        }
        state.hotTabExtra.loading = true;
        var uid = encodeURIComponent(auth.userId);
        var pUpcoming = apiFetch('/Shows/Upcoming?userId=' + uid + '&Limit=18&Fields=Overview,PrimaryImageAspectRatio')
            .then(function (r) { return (r && Array.isArray(r.Items)) ? r.Items : []; })
            .catch(function () { return []; });

        var seerrOk = isCurrentProfileSeerrAllowed();
        var pid = (state.activeProfile && state.activeProfile.id) || '';
        var pSeerrReqs = seerrOk
            ? apiFetch('/StreamFlix/Seerr/Requests?profileId=' + encodeURIComponent(pid))
                .then(function (r) { return (r && Array.isArray(r.requests)) ? r.requests : []; })
                .catch(function () { return []; })
            : Promise.resolve([]);

        Promise.all([pUpcoming, pSeerrReqs]).then(function (arr) {
            var kFilter = typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode : function (x) { return x || []; };
            state.hotTabExtra.upcomingEpisodes = kFilter(arr[0] || []);
            state.hotTabExtra.seerrComingSoon = (arr[1] || []).filter(function (req) {
                var st = Number(req && req.mediaStatus) || 0;
                return req && req.tmdbId && req.title && st !== 5 && st !== 6 && !req.jellyfinMediaId;
            }).slice(0, 18);
            state.hotTabExtra.loading = false;
            state.hotTabExtra.loadedForUser = cacheKey;
            if (document.getElementById('streamflix-cinema-hub') && state.activeCategory === 'hot') {
                renderCinemaHubContents();
            }
        }).catch(function () {
            state.hotTabExtra.loading = false;
            state.hotTabExtra.loadedForUser = cacheKey;
        });
    }

    function buildUpcomingEpisodeWideCardHtml(ep) {
        var backdropUrl = getItemBackdropUrl(ep, 640);
        var title = ep.SeriesName || ep.Name || 'Upcoming Episode';
        var airLabel = '';
        if (ep.PremiereDate) {
            var ms = Date.parse(ep.PremiereDate);
            if (!isNaN(ms)) {
                try {
                    airLabel = 'Airs ' + new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                } catch (eD) {}
            }
        }
        var epCode = 'S' + (ep.ParentIndexNumber || 1) + ':E' + (ep.IndexNumber || 1);
        var sub = [airLabel, epCode, ep.Name].filter(Boolean).join(' · ');
        return ''
            + '<div class="streamflix-wide-card" data-item-id="' + escapeHtml(ep.SeriesId || ep.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml(title + ' ' + sub) + '">'
            + '  <div class="streamflix-wide-img-wrap">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(title) + '</div>'
            + '    <img class="streamflix-wide-img" loading="lazy" src="' + escapeHtml(backdropUrl) + '" alt="" data-bfx-img="fade" />'
            + '    <div class="streamflix-wide-scrim"></div>'
            + (airLabel ? '    <span class="streamflix-card-flag" style="top:10px;left:10px;">' + escapeHtml(airLabel) + '</span>' : '')
            + '    <div class="streamflix-wide-caption">'
            + '      <div class="streamflix-wide-title">' + escapeHtml(title) + '</div>'
            + '      <div class="streamflix-wide-sub">' + escapeHtml(sub) + '</div>'
            + '    </div>'
            + '  </div>'
            + '</div>';
    }

    function renderCinemaHubContents() {
        var hub = document.getElementById('streamflix-cinema-hub');
        if (!hub) {
            return;
        }

        var d = state.hubData;
        var profileName = (state.activeProfile && state.activeProfile.name) || 'You';
        var cat = state.activeCategory || 'all';
        var bf = (!state.searchQuery && state.browseFilter) ? state.browseFilter : null;
        var lb = (!state.searchQuery && !bf && state.libraryBrowser && state.libraryBrowser.active) ? state.libraryBrowser : null;
        if (!lb) {
            disconnectLibraryBrowserObserver();
        }

        document.body.classList.toggle('streamflix-hub-filtered', Boolean(state.searchQuery) || Boolean(bf) || Boolean(lb) || cat !== 'all');

        var pills = getConfiguredNavPills(d);
        if (cat.indexOf('lib:') === 0 && !pills.some(function (p) { return p.id === cat; })) {
            var activeLibView = findLibraryViewById(cat.slice(4));
            if (activeLibView) {
                pills.push({ id: cat, label: activeLibView.Name || 'Library', view: activeLibView, hide: false });
            } else {
                cat = 'all';
                state.activeCategory = 'all';
            }
        }

        var pillsHtml = pills.filter(function (p) { return !p.hide || cat === p.id; }).map(function (p) {
            var isActive = !state.searchQuery && !bf && cat === p.id;
            return '<button type="button" class="streamflix-pill' + (isActive ? ' active' : '') + '" data-cat-id="' + escapeHtml(p.id) + '"' + (isActive ? ' aria-current="page"' : '') + '>' + escapeHtml(p.label) + '</button>';
        }).join('');

        var canSurprise = (d.allMovies.length + d.allSeries.length) >= 2;
        var searchPlaceholder = isCurrentProfileSeerrAllowed() ? 'Titles, genres, or request…' : 'Titles, genres…';
        var showClearBtn = Boolean(state.searchQuery || state.mobileSearchOpen);
        var subnavHtml = ''
            + '<div class="streamflix-subnav' + ((state.mobileSearchOpen || state.searchQuery) ? ' is-search-open' : '') + '">'
            + '  <nav class="streamflix-FilterPills" aria-label="Browse">' + pillsHtml + '</nav>'
            + '  <div class="streamflix-subnav-right">'
            + (canSurprise
                ? '    <button type="button" id="streamflix-surprise-btn" class="streamflix-surprise-btn" title="Surprise Me" aria-label="Surprise Me">' + icon('shuffle') + '<span>Surprise Me</span></button>'
                : '')
            + '    <div class="streamflix-search-box' + (state.searchQuery ? ' has-value' : '') + '">'
            + '      <span class="streamflix-search-icon">' + icon('search') + '</span>'
            + '      <input type="search" id="streamflix-live-search-input" class="streamflix-search-input" placeholder="' + escapeHtml(searchPlaceholder) + '" autocomplete="off" spellcheck="false" aria-label="Search" value="' + escapeHtml(state.searchQuery) + '" />'
            + (showClearBtn
                ? '      <button type="button" id="streamflix-search-clear-btn" class="streamflix-search-clear" title="Close search" aria-label="Close search">' + icon('close') + '</button>'
                : '      <kbd class="streamflix-search-kbd" aria-hidden="true">/</kbd>')
            + '    </div>'
            + '  </div>'
            + '</div>';

        var activeLibForCat = cat.indexOf('lib:') === 0 ? findLibraryViewById(cat.slice(4)) : null;
        var libCatEntry = activeLibForCat ? ensureLibraryCategoryLoaded(activeLibForCat) : null;

        var activeHeroItems = getActiveHeroItems();
        var showHero = !state.searchQuery && !bf && !lb && activeHeroItems.length > 0;
        var heroHtml = '<div id="streamflix-hero-billboard" style="' + (showHero ? '' : 'display:none !important;') + '"></div>';
        var top10Cards = function () {
            return d.top10Items.map(function (it, idx) { return buildTop10CardHtml(it, idx + 1); }).join('');
        };

        var kidsWorldStripHtml = (!state.searchQuery && !bf && !lb && cat === 'all' && typeof buildKidsWorldStripHtml === 'function')
            ? buildKidsWorldStripHtml(d.allMovies.concat(d.allSeries))
            : '';

        var totalMoviesCount = Math.max(d.totalMoviesCount || 0, d.allMovies.length);
        var totalSeriesCount = Math.max(d.totalSeriesCount || 0, d.allSeries.length);
        var totalColsCount = Math.max(d.totalCollectionsCount || 0, d.collectionsItems.length);

        var rowsHtml = '';
        if (state.searchQuery && (Array.isArray(state.searchResults) || Array.isArray(state.seerrSearchResults) || state.seerrSearchLoading)) {
            rowsHtml += buildSearchRowsHtml();
        } else if (lb) {
            rowsHtml += buildLibraryBrowserHtml(lb);
        } else if (bf) {
            var bfKicker = bf.kind === 'genre'
                ? 'Genre'
                : (bf.role === 'Director' ? 'Directed by' : 'Featuring');
            rowsHtml += ''
                + '<section class="streamflix-row streamflix-row-grid streamflix-filter-view" data-row-id="browse-filter">'
                + '  <div class="streamflix-filter-banner">'
                + '    <div class="streamflix-filter-banner-copy">'
                + '      <span class="streamflix-filter-kicker">' + escapeHtml(bfKicker) + '</span>'
                + '      <h2 class="streamflix-row-title">' + escapeHtml(bf.name) + (!bf.loading ? '<span class="streamflix-row-count">' + bf.items.length + '</span>' : '') + '</h2>'
                + '    </div>'
                + '    <button type="button" class="streamflix-ghost-btn streamflix-filter-clear-btn" id="streamflix-clear-browse-filter">' + icon('chevronLeft') + '<span>Back to Browse</span></button>'
                + '  </div>'
                + (bf.loading
                    ? '  <div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Finding titles…</span></div>'
                    : (bf.items.length > 0
                        ? '  <div class="streamflix-grid">' + bf.items.map(buildPosterCardHtml).join('') + '</div>'
                        : buildEmptyStateHtml('film', 'No titles found for “' + bf.name + '”', 'Try another genre, cast member, or category.')))
                + '</section>';
        } else if (cat.indexOf('lib:') === 0 && activeLibForCat) {
            if (!libCatEntry || libCatEntry.loading) {
                rowsHtml += '<div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Loading ' + escapeHtml(activeLibForCat.Name || 'library') + '…</span></div>';
            } else if (libCatEntry.items.length === 0) {
                rowsHtml += buildEmptyStateHtml('film', 'Nothing in ' + (activeLibForCat.Name || 'this library') + ' yet', 'Titles added to this Jellyfin library will appear here automatically.');
            } else {
                var libTitle = activeLibForCat.Name || 'Library';
                var libTotal = Math.max(libCatEntry.totalCount || 0, libCatEntry.recentItems.length);
                if (libCatEntry.recentItems.length > 0) {
                    rowsHtml += buildRowHtml('lib-recent-' + activeLibForCat.Id, rowTitle('Recently Added in ' + libTitle), libCatEntry.recentItems.slice(0, 20).map(buildPosterCardHtml).join(''));
                }
                if (libCatEntry.topRatedItems.length >= 4) {
                    rowsHtml += buildRowHtml('lib-rated-' + activeLibForCat.Id, rowTitle('Top Rated in ' + libTitle), libCatEntry.topRatedItems.map(buildPosterCardHtml).join(''));
                }
                rowsHtml += buildGenreCollectionRowsHtml(libCatEntry.items);
                var libHdrBtn = buildBrowseCatalogBtnHtml('lib:' + activeLibForCat.Id, libTitle, activeLibForCat.Id, libCatEntry.itemTypes, libTotal, false);
                var libFooter = libTotal > libCatEntry.recentItems.length
                    ? ('<div class="bfx-grid-more-banner"><span>Showing the ' + libCatEntry.recentItems.length + ' most recently added of <strong>' + libTotal + '</strong> titles.</span>'
                        + buildBrowseCatalogBtnHtml('lib:' + activeLibForCat.Id, libTitle, activeLibForCat.Id, libCatEntry.itemTypes, libTotal, true) + '</div>')
                    : '';
                rowsHtml += buildGridSectionHtml('lib-all-' + activeLibForCat.Id, rowTitle('All ' + libTitle, libTotal), libCatEntry.recentItems, {
                    actionHtml: libHdrBtn,
                    footerHtml: libFooter
                });
            }
        } else if (cat === 'movies') {
            if (d.recentMovies.length > 0) {
                rowsHtml += buildRowHtml('movies-recent', rowTitle('New on ' + getBrandName()), d.recentMovies.map(buildPosterCardHtml).join(''));
            }
            rowsHtml += smartRowsHtml(['smart-acclaimed-movies', 'smart-short', 'smart-decade', 'smart-family']);
            rowsHtml += buildGenreCollectionRowsHtml(d.allMovies);
            if (d.allMovies.length > 0) {
                var movHdrBtn = buildBrowseCatalogBtnHtml('movies', 'All Movies', '', 'Movie', totalMoviesCount, false);
                var movFooter = totalMoviesCount > d.allMovies.length
                    ? ('<div class="bfx-grid-more-banner"><span>Showing the ' + d.allMovies.length + ' most recently added of <strong>' + totalMoviesCount + '</strong> movies.</span>'
                        + buildBrowseCatalogBtnHtml('movies', 'All Movies', '', 'Movie', totalMoviesCount, true) + '</div>')
                    : '';
                rowsHtml += buildGridSectionHtml('movies-all', rowTitle('All Movies', totalMoviesCount), d.allMovies, {
                    actionHtml: movHdrBtn,
                    footerHtml: movFooter
                });
            }
        } else if (cat === 'series') {
            if (d.nextUpItems.length > 0) {
                rowsHtml += buildRowHtml('nextup', rowTitle('Next Up'), d.nextUpItems.map(buildWideCardHtml).join(''), { className: 'streamflix-row-wide' });
            }
            if (d.recentSeries.length > 0) {
                rowsHtml += buildRowHtml('series-recent', rowTitle('New Episodes & Series'), d.recentSeries.map(buildPosterCardHtml).join(''));
            }
            rowsHtml += smartRowsHtml(['smart-binge', 'smart-acclaimed-shows']);
            rowsHtml += buildGenreCollectionRowsHtml(d.allSeries);
            if (d.allSeries.length > 0) {
                var serHdrBtn = buildBrowseCatalogBtnHtml('series', 'All Shows', '', 'Series', totalSeriesCount, false);
                var serFooter = totalSeriesCount > d.allSeries.length
                    ? ('<div class="bfx-grid-more-banner"><span>Showing the ' + d.allSeries.length + ' most recently added of <strong>' + totalSeriesCount + '</strong> shows.</span>'
                        + buildBrowseCatalogBtnHtml('series', 'All Shows', '', 'Series', totalSeriesCount, true) + '</div>')
                    : '';
                rowsHtml += buildGridSectionHtml('series-all', rowTitle('All Shows', totalSeriesCount), d.allSeries, {
                    actionHtml: serHdrBtn,
                    footerHtml: serFooter
                });
            }
        } else if (cat === 'collections') {
            rowsHtml += smartRowsHtml(['smart-acclaimed', 'smart-gems', 'smart-binge', 'smart-short', 'smart-decade', 'smart-family']);
            if (d.collectionsItems.length > 0) {
                var colHdrBtn = buildBrowseCatalogBtnHtml('collections', 'Collections', '', 'BoxSet', totalColsCount, false);
                rowsHtml += buildGridSectionHtml('collections-boxsets', rowTitle('Collections', totalColsCount), d.collectionsItems, {
                    actionHtml: colHdrBtn
                });
            }
            rowsHtml += buildGenreCollectionRowsHtml(d.allMovies.concat(d.allSeries));
        } else if (cat === 'mylist') {
            if (d.favoriteItems.length > 0) {
                rowsHtml += buildGridSectionHtml('mylist-grid', rowTitle('My List', d.favoriteItems.length), d.favoriteItems);
            }
        } else if (cat === 'top10') {
            if (d.top10Items.length > 0) {
                rowsHtml += buildRowHtml('top10', rowTitle(getTop10RowTitle()), top10Cards(), { className: 'streamflix-row-top10' });
                rowsHtml += buildGridSectionHtml('top10-grid', rowTitle('Top 10 Lineup', d.top10Items.length), d.top10Items);
            }
        } else if (cat === 'hot') {
            ensureHotTabExtraLoaded();
            var hotEx = state.hotTabExtra || { upcomingEpisodes: [], seerrComingSoon: [] };
            var sevenDaysAgo = Date.now() - (7 * 24 * 3600 * 1000);
            var addedThisWeek = dedupeMediaItems([].concat(d.recentMovies || [], d.recentSeries || [])).filter(function (it) {
                var c = it && it.DateCreated ? Date.parse(it.DateCreated) : 0;
                return c >= sevenDaysAgo;
            }).slice(0, 20);
            if (d.top10Items.length > 0) {
                rowsHtml += buildRowHtml('top10', rowTitle(getTop10RowTitle()), top10Cards(), { className: 'streamflix-row-top10' });
            }
            if (Array.isArray(hotEx.upcomingEpisodes) && hotEx.upcomingEpisodes.length > 0) {
                rowsHtml += buildRowHtml('hot-upcoming', rowTitle('Upcoming Episodes', hotEx.upcomingEpisodes.length), hotEx.upcomingEpisodes.map(buildUpcomingEpisodeWideCardHtml).join(''), { className: 'streamflix-row-wide' });
            }
            if (Array.isArray(hotEx.seerrComingSoon) && hotEx.seerrComingSoon.length > 0) {
                rowsHtml += buildRowHtml('hot-seerr-soon', rowTitle('Coming Soon via Seerr', hotEx.seerrComingSoon.length), hotEx.seerrComingSoon.map(buildSeerrCardHtml).join(''));
            }
            if (addedThisWeek.length >= 3) {
                rowsHtml += buildRowHtml('hot-week', rowTitle('Worth the Wait · Added This Week', addedThisWeek.length), addedThisWeek.map(buildPosterCardHtml).join(''));
            }
            if (d.recentMovies.length > 0) {
                rowsHtml += buildRowHtml('hot-movies', rowTitle('New Movies on ' + getBrandName()), d.recentMovies.map(buildPosterCardHtml).join(''));
            }
            if (d.recentSeries.length > 0) {
                rowsHtml += buildRowHtml('hot-series', rowTitle('New Episodes & Series'), d.recentSeries.map(buildPosterCardHtml).join(''));
            }
            rowsHtml += smartRowsHtml(['smart-acclaimed', 'smart-gems']);
        } else if (typeof isKidsProfileActive === 'function' && isKidsProfileActive() && state.kidsWorld && state.kidsWorld !== 'all' && typeof filterItemsByKidsWorld === 'function') {
            var kwMeta = typeof getKidsWorldMeta === 'function' ? getKidsWorldMeta(state.kidsWorld) : { emoji: '🌟', label: 'Kids' };
            var kwPool = dedupeMediaItems(d.allMovies.concat(d.allSeries));
            var kwItems = filterItemsByKidsWorld(kwPool, state.kidsWorld);
            if (kwItems.length > 0) {
                rowsHtml += buildGridSectionHtml('kids-world-' + state.kidsWorld, rowTitle(kwMeta.emoji + ' ' + kwMeta.label, kwItems.length), kwItems);
            } else {
                rowsHtml += buildEmptyStateHtml('film', 'No titles in ' + kwMeta.label + ' yet', 'Tap another Kids World bubble above to keep exploring.');
            }
        } else {
            if (d.resumeItems.length > 0) {
                rowsHtml += buildRowHtml('resume', rowTitle('Continue Watching for ' + profileName), d.resumeItems.map(function (it) { return buildWideCardHtml(it, { removable: true }); }).join(''), { className: 'streamflix-row-wide' });
            }
            if (d.nextUpItems.length > 0) {
                rowsHtml += buildRowHtml('nextup', rowTitle('Next Up'), d.nextUpItems.map(buildWideCardHtml).join(''), { className: 'streamflix-row-wide', link: 'series' });
            }
            var pr = getPersonalRows() || { topPicks: [], because: [], watchAgain: [] };
            var becauseRow = function (b, idx) {
                return b ? buildRowHtml('because-' + idx, 'Because you watched <span class="bfx-row-em">' + escapeHtml(b.seed.name) + '</span>', b.items.map(buildPosterCardHtml).join(''), { className: 'streamflix-row-personal' }) : '';
            };
            if (pr.topPicks.length > 0) {
                rowsHtml += buildRowHtml('toppicks', 'Top Picks for ' + escapeHtml(profileName), pr.topPicks.map(buildPosterCardHtml).join(''), { className: 'streamflix-row-personal' });
            }
            rowsHtml += becauseRow(pr.because[0], 0);
            if (d.top10Items.length > 0) {
                rowsHtml += buildRowHtml('top10', rowTitle(getTop10RowTitle()), top10Cards(), { className: 'streamflix-row-top10', link: 'top10' });
            }
            if (d.favoriteItems.length > 0) {
                rowsHtml += buildRowHtml('mylist', rowTitle('My List'), d.favoriteItems.map(buildPosterCardHtml).join(''), { link: 'mylist' });
            }
            rowsHtml += smartRowsHtml(['smart-acclaimed']);
            if (d.recentMovies.length > 0) {
                rowsHtml += buildRowHtml('movies', rowTitle('New Movies'), d.recentMovies.map(buildPosterCardHtml).join(''), { link: 'movies' });
            }
            rowsHtml += becauseRow(pr.because[1], 1);
            if (d.recentSeries.length > 0) {
                rowsHtml += buildRowHtml('series', rowTitle('New Shows'), d.recentSeries.map(buildPosterCardHtml).join(''), { link: 'series' });
            }
            rowsHtml += smartRowsHtml(['smart-gems']);
            if (d.collectionsItems.length > 0) {
                rowsHtml += buildRowHtml('collections', rowTitle('Collections'), d.collectionsItems.map(buildPosterCardHtml).join(''), { link: 'collections' });
            }
            if (pr.watchAgain.length > 0) {
                rowsHtml += buildRowHtml('watchagain', rowTitle('Watch It Again'), pr.watchAgain.map(buildPosterCardHtml).join(''));
            }
        }

        if (!rowsHtml && d.loaded) {
            rowsHtml = cat === 'mylist'
                ? buildEmptyStateHtml('plus', 'Your list is empty', 'Add movies and shows with the + button and they\'ll show up here.')
                : buildEmptyStateHtml('film', 'Nothing here yet', 'Titles will appear as soon as they are added to your libraries.');
        }
        if (kidsWorldStripHtml) {
            rowsHtml = kidsWorldStripHtml + rowsHtml;
        }

        var bindCategoryPills = function (scopeNode) {
            Array.prototype.forEach.call(scopeNode.querySelectorAll('[data-cat-id]'), function (btn) {
                btn.addEventListener('click', function () {
                    cancelPendingSearch();
                    disconnectLibraryBrowserObserver();
                    var pickedCat = btn.getAttribute('data-cat-id') || 'all';
                    var isPhoneMode = Boolean(document.body && document.body.classList.contains('bfx-phone-mode'));
                    if (isPhoneMode && pickedCat !== 'all' && !state.searchQuery && !state.browseFilter && !state.libraryBrowser && state.activeCategory === pickedCat) {
                        pickedCat = 'all';
                    }
                    state.activeCategory = pickedCat;
                    state.kidsWorld = 'all';
                    state.heroIndex = 0;
                    state.mobileSearchOpen = false;
                    state.searchQuery = '';
                    state.searchResults = null;
                    state.seerrSearchResults = null;
                    state.browseFilter = null;
                    state.libraryBrowser = null;
                    renderCinemaHubContents();
                });
            });
        };

        var bindRowsInteractive = function (rowsScope) {
            Array.prototype.forEach.call(rowsScope.querySelectorAll('[data-cat-link]'), function (btn) {
                btn.addEventListener('click', function () {
                    cancelPendingSearch();
                    disconnectLibraryBrowserObserver();
                    state.activeCategory = btn.getAttribute('data-cat-link') || 'all';
                    state.heroIndex = 0;
                    state.browseFilter = null;
                    state.libraryBrowser = null;
                    renderCinemaHubContents();
                    try { hub.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) {}
                });
            });
            Array.prototype.forEach.call(rowsScope.querySelectorAll('[data-open-lib-browser="1"]'), function (btn) {
                btn.addEventListener('click', function () {
                    openLibraryBrowser({
                        scopeKey: btn.getAttribute('data-lb-scope') || 'movies',
                        title: btn.getAttribute('data-lb-title') || 'Library',
                        parentId: btn.getAttribute('data-lb-parent') || '',
                        itemTypes: btn.getAttribute('data-lb-types') || 'Movie,Series'
                    });
                });
            });
            var clearBrowseFilterBtn = rowsScope.querySelector('#streamflix-clear-browse-filter');
            if (clearBrowseFilterBtn) {
                clearBrowseFilterBtn.addEventListener('click', function () {
                    state.browseFilter = null;
                    renderCinemaHubContents();
                });
            }
            if (state.libraryBrowser && state.libraryBrowser.active) {
                bindLibraryBrowserInteractive(rowsScope);
            }
            if (typeof bindKidsWorldStrip === 'function') {
                bindKidsWorldStrip(rowsScope);
            }
            bindInteractiveCardsInContainer(rowsScope, null, null);
            bindSeerrCardsInContainer(rowsScope);
        };

        var bindClearSearchBtn = function () {
            var clearSearchBtn = document.getElementById('streamflix-search-clear-btn');
            if (clearSearchBtn && !clearSearchBtn.__bfxBound) {
                clearSearchBtn.__bfxBound = true;
                clearSearchBtn.addEventListener('click', function () {
                    cancelPendingSearch();
                    state.mobileSearchOpen = false;
                    state.searchQuery = '';
                    state.searchResults = null;
                    state.seerrSearchResults = null;
                    if (document.body) {
                        document.body.classList.remove('bfx-mobile-search-focused');
                    }
                    var liveIn = document.getElementById('streamflix-live-search-input');
                    if (liveIn) {
                        liveIn.value = '';
                        try { liveIn.blur(); } catch (e) {}
                    }
                    renderCinemaHubContents();
                });
            }
        };

        // In-place update whenever search is active or focused so IME composition, mobile keyboard,
        // caret position, and Search grid scroll position are never disrupted!
        var existingSearchInput = document.getElementById('streamflix-live-search-input');
        var existingRowsEl = hub.querySelector('.streamflix-rows');
        var existingPillsNav = hub.querySelector('.streamflix-FilterPills');
        if (existingSearchInput && existingRowsEl && existingPillsNav && hub.contains(existingSearchInput)
            && (document.activeElement === existingSearchInput || Boolean(state.searchQuery) || state.mobileSearchOpen)) {
            if (document.activeElement !== existingSearchInput && existingSearchInput.value !== (state.searchQuery || '')) {
                existingSearchInput.value = state.searchQuery || '';
            }
            existingPillsNav.innerHTML = pillsHtml;
            bindCategoryPills(existingPillsNav);
            existingSearchInput.placeholder = searchPlaceholder;
            var sBox = existingSearchInput.closest ? existingSearchInput.closest('.streamflix-search-box') : null;
            if (sBox) {
                sBox.classList.toggle('has-value', Boolean(state.searchQuery));
                var oldClr = sBox.querySelector('#streamflix-search-clear-btn');
                var oldKbd = sBox.querySelector('.streamflix-search-kbd');
                if (showClearBtn && !oldClr) {
                    if (oldKbd && oldKbd.parentNode) { oldKbd.parentNode.removeChild(oldKbd); }
                    existingSearchInput.insertAdjacentHTML('afterend', '<button type="button" id="streamflix-search-clear-btn" class="streamflix-search-clear" title="Close search" aria-label="Close search">' + icon('close') + '</button>');
                    bindClearSearchBtn();
                } else if (!showClearBtn && !oldKbd) {
                    if (oldClr && oldClr.parentNode) { oldClr.parentNode.removeChild(oldClr); }
                    existingSearchInput.insertAdjacentHTML('afterend', '<kbd class="streamflix-search-kbd" aria-hidden="true">/</kbd>');
                }
            }
            var curHeroEl = document.getElementById('streamflix-hero-billboard');
            if (curHeroEl) {
                curHeroEl.style.display = showHero ? 'flex' : 'none';
            } else if (showHero) {
                existingRowsEl.insertAdjacentHTML('beforebegin', '<div id="streamflix-hero-billboard"></div>');
            }
            state.heroCatKey = showHero ? cat : null;
            if (!showHero) {
                hub.style.removeProperty('--bfx-ambient');
            }
            hub.classList.toggle('streamflix-has-hero', showHero);
            document.body.classList.add('streamflix-hub-active');
            syncHeroBleed(hub);
            if (showHero) {
                renderHeroSlide();
                if (!state.heroTimer) {
                    restartHeroTimer();
                }
            }
            existingRowsEl.innerHTML = rowsHtml;
            bindRowsInteractive(existingRowsEl);
            syncMobileDockState();
            return;
        }

        var prevHero = document.getElementById('streamflix-hero-billboard');
        var keepHero = showHero && prevHero && prevHero.parentNode === hub && state.heroCatKey === cat
            && Boolean(prevHero.querySelector('.streamflix-hero-bg-stack'));
        if (keepHero) {
            // Swap everything around the billboard so the hero doesn't flash on re-render
            Array.prototype.slice.call(hub.children).forEach(function (child) {
                if (child !== prevHero) {
                    hub.removeChild(child);
                }
            });
            prevHero.insertAdjacentHTML('beforebegin', subnavHtml);
            prevHero.insertAdjacentHTML('afterend', '<div class="streamflix-rows">' + rowsHtml + '</div>');
        } else {
            hub.innerHTML = subnavHtml + heroHtml + '<div class="streamflix-rows">' + rowsHtml + '</div>';
        }
        state.heroCatKey = showHero ? cat : null;
        if (!showHero) {
            hub.style.removeProperty('--bfx-ambient');
        }
        hub.classList.toggle('streamflix-has-hero', showHero);
        // The StreamFlix hub replaces Jellyfin's stock home sections (My Media, Continue Watching, Recently Added…)
        document.body.classList.add('streamflix-hub-active');
        syncHeroBleed(hub);
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () { syncHeroBleed(hub); });
        }

        if (!hub.classList.contains('streamflix-hub-ready')) {
            hub.classList.add('streamflix-hub-ready');
        }

        if (showHero) {
            renderHeroSlide();
            if (!keepHero || !state.heroTimer) {
                restartHeroTimer();
            }
        }

        bindCategoryPills(hub);

        var surpriseBtn = document.getElementById('streamflix-surprise-btn');
        if (surpriseBtn) {
            surpriseBtn.addEventListener('click', function () {
                triggerSurpriseMe();
            });
        }

        // Bind Live Search Input & Clear Button (with compact tap-to-expand support on phones)
        var searchInput = document.getElementById('streamflix-live-search-input');
        var searchBoxEl = hub.querySelector('.streamflix-search-box');
        var subnavEl = hub.querySelector('.streamflix-subnav');
        if (searchBoxEl && searchInput) {
            searchBoxEl.addEventListener('click', function (ev) {
                if (ev.target && ev.target.closest && ev.target.closest('#streamflix-search-clear-btn')) {
                    return;
                }
                if (subnavEl) {
                    subnavEl.classList.add('is-search-open');
                }
                if (document.activeElement !== searchInput) {
                    try { searchInput.focus(); } catch (e) {}
                }
            });
            searchInput.addEventListener('focus', function () {
                if (subnavEl) {
                    subnavEl.classList.add('is-search-open');
                }
                if (document.body) {
                    document.body.classList.add('bfx-mobile-search-focused');
                }
                syncMobileDockState();
            });
            searchInput.addEventListener('blur', function () {
                if (document.body) {
                    document.body.classList.remove('bfx-mobile-search-focused');
                }
                if (subnavEl && !searchInput.value && !state.mobileSearchOpen) {
                    subnavEl.classList.remove('is-search-open');
                }
                syncMobileDockState();
            });
        }
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                state.searchQuery = searchInput.value;
                if (state.searchDebounce) {
                    clearTimeout(state.searchDebounce);
                    state.searchDebounce = null;
                }
                if (typeof previewInstantLocalSearch === 'function') {
                    previewInstantLocalSearch(state.searchQuery);
                }
                if ((state.searchQuery || '').trim()) {
                    state.searchDebounce = setTimeout(function () {
                        runLiveSearch(state.searchQuery);
                    }, 220);
                }
            });
            searchInput.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape' && (state.searchQuery || state.mobileSearchOpen)) {
                    ev.preventDefault();
                    cancelPendingSearch();
                    state.mobileSearchOpen = false;
                    state.searchQuery = '';
                    state.searchResults = null;
                    state.seerrSearchResults = null;
                    searchInput.value = '';
                    try { searchInput.blur(); } catch (eEsc) {}
                    renderCinemaHubContents();
                }
            });
            if (state.searchQuery && !document.querySelector('.streamflix-modal-backdrop') && !isGateOpen()) {
                searchInput.focus();
                try {
                    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
                } catch (e) {}
            }
        }

        bindClearSearchBtn();
        var newRowsEl = hub.querySelector('.streamflix-rows') || hub;
        bindRowsInteractive(newRowsEl);
        syncMobileDockState();
    }

    function stepHeroSlide(delta) {
        var slides = getActiveHeroItems();
        if (!slides || slides.length <= 1) {
            return;
        }
        state.heroIndex = (state.heroIndex + delta + slides.length * 10) % slides.length;
        renderHeroSlide();
        restartHeroTimer();
    }

    function renderHeroSlide() {
        var hero = document.getElementById('streamflix-hero-billboard');
        var heroItems = getActiveHeroItems();
        if (!hero || !heroItems.length) {
            if (hero) {
                hero.style.display = 'none';
            }
            return;
        }
        hero.style.display = 'flex';
        hero.style.backgroundImage = 'none';

        var prevFocusKey = '';
        var curActive = document.activeElement;
        if (curActive && hero.contains(curActive)) {
            if (curActive.id === 'streamflix-hero-play-btn') {
                prevFocusKey = 'play';
            } else if (curActive.id === 'streamflix-hero-info-btn') {
                prevFocusKey = 'info';
            } else if (curActive.id === 'streamflix-hero-fav-btn') {
                prevFocusKey = 'fav';
            } else if (curActive.classList && curActive.classList.contains('prev')) {
                prevFocusKey = 'prev';
            } else if (curActive.classList && curActive.classList.contains('next')) {
                prevFocusKey = 'next';
            } else if (curActive.classList && curActive.classList.contains('streamflix-hero-dot')) {
                prevFocusKey = 'dot';
            }
        }

        // Persistent layers: background stack (crossfades), content slot and slide navigation
        var bgStack = hero.querySelector('.streamflix-hero-bg-stack');
        if (!bgStack) {
            hero.innerHTML = ''
                + '<div class="streamflix-hero-bg-stack" aria-hidden="true"></div>'
                + '<div class="streamflix-hero-content-slot"></div>'
                + '<div class="streamflix-hero-nav">'
                + '  <button type="button" class="streamflix-hero-arrow prev" aria-label="Previous featured title" title="Previous featured title">' + icon('chevronLeft') + '</button>'
                + '  <div class="streamflix-hero-dots"></div>'
                + '  <button type="button" class="streamflix-hero-arrow next" aria-label="Next featured title" title="Next featured title">' + icon('chevronRight') + '</button>'
                + '</div>';
            bgStack = hero.querySelector('.streamflix-hero-bg-stack');
            var prevBtn = hero.querySelector('.streamflix-hero-arrow.prev');
            var nextBtn = hero.querySelector('.streamflix-hero-arrow.next');
            if (prevBtn) {
                prevBtn.addEventListener('click', function () { stepHeroSlide(-1); });
            }
            if (nextBtn) {
                nextBtn.addEventListener('click', function () { stepHeroSlide(1); });
            }
            hero.addEventListener('mouseenter', function () { state.heroPaused = true; });
            hero.addEventListener('mouseleave', function () { state.heroPaused = false; });
            hero.addEventListener('focusin', function () { state.heroPaused = true; });
            hero.addEventListener('focusout', function (ev) {
                state.heroPaused = Boolean(ev && ev.relatedTarget && hero.contains(ev.relatedTarget));
            });
            // Touch swipe left/right on phones & tablets to flip hero slides
            var touchStartX = 0;
            var touchStartY = 0;
            var touchTracking = false;
            hero.addEventListener('touchstart', function (ev) {
                if (!ev.touches || ev.touches.length !== 1) {
                    touchTracking = false;
                    return;
                }
                if (ev.target && ev.target.closest && ev.target.closest('button, a, input')) {
                    touchTracking = false;
                    return;
                }
                touchStartX = ev.touches[0].clientX;
                touchStartY = ev.touches[0].clientY;
                touchTracking = true;
            }, { passive: true });
            hero.addEventListener('touchend', function (ev) {
                if (!touchTracking || !ev.changedTouches || !ev.changedTouches.length) {
                    return;
                }
                touchTracking = false;
                var dx = ev.changedTouches[0].clientX - touchStartX;
                var dy = ev.changedTouches[0].clientY - touchStartY;
                var slides = getActiveHeroItems();
                if (slides.length > 1 && Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    stepHeroSlide(dx < 0 ? 1 : -1);
                }
            }, { passive: true });
        }
        var slot = hero.querySelector('.streamflix-hero-content-slot');
        var navEl = hero.querySelector('.streamflix-hero-nav');
        var dotsEl = hero.querySelector('.streamflix-hero-dots');
        if (navEl) {
            navEl.style.display = heroItems.length > 1 ? 'flex' : 'none';
        }

        var slideIdx = state.heroIndex % heroItems.length;
        var item = heroItems[slideIdx];
        var backdropUrl = getItemBackdropUrl(item, 1920);
        var prevItemId = hero.getAttribute('data-hero-item');
        var itemChanged = prevItemId !== item.Id;
        hero.setAttribute('data-hero-item', item.Id);

        if (bgStack.getAttribute('data-src') !== backdropUrl) {
            bgStack.setAttribute('data-src', backdropUrl);
            var layer = document.createElement('div');
            layer.className = 'streamflix-hero-bg';
            var safeHeroBg = safeCssUrl(backdropUrl);
            if (safeHeroBg) {
                layer.style.backgroundImage = 'url("' + safeHeroBg + '")';
            }
            var reveal = function () {
                if (layer.getAttribute('data-shown') === '1' || bgStack.getAttribute('data-src') !== backdropUrl) {
                    return;
                }
                layer.setAttribute('data-shown', '1');
                bgStack.appendChild(layer);
                applyHeroAmbient(backdropUrl);
                void layer.offsetWidth;
                layer.classList.add('is-visible');
                var olds = bgStack.querySelectorAll('.streamflix-hero-bg');
                Array.prototype.forEach.call(olds, function (old) {
                    if (old !== layer) {
                        setTimeout(function () {
                            if (old.parentNode) {
                                old.parentNode.removeChild(old);
                            }
                        }, 1000);
                    }
                });
            };
            var pre = new Image();
            pre.onload = reveal;
            pre.onerror = reveal;
            pre.src = backdropUrl;
            setTimeout(reveal, 1500);
        }

        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var rating = item.OfficialRating ? String(item.OfficialRating) : '';
        var runtime = item.Type === 'Series' ? '' : formatRuntimeTicks(item.RunTimeTicks);
        var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3) : [];
        var community = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var isFav = item.UserData && item.UserData.IsFavorite;
        var hasResume = item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0;
        var resumePct = hasResume && item.RunTimeTicks ? Math.min(100, Math.max(2, Math.round(item.UserData.PlaybackPositionTicks / item.RunTimeTicks * 100))) : 0;
        var logoUrl = getItemLogoUrl(item, 800);
        var kicker = item.Type === 'Series' ? 'Series' : (item.Type === 'BoxSet' ? 'Collection' : 'Film');
        var heroRank = getTop10Rank(item && item.Id);
        var brandInitial = getBrandLogoText().charAt(0) || 'S';
        var slotSig = item.Id + ':' + (isFav ? 1 : 0) + ':' + heroRank + ':' + brandInitial + ':' + (item.UserData ? item.UserData.PlaybackPositionTicks || 0 : 0);
        var slotFresh = slot.getAttribute('data-sig') !== slotSig || !slot.firstChild;
        slot.setAttribute('data-sig', slotSig);

        var titleHtml = logoUrl
            ? '<h1 class="streamflix-hero-title streamflix-hero-title-has-logo">'
                + '<img class="streamflix-hero-logo" src="' + escapeHtml(logoUrl) + '" alt="" data-bfx-logo-fallback="hero" />'
                + '<span class="streamflix-hero-title-text">' + escapeHtml(item.Name) + '</span></h1>'
            : '<h1 class="streamflix-hero-title">' + escapeHtml(item.Name) + '</h1>';

        if (slotFresh) {
            slot.innerHTML = ''
                + '<div class="streamflix-hero-content' + (itemChanged ? ' streamflix-hero-swap' : '') + '">'
                + '  <div class="streamflix-hero-brand-row">'
                + '    <span class="streamflix-n-badge">' + escapeHtml(brandInitial) + '</span>'
                + '    <span class="streamflix-hero-series-tag">' + escapeHtml(kicker) + '</span>'
                + (heroRank
                    ? '<span class="streamflix-hero-top10-pill"><b>TOP 10</b><span>#' + heroRank + ' Today</span></span>'
                    : (isRecentlyAdded(item) ? '<span class="streamflix-hero-new">Recently added</span>' : ''))
                + '  </div>'
                + titleHtml
                + '  <div class="streamflix-hero-meta-row">'
                + (community ? '<span class="streamflix-hero-rating">' + icon('star') + escapeHtml(community) + '</span>' : '')
                + (year ? '<span>' + escapeHtml(year) + '</span>' : '')
                + (rating ? '<span class="streamflix-maturity-pill">' + escapeHtml(rating) + '</span>' : '')
                + (runtime ? '<span>' + escapeHtml(runtime.trim()) + '</span>' : '')
                + (genres.length ? '<span class="streamflix-hero-genres">' + genres.map(escapeHtml).join('<i></i>') + '</span>' : '')
                + '  </div>'
                + (item.Overview ? '<p class="streamflix-hero-overview">' + escapeHtml(item.Overview) + '</p>' : '')
                + (resumePct
                    ? '<div class="streamflix-hero-progress"><div class="streamflix-hero-progress-bar"><span style="width:' + resumePct + '%;"></span></div><span>' + escapeHtml(formatTimeLeft(item)) + '</span></div>'
                    : '')
                + '  <div class="streamflix-hero-actions">'
                + '    <button type="button" class="streamflix-hero-play" id="streamflix-hero-play-btn">' + iconLabel('play', hasResume ? 'Resume' : 'Play') + '</button>'
                + '    <button type="button" class="streamflix-hero-secondary" id="streamflix-hero-info-btn">' + iconLabel('info', 'More Info') + '</button>'
                + '    <button type="button" class="streamflix-hero-icon-btn' + (isFav ? ' active' : '') + '" id="streamflix-hero-fav-btn" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="' + (isFav ? 'Remove from My List' : 'Add to My List') + '">' + icon(isFav ? 'check' : 'plus') + '</button>'
                + '    <button type="button" class="streamflix-hero-icon-btn bfx-hero-mute-btn is-hidden" id="streamflix-hero-mute-btn" title="' + (state.heroPreviewMuted !== false ? 'Unmute preview' : 'Mute preview') + '" aria-label="' + (state.heroPreviewMuted !== false ? 'Unmute preview' : 'Mute preview') + '">' + icon(state.heroPreviewMuted !== false ? 'volumeOff' : 'volume') + '</button>'
                + '  </div>'
                + '</div>';
            hydrateCompleteImages(slot);
        }

        dotsEl.innerHTML = heroItems.length > 1
            ? heroItems.map(function (_, idx) {
                return '<button type="button" class="streamflix-hero-dot' + (idx === slideIdx ? ' active' : '') + (idx < slideIdx ? ' done' : '') + '" data-slide-idx="' + idx + '" aria-label="Show title ' + (idx + 1) + ' of ' + heroItems.length + '"><span class="streamflix-hero-dot-fill"></span></button>';
            }).join('')
            : '';

        if (slotFresh) {
            document.getElementById('streamflix-hero-play-btn').addEventListener('click', function () {
                navigateOrPlayItem(item);
            });
            document.getElementById('streamflix-hero-info-btn').addEventListener('click', function () {
                openHeroDetailModal(item);
            });
            document.getElementById('streamflix-hero-fav-btn').addEventListener('click', function () {
                toggleFavoriteItem(item, null);
                renderHeroSlide();
            });
            var muteHeroBtn = document.getElementById('streamflix-hero-mute-btn');
            if (muteHeroBtn) {
                muteHeroBtn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    state.heroPreviewMuted = !Boolean(state.heroPreviewMuted !== false);
                    var vidEl = hero.querySelector('video.bfx-hero-preview-video');
                    if (vidEl) {
                        vidEl.muted = Boolean(state.heroPreviewMuted);
                    }
                    muteHeroBtn.innerHTML = icon(state.heroPreviewMuted ? 'volumeOff' : 'volume');
                    muteHeroBtn.title = state.heroPreviewMuted ? 'Unmute preview' : 'Mute preview';
                    muteHeroBtn.setAttribute('aria-label', muteHeroBtn.title);
                });
            }
        }

        if (itemChanged) {
            scheduleHeroVideoPreview(item);
        }

        Array.prototype.forEach.call(dotsEl.querySelectorAll('.streamflix-hero-dot'), function (dot) {
            dot.addEventListener('click', function () {
                state.heroIndex = parseInt(dot.getAttribute('data-slide-idx'), 10) || 0;
                renderHeroSlide();
                restartHeroTimer();
            });
        });

        if (prevFocusKey) {
            var focusTarget = null;
            if (prevFocusKey === 'play') {
                focusTarget = document.getElementById('streamflix-hero-play-btn');
            } else if (prevFocusKey === 'info') {
                focusTarget = document.getElementById('streamflix-hero-info-btn');
            } else if (prevFocusKey === 'fav') {
                focusTarget = document.getElementById('streamflix-hero-fav-btn');
            } else if (prevFocusKey === 'prev') {
                focusTarget = hero.querySelector('.streamflix-hero-arrow.prev');
            } else if (prevFocusKey === 'next') {
                focusTarget = hero.querySelector('.streamflix-hero-arrow.next');
            } else if (prevFocusKey === 'dot') {
                focusTarget = dotsEl.querySelector('.streamflix-hero-dot.active') || dotsEl.querySelector('.streamflix-hero-dot');
            }
            if (focusTarget && document.activeElement !== focusTarget) {
                try { focusTarget.focus({ preventScroll: true }); } catch (eFoc) { try { focusTarget.focus(); } catch (e2) {} }
            }
        }
        paintHeroProgress();
    }

    var HERO_TICK_MS = 200;

    function paintHeroProgress() {
        var fill = document.querySelector('#streamflix-hero-billboard .streamflix-hero-dot.active .streamflix-hero-dot-fill');
        if (fill) {
            var intervalMs = getHeroIntervalMs();
            if (intervalMs <= 0) {
                fill.style.transform = 'scaleX(1)';
                return;
            }
            var frac = (state.heroElapsed || 0) / intervalMs;
            fill.style.transform = 'scaleX(' + Math.min(1, Math.max(0, frac)).toFixed(3) + ')';
        }
    }

    // Story-style hero timer: pauses on hover/focus, hidden tabs, open modals and search; honors admin rotation interval (0 = off).
    function restartHeroTimer() {
        if (state.heroTimer) {
            clearInterval(state.heroTimer);
            state.heroTimer = null;
        }
        state.heroElapsed = 0;
        var heroRoot = document.getElementById('streamflix-hero-billboard');
        var intervalMs = getHeroIntervalMs();
        if (heroRoot) {
            heroRoot.classList.toggle('is-static-rotation', intervalMs <= 0);
        }
        paintHeroProgress();
        if (intervalMs <= 0 || prefersReducedMotion()) {
            return;
        }
        state.heroTimer = setInterval(function () {
            var heroEl = document.getElementById('streamflix-hero-billboard');
            var curHero = getActiveHeroItems();
            var curInterval = getHeroIntervalMs();
            if (!heroEl || curInterval <= 0) {
                clearInterval(state.heroTimer);
                state.heroTimer = null;
                if (heroEl && curInterval <= 0) {
                    heroEl.classList.add('is-static-rotation');
                    paintHeroProgress();
                }
                return;
            }
            heroEl.classList.remove('is-static-rotation');
            var paused = heroHardPaused() || state.heroPaused || state.heroVideoActive || curHero.length <= 1;
            if (heroHardPaused() && state.heroVideoActive) {
                stopHeroVideoPreview();
            }
            heroEl.classList.toggle('is-paused', Boolean(paused));
            if (paused) {
                return;
            }
            state.heroElapsed = (state.heroElapsed || 0) + HERO_TICK_MS;
            if (state.heroElapsed >= curInterval) {
                state.heroElapsed = 0;
                state.heroIndex = (state.heroIndex + 1) % curHero.length;
                renderHeroSlide();
            }
            paintHeroProgress();
        }, HERO_TICK_MS);
    }

        // Let the hero billboard bleed up underneath Jellyfin's fixed header for an edge-to-edge look
    function syncHeroBleed(hub) {
        hub = hub || document.getElementById('streamflix-cinema-hub');
        if (!hub) {
            return;
        }
        if (!hub.classList.contains('streamflix-has-hero')) {
            hub.style.removeProperty('--bfx-bleed');
            hub.style.removeProperty('--bfx-subnav-top');
            hub.style.removeProperty('--bfx-hero-pad-top');
            return;
        }
        var offset = 0;
        try {
            var el = hub.parentNode;
            while (el && el.nodeType === 1) {
                offset += el.scrollTop || 0;
                el = el.parentNode;
            }
            offset += hub.getBoundingClientRect().top + (window.pageYOffset || 0);
        } catch (e) {
            offset = 0;
        }
        offset = Math.max(0, Math.min(220, Math.round(offset)));
        hub.style.setProperty('--bfx-bleed', offset + 'px');

        var headerH = (window.innerWidth || 1024) <= 600 ? 56 : 64;
        var subnavTop = Math.max(0, headerH - offset);
        hub.style.setProperty('--bfx-subnav-top', subnavTop + 'px');
        var topAnchor = Math.max(offset, headerH);
        var subnav = hub.querySelector('.streamflix-subnav');
        var subnavH = (subnav && subnav.offsetHeight) ? subnav.offsetHeight : 62;
        var padTop = Math.round(topAnchor + subnavH + 20);
        hub.style.setProperty('--bfx-hero-pad-top', padTop + 'px');
    }

    function heroHardPaused() {
        var hub = document.getElementById('streamflix-cinema-hub');
        return Boolean(document.hidden || state.searchQuery || state.browseFilter || isGateOpen() || isVideoPlayerActive()
            || !hub || hub.style.display === 'none' || !isOnHomeRoute()
            || document.body.classList.contains('streamflix-modal-open') || document.querySelector('.streamflix-modal-backdrop'));
    }

    /* Ambient colour: sample the backdrop and let the page below the hero take on its hue */
    function rgbToHsl(rgb) {
        var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var h = 0, s = 0, l = (mx + mn) / 2;
        if (mx !== mn) {
            var d = mx - mn;
            s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
            h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
            h /= 6;
        }
        return [h, s, l];
    }

    function hslToRgb(hsl) {
        var h = hsl[0], s = hsl[1], l = hsl[2];
        if (s === 0) {
            return [l * 255, l * 255, l * 255];
        }
        var hue = function (p, q, t) {
            if (t < 0) { t += 1; }
            if (t > 1) { t -= 1; }
            if (t < 1 / 6) { return p + (q - p) * 6 * t; }
            if (t < 1 / 2) { return q; }
            if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
            return p;
        };
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
    }

    function sampleAmbientColor(url, cb) {
        if (state.ambientCache[url]) {
            cb(state.ambientCache[url]);
            return;
        }
        var img = new Image();
        img.onload = function () {
            try {
                var c = document.createElement('canvas');
                c.width = 32;
                c.height = 18;
                var ctx = c.getContext && c.getContext('2d');
                if (!ctx) {
                    return;
                }
                ctx.drawImage(img, 0, 0, 32, 18);
                var d = ctx.getImageData(0, 0, 32, 18).data;
                var r = 0, g = 0, b = 0, w = 0, ar = 0, ag = 0, ab = 0, n = 0;
                for (var i = 0; i < d.length; i += 4) {
                    var R = d[i], G = d[i + 1], B = d[i + 2];
                    var hsl = rgbToHsl([R, G, B]);
                    ar += R; ag += G; ab += B; n++;
                    if (hsl[2] > 0.12 && hsl[2] < 0.82 && hsl[1] > 0.22) {
                        var wt = hsl[1] * hsl[1];
                        r += R * wt; g += G * wt; b += B * wt; w += wt;
                    }
                }
                var vivid = w > 0.6;
                var base = vivid ? [r / w, g / w, b / w] : [ar / n, ag / n, ab / n];
                var out = rgbToHsl(base);
                out[1] = Math.min(0.72, Math.max(out[1], vivid ? 0.38 : 0.08));
                out[2] = 0.3;
                var css = 'rgb(' + hslToRgb(out).map(function (v) { return Math.round(v); }).join(', ') + ')';
                putAmbientCache(url, css);
                cb(css);
            } catch (e) {
                // cross-origin artwork taints the canvas — keep the neutral background
            }
        };
        img.src = url;
    }

    var heroPreviewTimer = null;

    function stopHeroVideoPreview() {
        if (heroPreviewTimer) {
            clearTimeout(heroPreviewTimer);
            heroPreviewTimer = null;
        }
        state.heroVideoActive = false;
        state.heroVideoItemId = '';
        var hero = document.getElementById('streamflix-hero-billboard');
        if (!hero) {
            return;
        }
        hero.classList.remove('is-video-playing');
        var muteBtn = document.getElementById('streamflix-hero-mute-btn');
        if (muteBtn) {
            muteBtn.classList.add('is-hidden');
        }
        var vids = hero.querySelectorAll('video.bfx-hero-preview-video');
        Array.prototype.forEach.call(vids, function (v) {
            try {
                v.pause();
                v.removeAttribute('src');
                v.load();
            } catch (eV) {}
            if (v.parentNode) {
                v.parentNode.removeChild(v);
            }
        });
    }

    function canAutoplayHeroVideoPreview() {
        if (!state.activeProfile || state.activeProfile.autoplayPreviews === false) {
            return false;
        }
        if (prefersReducedMotion() || heroHardPaused()) {
            return false;
        }
        if (typeof isMobileDockViewportActive === 'function' && isMobileDockViewportActive()) {
            return false;
        }
        try {
            if (navigator.connection && navigator.connection.saveData) {
                return false;
            }
        } catch (eConn) {}
        return true;
    }

    function scheduleHeroVideoPreview(item) {
        stopHeroVideoPreview();
        if (!item || !item.Id || !canAutoplayHeroVideoPreview()) {
            return;
        }
        var targetId = item.Id;
        heroPreviewTimer = setTimeout(function () {
            heroPreviewTimer = null;
            if (!canAutoplayHeroVideoPreview()) {
                return;
            }
            var hero = document.getElementById('streamflix-hero-billboard');
            if (!hero || hero.getAttribute('data-hero-item') !== targetId) {
                return;
            }
            var auth = getJellyfinAuthContext();
            if (!auth || !auth.userId || !auth.token) {
                return;
            }
            if (!state.heroTrailerCache) {
                state.heroTrailerCache = {};
            }
            var resolveTrailer = state.heroTrailerCache.hasOwnProperty(targetId)
                ? Promise.resolve(state.heroTrailerCache[targetId])
                : apiFetch('/Users/' + encodeURIComponent(auth.userId) + '/Items/' + encodeURIComponent(targetId) + '/LocalTrailers')
                    .then(function (list) {
                        var hit = (Array.isArray(list) && list.length > 0 && list[0] && list[0].Id) ? list[0].Id : null;
                        state.heroTrailerCache[targetId] = hit;
                        return hit;
                    })
                    .catch(function () {
                        state.heroTrailerCache[targetId] = null;
                        return null;
                    });

            resolveTrailer.then(function (trailerId) {
                if (!trailerId || !canAutoplayHeroVideoPreview()) {
                    return;
                }
                var curHero = document.getElementById('streamflix-hero-billboard');
                var bgStack = curHero && curHero.querySelector('.streamflix-hero-bg-stack');
                if (!curHero || !bgStack || curHero.getAttribute('data-hero-item') !== targetId) {
                    return;
                }
                var streamUrl = apiBase() + '/Videos/' + encodeURIComponent(trailerId) + '/stream?static=true&api_key=' + encodeURIComponent(auth.token);
                var vid = document.createElement('video');
                vid.className = 'bfx-hero-preview-video';
                vid.muted = Boolean(state.heroPreviewMuted !== false);
                vid.playsInline = true;
                vid.setAttribute('playsinline', '');
                vid.setAttribute('webkit-playsinline', '');
                vid.preload = 'metadata';
                vid.src = streamUrl;

                var onCleanup = function () {
                    if (state.heroVideoItemId === targetId) {
                        stopHeroVideoPreview();
                        restartHeroTimer();
                    }
                };
                vid.addEventListener('playing', function () {
                    if (curHero.getAttribute('data-hero-item') !== targetId || heroHardPaused()) {
                        stopHeroVideoPreview();
                        return;
                    }
                    state.heroVideoActive = true;
                    state.heroVideoItemId = targetId;
                    vid.classList.add('is-playing');
                    curHero.classList.add('is-video-playing');
                    var muteBtn = document.getElementById('streamflix-hero-mute-btn');
                    if (muteBtn) {
                        muteBtn.classList.remove('is-hidden');
                        muteBtn.innerHTML = icon(vid.muted ? 'volumeOff' : 'volume');
                    }
                });
                vid.addEventListener('ended', onCleanup);
                vid.addEventListener('error', onCleanup);

                bgStack.appendChild(vid);
                var playPromise = vid.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(function () {
                        stopHeroVideoPreview();
                    });
                }
            });
        }, 2600);
    }

    function applyHeroAmbient(url) {
        sampleAmbientColor(url, function (css) {
            var hub = document.getElementById('streamflix-cinema-hub');
            var stack = document.querySelector('#streamflix-hero-billboard .streamflix-hero-bg-stack');
            if (hub && stack && stack.getAttribute('data-src') === url) {
                hub.style.setProperty('--bfx-ambient', css);
            }
        });
    }
