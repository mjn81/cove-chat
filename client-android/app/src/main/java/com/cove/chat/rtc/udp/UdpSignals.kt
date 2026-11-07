package com.cove.chat.rtc.udp

import com.cove.chat.data.udpmedia.JoinResponse
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/** One call member as the server describes it in `call_joined` / `call_participant_joined` (docs/udp-media.md section 2). */
data class UdpParticipant(
    val userId: String,
    val username: String,
    /** Source id the server stamps on this member's forwarded media; null if the server omitted it. */
    val mediaId: Int?,
    val audio: Boolean,
    val video: Boolean,
    val screen: Boolean,
)

/** The decoded `call_joined` payload of a `raw_udp` server. */
data class UdpJoined(val channelId: String, val selfId: String, val media: JoinResponse, val participants: List<UdpParticipant>)

/** Wire (de)serialisation of the `call_*` events used by the encrypted UDP call path. Pure, so it is unit tested. */
object UdpSignals {
    private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull

    /** The `call_join` payload: the channel plus the client half of the key agreement. */
    fun joinPayload(channelId: String, clientPub: String, clientNonce: String): JsonObject = buildJsonObject {
        put("channel_id", channelId)
        put("media", buildJsonObject {
            put("client_pub", clientPub)
            put("client_nonce", clientNonce)
        })
    }

    /** Parses one participant object; null when it has no user id. Track states default like the server's (audio on). */
    fun participant(o: JsonObject?): UdpParticipant? {
        o ?: return null
        val id = o.str("user_id") ?: return null
        val states = o["track_states"] as? JsonObject
        fun flag(k: String, def: Boolean) = (states?.get(k) as? JsonPrimitive)?.booleanOrNull ?: def
        return UdpParticipant(
            userId = id,
            username = o.str("username") ?: "User",
            mediaId = (o["media_id"] as? JsonPrimitive)?.intOrNull,
            audio = flag("audio", true),
            video = flag("video", false),
            screen = flag("screen", false),
        )
    }

    /** Parses `call_joined`; null if the server sent no usable `media` block (a WebRTC-mode answer, or a broken one). */
    fun joined(p: JsonObject): UdpJoined? {
        val channel = p.str("channel_id") ?: return null
        val self = p.str("self_id") ?: return null
        val m = p["media"] as? JsonObject ?: return null
        val media = JoinResponse(
            sessionId = m.str("session_id") ?: return null,
            serverPub = m.str("server_pub") ?: return null,
            serverNonce = m.str("server_nonce") ?: return null,
            mediaId = (m["media_id"] as? JsonPrimitive)?.intOrNull ?: return null,
            maxPacket = (m["max_packet"] as? JsonPrimitive)?.intOrNull ?: 1200,
            epoch = (m["epoch"] as? JsonPrimitive)?.intOrNull ?: 0,
        )
        val roster = (p["participants"] as? JsonArray)?.mapNotNull { participant(it as? JsonObject) }.orEmpty()
        return UdpJoined(channel, self, media, roster)
    }

    /** `call_participant_joined` / `call_participant_left` carry the member under `user`. */
    fun participantEvent(p: JsonObject): Pair<String?, UdpParticipant?> = p.str("channel_id") to participant(p["user"] as? JsonObject)

    /** `call_track_state` rebroadcast: (user id, kind, enabled). */
    fun trackState(p: JsonObject): Triple<String, String, Boolean>? {
        val uid = p.str("user_id") ?: return null
        val kind = p.str("kind") ?: return null
        val on = (p["enabled"] as? JsonPrimitive)?.booleanOrNull ?: return null
        return Triple(uid, kind, on)
    }

    /** The user-facing text of a `call_error` / `call_ended` payload. */
    fun errorText(p: JsonObject): String? = p.str("error") ?: p.str("reason")?.takeIf { it.isNotBlank() }

    /** The UDP media endpoint: host of the REST base URL plus the advertised UDP port. */
    fun mediaEndpoint(serverUrl: String, udpPort: Int): Pair<String, Int>? {
        val host = runCatching { java.net.URI(serverUrl.trim()).host }.getOrNull()?.removeSurrounding("[", "]")?.takeIf { it.isNotBlank() } ?: return null
        return host to udpPort
    }
}
