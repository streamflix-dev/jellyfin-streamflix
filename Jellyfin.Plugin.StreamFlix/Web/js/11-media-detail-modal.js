/* StreamFlix Client (11/14) — Media Detail Modal, Seasons & Episode Picker */
    /* ----------------------------------------------------------------------
       7. Rich Netflix Media Detail Modal ('The Devil Wears Prada 2' Style Everywhere)
       ---------------------------------------------------------------------- */
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

        var backdropUrl = safeCssUrl(getItemBackdropUrl(item, 1600));
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var rating = item.OfficialRating ? String(item.OfficialRating) : '';
        var runtime = formatRuntimeTicks(item.RunTimeTicks);
        var genres = Array.isArray(item.Genres) && item.Genres.length ? item.Genres.slice(0, 4) : [];
        var community = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        var hasResume = item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0;
        var resumePct = hasResume && item.RunTimeTicks
            ? Math.min(100, Math.max(2, Math.round(item.UserData.PlaybackPositionTicks / item.RunTimeTicks * 100)))
            : 0;
        var resumeLeftText = resumePct ? formatTimeLeft(item) : '';
        var brandInitial = getBrandLogoText().charAt(0) || 'S';
        var modalTopRank = getTop10Rank(item && item.Id);
        var modalLogoUrl = getItemLogoUrl(item, 720);

        var typeBadge = item.Type === 'Series'
            ? 'SERIES'
            : (item.Type === 'BoxSet' ? 'COLLECTION' : (item.Type === 'Episode' ? 'EPISODE' : 'FILM'));
        var displayTitle = (item.Type === 'Episode' && item.SeriesName) ? item.SeriesName : (item.Name || 'Untitled');
        var episodeSubline = item.Type === 'Episode'
            ? ('Season ' + (item.ParentIndexNumber || 1) + ' • Episode ' + (item.IndexNumber || 1) + ' — ' + (item.Name || ''))
            : '';

        var playBtnInitialLabel = iconLabel('play', item.Type === 'BoxSet' ? 'Play Collection' : (hasResume ? 'Resume' : 'Play'));
        var genreChipsHtml = genres.length
            ? '<span class="streamflix-detail-genre-chips">' + genres.map(function (g) {
                return '<button type="button" class="streamflix-genre-chip" data-filter-genre="' + escapeHtml(g) + '" title="Browse ' + escapeHtml(g) + '">' + escapeHtml(g) + '</button>';
            }).join('') + '</span>'
            : '';

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

        var modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'streamflix-modal-backdrop';
        modalBackdrop.innerHTML = ''
            + '<div class="streamflix-detail-modal">'
            + '  <div class="streamflix-detail-scroll">'
            + '    <div class="streamflix-detail-hero" id="streamflix-modal-hero-banner"' + (backdropUrl ? ' style="background-image:url(\'' + escapeHtml(backdropUrl) + '\');"' : '') + '>'
            + '      <button type="button" class="streamflix-detail-close" id="streamflix-detail-close-btn" aria-label="Close">' + icon('close') + '</button>'
            + '      <div style="position:relative;z-index:2;max-width:680px;">'
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
            + (episodeSubline ? '<div style="font-size:15px;font-weight:700;color:#e5e5e5;margin:0 0 14px 0;text-shadow:0 2px 10px rgba(0,0,0,0.9);">' + escapeHtml(episodeSubline) + '</div>' : '')
            + (resumePct
                ? '<div class="streamflix-detail-resume" id="streamflix-modal-resume-row"><div class="streamflix-hero-progress-bar"><span style="width:' + resumePct + '%;"></span></div>' + (resumeLeftText ? '<span>' + escapeHtml(resumeLeftText) + '</span>' : '') + '</div>'
                : '')
            + '        <div class="streamflix-hero-actions">'
            + '          <button type="button" class="streamflix-hero-play" id="streamflix-modal-play-btn">' + playBtnInitialLabel + '</button>'
            + (opts.fromSurprise
                ? '          <button type="button" class="streamflix-hero-secondary streamflix-modal-reshuffle" id="streamflix-modal-reshuffle-btn" title="Pick another random title">' + iconLabel('shuffle', 'Shuffle Again') + '</button>'
                : '')
            + '          <button type="button" class="streamflix-hero-icon-btn' + (isFav ? ' active' : '') + '" id="streamflix-modal-fav-btn" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
            + '          <button type="button" class="streamflix-hero-icon-btn' + (isPlayed ? ' active' : '') + '" id="streamflix-modal-watched-btn" title="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>'
            + ((typeof isWatchTogetherEnabled === 'function' && isWatchTogetherEnabled())
                ? '          <button type="button" class="streamflix-hero-icon-btn' + ((typeof watchPartyState !== 'undefined' && watchPartyState.activeGroup) ? ' active is-live' : '') + '" id="streamflix-modal-watchparty-btn" title="Watch Together" aria-label="Watch Together">' + icon('party') + '</button>'
                : '')
            + '        </div>'
            + '      </div>'
            + '    </div>'
            + '    <div class="streamflix-detail-body">'
            + '      <div class="streamflix-hero-meta-row" id="streamflix-modal-meta-row" style="margin-top:8px;">'
            + (community ? '<span class="streamflix-hero-rating">' + icon('star') + escapeHtml(community) + '</span>' : '')
            + (year ? '<span>' + escapeHtml(year) + '</span>' : '')
            + (rating ? '<span class="streamflix-maturity-pill">' + escapeHtml(rating) + '</span>' : '')
            + (runtime ? '<span>' + escapeHtml(runtime.trim()) + '</span>' : '')
            + genreChipsHtml
            + '      </div>'
            + '      <div id="streamflix-modal-tagline" class="streamflix-detail-tagline"' + (initialTagline ? '' : ' style="display:none;"') + '>' + escapeHtml(initialTagline) + '</div>'
            + '      <p id="streamflix-modal-overview" class="streamflix-detail-overview">'
            + escapeHtml(item.Overview || 'No description available.')
            + '      </p>'
            + '      <div id="streamflix-modal-tracks-container"></div>'
            + '      <div id="streamflix-modal-credits-container"></div>'
            + '      <div id="streamflix-detail-episodes-section"></div>'
            + '      <div id="streamflix-detail-similar-section" style="margin-top:26px;"></div>'
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

        var mainPlayBtn = qModal('#streamflix-modal-play-btn');
        if (mainPlayBtn) {
            mainPlayBtn.addEventListener('click', function () {
                closeModal(true);
                playItemImmediately(firstPlayableTarget || resolvedItem || item, selectedAudioStreamIndex, selectedSubtitleStreamIndex);
            });
        }

        var favBtn = qModal('#streamflix-modal-fav-btn');
        if (favBtn) {
            favBtn.addEventListener('click', function () {
                var nextFav = !(item.UserData && item.UserData.IsFavorite);
                favBtn.innerHTML = icon(nextFav ? 'check' : 'plus');
                favBtn.classList.toggle('active', nextFav);
                favBtn.title = nextFav ? 'Remove from My List' : 'Add to My List';
                toggleFavoriteItem(item, null);
            });
        }

        var watchedBtn = qModal('#streamflix-modal-watched-btn');
        if (watchedBtn) {
            watchedBtn.addEventListener('click', function () {
                var nextPlayed = !(item.UserData && item.UserData.Played);
                watchedBtn.classList.toggle('active', nextPlayed);
                watchedBtn.title = nextPlayed ? 'Mark unwatched' : 'Mark watched';
                togglePlayedItem(item, null);
            });
        }

        var watchPartyBtn = qModal('#streamflix-modal-watchparty-btn');
        if (watchPartyBtn) {
            watchPartyBtn.addEventListener('click', function () {
                if (typeof openWatchTogetherModal === 'function') {
                    openWatchTogetherModal({
                        item: resolvedItem || item,
                        playableTarget: firstPlayableTarget || resolvedItem || item
                    });
                }
            });
        }

        var reshuffleBtn = qModal('#streamflix-modal-reshuffle-btn');
        if (reshuffleBtn) {
            reshuffleBtn.addEventListener('click', function () {
                triggerSurpriseMe();
            });
        }

        function bindGenreChipsInModal() {
            var metaRow = qModal('#streamflix-modal-meta-row');
            if (!metaRow) {
                return;
            }
            Array.prototype.forEach.call(metaRow.querySelectorAll('[data-filter-genre]'), function (chip) {
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
            var betterBg = safeCssUrl(getItemBackdropUrl(fullItem, 1600));
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
            if (!genres.length && Array.isArray(fullItem.Genres) && fullItem.Genres.length) {
                var metaRowEl = qModal('#streamflix-modal-meta-row');
                if (metaRowEl && !metaRowEl.querySelector('.streamflix-detail-genre-chips')) {
                    var lateGenres = fullItem.Genres.slice(0, 4);
                    metaRowEl.insertAdjacentHTML('beforeend', '<span class="streamflix-detail-genre-chips">' + lateGenres.map(function (g) {
                        return '<button type="button" class="streamflix-genre-chip" data-filter-genre="' + escapeHtml(g) + '" title="Browse ' + escapeHtml(g) + '">' + escapeHtml(g) + '</button>';
                    }).join('') + '</span>');
                    bindGenreChipsInModal();
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

            // Render Audio & Subtitle track selector pills if MediaStreams exist
            var streams = (fullItem.MediaStreams && fullItem.MediaStreams.length)
                ? fullItem.MediaStreams
                : ((fullItem.MediaSources && fullItem.MediaSources[0] && fullItem.MediaSources[0].MediaStreams) || []);
            var videoStreams = streams.filter(function (s) { return s.Type === 'Video'; });
            var audioStreams = streams.filter(function (s) { return s.Type === 'Audio'; });
            var subStreams = streams.filter(function (s) { return s.Type === 'Subtitle'; });

            var tracksEl = qModal('#streamflix-modal-tracks-container');
            if (tracksEl && (videoStreams.length > 0 || audioStreams.length > 0 || subStreams.length > 0)) {
                var pillsHtml = '';
                if (videoStreams.length > 0) {
                    var vLabel = videoStreams[0].DisplayTitle || videoStreams[0].Codec || 'HD';
                    pillsHtml += '<div class="streamflix-modal-track-pill"><span class="track-label">Video</span><span style="font-weight:700;color:#fff;">' + escapeHtml(vLabel) + '</span></div>';
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
                tracksEl.innerHTML = '<div class="streamflix-modal-tracks-row">' + pillsHtml + '</div>';

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

            // Render Director / Cast / External Links (IMDb, TMDB)
            var creditsEl = qModal('#streamflix-modal-credits-container');
            if (creditsEl) {
                var people = Array.isArray(fullItem.People) ? fullItem.People : [];
                var directors = people.filter(function (p) { return p && p.Type === 'Director' && p.Name; }).slice(0, 3);
                var cast = people.filter(function (p) { return p && p.Type === 'Actor' && p.Name; }).slice(0, 6);
                var extUrls = (Array.isArray(fullItem.ExternalUrls) ? fullItem.ExternalUrls : []).filter(function (u) {
                    return u && u.Name && typeof u.Url === 'string' && /^https?:\/\//i.test(u.Url.trim());
                });

                var renderPersonChips = function (list, roleType) {
                    return list.map(function (p) {
                        var roleHint = (roleType === 'Actor' && p.Role)
                            ? ('as ' + p.Role + ' — click to browse titles')
                            : ('Browse titles with ' + p.Name);
                        return '<button type="button" class="streamflix-credit-chip" data-person-name="' + escapeHtml(p.Name) + '" data-person-id="' + escapeHtml(p.Id || '') + '" data-person-role="' + escapeHtml(roleType) + '" title="' + escapeHtml(roleHint) + '">' + escapeHtml(p.Name) + '</button>';
                    }).join('');
                };

                var credParts = [];
                if (directors.length) {
                    credParts.push('<div class="streamflix-credit-line"><span class="streamflix-credit-label">Director:</span><span class="streamflix-credit-list">' + renderPersonChips(directors, 'Director') + '</span></div>');
                }
                if (cast.length) {
                    credParts.push('<div class="streamflix-credit-line"><span class="streamflix-credit-label">Cast:</span><span class="streamflix-credit-list">' + renderPersonChips(cast, 'Actor') + '</span></div>');
                }
                if (extUrls.length) {
                    var linksHtml = extUrls.map(function (u) {
                        return '<a href="' + escapeHtml(u.Url.trim()) + '" target="_blank" rel="noopener noreferrer" class="streamflix-ext-badge">' + escapeHtml(u.Name) + '</a>';
                    }).join('');
                    credParts.push('<div class="streamflix-ext-row">' + linksHtml + '</div>');
                }
                if (credParts.length) {
                    creditsEl.innerHTML = '<div class="streamflix-credits-block">' + credParts.join('') + '</div>';
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
                apiFetch('/Shows/' + encodeURIComponent(seriesIdForEpisodes) + '/Episodes?userId=' + encodeURIComponent(auth.userId) + '&Fields=Overview,PrimaryImageAspectRatio')
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
                                return ''
                                    + '<div class="streamflix-episode-row" tabindex="0" role="button" data-ep-id="' + escapeHtml(ep.Id) + '" style="' + (isCurrentEp ? 'background:rgba(229,9,20,0.14);border-left:3px solid #E50914;' : '') + '">'
                                    + '  <div class="streamflix-ep-index">' + (ep.IndexNumber || (idx + 1)) + '</div>'
                                    + '  <div class="streamflix-ep-thumb">'
                                    + '    <img loading="lazy" src="' + escapeHtml(thumbUrl) + '" alt="' + escapeHtml(ep.Name) + '" data-bfx-img="fade" />'
                                    + (pct > 0 ? '<div class="streamflix-progress-track"><div class="streamflix-progress-fill" style="width:' + pct + '%;"></div></div>' : '')
                                    + '  </div>'
                                    + '  <div style="flex:1;min-width:0;">'
                                    + '    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">'
                                    + '      <div style="font-size:14.5px;font-weight:800;color:#fff;">' + escapeHtml(ep.Name) + '</div>'
                                    + '      <div style="font-size:12px;color:#999;flex-shrink:0;">' + escapeHtml(epDur) + '</div>'
                                    + '    </div>'
                                    + '    <div style="font-size:12.5px;color:#aaa;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">'
                                    + escapeHtml(ep.Overview || '')
                                    + '    </div>'
                                    + '  </div>'
                                    + '</div>';
                            }).join('');

                            epContainer.innerHTML = ''
                                + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:18px;">'
                                + '  <h3 style="margin:0;font-size:19px;font-weight:800;">Episodes</h3>'
                                + (seasonNums.length > 1 ? '<select id="streamflix-season-select" class="streamflix-select" style="width:auto;min-width:180px;">' + seasonOpts + '</select>' : '')
                                + '</div>'
                                + '<div>' + listHtml + '</div>';

                            hydrateCompleteImages(epContainer);

                            var sSel = epContainer.querySelector('#streamflix-season-select');
                            if (sSel) {
                                sSel.addEventListener('change', function () {
                                    selectedSeason = parseInt(sSel.value, 10) || seasonNums[0];
                                    renderSeasonEpisodes();
                                });
                            }

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

        // Load Similar Titles ("More Like This")
        if (auth.userId) {
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
