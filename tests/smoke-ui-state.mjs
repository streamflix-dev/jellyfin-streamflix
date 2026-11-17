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
assert.match(combinedJs, /function\s+triggerDirectMediaDownload\s*\(/, 'Synchronous direct media download helper must be present');
assert.match(combinedJs, /\/Download\?Apikey=/, 'Download URLs must use native ?Apikey= query parameter');
assert.match(combinedJs, /streamflix-modal-download-btn/, 'Detail modal Download button must be wired');
assert.match(combinedJs, /data-ep-download-id/, 'Per-episode Download button must be wired');
console.log('[PASS] Clean UI teardown, JMP mpv support, active-admin scoping & native ?Apikey= downloads verified');

console.log('ALL STREAMFLIX v0.9.8.4 SMOKE CHECKS PASSED!');
