package com.cove.chat.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class PreferencesManager(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "cove_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(value) = prefs.edit().putString("server_url", value.trimEnd('/')).apply()

    /** True once the user has chosen a server in the first-run "Select a Server" step. */
    val hasServer: Boolean get() = serverUrl.isNotBlank()

    /** Dark/light choice from Settings > Appearance. */
    var darkTheme: Boolean
        get() = prefs.getBoolean("dark_theme", true)
        set(value) = prefs.edit().putBoolean("dark_theme", value).apply()

    /** Chat background pattern id (`none`, `animals`, `space`, `games`, `sweets`), same ids as the web setting. */
    var chatBackground: String
        get() = prefs.getString("chat_background", "none") ?: "none"
        set(value) = prefs.edit().putString("chat_background", value).apply()

    /** Own avatar file id (from /api/me), cached so the footer can draw it before any network call. */
    var avatarId: String?
        get() = prefs.getString("avatar_id", null)
        set(value) = prefs.edit().putString("avatar_id", value).apply()

    /** Local notification preferences (Settings > Notifications). */
    var notificationsEnabled: Boolean
        get() = prefs.getBoolean("notifications_enabled", true)
        set(value) = prefs.edit().putBoolean("notifications_enabled", value).apply()

    /** Keep the socket alive in the background (foreground service) so notifications work with the app closed. */
    var keepConnected: Boolean
        get() = prefs.getBoolean("keep_connected", true)
        set(value) = prefs.edit().putBoolean("keep_connected", value).apply()

    var notificationSound: Boolean
        get() = prefs.getBoolean("notification_sound", true)
        set(value) = prefs.edit().putBoolean("notification_sound", value).apply()

    /** Audio processing used when joining calls (Settings > Voice & Video). */
    var noiseSuppression: Boolean
        get() = prefs.getBoolean("noise_suppression", true)
        set(value) = prefs.edit().putBoolean("noise_suppression", value).apply()

    var echoCancellation: Boolean
        get() = prefs.getBoolean("echo_cancellation", true)
        set(value) = prefs.edit().putBoolean("echo_cancellation", value).apply()

    var joinCallsMuted: Boolean
        get() = prefs.getBoolean("join_calls_muted", false)
        set(value) = prefs.edit().putBoolean("join_calls_muted", value).apply()

    /** UI language: "en", "fa" or "ar". */
    var language: String
        get() = prefs.getString("language", "en") ?: "en"
        set(value) = prefs.edit().putString("language", value).apply()

    var authToken: String?
        get() = prefs.getString("auth_token", null)
        set(value) = prefs.edit().putString("auth_token", value).apply()

    var userId: String?
        get() = prefs.getString("user_id", null)
        set(value) = prefs.edit().putString("user_id", value).apply()

    var username: String?
        get() = prefs.getString("username", null)
        set(value) = prefs.edit().putString("username", value).apply()

    /** Cached `server_role` ("owner", "admin" or empty) that decides whether Settings shows the admin entry. */
    var serverRole: String
        get() = prefs.getString("server_role", "") ?: ""
        set(value) = prefs.edit().putString("server_role", value).apply()

    /** Salted PBKDF2 hash of the local passcode (Base64), or null when no passcode is set. */
    var lockHash: String?
        get() = prefs.getString("lock_hash", null)
        set(value) = prefs.edit().putString("lock_hash", value).apply()

    var lockSalt: String?
        get() = prefs.getString("lock_salt", null)
        set(value) = prefs.edit().putString("lock_salt", value).apply()

    /** Seconds in the background before the passcode is required again; 0 = immediately, -1 = only on restart. */
    var lockTimeoutSeconds: Int
        get() = prefs.getInt("lock_timeout_seconds", 60)
        set(value) = prefs.edit().putInt("lock_timeout_seconds", value).apply()

    /** Recently used emoji (space separated, newest first) shown first in the emoji panel. */
    var recentEmojis: String
        get() = prefs.getString("recent_emojis", "") ?: ""
        set(value) = prefs.edit().putString("recent_emojis", value).apply()

    fun clearAuth() {
        prefs.edit()
            .remove("server_role")
            .remove("auth_token")
            .remove("user_id")
            .remove("username")
            .remove("avatar_id")
            // The passcode protects this account on this phone; it goes with the account.
            .remove("lock_hash")
            .remove("lock_salt")
            .apply()
    }
}
