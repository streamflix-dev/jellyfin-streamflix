/* StreamFlix Client (04/14) — Modal Primitives, PIN Pad & Sign-In Gate */
    /* ----------------------------------------------------------------------
       UI primitives: overlay stage, modals, toasts, confirm dialogs, PIN pad
       ---------------------------------------------------------------------- */
    var GOOGLE_G_SVG = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
    var OIDC_SSO_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.5" cy="12" r="4.2"/><path d="M12.7 12H21M18 12v3M21 12v2.2"/></svg>';
    var JELLYFIN_USER_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';
    var GOOGLE_BADGE_SVG = '<svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
    var OIDC_BADGE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.5" cy="12" r="4.2"/><path d="M12.7 12H21M18 12v3M21 12v2.2"/></svg>';
    var JELLYFIN_BADGE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';

    function getProfileLockMeta(p) {
        var cfg = state.config || {};
        var googleOn = Boolean(cfg.enableGoogleSignIn !== false && cfg.googleConfigured);
        var oidcOn = Boolean(cfg.enableCustomOidc && cfg.oidcConfigured);
        var stdOn = Boolean(cfg.allowStandardJellyfinLogin);
        var rawKind = String((p && p.accountLockKind) || '').toLowerCase();
        var rawVal = String((p && p.googleAccountEmail) || '').trim();
        var isEmailLike = !rawVal || rawVal.indexOf('@') !== -1;

        var kind = rawKind;
        if (kind === 'jellyfin') {
            kind = 'jellyfin';
        } else if (kind === 'oidc') {
            kind = (!oidcOn && googleOn && isEmailLike) ? 'google' : 'oidc';
        } else if (kind === 'google') {
            kind = (!googleOn && oidcOn) ? 'oidc' : 'google';
        } else if (kind === 'sso') {
            kind = (oidcOn && !googleOn) ? 'oidc' : ((googleOn && !oidcOn) ? 'google' : 'sso');
        } else if (rawVal && !isEmailLike) {
            kind = oidcOn ? 'oidc' : 'jellyfin';
        } else if (oidcOn && !googleOn) {
            kind = 'oidc';
        } else if (googleOn && oidcOn) {
            kind = 'sso';
        } else if (!googleOn && !oidcOn && stdOn) {
            kind = 'jellyfin';
        } else {
            kind = 'google';
        }

        if (kind === 'jellyfin') {
            return {
                kind: 'jellyfin',
                badgeClass: 'is-jellyfin',
                badgeSvg: JELLYFIN_BADGE_SVG,
                providerLabel: 'Jellyfin'
            };
        }
        if (kind === 'oidc') {
            return {
                kind: 'oidc',
                badgeClass: 'is-oidc',
                badgeSvg: OIDC_BADGE_SVG,
                providerLabel: getOidcProviderLabel()
            };
        }
        if (kind === 'sso') {
            return {
                kind: 'sso',
                badgeClass: 'is-oidc',
                badgeSvg: OIDC_BADGE_SVG,
                providerLabel: 'SSO'
            };
        }
        return {
            kind: 'google',
            badgeClass: 'is-google',
            badgeSvg: GOOGLE_BADGE_SVG,
            providerLabel: 'Google'
        };
    }

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
                + '  <div class="streamflix-wordmark">' + escapeHtml(getBrandLogoText()) + '</div>'
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
        state.explicitPickerOpen = false;
        state.explicitAuthPrompt = false;
        state.openedDirectlyToManage = false;
        state.manageMode = false;
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
        var safeModalCls = sanitizeClassNames(options.className);
        backdrop.innerHTML = '<div class="streamflix-modal' + (safeModalCls ? ' ' + safeModalCls : '') + '" role="dialog" aria-modal="true">' + innerHtml + '</div>';
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
            + '</div>', {
                className: 'streamflix-modal-pin',
                onClose: opts.onClose
            });

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
        var noBackdropMap = state.noBackdropItemIds || {};

        function pushCandidate(id, name, type, hasBackdrop, hasPrimary) {
            if (!id) {
                return;
            }
            var norm = normalizeGuid(id);
            if (!norm || seen[norm]) {
                return;
            }
            seen[norm] = true;
            var resolvedBackdrop = noBackdropMap[norm]
                ? false
                : (typeof hasBackdrop === 'boolean' ? hasBackdrop : undefined);
            var resolvedPrimary = typeof hasPrimary === 'boolean' ? hasPrimary : true;
            list.push({
                id: String(id),
                name: String(name || 'Featured Title'),
                type: String(type || 'Movie'),
                hasBackdrop: resolvedBackdrop,
                hasPrimary: resolvedPrimary
            });
        }

        function inferDtoBackdrop(it) {
            return Boolean(
                (Array.isArray(it.BackdropImageTags) && it.BackdropImageTags.length > 0)
                || (Array.isArray(it.ParentBackdropImageTags) && it.ParentBackdropImageTags.length > 0)
            );
        }

        function inferDtoPrimary(it) {
            return Boolean((it.ImageTags && it.ImageTags.Primary) || it.SeriesPrimaryImageTag);
        }

        // 1. Server-provided showcaseItems from /StreamFlix/PublicConfig ([AllowAnonymous])
        if (state.config && Array.isArray(state.config.showcaseItems)) {
            state.config.showcaseItems.forEach(function (it) {
                if (it && (it.id || it.Id)) {
                    var hb = typeof it.hasBackdrop === 'boolean' ? it.hasBackdrop : (it.BackdropImageTags ? inferDtoBackdrop(it) : undefined);
                    var hp = typeof it.hasPrimary === 'boolean' ? it.hasPrimary : (it.ImageTags ? inferDtoPrimary(it) : true);
                    pushCandidate(it.id || it.Id, it.name || it.Name, it.type || it.Type, hb, hp);
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
                            pushCandidate(it.Id, it.Name, it.Type, inferDtoBackdrop(it), inferDtoPrimary(it));
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
                    var hbCached = typeof it.hasBackdrop === 'boolean' ? it.hasBackdrop : undefined;
                    var hpCached = typeof it.hasPrimary === 'boolean' ? it.hasPrimary : true;
                    pushCandidate(it.id || it.Id, it.name || it.Name, it.type || it.Type, hbCached, hpCached);
                }
            });
        }

        // 4. Cached items in state.itemCache
        if (state.itemCache && typeof state.itemCache === 'object') {
            Object.keys(state.itemCache).forEach(function (k) {
                var it = state.itemCache[k];
                if (it && it.Id && (it.Type === 'Movie' || it.Type === 'Series')) {
                    pushCandidate(it.Id, it.Name, it.Type, inferDtoBackdrop(it), inferDtoPrimary(it));
                }
            });
        }

        // Prefer titles with verified backdrops first so the wall avoids missing-image tiles
        var withBd = list.filter(function (x) { return x.hasBackdrop === true; });
        var other = list.filter(function (x) { return x.hasBackdrop !== true && (x.hasBackdrop !== false || x.hasPrimary !== false); });
        return withBd.length >= 12 ? withBd.concat(other) : list;
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
        var brandInitial = getBrandLogoText().charAt(0) || 'S';
        var noBackdropMap = state.noBackdropItemIds || {};
        var tilesHtml = '';

        for (var i = 0; i < totalTiles; i++) {
            var palette = fallbackPalettes[i % fallbackPalettes.length];
            if (items.length > 0) {
                var item = items[i % items.length];
                var normId = normalizeGuid(item.id);
                var eid = encodeURIComponent(item.id);
                var canUseBackdrop = item.hasBackdrop !== false && !noBackdropMap[normId];
                var canUsePrimary = item.hasPrimary !== false;
                var backdropSrc = base + '/Items/' + eid + '/Images/Backdrop/0?maxWidth=520&quality=80';
                var primarySrc = base + '/Items/' + eid + '/Images/Primary?maxWidth=380&quality=80';
                var imgTagHtml = '';
                if (canUseBackdrop) {
                    imgTagHtml = '  <img src="' + escapeHtml(backdropSrc) + '"'
                        + (canUsePrimary ? (' data-fallback-src="' + escapeHtml(primarySrc) + '"') : '')
                        + ' data-wall-item-id="' + escapeHtml(normId) + '" data-wall-kind="backdrop" alt="' + escapeHtml(item.name) + '" loading="eager" decoding="async" />';
                } else if (canUsePrimary) {
                    imgTagHtml = '  <img src="' + escapeHtml(primarySrc) + '" data-wall-item-id="' + escapeHtml(normId) + '" data-wall-kind="primary" alt="' + escapeHtml(item.name) + '" loading="eager" decoding="async" />';
                }
                tilesHtml += ''
                    + '<div class="streamflix-netflix-wall-tile" style="background:' + palette + ';">'
                    + imgTagHtml
                    + '  <span class="streamflix-netflix-wall-badge">' + escapeHtml(brandInitial) + '</span>'
                    + '  <div class="streamflix-netflix-wall-caption">' + escapeHtml(item.name) + '</div>'
                    + '</div>';
            } else {
                tilesHtml += ''
                    + '<div class="streamflix-netflix-wall-tile" style="background:' + palette + ';">'
                    + '  <span class="streamflix-netflix-wall-badge">' + escapeHtml(brandInitial) + '</span>'
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
                var wallId = img.getAttribute('data-wall-item-id');
                if (wallId && img.getAttribute('data-wall-kind') === 'backdrop') {
                    state.noBackdropItemIds[wallId] = true;
                }
                var fallback = img.getAttribute('data-fallback-src');
                if (fallback && img.getAttribute('data-tried-fallback') !== '1') {
                    img.setAttribute('data-tried-fallback', '1');
                    img.setAttribute('data-wall-kind', 'primary');
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
       3. Screen A: Sign-In Gate (Google OAuth, Standard Jellyfin Login, Hybrid Mode & Admin Sign-In)
       ---------------------------------------------------------------------- */
    function buildPasswordLoginFormHtml(opts) {
        opts = opts || {};
        var endpoint = opts.endpoint || '/StreamFlix/Auth/StandardLogin';
        var btnLabel = opts.buttonLabel || 'Sign In';
        var userLabel = opts.usernamePlaceholder || 'Jellyfin username';
        var pwdLabel = opts.passwordPlaceholder || 'Password';
        var adminOnly = Boolean(opts.adminOnly);
        return ''
            + '<form class="streamflix-login-form" id="streamflix-password-login-form" data-endpoint="' + escapeHtml(endpoint) + '" data-admin-only="' + (adminOnly ? '1' : '0') + '" novalidate>'
            + '  <div class="streamflix-auth-alert streamflix-auth-alert-error" id="streamflix-login-form-error" style="display:none;" role="alert" aria-live="assertive"></div>'
            + '  <div class="streamflix-login-field">'
            + '    <input type="text" class="streamflix-login-input" id="streamflix-login-username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="' + escapeHtml(userLabel) + '" aria-label="' + escapeHtml(userLabel) + '" required />'
            + '  </div>'
            + '  <div class="streamflix-login-field streamflix-login-pwd-wrap">'
            + '    <input type="password" class="streamflix-login-input" id="streamflix-login-password" name="password" autocomplete="current-password" placeholder="' + escapeHtml(pwdLabel) + '" aria-label="' + escapeHtml(pwdLabel) + '" />'
            + '    <button type="button" class="streamflix-pwd-toggle" id="streamflix-pwd-toggle-btn" title="Show password" aria-label="Show password">' + icon('eye') + '</button>'
            + '  </div>'
            + '  <button type="submit" class="streamflix-btn-primary streamflix-btn-block streamflix-login-submit" id="streamflix-password-submit-btn">'
            + (adminOnly ? icon('shield') : '')
            + '    <span>' + escapeHtml(btnLabel) + '</span>'
            + '  </button>'
            + '</form>';
    }

    function bindPasswordLoginForm(root) {
        var form = root && root.querySelector('#streamflix-password-login-form');
        if (!form) {
            return;
        }
        var userIn = form.querySelector('#streamflix-login-username');
        var pwdIn = form.querySelector('#streamflix-login-password');
        var pwdToggle = form.querySelector('#streamflix-pwd-toggle-btn');
        var submitBtn = form.querySelector('#streamflix-password-submit-btn');
        var errBox = form.querySelector('#streamflix-login-form-error');
        var card = form.closest ? form.closest('.streamflix-auth-card') : null;
        var endpoint = form.getAttribute('data-endpoint') || '/StreamFlix/Auth/StandardLogin';
        var adminOnly = form.getAttribute('data-admin-only') === '1';
        var busy = false;

        if (pwdToggle && pwdIn) {
            pwdToggle.addEventListener('click', function () {
                var showing = pwdIn.type === 'text';
                pwdIn.type = showing ? 'password' : 'text';
                pwdToggle.innerHTML = icon(showing ? 'eye' : 'eyeOff');
                pwdToggle.title = showing ? 'Show password' : 'Hide password';
                pwdToggle.setAttribute('aria-label', pwdToggle.title);
                try { pwdIn.focus(); } catch (e) {}
            });
        }

        function showFormError(msg) {
            if (errBox) {
                errBox.textContent = msg || 'Sign-in failed.';
                errBox.style.display = 'flex';
            }
            if (card) {
                card.classList.remove('streamflix-shake');
                void card.offsetWidth;
                card.classList.add('streamflix-shake');
            }
        }

        function clearFormError() {
            if (errBox && errBox.style.display !== 'none') {
                errBox.style.display = 'none';
                errBox.textContent = '';
            }
        }

        if (userIn) {
            userIn.addEventListener('input', clearFormError);
        }
        if (pwdIn) {
            pwdIn.addEventListener('input', clearFormError);
        }

        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            if (busy) {
                return;
            }
            var username = userIn ? userIn.value.trim() : '';
            var password = pwdIn ? pwdIn.value : '';
            if (!username) {
                showFormError(adminOnly ? 'Enter a Jellyfin Administrator username.' : 'Enter your Jellyfin username.');
                if (userIn) {
                    try { userIn.focus(); } catch (e) {}
                }
                return;
            }

            busy = true;
            clearFormError();
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add('streamflix-btn-loading');
            }
            var dev = getJellyfinDeviceInfo();
            apiFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    password: password,
                    deviceId: dev.deviceId,
                    deviceName: dev.deviceName,
                    clientName: dev.appName,
                    clientVersion: dev.appVersion
                })
            }).then(function (res) {
                busy = false;
                if (!res || !res.verified || !res.sessionToken) {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.classList.remove('streamflix-btn-loading');
                    }
                    showFormError((res && res.message) || 'Sign-in could not be verified.');
                    return;
                }

                state.adminLoginExpanded = false;
                setHouseholdSession({
                    token: res.sessionToken,
                    authKind: res.authKind || (adminOnly ? 'jellyfin_admin' : 'jellyfin'),
                    email: '',
                    username: res.username || username,
                    userId: res.userId || '',
                    name: res.name || res.username || username,
                    isAdmin: Boolean(res.isAdmin || adminOnly),
                    picture: '',
                    expiresAt: res.expiresAt || ''
                });

                clearActiveProfileState(true);

                if (res.jellyfinAccessToken && res.userId) {
                    if (res.isAdmin || adminOnly) {
                        saveAdminAuth({
                            userId: res.userId,
                            userName: res.username || username,
                            accessToken: res.jellyfinAccessToken,
                            serverId: res.serverId || (state.config && state.config.serverId),
                            user: res.user || null
                        });
                    }
                    applyJellyfinServerCredentials({
                        serverId: res.serverId || (state.config && state.config.serverId),
                        userId: res.userId,
                        accessToken: res.jellyfinAccessToken,
                        user: res.user || null,
                        sessionInfo: res.sessionInfo || null
                    });
                } else {
                    clearLocalJellyfinAuth();
                }

                var pendingId = takePendingProfileId();
                return fetchPublicConfig().then(function () {
                    var pending = pendingId ? findProfileById(pendingId) : null;
                    if (!pending && !res.isAdmin && !adminOnly) {
                        var allProfs = (state.config && Array.isArray(state.config.profiles)) ? state.config.profiles : [];
                        var activatable = allProfs.filter(function (p) { return p && p.canActivate !== false; });
                        if (activatable.length === 1) {
                            pending = activatable[0];
                        }
                    }
                    renderProfilePickerGate();
                    if (pending) {
                        handleSelectProfile(pending);
                    } else {
                        showToast('Signed in as ' + (res.username || username), 'success');
                    }
                });
            }).catch(function (err) {
                busy = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('streamflix-btn-loading');
                }
                var code = err && err.code;
                showFormError((err && err.message) || 'Invalid Jellyfin username or password.');
                if (code === 'admin_only') {
                    if (userIn) {
                        try { userIn.focus(); userIn.select(); } catch (e1) {}
                    }
                } else if (pwdIn) {
                    pwdIn.value = '';
                    try { pwdIn.focus(); } catch (e2) {}
                }
            });
        });
    }

    function renderGoogleAuthGate(statusText, errorText) {
        var cfg = state.config || DEFAULT_CONFIG;
        var busy = Boolean(state.verifyingGoogle || state.startingOidcRedirect || state.startingGoogleDesktopRelay);
        var waitingExternalBrowser = Boolean((state.startingOidcRedirect || state.startingGoogleDesktopRelay)
            && typeof canOpenExternalSystemBrowser === 'function'
            && canOpenExternalSystemBrowser());
        var stageHtml;
        var viewKey = 'auth';

        if (!state.configFresh && !state.configAttempted && !cfg.googleConfigured && !cfg.oidcConfigured && !cfg.allowStandardJellyfinLogin) {
            // Server config hasn't arrived yet: show a neutral loader instead of flashing the setup card
            setGateView('loading', '', ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card streamflix-auth-card-loading"><span class="streamflix-inline-spinner"></span></div>'
                + '</div>');
            return;
        }

        var googleEnabled = cfg.enableGoogleSignIn !== false && Boolean(cfg.googleConfigured);
        var oidcEnabled = Boolean(cfg.enableCustomOidc && cfg.oidcConfigured);
        var ssoEnabled = googleEnabled || oidcEnabled;
        var oidcLabel = getOidcProviderLabel();
        var stdEnabled = Boolean(cfg.allowStandardJellyfinLogin);
        var canAdminFallback = Boolean(cfg.canShowAdminFallback);
        var guestPassesEnabled = areGuestPassesEnabled();

        if (!canAdminFallback && state.adminLoginExpanded) {
            state.adminLoginExpanded = false;
        }
        if (!guestPassesEnabled && state.guestPassExpanded) {
            state.guestPassExpanded = false;
        }

        var guestFootBtnHtml = guestPassesEnabled
            ? ('<button type="button" class="streamflix-admin-fallback-link streamflix-guest-pass-link" id="streamflix-expand-guest-pass">'
                + icon('ticket') + '<span>Have a Guest Pass?</span>'
                + '</button>')
            : '';

        var effectiveStatus = statusText || (waitingExternalBrowser ? 'Complete sign-in in your browser — this app will unlock automatically…' : '');
        var alertsHtml = ''
            + (effectiveStatus
                ? '<div class="streamflix-auth-alert"><span class="streamflix-inline-spinner"></span><span>' + escapeHtml(effectiveStatus) + '</span>'
                    + (waitingExternalBrowser ? ' <button type="button" class="streamflix-link-btn" id="streamflix-cancel-desktop-sso" style="margin-left:auto;">Cancel</button>' : '')
                    + '</div>'
                : '')
            + (errorText
                ? '<div class="streamflix-auth-alert streamflix-auth-alert-error">' + escapeHtml(errorText) + '</div>'
                : '');

        var ssoButtonsHtml = '<div class="streamflix-sso-stack">'
            + (googleEnabled
                ? '<button type="button" class="streamflix-google-btn" id="streamflix-google-login-btn"' + (busy ? ' disabled' : '') + '>'
                  + GOOGLE_G_SVG
                  + '<span>' + (state.startingGoogleDesktopRelay ? 'Waiting for browser…' : (busy ? 'Verifying…' : 'Continue with Google')) + '</span>'
                  + '</button>'
                : '')
            + (oidcEnabled
                ? '<button type="button" class="streamflix-oidc-btn' + (!googleEnabled ? ' streamflix-oidc-btn-primary' : '') + '" id="streamflix-oidc-login-btn"' + (busy ? ' disabled' : '') + '>'
                  + OIDC_SSO_SVG
                  + '<span>' + (state.startingOidcRedirect ? (waitingExternalBrowser ? 'Waiting for browser…' : 'Redirecting…') : (busy ? 'Verifying…' : ('Continue with ' + escapeHtml(oidcLabel)))) + '</span>'
                  + '</button>'
                : '')
            + '</div>';

        var ssoLeadCopy = (googleEnabled && oidcEnabled)
            ? ('Sign in with Google or ' + escapeHtml(oidcLabel) + ' to unlock ' + escapeHtml(getBrandName()) + ' on this device. You\'ll choose who\'s watching next.')
            : (oidcEnabled
                ? ('Sign in with ' + escapeHtml(oidcLabel) + ' to unlock ' + escapeHtml(getBrandName()) + ' on this device. You\'ll choose who\'s watching next.')
                : ('Use your approved Google account to unlock ' + escapeHtml(getBrandName()) + ' on this device. You\'ll choose who\'s watching next.'));

        var hybridLeadCopy = (googleEnabled && oidcEnabled)
            ? ('Sign in with Google, ' + escapeHtml(oidcLabel) + ', or your Jellyfin account to unlock ' + escapeHtml(getBrandName()) + ' and choose who\'s watching.')
            : ('Sign in with ' + (oidcEnabled ? escapeHtml(oidcLabel) : 'Google') + ' or your Jellyfin account to unlock ' + escapeHtml(getBrandName()) + ' and choose who\'s watching.');

        if (state.guestPassExpanded) {
            viewKey = 'auth-guest';
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card' + (busy ? ' streamflix-busy' : '') + '">'
                + '    <div class="streamflix-auth-kicker">Temporary Invite</div>'
                + '    <h1>Guest Pass</h1>'
                + '    <p>Paste your Guest Pass code or invite link below to start watching on ' + escapeHtml(getBrandName()) + '.</p>'
                + alertsHtml
                + '    <form class="streamflix-login-form" id="streamflix-guest-redeem-form" autocomplete="off">'
                + '      <div class="streamflix-login-field">'
                + '        <input type="text" class="streamflix-login-input" id="streamflix-guest-code-input" placeholder="sf_gp_… or invite link" autocomplete="off" spellcheck="false" required />'
                + '      </div>'
                + '      <div class="streamflix-login-form-error" id="streamflix-guest-form-error" aria-live="assertive"></div>'
                + '      <button type="submit" class="streamflix-btn-primary streamflix-login-submit" id="streamflix-guest-submit-btn">Redeem Guest Pass</button>'
                + '    </form>'
                + '    <div class="streamflix-auth-foot">'
                + '      <button type="button" class="streamflix-link-btn" id="streamflix-collapse-guest-pass">← Back to Sign-In</button>'
                + '    </div>'
                + '  </div>'
                + '</div>';
        } else if (!ssoEnabled && !stdEnabled) {
            // Setup / Owner-Only Mode: inline Netflix-themed Administrator login + quick setup guide
            viewKey = 'setup';
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card streamflix-auth-card-setup">'
                + '    <div class="streamflix-auth-kicker">Administrator Access</div>'
                + '    <h1>Sign in to ' + escapeHtml(getBrandName()) + '</h1>'
                + '    <p>Sign in with a Jellyfin <strong>Administrator</strong> account to open profiles or configure Google Sign-In &amp; household access in <strong>Dashboard → Plugins → StreamFlix</strong>.</p>'
                + alertsHtml
                + buildPasswordLoginFormHtml({
                    endpoint: '/StreamFlix/Auth/AdminLogin',
                    buttonLabel: 'Sign in as Administrator',
                    usernamePlaceholder: 'Administrator username',
                    passwordPlaceholder: 'Password',
                    adminOnly: true
                })
                + (guestFootBtnHtml ? ('    <div class="streamflix-auth-foot">' + guestFootBtnHtml + '</div>') : '')
                + '    <details class="streamflix-setup-hint">'
                + '      <summary>Setting up Google OAuth?</summary>'
                + '      <div class="streamflix-setup-hint-body">'
                + '        Authorized Redirect URI for Google Cloud Console:'
                + '        <code class="streamflix-auth-code">' + escapeHtml(getGoogleRedirectUri()) + '</code>'
                + '      </div>'
                + '    </details>'
                + '  </div>'
                + '</div>';
        } else if (ssoEnabled && !stdEnabled && state.adminLoginExpanded && canAdminFallback) {
            // Expanded Admin Sign-In fallback view on the SSO Sign-In screen
            viewKey = 'auth-admin';
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card">'
                + '    <div class="streamflix-auth-kicker">Server Owner</div>'
                + '    <h1>Admin Sign-In</h1>'
                + '    <p>Sign in with a Jellyfin <strong>Administrator</strong> account. Standard non-admin accounts are strictly blocked on this fallback.</p>'
                + alertsHtml
                + buildPasswordLoginFormHtml({
                    endpoint: '/StreamFlix/Auth/AdminLogin',
                    buttonLabel: 'Sign in as Administrator',
                    usernamePlaceholder: 'Administrator username',
                    passwordPlaceholder: 'Password',
                    adminOnly: true
                })
                + '    <div class="streamflix-auth-foot">'
                + '      <button type="button" class="streamflix-link-btn" id="streamflix-collapse-admin-login">← Back to Sign-In</button>'
                + '    </div>'
                + '  </div>'
                + '</div>';
        } else if (ssoEnabled && stdEnabled) {
            // Hybrid Mode: SSO (Google / OIDC) + Standard Jellyfin Account Sign-In
            viewKey = 'auth-hybrid';
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card' + (busy ? ' streamflix-busy' : '') + '">'
                + '    <h1>Sign in</h1>'
                + '    <p>' + hybridLeadCopy + '</p>'
                + alertsHtml
                + ssoButtonsHtml
                + '    <div class="streamflix-auth-divider"><span>or sign in with Jellyfin</span></div>'
                + buildPasswordLoginFormHtml({
                    endpoint: '/StreamFlix/Auth/StandardLogin',
                    buttonLabel: 'Sign in with Jellyfin Account',
                    usernamePlaceholder: 'Jellyfin username',
                    passwordPlaceholder: 'Password',
                    adminOnly: false
                })
                + (guestFootBtnHtml ? ('    <div class="streamflix-auth-foot">' + guestFootBtnHtml + '</div>') : '')
                + '  </div>'
                + '</div>';
        } else if (!ssoEnabled && stdEnabled) {
            // Standard Jellyfin Login Only (Themed Netflix-style form)
            viewKey = 'auth-standard';
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card">'
                + '    <h1>Sign in</h1>'
                + '    <p>Sign in with your Jellyfin account to unlock ' + escapeHtml(getBrandName()) + ' on this device. You\'ll choose who\'s watching next.</p>'
                + alertsHtml
                + buildPasswordLoginFormHtml({
                    endpoint: '/StreamFlix/Auth/StandardLogin',
                    buttonLabel: 'Sign In',
                    usernamePlaceholder: 'Jellyfin username',
                    passwordPlaceholder: 'Password',
                    adminOnly: false
                })
                + (guestFootBtnHtml ? ('    <div class="streamflix-auth-foot">' + guestFootBtnHtml + '</div>') : '')
                + '  </div>'
                + '</div>';
        } else {
            // SSO Only (Google, OIDC, or both) + Guest Pass + optional subtle Admin Sign-In button/link
            var adminFootBtnHtml = canAdminFallback
                ? ('<button type="button" class="streamflix-admin-fallback-link" id="streamflix-expand-admin-login">'
                    + icon('shield') + '<span>Admin Sign-In</span>'
                    + '</button>')
                : '';
            viewKey = 'auth';
            stageHtml = ''
                + '<div class="streamflix-center-stage">'
                + '  <div class="streamflix-auth-card' + (busy ? ' streamflix-busy' : '') + '">'
                + '    <h1>Sign in</h1>'
                + '    <p>' + ssoLeadCopy + '</p>'
                + alertsHtml
                + ssoButtonsHtml
                + ((guestFootBtnHtml || adminFootBtnHtml)
                    ? ('    <div class="streamflix-auth-foot streamflix-auth-foot-row">' + guestFootBtnHtml + adminFootBtnHtml + '    </div>')
                    : '')
                + '  </div>'
                + '</div>';
        }

        var hasPendingOidcNow = typeof loadPendingOidcFlow === 'function' && Boolean(loadPendingOidcFlow());
        transitionAppPhase(hasPendingOidcNow ? APP_PHASES.OIDC_PENDING : APP_PHASES.AUTH_REQUIRED);

        var authActionsHtml = (typeof canCancelExplicitAuthToPicker === 'function' && canCancelExplicitAuthToPicker())
            ? ('<button type="button" class="streamflix-ghost-btn" id="streamflix-cancel-explicit-auth-btn">'
                + icon('chevronLeft') + '<span>Back to Profiles</span></button>')
            : '';

        var root = setGateView(viewKey, authActionsHtml, stageHtml);

        var cancelExplicitAuthBtn = root.querySelector('#streamflix-cancel-explicit-auth-btn');
        if (cancelExplicitAuthBtn) {
            cancelExplicitAuthBtn.addEventListener('click', function () {
                if (typeof cancelExplicitAuthPrompt === 'function') {
                    cancelExplicitAuthPrompt();
                }
            });
        }

        var loginBtn = root.querySelector('#streamflix-google-login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', function () {
                startGoogleOAuthRedirect('', '');
            });
        }

        var oidcBtn = root.querySelector('#streamflix-oidc-login-btn');
        if (oidcBtn) {
            oidcBtn.addEventListener('click', function () {
                startOidcRedirect('', '');
            });
        }

        var cancelDesktopSsoBtn = root.querySelector('#streamflix-cancel-desktop-sso');
        if (cancelDesktopSsoBtn) {
            cancelDesktopSsoBtn.addEventListener('click', function () {
                if (typeof cancelPendingDesktopAuthFlows === 'function') {
                    cancelPendingDesktopAuthFlows();
                }
            });
        }

        var expandAdminBtn = root.querySelector('#streamflix-expand-admin-login');
        if (expandAdminBtn) {
            expandAdminBtn.addEventListener('click', function () {
                state.guestPassExpanded = false;
                state.adminLoginExpanded = true;
                renderGoogleAuthGate();
            });
        }

        var collapseAdminBtn = root.querySelector('#streamflix-collapse-admin-login');
        if (collapseAdminBtn) {
            collapseAdminBtn.addEventListener('click', function () {
                state.adminLoginExpanded = false;
                renderGoogleAuthGate();
            });
        }

        var expandGuestBtn = root.querySelector('#streamflix-expand-guest-pass');
        if (expandGuestBtn) {
            expandGuestBtn.addEventListener('click', function () {
                state.adminLoginExpanded = false;
                state.guestPassExpanded = true;
                renderGoogleAuthGate();
            });
        }

        var collapseGuestBtn = root.querySelector('#streamflix-collapse-guest-pass');
        if (collapseGuestBtn) {
            collapseGuestBtn.addEventListener('click', function () {
                state.guestPassExpanded = false;
                renderGoogleAuthGate();
            });
        }

        var guestForm = root.querySelector('#streamflix-guest-redeem-form');
        if (guestForm) {
            var guestInput = guestForm.querySelector('#streamflix-guest-code-input');
            var guestErr = guestForm.querySelector('#streamflix-guest-form-error');
            var guestSubmit = guestForm.querySelector('#streamflix-guest-submit-btn');
            var guestBusy = false;
            guestForm.addEventListener('submit', function (ev) {
                ev.preventDefault();
                if (guestBusy) {
                    return;
                }
                var val = (guestInput && guestInput.value ? guestInput.value : '').trim();
                if (!val) {
                    if (guestErr) { guestErr.textContent = 'Please enter a Guest Pass code or invite link.'; }
                    return;
                }
                guestBusy = true;
                if (guestErr) { guestErr.textContent = ''; }
                if (guestSubmit) {
                    guestSubmit.disabled = true;
                    guestSubmit.classList.add('streamflix-btn-loading');
                }
                redeemGuestPassCode(val).catch(function (err) {
                    guestBusy = false;
                    if (guestSubmit) {
                        guestSubmit.disabled = false;
                        guestSubmit.classList.remove('streamflix-btn-loading');
                    }
                    if (guestErr) {
                        guestErr.textContent = (err && err.message) || 'Invalid or expired Guest Pass.';
                    }
                    if (guestInput) {
                        try { guestInput.focus(); guestInput.select(); } catch (eSel) {}
                    }
                });
            });
        }

        bindPasswordLoginForm(root);

        if (!busy) {
            setTimeout(function () {
                var primarySsoBtn = loginBtn || oidcBtn;
                var focusTarget = viewKey === 'auth-guest'
                    ? root.querySelector('#streamflix-guest-code-input')
                    : ((viewKey === 'auth' || viewKey === 'auth-hybrid')
                        ? (primarySsoBtn || root.querySelector('#streamflix-login-username'))
                        : (root.querySelector('#streamflix-login-username') || primarySsoBtn));
                if (focusTarget) {
                    try { focusTarget.focus(); } catch (e) {}
                }
            }, 60);
        }
    }
