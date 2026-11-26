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
    [InlineData("admin_profile_required", 403, "/StreamFlix/Profiles/Activate", StreamFlixErrorCodes.ProfileActivationForbidden)]
    [InlineData("profile_account_mismatch", 403, "/StreamFlix/Profiles/Activate", StreamFlixErrorCodes.ProfileActivationForbidden)]
    [InlineData("profile_protection_required", 403, "/StreamFlix/Profiles/Activate", StreamFlixErrorCodes.ProfileActivationForbidden)]
    [InlineData("guest_pass_permission_required", 403, "/StreamFlix/GuestPasses", StreamFlixErrorCodes.GuestPassRestricted)]
    [InlineData("seerr_permission_denied", 403, "/StreamFlix/Seerr/Request", StreamFlixErrorCodes.SeerrForbidden)]
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

    private sealed class FakePerm
    {
        public string Kind { get; set; } = string.Empty;

        public bool Value { get; set; }
    }

    private sealed class FakeUserEntity
    {
        public bool EnableAllFolders { get; set; }

        public List<FakePerm> Permissions { get; } = new();
    }

    [Fact]
    public void InitializeNewPluginUserPermissions_NeverGrantsContentDownloadingAndInheritsAdminRemoteAccess()
    {
        var restrictedAdmin = new FakeUserEntity();
        restrictedAdmin.Permissions.Add(new FakePerm { Kind = "EnableRemoteAccess", Value = false });

        var newUser = new FakeUserEntity();
        newUser.Permissions.Add(new FakePerm { Kind = "EnableMediaPlayback", Value = false });
        newUser.Permissions.Add(new FakePerm { Kind = "EnableContentDownloading", Value = false });
        newUser.Permissions.Add(new FakePerm { Kind = "EnableRemoteAccess", Value = false });

        var changed = StreamFlixStartupTask.InitializeNewPluginUserPermissions(newUser, restrictedAdmin);
        Assert.True(changed);
        Assert.True(newUser.EnableAllFolders);
        Assert.True(newUser.Permissions.Find(p => p.Kind == "EnableMediaPlayback")!.Value);
        Assert.False(newUser.Permissions.Find(p => p.Kind == "EnableContentDownloading")!.Value);
        Assert.False(newUser.Permissions.Find(p => p.Kind == "EnableRemoteAccess")!.Value);
    }

    [Theory]
    [InlineData("100.64.0.1", true, true)]
    [InlineData("100.101.202.42", true, true)]
    [InlineData("100.127.255.254", true, true)]
    [InlineData("100.101.202.42", false, false)]
    [InlineData("100.63.255.255", true, false)]
    [InlineData("100.128.0.1", true, false)]
    [InlineData("192.168.1.50", false, true)]
    [InlineData("8.8.8.8", true, false)]
    public void SessionService_IsPrivateOrLoopbackIp_HandlesTailscaleCgnatCorrectly(string ipStr, bool allowTailscale, bool expected)
    {
        var ip = System.Net.IPAddress.Parse(ipStr);
        Assert.Equal(expected, StreamFlixSessionService.IsPrivateOrLoopbackIp(ip, allowTailscale));
    }

    [Fact]
    public void IsPrimaryClaimedSsoOwner_DistinguishesPrimaryOwnerFromSecondaryHouseholdViewer()
    {
        var cfg = new PluginConfiguration
        {
            SessionSigningKey = Convert.ToBase64String(new byte[32] { 9, 8, 7, 6, 5, 4, 3, 2, 1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32 }),
            ApprovedGoogleAccounts = new List<string> { "owner@example.com", "viewer@example.com" },
            OidcRequireAllowlist = true,
            ApprovedOidcUsers = new List<string> { "oidc-owner@example.com", "oidc-member" },
        };

        var ownerGoogle = StreamFlixSessionService.Issue(cfg, "owner@example.com", out _);
        var memberGoogle = StreamFlixSessionService.Issue(cfg, "viewer@example.com", out _);
        Assert.True(StreamFlixController.IsPrimaryClaimedSsoOwner(cfg, ownerGoogle));
        Assert.False(StreamFlixController.IsPrimaryClaimedSsoOwner(cfg, memberGoogle));

        var ownerOidc = new StreamFlixSessionService.SessionInfo("oidc-owner@example.com", DateTimeOffset.UtcNow.AddDays(1), StreamFlixSessionService.AuthKindOidc, JellyfinUserId: "sub-1", Username: "owner_u");
        var memberOidc = new StreamFlixSessionService.SessionInfo(string.Empty, DateTimeOffset.UtcNow.AddDays(1), StreamFlixSessionService.AuthKindOidc, JellyfinUserId: "sub-2", Username: "oidc-member");
        Assert.True(StreamFlixController.IsPrimaryClaimedSsoOwner(cfg, ownerOidc));
        Assert.False(StreamFlixController.IsPrimaryClaimedSsoOwner(cfg, memberOidc));

        // Open OIDC (no allowlist) must never auto-claim primary owner admin status
        cfg.OidcRequireAllowlist = false;
        Assert.False(StreamFlixController.IsPrimaryClaimedSsoOwner(cfg, ownerOidc));
    }

    [Fact]
    public void LiveTvCompatibility_DefaultsToFalseAndRespectsExplicitUserPermissions()
    {
        var defaultCfg = new PluginConfiguration();
        Assert.False(defaultCfg.EnableLiveTv);

        var defaultReq = new SaveAdminConfigRequest();
        Assert.False(defaultReq.EnableLiveTv);

        var defaultProf = new StreamFlixProfileConfig();
        Assert.False(defaultProf.LiveTvPermissionInitialized);

        var allowedUser = new FakeUserEntity();
        allowedUser.Permissions.Add(new FakePerm { Kind = "EnableLiveTvAccess", Value = true });
        Assert.True(StreamFlixStartupTask.HasLiveTvAccessCompat(allowedUser));

        var deniedUser = new FakeUserEntity();
        deniedUser.Permissions.Add(new FakePerm { Kind = "EnableLiveTvAccess", Value = false });
        Assert.False(StreamFlixStartupTask.HasLiveTvAccessCompat(deniedUser));

        // Pre-existing plugin user with populated Permissions but no EnableLiveTvAccess entry yet:
        // Jellyfin's HasPermission evaluates missing permission rows as false until initialized.
        var preExistingPluginUser = new FakeUserEntity();
        preExistingPluginUser.Permissions.Add(new FakePerm { Kind = "EnableMediaPlayback", Value = true });
        Assert.False(StreamFlixStartupTask.HasLiveTvAccessCompat(preExistingPluginUser));

        // TrySetUserPermissionCompat flips an existing EnableLiveTvAccess row cleanly
        Assert.True(StreamFlixStartupTask.TrySetUserPermissionCompat(deniedUser, "EnableLiveTvAccess", true));
        Assert.True(StreamFlixStartupTask.HasLiveTvAccessCompat(deniedUser));
        Assert.False(StreamFlixStartupTask.TrySetUserPermissionCompat(deniedUser, "EnableLiveTvAccess", true));
        Assert.True(StreamFlixStartupTask.TrySetUserPermissionCompat(deniedUser, "EnableLiveTvAccess", false));
        Assert.False(StreamFlixStartupTask.HasLiveTvAccessCompat(deniedUser));
    }

    [Fact]
    public void NormalizeNavHiddenBuiltIns_PreservesLiveTvAndStripsInvalidEntries()
    {
        var normalized = StreamFlixController.NormalizeNavHiddenBuiltIns(
            new[] { "Series", " livetv ", "MOVIES", "unknown_tab", string.Empty, null, "LIVETV", "hot" });
        Assert.Equal(new[] { "series", "livetv", "movies", "hot" }, normalized);
        Assert.Empty(StreamFlixController.NormalizeNavHiddenBuiltIns(null));
    }

    [Fact]
    public void HeroTrailerPreviewAndHomeRows_DefaultEnabledAndNormalizeCleanly()
    {
        var defaultCfg = new PluginConfiguration();
        Assert.True(defaultCfg.EnableHeroTrailerPreview);
        Assert.False(defaultCfg.MigratedHeroYouTubeTrailers);
        Assert.Empty(defaultCfg.HomeRowOrder);
        Assert.Empty(defaultCfg.HomeHiddenRows);

        var defaultReq = new SaveAdminConfigRequest();
        Assert.True(defaultReq.EnableHeroTrailerPreview);

        var normalizedOrder = StreamFlixController.NormalizeHomeRowIds(
            new[] { " Movies ", "TOP10", "resume", "invalid_row", "movies", "LIVETV", string.Empty, null, "watchagain" });
        Assert.Equal(new[] { "movies", "top10", "resume", "livetv", "watchagain" }, normalizedOrder);
        Assert.Empty(StreamFlixController.NormalizeHomeRowIds(null));
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=zSWdZVtXT7E", "zSWdZVtXT7E")]
    [InlineData("https://m.youtube.com/watch?list=PL123&v=zSWdZVtXT7E&t=12s", "zSWdZVtXT7E")]
    [InlineData("https://youtu.be/zSWdZVtXT7E?si=abc123", "zSWdZVtXT7E")]
    [InlineData("https://www.youtube-nocookie.com/embed/zSWdZVtXT7E?autoplay=1", "zSWdZVtXT7E")]
    [InlineData("https://www.youtube.com/shorts/zSWdZVtXT7E", "zSWdZVtXT7E")]
    [InlineData("zSWdZVtXT7E", "zSWdZVtXT7E")]
    [InlineData("https://vimeo.com/123456789", null)]
    [InlineData("not-a-valid-id", null)]
    [InlineData("", null)]
    public void ExtractYouTubeVideoId_ParsesAllYouTubeFormatsStrictly(string raw, string? expected)
    {
        Assert.Equal(expected, StreamFlixController.ExtractYouTubeVideoId(raw));
    }

    [Fact]
    public void BuildYouTubeEmbedRelayHtml_IncludesError153ReferrerPolicyAndPostMessageBridge()
    {
        var html = StreamFlixController.BuildYouTubeEmbedRelayHtml("zSWdZVtXT7E", autoplay: true, mute: true, controls: false, loop: false, startSeconds: 10);
        Assert.Contains("meta name=\"referrer\" content=\"strict-origin-when-cross-origin\"", html);
        Assert.Contains("referrerpolicy=\"strict-origin-when-cross-origin\"", html);
        Assert.Contains("https://www.youtube-nocookie.com/embed/", html);
        Assert.Contains("autoplay=1&mute=1&controls=0", html);
        Assert.Contains("&start=10", html);
        Assert.Contains("streamflix-yt", html);
    }

    [Fact]
    public void RemoteStandardJellyfinLogin_AutoProvisionsScopedProfileAndEnforcesRemoteAccessFlag()
    {
        var cfg = new PluginConfiguration
        {
            AllowStandardJellyfinLogin = true,
            Profiles = new List<StreamFlixProfileConfig>
            {
                new()
                {
                    Id = "streamflix_owner",
                    Name = "Owner",
                    JellyfinUserId = Guid.NewGuid().ToString("N"),
                    JellyfinUsername = "admin",
                },
            },
        };

        // 1. Remote user with EnableRemoteAccess = true (default) is allowed and auto-provisions a Jellyfin-locked profile (#22)
        var remoteAllowedUser = new FakeUserEntity();
        remoteAllowedUser.Permissions.Add(new FakePerm { Kind = "EnableRemoteAccess", Value = true });
        Assert.True(StreamFlixStartupTask.HasRemoteAccessCompat(remoteAllowedUser));
        Assert.True(StreamFlixController.IsJellyfinUserAllowedStandardLogin(remoteAllowedUser, isLocalLan: false));

        var remoteUid = Guid.NewGuid();
        var (autoProf, changed1) = StreamFlixController.EnsureProfileForJellyfinUserNoLock(cfg, remoteUid, "RemoteFriend", isAdminUser: false);
        Assert.True(changed1);
        Assert.Equal(remoteUid.ToString("N"), autoProf.JellyfinUserId);
        Assert.Equal("RemoteFriend", autoProf.JellyfinUsername);
        Assert.False(autoProf.IsPluginCreatedJellyfinUser);
        Assert.True(autoProf.AutoProvisionedFromJellyfinLogin);
        Assert.Equal("jellyfin", autoProf.AccountLockKind);
        Assert.Equal("RemoteFriend", autoProf.GoogleAccountEmail);

        // Second login by same user reuses existing profile without creating duplicates
        var (reusedProf, changed2) = StreamFlixController.EnsureProfileForJellyfinUserNoLock(cfg, remoteUid, "RemoteFriend", isAdminUser: false);
        Assert.False(changed2);
        Assert.Same(autoProf, reusedProf);
        Assert.Equal(2, cfg.Profiles.Count);

        // Name collision with Owner appends (Jellyfin) cleanly without stealing streamflix_owner
        var secondUid = Guid.NewGuid();
        var (collisionProf, changed3) = StreamFlixController.EnsureProfileForJellyfinUserNoLock(cfg, secondUid, "Owner", isAdminUser: false);
        Assert.True(changed3);
        Assert.Equal("Owner (Jellyfin)", collisionProf.Name);

        // Unlinked household profile locked to Google/OIDC or another Jellyfin username must NOT be hijacked by a matching Jellyfin username
        var ssoLockedProf = new StreamFlixProfileConfig
        {
            Id = "streamflix_alex_sso",
            Name = "Alex",
            AccountLockKind = "google",
            GoogleAccountEmail = "alex@example.com",
        };
        cfg.Profiles.Add(ssoLockedProf);
        var alexJfUid = Guid.NewGuid();
        var (alexJfProf, changedAlex) = StreamFlixController.EnsureProfileForJellyfinUserNoLock(cfg, alexJfUid, "Alex", isAdminUser: false);
        Assert.True(changedAlex);
        Assert.NotSame(ssoLockedProf, alexJfProf);
        Assert.Null(ssoLockedProf.JellyfinUserId);
        Assert.Equal("Alex (Jellyfin)", alexJfProf.Name);
        Assert.Equal("jellyfin", alexJfProf.AccountLockKind);
        Assert.Equal("Alex", alexJfProf.GoogleAccountEmail);

        // Unlinked profile explicitly pre-locked to the same Jellyfin username links cleanly
        var preLockedJfProf = new StreamFlixProfileConfig
        {
            Id = "streamflix_sam_jf",
            Name = "Sam",
            AccountLockKind = "jellyfin",
            GoogleAccountEmail = "Sam",
        };
        cfg.Profiles.Add(preLockedJfProf);
        var samJfUid = Guid.NewGuid();
        var (linkedSamProf, changedSam) = StreamFlixController.EnsureProfileForJellyfinUserNoLock(cfg, samJfUid, "sam", isAdminUser: false);
        Assert.True(changedSam);
        Assert.Same(preLockedJfProf, linkedSamProf);
        Assert.Equal(samJfUid.ToString("N"), preLockedJfProf.JellyfinUserId);

        // 2. Remote user with EnableRemoteAccess = false is blocked on WAN, allowed on LAN
        var remoteBlockedUser = new FakeUserEntity();
        remoteBlockedUser.Permissions.Add(new FakePerm { Kind = "EnableRemoteAccess", Value = false });
        Assert.False(StreamFlixStartupTask.HasRemoteAccessCompat(remoteBlockedUser));
        Assert.False(StreamFlixController.IsJellyfinUserAllowedStandardLogin(remoteBlockedUser, isLocalLan: false));
        Assert.True(StreamFlixController.IsJellyfinUserAllowedStandardLogin(remoteBlockedUser, isLocalLan: true));

        // 3. Disabled user is blocked everywhere
        var disabledUser = new FakeUserEntity();
        disabledUser.Permissions.Add(new FakePerm { Kind = "IsDisabled", Value = true });
        Assert.False(StreamFlixController.IsJellyfinUserAllowedStandardLogin(disabledUser, isLocalLan: true));
        Assert.False(StreamFlixController.IsJellyfinUserAllowedStandardLogin(disabledUser, isLocalLan: false));
    }

    [Fact]
    public void ResolveWatchPartyProfile_BlocksUnactivatedCallerFromSpoofingHostProfile()
    {
        var ownerProfile = new StreamFlixProfileConfig
        {
            Id = "streamflix_owner",
            Name = "Owner",
            JellyfinUserId = Guid.NewGuid().ToString("N"),
        };
        var guestLockedProfile = new StreamFlixProfileConfig
        {
            Id = "streamflix_guest_prof",
            Name = "Guest Viewer",
            JellyfinUserId = Guid.NewGuid().ToString("N"),
        };
        var cfg = new PluginConfiguration
        {
            Profiles = new List<StreamFlixProfileConfig> { ownerProfile, guestLockedProfile },
        };

        // Non-admin caller without an active Jellyfin user session must NEVER resolve an arbitrary requested profile
        var unactivatedLanCaller = new StreamFlixController.CallerContext(
            Session: null,
            IsJellyfinAuthenticated: false,
            IsAdmin: false,
            IsLocalLan: true,
            JellyfinUser: null);
        Assert.Null(StreamFlixController.ResolveWatchPartyProfile(cfg, unactivatedLanCaller, "streamflix_owner"));

        // Guest Pass session always resolves strictly to its own LockedProfileId even if another profileId is requested
        var guestSession = new StreamFlixSessionService.SessionInfo(
            string.Empty,
            DateTimeOffset.UtcNow.AddHours(4),
            StreamFlixSessionService.AuthKindGuestPass,
            GuestPassId: "gp_1",
            LockedProfileId: "streamflix_guest_prof");
        var guestCaller = new StreamFlixController.CallerContext(
            Session: guestSession,
            IsJellyfinAuthenticated: false,
            IsAdmin: false,
            IsLocalLan: false,
            JellyfinUser: null);
        Assert.Same(guestLockedProfile, StreamFlixController.ResolveWatchPartyProfile(cfg, guestCaller, "streamflix_owner"));

        // Active administrator can resolve the requested profile cleanly
        var adminCaller = new StreamFlixController.CallerContext(
            Session: null,
            IsJellyfinAuthenticated: true,
            IsAdmin: true,
            IsLocalLan: true,
            JellyfinUser: null);
        Assert.Same(ownerProfile, StreamFlixController.ResolveWatchPartyProfile(cfg, adminCaller, "streamflix_owner"));

        // Symbolic Watch Party error codes resolve cleanly
        Assert.Equal(StreamFlixErrorCodes.WatchPartyForbidden, StreamFlixErrorCodes.Resolve("watchparty_disabled", 403, "/StreamFlix/WatchParty/Create"));
        Assert.Equal(StreamFlixErrorCodes.WatchPartyForbidden, StreamFlixErrorCodes.Resolve("kids_forbidden", 403, "/StreamFlix/WatchParty/Join"));
        Assert.Equal(StreamFlixErrorCodes.NotFoundGeneric, StreamFlixErrorCodes.Resolve("item_not_found", 404, "/StreamFlix/Trailers/Resolve"));
    }

    [Fact]
    public void ErrorEnvelope_PreservesNormalTrailerNoneLookupWithoutInjectingErrorCode()
    {
        var filter = new StreamFlixErrorEnvelopeAttribute();
        var httpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        httpContext.Request.Path = "/StreamFlix/Trailers/Resolve";
        var actionContext = new Microsoft.AspNetCore.Mvc.ActionContext(
            httpContext,
            new Microsoft.AspNetCore.Routing.RouteData(),
            new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor());

        // Normal 200 OK { ok = false, kind = "none" } when a title has no trailer must NOT be rewritten with SF-REQ-740
        var nonePayload = new { ok = false, kind = "none" };
        var okResult = new Microsoft.AspNetCore.Mvc.OkObjectResult(nonePayload);
        var okExecuting = new Microsoft.AspNetCore.Mvc.Filters.ResultExecutingContext(
            actionContext,
            new List<Microsoft.AspNetCore.Mvc.Filters.IFilterMetadata>(),
            okResult,
            controller: new object());
        filter.OnResultExecuting(okExecuting);
        Assert.Same(nonePayload, ((Microsoft.AspNetCore.Mvc.ObjectResult)okExecuting.Result).Value);

        // Real 404 { ok = false, code = "item_not_found" } still receives canonical errorCode enrichment
        var notFoundResult = new Microsoft.AspNetCore.Mvc.NotFoundObjectResult(new { ok = false, code = "item_not_found", message = "Media item was not found." });
        var errExecuting = new Microsoft.AspNetCore.Mvc.Filters.ResultExecutingContext(
            actionContext,
            new List<Microsoft.AspNetCore.Mvc.Filters.IFilterMetadata>(),
            notFoundResult,
            controller: new object());
        filter.OnResultExecuting(errExecuting);
        var enriched = Assert.IsType<Dictionary<string, object?>>(((Microsoft.AspNetCore.Mvc.ObjectResult)errExecuting.Result).Value);
        Assert.Equal(StreamFlixErrorCodes.NotFoundGeneric, enriched["errorCode"]);
        Assert.Equal(404, enriched["httpStatus"]);
    }

    [Fact]
    public void HomePreferences_OrderedViewsAndHomeSectionsRespectUserConfiguration()
    {
        var gMovies = Guid.Parse("10000000-0000-0000-0000-000000000001");
        var gShows = Guid.Parse("20000000-0000-0000-0000-000000000002");
        var gAnimeMovies = Guid.Parse("30000000-0000-0000-0000-000000000003");
        var gAnimeShows = Guid.Parse("40000000-0000-0000-0000-000000000004");
        var gUnrankedDocs = Guid.Parse("50000000-0000-0000-0000-000000000005");

        var folders = new[]
        {
            (Id: gAnimeMovies, Name: "Anime Movies"),
            (Id: gAnimeShows, Name: "Anime Shows"),
            (Id: gUnrankedDocs, Name: "Documentaries"),
            (Id: gMovies, Name: "Movies"),
            (Id: gShows, Name: "TV Shows"),
        };

        // User configured Library Order: Anime Shows -> Movies -> Anime Movies -> TV Shows (with Documentaries newly added & unranked)
        var orderedViews = new[]
        {
            gAnimeShows.ToString("D"),
            gMovies.ToString("N"),
            gAnimeMovies.ToString("N"),
            gShows.ToString("D"),
        };

        var sorted = JellyfinCompat.SortItemsByOrderedViews(
            folders,
            orderedViews,
            f => f.Id,
            f => f.Name);

        Assert.Equal(
            new[] { "Anime Shows", "Movies", "Anime Movies", "TV Shows", "Documentaries" },
            sorted.Select(f => f.Name).ToArray());

        // Empty CustomPrefs -> HasCustomSections is false so default layout applies
        var emptyParsed = JellyfinCompat.ParseHomeSectionsFromCustomPrefs(new Dictionary<string, string?>
        {
            ["chromecastVersion"] = "stable",
        });
        Assert.False(emptyParsed.HasCustomSections);
        Assert.Empty(emptyParsed.Sections);

        // Configured Home Screen Sections 1–9 (Issue #23 user configuration)
        var customParsed = JellyfinCompat.ParseHomeSectionsFromCustomPrefs(new Dictionary<string, string?>
        {
            ["homesection0"] = "librarybuttons",
            ["homesection1"] = "resume",
            ["homesection2"] = "nextup",
            ["homesection3"] = "latestmedia",
            ["homesection4"] = "resumebook",
            ["homesection5"] = "livetv",
            ["homesection6"] = "resumeaudio",
            ["homesection7"] = "none",
            ["homesection8"] = "none",
        });
        Assert.True(customParsed.HasCustomSections);
        Assert.Equal(
            new[]
            {
                "smalllibrarytiles",
                "resume",
                "nextup",
                "latestmedia",
                "resumebook",
                "livetv",
                "resumeaudio",
                "none",
                "none",
                "none",
            },
            customParsed.Sections);
    }

    [Theory]
    [InlineData("oled", "oled")]
    [InlineData("  GLASS ", "glass")]
    [InlineData("Midnight", "midnight")]
    [InlineData("netflix", "netflix")]
    [InlineData("invalid_theme", "netflix")]
    [InlineData("", "netflix")]
    [InlineData(null, "netflix")]
    public void NormalizeVisualPreset_ValidatesAndFallsBackToNetflix(string? input, string expected)
    {
        Assert.Equal(expected, StreamFlixController.NormalizeVisualPreset(input));
    }

    [Theory]
    [InlineData("compact", "compact")]
    [InlineData("  LARGE ", "large")]
    [InlineData("Standard", "standard")]
    [InlineData("huge", "standard")]
    [InlineData("", "standard")]
    [InlineData(null, "standard")]
    public void NormalizeCardDensity_ValidatesAndFallsBackToStandard(string? input, string expected)
    {
        Assert.Equal(expected, StreamFlixController.NormalizeCardDensity(input));
    }

    [Fact]
    public void PluginConfiguration_DefaultsForV099Features_AreEnabledAndStandard()
    {
        var cfg = new PluginConfiguration();
        Assert.True(cfg.EnableRichDetailBadges);
        Assert.True(cfg.EnableSkipIntro);
        Assert.Equal("netflix", cfg.VisualPreset);
        Assert.Equal("standard", cfg.CardDensity);
        Assert.False(Plugin.HasMeaningfulUserConfig(cfg));

        // Customizing any v0.9.9 setting marks configuration as meaningful for shadow backup persistence
        var presetCfg = new PluginConfiguration { VisualPreset = "oled" };
        Assert.True(Plugin.HasMeaningfulUserConfig(presetCfg));

        var densityCfg = new PluginConfiguration { CardDensity = "large" };
        Assert.True(Plugin.HasMeaningfulUserConfig(densityCfg));

        var skipDisabledCfg = new PluginConfiguration { EnableSkipIntro = false };
        Assert.True(Plugin.HasMeaningfulUserConfig(skipDisabledCfg));

        var badgesDisabledCfg = new PluginConfiguration { EnableRichDetailBadges = false };
        Assert.True(Plugin.HasMeaningfulUserConfig(badgesDisabledCfg));
    }
}
