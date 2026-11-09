package com.cove.chat.themes

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.cove.chat.data.local.PreferencesManager
import java.io.File

/** A running preview: the theme being tried and when it reverts by itself (epoch ms). */
class ThemePreview(val theme: ThemeDefinition, val assets: Map<String, ThemeAsset>, val expiresAt: Long, val install: Boolean)

/**
 * App-wide theme state, read by [com.cove.chat.ui.theme.CoveTheme]. Only validated [ThemeDefinition]s ever get in:
 * built-ins, or themes that went through [ThemeStore.install]. A preview is a separate overlay that is never
 * persisted, so killing the app is a revert (plan section 1.4); only [select] writes the preference.
 */
object ThemeState {
    /** How long a preview stays before it reverts by itself. */
    const val PREVIEW_MS = 60_000L

    /** The user's light/dark preference. */
    var mode by mutableStateOf(ThemeMode.Dark)
    /** The selected theme (built-in or installed). */
    var active by mutableStateOf(BuiltinThemes.byId(BuiltinThemes.DEFAULT_ID)!!)
        private set
    private var activeAssets by mutableStateOf<Map<String, ThemeAsset>>(emptyMap())
    var installed by mutableStateOf<List<InstalledTheme>>(emptyList())
        private set
    var preview by mutableStateOf<ThemePreview?>(null)
        private set

    private var store: ThemeStore? = null
    private var prefs: PreferencesManager? = null

    /** The theme to paint: the preview while one runs, else the selected one. */
    val effective: ThemeDefinition get() = preview?.theme ?: active
    val effectiveAssets: Map<String, ThemeAsset> get() = preview?.assets ?: activeAssets
    val resolved: ResolvedTheme get() = BuiltinThemes.resolve(effective, mode)

    /** Loads the stored selection. Call once at startup, before the first frame. */
    fun init(context: Context, preferences: PreferencesManager) {
        prefs = preferences
        val s = ThemeStore(File(context.filesDir, "themes")) { bytes ->
            // The platform decoder check: refuse an image that passed the header sniff but is not decodable.
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            o.outWidth > 0 && o.outHeight > 0 && BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = 8 }) != null
        }
        store = s
        mode = if (preferences.darkTheme) ThemeMode.Dark else ThemeMode.Light
        reloadInstalled()
        val id = preferences.themeId
        val builtin = BuiltinThemes.byId(id)
        val custom = if (builtin == null) installed.firstOrNull { it.definition.id == id } else null
        when {
            builtin != null -> setActive(builtin, emptyMap())
            custom != null -> setActive(custom.definition, custom.assets)
            else -> { preferences.themeId = BuiltinThemes.DEFAULT_ID; setActive(BuiltinThemes.byId(BuiltinThemes.DEFAULT_ID)!!, emptyMap()) }
        }
        normalizeBackground()
    }

    private fun setActive(def: ThemeDefinition, assets: Map<String, ThemeAsset>) { active = def; activeAssets = assets }

    private fun reloadInstalled() { installed = store?.list().orEmpty() }

    /** Makes [def] the persistent theme. For an installed theme pass its [assets]. */
    fun select(def: ThemeDefinition, assets: Map<String, ThemeAsset> = emptyMap()) {
        setActive(def, assets)
        prefs?.themeId = def.id
        val bg = def.chat?.background
        // A theme that brings its own background gets it adopted; a stale "use the theme's" choice is dropped.
        if (bg != null && bg !is ChatBackground.None) setChatBackground("theme")
        else if (com.cove.chat.ui.components.ChatBackgroundSettings.id == "theme") setChatBackground("none")
        endPreview()
    }

    fun chooseMode(m: ThemeMode) { mode = m; prefs?.darkTheme = m == ThemeMode.Dark }

    fun setChatBackground(id: String) {
        com.cove.chat.ui.components.ChatBackgroundSettings.id = id
        prefs?.chatBackground = id
    }

    /** A saved "theme" background that the active theme no longer has falls back to none. */
    private fun normalizeBackground() {
        val chosen = com.cove.chat.ui.components.ChatBackgroundSettings.id
        val bg = active.chat?.background
        if (chosen == "theme" && (bg == null || bg is ChatBackground.None)) setChatBackground("none")
    }

    /** Installs a `.covetheme`; the result carries the refusal reason or the installed theme. */
    fun install(bytes: ByteArray): InstallResult {
        val s = store ?: return InstallResult.Refused(ThemeIssue("zip_invalid"))
        val r = s.install(bytes)
        if (r is InstallResult.Installed) {
            reloadInstalled()
            // Re-installing the selected theme refreshes what is on screen.
            if (active.id == r.theme.definition.id) setActive(r.theme.definition, r.theme.assets)
        }
        return r
    }

    fun delete(id: String) {
        store?.delete(id)
        reloadInstalled()
        if (active.id == id) select(BuiltinThemes.byId(BuiltinThemes.DEFAULT_ID)!!)
    }

    fun exportBytes(theme: ThemeDefinition): Pair<String, ByteArray>? = store?.exportBytes(theme)

    /** Starts a preview of [theme]; [install] says Apply must install it first (a theme from a chat card). */
    fun startPreview(theme: ThemeDefinition, assets: Map<String, ThemeAsset>, install: Boolean, now: Long = System.currentTimeMillis()) {
        preview = ThemePreview(theme, assets, now + PREVIEW_MS, install)
    }

    fun endPreview() { preview = null }

    /** Reverts the preview once its time is up; the bar's timer calls this. */
    fun expirePreview(now: Long = System.currentTimeMillis()) {
        val p = preview ?: return
        if (now >= p.expiresAt) preview = null
    }
}
