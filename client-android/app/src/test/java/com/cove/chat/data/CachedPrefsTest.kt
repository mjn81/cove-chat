package com.cove.chat.data

import android.content.SharedPreferences
import com.cove.chat.data.local.CachedPrefs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** An in-memory store that counts reads, standing in for EncryptedSharedPreferences (which decrypts on each one). */
private class CountingPrefs : SharedPreferences {
    val data = HashMap<String, Any?>()
    var reads = 0

    override fun getAll(): MutableMap<String, *> = data
    override fun getString(key: String, defValue: String?): String? { reads++; return data[key] as? String ?: defValue }
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
    override fun getInt(key: String, defValue: Int): Int { reads++; return data[key] as? Int ?: defValue }
    override fun getLong(key: String, defValue: Long): Long { reads++; return data[key] as? Long ?: defValue }
    override fun getFloat(key: String, defValue: Float): Float = defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean { reads++; return data[key] as? Boolean ?: defValue }
    override fun contains(key: String): Boolean = data.containsKey(key)
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        val ops = ArrayList<() -> Unit>()
        override fun putString(key: String, value: String?) = also { ops += { data[key] = value } }
        override fun putStringSet(key: String, values: MutableSet<String>?) = this
        override fun putInt(key: String, value: Int) = also { ops += { data[key] = value } }
        override fun putLong(key: String, value: Long) = also { ops += { data[key] = value } }
        override fun putFloat(key: String, value: Float) = this
        override fun putBoolean(key: String, value: Boolean) = also { ops += { data[key] = value } }
        override fun remove(key: String) = also { ops += { data.remove(key) } }
        override fun clear() = this
        override fun commit(): Boolean { apply(); return true }
        override fun apply() { ops.forEach { it() } }
    }
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
}

class CachedPrefsTest {
    @Test fun `a value is read from the store once however often it is asked for`() {
        val store = CountingPrefs().apply { data["auth_token"] = "abc"; data["dark"] = true; data["tone"] = 3; data["last"] = 9L }
        val prefs = CachedPrefs(store)
        repeat(1000) {
            assertEquals("abc", prefs.getString("auth_token", null))
            assertEquals(true, prefs.getBoolean("dark", false))
            assertEquals(3, prefs.getInt("tone", 1))
            assertEquals(9L, prefs.getLong("last", 0L))
        }
        assertEquals(4, store.reads) // 4000 reads before, 4 now
    }

    @Test fun `missing keys fall back to the default and are remembered as missing`() {
        val store = CountingPrefs()
        val prefs = CachedPrefs(store)
        repeat(50) {
            assertNull(prefs.getString("user_id", null))
            assertEquals("en", prefs.getString("language", "en"))
            assertEquals(60, prefs.getInt("lock_timeout_seconds", 60))
            assertEquals(true, prefs.getBoolean("notifications_enabled", true))
        }
        assertEquals(2, store.reads) // one per missing string key; the typed getters only ask contains()
    }

    @Test fun `writes show up immediately and reach the store`() {
        val store = CountingPrefs()
        val prefs = CachedPrefs(store)
        assertNull(prefs.getString("auth_token", null))
        prefs.edit().putString("auth_token", "t1").putBoolean("dark", false).apply()
        assertEquals("t1", prefs.getString("auth_token", null))
        assertEquals(false, prefs.getBoolean("dark", true))
        assertEquals("t1", store.data["auth_token"])
    }

    @Test fun `removing keys clears them from the cache and the store`() {
        val store = CountingPrefs().apply { data["auth_token"] = "t"; data["user_id"] = "u" }
        val prefs = CachedPrefs(store)
        assertEquals("t", prefs.getString("auth_token", null))
        prefs.edit().remove("auth_token").remove("user_id").apply()
        assertNull(prefs.getString("auth_token", null))
        assertNull(prefs.getString("user_id", null))
        assertNull(store.data["auth_token"])
    }

    @Test fun `staged edits are not visible until applied`() {
        val prefs = CachedPrefs(CountingPrefs())
        val editor = prefs.edit().putString("language", "fa")
        assertEquals("en", prefs.getString("language", "en"))
        editor.apply()
        assertEquals("fa", prefs.getString("language", "en"))
    }
}
