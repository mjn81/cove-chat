package com.nodetalk.client.data.remote

import com.nodetalk.client.data.local.PreferencesManager
import com.nodetalk.client.data.model.AuthUser
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.CreateChannelRequest
import com.nodetalk.client.data.model.ErrorBody
import com.nodetalk.client.data.model.ExploreChannel
import com.nodetalk.client.data.model.LoginRequest
import com.nodetalk.client.data.model.Message
import com.nodetalk.client.data.model.RegisterRequest
import com.nodetalk.client.data.model.RegisteredUser
import com.nodetalk.client.data.model.ServerVersion
import com.nodetalk.client.data.model.UserSummary
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import com.nodetalk.client.data.model.AddMembersRequest
import com.nodetalk.client.data.model.Relationship
import com.nodetalk.client.data.model.RelationshipActionRequest
import com.nodetalk.client.data.model.UpdateChannelRequest
import com.nodetalk.client.data.model.UpdateProfileRequest
import com.nodetalk.client.data.model.UpdateMemberRequest
import com.nodetalk.client.data.model.UploadedFile
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** A non-2xx API answer. [message] is the backend's `{"error": "..."}` text, safe to show to users. */
class ApiException(message: String, val status: Int) : Exception(message)

class ApiClient(private val prefs: PreferencesManager) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            connectTimeoutMillis = 8_000
            requestTimeoutMillis = 120_000
        }
    }

    private fun url(path: String): String = "${prefs.serverUrl}$path"

    private fun HttpRequestBuilder.bearer() {
        prefs.authToken?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") }
    }

    /** Throws [ApiException] carrying the backend error text for any non-2xx answer. */
    private suspend fun HttpResponse.ok(): HttpResponse {
        if (status.isSuccess()) return this
        val text = runCatching { bodyAsText() }.getOrDefault("")
        val msg = runCatching { json.decodeFromString<ErrorBody>(text).error }.getOrNull()
            ?.takeIf { it.isNotBlank() } ?: "Request failed (${status.value})"
        throw ApiException(msg, status.value)
    }

    suspend fun getVersion(): Result<ServerVersion> = runCatching {
        client.get(url("/api/version")).ok().body()
    }

    /** Logs in and stores the Bearer token (mobile/desktop auth path, no cookies). */
    suspend fun login(req: LoginRequest): Result<AuthUser> = runCatching {
        val resp: AuthUser = client.post(url("/api/login")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }.ok().body()
        resp.token?.let { prefs.authToken = it }
        prefs.userId = resp.id
        prefs.username = resp.username
        prefs.avatarId = resp.avatarId?.takeIf { it.isNotBlank() }
        resp
    }

    suspend fun register(req: RegisterRequest): Result<RegisteredUser> = runCatching {
        client.post(url("/api/register")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }.ok().body()
    }

    suspend fun logout(): Result<Unit> = runCatching {
        client.post(url("/api/logout")) { bearer() }.ok()
        Unit
    }

    suspend fun getMe(): Result<AuthUser> = runCatching {
        client.get(url("/api/me")) { bearer() }.ok().body()
    }

    suspend fun getChannels(): Result<List<Channel>> = runCatching {
        client.get(url("/api/channels")) { bearer() }.ok().body()
    }

    suspend fun createChannel(req: CreateChannelRequest): Result<Channel> = runCatching {
        client.post(url("/api/channels")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(req)
        }.ok().body()
    }

    suspend fun exploreChannels(query: String = ""): Result<List<ExploreChannel>> = runCatching {
        client.get(url("/api/channels/explore")) {
            bearer()
            if (query.isNotBlank()) parameter("q", query)
        }.ok().body()
    }

    suspend fun joinChannel(inviteLink: String): Result<Unit> = runCatching {
        client.post(url("/api/join/$inviteLink")) { bearer() }.ok()
        Unit
    }

    suspend fun leaveChannel(channelId: String, userId: String): Result<Unit> = runCatching {
        client.delete(url("/api/channels/$channelId/members/$userId")) { bearer() }.ok()
        Unit
    }

    suspend fun searchUsers(query: String): Result<List<UserSummary>> = runCatching {
        client.get(url("/api/users")) {
            bearer()
            parameter("q", query)
        }.ok().body()
    }

    /** Newest-first page of messages (backend order); [before] is a message-id cursor. */
    suspend fun getMessages(channelId: String, limit: Int = 50, before: String? = null): Result<List<Message>> = runCatching {
        client.get(url("/api/channels/$channelId/messages")) {
            bearer()
            parameter("limit", limit)
            before?.let { parameter("before", it) }
        }.ok().body()
    }

    // ── Friends ─────────────────────────────────────────────────────────────

    suspend fun getRelationships(): Result<List<Relationship>> = runCatching {
        client.get(url("/api/relationships")) { bearer() }.ok().body<List<Relationship>?>() ?: emptyList()
    }

    suspend fun getIncomingRequests(): Result<List<Relationship>> = runCatching {
        client.get(url("/api/relationships/incoming")) { bearer() }.ok().body<List<Relationship>?>() ?: emptyList()
    }

    /** action: request | accept | decline | cancel | remove | block | unblock */
    suspend fun relationshipAction(userId: String, action: String): Result<Unit> = runCatching {
        client.put(url("/api/users/$userId/relationship")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(RelationshipActionRequest(action))
        }.ok()
        Unit
    }

    // ── Channel management ──────────────────────────────────────────────────

    suspend fun updateChannel(channelId: String, req: UpdateChannelRequest): Result<Unit> = runCatching {
        client.patch(url("/api/channels/$channelId")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(req)
        }.ok()
        Unit
    }

    suspend fun deleteChannel(channelId: String): Result<Unit> = runCatching {
        client.delete(url("/api/channels/$channelId")) { bearer() }.ok()
        Unit
    }

    suspend fun addMembers(channelId: String, userIds: List<String>): Result<Unit> = runCatching {
        client.post(url("/api/channels/$channelId/members")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(AddMembersRequest(userIds))
        }.ok()
        Unit
    }

    suspend fun setMemberRole(channelId: String, userId: String, role: Int): Result<Unit> = runCatching {
        client.patch(url("/api/channels/$channelId/members/$userId")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(UpdateMemberRequest(role))
        }.ok()
        Unit
    }

    // ── Files (end-to-end encrypted blobs) ──────────────────────────────────

    /** Uploads an already compressed + encrypted blob; returns the stored file id. */
    suspend fun uploadFile(blob: ByteArray, mime: String, channelId: String): Result<UploadedFile> = runCatching {
        client.post(url("/api/files")) {
            bearer()
            setBody(MultiPartFormDataContent(formData {
                append("channel_id", channelId)
                append("file", blob, Headers.build {
                    append(HttpHeaders.ContentType, mime)
                    append(HttpHeaders.ContentDisposition, "filename=\"upload.bin\"")
                })
            }))
        }.ok().body()
    }

    /** Downloads the encrypted blob of a file. */
    suspend fun downloadFile(fileId: String): Result<ByteArray> = runCatching {
        client.get(url("/api/files/$fileId")) { bearer() }.ok().body<ByteArray>()
    }

    // ── Profile ─────────────────────────────────────────────────────────────

    suspend fun updateProfile(req: UpdateProfileRequest): Result<AuthUser> = runCatching {
        client.patch(url("/api/users/me")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(req)
        }.ok().body()
    }

    /** Uploads an unencrypted, channel-less file (profile avatars are public to signed-in users). */
    suspend fun uploadAvatar(bytes: ByteArray, mime: String): Result<UploadedFile> = runCatching {
        client.post(url("/api/files")) {
            bearer()
            setBody(MultiPartFormDataContent(formData {
                append("file", bytes, Headers.build {
                    append(HttpHeaders.ContentType, mime)
                    append(HttpHeaders.ContentDisposition, "filename=\"avatar.webp\"")
                })
            }))
        }.ok().body()
    }
}
