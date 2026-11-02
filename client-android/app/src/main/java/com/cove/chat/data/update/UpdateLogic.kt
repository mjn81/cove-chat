package com.cove.chat.data.update

import java.io.File
import java.security.MessageDigest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** Cove's own update control point; GitHub is the fallback. Format: docs/auto-update.md. */
const val DEFAULT_MANIFEST_URL = "https://covechat.dev/releases/manifest.json"

/** GitHub releases API used when the manifest cannot be reached. */
const val GITHUB_RELEASES_URL = "https://api.github.com/repos/mjn81/cove-chat/releases?per_page=30"

@Serializable
data class ManifestAsset(val url: String = "", val sha256: String = "", val size: Long = 0)

/** The release manifest (same document the server and desktop read). Only the `android` asset matters here. */
@Serializable
data class UpdateManifest(
    val channel: String = "stable",
    val version: String = "",
    @SerialName("released_at") val releasedAt: String = "",
    val notes: String = "",
    @SerialName("release_url") val releaseUrl: String = "",
    @SerialName("min_version") val minVersion: String = "",
    val assets: Map<String, ManifestAsset> = emptyMap(),
)

/** Semantic version with the same precedence rules as the Go updater (`cove/update`). */
data class SemVer(val major: Long, val minor: Long, val patch: Long, val pre: List<String>) : Comparable<SemVer> {
    val isPrerelease: Boolean get() = pre.isNotEmpty()

    override fun toString(): String = "$major.$minor.$patch" + if (pre.isEmpty()) "" else "-" + pre.joinToString(".")

    override fun compareTo(other: SemVer): Int {
        listOf(major to other.major, minor to other.minor, patch to other.patch).forEach { (a, b) ->
            if (a != b) return a.compareTo(b)
        }
        if (pre.isEmpty() && other.pre.isEmpty()) return 0
        if (pre.isEmpty()) return 1
        if (other.pre.isEmpty()) return -1
        for (i in 0 until minOf(pre.size, other.pre.size)) {
            val c = comparePreId(pre[i], other.pre[i])
            if (c != 0) return c
        }
        return pre.size.compareTo(other.pre.size)
    }

    companion object {
        /** Parses `1.2.3`, `v1.2.3`, `1.2.3-rc.1+build`; null when it is not MAJOR.MINOR.PATCH. */
        fun parse(raw: String): SemVer? {
            val s = raw.trim().removePrefix("v").substringBefore('+')
            val core = s.substringBefore('-')
            val pre = if (s.contains('-')) s.substringAfter('-') else ""
            val nums = core.split('.')
            if (nums.size != 3) return null
            val n = nums.map { p -> p.toLongOrNull()?.takeIf { p.length == 1 || p[0] != '0' } ?: return null }
            val ids = if (s.contains('-')) pre.split('.') else emptyList()
            if (ids.any { it.isEmpty() }) return null
            return SemVer(n[0], n[1], n[2], ids)
        }

        private fun comparePreId(a: String, b: String): Int {
            val an = a.toLongOrNull()
            val bn = b.toLongOrNull()
            return when {
                an != null && bn != null -> an.compareTo(bn)
                an != null -> -1
                bn != null -> 1
                else -> a.compareTo(b)
            }
        }
    }
}

/** A newer APK the user may download. */
data class UpdateOffer(
    val version: String,
    val notes: String,
    val releaseUrl: String,
    val prerelease: Boolean,
    val apkUrl: String,
    val sha256: String,
    val size: Long,
    /** False when the running version is below the release's `min_version`: link to the release page instead. */
    val directInstall: Boolean = true,
)

object UpdateLogic {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val hex64 = Regex("^[0-9a-fA-F]{64}$")

    /** Pre-releases are offered when the user opted in or the running build is 0.x / a pre-release (every 0.x release is one). */
    fun allowPrerelease(current: String, optIn: Boolean): Boolean {
        if (optIn) return true
        val v = SemVer.parse(current) ?: return false
        return v.major == 0L || v.isPrerelease
    }

    /**
     * Parses and validates a manifest. Rejects anything unsafe (non-HTTPS URLs, bad checksums, bad versions) so a
     * broken or hostile mirror can never produce an installable offer; the caller then falls back to GitHub.
     */
    fun parseManifest(text: String): UpdateManifest? {
        val m = runCatching { json.decodeFromString(UpdateManifest.serializer(), text) }.getOrNull() ?: return null
        if (SemVer.parse(m.version) == null) return null
        if (m.minVersion.isNotEmpty() && SemVer.parse(m.minVersion) == null) return null
        if (m.assets.isEmpty()) return null
        for ((_, a) in m.assets) {
            if (!hex64.matches(a.sha256) || !a.url.startsWith("https://") || a.size < 0) return null
        }
        return m
    }

    /** Turns a manifest into an offer when it carries an APK that is newer than [current]. */
    fun offerFrom(manifest: UpdateManifest, current: String, includePrerelease: Boolean): UpdateOffer? {
        val cur = SemVer.parse(current) ?: return null
        val v = SemVer.parse(manifest.version) ?: return null
        val pre = (manifest.channel.isNotEmpty() && manifest.channel != "stable") || v.isPrerelease
        if (pre && !includePrerelease) return null
        if (v <= cur) return null
        val apk = manifest.assets["android"] ?: return null
        val min = SemVer.parse(manifest.minVersion)
        return UpdateOffer(
            version = v.toString(), notes = manifest.notes, releaseUrl = manifest.releaseUrl, prerelease = pre,
            apkUrl = apk.url, sha256 = apk.sha256.lowercase(), size = apk.size,
            directInstall = min == null || cur >= min,
        )
    }

    /** `sha256sum` output: `<hex>  <name>` or `<hex> *<name>`. */
    fun parseSums(text: String): Map<String, String> = buildMap {
        text.lineSequence().forEach { line ->
            val parts = line.trim().split(Regex("\\s+"), limit = 2)
            if (parts.size == 2 && hex64.matches(parts[0])) put(parts[1].trimStart('*').trim(), parts[0].lowercase())
        }
    }

    /** The GitHub release chosen by [pickGitHubRelease]; checksums are fetched separately from [sumsUrl]. */
    data class GitHubPick(
        val version: String, val notes: String, val htmlUrl: String, val prerelease: Boolean,
        val apkName: String, val apkUrl: String, val apkSize: Long, val sumsUrl: String,
    )

    /**
     * Picks the highest-semver release newer than [current] that already carries an APK and SHA256SUMS. The list
     * endpoint is used (not `/releases/latest`) because every 0.x release is a GitHub pre-release.
     */
    fun pickGitHubRelease(releasesJson: String, current: String, includePrerelease: Boolean): GitHubPick? {
        val cur = SemVer.parse(current) ?: return null
        val arr = runCatching { json.parseToJsonElement(releasesJson).jsonArray }.getOrNull() ?: return null
        var best: Pair<SemVer, GitHubPick>? = null
        for (el in arr) {
            val r = el as? JsonObject ?: continue
            if (r["draft"]?.jsonPrimitive?.booleanOrNull == true) continue
            val tag = r["tag_name"]?.jsonPrimitive?.content ?: continue
            val v = SemVer.parse(tag) ?: continue
            val pre = r["prerelease"]?.jsonPrimitive?.booleanOrNull == true || v.isPrerelease
            if (pre && !includePrerelease) continue
            if (v <= cur) continue
            val assets = (r["assets"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
            fun url(o: JsonObject) = o["browser_download_url"]?.jsonPrimitive?.content ?: ""
            val apk = assets.firstOrNull { it["name"]?.jsonPrimitive?.content?.let { n -> n.startsWith("cove-android-") && n.endsWith(".apk") } == true } ?: continue
            val sums = assets.firstOrNull { it["name"]?.jsonPrimitive?.content == "SHA256SUMS" } ?: continue
            val pick = GitHubPick(
                version = v.toString(), notes = r["body"]?.jsonPrimitive?.content ?: "", htmlUrl = r["html_url"]?.jsonPrimitive?.content ?: "",
                prerelease = pre, apkName = apk["name"]!!.jsonPrimitive.content, apkUrl = url(apk),
                apkSize = apk["size"]?.jsonPrimitive?.longOrNull ?: 0, sumsUrl = url(sums),
            )
            if (best == null || v > best.first) best = v to pick
        }
        return best?.second
    }

    /** Combines a GitHub pick with its SHA256SUMS text into an offer; null if the APK has no checksum. */
    fun offerFromGitHub(pick: GitHubPick, sumsText: String): UpdateOffer? {
        val sha = parseSums(sumsText)[pick.apkName] ?: return null
        if (!pick.apkUrl.startsWith("https://")) return null
        return UpdateOffer(pick.version, pick.notes, pick.htmlUrl, pick.prerelease, pick.apkUrl, sha, pick.apkSize)
    }

    /** Lower-case hex SHA-256 of a file. */
    fun sha256Of(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** True when [file] matches [expected] (case-insensitive). The APK is only handed to the installer when this holds. */
    fun verify(file: File, expected: String): Boolean = sha256Of(file).equals(expected.trim(), ignoreCase = true)

    /** Whether a background auto-download may run now: opted in, and on an unmetered Wi-Fi/Ethernet connection. */
    fun mayAutoDownload(optedIn: Boolean, unmeteredWifi: Boolean): Boolean = optedIn && unmeteredWifi

    /** True when a background check is due: at most one per [intervalMs] (default a day). */
    fun checkDue(lastCheckMs: Long, nowMs: Long, intervalMs: Long = 24L * 60 * 60 * 1000): Boolean =
        lastCheckMs <= 0 || nowMs - lastCheckMs >= intervalMs || nowMs < lastCheckMs
}
