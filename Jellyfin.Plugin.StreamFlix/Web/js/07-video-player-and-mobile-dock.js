/* StreamFlix Client (07/14) — Netflix Video Player OSD, Header Widgets & Mobile Floating Dock */
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
        lastSwitchedEpisodeId: '',
        episodesCache: {},
        episodesOpen: false,
        tracksOpen: false,
        selectedSeason: null,
        nextEpisode: null,
        nextMovieRec: null,
        nextEpisodeForId: '',
        upNextVisible: false,
        upNextDismissedForId: '',
        upNextCountdown: 0,
        upNextTotal: 10,
        upNextTimer: null,
        segments: [],
        segmentsForId: '',
        segmentsCache: {},
        activeSkipKey: '',
        dismissedSegmentKeys: {}
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
        if (!auth.userId || !deviceId) {
            return;
        }
        osdState.infoFor = key;
        osdState.fetching = true;
        var uid = encodeURIComponent(auth.userId);
        var fields = 'Overview,Genres,MediaSources,MediaStreams,ParentId,Chapters';
        apiFetch('/Sessions?deviceId=' + encodeURIComponent(deviceId)).then(function (sessions) {
            var list = Array.isArray(sessions) ? sessions : [];
            var np = null;
            var wantedEpId = osdState.lastSwitchedEpisodeId ? normalizeGuid(osdState.lastSwitchedEpisodeId) : '';
            if (wantedEpId) {
                for (var w = 0; w < list.length; w++) {
                    if (list[w] && list[w].NowPlayingItem && normalizeGuid(list[w].NowPlayingItem.Id) === wantedEpId) {
                        osdState.sessionId = list[w].Id || '';
                        osdState.playState = list[w].PlayState || null;
                        np = list[w].NowPlayingItem;
                        osdState.lastSwitchedEpisodeId = '';
                        break;
                    }
                }
            }
            if (!np) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i] && list[i].NowPlayingItem) {
                        osdState.sessionId = list[i].Id || '';
                        osdState.playState = list[i].PlayState || null;
                        np = list[i].NowPlayingItem;
                        break;
                    }
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
                fetchOsdSkipSegments(item);
                if (typeof onWatchPartyOsdInfoLoaded === 'function') {
                    onWatchPartyOsdInfoLoaded(item);
                }
            } else if (osdState.infoTries < 4) {
                // The server can lag a moment behind when the next episode starts — try again shortly
                osdState.infoTries++;
                osdState.infoFor = '';
            }
            paintOsdTitle();
            syncOsdExtraButtons();
            checkOsdSkipSegment();
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

    function isWebGpuWindowOpen() {
        return Boolean(document.querySelector('.webgpuSettingsWindows .webgpuWindow:not([hidden]), .webgpuFailureDialog:not(.hide), .dialog.webgpuDialog:not(.hide)'));
    }

    function isWebGpuCustomPlaybackActive(v) {
        var el = v || osdState.video;
        if (!el || !el.hasAttribute('disablepictureinpicture')) {
            return false;
        }
        return Boolean(window.WebGPUPlayer || window.WebGPUPlayerConfig || document.querySelector('#videoOsdPage .btnWebGPUPlayerSettings, .webgpuSettingsWindows'));
    }

    function syncWebGpuPipState() {
        var noPip = isWebGpuCustomPlaybackActive(osdState.video);
        document.body.classList.toggle('bfx-webgpu-no-pip', noPip);
    }

    // Netflix's "You're watching" screen after the video has been paused for a while
    function showOsdPaused() {
        osdState.pausedTimer = null;
        var v = osdState.video;
        if (!v || !v.paused || v.ended || !isVideoPlayerActive()) {
            return;
        }
        if (osdState.episodesOpen || osdState.tracksOpen || osdState.upNextVisible || isWebGpuWindowOpen() || document.querySelector('.dialogContainer .dialog.opened, .actionSheet, .upNextDialog:not(.hide)')) {
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
            ? '<h2 class="streamflix-osd-paused-title has-logo"><img src="' + escapeHtml(info.logo) + '" alt="' + escapeHtml(info.title) + '" data-bfx-logo-fallback="osd-pause" /></h2>'
            : '<h2 class="streamflix-osd-paused-title">' + escapeHtml(info.title) + '</h2>';
        el.innerHTML = ''
            + '<div class="streamflix-osd-paused-inner">'
            + '  <div class="streamflix-osd-paused-kicker">You\u2019re watching</div>'
            + titleHtml
            + (info.sub ? '<div class="streamflix-osd-paused-sub">' + escapeHtml(info.sub) + '</div>' : '')
            + (info.overview ? '<p class="streamflix-osd-paused-overview">' + escapeHtml(info.overview) + '</p>' : '')
            + '</div>'
            + '<div class="streamflix-osd-paused-badge">Paused</div>';
        hydrateCompleteImages(el);
        void el.offsetWidth;
        el.classList.add('is-on');
        document.body.classList.add('streamflix-osd-paused-on');
    }

    function onOsdActivity(ev) {
        if (ev && ev.type === 'keydown' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            var k = String(ev.key || '').toLowerCase();
            if (k === 's' && osdState.activeSkipKey && document.getElementById('streamflix-osd-skip-pill')) {
                var tg = ev.target && ev.target.tagName ? String(ev.target.tagName).toUpperCase() : '';
                if (tg !== 'INPUT' && tg !== 'TEXTAREA' && tg !== 'SELECT') {
                    var skipBtn = document.getElementById('streamflix-skip-pill-btn');
                    if (skipBtn) {
                        if (typeof onWatchPartyUserPlayerGesture === 'function') {
                            onWatchPartyUserPlayerGesture('keydown');
                        }
                        if (ev.cancelable) {
                            ev.preventDefault();
                        }
                        ev.stopPropagation();
                        skipBtn.click();
                        return;
                    }
                }
            }
        }
        if (ev && (ev.type === 'pointerdown' || ev.type === 'touchstart' || ev.type === 'keydown') && typeof onWatchPartyUserPlayerGesture === 'function') {
            onWatchPartyUserPlayerGesture(ev.type);
        }
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
        if (osdState.videoAttrObserver) {
            try { osdState.videoAttrObserver.disconnect(); } catch (eObs) {}
            osdState.videoAttrObserver = null;
        }
        osdState.video = null;
        osdState.videoHandlers = null;
        document.body.classList.remove('bfx-webgpu-no-pip');
    }

    function bindOsdVideo(v) {
        unbindOsdVideo();
        if (!v) {
            return;
        }
        osdState.video = v;
        osdState.attachedAt = Date.now();
        syncWebGpuPipState();
        if (typeof MutationObserver === 'function') {
            try {
                osdState.videoAttrObserver = new MutationObserver(function () {
                    syncWebGpuPipState();
                });
                osdState.videoAttrObserver.observe(v, { attributes: true, attributeFilter: ['disablepictureinpicture'] });
            } catch (eMo) {}
        }
        var h = {
            play: function () {
                if (osdState.pausedTimer) {
                    clearTimeout(osdState.pausedTimer);
                    osdState.pausedTimer = null;
                }
                hideOsdPaused();
                osdFlash('play');
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('play', v);
                }
            },
            playing: function () {
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('playing', v);
                }
            },
            waiting: function () {
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('waiting', v);
                }
            },
            canplay: function () {
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('canplay', v);
                }
            },
            loadedmetadata: function () {
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('loadedmetadata', v);
                }
            },
            pause: function () {
                if (!v.ended && !v.seeking) {
                    osdFlash('pause');
                }
                armOsdPaused();
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('pause', v);
                }
            },
            timeupdate: function () {
                checkOsdSkipSegment();
                checkOsdUpNext();
            },
            seeked: function () {
                checkOsdSkipSegment();
                checkOsdUpNext();
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('seeked', v);
                }
            },
            loadstart: function () {
                // New media in the same element (next episode, track switch): forget the old details
                osdState.attachedAt = Date.now();
                osdState.info = null;
                osdState.infoFor = '';
                osdState.infoTries = 0;
                osdState.nextEpisode = null;
                osdState.nextMovieRec = null;
                osdState.nextEpisodeForId = '';
                osdState.upNextDismissedForId = '';
                osdState.segments = [];
                osdState.segmentsForId = '';
                osdState.activeSkipKey = '';
                osdState.dismissedSegmentKeys = {};
                hideOsdPaused();
                hideOsdSkipPill();
                hideOsdUpNextCard();
                closeOsdOverlays();
                if (typeof onWatchPartyVideoEvent === 'function') {
                    onWatchPartyVideoEvent('loadstart', v);
                }
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
        if (typeof onWatchPartyVideoEvent === 'function') {
            onWatchPartyVideoEvent('attached', v);
        }
    }

    function enhanceVideoOsd(active) {
        if (!active) {
            teardownVideoOsd();
            return;
        }
        document.body.classList.add('streamflix-nf-player');
        document.body.classList.toggle('bfx-skip-pill-enabled', !(state.config && state.config.enableSkipIntro === false));
        if (typeof stopStreamFlixAudioMiniPlayer === 'function') {
            stopStreamFlixAudioMiniPlayer();
        }
        if (!osdState.docBound) {
            osdState.docBound = true;
            ['mousemove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (evName) {
                document.addEventListener(evName, onOsdActivity, { passive: evName !== 'keydown', capture: true });
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
        var anchor = buttons.querySelector('.btnSubtitles, .btnAudio, .btnWebGPUPlayerSettings, .btnVideoOsdSettings');
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
        if (!buttons.querySelector('.streamflix-osd-watchparty-btn')) {
            var wpBtn = document.createElement('button');
            wpBtn.type = 'button';
            wpBtn.className = 'streamflix-osd-custom-btn streamflix-osd-watchparty-btn hide';
            wpBtn.title = 'Watch Together';
            wpBtn.setAttribute('aria-label', 'Watch Together');
            wpBtn.innerHTML = icon('party');
            wpBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof openWatchTogetherModal === 'function') {
                    openWatchTogetherModal({ item: osdState.info || null });
                }
            });
            if (anchor && anchor.parentNode === buttons) {
                buttons.insertBefore(wpBtn, anchor);
            } else {
                buttons.appendChild(wpBtn);
            }
        }
        var posSlider = page.querySelector('.osdPositionSlider');
        if (posSlider && !posSlider.__bfxWpSliderBound) {
            posSlider.__bfxWpSliderBound = true;
            posSlider.addEventListener('change', function (ev) {
                if (posSlider.__bfxWpProgrammatic) {
                    return;
                }
                if (typeof onWatchPartySliderScrub === 'function') {
                    onWatchPartySliderScrub(posSlider, ev);
                }
            });
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
        syncWebGpuPipState();
        if (typeof syncWatchPartyIndicators === 'function') {
            syncWatchPartyIndicators();
        }
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
        if (!item || !item.Id) {
            osdState.nextEpisode = null;
            osdState.nextMovieRec = null;
            osdState.nextEpisodeForId = '';
            return;
        }
        var normCur = normalizeGuid(item.Id);
        if (osdState.nextEpisodeForId === normCur) {
            return;
        }
        osdState.nextEpisodeForId = normCur;
        osdState.nextEpisode = null;
        osdState.nextMovieRec = null;

        if (item.Type === 'Episode' && item.SeriesId) {
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
            return;
        }

        if (item.Type === 'Movie') {
            var auth = getJellyfinAuthContext();
            var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
            if (!uid) {
                return;
            }
            apiFetch('/Items/' + encodeURIComponent(item.Id) + '/Similar?userId=' + uid + '&Limit=8&Fields=Overview,Genres,PrimaryImageAspectRatio,ProductionYear,OfficialRating,ParentId')
                .then(function (res) {
                    if (!osdState.info || normalizeGuid(osdState.info.Id) !== normCur) {
                        return;
                    }
                    var sim = (res && Array.isArray(res.Items)) ? res.Items : [];
                    if (typeof filterItemsForKidsMode === 'function') {
                        sim = filterItemsForKidsMode(sim);
                    }
                    var allowedLibs = (state.activeProfile && Array.isArray(state.activeProfile.allowedLibraryIds) && state.activeProfile.allowedLibraryIds.length)
                        ? state.activeProfile.allowedLibraryIds.map(normalizeGuid)
                        : null;
                    if (allowedLibs) {
                        sim = sim.filter(function (cand) {
                            if (!cand || !cand.ParentId) {
                                return true;
                            }
                            var pNorm = normalizeGuid(cand.ParentId);
                            return !isKnownTopLevelViewId(cand.ParentId) || allowedLibs.indexOf(pNorm) !== -1;
                        });
                    }
                    var pick = null;
                    for (var k = 0; k < sim.length; k++) {
                        if (sim[k] && sim[k].Id && normalizeGuid(sim[k].Id) !== normCur && !(sim[k].UserData && sim[k].UserData.Played)) {
                            pick = sim[k];
                            break;
                        }
                    }
                    if (!pick && sim.length > 0 && sim[0] && normalizeGuid(sim[0].Id) !== normCur) {
                        pick = sim[0];
                    }
                    osdState.nextMovieRec = pick || null;
                    checkOsdUpNext();
                })
                .catch(function () {});
        }
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
                        + '    <img loading="lazy" src="' + escapeHtml(getItemBackdropUrl(ep, 400)) + '" alt="" data-bfx-img="fade" />'
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
                hydrateCompleteImages(listEl);

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
        var appliedViaPm = false;
        // 1. Direct Jellyfin playbackManager if exposed in global scope
        try {
            var pm = window.StreamFlixPlaybackManager || window.playbackManager;
            if (pm) {
                if (kind === 'audio' && typeof pm.setAudioStreamIndex === 'function') {
                    pm.setAudioStreamIndex(idx);
                    appliedViaPm = true;
                } else if (kind === 'subtitle' && typeof pm.setSubtitleStreamIndex === 'function') {
                    pm.setSubtitleStreamIndex(idx);
                    appliedViaPm = true;
                }
            }
        } catch (ePm) {}

        // 2. Sync browser HTML5 textTracks / audioTracks when available
        try {
            var v = osdState.video;
            if (v && kind === 'subtitle' && v.textTracks && v.textTracks.length) {
                var chosenSub = streams.filter(function (st) { return st && st.Type === 'Subtitle' && st.Index === idx; })[0];
                var wantedLabel = chosenSub ? String(chosenSub.DisplayTitle || chosenSub.Title || '').trim().toLowerCase() : '';
                var wantedLang = chosenSub ? String(chosenSub.Language || '').toLowerCase() : '';
                var matchedIdx = -1;
                if (idx !== -1 && wantedLabel) {
                    for (var tl = 0; tl < v.textTracks.length; tl++) {
                        var lbl = String(v.textTracks[tl].label || '').trim().toLowerCase();
                        if (lbl && (lbl === wantedLabel || wantedLabel.indexOf(lbl) !== -1 || lbl.indexOf(wantedLabel) !== -1)) {
                            matchedIdx = tl;
                            break;
                        }
                    }
                }
                if (idx !== -1 && matchedIdx === -1 && wantedLang) {
                    for (var tLang = 0; tLang < v.textTracks.length; tLang++) {
                        if (String(v.textTracks[tLang].language || '').toLowerCase().indexOf(wantedLang.slice(0, 2)) === 0) {
                            matchedIdx = tLang;
                            break;
                        }
                    }
                }
                for (var t = 0; t < v.textTracks.length; t++) {
                    v.textTracks[t].mode = (idx !== -1 && t === matchedIdx) ? 'showing' : 'disabled';
                }
            }
        } catch (eTt) {}

        // 3. Fallback: Jellyfin Session Command API when playbackManager was not directly invoked
        if (!appliedViaPm) {
            var sendSessionTrackCmd = function (sid) {
                if (!sid) {
                    return;
                }
                var cmdName = kind === 'audio' ? 'SetAudioStreamIndex' : 'SetSubtitleStreamIndex';
                apiFetch('/Sessions/' + encodeURIComponent(sid) + '/Command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        Name: cmdName,
                        Arguments: { Index: String(idx) }
                    })
                }).catch(function () {});
            };
            if (osdState.sessionId) {
                sendSessionTrackCmd(osdState.sessionId);
            } else {
                refreshOsdInfo(true);
                setTimeout(function () {
                    sendSessionTrackCmd(osdState.sessionId);
                }, 450);
            }
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

    function formatShortClockSec(sec) {
        var total = Math.max(0, Math.round(Number(sec) || 0));
        var mins = Math.floor(total / 60);
        var rem = total % 60;
        return mins + ':' + (rem < 10 ? '0' : '') + rem;
    }

    function normalizeSkipSegmentKind(rawType) {
        var low = String(rawType || '').trim().toLowerCase();
        if (!low) {
            return '';
        }
        if (low === 'intro' || low === 'introduction' || low === 'opening') {
            return 'intro';
        }
        if (low === 'recap' || low === 'previously') {
            return 'recap';
        }
        if (low === 'commercial' || low === 'ad' || low === 'advertisement') {
            return 'commercial';
        }
        if (low === 'preview' || low === 'nextepisodepreview') {
            return 'preview';
        }
        if (low === 'outro' || low === 'credits' || low === 'endcredits' || low === 'ending') {
            return 'outro';
        }
        return '';
    }

    function getSkipSegmentLabel(kind) {
        if (kind === 'recap') { return 'Skip Recap'; }
        if (kind === 'commercial') { return 'Skip Ad'; }
        if (kind === 'preview') { return 'Skip Preview'; }
        if (kind === 'outro') { return 'Skip Credits'; }
        return 'Skip Intro';
    }

    function parseAllSkipSegments(item, mediaSegmentsRes, introSkipperV2Res, introTimestampsV1Res) {
        var rawList = [];
        var pushSeg = function (kind, startSec, endSec) {
            var s = Number(startSec);
            var e = Number(endSec);
            if (!kind || !isFinite(s) || !isFinite(e) || s < 0 || e <= s + 2.5) {
                return;
            }
            rawList.push({
                kind: kind,
                label: getSkipSegmentLabel(kind),
                startSec: Math.round(s * 10) / 10,
                endSec: Math.round(e * 10) / 10,
                key: kind + ':' + Math.round(s) + ':' + Math.round(e)
            });
        };

        // 1. Jellyfin 10.10+ / 12.x native /MediaSegments/{itemId}
        var msItems = (mediaSegmentsRes && Array.isArray(mediaSegmentsRes.Items))
            ? mediaSegmentsRes.Items
            : (Array.isArray(mediaSegmentsRes) ? mediaSegmentsRes : []);
        msItems.forEach(function (ms) {
            if (!ms) { return; }
            var k = normalizeSkipSegmentKind(ms.Type || ms.type);
            var sTicks = ms.StartTicks != null ? Number(ms.StartTicks) : Number(ms.startTicks);
            var eTicks = ms.EndTicks != null ? Number(ms.EndTicks) : Number(ms.endTicks);
            if (k && isFinite(sTicks) && isFinite(eTicks)) {
                pushSeg(k, sTicks / 10000000, eTicks / 10000000);
            }
        });

        // 2. Intro Skipper plugin v2 (/Episode/{id}/IntroSkipperSegments)
        if (introSkipperV2Res && typeof introSkipperV2Res === 'object' && !Array.isArray(introSkipperV2Res)) {
            Object.keys(introSkipperV2Res).forEach(function (segKey) {
                var segObj = introSkipperV2Res[segKey];
                if (!segObj || typeof segObj !== 'object') { return; }
                var k = normalizeSkipSegmentKind(segObj.SegmentType || segKey);
                var st = segObj.Start != null ? segObj.Start : (segObj.IntroStart != null ? segObj.IntroStart : segObj.start);
                var en = segObj.End != null ? segObj.End : (segObj.IntroEnd != null ? segObj.IntroEnd : segObj.end);
                if (k && st != null && en != null) {
                    pushSeg(k, st, en);
                }
            });
        }

        // 3. Intro Skipper plugin v1 classic (/Episode/{id}/IntroTimestamps)
        if (introTimestampsV1Res && typeof introTimestampsV1Res === 'object') {
            var v1Valid = introTimestampsV1Res.Valid !== false && introTimestampsV1Res.valid !== false;
            var v1Start = introTimestampsV1Res.IntroStart != null ? introTimestampsV1Res.IntroStart : introTimestampsV1Res.introStart;
            var v1End = introTimestampsV1Res.IntroEnd != null ? introTimestampsV1Res.IntroEnd : introTimestampsV1Res.introEnd;
            if (v1Valid && v1Start != null && v1End != null) {
                pushSeg('intro', v1Start, v1End);
            }
        }

        // 4. Embedded Chapter markers fallback (when no MediaSegments / Intro Skipper segment covered that kind)
        var chapters = item && Array.isArray(item.Chapters) ? item.Chapters : [];
        if (chapters.length > 0) {
            var itemDurSec = (Number(item && item.RunTimeTicks) || 0) / 10000000;
            for (var cIdx = 0; cIdx < chapters.length; cIdx++) {
                var ch = chapters[cIdx];
                if (!ch || !ch.Name) { continue; }
                var chName = String(ch.Name).trim();
                var chStart = (Number(ch.StartPositionTicks) || 0) / 10000000;
                var nextCh = chapters[cIdx + 1];
                var chEnd = nextCh
                    ? ((Number(nextCh.StartPositionTicks) || 0) / 10000000)
                    : (itemDurSec > chStart ? itemDurSec : 0);
                if (chEnd <= chStart + 3) { continue; }
                var chKind = '';
                if (/^(intro|introduction|opening|op|opening\s*credits|theme|main\s*titles)$/i.test(chName) && (chEnd - chStart) <= 240) {
                    chKind = 'intro';
                } else if (/^(recap|previously(\s*on)?)$/i.test(chName) && (chEnd - chStart) <= 240) {
                    chKind = 'recap';
                } else if (/^(end\s*credits|credits|outro|ending|ed)$/i.test(chName)) {
                    chKind = 'outro';
                }
                if (chKind && !rawList.some(function (existing) { return existing.kind === chKind && Math.abs(existing.startSec - chStart) < 8; })) {
                    pushSeg(chKind, chStart, chEnd);
                }
            }
        }

        rawList.sort(function (a, b) { return a.startSec - b.startSec; });
        var deduped = [];
        rawList.forEach(function (seg) {
            var dup = deduped.some(function (d) {
                return d.kind === seg.kind && Math.abs(d.startSec - seg.startSec) < 3 && Math.abs(d.endSec - seg.endSec) < 4;
            });
            if (!dup) {
                deduped.push(seg);
            }
        });
        return deduped;
    }

    function fetchOsdSkipSegments(item) {
        if (!item || !item.Id) {
            osdState.segments = [];
            osdState.segmentsForId = '';
            return;
        }
        var normId = normalizeGuid(item.Id);
        if (osdState.segmentsForId === normId) {
            return;
        }
        osdState.segmentsForId = normId;
        if (Array.isArray(osdState.segmentsCache[normId])) {
            osdState.segments = osdState.segmentsCache[normId];
            checkOsdSkipSegment();
            return;
        }
        var iid = encodeURIComponent(item.Id);
        var pMediaSegs = apiFetch('/MediaSegments/' + iid).catch(function () { return null; });
        var pIntroV2 = apiFetch('/Episode/' + iid + '/IntroSkipperSegments').catch(function () { return null; });
        var pIntroV1 = apiFetch('/Episode/' + iid + '/IntroTimestamps').catch(function () { return null; });

        Promise.all([pMediaSegs, pIntroV2, pIntroV1]).then(function (arr) {
            var parsed = parseAllSkipSegments(item, arr[0], arr[1], arr[2]);
            osdState.segmentsCache[normId] = parsed;
            if (osdState.info && normalizeGuid(osdState.info.Id) === normId) {
                osdState.segments = parsed;
                checkOsdSkipSegment();
                checkOsdUpNext();
            }
        }).catch(function () {});
    }

    function hideOsdSkipPill() {
        osdState.activeSkipKey = '';
        var el = document.getElementById('streamflix-osd-skip-pill');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function executeSkipSegment(seg) {
        var v = osdState.video;
        if (!v || !seg) {
            return;
        }
        var activeWpRoom = (typeof watchPartyState !== 'undefined' && watchPartyState && watchPartyState.activeGroup && typeof isWatchTogetherEnabled === 'function' && isWatchTogetherEnabled())
            ? watchPartyState.activeGroup
            : null;
        if (activeWpRoom && typeof canControlWatchPartyRoom === 'function' && !canControlWatchPartyRoom(activeWpRoom)) {
            if (typeof showWatchPartyOsdBanner === 'function') {
                showWatchPartyOsdBanner('Controls are locked to ' + (activeWpRoom.hostName || 'the host') + '.');
            }
            return;
        }
        if (typeof onWatchPartyUserPlayerGesture === 'function') {
            onWatchPartyUserPlayerGesture('skip_segment');
        }
        var targetSec = Math.max(0, Number(seg.endSec) || 0);
        var seekHandled = false;
        if (typeof seekEffectiveVideoToSec === 'function') {
            try {
                seekHandled = Boolean(seekEffectiveVideoToSec(v, targetSec, true));
            } catch (eWpSeek) {
                seekHandled = false;
            }
        }
        if (!seekHandled) {
            try {
                var pm = window.StreamFlixPlaybackManager || window.playbackManager;
                var rawDur = Number(v.duration);
                var itemDur = (osdState.info && Number(osdState.info.RunTimeTicks) > 0) ? (Number(osdState.info.RunTimeTicks) / 10000000) : 0;
                if (pm && typeof pm.seek === 'function' && itemDur > 60 && (!isFinite(rawDur) || rawDur < itemDur * 0.85)) {
                    pm.seek(Math.round(targetSec * 10000000));
                } else {
                    v.currentTime = targetSec;
                }
            } catch (eSeek) {
                try { v.currentTime = targetSec; } catch (e2) {}
            }
        }
        if (activeWpRoom && typeof sendWatchPartyCommand === 'function') {
            if (typeof suppressLocalWatchPartyEvents === 'function') {
                suppressLocalWatchPartyEvents(4500);
            }
            sendWatchPartyCommand('seek', {
                positionSeconds: targetSec,
                isPlaying: !v.paused
            });
        }
        osdState.dismissedSegmentKeys[seg.key] = true;
        hideOsdSkipPill();
        osdFlash('chevronRight');
    }

    function checkOsdSkipSegment() {
        if (state.config && state.config.enableSkipIntro === false) {
            hideOsdSkipPill();
            return;
        }
        var v = osdState.video;
        var segs = osdState.segments;
        if (!v || !Array.isArray(segs) || !segs.length || !isVideoPlayerActive() || osdState.episodesOpen || osdState.tracksOpen) {
            hideOsdSkipPill();
            return;
        }
        var rawDur = Number(v.duration);
        var itemDur = (osdState.info && Number(osdState.info.RunTimeTicks) > 0) ? (Number(osdState.info.RunTimeTicks) / 10000000) : 0;
        var dur = (isFinite(rawDur) && rawDur > 0) ? rawDur : itemDur;
        var cur = Number(v.currentTime) || 0;
        if (itemDur > 60 && (!isFinite(rawDur) || rawDur < itemDur * 0.85) && typeof getEffectiveVideoPositionSec === 'function') {
            cur = getEffectiveVideoPositionSec(v);
            dur = itemDur;
        }
        if (!isFinite(cur) || cur < 0) {
            return;
        }

        var matched = null;
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            if (!s || osdState.dismissedSegmentKeys[s.key]) {
                continue;
            }
            if (cur >= s.startSec && cur < (s.endSec - 0.8)) {
                if (s.kind === 'outro') {
                    // Let Up Next handle end-of-episode credits when a next episode exists, EXCEPT when credits precede a post-credits scene!
                    var hasPostCreditsScene = dur > 0 && s.endSec < (dur - 8);
                    if (osdState.upNextVisible || (osdState.nextEpisode && !hasPostCreditsScene)) {
                        continue;
                    }
                    // On standalone movies without post-credits scene where endSec is the end of the file, don't seek to EOF
                    if (!hasPostCreditsScene && !osdState.nextEpisode) {
                        continue;
                    }
                }
                matched = s;
                break;
            }
        }

        if (!matched) {
            if (osdState.activeSkipKey) {
                hideOsdSkipPill();
            }
            return;
        }

        var totalSpan = Math.max(1, matched.endSec - matched.startSec);
        var frac = Math.min(1, Math.max(0, (cur - matched.startSec) / totalSpan));
        var remSec = Math.max(1, Math.ceil(matched.endSec - cur));
        var pill = document.getElementById('streamflix-osd-skip-pill');

        if (!pill || osdState.activeSkipKey !== matched.key) {
            hideOsdSkipPill();
            osdState.activeSkipKey = matched.key;
            pill = document.createElement('div');
            pill.id = 'streamflix-osd-skip-pill';
            pill.className = 'bfx-skip-pill-wrap';
            pill.setAttribute('role', 'region');
            pill.setAttribute('aria-label', matched.label);
            pill.innerHTML = ''
                + '<button type="button" class="bfx-skip-pill-btn" id="streamflix-skip-pill-btn">'
                + '  <span class="bfx-skip-pill-fill" id="streamflix-skip-pill-fill" style="transform:scaleX(' + frac.toFixed(3) + ')"></span>'
                + '  <span class="bfx-skip-pill-content">'
                + '    <span class="bfx-skip-pill-ico">' + icon('chevronRight') + '</span>'
                + '    <span class="bfx-skip-pill-lbl">' + escapeHtml(matched.label) + '</span>'
                + '    <span class="bfx-skip-pill-rem" id="streamflix-skip-pill-rem">' + escapeHtml(formatShortClockSec(remSec)) + '</span>'
                + '    <kbd class="bfx-skip-pill-kbd" aria-hidden="true">S</kbd>'
                + '  </span>'
                + '</button>'
                + '<button type="button" class="bfx-skip-pill-dismiss" id="streamflix-skip-pill-dismiss" title="Dismiss" aria-label="Dismiss skip button">' + icon('close') + '</button>';
            document.body.appendChild(pill);

            var mainBtn = pill.querySelector('#streamflix-skip-pill-btn');
            var dismissBtn = pill.querySelector('#streamflix-skip-pill-dismiss');
            mainBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                executeSkipSegment(matched);
            });
            dismissBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                osdState.dismissedSegmentKeys[matched.key] = true;
                hideOsdSkipPill();
            });
            if (isTvOrDpadActive()) {
                try { mainBtn.focus({ preventScroll: true }); } catch (eFoc) {}
            }
        } else {
            var fillEl = pill.querySelector('#streamflix-skip-pill-fill');
            if (fillEl) {
                fillEl.style.transform = 'scaleX(' + frac.toFixed(3) + ')';
            }
            var remEl = pill.querySelector('#streamflix-skip-pill-rem');
            if (remEl) {
                remEl.textContent = formatShortClockSec(remSec);
            }
        }
    }

    function getExactOutroCreditsStartSec(dur) {
        var earliest = dur > 180 ? (dur * 0.52) : 0;
        if (Array.isArray(osdState.segments) && osdState.segments.length) {
            for (var s = 0; s < osdState.segments.length; s++) {
                var seg = osdState.segments[s];
                if (!seg || seg.kind !== 'outro' || seg.startSec < earliest) {
                    continue;
                }
                // Only treat as end-of-title credits when no post-credits scene follows (>8s after seg.endSec)
                var hasPostCreditsScene = dur > 0 && seg.endSec < (dur - 8);
                if (!hasPostCreditsScene) {
                    return seg.startSec;
                }
            }
        }
        var chapters = osdState.info && Array.isArray(osdState.info.Chapters) ? osdState.info.Chapters : [];
        for (var i = 0; i < chapters.length; i++) {
            var ch = chapters[i];
            if (ch && /^(end\s*credits|credits|outro|ending|ed)$/i.test(String(ch.Name || '').trim())) {
                var startSec = (Number(ch.StartPositionTicks) || 0) / 10000000;
                var hasLaterScene = (i + 1 < chapters.length) && (((Number(chapters[i + 1].StartPositionTicks) || 0) / 10000000) < (dur - 8));
                if (startSec >= earliest && !hasLaterScene) {
                    return startSec;
                }
            }
        }
        return -1;
    }

    function checkOsdUpNext() {
        var v = osdState.video;
        var activeWpRoom = (typeof watchPartyState !== 'undefined' && watchPartyState && typeof isWatchTogetherEnabled === 'function' && isWatchTogetherEnabled())
            ? watchPartyState.activeGroup
            : null;
        var wpHostLockedForViewer = Boolean(activeWpRoom && typeof canControlWatchPartyRoom === 'function' && !canControlWatchPartyRoom(activeWpRoom));
        var nextTarget = osdState.nextEpisode || (wpHostLockedForViewer ? null : osdState.nextMovieRec);
        var isMovieRec = !osdState.nextEpisode && !wpHostLockedForViewer && Boolean(osdState.nextMovieRec);
        var curIt = osdState.info;
        if (!v || !nextTarget || !curIt || !isVideoPlayerActive() || osdState.episodesOpen || osdState.tracksOpen) {
            if (osdState.upNextVisible && (osdState.episodesOpen || osdState.tracksOpen || !isVideoPlayerActive() || !nextTarget)) {
                hideOsdUpNextCard();
            }
            return;
        }
        if (document.querySelector('.upNextDialog:not(.hide)')) {
            hideOsdUpNextCard();
            return;
        }
        var rawDur = Number(v.duration);
        var itemDur = (Number(curIt.RunTimeTicks) || 0) / 10000000;
        var hasFiniteVideoDur = isFinite(rawDur) && rawDur > 0;
        var dur = hasFiniteVideoDur ? rawDur : itemDur;
        var cur = Number(v.currentTime) || 0;
        if (itemDur > 60 && (!hasFiniteVideoDur || rawDur < itemDur * 0.85)) {
            dur = itemDur;
            if (typeof getEffectiveVideoPositionSec === 'function') {
                cur = getEffectiveVideoPositionSec(v);
            }
        }
        if (!dur || !isFinite(dur) || dur < 60 || !isFinite(cur)) {
            return;
        }
        var rem = dur - cur;
        var normCur = normalizeGuid(curIt.Id);
        if (osdState.upNextDismissedForId === normCur) {
            return;
        }
        var exactCreditsStart = getExactOutroCreditsStartSec(dur);
        var inExactCredits = exactCreditsStart > 0 && cur >= exactCreditsStart && rem > 0.3 && rem <= 300;
        var inFallbackTail = exactCreditsStart <= 0 && rem > 0.3 && rem <= 35;
        if (!inExactCredits && !inFallbackTail) {
            if (osdState.upNextVisible && (exactCreditsStart > 0 ? (cur < exactCreditsStart - 2) : (rem > 40))) {
                hideOsdUpNextCard();
            }
            return;
        }
        if (osdState.upNextVisible && document.getElementById('streamflix-osd-upnext')) {
            return;
        }
        var defaultCountdown = isTvOrDpadActive() ? 12 : 10;
        showOsdUpNextCard(nextTarget, normCur, Math.min(defaultCountdown, Math.max(4, Math.ceil(rem))), isMovieRec);
    }

    function showOsdUpNextCard(nextItem, normCurId, seconds, isMovieRec) {
        hideOsdUpNextCard();
        hideOsdPaused();
        osdState.upNextVisible = true;
        osdState.upNextCountdown = seconds || 10;
        osdState.upNextTotal = osdState.upNextCountdown;

        var autoplay = !isMovieRec && !(state.activeProfile && state.activeProfile.autoplayNextEpisode === false);
        var titleText = '';
        if (isMovieRec) {
            titleText = (nextItem.Name || 'Recommended') + (nextItem.ProductionYear ? ' (' + nextItem.ProductionYear + ')' : '');
        } else {
            var epTag = 'S' + (nextItem.ParentIndexNumber || 1) + ':E' + (nextItem.IndexNumber || 1);
            titleText = epTag + (nextItem.Name ? ' · ' + nextItem.Name : '');
        }
        var kickerLabel = isMovieRec ? 'Up Next' : 'Next Episode';
        var playBtnLabel = isMovieRec ? 'Play Movie' : 'Play Next';
        var card = document.createElement('div');
        card.id = 'streamflix-osd-upnext';
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', kickerLabel);
        card.innerHTML = ''
            + '<div class="bfx-upnext-thumb" data-upnext-play="1">'
            + '  <img src="' + escapeHtml(getItemBackdropUrl(nextItem, 480)) + '" alt="" data-bfx-img="fade" />'
            + '  <span class="bfx-upnext-thumb-play">' + icon('play') + '</span>'
            + '</div>'
            + '<div class="bfx-upnext-body">'
            + '  <div class="bfx-upnext-kicker"><span>' + escapeHtml(kickerLabel) + '</span>' + (autoplay ? ('<b id="streamflix-upnext-secs">in ' + osdState.upNextCountdown + 's</b>') : '') + '</div>'
            + '  <div class="bfx-upnext-title">' + escapeHtml(titleText) + '</div>'
            + '  <div class="bfx-upnext-actions">'
            + '    <button type="button" class="bfx-upnext-play-btn" id="streamflix-upnext-play">'
            + '      <span class="bfx-upnext-fill" id="streamflix-upnext-fill" style="transform:scaleX(0)"></span>'
            + '      <span class="bfx-upnext-play-content">' + icon('play') + '<span>' + escapeHtml(playBtnLabel) + '</span></span>'
            + '    </button>'
            + '    <button type="button" class="bfx-upnext-dismiss-btn" id="streamflix-upnext-dismiss">Watch Credits</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(card);
        hydrateCompleteImages(card);

        var startNow = function () {
            if (isMovieRec) {
                closeOsdOverlays();
                hideOsdUpNextCard();
                playItemImmediately(nextItem, null, null, 0);
            } else {
                playEpisodeFromOsd(nextItem);
            }
        };
        var playBtnEl = card.querySelector('#streamflix-upnext-play');
        playBtnEl.addEventListener('click', startNow);
        card.querySelector('[data-upnext-play]').addEventListener('click', startNow);
        card.querySelector('#streamflix-upnext-dismiss').addEventListener('click', function () {
            osdState.upNextDismissedForId = normCurId;
            hideOsdUpNextCard();
        });
        if (isTvOrDpadActive()) {
            try { playBtnEl.focus({ preventScroll: true }); } catch (eUpFoc) {}
        }

        if (!autoplay) {
            return;
        }

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
                playEpisodeFromOsd(nextItem);
            }
        }, 1000);
    }

    function teardownVideoOsd() {
        if (!document.body.classList.contains('streamflix-nf-player') && !osdState.video && !osdState.docBound) {
            return;
        }
        document.body.classList.remove('streamflix-nf-player', 'streamflix-osd-paused-on', 'bfx-unified-tracks', 'bfx-skip-pill-enabled');
        unbindOsdVideo();
        if (osdState.docBound) {
            ['mousemove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (evName) {
                document.removeEventListener(evName, onOsdActivity, { capture: true });
            });
            osdState.docBound = false;
        }
        if (osdState.pausedTimer) {
            clearTimeout(osdState.pausedTimer);
            osdState.pausedTimer = null;
        }
        if (osdState.flashTimer) {
            clearTimeout(osdState.flashTimer);
            osdState.flashTimer = null;
        }
        closeOsdOverlays();
        hideOsdSkipPill();
        hideOsdUpNextCard();
        if (typeof onWatchPartyOsdTeardown === 'function') {
            onWatchPartyOsdTeardown();
        }
        ['streamflix-osd-flash', 'streamflix-osd-paused', 'streamflix-osd-episodes', 'streamflix-osd-tracks', 'streamflix-osd-upnext', 'streamflix-osd-skip-pill'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });
        osdState.fetching = false;
        osdState.info = null;
        osdState.infoFor = '';
        osdState.infoTries = 0;
        osdState.sessionId = '';
        osdState.playState = null;
        osdState.audioIndex = null;
        osdState.subtitleIndex = null;
        osdState.tracksItemId = '';
        osdState.lastSwitchedEpisodeId = '';
        osdState.episodesCache = {};
        osdState.nextEpisode = null;
        osdState.nextMovieRec = null;
        osdState.nextEpisodeForId = '';
        osdState.upNextDismissedForId = '';
        osdState.segments = [];
        osdState.segmentsForId = '';
        osdState.activeSkipKey = '';
        osdState.dismissedSegmentKeys = {};
    }

    function ensureHeaderWidgets() {
        syncDeviceLayoutClasses();
        applyProfileAccent(state.activeProfile || null);
        var inVideo = isVideoPlayerActive();
        document.body.classList.toggle('streamflix-in-video-player', inVideo);
        if (document.documentElement) {
            document.documentElement.classList.toggle('bfx-in-video', inVideo);
        }
        try { enhanceVideoOsd(inVideo); } catch (eOsd) {}

        neutralizeConflictingBrandingCss();
        hideRedundantJellyfinAvatarIcon();
        replaceToolbarLogoInPlace();

        var overlayOpen = Boolean(document.getElementById('streamflix-overlay-root'));

        if (inVideo && state.accountDropdownOpen) {
            closeAccountDropdown();
        }

        var staleBell = document.getElementById('streamflix-header-bell-btn');
        if (staleBell && staleBell.parentNode) {
            staleBell.parentNode.removeChild(staleBell);
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
            ensureMobileDock(true, inVideo);
            if (typeof syncKidsModeChrome === 'function') {
                syncKidsModeChrome();
            }
            return;
        }

        var btn = document.getElementById('streamflix-header-profile-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'streamflix-header-profile-btn';
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                toggleAccountDropdown();
            });
            document.body.appendChild(btn);
        }
        if (btn.hasAttribute('title')) {
            btn.removeAttribute('title');
        }

        ensureMobileDock(overlayOpen, inVideo);

        if (overlayOpen || inVideo || isMobileDockViewportActive()) {
            btn.style.setProperty('display', 'none', 'important');
        } else {
            btn.style.removeProperty('display');
        }

        var wantedSig = (active.id || '') + ':' + (active.name || '') + ':' + (active.icon || '') + ':' + (active.color || '');
        if (btn.getAttribute('data-sig') !== wantedSig) {
            btn.setAttribute('data-sig', wantedSig);
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

        if (typeof syncKidsModeChrome === 'function') {
            syncKidsModeChrome();
        }
        if (typeof syncWatchPartyIndicators === 'function') {
            syncWatchPartyIndicators();
        }
    }

    function isMobileDockViewportActive() {
        if (!document.body) {
            return false;
        }
        if (document.body.classList.contains('bfx-tv-mode')
            || (document.documentElement && document.documentElement.classList.contains('layout-tv'))
            || isAdminConfigRoute()) {
            return false;
        }
        var w = window.innerWidth || 1024;
        return w <= 640 && document.body.classList.contains('bfx-phone-mode');
    }

    function formatDockBrandWord(raw) {
        var s = String(raw || '').trim();
        if (!s) {
            return 'StreamFlix';
        }
        if (s === s.toUpperCase() && s !== s.toLowerCase()) {
            return s.replace(/\w\S*/g, function (w) {
                return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
            });
        }
        return s;
    }

    function getMobileDockProfileLabel() {
        var activeName = state.activeProfile && state.activeProfile.name ? String(state.activeProfile.name).trim() : '';
        if (typeof isKidsProfileActive === 'function' && isKidsProfileActive()) {
            return (activeName && activeName.length <= 10) ? activeName : 'Kids';
        }
        var brand = formatDockBrandWord(getBrandName());
        var candidate = 'My ' + brand;
        if (candidate.length <= 15) {
            return candidate;
        }
        return (activeName && activeName.length <= 12) ? activeName : 'Account';
    }

    function syncMobileDockState() {
        var dock = document.getElementById('streamflix-mobile-dock');
        if (!dock) {
            return;
        }
        var onHome = isOnHomeRoute();
        var searchOpen = typeof isSearchPageActive === 'function'
            ? isSearchPageActive()
            : Boolean(state.mobileSearchOpen || state.searchQuery);
        var hashLower = (window.location.hash || '').toLowerCase();
        var cat = state.activeCategory || 'all';
        var activeTab = 'home';

        if (state.accountDropdownOpen
            || isUserPreferencesRoute()
            || (onHome && !searchOpen && cat === 'mylist')) {
            activeTab = 'profile';
        } else if ((onHome && searchOpen) || hashLower.indexOf('search') !== -1) {
            activeTab = 'search';
        } else if (onHome && (cat === 'hot' || cat === 'top10')) {
            activeTab = 'hot';
        }

        var tabOrder = { home: 0, hot: 1, search: 2, profile: 3 };
        var activeIdx = tabOrder.hasOwnProperty(activeTab) ? tabOrder[activeTab] : 0;
        dock.style.setProperty('--bfx-dock-idx', String(activeIdx));

        Array.prototype.forEach.call(dock.querySelectorAll('[data-dock-tab]'), function (tabBtn) {
            var key = tabBtn.getAttribute('data-dock-tab');
            var isAct = key === activeTab;
            tabBtn.classList.toggle('is-active', isAct);
            if (key === 'profile') {
                tabBtn.setAttribute('aria-expanded', state.accountDropdownOpen ? 'true' : 'false');
            } else if (isAct) {
                tabBtn.setAttribute('aria-current', 'page');
            } else {
                tabBtn.removeAttribute('aria-current');
            }
        });
    }

    function ensureMobileDock(overlayOpen, inVideo) {
        if (!document.body) {
            return;
        }
        var active = state.activeProfile;
        var hideDock = !active
            || Boolean(overlayOpen)
            || Boolean(inVideo)
            || isAdminConfigRoute();

        document.body.classList.toggle('bfx-mobile-dock-ready', !hideDock);

        var dock = document.getElementById('streamflix-mobile-dock');
        if (hideDock) {
            if (dock && dock.parentNode) {
                dock.parentNode.removeChild(dock);
            }
            return;
        }

        if (!dock) {
            dock = document.createElement('nav');
            dock.id = 'streamflix-mobile-dock';
            dock.className = 'bfx-mobile-dock';
            dock.setAttribute('aria-label', 'Primary mobile navigation');
            document.body.appendChild(dock);
        }

        var profLabel = getMobileDockProfileLabel();
        var dockSig = (active.id || '') + ':' + (active.icon || '') + ':' + (active.color || '') + ':' + profLabel;
        if (dock.getAttribute('data-sig') !== dockSig) {
            dock.setAttribute('data-sig', dockSig);
            dock.innerHTML = ''
                + '<span class="bfx-dock-glider" aria-hidden="true"></span>'
                + '<button type="button" class="bfx-dock-btn" data-dock-tab="home" aria-label="Home">'
                + '  <span class="bfx-dock-ico">' + icon('dockHome') + '</span>'
                + '  <span class="bfx-dock-label">Home</span>'
                + '</button>'
                + '<button type="button" class="bfx-dock-btn" data-dock-tab="hot" aria-label="New and Hot">'
                + '  <span class="bfx-dock-ico">' + icon('dockHot') + '</span>'
                + '  <span class="bfx-dock-label">New &amp; Hot</span>'
                + '</button>'
                + '<button type="button" class="bfx-dock-btn" data-dock-tab="search" aria-label="Search">'
                + '  <span class="bfx-dock-ico">' + icon('dockSearch') + '</span>'
                + '  <span class="bfx-dock-label">Search</span>'
                + '</button>'
                + '<button type="button" class="bfx-dock-btn" data-dock-tab="profile" id="bfx-dock-profile-btn" aria-haspopup="menu" aria-label="' + escapeHtml(profLabel) + '">'
                + '  <span class="bfx-dock-avatar" style="background:' + escapeHtml(active.color || '#E50914') + ';">' + escapeHtml(active.icon || '🎬') + '</span>'
                + '  <span class="bfx-dock-label">' + escapeHtml(profLabel) + '</span>'
                + '</button>';

            Array.prototype.forEach.call(dock.querySelectorAll('[data-dock-tab]'), function (tabBtn) {
                tabBtn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var tab = tabBtn.getAttribute('data-dock-tab');
                    if (tab === 'profile') {
                        toggleAccountDropdown();
                        return;
                    }
                    closeAccountDropdown();

                    if (tab === 'home') {
                        if (typeof closeSearchPage === 'function') {
                            closeSearchPage(true);
                        } else {
                            cancelPendingSearch();
                            state.mobileSearchOpen = false;
                            state.searchQuery = '';
                            state.searchResults = null;
                            state.seerrSearchResults = null;
                        }
                        state.browseFilter = null;
                        state.libraryBrowser = null;
                        state.activeCategory = 'all';
                        state.heroIndex = 0;
                        if (!isOnHomeRoute()) {
                            window.location.hash = '#/home';
                            setTimeout(function () {
                                if (state.cinemaHubEnabled !== false) {
                                    ensureCinemaHubMounted();
                                    renderCinemaHubContents();
                                }
                                syncMobileDockState();
                                try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
                            }, 35);
                        } else {
                            if (state.cinemaHubEnabled !== false) {
                                ensureCinemaHubMounted();
                                renderCinemaHubContents();
                            }
                            syncMobileDockState();
                            try {
                                window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                            } catch (e2) {
                                window.scrollTo(0, 0);
                            }
                        }
                        return;
                    }

                    if (tab === 'hot') {
                        if (typeof closeSearchPage === 'function') {
                            closeSearchPage(true);
                        } else {
                            cancelPendingSearch();
                            state.mobileSearchOpen = false;
                            state.searchQuery = '';
                            state.searchResults = null;
                            state.seerrSearchResults = null;
                        }
                        state.browseFilter = null;
                        state.libraryBrowser = null;
                        if (state.cinemaHubEnabled === false) {
                            window.location.hash = '#/movies.html';
                            syncMobileDockState();
                            return;
                        }
                        state.activeCategory = 'hot';
                        state.heroIndex = 0;
                        if (!isOnHomeRoute()) {
                            window.location.hash = '#/home';
                            setTimeout(function () {
                                ensureCinemaHubMounted();
                                renderCinemaHubContents();
                                syncMobileDockState();
                                try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
                            }, 35);
                        } else {
                            ensureCinemaHubMounted();
                            renderCinemaHubContents();
                            syncMobileDockState();
                            try {
                                window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                            } catch (e3) {
                                window.scrollTo(0, 0);
                            }
                        }
                        return;
                    }

                    if (tab === 'search') {
                        if (state.cinemaHubEnabled === false) {
                            window.location.hash = '#/search.html';
                            syncMobileDockState();
                            return;
                        }
                        if (typeof openSearchPage === 'function') {
                            openSearchPage(undefined, true);
                        }
                    }
                });
            });
        }

        syncMobileDockState();
    }

    /* ----------------------------------------------------------------------
       Music & Audiobook Persistent Glass Mini-Player (#bfx-audio-miniplayer)
       ---------------------------------------------------------------------- */
    var audioMiniState = {
        audioEl: null,
        queue: [],
        index: 0,
        lastReportMs: 0,
        ownerUserId: '',
        ownerProfileId: '',
        requestSeq: 0
    };

    function reportMiniPlayerProgress(eventName, item, posSec, isPaused) {
        if (!item || !item.Id) {
            return;
        }
        var auth = getJellyfinAuthContext();
        if (!auth || !auth.token || !auth.userId) {
            return;
        }
        if (audioMiniState.ownerUserId && normalizeGuid(auth.userId) !== audioMiniState.ownerUserId) {
            return;
        }
        if (audioMiniState.ownerProfileId && state.activeProfile && state.activeProfile.id && state.activeProfile.id !== audioMiniState.ownerProfileId) {
            return;
        }
        var ticks = Math.max(0, Math.round((Number(posSec) || 0) * 10000000));
        var endpoint = eventName === 'start'
            ? '/Sessions/Playing'
            : (eventName === 'stop' ? '/Sessions/Playing/Stopped' : '/Sessions/Playing/Progress');
        apiFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ItemId: item.Id,
                PositionTicks: ticks,
                IsPaused: Boolean(isPaused),
                CanSeek: true
            })
        }).catch(function () {});
    }

    function stopStreamFlixAudioMiniPlayer(opts) {
        var skipReport = Boolean(opts && opts.skipReport);
        audioMiniState.requestSeq = (audioMiniState.requestSeq + 1) % 1000000;
        var a = audioMiniState.audioEl;
        var curItem = audioMiniState.queue[audioMiniState.index];
        if (a) {
            if (curItem && !skipReport) {
                reportMiniPlayerProgress('stop', curItem, a.currentTime || 0, true);
            }
            if (a.__bfxOnMeta) {
                try { a.removeEventListener('loadedmetadata', a.__bfxOnMeta); } catch (eRmMeta) {}
                a.__bfxOnMeta = null;
            }
            try {
                a.pause();
                a.removeAttribute('src');
                a.load();
            } catch (eStop) {}
            if (a.parentNode) {
                a.parentNode.removeChild(a);
            }
            audioMiniState.audioEl = null;
        }
        var strayAudio = document.getElementById('bfx-audio-engine');
        if (strayAudio && strayAudio.parentNode) {
            try { strayAudio.pause(); strayAudio.removeAttribute('src'); } catch (eStray) {}
            strayAudio.parentNode.removeChild(strayAudio);
        }
        audioMiniState.queue = [];
        audioMiniState.index = 0;
        audioMiniState.ownerUserId = '';
        audioMiniState.ownerProfileId = '';
        var bar = document.getElementById('bfx-audio-miniplayer');
        if (bar && bar.parentNode) {
            bar.parentNode.removeChild(bar);
        }
        if (document.body) {
            document.body.classList.remove('bfx-has-miniplayer');
        }
    }

    function buildAudioStreamUrl(item) {
        var auth = getJellyfinAuthContext();
        var tok = (auth && auth.token) || '';
        var devId = 'streamflix-web';
        try {
            if (window.ApiClient && typeof window.ApiClient.deviceId === 'function') {
                devId = window.ApiClient.deviceId() || devId;
            }
        } catch (eDev) {}
        return apiBase()
            + '/Audio/' + encodeURIComponent(item.Id) + '/universal'
            + '?UserId=' + encodeURIComponent((auth && auth.userId) || '')
            + '&DeviceId=' + encodeURIComponent(devId)
            + '&MaxStreamingBitrate=320000'
            + '&Container=opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,wav'
            + '&TranscodingContainer=ts&TranscodingProtocol=hls&AudioCodec=aac'
            + (tok ? ('&ApiKey=' + encodeURIComponent(tok)) : '');
    }

    function renderAudioMiniPlayerBar() {
        var cur = audioMiniState.queue[audioMiniState.index];
        var a = audioMiniState.audioEl;
        if (!cur || !a) {
            return;
        }
        if (document.body) {
            document.body.classList.add('bfx-has-miniplayer');
        }
        var bar = document.getElementById('bfx-audio-miniplayer');
        var artUrl = getItemPosterUrl(cur, 240)
            || (cur.AlbumId ? (apiBase() + '/Items/' + encodeURIComponent(cur.AlbumId) + '/Images/Primary?maxWidth=240&quality=85') : '');
        var artistOrAlbum = [
            Array.isArray(cur.Artists) && cur.Artists.length ? cur.Artists.join(', ') : (cur.AlbumArtist || ''),
            cur.Album || (cur.Type === 'AudioBook' ? 'Audiobook' : '')
        ].filter(Boolean).join(' · ') || (cur.Type === 'AudioBook' ? 'Audiobook' : 'Audio');

        if (!bar) {
            bar = document.createElement('aside');
            bar.id = 'bfx-audio-miniplayer';
            bar.className = 'bfx-miniplayer';
            bar.setAttribute('aria-label', 'Audio Mini Player');
            bar.innerHTML = ''
                + '<div class="bfx-mp-progress-wrap">'
                + '  <input type="range" class="bfx-mp-scrub" id="bfx-mp-scrub" min="0" max="1000" value="0" aria-label="Seek audio" />'
                + '</div>'
                + '<div class="bfx-mp-inner">'
                + '  <div class="bfx-mp-meta">'
                + '    <div class="bfx-mp-art" id="bfx-mp-art"></div>'
                + '    <div class="bfx-mp-copy">'
                + '      <div class="bfx-mp-title" id="bfx-mp-title"></div>'
                + '      <div class="bfx-mp-sub" id="bfx-mp-sub"></div>'
                + '    </div>'
                + '  </div>'
                + '  <div class="bfx-mp-controls">'
                + '    <button type="button" class="bfx-mp-btn" id="bfx-mp-prev" title="Back 15s / Previous" aria-label="Previous or back 15 seconds">' + icon('chevronLeft') + '</button>'
                + '    <button type="button" class="bfx-mp-btn is-play" id="bfx-mp-toggle" title="Play / Pause" aria-label="Play or pause"></button>'
                + '    <button type="button" class="bfx-mp-btn" id="bfx-mp-next" title="Forward 30s / Next" aria-label="Next or forward 30 seconds">' + icon('chevronRight') + '</button>'
                + '  </div>'
                + '  <div class="bfx-mp-right">'
                + '    <span class="bfx-mp-time" id="bfx-mp-time">0:00</span>'
                + '    <button type="button" class="bfx-mp-btn is-close" id="bfx-mp-close" title="Close player" aria-label="Close mini player">' + icon('close') + '</button>'
                + '  </div>'
                + '</div>';
            document.body.appendChild(bar);

            bar.querySelector('#bfx-mp-toggle').addEventListener('click', function () {
                var eng = audioMiniState.audioEl;
                if (!eng) { return; }
                if (eng.paused) {
                    try { eng.play(); } catch (eP) {}
                } else {
                    eng.pause();
                }
            });
            bar.querySelector('#bfx-mp-prev').addEventListener('click', function () {
                var eng = audioMiniState.audioEl;
                if (!eng) { return; }
                if ((eng.currentTime || 0) > 12 || audioMiniState.index === 0) {
                    eng.currentTime = Math.max(0, (eng.currentTime || 0) - 15);
                } else {
                    startAudioQueueTrack(audioMiniState.index - 1);
                }
            });
            bar.querySelector('#bfx-mp-next').addEventListener('click', function () {
                var eng = audioMiniState.audioEl;
                if (!eng) { return; }
                if (audioMiniState.index + 1 < audioMiniState.queue.length) {
                    startAudioQueueTrack(audioMiniState.index + 1);
                } else {
                    var activeTrack = audioMiniState.queue[audioMiniState.index];
                    var dur = (isFinite(eng.duration) && eng.duration > 0)
                        ? eng.duration
                        : ((Number(activeTrack && activeTrack.RunTimeTicks) || 0) / 10000000);
                    eng.currentTime = dur > 0 ? Math.min(dur, (eng.currentTime || 0) + 30) : ((eng.currentTime || 0) + 30);
                }
            });
            bar.querySelector('#bfx-mp-close').addEventListener('click', function () {
                stopStreamFlixAudioMiniPlayer();
            });
            bar.querySelector('#bfx-mp-scrub').addEventListener('input', function (ev) {
                var eng = audioMiniState.audioEl;
                var activeTrack = audioMiniState.queue[audioMiniState.index];
                if (!eng || !activeTrack) { return; }
                var dur = (isFinite(eng.duration) && eng.duration > 0)
                    ? eng.duration
                    : ((Number(activeTrack.RunTimeTicks) || 0) / 10000000);
                if (dur > 0) {
                    eng.currentTime = (Number(ev.target.value) / 1000) * dur;
                }
            });
        }

        var artEl = bar.querySelector('#bfx-mp-art');
        if (artEl) {
            artEl.innerHTML = artUrl
                ? '<img src="' + escapeHtml(artUrl) + '" alt="" />'
                : icon('play');
        }
        var titleEl = bar.querySelector('#bfx-mp-title');
        if (titleEl) { titleEl.textContent = cur.Name || 'Untitled Track'; }
        var subEl = bar.querySelector('#bfx-mp-sub');
        if (subEl) { subEl.textContent = artistOrAlbum; }
        var toggleEl = bar.querySelector('#bfx-mp-toggle');
        if (toggleEl) { toggleEl.innerHTML = icon(a.paused ? 'play' : 'pause'); }
    }

    function startAudioQueueTrack(idx) {
        if (idx < 0 || idx >= audioMiniState.queue.length) {
            stopStreamFlixAudioMiniPlayer();
            return;
        }
        audioMiniState.index = idx;
        var track = audioMiniState.queue[idx];
        var a = audioMiniState.audioEl;
        if (!a) {
            a = document.createElement('audio');
            a.id = 'bfx-audio-engine';
            a.preload = 'auto';
            a.style.display = 'none';
            document.body.appendChild(a);
            audioMiniState.audioEl = a;

            a.addEventListener('play', function () {
                renderAudioMiniPlayerBar();
                var cur = audioMiniState.queue[audioMiniState.index];
                reportMiniPlayerProgress('start', cur, a.currentTime || 0, false);
            });
            a.addEventListener('pause', function () {
                renderAudioMiniPlayerBar();
                var cur = audioMiniState.queue[audioMiniState.index];
                reportMiniPlayerProgress('progress', cur, a.currentTime || 0, true);
            });
            a.addEventListener('timeupdate', function () {
                var cur = audioMiniState.queue[audioMiniState.index];
                if (!cur) { return; }
                var dur = (isFinite(a.duration) && a.duration > 0)
                    ? a.duration
                    : ((Number(cur.RunTimeTicks) || 0) / 10000000);
                var pos = Number(a.currentTime) || 0;
                var scrubEl = document.getElementById('bfx-mp-scrub');
                if (scrubEl && dur > 0) {
                    scrubEl.value = String(Math.min(1000, Math.max(0, Math.round((pos / dur) * 1000))));
                }
                var timeEl = document.getElementById('bfx-mp-time');
                if (timeEl) {
                    timeEl.textContent = formatShortClockSec(pos) + (dur > 0 ? (' / ' + formatShortClockSec(dur)) : '');
                }
                var now = Date.now();
                if (now - audioMiniState.lastReportMs > 10000) {
                    audioMiniState.lastReportMs = now;
                    reportMiniPlayerProgress('progress', cur, pos, a.paused);
                }
            });
            a.addEventListener('ended', function () {
                if (audioMiniState.index + 1 < audioMiniState.queue.length) {
                    startAudioQueueTrack(audioMiniState.index + 1);
                } else {
                    stopStreamFlixAudioMiniPlayer();
                }
            });
            a.addEventListener('error', function () {
                var cur = audioMiniState.queue[audioMiniState.index];
                if (cur && !a.__bfxFallbackTried) {
                    a.__bfxFallbackTried = true;
                    var auth = getJellyfinAuthContext();
                    a.src = apiBase() + '/Items/' + encodeURIComponent(cur.Id) + '/Download' + ((auth && auth.token) ? ('?ApiKey=' + encodeURIComponent(auth.token)) : '');
                    try {
                        var fbPlay = a.play();
                        if (fbPlay && typeof fbPlay.catch === 'function') { fbPlay.catch(function () {}); }
                    } catch (eFb) {}
                }
            });
        }

        if (a.__bfxOnMeta) {
            try { a.removeEventListener('loadedmetadata', a.__bfxOnMeta); } catch (eOldMeta) {}
            a.__bfxOnMeta = null;
        }
        a.__bfxFallbackTried = false;
        a.src = buildAudioStreamUrl(track);
        var resumeSec = (track.UserData && Number(track.UserData.PlaybackPositionTicks) > 0)
            ? (Number(track.UserData.PlaybackPositionTicks) / 10000000)
            : 0;
        if (resumeSec > 5) {
            var onMeta = function () {
                a.removeEventListener('loadedmetadata', onMeta);
                if (a.__bfxOnMeta === onMeta) {
                    a.__bfxOnMeta = null;
                }
                try { a.currentTime = resumeSec; } catch (eSeek) {}
            };
            a.__bfxOnMeta = onMeta;
            a.addEventListener('loadedmetadata', onMeta);
        }
        renderAudioMiniPlayerBar();
        var playPromise = a.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function () {});
        }
    }

    function playStreamFlixAudioItem(item) {
        if (!item || !item.Id) {
            return;
        }
        if (typeof stopHeroVideoPreview === 'function') {
            stopHeroVideoPreview(false);
        }
        var auth = getJellyfinAuthContext();
        audioMiniState.ownerUserId = (auth && auth.userId) ? normalizeGuid(auth.userId) : '';
        audioMiniState.ownerProfileId = (state.activeProfile && state.activeProfile.id) ? String(state.activeProfile.id) : '';
        audioMiniState.requestSeq = (audioMiniState.requestSeq + 1) % 1000000;
        var reqSeq = audioMiniState.requestSeq;
        if (item.Type === 'MusicAlbum') {
            var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
            fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Audio&SortBy=ParentIndexNumber,IndexNumber,SortName&SortOrder=Ascending&Limit=100')
                .then(function (res) {
                    if (audioMiniState.requestSeq !== reqSeq) {
                        return;
                    }
                    var tracks = (res && Array.isArray(res.Items)) ? res.Items : [];
                    if (tracks.length > 0) {
                        audioMiniState.queue = tracks;
                        startAudioQueueTrack(0);
                    }
                })
                .catch(function () {});
            return;
        }
        audioMiniState.queue = [item];
        startAudioQueueTrack(0);
    }
