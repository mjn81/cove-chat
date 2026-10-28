package com.cove.chat.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Mirrors `LoginResponse` in backend/internal/api/types.go (login also returns the Bearer token). */
@Serializable
data class AuthUser(
    val id: String,
    val username: String,
    val domain: String = "localhost",
    val status: String = "online",
    @SerialName("status_preference") val statusPreference: String = "auto",
    @SerialName("avatar_id") val avatarId: String? = null,
    @SerialName("custom_msg") val customMsg: String? = null,
    @SerialName("avatar_ids") val avatarIds: List<String>? = null,
    @SerialName("banner_color") val bannerColor: String? = null,
    @SerialName("allow_channel_adds") val allowChannelAdds: String? = null,
    @SerialName("dm_permission") val dmPermission: String? = null,
    @SerialName("friend_request_permission") val friendRequestPermission: String? = null,
    /** "owner" or "admin" for server administrators, empty for everyone else. UI gating only; the server enforces it. */
    @SerialName("server_role") val serverRole: String? = null,
    val token: String? = null
)

/** Mirrors `RegisterResponse`. */
@Serializable
data class RegisteredUser(
    val id: String,
    val username: String
)

/** Mirrors `UserResponse` (search results, profiles). */
@Serializable
data class UserSummary(
    val id: String,
    val username: String,
    val domain: String = "localhost",
    val status: String = "offline",
    @SerialName("avatar_id") val avatarId: String? = null,
    @SerialName("custom_msg") val customMsg: String? = null,
    @SerialName("banner_color") val bannerColor: String? = null
)

@Serializable
data class ErrorBody(val error: String = "")

@Serializable
data class LoginRequest(
    val username: String,
    val password: String
)

@Serializable
data class RegisterRequest(
    val username: String,
    val password: String,
    @SerialName("invite_code") val inviteCode: String? = null
)

@Serializable
data class ServerVersion(
    val version: String,
    @SerialName("udp_port") val udpPort: Int = 9090
)

/** Mirrors `ChannelResponse`. A DM is a channel with 2 members and an empty name. */
@Serializable
data class Channel(
    val id: String,
    val name: String = "",
    val description: String = "",
    @SerialName("is_private") val isPrivate: Boolean = false,
    @SerialName("invite_link") val inviteLink: String? = null,
    @SerialName("creator_id") val creatorId: String = "",
    @SerialName("user_role") val userRole: Int = 0,
    val members: List<String> = emptyList(),
    @SerialName("member_names") val memberNames: Map<String, String> = emptyMap(),
    @SerialName("member_avatars") val memberAvatars: Map<String, String> = emptyMap(),
    @SerialName("member_roles") val memberRoles: Map<String, Int> = emptyMap(),
    @SerialName("member_statuses") val memberStatuses: Map<String, String> = emptyMap(),
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("unread_count") val unreadCount: Int = 0,
    @SerialName("last_message_at") val lastMessageAt: String = "",
    @SerialName("last_message_ciphertext") val lastMessageCiphertext: String? = null,
    @SerialName("last_message_nonce") val lastMessageNonce: String? = null,
    @SerialName("last_message_type") val lastMessageType: String? = null,
    @SerialName("last_message_sender_id") val lastMessageSenderId: String? = null
) {
    /** Same rule as `isDirectMessage` in client-web/src/utils/channel.ts. */
    val isDirectMessage: Boolean get() = members.size == 2 && name.isBlank()

    /** Same rule as `getChannelDisplayName` in client-web/src/utils/channel.ts. */
    fun displayName(currentUserId: String?): String {
        if (isDirectMessage) {
            val other = members.firstOrNull { it != currentUserId }
            return memberNames[other] ?: other ?: "Unknown"
        }
        return name.ifBlank { "Group (${members.size})" }
    }
}

@Serializable
data class ExploreChannel(
    val id: String,
    val name: String = "",
    val description: String = "",
    @SerialName("invite_link") val inviteLink: String = "",
    @SerialName("member_count") val memberCount: Int = 0
)

@Serializable
data class CreateChannelRequest(
    val name: String,
    val description: String = "",
    val members: List<String> = emptyList(),
    @SerialName("is_private") val isPrivate: Boolean = false
)

@Serializable
data class Message(
    val id: String,
    @SerialName("channel_id") val channelId: String,
    @SerialName("sender_id") val senderId: String,
    val type: String = "text", // "text", "file", "voice", "video"
    val ciphertext: String,     // Base64-encoded AES-256-GCM ciphertext
    val nonce: String,          // Base64-encoded 12-byte IV
    val compression: String = "none",
    @SerialName("sent_at") val sentAt: String = "",
    @SerialName("edited_at") val editedAt: String? = null,
    @SerialName("reply_to_id") val replyToId: String? = null
)

/** Payload of the `message_delete` WebSocket event. */
@Serializable
data class MessageDeletePayload(
    @SerialName("channel_id") val channelId: String,
    @SerialName("message_id") val messageId: String
)

/** Payload of the `message_edit` WebSocket request. */
@Serializable
data class OutboundEditPayload(
    @SerialName("channel_id") val channelId: String,
    @SerialName("message_id") val messageId: String,
    val ciphertext: String,
    val nonce: String
)

@Serializable
data class OutboundDeletePayload(
    @SerialName("channel_id") val channelId: String,
    @SerialName("message_id") val messageId: String
)

@Serializable
data class OutboundWSMessage(
    val type: String,
    val payload: JsonElement
)

@Serializable
data class OutboundChatMessagePayload(
    @SerialName("channel_id") val channelId: String,
    val type: String = "text",
    val ciphertext: String,
    val nonce: String,
    val compression: String = "none",
    @SerialName("reply_to_id") val replyToId: String? = null
)

// ── WebRTC SFU Signaling Models ──────────────────────────────────────────────

@Serializable
data class IceServer(
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null
)

@Serializable
data class CallJoinedPayload(
    @SerialName("channel_id") val channelId: String,
    @SerialName("ice_servers") val iceServers: List<IceServer> = emptyList(),
    @SerialName("existing_publishers") val existingPublishers: List<String> = emptyList()
)

@Serializable
data class CallOfferPayload(
    @SerialName("channel_id") val channelId: String,
    val sdp: String,
    val kind: String = "offer",
    val target: String? = null
)

@Serializable
data class CallAnswerPayload(
    @SerialName("channel_id") val channelId: String,
    val sdp: String,
    val target: String? = null
)

@Serializable
data class CallCandidatePayload(
    @SerialName("channel_id") val channelId: String,
    val candidate: String,
    @SerialName("sdp_mid") val sdpMid: String? = null,
    @SerialName("sdp_mline_index") val sdpMLineIndex: Int = 0,
    val target: String? = null
)

@Serializable
data class ChannelKeyPayload(
    @SerialName("channel_id") val channelId: String,
    @SerialName("aes_key") val aesKey: String // Base64 32-byte key
)

// ── Friends / relationships (RelationshipResponse) ───────────────────────────

@Serializable
data class Relationship(
    @SerialName("from_user_id") val fromUserId: String,
    @SerialName("to_user_id") val toUserId: String,
    val type: String = "none", // none | requested | friend | blocked
    val user: UserSummary? = null
)

@Serializable
data class RelationshipActionRequest(val action: String)

// ── Channel management ──────────────────────────────────────────────────────

@Serializable
data class UpdateChannelRequest(
    val name: String? = null,
    val description: String? = null,
    @SerialName("is_private") val isPrivate: Boolean? = null
)

@Serializable
data class AddMembersRequest(@SerialName("user_ids") val userIds: List<String>)

@Serializable
data class UpdateMemberRequest(val role: Int)

// ── Files ───────────────────────────────────────────────────────────────────

@Serializable
data class UploadedFile(
    val id: String,
    val size: Long = 0,
    val mime: String = ""
)

/**
 * JSON carried (encrypted) in a `type = "file"` message; same shape the web client builds in
 * ChatInputArea. `size` is the size of the original bytes, needed to inflate the zstd payload.
 */
@Serializable
data class FileMeta(
    @SerialName("file_id") val fileId: String,
    val name: String = "file",
    val mime: String = "application/octet-stream",
    val size: Long = 0,
    val nonce: String,
    @SerialName("thumb_ciphertext") val thumbCiphertext: String? = null,
    @SerialName("thumb_nonce") val thumbNonce: String? = null,
    @SerialName("as_document") val asDocument: Boolean? = null,
    val duration: Int? = null,
    @SerialName("processing_status") val processingStatus: String? = null
)

/** Body of `PATCH /api/users/me`; only non-null fields are sent (backend treats them as optional). */
@Serializable
data class UpdateProfileRequest(
    val username: String? = null,
    val password: String? = null,
    @SerialName("old_password") val oldPassword: String? = null,
    @SerialName("avatar_id") val avatarId: String? = null,
    @SerialName("avatar_ids") val avatarIds: List<String>? = null,
    @SerialName("banner_color") val bannerColor: String? = null,
    @SerialName("custom_msg") val customMsg: String? = null,
    @SerialName("status_preference") val statusPreference: String? = null,
    @SerialName("allow_channel_adds") val allowChannelAdds: String? = null,
    @SerialName("dm_permission") val dmPermission: String? = null,
    @SerialName("friend_request_permission") val friendRequestPermission: String? = null
)
