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
        var liveChannelPrograms = [];
        if (state.liveTvData && Array.isArray(state.liveTvData.channels)) {
            state.liveTvData.channels.forEach(function (ch) {
                if (ch && ch.CurrentProgram && ch.CurrentProgram.Id) {
                    liveChannelPrograms.push(ch.CurrentProgram);
                }
            });
        }
        [
            d.heroItems, d.resumeItems, d.nextUpItems, d.top10Items,
            d.favoriteItems, d.recentMovies, d.recentSeries,
            d.allMovies, d.allSeries, d.collectionsItems,
            state.searchResults || [], (state.browseFilter && state.browseFilter.items) || [],
            (state.libraryBrowser && state.libraryBrowser.items) || [], collectLibraryViewCachedItems(),
            (state.liveTvData && state.liveTvData.channels) || [],
            (state.liveTvData && state.liveTvData.onNow) || [],
            (state.liveTvData && state.liveTvData.recordings) || [],
            liveChannelPrograms,
            (state.liveTvEpg && state.liveTvEpg.programs) || [],
            (state.hotTabExtra && state.hotTabExtra.upcomingEpisodes) || [],
            personalRowItems(), extraItemsList || []
        ].forEach(function (arr) {
            (arr || []).forEach(function (it) {
                if (it && it.Id) {
                    // The same title can sit in several rows; keep the copy that knows how far in you are
                    var normKey = normalizeGuid(it.Id);
                    var prev = itemMap[it.Id] || (normKey ? itemMap[normKey] : null);
                    var prevPct = prev && prev.UserData && prev.UserData.PlayedPercentage;
                    if (!prevPct || (it.UserData && it.UserData.PlayedPercentage)) {
                        itemMap[it.Id] = it;
                        if (normKey) {
                            itemMap[normKey] = it;
                        }
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
            var normCardId = normalizeGuid(itemId);
            var item = itemMap[itemId] || (normCardId ? itemMap[normCardId] : null) || findCachedItemById(itemId) || { Id: itemId };
            card.__bfxItem = item;
            var openCardDetail = function () {
                if (!item.Name && item.Id && typeof openHeroDetailModalById === 'function') {
                    openHeroDetailModalById(item.Id);
                } else {
                    openHeroDetailModal(item);
                }
            };

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
                        openCardDetail();
                    }
                    return;
                }
                openCardDetail();
            });
            card.addEventListener('keydown', function (ev) {
                if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === card) {
                    ev.preventDefault();
                    openCardDetail();
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
        if (cat === 'collections' || cat === 'mylist' || cat === 'top10' || cat === 'hot' || cat === 'livetv') {
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
        var liveTvOn = Boolean(cfg.enableLiveTv);
        var hid = Array.isArray(cfg.navHiddenBuiltIns) ? cfg.navHiddenBuiltIns.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean).join(',') : '';
        var libs = Array.isArray(cfg.navLibraryIds) ? cfg.navLibraryIds.map(function (x) { return normalizeGuid(x) || String(x || '').trim(); }).filter(Boolean).join(',') : '';
        return String(showLibs) + '|' + String(liveTvOn) + '|' + hid + '|' + libs;
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

    var CANONICAL_HOME_ROW_SPECS = [
        { id: 'resume', label: 'Continue Watching' },
        { id: 'nextup', label: 'Next Up' },
        { id: 'livetv', label: 'Live TV · On Now' },
        { id: 'personal', label: 'Top Picks & Because You Watched' },
        { id: 'top10', label: 'Top 10 Today' },
        { id: 'mylist', label: 'My List' },
        { id: 'acclaimed', label: 'Critically Acclaimed' },
        { id: 'movies', label: 'New Movies' },
        { id: 'series', label: 'New Shows' },
        { id: 'gems', label: 'Hidden Gems' },
        { id: 'collections', label: 'Collections' },
        { id: 'watchagain', label: 'Watch It Again' }
    ];

    function getCurrentServerHomeRowsSig() {
        var cfg = state.config || {};
        var ord = Array.isArray(cfg.homeRowOrder) ? cfg.homeRowOrder.join(',') : '';
        var hid = Array.isArray(cfg.homeHiddenRows) ? cfg.homeHiddenRows.join(',') : '';
        return ord + '|' + hid;
    }

    function getProfileHomeRowPrefs() {
        var pid = state.activeProfile && state.activeProfile.id;
        if (!pid) {
            return null;
        }
        var stored = loadJson(HOME_ROW_PREF_PREFIX + pid, null);
        if (!stored || typeof stored !== 'object' || !stored.customized) {
            return null;
        }
        if (stored.serverHomeSig !== getCurrentServerHomeRowsSig()) {
            return null;
        }
        return stored;
    }

    function saveProfileHomeRowPrefs(prefs) {
        var pid = state.activeProfile && state.activeProfile.id;
        if (!pid) {
            return;
        }
        if (prefs && typeof prefs === 'object') {
            prefs.serverHomeSig = getCurrentServerHomeRowsSig();
        }
        saveJson(HOME_ROW_PREF_PREFIX + pid, prefs || null);
    }

    function getEffectiveHomeRowPlan() {
        var prof = getProfileHomeRowPrefs();
        var cfg = state.config || {};
        var rawOrder = prof && Array.isArray(prof.order)
            ? prof.order
            : (Array.isArray(cfg.homeRowOrder) ? cfg.homeRowOrder : []);
        var rawHidden = prof && Array.isArray(prof.hiddenRows)
            ? prof.hiddenRows
            : (Array.isArray(cfg.homeHiddenRows) ? cfg.homeHiddenRows : []);
        var allowedMap = {};
        CANONICAL_HOME_ROW_SPECS.forEach(function (r) { allowedMap[r.id] = true; });
        var seen = {};
        var order = [];
        rawOrder.forEach(function (id) {
            var clean = String(id || '').trim().toLowerCase();
            if (allowedMap[clean] && !seen[clean]) {
                seen[clean] = true;
                order.push(clean);
            }
        });
        CANONICAL_HOME_ROW_SPECS.forEach(function (r) {
            if (!seen[r.id]) {
                seen[r.id] = true;
                order.push(r.id);
            }
        });
        var hiddenMap = {};
        rawHidden.forEach(function (id) {
            var clean = String(id || '').trim().toLowerCase();
            if (allowedMap[clean]) {
                hiddenMap[clean] = true;
            }
        });
        var defSeq = CANONICAL_HOME_ROW_SPECS.map(function (r) { return r.id; }).join(',');
        return {
            order: order,
            hiddenMap: hiddenMap,
            isDefaultOrder: order.join(',') === defSeq
        };
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

        var liveTvAllowed = typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile();
        if (liveTvAllowed && !hiddenBuiltInMap.livetv) {
            var ltvForbidden = Boolean(state.liveTvData && state.liveTvData.forbidden);
            pills.push({ id: 'livetv', label: 'Live TV', hide: ltvForbidden });
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
            { id: 'hot', label: 'New & Popular' }
        ];
        if (typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile()) {
            builtIns.push({ id: 'livetv', label: 'Live TV' });
        }
        builtIns.push(
            { id: 'collections', label: 'Collections' },
            { id: 'top10', label: 'Top 10' },
            { id: 'mylist', label: 'My List' }
        );

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

        var profRowPrefs = getProfileHomeRowPrefs();
        var effRowPlan = getEffectiveHomeRowPlan();
        var draftRowOrder = effRowPlan.order.slice();
        var draftRowHidden = {};
        Object.keys(effRowPlan.hiddenMap).forEach(function (k) { draftRowHidden[k] = true; });

        var profName = (state.activeProfile && state.activeProfile.name) || 'this profile';
        var m = openModal(''
            + '<div class="bfx-cs-head">'
            + '  <div class="bfx-cs-head-ico">' + icon('sliders') + '</div>'
            + '  <div class="bfx-cs-head-copy">'
            + '    <h2>Navigation &amp; Home Layout</h2>'
            + '    <p class="streamflix-modal-text">Customize top-bar categories, Jellyfin libraries, and Home screen row order for <strong>' + escapeHtml(profName) + '</strong>.</p>'
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
            + '<div class="bfx-nav-cust-section">'
            + '  <div class="bfx-nav-cust-label">Home Screen Row Order</div>'
            + '  <div class="bfx-home-rows-cust-list" id="bfx-prof-home-rows-list"></div>'
            + '</div>'
            + '<div class="streamflix-modal-actions" style="justify-content:space-between;">'
            + ((profPrefs || profRowPrefs)
                ? '  <button type="button" class="streamflix-ghost-btn" data-nav-act="reset">Use Server Default</button>'
                : '  <span></span>')
            + '  <div style="display:flex;gap:8px;">'
            + '    <button type="button" class="streamflix-ghost-btn" data-nav-act="cancel">Cancel</button>'
            + '    <button type="button" class="streamflix-btn-primary" data-nav-act="save">Save</button>'
            + '  </div>'
            + '</div>', { className: 'bfx-nav-customize-modal' });

        var rowHostEl = m.modal.querySelector('#bfx-prof-home-rows-list');
        var liveTvOnNowAllowed = typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile();
        var rowTitleMap = {};
        CANONICAL_HOME_ROW_SPECS.forEach(function (r) { rowTitleMap[r.id] = r.label; });
        var renderModalHomeRows = function () {
            if (!rowHostEl) {
                return;
            }
            var shownOrder = draftRowOrder.filter(function (rid) {
                return rid !== 'livetv' || liveTvOnNowAllowed;
            });
            rowHostEl.innerHTML = shownOrder.map(function (rid, idx) {
                var on = !draftRowHidden[rid];
                return ''
                    + '<div class="bfx-home-row-cust-item" data-cust-row="' + escapeHtml(rid) + '">'
                    + '  <label class="bfx-home-row-cust-lbl">'
                    + '    <input type="checkbox" data-cust-row-cb="' + escapeHtml(rid) + '"' + (on ? ' checked' : '') + ' />'
                    + '    <span>' + escapeHtml(rowTitleMap[rid] || rid) + '</span>'
                    + '  </label>'
                    + '  <div class="bfx-home-row-cust-btns">'
                    + '    <button type="button" class="streamflix-ghost-btn bfx-home-row-move-btn" data-cust-move="-1" data-cust-id="' + escapeHtml(rid) + '"' + (idx === 0 ? ' disabled' : '') + ' title="Move row up" aria-label="Move up">' + icon('arrowUp') + '</button>'
                    + '    <button type="button" class="streamflix-ghost-btn bfx-home-row-move-btn" data-cust-move="1" data-cust-id="' + escapeHtml(rid) + '"' + (idx === shownOrder.length - 1 ? ' disabled' : '') + ' title="Move row down" aria-label="Move down">' + icon('arrowDown') + '</button>'
                    + '  </div>'
                    + '</div>';
            }).join('');
            Array.prototype.forEach.call(rowHostEl.querySelectorAll('input[data-cust-row-cb]'), function (cb) {
                cb.addEventListener('change', function () {
                    var rid = cb.getAttribute('data-cust-row-cb');
                    if (rid) {
                        if (cb.checked) { delete draftRowHidden[rid]; }
                        else { draftRowHidden[rid] = true; }
                    }
                });
            });
            Array.prototype.forEach.call(rowHostEl.querySelectorAll('button[data-cust-move]'), function (btn) {
                btn.addEventListener('click', function () {
                    var rid = btn.getAttribute('data-cust-id');
                    var dir = parseInt(btn.getAttribute('data-cust-move'), 10) || 0;
                    var curIdx = draftRowOrder.indexOf(rid);
                    var nextIdx = curIdx + dir;
                    while (nextIdx >= 0 && nextIdx < draftRowOrder.length && !liveTvOnNowAllowed && draftRowOrder[nextIdx] === 'livetv') {
                        nextIdx += dir;
                    }
                    if (curIdx !== -1 && nextIdx >= 0 && nextIdx < draftRowOrder.length) {
                        var tmp = draftRowOrder[curIdx];
                        draftRowOrder[curIdx] = draftRowOrder[nextIdx];
                        draftRowOrder[nextIdx] = tmp;
                        renderModalHomeRows();
                    }
                });
            });
        };
        renderModalHomeRows();

        var cancelBtn = m.modal.querySelector('[data-nav-act="cancel"]');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () { m.close(false); });
        }
        var resetBtn = m.modal.querySelector('[data-nav-act="reset"]');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                saveProfileNavPrefs(null);
                saveProfileHomeRowPrefs(null);
                m.close(true);
                if (document.getElementById('streamflix-cinema-hub')) {
                    renderCinemaHubContents();
                }
                showToast('Navigation & Home layout reset to server defaults.', 'info');
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
                saveProfileHomeRowPrefs({
                    customized: true,
                    order: draftRowOrder.slice(),
                    hiddenRows: Object.keys(draftRowHidden).filter(function (k) { return Boolean(draftRowHidden[k]); })
                });
                m.close(true);
                if (document.getElementById('streamflix-cinema-hub')) {
                    renderCinemaHubContents();
                }
                showToast('Navigation & Home layout updated.', 'success');
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

    /* ----------------------------------------------------------------------
       Opt-In Live TV Hub (Channels, On Now, Favorites, Recordings & EPG Link)
       ---------------------------------------------------------------------- */
    function parseChannelSortNumber(ch) {
        if (!ch) {
            return Number.POSITIVE_INFINITY;
        }
        var raw = String(ch.Number || ch.ChannelNumber || '').trim();
        if (!raw) {
            return Number.POSITIVE_INFINITY;
        }
        var m = raw.match(/^(\d+)(?:[.-](\d+))?/);
        if (!m) {
            return Number.POSITIVE_INFINITY;
        }
        var major = parseInt(m[1], 10);
        var minor = m[2] ? (parseInt(m[2], 10) / 1000) : 0;
        return isNaN(major) ? Number.POSITIVE_INFINITY : (major + minor);
    }

    function ensureLiveTvHubDataLoaded(forceRefresh) {
        if (!(typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile())) {
            return null;
        }
        var auth = getJellyfinAuthContext();
        if (!auth || !auth.userId || !auth.token) {
            return null;
        }
        var existing = state.liveTvData;
        var sameUser = existing && normalizeGuid(existing.userId) === normalizeGuid(auth.userId);
        if (sameUser && !forceRefresh) {
            if (existing.loading) {
                return existing;
            }
            if (existing.loaded && (Date.now() - (Number(existing.ts) || 0)) < 90000) {
                return existing;
            }
        }

        var entry = sameUser ? existing : {
            userId: auth.userId,
            loading: true,
            loaded: false,
            forbidden: false,
            ts: 0,
            channels: [],
            onNow: [],
            recordings: []
        };
        entry.loading = true;
        state.liveTvData = entry;

        var uid = encodeURIComponent(auth.userId);
        var pChannels = apiFetch('/LiveTv/Channels?userId=' + uid + '&EnableImages=true&EnableUserData=true&AddCurrentProgram=true&Fields=PrimaryImageAspectRatio,ChannelInfo,Overview&Limit=300')
            .catch(function (err) {
                if (err && (err.status === 401 || err.status === 403)) {
                    entry.forbidden = true;
                }
                return { Items: [] };
            });
        var pOnNow = apiFetch('/LiveTv/Programs/Recommended?userId=' + uid + '&IsAiring=true&HasAired=false&EnableImages=true&EnableUserData=true&Limit=36&Fields=Overview,PrimaryImageAspectRatio,ChannelInfo')
            .catch(function () { return { Items: [] }; });
        var pRecs = apiFetch('/LiveTv/Recordings?userId=' + uid + '&EnableImages=true&EnableUserData=true&Limit=36&Fields=Overview,PrimaryImageAspectRatio')
            .catch(function () { return { Items: [] }; });

        Promise.all([pChannels, pOnNow, pRecs]).then(function (resArr) {
            if (state.liveTvData !== entry || normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(auth.userId)) {
                return;
            }
            var rawChannels = (resArr[0] && Array.isArray(resArr[0].Items)) ? resArr[0].Items : [];
            rawChannels.sort(function (a, b) {
                var na = parseChannelSortNumber(a);
                var nb = parseChannelSortNumber(b);
                if (na !== nb) {
                    return na - nb;
                }
                var sa = String((a && (a.SortName || a.Name)) || '').toLowerCase();
                var sb = String((b && (b.SortName || b.Name)) || '').toLowerCase();
                return sa < sb ? -1 : (sa > sb ? 1 : 0);
            });
            var onNowItems = (resArr[1] && Array.isArray(resArr[1].Items)) ? resArr[1].Items : [];
            var recItems = (resArr[2] && Array.isArray(resArr[2].Items)) ? resArr[2].Items : [];

            entry.channels = rawChannels;
            entry.onNow = onNowItems;
            entry.recordings = recItems;
            entry.loading = false;
            entry.loaded = true;
            entry.ts = Date.now();

            if (document.getElementById('streamflix-cinema-hub')
                && (state.activeCategory === 'livetv' || entry.forbidden || (state.activeCategory === 'all' && rawChannels.length > 0))) {
                renderCinemaHubContents();
            }
        }).catch(function () {
            if (state.liveTvData === entry) {
                entry.loading = false;
                entry.loaded = true;
                entry.ts = Date.now();
                if (document.getElementById('streamflix-cinema-hub') && state.activeCategory === 'livetv') {
                    renderCinemaHubContents();
                }
            }
        });

        return entry;
    }

    function computeLiveProgramProgress(prog) {
        if (!prog || !prog.StartDate || !prog.EndDate) {
            return { pct: 0, timeWindow: '', leftLabel: '', airing: false };
        }
        var sMs = Date.parse(prog.StartDate);
        var eMs = Date.parse(prog.EndDate);
        if (isNaN(sMs) || isNaN(eMs) || eMs <= sMs) {
            return { pct: 0, timeWindow: '', leftLabel: '', airing: false };
        }
        var nowMs = Date.now();
        var airing = nowMs >= sMs && nowMs < eMs;
        var pct = airing ? Math.min(100, Math.max(3, Math.round((nowMs - sMs) / (eMs - sMs) * 100))) : 0;
        var timeWindow = '';
        try {
            var fmt = function (ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
            timeWindow = fmt(sMs) + ' – ' + fmt(eMs);
        } catch (eFmt) {}
        var leftMins = airing ? Math.max(1, Math.round((eMs - nowMs) / 60000)) : 0;
        var leftLabel = airing ? (leftMins >= 60 ? (Math.floor(leftMins / 60) + 'h ' + (leftMins % 60 ? (leftMins % 60) + 'm ' : '') + 'left') : (leftMins + 'm left')) : '';
        return { pct: pct, timeWindow: timeWindow, leftLabel: leftLabel, airing: airing };
    }

    function buildLiveTvCardHtml(item, mode) {
        if (!item || !item.Id) {
            return '';
        }
        var isRecording = mode === 'recording' || item.Type === 'Recording' || (item.Type !== 'TvChannel' && item.Type !== 'Program');
        var isProgramCard = !isRecording && (mode === 'program' || item.Type === 'Program');
        var prog = isProgramCard ? item : (item.CurrentProgram || null);
        var timing = prog ? computeLiveProgramProgress(prog) : { pct: 0, timeWindow: '', leftLabel: '', airing: false };
        var isFav = Boolean(item.UserData && item.UserData.IsFavorite);
        var isRadio = item.ChannelType === 'Radio';
        var chNum = String(item.Number || item.ChannelNumber || '').trim();
        var chName = isProgramCard ? String(item.ChannelName || item.Name || '') : String(item.Name || 'Channel');
        var mainTitle = isRecording
            ? String(item.Name || 'Recording')
            : (prog && prog.Name ? String(prog.Name) : chName);
        var subLine = isRecording
            ? ([item.EpisodeTitle || '', formatRuntimeTicks(item.RunTimeTicks).trim()].filter(Boolean).join(' · ') || buildCardMetaText(item))
            : (isProgramCard
                ? ([chNum ? ('CH ' + chNum) : '', chName, timing.leftLabel || timing.timeWindow].filter(Boolean).join(' · '))
                : (prog && prog.Name
                    ? ([timing.timeWindow, timing.leftLabel].filter(Boolean).join(' · ') || (prog.EpisodeTitle || 'On Now'))
                    : (isRadio ? 'Live Radio Stream' : 'Live Broadcast')));

        var wideBgUrl = '';
        var logoBadgeUrl = '';
        if (isRecording) {
            wideBgUrl = getItemBackdropUrl(item, 640);
        } else if (isProgramCard) {
            if ((item.BackdropImageTags && item.BackdropImageTags.length > 0) || (item.ImageTags && (item.ImageTags.Thumb || item.ImageTags.Primary))) {
                wideBgUrl = getItemBackdropUrl(item, 640);
            }
            if (item.ChannelId && item.ChannelPrimaryImageTag) {
                logoBadgeUrl = apiBase() + '/Items/' + encodeURIComponent(item.ChannelId) + '/Images/Primary?maxWidth=220&quality=88';
            } else if (!wideBgUrl && item.ChannelId) {
                logoBadgeUrl = apiBase() + '/Items/' + encodeURIComponent(item.ChannelId) + '/Images/Primary?maxWidth=320&quality=88';
            }
        } else {
            if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                wideBgUrl = apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Backdrop/0?maxWidth=640&quality=85';
            } else if (prog && prog.Id && ((prog.BackdropImageTags && prog.BackdropImageTags.length > 0) || (prog.ImageTags && (prog.ImageTags.Thumb || prog.ImageTags.Primary)))) {
                wideBgUrl = getItemBackdropUrl(item, 640);
            }
            if (item.ImageTags && item.ImageTags.Primary) {
                logoBadgeUrl = apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Primary?maxWidth=320&quality=90';
            }
        }

        var showLivePill = !isRecording && (timing.airing || item.Type === 'TvChannel' || isProgramCard);
        var pctBar = isRecording
            ? ((item.UserData && item.UserData.PlayedPercentage) ? Math.min(100, Math.max(2, Math.round(item.UserData.PlayedPercentage))) : 0)
            : timing.pct;

        return ''
            + '<div class="bfx-ltv-card' + (wideBgUrl ? ' has-backdrop' : ' is-logo-stage') + '" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml((chNum ? 'Channel ' + chNum + ' ' : '') + chName + (mainTitle !== chName ? ' — ' + mainTitle : '')) + '">'
            + '  <div class="bfx-ltv-media">'
            + (wideBgUrl
                ? '    <img class="bfx-ltv-bg" loading="lazy" decoding="async" src="' + escapeHtml(wideBgUrl) + '" alt="" data-bfx-img="fade" />'
                : '')
            + '    <div class="bfx-ltv-scrim"></div>'
            + (!wideBgUrl && logoBadgeUrl
                ? '    <div class="bfx-ltv-center-logo"><img loading="lazy" decoding="async" src="' + escapeHtml(logoBadgeUrl) + '" alt="" data-bfx-img="fade" /></div>'
                : (!wideBgUrl
                    ? '    <div class="bfx-ltv-center-fallback">' + icon('tv') + '<span>' + escapeHtml(chNum || chName.slice(0, 6)) + '</span></div>'
                    : ''))
            + '    <div class="bfx-ltv-top-badges">'
            + (showLivePill
                ? '      <span class="bfx-ltv-live-pill"><span class="bfx-ltv-live-dot"></span>' + (isRadio ? 'RADIO' : 'LIVE') + '</span>'
                : (isRecording ? '      <span class="bfx-ltv-rec-pill">DVR</span>' : ''))
            + (chNum ? '      <span class="bfx-ltv-chnum">CH ' + escapeHtml(chNum) + '</span>' : '')
            + '    </div>'
            + '    <div class="bfx-ltv-quick-actions">'
            + (!isProgramCard
                ? '      <button type="button" class="streamflix-qbtn' + (isFav ? ' active' : '') + '" data-action="fav" title="' + (isFav ? 'Remove favorite channel' : 'Favorite channel') + '" aria-label="Favorite">' + icon(isFav ? 'check' : 'plus') + '</button>'
                : '')
            + '      <button type="button" class="streamflix-qbtn" data-action="info" title="Program &amp; Schedule" aria-label="Details">' + icon('info') + '</button>'
            + '    </div>'
            + '    <button type="button" class="streamflix-wide-play bfx-ltv-play" data-action="play" title="' + (isRecording ? 'Play Recording' : ('Watch ' + escapeHtml(chName) + ' Live')) + '" aria-label="Watch Live">' + icon('play') + '</button>'
            + (wideBgUrl && logoBadgeUrl
                ? '    <div class="bfx-ltv-corner-logo"><img loading="lazy" decoding="async" src="' + escapeHtml(logoBadgeUrl) + '" alt="" data-bfx-img="fade" /></div>'
                : '')
            + (pctBar > 0
                ? '    <div class="streamflix-progress-track"><div class="streamflix-progress-fill" style="width:' + pctBar + '%;"></div></div>'
                : '')
            + '  </div>'
            + '  <div class="bfx-ltv-body">'
            + '    <div class="bfx-ltv-chline">'
            + '      <span class="bfx-ltv-chname">' + escapeHtml(isRecording ? (item.ChannelName || 'Recorded TV') : chName) + '</span>'
            + '    </div>'
            + '    <div class="bfx-ltv-progtitle">' + escapeHtml(mainTitle) + '</div>'
            + (subLine ? '    <div class="bfx-ltv-progsub">' + escapeHtml(subLine) + '</div>' : '')
            + '  </div>'
            + '</div>';
    }

    function getFilteredLiveTvChannels(channels, rawFilter) {
        var q = String(rawFilter || '').trim().toLowerCase();
        if (!q) {
            return channels || [];
        }
        return (channels || []).filter(function (ch) {
            if (!ch) {
                return false;
            }
            var nm = String(ch.Name || '').toLowerCase();
            var num = String(ch.Number || ch.ChannelNumber || '').toLowerCase();
            var pr = (ch.CurrentProgram && ch.CurrentProgram.Name) ? String(ch.CurrentProgram.Name).toLowerCase() : '';
            var ep = (ch.CurrentProgram && ch.CurrentProgram.EpisodeTitle) ? String(ch.CurrentProgram.EpisodeTitle).toLowerCase() : '';
            return nm.indexOf(q) !== -1 || num.indexOf(q) !== -1 || pr.indexOf(q) !== -1 || ep.indexOf(q) !== -1;
        });
    }

    var EPG_WINDOW_MINUTES = 180;

    function getLiveTvEpgWindowBounds() {
        var offsetMins = (state.liveTvUi && typeof state.liveTvUi.epgOffsetMins === 'number') ? state.liveTvUi.epgOffsetMins : 0;
        var halfHourMs = 30 * 60000;
        var baseStartMs = Math.floor(Date.now() / halfHourMs) * halfHourMs;
        var startMs = baseStartMs + (offsetMins * 60000);
        var endMs = startMs + (EPG_WINDOW_MINUTES * 60000);
        return {
            startMs: startMs,
            endMs: endMs,
            offsetMins: offsetMins
        };
    }

    function ensureLiveTvEpgLoaded(forceRefresh) {
        if (!(typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile())) {
            return null;
        }
        var auth = getJellyfinAuthContext();
        if (!auth || !auth.userId || !auth.token) {
            return null;
        }
        var bounds = getLiveTvEpgWindowBounds();
        var winKey = normalizeGuid(auth.userId) + ':' + bounds.startMs + ':' + bounds.endMs;
        var existing = state.liveTvEpg;
        if (existing && existing.winKey === winKey && !forceRefresh) {
            if (existing.loading) {
                return existing;
            }
            if (existing.loaded && (Date.now() - (Number(existing.ts) || 0)) < 90000) {
                return existing;
            }
        }

        var entry = {
            winKey: winKey,
            userId: auth.userId,
            startMs: bounds.startMs,
            endMs: bounds.endMs,
            loading: true,
            loaded: false,
            ts: 0,
            programs: [],
            byChannel: {},
            timersByProgramId: {}
        };
        state.liveTvEpg = entry;

        var uid = encodeURIComponent(auth.userId);
        var startIso = encodeURIComponent(new Date(bounds.startMs).toISOString());
        var endIso = encodeURIComponent(new Date(bounds.endMs).toISOString());
        var pProgs = apiFetch('/LiveTv/Programs?userId=' + uid + '&MaxStartDate=' + endIso + '&MinEndDate=' + startIso + '&EnableImages=true&EnableUserData=true&Fields=Overview,ChannelInfo&Limit=1200')
            .catch(function () { return { Items: [] }; });
        var pTimers = apiFetch('/LiveTv/Timers')
            .catch(function () { return { Items: [] }; });

        Promise.all([pProgs, pTimers]).then(function (resArr) {
            if (state.liveTvEpg !== entry) {
                return;
            }
            var rawProgs = (resArr[0] && Array.isArray(resArr[0].Items)) ? resArr[0].Items : [];
            var rawTimers = (resArr[1] && Array.isArray(resArr[1].Items)) ? resArr[1].Items : [];
            var timerMap = {};
            rawTimers.forEach(function (tm) {
                if (tm && tm.Id && tm.ProgramId && String(tm.Status || '').toLowerCase() !== 'cancelled') {
                    timerMap[normalizeGuid(tm.ProgramId)] = String(tm.Id);
                }
            });
            var byCh = {};
            rawProgs.forEach(function (pr) {
                if (!pr || !pr.Id || !pr.ChannelId) {
                    return;
                }
                var normPid = normalizeGuid(pr.Id);
                if (!pr.TimerId && timerMap[normPid]) {
                    pr.TimerId = timerMap[normPid];
                }
                var chKey = normalizeGuid(pr.ChannelId);
                if (!byCh[chKey]) {
                    byCh[chKey] = [];
                }
                byCh[chKey].push(pr);
            });
            Object.keys(byCh).forEach(function (ck) {
                byCh[ck].sort(function (a, b) {
                    return (Date.parse(a.StartDate || '') || 0) - (Date.parse(b.StartDate || '') || 0);
                });
            });

            entry.programs = rawProgs;
            entry.byChannel = byCh;
            entry.timersByProgramId = timerMap;
            entry.loading = false;
            entry.loaded = true;
            entry.ts = Date.now();

            if (document.getElementById('streamflix-cinema-hub') && state.activeCategory === 'livetv' && state.liveTvUi && state.liveTvUi.tab === 'guide') {
                renderCinemaHubContents();
            }
        }).catch(function () {
            if (state.liveTvEpg === entry) {
                entry.loading = false;
                entry.loaded = true;
                entry.ts = Date.now();
                if (document.getElementById('streamflix-cinema-hub') && state.activeCategory === 'livetv' && state.liveTvUi && state.liveTvUi.tab === 'guide') {
                    renderCinemaHubContents();
                }
            }
        });

        return entry;
    }

    function buildLiveTvEpgGridHtml(channels, filterQ) {
        var epg = ensureLiveTvEpgLoaded(false);
        var bounds = getLiveTvEpgWindowBounds();
        var startMs = bounds.startMs;
        var endMs = bounds.endMs;
        var spanMs = Math.max(1, endMs - startMs);
        var nowMs = Date.now();
        var nowInWindow = nowMs >= startMs && nowMs <= endMs;
        var nowPct = nowInWindow ? Math.min(100, Math.max(0, ((nowMs - startMs) / spanMs) * 100)) : -1;

        var fmtSlot = function (ms) {
            try {
                return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            } catch (eT) {
                return '';
            }
        };
        var dateLabel = '';
        try {
            dateLabel = new Date(startMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        } catch (eD) {}

        var slotsHtml = '';
        var slotCount = EPG_WINDOW_MINUTES / 30;
        for (var si = 0; si < slotCount; si++) {
            var slotMs = startMs + (si * 30 * 60000);
            slotsHtml += '<div class="bfx-epg-slot-lbl" style="width:' + (100 / slotCount).toFixed(4) + '%;">' + escapeHtml(fmtSlot(slotMs)) + '</div>';
        }

        var visibleChannels = getFilteredLiveTvChannels(channels, filterQ).slice(0, 80);
        if (!visibleChannels.length) {
            return buildEmptyStateHtml('search', 'No channels matching “' + filterQ + '”', 'Clear the channel filter above to view the full TV Guide timeline.');
        }

        var bodyRowsHtml = '';
        if (!epg || (epg.loading && !epg.loaded)) {
            bodyRowsHtml = '<div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Loading 3-hour TV Guide lineup…</span></div>';
        } else {
            bodyRowsHtml = visibleChannels.map(function (ch) {
                var chKey = normalizeGuid(ch.Id);
                var chNum = String(ch.Number || ch.ChannelNumber || '').trim();
                var chName = String(ch.Name || 'Channel');
                var logoUrl = (ch.ImageTags && ch.ImageTags.Primary)
                    ? (apiBase() + '/Items/' + encodeURIComponent(ch.Id) + '/Images/Primary?maxWidth=120&quality=88')
                    : '';
                var progs = (epg.byChannel && epg.byChannel[chKey]) ? epg.byChannel[chKey] : [];
                if (!progs.length && ch.CurrentProgram && ch.CurrentProgram.Id) {
                    progs = [ch.CurrentProgram];
                }

                var blocksHtml = '';
                if (!progs.length) {
                    blocksHtml = '<div class="bfx-epg-prog is-empty" data-epg-tune-ch="' + escapeHtml(ch.Id) + '" style="left:0%;width:100%;" role="button" tabindex="0" title="Watch ' + escapeHtml(chName) + ' Live">'
                        + '<span class="bfx-epg-prog-title">' + escapeHtml(chName) + ' · Live Stream</span>'
                        + '<span class="bfx-epg-prog-sub">No EPG program data in this window — click to watch live</span>'
                        + '</div>';
                } else {
                    blocksHtml = progs.map(function (pr) {
                        var pStart = Date.parse(pr.StartDate || '');
                        var pEnd = Date.parse(pr.EndDate || '');
                        if (isNaN(pStart) || isNaN(pEnd) || pEnd <= startMs || pStart >= endMs || pEnd <= pStart) {
                            return '';
                        }
                        var clampedStart = Math.max(startMs, pStart);
                        var clampedEnd = Math.min(endMs, pEnd);
                        var leftPct = ((clampedStart - startMs) / spanMs) * 100;
                        var widthPct = Math.max(2.2, ((clampedEnd - clampedStart) / spanMs) * 100);
                        if (leftPct + widthPct > 100) {
                            widthPct = Math.max(1.5, 100 - leftPct);
                        }
                        var airing = nowMs >= pStart && nowMs < pEnd;
                        var hasTimer = Boolean(pr.TimerId || (epg.timersByProgramId && epg.timersByProgramId[normalizeGuid(pr.Id)]));
                        var timeStr = fmtSlot(pStart) + ' – ' + fmtSlot(pEnd);
                        var subParts = [pr.EpisodeTitle || '', timeStr].filter(Boolean).join(' · ');
                        return ''
                            + '<div class="bfx-epg-prog' + (airing ? ' is-airing' : '') + (hasTimer ? ' has-timer' : '') + '" data-item-id="' + escapeHtml(pr.Id) + '" style="left:' + leftPct.toFixed(3) + '%;width:' + widthPct.toFixed(3) + '%;" role="button" tabindex="0" title="' + escapeHtml((pr.Name || 'Program') + ' (' + timeStr + ')') + '">'
                            + '  <div class="bfx-epg-prog-top">'
                            + (airing ? '<span class="bfx-ltv-live-dot"></span>' : '')
                            + (hasTimer ? '<span class="bfx-epg-rec-badge" title="Recording scheduled">REC</span>' : '')
                            + '    <span class="bfx-epg-prog-title">' + escapeHtml(pr.Name || 'Program') + '</span>'
                            + '  </div>'
                            + '  <div class="bfx-epg-prog-sub">' + escapeHtml(subParts) + '</div>'
                            + '</div>';
                    }).join('');
                }

                return ''
                    + '<div class="bfx-epg-row">'
                    + '  <button type="button" class="bfx-epg-ch-cell" data-epg-tune-ch="' + escapeHtml(ch.Id) + '" title="Watch ' + escapeHtml((chNum ? 'CH ' + chNum + ' ' : '') + chName) + ' Live">'
                    + (logoUrl
                        ? '    <img class="bfx-epg-ch-logo" loading="lazy" src="' + escapeHtml(logoUrl) + '" alt="" />'
                        : '    <span class="bfx-epg-ch-fallback">' + icon('tv') + '</span>')
                    + '    <span class="bfx-epg-ch-meta">'
                    + (chNum ? '      <span class="bfx-epg-ch-num">CH ' + escapeHtml(chNum) + '</span>' : '')
                    + '      <span class="bfx-epg-ch-name">' + escapeHtml(chName) + '</span>'
                    + '    </span>'
                    + '  </button>'
                    + '  <div class="bfx-epg-track">'
                    + (nowPct >= 0 ? '    <div class="bfx-epg-now-line" style="left:' + nowPct.toFixed(3) + '%;" aria-hidden="true"></div>' : '')
                    + blocksHtml
                    + '  </div>'
                    + '</div>';
            }).join('');
        }

        return ''
            + '<div class="bfx-epg-wrap" id="bfx-ltv-epg-wrap">'
            + '  <div class="bfx-epg-toolbar">'
            + '    <div class="bfx-epg-window-label">' + icon('calendar') + '<span>' + escapeHtml((dateLabel ? dateLabel + ' · ' : '') + fmtSlot(startMs) + ' – ' + fmtSlot(endMs)) + '</span></div>'
            + '    <div class="bfx-epg-nav-btns">'
            + '      <button type="button" class="streamflix-ghost-btn bfx-epg-step-btn" data-epg-step="-120">' + icon('chevronLeft') + '<span>Earlier</span></button>'
            + '      <button type="button" class="streamflix-ghost-btn bfx-epg-step-btn' + (bounds.offsetMins === 0 ? ' is-now' : '') + '" data-epg-now="1"><span>Now</span></button>'
            + '      <button type="button" class="streamflix-ghost-btn bfx-epg-step-btn" data-epg-step="120"><span>Later</span>' + icon('chevronRight') + '</button>'
            + '    </div>'
            + '  </div>'
            + '  <div class="bfx-epg-scroll">'
            + '    <div class="bfx-epg-table">'
            + '      <div class="bfx-epg-header-row">'
            + '        <div class="bfx-epg-corner">Channel</div>'
            + '        <div class="bfx-epg-ruler">'
            + slotsHtml
            + (nowPct >= 0 ? '<div class="bfx-epg-now-head" style="left:' + nowPct.toFixed(3) + '%;"><span>NOW</span></div>' : '')
            + '        </div>'
            + '      </div>'
            + bodyRowsHtml
            + '    </div>'
            + '  </div>'
            + '</div>';
    }

    function buildLiveTvContentSlotHtml(ltv) {
        var ui = state.liveTvUi || { tab: 'all', filter: '' };
        var tab = ui.tab || 'all';
        var filterQ = String(ui.filter || '').trim();
        var channels = (ltv && Array.isArray(ltv.channels)) ? ltv.channels : [];
        var onNow = (ltv && Array.isArray(ltv.onNow)) ? ltv.onNow : [];
        var recordings = (ltv && Array.isArray(ltv.recordings)) ? ltv.recordings : [];
        var favChannels = channels.filter(function (c) { return c && c.UserData && c.UserData.IsFavorite; });

        if (!ltv || (ltv.loading && !ltv.loaded)) {
            return '<div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Tuning Live TV channels…</span></div>';
        }
        if (ltv.forbidden) {
            return buildEmptyStateHtml('lock', 'Live TV access is disabled for this profile', 'An administrator can grant Live TV access for this Jellyfin user in Dashboard → Users.');
        }
        if (channels.length === 0 && recordings.length === 0) {
            var isAdminProf = typeof isActiveProfileAdmin === 'function' && isActiveProfileAdmin();
            return '<div class="bfx-ltv-empty-wrap">'
                + buildEmptyStateHtml('tv', 'No Live TV channels configured yet', 'Connect an HDHomeRun, M3U IPTV playlist, or TV tuner in Jellyfin Dashboard → Live TV to watch live channels here.')
                + (isAdminProf
                    ? '<div class="bfx-ltv-empty-actions"><button type="button" class="streamflix-btn-primary" data-ltv-admin-setup="1">' + iconLabel('gear', 'Open Live TV Setup') + '</button></div>'
                    : '')
                + '</div>';
        }

        if (tab === 'guide') {
            return buildLiveTvEpgGridHtml(channels, filterQ);
        }

        if (tab === 'recordings') {
            var filteredRecs = filterQ
                ? recordings.filter(function (r) { return r && String(r.Name || '').toLowerCase().indexOf(filterQ.toLowerCase()) !== -1; })
                : recordings;
            if (!filteredRecs.length) {
                return buildEmptyStateHtml('film', filterQ ? ('No recordings matching “' + filterQ + '”') : 'No DVR recordings yet', 'Schedule single or series recordings from the TV Guide.');
            }
            return '<div class="bfx-ltv-grid">' + filteredRecs.map(function (r) { return buildLiveTvCardHtml(r, 'recording'); }).join('') + '</div>';
        }

        if (tab === 'onnow') {
            var airingPool = onNow.length > 0
                ? onNow
                : channels.filter(function (c) { return c && c.CurrentProgram && c.CurrentProgram.Name; });
            var filteredOnNow = filterQ
                ? airingPool.filter(function (p) {
                    var nm = String(p.Name || '').toLowerCase();
                    var cn = String(p.ChannelName || '').toLowerCase();
                    var cp = (p.CurrentProgram && p.CurrentProgram.Name) ? String(p.CurrentProgram.Name).toLowerCase() : '';
                    return nm.indexOf(filterQ.toLowerCase()) !== -1 || cn.indexOf(filterQ.toLowerCase()) !== -1 || cp.indexOf(filterQ.toLowerCase()) !== -1;
                })
                : airingPool;
            if (!filteredOnNow.length) {
                return buildEmptyStateHtml('tv', filterQ ? ('Nothing airing matching “' + filterQ + '”') : 'No EPG program guide data airing right now', 'Switch to All Channels to tune into any channel directly.');
            }
            var useProgMode = onNow.length > 0;
            return '<div class="bfx-ltv-grid">' + filteredOnNow.map(function (it) { return buildLiveTvCardHtml(it, useProgMode ? 'program' : 'channel'); }).join('') + '</div>';
        }

        if (tab === 'favorites') {
            var filteredFavs = getFilteredLiveTvChannels(favChannels, filterQ);
            if (!filteredFavs.length) {
                return buildEmptyStateHtml('plus', filterQ ? ('No favorite channels matching “' + filterQ + '”') : 'No favorite channels yet', 'Click the + button on any channel to pin it to your Favorites.');
            }
            return '<div class="bfx-ltv-grid">' + filteredFavs.map(function (c) { return buildLiveTvCardHtml(c, 'channel'); }).join('') + '</div>';
        }

        var visibleChannels = getFilteredLiveTvChannels(channels, filterQ);
        if (!visibleChannels.length) {
            return buildEmptyStateHtml('search', 'No channels matching “' + filterQ + '”', 'Try searching by channel number, call sign, or airing show.');
        }

        var outHtml = '';
        if (!filterQ && favChannels.length > 0 && favChannels.length < channels.length) {
            outHtml += ''
                + '<div class="bfx-ltv-subblock">'
                + '  <h3 class="bfx-ltv-subtitle">Favorite Channels <span class="streamflix-row-count">' + favChannels.length + '</span></h3>'
                + '  <div class="bfx-ltv-grid">' + favChannels.map(function (c) { return buildLiveTvCardHtml(c, 'channel'); }).join('') + '</div>'
                + '</div>';
        }
        outHtml += ''
            + '<div class="bfx-ltv-subblock">'
            + (favChannels.length > 0 && !filterQ ? ('  <h3 class="bfx-ltv-subtitle">All Channels <span class="streamflix-row-count">' + visibleChannels.length + '</span></h3>') : '')
            + '  <div class="bfx-ltv-grid">' + visibleChannels.map(function (c) { return buildLiveTvCardHtml(c, 'channel'); }).join('') + '</div>'
            + '</div>';
        return outHtml;
    }

    function buildLiveTvHubHtml() {
        var ltv = ensureLiveTvHubDataLoaded(false);
        if (!state.liveTvUi) {
            state.liveTvUi = { tab: 'all', filter: '' };
        }
        var channels = (ltv && Array.isArray(ltv.channels)) ? ltv.channels : [];
        var onNow = (ltv && Array.isArray(ltv.onNow)) ? ltv.onNow : [];
        var recordings = (ltv && Array.isArray(ltv.recordings)) ? ltv.recordings : [];
        var favCount = channels.filter(function (c) { return c && c.UserData && c.UserData.IsFavorite; }).length;
        var airingCount = onNow.length || channels.filter(function (c) { return c && c.CurrentProgram && c.CurrentProgram.Name; }).length;

        var tabs = [
            { id: 'all', label: 'All Channels', count: channels.length, show: true },
            { id: 'onnow', label: 'On Now', count: airingCount, show: airingCount > 0 || state.liveTvUi.tab === 'onnow' },
            { id: 'guide', label: 'TV Guide', count: 0, show: channels.length > 0 || state.liveTvUi.tab === 'guide' },
            { id: 'favorites', label: 'Favorites', count: favCount, show: favCount > 0 || state.liveTvUi.tab === 'favorites' },
            { id: 'recordings', label: 'Recordings', count: recordings.length, show: recordings.length > 0 || state.liveTvUi.tab === 'recordings' }
        ];
        if (!tabs.some(function (t) { return t.id === state.liveTvUi.tab && t.show; })) {
            state.liveTvUi.tab = 'all';
        }

        var tabsHtml = tabs.filter(function (t) { return t.show; }).map(function (t) {
            var active = state.liveTvUi.tab === t.id;
            return '<button type="button" class="streamflix-pill' + (active ? ' active' : '') + '" data-ltv-tab="' + t.id + '">'
                + escapeHtml(t.label)
                + (t.count > 0 ? (' <span class="bfx-sp-pill-cnt">' + t.count + '</span>') : '')
                + '</button>';
        }).join('');

        var filterVal = state.liveTvUi.filter || '';
        return ''
            + '<section class="streamflix-row streamflix-row-grid bfx-ltv-hub" data-row-id="livetv-hub">'
            + '  <div class="bfx-ltv-header">'
            + '    <div class="bfx-ltv-head-left">'
            + '      <div class="bfx-ltv-title-row">'
            + '        <span class="bfx-ltv-live-pill is-lg"><span class="bfx-ltv-live-dot"></span>LIVE TV</span>'
            + '        <h2 class="streamflix-row-title">Channels &amp; Broadcasts' + (channels.length > 0 ? ('<span class="streamflix-row-count">' + channels.length + '</span>') : '') + '</h2>'
            + '      </div>'
            + '      <div class="streamflix-FilterPills bfx-ltv-subpills" role="tablist" aria-label="Live TV views">' + tabsHtml + '</div>'
            + '    </div>'
            + '    <div class="bfx-ltv-head-right">'
            + (channels.length > 0 || recordings.length > 0
                ? ('      <div class="streamflix-search-box bfx-ltv-filter-box' + (filterVal ? ' has-value' : '') + '">'
                    + '        <span class="streamflix-search-icon">' + icon('search') + '</span>'
                    + '        <input type="search" id="bfx-ltv-filter-input" class="streamflix-search-input" placeholder="Channel, # or show…" autocomplete="off" spellcheck="false" aria-label="Filter Live TV channels" value="' + escapeHtml(filterVal) + '" />'
                    + '        <button type="button" id="bfx-ltv-filter-clear" class="streamflix-search-clear' + (filterVal ? ' is-visible' : '') + '" title="Clear filter" aria-label="Clear filter">' + icon('close') + '</button>'
                    + '      </div>')
                : '')
            + '      <div class="bfx-ltv-guide-btns">'
            + '        <button type="button" class="streamflix-ghost-btn bfx-ltv-guide-btn" data-ltv-route="#/livetv?tab=1" title="Open Jellyfin Full Multi-Day EPG Guide">' + icon('calendar') + '<span>Full EPG</span></button>'
            + '        <button type="button" class="streamflix-ghost-btn bfx-ltv-guide-btn" data-ltv-route="#/livetv?tab=4" title="Open DVR Schedule &amp; Timers">' + icon('clock') + '<span>Schedule</span></button>'
            + '        <button type="button" class="streamflix-ghost-btn bfx-ltv-refresh-btn" data-ltv-refresh="1" title="Refresh Live TV program guide" aria-label="Refresh Live TV">' + icon('refresh') + '</button>'
            + '      </div>'
            + '    </div>'
            + '  </div>'
            + '  <div id="bfx-ltv-content-slot">' + buildLiveTvContentSlotHtml(ltv) + '</div>'
            + '</section>';
    }

    function bindLiveTvHubInteractive(rowsScope) {
        if (!rowsScope) {
            return;
        }
        var hubSec = rowsScope.querySelector('.bfx-ltv-hub');
        if (!hubSec) {
            return;
        }
        Array.prototype.forEach.call(hubSec.querySelectorAll('[data-ltv-tab]'), function (btn) {
            if (btn.__bfxBound) { return; }
            btn.__bfxBound = true;
            btn.addEventListener('click', function () {
                if (!state.liveTvUi) { state.liveTvUi = { tab: 'all', filter: '' }; }
                state.liveTvUi.tab = btn.getAttribute('data-ltv-tab') || 'all';
                renderCinemaHubContents();
            });
        });

        Array.prototype.forEach.call(hubSec.querySelectorAll('[data-ltv-route]'), function (btn) {
            if (btn.__bfxBound) { return; }
            btn.__bfxBound = true;
            btn.addEventListener('click', function () {
                var baseHash = btn.getAttribute('data-ltv-route') || '#/livetv?tab=1';
                var sid = resolveKnownServerId();
                window.location.hash = baseHash + (sid ? ('&serverId=' + encodeURIComponent(sid)) : '');
            });
        });

        var refreshBtn = hubSec.querySelector('[data-ltv-refresh]');
        if (refreshBtn && !refreshBtn.__bfxBound) {
            refreshBtn.__bfxBound = true;
            refreshBtn.addEventListener('click', function () {
                ensureLiveTvHubDataLoaded(true);
                if (state.liveTvUi && state.liveTvUi.tab === 'guide') {
                    ensureLiveTvEpgLoaded(true);
                }
                renderCinemaHubContents();
            });
        }

        var bindSlotExtra = function (slotEl) {
            if (!slotEl) { return; }
            var setupBtn = slotEl.querySelector('[data-ltv-admin-setup]');
            if (setupBtn && !setupBtn.__bfxBound) {
                setupBtn.__bfxBound = true;
                setupBtn.addEventListener('click', function () {
                    if (typeof openStreamFlixAdminRoute === 'function') {
                        openStreamFlixAdminRoute('#/dashboard/livetv');
                    } else {
                        window.location.hash = '#/dashboard/livetv';
                    }
                });
            }
            Array.prototype.forEach.call(slotEl.querySelectorAll('[data-epg-step]'), function (sBtn) {
                if (sBtn.__bfxBound) { return; }
                sBtn.__bfxBound = true;
                sBtn.addEventListener('click', function () {
                    if (!state.liveTvUi) { state.liveTvUi = { tab: 'guide', filter: '', epgOffsetMins: 0 }; }
                    var delta = parseInt(sBtn.getAttribute('data-epg-step'), 10) || 0;
                    var nextOff = Math.max(-720, Math.min(2880, (Number(state.liveTvUi.epgOffsetMins) || 0) + delta));
                    state.liveTvUi.epgOffsetMins = nextOff;
                    renderCinemaHubContents();
                });
            });
            var nowBtn = slotEl.querySelector('[data-epg-now]');
            if (nowBtn && !nowBtn.__bfxBound) {
                nowBtn.__bfxBound = true;
                nowBtn.addEventListener('click', function () {
                    if (!state.liveTvUi) { state.liveTvUi = { tab: 'guide', filter: '', epgOffsetMins: 0 }; }
                    state.liveTvUi.epgOffsetMins = 0;
                    renderCinemaHubContents();
                });
            }
            Array.prototype.forEach.call(slotEl.querySelectorAll('[data-epg-tune-ch]'), function (chEl) {
                if (chEl.__bfxBound) { return; }
                chEl.__bfxBound = true;
                var tuneNow = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    var cid = chEl.getAttribute('data-epg-tune-ch');
                    var chItem = findCachedItemById(cid) || { Id: cid, Type: 'TvChannel' };
                    navigateOrPlayItem(chItem);
                };
                chEl.addEventListener('click', tuneNow);
                chEl.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        tuneNow(ev);
                    }
                });
            });
        };

        var slotEl = hubSec.querySelector('#bfx-ltv-content-slot');
        bindSlotExtra(slotEl);

        var filterInput = hubSec.querySelector('#bfx-ltv-filter-input');
        var filterClear = hubSec.querySelector('#bfx-ltv-filter-clear');
        var filterBox = hubSec.querySelector('.bfx-ltv-filter-box');
        var refreshFilterSlotInPlace = function () {
            var val = filterInput ? filterInput.value : '';
            if (!state.liveTvUi) { state.liveTvUi = { tab: 'all', filter: '' }; }
            state.liveTvUi.filter = val;
            if (filterBox) { filterBox.classList.toggle('has-value', Boolean(val)); }
            if (filterClear) { filterClear.classList.toggle('is-visible', Boolean(val)); }
            var curSlot = hubSec.querySelector('#bfx-ltv-content-slot');
            if (curSlot) {
                curSlot.innerHTML = buildLiveTvContentSlotHtml(state.liveTvData);
                bindSlotExtra(curSlot);
                bindInteractiveCardsInContainer(curSlot, null, null);
            }
        };
        if (filterInput && !filterInput.__bfxBound) {
            filterInput.__bfxBound = true;
            filterInput.addEventListener('input', refreshFilterSlotInPlace);
            filterInput.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape' && filterInput.value) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    filterInput.value = '';
                    refreshFilterSlotInPlace();
                }
            });
        }
        if (filterClear && !filterClear.__bfxBound) {
            filterClear.__bfxBound = true;
            filterClear.addEventListener('click', function () {
                if (filterInput) {
                    filterInput.value = '';
                    try { filterInput.focus(); } catch (eF) {}
                }
                refreshFilterSlotInPlace();
            });
        }
    }

    function renderCinemaHubContents() {
        var hub = document.getElementById('streamflix-cinema-hub');
        if (!hub) {
            return;
        }

        var d = state.hubData;
        var profileName = (state.activeProfile && state.activeProfile.name) || 'You';
        var cat = state.activeCategory || 'all';
        var searchPageOn = typeof isSearchPageActive === 'function'
            ? isSearchPageActive()
            : Boolean(state.mobileSearchOpen || state.searchQuery);
        var bf = (!searchPageOn && state.browseFilter) ? state.browseFilter : null;
        var lb = (!searchPageOn && !bf && state.libraryBrowser && state.libraryBrowser.active) ? state.libraryBrowser : null;
        if (!lb) {
            disconnectLibraryBrowserObserver();
        }

        document.body.classList.toggle('bfx-search-page-open', searchPageOn);
        if (searchPageOn) {
            document.body.classList.add('streamflix-hub-filtered', 'streamflix-hub-active');
            hub.classList.remove('streamflix-has-hero');
            hub.style.removeProperty('--bfx-ambient');
            syncHeroBleed(hub);
            state.heroCatKey = null;

            var existingPage = document.getElementById('streamflix-search-page');
            if (existingPage && hub.contains(existingPage)) {
                var spIn = document.getElementById('streamflix-search-page-input');
                if (spIn && document.activeElement !== spIn && spIn.value !== (state.searchQuery || '')) {
                    spIn.value = state.searchQuery || '';
                }
                var hasValNow = Boolean(state.searchQuery && String(state.searchQuery).length > 0);
                var isBusyNow = Boolean(state.searchLocalLoading || state.seerrSearchLoading);
                var spBar = existingPage.querySelector('.bfx-sp-bar');
                if (spBar) { spBar.classList.toggle('has-value', hasValNow); }
                var spSpin = document.getElementById('bfx-sp-spinner');
                if (spSpin) { spSpin.classList.toggle('is-visible', isBusyNow); }
                var spClr = document.getElementById('bfx-sp-clear-btn');
                if (spClr) { spClr.classList.toggle('is-visible', hasValNow); }
                var spTabs = document.getElementById('streamflix-search-page-tabs');
                if (spTabs) { spTabs.innerHTML = buildSearchPageTabsHtml(); }
                var spBody = document.getElementById('streamflix-search-page-body');
                if (spBody) { spBody.innerHTML = buildSearchPageBodyHtml(); }
                bindSearchPageInteractive(existingPage);
                syncMobileDockState();
                return;
            }

            hub.innerHTML = buildSearchPageShellHtml();
            if (!hub.classList.contains('streamflix-hub-ready')) {
                hub.classList.add('streamflix-hub-ready');
            }
            var mountedPage = document.getElementById('streamflix-search-page');
            var mountedInput = document.getElementById('streamflix-search-page-input');
            var mountedBar = mountedPage ? mountedPage.querySelector('.bfx-sp-bar') : null;
            var backBtn = document.getElementById('bfx-sp-back-btn');
            var clrBtn = document.getElementById('bfx-sp-clear-btn');

            if (mountedBar && mountedInput) {
                mountedBar.addEventListener('click', function (ev) {
                    if (ev.target && ev.target.closest && ev.target.closest('#bfx-sp-clear-btn')) {
                        return;
                    }
                    if (document.activeElement !== mountedInput) {
                        try { mountedInput.focus(); } catch (eBarF) {}
                    }
                });
            }
            if (backBtn) {
                backBtn.addEventListener('click', function () {
                    closeSearchPage();
                });
            }
            if (clrBtn) {
                clrBtn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    cancelPendingSearch();
                    state.searchQuery = '';
                    state.searchTypeFilter = 'all';
                    state.searchResults = null;
                    state.searchPeopleResults = null;
                    state.seerrSearchResults = null;
                    if (mountedInput) {
                        mountedInput.value = '';
                        try { mountedInput.focus(); } catch (eF) {}
                    }
                    renderCinemaHubContents();
                });
            }
            if (mountedInput) {
                mountedInput.addEventListener('focus', function () {
                    if (document.body) {
                        document.body.classList.add('bfx-mobile-search-focused');
                    }
                    syncMobileDockState();
                });
                mountedInput.addEventListener('blur', function () {
                    if (document.body) {
                        document.body.classList.remove('bfx-mobile-search-focused');
                    }
                    syncMobileDockState();
                });
                mountedInput.addEventListener('input', function () {
                    state.searchQuery = mountedInput.value;
                    state.searchGenreFilter = '';
                    if (state.searchDebounce) {
                        clearTimeout(state.searchDebounce);
                        state.searchDebounce = null;
                    }
                    previewInstantLocalSearch(state.searchQuery);
                    if ((state.searchQuery || '').trim()) {
                        state.searchDebounce = setTimeout(function () {
                            runLiveSearch(state.searchQuery);
                        }, 150);
                    }
                });
                mountedInput.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        closeSearchPage();
                    } else if (ev.key === 'Enter') {
                        var qTrim = String(mountedInput.value || '').trim();
                        if (qTrim.length >= 2) {
                            saveRecentSearch(qTrim);
                            if (state.searchDebounce) {
                                clearTimeout(state.searchDebounce);
                                state.searchDebounce = null;
                            }
                            runLiveSearch(qTrim);
                        }
                        if (document.body && document.body.classList.contains('bfx-phone-mode')) {
                            try { mountedInput.blur(); } catch (eBlur) {}
                        }
                    }
                });
                if (!document.querySelector('.streamflix-modal-backdrop') && !isGateOpen()) {
                    try {
                        mountedInput.focus();
                        var endPos = mountedInput.value ? mountedInput.value.length : 0;
                        if (mountedInput.setSelectionRange) {
                            mountedInput.setSelectionRange(endPos, endPos);
                        }
                    } catch (eInitFoc) {}
                }
            }
            bindSearchPageInteractive(mountedPage);
            syncMobileDockState();
            return;
        }

        document.body.classList.toggle('streamflix-hub-filtered', Boolean(state.searchQuery) || Boolean(bf) || Boolean(lb) || cat !== 'all');

        if (cat === 'livetv' && !(typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile())) {
            cat = 'all';
            state.activeCategory = 'all';
        }
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
        } else if (cat === 'livetv') {
            rowsHtml += buildLiveTvHubHtml();
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
            var hotTab = state.hotSubTab || 'all';
            if (hotTab !== 'all' && hotTab !== 'trending' && hotTab !== 'comingsoon' && hotTab !== 'new') {
                hotTab = 'all';
                state.hotSubTab = 'all';
            }
            var sevenDaysAgo = Date.now() - (7 * 24 * 3600 * 1000);
            var addedThisWeek = dedupeMediaItems([].concat(d.recentMovies || [], d.recentSeries || [])).filter(function (it) {
                var c = it && it.DateCreated ? Date.parse(it.DateCreated) : 0;
                return c >= sevenDaysAgo;
            }).slice(0, 20);
            var upcomingCount = (Array.isArray(hotEx.upcomingEpisodes) ? hotEx.upcomingEpisodes.length : 0)
                + (Array.isArray(hotEx.seerrComingSoon) ? hotEx.seerrComingSoon.length : 0);
            var justAddedCount = (d.recentMovies ? d.recentMovies.length : 0) + (d.recentSeries ? d.recentSeries.length : 0);
            var hotSubTabs = [
                { id: 'all', label: 'All', count: 0 },
                { id: 'trending', label: 'Trending', count: d.top10Items ? d.top10Items.length : 0 },
                { id: 'comingsoon', label: 'Coming Soon', count: upcomingCount },
                { id: 'new', label: 'Just Added', count: justAddedCount }
            ];
            var hotHeaderHtml = ''
                + '<section class="streamflix-row bfx-hot-header-sec" data-row-id="hot-subnav">'
                + '  <div class="bfx-ltv-header">'
                + '    <div class="bfx-ltv-head-left">'
                + '      <div class="bfx-ltv-title-row">'
                + '        <span class="bfx-ltv-live-pill is-lg bfx-hot-pill">' + icon('flame') + '<span>NEW &amp; POPULAR</span></span>'
                + '        <h2 class="streamflix-row-title">Trending, Coming Soon &amp; Fresh Arrivals</h2>'
                + '      </div>'
                + '      <div class="streamflix-FilterPills bfx-ltv-subpills" role="tablist" aria-label="New &amp; Popular views">'
                + hotSubTabs.map(function (ht) {
                    var isAct = hotTab === ht.id;
                    return '<button type="button" class="streamflix-pill' + (isAct ? ' active' : '') + '" data-hot-subtab="' + ht.id + '">'
                        + escapeHtml(ht.label)
                        + (ht.count > 0 ? (' <span class="bfx-sp-pill-cnt">' + ht.count + '</span>') : '')
                        + '</button>';
                }).join('')
                + '      </div>'
                + '    </div>'
                + '  </div>'
                + '</section>';
            rowsHtml += hotHeaderHtml;

            if (hotTab === 'comingsoon') {
                var sortedUpcoming = (Array.isArray(hotEx.upcomingEpisodes) ? hotEx.upcomingEpisodes.slice() : []).sort(function (a, b) {
                    return (Date.parse(a.PremiereDate || '') || Number.MAX_SAFE_INTEGER) - (Date.parse(b.PremiereDate || '') || Number.MAX_SAFE_INTEGER);
                });
                if (sortedUpcoming.length > 0) {
                    rowsHtml += buildRowHtml('hot-upcoming', rowTitle('Upcoming TV Episodes', sortedUpcoming.length), sortedUpcoming.map(buildUpcomingEpisodeWideCardHtml).join(''), { className: 'streamflix-row-wide' });
                }
                if (Array.isArray(hotEx.seerrComingSoon) && hotEx.seerrComingSoon.length > 0) {
                    rowsHtml += buildRowHtml('hot-seerr-soon', rowTitle('Coming Soon · Requested via Seerr', hotEx.seerrComingSoon.length), hotEx.seerrComingSoon.map(buildSeerrCardHtml).join(''));
                }
                if (sortedUpcoming.length === 0 && (!Array.isArray(hotEx.seerrComingSoon) || hotEx.seerrComingSoon.length === 0)) {
                    rowsHtml += hotEx.loading
                        ? '<div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Checking upcoming releases…</span></div>'
                        : buildEmptyStateHtml('calendar', 'No scheduled upcoming airings right now', 'Upcoming episodes for ongoing series in your library (and requested Seerr titles) appear here automatically.');
                }
            } else if (hotTab === 'trending') {
                if (d.top10Items.length > 0) {
                    rowsHtml += buildRowHtml('top10', rowTitle(getTop10RowTitle()), top10Cards(), { className: 'streamflix-row-top10' });
                }
                rowsHtml += smartRowsHtml(['smart-acclaimed', 'smart-gems', 'smart-binge']);
            } else if (hotTab === 'new') {
                if (addedThisWeek.length > 0) {
                    rowsHtml += buildRowHtml('hot-week', rowTitle('Added in the Last 7 Days', addedThisWeek.length), addedThisWeek.map(buildPosterCardHtml).join(''));
                }
                if (d.recentMovies.length > 0) {
                    rowsHtml += buildRowHtml('hot-movies', rowTitle('New Movies on ' + getBrandName()), d.recentMovies.map(buildPosterCardHtml).join(''));
                }
                if (d.recentSeries.length > 0) {
                    rowsHtml += buildRowHtml('hot-series', rowTitle('New Episodes & Series'), d.recentSeries.map(buildPosterCardHtml).join(''));
                }
            } else {
                if (d.top10Items.length > 0) {
                    rowsHtml += buildRowHtml('top10', rowTitle(getTop10RowTitle()), top10Cards(), { className: 'streamflix-row-top10' });
                }
                if (Array.isArray(hotEx.upcomingEpisodes) && hotEx.upcomingEpisodes.length > 0) {
                    rowsHtml += buildRowHtml('hot-upcoming', rowTitle('Coming Soon · Upcoming Episodes', hotEx.upcomingEpisodes.length), hotEx.upcomingEpisodes.map(buildUpcomingEpisodeWideCardHtml).join(''), { className: 'streamflix-row-wide' });
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
            }
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
            var rowPlan = getEffectiveHomeRowPlan();
            var pr = getPersonalRows() || { topPicks: [], because: [], watchAgain: [] };
            var becauseRow = function (b, idx) {
                return b ? buildRowHtml('because-' + idx, 'Because you watched <span class="bfx-row-em">' + escapeHtml(b.seed.name) + '</span>', b.items.map(buildPosterCardHtml).join(''), { className: 'streamflix-row-personal' }) : '';
            };
            var homeRowBuilders = {
                resume: function () {
                    return d.resumeItems.length > 0
                        ? buildRowHtml('resume', rowTitle('Continue Watching for ' + profileName), d.resumeItems.map(function (it) { return buildWideCardHtml(it, { removable: true }); }).join(''), { className: 'streamflix-row-wide' })
                        : '';
                },
                nextup: function () {
                    return d.nextUpItems.length > 0
                        ? buildRowHtml('nextup', rowTitle('Next Up'), d.nextUpItems.map(buildWideCardHtml).join(''), { className: 'streamflix-row-wide', link: 'series' })
                        : '';
                },
                livetv: function () {
                    if (!(typeof isLiveTvEnabledForCurrentProfile === 'function' && isLiveTvEnabledForCurrentProfile()
                        && !isNavBuiltInHidden('livetv')
                        && state.liveTvData && state.liveTvData.loaded && Array.isArray(state.liveTvData.channels) && state.liveTvData.channels.length > 0)) {
                        return '';
                    }
                    var homeLtvPool = state.liveTvData.channels.filter(function (c) { return c && c.UserData && c.UserData.IsFavorite; });
                    if (homeLtvPool.length < 16) {
                        var seenLtv = {};
                        homeLtvPool.forEach(function (c) { seenLtv[normalizeGuid(c.Id)] = true; });
                        state.liveTvData.channels.forEach(function (c) {
                            if (homeLtvPool.length < 16 && c && !seenLtv[normalizeGuid(c.Id)]) {
                                seenLtv[normalizeGuid(c.Id)] = true;
                                homeLtvPool.push(c);
                            }
                        });
                    }
                    return homeLtvPool.length > 0
                        ? buildRowHtml('livetv-home', rowTitle('Live TV · On Now'), homeLtvPool.slice(0, 16).map(function (c) { return buildLiveTvCardHtml(c, 'channel'); }).join(''), { className: 'streamflix-row-wide bfx-row-livetv', link: 'livetv' })
                        : '';
                },
                personal: function () {
                    var pOut = '';
                    if (pr.topPicks.length > 0) {
                        pOut += buildRowHtml('toppicks', 'Top Picks for ' + escapeHtml(profileName), pr.topPicks.map(buildPosterCardHtml).join(''), { className: 'streamflix-row-personal' });
                    }
                    pOut += becauseRow(pr.because[0], 0);
                    if (!rowPlan.isDefaultOrder) {
                        pOut += becauseRow(pr.because[1], 1);
                    }
                    return pOut;
                },
                top10: function () {
                    return d.top10Items.length > 0
                        ? buildRowHtml('top10', rowTitle(getTop10RowTitle()), top10Cards(), { className: 'streamflix-row-top10', link: 'top10' })
                        : '';
                },
                mylist: function () {
                    return d.favoriteItems.length > 0
                        ? buildRowHtml('mylist', rowTitle('My List'), d.favoriteItems.map(buildPosterCardHtml).join(''), { link: 'mylist' })
                        : '';
                },
                acclaimed: function () {
                    return smartRowsHtml(['smart-acclaimed']);
                },
                movies: function () {
                    var mOut = d.recentMovies.length > 0
                        ? buildRowHtml('movies', rowTitle('New Movies'), d.recentMovies.map(buildPosterCardHtml).join(''), { link: 'movies' })
                        : '';
                    if (rowPlan.isDefaultOrder && !rowPlan.hiddenMap.personal) {
                        mOut += becauseRow(pr.because[1], 1);
                    }
                    return mOut;
                },
                series: function () {
                    return d.recentSeries.length > 0
                        ? buildRowHtml('series', rowTitle('New Shows'), d.recentSeries.map(buildPosterCardHtml).join(''), { link: 'series' })
                        : '';
                },
                gems: function () {
                    return smartRowsHtml(['smart-gems']);
                },
                collections: function () {
                    return d.collectionsItems.length > 0
                        ? buildRowHtml('collections', rowTitle('Collections'), d.collectionsItems.map(buildPosterCardHtml).join(''), { link: 'collections' })
                        : '';
                },
                watchagain: function () {
                    return pr.watchAgain.length > 0
                        ? buildRowHtml('watchagain', rowTitle('Watch It Again'), pr.watchAgain.map(buildPosterCardHtml).join(''))
                        : '';
                }
            };

            rowPlan.order.forEach(function (rowId) {
                if (!rowPlan.hiddenMap[rowId] && typeof homeRowBuilders[rowId] === 'function') {
                    rowsHtml += homeRowBuilders[rowId]();
                }
            });
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
            bindLiveTvHubInteractive(rowsScope);
            Array.prototype.forEach.call(rowsScope.querySelectorAll('[data-hot-subtab]'), function (hBtn) {
                if (hBtn.__bfxBound) { return; }
                hBtn.__bfxBound = true;
                hBtn.addEventListener('click', function () {
                    state.hotSubTab = hBtn.getAttribute('data-hot-subtab') || 'all';
                    renderCinemaHubContents();
                });
            });
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
                if (document.body && document.body.classList.contains('bfx-phone-mode')) {
                    ev.preventDefault();
                    openSearchPage('', true);
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
                if (document.body && document.body.classList.contains('bfx-phone-mode')) {
                    openSearchPage('', true);
                    return;
                }
                if (subnavEl) {
                    subnavEl.classList.add('is-search-open');
                }
                syncMobileDockState();
            });
            searchInput.addEventListener('blur', function () {
                if (subnavEl && !searchInput.value && !state.mobileSearchOpen) {
                    subnavEl.classList.remove('is-search-open');
                }
                syncMobileDockState();
            });
        }
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                var val = searchInput.value;
                state.searchQuery = val;
                if (state.searchDebounce) {
                    clearTimeout(state.searchDebounce);
                    state.searchDebounce = null;
                }
                if ((val || '').trim()) {
                    state.mobileSearchOpen = true;
                    previewInstantLocalSearch(val);
                    state.searchDebounce = setTimeout(function () {
                        runLiveSearch(state.searchQuery);
                    }, 150);
                } else {
                    previewInstantLocalSearch('');
                }
            });
            searchInput.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape' && (state.searchQuery || state.mobileSearchOpen)) {
                    ev.preventDefault();
                    closeSearchPage();
                }
            });
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
                    var ytFrame = hero.querySelector('iframe.bfx-hero-yt-iframe');
                    if (ytFrame) {
                        if (state.heroPreviewMuted) {
                            sendCommandToYouTubeRelay(ytFrame, 'mute', []);
                        } else {
                            sendCommandToYouTubeRelay(ytFrame, 'unMute', []);
                            sendCommandToYouTubeRelay(ytFrame, 'setVolume', [100]);
                        }
                    }
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
            state.heroTrailerAttemptedSlide = '';
            scheduleHeroVideoPreview(item);
        } else if (!state.heroVideoActive && !heroPreviewTimer && state.heroTrailerAttemptedSlide !== item.Id && canAutoplayHeroVideoPreview()) {
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
            if (heroHardPaused() && (state.heroVideoActive || heroPreviewTimer)) {
                stopHeroVideoPreview(false);
            } else if (!heroHardPaused() && !state.heroVideoActive && !heroPreviewTimer && curHero.length > 0) {
                var activeSlideItem = curHero[state.heroIndex % curHero.length];
                if (activeSlideItem && activeSlideItem.Id && state.heroTrailerAttemptedSlide !== activeSlideItem.Id && canAutoplayHeroVideoPreview()) {
                    scheduleHeroVideoPreview(activeSlideItem);
                }
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

    var HERO_PREVIEW_MAX_PLAY_MS = 3000;
    var heroPreviewTimer = null;
    var heroYtWatchdogTimer = null;
    var heroPlayCapTimer = null;
    var heroFadeOutTimer = null;
    var activeHeroYtIframe = null;
    var heroYtMessageBound = false;

    function extractYouTubeVideoIdClient(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') {
            return '';
        }
        var trimmed = rawUrl.trim();
        if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
            return trimmed;
        }
        try {
            var u = new URL(trimmed);
            var host = String(u.hostname || '').toLowerCase().replace(/^(www\.|m\.)/, '');
            var cand = '';
            if (host === 'youtu.be') {
                cand = String(u.pathname || '').replace(/^\/+/, '').split('/')[0] || '';
            } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
                var p = String(u.pathname || '').replace(/^\/+/, '');
                if (p.toLowerCase() === 'watch') {
                    cand = u.searchParams.get('v') || '';
                } else {
                    var segs = p.split('/');
                    if (segs.length >= 2 && /^(embed|v|shorts|live)$/i.test(segs[0])) {
                        cand = segs[1] || '';
                    }
                }
            }
            return /^[A-Za-z0-9_-]{11}$/.test(cand) ? cand : '';
        } catch (eUrl) {
            return '';
        }
    }

    function extractClientRemoteYouTubeId(item) {
        if (!item || !Array.isArray(item.RemoteTrailers)) {
            return '';
        }
        for (var i = 0; i < item.RemoteTrailers.length; i++) {
            var rt = item.RemoteTrailers[i];
            var vid = extractYouTubeVideoIdClient(rt && (rt.Url || rt.url));
            if (vid) {
                return vid;
            }
        }
        return '';
    }

    function buildYouTubeRelaySrc(youtubeId, opts) {
        opts = opts || {};
        var startSec = Number(opts.startSeconds) > 0 ? Math.floor(Number(opts.startSeconds)) : 0;
        return apiBase() + '/StreamFlix/Trailers/Embed/' + encodeURIComponent(youtubeId)
            + '?autoplay=' + (opts.autoplay === false ? '0' : '1')
            + '&mute=' + (opts.mute === false ? '0' : '1')
            + '&controls=' + (opts.controls ? '1' : '0')
            + (opts.loop ? '&loop=1' : '')
            + (startSec > 0 ? ('&start=' + startSec) : '');
    }

    function sendCommandToYouTubeRelay(iframeEl, cmd, args) {
        if (!iframeEl || !iframeEl.contentWindow) {
            return;
        }
        try {
            iframeEl.contentWindow.postMessage({
                target: 'streamflix-yt',
                cmd: cmd,
                args: Array.isArray(args) ? args : []
            }, '*');
        } catch (ePost) {}
    }

    function resolveItemTrailerDescriptor(item) {
        if (!item || !item.Id) {
            return Promise.resolve(null);
        }
        var lookupId = (item.Type === 'Episode' && item.SeriesId && (!item.RemoteTrailers || !item.RemoteTrailers.length))
            ? item.SeriesId
            : item.Id;
        var normKey = normalizeGuid(lookupId);
        if (!state.heroTrailerCache) {
            state.heroTrailerCache = {};
        }
        if (!state.heroTrailerInFlight) {
            state.heroTrailerInFlight = {};
        }
        if (state.heroTrailerCache.hasOwnProperty(normKey)) {
            return Promise.resolve(state.heroTrailerCache[normKey]);
        }
        if (state.heroTrailerInFlight[normKey]) {
            return state.heroTrailerInFlight[normKey];
        }

        var clientRemoteYt = extractClientRemoteYouTubeId(item);
        var p = apiFetch('/StreamFlix/Trailers/Resolve?itemId=' + encodeURIComponent(lookupId))
            .then(function (res) {
                var desc = null;
                if (res && res.ok && res.kind === 'youtube' && res.youtubeId && /^[A-Za-z0-9_-]{11}$/.test(res.youtubeId)) {
                    desc = { kind: 'youtube', youtubeId: res.youtubeId, title: res.title || '' };
                } else if (clientRemoteYt) {
                    desc = { kind: 'youtube', youtubeId: clientRemoteYt, title: item.Name || '' };
                } else if (res && res.ok && res.kind === 'local' && res.localTrailerId) {
                    desc = { kind: 'local', localTrailerId: res.localTrailerId, title: res.title || '' };
                }
                state.heroTrailerCache[normKey] = desc;
                delete state.heroTrailerInFlight[normKey];
                return desc;
            })
            .catch(function () {
                var fallback = clientRemoteYt ? { kind: 'youtube', youtubeId: clientRemoteYt, title: item.Name || '' } : null;
                state.heroTrailerCache[normKey] = fallback;
                delete state.heroTrailerInFlight[normKey];
                return fallback;
            });

        state.heroTrailerInFlight[normKey] = p;
        return p;
    }

    function scheduleHeroPreviewPlayCap(targetId) {
        if (heroPlayCapTimer || heroFadeOutTimer) {
            return;
        }
        heroPlayCapTimer = setTimeout(function () {
            heroPlayCapTimer = null;
            var curHero = document.getElementById('streamflix-hero-billboard');
            if (!curHero || curHero.getAttribute('data-hero-item') !== targetId) {
                stopHeroVideoPreview(true);
                return;
            }
            if (activeHeroYtIframe) {
                sendCommandToYouTubeRelay(activeHeroYtIframe, 'mute', []);
                var ytWrap = activeHeroYtIframe.parentNode;
                if (ytWrap && ytWrap.classList) {
                    ytWrap.classList.remove('is-playing');
                }
            }
            var vid = curHero.querySelector('video.bfx-hero-preview-video');
            if (vid) {
                vid.muted = true;
                vid.classList.remove('is-playing');
            }
            var muteBtn = document.getElementById('streamflix-hero-mute-btn');
            if (muteBtn) {
                muteBtn.classList.add('is-hidden');
            }
            heroFadeOutTimer = setTimeout(function () {
                heroFadeOutTimer = null;
                stopHeroVideoPreview(true);
                restartHeroTimer();
            }, 650);
        }, HERO_PREVIEW_MAX_PLAY_MS);
    }

    function ensureHeroYouTubeMessageListener() {
        if (heroYtMessageBound) {
            return;
        }
        heroYtMessageBound = true;
        window.addEventListener('message', function (ev) {
            var d = ev && ev.data;
            if (!d || d.source !== 'streamflix-yt' || !activeHeroYtIframe || ev.source !== activeHeroYtIframe.contentWindow) {
                return;
            }
            var curHero = document.getElementById('streamflix-hero-billboard');
            var targetId = activeHeroYtIframe.getAttribute('data-target-item') || '';
            if (!curHero || !targetId || curHero.getAttribute('data-hero-item') !== targetId || heroHardPaused()) {
                stopHeroVideoPreview(false);
                return;
            }
            if (d.event === 'state') {
                if (d.state === 1) {
                    if (heroYtWatchdogTimer) {
                        clearTimeout(heroYtWatchdogTimer);
                        heroYtWatchdogTimer = null;
                    }
                    state.heroVideoActive = true;
                    state.heroVideoItemId = targetId;
                    var wrap = activeHeroYtIframe.parentNode;
                    if (wrap && wrap.classList && !heroFadeOutTimer) {
                        wrap.classList.add('is-playing');
                    }
                    curHero.classList.add('is-video-playing');
                    var shouldMute = Boolean(state.heroPreviewMuted !== false);
                    if (!shouldMute && !heroFadeOutTimer) {
                        sendCommandToYouTubeRelay(activeHeroYtIframe, 'unMute', []);
                        sendCommandToYouTubeRelay(activeHeroYtIframe, 'setVolume', [100]);
                    }
                    var muteBtn = document.getElementById('streamflix-hero-mute-btn');
                    if (muteBtn && !heroFadeOutTimer) {
                        muteBtn.classList.remove('is-hidden');
                        muteBtn.innerHTML = icon(shouldMute ? 'volumeOff' : 'volume');
                        muteBtn.title = shouldMute ? 'Unmute preview' : 'Mute preview';
                        muteBtn.setAttribute('aria-label', muteBtn.title);
                    }
                    scheduleHeroPreviewPlayCap(targetId);
                } else if (d.state === 0) {
                    stopHeroVideoPreview(true);
                    restartHeroTimer();
                }
            } else if (d.event === 'error') {
                stopHeroVideoPreview(true);
            }
        });
    }

    function stopHeroVideoPreview(endedNaturally) {
        if (heroPreviewTimer) {
            clearTimeout(heroPreviewTimer);
            heroPreviewTimer = null;
        }
        if (heroYtWatchdogTimer) {
            clearTimeout(heroYtWatchdogTimer);
            heroYtWatchdogTimer = null;
        }
        if (heroPlayCapTimer) {
            clearTimeout(heroPlayCapTimer);
            heroPlayCapTimer = null;
        }
        if (heroFadeOutTimer) {
            clearTimeout(heroFadeOutTimer);
            heroFadeOutTimer = null;
        }
        if (!endedNaturally) {
            state.heroTrailerAttemptedSlide = '';
        }
        activeHeroYtIframe = null;
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
        var ytWraps = hero.querySelectorAll('.bfx-hero-yt-wrap');
        Array.prototype.forEach.call(ytWraps, function (w) {
            var ifr = w.querySelector('iframe');
            if (ifr) {
                try { ifr.src = 'about:blank'; } catch (eIfr) {}
            }
            if (w.parentNode) {
                w.parentNode.removeChild(w);
            }
        });
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
        if (!state.config || state.config.enableHeroTrailerPreview === false) {
            return false;
        }
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
            if (navigator.connection && (navigator.connection.saveData || /2g|3g/i.test(String(navigator.connection.effectiveType || '')))) {
                return false;
            }
        } catch (eConn) {}
        return true;
    }

    function scheduleHeroVideoPreview(item) {
        stopHeroVideoPreview(false);
        if (!item || !item.Id || !canAutoplayHeroVideoPreview()) {
            return;
        }
        if (item.Type === 'TvChannel' || item.Type === 'Program' || item.Type === 'BoxSet') {
            state.heroTrailerAttemptedSlide = item.Id;
            return;
        }
        var targetId = item.Id;
        state.heroTrailerAttemptedSlide = targetId;
        var descriptorPromise = resolveItemTrailerDescriptor(item);

        heroPreviewTimer = setTimeout(function () {
            heroPreviewTimer = null;
            if (!canAutoplayHeroVideoPreview()) {
                state.heroTrailerAttemptedSlide = '';
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

            descriptorPromise.then(function (desc) {
                if (!desc || !canAutoplayHeroVideoPreview()) {
                    return;
                }
                var curHero = document.getElementById('streamflix-hero-billboard');
                var bgStack = curHero && curHero.querySelector('.streamflix-hero-bg-stack');
                if (!curHero || !bgStack || curHero.getAttribute('data-hero-item') !== targetId) {
                    return;
                }

                if (desc.kind === 'youtube' && desc.youtubeId) {
                    ensureHeroYouTubeMessageListener();
                    var wrap = document.createElement('div');
                    wrap.className = 'bfx-hero-yt-wrap';
                    var ifr = document.createElement('iframe');
                    ifr.className = 'bfx-hero-yt-iframe';
                    ifr.setAttribute('data-target-item', targetId);
                    ifr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                    ifr.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
                    ifr.setAttribute('tabindex', '-1');
                    ifr.setAttribute('aria-hidden', 'true');
                    ifr.setAttribute('title', (desc.title || item.Name || 'Trailer') + ' Preview');
                    ifr.src = buildYouTubeRelaySrc(desc.youtubeId, { autoplay: true, mute: true, controls: false, startSeconds: 10 });
                    activeHeroYtIframe = ifr;
                    wrap.appendChild(ifr);
                    bgStack.appendChild(wrap);
                    heroYtWatchdogTimer = setTimeout(function () {
                        heroYtWatchdogTimer = null;
                        if (activeHeroYtIframe === ifr && !state.heroVideoActive) {
                            stopHeroVideoPreview(true);
                        }
                    }, 9500);
                    return;
                }

                if (desc.kind === 'local' && desc.localTrailerId) {
                    var streamUrl = apiBase() + '/Videos/' + encodeURIComponent(desc.localTrailerId) + '/stream?static=true&api_key=' + encodeURIComponent(auth.token);
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
                            stopHeroVideoPreview(true);
                            restartHeroTimer();
                        }
                    };
                    vid.addEventListener('playing', function () {
                        if (curHero.getAttribute('data-hero-item') !== targetId || heroHardPaused()) {
                            stopHeroVideoPreview(false);
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
                        scheduleHeroPreviewPlayCap(targetId);
                    });
                    vid.addEventListener('ended', onCleanup);
                    vid.addEventListener('error', onCleanup);

                    bgStack.appendChild(vid);
                    var playPromise = vid.play();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(function () {
                            stopHeroVideoPreview(true);
                        });
                    }
                }
            });
        }, 1500);
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
