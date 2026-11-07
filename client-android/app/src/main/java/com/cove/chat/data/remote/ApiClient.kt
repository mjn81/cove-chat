package com.cove.chat.data.remote

import com.cove.chat.data.local.PreferencesManager
import com.cove.chat.data.model.AuthUser
import com.cove.chat.ui.components.t
import com.cove.chat.data.model.AdminAccount
import com.cove.chat.data.model.AdminOverview
import com.cove.chat.data.model.AdminsResponse
import com.cove.chat.data.model.AuditEntry
import com.cove.chat.data.model.MAX_PAGE_LIMIT
import com.cove.chat.data.model.PageResponse
import com.cove.chat.data.model.collectAllPages
import com.cove.chat.data.model.DeleteAccountRequest
import com.cove.chat.data.model.BackupRequest
import com.cove.chat.data.model.ConfigResponse
import com.cove.chat.data.model.ConfigSetting
import com.cove.chat.data.model.ConfirmRequest
import com.cove.chat.data.model.CreateInviteRequest
import com.cove.chat.data.model.Invite
import com.cove.chat.data.model.NoticeRequest
import com.cove.chat.data.model.NoticeResult
import com.cove.chat.data.model.PasswordRequest
import com.cove.chat.data.model.ServerUpdateInfo
import com.cove.chat.data.model.ServerUpdateStarted
import com.cove.chat.data.model.ServerUploadInfo
import com.cove.chat.data.model.StartUpdateRequest
import com.cove.chat.data.CaptchaChallenge
import com.cove.chat.data.model.ServerInfo
import com.cove.chat.data.model.TransferOwnerRequest
import com.cove.chat.data.model.UpdateConfigRequest
import com.cove.chat.data.model.UpdateConfigResult
import io.ktor.http.encodeURLPath
import kotlinx.serialization.json.JsonElement
import com.cove.chat.data.model.Channel
import com.cove.chat.data.model.CreateChannelRequest
import com.cove.chat.data.model.ErrorBody
import com.cove.chat.data.model.ExploreChannel
import com.cove.chat.data.model.LoginRequest
import com.cove.chat.data.model.Message
import com.cove.chat.data.model.RegisterRequest
import com.cove.chat.data.model.RegisteredUser
import com.cove.chat.data.model.ServerVersion
import com.cove.chat.data.model.UserSummary
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.DefaultRequest
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
import com.cove.chat.data.model.AddMembersRequest
import com.cove.chat.data.model.Relationship
import com.cove.chat.data.model.RelationshipActionRequest
import com.cove.chat.data.model.UpdateChannelRequest
import com.cove.chat.data.model.SessionInfo
import com.cove.chat.data.model.AddMembersResponse
import com.cove.chat.data.model.InvitePreview
import com.cove.chat.data.model.UpdateProfileRequest
import com.cove.chat.data.model.UpdateMemberRequest
import com.cove.chat.data.model.UploadedFile
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** A non-2xx API answer. [message] is the backend's `{"error": "..."}` text, safe to show to users. */
class ApiException(message: String, val status: Int, val code: String? = null) : Exception(message)

class ApiClient(private val prefs: PreferencesManager) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    /** "Google Pixel 8 (Android 15)": what the user sees in their Devices list. */
    private val deviceLabel: String by lazy {
        val maker = android.os.Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = android.os.Build.MODEL.removePrefix(android.os.Build.MANUFACTURER).trim()
        "$maker $model (Android ${android.os.Build.VERSION.RELEASE})"
    }

    private val appVersion: String? by lazy {
        val app = com.cove.chat.CoveApp.instance
        runCatching { app.packageManager.getPackageInfo(app.packageName, 0).versionName }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    private val appLabel: String by lazy { appVersion?.let { "Cove Android $it" } ?: "Cove Android" }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        // The server records these at login for the Devices list and login notices.
        install(DefaultRequest) {
            header("X-Cove-Device", deviceLabel)
            header("X-Cove-App", appLabel)
            // Lets the server warn or refuse outdated clients (docs/api-standard.md).
            header(ApiStandard.CLIENT_HEADER, ApiStandard.clientHeader(appVersion ?: "0.0.0"))
        }
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
        val body = runCatching { json.decodeFromString<ErrorBody>(text) }.getOrNull()
        // The backend sends i18n keys for its user-facing errors; show them in the app language.
        val msg = body?.error?.takeIf { it.isNotBlank() }?.let { ApiErrors.localize(it, ::t) } ?: "Request failed (${status.value})"
        val code = body?.code?.takeIf { it.isNotBlank() }
        // 426 / client_outdated: tell the root UI to explain it instead of leaving every screen with a vague failure.
        if (ApiStandard.isClientOutdated(status.value, code)) ClientOutdatedState.report(ApiStandard.minClientVersion(body?.details))
        throw ApiException(msg, status.value, code)
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
        prefs.serverRole = resp.serverRole.orEmpty()
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
        client.get(url("/api/me")) { bearer() }.ok().body<AuthUser>().also { prefs.serverRole = it.serverRole.orEmpty() }
    }

    /** The signed-in devices of this account, most recently active first. */
    suspend fun getSessions(): Result<List<SessionInfo>> = runCatching {
        client.get(url("/api/sessions")) { bearer() }.ok().body()
    }

    /** Ends one of this account's sessions by its public id. */
    suspend fun terminateSession(id: String): Result<Unit> = runCatching {
        client.delete(url("/api/sessions/$id")) { bearer() }.ok()
        Unit
    }

    /**
     * Deletes this account. The server re-checks [password] (step-up), so a stolen session cannot erase it:
     * a wrong password is a 403 ApiException, repeated failures a 429.
     */
    suspend fun deleteAccount(password: String): Result<Unit> = runCatching {
        client.delete(url("/api/users/me")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(DeleteAccountRequest(password))
        }.ok()
        Unit
    }

    /** Ends every session except this phone's. */
    suspend fun terminateOtherSessions(): Result<Unit> = runCatching {
        client.post(url("/api/sessions/terminate-others")) { bearer() }.ok()
        Unit
    }

    /** One page of a paged list endpoint (API standard section 9); [query] adds endpoint specific parameters. */
    private suspend inline fun <reified T> page(
        path: String,
        cursor: String?,
        limit: Int = MAX_PAGE_LIMIT,
        crossinline extra: HttpRequestBuilder.() -> Unit = {}
    ): PageResponse<T> = client.get(url(path)) {
        bearer()
        parameter("limit", limit)
        cursor?.let { parameter("cursor", it) }
        extra()
    }.ok().body()

    suspend fun getChannels(): Result<List<Channel>> = runCatching {
        collectAllPages { c -> page<Channel>("/api/channels", c) }
    }

    suspend fun createChannel(req: CreateChannelRequest): Result<Channel> = runCatching {
        client.post(url("/api/channels")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(req)
        }.ok().body()
    }

    /** A search palette never needs more than a few pages, so the walk is bounded (500 results). */
    suspend fun exploreChannels(query: String = ""): Result<List<ExploreChannel>> = runCatching {
        collectAllPages(maxPages = 5) { c ->
            page<ExploreChannel>("/api/channels/explore", c) { if (query.isNotBlank()) parameter("q", query) }
        }
    }

    /** Joins the channel behind an invite link and returns it. */
    suspend fun joinChannel(inviteLink: String): Result<Channel> = runCatching {
        client.post(url("/api/join/$inviteLink")) { bearer() }.ok().body()
    }

    /** What an invite link points to (name, photo, member count, whether you are already in it). */
    suspend fun previewInvite(inviteLink: String): Result<InvitePreview> = runCatching {
        client.get(url("/api/join/$inviteLink")) { bearer() }.ok().body()
    }

    /** Replaces a channel's invite link (admins); the old link stops working. Returns the updated channel. */
    suspend fun regenerateInvite(channelId: String): Result<Channel> = runCatching {
        client.post(url("/api/channels/$channelId/invite/regenerate")) { bearer() }.ok().body()
    }

    suspend fun leaveChannel(channelId: String, userId: String): Result<Unit> = runCatching {
        client.delete(url("/api/channels/$channelId/members/$userId")) { bearer() }.ok()
        Unit
    }

    /** The server caps a user search at 50 results in total, so this is at most one page. */
    suspend fun searchUsers(query: String): Result<List<UserSummary>> = runCatching {
        collectAllPages { c -> page<UserSummary>("/api/users", c) { parameter("q", query) } }
    }

    /**
     * Newest-first page of messages. [cursor] is the previous page's `nextCursor` (opaque); the answer's
     * [PageResponse.nextCursor] leads to the next older page and is empty once the conversation start is reached.
     */
    suspend fun getMessages(channelId: String, limit: Int = 50, cursor: String? = null): Result<PageResponse<Message>> = runCatching {
        page<Message>("/api/channels/$channelId/messages", cursor, limit)
    }

    // ── Friends ─────────────────────────────────────────────────────────────

    suspend fun getRelationships(): Result<List<Relationship>> = runCatching {
        collectAllPages { c -> page<Relationship>("/api/relationships", c) }
    }

    suspend fun getIncomingRequests(): Result<List<Relationship>> = runCatching {
        collectAllPages { c -> page<Relationship>("/api/relationships/incoming", c) }
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

    suspend fun addMembers(channelId: String, userIds: List<String>): Result<AddMembersResponse> = runCatching {
        client.post(url("/api/channels/$channelId/members")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(AddMembersRequest(userIds))
        }.ok().body()
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
    suspend fun uploadFile(
        blob: ByteArray, mime: String, channelId: String, isVideo: Boolean = false,
        thumbCipher: String? = null, thumbNonce: String? = null
    ): Result<UploadedFile> = runCatching {
        client.post(url("/api/files")) {
            bearer()
            setBody(MultiPartFormDataContent(formData {
                append("channel_id", channelId)
                if (isVideo) append("is_video", "true")
                // Encrypted preview (blur thumbnail or voice waveform peaks), same fields the web client sends.
                thumbCipher?.let { append("thumb_ciphertext", it) }
                thumbNonce?.let { append("thumb_nonce", it) }
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

    // ── Server administration (owner / admin only; the server enforces the role) ──

    /** Public: whether sign-up is open, invite-only or closed, and whether the next account becomes the owner. */
    suspend fun getServerInfo(): Result<ServerInfo> = runCatching {
        client.get(url("/api/server-info")).ok().body()
    }

    /** Fetches a sign-up proof-of-work challenge; fails when the server has the check turned off (404). */
    suspend fun getCaptchaChallenge(): Result<CaptchaChallenge> = runCatching {
        client.get(url("/api/captcha/challenge")).ok().body()
    }

    suspend fun adminOverview(): Result<AdminOverview> = runCatching {
        client.get(url("/api/admin/overview")) { bearer() }.ok().body()
    }

    suspend fun adminConfig(): Result<List<ConfigSetting>> = runCatching {
        client.get(url("/api/admin/config")) { bearer() }.ok().body<ConfigResponse>().settings
    }

    /** [password] is only needed when a change touches an owner-only setting. */
    suspend fun adminUpdateConfig(changes: Map<String, JsonElement>, password: String? = null): Result<UpdateConfigResult> = runCatching {
        client.patch(url("/api/admin/config")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(UpdateConfigRequest(changes, password))
        }.ok().body()
    }

    suspend fun adminInvites(): Result<List<Invite>> = runCatching {
        collectAllPages { c -> page<Invite>("/api/admin/invites", c) }
    }

    suspend fun adminCreateInvite(req: CreateInviteRequest): Result<Invite> = runCatching {
        client.post(url("/api/admin/invites")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(req)
        }.ok().body()
    }

    suspend fun adminRevokeInvite(code: String): Result<Unit> = runCatching {
        client.delete(url("/api/admin/invites/${code.encodeURLPath()}")) { bearer() }.ok()
        Unit
    }

    suspend fun adminAudit(): Result<List<AuditEntry>> = runCatching {
        // The panel shows the recent trail; the walk is bounded (500 entries) instead of paging on scroll.
        collectAllPages(maxPages = 5) { c -> page<AuditEntry>("/api/admin/audit", c) }
    }

    suspend fun adminAdmins(): Result<List<AdminAccount>> = runCatching {
        client.get(url("/api/admin/admins")) { bearer() }.ok().body<AdminsResponse>().admins
    }

    suspend fun adminGrant(username: String, password: String): Result<Unit> = runCatching {
        client.put(url("/api/admin/admins/${username.encodeURLPath()}")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(PasswordRequest(password))
        }.ok()
        Unit
    }

    suspend fun adminRevoke(username: String, password: String): Result<Unit> = runCatching {
        client.delete(url("/api/admin/admins/${username.encodeURLPath()}")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(PasswordRequest(password))
        }.ok()
        Unit
    }

    suspend fun adminTransferOwner(username: String, password: String): Result<Unit> = runCatching {
        client.post(url("/api/admin/owner/transfer")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(TransferOwnerRequest(username, password, "TRANSFER"))
        }.ok()
        Unit
    }

    /** The encrypted archive bytes, protected by [passphrase]. */
    suspend fun adminBackup(password: String, passphrase: String): Result<ByteArray> = runCatching {
        client.post(url("/api/admin/backup")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(BackupRequest(password, passphrase))
        }.ok().body<ByteArray>()
    }

    /** Replaces ALL server data with an encrypted backup; the server then ends every session. */
    suspend fun adminRestore(file: ByteArray, passphrase: String, password: String): Result<Unit> = runCatching {
        client.post(url("/api/admin/restore")) {
            bearer()
            setBody(MultiPartFormDataContent(formData {
                append("passphrase", passphrase)
                append("password", password)
                append("confirm", "RESTORE")
                append("file", file, Headers.build {
                    append(HttpHeaders.ContentType, "application/octet-stream")
                    append(HttpHeaders.ContentDisposition, "filename=\"restore.cove-backup\"")
                })
            }))
        }.ok()
        Unit
    }

    suspend fun adminReset(password: String, confirm: String): Result<Unit> = runCatching {
        client.post(url("/api/admin/reset")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(ConfirmRequest(password, confirm))
        }.ok()
        Unit
    }

    suspend fun adminDeleteServer(password: String, confirm: String): Result<Unit> = runCatching {
        client.post(url("/api/admin/delete")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(ConfirmRequest(password, confirm))
        }.ok()
        Unit
    }

    /** Owner only: delivers [text] from the server's Cove account to every user's Cove chat. */
    suspend fun adminSendNotice(text: String): Result<NoticeResult> = runCatching {
        client.post(url("/api/admin/notices")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(NoticeRequest(text))
        }.ok().body()
    }

    /** Installed vs latest server release; [refresh] bypasses the server's 10-minute release cache. */
    suspend fun adminUpdateInfo(refresh: Boolean = false): Result<ServerUpdateInfo> = runCatching {
        client.get(url("/api/admin/update")) {
            bearer()
            if (refresh) parameter("refresh", 1)
        }.ok().body()
    }

    /** Owner only: [source] is `release` or `upload`; the password is required because the program file is replaced. */
    suspend fun adminStartUpdate(source: String, password: String): Result<ServerUpdateStarted> = runCatching {
        client.post(url("/api/admin/update")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(StartUpdateRequest(source, password))
        }.ok().body()
    }

    /** Owner only, non-Docker installs: stages a release zip or binary for an offline update; nothing is applied yet. */
    suspend fun adminUploadUpdate(
        file: ByteArray, version: String, password: String, sha256: String?, sums: String?
    ): Result<ServerUploadInfo> = runCatching {
        client.post(url("/api/admin/update/upload")) {
            bearer()
            // The server checks the password before reading the file, so the small fields go first and the file last.
            setBody(MultiPartFormDataContent(formData {
                append("password", password)
                append("version", version)
                sha256?.let { append("sha256", it) }
                sums?.let { append("sums", it) }
                append("file", file, Headers.build {
                    append(HttpHeaders.ContentType, "application/octet-stream")
                    append(HttpHeaders.ContentDisposition, "filename=\"update.bin\"")
                })
            }))
        }.ok().body<UploadResponse>().upload
    }

    /** Owner only: gracefully restarts the server process; it answers first and goes down a moment later. */
    suspend fun adminRestartServer(password: String): Result<Unit> = runCatching {
        client.post(url("/api/admin/restart")) {
            contentType(ContentType.Application.Json)
            bearer()
            setBody(PasswordRequest(password))
        }.ok()
        Unit
    }
}

@kotlinx.serialization.Serializable
private data class UploadResponse(val status: String = "", val upload: ServerUploadInfo)
