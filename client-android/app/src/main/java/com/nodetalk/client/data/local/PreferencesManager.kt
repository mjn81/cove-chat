package com.nodetalk.client.data.local

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
        "nodetalk_secure_prefs",
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

    fun clearAuth() {
        prefs.edit()
            .remove("auth_token")
            .remove("user_id")
            .remove("username")
            .remove("avatar_id")
            .apply()
    }
}
