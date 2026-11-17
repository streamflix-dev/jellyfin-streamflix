/* StreamFlix Client (08/14) — Cinema Hub, Hero Billboard, Top 10 & Live Search */
    /* ----------------------------------------------------------------------
       6. FULL STREAMFLIX CINEMA HUB (Hero Billboard, Live Search, Top 10 & Carousels)
       ---------------------------------------------------------------------- */
    function isOnHomeRoute() {
        var h = (window.location.hash || '').toLowerCase();
        return h === '' || h === '#' || h === '#/' || h === '#!/' || h.indexOf('#/home') === 0 || h.indexOf('#!/home') === 0 || h.indexOf('#/index') === 0 || h.indexOf('#!/index') === 0;
    }

    function getJellyfinAuthContext() {
        var ac = typeof resolveActiveApiClient === 'function' ? resolveActiveApiClient() : window.ApiClient;
        var userId = (state.activeProfile && state.activeProfile.jellyfinUserId)
            || getActiveUserId()
            || (ac && typeof ac.getCurrentUserId === 'function' ? ac.getCurrentUserId() : null);
        var token = (state.activeProfile && state.activeProfile.accessToken)
            || getActiveToken()
            || (ac && typeof ac.accessToken === 'function' ? ac.accessToken() : null);
        return { userId: userId, token: token };
    }

    function getItemBackdropUrl(item, maxWidth) {
        if (!item) {
            return '';
        }
        var w = maxWidth || 1280;
        if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
            return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Backdrop/0?maxWidth=' + w + '&quality=85';
        }
        if (item.ParentBackdropItemId && (!item.ParentBackdropImageTags || item.ParentBackdropImageTags.length > 0)) {
            return apiBase() + '/Items/' + encodeURIComponent(item.ParentBackdropItemId) + '/Images/Backdrop/0?maxWidth=' + w + '&quality=85';
        }
        if (item.Type === 'Episode' && item.ImageTags && item.ImageTags.Primary) {
            return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Primary?maxWidth=' + w + '&quality=85';
        }
        if (item.ImageTags && item.ImageTags.Thumb) {
            return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Thumb?maxWidth=' + w + '&quality=85';
        }
        if (item.SeriesId) {
            return apiBase() + '/Items/' + encodeURIComponent(item.SeriesId) + '/Images/Backdrop/0?maxWidth=' + w + '&quality=85';
        }
        return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Primary?maxWidth=' + w + '&quality=85';
    }

    function getItemPosterUrl(item, maxWidth) {
        if (!item || !item.Id) {
            return '';
        }
        if (item.ImageTags && typeof item.ImageTags === 'object') {
            var isEp = item.Type === 'Episode' && Boolean(item.SeriesId);
            var hasTag = isEp
                ? Boolean(item.SeriesPrimaryImageTag || item.ImageTags.Primary || item.ImageTags.Thumb)
                : Boolean(item.ImageTags.Primary || item.ImageTags.Thumb || (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length > 0));
            if (!hasTag) {
                return '';
            }
            if (!isEp && !item.ImageTags.Primary && item.ImageTags.Thumb) {
                return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Thumb?maxWidth=' + (maxWidth || 420) + '&quality=85';
            }
            if (!isEp && !item.ImageTags.Primary && Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length > 0) {
                return apiBase() + '/Items/' + encodeURIComponent(item.Id) + '/Images/Backdrop/0?maxWidth=' + (maxWidth || 420) + '&quality=85';
            }
        }
        var w = maxWidth || 420;
        var targetId = (item.Type === 'Episode' && item.SeriesId) ? item.SeriesId : item.Id;
        return apiBase() + '/Items/' + encodeURIComponent(targetId) + '/Images/Primary?maxWidth=' + w + '&quality=85';
    }

    function formatRuntimeTicks(ticks) {
        if (!ticks || ticks <= 0) {
            return '';
        }
        var totalMins = Math.round(ticks / 600000000);
        if (totalMins < 60) {
            return totalMins + 'm';
        }
        var hrs = Math.floor(totalMins / 60);
        var mins = totalMins % 60;
        return hrs + 'h ' + (mins > 0 ? mins + 'm' : '');
    }

    function toggleFavoriteItem(item, btnEl) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token || !item || !item.Id) {
            return;
        }
        var uid = encodeURIComponent(auth.userId);
        var iid = encodeURIComponent(item.Id);
        var isFav = item.UserData && item.UserData.IsFavorite;
        var method = isFav ? 'DELETE' : 'POST';
        apiFetch('/UserFavoriteItems/' + iid + '?userId=' + uid, {
            method: method
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/FavoriteItems/' + iid, {
                method: method
            });
        }).then(function (userData) {
            item.UserData = userData || item.UserData || {};
            item.UserData.IsFavorite = !isFav;
            if (btnEl) {
                btnEl.classList.toggle('active', item.UserData.IsFavorite);
                btnEl.innerHTML = item.UserData.IsFavorite ? icon('check') : icon('plus');
                btnEl.title = item.UserData.IsFavorite ? 'Remove from My List' : 'Add to My List';
            }
            if (state.personalRowsByUser && auth.userId) {
                delete state.personalRowsByUser[auth.userId];
            }
            loadCinemaHubData(true);
        }).catch(function () {});
    }

    function togglePlayedItem(item, btnEl) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token || !item || !item.Id) {
            return;
        }
        var uid = encodeURIComponent(auth.userId);
        var iid = encodeURIComponent(item.Id);
        var isPlayed = item.UserData && item.UserData.Played;
        var method = isPlayed ? 'DELETE' : 'POST';
        apiFetch('/UserPlayedItems/' + iid + '?userId=' + uid, {
            method: method
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/PlayedItems/' + iid, {
                method: method
            });
        }).then(function (userData) {
            item.UserData = userData || item.UserData || {};
            item.UserData.Played = !isPlayed;
            if (btnEl) {
                btnEl.classList.toggle('active', item.UserData.Played);
            }
            if (state.personalRowsByUser && auth.userId) {
                delete state.personalRowsByUser[auth.userId];
            }
            loadCinemaHubData(true);
        }).catch(function () {});
    }

    function syncServerPlaybackPosition(itemId, ticks, fallbackUnplayed) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token || !itemId) {
            return Promise.resolve();
        }
        var uid = encodeURIComponent(auth.userId);
        var iid = encodeURIComponent(itemId);
        var payload = JSON.stringify({ PlaybackPositionTicks: Math.max(0, Math.round(Number(ticks) || 0)) });
        var reqOpts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        };
        return apiFetch('/Users/' + uid + '/Items/' + iid + '/UserData', reqOpts)
            .catch(function () {
                return apiFetch('/Items/' + iid + '/UserData?userId=' + uid, reqOpts);
            })
            .catch(function () {
                if (fallbackUnplayed && !ticks) {
                    return apiFetch('/UserPlayedItems/' + iid + '?userId=' + uid, { method: 'DELETE' });
                }
            })
            .catch(function () {});
    }

    function removeFromContinueWatching(item) {
        if (!item || !item.Id) {
            return;
        }
        var ud = item.UserData || {};
        var prevTicks = Number(ud.PlaybackPositionTicks) || 0;
        var prevPct = Number(ud.PlayedPercentage) || 0;
        var wasPlayed = Boolean(ud.Played);
        var normId = normalizeGuid(item.Id);
        var resumeList = (state.hubData && Array.isArray(state.hubData.resumeItems)) ? state.hubData.resumeItems : [];
        var prevIndex = -1;
        for (var i = 0; i < resumeList.length; i++) {
            if (resumeList[i] && normalizeGuid(resumeList[i].Id) === normId) {
                prevIndex = i;
                if (!prevTicks && resumeList[i].UserData) {
                    prevTicks = Number(resumeList[i].UserData.PlaybackPositionTicks) || 0;
                    prevPct = Number(resumeList[i].UserData.PlayedPercentage) || prevPct;
                }
                break;
            }
        }

        hidePreviewNow();

        var assignUserData = function (target, patchObj) {
            if (!target) {
                return;
            }
            var nextUd = {};
            var srcUd = target.UserData || {};
            Object.keys(srcUd).forEach(function (k) { nextUd[k] = srcUd[k]; });
            Object.keys(patchObj).forEach(function (k) { nextUd[k] = patchObj[k]; });
            target.UserData = nextUd;
        };
        var clearItemProgress = function (target) {
            if (target && target.UserData) {
                assignUserData(target, { PlaybackPositionTicks: 0, PlayedPercentage: 0 });
            }
        };
        clearItemProgress(item);
        if (state.itemCache[item.Id]) {
            clearItemProgress(state.itemCache[item.Id]);
        }
        if (state.hubData && Array.isArray(state.hubData.resumeItems)) {
            state.hubData.resumeItems = state.hubData.resumeItems.filter(function (x) {
                if (x && normalizeGuid(x.Id) === normId) {
                    clearItemProgress(x);
                    return false;
                }
                return true;
            });
        }
        renderCinemaHubContents();
        syncServerPlaybackPosition(item.Id, 0, !wasPlayed);

        var displayName = item.SeriesName ? (item.SeriesName + (item.Name ? ' · ' + item.Name : '')) : (item.Name || 'Title');
        showActionToast('Removed “' + displayName + '” from Continue Watching', 'Undo', function () {
            var restoreProgress = function (target) {
                if (!target) {
                    return;
                }
                var nextTicks = prevTicks || 6000000000;
                var nextPct = prevPct > 0
                    ? prevPct
                    : (target.RunTimeTicks > 0 && nextTicks > 0
                        ? Math.min(99, Math.max(2, Math.round(nextTicks / target.RunTimeTicks * 100)))
                        : 25);
                assignUserData(target, { PlaybackPositionTicks: nextTicks, PlayedPercentage: nextPct });
            };
            restoreProgress(item);
            if (state.itemCache[item.Id]) {
                restoreProgress(state.itemCache[item.Id]);
            }
            if (state.hubData) {
                var cur = Array.isArray(state.hubData.resumeItems) ? state.hubData.resumeItems.slice() : [];
                var exists = cur.some(function (x) { return x && normalizeGuid(x.Id) === normId; });
                if (!exists) {
                    var insertAt = prevIndex >= 0 ? Math.min(prevIndex, cur.length) : 0;
                    cur.splice(insertAt, 0, item);
                    state.hubData.resumeItems = cur;
                }
            }
            renderCinemaHubContents();
            syncServerPlaybackPosition(item.Id, prevTicks || 6000000000, false);
            showToast('Restored “' + displayName + '”', 'success', 2400);
        }, 5000);
    }

    function showPlaybackLoader(labelText) {
        try {
            document.body.classList.add('streamflix-autoplaying');
            var loader = document.getElementById('streamflix-playback-loader');
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'streamflix-playback-loader';
                loader.innerHTML = ''
                    + '<div class="streamflix-spinner-ring"></div>'
                    + '<div class="streamflix-loader-text" style="font-size:15px;font-weight:700;letter-spacing:0.4px;color:#e5e5e5;">'
                    + escapeHtml(labelText || 'Starting playback…')
                    + '</div>';
                document.body.appendChild(loader);
            }
            if (state.loaderSafetyTimeout) {
                clearTimeout(state.loaderSafetyTimeout);
            }
            state.loaderSafetyTimeout = setTimeout(function () {
                hidePlaybackLoader();
            }, 8000);
        } catch (e) {}
    }

    function hidePlaybackLoader() {
        state.autoPlayPending = null;
        if (state.autoPlayTimer) {
            clearInterval(state.autoPlayTimer);
            state.autoPlayTimer = null;
        }
        if (state.shortcutPollTimer) {
            clearInterval(state.shortcutPollTimer);
            state.shortcutPollTimer = null;
        }
        if (state.loaderSafetyTimeout) {
            clearTimeout(state.loaderSafetyTimeout);
            state.loaderSafetyTimeout = null;
        }
        document.body.classList.remove('streamflix-autoplaying');
        var loader = document.getElementById('streamflix-playback-loader');
        if (loader && loader.parentNode) {
            loader.parentNode.removeChild(loader);
        }
    }

    function findCachedItemById(itemId) {
        if (!itemId) {
            return null;
        }
        if (state.itemCache && state.itemCache[itemId]) {
            return state.itemCache[itemId];
        }
        var norm = normalizeGuid(itemId);
        var d = state.hubData || {};
        var lists = [
            d.heroItems, d.resumeItems, d.nextUpItems, d.top10Items,
            d.favoriteItems, d.recentMovies, d.recentSeries,
            d.allMovies, d.allSeries, d.collectionsItems,
            state.searchResults, state.browseFilter && state.browseFilter.items
        ];
        for (var i = 0; i < lists.length; i++) {
            var arr = lists[i];
            if (!Array.isArray(arr)) {
                continue;
            }
            for (var j = 0; j < arr.length; j++) {
                if (arr[j] && normalizeGuid(arr[j].Id) === norm) {
                    return arr[j];
                }
            }
        }
        return null;
    }

    function resolvePlayableItem(itemOrId) {
        var initialObj = (itemOrId && typeof itemOrId === 'object') ? itemOrId : null;
        var rawId = typeof itemOrId === 'string' ? itemOrId : (initialObj && initialObj.Id);
        if (!rawId) {
            return Promise.resolve(null);
        }

        var cached = initialObj || findCachedItemById(rawId);
        var itemPromise = (cached && cached.Type)
            ? Promise.resolve(cached)
            : fetchFullItemDetails(rawId).catch(function () { return cached || { Id: rawId, Type: 'Movie' }; });

        return itemPromise.then(function (item) {
            if (!item || !item.Id) {
                return { Id: rawId, Type: 'Movie', ServerId: resolveKnownServerId() };
            }
            if (!item.ServerId) {
                item.ServerId = resolveKnownServerId();
            }

            var auth = getJellyfinAuthContext();
            var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
            var t = (item.Type || '').toLowerCase();

            // If item is a TV Series or Season, resolve the concrete Episode to play (Resumable -> NextUp -> First Episode)
            if ((t === 'series' || t === 'season') && uid) {
                var seriesId = t === 'series' ? item.Id : (item.SeriesId || item.Id);
                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Episode&Filters=IsResumable&SortBy=DatePlayed&SortOrder=Descending&Limit=1')
                    .then(function (resResume) {
                        if (resResume && Array.isArray(resResume.Items) && resResume.Items.length > 0) {
                            return resResume.Items[0];
                        }
                        if (t === 'series') {
                            return apiFetch('/Shows/NextUp?userId=' + uid + '&SeriesId=' + encodeURIComponent(seriesId) + '&Limit=1')
                                .then(function (resNext) {
                                    if (resNext && Array.isArray(resNext.Items) && resNext.Items.length > 0) {
                                        return resNext.Items[0];
                                    }
                                    return null;
                                })
                                .catch(function () { return null; });
                        }
                        return null;
                    })
                    .then(function (foundEp) {
                        if (foundEp && foundEp.Id) {
                            return foundEp;
                        }
                        return apiFetch('/Shows/' + encodeURIComponent(seriesId) + '/Episodes?userId=' + uid + '&Limit=1')
                            .then(function (resEps) {
                                if (resEps && Array.isArray(resEps.Items) && resEps.Items.length > 0) {
                                    return resEps.Items[0];
                                }
                                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Episode&SortBy=ParentIndexNumber,IndexNumber,SortName&Limit=1')
                                    .then(function (resFallback) {
                                        return (resFallback && Array.isArray(resFallback.Items) && resFallback.Items[0]) || item;
                                    });
                            })
                            .catch(function () { return item; });
                    })
                    .catch(function () { return item; });
            }

            // If item is a BoxSet (Collection) or Folder, resolve its first resumable or first playable child Movie/Episode
            if ((t === 'boxset' || t === 'folder' || t === 'collectionfolder' || item.IsFolder) && uid) {
                return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Movie,Episode,Video&Filters=IsResumable&SortBy=DatePlayed&SortOrder=Descending&Limit=1')
                    .then(function (resResume) {
                        if (resResume && Array.isArray(resResume.Items) && resResume.Items.length > 0) {
                            return resResume.Items[0];
                        }
                        return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(item.Id) + '&Recursive=true&IncludeItemTypes=Movie,Episode,Video&SortBy=PremiereDate,ProductionYear,SortName&Limit=1')
                            .then(function (resFirst) {
                                return (resFirst && Array.isArray(resFirst.Items) && resFirst.Items[0]) || item;
                            });
                    })
                    .catch(function () { return item; });
            }

            return item;
        });
    }

    function applyTrackSelectionToDetailDom(detailPage, audioIdx, subIdx) {
        if (!detailPage) {
            return;
        }
        try {
            if (audioIdx !== undefined && audioIdx !== null && audioIdx !== '') {
                var audioSel = detailPage.querySelector('.selectAudio');
                if (audioSel && String(audioSel.value) !== String(audioIdx)) {
                    audioSel.value = String(audioIdx);
                    audioSel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (subIdx !== undefined && subIdx !== null && subIdx !== '') {
                var subSel = detailPage.querySelector('.selectSubtitles');
                if (subSel && String(subSel.value) !== String(subIdx)) {
                    subSel.value = String(subIdx);
                    subSel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        } catch (e) {}
    }

    function findUpgradedItemsContainer() {
        var candidates = document.querySelectorAll(
            '#indexPage:not(.hide) .itemsContainer, '
            + '.page:not(.hide) .itemsContainer, '
            + '.itemsContainer[is="emby-itemscontainer"], '
            + '.itemsContainer'
        );
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (c && typeof c.notifyRefreshNeeded === 'function') {
                return c;
            }
        }
        var hostWrap = document.getElementById('streamflix-shortcut-host-wrap');
        if (!hostWrap && document.body) {
            hostWrap = document.createElement('div');
            hostWrap.id = 'streamflix-shortcut-host-wrap';
            hostWrap.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
            hostWrap.innerHTML = '<div is="emby-itemscontainer" class="itemsContainer streamflix-shortcut-host"></div>';
            document.body.appendChild(hostWrap);
        }
        var created = hostWrap ? hostWrap.querySelector('.itemsContainer') : null;
        if (created && typeof created.notifyRefreshNeeded === 'function') {
            return created;
        }
        return candidates[0] || created || null;
    }

    function tryInPlaceJellyfinShortcutPlay(targetId, itemObj, forcedStartPositionTicks) {
        try {
            patchJellyfinApiClientMethods();
            var container = findUpgradedItemsContainer();
            if (!container) {
                return false;
            }
            var serverId = (itemObj && itemObj.ServerId) || resolveKnownServerId();
            if (!serverId) {
                return false;
            }
            var itemType = (itemObj && itemObj.Type) || 'Movie';
            var isFolder = itemType === 'Series' || itemType === 'Season' || itemType === 'BoxSet' || itemType === 'Folder';
            var hasForcedPos = typeof forcedStartPositionTicks === 'number' && isFinite(forcedStartPositionTicks) && forcedStartPositionTicks >= 0;
            var posTicks = hasForcedPos
                ? Math.floor(forcedStartPositionTicks)
                : ((itemObj && itemObj.UserData && itemObj.UserData.PlaybackPositionTicks)
                    ? Number(itemObj.UserData.PlaybackPositionTicks)
                    : 0);
            var actionName = posTicks > 0 ? 'resume' : 'play';

            // IMPORTANT: In Jellyfin Web's shortcuts.js, dom.parentWithAttribute(e.target, 'data-id') stops at the first element with data-id
            // and reads data-serverid, data-type, data-mediatype, data-isfolder, and data-positionticks from THAT element.
            // So data-id MUST be on tempCard (with all data-* attributes), and NOT duplicated without data-serverid on tempBtn!
            var tempCard = document.createElement('div');
            tempCard.className = 'card playableItemCard';
            tempCard.setAttribute('data-id', targetId);
            tempCard.setAttribute('data-serverid', serverId);
            tempCard.setAttribute('data-type', itemType);
            tempCard.setAttribute('data-mediatype', 'Video');
            tempCard.setAttribute('data-isfolder', isFolder ? 'true' : 'false');
            if (posTicks > 0) {
                tempCard.setAttribute('data-positionticks', String(posTicks));
            }
            tempCard.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';

            var tempBtn = document.createElement('button');
            tempBtn.type = 'button';
            tempBtn.className = 'itemAction cardOverlayFab-primary';
            tempBtn.setAttribute('data-action', actionName);
            tempCard.appendChild(tempBtn);
            container.appendChild(tempCard);

            var clickEvt = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            tempBtn.dispatchEvent(clickEvt);

            setTimeout(function () {
                if (tempCard.parentNode) {
                    tempCard.parentNode.removeChild(tempCard);
                }
            }, 3000);

            // In Jellyfin Web's shortcuts.js (onClick), e.preventDefault() is called synchronously whenever executeAction runs!
            return Boolean(clickEvt.defaultPrevented);
        } catch (e) {
            return false;
        }
    }

    function playItemImmediately(itemOrId, audioStreamIndex, subtitleStreamIndex, forcedStartPositionTicks, playOpts) {
        var itemObj = (itemOrId && typeof itemOrId === 'object') ? itemOrId : null;
        var targetId = typeof itemOrId === 'string' ? itemOrId : (itemObj && itemObj.Id);
        if (!targetId) {
            return;
        }

        // Prevent duplicate concurrent play calls for the same item on slow mobile/HLS connections
        var isWpFollow = Boolean(playOpts && playOpts.fromWatchPartyFollow);
        var normTarget = normalizeGuid(targetId);
        var nowTs = Date.now();
        var dedupWindowMs = isWpFollow ? 4500 : 2000;
        if (!(playOpts && playOpts.forceReplay) && state.lastPlayNormId === normTarget && state.lastPlayTimestamp && (nowTs - state.lastPlayTimestamp < dedupWindowMs)) {
            return;
        }
        state.lastPlayNormId = normTarget;
        state.lastPlayTimestamp = nowTs;
        state.lastPlayRawTarget = itemObj || targetId;
        state.lastPlayAudioIndex = audioStreamIndex;
        state.lastPlaySubtitleIndex = subtitleStreamIndex;
        state.lastPlayForcedTicks = forcedStartPositionTicks;

        if (state.activeProfile && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
            applyJellyfinServerCredentials({
                serverId: state.activeProfile.serverId || (state.config && state.config.serverId),
                userId: state.activeProfile.jellyfinUserId,
                accessToken: state.activeProfile.accessToken
            });
        }
        patchJellyfinApiClientMethods();
        if (typeof syncAutomaticWebGpuPlayerPreference === 'function') {
            syncAutomaticWebGpuPlayerPreference(null, normTarget);
        }

        // 1. Immediately close any open StreamFlix detail modal AND show the dark playback transition loader
        // so the card disappears right away instead of staying stuck on screen!
        var openModals = document.querySelectorAll('.streamflix-modal-backdrop');
        for (var m = 0; m < openModals.length; m++) {
            if (openModals[m].parentNode) {
                openModals[m].parentNode.removeChild(openModals[m]);
            }
        }
        document.body.classList.remove('streamflix-modal-open');
        hidePlaybackLoader();
        showPlaybackLoader(isWpFollow ? 'Syncing Watch Party…' : 'Starting playback…');

        var hasCustomTracks = (audioStreamIndex !== undefined && audioStreamIndex !== null && audioStreamIndex !== '')
            || (subtitleStreamIndex !== undefined && subtitleStreamIndex !== null && subtitleStreamIndex !== '');

        resolvePlayableItem(itemObj || targetId).then(function (playableItem) {
            var playableId = (playableItem && playableItem.Id) || targetId;
            state.lastPlayNormId = normalizeGuid(playableId);
            state.lastPlayRawTarget = playableItem || playableId;
            state.lastPlayTimestamp = Date.now();
            if (typeof syncAutomaticWebGpuPlayerPreference === 'function') {
                syncAutomaticWebGpuPlayerPreference(null, playableId);
            }
            var serverId = (playableItem && playableItem.ServerId) || resolveKnownServerId();

            var effectiveForcedTicks = forcedStartPositionTicks;
            if (typeof onWatchPartyBeforePlayResolved === 'function') {
                var wpTicks = onWatchPartyBeforePlayResolved(playableItem || { Id: playableId }, effectiveForcedTicks, playOpts || {});
                if (typeof wpTicks === 'number' && isFinite(wpTicks) && wpTicks >= 0) {
                    effectiveForcedTicks = wpTicks;
                }
            }
            state.lastPlayForcedTicks = effectiveForcedTicks;
            var hasForcedStart = typeof effectiveForcedTicks === 'number' && isFinite(effectiveForcedTicks) && effectiveForcedTicks >= 0;
            var forceFromBeginning = hasForcedStart && Math.floor(effectiveForcedTicks) === 0;
            var detailBtnSelector = forceFromBeginning
                ? '.btnPlay:not(.hide), .mainDetailButtons button[data-action="play"]:not(.hide), .btnResume:not(.hide), .mainDetailButtons button[data-action="resume"]:not(.hide)'
                : '.btnResume:not(.hide), .btnPlay:not(.hide), .mainDetailButtons button[data-action="resume"]:not(.hide), .mainDetailButtons button[data-action="play"]:not(.hide)';

            function pollUntilVideoPlayerStarts(maxWaitMs) {
                var pollStarted = Date.now();
                var waitLimit = maxWaitMs || 6500;
                if (state.shortcutPollTimer) {
                    clearInterval(state.shortcutPollTimer);
                }
                state.shortcutPollTimer = setInterval(function () {
                    if (isVideoPlayerActive() || document.querySelector('.dialogContainer:not([data-bfx-dismissing="true"]) .dialog:not(.hide)')) {
                        hidePlaybackLoader();
                        return;
                    }
                    if (Date.now() - pollStarted > waitLimit) {
                        hidePlaybackLoader();
                    }
                }, 100);
            }

            function navigateAndClickDetailPlay() {
                showPlaybackLoader(isWpFollow ? 'Syncing Watch Party…' : 'Starting playback…');
                state.autoPlayPending = {
                    id: playableId,
                    audioIndex: audioStreamIndex,
                    subtitleIndex: subtitleStreamIndex,
                    startedAt: Date.now(),
                    clickedOnce: false
                };

                var nowHash = window.location.hash || '';
                var nowMatch = nowHash.match(/[?&]id=([a-f0-9-]+)/i);
                var nowId = nowMatch ? nowMatch[1] : '';
                if (normalizeGuid(nowId) !== normalizeGuid(playableId) || nowHash.indexOf('details') === -1 || (serverId && nowHash.indexOf('serverId=') === -1)) {
                    window.location.hash = '#/details?id=' + encodeURIComponent(playableId)
                        + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');
                }

                if (state.autoPlayTimer) {
                    clearInterval(state.autoPlayTimer);
                }
                state.autoPlayTimer = setInterval(function () {
                    if (!state.autoPlayPending) {
                        hidePlaybackLoader();
                        return;
                    }
                    if (isVideoPlayerActive() || document.querySelector('.dialogContainer:not([data-bfx-dismissing="true"]) .dialog:not(.hide)')) {
                        hidePlaybackLoader();
                        return;
                    }
                    if (Date.now() - state.autoPlayPending.startedAt > 7500) {
                        hidePlaybackLoader();
                        return;
                    }
                    var dp = document.querySelector('#itemDetailPage:not(.hide)');
                    if (!dp) {
                        return;
                    }
                    var mainBtns = dp.querySelector('.mainDetailButtons:not(.hide)');
                    var nameEl = dp.querySelector('.itemName, h1.itemName, .parentName');
                    var hasLoadedTitle = Boolean(nameEl && (nameEl.textContent || '').trim().length > 0);
                    var playBtn = dp.querySelector(detailBtnSelector);
                    if (playBtn && mainBtns && hasLoadedTitle) {
                        var pending = state.autoPlayPending;
                        if (!pending.clickedOnce) {
                            pending.clickedOnce = true;
                            applyTrackSelectionToDetailDom(dp, pending.audioIndex, pending.subtitleIndex);
                            playBtn.click();
                            pollUntilVideoPlayerStarts(6000);
                        }
                    }
                }, 90);
            }

            // 2. Try in-place Jellyfin shortcut playback first whenever default tracks are used (or whenever Watch Party forces an exact start position!).
            // When tryInPlaceJellyfinShortcutPlay returns true, shortcuts.js has synchronously called playbackManager.play() —
            // do NOT fire a second navigateAndClickDetailPlay() call that would collide with POST /Items/{id}/PlaybackInfo!
            if ((!hasCustomTracks || hasForcedStart) && tryInPlaceJellyfinShortcutPlay(playableId, playableItem, effectiveForcedTicks)) {
                pollUntilVideoPlayerStarts(6500);
                return;
            }

            // 3. If #itemDetailPage is already visible and loaded for this exact playable item, click its native Play/Resume button ONCE
            var curHash = window.location.hash || '';
            var curIdMatch = curHash.match(/[?&]id=([a-f0-9-]+)/i);
            var curId = curIdMatch ? curIdMatch[1] : '';
            var detailPage = document.querySelector('#itemDetailPage:not(.hide)');
            if (detailPage && normalizeGuid(curId) === normalizeGuid(playableId)) {
                var curMainBtns = detailPage.querySelector('.mainDetailButtons:not(.hide)');
                var curNameEl = detailPage.querySelector('.itemName, h1.itemName, .parentName');
                var curLoaded = Boolean(curMainBtns && curNameEl && (curNameEl.textContent || '').trim().length > 0);
                var directPlayBtn = detailPage.querySelector(detailBtnSelector);
                if (directPlayBtn && curLoaded) {
                    applyTrackSelectionToDetailDom(detailPage, audioStreamIndex, subtitleStreamIndex);
                    directPlayBtn.click();
                    pollUntilVideoPlayerStarts(6000);
                    return;
                }
            }

            // 4. Otherwise navigate to #/details?id=...&serverId=... while keeping #itemDetailPage hidden behind the loader
            navigateAndClickDetailPlay();
        }).catch(function () {
            hidePlaybackLoader();
        });
    }

    function navigateOrPlayItem(itemOrId) {
        playItemImmediately(itemOrId);
    }

    function fetchFullItemDetails(itemId) {
        var auth = getJellyfinAuthContext();
        var uid = auth && auth.userId ? encodeURIComponent(auth.userId) : '';
        // Only pass valid Jellyfin C# ItemFields enum names (SeriesId, SeasonId, and CanDownload are returned by default on BaseItemDto)
        var fields = 'Overview,Genres,MediaSources,MediaStreams,People,ExternalUrls,Studios,Taglines,ParentId,Chapters';
        if (uid) {
            return apiFetch('/Items/' + encodeURIComponent(itemId) + '?userId=' + uid + '&Fields=' + fields)
                .catch(function () {
                    return apiFetch('/Users/' + uid + '/Items/' + encodeURIComponent(itemId) + '?Fields=' + fields);
                })
                .catch(function () {
                    return apiFetch('/Items/' + encodeURIComponent(itemId) + '?userId=' + uid);
                })
                .catch(function () {
                    return apiFetch('/Users/' + uid + '/Items/' + encodeURIComponent(itemId));
                })
                .catch(function () {
                    return apiFetch('/Items/' + encodeURIComponent(itemId));
                });
        }
        return apiFetch('/Items/' + encodeURIComponent(itemId) + '?Fields=' + fields)
            .catch(function () {
                return apiFetch('/Items/' + encodeURIComponent(itemId));
            });
    }

    function openHeroDetailModalById(itemId, options) {
        if (!itemId) {
            return;
        }
        var cached = findCachedItemById(itemId);
        if (cached && cached.Id && cached.Name) {
            openHeroDetailModal(cached, options);
            return;
        }
        fetchFullItemDetails(itemId).then(function (fullItem) {
            if (fullItem && fullItem.Id) {
                openHeroDetailModal(fullItem, options);
            } else {
                var sid = resolveKnownServerId();
                window.location.hash = '#/details?id=' + encodeURIComponent(itemId) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
            }
        }).catch(function () {
            var sid = resolveKnownServerId();
            window.location.hash = '#/details?id=' + encodeURIComponent(itemId) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
        });
    }

    function fetchUserItems(uid, queryString) {
        var hasFilters = queryString.indexOf('Filters=') !== -1;
        return apiFetch('/Items?userId=' + uid + '&' + queryString).then(function (res) {
            if (res && Array.isArray(res.Items)) {
                return res;
            }
            return apiFetch('/Users/' + uid + '/Items?' + queryString);
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/Items?' + queryString);
        }).catch(function () {
            if (hasFilters) {
                return { Items: [] };
            }
            return apiFetch('/Items?' + queryString);
        }).catch(function () {
            return { Items: [] };
        });
    }

    function fetchResumeItems(uid, fields) {
        var qs = 'Recursive=true&Limit=12&MediaTypes=Video&Fields=' + fields;
        return apiFetch('/UserItems/Resume?userId=' + uid + '&' + qs).catch(function () {
            return apiFetch('/Users/' + uid + '/Items/Resume?' + qs);
        }).catch(function () {
            return apiFetch('/UserItems/Resume?' + qs);
        }).catch(function () {
            return { Items: [] };
        });
    }

    function fetchUserViews(uid) {
        return apiFetch('/UserViews?userId=' + uid).then(function (res) {
            if (res && Array.isArray(res.Items)) {
                return res;
            }
            return apiFetch('/Users/' + uid + '/Views');
        }).catch(function () {
            return apiFetch('/Users/' + uid + '/Views');
        }).catch(function () {
            return apiFetch('/UserViews');
        }).catch(function () {
            return { Items: [] };
        });
    }

    function ensureCinemaHubMounted() {
        var existingHub = document.getElementById('streamflix-cinema-hub');
        if (!state.cinemaHubEnabled || !isOnHomeRoute() || isGateOpen()) {
            if (existingHub) {
                existingHub.style.display = 'none';
            }
            document.body.classList.remove('streamflix-hub-filtered', 'streamflix-hub-active');
            return;
        }
        if (existingHub) {
            // flow-root (not block) so the hero's negative top margin can't collapse through the hub
            existingHub.style.display = 'flow-root';
            if (existingHub.classList.contains('streamflix-hub-ready')) {
                document.body.classList.add('streamflix-hub-active');
            }
        }

        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }

        var homeSections = document.querySelector('#indexPage:not(.hide) .homeSectionsContainer')
            || document.querySelector('.tabContent.is-active .homeSectionsContainer')
            || document.querySelector('.homeSectionsContainer')
            || document.querySelector('#indexPage:not(.hide) .sections')
            || document.querySelector('.homeTab .sections');

        var homePageContainer = document.querySelector('#indexPage:not(.hide)')
            || document.querySelector('.page.homePage:not(.hide)');

        var fallbackContainer = document.querySelector('#fallbackPage:not(.hide)')
            || document.querySelector('.mainAnimatedPages');

        if (fallbackContainer && fallbackContainer.id === 'fallbackPage') {
            fallbackContainer.classList.add('streamflix-recovered');
        }

        // If existingHub was previously mounted inside #fallbackPage or .mainAnimatedPages and #indexPage is now ready, move it into #indexPage
        if (existingHub && homeSections && homeSections.parentNode && existingHub.parentNode !== homeSections.parentNode) {
            homeSections.parentNode.insertBefore(existingHub, homeSections);
        }

        if (!existingHub) {
            if (homeSections && homeSections.parentNode) {
                existingHub = document.createElement('div');
                existingHub.id = 'streamflix-cinema-hub';
                homeSections.parentNode.insertBefore(existingHub, homeSections);
            } else if (homePageContainer) {
                existingHub = document.createElement('div');
                existingHub.id = 'streamflix-cinema-hub';
                homePageContainer.insertBefore(existingHub, homePageContainer.firstChild);
            } else if (fallbackContainer) {
                existingHub = document.createElement('div');
                existingHub.id = 'streamflix-cinema-hub';
                fallbackContainer.insertBefore(existingHub, fallbackContainer.firstChild);
            } else {
                return;
            }

            if (state.hubData.loaded && state.hubData.userId === auth.userId) {
                renderCinemaHubContents();
            } else {
                existingHub.innerHTML = buildHubSkeletonHtml();
            }
        }

        if (state.hubData.userId !== auth.userId || (!state.hubData.loaded && !state.hubData.loading)) {
            loadCinemaHubData(false);
        }
    }

    var TOP10_SESSION_SEED_KEY = 'streamflix_top10_session_seed';

    function getSessionRandomSeed() {
        if (state.sessionRandomSeed) {
            return state.sessionRandomSeed;
        }
        try {
            var existing = sessionStorage.getItem(TOP10_SESSION_SEED_KEY);
            if (existing) {
                state.sessionRandomSeed = existing;
                return existing;
            }
            var created = String(Date.now()) + '_' + String(Math.floor(Math.random() * 1000000000));
            sessionStorage.setItem(TOP10_SESSION_SEED_KEY, created);
            state.sessionRandomSeed = created;
            return created;
        } catch (e) {
            state.sessionRandomSeed = String(Date.now());
            return state.sessionRandomSeed;
        }
    }

    function hashSeedString(str) {
        var h = 2166136261 >>> 0;
        var s = String(str || 'streamflix');
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul ? Math.imul(h, 16777619) : ((h * 16777619) >>> 0);
        }
        return h >>> 0;
    }

    function seededShuffle(items, seedStr) {
        var arr = (items || []).slice().sort(function (a, b) {
            var ka = normalizeGuid(a && a.Id);
            var kb = normalizeGuid(b && b.Id);
            return ka < kb ? -1 : (ka > kb ? 1 : 0);
        });
        var a = hashSeedString(seedStr) || 1;
        var nextRand = function () {
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul ? Math.imul(a ^ (a >>> 15), 1 | a) : ((a ^ (a >>> 15)) * (1 | a));
            t = (t + (Math.imul ? Math.imul(t ^ (t >>> 7), 61 | t) : ((t ^ (t >>> 7)) * (61 | t)))) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(nextRand() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    function dedupeMediaItems(list) {
        var out = [];
        var seen = {};
        (list || []).forEach(function (it) {
            if (!it || !it.Id) {
                return;
            }
            var key = normalizeGuid(it.Id);
            if (!key || seen[key]) {
                return;
            }
            seen[key] = true;
            out.push(it);
        });
        return out;
    }

    function hasBackdropArt(it) {
        return Boolean(it && ((Array.isArray(it.BackdropImageTags) && it.BackdropImageTags.length > 0)
            || (Array.isArray(it.ParentBackdropImageTags) && it.ParentBackdropImageTags.length > 0)));
    }

    function computeTop10Items(movies, series, popularScores, mode) {
        var pool = dedupeMediaItems([].concat(movies || [], series || []));
        if (!pool.length) {
            return [];
        }
        var selMode = String(mode || (state.config && state.config.top10SelectionMode) || 'most_played').toLowerCase();
        var scores = popularScores || {};

        if (selMode === 'daily_random' || selMode === 'session_random') {
            var now = new Date();
            var seedBase = selMode === 'daily_random'
                ? ('daily:' + now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate())
                : ('session:' + getSessionRandomSeed());
            var serverSalt = (state.config && state.config.serverId) || '';
            var withPoster = pool.filter(function (it) {
                return (it.ImageTags && it.ImageTags.Primary) || hasBackdropArt(it);
            });
            var candidatePool = withPoster.length >= 10 ? withPoster : pool;
            return seededShuffle(candidatePool, seedBase + ':' + serverSalt).slice(0, 10);
        }

        if (selMode === 'recently_added') {
            return pool.slice().sort(function (a, b) {
                var da = Date.parse(a.DateCreated || '') || 0;
                var db = Date.parse(b.DateCreated || '') || 0;
                if (db !== da) {
                    return db - da;
                }
                return (Number(b.CommunityRating) || 0) - (Number(a.CommunityRating) || 0);
            }).slice(0, 10);
        }

        if (selMode === 'community_rating') {
            return pool.slice().sort(function (a, b) {
                var ra = Number(a.CommunityRating) || 0;
                var rb = Number(b.CommunityRating) || 0;
                if (rb !== ra) {
                    return rb - ra;
                }
                var da = Date.parse(a.DateCreated || '') || 0;
                var db = Date.parse(b.DateCreated || '') || 0;
                return db - da;
            }).slice(0, 10);
        }

        // Default: 'most_played' (server-wide engagement score across all Jellyfin users, falling back cleanly to user plays + rating + recency)
        return pool.slice().sort(function (a, b) {
            var sa = Number(scores[normalizeGuid(a.Id)]) || 0;
            var sb = Number(scores[normalizeGuid(b.Id)]) || 0;
            if (sb !== sa) {
                return sb - sa;
            }
            var ua = ((a.UserData && Number(a.UserData.PlayCount)) || 0) * 3
                + (a.UserData && a.UserData.Played ? 2 : 0)
                + (a.UserData && a.UserData.IsFavorite ? 1.5 : 0);
            var ub = ((b.UserData && Number(b.UserData.PlayCount)) || 0) * 3
                + (b.UserData && b.UserData.Played ? 2 : 0)
                + (b.UserData && b.UserData.IsFavorite ? 1.5 : 0);
            if (ub !== ua) {
                return ub - ua;
            }
            var ra = Number(a.CommunityRating) || 0;
            var rb = Number(b.CommunityRating) || 0;
            if (rb !== ra) {
                return rb - ra;
            }
            return (Date.parse(b.DateCreated || '') || 0) - (Date.parse(a.DateCreated || '') || 0);
        }).slice(0, 10);
    }

    function getTop10RowTitle() {
        if (typeof isKidsProfileActive === 'function' && isKidsProfileActive()) {
            return 'Top 10 Kids Favorites Today';
        }
        var mode = String((state.config && state.config.top10SelectionMode) || 'most_played').toLowerCase();
        if (mode === 'community_rating') {
            return 'Top 10 Highest Rated';
        }
        if (mode === 'recently_added') {
            return 'Top 10 Recently Added';
        }
        if (mode === 'daily_random') {
            return 'Top 10 Daily Spotlight';
        }
        if (mode === 'session_random') {
            return 'Top 10 Spotlight Picks';
        }
        return 'Top 10 in ' + getBrandName() + ' Today';
    }

    function getTop10Rank(itemId) {
        if (!itemId || !state.hubData || !state.hubData.top10RankMap) {
            return 0;
        }
        return state.hubData.top10RankMap[normalizeGuid(itemId)] || 0;
    }

    function getHeroSlideLimit() {
        var n = state.config && state.config.heroSlideCount !== undefined
            ? Number(state.config.heroSlideCount)
            : 8;
        return Math.max(1, Math.min(15, n || 8));
    }

    function getHeroIntervalMs() {
        if (state.config && state.config.heroRotationSeconds !== undefined && state.config.heroRotationSeconds !== null) {
            var sec = Number(state.config.heroRotationSeconds);
            if (!isNaN(sec) && sec <= 0) {
                return 0;
            }
            if (!isNaN(sec)) {
                return Math.max(3, Math.min(120, sec)) * 1000;
            }
        }
        return 9000;
    }

    function computeHeroItems(d) {
        d = d || state.hubData || {};
        var limit = getHeroSlideLimit();
        var cfg = state.config || {};
        var heroLibs = Array.isArray(cfg.heroLibraryIds) ? cfg.heroLibraryIds : [];
        var contentType = String(cfg.heroContentType || 'all').toLowerCase();
        var selMode = String(cfg.heroSelectionMode || 'recent').toLowerCase();

        var fullPool = dedupeMediaItems([].concat(d.allMovies || [], d.allSeries || []));
        var basePool = (heroLibs.length > 0 && Array.isArray(d.filteredHeroPool) && d.filteredHeroPool.length > 0)
            ? dedupeMediaItems(d.filteredHeroPool)
            : fullPool;

        var typeFiltered = basePool;
        if (contentType === 'movies') {
            typeFiltered = basePool.filter(function (it) { return it.Type === 'Movie'; });
        } else if (contentType === 'series') {
            typeFiltered = basePool.filter(function (it) { return it.Type === 'Series'; });
        }
        if (!typeFiltered.length) {
            typeFiltered = basePool.length ? basePool : dedupeMediaItems(d.rawHeroItems || []);
        }

        var artPool = typeFiltered.filter(hasBackdropArt);
        var candidates = artPool.length >= Math.min(limit, 3) ? artPool : typeFiltered;
        var ordered = [];

        if (selMode === 'top10') {
            var candById = {};
            candidates.forEach(function (it) { candById[normalizeGuid(it.Id)] = it; });
            (d.top10Items || []).forEach(function (t) {
                var hit = candById[normalizeGuid(t.Id)];
                if (hit) {
                    ordered.push(hit);
                }
            });
            if (ordered.length < limit) {
                var used = {};
                ordered.forEach(function (it) { used[normalizeGuid(it.Id)] = true; });
                candidates.slice().sort(smartByRating).forEach(function (it) {
                    if (ordered.length < limit && !used[normalizeGuid(it.Id)]) {
                        used[normalizeGuid(it.Id)] = true;
                        ordered.push(it);
                    }
                });
            }
        } else if (selMode === 'top_rated') {
            ordered = candidates.slice().sort(function (a, b) {
                var diff = (Number(b.CommunityRating) || 0) - (Number(a.CommunityRating) || 0);
                if (diff !== 0) {
                    return diff;
                }
                return (Date.parse(b.DateCreated || '') || 0) - (Date.parse(a.DateCreated || '') || 0);
            });
        } else if (selMode === 'random') {
            ordered = seededShuffle(candidates, 'hero:' + getSessionRandomSeed() + ':' + ((cfg && cfg.serverId) || ''));
        } else {
            ordered = candidates.slice().sort(function (a, b) {
                return (Date.parse(b.DateCreated || '') || 0) - (Date.parse(a.DateCreated || '') || 0);
            });
        }

        return ordered.slice(0, limit);
    }

    function recomputeHubDerivedLists() {
        var d = state.hubData;
        if (!d) {
            return;
        }
        var topList = computeTop10Items(d.allMovies, d.allSeries, d.popularScores, state.config && state.config.top10SelectionMode);
        if (!topList.length && Array.isArray(d.rawTop10Items) && d.rawTop10Items.length) {
            topList = d.rawTop10Items.slice(0, 10);
        }
        d.top10Items = topList;
        var rankMap = {};
        topList.forEach(function (it, idx) {
            if (it && it.Id) {
                rankMap[normalizeGuid(it.Id)] = idx + 1;
            }
        });
        d.top10RankMap = rankMap;

        var computedHero = computeHeroItems(d);
        d.heroItems = computedHero.length ? computedHero : (d.rawHeroItems || []).slice(0, getHeroSlideLimit());
        if (state.heroIndex >= d.heroItems.length) {
            state.heroIndex = 0;
        }
    }

    function getHubSwrStorageKey(userId) {
        var pid = (state.activeProfile && state.activeProfile.id) ? state.activeProfile.id : 'default';
        return HUB_SWR_CACHE_PREFIX + normalizeGuid(userId) + '_' + pid;
    }

    function applyHubBootstrapPayload(boot, silentRefresh, saveToSwrCache, userIdForCache) {
        var kFilter = typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode : function (arr) { return arr || []; };
        var kidsActive = typeof isKidsProfileActive === 'function' && isKidsProfileActive();

        stampServerIdOnItems(boot.allMovies);
        stampServerIdOnItems(boot.allSeries);
        stampServerIdOnItems(boot.resumeItems);
        stampServerIdOnItems(boot.nextUpItems);
        stampServerIdOnItems(boot.favoriteItems);
        stampServerIdOnItems(boot.collectionsItems);
        stampServerIdOnItems(boot.filteredHeroPool);

        state.hubData.allMovies = dedupeMediaItems(kFilter(boot.allMovies || []));
        state.hubData.allSeries = dedupeMediaItems(kFilter(boot.allSeries || []));
        state.hubData.recentMovies = state.hubData.allMovies.slice(0, 18);
        state.hubData.recentSeries = state.hubData.allSeries.slice(0, 18);
        state.hubData.rawHeroItems = dedupeMediaItems([].concat(state.hubData.recentMovies, state.hubData.recentSeries)).slice(0, 15);
        state.hubData.rawTop10Items = [];
        state.hubData.resumeItems = dedupeMediaItems(kFilter(boot.resumeItems || []));
        state.hubData.nextUpItems = dedupeMediaItems(kFilter(boot.nextUpItems || []));
        state.hubData.favoriteItems = dedupeMediaItems(kFilter(boot.favoriteItems || []));
        state.hubData.collectionsItems = dedupeMediaItems(kFilter(boot.collectionsItems || []));
        state.hubData.filteredHeroPool = dedupeMediaItems(kFilter(boot.filteredHeroPool || []));
        state.hubData.views = Array.isArray(boot.views) ? boot.views : [];
        state.hubData.popularScores = (boot.popularScores && typeof boot.popularScores === 'object') ? boot.popularScores : {};

        var rawMoviesTotal = Number(boot.totalMoviesCount) || 0;
        var rawSeriesTotal = Number(boot.totalSeriesCount) || 0;
        var rawColsTotal = Number(boot.totalCollectionsCount) || 0;
        state.hubData.totalMoviesCount = kidsActive ? state.hubData.allMovies.length : Math.max(rawMoviesTotal, state.hubData.allMovies.length);
        state.hubData.totalSeriesCount = kidsActive ? state.hubData.allSeries.length : Math.max(rawSeriesTotal, state.hubData.allSeries.length);
        state.hubData.totalCollectionsCount = kidsActive ? state.hubData.collectionsItems.length : Math.max(rawColsTotal, state.hubData.collectionsItems.length);

        recomputeHubDerivedLists();
        state.hubData.loading = false;
        state.hubData.loaded = true;

        if (saveToSwrCache && userIdForCache) {
            saveSessionJson(getHubSwrStorageKey(userIdForCache), {
                savedAt: Date.now(),
                payload: boot
            });
        }

        try {
            var wallCache = getShowcaseItemsForWall().slice(0, 36);
            if (wallCache.length > 0) {
                saveJson(SHOWCASE_ITEMS_KEY, wallCache);
            }
        } catch (eWall) {}

        if (!silentRefresh) {
            state.heroIndex = 0;
        }
        if (state.searchQuery) {
            var freshLocalHits = matchHubItemsLocally(state.searchQuery);
            if (freshLocalHits.length > 0) {
                state.searchResults = mergeUniqueMediaItems(freshLocalHits, state.searchResults || []);
            }
        }
        renderCinemaHubContents();
        enhanceLibraryListPages();
        setTimeout(function () {
            if (normalizeGuid(getJellyfinAuthContext().userId) === normalizeGuid(userIdForCache || '')) {
                loadPersonalRows(false);
            }
        }, 1200);
        if (typeof refreshNotificationsSilently === 'function') {
            refreshNotificationsSilently();
        }
    }

    var HUB_SWR_KEY_PREFIX = 'streamflix_hub_swr_v2_';

    function tryHydrateHubFromSessionSwr(userId) {
        if (!userId || state.hubData.loaded) {
            return false;
        }
        try {
            var raw = sessionStorage.getItem(HUB_SWR_KEY_PREFIX + normalizeGuid(userId));
            if (!raw) {
                return false;
            }
            var snap = JSON.parse(raw);
            if (!snap || typeof snap !== 'object' || Date.now() - (Number(snap.ts) || 0) > 30 * 60 * 1000) {
                return false;
            }
            state.hubData.userId = userId;
            state.hubData.rawHeroItems = Array.isArray(snap.rawHeroItems) ? snap.rawHeroItems : [];
            state.hubData.resumeItems = Array.isArray(snap.resumeItems) ? snap.resumeItems : [];
            state.hubData.nextUpItems = Array.isArray(snap.nextUpItems) ? snap.nextUpItems : [];
            state.hubData.favoriteItems = Array.isArray(snap.favoriteItems) ? snap.favoriteItems : [];
            state.hubData.allMovies = Array.isArray(snap.allMovies) ? snap.allMovies : [];
            state.hubData.allSeries = Array.isArray(snap.allSeries) ? snap.allSeries : [];
            state.hubData.recentMovies = state.hubData.allMovies.slice(0, 18);
            state.hubData.recentSeries = state.hubData.allSeries.slice(0, 18);
            state.hubData.collectionsItems = Array.isArray(snap.collectionsItems) ? snap.collectionsItems : [];
            state.hubData.totalMoviesCount = Number(snap.totalMoviesCount) || state.hubData.allMovies.length;
            state.hubData.totalSeriesCount = Number(snap.totalSeriesCount) || state.hubData.allSeries.length;
            state.hubData.totalCollectionsCount = Number(snap.totalCollectionsCount) || state.hubData.collectionsItems.length;
            state.hubData.views = Array.isArray(snap.views) ? snap.views : [];
            state.hubData.popularScores = (snap.popularScores && typeof snap.popularScores === 'object') ? snap.popularScores : {};
            recomputeHubDerivedLists();
            state.hubData.loaded = true;
            return true;
        } catch (e) {
            return false;
        }
    }

    function saveHubToSessionSwr(userId) {
        if (!userId) {
            return;
        }
        try {
            var d = state.hubData;
            sessionStorage.setItem(HUB_SWR_KEY_PREFIX + normalizeGuid(userId), JSON.stringify({
                ts: Date.now(),
                rawHeroItems: (d.rawHeroItems || []).slice(0, 15),
                resumeItems: (d.resumeItems || []).slice(0, 12),
                nextUpItems: (d.nextUpItems || []).slice(0, 12),
                favoriteItems: (d.favoriteItems || []).slice(0, 24),
                allMovies: (d.allMovies || []).slice(0, 48),
                allSeries: (d.allSeries || []).slice(0, 48),
                collectionsItems: (d.collectionsItems || []).slice(0, 36),
                totalMoviesCount: d.totalMoviesCount || 0,
                totalSeriesCount: d.totalSeriesCount || 0,
                totalCollectionsCount: d.totalCollectionsCount || 0,
                views: (d.views || []).slice(0, 24),
                popularScores: d.popularScores || {}
            }));
        } catch (e) {}
    }

    function loadCinemaHubData(silentRefresh) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }

        var hadSwr = tryHydrateHubFromSessionSwr(auth.userId);
        if (hadSwr && !silentRefresh) {
            renderCinemaHubContents();
        }

        var reqSeq = (state.hubLoadSeq = (state.hubLoadSeq || 0) + 1);
        state.hubData.loading = true;
        state.hubData.userId = auth.userId;

        // Instant Stale-While-Revalidate (SWR) paint from sessionStorage if fresh (< 10 min)
        if (!silentRefresh && !state.hubData.loaded) {
            var swrCached = loadSessionJson(getHubSwrStorageKey(auth.userId), null);
            if (swrCached && swrCached.payload && swrCached.savedAt && (Date.now() - Number(swrCached.savedAt) < 10 * 60 * 1000)) {
                try {
                    applyHubBootstrapPayload(swrCached.payload, false, false, auth.userId);
                    silentRefresh = true;
                } catch (eSwr) {}
            }
        }

        var pid = (state.activeProfile && state.activeProfile.id) || '';
        apiFetch('/StreamFlix/Hub/Bootstrap?profileId=' + encodeURIComponent(pid)).then(function (boot) {
            if (state.hubLoadSeq !== reqSeq || normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(auth.userId)) {
                return;
            }
            if (!boot || !Array.isArray(boot.allMovies) || !Array.isArray(boot.allSeries)) {
                throw new Error('Invalid bootstrap payload');
            }
            applyHubBootstrapPayload(boot, silentRefresh, true, auth.userId);
        }).catch(function () {
            if (state.hubLoadSeq !== reqSeq || normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(auth.userId)) {
                return;
            }
            loadCinemaHubDataClassicFallback(auth, reqSeq, silentRefresh, hadSwr);
        });
    }

    function loadCinemaHubDataClassicFallback(auth, reqSeq, silentRefresh, hadSwr) {
        var uid = encodeURIComponent(auth.userId);
        // Only pass valid C# ItemFields enum names
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated';
        var kFilter = typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode : function (arr) { return arr || []; };

        // Stage 1: Fast above-the-fold queries (Hero, Continue Watching, Next Up, Navigation Views) so initial paint never waits on full library scans
        var pHero = fetchUserItems(uid, 'IncludeItemTypes=Movie,Series&Recursive=true&Limit=15&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
        var pResume = fetchResumeItems(uid, fields);
        var pNextUp = apiFetch('/Shows/NextUp?userId=' + uid + '&Limit=12&Fields=' + fields).catch(function () { return { Items: [] }; });
        var pViews = fetchUserViews(uid);

        Promise.all([pHero, pResume, pNextUp, pViews]).then(function (stage1) {
            if (state.hubLoadSeq !== reqSeq || normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(auth.userId)) {
                return null;
            }
            state.hubData.rawHeroItems = kFilter((stage1[0] && stage1[0].Items) || []);
            state.hubData.resumeItems = kFilter((stage1[1] && stage1[1].Items) || []);
            state.hubData.nextUpItems = kFilter((stage1[2] && stage1[2].Items) || []);
            state.hubData.views = (stage1[3] && stage1[3].Items) || [];
            if (!state.hubData.rawTop10Items || !state.hubData.rawTop10Items.length) {
                state.hubData.rawTop10Items = state.hubData.rawHeroItems.slice(0, 10);
            }

            if (!hadSwr && !silentRefresh && (state.hubData.rawHeroItems.length || state.hubData.resumeItems.length || state.hubData.views.length)) {
                recomputeHubDerivedLists();
                state.hubData.loaded = true;
                state.heroIndex = 0;
                renderCinemaHubContents();
            }

            // Stage 2: Full catalog rows & non-blocking SWR popularity scores
            var pFavs = fetchUserItems(uid, 'IncludeItemTypes=Movie,Series,Episode,BoxSet&Recursive=true&Filters=IsFavorite&Limit=48&Fields=' + fields);
            var pMovies = fetchUserItems(uid, 'IncludeItemTypes=Movie&Recursive=true&Limit=96&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
            var pSeries = fetchUserItems(uid, 'IncludeItemTypes=Series&Recursive=true&Limit=96&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields + ',ChildCount');
            var pCollections = fetchUserItems(uid, 'IncludeItemTypes=BoxSet&Recursive=true&Limit=72&SortBy=SortName&SortOrder=Ascending&Fields=' + fields);
            var pPopular = apiFetch('/StreamFlix/PopularScores').catch(function () { return { scores: {} }; });

            return Promise.all([pFavs, pMovies, pSeries, pCollections, pPopular]);
        }).then(function (results) {
            if (!results || state.hubLoadSeq !== reqSeq || normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(auth.userId)) {
                return null;
            }
            var kidsActive = typeof isKidsProfileActive === 'function' && isKidsProfileActive();
            state.hubData.favoriteItems = kFilter((results[0] && results[0].Items) || []);
            state.hubData.allMovies = kFilter((results[1] && results[1].Items) || []);
            state.hubData.allSeries = kFilter((results[2] && results[2].Items) || []);
            state.hubData.recentMovies = state.hubData.allMovies.slice(0, 18);
            state.hubData.recentSeries = state.hubData.allSeries.slice(0, 18);
            state.hubData.collectionsItems = kFilter((results[3] && results[3].Items) || []);
            var rawMoviesTotal = Number(results[1] && results[1].TotalRecordCount) || 0;
            var rawSeriesTotal = Number(results[2] && results[2].TotalRecordCount) || 0;
            var rawCollectionsTotal = Number(results[3] && results[3].TotalRecordCount) || 0;
            state.hubData.totalMoviesCount = kidsActive
                ? state.hubData.allMovies.length
                : Math.max(rawMoviesTotal, state.hubData.allMovies.length);
            state.hubData.totalSeriesCount = kidsActive
                ? state.hubData.allSeries.length
                : Math.max(rawSeriesTotal, state.hubData.allSeries.length);
            state.hubData.totalCollectionsCount = kidsActive
                ? state.hubData.collectionsItems.length
                : Math.max(rawCollectionsTotal, state.hubData.collectionsItems.length);
            state.hubData.popularScores = (results[4] && results[4].scores) || {};
            state.hubData.filteredHeroPool = [];

            var extraPromises = [];

            var heroLibs = (state.config && Array.isArray(state.config.heroLibraryIds)) ? state.config.heroLibraryIds : [];
            if (heroLibs.length > 0) {
                var libPromises = heroLibs.map(function (libId) {
                    return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(libId) + '&Recursive=true&IncludeItemTypes=Movie,Series&Limit=60&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields)
                        .catch(function () { return { Items: [] }; });
                });
                extraPromises.push(
                    Promise.all(libPromises).then(function (libResults) {
                        var combinedHeroPool = [];
                        libResults.forEach(function (lr) {
                            combinedHeroPool = combinedHeroPool.concat((lr && lr.Items) || []);
                        });
                        state.hubData.filteredHeroPool = kFilter(dedupeMediaItems(combinedHeroPool));
                    })
                );
            }

            // Only query Collections/BoxSets library views by ParentId when top-level BoxSet query returned nothing
            if (state.hubData.collectionsItems.length === 0) {
                var boxsetViews = state.hubData.views.filter(function (v) {
                    var ct = (v && v.CollectionType || '').toLowerCase();
                    var nm = (v && v.Name || '').toLowerCase();
                    return ct === 'boxsets' || nm.indexOf('collection') !== -1;
                });
                boxsetViews.forEach(function (bv) {
                    extraPromises.push(
                        fetchUserItems(uid, 'ParentId=' + encodeURIComponent(bv.Id) + '&Recursive=true&Limit=72&SortBy=SortName&SortOrder=Ascending&Fields=' + fields)
                            .then(function (bRes) {
                                var seenCol = {};
                                state.hubData.collectionsItems.forEach(function (c) {
                                    if (c && c.Id) { seenCol[normalizeGuid(c.Id)] = true; }
                                });
                                ((bRes && bRes.Items) || []).forEach(function (it) {
                                    if (it && it.Id && !seenCol[normalizeGuid(it.Id)] && it.Type !== 'Episode' && it.Type !== 'Season') {
                                        seenCol[normalizeGuid(it.Id)] = true;
                                        state.hubData.collectionsItems.push(it);
                                    }
                                });
                            })
                            .catch(function () {})
                    );
                });
            }

            // Fallback: if top-level Recursive queries returned no movies/series but the user has library views, query each view by ParentId
            if (state.hubData.allMovies.length === 0 && state.hubData.allSeries.length === 0 && state.hubData.views.length > 0) {
                var viewPromises = state.hubData.views.map(function (v) {
                    return fetchUserItems(uid, 'ParentId=' + encodeURIComponent(v.Id) + '&Recursive=true&IncludeItemTypes=Movie,Series,BoxSet,Video&Limit=60&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=' + fields);
                });
                extraPromises.push(
                    Promise.all(viewPromises).then(function (viewResList) {
                        var seenIds = {};
                        viewResList.forEach(function (vr) {
                            ((vr && vr.Items) || []).forEach(function (it) {
                                if (!it || !it.Id || seenIds[it.Id]) {
                                    return;
                                }
                                seenIds[it.Id] = true;
                                if (it.Type === 'Series') {
                                    state.hubData.allSeries.push(it);
                                } else if (it.Type === 'BoxSet') {
                                    state.hubData.collectionsItems.push(it);
                                } else {
                                    state.hubData.allMovies.push(it);
                                }
                            });
                        });
                        state.hubData.recentMovies = state.hubData.allMovies.slice(0, 18);
                        state.hubData.recentSeries = state.hubData.allSeries.slice(0, 18);
                        if (!state.hubData.totalMoviesCount) {
                            state.hubData.totalMoviesCount = state.hubData.allMovies.length;
                        }
                        if (!state.hubData.totalSeriesCount) {
                            state.hubData.totalSeriesCount = state.hubData.allSeries.length;
                        }
                        if (!state.hubData.totalCollectionsCount) {
                            state.hubData.totalCollectionsCount = state.hubData.collectionsItems.length;
                        }
                    })
                );
            }

            return Promise.all(extraPromises);
        }).then(function () {
            if (state.hubLoadSeq !== reqSeq || normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(auth.userId)) {
                return;
            }
            recomputeHubDerivedLists();
            state.hubData.loading = false;
            state.hubData.loaded = true;
            saveHubToSessionSwr(auth.userId);
            try {
                var wallCache = getShowcaseItemsForWall().slice(0, 36);
                if (wallCache.length > 0) {
                    saveJson(SHOWCASE_ITEMS_KEY, wallCache);
                }
            } catch (eWall) {}
            if (state.searchQuery) {
                var freshLocalHits = matchHubItemsLocally(state.searchQuery);
                if (freshLocalHits.length > 0) {
                    state.searchResults = mergeUniqueMediaItems(freshLocalHits, state.searchResults || []);
                }
            }
            renderCinemaHubContents();
            enhanceLibraryListPages();
            setTimeout(function () {
                if (normalizeGuid(getJellyfinAuthContext().userId) === normalizeGuid(auth.userId)) {
                    loadPersonalRows(false);
                }
            }, 1200);
        }).catch(function () {
            if (state.hubLoadSeq === reqSeq) {
                state.hubData.loading = false;
            }
        });
    }

    function abortPendingSearchRequests() {
        if (state.seerrSearchAbort) {
            try { state.seerrSearchAbort.abort(); } catch (eAb1) {}
            state.seerrSearchAbort = null;
        }
        if (state.seerrLocalAbort) {
            try { state.seerrLocalAbort.abort(); } catch (eAb2) {}
            state.seerrLocalAbort = null;
        }
    }

    function cancelPendingSearch() {
        if (state.searchDebounce) {
            clearTimeout(state.searchDebounce);
            state.searchDebounce = null;
        }
        abortPendingSearchRequests();
        state.searchSeq = (state.searchSeq || 0) + 1;
        state.seerrSearchLoading = false;
    }

    function mergeUniqueMediaItems(primaryList, secondaryList) {
        var out = [];
        var seen = {};
        var pushList = function (arr) {
            if (!Array.isArray(arr)) {
                return;
            }
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i];
                if (!it || !it.Id) {
                    continue;
                }
                var nid = normalizeGuid(it.Id);
                if (!nid || seen[nid]) {
                    continue;
                }
                seen[nid] = true;
                out.push(it);
            }
        };
        pushList(primaryList);
        pushList(secondaryList);
        return out.slice(0, 60);
    }

    function matchHubItemsLocally(cleanQuery) {
        var q = String(cleanQuery || '').trim().toLowerCase();
        if (!q) {
            return [];
        }
        var d = state.hubData || {};
        var cachedList = [];
        if (state.itemCache && typeof state.itemCache === 'object') {
            Object.keys(state.itemCache).forEach(function (k) {
                var cit = state.itemCache[k];
                if (cit && cit.Id && (cit.Type === 'Movie' || cit.Type === 'Series' || cit.Type === 'BoxSet' || cit.Type === 'Video')) {
                    cachedList.push(cit);
                }
            });
        }
        var pool = [].concat(
            d.allMovies || [],
            d.allSeries || [],
            d.collectionsItems || [],
            d.rawHeroItems || [],
            d.rawTop10Items || [],
            d.favoriteItems || [],
            cachedList
        );
        var seen = {};
        var exactStarts = [];
        var contains = [];
        for (var i = 0; i < pool.length; i++) {
            var it = pool[i];
            if (!it || !it.Id || it.Type === 'Episode' || it.Type === 'Season') {
                continue;
            }
            var nid = normalizeGuid(it.Id);
            if (seen[nid]) {
                continue;
            }
            seen[nid] = true;
            var nameLow = String(it.Name || '').toLowerCase();
            var origLow = String(it.OriginalTitle || '').toLowerCase();
            var sortLow = String(it.SortName || '').toLowerCase();
            var genresLow = Array.isArray(it.Genres) ? it.Genres.join(' ').toLowerCase() : '';
            if (nameLow.indexOf(q) === 0 || origLow.indexOf(q) === 0 || sortLow.indexOf(q) === 0) {
                exactStarts.push(it);
            } else if (nameLow.indexOf(q) !== -1 || origLow.indexOf(q) !== -1 || (q.length >= 3 && genresLow.indexOf(q) !== -1)) {
                contains.push(it);
            }
        }
        var combined = exactStarts.concat(contains).slice(0, 48);
        return typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode(combined) : combined;
    }

    function fetchLocalSearchItems(uid, cleanQuery, fields, signal) {
        var reqOpts = signal ? { signal: signal } : {};
        var qs = 'SearchTerm=' + encodeURIComponent(cleanQuery)
            + '&IncludeItemTypes=Movie,Series,BoxSet,Video&Recursive=true&Limit=48&Fields=' + fields;

        return apiFetch('/Users/' + uid + '/Items?' + qs, reqOpts)
            .then(function (r1) {
                if (r1 && Array.isArray(r1.Items) && r1.Items.length > 0) {
                    return r1.Items;
                }
                return apiFetch('/Items?userId=' + uid + '&' + qs, reqOpts).then(function (r2) {
                    if (r2 && Array.isArray(r2.Items) && r2.Items.length > 0) {
                        return r2.Items;
                    }
                    var views = (state.hubData && Array.isArray(state.hubData.views)) ? state.hubData.views : [];
                    if (!views.length) {
                        return [];
                    }
                    return Promise.all(views.map(function (v) {
                        if (!v || !v.Id) {
                            return Promise.resolve({ Items: [] });
                        }
                        return apiFetch('/Users/' + uid + '/Items?ParentId=' + encodeURIComponent(v.Id) + '&' + qs, reqOpts)
                            .catch(function () {
                                return apiFetch('/Items?userId=' + uid + '&ParentId=' + encodeURIComponent(v.Id) + '&' + qs, reqOpts);
                            })
                            .catch(function () { return { Items: [] }; });
                    })).then(function (viewRes) {
                        var merged = [];
                        viewRes.forEach(function (vr) {
                            if (vr && Array.isArray(vr.Items)) {
                                merged = merged.concat(vr.Items);
                            }
                        });
                        return merged;
                    });
                });
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') {
                    throw err;
                }
                return apiFetch('/Items?userId=' + uid + '&' + qs, reqOpts)
                    .then(function (rFallback) {
                        return (rFallback && Array.isArray(rFallback.Items)) ? rFallback.Items : [];
                    });
            });
    }

    function previewInstantLocalSearch(rawQuery) {
        abortPendingSearchRequests();
        var clean = String(rawQuery || '').trim();
        if (!clean) {
            state.searchResults = null;
            state.seerrSearchResults = null;
            state.seerrSearchLoading = false;
            renderCinemaHubContents();
            return;
        }
        state.searchResults = matchHubItemsLocally(clean);
        state.seerrSearchResults = null;
        state.seerrSearchLoading = Boolean(isCurrentProfileSeerrAllowed() && clean.length >= 2);
        renderCinemaHubContents();
    }

    function runLiveSearch(query) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }
        abortPendingSearchRequests();
        var seq = (state.searchSeq = (state.searchSeq || 0) + 1);
        var clean = (query || '').trim();
        if (!clean) {
            state.searchResults = null;
            state.seerrSearchResults = null;
            state.seerrSearchLoading = false;
            renderCinemaHubContents();
            return;
        }

        var instantLocal = matchHubItemsLocally(clean);
        if (!Array.isArray(state.searchResults) || instantLocal.length > 0) {
            state.searchResults = mergeUniqueMediaItems(instantLocal, state.searchResults || []);
        }

        var uid = encodeURIComponent(auth.userId);
        var fields = 'Overview,Genres,PrimaryImageAspectRatio';
        var seerrAllowed = isCurrentProfileSeerrAllowed() && clean.length >= 2;
        state.seerrSearchLoading = seerrAllowed;
        if (!seerrAllowed) {
            state.seerrSearchResults = null;
        }

        var localAbort = typeof AbortController === 'function' ? new AbortController() : null;
        state.seerrLocalAbort = localAbort;
        fetchLocalSearchItems(uid, clean, fields, localAbort ? localAbort.signal : null)
            .then(function (rawHits) {
                if (state.searchSeq !== seq) {
                    return;
                }
                var filteredHits = typeof filterItemsForKidsMode === 'function' ? filterItemsForKidsMode(rawHits || []) : (rawHits || []);
                var latestLocal = matchHubItemsLocally(clean);
                state.searchResults = mergeUniqueMediaItems(filteredHits, latestLocal);
                renderCinemaHubContents();
            })
            .catch(function (err) {
                if ((err && err.name === 'AbortError') || state.searchSeq !== seq) {
                    return;
                }
                state.searchResults = mergeUniqueMediaItems(state.searchResults || [], matchHubItemsLocally(clean));
                renderCinemaHubContents();
            });

        if (seerrAllowed) {
            var pid = (state.activeProfile && state.activeProfile.id) || '';
            var seerrAbort = typeof AbortController === 'function' ? new AbortController() : null;
            state.seerrSearchAbort = seerrAbort;
            apiFetch(
                '/StreamFlix/Seerr/Search?query=' + encodeURIComponent(clean) + '&profileId=' + encodeURIComponent(pid),
                seerrAbort ? { signal: seerrAbort.signal } : {}
            )
                .then(function (sRes) {
                    if (state.searchSeq !== seq) {
                        return;
                    }
                    state.seerrSearchAbort = null;
                    state.seerrSearchLoading = false;
                    var rawSeerr = (sRes && Array.isArray(sRes.results)) ? sRes.results : [];
                    state.seerrSearchResults = rawSeerr;

                    // If Seerr points to a verified local Jellyfin item that was not yet in state.searchResults,
                    // hydrate it into state.searchResults so available library titles never disappear.
                    var existingLocalMap = {};
                    (state.searchResults || []).forEach(function (li) {
                        if (li && li.Id) {
                            existingLocalMap[normalizeGuid(li.Id)] = true;
                        }
                    });
                    var missingJfIds = [];
                    rawSeerr.forEach(function (sItem) {
                        if (sItem && sItem.jellyfinMediaId) {
                            var normJf = normalizeGuid(sItem.jellyfinMediaId);
                            if (normJf && !existingLocalMap[normJf]) {
                                existingLocalMap[normJf] = true;
                                var cachedHit = findCachedItemById(sItem.jellyfinMediaId);
                                if (cachedHit && cachedHit.Id && cachedHit.Name) {
                                    var allowedCached = typeof filterItemsForKidsMode === 'function'
                                        ? filterItemsForKidsMode([cachedHit])
                                        : [cachedHit];
                                    if (allowedCached.length > 0) {
                                        state.searchResults = mergeUniqueMediaItems(state.searchResults || [], allowedCached);
                                    }
                                } else if (missingJfIds.length < 4) {
                                    missingJfIds.push(sItem.jellyfinMediaId);
                                }
                            }
                        }
                    });

                    renderCinemaHubContents();

                    if (missingJfIds.length > 0) {
                        Promise.all(missingJfIds.map(function (mId) {
                            return fetchFullItemDetails(mId).catch(function () { return null; });
                        })).then(function (fetchedItems) {
                            if (state.searchSeq !== seq) {
                                return;
                            }
                            var validFetched = (fetchedItems || []).filter(function (x) {
                                return x && x.Id && x.Name && x.Type !== 'Episode' && x.Type !== 'Season';
                            });
                            if (typeof filterItemsForKidsMode === 'function') {
                                validFetched = filterItemsForKidsMode(validFetched);
                            }
                            if (validFetched.length > 0) {
                                state.searchResults = mergeUniqueMediaItems(state.searchResults || [], validFetched);
                                renderCinemaHubContents();
                            }
                        });
                    }
                })
                .catch(function (err) {
                    if ((err && err.name === 'AbortError') || state.searchSeq !== seq) {
                        return;
                    }
                    state.seerrSearchAbort = null;
                    state.seerrSearchLoading = false;
                    state.seerrSearchResults = [];
                    renderCinemaHubContents();
                });
        }
    }

    function filterDeduplicatedSeerrResults(seerrList, localSearchList) {
        if (!Array.isArray(seerrList) || !seerrList.length) {
            return [];
        }
        var localIds = {};
        var localTitleKeys = {};
        var localMovieTitles = {};
        var d = state.hubData || {};
        [].concat(localSearchList || [], d.allMovies || [], d.allSeries || []).forEach(function (it) {
            if (!it) {
                return;
            }
            if (it.Id) {
                localIds[normalizeGuid(it.Id)] = it.Type || '';
            }
            var lowName = String(it.Name || '').trim().toLowerCase();
            var tKey = lowName + '|' + (it.ProductionYear || '');
            if (lowName) {
                localTitleKeys[tKey] = it.Type || '';
                if (it.Type === 'Movie') {
                    localMovieTitles[lowName] = it.ProductionYear || true;
                }
            }
        });
        return seerrList.filter(function (s) {
            if (!s || !s.tmdbId || !s.title) {
                return false;
            }
            var st = Number(s.mediaStatus) || 1;
            if (st === 7) {
                st = 1;
            }
            var isPartialTv = s.mediaType === 'tv' && st === 4;
            if (isPartialTv) {
                return true;
            }
            if (st === 5 || st === 6) {
                return false;
            }
            if (s.jellyfinMediaId && localIds[normalizeGuid(s.jellyfinMediaId)]) {
                return false;
            }
            var lowTitle = String(s.title || '').trim().toLowerCase();
            var sKey = lowTitle + '|' + (s.year || '');
            if (localTitleKeys[sKey]) {
                return false;
            }
            if (s.mediaType === 'movie' && !s.year && localMovieTitles[lowTitle]) {
                return false;
            }
            return true;
        });
    }

    function buildSeerrCardHtml(sItem) {
        var posterUrl = (typeof sItem.posterUrl === 'string' && /^https:\/\//i.test(sItem.posterUrl.trim())) ? sItem.posterUrl.trim() : '';
        var rawSt = Number(sItem.mediaStatus) || 1;
        var status = rawSt === 7 ? 1 : rawSt;
        var rawDl = (typeof sItem.downloadProgress === 'number' && !isNaN(sItem.downloadProgress))
            ? Math.max(0, Math.min(100, Math.round(sItem.downloadProgress)))
            : null;
        var customLbl = typeof sItem.statusLabel === 'string' ? sItem.statusLabel.trim() : '';
        var isDownloading = rawDl !== null || /^downloading/i.test(customLbl);
        var isPending = status === 2 || status === 3 || isDownloading;
        var isPartial = status === 4;
        var isTv = String(sItem.mediaType || '').toLowerCase() === 'tv';
        var key = (isTv ? 'tv' : 'movie') + ':' + sItem.tmdbId;
        var isSubmitting = Boolean(state.seerrSubmittingMap && state.seerrSubmittingMap[key]);

        var statusCls = isDownloading
            ? 'is-downloading'
            : (status === 3 ? 'is-processing' : (status === 2 ? 'is-pending' : (isPartial ? 'is-partial' : 'is-requestable')));

        var cornerTitle = isDownloading
            ? (customLbl || (rawDl !== null && rawDl > 0 ? ('Downloading · ' + rawDl + '%') : 'Downloading via Seerr'))
            : (status === 3
                ? 'Processing in Seerr'
                : (status === 2
                    ? 'Requested in Seerr'
                    : (isPartial ? 'Partially Available · Request Seasons via Seerr' : 'Available to Request via Seerr')));

        var cornerIcon = isDownloading
            ? icon('download')
            : (isPending ? icon('clock') : icon('seerrIcon'));

        var ctaAct = (!isTv && status === 1 && !isPending) ? 'quick-request' : 'open-modal';
        var ctaInner = isSubmitting
            ? '<span class="bfx-qbtn-mini-spin"></span><span>Sending…</span>'
            : (isDownloading
                ? (icon('download') + '<span>' + (rawDl !== null && rawDl > 0 ? (rawDl + '%') : 'Downloading') + '</span>')
                : (isPending
                    ? (icon('check') + '<span>Requested</span>')
                    : (icon('plus') + '<span>' + (isTv && isPartial ? 'Seasons' : 'Request') + '</span>')));

        var ctaTitle = isSubmitting
            ? 'Submitting request to Seerr…'
            : (isPending
                ? (cornerTitle + ' — click for details')
                : (isTv ? 'Choose seasons to request' : '1-click request via Seerr'));

        var subTagText = isDownloading
            ? (rawDl !== null && rawDl > 0 ? ('DL ' + rawDl + '%') : 'Downloading')
            : (isPending ? 'Requested' : (isPartial ? 'Partial' : 'Request'));

        var typeLabel = isTv ? 'Series' : 'Movie';
        var metaText = [sItem.year ? String(sItem.year) : '', typeLabel].filter(Boolean).join(' · ');
        var rating = sItem.rating ? Number(sItem.rating).toFixed(1) : '';
        var subLeft = [sItem.year ? String(sItem.year) : '', isTv ? 'TV' : 'Movie'].filter(Boolean).join(' · ');

        return ''
            + '<div class="streamflix-poster-card bfx-seerr-card" data-seerr-key="' + escapeHtml(key) + '" tabindex="0" role="button" aria-label="' + escapeHtml(sItem.title + ' (' + cornerTitle + ')') + '">'
            + '  <div class="streamflix-poster-img-wrap">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(sItem.title) + '</div>'
            + (posterUrl
                ? '    <img class="streamflix-poster-img" loading="lazy" decoding="async" src="' + escapeHtml(posterUrl) + '" referrerpolicy="no-referrer" alt="" data-bfx-img="fade" />'
                : '')
            + '    <span class="bfx-seerr-icon-badge ' + statusCls + '" title="' + escapeHtml(cornerTitle) + '" aria-label="' + escapeHtml(cornerTitle) + '">' + cornerIcon + '</span>'
            + (rawDl !== null && rawDl > 0
                ? '    <div class="bfx-seerr-card-dl"><div class="streamflix-progress-fill" style="width:' + rawDl + '%;"></div></div>'
                : '')
            + '    <div class="streamflix-card-hover-overlay">'
            + '      <div class="streamflix-card-info">'
            + '        <div class="streamflix-card-title">' + escapeHtml(sItem.title) + '</div>'
            + '        <div class="streamflix-card-meta">'
            + (rating ? '<span class="streamflix-card-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '')
            + '<span>' + escapeHtml(metaText) + '</span></div>'
            + (sItem.overview ? '<div class="bfx-seerr-overview">' + escapeHtml(sItem.overview) + '</div>' : '')
            + '      </div>'
            + '      <div class="streamflix-card-quick-btns bfx-seerr-quick-btns">'
            + '        <button type="button" class="bfx-seerr-card-cta ' + statusCls + (isSubmitting ? ' is-busy' : '') + '" data-seerr-act="' + ctaAct + '" title="' + escapeHtml(ctaTitle) + '" aria-label="' + escapeHtml(ctaTitle) + '"' + (isSubmitting ? ' disabled' : '') + '>' + ctaInner + '</button>'
            + '        <button type="button" class="streamflix-qbtn streamflix-qbtn-end" data-seerr-act="open-modal" title="Details &amp; Options" aria-label="Details">' + icon('chevronDown') + '</button>'
            + '      </div>'
            + '    </div>'
            + '  </div>'
            + '  <div class="streamflix-poster-footer">'
            + '    <div class="streamflix-poster-name">' + escapeHtml(sItem.title) + '</div>'
            + '    <div class="streamflix-poster-sub"><span>' + escapeHtml(subLeft) + '</span><span class="bfx-seerr-sub-tag ' + statusCls + '">' + escapeHtml(subTagText) + '</span></div>'
            + '  </div>'
            + '</div>';
    }

    function bindSingleSeerrCard(card, sItem) {
        if (!card || !sItem || card.__bfxSeerrBound) {
            return;
        }
        card.__bfxSeerrBound = true;
        card.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var actBtn = ev.target && ev.target.closest ? ev.target.closest('[data-seerr-act]') : null;
            var act = actBtn ? actBtn.getAttribute('data-seerr-act') : 'open-modal';
            if (act === 'quick-request' && typeof quickRequestSeerrMovie === 'function') {
                ev.preventDefault();
                quickRequestSeerrMovie(sItem);
                return;
            }
            openSeerrRequestModal(sItem);
        });
        card.addEventListener('keydown', function (ev) {
            if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === card) {
                ev.preventDefault();
                openSeerrRequestModal(sItem);
            }
        });
    }

    function refreshSingleSeerrCardDom(tmdbId, isTv) {
        var key = (isTv ? 'tv' : 'movie') + ':' + Number(tmdbId);
        var matchItem = null;
        (state.seerrSearchResults || []).forEach(function (s) {
            if (s && Number(s.tmdbId) === Number(tmdbId) && (String(s.mediaType || '').toLowerCase() === 'tv') === Boolean(isTv)) {
                matchItem = s;
            }
        });
        if (!matchItem) {
            return false;
        }
        var existingCards = document.querySelectorAll('[data-seerr-key="' + key + '"]');
        if (!existingCards || !existingCards.length) {
            return false;
        }
        Array.prototype.forEach.call(existingCards, function (oldCard) {
            var parent = oldCard.parentNode;
            if (!parent) {
                return;
            }
            var wrap = document.createElement('div');
            wrap.innerHTML = buildSeerrCardHtml(matchItem);
            var freshCard = wrap.firstElementChild;
            if (freshCard) {
                parent.replaceChild(freshCard, oldCard);
                bindSingleSeerrCard(freshCard, matchItem);
                hydrateCompleteImages(freshCard);
            }
        });
        return true;
    }

    function buildSearchRowsHtml() {
        var seerrOk = isCurrentProfileSeerrAllowed();
        var localList = Array.isArray(state.searchResults) ? state.searchResults : [];
        var seerrFiltered = seerrOk
            ? filterDeduplicatedSeerrResults(state.seerrSearchResults, localList)
            : [];
        var hasLocal = localList.length > 0;
        var hasSeerr = seerrFiltered.length > 0;

        if (hasLocal || hasSeerr) {
            var html = '';

            if (hasLocal) {
                var libTitle = seerrOk
                    ? ('In Your Library — “' + escapeHtml(state.searchQuery) + '”')
                    : ('Search — “' + escapeHtml(state.searchQuery) + '”');
                html += ''
                    + '<section class="streamflix-row streamflix-row-grid bfx-unified-search-section" data-row-id="search">'
                    + '  <div class="streamflix-row-header bfx-unified-search-header">'
                    + '    <h2 class="streamflix-row-title">' + libTitle + '<span class="streamflix-row-count">' + localList.length + '</span></h2>'
                    + (seerrOk && !hasSeerr
                        ? ((state.seerrSearchLoading
                            ? '    <span class="bfx-seerr-inline-spin"><span class="bfx-mini-ring"></span><span>Checking Seerr…</span></span>'
                            : '')
                            + '    <button type="button" class="streamflix-ghost-btn bfx-btn-xs bfx-seerr-open-reqs-btn" data-open-seerr-requests="1">' + iconLabel('seerrIcon', 'Requests') + '</button>')
                        : '')
                    + '  </div>'
                    + '  <div class="streamflix-grid">' + localList.map(buildPosterCardHtml).join('') + '</div>'
                    + '</section>';
            } else {
                html += ''
                    + '<div class="bfx-search-lib-note">'
                    + '  <span>Not in your library yet for <strong>“' + escapeHtml(state.searchQuery) + '”</strong></span>'
                    + '</div>';
            }

            if (hasSeerr) {
                html += ''
                    + '<section class="streamflix-row streamflix-row-grid bfx-seerr-search-area" data-row-id="seerr-search" aria-label="Available to Request">'
                    + '  <div class="bfx-seerr-area-header">'
                    + '    <div class="bfx-seerr-area-heading">'
                    + '      <span class="bfx-seerr-area-ico">' + icon('seerrIcon') + '</span>'
                    + '      <h3 class="bfx-seerr-area-title">Available to Request</h3>'
                    + '      <span class="streamflix-row-count">' + seerrFiltered.length + '</span>'
                    + '      <span class="bfx-seerr-area-sub">From Seerr · Not in library</span>'
                    + '    </div>'
                    + '    <div class="bfx-seerr-area-actions">'
                    + (state.seerrSearchLoading
                        ? '      <span class="bfx-seerr-inline-spin"><span class="bfx-mini-ring"></span><span>Checking…</span></span>'
                        : '')
                    + '      <button type="button" class="streamflix-ghost-btn bfx-btn-xs" data-open-seerr-requests="1">' + iconLabel('seerrIcon', 'Requests') + '</button>'
                    + '    </div>'
                    + '  </div>'
                    + '  <div class="streamflix-grid">' + seerrFiltered.map(buildSeerrCardHtml).join('') + '</div>'
                    + '</section>';
            }

            return html;
        }

        if (state.seerrSearchLoading) {
            return '<div class="streamflix-filter-loading"><div class="streamflix-spinner-ring"></div><span>Searching “' + escapeHtml(state.searchQuery) + '”…</span></div>';
        }

        var emptyHint = seerrOk
            ? 'No matching titles were found in your library or on Seerr.'
            : 'Try a different title, or browse by category.';
        return buildEmptyStateHtml('search', 'No matches for “' + state.searchQuery + '”', emptyHint)
            + (seerrOk ? '<div class="bfx-seerr-empty-reqs-wrap"><button type="button" class="streamflix-ghost-btn bfx-btn-xs" data-open-seerr-requests="1">' + iconLabel('seerrIcon', 'View Media Requests') + '</button></div>' : '');
    }

    function bindSeerrCardsInContainer(containerEl) {
        if (!containerEl) {
            return;
        }
        Array.prototype.forEach.call(containerEl.querySelectorAll('[data-open-seerr-requests]'), function (btn) {
            if (btn.__bfxReqBtnBound) {
                return;
            }
            btn.__bfxReqBtnBound = true;
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                openSeerrRequestsModal();
            });
        });
        var map = {};
        (state.seerrSearchResults || []).concat((state.hotTabExtra && state.hotTabExtra.seerrComingSoon) || []).forEach(function (s) {
            if (s && s.tmdbId) {
                var k = (String(s.mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie') + ':' + s.tmdbId;
                if (!map[k]) { map[k] = s; }
            }
        });
        Array.prototype.forEach.call(containerEl.querySelectorAll('[data-seerr-key]'), function (card) {
            var key = card.getAttribute('data-seerr-key');
            var sItem = map[key];
            if (sItem) {
                bindSingleSeerrCard(card, sItem);
            }
        });
        hydrateCompleteImages(containerEl);
    }

    function buildCardQuickButtons(item, withPlayed) {
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        return ''
            + '<div class="streamflix-card-quick-btns">'
            + '  <button type="button" class="streamflix-qbtn play" data-action="play" title="Play" aria-label="Play">' + icon('play') + '</button>'
            + '  <button type="button" class="streamflix-qbtn' + (isFav ? ' active' : '') + '" data-action="fav" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
            + (withPlayed ? '  <button type="button" class="streamflix-qbtn' + (isPlayed ? ' active' : '') + '" data-action="played" title="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>' : '')
            + '  <button type="button" class="streamflix-qbtn streamflix-qbtn-end" data-action="info" title="Details" aria-label="Details">' + icon('chevronDown') + '</button>'
            + '</div>';
    }

    function buildCardMetaText(item) {
        var parts = [];
        if (item.ProductionYear) {
            parts.push(String(item.ProductionYear));
        }
        if (item.OfficialRating) {
            parts.push(String(item.OfficialRating));
        }
        var rt = formatRuntimeTicks(item.RunTimeTicks);
        if (rt && item.Type !== 'Series') {
            parts.push(rt.trim());
        } else if (item.Type === 'Series') {
            parts.push('Series');
        } else if (item.Type === 'BoxSet') {
            parts.push('Collection');
        }
        return parts.join(' · ');
    }

    function buildPosterCardHtml(item) {
        var posterUrl = getItemPosterUrl(item, 400);
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var isPlayed = item.UserData && item.UserData.Played;
        var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 2).join(' · ') : '';
        var rating = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var topRank = getTop10Rank(item && item.Id);

        return ''
            + '<div class="streamflix-poster-card" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml((topRank ? '#' + topRank + ' ' : '') + item.Name) + '">'
            + '  <div class="streamflix-poster-img-wrap">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(item.Name) + '</div>'
            + (posterUrl ? '    <img class="streamflix-poster-img" loading="lazy" src="' + escapeHtml(posterUrl) + '" alt="" data-bfx-img="fade" />' : '')
            + (topRank
                ? '<span class="streamflix-top10-rank-badge" title="Ranked #' + topRank + ' in Top 10">#' + topRank + '</span>'
                : (isRecentlyAdded(item) ? '<span class="streamflix-card-flag">New</span>' : ''))
            + (isPlayed ? '<span class="streamflix-card-watched" title="Watched">' + icon('check') + '</span>' : '')
            + '    <div class="streamflix-card-hover-overlay">'
            + '      <div class="streamflix-card-info">'
            + '        <div class="streamflix-card-title">' + escapeHtml(item.Name) + '</div>'
            + '        <div class="streamflix-card-meta">'
            + (rating ? '<span class="streamflix-card-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '')
            + '<span>' + escapeHtml(buildCardMetaText(item)) + '</span></div>'
            + (genres ? '<div class="streamflix-card-genres">' + escapeHtml(genres) + '</div>' : '')
            + '      </div>'
            + buildCardQuickButtons(item, true)
            + '    </div>'
            + '  </div>'
            + '  <div class="streamflix-poster-footer">'
            + '    <div class="streamflix-poster-name">' + escapeHtml(item.Name) + '</div>'
            + '    <div class="streamflix-poster-sub"><span>' + escapeHtml(year) + '</span>' + (rating ? '<span class="streamflix-card-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '') + '</div>'
            + '  </div>'
            + '</div>';
    }

    function buildWideCardHtml(item, opts) {
        var backdropUrl = getItemBackdropUrl(item, 640);
        var pct = (item.UserData && item.UserData.PlayedPercentage) ? Math.min(100, Math.max(2, Math.round(item.UserData.PlayedPercentage))) : 0;
        var hasResumePos = Boolean((opts && typeof opts === 'object' && opts.removable) || pct > 0 || (item.UserData && item.UserData.PlaybackPositionTicks > 0));
        var title = item.SeriesName ? item.SeriesName : item.Name;
        var timeLeft = formatTimeLeft(item);
        var sub = item.SeriesName
            ? ('S' + (item.ParentIndexNumber || 1) + ' E' + (item.IndexNumber || 1) + ' · ' + item.Name)
            : (timeLeft || buildCardMetaText(item));

        return ''
            + '<div class="streamflix-wide-card" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml(title) + '">'
            + '  <div class="streamflix-wide-img-wrap">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(title) + '</div>'
            + '    <img class="streamflix-wide-img" loading="lazy" src="' + escapeHtml(backdropUrl) + '" alt="" data-bfx-img="fade" />'
            + '    <div class="streamflix-wide-scrim"></div>'
            + '    <button type="button" class="streamflix-wide-play" data-action="play" title="' + (pct > 0 ? 'Resume' : 'Play') + '" aria-label="Play">' + icon('play') + '</button>'
            + '    <div class="streamflix-wide-actions">'
            + (hasResumePos ? '      <button type="button" class="streamflix-qbtn streamflix-qbtn-remove-resume" data-action="remove-resume" title="Remove from Continue Watching" aria-label="Remove from Continue Watching">' + icon('close') + '</button>' : '')
            + '      <button type="button" class="streamflix-qbtn" data-action="info" title="Details" aria-label="Details">' + icon('info') + '</button>'
            + '    </div>'
            + '    <div class="streamflix-wide-caption">'
            + '      <div class="streamflix-wide-title">' + escapeHtml(title) + '</div>'
            + '      <div class="streamflix-wide-sub">' + escapeHtml(sub) + '</div>'
            + '    </div>'
            + (pct > 0
                ? '<div class="streamflix-progress-track"><div class="streamflix-progress-fill" style="width:' + pct + '%;"></div></div>'
                : '')
            + '  </div>'
            + '</div>';
    }

    function buildTop10CardHtml(item, rank) {
        var posterUrl = getItemPosterUrl(item, 400);
        return ''
            + '<div class="streamflix-top10-card" data-item-id="' + escapeHtml(item.Id) + '" tabindex="0" role="button" aria-label="' + escapeHtml('#' + rank + ' ' + item.Name) + '">'
            + '  <span class="streamflix-top10-num" aria-hidden="true">' + rank + '</span>'
            + '  <div class="streamflix-top10-poster">'
            + '    <div class="streamflix-card-fallback">' + escapeHtml(item.Name) + '</div>'
            + (posterUrl ? '    <img loading="lazy" src="' + escapeHtml(posterUrl) + '" alt="" data-bfx-img="fade" />' : '')
            + '    <span class="streamflix-top10-rank-badge" aria-hidden="true">#' + rank + '</span>'
            + '    <div class="streamflix-card-hover-overlay">'
            + '      <div class="streamflix-card-info"><div class="streamflix-card-title">' + escapeHtml(item.Name) + '</div></div>'
            + buildCardQuickButtons(item, false)
            + '    </div>'
            + '  </div>'
            + '</div>';
    }

    function buildRowHtml(rowId, title, cardsHtml, opts) {
        if (!cardsHtml) {
            return '';
        }
        opts = opts || {};
        var safeRowCls = sanitizeClassNames(opts.className);
        return ''
            + '<section class="streamflix-row' + (safeRowCls ? ' ' + safeRowCls : '') + '" data-row-id="' + escapeHtml(rowId) + '">'
            + '  <div class="streamflix-row-header">'
            + '    <h2 class="streamflix-row-title">' + title + '</h2>'
            + (opts.link ? '<button type="button" class="streamflix-row-link" data-cat-link="' + escapeHtml(opts.link) + '">Explore all' + icon('chevronRight') + '</button>' : '')
            + '  </div>'
            + '  <div class="streamflix-carousel-wrap at-start">'
            + '    <button type="button" class="streamflix-paddle left" data-scroll-dir="-1" aria-label="Scroll left">' + icon('chevronLeft') + '</button>'
            + '    <div class="streamflix-carousel-track">' + cardsHtml + '</div>'
            + '    <button type="button" class="streamflix-paddle right" data-scroll-dir="1" aria-label="Scroll right">' + icon('chevronRight') + '</button>'
            + '  </div>'
            + '</section>';
    }

    function buildGridSectionHtml(sectionId, title, itemsList, opts) {
        if (!Array.isArray(itemsList) || itemsList.length === 0) {
            return '';
        }
        opts = opts || {};
        var cardsHtml = itemsList.map(buildPosterCardHtml).join('');
        return ''
            + '<section class="streamflix-row streamflix-row-grid" data-row-id="' + escapeHtml(sectionId) + '">'
            + '  <div class="streamflix-row-header">'
            + '    <h2 class="streamflix-row-title">' + title + '</h2>'
            + (opts.actionHtml || '')
            + '  </div>'
            + '  <div class="streamflix-grid">' + cardsHtml + '</div>'
            + (opts.footerHtml || '')
            + '</section>';
    }

    function buildEmptyStateHtml(iconName, title, text) {
        return ''
            + '<div class="streamflix-empty-state">'
            + '  <div class="streamflix-empty-icon">' + icon(iconName) + '</div>'
            + '  <div class="streamflix-empty-title">' + escapeHtml(title) + '</div>'
            + (text ? '<div class="streamflix-empty-text">' + escapeHtml(text) + '</div>' : '')
            + '</div>';
    }

    function rowTitle(text, count) {
        return escapeHtml(text) + (count ? '<span class="streamflix-row-count">' + count + '</span>' : '');
    }
