# Security Policy

## Supported Versions

StreamFlix publishes security updates on the latest stable release (`main` branch) and active pre-release candidates (`dev` branch).

| Version | Channel | Supported |
| :--- | :--- | :--- |
| **`>= 0.9.2.7`** | Stable (`Latest`) | ✅ Supported |
| **`>= 0.9.8.3`** | Dev Pre-Release (`dev`) | ✅ Supported |
| **`<= 0.9.2.6`** | Legacy | ❌ Upgrade immediately to `>= 0.9.2.7` |

## Reporting a Vulnerability Privately

Please **do not** report security vulnerabilities through public GitHub issues, pull requests, or discussions.

Instead, submit a confidential report directly to the maintainers via **GitHub Private Vulnerability Reporting**:

👉 **[Report a security vulnerability privately](https://github.com/streamflix-dev/jellyfin-streamflix/security/advisories/new)**

### What to Include
- Affected plugin version(s) and Jellyfin Server version (`10.9.x`, `10.10.x`, `10.11.x`, or `12.x`)
- Configuration preconditions (e.g. Google Sign-In, Custom OIDC, Standard Jellyfin Login, LAN Bypass, Guest Passes, or Seerr)
- Reproduction steps or proof-of-concept HTTP request/code paths
- Impact assessment (e.g. authentication bypass, privilege escalation, cross-profile access, SSRF, or XSS)

### Disclosure & Response Timeline
- **Initial acknowledgment:** Target within **48 hours**
- **Triage & fix plan:** Target within **5 days**
- **Coordinated release:** Security fixes are shipped to the stable repository manifest first so administrators can update before public disclosure, with full credit to the reporter (unless anonymity is requested).

## Recommended Deployment Hardening
1. **Run Jellyfin behind HTTPS** (reverse proxy such as Caddy, Nginx, or Traefik) when exposing StreamFlix outside a trusted home LAN, and configure trusted proxy networks in **Jellyfin Dashboard → Networking**.
2. **Protect Administrator Profiles:** Link your Administrator/Owner profile to your dedicated Google/OIDC identity and/or set a **4–8 digit profile PIN**.
3. **Least-Privilege Guest & Kids Access:** Only grant **Guest Pass Manager** permissions to trusted adult profiles (defaults to Administrators only), and keep Seerr/Jellyseerr API keys stored exclusively in server-side plugin settings.
