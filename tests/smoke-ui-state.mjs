import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = process.cwd();
const jsDir = path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Web', 'js');
const cssDir = path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Web', 'css');
const configHtmlPath = path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Configuration', 'configPage.html');

// 1. Verify all JS modules concatenate & parse with zero syntax errors
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
assert.ok(jsFiles.length >= 14, 'Expected all StreamFlix JS modules in Web/js');

const combinedJs = jsFiles
    .map((f) => `/* === ${f} === */\n` + fs.readFileSync(path.join(jsDir, f), 'utf8'))
    .join('\n');

new vm.Script(combinedJs, { filename: 'streamflix-bundle.js' });
console.log(`[PASS] JS bundle syntax check passed (${jsFiles.length} modules, ${Math.round(combinedJs.length / 1024)} KB)`);

// 2. Verify configPage.html inline script parses with zero syntax errors
const configHtml = fs.readFileSync(configHtmlPath, 'utf8');
const scriptMatch = configHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(scriptMatch && scriptMatch[1], 'Expected <script> block in configPage.html');
new vm.Script(scriptMatch[1], { filename: 'configPage-inline.js' });
console.log('[PASS] configPage.html inline script syntax check passed');

// 3. Verify CSS bundle balanced braces
const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort();
for (const cf of cssFiles) {
    const raw = fs.readFileSync(path.join(cssDir, cf), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const opens = (raw.match(/\{/g) || []).length;
    const closes = (raw.match(/\}/g) || []).length;
    assert.equal(opens, closes, `Unbalanced CSS braces in ${cf}: {=${opens}, }=${closes}`);
}
console.log(`[PASS] CSS brace balance check passed (${cssFiles.length} stylesheets)`);

// 4. Verify Per-Tab Profile Isolation + BroadcastChannel Sign-Out + Error Code Mapping + Bedtime Wrap Math
function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
        setItem: (k, v) => map.set(String(k), String(v)),
        removeItem: (k) => map.delete(String(k)),
        clear: () => map.clear(),
    };
}

const sharedLocalStorage = makeStorage();
const channels = new Set();

class MockBroadcastChannel {
    constructor(name) {
        this.name = name;
        this.onmessage = null;
        channels.add(this);
    }
    postMessage(data) {
        for (const ch of channels) {
            if (ch !== this && ch.name === this.name && typeof ch.onmessage === 'function') {
                ch.onmessage({ data: structuredClone(data) });
            }
        }
    }
    close() {
        channels.delete(this);
    }
}

function createDomStub() {
    const elementsById = new Map();
    const makeEl = (tag = 'div') => {
        const attrs = new Map();
        const classes = new Set();
        const el = {
            nodeType: 1,
            tagName: String(tag).toUpperCase(),
            id: '',
            className: '',
            innerHTML: '',
            textContent: '',
            value: '',
            style: {
                setProperty() {},
                removeProperty() {},
            },
            children: [],
            childNodes: [],
            parentNode: null,
            classList: {
                add: (...c) => c.forEach((x) => classes.add(x)),
                remove: (...c) => c.forEach((x) => classes.delete(x)),
                toggle: (x, force) => {
                    const next = force === undefined ? !classes.has(x) : Boolean(force);
                    if (next) classes.add(x);
                    else classes.delete(x);
                    return next;
                },
                contains: (x) => classes.has(x),
            },
            setAttribute(k, v) {
                attrs.set(k, String(v));
                if (k === 'id') {
                    this.id = String(v);
                    elementsById.set(this.id, this);
                }
            },
            getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
            removeAttribute: (k) => attrs.delete(k),
            hasAttribute: (k) => attrs.has(k),
            appendChild(child) {
                if (child) {
                    child.parentNode = this;
                    this.children.push(child);
                    if (child.id) elementsById.set(child.id, child);
                }
                return child;
            },
            removeChild(child) {
                if (child && child.id) elementsById.delete(child.id);
                if (child) child.parentNode = null;
                this.children = this.children.filter((x) => x !== child);
                return child;
            },
            insertBefore(child) {
                return this.appendChild(child);
            },
            insertAdjacentHTML() {},
            insertAdjacentElement() {},
            addEventListener() {},
            removeEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => [],
            closest: () => null,
            getBoundingClientRect: () => ({ top: 0, left: 1200, right: 1280, width: 80, height: 40 }),
            focus() {},
        };
        return el;
    };
    const body = makeEl('body');
    const head = makeEl('head');
    const docEl = makeEl('html');
    return {
        documentElement: docEl,
        head,
        body,
        readyState: 'complete',
        hidden: false,
        title: 'StreamFlix',
        createElement: (t) => makeEl(t),
        getElementById: (id) => elementsById.get(id) || null,
        querySelector: (sel) => {
            if (sel && sel.startsWith('#') && !sel.includes(' ') && !sel.includes(':')) {
                return elementsById.get(sel.slice(1)) || null;
            }
            return null;
        },
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {},
        createTreeWalker: () => ({ nextNode: () => null }),
    };
}

function bootSimulatedTab(initialSessionProfile, mockConfigResponse) {
    const tabSession = makeStorage();
    if (initialSessionProfile) {
        tabSession.setItem('streamflix_tab_profile_v1', JSON.stringify(initialSessionProfile));
    }
    const document = createDomStub();
    const timers = [];
    const windowObj = {
        location: {
            origin: 'https://media.example.com',
            pathname: '/web/index.html',
            hash: '#/home',
            search: '',
            assign() {},
            reload() {},
            replace() {},
        },
        history: { length: 1, replaceState() {}, back() {} },
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', clipboard: { writeText: async () => {} } },
        document,
        localStorage: sharedLocalStorage,
        sessionStorage: tabSession,
        BroadcastChannel: MockBroadcastChannel,
        URL,
        URLSearchParams,
        Headers,
        Response,
        AbortController,
        MutationObserver: class { observe() {} disconnect() {} },
        CustomEvent: class { constructor(type) { this.type = type; } },
        Image: class { set src(_) { if (this.onload) this.onload(); } },
        matchMedia: () => ({ matches: false, addEventListener() {} }),
        requestAnimationFrame: (fn) => { fn(); return 1; },
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        addEventListener() {},
        scrollTo() {},
        innerWidth: 1440,
        innerHeight: 900,
        fetch: async (url) => {
            const u = String(url);
            if (u.includes('/StreamFlix/PublicConfig')) {
                return new Response(JSON.stringify(mockConfigResponse), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (u.includes('/StreamFlix/Seerr/Search')) {
                return new Response(JSON.stringify({ code: 'seerr_timeout', errorCode: 'SF-SEERR-403', message: 'Seerr timed out.' }), {
                    status: 504,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ Items: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    };
    windowObj.window = windowObj;
    windowObj.self = windowObj;
    const ctx = vm.createContext(windowObj);
    vm.runInContext(combinedJs, ctx);
    return { windowObj, tabSession, document };
}

const baseMockConfig = {
    version: '0.9.8.1',
    assetVersion: '0.9.8.1',
    serverId: 'srv1',
    serverName: 'StreamFlix',
    customAccentColor: '#8B5CF6',
    enableStreamFlixUi: true,
    hasAccess: true,
    isAdmin: true,
    profiles: [
        { id: 'prof_owner', name: 'Owner', isAdmin: true, isOwner: true, jellyfinUserId: '11111111111111111111111111111111' },
        { id: 'prof_kids', name: 'Kids', isKids: true, bedtimeStart: '20:30', bedtimeEnd: '06:30', jellyfinUserId: '22222222222222222222222222222222' },
    ],
};

sharedLocalStorage.setItem('streamflix_session_v7', JSON.stringify({
    token: 'signed.household.token',
    email: 'family@example.com',
    authKind: 'google',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
}));

const tabA = bootSimulatedTab(
    { id: 'prof_owner', name: 'Owner', isAdmin: true, jellyfinUserId: '11111111111111111111111111111111', accessToken: 'tok_owner' },
    baseMockConfig
);
const tabB = bootSimulatedTab(
    { id: 'prof_kids', name: 'Kids', isKids: true, jellyfinUserId: '22222222222222222222222222222222', accessToken: 'tok_kids' },
    baseMockConfig
);

await new Promise((r) => setTimeout(r, 30));

// Verify Tab A and Tab B maintain isolated per-tab profiles in sessionStorage
assert.equal(JSON.parse(tabA.tabSession.getItem('streamflix_tab_profile_v1')).id, 'prof_owner');
assert.equal(JSON.parse(tabB.tabSession.getItem('streamflix_tab_profile_v1')).id, 'prof_kids');
console.log('[PASS] Per-tab sessionStorage profile isolation verified');

// Verify explicit Manage Profiles overlay enters PICKER_OVERLAY phase and stays open across config refresh
await tabA.windowObj.__STREAMFLIX_OPEN_PROFILE_PICKER__(true);
tabA.windowObj.__STREAMFLIX_REFRESH_CONFIG__();
await new Promise((r) => setTimeout(r, 20));
assert.ok(tabA.document.getElementById('streamflix-overlay-root'), 'Manage Profiles overlay must stay mounted across background config refresh');
console.log('[PASS] Manage Profiles overlay stability across background refreshes verified');

// Verify BroadcastChannel sign-out clears household session across both tabs
tabA.windowObj.__STREAMFLIX_SIGN_OUT_LOCAL__(true);
// Trigger real broadcast via BroadcastChannel
const testSender = new MockBroadcastChannel('streamflix_auth_bus_v1');
testSender.postMessage({ type: 'auth_signout', sender: 'external_tab' });
assert.equal(tabB.tabSession.getItem('streamflix_tab_profile_v1'), null, 'Tab B profile must clear on household BroadcastChannel sign-out');
testSender.close();
console.log('[PASS] Multi-tab BroadcastChannel sign-out sync verified');

// Verify poster card uniform height CSS invariants & hover preview image hydration
const css03 = fs.readFileSync(path.join(cssDir, '03-header-hero-and-hub-cards.css'), 'utf8');
const css05 = fs.readFileSync(path.join(cssDir, '05-phone-tv-and-player-drawers.css'), 'utf8');
assert.match(css03, /\.streamflix-poster-img[\s\S]*?position:\s*absolute;/, 'Poster images must be out-of-flow (position: absolute) so varying image ratios never alter card height');
assert.match(css03, /\.streamflix-grid\s*\{[\s\S]*?align-items:\s*start;/, 'Poster grids must enforce align-items: start');
assert.match(css03, /\.streamflix-grid\s+\.streamflix-poster-card\s*\{[\s\S]*?min-width:\s*0;/, 'Grid poster cards must enforce min-width: 0 so long titles cannot widen/lengthen columns');
assert.match(css05, /\.streamflix-carousel-track\s*>\s*\.streamflix-poster-card/, 'Phone/TV fixed card widths must be scoped to carousel tracks');
assert.match(combinedJs, /img\[data-bfx-img="pv"\]/, 'Hover preview images (data-bfx-img="pv") must be hydrated by Strict-CSP image loader');
console.log('[PASS] Uniform poster grid height & hover preview artwork invariants verified');

// Verify per-profile Guest Pass permission helper & admin Manage Media detail modal hooks
assert.match(combinedJs, /function\s+canActiveProfileManageGuestPasses\s*\(/, 'Per-profile Guest Pass permission helper must be present');
assert.match(combinedJs, /function\s+isActiveProfileAdmin\s*\(/, 'Active profile admin check must be present');
assert.match(combinedJs, /function\s+canManageMediaItems\s*\(/, 'Admin Manage Media permission check must be present');
assert.match(combinedJs, /streamflix-modal-manage-btn/, 'Admin Manage Media modal entry point must be wired');
console.log('[PASS] Per-profile Guest Pass permissions & Manage Media tools invariants verified');

// Verify v0.9.8.3 CSS scoping, clean UI teardown, JMP guard, active-profile admin gating & direct download buttons
const css01 = fs.readFileSync(path.join(cssDir, '01-base-and-native-detail.css'), 'utf8');
assert.match(css01, /body\.bfx-active\s+div#itemDetailPage:not\(\.hide\)/, '#itemDetailPage override must be scoped to body.bfx-active and :not(.hide)');
assert.match(css01, /body\.bfx-active\s+\.headerUserButton/, 'Native header button hiding must be scoped to body.bfx-active');
assert.match(combinedJs, /function\s+teardownStreamFlixUi\s*\(/, 'Clean UI teardown helper must be present');
assert.match(combinedJs, /function\s+isJellyfinMediaPlayerApp\s*\(/, 'Jellyfin Media Player mpv player preservation helper must be present');
assert.match(combinedJs, /function\s+isProfileManagementAdmin\s*\(/, 'Active-profile admin gate must be present');
assert.match(combinedJs, /function\s+supportsNativePhoneDownload\s*\(/, 'Phone-only NativeShell download gate must be present');
assert.match(combinedJs, /function\s+triggerDirectMediaDownload\s*\(/, 'NativeShell download dispatcher must be present');
assert.match(combinedJs, /\/Download\?ApiKey=/, 'Download URLs must use native ?ApiKey= query parameter');
assert.match(combinedJs, /ns\.downloadFiles\(\[payload\]\)/, 'Must invoke NativeShell.downloadFiles when supported');
assert.match(combinedJs, /ns\.downloadFile\(payload\)/, 'Must invoke NativeShell.downloadFile when supported');
assert.doesNotMatch(combinedJs, /\.download\s*=\s*['"]/, 'Must never start a raw <a download> browser file download');
assert.match(combinedJs, /streamflix-modal-download-btn/, 'Detail modal Download button must be wired');
assert.match(combinedJs, /data-ep-download-id/, 'Per-episode Download button must be wired');
console.log('[PASS] Clean UI teardown, JMP mpv support, active-admin scoping & native phone-only NativeShell downloads verified');

// Verify v0.9.8.7 QtWebEngine / Chromium 83+ CSS fallbacks & JMP system-browser SSO relay
const css02 = fs.readFileSync(path.join(cssDir, '02-modals-gate-and-profiles.css'), 'utf8');
assert.match(css02, /body\.bfx-active:not\(\.bfx-native-phone-download\)\s+#streamflix-modal-download-btn/, 'CSS must hide download buttons outside native phone apps');
assert.match(css02, /#streamflix-overlay-root\s*\{[\s\S]*?top:\s*0;[\s\S]*?left:\s*0;/, '#streamflix-overlay-root must include explicit top/right/bottom/left fallbacks for QtWebEngine');
assert.match(css02, /@supports\s+not\s*\(aspect-ratio:\s*1\s*\/\s*1\)/, 'Card aspect-ratio fallback block must be present for Chromium < 88 / QtWebEngine');
assert.match(combinedJs, /function\s+canOpenExternalSystemBrowser\s*\(/, 'JMP external system-browser SSO detection helper must be present');
assert.match(combinedJs, /\/StreamFlix\/Auth\/GoogleDesktopBegin/, 'Desktop Google OAuth relay begin endpoint must be wired');
assert.match(combinedJs, /\/StreamFlix\/Auth\/GoogleDesktopPoll/, 'Desktop Google OAuth relay poll endpoint must be wired');
assert.match(combinedJs, /function\s+completeDesktopBrowserTabClose\s*\(/, 'Auto-closing desktop SSO browser tab helper must be wired');
assert.match(combinedJs, /function\s+checkFlexGapSupport\s*\(/, 'Chromium 83 Flexbox gap runtime feature detection must be wired');
const css09 = fs.readFileSync(path.join(cssDir, '09-kids-and-watch-together.css'), 'utf8');
assert.match(css09, /html\.bfx-no-flex-gap\s+\.streamflix-hero-meta-row\s*>\s*\*\s*\+\s*\*/, 'Chromium 83 Flexbox gap fallback rules must be present');
assert.match(combinedJs, /function\s+openSearchPage\s*\(/, 'Dedicated Search Page opener must be wired');
assert.match(combinedJs, /function\s+closeSearchPage\s*\(/, 'Dedicated Search Page closer must be wired');
assert.match(combinedJs, /function\s+scoreSearchCandidate\s*\(/, 'Smart search relevance scorer must be wired');
assert.match(combinedJs, /streamflix-search-page-input/, 'Dedicated Search Page input must be wired');
assert.match(combinedJs, /is-pv-source/, 'Underlying poster card must be hidden via .is-pv-source while hover preview is expanded');
console.log('[PASS] QtWebEngine CSS fallbacks, Flexbox gap polyfill, auto-closing JMP SSO tab & unified Search UX verified');

// Verify Issue #21 fix: Local LAN / Tailscale profile sign-in prompt stays open across 2.5s lifecycle ticks & config refreshes until auth or manual cancel
{
    sharedLocalStorage.clear();
    const lanSession = makeStorage();
    const lanDoc = createDomStub();
    const lanStage = lanDoc.createElement('div');
    lanStage.setAttribute('id', 'streamflix-stage');
    const lanActions = lanDoc.createElement('div');
    lanActions.setAttribute('id', 'streamflix-gate-actions');
    let cancelBtnClickHandler = null;
    let confirmOkClickHandler = null;

    const origCreateElement = lanDoc.createElement.bind(lanDoc);
    lanDoc.createElement = (tag) => {
        const el = origCreateElement(tag);
        el.querySelector = (sel) => {
            if (sel === '#streamflix-stage') return lanStage;
            if (sel === '#streamflix-gate-actions') return lanActions;
            if (sel === '#streamflix-cancel-explicit-auth-btn' && String(lanActions.innerHTML || '').includes('streamflix-cancel-explicit-auth-btn')) {
                return {
                    addEventListener: (ev, fn) => {
                        if (ev === 'click') cancelBtnClickHandler = fn;
                    },
                };
            }
            return null;
        };
        const modalChild = origCreateElement('div');
        modalChild.querySelector = (sel) => {
            if (sel === '[data-act="ok"]') {
                return {
                    addEventListener: (ev, fn) => {
                        if (ev === 'click') confirmOkClickHandler = fn;
                    },
                    focus() {},
                };
            }
            return { addEventListener() {}, focus() {} };
        };
        el.firstChild = modalChild;
        return el;
    };

    const lanTimers = [];
    const lanIntervals = [];
    const lanMockConfig = {
        version: '0.9.8.9',
        assetVersion: '0.9.8.9',
        serverId: 'srv1',
        serverName: 'StreamFlix',
        enableStreamFlixUi: true,
        enableGoogleSignIn: false,
        googleConfigured: false,
        allowStandardJellyfinLogin: true,
        bypassLoginGateOnLan: true,
        treatTailscaleAsLocalLan: true,
        isLocalLan: true,
        hasAccess: true,
        isAdmin: false,
        profiles: [
            { id: 'prof_owner', name: 'Home', isAdmin: true, isOwner: true, canActivate: false, jellyfinUserId: '11111111111111111111111111111111' },
            { id: 'prof_member', name: 'Living Room', isAdmin: false, isOwner: false, canActivate: true, jellyfinUserId: '33333333333333333333333333333333' },
        ],
    };

    const flushLanTimers = () => {
        while (lanTimers.length > 0) {
            const fn = lanTimers.shift();
            fn();
        }
    };

    const lanWin = {
        location: {
            origin: 'http://100.101.202.42:8096',
            pathname: '/web/index.html',
            hash: '#/home',
            search: '',
            assign() {},
            reload() {},
            replace() {},
        },
        history: { length: 1, replaceState() {}, back() {} },
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', clipboard: { writeText: async () => {} } },
        document: lanDoc,
        localStorage: sharedLocalStorage,
        sessionStorage: lanSession,
        BroadcastChannel: MockBroadcastChannel,
        URL,
        URLSearchParams,
        Headers,
        Response,
        AbortController,
        MutationObserver: class { observe() {} disconnect() {} },
        CustomEvent: class { constructor(type) { this.type = type; } },
        Image: class { set src(_) { if (this.onload) this.onload(); } },
        matchMedia: () => ({ matches: false, addEventListener() {} }),
        requestAnimationFrame: (fn) => { fn(); return 1; },
        setTimeout: (fn) => { lanTimers.push(fn); return lanTimers.length; },
        clearTimeout() {},
        setInterval: (fn) => { lanIntervals.push(fn); return lanIntervals.length; },
        clearInterval() {},
        addEventListener() {},
        scrollTo() {},
        innerWidth: 1440,
        innerHeight: 900,
        fetch: async (url) => {
            if (String(url).includes('/StreamFlix/PublicConfig')) {
                return new Response(JSON.stringify(lanMockConfig), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ Items: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    };
    lanWin.window = lanWin;
    lanWin.self = lanWin;
    vm.runInContext(combinedJs, vm.createContext(lanWin));
    await new Promise((r) => setTimeout(r, 25));
    flushLanTimers();

    assert.equal(lanWin.__STREAMFLIX_GET_APP_PHASE__(), 'PICKER_REQUIRED', 'LAN bypass user with no active profile must start on Who\'s Watching');
    assert.equal(lanStage.getAttribute('data-view'), 'picker');

    // Click admin "Home" profile -> confirm "Go to Sign In"
    await lanWin.__STREAMFLIX_SWITCH_PROFILE__('prof_owner');
    assert.ok(typeof confirmOkClickHandler === 'function', 'Selecting admin profile on LAN without admin auth must prompt to sign in');
    confirmOkClickHandler();
    await new Promise((r) => setTimeout(r, 10));
    flushLanTimers();

    assert.equal(lanWin.__STREAMFLIX_GET_APP_PHASE__(), 'AUTH_REQUIRED', 'Confirming Go to Sign In must enter AUTH_REQUIRED phase');
    assert.equal(lanStage.getAttribute('data-view'), 'auth-standard', 'Sign-In form must be displayed');
    assert.equal(lanSession.getItem('streamflix_pending_profile'), 'prof_owner', 'Pending profile must be preserved while signing in');
    assert.ok(typeof cancelBtnClickHandler === 'function', 'Back to Profiles cancel button must be bound on explicit LAN sign-in');

    // Simulate multiple 2.5s lifecycle ticks + background PublicConfig refreshes ("Wait a few seconds")
    assert.ok(lanIntervals.length >= 1, 'Expected 2.5s safety lifecycle interval to be registered');
    for (let tick = 0; tick < 4; tick++) {
        lanIntervals.forEach((fn) => fn());
        flushLanTimers();
    }
    await lanWin.__STREAMFLIX_REFRESH_CONFIG__();
    lanIntervals.forEach((fn) => fn());
    flushLanTimers();

    assert.equal(lanWin.__STREAMFLIX_GET_APP_PHASE__(), 'AUTH_REQUIRED', 'Sign-In screen must NOT close on 2.5s lifecycle ticks over LAN/Tailscale (#21)');
    assert.equal(lanStage.getAttribute('data-view'), 'auth-standard', 'Sign-In view must remain mounted until auth succeeds or user cancels (#21)');

    // Manual cancel returns cleanly to Profile Picker
    cancelBtnClickHandler();
    flushLanTimers();
    assert.equal(lanWin.__STREAMFLIX_GET_APP_PHASE__(), 'PICKER_REQUIRED', 'Cancelling explicit LAN sign-in must return to Profile Picker');
    assert.equal(lanStage.getAttribute('data-view'), 'picker');
    assert.equal(lanSession.getItem('streamflix_pending_profile'), null, 'Cancelling explicit sign-in must clear pending profile');
    console.log('[PASS] Local LAN / Tailscale explicit profile sign-in stability & cancel flow verified (#21)');
}

// Verify Opt-In Live TV Compatibility (#19) — MUST default to OFF (false) and wire Hub, Search, EPG Guide & Config toggle
{
    const configHtml = fs.readFileSync(path.resolve('Jellyfin.Plugin.StreamFlix/Configuration/configPage.html'), 'utf8');
    assert.match(combinedJs, /enableLiveTv:\s*false/, 'Live TV compatibility must default to false in DEFAULT_CONFIG');
    assert.match(combinedJs, /function\s+isLiveTvEnabledForCurrentProfile\s*\(/, 'Live TV profile/config gate must be present');
    assert.match(combinedJs, /function\s+ensureLiveTvHubDataLoaded\s*\(/, 'Live TV channel/program/recording loader must be present');
    assert.match(combinedJs, /function\s+buildLiveTvHubHtml\s*\(/, 'Native StreamFlix Live TV Hub builder must be present');
    assert.match(combinedJs, /function\s+buildLiveTvCardHtml\s*\(/, '16:9 Live TV channel/program card builder must be present');
    assert.match(configHtml, /id="EnableLiveTv"[^>]*type="checkbox"/, 'Admin config page must expose #EnableLiveTv checkbox');
    assert.doesNotMatch(configHtml, /id="EnableLiveTv"[^>]*checked/, '#EnableLiveTv checkbox must be unchecked (off) by default');
    assert.match(css01, /body\.bfx-active:not\(\.bfx-livetv-route\)\s+\.skinHeader\s+\.headerTabs/, 'Native Jellyfin EPG headerTabs must remain visible on #/livetv');
    console.log('[PASS] Opt-In Live TV compatibility (#19) defaults & UI/EPG hooks verified');
}

// Verify Mobile App Search Page bar & filter pills are never hidden by phone subnav declutter CSS, and mobile Recommended Search rows open the Detail Modal cleanly
{
    const css08 = fs.readFileSync(path.join(cssDir, '08-user-settings-and-mobile-dock.css'), 'utf8');
    assert.match(css08, /\.streamflix-subnav:not\(\.bfx-sp-subnav\):not\(\.is-search-open\)\s+\.streamflix-search-box:not\(:focus-within\):not\(\.has-value\)/, 'Mobile dock subnav search hiding MUST exclude .bfx-sp-subnav');
    assert.match(css08, /\.bfx-search-page\s+\.bfx-sp-bar\s*\{[\s\S]*?display:\s*flex\s*!important;/, 'Mobile Search Page .bfx-sp-bar must enforce display: flex !important');
    assert.match(css05, /\.streamflix-subnav:not\(\.bfx-sp-subnav\):not\(\.is-search-open\)\s+\.streamflix-search-box/, '720px collapsed circle rule MUST exclude .bfx-sp-subnav');
    assert.match(combinedJs, /var\s+openMediaDetailModal\s*=\s*openHeroDetailModal\s*;/, 'openMediaDetailModal alias must be defined for mobile detail callers');
    assert.match(combinedJs, /var\s+openRecommendedDetail\s*=\s*function\s*\(\)\s*\{[\s\S]*?openHeroDetailModal\(itemObj\)[\s\S]*?openHeroDetailModalById\(rid\)/, 'Mobile Recommended Search rows ([data-sp-rec-id]) must route to openHeroDetailModal / openHeroDetailModalById');
    console.log('[PASS] Mobile App Search Page input bar, filter pills & Recommended Search detail modal wiring verified');
}

// End-to-End VM Execution Test for Issue #19: PublicConfig hydration, Hub Bootstrap Live TV row, Nav Pill, Hub Click, Hot Toggle & Kids/Policy Isolation
{
    const createLiveTvHubDom = () => {
        const elementsById = new Map();
        let doc;
        const parseButtonsFromHtml = (html, ownerDoc) => {
            const nodes = [];
            const tagRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
            let m;
            while ((m = tagRe.exec(String(html || ''))) !== null) {
                const el = ownerDoc.createElement('button');
                const attrStr = m[1] || '';
                const inner = m[2] || '';
                el.innerHTML = inner;
                el.textContent = inner.replace(/<[^>]+>/g, '').trim();
                const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
                let am;
                while ((am = attrRe.exec(attrStr)) !== null) {
                    el.setAttribute(am[1], am[2] !== undefined ? am[2] : '');
                }
                nodes.push(el);
            }
            return nodes;
        };
        const makeEl = (tag = 'div') => {
            const attrs = new Map();
            const classes = new Set();
            const listeners = new Map();
            const heroChildren = new Map();
            let rawHtml = '';
            let parsedChildren = [];
            const el = {
                nodeType: 1,
                tagName: String(tag).toUpperCase(),
                id: '',
                value: '',
                offsetHeight: 62,
                clientWidth: 1200,
                scrollTop: 0,
                parentNode: null,
                children: [],
                childNodes: [],
                style: { display: '', setProperty() {}, removeProperty() {} },
                get className() { return Array.from(classes).join(' '); },
                set className(v) {
                    classes.clear();
                    String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
                },
                get innerHTML() { return rawHtml; },
                set innerHTML(v) {
                    rawHtml = String(v || '');
                    parsedChildren = parseButtonsFromHtml(rawHtml, doc);
                    const idRe = /\bid="([^"]+)"/g;
                    let im;
                    while ((im = idRe.exec(rawHtml)) !== null) {
                        const foundId = im[1];
                        const sub = elementsById.get(foundId) || makeEl('div');
                        sub.setAttribute('id', foundId);
                        sub.parentNode = el;
                        if (!el.children.includes(sub)) el.children.push(sub);
                    }
                },
                textContent: '',
                classList: {
                    add: (...c) => c.forEach((x) => classes.add(x)),
                    remove: (...c) => c.forEach((x) => classes.delete(x)),
                    toggle: (x, force) => {
                        const next = force === undefined ? !classes.has(x) : Boolean(force);
                        if (next) classes.add(x); else classes.delete(x);
                        return next;
                    },
                    contains: (x) => classes.has(x),
                },
                setAttribute(k, v) {
                    attrs.set(k, String(v));
                    if (k === 'id') { this.id = String(v); elementsById.set(this.id, this); }
                    if (k === 'class') { this.className = v; }
                },
                getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
                removeAttribute: (k) => attrs.delete(k),
                hasAttribute: (k) => attrs.has(k),
                contains: (other) => Boolean(other && (other === el || other.parentNode === el)),
                appendChild(child) {
                    if (child) {
                        child.parentNode = this;
                        this.children.push(child);
                        if (child.id) elementsById.set(child.id, child);
                    }
                    return child;
                },
                removeChild(child) {
                    if (child && child.id) elementsById.delete(child.id);
                    if (child) child.parentNode = null;
                    this.children = this.children.filter((x) => x !== child);
                    return child;
                },
                insertBefore(child) { return this.appendChild(child); },
                insertAdjacentHTML(pos, htmlFrag) {
                    if ((pos === 'beforebegin' || pos === 'afterend') && this.parentNode) {
                        if (pos === 'beforebegin') {
                            this.parentNode.innerHTML = String(htmlFrag || '') + '<div id="' + this.id + '"></div>';
                        } else {
                            this.parentNode.innerHTML = (this.parentNode.innerHTML || '') + String(htmlFrag || '');
                        }
                        return;
                    }
                    this.innerHTML = (this.innerHTML || '') + String(htmlFrag || '');
                },
                insertAdjacentElement(_pos, child) { return this.appendChild(child); },
                addEventListener(type, fn) {
                    if (!listeners.has(type)) listeners.set(type, []);
                    listeners.get(type).push(fn);
                },
                removeEventListener() {},
                click() {
                    (listeners.get('click') || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, target: el }));
                },
                querySelector(sel) {
                    if (sel === '.streamflix-hero-bg-stack' || sel === '.streamflix-hero-content-slot' || sel === '.streamflix-hero-nav' || sel === '.streamflix-hero-dots') {
                        if (!rawHtml.includes('streamflix-hero-bg-stack')) return null;
                        if (!heroChildren.has(sel)) heroChildren.set(sel, makeEl('div'));
                        return heroChildren.get(sel);
                    }
                    const all = this.querySelectorAll(sel);
                    return all.length ? all[0] : null;
                },
                querySelectorAll(sel) {
                    if (sel === '[data-cat-id]') return parsedChildren.filter((c) => c.hasAttribute('data-cat-id'));
                    if (sel === '[data-ltv-tab]') return parsedChildren.filter((c) => c.hasAttribute('data-ltv-tab'));
                    if (sel === '[data-hot-subtab]') return parsedChildren.filter((c) => c.hasAttribute('data-hot-subtab'));
                    if (sel === '.bfx-ltv-hub' && rawHtml.includes('bfx-ltv-hub')) return [el];
                    if (sel === '.streamflix-rows' && rawHtml.includes('streamflix-rows')) return [el];
                    return [];
                },
                closest: () => null,
                getBoundingClientRect: () => ({ top: 64, left: 0, right: 1440, width: 1440, height: 600 }),
                focus() {},
                blur() {},
            };
            return el;
        };
        doc = {
            readyState: 'complete',
            hidden: false,
            title: 'StreamFlix',
            activeElement: null,
            createElement: (t) => makeEl(t),
            getElementById: (id) => elementsById.get(id) || null,
            querySelector: (sel) => {
                if (sel && sel.startsWith('#') && !sel.includes(' ') && !sel.includes(':')) return elementsById.get(sel.slice(1)) || null;
                if (sel === '#indexPage:not(.hide)' || sel === '.page.homePage:not(.hide)' || sel === '.homeView, #indexPage, .homeSectionsContainer') return elementsById.get('indexPage') || null;
                if (sel && sel.includes('.homeSectionsContainer')) return elementsById.get('homeSections') || null;
                return null;
            },
            querySelectorAll: (sel) => (sel === '#indexPage, .homeView' && elementsById.get('indexPage') ? [elementsById.get('indexPage')] : []),
            addEventListener() {},
            removeEventListener() {},
            createTreeWalker: () => ({ nextNode: () => null }),
        };
        doc.documentElement = makeEl('html');
        doc.head = makeEl('head');
        doc.body = makeEl('body');
        const indexPage = makeEl('div');
        indexPage.setAttribute('id', 'indexPage');
        indexPage.className = 'page homePage';
        doc.body.appendChild(indexPage);
        const homeSections = makeEl('div');
        homeSections.setAttribute('id', 'homeSections');
        homeSections.className = 'homeSectionsContainer sections';
        indexPage.appendChild(homeSections);
        return doc;
    };

    const runLiveTvVmScenario = async ({
        enableLiveTv,
        profile,
        staleCachedConfig = false,
        enableHeroTrailerPreview = true,
        homeRowOrder = [],
        homeHiddenRows = [],
    }) => {
        let serverEnableLiveTv = enableLiveTv;
        const localStore = makeStorage();
        const sessionStore = makeStorage();
        const fullProfile = { ...profile, accessToken: 'tok_live' };
        localStore.setItem('streamflix_session_v7', JSON.stringify({
            token: 'signed.household.token',
            email: 'owner@example.com',
            authKind: 'google',
            isAdmin: Boolean(profile.isAdmin),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }));
        localStore.setItem('jellyfin_credentials', JSON.stringify({
            Servers: [{ Id: 'srv_ltv', UserId: profile.jellyfinUserId, AccessToken: 'tok_live', ManualAddress: 'https://jellyfin.example.com' }],
        }));
        localStore.setItem('streamflix_active_profile_v64', JSON.stringify(fullProfile));
        sessionStore.setItem('streamflix_tab_profile_v1', JSON.stringify(fullProfile));
        if (staleCachedConfig) {
            localStore.setItem('streamflix_cached_config_v7', JSON.stringify({
                version: '0.9.2.16',
                serverId: 'srv_ltv',
                enableStreamFlixUi: true,
                hasAccess: true,
                showLibrariesInNav: true,
                profiles: [profile],
            }));
        }

        const doc = createLiveTvHubDom();
        const fetchedUrls = [];
        const mockViews = [
            { Id: 'lib_m', Name: 'Movies', CollectionType: 'movies' },
            { Id: 'lib_s', Name: 'Series', CollectionType: 'tvshows' },
            { Id: 'lib_a', Name: 'Anime', CollectionType: 'tvshows' },
            { Id: 'lib_r', Name: 'Recordings', CollectionType: 'mixed' },
            { Id: 'lib_ltv', Name: 'Live TV', CollectionType: 'livetv' },
        ];
        const mockMovies = [{ Id: 'mov_1', Name: 'Interstellar', Type: 'Movie', ProductionYear: 2014, CommunityRating: 8.7, ImageTags: { Primary: 'p1' }, BackdropImageTags: ['b1'] }];
        const mockSeries = [{ Id: 'ser_1', Name: 'Severance', Type: 'Series', ProductionYear: 2022, CommunityRating: 8.7, ImageTags: { Primary: 'p2' }, BackdropImageTags: ['b2'] }];
        const mockChannels = [{
            Id: 'ch_101',
            Name: 'BBC One HD',
            Number: '101',
            Type: 'TvChannel',
            ChannelType: 'TV',
            ImageTags: { Primary: 'ch1' },
            UserData: { IsFavorite: true },
            CurrentProgram: {
                Id: 'prog_1',
                Name: 'Planet Earth III',
                StartDate: new Date(Date.now() - 10 * 60000).toISOString(),
                EndDate: new Date(Date.now() + 50 * 60000).toISOString(),
            },
        }];

        const win = {
            location: { origin: 'https://jellyfin.example.com', pathname: '/web/index.html', hash: '#/home', search: '', assign() {}, reload() {}, replace() {} },
            history: { length: 1, replaceState() {}, back() {} },
            navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', clipboard: { writeText: async () => {} } },
            document: doc,
            localStorage: localStore,
            sessionStorage: sessionStore,
            BroadcastChannel: MockBroadcastChannel,
            ApiClient: {
                _serverInfo: { Id: 'srv_ltv', UserId: profile.jellyfinUserId, AccessToken: 'tok_live' },
                accessToken: () => 'tok_live',
                getCurrentUserId: () => profile.jellyfinUserId,
                serverId: () => 'srv_ltv',
            },
            URL,
            URLSearchParams,
            Headers,
            Response,
            AbortController,
            MutationObserver: class { observe() {} disconnect() {} },
            CustomEvent: class { constructor(type) { this.type = type; } },
            Image: class { set src(_) { if (this.onload) this.onload(); } },
            matchMedia: () => ({ matches: false, addEventListener() {} }),
            requestAnimationFrame: (fn) => { fn(); return 1; },
            setTimeout: (fn, ms) => (!ms || ms <= 1600 ? setTimeout(() => { try { fn(); } catch {} }, Math.min(Number(ms) || 0, 18)) : 1),
            clearTimeout() {},
            setInterval: () => 1,
            clearInterval() {},
            addEventListener() {},
            scrollTo() {},
            innerWidth: 1440,
            innerHeight: 900,
            fetch: async (url) => {
                const u = String(url);
                fetchedUrls.push(u);
                if (u.includes('/StreamFlix/PublicConfig')) {
                    return new Response(JSON.stringify({
                        version: '0.9.8.12',
                        assetVersion: '0.9.8.12',
                        serverId: 'srv_ltv',
                        serverName: 'StreamFlix',
                        enableStreamFlixUi: true,
                        hasAccess: true,
                        isAdmin: Boolean(profile.isAdmin),
                        enableLiveTv: serverEnableLiveTv,
                        enableHeroTrailerPreview,
                        homeRowOrder,
                        homeHiddenRows,
                        session: { authKind: 'google', email: 'owner@example.com', expiresAt: new Date(Date.now() + 86400000).toISOString() },
                        showLibrariesInNav: true,
                        navHiddenBuiltIns: [],
                        navLibraryIds: [],
                        profiles: [profile],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/StreamFlix/Hub/Bootstrap')) {
                    return new Response(JSON.stringify({
                        allMovies: mockMovies,
                        allSeries: mockSeries,
                        resumeItems: [],
                        nextUpItems: [],
                        favoriteItems: [],
                        collectionsItems: [],
                        filteredHeroPool: [],
                        views: mockViews,
                        popularScores: {},
                        totalMoviesCount: 1,
                        totalSeriesCount: 1,
                        totalCollectionsCount: 0,
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/Users/Me')) {
                    return new Response(JSON.stringify({ Id: profile.jellyfinUserId, Name: profile.name, Policy: { IsAdministrator: Boolean(profile.isAdmin), EnableLiveTvAccess: profile.allowLiveTv !== false } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/LiveTv/Channels')) {
                    return new Response(JSON.stringify({ Items: mockChannels, TotalRecordCount: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/LiveTv/Programs/Recommended')) {
                    return new Response(JSON.stringify({ Items: [mockChannels[0].CurrentProgram] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/LiveTv/Programs')) {
                    return new Response(JSON.stringify({
                        Items: [{
                            Id: 'prog_1',
                            ChannelId: 'ch_101',
                            Name: 'Planet Earth III',
                            EpisodeTitle: 'Coasts',
                            StartDate: new Date(Date.now() - 10 * 60000).toISOString(),
                            EndDate: new Date(Date.now() + 50 * 60000).toISOString(),
                        }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/LiveTv/Timers')) {
                    return new Response(JSON.stringify({
                        Items: [{ Id: 'tmr_1', ProgramId: 'prog_1', Status: 'New' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/Shows/Upcoming')) {
                    return new Response(JSON.stringify({
                        Items: [{
                            Id: 'ep_up_1',
                            SeriesId: 'ser_1',
                            SeriesName: 'Severance',
                            Name: 'Cold Harbor',
                            ParentIndexNumber: 2,
                            IndexNumber: 10,
                            PremiereDate: new Date(Date.now() + 3 * 86400000).toISOString(),
                            Type: 'Episode',
                        }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/StreamFlix/Trailers/Resolve')) {
                    return new Response(JSON.stringify({
                        ok: true,
                        kind: 'youtube',
                        youtubeId: 'zSWdZVtXT7E',
                        title: 'Interstellar Official Trailer',
                        source: 'jellyfin_remote_trailer',
                        embedPath: '/StreamFlix/Trailers/Embed/zSWdZVtXT7E',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/LiveTv/Recordings')) {
                    return new Response(JSON.stringify({ Items: [{ Id: 'rec_1', Name: 'Recorded Match', Type: 'Recording' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify({ Items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            },
        };
        win.window = win;
        win.self = win;
        vm.runInContext(combinedJs, vm.createContext(win));
        await new Promise((r) => setTimeout(r, 70));
        return {
            hub: doc.getElementById('streamflix-cinema-hub'),
            cachedCfg: JSON.parse(localStore.getItem('streamflix_cached_config_v7') || '{}'),
            localStore,
            fetchedUrls,
            win,
            setServerEnableLiveTv: (v) => { serverEnableLiveTv = v; },
        };
    };

    // 1. Enabled + Stale v0.9.2.16 cached config upgrade + Hub Bootstrap
    const ltvOn = await runLiveTvVmScenario({
        enableLiveTv: true,
        staleCachedConfig: true,
        profile: { id: 'streamflix_owner', name: 'Owner', isAdmin: true, isOwner: true, allowLiveTv: true, jellyfinUserId: '11111111111111111111111111111111' },
    });
    assert.equal(ltvOn.cachedCfg.enableLiveTv, true, 'applyConfigFromServerResponse MUST preserve enableLiveTv: true (#19)');
    assert.ok(ltvOn.hub, 'Cinema Hub must mount');
    assert.match(ltvOn.hub.innerHTML, /data-cat-id="livetv"[^>]*>Live TV<\/button>/, 'Live TV pill MUST render in .streamflix-FilterPills');
    assert.doesNotMatch(ltvOn.hub.innerHTML, /data-cat-id="lib:lib_ltv"/, 'Virtual livetv view must not duplicate Live TV pill');
    assert.match(ltvOn.hub.innerHTML, /data-row-id="livetv-home"/, 'Home page MUST render Live TV · On Now row after Hub Bootstrap');
    const ltvBtn = ltvOn.hub.querySelectorAll('[data-cat-id]').find((b) => b.getAttribute('data-cat-id') === 'livetv');
    assert.ok(ltvBtn, 'Live TV pill must be interactive');
    ltvBtn.click();
    assert.match(ltvOn.hub.innerHTML, /class="streamflix-row streamflix-row-grid bfx-ltv-hub"/, 'Clicking Live TV pill must render .bfx-ltv-hub');
    assert.match(ltvOn.hub.innerHTML, /Planet Earth III/, 'Live TV Hub must render airing program');

    // 2. Default OFF -> zero Live TV UI & zero /LiveTv/* requests, then hot-enable via __STREAMFLIX_REFRESH_CONFIG__
    const ltvOff = await runLiveTvVmScenario({
        enableLiveTv: false,
        profile: { id: 'streamflix_owner', name: 'Owner', isAdmin: true, isOwner: true, allowLiveTv: true, jellyfinUserId: '11111111111111111111111111111111' },
    });
    assert.equal(ltvOff.cachedCfg.enableLiveTv, false);
    assert.doesNotMatch(ltvOff.hub.innerHTML, /data-cat-id="livetv"/, 'Live TV pill must NOT render when enableLiveTv is false');
    assert.equal(ltvOff.fetchedUrls.some((u) => u.includes('/LiveTv/')), false, 'No /LiveTv/* requests when enableLiveTv is false');
    ltvOff.setServerEnableLiveTv(true);
    ltvOff.win.__STREAMFLIX_REFRESH_CONFIG__();
    await new Promise((r) => setTimeout(r, 70));
    assert.match(ltvOff.hub.innerHTML, /data-cat-id="livetv"[^>]*>Live TV<\/button>/, 'Hot config refresh must surface Live TV pill without reload');

    // 3. Kids profile & revoked user policy isolation
    const ltvKids = await runLiveTvVmScenario({
        enableLiveTv: true,
        profile: { id: 'prof_kids', name: 'Kids', isKids: true, allowLiveTv: false, jellyfinUserId: '22222222222222222222222222222222' },
    });
    assert.doesNotMatch(ltvKids.hub.innerHTML, /data-cat-id="livetv"/, 'Kids profile must never render Live TV pill');
    assert.equal(ltvKids.fetchedUrls.some((u) => u.includes('/LiveTv/')), false, 'Kids profile must never query /LiveTv/*');

    const ltvDenied = await runLiveTvVmScenario({
        enableLiveTv: true,
        profile: { id: 'prof_denied', name: 'Restricted', isKids: false, allowLiveTv: false, jellyfinUserId: '33333333333333333333333333333333' },
    });
    assert.doesNotMatch(ltvDenied.hub.innerHTML, /data-cat-id="livetv"/, 'Profile with allowLiveTv: false must not render Live TV pill');
    assert.equal(ltvDenied.fetchedUrls.some((u) => u.includes('/LiveTv/')), false, 'Profile with allowLiveTv: false must not query /LiveTv/*');

    // 4. v0.9.3.1 YouTube Hero Trailer Previews + Detail Modal YouTube Trailer + Inline EPG + Custom Home Rows + New & Popular Hub
    const v93 = await runLiveTvVmScenario({
        enableLiveTv: true,
        enableHeroTrailerPreview: true,
        staleCachedConfig: true,
        homeRowOrder: ['movies', 'top10'],
        homeHiddenRows: ['series'],
        profile: { id: 'streamflix_owner', name: 'Owner', isAdmin: true, isOwner: true, allowLiveTv: true, jellyfinUserId: '11111111111111111111111111111111' },
    });
    assert.equal(v93.cachedCfg.enableHeroTrailerPreview, true, 'enableHeroTrailerPreview must default to true');
    assert.ok(v93.fetchedUrls.some((u) => u.includes('/StreamFlix/Trailers/Resolve?itemId=')), 'Hero Billboard must resolve YouTube trailer via /StreamFlix/Trailers/Resolve');
    const heroEl = v93.hub.querySelector('#streamflix-hero-billboard') || v93.win.document.getElementById('streamflix-hero-billboard');
    const heroBgStack = heroEl && heroEl.querySelector('.streamflix-hero-bg-stack');
    assert.ok(heroBgStack && heroBgStack.children.some((w) => w.className.includes('bfx-hero-yt-wrap') && w.children.some((f) => String(f.src || '').includes('/StreamFlix/Trailers/Embed/zSWdZVtXT7E?autoplay=1&mute=1&controls=0&start=10'))), 'Hero Billboard must mount Error-153-safe YouTube relay iframe with start offset');
    assert.match(combinedJs, /HERO_PREVIEW_MAX_PLAY_MS\s*=\s*3000/, 'Hero Billboard trailer preview must cap active playback at 3 seconds (3000ms)');

    const moviesIdx = v93.hub.innerHTML.indexOf('data-row-id="movies"');
    const top10Idx = v93.hub.innerHTML.indexOf('data-row-id="top10"');
    assert.ok(moviesIdx > -1 && top10Idx > -1 && moviesIdx < top10Idx, 'Custom homeRowOrder must render New Movies before Top 10 Today');
    assert.doesNotMatch(v93.hub.innerHTML, /data-row-id="series"/, 'homeHiddenRows must hide New Shows row on Home');

    // Click Live TV -> click TV Guide sub-tab -> verify EPG timeline + REC badge
    const v93LtvPill = v93.hub.querySelectorAll('[data-cat-id]').find((b) => b.getAttribute('data-cat-id') === 'livetv');
    v93LtvPill.click();
    const guideTabBtn = v93.hub.querySelectorAll('[data-ltv-tab]').find((b) => b.getAttribute('data-ltv-tab') === 'guide');
    assert.ok(guideTabBtn, 'TV Guide sub-tab must render inside Live TV hub');
    guideTabBtn.click();
    await new Promise((r) => setTimeout(r, 45));
    assert.ok(v93.fetchedUrls.some((u) => u.includes('/LiveTv/Programs?')), 'TV Guide sub-tab must fetch /LiveTv/Programs');
    assert.ok(v93.fetchedUrls.some((u) => u.includes('/LiveTv/Timers')), 'TV Guide sub-tab must fetch /LiveTv/Timers');
    assert.match(v93.hub.innerHTML, /class="bfx-epg-wrap"/, 'TV Guide sub-tab must render .bfx-epg-wrap timeline');
    assert.match(v93.hub.innerHTML, /bfx-epg-rec-badge[^>]*>REC</, 'TV Guide sub-tab must display REC badge for scheduled timers');

    // Click New & Popular -> click Coming Soon sub-tab -> verify Upcoming TV Episodes
    const hotPill = v93.hub.querySelectorAll('[data-cat-id]').find((b) => b.getAttribute('data-cat-id') === 'hot');
    assert.ok(hotPill, 'New & Popular pill must render');
    hotPill.click();
    await new Promise((r) => setTimeout(r, 45));
    assert.match(v93.hub.innerHTML, /data-hot-subtab="comingsoon"/, 'New & Popular hub must render Coming Soon sub-tab');
    const comingSoonBtn = v93.hub.querySelectorAll('[data-hot-subtab]').find((b) => b.getAttribute('data-hot-subtab') === 'comingsoon');
    comingSoonBtn.click();
    assert.match(v93.hub.innerHTML, /data-row-id="hot-upcoming"/, 'Coming Soon sub-tab must render Upcoming TV Episodes row');
    assert.match(v93.hub.innerHTML, /Cold Harbor/, 'Coming Soon sub-tab must render upcoming episode title');

    // Verify Detail Modal YouTube Trailer button, 1-Click DVR Record & Admin Config controls
    assert.match(combinedJs, /streamflix-modal-trailer-btn/, 'Detail modal YouTube Trailer button must be wired');
    assert.match(combinedJs, /\/StreamFlix\/Trailers\/Embed\//, 'YouTube Error-153-safe embed relay endpoint must be wired');
    assert.match(combinedJs, /openHeroDetailModalById\(item\.Id\)/, 'Uncached card stubs must resolve full metadata via openHeroDetailModalById');
    assert.match(combinedJs, /admin_profile_required:\s*'SF-PROF-307'/, 'CLIENT_ERROR_CODE_MAP must include SF-PROF-307 activation error codes');
    assert.match(combinedJs, /watchparty_disabled:\s*'SF-WP-621'/, 'CLIENT_ERROR_CODE_MAP must include watchparty_disabled -> SF-WP-621');
    const trailersControllerCs = fs.readFileSync(path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Controllers', 'StreamFlixController.Trailers.cs'), 'utf8');
    assert.match(trailersControllerCs, /IsEffectiveActiveAdmin\(caller\)/, 'Trailers/Resolve must scope admin bypass to IsEffectiveActiveAdmin so Kids/restricted profiles on primary SSO devices stay isolated');
    assert.match(trailersControllerCs, /IsVisible\(caller\.JellyfinUser\)/, 'Trailers/Resolve must enforce Jellyfin user IsVisible parental/library checks');
    assert.match(trailersControllerCs, /IsItemAllowedForCallerProfileLibraries/, 'Trailers/Resolve must enforce per-profile AllowedLibraryIds');
    const watchPartyControllerCs = fs.readFileSync(path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Controllers', 'StreamFlixController.WatchParty.cs'), 'utf8');
    assert.match(watchPartyControllerCs, /TryResolveAuthorizedWatchPartyMedia/, 'WatchParty Create & set_media must enforce Jellyfin user IsVisible and per-profile AllowedLibraryIds');
    const profilesControllerCs = fs.readFileSync(path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Controllers', 'StreamFlixController.Profiles.cs'), 'utf8');
    assert.match(profilesControllerCs, /IsUnlinkedProfileCompatibleWithJellyfinLogin/, 'EnsureProfileForJellyfinUserNoLock must not hijack SSO-locked unlinked profiles');
    assert.match(combinedJs, /streamflix-modal-record-btn/, 'Detail modal 1-Click DVR Record button must be wired');
    assert.match(combinedJs, /\/LiveTv\/Timers\/Defaults\?programId=/, 'DVR recording must fetch Jellyfin /LiveTv/Timers/Defaults');
    assert.match(configHtml, /id="EnableHeroTrailerPreview"/, 'configPage.html must expose EnableHeroTrailerPreview toggle');
    assert.match(configHtml, /id="StreamFlixHomeRowsEditor"/, 'configPage.html must expose Home Page Row Order & Visibility editor');

    console.log('[PASS] End-to-End VM YouTube Hero & Modal Trailers, Live TV EPG Timeline, DVR Record, Home Row Customizer & New & Popular Hub verified');

    // 5. Issue #22: Remote non-admin Jellyfin user auto-activates single scoped profile without household-linking block
    {
        const authControllerCs = fs.readFileSync(path.join(rootDir, 'Jellyfin.Plugin.StreamFlix', 'Controllers', 'StreamFlixController.Auth.cs'), 'utf8');
        assert.doesNotMatch(authControllerCs, /not_household_member/, 'StandardLogin must never block valid Jellyfin users with not_household_member (#22)');
        assert.match(authControllerCs, /EnsureProfileForJellyfinUserAsync/, 'StandardLogin must auto-provision/link a StreamFlix profile for valid Jellyfin users (#22)');

        const localStore = makeStorage();
        const sessionStore = makeStorage();
        const remoteProfile = {
            id: 'streamflix_remote_friend',
            name: 'RemoteFriend',
            isAdmin: false,
            isOwner: false,
            canActivate: true,
            hasPin: false,
            googleLocked: true,
            accountLockKind: 'jellyfin',
            googleLockSatisfied: true,
            jellyfinUserId: '44444444444444444444444444444444',
            jellyfinUsername: 'RemoteFriend',
        };
        localStore.setItem('streamflix_session_v7', JSON.stringify({
            token: 'signed.remote.jf.token',
            authKind: 'jellyfin',
            username: 'RemoteFriend',
            userId: remoteProfile.jellyfinUserId,
            name: 'RemoteFriend',
            isAdmin: false,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }));
        const doc = createLiveTvHubDom();
        const remoteFetches = [];
        const win = {
            location: { origin: 'https://jellyfin.example.com', pathname: '/web/index.html', hash: '#/home', search: '', assign() {}, reload() {}, replace() {} },
            history: { length: 1, replaceState() {}, back() {} },
            navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', clipboard: { writeText: async () => {} } },
            document: doc,
            localStorage: localStore,
            sessionStorage: sessionStore,
            BroadcastChannel: MockBroadcastChannel,
            ApiClient: {
                _serverInfo: { Id: 'srv_rem', UserId: '', AccessToken: '' },
                accessToken: () => '',
                getCurrentUserId: () => '',
                serverId: () => 'srv_rem',
            },
            URL,
            URLSearchParams,
            Headers,
            Response,
            AbortController,
            MutationObserver: class { observe() {} disconnect() {} },
            CustomEvent: class { constructor(type) { this.type = type; } },
            Image: class { set src(_) { if (this.onload) this.onload(); } },
            matchMedia: () => ({ matches: false, addEventListener() {} }),
            requestAnimationFrame: (fn) => { fn(); return 1; },
            setTimeout: (fn, ms) => (!ms || ms <= 400 ? setTimeout(() => { try { fn(); } catch {} }, Math.min(Number(ms) || 0, 15)) : 1),
            clearTimeout() {},
            setInterval: () => 1,
            clearInterval() {},
            addEventListener() {},
            scrollTo() {},
            innerWidth: 430,
            innerHeight: 932,
            fetch: async (url) => {
                const u = String(url);
                remoteFetches.push(u);
                if (u.includes('/StreamFlix/PublicConfig')) {
                    return new Response(JSON.stringify({
                        version: '0.9.3.2',
                        assetVersion: '0.9.3.2',
                        serverId: 'srv_rem',
                        serverName: 'StreamFlix',
                        enableStreamFlixUi: true,
                        allowStandardJellyfinLogin: true,
                        isLocalLan: false,
                        hasAccess: true,
                        isAdmin: false,
                        session: { authKind: 'jellyfin', username: 'RemoteFriend', userId: remoteProfile.jellyfinUserId, expiresAt: new Date(Date.now() + 86400000).toISOString() },
                        profiles: [remoteProfile],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/StreamFlix/Profiles/Activate')) {
                    return new Response(JSON.stringify({
                        userId: remoteProfile.jellyfinUserId,
                        userName: 'RemoteFriend',
                        jellyfinUsername: 'RemoteFriend',
                        accessToken: 'tok_remote_friend',
                        serverId: 'srv_rem',
                        serverName: 'StreamFlix',
                        profile: remoteProfile,
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/StreamFlix/Hub/Bootstrap')) {
                    return new Response(JSON.stringify({
                        allMovies: [],
                        allSeries: [],
                        resumeItems: [],
                        nextUpItems: [],
                        favoriteItems: [],
                        collectionsItems: [],
                        filteredHeroPool: [],
                        views: [],
                        popularScores: {},
                        totalMoviesCount: 0,
                        totalSeriesCount: 0,
                        totalCollectionsCount: 0,
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify({ Items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            },
        };
        win.window = win;
        win.self = win;
        vm.runInContext(combinedJs, vm.createContext(win));
        await new Promise((r) => setTimeout(r, 80));
        assert.ok(remoteFetches.some((u) => u.includes('/StreamFlix/Profiles/Activate')), 'Remote Jellyfin user with 1 scoped profile must auto-activate seamlessly (#22)');
        const activatedTabProf = JSON.parse(sessionStore.getItem('streamflix_tab_profile_v1') || '{}');
        assert.equal(activatedTabProf.id, 'streamflix_remote_friend', 'Remote Jellyfin user profile must become active in sessionStorage (#22)');
        console.log('[PASS] Issue #22 remote Jellyfin account auto-provisioning & single-profile auto-activation verified');
    }

    // 6. Issue #23: Home Screen Sections (homesection0..9), Configured Library Order (OrderedViews), HidePlayedInLatest & Live Sync on Save
    {
        const localStore = makeStorage();
        const sessionStore = makeStorage();
        const prof23 = {
            id: 'streamflix_owner',
            name: 'Owner',
            isAdmin: true,
            isOwner: true,
            allowLiveTv: true,
            jellyfinUserId: '55555555555555555555555555555555',
            accessToken: 'tok_23',
        };
        localStore.setItem('streamflix_session_v7', JSON.stringify({
            token: 'signed.23.token',
            email: 'owner@example.com',
            authKind: 'google',
            isAdmin: true,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }));
        localStore.setItem('jellyfin_credentials', JSON.stringify({
            Servers: [{ Id: 'srv_23', UserId: prof23.jellyfinUserId, AccessToken: 'tok_23', ManualAddress: 'https://jellyfin.example.com' }],
        }));
        localStore.setItem('streamflix_active_profile_v64', JSON.stringify(prof23));
        sessionStore.setItem('streamflix_tab_profile_v1', JSON.stringify(prof23));

        const idAnimeShows = '40000000000000000000000000000004';
        const idMovies = '10000000000000000000000000000001';
        const idAnimeMovies = '30000000000000000000000000000003';
        const idShows = '20000000000000000000000000000002';
        const idLiveTv = '90000000000000000000000000000009';

        let currentHomeSections = [
            'smalllibrarytiles',
            'resume',
            'nextup',
            'latestmedia',
            'resumebook',
            'livetv',
            'resumeaudio',
            'none',
            'none',
            'none',
        ];

        const doc23 = createLiveTvHubDom();
        const win23 = {
            location: { origin: 'https://jellyfin.example.com', pathname: '/web/index.html', hash: '#/home', search: '', assign() {}, reload() {}, replace() {} },
            history: { length: 1, replaceState() {}, back() {} },
            navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', clipboard: { writeText: async () => {} } },
            document: doc23,
            localStorage: localStore,
            sessionStorage: sessionStore,
            BroadcastChannel: MockBroadcastChannel,
            ApiClient: {
                _serverInfo: { Id: 'srv_23', UserId: prof23.jellyfinUserId, AccessToken: 'tok_23' },
                accessToken: () => 'tok_23',
                getCurrentUserId: () => prof23.jellyfinUserId,
                serverId: () => 'srv_23',
            },
            URL,
            URLSearchParams,
            Headers,
            Response,
            AbortController,
            MutationObserver: class { observe() {} disconnect() {} },
            CustomEvent: class { constructor(type) { this.type = type; } },
            Image: class { set src(_) { if (this.onload) this.onload(); } },
            matchMedia: () => ({ matches: false, addEventListener() {} }),
            requestAnimationFrame: (fn) => { fn(); return 1; },
            setTimeout: (fn, ms) => (!ms || ms <= 500 ? setTimeout(() => { try { fn(); } catch {} }, Math.min(Number(ms) || 0, 15)) : 1),
            clearTimeout() {},
            setInterval: () => 1,
            clearInterval() {},
            addEventListener() {},
            scrollTo() {},
            innerWidth: 1440,
            innerHeight: 900,
            fetch: async (url, init) => {
                const u = String(url);
                const method = String((init && init.method) || 'GET').toUpperCase();
                if (method === 'POST' && u.toLowerCase().includes('/displaypreferences/usersettings')) {
                    return new Response(null, { status: 204 });
                }
                if (u.includes('/StreamFlix/PublicConfig')) {
                    return new Response(JSON.stringify({
                        version: '0.9.8.16',
                        assetVersion: '0.9.8.16',
                        serverId: 'srv_23',
                        serverName: 'StreamFlix',
                        enableStreamFlixUi: true,
                        hasAccess: true,
                        isAdmin: true,
                        enableLiveTv: true,
                        enableHeroTrailerPreview: false,
                        showLibrariesInNav: true,
                        navHiddenBuiltIns: [],
                        navLibraryIds: [],
                        session: { authKind: 'google', email: 'owner@example.com', expiresAt: new Date(Date.now() + 86400000).toISOString() },
                        profiles: [prof23],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/StreamFlix/Hub/Bootstrap')) {
                    return new Response(JSON.stringify({
                        userId: prof23.jellyfinUserId,
                        serverId: 'srv_23',
                        // Intentionally pass unsorted views to verify client + server OrderedViews sorting
                        views: [
                            { Id: idAnimeMovies, Name: 'Anime Movies', CollectionType: 'movies', ImageTags: { Primary: 'am1' } },
                            { Id: idAnimeShows, Name: 'Anime Shows', CollectionType: 'tvshows', ImageTags: { Primary: 'as1' } },
                            { Id: idLiveTv, Name: 'Live TV', CollectionType: 'livetv' },
                            { Id: idMovies, Name: 'Movies', CollectionType: 'movies', ImageTags: { Primary: 'm1' } },
                            { Id: idShows, Name: 'TV Shows', CollectionType: 'tvshows', ImageTags: { Primary: 's1' } },
                        ],
                        userHomePreferences: {
                            hasCustomHomeSections: true,
                            homeSections: currentHomeSections,
                            orderedViews: [idAnimeShows, idMovies, idAnimeMovies, idShows],
                            latestItemsExcludes: [],
                            myMediaExcludes: [idLiveTv],
                            hidePlayedInLatest: true,
                        },
                        libraryLatest: [
                            {
                                id: idAnimeShows,
                                name: 'Anime Shows',
                                collectionType: 'tvshows',
                                items: [{ Id: 'as_1', Name: 'Frieren', Type: 'Series', ImageTags: { Primary: 'p_as1' }, UserData: { Played: false } }],
                            },
                            {
                                id: idMovies,
                                name: 'Movies',
                                collectionType: 'movies',
                                items: [
                                    { Id: 'm_played', Name: 'Already Watched Film', Type: 'Movie', ImageTags: { Primary: 'p_mp' }, UserData: { Played: true } },
                                    { Id: 'm_fresh', Name: 'Dune: Part Two', Type: 'Movie', ImageTags: { Primary: 'p_mf' }, UserData: { Played: false } },
                                ],
                            },
                            {
                                id: idAnimeMovies,
                                name: 'Anime Movies',
                                collectionType: 'movies',
                                items: [{ Id: 'am_1', Name: 'Suzume', Type: 'Movie', ImageTags: { Primary: 'p_am1' }, UserData: { Played: false } }],
                            },
                            {
                                id: idShows,
                                name: 'TV Shows',
                                collectionType: 'tvshows',
                                items: [{ Id: 's_1', Name: 'Severance', Type: 'Series', ImageTags: { Primary: 'p_s1' }, UserData: { Played: false } }],
                            },
                        ],
                        resumeItems: [{ Id: 'res_1', Name: 'Interstellar', Type: 'Movie', RunTimeTicks: 100000000, ImageTags: { Primary: 'pr1' }, BackdropImageTags: ['br1'], UserData: { PlaybackPositionTicks: 35000000, PlayedPercentage: 35 } }],
                        resumeBookItems: [{ Id: 'bk_1', Name: 'Project Hail Mary', Type: 'Book', ImageTags: { Primary: 'pbk1' }, UserData: { PlaybackPositionTicks: 100 } }],
                        resumeAudioItems: [],
                        nextUpItems: [{ Id: 'nx_1', Name: 'Hello, Ms. Cobel', SeriesId: 's_1', SeriesName: 'Severance', ParentIndexNumber: 2, IndexNumber: 1, Type: 'Episode', ImageTags: { Primary: 'pnx1' } }],
                        favoriteItems: [],
                        allMovies: [{ Id: 'm_fresh', Name: 'Dune: Part Two', Type: 'Movie', CommunityRating: 8.6, ImageTags: { Primary: 'p_mf' }, BackdropImageTags: ['bmf'] }],
                        allSeries: [{ Id: 's_1', Name: 'Severance', Type: 'Series', CommunityRating: 8.8, ImageTags: { Primary: 'p_s1' }, BackdropImageTags: ['bs1'] }],
                        collectionsItems: [],
                        filteredHeroPool: [],
                        popularScores: {},
                        totalMoviesCount: 2,
                        totalSeriesCount: 2,
                        totalCollectionsCount: 0,
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/LiveTv/Channels')) {
                    return new Response(JSON.stringify({
                        Items: [{
                            Id: 'ch_23',
                            Name: 'HBO HD',
                            Number: '201',
                            Type: 'TvChannel',
                            ChannelType: 'TV',
                            ImageTags: { Primary: 'ch23' },
                            UserData: { IsFavorite: true },
                        }],
                        TotalRecordCount: 1,
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/Users/Me')) {
                    return new Response(JSON.stringify({ Id: prof23.jellyfinUserId, Name: 'Owner', Policy: { IsAdministrator: true, EnableLiveTvAccess: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify({ Items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            },
        };
        win23.window = win23;
        win23.self = win23;
        vm.runInContext(combinedJs, vm.createContext(win23));
        await new Promise((r) => setTimeout(r, 90));

        const hub23 = doc23.getElementById('streamflix-cinema-hub');
        const html23 = hub23.innerHTML;
        const rowIds23 = Array.from(html23.matchAll(/data-row-id="([^"]+)"/g), (m) => m[1]);
        const expectedPrefix = [
            'mymedia',
            'resume',
            'nextup',
            `latest-${idAnimeShows}`,
            `latest-${idMovies}`,
            `latest-${idAnimeMovies}`,
            `latest-${idShows}`,
            'resumebook',
            'livetv-home',
        ];
        assert.deepEqual(
            rowIds23.slice(0, expectedPrefix.length),
            expectedPrefix,
            'Home Screen rows must follow exact Jellyfin Home Sections 1–9 AND Configured Library Order (OrderedViews) (#23)'
        );

        // Verify My Media tiles respect OrderedViews and exclude MyMediaExcludes
        const myMediaIds = Array.from(html23.matchAll(/data-mymedia-id="([^"]+)"/g), (m) => m[1]);
        assert.deepEqual(
            myMediaIds,
            [idAnimeShows, idMovies, idAnimeMovies, idShows],
            'My Media library tiles must follow Configured Library Order and omit MyMediaExcludes (#23)'
        );

        // Verify Top Navigation Bar pills respect OrderedViews (Movies before Shows, Anime Shows before Anime Movies)
        const navPillIds = Array.from(html23.matchAll(/data-cat-id="([^"]+)"/g), (m) => m[1]);
        assert.ok(
            navPillIds.indexOf('movies') < navPillIds.indexOf('series'),
            'Top Nav Bar must place Movies before Shows when Movies precedes TV Shows in OrderedViews (#23)'
        );
        assert.ok(
            navPillIds.indexOf(`lib:${idAnimeShows}`) < navPillIds.indexOf(`lib:${idAnimeMovies}`),
            'Top Nav Bar library pills must follow Configured Library Order instead of alphabetical order (#23)'
        );

        // Verify HidePlayedInLatest filters out watched items from Recently Added rows
        assert.doesNotMatch(html23, /Already Watched Film/, 'HidePlayedInLatest must hide watched items from Recently Added rows (#23)');
        assert.match(html23, /Dune: Part Two/, 'Unwatched items must render in Recently Added rows (#23)');

        // Verify saving #/mypreferenceshome.html (POST /DisplayPreferences/usersettings) immediately invalidates cache & reorders Home
        currentHomeSections = ['livetv', 'smalllibrarytiles', 'resume', 'none', 'none', 'none', 'none', 'none', 'none', 'none'];
        await win23.fetch(`https://jellyfin.example.com/DisplayPreferences/usersettings?userId=${prof23.jellyfinUserId}&client=emby`, {
            method: 'POST',
            body: JSON.stringify({ CustomPrefs: { homesection0: 'livetv', homesection1: 'smalllibrarytiles', homesection2: 'resume' } }),
        });
        await new Promise((r) => setTimeout(r, 75));
        const updatedRowIds = Array.from(hub23.innerHTML.matchAll(/data-row-id="([^"]+)"/g), (m) => m[1]);
        assert.deepEqual(
            updatedRowIds.slice(0, 3),
            ['livetv-home', 'mymedia', 'resume'],
            'Saving Jellyfin Home Preferences must immediately invalidate SWR cache and update Home row order (#23)'
        );
        assert.equal(updatedRowIds.includes('nextup'), false, 'Setting Next Up to None in Jellyfin Home Preferences must hide Next Up on Home (#23)');
        assert.match(combinedJs, /streamflix-kids-bedtime-opt'\s*\+\s*\(draft\.isKids\s*\?\s*''\s*:\s*' is-hidden'\)/, 'Bedtime Window customization must only appear for Kids profiles');
        assert.match(combinedJs, /!p\.isKids\s*\|\|\s*p\.isAdmin\s*\|\|\s*!p\.bedtimeStart/, 'Bedtime lock enforcement must only apply to Kids profiles');
        assert.equal(doc23.getElementById('streamflix-header-bell-btn'), null, 'Header notification bell icon must not be rendered');
        console.log('[PASS] Issue #23 Jellyfin Home Sections 1–9, Configured Library Order (OrderedViews), HidePlayedInLatest & Live Sync verified');
    }

    // -------------------------------------------------------------------------
    // v0.9.9 Feature & Declutter Suite: Rich Detail Badges toggle, Series Shuffle,
    // Skip Intro Pill, Visual Presets & Card Density, Audio Mini-Player & Watch Activity
    // -------------------------------------------------------------------------
    {
        const ls99 = makeStorage();
        const ss99 = makeStorage();
        const doc99 = createLiveTvHubDom();
        const body99 = doc99.body;

        const prof99 = {
            id: 'prof_99',
            name: 'Alex',
            icon: '🎬',
            color: '#E50914',
            isAdmin: true,
            isOwner: true,
            isKids: false,
            allowLiveTv: false,
            canActivate: true,
            jellyfinUserId: '99999999999999999999999999999999',
            jellyfinUsername: 'Alex',
            accessToken: 'tok_99',
        };
        ls99.setItem('streamflix_session_v7', JSON.stringify({
            token: 'signed.99.token',
            email: 'alex@example.com',
            authKind: 'google',
            isAdmin: true,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }));
        ls99.setItem('jellyfin_credentials', JSON.stringify({
            Servers: [{ Id: 'srv_99', UserId: prof99.jellyfinUserId, AccessToken: 'tok_99', ManualAddress: 'https://jellyfin.example.com' }],
        }));
        ls99.setItem('streamflix_active_profile_v64', JSON.stringify(prof99));
        ss99.setItem('streamflix_tab_profile_v1', JSON.stringify(prof99));

        const idSeries99 = 'b9999999999999999999999999999991';
        const idAudio99  = 'a9999999999999999999999999999992';
        const idEp1_99   = 'e9999999999999999999999999999993';
        const idEp2_99   = 'e9999999999999999999999999999994';

        const seriesItem99 = {
            Id: idSeries99,
            Name: 'Cosmos Laundromat',
            Type: 'Series',
            ProductionYear: 2015,
            OfficialRating: 'PG',
            CommunityRating: 7.8,
            CriticRating: 94,
            RunTimeTicks: 7200000000,
            Genres: ['Animation', 'Sci-Fi'],
            Studios: [{ Name: 'Blender Studio' }],
            Overview: 'A sheep steps through a portal into infinite worlds.',
            ImageTags: { Primary: 'p_cos' },
            BackdropImageTags: ['b_cos'],
            ExternalUrls: [{ Name: 'IMDb', Url: 'https://www.imdb.com/title/tt4938464' }],
            MediaStreams: [
                { Type: 'Video', Index: 0, Codec: 'hevc', Width: 3840, Height: 2160, VideoRange: 'HDR', VideoRangeType: 'DOVIWithHDR10', DisplayTitle: '4K Dolby Vision' },
                { Type: 'Audio', Index: 1, Codec: 'eac3', Profile: 'Dolby Atmos', Channels: 6, Language: 'eng', IsDefault: true, DisplayTitle: 'English Atmos 5.1' },
                { Type: 'Subtitle', Index: 2, Codec: 'subrip', Language: 'eng', IsDefault: true, DisplayTitle: 'English SDH' },
            ],
        };
        const audioItem99 = {
            Id: idAudio99,
            Name: 'Snow Fight',
            Album: 'Sintel OST',
            Artists: ['Jan Morgenstern'],
            Type: 'Audio',
            RunTimeTicks: 1800000000,
            ImageTags: { Primary: 'p_aud' },
            UserData: { PlaybackPositionTicks: 300000000 },
        };

        let richBadgesCfg = true;
        const loc99 = {
            href: 'https://jellyfin.example.com/web/index.html#/home',
            origin: 'https://jellyfin.example.com',
            pathname: '/web/index.html',
            search: '',
            hash: '#/home',
        };
        const makePubCfg99 = () => ({
            version: '0.9.9.0',
            serverId: 'srv_99',
            enableStreamFlixUi: true,
            requireGoogleAuth: true,
            enableGoogleSignIn: true,
            googleConfigured: true,
            hasAccess: true,
            isAdmin: true,
            enableWatchTogether: true,
            enableRichDetailBadges: richBadgesCfg,
            enableSkipIntro: true,
            visualPreset: 'oled',
            cardDensity: 'large',
            profiles: [prof99],
        });

        const win99 = {
            location: loc99,
            history: { length: 1, replaceState() {}, pushState() {}, back() {} },
            document: doc99,
            localStorage: ls99,
            sessionStorage: ss99,
            navigator: { userAgent: 'Mozilla/5.0 Chrome/128.0', maxTouchPoints: 0 },
            innerWidth: 1440,
            innerHeight: 900,
            screen: { width: 1920, height: 1080 },
            matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
            getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', getPropertyValue: () => '' }),
            requestAnimationFrame: (fn) => setTimeout(fn, 0),
            cancelAnimationFrame: clearTimeout,
            setTimeout,
            clearTimeout,
            setInterval: () => 1,
            clearInterval() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {},
            scrollTo() {},
            CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
            Event: class { constructor(t) { this.type = t; } },
            MutationObserver: class { observe() {} disconnect() {} },
            IntersectionObserver: class { observe() {} disconnect() {} },
            AbortController,
            URL,
            URLSearchParams,
            Headers,
            Response,
            ApiClient: {
                _serverInfo: { Id: 'srv_99', UserId: prof99.jellyfinUserId, AccessToken: 'tok_99' },
                accessToken: () => 'tok_99',
                getCurrentUserId: () => prof99.jellyfinUserId,
                serverId: () => 'srv_99',
                deviceId: () => 'dev_99',
            },
            fetch: async (input, init) => {
                const u = typeof input === 'string' ? input : input.url;
                if (u.includes('/StreamFlix/PublicConfig')) {
                    return new Response(JSON.stringify(makePubCfg99()), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/StreamFlix/Hub/Bootstrap')) {
                    return new Response(JSON.stringify({
                        userId: prof99.jellyfinUserId,
                        serverId: 'srv_99',
                        views: [{ Id: 'c9999999999999999999999999999999', Name: 'Shows', CollectionType: 'tvshows' }],
                        userHomePreferences: { hasCustomHomeSections: false, homeSections: [], orderedViews: [], latestItemsExcludes: [], myMediaExcludes: [], hidePlayedInLatest: false },
                        libraryLatest: [],
                        resumeItems: [seriesItem99],
                        resumeAudioItems: [audioItem99],
                        resumeBookItems: [],
                        nextUpItems: [],
                        favoriteItems: [],
                        allMovies: [],
                        allSeries: [seriesItem99],
                        collectionsItems: [],
                        filteredHeroPool: [seriesItem99],
                        popularScores: {},
                        totalMoviesCount: 0,
                        totalSeriesCount: 1,
                        totalCollectionsCount: 0,
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/Shows/') && u.includes('/Episodes')) {
                    return new Response(JSON.stringify({
                        Items: [
                            { Id: idEp1_99, Name: 'First Cycle', SeriesId: idSeries99, SeriesName: 'Cosmos Laundromat', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 7200000000 },
                            { Id: idEp2_99, Name: 'Second Cycle', SeriesId: idSeries99, SeriesName: 'Cosmos Laundromat', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 7000000000 },
                        ],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/IntroSkipperSegments')) {
                    return new Response(JSON.stringify({ Introduction: { Start: 10, End: 76 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/MediaSegments/')) {
                    return new Response(JSON.stringify({ Items: [{ Type: 'Intro', StartTicks: 100000000, EndTicks: 760000000 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes('/Sessions')) {
                    if (init && init.method === 'POST') {
                        return new Response(null, { status: 204 });
                    }
                    return new Response(JSON.stringify([{
                        Id: 'sess_99',
                        PlayState: { AudioStreamIndex: 1, SubtitleStreamIndex: 2 },
                        NowPlayingItem: { ...seriesItem99, Id: idEp1_99, Type: 'Episode', SeriesId: idSeries99, SeriesName: 'Cosmos Laundromat', ParentIndexNumber: 1, IndexNumber: 1, Name: 'First Cycle' },
                    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes(idSeries99) || u.includes(idEp1_99)) {
                    return new Response(JSON.stringify(seriesItem99), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (u.includes(idAudio99)) {
                    return new Response(JSON.stringify(audioItem99), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify({ Items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            },
        };
        win99.window = win99;
        win99.self = win99;
        vm.runInContext(combinedJs, vm.createContext(win99));
        await new Promise((r) => setTimeout(r, 90));

        // 1. Visual Preset & Card Density applied from PublicConfig
        assert.equal(body99.getAttribute('data-bfx-preset'), 'oled', 'VisualPreset must apply data-bfx-preset="oled" on body');
        assert.equal(body99.getAttribute('data-bfx-density'), 'large', 'CardDensity must apply data-bfx-density="large" on body');

        // 2. Detail Modal with EnableRichDetailBadges=true + 2-column credits + More menu + Series Shuffle
        assert.match(combinedJs, /id="streamflix-modal-quality-badges"/, 'Detail modal must include quality badges slot');
        assert.match(combinedJs, /id="streamflix-modal-more-btn"/, 'Detail modal must include decluttered More Options button');
        assert.match(combinedJs, /id="streamflix-modal-shuffle-ep-btn"/, 'Series detail modal must include episode Shuffle button');

        const hub99 = doc99.getElementById('streamflix-cinema-hub');
        assert.ok(hub99, 'Cinema hub must mount for v0.9.9 suite');

        // 3. Compact Account Dropdown (no Watch Activity or Appearance & Layout in menu; Settings + side-by-side Admin/Dashboard)
        const profBtn99 = doc99.getElementById('streamflix-header-profile-btn');
        assert.ok(profBtn99, 'Header profile button must mount');
        profBtn99.click();
        assert.equal(doc99.getElementById('streamflix-dd-watch-activity'), null, 'Watch Activity must be removed from Account Dropdown');
        assert.equal(doc99.getElementById('streamflix-dd-appearance'), null, 'Appearance & Layout must be moved out of Account Dropdown into Settings');
        const settingsBtn99 = doc99.getElementById('streamflix-dd-user-prefs');
        assert.ok(settingsBtn99 && />Settings</.test(settingsBtn99.innerHTML), 'Account dropdown must expose concise Settings item');
        assert.ok(doc99.getElementById('streamflix-dd-plugin-settings') && doc99.getElementById('streamflix-dd-dashboard'), 'Admin account dropdown must expose side-by-side StreamFlix & Dashboard buttons');
        assert.doesNotMatch(combinedJs, /Profiles\/Activity|openWatchActivityModal/, 'Watch Activity client/API hooks must be completely removed');
        assert.match(combinedJs, /data-bfx-customize-nav="1"[\s\S]*?Appearance, Navigation &amp; Home Layout/, 'User Settings must expose Appearance, Navigation & Home Layout card');

        // 4. Persistent Music & Audiobook Glass Mini-Player + Skip Intro Pill regex & OSD checks
        assert.match(combinedJs, /id\s*=\s*'bfx-audio-miniplayer'|bfx-audio-miniplayer/, 'Persistent glass audio mini-player must be wired');
        assert.match(combinedJs, /IntroSkipperSegments/, 'Intro Skipper v2 endpoint must be supported in Skip Intro engine');
        assert.match(combinedJs, /IntroTimestamps/, 'Intro Skipper v1 endpoint must be supported in Skip Intro engine');
        assert.match(combinedJs, /\/MediaSegments\//, 'Jellyfin 10.10+/12 MediaSegments endpoint must be supported in Skip Intro engine');
        assert.match(combinedJs, /streamflix-osd-skip-pill/, 'Upgraded frosted-glass OSD Skip Intro pill must be wired');
        console.log('[PASS] v0.9.9 Visual Presets, Rich Detail Badges, Decluttered Editorial Modal, Compact Account Menu, Settings Appearance Card, Skip Intro Pill & Audio Mini-Player verified');
    }
}

console.log('ALL STREAMFLIX SMOKE CHECKS PASSED!');
