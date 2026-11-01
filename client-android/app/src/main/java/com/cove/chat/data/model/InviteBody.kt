package com.cove.chat.data.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

private val CODE_PATTERN = Regex("^[a-zA-Z0-9-]+$")

/**
 * Body of an `invite` message (before encryption); the same JSON the web client writes (`invite-message.ts`).
 * The receiving card loads fresh channel details from the server, so [name] and [avatarId] are only a fallback.
 */
fun encodeInvite(code: String, name: String?, avatarId: String?): String = buildJsonObject {
    put("code", code)
    if (name != null) put("name", name)
    if (avatarId != null) put("avatar_id", avatarId)
}.toString()

/** The invite code inside a decrypted `invite` message, or null when the body is not a valid invite. */
fun parseInviteCode(body: String): String? {
    val obj = runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return null
    val code = (obj["code"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: return null
    return code.takeIf { CODE_PATTERN.matches(it) }
}
