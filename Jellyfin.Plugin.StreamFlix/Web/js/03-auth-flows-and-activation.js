/* StreamFlix Client (03/14) — Google OAuth, Custom OIDC, Guest Handoff & Profile Activation */
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
        var relayPrefix = 'sf_jmp_';
        if (result.state && result.state.indexOf(relayPrefix) === 0) {
            var relayCandidate = result.state.slice(relayPrefix.length).trim().toLowerCase();
            if (/^[0-9a-f]{16,64}$/.test(relayCandidate)) {
                result.desktopRelayStateId = relayCandidate;
                result.stateOk = true;
            } else {
                result.stateOk = false;
            }
        } else {
            result.desktopRelayStateId = '';
            result.stateOk = Boolean(expected) && expected === result.state;
        }

        state.justCompletedGoogleOAuth = true;
        if (typeof capturePendingWatchPartyFromUrl === 'function') {
            capturePendingWatchPartyFromUrl();
        }
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

    function canOpenExternalSystemBrowser() {
        try {
            return Boolean(isJellyfinMediaPlayerApp() && window.NativeShell && typeof window.NativeShell.openUrl === 'function');
        } catch (e) {
            return false;
        }
    }

    var desktopAuthPollTimer = null;

    function stopDesktopAuthPollTimerIfIdle() {
        if (!loadPendingGoogleDesktopFlow() && !loadPendingOidcFlow()) {
            if (desktopAuthPollTimer) {
                clearInterval(desktopAuthPollTimer);
                desktopAuthPollTimer = null;
            }
        }
    }

    function ensureDesktopAuthPollTimer() {
        if (desktopAuthPollTimer) {
            return;
        }
        desktopAuthPollTimer = setInterval(function () {
            if (hasHouseholdAccess()) {
                clearPendingGoogleDesktopFlow();
                clearPendingOidcFlow();
                stopDesktopAuthPollTimerIfIdle();
                return;
            }
            pollPendingGoogleDesktopFlowIfActive();
            pollPendingOidcFlowIfActive();
            stopDesktopAuthPollTimerIfIdle();
        }, 1500);
    }

    function savePendingGoogleDesktopFlow(stateId, pollSecret) {
        if (!stateId || !pollSecret) {
            return;
        }
        var payload = JSON.stringify({
            stateId: String(stateId),
            pollSecret: String(pollSecret),
            startedAt: Date.now()
        });
        try { sessionStorage.setItem(GOOGLE_DESKTOP_PENDING_KEY, payload); } catch (e1) {}
        try { localStorage.setItem(GOOGLE_DESKTOP_PENDING_KEY, payload); } catch (e2) {}
    }

    function loadPendingGoogleDesktopFlow() {
        var raw = '';
        try { raw = sessionStorage.getItem(GOOGLE_DESKTOP_PENDING_KEY) || ''; } catch (e1) {}
        if (!raw) {
            try { raw = localStorage.getItem(GOOGLE_DESKTOP_PENDING_KEY) || ''; } catch (e2) {}
        }
        if (!raw) {
            return null;
        }
        try {
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.stateId || !parsed.pollSecret) {
                clearPendingGoogleDesktopFlow();
                return null;
            }
            if (parsed.startedAt && (Date.now() - Number(parsed.startedAt) > 10 * 60 * 1000)) {
                clearPendingGoogleDesktopFlow();
                return null;
            }
            return parsed;
        } catch (e3) {
            clearPendingGoogleDesktopFlow();
            return null;
        }
    }

    function clearPendingGoogleDesktopFlow() {
        try { sessionStorage.removeItem(GOOGLE_DESKTOP_PENDING_KEY); } catch (e1) {}
        try { localStorage.removeItem(GOOGLE_DESKTOP_PENDING_KEY); } catch (e2) {}
    }

    function cancelPendingDesktopAuthFlows() {
        state.startingGoogleDesktopRelay = false;
        state.startingOidcRedirect = false;
        clearPendingGoogleDesktopFlow();
        clearPendingOidcFlow();
        stopDesktopAuthPollTimerIfIdle();
        if (!hasHouseholdAccess()) {
            renderGoogleAuthGate();
        }
    }

    function pollPendingGoogleDesktopFlowIfActive() {
        if (state.googleDesktopPollInFlight || state.verifyingGoogle || hasHouseholdAccess()) {
            if (hasHouseholdAccess()) {
                clearPendingGoogleDesktopFlow();
            }
            return;
        }
        var pendingFlow = loadPendingGoogleDesktopFlow();
        if (!pendingFlow || !pendingFlow.stateId || !pendingFlow.pollSecret) {
            return;
        }
        state.googleDesktopPollInFlight = true;
        apiFetch('/StreamFlix/Auth/GoogleDesktopPoll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stateId: pendingFlow.stateId,
                pollSecret: pendingFlow.pollSecret
            })
        }).then(function (res) {
            state.googleDesktopPollInFlight = false;
            if (!res || !res.status || res.status === 'pending') {
                return;
            }
            clearPendingGoogleDesktopFlow();
            state.startingGoogleDesktopRelay = false;
            stopDesktopAuthPollTimerIfIdle();
            if (res.status === 'complete' && res.verified && res.sessionToken) {
                state.justCompletedGoogleOAuth = true;
                setHouseholdSession({
                    token: res.sessionToken,
                    email: res.email,
                    name: res.name || res.email,
                    picture: res.picture || '',
                    expiresAt: res.expiresAt || ''
                });
                state.activeProfile = null;
                localStorage.removeItem(PROFILE_KEY);
                var pendingId = res.pendingProfileId || takePendingProfileId();
                fetchPublicConfig().then(function () {
                    renderProfilePickerGate();
                    var pending = pendingId ? findProfileById(pendingId) : null;
                    if (pending) {
                        handleSelectProfile(pending);
                    } else {
                        showToast('Signed in as ' + res.email, 'success');
                    }
                });
                return;
            }
            if (res.status === 'error' && res.message && !hasHouseholdAccess()) {
                takePendingProfileId();
                renderGoogleAuthGate(null, res.message);
            } else if (!hasHouseholdAccess()) {
                renderGoogleAuthGate();
            }
        }).catch(function () {
            state.googleDesktopPollInFlight = false;
        });
    }

    function startGoogleOAuthRedirect(pendingProfileId, loginHint) {
        var clientId = state.config && state.config.googleClientId;
        if (!clientId) {
            showToast('Google Sign-In isn\'t configured on this server yet.', 'error');
            return;
        }
        if (canOpenExternalSystemBrowser()) {
            if (state.startingGoogleDesktopRelay || state.verifyingGoogle) {
                return;
            }
            state.startingGoogleDesktopRelay = true;
            try {
                if (pendingProfileId) {
                    sessionStorage.setItem(PENDING_PROFILE_KEY, pendingProfileId);
                } else {
                    sessionStorage.removeItem(PENDING_PROFILE_KEY);
                }
            } catch (ePend) {}
            if (!hasHouseholdAccess()) {
                renderGoogleAuthGate('Finish Google sign-in in your browser…');
            }
            apiFetch('/StreamFlix/Auth/GoogleDesktopBegin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pendingProfileId: pendingProfileId || '',
                    loginHint: loginHint || ''
                })
            }).then(function (res) {
                if (!res || !res.stateId || !res.pollSecret) {
                    throw new Error((res && res.message) || 'Could not start Google sign-in.');
                }
                savePendingGoogleDesktopFlow(res.stateId, res.pollSecret);
                var extUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
                    + '?client_id=' + encodeURIComponent(clientId)
                    + '&redirect_uri=' + encodeURIComponent(getGoogleRedirectUri())
                    + '&response_type=token'
                    + '&scope=' + encodeURIComponent('openid email profile')
                    + '&state=' + encodeURIComponent('sf_jmp_' + res.stateId)
                    + '&include_granted_scopes=true'
                    + '&prompt=select_account'
                    + (loginHint ? '&login_hint=' + encodeURIComponent(loginHint) : '');
                ensureDesktopAuthPollTimer();
                window.NativeShell.openUrl(extUrl);
            }).catch(function (err) {
                state.startingGoogleDesktopRelay = false;
                clearPendingGoogleDesktopFlow();
                var msg = (err && err.message) || 'Could not start Google sign-in.';
                if (!hasHouseholdAccess()) {
                    renderGoogleAuthGate(null, msg);
                } else {
                    showToast(msg, 'error');
                }
            });
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

    function verifyGoogleAccessToken(accessToken, desktopRelayStateId) {
        state.verifyingGoogle = true;
        renderGoogleAuthGate('Verifying your Google account…');

        return apiFetch('/StreamFlix/VerifyGoogle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: accessToken,
                approveIfUnlisted: false,
                desktopRelayStateId: desktopRelayStateId || ''
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
            clearActiveProfileState(true);

            var pendingId = takePendingProfileId();
            return fetchPublicConfig().then(function () {
                renderProfilePickerGate();
                var pending = pendingId ? findProfileById(pendingId) : null;
                if (pending && !res.desktopRelayCompleted) {
                    handleSelectProfile(pending);
                } else if (res.desktopRelayCompleted) {
                    showToast('Signed in as ' + res.email + ' — you can return to Jellyfin Media Player.', 'success', 6000);
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
       1b. Custom OpenID Connect (OIDC) Authorization Code + PKCE Flow (Beta)
       ---------------------------------------------------------------------- */
    function getOidcProviderLabel() {
        var name = state.config && typeof state.config.oidcProviderName === 'string'
            ? state.config.oidcProviderName.trim()
            : '';
        return name || 'Single Sign-On';
    }

    function extractOidcCallbackFromUrl() {
        var searchStr = (window.location.search || '').replace(/^\?/, '');
        var hashStr = (window.location.hash || '');
        var raw = searchStr + '&' + hashStr;
        if (raw.indexOf('sf_oidc=') === -1 && raw.indexOf('sf_oidc_error=') === -1) {
            return null;
        }
        var param = function (name) {
            var match = raw.match(new RegExp('(?:[#?&/]|^)' + name + '=([^&#]+)'));
            if (!match) {
                return '';
            }
            try {
                return decodeURIComponent(match[1].replace(/\+/g, ' '));
            } catch (e) {
                return match[1];
            }
        };
        var okFlag = param('sf_oidc');
        var errMsg = param('sf_oidc_error');
        var stateId = param('sf_state');
        if (!okFlag && !errMsg) {
            return null;
        }
        state.justCompletedGoogleOAuth = true;
        if (typeof capturePendingWatchPartyFromUrl === 'function') {
            capturePendingWatchPartyFromUrl();
        }
        try {
            window.history.replaceState(null, document.title, window.location.pathname + '#/home');
        } catch (e) {
            window.location.hash = '#/home';
        }
        return {
            complete: okFlag === '1',
            error: errMsg,
            stateId: stateId || ''
        };
    }

    function savePendingOidcFlow(stateId, pollSecret) {
        if (!stateId || !pollSecret) {
            return;
        }
        var payload = JSON.stringify({
            stateId: String(stateId),
            pollSecret: String(pollSecret),
            startedAt: Date.now()
        });
        try { sessionStorage.setItem(OIDC_PENDING_KEY, payload); } catch (e1) {}
        try { localStorage.setItem(OIDC_PENDING_KEY, payload); } catch (e2) {}
    }

    function loadPendingOidcFlow() {
        var raw = '';
        try { raw = sessionStorage.getItem(OIDC_PENDING_KEY) || ''; } catch (e1) {}
        if (!raw) {
            try { raw = localStorage.getItem(OIDC_PENDING_KEY) || ''; } catch (e2) {}
        }
        if (!raw) {
            return null;
        }
        try {
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.stateId || !parsed.pollSecret) {
                clearPendingOidcFlow();
                return null;
            }
            if (parsed.startedAt && (Date.now() - Number(parsed.startedAt) > 10 * 60 * 1000)) {
                clearPendingOidcFlow();
                return null;
            }
            return parsed;
        } catch (e3) {
            clearPendingOidcFlow();
            return null;
        }
    }

    function clearPendingOidcFlow() {
        try { sessionStorage.removeItem(OIDC_PENDING_KEY); } catch (e1) {}
        try { localStorage.removeItem(OIDC_PENDING_KEY); } catch (e2) {}
    }

    function isMobileOrNativeWebView() {
        try {
            if (window.NativeShell || window.NativeInterface || window.ReactNativeWebView) {
                return true;
            }
            if (window.webkit && window.webkit.messageHandlers) {
                return true;
            }
            var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
            return /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
        } catch (e) {
            return false;
        }
    }

    function navigateExternalNoReferrer(url) {
        if (canOpenExternalSystemBrowser()) {
            ensureDesktopAuthPollTimer();
            window.NativeShell.openUrl(url);
            return;
        }
        // On mobile apps & embedded WebViews (jellyfin-expo WKWebView / Android WebView), synthetic <a rel="noreferrer">.click()
        // can trigger external browser interception instead of navigating the active WebView. Use location.assign directly there.
        if (isMobileOrNativeWebView()) {
            window.location.assign(url);
            return;
        }
        try {
            var a = document.createElement('a');
            a.href = url;
            a.rel = 'noreferrer';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                if (a.parentNode) {
                    a.parentNode.removeChild(a);
                }
            }, 0);
        } catch (e) {
            window.location.assign(url);
        }
    }

    function startOidcRedirect(pendingProfileId, loginHint) {
        if (!state.config || !state.config.enableCustomOidc || !state.config.oidcConfigured) {
            showToast('OpenID Connect isn\'t configured on this server yet.', 'error');
            return;
        }
        if (state.startingOidcRedirect || state.verifyingGoogle) {
            return;
        }
        state.startingOidcRedirect = true;

        try {
            if (pendingProfileId) {
                sessionStorage.setItem(PENDING_PROFILE_KEY, pendingProfileId);
            } else {
                sessionStorage.removeItem(PENDING_PROFILE_KEY);
            }
        } catch (e) {}

        var providerLabel = getOidcProviderLabel();
        if (!hasHouseholdAccess()) {
            renderGoogleAuthGate('Connecting to ' + providerLabel + '…');
        } else {
            var btn = document.getElementById('streamflix-oidc-login-btn');
            if (btn) {
                btn.disabled = true;
                btn.classList.add('streamflix-btn-loading');
            }
        }

        apiFetch('/StreamFlix/Oidc/Begin', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                returnWebBase: window.location.pathname || '/web/',
                pendingProfileId: pendingProfileId || '',
                loginHint: loginHint || ''
            })
        }).then(function (res) {
            if (!res || !res.authorizeUrl) {
                throw new Error((res && res.message) || ('Could not start ' + providerLabel + ' sign-in.'));
            }
            if (res.stateId && res.pollSecret) {
                savePendingOidcFlow(res.stateId, res.pollSecret);
            }
            navigateExternalNoReferrer(res.authorizeUrl);
        }).catch(function (err) {
            state.startingOidcRedirect = false;
            clearPendingOidcFlow();
            var msg = (err && err.message) || ('Could not start ' + providerLabel + ' sign-in.');
            if (!hasHouseholdAccess()) {
                renderGoogleAuthGate(null, msg);
            } else {
                showToast(msg, 'error');
            }
        });
    }

    function applyVerifiedOidcSession(res, providerLabel) {
        clearPendingOidcFlow();
        state.startingOidcRedirect = false;
        var resolvedProvider = res.providerName || providerLabel || getOidcProviderLabel();
        var resolvedEmail = res.email || '';
        var resolvedUser = res.username || res.name || (resolvedEmail ? '' : 'user');
        setHouseholdSession({
            token: res.sessionToken,
            authKind: 'oidc',
            providerName: resolvedProvider,
            email: resolvedEmail,
            username: resolvedUser,
            name: res.name || resolvedEmail || resolvedUser,
            picture: res.picture || '',
            expiresAt: res.expiresAt || ''
        });

        state.activeProfile = null;
        localStorage.removeItem(PROFILE_KEY);

        var pendingId = res.pendingProfileId || takePendingProfileId();
        return fetchPublicConfig().then(function () {
            renderProfilePickerGate();
            var pending = pendingId ? findProfileById(pendingId) : null;
            if (pending) {
                handleSelectProfile(pending);
            } else {
                var who = resolvedEmail || resolvedUser || resolvedProvider;
                showToast('Signed in via ' + resolvedProvider + (who && who !== resolvedProvider ? (' as ' + who) : ''), 'success');
            }
            return res;
        });
    }

    function completeOidcHandoff(oidcCb) {
        state.verifyingGoogle = true;
        var providerLabel = getOidcProviderLabel();
        renderGoogleAuthGate('Completing ' + providerLabel + ' sign-in…');
        var pendingFlow = loadPendingOidcFlow();
        var reqStateId = (oidcCb && oidcCb.stateId) || (pendingFlow && pendingFlow.stateId) || '';
        var reqPollSecret = (pendingFlow && (!reqStateId || pendingFlow.stateId === reqStateId)) ? pendingFlow.pollSecret : '';

        return apiFetch('/StreamFlix/Oidc/Complete', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stateId: reqStateId,
                pollSecret: reqPollSecret
            })
        }).then(function (res) {
            state.verifyingGoogle = false;
            if (!res || !res.verified || !res.sessionToken) {
                clearPendingOidcFlow();
                takePendingProfileId();
                renderGoogleAuthGate(null, (res && res.message) || (providerLabel + ' verification failed.'));
                return null;
            }
            return applyVerifiedOidcSession(res, providerLabel);
        }).catch(function (err) {
            state.verifyingGoogle = false;
            clearPendingOidcFlow();
            takePendingProfileId();
            renderGoogleAuthGate(null, (err && err.message) || (providerLabel + ' sign-in failed.'));
        });
    }

    function pollPendingOidcFlowIfActive() {
        if (state.oidcPollInFlight || state.verifyingGoogle || hasHouseholdAccess()) {
            if (hasHouseholdAccess()) {
                clearPendingOidcFlow();
            }
            return;
        }
        var pendingFlow = loadPendingOidcFlow();
        if (!pendingFlow || !pendingFlow.stateId || !pendingFlow.pollSecret) {
            return;
        }
        state.oidcPollInFlight = true;
        var providerLabel = getOidcProviderLabel();
        apiFetch('/StreamFlix/Oidc/Poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stateId: pendingFlow.stateId,
                pollSecret: pendingFlow.pollSecret
            })
        }).then(function (res) {
            state.oidcPollInFlight = false;
            if (!res || !res.status || res.status === 'pending') {
                return;
            }
            if (res.status === 'complete' && res.verified && res.sessionToken) {
                state.justCompletedGoogleOAuth = true;
                applyVerifiedOidcSession(res, providerLabel);
                return;
            }
            clearPendingOidcFlow();
            state.startingOidcRedirect = false;
            if (res.status === 'error' && res.message && !hasHouseholdAccess()) {
                takePendingProfileId();
                renderGoogleAuthGate(null, res.message);
            } else if (!hasHouseholdAccess()) {
                renderGoogleAuthGate();
            }
        }).catch(function () {
            state.oidcPollInFlight = false;
        });
    }

    /* ----------------------------------------------------------------------
       1c. Temporary Guest Pass Handoff & Code Redemption
       ---------------------------------------------------------------------- */
    function extractGuestCallbackFromUrl() {
        var searchStr = (window.location.search || '').replace(/^\?/, '');
        var hashStr = (window.location.hash || '');
        var raw = searchStr + '&' + hashStr;
        if (raw.indexOf('sf_guest=') === -1 && raw.indexOf('sf_guest_error=') === -1) {
            return null;
        }
        var param = function (name) {
            var match = raw.match(new RegExp('(?:[#?&/]|^)' + name + '=([^&#]+)'));
            if (!match) {
                return '';
            }
            try {
                return decodeURIComponent(match[1].replace(/\+/g, ' '));
            } catch (e) {
                return match[1];
            }
        };
        var okFlag = param('sf_guest');
        var errMsg = param('sf_guest_error');
        if (!okFlag && !errMsg) {
            return null;
        }
        state.justCompletedGoogleOAuth = true;
        if (typeof capturePendingWatchPartyFromUrl === 'function') {
            capturePendingWatchPartyFromUrl();
        }
        try {
            window.history.replaceState(null, document.title, window.location.pathname + '#/home');
        } catch (e) {
            window.location.hash = '#/home';
        }
        return {
            complete: okFlag === '1',
            error: errMsg
        };
    }

    function applyGuestRedemptionResponse(res) {
        state.guestPassExpanded = false;
        state.adminLoginExpanded = false;
        var passLabel = res.guestPassLabel || 'Guest Pass';
        setHouseholdSession({
            token: res.sessionToken,
            authKind: 'guest_pass',
            email: '',
            username: passLabel,
            name: passLabel,
            guestPassId: res.guestPassId || '',
            lockedProfileId: res.lockedProfileId || '',
            picture: '',
            expiresAt: res.expiresAt || ''
        });

        var act = res.activation;
        if (act && act.accessToken && act.userId) {
            var activated = normalizeProfileModel(act.profile || { id: res.lockedProfileId, name: act.userName || passLabel }, 0);
            activated.jellyfinUserId = act.userId || activated.jellyfinUserId;
            activated.jellyfinUsername = act.userName || act.jellyfinUsername || activated.jellyfinUsername;
            activated.accessToken = act.accessToken;
            activated.serverId = act.serverId || (state.config && state.config.serverId) || '';

            saveActiveProfileState(activated, true);

            applyJellyfinServerCredentials({
                serverId: activated.serverId,
                userId: activated.jellyfinUserId,
                accessToken: activated.accessToken,
                user: act.user || null,
                sessionInfo: act.sessionInfo || null
            });

            return fetchPublicConfig().then(function () {
                closeOverlayGate();
                closeAccountDropdown();
                ensureHeaderWidgets();
                var normUid = normalizeGuid(activated.jellyfinUserId);
                try {
                    sessionStorage.setItem('streamflix_reload_uid', normUid || 'guest');
                } catch (e) {}
                window.location.hash = '#/home';
                window.location.reload();
                return res;
            });
        }

        clearActiveProfileState(true);
        return fetchPublicConfig().then(function () {
            var locked = res.lockedProfileId ? findProfileById(res.lockedProfileId) : (getProfiles()[0] || null);
            if (locked) {
                handleSelectProfile(locked);
            } else {
                renderProfilePickerGate();
            }
            showToast('Welcome! Guest Pass activated.', 'success');
            return res;
        });
    }

    function completeGuestHandoff() {
        state.verifyingGoogle = true;
        renderGoogleAuthGate('Activating your Guest Pass…');
        var dev = getJellyfinDeviceInfo();
        return apiFetch('/StreamFlix/Guest/Complete', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                appName: dev.appName,
                appVersion: dev.appVersion
            })
        }).then(function (res) {
            state.verifyingGoogle = false;
            if (!res || !res.verified || !res.sessionToken) {
                renderGoogleAuthGate(null, (res && res.message) || 'Guest Pass could not be activated.');
                return null;
            }
            return applyGuestRedemptionResponse(res);
        }).catch(function (err) {
            state.verifyingGoogle = false;
            renderGoogleAuthGate(null, (err && err.message) || 'Guest Pass could not be activated.');
        });
    }

    function redeemGuestPassCode(rawCode) {
        var cleaned = String(rawCode || '').trim();
        // Accept full invite URLs pasted into the code input as well as raw codes
        var urlMatch = cleaned.match(/\/StreamFlix\/Guest\/([A-Za-z0-9_-]+)/i);
        if (urlMatch && urlMatch[1]) {
            cleaned = urlMatch[1];
        }
        var dev = getJellyfinDeviceInfo();
        return apiFetch('/StreamFlix/Guest/Redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: cleaned,
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                appName: dev.appName,
                appVersion: dev.appVersion
            })
        }).then(function (res) {
            if (!res || !res.verified || !res.sessionToken) {
                var e = new Error((res && res.message) || 'Invalid or expired Guest Pass.');
                throw e;
            }
            state.justCompletedGoogleOAuth = true;
            return applyGuestRedemptionResponse(res);
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
        if (typeof enforceKidsRouteGuard === 'function' && enforceKidsRouteGuard()) {
            return;
        }
        var onHome = isOnHomeRoute();
        if (document.body) {
            document.body.classList.toggle('streamflix-on-home', onHome);
        }

        var h = window.location.hash || '';
        if (h === '#!/home.html' || h === '#!/home' || h === '#/home.html' || h === '#!/index.html' || h === '#/index.html') {
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
        if ((hLower.indexOf('#/search') === 0 || hLower.indexOf('#!/search') === 0) && state.cinemaHubEnabled !== false) {
            state.mobileSearchOpen = true;
            var qMatch = h.match(/[?&]query=([^&]+)/i);
            if (qMatch && qMatch[1]) {
                try {
                    state.searchQuery = decodeURIComponent(qMatch[1]);
                } catch (eDec) {
                    state.searchQuery = qMatch[1];
                }
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

    function activateServerProfile(profile, suppliedPin, extraOpts) {
        extraOpts = extraOpts || {};
        var dev = getJellyfinDeviceInfo();
        var prevUserId = (state.activeProfile && state.activeProfile.jellyfinUserId)
            || (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : '');
        var exitingKidsId = extraOpts.exitingKidsProfileId
            || ((state.activeProfile && state.activeProfile.isKids && !profile.isKids) ? state.activeProfile.id : '');
        var adultExitPinVal = extraOpts.usePinAsAdultExit
            ? (suppliedPin || '')
            : (extraOpts.adultExitPin || '');
        state.activatingProfileId = profile.id;
        return apiFetch('/StreamFlix/Profiles/Activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profileId: profile.id,
                pin: suppliedPin || '',
                pinCode: suppliedPin || '',
                exitingKidsProfileId: exitingKidsId,
                adultExitPin: adultExitPinVal,
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

            saveActiveProfileState(activated, true);

            if (activated.isAdmin && activated.accessToken && activated.jellyfinUserId && !isGuestPassSession()) {
                saveAdminAuth({
                    userId: activated.jellyfinUserId,
                    userName: activated.jellyfinUsername || activated.name,
                    accessToken: activated.accessToken,
                    serverId: activated.serverId,
                    user: res.user || null
                });
            } else {
                clearAdminAuth();
            }

            if (state.config) {
                var sessionHasAdmin = Boolean(state.googleUser && (state.googleUser.isAdmin || state.googleUser.authKind === 'jellyfin_admin'));
                state.config.isAdmin = (Boolean(activated.isAdmin) || sessionHasAdmin) && !isGuestPassSession();
                if (!state.config.isAdmin) {
                    state.config.serverUsers = [];
                    state.config.approvedGoogleAccounts = [];
                    state.config.approvedOidcUsers = [];
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
            if (typeof clearKidsExitSession === 'function') {
                clearKidsExitSession();
            }
            if (activated.isKids && typeof leaveWatchPartyRoom === 'function' && typeof watchPartyState !== 'undefined' && watchPartyState.activeGroup) {
                leaveWatchPartyRoom();
            }
            state.kidsWorld = 'all';
            ensureHeaderWidgets();

            // Reset Cinema Hub, search, browse filter, and per-user item/episode caches for the newly selected profile
            if (typeof cancelPendingSearch === 'function') {
                cancelPendingSearch();
            }
            state.itemCache = {};
            state.browseFilter = null;
            state.libraryBrowser = null;
            state.libraryViewData = {};
            state.searchQuery = '';
            state.searchResults = null;
            state.seerrSearchResults = null;
            if (typeof osdState !== 'undefined' && osdState) {
                osdState.episodesCache = {};
            }
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
            if (!state.hubData.loading && !state.hubData.loaded) {
                loadCinemaHubData(false);
            }
            return activated;
        }).catch(function (err) {
            state.activatingProfileId = null;
            throw err;
        });
    }

    function getUnderlyingApiClientAuth() {
        var client = null;
        try {
            if (window.ServerConnections && typeof window.ServerConnections.currentApiClient === 'function') {
                client = window.ServerConnections.currentApiClient();
            }
        } catch (eSc) {}
        client = client || window.ApiClient || null;
        if (!client) {
            return { client: null, loggedIn: false, userId: '', accessToken: '', isAdmin: false };
        }
        var srv = client._serverInfo || {};
        var rawUid = srv.UserId || (typeof client.__origGetCurrentUserId === 'function' ? client.__origGetCurrentUserId() : '');
        var rawTok = srv.AccessToken || (typeof client.__origAccessToken === 'function' ? client.__origAccessToken() : '');
        var loggedIn = typeof client.__origIsLoggedIn === 'function'
            ? Boolean(client.__origIsLoggedIn())
            : Boolean(client._loggedIn);
        var u = client._currentUser;
        var pol = u && (u.Policy || u.policy);
        var uIsAdmin = Boolean(pol && (pol.IsAdministrator === true || pol.isAdministrator === true));
        return {
            client: client,
            loggedIn: loggedIn,
            userId: rawUid || '',
            accessToken: rawTok || '',
            isAdmin: Boolean(loggedIn && u && uIsAdmin && normalizeGuid(u.Id || u.id) === normalizeGuid(rawUid))
        };
    }

    function isCurrentJellyfinClientAdmin() {
        try {
            var info = getUnderlyingApiClientAuth();
            return Boolean(info.client && info.loggedIn && info.accessToken && info.isAdmin);
        } catch (e) {
            return false;
        }
    }

    var adminBounceTimer = null;

    function openEmbeddedStreamFlixSettingsModal() {
        var existing = document.getElementById('bfx-embedded-admin-modal');
        if (existing) {
            return;
        }
        state.embeddedAdminModalOpen = true;
        closeAccountDropdown();
        closeOverlayGate();

        var backdrop = document.createElement('div');
        backdrop.id = 'bfx-embedded-admin-modal';
        backdrop.className = 'bfx-embedded-admin-backdrop';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-label', getBrandName() + ' Plugin Settings');
        backdrop.innerHTML = ''
            + '<div class="bfx-embedded-admin-shell">'
            + '  <div class="bfx-embedded-admin-topbar">'
            + '    <button type="button" class="streamflix-ghost-btn" id="bfx-embedded-admin-close">' + icon('chevronLeft') + '<span>Back to ' + escapeHtml(getBrandName()) + '</span></button>'
            + '    <span class="bfx-embedded-admin-title">' + escapeHtml(getBrandName()) + ' Plugin Settings</span>'
            + '  </div>'
            + '  <div class="bfx-embedded-admin-body" id="bfx-embedded-admin-body">'
            + '    <div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Loading Plugin Settings…</span></div>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(backdrop);

        var closeEmbedded = function () {
            var cfgEl = backdrop.querySelector('#StreamFlixConfigPage');
            if (cfgEl) {
                try { cfgEl.dispatchEvent(new CustomEvent('viewhide')); } catch (eHide) {}
            }
            state.embeddedAdminModalOpen = false;
            if (backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
            if (state.activeProfile && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
                applyJellyfinServerCredentials({
                    serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                    userId: state.activeProfile.jellyfinUserId,
                    accessToken: state.activeProfile.accessToken
                });
            }
            fetchPublicConfig().catch(function () {});
            scheduleLifecycleTick(0);
        };

        var closeBtn = backdrop.querySelector('#bfx-embedded-admin-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeEmbedded);
        }

        if (!window.Dashboard) {
            window.Dashboard = {
                showLoadingMsg: function () {},
                hideLoadingMsg: function () {},
                alert: function (msg) { showToast(typeof msg === 'string' ? msg : ((msg && msg.message) || ''), 'info'); },
                navigate: function (route) {
                    closeEmbedded();
                    window.location.hash = '#/' + String(route || 'home').replace(/^#!?\/?/, '');
                }
            };
        }

        apiFetch('/StreamFlix/AdminPageHtml').then(function (res) {
            var bodyEl = document.getElementById('bfx-embedded-admin-body');
            if (!bodyEl || !res || !res.html) {
                throw new Error('Could not load StreamFlix settings view.');
            }
            var doc = new DOMParser().parseFromString(String(res.html), 'text/html');
            var pageNode = doc.getElementById('StreamFlixConfigPage');
            if (!pageNode) {
                throw new Error('Invalid StreamFlix settings markup.');
            }
            var scripts = Array.prototype.slice.call(pageNode.querySelectorAll('script'));
            scripts.forEach(function (s) {
                if (s.parentNode) {
                    s.parentNode.removeChild(s);
                }
            });
            bodyEl.innerHTML = '';
            var importedPage = document.importNode(pageNode, true);
            importedPage.classList.remove('hide');
            bodyEl.appendChild(importedPage);

            scripts.forEach(function (origScript) {
                var liveScript = document.createElement('script');
                liveScript.textContent = origScript.textContent || '';
                importedPage.appendChild(liveScript);
            });

            setTimeout(function () {
                try {
                    importedPage.dispatchEvent(new CustomEvent('viewshow'));
                } catch (eShow) {}
            }, 20);
        }).catch(function (err) {
            var bodyEl = document.getElementById('bfx-embedded-admin-body');
            if (bodyEl) {
                bodyEl.innerHTML = buildEmptyStateHtml('gear', 'Could not load Plugin Settings', (err && err.message) || 'Administrator access is required.');
            }
        });
    }

    function armPluginConfigBounceFallback(cleanRoute) {
        if (adminBounceTimer) {
            clearTimeout(adminBounceTimer);
            adminBounceTimer = null;
        }
        var lower = String(cleanRoute || '').toLowerCase();
        if (lower.indexOf('configurationpage') !== 0 || lower.indexOf('streamflix') === -1) {
            return;
        }
        adminBounceTimer = setTimeout(function () {
            adminBounceTimer = null;
            if (document.getElementById('StreamFlixConfigPage') || document.getElementById('bfx-embedded-admin-modal')) {
                return;
            }
            var curHash = String(window.location.hash || '').toLowerCase();
            var bouncedToHome = curHash === '' || curHash === '#' || curHash === '#/' || curHash.indexOf('#/home') === 0 || curHash.indexOf('#!/home') === 0;
            var hasFallback = Boolean(document.querySelector('#fallbackPage:not(.hide)'));
            if (bouncedToHome || hasFallback) {
                openEmbeddedStreamFlixSettingsModal();
            }
        }, 2200);
    }

    function navigateDirectAdminTarget(targetHash) {
        var raw = String(targetHash || '#/dashboard').trim();
        var cleanRoute = raw.replace(/^#!?\/?/, '').replace(/^\/+/, '') || 'dashboard';
        var hashDest = '#/' + cleanRoute;
        state.manageMode = false;
        closeAccountDropdown();
        closeOverlayGate();
        var existingHub = document.getElementById('streamflix-cinema-hub');
        if (existingHub) {
            existingHub.style.display = 'none';
        }
        if (document.body) {
            document.body.classList.remove('streamflix-hub-filtered', 'streamflix-hub-active');
        }
        armPluginConfigBounceFallback(cleanRoute);
        try {
            if (window.Dashboard && typeof window.Dashboard.navigate === 'function') {
                window.Dashboard.navigate(cleanRoute);
                return;
            }
        } catch (eNav) {}
        window.location.hash = hashDest;
    }

    function enterAdminRouteWithAuth(adminAuthObj, targetHash) {
        var raw = String(targetHash || '#/configurationpage?name=StreamFlix').trim();
        var cleanRoute = raw.replace(/^#!?\/?/, '').replace(/^\/+/, '') || 'dashboard';
        var hashDest = '#/' + cleanRoute;

        var beforeInfo = getUnderlyingApiClientAuth();
        var alreadySyncedInMemory = Boolean(
            beforeInfo.client
            && beforeInfo.loggedIn
            && beforeInfo.isAdmin
            && normalizeGuid(beforeInfo.userId) === normalizeGuid(adminAuthObj.userId)
            && beforeInfo.accessToken === adminAuthObj.accessToken
        );

        saveAdminAuth(adminAuthObj);
        var syncPromise = applyJellyfinServerCredentials({
            serverId: adminAuthObj.serverId || (state.config && state.config.serverId) || '',
            userId: adminAuthObj.userId,
            accessToken: adminAuthObj.accessToken,
            user: (state.adminAuth && state.adminAuth.user) || adminAuthObj.user || null,
            sessionInfo: adminAuthObj.sessionInfo || null
        });

        // When window.ApiClient already exists in memory (including Jellyfin iOS jellyfin-expo WKWebView & Safari),
        // NEVER call window.location.reload() — reloading resets mobile WKWebView wrappers back to #/home!
        // Wait for client.onAuthenticated (localusersignedin -> React UserProvider commit) before navigating.
        if (beforeInfo.client) {
            if (alreadySyncedInMemory) {
                navigateDirectAdminTarget(hashDest);
                return;
            }
            Promise.resolve(syncPromise).then(function () {
                setTimeout(function () {
                    navigateDirectAdminTarget(hashDest);
                }, 65);
            });
            return;
        }

        // Only perform a one-shot boot reload when window.ApiClient has not been created yet at all
        var lastReloadTs = 0;
        try {
            lastReloadTs = Number(sessionStorage.getItem('streamflix_admin_reload_ts') || 0);
        } catch (eSt) {}

        if (!lastReloadTs || (Date.now() - lastReloadTs > 8000)) {
            try {
                sessionStorage.setItem('streamflix_admin_reload_ts', String(Date.now()));
            } catch (eSet) {}
            state.manageMode = false;
            closeAccountDropdown();
            closeOverlayGate();
            if (window.location.hash !== hashDest) {
                window.location.hash = hashDest;
            }
            setTimeout(function () {
                window.location.reload();
            }, 20);
            return;
        }

        navigateDirectAdminTarget(hashDest);
    }

    var adminElevationInFlight = false;
    function warmAdminAuthSilently() {
        var canElevateCurrent = (typeof isActiveProfileAdmin === 'function' && isActiveProfileAdmin())
            || isCurrentJellyfinClientAdmin();
        if (state.adminWarmAttempted
            || adminElevationInFlight
            || isGuestPassSession()
            || !canElevateCurrent
            || (state.adminAuth && state.adminAuth.accessToken && state.adminAuth.userId)) {
            return;
        }
        state.adminWarmAttempted = true;
        var dev = getJellyfinDeviceInfo();
        apiFetch('/StreamFlix/Auth/ElevateAdmin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                appName: dev.appName,
                appVersion: dev.appVersion,
                pin: ''
            })
        }).then(function (res) {
            if (res && res.accessToken && res.userId) {
                saveAdminAuth({
                    userId: res.userId,
                    userName: res.userName || 'Administrator',
                    accessToken: res.accessToken,
                    serverId: res.serverId || (state.config && state.config.serverId) || '',
                    user: res.user || null
                });
            }
        }).catch(function () {});
    }

    function openStreamFlixAdminRoute(targetHash, suppliedPin) {
        var dest = String(targetHash || '#/configurationpage?name=StreamFlix').trim();
        if (isGuestPassSession()) {
            showToast('Guest Pass sessions cannot open Administrator settings.', 'error');
            return;
        }
        var canUseAdmin = (typeof isActiveProfileAdmin === 'function' && isActiveProfileAdmin())
            || isCurrentJellyfinClientAdmin()
            || (!state.activeProfile && isHouseholdAdmin());
        if (!canUseAdmin) {
            showToast('Switch to an Administrator profile first to open Server Settings.', 'error');
            return;
        }
        if (!suppliedPin && isCurrentJellyfinClientAdmin()) {
            var liveInfo = getUnderlyingApiClientAuth();
            if (liveInfo.userId && liveInfo.accessToken) {
                saveAdminAuth({
                    userId: liveInfo.userId,
                    userName: (liveInfo.client && liveInfo.client._currentUser && liveInfo.client._currentUser.Name) || 'Administrator',
                    accessToken: liveInfo.accessToken,
                    serverId: resolveKnownServerId(),
                    user: (liveInfo.client && liveInfo.client._currentUser) || null
                });
            }
            navigateDirectAdminTarget(dest);
            return;
        }
        if (!suppliedPin && state.adminAuth && state.adminAuth.accessToken && state.adminAuth.userId) {
            enterAdminRouteWithAuth(state.adminAuth, dest);
            return;
        }
        if (adminElevationInFlight) {
            return;
        }
        adminElevationInFlight = true;
        var dev = getJellyfinDeviceInfo();
        apiFetch('/StreamFlix/Auth/ElevateAdmin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                appName: dev.appName,
                appVersion: dev.appVersion,
                pin: suppliedPin || ''
            })
        }).then(function (res) {
            adminElevationInFlight = false;
            if (!res || !res.accessToken || !res.userId) {
                throw new Error('Could not activate Administrator session.');
            }
            if (state.config) {
                state.config.isAdmin = true;
                if (res.serverId) {
                    state.config.serverId = res.serverId;
                }
                saveJson(CACHED_CONFIG_KEY, state.config);
            }
            enterAdminRouteWithAuth({
                userId: res.userId,
                userName: res.userName || 'Administrator',
                accessToken: res.accessToken,
                serverId: res.serverId || (state.config && state.config.serverId) || '',
                user: res.user || null,
                sessionInfo: res.sessionInfo || null
            }, dest);
        }).catch(function (err) {
            adminElevationInFlight = false;
            var code = err && err.code;
            if ((code === 'pin_required' || code === 'pin_invalid') && typeof openPinPad === 'function') {
                var ownerProf = getProfiles().filter(function (p) { return p.isOwner || p.isAdmin; })[0] || { name: 'Administrator', icon: '👑', color: '#E50914' };
                openPinPad({
                    profile: ownerProf,
                    title: 'Administrator PIN',
                    subtitleHtml: 'Enter the PIN for <strong>' + escapeHtml(ownerProf.name) + '</strong> to open settings.',
                    initialError: code === 'pin_invalid' ? err.message : '',
                    submit: function (pin) {
                        openStreamFlixAdminRoute(dest, pin);
                        return Promise.resolve();
                    }
                });
                return;
            }
            showToast((err && err.message) || 'Administrator access is required to open Plugin Settings.', 'error');
        });
    }
