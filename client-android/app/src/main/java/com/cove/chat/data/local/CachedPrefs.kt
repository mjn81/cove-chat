package com.cove.chat.data.local

import android.content.SharedPreferences
import java.util.concurrent.ConcurrentHashMap

/**
 * A read-through cache over the app's [SharedPreferences] (the encrypted store).
 *
 * `EncryptedSharedPreferences` encrypts the key name and decrypts the value on every single read, and the settings
 * getters sit on hot paths (the server URL and token on every request, the user id on every incoming message, theme
 * and emoji options while composing). Each value is therefore decrypted once and kept in memory; writes through this
 * class update the cache and the store together, so the two cannot drift. Everything that writes the file goes
 * through [PreferencesManager], which owns the only instance.
 *
 * A key is always read with one type, so the cache is keyed by name alone.
 */
class CachedPrefs(private val delegate: SharedPreferences) {
    /** Marks "no stored value", since a [ConcurrentHashMap] cannot hold null. */
    private object Absent

    private val cache = ConcurrentHashMap<String, Any>()

    private inline fun <reified T : Any> read(key: String, fetch: () -> T?): T? {
        val hit = cache[key]
        if (hit != null) return hit as? T
        val value = fetch()
        cache[key] = value ?: Absent
        return value
    }

    fun getString(key: String, default: String?): String? =
        read(key) { delegate.getString(key, null) } ?: default

    fun getBoolean(key: String, default: Boolean): Boolean =
        read(key) { if (delegate.contains(key)) delegate.getBoolean(key, default) else null } ?: default

    fun getInt(key: String, default: Int): Int =
        read(key) { if (delegate.contains(key)) delegate.getInt(key, default) else null } ?: default

    fun getLong(key: String, default: Long): Long =
        read(key) { if (delegate.contains(key)) delegate.getLong(key, default) else null } ?: default

    fun edit(): Editor = Editor(delegate.edit())

    /** The subset of [SharedPreferences.Editor] the app uses; the cache is refreshed when [apply] runs. */
    inner class Editor internal constructor(private val inner: SharedPreferences.Editor) {
        private val staged = LinkedHashMap<String, Any>()

        fun putString(key: String, value: String?) = also { inner.putString(key, value); staged[key] = value ?: Absent }
        fun putBoolean(key: String, value: Boolean) = also { inner.putBoolean(key, value); staged[key] = value }
        fun putInt(key: String, value: Int) = also { inner.putInt(key, value); staged[key] = value }
        fun putLong(key: String, value: Long) = also { inner.putLong(key, value); staged[key] = value }
        fun remove(key: String) = also { inner.remove(key); staged[key] = Absent }

        /** Writes to the store in the background, like [SharedPreferences.Editor.apply], and refreshes the cache now. */
        fun apply() {
            cache.putAll(staged)
            inner.apply()
        }
    }
}
