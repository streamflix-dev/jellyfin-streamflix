using System;
using System.Collections.Generic;
using Jellyfin.Plugin.StreamFlix.Configuration;
using Jellyfin.Plugin.StreamFlix.Controllers;
using Jellyfin.Plugin.StreamFlix.Services;
using Xunit;

namespace Jellyfin.Plugin.StreamFlix.Tests;

public class StreamFlixCoreTests
{
    [Theory]
    [InlineData("google_required", 401, "/StreamFlix/PublicConfig", StreamFlixErrorCodes.HouseholdSignInRequired)]
    [InlineData("profile_unlinked", 409, "/StreamFlix/Profiles/Activate", StreamFlixErrorCodes.ProfileUnlinked)]
    [InlineData("pin_invalid", 403, "/StreamFlix/Profiles/VerifyPin", StreamFlixErrorCodes.PinInvalid)]
    [InlineData("pin_locked", 429, "/StreamFlix/Profiles/Activate", StreamFlixErrorCodes.PinLockedOut)]
    [InlineData("seerr_timeout", 504, "/StreamFlix/Seerr/Search", StreamFlixErrorCodes.SeerrTimeout)]
    [InlineData("seerr_quota_exceeded", 429, "/StreamFlix/Seerr/Request", StreamFlixErrorCodes.SeerrQuotaExceeded)]
    [InlineData("admin_required", 403, "/StreamFlix/AdminConfig", StreamFlixErrorCodes.AdminRequired)]
    [InlineData(null, 502, "/StreamFlix/Seerr/Details/movie/123", StreamFlixErrorCodes.SeerrUnreachable)]
    [InlineData(null, 500, "/StreamFlix/Hub/Bootstrap", StreamFlixErrorCodes.HubBootstrapFailed)]
    public void ErrorCodes_Resolve_ReturnsExpectedCanonicalCode(string? symbolic, int status, string path, string expected)
    {
        var actual = StreamFlixErrorCodes.Resolve(symbolic, status, path);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void SessionService_IssueAndValidate_RejectsTamperingAndVersionBump()
    {
        var cfg = new PluginConfiguration
        {
            SessionSigningKey = Convert.ToBase64String(new byte[32] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32 }),
            SessionLifetimeDays = 7,
            SessionVersion = 1,
            ApprovedGoogleAccounts = new List<string> { "viewer@example.com" },
        };

        var issued = StreamFlixSessionService.Issue(cfg, "viewer@example.com", out var token);
        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.True(issued.ExpiresAt > DateTimeOffset.UtcNow.AddDays(6));

        var valid = StreamFlixSessionService.Validate(cfg, token);
        Assert.NotNull(valid);
        Assert.Equal("viewer@example.com", valid!.Email);

        // Tamper signature byte
        var tampered = token.Substring(0, token.Length - 2) + (token.EndsWith("AA", StringComparison.Ordinal) ? "BB" : "AA");
        Assert.Null(StreamFlixSessionService.Validate(cfg, tampered));

        // Revoke all sessions via SessionVersion increment
        cfg.SessionVersion = 2;
        Assert.Null(StreamFlixSessionService.Validate(cfg, token));
    }

    [Fact]
    public void SessionService_OidcAllowlist_NeverMatchesUnverifiedEmailShapedUsername()
    {
        var cfg = new PluginConfiguration
        {
            OidcRequireAllowlist = true,
            ApprovedOidcUsers = new List<string> { "owner@example.com", "trusted_user" },
        };

        // Unverified username shaped like an email must NOT match email allowlist entry
        Assert.False(StreamFlixSessionService.IsOidcUserApproved(cfg, email: null, username: "owner@example.com", subject: "sub-999"));

        // Verified email matches email allowlist entry
        Assert.True(StreamFlixSessionService.IsOidcUserApproved(cfg, email: "owner@example.com", username: "any", subject: "sub-1"));

        // Plain username matches non-email allowlist entry
        Assert.True(StreamFlixSessionService.IsOidcUserApproved(cfg, email: null, username: "trusted_user", subject: "sub-2"));
    }

    [Theory]
    [InlineData("20:30", "20:30")]
    [InlineData("  06:05 ", "06:05")]
    [InlineData("24:00", "")]
    [InlineData("9:30", "")]
    [InlineData("invalid", "")]
    [InlineData(null, "")]
    public void NormalizeTimeString_ValidatesStrict24HourFormat(string? raw, string expected)
    {
        Assert.Equal(expected, StreamFlixController.NormalizeTimeString(raw));
    }

    [Fact]
    public void OidcService_BuildDiscoveryUrl_NormalizesTrailingSlashAndWellKnownSuffix()
    {
        Assert.Equal(
            "https://sso.example.com/application/o/jellyfin/.well-known/openid-configuration",
            StreamFlixOidcService.BuildDiscoveryUrl("https://sso.example.com/application/o/jellyfin/"));

        Assert.Equal(
            "https://sso.example.com/.well-known/openid-configuration",
            StreamFlixOidcService.BuildDiscoveryUrl("https://sso.example.com/.well-known/openid-configuration"));
    }
}
