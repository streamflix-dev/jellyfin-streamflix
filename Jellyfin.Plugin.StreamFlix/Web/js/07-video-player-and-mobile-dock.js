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
                checkOsdUpNext();
            },
            seeked: function () {
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
                osdState.nextEpisodeForId = '';
                osdState.upNextDismissedForId = '';
                hideOsdPaused();
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

        var autoplay = !(state.activeProfile && state.activeProfile.autoplayNextEpisode === false);
        var epTag = 'S' + (nextEp.ParentIndexNumber || 1) + ':E' + (nextEp.IndexNumber || 1);
        var titleText = epTag + (nextEp.Name ? ' · ' + nextEp.Name : '');
        var card = document.createElement('div');
        card.id = 'streamflix-osd-upnext';
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', 'Next episode');
        card.innerHTML = ''
            + '<div class="bfx-upnext-thumb" data-upnext-play="1">'
            + '  <img src="' + escapeHtml(getItemBackdropUrl(nextEp, 480)) + '" alt="" data-bfx-img="fade" />'
            + '  <span class="bfx-upnext-thumb-play">' + icon('play') + '</span>'
            + '</div>'
            + '<div class="bfx-upnext-body">'
            + '  <div class="bfx-upnext-kicker"><span>Next Episode</span>' + (autoplay ? ('<b id="streamflix-upnext-secs">in ' + osdState.upNextCountdown + 's</b>') : '') + '</div>'
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
        hydrateCompleteImages(card);

        var startNow = function () {
            playEpisodeFromOsd(nextEp);
        };
        card.querySelector('#streamflix-upnext-play').addEventListener('click', startNow);
        card.querySelector('[data-upnext-play]').addEventListener('click', startNow);
        card.querySelector('#streamflix-upnext-dismiss').addEventListener('click', function () {
            osdState.upNextDismissedForId = normCurId;
            hideOsdUpNextCard();
        });

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
                playEpisodeFromOsd(nextEp);
            }
        }, 1000);
    }

    function teardownVideoOsd() {
        if (!document.body.classList.contains('streamflix-nf-player') && !osdState.video && !osdState.docBound) {
            return;
        }
        document.body.classList.remove('streamflix-nf-player', 'streamflix-osd-paused-on', 'bfx-unified-tracks');
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
        hideOsdUpNextCard();
        if (typeof onWatchPartyOsdTeardown === 'function') {
            onWatchPartyOsdTeardown();
        }
        ['streamflix-osd-flash', 'streamflix-osd-paused', 'streamflix-osd-episodes', 'streamflix-osd-tracks', 'streamflix-osd-upnext'].forEach(function (id) {
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
        osdState.nextEpisodeForId = '';
        osdState.upNextDismissedForId = '';
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
        if (inVideo && state.notificationsOpen && typeof closeNotificationsDropdown === 'function') {
            closeNotificationsDropdown();
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
            var staleBell = document.getElementById('streamflix-header-bell-btn');
            if (staleBell) {
                staleBell.style.setProperty('display', 'none', 'important');
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

        var bellBtn = document.getElementById('streamflix-header-bell-btn');
        if (!bellBtn) {
            bellBtn = document.createElement('button');
            bellBtn.type = 'button';
            bellBtn.id = 'streamflix-header-bell-btn';
            bellBtn.setAttribute('aria-label', 'Notifications');
            bellBtn.setAttribute('aria-haspopup', 'menu');
            bellBtn.innerHTML = icon('bell');
            bellBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (typeof toggleNotificationsDropdown === 'function') {
                    toggleNotificationsDropdown();
                }
            });
            document.body.appendChild(bellBtn);
        }
        var hideBell = overlayOpen || inVideo || isMobileDockViewportActive() || isAdminConfigRoute() || isKidsProfileActive();
        if (hideBell) {
            bellBtn.style.setProperty('display', 'none', 'important');
        } else {
            bellBtn.style.removeProperty('display');
            try {
                var profRect = btn.getBoundingClientRect();
                if (profRect && profRect.width > 10) {
                    bellBtn.style.right = Math.max(64, Math.round(window.innerWidth - profRect.left + 8)) + 'px';
                }
            } catch (eBellPos) {}
            if (typeof syncHeaderBellBadge === 'function') {
                syncHeaderBellBadge();
            }
        }

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
        var searchOpen = Boolean(state.mobileSearchOpen || state.searchQuery);
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
                        cancelPendingSearch();
                        state.mobileSearchOpen = false;
                        state.searchQuery = '';
                        state.searchResults = null;
                        state.seerrSearchResults = null;
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
                        cancelPendingSearch();
                        state.mobileSearchOpen = false;
                        state.searchQuery = '';
                        state.searchResults = null;
                        state.seerrSearchResults = null;
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
                        if (isOnHomeRoute()) {
                            var hubEl = document.getElementById('streamflix-cinema-hub');
                            var liveInput = document.getElementById('streamflix-live-search-input');
                            if (state.mobileSearchOpen && !state.searchQuery && liveInput && document.activeElement === liveInput) {
                                state.mobileSearchOpen = false;
                                try { liveInput.blur(); } catch (eBlur) {}
                                renderCinemaHubContents();
                                syncMobileDockState();
                                return;
                            }
                            state.mobileSearchOpen = true;
                            if (hubEl) {
                                var subEl = hubEl.querySelector('.streamflix-subnav');
                                if (subEl) {
                                    subEl.classList.add('is-search-open');
                                }
                            }
                            syncMobileDockState();
                            try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (eScr) { window.scrollTo(0, 0); }
                            if (liveInput) {
                                try { liveInput.focus(); } catch (eFoc) {}
                            } else {
                                ensureCinemaHubMounted();
                                renderCinemaHubContents();
                                var liveInput2 = document.getElementById('streamflix-live-search-input');
                                if (liveInput2) {
                                    try { liveInput2.focus(); } catch (eFoc2) {}
                                }
                            }
                        } else {
                            state.mobileSearchOpen = true;
                            window.location.hash = '#/home';
                            setTimeout(function () {
                                ensureCinemaHubMounted();
                                renderCinemaHubContents();
                                syncMobileDockState();
                                try { window.scrollTo(0, 0); } catch (eScr2) {}
                                var liveInput3 = document.getElementById('streamflix-live-search-input');
                                if (liveInput3) {
                                    try { liveInput3.focus(); } catch (eFoc3) {}
                                }
                            }, 45);
                        }
                    }
                });
            });
        }

        syncMobileDockState();
    }
