using System;
using System.Collections.Generic;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Canonical StreamFlix error code catalog (<c>SF-CATEGORY-NNN</c>) for consistent client diagnostics,
/// user support reports, and server health checks across Jellyfin 10.9, 10.10, 10.11, and 12.x.
/// </summary>
public static class StreamFlixErrorCodes
{
    // Authentication & Household Session (100-199)
    public const string HouseholdSignInRequired = "SF-AUTH-101";
    public const string InvalidCredentials = "SF-AUTH-102";
    public const string LoginRateLimited = "SF-AUTH-103";
    public const string GoogleSignInDisabled = "SF-AUTH-104";
    public const string GoogleTokenUnverified = "SF-AUTH-105";
    public const string GoogleAccountNotApproved = "SF-AUTH-106";
    public const string StandardLoginDisabled = "SF-AUTH-107";
    public const string AdminFallbackDisabled = "SF-AUTH-108";
    public const string GateUnconfiguredOrOwnerUnprotected = "SF-AUTH-109";
    public const string JellyfinSessionRequired = "SF-AUTH-110";
    public const string RemoteAccessDisabled = "SF-AUTH-111";

    // Custom OpenID Connect / SSO (200-299)
    public const string OidcNotConfigured = "SF-OIDC-201";
    public const string OidcDiscoveryFailed = "SF-OIDC-202";
    public const string OidcStateInvalidOrExpired = "SF-OIDC-203";
    public const string OidcTokenExchangeFailed = "SF-OIDC-204";
    public const string OidcAccountNotApproved = "SF-OIDC-205";
    public const string OidcPollSecretInvalid = "SF-OIDC-206";
    public const string OidcProxyHeaderMismatch = "SF-OIDC-208";

    // Profiles, Locks & PINs (300-399)
    public const string ProfileNotFound = "SF-PROF-300";
    public const string ProfileUnlinked = "SF-PROF-301";
    public const string ProfileJellyfinAuthFailed = "SF-PROF-302";
    public const string ProfileJellyfinUserDisabled = "SF-PROF-303";
    public const string ProfileAccountLocked = "SF-PROF-304";
    public const string ProfileAdminLinkForbidden = "SF-PROF-305";
    public const string ProfileValidationFailed = "SF-PROF-306";
    public const string ProfileActivationForbidden = "SF-PROF-307";
    public const string PinRequired = "SF-PIN-310";
    public const string AdultPinRequired = "SF-PIN-311";
    public const string PinInvalid = "SF-PIN-312";
    public const string PinLockedOut = "SF-PIN-313";

    // Seerr / Jellyseerr / Overseerr (400-499)
    public const string SeerrForbidden = "SF-SEERR-401";
    public const string SeerrUnreachable = "SF-SEERR-402";
    public const string SeerrTimeout = "SF-SEERR-403";
    public const string SeerrRequestFailed = "SF-SEERR-404";
    public const string SeerrQuotaExceeded = "SF-SEERR-405";
    public const string SeerrRateLimited = "SF-SEERR-406";

    // Temporary Guest Passes (500-599)
    public const string GuestPassDisabled = "SF-GUEST-501";
    public const string GuestPassInvalidOrExpired = "SF-GUEST-502";
    public const string GuestPassRateLimited = "SF-GUEST-503";
    public const string GuestPassRestricted = "SF-GUEST-504";
    public const string GuestPassAdminForbidden = "SF-GUEST-505";

    // Administration, Devices & Watch Together (600-699)
    public const string AdminRequired = "SF-ADMIN-601";
    public const string ConfigValidationFailed = "SF-ADMIN-602";
    public const string WatchPartyError = "SF-WP-620";
    public const string WatchPartyForbidden = "SF-WP-621";
    public const string WatchPartyNotFound = "SF-WP-622";

    // Hub Bootstrap & Generic Request/Server (700-799)
    public const string HubBootstrapFailed = "SF-HUB-701";
    public const string BadRequestPayload = "SF-REQ-740";
    public const string ForbiddenGeneric = "SF-REQ-743";
    public const string NotFoundGeneric = "SF-REQ-744";
    public const string RateLimitedGeneric = "SF-REQ-749";
    public const string InternalServerError = "SF-SRV-750";

    private static readonly Dictionary<string, string> BySymbolicCode = new(StringComparer.OrdinalIgnoreCase)
    {
        ["google_required"] = HouseholdSignInRequired,
        ["jellyfin_auth_required"] = JellyfinSessionRequired,
        ["invalid_credentials"] = InvalidCredentials,
        ["login_locked"] = LoginRateLimited,
        ["google_disabled"] = GoogleSignInDisabled,
        ["google_unverified"] = GoogleTokenUnverified,
        ["not_approved"] = GoogleAccountNotApproved,
        ["standard_login_disabled"] = StandardLoginDisabled,
        ["admin_fallback_disabled"] = AdminFallbackDisabled,
        ["lan_only"] = AdminFallbackDisabled,
        ["remote_access_disabled"] = RemoteAccessDisabled,

        ["oidc_disabled"] = OidcNotConfigured,
        ["oidc_unconfigured"] = OidcNotConfigured,
        ["oidc_discovery_failed"] = OidcDiscoveryFailed,
        ["oidc_state_invalid"] = OidcStateInvalidOrExpired,
        ["oidc_handoff_expired"] = OidcStateInvalidOrExpired,
        ["oidc_exchange_failed"] = OidcTokenExchangeFailed,
        ["oidc_not_approved"] = OidcAccountNotApproved,
        ["oidc_poll_invalid"] = OidcPollSecretInvalid,

        ["profile_not_found"] = ProfileNotFound,
        ["profile_unlinked"] = ProfileUnlinked,
        ["auth_failed"] = ProfileJellyfinAuthFailed,
        ["user_disabled"] = ProfileJellyfinUserDisabled,
        ["google_lock"] = ProfileAccountLocked,
        ["google_locked"] = ProfileAccountLocked,
        ["google_lock_forbidden"] = ProfileAccountLocked,
        ["admin_link_forbidden"] = ProfileAdminLinkForbidden,
        ["link_change_forbidden"] = ProfileAdminLinkForbidden,
        ["admin_profile_required"] = ProfileActivationForbidden,
        ["profile_account_mismatch"] = ProfileActivationForbidden,
        ["profile_protection_required"] = ProfileActivationForbidden,
        ["invalid_link"] = ProfileValidationFailed,

        ["pin_required"] = PinRequired,
        ["adult_pin_required"] = AdultPinRequired,
        ["pin_invalid"] = PinInvalid,
        ["pin_locked"] = PinLockedOut,

        ["seerr_forbidden"] = SeerrForbidden,
        ["seerr_permission_denied"] = SeerrForbidden,
        ["seerr_cancel_forbidden"] = SeerrForbidden,
        ["seerr_unreachable"] = SeerrUnreachable,
        ["seerr_timeout"] = SeerrTimeout,
        ["seerr_request_failed"] = SeerrRequestFailed,
        ["seerr_cancel_failed"] = SeerrRequestFailed,
        ["seerr_quota_exceeded"] = SeerrQuotaExceeded,
        ["rate_limited"] = SeerrRateLimited,

        ["guest_passes_disabled"] = GuestPassDisabled,
        ["guest_invalid"] = GuestPassInvalidOrExpired,
        ["guest_expired"] = GuestPassInvalidOrExpired,
        ["guest_handoff_missing"] = GuestPassInvalidOrExpired,
        ["guest_locked"] = GuestPassRateLimited,
        ["guest_pass_restricted"] = GuestPassRestricted,
        ["guest_pass_permission_required"] = GuestPassRestricted,
        ["guest_profile_locked"] = GuestPassRestricted,
        ["guest_admin_forbidden"] = GuestPassAdminForbidden,

        ["admin_required"] = AdminRequired,
        ["room_not_found"] = WatchPartyNotFound,
        ["host_only"] = WatchPartyForbidden,
        ["watch_party_disabled"] = WatchPartyForbidden,
    };

    public static string Resolve(string? symbolicCode, int statusCode, string? routePath = null)
    {
        if (!string.IsNullOrWhiteSpace(symbolicCode) && BySymbolicCode.TryGetValue(symbolicCode.Trim(), out var mapped))
        {
            return mapped;
        }

        var path = (routePath ?? string.Empty).ToLowerInvariant();
        if (path.Contains("/seerr/", StringComparison.Ordinal))
        {
            return statusCode switch
            {
                401 => HouseholdSignInRequired,
                403 => SeerrForbidden,
                429 => SeerrQuotaExceeded,
                504 => SeerrTimeout,
                >= 500 => SeerrUnreachable,
                _ => SeerrRequestFailed,
            };
        }

        if (path.Contains("/oidc/", StringComparison.Ordinal))
        {
            return statusCode switch
            {
                401 or 403 => OidcAccountNotApproved,
                400 => OidcStateInvalidOrExpired,
                _ => OidcTokenExchangeFailed,
            };
        }

        if (path.Contains("/guest", StringComparison.Ordinal))
        {
            return statusCode switch
            {
                429 => GuestPassRateLimited,
                403 => GuestPassRestricted,
                _ => GuestPassInvalidOrExpired,
            };
        }

        if (path.Contains("/watchparty", StringComparison.Ordinal))
        {
            return statusCode switch
            {
                404 => WatchPartyNotFound,
                403 => WatchPartyForbidden,
                _ => WatchPartyError,
            };
        }

        if (path.Contains("/profiles", StringComparison.Ordinal))
        {
            return statusCode switch
            {
                404 => ProfileNotFound,
                409 => ProfileUnlinked,
                429 => PinLockedOut,
                403 => PinInvalid,
                _ => ProfileValidationFailed,
            };
        }

        if (path.Contains("/adminconfig", StringComparison.Ordinal))
        {
            return statusCode == 403 ? AdminRequired : ConfigValidationFailed;
        }

        if (path.Contains("/hub/bootstrap", StringComparison.Ordinal))
        {
            return statusCode == 401 ? HouseholdSignInRequired : HubBootstrapFailed;
        }

        return statusCode switch
        {
            400 => BadRequestPayload,
            401 => HouseholdSignInRequired,
            403 => ForbiddenGeneric,
            404 => NotFoundGeneric,
            429 => RateLimitedGeneric,
            _ => InternalServerError,
        };
    }
}

/// <summary>
/// Automatically enriches all non-2xx JSON responses on <c>StreamFlixController</c> with a canonical
/// <c>errorCode</c> (<c>SF-xxx-NNN</c>) while preserving every existing response property intact.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class StreamFlixErrorEnvelopeAttribute : ResultFilterAttribute
{
    public override void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not ObjectResult objResult || objResult.Value == null)
        {
            base.OnResultExecuting(context);
            return;
        }

        var statusCode = objResult.StatusCode ?? context.HttpContext.Response.StatusCode;
        var val = objResult.Value;
        if (val is string || val is byte[] || val is IDictionary<string, object?>)
        {
            base.OnResultExecuting(context);
            return;
        }

        var props = val.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance);
        if (props.Length == 0)
        {
            base.OnResultExecuting(context);
            return;
        }

        bool? okField = null;
        string? symbolicCode = null;
        var hasErrorCodeAlready = false;

        foreach (var p in props)
        {
            if (string.Equals(p.Name, "errorCode", StringComparison.OrdinalIgnoreCase))
            {
                hasErrorCodeAlready = true;
            }
            else if (string.Equals(p.Name, "code", StringComparison.OrdinalIgnoreCase))
            {
                symbolicCode = p.GetValue(val) as string;
            }
            else if (string.Equals(p.Name, "ok", StringComparison.OrdinalIgnoreCase) && p.GetValue(val) is bool b1)
            {
                okField = b1;
            }
            else if (string.Equals(p.Name, "verified", StringComparison.OrdinalIgnoreCase) && p.GetValue(val) is bool b2 && okField == null)
            {
                okField = b2;
            }
        }

        var isErrorPayload = statusCode >= 400 || okField == false;
        if (!isErrorPayload || hasErrorCodeAlready)
        {
            base.OnResultExecuting(context);
            return;
        }

        var dict = new Dictionary<string, object?>(props.Length + 3, StringComparer.Ordinal);
        foreach (var p in props)
        {
            if (!p.CanRead || p.GetIndexParameters().Length > 0)
            {
                continue;
            }

            var camelName = p.Name.Length > 1 && char.IsUpper(p.Name[0]) && char.IsLower(p.Name[1])
                ? char.ToLowerInvariant(p.Name[0]) + p.Name.Substring(1)
                : p.Name;
            dict[camelName] = p.GetValue(val);
        }

        var resolvedCode = StreamFlixErrorCodes.Resolve(
            symbolicCode,
            statusCode >= 400 ? statusCode : 400,
            context.HttpContext.Request.Path.Value);

        if (!dict.ContainsKey("code") && !string.IsNullOrEmpty(symbolicCode))
        {
            dict["code"] = symbolicCode;
        }

        dict["errorCode"] = resolvedCode;
        dict["httpStatus"] = statusCode >= 400 ? statusCode : 200;
        objResult.Value = dict;

        base.OnResultExecuting(context);
    }
}
