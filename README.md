<div align="center">

# StreamFlix for Jellyfin

**A Netflix-style web UI, multi-auth household sign-in gate (Google OAuth, Custom OIDC, Jellyfin & QR Guest Passes), Dedicated Kids Mode, real-time synced Watch Together, Skip Intro & Credits support, liquid-glass mobile dock, native Seerr requests, and household profiles backed by real Jellyfin users.**

[![Release](https://img.shields.io/github/v/release/streamflix-dev/jellyfin-streamflix?style=flat-square&label=version&color=E50914)](https://github.com/streamflix-dev/jellyfin-streamflix/releases)
[![Downloads](https://img.shields.io/github/downloads/streamflix-dev/jellyfin-streamflix/total?style=flat-square&label=downloads&color=46d369)](https://github.com/streamflix-dev/jellyfin-streamflix/releases)
[![Jellyfin](https://img.shields.io/badge/Jellyfin-10.9%20%E2%80%93%2012.x-00A4DC?style=flat-square)](manifest.json)
[![.NET](https://img.shields.io/badge/.NET-8.0%20%7C%209.0%20%7C%2010.0-512BD4?style=flat-square)](Jellyfin.Plugin.StreamFlix/Jellyfin.Plugin.StreamFlix.csproj)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)

Runs entirely inside your existing Jellyfin server — no reverse-proxy sidecar, external database, or manual HTML edits required.

</div>

---

## Preview

<table>
  <tr>
    <td colspan="2" align="center">
      <img src="docs/screenshots/home-hero.jpg" alt="StreamFlix Home and Hero Billboard" />
      <br />
      <sub><b>1. StreamFlix Home &amp; Hero Billboard</b> — Full-bleed featured billboard, frosted category bar, instant search, Surprise Me &amp; Continue Watching</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="docs/screenshots/v09-oidc-login.gif" alt="StreamFlix OIDC Sign-In to Profile Picker to Home Flow" />
      <br />
      <sub><b>2. End-to-End OIDC Sign-In Flow</b> — Household Sign-In Gate &rarr; OpenID Connect provider &rarr; &ldquo;Who's watching?&rdquo; picker &rarr; StreamFlix Home</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/sign-in.jpg" alt="StreamFlix Household Sign-In Gate" />
      <br />
      <sub><b>3. Household Sign-In Gate</b> — Pre-login multi-auth gate (Google, Custom OIDC, Jellyfin &amp; Guest Passes) with zero library exposure</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-profile-picker.jpg" alt="StreamFlix Who's Watching Profile Picker" />
      <br />
      <sub><b>4. Who's Watching?</b> — Animated library mosaic with real Jellyfin user profiles, Kids badges &amp; SSO/PIN locks</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-watch-together.jpg" alt="StreamFlix Watch Together Live Room" />
      <br />
      <sub><b>5. Watch Together Live Room</b> — Server-synced play, pause, seek &amp; episode transitions plus 1-click 6-hour Guest Party links</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-guest-passes-qr.jpg" alt="StreamFlix Temporary QR Guest Passes" />
      <br />
      <sub><b>6. Temporary QR Guest Passes</b> — Expiring SVG QR invite links locked to a single non-admin profile with instant revocation</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-kids-mode.jpg" alt="StreamFlix Dedicated Kids Profile Mode" />
      <br />
      <sub><b>7. Dedicated Kids Profile Mode</b> — Child-safe theme, Kids World filter bubbles, strict maturity enforcement &amp; Exit Kids lock</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-mobile-showcase.jpg" alt="StreamFlix Mobile Liquid-Glass Dock and Account Sheet" />
      <br />
      <sub><b>8. Mobile Dock &amp; Phone Account Sheet</b> — Liquid-glass bottom dock, edge-to-edge account sheet, enlarged touch rows, Quick Connect &amp; Client Settings</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-account-menu.jpg" alt="StreamFlix Account Pill Menu and Profile Switcher" />
      <br />
      <sub><b>9. Streamlined Account Menu</b> — Fast profile switching, Cast, Quick Connect, Watch Together, Media Requests, Settings &amp; side-by-side Admin shortcuts</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/title-details.jpg" alt="StreamFlix 2-Column Editorial Title Details Modal" />
      <br />
      <sub><b>10. Editorial Title Details (&ldquo;More Info&rdquo;)</b> — 2-column layout, configurable 4K/DV/Atmos badges, YouTube Trailer, Series Shuffle &amp; clickable cast/genre links</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v099-user-settings.jpg" alt="StreamFlix Grouped User Settings Hub" />
      <br />
      <sub><b>11. Grouped User Settings Hub</b> — Organized sections for Appearance &amp; Home, Playback &amp; Subtitles, Display &amp; Libraries, Administration &amp; Account</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v099-visual-presets.jpg" alt="StreamFlix Visual Presets, Card Density and Layout Customizer" />
      <br />
      <sub><b>12. Visual Presets &amp; Card Density</b> — 1-click themes (<i>Netflix Classic</i>, <i>OLED Pure Black</i>, <i>Cinema Glass</i>, <i>Prime Midnight</i>), card sizes &amp; row order</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="docs/screenshots/top-10-row.jpg" alt="StreamFlix Top 10 Row" />
      <br />
      <sub><b>13. Top 10 in StreamFlix Today</b> — Configurable server rankings with bold <code>#1</code>&ndash;<code>#10</code> badges &amp; rank numerals</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/player-controls.jpg" alt="StreamFlix Video Player Controls and Skip Intro Pill" />
      <br />
      <sub><b>14. Netflix-Style Video Player &amp; Skip Intro Pill</b> — Frosted-glass Skip Intro / Credits pill (Intro Skipper &amp; MediaSegments), Episodes drawer &amp; track popover</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/player-paused.jpg" alt="StreamFlix Video Player Pause Overlay" />
      <br />
      <sub><b>15. &ldquo;You're Watching&rdquo; Pause Screen</b> — ClearLogo artwork, runtime &amp; synopsis overlay while paused</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/edit-profile.jpg" alt="StreamFlix Edit Profile Modal" />
      <br />
      <sub><b>16. Profile Customization &amp; Kids Bedtime</b> — 64 avatars, 14 accent colors, maturity ratings, Kids-only Bedtime Window, SSO lock &amp; PIN</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/v09-admin-console.jpg" alt="StreamFlix Organized 6-Tab Admin Dashboard Console" />
      <br />
      <sub><b>17. 6-Tab Plugin Administration</b> — Focused console for Profiles, Appearance &amp; Home, Sign-In &amp; SSO, Features &amp; Requests, Active Devices &amp; System Backup</sub>
    </td>
  </tr>
</table>

<p align="center">
  <sub>Demo library media courtesy of <a href="https://studio.blender.org/films/">Blender Studio Open Movies</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY</a>) — featuring <i>Charge</i>, <i>Sintel</i>, <i>Cosmos Laundromat</i>, <i>Tears of Steel</i>, and <i>Sprite Fright</i> (&copy; Blender Foundation).</sub>
</p>

---

## Highlights

### Flexible Multi-Auth Sign-In, Custom OIDC, Guest Passes & Security
- **Google OAuth, Custom OpenID Connect, Jellyfin Login, Household Password, or Hybrid Mode.** Household sign-in is enforced before *"Who's watching?"* so zero library artwork or metadata is exposed pre-login. Enable any combination of progressive-disclosure **Sign-In Methods**: server-verified **Google Sign-In** (with one-click **Test OAuth Config**), self-hosted or cloud **Custom OpenID Connect (OIDC)** (`Authentik`, `Authelia`, `Pocket ID`, `Keycloak`, `Kanidm`, `Zitadel`, `Okta`, etc. via Authorization Code + PKCE `S256`, RSA/ECDSA JWKS verification, RFC 6749 `client_secret_basic` / `client_secret_post` fallback, and one-click **Test OIDC Discovery**), **Jellyfin Username & Password Login**, **Household Password**, or **Bypass Sign-In Gate on Home Network (LAN)** (with optional **Tailscale / Mesh VPN `100.64.0.0/10`** recognition).
- **Temporary SVG QR Guest Passes & native phone Share sheet.** Generate expiring invite links, pass codes, and zero-dependency server-rendered SVG QR codes locked to a single non-administrator profile with configurable duration (`1h`–`30d`) and device limits — plus a one-tap **Share** button (`navigator.share`) on mobile phones. Link-preview bots cannot burn redemptions, guests cannot switch into other profiles or view admin routes, and revoking or expiring a pass deletes it and terminates active Jellyfin sessions immediately.
- **Opt-in Admin-Only Password Fallback (off by default).** Optionally add a subtle **Admin Sign-In** link on SSO screens that strictly enforces `IsAdministrator` on the backend (rejecting non-admin and disabled Jellyfin accounts with HTTP `403`), with an optional **LAN-only** IP restriction.
- **Multi-auth profile locks & randomized plugin passwords.** Protect any profile with a **4–8 digit PIN** (with target-scoped brute-force lockout) and/or lock it to a **Google email, OIDC email/username/`sub`, or Jellyfin username** — displaying a matching provider badge on the profile tile. Dedicated Jellyfin users created by StreamFlix receive a cryptographically randomized 256-bit password automatically (while manually created Jellyfin accounts are never modified), secrets stay masked and strictly server-side, and plugin configuration is mirrored atomically to persistent Jellyfin storage.
- **6-Tab Admin Console, Active Devices manager & JSON Config Backup.** Manage everything from the focused 6-tab **Dashboard → Plugins → StreamFlix** console (`Profiles`, `Appearance & Home`, `Sign-In & SSO`, `Features & Requests`, `Active Devices`, and `System & Backup`, plus `All`), jump straight to sections from the 6 live status cards, inspect signed-in device playback/profile status, sign out individual or all devices, run the 8-point proxy/OAuth health check, and export/import sanitized **Configuration & Profile Backups** in 1 click.

### Real Multi-User Profiles, Dedicated Kids Mode & Watch Together
- **Separate history for everyone.** Every *"Who's watching?"* tile maps to its own Jellyfin Server User, keeping **Continue Watching, Next Up, My List, played state, Jellyfin Home section order (`OrderedViews`), and parental controls** completely independent.
- **Dedicated Kids Profile Mode, Kids Bedtime Window & Parental Exit Lock.** Activating a Kids profile launches a child-safe experience with a **`KIDS`** header badge, interactive **Kids World filter bubbles**, defense-in-depth maturity ceiling enforcement across Hero, rows, search, and *Surprise Me* alongside Jellyfin's server-side `MaxParentalAgeRating`, an optional **Kids Bedtime Window** (*"Time for Bed 🌙"* screen with tonight-only Adult PIN unlock), and a **Parental Exit Lock** when leaving Kids mode.
- **Server-Authoritative Watch Together with 1-Click Guest Invites.** Host or join real-time synced watch parties powered by StreamFlix's server-authoritative sync engine (play, pause, seek, drift correction, and automatic episode transitions) from any **Title Details** modal, the **Account Pill Menu**, or the **Video Player OSD** — surfacing a live room badge only while actively connected. Choose **Everyone Controls** vs **Host Only**, **Start at 0:00** vs **Resume**, share 6-character room codes or `?watchparty=` household links, or generate a **6-hour Guest Pass + Watch Party** combo link so friends without a Jellyfin login jump straight into your stream in sync.
- **1-Click Visual Presets, Card Density & Grouped User Settings Hub.** Personalize server defaults or individual profiles inside **Settings → Appearance & Home** with 4 curated **Visual Presets** (`Netflix Classic`, `OLED Pure Black`, `Cinema Glass`, `Prime Midnight`), 3 **Card Density** sizes (`Compact`, `Standard`, `Large`), and a per-device **StreamFlix Home** toggle — organized alongside grouped **Playback & Subtitles**, **Display & Libraries**, **Administration**, and **Account & Session** cards plus the mobile **Client Settings** bridge.
- **Customizable branding, avatars, accents, Cast & Quick Connect.** Customize the upper-left brand wordmark and accent color, pick from 64 categorized icons and 14 accent colors (with one-click Shuffle), reorder profiles freely, launch **Cast**, and authorize Smart TVs or apps directly from the Account Menu's 6-character **Quick Connect** modal.

### Cinematic Home, Editorial Details, Live TV EPG, Music Mini-Player & Seerr
- **Native Seerr / Jellyseerr / Overseerr requests & live download tracker.** Connect your Seerr instance in plugin settings (with one-click **Test Seerr Connection** and SSRF protection) to surface *Available to Request* Movie & TV Season cards directly inside Live Search, see live Radarr/Sonarr download progress (`Downloading · X%`) on cards and modals, and follow requests in the **Media Requests** tracker (`All` / `In Progress` / `Available` filters with one-click **Open** in library).
- **Opt-In Live TV with Inline 3-Hour EPG Timeline & 1-Click DVR Recording.** Enable **Live TV in StreamFlix** under **Features & Requests** to add a **Live TV** hub with live channels, **On Now** broadcasts, an interactive **3-hour EPG timeline grid**, 1-click **DVR Record / Cancel** scheduling, favorite channels, recordings, and instant Live TV search — respecting per-user Jellyfin Live TV permissions and Kids Mode safety.
- **Configurable Hero Billboard (with Muted YouTube Trailer Previews), Smart Collections & Jellyfin Home Sync.** Edge-to-edge hero with optional muted **YouTube / local trailer background previews**, configurable slide count, rotation interval, and library filtering — paired with **New & Popular** (*Trending*, *Coming Soon*, *Just Added*), automatic smart rows, and full respect for Jellyfin **Home Screen Sections 1–9** and **Configured Library Order (`OrderedViews`)**.
- **Decluttered 2-Column Editorial Title Details & Persistent Music/Audiobook Mini-Player.** Opening **More Info** presents a clean 2-column layout with ClearLogo artwork, inline **YouTube Trailer** playback, a **`⋯` More Options** menu, optional **Rich Technical Quality Badges** (`4K UHD`, `Dolby Vision`, `HDR10+`, `Dolby Atmos`, `DTS:X`, `7.1`/`5.1`, `AV1`, `CC`, Critic `%`, and `Studio` credits — toggleable in Admin Settings), non-clipping Audio & Subtitles selectors, clickable comma-separated Cast/Director/Genre links, and a **Shuffle** button on TV Series. Clicking Music or Audiobook items launches a persistent frosted-glass **Audio Mini-Player** docked along the bottom edge while you keep browsing.

### Netflix-Style Video Player & Skip Intro / Credits Pill
- **Skip Intro, Recap & Credits Support (`MediaSegments` + Intro Skipper).** Automatically detects intro, recap, preview, commercial, and outro/credits segments from **Jellyfin 10.10+/12 `MediaSegments`**, the **Intro Skipper** plugin (v1 & v2 endpoints), and MKV chapter markers (toggleable via **Enable Skip Intro & Credits Pill** in Admin Settings) — rendering a frosted-glass pill with live progress fill, remaining seconds, **`S` keyboard shortcut**, **`×` dismiss**, and Smart TV D-pad focus.
- **Streamlined controls, drawers & binge watching.** Slim red scrubber, centered title, 10s/30s skip buttons, play/pause pulse feedback, live Watch Together sync pill, *"You're watching"* ClearLogo pause screen, slide-in **Episodes & Seasons** drawer, unified **Audio & Subtitles** popover, and end-of-episode **Next Episode** countdown card.

### Desktop, Liquid-Glass Mobile Dock & Smart TV Ready
- **Mobile-tuned with spring-animated floating capsule dock.** Liquid-glass bottom navigation dock on phones (`Home`, `New & Hot`, `Search`, and `My <Brand>`) with zero duplicate top-right header avatars, clean outlined category pills, an edge-to-edge bottom **Phone Account Sheet** with enlarged touch targets (*Switch Profile*, *My List*, *Surprise Me*, *Cast*, *Quick Connect*, *Watch Together*, *Media Requests*, *Guest Passes*, *Settings*, *Client Settings*, and side-by-side *StreamFlix* / *Dashboard* admin shortcuts), touch-swipe hero billboard, 3-up snap-scrolling poster rows, and a collision-free landscape player.
- **10-foot Smart TV mode.** Automatically activates on `.layout-tv`, TV browsers, or `?tv=1` with overscan-safe margins, oversized poster/profile tiles, crisp focus halos, and full 2D spatial D-pad / remote navigation.

---

## Compatibility

The plugin repository manifest includes builds for all supported Jellyfin releases — Jellyfin automatically selects the package matching your server:

| Jellyfin Server | Target ABI | Runtime | Package |
| :--- | :--- | :--- | :--- |
| **12.x** (e.g. 12.4) | `12.0.0.0` | .NET 10.0 | `Jellyfin.Plugin.StreamFlix_12.0.0.zip` |
| **10.11.x** | `10.11.0.0` | .NET 9.0 | `Jellyfin.Plugin.StreamFlix_10.11.0.zip` |
| **10.9.x – 10.10.x** | `10.9.0.0` / `10.10.0.0` | .NET 8.0 | `Jellyfin.Plugin.StreamFlix_10.9.0.zip` |

---

## Installation

1. In Jellyfin, open **Dashboard → Plugins → Repositories** and add:
   ```text
   https://raw.githubusercontent.com/streamflix-dev/jellyfin-streamflix/main/manifest.json
   ```
2. Go to **Catalog**, locate **StreamFlix** (under *General*), and click **Install**.
3. **Restart Jellyfin** to load the plugin.

---

## Setup

1. Sign in to Jellyfin as an administrator and open **Dashboard → Plugins → StreamFlix**.
2. Under **Sign-In & SSO**, enable one or more ways for your household to unlock *"Who's watching?"* (configuration fields expand automatically when enabled):
   - **Google Sign-In:** Create a *Web application* **OAuth 2.0 Client ID** in [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) with the **Authorized JavaScript origins** and **Authorized redirect URIs** shown on the settings page, paste your **Client ID**, enter **Approved Google accounts** *(on a fresh install with an empty allowlist, the first Google account to sign in is approved automatically)*, and click **Test OAuth Config**.
   - **Custom OpenID Connect (OIDC):** Register the displayed **OIDC Redirect / Callback URI** in your identity provider (`Authentik`, `Authelia`, `Pocket ID`, `Keycloak`, `Kanidm`, `Zitadel`, `Okta`, etc.), enter your **Issuer / Discovery URL** and **Client ID** (plus optional Client Secret or allowlist), and click **Test OIDC Discovery**.
   - **Jellyfin Username & Password / Household Password:** Allow active Jellyfin server users or a shared household password to unlock the profile picker — standalone or alongside Google/OIDC.
   - **Bypass Sign-In Gate on Home Network (LAN):** Let devices on private LAN subnets jump straight to *"Who's watching?"* while still enforcing authentication on remote WAN connections.
3. *(Optional)* Enable **Watch Together** for synced household/guest watch parties, connect **Seerr / Jellyseerr / Overseerr** for live-search media requests and download progress, or generate **Temporary Guest Passes** (SVG QR code / invite link) locked to a non-admin profile.
4. Click **Save**, then open **Manage Profiles** from the profile picker (or the **Profiles** tab in plugin settings) to create household profiles, enable **Kids Mode** on child profiles, and configure **4–8 digit PINs** or **Google / OIDC / Jellyfin account locks**.

> [!TIP]
> Always protect any profile linked to your Jellyfin administrator account with a **PIN** or an **account lock** (Google email, OIDC identity, or Jellyfin username) so other household members cannot switch into it.

For security, household sign-in before *"Who's watching?"* cannot be disabled globally for remote connections. If you run SSO-only (`Google` or `OIDC`), you can optionally enable the **Admin-Only Password Fallback Link** (and restrict it to LAN IPs) as an emergency administrator login path.

---

## Building from Source

```bash
cd Jellyfin.Plugin.StreamFlix

dotnet build -c Release -p:JellyfinTarget=jf12     # Jellyfin 12.x        (.NET 10.0)
dotnet build -c Release -p:JellyfinTarget=jf1011   # Jellyfin 10.11       (.NET 9.0)
dotnet build -c Release -p:JellyfinTarget=jf109    # Jellyfin 10.9/10.10  (.NET 8.0)
```

Pushing code changes to `main` triggers [`.github/workflows/build-plugin.yml`](.github/workflows/build-plugin.yml), which compiles all three targets, packages `dist/*.zip`, and updates [`manifest.json`](manifest.json).

## Project Structure

```text
├── .github/workflows/build-plugin.yml   # Multi-target CI build & manifest generator
├── build.yaml                           # Jellyfin plugin build metadata
├── manifest.json                        # Jellyfin plugin repository manifest
├── docs/screenshots/                    # Sanitized UI screenshots & OIDC flow GIF
└── Jellyfin.Plugin.StreamFlix/
    ├── Plugin.cs                        # Plugin entry point, in-memory asset bundler & index.html injection
    ├── PluginServiceRegistrator.cs      # DI registration for services & startup filter
    ├── Configuration/
    │   ├── PluginConfiguration.cs       # Profiles, Kids Mode, Watch Together, multi-auth, Guest Pass & Seerr config
    │   └── configPage.html              # 6-tab Admin UI (Dashboard → Plugins → StreamFlix)
    ├── Controllers/
    │   ├── StreamFlixDtos.cs            # Request & response DTO models (explicit camelCase JSON contracts)
    │   ├── StreamFlixController.cs      # Core config, ETag asset endpoints & caller context
    │   ├── StreamFlixController.Auth.cs # Google OAuth, Jellyfin login & Custom OIDC endpoints
    │   ├── StreamFlixController.Profiles.cs          # Profile CRUD, Kids Mode, PINs & account locks
    │   ├── StreamFlixController.GuestPasses.cs       # Temporary Guest Passes & QR share links
    │   ├── StreamFlixController.DevicesAndSessions.cs # Active Devices & session revocation
    │   ├── StreamFlixController.SeerrAndShowcase.cs  # Seerr requests, download tracker & popularity scoring
    │   └── StreamFlixController.WatchParty.cs        # Server-authoritative Watch Together room endpoints
    ├── Services/
    │   ├── StreamFlixOidcService.cs       # OIDC Relying Party (PKCE S256, discovery & JWKS verification)
    │   ├── StreamFlixQrCode.cs            # Zero-dependency ISO/IEC 18004 SVG QR code encoder
    │   ├── StreamFlixSeerrService.cs      # SSRF-hardened Seerr / Jellyseerr / Overseerr API client
    │   ├── StreamFlixSessionService.cs    # HMAC household/guest sessions & rate-limit tracking
    │   ├── StreamFlixStartupFilter.cs     # Request-time index.html script/style injection
    │   ├── StreamFlixStartupTask.cs       # Jellyfin user provisioning, password hardening & linking
    │   └── StreamFlixWatchPartyService.cs # Real-time Watch Together room state, clock sync & guest party links
    └── Web/
        ├── css/                         # Modular stylesheets (01..09: base, hub, player, TV, mobile dock, Kids & Watch Together)
        └── js/                          # Modular client scripts (01..14: auth, profiles, hub, player, Kids, Watch Together & settings)
```

## Compatible Plugins

StreamFlix works out of the box alongside supported third-party Jellyfin plugins and native segment providers (more integrations will be added over time):

- **[Intro Skipper](https://github.com/intro-skipper/intro-skipper) &amp; Jellyfin `MediaSegments` (Skip Intro / Credits)** — Automatically detected with zero extra configuration (supports `Intro Skipper` v1/v2 endpoints, native Jellyfin 10.10+/12 `MediaSegments`, and MKV chapter markers to surface the frosted-glass **Skip Intro / Recap / Credits** pill in the StreamFlix player).
- **[WebGPU Player](https://github.com/alchemyyy/jellyfin-plugin-webgpu-player)** — Automatically detected when installed with zero configuration required (uses WebGPU on supported desktop browsers and automatically falls back to Jellyfin's standard player on mobile, TV, plain HTTP, or incompatible media streams).

## Credits

Demo library media courtesy of [Blender Studio Open Movies](https://studio.blender.org/films/) ([CC BY](https://creativecommons.org/licenses/by/4.0/)) — *Sintel* (© Blender Foundation | `durian.blender.org`, CC BY 3.0) and *Cosmos Laundromat* (© Blender Foundation | `gooseberry.blender.org`, CC BY 4.0).

## License

Licensed under the [GNU General Public License v3.0](LICENSE).

## Disclosure

AI tools assisted in the creation of this plugin, alongside a very long time spent designing, testing, and iterating to get everything working smoothly.
