package com.nodetalk.client.data.remote

import com.nodetalk.client.crypto.CryptoManager
import com.nodetalk.client.data.local.PreferencesManager
import com.nodetalk.client.data.model.ChannelKeyPayload
import com.nodetalk.client.data.model.Message
import com.nodetalk.client.data.model.MessageDeletePayload
import com.nodetalk.client.data.model.OutboundChatMessagePayload
import com.nodetalk.client.data.model.OutboundDeletePayload
import com.nodetalk.client.data.model.OutboundEditPayload
import com.nodetalk.client.data.model.OutboundWSMessage
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Authenticated duplex channel to the backend hub (`/ws`). Auth uses the same Bearer token as
 * REST (the backend never accepts tokens in the query string).
 */
class WebSocketManager(private val prefs: PreferencesManager) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val client = HttpClient(OkHttp) {
        install(WebSockets) {
            pingIntervalMillis = 25_000
        }
    }

    private var activeSession: DefaultClientWebSocketSession? = null
    private var connectionJob: Job? = null

    private val _messageFlow = MutableSharedFlow<Message>(extraBufferCapacity = 64)
    val messageFlow: SharedFlow<Message> = _messageFlow.asSharedFlow()

    /** `message_update` (edit) events carry the full updated message. */
    private val _messageUpdateFlow = MutableSharedFlow<Message>(extraBufferCapacity = 64)
    val messageUpdateFlow: SharedFlow<Message> = _messageUpdateFlow.asSharedFlow()

    private val _messageDeleteFlow = MutableSharedFlow<MessageDeletePayload>(extraBufferCapacity = 64)
    val messageDeleteFlow: SharedFlow<MessageDeletePayload> = _messageDeleteFlow.asSharedFlow()

    /** Whisper (ephemeral E2EE) relay events, handled by WhisperManager. */
    private val _whisperFlow = MutableSharedFlow<Pair<String, JsonElement>>(extraBufferCapacity = 64)
    val whisperFlow: SharedFlow<Pair<String, JsonElement>> = _whisperFlow.asSharedFlow()

    /** Fires when the channel list changed server-side (joined, kicked, renamed, ...). */
    private val _channelsChangedFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    val channelsChangedFlow: SharedFlow<Unit> = _channelsChangedFlow.asSharedFlow()

    /** (channelId, user ids currently in that channel's call) from `voice_update`. */
    private val _voiceFlow = MutableSharedFlow<Pair<String, List<String>>>(extraBufferCapacity = 64)
    val voiceFlow: SharedFlow<Pair<String, List<String>>> = _voiceFlow.asSharedFlow()

    private val _signalingFlow =MutableSharedFlow<Pair<String, JsonElement>>(extraBufferCapacity = 64)
    val signalingFlow: SharedFlow<Pair<String, JsonElement>> = _signalingFlow.asSharedFlow()

    private val _connectionState = MutableSharedFlow<Boolean>(replay = 1)
    val connectionState: SharedFlow<Boolean> = _connectionState.asSharedFlow()

    /** Starts the reconnect loop. Safe to call repeatedly; only one loop ever runs. */
    fun connect() {
        if (connectionJob?.isActive == true) return
        connectionJob = scope.launch {
            while (isActive) {
                val token = prefs.authToken
                val baseUrl = prefs.serverUrl
                if (token.isNullOrBlank() || baseUrl.isBlank()) {
                    delay(3000)
                    continue
                }

                try {
                    val wsUrl = baseUrl.replaceFirst("http", "ws") + "/ws"
                    client.webSocket(urlString = wsUrl, request = {
                        header("Authorization", "Bearer $token")
                    }) {
                        activeSession = this
                        _connectionState.emit(true)

                        // App-level heartbeat: the hub tracks presence through "ping" frames.
                        val heartbeat = launch {
                            while (isActive) {
                                delay(20_000)
                                sendRaw("""{"type":"ping","payload":{}}""")
                            }
                        }
                        try {
                            for (frame in incoming) {
                                if (frame is Frame.Text) handleIncomingFrame(frame.readText())
                            }
                        } finally {
                            heartbeat.cancel()
                        }
                    }
                } catch (_: Exception) {
                    // fall through to the reconnect backoff below
                } finally {
                    activeSession = null
                    _connectionState.emit(false)
                }
                delay(3000)
            }
        }
    }

    /** Stops the reconnect loop and closes the socket (used on logout / server change). */
    fun disconnect() {
        connectionJob?.cancel()
        connectionJob = null
        activeSession = null
        CryptoManager.clearKeys()
    }

    private suspend fun handleIncomingFrame(rawJson: String) {
        try {
            val root = json.parseToJsonElement(rawJson).jsonObject
            val type = root["type"]?.jsonPrimitive?.content ?: return
            val payload = root["payload"] ?: JsonObject(emptyMap())

            when (type) {
                "channel_key" -> {
                    val keyPayload = json.decodeFromJsonElement<ChannelKeyPayload>(payload)
                    CryptoManager.setChannelKeyBase64(keyPayload.channelId, keyPayload.aesKey)
                }
                "message" -> _messageFlow.emit(json.decodeFromJsonElement<Message>(payload))
                "message_update" -> _messageUpdateFlow.emit(json.decodeFromJsonElement<Message>(payload))
                "message_delete" -> _messageDeleteFlow.emit(json.decodeFromJsonElement<MessageDeletePayload>(payload))
                "channel_update", "channel_delete" -> _channelsChangedFlow.emit(Unit)
                "voice_update" -> {
                    val obj = payload.jsonObject
                    val ch = obj["channel_id"]?.jsonPrimitive?.content ?: return
                    val users = (obj["users"] as? kotlinx.serialization.json.JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
                    _voiceFlow.emit(ch to users)
                }
                "whisper_init", "whisper_accept", "whisper_reject", "whisper_msg", "whisper_close", "whisper_error" ->
                    _whisperFlow.emit(Pair(type, payload))
                // WebRTC signaling events (names match backend/internal/rtc)
                "call_joined", "call_publish_answer", "call_subscribe_offer", "call_ice_candidate",
                "call_participant_joined", "call_participant_left", "call_track_state", "call_error",
                "call_offer", "call_answer", "call_candidate", "call_user_joined", "call_user_left",
                "call_tracks_updated" -> _signalingFlow.emit(Pair(type, payload))
            }
        } catch (_: Exception) {
        }
    }

    /** Encrypts [text] with the channel key and sends it. Returns false if offline or the key is missing. */
    suspend fun sendChatMessage(
        channelId: String,
        text: String,
        type: String = "text",
        compression: String = "none",
        replyToId: String? = null
    ): Boolean {
        val (ciphertext, nonce) = CryptoManager.encryptMessage(channelId, text) ?: return false
        val payload = OutboundChatMessagePayload(
            channelId = channelId,
            type = type,
            ciphertext = ciphertext,
            nonce = nonce,
            compression = compression,
            replyToId = replyToId
        )
        return sendSignaling("message", json.encodeToJsonElement(payload))
    }

    suspend fun editMessage(channelId: String, messageId: String, text: String): Boolean {
        val (ciphertext, nonce) = CryptoManager.encryptMessage(channelId, text) ?: return false
        val payload = OutboundEditPayload(channelId, messageId, ciphertext, nonce)
        return sendSignaling("message_edit", json.encodeToJsonElement(payload))
    }

    /** Marks the channel read for this user (clears the unread badge server-side). */
    suspend fun sendReadReceipt(channelId: String): Boolean =
        sendSignaling("read_receipt", kotlinx.serialization.json.buildJsonObject {
            put("channel_id", kotlinx.serialization.json.JsonPrimitive(channelId))
        })

    suspend fun deleteMessage(channelId: String, messageId: String): Boolean =
        sendSignaling("message_delete", json.encodeToJsonElement(OutboundDeletePayload(channelId, messageId)))

    suspend fun sendSignaling(type: String, payload: JsonElement): Boolean {
        val outMsg = OutboundWSMessage(type = type, payload = payload)
        return sendRaw(json.encodeToString(OutboundWSMessage.serializer(), outMsg))
    }

    private suspend fun sendRaw(text: String): Boolean {
        val session = activeSession ?: return false
        return try {
            session.send(Frame.Text(text))
            true
        } catch (_: Exception) {
            false
        }
    }
}
