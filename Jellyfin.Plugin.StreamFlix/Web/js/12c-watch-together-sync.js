/* StreamFlix Client (12c) — Server-Authoritative Watch Together Sync Engine */
    /* ======================================================================
       PART B1. WATCH PARTY REAL-TIME TIMELINE & PLAYER SYNC ENGINE
       ====================================================================== */
    var PENDING_WATCHPARTY_KEY = 'streamflix_pending_watchparty_v2';
    var ACTIVE_WATCHPARTY_ROOM_KEY = 'streamflix_active_wp_room_v2';
    var WATCHPARTY_PARTICIPANT_KEY = 'streamflix_wp_participant_v2';

    var watchPartyState = {
        activeGroup: null,
        joinedGroupId: '',
        participantId: '',
        targetItem: null,
        groups: [],
        loading: false,
        processingPending: false,
        onModalRoomUpdated: null
    };

    var wpSync = {
        loopRunning: false,
        abortCtrl: null,
        driftTimer: null,
        pauseVerifyTimer: null,
        seekDebounceTimer: null,
        hardSeekSettleTimer: null,
        startupAlignTimer: null,
        bannerTimer: null,
        visibilityBound: false,
        snapshotPerfMs: 0,
        lastHalfRttSec: 0,
        lastVersion: 0,
        lastActionShownKey: '',
        lastSentActionId: '',
        suppressEventsUntil: 0,
        joinedAtMs: 0,
        followingItemId: '',
        autoLaunchedRoomItemKey: '',
        lastAutoLaunchItemId: '',
        lastAutoLaunchAtMs: 0,
        videoAttachedAtMs: 0,
        lastProgrammaticSeekAtMs: 0,
        lastProgrammaticSeekTargetSec: -1,
        lastTranscodeSeekAtMs: 0,
        lastUserGestureAtMs: 0,
        lastCommandSentAtMs: 0,
        lastCommandKind: '',
        streamOffsetSec: null,
        calibratedSrc: '',
        isTranscodingStream: false,
        lastNativeProgressAtMs: 0,
        isBuffering: false,
        autoplayBlocked: false,
        actionCounter: 0
    };

    try {
        watchPartyState.joinedGroupId = sessionStorage.getItem(ACTIVE_WATCHPARTY_ROOM_KEY) || '';
        watchPartyState.participantId = sessionStorage.getItem(WATCHPARTY_PARTICIPANT_KEY) || '';
    } catch (e) {}

    function getMyWatchPartyParticipantId() {
        if (watchPartyState.participantId && watchPartyState.participantId.length >= 8) {
            return watchPartyState.participantId;
        }
        var bytes = new Uint8Array(6);
        try {
            if (window.crypto && window.crypto.getRandomValues) {
                window.crypto.getRandomValues(bytes);
            } else {
                for (var b = 0; b < bytes.length; b++) {
                    bytes[b] = Math.floor(Math.random() * 256);
                }
            }
        } catch (e) {}
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
        }
        watchPartyState.participantId = 'wp-' + hex;
        try {
            sessionStorage.setItem(WATCHPARTY_PARTICIPANT_KEY, watchPartyState.participantId);
        } catch (e) {}
        return watchPartyState.participantId;
    }

    function nextWatchPartyActionId() {
        wpSync.actionCounter = (wpSync.actionCounter + 1) % 1000000;
        var id = getMyWatchPartyParticipantId() + '-' + Date.now().toString(36) + '-' + wpSync.actionCounter;
        wpSync.lastSentActionId = id;
        return id;
    }

    function isWatchTogetherEnabled() {
        if (!state.config || state.config.enableWatchTogether === false) {
            return false;
        }
        if (!state.activeProfile || state.activeProfile.isKids) {
            return false;
        }
        return true;
    }

    function isValidWatchPartyRoomCode(raw) {
        return /^[A-Za-z0-9-]{4,36}$/.test(String(raw || '').trim());
    }

    function extractWatchPartyCodeFromInput(rawInput) {
        var s = String(rawInput || '').trim();
        if (!s) {
            return '';
        }
        var m = s.match(/(?:[?&#]|^)watchparty=([A-Za-z0-9-]{4,36})/i);
        if (m && m[1]) {
            return m[1].toUpperCase();
        }
        if (s.indexOf('://') !== -1 || s.indexOf('/') !== -1) {
            return '';
        }
        var cleaned = s.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
        return isValidWatchPartyRoomCode(cleaned) ? cleaned : '';
    }

    function normalizeWatchPartyRoomSnapshot(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        var rid = String(raw.roomId || raw.RoomId || raw.groupId || raw.GroupId || '').trim().toUpperCase();
        if (!rid) {
            return null;
        }
        var rawParts = Array.isArray(raw.participants)
            ? raw.participants
            : (Array.isArray(raw.Participants) ? raw.Participants : []);
        var parts = rawParts.map(function (p) {
            if (!p || typeof p !== 'object') {
                return null;
            }
            return {
                participantId: String(p.participantId || p.ParticipantId || ''),
                profileId: String(p.profileId || p.ProfileId || ''),
                displayName: String(p.displayName || p.DisplayName || 'Viewer'),
                avatarEmoji: String(p.avatarEmoji || p.AvatarEmoji || '🎬'),
                avatarColorHex: String(p.avatarColorHex || p.AvatarColorHex || '#E50914'),
                isHost: Boolean(p.isHost !== undefined ? p.isHost : p.IsHost),
                positionSeconds: Number(p.positionSeconds !== undefined ? p.positionSeconds : (p.PositionSeconds || 0)) || 0,
                isBuffering: Boolean(p.isBuffering !== undefined ? p.isBuffering : p.IsBuffering)
            };
        }).filter(Boolean);

        var rName = String(raw.name || raw.Name || raw.groupName || raw.GroupName || 'Watch Party');
        var sNum = raw.seasonNumber !== undefined ? raw.seasonNumber : raw.SeasonNumber;
        var eNum = raw.episodeNumber !== undefined ? raw.episodeNumber : raw.EpisodeNumber;
        var rtTicks = raw.runTimeTicks !== undefined ? raw.runTimeTicks : raw.RunTimeTicks;
        var pCount = Number(raw.participantCount !== undefined ? raw.participantCount : raw.ParticipantCount) || parts.length || 1;

        return {
            roomId: rid,
            groupId: rid,
            name: rName,
            groupName: rName,
            version: Number(raw.version !== undefined ? raw.version : (raw.Version || 0)) || 0,
            serverNowUtcMs: Number(raw.serverNowUtcMs !== undefined ? raw.serverNowUtcMs : (raw.ServerNowUtcMs || Date.now())) || Date.now(),
            hostParticipantId: String(raw.hostParticipantId || raw.HostParticipantId || ''),
            hostProfileId: String(raw.hostProfileId || raw.HostProfileId || ''),
            creatorProfileId: String(raw.creatorProfileId || raw.CreatorProfileId || ''),
            hostName: String(raw.hostName || raw.HostName || ''),
            hostControlOnly: Boolean(raw.hostControlOnly !== undefined ? raw.hostControlOnly : raw.HostControlOnly),
            itemId: String(raw.itemId || raw.ItemId || ''),
            itemName: String(raw.itemName || raw.ItemName || ''),
            seriesName: String(raw.seriesName || raw.SeriesName || ''),
            seasonNumber: sNum != null ? Number(sNum) : null,
            episodeNumber: eNum != null ? Number(eNum) : null,
            itemType: String(raw.itemType || raw.ItemType || ''),
            runTimeTicks: rtTicks != null ? Number(rtTicks) : null,
            isPlaying: Boolean(raw.isPlaying !== undefined ? raw.isPlaying : raw.IsPlaying),
            state: String(raw.state || raw.State || 'Lobby'),
            basePositionSeconds: Number(raw.basePositionSeconds !== undefined ? raw.basePositionSeconds : (raw.BasePositionSeconds || 0)) || 0,
            expectedPositionSeconds: Number(raw.expectedPositionSeconds !== undefined ? raw.expectedPositionSeconds : (raw.ExpectedPositionSeconds || 0)) || 0,
            stateUpdatedAtUtcMs: Number(raw.stateUpdatedAtUtcMs !== undefined ? raw.stateUpdatedAtUtcMs : (raw.StateUpdatedAtUtcMs || 0)) || 0,
            lastActionId: String(raw.lastActionId || raw.LastActionId || ''),
            lastActionKind: String(raw.lastActionKind || raw.LastActionKind || ''),
            lastActorParticipantId: String(raw.lastActorParticipantId || raw.LastActorParticipantId || ''),
            lastActionBy: String(raw.lastActionBy || raw.LastActionBy || ''),
            lastActionText: String(raw.lastActionText || raw.LastActionText || ''),
            lastActionAtUtcMs: Number(raw.lastActionAtUtcMs !== undefined ? raw.lastActionAtUtcMs : (raw.LastActionAtUtcMs || 0)) || 0,
            participantCount: pCount,
            participants: parts
        };
    }

    function normalizeWatchPartyRoomsArray(rawList) {
        if (!Array.isArray(rawList)) {
            return [];
        }
        return rawList.map(normalizeWatchPartyRoomSnapshot).filter(Boolean);
    }

    function setJoinedWatchPartyGroupId(roomId) {
        var norm = roomId ? String(roomId).trim().toUpperCase() : '';
        watchPartyState.joinedGroupId = norm;
        try {
            if (norm) {
                sessionStorage.setItem(ACTIVE_WATCHPARTY_ROOM_KEY, norm);
            } else {
                sessionStorage.removeItem(ACTIVE_WATCHPARTY_ROOM_KEY);
            }
        } catch (e) {}
    }

    function markWatchPartyRoomItemAutoLaunched(roomId, itemId) {
        var r = String(roomId || '').trim().toUpperCase();
        var it = itemId ? normalizeGuid(itemId) : '';
        if (r && it) {
            wpSync.autoLaunchedRoomItemKey = r + ':' + it;
            wpSync.lastAutoLaunchItemId = it;
            wpSync.lastAutoLaunchAtMs = Date.now();
        }
    }

    function suppressLocalWatchPartyEvents(ms) {
        var until = performance.now() + Math.max(250, Number(ms) || 2500);
        if (until > wpSync.suppressEventsUntil) {
            wpSync.suppressEventsUntil = until;
        }
    }

    function isLocalWatchPartySuppressed() {
        return performance.now() < wpSync.suppressEventsUntil;
    }

    function isMyWatchPartyHostProfile(room) {
        if (!room || isGuestPassSession()) {
            return false;
        }
        var myProfId = String((state.activeProfile && state.activeProfile.id) || '').trim().toLowerCase();
        if (!myProfId) {
            return false;
        }
        var hostProf = String(room.hostProfileId || '').trim().toLowerCase();
        var creatorProf = String(room.creatorProfileId || '').trim().toLowerCase();
        return Boolean((hostProf && hostProf === myProfId) || (creatorProf && creatorProf === myProfId));
    }

    function canControlWatchPartyRoom(room) {
        var r = room || watchPartyState.activeGroup;
        if (!r) {
            return false;
        }
        if (!r.hostControlOnly) {
            return true;
        }
        if (r.hostParticipantId && r.hostParticipantId === getMyWatchPartyParticipantId()) {
            return true;
        }
        if (isMyWatchPartyHostProfile(r)) {
            return true;
        }
        return Boolean(!isGuestPassSession() && isProfileManagementAdmin());
    }

    function canDeleteWatchPartyRoom(room) {
        var r = room || watchPartyState.activeGroup;
        if (!r) {
            return false;
        }
        if (r.hostParticipantId && r.hostParticipantId === getMyWatchPartyParticipantId()) {
            return true;
        }
        if (!isGuestPassSession() && isProfileManagementAdmin()) {
            return true;
        }
        if (isMyWatchPartyHostProfile(r)) {
            return true;
        }
        if (!isGuestPassSession() && !r.hostControlOnly) {
            return true;
        }
        return false;
    }

    function getAuthoritativeRoomPositionSec(room) {
        var r = room || watchPartyState.activeGroup;
        if (!r) {
            return 0;
        }
        var base = Number(r.expectedPositionSeconds || 0) + (r.isPlaying ? (wpSync.lastHalfRttSec || 0) : 0);
        if (!r.isPlaying) {
            return Math.max(0, base);
        }
        var snapMs = wpSync.snapshotPerfMs || performance.now();
        var elapsed = Math.max(0, (performance.now() - snapMs) / 1000);
        var pos = base + elapsed;
        if (r.runTimeTicks && Number(r.runTimeTicks) > 0) {
            pos = Math.min(pos, Number(r.runTimeTicks) / 10000000);
        }
        return Math.max(0, pos);
    }

    function parseOsdClockTextToSec(text) {
        var clean = String(text || '').trim().replace(/^-\s*/, '');
        if (!clean || !/^\d+(?::\d{2}){1,2}$/.test(clean)) {
            return null;
        }
        var parts = clean.split(':').map(function (p) { return parseInt(p, 10) || 0; });
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        return null;
    }

    function getKnownTotalDurationSec(v) {
        var infoTicks = (osdState && osdState.info && Number(osdState.info.RunTimeTicks)) || 0;
        if (!infoTicks && watchPartyState.activeGroup && Number(watchPartyState.activeGroup.runTimeTicks) > 0) {
            infoTicks = Number(watchPartyState.activeGroup.runTimeTicks);
        }
        if (infoTicks > 0) {
            return infoTicks / 10000000;
        }
        var vd = v ? Number(v.duration) : 0;
        return (isFinite(vd) && vd > 0) ? vd : 0;
    }

    function isDirectFullTimelineVideo(v) {
        if (!v) {
            return false;
        }
        if (wpSync.streamOffsetSec !== null) {
            return wpSync.streamOffsetSec === 0 && !wpSync.isTranscodingStream;
        }
        var vd = Number(v.duration);
        if (!isFinite(vd) || vd <= 5) {
            return false;
        }
        var totalSec = getKnownTotalDurationSec(v);
        if (!totalSec || Math.abs(vd - totalSec) <= Math.max(25, totalSec * 0.06)) {
            return true;
        }
        return false;
    }

    function isTranscodedOrHlsStream(v) {
        if (wpSync.isTranscodingStream) {
            return true;
        }
        if (wpSync.streamOffsetSec !== null && wpSync.streamOffsetSec > 2) {
            return true;
        }
        var src = v ? String(v.currentSrc || v.src || '').toLowerCase() : '';
        if (src && (src.indexOf('.m3u8') !== -1 || src.indexOf('/videos/') !== -1 && src.indexOf('master.') !== -1 || src.indexOf('blob:') === 0)) {
            return true;
        }
        return !isDirectFullTimelineVideo(v);
    }

    function inferStreamOffsetSecIfNeeded(v, rawCur) {
        var curSrc = String(v.currentSrc || v.src || '');
        if (curSrc && wpSync.calibratedSrc && curSrc !== wpSync.calibratedSrc) {
            wpSync.streamOffsetSec = null;
            wpSync.calibratedSrc = '';
        }
        if (wpSync.streamOffsetSec !== null) {
            return wpSync.streamOffsetSec;
        }
        if (curSrc) {
            var m = curSrc.match(/[?&]StartTimeTicks=(\d+)/i);
            if (m && m[1]) {
                var startSec = parseInt(m[1], 10) / 10000000;
                if (isFinite(startSec) && startSec > 5 && rawCur < 20 && rawCur < startSec - 4) {
                    return startSec;
                }
            }
        }
        // Only inspect OSD clock when the OSD bottom bar is actively visible (Jellyfin freezes slider/clock DOM when OSD hides!)
        var visibleBottom = document.querySelector('#videoOsdPage:not(.hide) .videoOsdBottom:not(.hide)');
        if (visibleBottom) {
            var posEl = visibleBottom.querySelector('.osdPositionText');
            var clockSec = posEl ? parseOsdClockTextToSec(posEl.textContent) : null;
            if (clockSec !== null && Math.abs(clockSec - rawCur) > 12) {
                return Math.max(0, clockSec - rawCur);
            }
        }
        return 0;
    }

    function getEffectiveVideoPositionSec(v) {
        v = v || (osdState && osdState.video);
        if (!v) {
            return 0;
        }
        var rawCur = Math.max(0, Number(v.currentTime) || 0);
        var offset = inferStreamOffsetSecIfNeeded(v, rawCur);
        return Math.max(0, offset + rawCur);
    }

    function isWithinVideoSeekable(v, localSec) {
        if (!v || !isFinite(localSec) || localSec < 0) {
            return false;
        }
        try {
            var ranges = v.seekable;
            if (!ranges || !ranges.length) {
                return false;
            }
            for (var i = 0; i < ranges.length; i++) {
                var start = ranges.start(i);
                var end = ranges.end(i);
                if (localSec >= start - 0.5 && localSec <= end + 1.0 && (end - start > 25 || isDirectFullTimelineVideo(v))) {
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function seekEffectiveVideoToSec(v, targetSec, allowTranscodeRestart) {
        v = v || (osdState && osdState.video);
        if (!v) {
            return false;
        }
        var totalSec = getKnownTotalDurationSec(v);
        var clamped = Math.max(0, Number(targetSec) || 0);
        if (totalSec > 2 && clamped > totalSec - 0.5) {
            clamped = Math.max(0, totalSec - 0.5);
        }

        var isTranscode = isTranscodedOrHlsStream(v);
        var offset = inferStreamOffsetSecIfNeeded(v, Math.max(0, Number(v.currentTime) || 0));
        var localTarget = clamped - offset;

        // 1. Prefer direct HTMLMediaElement seek whenever target lies inside seekable buffer/timeline (zero FFmpeg restart!)
        if (localTarget >= 0 && (isDirectFullTimelineVideo(v) || isWithinVideoSeekable(v, localTarget))) {
            wpSync.lastProgrammaticSeekAtMs = Date.now();
            wpSync.lastProgrammaticSeekTargetSec = clamped;
            suppressLocalWatchPartyEvents(isTranscode ? 5500 : 3200);
            try {
                v.currentTime = localTarget;
                return true;
            } catch (eDirect) {}
        }

        // 2. Never restart server FFmpeg transcoding on routine background drift checks!
        if (allowTranscodeRestart === false) {
            return false;
        }

        var nowMs = Date.now();
        if (nowMs - wpSync.lastTranscodeSeekAtMs < 6000) {
            return false;
        }

        wpSync.lastTranscodeSeekAtMs = nowMs;
        wpSync.lastProgrammaticSeekAtMs = nowMs;
        wpSync.lastProgrammaticSeekTargetSec = clamped;
        suppressLocalWatchPartyEvents(8000);

        // 3. Try Jellyfin playbackManager.seek(ticks) first if exposed
        try {
            var pm = window.StreamFlixPlaybackManager || window.playbackManager;
            if (pm && typeof pm.seek === 'function') {
                pm.seek(Math.round(clamped * 10000000));
                if (wpSync.streamOffsetSec !== null && wpSync.streamOffsetSec > 0) {
                    wpSync.streamOffsetSec = clamped;
                }
                return true;
            }
        } catch (ePm) {}

        // 4. Fallback: single .osdPositionSlider 'change' event (never 'input' + 'change' double dispatch)
        var slider = document.querySelector('#videoOsdPage .osdPositionSlider');
        if (slider && totalSec > 5) {
            var pct = Math.min(99.95, Math.max(0, (clamped / totalSec) * 100));
            slider.__bfxWpProgrammatic = true;
            try {
                slider.value = String(pct.toFixed(3));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
                if (wpSync.streamOffsetSec !== null && wpSync.streamOffsetSec > 0) {
                    wpSync.streamOffsetSec = clamped;
                }
            } catch (eSlider) {
                try { v.currentTime = Math.max(0, localTarget); } catch (e2) {}
            } finally {
                setTimeout(function () {
                    slider.__bfxWpProgrammatic = false;
                }, 250);
            }
            return true;
        }

        return false;
    }

    function showWatchPartyOsdBanner(text) {
        if (!text || !isVideoPlayerActive() || !document.body) {
            return;
        }
        var banner = document.getElementById('bfx-wp-osd-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'bfx-wp-osd-banner';
            banner.setAttribute('role', 'status');
            banner.setAttribute('aria-live', 'polite');
            document.body.appendChild(banner);
        }
        banner.innerHTML = '<span class="bfx-wp-pulse-dot" aria-hidden="true"></span><span>' + escapeHtml(text) + '</span>';
        void banner.offsetWidth;
        banner.classList.add('is-visible');
        if (wpSync.bannerTimer) {
            clearTimeout(wpSync.bannerTimer);
        }
        wpSync.bannerTimer = setTimeout(function () {
            var el = document.getElementById('bfx-wp-osd-banner');
            if (el) {
                el.classList.remove('is-visible');
            }
        }, 2900);
    }

    function removeWatchPartyAutoplayUnlockPill() {
        wpSync.autoplayBlocked = false;
        var el = document.getElementById('bfx-wp-autoplay-unlock');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function showWatchPartyAutoplayUnlockPill() {
        if (!isVideoPlayerActive() || !document.body) {
            return;
        }
        wpSync.autoplayBlocked = true;
        var btn = document.getElementById('bfx-wp-autoplay-unlock');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'bfx-wp-autoplay-unlock';
            btn.innerHTML = icon('play') + '<span>Tap to Sync &amp; Play with Party</span>';
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                removeWatchPartyAutoplayUnlockPill();
                var v = osdState && osdState.video;
                if (v && watchPartyState.activeGroup) {
                    suppressLocalWatchPartyEvents(4000);
                    seekEffectiveVideoToSec(v, getAuthoritativeRoomPositionSec(), true);
                    if (watchPartyState.activeGroup.isPlaying) {
                        var pr = v.play();
                        if (pr && typeof pr.catch === 'function') {
                            pr.catch(function () {});
                        }
                    }
                }
            });
            document.body.appendChild(btn);
        }
    }

    function resetVideoPlaybackRate(v) {
        v = v || (osdState && osdState.video);
        if (v && isFinite(v.playbackRate) && v.playbackRate !== 1) {
            try { v.playbackRate = 1; } catch (e) {}
        }
    }

    function bindWatchPartyVisibilityWatcher() {
        if (wpSync.visibilityBound || typeof document === 'undefined') {
            return;
        }
        wpSync.visibilityBound = true;
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && watchPartyState.activeGroup && isWatchTogetherEnabled()) {
                suppressLocalWatchPartyEvents(2500);
                setTimeout(function () {
                    if (!document.hidden && watchPartyState.activeGroup) {
                        reconcilePlayerWithRoom(false);
                    }
                }, 900);
            }
        });
    }

    function reconcilePlayerWithRoom(forceHardSeek) {
        var room = watchPartyState.activeGroup;
        if (!room || !isWatchTogetherEnabled()) {
            resetVideoPlaybackRate();
            removeWatchPartyAutoplayUnlockPill();
            return;
        }

        // Never manipulate playback or auto-launch from a backgrounded mobile WebView / native ExoPlayer overlay
        if (document.hidden) {
            return;
        }

        // 1. One-shot auto-launch per (roomId + itemId) so slow HLS startup, native ExoPlayer, or pressing Back NEVER loops!
        var roomItemNorm = room.itemId ? normalizeGuid(room.itemId) : '';
        if (roomItemNorm && !isGateOpen()) {
            var curOsdNorm = (osdState && osdState.info && osdState.info.Id) ? normalizeGuid(osdState.info.Id) : '';
            var inPlayer = isVideoPlayerActive();
            var launchKey = room.roomId + ':' + roomItemNorm;

            if (inPlayer && curOsdNorm && curOsdNorm === roomItemNorm) {
                wpSync.autoLaunchedRoomItemKey = launchKey;
            } else if (!inPlayer || (curOsdNorm && curOsdNorm !== roomItemNorm)) {
                if (wpSync.autoLaunchedRoomItemKey !== launchKey) {
                    wpSync.autoLaunchedRoomItemKey = launchKey;
                    wpSync.lastAutoLaunchItemId = roomItemNorm;
                    wpSync.lastAutoLaunchAtMs = Date.now();
                    wpSync.followingItemId = roomItemNorm;
                    var startTicks = Math.max(0, Math.round(getAuthoritativeRoomPositionSec(room) * 10000000));
                    playItemImmediately(room.itemId, null, null, startTicks, { fromWatchPartyFollow: true });
                }
                return;
            }
        }

        // 2. Align <video> play/pause state & timeline calmly withoutplaybackRate jitter or buffering loops
        var v = osdState && osdState.video;
        if (!v || !isVideoPlayerActive() || v.readyState < 1) {
            return;
        }
        if (roomItemNorm && osdState.info && osdState.info.Id && normalizeGuid(osdState.info.Id) !== roomItemNorm) {
            return;
        }

        resetVideoPlaybackRate(v);

        var nowMs = Date.now();
        var isTranscode = isTranscodedOrHlsStream(v);
        var sinceAttachMs = nowMs - (wpSync.videoAttachedAtMs || 0);
        var sinceProgSeekMs = nowMs - (wpSync.lastProgrammaticSeekAtMs || 0);
        var expectedSec = getAuthoritativeRoomPositionSec(room);
        var actualSec = getEffectiveVideoPositionSec(v);
        var absDrift = Math.abs(actualSec - expectedSec);

        // Room is PAUSED
        if (!room.isPlaying) {
            removeWatchPartyAutoplayUnlockPill();
            if (!v.paused && !v.ended) {
                suppressLocalWatchPartyEvents(3000);
                try { v.pause(); } catch (ePause) {}
            }
            if (!v.seeking && !wpSync.isBuffering && sinceAttachMs > 2000 && sinceProgSeekMs > 4000) {
                if (forceHardSeek && absDrift > (isTranscode ? 3.5 : 1.5)) {
                    seekEffectiveVideoToSec(v, expectedSec, absDrift > 6.0);
                } else if (!forceHardSeek && !isTranscode && absDrift > 3.5) {
                    seekEffectiveVideoToSec(v, expectedSec, false);
                }
            }
            return;
        }

        // Room is PLAYING — start playback if paused (and not currently mid-seek)
        if (v.paused && !v.ended && !wpSync.autoplayBlocked && !v.seeking && sinceAttachMs > 900) {
            suppressLocalWatchPartyEvents(3200);
            try {
                var playPromise = v.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(function () {
                        showWatchPartyAutoplayUnlockPill();
                    });
                }
            } catch (ePlay) {
                showWatchPartyAutoplayUnlockPill();
            }
        }

        // Never interrupt a video element that is actively buffering or seeking!
        if (wpSync.isBuffering || v.seeking || v.readyState < 3) {
            if (forceHardSeek && !wpSync.hardSeekSettleTimer) {
                wpSync.hardSeekSettleTimer = setTimeout(function () {
                    wpSync.hardSeekSettleTimer = null;
                    if (watchPartyState.activeGroup && isVideoPlayerActive()) {
                        reconcilePlayerWithRoom(true);
                    }
                }, 1800);
            }
            return;
        }

        if (forceHardSeek) {
            if (sinceAttachMs < 2500) {
                if (!wpSync.hardSeekSettleTimer) {
                    wpSync.hardSeekSettleTimer = setTimeout(function () {
                        wpSync.hardSeekSettleTimer = null;
                        reconcilePlayerWithRoom(true);
                    }, 2200);
                }
                return;
            }
            if (sinceProgSeekMs < 2500 && Math.abs(expectedSec - wpSync.lastProgrammaticSeekTargetSec) < 3.0) {
                return;
            }
            if (absDrift > (isTranscode ? 4.0 : 1.8)) {
                seekEffectiveVideoToSec(v, expectedSec, true);
            }
            return;
        }

        // Periodic calm drift check: give mobile/transcode streams ample settle time and never restart FFmpeg for minor HLS latency
        var attachGraceMs = isTranscode ? 22000 : 12000;
        var seekGraceMs = isTranscode ? 20000 : 12000;
        if (sinceAttachMs < attachGraceMs || sinceProgSeekMs < seekGraceMs) {
            return;
        }

        var maxAllowedDriftSec = isTranscode ? 16.0 : 7.5;
        if (absDrift > maxAllowedDriftSec) {
            seekEffectiveVideoToSec(v, expectedSec, absDrift > 26.0);
        }
    }

    function applyIncomingRoomSnapshot(rawRoom, rttMs, opts) {
        var room = normalizeWatchPartyRoomSnapshot(rawRoom);
        if (!room || !room.roomId) {
            return null;
        }
        opts = opts || {};
        var prevVersion = wpSync.lastVersion || 0;
        var nextVersion = Number(room.version || 0);
        var versionChanged = !prevVersion || nextVersion !== prevVersion || Boolean(opts.forceReconcile);

        watchPartyState.activeGroup = room;
        setJoinedWatchPartyGroupId(room.roomId);
        wpSync.lastHalfRttSec = Math.min(1.0, Math.max(0, (Number(rttMs) || 0) / 2000));
        wpSync.snapshotPerfMs = performance.now();
        wpSync.lastVersion = nextVersion;

        if (room.itemId && wpSync.followingItemId && normalizeGuid(room.itemId) === wpSync.followingItemId && isVideoPlayerActive()) {
            wpSync.followingItemId = '';
        }

        var actionKey = String(room.version || '') + ':' + String(room.lastActionAtUtcMs || '');
        if (actionKey !== wpSync.lastActionShownKey) {
            var hadPrior = Boolean(wpSync.lastActionShownKey);
            wpSync.lastActionShownKey = actionKey;
            var isFromOther = room.lastActorParticipantId && room.lastActorParticipantId !== getMyWatchPartyParticipantId()
                && (!room.lastActionId || room.lastActionId !== wpSync.lastSentActionId);
            var isRecent = room.lastActionAtUtcMs && Math.abs((room.serverNowUtcMs || Date.now()) - room.lastActionAtUtcMs) < 8000;
            if (hadPrior && isFromOther && isRecent && room.lastActionText) {
                showWatchPartyOsdBanner(room.lastActionText);
            }
        }

        bindWatchPartyVisibilityWatcher();
        syncWatchPartyIndicators();
        ensureWatchPartyDriftTimer();
        ensureWatchPartyLongPollLoop();

        if (versionChanged) {
            var isOwnEcho = Boolean(room.lastActionId && room.lastActionId === wpSync.lastSentActionId);
            if (!isOwnEcho) {
                reconcilePlayerWithRoom(room.lastActionKind === 'seek' || room.lastActionKind === 'set_media');
            }
            if (typeof watchPartyState.onModalRoomUpdated === 'function') {
                try { watchPartyState.onModalRoomUpdated(room); } catch (eModal) {}
            }
        }
        return room;
    }

    function stopWatchPartySyncEngine() {
        wpSync.loopRunning = false;
        if (wpSync.abortCtrl) {
            try { wpSync.abortCtrl.abort(); } catch (e) {}
            wpSync.abortCtrl = null;
        }
        if (wpSync.driftTimer) {
            clearInterval(wpSync.driftTimer);
            wpSync.driftTimer = null;
        }
        if (wpSync.pauseVerifyTimer) {
            clearTimeout(wpSync.pauseVerifyTimer);
            wpSync.pauseVerifyTimer = null;
        }
        if (wpSync.seekDebounceTimer) {
            clearTimeout(wpSync.seekDebounceTimer);
            wpSync.seekDebounceTimer = null;
        }
        if (wpSync.hardSeekSettleTimer) {
            clearTimeout(wpSync.hardSeekSettleTimer);
            wpSync.hardSeekSettleTimer = null;
        }
        if (wpSync.startupAlignTimer) {
            clearTimeout(wpSync.startupAlignTimer);
            wpSync.startupAlignTimer = null;
        }
        wpSync.lastVersion = 0;
        wpSync.lastActionShownKey = '';
        wpSync.followingItemId = '';
        wpSync.autoLaunchedRoomItemKey = '';
        wpSync.lastAutoLaunchItemId = '';
        resetVideoPlaybackRate();
        removeWatchPartyAutoplayUnlockPill();
    }

    function ensureWatchPartyDriftTimer() {
        if (!watchPartyState.activeGroup) {
            if (wpSync.driftTimer) {
                clearInterval(wpSync.driftTimer);
                wpSync.driftTimer = null;
            }
            return;
        }
        if (wpSync.driftTimer) {
            return;
        }
        wpSync.driftTimer = setInterval(function () {
            if (!watchPartyState.activeGroup || !isWatchTogetherEnabled()) {
                stopWatchPartySyncEngine();
                return;
            }
            if (!document.hidden && !wpSync.isBuffering && isVideoPlayerActive()) {
                reconcilePlayerWithRoom(false);
            }
        }, 4000);
    }

    function detachEndedWatchPartyCleanly(notifyViewer) {
        var hadActive = Boolean(watchPartyState.activeGroup);
        setJoinedWatchPartyGroupId('');
        watchPartyState.activeGroup = null;
        stopWatchPartySyncEngine();
        syncWatchPartyIndicators();
        if (notifyViewer && hadActive) {
            if (isVideoPlayerActive()) {
                showWatchPartyOsdBanner('Watch Party ended.');
            } else if (typeof showToast === 'function') {
                showToast('Watch Party ended.', 'info');
            }
        }
        if (typeof watchPartyState.onModalRoomUpdated === 'function') {
            if (typeof refreshWatchPartyRoomsList === 'function') {
                refreshWatchPartyRoomsList(true).then(function () {
                    try {
                        if (typeof watchPartyState.onModalRoomUpdated === 'function') {
                            watchPartyState.onModalRoomUpdated(null);
                        }
                    } catch (eM) {}
                });
            } else {
                try { watchPartyState.onModalRoomUpdated(null); } catch (eM2) {}
            }
        }
    }

    function ensureWatchPartyLongPollLoop() {
        if (wpSync.loopRunning || !watchPartyState.joinedGroupId || !isWatchTogetherEnabled()) {
            return;
        }
        wpSync.loopRunning = true;

        function step(backoffMs) {
            if (!wpSync.loopRunning || !watchPartyState.joinedGroupId || !isWatchTogetherEnabled()) {
                wpSync.loopRunning = false;
                return;
            }
            var waitBefore = Math.max(0, Number(backoffMs) || 0);
            setTimeout(function () {
                if (!wpSync.loopRunning || !watchPartyState.joinedGroupId) {
                    wpSync.loopRunning = false;
                    return;
                }
                var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
                wpSync.abortCtrl = ctrl;
                var roomId = watchPartyState.joinedGroupId;
                var pid = getMyWatchPartyParticipantId();
                var profId = (state.activeProfile && state.activeProfile.id) || '';
                var sinceVer = wpSync.lastVersion || 0;
                var waitMs = document.hidden ? 12000 : 10000;
                var qs = '?roomId=' + encodeURIComponent(roomId)
                    + '&participantId=' + encodeURIComponent(pid)
                    + '&profileId=' + encodeURIComponent(profId)
                    + '&sinceVersion=' + encodeURIComponent(String(sinceVer))
                    + '&waitMs=' + (sinceVer > 0 ? waitMs : 0);

                if (!document.hidden && isVideoPlayerActive() && osdState && osdState.video) {
                    qs += '&pos=' + encodeURIComponent(getEffectiveVideoPositionSec(osdState.video).toFixed(2));
                    qs += '&buffering=' + (wpSync.isBuffering ? 'true' : 'false');
                }

                var t0 = Date.now();
                apiFetch('/StreamFlix/WatchParty/State' + qs, ctrl ? { signal: ctrl.signal } : {})
                    .then(function (res) {
                        var rtt = Date.now() - t0;
                        if (!wpSync.loopRunning || watchPartyState.joinedGroupId !== roomId) {
                            return;
                        }
                        var incomingRoom = res && (res.room || res.Room);
                        if (!res || res.active === false || res.Active === false || !incomingRoom) {
                            detachEndedWatchPartyCleanly(true);
                            return;
                        }
                        applyIncomingRoomSnapshot(incomingRoom, rtt);
                        step(document.hidden ? 1500 : 650);
                    })
                    .catch(function (err) {
                        if (!wpSync.loopRunning) {
                            return;
                        }
                        if (err && err.name === 'AbortError') {
                            return;
                        }
                        if (err && (err.status === 403 || err.status === 404)) {
                            detachEndedWatchPartyCleanly(true);
                            return;
                        }
                        step(2500);
                    });
            }, waitBefore);
        }

        step(0);
    }

    function sendWatchPartyCommand(action, extraPayload) {
        var room = watchPartyState.activeGroup;
        if (!room || !room.roomId || !isWatchTogetherEnabled()) {
            return Promise.resolve(null);
        }
        extraPayload = extraPayload || {};

        var nowMs = Date.now();
        if ((action === 'play' || action === 'pause' || action === 'seek')
            && wpSync.lastCommandKind === action
            && (nowMs - wpSync.lastCommandSentAtMs < 450)) {
            return Promise.resolve(room);
        }
        wpSync.lastCommandKind = action;
        wpSync.lastCommandSentAtMs = nowMs;

        var prof = state.activeProfile || {};
        var body = {
            roomId: room.roomId,
            participantId: getMyWatchPartyParticipantId(),
            profileId: prof.id || '',
            displayName: prof.name || '',
            avatarEmoji: prof.icon || '🎬',
            avatarColorHex: prof.color || '#E50914',
            action: action,
            actionId: nextWatchPartyActionId()
        };
        if (extraPayload.positionSeconds !== undefined && extraPayload.positionSeconds !== null) {
            body.positionSeconds = Math.max(0, Number(extraPayload.positionSeconds) || 0);
        }
        if (typeof extraPayload.isPlaying === 'boolean') {
            body.isPlaying = extraPayload.isPlaying;
        }
        if (typeof extraPayload.hostControlOnly === 'boolean') {
            body.hostControlOnly = extraPayload.hostControlOnly;
        }
        if (typeof extraPayload.isBuffering === 'boolean') {
            body.isBuffering = extraPayload.isBuffering;
        }
        var it = extraPayload.item;
        if (it && it.Id) {
            body.itemId = it.Id;
            body.itemName = it.Name || '';
            body.seriesName = it.SeriesName || '';
            if (it.ParentIndexNumber != null) {
                body.seasonNumber = Number(it.ParentIndexNumber);
            }
            if (it.IndexNumber != null) {
                body.episodeNumber = Number(it.IndexNumber);
            }
            body.itemType = it.Type || '';
            if (it.RunTimeTicks && Number(it.RunTimeTicks) > 0) {
                body.runTimeTicks = Number(it.RunTimeTicks);
            }
        }

        var t0 = Date.now();
        return apiFetch('/StreamFlix/WatchParty/Command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (res) {
            var cmdRoom = res && (res.room || res.Room);
            if (cmdRoom) {
                return applyIncomingRoomSnapshot(cmdRoom, Date.now() - t0);
            }
            return null;
        }).catch(function (err) {
            var errRoom = err && err.data && (err.data.room || err.data.Room);
            if (err && err.status === 404) {
                detachEndedWatchPartyCleanly(true);
                return null;
            }
            if (err && err.status === 403 && errRoom) {
                applyIncomingRoomSnapshot(errRoom, 0, { forceReconcile: true });
                showWatchPartyOsdBanner(err.message || 'Controls are locked to the host.');
            }
            return null;
        });
    }

    /* Passive calibration from Jellyfin's own /Sessions/Playing & /Sessions/Playing/Progress reports */
    function onWatchPartyNativeProgressReport(payload, urlLower) {
        if (!payload || typeof payload !== 'object') {
            return;
        }
        if (urlLower && urlLower.indexOf('/sessions/playing/stopped') !== -1) {
            wpSync.streamOffsetSec = null;
            wpSync.calibratedSrc = '';
            wpSync.isTranscodingStream = false;
            return;
        }
        wpSync.lastNativeProgressAtMs = Date.now();
        if (typeof payload.PlayMethod === 'string' && payload.PlayMethod) {
            wpSync.isTranscodingStream = payload.PlayMethod.toLowerCase() === 'transcode';
        }
        var v = osdState && osdState.video;
        if (!v || !isVideoPlayerActive() || v.seeking || payload.PositionTicks == null) {
            return;
        }
        if (Date.now() - wpSync.lastProgrammaticSeekAtMs < 2200) {
            return;
        }
        if (payload.ItemId && osdState.info && osdState.info.Id && normalizeGuid(payload.ItemId) !== normalizeGuid(osdState.info.Id)) {
            return;
        }
        var repSec = Math.max(0, Number(payload.PositionTicks) / 10000000);
        var rawCur = Math.max(0, Number(v.currentTime) || 0);
        if (isFinite(repSec)) {
            wpSync.streamOffsetSec = Math.abs(repSec - rawCur) < 3.0 ? 0 : Math.max(0, repSec - rawCur);
            wpSync.calibratedSrc = String(v.currentSrc || v.src || '');
        }
    }

    function onWatchPartyUserPlayerGesture() {
        wpSync.lastUserGestureAtMs = Date.now();
    }

    /* Hooks invoked by 08-cinema-hub-and-hero.js and 07-video-player-and-mobile-dock.js */
    function onWatchPartyBeforePlayResolved(playableItem, forcedStartPositionTicks, playOpts) {
        var room = watchPartyState.activeGroup;
        if (!room || !isWatchTogetherEnabled() || !playableItem || !playableItem.Id) {
            return forcedStartPositionTicks;
        }

        var playNorm = normalizeGuid(playableItem.Id);
        markWatchPartyRoomItemAutoLaunched(room.roomId, playNorm);

        if (playOpts && playOpts.fromWatchPartyFollow) {
            return forcedStartPositionTicks;
        }

        var roomNorm = room.itemId ? normalizeGuid(room.itemId) : '';
        var hasExplicitStart = typeof forcedStartPositionTicks === 'number' && isFinite(forcedStartPositionTicks) && forcedStartPositionTicks >= 0;

        if (roomNorm && playNorm === roomNorm && !hasExplicitStart) {
            wpSync.followingItemId = roomNorm;
            return Math.max(0, Math.round(getAuthoritativeRoomPositionSec(room) * 10000000));
        }

        if (canControlWatchPartyRoom(room)) {
            var chosenTicks = hasExplicitStart ? Math.floor(forcedStartPositionTicks) : 0;
            wpSync.followingItemId = playNorm;
            sendWatchPartyCommand('set_media', {
                item: playableItem,
                positionSeconds: chosenTicks / 10000000,
                isPlaying: true
            });
            return chosenTicks;
        }

        return forcedStartPositionTicks;
    }

    function onWatchPartyOsdInfoLoaded(item) {
        var room = watchPartyState.activeGroup;
        if (!room || !isWatchTogetherEnabled() || !item || !item.Id) {
            return;
        }
        var itemNorm = normalizeGuid(item.Id);
        var roomNorm = room.itemId ? normalizeGuid(room.itemId) : '';

        if (roomNorm && itemNorm === roomNorm) {
            wpSync.followingItemId = '';
            markWatchPartyRoomItemAutoLaunched(room.roomId, itemNorm);
            // Gentle check only — never force a transcode restart right as OSD metadata loads!
            reconcilePlayerWithRoom(false);
            return;
        }

        if (!roomNorm && canControlWatchPartyRoom(room)) {
            markWatchPartyRoomItemAutoLaunched(room.roomId, itemNorm);
            var v = osdState && osdState.video;
            sendWatchPartyCommand('set_media', {
                item: item,
                positionSeconds: v ? getEffectiveVideoPositionSec(v) : 0,
                isPlaying: v ? !v.paused : true
            });
            return;
        }

        if (roomNorm && itemNorm !== roomNorm) {
            if (wpSync.followingItemId === roomNorm) {
                return;
            }
            if (canControlWatchPartyRoom(room) && (Date.now() - wpSync.joinedAtMs > 4500)) {
                markWatchPartyRoomItemAutoLaunched(room.roomId, itemNorm);
                var vNow = osdState && osdState.video;
                sendWatchPartyCommand('set_media', {
                    item: item,
                    positionSeconds: vNow ? getEffectiveVideoPositionSec(vNow) : 0,
                    isPlaying: true
                });
            } else {
                reconcilePlayerWithRoom(false);
            }
        }
    }

    function onWatchPartySliderScrub(slider) {
        var room = watchPartyState.activeGroup;
        if (!room || !isWatchTogetherEnabled() || isLocalWatchPartySuppressed()) {
            return;
        }
        wpSync.lastUserGestureAtMs = Date.now();
        var v = osdState && osdState.video;
        var totalSec = getKnownTotalDurationSec(v);
        var pct = slider ? parseFloat(slider.value) : NaN;
        if (!isFinite(pct) || totalSec <= 0) {
            return;
        }
        var targetSec = Math.max(0, (pct / 100) * totalSec);
        if (!canControlWatchPartyRoom(room)) {
            reconcilePlayerWithRoom(true);
            showWatchPartyOsdBanner('Controls are locked to ' + (room.hostName || 'the host') + '.');
            return;
        }
        if (wpSync.seekDebounceTimer) {
            clearTimeout(wpSync.seekDebounceTimer);
        }
        wpSync.seekDebounceTimer = setTimeout(function () {
            wpSync.seekDebounceTimer = null;
            suppressLocalWatchPartyEvents(4500);
            sendWatchPartyCommand('seek', {
                positionSeconds: targetSec,
                isPlaying: v ? !v.paused : room.isPlaying
            });
        }, 320);
    }

    function onWatchPartyVideoEvent(evName, v) {
        var room = watchPartyState.activeGroup;
        if (!room || !isWatchTogetherEnabled() || !v) {
            return;
        }

        if (evName === 'waiting') {
            wpSync.isBuffering = true;
            return;
        }
        if (evName === 'playing') {
            wpSync.isBuffering = false;
            removeWatchPartyAutoplayUnlockPill();
            return;
        }
        if (evName === 'attached' || evName === 'loadstart') {
            wpSync.videoAttachedAtMs = Date.now();
            wpSync.isBuffering = false;
            wpSync.streamOffsetSec = null;
            wpSync.calibratedSrc = '';
            suppressLocalWatchPartyEvents(4500);
            resetVideoPlaybackRate(v);
            return;
        }
        if (evName === 'loadedmetadata') {
            resetVideoPlaybackRate(v);
            return;
        }
        if (evName === 'canplay') {
            wpSync.isBuffering = false;
            if (wpSync.startupAlignTimer) {
                clearTimeout(wpSync.startupAlignTimer);
            }
            wpSync.startupAlignTimer = setTimeout(function () {
                wpSync.startupAlignTimer = null;
                if (!watchPartyState.activeGroup || !isVideoPlayerActive() || wpSync.isBuffering) {
                    return;
                }
                if (!watchPartyState.activeGroup.isPlaying) {
                    reconcilePlayerWithRoom(false);
                }
            }, 1800);
            return;
        }

        if (document.hidden || isLocalWatchPartySuppressed()) {
            return;
        }

        if (evName === 'play') {
            removeWatchPartyAutoplayUnlockPill();
            if (wpSync.pauseVerifyTimer) {
                clearTimeout(wpSync.pauseVerifyTimer);
                wpSync.pauseVerifyTimer = null;
            }
            if (!canControlWatchPartyRoom(room) && !room.isPlaying) {
                reconcilePlayerWithRoom(false);
                showWatchPartyOsdBanner('Controls are locked to ' + (room.hostName || 'the host') + '.');
                return;
            }
            // Only broadcast 'play' when the room was actually paused!
            // Never broadcast 'play' when room.isPlaying is already true (otherwise buffering recovery yanks the room backward).
            if (!room.isPlaying) {
                sendWatchPartyCommand('play', {
                    positionSeconds: getEffectiveVideoPositionSec(v),
                    isPlaying: true
                });
            }
            return;
        }

        if (evName === 'pause') {
            if (v.ended || v.seeking || wpSync.isBuffering || wpSync.autoplayBlocked) {
                return;
            }
            var nowPauseMs = Date.now();
            if (nowPauseMs - wpSync.videoAttachedAtMs < 4000 || nowPauseMs - wpSync.lastProgrammaticSeekAtMs < 5500) {
                return;
            }
            if (wpSync.pauseVerifyTimer) {
                clearTimeout(wpSync.pauseVerifyTimer);
            }
            wpSync.pauseVerifyTimer = setTimeout(function () {
                wpSync.pauseVerifyTimer = null;
                if (document.hidden || !watchPartyState.activeGroup || !isVideoPlayerActive() || osdState.video !== v) {
                    return;
                }
                if (!v.paused || v.ended || v.seeking || wpSync.isBuffering || v.readyState < 2 || wpSync.autoplayBlocked || isLocalWatchPartySuppressed()) {
                    return;
                }
                if (!canControlWatchPartyRoom(watchPartyState.activeGroup)) {
                    if (watchPartyState.activeGroup.isPlaying) {
                        reconcilePlayerWithRoom(false);
                        showWatchPartyOsdBanner('Controls are locked to ' + (watchPartyState.activeGroup.hostName || 'the host') + '.');
                    }
                    return;
                }
                if (watchPartyState.activeGroup.isPlaying) {
                    sendWatchPartyCommand('pause', {
                        positionSeconds: getEffectiveVideoPositionSec(v),
                        isPlaying: false
                    });
                }
            }, 450);
            return;
        }

        if (evName === 'seeked') {
            if (wpSync.pauseVerifyTimer) {
                clearTimeout(wpSync.pauseVerifyTimer);
                wpSync.pauseVerifyTimer = null;
            }
            var nowSeekMs = Date.now();
            var seekPos = getEffectiveVideoPositionSec(v);

            // Ignore delayed HLS/mobile keyframe-snap 'seeked' events following startup or programmatic seeks
            if (nowSeekMs - wpSync.videoAttachedAtMs < 6000) {
                return;
            }
            if (nowSeekMs - wpSync.lastProgrammaticSeekAtMs < 12000
                && wpSync.lastProgrammaticSeekTargetSec >= 0
                && Math.abs(seekPos - wpSync.lastProgrammaticSeekTargetSec) < 7.0) {
                return;
            }
            // Require a recent human interaction in the player so automatic decoder/HLS buffer seeks never ping-pong
            if (nowSeekMs - wpSync.lastUserGestureAtMs > 4500) {
                return;
            }
            if (Math.abs(seekPos - getAuthoritativeRoomPositionSec(room)) < 3.0) {
                return;
            }
            if (!canControlWatchPartyRoom(room)) {
                reconcilePlayerWithRoom(true);
                showWatchPartyOsdBanner('Controls are locked to ' + (room.hostName || 'the host') + '.');
                return;
            }
            if (wpSync.seekDebounceTimer) {
                clearTimeout(wpSync.seekDebounceTimer);
            }
            wpSync.seekDebounceTimer = setTimeout(function () {
                wpSync.seekDebounceTimer = null;
                sendWatchPartyCommand('seek', {
                    positionSeconds: getEffectiveVideoPositionSec(v),
                    isPlaying: !v.paused
                });
            }, 320);
        }
    }

    function onWatchPartyOsdTeardown() {
        wpSync.isBuffering = false;
        wpSync.streamOffsetSec = null;
        wpSync.calibratedSrc = '';
        wpSync.isTranscodingStream = false;
        if (wpSync.pauseVerifyTimer) {
            clearTimeout(wpSync.pauseVerifyTimer);
            wpSync.pauseVerifyTimer = null;
        }
        if (wpSync.startupAlignTimer) {
            clearTimeout(wpSync.startupAlignTimer);
            wpSync.startupAlignTimer = null;
        }
        removeWatchPartyAutoplayUnlockPill();
        var banner = document.getElementById('bfx-wp-osd-banner');
        if (banner && banner.parentNode) {
            banner.parentNode.removeChild(banner);
        }
    }
