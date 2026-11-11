package models

import (
	"encoding/json"
	"time"
)

// UserKindBot is User.Kind of a bot account.
const UserKindBot = "bot"

// MessageTypeBot carries a rich bot message: an encrypted JSON body (BotMessageBody) with text and buttons. Only the
// bot that sent it may edit it. Clients that do not know the type show the "needs a newer version" placeholder.
const MessageTypeBot MessageType = "bot"

// Install scopes. A bot is always a plain channel member; what it may read or do is decided by the scopes a channel
// admin grants when installing it, never by a role.
const (
	// ScopeMessagesRead lets the bot receive and list every message of the channel. Without it the bot only sees
	// messages that mention it, reply to it, or are interactions addressed to it (and everything in a DM with it).
	ScopeMessagesRead = "messages.read"
	// ScopeMessagesSend lets the bot post, edit and delete its own messages and set keyboards.
	ScopeMessagesSend = "messages.send"
	// ScopeMembersRead lets the bot list the channel's members.
	ScopeMembersRead = "members.read"
)

// AllBotScopes lists every valid install scope.
var AllBotScopes = []string{ScopeMessagesRead, ScopeMessagesSend, ScopeMembersRead}

// Bot is the bot-specific record stored under bot:{id}; the bot's identity (username, avatar) is its User record
// with the same id.
type Bot struct {
	ID          string `json:"id"`
	OwnerID     string `json:"owner_id"`
	Description string `json:"description,omitempty"`
	// TokenHash is the hex SHA-256 of the token secret. The secret itself is shown once and never stored.
	TokenHash      string    `json:"token_hash"`
	TokenCreatedAt time.Time `json:"token_created_at"`
	// Public bots are listed in discovery and can be installed by any channel admin; private ones only by the owner
	// (and server admins).
	Public   bool `json:"public"`
	Disabled bool `json:"disabled"`
	// WebhookURL is where events go when no gateway connection is open. Empty means gateway only.
	WebhookURL string `json:"webhook_url,omitempty"`
	// WebhookSecret signs webhook deliveries (HMAC-SHA256). The database is encrypted at rest; the secret is shown
	// to the owner once when generated.
	WebhookSecret string    `json:"webhook_secret,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// BotInstall records that a bot is installed in a group channel with a set of scopes: bi:{channel}:{bot}.
type BotInstall struct {
	ChannelID   string    `json:"channel_id"`
	BotID       string    `json:"bot_id"`
	Scopes      []string  `json:"scopes"`
	InstalledBy string    `json:"installed_by"`
	InstalledAt time.Time `json:"installed_at"`
}

// HasScope reports whether the install grants scope.
func (i *BotInstall) HasScope(scope string) bool {
	for _, s := range i.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// BotContact records that a user has interacted with a bot (opened a DM, used a command, pressed a button): bc:{bot}:{user}.
// A bot may only message users it has a contact with.
type BotContact struct {
	BotID  string    `json:"bot_id"`
	UserID string    `json:"user_id"`
	At     time.Time `json:"at"`
}

// Slash command option types.
const (
	OptionString  = "string"
	OptionInteger = "integer"
	OptionNumber  = "number"
	OptionBoolean = "boolean"
	OptionUser    = "user"
)

// CommandChoice is one fixed value an option may take.
type CommandChoice struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// CommandOption is one typed argument of a slash command.
type CommandOption struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Type        string          `json:"type"`
	Required    bool            `json:"required,omitempty"`
	Choices     []CommandChoice `json:"choices,omitempty"`
}

// BotCommand is a registered slash command: bcmd:{bot}:{scope}:{name}, where scope is "global" or a channel id.
type BotCommand struct {
	BotID       string          `json:"bot_id"`
	ChannelID   string          `json:"channel_id,omitempty"` // empty = global
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Options     []CommandOption `json:"options,omitempty"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// Button styles; unknown values render as "secondary".
const (
	ButtonPrimary   = "primary"
	ButtonSecondary = "secondary"
	ButtonDanger    = "danger"
)

// Button is one button of a bot message or keyboard. Exactly one of CustomID (a callback: the press becomes an
// interaction for the bot) or URL (opens a link, http/https only) is set; keyboard buttons use CustomID only.
type Button struct {
	Label    string `json:"label"`
	Style    string `json:"style,omitempty"`
	CustomID string `json:"custom_id,omitempty"`
	URL      string `json:"url,omitempty"`
	Disabled bool   `json:"disabled,omitempty"`
}

// BotMessageBody is the plaintext JSON inside an encrypted `bot` message.
type BotMessageBody struct {
	V       int        `json:"v"`
	Text    string     `json:"text"`
	Buttons [][]Button `json:"buttons,omitempty"`
}

// Keyboard is the action menu a bot shows in a channel, replacing the composer's input area: bkb:{channel}:{bot}.
type Keyboard struct {
	ChannelID   string     `json:"channel_id"`
	BotID       string     `json:"bot_id"`
	Rows        [][]Button `json:"rows"`
	Placeholder string     `json:"placeholder,omitempty"`
	// Persistent keeps the keyboard toggle available after use; OneTime hides the keyboard after the first press.
	Persistent bool      `json:"persistent,omitempty"`
	OneTime    bool      `json:"one_time,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Interaction types.
const (
	InteractionCommand  = "command"
	InteractionButton   = "button"
	InteractionKeyboard = "keyboard"
)

// Interaction is a user action addressed to a bot: bint:{id}. The bot answers it with the one-time token it was
// given; only the token's hash is stored.
type Interaction struct {
	ID        string          `json:"id"`
	TokenHash string          `json:"token_hash"`
	Type      string          `json:"type"`
	BotID     string          `json:"bot_id"`
	ChannelID string          `json:"channel_id"`
	UserID    string          `json:"user_id"`
	MessageID string          `json:"message_id,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	ExpiresAt time.Time       `json:"expires_at"`
	// Responses counts the answers already given (an ack plus one follow-up message at most).
	Responses int `json:"responses"`
}
