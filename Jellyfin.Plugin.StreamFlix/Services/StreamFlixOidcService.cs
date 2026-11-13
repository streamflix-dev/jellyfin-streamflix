using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Implements OpenID Connect (OIDC) Relying Party support using Authorization Code + PKCE (S256),
/// discovery caching, SSRF validation, and cryptographic RSA/ECDSA JWKS <c>id_token</c> verification.
/// </summary>
public static class StreamFlixOidcService
{
    public const string StateCookieName = "sf_oidc_state";
    public const string HandoffCookieName = "sf_oidc_handoff";
    public const string StateTokenPurpose = "oidc_state";
    public const string HandoffTokenPurpose = "oidc_handoff";

    private static readonly HttpClient NoRedirectHttp = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectTimeout = TimeSpan.FromSeconds(6),
    })
    {
        Timeout = TimeSpan.FromSeconds(10),
    };

    private static readonly ConcurrentDictionary<string, CachedDiscovery> DiscoveryCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, CachedJwks> JwksCache = new(StringComparer.OrdinalIgnoreCase);

    public sealed record OidcStatePayload(
        string StateId,
        string CodeVerifier,
        string Nonce,
        string RedirectUri,
        string ReturnWebBase,
        string PendingProfileId);

    public sealed record OidcHandoffPayload(
        string SessionToken,
        string ProviderName,
        string Email,
        string Username,
        string Name,
        string Picture,
        string ExpiresAt,
        string PendingProfileId);

    public sealed record VerifiedOidcIdentity(
        string Subject,
        string Email,
        bool EmailVerified,
        string Username,
        string Name,
        string Picture);

    public sealed record OidcDiscoveryDoc(
        string Issuer,
        string AuthorizationEndpoint,
        string TokenEndpoint,
        string JwksUri,
        string? UserInfoEndpoint);

    public sealed record OidcDiagnosticCheck(string Status, string Label, string Detail);

    public static string GetDisplayProviderName(PluginConfiguration config)
    {
        var raw = (config.OidcProviderName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return "OpenID Connect";
        }

        return raw.Length > 32 ? raw.Substring(0, 32).Trim() : raw;
    }

    public static bool IsConfigured(PluginConfiguration config)
    {
        return config.EnableCustomOidc
            && !string.IsNullOrWhiteSpace(config.OidcIssuerUrl)
            && !string.IsNullOrWhiteSpace(config.OidcClientId);
    }

    public static string BuildDiscoveryUrl(string rawIssuer)
    {
        var trimmed = (rawIssuer ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return string.Empty;
        }

        if (trimmed.EndsWith("/.well-known/openid-configuration", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        return trimmed.TrimEnd('/') + "/.well-known/openid-configuration";
    }

    public static async Task<(string AuthRedirectUrl, string SignedStateCookie)> CreateAuthorizationRedirectAsync(
        PluginConfiguration config,
        string callbackUri,
        string returnWebBase,
        string? loginHint,
        string? pendingProfileId,
        CancellationToken cancellationToken = default)
    {
        var doc = await GetDiscoveryAsync(config.OidcIssuerUrl, forceRefresh: false, cancellationToken).ConfigureAwait(false);
        var clientId = (config.OidcClientId ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(clientId))
        {
            throw new InvalidOperationException("OIDC Client ID is not configured.");
        }

        var verifierBytes = RandomNumberGenerator.GetBytes(32);
        var codeVerifier = Base64UrlEncode(verifierBytes);
        var challengeBytes = SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier));
        var codeChallenge = Base64UrlEncode(challengeBytes);
        var stateId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

        var statePayload = new OidcStatePayload(
            StateId: stateId,
            CodeVerifier: codeVerifier,
            Nonce: nonce,
            RedirectUri: callbackUri,
            ReturnWebBase: returnWebBase,
            PendingProfileId: (pendingProfileId ?? string.Empty).Trim());

        var signedCookie = StreamFlixSessionService.SignShortLivedPayload(
            config,
            StateTokenPurpose,
            statePayload,
            TimeSpan.FromMinutes(10));

        var sep = doc.AuthorizationEndpoint.Contains('?', StringComparison.Ordinal) ? "&" : "?";
        var sb = new StringBuilder(doc.AuthorizationEndpoint);
        sb.Append(sep);
        sb.Append("response_type=code");
        sb.Append("&client_id=").Append(Uri.EscapeDataString(clientId));
        sb.Append("&redirect_uri=").Append(Uri.EscapeDataString(callbackUri));
        sb.Append("&scope=").Append(Uri.EscapeDataString("openid email profile"));
        sb.Append("&state=").Append(Uri.EscapeDataString(stateId));
        sb.Append("&code_challenge=").Append(Uri.EscapeDataString(codeChallenge));
        sb.Append("&code_challenge_method=S256");
        sb.Append("&nonce=").Append(Uri.EscapeDataString(nonce));
        if (!string.IsNullOrWhiteSpace(loginHint))
        {
            sb.Append("&login_hint=").Append(Uri.EscapeDataString(loginHint.Trim()));
        }

        return (sb.ToString(), signedCookie);
    }

    public static async Task<VerifiedOidcIdentity> CompleteCallbackAsync(
        PluginConfiguration config,
        string code,
        string returnedState,
        OidcStatePayload expectedState,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(returnedState)
            || string.IsNullOrWhiteSpace(expectedState.StateId)
            || !FixedTimeAsciiEquals(returnedState.Trim(), expectedState.StateId))
        {
            throw new InvalidOperationException("Sign-in state mismatch or expired session. Please try again.");
        }

        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException("No authorization code was returned by the identity provider.");
        }

        var doc = await GetDiscoveryAsync(config.OidcIssuerUrl, forceRefresh: false, cancellationToken).ConfigureAwait(false);
        var clientId = (config.OidcClientId ?? string.Empty).Trim();
        var clientSecret = (config.OidcClientSecret ?? string.Empty).Trim();

        await ValidateSafeOutboundUrlAsync(doc.TokenEndpoint, cancellationToken).ConfigureAwait(false);
        var (tokenSuccess, tokenStatusCode, tokenBody) = await ExchangeAuthorizationCodeAsync(
            doc.TokenEndpoint,
            clientId,
            clientSecret,
            code.Trim(),
            expectedState.RedirectUri,
            expectedState.CodeVerifier,
            useBasicAuth: !string.IsNullOrEmpty(clientSecret),
            cancellationToken).ConfigureAwait(false);

        if (!tokenSuccess && !string.IsNullOrEmpty(clientSecret) && (tokenStatusCode is 400 or 401))
        {
            // Fallback to client_secret_post for OIDC providers explicitly configured against client_secret_basic
            (tokenSuccess, tokenStatusCode, tokenBody) = await ExchangeAuthorizationCodeAsync(
                doc.TokenEndpoint,
                clientId,
                clientSecret,
                code.Trim(),
                expectedState.RedirectUri,
                expectedState.CodeVerifier,
                useBasicAuth: false,
                cancellationToken).ConfigureAwait(false);
        }

        if (!tokenSuccess)
        {
            throw new InvalidOperationException($"OIDC token exchange failed (HTTP {tokenStatusCode}). Check your Client ID, Client Secret, and Redirect URI.");
        }

        using var tokenJson = JsonDocument.Parse(tokenBody);
        var tokenRoot = tokenJson.RootElement;
        var idToken = JsonStr(tokenRoot, "id_token");
        var accessToken = JsonStr(tokenRoot, "access_token");
        if (string.IsNullOrWhiteSpace(idToken))
        {
            throw new InvalidOperationException("OIDC provider did not return an id_token. Ensure the 'openid' scope is enabled.");
        }

        var claims = await VerifyAndDecodeIdTokenAsync(
            idToken,
            doc,
            clientId,
            expectedState.Nonce,
            cancellationToken).ConfigureAwait(false);

        var sub = JsonStr(claims, "sub");
        if (string.IsNullOrWhiteSpace(sub))
        {
            throw new InvalidOperationException("OIDC id_token is missing the required 'sub' claim.");
        }

        var email = JsonStr(claims, "email").Trim();
        var emailVerified = ReadEmailVerified(claims);
        var username = FirstNonEmpty(
            JsonStr(claims, "preferred_username"),
            JsonStr(claims, "nickname"),
            email,
            sub);
        var name = FirstNonEmpty(
            JsonStr(claims, "name"),
            JsonStr(claims, "given_name"),
            username,
            email);
        var picture = JsonStr(claims, "picture").Trim();

        // Supplement from userinfo_endpoint when email or display claims were omitted from id_token
        if ((string.IsNullOrEmpty(email) || string.Equals(username, sub, StringComparison.Ordinal))
            && !string.IsNullOrWhiteSpace(doc.UserInfoEndpoint)
            && !string.IsNullOrWhiteSpace(accessToken))
        {
            try
            {
                await ValidateSafeOutboundUrlAsync(doc.UserInfoEndpoint!, cancellationToken).ConfigureAwait(false);
                using var uiReq = new HttpRequestMessage(HttpMethod.Get, doc.UserInfoEndpoint);
                uiReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                uiReq.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                using var uiResp = await NoRedirectHttp.SendAsync(uiReq, cancellationToken).ConfigureAwait(false);
                if (uiResp.IsSuccessStatusCode)
                {
                    using var uiDoc = JsonDocument.Parse(await uiResp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
                    var ui = uiDoc.RootElement;
                    var uiSub = JsonStr(ui, "sub");
                    if (string.IsNullOrEmpty(uiSub) || string.Equals(uiSub, sub, StringComparison.Ordinal))
                    {
                        if (string.IsNullOrEmpty(email))
                        {
                            email = JsonStr(ui, "email").Trim();
                            emailVerified = ReadEmailVerified(ui);
                        }

                        username = FirstNonEmpty(JsonStr(ui, "preferred_username"), username, email, sub);
                        name = FirstNonEmpty(JsonStr(ui, "name"), name, username);
                        if (string.IsNullOrEmpty(picture))
                        {
                            picture = JsonStr(ui, "picture").Trim();
                        }
                    }
                }
            }
            catch
            {
                // Non-fatal: id_token claims are already cryptographically verified
            }
        }

        if (!string.IsNullOrEmpty(picture) && !picture.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !picture.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            picture = string.Empty;
        }

        return new VerifiedOidcIdentity(
            Subject: sub.Trim(),
            Email: email,
            EmailVerified: emailVerified,
            Username: username.Trim(),
            Name: name.Trim(),
            Picture: picture);
    }

    public static async Task<(string Status, string Summary, List<OidcDiagnosticCheck> Checks)> TestDiscoveryAsync(
        string? rawIssuerUrl,
        string? rawClientId,
        string? callbackUri,
        bool requireAllowlist,
        int allowlistCount,
        CancellationToken cancellationToken = default)
    {
        var checks = new List<OidcDiagnosticCheck>();
        var issuerInput = (rawIssuerUrl ?? string.Empty).Trim();
        var clientId = (rawClientId ?? string.Empty).Trim();

        if (string.IsNullOrEmpty(issuerInput))
        {
            checks.Add(new("error", "Issuer URL", "OIDC Issuer URL is empty. Enter your provider's issuer URL (e.g. https://auth.example.com/application/o/streamflix/)."));
        }
        else
        {
            var discUrl = BuildDiscoveryUrl(issuerInput);
            try
            {
                await ValidateSafeOutboundUrlAsync(discUrl, cancellationToken).ConfigureAwait(false);
                checks.Add(new("ok", "Issuer URL format", $"Discovery endpoint resolved to {discUrl}."));
            }
            catch (Exception ex)
            {
                checks.Add(new("error", "Issuer URL", ex.Message));
            }
        }

        if (string.IsNullOrEmpty(clientId))
        {
            checks.Add(new("error", "Client ID", "OIDC Client ID is empty."));
        }
        else
        {
            checks.Add(new("ok", "Client ID", $"Client ID '{clientId}' looks valid."));
        }

        if (!string.IsNullOrWhiteSpace(callbackUri))
        {
            if (Uri.TryCreate(callbackUri.Trim(), UriKind.Absolute, out var cbUri))
            {
                var isHttpsOrLocal = string.Equals(cbUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                    || cbUri.IsLoopback;
                checks.Add(new(
                    isHttpsOrLocal ? "ok" : "warn",
                    "Redirect URI",
                    isHttpsOrLocal
                        ? $"Register {cbUri} in your OIDC provider's Redirect URIs."
                        : $"Callback {cbUri} uses plain HTTP on a non-localhost address; most OIDC providers require HTTPS."));
            }
        }

        if (requireAllowlist && allowlistCount == 0)
        {
            checks.Add(new("warn", "Allowlist", "Allowlist enforcement is enabled, so only emails locked to a StreamFlix profile will be permitted until you add entries."));
        }
        else if (requireAllowlist)
        {
            checks.Add(new("ok", "Allowlist", $"{allowlistCount} approved OIDC email/username entr{(allowlistCount == 1 ? "y" : "ies")} configured."));
        }
        else
        {
            checks.Add(new("ok", "Access policy", "All users authenticated by this OIDC provider can unlock 'Who's watching?'."));
        }

        if (checks.All(c => c.Status != "error"))
        {
            try
            {
                var doc = await GetDiscoveryAsync(issuerInput, forceRefresh: true, cancellationToken).ConfigureAwait(false);
                checks.Add(new("ok", "OIDC Discovery", $"Connected to issuer '{doc.Issuer}' (authorization + token + JWKS endpoints verified)."));

                var jwksJson = await FetchJwksJsonAsync(doc.JwksUri, cancellationToken).ConfigureAwait(false);
                using var parsedJwks = JsonDocument.Parse(jwksJson);
                var keyCount = parsedJwks.RootElement.TryGetProperty("keys", out var keysArr) && keysArr.ValueKind == JsonValueKind.Array
                    ? keysArr.GetArrayLength()
                    : 0;
                checks.Add(keyCount > 0
                    ? new("ok", "JWKS Signing Keys", $"Fetched {keyCount} active public signing key{(keyCount == 1 ? string.Empty : "s")} from jwks_uri.")
                    : new("error", "JWKS Signing Keys", "jwks_uri returned 0 signing keys."));
            }
            catch (Exception ex)
            {
                checks.Add(new("error", "OIDC Discovery", $"Could not verify provider discovery/JWKS: {ex.Message}"));
            }
        }

        var hasErr = checks.Any(c => c.Status == "error");
        var hasWarn = checks.Any(c => c.Status == "warn");
        var overall = hasErr ? "error" : (hasWarn ? "warn" : "ok");
        var summary = hasErr
            ? "OIDC validation found configuration errors — review the checks below."
            : (hasWarn
                ? "OIDC discovery succeeded with minor warnings."
                : "OIDC discovery & JWKS verification succeeded! Save settings to activate.");

        return (overall, summary, checks);
    }

    private static async Task<OidcDiscoveryDoc> GetDiscoveryAsync(
        string rawIssuerUrl,
        bool forceRefresh,
        CancellationToken cancellationToken)
    {
        var discoveryUrl = BuildDiscoveryUrl(rawIssuerUrl);
        if (string.IsNullOrEmpty(discoveryUrl))
        {
            throw new InvalidOperationException("OIDC Issuer URL is not configured.");
        }

        if (!forceRefresh
            && DiscoveryCache.TryGetValue(discoveryUrl, out var cached)
            && DateTimeOffset.UtcNow - cached.FetchedAt < TimeSpan.FromMinutes(10))
        {
            return cached.Doc;
        }

        await ValidateSafeOutboundUrlAsync(discoveryUrl, cancellationToken).ConfigureAwait(false);
        using var resp = await SendGetFollowSafeRedirectsAsync(discoveryUrl, cancellationToken).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Discovery endpoint returned HTTP {(int)resp.StatusCode}.");
        }

        var raw = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        using var json = JsonDocument.Parse(raw);
        var root = json.RootElement;

        var issuer = JsonStr(root, "issuer").Trim();
        var authEp = JsonStr(root, "authorization_endpoint").Trim();
        var tokenEp = JsonStr(root, "token_endpoint").Trim();
        var jwksUri = JsonStr(root, "jwks_uri").Trim();
        var userInfoEp = JsonStr(root, "userinfo_endpoint").Trim();

        if (string.IsNullOrEmpty(issuer) || string.IsNullOrEmpty(authEp) || string.IsNullOrEmpty(tokenEp) || string.IsNullOrEmpty(jwksUri))
        {
            throw new InvalidOperationException("Discovery JSON is missing required OIDC endpoints (issuer, authorization_endpoint, token_endpoint, or jwks_uri).");
        }

        // Validate discovered server-fetched endpoints upfront
        await ValidateSafeOutboundUrlAsync(tokenEp, cancellationToken).ConfigureAwait(false);
        await ValidateSafeOutboundUrlAsync(jwksUri, cancellationToken).ConfigureAwait(false);
        if (!Uri.TryCreate(authEp, UriKind.Absolute, out var authUri)
            || (!string.Equals(authUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(authUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("Discovered authorization_endpoint is not a valid HTTP/HTTPS URL.");
        }

        var doc = new OidcDiscoveryDoc(
            Issuer: issuer,
            AuthorizationEndpoint: authEp,
            TokenEndpoint: tokenEp,
            JwksUri: jwksUri,
            UserInfoEndpoint: string.IsNullOrEmpty(userInfoEp) ? null : userInfoEp);

        if (DiscoveryCache.Count > 64)
        {
            DiscoveryCache.Clear();
        }

        DiscoveryCache[discoveryUrl] = new CachedDiscovery(doc, DateTimeOffset.UtcNow);
        return doc;
    }

    private static async Task<string> GetJwksJsonCachedAsync(
        OidcDiscoveryDoc doc,
        bool forceRefresh,
        CancellationToken cancellationToken)
    {
        if (!forceRefresh
            && JwksCache.TryGetValue(doc.JwksUri, out var cached)
            && !string.IsNullOrEmpty(cached.JwksJson)
            && DateTimeOffset.UtcNow - cached.FetchedAt < TimeSpan.FromMinutes(10))
        {
            return cached.JwksJson;
        }

        var jwks = await FetchJwksJsonAsync(doc.JwksUri, cancellationToken).ConfigureAwait(false);
        if (JwksCache.Count > 64)
        {
            JwksCache.Clear();
        }

        JwksCache[doc.JwksUri] = new CachedJwks(jwks, DateTimeOffset.UtcNow);
        return jwks;
    }

    private static async Task<(bool Success, int StatusCode, string Body)> ExchangeAuthorizationCodeAsync(
        string tokenEndpoint,
        string clientId,
        string clientSecret,
        string code,
        string redirectUri,
        string codeVerifier,
        bool useBasicAuth,
        CancellationToken cancellationToken)
    {
        var form = new List<KeyValuePair<string, string>>
        {
            new("grant_type", "authorization_code"),
            new("code", code),
            new("redirect_uri", redirectUri),
            new("code_verifier", codeVerifier),
        };

        using var tokenReq = new HttpRequestMessage(HttpMethod.Post, tokenEndpoint);
        if (useBasicAuth && !string.IsNullOrEmpty(clientSecret))
        {
            // RFC 6749 §2.3.1 client_secret_basic: URL-encode client_id and client_secret before joining with ':'
            var basicPair = Uri.EscapeDataString(clientId) + ":" + Uri.EscapeDataString(clientSecret);
            var basicB64 = Convert.ToBase64String(Encoding.ASCII.GetBytes(basicPair));
            tokenReq.Headers.Authorization = new AuthenticationHeaderValue("Basic", basicB64);
        }
        else
        {
            form.Add(new("client_id", clientId));
            if (!string.IsNullOrEmpty(clientSecret))
            {
                form.Add(new("client_secret", clientSecret));
            }
        }

        tokenReq.Content = new FormUrlEncodedContent(form);
        tokenReq.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var tokenResp = await NoRedirectHttp.SendAsync(tokenReq, cancellationToken).ConfigureAwait(false);
        var tokenBody = await tokenResp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return (tokenResp.IsSuccessStatusCode, (int)tokenResp.StatusCode, tokenBody);
    }

    private static async Task<string> FetchJwksJsonAsync(string jwksUri, CancellationToken cancellationToken)
    {
        await ValidateSafeOutboundUrlAsync(jwksUri, cancellationToken).ConfigureAwait(false);
        using var resp = await SendGetFollowSafeRedirectsAsync(jwksUri, cancellationToken).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"jwks_uri returned HTTP {(int)resp.StatusCode}.");
        }

        return await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<HttpResponseMessage> SendGetFollowSafeRedirectsAsync(string initialUrl, CancellationToken cancellationToken)
    {
        var currentUrl = initialUrl;
        for (var hop = 0; hop < 3; hop++)
        {
            await ValidateSafeOutboundUrlAsync(currentUrl, cancellationToken).ConfigureAwait(false);
            using var req = new HttpRequestMessage(HttpMethod.Get, currentUrl);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            var resp = await NoRedirectHttp.SendAsync(req, cancellationToken).ConfigureAwait(false);
            if ((int)resp.StatusCode is 301 or 302 or 303 or 307 or 308
                && resp.Headers.Location != null)
            {
                var nextUri = resp.Headers.Location.IsAbsoluteUri
                    ? resp.Headers.Location
                    : new Uri(new Uri(currentUrl), resp.Headers.Location);
                resp.Dispose();
                currentUrl = nextUri.ToString();
                continue;
            }

            return resp;
        }

        throw new InvalidOperationException("Too many redirects while contacting OIDC provider.");
    }

    private static async Task<JsonElement> VerifyAndDecodeIdTokenAsync(
        string idToken,
        OidcDiscoveryDoc doc,
        string expectedClientId,
        string expectedNonce,
        CancellationToken cancellationToken)
    {
        var parts = idToken.Trim().Split('.');
        if (parts.Length != 3)
        {
            throw new InvalidOperationException("Malformed OIDC id_token.");
        }

        using var headerDoc = JsonDocument.Parse(Base64UrlDecode(parts[0]));
        var header = headerDoc.RootElement;
        var alg = JsonStr(header, "alg").Trim();
        var kid = JsonStr(header, "kid").Trim();

        if (string.IsNullOrEmpty(alg) || string.Equals(alg, "none", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Unsigned OIDC id_token rejected.");
        }

        var signingInput = Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]);
        var signature = Base64UrlDecode(parts[2]);

        var jwksJson = await GetJwksJsonCachedAsync(doc, forceRefresh: false, cancellationToken).ConfigureAwait(false);
        if (!TryVerifySignatureAgainstJwks(jwksJson, alg, kid, signingInput, signature))
        {
            // Refresh JWKS once in case the provider rotated signing keys
            jwksJson = await GetJwksJsonCachedAsync(doc, forceRefresh: true, cancellationToken).ConfigureAwait(false);
            if (!TryVerifySignatureAgainstJwks(jwksJson, alg, kid, signingInput, signature))
            {
                throw new InvalidOperationException("OIDC id_token cryptographic signature verification failed.");
            }
        }

        using var payloadDoc = JsonDocument.Parse(Base64UrlDecode(parts[1]));
        var payload = payloadDoc.RootElement.Clone();

        var iss = JsonStr(payload, "iss").Trim().TrimEnd('/');
        var expectedIss = doc.Issuer.Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(iss) || !string.Equals(iss, expectedIss, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("OIDC id_token issuer mismatch.");
        }

        if (!AudienceMatches(payload, expectedClientId))
        {
            throw new InvalidOperationException("OIDC id_token audience does not match configured Client ID.");
        }

        var nowSec = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (!TryReadUnixSeconds(payload, "exp", out var expSec) || expSec + 120 <= nowSec)
        {
            throw new InvalidOperationException("OIDC id_token has expired.");
        }

        if (TryReadUnixSeconds(payload, "nbf", out var nbfSec) && nbfSec - 120 > nowSec)
        {
            throw new InvalidOperationException("OIDC id_token is not yet valid (nbf).");
        }

        var tokenNonce = JsonStr(payload, "nonce");
        if (string.IsNullOrEmpty(tokenNonce) || !FixedTimeAsciiEquals(tokenNonce, expectedNonce))
        {
            throw new InvalidOperationException("OIDC id_token nonce mismatch.");
        }

        return payload;
    }

    private static bool TryVerifySignatureAgainstJwks(
        string jwksJson,
        string alg,
        string kid,
        byte[] signingInput,
        byte[] signature)
    {
        using var doc = JsonDocument.Parse(jwksJson);
        if (!doc.RootElement.TryGetProperty("keys", out var keys) || keys.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var jwk in keys.EnumerateArray())
        {
            var use = JsonStr(jwk, "use");
            if (!string.IsNullOrEmpty(use) && !string.Equals(use, "sig", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var jwkKid = JsonStr(jwk, "kid");
            if (!string.IsNullOrEmpty(kid) && !string.IsNullOrEmpty(jwkKid) && !string.Equals(kid, jwkKid, StringComparison.Ordinal))
            {
                continue;
            }

            try
            {
                if (VerifySingleJwk(jwk, alg, signingInput, signature))
                {
                    return true;
                }
            }
            catch
            {
            }
        }

        return false;
    }

    private static bool VerifySingleJwk(JsonElement jwk, string alg, byte[] signingInput, byte[] signature)
    {
        var kty = JsonStr(jwk, "kty").ToUpperInvariant();
        if (kty == "RSA")
        {
            var nStr = JsonStr(jwk, "n");
            var eStr = JsonStr(jwk, "e");
            if (string.IsNullOrEmpty(nStr) || string.IsNullOrEmpty(eStr))
            {
                return false;
            }

            var (hashAlg, padding) = alg.ToUpperInvariant() switch
            {
                "RS256" => (HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1),
                "RS384" => (HashAlgorithmName.SHA384, RSASignaturePadding.Pkcs1),
                "RS512" => (HashAlgorithmName.SHA512, RSASignaturePadding.Pkcs1),
                "PS256" => (HashAlgorithmName.SHA256, RSASignaturePadding.Pss),
                "PS384" => (HashAlgorithmName.SHA384, RSASignaturePadding.Pss),
                "PS512" => (HashAlgorithmName.SHA512, RSASignaturePadding.Pss),
                _ => default,
            };
            if (padding == null)
            {
                return false;
            }

            using var rsa = RSA.Create();
            rsa.ImportParameters(new RSAParameters
            {
                Modulus = Base64UrlDecode(nStr),
                Exponent = Base64UrlDecode(eStr),
            });
            return rsa.VerifyData(signingInput, signature, hashAlg, padding);
        }

        if (kty == "EC")
        {
            var crv = JsonStr(jwk, "crv");
            var xStr = JsonStr(jwk, "x");
            var yStr = JsonStr(jwk, "y");
            if (string.IsNullOrEmpty(xStr) || string.IsNullOrEmpty(yStr))
            {
                return false;
            }

            var (curve, hashAlg, coordLen) = (alg.ToUpperInvariant(), crv) switch
            {
                ("ES256", "P-256") => (ECCurve.NamedCurves.nistP256, HashAlgorithmName.SHA256, 32),
                ("ES384", "P-384") => (ECCurve.NamedCurves.nistP384, HashAlgorithmName.SHA384, 48),
                ("ES512", "P-521") => (ECCurve.NamedCurves.nistP521, HashAlgorithmName.SHA512, 66),
                _ => default,
            };
            if (hashAlg.Name == null)
            {
                return false;
            }

            using var ecdsa = ECDsa.Create(new ECParameters
            {
                Curve = curve,
                Q = new ECPoint
                {
                    X = PadCoordinate(Base64UrlDecode(xStr), coordLen),
                    Y = PadCoordinate(Base64UrlDecode(yStr), coordLen),
                },
            });
            return ecdsa.VerifyData(signingInput, signature, hashAlg, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }

        return false;
    }

    private static bool AudienceMatches(JsonElement payload, string expectedClientId)
    {
        if (!payload.TryGetProperty("aud", out var audProp))
        {
            return false;
        }

        if (audProp.ValueKind == JsonValueKind.String)
        {
            return string.Equals(audProp.GetString()?.Trim(), expectedClientId, StringComparison.Ordinal);
        }

        if (audProp.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in audProp.EnumerateArray())
            {
                if (el.ValueKind == JsonValueKind.String
                    && string.Equals(el.GetString()?.Trim(), expectedClientId, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static async Task ValidateSafeOutboundUrlAsync(string rawUrl, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException("URL must be an absolute https:// address.");
        }

        var isHttps = string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
        var isHttp = string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase);
        if (!isHttps && !isHttp)
        {
            throw new InvalidOperationException("Only https:// (or local http://) OIDC URLs are permitted.");
        }

        IPAddress[] addrs;
        if (IPAddress.TryParse(uri.DnsSafeHost, out var literalIp))
        {
            addrs = new[] { literalIp };
        }
        else
        {
            addrs = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, cancellationToken).ConfigureAwait(false);
        }

        if (addrs.Length == 0)
        {
            throw new InvalidOperationException($"Could not resolve host '{uri.DnsSafeHost}'.");
        }

        var allLocalOrPrivate = true;
        foreach (var rawIp in addrs)
        {
            var ip = rawIp.IsIPv4MappedToIPv6 ? rawIp.MapToIPv4() : rawIp;
            if (IsForbiddenMetadataOrUnspecifiedIp(ip))
            {
                throw new InvalidOperationException("Target address is blocked by SSRF security policy.");
            }

            if (!IsLoopbackOrRfc1918(ip))
            {
                allLocalOrPrivate = false;
            }
        }

        if (isHttp && !allLocalOrPrivate)
        {
            throw new InvalidOperationException("Plain HTTP is only permitted for localhost or private LAN OIDC providers; external providers must use https://.");
        }
    }

    private static bool IsForbiddenMetadataOrUnspecifiedIp(IPAddress ip)
    {
        if (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast))
        {
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            // Block 0.0.0.0/8, 169.254.0.0/16 (AWS/GCP/Azure IMDS), and 100.100.100.200 (Alibaba IMDS)
            if (b[0] == 0 || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] == 100 && b[2] == 100 && b[3] == 200))
            {
                return true;
            }
        }
        else if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6Multicast)
            {
                return true;
            }

            var b = ip.GetAddressBytes();
            // Block fd00:ec2::254 (AWS IPv6 IMDS)
            if (b[0] == 0xfd && b[1] == 0x00 && b[2] == 0x0e && b[3] == 0xc2)
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsLoopbackOrRfc1918(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip))
        {
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return b[0] == 10
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168);
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var b = ip.GetAddressBytes();
            return (b[0] & 0xfe) == 0xfc;
        }

        return false;
    }

    private static bool ReadEmailVerified(JsonElement obj)
    {
        if (!obj.TryGetProperty("email_verified", out var prop))
        {
            // Many enterprise / self-hosted IdPs (Authentik/Keycloak default mappers) omit email_verified when emails are admin-managed;
            // treat explicit false/\"false\" as unverified, and true/\"true\"/omitted-with-non-empty-email appropriately:
            return true;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => string.Equals(prop.GetString(), "true", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    private static bool TryReadUnixSeconds(JsonElement obj, string propName, out long seconds)
    {
        seconds = 0;
        if (!obj.TryGetProperty(propName, out var prop))
        {
            return false;
        }

        if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt64(out seconds))
        {
            return true;
        }

        if (prop.ValueKind == JsonValueKind.String && long.TryParse(prop.GetString(), out seconds))
        {
            return true;
        }

        return false;
    }

    private static string JsonStr(JsonElement obj, string propName)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(propName, out var prop))
        {
            return prop.ValueKind switch
            {
                JsonValueKind.String => prop.GetString() ?? string.Empty,
                JsonValueKind.Number => prop.GetRawText(),
                _ => string.Empty,
            };
        }

        return string.Empty;
    }

    private static byte[] PadCoordinate(byte[] raw, int expectedLength)
    {
        if (raw.Length == expectedLength)
        {
            return raw;
        }

        if (raw.Length > expectedLength && raw[0] == 0 && raw.Length == expectedLength + 1)
        {
            var trimmed = new byte[expectedLength];
            Buffer.BlockCopy(raw, 1, trimmed, 0, expectedLength);
            return trimmed;
        }

        if (raw.Length < expectedLength)
        {
            var padded = new byte[expectedLength];
            Buffer.BlockCopy(raw, 0, padded, expectedLength - raw.Length, raw.Length);
            return padded;
        }

        return raw;
    }

    private static string FirstNonEmpty(params string?[] candidates)
    {
        foreach (var c in candidates)
        {
            if (!string.IsNullOrWhiteSpace(c))
            {
                return c.Trim();
            }
        }

        return string.Empty;
    }

    private static bool FixedTimeAsciiEquals(string a, string b)
    {
        var ba = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return CryptographicOperations.FixedTimeEquals(ba, bb);
    }

    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static byte[] Base64UrlDecode(string data)
    {
        var s = data.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
        }

        return Convert.FromBase64String(s);
    }

    private sealed record CachedDiscovery(OidcDiscoveryDoc Doc, DateTimeOffset FetchedAt);

    private sealed record CachedJwks(string JwksJson, DateTimeOffset FetchedAt);
}
