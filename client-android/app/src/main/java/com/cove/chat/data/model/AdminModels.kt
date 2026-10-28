package com.cove.chat.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Mirrors `ServerInfoResponse`: what the register screen needs before sign-in. */
@Serializable
data class ServerInfo(
    @SerialName("registration_mode") val registrationMode: String = "open",
    @SerialName("needs_owner") val needsOwner: Boolean = false
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
data class InvitesResponse(val invites: List<Invite> = emptyList())

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

@Serializable
data class AuditResponse(val entries: List<AuditEntry> = emptyList())

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
