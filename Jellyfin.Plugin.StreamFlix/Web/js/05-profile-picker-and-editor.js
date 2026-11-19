/* StreamFlix Client (05/14) — Profile Picker ("Who's Watching?") & Profile Editor */
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
        if (isGuestPassSession()) {
            return false;
        }
        return Boolean(
            (state.config && state.config.isAdmin)
            || (state.googleUser && (state.googleUser.isAdmin || state.googleUser.authKind === 'jellyfin_admin'))
        );
    }

    function isActiveProfileAdmin() {
        if (isGuestPassSession()) {
            return false;
        }
        var active = state.activeProfile;
        if (!active || active.isKids) {
            return false;
        }
        var serverProf = active.id ? findProfileById(active.id) : null;
        if (serverProf) {
            return Boolean(serverProf.isAdmin);
        }
        return Boolean(active.isAdmin);
    }

    function isProfileManagementAdmin() {
        if (isGuestPassSession()) {
            return false;
        }
        if (state.activeProfile) {
            return isActiveProfileAdmin();
        }
        return isHouseholdAdmin();
    }

    function canActiveProfileManageGuestPasses() {
        if (isGuestPassSession() || !areGuestPassesEnabled()) {
            return false;
        }
        var active = state.activeProfile;
        if (!active || active.isKids) {
            return false;
        }
        if (isActiveProfileAdmin()) {
            return true;
        }
        var serverProf = active.id ? findProfileById(active.id) : null;
        if (serverProf) {
            return Boolean(serverProf.canManageGuestPasses);
        }
        return Boolean(active.canManageGuestPasses);
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
        if (isGuestPassSession()) {
            var guestExp = formatRelativeExpiry((state.config && state.config.guestPassExpiresAt) || (g && g.expiresAt));
            var guestText = 'Guest Pass' + (guestExp ? ' · ' + guestExp : '');
            return '<div class="streamflix-account-chip streamflix-account-chip-guest" title="Temporary Guest Pass">'
                + '<span class="streamflix-account-chip-initial streamflix-chip-guest">' + icon('ticket') + '</span>'
                + '<span class="streamflix-account-chip-email">' + escapeHtml(guestText) + '</span></div>';
        }
        if (g && g.authKind === 'oidc') {
            var prov = g.providerName || getOidcProviderLabel();
            var safeOidcPic = typeof g.picture === 'string' && /^https?:\/\//i.test(g.picture.trim()) ? g.picture.trim() : '';
            var oidcDisplay = g.email || (prov + (g.username ? ' · ' + g.username : ''));
            var oidcInitial = (g.email || g.username || prov || 'S').charAt(0).toUpperCase();
            var oidcAvatar = safeOidcPic
                ? '<img src="' + escapeHtml(safeOidcPic) + '" alt="" referrerpolicy="no-referrer" />'
                : '<span class="streamflix-account-chip-initial">' + escapeHtml(oidcInitial) + '</span>';
            return '<div class="streamflix-account-chip" title="' + escapeHtml('Signed in with ' + prov) + '">' + oidcAvatar
                + '<span class="streamflix-account-chip-email">' + escapeHtml(oidcDisplay) + '</span></div>';
        }
        if (g && g.email) {
            var safePic = typeof g.picture === 'string' && /^https?:\/\//i.test(g.picture.trim()) ? g.picture.trim() : '';
            var avatar = safePic
                ? '<img src="' + escapeHtml(safePic) + '" alt="" referrerpolicy="no-referrer" />'
                : '<span class="streamflix-account-chip-initial">' + escapeHtml(g.email.charAt(0).toUpperCase()) + '</span>';
            return '<div class="streamflix-account-chip" title="Signed in with Google">' + avatar
                + '<span class="streamflix-account-chip-email">' + escapeHtml(g.email) + '</span></div>';
        }
        if (g && g.username) {
            var isAdm = g.authKind === 'jellyfin_admin' || Boolean(g.isAdmin);
            var label = (isAdm ? 'Admin · ' : '') + g.username;
            var badge = isAdm
                ? '<span class="streamflix-account-chip-initial streamflix-chip-admin">' + icon('shield') + '</span>'
                : '<span class="streamflix-account-chip-initial">' + escapeHtml(g.username.charAt(0).toUpperCase()) + '</span>';
            return '<div class="streamflix-account-chip" title="' + escapeHtml(isAdm ? 'Signed in as Jellyfin Administrator' : 'Signed in with Jellyfin account') + '">'
                + badge + '<span class="streamflix-account-chip-email">' + escapeHtml(label) + '</span></div>';
        }
        var cfg = state.config;
        if (cfg && cfg.bypassLoginGateOnLan && cfg.isLocalLan) {
            return '<div class="streamflix-account-chip streamflix-account-chip-lan" title="Connected on local network">'
                + '<span class="streamflix-account-chip-initial streamflix-chip-lan">' + icon('wifi') + '</span>'
                + '<span class="streamflix-account-chip-email">Local Network</span></div>';
        }
        return '';
    }

    function renderProfilePickerGate() {
        state.explicitAuthPrompt = false;
        var hasValidActiveProf = Boolean(state.activeProfile && state.activeProfile.id && state.activeProfile.accessToken);
        transitionAppPhase(hasValidActiveProf ? APP_PHASES.PICKER_OVERLAY : APP_PHASES.PICKER_REQUIRED);
        var profiles = getProfiles();
        var isGuest = isGuestPassSession();
        var isAdmin = !isGuest && isProfileManagementAdmin();
        if (isGuest && state.manageMode) {
            state.manageMode = false;
        }
        var manage = Boolean(state.manageMode) && !isGuest;

        var cardsHtml = profiles.map(function (p, idx) {
            var accountBlocked = p.canActivate === false;
            var lockedOut = (p.googleLocked && !p.googleLockSatisfied) || accountBlocked;
            var lockLabel = p.googleAccountEmail || p.googleAccountHint || '';
            var lockMeta = p.googleLocked ? getProfileLockMeta(p) : null;
            var lockBadgeTitle = lockMeta
                ? ('Locked to ' + lockMeta.providerLabel + (lockLabel ? ': ' + lockLabel : ' account'))
                : (accountBlocked
                    ? (p.isAdmin ? 'Sign in with an administrator account to open' : 'Sign in with this profile\'s Jellyfin account to open')
                    : '');
            var badges = ''
                + ((p.hasPin || (accountBlocked && !lockMeta)) ? '<span class="streamflix-tile-badge" title="' + escapeHtml(accountBlocked && !p.hasPin ? lockBadgeTitle : 'PIN protected') + '">' + icon('lock') + '</span>' : '')
                + (lockMeta ? '<span class="streamflix-tile-badge streamflix-tile-badge-lock ' + lockMeta.badgeClass + '" title="' + escapeHtml(lockBadgeTitle) + '">' + lockMeta.badgeSvg + '</span>' : '');
            var roleBadge = p.isAdmin ? 'Admin' : (p.isKids ? 'Kids' : 'Profile');
            var linkedUserLabel = p.jellyfinUsername || p.name;
            var canEditTile = isAdmin || (!p.isAdmin && !p.isOwner && !p.isKids && !lockedOut && (!state.activeProfile || state.activeProfile.id === p.id));
            var canDelete = isAdmin && profiles.length > 1 && !p.isOwner;
            var title = lockedOut ? (lockBadgeTitle || ('Locked to ' + lockLabel)) : (manage ? (canEditTile ? 'Edit ' + p.name : p.name) : 'Open ' + p.name);

            return ''
                + '<div class="streamflix-profile-tile' + (lockedOut ? ' streamflix-tile-locked' : '') + '" tabindex="0" role="button" style="--i:' + idx + ';--pc:' + escapeHtml(p.color || '#E50914') + ';"'
                + (manage && isAdmin ? ' draggable="true"' : '')
                + ' data-profile-id="' + escapeHtml(p.id) + '" data-profile-idx="' + idx + '" title="' + escapeHtml(title) + '">'
                + '  <div class="streamflix-profile-avatar" style="background:' + escapeHtml(p.color || '#E50914') + ';">'
                + (manage ? '<span class="streamflix-profile-order-badge">#' + (idx + 1) + '</span>' : '')
                + '    <span class="streamflix-profile-emoji">' + escapeHtml(p.icon || '🎬') + '</span>'
                + (p.isKids ? '<span class="streamflix-profile-kids-ribbon">KIDS</span>' : '')
                + (badges ? '<span class="streamflix-tile-badges">' + badges + '</span>' : '')
                + (manage && canEditTile ? '<div class="streamflix-profile-edit-scrim">' + icon('edit') + '</div>' : '')
                + '    <span class="streamflix-tile-spinner" aria-hidden="true"></span>'
                + '  </div>'
                + '  <div class="streamflix-profile-name">' + escapeHtml(p.name) + '</div>'
                + (manage
                    ? '<div class="streamflix-profile-meta" title="Linked Jellyfin user: ' + escapeHtml(linkedUserLabel) + '">'
                      + '<span class="streamflix-profile-role">' + escapeHtml(roleBadge) + '</span><span class="streamflix-profile-linked">' + icon('link') + escapeHtml(linkedUserLabel) + '</span>'
                      + '</div>'
                      + ((isAdmin || canEditTile)
                          ? '<div class="streamflix-profile-reorder-bar">'
                            + (isAdmin ? '  <button type="button" class="streamflix-reorder-btn" data-move-left="' + escapeHtml(p.id) + '" title="Move left" aria-label="Move left"' + (idx === 0 ? ' disabled' : '') + '>' + icon('chevronLeft') + '</button>' : '')
                            + (canEditTile ? '  <button type="button" class="streamflix-reorder-btn" data-edit-profile-id="' + escapeHtml(p.id) + '" title="Edit profile" aria-label="Edit profile">' + icon('edit') + '</button>' : '')
                            + (canDelete
                                ? '<button type="button" class="streamflix-reorder-btn streamflix-reorder-btn-danger" data-delete-profile-id="' + escapeHtml(p.id) + '" title="Delete profile" aria-label="Delete profile">' + icon('trash') + '</button>'
                                : '')
                            + (isAdmin ? '  <button type="button" class="streamflix-reorder-btn" data-move-right="' + escapeHtml(p.id) + '" title="Move right" aria-label="Move right"' + (idx === profiles.length - 1 ? ' disabled' : '') + '>' + icon('chevronRight') + '</button>' : '')
                            + '</div>'
                          : '')
                    : '')
                + '</div>';
        }).join('');

        var addTileHtml = (!isGuest && isAdmin) ? (''
            + '<div class="streamflix-profile-tile streamflix-add-tile" id="streamflix-add-profile-tile" tabindex="0" role="button" style="--i:' + profiles.length + ';">'
            + '  <div class="streamflix-profile-avatar streamflix-add-avatar">' + icon('plus') + '</div>'
            + '  <div class="streamflix-profile-name">Add Profile</div>'
            + '</div>') : '';

        var hasSessionToken = Boolean(state.googleUser && state.googleUser.token);
        var onAdminPage = typeof isAdminConfigRoute === 'function' && isAdminConfigRoute();
        var canOpenPluginSettings = Boolean(isAdmin && !onAdminPage);
        var canResumeOrReturn = Boolean((state.activeProfile && state.activeProfile.accessToken) || onAdminPage);
        var resumeLabel = onAdminPage ? 'Back to Settings' : ('Back to ' + escapeHtml(getBrandName()));
        var actionsHtml = buildAccountChipHtml()
            + (canOpenPluginSettings
                ? '<button type="button" class="streamflix-ghost-btn" id="streamflix-open-plugin-cfg-btn" title="Open StreamFlix Plugin Settings">' + icon('gear') + '<span>Plugin Settings</span></button>'
                : '')
            + (hasSessionToken
                ? '<button type="button" class="streamflix-ghost-btn" id="streamflix-google-signout-btn">' + (isGuest ? 'Exit Guest Pass' : 'Sign out') + '</button>'
                : '')
            + (canResumeOrReturn
                ? '<button type="button" class="streamflix-ghost-btn streamflix-ghost-btn-accent" id="streamflix-resume-session-btn">' + icon('chevronLeft') + '<span>' + resumeLabel + '</span></button>'
                : '');

        var guestRelExp = isGuest ? formatRelativeExpiry((state.config && state.config.guestPassExpiresAt) || (state.googleUser && state.googleUser.expiresAt)) : '';
        var pickerSubtitle = manage
            ? 'Tap a profile to edit its name, avatar, PIN or Google lock. Drag or use the arrows to reorder.'
            : (isGuest
                ? ('Your temporary Guest Pass is active' + (guestRelExp ? ' · ' + escapeHtml(guestRelExp) : '') + '.')
                : (profiles.length ? 'Pick your profile to jump back into your shows.' : 'Create your first profile to get started.'));

        var stageHtml = ''
            + '<div class="streamflix-center-stage">'
            + '  <h1 class="streamflix-whos-watching-title">' + (manage ? 'Manage Profiles' : (isGuest ? 'Welcome!' : 'Who\'s watching?')) + '</h1>'
            + '  <p class="streamflix-whos-watching-subtitle">' + pickerSubtitle + '</p>'
            + '  <div class="streamflix-profiles-grid">' + cardsHtml + addTileHtml + '</div>'
            + (isGuest
                ? ''
                : ('  <button type="button" class="streamflix-manage-btn' + (manage ? ' active' : '') + '" id="streamflix-toggle-manage-btn">' + (manage ? icon('check') + '<span>Done</span>' : icon('edit') + '<span>Manage Profiles</span>') + '</button>'))
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
                if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tile) {
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
            var openAdd = function () {
                if (typeof isKidsExitLockRequired === 'function' && isKidsExitLockRequired()) {
                    requestExitKidsVerification(null).then(function (res) {
                        if (res && res.verified) {
                            openProfileEditorModal(null);
                        }
                    });
                    return;
                }
                openProfileEditorModal(null);
            };
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
                if (state.manageMode && state.openedDirectlyToManage && canResumeOrReturn) {
                    closeOverlayGate();
                    var cfgPage = document.getElementById('StreamFlixConfigPage');
                    if (cfgPage) {
                        try { cfgPage.dispatchEvent(new CustomEvent('viewshow')); } catch (eEv) {}
                    }
                    scheduleLifecycleTick(0);
                    return;
                }
                if (!state.manageMode && typeof isKidsExitLockRequired === 'function' && isKidsExitLockRequired()) {
                    requestExitKidsVerification(null).then(function (res) {
                        if (res && res.verified) {
                            state.manageMode = true;
                            renderProfilePickerGate();
                        }
                    });
                    return;
                }
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

        var cfgBtn = root.querySelector('#streamflix-open-plugin-cfg-btn');
        if (cfgBtn) {
            cfgBtn.addEventListener('click', function () {
                if (typeof isKidsExitLockRequired === 'function' && isKidsExitLockRequired()) {
                    requestExitKidsVerification(null).then(function (res) {
                        if (res && res.verified) {
                            openStreamFlixAdminRoute('#/configurationpage?name=StreamFlix');
                        }
                    });
                    return;
                }
                openStreamFlixAdminRoute('#/configurationpage?name=StreamFlix');
            });
        }

        var resumeBtn = root.querySelector('#streamflix-resume-session-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', function () {
                closeOverlayGate();
                var cfgPage = document.getElementById('StreamFlixConfigPage');
                if (cfgPage) {
                    try { cfgPage.dispatchEvent(new CustomEvent('viewshow')); } catch (eEv) {}
                }
                scheduleLifecycleTick(0);
            });
        }

        // Auto-focus the active or first unlocked profile tile on open so Arrow keys + Enter work immediately on TV, HTPC & desktop
        if (!document.querySelector('.streamflix-modal-backdrop')) {
            var activePid = state.activeProfile && state.activeProfile.id;
            var initialTile = (activePid ? root.querySelector('.streamflix-profile-tile[data-profile-id="' + cssEscape(activePid) + '"]') : null)
                || root.querySelector('.streamflix-profile-tile:not(.streamflix-tile-locked)[data-profile-id]')
                || root.querySelector('.streamflix-profile-tile');
            if (initialTile) {
                setTimeout(function () {
                    if (!document.querySelector('.streamflix-modal-backdrop') && !isEditableTarget(document.activeElement)) {
                        try { initialTile.focus({ preventScroll: true }); } catch (e) {}
                    }
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

    function clearLocalJellyfinAuth() {
        try {
            var rawCreds = localStorage.getItem('jellyfin_credentials');
            if (rawCreds) {
                var creds = JSON.parse(rawCreds);
                if (creds && Array.isArray(creds.Servers)) {
                    for (var sIdx = 0; sIdx < creds.Servers.length; sIdx++) {
                        delete creds.Servers[sIdx].AccessToken;
                        delete creds.Servers[sIdx].UserId;
                    }
                    localStorage.setItem('jellyfin_credentials', JSON.stringify(creds));
                }
            }
            if (window.ApiClient) {
                if (typeof window.ApiClient.clearAuthenticationInfo === 'function') {
                    window.ApiClient.clearAuthenticationInfo();
                } else if (typeof window.ApiClient.setAuthenticationInfo === 'function') {
                    window.ApiClient.setAuthenticationInfo(null, null);
                }
                if (window.ApiClient._sdk && typeof window.ApiClient._sdk.update === 'function') {
                    window.ApiClient._sdk.update({ accessToken: '' });
                }
            }
        } catch (eCreds) {}
    }

    function signOutHousehold(opts) {
        var options = (opts && typeof opts === 'object') ? opts : {};
        var token = getActiveToken();
        if (token && !options.skipServerLogout) {
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
        clearAdminAuth();
        clearActiveProfileState(true);
        if (!options.fromBroadcast && typeof broadcastAuthBusMessage === 'function') {
            broadcastAuthBusMessage('auth_signout');
        }
        state.sessionVerifiedOnce = false;
        state.legacyProfileToMigrate = null;
        state.explicitAuthPrompt = false;
        state.explicitPickerOpen = false;
        state.openedDirectlyToManage = false;
        state.manageMode = false;
        state.adminLoginExpanded = false;
        state.guestPassExpanded = false;
        state.startingGoogleDesktopRelay = false;
        state.startingOidcRedirect = false;
        if (typeof clearPendingGoogleDesktopFlow === 'function') {
            clearPendingGoogleDesktopFlow();
        }
        if (typeof clearPendingOidcFlow === 'function') {
            clearPendingOidcFlow();
        }
        if (typeof stopDesktopAuthPollTimerIfIdle === 'function') {
            stopDesktopAuthPollTimerIfIdle();
        }
        clearLocalJellyfinAuth();

        var openAccess = isOpenWithoutLogin(state.config);
        state.browseFilter = null;
        if (state.config) {
            state.config.hasAccess = openAccess;
            state.config.session = null;
            state.config.isAdmin = false;
            state.config.isGuestPass = false;
            state.config.guestPassLabel = '';
            state.config.guestPassExpiresAt = null;
            state.config.lockedProfileId = null;
            state.config.serverUsers = [];
            state.config.approvedGoogleAccounts = [];
            state.config.approvedOidcUsers = [];
            if (!openAccess) {
                state.config.profiles = [];
                clearShowcaseAndMediaCaches();
            }
            saveJson(CACHED_CONFIG_KEY, state.config);
        }
        closeAccountDropdown();
        ensureHeaderWidgets();
        if (!options.skipGateRender) {
            if (!openAccess) {
                renderGoogleAuthGate();
            } else {
                fetchPublicConfig().then(rerenderPickerIfOpen).catch(function () {});
                renderProfilePickerGate();
            }
        }
        if (!options.silent) {
            showToast('Signed out of ' + getBrandName() + ' on this device.', 'info');
        }
    }

    function confirmAndDeleteProfile(profile, verifiedPin) {
        if (!profile || !profile.id) {
            return;
        }
        if (getProfiles().length <= 1) {
            showToast('You can\'t delete the last remaining profile.', 'error');
            return;
        }
        var isAdmin = isProfileManagementAdmin();
        if (!isAdmin) {
            showToast('Only an active administrator profile can delete household profiles.', 'error');
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
                    clearActiveProfileState(true);
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
        if (profile.canActivate === false) {
            confirmDialog({
                title: profile.isAdmin ? 'Administrator Sign-In Required' : 'Account Sign-In Required',
                message: profile.isAdmin
                    ? ('Sign in with an administrator account to open "' + profile.name + '".')
                    : ('Sign in with "' + (profile.jellyfinUsername || profile.name) + '" (or an administrator account) to open this profile.'),
                confirmText: 'Go to Sign In',
                cancelText: 'Cancel'
            }).then(function (ok) {
                if (ok) {
                    try {
                        sessionStorage.setItem(PENDING_PROFILE_KEY, profile.id);
                    } catch (ePend) {}
                    state.explicitAuthPrompt = true;
                    state.explicitPickerOpen = false;
                    state.openedDirectlyToManage = false;
                    state.manageMode = false;
                    state.guestPassExpanded = false;
                    state.adminLoginExpanded = Boolean(profile.isAdmin && state.config && state.config.canShowAdminFallback);
                    renderGoogleAuthGate();
                }
            });
            return;
        }
        var leavingKids = typeof isKidsProfileActive === 'function' && isKidsProfileActive() && !profile.isKids;
        if (profile.hasPin) {
            openPinUnlockModal(profile, '', leavingKids ? {
                exitingKidsProfileId: state.activeProfile.id,
                usePinAsAdultExit: true
            } : null);
            return;
        }
        if (leavingKids && typeof requestExitKidsVerification === 'function') {
            var kidsSourceId = state.activeProfile && state.activeProfile.id;
            requestExitKidsVerification(profile).then(function (exitRes) {
                if (!exitRes || !exitRes.verified) {
                    return;
                }
                markTileSelecting(profile.id, true);
                activateServerProfile(profile, '', {
                    exitingKidsProfileId: kidsSourceId,
                    adultExitPin: exitRes.adultPin || ''
                }).catch(function (err) {
                    markTileSelecting(profile.id, false);
                    handleActivationError(profile, err);
                });
            });
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
        if (code === 'kids_exit_pin_required' || code === 'kids_exit_pin_invalid') {
            if (typeof clearKidsExitSession === 'function') {
                clearKidsExitSession();
            }
            if (typeof requestExitKidsVerification === 'function') {
                var kidsSourceId = state.activeProfile && state.activeProfile.id;
                requestExitKidsVerification(profile, code === 'kids_exit_pin_invalid' ? err.message : '').then(function (exitRes) {
                    if (!exitRes || !exitRes.verified) {
                        return;
                    }
                    markTileSelecting(profile.id, true);
                    activateServerProfile(profile, '', {
                        exitingKidsProfileId: kidsSourceId,
                        adultExitPin: exitRes.adultPin || ''
                    }).catch(function (err2) {
                        markTileSelecting(profile.id, false);
                        handleActivationError(profile, err2);
                    });
                });
                return;
            }
        }
        if (code === 'pin_required' || code === 'pin_invalid') {
            openPinUnlockModal(profile, code === 'pin_invalid' ? err.message : '');
            return;
        }
        if (code === 'google_lock') {
            if (err.data && err.data.requiredEmailHint) {
                profile.googleAccountHint = err.data.requiredEmailHint;
            }
            if (err.data && err.data.accountLockKind) {
                profile.accountLockKind = String(err.data.accountLockKind).toLowerCase();
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

    function openPinUnlockModal(profile, initialError, extraOpts) {
        openPinPad({
            profile: profile,
            title: 'Profile Lock',
            subtitleHtml: 'Enter your PIN to open <strong>' + escapeHtml(profile.name) + '</strong>.',
            initialError: initialError || '',
            submit: function (pin) {
                markTileSelecting(profile.id, true);
                return activateServerProfile(profile, pin, extraOpts).catch(function (err) {
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
        var cfg = state.config || {};
        var googleEnabled = Boolean(cfg.enableGoogleSignIn !== false && cfg.googleConfigured);
        var oidcEnabled = Boolean(cfg.enableCustomOidc && cfg.oidcConfigured);
        var stdEnabled = Boolean(cfg.allowStandardJellyfinLogin);
        var oidcLabel = getOidcProviderLabel();
        var lockMeta = getProfileLockMeta(profile);
        var defaultHint = 'a specific ' + lockMeta.providerLabel + ' account';
        var hint = profile.googleAccountEmail || profile.googleAccountHint || defaultHint;
        var signedInAs = state.googleUser && (state.googleUser.email || state.googleUser.username);
        var lockHeading = lockMeta.kind === 'jellyfin'
            ? 'Locked to a Jellyfin account'
            : (lockMeta.kind === 'oidc'
                ? ('Locked to ' + escapeHtml(oidcLabel))
                : (lockMeta.kind === 'sso' ? 'Locked to an SSO account' : 'Locked to a Google account'));

        var showGoogle = googleEnabled && (lockMeta.kind === 'google' || lockMeta.kind === 'sso');
        var showOidc = oidcEnabled && (lockMeta.kind === 'oidc' || lockMeta.kind === 'sso');
        var showJellyfin = stdEnabled && lockMeta.kind === 'jellyfin';
        if (!showGoogle && !showOidc && !showJellyfin) {
            showGoogle = googleEnabled;
            showOidc = oidcEnabled;
            showJellyfin = stdEnabled;
        }
        var showAdminFallback = Boolean(profile.isAdmin && !showJellyfin && (cfg.canShowAdminFallback || (!googleEnabled && !oidcEnabled && !stdEnabled)));

        var ssoBtnsHtml = '<div class="streamflix-sso-stack">'
            + (showGoogle
                ? '<button type="button" class="streamflix-google-btn" data-act="google">' + GOOGLE_G_SVG + '<span>Continue with Google</span></button>'
                : '')
            + (showOidc
                ? '<button type="button" class="streamflix-oidc-btn' + (!showGoogle ? ' streamflix-oidc-btn-primary' : '') + '" data-act="oidc">' + OIDC_SSO_SVG + '<span>Continue with ' + escapeHtml(oidcLabel) + '</span></button>'
                : '')
            + (showJellyfin
                ? '<button type="button" class="streamflix-oidc-btn' + (!showGoogle && !showOidc ? ' streamflix-oidc-btn-primary' : '') + '" data-act="jellyfin">' + JELLYFIN_USER_SVG + '<span>Sign in with Jellyfin Account</span></button>'
                : '')
            + (showAdminFallback
                ? '<button type="button" class="streamflix-oidc-btn' + (!showGoogle && !showOidc ? ' streamflix-oidc-btn-primary' : '') + '" data-act="admin">' + icon('shield') + '<span>Admin Sign-In</span></button>'
                : '')
            + '</div>';

        var m = openModal(''
            + '<div class="streamflix-pin-avatar" style="background:' + escapeHtml(sanitizeHexColor(profile.color, '#E50914')) + ';">'
            + escapeHtml(profile.icon || '🎬')
            + '<span class="streamflix-glock-badge ' + lockMeta.badgeClass + '">' + lockMeta.badgeSvg + '</span>'
            + '</div>'
            + '<h2>' + lockHeading + '</h2>'
            + '<p class="streamflix-modal-text"><strong>' + escapeHtml(profile.name) + '</strong> can only be opened by <strong>' + escapeHtml(hint) + '</strong>.'
            + (signedInAs ? ' You\'re currently signed in as ' + escapeHtml(signedInAs) + '.' : '')
            + '</p>'
            + ssoBtnsHtml
            + '<div class="streamflix-modal-actions streamflix-modal-actions-center">'
            + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">Not now</button>'
            + '</div>', { className: 'streamflix-modal-pin' });
        m.modal.querySelector('[data-act="cancel"]').addEventListener('click', function () { m.close(); });
        var gBtn = m.modal.querySelector('[data-act="google"]');
        if (gBtn) {
            gBtn.addEventListener('click', function () {
                m.close();
                if (typeof canOpenExternalSystemBrowser === 'function' && canOpenExternalSystemBrowser()) {
                    state.explicitAuthPrompt = true;
                }
                startGoogleOAuthRedirect(profile.id, profile.googleAccountEmail || '');
            });
        }
        var oBtn = m.modal.querySelector('[data-act="oidc"]');
        if (oBtn) {
            oBtn.addEventListener('click', function () {
                m.close();
                state.explicitAuthPrompt = true;
                startOidcRedirect(profile.id, profile.googleAccountEmail || '');
            });
        }
        var jfBtn = m.modal.querySelector('[data-act="jellyfin"]');
        if (jfBtn) {
            jfBtn.addEventListener('click', function () {
                try {
                    sessionStorage.setItem(PENDING_PROFILE_KEY, profile.id);
                } catch (e) {}
                state.explicitAuthPrompt = true;
                state.explicitPickerOpen = false;
                state.openedDirectlyToManage = false;
                state.manageMode = false;
                state.guestPassExpanded = false;
                state.adminLoginExpanded = false;
                m.close();
                renderGoogleAuthGate();
            });
        }
        var admBtn = m.modal.querySelector('[data-act="admin"]');
        if (admBtn) {
            admBtn.addEventListener('click', function () {
                try {
                    sessionStorage.setItem(PENDING_PROFILE_KEY, profile.id);
                } catch (e) {}
                state.explicitAuthPrompt = true;
                state.explicitPickerOpen = false;
                state.openedDirectlyToManage = false;
                state.manageMode = false;
                state.guestPassExpanded = false;
                state.adminLoginExpanded = Boolean(cfg.canShowAdminFallback);
                m.close();
                renderGoogleAuthGate();
            });
        }
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
        if (isGuestPassSession()) {
            showToast('Guest Passes cannot create or edit household profiles.', 'error');
            return;
        }
        var isNew = !existingProfile;
        var isAdmin = isProfileManagementAdmin();

        if (isNew && !isAdmin) {
            showToast('Only an active administrator profile can create new household profiles.', 'error');
            return;
        }

        if (!isNew && !isAdmin && state.activeProfile && state.activeProfile.id && existingProfile.id !== state.activeProfile.id) {
            showToast('Switch to "' + existingProfile.name + '" or an administrator profile first to edit it.', 'error');
            return;
        }

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

        if (!isNew && !isAdmin && existingProfile.isKids) {
            showToast('Only an administrator can edit a Kids profile.', 'error');
            return;
        }

        if (!isNew && !isAdmin && existingProfile.canActivate === false) {
            showToast('Sign in with that account or an administrator account to edit this profile.', 'error');
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
        var serverUsers = (isAdmin && state.config && Array.isArray(state.config.serverUsers)) ? state.config.serverUsers : [];
        var defaultNewJfUserId = '__CREATE__';
        if (isNew && isAdmin && !getProfiles().some(function (p) { return p && (p.isAdmin || p.isOwner); })) {
            var sessAdminUid = state.googleUser && state.googleUser.userId ? normalizeGuid(state.googleUser.userId) : '';
            var matchedAdminSu = null;
            for (var suIdx = 0; suIdx < serverUsers.length; suIdx++) {
                var suCand = serverUsers[suIdx];
                if (suCand && suCand.isAdmin) {
                    if (sessAdminUid && normalizeGuid(suCand.id) === sessAdminUid) {
                        matchedAdminSu = suCand;
                        break;
                    }
                    if (!matchedAdminSu) {
                        matchedAdminSu = suCand;
                    }
                }
            }
            if (matchedAdminSu && matchedAdminSu.id) {
                defaultNewJfUserId = matchedAdminSu.id;
            }
        }
        var draft = existingProfile ? JSON.parse(JSON.stringify(existingProfile)) : {
            id: '',
            name: '',
            color: AVATAR_COLORS[profileCount % AVATAR_COLORS.length],
            icon: AVATAR_ICONS[profileCount % AVATAR_ICONS.length],
            isKids: false,
            kidsExitPinRequired: true,
            autoplayNextEpisode: true,
            autoplayPreviews: true,
            allowedLibraryIds: [],
            seerrRequestQuota: 0,
            bedtimeStart: '',
            bedtimeEnd: '',
            maxParentalRating: MATURITY_LEVELS[0].value,
            hasPin: false,
            googleLocked: false,
            accountLockKind: '',
            jellyfinUserId: defaultNewJfUserId
        };

        // Linked Jellyfin account: only administrators can view the server user list or change which account a profile uses.
        var userOptionsHtml = '';
        if (isAdmin) {
            userOptionsHtml = serverUsers.map(function (su) {
                var selected = draft.jellyfinUserId && draft.jellyfinUserId !== '__CREATE__' && normalizeGuid(draft.jellyfinUserId) === normalizeGuid(su.id) ? ' selected' : '';
                var adminAttr = su.isAdmin ? ' data-is-admin="1"' : '';
                return '<option value="' + escapeHtml(su.id) + '"' + selected + adminAttr + '>🔗 ' + escapeHtml(su.name + (su.isAdmin ? ' (Admin)' : '')) + '</option>';
            }).join('');
            var createSelected = (!draft.jellyfinUserId || draft.jellyfinUserId === '__CREATE__') ? ' selected' : '';
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

        // Account lock options (Google email, OIDC email/username, or Jellyfin username)
        var oidcLockActive = Boolean(state.config && state.config.enableCustomOidc && state.config.oidcConfigured);
        var googleLockActive = Boolean(state.config && state.config.enableGoogleSignIn !== false && state.config.googleConfigured);
        var stdLockActive = Boolean(state.config && state.config.allowStandardJellyfinLogin);
        var oidcProviderLbl = getOidcProviderLabel();

        var sessionKind = (state.googleUser && state.googleUser.authKind) ? String(state.googleUser.authKind).toLowerCase() : '';
        var sessionEmail = (state.googleUser && state.googleUser.email) ? String(state.googleUser.email).trim().toLowerCase() : '';
        var sessionUser = (state.googleUser && state.googleUser.username) ? String(state.googleUser.username).trim() : '';

        var currentLockRaw = draft.googleAccountEmail ? String(draft.googleAccountEmail).trim() : '';
        var currentLockVal = currentLockRaw.indexOf('@') !== -1 ? currentLockRaw.toLowerCase() : currentLockRaw;
        var currentLockMeta = getProfileLockMeta(draft);
        var currentLockKind = currentLockMeta.kind === 'sso' ? (oidcLockActive && !googleLockActive ? 'oidc' : 'google') : currentLockMeta.kind;

        var lockOptions = [{ value: '', label: 'Anyone in this household' }];
        var seenLock = { '': true };
        var formatLockPrefix = function (k) {
            if (k === 'jellyfin') { return 'Jellyfin: '; }
            if (k === 'oidc') { return oidcProviderLbl + ': '; }
            return 'Google: ';
        };
        var addLockOption = function (kind, ident, customLabel) {
            var cleanIdent = String(ident || '').trim();
            if (!cleanIdent) {
                return '';
            }
            if (cleanIdent.indexOf('@') !== -1) {
                cleanIdent = cleanIdent.toLowerCase();
            }
            var normKind = (kind === 'oidc' || kind === 'jellyfin') ? kind : 'google';
            var optVal = normKind + '|' + cleanIdent;
            var dedupeKey = normKind + '|' + cleanIdent.toLowerCase();
            if (seenLock[dedupeKey]) {
                return optVal;
            }
            seenLock[dedupeKey] = true;
            lockOptions.push({
                value: optVal,
                label: customLabel || ('Only ' + formatLockPrefix(normKind) + cleanIdent)
            });
            return optVal;
        };

        var selectedLock = '';
        if (draft.googleLocked && !currentLockVal) {
            lockOptions.push({
                value: '__KEEP__',
                label: 'Only ' + formatLockPrefix(currentLockKind) + (draft.googleAccountHint || 'current account') + ' (keep)'
            });
            selectedLock = '__KEEP__';
        } else if (currentLockVal) {
            var isCurrentYou = (currentLockKind === 'jellyfin' && sessionUser && sessionUser.toLowerCase() === currentLockVal.toLowerCase())
                || (currentLockKind !== 'jellyfin' && ((sessionEmail && sessionEmail === currentLockVal.toLowerCase()) || (sessionKind === 'oidc' && sessionUser && sessionUser.toLowerCase() === currentLockVal.toLowerCase())));
            selectedLock = addLockOption(currentLockKind, currentLockVal, 'Only ' + formatLockPrefix(currentLockKind) + currentLockVal + (isCurrentYou ? ' (you)' : ''));
        }

        if (sessionKind === 'oidc') {
            var oidcIdent = sessionEmail || sessionUser;
            if (oidcIdent) {
                addLockOption('oidc', oidcIdent, 'Only ' + formatLockPrefix('oidc') + oidcIdent + ' (you)');
            }
        } else if (sessionKind === 'jellyfin' || sessionKind === 'jellyfin_admin') {
            if (sessionUser) {
                addLockOption('jellyfin', sessionUser, 'Only ' + formatLockPrefix('jellyfin') + sessionUser + ' (you)');
            }
        } else if (sessionEmail) {
            var defSsoKind = (oidcLockActive && !googleLockActive) ? 'oidc' : 'google';
            addLockOption(defSsoKind, sessionEmail, 'Only ' + formatLockPrefix(defSsoKind) + sessionEmail + ' (you)');
        }

        if (isAdmin && state.config && Array.isArray(state.config.approvedGoogleAccounts)) {
            state.config.approvedGoogleAccounts.forEach(function (em) {
                addLockOption('google', em);
            });
        }
        if (isAdmin && state.config && Array.isArray(state.config.approvedOidcUsers)) {
            state.config.approvedOidcUsers.forEach(function (u) {
                addLockOption('oidc', u);
            });
        }
        if (isAdmin && stdLockActive && Array.isArray(serverUsers)) {
            serverUsers.forEach(function (su) {
                if (su && su.name) {
                    addLockOption('jellyfin', su.name);
                }
            });
        }

        var enabledMethodCount = (googleLockActive ? 1 : 0) + (oidcLockActive ? 1 : 0) + (stdLockActive ? 1 : 0);
        var lockFieldLabel = enabledMethodCount > 1
            ? 'Account Lock'
            : (oidcLockActive
                ? (oidcProviderLbl + ' Account Lock')
                : (stdLockActive && !googleLockActive ? 'Jellyfin Account Lock' : 'Google Account Lock'));
        var lockOptionsHtml = lockOptions.map(function (o) {
            return '<option value="' + escapeHtml(o.value) + '"' + (o.value === selectedLock ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
        }).join('');
        var lockSelectable = lockOptions.length > 1;
        var lockFieldHint = lockSelectable
            ? 'Locked profiles can only be opened after signing in with that specific account.'
            : 'Sign in with your personal account to lock this profile to yourself.';

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

        var canDelete = isAdmin && !isNew && profileCount > 1;
        var serverLibraries = (state.config && Array.isArray(state.config.serverLibraries)) ? state.config.serverLibraries : [];
        var draftAllowedLibMap = {};
        (Array.isArray(draft.allowedLibraryIds) ? draft.allowedLibraryIds : []).forEach(function (lid) {
            var n = normalizeGuid(lid);
            if (n) { draftAllowedLibMap[n] = true; }
        });
        var allowedLibsSectionHtml = (isAdmin && !draft.isAdmin && serverLibraries.length > 0)
            ? (''
                + '<div class="streamflix-field">'
                + '  <label>Allowed Media Libraries (Optional)</label>'
                + '  <div class="bfx-nav-cust-grid" id="streamflix-prof-libs-grid">'
                + serverLibraries.map(function (lib) {
                    var isChecked = Boolean(draftAllowedLibMap[normalizeGuid(lib.id)]);
                    return '<label class="bfx-nav-cust-chip">'
                        + '<input type="checkbox" data-prof-lib-id="' + escapeHtml(lib.id) + '"' + (isChecked ? ' checked' : '') + ' />'
                        + '<span>' + escapeHtml(lib.name || 'Library') + '</span>'
                        + '</label>';
                }).join('')
                + '  </div>'
                + '  <div class="streamflix-field-hint">Leave all unchecked to grant access to every library, or select specific folders (e.g. Kids, Anime) for this profile.</div>'
                + '</div>')
            : '';

        var curQuota = typeof draft.seerrRequestQuota === 'number' ? draft.seerrRequestQuota : 0;
        var quotaOptions = [
            { val: 0, label: 'Unlimited requests' },
            { val: 5, label: 'Up to 5 requests per 7 days' },
            { val: 10, label: 'Up to 10 requests per 7 days' },
            { val: 20, label: 'Up to 20 requests per 7 days' },
            { val: -1, label: 'Disabled for this profile' }
        ];
        if (quotaOptions.every(function (q) { return q.val !== curQuota; })) {
            quotaOptions.splice(1, 0, { val: curQuota, label: 'Up to ' + curQuota + ' requests per 7 days' });
        }
        var seerrQuotaSectionHtml = (isAdmin && !draft.isAdmin && state.config && (state.config.seerrEnabled || state.config.seerrConfigured))
            ? (''
                + '<div class="streamflix-field">'
                + '  <label for="streamflix-prof-seerr-quota">Seerr Request Limit</label>'
                + '  <select id="streamflix-prof-seerr-quota" class="streamflix-select">'
                + quotaOptions.map(function (q) {
                    return '<option value="' + q.val + '"' + (q.val === curQuota ? ' selected' : '') + '>' + escapeHtml(q.label) + '</option>';
                }).join('')
                + '  </select>'
                + '</div>')
            : '';

        var m = openModal(''
            + '<div class="streamflix-editor-head">'
            + '  <div class="streamflix-editor-preview" id="streamflix-prof-preview" style="background:' + escapeHtml(sanitizeHexColor(draft.color, '#E50914')) + ';">' + escapeHtml(draft.icon) + '</div>'
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
            + '    <select id="streamflix-prof-maturity" class="streamflix-select"' + (isAdmin ? '' : ' disabled title="Only an administrator can change maturity limits"') + '>' + maturityOptionsHtml + '</select>'
            + '  </div>'
            + '  <label class="streamflix-check">'
            + '    <input type="checkbox" id="streamflix-prof-kids" ' + (draft.isKids ? 'checked' : '') + (isAdmin ? '' : ' disabled') + ' />'
            + '    <span>Kids profile</span>'
            + '  </label>'
            + '</div>'
            + '<div class="streamflix-kids-lock-opt' + (draft.isKids ? '' : ' is-hidden') + '" id="streamflix-prof-kids-exit-wrap">'
            + '  <label class="streamflix-check">'
            + '    <input type="checkbox" id="streamflix-prof-kids-exit-pin" ' + (draft.kidsExitPinRequired !== false ? 'checked' : '') + ' />'
            + '    <span>Require parental check to exit Kids mode</span>'
            + '  </label>'
            + '  <div class="streamflix-field-hint" style="margin-top:3px;">Prompts for any adult profile PIN (or a 4-word grown-up check if no adult PINs exist) when leaving Kids mode.</div>'
            + '</div>'
            + '<div class="streamflix-editor-section">Playback &amp; Bedtime</div>'
            + '<div class="streamflix-field-row">'
            + '  <label class="streamflix-check">'
            + '    <input type="checkbox" id="streamflix-prof-autoplay-next" ' + (draft.autoplayNextEpisode !== false ? 'checked' : '') + ' />'
            + '    <span>Autoplay next episode</span>'
            + '  </label>'
            + '  <label class="streamflix-check">'
            + '    <input type="checkbox" id="streamflix-prof-autoplay-previews" ' + (draft.autoplayPreviews !== false ? 'checked' : '') + ' />'
            + '    <span>Muted hero video previews</span>'
            + '  </label>'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="streamflix-prof-bed-start">Bedtime Window (Optional)</label>'
            + '  <div class="streamflix-inline-row">'
            + '    <input type="time" id="streamflix-prof-bed-start" class="streamflix-input" value="' + escapeHtml(draft.bedtimeStart || '') + '" aria-label="Bedtime start" />'
            + '    <span style="opacity:.65;font-size:13px;">to</span>'
            + '    <input type="time" id="streamflix-prof-bed-end" class="streamflix-input" value="' + escapeHtml(draft.bedtimeEnd || '') + '" aria-label="Bedtime end" />'
            + '    <button type="button" class="streamflix-ghost-btn" id="streamflix-prof-bed-clear">Clear</button>'
            + '  </div>'
            + '  <div class="streamflix-field-hint">Shows a friendly “Time for Bed 🌙” screen during these hours (can be unlocked tonight with an Adult PIN).</div>'
            + '</div>'
            + allowedLibsSectionHtml
            + seerrQuotaSectionHtml
            + '<div class="streamflix-editor-section">Security</div>'
            + '<div class="streamflix-field">'
            + '  <label for="streamflix-prof-google">' + escapeHtml(lockFieldLabel) + '</label>'
            + '  <select id="streamflix-prof-google" class="streamflix-select"' + (lockSelectable ? '' : ' disabled') + '>' + lockOptionsHtml + '</select>'
            + '  <div class="streamflix-field-hint">' + escapeHtml(lockFieldHint) + '</div>'
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
        var kidsExitWrap = modal.querySelector('#streamflix-prof-kids-exit-wrap');
        var kidsExitCheck = modal.querySelector('#streamflix-prof-kids-exit-pin');
        var maturitySelect = modal.querySelector('#streamflix-prof-maturity');
        if (kidsCheck && maturitySelect) {
            kidsCheck.addEventListener('change', function () {
                if (kidsExitWrap) {
                    kidsExitWrap.classList.toggle('is-hidden', !kidsCheck.checked);
                }
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
                ? 'Administrator account — grants full server & Dashboard access. Protect this profile with a PIN or account lock.'
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

        var bedStartInput = modal.querySelector('#streamflix-prof-bed-start');
        var bedEndInput = modal.querySelector('#streamflix-prof-bed-end');
        var bedClearBtn = modal.querySelector('#streamflix-prof-bed-clear');
        if (bedClearBtn) {
            bedClearBtn.addEventListener('click', function () {
                if (bedStartInput) { bedStartInput.value = ''; }
                if (bedEndInput) { bedEndInput.value = ''; }
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
            var parsedLockEmail = null;
            var parsedLockKind = null;
            if (lockVal !== '__KEEP__') {
                if (!lockVal) {
                    parsedLockEmail = '';
                    parsedLockKind = '';
                } else {
                    var pipeIdx = lockVal.indexOf('|');
                    if (pipeIdx !== -1) {
                        parsedLockKind = lockVal.slice(0, pipeIdx);
                        parsedLockEmail = lockVal.slice(pipeIdx + 1);
                    } else {
                        parsedLockEmail = lockVal;
                    }
                }
            }
            var autoplayNextEl = modal.querySelector('#streamflix-prof-autoplay-next');
            var autoplayPrevEl = modal.querySelector('#streamflix-prof-autoplay-previews');
            var bStartVal = bedStartInput ? (bedStartInput.value || '').trim() : '';
            var bEndVal = bedEndInput ? (bedEndInput.value || '').trim() : '';
            if ((bStartVal && !bEndVal) || (!bStartVal && bEndVal)) {
                errEl.textContent = 'Please set both a start and end time for the Bedtime Window, or click Clear.';
                return;
            }
            var selectedAllowedLibs = null;
            var libsGridEl = modal.querySelector('#streamflix-prof-libs-grid');
            if (libsGridEl) {
                selectedAllowedLibs = [];
                Array.prototype.forEach.call(libsGridEl.querySelectorAll('input[data-prof-lib-id]:checked'), function (cb) {
                    var lid = cb.getAttribute('data-prof-lib-id');
                    if (lid) { selectedAllowedLibs.push(lid); }
                });
            }
            var quotaSelectEl = modal.querySelector('#streamflix-prof-seerr-quota');
            var resolvedJfUserId = jfUserSelect
                ? jfUserSelect.value
                : (isNew ? '__CREATE__' : (draft.jellyfinUserId || ''));
            var payload = {
                id: isNew ? '' : draft.id,
                name: nameVal,
                avatarEmoji: selectedIcon,
                avatarColorHex: selectedColor,
                isKids: kidsCheck.checked,
                kidsExitPinRequired: kidsExitCheck ? kidsExitCheck.checked : true,
                autoplayNextEpisode: autoplayNextEl ? Boolean(autoplayNextEl.checked) : true,
                autoplayPreviews: autoplayPrevEl ? Boolean(autoplayPrevEl.checked) : true,
                bedtimeStart: bStartVal,
                bedtimeEnd: bEndVal,
                allowedLibraryIds: selectedAllowedLibs,
                seerrRequestQuota: quotaSelectEl ? parseInt(quotaSelectEl.value, 10) : null,
                maturityRating: maturitySelect.value,
                pin: clearPinRequested ? '__CLEAR__' : (rawPin || null),
                jellyfinUserId: resolvedJfUserId,
                jellyfinUsername: isNew ? nameVal : (draft.jellyfinUsername || nameVal),
                currentPin: verifiedPin || null,
                googleAccountEmail: parsedLockEmail,
                accountLockKind: parsedLockKind
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
                if (typeof broadcastAuthBusMessage === 'function') {
                    broadcastAuthBusMessage('config_updated');
                }
                if (state.activeProfile && !isNew && state.activeProfile.id === draft.id) {
                    var updatedMatch = findProfileById(draft.id);
                    if (updatedMatch) {
                        state.activeProfile.name = updatedMatch.name;
                        state.activeProfile.color = updatedMatch.color;
                        state.activeProfile.icon = updatedMatch.icon;
                        state.activeProfile.isKids = updatedMatch.isKids;
                        state.activeProfile.kidsExitPinRequired = updatedMatch.kidsExitPinRequired !== false;
                        state.activeProfile.autoplayNextEpisode = updatedMatch.autoplayNextEpisode !== false;
                        state.activeProfile.autoplayPreviews = updatedMatch.autoplayPreviews !== false;
                        state.activeProfile.bedtimeStart = updatedMatch.bedtimeStart || '';
                        state.activeProfile.bedtimeEnd = updatedMatch.bedtimeEnd || '';
                        state.activeProfile.allowedLibraryIds = Array.isArray(updatedMatch.allowedLibraryIds) ? updatedMatch.allowedLibraryIds.slice() : [];
                        state.activeProfile.seerrRequestQuota = typeof updatedMatch.seerrRequestQuota === 'number' ? updatedMatch.seerrRequestQuota : 0;
                        saveActiveProfileState(state.activeProfile, true);
                        ensureHeaderWidgets();
                        if (selectedAllowedLibs !== null && state.hubData && state.hubData.loaded) {
                            loadCinemaHubData(true);
                        }
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
