<div align="center">

# StreamFlix for Jellyfin

**A Netflix-style web UI, server-verified Google Sign-In gate, and household profiles backed by real Jellyfin users.**

[![Version](https://img.shields.io/badge/version-0.6.0-E50914?style=flat-square)](manifest.json)
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
      <sub><b>1. StreamFlix Home &amp; Hero Billboard</b> — Full-bleed featured billboard, frosted category bar, instant search &amp; Continue Watching</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/sign-in.jpg" alt="StreamFlix Google Sign-In Gate" />
      <br />
      <sub><b>2. Household Google Sign-In</b> — Clean pre-login gate with zero library exposure</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/profile-picker.jpg" alt="StreamFlix Who's Watching Profile Picker" />
      <br />
      <sub><b>3. Who's Watching?</b> — Animated library mosaic with per-member profiles, Kids badges &amp; Google locks</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/home-account-menu.jpg" alt="StreamFlix Account Menu and Profile Switcher" />
      <br />
      <sub><b>4. Account Menu &amp; Profile Switcher</b> — One-click profile switching, Cast, Quick Connect &amp; StreamFlix Home toggle</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/title-details.jpg" alt="StreamFlix Title Details Modal" />
      <br />
      <sub><b>5. Title Details (&ldquo;More Info&rdquo;)</b> — Synopsis, video/audio stream picker, cast/director &amp; external links</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="docs/screenshots/top-10-row.jpg" alt="StreamFlix Top 10 Row" />
      <br />
      <sub><b>6. Top 10 in StreamFlix Today</b> — Configurable server rankings with bold <code>#1</code>&ndash;<code>#10</code> badges &amp; rank numerals</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/player-controls.jpg" alt="StreamFlix Video Player Controls" />
      <br />
      <sub><b>7. Netflix-Style Video Player</b> — Slim red scrubber, 10s/30s skip, audio/subtitles, quality &amp; Picture-in-Picture</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/player-paused.jpg" alt="StreamFlix Video Player Pause Overlay" />
      <br />
      <sub><b>8. &ldquo;You're Watching&rdquo; Pause Screen</b> — ClearLogo artwork, runtime &amp; synopsis overlay while paused</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/edit-profile.jpg" alt="StreamFlix Edit Profile Modal" />
      <br />
      <sub><b>9. Profile Customization &amp; Security</b> — 64 avatars, 14 accent colors, maturity ratings, Kids mode, Google lock &amp; PIN</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/screenshots/admin-settings.png" alt="StreamFlix Admin Dashboard Settings" />
      <br />
      <sub><b>10. Plugin Administration</b> — OAuth status, Jellyfin user mapping, custom branding &amp; authentication controls</sub>
    </td>
  </tr>
</table>

<p align="center">
  <sub>Demo library media courtesy of <a href="https://studio.blender.org/films/">Blender Studio Open Movies</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY</a>) — featuring <i>Sintel</i> and <i>Cosmos Laundromat</i> (&copy; Blender Foundation).</sub>
</p>

---

## Highlights

### Flexible Household Sign-In & Security
- **Google OAuth, Custom OIDC (Beta), Standard Login, or Hybrid Mode.** Require server-verified Google Sign-In (with one-click **Test OAuth Config** validation), connect a self-hosted or cloud **OpenID Connect (OIDC)** provider in the bottom **Beta Test** settings section (`Authentik`, `Authelia`, `Pocket ID`, `Keycloak`, `Kanidm`, `Zitadel`, `Okta`, etc. via Authorization Code + PKCE `S256` and RSA/ECDSA JWKS verification), enable a Netflix-themed **Standard Jellyfin Account** sign-in form, or bypass the login gate automatically on trusted **Local LAN** connections.
- **Opt-in Admin Sign-In fallback (off by default).** Server owners can optionally enable an **Admin Sign-In** link on the sign-in gate in plugin settings. It strictly enforces `IsAdministrator` on the backend (rejecting non-admin and disabled Jellyfin accounts with HTTP `403`), with an optional LAN-only restriction.
- **Profile-level locks & persistent config.** Protect any profile with a **4–8 digit PIN** and/or lock it to a **specific verified Google or OIDC email**. Plugin configuration is automatically mirrored to persistent Jellyfin data storage so updates never reset your profiles or SSO settings.
- **Admin-only user linking.** Only Jellyfin administrators can view server accounts, edit admin-linked profiles, or change which Jellyfin user backs a profile.

### Real Multi-User Profiles
- **Separate history for everyone.** Every *"Who's watching?"* tile maps to its own Jellyfin Server User, keeping **Continue Watching, Next Up, My List, played state, and parental controls** completely independent.
- **Customizable branding, avatars & accents.** Customize the upper-left corner brand wordmark, choose from 64 categorized icons and 14 accent colors (with one-click Shuffle), and reorder profiles freely.
- **Quick Connect & Cast built in.** Pair Smart TVs and other Jellyfin apps straight from the profile menu via **Quick Connect** — signing that device in as the active profile's Jellyfin user — or launch **Cast** in one click.

### Cinematic Home, Top 10 & Interactive Discovery
- **Configurable Hero Billboard & Surprise Me.** Edge-to-edge hero with configurable slide count, auto-rotation interval (`0` to pause), content type, and library source filtering — paired with a frosted category bar (`Home`, `Shows`, `Movies`, `Top 10`, `My List`, `/` quick search, and a **Surprise Me** random unwatched title picker with **Shuffle Again**).
- **Dynamic Top 10 with `#1`–`#10` badges.** Choose server-wide most played, highest community rating, recently added, daily spotlight, or per-session randomized picks — complete with bold Netflix-style `#1`–`#10` rank badges.
- **Rich More Info & hover previews.** Detailed modals showcase ClearLogo title artwork, movie/series taglines, resume progress, audio/subtitle stream pickers, and **clickable Genre, Director & Cast chips** to browse matching titles in one click — alongside rich hover cards with one-click **Remove from Continue Watching (`×`)** + Undo.

### Netflix-Style Video Player
- **Streamlined controls.** Slim red scrubber, centered title, 10s/30s skip buttons, play/pause pulse feedback, and a *"You're watching"* pause screen.
- **In-player drawers & popovers.** Switch episodes instantly from the slide-in **Episodes & Seasons** drawer and change tracks live in the unified two-column **Audio & Subtitles** popover.
- **Seamless binge watching.** End-of-episode **Next Episode** countdown card (*Play Next* / *Watch Credits*) so multi-episode sessions keep flowing automatically.

### Desktop, Phone & Smart TV Ready
- **Mobile-tuned.** Single-row category bar with tap-to-expand search, touch-swipe hero billboard, 3-up snap-scrolling poster rows, bottom-sheet modals, and a collision-free landscape player.
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
2. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** (*Web application*) and add the **Authorized JavaScript origins** and **Authorized redirect URIs** shown on the StreamFlix configuration page.
3. Paste your **Google Client ID**, enter your **Approved Google accounts** (one email per line), and click **Save**.
   *(On a fresh install with an empty allowlist, the first Google account to sign in is approved automatically.)*
4. Open **Manage Profiles** from the profile picker (or plugin settings) to create household profiles, link them to Jellyfin users, and configure PINs or Google account locks.

> [!TIP]
> If you link a profile to your Jellyfin administrator account, protect it with a **PIN** or **Google account lock** so other household members cannot switch into it.

> [!NOTE]
> Don't use Google OAuth or running a local-only server? Enable **Standard Jellyfin Login** (or **Bypass Login Gate on Local Network**) in **Dashboard → Plugins → StreamFlix** to go straight to the Netflix-style UI and *"Who's watching?"* profile picker without Google Sign-In. Server owners can also opt in to showing an **Admin Sign-In** link on the Google gate (disabled by default) as a direct administrator fallback.

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
├── docs/screenshots/                    # UI screenshots
└── Jellyfin.Plugin.StreamFlix/
    ├── Plugin.cs                        # Plugin entry point & throttled index.html injection
    ├── PluginServiceRegistrator.cs      # DI registration for services & startup filter
    ├── Configuration/
    │   ├── PluginConfiguration.cs       # Profiles, Google OAuth & session configuration
    │   └── configPage.html              # Admin UI (Dashboard → Plugins → StreamFlix)
    ├── Controllers/
    │   └── StreamFlixController.cs      # Auth, session, profile & asset endpoints
    ├── Services/
    │   ├── StreamFlixOidcService.cs     # OIDC Relying Party (PKCE S256, discovery & JWKS verification)
    │   ├── StreamFlixSessionService.cs  # HMAC household sessions & PIN lockout tracking
    │   ├── StreamFlixStartupFilter.cs   # Request-time index.html script/style injection
    │   └── StreamFlixStartupTask.cs     # Jellyfin user provisioning & profile linking
    └── Web/
        ├── streamflix.css               # Cinema theme, responsive/TV layouts & animations
        └── streamflix.js                # Sign-in gate, profile picker, home hub & player UI
```

## Credits

Demo library media courtesy of [Blender Studio Open Movies](https://studio.blender.org/films/) ([CC BY](https://creativecommons.org/licenses/by/4.0/)) — *Sintel* (© Blender Foundation | `durian.blender.org`, CC BY 3.0) and *Cosmos Laundromat* (© Blender Foundation | `gooseberry.blender.org`, CC BY 4.0).

## License

Licensed under the [GNU General Public License v3.0](LICENSE).

## Disclosure

AI tools assisted in the creation of this plugin, alongside a very long time spent designing, testing, and iterating to get everything working smoothly.
