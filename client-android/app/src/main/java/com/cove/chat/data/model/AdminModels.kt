package com.cove.chat.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Mirrors `ServerInfoResponse`: what the register screen needs before sign-in. */
@Serializable
data class ServerInfo(
    @SerialName("registration_mode") val registrationMode: String = "open",
    @SerialName("needs_owner") val needsOwner: Boolean = false,
    /** True when an admin turned on the sign-up proof-of-work check; the app solves it automatically. */
    @SerialName("captcha_required") val captchaRequired: Boolean = false
)

@Serializable
data class AdminOverview(
    val version: String = "",
    val domain: String = "",
    val users: Int = 0,
    val channels: Int = 0,
    @SerialName("active_invites") val activeInvites: Int = 0,
    @SerialName("registration_mode") val registrationMode: String = "open",
    @SerialName("uptime_seconds") val uptimeSeconds: Long = 0,
    @SerialName("data_size_bytes") val dataSizeBytes: Long = 0
)

/** One schema-driven setting from `GET /api/admin/config`; [type] is enum, int, bool or string. */
@Serializable
data class ConfigSetting(
    val key: String,
    val group: String = "",
    val type: String = "string",
    val options: List<String>? = null,
    val min: Long? = null,
    val max: Long? = null,
    @SerialName("owner_only") val ownerOnly: Boolean = false,
    @SerialName("restart_required") val restartRequired: Boolean = false,
    val value: JsonElement
)

@Serializable
data class ConfigResponse(val settings: List<ConfigSetting> = emptyList())

@Serializable
data class UpdateConfigRequest(val changes: Map<String, JsonElement>, val password: String? = null)

@Serializable
data class UpdateConfigResult(
    val applied: List<String> = emptyList(),
    @SerialName("restart_required") val restartRequired: List<String> = emptyList()
)

@Serializable
data class Invite(
    val code: String,
    val note: String? = null,
    @SerialName("created_by") val createdBy: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("expires_at") val expiresAt: String? = null,
    /** 0 means unlimited. */
    @SerialName("max_uses") val maxUses: Int = 0,
    val uses: Int = 0,
    val revoked: Boolean = false,
    val source: String = "panel",
    val status: String = "active"
)

@Serializable
data class CreateInviteRequest(
    val code: String? = null,
    val note: String? = null,
    @SerialName("max_uses") val maxUses: Int,
    @SerialName("expires_at") val expiresAt: String? = null
)

@Serializable
data class AuditEntry(
    val id: String = "",
    val at: String = "",
    @SerialName("actor_id") val actorId: String = "",
    @SerialName("actor_name") val actorName: String = "",
    val action: String = "",
    val target: String? = null
)

/** Body of `DELETE /api/users/me`: the current password (step-up). */
@Serializable
data class DeleteAccountRequest(val password: String)

@Serializable
data class AdminAccount(val id: String, val username: String, val role: String = "admin")

@Serializable
data class AdminsResponse(val admins: List<AdminAccount> = emptyList())

/** Body for the step-up calls: the password is re-verified by the server on each one. */
@Serializable
data class PasswordRequest(val password: String)

@Serializable
data class TransferOwnerRequest(val username: String, val password: String, val confirm: String)

@Serializable
data class BackupRequest(val password: String, val passphrase: String)

@Serializable
data class ConfirmRequest(val password: String, val confirm: String)

/** `POST /api/admin/notices` result: how many users got the server notice and how many deliveries failed. */
@Serializable
data class NoticeResult(val recipients: Int = 0, val failed: Int = 0)

/** A release file the owner uploaded for an offline install. */
@Serializable
data class ServerUploadInfo(
    val version: String = "",
    val verified: Boolean = false,
    val sha256: String = "",
    val kind: String = "zip",
    @SerialName("size_bytes") val sizeBytes: Long = 0
)

/** `GET /api/admin/update`: installed vs latest release, how this server can update, and the running job. */
@Serializable
data class ServerUpdateInfo(
    @SerialName("current_version") val currentVersion: String = "",
    @SerialName("latest_version") val latestVersion: String = "",
    @SerialName("update_available") val updateAvailable: Boolean = false,
    @SerialName("release_notes") val releaseNotes: String = "",
    @SerialName("release_url") val releaseUrl: String? = null,
    val prerelease: Boolean = false,
    @SerialName("check_error") val checkError: String? = null,
    /** `binary`, `docker` or `unknown`. */
    val mode: String = "unknown",
    @SerialName("can_update") val canUpdate: Boolean = false,
    /** Why [canUpdate] is false: docker, unsupported, up_to_date or busy. */
    val reason: String? = null,
    val instructions: String? = null,
    @SerialName("can_restart") val canRestart: Boolean = false,
    /** `manifest` or `github`. */
    val source: String? = null,
    val uploaded: ServerUploadInfo? = null,
    /** idle, downloading, installing, restarting or failed. */
    val state: String = "idle",
    @SerialName("progress_percent") val progressPercent: Int = 0,
    val error: String? = null
)

@Serializable
data class ServerUpdateStarted(val status: String = "", val version: String = "", val state: String = "")

@Serializable
data class NoticeRequest(val text: String)


@Serializable
data class StartUpdateRequest(val source: String, val password: String)
