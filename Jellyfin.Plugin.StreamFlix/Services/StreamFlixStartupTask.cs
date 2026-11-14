using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.StreamFlix.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

#if JF1011 || JF12
using JUser = Jellyfin.Database.Implementations.Entities.User;
#else
using JUser = Jellyfin.Data.Entities.User;
#endif

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Startup task and cross-version user synchronization helper that provisions real Jellyfin Server Users
/// for every StreamFlix profile so each profile has its own
/// independent Watch History, Continue Watching, Next Up, and Favorites on the Jellyfin server.
/// </summary>
public class StreamFlixStartupTask : IScheduledTask
{
    private static readonly string[] DefaultColors =
    {
        "#E50914", "#1E88E5", "#43A047", "#8E24AA", "#FB8C00", "#00ACC1", "#3949AB", "#D81B60",
    };

    private static readonly string[] DefaultEmojis =
    {
        "👑", "🍿", "🦊", "🚀", "🎬", "🎮", "⚡", "🔥",
    };

    // Compatibility shim for Jellyfin 10.11.9+ (which replaced IUserManager.Users with IUserManager.GetUsers())
    private static readonly Lazy<MethodInfo?> GetUsersMethod = new(() =>
        typeof(IUserManager).GetMethod("GetUsers", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null));

    private static readonly Lazy<PropertyInfo?> UsersProperty = new(() =>
        typeof(IUserManager).GetProperty("Users", BindingFlags.Public | BindingFlags.Instance));

    // Compatibility shim for IUserManager.AuthenticateUser:
    // Jellyfin 10.11 / 12.x -> AuthenticateUser(string username, string password, string remoteEndPoint, bool isUserSession)
    // Jellyfin 10.9 / 10.10 -> AuthenticateUser(string username, string password, string passwordSha1, string remoteEndPoint, bool isUserSession)
    private static readonly Lazy<MethodInfo?> AuthUser4Method = new(() =>
        typeof(IUserManager).GetMethod("AuthenticateUser", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string), typeof(string), typeof(string), typeof(bool) }, null));

    private static readonly Lazy<MethodInfo?> AuthUser5Method = new(() =>
        typeof(IUserManager).GetMethod("AuthenticateUser", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string), typeof(string), typeof(string), typeof(string), typeof(bool) }, null));

    private static readonly object ExtSetPermLock = new();
    private static MethodInfo? _cachedExtSetPermMethod;
    private static bool _extSetPermSearched;

    private readonly IUserManager _userManager;
    private readonly ILogger<StreamFlixStartupTask> _logger;

    public StreamFlixStartupTask(IUserManager userManager, ILogger<StreamFlixStartupTask> logger)
    {
        _userManager = userManager;
        _logger = logger;
    }

    public string Name => "StreamFlix Startup & Server Profile Sync";

    public string Key => "StreamFlixStartupProfileSync";

    public string Description =>
        "Provisions real Jellyfin Server Users for every StreamFlix profile so each profile has separate watch history, and injects the StreamFlix UI.";

    public string Category => "StreamFlix";

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        progress.Report(10);
        Plugin.Instance?.InjectScriptIntoDiskIndexIfWritable();
        progress.Report(40);

        var config = Plugin.Instance?.Configuration;
        if (config != null)
        {
            await SyncAllProfilesWithJellyfinUsersAsync(_userManager, config, _logger).ConfigureAwait(false);
            Plugin.Instance?.SaveConfiguration();
        }

        progress.Report(100);
    }

    /// <summary>
    /// Creates a dedicated non-administrator Jellyfin Server User for a StreamFlix profile and immediately assigns a
    /// cryptographically randomized 256-bit password so plugin-provisioned accounts are never left with a blank password.
    /// Pre-existing / user-created Jellyfin accounts are never touched by this method.
    /// </summary>
    public static async Task<JUser> CreatePluginManagedUserAsync(
        IUserManager userManager,
        string username,
        ILogger? logger = null)
    {
        var user = await userManager.CreateUserAsync(username).ConfigureAwait(false);
        await RandomizePluginUserPasswordAsync(userManager, user, logger).ConfigureAwait(false);
        return userManager.GetUserById(user.Id) ?? user;
    }

    /// <summary>
    /// Assigns a cryptographically randomized 256-bit password to a plugin-created Jellyfin user via <see cref="IUserManager.ChangePassword"/>.
    /// </summary>
    public static async Task RandomizePluginUserPasswordAsync(
        IUserManager userManager,
        JUser user,
        ILogger? logger = null)
    {
        if (user == null || IsUserAdminCompat(user))
        {
            return;
        }

        var randomPassword = "Sfx!" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_') + "9a";

        try
        {
            var byGuid = typeof(IUserManager).GetMethod("ChangePassword", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(Guid), typeof(string) }, null)
                ?? userManager.GetType().GetMethod("ChangePassword", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(Guid), typeof(string) }, null);
            if (byGuid != null)
            {
                if (byGuid.Invoke(userManager, new object[] { user.Id, randomPassword }) is Task tGuid)
                {
                    await tGuid.ConfigureAwait(false);
                    return;
                }
            }

            var byUser = typeof(IUserManager).GetMethod("ChangePassword", BindingFlags.Public | BindingFlags.Instance, null, new[] { user.GetType(), typeof(string) }, null)
                ?? userManager.GetType().GetMethod("ChangePassword", BindingFlags.Public | BindingFlags.Instance, null, new[] { user.GetType(), typeof(string) }, null);
            if (byUser != null)
            {
                if (byUser.Invoke(userManager, new object[] { user, randomPassword }) is Task tUser)
                {
                    await tUser.ConfigureAwait(false);
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "StreamFlix: could not assign randomized password to plugin-created Jellyfin user '{Username}'.", user.Username);
        }
    }

    private static bool UserHasEmptyPasswordCompat(object? user)
    {
        if (user == null)
        {
            return false;
        }

        try
        {
            var pwdProp = user.GetType().GetProperty("Password", BindingFlags.Public | BindingFlags.Instance);
            if (pwdProp != null)
            {
                return string.IsNullOrEmpty(pwdProp.GetValue(user) as string);
            }
        }
        catch
        {
        }

        return false;
    }

    /// <summary>
    /// Returns all Jellyfin users across both Jellyfin &lt;=10.11.8 (<c>IUserManager.Users</c> property)
    /// and Jellyfin 10.11.9+ (<c>IUserManager.GetUsers()</c> method) without triggering a JIT MissingMethodException.
    /// </summary>
    public static IReadOnlyList<JUser> GetAllUsersCompat(IUserManager userManager)
    {
        try
        {
            var method = GetUsersMethod.Value
                ?? userManager.GetType().GetMethod("GetUsers", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (method != null && method.Invoke(userManager, null) is IEnumerable<JUser> fromMethod)
            {
                return fromMethod.ToList();
            }

            var prop = UsersProperty.Value
                ?? userManager.GetType().GetProperty("Users", BindingFlags.Public | BindingFlags.Instance);
            if (prop != null && prop.GetValue(userManager) is IEnumerable<JUser> fromProp)
            {
                return fromProp.ToList();
            }
        }
        catch
        {
        }

        return Array.Empty<JUser>();
    }

    /// <summary>
    /// Verifies a Jellyfin username and password across Jellyfin 10.9/10.10 (5-arg overload) and Jellyfin 10.11/12.x
    /// (4-arg overload) without minting a session token, returning null on invalid credentials or disabled accounts.
    /// </summary>
    public static async Task<JUser?> AuthenticateUserCompatAsync(
        IUserManager userManager,
        string username,
        string password,
        string remoteEndPoint,
        ILogger? logger = null)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return null;
        }

        try
        {
            var cleanUser = username.Trim();
            var pwd = password ?? string.Empty;
            var ep = string.IsNullOrWhiteSpace(remoteEndPoint) ? "127.0.0.1" : remoteEndPoint;

            Task? invokeTask = null;
            var m4 = AuthUser4Method.Value
                ?? userManager.GetType().GetMethod("AuthenticateUser", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string), typeof(string), typeof(string), typeof(bool) }, null);
            if (m4 != null)
            {
                invokeTask = m4.Invoke(userManager, new object[] { cleanUser, pwd, ep, true }) as Task;
            }
            else
            {
                var m5 = AuthUser5Method.Value
                    ?? userManager.GetType().GetMethod("AuthenticateUser", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string), typeof(string), typeof(string), typeof(string), typeof(bool) }, null);
                if (m5 != null)
                {
                    var sha1Hex = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(pwd))).ToLowerInvariant();
                    invokeTask = m5.Invoke(userManager, new object[] { cleanUser, pwd, sha1Hex, ep, true }) as Task;
                }
            }

            if (invokeTask == null)
            {
                return null;
            }

            await invokeTask.ConfigureAwait(false);
            var resultProp = invokeTask.GetType().GetProperty("Result", BindingFlags.Public | BindingFlags.Instance);
            var user = resultProp?.GetValue(invokeTask) as JUser;
            if (user == null)
            {
                return null;
            }

            if (IsUserDisabledCompat(user))
            {
                return null;
            }

            return user;
        }
        catch (TargetInvocationException tie)
        {
            logger?.LogDebug(tie.InnerException ?? tie, "StreamFlix: Jellyfin credential verification failed for '{Username}'.", username);
            return null;
        }
        catch (Exception ex)
        {
            logger?.LogDebug(ex, "StreamFlix: Jellyfin credential verification failed for '{Username}'.", username);
            return null;
        }
    }

    /// <summary>
    /// Checks whether a Jellyfin user entity has <c>PermissionKind.IsAdministrator</c> enabled.
    /// </summary>
    public static bool IsUserAdminCompat(object? user)
    {
        if (user == null)
        {
            return false;
        }

        try
        {
            var permsProp = user.GetType().GetProperty("Permissions", BindingFlags.Public | BindingFlags.Instance);
            if (permsProp?.GetValue(user) is IEnumerable perms)
            {
                foreach (var perm in perms)
                {
                    if (perm == null)
                    {
                        continue;
                    }

                    var kindProp = perm.GetType().GetProperty("Kind", BindingFlags.Public | BindingFlags.Instance);
                    var valProp = perm.GetType().GetProperty("Value", BindingFlags.Public | BindingFlags.Instance);
                    var kindObj = kindProp?.GetValue(perm);
                    var valObj = valProp?.GetValue(perm);
                    if (kindObj != null && valObj is bool isTrue && isTrue)
                    {
                        if (string.Equals(kindObj.ToString(), "IsAdministrator", StringComparison.OrdinalIgnoreCase)
                            || Convert.ToInt32(kindObj) == 0)
                        {
                            return true;
                        }
                    }
                }
            }

            // Fallback: check HasPermission(PermissionKind.IsAdministrator) on the user instance
            var hasPermMethod = user.GetType().GetMethod("HasPermission", BindingFlags.Public | BindingFlags.Instance);
            if (hasPermMethod != null)
            {
                var ps = hasPermMethod.GetParameters();
                if (ps.Length == 1 && ps[0].ParameterType.IsEnum)
                {
                    if (Enum.TryParse(ps[0].ParameterType, "IsAdministrator", ignoreCase: true, out var adminEnum) && adminEnum != null)
                    {
                        if (hasPermMethod.Invoke(user, new[] { adminEnum }) is bool hasAdmin && hasAdmin)
                        {
                            return true;
                        }
                    }
                }
            }
        }
        catch
        {
        }

        return false;
    }

    /// <summary>
    /// Checks whether a Jellyfin user entity has <c>PermissionKind.IsDisabled</c> enabled.
    /// </summary>
    public static bool IsUserDisabledCompat(object? user)
    {
        if (user == null)
        {
            return false;
        }

        try
        {
            var permsProp = user.GetType().GetProperty("Permissions", BindingFlags.Public | BindingFlags.Instance);
            if (HasUserPermissionCompat(user, permsProp, "IsDisabled"))
            {
                return true;
            }

            var hasPermMethod = user.GetType().GetMethod("HasPermission", BindingFlags.Public | BindingFlags.Instance);
            if (hasPermMethod != null)
            {
                var ps = hasPermMethod.GetParameters();
                if (ps.Length == 1 && ps[0].ParameterType.IsEnum
                    && Enum.TryParse(ps[0].ParameterType, "IsDisabled", ignoreCase: true, out var disabledEnum)
                    && disabledEnum != null
                    && hasPermMethod.Invoke(user, new[] { disabledEnum }) is bool isDisabled
                    && isDisabled)
                {
                    return true;
                }
            }
        }
        catch
        {
        }

        return false;
    }

    public static long GetInternalIdCompat(object? user)
    {
        if (user == null)
        {
            return long.MaxValue;
        }

        try
        {
            var prop = user.GetType().GetProperty("InternalId", BindingFlags.Public | BindingFlags.Instance);
            if (prop?.GetValue(user) is long id && id > 0)
            {
                return id;
            }
        }
        catch
        {
        }

        return long.MaxValue;
    }

    /// <summary>
    /// Finds the primary Administrator user on the Jellyfin server (created during initial server setup).
    /// </summary>
    public static JUser? GetPrimaryAdminUserCompat(IUserManager userManager)
    {
        var all = GetAllUsersCompat(userManager);
        if (all.Count == 0)
        {
            return null;
        }

        return all
            .OrderByDescending(u => IsUserAdminCompat(u))
            .ThenBy(u => GetInternalIdCompat(u))
            .FirstOrDefault();
    }

    /// <summary>
    /// Deletes a Jellyfin user across both Jellyfin 10.9/10.10 and Jellyfin 10.11 (supports DeleteUserAsync(Guid) and DeleteUserAsync(User)).
    /// </summary>
    public static async Task DeleteJellyfinUserCompatAsync(IUserManager userManager, Guid userId, ILogger? logger = null)
    {
        try
        {
            var user = userManager.GetUserById(userId);
            if (user == null || IsUserAdminCompat(user))
            {
                return;
            }

            var deleteByGuid = typeof(IUserManager).GetMethod("DeleteUserAsync", new[] { typeof(Guid) })
                ?? userManager.GetType().GetMethod("DeleteUserAsync", new[] { typeof(Guid) });
            if (deleteByGuid != null)
            {
                if (deleteByGuid.Invoke(userManager, new object[] { userId }) is Task t1)
                {
                    await t1.ConfigureAwait(false);
                    return;
                }
            }

            var deleteByUser = typeof(IUserManager).GetMethod("DeleteUserAsync", new[] { user.GetType() })
                ?? userManager.GetType().GetMethod("DeleteUserAsync", new[] { user.GetType() });
            if (deleteByUser != null)
            {
                if (deleteByUser.Invoke(userManager, new object[] { user }) is Task t2)
                {
                    await t2.ConfigureAwait(false);
                }
            }
        }
        catch (Exception ex)
        {
            logger?.LogDebug(ex, "StreamFlix: could not delete Jellyfin user {UserId}.", userId);
        }
    }

    /// <summary>
    /// Returns true for the built-in owner profile, which is always bound to the primary administrator.
    /// </summary>
    public static bool IsOwnerProfile(StreamFlixProfileConfig? profile)
    {
        return profile != null && string.Equals(profile.Id, "streamflix_owner", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Returns true when another StreamFlix profile (not <paramref name="profile"/>) is already linked to the given Jellyfin user.
    /// </summary>
    public static bool IsUserLinkedToOtherProfile(PluginConfiguration config, StreamFlixProfileConfig? profile, Guid userId)
    {
        var n = userId.ToString("N");
        return (config.Profiles ?? new List<StreamFlixProfileConfig>())
            .Any(p => !ReferenceEquals(p, profile) && string.Equals(p.JellyfinUserId, n, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Finds an existing Jellyfin user by name for an unlinked profile, but only when it is safe to do so:
    /// administrator accounts are only ever matched for the owner profile, and accounts that already belong to
    /// another profile are never matched. This stops a household member from creating or renaming a profile after
    /// an administrator (or another person) and inheriting that account.
    /// </summary>
    public static JUser? FindSafeUserByName(IUserManager userManager, PluginConfiguration config, StreamFlixProfileConfig profile, params string?[] names)
    {
        var isOwner = IsOwnerProfile(profile);
        foreach (var raw in names)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            var clean = raw.Trim();
            var u = userManager.GetUserByName(clean)
                ?? GetAllUsersCompat(userManager).FirstOrDefault(usr => string.Equals(usr.Username, clean, StringComparison.OrdinalIgnoreCase));
            if (u == null)
            {
                continue;
            }

            if (!isOwner && IsUserAdminCompat(u))
            {
                continue;
            }

            if (IsUserLinkedToOtherProfile(config, profile, u.Id))
            {
                continue;
            }

            return u;
        }

        return null;
    }

    /// <summary>
    /// Returns a Jellyfin username based on <paramref name="baseName"/> that isn't taken yet ("Alex", "Alex 2", ...),
    /// sanitizing punctuation/emojis that Jellyfin's UserManager rejects and checking case-insensitively for Jellyfin 12+.
    /// </summary>
    public static string GetAvailableUsername(IUserManager userManager, string? baseName)
    {
        var sanitized = SanitizeJellyfinUsername(baseName);
        var existingNames = new HashSet<string>(
            GetAllUsersCompat(userManager)
                .Select(u => u.Username)
                .Where(n => !string.IsNullOrWhiteSpace(n)),
            StringComparer.OrdinalIgnoreCase);

        bool IsTaken(string candidate) =>
            existingNames.Contains(candidate) || userManager.GetUserByName(candidate) != null;

        if (!IsTaken(sanitized))
        {
            return sanitized;
        }

        for (var i = 2; i < 100; i++)
        {
            var candidate = $"{sanitized} {i}";
            if (!IsTaken(candidate))
            {
                return candidate;
            }
        }

        return $"{sanitized} {Guid.NewGuid().ToString("N").Substring(0, 6)}";
    }

    private static string SanitizeJellyfinUsername(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "Profile";
        }

        var sb = new System.Text.StringBuilder(raw.Length);
        var prevSpace = false;
        foreach (var ch in raw.Trim())
        {
            if (char.IsLetterOrDigit(ch) || ch == '_' || ch == '-' || ch == '.' || ch == '\'')
            {
                sb.Append(ch);
                prevSpace = false;
            }
            else if (char.IsWhiteSpace(ch) || ch == '/' || ch == '\\' || ch == '&' || ch == '+')
            {
                if (!prevSpace && sb.Length > 0)
                {
                    sb.Append(' ');
                    prevSpace = true;
                }
            }
        }

        var cleaned = sb.ToString().Trim(' ', '.', '-', '_');
        if (cleaned.Length > 48)
        {
            cleaned = cleaned.Substring(0, 48).TrimEnd();
        }

        return string.IsNullOrWhiteSpace(cleaned) ? "Profile" : cleaned;
    }

    public static async Task SyncAllProfilesWithJellyfinUsersAsync(
        IUserManager userManager,
        PluginConfiguration config,
        ILogger? logger = null,
        bool allowCreateMissingUsers = false)
    {
        try
        {
            config.ApprovedGoogleAccounts ??= new List<string>();
            config.Profiles ??= new List<StreamFlixProfileConfig>();
            config.DeletedProfileIds ??= new List<string>();

            var deletedSet = new HashSet<string>(
                config.DeletedProfileIds.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()),
                StringComparer.OrdinalIgnoreCase);

            var primaryAdmin = GetPrimaryAdminUserCompat(userManager);
            var allUsers = GetAllUsersCompat(userManager);

            // Deduplicate ApprovedGoogleAccounts
            config.ApprovedGoogleAccounts = config.ApprovedGoogleAccounts
                .Where(e => !string.IsNullOrWhiteSpace(e))
                .Select(e => e.Trim().ToLowerInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Filter out any deleted profiles and deduplicate by Id while strictly preserving user-defined order
            if (config.Profiles.Count > 0)
            {
                var seenIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var ordered = new List<StreamFlixProfileConfig>();
                foreach (var p in config.Profiles)
                {
                    if (p == null || string.IsNullOrWhiteSpace(p.Name))
                    {
                        continue;
                    }

                    if (deletedSet.Contains(p.Id))
                    {
                        continue;
                    }

                    if (string.IsNullOrWhiteSpace(p.Id))
                    {
                        p.Id = $"streamflix_{Guid.NewGuid():N}";
                    }

                    if (seenIds.Add(p.Id))
                    {
                        ordered.Add(p);
                    }
                }

                config.Profiles = ordered;
            }

            for (var i = 0; i < config.Profiles.Count; i++)
            {
                var profile = config.Profiles[i];
                if (string.IsNullOrWhiteSpace(profile.Name))
                {
                    continue;
                }

                if (string.IsNullOrWhiteSpace(profile.AvatarColorHex))
                {
                    profile.AvatarColorHex = DefaultColors[i % DefaultColors.Length];
                }

                if (string.IsNullOrWhiteSpace(profile.AvatarEmoji))
                {
                    profile.AvatarEmoji = DefaultEmojis[i % DefaultEmojis.Length];
                }

                // 1. If this is the Owner profile and it was accidentally linked to a non-admin duplicate account
                // while a real Administrator exists, restore it to primaryAdmin.
                var isOwner = IsOwnerProfile(profile);

                JUser? user = null;
                if (!string.IsNullOrWhiteSpace(profile.JellyfinUserId) && Guid.TryParse(profile.JellyfinUserId, out var linkedGuid))
                {
                    user = userManager.GetUserById(linkedGuid);
                }

                if (isOwner && primaryAdmin != null && IsUserAdminCompat(primaryAdmin))
                {
                    if (user == null || (!IsUserAdminCompat(user) && user.Id != primaryAdmin.Id))
                    {
                        var staleNonAdmin = user;
                        user = primaryAdmin;
                        if (staleNonAdmin != null && staleNonAdmin.Id != primaryAdmin.Id)
                        {
                            var usedByOther = config.Profiles
                                .Where(p => !ReferenceEquals(p, profile))
                                .Any(p => string.Equals(p.JellyfinUserId, staleNonAdmin.Id.ToString("N"), StringComparison.OrdinalIgnoreCase));
                            if (!usedByOther)
                            {
                                await DeleteJellyfinUserCompatAsync(userManager, staleNonAdmin.Id, logger).ConfigureAwait(false);
                            }
                        }
                    }
                }

                // 2. If no valid linked user exists yet, look up an existing Jellyfin user without creating phantom accounts
                if (user == null)
                {
                    if (isOwner && primaryAdmin != null)
                    {
                        user = primaryAdmin;
                    }
                    else
                    {
                        var desiredName = !string.IsNullOrWhiteSpace(profile.JellyfinUsername)
                            ? profile.JellyfinUsername.Trim()
                            : profile.Name.Trim();

                        // Safe match only: never an administrator account, never an account used by another profile.
                        user = FindSafeUserByName(userManager, config, profile, desiredName, profile.Name);
                        if (user != null)
                        {
                            profile.IsPluginCreatedJellyfinUser = false;
                        }

                        // Never silently fall back to the administrator account: a Kids/Guest profile whose user was
                        // deleted would otherwise inherit full admin rights with no parental controls.
                        if (user == null && (allowCreateMissingUsers || config.AutoProvisionJellyfinUsers))
                        {
                            try
                            {
                                user = await CreatePluginManagedUserAsync(userManager, GetAvailableUsername(userManager, desiredName), logger).ConfigureAwait(false);
                                profile.IsPluginCreatedJellyfinUser = true;
                                logger?.LogInformation("StreamFlix: created Jellyfin Server User '{Username}' with randomized password for profile '{ProfileName}'.", user.Username, profile.Name);
                            }
                            catch (Exception ex)
                            {
                                logger?.LogWarning(ex, "StreamFlix: could not create Jellyfin user '{DesiredName}'.", desiredName);
                            }
                        }
                    }
                }

                if (user != null)
                {
                    profile.JellyfinUserId = user.Id.ToString("N");
                    profile.JellyfinUsername = user.Username;

                    var isPrimaryAdminUser = (primaryAdmin != null && user.Id == primaryAdmin.Id) || IsUserAdminCompat(user);
                    if (isPrimaryAdminUser)
                    {
                        profile.IsPluginCreatedJellyfinUser = false;
                    }
                    else if (profile.IsPluginCreatedJellyfinUser && UserHasEmptyPasswordCompat(user))
                    {
                        await RandomizePluginUserPasswordAsync(userManager, user, logger).ConfigureAwait(false);
                        user = userManager.GetUserById(user.Id) ?? user;
                    }
                    var needsUpdate = false;

                    if (isPrimaryAdminUser)
                    {
                        // Never restrict primaryAdmin with a parental age rating; only clear if one was accidentally set
                        if (TryGetMaxParentalAge(user) != null)
                        {
                            if (TrySetMaxParentalAge(user, null))
                            {
                                needsUpdate = true;
                            }
                        }
                    }
                    else
                    {
                        var desiredParentalAge = ParentalAgeFromMaturity(profile.MaturityRating, profile.IsKids);
                        if (TryGetMaxParentalAge(user) != desiredParentalAge)
                        {
                            if (TrySetMaxParentalAge(user, desiredParentalAge))
                            {
                                needsUpdate = true;
                            }
                        }

                        if (EnsureUserLibraryAccessAndPermissions(user, primaryAdmin))
                        {
                            needsUpdate = true;
                        }
                    }

                    if (needsUpdate)
                    {
                        try
                        {
                            await userManager.UpdateUserAsync(user).ConfigureAwait(false);
                        }
                        catch (Exception ex)
                        {
                            logger?.LogDebug(ex, "StreamFlix: could not update settings for '{Username}'.", user.Username);
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "StreamFlix: non-fatal error during profile user sync.");
        }
    }

    public static bool EnsureUserLibraryAccessAndPermissions(object targetUser, object? sourceAdminUser)
    {
        var changed = false;
        try
        {
            var enableAllProp = targetUser.GetType().GetProperty("EnableAllFolders", BindingFlags.Public | BindingFlags.Instance);
            if (enableAllProp != null && enableAllProp.CanWrite)
            {
                if (enableAllProp.GetValue(targetUser) is bool b && !b)
                {
                    enableAllProp.SetValue(targetUser, true);
                    changed = true;
                }
            }

            var requiredPermissions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "EnableAllFolders",
                "EnableAllDevices",
                "EnableAllChannels",
                "EnableMediaPlayback",
                "EnableAudioPlaybackTranscoding",
                "EnableVideoPlaybackTranscoding",
                "EnablePlaybackRemuxing",
                "EnableContentDownloading",
                "EnableRemoteAccess",
            };

            var foundPermissions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var permsProp = targetUser.GetType().GetProperty("Permissions", BindingFlags.Public | BindingFlags.Instance);

            // 1. Directly mutate existing Permission entities in user.Permissions (works across Jellyfin 10.9, 10.10, and 10.11 EF Core)
            if (permsProp?.GetValue(targetUser) is IEnumerable perms)
            {
                foreach (var perm in perms)
                {
                    if (perm == null)
                    {
                        continue;
                    }

                    var kindProp = perm.GetType().GetProperty("Kind", BindingFlags.Public | BindingFlags.Instance);
                    var valProp = perm.GetType().GetProperty("Value", BindingFlags.Public | BindingFlags.Instance);
                    var kindName = kindProp?.GetValue(perm)?.ToString();
                    if (!string.IsNullOrEmpty(kindName) && requiredPermissions.Contains(kindName))
                    {
                        foundPermissions.Add(kindName);
                        if (valProp != null && valProp.CanWrite && valProp.GetValue(perm) is bool curVal && !curVal)
                        {
                            valProp.SetValue(perm, true);
                            changed = true;
                        }
                    }
                }
            }

            // 2. For any missing permissions, invoke SetPermission (either instance method or static extension method)
            if (foundPermissions.Count < requiredPermissions.Count)
            {
                var instanceSetPerm = targetUser.GetType().GetMethod("SetPermission", BindingFlags.Public | BindingFlags.Instance);
                MethodInfo? extSetPerm = null;
                if (instanceSetPerm == null)
                {
                    lock (ExtSetPermLock)
                    {
                        if (!_extSetPermSearched)
                        {
                            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                            {
                                try
                                {
                                    var asmName = asm.GetName().Name ?? string.Empty;
                                    if (!asmName.StartsWith("Jellyfin", StringComparison.OrdinalIgnoreCase)
                                        && !asmName.StartsWith("MediaBrowser", StringComparison.OrdinalIgnoreCase))
                                    {
                                        continue;
                                    }

                                    foreach (var t in asm.GetExportedTypes())
                                    {
                                        if (!t.IsAbstract || !t.IsSealed)
                                        {
                                            continue;
                                        }

                                        foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Static))
                                        {
                                            if (m.Name == "SetPermission")
                                            {
                                                var ps = m.GetParameters();
                                                if (ps.Length == 3 && ps[0].ParameterType.IsAssignableFrom(targetUser.GetType()) && ps[1].ParameterType.IsEnum && ps[2].ParameterType == typeof(bool))
                                                {
                                                    _cachedExtSetPermMethod = m;
                                                    break;
                                                }
                                            }
                                        }

                                        if (_cachedExtSetPermMethod != null)
                                        {
                                            break;
                                        }
                                    }
                                }
                                catch
                                {
                                }

                                if (_cachedExtSetPermMethod != null)
                                {
                                    break;
                                }
                            }

                            _extSetPermSearched = true;
                        }

                        extSetPerm = _cachedExtSetPermMethod;
                    }
                }

                foreach (var permName in requiredPermissions)
                {
                    if (foundPermissions.Contains(permName))
                    {
                        continue;
                    }

                    if (instanceSetPerm != null)
                    {
                        var enumType = instanceSetPerm.GetParameters()[0].ParameterType;
                        if (Enum.TryParse(enumType, permName, ignoreCase: true, out var enumVal) && enumVal != null)
                        {
                            instanceSetPerm.Invoke(targetUser, new object[] { enumVal, true });
                            changed = true;
                        }
                    }
                    else if (extSetPerm != null)
                    {
                        var enumType = extSetPerm.GetParameters()[1].ParameterType;
                        if (Enum.TryParse(enumType, permName, ignoreCase: true, out var enumVal) && enumVal != null)
                        {
                            extSetPerm.Invoke(null, new object[] { targetUser, enumVal, true });
                            changed = true;
                        }
                    }
                }
            }

            if (sourceAdminUser != null && TrySyncDisplayCollectionsView(targetUser, sourceAdminUser))
            {
                changed = true;
            }
        }
        catch
        {
        }

        return changed;
    }

    private static bool HasUserPermissionCompat(object user, PropertyInfo? permsProp, string permissionName)
    {
        try
        {
            if (permsProp?.GetValue(user) is IEnumerable perms)
            {
                foreach (var perm in perms)
                {
                    if (perm == null)
                    {
                        continue;
                    }

                    var kindObj = perm.GetType().GetProperty("Kind")?.GetValue(perm);
                    var valObj = perm.GetType().GetProperty("Value")?.GetValue(perm);
                    if (kindObj != null && string.Equals(kindObj.ToString(), permissionName, StringComparison.OrdinalIgnoreCase))
                    {
                        return valObj is bool b && b;
                    }
                }
            }
        }
        catch
        {
        }

        return false;
    }

    public static bool TrySyncDisplayCollectionsView(object targetUser, object sourceAdminUser)
    {
        try
        {
            var prop = targetUser.GetType().GetProperty("DisplayCollectionsView", BindingFlags.Public | BindingFlags.Instance);
            var srcProp = sourceAdminUser.GetType().GetProperty("DisplayCollectionsView", BindingFlags.Public | BindingFlags.Instance);
            if (prop != null && prop.CanWrite && srcProp?.GetValue(sourceAdminUser) is bool adminVal)
            {
                if (prop.GetValue(targetUser) is bool curVal && curVal != adminVal)
                {
                    prop.SetValue(targetUser, adminVal);
                    return true;
                }
            }
        }
        catch
        {
        }

        return false;
    }

    public static int? TryGetMaxParentalAge(object user)
    {
        var prop = user.GetType().GetProperty("MaxParentalAgeRating")
            ?? user.GetType().GetProperty("MaxParentalRatingScore");
        return prop?.GetValue(user) as int?;
    }

    public static bool TrySetMaxParentalAge(object user, int? age)
    {
        var prop = user.GetType().GetProperty("MaxParentalAgeRating")
            ?? user.GetType().GetProperty("MaxParentalRatingScore");
        if (prop == null || !prop.CanWrite)
        {
            return false;
        }

        prop.SetValue(user, age);
        return true;
    }

    public static int? ParentalAgeFromMaturity(string? maturityRating, bool isKids)
    {
        if (string.IsNullOrWhiteSpace(maturityRating))
        {
            return isKids ? 7 : null;
        }

        if (maturityRating.StartsWith("Little Kids", StringComparison.OrdinalIgnoreCase))
        {
            return 5;
        }

        if (isKids || maturityRating.StartsWith("Older Kids", StringComparison.OrdinalIgnoreCase))
        {
            return 7;
        }

        if (maturityRating.StartsWith("Teens", StringComparison.OrdinalIgnoreCase))
        {
            return 13;
        }

        return null;
    }

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
#if JF1011 || JF12
        yield return new TaskTriggerInfo
        {
            Type = TaskTriggerInfoType.StartupTrigger,
        };
#else
        yield return new TaskTriggerInfo
        {
            Type = TaskTriggerInfo.TriggerStartup,
        };
#endif
    }
}
