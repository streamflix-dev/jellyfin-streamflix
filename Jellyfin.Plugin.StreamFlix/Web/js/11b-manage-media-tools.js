/* StreamFlix Client (11b/14) — Admin Manage Media Tools (edit metadata, identify, refresh, media info, delete) */
    /* ----------------------------------------------------------------------
       7b. "Manage Media" menu — StreamFlix-styled equivalents of Jellyfin's
           native item context menu actions, driven by the Jellyfin REST API.
       ---------------------------------------------------------------------- */
    function canManageMediaItems() {
        if (isGuestPassSession()) {
            return false;
        }
        if (typeof isActiveProfileAdmin === 'function') {
            return isActiveProfileAdmin();
        }
        var active = state.activeProfile;
        if (!active || active.isKids) {
            return false;
        }
        var serverProfile = active.id && typeof findProfileById === 'function' ? findProfileById(active.id) : null;
        return Boolean(serverProfile ? serverProfile.isAdmin : active.isAdmin);
    }

    function currentUserHasDownloadPermission() {
        if (isGuestPassSession() || (typeof isKidsProfileActive === 'function' && isKidsProfileActive())) {
            return false;
        }
        if (canManageMediaItems()) {
            return true;
        }
        var active = state.activeProfile;
        if (active && active.user && active.user.Policy && typeof active.user.Policy.EnableContentDownloading === 'boolean') {
            return active.user.Policy.EnableContentDownloading;
        }
        var ac = typeof resolveActiveApiClient === 'function' ? resolveActiveApiClient() : window.ApiClient;
        if (ac && ac._currentUser && ac._currentUser.Policy && typeof ac._currentUser.Policy.EnableContentDownloading === 'boolean') {
            return ac._currentUser.Policy.EnableContentDownloading;
        }
        var uid = getActiveUserId();
        if (uid && state.userDownloadPermCache && typeof state.userDownloadPermCache[normalizeGuid(uid)] === 'boolean') {
            return state.userDownloadPermCache[normalizeGuid(uid)];
        }
        if (uid && getActiveToken()) {
            state.userDownloadPermCache = state.userDownloadPermCache || {};
            var normUid = normalizeGuid(uid);
            if (!state.userDownloadPermPending || !state.userDownloadPermPending[normUid]) {
                state.userDownloadPermPending = state.userDownloadPermPending || {};
                state.userDownloadPermPending[normUid] = true;
                apiFetch('/Users/' + encodeURIComponent(uid)).then(function (u) {
                    if (u && u.Policy && typeof u.Policy.EnableContentDownloading === 'boolean') {
                        state.userDownloadPermCache[normUid] = u.Policy.EnableContentDownloading;
                    }
                }).catch(function () {}).then(function () {
                    delete state.userDownloadPermPending[normUid];
                });
            }
        }
        return false;
    }

    function canUserDownloadItem(item) {
        if (!item || !item.Id) {
            return false;
        }
        if (isGuestPassSession() || (typeof isKidsProfileActive === 'function' && isKidsProfileActive())) {
            return false;
        }
        if (item.LocationType === 'Virtual') {
            return false;
        }
        var t = String(item.Type || '');
        if (t !== 'Movie' && t !== 'Episode' && t !== 'Video') {
            return false;
        }
        if (item.CanDownload === true) {
            return true;
        }
        if (item.CanDownload === false) {
            return Boolean(canManageMediaItems());
        }
        return Boolean(currentUserHasDownloadPermission());
    }

    function triggerDirectMediaDownload(itemOrId, overrideToken) {
        var itemId = typeof itemOrId === 'string' ? itemOrId : (itemOrId && itemOrId.Id);
        if (!itemId) {
            showToast('Could not determine item to download.', 'error');
            return;
        }
        var tok = sanitizeHeaderField(overrideToken || getActiveToken() || (state.adminAuth && state.adminAuth.accessToken) || '');
        if (!tok) {
            showToast('Sign in to download media.', 'error');
            return;
        }
        var url = apiBase() + '/Items/' + encodeURIComponent(itemId) + '/Download?api_key=' + encodeURIComponent(tok);
        var a = document.createElement('a');
        a.href = url;
        a.download = '';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            if (a.parentNode) {
                a.parentNode.removeChild(a);
            }
        }, 1200);
        showToast('Download started.', 'success');
    }
    // so media management calls use an explicit admin-token request helper.
    function adminApiFetch(adminAuth, path, options) {
        options = options || {};
        var headers = {};
        if (options.headers) {
            Object.keys(options.headers).forEach(function (k) {
                headers[k] = options.headers[k];
            });
        }
        if (!headers['Accept']) {
            headers['Accept'] = 'application/json';
        }
        var token = sanitizeHeaderField(adminAuth && adminAuth.accessToken);
        if (token) {
            var authVal = getEmbyAuthHeader(token);
            headers['Authorization'] = authVal;
            headers['X-Emby-Authorization'] = authVal;
            headers['X-Emby-Token'] = token;
        }
        options.headers = headers;
        var fetchFn = nativeFetch || window.fetch;
        return fetchFn(apiBase() + path, options).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (txt) {
                    var msg = 'HTTP ' + res.status;
                    try {
                        var parsed = JSON.parse(txt);
                        if (parsed && parsed.message) {
                            msg = parsed.message;
                        }
                    } catch (e) {
                        if (txt && txt.length < 300) {
                            msg = txt;
                        }
                    }
                    var err = new Error(msg);
                    err.status = res.status;
                    throw err;
                });
            }
            var ct = res.headers.get('content-type') || '';
            if (ct.indexOf('application/json') !== -1) {
                return res.json();
            }
            return res.text();
        });
    }

    function requestManageAdminAuth(suppliedPin, forceElevate) {
        if (isGuestPassSession()) {
            return Promise.reject(new Error('Guest passes cannot manage media.'));
        }
        if (!canManageMediaItems()) {
            return Promise.reject(new Error('Switch to an Administrator profile first to manage media.'));
        }
        if (!suppliedPin && !forceElevate) {
            if (typeof isCurrentJellyfinClientAdmin === 'function' && isCurrentJellyfinClientAdmin()) {
                var liveInfo = getUnderlyingApiClientAuth();
                if (liveInfo.userId && liveInfo.accessToken) {
                    saveAdminAuth({
                        userId: liveInfo.userId,
                        userName: (liveInfo.client && liveInfo.client._currentUser && liveInfo.client._currentUser.Name) || 'Administrator',
                        accessToken: liveInfo.accessToken,
                        serverId: resolveKnownServerId(),
                        user: (liveInfo.client && liveInfo.client._currentUser) || null
                    });
                }
            }
            if (state.adminAuth && state.adminAuth.accessToken && state.adminAuth.userId) {
                return Promise.resolve(state.adminAuth);
            }
            if (state.activeProfile && state.activeProfile.isAdmin && state.activeProfile.accessToken && state.activeProfile.jellyfinUserId) {
                saveAdminAuth({
                    userId: state.activeProfile.jellyfinUserId,
                    userName: state.activeProfile.jellyfinUsername || state.activeProfile.name || 'Administrator',
                    accessToken: state.activeProfile.accessToken,
                    serverId: state.activeProfile.serverId || resolveKnownServerId(),
                    user: null
                });
                if (state.adminAuth && state.adminAuth.accessToken && state.adminAuth.userId) {
                    return Promise.resolve(state.adminAuth);
                }
            }
        }
        var dev = getJellyfinDeviceInfo();
        return apiFetch('/StreamFlix/Auth/ElevateAdmin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                appName: dev.appName,
                appVersion: dev.appVersion,
                pin: suppliedPin || ''
            })
        }).then(function (res) {
            if (!res || !res.accessToken || !res.userId) {
                throw new Error('Could not activate Administrator session.');
            }
            saveAdminAuth({
                userId: res.userId,
                userName: res.userName || 'Administrator',
                accessToken: res.accessToken,
                serverId: res.serverId || (state.config && state.config.serverId) || '',
                user: res.user || null
            });
            return state.adminAuth;
        }).catch(function (err) {
            var code = err && err.code;
            if (!suppliedPin && (code === 'pin_required' || code === 'pin_invalid') && typeof openPinPad === 'function') {
                return new Promise(function (resolve, reject) {
                    var settled = false;
                    var ownerProf = getProfiles().filter(function (p) { return p.isOwner || p.isAdmin; })[0]
                        || { name: 'Administrator', icon: '👑', color: '#E50914' };
                    openPinPad({
                        profile: ownerProf,
                        title: 'Administrator PIN',
                        subtitleHtml: 'Enter the PIN for <strong>' + escapeHtml(ownerProf.name) + '</strong> to manage media.',
                        initialError: code === 'pin_invalid' ? err.message : '',
                        onClose: function () {
                            if (!settled) {
                                settled = true;
                                var cancelErr = new Error('Administrator sign-in was cancelled.');
                                cancelErr.code = 'elevation_cancelled';
                                reject(cancelErr);
                            }
                        },
                        submit: function (pin) {
                            return requestManageAdminAuth(pin, forceElevate).then(function (auth) {
                                settled = true;
                                resolve(auth);
                            });
                        }
                    });
                });
            }
            throw err;
        });
    }

    function runWithManageAuth(run) {
        return requestManageAdminAuth().then(function (adminAuth) {
            return run(adminAuth).catch(function (err) {
                if (err && err.status === 401) {
                    clearAdminAuth();
                    return requestManageAdminAuth('', true).then(run);
                }
                throw err;
            });
        });
    }

    function fetchItemAsAdmin(adminAuth, itemId) {
        var iid = encodeURIComponent(itemId);
        var uid = encodeURIComponent(adminAuth.userId);
        return adminApiFetch(adminAuth, '/Items/' + iid + '?userId=' + uid).catch(function () {
            return adminApiFetch(adminAuth, '/Users/' + uid + '/Items/' + iid);
        });
    }

    function joinEditableNames(arr) {
        if (!Array.isArray(arr) || !arr.length) {
            return '';
        }
        var hasComma = arr.some(function (n) { return String(n).indexOf(',') !== -1; });
        var joined = arr.join(hasComma ? '; ' : ', ');
        return hasComma ? joined + ';' : joined;
    }

    function splitEditableNames(raw) {
        var s = String(raw || '');
        var sep = s.indexOf(';') !== -1 ? ';' : ',';
        return s.split(sep).map(function (p) { return p.trim(); }).filter(Boolean);
    }

    function manageMediaErrorToast(err, fallback) {
        if (err && err.code === 'elevation_cancelled') {
            return;
        }
        showToast((err && err.message) || fallback, 'error');
    }

    function matchesManagedItemId(it, norm) {
        return Boolean(it && (normalizeGuid(it.Id) === norm
            || normalizeGuid(it.SeriesId) === norm
            || normalizeGuid(it.SeasonId) === norm
            || normalizeGuid(it.ParentId) === norm));
    }

    function purgeDeletedItemFromCaches(itemId) {
        var norm = normalizeGuid(itemId);
        try {
            Object.keys(state.itemCache || {}).forEach(function (k) {
                if (normalizeGuid(k) === norm || matchesManagedItemId(state.itemCache[k], norm)) {
                    delete state.itemCache[k];
                }
            });
        } catch (ePurge) {}
        var d = state.hubData || {};
        ['heroItems', 'resumeItems', 'nextUpItems', 'top10Items', 'favoriteItems',
            'recentMovies', 'recentSeries', 'allMovies', 'allSeries', 'collectionsItems'].forEach(function (key) {
            if (Array.isArray(d[key])) {
                d[key] = d[key].filter(function (it) { return !matchesManagedItemId(it, norm); });
            }
        });
        if (Array.isArray(state.searchResults)) {
            state.searchResults = state.searchResults.filter(function (it) { return !matchesManagedItemId(it, norm); });
        }
        if (state.browseFilter && Array.isArray(state.browseFilter.items)) {
            state.browseFilter.items = state.browseFilter.items.filter(function (it) { return !matchesManagedItemId(it, norm); });
        }
        state.personalRowsByUser = {};
        try {
            Array.prototype.forEach.call(document.querySelectorAll('[data-item-id="' + cssEscape(String(itemId)) + '"]'), function (card) {
                if (card.parentNode) {
                    card.parentNode.removeChild(card);
                }
            });
        } catch (eCards) {}
        if (state.hubData && state.hubData.loaded && typeof loadCinemaHubData === 'function') {
            loadCinemaHubData(true);
        }
    }

    function openManageMediaMenu(opts) {
        opts = opts || {};
        var item = opts.item;
        if (!item || !item.Id || !canManageMediaItems()) {
            return;
        }
        var displayName = (item.Type === 'Episode' && item.SeriesName)
            ? (item.SeriesName + ' — ' + (item.Name || 'Episode'))
            : (item.Name || 'this title');
        var canIdentify = item.Type === 'Movie' || item.Type === 'Series' || item.Type === 'BoxSet';
        var hasMediaInfo = item.Type === 'Movie' || item.Type === 'Episode'
            || (Array.isArray(item.MediaSources) && item.MediaSources.length > 0);

        var rows = [
            { act: 'edit', icon: 'edit', label: 'Edit metadata', hint: 'Title, overview, year, ratings, genres & tags' },
            canIdentify ? { act: 'identify', icon: 'search', label: 'Identify', hint: 'Match against metadata providers' } : null,
            { act: 'refresh', icon: 'refresh', label: 'Refresh metadata', hint: 'Search providers for updated metadata & missing images' },
            hasMediaInfo ? { act: 'info', icon: 'info', label: 'Media info', hint: 'Container, video, audio & subtitle streams' } : null,
            hasMediaInfo ? { act: 'download', icon: 'download', label: 'Download', hint: 'Save the media file to this device' } : null,
            { act: 'advanced', icon: 'sliders', label: 'Advanced editor', hint: 'Open Jellyfin\u2019s full Metadata Manager (images & more)' },
            { act: 'delete', icon: 'trash', label: 'Delete media', hint: 'Permanently remove the files from disk', danger: true }
        ].filter(Boolean);

        var rowsHtml = rows.map(function (r) {
            return ''
                + '<button type="button" class="bfx-manage-row' + (r.danger ? ' is-danger' : '') + '" data-manage-act="' + r.act + '">'
                + icon(r.icon, 'bfx-manage-row-icon')
                + '<span class="bfx-manage-row-text">'
                + '  <span class="bfx-manage-row-label">' + escapeHtml(r.label) + '</span>'
                + '  <span class="bfx-manage-row-hint">' + escapeHtml(r.hint) + '</span>'
                + '</span>'
                + icon('chevronRight', 'bfx-manage-row-chev')
                + '</button>';
        }).join('');

        var m = openModal(''
            + '<h2>Manage Media</h2>'
            + '<p class="streamflix-modal-text">' + escapeHtml(displayName) + '</p>'
            + '<div class="bfx-manage-menu">' + rowsHtml + '</div>', { className: 'streamflix-modal-sm' });

        Array.prototype.forEach.call(m.modal.querySelectorAll('[data-manage-act]'), function (btn) {
            btn.addEventListener('click', function () {
                var act = btn.getAttribute('data-manage-act');
                m.close();
                if (act === 'edit') {
                    manageEditMetadata(item, opts);
                } else if (act === 'identify') {
                    openIdentifyDialog(item, opts);
                } else if (act === 'refresh') {
                    manageRefreshMetadata(item);
                } else if (act === 'info') {
                    openMediaInfoDialog(item);
                } else if (act === 'download') {
                    manageDownloadMedia(item);
                } else if (act === 'advanced') {
                    if (state.activeDetailModal && typeof state.activeDetailModal.close === 'function') {
                        try { state.activeDetailModal.close(true); } catch (eCloseDetail) {}
                    }
                    openStreamFlixAdminRoute('#/metadata?id=' + encodeURIComponent(item.Id));
                } else if (act === 'delete') {
                    manageDeleteMedia(item, opts);
                }
            });
        });
    }

    function manageEditMetadata(item, opts) {
        runWithManageAuth(function (adminAuth) {
            return fetchItemAsAdmin(adminAuth, item.Id).then(function (fullItem) {
                if (!fullItem || !fullItem.Id) {
                    throw new Error('Could not load item details.');
                }
                openEditMetadataDialog(adminAuth, fullItem, opts);
            });
        }).catch(function (err) {
            manageMediaErrorToast(err, 'Could not open the metadata editor.');
        });
    }

    function openEditMetadataDialog(adminAuth, fullItem, opts) {
        opts = opts || {};
        var origGenresText = joinEditableNames(fullItem.Genres);
        var origTagsText = joinEditableNames(fullItem.Tags);
        var origStudiosText = joinEditableNames(Array.isArray(fullItem.Studios)
            ? fullItem.Studios.map(function (s) { return s && s.Name ? s.Name : ''; }).filter(Boolean)
            : []);
        var origGenresArr = Array.isArray(fullItem.Genres) ? fullItem.Genres.slice() : [];
        var origTagsArr = Array.isArray(fullItem.Tags) ? fullItem.Tags.slice() : [];
        var origStudiosArr = Array.isArray(fullItem.Studios) ? fullItem.Studios.slice() : [];
        var listPlaceholder = 'Comma separated — use ; between names that contain commas';
        var m = openModal(''
            + '<h2>Edit Metadata</h2>'
            + '<p class="streamflix-modal-text">' + escapeHtml(fullItem.Name || '') + (fullItem.ProductionYear ? ' (' + fullItem.ProductionYear + ')' : '') + '</p>'
            + '<div class="streamflix-field">'
            + '  <label for="bfx-meta-title">Title</label>'
            + '  <input type="text" id="bfx-meta-title" class="streamflix-input" maxlength="300" value="' + escapeHtml(fullItem.Name || '') + '" />'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="bfx-meta-sort">Sort Title</label>'
            + '  <input type="text" id="bfx-meta-sort" class="streamflix-input" maxlength="300" value="' + escapeHtml(fullItem.ForcedSortName || '') + '" placeholder="Leave blank to sort by title" />'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="bfx-meta-overview">Overview</label>'
            + '  <textarea id="bfx-meta-overview" class="streamflix-input bfx-meta-textarea" rows="5">' + escapeHtml(fullItem.Overview || '') + '</textarea>'
            + '</div>'
            + '<div class="streamflix-field-row">'
            + '  <div class="streamflix-field">'
            + '    <label for="bfx-meta-year">Year</label>'
            + '    <input type="number" id="bfx-meta-year" class="streamflix-input" min="1870" max="2200" value="' + (fullItem.ProductionYear || '') + '" />'
            + '  </div>'
            + '  <div class="streamflix-field">'
            + '    <label for="bfx-meta-rating">Parental Rating</label>'
            + '    <input type="text" id="bfx-meta-rating" class="streamflix-input" maxlength="30" value="' + escapeHtml(fullItem.OfficialRating || '') + '" placeholder="e.g. PG-13, TV-MA" />'
            + '  </div>'
            + '  <div class="streamflix-field">'
            + '    <label for="bfx-meta-community">Community Rating</label>'
            + '    <input type="number" id="bfx-meta-community" class="streamflix-input" min="0" max="10" step="0.1" value="' + (typeof fullItem.CommunityRating === 'number' ? fullItem.CommunityRating.toFixed(1) : '') + '" />'
            + '  </div>'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="bfx-meta-genres">Genres</label>'
            + '  <input type="text" id="bfx-meta-genres" class="streamflix-input" value="' + escapeHtml(origGenresText) + '" placeholder="' + listPlaceholder + '" />'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="bfx-meta-tags">Tags</label>'
            + '  <input type="text" id="bfx-meta-tags" class="streamflix-input" value="' + escapeHtml(origTagsText) + '" placeholder="' + listPlaceholder + '" />'
            + '</div>'
            + '<div class="streamflix-field">'
            + '  <label for="bfx-meta-studios">Studios</label>'
            + '  <input type="text" id="bfx-meta-studios" class="streamflix-input" value="' + escapeHtml(origStudiosText) + '" placeholder="' + listPlaceholder + '" />'
            + '</div>'
            + '<div class="streamflix-form-error" id="bfx-meta-err" aria-live="assertive"></div>'
            + '<div class="streamflix-modal-actions streamflix-modal-actions-end">'
            + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">Cancel</button>'
            + '  <button type="button" class="streamflix-btn-primary" data-act="save">Save</button>'
            + '</div>');

        function q(sel) {
            return m.modal.querySelector(sel);
        }

        q('[data-act="cancel"]').addEventListener('click', function () { m.close(false); });

        var saveBtn = q('[data-act="save"]');
        var errEl = q('#bfx-meta-err');
        var busy = false;
        saveBtn.addEventListener('click', function () {
            if (busy) {
                return;
            }
            var titleVal = q('#bfx-meta-title').value.trim();
            if (!titleVal) {
                errEl.textContent = 'Title is required.';
                return;
            }
            errEl.textContent = '';
            busy = true;
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';

            var yearRaw = q('#bfx-meta-year').value.trim();
            var commRaw = q('#bfx-meta-community').value.trim();
            fullItem.Name = titleVal;
            fullItem.ForcedSortName = q('#bfx-meta-sort').value.trim();
            fullItem.Overview = q('#bfx-meta-overview').value;
            fullItem.ProductionYear = yearRaw ? parseInt(yearRaw, 10) : null;
            fullItem.OfficialRating = q('#bfx-meta-rating').value.trim() || null;
            fullItem.CommunityRating = commRaw ? Math.min(10, Math.max(0, parseFloat(commRaw))) : null;
            var genresText = q('#bfx-meta-genres').value;
            fullItem.Genres = genresText.trim() !== origGenresText
                ? splitEditableNames(genresText)
                : origGenresArr.slice();
            var tagsText = q('#bfx-meta-tags').value;
            fullItem.Tags = tagsText.trim() !== origTagsText
                ? splitEditableNames(tagsText)
                : origTagsArr.slice();
            var studiosText = q('#bfx-meta-studios').value;
            fullItem.Studios = studiosText.trim() !== origStudiosText
                ? splitEditableNames(studiosText).map(function (n) { return { Name: n }; })
                : origStudiosArr.slice();

            runWithManageAuth(function (auth) {
                return adminApiFetch(auth, '/Items/' + encodeURIComponent(fullItem.Id), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fullItem)
                });
            }).then(function () {
                m.close(true);
                showToast('Metadata saved.', 'success');
                if (typeof opts.onItemEdited === 'function') {
                    opts.onItemEdited(fullItem);
                }
            }).catch(function (err) {
                busy = false;
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
                errEl.textContent = (err && err.message) || 'Could not save metadata.';
            });
        });
    }

    function openIdentifyDialog(item, opts) {
        opts = opts || {};
        var m = openModal(''
            + '<h2>Identify</h2>'
            + '<p class="streamflix-modal-text">Search metadata providers and pick the correct match for <strong>' + escapeHtml(item.Name || '') + '</strong>.</p>'
            + '<div class="streamflix-field-row">'
            + '  <div class="streamflix-field" style="flex:2 1 auto;">'
            + '    <label for="bfx-identify-name">Name</label>'
            + '    <input type="text" id="bfx-identify-name" class="streamflix-input" value="' + escapeHtml(item.Name || '') + '" />'
            + '  </div>'
            + '  <div class="streamflix-field">'
            + '    <label for="bfx-identify-year">Year</label>'
            + '    <input type="number" id="bfx-identify-year" class="streamflix-input" min="1870" max="2200" value="' + (item.ProductionYear || '') + '" />'
            + '  </div>'
            + '</div>'
            + '<label class="streamflix-check" style="margin-top:4px;">'
            + '  <input type="checkbox" id="bfx-identify-replace-images" checked />'
            + '  <span>Replace existing images with the new match</span>'
            + '</label>'
            + '<div class="streamflix-form-error" id="bfx-identify-err" aria-live="assertive"></div>'
            + '<div class="bfx-identify-results" id="bfx-identify-results"></div>'
            + '<div class="streamflix-modal-actions streamflix-modal-actions-end">'
            + '  <button type="button" class="streamflix-ghost-btn" data-act="cancel">Cancel</button>'
            + '  <button type="button" class="streamflix-btn-primary" data-act="search">' + iconLabel('search', 'Search') + '</button>'
            + '</div>');

        function q(sel) {
            return m.modal.querySelector(sel);
        }

        q('[data-act="cancel"]').addEventListener('click', function () { m.close(false); });

        var searchBtn = q('[data-act="search"]');
        var errEl = q('#bfx-identify-err');
        var resultsEl = q('#bfx-identify-results');
        var busy = false;

        function applyResult(result) {
            var replaceImages = Boolean(q('#bfx-identify-replace-images') && q('#bfx-identify-replace-images').checked);
            var matchLabel = (result.Name || 'Unknown') + (result.ProductionYear ? ' (' + result.ProductionYear + ')' : '');
            confirmDialog({
                title: 'Apply this match?',
                message: 'Replace the metadata for "' + (item.Name || '') + '" with "' + matchLabel + '"'
                    + (result.SearchProviderName ? ' from ' + result.SearchProviderName : '') + '?'
                    + (replaceImages ? ' Existing images will be replaced.' : ''),
                confirmText: 'Apply'
            }).then(function (ok) {
                if (!ok) {
                    return;
                }
                runWithManageAuth(function (auth) {
                    return adminApiFetch(auth, '/Items/RemoteSearch/Apply/' + encodeURIComponent(item.Id) + '?replaceAllImages=' + (replaceImages ? 'true' : 'false'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(result)
                    });
                }).then(function () {
                    m.close(true);
                    showToast('Match applied — metadata is refreshing in the background.', 'success');
                }).catch(function (err) {
                    manageMediaErrorToast(err, 'Could not apply the selected match.');
                });
            });
        }

        function renderResults(results) {
            if (!Array.isArray(results) || !results.length) {
                resultsEl.innerHTML = '<div class="streamflix-field-hint">No matches found. Try adjusting the name or year.</div>';
                return;
            }
            resultsEl.innerHTML = results.slice(0, 12).map(function (r, idx) {
                var sub = [r.SearchProviderName || '', (r.Overview || '').slice(0, 140)].filter(Boolean).join(' · ');
                return ''
                    + '<button type="button" class="bfx-manage-row" data-identify-idx="' + idx + '">'
                    + '<span class="bfx-manage-row-text">'
                    + '  <span class="bfx-manage-row-label">' + escapeHtml((r.Name || 'Unknown') + (r.ProductionYear ? ' (' + r.ProductionYear + ')' : '')) + '</span>'
                    + '  <span class="bfx-manage-row-hint">' + escapeHtml(sub) + '</span>'
                    + '</span>'
                    + icon('chevronRight', 'bfx-manage-row-chev')
                    + '</button>';
            }).join('');
            Array.prototype.forEach.call(resultsEl.querySelectorAll('[data-identify-idx]'), function (btn) {
                btn.addEventListener('click', function () {
                    var r = results[parseInt(btn.getAttribute('data-identify-idx'), 10)];
                    if (r) {
                        applyResult(r);
                    }
                });
            });
        }

        function runSearch() {
            if (busy) {
                return;
            }
            var nameVal = q('#bfx-identify-name').value.trim();
            if (!nameVal) {
                errEl.textContent = 'Enter a name to search for.';
                return;
            }
            errEl.textContent = '';
            busy = true;
            searchBtn.disabled = true;
            resultsEl.innerHTML = '<div class="streamflix-field-hint">Searching providers…</div>';
            var yearRaw = q('#bfx-identify-year').value.trim();
            var searchInfo = { Name: nameVal };
            if (yearRaw) {
                searchInfo.Year = parseInt(yearRaw, 10);
            }
            runWithManageAuth(function (auth) {
                return adminApiFetch(auth, '/Items/RemoteSearch/' + encodeURIComponent(item.Type), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ItemId: item.Id, SearchInfo: searchInfo })
                });
            }).then(function (results) {
                busy = false;
                searchBtn.disabled = false;
                renderResults(results);
            }).catch(function (err) {
                busy = false;
                searchBtn.disabled = false;
                resultsEl.innerHTML = '';
                errEl.textContent = (err && err.message) || 'Provider search failed.';
            });
        }

        searchBtn.addEventListener('click', runSearch);
        q('#bfx-identify-name').addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                runSearch();
            }
        });
    }

    function manageRefreshMetadata(item) {
        confirmDialog({
            title: 'Refresh metadata?',
            message: 'Search metadata providers for updated information and missing images for "' + (item.Name || '') + '"'
                + (item.Type === 'Series' || item.Type === 'BoxSet' ? ' and everything it contains' : '') + '?',
            confirmText: 'Refresh'
        }).then(function (ok) {
            if (!ok) {
                return;
            }
            runWithManageAuth(function (auth) {
                return adminApiFetch(auth, '/Items/' + encodeURIComponent(item.Id)
                    + '/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=false&ReplaceAllImages=false', {
                    method: 'POST'
                });
            }).then(function () {
                showToast('Metadata refresh queued.', 'success');
            }).catch(function (err) {
                manageMediaErrorToast(err, 'Could not queue the metadata refresh.');
            });
        });
    }

    function manageDeleteMedia(item, opts) {
        opts = opts || {};
        confirmDialog({
            title: 'Delete media?',
            message: 'Permanently delete "' + (item.Name || '') + '"'
                + (item.Type === 'Series' || item.Type === 'BoxSet' ? ' and everything it contains' : '')
                + ' from the library and from disk? This cannot be undone.',
            confirmText: 'Delete',
            danger: true
        }).then(function (ok) {
            if (!ok) {
                return;
            }
            runWithManageAuth(function (auth) {
                return adminApiFetch(auth, '/Items/' + encodeURIComponent(item.Id), { method: 'DELETE' });
            }).then(function () {
                showToast('"' + (item.Name || 'Item') + '" deleted.', 'success');
                purgeDeletedItemFromCaches(item.Id);
                if (typeof opts.onItemDeleted === 'function') {
                    opts.onItemDeleted();
                }
            }).catch(function (err) {
                manageMediaErrorToast(err, 'Could not delete this item.');
            });
        });
    }

    function manageDownloadMedia(item) {
        if (!item || !item.Id) {
            return;
        }
        var immediateTok = (state.adminAuth && state.adminAuth.accessToken)
            || (canManageMediaItems() ? getActiveToken() : '');
        if (immediateTok) {
            triggerDirectMediaDownload(item.Id, immediateTok);
            return;
        }
        runWithManageAuth(function (auth) {
            triggerDirectMediaDownload(item.Id, auth.accessToken);
            return Promise.resolve();
        }).catch(function (err) {
            manageMediaErrorToast(err, 'Could not start the download.');
        });
    }

    function formatMediaInfoSize(bytes) {
        if (!bytes || bytes <= 0) {
            return '';
        }
        if (bytes >= 1073741824) {
            return (bytes / 1073741824).toFixed(2) + ' GB';
        }
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function formatMediaInfoBitrate(bps) {
        if (!bps || bps <= 0) {
            return '';
        }
        return (bps / 1000000).toFixed(1) + ' Mbps';
    }

    function openMediaInfoDialog(item) {
        fetchFullItemDetails(item.Id).then(function (full) {
            var src = (Array.isArray(full.MediaSources) && full.MediaSources[0]) || null;
            var streams = (Array.isArray(full.MediaStreams) && full.MediaStreams.length)
                ? full.MediaStreams
                : ((src && Array.isArray(src.MediaStreams)) ? src.MediaStreams : []);

            function kv(key, val) {
                return val
                    ? '<span class="bfx-mediainfo-key">' + escapeHtml(key) + '</span><span class="bfx-mediainfo-val">' + escapeHtml(String(val)) + '</span>'
                    : '';
            }

            function sectionFor(stream) {
                var pairs = '';
                pairs += kv('Codec', (stream.Codec || '').toUpperCase());
                if (stream.Type === 'Video') {
                    pairs += kv('Resolution', stream.Width && stream.Height ? stream.Width + '×' + stream.Height : '');
                    pairs += kv('Profile', stream.Profile);
                    pairs += kv('Bit depth', stream.BitDepth ? stream.BitDepth + ' bit' : '');
                    pairs += kv('Video range', stream.VideoRange);
                    pairs += kv('Frame rate', stream.RealFrameRate ? Number(stream.RealFrameRate).toFixed(2) + ' fps' : '');
                } else if (stream.Type === 'Audio') {
                    pairs += kv('Language', stream.DisplayLanguage || stream.Language);
                    pairs += kv('Layout', stream.ChannelLayout || (stream.Channels ? stream.Channels + ' ch' : ''));
                } else {
                    pairs += kv('Language', stream.DisplayLanguage || stream.Language);
                    pairs += kv('Forced', stream.IsForced ? 'Yes' : '');
                    pairs += kv('Default', stream.IsDefault ? 'Yes' : '');
                }
                pairs += kv('Bitrate', formatMediaInfoBitrate(stream.BitRate));
                pairs += kv('Title', stream.DisplayTitle);
                return pairs
                    ? '<div class="bfx-mediainfo-section"><h3>' + escapeHtml(stream.Type) + (typeof stream.Index === 'number' ? ' #' + stream.Index : '') + '</h3><div class="bfx-mediainfo-grid">' + pairs + '</div></div>'
                    : '';
            }

            var generalPairs = '';
            if (src) {
                generalPairs += kv('Container', (src.Container || full.Container || '').toUpperCase());
                generalPairs += kv('Size', formatMediaInfoSize(src.Size));
                generalPairs += kv('Total bitrate', formatMediaInfoBitrate(src.Bitrate));
                generalPairs += kv('Path', src.Path);
            }

            var bodyHtml = (generalPairs
                ? '<div class="bfx-mediainfo-section"><h3>General</h3><div class="bfx-mediainfo-grid">' + generalPairs + '</div></div>'
                : '')
                + streams.map(sectionFor).join('');

            var m = openModal(''
                + '<h2>Media Info</h2>'
                + '<p class="streamflix-modal-text">' + escapeHtml(full.Name || item.Name || '') + '</p>'
                + '<div class="bfx-mediainfo-scroll">' + (bodyHtml || '<div class="streamflix-field-hint">No media stream information available.</div>') + '</div>'
                + '<div class="streamflix-modal-actions streamflix-modal-actions-end">'
                + '  <button type="button" class="streamflix-ghost-btn" data-act="close">Close</button>'
                + '</div>');
            m.modal.querySelector('[data-act="close"]').addEventListener('click', function () { m.close(); });
        }).catch(function () {
            showToast('Could not load media information.', 'error');
        });
    }
