/** DTOs of the Bot API (docs/bots-api.md). Field names mirror the backend JSON exactly. */

/** Button styles; unknown values from a newer server render as `secondary`. */
export type BotButtonStyle = 'primary' | 'secondary' | 'danger';

/** One button of a bot message or action menu: a callback (`custom_id`) or a link (`url`), never both. */
export interface BotButton {
	label: string;
	style?: BotButtonStyle;
	custom_id?: string;
	url?: string;
	disabled?: boolean;
}

/** The decrypted JSON body of a `bot` message. */
export interface BotMessageBody {
	v: number;
	text: string;
	buttons?: BotButton[][];
}

export type CommandOptionType = 'string' | 'integer' | 'number' | 'boolean' | 'user';

export interface CommandChoice {
	name: string;
	value: string;
}

export interface CommandOption {
	name: string;
	description: string;
	type: CommandOptionType;
	required?: boolean;
	choices?: CommandChoice[];
}

/** A slash command usable in a channel (`GET /api/channels/{id}/commands`). */
export interface ChannelCommand {
	bot_id: string;
	bot_username: string;
	name: string;
	description: string;
	options?: CommandOption[];
}

/** A bot account as its owner (or a channel admin choosing one to install) sees it. */
export interface Bot {
	id: string;
	username: string;
	description?: string;
	avatar_id?: string;
	owner_id: string;
	public: boolean;
	disabled: boolean;
	webhook_url?: string;
	online: boolean;
	install_count: number;
	/** Global slash commands the bot registered (shown in Explore). */
	command_count?: number;
	created_at: string;
}

/** `POST /api/bots/{id}/start`: the DM opened with a bot from Explore. */
export interface StartBotResult {
	channel_id: string;
	created: boolean;
	/** False when the bot is offline and has no webhook, so it cannot answer yet. */
	delivered: boolean;
}

/** `GET /api/bots`: a page plus what the caller may do. */
export interface BotPage {
	items: Bot[];
	next_cursor?: string;
	can_create: boolean;
	max_per_user: number;
	enabled: boolean;
}

export interface CreateBotInput {
	username: string;
	description?: string;
	public?: boolean;
	webhook_url?: string;
}

/** Returned once: the token and (with a webhook) the signing secret are never shown again. */
export interface CreateBotResponse {
	bot: Bot;
	token: string;
	webhook_secret?: string;
}

export interface UpdateBotInput {
	description?: string;
	public?: boolean;
	disabled?: boolean;
	webhook_url?: string;
	rotate_webhook_secret?: boolean;
}

export interface UpdateBotResponse {
	bot: Bot;
	webhook_secret?: string;
}

export type BotScope = 'messages.read' | 'messages.send' | 'members.read';

export const ALL_BOT_SCOPES: BotScope[] = ['messages.send', 'messages.read', 'members.read'];

export interface ChannelBot {
	bot: Bot;
	scopes: BotScope[];
	installed_by: string;
	installed_at: string;
}

/** An action menu a bot shows in a channel, replacing the composer's input area. */
export interface BotKeyboard {
	bot_id: string;
	bot_username: string;
	rows: BotButton[][];
	placeholder?: string;
	persistent?: boolean;
	one_time?: boolean;
}

export type InteractionType = 'command' | 'button' | 'keyboard';

export interface InteractionInput {
	type: InteractionType;
	bot_id: string;
	command?: string;
	options?: Record<string, string | number | boolean>;
	message_id?: string;
	custom_id?: string;
}

export interface InteractionResult {
	id: string;
	/** False when the bot is offline and has no webhook, so nothing will answer. */
	delivered: boolean;
}
