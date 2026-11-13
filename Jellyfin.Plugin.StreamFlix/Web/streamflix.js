/* ==========================================================================
   STREAMFLIX — Netflix-style UI for Jellyfin: server-verified Google Sign-In,
   "Who's watching?" profiles backed by real Jellyfin users, PIN & Google locks (v0.5)
   ========================================================================== */
(function () {
    'use strict';

    if (window.__STREAMFLIX_BOOTSTRAPPED__) {
        return;
    }
    window.__STREAMFLIX_BOOTSTRAPPED__ = true;

    var VERSION = '0.5.4';
    // Household session issued by the server after Google verification ({ token, email, name, picture, expiresAt })
    var GOOGLE_KEY = 'streamflix_session_v7';
    var OAUTH_STATE_KEY = 'streamflix_oauth_state';
    var PENDING_PROFILE_KEY = 'streamflix_pending_profile';
    var PROFILE_KEY = 'streamflix_active_profile_v64';
    var LEGACY_PROFILE_KEY = 'streamflix_active_profile_v63';
    var CACHED_CONFIG_KEY = 'streamflix_cached_config_v7';
    var CINEMA_HUB_PREF_KEY = 'streamflix_cinema_hub_enabled_v1';
    var SHOWCASE_ITEMS_KEY = 'streamflix_showcase_items_v1';

    // Pre-v7 storage: unsigned client-side Google flag and caches with hard-coded defaults
    try {
        ['streamflix_google_auth_v1', 'streamflix_cached_config_v64', 'streamflix_cached_config_v6', 'streamflix_autoskip_intro_v1'].forEach(function (k) {
            localStorage.removeItem(k);
        });
    } catch (e) {}

    var AVATAR_COLORS = [
        '#E50914', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA',
        '#00ACC1', '#D81B60', '#3949AB', '#00897B', '#F4511E',
        '#5E35B1', '#EC407A', '#26A69A', '#546E7A'
    ];

    var AVATAR_ICONS = [
        '👑', '🎬', '🍿', '🦊', '🐼', '🚀', '🎮', '🎧',
        '⚡', '🔥', '🦁', '🦄', '🐉', '🌟', '🕶️', '🛸'
    ];

    var AVATAR_ICON_GROUPS = [
        { id: 'classic', label: 'Classic', icons: AVATAR_ICONS },
        { id: 'animals', label: 'Animals', icons: ['🐺', '🐯', '🐻', '🐨', '🦉', '🦅', '🦈', '🐙', '🦋', '🐧', '🦖', '🐈', '🐕', '🦦', '🦩', '🐝'] },
        { id: 'fantasy', label: 'Sci-Fi & Fantasy', icons: ['🧙', '🧛', '🧜', '🧝', '🤖', '👾', '👻', '🎭', '🔮', '⚔️', '🛡️', '🪐', '☄️', '🌙', '❄️', '🌈'] },
        { id: 'fun', label: 'Fun & Food', icons: ['🍕', '🍔', '🌮', '🍣', '🍩', '🍦', '☕', '🧋', '🎸', '🎹', '🎨', '🏀', '⚽', '🏎️', '🛹', '🏆'] }
    ];

    var MATURITY_LEVELS = [
        { label: 'All Maturity Levels (TV-MA / R / NC-17)', value: 'TV-MA / R (All Maturity Levels)', maxAge: null },
        { label: 'Teens & Older (TV-14 / PG-13)', value: 'Teens (TV-14 / PG-13)', maxAge: 13 },
        { label: 'Older Kids (TV-Y7 / PG)', value: 'Older Kids (TV-Y7 / PG)', maxAge: 7 },
        { label: 'Little Kids (TV-Y / G)', value: 'Little Kids (TV-Y / G)', maxAge: 5 }
    ];

    var DEFAULT_CONFIG = {
        version: '',
        serverId: '',
        serverName: 'StreamFlix',
        enableStreamFlixUi: true,
        requireGoogleAuth: true,
        googleClientId: '',
        googleConfigured: false,
        hasGoogleClientSecret: false,
        hasAccess: false,
        isAdmin: false,
        session: null,
        approvedGoogleAccounts: [],
        serverUsers: [],
        showcaseItems: [],
        profiles: []
    };

    var initialActiveProfile = loadJson(PROFILE_KEY, null);
    var legacyProfileToMigrate = !initialActiveProfile
        ? (loadJson(LEGACY_PROFILE_KEY, null) || loadJson('streamflix_active_profile_v5', null))
        : null;

    var state = {
        config: loadJson(CACHED_CONFIG_KEY, null) || DEFAULT_CONFIG,
        googleUser: loadHouseholdSession(),
        configFresh: false,
        heroPaused: false,
        activeProfile: initialActiveProfile,
        legacyProfileToMigrate: legacyProfileToMigrate,
        manageMode: false,
        verifyingGoogle: false,
        activatingProfileId: null,
        sessionVerifiedOnce: false,
        accountDropdownOpen: false,
        cinemaHubEnabled: loadJson(CINEMA_HUB_PREF_KEY, true) !== false,
        activeCategory: 'all',
        searchQuery: '',
        searchDebounce: null,
        searchResults: null,
        itemCache: {},
        hubData: {
            userId: null,
            loading: false,
            loaded: false,
            heroItems: [],
            resumeItems: [],
            nextUpItems: [],
            top10Items: [],
            favoriteItems: [],
            recentMovies: [],
            recentSeries: [],
            allMovies: [],
            allSeries: [],
            collectionsItems: [],
            views: []
        },
        heroIndex: 0,
        heroTimer: null,
        heroCatKey: null,
        ambientCache: {},
        personalRowsByUser: {},
        dragSourceProfileId: null
    };

    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

    function loadJson(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function saveJson(key, value) {
        try {
            if (value === null || value === undefined) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (e) {}
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /* Inline stroke icons (inherit currentColor) used across the modern UI */
    var ICON_PATHS = {
        play: '<path d="M7 4.6v14.8a1 1 0 0 0 1.53.85l11.6-7.4a1 1 0 0 0 0-1.7L8.53 3.75A1 1 0 0 0 7 4.6z" fill="currentColor" stroke="none"/>',
        pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
        close: '<path d="M6 6l12 12M18 6L6 18"/>',
        chevronLeft: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
        chevronRight: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
        chevronDown: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
        users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.6 14.2a6.2 6.2 0 0 1 3.6 5.3"/>',
        edit: '<path d="M4 20h4.2L19.1 9.1a2.1 2.1 0 0 0 0-3L17.9 4.9a2.1 2.1 0 0 0-3 0L4 15.8V20z"/><path d="M13.5 6.5l4 4"/>',
        tv: '<rect x="2.8" y="4.5" width="18.4" height="12.5" rx="2.2"/><path d="M8.5 20.5h7M12 17v3.5"/>',
        sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
        grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/><circle cx="12" cy="12" r="7"/>',
        home: '<path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/>',
        logout: '<path d="M14.5 4.5h3A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5h-3"/><path d="M10 16.5L5.5 12 10 7.5M5.5 12H15"/>',
        star: '<path d="M12 3.6l2.55 5.2 5.75.83-4.16 4.05.98 5.72L12 16.7l-5.12 2.7.98-5.72L3.7 9.63l5.75-.83z" fill="currentColor" stroke="none"/>',
        film: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
        lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/>',
        trash: '<path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 11.4A1.8 1.8 0 0 0 9.1 20h5.8a1.8 1.8 0 0 0 1.8-1.6L17.5 7M10.2 11v5M13.8 11v5"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.2-1.2"/>',
        volume: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a7.8 7.8 0 0 1 0 11"/>',
        volumeOff: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
        sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" fill="currentColor" stroke="none"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none"/>',
        shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
        shield: '<path d="M12 2.8l7.5 3.2v5.6c0 4.9-3.2 8.7-7.5 10.1-4.3-1.4-7.5-5.2-7.5-10.1V6L12 2.8z"/>',
        cast: '<path d="M3 7V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/><path d="M3 11a9 9 0 0 1 9 9M3 15a5 5 0 0 1 5 5"/><path d="M3.5 19.5h.01"/>',
        party: '<rect x="3" y="3.5" width="18" height="12" rx="2.2"/><path d="M10.4 7.2v4.6l4-2.3z" fill="currentColor"/><circle cx="7.5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><circle cx="16.5" cy="19" r="1.6"/>',
        episodes: '<rect x="3" y="6.5" width="14" height="11" rx="2"/><path d="M7 3.5h12a2 2 0 0 1 2 2v9.5"/><path d="M8.5 9.8v4.4l3.8-2.2z" fill="currentColor" stroke="none"/>',
        subtitles: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M6.5 11h4.5M13.5 11h4M6.5 15h6.5M15.5 15h2"/>',
        skipForward: '<path d="M5 5.5v13l9.5-6.5L5 5.5z" fill="currentColor" stroke="none"/><path d="M18.5 5.5v13"/>',
        undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'
    };

    function icon(name, extraClass) {
        return '<svg class="bfx-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"'
            + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON_PATHS[name] || '') + '</svg>';
    }

    function iconLabel(name, text) {
        return icon(name) + '<span>' + escapeHtml(text) + '</span>';
    }

    function isRecentlyAdded(item) {
        if (!item || !item.DateCreated) {
            return false;
        }
        var created = Date.parse(item.DateCreated);
        return !isNaN(created) && (Date.now() - created) < 14 * 24 * 3600 * 1000;
    }

    function formatTimeLeft(item) {
        var ud = item && item.UserData;
        if (!ud || !ud.PlaybackPositionTicks || !item.RunTimeTicks) {
            return '';
        }
        var left = formatRuntimeTicks(Math.max(0, item.RunTimeTicks - ud.PlaybackPositionTicks));
        return left ? left.trim() + ' left' : '';
    }

    function getItemLogoUrl(item, maxWidth) {
        if (!item || !item.ImageTags || !item.ImageTags.Logo) {
            return '';
        }
        return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Logo?maxWidth=' + (maxWidth || 800) + '&quality=90&tag=' + encodeURIComponent(item.ImageTags.Logo);
    }

    function normalizeGuid(id) {
        return String(id || '').replace(/-/g, '').toLowerCase();
    }

    function apiBase() {
        if (window.ApiClient && typeof window.ApiClient.serverAddress === 'function') {
            var addr = window.ApiClient.serverAddress();
            if (addr) {
                return addr.replace(/\/+$/, '');
            }
        }
        return window.location.origin;
    }

    function getJellyfinDeviceInfo() {
        var deviceId = 'streamflix-web-client';
        var deviceName = 'StreamFlix Web';
        var appName = 'Jellyfin Web';
        var appVersion = '10.11.0';
        try {
            var storedDeviceId = localStorage.getItem('_deviceId2');
            if (storedDeviceId) {
                deviceId = storedDeviceId;
            }
            if (window.ApiClient) {
                if (typeof window.ApiClient.deviceId === 'function' && window.ApiClient.deviceId()) {
                    deviceId = window.ApiClient.deviceId();
                } else if (window.ApiClient._deviceId) {
                    deviceId = window.ApiClient._deviceId;
                }
                if (typeof window.ApiClient.deviceName === 'function' && window.ApiClient.deviceName()) {
                    deviceName = window.ApiClient.deviceName();
                } else if (window.ApiClient._deviceName) {
                    deviceName = window.ApiClient._deviceName;
                }
                if (typeof window.ApiClient.appName === 'function' && window.ApiClient.appName()) {
                    appName = window.ApiClient.appName();
                } else if (window.ApiClient._appName) {
                    appName = window.ApiClient._appName;
                }
                if (typeof window.ApiClient.appVersion === 'function' && window.ApiClient.appVersion()) {
                    appVersion = window.ApiClient.appVersion();
                } else if (window.ApiClient._appVersion) {
                    appVersion = window.ApiClient._appVersion;
                }
            }
        } catch (e) {}
        return {
            deviceId: deviceId,
            deviceName: deviceName,
            appName: appName,
            appVersion: appVersion
        };
    }

    function getEmbyAuthHeader(token) {
        var dev = getJellyfinDeviceInfo();
        var header = 'MediaBrowser Client="' + dev.appName.replace(/"/g, '')
            + '", Device="' + dev.deviceName.replace(/"/g, '')
            + '", DeviceId="' + dev.deviceId.replace(/"/g, '')
            + '", Version="' + dev.appVersion.replace(/"/g, '') + '"';
        if (token) {
            header += ', Token="' + token + '"';
        }
        return header;
    }

    function getActiveToken() {
        return (state.activeProfile && state.activeProfile.accessToken)
            || (window.ApiClient && typeof window.ApiClient.accessToken === 'function' ? window.ApiClient.accessToken() : null);
    }

    function getActiveUserId() {
        return (state.activeProfile && state.activeProfile.jellyfinUserId)
            || (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : null);
    }

    function buildJellyfinAuthHeaders(extraHeaders) {
        var h = {};
        if (extraHeaders) {
            Object.keys(extraHeaders).forEach(function (k) {
                h[k] = extraHeaders[k];
            });
        }
        if (!h['Accept']) {
            h['Accept'] = 'application/json';
        }
        var token = getActiveToken();
        if (token) {
            var authVal = getEmbyAuthHeader(token);
            h['Authorization'] = authVal;
            h['X-Emby-Authorization'] = authVal;
            h['X-Emby-Token'] = token;
        }
        return h;
    }

    function stampServerIdOnItems(payload) {
        try {
            var sid = resolveKnownServerId();
            if (!sid || !payload) {
                return payload;
            }
            var list = Array.isArray(payload) ? payload : (Array.isArray(payload.Items) ? payload.Items : null);
            if (list) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i] && typeof list[i] === 'object') {
                        if (!list[i].ServerId) {
                            list[i].ServerId = sid;
                        }
                        if (list[i].Id) {
                            state.itemCache[list[i].Id] = list[i];
                        }
                    }
                }
            } else if (payload.Id && !payload.ServerId) {
                payload.ServerId = sid;
                state.itemCache[payload.Id] = payload;
            }
        } catch (e) {}
        return payload;
    }

    function apiFetch(path, options) {
        options = options || {};
        options.headers = buildJellyfinAuthHeaders(options.headers);
        var isStreamFlixApi = path.indexOf('/StreamFlix/') === 0;
        if (isStreamFlixApi && state.googleUser && state.googleUser.token) {
            options.headers['X-StreamFlix-Session'] = state.googleUser.token;
        }

        var fetchFn = nativeFetch || window.fetch;
        return fetchFn(apiBase() + path, options).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (txt) {
                    var msg = 'HTTP ' + res.status;
                    var parsed = null;
                    try {
                        parsed = JSON.parse(txt);
                        if (parsed && parsed.message) {
                            msg = parsed.message;
                        }
                    } catch (e) {
                        if (txt && txt.length < 300) {
                            msg = txt;
                        }
                    }
                    var err = new Error(msg);
                    err.status = res.status;
                    err.code = (parsed && parsed.code) || '';
                    err.data = parsed;
                    if (isStreamFlixApi && err.code === 'google_required') {
                        handleHouseholdSessionLost();
                    }
                    throw err;
                });
            }
            var ct = res.headers.get('content-type') || '';
            if (ct.indexOf('application/json') !== -1) {
                return res.json().then(stampServerIdOnItems);
            }
            return res.text();
        });
    }

    function isKnownTopLevelViewId(parentId) {
        if (!parentId) {
            return false;
        }
        var normPid = normalizeGuid(parentId);
        var views = (state.hubData && Array.isArray(state.hubData.views)) ? state.hubData.views : [];
        for (var i = 0; i < views.length; i++) {
            if (views[i] && normalizeGuid(views[i].Id) === normPid) {
                return true;
            }
        }
        var h = (window.location.hash || '');
        if (h.indexOf(parentId) !== -1 && (h.indexOf('topParentId=') !== -1 || h.indexOf('#/list') === 0 || h.indexOf('#/movies') === 0 || h.indexOf('#/tv') === 0)) {
            return true;
        }
        return false;
    }

    function inferItemTypesForParentOrRoute(parentId, existingTypes) {
        if (existingTypes) {
            return existingTypes;
        }
        if (parentId && parentId !== 'undefined' && parentId !== 'null') {
            var normPid = normalizeGuid(parentId);
            var views = (state.hubData && Array.isArray(state.hubData.views)) ? state.hubData.views : [];
            for (var i = 0; i < views.length; i++) {
                var v = views[i];
                if (v && normalizeGuid(v.Id) === normPid) {
                    var ct = (v.CollectionType || '').toLowerCase();
                    var vName = (v.Name || '').toLowerCase();
                    if (ct === 'movies' || vName.indexOf('movie') !== -1) {
                        return 'Movie';
                    }
                    if (ct === 'tvshows' || vName.indexOf('show') !== -1 || vName.indexOf('tv') !== -1) {
                        return 'Series';
                    }
                    if (ct === 'boxsets' || vName.indexOf('collection') !== -1) {
                        return 'BoxSet';
                    }
                }
            }
            try {
                var links = document.querySelectorAll('a[href*="' + parentId + '"], [data-id="' + parentId + '"]');
                for (var j = 0; j < links.length; j++) {
                    var href = (links[j].getAttribute('href') || '').toLowerCase();
                    var dType = (links[j].getAttribute('data-collectiontype') || '').toLowerCase();
                    var lText = (links[j].textContent || '').trim().toLowerCase();
                    if (href.indexOf('collectiontype=movies') !== -1 || href.indexOf('#/movies') !== -1 || dType === 'movies' || lText === 'movies') {
                        return 'Movie';
                    }
                    if (href.indexOf('collectiontype=tvshows') !== -1 || href.indexOf('#/tv') !== -1 || dType === 'tvshows' || lText === 'shows' || lText === 'tv shows') {
                        return 'Series';
                    }
                    if (href.indexOf('collectiontype=boxsets') !== -1 || dType === 'boxsets' || lText === 'collections') {
                        return 'BoxSet';
                    }
                }
            } catch (e) {}
        }
        var h = (window.location.hash || '').toLowerCase();
        if (h.indexOf('#/movies') === 0 || h.indexOf('collectiontype=movies') !== -1) {
            return 'Movie';
        }
        if (h.indexOf('#/tv') === 0 || h.indexOf('collectiontype=tvshows') !== -1) {
            return 'Series';
        }
        if (h.indexOf('collectiontype=boxsets') !== -1 || h.indexOf('#/list') === 0) {
            return 'BoxSet,Movie,Series';
        }
        return '';
    }

    function rewriteJellyfinItemsQueryUrl(rawUrl) {
        try {
            var u = new URL(rawUrl, window.location.origin);
            var pathLower = (u.pathname || '').toLowerCase();
            var isItems = pathLower === '/items' || (/^\/users\/[^/]+\/items$/i).test(u.pathname);
            var isLatest = pathLower === '/items/latest' || (/^\/users\/[^/]+\/items\/latest$/i).test(u.pathname);
            var isNextUp = pathLower === '/shows/nextup';
            var isRecs = pathLower === '/movies/recommendations';

            if (!isItems && !isLatest && !isNextUp && !isRecs) {
                return rawUrl;
            }

            var changed = false;
            var pid = u.searchParams.get('ParentId') || u.searchParams.get('parentId') || '';
            if (pid === 'undefined' || pid === 'null') {
                u.searchParams.delete('ParentId');
                u.searchParams.delete('parentId');
                pid = '';
                changed = true;
            }

            var uid = getActiveUserId();
            if (uid && !u.searchParams.has('userId') && !u.searchParams.has('UserId') && u.pathname.toLowerCase().indexOf('/users/') === -1) {
                u.searchParams.set('userId', uid);
                changed = true;
            }

            if (isItems) {
                var itemTypes = u.searchParams.get('IncludeItemTypes') || u.searchParams.get('includeItemTypes') || '';
                var filters = u.searchParams.get('Filters') || u.searchParams.get('filters') || '';
                if (itemTypes !== 'Episode' && itemTypes !== 'Season' && !filters) {
                    if (!pid || isKnownTopLevelViewId(pid)) {
                        var recVal = u.searchParams.get('Recursive') || u.searchParams.get('recursive') || '';
                        if (String(recVal).toLowerCase() !== 'true') {
                            u.searchParams.delete('recursive');
                            u.searchParams.set('Recursive', 'true');
                            changed = true;
                        }
                        if (!itemTypes) {
                            var inferred = inferItemTypesForParentOrRoute(pid, '');
                            if (inferred) {
                                u.searchParams.set('IncludeItemTypes', inferred);
                                changed = true;
                            }
                        }
                    }
                }
            }

            if (!changed) {
                return rawUrl;
            }
            if (rawUrl.indexOf('http://') === 0 || rawUrl.indexOf('https://') === 0) {
                return u.toString();
            }
            return u.pathname + u.search;
        } catch (e) {
            return rawUrl;
        }
    }

    function installJellyfin12XhrInterceptor() {
        if (window.__STREAMFLIX_XHR_PATCHED__ || typeof XMLHttpRequest === 'undefined') {
            return;
        }
        window.__STREAMFLIX_XHR_PATCHED__ = true;

        var origOpen = XMLHttpRequest.prototype.open;
        var origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        var origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            this.__streamflixMethod = String(method || 'GET').toUpperCase();
            var urlStr = typeof url === 'string' ? url : String(url || '');
            var isSameOrigin = urlStr.indexOf('/') === 0
                || urlStr.indexOf(window.location.origin) === 0
                || (apiBase() && urlStr.indexOf(apiBase()) === 0);
            this.__streamflixSameOrigin = isSameOrigin;
            this.__streamflixHeaders = {};

            if (isSameOrigin && this.__streamflixMethod === 'GET') {
                urlStr = rewriteJellyfinItemsQueryUrl(urlStr);
            }
            this.__streamflixUrl = urlStr;
            var args = Array.prototype.slice.call(arguments);
            args[1] = urlStr;
            return origOpen.apply(this, args);
        };

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            var lower = String(name || '').toLowerCase();
            if (this.__streamflixSameOrigin && lower) {
                var activeToken = getActiveToken();
                if (activeToken) {
                    if (lower === 'authorization' || lower === 'x-emby-authorization') {
                        value = getEmbyAuthHeader(activeToken);
                    } else if (lower === 'x-emby-token') {
                        value = activeToken;
                    }
                }
            }
            if (this.__streamflixHeaders && lower) {
                this.__streamflixHeaders[lower] = value;
            }
            return origSetRequestHeader.call(this, name, value);
        };

        XMLHttpRequest.prototype.send = function () {
            try {
                if (this.__streamflixSameOrigin) {
                    var token = getActiveToken();
                    if (token) {
                        var authVal = getEmbyAuthHeader(token);
                        var hdrs = this.__streamflixHeaders || {};
                        if (!hdrs['authorization']) {
                            origSetRequestHeader.call(this, 'Authorization', authVal);
                        }
                        if (!hdrs['x-emby-authorization']) {
                            origSetRequestHeader.call(this, 'X-Emby-Authorization', authVal);
                        }
                        if (!hdrs['x-emby-token']) {
                            origSetRequestHeader.call(this, 'X-Emby-Token', token);
                        }
                    }
                }
            } catch (e) {}
            return origSend.apply(this, arguments);
        };
    }

    function installJellyfin12FetchInterceptor() {
        installJellyfin12XhrInterceptor();
        if (!nativeFetch || window.__STREAMFLIX_FETCH_PATCHED__) {
            return;
        }
        window.__STREAMFLIX_FETCH_PATCHED__ = true;

        window.fetch = function (input, init) {
            var urlStr = '';
            try {
                urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
            } catch (e) {}

            var isSameOrigin = urlStr.indexOf('/') === 0
                || urlStr.indexOf(window.location.origin) === 0
                || (apiBase() && urlStr.indexOf(apiBase()) === 0);

            var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

            if (isSameOrigin && method === 'GET' && typeof input === 'string') {
                urlStr = rewriteJellyfinItemsQueryUrl(urlStr);
                input = urlStr;
            }

            if (isSameOrigin && getActiveToken()) {
                init = init || {};
                var token = getActiveToken();
                var authVal = getEmbyAuthHeader(token);
                if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
                    init.headers.set('Authorization', authVal);
                    init.headers.set('X-Emby-Authorization', authVal);
                    init.headers.set('X-Emby-Token', token);
                } else if (typeof input === 'string') {
                    init.headers = buildJellyfinAuthHeaders(init.headers);
                }
            }

            return nativeFetch(input, init).then(function (res) {
                if (!isSameOrigin || method !== 'GET' || !res || !res.ok) {
                    return res;
                }

                var urlObj;
                try {
                    urlObj = new URL(urlStr, window.location.origin);
                } catch (e) {
                    return res;
                }

                var pathLower = (urlObj.pathname || '').toLowerCase();
                var isItemsEndpoint = pathLower === '/items' || (/^\/users\/[^/]+\/items$/i).test(urlObj.pathname);
                var isLatestEndpoint = pathLower === '/items/latest' || (/^\/users\/[^/]+\/items\/latest$/i).test(urlObj.pathname);

                if (!isItemsEndpoint && !isLatestEndpoint) {
                    return res;
                }

                var activeUid = getActiveUserId();

                if (isItemsEndpoint) {
                    var filters = urlObj.searchParams.get('Filters') || urlObj.searchParams.get('filters') || '';
                    var itemTypes = urlObj.searchParams.get('IncludeItemTypes') || urlObj.searchParams.get('includeItemTypes') || '';
                    if (filters || itemTypes === 'Episode' || itemTypes === 'Season') {
                        return res;
                    }

                    return res.clone().json().then(function (data) {
                        if (data && Array.isArray(data.Items) && data.Items.length > 0) {
                            stampServerIdOnItems(data);
                            return new Response(JSON.stringify(data), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }

                        var sp1 = new URLSearchParams(urlObj.search);
                        if (activeUid && !sp1.has('userId') && !sp1.has('UserId')) {
                            sp1.set('userId', activeUid);
                        }
                        sp1.delete('recursive');
                        sp1.set('Recursive', 'true');

                        var authHeaders = buildJellyfinAuthHeaders();
                        return nativeFetch(apiBase() + '/Items?' + sp1.toString(), { headers: authHeaders })
                            .then(function (r1) { return r1.ok ? r1.json() : null; })
                            .then(function (d1) {
                                if (d1 && Array.isArray(d1.Items) && d1.Items.length > 0) {
                                    stampServerIdOnItems(d1);
                                    return new Response(JSON.stringify(d1), {
                                        status: 200,
                                        headers: { 'Content-Type': 'application/json' }
                                    });
                                }

                                var pid = sp1.get('ParentId') || sp1.get('parentId') || '';
                                var inferredType = inferItemTypesForParentOrRoute(pid, itemTypes);
                                if (!inferredType) {
                                    return res;
                                }

                                sp1.delete('ParentId');
                                sp1.delete('parentId');
                                sp1.set('IncludeItemTypes', inferredType);

                                return nativeFetch(apiBase() + '/Items?' + sp1.toString(), { headers: authHeaders })
                                    .then(function (r2) { return r2.ok ? r2.json() : null; })
                                    .then(function (d2) {
                                        if (d2 && Array.isArray(d2.Items) && d2.Items.length > 0) {
                                            stampServerIdOnItems(d2);
                                            return new Response(JSON.stringify(d2), {
                                                status: 200,
                                                headers: { 'Content-Type': 'application/json' }
                                            });
                                        }
                                        return res;
                                    });
                            })
                            .catch(function () {
                                return res;
                            });
                    }).catch(function () {
                        return res;
                    });
                }

                if (isLatestEndpoint) {
                    return res.clone().json().then(function (data) {
                        if (Array.isArray(data) && data.length > 0) {
                            stampServerIdOnItems(data);
                            return new Response(JSON.stringify(data), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }

                        var spL = new URLSearchParams(urlObj.search);
                        var pid = spL.get('ParentId') || spL.get('parentId') || '';
                        var existingType = spL.get('IncludeItemTypes') || spL.get('includeItemTypes') || '';
                        var inferredType = inferItemTypesForParentOrRoute(pid, existingType) || 'Movie,Series';

                        if (activeUid && !spL.has('userId') && !spL.has('UserId')) {
                            spL.set('userId', activeUid);
                        }
                        spL.set('Recursive', 'true');
                        spL.set('IncludeItemTypes', inferredType);
                        spL.set('SortBy', 'DateCreated,SortName');
                        spL.set('SortOrder', 'Descending');

                        var authHeaders = buildJellyfinAuthHeaders();
                        return nativeFetch(apiBase() + '/Items?' + spL.toString(), { headers: authHeaders })
                            .then(function (rL1) { return rL1.ok ? rL1.json() : null; })
                            .then(function (dL1) {
                                if (dL1 && Array.isArray(dL1.Items) && dL1.Items.length > 0) {
                                    stampServerIdOnItems(dL1.Items);
                                    return new Response(JSON.stringify(dL1.Items), {
                                        status: 200,
                                        headers: { 'Content-Type': 'application/json' }
                                    });
                                }

                                if (!pid) {
                                    return res;
                                }

                                spL.delete('ParentId');
                                spL.delete('parentId');
                                return nativeFetch(apiBase() + '/Items?' + spL.toString(), { headers: authHeaders })
                                    .then(function (rL2) { return rL2.ok ? rL2.json() : null; })
                                    .then(function (dL2) {
                                        if (dL2 && Array.isArray(dL2.Items) && dL2.Items.length > 0) {
                                            stampServerIdOnItems(dL2.Items);
                                            return new Response(JSON.stringify(dL2.Items), {
                                                status: 200,
                                                headers: { 'Content-Type': 'application/json' }
                                            });
                                        }
                                        return res;
                                    });
                            })
                            .catch(function () {
                                return res;
                            });
                    }).catch(function () {
                        return res;
                    });
                }

                return res;
            });
        };
    }

    function patchJellyfinApiClientMethods() {
        try {
            var cmList = [];
            if (window.ConnectionManager) {
                cmList.push(window.ConnectionManager);
            }
            if (window.Emby && window.Emby.ConnectionManager && cmList.indexOf(window.Emby.ConnectionManager) === -1) {
                cmList.push(window.Emby.ConnectionManager);
            }
            for (var cIdx = 0; cIdx < cmList.length; cIdx++) {
                var cm = cmList[cIdx];
                if (cm && !cm.__streamflixPatched) {
                    cm.__streamflixPatched = true;
                    if (typeof cm.getApiClient === 'function') {
                        var origGetApiClient = cm.getApiClient.bind(cm);
                        cm.getApiClient = function (itemOrServerId) {
                            try {
                                var res = origGetApiClient(itemOrServerId);
                                if (res) {
                                    return res;
                                }
                            } catch (e) {}
                            return window.ApiClient || null;
                        };
                    }
                    if (typeof cm.getApi === 'function') {
                        var origGetApi = cm.getApi.bind(cm);
                        cm.getApi = function (itemOrServerId) {
                            try {
                                var apiRes = origGetApi(itemOrServerId);
                                if (apiRes) {
                                    return apiRes;
                                }
                            } catch (e) {}
                            return (window.ApiClient && window.ApiClient._sdk) || undefined;
                        };
                    }
                }
            }

            if (!window.ApiClient || window.ApiClient.__streamflixPatched) {
                return;
            }
            window.ApiClient.__streamflixPatched = true;

            if (typeof window.ApiClient.serverId === 'function') {
                var origServerId = window.ApiClient.serverId.bind(window.ApiClient);
                window.ApiClient.__origServerId = origServerId;
                window.ApiClient.serverId = function () {
                    var sid = origServerId();
                    return sid || (state.activeProfile && state.activeProfile.serverId) || (state.config && state.config.serverId) || '';
                };
            }

            if (typeof window.ApiClient.getCurrentUserId === 'function') {
                var origGetCurrentUserId = window.ApiClient.getCurrentUserId.bind(window.ApiClient);
                window.ApiClient.__origGetCurrentUserId = origGetCurrentUserId;
                window.ApiClient.getCurrentUserId = function () {
                    var uid = origGetCurrentUserId();
                    return uid || (state.activeProfile && state.activeProfile.jellyfinUserId) || '';
                };
            }

            if (typeof window.ApiClient.accessToken === 'function') {
                var origAccessToken = window.ApiClient.accessToken.bind(window.ApiClient);
                window.ApiClient.__origAccessToken = origAccessToken;
                window.ApiClient.accessToken = function () {
                    var tok = origAccessToken();
                    return tok || (state.activeProfile && state.activeProfile.accessToken) || '';
                };
            }

            if (typeof window.ApiClient.getItems === 'function') {
                var origGetItems = window.ApiClient.getItems.bind(window.ApiClient);
                window.ApiClient.getItems = function (userId, options) {
                    var opts = Object.assign({}, options || {});
                    if (opts.ParentId === 'undefined' || opts.ParentId === 'null') {
                        delete opts.ParentId;
                    }
                    if (opts.parentId === 'undefined' || opts.parentId === 'null') {
                        delete opts.parentId;
                    }
                    var uid = userId || getActiveUserId();
                    return origGetItems(uid, opts).then(function (res) {
                        if (res && Array.isArray(res.Items) && res.Items.length > 0) {
                            return stampServerIdOnItems(res);
                        }
                        if (opts.Filters || opts.IncludeItemTypes === 'Episode' || opts.IncludeItemTypes === 'Season') {
                            return res;
                        }
                        var qs = new URLSearchParams();
                        if (uid) {
                            qs.set('userId', String(uid));
                        }
                        Object.keys(opts).forEach(function (k) {
                            if (opts[k] !== undefined && opts[k] !== null && k.toLowerCase() !== 'userid') {
                                qs.set(k, String(opts[k]));
                            }
                        });
                        qs.set('Recursive', 'true');
                        return apiFetch('/Items?' + qs.toString()).then(function (d1) {
                            if (d1 && Array.isArray(d1.Items) && d1.Items.length > 0) {
                                return stampServerIdOnItems(d1);
                            }
                            var pid = qs.get('ParentId') || qs.get('parentId') || '';
                            var inferredType = inferItemTypesForParentOrRoute(pid, qs.get('IncludeItemTypes'));
                            if (!inferredType) {
                                return res;
                            }
                            qs.delete('ParentId');
                            qs.delete('parentId');
                            qs.set('IncludeItemTypes', inferredType);
                            return apiFetch('/Items?' + qs.toString()).then(function (d2) {
                                return (d2 && Array.isArray(d2.Items) && d2.Items.length > 0) ? stampServerIdOnItems(d2) : res;
                            });
                        }).catch(function () {
                            return res;
                        });
                    });
                };
            }

            if (typeof window.ApiClient.getLatestItems === 'function') {
                var origGetLatest = window.ApiClient.getLatestItems.bind(window.ApiClient);
                window.ApiClient.getLatestItems = function (options) {
                    return origGetLatest(options).then(function (res) {
                        if (Array.isArray(res) && res.length > 0) {
                            return stampServerIdOnItems(res);
                        }
                        var opts = options || {};
                        var pid = opts.ParentId || opts.parentId || '';
                        var inferredType = inferItemTypesForParentOrRoute(pid, opts.IncludeItemTypes) || 'Movie,Series';
                        var qs = new URLSearchParams();
                        var uid = getActiveUserId();
                        if (uid) {
                            qs.set('userId', String(uid));
                        }
                        qs.set('Recursive', 'true');
                        qs.set('IncludeItemTypes', inferredType);
                        qs.set('SortBy', 'DateCreated,SortName');
                        qs.set('SortOrder', 'Descending');
                        qs.set('Limit', String(opts.Limit || 16));
                        if (opts.Fields) {
                            qs.set('Fields', String(opts.Fields));
                        }
                        return apiFetch('/Items?' + qs.toString()).then(function (d) {
                            return (d && Array.isArray(d.Items) && d.Items.length > 0) ? stampServerIdOnItems(d.Items) : res;
                        }).catch(function () {
                            return res;
                        });
                    });
                };
            }
        } catch (e) {}
    }

    function resolveKnownServerId(preferredServerId) {
        if (preferredServerId) {
            return preferredServerId;
        }
        if (state.activeProfile && state.activeProfile.serverId) {
            return state.activeProfile.serverId;
        }
        if (state.config && state.config.serverId) {
            return state.config.serverId;
        }
        try {
            var sidFn = window.ApiClient && (window.ApiClient.__origServerId || window.ApiClient.serverId);
            if (typeof sidFn === 'function') {
                var sid = sidFn.call(window.ApiClient);
                if (sid) {
                    return sid;
                }
            }
            var creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{"Servers":[]}');
            if (creds && Array.isArray(creds.Servers) && creds.Servers.length > 0 && creds.Servers[0].Id) {
                return creds.Servers[0].Id;
            }
        } catch (e) {}
        return '';
    }

    function applyJellyfinServerCredentials(authPayload) {
        if (!authPayload || !authPayload.accessToken || !authPayload.userId) {
            return;
        }

        var serverId = resolveKnownServerId(authPayload.serverId);
        var address = apiBase();

        try {
            localStorage.setItem('enableAutoLogin', 'true');

            var raw = localStorage.getItem('jellyfin_credentials');
            var creds = raw ? JSON.parse(raw) : { Servers: [] };
            if (!Array.isArray(creds.Servers)) {
                creds.Servers = [];
            }

            if (creds.Servers.length === 0) {
                creds.Servers.push({
                    ManualAddress: address,
                    LocalAddress: address,
                    manualAddressOnly: true,
                    LastConnectionMode: 2,
                    Id: serverId,
                    Name: (state.config && state.config.serverName) || 'StreamFlix',
                    UserId: authPayload.userId,
                    AccessToken: authPayload.accessToken,
                    DateLastAccessed: Date.now()
                });
            } else {
                for (var i = 0; i < creds.Servers.length; i++) {
                    var srv = creds.Servers[i];
                    srv.ManualAddress = srv.ManualAddress || address;
                    srv.LocalAddress = srv.LocalAddress || address;
                    srv.manualAddressOnly = true;
                    srv.LastConnectionMode = 2;
                    if (serverId) {
                        srv.Id = serverId;
                    }
                    srv.UserId = authPayload.userId;
                    srv.AccessToken = authPayload.accessToken;
                    srv.DateLastAccessed = Date.now();
                }
            }

            localStorage.setItem('jellyfin_credentials', JSON.stringify(creds));
        } catch (e) {}

        try {
            if (window.ApiClient) {
                if (window.ApiClient._serverInfo) {
                    if (serverId) {
                        window.ApiClient._serverInfo.Id = serverId;
                    }
                    window.ApiClient._serverInfo.UserId = authPayload.userId;
                    window.ApiClient._serverInfo.AccessToken = authPayload.accessToken;
                    window.ApiClient._serverInfo.ManualAddress = window.ApiClient._serverInfo.ManualAddress || address;
                    window.ApiClient._serverInfo.LocalAddress = window.ApiClient._serverInfo.LocalAddress || address;
                }
                try {
                    if (typeof window.ApiClient.setAuthenticationInfo === 'function') {
                        window.ApiClient.setAuthenticationInfo(authPayload.accessToken, authPayload.userId);
                    }
                } catch (eAuth) {}
                // NOTE: In @jellyfin/sdk, Api.prototype.accessToken is a getter-only property!
                // Never assign window.ApiClient._sdk.accessToken = ... directly in strict mode; call _sdk.update() instead.
                try {
                    if (window.ApiClient._sdk && typeof window.ApiClient._sdk.update === 'function') {
                        window.ApiClient._sdk.update({
                            basePath: address,
                            accessToken: authPayload.accessToken
                        });
                    }
                } catch (eSdk) {}
                if (authPayload.user) {
                    if (serverId && !authPayload.user.ServerId) {
                        authPayload.user.ServerId = serverId;
                    }
                    window.ApiClient._currentUser = authPayload.user;
                    try {
                        if (typeof window.ApiClient.onAuthenticated === 'function') {
                            window.ApiClient.onAuthenticated(window.ApiClient, {
                                User: authPayload.user,
                                SessionInfo: authPayload.sessionInfo || null,
                                AccessToken: authPayload.accessToken,
                                ServerId: serverId || (authPayload.user && authPayload.user.ServerId) || ''
                            });
                        }
                    } catch (eOnAuth) {}
                } else if (window.ApiClient._currentUser && normalizeGuid(window.ApiClient._currentUser.Id) !== normalizeGuid(authPayload.userId)) {
                    window.ApiClient._currentUser = null;
                }
            }
        } catch (e) {}
    }

    function normalizeProfileModel(p, index) {
        p = p || {};
        var idx = typeof index === 'number' ? index : 0;
        var color = p.avatarColorHex || p.color || AVATAR_COLORS[idx % AVATAR_COLORS.length];
        var icon = p.avatarEmoji || p.icon || (p.isKids ? '🦊' : AVATAR_ICONS[idx % AVATAR_ICONS.length]);
        var googleLocked = Boolean(p.googleLocked || p.googleAccountEmail);
        return {
            id: p.id || ('streamflix_profile_' + idx),
            name: p.name || ('Profile ' + (idx + 1)),
            color: color,
            icon: icon,
            avatarColorIndex: typeof p.avatarColorIndex === 'number' ? p.avatarColorIndex : 0,
            avatarIconIndex: typeof p.avatarIconIndex === 'number' ? p.avatarIconIndex : 0,
            isKids: Boolean(p.isKids),
            isAdmin: Boolean(p.isAdmin),
            isOwner: Boolean(p.isOwner || p.id === 'streamflix_owner'),
            maxParentalRating: p.maturityRating || p.maxParentalRating || (p.isKids ? 'Older Kids (TV-Y7 / PG)' : 'TV-MA / R (All Maturity Levels)'),
            hasPin: Boolean(p.hasPin),
            pinLength: typeof p.pinLength === 'number' ? p.pinLength : 0,
            googleLocked: googleLocked,
            googleAccountEmail: p.googleAccountEmail || '',
            googleAccountHint: p.googleAccountHint || '',
            googleLockSatisfied: googleLocked ? Boolean(p.googleLockSatisfied) : true,
            jellyfinUserId: p.jellyfinUserId || '',
            jellyfinUsername: p.jellyfinUsername || p.name || ''
        };
    }

    /* Household session (issued by /StreamFlix/VerifyGoogle, HMAC-signed by the server) */
    function loadHouseholdSession() {
        var s = loadJson(GOOGLE_KEY, null);
        if (!s || !s.token || !s.email) {
            return null;
        }
        if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) {
            saveJson(GOOGLE_KEY, null);
            return null;
        }
        return s;
    }

    function setHouseholdSession(session) {
        state.googleUser = session;
        saveJson(GOOGLE_KEY, session);
    }

    function clearHouseholdSession() {
        state.googleUser = null;
        saveJson(GOOGLE_KEY, null);
    }

    function hasHouseholdAccess() {
        var cfg = state.config;
        if (!cfg || cfg.requireGoogleAuth === false) {
            return true;
        }
        if (cfg.hasAccess) {
            return true;
        }
        // Until the server has answered, trust a locally stored (unexpired) session token
        return !state.configFresh && Boolean(state.googleUser && state.googleUser.token);
    }

    function clearShowcaseAndMediaCaches() {
        try { localStorage.removeItem(SHOWCASE_ITEMS_KEY); } catch (e) {}
        state.itemCache = {};
        if (state.hubData) {
            state.hubData.heroItems = [];
            state.hubData.top10Items = [];
            state.hubData.allMovies = [];
            state.hubData.allSeries = [];
            state.hubData.resumeItems = [];
            state.hubData.favoriteItems = [];
            state.hubData.recentMovies = [];
            state.hubData.recentSeries = [];
        }
        if (state.config) {
            state.config.showcaseItems = [];
            state.config.serverUsers = [];
            state.config.approvedGoogleAccounts = [];
        }
    }

    function handleHouseholdSessionLost() {
        var hadSession = Boolean(state.googleUser && state.googleUser.token);
        clearHouseholdSession();
        if (state.config) {
            state.config.hasAccess = state.config.requireGoogleAuth === false;
            state.config.session = null;
            state.config.isAdmin = false;
            if (!state.config.hasAccess) {
                clearShowcaseAndMediaCaches();
            }
        }
        if (state.verifyingGoogle || !state.config || state.config.requireGoogleAuth === false) {
            return;
        }
        state.activatingProfileId = null;
        renderGoogleAuthGate(null, hadSession ? 'Your sign-in expired. Please sign in again.' : null);
    }

    function applyConfigFromServerResponse(cfg) {
        if (!cfg || typeof cfg !== 'object') {
            return state.config;
        }
        var rawProfiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
        var normalizedProfiles = rawProfiles.map(function (p, i) {
            return normalizeProfileModel(p, i);
        });
        var requireGoogle = cfg.requireGoogleAuth !== false;
        var resolvedAccess = Boolean(cfg.hasAccess) || !requireGoogle;
        var serverShowcase = [];
        if (resolvedAccess) {
            serverShowcase = Array.isArray(cfg.showcaseItems) && cfg.showcaseItems.length > 0
                ? cfg.showcaseItems
                : ((state.config && Array.isArray(state.config.showcaseItems)) ? state.config.showcaseItems : []);
            if (serverShowcase.length > 0) {
                saveJson(SHOWCASE_ITEMS_KEY, serverShowcase);
            }
        } else {
            try { localStorage.removeItem(SHOWCASE_ITEMS_KEY); } catch (e) {}
        }
        state.configFresh = true;
        state.config = {
            version: cfg.version || '',
            serverId: cfg.serverId || (state.config && state.config.serverId) || '',
            serverName: cfg.serverName || 'StreamFlix',
            enableStreamFlixUi: cfg.enableStreamFlixUi !== false,
            requireGoogleAuth: requireGoogle,
            googleClientId: cfg.googleClientId || '',
            googleConfigured: cfg.googleConfigured !== undefined ? Boolean(cfg.googleConfigured) : Boolean(cfg.googleClientId),
            hasGoogleClientSecret: Boolean(cfg.hasGoogleClientSecret),
            hasAccess: Boolean(cfg.hasAccess) || !requireGoogle,
            isAdmin: Boolean(cfg.isAdmin),
            session: cfg.session || null,
            approvedGoogleAccounts: Array.isArray(cfg.approvedGoogleAccounts) ? cfg.approvedGoogleAccounts : [],
            serverUsers: Array.isArray(cfg.serverUsers) ? cfg.serverUsers : [],
            showcaseItems: serverShowcase,
            profiles: normalizedProfiles
        };

        // A token the server no longer accepts has expired or been revoked ("Sign out all devices")
        if (state.googleUser && state.googleUser.token) {
            if (!cfg.session) {
                clearHouseholdSession();
            } else if (cfg.session.expiresAt && cfg.session.expiresAt !== state.googleUser.expiresAt) {
                state.googleUser.expiresAt = cfg.session.expiresAt;
                saveJson(GOOGLE_KEY, state.googleUser);
            }
        }

        saveJson(CACHED_CONFIG_KEY, state.config);
        refreshNetflixBackdropWallInPlace();
        return state.config;
    }

    /* ----------------------------------------------------------------------
       1. Google OAuth 2.0 Flow (with CSRF state) & Server Verification
       ---------------------------------------------------------------------- */
    function getGoogleRedirectUri() {
        return window.location.origin + window.location.pathname;
    }

    function extractGoogleOAuthResultFromUrl() {
        var raw = (window.location.hash || '') + '&' + (window.location.search || '').replace(/^\?/, '');
        if (raw.indexOf('access_token=') === -1 && raw.indexOf('error=') === -1) {
            return null;
        }
        var param = function (name) {
            var match = raw.match(new RegExp('(?:[#?&/]|^)' + name + '=([^&]+)'));
            if (!match) {
                return '';
            }
            try {
                return decodeURIComponent(match[1].replace(/\+/g, ' '));
            } catch (e) {
                return match[1];
            }
        };
        var result = {
            token: param('access_token'),
            error: param('error'),
            state: param('state')
        };
        if (!result.token && !(result.error && result.state)) {
            return null;
        }

        var expected = '';
        try {
            expected = sessionStorage.getItem(OAUTH_STATE_KEY) || '';
            sessionStorage.removeItem(OAUTH_STATE_KEY);
        } catch (e) {}
        result.stateOk = Boolean(expected) && expected === result.state;

        state.justCompletedGoogleOAuth = true;
        // Strip the token from the address bar and history immediately
        try {
            window.history.replaceState(null, document.title, window.location.pathname + '#/home');
        } catch (e) {
            window.location.hash = '#/home';
        }
        return result;
    }

    function takePendingProfileId() {
        var pid = '';
        try {
            pid = sessionStorage.getItem(PENDING_PROFILE_KEY) || '';
            sessionStorage.removeItem(PENDING_PROFILE_KEY);
        } catch (e) {}
        return pid;
    }

    function startGoogleOAuthRedirect(pendingProfileId, loginHint) {
        var clientId = state.config && state.config.googleClientId;
        if (!clientId) {
            showToast('Google Sign-In isn\'t configured on this server yet.', 'error');
            return;
        }
        var oauthState = randomToken(16);
        try {
            sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
            if (pendingProfileId) {
                sessionStorage.setItem(PENDING_PROFILE_KEY, pendingProfileId);
            } else {
                sessionStorage.removeItem(PENDING_PROFILE_KEY);
            }
        } catch (e) {}

        var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
            + '?client_id=' + encodeURIComponent(clientId)
            + '&redirect_uri=' + encodeURIComponent(getGoogleRedirectUri())
            + '&response_type=token'
            + '&scope=' + encodeURIComponent('openid email profile')
            + '&state=' + encodeURIComponent(oauthState)
            + '&include_granted_scopes=true'
            + '&prompt=select_account'
            + (loginHint ? '&login_hint=' + encodeURIComponent(loginHint) : '');

        var btn = document.getElementById('streamflix-google-login-btn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('streamflix-btn-loading');
        }
        window.location.assign(authUrl);
    }

    function verifyGoogleAccessToken(accessToken) {
        state.verifyingGoogle = true;
        renderGoogleAuthGate('Verifying your Google account…');

        return apiFetch('/StreamFlix/VerifyGoogle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: accessToken,
                approveIfUnlisted: false
            })
        }).then(function (res) {
            state.verifyingGoogle = false;
            if (!res || !res.verified || !res.sessionToken) {
                takePendingProfileId();
                renderGoogleAuthGate(null, (res && res.message) || 'Google verification failed.');
                return null;
            }

            setHouseholdSession({
                token: res.sessionToken,
                email: res.email,
                name: res.name || res.email,
                picture: res.picture || '',
                expiresAt: res.expiresAt || ''
            });
            // Netflix-style: always choose who's watching after signing in
            state.activeProfile = null;
            localStorage.removeItem(PROFILE_KEY);

            var pendingId = takePendingProfileId();
            return fetchPublicConfig().then(function () {
                renderProfilePickerGate();
                var pending = pendingId ? findProfileById(pendingId) : null;
                if (pending) {
                    handleSelectProfile(pending);
                } else {
                    showToast('Signed in as ' + res.email, 'success');
                }
                return res;
            });
        }).catch(function (err) {
            state.verifyingGoogle = false;
            takePendingProfileId();
            renderGoogleAuthGate(null, (err && err.message) || 'Google verification failed.');
        });
    }

    /* ----------------------------------------------------------------------
       2. Server-Backed Profile Activation & Navigation
       ---------------------------------------------------------------------- */
    function findViewByType(wantType) {
        var views = (state.hubData && Array.isArray(state.hubData.views)) ? state.hubData.views : [];
        var wt = String(wantType || '').toLowerCase();
        for (var i = 0; i < views.length; i++) {
            var v = views[i];
            if (!v || !v.Id) {
                continue;
            }
            var ct = (v.CollectionType || '').toLowerCase();
            var nm = (v.Name || '').toLowerCase();
            if (wt === 'movies' && (ct === 'movies' || nm.indexOf('movie') !== -1)) {
                return v;
            }
            if (wt === 'tvshows' && (ct === 'tvshows' || nm.indexOf('show') !== -1 || nm.indexOf('tv') !== -1)) {
                return v;
            }
            if (wt === 'boxsets' && (ct === 'boxsets' || nm.indexOf('collection') !== -1)) {
                return v;
            }
        }
        return null;
    }

    function fixBrokenJellyfinRoutes() {
        var onHome = isOnHomeRoute();
        if (document.body) {
            document.body.classList.toggle('streamflix-on-home', onHome);
        }

        var h = window.location.hash || '';
        if (h === '#!/home.html' || h === '#!/home' || h === '#/home.html') {
            window.location.hash = '#/home';
            return;
        }

        // If Jellyfin's React Router rendered FallbackRoute (#fallbackPage — "Page not found") on the home route
        // (e.g. after returning from Google OAuth with #access_token=...), hide the error text immediately and trigger router navigation to #/home
        var fbPage = document.querySelector('#fallbackPage:not(.hide)');
        if (fbPage && onHome) {
            fbPage.classList.add('streamflix-recovered');
            if (!state.recoveringFallbackPage && !document.getElementById('streamflix-overlay-root')) {
                state.recoveringFallbackPage = true;
                var goHomeLink = fbPage.querySelector('a.button-link, a[href="#/home"], a[href="/"]');
                if (goHomeLink && typeof goHomeLink.click === 'function') {
                    try {
                        goHomeLink.click();
                    } catch (e) {}
                }
                window.location.hash = '#/';
                setTimeout(function () {
                    window.location.hash = '#/home';
                    state.recoveringFallbackPage = false;
                }, 60);
            }
        }

        var hLower = h.toLowerCase();
        if (hLower.indexOf('#/search') === 0 || hLower.indexOf('#!/search') === 0) {
            var qMatch = h.match(/[?&]query=([^&]+)/i);
            if (qMatch && qMatch[1]) {
                state.searchQuery = decodeURIComponent(qMatch[1]);
                runLiveSearch(state.searchQuery);
            }
            window.location.hash = '#/home';
            setTimeout(function () {
                ensureCinemaHubMounted();
                renderCinemaHubContents();
                var sInput = document.getElementById('streamflix-live-search-input');
                if (sInput) {
                    sInput.focus();
                }
            }, 60);
            return;
        }

        var serverId = resolveKnownServerId();
        var updatedHash = h;

        // Jellyfin's list.js controller requires parentId=, whereas top bar sometimes passes topParentId= for Collections
        if (hLower.indexOf('#/list') === 0 && updatedHash.indexOf('topParentId=') !== -1 && updatedHash.indexOf('parentId=') === -1) {
            updatedHash = updatedHash.replace(/([?&])topParentId=/i, '$1parentId=');
        }

        // Ensure #/movies and #/tv have topParentId= if previously stripped
        if (hLower.indexOf('#/movies') === 0 && updatedHash.indexOf('topParentId=') === -1) {
            var mView = findViewByType('movies');
            if (mView && mView.Id) {
                updatedHash += (updatedHash.indexOf('?') === -1 ? '?' : '&') + 'topParentId=' + encodeURIComponent(mView.Id);
            }
        } else if (hLower.indexOf('#/tv') === 0 && updatedHash.indexOf('topParentId=') === -1) {
            var tvView = findViewByType('tvshows');
            if (tvView && tvView.Id) {
                updatedHash += (updatedHash.indexOf('?') === -1 ? '?' : '&') + 'topParentId=' + encodeURIComponent(tvView.Id);
            }
        }

        // Ensure serverId= is present on #/movies, #/tv, #/list, and #/details so ConnectionManager.getApiClient(params.serverId) never returns undefined
        if (serverId
            && (hLower.indexOf('#/movies') === 0 || hLower.indexOf('#/tv') === 0 || hLower.indexOf('#/list') === 0 || hLower.indexOf('#/details') === 0)
            && updatedHash.indexOf('serverId=') === -1) {
            updatedHash += (updatedHash.indexOf('?') === -1 ? '?' : '&') + 'serverId=' + encodeURIComponent(serverId);
        }

        if (updatedHash !== h) {
            window.location.hash = updatedHash;
        }
    }

    function activateServerProfile(profile, suppliedPin) {
        var dev = getJellyfinDeviceInfo();
        var prevUserId = (state.activeProfile && state.activeProfile.jellyfinUserId)
            || (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : '');
        state.activatingProfileId = profile.id;
        return apiFetch('/StreamFlix/Profiles/Activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profileId: profile.id,
                pin: suppliedPin || '',
                pinCode: suppliedPin || '',
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                appName: dev.appName,
                appVersion: dev.appVersion
            })
        }).then(function (res) {
            state.activatingProfileId = null;
            state.legacyProfileToMigrate = null;
            var activated = normalizeProfileModel(res.profile || profile, 0);
            activated.jellyfinUserId = res.userId || activated.jellyfinUserId;
            activated.jellyfinUsername = res.userName || res.jellyfinUsername || activated.jellyfinUsername;
            activated.accessToken = res.accessToken;
            activated.serverId = res.serverId || (state.config && state.config.serverId) || '';

            state.activeProfile = activated;
            saveJson(PROFILE_KEY, activated);
            saveJson(LEGACY_PROFILE_KEY, activated);

            if (state.config) {
                state.config.isAdmin = Boolean(activated.isAdmin);
                if (!activated.isAdmin) {
                    state.config.serverUsers = [];
                    state.config.approvedGoogleAccounts = [];
                }
                if (res.serverId) {
                    state.config.serverId = res.serverId;
                }
                if (Array.isArray(state.config.profiles)) {
                    for (var i = 0; i < state.config.profiles.length; i++) {
                        if (state.config.profiles[i].id === activated.id) {
                            state.config.profiles[i].jellyfinUserId = activated.jellyfinUserId;
                            state.config.profiles[i].jellyfinUsername = activated.jellyfinUsername;
                            break;
                        }
                    }
                }
                saveJson(CACHED_CONFIG_KEY, state.config);
            }

            applyJellyfinServerCredentials({
                serverId: activated.serverId,
                userId: activated.jellyfinUserId,
                accessToken: activated.accessToken,
                user: res.user || null,
                sessionInfo: res.sessionInfo || null
            });

            closeOverlayGate();
            closeAccountDropdown();
            ensureHeaderWidgets();

            // Reset Cinema Hub cache for the newly selected profile's Jellyfin user
            state.hubData.userId = null;
            state.hubData.loaded = false;
            state.hubData.loading = false;
            var existingHub = document.getElementById('streamflix-cinema-hub');
            if (existingHub && existingHub.parentNode) {
                existingHub.parentNode.removeChild(existingHub);
            }

            // If we just completed Google OAuth, or #fallbackPage ("Page not found") is mounted, or the Jellyfin user changed,
            // navigate cleanly to #/home and reload once so Jellyfin Web boots directly on #/home with fresh credentials
            var normNewUid = normalizeGuid(activated.jellyfinUserId);
            var normPrevUid = normalizeGuid(prevUserId);
            var hasFallbackPage = Boolean(document.querySelector('#fallbackPage:not(.hide)'));
            var missingHomePage = !document.getElementById('indexPage');
            var lastReloadUid = '';
            try {
                lastReloadUid = sessionStorage.getItem('streamflix_reload_uid') || '';
            } catch (e) {}

            var shouldReload = state.justCompletedGoogleOAuth
                || hasFallbackPage
                || (normNewUid && normNewUid !== normPrevUid && lastReloadUid !== normNewUid)
                || (missingHomePage && lastReloadUid !== normNewUid);

            state.justCompletedGoogleOAuth = false;

            if (shouldReload) {
                try {
                    sessionStorage.setItem('streamflix_reload_uid', normNewUid || 'reloaded');
                } catch (e) {}
                window.location.hash = '#/home';
                window.location.reload();
                return activated;
            }

            if (window.location.hash !== '#/home') {
                window.location.hash = '#/home';
            }
            fetchPublicConfig().catch(function () {});
            ensureCinemaHubMounted();
            loadCinemaHubData(false);
            return activated;
        }).catch(function (err) {
            state.activatingProfileId = null;
            throw err;
        });
    }

    /* ----------------------------------------------------------------------
       UI primitives: overlay stage, modals, toasts, confirm dialogs, PIN pad
       ---------------------------------------------------------------------- */
    var GOOGLE_G_SVG = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

    function prefersReducedMotion() {
        try {
            return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) {
            return false;
        }
    }

    function randomToken(byteCount) {
        var n = byteCount || 16;
        var out = '';
        try {
            var arr = new Uint8Array(n);
            (window.crypto || window.msCrypto).getRandomValues(arr);
            for (var i = 0; i < arr.length; i++) {
                out += ('0' + arr[i].toString(16)).slice(-2);
            }
            return out;
        } catch (e) {
            for (var j = 0; j < n * 2; j++) {
                out += Math.floor(Math.random() * 16).toString(16);
            }
            return out;
        }
    }

    function ensureOverlayRoot() {
        syncDeviceLayoutClasses();
        document.body.classList.add('streamflix-gate-locked');
        var root = document.getElementById('streamflix-overlay-root');
        if (!root) {
            var stale = document.getElementById('streamflix-overlay-root-closing');
            if (stale && stale.parentNode) {
                stale.parentNode.removeChild(stale);
            }
            root = document.createElement('div');
            root.id = 'streamflix-overlay-root';
            root.className = 'streamflix-overlay';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.innerHTML = ''
                + buildNetflixBackdropWallHtml()
                + '<div class="streamflix-topbar" id="streamflix-gate-topbar">'
                + '  <div class="streamflix-wordmark">STREAMFLIX</div>'
                + '  <div class="streamflix-topbar-actions" id="streamflix-gate-actions"></div>'
                + '</div>'
                + '<div class="streamflix-stage" id="streamflix-stage"></div>';
            document.body.appendChild(root);
        }
        return root;
    }

    function isPickerGateView(viewKey) {
        return typeof viewKey === 'string' && viewKey.indexOf('picker') === 0;
    }

    function syncNetflixBackdropWallForView(viewKey) {
        var root = document.getElementById('streamflix-overlay-root');
        if (root && viewKey !== undefined && viewKey !== null) {
            root.setAttribute('data-gate-view', String(viewKey));
        }
        var grid = document.getElementById('streamflix-netflix-wall-grid');
        if (!grid) {
            return;
        }
        // Never show library movie pictures on the unauthenticated login / setup screens — only in the profile picker.
        if (!isPickerGateView(viewKey) || !hasHouseholdAccess()) {
            if (grid.innerHTML !== '') {
                grid.innerHTML = '';
            }
            return;
        }
        var items = getShowcaseItemsForWall();
        var existingImgs = grid.querySelectorAll('img');
        if (grid.children.length === 0 || (existingImgs.length === 0 && items.length > 0)) {
            grid.innerHTML = buildNetflixBackdropWallGridTilesHtml();
            bindNetflixWallImageFallbacks(grid);
        }
    }

    // Swaps the gate's centre content without rebuilding the mosaic wall unnecessarily, animating only when the view changes.
    function setGateView(viewKey, actionsHtml, stageHtml) {
        var root = ensureOverlayRoot();
        root.setAttribute('data-gate-view', viewKey || '');
        var actions = root.querySelector('#streamflix-gate-actions');
        var stage = root.querySelector('#streamflix-stage');
        if (actions) {
            actions.innerHTML = actionsHtml || '';
        }
        if (stage) {
            var changed = stage.getAttribute('data-view') !== viewKey;
            stage.setAttribute('data-view', viewKey);
            stage.innerHTML = stageHtml;
            stage.classList.toggle('streamflix-stage-static', !changed);
            if (changed && !prefersReducedMotion()) {
                stage.classList.remove('streamflix-stage-enter');
                void stage.offsetWidth;
                stage.classList.add('streamflix-stage-enter');
            }
        }
        syncNetflixBackdropWallForView(viewKey);
        return root;
    }

    function closeOverlayGate() {
        document.body.classList.remove('streamflix-gate-locked');
        var root = document.getElementById('streamflix-overlay-root');
        if (!root) {
            return;
        }
        // Rename immediately so every "is the gate open?" check sees it as closed while it fades out
        root.id = 'streamflix-overlay-root-closing';
        root.classList.add('streamflix-overlay-leaving');
        setTimeout(function () {
            if (root.parentNode) {
                root.parentNode.removeChild(root);
            }
        }, prefersReducedMotion() ? 0 : 280);
    }

    function showToast(message, type, timeoutMs) {
        if (!message || !document.body) {
            return;
        }
        var host = document.getElementById('streamflix-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'streamflix-toast-host';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        var toast = document.createElement('div');
        toast.className = 'streamflix-toast streamflix-toast-' + (type || 'info');
        var icon = type === 'error' ? '!' : (type === 'success' ? '✓' : 'i');
        toast.innerHTML = '<span class="streamflix-toast-icon">' + icon + '</span><span class="streamflix-toast-msg">' + escapeHtml(message) + '</span>';
        host.appendChild(toast);
        while (host.children.length > 3) {
            host.removeChild(host.firstChild);
        }
        var removeToast = function () {
            if (!toast.parentNode || toast.classList.contains('streamflix-toast-leave')) {
                return;
            }
            toast.classList.add('streamflix-toast-leave');
            setTimeout(function () {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 240);
        };
        toast.addEventListener('click', removeToast);
        setTimeout(removeToast, timeoutMs || (type === 'error' ? 5200 : 3200));
    }

    function showActionToast(message, actionLabel, onAction, timeoutMs) {
        if (!message || !document.body) {
            return null;
        }
        var dur = timeoutMs || 5000;
        var host = document.getElementById('streamflix-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'streamflix-toast-host';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        var prevUndo = host.querySelectorAll('.streamflix-toast-action');
        for (var i = 0; i < prevUndo.length; i++) {
            if (prevUndo[i].parentNode) {
                prevUndo[i].parentNode.removeChild(prevUndo[i]);
            }
        }
        var toast = document.createElement('div');
        toast.className = 'streamflix-toast streamflix-toast-info streamflix-toast-action';
        toast.style.setProperty('--bfx-toast-ms', dur + 'ms');
        toast.innerHTML = ''
            + '<span class="streamflix-toast-msg">' + escapeHtml(message) + '</span>'
            + '<button type="button" class="streamflix-toast-undo-btn">' + icon('undo') + '<span>' + escapeHtml(actionLabel || 'Undo') + '</span></button>'
            + '<button type="button" class="streamflix-toast-dismiss" title="Dismiss" aria-label="Dismiss">' + icon('close') + '</button>'
            + '<span class="streamflix-toast-progress" aria-hidden="true"></span>';
        host.appendChild(toast);
        while (host.children.length > 3) {
            host.removeChild(host.firstChild);
        }
        var handled = false;
        var timer = null;
        var removeToast = function () {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (!toast.parentNode || toast.classList.contains('streamflix-toast-leave')) {
                return;
            }
            toast.classList.add('streamflix-toast-leave');
            setTimeout(function () {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, prefersReducedMotion() ? 0 : 220);
        };
        var undoBtn = toast.querySelector('.streamflix-toast-undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (handled) {
                    return;
                }
                handled = true;
                removeToast();
                if (typeof onAction === 'function') {
                    onAction();
                }
            });
        }
        var disBtn = toast.querySelector('.streamflix-toast-dismiss');
        if (disBtn) {
            disBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                removeToast();
            });
        }
        timer = setTimeout(removeToast, dur);
        return toast;
    }

    function openModal(innerHtml, options) {
        options = options || {};
        var backdrop = document.createElement('div');
        backdrop.className = 'streamflix-modal-backdrop streamflix-modal-animated';
        backdrop.innerHTML = '<div class="streamflix-modal ' + (options.className || '') + '" role="dialog" aria-modal="true">' + innerHtml + '</div>';
        document.body.appendChild(backdrop);
        var closed = false;
        var priorFocus = document.activeElement;

        function onKey(ev) {
            if (isRemoteBackEvent(ev) && options.dismissible !== false) {
                ev.preventDefault();
                ev.stopPropagation();
                close();
            }
        }

        function close(result) {
            if (closed) {
                return;
            }
            closed = true;
            document.removeEventListener('keydown', onKey, true);
            backdrop.classList.add('streamflix-modal-leave');
            setTimeout(function () {
                if (backdrop.parentNode) {
                    backdrop.parentNode.removeChild(backdrop);
                }
            }, prefersReducedMotion() ? 0 : 190);
            if (typeof options.onClose === 'function') {
                options.onClose(result);
            }
            if (isTvOrDpadActive() && priorFocus && priorFocus.focus && document.contains(priorFocus)) {
                setTimeout(function () {
                    try { priorFocus.focus({ preventScroll: true }); } catch (e) {}
                }, 20);
            }
        }

        document.addEventListener('keydown', onKey, true);
        backdrop.addEventListener('mousedown', function (ev) {
            if (ev.target === backdrop && options.dismissible !== false) {
                close();
            }
        });

        return {
            el: backdrop,
            modal: backdrop.firstChild,
            close: close,
            isClosed: function () { return closed; }
        };
    }

    function confirmDialog(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var m = openModal(''
                + '<h2>' + escapeHtml(opts.title || 'Are you sure?') + '</h2>'
                + '<p class="streamflix-modal-text">' + escapeHtml(opts.message || '') + '</p>'
                + '<div class="streamflix-modal-actions streamflix-modal-actions-end">'
                + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">' + escapeHtml(opts.cancelText || 'Cancel') + '</button>'
                + '  <button type="button" class="' + (opts.danger ? 'streamflix-btn-danger' : 'streamflix-btn-primary') + '" data-act="ok">' + escapeHtml(opts.confirmText || 'OK') + '</button>'
                + '</div>', {
                className: 'streamflix-modal-sm',
                onClose: function (result) { resolve(result === true); }
            });
            m.modal.querySelector('[data-act="cancel"]').addEventListener('click', function () { m.close(false); });
            var okBtn = m.modal.querySelector('[data-act="ok"]');
            okBtn.addEventListener('click', function () { m.close(true); });
            setTimeout(function () {
                try { okBtn.focus(); } catch (e) {}
            }, 40);
        });
    }

    // Netflix-style PIN entry: digit boxes, auto-submit, paste support, shake on error.
    function openPinPad(opts) {
        var profile = opts.profile || {};
        var len = profile.pinLength > 0 ? Math.min(8, profile.pinLength) : 4;
        var boxesHtml = '';
        for (var i = 0; i < len; i++) {
            boxesHtml += '<span class="streamflix-pin-box"></span>';
        }
        var m = openModal(''
            + '<div class="streamflix-pin-avatar" style="background:' + escapeHtml(profile.color || '#E50914') + ';">' + escapeHtml(profile.icon || '🔒') + '</div>'
            + '<h2>' + escapeHtml(opts.title || 'Profile Lock') + '</h2>'
            + '<p class="streamflix-modal-text">' + (opts.subtitleHtml || ('Enter your PIN to open <strong>' + escapeHtml(profile.name || '') + '</strong>.')) + '</p>'
            + '<label class="streamflix-pin-pad">'
            + '  <input type="password" class="streamflix-pin-input" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="' + len + '" aria-label="PIN" />'
            + '  <span class="streamflix-pin-boxes">' + boxesHtml + '</span>'
            + '</label>'
            + '<div class="streamflix-pin-msg" aria-live="assertive">' + escapeHtml(opts.initialError || '') + '</div>'
            + '<div class="streamflix-modal-actions streamflix-modal-actions-center">'
            + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">Cancel</button>'
            + '</div>', { className: 'streamflix-modal-pin' });

        var input = m.modal.querySelector('.streamflix-pin-input');
        var boxEls = m.modal.querySelectorAll('.streamflix-pin-box');
        var msg = m.modal.querySelector('.streamflix-pin-msg');
        var busy = false;

        function paint() {
            var v = input.value;
            var focused = document.activeElement === input;
            for (var k = 0; k < boxEls.length; k++) {
                boxEls[k].classList.toggle('filled', k < v.length);
                boxEls[k].classList.toggle('active', focused && k === Math.min(v.length, len - 1));
            }
        }

        function fail(text) {
            msg.textContent = text || 'Incorrect PIN. Please try again.';
            m.modal.classList.remove('streamflix-shake');
            void m.modal.offsetWidth;
            m.modal.classList.add('streamflix-shake');
            input.value = '';
            paint();
            try { input.focus(); } catch (e) {}
        }

        function submit() {
            if (busy || input.disabled) {
                return;
            }
            var pin = input.value;
            if (pin.length < len) {
                return;
            }
            busy = true;
            m.modal.classList.add('streamflix-busy');
            msg.textContent = '';
            Promise.resolve(opts.submit(pin)).then(function (result) {
                busy = false;
                m.close(true);
                if (typeof opts.onSuccess === 'function') {
                    opts.onSuccess(pin, result);
                }
            }).catch(function (err) {
                busy = false;
                m.modal.classList.remove('streamflix-busy');
                var code = err && err.code;
                if (code === 'pin_locked') {
                    fail(err.message);
                    input.disabled = true;
                    var waitSecs = (err.data && err.data.retryAfterSeconds) || 60;
                    setTimeout(function () {
                        input.disabled = false;
                        msg.textContent = '';
                    }, Math.min(waitSecs * 1000, 300000));
                    return;
                }
                if (code === 'pin_invalid' || code === 'pin_required') {
                    fail(err.message);
                    return;
                }
                m.close(false);
                if (typeof opts.onError === 'function') {
                    opts.onError(err);
                } else {
                    showToast((err && err.message) || 'Something went wrong.', 'error');
                }
            });
        }

        input.addEventListener('input', function () {
            input.value = input.value.replace(/\D/g, '').slice(0, len);
            if (msg.textContent && !busy) {
                msg.textContent = '';
            }
            paint();
            if (input.value.length === len) {
                submit();
            }
        });
        input.addEventListener('focus', paint);
        input.addEventListener('blur', paint);
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                submit();
            }
        });
        m.modal.querySelector('[data-act="cancel"]').addEventListener('click', function () { m.close(false); });
        setTimeout(function () {
            try { input.focus(); } catch (e) {}
            paint();
        }, 40);
        if (opts.initialError) {
            m.modal.classList.add('streamflix-shake');
        }
        return m;
    }

    function getShowcaseItemsForWall() {
        var list = [];
        if (!hasHouseholdAccess()) {
            return list;
        }
        var seen = {};

        function pushCandidate(id, name, type) {
            if (!id) {
                return;
            }
            var norm = normalizeGuid(id);
            if (!norm || seen[norm]) {
                return;
            }
            seen[norm] = true;
            list.push({
                id: String(id),
                name: String(name || 'Featured Title'),
                type: String(type || 'Movie')
            });
        }

        // 1. Server-provided showcaseItems from /StreamFlix/PublicConfig ([AllowAnonymous])
        if (state.config && Array.isArray(state.config.showcaseItems)) {
            state.config.showcaseItems.forEach(function (it) {
                if (it && (it.id || it.Id)) {
                    pushCandidate(it.id || it.Id, it.name || it.Name, it.type || it.Type);
                }
            });
        }

        // 2. Loaded Cinema Hub movies & series if available in memory
        if (state.hubData) {
            var memPools = [
                state.hubData.heroItems,
                state.hubData.top10Items,
                state.hubData.allMovies,
                state.hubData.allSeries
            ];
            memPools.forEach(function (pool) {
                if (Array.isArray(pool)) {
                    pool.forEach(function (it) {
                        if (it && it.Id && (it.Type === 'Movie' || it.Type === 'Series')) {
                            pushCandidate(it.Id, it.Name, it.Type);
                        }
                    });
                }
            });
        }

        // 3. Cached showcase items in localStorage
        var cachedShowcase = loadJson(SHOWCASE_ITEMS_KEY, []);
        if (Array.isArray(cachedShowcase)) {
            cachedShowcase.forEach(function (it) {
                if (it && (it.id || it.Id)) {
                    pushCandidate(it.id || it.Id, it.name || it.Name, it.type || it.Type);
                }
            });
        }

        // 4. Cached items in state.itemCache
        if (state.itemCache && typeof state.itemCache === 'object') {
            Object.keys(state.itemCache).forEach(function (k) {
                var it = state.itemCache[k];
                if (it && it.Id && (it.Type === 'Movie' || it.Type === 'Series')) {
                    pushCandidate(it.Id, it.Name, it.Type);
                }
            });
        }

        return list;
    }

    function buildNetflixBackdropWallGridTilesHtml() {
        var items = getShowcaseItemsForWall();
        var totalTiles = 36;
        var fallbackPalettes = [
            'linear-gradient(135deg, #2b090c 0%, #12131a 60%, #090a0f 100%)',
            'linear-gradient(135deg, #0d1b2a 0%, #1b263b 60%, #090a0f 100%)',
            'linear-gradient(135deg, #1f1135 0%, #111625 60%, #090a0f 100%)',
            'linear-gradient(135deg, #1b2d2a 0%, #101820 60%, #090a0f 100%)',
            'linear-gradient(135deg, #331812 0%, #17131c 60%, #090a0f 100%)',
            'linear-gradient(135deg, #192236 0%, #12131a 60%, #090a0f 100%)'
        ];
        var base = apiBase();
        var tilesHtml = '';

        for (var i = 0; i < totalTiles; i++) {
            var palette = fallbackPalettes[i % fallbackPalettes.length];
            if (items.length > 0) {
                var item = items[i % items.length];
                var eid = encodeURIComponent(item.id);
                var backdropSrc = base + '/Items/' + eid + '/Images/Backdrop/0?maxWidth=520&quality=80';
                var primarySrc = base + '/Items/' + eid + '/Images/Primary?maxWidth=380&quality=80';
                tilesHtml += ''
                    + '<div class="streamflix-netflix-wall-tile" style="background:' + palette + ';">'
                    + '  <img src="' + escapeHtml(backdropSrc) + '" data-fallback-src="' + escapeHtml(primarySrc) + '" alt="' + escapeHtml(item.name) + '" loading="eager" decoding="async" />'
                    + '  <span class="streamflix-netflix-wall-badge">S</span>'
                    + '  <div class="streamflix-netflix-wall-caption">' + escapeHtml(item.name) + '</div>'
                    + '</div>';
            } else {
                tilesHtml += ''
                    + '<div class="streamflix-netflix-wall-tile" style="background:' + palette + ';">'
                    + '  <span class="streamflix-netflix-wall-badge">S</span>'
                    + '</div>';
            }
        }
        return tilesHtml;
    }

    function buildNetflixBackdropWallHtml() {
        return ''
            + '<div class="streamflix-netflix-wall-wrap" aria-hidden="true">'
            + '  <div class="streamflix-netflix-wall-grid" id="streamflix-netflix-wall-grid"></div>'
            + '  <div class="streamflix-netflix-wall-scrim"></div>'
            + '  <div class="streamflix-netflix-horizon-arc"></div>'
            + '</div>';
    }

    function bindNetflixWallImageFallbacks(container) {
        if (!container) {
            return;
        }
        var imgs = container.querySelectorAll('.streamflix-netflix-wall-tile img');
        Array.prototype.forEach.call(imgs, function (img) {
            if (img.getAttribute('data-streamflix-bound') === '1') {
                return;
            }
            img.setAttribute('data-streamflix-bound', '1');
            if (img.complete && img.naturalWidth > 0) {
                img.classList.add('is-loaded');
            } else {
                img.addEventListener('load', function () {
                    img.classList.add('is-loaded');
                });
            }
            img.addEventListener('error', function () {
                var fallback = img.getAttribute('data-fallback-src');
                if (fallback && img.getAttribute('data-tried-fallback') !== '1') {
                    img.setAttribute('data-tried-fallback', '1');
                    img.src = fallback;
                } else {
                    img.style.display = 'none';
                }
            });
        });
    }

    function refreshNetflixBackdropWallInPlace() {
        var stage = document.getElementById('streamflix-stage');
        var viewKey = stage ? (stage.getAttribute('data-view') || '') : '';
        syncNetflixBackdropWallForView(viewKey);
    }

    /* ----------------------------------------------------------------------
       3. Screen A: Google Sign-In Gate (server-verified, signed household session)
       ---------------------------------------------------------------------- */
    function renderGoogleAuthGate(statusText, errorText) {
        var cfg = state.config || DEFAULT_CONFIG;
        var busy = Boolean(state.verifyingGoogle);
        var stageHtml;

        if (!cfg.googleConfigured && !state.configFresh && !state.configAttempted) {
            // Server config hasn't arrived yet: show a neutral loader instead of flashing the setup card
            setGateView('loading', '', ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card streamflix-auth-card-loading"><span class="streamflix-inline-spinner"></span></div>'
                + '</div>');
            return;
        }

        if (!cfg.googleConfigured) {
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card streamflix-auth-card-setup">'
                + '    <div class="streamflix-auth-kicker">Almost there</div>'
                + '    <h1>Finish setting up StreamFlix</h1>'
                + '    <p>Google Sign-In hasn\'t been configured yet. A Jellyfin administrator needs to add a Google OAuth Client ID in <strong>Dashboard → Plugins → StreamFlix</strong>.</p>'
                + '    <ol class="streamflix-auth-steps">'
                + '      <li>Sign in with your Jellyfin administrator account.</li>'
                + '      <li>Open <strong>StreamFlix</strong> plugin settings and paste your OAuth Client ID.</li>'
                + '      <li>Add this Authorized Redirect URI in Google Cloud Console:<code class="streamflix-auth-code">' + escapeHtml(getGoogleRedirectUri()) + '</code></li>'
                + '    </ol>'
                + (errorText ? '<div class="streamflix-auth-alert streamflix-auth-alert-error">' + escapeHtml(errorText) + '</div>' : '')
                + '    <button type="button" class="streamflix-btn-primary streamflix-btn-block" id="streamflix-admin-login-btn">Administrator sign-in</button>'
                + '  </div>'
                + '</div>';
        } else {
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card' + (busy ? ' streamflix-busy' : '') + '">'
                + '    <h1>Sign in</h1>'
                + '    <p>Use your approved Google account to unlock StreamFlix on this device. You\'ll choose who\'s watching next.</p>'
                + (statusText
                    ? '<div class="streamflix-auth-alert"><span class="streamflix-inline-spinner"></span>' + escapeHtml(statusText) + '</div>'
                    : '')
                + (errorText
                    ? '<div class="streamflix-auth-alert streamflix-auth-alert-error">' + escapeHtml(errorText) + '</div>'
                    : '')
                + '    <button type="button" class="streamflix-google-btn" id="streamflix-google-login-btn"' + (busy ? ' disabled' : '') + '>'
                + GOOGLE_G_SVG
                + '      <span>' + (busy ? 'Verifying…' : 'Continue with Google') + '</span>'
                + '    </button>'
                + '  </div>'
                + '</div>';
        }

        var root = setGateView(cfg.googleConfigured ? 'auth' : 'setup', '', stageHtml);

        var loginBtn = root.querySelector('#streamflix-google-login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', function () {
                startGoogleOAuthRedirect('', '');
            });
            if (!busy) {
                setTimeout(function () {
                    try { loginBtn.focus(); } catch (e) {}
                }, 60);
            }
        }

        var adminBtn = root.querySelector('#streamflix-admin-login-btn');
        if (adminBtn) {
            adminBtn.addEventListener('click', function () {
                // Setup screen only (Google not configured yet): let Jellyfin's own password login through
                // so an administrator can finish configuring the plugin.
                closeOverlayGate();
                window.location.hash = '#/login';
            });
        }
    }

    /* ----------------------------------------------------------------------
       4. Screen B: "Who's watching?" Profile Picker + Reordering + Locks
       ---------------------------------------------------------------------- */
    function getProfiles() {
        return (state.config && Array.isArray(state.config.profiles)) ? state.config.profiles : [];
    }

    function findProfileById(pid) {
        var list = getProfiles();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === pid) {
                return list[i];
            }
        }
        return null;
    }

    function isHouseholdAdmin() {
        return Boolean(state.config && state.config.isAdmin);
    }

    function isGateOpen() {
        return Boolean(document.getElementById('streamflix-overlay-root'));
    }

    function rerenderPickerIfOpen() {
        var stage = document.getElementById('streamflix-stage');
        if (isGateOpen() && stage && String(stage.getAttribute('data-view') || '').indexOf('picker') === 0) {
            renderProfilePickerGate();
        }
    }

    function reorderProfilesByDelta(profileId, delta) {
        var profiles = getProfiles().slice();
        var idx = -1;
        for (var i = 0; i < profiles.length; i++) {
            if (profiles[i].id === profileId) {
                idx = i;
                break;
            }
        }
        var targetIdx = idx + delta;
        if (idx === -1 || targetIdx < 0 || targetIdx >= profiles.length) {
            return;
        }
        var temp = profiles[idx];
        profiles[idx] = profiles[targetIdx];
        profiles[targetIdx] = temp;
        persistProfileOrder(profiles);
    }

    function reorderProfilesDragDrop(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId) {
            return;
        }
        var profiles = getProfiles().slice();
        var srcIdx = -1;
        var dstIdx = -1;
        for (var i = 0; i < profiles.length; i++) {
            if (profiles[i].id === sourceId) {
                srcIdx = i;
            }
            if (profiles[i].id === targetId) {
                dstIdx = i;
            }
        }
        if (srcIdx === -1 || dstIdx === -1) {
            return;
        }
        var moved = profiles.splice(srcIdx, 1)[0];
        profiles.splice(dstIdx, 0, moved);
        persistProfileOrder(profiles);
    }

    function persistProfileOrder(orderedProfiles) {
        state.config.profiles = orderedProfiles;
        saveJson(CACHED_CONFIG_KEY, state.config);
        rerenderPickerIfOpen();
        apiFetch('/StreamFlix/Profiles/Reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profileIds: orderedProfiles.map(function (p) { return p.id; })
            })
        }).then(function (updatedState) {
            applyConfigFromServerResponse(updatedState);
            rerenderPickerIfOpen();
        }).catch(function (err) {
            showToast((err && err.message) || 'Could not save the new order.', 'error');
            fetchPublicConfig().then(rerenderPickerIfOpen);
        });
    }

    function buildAccountChipHtml() {
        var g = state.googleUser;
        if (!g || !g.email) {
            return '';
        }
        var avatar = g.picture
            ? '<img src="' + escapeHtml(g.picture) + '" alt="" referrerpolicy="no-referrer" />'
            : '<span class="streamflix-account-chip-initial">' + escapeHtml(g.email.charAt(0).toUpperCase()) + '</span>';
        return '<div class="streamflix-account-chip" title="Signed in with Google">' + avatar
            + '<span class="streamflix-account-chip-email">' + escapeHtml(g.email) + '</span></div>';
    }

    function renderProfilePickerGate() {
        var profiles = getProfiles();
        var isAdmin = isHouseholdAdmin();
        var manage = Boolean(state.manageMode);

        var cardsHtml = profiles.map(function (p, idx) {
            var lockedOut = p.googleLocked && !p.googleLockSatisfied;
            var lockLabel = p.googleAccountEmail || p.googleAccountHint || '';
            var badges = ''
                + (p.hasPin ? '<span class="streamflix-tile-badge" title="PIN protected">' + icon('lock') + '</span>' : '')
                + (p.googleLocked ? '<span class="streamflix-tile-badge streamflix-tile-badge-g" title="Locked to ' + escapeHtml(lockLabel) + '">G</span>' : '');
            var roleBadge = p.isAdmin ? 'Admin' : (p.isKids ? 'Kids' : 'Profile');
            var linkedUserLabel = p.jellyfinUsername || p.name;
            var canDelete = profiles.length > 1 && (!(p.isOwner || p.isAdmin) || isAdmin);
            var title = lockedOut ? ('Locked to ' + lockLabel) : (manage ? 'Edit ' + p.name : 'Open ' + p.name);

            return ''
                + '<div class="streamflix-profile-tile' + (lockedOut ? ' streamflix-tile-locked' : '') + '" tabindex="0" role="button" style="--i:' + idx + ';--pc:' + escapeHtml(p.color || '#E50914') + ';"'
                + (manage ? ' draggable="true"' : '')
                + ' data-profile-id="' + escapeHtml(p.id) + '" data-profile-idx="' + idx + '" title="' + escapeHtml(title) + '">'
                + '  <div class="streamflix-profile-avatar" style="background:' + escapeHtml(p.color || '#E50914') + ';">'
                + (manage ? '<span class="streamflix-profile-order-badge">#' + (idx + 1) + '</span>' : '')
                + '    <span class="streamflix-profile-emoji">' + escapeHtml(p.icon || '🎬') + '</span>'
                + (p.isKids ? '<span class="streamflix-profile-kids-ribbon">KIDS</span>' : '')
                + (badges ? '<span class="streamflix-tile-badges">' + badges + '</span>' : '')
                + (manage ? '<div class="streamflix-profile-edit-scrim">' + icon('edit') + '</div>' : '')
                + '    <span class="streamflix-tile-spinner" aria-hidden="true"></span>'
                + '  </div>'
                + '  <div class="streamflix-profile-name">' + escapeHtml(p.name) + '</div>'
                + (manage
                    ? '<div class="streamflix-profile-meta" title="Linked Jellyfin user: ' + escapeHtml(linkedUserLabel) + '">'
                      + '<span class="streamflix-profile-role">' + escapeHtml(roleBadge) + '</span><span class="streamflix-profile-linked">' + icon('link') + escapeHtml(linkedUserLabel) + '</span>'
                      + '</div>'
                      + '<div class="streamflix-profile-reorder-bar">'
                      + '  <button type="button" class="streamflix-reorder-btn" data-move-left="' + escapeHtml(p.id) + '" title="Move left" aria-label="Move left"' + (idx === 0 ? ' disabled' : '') + '>' + icon('chevronLeft') + '</button>'
                      + '  <button type="button" class="streamflix-reorder-btn" data-edit-profile-id="' + escapeHtml(p.id) + '" title="Edit profile" aria-label="Edit profile">' + icon('edit') + '</button>'
                      + (canDelete
                          ? '<button type="button" class="streamflix-reorder-btn streamflix-reorder-btn-danger" data-delete-profile-id="' + escapeHtml(p.id) + '" title="Delete profile" aria-label="Delete profile">' + icon('trash') + '</button>'
                          : '')
                      + '  <button type="button" class="streamflix-reorder-btn" data-move-right="' + escapeHtml(p.id) + '" title="Move right" aria-label="Move right"' + (idx === profiles.length - 1 ? ' disabled' : '') + '>' + icon('chevronRight') + '</button>'
                      + '</div>'
                    : '')
                + '</div>';
        }).join('');

        var addTileHtml = ''
            + '<div class="streamflix-profile-tile streamflix-add-tile" id="streamflix-add-profile-tile" tabindex="0" role="button" style="--i:' + profiles.length + ';">'
            + '  <div class="streamflix-profile-avatar streamflix-add-avatar">' + icon('plus') + '</div>'
            + '  <div class="streamflix-profile-name">Add Profile</div>'
            + '</div>';

        var actionsHtml = buildAccountChipHtml()
            + (state.googleUser && state.googleUser.email
                ? '<button type="button" class="streamflix-ghost-btn" id="streamflix-google-signout-btn">Sign out</button>'
                : '')
            + (state.activeProfile && state.activeProfile.accessToken
                ? '<button type="button" class="streamflix-ghost-btn streamflix-ghost-btn-accent" id="streamflix-resume-session-btn">' + icon('chevronLeft') + '<span>Back to StreamFlix</span></button>'
                : '');

        var stageHtml = ''
            + '<div class="streamflix-center-stage">'
            + '  <h1 class="streamflix-whos-watching-title">' + (manage ? 'Manage Profiles' : 'Who\'s watching?') + '</h1>'
            + '  <p class="streamflix-whos-watching-subtitle">'
            + (manage
                ? 'Tap a profile to edit its name, avatar, PIN or Google lock. Drag or use the arrows to reorder.'
                : (profiles.length ? 'Pick your profile to jump back into your shows.' : 'Create your first profile to get started.'))
            + '  </p>'
            + '  <div class="streamflix-profiles-grid">' + cardsHtml + addTileHtml + '</div>'
            + '  <button type="button" class="streamflix-manage-btn' + (manage ? ' active' : '') + '" id="streamflix-toggle-manage-btn">' + (manage ? icon('check') + '<span>Done</span>' : icon('edit') + '<span>Manage Profiles</span>') + '</button>'
            + '</div>';

        var root = setGateView(manage ? 'picker-manage' : 'picker', actionsHtml, stageHtml);

        var tiles = root.querySelectorAll('.streamflix-profile-tile[data-profile-id]');
        Array.prototype.forEach.call(tiles, function (tile) {
            var pid = tile.getAttribute('data-profile-id');
            var profile = findProfileById(pid);
            if (!profile) {
                return;
            }

            var activate = function () {
                if (state.manageMode) {
                    openProfileEditorModal(profile);
                } else {
                    handleSelectProfile(profile);
                }
            };

            tile.addEventListener('click', function (ev) {
                if (ev.target && ev.target.closest && ev.target.closest('button')) {
                    return;
                }
                activate();
            });
            tile.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    activate();
                }
            });

            if (!manage) {
                return;
            }

            tile.addEventListener('dragstart', function (ev) {
                state.dragSourceProfileId = pid;
                tile.classList.add('dragging');
                if (ev.dataTransfer) {
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', pid);
                }
            });
            tile.addEventListener('dragend', function () {
                tile.classList.remove('dragging');
                Array.prototype.forEach.call(tiles, function (t) { t.classList.remove('drag-over'); });
            });
            tile.addEventListener('dragover', function (ev) {
                ev.preventDefault();
                if (state.dragSourceProfileId && state.dragSourceProfileId !== pid) {
                    tile.classList.add('drag-over');
                }
            });
            tile.addEventListener('dragleave', function () {
                tile.classList.remove('drag-over');
            });
            tile.addEventListener('drop', function (ev) {
                ev.preventDefault();
                tile.classList.remove('drag-over');
                var srcId = state.dragSourceProfileId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain'));
                state.dragSourceProfileId = null;
                if (srcId && srcId !== pid) {
                    reorderProfilesDragDrop(srcId, pid);
                }
            });
        });

        Array.prototype.forEach.call(root.querySelectorAll('[data-move-left]'), function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                reorderProfilesByDelta(btn.getAttribute('data-move-left'), -1);
            });
        });
        Array.prototype.forEach.call(root.querySelectorAll('[data-move-right]'), function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                reorderProfilesByDelta(btn.getAttribute('data-move-right'), 1);
            });
        });
        Array.prototype.forEach.call(root.querySelectorAll('[data-edit-profile-id]'), function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var target = findProfileById(btn.getAttribute('data-edit-profile-id'));
                if (target) {
                    openProfileEditorModal(target);
                }
            });
        });
        Array.prototype.forEach.call(root.querySelectorAll('[data-delete-profile-id]'), function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var target = findProfileById(btn.getAttribute('data-delete-profile-id'));
                if (target) {
                    confirmAndDeleteProfile(target);
                }
            });
        });

        var addTile = root.querySelector('#streamflix-add-profile-tile');
        if (addTile) {
            var openAdd = function () { openProfileEditorModal(null); };
            addTile.addEventListener('click', openAdd);
            addTile.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    openAdd();
                }
            });
        }

        var manageBtn = root.querySelector('#streamflix-toggle-manage-btn');
        if (manageBtn) {
            manageBtn.addEventListener('click', function () {
                state.manageMode = !state.manageMode;
                renderProfilePickerGate();
            });
        }

        var signOutBtn = root.querySelector('#streamflix-google-signout-btn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', function () {
                signOutHousehold();
            });
        }

        var resumeBtn = root.querySelector('#streamflix-resume-session-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', function () {
                state.manageMode = false;
                closeOverlayGate();
                scheduleLifecycleTick(0);
            });
        }

        if (isTvOrDpadActive()) {
            var initialTile = root.querySelector('.streamflix-profile-tile:not(.streamflix-tile-locked)[data-profile-id]') || root.querySelector('.streamflix-profile-tile');
            if (initialTile) {
                setTimeout(function () {
                    try { initialTile.focus({ preventScroll: true }); } catch (e) {}
                }, 40);
            }
        }
    }

    function markTileSelecting(profileId, on) {
        var root = document.getElementById('streamflix-overlay-root');
        if (!root) {
            return;
        }
        var grid = root.querySelector('.streamflix-profiles-grid');
        if (grid) {
            grid.classList.toggle('streamflix-grid-busy', Boolean(on));
        }
        var tiles = root.querySelectorAll('.streamflix-profile-tile[data-profile-id]');
        Array.prototype.forEach.call(tiles, function (t) {
            t.classList.toggle('streamflix-tile-selecting', Boolean(on) && t.getAttribute('data-profile-id') === profileId);
        });
        var titleEl = root.querySelector('.streamflix-whos-watching-title');
        var profile = findProfileById(profileId);
        if (titleEl && !state.manageMode) {
            titleEl.textContent = on && profile ? ('Opening ' + profile.name + '…') : 'Who\'s watching?';
        }
    }

    function signOutHousehold() {
        var token = state.activeProfile && state.activeProfile.accessToken;
        if (token) {
            // Best effort: revoke this device's Jellyfin token so a shared device doesn't keep a live session
            try {
                var authVal = getEmbyAuthHeader(token);
                (nativeFetch || window.fetch)(apiBase() + '/Sessions/Logout', {
                    method: 'POST',
                    headers: { 'Authorization': authVal, 'X-Emby-Authorization': authVal, 'X-Emby-Token': token }
                }).catch(function () {});
            } catch (e) {}
        }
        clearHouseholdSession();
        state.activeProfile = null;
        state.legacyProfileToMigrate = null;
        state.manageMode = false;
        localStorage.removeItem(PROFILE_KEY);
        localStorage.removeItem(LEGACY_PROFILE_KEY);
        if (state.config) {
            state.config.hasAccess = state.config.requireGoogleAuth === false;
            state.config.isAdmin = false;
            state.config.serverUsers = [];
            state.config.approvedGoogleAccounts = [];
            if (!state.config.hasAccess) {
                state.config.profiles = [];
                clearShowcaseAndMediaCaches();
            }
            saveJson(CACHED_CONFIG_KEY, state.config);
        }
        closeAccountDropdown();
        ensureHeaderWidgets();
        if (state.config && state.config.requireGoogleAuth !== false) {
            renderGoogleAuthGate();
        } else {
            renderProfilePickerGate();
        }
        showToast('Signed out of StreamFlix on this device.', 'info');
    }

    function confirmAndDeleteProfile(profile, verifiedPin) {
        if (!profile || !profile.id) {
            return;
        }
        if (getProfiles().length <= 1) {
            showToast('You can\'t delete the last remaining profile.', 'error');
            return;
        }
        var isAdmin = isHouseholdAdmin();
        if (!isAdmin && (profile.isAdmin || profile.isOwner)) {
            showToast('Only an administrator can delete an administrator profile.', 'error');
            return;
        }
        if (!isAdmin && profile.googleLocked && !profile.googleLockSatisfied) {
            openGoogleLockPrompt(profile);
            return;
        }

        var doDelete = function (pin) {
            return apiFetch('/StreamFlix/Profiles/Delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profileId: profile.id,
                    deleteJellyfinUser: false,
                    currentPin: pin || null
                })
            }).then(function (updatedState) {
                applyConfigFromServerResponse(updatedState);
                if (state.activeProfile && state.activeProfile.id === profile.id) {
                    state.activeProfile = null;
                    localStorage.removeItem(PROFILE_KEY);
                }
                showToast('Deleted "' + profile.name + '".', 'success');
                rerenderPickerIfOpen();
                if (!isGateOpen() && !state.activeProfile) {
                    renderProfilePickerGate();
                }
            });
        };

        confirmDialog({
            title: 'Delete "' + profile.name + '"?',
            message: 'This removes the profile from StreamFlix. Its Jellyfin account and watch history stay on the server.',
            confirmText: 'Delete Profile',
            danger: true
        }).then(function (ok) {
            if (!ok) {
                return;
            }
            if (profile.hasPin && !isAdmin && !verifiedPin) {
                openPinPad({
                    profile: profile,
                    title: 'Enter PIN to delete',
                    subtitleHtml: 'Enter the PIN for <strong>' + escapeHtml(profile.name) + '</strong> to delete it.',
                    submit: doDelete
                });
                return;
            }
            doDelete(verifiedPin).catch(function (err) {
                showToast('Could not delete profile: ' + ((err && err.message) || 'Unknown error'), 'error');
            });
        });
    }

    function handleSelectProfile(profile) {
        if (!profile || state.activatingProfileId) {
            return;
        }
        if (profile.googleLocked && !profile.googleLockSatisfied) {
            openGoogleLockPrompt(profile);
            return;
        }
        if (profile.hasPin) {
            openPinUnlockModal(profile);
            return;
        }
        markTileSelecting(profile.id, true);
        activateServerProfile(profile, '').catch(function (err) {
            markTileSelecting(profile.id, false);
            handleActivationError(profile, err);
        });
    }

    function handleActivationError(profile, err) {
        var code = err && err.code;
        if (code === 'pin_required' || code === 'pin_invalid') {
            openPinUnlockModal(profile, code === 'pin_invalid' ? err.message : '');
            return;
        }
        if (code === 'google_lock') {
            if (err.data && err.data.requiredEmailHint) {
                profile.googleAccountHint = err.data.requiredEmailHint;
            }
            profile.googleLocked = true;
            profile.googleLockSatisfied = false;
            openGoogleLockPrompt(profile);
            return;
        }
        if (code === 'google_required') {
            return; // apiFetch already returned the user to the sign-in gate
        }
        showToast((err && err.message) || 'Could not open this profile.', 'error');
        if (code === 'profile_not_found') {
            fetchPublicConfig().then(rerenderPickerIfOpen);
        }
    }

    function openPinUnlockModal(profile, initialError) {
        openPinPad({
            profile: profile,
            title: 'Profile Lock',
            subtitleHtml: 'Enter your PIN to open <strong>' + escapeHtml(profile.name) + '</strong>.',
            initialError: initialError || '',
            submit: function (pin) {
                markTileSelecting(profile.id, true);
                return activateServerProfile(profile, pin).catch(function (err) {
                    markTileSelecting(profile.id, false);
                    throw err;
                });
            },
            onError: function (err) {
                handleActivationError(profile, err);
            }
        });
    }

    function openGoogleLockPrompt(profile) {
        var hint = profile.googleAccountEmail || profile.googleAccountHint || 'a specific Google account';
        var signedInAs = state.googleUser && state.googleUser.email;
        var m = openModal(''
            + '<div class="streamflix-pin-avatar" style="background:' + escapeHtml(profile.color || '#E50914') + ';">'
            + escapeHtml(profile.icon || '🎬')
            + '<span class="streamflix-glock-badge">G</span>'
            + '</div>'
            + '<h2>Locked to a Google account</h2>'
            + '<p class="streamflix-modal-text"><strong>' + escapeHtml(profile.name) + '</strong> can only be opened by <strong>' + escapeHtml(hint) + '</strong>.'
            + (signedInAs ? ' You\'re currently signed in as ' + escapeHtml(signedInAs) + '.' : '')
            + '</p>'
            + '<button type="button" class="streamflix-google-btn" data-act="google">' + GOOGLE_G_SVG + '<span>Continue with Google</span></button>'
            + '<div class="streamflix-modal-actions streamflix-modal-actions-center">'
            + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">Not now</button>'
            + '</div>', { className: 'streamflix-modal-pin' });
        m.modal.querySelector('[data-act="cancel"]').addEventListener('click', function () { m.close(); });
        m.modal.querySelector('[data-act="google"]').addEventListener('click', function () {
            m.close();
            startGoogleOAuthRedirect(profile.id, profile.googleAccountEmail || '');
        });
    }

    function findIconGroupId(emoji) {
        for (var g = 0; g < AVATAR_ICON_GROUPS.length; g++) {
            if (AVATAR_ICON_GROUPS[g].icons.indexOf(emoji) !== -1) {
                return AVATAR_ICON_GROUPS[g].id;
            }
        }
        return AVATAR_ICON_GROUPS[0].id;
    }

    function openProfileEditorModal(existingProfile, verifiedPin) {
        var isNew = !existingProfile;
        var isAdmin = isHouseholdAdmin();

        // Administrator/owner profiles can only be edited while signed in to an administrator profile.
        if (!isNew && !isAdmin && (existingProfile.isAdmin || existingProfile.isOwner)) {
            confirmDialog({
                title: 'Administrator Profile',
                message: 'Switch to "' + existingProfile.name + '" first to edit administrator profile settings or manage linked Jellyfin accounts.',
                confirmText: 'Switch to ' + existingProfile.name,
                cancelText: 'Cancel'
            }).then(function (ok) {
                if (ok) {
                    state.manageMode = false;
                    handleSelectProfile(existingProfile);
                }
            });
            return;
        }

        // Protected profiles can only be edited by someone who can open them (admins excepted)
        if (!isNew && !isAdmin) {
            if (existingProfile.googleLocked && !existingProfile.googleLockSatisfied) {
                openGoogleLockPrompt(existingProfile);
                return;
            }
            if (existingProfile.hasPin && !verifiedPin) {
                openPinPad({
                    profile: existingProfile,
                    title: 'Enter PIN to edit',
                    subtitleHtml: 'Enter the PIN for <strong>' + escapeHtml(existingProfile.name) + '</strong> to change its settings.',
                    submit: function (pin) {
                        return apiFetch('/StreamFlix/Profiles/VerifyPin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ profileId: existingProfile.id, pin: pin })
                        });
                    },
                    onSuccess: function (pin) {
                        openProfileEditorModal(existingProfile, pin);
                    }
                });
                return;
            }
        }

        var profileCount = getProfiles().length;
        var draft = existingProfile ? JSON.parse(JSON.stringify(existingProfile)) : {
            id: '',
            name: '',
            color: AVATAR_COLORS[profileCount % AVATAR_COLORS.length],
            icon: AVATAR_ICONS[profileCount % AVATAR_ICONS.length],
            isKids: false,
            maxParentalRating: MATURITY_LEVELS[0].value,
            hasPin: false,
            googleLocked: false,
            jellyfinUserId: '__CREATE__'
        };

        // Linked Jellyfin account: only administrators can view the server user list or change which account a profile uses.
        var serverUsers = (isAdmin && state.config && Array.isArray(state.config.serverUsers)) ? state.config.serverUsers : [];
        var userOptionsHtml = '';
        if (isAdmin) {
            userOptionsHtml = serverUsers.map(function (su) {
                var selected = draft.jellyfinUserId && normalizeGuid(draft.jellyfinUserId) === normalizeGuid(su.id) ? ' selected' : '';
                var adminAttr = su.isAdmin ? ' data-is-admin="1"' : '';
                return '<option value="' + escapeHtml(su.id) + '"' + selected + adminAttr + '>🔗 ' + escapeHtml(su.name + (su.isAdmin ? ' (Admin)' : '')) + '</option>';
            }).join('');
            var createSelected = (isNew || !draft.jellyfinUserId || draft.jellyfinUserId === '__CREATE__') ? ' selected' : '';
            userOptionsHtml += '<option value="__CREATE__"' + createSelected + '>➕ Create a new Jellyfin user for this profile</option>';
        }
        var lockedAccountTitle = isNew
            ? 'New dedicated Jellyfin user'
            : ((draft.jellyfinUsername || draft.name || 'Dedicated Jellyfin user') + (draft.isAdmin ? ' (Admin)' : ''));
        var linkedAccountSectionHtml = isAdmin
            ? (''
                + '<div class="streamflix-field">'
                + '  <label for="streamflix-prof-jfuser">Linked Jellyfin User</label>'
                + '  <select id="streamflix-prof-jfuser" class="streamflix-select">' + userOptionsHtml + '</select>'
                + '  <div class="streamflix-field-hint" id="streamflix-prof-jfuser-note"></div>'
                + '</div>')
            : (''
                + '<div class="streamflix-field">'
                + '  <label>Linked Jellyfin User</label>'
                + '  <div class="streamflix-linked-readonly" id="streamflix-prof-jfuser-locked">'
                + '    <span class="streamflix-linked-readonly-icon">' + icon('lock') + '</span>'
                + '    <div class="streamflix-linked-readonly-body">'
                + '      <div class="streamflix-linked-readonly-name">' + escapeHtml(lockedAccountTitle) + '</div>'
                + '      <div class="streamflix-linked-readonly-sub">'
                + (isNew
                    ? 'A separate, non-admin Jellyfin account will be created automatically for this profile.'
                    : 'Only an administrator can change which Jellyfin account a profile uses.')
                + '      </div>'
                + '    </div>'
                + '    <span class="streamflix-linked-readonly-pill">Admin only</span>'
                + '  </div>'
                + '</div>');

        // Google account lock options
        var sessionEmail = (state.googleUser && state.googleUser.email) ? String(state.googleUser.email).toLowerCase() : '';
        var currentLock = draft.googleAccountEmail ? String(draft.googleAccountEmail).toLowerCase() : '';
        var lockOptions = [{ value: '', label: 'Anyone in this household' }];
        var seenLock = { '': true };
        var addLockOption = function (email, label) {
            if (!email || seenLock[email]) {
                return;
            }
            seenLock[email] = true;
            lockOptions.push({ value: email, label: label || ('Only ' + email) });
        };
        if (draft.googleLocked && !currentLock) {
            lockOptions.push({ value: '__KEEP__', label: 'Only ' + (draft.googleAccountHint || 'the current Google account') + ' (keep)' });
        }
        if (currentLock) {
            addLockOption(currentLock, 'Only ' + currentLock + (currentLock === sessionEmail ? ' (you)' : ''));
        }
        if (sessionEmail) {
            addLockOption(sessionEmail, 'Only ' + sessionEmail + ' (you)');
        }
        if (isAdmin && state.config && Array.isArray(state.config.approvedGoogleAccounts)) {
            state.config.approvedGoogleAccounts.forEach(function (em) {
                addLockOption(String(em || '').trim().toLowerCase());
            });
        }
        var selectedLock = currentLock || (draft.googleLocked ? '__KEEP__' : '');
        var lockOptionsHtml = lockOptions.map(function (o) {
            return '<option value="' + escapeHtml(o.value) + '"' + (o.value === selectedLock ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
        }).join('');
        var lockSelectable = lockOptions.length > 1;

        var colorSwatchesHtml = AVATAR_COLORS.map(function (c) {
            var sel = c.toLowerCase() === (draft.color || '').toLowerCase() ? ' selected' : '';
            return '<button type="button" class="streamflix-swatch streamflix-color-swatch' + sel + '" data-color="' + escapeHtml(c) + '" style="background:' + escapeHtml(c) + ';" aria-label="Colour ' + escapeHtml(c) + '"></button>';
        }).join('');

        var activeGroupId = findIconGroupId(draft.icon);
        var groupTabsHtml = AVATAR_ICON_GROUPS.map(function (g) {
            var active = g.id === activeGroupId ? ' is-active' : '';
            return '<button type="button" class="streamflix-icon-tab' + active + '" data-icon-group="' + escapeHtml(g.id) + '">' + escapeHtml(g.label) + '</button>';
        }).join('');

        var maturityOptionsHtml = MATURITY_LEVELS.map(function (m) {
            var sel = m.value === draft.maxParentalRating ? ' selected' : '';
            return '<option value="' + escapeHtml(m.value) + '"' + sel + '>' + escapeHtml(m.label) + '</option>';
        }).join('');

        var canDelete = !isNew && profileCount > 1 && (!(draft.isOwner || draft.isAdmin) || isAdmin);

        var m = openModal(''
            + '<div class="streamflix-editor-head">'
            + '  <div class="streamflix-editor-preview" id="streamflix-prof-preview" style="background:' + escapeHtml(draft.color) + ';">' + escapeHtml(draft.icon) + '</div>'
            + '  <div class="streamflix-editor-head-copy">'
            + '    <div class="streamflix-editor-title-row">'
            + '      <h2>' + (isNew ? 'Add Profile' : 'Edit Profile') + '</h2>'
            + (draft.isAdmin ? '<span class="streamflix-editor-role-pill">' + icon('shield') + '<span>Admin</span></span>' : '')
            + '    </div>'
            + '    <p class="streamflix-modal-text">Each profile keeps its own watch history, Continue Watching and My List.</p>'
            + '  </div>'
            + '  <button type="button" class="streamflix-ghost-btn streamflix-shuffle-btn" id="streamflix-prof-shuffle" title="Randomize colour and icon">' + icon('shuffle') + '<span>Shuffle</span></button>'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="streamflix-prof-name">Name</label>'
            + '  <input type="text" id="streamflix-prof-name" class="streamflix-input" maxlength="40" value="' + escapeHtml(draft.name) + '" placeholder="e.g. Living Room, Movies, Kids" />'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label>Avatar Colour</label>'
            + '  <div class="streamflix-picker-row" id="streamflix-color-picker">' + colorSwatchesHtml + '</div>'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <div class="streamflix-field-label-row">'
            + '    <label>Avatar Icon</label>'
            + '    <div class="streamflix-icon-tabs" id="streamflix-icon-tabs" role="tablist">' + groupTabsHtml + '</div>'
            + '  </div>'
            + '  <div class="streamflix-picker-row" id="streamflix-icon-picker"></div>'
            + '</div>'
            + '<div class="streamflix-field-row">'
            + '  <div class="streamflix-field">'
            + '    <label for="streamflix-prof-maturity">Maturity Rating</label>'
            + '    <select id="streamflix-prof-maturity" class="streamflix-select">' + maturityOptionsHtml + '</select>'
            + '  </div>'
            + '  <label class="streamflix-check">'
            + '    <input type="checkbox" id="streamflix-prof-kids" ' + (draft.isKids ? 'checked' : '') + ' />'
            + '    <span>Kids profile</span>'
            + '  </label>'
            + '</div>'
            + '<div class="streamflix-editor-section">Security</div>'
            + '<div class="streamflix-field">'
            + '  <label for="streamflix-prof-google">Google Account Lock</label>'
            + '  <select id="streamflix-prof-google" class="streamflix-select"' + (lockSelectable ? '' : ' disabled') + '>' + lockOptionsHtml + '</select>'
            + '  <div class="streamflix-field-hint">' + (lockSelectable
                ? 'Locked profiles can only be opened after signing in with that Google account.'
                : 'Sign in with Google to lock this profile to your account.') + '</div>'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="streamflix-prof-pin">Profile PIN</label>'
            + '  <div class="streamflix-inline-row">'
            + '    <input type="password" id="streamflix-prof-pin" class="streamflix-input" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" placeholder="' + (draft.hasPin ? 'PIN is set — leave blank to keep' : '4–8 digits, or leave blank') + '" />'
            + (draft.hasPin ? '<button type="button" class="streamflix-ghost-btn" id="streamflix-prof-clear-pin">Remove PIN</button>' : '')
            + '  </div>'
            + '</div>'
            + '<div class="streamflix-editor-section">Jellyfin Account</div>'
            + linkedAccountSectionHtml
            + '<div id="streamflix-prof-err" class="streamflix-form-error" aria-live="assertive"></div>'
            + '<div class="streamflix-modal-actions">'
            + '  <div>' + (canDelete ? '<button type="button" class="streamflix-btn-danger" id="streamflix-prof-delete">Delete Profile</button>' : '') + '</div>'
            + '  <div class="streamflix-inline-row">'
            + '    <button type="button" class="streamflix-ghost-btn" id="streamflix-prof-cancel">Cancel</button>'
            + '    <button type="button" class="streamflix-btn-primary" id="streamflix-prof-save">' + (isNew ? 'Create Profile' : 'Save') + '</button>'
            + '  </div>'
            + '</div>', { className: 'streamflix-modal-editor' });

        var modal = m.modal;
        var selectedColor = draft.color;
        var selectedIcon = draft.icon;
        var clearPinRequested = false;
        var preview = modal.querySelector('#streamflix-prof-preview');
        var iconPickerEl = modal.querySelector('#streamflix-icon-picker');

        var updatePreview = function () {
            if (preview) {
                preview.style.background = selectedColor;
                preview.textContent = selectedIcon;
            }
        };

        var renderIconGroup = function (groupId) {
            activeGroupId = groupId;
            var group = AVATAR_ICON_GROUPS[0];
            for (var g = 0; g < AVATAR_ICON_GROUPS.length; g++) {
                if (AVATAR_ICON_GROUPS[g].id === groupId) {
                    group = AVATAR_ICON_GROUPS[g];
                    break;
                }
            }
            Array.prototype.forEach.call(modal.querySelectorAll('#streamflix-icon-tabs .streamflix-icon-tab'), function (tab) {
                tab.classList.toggle('is-active', tab.getAttribute('data-icon-group') === group.id);
            });
            var list = group.icons.slice();
            if (group.id === AVATAR_ICON_GROUPS[0].id && selectedIcon && list.indexOf(selectedIcon) === -1 && findIconGroupId(selectedIcon) === group.id) {
                list.unshift(selectedIcon);
            }
            iconPickerEl.innerHTML = list.map(function (ic) {
                var sel = ic === selectedIcon ? ' selected' : '';
                return '<button type="button" class="streamflix-swatch' + sel + '" data-icon="' + escapeHtml(ic) + '">' + escapeHtml(ic) + '</button>';
            }).join('');
            Array.prototype.forEach.call(iconPickerEl.querySelectorAll('.streamflix-swatch'), function (btn) {
                btn.addEventListener('click', function () {
                    selectedIcon = btn.getAttribute('data-icon');
                    Array.prototype.forEach.call(iconPickerEl.querySelectorAll('.streamflix-swatch'), function (b) {
                        b.classList.remove('selected');
                    });
                    btn.classList.add('selected');
                    updatePreview();
                });
            });
        };
        renderIconGroup(activeGroupId);

        Array.prototype.forEach.call(modal.querySelectorAll('#streamflix-icon-tabs .streamflix-icon-tab'), function (tab) {
            tab.addEventListener('click', function () {
                renderIconGroup(tab.getAttribute('data-icon-group'));
            });
        });

        Array.prototype.forEach.call(modal.querySelectorAll('#streamflix-color-picker .streamflix-swatch'), function (btn) {
            btn.addEventListener('click', function () {
                selectedColor = btn.getAttribute('data-color');
                Array.prototype.forEach.call(modal.querySelectorAll('#streamflix-color-picker .streamflix-swatch'), function (b) {
                    b.classList.remove('selected');
                });
                btn.classList.add('selected');
                updatePreview();
            });
        });

        var shuffleBtn = modal.querySelector('#streamflix-prof-shuffle');
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', function () {
                var allIcons = [];
                AVATAR_ICON_GROUPS.forEach(function (g) { allIcons = allIcons.concat(g.icons); });
                var nextColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
                var nextIcon = allIcons[Math.floor(Math.random() * allIcons.length)];
                if (allIcons.length > 1 && nextIcon === selectedIcon) {
                    nextIcon = allIcons[(allIcons.indexOf(nextIcon) + 1) % allIcons.length];
                }
                selectedColor = nextColor;
                selectedIcon = nextIcon;
                Array.prototype.forEach.call(modal.querySelectorAll('#streamflix-color-picker .streamflix-swatch'), function (b) {
                    b.classList.toggle('selected', (b.getAttribute('data-color') || '').toLowerCase() === selectedColor.toLowerCase());
                });
                renderIconGroup(findIconGroupId(selectedIcon));
                updatePreview();
            });
        }

        var kidsCheck = modal.querySelector('#streamflix-prof-kids');
        var maturitySelect = modal.querySelector('#streamflix-prof-maturity');
        if (kidsCheck && maturitySelect) {
            kidsCheck.addEventListener('change', function () {
                if (kidsCheck.checked && maturitySelect.value === MATURITY_LEVELS[0].value) {
                    maturitySelect.value = MATURITY_LEVELS[2].value;
                } else if (!kidsCheck.checked && (maturitySelect.value === MATURITY_LEVELS[2].value || maturitySelect.value === MATURITY_LEVELS[3].value)) {
                    maturitySelect.value = MATURITY_LEVELS[0].value;
                }
            });
        }

        var jfUserSelect = modal.querySelector('#streamflix-prof-jfuser');
        var jfUserNote = modal.querySelector('#streamflix-prof-jfuser-note');
        var syncJfUserNote = function () {
            if (!jfUserSelect || !jfUserNote) {
                return;
            }
            var opt = jfUserSelect.options[jfUserSelect.selectedIndex];
            var optIsAdmin = Boolean(opt && opt.getAttribute('data-is-admin') === '1');
            jfUserNote.classList.toggle('is-warn', optIsAdmin);
            jfUserNote.textContent = optIsAdmin
                ? 'Administrator account — grants full server & Dashboard access. Protect this profile with a PIN or Google lock.'
                : 'Stores watch history, Continue Watching & library access. Only administrators can change this.';
        };
        if (jfUserSelect) {
            jfUserSelect.addEventListener('change', syncJfUserNote);
            syncJfUserNote();
        }

        var pinInput = modal.querySelector('#streamflix-prof-pin');
        pinInput.addEventListener('input', function () {
            pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 8);
        });

        var clearPinBtn = modal.querySelector('#streamflix-prof-clear-pin');
        if (clearPinBtn) {
            clearPinBtn.addEventListener('click', function () {
                clearPinRequested = !clearPinRequested;
                pinInput.value = '';
                pinInput.disabled = clearPinRequested;
                pinInput.placeholder = clearPinRequested ? 'PIN will be removed when you save' : 'PIN is set — leave blank to keep';
                clearPinBtn.textContent = clearPinRequested ? 'Keep PIN' : 'Remove PIN';
            });
        }

        modal.querySelector('#streamflix-prof-cancel').addEventListener('click', function () { m.close(); });

        var delBtn = modal.querySelector('#streamflix-prof-delete');
        if (delBtn) {
            delBtn.addEventListener('click', function () {
                m.close();
                confirmAndDeleteProfile(existingProfile, verifiedPin);
            });
        }

        var nameInput = modal.querySelector('#streamflix-prof-name');
        setTimeout(function () {
            try { nameInput.focus(); } catch (e) {}
        }, 60);

        var saveBtn = modal.querySelector('#streamflix-prof-save');
        var save = function () {
            var nameVal = (nameInput.value || '').trim();
            var errEl = modal.querySelector('#streamflix-prof-err');
            if (!nameVal) {
                errEl.textContent = 'Please enter a profile name.';
                nameInput.focus();
                return;
            }
            var rawPin = (pinInput.value || '').trim();
            if (rawPin && !/^\d{4,8}$/.test(rawPin)) {
                errEl.textContent = 'PINs must be 4 to 8 digits.';
                pinInput.focus();
                return;
            }
            var lockVal = modal.querySelector('#streamflix-prof-google').value;
            var resolvedJfUserId = jfUserSelect
                ? jfUserSelect.value
                : (isNew ? '__CREATE__' : (draft.jellyfinUserId || ''));
            var payload = {
                id: isNew ? '' : draft.id,
                name: nameVal,
                avatarEmoji: selectedIcon,
                avatarColorHex: selectedColor,
                isKids: kidsCheck.checked,
                maturityRating: maturitySelect.value,
                pin: clearPinRequested ? '__CLEAR__' : (rawPin || null),
                jellyfinUserId: resolvedJfUserId,
                jellyfinUsername: isNew ? nameVal : (draft.jellyfinUsername || nameVal),
                currentPin: verifiedPin || null,
                googleAccountEmail: lockVal === '__KEEP__' ? null : lockVal
            };

            errEl.textContent = '';
            saveBtn.disabled = true;
            saveBtn.classList.add('streamflix-btn-loading');
            apiFetch('/StreamFlix/Profiles/Save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (updatedState) {
                applyConfigFromServerResponse(updatedState);
                if (state.activeProfile && !isNew && state.activeProfile.id === draft.id) {
                    var updatedMatch = findProfileById(draft.id);
                    if (updatedMatch) {
                        state.activeProfile.name = updatedMatch.name;
                        state.activeProfile.color = updatedMatch.color;
                        state.activeProfile.icon = updatedMatch.icon;
                        state.activeProfile.isKids = updatedMatch.isKids;
                        saveJson(PROFILE_KEY, state.activeProfile);
                        ensureHeaderWidgets();
                    }
                }
                m.close();
                showToast(isNew ? ('Created "' + nameVal + '".') : 'Profile saved.', 'success');
                rerenderPickerIfOpen();
            }).catch(function (err) {
                saveBtn.disabled = false;
                saveBtn.classList.remove('streamflix-btn-loading');
                var msg = (err && err.message) || 'Could not save profile.';
                errEl.textContent = msg;
                if (err && (err.code === 'link_change_forbidden' || err.code === 'admin_link_forbidden' || err.code === 'admin_required')) {
                    showToast(msg, 'error');
                }
            });
        };
        saveBtn.addEventListener('click', save);
        nameInput.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                save();
            }
        });
    }

    /* ----------------------------------------------------------------------
       5. Merged Top-Right Profile & Account Dropdown Menu + STREAMFLIX Brand
       ---------------------------------------------------------------------- */
    function isAdminConfigRoute() {
        var h = (window.location.hash || '').toLowerCase();
        return h.indexOf('configurationpage') !== -1
            || h.indexOf('dashboard') !== -1;
    }

    function hideRedundantJellyfinAvatarIcon() {
        try {
            var redundant = document.querySelectorAll(
                '.MuiToolbar-root .MuiAvatar-root, '
                + '.skinHeader .headerUserButton, '
                + '.skinHeader .headerSearchButton, '
                + '.skinHeader .headerTabs, '
                + '.skinHeader .sectionTabs, '
                + '.MuiToolbar-root a[href*="mypreferencesmenu"], '
                + '.skinHeader a[href*="mypreferencesmenu"], '
                + '.MuiToolbar-root a[href*="search"], '
                + '.skinHeader a[href*="search"], '
                + '.MuiToolbar-root button[title="Search"], '
                + '.MuiToolbar-root button[aria-label="Search"], '
                + '.skinHeader button[title="Search"], '
                + '.skinHeader button[aria-label="Search"], '
                + '.MuiToolbar-root [data-testid="SearchIcon"], '
                + '.MuiToolbar-root a[href*="tab="], '
                + '.MuiToolbar-root a[href*="#/movies"], '
                + '.MuiToolbar-root a[href*="#/tv"], '
                + '.MuiToolbar-root a[href*="#/list"], '
                + '.MuiToolbar-root a[href*="#/boxsets"], '
                + '.MuiToolbar-root button[aria-controls="user-views-menu"], '
                + '.MuiToolbar-root .MuiStack-root > :not(:first-child):not([data-streamflix-corner-brand="true"])'
            );
            for (var i = 0; i < redundant.length; i++) {
                var el = redundant[i];
                if (el.getAttribute && el.getAttribute('data-streamflix-corner-brand') === 'true') {
                    continue;
                }
                if (el.classList && (el.classList.contains('headerTabs') || el.classList.contains('sectionTabs'))) {
                    el.style.setProperty('display', 'none', 'important');
                    continue;
                }
                var btn = el.closest ? (el.closest('button') || el.closest('a') || el) : el;
                if (btn && btn.id !== 'streamflix-header-profile-btn' && btn.getAttribute('data-streamflix-corner-brand') !== 'true') {
                    btn.style.setProperty('display', 'none', 'important');
                }
            }
        } catch (e) {}
    }

    function isVideoPlayerActive() {
        var h = (window.location.hash || '').toLowerCase();
        if (h.indexOf('#/video') === 0 || h.indexOf('#!/video') === 0) {
            return true;
        }
        if (document.querySelector('#videoOsdPage:not(.hide), .videoPlayerContainer, video.htmlvideoplayer, .htmlvideoplayer')) {
            return true;
        }
        return false;
    }

    function neutralizeConflictingBrandingCss() {
        try {
            // 1. Only neutralize legacy JellyFlix Custom CSS in #cssBranding if it does NOT contain our STREAMFLIX stylesheet.
            var brandingStyle = document.getElementById('cssBranding');
            if (brandingStyle && brandingStyle.textContent) {
                var bTxt = brandingStyle.textContent;
                if (bTxt.toLowerCase().indexOf('jellyflix') !== -1 && bTxt.indexOf('STREAMFLIX') === -1) {
                    brandingStyle.textContent = '';
                }
            }
            var allStyles = document.querySelectorAll('style, link[rel="stylesheet"]');
            for (var i = 0; i < allStyles.length; i++) {
                var el = allStyles[i];
                var href = (el.getAttribute && el.getAttribute('href')) || '';
                var txt = el.textContent || '';
                if (href.toLowerCase().indexOf('jellyflix') !== -1
                    || (txt.toLowerCase().indexOf('jellyflix') !== -1 && txt.indexOf('STREAMFLIX') === -1)) {
                    if (el.tagName === 'STYLE') {
                        el.textContent = '';
                    } else if (el.parentNode) {
                        el.parentNode.removeChild(el);
                    }
                }
            }

            // 2. Ensure our stylesheet is present and placed at the end of <head> so it wins the CSS cascade
            if (document.head && !document.getElementById('streamflix-live-styles-v7')) {
                Array.prototype.forEach.call(document.querySelectorAll('link[id^="streamflix-live-styles-"]'), function (oldLink) {
                    if (oldLink.parentNode) {
                        oldLink.parentNode.removeChild(oldLink);
                    }
                });
                var liveLink = document.createElement('link');
                liveLink.id = 'streamflix-live-styles-v7';
                liveLink.rel = 'stylesheet';
                liveLink.href = '/StreamFlix/ClientStyles?v=' + encodeURIComponent(VERSION);
                document.head.appendChild(liveLink);
            }
        } catch (e) {}
    }

    function enhanceItemDetailPage() {
        try {
            if (isVideoPlayerActive()) {
                document.body.classList.remove('streamflix-on-details-page');
                return;
            }
            var h = (window.location.hash || '');
            var detailPage = document.querySelector('#itemDetailPage:not(.hide)');
            var onDetails = h.indexOf('details') !== -1 || Boolean(detailPage);
            document.body.classList.toggle('streamflix-on-details-page', onDetails);
            if (!onDetails) {
                return;
            }

            if (detailPage && detailPage.classList.contains('noBackdrop')) {
                detailPage.classList.remove('noBackdrop');
            }

            var idMatch = h.match(/[?&]id=([a-f0-9-]+)/i);
            var itemId = idMatch ? idMatch[1] : null;

            // Inject top-right '✕' close button inside #itemDetailPage so it behaves identically to 'The Devil Wears Prada 2' card
            if (detailPage && !document.getElementById('streamflix-detail-page-close')) {
                var closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.id = 'streamflix-detail-page-close';
                closeBtn.className = 'streamflix-detail-close';
                closeBtn.title = 'Close';
                closeBtn.innerHTML = icon('close');
                closeBtn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (window.history.length > 1) {
                        window.history.back();
                    } else {
                        window.location.hash = '#/home';
                    }
                });
                detailPage.appendChild(closeBtn);
            }

            // Ensure high-res widescreen backdrop (including Series/Episode fallback!) is always set on #itemBackdrop
            var backdropEl = document.getElementById('itemBackdrop');
            if (backdropEl && itemId && backdropEl.getAttribute('data-streamflix-item-id') !== itemId) {
                backdropEl.setAttribute('data-streamflix-item-id', itemId);
                backdropEl.classList.remove('noBackdrop');
                fetchFullItemDetails(itemId).then(function (fullItem) {
                    if (!fullItem) {
                        return;
                    }
                    var bestBg = getItemBackdropUrl(fullItem, 1920);
                    var curBackdropEl = document.getElementById('itemBackdrop');
                    if (curBackdropEl && bestBg) {
                        curBackdropEl.style.backgroundImage = 'url("' + bestBg + '")';
                        curBackdropEl.classList.remove('noBackdrop');
                    }
                }).catch(function () {
                    var fallbackBg = '/Items/' + encodeURIComponent(itemId) + '/Images/Backdrop/0?maxWidth=1920&quality=90';
                    if (backdropEl) {
                        backdropEl.style.backgroundImage = 'url("' + fallbackBg + '")';
                    }
                });
            }

            // Remove any duplicate .streamflix-play-label spans from earlier versions
            if (detailPage) {
                var dupLabels = detailPage.querySelectorAll('.streamflix-play-label');
                for (var i = 0; i < dupLabels.length; i++) {
                    if (dupLabels[i].parentNode) {
                        dupLabels[i].parentNode.removeChild(dupLabels[i]);
                    }
                }
            }
        } catch (e) {}
    }

    /* Jellyfin Quick Connect: authorize another device (TV, phone, app) with the code it displays */
    function openQuickConnectModal() {
        var active = state.activeProfile || {};
        var len = 6;
        var boxesHtml = '';
        for (var i = 0; i < len; i++) {
            boxesHtml += '<span class="streamflix-pin-box"></span>';
        }
        var m = openModal(''
            + '<div class="streamflix-qc-badge">' + icon('tv') + '</div>'
            + '<h2>Quick Connect</h2>'
            + '<p class="streamflix-modal-text">On your TV or other device, choose <strong>Quick Connect</strong> on the Jellyfin sign-in screen and enter the code it shows. It will sign in as <strong>' + escapeHtml(active.name || 'this profile') + '</strong>.</p>'
            + '<label class="streamflix-pin-pad streamflix-qc-pad">'
            + '  <input type="text" class="streamflix-pin-input streamflix-qc-input" inputmode="numeric" autocomplete="one-time-code" maxlength="' + len + '" aria-label="Quick Connect code" />'
            + '  <span class="streamflix-pin-boxes">' + boxesHtml + '</span>'
            + '</label>'
            + '<div class="streamflix-pin-msg" aria-live="assertive"></div>'
            + '<div class="streamflix-modal-actions streamflix-modal-actions-center">'
            + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">Cancel</button>'
            + '  <button type="button" class="streamflix-btn-primary" data-act="ok" disabled>Connect</button>'
            + '</div>', { className: 'streamflix-modal-pin streamflix-modal-qc' });

        var input = m.modal.querySelector('.streamflix-qc-input');
        var boxEls = m.modal.querySelectorAll('.streamflix-pin-box');
        var msg = m.modal.querySelector('.streamflix-pin-msg');
        var okBtn = m.modal.querySelector('[data-act="ok"]');
        var busy = false;

        function paint() {
            var v = input.value;
            var focused = document.activeElement === input;
            for (var k = 0; k < boxEls.length; k++) {
                boxEls[k].textContent = v.charAt(k) || '';
                boxEls[k].classList.toggle('filled', k < v.length);
                boxEls[k].classList.toggle('active', focused && k === Math.min(v.length, len - 1));
            }
            okBtn.disabled = busy || input.disabled || v.length < len;
        }

        function fail(text) {
            msg.textContent = text;
            m.modal.classList.remove('streamflix-shake');
            void m.modal.offsetWidth;
            m.modal.classList.add('streamflix-shake');
            try { input.focus(); input.select(); } catch (e) {}
            paint();
        }

        function submit() {
            var code = input.value;
            if (busy || code.length < len) {
                return;
            }
            busy = true;
            m.modal.classList.add('streamflix-busy');
            msg.textContent = '';
            paint();
            apiFetch('/QuickConnect/Authorize?code=' + encodeURIComponent(code), { method: 'POST' }).then(function () {
                busy = false;
                m.modal.classList.remove('streamflix-busy');
                m.modal.innerHTML = ''
                    + '<div class="streamflix-qc-badge streamflix-qc-success">' + icon('check') + '</div>'
                    + '<h2>Device connected</h2>'
                    + '<p class="streamflix-modal-text">Your device is now signed in as <strong>' + escapeHtml(active.name || 'this profile') + '</strong>.</p>'
                    + '<div class="streamflix-modal-actions streamflix-modal-actions-center"><button type="button" class="streamflix-btn-primary" data-act="done">Done</button></div>';
                m.modal.querySelector('[data-act="done"]').addEventListener('click', function () { m.close(true); });
                setTimeout(function () { m.close(true); }, 2600);
            }).catch(function (err) {
                busy = false;
                m.modal.classList.remove('streamflix-busy');
                var status = err && err.status;
                if (status === 404 || status === 400) {
                    fail('That code wasn\'t found or has expired. Check the code on your device and try again.');
                } else if (status === 401 || status === 403) {
                    fail('Quick Connect isn\'t available. An administrator can turn it on in Dashboard → General.');
                } else {
                    fail((err && err.message) || 'Couldn\'t connect the device. Please try again.');
                }
            });
        }

        input.addEventListener('input', function () {
            input.value = input.value.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, len);
            if (msg.textContent && !busy && !input.disabled) {
                msg.textContent = '';
            }
            paint();
            if (input.value.length === len) {
                submit();
            }
        });
        input.addEventListener('focus', paint);
        input.addEventListener('blur', paint);
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                submit();
            }
        });
        okBtn.addEventListener('click', submit);
        m.modal.querySelector('[data-act="cancel"]').addEventListener('click', function () { m.close(false); });

        apiFetch('/QuickConnect/Enabled').then(function (enabled) {
            if (enabled === false || enabled === 'false') {
                input.disabled = true;
                msg.textContent = 'Quick Connect is turned off on this server. An administrator can enable it in Dashboard → General.';
                paint();
            }
        }).catch(function () {});

        setTimeout(function () {
            try { input.focus(); } catch (e) {}
            paint();
        }, 40);
        return m;
    }

    /* Jellyfin's Cast ("Play on") and SyncPlay header buttons are tucked out of sight (see CSS) and
       surfaced as tiles in the account menu instead; these helpers find and drive the native buttons. */
    var NATIVE_HEADER_SELECTORS = {
        cast: ['.headerCastButton', '.skinHeader .castButton', '.MuiToolbar-root button[title="Play On"]', '.MuiToolbar-root button[aria-label="Play On"]', '.MuiToolbar-root button[title="Cast"]', '.MuiToolbar-root button[aria-label="Cast"]'],
        sync: ['.headerSyncButton', '.skinHeader .syncButton', '.MuiToolbar-root button[title="SyncPlay"]', '.MuiToolbar-root button[aria-label="SyncPlay"]']
    };

    var NATIVE_HEADER_ICON_SELECTORS = {
        cast: '.material-icons.cast, .material-icons.cast_connected, svg[data-testid="CastIcon"], svg[data-testid="CastConnectedIcon"]',
        sync: '.material-icons.groups, .material-icons.group, .material-icons.group_add, svg[data-testid="GroupsIcon"], svg[data-testid="GroupIcon"], svg[data-testid="GroupAddIcon"]'
    };
    var NATIVE_HEADER_ROOTS = '.skinHeader, header, .MuiAppBar-root, .MuiToolbar-root';

    // Tag Jellyfin's Cast / SyncPlay header buttons, whatever header Jellyfin renders, so CSS can park them
    function tagNativeHeaderButtons() {
        var roots = document.querySelectorAll(NATIVE_HEADER_ROOTS);
        Object.keys(NATIVE_HEADER_ICON_SELECTORS).forEach(function (kind) {
            var found = [];
            (NATIVE_HEADER_SELECTORS[kind] || []).forEach(function (sel) {
                Array.prototype.push.apply(found, document.querySelectorAll(sel));
            });
            for (var r = 0; r < roots.length; r++) {
                var icons = roots[r].querySelectorAll(NATIVE_HEADER_ICON_SELECTORS[kind]);
                for (var i = 0; i < icons.length; i++) {
                    var b = icons[i].closest('button, a, [role="button"]');
                    if (b && !b.closest('#streamflix-account-dropdown, #streamflix-header-profile-btn, #streamflix-overlay-root')) {
                        found.push(b);
                    }
                }
            }
            found.forEach(function (b) {
                if (b.getAttribute('data-bfx-native') !== kind) {
                    b.setAttribute('data-bfx-native', kind);
                }
            });
        });
    }

    function findNativeHeaderButton(kind) {
        tagNativeHeaderButtons();
        var tagged = document.querySelectorAll('[data-bfx-native="' + kind + '"]');
        for (var t = 0; t < tagged.length; t++) {
            if (!tagged[t].classList.contains('hide') && !(tagged[t].closest && tagged[t].closest('.hide'))) {
                return tagged[t];
            }
        }
        var sels = NATIVE_HEADER_SELECTORS[kind] || [];
        for (var i = 0; i < sels.length; i++) {
            var list = document.querySelectorAll(sels[i]);
            for (var j = 0; j < list.length; j++) {
                var b = list[j];
                // Jellyfin adds .hide when the feature is unavailable for this user/device
                if (b.classList.contains('hide') || (b.closest && b.closest('.hide'))) {
                    continue;
                }
                return b;
            }
        }
        return null;
    }

    function getNativeCastState() {
        var b = findNativeHeaderButton('cast');
        if (!b) {
            return { connected: false, deviceName: '' };
        }
        var connected = b.classList.contains('castButton-active') || Boolean(b.querySelector('.cast_connected, svg[data-testid="CastConnectedIcon"]'));
        var nameEl = document.querySelector('.headerSelectedPlayer');
        return { connected: connected, deviceName: connected && nameEl ? (nameEl.textContent || '').trim() : '' };
    }

    function openNativeHeaderMenu(kind) {
        var b = findNativeHeaderButton(kind);
        if (!b) {
            showToast('Casting isn\'t available on this device.', 'info');
            return;
        }
        // Let the menu's own click finish first so Jellyfin's popup doesn't treat it as an outside click
        setTimeout(function () {
            try { b.click(); } catch (e) {}
        }, 60);
    }

    function syncHeaderCastIndicator(btn) {
        if (!btn) {
            return;
        }
        var info = getNativeCastState();
        var badge = btn.querySelector('.streamflix-header-cast');
        if (info.connected && !badge) {
            badge = document.createElement('span');
            badge.className = 'streamflix-header-cast';
            badge.innerHTML = icon('cast');
            btn.insertBefore(badge, btn.firstChild);
        } else if (!info.connected && badge && badge.parentNode) {
            badge.parentNode.removeChild(badge);
        }
        if (badge && info.connected) {
            badge.title = 'Casting to ' + (info.deviceName || 'another device');
        }
    }

    function closeAccountDropdown() {
        state.accountDropdownOpen = false;
        var dd = document.getElementById('streamflix-account-dropdown');
        if (dd && dd.parentNode) {
            dd.parentNode.removeChild(dd);
        }
        var btn = document.getElementById('streamflix-header-profile-btn');
        if (btn) {
            btn.classList.remove('open');
        }
    }

    function toggleAccountDropdown() {
        if (state.accountDropdownOpen && document.getElementById('streamflix-account-dropdown')) {
            closeAccountDropdown();
            return;
        }
        var active = state.activeProfile;
        if (!active) {
            return;
        }
        state.accountDropdownOpen = true;
        var btn = document.getElementById('streamflix-header-profile-btn');
        if (btn) {
            btn.classList.add('open');
        }

        var existing = document.getElementById('streamflix-account-dropdown');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        var profiles = getProfiles();
        var isAdmin = isHouseholdAdmin() || Boolean(active.isAdmin);
        var googleEmail = state.googleUser && state.googleUser.email;

        var otherProfiles = profiles.filter(function (p) { return p.id !== active.id; });
        var quickProfilesHtml = otherProfiles.map(function (p) {
            var lockedOut = p.googleLocked && !p.googleLockSatisfied;
            return ''
                + '<button type="button" class="bfx-dd-prof' + (lockedOut ? ' is-locked' : '') + '" data-quick-switch-id="' + escapeHtml(p.id) + '" title="' + escapeHtml(lockedOut ? 'Locked to another Google account' : 'Switch to ' + p.name) + '">'
                + '  <span class="bfx-dd-prof-av" style="background:' + escapeHtml(p.color || '#E50914') + ';">' + escapeHtml(p.icon || '🎬')
                + (p.hasPin || p.googleLocked ? '<span class="bfx-dd-prof-lock">' + (p.googleLocked ? 'G' : '•••') + '</span>' : '')
                + '</span>'
                + '  <span class="bfx-dd-prof-name">' + escapeHtml(p.name) + '</span>'
                + '</button>';
        }).join('');

        var ddItem = function (id, iconName, label, sub, extraClass, trailing) {
            return '<button type="button" role="menuitem" class="streamflix-dd-item' + (extraClass ? ' ' + extraClass : '') + '" id="' + id + '">'
                + '<span class="bfx-dd-ico">' + icon(iconName) + '</span>'
                + '<span class="bfx-dd-label">' + escapeHtml(label) + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '') + '</span>'
                + (trailing || '')
                + '</button>';
        };

        var castBtnNative = findNativeHeaderButton('cast');
        var castInfo = getNativeCastState();

        var ddTile = function (id, iconName, label, hint, extraClass) {
            return '<button type="button" role="menuitem" class="bfx-dd-tile' + (extraClass ? ' ' + extraClass : '') + '" id="' + id + '" title="' + escapeHtml(hint) + '">'
                + '<span class="bfx-dd-tile-ico">' + icon(iconName) + '</span>'
                + '<span class="bfx-dd-tile-label">' + escapeHtml(label) + '</span>'
                + '</button>';
        };
        var tilesHtml = ''
            + (castBtnNative ? ddTile('streamflix-dd-cast', 'cast', castInfo.connected ? 'Casting' : 'Cast', castInfo.connected ? ('Connected to ' + (castInfo.deviceName || 'another device')) : 'Play on a TV, Chromecast or another device', 'is-cast' + (castInfo.connected ? ' is-live' : '')) : '')
            + ddTile('streamflix-dd-quick-connect', 'tv', 'Quick Connect', 'Sign in on a TV or another device with a 6-digit code', 'is-qc');

        var dd = document.createElement('div');
        dd.id = 'streamflix-account-dropdown';
        dd.setAttribute('role', 'menu');
        dd.innerHTML = ''
            + '<div class="streamflix-dd-active-header">'
            + '  <div class="streamflix-dd-active-avatar" style="background:' + escapeHtml(active.color || '#E50914') + ';">' + escapeHtml(active.icon || '🎬') + '</div>'
            + '  <div class="streamflix-dd-active-meta">'
            + '    <div class="streamflix-dd-active-name">'
            + '      <span>' + escapeHtml(active.name) + '</span>'
            + (active.isAdmin ? '<span class="streamflix-dd-admin-pill">Admin</span>' : '')
            + '    </div>'
            + '    <div class="streamflix-dd-active-sub">' + escapeHtml(googleEmail || ('Jellyfin user: ' + (active.jellyfinUsername || active.name))) + '</div>'
            + '  </div>'
            + '  <button type="button" class="bfx-dd-close" id="streamflix-dd-close" title="Close" aria-label="Close menu">' + icon('chevronDown') + '</button>'
            + '</div>'
            + '<div class="bfx-dd-profiles">' + quickProfilesHtml
            + '<button type="button" class="bfx-dd-prof bfx-dd-prof-manage" id="streamflix-dd-manage-profiles" title="Manage profiles"><span class="bfx-dd-prof-av">' + icon('edit') + '</span><span class="bfx-dd-prof-name">Manage</span></button>'
            + '</div>'
            + '<div class="bfx-dd-tiles">' + tilesHtml + '</div>'
            + '<div class="streamflix-dd-divider"></div>'
            + ddItem('streamflix-dd-user-prefs', 'sliders', 'Settings', '', '', '<span class="bfx-dd-chev">' + icon('chevronRight') + '</span>')
            + ddItem('streamflix-dd-toggle-hub', 'home', 'StreamFlix Home', '', 'bfx-dd-switch-row',
                '<span class="bfx-switch' + (state.cinemaHubEnabled ? ' on' : '') + '" aria-hidden="true"><i></i></span>')
            + (isAdmin ? ddItem('streamflix-dd-dashboard', 'gear', 'Dashboard', '', '', '<span class="bfx-dd-chev">' + icon('chevronRight') + '</span>') : '')
            + '<div class="streamflix-dd-divider"></div>'
            + ddItem('streamflix-dd-signout', 'logout', 'Sign out', '', 'danger');

        document.body.appendChild(dd);

        Array.prototype.forEach.call(dd.querySelectorAll('[data-quick-switch-id]'), function (row) {
            row.addEventListener('click', function () {
                var target = findProfileById(row.getAttribute('data-quick-switch-id'));
                closeAccountDropdown();
                if (target) {
                    handleSelectProfile(target);
                }
            });
        });

        var bind = function (id, handler) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('click', function () {
                    closeAccountDropdown();
                    handler();
                });
            }
        };

        bind('streamflix-dd-close', function () {});
        // Cast reuses Jellyfin's own picker (Chromecast, AirPlay, other sessions)
        bind('streamflix-dd-cast', function () {
            openNativeHeaderMenu('cast');
        });
        bind('streamflix-dd-quick-connect', function () {
            openQuickConnectModal();
        });
        bind('streamflix-dd-manage-profiles', function () {
            window.__STREAMFLIX_OPEN_PROFILE_PICKER__(true);
        });
        bind('streamflix-dd-toggle-hub', function () {
            state.cinemaHubEnabled = !state.cinemaHubEnabled;
            saveJson(CINEMA_HUB_PREF_KEY, state.cinemaHubEnabled);
            var existingHub = document.getElementById('streamflix-cinema-hub');
            if (!state.cinemaHubEnabled && existingHub && existingHub.parentNode) {
                existingHub.parentNode.removeChild(existingHub);
                document.body.classList.remove('streamflix-hub-filtered', 'streamflix-hub-active');
            } else if (state.cinemaHubEnabled) {
                ensureCinemaHubMounted();
            }
            showToast('StreamFlix Home ' + (state.cinemaHubEnabled ? 'enabled' : 'disabled') + '.', 'info');
        });
        bind('streamflix-dd-user-prefs', function () {
            window.location.hash = '#/mypreferencesmenu';
        });
        bind('streamflix-dd-dashboard', function () {
            window.location.hash = '#/dashboard';
        });
        bind('streamflix-dd-signout', function () {
            confirmDialog({
                title: 'Sign out of StreamFlix?',
                message: 'You\'ll need to sign in with Google again on this device.',
                confirmText: 'Sign Out'
            }).then(function (ok) {
                if (ok) {
                    signOutHousehold();
                }
            });
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function (ev) {
        if (!state.accountDropdownOpen) {
            return;
        }
        var dd = document.getElementById('streamflix-account-dropdown');
        var btn = document.getElementById('streamflix-header-profile-btn');
        if (dd && !dd.contains(ev.target) && (!btn || !btn.contains(ev.target))) {
            closeAccountDropdown();
        }
    });

    function unmarkCornerBrandElement(el) {
        if (!el) {
            return;
        }
        el.removeAttribute('data-streamflix-corner-brand');
        el.classList.remove('streamflix-toolbar-brand-link');
        var inlines = el.querySelectorAll('.streamflix-inline-brand');
        for (var i = 0; i < inlines.length; i++) {
            if (inlines[i].parentNode) {
                inlines[i].parentNode.removeChild(inlines[i]);
            }
        }
    }

    function styleCornerBrandElement(el) {
        if (!el) {
            return;
        }
        el.setAttribute('data-streamflix-corner-brand', 'true');
        el.classList.add('streamflix-toolbar-brand-link');

        // Hide any Jellyfin triangle icon img / svg / startIcon inside the brand button
        var icons = el.querySelectorAll('img, svg, .MuiButton-startIcon, .MuiButton-icon');
        for (var k = 0; k < icons.length; k++) {
            icons[k].style.setProperty('display', 'none', 'important');
        }

        // Remove any legacy .streamflix-inline-brand child spans if native text nodes exist, or keep exactly ONE text node saying 'STREAMFLIX'
        var inlines = el.querySelectorAll('.streamflix-inline-brand');
        for (var m = 1; m < inlines.length; m++) {
            if (inlines[m].parentNode) {
                inlines[m].parentNode.removeChild(inlines[m]);
            }
        }

        var foundFirstText = false;
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
            var val = (node.nodeValue || '').trim();
            if (val) {
                if (!foundFirstText) {
                    if (node.nodeValue !== 'STREAMFLIX') {
                        node.nodeValue = 'STREAMFLIX';
                    }
                    foundFirstText = true;
                } else {
                    // Clear any secondary text node so it can NEVER double into 'STREAMFLIXSTREAMFLIX'
                    node.nodeValue = '';
                }
            }
        }
        if (!foundFirstText && !el.querySelector('.streamflix-inline-brand')) {
            var span = document.createElement('span');
            span.className = 'streamflix-inline-brand';
            span.textContent = 'STREAMFLIX';
            el.appendChild(span);
        }
    }

    function replaceToolbarLogoInPlace() {
        try {
            // Remove any legacy floating #streamflix-fixed-brand element
            var legacyFixed = document.getElementById('streamflix-fixed-brand');
            if (legacyFixed && legacyFixed.parentNode) {
                legacyFixed.parentNode.removeChild(legacyFixed);
            }

            // Never inject STREAMFLIX into the Video Player OSD header!
            if (isVideoPlayerActive()) {
                var osdTitles = document.querySelectorAll('.skinHeader .pageTitle, .osdHeader .pageTitle, [data-streamflix-corner-brand="true"]');
                for (var z = 0; z < osdTitles.length; z++) {
                    if (osdTitles[z].closest && osdTitles[z].closest('.skinHeader')) {
                        unmarkCornerBrandElement(osdTitles[z]);
                    }
                }
                return;
            }

            var srvName = ((state.config && state.config.serverName) || '').toLowerCase();
            var hasMuiToolbar = Boolean(document.querySelector('.MuiToolbar-root'));

            // 1. If Jellyfin 10.11 / 12.1 React MuiToolbar is present, style ONLY the single first brand element inside .MuiToolbar-root
            if (hasMuiToolbar) {
                // Clean .skinHeader .pageTitle so we don't get a second STREAMFLIX logo underneath .MuiToolbar-root
                var skinLogos = document.querySelectorAll('.skinHeader .pageTitleWithDefaultLogo, .skinHeader .pageTitleWithLogo, .skinHeader [data-streamflix-corner-brand="true"]');
                for (var s = 0; s < skinLogos.length; s++) {
                    unmarkCornerBrandElement(skinLogos[s]);
                }

                var candidates = document.querySelectorAll('.MuiToolbar-root a, .MuiToolbar-root button');
                var styledOne = false;
                for (var i = 0; i < candidates.length; i++) {
                    var el = candidates[i];
                    if (el.id === 'streamflix-header-profile-btn') {
                        continue;
                    }
                    if (el.closest && (el.closest('.MuiDrawer-root') || el.closest('.MuiDrawer-paper'))) {
                        continue;
                    }
                    var href = (el.getAttribute('href') || '').toLowerCase();
                    var text = (el.textContent || '').trim().toLowerCase();
                    if (href.indexOf('tab=') !== -1 || text.indexOf('favorite') !== -1) {
                        continue;
                    }

                    var isHomeHref = href === '#/'
                        || href === '/web/#/'
                        || href === '#/home'
                        || href === '#/home.html'
                        || href === '/web/#/home'
                        || href === '/web/#/home.html';

                    var hasBrandImg = Boolean(el.querySelector('img'));
                    var isBrandText = text === 'jellyfin'
                        || text === 'streamflix'
                        || (srvName && text === srvName);

                    if (!styledOne && (isHomeHref || hasBrandImg || isBrandText || el.getAttribute('data-streamflix-corner-brand') === 'true')) {
                        styleCornerBrandElement(el);
                        styledOne = true;
                    } else if (el.getAttribute('data-streamflix-corner-brand') === 'true') {
                        unmarkCornerBrandElement(el);
                    }
                }
                return;
            }

            // 2. Fallback for classic skinHeader (when .MuiToolbar-root is not present and not in OSD)
            var classicLogos = document.querySelectorAll('.skinHeader:not(.osdHeader) .pageTitleWithDefaultLogo, .skinHeader:not(.osdHeader) .pageTitleWithLogo');
            if (classicLogos.length > 0) {
                var cl = classicLogos[0];
                cl.setAttribute('data-streamflix-corner-brand', 'true');
                cl.style.setProperty('background-image', 'none', 'important');
                cl.style.setProperty('width', 'auto', 'important');
                if (cl.textContent !== 'STREAMFLIX') {
                    cl.innerHTML = '<span class="streamflix-inline-brand">STREAMFLIX</span>';
                }
            }
        } catch (e) {}
    }

    /* ----------------------------------------------------------------------
       v7.3 — Netflix-style video player. This skins and extends Jellyfin's own
       player controls (it never replaces them), so subtitles, audio tracks,
       casting, SyncPlay and every keyboard shortcut keep working as before.
       ---------------------------------------------------------------------- */
    var OSD_PAUSED_DELAY_MS = 6000;
    var osdState = {
        video: null,
        videoHandlers: null,
        attachedAt: 0,
        info: null,
        infoFor: '',
        infoTries: 0,
        fetching: false,
        pausedTimer: null,
        flashTimer: null,
        docBound: false,
        sessionId: '',
        playState: null,
        audioIndex: null,
        subtitleIndex: null,
        tracksItemId: '',
        episodesCache: {},
        episodesOpen: false,
        tracksOpen: false,
        selectedSeason: null,
        nextEpisode: null,
        nextEpisodeForId: '',
        upNextVisible: false,
        upNextDismissedForId: '',
        upNextCountdown: 0,
        upNextTotal: 10,
        upNextTimer: null
    };

    function osdSkipSeconds(kind) {
        var uid = getJellyfinAuthContext().userId || '';
        var raw = null;
        try {
            raw = window.localStorage.getItem(uid + '-' + kind) || window.localStorage.getItem(kind);
        } catch (e) {}
        var ms = parseInt(raw || (kind === 'skipBackLength' ? '10000' : '30000'), 10);
        return isNaN(ms) ? 0 : Math.round(ms / 1000);
    }

    // Swap Jellyfin's ⏪/⏩ glyphs for "10s back / 30s forward" icons that match the user's skip lengths
    function swapOsdSkipIcon(btn, baseIcon, byLength, secs) {
        var ic = btn && btn.querySelector('.material-icons');
        if (!ic) {
            return;
        }
        var target = byLength[secs] || baseIcon;
        if (ic.classList.contains(target)) {
            return;
        }
        ic.classList.remove(baseIcon);
        Object.keys(byLength).forEach(function (k) { ic.classList.remove(byLength[k]); });
        ic.classList.add(target);
    }

    function osdFallbackInfo() {
        var t = String(document.title || '').trim();
        if (!t || /^jellyfin$/i.test(t)) {
            var pt = document.querySelector('.skinHeader .pageTitle');
            t = pt ? String(pt.textContent || '').trim() : '';
        }
        t = t.replace(/\s*\(\d{4}\)\s*$/, '');
        var parts = t.split(' - ');
        return { title: parts[0] || '', sub: parts.slice(1).join(' · '), overview: '', logo: '' };
    }

    function osdDisplayInfo() {
        var it = osdState.info;
        if (!it || !it.Name) {
            return osdFallbackInfo();
        }
        var isEp = it.Type === 'Episode';
        var logo = '';
        if (isEp && it.ParentLogoItemId && it.ParentLogoImageTag) {
            logo = apiBase() + '/Items/' + encodeURIComponent(it.ParentLogoItemId) + '/Images/Logo?maxWidth=700&quality=90&tag=' + encodeURIComponent(it.ParentLogoImageTag);
        } else if (!isEp) {
            logo = getItemLogoUrl(it, 700);
        }
        var epTag = isEp && it.IndexNumber != null
            ? ((it.ParentIndexNumber != null ? 'S' + it.ParentIndexNumber + ':' : '') + 'E' + it.IndexNumber)
            : '';
        return {
            title: isEp ? (it.SeriesName || it.Name) : it.Name,
            sub: isEp
                ? [epTag, it.Name].filter(Boolean).join(' · ')
                : [it.ProductionYear, it.OfficialRating, formatRuntimeTicks(it.RunTimeTicks).trim()].filter(Boolean).join(' · '),
            overview: it.Overview || '',
            logo: logo
        };
    }

    function paintOsdTitle() {
        var el = document.querySelector('#videoOsdPage .streamflix-osd-title');
        if (!el) {
            return;
        }
        var info = osdDisplayInfo();
        var html = info.title
            ? '<b>' + escapeHtml(info.title) + '</b>' + (info.sub ? '<span>' + escapeHtml(info.sub) + '</span>' : '')
            : '';
        if (el.getAttribute('data-html') !== html) {
            el.setAttribute('data-html', html);
            el.innerHTML = html;
        }
    }

    // Ask the server what this device is playing so the title, episode and synopsis are exact
    function refreshOsdInfo(force) {
        var key = String(document.title || '');
        if (osdState.fetching || (!force && osdState.infoFor === key)) {
            return;
        }
        var auth = getJellyfinAuthContext();
        var deviceId = '';
        try {
            deviceId = window.ApiClient && typeof window.ApiClient.deviceId === 'function' ? window.ApiClient.deviceId() : '';
        } catch (e) {}
        osdState.infoFor = key;
        if (!auth.userId || !deviceId) {
            return;
        }
        osdState.fetching = true;
        var uid = encodeURIComponent(auth.userId);
        var fields = 'Overview,Genres,MediaSources,MediaStreams,ParentId,Chapters';
        apiFetch('/Sessions?deviceId=' + encodeURIComponent(deviceId)).then(function (sessions) {
            var list = Array.isArray(sessions) ? sessions : [];
            var np = null;
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i].NowPlayingItem) {
                    osdState.sessionId = list[i].Id || '';
                    osdState.playState = list[i].PlayState || null;
                    np = list[i].NowPlayingItem;
                    break;
                }
            }
            if (!np || !np.Id) {
                return null;
            }
            var iid = encodeURIComponent(np.Id);
            return apiFetch('/Users/' + uid + '/Items/' + iid + '?Fields=' + fields).catch(function () {
                return apiFetch('/Users/' + uid + '/Items/' + iid);
            }).catch(function () {
                return apiFetch('/Items/' + iid + '?userId=' + uid + '&Fields=' + fields);
            }).catch(function () {
                return np;
            });
        }).then(function (item) {
            osdState.fetching = false;
            var title = String(document.title || '');
            var matches = item && item.Name && (title.indexOf(item.Name) !== -1 || (item.SeriesName && title.indexOf(item.SeriesName) !== -1) || !title || /^jellyfin$/i.test(title));
            if (matches) {
                osdState.info = item;
                osdState.infoTries = 0;
                syncOsdActiveTracksFromInfo(item);
                preloadOsdNextEpisode(item);
            } else if (osdState.infoTries < 4) {
                // The server can lag a moment behind when the next episode starts — try again shortly
                osdState.infoTries++;
                osdState.infoFor = '';
            }
            paintOsdTitle();
            syncOsdExtraButtons();
            checkOsdUpNext();
        }).catch(function () {
            osdState.fetching = false;
        });
    }

    function osdFlash(kind) {
        if (Date.now() - osdState.attachedAt < 1500 || prefersReducedMotion()) {
            return;
        }
        var el = document.getElementById('streamflix-osd-flash');
        if (!el) {
            el = document.createElement('div');
            el.id = 'streamflix-osd-flash';
            el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(el);
        }
        el.innerHTML = icon(kind);
        el.classList.remove('is-on');
        void el.offsetWidth;
        el.classList.add('is-on');
        if (osdState.flashTimer) {
            clearTimeout(osdState.flashTimer);
        }
        osdState.flashTimer = setTimeout(function () {
            el.classList.remove('is-on');
        }, 700);
    }

    function hideOsdPaused() {
        var el = document.getElementById('streamflix-osd-paused');
        if (el) {
            el.classList.remove('is-on');
        }
        document.body.classList.remove('streamflix-osd-paused-on');
    }

    function armOsdPaused() {
        if (osdState.pausedTimer) {
            clearTimeout(osdState.pausedTimer);
            osdState.pausedTimer = null;
        }
        hideOsdPaused();
        var v = osdState.video;
        if (!v || !v.paused || v.ended) {
            return;
        }
        osdState.pausedTimer = setTimeout(showOsdPaused, OSD_PAUSED_DELAY_MS);
    }

    // Netflix's "You're watching" screen after the video has been paused for a while
    function showOsdPaused() {
        osdState.pausedTimer = null;
        var v = osdState.video;
        if (!v || !v.paused || v.ended || !isVideoPlayerActive()) {
            return;
        }
        if (osdState.episodesOpen || osdState.tracksOpen || osdState.upNextVisible || document.querySelector('.dialogContainer .dialog.opened, .actionSheet, .upNextDialog:not(.hide)')) {
            return;
        }
        var info = osdDisplayInfo();
        if (!info.title) {
            return;
        }
        var el = document.getElementById('streamflix-osd-paused');
        if (!el) {
            el = document.createElement('div');
            el.id = 'streamflix-osd-paused';
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        var titleHtml = info.logo
            ? '<h2 class="streamflix-osd-paused-title has-logo"><img src="' + escapeHtml(info.logo) + '" alt="' + escapeHtml(info.title) + '" onerror="var h=this.parentNode;h.classList.remove(\'has-logo\');h.textContent=this.alt;" /></h2>'
            : '<h2 class="streamflix-osd-paused-title">' + escapeHtml(info.title) + '</h2>';
        el.innerHTML = ''
            + '<div class="streamflix-osd-paused-inner">'
            + '  <div class="streamflix-osd-paused-kicker">You\u2019re watching</div>'
            + titleHtml
            + (info.sub ? '<div class="streamflix-osd-paused-sub">' + escapeHtml(info.sub) + '</div>' : '')
            + (info.overview ? '<p class="streamflix-osd-paused-overview">' + escapeHtml(info.overview) + '</p>' : '')
            + '</div>'
            + '<div class="streamflix-osd-paused-badge">Paused</div>';
        void el.offsetWidth;
        el.classList.add('is-on');
        document.body.classList.add('streamflix-osd-paused-on');
    }

    function onOsdActivity() {
        if (!osdState.video) {
            return;
        }
        var wasOn = document.body.classList.contains('streamflix-osd-paused-on');
        if (wasOn || osdState.pausedTimer) {
            armOsdPaused();
        }
    }

    function unbindOsdVideo() {
        var v = osdState.video;
        var h = osdState.videoHandlers;
        if (v && h) {
            Object.keys(h).forEach(function (evName) {
                v.removeEventListener(evName, h[evName]);
            });
        }
        osdState.video = null;
        osdState.videoHandlers = null;
    }

    function bindOsdVideo(v) {
        unbindOsdVideo();
        if (!v) {
            return;
        }
        osdState.video = v;
        osdState.attachedAt = Date.now();
        var h = {
            play: function () {
                if (osdState.pausedTimer) {
                    clearTimeout(osdState.pausedTimer);
                    osdState.pausedTimer = null;
                }
                hideOsdPaused();
                osdFlash('play');
            },
            pause: function () {
                if (!v.ended && !v.seeking) {
                    osdFlash('pause');
                }
                armOsdPaused();
            },
            timeupdate: function () {
                checkOsdUpNext();
            },
            seeked: function () {
                checkOsdUpNext();
            },
            loadstart: function () {
                // New media in the same element (next episode, track switch): forget the old details
                osdState.attachedAt = Date.now();
                osdState.info = null;
                osdState.infoFor = '';
                osdState.infoTries = 0;
                osdState.nextEpisode = null;
                osdState.nextEpisodeForId = '';
                osdState.upNextDismissedForId = '';
                hideOsdPaused();
                hideOsdUpNextCard();
                closeOsdOverlays();
                setTimeout(function () { refreshOsdInfo(false); paintOsdTitle(); syncOsdExtraButtons(); }, 1200);
            }
        };
        Object.keys(h).forEach(function (evName) {
            v.addEventListener(evName, h[evName]);
        });
        osdState.videoHandlers = h;
        if (v.paused && !v.ended && v.readyState > 0) {
            armOsdPaused();
        }
    }

    function enhanceVideoOsd(active) {
        if (!active) {
            teardownVideoOsd();
            return;
        }
        document.body.classList.add('streamflix-nf-player');
        if (!osdState.docBound) {
            osdState.docBound = true;
            ['mousemove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (evName) {
                document.addEventListener(evName, onOsdActivity, { passive: true, capture: true });
            });
        }
        var v = document.querySelector('video.htmlvideoplayer');
        if (v !== osdState.video) {
            bindOsdVideo(v);
        }
        var page = document.getElementById('videoOsdPage');
        var buttons = page && page.querySelector('.videoOsdBottom .buttons');
        if (buttons && !buttons.querySelector('.streamflix-osd-title')) {
            var t = document.createElement('div');
            t.className = 'streamflix-osd-title';
            t.setAttribute('aria-hidden', 'true');
            buttons.appendChild(t);
        }
        if (page) {
            swapOsdSkipIcon(page.querySelector('.btnRewind'), 'fast_rewind', { 5: 'replay_5', 10: 'replay_10', 30: 'replay_30' }, osdSkipSeconds('skipBackLength'));
            swapOsdSkipIcon(page.querySelector('.btnFastForward'), 'fast_forward', { 5: 'forward_5', 10: 'forward_10', 30: 'forward_30' }, osdSkipSeconds('skipForwardLength'));
        }
        tidyOsdHeader();
        ensureOsdExtraButtons(page, buttons);
        refreshOsdInfo(false);
        paintOsdTitle();
        syncOsdExtraButtons();
    }

    // Jellyfin 12 draws the player's top bar with React (MUI). Drop its title (the bottom bar already shows it)
    // and the Watch Party button; CSS covers modern browsers, this covers browsers without :has().
    function tidyOsdHeader() {
        var bars = document.querySelectorAll('.osdHeader');
        for (var i = 0; i < bars.length; i++) {
            var bar = bars[i];
            bar.classList.add('bfx-osd-header');
            var titles = bar.querySelectorAll('.MuiToolbar-root > .MuiTypography-root, .pageTitle');
            for (var t = 0; t < titles.length; t++) {
                titles[t].classList.add('bfx-osd-hide');
            }
            var btns = bar.querySelectorAll('button');
            for (var b = 0; b < btns.length; b++) {
                var btn = btns[b];
                var label = (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('aria-controls') || '');
                if (/sync[\s-]?play/i.test(label) || btn.classList.contains('headerSyncButton') || btn.querySelector('svg[data-testid="GroupsIcon"], .material-icons.groups')) {
                    btn.classList.add('bfx-osd-hide');
                }
            }
        }
    }

    function getOsdMediaStreams() {
        var it = osdState.info;
        if (!it) {
            return [];
        }
        if (Array.isArray(it.MediaStreams) && it.MediaStreams.length) {
            return it.MediaStreams;
        }
        if (Array.isArray(it.MediaSources) && it.MediaSources[0] && Array.isArray(it.MediaSources[0].MediaStreams)) {
            return it.MediaSources[0].MediaStreams;
        }
        return [];
    }

    function syncOsdActiveTracksFromInfo(item) {
        if (!item || !item.Id) {
            return;
        }
        var normId = normalizeGuid(item.Id);
        if (osdState.tracksItemId === normId) {
            return;
        }
        osdState.tracksItemId = normId;
        var ps = osdState.playState || {};
        var streams = getOsdMediaStreams();
        var audios = streams.filter(function (st) { return st && st.Type === 'Audio'; });
        var subs = streams.filter(function (st) { return st && st.Type === 'Subtitle'; });
        if (ps.AudioStreamIndex !== undefined && ps.AudioStreamIndex !== null) {
            osdState.audioIndex = ps.AudioStreamIndex;
        } else {
            var defAudio = audios.filter(function (a) { return a.IsDefault; })[0] || audios[0];
            osdState.audioIndex = defAudio ? defAudio.Index : null;
        }
        if (ps.SubtitleStreamIndex !== undefined && ps.SubtitleStreamIndex !== null) {
            osdState.subtitleIndex = ps.SubtitleStreamIndex;
        } else {
            var defSub = subs.filter(function (sb) { return sb.IsDefault || sb.IsForced; })[0];
            osdState.subtitleIndex = defSub ? defSub.Index : -1;
        }
    }

    function isCurrentOsdEpisode() {
        var it = osdState.info;
        if (it && (it.Type === 'Episode' || it.SeriesId)) {
            return true;
        }
        return /\bS\d+\s*:\s*E\d+\b/i.test(String(document.title || ''));
    }

    function ensureOsdExtraButtons(page, buttons) {
        if (!page || !buttons) {
            return;
        }
        var anchor = buttons.querySelector('.btnSubtitles, .btnAudio, .btnVideoOsdSettings');
        if (!buttons.querySelector('.streamflix-osd-episodes-btn')) {
            var epBtn = document.createElement('button');
            epBtn.type = 'button';
            epBtn.className = 'streamflix-osd-custom-btn streamflix-osd-episodes-btn hide';
            epBtn.title = 'Episodes & Seasons';
            epBtn.setAttribute('aria-label', 'Episodes and Seasons');
            epBtn.innerHTML = icon('episodes');
            epBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                toggleOsdEpisodesDrawer();
            });
            if (anchor && anchor.parentNode === buttons) {
                buttons.insertBefore(epBtn, anchor);
            } else {
                buttons.appendChild(epBtn);
            }
        }
        if (!buttons.querySelector('.streamflix-osd-tracks-btn')) {
            var trBtn = document.createElement('button');
            trBtn.type = 'button';
            trBtn.className = 'streamflix-osd-custom-btn streamflix-osd-tracks-btn hide';
            trBtn.title = 'Audio & Subtitles';
            trBtn.setAttribute('aria-label', 'Audio and Subtitles');
            trBtn.innerHTML = icon('subtitles');
            trBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                toggleOsdTracksPopover();
            });
            if (anchor && anchor.parentNode === buttons) {
                buttons.insertBefore(trBtn, anchor);
            } else {
                buttons.appendChild(trBtn);
            }
        }
        // Intercept native .btnSubtitles / .btnAudio clicks when streams are known so users always get the sleek two-column popover
        ['btnSubtitles', 'btnAudio'].forEach(function (cls) {
            var nb = buttons.querySelector('.' + cls);
            if (nb && !nb.__bfxTracksBound) {
                nb.__bfxTracksBound = true;
                nb.addEventListener('click', function (ev) {
                    if (nb.__bfxBypass) {
                        return;
                    }
                    if (getOsdMediaStreams().length > 0) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        toggleOsdTracksPopover();
                    }
                }, true);
            }
        });
    }

    function syncOsdExtraButtons() {
        var page = document.getElementById('videoOsdPage');
        if (!page) {
            return;
        }
        var epBtn = page.querySelector('.streamflix-osd-episodes-btn');
        if (epBtn) {
            var showEp = Boolean(osdState.info ? (osdState.info.Type === 'Episode' || osdState.info.SeriesId) : isCurrentOsdEpisode());
            epBtn.classList.toggle('hide', !showEp);
            epBtn.classList.toggle('is-active', Boolean(osdState.episodesOpen));
        }
        var trBtn = page.querySelector('.streamflix-osd-tracks-btn');
        var streams = getOsdMediaStreams();
        var hasStreams = streams.some(function (st) { return st && (st.Type === 'Audio' || st.Type === 'Subtitle'); });
        var subNative = page.querySelector('.btnSubtitles:not(.hide)');
        var audNative = page.querySelector('.btnAudio:not(.hide)');
        var showTracks = Boolean(hasStreams || subNative || audNative);
        if (trBtn) {
            trBtn.classList.toggle('hide', !showTracks);
            trBtn.classList.toggle('is-active', Boolean(osdState.tracksOpen));
        }
        document.body.classList.toggle('bfx-unified-tracks', showTracks);
    }

    function fetchOsdSeriesEpisodes(seriesId) {
        if (!seriesId) {
            return Promise.resolve([]);
        }
        if (Array.isArray(osdState.episodesCache[seriesId]) && osdState.episodesCache[seriesId].length) {
            return Promise.resolve(osdState.episodesCache[seriesId]);
        }
        var auth = getJellyfinAuthContext();
        var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
        if (!uid) {
            return Promise.resolve([]);
        }
        return apiFetch('/Shows/' + encodeURIComponent(seriesId) + '/Episodes?userId=' + uid + '&Fields=Overview,PrimaryImageAspectRatio')
            .catch(function () {
                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(seriesId) + '&Recursive=true&IncludeItemTypes=Episode&Fields=Overview,PrimaryImageAspectRatio');
            })
            .then(function (res) {
                var eps = (res && Array.isArray(res.Items)) ? res.Items : [];
                if (eps.length) {
                    osdState.episodesCache[seriesId] = eps;
                }
                return eps;
            })
            .catch(function () {
                return [];
            });
    }

    function preloadOsdNextEpisode(item) {
        if (!item || item.Type !== 'Episode' || !item.SeriesId || !item.Id) {
            osdState.nextEpisode = null;
            osdState.nextEpisodeForId = '';
            return;
        }
        var normCur = normalizeGuid(item.Id);
        if (osdState.nextEpisodeForId === normCur) {
            return;
        }
        osdState.nextEpisodeForId = normCur;
        fetchOsdSeriesEpisodes(item.SeriesId).then(function (eps) {
            if (!osdState.info || normalizeGuid(osdState.info.Id) !== normCur) {
                return;
            }
            var idx = -1;
            for (var i = 0; i < eps.length; i++) {
                if (eps[i] && normalizeGuid(eps[i].Id) === normCur) {
                    idx = i;
                    break;
                }
            }
            if (idx === -1 && item.IndexNumber != null) {
                for (var j = 0; j < eps.length; j++) {
                    if (eps[j] && (eps[j].ParentIndexNumber || 1) === (item.ParentIndexNumber || 1) && eps[j].IndexNumber === item.IndexNumber) {
                        idx = j;
                        break;
                    }
                }
            }
            osdState.nextEpisode = (idx !== -1 && idx + 1 < eps.length) ? eps[idx + 1] : null;
            checkOsdUpNext();
        });
    }

    function playEpisodeFromOsd(ep) {
        if (!ep || !ep.Id) {
            return;
        }
        closeOsdOverlays();
        hideOsdUpNextCard();
        osdState.lastSwitchedEpisodeId = ep.Id;
        playItemImmediately(ep, osdState.audioIndex, osdState.subtitleIndex);
    }

    function closeOsdEpisodesDrawer() {
        osdState.episodesOpen = false;
        var el = document.getElementById('streamflix-osd-episodes');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
        syncOsdExtraButtons();
    }

    function closeOsdTracksPopover() {
        osdState.tracksOpen = false;
        var el = document.getElementById('streamflix-osd-tracks');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
        syncOsdExtraButtons();
    }

    function closeOsdOverlays() {
        var closed = Boolean(osdState.episodesOpen || osdState.tracksOpen);
        closeOsdEpisodesDrawer();
        closeOsdTracksPopover();
        return closed;
    }

    function toggleOsdEpisodesDrawer() {
        if (osdState.episodesOpen && document.getElementById('streamflix-osd-episodes')) {
            closeOsdEpisodesDrawer();
            return;
        }
        closeOsdTracksPopover();
        hideOsdPaused();
        hideOsdUpNextCard();
        osdState.episodesOpen = true;
        syncOsdExtraButtons();

        var it = osdState.info || {};
        var seriesTitle = it.SeriesName || osdDisplayInfo().title || 'Episodes';
        var curEpId = it.Id || '';
        var seriesId = it.SeriesId || '';

        var existing = document.getElementById('streamflix-osd-episodes');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        var wrap = document.createElement('div');
        wrap.id = 'streamflix-osd-episodes';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-label', 'Episodes and Seasons');
        wrap.innerHTML = ''
            + '<div class="bfx-osd-drawer-scrim" data-ep-dismiss="1"></div>'
            + '<aside class="bfx-osd-drawer-panel">'
            + '  <div class="bfx-osd-drawer-head">'
            + '    <div class="bfx-osd-drawer-titles">'
            + '      <div class="bfx-osd-drawer-kicker">Episodes &amp; Seasons</div>'
            + '      <h3 class="bfx-osd-drawer-title">' + escapeHtml(seriesTitle) + '</h3>'
            + '    </div>'
            + '    <button type="button" class="bfx-osd-drawer-close" id="streamflix-osd-ep-close" title="Close" aria-label="Close">' + icon('close') + '</button>'
            + '  </div>'
            + '  <div class="bfx-osd-season-tabs" id="streamflix-osd-season-tabs"></div>'
            + '  <div class="bfx-osd-ep-list" id="streamflix-osd-ep-list">'
            + '    <div class="bfx-osd-ep-loading"><span class="streamflix-inline-spinner"></span><span>Loading episodes…</span></div>'
            + '  </div>'
            + '</aside>';
        document.body.appendChild(wrap);

        wrap.querySelector('[data-ep-dismiss]').addEventListener('click', closeOsdEpisodesDrawer);
        wrap.querySelector('#streamflix-osd-ep-close').addEventListener('click', closeOsdEpisodesDrawer);

        fetchOsdSeriesEpisodes(seriesId).then(function (eps) {
            if (!osdState.episodesOpen || !wrap.parentNode) {
                return;
            }
            var listEl = wrap.querySelector('#streamflix-osd-ep-list');
            var tabsEl = wrap.querySelector('#streamflix-osd-season-tabs');
            if (!eps.length) {
                listEl.innerHTML = '<div class="bfx-osd-ep-empty">No other episodes found for this series.</div>';
                return;
            }
            var seasonsMap = {};
            var seasonNums = [];
            var epById = {};
            eps.forEach(function (ep) {
                if (ep && ep.Id) {
                    epById[ep.Id] = ep;
                }
                var sNum = ep.ParentIndexNumber || 1;
                if (!seasonsMap[sNum]) {
                    seasonsMap[sNum] = [];
                    seasonNums.push(sNum);
                }
                seasonsMap[sNum].push(ep);
            });
            var activeSeason = (it.ParentIndexNumber && seasonsMap[it.ParentIndexNumber])
                ? it.ParentIndexNumber
                : seasonNums[0];
            osdState.selectedSeason = activeSeason;

            function renderDrawerSeason() {
                tabsEl.innerHTML = seasonNums.map(function (sNum) {
                    var on = sNum === activeSeason;
                    return '<button type="button" class="bfx-osd-season-tab' + (on ? ' active' : '') + '" data-season-num="' + sNum + '">Season ' + sNum + '</button>';
                }).join('');
                tabsEl.style.display = seasonNums.length > 1 ? 'flex' : 'none';

                var sEps = seasonsMap[activeSeason] || [];
                listEl.innerHTML = sEps.map(function (ep, idx) {
                    var isCurrent = curEpId && normalizeGuid(ep.Id) === normalizeGuid(curEpId);
                    var pct = (ep.UserData && ep.UserData.PlayedPercentage) ? Math.min(100, Math.max(3, Math.round(ep.UserData.PlayedPercentage))) : 0;
                    var played = Boolean(ep.UserData && ep.UserData.Played);
                    var dur = formatRuntimeTicks(ep.RunTimeTicks);
                    var epNum = ep.IndexNumber != null ? ep.IndexNumber : (idx + 1);
                    return ''
                        + '<button type="button" class="bfx-osd-ep-card' + (isCurrent ? ' is-current' : '') + '" data-ep-id="' + escapeHtml(ep.Id) + '">'
                        + '  <div class="bfx-osd-ep-thumb">'
                        + '    <img loading="lazy" src="' + escapeHtml(getItemBackdropUrl(ep, 400)) + '" alt="" onload="this.classList.add(\'is-loaded\')" onerror="this.style.opacity=\'0.18\'" />'
                        + (isCurrent
                            ? '<span class="bfx-osd-ep-now">Playing</span>'
                            : '<span class="bfx-osd-ep-play">' + icon('play') + '</span>')
                        + (!isCurrent && played ? '<span class="bfx-osd-ep-watched" title="Watched">' + icon('check') + '</span>' : '')
                        + (pct > 0 ? '<span class="bfx-osd-ep-bar"><i style="width:' + pct + '%"></i></span>' : '')
                        + '  </div>'
                        + '  <div class="bfx-osd-ep-body">'
                        + '    <div class="bfx-osd-ep-top">'
                        + '      <span class="bfx-osd-ep-name">' + epNum + '. ' + escapeHtml(ep.Name || ('Episode ' + epNum)) + '</span>'
                        + (dur ? '<span class="bfx-osd-ep-dur">' + escapeHtml(dur.trim()) + '</span>' : '')
                        + '    </div>'
                        + (ep.Overview ? '<div class="bfx-osd-ep-desc">' + escapeHtml(ep.Overview) + '</div>' : '')
                        + '  </div>'
                        + '</button>';
                }).join('');

                Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-season-num]'), function (tb) {
                    tb.addEventListener('click', function () {
                        activeSeason = parseInt(tb.getAttribute('data-season-num'), 10) || seasonNums[0];
                        osdState.selectedSeason = activeSeason;
                        renderDrawerSeason();
                    });
                });

                Array.prototype.forEach.call(listEl.querySelectorAll('[data-ep-id]'), function (cardBtn) {
                    cardBtn.addEventListener('click', function () {
                        var eid = cardBtn.getAttribute('data-ep-id');
                        if (curEpId && normalizeGuid(eid) === normalizeGuid(curEpId)) {
                            closeOsdEpisodesDrawer();
                            if (osdState.video && osdState.video.paused) {
                                try { osdState.video.play(); } catch (e) {}
                            }
                            return;
                        }
                        playEpisodeFromOsd(epById[eid] || { Id: eid });
                    });
                });

                var curCardEl = listEl.querySelector('.bfx-osd-ep-card.is-current');
                if (curCardEl && curCardEl.scrollIntoView) {
                    try { curCardEl.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
                }
                if (isTvOrDpadActive()) {
                    var focusCard = curCardEl || listEl.querySelector('.bfx-osd-ep-card');
                    if (focusCard) {
                        try { focusCard.focus({ preventScroll: true }); } catch (e) {}
                    }
                }
            }

            renderDrawerSeason();
        });
    }

    function applyOsdTrackSelection(kind, idx) {
        var streams = getOsdMediaStreams();
        if (kind === 'audio') {
            osdState.audioIndex = idx;
        } else {
            osdState.subtitleIndex = idx;
        }
        // 1. Direct Jellyfin playbackManager if exposed in global scope
        try {
            var pm = window.StreamFlixPlaybackManager || window.playbackManager;
            if (pm) {
                if (kind === 'audio' && typeof pm.setAudioStreamIndex === 'function') {
                    pm.setAudioStreamIndex(idx);
                } else if (kind === 'subtitle' && typeof pm.setSubtitleStreamIndex === 'function') {
                    pm.setSubtitleStreamIndex(idx);
                }
            }
        } catch (ePm) {}

        // 2. Sync browser HTML5 textTracks / audioTracks when available
        try {
            var v = osdState.video;
            if (v && kind === 'subtitle' && v.textTracks && v.textTracks.length) {
                var chosenSub = streams.filter(function (st) { return st && st.Type === 'Subtitle' && st.Index === idx; })[0];
                var wantedLang = chosenSub ? String(chosenSub.Language || '').toLowerCase() : '';
                var matched = false;
                for (var t = 0; t < v.textTracks.length; t++) {
                    var tt = v.textTracks[t];
                    if (idx === -1) {
                        tt.mode = 'disabled';
                    } else if (!matched && wantedLang && String(tt.language || '').toLowerCase().indexOf(wantedLang.slice(0, 2)) === 0) {
                        tt.mode = 'showing';
                        matched = true;
                    } else {
                        tt.mode = 'disabled';
                    }
                }
            }
        } catch (eTt) {}

        // 3. Jellyfin Session Command API — triggers Jellyfin Web's own WebSocket GeneralCommand handler (works on 10.9, 10.11 & 12.x!)
        if (osdState.sessionId) {
            var cmdName = kind === 'audio' ? 'SetAudioStreamIndex' : 'SetSubtitleStreamIndex';
            apiFetch('/Sessions/' + encodeURIComponent(osdState.sessionId) + '/Command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    Name: cmdName,
                    Arguments: { Index: String(idx) }
                })
            }).catch(function () {});
        }
    }

    function toggleOsdTracksPopover() {
        if (osdState.tracksOpen && document.getElementById('streamflix-osd-tracks')) {
            closeOsdTracksPopover();
            return;
        }
        closeOsdEpisodesDrawer();
        hideOsdPaused();

        var streams = getOsdMediaStreams();
        var audios = streams.filter(function (st) { return st && st.Type === 'Audio'; });
        var subs = streams.filter(function (st) { return st && st.Type === 'Subtitle'; });

        // Fallback if server hasn't returned MediaStreams for an unusual source: open Jellyfin's native menu cleanly
        if (!audios.length && !subs.length) {
            var page = document.getElementById('videoOsdPage');
            var fallbackBtn = page && (page.querySelector('.btnSubtitles:not(.hide)') || page.querySelector('.btnAudio:not(.hide)'));
            if (fallbackBtn) {
                fallbackBtn.__bfxBypass = true;
                try { fallbackBtn.click(); } finally { fallbackBtn.__bfxBypass = false; }
                return;
            }
        }

        osdState.tracksOpen = true;
        syncOsdExtraButtons();

        var existing = document.getElementById('streamflix-osd-tracks');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        var wrap = document.createElement('div');
        wrap.id = 'streamflix-osd-tracks';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-label', 'Audio and Subtitles');

        function renderPopoverColumns() {
            var curAudio = osdState.audioIndex;
            var curSub = osdState.subtitleIndex != null ? osdState.subtitleIndex : -1;

            var audioListHtml = audios.length
                ? audios.map(function (a, i) {
                    var on = curAudio === a.Index || (curAudio == null && i === 0);
                    var label = a.DisplayTitle || a.Title || a.Language || ('Track ' + (i + 1));
                    return '<button type="button" class="bfx-track-opt' + (on ? ' is-selected' : '') + '" data-audio-idx="' + a.Index + '">'
                        + '<span class="bfx-track-check">' + (on ? icon('check') : '') + '</span>'
                        + '<span class="bfx-track-label">' + escapeHtml(label) + '</span>'
                        + '</button>';
                }).join('')
                : '<div class="bfx-track-empty">Default audio</div>';

            var subOffOn = curSub === -1;
            var subListHtml = '<button type="button" class="bfx-track-opt' + (subOffOn ? ' is-selected' : '') + '" data-sub-idx="-1">'
                + '<span class="bfx-track-check">' + (subOffOn ? icon('check') : '') + '</span>'
                + '<span class="bfx-track-label">Off</span>'
                + '</button>'
                + subs.map(function (sb, i) {
                    var on = curSub === sb.Index;
                    var label = sb.DisplayTitle || sb.Title || sb.Language || ('Subtitles ' + (i + 1));
                    return '<button type="button" class="bfx-track-opt' + (on ? ' is-selected' : '') + '" data-sub-idx="' + sb.Index + '">'
                        + '<span class="bfx-track-check">' + (on ? icon('check') : '') + '</span>'
                        + '<span class="bfx-track-label">' + escapeHtml(label) + '</span>'
                        + '</button>';
                }).join('');

            wrap.innerHTML = ''
                + '<div class="bfx-tracks-scrim" data-tracks-dismiss="1"></div>'
                + '<div class="bfx-tracks-card">'
                + '  <div class="bfx-tracks-cols">'
                + '    <div class="bfx-tracks-col">'
                + '      <div class="bfx-tracks-heading">Audio</div>'
                + '      <div class="bfx-tracks-list">' + audioListHtml + '</div>'
                + '    </div>'
                + '    <div class="bfx-tracks-col">'
                + '      <div class="bfx-tracks-heading">Subtitles</div>'
                + '      <div class="bfx-tracks-list">' + subListHtml + '</div>'
                + '    </div>'
                + '  </div>'
                + '</div>';

            wrap.querySelector('[data-tracks-dismiss]').addEventListener('click', closeOsdTracksPopover);
            Array.prototype.forEach.call(wrap.querySelectorAll('[data-audio-idx]'), function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.getAttribute('data-audio-idx'), 10);
                    applyOsdTrackSelection('audio', idx);
                    renderPopoverColumns();
                });
            });
            Array.prototype.forEach.call(wrap.querySelectorAll('[data-sub-idx]'), function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.getAttribute('data-sub-idx'), 10);
                    applyOsdTrackSelection('subtitle', idx);
                    renderPopoverColumns();
                });
            });
        }

        renderPopoverColumns();
        document.body.appendChild(wrap);
        if (isTvOrDpadActive()) {
            var firstOpt = wrap.querySelector('.bfx-track-opt.is-selected, .bfx-track-opt');
            if (firstOpt) {
                try { firstOpt.focus({ preventScroll: true }); } catch (e) {}
            }
        }
    }

    function hideOsdUpNextCard() {
        osdState.upNextVisible = false;
        if (osdState.upNextTimer) {
            clearInterval(osdState.upNextTimer);
            osdState.upNextTimer = null;
        }
        var el = document.getElementById('streamflix-osd-upnext');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function isInsideCreditsChapter(v) {
        var chapters = osdState.info && Array.isArray(osdState.info.Chapters) ? osdState.info.Chapters : [];
        if (!v || !chapters.length || typeof v.currentTime !== 'number') {
            return false;
        }
        for (var i = 0; i < chapters.length; i++) {
            var ch = chapters[i];
            if (ch && /^(end\s*credits|credits|outro)$/i.test(String(ch.Name || '').trim())) {
                var startSec = (Number(ch.StartPositionTicks) || 0) / 10000000;
                if (v.currentTime >= startSec) {
                    return true;
                }
            }
        }
        return false;
    }

    function checkOsdUpNext() {
        var v = osdState.video;
        var nextEp = osdState.nextEpisode;
        var curIt = osdState.info;
        if (!v || !nextEp || !curIt || !isVideoPlayerActive() || osdState.episodesOpen || osdState.tracksOpen) {
            if (osdState.upNextVisible && (osdState.episodesOpen || osdState.tracksOpen || !isVideoPlayerActive())) {
                hideOsdUpNextCard();
            }
            return;
        }
        if (document.querySelector('.upNextDialog:not(.hide)')) {
            hideOsdUpNextCard();
            return;
        }
        var dur = Number(v.duration) || ((Number(curIt.RunTimeTicks) || 0) / 10000000);
        var cur = Number(v.currentTime) || 0;
        if (!dur || dur < 60 || isNaN(cur)) {
            return;
        }
        var rem = dur - cur;
        var normCur = normalizeGuid(curIt.Id);
        if (osdState.upNextDismissedForId === normCur) {
            return;
        }
        var inEndWindow = (rem > 0.3 && rem <= 35) || (isInsideCreditsChapter(v) && rem > 0.3 && rem <= 90);
        if (!inEndWindow) {
            if (osdState.upNextVisible && rem > 40) {
                hideOsdUpNextCard();
            }
            return;
        }
        if (osdState.upNextVisible && document.getElementById('streamflix-osd-upnext')) {
            return;
        }
        showOsdUpNextCard(nextEp, normCur, Math.min(10, Math.max(3, Math.ceil(rem))));
    }

    function showOsdUpNextCard(nextEp, normCurId, seconds) {
        hideOsdUpNextCard();
        hideOsdPaused();
        osdState.upNextVisible = true;
        osdState.upNextCountdown = seconds || 10;
        osdState.upNextTotal = osdState.upNextCountdown;

        var epTag = 'S' + (nextEp.ParentIndexNumber || 1) + ':E' + (nextEp.IndexNumber || 1);
        var titleText = epTag + (nextEp.Name ? ' · ' + nextEp.Name : '');
        var card = document.createElement('div');
        card.id = 'streamflix-osd-upnext';
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', 'Next episode');
        card.innerHTML = ''
            + '<div class="bfx-upnext-thumb" data-upnext-play="1">'
            + '  <img src="' + escapeHtml(getItemBackdropUrl(nextEp, 480)) + '" alt="" onload="this.classList.add(\'is-loaded\')" onerror="this.style.opacity=\'0.2\'" />'
            + '  <span class="bfx-upnext-thumb-play">' + icon('play') + '</span>'
            + '</div>'
            + '<div class="bfx-upnext-body">'
            + '  <div class="bfx-upnext-kicker"><span>Next Episode</span><b id="streamflix-upnext-secs">in ' + osdState.upNextCountdown + 's</b></div>'
            + '  <div class="bfx-upnext-title">' + escapeHtml(titleText) + '</div>'
            + '  <div class="bfx-upnext-actions">'
            + '    <button type="button" class="bfx-upnext-play-btn" id="streamflix-upnext-play">'
            + '      <span class="bfx-upnext-fill" id="streamflix-upnext-fill" style="transform:scaleX(0)"></span>'
            + '      <span class="bfx-upnext-play-content">' + icon('play') + '<span>Play Next</span></span>'
            + '    </button>'
            + '    <button type="button" class="bfx-upnext-dismiss-btn" id="streamflix-upnext-dismiss">Watch Credits</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(card);

        var startNow = function () {
            playEpisodeFromOsd(nextEp);
        };
        card.querySelector('#streamflix-upnext-play').addEventListener('click', startNow);
        card.querySelector('[data-upnext-play]').addEventListener('click', startNow);
        card.querySelector('#streamflix-upnext-dismiss').addEventListener('click', function () {
            osdState.upNextDismissedForId = normCurId;
            hideOsdUpNextCard();
        });

        osdState.upNextTimer = setInterval(function () {
            if (!osdState.upNextVisible || !document.getElementById('streamflix-osd-upnext')) {
                hideOsdUpNextCard();
                return;
            }
            if (osdState.video && osdState.video.paused) {
                return;
            }
            osdState.upNextCountdown = Math.max(0, osdState.upNextCountdown - 1);
            var secsEl = document.getElementById('streamflix-upnext-secs');
            if (secsEl) {
                secsEl.textContent = osdState.upNextCountdown > 0 ? ('in ' + osdState.upNextCountdown + 's') : 'Starting…';
            }
            var fillEl = document.getElementById('streamflix-upnext-fill');
            if (fillEl && osdState.upNextTotal > 0) {
                var frac = (osdState.upNextTotal - osdState.upNextCountdown) / osdState.upNextTotal;
                fillEl.style.transform = 'scaleX(' + Math.min(1, Math.max(0, frac)).toFixed(3) + ')';
            }
            if (osdState.upNextCountdown <= 0) {
                hideOsdUpNextCard();
                playEpisodeFromOsd(nextEp);
            }
        }, 1000);
    }

    function teardownVideoOsd() {
        if (!document.body.classList.contains('streamflix-nf-player') && !osdState.video) {
            return;
        }
        document.body.classList.remove('streamflix-nf-player', 'streamflix-osd-paused-on', 'bfx-unified-tracks');
        unbindOsdVideo();
        if (osdState.pausedTimer) {
            clearTimeout(osdState.pausedTimer);
            osdState.pausedTimer = null;
        }
        closeOsdOverlays();
        hideOsdUpNextCard();
        ['streamflix-osd-flash', 'streamflix-osd-paused', 'streamflix-osd-episodes', 'streamflix-osd-tracks', 'streamflix-osd-upnext'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });
        osdState.info = null;
        osdState.infoFor = '';
        osdState.infoTries = 0;
        osdState.sessionId = '';
        osdState.playState = null;
        osdState.tracksItemId = '';
        osdState.nextEpisode = null;
        osdState.nextEpisodeForId = '';
        osdState.upNextDismissedForId = '';
    }

    function ensureHeaderWidgets() {
        syncDeviceLayoutClasses();
        applyProfileAccent(state.activeProfile || null);
        var inVideo = isVideoPlayerActive();
        document.body.classList.toggle('streamflix-in-video-player', inVideo);
        try { enhanceVideoOsd(inVideo); } catch (eOsd) {}

        neutralizeConflictingBrandingCss();
        hideRedundantJellyfinAvatarIcon();
        replaceToolbarLogoInPlace();

        var overlayOpen = Boolean(document.getElementById('streamflix-overlay-root'));

        if (inVideo && state.accountDropdownOpen) {
            closeAccountDropdown();
        }

        // Merged Top-Right Profile & Account Pill
        var active = state.activeProfile;
        // Cast & SyncPlay live in the account menu while a StreamFlix profile is active; during playback
        // Jellyfin's own Cast button comes back in the video player's top bar
        tagNativeHeaderButtons();
        document.body.classList.toggle('bfx-header-tucked', Boolean(active));
        if (!active) {
            var staleBtn = document.getElementById('streamflix-header-profile-btn');
            if (staleBtn) {
                staleBtn.style.setProperty('display', 'none', 'important');
            }
            return;
        }

        var btn = document.getElementById('streamflix-header-profile-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'streamflix-header-profile-btn';
            btn.title = 'Switch Profile, Manage Profiles & Account Settings';
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                toggleAccountDropdown();
            });
            document.body.appendChild(btn);
        }

        if (overlayOpen || inVideo) {
            btn.style.setProperty('display', 'none', 'important');
        } else {
            btn.style.setProperty('display', 'inline-flex', 'important');
        }

        var wantedSig = (active.id || '') + ':' + (active.name || '') + ':' + (active.icon || '') + ':' + (active.color || '');
        if (btn.getAttribute('data-sig') !== wantedSig) {
            btn.setAttribute('data-sig', wantedSig);
            btn.title = active.name + ' — profiles & settings';
            btn.setAttribute('aria-label', active.name + ' — profiles and settings');
            btn.setAttribute('aria-haspopup', 'menu');
            btn.innerHTML = ''
                + '<span class="streamflix-header-avatar" style="background:' + escapeHtml(active.color || '#E50914') + ';">'
                + escapeHtml(active.icon || '🎬')
                + '</span>'
                + '<span class="streamflix-header-name">' + escapeHtml(active.name) + '</span>'
                + '<span class="streamflix-header-caret">' + icon('chevronDown') + '</span>';
        }
        syncHeaderCastIndicator(btn);
    }

    /* ----------------------------------------------------------------------
       6. FULL STREAMFLIX CINEMA HUB (Hero Billboard, Live Search, Top 10 & Carousels)
       ---------------------------------------------------------------------- */
    function isOnHomeRoute() {
        var h = (window.location.hash || '').toLowerCase();
        return h === '' || h === '#' || h === '#/' || h === '#!/' || h.indexOf('#/home') === 0 || h.indexOf('#!/home') === 0;
    }

    function getJellyfinAuthContext() {
        var userId = (state.activeProfile && state.activeProfile.jellyfinUserId)
            || (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : null);
        var token = (state.activeProfile && state.activeProfile.accessToken)
            || (window.ApiClient && typeof window.ApiClient.accessToken === 'function' ? window.ApiClient.accessToken() : null);
        return { userId: userId, token: token };
    }

    function getItemBackdropUrl(item, maxWidth) {
        if (!item) {
            return '';
        }
        var w = maxWidth || 1280;
        if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
            return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Backdrop/0?maxWidth=' + w + '&quality=85';
        }
        if (item.ParentBackdropItemId && (!item.ParentBackdropImageTags || item.ParentBackdropImageTags.length > 0)) {
            return apiBase() + '/Items/' + encodeURIComponent(item.ParentBackdropItemId) + '/Images/Backdrop/0?maxWidth=' + w + '&quality=85';
        }
        if (item.Type === 'Episode' && item.ImageTags && item.ImageTags.Primary) {
            return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Primary?maxWidth=' + w + '&quality=85';
        }
        if (item.ImageTags && item.ImageTags.Thumb) {
            return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Thumb?maxWidth=' + w + '&quality=85';
        }
        if (item.SeriesId) {
            return apiBase() + '/Items/' + encodeURIComponent(item.SeriesId) + '/Images/Backdrop/0?maxWidth=' + w + '&quality=85';
        }
        return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Primary?maxWidth=' + w + '&quality=85';
    }

    function getItemPosterUrl(item, maxWidth) {
        if (!item) {
            return '';
        }
        var w = maxWidth || 420;
        var targetId = (item.Type === 'Episode' && item.SeriesId) ? item.SeriesId : item.Id;
        return apiBase() + '/Items/' + encodeURIComponent(targetId) + '/Images/Primary?maxWidth=' + w + '&quality=85';
    }

    function formatRuntimeTicks(ticks) {
        if (!ticks || ticks <= 0) {
            return '';
        }
        var totalMins = Math.round(ticks / 600000000);
        if (totalMins < 60) {
            return totalMins + 'm';
        }
        var hrs = Math.floor(totalMins / 60);
        var mins = totalMins % 60;
        return hrs + 'h ' + (mins > 0 ? mins + 'm' : '');
    }

    function toggleFavoriteItem(item, btnEl) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token || !item || !item.Id) {
            return;
        }
        var uid = encodeURIComponent(auth.userId);
        var iid = encodeURIComponent(item.Id);
        var isFav = item.UserData && item.UserData.IsFavorite;
        var method = isFav ? 'DELETE' : 'POST';
        apiFetch('/UserFavoriteItems/' + iid + '?userId=' + uid, {
            method: method
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/FavoriteItems/' + iid, {
                method: method
            });
        }).then(function (userData) {
            item.UserData = userData || item.UserData || {};
            item.UserData.IsFavorite = !isFav;
            if (btnEl) {
                btnEl.classList.toggle('active', item.UserData.IsFavorite);
                btnEl.innerHTML = item.UserData.IsFavorite ? icon('check') : icon('plus');
                btnEl.title = item.UserData.IsFavorite ? 'Remove from My List' : 'Add to My List';
            }
            loadCinemaHubData(true);
        }).catch(function () {});
    }

    function togglePlayedItem(item, btnEl) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token || !item || !item.Id) {
            return;
        }
        var uid = encodeURIComponent(auth.userId);
        var iid = encodeURIComponent(item.Id);
        var isPlayed = item.UserData && item.UserData.Played;
        var method = isPlayed ? 'DELETE' : 'POST';
        apiFetch('/UserPlayedItems/' + iid + '?userId=' + uid, {
            method: method
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/PlayedItems/' + iid, {
                method: method
            });
        }).then(function (userData) {
            item.UserData = userData || item.UserData || {};
            item.UserData.Played = !isPlayed;
            if (btnEl) {
                btnEl.classList.toggle('active', item.UserData.Played);
            }
            loadCinemaHubData(true);
        }).catch(function () {});
    }

    function syncServerPlaybackPosition(itemId, ticks, fallbackUnplayed) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token || !itemId) {
            return Promise.resolve();
        }
        var uid = encodeURIComponent(auth.userId);
        var iid = encodeURIComponent(itemId);
        var payload = JSON.stringify({ PlaybackPositionTicks: Math.max(0, Math.round(Number(ticks) || 0)) });
        var reqOpts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        };
        return apiFetch('/Users/' + uid + '/Items/' + iid + '/UserData', reqOpts)
            .catch(function () {
                return apiFetch('/Items/' + iid + '/UserData?userId=' + uid, reqOpts);
            })
            .catch(function () {
                if (fallbackUnplayed && !ticks) {
                    return apiFetch('/UserPlayedItems/' + iid + '?userId=' + uid, { method: 'DELETE' });
                }
            })
            .catch(function () {});
    }

    function removeFromContinueWatching(item) {
        if (!item || !item.Id) {
            return;
        }
        var ud = item.UserData || {};
        var prevTicks = Number(ud.PlaybackPositionTicks) || 0;
        var prevPct = Number(ud.PlayedPercentage) || 0;
        var wasPlayed = Boolean(ud.Played);
        var normId = normalizeGuid(item.Id);
        var resumeList = (state.hubData && Array.isArray(state.hubData.resumeItems)) ? state.hubData.resumeItems : [];
        var prevIndex = -1;
        for (var i = 0; i < resumeList.length; i++) {
            if (resumeList[i] && normalizeGuid(resumeList[i].Id) === normId) {
                prevIndex = i;
                if (!prevTicks && resumeList[i].UserData) {
                    prevTicks = Number(resumeList[i].UserData.PlaybackPositionTicks) || 0;
                    prevPct = Number(resumeList[i].UserData.PlayedPercentage) || prevPct;
                }
                break;
            }
        }

        hidePreviewNow();

        var assignUserData = function (target, patchObj) {
            if (!target) {
                return;
            }
            var nextUd = {};
            var srcUd = target.UserData || {};
            Object.keys(srcUd).forEach(function (k) { nextUd[k] = srcUd[k]; });
            Object.keys(patchObj).forEach(function (k) { nextUd[k] = patchObj[k]; });
            target.UserData = nextUd;
        };
        var clearItemProgress = function (target) {
            if (target && target.UserData) {
                assignUserData(target, { PlaybackPositionTicks: 0, PlayedPercentage: 0 });
            }
        };
        clearItemProgress(item);
        if (state.itemCache[item.Id]) {
            clearItemProgress(state.itemCache[item.Id]);
        }
        if (state.hubData && Array.isArray(state.hubData.resumeItems)) {
            state.hubData.resumeItems = state.hubData.resumeItems.filter(function (x) {
                if (x && normalizeGuid(x.Id) === normId) {
                    clearItemProgress(x);
                    return false;
                }
                return true;
            });
        }
        renderCinemaHubContents();
        syncServerPlaybackPosition(item.Id, 0, !wasPlayed);

        var displayName = item.SeriesName ? (item.SeriesName + (item.Name ? ' · ' + item.Name : '')) : (item.Name || 'Title');
        showActionToast('Removed “' + displayName + '” from Continue Watching', 'Undo', function () {
            var restoreProgress = function (target) {
                if (!target) {
                    return;
                }
                var nextTicks = prevTicks || 6000000000;
                var nextPct = prevPct > 0
                    ? prevPct
                    : (target.RunTimeTicks > 0 && nextTicks > 0
                        ? Math.min(99, Math.max(2, Math.round(nextTicks / target.RunTimeTicks * 100)))
                        : 25);
                assignUserData(target, { PlaybackPositionTicks: nextTicks, PlayedPercentage: nextPct });
            };
            restoreProgress(item);
            if (state.itemCache[item.Id]) {
                restoreProgress(state.itemCache[item.Id]);
            }
            if (state.hubData) {
                var cur = Array.isArray(state.hubData.resumeItems) ? state.hubData.resumeItems.slice() : [];
                var exists = cur.some(function (x) { return x && normalizeGuid(x.Id) === normId; });
                if (!exists) {
                    var insertAt = prevIndex >= 0 ? Math.min(prevIndex, cur.length) : 0;
                    cur.splice(insertAt, 0, item);
                    state.hubData.resumeItems = cur;
                }
            }
            renderCinemaHubContents();
            syncServerPlaybackPosition(item.Id, prevTicks || 6000000000, false);
            showToast('Restored “' + displayName + '”', 'success', 2400);
        }, 5000);
    }

    function showPlaybackLoader(labelText) {
        try {
            document.body.classList.add('streamflix-autoplaying');
            var loader = document.getElementById('streamflix-playback-loader');
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'streamflix-playback-loader';
                loader.innerHTML = ''
                    + '<div class="streamflix-spinner-ring"></div>'
                    + '<div class="streamflix-loader-text" style="font-size:15px;font-weight:700;letter-spacing:0.4px;color:#e5e5e5;">'
                    + escapeHtml(labelText || 'Starting playback…')
                    + '</div>';
                document.body.appendChild(loader);
            }
            if (state.loaderSafetyTimeout) {
                clearTimeout(state.loaderSafetyTimeout);
            }
            state.loaderSafetyTimeout = setTimeout(function () {
                hidePlaybackLoader();
            }, 8000);
        } catch (e) {}
    }

    function hidePlaybackLoader() {
        state.autoPlayPending = null;
        if (state.autoPlayTimer) {
            clearInterval(state.autoPlayTimer);
            state.autoPlayTimer = null;
        }
        if (state.shortcutPollTimer) {
            clearInterval(state.shortcutPollTimer);
            state.shortcutPollTimer = null;
        }
        if (state.loaderSafetyTimeout) {
            clearTimeout(state.loaderSafetyTimeout);
            state.loaderSafetyTimeout = null;
        }
        document.body.classList.remove('streamflix-autoplaying');
        var loader = document.getElementById('streamflix-playback-loader');
        if (loader && loader.parentNode) {
            loader.parentNode.removeChild(loader);
        }
    }

    function findCachedItemById(itemId) {
        if (!itemId) {
            return null;
        }
        if (state.itemCache && state.itemCache[itemId]) {
            return state.itemCache[itemId];
        }
        var norm = normalizeGuid(itemId);
        var d = state.hubData || {};
        var lists = [
            d.heroItems, d.resumeItems, d.nextUpItems, d.top10Items,
            d.favoriteItems, d.recentMovies, d.recentSeries,
            d.allMovies, d.allSeries, d.collectionsItems,
            state.searchResults
        ];
        for (var i = 0; i < lists.length; i++) {
            var arr = lists[i];
            if (!Array.isArray(arr)) {
                continue;
            }
            for (var j = 0; j < arr.length; j++) {
                if (arr[j] && normalizeGuid(arr[j].Id) === norm) {
                    return arr[j];
                }
            }
        }
        return null;
    }

    function resolvePlayableItem(itemOrId) {
        var initialObj = (itemOrId && typeof itemOrId === 'object') ? itemOrId : null;
        var rawId = typeof itemOrId === 'string' ? itemOrId : (initialObj && initialObj.Id);
        if (!rawId) {
            return Promise.resolve(null);
        }

        var cached = initialObj || findCachedItemById(rawId);
        var itemPromise = (cached && cached.Type)
            ? Promise.resolve(cached)
            : fetchFullItemDetails(rawId).catch(function () { return cached || { Id: rawId, Type: 'Movie' }; });

        return itemPromise.then(function (item) {
            if (!item || !item.Id) {
                return { Id: rawId, Type: 'Movie', ServerId: resolveKnownServerId() };
            }
            if (!item.ServerId) {
                item.ServerId = resolveKnownServerId();
            }

            var auth = getJellyfinAuthContext();
            var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
            var t = (item.Type || '').toLowerCase();

            // If item is a TV Series or Season, resolve the concrete Episode to play (Resumable -> NextUp -> First Episode)
            if ((t === 'series' || t === 'season') && uid) {
                var seriesId = t === 'series' ? item.Id : (item.SeriesId || item.Id);
                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Episode&Filters=IsResumable&SortBy=DatePlayed&SortOrder=Descending&Limit=1')
                    .then(function (resResume) {
                        if (resResume && Array.isArray(resResume.Items) && resResume.Items.length > 0) {
                            return resResume.Items[0];
                        }
                        if (t === 'series') {
                            return apiFetch('/Shows/NextUp?userId=' + uid + '&SeriesId=' + encodeURIComponent(seriesId) + '&Limit=1')
                                .then(function (resNext) {
                                    if (resNext && Array.isArray(resNext.Items) && resNext.Items.length > 0) {
                                        return resNext.Items[0];
                                    }
                                    return null;
                                })
                                .catch(function () { return null; });
                        }
                        return null;
                    })
                    .then(function (foundEp) {
                        if (foundEp && foundEp.Id) {
                            return foundEp;
                        }
                        return apiFetch('/Shows/' + encodeURIComponent(seriesId) + '/Episodes?userId=' + uid + '&Limit=1')
                            .then(function (resEps) {
                                if (resEps && Array.isArray(resEps.Items) && resEps.Items.length > 0) {
                                    return resEps.Items[0];
                                }
                                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Episode&SortBy=ParentIndexNumber,IndexNumber,SortName&Limit=1')
                                    .then(function (resFallback) {
                                        return (resFallback && Array.isArray(resFallback.Items) && resFallback.Items[0]) || item;
                                    });
                            })
                            .catch(function () { return item; });
                    })
                    .catch(function () { return item; });
            }

            // If item is a BoxSet (Collection) or Folder, resolve its first resumable or first playable child Movie/Episode
            if ((t === 'boxset' || t === 'folder' || t === 'collectionfolder' || item.IsFolder) && uid) {
                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Movie,Episode,Video&Filters=IsResumable&SortBy=DatePlayed&SortOrder=Descending&Limit=1')
                    .then(function (resResume) {
                        if (resResume && Array.isArray(resResume.Items) && resResume.Items.length > 0) {
                            return resResume.Items[0];
                        }
                        return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Movie,Episode,Video&SortBy=PremiereDate,ProductionYear,SortName&Limit=1')
                            .then(function (resFirst) {
                                return (resFirst && Array.isArray(resFirst.Items) && resFirst.Items[0]) || item;
                            });
                    })
                    .catch(function () { return item; });
            }

            return item;
        });
    }

    function applyTrackSelectionToDetailDom(detailPage, audioIdx, subIdx) {
        if (!detailPage) {
            return;
        }
        try {
            if (audioIdx !== undefined && audioIdx !== null && audioIdx !== '') {
                var audioSel = detailPage.querySelector('.selectAudio');
                if (audioSel && String(audioSel.value) !== String(audioIdx)) {
                    audioSel.value = String(audioIdx);
                    audioSel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (subIdx !== undefined && subIdx !== null && subIdx !== '') {
                var subSel = detailPage.querySelector('.selectSubtitles');
                if (subSel && String(subSel.value) !== String(subIdx)) {
                    subSel.value = String(subIdx);
                    subSel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        } catch (e) {}
    }

    function findUpgradedItemsContainer() {
        var candidates = document.querySelectorAll(
            '#indexPage:not(.hide) .itemsContainer, '
            + '.page:not(.hide) .itemsContainer, '
            + '.itemsContainer[is="emby-itemscontainer"], '
            + '.itemsContainer'
        );
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (c && typeof c.notifyRefreshNeeded === 'function') {
                return c;
            }
        }
        var hostWrap = document.getElementById('streamflix-shortcut-host-wrap');
        if (!hostWrap && document.body) {
            hostWrap = document.createElement('div');
            hostWrap.id = 'streamflix-shortcut-host-wrap';
            hostWrap.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
            hostWrap.innerHTML = '<div is="emby-itemscontainer" class="itemsContainer streamflix-shortcut-host"></div>';
            document.body.appendChild(hostWrap);
        }
        var created = hostWrap ? hostWrap.querySelector('.itemsContainer') : null;
        if (created && typeof created.notifyRefreshNeeded === 'function') {
            return created;
        }
        return candidates[0] || created || null;
    }

    function tryInPlaceJellyfinShortcutPlay(targetId, itemObj) {
        try {
            patchJellyfinApiClientMethods();
            var container = findUpgradedItemsContainer();
            if (!container) {
                return false;
            }
            var serverId = (itemObj && itemObj.ServerId) || resolveKnownServerId();
            if (!serverId) {
                return false;
            }
            var itemType = (itemObj && itemObj.Type) || 'Movie';
            var isFolder = itemType === 'Series' || itemType === 'Season' || itemType === 'BoxSet' || itemType === 'Folder';
            var posTicks = (itemObj && itemObj.UserData && itemObj.UserData.PlaybackPositionTicks)
                ? Number(itemObj.UserData.PlaybackPositionTicks)
                : 0;
            var actionName = posTicks > 0 ? 'resume' : 'play';

            // IMPORTANT: In Jellyfin Web's shortcuts.js, dom.parentWithAttribute(e.target, 'data-id') stops at the first element with data-id
            // and reads data-serverid, data-type, data-mediatype, data-isfolder, and data-positionticks from THAT element.
            // So data-id MUST be on tempCard (with all data-* attributes), and NOT duplicated without data-serverid on tempBtn!
            var tempCard = document.createElement('div');
            tempCard.className = 'card playableItemCard';
            tempCard.setAttribute('data-id', targetId);
            tempCard.setAttribute('data-serverid', serverId);
            tempCard.setAttribute('data-type', itemType);
            tempCard.setAttribute('data-mediatype', 'Video');
            tempCard.setAttribute('data-isfolder', isFolder ? 'true' : 'false');
            if (posTicks > 0) {
                tempCard.setAttribute('data-positionticks', String(posTicks));
            }
            tempCard.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';

            var tempBtn = document.createElement('button');
            tempBtn.type = 'button';
            tempBtn.className = 'itemAction cardOverlayFab-primary';
            tempBtn.setAttribute('data-action', actionName);
            tempCard.appendChild(tempBtn);
            container.appendChild(tempCard);

            var clickEvt = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            tempBtn.dispatchEvent(clickEvt);

            setTimeout(function () {
                if (tempCard.parentNode) {
                    tempCard.parentNode.removeChild(tempCard);
                }
            }, 3000);

            // In Jellyfin Web's shortcuts.js (onClick), e.preventDefault() is called synchronously whenever executeAction runs!
            return Boolean(clickEvt.defaultPrevented);
        } catch (e) {
            return false;
        }
    }

    function playItemImmediately(itemOrId, audioStreamIndex, subtitleStreamIndex) {
        var itemObj = (itemOrId && typeof itemOrId === 'object') ? itemOrId : null;
        var targetId = typeof itemOrId === 'string' ? itemOrId : (itemObj && itemObj.Id);
        if (!targetId) {
            return;
        }

        // Prevent duplicate concurrent play calls for the same item within 2000ms
        var normTarget = normalizeGuid(targetId);
        var nowTs = Date.now();
        if (state.lastPlayNormId === normTarget && state.lastPlayTimestamp && (nowTs - state.lastPlayTimestamp < 2000)) {
            return;
        }
        state.lastPlayNormId = normTarget;
        state.lastPlayTimestamp = nowTs;

        if (state.activeProfile && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
            applyJellyfinServerCredentials({
                serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                userId: state.activeProfile.jellyfinUserId,
                accessToken: state.activeProfile.accessToken
            });
        }
        patchJellyfinApiClientMethods();

        // 1. Immediately close any open StreamFlix detail modal AND show the dark playback transition loader
        // so the card disappears right away instead of staying stuck on screen!
        var openModals = document.querySelectorAll('.streamflix-modal-backdrop');
        for (var m = 0; m < openModals.length; m++) {
            if (openModals[m].parentNode) {
                openModals[m].parentNode.removeChild(openModals[m]);
            }
        }
        document.body.classList.remove('streamflix-modal-open');
        hidePlaybackLoader();
        showPlaybackLoader('Starting playback…');

        var hasCustomTracks = (audioStreamIndex !== undefined && audioStreamIndex !== null && audioStreamIndex !== '')
            || (subtitleStreamIndex !== undefined && subtitleStreamIndex !== null && subtitleStreamIndex !== '');

        resolvePlayableItem(itemObj || targetId).then(function (playableItem) {
            var playableId = (playableItem && playableItem.Id) || targetId;
            var serverId = (playableItem && playableItem.ServerId) || resolveKnownServerId();

            function pollUntilVideoPlayerStarts(maxWaitMs) {
                var pollStarted = Date.now();
                var waitLimit = maxWaitMs || 6500;
                if (state.shortcutPollTimer) {
                    clearInterval(state.shortcutPollTimer);
                }
                state.shortcutPollTimer = setInterval(function () {
                    if (isVideoPlayerActive() || document.querySelector('.dialogContainer .dialog:not(.hide)')) {
                        hidePlaybackLoader();
                        return;
                    }
                    if (Date.now() - pollStarted > waitLimit) {
                        hidePlaybackLoader();
                    }
                }, 100);
            }

            function navigateAndClickDetailPlay() {
                showPlaybackLoader('Starting playback…');
                state.autoPlayPending = {
                    id: playableId,
                    audioIndex: audioStreamIndex,
                    subtitleIndex: subtitleStreamIndex,
                    startedAt: Date.now(),
                    clickedOnce: false
                };

                var nowHash = window.location.hash || '';
                var nowMatch = nowHash.match(/[?&]id=([a-f0-9-]+)/i);
                var nowId = nowMatch ? nowMatch[1] : '';
                if (normalizeGuid(nowId) !== normalizeGuid(playableId) || nowHash.indexOf('details') === -1 || (serverId && nowHash.indexOf('serverId=') === -1)) {
                    window.location.hash = '#/details?id=' + encodeURIComponent(playableId)
                        + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');
                }

                if (state.autoPlayTimer) {
                    clearInterval(state.autoPlayTimer);
                }
                state.autoPlayTimer = setInterval(function () {
                    if (!state.autoPlayPending) {
                        hidePlaybackLoader();
                        return;
                    }
                    if (isVideoPlayerActive() || document.querySelector('.dialogContainer .dialog:not(.hide)')) {
                        hidePlaybackLoader();
                        return;
                    }
                    if (Date.now() - state.autoPlayPending.startedAt > 7500) {
                        hidePlaybackLoader();
                        return;
                    }
                    var dp = document.querySelector('#itemDetailPage:not(.hide)');
                    if (!dp) {
                        return;
                    }
                    var mainBtns = dp.querySelector('.mainDetailButtons:not(.hide)');
                    var nameEl = dp.querySelector('.itemName, h1.itemName, .parentName');
                    var hasLoadedTitle = Boolean(nameEl && (nameEl.textContent || '').trim().length > 0);
                    var playBtn = dp.querySelector('.btnResume:not(.hide), .btnPlay:not(.hide), .mainDetailButtons button[data-action="resume"]:not(.hide), .mainDetailButtons button[data-action="play"]:not(.hide)');
                    if (playBtn && mainBtns && hasLoadedTitle) {
                        var pending = state.autoPlayPending;
                        if (!pending.clickedOnce) {
                            pending.clickedOnce = true;
                            applyTrackSelectionToDetailDom(dp, pending.audioIndex, pending.subtitleIndex);
                            playBtn.click();
                            pollUntilVideoPlayerStarts(6000);
                        }
                    }
                }, 90);
            }

            // 2. If #itemDetailPage is already visible and loaded for this exact playable item, click its native Play/Resume button ONCE
            var curHash = window.location.hash || '';
            var curIdMatch = curHash.match(/[?&]id=([a-f0-9-]+)/i);
            var curId = curIdMatch ? curIdMatch[1] : '';
            var detailPage = document.querySelector('#itemDetailPage:not(.hide)');
            if (detailPage && normalizeGuid(curId) === normalizeGuid(playableId)) {
                var curMainBtns = detailPage.querySelector('.mainDetailButtons:not(.hide)');
                var curNameEl = detailPage.querySelector('.itemName, h1.itemName, .parentName');
                var curLoaded = Boolean(curMainBtns && curNameEl && (curNameEl.textContent || '').trim().length > 0);
                var directPlayBtn = detailPage.querySelector('.btnResume:not(.hide), .btnPlay:not(.hide), .mainDetailButtons button[data-action="resume"]:not(.hide), .mainDetailButtons button[data-action="play"]:not(.hide)');
                if (directPlayBtn && curLoaded) {
                    applyTrackSelectionToDetailDom(detailPage, audioStreamIndex, subtitleStreamIndex);
                    directPlayBtn.click();
                    pollUntilVideoPlayerStarts(6000);
                    return;
                }
            }

            // 3. Try in-place Jellyfin shortcut playback first when default tracks are used.
            // When tryInPlaceJellyfinShortcutPlay returns true, shortcuts.js has synchronously called playbackManager.play() —
            // do NOT fire a second navigateAndClickDetailPlay() call that would collide with POST /Items/{id}/PlaybackInfo!
            if (!hasCustomTracks && tryInPlaceJellyfinShortcutPlay(playableId, playableItem)) {
                pollUntilVideoPlayerStarts(6500);
                return;
            }

            // 4. Otherwise navigate to #/details?id=...&serverId=... while keeping #itemDetailPage hidden behind the loader
            navigateAndClickDetailPlay();
        }).catch(function () {
            hidePlaybackLoader();
        });
    }

    function navigateOrPlayItem(itemOrId) {
        playItemImmediately(itemOrId);
    }

    function fetchFullItemDetails(itemId) {
        var auth = getJellyfinAuthContext();
        var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
        // Only pass valid Jellyfin C# ItemFields enum names (SeriesId and SeasonId are returned by default on BaseItemDto and are NOT valid ItemFields enum values)
        var fields = 'Overview,Genres,MediaSources,MediaStreams,People,ExternalUrls,Studios,Taglines,ParentId,Chapters';
        if (uid) {
            return apiFetch('/Users/' + uid + '/Items/' + encodeURIComponent(itemId) + '?Fields=' + fields)
                .catch(function () {
                    return apiFetch('/Items/' + encodeURIComponent(itemId) + '?userId=' + uid + '&Fields=' + fields);
                })
                .catch(function () {
                    return apiFetch('/Users/' + uid + '/Items/' + encodeURIComponent(itemId));
                })
                .catch(function () {
                    return apiFetch('/Items/' + encodeURIComponent(itemId));
                });
        }
        return apiFetch('/Items/' + encodeURIComponent(itemId) + '?Fields=' + fields)
            .catch(function () {
                return apiFetch('/Items/' + encodeURIComponent(itemId));
            });
    }

    function openHeroDetailModalById(itemId, options) {
        if (!itemId) {
            return;
        }
        var cached = findCachedItemById(itemId);
        if (cached && cached.Id && cached.Name) {
            openHeroDetailModal(cached, options);
            return;
        }
        fetchFullItemDetails(itemId).then(function (fullItem) {
            if (fullItem && fullItem.Id) {
                openHeroDetailModal(fullItem, options);
            }
        }).catch(function () {});
    }

    function fetchUserItems(uid, queryString) {
        var hasFilters = queryString.indexOf('Filters=') !== -1;
        return apiFetch('/Items?userId=' + uid + '&' + queryString).then(function (res) {
            if (res && Array.isArray(res.Items) && res.Items.length > 0) {
                return res;
            }
            return apiFetch('/Users/' + uid + '/Items?' + queryString).then(function (res2) {
                if (res2 && Array.isArray(res2.Items) && res2.Items.length > 0) {
                    return res2;
                }
                if (hasFilters) {
                    return res2 || res || { Items: [] };
                }
                return apiFetch('/Items?' + queryString).catch(function () {
                    return res2 || res || { Items: [] };
                });
            }).catch(function () {
                if (hasFilters) {
                    return res || { Items: [] };
                }
                return apiFetch('/Items?' + queryString);
            });
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/Items?' + queryString);
        }).catch(function () {
            if (hasFilters) {
                return { Items: [] };
            }
            return apiFetch('/Items?' + queryString);
        }).catch(function () {
            return { Items: [] };
        });
    }

    function fetchResumeItems(uid, fields) {
        var qs = 'Recursive=true&Limit=12&MediaTypes=Video&Fields=' + fields;
        return apiFetch('/UserItems/Resume?userId=' + uid + '&' + qs).catch(function () {
            return apiFetch('/Users/' + uid + '/Items/Resume?' + qs);
        }).catch(function () {
            return apiFetch('/UserItems/Resume?' + qs);
        }).catch(function () {
            return { Items: [] };
        });
    }

    function fetchUserViews(uid) {
        return apiFetch('/UserViews?userId=' + uid).then(function (res) {
            if (res && Array.isArray(res.Items) && res.Items.length > 0) {
                return res;
            }
            return apiFetch('/Users/' + uid + '/Views').then(function (res2) {
                if (res2 && Array.isArray(res2.Items) && res2.Items.length > 0) {
                    return res2;
                }
                return apiFetch('/UserViews').catch(function () {
                    return res2 || res || { Items: [] };
                });
            }).catch(function () {
                return apiFetch('/UserViews');
            });
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/Views');
        }).catch(function () {
            return apiFetch('/UserViews');
        }).catch(function () {
            return { Items: [] };
        });
    }

    function ensureCinemaHubMounted() {
        var existingHub = document.getElementById('streamflix-cinema-hub');
        if (!state.cinemaHubEnabled || !isOnHomeRoute() || isGateOpen()) {
            if (existingHub) {
                existingHub.style.display = 'none';
            }
            document.body.classList.remove('streamflix-hub-filtered', 'streamflix-hub-active');
            return;
        }
        if (existingHub) {
            // flow-root (not block) so the hero's negative top margin can't collapse through the hub
            existingHub.style.display = 'flow-root';
            if (existingHub.classList.contains('streamflix-hub-ready')) {
                document.body.classList.add('streamflix-hub-active');
            }
        }

        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }

        var homeSections = document.querySelector('#indexPage:not(.hide) .homeSectionsContainer')
            || document.querySelector('.tabContent.is-active .homeSectionsContainer')
            || document.querySelector('.homeSectionsContainer')
            || document.querySelector('#indexPage:not(.hide) .sections')
            || document.querySelector('.homeTab .sections');

        var homePageContainer = document.querySelector('#indexPage:not(.hide)')
            || document.querySelector('.page.homePage:not(.hide)');

        var fallbackContainer = document.querySelector('#fallbackPage:not(.hide)')
            || document.querySelector('.mainAnimatedPages');

        if (fallbackContainer && fallbackContainer.id === 'fallbackPage') {
            fallbackContainer.classList.add('streamflix-recovered');
        }

        // If existingHub was previously mounted inside #fallbackPage or .mainAnimatedPages and #indexPage is now ready, move it into #indexPage
        if (existingHub && homeSections && homeSections.parentNode && existingHub.parentNode !== homeSections.parentNode) {
            homeSections.parentNode.insertBefore(existingHub, homeSections);
        }

        if (!existingHub) {
            if (homeSections && homeSections.parentNode) {
                existingHub = document.createElement('div');
                existingHub.id = 'streamflix-cinema-hub';
                homeSections.parentNode.insertBefore(existingHub, homeSections);
            } else if (homePageContainer) {
                existingHub = document.createElement('div');
                existingHub.id = 'streamflix-cinema-hub';
                homePageContainer.insertBefore(existingHub, homePageContainer.firstChild);
            } else if (fallbackContainer) {
                existingHub = document.createElement('div');
                existingHub.id = 'streamflix-cinema-hub';
                fallbackContainer.insertBefore(existingHub, fallbackContainer.firstChild);
            } else {
                return;
            }

            if (state.hubData.loaded && state.hubData.userId === auth.userId) {
                renderCinemaHubContents();
            } else {
                existingHub.innerHTML = buildHubSkeletonHtml();
            }
        }

        if (state.hubData.userId !== auth.userId || (!state.hubData.loaded && !state.hubData.loading)) {
            loadCinemaHubData(false);
        }
    }

    function loadCinemaHubData(silentRefresh) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }

        state.hubData.loading = true;
        state.hubData.userId = auth.userId;

        var uid = encodeURIComponent(auth.userId);
        // Only pass valid C# ItemFields enum names
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated';

        var pHero = fetchUserItems(uid, 'IncludeItemTypes=Movie,Series&Recursive=true&Limit=8&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
        var pResume = fetchResumeItems(uid, fields);
        var pNextUp = apiFetch('/Shows/NextUp?userId=' + uid + '&Limit=12&Fields=' + fields).catch(function () { return { Items: [] }; });
        var pTop10 = fetchUserItems(uid, 'IncludeItemTypes=Movie,Series&Recursive=true&Limit=10&SortBy=CommunityRating,DateCreated&SortOrder=Descending&Fields=' + fields);
        var pFavs = fetchUserItems(uid, 'IncludeItemTypes=Movie,Series,Episode,BoxSet&Recursive=true&Filters=IsFavorite&Limit=48&Fields=' + fields);
        var pMovies = fetchUserItems(uid, 'IncludeItemTypes=Movie&Recursive=true&Limit=100&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
        var pSeries = fetchUserItems(uid, 'IncludeItemTypes=Series&Recursive=true&Limit=100&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields + ',ChildCount');
        var pCollections = fetchUserItems(uid, 'IncludeItemTypes=BoxSet&Recursive=true&Limit=100&SortBy=SortName&SortOrder=Ascending&Fields=' + fields);
        var pViews = fetchUserViews(uid);

        Promise.all([pHero, pResume, pNextUp, pTop10, pFavs, pMovies, pSeries, pCollections, pViews]).then(function (results) {
            state.hubData.heroItems = (results[0] && results[0].Items) || [];
            state.hubData.resumeItems = (results[1] && results[1].Items) || [];
            state.hubData.nextUpItems = (results[2] && results[2].Items) || [];
            state.hubData.top10Items = (results[3] && results[3].Items) || [];
            state.hubData.favoriteItems = (results[4] && results[4].Items) || [];
            state.hubData.allMovies = (results[5] && results[5].Items) || [];
            state.hubData.allSeries = (results[6] && results[6].Items) || [];
            state.hubData.recentMovies = state.hubData.allMovies.slice(0, 18);
            state.hubData.recentSeries = state.hubData.allSeries.slice(0, 18);
            state.hubData.collectionsItems = (results[7] && results[7].Items) || [];
            state.hubData.views = (results[8] && results[8].Items) || [];

            var extraPromises = [];

            // Also query any Collections/BoxSets library view by ParentId if present
            var boxsetViews = state.hubData.views.filter(function (v) {
                var ct = (v && v.CollectionType || '').toLowerCase();
                var nm = (v && v.Name || '').toLowerCase();
                return ct === 'boxsets' || nm.indexOf('collection') !== -1;
            });
            boxsetViews.forEach(function (bv) {
                extraPromises.push(
                    fetchUserItems(uid, 'ParentId=' + encodeURIComponent(bv.Id) + '&Recursive=true&Limit=100&SortBy=SortName&SortOrder=Ascending&Fields=' + fields)
                        .then(function (bRes) {
                            var seenCol = {};
                            state.hubData.collectionsItems.forEach(function (c) {
                                if (c && c.Id) { seenCol[normalizeGuid(c.Id)] = true; }
                            });
                            ((bRes && bRes.Items) || []).forEach(function (it) {
                                if (it && it.Id && !seenCol[normalizeGuid(it.Id)] && it.Type !== 'Episode' && it.Type !== 'Season') {
                                    seenCol[normalizeGuid(it.Id)] = true;
                                    state.hubData.collectionsItems.push(it);
                                }
                            });
                        })
                        .catch(function () {})
                );
            });

            // Fallback: if top-level Recursive queries returned no movies/series but the user has library views, query each view by ParentId
            if (state.hubData.allMovies.length === 0 && state.hubData.allSeries.length === 0 && state.hubData.views.length > 0) {
                var viewPromises = state.hubData.views.map(function (v) {
                    return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(v.Id) + '&Recursive=true&IncludeItemTypes=Movie,Series,BoxSet,Video&Limit=60&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
                });
                extraPromises.push(
                    Promise.all(viewPromises).then(function (viewResList) {
                        var seenIds = {};
                        viewResList.forEach(function (vr) {
                            ((vr && vr.Items) || []).forEach(function (it) {
                                if (!it || !it.Id || seenIds[it.Id]) {
                                    return;
                                }
                                seenIds[it.Id] = true;
                                if (it.Type === 'Series') {
                                    state.hubData.allSeries.push(it);
                                } else if (it.Type === 'BoxSet') {
                                    state.hubData.collectionsItems.push(it);
                                } else {
                                    state.hubData.allMovies.push(it);
                                }
                            });
                        });
                        state.hubData.recentMovies = state.hubData.allMovies.slice(0, 18);
                        state.hubData.recentSeries = state.hubData.allSeries.slice(0, 18);
                        var combined = state.hubData.recentMovies.concat(state.hubData.recentSeries);
                        if (state.hubData.heroItems.length === 0 && combined.length > 0) {
                            state.hubData.heroItems = combined.slice(0, 8);
                        }
                        if (state.hubData.top10Items.length === 0 && combined.length > 0) {
                            state.hubData.top10Items = combined.slice(0, 10);
                        }
                    })
                );
            }

            return Promise.all(extraPromises);
        }).then(function () {
            state.hubData.loading = false;
            state.hubData.loaded = true;
            try {
                var wallCache = getShowcaseItemsForWall().slice(0, 36);
                if (wallCache.length > 0) {
                    saveJson(SHOWCASE_ITEMS_KEY, wallCache);
                }
            } catch (eWall) {}
            if (!silentRefresh) {
                state.heroIndex = 0;
            }
            renderCinemaHubContents();
            enhanceLibraryListPages();
            loadPersonalRows(false);
        }).catch(function () {
            state.hubData.loading = false;
        });
    }

    function runLiveSearch(query) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }
        var clean = (query || '').trim();
        if (!clean) {
            state.searchResults = null;
            renderCinemaHubContents();
            return;
        }
        var uid = encodeURIComponent(auth.userId);
        var fields = 'Overview,Genres,PrimaryImageAspectRatio';
        fetchUserItems(uid, 'SearchTerm=' + encodeURIComponent(clean) + '&IncludeItemTypes=Movie,Series,Episode,BoxSet&Recursive=true&Limit=48&Fields=' + fields)
            .then(function (res) {
                state.searchResults = (res && res.Items) || [];
                renderCinemaHubContents();
            })
            .catch(function () {});
    }

    function buildCardQuickButtons(item, withPlayed) {
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        return ''
            + '<div class="streamflix-card-quick-btns">'
            + '  <button type="button" class="streamflix-qbtn play" data-action="play" title="Play" aria-label="Play">' + icon('play') + '</button>'
            + '  <button type="button" class="streamflix-qbtn' + (isFav ? ' active' : '') + '" data-action="fav" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
            + (withPlayed ? '  <button type="button" class="streamflix-qbtn' + (isPlayed ? ' active' : '') + '" data-action="played" title="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>' : '')
            + '  <button type="button" class="streamflix-qbtn streamflix-qbtn-end" data-action="info" title="Details" aria-label="Details">' + icon('chevronDown') + '</button>'
            + '</div>';
    }

    function buildCardMetaText(item) {
        var parts = [];
        if (item.ProductionYear) {
            parts.push(String(item.ProductionYear));
        }
        if (item.OfficialRating) {
            parts.push(String(item.OfficialRating));
        }
        var rt = formatRuntimeTicks(item.RunTimeTicks);
        if (rt && item.Type !== 'Series') {
            parts.push(rt.trim());
        } else if (item.Type === 'Series') {
            parts.push('Series');
        } else if (item.Type === 'BoxSet') {
            parts.push('Collection');
        }
        return parts.join(' · ');
    }

    function buildPosterCardHtml(item) {
        var posterUrl = getItemPosterUrl(item, 400);
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var isPlayed = item.UserData && item.UserData.Played;
        var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 2).join(' · ') : '';
        var rating = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';

        return ''
            + '<div class="streamflix-poster-card" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml(item.Name) + '">'
            + '  <div class="streamflix-poster-img-wrap">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(item.Name) + '</div>'
            + '    <img class="streamflix-poster-img" loading="lazy" src="' + escapeHtml(posterUrl) + '" alt="" onload="this.classList.add(\'is-loaded\')" onerror="this.classList.add(\'is-broken\')" />'
            + (isRecentlyAdded(item) ? '<span class="streamflix-card-flag">New</span>' : '')
            + (isPlayed ? '<span class="streamflix-card-watched" title="Watched">' + icon('check') + '</span>' : '')
            + '    <div class="streamflix-card-hover-overlay">'
            + '      <div class="streamflix-card-info">'
            + '        <div class="streamflix-card-title">' + escapeHtml(item.Name) + '</div>'
            + '        <div class="streamflix-card-meta">'
            + (rating ? '<span class="streamflix-card-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '')
            + '<span>' + escapeHtml(buildCardMetaText(item)) + '</span></div>'
            + (genres ? '<div class="streamflix-card-genres">' + escapeHtml(genres) + '</div>' : '')
            + '      </div>'
            + buildCardQuickButtons(item, true)
            + '    </div>'
            + '  </div>'
            + '  <div class="streamflix-poster-footer">'
            + '    <div class="streamflix-poster-name">' + escapeHtml(item.Name) + '</div>'
            + '    <div class="streamflix-poster-sub"><span>' + escapeHtml(year) + '</span>' + (rating ? '<span class="streamflix-card-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '') + '</div>'
            + '  </div>'
            + '</div>';
    }

    function buildWideCardHtml(item, opts) {
        var backdropUrl = getItemBackdropUrl(item, 640);
        var pct = (item.UserData && item.UserData.PlayedPercentage) ? Math.min(100, Math.max(2, Math.round(item.UserData.PlayedPercentage))) : 0;
        var hasResumePos = Boolean((opts && typeof opts === 'object' && opts.removable) || pct > 0 || (item.UserData && item.UserData.PlaybackPositionTicks > 0));
        var title = item.SeriesName ? item.SeriesName : item.Name;
        var timeLeft = formatTimeLeft(item);
        var sub = item.SeriesName
            ? ('S' + (item.ParentIndexNumber || 1) + ' E' + (item.IndexNumber || 1) + ' · ' + item.Name)
            : (timeLeft || buildCardMetaText(item));

        return ''
            + '<div class="streamflix-wide-card" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml(title) + '">'
            + '  <div class="streamflix-wide-img-wrap">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(title) + '</div>'
            + '    <img class="streamflix-wide-img" loading="lazy" src="' + escapeHtml(backdropUrl) + '" alt="" onload="this.classList.add(\'is-loaded\')" onerror="this.classList.add(\'is-broken\')" />'
            + '    <div class="streamflix-wide-scrim"></div>'
            + '    <button type="button" class="streamflix-wide-play" data-action="play" title="' + (pct > 0 ? 'Resume' : 'Play') + '" aria-label="Play">' + icon('play') + '</button>'
            + '    <div class="streamflix-wide-actions">'
            + (hasResumePos ? '      <button type="button" class="streamflix-qbtn streamflix-qbtn-remove-resume" data-action="remove-resume" title="Remove from Continue Watching" aria-label="Remove from Continue Watching">' + icon('close') + '</button>' : '')
            + '      <button type="button" class="streamflix-qbtn" data-action="info" title="Details" aria-label="Details">' + icon('info') + '</button>'
            + '    </div>'
            + '    <div class="streamflix-wide-caption">'
            + '      <div class="streamflix-wide-title">' + escapeHtml(title) + '</div>'
            + '      <div class="streamflix-wide-sub">' + escapeHtml(sub) + '</div>'
            + '    </div>'
            + (pct > 0
                ? '<div class="streamflix-progress-track"><div class="streamflix-progress-fill" style="width:' + pct + '%;"></div></div>'
                : '')
            + '  </div>'
            + '</div>';
    }

    function buildTop10CardHtml(item, rank) {
        var posterUrl = getItemPosterUrl(item, 400);
        return ''
            + '<div class="streamflix-top10-card" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml('#' + rank + ' ' + item.Name) + '">'
            + '  <span class="streamflix-top10-num" aria-hidden="true">' + rank + '</span>'
            + '  <div class="streamflix-top10-poster">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(item.Name) + '</div>'
            + '    <img loading="lazy" src="' + escapeHtml(posterUrl) + '" alt="" onload="this.classList.add(\'is-loaded\')" onerror="this.classList.add(\'is-broken\')" />'
            + '    <div class="streamflix-card-hover-overlay">'
            + '      <div class="streamflix-card-info"><div class="streamflix-card-title">' + escapeHtml(item.Name) + '</div></div>'
            + buildCardQuickButtons(item, false)
            + '    </div>'
            + '  </div>'
            + '</div>';
    }

    function buildRowHtml(rowId, title, cardsHtml, opts) {
        if (!cardsHtml) {
            return '';
        }
        opts = opts || {};
        return ''
            + '<section class="streamflix-row' + (opts.className ? ' ' + opts.className : '') + '" data-row-id="' + escapeHtml(rowId) + '">'
            + '  <div class="streamflix-row-header">'
            + '    <h2 class="streamflix-row-title">' + title + '</h2>'
            + (opts.link ? '<button type="button" class="streamflix-row-link" data-cat-link="' + escapeHtml(opts.link) + '">Explore all' + icon('chevronRight') + '</button>' : '')
            + '  </div>'
            + '  <div class="streamflix-carousel-wrap at-start">'
            + '    <button type="button" class="streamflix-paddle left" data-scroll-dir="-1" aria-label="Scroll left">' + icon('chevronLeft') + '</button>'
            + '    <div class="streamflix-carousel-track">' + cardsHtml + '</div>'
            + '    <button type="button" class="streamflix-paddle right" data-scroll-dir="1" aria-label="Scroll right">' + icon('chevronRight') + '</button>'
            + '  </div>'
            + '</section>';
    }

    function buildGridSectionHtml(sectionId, title, itemsList) {
        if (!Array.isArray(itemsList) || itemsList.length === 0) {
            return '';
        }
        var cardsHtml = itemsList.map(buildPosterCardHtml).join('');
        return ''
            + '<section class="streamflix-row streamflix-row-grid" data-row-id="' + escapeHtml(sectionId) + '">'
            + '  <div class="streamflix-row-header">'
            + '    <h2 class="streamflix-row-title">' + title + '</h2>'
            + '  </div>'
            + '  <div class="streamflix-grid">' + cardsHtml + '</div>'
            + '</section>';
    }

    function buildEmptyStateHtml(iconName, title, text) {
        return ''
            + '<div class="streamflix-empty-state">'
            + '  <div class="streamflix-empty-icon">' + icon(iconName) + '</div>'
            + '  <div class="streamflix-empty-title">' + escapeHtml(title) + '</div>'
            + (text ? '<div class="streamflix-empty-text">' + escapeHtml(text) + '</div>' : '')
            + '</div>';
    }

    function rowTitle(text, count) {
        return escapeHtml(text) + (count ? '<span class="streamflix-row-count">' + count + '</span>' : '');
    }

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
            state.searchResults || [], personalRowItems(), extraItemsList || []
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
    }

    function getActiveHeroItems() {
        var d = state.hubData;
        var cat = state.activeCategory || 'all';
        if (cat === 'movies') {
            return (d.recentMovies && d.recentMovies.length) ? d.recentMovies.slice(0, 8) : (d.heroItems || []);
        }
        if (cat === 'series') {
            return (d.recentSeries && d.recentSeries.length) ? d.recentSeries.slice(0, 8) : (d.heroItems || []);
        }
        if (cat === 'collections' || cat === 'mylist' || cat === 'top10') {
            return [];
        }
        if (d.heroItems && d.heroItems.length) {
            return d.heroItems;
        }
        return (d.recentMovies || []).concat(d.recentSeries || []).slice(0, 8);
    }

    function renderCinemaHubContents() {
        var hub = document.getElementById('streamflix-cinema-hub');
        if (!hub) {
            return;
        }

        var d = state.hubData;
        var profileName = (state.activeProfile && state.activeProfile.name) || 'You';
        var cat = state.activeCategory || 'all';

        document.body.classList.toggle('streamflix-hub-filtered', Boolean(state.searchQuery) || cat !== 'all');

        var pills = [
            { id: 'all', label: 'Home' },
            { id: 'series', label: 'Shows', hide: !d.allSeries.length },
            { id: 'movies', label: 'Movies', hide: !d.allMovies.length },
            { id: 'collections', label: 'Collections', hide: !d.collectionsItems.length && !buildSmartCollections(d).length },
            { id: 'top10', label: 'Top 10', hide: !d.top10Items.length },
            { id: 'mylist', label: 'My List' }
        ];

        var pillsHtml = pills.filter(function (p) { return !p.hide || cat === p.id; }).map(function (p) {
            var isActive = !state.searchQuery && cat === p.id;
            return '<button type="button" class="streamflix-pill' + (isActive ? ' active' : '') + '" data-cat-id="' + p.id + '"' + (isActive ? ' aria-current="page"' : '') + '>' + escapeHtml(p.label) + '</button>';
        }).join('');

        var subnavHtml = ''
            + '<div class="streamflix-subnav">'
            + '  <nav class="streamflix-FilterPills" aria-label="Browse">' + pillsHtml + '</nav>'
            + '  <div class="streamflix-search-box' + (state.searchQuery ? ' has-value' : '') + '">'
            + '    <span class="streamflix-search-icon">' + icon('search') + '</span>'
            + '    <input type="search" id="streamflix-live-search-input" class="streamflix-search-input" placeholder="Titles, genres…" autocomplete="off" spellcheck="false" aria-label="Search" value="' + escapeHtml(state.searchQuery) + '" />'
            + (state.searchQuery
                ? '<button type="button" id="streamflix-search-clear-btn" class="streamflix-search-clear" title="Clear search" aria-label="Clear search">' + icon('close') + '</button>'
                : '')
            + '  </div>'
            + '</div>';

        var activeHeroItems = getActiveHeroItems();
        var showHero = !state.searchQuery && activeHeroItems.length > 0;
        var heroHtml = '<div id="streamflix-hero-billboard" style="' + (showHero ? '' : 'display:none !important;') + '"></div>';
        var top10Cards = function () {
            return d.top10Items.map(function (it, idx) { return buildTop10CardHtml(it, idx + 1); }).join('');
        };

        var rowsHtml = '';
        if (state.searchQuery && Array.isArray(state.searchResults)) {
            if (state.searchResults.length > 0) {
                rowsHtml += buildGridSectionHtml('search', 'Results for “' + escapeHtml(state.searchQuery) + '”<span class="streamflix-row-count">' + state.searchResults.length + '</span>', state.searchResults);
            } else {
                rowsHtml += buildEmptyStateHtml('search', 'No matches for “' + state.searchQuery + '”', 'Try a different title, or browse by category.');
            }
        } else if (cat === 'movies') {
            if (d.recentMovies.length > 0) {
                rowsHtml += buildRowHtml('movies-recent', rowTitle('New on StreamFlix'), d.recentMovies.map(buildPosterCardHtml).join(''));
            }
            rowsHtml += smartRowsHtml(['smart-acclaimed-movies', 'smart-short', 'smart-decade', 'smart-family']);
            rowsHtml += buildGenreCollectionRowsHtml(d.allMovies);
            if (d.allMovies.length > 0) {
                rowsHtml += buildGridSectionHtml('movies-all', rowTitle('All Movies', d.allMovies.length), d.allMovies);
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
                rowsHtml += buildGridSectionHtml('series-all', rowTitle('All Shows', d.allSeries.length), d.allSeries);
            }
        } else if (cat === 'collections') {
            rowsHtml += smartRowsHtml(['smart-acclaimed', 'smart-gems', 'smart-binge', 'smart-short', 'smart-decade', 'smart-family']);
            if (d.collectionsItems.length > 0) {
                rowsHtml += buildGridSectionHtml('collections-boxsets', rowTitle('Collections', d.collectionsItems.length), d.collectionsItems);
            }
            rowsHtml += buildGenreCollectionRowsHtml(d.allMovies.concat(d.allSeries));
        } else if (cat === 'mylist') {
            if (d.favoriteItems.length > 0) {
                rowsHtml += buildGridSectionHtml('mylist-grid', rowTitle('My List', d.favoriteItems.length), d.favoriteItems);
            }
        } else if (cat === 'top10') {
            if (d.top10Items.length > 0) {
                rowsHtml += buildRowHtml('top10', rowTitle('Top 10 Today'), top10Cards(), { className: 'streamflix-row-top10' });
                rowsHtml += buildGridSectionHtml('top10-grid', rowTitle('Highest Rated'), d.top10Items);
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
                rowsHtml += buildRowHtml('top10', rowTitle('Top 10 Today'), top10Cards(), { className: 'streamflix-row-top10', link: 'top10' });
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

        if (!hub.classList.contains('streamflix-hub-ready')) {
            hub.classList.add('streamflix-hub-ready');
        }

        if (showHero) {
            renderHeroSlide();
            if (!keepHero || !state.heroTimer) {
                restartHeroTimer();
            }
        }

        // "Explore all" row links jump to the matching category
        Array.prototype.forEach.call(hub.querySelectorAll('[data-cat-link]'), function (btn) {
            btn.addEventListener('click', function () {
                state.activeCategory = btn.getAttribute('data-cat-link') || 'all';
                state.heroIndex = 0;
                renderCinemaHubContents();
                try { hub.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) {}
            });
        });

        // Bind Category Filter Pills
        Array.prototype.forEach.call(hub.querySelectorAll('[data-cat-id]'), function (btn) {
            btn.addEventListener('click', function () {
                state.activeCategory = btn.getAttribute('data-cat-id') || 'all';
                state.heroIndex = 0;
                state.searchQuery = '';
                state.searchResults = null;
                renderCinemaHubContents();
            });
        });

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
            });
            searchInput.addEventListener('blur', function () {
                if (subnavEl && !searchInput.value) {
                    subnavEl.classList.remove('is-search-open');
                }
            });
        }
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                state.searchQuery = searchInput.value;
                if (state.searchDebounce) {
                    clearTimeout(state.searchDebounce);
                }
                state.searchDebounce = setTimeout(function () {
                    runLiveSearch(state.searchQuery);
                }, 240);
            });
            searchInput.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape' && state.searchQuery) {
                    ev.preventDefault();
                    state.searchQuery = '';
                    state.searchResults = null;
                    renderCinemaHubContents();
                }
            });
            if (state.searchQuery) {
                searchInput.focus();
                try {
                    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
                } catch (e) {}
            }
        }

        var clearSearchBtn = document.getElementById('streamflix-search-clear-btn');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', function () {
                state.searchQuery = '';
                state.searchResults = null;
                renderCinemaHubContents();
            });
        }

        bindInteractiveCardsInContainer(hub, null, null);
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

        // Persistent layers: background stack (crossfades), content slot and dots
        var bgStack = hero.querySelector('.streamflix-hero-bg-stack');
        if (!bgStack) {
            hero.innerHTML = '<div class="streamflix-hero-bg-stack" aria-hidden="true"></div><div class="streamflix-hero-content-slot"></div><div class="streamflix-hero-dots"></div>';
            bgStack = hero.querySelector('.streamflix-hero-bg-stack');
            hero.addEventListener('mouseenter', function () { state.heroPaused = true; });
            hero.addEventListener('mouseleave', function () { state.heroPaused = false; });
            hero.addEventListener('focusin', function () { state.heroPaused = true; });
            hero.addEventListener('focusout', function () { state.heroPaused = false; });
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
                    state.heroIndex = (state.heroIndex + (dx < 0 ? 1 : slides.length - 1)) % slides.length;
                    renderHeroSlide();
                    restartHeroTimer();
                }
            }, { passive: true });
        }
        var slot = hero.querySelector('.streamflix-hero-content-slot');
        var dotsEl = hero.querySelector('.streamflix-hero-dots');

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
            layer.style.backgroundImage = 'url("' + backdropUrl + '")';
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
        var slotSig = item.Id + ':' + (isFav ? 1 : 0) + ':' + (item.UserData ? item.UserData.PlaybackPositionTicks || 0 : 0);
        var slotFresh = slot.getAttribute('data-sig') !== slotSig || !slot.firstChild;
        slot.setAttribute('data-sig', slotSig);

        var titleHtml = logoUrl
            ? '<h1 class="streamflix-hero-title streamflix-hero-title-has-logo">'
                + '<img class="streamflix-hero-logo" src="' + escapeHtml(logoUrl) + '" alt="" onerror="var h=this.parentNode;h.classList.remove(\'streamflix-hero-title-has-logo\');h.removeChild(this);" />'
                + '<span class="streamflix-hero-title-text">' + escapeHtml(item.Name) + '</span></h1>'
            : '<h1 class="streamflix-hero-title">' + escapeHtml(item.Name) + '</h1>';

        if (slotFresh) {
        slot.innerHTML = ''
            + '<div class="streamflix-hero-content' + (itemChanged ? ' streamflix-hero-swap' : '') + '">'
            + '  <div class="streamflix-hero-brand-row">'
            + '    <span class="streamflix-n-badge">S</span>'
            + '    <span class="streamflix-hero-series-tag">' + escapeHtml(kicker) + '</span>'
            + (isRecentlyAdded(item) ? '<span class="streamflix-hero-new">Recently added</span>' : '')
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
            + '  </div>'
            + '</div>';
        }

        dotsEl.innerHTML = heroItems.length > 1
            ? heroItems.map(function (_, idx) {
                return '<button type="button" class="streamflix-hero-dot' + (idx === slideIdx ? ' active' : '') + (idx < slideIdx ? ' done' : '') + '" data-slide-idx="' + idx + '" aria-label="Show title ' + (idx + 1) + '"><span class="streamflix-hero-dot-fill"></span></button>';
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
        }

        Array.prototype.forEach.call(dotsEl.querySelectorAll('.streamflix-hero-dot'), function (dot) {
            dot.addEventListener('click', function () {
                state.heroIndex = parseInt(dot.getAttribute('data-slide-idx'), 10) || 0;
                renderHeroSlide();
                restartHeroTimer();
            });
        });
        paintHeroProgress();
    }

    var HERO_INTERVAL_MS = 9000;
    var HERO_TICK_MS = 200;

    function paintHeroProgress() {
        var fill = document.querySelector('#streamflix-hero-billboard .streamflix-hero-dot.active .streamflix-hero-dot-fill');
        if (fill) {
            var frac = (state.heroElapsed || 0) / HERO_INTERVAL_MS;
            fill.style.transform = 'scaleX(' + Math.min(1, Math.max(0, frac)).toFixed(3) + ')';
        }
    }

    // Story-style hero timer: pauses on hover/focus, hidden tabs, open modals and search; indicators fill in sync.
    function restartHeroTimer() {
        if (state.heroTimer) {
            clearInterval(state.heroTimer);
            state.heroTimer = null;
        }
        state.heroElapsed = 0;
        paintHeroProgress();
        if (prefersReducedMotion()) {
            return;
        }
        state.heroTimer = setInterval(function () {
            var heroEl = document.getElementById('streamflix-hero-billboard');
            var curHero = getActiveHeroItems();
            if (!heroEl) {
                clearInterval(state.heroTimer);
                state.heroTimer = null;
                return;
            }
            var paused = heroHardPaused() || state.heroPaused || curHero.length <= 1;
            heroEl.classList.toggle('is-paused', Boolean(paused));
            if (paused) {
                return;
            }
            state.heroElapsed = (state.heroElapsed || 0) + HERO_TICK_MS;
            if (state.heroElapsed >= HERO_INTERVAL_MS) {
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
    }

    function heroHardPaused() {
        var hub = document.getElementById('streamflix-cinema-hub');
        return Boolean(document.hidden || state.searchQuery || isGateOpen() || isVideoPlayerActive()
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
                state.ambientCache[url] = css;
                cb(css);
            } catch (e) {
                // cross-origin artwork taints the canvas — keep the neutral background
            }
        };
        img.src = url;
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

    /* ----------------------------------------------------------------------
       v7.2 — Rows picked for the active profile
       ---------------------------------------------------------------------- */
    var PERSONAL_ROWS_TTL_MS = 10 * 60 * 1000;

    function getPersonalRows() {
        var auth = getJellyfinAuthContext();
        var entry = auth.userId ? state.personalRowsByUser[auth.userId] : null;
        return (entry && entry.data) || null;
    }

    function personalRowItems() {
        var pr = getPersonalRows();
        if (!pr) {
            return [];
        }
        var out = [].concat(pr.topPicks || [], pr.watchAgain || []);
        (pr.because || []).forEach(function (b) { out = out.concat(b.items || []); });
        return out;
    }

    function loadPersonalRows(force) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }
        var key = auth.userId;
        var existing = state.personalRowsByUser[key];
        if (existing && (existing.loading || (!force && Date.now() - existing.fetchedAt < PERSONAL_ROWS_TTL_MS))) {
            return;
        }
        var entry = { loading: true, fetchedAt: Date.now(), data: existing ? existing.data : null };
        state.personalRowsByUser[key] = entry;

        var uid = encodeURIComponent(key);
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated';
        var pPlayed = fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=30&Fields=' + fields);
        var pAgain = fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=18&Fields=' + fields);

        Promise.all([pPlayed, pAgain]).then(function (res) {
            var played = (res[0] && res[0].Items) || [];
            var again = (res[1] && res[1].Items) || [];
            var seen = {};
            var seeds = [];
            played.forEach(function (it) {
                var id = it.Type === 'Episode' ? it.SeriesId : it.Id;
                var name = it.Type === 'Episode' ? it.SeriesName : it.Name;
                if (id && name && !seen[id]) {
                    seen[id] = true;
                    seeds.push({ id: id, name: name });
                }
            });
            again.forEach(function (it) { seen[it.Id] = true; });
            seeds = seeds.slice(0, 2);

            var tally = {};
            var add = function (list, weight) {
                (list || []).forEach(function (it) {
                    (it.Genres || []).forEach(function (g) {
                        tally[g] = (tally[g] || 0) + weight;
                    });
                });
            };
            add(played, 1);
            add(again, 2);
            add(state.hubData.favoriteItems, 2);
            var topGenre = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0] || '';

            var pBecause = seeds.map(function (seed) {
                return apiFetch('/Items/' + encodeURIComponent(seed.id) + '/Similar?userId=' + uid + '&Limit=20&Fields=' + fields)
                    .then(function (r) {
                        var items = ((r && r.Items) || []).filter(function (x) {
                            return x && x.Id && !seen[x.Id] && !(x.UserData && x.UserData.Played);
                        });
                        return { seed: seed, items: items };
                    })
                    .catch(function () { return { seed: seed, items: [] }; });
            });
            var pTop = topGenre
                ? fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&Genres=' + encodeURIComponent(topGenre) + '&Filters=IsUnplayed&SortBy=CommunityRating&SortOrder=Descending&Limit=24&Fields=' + fields)
                : Promise.resolve({ Items: [] });

            return Promise.all([Promise.all(pBecause), pTop]).then(function (r2) {
                var used = {};
                var because = r2[0].map(function (b) {
                    var items = b.items.filter(function (x) { return !used[x.Id]; }).slice(0, 18);
                    items.forEach(function (x) { used[x.Id] = true; });
                    return { seed: b.seed, items: items };
                }).filter(function (b) { return b.items.length >= 4; });
                var top = ((r2[1] && r2[1].Items) || []).filter(function (x) { return x && x.Id; });
                entry.data = {
                    topGenre: topGenre,
                    topPicks: top.length >= 4 ? top.slice(0, 18) : [],
                    because: because,
                    watchAgain: again.length >= 3 ? again : []
                };
            });
        }).catch(function () {}).then(function () {
            entry.loading = false;
            entry.fetchedAt = Date.now();
            var pr = entry.data;
            var hasAny = pr && (pr.topPicks.length || pr.because.length || pr.watchAgain.length);
            if (hasAny && state.activeCategory === 'all' && !state.searchQuery && document.getElementById('streamflix-cinema-hub')) {
                renderCinemaHubContents();
            }
        });
    }

    /* ----------------------------------------------------------------------
       v7.2 — Hover previews (desktop pointers only)
       ---------------------------------------------------------------------- */
    var hoverPreview = { el: null, card: null, item: null, pending: null, showTimer: null, hideTimer: null, mx: -1, my: -1, lastClosedAt: 0, dismissedCard: null };
    var PREVIEW_CARD_SEL = '.streamflix-poster-card, .streamflix-top10-card, .streamflix-wide-card';

    // Closes only the currently open preview popup without cancelling a pending showTimer for the next movie card
    function closeOpenPreviewVisuals() {
        clearTimeout(hoverPreview.hideTimer);
        hoverPreview.hideTimer = null;
        var el = hoverPreview.el;
        var wasOpen = Boolean(el && el.classList.contains('is-open'));
        hoverPreview.card = null;
        hoverPreview.item = null;
        if (wasOpen) {
            hoverPreview.lastClosedAt = Date.now();
            el.classList.remove('is-open');
            el.setAttribute('aria-hidden', 'true');
        }
    }

    function hidePreviewNow() {
        clearTimeout(hoverPreview.showTimer);
        hoverPreview.showTimer = null;
        hoverPreview.pending = null;
        closeOpenPreviewVisuals();
    }

    function scheduleHidePreview() {
        clearTimeout(hoverPreview.showTimer);
        hoverPreview.showTimer = null;
        hoverPreview.pending = null;
        clearTimeout(hoverPreview.hideTimer);
        hoverPreview.hideTimer = setTimeout(closeOpenPreviewVisuals, 120);
    }

    function isPointerOverCardAt(card, x, y) {
        if (!card || !card.isConnected) {
            return false;
        }
        if (document.elementsFromPoint) {
            var stack = document.elementsFromPoint(x, y);
            for (var i = 0; i < stack.length; i++) {
                if (card === stack[i] || card.contains(stack[i])) {
                    return true;
                }
            }
            return false;
        }
        var r = card.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function findUnderlyingOtherCard(x, y) {
        if (!document.elementsFromPoint || x < 0 || y < 0) {
            return null;
        }
        var curCard = hoverPreview.card;
        if (curCard && curCard.isConnected) {
            var cr = curCard.getBoundingClientRect();
            if (x >= cr.left - 4 && x <= cr.right + 4 && y >= cr.top - 4 && y <= cr.bottom + 4) {
                return null;
            }
        }
        var stack = document.elementsFromPoint(x, y);
        for (var i = 0; i < stack.length; i++) {
            var node = stack[i];
            if (hoverPreview.el && (node === hoverPreview.el || hoverPreview.el.contains(node))) {
                continue;
            }
            var cand = node && node.closest ? node.closest(PREVIEW_CARD_SEL) : null;
            if (cand && cand !== curCard && (!hoverPreview.item || cand.getAttribute('data-item-id') !== hoverPreview.item.Id)) {
                return cand;
            }
        }
        return null;
    }

    // Rows can re-render while the mouse rests on a card; find the fresh copy of the card under the pointer
    function findLiveHoverCard(card, item) {
        if (hoverPreview.mx < 0 || !document.elementFromPoint) {
            return card && card.isConnected ? card : null;
        }
        if (card && card.isConnected) {
            // The page may have scrolled since the countdown began - only open if the pointer is still over it
            return isPointerOverCardAt(card, hoverPreview.mx, hoverPreview.my) ? card : null;
        }
        if (document.elementsFromPoint) {
            var stack = document.elementsFromPoint(hoverPreview.mx, hoverPreview.my);
            for (var i = 0; i < stack.length; i++) {
                var c = stack[i] && stack[i].closest ? stack[i].closest(PREVIEW_CARD_SEL) : null;
                if (c && item && c.getAttribute('data-item-id') === item.Id) {
                    return c;
                }
            }
        }
        var under = document.elementFromPoint(hoverPreview.mx, hoverPreview.my);
        var live = under && under.closest ? under.closest(PREVIEW_CARD_SEL) : null;
        return live && item && live.getAttribute('data-item-id') === item.Id ? live : null;
    }

    function preloadPreviewImage(item) {
        try {
            var img = new Image();
            img.decoding = 'async';
            img.src = getItemBackdropUrl(item, 780);
        } catch (e) {}
    }

    function buildPreviewHtml(item, placeholder) {
        var title = item.SeriesName || item.Name || '';
        var logo = getItemLogoUrl(item, 420);
        var rating = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var runtime = item.Type === 'Series' ? 'Series' : (item.Type === 'BoxSet' ? 'Collection' : formatRuntimeTicks(item.RunTimeTicks).trim());
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        var pct = item.UserData && item.UserData.PlayedPercentage ? Math.min(100, Math.max(2, Math.round(item.UserData.PlayedPercentage))) : 0;
        var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3) : [];
        var sub = item.Type === 'Episode' ? ('S' + (item.ParentIndexNumber || 1) + ':E' + (item.IndexNumber || 1) + ' · ' + item.Name) : '';
        var left = pct ? formatTimeLeft(item) : '';
        return ''
            + '<div class="bfx-pv-media" data-pv="info">'
            + (placeholder ? '<div class="bfx-pv-ph" style="background-image:url(&quot;' + escapeHtml(placeholder) + '&quot;)"></div>' : '')
            + '  <img class="bfx-pv-img" src="' + escapeHtml(getItemBackdropUrl(item, 780)) + '" alt="" onload="this.classList.add(\'is-loaded\')" onerror="this.style.visibility=\'hidden\'" />'
            + '  <div class="bfx-pv-scrim"></div>'
            + (logo
                ? '<img class="bfx-pv-logo" src="' + escapeHtml(logo) + '" alt="' + escapeHtml(title) + '" onerror="this.outerHTML=\'<div class=&quot;bfx-pv-title&quot;>' + escapeHtml(escapeHtml(title)).replace(/'/g, '&#39;') + '</div>\'" />'
                : '<div class="bfx-pv-title">' + escapeHtml(title) + '</div>')
            + (pct ? '<div class="bfx-pv-bar"><span style="width:' + pct + '%;"></span></div>' : '')
            + '</div>'
            + '<div class="bfx-pv-body" data-pv="info">'
            + '  <div class="bfx-pv-actions">'
            + '    <button type="button" class="bfx-pv-play" data-pv="play" aria-label="' + (pct ? 'Resume' : 'Play') + '">' + icon('play') + '<span>' + (pct ? 'Resume' : 'Play') + '</span></button>'
            + '    <button type="button" class="bfx-pv-btn' + (isFav ? ' active' : '') + '" data-pv="fav" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
            + (item.Type !== 'BoxSet' ? '    <button type="button" class="bfx-pv-btn' + (isPlayed ? ' active' : '') + '" data-pv="played" title="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>' : '')
            + (pct > 0 ? '    <button type="button" class="bfx-pv-btn bfx-pv-remove" data-pv="remove-resume" title="Remove from Continue Watching" aria-label="Remove from Continue Watching">' + icon('close') + '</button>' : '')
            + '    <button type="button" class="bfx-pv-btn bfx-pv-more" data-pv="info" title="More info" aria-label="More info">' + icon('chevronDown') + '</button>'
            + '  </div>'
            + '  <div class="bfx-pv-meta">'
            + (rating ? '<span class="bfx-pv-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '')
            + (year ? '<span>' + escapeHtml(year) + '</span>' : '')
            + (item.OfficialRating ? '<span class="streamflix-maturity-pill">' + escapeHtml(item.OfficialRating) + '</span>' : '')
            + (left ? '<span class="bfx-pv-left">' + escapeHtml(left) + '</span>' : (runtime ? '<span>' + escapeHtml(runtime) + '</span>' : ''))
            + '  </div>'
            + (sub ? '<div class="bfx-pv-sub">' + escapeHtml(sub) + '</div>' : '')
            + (genres.length ? '<div class="bfx-pv-genres">' + genres.map(escapeHtml).join('<i></i>') + '</div>' : '')
            + '</div>';
    }

    function ensurePreviewEl() {
        if (hoverPreview.el && hoverPreview.el.parentNode) {
            return hoverPreview.el;
        }
        var el = document.createElement('div');
        el.id = 'bfx-hover-preview';
        el.setAttribute('aria-hidden', 'true');
        el.addEventListener('mouseenter', function () {
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
        });
        el.addEventListener('mouseleave', function (ev) {
            var to = ev && ev.relatedTarget;
            var nextCard = to && to.closest ? to.closest(PREVIEW_CARD_SEL) : null;
            if (nextCard) {
                if (nextCard === hoverPreview.card
                    || (hoverPreview.item && nextCard.getAttribute('data-item-id') === hoverPreview.item.Id)) {
                    clearTimeout(hoverPreview.hideTimer);
                    hoverPreview.hideTimer = null;
                    return;
                }
                // Sliding directly off the open hover menu onto another movie card:
                // close the current popup immediately so it gets out of the way and queue the new card.
                closeOpenPreviewVisuals();
                queuePreviewForCard(nextCard);
                return;
            }
            scheduleHidePreview();
        });
        el.addEventListener('click', function (ev) {
            var target = ev.target && ev.target.closest ? ev.target.closest('[data-pv]') : null;
            var item = hoverPreview.item;
            if (!target || !item) {
                return;
            }
            var act = target.getAttribute('data-pv');
            if (act === 'play') {
                hidePreviewNow();
                navigateOrPlayItem(item);
            } else if (act === 'fav') {
                toggleFavoriteItem(item, target);
            } else if (act === 'played') {
                togglePlayedItem(item, target);
            } else if (act === 'remove-resume') {
                removeFromContinueWatching(item);
            } else {
                hidePreviewNow();
                openHeroDetailModal(item);
            }
        });
        document.body.appendChild(el);
        hoverPreview.el = el;
        return el;
    }

    function showPreviewFor(card, item) {
        if (!card || !item || !card.isConnected || state.accountDropdownOpen || isGateOpen() || isVideoPlayerActive()
            || document.querySelector('.streamflix-modal-backdrop')) {
            return;
        }
        var rect = card.getBoundingClientRect();
        if (rect.width < 40 || rect.bottom < 0 || rect.top > window.innerHeight) {
            return;
        }
        var el = ensurePreviewEl();
        var isWide = card.classList.contains('streamflix-wide-card');
        var cardImg = card.querySelector('img');
        var placeholder = cardImg && cardImg.classList.contains('is-loaded') ? (cardImg.currentSrc || cardImg.src || '') : '';
        var W = Math.round(Math.min(isWide ? 420 : 372, Math.max(isWide ? 332 : 288, rect.width * (isWide ? 1.28 : 1.5))));
        W = Math.min(W, window.innerWidth - 24);
        clearTimeout(hoverPreview.hideTimer);
        hoverPreview.hideTimer = null;
        hoverPreview.card = card;
        hoverPreview.item = item;
        hoverPreview.dismissedCard = null;
        hoverPreview.anchorTop = rect.top;
        hoverPreview.anchorLeft = rect.left;
        el.style.transition = 'none';
        el.classList.remove('is-open');
        el.style.width = W + 'px';
        el.innerHTML = buildPreviewHtml(item, placeholder);
        var H = el.offsetHeight || Math.round(W * 0.9);
        var cx = rect.left + rect.width / 2;
        var left = Math.max(12, Math.min(window.innerWidth - W - 12, cx - W / 2));
        var top = rect.top + rect.height / 2 - H * 0.42;
        var hdr = document.querySelector('.skinHeader:not(.osdHeader)');
        var minTop = Math.max(12, hdr ? Math.min(96, Math.round(hdr.getBoundingClientRect().bottom) + 8) : 72);
        top = Math.max(minTop, Math.min(window.innerHeight - H - 12, top));
        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
        var originX = Math.max(0, Math.min(W, cx - left));
        var originY = Math.max(0, Math.min(H, rect.top + rect.height / 2 - top));
        el.style.transformOrigin = Math.round(originX) + 'px ' + Math.round(originY) + 'px';
        el.style.setProperty('--bfx-pv-from', (rect.width / W).toFixed(3));
        void el.offsetWidth;
        el.style.transition = '';
        el.classList.add('is-open');
        el.setAttribute('aria-hidden', 'false');
    }

    function queuePreviewForCard(card) {
        if (!card || !card.isConnected) {
            return;
        }
        var open = Boolean(hoverPreview.el && hoverPreview.el.classList.contains('is-open'));
        if (card === hoverPreview.card
            || (open && hoverPreview.item && card.getAttribute('data-item-id') === hoverPreview.item.Id)) {
            // Same title (or the same card re-rendered underneath) - keep the preview, don't re-open it
            hoverPreview.card = card;
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
            return;
        }
        if (card === hoverPreview.pending) {
            // Moving between the card's own children shouldn't restart the countdown
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
            return;
        }
        var item = card.__bfxItem || findCachedItemById(card.getAttribute('data-item-id'));
        if (!item || !item.Id) {
            return;
        }
        var warmHandoff = open || (Date.now() - (hoverPreview.lastClosedAt || 0) < 450);
        if (open) {
            // Close the previous card's popup immediately so it never blocks adjacent cards
            closeOpenPreviewVisuals();
        } else {
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
        }
        clearTimeout(hoverPreview.showTimer);
        hoverPreview.pending = card;
        preloadPreviewImage(item);
        hoverPreview.showTimer = setTimeout(function () {
            hoverPreview.showTimer = null;
            hoverPreview.pending = null;
            var live = findLiveHoverCard(card, item);
            if (live) {
                showPreviewFor(live, item);
            }
        }, warmHandoff ? 140 : 460);
    }

    function installHoverPreview() {
        if (hoverPreview.installed) {
            return;
        }
        hoverPreview.installed = true;
        var mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
        if (!mq || !mq.matches) {
            return;
        }
        document.body.classList.add('bfx-hover-previews');
        document.addEventListener('mouseover', function (ev) {
            var card = ev.target && ev.target.closest ? ev.target.closest(PREVIEW_CARD_SEL) : null;
            if (!card) {
                return;
            }
            if (card === hoverPreview.dismissedCard) {
                return;
            }
            queuePreviewForCard(card);
        }, true);
        document.addEventListener('mousemove', function (ev) {
            var moved = hoverPreview.mx >= 0 && (Math.abs(ev.clientX - hoverPreview.mx) + Math.abs(ev.clientY - hoverPreview.my) >= 2);
            hoverPreview.mx = ev.clientX;
            hoverPreview.my = ev.clientY;
            var isOpen = Boolean(hoverPreview.el && hoverPreview.el.classList.contains('is-open'));
            if (isOpen && hoverPreview.el && ev.target && ev.target.nodeType && hoverPreview.el.contains(ev.target)) {
                // Inside the action/body area of the open preview, keep the current preview rock-solid so every button is easy to click
                if (ev.target.closest && ev.target.closest('.bfx-pv-body')) {
                    if (hoverPreview.showTimer) {
                        clearTimeout(hoverPreview.showTimer);
                        hoverPreview.showTimer = null;
                        hoverPreview.pending = null;
                    }
                    return;
                }
                // In the overhanging top artwork edge, peek through to see if the user moved onto an adjacent movie card underneath
                var peekCard = findUnderlyingOtherCard(ev.clientX, ev.clientY);
                if (peekCard && peekCard !== hoverPreview.dismissedCard) {
                    if (hoverPreview.pending !== peekCard) {
                        var peekItem = peekCard.__bfxItem || findCachedItemById(peekCard.getAttribute('data-item-id'));
                        if (peekItem && peekItem.Id) {
                            clearTimeout(hoverPreview.showTimer);
                            hoverPreview.pending = peekCard;
                            preloadPreviewImage(peekItem);
                            hoverPreview.showTimer = setTimeout(function () {
                                hoverPreview.showTimer = null;
                                hoverPreview.pending = null;
                                var stillUnder = findUnderlyingOtherCard(hoverPreview.mx, hoverPreview.my);
                                if (stillUnder === peekCard) {
                                    showPreviewFor(peekCard, peekItem);
                                }
                            }, 160);
                        }
                    }
                } else if (hoverPreview.showTimer) {
                    clearTimeout(hoverPreview.showTimer);
                    hoverPreview.showTimer = null;
                    hoverPreview.pending = null;
                }
                return;
            }
            if (moved && !hoverPreview.showTimer && !isOpen) {
                var underCard = ev.target && ev.target.closest ? ev.target.closest(PREVIEW_CARD_SEL) : null;
                if (underCard && underCard !== hoverPreview.dismissedCard) {
                    queuePreviewForCard(underCard);
                }
            }
        }, { passive: true, capture: true });
        document.documentElement.addEventListener('mouseleave', scheduleHidePreview);
        window.addEventListener('blur', function () {
            hidePreviewNow();
        });
        document.addEventListener('mouseout', function (ev) {
            var card = ev.target && ev.target.closest ? ev.target.closest(PREVIEW_CARD_SEL) : null;
            if (!card) {
                return;
            }
            var to = ev.relatedTarget;
            if (to && card.contains(to)) {
                return;
            }
            if (card === hoverPreview.dismissedCard) {
                hoverPreview.dismissedCard = null;
            }
            if (to && hoverPreview.el && hoverPreview.el.contains(to)) {
                return;
            }
            if (to && to.closest && to.closest(PREVIEW_CARD_SEL)) {
                // Straight onto the next card: its own mouseover / queuePreviewForCard handles the handoff
                return;
            }
            scheduleHidePreview();
        }, true);
        var hideIfOpen = function (ev) {
            if (ev && ev.target && ev.target.nodeType && hoverPreview.el && hoverPreview.el.contains && hoverPreview.el.contains(ev.target)) {
                return;
            }
            if (hoverPreview.showTimer || (hoverPreview.el && hoverPreview.el.classList.contains('is-open'))) {
                hidePreviewNow();
            }
        };
        window.addEventListener('scroll', function (ev) {
            // Close only when the hovered card really moved. Image loads and scroll anchoring fire scroll events
            // without moving anything under the pointer; a pending open re-checks the pointer when it fires.
            var c = hoverPreview.card;
            if (!c || !hoverPreview.el || !hoverPreview.el.classList.contains('is-open')) {
                return;
            }
            var t = ev && ev.target;
            if (t && t.nodeType === 1 && !t.contains(c)) {
                return;
            }
            var r = c.getBoundingClientRect();
            if (Math.abs(r.top - hoverPreview.anchorTop) < 6 && Math.abs(r.left - hoverPreview.anchorLeft) < 6) {
                return;
            }
            hideIfOpen(ev);
        }, true);
        window.addEventListener('resize', hideIfOpen);
        window.addEventListener('hashchange', hideIfOpen);
        document.addEventListener('mousedown', function (ev) {
            if (ev && ev.target && ev.target.nodeType && hoverPreview.el && hoverPreview.el.contains && hoverPreview.el.contains(ev.target)) {
                clearTimeout(hoverPreview.showTimer);
                hoverPreview.showTimer = null;
                hoverPreview.pending = null;
                return;
            }
            if (hoverPreview.card || hoverPreview.pending) {
                hoverPreview.dismissedCard = hoverPreview.card || hoverPreview.pending;
            }
            hideIfOpen(ev);
        }, true);
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                if (hoverPreview.card || hoverPreview.pending) {
                    hoverPreview.dismissedCard = hoverPreview.card || hoverPreview.pending;
                }
                hideIfOpen();
            }
        });
    }

    /* ----------------------------------------------------------------------
       v7.2 — Per-profile accent colour
       ---------------------------------------------------------------------- */
    function hexToRgb(hex) {
        var m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!m) {
            return null;
        }
        var h = m[1];
        if (h.length === 3) {
            h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        }
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function relativeLuminance(rgb) {
        var a = rgb.map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    function applyProfileAccent(profile) {
        var color = (profile && profile.color) || '';
        if (state.accentSig === color) {
            return;
        }
        state.accentSig = color;
        var root = document.documentElement;
        var rgb = hexToRgb(color);
        if (!rgb) {
            root.style.removeProperty('--bfx-accent');
            root.style.removeProperty('--bfx-accent-rgb');
            root.style.removeProperty('--bfx-accent-ink');
            return;
        }
        var lum = relativeLuminance(rgb);
        var lift = lum < 0.06 ? 0.45 : (lum < 0.12 ? 0.25 : 0);
        rgb = rgb.map(function (v) { return Math.round(v + (255 - v) * lift); });
        root.style.setProperty('--bfx-accent', 'rgb(' + rgb.join(', ') + ')');
        root.style.setProperty('--bfx-accent-rgb', rgb.join(', '));
        root.style.setProperty('--bfx-accent-ink', relativeLuminance(rgb) > 0.45 ? '#0a0a0a' : '#ffffff');
    }

    function buildHubSkeletonHtml() {
        var row = function (count, wide) {
            var cards = '';
            for (var i = 0; i < count; i++) {
                cards += '<div class="streamflix-skel streamflix-skel-card' + (wide ? ' wide' : '') + '"></div>';
            }
            return '<div class="streamflix-skel-row"><div class="streamflix-skel streamflix-skel-title"></div><div class="streamflix-skel-cards">' + cards + '</div></div>';
        };
        return ''
            + '<div class="streamflix-hub-skeleton" aria-busy="true" aria-label="Loading">'
            + '  <div class="streamflix-skel streamflix-skel-hero">'
            + '    <div class="streamflix-skel-hero-lines"><div class="streamflix-skel-line w60"></div><div class="streamflix-skel-line w40"></div><div class="streamflix-skel-line w80"></div></div>'
            + '  </div>'
            + row(6, true) + row(8, false) + row(8, false)
            + '</div>';
    }

    /* ----------------------------------------------------------------------
       7. Rich Netflix Media Detail Modal ('The Devil Wears Prada 2' Style Everywhere)
       ---------------------------------------------------------------------- */
    function openHeroDetailModal(item, options) {
        if (!item) {
            return;
        }
        var opts = options || {};

        // Remove any existing detail modal before opening the new one
        var existingModals = document.querySelectorAll('.streamflix-detail-modal');
        for (var eIdx = 0; eIdx < existingModals.length; eIdx++) {
            var oldWrap = existingModals[eIdx].closest ? existingModals[eIdx].closest('.streamflix-modal-backdrop') : existingModals[eIdx].parentNode;
            if (oldWrap && oldWrap.parentNode) {
                oldWrap.parentNode.removeChild(oldWrap);
            }
        }

        document.body.classList.add('streamflix-modal-open');

        var backdropUrl = getItemBackdropUrl(item, 1600);
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var rating = item.OfficialRating ? String(item.OfficialRating) : '';
        var runtime = formatRuntimeTicks(item.RunTimeTicks);
        var genres = Array.isArray(item.Genres) && item.Genres.length ? item.Genres.slice(0, 3) : [];
        var community = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        var hasResume = item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0;

        var typeBadge = item.Type === 'Series'
            ? 'SERIES'
            : (item.Type === 'BoxSet' ? 'COLLECTION' : (item.Type === 'Episode' ? 'EPISODE' : 'FILM'));
        var displayTitle = (item.Type === 'Episode' && item.SeriesName) ? item.SeriesName : (item.Name || 'Untitled');
        var episodeSubline = item.Type === 'Episode'
            ? ('Season ' + (item.ParentIndexNumber || 1) + ' • Episode ' + (item.IndexNumber || 1) + ' — ' + (item.Name || ''))
            : '';

        var playBtnInitialLabel = iconLabel('play', item.Type === 'BoxSet' ? 'Play Collection' : (hasResume ? 'Resume' : 'Play'));

        // Also update underlying #itemBackdrop if present so it is never black
        var underlyingBackdrop = document.getElementById('itemBackdrop');
        if (underlyingBackdrop && backdropUrl) {
            underlyingBackdrop.style.backgroundImage = 'url("' + backdropUrl + '")';
            underlyingBackdrop.classList.remove('noBackdrop');
        }

        var modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'streamflix-modal-backdrop';
        modalBackdrop.innerHTML = ''
            + '<div class="streamflix-detail-modal">'
            + '  <div class="streamflix-detail-scroll">'
            + '    <div class="streamflix-detail-hero" id="streamflix-modal-hero-banner" style="background-image:url(\'' + escapeHtml(backdropUrl) + '\');">'
            + '      <button type="button" class="streamflix-detail-close" id="streamflix-detail-close-btn" aria-label="Close">' + icon('close') + '</button>'
            + '      <div style="position:relative;z-index:2;max-width:680px;">'
            + '        <div class="streamflix-hero-brand-row"><span class="streamflix-n-badge">S</span><span class="streamflix-hero-series-tag">' + escapeHtml(typeBadge) + '</span></div>'
            + '        <h2 style="font-size:clamp(1.85rem, 3.2vw, 2.6rem);font-weight:900;margin:0 0 ' + (episodeSubline ? '6px' : '14px') + ' 0;text-shadow:0 4px 18px rgba(0,0,0,0.9);">' + escapeHtml(displayTitle) + '</h2>'
            + (episodeSubline ? '<div style="font-size:15px;font-weight:700;color:#e5e5e5;margin:0 0 14px 0;text-shadow:0 2px 10px rgba(0,0,0,0.9);">' + escapeHtml(episodeSubline) + '</div>' : '')
            + '        <div class="streamflix-hero-actions">'
            + '          <button type="button" class="streamflix-hero-play" id="streamflix-modal-play-btn">' + playBtnInitialLabel + '</button>'
            + '          <button type="button" class="streamflix-hero-icon-btn' + (isFav ? ' active' : '') + '" id="streamflix-modal-fav-btn" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
            + '          <button type="button" class="streamflix-hero-icon-btn' + (isPlayed ? ' active' : '') + '" id="streamflix-modal-watched-btn" title="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>'
            + '        </div>'
            + '      </div>'
            + '    </div>'
            + '    <div class="streamflix-detail-body">'
            + '      <div class="streamflix-hero-meta-row" id="streamflix-modal-meta-row" style="margin-top:8px;">'
            + (community ? '<span class="streamflix-hero-rating">' + icon('star') + escapeHtml(community) + '</span>' : '')
            + (year ? '<span>' + escapeHtml(year) + '</span>' : '')
            + (rating ? '<span class="streamflix-maturity-pill">' + escapeHtml(rating) + '</span>' : '')
            + (runtime ? '<span>' + escapeHtml(runtime.trim()) + '</span>' : '')
            + (genres.length ? '<span class="streamflix-hero-genres">' + genres.map(escapeHtml).join('<i></i>') + '</span>' : '')
            + '      </div>'
            + '      <p id="streamflix-modal-overview" class="streamflix-detail-overview">'
            + escapeHtml(item.Overview || 'No description available.')
            + '      </p>'
            + '      <div id="streamflix-modal-tracks-container"></div>'
            + '      <div id="streamflix-modal-credits-container"></div>'
            + '      <div id="streamflix-detail-episodes-section"></div>'
            + '      <div id="streamflix-detail-similar-section" style="margin-top:26px;"></div>'
            + '    </div>'
            + '  </div>'
            + '</div>';

        document.body.appendChild(modalBackdrop);

        var resolvedItem = item;
        var firstPlayableTarget = null;
        var selectedAudioStreamIndex = null;
        var selectedSubtitleStreamIndex = null;
        var detailPriorFocus = document.activeElement;

        function onEscKey(ev) {
            if (isRemoteBackEvent(ev)) {
                ev.preventDefault();
                ev.stopPropagation();
                closeModal(false);
            }
        }
        document.addEventListener('keydown', onEscKey);

        if (isTvOrDpadActive()) {
            setTimeout(function () {
                var playFocus = document.getElementById('streamflix-modal-play-btn');
                if (playFocus) {
                    try { playFocus.focus({ preventScroll: true }); } catch (e) {}
                }
            }, 30);
        }

        function closeModal(keepRoute) {
            document.removeEventListener('keydown', onEscKey);
            if (modalBackdrop.parentNode) {
                modalBackdrop.parentNode.removeChild(modalBackdrop);
            }
            if (!document.querySelector('.streamflix-detail-modal')) {
                document.body.classList.remove('streamflix-modal-open');
            }
            if (!keepRoute && (opts.isRouteBacked || (window.location.hash || '').indexOf('details') !== -1)) {
                state.routeModalItemId = null;
                if (window.history.length > 1) {
                    window.history.back();
                } else {
                    window.location.hash = '#/home';
                }
            }
            if (isTvOrDpadActive() && detailPriorFocus && detailPriorFocus.focus && document.contains(detailPriorFocus)) {
                setTimeout(function () {
                    try { detailPriorFocus.focus({ preventScroll: true }); } catch (e) {}
                }, 20);
            }
        }

        document.getElementById('streamflix-detail-close-btn').addEventListener('click', function () {
            closeModal(false);
        });
        modalBackdrop.addEventListener('click', function (ev) {
            if (ev.target === modalBackdrop) {
                closeModal(false);
            }
        });

        document.getElementById('streamflix-modal-play-btn').addEventListener('click', function () {
            closeModal(true);
            playItemImmediately(firstPlayableTarget || resolvedItem || item, selectedAudioStreamIndex, selectedSubtitleStreamIndex);
        });

        var favBtn = document.getElementById('streamflix-modal-fav-btn');
        favBtn.addEventListener('click', function () {
            var nextFav = !(item.UserData && item.UserData.IsFavorite);
            favBtn.innerHTML = icon(nextFav ? 'check' : 'plus');
            favBtn.classList.toggle('active', nextFav);
            favBtn.title = nextFav ? 'Remove from My List' : 'Add to My List';
            toggleFavoriteItem(item, null);
        });

        var watchedBtn = document.getElementById('streamflix-modal-watched-btn');
        watchedBtn.addEventListener('click', function () {
            var nextPlayed = !(item.UserData && item.UserData.Played);
            watchedBtn.classList.toggle('active', nextPlayed);
            watchedBtn.title = nextPlayed ? 'Mark unwatched' : 'Mark watched';
            togglePlayedItem(item, null);
        });

        function renderEnrichedDetails(fullItem) {
            if (!fullItem || !modalBackdrop.parentNode) {
                return;
            }
            resolvedItem = fullItem;
            var betterBg = getItemBackdropUrl(fullItem, 1600);
            var heroBanner = document.getElementById('streamflix-modal-hero-banner');
            if (heroBanner && betterBg) {
                heroBanner.style.backgroundImage = 'url("' + betterBg + '")';
            }
            var overviewEl = document.getElementById('streamflix-modal-overview');
            if (overviewEl && fullItem.Overview) {
                overviewEl.textContent = fullItem.Overview;
            }

            // Render Audio & Subtitle track selector pills if MediaStreams exist
            var streams = (fullItem.MediaStreams && fullItem.MediaStreams.length)
                ? fullItem.MediaStreams
                : ((fullItem.MediaSources && fullItem.MediaSources[0] && fullItem.MediaSources[0].MediaStreams) || []);
            var videoStreams = streams.filter(function (s) { return s.Type === 'Video'; });
            var audioStreams = streams.filter(function (s) { return s.Type === 'Audio'; });
            var subStreams = streams.filter(function (s) { return s.Type === 'Subtitle'; });

            var tracksEl = document.getElementById('streamflix-modal-tracks-container');
            if (tracksEl && (videoStreams.length > 0 || audioStreams.length > 0 || subStreams.length > 0)) {
                var pillsHtml = '';
                if (videoStreams.length > 0) {
                    var vLabel = videoStreams[0].DisplayTitle || videoStreams[0].Codec || 'HD';
                    pillsHtml += '<div class="streamflix-modal-track-pill"><span class="track-label">Video</span><span style="font-weight:700;color:#fff;">' + escapeHtml(vLabel) + '</span></div>';
                }
                if (audioStreams.length > 0) {
                    var aOpts = audioStreams.map(function (a) {
                        var isDef = a.IsDefault ? ' selected' : '';
                        return '<option value="' + a.Index + '"' + isDef + '>' + escapeHtml(a.DisplayTitle || a.Language || ('Track ' + a.Index)) + '</option>';
                    }).join('');
                    pillsHtml += '<div class="streamflix-modal-track-pill"><span class="track-label">Audio</span><select id="streamflix-modal-audio-select">' + aOpts + '</select></div>';
                }
                if (subStreams.length > 0) {
                    var sOpts = '<option value="-1">Off</option>' + subStreams.map(function (s) {
                        var isDef = s.IsDefault ? ' selected' : '';
                        return '<option value="' + s.Index + '"' + isDef + '>' + escapeHtml(s.DisplayTitle || s.Language || ('Sub ' + s.Index)) + '</option>';
                    }).join('');
                    pillsHtml += '<div class="streamflix-modal-track-pill"><span class="track-label">Subtitles</span><select id="streamflix-modal-sub-select">' + sOpts + '</select></div>';
                }
                tracksEl.innerHTML = '<div class="streamflix-modal-tracks-row">' + pillsHtml + '</div>';

                var aSelEl = document.getElementById('streamflix-modal-audio-select');
                if (aSelEl) {
                    aSelEl.addEventListener('change', function () {
                        selectedAudioStreamIndex = parseInt(aSelEl.value, 10);
                    });
                }
                var sSelEl = document.getElementById('streamflix-modal-sub-select');
                if (sSelEl) {
                    sSelEl.addEventListener('change', function () {
                        selectedSubtitleStreamIndex = parseInt(sSelEl.value, 10);
                    });
                }
            }

            // Render Director / Cast / External Links (IMDb, TMDB)
            var creditsEl = document.getElementById('streamflix-modal-credits-container');
            if (creditsEl) {
                var people = Array.isArray(fullItem.People) ? fullItem.People : [];
                var directors = people.filter(function (p) { return p.Type === 'Director'; }).slice(0, 3).map(function (p) { return p.Name; });
                var cast = people.filter(function (p) { return p.Type === 'Actor'; }).slice(0, 5).map(function (p) { return p.Name; });
                var extUrls = Array.isArray(fullItem.ExternalUrls) ? fullItem.ExternalUrls : [];

                var credParts = [];
                if (directors.length) {
                    credParts.push('<div style="margin-bottom:4px;"><span style="color:#888;font-weight:700;">Director: </span><span style="color:#ddd;">' + escapeHtml(directors.join(', ')) + '</span></div>');
                }
                if (cast.length) {
                    credParts.push('<div style="margin-bottom:6px;"><span style="color:#888;font-weight:700;">Cast: </span><span style="color:#ddd;">' + escapeHtml(cast.join(', ')) + '</span></div>');
                }
                if (extUrls.length) {
                    var linksHtml = extUrls.map(function (u) {
                        return '<a href="' + escapeHtml(u.Url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:3px 10px;margin-right:8px;border-radius:5px;background:rgba(229,9,20,0.16);border:1px solid rgba(229,9,20,0.45);color:#fff;font-size:11.5px;font-weight:800;text-decoration:none;">' + escapeHtml(u.Name) + '</a>';
                    }).join('');
                    credParts.push('<div style="margin-top:6px;">' + linksHtml + '</div>');
                }
                if (credParts.length) {
                    creditsEl.innerHTML = '<div style="font-size:13px;line-height:1.5;margin-bottom:18px;">' + credParts.join('') + '</div>';
                }
            }
        }

        if (item.MediaStreams || item.People) {
            renderEnrichedDetails(item);
        } else if (item.Id) {
            fetchFullItemDetails(item.Id).then(renderEnrichedDetails).catch(function () {});
        }

        var auth = getJellyfinAuthContext();

        // If BoxSet (Collection), load all Movies/Series in this Collection!
        if (item.Type === 'BoxSet' && auth.userId) {
            var colContainer = document.getElementById('streamflix-detail-episodes-section');
            colContainer.innerHTML = '<div style="color:#888;font-size:13px;">Loading collection titles…</div>';
            fetchUserItems(encodeURIComponent(auth.userId), 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Movie,Series,Video&SortBy=PremiereDate,ProductionYear,SortName&Limit=100&Fields=Overview,Genres,PrimaryImageAspectRatio')
                .then(function (res) {
                    var colItems = (res && res.Items) || [];
                    if (!colItems.length || !modalBackdrop.parentNode) {
                        colContainer.innerHTML = '';
                        return;
                    }
                    firstPlayableTarget = colItems[0];
                    var playBtnEl = document.getElementById('streamflix-modal-play-btn');
                    if (playBtnEl && colItems[0] && colItems[0].Name) {
                        playBtnEl.innerHTML = iconLabel('play', 'Play ' + colItems[0].Name);
                    }
                    colContainer.innerHTML = ''
                        + '<h3 style="margin:0 0 14px 0;font-size:19px;font-weight:800;border-top:1px solid rgba(255,255,255,0.1);padding-top:18px;">Titles in this Collection (' + colItems.length + ')</h3>'
                        + '<div class="streamflix-grid">' + colItems.map(buildPosterCardHtml).join('') + '</div>';
                    bindInteractiveCardsInContainer(colContainer, colItems, function () {
                        closeModal(true);
                    });
                })
                .catch(function () {
                    colContainer.innerHTML = '';
                });
        }

        // If TV Series OR Episode of a Series, load Seasons & Episodes!
        var seriesIdForEpisodes = item.Type === 'Series' ? item.Id : (item.Type === 'Episode' ? item.SeriesId : null);
        if (seriesIdForEpisodes && auth.userId) {
            var epContainer = document.getElementById('streamflix-detail-episodes-section');
            epContainer.innerHTML = '<div style="color:#888;font-size:13px;">Loading episodes…</div>';
            apiFetch('/Shows/' + encodeURIComponent(seriesIdForEpisodes) + '/Episodes?userId=' + encodeURIComponent(auth.userId) + '&Fields=Overview,PrimaryImageAspectRatio')
                .then(function (res) {
                    var eps = (res && res.Items) || [];
                    if (!eps.length || !modalBackdrop.parentNode) {
                        epContainer.innerHTML = '';
                        return;
                    }
                    var epMap = {};
                    var seasonsMap = {};
                    var seasonNums = [];
                    var resumableEp = null;
                    var firstUnwatchedEp = null;

                    eps.forEach(function (ep) {
                        if (ep && ep.Id) {
                            epMap[ep.Id] = ep;
                        }
                        if (!resumableEp && ep.UserData && ep.UserData.PlaybackPositionTicks > 0) {
                            resumableEp = ep;
                        }
                        if (!firstUnwatchedEp && (!ep.UserData || !ep.UserData.Played)) {
                            firstUnwatchedEp = ep;
                        }
                        var sNum = ep.ParentIndexNumber || 1;
                        if (!seasonsMap[sNum]) {
                            seasonsMap[sNum] = [];
                            seasonNums.push(sNum);
                        }
                        seasonsMap[sNum].push(ep);
                    });

                    if (item.Type === 'Series') {
                        firstPlayableTarget = resumableEp || firstUnwatchedEp || eps[0];
                        var modalPlayBtn = document.getElementById('streamflix-modal-play-btn');
                        if (modalPlayBtn && firstPlayableTarget) {
                            var sTag = 'S' + (firstPlayableTarget.ParentIndexNumber || 1) + ':E' + (firstPlayableTarget.IndexNumber || 1);
                            modalPlayBtn.innerHTML = iconLabel('play', (resumableEp ? 'Resume ' : 'Play ') + sTag);
                        }
                    }

                    var selectedSeason = (item.Type === 'Episode' && item.ParentIndexNumber && seasonsMap[item.ParentIndexNumber])
                        ? item.ParentIndexNumber
                        : (firstPlayableTarget && firstPlayableTarget.ParentIndexNumber && seasonsMap[firstPlayableTarget.ParentIndexNumber]
                            ? firstPlayableTarget.ParentIndexNumber
                            : seasonNums[0]);

                    function renderSeasonEpisodes() {
                        var seasonOpts = seasonNums.map(function (sNum) {
                            return '<option value="' + sNum + '"' + (sNum === selectedSeason ? ' selected' : '') + '>Season ' + sNum + ' (' + seasonsMap[sNum].length + ' Episodes)</option>';
                        }).join('');

                        var listHtml = (seasonsMap[selectedSeason] || []).map(function (ep, idx) {
                            var thumbUrl = getItemBackdropUrl(ep, 400);
                            var epDur = formatRuntimeTicks(ep.RunTimeTicks);
                            var pct = (ep.UserData && ep.UserData.PlayedPercentage) ? Math.round(ep.UserData.PlayedPercentage) : 0;
                            var isCurrentEp = (item.Type === 'Episode' && normalizeGuid(ep.Id) === normalizeGuid(item.Id))
                                || (firstPlayableTarget && normalizeGuid(ep.Id) === normalizeGuid(firstPlayableTarget.Id));
                            return ''
                                + '<div class="streamflix-episode-row" data-ep-id="' + escapeHtml(ep.Id) + '" style="' + (isCurrentEp ? 'background:rgba(229,9,20,0.14);border-left:3px solid #E50914;' : '') + '">'
                                + '  <div class="streamflix-ep-index">' + (ep.IndexNumber || (idx + 1)) + '</div>'
                                + '  <div class="streamflix-ep-thumb">'
                                + '    <img loading="lazy" src="' + escapeHtml(thumbUrl) + '" alt="' + escapeHtml(ep.Name) + '" onload="this.classList.add(\'is-loaded\')" onerror="this.classList.add(\'is-loaded\');this.style.opacity=0.15" />'
                                + (pct > 0 ? '<div class="streamflix-progress-track"><div class="streamflix-progress-fill" style="width:' + pct + '%;"></div></div>' : '')
                                + '  </div>'
                                + '  <div style="flex:1;min-width:0;">'
                                + '    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">'
                                + '      <div style="font-size:14.5px;font-weight:800;color:#fff;">' + escapeHtml(ep.Name) + '</div>'
                                + '      <div style="font-size:12px;color:#999;flex-shrink:0;">' + escapeHtml(epDur) + '</div>'
                                + '    </div>'
                                + '    <div style="font-size:12.5px;color:#aaa;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">'
                                + escapeHtml(ep.Overview || '')
                                + '    </div>'
                                + '  </div>'
                                + '</div>';
                        }).join('');

                        epContainer.innerHTML = ''
                            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:18px;">'
                            + '  <h3 style="margin:0;font-size:19px;font-weight:800;">Episodes</h3>'
                            + (seasonNums.length > 1 ? '<select id="streamflix-season-select" class="streamflix-select" style="width:auto;min-width:180px;">' + seasonOpts + '</select>' : '')
                            + '</div>'
                            + '<div>' + listHtml + '</div>';

                        var sSel = document.getElementById('streamflix-season-select');
                        if (sSel) {
                            sSel.addEventListener('change', function () {
                                selectedSeason = parseInt(sSel.value, 10) || seasonNums[0];
                                renderSeasonEpisodes();
                            });
                        }

                        Array.prototype.forEach.call(epContainer.querySelectorAll('[data-ep-id]'), function (row) {
                            row.addEventListener('click', function () {
                                var epId = row.getAttribute('data-ep-id');
                                var epObj = epMap[epId] || epId;
                                closeModal(true);
                                playItemImmediately(epObj, selectedAudioStreamIndex, selectedSubtitleStreamIndex);
                            });
                        });
                    }
                    renderSeasonEpisodes();
                })
                .catch(function () {
                    epContainer.innerHTML = '';
                });
        }

        // Load Similar Titles ("More Like This")
        if (auth.userId) {
            var simTargetId = (item.Type === 'Episode' && item.SeriesId) ? item.SeriesId : item.Id;
            var simContainer = document.getElementById('streamflix-detail-similar-section');
            apiFetch('/Items/' + encodeURIComponent(simTargetId) + '/Similar?userId=' + encodeURIComponent(auth.userId) + '&Limit=8&Fields=Overview,Genres')
                .then(function (res) {
                    var sims = (res && res.Items) || [];
                    if (!sims.length || !modalBackdrop.parentNode) {
                        return;
                    }
                    var cards = sims.map(buildPosterCardHtml).join('');
                    simContainer.innerHTML = ''
                        + '<h3 class="streamflix-detail-h3">More Like This</h3>'
                        + '<div class="streamflix-grid streamflix-detail-grid">' + cards + '</div>';
                    bindInteractiveCardsInContainer(simContainer, sims, function () {
                        closeModal(true);
                    });
                })
                .catch(function () {});
        }
    }

    function enhanceLibraryListPages() {
        try {
            var h = (window.location.hash || '').toLowerCase();
            var isMoviesRoute = h.indexOf('#/movies') === 0;
            var isTvRoute = h.indexOf('#/tv') === 0;
            var isListRoute = h.indexOf('#/list') === 0;

            var existingFallback = document.getElementById('streamflix-library-page-fallback');
            if (!isMoviesRoute && !isTvRoute && !isListRoute) {
                if (existingFallback && existingFallback.parentNode) {
                    existingFallback.parentNode.removeChild(existingFallback);
                }
                return;
            }

            if (isVideoPlayerActive() || document.getElementById('streamflix-overlay-root')) {
                return;
            }

            // Ensure Cinema Hub data is loaded so we have allMovies, allSeries, and collectionsItems
            var auth = getJellyfinAuthContext();
            if (auth.userId && auth.token && !state.hubData.loaded && !state.hubData.loading) {
                loadCinemaHubData(true);
                return;
            }
            if (!state.hubData.loaded) {
                return;
            }

            var activePage = document.querySelector('#moviesPage:not(.hide), #tvRecommendedPage:not(.hide), #listPage:not(.hide), .page.libraryPage:not(.hide), .page:not(.hide)');
            var nativeCards = activePage
                ? activePage.querySelectorAll('.itemsContainer .card[data-id]')
                : document.querySelectorAll('.mainAnimatedPages .itemsContainer .card[data-id]');

            if (nativeCards && nativeCards.length > 0) {
                if (existingFallback && existingFallback.parentNode) {
                    existingFallback.parentNode.removeChild(existingFallback);
                }
                return;
            }

            // Hide any "Nothing here." (.noItemsMessage) on the library page
            var noItemsEls = document.querySelectorAll('.noItemsMessage');
            for (var n = 0; n < noItemsEls.length; n++) {
                noItemsEls[n].style.setProperty('display', 'none', 'important');
            }

            var d = state.hubData;
            var itemsToRender = [];
            var sectionTitle = '';
            var extraRowsHtml = '';

            if (isMoviesRoute) {
                itemsToRender = d.allMovies || [];
                sectionTitle = rowTitle('Movies', itemsToRender.length);
                extraRowsHtml = buildGenreCollectionRowsHtml(itemsToRender);
            } else if (isTvRoute) {
                itemsToRender = d.allSeries || [];
                sectionTitle = rowTitle('Shows', itemsToRender.length);
                extraRowsHtml = buildGenreCollectionRowsHtml(itemsToRender);
            } else if (isListRoute) {
                if (h.indexOf('collectiontype=boxsets') !== -1 || d.collectionsItems.length > 0) {
                    itemsToRender = d.collectionsItems || [];
                    sectionTitle = rowTitle('Collections', itemsToRender.length);
                    extraRowsHtml = buildGenreCollectionRowsHtml((d.allMovies || []).concat(d.allSeries || []));
                } else {
                    itemsToRender = (d.allMovies || []).concat(d.allSeries || []);
                    sectionTitle = rowTitle('Library', itemsToRender.length);
                }
            }

            var sig = h + ':' + itemsToRender.length + ':' + (d.collectionsItems ? d.collectionsItems.length : 0);
            if (existingFallback && existingFallback.getAttribute('data-sig') === sig) {
                return;
            }

            var host = activePage || document.querySelector('.mainAnimatedPages') || document.body;
            if (!existingFallback) {
                existingFallback = document.createElement('div');
                existingFallback.id = 'streamflix-library-page-fallback';
                existingFallback.style.cssText = 'padding: 78px 0 48px 0; min-height: 70vh; position: relative; z-index: 5;';
                host.appendChild(existingFallback);
            } else if (existingFallback.parentNode !== host) {
                host.appendChild(existingFallback);
            }

            existingFallback.setAttribute('data-sig', sig);
            existingFallback.innerHTML = ''
                + (itemsToRender.length > 0 ? buildGridSectionHtml('lib-fallback-grid', sectionTitle, itemsToRender) : '')
                + extraRowsHtml;

            bindInteractiveCardsInContainer(existingFallback, itemsToRender, null);
        } catch (e) {}
    }

    function installGlobalCardClickInterceptor() {
        if (window.__STREAMFLIX_CARD_INTERCEPTOR__) {
            return;
        }
        window.__STREAMFLIX_CARD_INTERCEPTOR__ = true;

        document.addEventListener('click', function (ev) {
            try {
                // Never intercept programmatic/synthetic .click() calls (e.g. playItemImmediately)
                if (!ev.isTrusted) {
                    return;
                }
                if (!state.config || state.config.enableStreamFlixUi === false) {
                    return;
                }
                var target = ev.target;
                if (!target || !target.closest) {
                    return;
                }

                // 1. If the user clicks Play or Resume inside native #itemDetailPage ('The Devil Wears Prada 2' 880px card),
                // immediately show the playback loader so #itemDetailPage disappears right away while native onPlayClick starts the player!
                var detailPlayBtn = target.closest('#itemDetailPage .btnPlay, #itemDetailPage .btnResume, #itemDetailPage button[data-action="play"], #itemDetailPage button[data-action="resume"]');
                if (detailPlayBtn) {
                    if (state.activeProfile && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
                        applyJellyfinServerCredentials({
                            serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                            userId: state.activeProfile.jellyfinUserId,
                            accessToken: state.activeProfile.accessToken
                        });
                    }
                    patchJellyfinApiClientMethods();
                    showPlaybackLoader('Starting playback…');
                    var detailPollStart = Date.now();
                    if (state.shortcutPollTimer) {
                        clearInterval(state.shortcutPollTimer);
                    }
                    state.shortcutPollTimer = setInterval(function () {
                        if (isVideoPlayerActive() || document.querySelector('.dialogContainer .dialog:not(.hide)') || (Date.now() - detailPollStart > 6500)) {
                            hidePlaybackLoader();
                        }
                    }, 100);
                    return;
                }

                // 2. If the user clicks "Movies", "TV Shows" ("Shows"), "Collections", or "Home" in the top bar (.MuiToolbar-root / .skinHeader) or side drawer (.MuiDrawer-root),
                // ensure it routes cleanly or switches the StreamFlix Cinema Hub category!
                var navClickEl = target.closest('.MuiToolbar-root a, .MuiToolbar-root button, .skinHeader a, .skinHeader button, .MuiDrawer-root a, .MuiDrawer-root button, .MuiListItemButton-root');
                if (navClickEl && navClickEl.id !== 'streamflix-header-profile-btn' && !navClickEl.closest('#streamflix-account-dropdown')) {
                    var navHref = (navClickEl.getAttribute('href') || '').toLowerCase();
                    var navText = (navClickEl.textContent || '').trim().toLowerCase();
                    var wantCat = null;
                    if (navText === 'movies' || navHref.indexOf('#/movies') !== -1 || navHref.indexOf('collectiontype=movies') !== -1) {
                        wantCat = 'movies';
                    } else if (navText === 'tv shows' || navText === 'shows' || navHref.indexOf('#/tv') !== -1 || navHref.indexOf('collectiontype=tvshows') !== -1) {
                        wantCat = 'series';
                    } else if (navText === 'collections' || navHref.indexOf('collectiontype=boxsets') !== -1) {
                        wantCat = 'collections';
                    } else if (navText === 'home' || navClickEl.getAttribute('data-streamflix-corner-brand') === 'true') {
                        wantCat = 'all';
                    }

                    if (wantCat && state.cinemaHubEnabled && !isAdminConfigRoute()) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        state.activeCategory = wantCat;
                        state.heroIndex = 0;
                        state.searchQuery = '';
                        state.searchResults = null;
                        if (!isOnHomeRoute()) {
                            window.location.hash = '#/home';
                        }
                        setTimeout(function () {
                            ensureCinemaHubMounted();
                            renderCinemaHubContents();
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }, 30);
                        return;
                    }
                }

                // Ignore other clicks inside #itemDetailPage, video player, StreamFlix modals, Cinema Hub, top bar, side drawer, or dialogs
                if (target.closest('#itemDetailPage, #videoOsdPage, .videoPlayerContainer, .streamflix-modal-backdrop, #streamflix-cinema-hub, #streamflix-library-page-fallback, #streamflix-overlay-root, #streamflix-account-dropdown, #streamflix-header-profile-btn, .MuiDrawer-root, .skinHeader, .videoOsdBottom, .actionSheet, .dialogContainer')) {
                    return;
                }

                // 3. If user clicked a quick Play / Resume overlay button on a native Jellyfin card (including big .overflowBackdropCard / .backdropCard),
                // play it through our reliable playItemImmediately engine!
                var nativePlayBtn = target.closest('button[data-action="play"], button[data-action="resume"], .cardOverlayFab-primary');
                if (nativePlayBtn) {
                    var parentCard = nativePlayBtn.closest('.card[data-id], .listItem[data-id], [data-id]');
                    var playId = (parentCard && parentCard.getAttribute('data-id')) || nativePlayBtn.getAttribute('data-id');
                    if (playId) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        playItemImmediately(playId);
                        return;
                    }
                }

                // Let Jellyfin handle Favorite / Watched / Menu buttons on native cards directly
                if (target.closest('button[data-action="menu"], button[data-action="toggleplayed"], .btnUserData')) {
                    return;
                }

                // 4. If user clicked a "My Media" library card or a link pointing to #/movies, #/tv, or #/list, route to the corresponding category!
                var anyAnchor = target.closest('a[href]');
                if (anyAnchor) {
                    var aHref = (anyAnchor.getAttribute('href') || '').toLowerCase();
                    if (aHref && aHref.indexOf('details?id=') === -1) {
                        if (state.cinemaHubEnabled) {
                            var mediaCat = null;
                            if (aHref.indexOf('movies') !== -1) {
                                mediaCat = 'movies';
                            } else if (aHref.indexOf('/tv') !== -1 || aHref.indexOf('tvshows') !== -1) {
                                mediaCat = 'series';
                            } else if (aHref.indexOf('boxsets') !== -1 || aHref.indexOf('/list') !== -1) {
                                mediaCat = 'collections';
                            }
                            if (mediaCat) {
                                ev.preventDefault();
                                ev.stopPropagation();
                                state.activeCategory = mediaCat;
                                state.heroIndex = 0;
                                state.searchQuery = '';
                                state.searchResults = null;
                                if (!isOnHomeRoute()) {
                                    window.location.hash = '#/home';
                                }
                                ensureCinemaHubMounted();
                                renderCinemaHubContents();
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                return;
                            }
                        }
                        return;
                    }
                }

                // 5. If user clicked a Movie, Series, Episode, or BoxSet card in native library/home grids (including big .overflowBackdropCard),
                // open 'The Devil Wears Prada 2' Netflix card modal!
                var linkEl = target.closest('a[href*="details?id="]');
                var cardEl = target.closest('.card[data-id], .listItem[data-id]');
                var itemId = null;
                var itemType = '';

                if (linkEl) {
                    var href = linkEl.getAttribute('href') || '';
                    var m = href.match(/[?&]id=([a-f0-9-]+)/i);
                    if (m) {
                        itemId = m[1];
                    }
                }
                if (cardEl) {
                    itemId = itemId || cardEl.getAttribute('data-id');
                    itemType = (cardEl.getAttribute('data-type') || '').toLowerCase();
                }

                if (!itemId) {
                    return;
                }

                // If it's a top-level UserView / CollectionFolder card ("My Media"), switch to its Cinema Hub category
                if (itemType === 'collectionfolder' || itemType === 'userview' || isKnownTopLevelViewId(itemId)) {
                    if (state.cinemaHubEnabled) {
                        var inferred = inferItemTypesForParentOrRoute(itemId, '');
                        var targetCat = inferred === 'Movie' ? 'movies' : (inferred === 'Series' ? 'series' : 'collections');
                        ev.preventDefault();
                        ev.stopPropagation();
                        state.activeCategory = targetCat;
                        state.heroIndex = 0;
                        state.searchQuery = '';
                        state.searchResults = null;
                        if (!isOnHomeRoute()) {
                            window.location.hash = '#/home';
                        }
                        ensureCinemaHubMounted();
                        renderCinemaHubContents();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                    return;
                }

                // Let Folders, Persons/Actors, and Genres navigate to their list views (BoxSets open in our Netflix Collection Modal!)
                var nonModalTypes = ['folder', 'person', 'actor', 'genre', 'studio', 'playlist'];
                if (itemType && nonModalTypes.indexOf(itemType) !== -1) {
                    return;
                }

                var isCardLinkAction = Boolean(linkEl) || Boolean(target.closest('[data-action="link"], .cardImageContainer, .cardBox, .cardScalable, .cardPadder, .listItemBody'));
                if (!isCardLinkAction) {
                    return;
                }

                ev.preventDefault();
                ev.stopPropagation();
                openHeroDetailModalById(itemId, { isRouteBacked: false });
            } catch (e) {}
        }, true);
    }

    /* ----------------------------------------------------------------------
       8. Bootstrap & Event-Driven Lifecycle (no fixed-rate polling)
       ---------------------------------------------------------------------- */
    var configFetchInFlight = null;
    var lastConfigFetchAt = 0;

    function fetchPublicConfig() {
        if (configFetchInFlight) {
            return configFetchInFlight;
        }
        lastConfigFetchAt = Date.now();
        configFetchInFlight = apiFetch('/StreamFlix/PublicConfig').then(function (cfg) {
            applyConfigFromServerResponse(cfg);
            return state.config;
        }).catch(function () {
            if (!state.config) {
                state.config = DEFAULT_CONFIG;
            }
            return state.config;
        }).then(function (cfg) {
            configFetchInFlight = null;
            return cfg;
        });
        return configFetchInFlight;
    }

    function verifyActiveJellyfinSessionOnce() {
        if (state.sessionVerifiedOnce || state.activatingProfileId || !state.activeProfile || !state.activeProfile.accessToken || !state.activeProfile.jellyfinUserId) {
            return;
        }
        state.sessionVerifiedOnce = true;

        var uid = state.activeProfile.jellyfinUserId;
        var token = state.activeProfile.accessToken;
        var authHeader = getEmbyAuthHeader(token);
        var fetchFn = nativeFetch || window.fetch;
        fetchFn(apiBase() + '/Users/' + encodeURIComponent(uid), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': authHeader,
                'X-Emby-Token': token,
                'X-Emby-Authorization': authHeader
            },
            cache: 'no-store'
        }).then(function (res) {
            if (res.status === 401) {
                state.activeProfile = null;
                localStorage.removeItem(PROFILE_KEY);
                scheduleLifecycleTick(0);
                return null;
            }
            if (!res.ok) {
                return null;
            }
            return res.json();
        }).then(function (userDto) {
            if (userDto && state.activeProfile) {
                applyJellyfinServerCredentials({
                    serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                    userId: state.activeProfile.jellyfinUserId,
                    accessToken: state.activeProfile.accessToken,
                    user: userDto
                });
            }
        }).catch(function () {});
    }

    function isOnJellyfinLoginPage() {
        return (window.location.hash || '').toLowerCase().indexOf('login') !== -1
            || Boolean(document.querySelector('#loginPage:not(.hide)'));
    }

    function evaluateAuthAndProfileGate() {
        installJellyfin12FetchInterceptor();
        patchJellyfinApiClientMethods();
        fixBrokenJellyfinRoutes();

        if (state.verifyingGoogle || state.activatingProfileId) {
            return;
        }

        if (!state.config || state.config.enableStreamFlixUi === false) {
            return;
        }

        ensureHeaderWidgets();

        if (isAdminConfigRoute()) {
            return;
        }

        var onJellyfinLoginPage = isOnJellyfinLoginPage();

        if (!hasHouseholdAccess()) {
            // Jellyfin's own password login is only reachable while Google Sign-In is not configured yet (first-time setup).
            // Once Google is configured there is no way around the Google gate from the sign-in screen.
            if (onJellyfinLoginPage && !state.config.googleConfigured) {
                if (isGateOpen()) {
                    closeOverlayGate();
                }
                return;
            }
            var stage = document.getElementById('streamflix-stage');
            var view = stage && stage.getAttribute('data-view');
            if (!isGateOpen() || (view !== 'auth' && view !== 'setup')) {
                renderGoogleAuthGate();
            }
            return;
        }
        // If upgrading from v5/v6.3, re-activate the previously selected profile on the server so it gets a fresh token
        if (!state.activeProfile && state.legacyProfileToMigrate && getProfiles().length > 0) {
            var migTarget = findProfileById(state.legacyProfileToMigrate.id);
            state.legacyProfileToMigrate = null;
            if (migTarget && !migTarget.hasPin && !(migTarget.googleLocked && !migTarget.googleLockSatisfied)) {
                activateServerProfile(migTarget, '').catch(function () {
                    renderProfilePickerGate();
                });
                return;
            }
        }

        // Sync display properties from the server profile, re-activating cleanly if it's been re-linked
        if (state.activeProfile && state.activeProfile.id && state.configFresh) {
            var sp = findProfileById(state.activeProfile.id);
            if (!sp && getProfiles().length > 0) {
                // The active profile was deleted on another device
                state.activeProfile = null;
                localStorage.removeItem(PROFILE_KEY);
            } else if (sp) {
                state.activeProfile.name = sp.name || state.activeProfile.name;
                state.activeProfile.color = sp.color || state.activeProfile.color;
                state.activeProfile.icon = sp.icon || state.activeProfile.icon;
                state.activeProfile.isKids = Boolean(sp.isKids);
                state.activeProfile.isAdmin = Boolean(sp.isAdmin);
                state.activeProfile.jellyfinUsername = sp.jellyfinUsername || state.activeProfile.jellyfinUsername;
                if (sp.jellyfinUserId
                    && normalizeGuid(sp.jellyfinUserId) !== normalizeGuid(state.activeProfile.jellyfinUserId)
                    && !sp.hasPin
                    && sp.googleLockSatisfied) {
                    activateServerProfile(sp, '').catch(function () {});
                    return;
                }
            }
        }

        if (!state.activeProfile || !state.activeProfile.id || !state.activeProfile.accessToken || onJellyfinLoginPage) {
            var pickerStage = document.getElementById('streamflix-stage');
            var pickerView = pickerStage && pickerStage.getAttribute('data-view');
            if (!isGateOpen() || !pickerView || pickerView.indexOf('picker') !== 0) {
                renderProfilePickerGate();
            }
            return;
        }

        if (window.ApiClient) {
            var currentToken = typeof window.ApiClient.accessToken === 'function' ? window.ApiClient.accessToken() : null;
            var currentUserId = typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : null;
            if (currentToken !== state.activeProfile.accessToken
                || normalizeGuid(currentUserId) !== normalizeGuid(state.activeProfile.jellyfinUserId)) {
                applyJellyfinServerCredentials({
                    serverId: state.activeProfile.serverId || state.config.serverId,
                    userId: state.activeProfile.jellyfinUserId,
                    accessToken: state.activeProfile.accessToken
                });
            }
        }

        verifyActiveJellyfinSessionOnce();
        installGlobalCardClickInterceptor();

        if (!isGateOpen()) {
            ensureHeaderWidgets();
            enhanceItemDetailPage();
            enhanceLibraryListPages();
            if (isOnHomeRoute()) {
                ensureCinemaHubMounted();
            }
        }
    }

    /* Throttled scheduler: DOM mutations, routing and visibility changes trigger a tick (max ~4/s). */
    var lifecycleTimer = null;
    var lastLifecycleTickAt = 0;
    var LIFECYCLE_MIN_GAP_MS = 250;
    var lastSeenApiToken; // undefined until the first tick

    function scheduleLifecycleTick(delayMs) {
        if (lifecycleTimer) {
            return;
        }
        var sinceLast = Date.now() - lastLifecycleTickAt;
        var wait = Math.max(delayMs || 0, LIFECYCLE_MIN_GAP_MS - sinceLast, 0);
        lifecycleTimer = setTimeout(function () {
            lifecycleTimer = null;
            lastLifecycleTickAt = Date.now();
            try {
                lifecycleTick();
            } catch (e) {}
        }, wait);
    }

    function lifecycleTick() {
        // When someone signs in through Jellyfin's own login page, ask the server whether that unlocks StreamFlix
        var apiToken = null;
        try {
            apiToken = window.ApiClient && typeof window.ApiClient.accessToken === 'function' ? window.ApiClient.accessToken() : null;
        } catch (e) {}
        if (apiToken !== lastSeenApiToken) {
            var hadPrevious = lastSeenApiToken !== undefined;
            lastSeenApiToken = apiToken;
            if (hadPrevious && apiToken && !hasHouseholdAccess()) {
                fetchPublicConfig().then(function () { scheduleLifecycleTick(0); });
            }
        }

        // Periodically refresh server config (revoked sessions, profile changes on other devices)
        if (!document.hidden && Date.now() - lastConfigFetchAt > 5 * 60 * 1000 && !state.verifyingGoogle && !state.activatingProfileId) {
            fetchPublicConfig().then(function () {
                rerenderPickerIfOpen();
                scheduleLifecycleTick(0);
            });
        }

        evaluateAuthAndProfileGate();
    }

    var OWN_UI_SELECTOR = '#streamflix-overlay-root, #streamflix-overlay-root-closing, #streamflix-cinema-hub, #streamflix-account-dropdown, '
        + '#streamflix-header-profile-btn, #streamflix-toast-host, .streamflix-modal-backdrop, #streamflix-library-page-fallback, #bfx-hover-preview';

    function isOwnNode(node) {
        if (!node) {
            return false;
        }
        var el = node.nodeType === 1 ? node : node.parentNode;
        if (!el || el.nodeType !== 1) {
            return false;
        }
        if ((el.id && el.id.indexOf('streamflix') === 0) || (typeof el.className === 'string' && el.className.indexOf('streamflix-') !== -1)) {
            return true;
        }
        return Boolean(el.closest && el.closest(OWN_UI_SELECTOR));
    }

    function isOwnMutation(mutation) {
        var doc = window.document;
        var body = doc ? doc.body : null;
        if (isOwnNode(mutation.target) && mutation.target !== body) {
            return true;
        }
        var nodes = [];
        Array.prototype.push.apply(nodes, mutation.addedNodes || []);
        Array.prototype.push.apply(nodes, mutation.removedNodes || []);
        if (!nodes.length) {
            return false;
        }
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === 3 && !String(nodes[i].nodeValue || '').trim()) {
                continue;
            }
            if (!isOwnNode(nodes[i])) {
                return false;
            }
        }
        return true;
    }

    function installLifecycleWatchers() {
        try { installHoverPreview(); } catch (eHover) {}
        if (window.MutationObserver && document.body) {
            var observer = new MutationObserver(function (mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    if (!isOwnMutation(mutations[i])) {
                        scheduleLifecycleTick(0);
                        return;
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        window.addEventListener('hashchange', function () {
            try {
                fixBrokenJellyfinRoutes();
            } catch (e) {}
            scheduleLifecycleTick(0);
        });
        window.addEventListener('popstate', function () { scheduleLifecycleTick(0); });
        window.addEventListener('pageshow', function () { scheduleLifecycleTick(0); });
        window.addEventListener('focus', function () { scheduleLifecycleTick(0); });
        document.addEventListener('viewshow', function () { scheduleLifecycleTick(0); }, true);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                scheduleLifecycleTick(0);
            }
        });

        // Header turns into frosted glass once the page scrolls
        var scrollQueued = false;
        var onAnyScroll = function (ev) {
            if (scrollQueued) {
                return;
            }
            scrollQueued = true;
            (window.requestAnimationFrame || setTimeout)(function () {
                scrollQueued = false;
                var t = ev && ev.target;
                var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
                if (t && t.nodeType === 1 && t !== document.documentElement && t !== document.body) {
                    if (t.scrollHeight - t.clientHeight < 40 || (t.classList && t.classList.contains('streamflix-carousel-track'))) {
                        return;
                    }
                    y = Math.max(y, t.scrollTop || 0);
                }
                var scrolled = y > 24;
                if (scrolled !== Boolean(state.headerScrolled)) {
                    state.headerScrolled = scrolled;
                    document.body.classList.toggle('streamflix-scrolled', scrolled);
                }
            });
        };
        document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });

        var lastPtrX = -1;
        var lastPtrY = -1;
        document.addEventListener('mousemove', function (ev) {
            if (ev.clientX === lastPtrX && ev.clientY === lastPtrY) {
                return;
            }
            lastPtrX = ev.clientX;
            lastPtrY = ev.clientY;
            if (document.body && document.body.classList.contains('bfx-dpad-nav')) {
                document.body.classList.remove('bfx-dpad-nav');
            }
        }, { passive: true });

        document.addEventListener('keydown', function (ev) {
            if (isRemoteBackEvent(ev) && (osdState.episodesOpen || osdState.tracksOpen)) {
                ev.preventDefault();
                ev.stopPropagation();
                closeOsdOverlays();
                return;
            }
            if (isRemoteBackEvent(ev) && state.accountDropdownOpen) {
                ev.preventDefault();
                closeAccountDropdown();
                var pBtn = document.getElementById('streamflix-header-profile-btn');
                if (pBtn && isTvOrDpadActive()) {
                    try { pBtn.focus({ preventScroll: true }); } catch (e) {}
                }
                return;
            }
            if (handleDpadArrowKey(ev)) {
                return;
            }
            if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                var tag = (document.activeElement && document.activeElement.tagName) || '';
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (document.activeElement && document.activeElement.isContentEditable)) {
                    return;
                }
                var search = document.getElementById('streamflix-live-search-input');
                if (search && search.offsetParent !== null && !isGateOpen()) {
                    ev.preventDefault();
                    search.focus();
                }
            }
        });

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                syncDeviceLayoutClasses();
                syncHeroBleed();
                Array.prototype.forEach.call(document.querySelectorAll('#streamflix-cinema-hub .streamflix-carousel-wrap'), updatePaddleState);
            }, 150);
        });

        // Low-frequency safety net for changes that don't touch the DOM (e.g. ApiClient swapping credentials)
        setInterval(function () {
            if (!document.hidden) {
                scheduleLifecycleTick(0);
            }
        }, 2500);
    }

    /* ----------------------------------------------------------------------
       Device Layout Detection (Phone & TV) + 2D Spatial D-Pad Navigation
       ---------------------------------------------------------------------- */
    var TV_UA_RE = /\b(SmartTV|SMART-TV|Web0S|WebOS|Tizen|BRAVIA|AFT[A-Z0-9]*|FireTV|Android\s*TV|GoogleTV|AppleTV|CrKey|Roku|Viera|NetCast|Xbox|PlayStation|SHIELD)\b/i;

    function detectTvEnvironment() {
        try {
            var search = (window.location && window.location.search) || '';
            var hash = (window.location && window.location.hash) || '';
            if (/[?&]tv=1\b/.test(search) || /[?&]tv=1\b/.test(hash)) {
                return true;
            }
            var docEl = document.documentElement;
            var body = document.body;
            if ((docEl && docEl.classList.contains('layout-tv')) || (body && body.classList.contains('layout-tv'))) {
                return true;
            }
            var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
            if (ua && TV_UA_RE.test(ua)) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function detectPhoneEnvironment() {
        try {
            var docEl = document.documentElement;
            var body = document.body;
            if ((docEl && docEl.classList.contains('layout-mobile')) || (body && body.classList.contains('layout-mobile'))) {
                var vw = window.innerWidth || 1024;
                var vh = window.innerHeight || 768;
                if (vw <= 680 || (vh <= 520 && vw <= 960)) {
                    return true;
                }
            }
            var w = window.innerWidth || 1024;
            var h = window.innerHeight || 768;
            return w <= 640 || (h <= 500 && w <= 960);
        } catch (e) {
            return false;
        }
    }

    function syncDeviceLayoutClasses() {
        if (!document.body) {
            return;
        }
        var isTv = detectTvEnvironment();
        var isPhone = !isTv && detectPhoneEnvironment();
        document.body.classList.toggle('bfx-tv-mode', isTv);
        document.body.classList.toggle('bfx-phone-mode', isPhone);
    }

    function isTvOrDpadActive() {
        return Boolean(document.body && (document.body.classList.contains('bfx-tv-mode') || document.body.classList.contains('bfx-dpad-nav')));
    }

    function isEditableTarget(el) {
        if (!el || el.nodeType !== 1) {
            return false;
        }
        if (el.isContentEditable) {
            return true;
        }
        var tag = (el.tagName || '').toUpperCase();
        if (tag === 'TEXTAREA' || tag === 'SELECT') {
            return true;
        }
        if (tag === 'INPUT') {
            var type = String(el.type || 'text').toLowerCase();
            return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
        }
        return false;
    }

    function isRemoteBackEvent(ev) {
        if (!ev) {
            return false;
        }
        var k = ev.key;
        if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') {
            return true;
        }
        if (k === 'Backspace' && !isEditableTarget(ev.target)) {
            return true;
        }
        return false;
    }

    function isFocusableVisible(el) {
        if (!el || el.nodeType !== 1 || el.disabled) {
            return false;
        }
        if (el.classList.contains('streamflix-paddle') || el.classList.contains('bfx-osd-hide')) {
            return false;
        }
        // Keep 1-press-per-card navigation: skip nested quick-action micro-buttons inside cards
        var parentCard = el.closest ? el.closest('.streamflix-poster-card, .streamflix-wide-card, .streamflix-top10-card, .streamflix-profile-tile') : null;
        if (parentCard && parentCard !== el) {
            return false;
        }
        var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
            return false;
        }
        var r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
    }

    function centerCardInRowTrack(card, instant) {
        if (!card || !card.closest) {
            return;
        }
        var track = card.closest('.streamflix-carousel-track');
        if (track && track.scrollWidth > track.clientWidth + 4) {
            var tr = track.getBoundingClientRect();
            var cr = card.getBoundingClientRect();
            var delta = (cr.left + cr.width / 2) - (tr.left + tr.width / 2);
            var nextLeft = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, track.scrollLeft + delta));
            try {
                track.scrollTo({ left: nextLeft, behavior: (instant || prefersReducedMotion()) ? 'auto' : 'smooth' });
            } catch (e) {
                track.scrollLeft = nextLeft;
            }
        }
    }

    function scrollElementComfortablyIntoView(el) {
        if (!el) {
            return;
        }
        var modalScroll = el.closest ? el.closest('.streamflix-detail-scroll, .streamflix-modal-editor, #streamflix-account-dropdown') : null;
        if (modalScroll && modalScroll.scrollHeight > modalScroll.clientHeight + 8) {
            var mr = modalScroll.getBoundingClientRect();
            var er = el.getBoundingClientRect();
            if (er.top < mr.top + 24 || er.bottom > mr.bottom - 24) {
                var targetTop = modalScroll.scrollTop + (er.top - mr.top) - Math.round(mr.height * 0.32);
                try {
                    modalScroll.scrollTo({ top: Math.max(0, targetTop), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                } catch (e) {
                    modalScroll.scrollTop = Math.max(0, targetTop);
                }
            }
            return;
        }
        var r = el.getBoundingClientRect();
        var vh = window.innerHeight || 900;
        if (r.top < 88 || r.bottom > vh - 48) {
            var pageY = (window.pageYOffset || document.documentElement.scrollTop || 0) + r.top - Math.round(vh * 0.36);
            try {
                window.scrollTo({ top: Math.max(0, pageY), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            } catch (e) {
                window.scrollTo(0, Math.max(0, pageY));
            }
        }
    }

    function focusSpatialTarget(el) {
        if (!el) {
            return false;
        }
        try {
            el.focus({ preventScroll: true });
        } catch (e) {
            try { el.focus(); } catch (e2) {}
        }
        centerCardInRowTrack(el, false);
        scrollElementComfortablyIntoView(el);
        return true;
    }

    function getActiveDpadScope() {
        var epDrawer = document.getElementById('streamflix-osd-episodes');
        if (osdState.episodesOpen && epDrawer) {
            return { kind: 'osd-overlay', roots: [epDrawer] };
        }
        var trPop = document.getElementById('streamflix-osd-tracks');
        if (osdState.tracksOpen && trPop) {
            return { kind: 'osd-overlay', roots: [trPop] };
        }
        var modals = document.querySelectorAll('.streamflix-modal-backdrop:not(.streamflix-modal-leave)');
        if (modals.length > 0) {
            return { kind: 'modal', roots: [modals[modals.length - 1]] };
        }
        var dd = document.getElementById('streamflix-account-dropdown');
        if (state.accountDropdownOpen && dd) {
            return { kind: 'dropdown', roots: [dd] };
        }
        var gate = document.getElementById('streamflix-overlay-root');
        if (gate) {
            return { kind: 'gate', roots: [gate] };
        }
        var hub = document.getElementById('streamflix-cinema-hub');
        if (hub && hub.offsetParent !== null) {
            var roots = [hub];
            var hdrBtn = document.getElementById('streamflix-header-profile-btn');
            if (hdrBtn) {
                roots.unshift(hdrBtn);
            }
            return { kind: 'hub', roots: roots };
        }
        return null;
    }

    function collectScopeTargets(scope) {
        var out = [];
        var seen = [];
        var sel = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';
        scope.roots.forEach(function (root) {
            if (!root) {
                return;
            }
            if (root.matches && root.matches(sel) && isFocusableVisible(root)) {
                seen.push(root);
                out.push(root);
            }
            Array.prototype.forEach.call(root.querySelectorAll(sel), function (el) {
                if (seen.indexOf(el) === -1 && isFocusableVisible(el)) {
                    seen.push(el);
                    out.push(el);
                }
            });
        });
        return out;
    }

    function pickBestSpatialCandidate(cur, candidates, dir) {
        var cr = cur.getBoundingClientRect();
        var cx = cr.left + cr.width / 2;
        var cy = cr.top + cr.height / 2;
        var best = null;
        var bestScore = Infinity;

        for (var i = 0; i < candidates.length; i++) {
            var cand = candidates[i];
            if (cand === cur) {
                continue;
            }
            var r = cand.getBoundingClientRect();
            var tx = r.left + r.width / 2;
            var ty = r.top + r.height / 2;
            var dx = tx - cx;
            var dy = ty - cy;
            var primary = 0;
            var crossGap = 0;

            if (dir === 'left') {
                if (dx >= -4) { continue; }
                primary = Math.max(0, cr.left - r.right) || Math.abs(dx);
                crossGap = r.bottom < cr.top ? (cr.top - r.bottom) : (r.top > cr.bottom ? (r.top - cr.bottom) : 0);
            } else if (dir === 'right') {
                if (dx <= 4) { continue; }
                primary = Math.max(0, r.left - cr.right) || Math.abs(dx);
                crossGap = r.bottom < cr.top ? (cr.top - r.bottom) : (r.top > cr.bottom ? (r.top - cr.bottom) : 0);
            } else if (dir === 'up') {
                if (dy >= -4) { continue; }
                primary = Math.max(0, cr.top - r.bottom) || Math.abs(dy);
                crossGap = r.right < cr.left ? (cr.left - r.right) : (r.left > cr.right ? (r.left - cr.right) : 0);
            } else if (dir === 'down') {
                if (dy <= 4) { continue; }
                primary = Math.max(0, r.top - cr.bottom) || Math.abs(dy);
                crossGap = r.right < cr.left ? (cr.left - r.right) : (r.left > cr.right ? (r.left - cr.right) : 0);
            }

            var centerCross = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);
            var score = primary + crossGap * 3.2 + centerCross * 0.35;
            if (score < bestScore) {
                bestScore = score;
                best = cand;
            }
        }
        return best;
    }

    function handleDpadArrowKey(ev) {
        var keyMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        var dir = keyMap[ev.key];
        if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) {
            return false;
        }
        if ((isVideoPlayerActive() || (document.body && document.body.classList.contains('streamflix-in-video-player')))
            && !osdState.episodesOpen && !osdState.tracksOpen) {
            return false;
        }
        var active = document.activeElement;
        if (isEditableTarget(active)) {
            if (!(active.id === 'streamflix-live-search-input' && dir === 'down')) {
                return false;
            }
        }

        var scope = getActiveDpadScope();
        if (!scope) {
            return false;
        }

        document.body.classList.add('bfx-dpad-nav');
        hidePreviewNow();

        var inScope = active && scope.roots.some(function (r) { return r === active || (r.contains && r.contains(active)); });
        if (!inScope) {
            var initial = null;
            if (scope.kind === 'gate') {
                initial = scope.roots[0].querySelector('.streamflix-profile-tile:not(.streamflix-tile-locked)[data-profile-id]')
                    || scope.roots[0].querySelector('#streamflix-google-login-btn')
                    || scope.roots[0].querySelector('.streamflix-profile-tile');
            } else if (scope.kind === 'modal') {
                initial = scope.roots[0].querySelector('#streamflix-modal-play-btn')
                    || scope.roots[0].querySelector('.streamflix-btn-primary')
                    || scope.roots[0].querySelector('button:not(:disabled)');
            } else if (scope.kind === 'dropdown') {
                initial = scope.roots[0].querySelector('.streamflix-dd-switch-tile, .streamflix-dd-tile')
                    || scope.roots[0].querySelector('.streamflix-dd-item')
                    || scope.roots[0].querySelector('button:not(:disabled)');
            } else if (scope.kind === 'hub') {
                initial = document.querySelector('#streamflix-hero-billboard .streamflix-hero-play')
                    || document.querySelector('#streamflix-cinema-hub .streamflix-pill.active')
                    || document.querySelector('#streamflix-cinema-hub [data-item-id]');
            }
            if (!initial) {
                var all = collectScopeTargets(scope);
                initial = all[0] || null;
            }
            if (initial) {
                ev.preventDefault();
                focusSpatialTarget(initial);
                return true;
            }
            return false;
        }

        // Row-aware fast-path for horizontal card carousels on Home / Movies / Shows / Collections
        if (scope.kind === 'hub' && active.hasAttribute && active.hasAttribute('data-item-id')) {
            var rowEl = active.closest ? active.closest('.streamflix-row') : null;
            var trackEl = active.closest ? active.closest('.streamflix-carousel-track') : null;
            if (rowEl && trackEl) {
                var rowCards = Array.prototype.slice.call(trackEl.querySelectorAll('[data-item-id]'));
                var cIdx = rowCards.indexOf(active);
                if (dir === 'left' || dir === 'right') {
                    ev.preventDefault();
                    var nextIdx = dir === 'right' ? Math.min(rowCards.length - 1, cIdx + 1) : Math.max(0, cIdx - 1);
                    if (rowCards[nextIdx] && rowCards[nextIdx] !== active) {
                        focusSpatialTarget(rowCards[nextIdx]);
                    }
                    return true;
                }
                var allRows = Array.prototype.slice.call(document.querySelectorAll('#streamflix-cinema-hub .streamflix-row')).filter(function (rw) {
                    return rw.offsetParent !== null && rw.querySelector('[data-item-id]');
                });
                var rIdx = allRows.indexOf(rowEl);
                if (dir === 'down' && rIdx !== -1 && rIdx + 1 < allRows.length) {
                    ev.preventDefault();
                    var curCx = active.getBoundingClientRect().left + active.getBoundingClientRect().width / 2;
                    var nextRowCards = Array.prototype.slice.call(allRows[rIdx + 1].querySelectorAll('[data-item-id]'));
                    var bestCard = nextRowCards[0];
                    var bestDx = Infinity;
                    nextRowCards.forEach(function (nc) {
                        var nr = nc.getBoundingClientRect();
                        var d = Math.abs((nr.left + nr.width / 2) - curCx);
                        if (d < bestDx) { bestDx = d; bestCard = nc; }
                    });
                    if (bestCard) {
                        focusSpatialTarget(bestCard);
                    }
                    return true;
                }
                if (dir === 'up' && rIdx > 0) {
                    ev.preventDefault();
                    var upCx = active.getBoundingClientRect().left + active.getBoundingClientRect().width / 2;
                    var prevRowCards = Array.prototype.slice.call(allRows[rIdx - 1].querySelectorAll('[data-item-id]'));
                    var bestUp = prevRowCards[0];
                    var bestUpDx = Infinity;
                    prevRowCards.forEach(function (pc) {
                        var pr = pc.getBoundingClientRect();
                        var d = Math.abs((pr.left + pr.width / 2) - upCx);
                        if (d < bestUpDx) { bestUpDx = d; bestUp = pc; }
                    });
                    if (bestUp) {
                        focusSpatialTarget(bestUp);
                    }
                    return true;
                }
                if (dir === 'up' && rIdx === 0) {
                    var heroPlay = document.querySelector('#streamflix-hero-billboard .streamflix-hero-play');
                    var activePill = document.querySelector('#streamflix-cinema-hub .streamflix-pill.active, #streamflix-cinema-hub .streamflix-pill');
                    var topTarget = (heroPlay && isFocusableVisible(heroPlay)) ? heroPlay : activePill;
                    if (topTarget && isFocusableVisible(topTarget)) {
                        ev.preventDefault();
                        try { topTarget.focus({ preventScroll: true }); } catch (e) {}
                        try { window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); } catch (e2) { window.scrollTo(0, 0); }
                        return true;
                    }
                }
            }
        }

        var targets = collectScopeTargets(scope);
        var next = pickBestSpatialCandidate(active, targets, dir);
        if (next) {
            ev.preventDefault();
            focusSpatialTarget(next);
            return true;
        }
        return false;
    }

    function clearStaleHtmlCaches() {
        try {
            if (window.caches && typeof window.caches.keys === 'function') {
                window.caches.keys().then(function (names) {
                    names.forEach(function (n) { window.caches.delete(n); });
                }).catch(function () {});
            }
            if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
                var swCleaned = localStorage.getItem('streamflix_sw_cleaned_v7');
                navigator.serviceWorker.getRegistrations().then(function (regs) {
                    regs.forEach(function (reg) {
                        if (!swCleaned && typeof reg.unregister === 'function') {
                            reg.unregister();
                        } else if (typeof reg.update === 'function') {
                            reg.update();
                        }
                    });
                    if (!swCleaned) {
                        localStorage.setItem('streamflix_sw_cleaned_v7', 'true');
                    }
                }).catch(function () {});
            }
        } catch (e) {}
    }

    // Public hooks used by the StreamFlix plugin configuration page
    window.__STREAMFLIX_VERSION__ = VERSION;
    window.__STREAMFLIX_OPEN_PROFILE_PICKER__ = function (manage) {
        state.manageMode = Boolean(manage);
        closeAccountDropdown();
        return fetchPublicConfig().then(function () {
            if (hasHouseholdAccess()) {
                renderProfilePickerGate();
            } else {
                renderGoogleAuthGate();
            }
        });
    };
    window.__STREAMFLIX_SWITCH_PROFILE__ = function (profileId) {
        return fetchPublicConfig().then(function () {
            var target = findProfileById(profileId);
            if (!target) {
                showToast('That profile no longer exists.', 'error');
                return;
            }
            if (!isGateOpen()) {
                renderProfilePickerGate();
            }
            handleSelectProfile(target);
        });
    };

    function bootstrap() {
        syncDeviceLayoutClasses();
        installJellyfin12FetchInterceptor();
        patchJellyfinApiClientMethods();
        installGlobalCardClickInterceptor();
        clearStaleHtmlCaches();
        fixBrokenJellyfinRoutes();
        installLifecycleWatchers();

        var oauth = extractGoogleOAuthResultFromUrl();
        if (oauth) {
            fetchPublicConfig().then(function () {
                if (!oauth.stateOk) {
                    takePendingProfileId();
                    renderGoogleAuthGate(null, 'That sign-in attempt couldn\'t be verified. Please try again.');
                } else if (oauth.error || !oauth.token) {
                    takePendingProfileId();
                    renderGoogleAuthGate(null, oauth.error === 'access_denied' ? 'Google sign-in was cancelled.' : ('Google sign-in failed (' + oauth.error + ').'));
                } else {
                    verifyGoogleAccessToken(oauth.token);
                }
            });
        } else {
            evaluateAuthAndProfileGate();
            fetchPublicConfig().then(function () {
                rerenderPickerIfOpen();
                evaluateAuthAndProfileGate();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
