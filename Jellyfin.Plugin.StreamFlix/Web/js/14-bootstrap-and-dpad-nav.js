/* StreamFlix Client (14/14) — Lifecycle Bootstrap, Device Detection & Spatial D-Pad Navigation */
    /* ----------------------------------------------------------------------
       8. Bootstrap & Event-Driven Lifecycle (no fixed-rate polling)
       ---------------------------------------------------------------------- */
    var configFetchInFlight = null;
    var lastConfigFetchAt = 0;

    function teardownStreamFlixUi() {
        try {
            clearUserPreferencesEnhancements();
        } catch (ePref) {}
        try {
            if (state.heroTimer) {
                clearInterval(state.heroTimer);
                state.heroTimer = null;
            }
            if (document.body) {
                [
                    'bfx-active',
                    'streamflix-gate-locked',
                    'streamflix-hub-filtered',
                    'streamflix-hub-active',
                    'streamflix-modal-open',
                    'streamflix-on-home',
                    'streamflix-on-details-page',
                    'streamflix-scrolled',
                    'bfx-admin-route',
                    'bfx-classic-home',
                    'bfx-settings-route',
                    'bfx-settings-subpage',
                    'bfx-kids-mode',
                    'bfx-tv-mode'
                ].forEach(function (cls) {
                    document.body.classList.remove(cls);
                });
            }
            [
                '#streamflix-overlay-root',
                '#streamflix-overlay-root-closing',
                '#streamflix-cinema-hub',
                '#streamflix-header-profile-btn',
                '#streamflix-account-dropdown',
                '#bfx-fixed-corner-brand',
                '#streamflix-mobile-dock',
                '#streamflix-playback-loader'
            ].forEach(function (sel) {
                var el = document.querySelector(sel);
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            });
            Array.prototype.forEach.call(document.querySelectorAll('.streamflix-modal-backdrop'), function (mEl) {
                if (mEl && mEl.parentNode) {
                    mEl.parentNode.removeChild(mEl);
                }
            });
            Array.prototype.forEach.call(document.querySelectorAll('[data-streamflix-corner-brand="true"]'), function (bEl) {
                bEl.removeAttribute('data-streamflix-corner-brand');
            });
            if (state.pluginDisabled) {
                Array.prototype.forEach.call(document.querySelectorAll('link[href*="/StreamFlix/ClientStyles"]'), function (lnk) {
                    lnk.disabled = true;
                });
            }
        } catch (eTd) {}
    }

    function fetchPublicConfig() {
        if (configFetchInFlight) {
            return configFetchInFlight;
        }
        lastConfigFetchAt = Date.now();
        configFetchInFlight = apiFetch('/StreamFlix/PublicConfig').then(function (cfg) {
            applyConfigFromServerResponse(cfg);
            return state.config;
        }).catch(function (err) {
            state.configAttempted = true;
            if (err && err.status === 404) {
                state.pluginDisabled = true;
                try { localStorage.removeItem(CACHED_CONFIG_KEY); } catch (eRm) {}
                teardownStreamFlixUi();
            }
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
                clearActiveProfileState(false);
                scheduleLifecycleTick(0);
                return null;
            }
            if (!res.ok) {
                return null;
            }
            return res.json();
        }).then(function (userDto) {
            if (userDto && state.activeProfile) {
                var pol = userDto.Policy || userDto.policy;
                if (pol && (pol.IsAdministrator === true || pol.isAdministrator === true) && !isGuestPassSession()) {
                    saveAdminAuth({
                        userId: state.activeProfile.jellyfinUserId,
                        userName: userDto.Name || userDto.name || state.activeProfile.jellyfinUsername || 'Administrator',
                        accessToken: state.activeProfile.accessToken,
                        serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                        user: userDto
                    });
                }
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
        if (!isStreamFlixRuntimeEnabled()) {
            teardownStreamFlixUi();
            return;
        }

        if (document.body) {
            document.body.classList.add('bfx-active');
        }

        installJellyfin12FetchInterceptor();
        patchJellyfinApiClientMethods();
        fixBrokenJellyfinRoutes();

        if (state.verifyingGoogle || state.activatingProfileId) {
            return;
        }

        ensureHeaderWidgets();

        if (state.embeddedAdminModalOpen) {
            transitionAppPhase(APP_PHASES.EMBEDDED_ADMIN);
            return;
        }

        if (isAdminConfigRoute()) {
            state.wasOnAdminRoute = true;
            transitionAppPhase(APP_PHASES.ADMIN_ROUTE);
            if (typeof removeBedtimeLockOverlay === 'function') {
                removeBedtimeLockOverlay();
            }
            clearUserPreferencesEnhancements();
            var existingHubOnAdmin = document.getElementById('streamflix-cinema-hub');
            if (existingHubOnAdmin) {
                existingHubOnAdmin.style.display = 'none';
            }
            if (document.body) {
                document.body.classList.remove('streamflix-hub-filtered', 'streamflix-hub-active');
            }
            if (isGuestPassSession()) {
                window.location.hash = '#/home';
                return;
            }
            if (state.adminAuth && state.adminAuth.accessToken && state.adminAuth.userId) {
                var admUnderlying = typeof getUnderlyingApiClientAuth === 'function' ? getUnderlyingApiClientAuth() : null;
                if (!admUnderlying || !admUnderlying.loggedIn || normalizeGuid(admUnderlying.userId) !== normalizeGuid(state.adminAuth.userId) || admUnderlying.accessToken !== state.adminAuth.accessToken) {
                    applyJellyfinServerCredentials({
                        serverId: state.adminAuth.serverId || (state.config && state.config.serverId),
                        userId: state.adminAuth.userId,
                        accessToken: state.adminAuth.accessToken,
                        user: state.adminAuth.user || null
                    });
                }
            } else if (state.activeProfile && state.activeProfile.isAdmin && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
                saveAdminAuth({
                    userId: state.activeProfile.jellyfinUserId,
                    userName: state.activeProfile.jellyfinUsername || state.activeProfile.name || 'Administrator',
                    accessToken: state.activeProfile.accessToken,
                    serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                    user: state.activeProfile.user || null
                });
                applyJellyfinServerCredentials({
                    serverId: state.adminAuth.serverId || (state.config && state.config.serverId),
                    userId: state.adminAuth.userId,
                    accessToken: state.adminAuth.accessToken,
                    user: state.adminAuth.user || null
                });
            } else if (isProfileManagementAdmin()
                && typeof isCurrentJellyfinClientAdmin === 'function'
                && !isCurrentJellyfinClientAdmin()
                && (!state.lastAutoAdminElevateAt || Date.now() - state.lastAutoAdminElevateAt > 8000)) {
                state.lastAutoAdminElevateAt = Date.now();
                openStreamFlixAdminRoute(window.location.hash || '#/dashboard');
                return;
            } else if (state.configFresh
                && !(typeof isCurrentJellyfinClientAdmin === 'function' && isCurrentJellyfinClientAdmin())
                && !isProfileManagementAdmin()) {
                showToast('Switch to an Administrator profile first to open the Server Dashboard.', 'error');
                window.location.hash = '#/home';
                return;
            }
            if (isGateOpen() && !isUserProtectedOverlayPhase() && hasHouseholdAccess() && getActiveToken()) {
                closeOverlayGate();
            }
            return;
        }

        // Bug fix: when returning from Dashboard / Plugin Settings to Home on a non-admin profile,
        // immediately restore the active profile's Jellyfin credentials so the tab doesn't stay logged in as Admin.
        if (state.wasOnAdminRoute) {
            state.wasOnAdminRoute = false;
            if (state.activeProfile && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
                applyJellyfinServerCredentials({
                    serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                    userId: state.activeProfile.jellyfinUserId,
                    accessToken: state.activeProfile.accessToken,
                    user: null
                });
            }
        }

        var onJellyfinLoginPage = isOnJellyfinLoginPage();

        if (!hasHouseholdAccess()) {
            state.explicitPickerOpen = false;
            state.openedDirectlyToManage = false;
            if (typeof removeBedtimeLockOverlay === 'function') {
                removeBedtimeLockOverlay();
            }
            clearUserPreferencesEnhancements();
            var hasPendingOidc = typeof loadPendingOidcFlow === 'function' && Boolean(loadPendingOidcFlow());
            transitionAppPhase(hasPendingOidc ? APP_PHASES.OIDC_PENDING : APP_PHASES.AUTH_REQUIRED);
            var stage = document.getElementById('streamflix-stage');
            var view = stage ? String(stage.getAttribute('data-view') || '') : '';
            var validAuthView = !state.configAttempted
                ? (view === 'loading')
                : (view.indexOf('auth') === 0 || view === 'setup');
            if (!isGateOpen() || !validAuthView) {
                renderGoogleAuthGate();
            }
            return;
        }
        // If upgrading from v5/v6.3, re-activate the previously selected profile on the server so it gets a fresh token
        if (!state.activeProfile && state.legacyProfileToMigrate && getProfiles().length > 0 && !state.explicitPickerOpen) {
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
                clearActiveProfileState(true);
            } else if (sp) {
                state.activeProfile.name = sp.name || state.activeProfile.name;
                state.activeProfile.color = sp.color || state.activeProfile.color;
                state.activeProfile.icon = sp.icon || state.activeProfile.icon;
                state.activeProfile.isKids = Boolean(sp.isKids);
                state.activeProfile.kidsExitPinRequired = sp.kidsExitPinRequired !== false;
                state.activeProfile.isAdmin = Boolean(sp.isAdmin);
                state.activeProfile.autoplayNextEpisode = sp.autoplayNextEpisode !== false;
                state.activeProfile.autoplayPreviews = sp.autoplayPreviews !== false;
                state.activeProfile.bedtimeStart = sp.bedtimeStart || '';
                state.activeProfile.bedtimeEnd = sp.bedtimeEnd || '';
                state.activeProfile.allowedLibraryIds = Array.isArray(sp.allowedLibraryIds) ? sp.allowedLibraryIds.slice() : [];
                state.activeProfile.seerrRequestQuota = typeof sp.seerrRequestQuota === 'number' ? sp.seerrRequestQuota : 0;
                state.activeProfile.jellyfinUsername = sp.jellyfinUsername || state.activeProfile.jellyfinUsername;
                saveSessionJson(TAB_PROFILE_KEY, state.activeProfile);
                if (!state.explicitPickerOpen
                    && !state.manageMode
                    && !isGateOpen()
                    && sp.jellyfinUserId
                    && normalizeGuid(sp.jellyfinUserId) !== normalizeGuid(state.activeProfile.jellyfinUserId)
                    && !sp.hasPin
                    && sp.googleLockSatisfied) {
                    activateServerProfile(sp, '').catch(function () {});
                    return;
                }
            }
        }

        if (!state.activeProfile || !state.activeProfile.id || !state.activeProfile.accessToken || onJellyfinLoginPage) {
            if (typeof removeBedtimeLockOverlay === 'function') {
                removeBedtimeLockOverlay();
            }
            clearUserPreferencesEnhancements();
            transitionAppPhase(APP_PHASES.PICKER_REQUIRED);
            var pickerStage = document.getElementById('streamflix-stage');
            var pickerView = pickerStage && pickerStage.getAttribute('data-view');
            if (!isGateOpen() || !pickerView || pickerView.indexOf('picker') !== 0) {
                renderProfilePickerGate();
            }
            return;
        }

        if (window.ApiClient) {
            var rawSrv = window.ApiClient._serverInfo || {};
            var currentToken = rawSrv.AccessToken
                || (typeof window.ApiClient.__origAccessToken === 'function' ? window.ApiClient.__origAccessToken() : null);
            var currentUserId = rawSrv.UserId
                || (typeof window.ApiClient.__origGetCurrentUserId === 'function' ? window.ApiClient.__origGetCurrentUserId() : null);
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
        if (typeof warmAdminAuthSilently === 'function') {
            warmAdminAuthSilently();
        }
        installGlobalCardClickInterceptor();

        if (!isGateOpen()) {
            if (typeof enforceBedtimeLockOverlay === 'function' && enforceBedtimeLockOverlay()) {
                transitionAppPhase(APP_PHASES.BEDTIME_LOCKED);
                return;
            }
            transitionAppPhase(isVideoPlayerActive() ? APP_PHASES.VIDEO_PLAYER : APP_PHASES.HUB_BROWSE);
            ensureHeaderWidgets();
            enhanceItemDetailPage();
            enhanceLibraryListPages();
            enhanceUserPreferencesPages();
            if (isOnHomeRoute()) {
                ensureCinemaHubMounted();
            }
            if (typeof processPendingWatchPartyIfReady === 'function') {
                processPendingWatchPartyIfReady();
            }
        } else {
            transitionAppPhase(APP_PHASES.PICKER_OVERLAY);
            clearUserPreferencesEnhancements();
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

    var OWN_UI_SELECTOR = '#streamflix-overlay-root, #streamflix-overlay-root-closing, #streamflix-cinema-hub, #streamflix-account-dropdown, #streamflix-notif-dropdown, '
        + '#streamflix-header-profile-btn, #streamflix-header-bell-btn, #bfx-exit-kids-btn, #bfx-kids-brand-pill, #bfx-bedtime-lock-overlay, #bfx-embedded-admin-modal, #streamflix-mobile-dock, #streamflix-toast-host, .streamflix-modal-backdrop, #streamflix-library-page-fallback, #bfx-hover-preview, '
        + '#streamflix-osd-episodes, #streamflix-osd-tracks, #streamflix-osd-upnext, #streamflix-osd-paused, #streamflix-osd-flash, #bfx-wp-osd-banner, #bfx-wp-autoplay-unlock';

    function isOwnNode(node) {
        if (!node) {
            return false;
        }
        var el = node.nodeType === 1 ? node : node.parentNode;
        if (!el || el.nodeType !== 1) {
            return false;
        }
        var cls = String((el.getAttribute && el.getAttribute('class')) || '');
        if ((el.id && (el.id.indexOf('streamflix') === 0 || el.id.indexOf('bfx-') === 0))
            || cls.indexOf('streamflix-') !== -1
            || cls.indexOf('bfx-') !== -1) {
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
        window.addEventListener('pageshow', function (ev) {
            if (ev && ev.persisted && state.startingOidcRedirect) {
                state.startingOidcRedirect = false;
                if (!hasHouseholdAccess()) {
                    renderGoogleAuthGate();
                }
            }
            if (typeof pollPendingOidcFlowIfActive === 'function') {
                pollPendingOidcFlowIfActive();
            }
            scheduleLifecycleTick(0);
        });
        window.addEventListener('focus', function () {
            if (typeof pollPendingOidcFlowIfActive === 'function') {
                pollPendingOidcFlowIfActive();
            }
            scheduleLifecycleTick(0);
        });
        document.addEventListener('viewshow', function () { scheduleLifecycleTick(0); }, true);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                if (typeof pollPendingOidcFlowIfActive === 'function') {
                    pollPendingOidcFlowIfActive();
                }
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
            if (isRemoteBackEvent(ev) && osdState.upNextVisible) {
                ev.preventDefault();
                ev.stopPropagation();
                osdState.upNextDismissedForId = normalizeGuid(osdState.info && osdState.info.Id);
                hideOsdUpNextCard();
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
            if (isGateOpen() && !document.querySelector('.streamflix-modal-backdrop:not(.streamflix-modal-leave)')) {
                var gateStage = document.getElementById('streamflix-stage');
                var gateView = gateStage ? String(gateStage.getAttribute('data-view') || '') : '';
                if (isRemoteBackEvent(ev)) {
                    if (gateView === 'auth-guest' && state.guestPassExpanded) {
                        ev.preventDefault();
                        state.guestPassExpanded = false;
                        renderGoogleAuthGate();
                        return;
                    }
                    if (gateView === 'auth-admin' && state.adminLoginExpanded) {
                        ev.preventDefault();
                        state.adminLoginExpanded = false;
                        renderGoogleAuthGate();
                        return;
                    }
                    if (gateView === 'picker-manage' && state.manageMode) {
                        ev.preventDefault();
                        state.manageMode = false;
                        renderProfilePickerGate();
                        return;
                    }
                    if (gateView === 'picker' && state.activeProfile && state.activeProfile.id && state.activeProfile.accessToken && !isOnJellyfinLoginPage()) {
                        ev.preventDefault();
                        closeOverlayGate();
                        scheduleLifecycleTick(0);
                        return;
                    }
                }
                if (gateView === 'picker' && !state.manageMode && !isGuestPassSession() && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !isEditableTarget(ev.target)) {
                    if (/^[1-9]$/.test(ev.key || '')) {
                        var quickIdx = parseInt(ev.key, 10) - 1;
                        var quickList = getProfiles();
                        if (quickList[quickIdx]) {
                            ev.preventDefault();
                            handleSelectProfile(quickList[quickIdx]);
                            return;
                        }
                    }
                }
            }
            if (isRemoteBackEvent(ev)
                && !isGateOpen()
                && !isVideoPlayerActive()
                && !document.querySelector('.streamflix-modal-backdrop:not(.streamflix-modal-leave), .dialogContainer .dialog:not(.hide), .actionSheet:not(.hide)')) {
                var backPrefsKind = getUserPreferencesRouteKind();
                if (backPrefsKind) {
                    ev.preventDefault();
                    if (backPrefsKind === 'menu') {
                        navigateBackToStreamFlixHome(ev);
                    } else {
                        window.location.hash = '#/mypreferencesmenu';
                    }
                    return;
                }
                if (isOnHomeRoute()) {
                    if (state.searchQuery || state.mobileSearchOpen) {
                        ev.preventDefault();
                        cancelPendingSearch();
                        state.mobileSearchOpen = false;
                        state.searchQuery = '';
                        state.searchResults = null;
                        state.seerrSearchResults = null;
                        renderCinemaHubContents();
                        return;
                    }
                    if (state.libraryBrowser && state.libraryBrowser.active) {
                        ev.preventDefault();
                        if (typeof closeLibraryBrowser === 'function') {
                            closeLibraryBrowser();
                        } else {
                            state.libraryBrowser = null;
                            renderCinemaHubContents();
                        }
                        return;
                    }
                    if (state.browseFilter) {
                        ev.preventDefault();
                        state.browseFilter = null;
                        renderCinemaHubContents();
                        return;
                    }
                }
            }
            if (handleDpadArrowKey(ev)) {
                return;
            }
            if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                if (isVideoPlayerActive() || isGateOpen() || state.accountDropdownOpen || document.querySelector('.streamflix-modal-backdrop')) {
                    return;
                }
                var tag = (document.activeElement && document.activeElement.tagName) || '';
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (document.activeElement && document.activeElement.isContentEditable)) {
                    return;
                }
                var search = document.getElementById('streamflix-live-search-input');
                if (search && search.offsetParent !== null) {
                    ev.preventDefault();
                    var subnavWrap = search.closest ? search.closest('.streamflix-subnav') : null;
                    if (subnavWrap) {
                        subnavWrap.classList.add('is-search-open');
                    }
                    search.focus();
                }
            }
        });

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                syncDeviceLayoutClasses();
                if (state.activeProfile && state.config && state.config.enableStreamFlixUi !== false) {
                    ensureHeaderWidgets();
                }
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
        // Keep 1-press-per-card navigation: skip nested quick-action micro-buttons inside cards (except reorder/edit buttons in Manage Profiles mode)
        var parentCard = el.closest ? el.closest('.streamflix-poster-card, .streamflix-wide-card, .streamflix-top10-card, .bfx-seerr-card, .streamflix-profile-tile') : null;
        if (parentCard && parentCard !== el) {
            if (!(state.manageMode && parentCard.classList.contains('streamflix-profile-tile') && el.classList.contains('streamflix-reorder-btn'))) {
                return false;
            }
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
        var modalScroll = el.closest ? el.closest('.streamflix-detail-scroll, .streamflix-modal-editor, .bfx-gp-modal, .bfx-mn-modal, .bfx-seerr-modal, .bfx-wp-modal, .bfx-kids-exit-modal, #streamflix-account-dropdown') : null;
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
        var upNextEl = document.getElementById('streamflix-osd-upnext');
        if (osdState.upNextVisible && upNextEl) {
            return { kind: 'osd-overlay', roots: [upNextEl] };
        }
        var modals = document.querySelectorAll('.streamflix-modal-backdrop:not(.streamflix-modal-leave)');
        if (modals.length > 0) {
            return { kind: 'modal', roots: [modals[modals.length - 1]] };
        }
        if (document.querySelector('.dialogContainer .dialog:not(.hide), .actionSheet:not(.hide), .webgpuSettingsWindows .webgpuWindow:not([hidden]), .webgpuFailureDialog:not(.hide)')) {
            return null;
        }
        var dd = document.getElementById('streamflix-account-dropdown');
        if (state.accountDropdownOpen && dd) {
            return { kind: 'dropdown', roots: [dd] };
        }
        var gate = document.getElementById('streamflix-overlay-root');
        if (gate) {
            return { kind: 'gate', roots: [gate] };
        }
        var prefsKind = getUserPreferencesRouteKind();
        if (prefsKind) {
            var prefsPage = findActiveUserPreferencesPageEl(prefsKind);
            if (prefsPage && prefsPage.offsetParent !== null) {
                var prefsRoots = [prefsPage];
                var pHdrBtn = document.getElementById('streamflix-header-profile-btn');
                var pBrandBtn = document.getElementById('bfx-fixed-corner-brand');
                if (pHdrBtn) {
                    prefsRoots.unshift(pHdrBtn);
                }
                if (pBrandBtn) {
                    prefsRoots.unshift(pBrandBtn);
                }
                return { kind: 'settings', roots: prefsRoots };
            }
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

    function pickAlignedRowEdgeCard(cards, targetCx, preferBottomRow) {
        if (!cards || !cards.length) {
            return null;
        }
        var edgeTop = preferBottomRow ? -Infinity : Infinity;
        cards.forEach(function (c) {
            var r = c.getBoundingClientRect();
            if (preferBottomRow) {
                if (r.top > edgeTop) { edgeTop = r.top; }
            } else {
                if (r.top < edgeTop) { edgeTop = r.top; }
            }
        });
        var sameBand = cards.filter(function (c) {
            return Math.abs(c.getBoundingClientRect().top - edgeTop) < 32;
        });
        var pool = sameBand.length ? sameBand : cards;
        var best = pool[0];
        var bestDx = Infinity;
        pool.forEach(function (c) {
            var r = c.getBoundingClientRect();
            var d = Math.abs((r.left + r.width / 2) - targetCx);
            if (d < bestDx) {
                bestDx = d;
                best = c;
            }
        });
        return best;
    }

    function handleDpadArrowKey(ev) {
        var keyMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        var dir = keyMap[ev.key];
        if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) {
            return false;
        }
        if ((isVideoPlayerActive() || (document.body && document.body.classList.contains('streamflix-in-video-player')))
            && !osdState.episodesOpen && !osdState.tracksOpen && !osdState.upNextVisible) {
            return false;
        }
        var active = document.activeElement;
        if (isEditableTarget(active)) {
            var activeTag = ((active && active.tagName) || '').toUpperCase();
            var allowInputVerticalEscape = activeTag === 'INPUT' && (dir === 'up' || dir === 'down');
            if (!allowInputVerticalEscape) {
                return false;
            }
        }

        var scope = getActiveDpadScope();
        if (!scope) {
            return false;
        }

        document.body.classList.add('bfx-dpad-nav');
        hidePreviewNow();

        var hubCardSel = '[data-item-id], [data-seerr-key]';
        var inScope = active && scope.roots.some(function (r) { return r === active || (r.contains && r.contains(active)); });
        if (!inScope) {
            var initial = null;
            if (scope.kind === 'gate') {
                initial = scope.roots[0].querySelector('.streamflix-profile-tile:not(.streamflix-tile-locked)[data-profile-id]')
                    || scope.roots[0].querySelector('#streamflix-google-login-btn')
                    || scope.roots[0].querySelector('#streamflix-oidc-login-btn')
                    || scope.roots[0].querySelector('#streamflix-guest-code-input')
                    || scope.roots[0].querySelector('#streamflix-login-username')
                    || scope.roots[0].querySelector('#streamflix-password-submit-btn')
                    || scope.roots[0].querySelector('.streamflix-profile-tile');
            } else if (scope.kind === 'modal') {
                initial = scope.roots[0].querySelector('#streamflix-modal-play-btn')
                    || scope.roots[0].querySelector('[data-mn-pick="0"]')
                    || scope.roots[0].querySelector('#bfx-mn-play-winner')
                    || scope.roots[0].querySelector('.streamflix-btn-primary:not(:disabled)')
                    || scope.roots[0].querySelector('button:not(:disabled)');
            } else if (scope.kind === 'dropdown') {
                initial = scope.roots[0].querySelector('.streamflix-dd-switch-tile, .streamflix-dd-tile')
                    || scope.roots[0].querySelector('.streamflix-dd-item')
                    || scope.roots[0].querySelector('button:not(:disabled)');
            } else if (scope.kind === 'osd-overlay') {
                initial = scope.roots[0].querySelector('.streamflix-osd-upnext-play, button:not(:disabled), [tabindex="0"]');
            } else if (scope.kind === 'hub') {
                initial = document.querySelector('#streamflix-hero-billboard .streamflix-hero-play')
                    || document.querySelector('#streamflix-cinema-hub .streamflix-pill.active')
                    || document.querySelector('#streamflix-cinema-hub ' + hubCardSel);
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

        // Deterministic D-pad / Arrow-key navigation inside the Hero Billboard across 1080p & 4K TVs
        var heroBillboard = scope.kind === 'hub' ? document.getElementById('streamflix-hero-billboard') : null;
        if (heroBillboard && heroBillboard.contains(active) && heroBillboard.offsetParent !== null) {
            var heroControls = [
                document.getElementById('streamflix-hero-play-btn'),
                document.getElementById('streamflix-hero-info-btn'),
                document.getElementById('streamflix-hero-fav-btn'),
                heroBillboard.querySelector('.streamflix-hero-arrow.prev'),
                heroBillboard.querySelector('.streamflix-hero-dot.active') || heroBillboard.querySelector('.streamflix-hero-dot'),
                heroBillboard.querySelector('.streamflix-hero-arrow.next')
            ].filter(isFocusableVisible);
            var hIdx = heroControls.indexOf(active);
            if (active.classList && active.classList.contains('streamflix-hero-dot') && hIdx === -1) {
                hIdx = heroControls.indexOf(heroBillboard.querySelector('.streamflix-hero-dot.active'));
            }
            if (dir === 'left' || dir === 'right') {
                ev.preventDefault();
                var nextHeroIdx = dir === 'right' ? hIdx + 1 : hIdx - 1;
                if (hIdx !== -1 && heroControls[nextHeroIdx]) {
                    focusSpatialTarget(heroControls[nextHeroIdx]);
                }
                return true;
            }
            if (dir === 'down') {
                var firstRowCard = document.querySelector('#streamflix-cinema-hub .streamflix-row [data-item-id], #streamflix-cinema-hub .streamflix-row [data-seerr-key]');
                if (firstRowCard && isFocusableVisible(firstRowCard)) {
                    ev.preventDefault();
                    focusSpatialTarget(firstRowCard);
                    return true;
                }
            }
            if (dir === 'up') {
                var subPill = document.querySelector('#streamflix-cinema-hub .streamflix-pill.active, #streamflix-cinema-hub .streamflix-pill');
                var profBtn = document.getElementById('streamflix-header-profile-btn');
                var upHeroTarget = (subPill && isFocusableVisible(subPill)) ? subPill : profBtn;
                if (upHeroTarget && isFocusableVisible(upHeroTarget)) {
                    ev.preventDefault();
                    focusSpatialTarget(upHeroTarget);
                    return true;
                }
            }
        }

        // Row-aware fast-path for horizontal card carousels on Home / Movies / Shows / Collections / Live Search
        if (scope.kind === 'hub' && active.hasAttribute && (active.hasAttribute('data-item-id') || active.hasAttribute('data-seerr-key'))) {
            var rowEl = active.closest ? active.closest('.streamflix-row') : null;
            var trackEl = active.closest ? active.closest('.streamflix-carousel-track') : null;
            if (rowEl && trackEl) {
                var rowCards = Array.prototype.slice.call(trackEl.querySelectorAll(hubCardSel));
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
                    return rw.offsetParent !== null && rw.querySelector(hubCardSel);
                });
                var rIdx = allRows.indexOf(rowEl);
                if (dir === 'down' && rIdx !== -1 && rIdx + 1 < allRows.length) {
                    ev.preventDefault();
                    var curCx = active.getBoundingClientRect().left + active.getBoundingClientRect().width / 2;
                    var nextRowCards = Array.prototype.slice.call(allRows[rIdx + 1].querySelectorAll(hubCardSel));
                    var bestCard = pickAlignedRowEdgeCard(nextRowCards, curCx, false);
                    if (bestCard) {
                        focusSpatialTarget(bestCard);
                    }
                    return true;
                }
                if (dir === 'up' && rIdx > 0) {
                    ev.preventDefault();
                    var upCx = active.getBoundingClientRect().left + active.getBoundingClientRect().width / 2;
                    var prevRowCards = Array.prototype.slice.call(allRows[rIdx - 1].querySelectorAll(hubCardSel));
                    var bestUp = pickAlignedRowEdgeCard(prevRowCards, upCx, true);
                    if (bestUp) {
                        focusSpatialTarget(bestUp);
                    }
                    return true;
                }
                if (dir === 'up' && rIdx === 0) {
                    var heroPlay = document.querySelector('#streamflix-hero-billboard .streamflix-hero-play');
                    var activePill = document.querySelector('#streamflix-cinema-hub .streamflix-pill.active, #streamflix-cinema-hub .streamflix-pill');
                    var searchInput = document.getElementById('streamflix-live-search-input');
                    var topTarget = (state.searchQuery && searchInput && isFocusableVisible(searchInput))
                        ? searchInput
                        : ((heroPlay && isFocusableVisible(heroPlay)) ? heroPlay : activePill);
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

    function clearStaleHtmlCaches(targetVersion) {
        try {
            var verKey = 'streamflix_asset_ver';
            var desiredVer = String(targetVersion || (state.config && state.config.assetVersion) || VERSION);
            var prevVer = localStorage.getItem(verKey) || '';
            var versionChanged = prevVer !== desiredVer;
            if (versionChanged) {
                localStorage.setItem(verKey, desiredVer);
                if (window.caches && typeof window.caches.keys === 'function') {
                    window.caches.keys().then(function (names) {
                        names.forEach(function (n) { window.caches.delete(n); });
                    }).catch(function () {});
                }
            }
            if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
                var swCleaned = localStorage.getItem('streamflix_sw_cleaned_v7');
                navigator.serviceWorker.getRegistrations().then(function (regs) {
                    regs.forEach(function (reg) {
                        if ((!swCleaned || versionChanged) && typeof reg.unregister === 'function') {
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
    window.__STREAMFLIX_REFRESH_CONFIG__ = function () {
        return fetchPublicConfig().then(function (cfg) {
            replaceToolbarLogoInPlace();
            return cfg;
        });
    };
    window.__STREAMFLIX_OPEN_PROFILE_PICKER__ = function (manage) {
        closeAccountDropdown();
        var wantManage = Boolean(manage);
        if (!isAdminConfigRoute() && typeof isKidsExitLockRequired === 'function' && isKidsExitLockRequired()) {
            return requestExitKidsVerification(null).then(function (res) {
                if (!res || !res.verified) {
                    return null;
                }
                state.explicitPickerOpen = true;
                state.openedDirectlyToManage = wantManage;
                state.manageMode = wantManage;
                if (hasHouseholdAccess()) {
                    renderProfilePickerGate();
                }
                return fetchPublicConfig().then(function () {
                    if (hasHouseholdAccess()) {
                        if (state.explicitPickerOpen) {
                            renderProfilePickerGate();
                        }
                    } else {
                        renderGoogleAuthGate();
                    }
                });
            });
        }
        state.explicitPickerOpen = true;
        state.openedDirectlyToManage = wantManage;
        state.manageMode = wantManage;
        if (hasHouseholdAccess()) {
            renderProfilePickerGate();
        }
        return fetchPublicConfig().then(function () {
            if (hasHouseholdAccess()) {
                if (state.explicitPickerOpen) {
                    renderProfilePickerGate();
                }
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
    window.__STREAMFLIX_OPEN_GUEST_PASSES__ = openGuestPassesModal;
    window.__STREAMFLIX_GET_APP_PHASE__ = function () {
        return state.appPhase;
    };
    window.__STREAMFLIX_SIGN_OUT_LOCAL__ = function (skipGateRender) {
        signOutHousehold({ skipServerLogout: true, silent: true, skipGateRender: Boolean(skipGateRender) });
    };

    function bootstrap() {
        if (isNativeDesktopShellClient()) {
            state.pluginDisabled = true;
            teardownStreamFlixUi();
            return;
        }
        if (document.body && isStreamFlixRuntimeEnabled()) {
            document.body.classList.add('bfx-active');
        }
        installStrictCspImageHandlers();
        syncDeviceLayoutClasses();
        installJellyfin12FetchInterceptor();
        patchJellyfinApiClientMethods();
        installGlobalCardClickInterceptor();
        clearStaleHtmlCaches();
        fixBrokenJellyfinRoutes();
        installLifecycleWatchers();

        if (typeof capturePendingWatchPartyFromUrl === 'function') {
            capturePendingWatchPartyFromUrl();
        }
        var guestCb = extractGuestCallbackFromUrl();
        var oidcCb = guestCb ? null : extractOidcCallbackFromUrl();
        var oauth = (guestCb || oidcCb) ? null : extractGoogleOAuthResultFromUrl();
        if (guestCb) {
            fetchPublicConfig().then(function () {
                if (guestCb.error) {
                    renderGoogleAuthGate(null, guestCb.error);
                } else {
                    completeGuestHandoff();
                }
            });
        } else if (oidcCb) {
            fetchPublicConfig().then(function () {
                if (oidcCb.error) {
                    if (typeof clearPendingOidcFlow === 'function') {
                        clearPendingOidcFlow();
                    }
                    takePendingProfileId();
                    renderGoogleAuthGate(null, oidcCb.error);
                } else {
                    completeOidcHandoff(oidcCb);
                }
            });
        } else if (oauth) {
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
                if (!hasHouseholdAccess() && typeof pollPendingOidcFlowIfActive === 'function') {
                    pollPendingOidcFlowIfActive();
                }
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
