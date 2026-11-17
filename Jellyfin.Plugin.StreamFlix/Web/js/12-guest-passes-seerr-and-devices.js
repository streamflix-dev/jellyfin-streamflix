/* StreamFlix Client (12/14) — Guest Passes, Seerr Requests & Active Devices Modals */
    /* ----------------------------------------------------------------------
       7b. v0.7.0+ Modals: Temporary Guest Passes & Seerr Requests
       ---------------------------------------------------------------------- */
    function openGuestPassesModal() {
        if (!areGuestPassesEnabled()) {
            showToast('Temporary Guest Passes are turned off in Dashboard → Plugins → StreamFlix.', 'info');
            return;
        }
        if (typeof canActiveProfileManageGuestPasses === 'function' && !canActiveProfileManageGuestPasses()) {
            showToast('This profile does not have permission to manage Guest Passes.', 'error');
            return;
        }
        var passes = [];
        var eligibleProfiles = [];
        var spotlightInfo = null;
        var loading = true;
        var busyAction = false;

        var m = openModal(''
            + '<div class="bfx-modal-top">'
            + '  <div class="bfx-modal-top-title">'
            + '    <span class="bfx-modal-kicker">' + icon('ticket') + ' <span>HOUSEHOLD INVITES</span></span>'
            + '    <h2>Temporary Guest Passes</h2>'
            + '    <p class="streamflix-modal-text">Share an expiring QR code or invite link locked to a single non-admin profile — revocable in one click.</p>'
            + '  </div>'
            + '  <button type="button" class="streamflix-detail-close bfx-modal-close-inline" data-act="close" aria-label="Close">' + icon('close') + '</button>'
            + '</div>'
            + '<div id="bfx-gp-body"><div class="bfx-modal-loading"><div class="streamflix-spinner-ring"></div><span>Loading Guest Passes…</span></div></div>', {
            className: 'streamflix-modal-lg bfx-gp-modal'
        });

        m.modal.querySelector('[data-act="close"]').addEventListener('click', function () {
            m.close(false);
        });

        function statusMeta(st) {
            var s = String(st || '').toLowerCase();
            if (s === 'active') { return { cls: 'is-active', label: 'Active' }; }
            if (s === 'expired') { return { cls: 'is-expired', label: 'Expired' }; }
            if (s === 'exhausted') { return { cls: 'is-exhausted', label: 'Max Devices' }; }
            return { cls: 'is-revoked', label: 'Revoked' };
        }

        function renderBody() {
            if (m.isClosed()) {
                return;
            }
            var bodyEl = m.modal.querySelector('#bfx-gp-body');
            if (!bodyEl) {
                return;
            }
            if (loading) {
                bodyEl.innerHTML = '<div class="bfx-modal-loading"><div class="streamflix-spinner-ring"></div><span>Loading Guest Passes…</span></div>';
                return;
            }

            var hasEligible = eligibleProfiles.length > 0;
            var profileOpts = eligibleProfiles.map(function (p) {
                var tag = p.isKids ? ' (Kids)' : '';
                return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml((p.avatarEmoji ? p.avatarEmoji + ' ' : '') + p.name + tag) + '</option>';
            }).join('');

            var phoneShareReady = canUsePhoneNativeShare();
            var spotlightHtml = '';
            if (spotlightInfo && spotlightInfo.pass) {
                var sp = spotlightInfo.pass;
                var spColor = sanitizeHexColor(sp.profileColorHex, '#E50914');
                var spCap = Number(sp.maxRedemptions);
                var spCapText = spCap > 0
                    ? ('Up to ' + spCap + ' ' + (spCap === 1 ? 'device' : 'devices'))
                    : 'Unlimited devices';
                var spCode = spotlightInfo.code || sp.code || '';
                var spResolvedUrl = resolveClientGuestShareUrl(spCode, spotlightInfo.shareUrl || sp.shareUrl);
                var canPhoneShare = phoneShareReady && Boolean(spResolvedUrl);
                spotlightHtml = ''
                    + '<div class="bfx-gp-spotlight" id="bfx-gp-spotlight-card">'
                    + '  <div class="bfx-gp-qr-box" id="bfx-gp-qr-host" aria-label="Guest Pass QR Code"></div>'
                    + '  <div class="bfx-gp-spot-info">'
                    + '    <div class="bfx-gp-spot-head">'
                    + '      <div>'
                    + '        <div class="bfx-gp-spot-kicker">READY TO SHARE</div>'
                    + '        <h3 class="bfx-gp-spot-title">' + escapeHtml(sp.label || 'Guest Pass') + '</h3>'
                    + '      </div>'
                    + '      <button type="button" class="streamflix-ghost-btn bfx-btn-xs" data-gp-hide-spot="1">Hide</button>'
                    + '    </div>'
                    + '    <div class="bfx-gp-spot-meta">'
                    + '      <span class="bfx-gp-prof-pill"><span class="bfx-gp-prof-dot" style="background:' + escapeHtml(spColor) + ';">' + escapeHtml(sp.profileEmoji || '🎟️') + '</span>' + escapeHtml(sp.profileName || 'Guest') + '</span>'
                    + '      <span>' + icon('clock') + ' ' + escapeHtml(formatRelativeExpiry(sp.expiresAtUtc || sp.expiresAt) || 'Expires soon') + '</span>'
                    + '      <span>' + escapeHtml(spCapText) + '</span>'
                    + '    </div>'
                    + (canPhoneShare
                        ? '    <button type="button" class="streamflix-btn-primary bfx-gp-phone-share-btn" data-gp-native-share="1">' + iconLabel('share', 'Share Invite') + '</button>'
                        : '')
                    + '    <div class="bfx-gp-copy-row">'
                    + '      <input type="text" class="streamflix-login-input bfx-gp-copy-input" readonly value="' + escapeHtml(spResolvedUrl) + '" aria-label="Guest Pass invite link" />'
                    + '      <button type="button" class="' + (canPhoneShare ? 'streamflix-ghost-btn' : 'streamflix-btn-primary') + ' bfx-gp-copy-btn" data-copy-val="' + escapeHtml(spResolvedUrl) + '" data-copy-label="Invite link">' + iconLabel('copy', 'Copy Link') + '</button>'
                    + '    </div>'
                    + '    <div class="bfx-gp-copy-row is-compact">'
                    + '      <span class="bfx-gp-code-label">Pass Code:</span>'
                    + '      <code class="bfx-gp-code-val">' + escapeHtml(spCode) + '</code>'
                    + '      <button type="button" class="streamflix-ghost-btn bfx-btn-xs" data-copy-val="' + escapeHtml(spCode) + '" data-copy-label="Pass code">' + iconLabel('copy', 'Copy Code') + '</button>'
                    + '    </div>'
                    + '  </div>'
                    + '</div>';
            }

            var listHtml = '';
            if (!passes.length) {
                listHtml = '<div class="bfx-gp-empty">No Guest Passes created yet. Generate one above when friends or family visit.</div>';
            } else {
                listHtml = passes.map(function (p) {
                    var st = statusMeta(p.status);
                    var isActive = st.cls === 'is-active';
                    var canRevoke = isActive || st.cls === 'is-exhausted';
                    var pCol = sanitizeHexColor(p.profileColorHex, '#2b2b2b');
                    var relExp = canRevoke ? formatRelativeExpiry(p.expiresAtUtc || p.expiresAt) : '';
                    var pMax = Number(p.maxRedemptions);
                    var devSummary = pMax > 0
                        ? ('Devices: ' + Number(p.redemptionCount || 0) + ' / ' + pMax)
                        : ('Devices: ' + Number(p.redemptionCount || 0) + ' (unlimited)');
                    var rowShareUrl = isActive ? resolveClientGuestShareUrl(p.code, p.shareUrl) : '';
                    return ''
                        + '<div class="bfx-gp-row ' + st.cls + '">'
                        + '  <div class="bfx-gp-row-avatar" style="background:' + escapeHtml(pCol) + ';">' + escapeHtml(p.profileEmoji || '🎟️') + '</div>'
                        + '  <div class="bfx-gp-row-main">'
                        + '    <div class="bfx-gp-row-top">'
                        + '      <span class="bfx-gp-row-label">' + escapeHtml(p.label || 'Guest Pass') + '</span>'
                        + '      <span class="bfx-gp-badge ' + st.cls + '">' + escapeHtml(st.label) + '</span>'
                        + '    </div>'
                        + '    <div class="bfx-gp-row-sub">'
                        + '      <span>Profile: <strong>' + escapeHtml(p.profileName || 'Profile') + '</strong></span>'
                        + '      <span>•</span>'
                        + '      <span>' + escapeHtml(devSummary) + '</span>'
                        + (relExp ? '<span>•</span><span>' + escapeHtml(relExp) + '</span>' : '')
                        + '    </div>'
                        + '  </div>'
                        + '  <div class="bfx-gp-row-actions">'
                        + (isActive && phoneShareReady && rowShareUrl
                            ? '<button type="button" class="streamflix-btn-primary bfx-btn-xs bfx-gp-phone-share-inline" data-gp-row-share="' + escapeHtml(p.id) + '">' + iconLabel('share', 'Share') + '</button>'
                            : '')
                        + (isActive
                            ? '<button type="button" class="streamflix-ghost-btn bfx-btn-xs" data-gp-share="' + escapeHtml(p.id) + '">' + iconLabel('qr', 'QR & Link') + '</button>'
                            : '')
                        + (canRevoke
                            ? '<button type="button" class="streamflix-btn-danger bfx-btn-xs" data-gp-revoke="' + escapeHtml(p.id) + '">Revoke</button>'
                            : '')
                        + '  </div>'
                        + '</div>';
                }).join('');
            }

            bodyEl.innerHTML = ''
                + (hasEligible
                    ? '<form class="bfx-gp-form" id="bfx-gp-create-form">'
                    + '  <div class="bfx-gp-field bfx-gp-field-grow">'
                    + '    <label for="bfx-gp-label">Guest Label</label>'
                    + '    <input type="text" id="bfx-gp-label" class="streamflix-login-input" maxlength="60" placeholder="Weekend Guest, House Sitter…" />'
                    + '  </div>'
                    + '  <div class="bfx-gp-field">'
                    + '    <label for="bfx-gp-profile">Locked Profile</label>'
                    + '    <select id="bfx-gp-profile" class="streamflix-select">' + profileOpts + '</select>'
                    + '  </div>'
                    + '  <div class="bfx-gp-field">'
                    + '    <label for="bfx-gp-hours">Expires In</label>'
                    + '    <select id="bfx-gp-hours" class="streamflix-select">'
                    + '      <option value="4">4 hours</option>'
                    + '      <option value="12">12 hours</option>'
                    + '      <option value="24" selected>24 hours</option>'
                    + '      <option value="48">48 hours</option>'
                    + '      <option value="72">3 days</option>'
                    + '      <option value="168">7 days</option>'
                    + '      <option value="336">14 days</option>'
                    + '      <option value="720">30 days</option>'
                    + '    </select>'
                    + '  </div>'
                    + '  <div class="bfx-gp-field bfx-gp-field-span-sm">'
                    + '    <label for="bfx-gp-max">Max Devices</label>'
                    + '    <select id="bfx-gp-max" class="streamflix-select">'
                    + '      <option value="1">1 device</option>'
                    + '      <option value="2" selected>2 devices</option>'
                    + '      <option value="3">3 devices</option>'
                    + '      <option value="5">5 devices</option>'
                    + '      <option value="10">10 devices</option>'
                    + '      <option value="0">Unlimited</option>'
                    + '    </select>'
                    + '  </div>'
                    + '  <div class="bfx-gp-field bfx-gp-field-btn">'
                    + '    <button type="submit" class="streamflix-btn-primary" id="bfx-gp-create-btn">' + iconLabel('plus', 'Create Pass') + '</button>'
                    + '  </div>'
                    + '</form>'
                    : '<div class="streamflix-auth-alert streamflix-auth-alert-error" style="margin-bottom:16px;">Create at least one non-Administrator household profile first — Guest Passes never grant access to Administrator accounts.</div>')
                + spotlightHtml
                + '<div class="bfx-gp-list-head">'
                + '  <span>Active Passes (' + passes.length + ')</span>'
                + '</div>'
                + '<div class="bfx-gp-list">' + listHtml + '</div>';

            if (spotlightInfo && spotlightInfo.qrSvg) {
                mountSanitizedQrSvg(bodyEl.querySelector('#bfx-gp-qr-host'), spotlightInfo.qrSvg);
            }

            var scrollSpotlightIntoView = function () {
                var spotCard = bodyEl.querySelector('#bfx-gp-spotlight-card');
                if (!spotCard) {
                    return;
                }
                spotCard.classList.remove('is-pulse');
                void spotCard.offsetWidth;
                spotCard.classList.add('is-pulse');
                try {
                    spotCard.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
                } catch (eScr) {}
            };

            var hideSpotBtn = bodyEl.querySelector('[data-gp-hide-spot]');
            if (hideSpotBtn) {
                hideSpotBtn.addEventListener('click', function () {
                    spotlightInfo = null;
                    renderBody();
                });
            }

            var nativeShareBtn = bodyEl.querySelector('[data-gp-native-share]');
            if (nativeShareBtn && spotlightInfo && spotlightInfo.pass) {
                nativeShareBtn.addEventListener('click', function () {
                    var spPass = spotlightInfo.pass || {};
                    triggerPhoneGuestPassShare({
                        label: spPass.label,
                        profileName: spPass.profileName,
                        code: spotlightInfo.code || spPass.code,
                        shareUrl: spotlightInfo.shareUrl || spPass.shareUrl
                    });
                });
            }

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-gp-row-share]'), function (btn) {
                btn.addEventListener('click', function () {
                    var pid = btn.getAttribute('data-gp-row-share');
                    var pMatch = null;
                    for (var i = 0; i < passes.length; i++) {
                        if (passes[i] && passes[i].id === pid) {
                            pMatch = passes[i];
                            break;
                        }
                    }
                    if (pMatch) {
                        triggerPhoneGuestPassShare({
                            label: pMatch.label,
                            profileName: pMatch.profileName,
                            code: pMatch.code,
                            shareUrl: pMatch.shareUrl
                        });
                    }
                });
            });

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-copy-val]'), function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.getAttribute('data-copy-val') || '';
                    var lbl = btn.getAttribute('data-copy-label') || 'Copied';
                    copyTextToClipboard(val).then(function (ok) {
                        showToast(ok ? (lbl + ' copied to clipboard.') : 'Could not copy automatically.', ok ? 'success' : 'error');
                    });
                });
            });

            var createForm = bodyEl.querySelector('#bfx-gp-create-form');
            if (createForm) {
                createForm.addEventListener('submit', function (ev) {
                    ev.preventDefault();
                    if (busyAction) {
                        return;
                    }
                    var labelVal = (bodyEl.querySelector('#bfx-gp-label').value || '').trim();
                    var profVal = bodyEl.querySelector('#bfx-gp-profile').value;
                    var hoursVal = parseInt(bodyEl.querySelector('#bfx-gp-hours').value, 10) || 24;
                    var rawMaxVal = parseInt(bodyEl.querySelector('#bfx-gp-max').value, 10);
                    var maxVal = isNaN(rawMaxVal) ? 2 : rawMaxVal;
                    var createBtn = bodyEl.querySelector('#bfx-gp-create-btn');
                    busyAction = true;
                    if (createBtn) {
                        createBtn.disabled = true;
                    }
                    apiFetch('/StreamFlix/GuestPasses/Create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            label: labelVal || 'Guest Pass',
                            profileId: profVal,
                            durationHours: hoursVal,
                            maxRedemptions: maxVal
                        })
                    }).then(function (res) {
                        busyAction = false;
                        if (res && res.pass) {
                            spotlightInfo = res;
                            passes.unshift(res.pass);
                            showToast('Guest Pass ready to share!', 'success');
                            renderBody();
                            scrollSpotlightIntoView();
                        }
                    }).catch(function (err) {
                        busyAction = false;
                        if (createBtn) {
                            createBtn.disabled = false;
                        }
                        showToast((err && err.message) || 'Could not create Guest Pass.', 'error');
                    });
                });
            }

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-gp-share]'), function (btn) {
                btn.addEventListener('click', function () {
                    if (busyAction) {
                        return;
                    }
                    var pid = btn.getAttribute('data-gp-share');
                    busyAction = true;
                    apiFetch('/StreamFlix/GuestPasses/' + encodeURIComponent(pid) + '/ShareInfo')
                        .then(function (res) {
                            busyAction = false;
                            if (res && res.pass) {
                                spotlightInfo = res;
                                renderBody();
                                scrollSpotlightIntoView();
                            }
                        })
                        .catch(function (err) {
                            busyAction = false;
                            showToast((err && err.message) || 'Could not load Guest Pass QR code.', 'error');
                        });
                });
            });

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-gp-revoke]'), function (btn) {
                btn.addEventListener('click', function () {
                    if (busyAction) {
                        return;
                    }
                    var pid = btn.getAttribute('data-gp-revoke');
                    busyAction = true;
                    btn.disabled = true;
                    apiFetch('/StreamFlix/GuestPasses/Revoke', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: pid })
                    }).then(function (res) {
                        busyAction = false;
                        if (res && Array.isArray(res.passes)) {
                            passes = res.passes;
                        }
                        if (spotlightInfo && spotlightInfo.pass && spotlightInfo.pass.id === pid) {
                            spotlightInfo = null;
                        }
                        var term = Number((res && res.terminatedSessions) || 0);
                        showToast(term > 0 ? ('Guest Pass deleted (' + term + ' active session' + (term === 1 ? '' : 's') + ' signed out).') : 'Guest Pass deleted.', 'info');
                        renderBody();
                    }).catch(function (err) {
                        busyAction = false;
                        btn.disabled = false;
                        showToast((err && err.message) || 'Could not revoke Guest Pass.', 'error');
                    });
                });
            });
        }

        apiFetch('/StreamFlix/GuestPasses')
            .then(function (res) {
                loading = false;
                passes = (res && Array.isArray(res.passes)) ? res.passes : [];
                eligibleProfiles = (res && Array.isArray(res.eligibleProfiles)) ? res.eligibleProfiles : [];
                renderBody();
            })
            .catch(function (err) {
                loading = false;
                if (!m.isClosed()) {
                    var bodyEl = m.modal.querySelector('#bfx-gp-body');
                    if (bodyEl) {
                        bodyEl.innerHTML = '<div class="streamflix-auth-alert streamflix-auth-alert-error">' + escapeHtml((err && err.message) || 'Administrator session required to manage Guest Passes.') + '</div>';
                    }
                }
            });
    }

    function openActiveDevicesModal() {
        var devices = [];
        var loading = true;
        var busyAction = false;

        var m = openModal(''
            + '<div class="bfx-modal-top">'
            + '  <div class="bfx-modal-top-title">'
            + '    <span class="bfx-modal-kicker">' + icon('shield') + ' <span>SESSION SECURITY</span></span>'
            + '    <h2>Active Devices</h2>'
            + '    <p class="streamflix-modal-text">Signed-in TVs, phones, browsers, and Guest Passes — sign out any individual device without logging out everyone else.</p>'
            + '  </div>'
            + '  <button type="button" class="streamflix-detail-close bfx-modal-close-inline" data-act="close" aria-label="Close">' + icon('close') + '</button>'
            + '</div>'
            + '<div id="bfx-dev-body"><div class="bfx-modal-loading"><div class="streamflix-spinner-ring"></div><span>Loading signed-in devices…</span></div></div>', {
            className: 'streamflix-modal-lg bfx-devices-modal'
        });

        m.modal.querySelector('[data-act="close"]').addEventListener('click', function () {
            m.close(false);
        });

        function resolveDeviceIconName(dev) {
            var hint = (String((dev && dev.deviceName) || '') + ' ' + String((dev && dev.appName) || '')).toLowerCase();
            if (/\b(tv|roku|chromecast|fire|webos|tizen|vidaa|shield|kodi|infuse|swiftfin)\b/.test(hint)) {
                return 'tv';
            }
            if (/\b(iphone|ipod|android|ios|mobile|phone|findroid|streamyfin)\b/.test(hint)) {
                return 'smartphone';
            }
            return 'laptop';
        }

        function fetchDevices() {
            loading = true;
            renderBody();
            var localDevId = getJellyfinDeviceInfo().deviceId || '';
            apiFetch('/StreamFlix/Devices?currentDeviceId=' + encodeURIComponent(localDevId))
                .then(function (res) {
                    loading = false;
                    devices = (res && Array.isArray(res.devices)) ? res.devices : [];
                    renderBody();
                })
                .catch(function (err) {
                    loading = false;
                    if (!m.isClosed()) {
                        var bodyEl = m.modal.querySelector('#bfx-dev-body');
                        if (bodyEl) {
                            bodyEl.innerHTML = '<div class="streamflix-auth-alert streamflix-auth-alert-error">' + escapeHtml((err && err.message) || 'Administrator session required to view active devices.') + '</div>';
                        }
                    }
                });
        }

        function renderBody() {
            if (m.isClosed()) {
                return;
            }
            var bodyEl = m.modal.querySelector('#bfx-dev-body');
            if (!bodyEl) {
                return;
            }
            if (loading) {
                bodyEl.innerHTML = '<div class="bfx-modal-loading"><div class="streamflix-spinner-ring"></div><span>Loading signed-in devices…</span></div>';
                return;
            }

            var liveCount = devices.filter(function (d) { return d && (d.isLive || d.nowPlaying); }).length;
            var summaryText = !devices.length
                ? 'No active device tokens found.'
                : (devices.length + ' signed-in ' + (devices.length === 1 ? 'device' : 'devices') + (liveCount > 0 ? ' · ' + liveCount + ' online now' : ''));

            var rowsHtml = '';
            if (!devices.length) {
                rowsHtml = '<div class="bfx-gp-empty">No signed-in devices are currently registered on this Jellyfin server.</div>';
            } else {
                rowsHtml = devices.map(function (d, idx) {
                    var icoName = resolveDeviceIconName(d);
                    var isLiveNow = Boolean(d.isLive || d.nowPlaying);
                    var pCol = sanitizeHexColor(d.profileColorHex, '#2b2b2b');
                    var relLast = formatRelativePast(d.lastActivityUtc);
                    var appLabel = d.appName || 'Jellyfin Client';
                    if (d.appVersion && String(appLabel).indexOf(d.appVersion) === -1) {
                        appLabel += ' ' + d.appVersion;
                    }
                    return ''
                        + '<div class="bfx-dev-row' + (d.isCurrentDevice ? ' is-current' : '') + '">'
                        + '  <div class="bfx-dev-ico' + (isLiveNow ? ' is-live' : '') + '">' + icon(icoName) + '</div>'
                        + '  <div class="bfx-dev-main">'
                        + '    <div class="bfx-dev-top">'
                        + '      <span class="bfx-dev-name">' + escapeHtml(d.deviceName || 'Unknown Device') + '</span>'
                        + (d.isCurrentDevice ? '<span class="bfx-dev-badge is-self">This Device</span>' : '')
                        + (d.nowPlaying
                            ? '<span class="bfx-dev-badge is-playing">' + icon('play') + '<span>' + escapeHtml(d.nowPlaying) + '</span></span>'
                            : (d.isLive ? '<span class="bfx-dev-badge is-live">Online</span>' : ''))
                        + (d.isGuestPass
                            ? '<span class="bfx-dev-badge is-guest">' + escapeHtml(d.guestPassLabel ? ('Guest · ' + d.guestPassLabel) : 'Guest Pass') + '</span>'
                            : '')
                        + (d.isAdminUser ? '<span class="bfx-dev-badge is-admin">Admin</span>' : '')
                        + '    </div>'
                        + '    <div class="bfx-dev-sub">'
                        + (d.profileName
                            ? '<span class="bfx-dev-prof"><span class="bfx-dev-prof-dot" style="background:' + escapeHtml(pCol) + ';">' + escapeHtml(d.profileEmoji || '🎬') + '</span>' + escapeHtml(d.profileName) + '</span><span>•</span>'
                            : (d.jellyfinUsername ? '<span>User: <strong>' + escapeHtml(d.jellyfinUsername) + '</strong></span><span>•</span>' : ''))
                        + '      <span>' + escapeHtml(appLabel) + '</span>'
                        + (relLast ? '<span>•</span><span>' + escapeHtml(relLast) + '</span>' : '')
                        + '    </div>'
                        + '  </div>'
                        + '  <div class="bfx-dev-actions">'
                        + '    <button type="button" class="streamflix-btn-danger bfx-btn-xs" data-dev-idx="' + idx + '">' + (d.isCurrentDevice ? 'Sign Out Here' : 'Sign Out') + '</button>'
                        + '  </div>'
                        + '</div>';
                }).join('');
            }

            bodyEl.innerHTML = ''
                + '<div class="bfx-dev-toolbar">'
                + '  <div class="bfx-dev-summary">' + escapeHtml(summaryText) + '</div>'
                + '  <div class="bfx-dev-toolbar-btns">'
                + '    <button type="button" class="streamflix-ghost-btn bfx-btn-xs" id="bfx-dev-refresh-btn">' + iconLabel('refresh', 'Refresh') + '</button>'
                + (devices.length > 0
                    ? '    <button type="button" class="streamflix-btn-danger bfx-btn-xs" id="bfx-dev-revoke-all-btn">Sign Out All Devices</button>'
                    : '')
                + '  </div>'
                + '</div>'
                + '<div class="bfx-dev-list">' + rowsHtml + '</div>';

            var refreshBtn = bodyEl.querySelector('#bfx-dev-refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function () {
                    if (!busyAction) {
                        fetchDevices();
                    }
                });
            }

            var revokeAllBtn = bodyEl.querySelector('#bfx-dev-revoke-all-btn');
            if (revokeAllBtn) {
                revokeAllBtn.addEventListener('click', function () {
                    if (busyAction) {
                        return;
                    }
                    confirmDialog({
                        title: 'Sign out all devices?',
                        message: 'Every TV, phone, browser, Guest Pass, and this device will immediately be signed out.',
                        confirmText: 'Sign Out All'
                    }).then(function (ok) {
                        if (!ok || busyAction) {
                            return;
                        }
                        busyAction = true;
                        revokeAllBtn.disabled = true;
                        apiFetch('/StreamFlix/Sessions/RevokeAll', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: '{}'
                        }).then(function () {
                            busyAction = false;
                            m.close(true);
                            showToast('All devices signed out.', 'info');
                            signOutHousehold();
                        }).catch(function (err) {
                            busyAction = false;
                            revokeAllBtn.disabled = false;
                            showToast((err && err.message) || 'Could not sign out all devices.', 'error');
                        });
                    });
                });
            }

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-dev-idx]'), function (btn) {
                btn.addEventListener('click', function () {
                    if (busyAction) {
                        return;
                    }
                    var idx = parseInt(btn.getAttribute('data-dev-idx'), 10);
                    var target = devices[idx];
                    if (!target || !target.deviceId) {
                        return;
                    }
                    var executeRevoke = function () {
                        busyAction = true;
                        btn.disabled = true;
                        apiFetch('/StreamFlix/Devices/Revoke', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                deviceId: target.deviceId,
                                userId: target.userId || ''
                            })
                        }).then(function (res) {
                            busyAction = false;
                            if ((res && res.wasCurrentDevice) || target.isCurrentDevice) {
                                m.close(true);
                                showToast('Signed out this device.', 'info');
                                signOutHousehold();
                                return;
                            }
                            devices = devices.filter(function (item) {
                                if (!item) { return false; }
                                if (String(item.deviceId || '').toLowerCase() !== String(target.deviceId || '').toLowerCase()) {
                                    return true;
                                }
                                if (target.userId && item.userId && String(item.userId).toLowerCase() !== String(target.userId).toLowerCase()) {
                                    return true;
                                }
                                return false;
                            });
                            showToast('Signed out "' + (target.deviceName || 'device') + '".', 'info');
                            renderBody();
                        }).catch(function (err) {
                            busyAction = false;
                            btn.disabled = false;
                            showToast((err && err.message) || 'Could not sign out device.', 'error');
                        });
                    };

                    if (target.isCurrentDevice) {
                        confirmDialog({
                            title: 'Sign out this device?',
                            message: 'You are currently using "' + (target.deviceName || 'this device') + '". You will need to sign in again immediately.',
                            confirmText: 'Sign Out'
                        }).then(function (ok) {
                            if (ok) {
                                executeRevoke();
                            }
                        });
                    } else {
                        executeRevoke();
                    }
                });
            });
        }

        fetchDevices();
    }

    function applySeerrStatusUpdate(tmdbId, isTv, nextStatus, nextLabel) {
        if (Array.isArray(state.seerrSearchResults)) {
            state.seerrSearchResults.forEach(function (it) {
                if (it && Number(it.tmdbId) === Number(tmdbId) && (String(it.mediaType || '').toLowerCase() === 'tv') === Boolean(isTv)) {
                    it.mediaStatus = nextStatus;
                    it.statusLabel = nextLabel;
                    if (nextStatus === 1) {
                        it.downloadProgress = null;
                    }
                }
            });
        }
        if (typeof refreshSingleSeerrCardDom === 'function' && refreshSingleSeerrCardDom(tmdbId, isTv)) {
            return;
        }
        if (state.searchQuery) {
            renderCinemaHubContents();
        }
    }

    function formatSeerrMinutes(mins) {
        var m = Number(mins || 0);
        if (!m || m <= 0 || !isFinite(m)) {
            return '';
        }
        var hrs = Math.floor(m / 60);
        var rem = m % 60;
        if (hrs > 0) {
            return rem > 0 ? (hrs + 'h ' + rem + 'm') : (hrs + 'h');
        }
        return rem + 'm';
    }

    function quickRequestSeerrMovie(seerrItem) {
        if (!seerrItem || !seerrItem.tmdbId) {
            return;
        }
        var tmdbId = Number(seerrItem.tmdbId);
        var isTv = String(seerrItem.mediaType || '').toLowerCase() === 'tv';
        var key = (isTv ? 'tv' : 'movie') + ':' + tmdbId;
        if (!state.seerrSubmittingMap) {
            state.seerrSubmittingMap = {};
        }
        if (state.seerrSubmittingMap[key]) {
            return;
        }
        state.seerrSubmittingMap[key] = true;
        if (typeof refreshSingleSeerrCardDom === 'function') {
            refreshSingleSeerrCardDom(tmdbId, isTv);
        }

        var activeProfId = (state.activeProfile && state.activeProfile.id) || '';
        apiFetch('/StreamFlix/Seerr/Request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tmdbId: tmdbId,
                mediaType: isTv ? 'tv' : 'movie',
                seasons: isTv ? [] : undefined,
                profileId: activeProfId
            })
        }).then(function (res) {
            delete state.seerrSubmittingMap[key];
            var nextStatus = (res && res.mediaStatus) ? Number(res.mediaStatus) : 2;
            var nextLabel = (res && res.statusLabel) || 'Requested';
            seerrItem.mediaStatus = nextStatus;
            seerrItem.statusLabel = nextLabel;
            applySeerrStatusUpdate(tmdbId, isTv, nextStatus, nextLabel);
            showToast((res && res.message) || ('Requested "' + (seerrItem.title || 'Title') + '"!'), 'success');
        }).catch(function (err) {
            delete state.seerrSubmittingMap[key];
            if (typeof refreshSingleSeerrCardDom === 'function') {
                refreshSingleSeerrCardDom(tmdbId, isTv);
            }
            showToast((err && err.message) || 'Request failed — check Seerr settings.', 'error');
        });
    }

    function openSeerrRequestModal(seerrItem) {
        if (!seerrItem || !seerrItem.tmdbId) {
            return;
        }
        var isTv = String(seerrItem.mediaType || '').toLowerCase() === 'tv';
        var mediaPath = isTv ? 'tv' : 'movie';
        var tmdbId = Number(seerrItem.tmdbId);
        var activeProfId = (state.activeProfile && state.activeProfile.id) || '';
        var rawArt = seerrItem.backdropUrl || seerrItem.posterUrl || '';
        var artUrl = /^https:\/\//i.test(rawArt) ? rawArt : '';
        var posterThumbUrl = (typeof seerrItem.posterUrl === 'string' && /^https:\/\//i.test(seerrItem.posterUrl.trim())) ? seerrItem.posterUrl.trim() : '';
        var rawVote = Number(seerrItem.rating || seerrItem.voteAverage || 0);
        var rating = rawVote > 0 ? rawVote.toFixed(1) : '';
        if (Number(seerrItem.mediaStatus) === 7) {
            seerrItem.mediaStatus = 1;
        }

        var tagline = typeof seerrItem.tagline === 'string' ? seerrItem.tagline : '';
        var runtimeMinutes = Number(seerrItem.runtimeMinutes || 0);
        var genres = Array.isArray(seerrItem.genres) ? seerrItem.genres.slice(0, 3) : [];
        var mediaStatus4k = Number(seerrItem.mediaStatus4k || 1);
        var activeRequestId = seerrItem.activeRequestId ? Number(seerrItem.activeRequestId) : 0;
        var verifiedJfId = (typeof seerrItem.jellyfinMediaId === 'string' && /^[a-f0-9]{32}$/i.test(seerrItem.jellyfinMediaId.trim()))
            ? seerrItem.jellyfinMediaId.trim()
            : '';
        var partialRequestsEnabled = seerrItem.partialRequestsEnabled !== false;
        var servers = [];
        var selectedServerId = null;

        var seasons = [];
        var selectedSeasons = {};
        var loadingDetails = true;
        var submitting = false;
        var cancelling = false;
        var errorMsg = '';
        var detailAbort = typeof AbortController === 'function' ? new AbortController() : null;

        var m = openModal('<div id="bfx-seerr-modal-root"></div>', {
            className: 'streamflix-modal-md bfx-seerr-modal',
            onClose: function () {
                if (detailAbort) {
                    try { detailAbort.abort(); } catch (eAb) {}
                    detailAbort = null;
                }
            }
        });

        function statusPillInfo(statusNum, customLabel, dlPct) {
            var st = Number(statusNum || 1);
            if (st === 7 || st <= 0) { st = 1; }
            var hasDl = (typeof dlPct === 'number' && !isNaN(dlPct)) || /^downloading/i.test(String(customLabel || ''));
            if (hasDl && (st === 2 || st === 3)) {
                return {
                    cls: 'is-downloading',
                    text: customLabel || (typeof dlPct === 'number' && dlPct > 0 ? ('Downloading · ' + Math.round(dlPct) + '%') : 'Downloading')
                };
            }
            if (st === 5) { return { cls: 'is-available', text: customLabel || 'In Library' }; }
            if (st === 4) { return { cls: 'is-partial', text: customLabel || 'Partially Available' }; }
            if (st === 3) { return { cls: 'is-processing', text: customLabel || 'Processing' }; }
            if (st === 2) { return { cls: 'is-pending', text: customLabel || 'Requested' }; }
            if (st === 6) { return { cls: 'is-declined', text: 'Unavailable' }; }
            return { cls: 'is-requestable', text: customLabel || 'Available to Request' };
        }

        function getChosenServer() {
            if (!servers.length) {
                return null;
            }
            for (var i = 0; i < servers.length; i++) {
                if (Number(servers[i].id) === Number(selectedServerId)) {
                    return servers[i];
                }
            }
            return servers[0];
        }

        function getEffectiveTierStatus() {
            var sv = getChosenServer();
            var raw = (sv && sv.is4k) ? mediaStatus4k : Number(seerrItem.mediaStatus || 1);
            return (raw === 7 || raw <= 0) ? 1 : raw;
        }

        function countSelectedSeasons() {
            return Object.keys(selectedSeasons)
                .filter(function (k) { return Boolean(selectedSeasons[k]); })
                .map(function (k) { return parseInt(k, 10); })
                .filter(function (n) { return n > 0; })
                .sort(function (a, b) { return a - b; });
        }

        function applyDefaultSeasonSelection() {
            selectedSeasons = {};
            var airedReq = seasons.filter(function (s) {
                var st = Number(s.status || 1);
                return Number(s.episodeCount || 0) > 0 && (st === 1 || st === 4);
            });
            var targetList = (!partialRequestsEnabled || !airedReq.length)
                ? seasons.filter(function (s) { var st = Number(s.status || 1); return st === 1 || st === 4; })
                : airedReq;
            targetList.forEach(function (s) {
                if (Number(s.seasonNumber) > 0) {
                    selectedSeasons[Number(s.seasonNumber)] = true;
                }
            });
        }

        function submitSeerrRequest() {
            if (submitting || cancelling) {
                return;
            }
            var chosenSeasons = isTv ? countSelectedSeasons() : [];
            if (isTv && !loadingDetails && seasons.length > 0 && !chosenSeasons.length) {
                errorMsg = 'Select at least one season to request.';
                render();
                return;
            }
            submitting = true;
            errorMsg = '';
            render();

            var chosenSv = getChosenServer();
            var payload = {
                tmdbId: tmdbId,
                mediaType: mediaPath,
                seasons: isTv ? chosenSeasons : undefined,
                is4k: chosenSv ? Boolean(chosenSv.is4k) : undefined,
                serverId: (chosenSv && servers.length > 1) ? Number(chosenSv.id) : undefined,
                profileId: activeProfId
            };

            apiFetch('/StreamFlix/Seerr/Request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (res) {
                submitting = false;
                var nextStatus = (res && res.mediaStatus) ? Number(res.mediaStatus) : 2;
                var nextLabel = (res && res.statusLabel) || 'Requested';
                if (chosenSv && chosenSv.is4k) {
                    mediaStatus4k = nextStatus;
                } else {
                    seerrItem.mediaStatus = nextStatus;
                }
                seerrItem.statusLabel = nextLabel;
                if (res && res.requestId) {
                    activeRequestId = Number(res.requestId);
                    seerrItem.canCancel = /^pending/i.test(String(nextLabel || ''));
                }
                applySeerrStatusUpdate(tmdbId, isTv, Number(seerrItem.mediaStatus || nextStatus), nextLabel);
                showToast((res && res.message) || ('Requested "' + (seerrItem.title || 'Title') + '"!'), 'success');
                m.close(true);
            }).catch(function (err) {
                submitting = false;
                errorMsg = (err && err.message) || 'Request failed. Verify your Seerr URL, API Key, and Radarr/Sonarr server in Seerr.';
                render();
            });
        }

        function cancelActiveSeerrRequest() {
            if (cancelling || submitting || !activeRequestId) {
                return;
            }
            cancelling = true;
            errorMsg = '';
            render();

            apiFetch('/StreamFlix/Seerr/Cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: activeRequestId,
                    profileId: activeProfId
                })
            }).then(function (res) {
                cancelling = false;
                activeRequestId = 0;
                seerrItem.mediaStatus = 1;
                seerrItem.statusLabel = 'Not Requested';
                mediaStatus4k = 1;
                applySeerrStatusUpdate(tmdbId, isTv, 1, 'Not Requested');
                showToast((res && res.message) || 'Request cancelled.', 'info');
                render();
            }).catch(function (err) {
                cancelling = false;
                errorMsg = (err && err.message) || 'Could not cancel request in Seerr.';
                render();
            });
        }

        function render() {
            if (m.isClosed()) {
                return;
            }
            var root = m.modal.querySelector('#bfx-seerr-modal-root');
            if (!root) {
                return;
            }

            var chosenSv = getChosenServer();
            var tierStatus = getEffectiveTierStatus();
            var dlNum = (typeof seerrItem.downloadProgress === 'number' && !isNaN(seerrItem.downloadProgress))
                ? Math.max(0, Math.min(100, Math.round(seerrItem.downloadProgress)))
                : null;
            var stInfo = statusPillInfo(
                tierStatus,
                (chosenSv && chosenSv.is4k && tierStatus === 1) ? '4K Available to Request' : seerrItem.statusLabel,
                dlNum
            );

            var dlCardHtml = '';
            if (dlNum !== null || stInfo.cls === 'is-downloading') {
                var barWidth = dlNum !== null ? dlNum : 12;
                dlCardHtml = ''
                    + '<div class="bfx-seerr-dl-card">'
                    + '  <div class="bfx-seerr-dl-head">'
                    + '    <span>' + icon('download') + 'Downloading to Library</span>'
                    + (dlNum !== null ? '<span>' + dlNum + '%</span>' : '<span>Active</span>')
                    + '  </div>'
                    + '  <div class="bfx-seerr-dl-bar"><div class="bfx-seerr-dl-fill" style="width:' + barWidth + '%;"></div></div>'
                    + '</div>';
            }

            var isAdminSeerr = typeof isActiveProfileAdmin === 'function' && isActiveProfileAdmin();
            var serverPickerHtml = '';
            if (isAdminSeerr && servers.length > 1) {
                var svPills = servers.map(function (sv) {
                    var isSel = chosenSv && Number(chosenSv.id) === Number(sv.id);
                    var tierTag = sv.is4k ? '<span class="bfx-seerr-4k-tag">4K</span>' : '<span class="bfx-seerr-hd-tag">HD</span>';
                    return '<button type="button" class="bfx-seerr-server-pill' + (isSel ? ' is-active' : '') + '" data-seerr-server="' + Number(sv.id) + '">'
                        + tierTag + '<span>' + escapeHtml(sv.name || (sv.is4k ? '4K Server' : 'Standard')) + '</span>'
                        + '</button>';
                }).join('');
                serverPickerHtml = ''
                    + '<div class="bfx-seerr-server-section">'
                    + '  <div class="bfx-seerr-seasons-head"><span>Quality / Target Server</span></div>'
                    + '  <div class="bfx-seerr-server-pills">' + svPills + '</div>'
                    + '</div>';
            }

            var seasonsSectionHtml = '';
            var canSubmit = false;
            var showSubmitBtn = false;
            var submitLabel = isTv ? 'Request Seasons' : (chosenSv && chosenSv.is4k ? 'Request 4K Movie' : 'Request Movie');

            if (!isTv) {
                canSubmit = tierStatus === 1;
                showSubmitBtn = canSubmit;
                if (!canSubmit && !dlCardHtml) {
                    seasonsSectionHtml = '<div class="bfx-seerr-status-note">Status in Seerr: <strong>' + escapeHtml(stInfo.text) + '</strong>'
                        + (tierStatus === 2 ? ' — queued for Radarr download.' : (tierStatus === 3 ? ' — Radarr is processing this movie.' : '.'))
                        + '</div>';
                }
            } else if (loadingDetails) {
                showSubmitBtn = true;
                canSubmit = false;
                submitLabel = 'Loading Seasons…';
                seasonsSectionHtml = '<div class="bfx-modal-loading" style="padding:18px 0;"><div class="streamflix-spinner-ring" style="width:28px;height:28px;border-width:3px;"></div><span>Loading seasons from Seerr…</span></div>';
            } else if (!seasons.length) {
                canSubmit = tierStatus === 1 || tierStatus === 4;
                showSubmitBtn = canSubmit;
                submitLabel = chosenSv && chosenSv.is4k ? 'Request 4K Series' : 'Request Series';
                seasonsSectionHtml = '<div class="bfx-seerr-status-note">All available seasons will be requested automatically in Seerr.</div>';
            } else {
                var requestableCount = 0;
                var rowsHtml = seasons.map(function (s) {
                    var sNum = Number(s.seasonNumber || 0);
                    var sSt = Number(s.status || 1);
                    var isReq = sSt === 1 || sSt === 4;
                    if (isReq) {
                        requestableCount += 1;
                    }
                    var rowEditable = isReq && partialRequestsEnabled;
                    var sBadge = statusPillInfo(sSt, s.statusLabel, null);
                    var checked = Boolean(selectedSeasons[sNum]);
                    var epCnt = Number(s.episodeCount || 0) > 0
                        ? (s.episodeCount + ' ep' + (s.episodeCount === 1 ? '' : 's'))
                        : 'TBA';
                    var yrTxt = s.year ? String(s.year) : '';
                    return ''
                        + '<label class="bfx-seerr-season-row' + (rowEditable ? ' is-selectable' : ' is-locked') + (checked ? ' is-checked' : '') + '">'
                        + '  <input type="checkbox" data-seerr-season="' + sNum + '"' + (checked ? ' checked' : '') + (rowEditable ? '' : ' disabled') + ' />'
                        + '  <span class="bfx-seerr-season-name">' + escapeHtml(s.name || ('Season ' + sNum)) + '</span>'
                        + (yrTxt ? '<span class="bfx-seerr-season-yr">' + escapeHtml(yrTxt) + '</span>' : '')
                        + '  <span class="bfx-seerr-season-eps">' + escapeHtml(epCnt) + '</span>'
                        + '  <span class="bfx-seerr-badge ' + sBadge.cls + '">' + escapeHtml(sBadge.text) + '</span>'
                        + '</label>';
                }).join('');

                var selNums = countSelectedSeasons();
                canSubmit = selNums.length > 0;
                showSubmitBtn = requestableCount > 0;
                if (selNums.length > 0) {
                    submitLabel = 'Request ' + selNums.length + (chosenSv && chosenSv.is4k ? ' 4K' : '') + ' Season' + (selNums.length === 1 ? '' : 's');
                }
                seasonsSectionHtml = ''
                    + (!partialRequestsEnabled && requestableCount > 0
                        ? '<div class="bfx-seerr-status-note" style="margin-bottom:10px;">Full-series mode is active in Seerr — all unrequested seasons are requested together.</div>'
                        : '')
                    + '<div class="bfx-seerr-seasons-head">'
                    + '  <span>Seasons (' + seasons.length + ')</span>'
                    + (partialRequestsEnabled && requestableCount > 1
                        ? '<button type="button" class="streamflix-ghost-btn bfx-btn-xs" id="bfx-seerr-toggle-all">' + (selNums.length === requestableCount ? 'Clear' : 'Select All (' + requestableCount + ')') + '</button>'
                        : '')
                    + '</div>'
                    + '<div class="bfx-seerr-seasons">' + rowsHtml + '</div>';
            }

            var rtFormatted = formatSeerrMinutes(runtimeMinutes);
            var genrePillsHtml = genres.length
                ? genres.map(function (g) { return '<span class="bfx-seerr-genre-chip">' + escapeHtml(g) + '</span>'; }).join('')
                : '';
            var canCancel = activeRequestId > 0
                && (isAdminSeerr || seerrItem.canCancel === true)
                && (tierStatus === 2 || /^pending/i.test(String(seerrItem.statusLabel || '')));

            root.innerHTML = ''
                + '<div class="bfx-seerr-hero">'
                + (artUrl ? '<img class="bfx-seerr-hero-img" src="' + escapeHtml(artUrl) + '" alt="" referrerpolicy="no-referrer" data-bfx-img="fade" />' : '')
                + '  <div class="bfx-seerr-hero-scrim"></div>'
                + '  <button type="button" class="streamflix-detail-close" data-act="close" aria-label="Close">' + icon('close') + '</button>'
                + '  <div class="bfx-seerr-hero-body">'
                + (posterThumbUrl ? '    <img class="bfx-seerr-hero-poster" src="' + escapeHtml(posterThumbUrl) + '" alt="" referrerpolicy="no-referrer" data-bfx-img="fade" />' : '')
                + '    <div class="bfx-seerr-hero-copy">'
                + '      <div class="bfx-seerr-badges-row">'
                + '        <span class="bfx-seerr-brand-pill">' + icon('seerrIcon') + '<span>SEERR</span></span>'
                + '        <span class="bfx-seerr-type">' + (isTv ? 'SERIES' : 'MOVIE') + '</span>'
                + '        <span class="bfx-seerr-badge ' + stInfo.cls + '">' + escapeHtml(stInfo.text) + '</span>'
                + '      </div>'
                + '      <h2 class="bfx-seerr-title">' + escapeHtml(seerrItem.title || 'Untitled') + '</h2>'
                + '      <div class="streamflix-hero-meta-row">'
                + (rating ? '<span class="streamflix-hero-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '')
                + (seerrItem.year ? '<span>' + escapeHtml(String(seerrItem.year)) + '</span>' : '')
                + (rtFormatted ? '<span>' + escapeHtml(rtFormatted) + '</span>' : '')
                + genrePillsHtml
                + '      </div>'
                + '    </div>'
                + '  </div>'
                + '</div>'
                + '<div class="bfx-seerr-body">'
                + (errorMsg ? '<div class="streamflix-auth-alert streamflix-auth-alert-error" style="margin-bottom:12px;">' + escapeHtml(errorMsg) + '</div>' : '')
                + (tagline ? '  <div class="bfx-seerr-tagline">“' + escapeHtml(tagline) + '”</div>' : '')
                + '  <p class="bfx-seerr-modal-overview">' + escapeHtml(seerrItem.overview || 'No synopsis available on TMDB.') + '</p>'
                + dlCardHtml
                + serverPickerHtml
                + seasonsSectionHtml
                + '  <div class="streamflix-modal-actions streamflix-modal-actions-end bfx-seerr-footer-actions">'
                + '    <button type="button" class="streamflix-ghost-btn" id="bfx-seerr-view-all-reqs" style="margin-right:auto;">' + iconLabel('seerrIcon', 'Requests') + '</button>'
                + (canCancel
                    ? '    <button type="button" class="streamflix-ghost-btn bfx-seerr-cancel-btn" id="bfx-seerr-cancel-btn"' + (cancelling ? ' disabled' : '') + '>' + (cancelling ? 'Cancelling…' : 'Cancel Request') + '</button>'
                    : '')
                + '    <button type="button" class="streamflix-ghost-btn" data-act="close">Close</button>'
                + (verifiedJfId
                    ? '    <button type="button" class="' + (showSubmitBtn ? 'streamflix-ghost-btn' : 'streamflix-btn-primary') + '" id="bfx-seerr-open-jf">' + iconLabel('play', 'Open in Library') + '</button>'
                    : '')
                + (showSubmitBtn
                    ? '    <button type="button" class="streamflix-btn-primary bfx-seerr-submit-primary" id="bfx-seerr-submit-btn"' + ((!canSubmit || submitting) ? ' disabled' : '') + '>'
                        + (submitting ? '<span class="bfx-qbtn-mini-spin"></span><span>Requesting…</span>' : iconLabel('plus', submitLabel))
                        + '</button>'
                    : '')
                + '  </div>'
                + '</div>';

            hydrateCompleteImages(root);
            Array.prototype.forEach.call(root.querySelectorAll('[data-act="close"]'), function (b) {
                b.addEventListener('click', function () { m.close(false); });
            });

            var allReqsBtn = root.querySelector('#bfx-seerr-view-all-reqs');
            if (allReqsBtn) {
                allReqsBtn.addEventListener('click', function () {
                    m.close(false);
                    openSeerrRequestsModal();
                });
            }

            var cancelReqBtn = root.querySelector('#bfx-seerr-cancel-btn');
            if (cancelReqBtn) {
                cancelReqBtn.addEventListener('click', cancelActiveSeerrRequest);
            }

            var openJfBtn = root.querySelector('#bfx-seerr-open-jf');
            if (openJfBtn) {
                openJfBtn.addEventListener('click', function () {
                    var jfId = verifiedJfId;
                    m.close(true);
                    openHeroDetailModalById(jfId);
                });
            }

            Array.prototype.forEach.call(root.querySelectorAll('[data-seerr-server]'), function (pill) {
                pill.addEventListener('click', function () {
                    selectedServerId = parseInt(pill.getAttribute('data-seerr-server'), 10);
                    render();
                });
            });

            Array.prototype.forEach.call(root.querySelectorAll('[data-seerr-season]'), function (cb) {
                cb.addEventListener('change', function () {
                    if (!partialRequestsEnabled) {
                        return;
                    }
                    var sNum = parseInt(cb.getAttribute('data-seerr-season'), 10);
                    if (sNum > 0) {
                        selectedSeasons[sNum] = Boolean(cb.checked);
                        render();
                    }
                });
            });

            var toggleAllBtn = root.querySelector('#bfx-seerr-toggle-all');
            if (toggleAllBtn) {
                toggleAllBtn.addEventListener('click', function () {
                    var reqSeasons = seasons.filter(function (s) { return Number(s.status || 1) === 1 || Number(s.status || 1) === 4; });
                    var allSelected = countSelectedSeasons().length === reqSeasons.length;
                    selectedSeasons = {};
                    if (!allSelected) {
                        reqSeasons.forEach(function (s) {
                            if (Number(s.seasonNumber) > 0) {
                                selectedSeasons[Number(s.seasonNumber)] = true;
                            }
                        });
                    }
                    render();
                });
            }

            var submitBtn = root.querySelector('#bfx-seerr-submit-btn');
            if (submitBtn) {
                submitBtn.addEventListener('click', submitSeerrRequest);
            }
        }

        render();

        apiFetch(
            '/StreamFlix/Seerr/Details/' + encodeURIComponent(mediaPath) + '/' + encodeURIComponent(String(tmdbId)) + '?profileId=' + encodeURIComponent(activeProfId),
            detailAbort ? { signal: detailAbort.signal } : {}
        )
            .then(function (res) {
                detailAbort = null;
                loadingDetails = false;
                if (res) {
                    if (res.title) { seerrItem.title = res.title; }
                    if (res.year) { seerrItem.year = res.year; }
                    if (res.overview) { seerrItem.overview = res.overview; }
                    if (res.tagline) { tagline = res.tagline; }
                    if (res.runtimeMinutes) { runtimeMinutes = Number(res.runtimeMinutes); }
                    if (res.rating) { rating = Number(res.rating).toFixed(1); }
                    if (Array.isArray(res.genres) && res.genres.length) { genres = res.genres.slice(0, 3); }
                    if (res.posterUrl && /^https:\/\//i.test(res.posterUrl)) { posterThumbUrl = res.posterUrl; }
                    if (res.backdropUrl && /^https:\/\//i.test(res.backdropUrl)) { artUrl = res.backdropUrl; }
                    if (res.mediaStatus) {
                        seerrItem.mediaStatus = Number(res.mediaStatus) === 7 ? 1 : Number(res.mediaStatus);
                    }
                    if (res.mediaStatus4k) {
                        mediaStatus4k = Number(res.mediaStatus4k) === 7 ? 1 : Number(res.mediaStatus4k);
                    }
                    if (res.statusLabel) { seerrItem.statusLabel = res.statusLabel; }
                    if (typeof res.downloadProgress === 'number') { seerrItem.downloadProgress = res.downloadProgress; }
                    activeRequestId = res.activeRequestId ? Number(res.activeRequestId) : 0;
                    verifiedJfId = (typeof res.jellyfinMediaId === 'string' && /^[a-f0-9]{32}$/i.test(res.jellyfinMediaId.trim()))
                        ? res.jellyfinMediaId.trim()
                        : '';
                    seerrItem.jellyfinMediaId = verifiedJfId || null;
                    partialRequestsEnabled = res.partialRequestsEnabled !== false;

                    if (Array.isArray(res.servers) && res.servers.length) {
                        servers = res.servers;
                        var defSv = null;
                        if (!isTv && Number(seerrItem.mediaStatus) === 5 && mediaStatus4k === 1) {
                            defSv = servers.filter(function (s) { return s.is4k; })[0] || null;
                        }
                        if (!defSv) {
                            defSv = servers.filter(function (s) { return s.isDefault && !s.is4k; })[0]
                                || servers.filter(function (s) { return !s.is4k; })[0]
                                || servers.filter(function (s) { return s.isDefault; })[0]
                                || servers[0];
                        }
                        selectedServerId = defSv ? Number(defSv.id) : null;
                    }

                    if (isTv) {
                        var rawSeasons = Array.isArray(res.seasons) ? res.seasons : [];
                        seasons = rawSeasons.filter(function (s) { return s && Number(s.seasonNumber) >= 1; });
                        seasons.forEach(function (s) {
                            var st = Number(s.status || 1);
                            s.status = (st === 7 || st <= 0) ? 1 : st;
                        });
                        applyDefaultSeasonSelection();
                    }
                }
                render();
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') {
                    return;
                }
                detailAbort = null;
                loadingDetails = false;
                if (isTv) {
                    errorMsg = (err && err.message) || 'Could not load season details from Seerr.';
                }
                render();
            });
    }

    function openSeerrRequestsModal() {
        if (!isCurrentProfileSeerrAllowed()) {
            showToast('Seerr media requests are not enabled for this profile.', 'info');
            return;
        }
        var activeProfId = (state.activeProfile && state.activeProfile.id) || '';
        var requests = [];
        var filterKey = 'all';
        var loading = true;
        var cancellingId = 0;

        var reqsAbort = null;

        var m = openModal(''
            + '<div class="bfx-modal-top">'
            + '  <div class="bfx-modal-top-title">'
            + '    <span class="bfx-modal-kicker">' + icon('seerrIcon') + ' <span>SEERR TRACKER</span></span>'
            + '    <h2>Media Requests</h2>'
            + '    <p class="streamflix-modal-text">Track requested movies and TV seasons from queue to download to ready-to-watch.</p>'
            + '  </div>'
            + '  <button type="button" class="streamflix-detail-close bfx-modal-close-inline" data-act="close" aria-label="Close">' + icon('close') + '</button>'
            + '</div>'
            + '<div id="bfx-seerr-reqs-body"><div class="bfx-modal-loading"><div class="streamflix-spinner-ring"></div><span>Loading recent requests from Seerr…</span></div></div>', {
            className: 'streamflix-modal-lg bfx-seerr-reqs-modal',
            onClose: function () {
                if (reqsAbort) {
                    try { reqsAbort.abort(); } catch (eAbR) {}
                    reqsAbort = null;
                }
            }
        });

        m.modal.querySelector('[data-act="close"]').addEventListener('click', function () {
            m.close(false);
        });

        function badgeMeta(r) {
            var k = String((r && r.statusKey) || '').toLowerCase();
            if (k === 'downloading') {
                return { cls: 'is-downloading', ico: 'download', label: r.statusLabel || 'Downloading' };
            }
            if (k === 'available') {
                return { cls: 'is-available', ico: 'check', label: r.statusLabel || 'Available' };
            }
            if (k === 'partial') {
                return { cls: 'is-partial', ico: 'check', label: r.statusLabel || 'Partially Available' };
            }
            if (k === 'declined' || k === 'failed') {
                return { cls: 'is-declined', ico: 'close', label: r.statusLabel || (k === 'failed' ? 'Failed' : 'Declined') };
            }
            if (k === 'processing' || k === 'approved') {
                return { cls: 'is-processing', ico: 'clock', label: r.statusLabel || 'Processing' };
            }
            return { cls: 'is-pending', ico: 'clock', label: (r && r.statusLabel) || 'Pending Approval' };
        }

        function resolveLocalLibraryId(r) {
            if (!r) {
                return '';
            }
            var jfId = typeof r.jellyfinMediaId === 'string' ? r.jellyfinMediaId.trim() : '';
            if (jfId && /^[a-f0-9]{32}$/i.test(jfId)) {
                return jfId;
            }
            var stKey = String(r.statusKey || '').toLowerCase();
            if (stKey !== 'available' && stKey !== 'partial' && Number(r.mediaStatus || 0) < 4) {
                return '';
            }
            var d = state.hubData || {};
            var pool = r.mediaType === 'tv' ? (d.allSeries || []) : (d.allMovies || []);
            var targetTitle = String(r.title || '').trim().toLowerCase();
            if (!targetTitle) {
                return '';
            }
            for (var i = 0; i < pool.length; i++) {
                var it = pool[i];
                if (!it || !it.Id) {
                    continue;
                }
                if (String(it.Name || '').trim().toLowerCase() === targetTitle) {
                    if (!r.year || !it.ProductionYear || String(it.ProductionYear) === String(r.year)) {
                        return it.Id;
                    }
                }
            }
            return '';
        }

        function fetchRequests() {
            if (reqsAbort) {
                try { reqsAbort.abort(); } catch (ePrev) {}
            }
            reqsAbort = typeof AbortController === 'function' ? new AbortController() : null;
            loading = true;
            renderBody();
            apiFetch(
                '/StreamFlix/Seerr/Requests?profileId=' + encodeURIComponent(activeProfId),
                reqsAbort ? { signal: reqsAbort.signal } : {}
            )
                .then(function (res) {
                    reqsAbort = null;
                    loading = false;
                    requests = (res && Array.isArray(res.requests)) ? res.requests : [];
                    renderBody();
                })
                .catch(function (err) {
                    if (err && err.name === 'AbortError') {
                        return;
                    }
                    reqsAbort = null;
                    loading = false;
                    if (!m.isClosed()) {
                        var bodyEl = m.modal.querySelector('#bfx-seerr-reqs-body');
                        if (bodyEl) {
                            bodyEl.innerHTML = '<div class="streamflix-auth-alert streamflix-auth-alert-error">' + escapeHtml((err && err.message) || 'Could not load requests from Seerr.') + '</div>';
                        }
                    }
                });
        }

        function renderBody() {
            if (m.isClosed()) {
                return;
            }
            var bodyEl = m.modal.querySelector('#bfx-seerr-reqs-body');
            if (!bodyEl) {
                return;
            }
            if (loading) {
                bodyEl.innerHTML = '<div class="bfx-modal-loading"><div class="streamflix-spinner-ring"></div><span>Loading recent requests from Seerr…</span></div>';
                return;
            }

            var inProgressList = requests.filter(function (r) {
                var k = String((r && r.statusKey) || '').toLowerCase();
                return k === 'pending' || k === 'approved' || k === 'processing' || k === 'downloading';
            });
            var availableList = requests.filter(function (r) {
                var k = String((r && r.statusKey) || '').toLowerCase();
                return k === 'available' || k === 'partial';
            });
            var visible = filterKey === 'active'
                ? inProgressList
                : (filterKey === 'available' ? availableList : requests);

            var listHtml = '';
            if (!requests.length) {
                listHtml = '<div class="bfx-gp-empty">No media requests yet. Search for any movie or show in StreamFlix Search to request it!</div>';
            } else if (!visible.length) {
                listHtml = '<div class="bfx-gp-empty">No requests match this filter right now.</div>';
            } else {
                listHtml = visible.map(function (r, vIdx) {
                    var b = badgeMeta(r);
                    var posterUrl = (typeof r.posterUrl === 'string' && /^https:\/\//i.test(r.posterUrl.trim())) ? r.posterUrl.trim() : '';
                    var isTvReq = String(r.mediaType || '').toLowerCase() === 'tv';
                    var seasonsArr = Array.isArray(r.seasons) ? r.seasons.filter(function (n) { return Number(n) > 0; }) : [];
                    var seasonsText = (isTvReq && seasonsArr.length)
                        ? ('Seasons: ' + seasonsArr.map(function (n) { return 'S' + n; }).join(', '))
                        : '';
                    var relAdded = formatRelativePast(r.createdAt);
                    var dlPct = (typeof r.downloadProgress === 'number' && !isNaN(r.downloadProgress))
                        ? Math.max(0, Math.min(100, Math.round(r.downloadProgress)))
                        : null;
                    var jfId = resolveLocalLibraryId(r);
                    var isPendingCancelable = Number(r.requestId) > 0
                        && String(r.statusKey || '').toLowerCase() === 'pending'
                        && r.canCancel !== false;

                    return ''
                        + '<div class="bfx-req-row">'
                        + '  <div class="bfx-req-poster">'
                        + icon('film')
                        + (posterUrl ? '<img loading="lazy" src="' + escapeHtml(posterUrl) + '" referrerpolicy="no-referrer" alt="" data-bfx-img="fade" />' : '')
                        + '  </div>'
                        + '  <div class="bfx-req-main">'
                        + '    <div class="bfx-req-top">'
                        + '      <span class="bfx-req-title">' + escapeHtml(r.title || 'Requested Title') + '</span>'
                        + '      <span class="bfx-seerr-type">' + (isTvReq ? 'SERIES' : 'MOVIE') + '</span>'
                        + '      <span class="bfx-seerr-badge ' + b.cls + '">' + icon(b.ico) + '<span>' + escapeHtml(b.label) + '</span></span>'
                        + '    </div>'
                        + '    <div class="bfx-req-sub">'
                        + (r.year ? '<span>' + escapeHtml(String(r.year)) + '</span>' : '')
                        + (r.year && (seasonsText || relAdded) ? '<span>•</span>' : '')
                        + (seasonsText ? '<span>' + escapeHtml(seasonsText) + '</span>' : '')
                        + (seasonsText && relAdded ? '<span>•</span>' : '')
                        + (relAdded ? '<span>Requested ' + escapeHtml(relAdded) + '</span>' : '')
                        + '    </div>'
                        + ((dlPct !== null || b.cls === 'is-downloading')
                            ? '<div class="bfx-req-dl-wrap"><div class="bfx-seerr-dl-bar"><div class="bfx-seerr-dl-fill" style="width:' + (dlPct !== null ? dlPct : 12) + '%;"></div></div></div>'
                            : '')
                        + '  </div>'
                        + '  <div class="bfx-req-actions">'
                        + (isPendingCancelable
                            ? '    <button type="button" class="streamflix-ghost-btn bfx-btn-xs bfx-seerr-cancel-btn" data-req-cancel="' + vIdx + '"' + (cancellingId === Number(r.requestId) ? ' disabled' : '') + '>' + (cancellingId === Number(r.requestId) ? '…' : 'Cancel') + '</button>'
                            : '')
                        + (jfId && (!isTvReq || Number(r.mediaStatus) === 5)
                            ? '    <button type="button" class="streamflix-btn-primary bfx-btn-xs" data-req-open-jf="' + escapeHtml(jfId) + '">' + iconLabel('play', 'Open') + '</button>'
                            : (r.tmdbId > 0
                                ? '    <button type="button" class="streamflix-ghost-btn bfx-btn-xs" data-req-inspect="' + vIdx + '">' + (isTvReq ? 'Seasons' : 'Details') + '</button>'
                                : ''))
                        + '  </div>'
                        + '</div>';
                }).join('');
            }

            bodyEl.innerHTML = ''
                + '<div class="bfx-req-toolbar">'
                + '  <div class="bfx-req-filters">'
                + '    <button type="button" class="bfx-req-filter-pill' + (filterKey === 'all' ? ' is-active' : '') + '" data-req-filter="all">All (' + requests.length + ')</button>'
                + '    <button type="button" class="bfx-req-filter-pill' + (filterKey === 'active' ? ' is-active' : '') + '" data-req-filter="active">In Progress (' + inProgressList.length + ')</button>'
                + '    <button type="button" class="bfx-req-filter-pill' + (filterKey === 'available' ? ' is-active' : '') + '" data-req-filter="available">Available (' + availableList.length + ')</button>'
                + '  </div>'
                + '  <button type="button" class="streamflix-ghost-btn bfx-btn-xs" id="bfx-req-refresh-btn">' + iconLabel('refresh', 'Refresh') + '</button>'
                + '</div>'
                + '<div class="bfx-req-list">' + listHtml + '</div>';

            hydrateCompleteImages(bodyEl);

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-req-filter]'), function (pill) {
                pill.addEventListener('click', function () {
                    filterKey = pill.getAttribute('data-req-filter') || 'all';
                    renderBody();
                });
            });

            var refreshBtn = bodyEl.querySelector('#bfx-req-refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', fetchRequests);
            }

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-req-open-jf]'), function (btn) {
                btn.addEventListener('click', function () {
                    var jfId = btn.getAttribute('data-req-open-jf');
                    if (jfId) {
                        m.close(true);
                        openHeroDetailModalById(jfId);
                    }
                });
            });

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-req-cancel]'), function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.getAttribute('data-req-cancel'), 10);
                    var r = visible[idx];
                    if (!r || !r.requestId || cancellingId) {
                        return;
                    }
                    cancellingId = Number(r.requestId);
                    renderBody();
                    apiFetch('/StreamFlix/Seerr/Cancel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: Number(r.requestId),
                            profileId: activeProfId
                        })
                    }).then(function () {
                        cancellingId = 0;
                        requests = requests.filter(function (x) { return Number(x.requestId) !== Number(r.requestId); });
                        applySeerrStatusUpdate(r.tmdbId, String(r.mediaType || '').toLowerCase() === 'tv', 1, 'Not Requested');
                        showToast('Cancelled request for "' + (r.title || 'Title') + '".', 'info');
                        renderBody();
                    }).catch(function (err) {
                        cancellingId = 0;
                        showToast((err && err.message) || 'Could not cancel request.', 'error');
                        renderBody();
                    });
                });
            });

            Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-req-inspect]'), function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.getAttribute('data-req-inspect'), 10);
                    var r = visible[idx];
                    if (r && r.tmdbId) {
                        m.close(false);
                        openSeerrRequestModal({
                            tmdbId: r.tmdbId,
                            mediaType: r.mediaType,
                            title: r.title,
                            year: r.year,
                            posterUrl: r.posterUrl,
                            backdropUrl: r.backdropUrl,
                            mediaStatus: r.mediaStatus,
                            statusLabel: r.statusLabel,
                            downloadProgress: r.downloadProgress,
                            activeRequestId: r.requestId,
                            canCancel: r.canCancel !== false && String(r.statusKey || '').toLowerCase() === 'pending',
                            jellyfinMediaId: r.jellyfinMediaId
                        });
                    }
                });
            });
        }

        fetchRequests();
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
