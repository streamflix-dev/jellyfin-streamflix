/* StreamFlix Client (02/14) — Jellyfin 12 Fetch/XHR Interceptors & Session Sync */
    function rewriteJellyfinItemsQueryUrl(rawUrl) {
        if (!isStreamFlixRuntimeEnabled()) {
            return rawUrl;
        }
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
            var isAnonAddonAsset = urlStr.toLowerCase().indexOf('/webgpuplayer/addon/') !== -1;
            var isSameOrigin = !isAnonAddonAsset && isSafeSameOriginUrl(urlStr);
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
            if (this.__streamflixSameOrigin && lower && isStreamFlixRuntimeEnabled()) {
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

        XMLHttpRequest.prototype.send = function (bodyArg) {
            try {
                if (this.__streamflixSameOrigin) {
                    var token = isStreamFlixRuntimeEnabled() ? getActiveToken() : null;
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
                    if (String(this.__streamflixUrl || '').toLowerCase().indexOf('/streamflix/') !== -1
                        && state.googleUser && state.googleUser.token
                        && !(this.__streamflixHeaders && this.__streamflixHeaders['x-streamflix-session'])) {
                        origSetRequestHeader.call(this, 'X-StreamFlix-Session', state.googleUser.token);
                    }
                    if (this.__streamflixMethod === 'POST' && typeof bodyArg === 'string' && typeof onWatchPartyNativeProgressReport === 'function') {
                        var xUrlLow = String(this.__streamflixUrl || '').toLowerCase();
                        if (xUrlLow.indexOf('/sessions/playing') !== -1 && bodyArg.charAt(0) === '{') {
                            onWatchPartyNativeProgressReport(JSON.parse(bodyArg), xUrlLow);
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

            var lowCheckUrl = String(urlStr || '').toLowerCase();
            if (lowCheckUrl.indexOf('/webgpuplayer/addon/') !== -1) {
                return nativeFetch(input, init);
            }

            var isSameOrigin = isSafeSameOriginUrl(urlStr);

            var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

            if (isSameOrigin && method === 'POST' && init && typeof init.body === 'string' && typeof onWatchPartyNativeProgressReport === 'function') {
                try {
                    if (lowCheckUrl.indexOf('/sessions/playing') !== -1 && init.body.charAt(0) === '{') {
                        onWatchPartyNativeProgressReport(JSON.parse(init.body), lowCheckUrl);
                    }
                } catch (eProg) {}
            }

            if (isSameOrigin && method === 'GET' && typeof input === 'string') {
                urlStr = rewriteJellyfinItemsQueryUrl(urlStr);
                input = urlStr;
            }

            var attachSessionHdr = isSameOrigin && lowCheckUrl.indexOf('/streamflix/') !== -1 && state.googleUser && state.googleUser.token;
            var runtimeOn = isStreamFlixRuntimeEnabled();
            if (isSameOrigin && ((runtimeOn && getActiveToken()) || attachSessionHdr)) {
                var token = runtimeOn ? sanitizeHeaderField(getActiveToken()) : '';
                if (token || attachSessionHdr) {
                    var authVal = token ? getEmbyAuthHeader(token) : '';
                    init = Object.assign({}, init || {});
                    if (typeof Headers !== 'undefined') {
                        var mergedHeaders = new Headers(
                            typeof input !== 'string' && input && input.headers ? input.headers : undefined
                        );
                        if (init.headers) {
                            new Headers(init.headers).forEach(function (v, k) {
                                mergedHeaders.set(k, v);
                            });
                        }
                        if (token) {
                            mergedHeaders.set('Authorization', authVal);
                            mergedHeaders.set('X-Emby-Authorization', authVal);
                            mergedHeaders.set('X-Emby-Token', token);
                        }
                        if (attachSessionHdr && !mergedHeaders.has('X-StreamFlix-Session')) {
                            mergedHeaders.set('X-StreamFlix-Session', state.googleUser.token);
                        }
                        init.headers = mergedHeaders;
                    } else {
                        var hCopy = Object.assign({}, init.headers || {});
                        if (token) {
                            hCopy['Authorization'] = authVal;
                            hCopy['X-Emby-Authorization'] = authVal;
                            hCopy['X-Emby-Token'] = token;
                        }
                        if (attachSessionHdr && !hCopy['X-StreamFlix-Session']) {
                            hCopy['X-StreamFlix-Session'] = state.googleUser.token;
                        }
                        init.headers = hCopy;
                    }
                }
            }

            return nativeFetch(input, init).then(function (res) {
                if (isSameOrigin && lowCheckUrl.indexOf('/webgpuplayer/clientdefaults') !== -1) {
                    setTimeout(function () {
                        syncAutomaticWebGpuPlayerPreference();
                    }, 0);
                }

                if (isSameOrigin && res && res.status === 401 && (getActiveAdminAuthForRoute() || (state.activeProfile && state.activeProfile.accessToken))) {
                    var lowUrl = String(urlStr || '').toLowerCase();
                    if (lowUrl.indexOf('/streamflix/') === -1 && lowUrl.indexOf('/sessions/logout') === -1 && lowUrl.indexOf('/webgpuplayer/') === -1) {
                        var admRouteAuth = getActiveAdminAuthForRoute();
                        if (admRouteAuth && (!state.activeProfile || state.activeProfile.accessToken !== admRouteAuth.accessToken)) {
                            clearAdminAuth();
                            scheduleLifecycleTick(0);
                        } else {
                            clearAdminAuth();
                            clearLocalJellyfinAuth();
                            clearActiveProfileState(false);
                            state.sessionVerifiedOnce = false;
                            fetchPublicConfig().then(function () {
                                scheduleLifecycleTick(0);
                            }).catch(function () {
                                scheduleLifecycleTick(0);
                            });
                        }
                    }
                }

                if (!runtimeOn || !isSameOrigin || method !== 'GET' || !res || !res.ok || isAdminRouteHash()) {
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
                    var alreadyRec = String(urlObj.searchParams.get('Recursive') || urlObj.searchParams.get('recursive') || '').toLowerCase() === 'true';
                    var reqPid = urlObj.searchParams.get('ParentId') || urlObj.searchParams.get('parentId') || '';
                    if (filters || itemTypes === 'Episode' || itemTypes === 'Season') {
                        return res;
                    }

                    return res.clone().json().then(function (data) {
                        if (data && Array.isArray(data.Items) && (data.Items.length > 0 || alreadyRec || !reqPid || !isKnownTopLevelViewId(reqPid))) {
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
                                if (d1 && Array.isArray(d1.Items)) {
                                    stampServerIdOnItems(d1);
                                    return new Response(JSON.stringify(d1), {
                                        status: 200,
                                        headers: { 'Content-Type': 'application/json' }
                                    });
                                }
                                return res;
                            })
                            .catch(function () {
                                return res;
                            });
                    }).catch(function () {
                        return res;
                    });
                }

                if (isLatestEndpoint) {
                    var latestPid = urlObj.searchParams.get('ParentId') || urlObj.searchParams.get('parentId') || '';
                    return res.clone().json().then(function (data) {
                        if (Array.isArray(data) && (data.length > 0 || !latestPid || !isKnownTopLevelViewId(latestPid))) {
                            stampServerIdOnItems(data);
                            return new Response(JSON.stringify(data), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }

                        var spL = new URLSearchParams(urlObj.search);
                        var existingType = spL.get('IncludeItemTypes') || spL.get('includeItemTypes') || '';
                        var inferredType = inferItemTypesForParentOrRoute(latestPid, existingType) || 'Movie,Series';

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
                                if (dL1 && Array.isArray(dL1.Items)) {
                                    stampServerIdOnItems(dL1.Items);
                                    return new Response(JSON.stringify(dL1.Items), {
                                        status: 200,
                                        headers: { 'Content-Type': 'application/json' }
                                    });
                                }
                                return res;
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

    var webGpuRuntimeState = {
        probed: false,
        adapterAvailable: null,
        failedNormIds: {},
        lastChosenMode: '',
        lastFallbackNormId: '',
        lastFallbackAtMs: 0,
        observerInstalled: false
    };

    function isWebGpuPluginInstalled() {
        return Boolean(
            window.WebGPUPlayer
            || window.WebGPUPlayerConfig
            || document.querySelector('script[data-webgpu-player-bootstrap]')
        );
    }

    function isDesktopWebGpuEligibleClient() {
        try {
            if (!window.isSecureContext || window.NativeShell) {
                return false;
            }
            if (typeof navigator === 'undefined' || !navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
                return false;
            }
            var ua = String(navigator.userAgent || '');
            if (/Android|iPhone|iPad|iPod|Mobile|SmartTV|Web0S|Tizen|CrKey|PlayStation|Xbox/i.test(ua)) {
                return false;
            }
            var docEl = document.documentElement;
            if (docEl && (docEl.classList.contains('layout-tv') || docEl.classList.contains('layout-mobile'))) {
                return false;
            }
            if (document.body && (document.body.classList.contains('bfx-phone-mode') || document.body.classList.contains('bfx-tv-mode'))) {
                return false;
            }
            if (navigator.maxTouchPoints > 1 && Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 820) {
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function collectKnownConnectionManagers() {
        var cmList = [];
        var addCm = function (candidate) {
            if (candidate && cmList.indexOf(candidate) === -1) {
                cmList.push(candidate);
            }
        };
        addCm(window.ServerConnections);
        addCm(window.ConnectionManager);
        if (window.Emby) {
            addCm(window.Emby.ConnectionManager);
        }
        return cmList;
    }

    function resolveCurrentContextItemNormId(explicitTargetId) {
        if (explicitTargetId) {
            return normalizeGuid(explicitTargetId);
        }
        if (state.lastPlayNormId && state.lastPlayTimestamp && (Date.now() - state.lastPlayTimestamp < 30000)) {
            return state.lastPlayNormId;
        }
        var h = String(window.location.hash || '');
        var m = h.match(/[?&]id=([a-f0-9-]+)/i);
        return m ? normalizeGuid(m[1]) : '';
    }

    function syncAutomaticWebGpuPlayerPreference(forceMode, targetItemId) {
        if (!isWebGpuPluginInstalled()) {
            webGpuRuntimeState.lastChosenMode = 'html';
            return 'html';
        }
        var normItemId = resolveCurrentContextItemNormId(targetItemId);
        var chosen = forceMode;
        if (!chosen) {
            if (normItemId && webGpuRuntimeState.failedNormIds[normItemId]) {
                chosen = 'html';
            } else {
                var canUse = isDesktopWebGpuEligibleClient()
                    && webGpuRuntimeState.adapterAvailable !== false;
                chosen = canUse ? 'webgpu' : 'html';
            }
        }
        webGpuRuntimeState.lastChosenMode = chosen;
        try {
            var uids = [''];
            var activeUid = getActiveUserId();
            if (activeUid && uids.indexOf(activeUid) === -1) {
                uids.push(activeUid);
            }
            if (window.ApiClient && typeof window.ApiClient.__origGetCurrentUserId === 'function') {
                var rawUid = window.ApiClient.__origGetCurrentUserId();
                if (rawUid && uids.indexOf(rawUid) === -1) {
                    uids.push(rawUid);
                }
            }
            var cmList = collectKnownConnectionManagers();
            for (var c = 0; c < cmList.length; c++) {
                try {
                    var curAc = typeof cmList[c].currentApiClient === 'function' ? cmList[c].currentApiClient() : null;
                    var cmUid = curAc && typeof curAc.getCurrentUserId === 'function' ? curAc.getCurrentUserId() : '';
                    if (cmUid && uids.indexOf(cmUid) === -1) {
                        uids.push(cmUid);
                    }
                } catch (eCmUid) {}
            }
            for (var i = 0; i < uids.length; i++) {
                var prefix = uids[i] ? (uids[i] + '-') : '';
                localStorage.setItem(prefix + 'preferredVideoPlayer', chosen);
                localStorage.setItem(prefix + 'webGPULegacyChoicesMigrated', 'true');
            }
        } catch (e) {}
        return chosen;
    }

    function probeWebGpuAdapterOnce() {
        if (webGpuRuntimeState.probed || !isWebGpuPluginInstalled()) {
            return;
        }
        webGpuRuntimeState.probed = true;
        if (!isDesktopWebGpuEligibleClient()) {
            webGpuRuntimeState.adapterAvailable = false;
            syncAutomaticWebGpuPlayerPreference('html');
            return;
        }
        try {
            navigator.gpu.requestAdapter().then(function (adapter) {
                webGpuRuntimeState.adapterAvailable = Boolean(adapter);
                syncAutomaticWebGpuPlayerPreference();
            }).catch(function () {
                webGpuRuntimeState.adapterAvailable = false;
                syncAutomaticWebGpuPlayerPreference('html');
            });
        } catch (e) {
            webGpuRuntimeState.adapterAvailable = false;
            syncAutomaticWebGpuPlayerPreference('html');
        }
    }

    function installWebGpuFatalErrorFallbackWatcher() {
        if (webGpuRuntimeState.observerInstalled || typeof MutationObserver !== 'function' || !document.body) {
            return;
        }
        webGpuRuntimeState.observerInstalled = true;

        // Also ensure native Jellyfin detail/card Play clicks sync WebGPU/HTML preference for that item beforehand
        try {
            document.addEventListener('click', function (ev) {
                if (!isWebGpuPluginInstalled() || !ev || !ev.target || !ev.target.closest) {
                    return;
                }
                var playEl = ev.target.closest('.btnPlay, .btnResume, button[data-action="play"], button[data-action="resume"]');
                if (!playEl) {
                    return;
                }
                var cardWithId = playEl.closest('[data-id]');
                var clickedId = (cardWithId && cardWithId.getAttribute('data-id')) || '';
                if (!clickedId) {
                    var hm = String(window.location.hash || '').match(/[?&]id=([a-f0-9-]+)/i);
                    clickedId = hm ? hm[1] : '';
                }
                if (clickedId) {
                    var normClicked = normalizeGuid(clickedId);
                    state.lastPlayNormId = normClicked;
                    state.lastPlayTimestamp = Date.now();
                    if (ev.isTrusted) {
                        state.lastPlayRawTarget = clickedId;
                        state.lastPlayAudioIndex = null;
                        state.lastPlaySubtitleIndex = null;
                        state.lastPlayForcedTicks = undefined;
                    } else if (!state.lastPlayRawTarget) {
                        state.lastPlayRawTarget = clickedId;
                    }
                    syncAutomaticWebGpuPlayerPreference(null, normClicked);
                }
            }, true);
        } catch (eClickHook) {}

        try {
            var obs = new MutationObserver(function () {
                if (!isWebGpuPluginInstalled() || webGpuRuntimeState.lastChosenMode !== 'webgpu') {
                    return;
                }
                var dlg = document.querySelector(
                    '.dialogContainer:not([data-bfx-dismissing="true"]) .dialog:not(.hide), '
                    + '.MuiDialog-root:not([data-bfx-dismissing="true"]), '
                    + '.webgpuFailureDialog:not(.hide):not([data-bfx-dismissing="true"])'
                );
                if (!dlg) {
                    return;
                }
                var txt = String(dlg.textContent || '').toLowerCase();
                var isFatalPlaybackAlert = (txt.indexOf('playback error') !== -1 && txt.indexOf('fatal player error') !== -1)
                    || dlg.classList.contains('webgpuFailureDialog');
                if (!isFatalPlaybackAlert) {
                    return;
                }

                var replayId = resolveCurrentContextItemNormId('');
                var nowMs = Date.now();
                if (!replayId || (webGpuRuntimeState.lastFallbackNormId === replayId && (nowMs - webGpuRuntimeState.lastFallbackAtMs) < 12000)) {
                    return;
                }

                webGpuRuntimeState.failedNormIds[replayId] = true;
                webGpuRuntimeState.lastFallbackNormId = replayId;
                webGpuRuntimeState.lastFallbackAtMs = nowMs;
                syncAutomaticWebGpuPlayerPreference('html', replayId);

                var wrap = (dlg.closest && dlg.closest('.dialogContainer, .MuiDialog-root')) || dlg;
                wrap.setAttribute('data-bfx-dismissing', 'true');
                wrap.style.setProperty('opacity', '0', 'important');
                wrap.style.setProperty('pointer-events', 'none', 'important');

                if (typeof showPlaybackLoader === 'function') {
                    showPlaybackLoader('Starting playback…');
                }

                var dismissBtn = dlg.querySelector('button[data-id="ok"], .btnSubmit, button');
                if (dismissBtn) {
                    setTimeout(function () {
                        try { dismissBtn.click(); } catch (eClick) {}
                    }, 10);
                }

                setTimeout(function () {
                    if (typeof playItemImmediately === 'function') {
                        playItemImmediately(
                            state.lastPlayRawTarget || replayId,
                            state.lastPlayAudioIndex,
                            state.lastPlaySubtitleIndex,
                            state.lastPlayForcedTicks,
                            { forceReplay: true }
                        );
                    }
                }, 220);
            });
            obs.observe(document.body, { childList: true, subtree: true });
        } catch (eObs) {}
    }

    function patchSingleApiClientInstance(ac) {
        if (!ac || ac.__streamflixPatched) {
            return ac;
        }
        ac.__streamflixPatched = true;

        if (typeof ac.serverId === 'function') {
            var origServerId = ac.serverId.bind(ac);
            ac.__origServerId = origServerId;
            ac.serverId = function () {
                var sid = origServerId();
                return sid || (state.activeProfile && state.activeProfile.serverId) || (state.config && state.config.serverId) || '';
            };
        }

        if (typeof ac.getCurrentUserId === 'function') {
            var origGetCurrentUserId = ac.getCurrentUserId.bind(ac);
            ac.__origGetCurrentUserId = origGetCurrentUserId;
            ac.getCurrentUserId = function () {
                var adm = getActiveAdminAuthForRoute();
                if (adm && adm.userId) {
                    return adm.userId;
                }
                return (state.activeProfile && state.activeProfile.jellyfinUserId) || origGetCurrentUserId() || '';
            };
        }

        if (typeof ac.accessToken === 'function') {
            var origAccessToken = ac.accessToken.bind(ac);
            ac.__origAccessToken = origAccessToken;
            ac.accessToken = function () {
                var adm = getActiveAdminAuthForRoute();
                if (adm && adm.accessToken) {
                    return adm.accessToken;
                }
                return (state.activeProfile && state.activeProfile.accessToken) || origAccessToken() || '';
            };
        }

        if (typeof ac.isLoggedIn === 'function') {
            var origIsLoggedIn = ac.isLoggedIn.bind(ac);
            ac.__origIsLoggedIn = origIsLoggedIn;
            ac.isLoggedIn = function () {
                if (getActiveToken() && getActiveUserId()) {
                    return true;
                }
                return origIsLoggedIn();
            };
        }

        if (typeof ac.getCurrentUser === 'function') {
            var origGetCurrentUser = ac.getCurrentUser.bind(ac);
            ac.__origGetCurrentUser = origGetCurrentUser;
            ac.getCurrentUser = function (enableCache) {
                var adm = getActiveAdminAuthForRoute();
                if (adm && adm.user && adm.userId) {
                    var sid = resolveKnownServerId(adm.serverId);
                    if (sid && !adm.user.ServerId) {
                        adm.user.ServerId = sid;
                    }
                    ac._currentUser = adm.user;
                    return Promise.resolve(adm.user);
                }
                return origGetCurrentUser(enableCache);
            };
        }

        if (typeof ac.getItems === 'function') {
            var origGetItems = ac.getItems.bind(ac);
            ac.getItems = function (userId, options) {
                if (!isStreamFlixRuntimeEnabled()) {
                    return origGetItems(userId, options);
                }
                var opts = Object.assign({}, options || {});
                if (opts.ParentId === 'undefined' || opts.ParentId === 'null') {
                    delete opts.ParentId;
                }
                if (opts.parentId === 'undefined' || opts.parentId === 'null') {
                    delete opts.parentId;
                }
                var uid = userId || getActiveUserId();
                var pid = opts.ParentId || opts.parentId || '';
                var wasRec = String(opts.Recursive || opts.recursive || '').toLowerCase() === 'true';
                return origGetItems(uid, opts).then(function (res) {
                    if (res && Array.isArray(res.Items) && (res.Items.length > 0 || wasRec || !pid || !isKnownTopLevelViewId(pid))) {
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
                        return (d1 && Array.isArray(d1.Items)) ? stampServerIdOnItems(d1) : res;
                    }).catch(function () {
                        return res;
                    });
                });
            };
        }

        if (typeof ac.getLatestItems === 'function') {
            var origGetLatest = ac.getLatestItems.bind(ac);
            ac.getLatestItems = function (options) {
                if (!isStreamFlixRuntimeEnabled()) {
                    return origGetLatest(options);
                }
                var opts = options || {};
                var pid = opts.ParentId || opts.parentId || '';
                return origGetLatest(options).then(function (res) {
                    if (Array.isArray(res) && (res.length > 0 || !pid || !isKnownTopLevelViewId(pid))) {
                        return stampServerIdOnItems(res);
                    }
                    var inferredType = inferItemTypesForParentOrRoute(pid, opts.IncludeItemTypes) || 'Movie,Series';
                    var qs = new URLSearchParams();
                    var uid = getActiveUserId();
                    if (uid) {
                        qs.set('userId', String(uid));
                    }
                    if (pid) {
                        qs.set('ParentId', String(pid));
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
                        return (d && Array.isArray(d.Items)) ? stampServerIdOnItems(d.Items) : res;
                    }).catch(function () {
                        return res;
                    });
                });
            };
        }

        return ac;
    }

    function patchJellyfinApiClientMethods() {
        try {
            probeWebGpuAdapterOnce();
            syncAutomaticWebGpuPlayerPreference();
            installWebGpuFatalErrorFallbackWatcher();

            var cmList = collectKnownConnectionManagers();
            for (var cIdx = 0; cIdx < cmList.length; cIdx++) {
                var cm = cmList[cIdx];
                if (cm && !cm.__streamflixPatched) {
                    cm.__streamflixPatched = true;
                    if (typeof cm.currentApiClient === 'function') {
                        var origCurrentApiClient = cm.currentApiClient.bind(cm);
                        cm.currentApiClient = function () {
                            try {
                                var cur = origCurrentApiClient();
                                if (cur) {
                                    return patchSingleApiClientInstance(cur);
                                }
                            } catch (e) {}
                            return window.ApiClient ? patchSingleApiClientInstance(window.ApiClient) : null;
                        };
                    }
                    if (typeof cm.getApiClient === 'function') {
                        var origGetApiClient = cm.getApiClient.bind(cm);
                        cm.getApiClient = function (itemOrServerId) {
                            try {
                                var res = origGetApiClient(itemOrServerId);
                                if (res) {
                                    return patchSingleApiClientInstance(res);
                                }
                            } catch (e) {}
                            return window.ApiClient ? patchSingleApiClientInstance(window.ApiClient) : null;
                        };
                    }
                    if (typeof cm.getApi === 'function') {
                        var origGetApi = cm.getApi.bind(cm);
                        cm.getApi = function (itemOrServerId) {
                            try {
                                var apiRes = origGetApi(itemOrServerId);
                                if (apiRes) {
                                    var activeTok = getActiveToken();
                                    if (activeTok && typeof apiRes.update === 'function' && apiRes.accessToken !== activeTok) {
                                        try { apiRes.update({ accessToken: activeTok }); } catch (eUpd) {}
                                    }
                                    return apiRes;
                                }
                            } catch (e) {}
                            return (window.ApiClient && window.ApiClient._sdk) || undefined;
                        };
                    }
                }
                try {
                    var existingClients = typeof cm.getApiClients === 'function' ? cm.getApiClients() : cm._apiClients;
                    if (Array.isArray(existingClients)) {
                        for (var a = 0; a < existingClients.length; a++) {
                            patchSingleApiClientInstance(existingClients[a]);
                        }
                    }
                } catch (eList) {}
            }

            if (window.ApiClient) {
                patchSingleApiClientInstance(window.ApiClient);
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

        var authPromises = [];
        try {
            var targetClients = [];
            var pushClient = function (c) {
                if (c && targetClients.indexOf(c) === -1) {
                    targetClients.push(c);
                }
            };
            pushClient(window.ApiClient);
            var cmList = collectKnownConnectionManagers();
            for (var cIdx = 0; cIdx < cmList.length; cIdx++) {
                var cm = cmList[cIdx];
                try {
                    if (typeof cm.currentApiClient === 'function') {
                        pushClient(cm.currentApiClient());
                    }
                } catch (eCur) {}
                try {
                    if (serverId && typeof cm.getApiClient === 'function') {
                        pushClient(cm.getApiClient(serverId));
                    }
                } catch (eById) {}
                try {
                    var allClients = typeof cm.getApiClients === 'function' ? cm.getApiClients() : cm._apiClients;
                    if (Array.isArray(allClients)) {
                        for (var a = 0; a < allClients.length; a++) {
                            pushClient(allClients[a]);
                        }
                    }
                } catch (eAll) {}
                try {
                    if (serverId && typeof cm.getApi === 'function') {
                        var sdkApi = cm.getApi(serverId);
                        if (sdkApi && typeof sdkApi.update === 'function') {
                            sdkApi.update({
                                basePath: address,
                                accessToken: authPayload.accessToken
                            });
                        }
                    }
                } catch (eCmSdk) {}
            }

            for (var tIdx = 0; tIdx < targetClients.length; tIdx++) {
                var client = targetClients[tIdx];
                patchSingleApiClientInstance(client);
                if (client._serverInfo) {
                    if (serverId) {
                        client._serverInfo.Id = serverId;
                    }
                    client._serverInfo.UserId = authPayload.userId;
                    client._serverInfo.AccessToken = authPayload.accessToken;
                    client._serverInfo.ManualAddress = client._serverInfo.ManualAddress || address;
                    client._serverInfo.LocalAddress = client._serverInfo.LocalAddress || address;
                }
                var prevCurrentUser = client._currentUser || null;
                try {
                    if (typeof client.setAuthenticationInfo === 'function') {
                        client.setAuthenticationInfo(authPayload.accessToken, authPayload.userId);
                    }
                } catch (eAuth) {}
                // NOTE: In @jellyfin/sdk, Api.prototype.accessToken is a getter-only property!
                // Never assign client._sdk.accessToken = ... directly in strict mode; call _sdk.update() instead.
                try {
                    if (client._sdk && typeof client._sdk.update === 'function') {
                        client._sdk.update({
                            basePath: address,
                            accessToken: authPayload.accessToken
                        });
                    }
                } catch (eSdk) {}
                if (authPayload.user) {
                    if (serverId && !authPayload.user.ServerId) {
                        authPayload.user.ServerId = serverId;
                    }
                    if (!authPayload.user.Id && authPayload.user.id) {
                        authPayload.user.Id = authPayload.user.id;
                    }
                    if (!authPayload.user.Name && authPayload.user.name) {
                        authPayload.user.Name = authPayload.user.name;
                    }
                    if (!authPayload.user.Policy && authPayload.user.policy) {
                        authPayload.user.Policy = authPayload.user.policy;
                    }
                    if (authPayload.user.Policy && authPayload.user.Policy.IsAdministrator === undefined && authPayload.user.Policy.isAdministrator !== undefined) {
                        authPayload.user.Policy.IsAdministrator = Boolean(authPayload.user.Policy.isAdministrator);
                    }
                    client._currentUser = authPayload.user;
                    try {
                        if (typeof client.onAuthenticated === 'function') {
                            var authRes = client.onAuthenticated(client, {
                                User: authPayload.user,
                                SessionInfo: authPayload.sessionInfo || null,
                                AccessToken: authPayload.accessToken,
                                ServerId: serverId || (authPayload.user && authPayload.user.ServerId) || ''
                            });
                            if (authRes && typeof authRes.then === 'function') {
                                authPromises.push(authRes.catch(function () {}));
                            }
                        }
                    } catch (eOnAuth) {}
                } else if (prevCurrentUser && normalizeGuid(prevCurrentUser.Id || prevCurrentUser.id) === normalizeGuid(authPayload.userId)) {
                    client._currentUser = prevCurrentUser;
                } else {
                    client._currentUser = null;
                }
            }

            probeWebGpuAdapterOnce();
            syncAutomaticWebGpuPlayerPreference();
        } catch (e) {}
        return authPromises.length > 0 ? Promise.all(authPromises) : Promise.resolve();
    }

    function sanitizeHexColor(raw, fallback) {
        var s = String(raw == null ? '' : raw).trim();
        return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : (fallback || '#E50914');
    }

    function normalizeProfileModel(p, index) {
        p = p || {};
        var idx = typeof index === 'number' ? index : 0;
        var color = sanitizeHexColor(p.avatarColorHex || p.color, AVATAR_COLORS[idx % AVATAR_COLORS.length]);
        var icon = String(p.avatarEmoji || p.icon || (p.isKids ? '🦊' : AVATAR_ICONS[idx % AVATAR_ICONS.length])).slice(0, 16);
        var googleLocked = Boolean(p.googleLocked || p.googleAccountEmail);
        return {
            id: p.id || ('streamflix_profile_' + idx),
            name: p.name || ('Profile ' + (idx + 1)),
            color: color,
            icon: icon,
            avatarColorIndex: typeof p.avatarColorIndex === 'number' ? p.avatarColorIndex : 0,
            avatarIconIndex: typeof p.avatarIconIndex === 'number' ? p.avatarIconIndex : 0,
            isKids: Boolean(p.isKids),
            kidsExitPinRequired: p.kidsExitPinRequired !== false,
            isAdmin: Boolean(p.isAdmin),
            isOwner: Boolean(p.isOwner || p.id === 'streamflix_owner'),
            canActivate: p.canActivate !== false,
            canManageGuestPasses: Boolean(p.canManageGuestPasses || (p.isAdmin && !p.isKids)),
            autoplayNextEpisode: p.autoplayNextEpisode !== false,
            autoplayPreviews: p.autoplayPreviews !== false,
            allowedLibraryIds: Array.isArray(p.allowedLibraryIds) ? p.allowedLibraryIds.slice() : [],
            seerrRequestQuota: typeof p.seerrRequestQuota === 'number' ? p.seerrRequestQuota : 0,
            bedtimeStart: String(p.bedtimeStart || ''),
            bedtimeEnd: String(p.bedtimeEnd || ''),
            maxParentalRating: p.maturityRating || p.maxParentalRating || (p.isKids ? 'Older Kids (TV-Y7 / PG)' : 'TV-MA / R (All Maturity Levels)'),
            hasPin: Boolean(p.hasPin),
            pinLength: typeof p.pinLength === 'number' ? p.pinLength : 0,
            googleLocked: googleLocked,
            accountLockKind: String(p.accountLockKind || '').toLowerCase(),
            googleAccountEmail: p.googleAccountEmail || '',
            googleAccountHint: p.googleAccountHint || '',
            googleLockSatisfied: googleLocked ? Boolean(p.googleLockSatisfied) : true,
            jellyfinUserId: p.jellyfinUserId || '',
            jellyfinUsername: p.jellyfinUsername || p.name || ''
        };
    }

    /* Household session (issued by /StreamFlix/VerifyGoogle, /Auth/StandardLogin, /Auth/AdminLogin, or /Guest/*; HMAC-signed by the server) */
    function loadHouseholdSession() {
        var s = loadJson(GOOGLE_KEY, null);
        if (!s || !s.token || (!s.email && !s.username && s.authKind !== 'guest_pass')) {
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
        clearAdminAuth();
        saveJson(GOOGLE_KEY, null);
    }

    function isOpenWithoutLogin(cfg) {
        cfg = cfg || state.config;
        if (!cfg) {
            return false;
        }
        return Boolean(cfg.bypassLoginGateOnLan && cfg.isLocalLan);
    }

    function hasHouseholdAccess() {
        var cfg = state.config;
        if (!cfg || isOpenWithoutLogin(cfg)) {
            return true;
        }
        if (cfg.hasAccess) {
            return true;
        }
        // Until the server has answered, trust a locally stored (unexpired) session token
        return !state.configFresh && Boolean(state.googleUser && state.googleUser.token);
    }

    function isGuestPassSession() {
        return Boolean(
            (state.config && state.config.isGuestPass)
            || (state.googleUser && state.googleUser.authKind === 'guest_pass')
        );
    }

    function areGuestPassesEnabled() {
        return !(state.config && state.config.enableGuestPasses === false);
    }

    function isCurrentProfileSeerrAllowed() {
        var cfg = state.config;
        if (!cfg || !cfg.seerrEnabled) {
            return false;
        }
        if (isGuestPassSession() && !cfg.seerrAllowGuests) {
            return false;
        }
        if (state.activeProfile && state.activeProfile.isKids && !cfg.seerrAllowKids) {
            return false;
        }
        if (state.activeProfile && Number(state.activeProfile.seerrRequestQuota) < 0 && !isHouseholdAdmin()) {
            return false;
        }
        return Boolean(state.activeProfile && state.activeProfile.id);
    }

    function clearShowcaseAndMediaCaches() {
        try { localStorage.removeItem(SHOWCASE_ITEMS_KEY); } catch (e) {}
        state.itemCache = {};
        state.seerrSearchResults = null;
        state.seerrSearchLoading = false;
        state.ambientCache = {};
        state.personalRowsByUser = {};
        if (state.hubData) {
            state.hubData.heroItems = [];
            state.hubData.filteredHeroPool = [];
            state.hubData.popularScores = {};
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
            state.config.approvedOidcUsers = [];
        }
    }

    function handleHouseholdSessionLost() {
        var hadSession = Boolean(state.googleUser && state.googleUser.token);
        var wasGuest = isGuestPassSession();
        clearHouseholdSession();
        var openAccess = isOpenWithoutLogin(state.config);
        if (state.config) {
            state.config.hasAccess = openAccess;
            state.config.session = null;
            state.config.isAdmin = false;
            state.config.isGuestPass = false;
            state.config.guestPassLabel = '';
            state.config.guestPassExpiresAt = null;
            state.config.lockedProfileId = null;
            if (!openAccess) {
                clearShowcaseAndMediaCaches();
            }
        }
        if (state.verifyingGoogle || !state.config || openAccess) {
            return;
        }
        state.activatingProfileId = null;
        renderGoogleAuthGate(null, hadSession
            ? (wasGuest ? 'Your Guest Pass has expired or was revoked.' : 'Your sign-in expired. Please sign in again.')
            : null);
    }

    function applyConfigFromServerResponse(cfg) {
        if (!cfg || typeof cfg !== 'object') {
            return state.config;
        }
        var prevCfg = state.config || DEFAULT_CONFIG;
        var rawProfiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
        var normalizedProfiles = rawProfiles.map(function (p, i) {
            return normalizeProfileModel(p, i);
        });
        var requireGoogle = true;
        var isLocalLan = Boolean(cfg.isLocalLan);
        var bypassLan = Boolean(cfg.bypassLoginGateOnLan);
        var resolvedAccess = Boolean(cfg.hasAccess) || (bypassLan && isLocalLan);
        var serverShowcase = [];
        if (resolvedAccess) {
            serverShowcase = Array.isArray(cfg.showcaseItems) && cfg.showcaseItems.length > 0
                ? cfg.showcaseItems
                : ((prevCfg && Array.isArray(prevCfg.showcaseItems)) ? prevCfg.showcaseItems : []);
            if (serverShowcase.length > 0) {
                saveJson(SHOWCASE_ITEMS_KEY, serverShowcase);
            }
        } else {
            try { localStorage.removeItem(SHOWCASE_ITEMS_KEY); } catch (e) {}
        }

        var nextHeroLibs = Array.isArray(cfg.heroLibraryIds)
            ? cfg.heroLibraryIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
            : [];
        var prevHeroLibsSig = Array.isArray(prevCfg.heroLibraryIds) ? prevCfg.heroLibraryIds.join(',') : '';
        var nextHeroLibsSig = nextHeroLibs.join(',');

        var nextShowLibsInNav = cfg.showLibrariesInNav !== false;
        var nextNavHiddenBuiltIns = Array.isArray(cfg.navHiddenBuiltIns)
            ? cfg.navHiddenBuiltIns.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean)
            : [];
        var nextNavLibraryIds = Array.isArray(cfg.navLibraryIds)
            ? cfg.navLibraryIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
            : [];
        var prevNavSig = String(prevCfg.showLibrariesInNav !== false) + '|'
            + (Array.isArray(prevCfg.navHiddenBuiltIns) ? prevCfg.navHiddenBuiltIns.join(',') : '') + '|'
            + (Array.isArray(prevCfg.navLibraryIds) ? prevCfg.navLibraryIds.join(',') : '');
        var nextNavSig = String(nextShowLibsInNav) + '|' + nextNavHiddenBuiltIns.join(',') + '|' + nextNavLibraryIds.join(',');

        var nextTop10Mode = String(cfg.top10SelectionMode || 'most_played').toLowerCase();
        var nextHeroRot = cfg.heroRotationSeconds !== undefined && cfg.heroRotationSeconds !== null
            ? Math.max(0, Math.min(120, Number(cfg.heroRotationSeconds) || 0))
            : 9;
        var nextHeroCount = Math.max(1, Math.min(15, Number(cfg.heroSlideCount) || 8));
        var nextHeroSel = String(cfg.heroSelectionMode || 'recent').toLowerCase();
        var nextHeroType = String(cfg.heroContentType || 'all').toLowerCase();

        var hubSettingsChanged = prevCfg.top10SelectionMode !== nextTop10Mode
            || prevCfg.heroRotationSeconds !== nextHeroRot
            || prevCfg.heroSlideCount !== nextHeroCount
            || prevCfg.heroSelectionMode !== nextHeroSel
            || prevCfg.heroContentType !== nextHeroType
            || prevHeroLibsSig !== nextHeroLibsSig
            || prevNavSig !== nextNavSig;

        state.pluginDisabled = false;
        state.configFresh = true;
        state.configAttempted = true;
        state.config = {
            version: cfg.version || '',
            assetVersion: cfg.assetVersion || cfg.version || VERSION,
            serverId: cfg.serverId || (prevCfg && prevCfg.serverId) || '',
            serverName: cfg.serverName || 'StreamFlix',
            customBrandName: typeof cfg.customBrandName === 'string' ? cfg.customBrandName.trim() : '',
            customAccentColor: sanitizeHexColor(cfg.customAccentColor, '#E50914'),
            enableStreamFlixUi: cfg.enableStreamFlixUi !== false,
            requireGoogleAuth: requireGoogle,
            enableGoogleSignIn: cfg.enableGoogleSignIn !== false,
            enableCustomOidc: Boolean(cfg.enableCustomOidc),
            oidcConfigured: Boolean(cfg.oidcConfigured),
            oidcProviderName: (typeof cfg.oidcProviderName === 'string' && cfg.oidcProviderName.trim()) ? cfg.oidcProviderName.trim() : 'Single Sign-On',
            oidcRequireAllowlist: Boolean(cfg.oidcRequireAllowlist),
            hasOidcClientSecret: Boolean(cfg.hasOidcClientSecret),
            allowStandardJellyfinLogin: Boolean(cfg.allowStandardJellyfinLogin),
            allowAdminFallbackLogin: Boolean(cfg.allowAdminFallbackLogin),
            adminFallbackLanOnly: Boolean(cfg.adminFallbackLanOnly),
            bypassLoginGateOnLan: bypassLan,
            treatTailscaleAsLocalLan: cfg.treatTailscaleAsLocalLan !== false,
            isLocalLan: isLocalLan,
            canShowAdminFallback: cfg.canShowAdminFallback !== undefined
                ? Boolean(cfg.canShowAdminFallback)
                : (Boolean(cfg.allowAdminFallbackLogin) && (!cfg.adminFallbackLanOnly || isLocalLan)),
            googleClientId: cfg.googleClientId || '',
            googleConfigured: cfg.googleConfigured !== undefined ? Boolean(cfg.googleConfigured) : Boolean(cfg.googleClientId),
            hasGoogleClientSecret: Boolean(cfg.hasGoogleClientSecret),
            hasAccess: resolvedAccess,
            isAdmin: Boolean(cfg.isAdmin),
            enableGuestPasses: cfg.enableGuestPasses !== false,
            enableWatchTogether: cfg.enableWatchTogether !== false,
            hasAnyAdultPin: Boolean(cfg.hasAnyAdultPin),
            isGuestPass: Boolean(cfg.isGuestPass),
            guestPassLabel: typeof cfg.guestPassLabel === 'string' ? cfg.guestPassLabel : '',
            guestPassExpiresAt: cfg.guestPassExpiresAt || null,
            lockedProfileId: cfg.lockedProfileId || null,
            seerrEnabled: Boolean(cfg.seerrEnabled),
            seerrAllowKids: Boolean(cfg.seerrAllowKids),
            seerrAllowGuests: Boolean(cfg.seerrAllowGuests),
            session: cfg.session || null,
            top10SelectionMode: nextTop10Mode,
            heroRotationSeconds: nextHeroRot,
            heroSlideCount: nextHeroCount,
            heroSelectionMode: nextHeroSel,
            heroContentType: nextHeroType,
            heroLibraryIds: nextHeroLibs,
            showLibrariesInNav: nextShowLibsInNav,
            navHiddenBuiltIns: nextNavHiddenBuiltIns,
            navLibraryIds: nextNavLibraryIds,
            approvedGoogleAccounts: Array.isArray(cfg.approvedGoogleAccounts) ? cfg.approvedGoogleAccounts : [],
            approvedOidcUsers: Array.isArray(cfg.approvedOidcUsers) ? cfg.approvedOidcUsers : [],
            serverUsers: Array.isArray(cfg.serverUsers) ? cfg.serverUsers : [],
            serverLibraries: Array.isArray(cfg.serverLibraries) ? cfg.serverLibraries : [],
            showcaseItems: serverShowcase,
            profiles: normalizedProfiles
        };

        if (state.activeProfile && state.activeProfile.id && normalizedProfiles.length > 0) {
            for (var apIdx = 0; apIdx < normalizedProfiles.length; apIdx++) {
                if (normalizedProfiles[apIdx].id === state.activeProfile.id) {
                    state.activeProfile.isAdmin = normalizedProfiles[apIdx].isAdmin;
                    state.activeProfile.canManageGuestPasses = normalizedProfiles[apIdx].canManageGuestPasses;
                    saveJson(PROFILE_KEY, state.activeProfile);
                    break;
                }
            }
        }

        // A token the server no longer accepts has expired or been revoked ("Sign out all devices")
        if (state.googleUser && state.googleUser.token) {
            if (!cfg.session) {
                clearHouseholdSession();
            } else {
                var sessionUpdated = false;
                if (cfg.session.expiresAt && cfg.session.expiresAt !== state.googleUser.expiresAt) {
                    state.googleUser.expiresAt = cfg.session.expiresAt;
                    sessionUpdated = true;
                }
                if (cfg.session.authKind && cfg.session.authKind !== state.googleUser.authKind) {
                    state.googleUser.authKind = cfg.session.authKind;
                    sessionUpdated = true;
                }
                if (cfg.session.username && cfg.session.username !== state.googleUser.username) {
                    state.googleUser.username = cfg.session.username;
                    sessionUpdated = true;
                }
                if (cfg.session.providerName && cfg.session.providerName !== state.googleUser.providerName) {
                    state.googleUser.providerName = cfg.session.providerName;
                    sessionUpdated = true;
                }
                if (cfg.session.guestPassId && cfg.session.guestPassId !== state.googleUser.guestPassId) {
                    state.googleUser.guestPassId = cfg.session.guestPassId;
                    sessionUpdated = true;
                }
                if (cfg.session.lockedProfileId && cfg.session.lockedProfileId !== state.googleUser.lockedProfileId) {
                    state.googleUser.lockedProfileId = cfg.session.lockedProfileId;
                    sessionUpdated = true;
                }
                if (sessionUpdated) {
                    saveJson(GOOGLE_KEY, state.googleUser);
                }
            }
        }

        if (!resolvedAccess) {
            clearAdminAuth();
            if (state.activeProfile) {
                clearActiveProfileState(true);
                state.sessionVerifiedOnce = false;
            }
            clearLocalJellyfinAuth();
            scheduleLifecycleTick(0);
        }

        if (typeof applyBrandAccentTheme === 'function') {
            applyBrandAccentTheme();
        }

        if (state.config.assetVersion) {
            clearStaleHtmlCaches(state.config.assetVersion);
            neutralizeConflictingBrandingCss();
        }

        saveJson(CACHED_CONFIG_KEY, state.config);
        var wm = document.querySelector('#streamflix-overlay-root .streamflix-wordmark');
        if (wm) {
            wm.textContent = getBrandLogoText();
        }
        replaceToolbarLogoInPlace();
        refreshNetflixBackdropWallInPlace();

        if (hubSettingsChanged && state.hubData && state.hubData.loaded) {
            if (prevHeroLibsSig !== nextHeroLibsSig) {
                loadCinemaHubData(true);
            } else {
                recomputeHubDerivedLists();
                if (document.getElementById('streamflix-cinema-hub')) {
                    renderCinemaHubContents();
                    restartHeroTimer();
                }
            }
        }
        return state.config;
    }
