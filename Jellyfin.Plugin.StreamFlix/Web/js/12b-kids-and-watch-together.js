/* StreamFlix Client (12b) — Dedicated Kids Profile Mode & Parental Exit Lock */
    /* ======================================================================
       PART A. DEDICATED KIDS PROFILE MODE & PARENTAL EXIT LOCK
       ====================================================================== */
    var KIDS_UNLOCK_SESSION_KEY = 'streamflix_kids_exit_ok_v1';
    var KIDS_UNLOCK_TTL_MS = 90 * 1000;
    var lastKidsGuardToastAt = 0;

    var GROWNUP_WORDS = [
        { digit: '1', word: 'One' },
        { digit: '2', word: 'Two' },
        { digit: '3', word: 'Three' },
        { digit: '4', word: 'Four' },
        { digit: '5', word: 'Five' },
        { digit: '6', word: 'Six' },
        { digit: '7', word: 'Seven' },
        { digit: '8', word: 'Eight' },
        { digit: '9', word: 'Nine' }
    ];

    var KIDS_WORLDS = [
        { id: 'all', emoji: '🌟', label: 'All Kids' },
        { id: 'animation', emoji: '🎨', label: 'Animation' },
        { id: 'family', emoji: '🧸', label: 'Family' },
        { id: 'adventure', emoji: '🚀', label: 'Adventure' },
        { id: 'comedy', emoji: '😂', label: 'Silly & Funny' },
        { id: 'fantasy', emoji: '🦄', label: 'Magic & Fantasy' },
        { id: 'short', emoji: '⚡', label: 'Quick Watch' }
    ];

    function isKidsProfileActive() {
        return Boolean(state.activeProfile && state.activeProfile.isKids);
    }

    function isKidsExitLockRequired() {
        if (!isKidsProfileActive()) {
            return false;
        }
        return state.activeProfile.kidsExitPinRequired !== false;
    }

    function clearKidsExitSession() {
        try {
            sessionStorage.removeItem(KIDS_UNLOCK_SESSION_KEY);
        } catch (e) {}
    }

    function getValidKidsExitSession() {
        try {
            var raw = sessionStorage.getItem(KIDS_UNLOCK_SESSION_KEY);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            var curId = state.activeProfile && state.activeProfile.id;
            if (!curId || parsed.profileId !== curId) {
                sessionStorage.removeItem(KIDS_UNLOCK_SESSION_KEY);
                return null;
            }
            if (!parsed.ts || (Date.now() - Number(parsed.ts)) > KIDS_UNLOCK_TTL_MS) {
                sessionStorage.removeItem(KIDS_UNLOCK_SESSION_KEY);
                return null;
            }
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function saveKidsExitSession(adultPin) {
        if (!state.activeProfile || !state.activeProfile.id) {
            return;
        }
        try {
            sessionStorage.setItem(KIDS_UNLOCK_SESSION_KEY, JSON.stringify({
                profileId: state.activeProfile.id,
                adultPin: String(adultPin || ''),
                ts: Date.now()
            }));
        } catch (e) {}
    }

    function isBlockedRouteInKidsMode(hashStr) {
        var h = String(hashStr || '').toLowerCase();
        if (!h) {
            return false;
        }
        return h.indexOf('#/dashboard') === 0
            || h.indexOf('#!/dashboard') === 0
            || h.indexOf('#/configurationpage') === 0
            || h.indexOf('#!/configurationpage') === 0
            || h.indexOf('#/mypreferences') === 0
            || h.indexOf('#!/mypreferences') === 0
            || h.indexOf('#/userprofile') === 0
            || h.indexOf('#!/userprofile') === 0
            || h.indexOf('#/quickconnect') === 0
            || h.indexOf('#!/quickconnect') === 0
            || h.indexOf('#/livetv') === 0
            || h.indexOf('#!/livetv') === 0;
    }

    function enforceKidsRouteGuard() {
        if (!isKidsProfileActive() || isGateOpen()) {
            return false;
        }
        if (!isBlockedRouteInKidsMode(window.location.hash)) {
            return false;
        }
        window.location.hash = '#/home';
        var now = Date.now();
        if (now - lastKidsGuardToastAt > 2500) {
            lastKidsGuardToastAt = now;
            showToast('Settings are locked while in Kids mode.', 'info');
        }
        return true;
    }

    function filterItemsForKidsMode(items) {
        if (!Array.isArray(items) || !isKidsProfileActive()) {
            return items || [];
        }
        var adultRatingRe = /^(R|NC-17|TV-MA|18\+|18|16\+|MA\s*15\+|R18\+|FSK[\s-]*18|BBFC[\s-]*18|X|XXX|ADULT)$/i;
        return items.filter(function (it) {
            if (!it) {
                return false;
            }
            var rating = String(it.OfficialRating || '').trim();
            if (rating && adultRatingRe.test(rating)) {
                return false;
            }
            if (Array.isArray(it.Genres)) {
                for (var i = 0; i < it.Genres.length; i++) {
                    var g = String(it.Genres[i] || '').trim().toLowerCase();
                    if (g === 'horror' || g === 'erotica' || g === 'adult') {
                        return false;
                    }
                }
            }
            return true;
        });
    }

    function itemMatchesKidsWorld(item, worldId) {
        if (!item) {
            return false;
        }
        if (!worldId || worldId === 'all') {
            return true;
        }
        var genres = Array.isArray(item.Genres) ? item.Genres.map(function (g) { return String(g || '').toLowerCase(); }) : [];
        var hasGenre = function (terms) {
            for (var i = 0; i < genres.length; i++) {
                for (var j = 0; j < terms.length; j++) {
                    if (genres[i].indexOf(terms[j]) !== -1) {
                        return true;
                    }
                }
            }
            return false;
        };
        if (worldId === 'animation') {
            return hasGenre(['animation', 'anime', 'cartoon']);
        }
        if (worldId === 'family') {
            return hasGenre(['family', 'kids', 'children']);
        }
        if (worldId === 'adventure') {
            return hasGenre(['adventure', 'action', 'sci-fi']);
        }
        if (worldId === 'comedy') {
            return hasGenre(['comedy', 'funny']);
        }
        if (worldId === 'fantasy') {
            return hasGenre(['fantasy', 'magic', 'fairy']);
        }
        if (worldId === 'short') {
            var ticks = Number(item.RunTimeTicks || 0);
            if (ticks > 0 && ticks <= 35 * 60 * 10000000) {
                return true;
            }
            return item.Type === 'Episode';
        }
        return true;
    }

    function filterItemsByKidsWorld(items, worldId) {
        if (!Array.isArray(items)) {
            return [];
        }
        if (!worldId || worldId === 'all') {
            return items;
        }
        return items.filter(function (it) {
            return itemMatchesKidsWorld(it, worldId);
        });
    }

    function getKidsWorldMeta(worldId) {
        for (var i = 0; i < KIDS_WORLDS.length; i++) {
            if (KIDS_WORLDS[i].id === worldId) {
                return KIDS_WORLDS[i];
            }
        }
        return KIDS_WORLDS[0];
    }

    function buildKidsWorldStripHtml(poolItems) {
        if (!isKidsProfileActive()) {
            return '';
        }
        var pool = Array.isArray(poolItems) ? poolItems : [];
        if (pool.length < 2) {
            return '';
        }
        var activeWorld = state.kidsWorld || 'all';
        var available = KIDS_WORLDS.filter(function (w) {
            if (w.id === 'all') {
                return true;
            }
            return pool.some(function (it) { return itemMatchesKidsWorld(it, w.id); });
        });
        if (available.length <= 1) {
            return '';
        }
        if (!available.some(function (w) { return w.id === activeWorld; })) {
            activeWorld = 'all';
            state.kidsWorld = 'all';
        }
        return ''
            + '<div class="bfx-kids-worlds" role="tablist" aria-label="Kids Worlds">'
            + available.map(function (w) {
                var isAct = w.id === activeWorld;
                return '<button type="button" role="tab" aria-selected="' + (isAct ? 'true' : 'false') + '" class="bfx-kids-world-chip' + (isAct ? ' is-active' : '') + '" data-kids-world="' + escapeHtml(w.id) + '">'
                    + '<span class="bfx-kids-world-emoji" aria-hidden="true">' + w.emoji + '</span>'
                    + '<span class="bfx-kids-world-label">' + escapeHtml(w.label) + '</span>'
                    + '</button>';
            }).join('')
            + '</div>';
    }

    function bindKidsWorldStrip(scopeEl) {
        if (!scopeEl) {
            return;
        }
        Array.prototype.forEach.call(scopeEl.querySelectorAll('[data-kids-world]'), function (chip) {
            if (chip.__bfxKidsBound) {
                return;
            }
            chip.__bfxKidsBound = true;
            chip.addEventListener('click', function () {
                var nextWorld = chip.getAttribute('data-kids-world') || 'all';
                if (state.kidsWorld === nextWorld && nextWorld !== 'all') {
                    nextWorld = 'all';
                }
                state.kidsWorld = nextWorld;
                renderCinemaHubContents();
            });
        });
    }

    function syncKidsModeChrome() {
        if (!document.body) {
            return;
        }
        var kidsActive = isKidsProfileActive();
        document.body.classList.toggle('bfx-kids-mode', kidsActive);

        var overlayOpen = isGateOpen();
        var inVideo = isVideoPlayerActive();
        var onAdmin = isAdminConfigRoute();

        // 1. Top-left KIDS pill next to the brand wordmark
        var showBrandPill = kidsActive && !overlayOpen && !inVideo && !onAdmin;
        var existingPill = document.getElementById('bfx-kids-brand-pill');
        if (!showBrandPill) {
            if (existingPill && existingPill.parentNode) {
                existingPill.parentNode.removeChild(existingPill);
            }
        } else {
            var fbBrand = document.getElementById('bfx-fixed-corner-brand');
            var nativeBrand = document.querySelector('[data-streamflix-corner-brand="true"]');
            var anchor = null;
            var useFixedCoords = false;

            if (fbBrand && fbBrand.offsetParent !== null) {
                anchor = fbBrand;
                useFixedCoords = true;
            } else if (nativeBrand && nativeBrand.offsetParent !== null && nativeBrand.getBoundingClientRect().width > 8) {
                anchor = nativeBrand;
                useFixedCoords = false;
            }

            if (!anchor) {
                if (existingPill && existingPill.parentNode) {
                    existingPill.parentNode.removeChild(existingPill);
                }
            } else {
                if (!existingPill) {
                    existingPill = document.createElement('span');
                    existingPill.id = 'bfx-kids-brand-pill';
                    existingPill.className = 'bfx-kids-brand-pill';
                    existingPill.textContent = 'KIDS';
                    existingPill.setAttribute('aria-label', 'Kids Mode');
                }
                if (useFixedCoords) {
                    existingPill.classList.add('is-fixed');
                    existingPill.classList.remove('is-inline');
                    if (existingPill.parentNode !== document.body) {
                        document.body.appendChild(existingPill);
                    }
                    var rect = anchor.getBoundingClientRect();
                    existingPill.style.left = Math.round(rect.right + 8) + 'px';
                    existingPill.style.top = Math.round(rect.top + Math.max(0, (rect.height - 20) / 2)) + 'px';
                } else {
                    existingPill.classList.add('is-inline');
                    existingPill.classList.remove('is-fixed');
                    existingPill.style.removeProperty('left');
                    existingPill.style.removeProperty('top');
                    if (anchor.nextSibling !== existingPill) {
                        anchor.insertAdjacentElement('afterend', existingPill);
                    }
                }
            }
        }

        // 2. Top-right Exit Kids button on desktop / tablet / Smart TV (phones use the Kids sheet via mobile dock)
        var isGuest = isGuestPassSession();
        var showExitBtn = kidsActive && !isGuest && !overlayOpen && !inVideo && !onAdmin && !isMobileDockViewportActive();
        var exitBtn = document.getElementById('bfx-exit-kids-btn');
        if (!showExitBtn) {
            if (exitBtn && exitBtn.parentNode) {
                exitBtn.parentNode.removeChild(exitBtn);
            }
            return;
        }

        if (!exitBtn) {
            exitBtn = document.createElement('button');
            exitBtn.type = 'button';
            exitBtn.id = 'bfx-exit-kids-btn';
            exitBtn.className = 'bfx-exit-kids-btn';
            exitBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                exitKidsModeToPicker();
            });
            document.body.appendChild(exitBtn);
        }

        var lockNeeded = isKidsExitLockRequired() && !getValidKidsExitSession();
        var wantedSig = lockNeeded ? 'locked' : 'unlocked';
        if (exitBtn.getAttribute('data-sig') !== wantedSig) {
            exitBtn.setAttribute('data-sig', wantedSig);
            exitBtn.title = lockNeeded ? 'Exit Kids mode (parental check)' : 'Exit Kids mode';
            exitBtn.innerHTML = (lockNeeded ? icon('lock') : icon('logout')) + '<span>Exit Kids</span>';
        }

        var profBtn = document.getElementById('streamflix-header-profile-btn');
        if (profBtn && profBtn.offsetParent !== null) {
            var pRect = profBtn.getBoundingClientRect();
            if (pRect.width > 0) {
                exitBtn.style.right = Math.max(84, Math.round(window.innerWidth - pRect.left + 10)) + 'px';
            }
        } else {
            exitBtn.style.right = '148px';
        }
    }

    function openAdultPinExitModal(initialError) {
        return new Promise(function (resolve) {
            var settled = false;
            var finish = function (val) {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(val);
            };

            var m = openModal(''
                + '<div class="bfx-kids-lock-head">'
                + '  <div class="bfx-kids-lock-badge">' + icon('lock') + '</div>'
                + '  <h2 class="streamflix-modal-title" style="margin:0;">Exit Kids Mode</h2>'
                + '  <p class="streamflix-modal-sub" style="margin:6px 0 0;">Enter any adult profile PIN to leave Kids mode.</p>'
                + '</div>'
                + '<div class="bfx-kids-pin-field">'
                + '  <input type="password" id="bfx-adult-exit-pin-input" class="streamflix-input bfx-adult-pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="one-time-code" placeholder="Enter 4–8 digit PIN" />'
                + '</div>'
                + '<div id="bfx-adult-exit-err" class="streamflix-pin-error" aria-live="assertive">' + escapeHtml(initialError || '') + '</div>'
                + '<div class="streamflix-modal-actions" style="justify-content:space-between;margin-top:16px;">'
                + '  <button type="button" class="streamflix-ghost-btn" id="bfx-adult-exit-cancel">Stay in Kids</button>'
                + '  <button type="button" class="streamflix-btn-primary" id="bfx-adult-exit-submit">' + iconLabel('lock', 'Unlock') + '</button>'
                + '</div>', {
                className: 'streamflix-modal-pin bfx-kids-exit-modal',
                onClose: function () {
                    finish({ verified: false, adultPin: '' });
                }
            });

            var modal = m.modal;
            var input = modal.querySelector('#bfx-adult-exit-pin-input');
            var errEl = modal.querySelector('#bfx-adult-exit-err');
            var submitBtn = modal.querySelector('#bfx-adult-exit-submit');
            var cancelBtn = modal.querySelector('#bfx-adult-exit-cancel');
            var busy = false;

            input.addEventListener('input', function () {
                input.value = input.value.replace(/\D/g, '').slice(0, 8);
                if (errEl && errEl.textContent) {
                    errEl.textContent = '';
                }
            });

            var doVerify = function () {
                if (busy) {
                    return;
                }
                var pinVal = (input.value || '').trim();
                if (!/^\d{4,8}$/.test(pinVal)) {
                    errEl.textContent = 'Enter a 4 to 8 digit adult PIN.';
                    input.focus();
                    return;
                }
                busy = true;
                submitBtn.disabled = true;
                submitBtn.classList.add('streamflix-btn-loading');
                apiFetch('/StreamFlix/Profiles/VerifyAdultPin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin: pinVal })
                }).then(function () {
                    saveKidsExitSession(pinVal);
                    settled = true;
                    m.close();
                    syncKidsModeChrome();
                    resolve({ verified: true, adultPin: pinVal });
                }).catch(function (err) {
                    busy = false;
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('streamflix-btn-loading');
                    errEl.textContent = (err && err.message) || 'Incorrect PIN.';
                    modal.classList.remove('shake');
                    void modal.offsetWidth;
                    modal.classList.add('shake');
                    input.value = '';
                    try { input.focus(); } catch (e) {}
                });
            };

            submitBtn.addEventListener('click', doVerify);
            cancelBtn.addEventListener('click', function () {
                m.close();
            });
            input.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    doVerify();
                }
            });
            setTimeout(function () {
                try { input.focus(); } catch (e) {}
            }, 40);
        });
    }

    function openGrownUpChallengeModal() {
        return new Promise(function (resolve) {
            var settled = false;
            var finish = function (val) {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(val);
            };

            var challenge = [];
            for (var i = 0; i < 4; i++) {
                challenge.push(GROWNUP_WORDS[Math.floor(Math.random() * GROWNUP_WORDS.length)]);
            }
            var expectedCode = challenge.map(function (c) { return c.digit; }).join('');
            var wordsHtml = challenge.map(function (c) {
                return '<span class="bfx-grownup-word">' + escapeHtml(c.word) + '</span>';
            }).join('<span class="bfx-grownup-dot" aria-hidden="true">·</span>');

            var boxesHtml = '';
            for (var b = 0; b < 4; b++) {
                boxesHtml += '<input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="streamflix-pin-box" data-idx="' + b + '" autocomplete="off" aria-label="Digit ' + (b + 1) + '" />';
            }

            var m = openModal(''
                + '<div class="bfx-kids-lock-head">'
                + '  <div class="bfx-kids-lock-badge is-grownup">' + icon('shield') + '</div>'
                + '  <h2 class="streamflix-modal-title" style="margin:0;">Grown-Up Check</h2>'
                + '  <p class="streamflix-modal-sub" style="margin:6px 0 0;">Enter these four numbers as digits to exit Kids mode:</p>'
                + '</div>'
                + '<div class="bfx-grownup-words" aria-label="Challenge words">' + wordsHtml + '</div>'
                + '<div class="streamflix-pin-boxes" id="bfx-grownup-boxes">' + boxesHtml + '</div>'
                + '<div id="bfx-grownup-err" class="streamflix-pin-error" aria-live="assertive"></div>'
                + '<div class="streamflix-modal-actions" style="justify-content:center;margin-top:12px;">'
                + '  <button type="button" class="streamflix-ghost-btn" id="bfx-grownup-cancel">Stay in Kids</button>'
                + '</div>', {
                className: 'streamflix-modal-pin bfx-kids-exit-modal',
                onClose: function () {
                    finish({ verified: false, adultPin: '' });
                }
            });

            var modal = m.modal;
            var boxes = Array.prototype.slice.call(modal.querySelectorAll('.streamflix-pin-box'));
            var errEl = modal.querySelector('#bfx-grownup-err');

            var checkCode = function () {
                var code = boxes.map(function (bx) { return bx.value; }).join('');
                if (code.length < 4) {
                    return;
                }
                if (code === expectedCode) {
                    saveKidsExitSession('');
                    settled = true;
                    m.close();
                    syncKidsModeChrome();
                    resolve({ verified: true, adultPin: '' });
                    return;
                }
                errEl.textContent = 'Those digits didn\'t match. Try again.';
                modal.classList.remove('shake');
                void modal.offsetWidth;
                modal.classList.add('shake');
                boxes.forEach(function (bx) { bx.value = ''; });
                try { boxes[0].focus(); } catch (e) {}
            };

            boxes.forEach(function (box, idx) {
                box.addEventListener('input', function () {
                    var v = box.value.replace(/\D/g, '');
                    box.value = v ? v.slice(-1) : '';
                    if (errEl && errEl.textContent) {
                        errEl.textContent = '';
                    }
                    if (box.value && idx < boxes.length - 1) {
                        boxes[idx + 1].focus();
                    }
                    if (boxes.every(function (bx) { return bx.value.length === 1; })) {
                        checkCode();
                    }
                });
                box.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Backspace' && !box.value && idx > 0) {
                        boxes[idx - 1].value = '';
                        boxes[idx - 1].focus();
                    } else if (ev.key === 'Enter') {
                        checkCode();
                    }
                });
            });

            modal.querySelector('#bfx-grownup-cancel').addEventListener('click', function () {
                m.close();
            });
            setTimeout(function () {
                try { boxes[0].focus(); } catch (e) {}
            }, 40);
        });
    }

    function requestExitKidsVerification(targetProfile, initialError) {
        if (!isKidsExitLockRequired()) {
            return Promise.resolve({ verified: true, adultPin: '' });
        }
        if (!initialError) {
            var cached = getValidKidsExitSession();
            if (cached) {
                return Promise.resolve({ verified: true, adultPin: cached.adultPin || '' });
            }
        }
        var hasAdultPin = Boolean(state.config && state.config.hasAnyAdultPin);
        if (hasAdultPin) {
            return openAdultPinExitModal(initialError || '');
        }
        return openGrownUpChallengeModal();
    }

    function exitKidsModeToPicker() {
        closeAccountDropdown();
        return requestExitKidsVerification(null).then(function (res) {
            if (!res || !res.verified) {
                return;
            }
            state.manageMode = false;
            renderProfilePickerGate();
        });
    }

    /* ======================================================================
       PART B. BEDTIME WINDOW LOCK & ADULT TONIGHT OVERRIDE
       ====================================================================== */
    function parseTimeMinutes(hhmm) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
        if (!m) {
            return -1;
        }
        var hh = parseInt(m[1], 10);
        var mm = parseInt(m[2], 10);
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
            return -1;
        }
        return hh * 60 + mm;
    }

    function isTimeInBedtimeWindow(startStr, endStr, nowMinutes) {
        var s = parseTimeMinutes(startStr);
        var e = parseTimeMinutes(endStr);
        if (s < 0 || e < 0 || s === e) {
            return false;
        }
        var cur = typeof nowMinutes === 'number'
            ? nowMinutes
            : (function () {
                var d = new Date();
                return d.getHours() * 60 + d.getMinutes();
            })();
        if (s < e) {
            return cur >= s && cur < e;
        }
        return cur >= s || cur < e;
    }

    function hasActiveBedtimeOverrideTonight(profileId) {
        if (!profileId) {
            return false;
        }
        var saved = loadJson(BEDTIME_UNLOCK_PREFIX + profileId, null);
        if (!saved || !saved.expiresAt) {
            return false;
        }
        if (Number(saved.expiresAt) > Date.now()) {
            return true;
        }
        saveJson(BEDTIME_UNLOCK_PREFIX + profileId, null);
        return false;
    }

    function grantBedtimeOverrideTonight(profileId) {
        if (!profileId) {
            return;
        }
        // Grant 10 hours of unlocked time (covers the rest of tonight's bedtime window)
        saveJson(BEDTIME_UNLOCK_PREFIX + profileId, {
            expiresAt: Date.now() + 10 * 3600 * 1000
        });
    }

    function isProfileCurrentlyInBedtime(profile) {
        var p = profile || state.activeProfile;
        if (!p || !p.id || !p.isKids || p.isAdmin || !p.bedtimeStart || !p.bedtimeEnd) {
            return false;
        }
        if (hasActiveBedtimeOverrideTonight(p.id)) {
            return false;
        }
        return isTimeInBedtimeWindow(p.bedtimeStart, p.bedtimeEnd);
    }

    function removeBedtimeLockOverlay() {
        var el = document.getElementById('bfx-bedtime-lock-overlay');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
        if (document.body) {
            document.body.classList.remove('bfx-bedtime-locked');
        }
    }

    function enforceBedtimeLockOverlay() {
        var active = state.activeProfile;
        if (!isProfileCurrentlyInBedtime(active)) {
            removeBedtimeLockOverlay();
            return false;
        }

        // Pause any playing HTML5 video element immediately when bedtime triggers
        try {
            var vids = document.querySelectorAll('video');
            Array.prototype.forEach.call(vids, function (v) {
                if (v && !v.paused) {
                    v.pause();
                }
            });
        } catch (ePause) {}

        if (document.body) {
            document.body.classList.add('bfx-bedtime-locked');
        }

        var existing = document.getElementById('bfx-bedtime-lock-overlay');
        if (existing) {
            return true;
        }

        var overlay = document.createElement('div');
        overlay.id = 'bfx-bedtime-lock-overlay';
        overlay.className = 'bfx-bedtime-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Time for Bed');
        overlay.innerHTML = ''
            + '<div class="bfx-bedtime-card">'
            + '  <div class="bfx-bedtime-moon">' + icon('moon') + '</div>'
            + '  <h2>Time for Bed, ' + escapeHtml(active.name || 'Friend') + '!</h2>'
            + '  <p>' + escapeHtml(getBrandName()) + ' is resting from <strong>' + escapeHtml(active.bedtimeStart) + '</strong> to <strong>' + escapeHtml(active.bedtimeEnd) + '</strong> so everyone gets great sleep.</p>'
            + '  <div class="bfx-bedtime-actions">'
            + (isGuestPassSession()
                ? ''
                : '    <button type="button" class="streamflix-btn-primary" id="bfx-bedtime-switch-btn">' + icon('users') + '<span>Switch Profile</span></button>'
                    + '    <button type="button" class="streamflix-ghost-btn" id="bfx-bedtime-unlock-btn">' + icon('lock') + '<span>Adult Unlock Tonight</span></button>')
            + '  </div>'
            + '</div>';
        document.body.appendChild(overlay);

        var switchBtn = overlay.querySelector('#bfx-bedtime-switch-btn');
        if (switchBtn) {
            switchBtn.addEventListener('click', function () {
                if (isKidsExitLockRequired()) {
                    exitKidsModeToPicker();
                } else {
                    removeBedtimeLockOverlay();
                    window.__STREAMFLIX_OPEN_PROFILE_PICKER__(false);
                }
            });
        }
        var unlockBtn = overlay.querySelector('#bfx-bedtime-unlock-btn');
        if (unlockBtn) {
            unlockBtn.addEventListener('click', function () {
                var verifyPromise = (state.config && state.config.hasAnyAdultPin)
                    ? openAdultPinExitModal('')
                    : openGrownUpChallengeModal();
                verifyPromise.then(function (res) {
                    if (res && res.verified && state.activeProfile) {
                        grantBedtimeOverrideTonight(state.activeProfile.id);
                        removeBedtimeLockOverlay();
                        showToast('Bedtime unlocked for tonight.', 'success');
                        scheduleLifecycleTick(0);
                    }
                });
            });
        }
        return true;
    }
