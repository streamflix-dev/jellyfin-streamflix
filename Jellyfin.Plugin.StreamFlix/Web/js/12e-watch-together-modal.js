/* StreamFlix Client (12e) — Watch Together Interactive Modal */
    function openWatchTogetherModal(opts) {
        opts = opts || {};
        if (!isWatchTogetherEnabled()) {
            return;
        }

        var inPlayerNow = isVideoPlayerActive();
        var rawContextItem = opts.item || (inPlayerNow && osdState && osdState.info ? osdState.info : null) || watchPartyState.targetItem || null;
        var resolvedPlayable = opts.playableTarget || rawContextItem || null;
        if (rawContextItem && rawContextItem.Id) {
            watchPartyState.targetItem = rawContextItem;
        }

        var defaultRoomName = ((state.activeProfile && state.activeProfile.name) || 'StreamFlix') + '\'s Watch Party';
        var selectedStartMode = inPlayerNow ? 'live' : 'beginning';
        var hostLockCreate = false;
        var draftJoinValue = '';
        var guestInvitePass = null;
        var liveClockTimer = null;

        var m = openModal('<div id="bfx-wp-modal-root" class="bfx-wp-root"><div class="bfx-wp-loading"><div class="streamflix-spinner-ring"></div><span>Loading Watch Together…</span></div></div>', {
            className: 'streamflix-modal-wide bfx-wp-modal',
            onClose: function () {
                if (liveClockTimer) {
                    clearInterval(liveClockTimer);
                    liveClockTimer = null;
                }
                if (watchPartyState.onModalRoomUpdated === onLiveRoomPush) {
                    watchPartyState.onModalRoomUpdated = null;
                }
            }
        });
        var rootEl = m.modal.querySelector('#bfx-wp-modal-root');

        var canPhoneShare = typeof canUsePhoneNativeShare === 'function' && canUsePhoneNativeShare();
        var isGuest = isGuestPassSession();
        var isAdmin = !isGuest && (typeof isActiveProfileAdmin === 'function' ? isActiveProfileAdmin() : Boolean(state.activeProfile && state.activeProfile.isAdmin));
        var canCreateGuestCombo = !isGuest && (typeof canActiveProfileManageGuestPasses === 'function' ? canActiveProfileManageGuestPasses() : (isAdmin && areGuestPassesEnabled()));

        function getEligibleGuestProfiles() {
            return getProfiles().filter(function (p) {
                return !p.isAdmin && !p.isOwner && !p.isKids;
            });
        }

        function getPersonalResumeSec(itemObj) {
            if (!itemObj || !itemObj.UserData || !itemObj.UserData.PlaybackPositionTicks) {
                return 0;
            }
            var sec = Number(itemObj.UserData.PlaybackPositionTicks) / 10000000;
            return (isFinite(sec) && sec >= 45) ? Math.floor(sec) : 0;
        }

        function computeChosenStartSec() {
            if (inPlayerNow && osdState && osdState.video && resolvedPlayable && osdState.info && normalizeGuid(resolvedPlayable.Id) === normalizeGuid(osdState.info.Id)) {
                return getEffectiveVideoPositionSec(osdState.video);
            }
            if (selectedStartMode === 'resume') {
                return getPersonalResumeSec(resolvedPlayable);
            }
            return 0;
        }

        function captureDraftInputs() {
            if (!rootEl) {
                return;
            }
            var nameField = rootEl.querySelector('#bfx-wp-room-input');
            if (nameField && typeof nameField.value === 'string') {
                var trimmed = nameField.value.trim();
                if (trimmed) {
                    defaultRoomName = trimmed;
                }
            }
            var joinField = rootEl.querySelector('#bfx-wp-code-join-input');
            if (joinField && typeof joinField.value === 'string') {
                draftJoinValue = joinField.value;
            }
        }

        function syncJoinInputVisualMode(inputEl) {
            if (!inputEl) {
                return;
            }
            var val = String(inputEl.value || '').trim();
            var looksLikeUrl = val.indexOf('/') !== -1 || val.indexOf(':') !== -1 || val.indexOf('?') !== -1;
            inputEl.classList.toggle('is-code-mode', Boolean(val.length > 0 && !looksLikeUrl));
        }

        function onLiveRoomPush() {
            if (!rootEl || !m.modal.parentNode) {
                return;
            }
            var focused = document.activeElement;
            if (focused && rootEl.contains(focused) && focused.tagName === 'INPUT' && !focused.readOnly) {
                return;
            }
            captureDraftInputs();
            renderModalBody();
        }
        watchPartyState.onModalRoomUpdated = onLiveRoomPush;

        function startLiveClockTicker() {
            if (liveClockTimer) {
                clearInterval(liveClockTimer);
                liveClockTimer = null;
            }
            liveClockTimer = setInterval(function () {
                if (!rootEl || !m.modal.parentNode) {
                    clearInterval(liveClockTimer);
                    liveClockTimer = null;
                    return;
                }
                var clockEl = rootEl.querySelector('#bfx-wp-live-pos-label');
                var room = watchPartyState.activeGroup;
                if (clockEl && room && room.itemId) {
                    var statusWord = room.isPlaying ? 'Playing' : 'Paused';
                    clockEl.textContent = statusWord + ' · ' + formatWatchPartyClock(getAuthoritativeRoomPositionSec(room));
                }
            }, 1000);
        }

        function renderModalBody() {
            if (!rootEl || !m.modal.parentNode) {
                return;
            }
            var activeRoom = normalizeWatchPartyRoomSnapshot(watchPartyState.activeGroup);
            if (activeRoom) {
                watchPartyState.activeGroup = activeRoom;
            }
            m.modal.classList.toggle('is-wp-live', Boolean(activeRoom));

            var rooms = normalizeWatchPartyRoomsArray(watchPartyState.groups);
            var targetTitle = formatWatchPartyMediaLabel(resolvedPlayable || rawContextItem);
            var resumeSec = (!inPlayerNow && resolvedPlayable) ? getPersonalResumeSec(resolvedPlayable) : 0;

            var startPosHtml = '';
            if (resolvedPlayable && resolvedPlayable.Id && resumeSec > 0 && !inPlayerNow) {
                startPosHtml = ''
                    + '<div class="bfx-wp-seg-group">'
                    + '  <span class="bfx-wp-field-label">Start Position for Everyone</span>'
                    + '  <div class="bfx-wp-seg-track" role="group" aria-label="Start position">'
                    + '    <button type="button" class="bfx-wp-seg-btn' + (selectedStartMode !== 'resume' ? ' is-active' : '') + '" data-wp-startmode="beginning">' + icon('clock') + '<span>From Beginning (0:00)</span></button>'
                    + '    <button type="button" class="bfx-wp-seg-btn' + (selectedStartMode === 'resume' ? ' is-active' : '') + '" data-wp-startmode="resume">' + icon('play') + '<span>My Resume (' + escapeHtml(formatWatchPartyClock(resumeSec)) + ')</span></button>'
                    + '  </div>'
                    + '</div>';
            }

            var targetBannerHtml = targetTitle
                ? (''
                    + '<div class="bfx-wp-target-banner">'
                    + '  <span class="bfx-wp-target-ico">' + icon('film') + '</span>'
                    + '  <div class="bfx-wp-target-copy">'
                    + '    <span class="bfx-wp-target-kicker">' + (inPlayerNow ? 'Currently open in player' : 'Ready to watch together') + '</span>'
                    + '    <strong>' + escapeHtml(targetTitle) + '</strong>'
                    + '  </div>'
                    + '</div>')
                : '';

            var connectedCount = activeRoom ? getActiveWatchPartyParticipantCount() : 0;
            var headerKickerHtml = activeRoom
                ? ('<span class="bfx-wp-head-kicker is-live"><span class="bfx-wp-pulse-dot" aria-hidden="true"></span><span>LIVE ROOM · ' + connectedCount + ' CONNECTED</span></span>')
                : '<span class="bfx-wp-head-kicker">SYNCED CINEMA</span>';

            var html = ''
                + '<div class="bfx-wp-header">'
                + '  <div class="bfx-wp-title-wrap">'
                + '    <span class="bfx-wp-hero-ico' + (activeRoom ? ' is-live' : '') + '">' + icon('party') + '</span>'
                + '    <div class="bfx-wp-title-copy">'
                + headerKickerHtml
                + '      <h2 class="bfx-wp-main-title">Watch Together</h2>'
                + '      <p class="bfx-wp-main-sub">Real-time synced play, pause, seek &amp; episode transitions.</p>'
                + '    </div>'
                + '  </div>'
                + '  <div class="bfx-wp-header-actions">'
                + '    <button type="button" class="streamflix-ghost-btn bfx-wp-icon-btn" id="bfx-wp-refresh-btn" title="Refresh rooms" aria-label="Refresh rooms">' + icon('refresh') + '</button>'
                + '    <button type="button" class="streamflix-ghost-btn bfx-wp-icon-btn" id="bfx-wp-close-btn" title="Close" aria-label="Close">' + icon('close') + '</button>'
                + '  </div>'
                + '</div>';

            if (activeRoom) {
                var participants = Array.isArray(activeRoom.participants) && activeRoom.participants.length
                    ? activeRoom.participants
                    : [{
                        participantId: getMyWatchPartyParticipantId(),
                        displayName: (state.activeProfile && state.activeProfile.name) || 'You',
                        avatarEmoji: (state.activeProfile && state.activeProfile.icon) || '🎬',
                        avatarColorHex: (state.activeProfile && state.activeProfile.color) || '#E50914',
                        isHost: true
                    }];
                var isMyHost = activeRoom.hostParticipantId === getMyWatchPartyParticipantId() || isMyWatchPartyHostProfile(activeRoom) || isAdmin;
                var canControl = canControlWatchPartyRoom(activeRoom);
                var canDeleteActive = canDeleteWatchPartyRoom(activeRoom);
                var inviteUrl = buildWatchPartyInviteUrl(activeRoom.roomId);
                var roomMediaLabel = formatWatchPartyMediaLabel(activeRoom);
                var livePosSec = getAuthoritativeRoomPositionSec(activeRoom);
                var hasDifferentTarget = Boolean(
                    resolvedPlayable && resolvedPlayable.Id
                    && (!activeRoom.itemId || normalizeGuid(resolvedPlayable.Id) !== normalizeGuid(activeRoom.itemId))
                );

                var partChipsHtml = participants.map(function (p) {
                    var pName = String(p.displayName || 'Viewer');
                    var emoji = String(p.avatarEmoji || '🎬');
                    var bg = String(p.avatarColorHex || '#10b981');
                    return '<span class="bfx-wp-member-chip">'
                        + '<span class="bfx-wp-member-av has-emoji" style="background:' + escapeHtml(bg) + ';">' + escapeHtml(emoji) + '</span>'
                        + '<span class="bfx-wp-member-name">' + escapeHtml(pName) + '</span>'
                        + (p.isHost ? '<span class="bfx-wp-member-tag is-host">Host</span>' : '')
                        + (p.isBuffering ? '<span class="bfx-wp-member-tag is-buffering">Syncing</span>' : '')
                        + '</span>';
                }).join('');

                var nowPlayingCardHtml = activeRoom.itemId
                    ? (''
                        + '<div class="bfx-wp-nowplaying-card">'
                        + '  <div class="bfx-wp-nowplaying-meta">'
                        + '    <span class="bfx-wp-nowplaying-kicker"><span class="bfx-wp-pulse-dot" aria-hidden="true"></span><span id="bfx-wp-live-pos-label">' + (activeRoom.isPlaying ? 'Playing' : 'Paused') + ' · ' + escapeHtml(formatWatchPartyClock(livePosSec)) + '</span></span>'
                        + '    <span class="bfx-wp-nowplaying-title">' + escapeHtml(roomMediaLabel || 'Synced Stream') + '</span>'
                        + '  </div>'
                        + '  <div class="bfx-wp-nowplaying-actions">'
                        + (inPlayerNow && osdState && osdState.info && normalizeGuid(osdState.info.Id) === normalizeGuid(activeRoom.itemId)
                            ? '<button type="button" class="streamflix-ghost-btn bfx-wp-action-pill" id="bfx-wp-resync-now-btn">' + iconLabel('refresh', 'Sync Now') + '</button>'
                            : '<button type="button" class="streamflix-btn-primary bfx-wp-action-pill" id="bfx-wp-watch-room-btn">' + iconLabel('play', 'Join Stream') + '</button>')
                        + '  </div>'
                        + '</div>')
                    : (''
                        + '<div class="bfx-wp-lobby-ready">'
                        + '  <div class="bfx-wp-lobby-ready-copy">'
                        + '    <strong>Lobby is live &amp; ready</strong>'
                        + '    <span>Share the room code or link below, then hit Play on any movie or show — everyone launches in sync at 0:00.</span>'
                        + '  </div>'
                        + (!hasDifferentTarget && !inPlayerNow
                            ? '  <button type="button" class="streamflix-ghost-btn bfx-wp-action-pill" id="bfx-wp-browse-hub-btn">' + iconLabel('film', 'Browse Titles') + '</button>'
                            : '')
                        + '</div>');

                var switchTargetHtml = (hasDifferentTarget && canControl)
                    ? ('<div class="bfx-wp-switch-box">'
                        + targetBannerHtml
                        + startPosHtml
                        + '<button type="button" class="bfx-wp-cta-primary" id="bfx-wp-play-selected-btn">'
                        + iconLabel('play', activeRoom.itemId ? 'Switch Party to This Title' : 'Start Playing Together')
                        + '</button>'
                        + '</div>')
                    : '';

                var guestComboHtml = '';
                if (canCreateGuestCombo) {
                    var guestProfiles = getEligibleGuestProfiles();
                    if (guestInvitePass && guestInvitePass.comboUrl) {
                        guestComboHtml = ''
                            + '<div class="bfx-wp-guest-card is-ready">'
                            + '  <div class="bfx-wp-guest-info">'
                            + '    <span class="bfx-wp-kicker">' + icon('ticket') + '<span>6-Hour Guest Pass + Watch Party Link</span></span>'
                            + '    <div class="bfx-wp-invite-row" style="margin-top:8px;">'
                            + '      <input type="text" class="streamflix-input bfx-wp-link-input" id="bfx-wp-guest-url-input" readonly value="' + escapeHtml(guestInvitePass.comboUrl) + '" />'
                            + '      <button type="button" class="streamflix-btn-primary bfx-wp-inline-btn" id="bfx-wp-copy-guest-btn">' + iconLabel('copy', 'Copy') + '</button>'
                            + (canPhoneShare ? '      <button type="button" class="streamflix-ghost-btn bfx-wp-inline-btn" id="bfx-wp-share-guest-btn">' + iconLabel('share', 'Share') + '</button>' : '')
                            + '    </div>'
                            + '    <div class="streamflix-field-hint" style="margin-top:6px;">Friends without an account sign in as <strong>' + escapeHtml(guestInvitePass.profileName || 'Guest') + '</strong> and jump straight into sync.</div>'
                            + '  </div>'
                            + '</div>';
                    } else if (guestProfiles.length > 0) {
                        var profOpts = guestProfiles.map(function (gp) {
                            return '<option value="' + escapeHtml(gp.id) + '">' + escapeHtml((gp.icon ? gp.icon + ' ' : '') + gp.name) + '</option>';
                        }).join('');
                        guestComboHtml = ''
                            + '<div class="bfx-wp-guest-card">'
                            + '  <div class="bfx-wp-guest-row">'
                            + '    <div class="bfx-wp-guest-copy">'
                            + '      <div class="bfx-wp-guest-title">' + icon('ticket') + '<span>Inviting a friend without an account?</span></div>'
                            + '      <div class="streamflix-field-hint">Generate a 6-hour Guest Pass that drops them right into this party.</div>'
                            + '    </div>'
                            + '    <div class="bfx-wp-guest-controls">'
                            + (guestProfiles.length > 1 ? '<select id="bfx-wp-guest-prof-sel" class="streamflix-select bfx-wp-guest-select" aria-label="Guest profile">' + profOpts + '</select>' : '')
                            + '      <button type="button" class="streamflix-ghost-btn bfx-wp-action-pill" id="bfx-wp-make-guest-btn">' + iconLabel('plus', 'Guest Link') + '</button>'
                            + '    </div>'
                            + '  </div>'
                            + '</div>';
                    }
                }

                html += ''
                    + '<div class="bfx-wp-active-card">'
                    + '  <div class="bfx-wp-active-top">'
                    + '    <div class="bfx-wp-active-heading">'
                    + '      <h3 class="bfx-wp-room-name">' + escapeHtml(activeRoom.name || 'Watch Party') + '</h3>'
                    + '      <div class="bfx-wp-code-row">'
                    + '        <button type="button" class="bfx-wp-code-badge" id="bfx-wp-copy-code-btn" title="Copy 6-character room code">'
                    + '          <span class="bfx-wp-code-prefix">CODE</span>'
                    + '          <span class="bfx-wp-code-val">' + escapeHtml(activeRoom.roomId) + '</span>'
                    + icon('copy')
                    + '        </button>'
                    + (isMyHost
                        ? ('        <button type="button" class="bfx-wp-host-toggle' + (activeRoom.hostControlOnly ? ' is-locked' : '') + '" id="bfx-wp-toggle-lock-btn">'
                            + icon(activeRoom.hostControlOnly ? 'lock' : 'users')
                            + '<span>' + (activeRoom.hostControlOnly ? 'Host Controls Only' : 'Everyone Controls') + '</span></button>')
                        : (activeRoom.hostControlOnly
                            ? '<span class="bfx-wp-host-toggle is-locked" style="cursor:default;">' + icon('lock') + '<span>Host Controls Only</span></span>'
                            : '<span class="bfx-wp-host-toggle" style="cursor:default;">' + icon('users') + '<span>Everyone Controls</span></span>'))
                    + '      </div>'
                    + '    </div>'
                    + '    <div class="bfx-wp-active-actions">'
                    + (canDeleteActive
                        ? ('      <button type="button" class="streamflix-ghost-btn bfx-wp-leave-btn" id="bfx-wp-leave-btn" title="Leave on this device">' + iconLabel('logout', 'Leave') + '</button>'
                            + '      <button type="button" class="streamflix-btn-danger bfx-wp-delete-btn" id="bfx-wp-delete-party-btn" title="End and delete Watch Party for everyone">' + iconLabel('trash', 'Delete Party') + '</button>')
                        : ('      <button type="button" class="streamflix-btn-danger bfx-wp-leave-btn" id="bfx-wp-leave-btn">' + iconLabel('logout', 'Leave') + '</button>'))
                    + '    </div>'
                    + '  </div>'
                    + '  <div class="bfx-wp-members-wrap">'
                    + '    <div class="bfx-wp-field-label">Viewers in Room (' + participants.length + ')</div>'
                    + '    <div class="bfx-wp-members">' + partChipsHtml + '</div>'
                    + '  </div>'
                    + nowPlayingCardHtml
                    + switchTargetHtml
                    + '  <div class="bfx-wp-invite-box">'
                    + '    <label class="bfx-wp-field-label" for="bfx-wp-invite-input">Household Invite Link</label>'
                    + '    <div class="bfx-wp-invite-row">'
                    + '      <input type="text" class="streamflix-input bfx-wp-link-input" id="bfx-wp-invite-input" readonly value="' + escapeHtml(inviteUrl) + '" />'
                    + '      <button type="button" class="streamflix-btn-primary bfx-wp-inline-btn" id="bfx-wp-copy-invite-btn">' + iconLabel('copy', 'Copy Link') + '</button>'
                    + (canPhoneShare ? '      <button type="button" class="streamflix-ghost-btn bfx-wp-inline-btn" id="bfx-wp-share-invite-btn">' + iconLabel('share', 'Share') + '</button>' : '')
                    + '    </div>'
                    + '  </div>'
                    + guestComboHtml
                    + '</div>';
            } else {
                var hasPlayableTarget = Boolean(resolvedPlayable && resolvedPlayable.Id);
                var roomsSectionHtml = rooms.length
                    ? (''
                        + '<div class="bfx-wp-rooms-section">'
                        + '  <div class="bfx-wp-field-label">Active Household Parties (' + rooms.length + ')</div>'
                        + '  <div class="bfx-wp-rooms-list">'
                        + rooms.map(function (r) {
                            var parts = Array.isArray(r.participants) ? r.participants : [];
                            var countNum = r.participantCount || parts.length || 1;
                            var countLabel = countNum === 1 ? '1 viewer' : (countNum + ' viewers');
                            var mediaText = formatWatchPartyMediaLabel(r);
                            var names = parts.map(function (p) { return p.displayName; }).filter(Boolean).slice(0, 3).join(', ');
                            var statusDetail = mediaText ? ((r.isPlaying ? 'Playing ' : 'Paused · ') + mediaText) : 'Waiting in lobby';
                            var canDeleteRow = canDeleteWatchPartyRoom(r);
                            return ''
                                + '<div class="bfx-wp-room-row">'
                                + '  <div class="bfx-wp-room-meta">'
                                + '    <div class="bfx-wp-room-row-title">'
                                + '      <span class="bfx-wp-pulse-dot" aria-hidden="true"></span>'
                                + '      <span class="bfx-wp-room-row-name">' + escapeHtml(r.name || 'Watch Party') + '</span>'
                                + '      <span class="bfx-wp-mini-code">' + escapeHtml(r.roomId) + '</span>'
                                + '    </div>'
                                + '    <div class="bfx-wp-room-row-sub">' + escapeHtml([countLabel, statusDetail, names].filter(Boolean).join(' · ')) + '</div>'
                                + '  </div>'
                                + '  <div class="bfx-wp-room-row-actions">'
                                + '    <button type="button" class="streamflix-btn-primary bfx-wp-inline-btn" data-join-room-id="' + escapeHtml(r.roomId) + '">' + iconLabel('play', 'Join') + '</button>'
                                + (canDeleteRow
                                    ? '    <button type="button" class="streamflix-btn-danger bfx-wp-row-delete-btn" data-delete-room-id="' + escapeHtml(r.roomId) + '" title="Delete Watch Party" aria-label="Delete Watch Party ' + escapeHtml(r.name || r.roomId) + '">' + iconLabel('trash', 'Delete') + '</button>'
                                    : '')
                                + '  </div>'
                                + '</div>';
                        }).join('')
                        + '  </div>'
                        + '</div>')
                    : (''
                        + '<div class="bfx-wp-idle-foot">'
                        + '  <span class="bfx-wp-idle-dot" aria-hidden="true"></span>'
                        + '  <span>No live household rooms right now — start a new party above or enter a friend\'s code.</span>'
                        + '</div>');

                html += ''
                    + '<div class="bfx-wp-create-card">'
                    + targetBannerHtml
                    + '  <div class="bfx-wp-field-block">'
                    + '    <label class="bfx-wp-field-label" for="bfx-wp-room-input">Party Name</label>'
                    + '    <input type="text" id="bfx-wp-room-input" class="streamflix-input bfx-wp-input" maxlength="64" value="' + escapeHtml(defaultRoomName) + '" placeholder="Enter a room name" />'
                    + '  </div>'
                    + '  <div class="bfx-wp-seg-group">'
                    + '    <span class="bfx-wp-field-label">Playback Controls</span>'
                    + '    <div class="bfx-wp-seg-track" role="group" aria-label="Playback control permissions">'
                    + '      <button type="button" class="bfx-wp-seg-btn' + (!hostLockCreate ? ' is-active' : '') + '" data-wp-lockmode="everyone">' + icon('users') + '<span>Everyone Controls</span></button>'
                    + '      <button type="button" class="bfx-wp-seg-btn is-amber' + (hostLockCreate ? ' is-active' : '') + '" data-wp-lockmode="host">' + icon('lock') + '<span>Host Controls Only</span></button>'
                    + '    </div>'
                    + '  </div>'
                    + startPosHtml
                    + '  <div class="bfx-wp-create-actions">'
                    + (hasPlayableTarget && !inPlayerNow
                        ? ('    <button type="button" class="bfx-wp-cta-primary" id="bfx-wp-start-and-play-btn">' + iconLabel('play', 'Start & Play Together') + '</button>'
                            + '    <button type="button" class="bfx-wp-cta-secondary" id="bfx-wp-create-lobby-btn">' + iconLabel('party', 'Create Lobby First') + '</button>')
                        : ('    <button type="button" class="bfx-wp-cta-primary" id="bfx-wp-create-lobby-btn">' + iconLabel(inPlayerNow ? 'play' : 'party', inPlayerNow ? 'Start Synced Party Here' : 'Create Watch Party') + '</button>'))
                    + '  </div>'
                    + '</div>'
                    + '<div class="bfx-wp-join-code-box">'
                    + '  <label class="bfx-wp-field-label" for="bfx-wp-code-join-input">Join with Room Code or Invite Link</label>'
                    + '  <div class="bfx-wp-join-row">'
                    + '    <input type="text" id="bfx-wp-code-join-input" class="streamflix-input bfx-wp-input bfx-wp-code-input" maxlength="200" autocomplete="off" spellcheck="false" value="' + escapeHtml(draftJoinValue) + '" placeholder="Room code (e.g. K7M4X9) or invite link" />'
                    + '    <button type="button" class="bfx-wp-join-submit-btn" id="bfx-wp-code-join-btn"><span>Join Party</span>' + icon('chevronRight') + '</button>'
                    + '  </div>'
                    + '</div>'
                    + roomsSectionHtml;
            }

            rootEl.innerHTML = html;
            startLiveClockTicker();

            var closeBtn = rootEl.querySelector('#bfx-wp-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', function () { m.close(); });
            }
            var refreshBtn = rootEl.querySelector('#bfx-wp-refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function () {
                    captureDraftInputs();
                    refreshBtn.classList.add('is-spinning');
                    refreshWatchPartyRoomsList(false).then(function () {
                        renderModalBody();
                    });
                });
            }

            var browseHubBtn = rootEl.querySelector('#bfx-wp-browse-hub-btn');
            if (browseHubBtn) {
                browseHubBtn.addEventListener('click', function () {
                    m.close();
                });
            }

            Array.prototype.forEach.call(rootEl.querySelectorAll('[data-wp-startmode]'), function (pill) {
                pill.addEventListener('click', function () {
                    captureDraftInputs();
                    selectedStartMode = pill.getAttribute('data-wp-startmode') || 'beginning';
                    renderModalBody();
                });
            });

            Array.prototype.forEach.call(rootEl.querySelectorAll('[data-wp-lockmode]'), function (seg) {
                seg.addEventListener('click', function () {
                    captureDraftInputs();
                    hostLockCreate = seg.getAttribute('data-wp-lockmode') === 'host';
                    renderModalBody();
                });
            });

            var runCreateParty = function (launchImmediately, triggerBtn) {
                captureDraftInputs();
                if (triggerBtn) {
                    triggerBtn.disabled = true;
                    triggerBtn.classList.add('streamflix-btn-loading');
                }
                var startSec = computeChosenStartSec();
                var createPayload = {
                    hostControlOnly: hostLockCreate,
                    playableItem: (launchImmediately || inPlayerNow) ? resolvedPlayable : null,
                    startPositionSeconds: startSec,
                    isPlaying: Boolean(launchImmediately || (inPlayerNow && osdState && osdState.video && !osdState.video.paused)),
                    suppressImmediateAutoFollow: Boolean(launchImmediately && !inPlayerNow)
                };
                createWatchPartyRoom(defaultRoomName, createPayload).then(function (room) {
                    var codeLabel = (room && room.roomId) ? room.roomId : '';
                    if (launchImmediately && resolvedPlayable && resolvedPlayable.Id && !inPlayerNow) {
                        m.close();
                        if (state.activeDetailModal && typeof state.activeDetailModal.close === 'function') {
                            state.activeDetailModal.close(true);
                        }
                        showToast('Watch Party ' + (codeLabel ? (codeLabel + ' ') : '') + 'live! Starting synced playback…', 'success');
                        playItemImmediately(resolvedPlayable, null, null, Math.round(startSec * 10000000), { fromWatchPartyFollow: true });
                        return;
                    }
                    showToast('Watch Party ready' + (codeLabel ? (' · Code ' + codeLabel) : '') + '!', 'success');
                    renderModalBody();
                }).catch(function (err) {
                    if (triggerBtn) {
                        triggerBtn.disabled = false;
                        triggerBtn.classList.remove('streamflix-btn-loading');
                    }
                    showToast((err && err.message) || 'Could not start Watch Party.', 'error');
                });
            };

            var roomNameInput = rootEl.querySelector('#bfx-wp-room-input');
            var startAndPlayBtn = rootEl.querySelector('#bfx-wp-start-and-play-btn');
            var createLobbyBtn = rootEl.querySelector('#bfx-wp-create-lobby-btn');

            if (roomNameInput) {
                roomNameInput.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        if (startAndPlayBtn) {
                            runCreateParty(true, startAndPlayBtn);
                        } else if (createLobbyBtn) {
                            runCreateParty(false, createLobbyBtn);
                        }
                    }
                });
            }
            if (startAndPlayBtn) {
                startAndPlayBtn.addEventListener('click', function () {
                    runCreateParty(true, startAndPlayBtn);
                });
            }
            if (createLobbyBtn) {
                createLobbyBtn.addEventListener('click', function () {
                    runCreateParty(false, createLobbyBtn);
                });
            }

            var codeJoinInput = rootEl.querySelector('#bfx-wp-code-join-input');
            var codeJoinBtn = rootEl.querySelector('#bfx-wp-code-join-btn');
            if (codeJoinInput && codeJoinBtn) {
                syncJoinInputVisualMode(codeJoinInput);
                codeJoinInput.addEventListener('input', function () {
                    draftJoinValue = codeJoinInput.value;
                    syncJoinInputVisualMode(codeJoinInput);
                });

                var submitCodeJoin = function () {
                    var parsedCode = extractWatchPartyCodeFromInput(codeJoinInput.value);
                    if (!parsedCode) {
                        showToast('Enter a valid 6-character room code or Watch Party invite link.', 'info');
                        codeJoinInput.focus();
                        return;
                    }
                    codeJoinBtn.disabled = true;
                    codeJoinBtn.classList.add('streamflix-btn-loading');
                    joinWatchPartyRoom(parsedCode).then(function (joinedRoom) {
                        draftJoinValue = '';
                        var joinedName = (joinedRoom && joinedRoom.name) || parsedCode;
                        showToast('Joined “' + joinedName + '”!', 'success');
                        if (joinedRoom && joinedRoom.itemId) {
                            m.close();
                        } else {
                            renderModalBody();
                        }
                    }).catch(function (err) {
                        codeJoinBtn.disabled = false;
                        codeJoinBtn.classList.remove('streamflix-btn-loading');
                        showToast((err && err.message) || 'Room not found.', 'error');
                    });
                };
                codeJoinBtn.addEventListener('click', submitCodeJoin);
                codeJoinInput.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        submitCodeJoin();
                    }
                });
            }

            Array.prototype.forEach.call(rootEl.querySelectorAll('[data-join-room-id]'), function (joinBtn) {
                joinBtn.addEventListener('click', function () {
                    var rid = joinBtn.getAttribute('data-join-room-id');
                    joinBtn.disabled = true;
                    joinBtn.classList.add('streamflix-btn-loading');
                    joinWatchPartyRoom(rid).then(function (joinedRoom) {
                        showToast('Joined “' + ((joinedRoom && joinedRoom.name) || rid) + '”!', 'success');
                        if (joinedRoom && joinedRoom.itemId) {
                            m.close();
                        } else {
                            renderModalBody();
                        }
                    }).catch(function (err) {
                        joinBtn.disabled = false;
                        joinBtn.classList.remove('streamflix-btn-loading');
                        showToast((err && err.message) || 'Could not join Watch Party.', 'error');
                    });
                });
            });

            Array.prototype.forEach.call(rootEl.querySelectorAll('[data-delete-room-id]'), function (delBtn) {
                delBtn.addEventListener('click', function () {
                    var rid = delBtn.getAttribute('data-delete-room-id');
                    if (!rid) {
                        return;
                    }
                    captureDraftInputs();
                    delBtn.disabled = true;
                    delBtn.classList.add('streamflix-btn-loading');
                    deleteWatchPartyRoom(rid).then(function () {
                        showToast('Watch Party deleted.', 'info');
                        renderModalBody();
                    }).catch(function (err) {
                        delBtn.disabled = false;
                        delBtn.classList.remove('streamflix-btn-loading');
                        showToast((err && err.message) || 'Could not delete Watch Party.', 'error');
                    });
                });
            });

            var copyCodeBtn = rootEl.querySelector('#bfx-wp-copy-code-btn');
            if (copyCodeBtn && activeRoom) {
                copyCodeBtn.addEventListener('click', function () {
                    copyTextToClipboard(activeRoom.roomId, 'Room code ' + activeRoom.roomId + ' copied!');
                });
            }

            var toggleLockBtn = rootEl.querySelector('#bfx-wp-toggle-lock-btn');
            if (toggleLockBtn && activeRoom) {
                toggleLockBtn.addEventListener('click', function () {
                    toggleLockBtn.disabled = true;
                    sendWatchPartyCommand('toggle_host_only', { hostControlOnly: !activeRoom.hostControlOnly }).then(function () {
                        renderModalBody();
                    });
                });
            }

            var resyncBtn = rootEl.querySelector('#bfx-wp-resync-now-btn');
            if (resyncBtn) {
                resyncBtn.addEventListener('click', function () {
                    reconcilePlayerWithRoom(true);
                    showToast('Synced to live Watch Party timeline!', 'success');
                });
            }

            var watchRoomBtn = rootEl.querySelector('#bfx-wp-watch-room-btn');
            if (watchRoomBtn && activeRoom && activeRoom.itemId) {
                watchRoomBtn.addEventListener('click', function () {
                    var targetTicks = Math.max(0, Math.round(getAuthoritativeRoomPositionSec(activeRoom) * 10000000));
                    markWatchPartyRoomItemAutoLaunched(activeRoom.roomId, activeRoom.itemId);
                    m.close();
                    if (state.activeDetailModal && typeof state.activeDetailModal.close === 'function') {
                        state.activeDetailModal.close(true);
                    }
                    playItemImmediately(activeRoom.itemId, null, null, targetTicks, { fromWatchPartyFollow: true, forceReplay: true });
                });
            }

            var playSelectedBtn = rootEl.querySelector('#bfx-wp-play-selected-btn');
            if (playSelectedBtn && resolvedPlayable && resolvedPlayable.Id) {
                playSelectedBtn.addEventListener('click', function () {
                    var startSec = computeChosenStartSec();
                    m.close();
                    if (state.activeDetailModal && typeof state.activeDetailModal.close === 'function') {
                        state.activeDetailModal.close(true);
                    }
                    playItemImmediately(resolvedPlayable, null, null, Math.round(startSec * 10000000), { forceReplay: true });
                });
            }

            var leaveBtn = rootEl.querySelector('#bfx-wp-leave-btn');
            if (leaveBtn) {
                leaveBtn.addEventListener('click', function () {
                    leaveBtn.disabled = true;
                    leaveWatchPartyRoom(false).then(function () {
                        guestInvitePass = null;
                        showToast('Left Watch Party.', 'info');
                        return refreshWatchPartyRoomsList(true);
                    }).then(renderModalBody);
                });
            }

            var deletePartyBtn = rootEl.querySelector('#bfx-wp-delete-party-btn');
            if (deletePartyBtn && activeRoom) {
                deletePartyBtn.addEventListener('click', function () {
                    deletePartyBtn.disabled = true;
                    deletePartyBtn.classList.add('streamflix-btn-loading');
                    deleteWatchPartyRoom(activeRoom.roomId).then(function () {
                        guestInvitePass = null;
                        showToast('Watch Party deleted.', 'info');
                        renderModalBody();
                    }).catch(function (err) {
                        deletePartyBtn.disabled = false;
                        deletePartyBtn.classList.remove('streamflix-btn-loading');
                        showToast((err && err.message) || 'Could not delete Watch Party.', 'error');
                    });
                });
            }

            var copyInviteBtn = rootEl.querySelector('#bfx-wp-copy-invite-btn');
            var inviteInput = rootEl.querySelector('#bfx-wp-invite-input');
            if (copyInviteBtn && inviteInput) {
                copyInviteBtn.addEventListener('click', function () {
                    copyTextToClipboard(inviteInput.value, 'Watch Party invite link copied!');
                });
                inviteInput.addEventListener('click', function () {
                    try { inviteInput.select(); } catch (e) {}
                });
            }

            var shareInviteBtn = rootEl.querySelector('#bfx-wp-share-invite-btn');
            if (shareInviteBtn && inviteInput && activeRoom) {
                shareInviteBtn.addEventListener('click', function () {
                    var shareMedia = formatWatchPartyMediaLabel(activeRoom) || targetTitle;
                    try {
                        navigator.share({
                            title: activeRoom.name || (getBrandName() + ' Watch Party'),
                            text: shareMedia ? ('Join my Watch Party for "' + shareMedia + '" (Code ' + activeRoom.roomId + ')!') : ('Join my ' + getBrandName() + ' Watch Party (Code ' + activeRoom.roomId + ')!'),
                            url: inviteInput.value
                        }).catch(function () {});
                    } catch (e) {}
                });
            }

            var makeGuestBtn = rootEl.querySelector('#bfx-wp-make-guest-btn');
            if (makeGuestBtn && activeRoom) {
                makeGuestBtn.addEventListener('click', function () {
                    var guestProfiles = getEligibleGuestProfiles();
                    var selEl = rootEl.querySelector('#bfx-wp-guest-prof-sel');
                    var chosenProfId = selEl ? selEl.value : (guestProfiles[0] && guestProfiles[0].id);
                    if (!chosenProfId) {
                        showToast('Create a non-admin profile first to issue a Guest Pass.', 'info');
                        return;
                    }
                    makeGuestBtn.disabled = true;
                    makeGuestBtn.classList.add('streamflix-btn-loading');
                    var labelMedia = formatWatchPartyMediaLabel(activeRoom) || targetTitle;
                    apiFetch('/StreamFlix/GuestPasses/Create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            label: 'Watch Party' + (labelMedia ? (' · ' + labelMedia.slice(0, 26)) : ''),
                            profileId: chosenProfId,
                            durationHours: 6,
                            maxRedemptions: 4
                        })
                    }).then(function (created) {
                        var rawGuestUrl = (created && created.shareUrl) || '';
                        if (rawGuestUrl && rawGuestUrl.charAt(0) === '/') {
                            rawGuestUrl = window.location.origin + rawGuestUrl;
                        }
                        var pName = (created && created.pass && created.pass.profileName) || (created && created.profileName) || 'Guest';
                        guestInvitePass = {
                            profileName: pName,
                            comboUrl: appendWatchPartyQueryToGuestUrl(rawGuestUrl, activeRoom.roomId)
                        };
                        renderModalBody();
                        if (guestInvitePass.comboUrl) {
                            copyTextToClipboard(guestInvitePass.comboUrl, '6-hour Guest Watch Party link copied!');
                        }
                    }).catch(function (err) {
                        makeGuestBtn.disabled = false;
                        makeGuestBtn.classList.remove('streamflix-btn-loading');
                        showToast((err && err.message) || 'Could not create Guest Pass link.', 'error');
                    });
                });
            }

            var copyGuestBtn = rootEl.querySelector('#bfx-wp-copy-guest-btn');
            var guestUrlInput = rootEl.querySelector('#bfx-wp-guest-url-input');
            if (copyGuestBtn && guestUrlInput) {
                copyGuestBtn.addEventListener('click', function () {
                    copyTextToClipboard(guestUrlInput.value, 'Guest Watch Party link copied!');
                });
            }
            var shareGuestBtn = rootEl.querySelector('#bfx-wp-share-guest-btn');
            if (shareGuestBtn && guestUrlInput && activeRoom) {
                shareGuestBtn.addEventListener('click', function () {
                    var shareMedia = formatWatchPartyMediaLabel(activeRoom) || targetTitle;
                    try {
                        navigator.share({
                            title: activeRoom.name || (getBrandName() + ' Watch Party'),
                            text: shareMedia ? ('Watch "' + shareMedia + '" together with me (6-hour Guest Pass included):') : ('Join my ' + getBrandName() + ' Watch Party (Guest Pass included):'),
                            url: guestUrlInput.value
                        }).catch(function () {});
                    } catch (e) {}
                });
            }
        }

        var resolveTargetPromise = (rawContextItem && rawContextItem.Id && (rawContextItem.Type === 'Series' || rawContextItem.Type === 'Season'))
            ? resolvePlayableItem(rawContextItem).then(function (ep) {
                if (ep && ep.Id) {
                    resolvedPlayable = ep;
                }
            }).catch(function () {})
            : Promise.resolve();

        Promise.all([
            resolveTargetPromise,
            refreshWatchPartyRoomsList(true)
        ]).then(renderModalBody);
    }
