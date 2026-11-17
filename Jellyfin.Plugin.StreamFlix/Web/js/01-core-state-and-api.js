/* ==========================================================================
   STREAMFLIX — Netflix-style UI for Jellyfin: server-verified Google & OIDC SSO,
   "Who's watching?" profiles, Guest Passes & Seerr (v0.9.8.0)
   ========================================================================== */
(function () {
    'use strict';

    if (window.__STREAMFLIX_BOOTSTRAPPED__) {
        return;
    }
    window.__STREAMFLIX_BOOTSTRAPPED__ = true;

    var VERSION = '0.9.8.0';
    // Household session issued by the server ({ token, authKind, providerName, email, username, userId, name, picture, isAdmin, guestPassId, lockedProfileId, expiresAt })
    var GOOGLE_KEY = 'streamflix_session_v7';
    var ADMIN_AUTH_KEY = 'streamflix_admin_auth_v1';
    var OAUTH_STATE_KEY = 'streamflix_oauth_state';
    var OIDC_PENDING_KEY = 'streamflix_oidc_pending_v1';
    var PENDING_PROFILE_KEY = 'streamflix_pending_profile';
    var PROFILE_KEY = 'streamflix_active_profile_v64';
    var TAB_PROFILE_KEY = 'streamflix_tab_profile_v1';
    var LEGACY_PROFILE_KEY = 'streamflix_active_profile_v63';
    var CACHED_CONFIG_KEY = 'streamflix_cached_config_v7';
    var CINEMA_HUB_PREF_KEY = 'streamflix_cinema_hub_enabled_v1';
    var NAV_PROFILE_PREF_PREFIX = 'streamflix_nav_prefs_v1_';
    var HUB_SWR_CACHE_PREFIX = 'streamflix_hub_swr_v1_';
    var NOTIF_SEEN_PREFIX = 'streamflix_notif_seen_v1_';
    var BEDTIME_UNLOCK_PREFIX = 'streamflix_bedtime_unlock_v1_';
    var AUTH_BUS_CHANNEL = 'streamflix_auth_bus_v1';
    var SHOWCASE_ITEMS_KEY = 'streamflix_showcase_items_v1';

    var APP_PHASES = {
        BOOTING: 'BOOTING',
        AUTH_REQUIRED: 'AUTH_REQUIRED',
        OIDC_PENDING: 'OIDC_PENDING',
        PICKER_REQUIRED: 'PICKER_REQUIRED',
        PICKER_OVERLAY: 'PICKER_OVERLAY',
        BEDTIME_LOCKED: 'BEDTIME_LOCKED',
        HUB_BROWSE: 'HUB_BROWSE',
        ADMIN_ROUTE: 'ADMIN_ROUTE',
        EMBEDDED_ADMIN: 'EMBEDDED_ADMIN',
        VIDEO_PLAYER: 'VIDEO_PLAYER'
    };

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
        assetVersion: '',
        serverId: '',
        serverName: 'StreamFlix',
        customBrandName: '',
        customAccentColor: '#E50914',
        enableStreamFlixUi: true,
        requireGoogleAuth: true,
        enableGoogleSignIn: true,
        enableCustomOidc: false,
        oidcConfigured: false,
        oidcProviderName: 'Single Sign-On',
        oidcRequireAllowlist: false,
        hasOidcClientSecret: false,
        allowStandardJellyfinLogin: false,
        allowAdminFallbackLogin: false,
        adminFallbackLanOnly: false,
        bypassLoginGateOnLan: false,
        isLocalLan: false,
        canShowAdminFallback: false,
        googleClientId: '',
        googleConfigured: false,
        hasGoogleClientSecret: false,
        hasAccess: false,
        isAdmin: false,
        enableGuestPasses: true,
        enableWatchTogether: true,
        hasAnyAdultPin: false,
        isGuestPass: false,
        guestPassLabel: '',
        guestPassExpiresAt: '',
        lockedProfileId: '',
        seerrEnabled: false,
        seerrAllowKids: false,
        seerrAllowGuests: false,
        session: null,
        top10SelectionMode: 'most_played',
        heroRotationSeconds: 9,
        heroSlideCount: 8,
        heroSelectionMode: 'recent',
        heroContentType: 'all',
        heroLibraryIds: [],
        showLibrariesInNav: true,
        navHiddenBuiltIns: [],
        navLibraryIds: [],
        approvedGoogleAccounts: [],
        approvedOidcUsers: [],
        serverUsers: [],
        serverLibraries: [],
        showcaseItems: [],
        profiles: []
    };

    var initialTabProfile = loadSessionJson(TAB_PROFILE_KEY, null);
    var initialActiveProfile = initialTabProfile || loadJson(PROFILE_KEY, null);
    if (initialActiveProfile && !initialTabProfile) {
        saveSessionJson(TAB_PROFILE_KEY, initialActiveProfile);
    }
    var legacyProfileToMigrate = !initialActiveProfile
        ? (loadJson(LEGACY_PROFILE_KEY, null) || loadJson('streamflix_active_profile_v5', null))
        : null;

    var state = {
        appPhase: APP_PHASES.BOOTING,
        config: loadJson(CACHED_CONFIG_KEY, null) || DEFAULT_CONFIG,
        googleUser: loadHouseholdSession(),
        configFresh: false,
        configAttempted: false,
        adminLoginExpanded: false,
        guestPassExpanded: false,
        heroPaused: false,
        heroPreviewMuted: true,
        heroVideoActive: false,
        heroVideoItemId: '',
        heroTrailerCache: {},
        notificationsOpen: false,
        notificationsLoadedForUser: '',
        notificationsLoading: false,
        notifications: [],
        hotTabExtra: {
            loading: false,
            loadedForUser: '',
            upcomingEpisodes: [],
            seerrComingSoon: []
        },
        activeProfile: initialActiveProfile,
        adminAuth: loadJson(ADMIN_AUTH_KEY, null),
        adminWarmAttempted: false,
        legacyProfileToMigrate: legacyProfileToMigrate,
        manageMode: false,
        explicitPickerOpen: false,
        openedDirectlyToManage: false,
        embeddedAdminModalOpen: false,
        noBackdropItemIds: {},
        verifyingGoogle: false,
        startingOidcRedirect: false,
        oidcPollInFlight: false,
        activatingProfileId: null,
        sessionVerifiedOnce: false,
        accountDropdownOpen: false,
        cinemaHubEnabled: loadJson(CINEMA_HUB_PREF_KEY, true) !== false,
        activeCategory: 'all',
        kidsWorld: 'all',
        mobileSearchOpen: false,
        searchQuery: '',
        searchDebounce: null,
        searchSeq: 0,
        searchResults: null,
        seerrSearchLoading: false,
        seerrSearchResults: null,
        seerrSearchAbort: null,
        seerrLocalAbort: null,
        seerrSubmittingMap: {},
        browseFilter: null,
        libraryBrowser: null,
        libraryBrowserSeq: 0,
        libraryViewData: {},
        lastSurpriseId: '',
        activeDetailModal: null,
        itemCache: {},
        hubData: {
            userId: null,
            loading: false,
            loaded: false,
            heroItems: [],
            filteredHeroPool: [],
            popularScores: {},
            resumeItems: [],
            nextUpItems: [],
            top10Items: [],
            favoriteItems: [],
            recentMovies: [],
            recentSeries: [],
            allMovies: [],
            allSeries: [],
            collectionsItems: [],
            totalMoviesCount: 0,
            totalSeriesCount: 0,
            totalCollectionsCount: 0,
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

    function loadSessionJson(key, fallback) {
        try {
            var raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function saveSessionJson(key, value) {
        try {
            if (value === null || value === undefined) {
                sessionStorage.removeItem(key);
            } else {
                sessionStorage.setItem(key, JSON.stringify(value));
            }
        } catch (e) {}
    }

    function saveActiveProfileState(profile, updateHouseholdDefault) {
        state.activeProfile = profile || null;
        saveSessionJson(TAB_PROFILE_KEY, state.activeProfile);
        if (updateHouseholdDefault !== false) {
            saveJson(PROFILE_KEY, state.activeProfile);
            if (state.activeProfile) {
                saveJson(LEGACY_PROFILE_KEY, state.activeProfile);
            } else {
                try { localStorage.removeItem(LEGACY_PROFILE_KEY); } catch (eL) {}
            }
        }
    }

    function clearActiveProfileState(clearHouseholdDefault) {
        state.activeProfile = null;
        saveSessionJson(TAB_PROFILE_KEY, null);
        if (clearHouseholdDefault !== false) {
            try {
                localStorage.removeItem(PROFILE_KEY);
                localStorage.removeItem(LEGACY_PROFILE_KEY);
            } catch (eC) {}
        }
    }

    var authBroadcastBus = null;
    var tabInstanceId = Math.random().toString(36).slice(2) + '_' + Date.now();
    try {
        if (typeof BroadcastChannel === 'function') {
            authBroadcastBus = new BroadcastChannel(AUTH_BUS_CHANNEL);
            authBroadcastBus.onmessage = function (ev) {
                var msg = ev && ev.data;
                if (!msg || typeof msg !== 'object' || msg.sender === tabInstanceId) {
                    return;
                }
                if (msg.type === 'auth_signout') {
                    if (typeof signOutHousehold === 'function') {
                        signOutHousehold({ skipServerLogout: true, silent: true, fromBroadcast: true });
                    }
                } else if (msg.type === 'config_updated') {
                    if (typeof fetchPublicConfig === 'function') {
                        fetchPublicConfig().catch(function () {});
                    }
                }
            };
        }
    } catch (eBus) {
        authBroadcastBus = null;
    }

    function broadcastAuthBusMessage(type, extra) {
        if (!authBroadcastBus) {
            return;
        }
        try {
            var payload = Object.assign({ type: type, sender: tabInstanceId, ts: Date.now() }, extra || {});
            authBroadcastBus.postMessage(payload);
        } catch (ePost) {}
    }

    function transitionAppPhase(nextPhase) {
        if (!nextPhase || state.appPhase === nextPhase) {
            return state.appPhase;
        }
        state.prevAppPhase = state.appPhase;
        state.appPhase = nextPhase;
        if (document.body) {
            document.body.setAttribute('data-bfx-phase', nextPhase);
        }
        return nextPhase;
    }

    function isUserProtectedOverlayPhase() {
        return state.appPhase === APP_PHASES.PICKER_OVERLAY
            || state.appPhase === APP_PHASES.EMBEDDED_ADMIN
            || Boolean(state.explicitPickerOpen)
            || Boolean(state.manageMode)
            || Boolean(state.embeddedAdminModalOpen);
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeCssUrl(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) {
            return '';
        }
        return s.replace(/[\r\n"'()\\]/g, function (ch) {
            return '%' + ('0' + ch.charCodeAt(0).toString(16)).slice(-2).toUpperCase();
        });
    }

    function cssEscape(val) {
        var s = String(val == null ? '' : val);
        if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(s);
        }
        return s.replace(/["\\#.:[\]()>+~*^$|/\s]/g, '\\$&');
    }

    function sanitizeClassNames(cls) {
        return String(cls == null ? '' : cls).replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
    }

    function sanitizeHeaderField(val) {
        return String(val == null ? '' : val).replace(/["\\\r\n]/g, '');
    }

    function putCachedItem(id, item) {
        if (!id || !item) {
            return;
        }
        if (!state.itemCache[id]) {
            var keys = Object.keys(state.itemCache);
            if (keys.length >= 500) {
                for (var i = 0; i < 100; i++) {
                    delete state.itemCache[keys[i]];
                }
            }
        }
        state.itemCache[id] = item;
    }

    function putAmbientCache(url, cssVal) {
        if (!url || !cssVal) {
            return;
        }
        if (!state.ambientCache[url]) {
            var keys = Object.keys(state.ambientCache);
            if (keys.length >= 100) {
                for (var i = 0; i < 25; i++) {
                    delete state.ambientCache[keys[i]];
                }
            }
        }
        state.ambientCache[url] = cssVal;
    }

    function applyLogoImgFallback(img, kind) {
        if (!img) {
            return;
        }
        if (kind === 'hero') {
            var h = img.parentNode;
            if (h) {
                h.classList.remove('streamflix-hero-title-has-logo');
                if (img.parentNode) {
                    img.parentNode.removeChild(img);
                }
            }
        } else if (kind === 'detail') {
            var w = img.parentNode;
            if (w) {
                w.classList.remove('has-logo');
                if (img.parentNode) {
                    img.parentNode.removeChild(img);
                }
            }
        } else if (kind === 'osd-pause') {
            var p = img.parentNode;
            if (p) {
                p.classList.remove('has-logo');
                p.textContent = img.getAttribute('alt') || '';
            }
        } else if (kind === 'preview') {
            var d = document.createElement('div');
            d.className = 'bfx-pv-title';
            d.textContent = img.getAttribute('alt') || '';
            if (img.parentNode) {
                img.parentNode.replaceChild(d, img);
            }
        }
    }

    function applyFadeImgError(img, errKind) {
        if (!img) {
            return;
        }
        if (errKind === 'broken') {
            img.classList.add('is-broken');
        } else if (errKind === 'dim') {
            img.classList.add('is-loaded');
            img.style.opacity = '0.18';
        } else if (errKind === 'hide') {
            img.style.visibility = 'hidden';
        } else {
            img.classList.add('is-broken');
        }
    }

    function hydrateCompleteImages(rootEl) {
        if (!rootEl || !rootEl.querySelectorAll) {
            return;
        }
        var imgs = rootEl.querySelectorAll('img[data-bfx-img="fade"], img[data-bfx-logo-fallback]');
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if (!img.complete) {
                continue;
            }
            if (img.naturalWidth > 0) {
                if (img.getAttribute('data-bfx-img') === 'fade') {
                    img.classList.add('is-loaded');
                }
            } else {
                var logoKind = img.getAttribute('data-bfx-logo-fallback');
                if (logoKind) {
                    applyLogoImgFallback(img, logoKind);
                } else if (img.getAttribute('data-bfx-img') === 'fade') {
                    applyFadeImgError(img, img.getAttribute('data-bfx-err') || 'broken');
                }
            }
        }
    }

    function installStrictCspImageHandlers() {
        if (window.__STREAMFLIX_CSP_IMG_HANDLERS__) {
            return;
        }
        window.__STREAMFLIX_CSP_IMG_HANDLERS__ = true;
        document.addEventListener('load', function (ev) {
            var t = ev && ev.target;
            if (t && t.tagName === 'IMG' && t.getAttribute('data-bfx-img') === 'fade') {
                t.classList.add('is-loaded');
            }
        }, true);
        document.addEventListener('error', function (ev) {
            var t = ev && ev.target;
            if (!t || t.tagName !== 'IMG') {
                return;
            }
            var logoKind = t.getAttribute('data-bfx-logo-fallback');
            if (logoKind) {
                applyLogoImgFallback(t, logoKind);
                return;
            }
            if (t.getAttribute('data-bfx-img') === 'fade') {
                applyFadeImgError(t, t.getAttribute('data-bfx-err') || 'broken');
            }
        }, true);
    }

    function mountSanitizedQrSvg(containerEl, svgMarkup) {
        if (!containerEl) {
            return;
        }
        while (containerEl.firstChild) {
            containerEl.removeChild(containerEl.firstChild);
        }
        if (!svgMarkup || typeof DOMParser === 'undefined') {
            return;
        }
        try {
            var doc = new DOMParser().parseFromString(String(svgMarkup), 'image/svg+xml');
            var svg = doc && doc.documentElement;
            if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
                return;
            }
            var allowedTags = { svg: 1, rect: 1, path: 1, g: 1 };
            var allowedAttrs = {
                xmlns: 1, viewbox: 1, 'shape-rendering': 1, role: 1, 'aria-label': 1,
                width: 1, height: 1, fill: 1, d: 1, x: 1, y: 1, rx: 1, ry: 1
            };
            var cleanNode = function (el) {
                var children = Array.prototype.slice.call(el.childNodes);
                for (var i = 0; i < children.length; i++) {
                    var c = children[i];
                    if (c.nodeType === 1) {
                        var tag = c.nodeName.toLowerCase();
                        if (!allowedTags[tag]) {
                            el.removeChild(c);
                            continue;
                        }
                        var attrs = Array.prototype.slice.call(c.attributes);
                        for (var a = 0; a < attrs.length; a++) {
                            if (!allowedAttrs[attrs[a].name.toLowerCase()]) {
                                c.removeAttribute(attrs[a].name);
                            }
                        }
                        cleanNode(c);
                    } else if (c.nodeType !== 3) {
                        el.removeChild(c);
                    }
                }
            };
            var rootAttrs = Array.prototype.slice.call(svg.attributes);
            for (var r = 0; r < rootAttrs.length; r++) {
                if (!allowedAttrs[rootAttrs[r].name.toLowerCase()]) {
                    svg.removeAttribute(rootAttrs[r].name);
                }
            }
            cleanNode(svg);
            containerEl.appendChild(document.importNode(svg, true));
        } catch (e) {}
    }

    function copyTextToClipboard(text, okMessage) {
        var str = String(text || '');
        if (!str) {
            return Promise.resolve(false);
        }
        var notify = function (ok) {
            if (ok && okMessage) {
                showToast(okMessage, 'success', 2200);
            }
            return ok;
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(str).then(function () {
                return notify(true);
            }).catch(function () {
                return notify(fallbackCopyText(str));
            });
        }
        return Promise.resolve(notify(fallbackCopyText(str)));
    }

    function fallbackCopyText(str) {
        try {
            var ta = document.createElement('textarea');
            ta.value = str;
            ta.setAttribute('readonly', 'readonly');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            var ok = Boolean(document.execCommand('copy'));
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            return false;
        }
    }

    function formatRelativeExpiry(isoStr) {
        if (!isoStr) {
            return '';
        }
        var ms = Date.parse(isoStr);
        if (isNaN(ms)) {
            return '';
        }
        var diff = ms - Date.now();
        if (diff <= 0) {
            return 'Expired';
        }
        var mins = Math.ceil(diff / 60000);
        if (mins < 60) {
            return mins + 'm left';
        }
        var hrs = Math.round(diff / 3600000);
        if (hrs < 48) {
            return hrs + 'h left';
        }
        var days = Math.round(diff / 86400000);
        return days + 'd left';
    }

    function formatRelativePast(isoStr) {
        if (!isoStr) {
            return '';
        }
        var ms = Date.parse(isoStr);
        if (isNaN(ms)) {
            return '';
        }
        var diff = Date.now() - ms;
        if (diff < 45000) {
            return 'Just now';
        }
        var mins = Math.floor(diff / 60000);
        if (mins < 60) {
            return mins + 'm ago';
        }
        var hrs = Math.floor(diff / 3600000);
        if (hrs < 24) {
            return hrs + 'h ago';
        }
        var days = Math.floor(diff / 86400000);
        if (days < 30) {
            return days + 'd ago';
        }
        try {
            return new Date(ms).toLocaleDateString();
        } catch (e) {
            return days + 'd ago';
        }
    }

    function canUsePhoneNativeShare() {
        try {
            if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
                return false;
            }
            if (isTvOrDpadActive() || detectTvEnvironment()) {
                return false;
            }
            var docEl = document.documentElement;
            if (docEl && (docEl.classList.contains('layout-tv') || docEl.classList.contains('layout-desktop'))) {
                return false;
            }
            var ua = navigator.userAgent || '';
            if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
                return navigator.userAgentData.mobile === true;
            }
            if (/iPad|Tablet|PlayBook|Silk|Macintosh|Windows NT|CrOS/i.test(ua)) {
                return false;
            }
            return /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile.*Firefox|IEMobile/i.test(ua);
        } catch (e) {
            return false;
        }
    }

    function resolveClientGuestShareUrl(code, fallbackUrl) {
        var cleanCode = String(code || '').trim();
        if (cleanCode && window.location && window.location.origin) {
            try {
                if (window.ApiClient && typeof window.ApiClient.getUrl === 'function') {
                    return new URL(window.ApiClient.getUrl('StreamFlix/Guest/' + encodeURIComponent(cleanCode)), window.location.origin).href;
                }
            } catch (eUrl) {}
            var basePath = String((window.location && window.location.pathname) || '').replace(/\/web\/?(index\.html)?$/i, '');
            return window.location.origin + basePath.replace(/\/$/, '') + '/StreamFlix/Guest/' + encodeURIComponent(cleanCode);
        }
        return String(fallbackUrl || '').trim();
    }

    function triggerPhoneGuestPassShare(opts) {
        opts = opts || {};
        var url = resolveClientGuestShareUrl(opts.code, opts.shareUrl);
        if (!url) {
            showToast('Invite link is not ready yet.', 'error');
            return;
        }
        var shareBrand = getBrandName();
        var shareTitle = (opts.label || 'Guest Pass') + ' — ' + shareBrand;
        var shareText = 'Join ' + shareBrand + ' on the "' + (opts.profileName || 'Guest') + '" profile'
            + (opts.code ? ' (TV Pass Code: ' + opts.code + ')' : '') + ':';

        if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
            copyTextToClipboard(url).then(function (ok) {
                showToast(ok ? 'Invite link copied to clipboard.' : 'Could not open phone share sheet.', ok ? 'success' : 'error');
            });
            return;
        }

        var payload = { title: shareTitle, text: shareText, url: url };
        if (typeof navigator.canShare === 'function') {
            try {
                if (!navigator.canShare(payload)) {
                    if (navigator.canShare({ title: shareTitle, url: url })) {
                        payload = { title: shareTitle, url: url };
                    } else if (navigator.canShare({ url: url })) {
                        payload = { url: url };
                    } else {
                        payload = { title: shareTitle, text: shareText + ' ' + url };
                    }
                }
            } catch (eCan) {}
        }

        try {
            navigator.share(payload).catch(function (err) {
                if (err && err.name === 'AbortError') {
                    return;
                }
                copyTextToClipboard(url).then(function (ok) {
                    showToast(ok ? 'Invite link copied to clipboard.' : 'Could not share invite link.', ok ? 'success' : 'error');
                });
            });
        } catch (eShare) {
            copyTextToClipboard(url).then(function (ok) {
                showToast(ok ? 'Invite link copied to clipboard.' : 'Could not share invite link.', ok ? 'success' : 'error');
            });
        }
    }

    /* Inline stroke icons (inherit currentColor) used across the modern UI */
    var ICON_PATHS = {
        play: '<path d="M7 4.6v14.8a1 1 0 0 0 1.53.85l11.6-7.4a1 1 0 0 0 0-1.7L8.53 3.75A1 1 0 0 0 7 4.6z" fill="currentColor" stroke="none"/>',
        pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
        eyeOff: '<path d="M3 3l18 18M10.6 10.6a2.8 2.8 0 0 0 3.9 3.9M9.9 5.6A9.8 9.8 0 0 1 12 5.4c6 0 9.5 6.6 9.5 6.6a16.8 16.8 0 0 1-3.1 4.1M6.3 6.3A16.5 16.5 0 0 0 2.5 12S6 18.6 12 18.6c1.8 0 3.4-.5 4.8-1.3"/>',
        user: '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
        wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none"/>',
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
        undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
        ticket: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.2a2 2 0 0 0 0 3.6V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.2a2 2 0 0 0 0-3.6V8z"/><path d="M9.5 6v12" stroke-dasharray="2.5 2.5"/>',
        qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM18 18h2.5v2.5H18zM18 14h2.5M14 18.5v2"/>',
        trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4.5a1.5 1.5 0 0 0-1.5 1.5v.5a3.5 3.5 0 0 0 3.5 3.5H7M17 6h2.5A1.5 1.5 0 0 1 21 7.5v.5a3.5 3.5 0 0 1-3.5 3.5H17"/><path d="M12 14v4M8.5 20h7"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
        share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>',
        smartphone: '<rect x="6" y="2.5" width="12" height="19" rx="2.4"/><path d="M11 18.2h2"/>',
        laptop: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8"/><path d="M2 19h20"/>',
        refresh: '<path d="M20 11a8 8 0 1 0 2 5.3"/><path d="M20 4v7h-7"/>',
        download: '<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
        dockHome: '<path d="M4.5 10.6L11.1 4.8a1.4 1.4 0 0 1 1.8 0l6.6 5.8c.32.28.5.68.5 1.1V18a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 18v-6.3c0-.42.18-.82.5-1.1z"/><path d="M9.4 16.8h5.2"/>',
        dockHot: '<rect x="3.4" y="6.2" width="14.2" height="11.6" rx="2.4"/><path d="M7.2 3.4h11.2a2.2 2.2 0 0 1 2.2 2.2v9.4"/><path d="M9.1 9.6v4.8l4.1-2.4z" fill="currentColor" stroke="none"/>',
        dockSearch: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M19.8 19.8l-4.1-4.1"/>',
        bookmark: '<path d="M6.2 4.2h11.6a1.3 1.3 0 0 1 1.3 1.3v14.8L12 16l-7.1 4.3V5.5a1.3 1.3 0 0 1 1.3-1.3z"/>',
        bell: '<path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.6 8.2-2.6 8.2h17.2S18 15 18 8.5z"/><path d="M13.8 20a2 2 0 0 1-3.6 0"/>',
        moon: '<path d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11z"/>',
        seerrIcon: '<path d="M7.2 18.2h9.6a3.7 3.7 0 0 0 .55-7.36A5.2 5.2 0 0 0 7.1 9.4a3.5 3.5 0 0 0 .1 8.8z"/><path d="M12 10.6v5.2M9.4 13.2h5.2"/>'
    };

    function icon(name, extraClass) {
        var safeExtra = extraClass ? sanitizeClassNames(extraClass) : '';
        return '<svg class="bfx-icon' + (safeExtra ? ' ' + safeExtra : '') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"'
            + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON_PATHS[name] || '') + '</svg>';
    }

    function iconLabel(name, text) {
        return icon(name) + '<span>' + escapeHtml(text) + '</span>';
    }

    function getBrandName() {
        var custom = state.config && typeof state.config.customBrandName === 'string'
            ? state.config.customBrandName.trim()
            : '';
        return custom || 'StreamFlix';
    }

    function getBrandLogoText() {
        return getBrandName().toUpperCase();
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

    function isSafeSameOriginUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') {
            return false;
        }
        var trimmed = urlStr.trim();
        if (!trimmed || trimmed.indexOf('//') === 0) {
            return false;
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^https?:/i.test(trimmed)) {
            return false;
        }
        try {
            var resolved = new URL(trimmed, window.location.origin);
            if (resolved.origin === window.location.origin) {
                return true;
            }
            var base = apiBase();
            if (base) {
                var baseOrigin = new URL(base, window.location.origin).origin;
                if (resolved.origin === baseOrigin) {
                    return true;
                }
            }
        } catch (e) {}
        return false;
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
        var cleanTok = sanitizeHeaderField(token);
        var header = 'MediaBrowser Client="' + sanitizeHeaderField(dev.appName)
            + '", Device="' + sanitizeHeaderField(dev.deviceName)
            + '", DeviceId="' + sanitizeHeaderField(dev.deviceId)
            + '", Version="' + sanitizeHeaderField(dev.appVersion) + '"';
        if (cleanTok) {
            header += ', Token="' + cleanTok + '"';
        }
        return header;
    }

    function isAdminRouteHash() {
        if (state.embeddedAdminModalOpen) {
            return true;
        }
        var h = (window.location.hash || '').toLowerCase();
        return h.indexOf('configurationpage') !== -1
            || h.indexOf('dashboard') !== -1
            || h.indexOf('#/metadata') === 0
            || h.indexOf('#!/metadata') === 0;
    }

    function saveAdminAuth(authObj) {
        if (!authObj || !authObj.accessToken || !authObj.userId) {
            return;
        }
        var clean = {
            userId: String(authObj.userId),
            userName: String(authObj.userName || (authObj.user && (authObj.user.Name || authObj.user.name)) || 'Administrator'),
            accessToken: String(authObj.accessToken),
            serverId: String(authObj.serverId || (state.config && state.config.serverId) || ''),
            user: authObj.user || {
                Id: String(authObj.userId),
                Name: String(authObj.userName || 'Administrator'),
                Policy: { IsAdministrator: true }
            }
        };
        if (!clean.user.Policy && clean.user.policy) {
            clean.user.Policy = clean.user.policy;
        }
        if (!clean.user.Policy) {
            clean.user.Policy = { IsAdministrator: true };
        } else {
            clean.user.Policy.IsAdministrator = true;
        }
        state.adminAuth = clean;
        saveJson(ADMIN_AUTH_KEY, clean);
    }

    function clearAdminAuth() {
        state.adminAuth = null;
        state.adminWarmAttempted = false;
        saveJson(ADMIN_AUTH_KEY, null);
    }

    function getActiveAdminAuthForRoute() {
        if (!isAdminRouteHash()) {
            return null;
        }
        if ((state.config && state.config.isGuestPass) || (state.googleUser && state.googleUser.authKind === 'guest_pass')) {
            return null;
        }
        if (state.adminAuth && state.adminAuth.accessToken && state.adminAuth.userId) {
            return state.adminAuth;
        }
        return null;
    }

    function getActiveToken() {
        var adm = getActiveAdminAuthForRoute();
        if (adm) {
            return adm.accessToken;
        }
        return (state.activeProfile && state.activeProfile.accessToken)
            || (window.ApiClient && typeof window.ApiClient.accessToken === 'function' ? window.ApiClient.accessToken() : null);
    }

    function getActiveUserId() {
        var adm = getActiveAdminAuthForRoute();
        if (adm) {
            return adm.userId;
        }
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
        var token = sanitizeHeaderField(getActiveToken());
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
                            putCachedItem(list[i].Id, list[i]);
                        }
                    }
                }
            } else if (payload.Id && !payload.ServerId) {
                payload.ServerId = sid;
                putCachedItem(payload.Id, payload);
            }
        } catch (e) {}
        return payload;
    }

    var CLIENT_ERROR_CODE_MAP = {
        google_required: 'SF-AUTH-101',
        jellyfin_auth_required: 'SF-AUTH-110',
        invalid_credentials: 'SF-AUTH-102',
        login_locked: 'SF-AUTH-103',
        google_disabled: 'SF-AUTH-104',
        google_unverified: 'SF-AUTH-105',
        not_approved: 'SF-AUTH-106',
        standard_login_disabled: 'SF-AUTH-107',
        admin_fallback_disabled: 'SF-AUTH-108',
        lan_only: 'SF-AUTH-108',
        oidc_disabled: 'SF-OIDC-201',
        oidc_unconfigured: 'SF-OIDC-201',
        oidc_discovery_failed: 'SF-OIDC-202',
        oidc_state_invalid: 'SF-OIDC-203',
        oidc_handoff_expired: 'SF-OIDC-203',
        oidc_exchange_failed: 'SF-OIDC-204',
        oidc_not_approved: 'SF-OIDC-205',
        oidc_poll_invalid: 'SF-OIDC-206',
        profile_not_found: 'SF-PROF-300',
        profile_unlinked: 'SF-PROF-301',
        auth_failed: 'SF-PROF-302',
        user_disabled: 'SF-PROF-303',
        google_locked: 'SF-PROF-304',
        google_lock_forbidden: 'SF-PROF-304',
        admin_link_forbidden: 'SF-PROF-305',
        link_change_forbidden: 'SF-PROF-305',
        invalid_link: 'SF-PROF-306',
        pin_required: 'SF-PIN-310',
        adult_pin_required: 'SF-PIN-311',
        pin_invalid: 'SF-PIN-312',
        pin_locked: 'SF-PIN-313',
        seerr_forbidden: 'SF-SEERR-401',
        seerr_unreachable: 'SF-SEERR-402',
        seerr_timeout: 'SF-SEERR-403',
        seerr_request_failed: 'SF-SEERR-404',
        seerr_cancel_failed: 'SF-SEERR-404',
        seerr_quota_exceeded: 'SF-SEERR-405',
        rate_limited: 'SF-SEERR-406',
        guest_passes_disabled: 'SF-GUEST-501',
        guest_invalid: 'SF-GUEST-502',
        guest_expired: 'SF-GUEST-502',
        guest_handoff_missing: 'SF-GUEST-502',
        guest_locked: 'SF-GUEST-503',
        guest_pass_restricted: 'SF-GUEST-504',
        guest_profile_locked: 'SF-GUEST-504',
        guest_admin_forbidden: 'SF-GUEST-505',
        admin_required: 'SF-ADMIN-601',
        room_not_found: 'SF-WP-622',
        host_only: 'SF-WP-621',
        watch_party_disabled: 'SF-WP-621'
    };

    function resolveStreamFlixErrorCode(status, symbolicCode, path) {
        var sym = String(symbolicCode || '').trim().toLowerCase();
        if (sym && CLIENT_ERROR_CODE_MAP[sym]) {
            return CLIENT_ERROR_CODE_MAP[sym];
        }
        var p = String(path || '').toLowerCase();
        if (p.indexOf('/seerr/') !== -1) {
            if (status === 504) { return 'SF-SEERR-403'; }
            if (status === 429) { return 'SF-SEERR-405'; }
            if (status === 403) { return 'SF-SEERR-401'; }
            return status >= 500 ? 'SF-SEERR-402' : 'SF-SEERR-404';
        }
        if (p.indexOf('/oidc/') !== -1) {
            return (status === 401 || status === 403) ? 'SF-OIDC-205' : 'SF-OIDC-204';
        }
        if (p.indexOf('/guest') !== -1) {
            return status === 429 ? 'SF-GUEST-503' : 'SF-GUEST-502';
        }
        if (p.indexOf('/watchparty') !== -1) {
            return status === 404 ? 'SF-WP-622' : 'SF-WP-620';
        }
        if (p.indexOf('/profiles') !== -1) {
            if (status === 409) { return 'SF-PROF-301'; }
            if (status === 429) { return 'SF-PIN-313'; }
            if (status === 404) { return 'SF-PROF-300'; }
            return 'SF-PROF-306';
        }
        if (p.indexOf('/hub/bootstrap') !== -1) {
            return status === 401 ? 'SF-AUTH-101' : 'SF-HUB-701';
        }
        if (status === 400) { return 'SF-REQ-740'; }
        if (status === 401) { return 'SF-AUTH-101'; }
        if (status === 403) { return 'SF-REQ-743'; }
        if (status === 404) { return 'SF-REQ-744'; }
        if (status === 429) { return 'SF-REQ-749'; }
        return status >= 500 ? 'SF-SRV-750' : '';
    }

    function isPromptOnlyErrorCode(symbolicCode) {
        var c = String(symbolicCode || '').toLowerCase();
        return c === 'google_required' || c === 'pin_required' || c === 'adult_pin_required';
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
                    var symCode = (parsed && parsed.code) || '';
                    var sfCode = (parsed && parsed.errorCode) || resolveStreamFlixErrorCode(res.status, symCode, path);
                    var displayMsg = msg;
                    if (sfCode && !isPromptOnlyErrorCode(symCode) && displayMsg.indexOf(sfCode) === -1) {
                        displayMsg = displayMsg + ' (' + sfCode + ')';
                    }
                    var err = new Error(displayMsg);
                    err.rawMessage = msg;
                    err.status = res.status;
                    err.code = symCode;
                    err.errorCode = sfCode;
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
                var safePidSel = cssEscape(parentId);
                var links = document.querySelectorAll('a[href*="' + safePidSel + '"], [data-id="' + safePidSel + '"]');
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
