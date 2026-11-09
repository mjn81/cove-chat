package com.cove.chat.themes

import java.io.File

/** A theme installed on this device: the validated definition plus its images. */
class InstalledTheme(val definition: ThemeDefinition, val assets: Map<String, ThemeAsset>, val bytes: ByteArray)

/** Outcome of [ThemeStore.install]. */
sealed interface InstallResult {
    data class Installed(val theme: InstalledTheme, val replaced: Boolean, val warnings: List<ThemeIssue>) : InstallResult
    data class Refused(val error: ThemeIssue) : InstallResult
}

/**
 * Installed themes on this device (plan section 1.4: "app files on Android"). Each theme is stored as the original
 * `.covetheme` archive in [dir]; it is parsed again on every load, so a tampered or stale file is held to the same
 * rules as a fresh import. [imageDecodes] is the platform decoder check (`BitmapFactory` on Android): an image that
 * passes the header sniff but cannot be decoded refuses the whole theme, like `createImageBitmap` on the web.
 */
class ThemeStore(private val dir: File, private val imageDecodes: (ByteArray) -> Boolean = { true }) {

    private fun file(id: String) = File(dir, "$id${CoveThemeParser.EXTENSION}")

    /** Validates [bytes] and writes them as an installed theme. Built-in ids are reserved. */
    fun install(bytes: ByteArray): InstallResult {
        val parsed = CoveThemeParser.parse(bytes)
        if (parsed is ThemeParseResult.Fail) return InstallResult.Refused(parsed.error)
        parsed as ThemeParseResult.Ok
        val id = parsed.theme.id
        if (BuiltinThemes.isBuiltinId(id)) return InstallResult.Refused(ThemeIssue("reserved_id", id))
        for ((path, asset) in parsed.assets) if (!imageDecodes(asset.bytes)) return InstallResult.Refused(ThemeIssue("image_undecodable", path))
        dir.mkdirs()
        val target = file(id)
        val replaced = target.exists()
        // Write to a temp file first so a crash never leaves a half-written theme that would later fail to parse.
        val tmp = File(dir, "$id.tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(target)) { target.writeBytes(bytes); tmp.delete() }
        return InstallResult.Installed(InstalledTheme(parsed.theme, parsed.assets, bytes), replaced, parsed.warnings)
    }

    /** Loads one installed theme; null when missing or no longer valid. */
    fun load(id: String): InstalledTheme? {
        if (!Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$").matches(id)) return null
        val f = file(id)
        if (!f.isFile) return null
        val bytes = runCatching { f.readBytes() }.getOrNull() ?: return null
        val parsed = CoveThemeParser.parse(bytes) as? ThemeParseResult.Ok ?: return null
        if (parsed.theme.id != id || BuiltinThemes.isBuiltinId(id)) return null
        return InstalledTheme(parsed.theme, parsed.assets, bytes)
    }

    /** Every installed theme that still validates, sorted by English name. */
    fun list(): List<InstalledTheme> =
        (dir.listFiles { f -> f.name.endsWith(CoveThemeParser.EXTENSION) } ?: emptyArray())
            .mapNotNull { load(it.name.removeSuffix(CoveThemeParser.EXTENSION)) }
            .sortedBy { it.definition.name.en.lowercase() }

    fun delete(id: String): Boolean = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$").matches(id) && file(id).delete()

    /**
     * The `.covetheme` bytes to export or share: the stored archive of an installed theme, or a freshly built one for a
     * built-in (which cannot be exported under its reserved id, so it leaves as `<id>-copy`).
     */
    fun exportBytes(theme: ThemeDefinition): Pair<String, ByteArray> {
        BuiltinThemes.byId(theme.id)?.let { builtin ->
            val copy = builtin.copy(id = "${builtin.id}-copy")
            return "${copy.id}${CoveThemeParser.EXTENSION}" to CoveThemeParser.build(copy)
        }
        val stored = load(theme.id)
        val bytes = stored?.bytes ?: CoveThemeParser.build(theme)
        return "${theme.id}${CoveThemeParser.EXTENSION}" to bytes
    }
}
