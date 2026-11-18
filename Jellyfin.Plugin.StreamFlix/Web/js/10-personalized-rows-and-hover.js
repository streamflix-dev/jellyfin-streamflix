/* StreamFlix Client (10/14) — Per-Profile Rows, Hover Preview Cards & Accent Theme */
    /* ----------------------------------------------------------------------
       v7.2 — Rows picked for the active profile
       ---------------------------------------------------------------------- */
    var PERSONAL_ROWS_TTL_MS = 10 * 60 * 1000;

    function getPersonalRows() {
        var auth = getJellyfinAuthContext();
        var entry = auth.userId ? state.personalRowsByUser[auth.userId] : null;
        return (entry && entry.data) || null;
    }

    function personalRowItems() {
        var pr = getPersonalRows();
        if (!pr) {
            return [];
        }
        var out = [].concat(pr.topPicks || [], pr.watchAgain || []);
        (pr.because || []).forEach(function (b) { out = out.concat(b.items || []); });
        return out;
    }

    function loadPersonalRows(force) {
        var auth = getJellyfinAuthContext();
        if (!auth.userId || !auth.token) {
            return;
        }
        var key = auth.userId;
        var existing = state.personalRowsByUser[key];
        if (existing && (existing.loading || (!force && Date.now() - existing.fetchedAt < PERSONAL_ROWS_TTL_MS))) {
            return;
        }
        var entry = { loading: true, fetchedAt: Date.now(), data: existing ? existing.data : null };
        state.personalRowsByUser[key] = entry;

        var uid = encodeURIComponent(key);
        var fields = 'Overview,Genres,PrimaryImageAspectRatio,DateCreated';
        var pPlayed = fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=30&Fields=' + fields);
        var pAgain = fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=18&Fields=' + fields);

        Promise.all([pPlayed, pAgain]).then(function (res) {
            var played = (res[0] && res[0].Items) || [];
            var again = (res[1] && res[1].Items) || [];
            var seen = {};
            var seeds = [];
            played.forEach(function (it) {
                var id = it.Type === 'Episode' ? it.SeriesId : it.Id;
                var name = it.Type === 'Episode' ? it.SeriesName : it.Name;
                if (id && name && !seen[id]) {
                    seen[id] = true;
                    seeds.push({ id: id, name: name });
                }
            });
            again.forEach(function (it) { seen[it.Id] = true; });
            seeds = seeds.slice(0, 2);

            var tally = {};
            var add = function (list, weight) {
                (list || []).forEach(function (it) {
                    (it.Genres || []).forEach(function (g) {
                        tally[g] = (tally[g] || 0) + weight;
                    });
                });
            };
            add(played, 1);
            add(again, 2);
            add(state.hubData.favoriteItems, 2);
            var topGenre = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0] || '';

            var pBecause = seeds.map(function (seed) {
                return apiFetch('/Items/' + encodeURIComponent(seed.id) + '/Similar?userId=' + uid + '&Limit=20&Fields=' + fields)
                    .then(function (r) {
                        var items = ((r && r.Items) || []).filter(function (x) {
                            return x && x.Id && !seen[x.Id] && !(x.UserData && x.UserData.Played);
                        });
                        return { seed: seed, items: items };
                    })
                    .catch(function () { return { seed: seed, items: [] }; });
            });
            var pTop = topGenre
                ? fetchUserItems(uid, 'Recursive=true&IncludeItemTypes=Movie,Series&Genres=' + encodeURIComponent(topGenre) + '&Filters=IsUnplayed&SortBy=CommunityRating&SortOrder=Descending&Limit=24&Fields=' + fields)
                : Promise.resolve({ Items: [] });

            return Promise.all([Promise.all(pBecause), pTop]).then(function (r2) {
                var used = {};
                var because = r2[0].map(function (b) {
                    var items = b.items.filter(function (x) { return !used[x.Id]; }).slice(0, 18);
                    items.forEach(function (x) { used[x.Id] = true; });
                    return { seed: b.seed, items: items };
                }).filter(function (b) { return b.items.length >= 4; });
                var top = ((r2[1] && r2[1].Items) || []).filter(function (x) { return x && x.Id; });
                entry.data = {
                    topGenre: topGenre,
                    topPicks: top.length >= 4 ? top.slice(0, 18) : [],
                    because: because,
                    watchAgain: again.length >= 3 ? again : []
                };
            });
        }).catch(function () {}).then(function () {
            entry.loading = false;
            entry.fetchedAt = Date.now();
            if (normalizeGuid(getJellyfinAuthContext().userId) !== normalizeGuid(key)) {
                return;
            }
            var pr = entry.data;
            var hasAny = pr && (pr.topPicks.length || pr.because.length || pr.watchAgain.length);
            if (hasAny && state.activeCategory === 'all' && !state.searchQuery && document.getElementById('streamflix-cinema-hub')) {
                renderCinemaHubContents();
            }
        });
    }

    /* ----------------------------------------------------------------------
       v7.2 — Hover previews (desktop pointers only)
       ---------------------------------------------------------------------- */
    var hoverPreview = { el: null, card: null, item: null, pending: null, showTimer: null, hideTimer: null, mx: -1, my: -1, lastClosedAt: 0, dismissedCard: null };
    var PREVIEW_CARD_SEL = '.streamflix-poster-card, .streamflix-top10-card, .streamflix-wide-card';

    // Closes only the currently open preview popup without cancelling a pending showTimer for the next movie card
    function clearPreviewSourceCardClass() {
        if (hoverPreview.card && hoverPreview.card.classList) {
            hoverPreview.card.classList.remove('is-pv-source');
        }
        try {
            Array.prototype.forEach.call(document.querySelectorAll('.is-pv-source'), function (node) {
                node.classList.remove('is-pv-source');
            });
        } catch (e) {}
    }

    function closeOpenPreviewVisuals() {
        clearTimeout(hoverPreview.hideTimer);
        hoverPreview.hideTimer = null;
        var el = hoverPreview.el;
        var wasOpen = Boolean(el && el.classList.contains('is-open'));
        clearPreviewSourceCardClass();
        hoverPreview.card = null;
        hoverPreview.item = null;
        if (wasOpen) {
            hoverPreview.lastClosedAt = Date.now();
            el.classList.remove('is-open');
            el.setAttribute('aria-hidden', 'true');
        }
    }

    function hidePreviewNow() {
        clearTimeout(hoverPreview.showTimer);
        hoverPreview.showTimer = null;
        hoverPreview.pending = null;
        closeOpenPreviewVisuals();
    }

    function scheduleHidePreview() {
        clearTimeout(hoverPreview.showTimer);
        hoverPreview.showTimer = null;
        hoverPreview.pending = null;
        clearTimeout(hoverPreview.hideTimer);
        hoverPreview.hideTimer = setTimeout(closeOpenPreviewVisuals, 120);
    }

    function isPointerOverCardAt(card, x, y) {
        if (!card || !card.isConnected) {
            return false;
        }
        if (document.elementsFromPoint) {
            var stack = document.elementsFromPoint(x, y);
            for (var i = 0; i < stack.length; i++) {
                if (card === stack[i] || card.contains(stack[i])) {
                    return true;
                }
            }
            return false;
        }
        var r = card.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function findUnderlyingOtherCard(x, y) {
        if (!document.elementsFromPoint || x < 0 || y < 0) {
            return null;
        }
        var curCard = hoverPreview.card;
        if (curCard && curCard.isConnected) {
            var cr = curCard.getBoundingClientRect();
            if (x >= cr.left - 4 && x <= cr.right + 4 && y >= cr.top - 4 && y <= cr.bottom + 4) {
                return null;
            }
        }
        var stack = document.elementsFromPoint(x, y);
        for (var i = 0; i < stack.length; i++) {
            var node = stack[i];
            if (hoverPreview.el && (node === hoverPreview.el || hoverPreview.el.contains(node))) {
                continue;
            }
            var cand = node && node.closest ? node.closest(PREVIEW_CARD_SEL) : null;
            if (cand && cand !== curCard && (!hoverPreview.item || cand.getAttribute('data-item-id') !== hoverPreview.item.Id)) {
                return cand;
            }
        }
        return null;
    }

    // Rows can re-render while the mouse rests on a card; find the fresh copy of the card under the pointer
    function findLiveHoverCard(card, item) {
        if (hoverPreview.mx < 0 || !document.elementFromPoint) {
            return card && card.isConnected ? card : null;
        }
        if (card && card.isConnected) {
            // The page may have scrolled since the countdown began - only open if the pointer is still over it
            return isPointerOverCardAt(card, hoverPreview.mx, hoverPreview.my) ? card : null;
        }
        if (document.elementsFromPoint) {
            var stack = document.elementsFromPoint(hoverPreview.mx, hoverPreview.my);
            for (var i = 0; i < stack.length; i++) {
                var c = stack[i] && stack[i].closest ? stack[i].closest(PREVIEW_CARD_SEL) : null;
                if (c && item && c.getAttribute('data-item-id') === item.Id) {
                    return c;
                }
            }
        }
        var under = document.elementFromPoint(hoverPreview.mx, hoverPreview.my);
        var live = under && under.closest ? under.closest(PREVIEW_CARD_SEL) : null;
        return live && item && live.getAttribute('data-item-id') === item.Id ? live : null;
    }

    function preloadPreviewImage(item) {
        try {
            var img = new Image();
            img.decoding = 'async';
            img.src = getItemBackdropUrl(item, 780);
        } catch (e) {}
    }

    function buildPreviewHtml(item, placeholder) {
        var title = item.SeriesName || item.Name || '';
        var logo = getItemLogoUrl(item, 420);
        var rating = item.CommunityRating ? Number(item.CommunityRating).toFixed(1) : '';
        var year = item.ProductionYear ? String(item.ProductionYear) : '';
        var runtime = item.Type === 'Series' ? 'Series' : (item.Type === 'BoxSet' ? 'Collection' : formatRuntimeTicks(item.RunTimeTicks).trim());
        var isFav = item.UserData && item.UserData.IsFavorite;
        var isPlayed = item.UserData && item.UserData.Played;
        var pct = item.UserData && item.UserData.PlayedPercentage ? Math.min(100, Math.max(2, Math.round(item.UserData.PlayedPercentage))) : 0;
        var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3) : [];
        var sub = item.Type === 'Episode' ? ('S' + (item.ParentIndexNumber || 1) + ':E' + (item.IndexNumber || 1) + ' · ' + item.Name) : '';
        var left = pct ? formatTimeLeft(item) : '';
        var safePlaceholder = placeholder ? safeCssUrl(placeholder) : '';
        return ''
            + '<div class="bfx-pv-media" data-pv="info">'
            + (safePlaceholder ? '<div class="bfx-pv-ph" style="background-image:url(&quot;' + escapeHtml(safePlaceholder) + '&quot;)"></div>' : '')
            + '  <img class="bfx-pv-img" src="' + escapeHtml(getItemBackdropUrl(item, 780)) + '" alt="" data-bfx-img="pv" />'
            + '  <div class="bfx-pv-scrim"></div>'
            + (logo
                ? '<img class="bfx-pv-logo" src="' + escapeHtml(logo) + '" alt="' + escapeHtml(title) + '" data-bfx-logo-fallback="pv" />'
                : '<div class="bfx-pv-title">' + escapeHtml(title) + '</div>')
            + (pct ? '<div class="bfx-pv-bar"><span style="width:' + pct + '%;"></span></div>' : '')
            + '</div>'
            + '<div class="bfx-pv-body" data-pv="info">'
            + '  <div class="bfx-pv-actions">'
            + '    <button type="button" class="bfx-pv-play" data-pv="play" aria-label="' + (pct ? 'Resume' : 'Play') + '">' + icon('play') + '<span>' + (pct ? 'Resume' : 'Play') + '</span></button>'
            + '    <button type="button" class="bfx-pv-btn' + (isFav ? ' active' : '') + '" data-pv="fav" title="' + (isFav ? 'Remove from My List' : 'Add to My List') + '" aria-label="My List">' + icon(isFav ? 'check' : 'plus') + '</button>'
            + (item.Type !== 'BoxSet' ? '    <button type="button" class="bfx-pv-btn' + (isPlayed ? ' active' : '') + '" data-pv="played" title="' + (isPlayed ? 'Mark unwatched' : 'Mark watched') + '" aria-label="Watched">' + icon('eye') + '</button>' : '')
            + (pct > 0 ? '    <button type="button" class="bfx-pv-btn bfx-pv-remove" data-pv="remove-resume" title="Remove from Continue Watching" aria-label="Remove from Continue Watching">' + icon('close') + '</button>' : '')
            + '    <button type="button" class="bfx-pv-btn bfx-pv-more" data-pv="info" title="More info" aria-label="More info">' + icon('chevronDown') + '</button>'
            + '  </div>'
            + '  <div class="bfx-pv-meta">'
            + (rating ? '<span class="bfx-pv-rating">' + icon('star') + escapeHtml(rating) + '</span>' : '')
            + (year ? '<span>' + escapeHtml(year) + '</span>' : '')
            + (item.OfficialRating ? '<span class="streamflix-maturity-pill">' + escapeHtml(item.OfficialRating) + '</span>' : '')
            + (left ? '<span class="bfx-pv-left">' + escapeHtml(left) + '</span>' : (runtime ? '<span>' + escapeHtml(runtime) + '</span>' : ''))
            + '  </div>'
            + (sub ? '<div class="bfx-pv-sub">' + escapeHtml(sub) + '</div>' : '')
            + (genres.length ? '<div class="bfx-pv-genres">' + genres.map(escapeHtml).join('<i></i>') + '</div>' : '')
            + '</div>';
    }

    function ensurePreviewEl() {
        if (hoverPreview.el && hoverPreview.el.parentNode) {
            return hoverPreview.el;
        }
        var el = document.createElement('div');
        el.id = 'bfx-hover-preview';
        el.setAttribute('aria-hidden', 'true');
        el.addEventListener('mouseenter', function () {
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
        });
        el.addEventListener('mouseleave', function (ev) {
            var to = ev && ev.relatedTarget;
            var nextCard = to && to.closest ? to.closest(PREVIEW_CARD_SEL) : null;
            if (nextCard) {
                if (nextCard === hoverPreview.card
                    || (hoverPreview.item && nextCard.getAttribute('data-item-id') === hoverPreview.item.Id)) {
                    clearTimeout(hoverPreview.hideTimer);
                    hoverPreview.hideTimer = null;
                    return;
                }
                // Sliding directly off the open hover menu onto another movie card:
                // close the current popup immediately so it gets out of the way and queue the new card.
                closeOpenPreviewVisuals();
                queuePreviewForCard(nextCard);
                return;
            }
            scheduleHidePreview();
        });
        el.addEventListener('click', function (ev) {
            var target = ev.target && ev.target.closest ? ev.target.closest('[data-pv]') : null;
            var item = hoverPreview.item;
            if (!target || !item) {
                return;
            }
            var act = target.getAttribute('data-pv');
            if (act === 'play') {
                hidePreviewNow();
                navigateOrPlayItem(item);
            } else if (act === 'fav') {
                toggleFavoriteItem(item, target);
            } else if (act === 'played') {
                togglePlayedItem(item, target);
            } else if (act === 'remove-resume') {
                removeFromContinueWatching(item);
            } else {
                hidePreviewNow();
                openHeroDetailModal(item);
            }
        });
        document.body.appendChild(el);
        hoverPreview.el = el;
        return el;
    }

    function showPreviewFor(card, item) {
        if (!card || !item || !card.isConnected || state.accountDropdownOpen || isGateOpen() || isVideoPlayerActive()
            || document.querySelector('.streamflix-modal-backdrop')) {
            return;
        }
        var artEl = card.querySelector('.streamflix-poster-img-wrap, .streamflix-wide-img-wrap, .streamflix-top10-poster') || card;
        var rect = artEl.getBoundingClientRect();
        if (rect.width < 40 || rect.bottom < 0 || rect.top > window.innerHeight) {
            return;
        }
        var el = ensurePreviewEl();
        var isWide = card.classList.contains('streamflix-wide-card');
        var cardImg = card.querySelector('img');
        var placeholder = cardImg && cardImg.classList.contains('is-loaded') ? (cardImg.currentSrc || cardImg.src || '') : '';
        var W = Math.round(Math.min(isWide ? 420 : 356, Math.max(isWide ? 332 : 280, rect.width * (isWide ? 1.28 : 1.46))));
        W = Math.min(W, window.innerWidth - 24);
        clearTimeout(hoverPreview.hideTimer);
        hoverPreview.hideTimer = null;
        clearPreviewSourceCardClass();
        hoverPreview.card = card;
        hoverPreview.item = item;
        hoverPreview.dismissedCard = null;
        hoverPreview.anchorTop = rect.top;
        hoverPreview.anchorLeft = rect.left;
        el.style.transition = 'none';
        el.classList.remove('is-open');
        el.style.width = W + 'px';
        el.innerHTML = buildPreviewHtml(item, placeholder);
        hydrateCompleteImages(el);
        var H = el.offsetHeight || Math.round(W * 0.9);
        var cx = rect.left + rect.width / 2;
        var left = Math.max(12, Math.min(window.innerWidth - W - 12, cx - W / 2));
        var top = rect.top + rect.height / 2 - H * 0.48;
        var hdr = document.querySelector('.skinHeader:not(.osdHeader)');
        var minTop = Math.max(12, hdr ? Math.min(96, Math.round(hdr.getBoundingClientRect().bottom) + 8) : 72);
        top = Math.max(minTop, Math.min(window.innerHeight - H - 12, top));
        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
        var originX = Math.max(0, Math.min(W, cx - left));
        var originY = Math.max(0, Math.min(H, rect.top + rect.height / 2 - top));
        el.style.transformOrigin = Math.round(originX) + 'px ' + Math.round(originY) + 'px';
        el.style.setProperty('--bfx-pv-from', (rect.width / W).toFixed(3));
        void el.offsetWidth;
        el.style.transition = '';
        card.classList.add('is-pv-source');
        el.classList.add('is-open');
        el.setAttribute('aria-hidden', 'false');
    }

    function queuePreviewForCard(card) {
        if (!card || !card.isConnected) {
            return;
        }
        var open = Boolean(hoverPreview.el && hoverPreview.el.classList.contains('is-open'));
        if (card === hoverPreview.card
            || (open && hoverPreview.item && card.getAttribute('data-item-id') === hoverPreview.item.Id)) {
            // Same title (or the same card re-rendered underneath) - keep the preview, don't re-open it
            hoverPreview.card = card;
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
            return;
        }
        if (card === hoverPreview.pending) {
            // Moving between the card's own children shouldn't restart the countdown
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
            return;
        }
        var item = card.__bfxItem || findCachedItemById(card.getAttribute('data-item-id'));
        if (!item || !item.Id) {
            return;
        }
        var warmHandoff = open || (Date.now() - (hoverPreview.lastClosedAt || 0) < 450);
        if (open) {
            // Close the previous card's popup immediately so it never blocks adjacent cards
            closeOpenPreviewVisuals();
        } else {
            clearTimeout(hoverPreview.hideTimer);
            hoverPreview.hideTimer = null;
        }
        clearTimeout(hoverPreview.showTimer);
        hoverPreview.pending = card;
        preloadPreviewImage(item);
        hoverPreview.showTimer = setTimeout(function () {
            hoverPreview.showTimer = null;
            hoverPreview.pending = null;
            var live = findLiveHoverCard(card, item);
            if (live) {
                showPreviewFor(live, item);
            }
        }, warmHandoff ? 140 : 460);
    }

    function installHoverPreview() {
        if (hoverPreview.installed) {
            return;
        }
        hoverPreview.installed = true;
        var mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
        if (!mq || !mq.matches) {
            return;
        }
        document.body.classList.add('bfx-hover-previews');
        document.addEventListener('mouseover', function (ev) {
            var card = ev.target && ev.target.closest ? ev.target.closest(PREVIEW_CARD_SEL) : null;
            if (!card) {
                return;
            }
            if (card === hoverPreview.dismissedCard) {
                return;
            }
            queuePreviewForCard(card);
        }, true);
        document.addEventListener('mousemove', function (ev) {
            var moved = hoverPreview.mx >= 0 && (Math.abs(ev.clientX - hoverPreview.mx) + Math.abs(ev.clientY - hoverPreview.my) >= 2);
            hoverPreview.mx = ev.clientX;
            hoverPreview.my = ev.clientY;
            var isOpen = Boolean(hoverPreview.el && hoverPreview.el.classList.contains('is-open'));
            if (isOpen && hoverPreview.el && ev.target && ev.target.nodeType && hoverPreview.el.contains(ev.target)) {
                // Inside the action/body area of the open preview, keep the current preview rock-solid so every button is easy to click
                if (ev.target.closest && ev.target.closest('.bfx-pv-body')) {
                    if (hoverPreview.showTimer) {
                        clearTimeout(hoverPreview.showTimer);
                        hoverPreview.showTimer = null;
                        hoverPreview.pending = null;
                    }
                    return;
                }
                // In the overhanging top artwork edge, peek through to see if the user moved onto an adjacent movie card underneath
                var peekCard = findUnderlyingOtherCard(ev.clientX, ev.clientY);
                if (peekCard && peekCard !== hoverPreview.dismissedCard) {
                    if (hoverPreview.pending !== peekCard) {
                        var peekItem = peekCard.__bfxItem || findCachedItemById(peekCard.getAttribute('data-item-id'));
                        if (peekItem && peekItem.Id) {
                            clearTimeout(hoverPreview.showTimer);
                            hoverPreview.pending = peekCard;
                            preloadPreviewImage(peekItem);
                            hoverPreview.showTimer = setTimeout(function () {
                                hoverPreview.showTimer = null;
                                hoverPreview.pending = null;
                                var stillUnder = findUnderlyingOtherCard(hoverPreview.mx, hoverPreview.my);
                                if (stillUnder === peekCard) {
                                    showPreviewFor(peekCard, peekItem);
                                }
                            }, 160);
                        }
                    }
                } else if (hoverPreview.showTimer) {
                    clearTimeout(hoverPreview.showTimer);
                    hoverPreview.showTimer = null;
                    hoverPreview.pending = null;
                }
                return;
            }
            if (moved && !hoverPreview.showTimer && !isOpen) {
                var underCard = ev.target && ev.target.closest ? ev.target.closest(PREVIEW_CARD_SEL) : null;
                if (underCard && underCard !== hoverPreview.dismissedCard) {
                    queuePreviewForCard(underCard);
                }
            }
        }, { passive: true, capture: true });
        document.documentElement.addEventListener('mouseleave', scheduleHidePreview);
        window.addEventListener('blur', function () {
            hidePreviewNow();
        });
        document.addEventListener('mouseout', function (ev) {
            var card = ev.target && ev.target.closest ? ev.target.closest(PREVIEW_CARD_SEL) : null;
            if (!card) {
                return;
            }
            var to = ev.relatedTarget;
            if (to && card.contains(to)) {
                return;
            }
            if (card === hoverPreview.dismissedCard) {
                hoverPreview.dismissedCard = null;
            }
            if (to && hoverPreview.el && hoverPreview.el.contains(to)) {
                return;
            }
            if (to && to.closest && to.closest(PREVIEW_CARD_SEL)) {
                // Straight onto the next card: its own mouseover / queuePreviewForCard handles the handoff
                return;
            }
            scheduleHidePreview();
        }, true);
        var hideIfOpen = function (ev) {
            if (ev && ev.target && ev.target.nodeType && hoverPreview.el && hoverPreview.el.contains && hoverPreview.el.contains(ev.target)) {
                return;
            }
            if (hoverPreview.showTimer || (hoverPreview.el && hoverPreview.el.classList.contains('is-open'))) {
                hidePreviewNow();
            }
        };
        window.addEventListener('scroll', function (ev) {
            // Close only when the hovered card really moved. Image loads and scroll anchoring fire scroll events
            // without moving anything under the pointer; a pending open re-checks the pointer when it fires.
            var c = hoverPreview.card;
            if (!c || !hoverPreview.el || !hoverPreview.el.classList.contains('is-open')) {
                return;
            }
            var t = ev && ev.target;
            if (t && t.nodeType === 1 && !t.contains(c)) {
                return;
            }
            var r = c.getBoundingClientRect();
            if (Math.abs(r.top - hoverPreview.anchorTop) < 6 && Math.abs(r.left - hoverPreview.anchorLeft) < 6) {
                return;
            }
            hideIfOpen(ev);
        }, true);
        window.addEventListener('resize', hideIfOpen);
        window.addEventListener('hashchange', hideIfOpen);
        document.addEventListener('mousedown', function (ev) {
            if (ev && ev.target && ev.target.nodeType && hoverPreview.el && hoverPreview.el.contains && hoverPreview.el.contains(ev.target)) {
                clearTimeout(hoverPreview.showTimer);
                hoverPreview.showTimer = null;
                hoverPreview.pending = null;
                return;
            }
            if (hoverPreview.card || hoverPreview.pending) {
                hoverPreview.dismissedCard = hoverPreview.card || hoverPreview.pending;
            }
            hideIfOpen(ev);
        }, true);
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                if (hoverPreview.card || hoverPreview.pending) {
                    hoverPreview.dismissedCard = hoverPreview.card || hoverPreview.pending;
                }
                hideIfOpen();
            }
        });
    }

    /* ----------------------------------------------------------------------
       v7.2 — Per-profile accent colour
       ---------------------------------------------------------------------- */
    function hexToRgb(hex) {
        var m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!m) {
            return null;
        }
        var h = m[1];
        if (h.length === 3) {
            h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        }
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function relativeLuminance(rgb) {
        var a = rgb.map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    function applyBrandAccentTheme() {
        var accentHex = sanitizeHexColor((state.config && state.config.customAccentColor) || '#E50914', '#E50914');
        if (state.brandAccentSig === accentHex) {
            return;
        }
        state.brandAccentSig = accentHex;
        var root = document.documentElement;
        var rgb = hexToRgb(accentHex) || [229, 9, 20];
        var brighten = rgb.map(function (v) { return Math.min(255, Math.round(v + (255 - v) * 0.12)); });
        var hoverHex = '#' + brighten.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
        var softRgba = 'rgba(' + rgb.join(', ') + ', 0.22)';
        root.style.setProperty('--streamflix-red', accentHex);
        root.style.setProperty('--streamflix-red-hover', hoverHex);
        root.style.setProperty('--streamflix-red-soft', softRgba);
        root.style.setProperty('--accent', accentHex);
        root.style.setProperty('--deftraback', softRgba);
        root.style.setProperty('--theme-primary-color', accentHex);
        root.style.setProperty('--theme-accent-text-color', accentHex);
    }

    function applyProfileAccent(profile) {
        applyBrandAccentTheme();
        var color = (profile && profile.color) || '';
        if (state.accentSig === color) {
            return;
        }
        state.accentSig = color;
        var root = document.documentElement;
        var rgb = hexToRgb(color);
        if (!rgb) {
            root.style.removeProperty('--bfx-accent');
            root.style.removeProperty('--bfx-accent-rgb');
            root.style.removeProperty('--bfx-accent-ink');
            return;
        }
        var lum = relativeLuminance(rgb);
        var lift = lum < 0.06 ? 0.45 : (lum < 0.12 ? 0.25 : 0);
        rgb = rgb.map(function (v) { return Math.round(v + (255 - v) * lift); });
        root.style.setProperty('--bfx-accent', 'rgb(' + rgb.join(', ') + ')');
        root.style.setProperty('--bfx-accent-rgb', rgb.join(', '));
        root.style.setProperty('--bfx-accent-ink', relativeLuminance(rgb) > 0.45 ? '#0a0a0a' : '#ffffff');
    }

    function buildHubSkeletonHtml() {
        var row = function (count, wide) {
            var cards = '';
            for (var i = 0; i < count; i++) {
                cards += '<div class="streamflix-skel streamflix-skel-card' + (wide ? ' wide' : '') + '"></div>';
            }
            return '<div class="streamflix-skel-row"><div class="streamflix-skel streamflix-skel-title"></div><div class="streamflix-skel-cards">' + cards + '</div></div>';
        };
        return ''
            + '<div class="streamflix-hub-skeleton" aria-busy="true" aria-label="Loading">'
            + '  <div class="streamflix-skel streamflix-skel-hero">'
            + '    <div class="streamflix-skel-hero-lines"><div class="streamflix-skel-line w60"></div><div class="streamflix-skel-line w40"></div><div class="streamflix-skel-line w80"></div></div>'
            + '  </div>'
            + row(6, true) + row(8, false) + row(8, false)
            + '</div>';
    }
