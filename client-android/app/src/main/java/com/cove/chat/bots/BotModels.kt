package com.cove.chat.bots

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/*
 * DTOs of the Bot API (docs/bots-api.md). Field names mirror the backend JSON; every field has a default so a newer
 * server that adds fields, or leaves optional ones out, still parses (the client uses ignoreUnknownKeys).
 */

/** One button of a bot message or action menu: a callback ([customId]) or a link ([url]), never both. */
@Serializable
data class BotButton(
    val label: String,
    val style: String = "secondary",
    @SerialName("custom_id") val customId: String? = null,
    val url: String? = null,
    val disabled: Boolean = false
)

/** The decrypted JSON body of a `bot` message. */
data class BotMessageBody(val text: String, val buttons: List<List<BotButton>>)

@Serializable
data class CommandChoice(val name: String, val value: String)

@Serializable
data class CommandOption(
    val name: String,
    val description: String = "",
    val type: String = "string", // string | integer | number | boolean | user
    val required: Boolean = false,
    val choices: List<CommandChoice> = emptyList()
)

/** A slash command usable in a channel (`GET /api/channels/{id}/commands`). */
@Serializable
data class ChannelCommand(
    @SerialName("bot_id") val botId: String,
    @SerialName("bot_username") val botUsername: String,
    val name: String,
    val description: String = "",
    val options: List<CommandOption> = emptyList()
)

@Serializable
data class CommandsResponse(val items: List<ChannelCommand> = emptyList())

/** A bot account as its owner (or a channel admin picking one to install) sees it. */
@Serializable
data class Bot(
    val id: String,
    val username: String,
    val description: String = "",
    @SerialName("avatar_id") val avatarId: String? = null,
    @SerialName("owner_id") val ownerId: String = "",
    val public: Boolean = false,
    val disabled: Boolean = false,
    @SerialName("webhook_url") val webhookUrl: String? = null,
    val online: Boolean = false,
    @SerialName("install_count") val installCount: Int = 0,
    /** Global slash commands the bot registered (shown in Explore). */
    @SerialName("command_count") val commandCount: Int = 0
)

/** `GET /api/bots`: a page plus what the caller may do. */
@Serializable
data class BotPage(
    val items: List<Bot> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
    @SerialName("can_create") val canCreate: Boolean = false,
    @SerialName("max_per_user") val maxPerUser: Int = 0,
    val enabled: Boolean = true
)

@Serializable
data class CreateBotRequest(
    val username: String,
    val description: String? = null,
    val public: Boolean? = null,
    @SerialName("webhook_url") val webhookUrl: String? = null
)

/** Returned once: the token and (with a webhook) the signing secret are never shown again. */
@Serializable
data class CreateBotResponse(
    val bot: Bot,
    val token: String,
    @SerialName("webhook_secret") val webhookSecret: String? = null
)

@Serializable
data class UpdateBotRequest(
    val description: String? = null,
    val public: Boolean? = null,
    val disabled: Boolean? = null,
    @SerialName("webhook_url") val webhookUrl: String? = null,
    @SerialName("rotate_webhook_secret") val rotateWebhookSecret: Boolean? = null
)

@Serializable
data class UpdateBotResponse(
    val bot: Bot,
    @SerialName("webhook_secret") val webhookSecret: String? = null
)

@Serializable
data class BotTokenResponse(val token: String)

@Serializable
data class ChannelBot(
    val bot: Bot,
    val scopes: List<String> = emptyList(),
    @SerialName("installed_by") val installedBy: String = ""
)

@Serializable
data class ChannelBotsResponse(val items: List<ChannelBot> = emptyList())

@Serializable
data class InstallBotRequest(val scopes: List<String>)

/** An action menu a bot shows in a channel; it replaces the composer's input area. */
@Serializable
data class BotKeyboard(
    @SerialName("bot_id") val botId: String,
    @SerialName("bot_username") val botUsername: String = "",
    val rows: List<List<BotButton>> = emptyList(),
    val placeholder: String = "",
    val persistent: Boolean = false,
    @SerialName("one_time") val oneTime: Boolean = false
)

@Serializable
data class KeyboardsResponse(val items: List<BotKeyboard> = emptyList())

/** Payload of the `keyboard_update` WebSocket event; [keyboard] is null when the bot removed its menu. */
@Serializable
data class KeyboardUpdate(
    @SerialName("channel_id") val channelId: String,
    @SerialName("bot_id") val botId: String,
    val keyboard: BotKeyboard? = null
)

@Serializable
data class InteractionRequest(
    val type: String, // command | button | keyboard
    @SerialName("bot_id") val botId: String,
    val command: String? = null,
    val options: Map<String, JsonElement>? = null,
    @SerialName("message_id") val messageId: String? = null,
    @SerialName("custom_id") val customId: String? = null
)

/** [delivered] is false when the bot is offline and has no webhook, so nothing will answer. */
@Serializable
data class InteractionResult(val id: String = "", val delivered: Boolean = false)

/** `POST /api/bots/{id}/start`: the DM opened with a bot from Explore. [delivered] is false when the bot is offline. */
@Serializable
data class StartBotResult(
    @SerialName("channel_id") val channelId: String,
    val created: Boolean = false,
    val delivered: Boolean = false
)

/** Install scopes (`messages.send` is the default). */
object BotScopes {
    const val SEND = "messages.send"
    const val READ = "messages.read"
    const val MEMBERS = "members.read"
    val all = listOf(SEND, READ, MEMBERS)
}
