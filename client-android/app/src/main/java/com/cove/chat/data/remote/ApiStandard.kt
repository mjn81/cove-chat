package com.cove.chat.data.remote

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Client side of the Cove API standard (docs/api-standard.md): the API version this build speaks, the
 * `X-Cove-Client` header, error-code parsing, version comparison and the unknown-message-type rule.
 */
object ApiStandard {
    /** Integer contract version; must match the backend's `apistd.APIVersion` for this build to be current. */
    const val API_VERSION = 2

    const val CLIENT_HEADER = "X-Cove-Client"

    /** Where an outdated client is sent to get a newer build. */
    const val RELEASES_URL = "https://github.com/mjn81/cove-chat/releases/latest"

    /** Message types this build can render; anything else is shown as a placeholder. */
    private val KNOWN_MESSAGE_TYPES = setOf("text", "file", "voice", "video", "invite")

    /** `android/0.10.0 (api 2)`. */
    fun clientHeader(version: String): String = "android/$version (api $API_VERSION)"

    /** Whether [type] is a message type this build can render (unknown ones must not crash or vanish). */
    fun isKnownMessageType(type: String): Boolean = type in KNOWN_MESSAGE_TYPES

    /** Reads `details.min_client_version` from an error envelope; null when absent or not a string. */
    fun minClientVersion(details: JsonObject?): String? =
        (details?.get("min_client_version") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }

    /** True for HTTP 426 or the stable `client_outdated` code. */
    fun isClientOutdated(status: Int, code: String?): Boolean = status == 426 || code == "client_outdated"

    /** Compares MAJOR[.MINOR[.PATCH]] ignoring a leading `v` and any `-pre`/`+build` suffix; null if either is not a version. */
    fun compareVersions(a: String, b: String): Int? {
        val pa = parse(a) ?: return null
        val pb = parse(b) ?: return null
        for (i in 0..2) if (pa[i] != pb[i]) return if (pa[i] < pb[i]) -1 else 1
        return 0
    }

    /** Whether [current] is older than the server's [minClientVersion]. An empty or unparsable minimum never counts. */
    fun isBelowMinimum(current: String, minClientVersion: String?): Boolean {
        if (minClientVersion.isNullOrBlank()) return false
        return compareVersions(current, minClientVersion) == -1
    }

    /** Whether a server advertises [name]. A missing list (old server) means no optional features. */
    fun hasCapability(capabilities: List<String>?, name: String): Boolean = capabilities?.contains(name) == true

    /**
     * True when no call engine of this client can serve the server: it has no WebRTC SFU and no encrypted UDP media
     * router (`raw_udp_media`), only the removed unencrypted audio format (`raw_udp_voice`). Android speaks both the
     * WebRTC and the encrypted UDP engines, so a normal server is never blocked. An old server that advertises
     * nothing is assumed to be a normal WebRTC one.
     */
    fun callsNeedUdpClient(capabilities: List<String>?): Boolean =
        !capabilities.isNullOrEmpty() && !hasCapability(capabilities, "webrtc_sfu") &&
            !hasCapability(capabilities, "raw_udp_media") && hasCapability(capabilities, "raw_udp_voice")

    private fun parse(v: String): IntArray? {
        val core = v.trim().removePrefix("v").removePrefix("V").split('-', '+').first()
        if (!Regex("""\d+(\.\d+){0,2}""").matches(core)) return null
        val parts = core.split('.').map { it.toIntOrNull() ?: return null }
        return IntArray(3) { parts.getOrElse(it) { 0 } }
    }
}

/** Set when the server refuses this build (HTTP 426 / `client_outdated`); the root UI shows an explanation. */
object ClientOutdatedState {
    private val _minVersion = MutableStateFlow<String?>(null)

    /** Null while all is well; once outdated, holds the minimum version (or "" when the server did not say). */
    val minVersion: StateFlow<String?> = _minVersion

    fun report(minClientVersion: String?) {
        _minVersion.value = minClientVersion ?: ""
    }
}
