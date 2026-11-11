package api

import (
	"encoding/json"
	"time"

	"cove/backend/internal/bots"
	"cove/backend/internal/models"
)

// BotResponse is a bot as shown to its owner, admins and (for public bots) everyone who may install it. It never
// carries a token or the webhook secret.
type BotResponse struct {
	ID          string `json:"id"`
	Username    string `json:"username" example:"pingbot"`
	Description string `json:"description,omitempty"`
	AvatarID    string `json:"avatar_id,omitempty"`
	OwnerID     string `json:"owner_id"`
	Public      bool   `json:"public"`
	Disabled    bool   `json:"disabled"`
	// WebhookURL is only filled in for the owner and admins.
	WebhookURL string `json:"webhook_url,omitempty"`
	// Online is true while the bot has an open gateway connection.
	Online       bool      `json:"online"`
	InstallCount int       `json:"install_count"`
	CreatedAt    time.Time `json:"created_at"`
}

// CreateBotRequest creates a bot account.
type CreateBotRequest struct {
	Username    string `json:"username" example:"pingbot"`
	Description string `json:"description,omitempty"`
	Public      bool   `json:"public,omitempty"`
	// WebhookURL is optional; HTTPS only.
	WebhookURL string `json:"webhook_url,omitempty"`
}

// CreateBotResponse is returned once: the token is never shown again (rotate to get a new one).
type CreateBotResponse struct {
	Bot   BotResponse `json:"bot"`
	Token string      `json:"token"`
	// WebhookSecret is set when a webhook URL was given; shown once.
	WebhookSecret string `json:"webhook_secret,omitempty"`
}

// UpdateBotRequest changes a bot. Every field is optional.
type UpdateBotRequest struct {
	Description *string `json:"description,omitempty"`
	AvatarID    *string `json:"avatar_id,omitempty"`
	Public      *bool   `json:"public,omitempty"`
	Disabled    *bool   `json:"disabled,omitempty"`
	// WebhookURL: an empty string removes the webhook.
	WebhookURL *string `json:"webhook_url,omitempty"`
	// RotateWebhookSecret issues a new signing secret (returned once).
	RotateWebhookSecret bool `json:"rotate_webhook_secret,omitempty"`
}

// UpdateBotResponse is the changed bot, plus a new webhook secret when one was generated.
type UpdateBotResponse struct {
	Bot           BotResponse `json:"bot"`
	WebhookSecret string      `json:"webhook_secret,omitempty"`
}

// BotTokenResponse carries a freshly rotated token (shown once).
type BotTokenResponse struct {
	Token string `json:"token"`
}

// BotPageResponse is a page of bots plus what the caller may do.
type BotPageResponse struct {
	Items      []BotResponse `json:"items"`
	NextCursor string        `json:"next_cursor,omitempty"`
	// CanCreate tells the UI whether the caller may create a bot now (policy, switch and their own cap).
	CanCreate  bool `json:"can_create"`
	MaxPerUser int  `json:"max_per_user"`
	Enabled    bool `json:"enabled"`
}

// InstallBotRequest installs a bot in a channel with the scopes the channel admin grants.
type InstallBotRequest struct {
	// Scopes: messages.read, messages.send, members.read. Empty means messages.send only.
	Scopes []string `json:"scopes,omitempty"`
}

// ChannelBotResponse is a bot installed in a channel.
type ChannelBotResponse struct {
	Bot         BotResponse `json:"bot"`
	Scopes      []string    `json:"scopes"`
	InstalledBy string      `json:"installed_by"`
	InstalledAt time.Time   `json:"installed_at"`
}

// ChannelBotsResponse lists the bots of a channel (bounded by the channel's member cap).
type ChannelBotsResponse struct {
	Items []ChannelBotResponse `json:"items"`
}

// CommandResponse is a slash command as the composer's autocomplete needs it.
type CommandResponse struct {
	BotID       string                 `json:"bot_id"`
	BotUsername string                 `json:"bot_username"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Options     []models.CommandOption `json:"options,omitempty"`
}

// CommandsResponse lists the commands usable in a channel.
type CommandsResponse struct {
	Items []CommandResponse `json:"items"`
}

// SetCommandsRequest replaces a bot's commands in one scope.
type SetCommandsRequest struct {
	Commands []models.BotCommand `json:"commands"`
}

// BotCommandsResponse lists a bot's registered commands.
type BotCommandsResponse struct {
	Items []models.BotCommand `json:"items"`
}

// BotMessageRequest is what a bot sends to post or edit a message.
type BotMessageRequest struct {
	Text      string            `json:"text,omitempty"`
	Buttons   [][]models.Button `json:"buttons,omitempty"`
	ReplyToID string            `json:"reply_to_id,omitempty"`
}

// BotMessagePageResponse is a page of channel history for a bot, newest first, with plaintext.
type BotMessagePageResponse struct {
	Items      []bots.MessageDTO `json:"items"`
	NextCursor string            `json:"next_cursor,omitempty"`
}

// BotMemberResponse is a channel member as a bot may see them.
type BotMemberResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsBot    bool   `json:"is_bot"`
}

// BotMemberPageResponse is a page of channel members for a bot.
type BotMemberPageResponse struct {
	Items      []BotMemberResponse `json:"items"`
	NextCursor string              `json:"next_cursor,omitempty"`
}

// BotChannelResponse is one channel a bot is in.
type BotChannelResponse struct {
	ID     string   `json:"id"`
	Name   string   `json:"name,omitempty"`
	IsDM   bool     `json:"is_dm"`
	Scopes []string `json:"scopes"`
}

// BotChannelPageResponse is a page of the bot's channels.
type BotChannelPageResponse struct {
	Items      []BotChannelResponse `json:"items"`
	NextCursor string               `json:"next_cursor,omitempty"`
}

// KeyboardRequest sets the action menu of a bot in a channel.
type KeyboardRequest struct {
	Rows        [][]models.Button `json:"rows"`
	Placeholder string            `json:"placeholder,omitempty"`
	Persistent  bool              `json:"persistent,omitempty"`
	OneTime     bool              `json:"one_time,omitempty"`
}

// KeyboardsResponse lists the action menus active in a channel.
type KeyboardsResponse struct {
	Items []KeyboardResponse `json:"items"`
}

// KeyboardResponse is one action menu with the bot that shows it.
type KeyboardResponse struct {
	BotID       string            `json:"bot_id"`
	BotUsername string            `json:"bot_username"`
	Rows        [][]models.Button `json:"rows"`
	Placeholder string            `json:"placeholder,omitempty"`
	Persistent  bool              `json:"persistent,omitempty"`
	OneTime     bool              `json:"one_time,omitempty"`
}

// InteractionRequest is a user's action addressed to a bot: a slash command, a button on a bot message or a key of
// the action menu.
type InteractionRequest struct {
	// Type is "command", "button" or "keyboard".
	Type  string `json:"type" enums:"command,button,keyboard"`
	BotID string `json:"bot_id"`
	// Command and Options are set for type "command".
	Command string         `json:"command,omitempty"`
	Options map[string]any `json:"options,omitempty"`
	// MessageID and CustomID are set for type "button"; CustomID alone for "keyboard".
	MessageID string `json:"message_id,omitempty"`
	CustomID  string `json:"custom_id,omitempty"`
}

// InteractionResponse acknowledges that the interaction was created. Delivered is false when the bot is offline and
// has no webhook, so the client can say so.
type InteractionResponse struct {
	ID        string `json:"id"`
	Delivered bool   `json:"delivered"`
}

// InteractionCallbackRequest is a bot's answer to an interaction.
type InteractionCallbackRequest struct {
	// Type is "message" (a new message), "update_message" (edit the message the button was on) or "ack"
	// (acknowledge now, answer with one follow-up message later).
	Type    string            `json:"type" enums:"message,update_message,ack"`
	Text    string            `json:"text,omitempty"`
	Buttons [][]models.Button `json:"buttons,omitempty"`
}

// BotMessageResponse is a message a bot sent or edited.
type BotMessageResponse struct {
	ID        string    `json:"id"`
	ChannelID string    `json:"channel_id"`
	SentAt    time.Time `json:"sent_at"`
}

// BotDMRequest opens (or finds) a DM with a user who interacted with the bot.
type BotDMRequest struct {
	UserID string `json:"user_id"`
}

// BotDMResponse is the DM channel.
type BotDMResponse struct {
	ChannelID string `json:"channel_id"`
}

// botBodyJSON is the plaintext of a rich message.
func botBodyJSON(text string, buttons [][]models.Button) []byte {
	b, _ := json.Marshal(models.BotMessageBody{V: 1, Text: text, Buttons: buttons})
	return b
}
