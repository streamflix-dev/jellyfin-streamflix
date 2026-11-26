/* StreamFlix Client (11/14) — Media Detail Modal, Seasons & Episode Picker */
    /* ----------------------------------------------------------------------
       7. Rich Netflix Media Detail Modal ('The Devil Wears Prada 2' Style Everywhere)
       ---------------------------------------------------------------------- */
    var openMediaDetailModal = openHeroDetailModal;
    function openHeroDetailModal(item, options) {
        if (!item) {
            return;
        }
        var opts = options || {};

        // Cleanly close any active detail modal first so Escape listeners never leak
        if (state.activeDetailModal && typeof state.activeDetailModal.close === 'function') {
            try { state.activeDetailModal.close(true); } catch (eClosePrev) {}
            state.activeDetailModal = null;
        }
        var existingModals = document.querySelectorAll('.streamflix-detail-modal');
        for (var eIdx = 0; eIdx < existingModals.length; eIdx++) {
            var oldWrap = existingModals[eIdx].closest ? existingModals[eIdx].closest('.streamflix-modal-backdrop') : existingModals[eIdx].parentNode;
            if (oldWrap && oldWrap.parentNode) {
                oldWrap.parentNode.removeChild(oldWrap);
            }
        }

        document.body.classList.add('streamflix-modal-open');
        if (typeof stopHeroVideoPreview === 'function') {
            stopHeroVideoPreview(false);
        }

        var backdropUrl = safeCssUrl(getItemBackdropUrl(item, 1600));
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var rating = item.OfficialRating ? String(item.OfficialRating) : '';
        var runtime = formatRuntimeTicks(item.RunTimeTicks);
        var genres = Array.isArray(item.Genres) && item.Genres.length ? item.Genres.slice(0, 4) : [];
        var community = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        var canManageMedia = typeof canManageMediaItems === 'function' && canManageMediaItems();
        var showModalDownload = typeof canUserDownloadItem === 'function' && canUserDownloadItem(item);
        var hasResume = item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0;
        var resumePct = hasResume && item.RunTimeTicks
            ? Math.min(100, Math.max(2, Math.round(item.UserData.PlaybackPositionTicks / item.RunTimeTicks * 100)))
            : 0;
        var resumeLeftText = resumePct ? formatTimeLeft(item) : '';
        var brandInitial = getBrandLogoText().charAt(0) || 'S';
        var modalTopRank = getTop10Rank(item && item.Id);
        var modalLogoUrl = getItemLogoUrl(item, 720);

        var isLiveTvItem = item.Type === 'TvChannel' || item.Type === 'Program';
        var recordableProgram = item.Type === 'Program'
            ? item
            : ((item.Type === 'TvChannel' && item.CurrentProgram && item.CurrentProgram.Id) ? item.CurrentProgram : null);
        var resolveProgramTimerId = function (prog) {
            if (!prog || !prog.Id) {
                return '';
            }
            if (prog.TimerId) {
                return String(prog.TimerId);
            }
            if (state.liveTvEpg && state.liveTvEpg.timersByProgramId) {
                var hit = state.liveTvEpg.timersByProgramId[normalizeGuid(prog.Id)];
                if (hit) {
                    return String(hit);
                }
            }
            return '';
        };
        var initialTimerId = resolveProgramTimerId(recordableProgram);
        var isChannelOnlyArt = item.Type === 'TvChannel'
            && !(item.BackdropImageTags && item.BackdropImageTags.length > 0)
            && !(item.CurrentProgram && ((item.CurrentProgram.BackdropImageTags && item.CurrentProgram.BackdropImageTags.length > 0) || (item.CurrentProgram.ImageTags && (item.CurrentProgram.ImageTags.Thumb || item.CurrentProgram.ImageTags.Primary))));
        if (isChannelOnlyArt) {
            backdropUrl = '';
            if (!modalLogoUrl && item.ImageTags && item.ImageTags.Primary) {
                modalLogoUrl = apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Primary?maxWidth=480&quality=90';
            }
        }
        var chNumLabel = (item.Number || item.ChannelNumber) ? ('CH ' + String(item.Number || item.ChannelNumber)) : '';
        var typeBadgeMap = {
            Recording: 'RECORDING',
            Series: 'SERIES',
            BoxSet: 'COLLECTION',
            Episode: 'EPISODE',
            MusicAlbum: 'ALBUM',
            AudioBook: 'AUDIOBOOK',
            Audio: 'AUDIO',
            Book: 'BOOK'
        };
        var typeBadge = item.Type === 'TvChannel'
            ? (chNumLabel ? ('LIVE TV · ' + chNumLabel) : 'LIVE TV')
            : (item.Type === 'Program'
                ? (item.ChannelName ? ('ON TV · ' + item.ChannelName.toUpperCase()) : 'ON TV')
                : (typeBadgeMap[item.Type] || 'FILM'));
        var displayTitle = (item.Type === 'Episode' && item.SeriesName) ? item.SeriesName : (item.Name || 'Untitled');
        var formatShortProgTime = function (p) {
            if (!p || !p.StartDate) {
                return '';
            }
            try {
                var s = new Date(p.StartDate);
                var e = p.EndDate ? new Date(p.EndDate) : null;
                if (isNaN(s.getTime())) {
                    return '';
                }
                var fmt = function (dt) { return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
                return e && !isNaN(e.getTime()) ? (fmt(s) + ' – ' + fmt(e)) : fmt(s);
            } catch (eTime) {
                return '';
            }
        };
        var episodeSubline = item.Type === 'Episode'
            ? ('Season ' + (item.ParentIndexNumber || 1) + ' • Episode ' + (item.IndexNumber || 1) + ' — ' + (item.Name || ''))
            : (item.Type === 'TvChannel' && item.CurrentProgram && item.CurrentProgram.Name
                ? ('On Now: ' + item.CurrentProgram.Name + (formatShortProgTime(item.CurrentProgram) ? (' (' + formatShortProgTime(item.CurrentProgram) + ')') : ''))
                : (item.Type === 'Program'
                    ? ([item.EpisodeTitle || '', formatShortProgTime(item)].filter(Boolean).join(' • '))
                    : ''));
        var effectiveOverview = item.Overview
            || (item.Type === 'TvChannel' && item.CurrentProgram && item.CurrentProgram.Overview ? item.CurrentProgram.Overview : '')
            || (isLiveTvItem ? 'Live broadcast stream.' : 'No description available.');

        var playBtnInitialLabel = iconLabel('play', isLiveTvItem ? 'Watch Live' : (item.Type === 'BoxSet' ? 'Play Collection' : (hasResume ? 'Resume' : 'Play')));
        var buildInlineGenreLinksHtml = function (gList) {
            if (!Array.isArray(gList) || !gList.length) {
                return '';
            }
            return '<div class="bfx-side-meta-line"><span class="bfx-side-meta-label">Genres:</span> '
                + gList.slice(0, 4).map(function (g) {
                    return '<button type="button" class="bfx-inline-credit-link" data-filter-genre="' + escapeHtml(g) + '">' + escapeHtml(g) + '</button>';
                }).join('<span class="bfx-credit-sep">, </span>')
                + '</div>';
        };
        var initialGenreSideHtml = buildInlineGenreLinksHtml(genres);

        var extractCleanTagline = function (src) {
            if (!src || !Array.isArray(src.Taglines) || !src.Taglines.length) {
                return '';
            }
            var rawTag = String(src.Taglines[0] || '').trim();
            if (!rawTag || rawTag.length > 180) {
                return '';
            }
            if (rawTag.toLowerCase() === displayTitle.toLowerCase()) {
                return '';
            }
            if (src.Overview && rawTag.toLowerCase() === String(src.Overview).trim().toLowerCase()) {
                return '';
            }
            return rawTag;
        };
        var initialTagline = extractCleanTagline(item);

        // Also update underlying #itemBackdrop if present so it is never black
        var underlyingBackdrop = document.getElementById('itemBackdrop');
        if (underlyingBackdrop && backdropUrl) {
            underlyingBackdrop.style.backgroundImage = 'url("' + backdropUrl + '")';
            underlyingBackdrop.classList.remove('noBackdrop');
        }

        var hasWatchTogetherOpt = !isLiveTvItem && typeof isWatchTogetherEnabled === 'function' && isWatchTogetherEnabled();
        var wpLiveNow = Boolean(hasWatchTogetherOpt && typeof watchPartyState !== 'undefined' && watchPartyState.activeGroup);
        var hasInitialMoreActions = Boolean(hasWatchTogetherOpt || showModalDownload || (!isLiveTvItem && canManageMedia));

        var modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'streamflix-modal-backdrop';
        modalBackdrop.innerHTML = ''
            + '<div class="streamflix-detail-modal">'
            + '  <div class="streamflix-detail-scroll">'
            + '    <div class="streamflix-detail-hero" id="streamflix-modal-hero-banner"' + (backdropUrl ? ' style="background-image:url(\'' + escapeHtml(backdropUrl) + '\');"' : '') + '>'
            + '      <button type="button" class="streamflix-detail-close" id="streamflix-detail-close-btn" aria-label="Close">' + icon('close') + '</button>'
            + '      <div class="bfx-detail-hero-inner">'
            + '        <div class="streamflix-hero-brand-row">'
            + '          <span class="streamflix-n-badge">' + escapeHtml(brandInitial) + '</span>'
            + '          <span class="streamflix-hero-series-tag">' + escapeHtml(typeBadge) + '</span>'
            + (modalTopRank ? '<span class="streamflix-hero-top10-pill"><b>TOP 10</b><span>#' + modalTopRank + ' Today</span></span>' : '')
            + '        </div>'
            + '        <div id="streamflix-modal-title-wrap" class="streamflix-detail-title-wrap' + (modalLogoUrl ? ' has-logo' : '') + '" style="margin:0 0 ' + (episodeSubline ? '6px' : '14px') + ' 0;">'
            + (modalLogoUrl
                ? '          <img class="streamflix-detail-logo" src="' + escapeHtml(modalLogoUrl) + '" alt="" data-bfx-logo-fallback="detail" />'
                : '')
            + '          <h2 class="streamflix-detail-title-text">' + escapeHtml(displayTitle) + '</h2>'
            + '        </div>'
            + (episodeSubline ? '<div id="streamflix-modal-episode-subline" class="bfx-detail-ep-subline">' + escapeHtml(episodeSubline) + '</div>' : '')
            + (resumePct
                ? '<div class="streamflix-detail-resume" id="streamflix-modal-resume-row"><div class="streamflix-hero-progress-bar"><span style="width:' + resumePct + '%;"></span></div>' + (resumeLeftText ? '<span>' + escapeHtml(resumeLeftText) + '</span>' : '') + '</div>'
                : '')
            + '        <div class="streamflix-hero-actions">'
            + '          <button type="button" class="streamflix-hero-play" id="streamflix-modal-play-btn">' + playBtnInitialLabel + '</button>'
            + (!isLiveTvItem && item.Type !== 'BoxSet'
                ? '          <button type="button" class="streamflix-hero-secondary bfx-modal-trailer-btn" id="streamflix-modal-trailer-btn" style="display:none;">' + iconLabel('film', 'Trailer') + '</button>'
                : '')
            + (isLiveTvItem
                ? '          <button type="button" class="streamflix-hero-secondary" id="streamflix-modal-tvguide-btn">' + iconLabel('calendar', 'TV Guide') + '</button>'
                : '')
            + (recordableProgram
                ? '          <button type="button" class="streamflix-hero-secondary bfx-dvr-record-btn' + (initialTimerId ? ' is-recording' : '') + '" id="streamflix-modal-record-btn">' + iconLabel('recordDot', initialTimerId ? 'Scheduled' : 'Record') + '</button>'
                : '')
            + (opts.fromSurprise
                ? '          <button type="button" class="streamflix-hero-secondary streamflix-modal-reshuffle" id="streamflix-modal-reshuffle-btn">' + iconLabel('shuffle', 'Shuffle Again') + '</button>'
                : '')
            + (item.Type !== 'Program'
                ? '          <button type="button" class="streamflix-hero-icon-btn' + (isFav ? ' active' : '') + '" id="streamflix-modal-fav-btn" data-bfx-tip="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
                : '')
            + (!isLiveTvItem
                ? '          <button type="button" class="streamflix-hero-icon-btn' + (isPlayed ? ' active' : '') + '" id="streamflix-modal-watched-btn" data-bfx-tip="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>'
                : '')
            + '          <div class="bfx-modal-more-wrap" id="streamflix-modal-more-wrap"' + (hasInitialMoreActions ? '' : ' style="display:none;"') + '>'
            + '            <button type="button" class="streamflix-hero-icon-btn' + (wpLiveNow ? ' active is-live' : '') + '" id="streamflix-modal-more-btn" data-bfx-tip="More options" aria-label="More options" aria-haspopup="menu">' + icon('moreHorizontal') + '</button>'
            + '            <div class="bfx-modal-more-menu" id="streamflix-modal-more-menu" role="menu" hidden>'
            + (hasWatchTogetherOpt
                ? '              <button type="button" class="bfx-more-menu-item' + (wpLiveNow ? ' is-live' : '') + '" id="streamflix-modal-watchparty-btn" role="menuitem">' + icon('party') + '<span>' + (wpLiveNow ? 'Watch Together (Live)' : 'Watch Together') + '</span></button>'
                : '')
            + '              <button type="button" class="bfx-more-menu-item" id="streamflix-modal-download-btn" role="menuitem"' + (showModalDownload ? '' : ' style="display:none;"') + '>' + icon('download') + '<span>Download</span></button>'
            + (!isLiveTvItem && canManageMedia
                ? '              <button type="button" class="bfx-more-menu-item" id="streamflix-modal-manage-btn" role="menuitem">' + icon('edit') + '<span>Edit &amp; Manage Media</span></button>'
                : '')
            + '              <div id="streamflix-modal-ext-links" class="bfx-more-ext-group"></div>'
            + '            </div>'
            + '          </div>'
            + '        </div>'
            + '      </div>'
            + '    </div>'
            + '    <div class="streamflix-detail-body">'
            + '      <div class="bfx-detail-editorial-grid">'
            + '        <div class="bfx-detail-main-col">'
            + '          <div class="streamflix-hero-meta-row bfx-detail-meta-row" id="streamflix-modal-meta-row">'
            + (community ? '<span class="streamflix-hero-rating">' + icon('star') + escapeHtml(community) + '</span>' : '')
            + (year ? '<span>' + escapeHtml(year) + '</span>' : '')
            + (rating ? '<span class="streamflix-maturity-pill">' + escapeHtml(rating) + '</span>' : '')
            + (runtime ? '<span>' + escapeHtml(runtime.trim()) + '</span>' : '')
            + '<span id="streamflix-modal-quality-badges" class="bfx-quality-badges-wrap"></span>'
            + '          </div>'
            + '          <div id="streamflix-modal-tagline" class="streamflix-detail-tagline"' + (initialTagline ? '' : ' style="display:none;"') + '>' + escapeHtml(initialTagline) + '</div>'
            + '          <p id="streamflix-modal-overview" class="streamflix-detail-overview">'
            + escapeHtml(effectiveOverview)
            + '          </p>'
            + '          <div id="streamflix-modal-tracks-container"></div>'
            + '        </div>'
            + '        <aside id="streamflix-modal-credits-container" class="bfx-detail-side-col">'
            + initialGenreSideHtml
            + '        </aside>'
            + '      </div>'
            + '      <div id="streamflix-detail-episodes-section"></div>'
            + '      <div id="streamflix-detail-similar-section" style="margin-top:28px;"></div>'
            + '    </div>'
            + '  </div>'
            + '</div>';

        document.body.appendChild(modalBackdrop);
        hydrateCompleteImages(modalBackdrop);

        var resolvedItem = item;
        var firstPlayableTarget = null;
        var selectedAudioStreamIndex = null;
        var selectedSubtitleStreamIndex = null;
        var detailPriorFocus = document.activeElement;
        var modalClosed = false;

        function qModal(sel) {
            return modalBackdrop.querySelector(sel);
        }

        function onEscKey(ev) {
            if (isRemoteBackEvent(ev)) {
                ev.preventDefault();
                ev.stopPropagation();
                closeModal(false);
            }
        }
        document.addEventListener('keydown', onEscKey);

        if (isTvOrDpadActive()) {
            setTimeout(function () {
                var playFocus = qModal('#streamflix-modal-play-btn');
                if (playFocus) {
                    try { playFocus.focus({ preventScroll: true }); } catch (e) {}
                }
            }, 30);
        }

        function closeModal(keepRoute) {
            if (modalClosed) {
                return;
            }
            modalClosed = true;
            if (typeof stopModalTrailer === 'function') {
                stopModalTrailer();
            }
            document.removeEventListener('keydown', onEscKey);
            if (state.activeDetailModal && state.activeDetailModal.el === modalBackdrop) {
                state.activeDetailModal = null;
            }
            if (modalBackdrop.parentNode) {
                modalBackdrop.parentNode.removeChild(modalBackdrop);
            }
            if (!document.querySelector('.streamflix-detail-modal')) {
                document.body.classList.remove('streamflix-modal-open');
            }
            if (!keepRoute && (opts.isRouteBacked || (window.location.hash || '').indexOf('details') !== -1)) {
                state.routeModalItemId = null;
                if (window.history.length > 1) {
                    window.history.back();
                } else {
                    window.location.hash = '#/home';
                }
            }
            if (isTvOrDpadActive() && detailPriorFocus && detailPriorFocus.focus && document.contains(detailPriorFocus)) {
                setTimeout(function () {
                    try { detailPriorFocus.focus({ preventScroll: true }); } catch (e) {}
                }, 20);
            }
        }

        state.activeDetailModal = { el: modalBackdrop, close: closeModal };

        var closeBtnEl = qModal('#streamflix-detail-close-btn');
        if (closeBtnEl) {
            closeBtnEl.addEventListener('click', function () {
                closeModal(false);
            });
        }
        modalBackdrop.addEventListener('click', function (ev) {
            if (ev.target === modalBackdrop) {
                closeModal(false);
            }
        });

        var toggleProgramDvrTimer = function (progTarget, btnEl, compactMode) {
            if (!progTarget || !progTarget.Id || !btnEl || btnEl.disabled) {
                return;
            }
            var curTimerId = resolveProgramTimerId(progTarget);
            btnEl.disabled = true;
            var syncBtnState = function (hasTimer) {
                btnEl.disabled = false;
                btnEl.classList.toggle('is-recording', Boolean(hasTimer));
                if (compactMode) {
                    btnEl.innerHTML = icon('recordDot') + '<span>' + (hasTimer ? 'REC' : 'Record') + '</span>';
                    btnEl.title = hasTimer ? 'Cancel scheduled recording' : 'Record this program';
                } else {
                    btnEl.innerHTML = iconLabel('recordDot', hasTimer ? 'Scheduled' : 'Record');
                    btnEl.title = hasTimer ? 'Cancel scheduled DVR recording' : 'Record this broadcast';
                }
            };
            if (curTimerId) {
                apiFetch('/LiveTv/Timers/' + encodeURIComponent(curTimerId), { method: 'DELETE' })
                    .then(function () {
                        progTarget.TimerId = '';
                        if (state.liveTvEpg && state.liveTvEpg.timersByProgramId) {
                            delete state.liveTvEpg.timersByProgramId[normalizeGuid(progTarget.Id)];
                        }
                        if (state.liveTvData) { state.liveTvData.ts = 0; }
                        syncBtnState(false);
                        showToast('Cancelled recording for “' + (progTarget.Name || 'Program') + '”.', 'info');
                    })
                    .catch(function (err) {
                        btnEl.disabled = false;
                        showToast((err && err.status === 403) ? 'DVR recording management requires Live TV Management permission in Jellyfin.' : 'Could not cancel recording timer.', 'error');
                    });
                return;
            }

            apiFetch('/LiveTv/Timers/Defaults?programId=' + encodeURIComponent(progTarget.Id))
                .then(function (defaults) {
                    var payload = {};
                    if (defaults && typeof defaults === 'object') {
                        Object.keys(defaults).forEach(function (k) { payload[k] = defaults[k]; });
                    }
                    payload.ProgramId = progTarget.Id;
                    return apiFetch('/LiveTv/Timers', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                })
                .then(function () {
                    return apiFetch('/LiveTv/Timers').catch(function () { return { Items: [] }; });
                })
                .then(function (tRes) {
                    var createdId = 'scheduled';
                    var items = (tRes && Array.isArray(tRes.Items)) ? tRes.Items : [];
                    var normPid = normalizeGuid(progTarget.Id);
                    for (var ti = 0; ti < items.length; ti++) {
                        if (items[ti] && items[ti].Id && normalizeGuid(items[ti].ProgramId) === normPid && String(items[ti].Status || '').toLowerCase() !== 'cancelled') {
                            createdId = String(items[ti].Id);
                            break;
                        }
                    }
                    progTarget.TimerId = createdId;
                    if (state.liveTvEpg && state.liveTvEpg.timersByProgramId) {
                        state.liveTvEpg.timersByProgramId[normPid] = createdId;
                    }
                    if (state.liveTvData) { state.liveTvData.ts = 0; }
                    syncBtnState(true);
                    showToast('Recording scheduled for “' + (progTarget.Name || 'Program') + '”.', 'success');
                })
                .catch(function (err) {
                    btnEl.disabled = false;
                    showToast((err && err.status === 403) ? 'DVR recording management requires Live TV Management permission in Jellyfin.' : 'Could not schedule DVR recording.', 'error');
                });
        };

        var tvGuideBtn = qModal('#streamflix-modal-tvguide-btn');
        if (tvGuideBtn) {
            tvGuideBtn.addEventListener('click', function () {
                closeModal(true);
                if (state.cinemaHubEnabled !== false && isOnHomeRoute() && typeof renderCinemaHubContents === 'function') {
                    state.activeCategory = 'livetv';
                    if (!state.liveTvUi) { state.liveTvUi = { tab: 'guide', filter: '', epgOffsetMins: 0 }; }
                    state.liveTvUi.tab = 'guide';
                    renderCinemaHubContents();
                    return;
                }
                var sid = resolveKnownServerId();
                window.location.hash = '#/livetv?tab=1' + (sid ? ('&serverId=' + encodeURIComponent(sid)) : '');
            });
        }

        var recordModalBtn = qModal('#streamflix-modal-record-btn');
        if (recordModalBtn && recordableProgram) {
            recordModalBtn.addEventListener('click', function () {
                toggleProgramDvrTimer(recordableProgram, recordModalBtn, false);
            });
        }

        var mainPlayBtn = qModal('#streamflix-modal-play-btn');
        if (mainPlayBtn) {
            mainPlayBtn.addEventListener('click', function () {
                closeModal(true);
                playItemImmediately(firstPlayableTarget || resolvedItem || item, selectedAudioStreamIndex, selectedSubtitleStreamIndex);
            });
        }

        var modalTrailerDesc = null;
        var modalTrailerMsgHandler = null;
        function stopModalTrailer() {
            if (modalTrailerMsgHandler) {
                window.removeEventListener('message', modalTrailerMsgHandler);
                modalTrailerMsgHandler = null;
            }
            var heroBannerEl = qModal('#streamflix-modal-hero-banner');
            if (!heroBannerEl) {
                return;
            }
            heroBannerEl.classList.remove('is-trailer-open');
            var existingStage = heroBannerEl.querySelector('.bfx-modal-trailer-stage');
            if (existingStage) {
                var ifr = existingStage.querySelector('iframe');
                if (ifr) {
                    try { ifr.src = 'about:blank'; } catch (eIfr) {}
                }
                var vid = existingStage.querySelector('video');
                if (vid) {
                    try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (eVid) {}
                }
                if (existingStage.parentNode) {
                    existingStage.parentNode.removeChild(existingStage);
                }
            }
        }

        var modalTrailerBtn = qModal('#streamflix-modal-trailer-btn');
        if (modalTrailerBtn && typeof resolveItemTrailerDescriptor === 'function') {
            resolveItemTrailerDescriptor(item).then(function (desc) {
                if (modalClosed || !modalBackdrop.parentNode || !desc) {
                    return;
                }
                modalTrailerDesc = desc;
                modalTrailerBtn.style.display = '';
            }).catch(function () {});

            modalTrailerBtn.addEventListener('click', function () {
                if (!modalTrailerDesc) {
                    return;
                }
                var heroBannerEl = qModal('#streamflix-modal-hero-banner');
                if (!heroBannerEl) {
                    return;
                }
                stopModalTrailer();
                heroBannerEl.classList.add('is-trailer-open');
                var stage = document.createElement('div');
                stage.className = 'bfx-modal-trailer-stage';
                var backBtn = document.createElement('button');
                backBtn.type = 'button';
                backBtn.className = 'bfx-modal-trailer-back';
                backBtn.innerHTML = icon('chevronLeft') + '<span>Back</span>';
                backBtn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    stopModalTrailer();
                });
                stage.appendChild(backBtn);

                if (modalTrailerDesc.kind === 'youtube' && modalTrailerDesc.youtubeId) {
                    var ytIfr = document.createElement('iframe');
                    ytIfr.className = 'bfx-modal-trailer-iframe';
                    ytIfr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                    ytIfr.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
                    ytIfr.setAttribute('allowfullscreen', '');
                    ytIfr.setAttribute('title', (modalTrailerDesc.title || displayTitle || 'Official') + ' Trailer');
                    ytIfr.src = (typeof buildYouTubeRelaySrc === 'function')
                        ? buildYouTubeRelaySrc(modalTrailerDesc.youtubeId, { autoplay: true, mute: false, controls: true })
                        : (apiBase() + '/StreamFlix/Trailers/Embed/' + encodeURIComponent(modalTrailerDesc.youtubeId) + '?autoplay=1&mute=0&controls=1');
                    modalTrailerMsgHandler = function (ev) {
                        var d = ev && ev.data;
                        if (!d || d.source !== 'streamflix-yt' || ev.source !== ytIfr.contentWindow) {
                            return;
                        }
                        if (d.event === 'state' && d.state === 0) {
                            stopModalTrailer();
                        }
                    };
                    window.addEventListener('message', modalTrailerMsgHandler);
                    stage.appendChild(ytIfr);
                } else if (modalTrailerDesc.kind === 'local' && modalTrailerDesc.localTrailerId) {
                    var mAuth = getJellyfinAuthContext();
                    var mVid = document.createElement('video');
                    mVid.className = 'bfx-modal-trailer-video';
                    mVid.controls = true;
                    mVid.autoplay = true;
                    mVid.playsInline = true;
                    mVid.src = apiBase() + '/Videos/' + encodeURIComponent(modalTrailerDesc.localTrailerId) + '/stream?static=true&api_key=' + encodeURIComponent((mAuth && mAuth.token) || '');
                    mVid.addEventListener('ended', stopModalTrailer);
                    stage.appendChild(mVid);
                }
                heroBannerEl.appendChild(stage);
            });
        }

        var closeMoreMenu = function () {
            var mm = qModal('#streamflix-modal-more-menu');
            var mb = qModal('#streamflix-modal-more-btn');
            if (mm) {
                mm.hidden = true;
                mm.classList.remove('is-open');
            }
            if (mb) {
                mb.classList.remove('open');
            }
        };
        var syncMoreWrapVisibility = function () {
            var wrap = qModal('#streamflix-modal-more-wrap');
            var menu = qModal('#streamflix-modal-more-menu');
            if (!wrap || !menu) {
                return;
            }
            var hasVisibleItem = false;
            Array.prototype.forEach.call(menu.querySelectorAll('.bfx-more-menu-item'), function (itEl) {
                if (itEl.style.display !== 'none') {
                    hasVisibleItem = true;
                }
            });
            wrap.style.display = hasVisibleItem ? '' : 'none';
        };

        var moreBtnEl = qModal('#streamflix-modal-more-btn');
        var moreMenuEl = qModal('#streamflix-modal-more-menu');
        if (moreBtnEl && moreMenuEl) {
            moreBtnEl.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                var willOpen = Boolean(moreMenuEl.hidden);
                moreMenuEl.hidden = !willOpen;
                moreMenuEl.classList.toggle('is-open', willOpen);
                moreBtnEl.classList.toggle('open', willOpen);
            });
            modalBackdrop.addEventListener('click', function (ev) {
                if (!moreMenuEl.hidden && !moreMenuEl.contains(ev.target) && ev.target !== moreBtnEl) {
                    closeMoreMenu();
                }
            });
        }

        var favBtn = qModal('#streamflix-modal-fav-btn');
        if (favBtn) {
            favBtn.addEventListener('click', function () {
                var nextFav = !(item.UserData && item.UserData.IsFavorite);
                favBtn.innerHTML = icon(nextFav ? 'check' : 'plus');
                favBtn.classList.toggle('active', nextFav);
                favBtn.setAttribute('data-bfx-tip', nextFav ? 'Remove from My List' : 'Add to My List');
                toggleFavoriteItem(item, null);
            });
        }

        var watchedBtn = qModal('#streamflix-modal-watched-btn');
        if (watchedBtn) {
            watchedBtn.addEventListener('click', function () {
                var nextPlayed = !(item.UserData && item.UserData.Played);
                watchedBtn.classList.toggle('active', nextPlayed);
                watchedBtn.setAttribute('data-bfx-tip', nextPlayed ? 'Mark unwatched' : 'Mark watched');
                togglePlayedItem(item, null);
            });
        }

        var watchPartyBtn = qModal('#streamflix-modal-watchparty-btn');
        if (watchPartyBtn) {
            watchPartyBtn.addEventListener('click', function () {
                closeMoreMenu();
                if (typeof openWatchTogetherModal === 'function') {
                    openWatchTogetherModal({
                        item: resolvedItem || item,
                        playableTarget: firstPlayableTarget || resolvedItem || item
                    });
                }
            });
        }

        var downloadModalBtn = qModal('#streamflix-modal-download-btn');
        if (downloadModalBtn) {
            downloadModalBtn.addEventListener('click', function () {
                closeMoreMenu();
                var targetDl = resolvedItem || item;
                if (typeof triggerDirectMediaDownload === 'function' && targetDl && targetDl.Id) {
                    triggerDirectMediaDownload(targetDl);
                }
            });
        }

        var manageMediaBtn = qModal('#streamflix-modal-manage-btn');
        if (manageMediaBtn) {
            manageMediaBtn.addEventListener('click', function () {
                closeMoreMenu();
                openManageMediaMenu({
                    item: resolvedItem || item,
                    onItemEdited: function (updatedItem) {
                        if (!updatedItem || !updatedItem.Id || modalClosed) {
                            return;
                        }
                        var ownUserData = (resolvedItem && resolvedItem.UserData) || (item && item.UserData);
                        if (ownUserData) {
                            updatedItem.UserData = ownUserData;
                        } else {
                            delete updatedItem.UserData;
                        }
                        var editedId = normalizeGuid(updatedItem.Id);
                        function mergeEditedMetadata(target) {
                            if (!target || target === updatedItem || normalizeGuid(target.Id) !== editedId) {
                                return;
                            }
                            Object.keys(updatedItem).forEach(function (key) {
                                if (key !== 'UserData') {
                                    target[key] = updatedItem[key];
                                }
                            });
                        }
                        mergeEditedMetadata(item);
                        mergeEditedMetadata(resolvedItem);
                        Object.keys(state.itemCache || {}).forEach(function (key) {
                            mergeEditedMetadata(state.itemCache[key]);
                        });
                        var editedItemPools = [
                            state.hubData && state.hubData.heroItems,
                            state.hubData && state.hubData.resumeItems,
                            state.hubData && state.hubData.nextUpItems,
                            state.hubData && state.hubData.top10Items,
                            state.hubData && state.hubData.favoriteItems,
                            state.hubData && state.hubData.recentMovies,
                            state.hubData && state.hubData.recentSeries,
                            state.hubData && state.hubData.allMovies,
                            state.hubData && state.hubData.allSeries,
                            state.hubData && state.hubData.collectionsItems,
                            state.searchResults,
                            state.browseFilter && state.browseFilter.items
                        ];
                        editedItemPools.forEach(function (pool) {
                            if (Array.isArray(pool)) {
                                pool.forEach(mergeEditedMetadata);
                            }
                        });
                        putCachedItem(updatedItem.Id, updatedItem);
                        if (updatedItem.Type === 'Episode') {
                            var sublineEl = qModal('#streamflix-modal-episode-subline');
                            if (sublineEl) {
                                sublineEl.textContent = 'Season ' + (updatedItem.ParentIndexNumber || 1)
                                    + ' • Episode ' + (updatedItem.IndexNumber || 1) + ' — ' + (updatedItem.Name || '');
                            }
                        } else if (updatedItem.Name) {
                            var titleTextEl = qModal('.streamflix-detail-title-text');
                            if (titleTextEl) {
                                titleTextEl.textContent = updatedItem.Name;
                            }
                        }
                        var editedOverviewEl = qModal('#streamflix-modal-overview');
                        if (editedOverviewEl) {
                            editedOverviewEl.textContent = updatedItem.Overview || 'No description available.';
                        }
                        var editedTaglineEl = qModal('#streamflix-modal-tagline');
                        if (editedTaglineEl) {
                            var editedTagline = extractCleanTagline(updatedItem);
                            editedTaglineEl.textContent = editedTagline;
                            editedTaglineEl.style.display = editedTagline ? '' : 'none';
                        }
                        var editedMetaRow = qModal('#streamflix-modal-meta-row');
                        if (editedMetaRow) {
                            var updCommunity = updatedItem.CommunityRating ? Number(updatedItem.CommunityRating).toFixed(1) : '';
                            var updYear = updatedItem.ProductionYear ? String(updatedItem.ProductionYear) : '';
                            var updRating = updatedItem.OfficialRating ? String(updatedItem.OfficialRating) : '';
                            var updRuntime = formatRuntimeTicks(updatedItem.RunTimeTicks);
                            editedMetaRow.innerHTML = ''
                                + (updCommunity ? '<span class="streamflix-hero-rating">' + icon('star') + escapeHtml(updCommunity) + '</span>' : '')
                                + (updYear ? '<span>' + escapeHtml(updYear) + '</span>' : '')
                                + (updRating ? '<span class="streamflix-maturity-pill">' + escapeHtml(updRating) + '</span>' : '')
                                + (updRuntime ? '<span>' + escapeHtml(updRuntime.trim()) + '</span>' : '')
                                + '<span id="streamflix-modal-quality-badges" class="bfx-quality-badges-wrap"></span>';
                        }
                        renderEnrichedDetails(updatedItem);
                    },
                    onItemDeleted: function () {
                        closeModal(false);
                    }
                });
            });
        }

        var reshuffleBtn = qModal('#streamflix-modal-reshuffle-btn');
        if (reshuffleBtn) {
            reshuffleBtn.addEventListener('click', function () {
                triggerSurpriseMe();
            });
        }

        function bindGenreChipsInModal() {
            Array.prototype.forEach.call(modalBackdrop.querySelectorAll('[data-filter-genre]'), function (chip) {
                if (chip.getAttribute('data-bfx-bound') === '1') {
                    return;
                }
                chip.setAttribute('data-bfx-bound', '1');
                chip.addEventListener('click', function () {
                    var gName = chip.getAttribute('data-filter-genre') || '';
                    if (gName) {
                        closeModal(true);
                        applyBrowseFilter({ kind: 'genre', name: gName });
                    }
                });
            });
        }
        bindGenreChipsInModal();

        function renderEnrichedDetails(fullItem) {
            if (!fullItem || !modalBackdrop.parentNode || modalClosed) {
                return;
            }
            resolvedItem = fullItem;
            var dlBtn = qModal('#streamflix-modal-download-btn');
            if (dlBtn && typeof canUserDownloadItem === 'function') {
                dlBtn.style.display = canUserDownloadItem(fullItem) ? '' : 'none';
            }
            var fullHasBackdrop = (fullItem.BackdropImageTags && fullItem.BackdropImageTags.length > 0)
                || (fullItem.Type !== 'TvChannel')
                || (fullItem.CurrentProgram && ((fullItem.CurrentProgram.BackdropImageTags && fullItem.CurrentProgram.BackdropImageTags.length > 0) || (fullItem.CurrentProgram.ImageTags && (fullItem.CurrentProgram.ImageTags.Thumb || fullItem.CurrentProgram.ImageTags.Primary))));
            var betterBg = fullHasBackdrop ? safeCssUrl(getItemBackdropUrl(fullItem, 1600)) : '';
            var heroBanner = qModal('#streamflix-modal-hero-banner');
            if (heroBanner && betterBg) {
                heroBanner.style.backgroundImage = 'url("' + betterBg + '")';
            }
            if (!modalLogoUrl) {
                var enrichedLogo = getItemLogoUrl(fullItem, 720);
                var titleWrapEl = qModal('#streamflix-modal-title-wrap');
                if (enrichedLogo && titleWrapEl && !titleWrapEl.querySelector('.streamflix-detail-logo')) {
                    modalLogoUrl = enrichedLogo;
                    var logoImg = document.createElement('img');
                    logoImg.className = 'streamflix-detail-logo';
                    logoImg.alt = '';
                    logoImg.setAttribute('data-bfx-logo-fallback', 'detail');
                    logoImg.src = enrichedLogo;
                    titleWrapEl.classList.add('has-logo');
                    titleWrapEl.insertBefore(logoImg, titleWrapEl.firstChild);
                    hydrateCompleteImages(titleWrapEl);
                }
            }
            var taglineEl = qModal('#streamflix-modal-tagline');
            var enrichedTagline = extractCleanTagline(fullItem);
            if (taglineEl && enrichedTagline) {
                taglineEl.textContent = enrichedTagline;
                taglineEl.style.display = '';
            }
            var overviewEl = qModal('#streamflix-modal-overview');
            if (overviewEl && fullItem.Overview) {
                overviewEl.textContent = fullItem.Overview;
            }

            var streams = (fullItem.MediaStreams && fullItem.MediaStreams.length)
                ? fullItem.MediaStreams
                : ((fullItem.MediaSources && fullItem.MediaSources[0] && fullItem.MediaSources[0].MediaStreams) || []);
            var videoStreams = streams.filter(function (s) { return s.Type === 'Video'; });
            var audioStreams = streams.filter(function (s) { return s.Type === 'Audio'; });
            var subStreams = streams.filter(function (s) { return s.Type === 'Subtitle'; });

            // Render clean monochrome technical spec tags when EnableRichDetailBadges is active
            var richBadgesOn = !(state.config && state.config.enableRichDetailBadges === false);
            var qBadgesEl = qModal('#streamflix-modal-quality-badges');
            if (qBadgesEl) {
                if (!richBadgesOn) {
                    qBadgesEl.innerHTML = '';
                } else {
                    var qList = [];
                    if (fullItem.CriticRating != null && Number(fullItem.CriticRating) > 0) {
                        var cScore = Math.round(Number(fullItem.CriticRating));
                        qList.push({ cls: 'is-critic', text: (cScore >= 60 ? '🍅 ' : '🍿 ') + cScore + '%' });
                    }
                    if (videoStreams.length > 0) {
                        var vs = videoStreams[0];
                        var vw = Number(vs.Width) || 0;
                        var vh = Number(vs.Height) || 0;
                        var vTitle = String(vs.DisplayTitle || '').toUpperCase();
                        if (vw >= 3800 || vh >= 2100 || vTitle.indexOf('4K') !== -1 || vTitle.indexOf('2160P') !== -1) {
                            qList.push({ cls: 'is-res', text: '4K UHD' });
                        } else if (vw >= 2500 || vh >= 1400) {
                            qList.push({ cls: 'is-res', text: '1440p' });
                        } else if (vw >= 1900 || vh >= 1040 || vTitle.indexOf('1080P') !== -1) {
                            qList.push({ cls: 'is-res', text: 'HD' });
                        }
                        var vRange = String(vs.VideoRangeType || vs.VideoRange || '').toUpperCase() + ' ' + vTitle;
                        if (vRange.indexOf('DOVI') !== -1 || vRange.indexOf('DOLBY VISION') !== -1) {
                            qList.push({ cls: 'is-hdr', text: 'Dolby Vision' });
                        } else if (vRange.indexOf('HDR10+') !== -1 || vRange.indexOf('HDR10PLUS') !== -1) {
                            qList.push({ cls: 'is-hdr', text: 'HDR10+' });
                        } else if (vRange.indexOf('HDR10') !== -1) {
                            qList.push({ cls: 'is-hdr', text: 'HDR10' });
                        } else if (vRange.indexOf('HLG') !== -1) {
                            qList.push({ cls: 'is-hdr', text: 'HLG' });
                        } else if (/\bHDR\b/.test(vRange) && vRange.indexOf('SDR') === -1) {
                            qList.push({ cls: 'is-hdr', text: 'HDR' });
                        }
                        var vCodec = String(vs.Codec || '').toUpperCase();
                        if (vCodec === 'AV1') {
                            qList.push({ cls: 'is-codec', text: 'AV1' });
                        }
                    }
                    if (audioStreams.length > 0) {
                        var allAudioText = audioStreams.map(function (a) {
                            return String(a.DisplayTitle || '') + ' ' + String(a.Profile || '') + ' ' + String(a.Codec || '');
                        }).join(' ').toUpperCase();
                        if (allAudioText.indexOf('ATMOS') !== -1) {
                            qList.push({ cls: 'is-audio', text: 'Dolby Atmos' });
                        } else if (allAudioText.indexOf('DTS:X') !== -1 || allAudioText.indexOf('DTS-X') !== -1) {
                            qList.push({ cls: 'is-audio', text: 'DTS:X' });
                        } else if (allAudioText.indexOf('TRUEHD') !== -1) {
                            qList.push({ cls: 'is-audio', text: 'TrueHD' });
                        }
                        var maxCh = 0;
                        audioStreams.forEach(function (a) {
                            if ((Number(a.Channels) || 0) > maxCh) { maxCh = Number(a.Channels) || 0; }
                        });
                        if (maxCh >= 8) {
                            qList.push({ cls: 'is-ch', text: '7.1' });
                        } else if (maxCh >= 6) {
                            qList.push({ cls: 'is-ch', text: '5.1' });
                        }
                    }
                    if (subStreams.length > 0) {
                        qList.push({ cls: 'is-cc', text: 'CC' });
                    }
                    qBadgesEl.innerHTML = qList.slice(0, 6).map(function (b) {
                        return '<span class="bfx-qbadge ' + b.cls + '">' + escapeHtml(b.text) + '</span>';
                    }).join('');
                }
            }

            // Render compact Audio & Subtitles selector bar (skip redundant static Video pill when Rich Badges are active)
            var tracksEl = qModal('#streamflix-modal-tracks-container');
            if (tracksEl && ((!richBadgesOn && videoStreams.length > 0) || audioStreams.length > 0 || subStreams.length > 0)) {
                var pillsHtml = '';
                if (!richBadgesOn && videoStreams.length > 0) {
                    var vLabel = videoStreams[0].DisplayTitle || videoStreams[0].Codec || 'HD';
                    pillsHtml += '<div class="streamflix-modal-track-pill is-static"><span class="track-label">Video</span><span class="track-static-val">' + escapeHtml(vLabel) + '</span></div>';
                }
                if (audioStreams.length > 0) {
                    var aOpts = audioStreams.map(function (a) {
                        var isDef = a.IsDefault ? ' selected' : '';
                        return '<option value="' + a.Index + '"' + isDef + '>' + escapeHtml(a.DisplayTitle || a.Language || ('Track ' + a.Index)) + '</option>';
                    }).join('');
                    pillsHtml += '<div class="streamflix-modal-track-pill"><span class="track-label">Audio</span><select id="streamflix-modal-audio-select">' + aOpts + '</select></div>';
                }
                if (subStreams.length > 0) {
                    var sOpts = '<option value="-1">Off</option>' + subStreams.map(function (s) {
                        var isDef = s.IsDefault ? ' selected' : '';
                        return '<option value="' + s.Index + '"' + isDef + '>' + escapeHtml(s.DisplayTitle || s.Language || ('Sub ' + s.Index)) + '</option>';
                    }).join('');
                    pillsHtml += '<div class="streamflix-modal-track-pill"><span class="track-label">Subtitles</span><select id="streamflix-modal-sub-select">' + sOpts + '</select></div>';
                }
                tracksEl.innerHTML = pillsHtml ? ('<div class="streamflix-modal-tracks-row">' + pillsHtml + '</div>') : '';

                var aSelEl = qModal('#streamflix-modal-audio-select');
                if (aSelEl) {
                    aSelEl.addEventListener('change', function () {
                        selectedAudioStreamIndex = parseInt(aSelEl.value, 10);
                    });
                }
                var sSelEl = qModal('#streamflix-modal-sub-select');
                if (sSelEl) {
                    sSelEl.addEventListener('change', function () {
                        selectedSubtitleStreamIndex = parseInt(sSelEl.value, 10);
                    });
                }
            }

            // Populate External Links inside More Options menu so bottom stays uncluttered
            var extUrls = (Array.isArray(fullItem.ExternalUrls) ? fullItem.ExternalUrls : []).filter(function (u) {
                return u && u.Name && typeof u.Url === 'string' && /^https?:\/\//i.test(u.Url.trim());
            });
            var extGroupEl = qModal('#streamflix-modal-ext-links');
            if (extGroupEl) {
                extGroupEl.innerHTML = extUrls.slice(0, 4).map(function (u) {
                    return '<a href="' + escapeHtml(u.Url.trim()) + '" target="_blank" rel="noopener noreferrer" class="bfx-more-menu-item is-ext" role="menuitem">'
                        + icon('externalLink') + '<span>View on ' + escapeHtml(u.Name) + '</span></a>';
                }).join('');
            }
            syncMoreWrapVisibility();

            // Render right-column editorial credits (Cast, Genres, Director / Studio — comma-separated, zero pill clutter)
            var creditsEl = qModal('#streamflix-modal-credits-container');
            if (creditsEl) {
                var people = Array.isArray(fullItem.People) ? fullItem.People : [];
                var directors = people.filter(function (p) { return p && p.Type === 'Director' && p.Name; }).slice(0, 2);
                var cast = people.filter(function (p) { return p && p.Type === 'Actor' && p.Name; }).slice(0, 4);
                var effectiveGenres = (Array.isArray(fullItem.Genres) && fullItem.Genres.length) ? fullItem.Genres : genres;

                var renderInlinePeople = function (list, roleType) {
                    return list.map(function (p) {
                        return '<button type="button" class="bfx-inline-credit-link" data-person-name="' + escapeHtml(p.Name) + '" data-person-id="' + escapeHtml(p.Id || '') + '" data-person-role="' + escapeHtml(roleType) + '">' + escapeHtml(p.Name) + '</button>';
                    }).join('<span class="bfx-credit-sep">, </span>');
                };

                var sideLines = [];
                if (cast.length) {
                    sideLines.push('<div class="bfx-side-meta-line"><span class="bfx-side-meta-label">Cast:</span> ' + renderInlinePeople(cast, 'Actor') + '</div>');
                }
                if (effectiveGenres.length) {
                    sideLines.push(buildInlineGenreLinksHtml(effectiveGenres));
                }
                if (directors.length) {
                    sideLines.push('<div class="bfx-side-meta-line"><span class="bfx-side-meta-label">Director:</span> ' + renderInlinePeople(directors, 'Director') + '</div>');
                }
                if (richBadgesOn && Array.isArray(fullItem.Studios) && fullItem.Studios.length) {
                    var studioNames = fullItem.Studios
                        .map(function (s) { return typeof s === 'string' ? s : (s && s.Name ? s.Name : ''); })
                        .filter(Boolean)
                        .slice(0, 2);
                    if (studioNames.length) {
                        sideLines.push('<div class="bfx-side-meta-line"><span class="bfx-side-meta-label">Studio:</span> <span class="bfx-studio-chip">' + escapeHtml(studioNames.join(', ')) + '</span></div>');
                    }
                }
                creditsEl.innerHTML = sideLines.join('');
                bindGenreChipsInModal();
                Array.prototype.forEach.call(creditsEl.querySelectorAll('[data-person-name]'), function (pChip) {
                    pChip.addEventListener('click', function () {
                        var pName = pChip.getAttribute('data-person-name') || '';
                        var pId = pChip.getAttribute('data-person-id') || '';
                        var pRole = pChip.getAttribute('data-person-role') || 'Actor';
                        if (pName) {
                            closeModal(true);
                            applyBrowseFilter({ kind: 'person', role: pRole, name: pName, id: pId });
                        }
                    });
                });
            }
        }

        if (item.MediaStreams || item.People) {
            renderEnrichedDetails(item);
        } else if (item.Id) {
            fetchFullItemDetails(item.Id).then(renderEnrichedDetails).catch(function () {});
        }

        var auth = getJellyfinAuthContext();

        // If BoxSet (Collection / Franchise Hub), load all Movies/Series with progress & sort controls!
        if (item.Type === 'BoxSet' && auth.userId) {
            var colContainer = qModal('#streamflix-detail-episodes-section');
            if (colContainer) {
                colContainer.innerHTML = '<div style="color:#888;font-size:13px;">Loading franchise titles…</div>';
                fetchUserItems(encodeURIComponent(auth.userId), 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Movie,Series,Video&SortBy=PremiereDate,ProductionYear,SortName&SortOrder=Ascending&Limit=100&Fields=Overview,Genres,PrimaryImageAspectRatio,DateCreated')
                    .then(function (res) {
                        var rawColItems = (res && res.Items) || [];
                        if (!rawColItems.length || !modalBackdrop.parentNode || modalClosed) {
                            colContainer.innerHTML = '';
                            return;
                        }
                        var watchedCount = 0;
                        var totalRuntimeTicks = 0;
                        var resumableColItem = null;
                        var firstUnwatchedColItem = null;

                        rawColItems.forEach(function (ci) {
                            if (!ci) { return; }
                            if (ci.RunTimeTicks > 0) {
                                totalRuntimeTicks += Number(ci.RunTimeTicks);
                            }
                            var ud = ci.UserData || {};
                            if (ud.Played) {
                                watchedCount++;
                            } else if (!firstUnwatchedColItem) {
                                firstUnwatchedColItem = ci;
                            }
                            if (!resumableColItem && Number(ud.PlaybackPositionTicks) > 0) {
                                resumableColItem = ci;
                            }
                        });

                        firstPlayableTarget = resumableColItem || firstUnwatchedColItem || rawColItems[0];
                        var playBtnEl = qModal('#streamflix-modal-play-btn');
                        if (playBtnEl && firstPlayableTarget && firstPlayableTarget.Name) {
                            var ctaPrefix = resumableColItem
                                ? 'Resume '
                                : (watchedCount > 0 && firstUnwatchedColItem ? 'Continue: ' : (watchedCount === rawColItems.length ? 'Rewatch ' : 'Play '));
                            playBtnEl.innerHTML = iconLabel('play', ctaPrefix + firstPlayableTarget.Name);
                        }

                        var progressPct = Math.round((watchedCount / rawColItems.length) * 100);
                        var totalRtText = formatRuntimeTicks(totalRuntimeTicks);
                        var colSortMode = 'release';

                        var renderCollectionView = function () {
                            if (modalClosed || !modalBackdrop.parentNode) {
                                return;
                            }
                            var sorted = rawColItems.slice();
                            if (colSortMode === 'newest') {
                                sorted.sort(function (a, b) {
                                    return (Number(b.ProductionYear) || 0) - (Number(a.ProductionYear) || 0);
                                });
                            } else if (colSortMode === 'rating') {
                                sorted.sort(function (a, b) {
                                    return (Number(b.CommunityRating) || 0) - (Number(a.CommunityRating) || 0);
                                });
                            }
                            colContainer.innerHTML = ''
                                + '<div class="bfx-franchise-hub">'
                                + '  <div class="bfx-franchise-top">'
                                + '    <div>'
                                + '      <h3 class="bfx-franchise-heading">Franchise Collection (' + rawColItems.length + ')</h3>'
                                + '      <div class="bfx-franchise-sub">Watched ' + watchedCount + ' of ' + rawColItems.length + ' (' + progressPct + '%)' + (totalRtText ? ' · ' + escapeHtml(totalRtText.trim()) + ' total' : '') + '</div>'
                                + '    </div>'
                                + '    <div class="bfx-franchise-sorts" role="tablist" aria-label="Sort collection">'
                                + '      <button type="button" class="bfx-fran-sort-pill' + (colSortMode === 'release' ? ' active' : '') + '" data-col-sort="release">Release Order</button>'
                                + '      <button type="button" class="bfx-fran-sort-pill' + (colSortMode === 'newest' ? ' active' : '') + '" data-col-sort="newest">Newest</button>'
                                + '      <button type="button" class="bfx-fran-sort-pill' + (colSortMode === 'rating' ? ' active' : '') + '" data-col-sort="rating">Top Rated</button>'
                                + '    </div>'
                                + '  </div>'
                                + '  <div class="bfx-franchise-bar"><span style="width:' + progressPct + '%;"></span></div>'
                                + '  <div class="streamflix-grid">' + sorted.map(buildPosterCardHtml).join('') + '</div>'
                                + '</div>';

                            Array.prototype.forEach.call(colContainer.querySelectorAll('[data-col-sort]'), function (sBtn) {
                                sBtn.addEventListener('click', function () {
                                    colSortMode = sBtn.getAttribute('data-col-sort') || 'release';
                                    renderCollectionView();
                                });
                            });
                            bindInteractiveCardsInContainer(colContainer, sorted, function () {
                                closeModal(true);
                            });
                        };

                        renderCollectionView();
                    })
                    .catch(function () {
                        if (colContainer) {
                            colContainer.innerHTML = '';
                        }
                    });
            }
        }

        // If TV Series OR Episode of a Series, load Seasons & Episodes!
        var seriesIdForEpisodes = item.Type === 'Series' ? item.Id : (item.Type === 'Episode' ? item.SeriesId : null);
        if (seriesIdForEpisodes && auth.userId) {
            var epContainer = qModal('#streamflix-detail-episodes-section');
            if (epContainer) {
                epContainer.innerHTML = '<div style="color:#888;font-size:13px;">Loading episodes…</div>';
                apiFetch('/Shows/' + encodeURIComponent(seriesIdForEpisodes) + '/Episodes?userId=' + encodeURIComponent(auth.userId) + '&Fields=Overview,PrimaryImageAspectRatio,Path')
                    .then(function (res) {
                        var eps = (res && res.Items) || [];
                        if (!eps.length || !modalBackdrop.parentNode || modalClosed) {
                            epContainer.innerHTML = '';
                            return;
                        }
                        var epMap = {};
                        var seasonsMap = {};
                        var seasonNums = [];
                        var resumableEp = null;
                        var firstUnwatchedEp = null;

                        eps.forEach(function (ep) {
                            if (ep && ep.Id) {
                                epMap[ep.Id] = ep;
                            }
                            if (!resumableEp && ep.UserData && ep.UserData.PlaybackPositionTicks > 0) {
                                resumableEp = ep;
                            }
                            if (!firstUnwatchedEp && (!ep.UserData || !ep.UserData.Played)) {
                                firstUnwatchedEp = ep;
                            }
                            var sNum = ep.ParentIndexNumber || 1;
                            if (!seasonsMap[sNum]) {
                                seasonsMap[sNum] = [];
                                seasonNums.push(sNum);
                            }
                            seasonsMap[sNum].push(ep);
                        });

                        if (item.Type === 'Series') {
                            firstPlayableTarget = resumableEp || firstUnwatchedEp || eps[0];
                            var modalPlayBtn = qModal('#streamflix-modal-play-btn');
                            if (modalPlayBtn && firstPlayableTarget) {
                                var sTag = 'S' + (firstPlayableTarget.ParentIndexNumber || 1) + ':E' + (firstPlayableTarget.IndexNumber || 1);
                                modalPlayBtn.innerHTML = iconLabel('play', (resumableEp ? 'Resume ' : 'Play ') + sTag);
                            }
                        }

                        var selectedSeason = (item.Type === 'Episode' && item.ParentIndexNumber && seasonsMap[item.ParentIndexNumber])
                            ? item.ParentIndexNumber
                            : (firstPlayableTarget && firstPlayableTarget.ParentIndexNumber && seasonsMap[firstPlayableTarget.ParentIndexNumber]
                                ? firstPlayableTarget.ParentIndexNumber
                                : seasonNums[0]);

                        function renderSeasonEpisodes() {
                            if (modalClosed || !modalBackdrop.parentNode) {
                                return;
                            }
                            var seasonOpts = seasonNums.map(function (sNum) {
                                return '<option value="' + sNum + '"' + (sNum === selectedSeason ? ' selected' : '') + '>Season ' + sNum + ' (' + seasonsMap[sNum].length + ' Episodes)</option>';
                            }).join('');

                            var listHtml = (seasonsMap[selectedSeason] || []).map(function (ep, idx) {
                                var thumbUrl = getItemBackdropUrl(ep, 400);
                                var epDur = formatRuntimeTicks(ep.RunTimeTicks);
                                var pct = (ep.UserData && ep.UserData.PlayedPercentage) ? Math.round(ep.UserData.PlayedPercentage) : 0;
                                var isCurrentEp = (item.Type === 'Episode' && normalizeGuid(ep.Id) === normalizeGuid(item.Id))
                                    || (firstPlayableTarget && normalizeGuid(ep.Id) === normalizeGuid(firstPlayableTarget.Id));
                                var canDlEp = typeof canUserDownloadItem === 'function' && canUserDownloadItem(ep);
                                return ''
                                    + '<div class="streamflix-episode-row" tabindex="0" role="button" data-ep-id="' + escapeHtml(ep.Id) + '" style="' + (isCurrentEp ? 'background:rgba(229,9,20,0.12);border-left:3px solid #E50914;' : '') + '">'
                                    + '  <div class="streamflix-ep-index">' + (ep.IndexNumber || (idx + 1)) + '</div>'
                                    + '  <div class="streamflix-ep-thumb">'
                                    + '    <img loading="lazy" src="' + escapeHtml(thumbUrl) + '" alt="' + escapeHtml(ep.Name) + '" data-bfx-img="fade" />'
                                    + (pct > 0 ? '<div class="streamflix-progress-track"><div class="streamflix-progress-fill" style="width:' + pct + '%;"></div></div>' : '')
                                    + '  </div>'
                                    + '  <div style="flex:1;min-width:0;">'
                                    + '    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">'
                                    + '      <div style="font-size:14.5px;font-weight:700;color:#fff;">' + escapeHtml(ep.Name) + '</div>'
                                    + '      <div style="font-size:12px;color:#999;flex-shrink:0;">' + escapeHtml(epDur) + '</div>'
                                    + '    </div>'
                                    + '    <div style="font-size:12.5px;color:#a3a3ad;margin-top:4px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">'
                                    + escapeHtml(ep.Overview || '')
                                    + '    </div>'
                                    + '  </div>'
                                    + (canDlEp
                                        ? '  <button type="button" class="streamflix-ep-download-btn" data-ep-download-id="' + escapeHtml(ep.Id) + '" aria-label="Download Episode">' + icon('download') + '</button>'
                                        : '')
                                    + '</div>';
                            }).join('');

                            epContainer.innerHTML = ''
                                + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 14px 0;border-top:1px solid rgba(255,255,255,0.09);padding-top:18px;">'
                                + '  <h3 style="margin:0;font-size:18px;font-weight:800;letter-spacing:-0.01em;">Episodes</h3>'
                                + '  <div class="bfx-episodes-head-right">'
                                + (eps.length >= 2
                                    ? '    <button type="button" class="bfx-ep-shuffle-btn" id="streamflix-modal-shuffle-ep-btn" data-bfx-tip="Play a random episode" aria-label="Shuffle episodes">' + icon('shuffle') + '<span>Shuffle</span></button>'
                                    : '')
                                + (seasonNums.length > 1 ? '    <select id="streamflix-season-select" class="streamflix-select" style="width:auto;min-width:172px;height:36px;padding:0 12px;font-size:13px;">' + seasonOpts + '</select>' : '')
                                + '  </div>'
                                + '</div>'
                                + '<div>' + listHtml + '</div>';

                            hydrateCompleteImages(epContainer);

                            var shuffleEpBtn = epContainer.querySelector('#streamflix-modal-shuffle-ep-btn');
                            if (shuffleEpBtn) {
                                shuffleEpBtn.addEventListener('click', function () {
                                    var unwatchedPool = eps.filter(function (e) { return e && (!e.UserData || !e.UserData.Played); });
                                    var pool = unwatchedPool.length >= 2 ? unwatchedPool : eps;
                                    var pick = pool[Math.floor(Math.random() * pool.length)];
                                    if (pick) {
                                        closeModal(true);
                                        playItemImmediately(pick, selectedAudioStreamIndex, selectedSubtitleStreamIndex);
                                    }
                                });
                            }

                            var sSel = epContainer.querySelector('#streamflix-season-select');
                            if (sSel) {
                                sSel.addEventListener('change', function () {
                                    selectedSeason = parseInt(sSel.value, 10) || seasonNums[0];
                                    renderSeasonEpisodes();
                                });
                            }

                            Array.prototype.forEach.call(epContainer.querySelectorAll('[data-ep-download-id]'), function (dlBtn) {
                                dlBtn.addEventListener('click', function (ev) {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    var epId = dlBtn.getAttribute('data-ep-download-id');
                                    var epObj = epMap[epId] || epId;
                                    if (typeof triggerDirectMediaDownload === 'function') {
                                        triggerDirectMediaDownload(epObj);
                                    }
                                });
                                dlBtn.addEventListener('keydown', function (ev) {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.stopPropagation();
                                    }
                                });
                            });

                            Array.prototype.forEach.call(epContainer.querySelectorAll('[data-ep-id]'), function (row) {
                                var triggerEp = function () {
                                    var epId = row.getAttribute('data-ep-id');
                                    var epObj = epMap[epId] || epId;
                                    closeModal(true);
                                    playItemImmediately(epObj, selectedAudioStreamIndex, selectedSubtitleStreamIndex);
                                };
                                row.addEventListener('click', triggerEp);
                                row.addEventListener('keydown', function (ev) {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault();
                                        triggerEp();
                                    }
                                });
                            });
                        }
                        renderSeasonEpisodes();
                    })
                    .catch(function () {
                        if (epContainer) {
                            epContainer.innerHTML = '';
                        }
                    });
            }
        }

        // If Live TV Channel or airing Program, load upcoming EPG schedule + active DVR timers for this channel
        var schedChannelId = item.Type === 'TvChannel' ? item.Id : (item.Type === 'Program' ? item.ChannelId : '');
        if (schedChannelId && auth.userId) {
            var schedContainer = qModal('#streamflix-detail-episodes-section');
            if (schedContainer) {
                var pSchedProgs = apiFetch('/LiveTv/Programs?ChannelIds=' + encodeURIComponent(schedChannelId) + '&userId=' + encodeURIComponent(auth.userId) + '&HasAired=false&Limit=8&Fields=Overview')
                    .catch(function () { return { Items: [] }; });
                var pSchedTimers = apiFetch('/LiveTv/Timers')
                    .catch(function () { return { Items: [] }; });

                Promise.all([pSchedProgs, pSchedTimers])
                    .then(function (sArr) {
                        var progs = (sArr[0] && Array.isArray(sArr[0].Items)) ? sArr[0].Items : [];
                        var timers = (sArr[1] && Array.isArray(sArr[1].Items)) ? sArr[1].Items : [];
                        if (!modalBackdrop.parentNode || modalClosed) {
                            return;
                        }
                        var timerByProg = {};
                        timers.forEach(function (tm) {
                            if (tm && tm.Id && tm.ProgramId && String(tm.Status || '').toLowerCase() !== 'cancelled') {
                                timerByProg[normalizeGuid(tm.ProgramId)] = String(tm.Id);
                            }
                        });
                        if (recordableProgram && recordableProgram.Id && timerByProg[normalizeGuid(recordableProgram.Id)] && !recordableProgram.TimerId) {
                            recordableProgram.TimerId = timerByProg[normalizeGuid(recordableProgram.Id)];
                            if (recordModalBtn) {
                                recordModalBtn.classList.add('is-recording');
                                recordModalBtn.innerHTML = iconLabel('recordDot', 'Scheduled');
                                recordModalBtn.title = 'Cancel scheduled DVR recording';
                            }
                        }
                        if (!progs.length) {
                            return;
                        }
                        var nowMs = Date.now();
                        var rows = progs.map(function (pr, pIdx) {
                            if (pr && pr.Id && !pr.TimerId && timerByProg[normalizeGuid(pr.Id)]) {
                                pr.TimerId = timerByProg[normalizeGuid(pr.Id)];
                            }
                            var sMs = pr.StartDate ? Date.parse(pr.StartDate) : NaN;
                            var eMs = pr.EndDate ? Date.parse(pr.EndDate) : NaN;
                            var airing = !isNaN(sMs) && !isNaN(eMs) && nowMs >= sMs && nowMs < eMs;
                            var hasRec = Boolean(resolveProgramTimerId(pr));
                            var tWin = formatShortProgTime(pr);
                            return ''
                                + '<div class="bfx-ltv-sched-row' + (airing ? ' is-airing' : '') + '">'
                                + '  <div class="bfx-ltv-sched-time">'
                                + (airing ? '<span class="bfx-ltv-live-dot"></span><span>LIVE</span>' : ('<span>' + escapeHtml(tWin || 'Upcoming') + '</span>'))
                                + '  </div>'
                                + '  <div class="bfx-ltv-sched-main">'
                                + '    <div class="bfx-ltv-sched-title">' + escapeHtml(pr.Name || 'Program') + (pr.EpisodeTitle ? (' <span class="bfx-ltv-sched-ep">· ' + escapeHtml(pr.EpisodeTitle) + '</span>') : '') + '</div>'
                                + (airing && tWin ? ('    <div class="bfx-ltv-sched-sub">' + escapeHtml(tWin) + '</div>') : '')
                                + (pr.Overview ? ('    <div class="bfx-ltv-sched-desc">' + escapeHtml(pr.Overview) + '</div>') : '')
                                + '  </div>'
                                + (pr && pr.Id
                                    ? ('  <button type="button" class="streamflix-ghost-btn bfx-sched-rec-btn bfx-dvr-record-btn' + (hasRec ? ' is-recording' : '') + '" data-sched-rec-idx="' + pIdx + '" title="' + (hasRec ? 'Cancel scheduled recording' : 'Record this program') + '">' + icon('recordDot') + '<span>' + (hasRec ? 'REC' : 'Record') + '</span></button>')
                                    : '')
                                + '</div>';
                        }).join('');
                        schedContainer.innerHTML = ''
                            + '<h3 class="streamflix-detail-h3" style="margin-bottom:12px;">Schedule</h3>'
                            + '<div class="bfx-ltv-sched-list">' + rows + '</div>';
                        Array.prototype.forEach.call(schedContainer.querySelectorAll('button[data-sched-rec-idx]'), function (rBtn) {
                            rBtn.addEventListener('click', function (ev) {
                                ev.preventDefault();
                                ev.stopPropagation();
                                var idx = parseInt(rBtn.getAttribute('data-sched-rec-idx'), 10);
                                if (!isNaN(idx) && progs[idx]) {
                                    toggleProgramDvrTimer(progs[idx], rBtn, true);
                                }
                            });
                        });
                    })
                    .catch(function () {});
            }
        }

        // Load Similar Titles ("More Like This")
        if (auth.userId && !isLiveTvItem) {
            var simTargetId = (item.Type === 'Episode' && item.SeriesId) ? item.SeriesId : item.Id;
            var simContainer = qModal('#streamflix-detail-similar-section');
            if (simContainer) {
                apiFetch('/Items/' + encodeURIComponent(simTargetId) + '/Similar?userId=' + encodeURIComponent(auth.userId) + '&Limit=8&Fields=Overview,Genres')
                    .then(function (res) {
                        var sims = (res && res.Items) || [];
                        if (!sims.length || !modalBackdrop.parentNode || modalClosed) {
                            return;
                        }
                        var cards = sims.map(buildPosterCardHtml).join('');
                        simContainer.innerHTML = ''
                            + '<h3 class="streamflix-detail-h3">More Like This</h3>'
                            + '<div class="streamflix-grid streamflix-detail-grid">' + cards + '</div>';
                        bindInteractiveCardsInContainer(simContainer, sims, function () {
                            closeModal(true);
                        });
                    })
                    .catch(function () {});
            }
        }
    }
