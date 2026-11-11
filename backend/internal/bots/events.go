package bots

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"cove/backend/internal/crypto"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// Event names delivered to bots over the gateway and webhooks.
const (
	EventMessageCreate     = "message_create"
	EventMessageUpdate     = "message_update"
	EventMessageDelete     = "message_delete"
	EventInteractionCreate = "interaction_create"
	EventMemberJoin        = "member_join"
	EventMemberLeave       = "member_leave"
	EventBotInstall        = "bot_install"
	EventBotUninstall      = "bot_uninstall"
)

// Author is the sender of a message as a bot sees them: no avatar ids, status or anything beyond identity.
type Author struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsBot    bool   `json:"is_bot"`
}

// MessageDTO is a message with its plaintext, as delivered to a bot (events and the history endpoint). Content is
// empty for non-text types and for bodies the server cannot read (for example a compressed body).
type MessageDTO struct {
	ID        string            `json:"id"`
	ChannelID string            `json:"channel_id"`
	Author    Author            `json:"author"`
	Type      string            `json:"type"`
	Content   string            `json:"content"`
	Buttons   [][]models.Button `json:"buttons,omitempty"`
	ReplyToID string            `json:"reply_to_id,omitempty"`
	SentAt    time.Time         `json:"sent_at"`
	EditedAt  *time.Time        `json:"edited_at,omitempty"`
	// Mentioned is true when the message mentions the receiving bot by @username or replies to one of its messages.
	Mentioned bool `json:"mentioned,omitempty"`
}

// MemberEvent is the payload of member_join and member_leave.
type MemberEvent struct {
	ChannelID string `json:"channel_id"`
	User      Author `json:"user"`
}

// DeleteEvent is the payload of message_delete.
type DeleteEvent struct {
	ChannelID string `json:"channel_id"`
	MessageID string `json:"message_id"`
}

// InteractionEvent is the payload of interaction_create. Token answers it through the callback endpoint and is only
// ever sent to the bot the interaction is for.
type InteractionEvent struct {
	ID        string          `json:"id"`
	Token     string          `json:"token"`
	Type      string          `json:"type"`
	ChannelID string          `json:"channel_id"`
	MessageID string          `json:"message_id,omitempty"`
	User      Author          `json:"user"`
	Data      json.RawMessage `json:"data,omitempty"`
	ExpiresAt time.Time       `json:"expires_at"`
}

// InstallEvent is the payload of bot_install and bot_uninstall.
type InstallEvent struct {
	ChannelID string   `json:"channel_id"`
	Scopes    []string `json:"scopes,omitempty"`
}

// Open decrypts a message with its channel's key. The server holds that key (server-trusted model); the plaintext
// goes only to the bot endpoints and the dispatcher and is never logged.
func Open(s *store.Store, kek []byte, msg *models.Message) (string, bool) {
	if msg.Compression != "" && msg.Compression != "none" {
		return "", false
	}
	ch, err := s.GetChannel(msg.ChannelID)
	if err != nil {
		return "", false
	}
	key, err := s.DecryptChannelKey(ch, kek)
	if err != nil {
		return "", false
	}
	plain, err := crypto.OpenGCM(key, msg.Nonce, msg.Ciphertext)
	if err != nil {
		return "", false
	}
	return string(plain), true
}

// Seal encrypts a plaintext with the channel's key.
func Seal(s *store.Store, kek []byte, channelID string, plain []byte) (nonce, ciphertext []byte, err error) {
	ch, err := s.GetChannel(channelID)
	if err != nil {
		return nil, nil, err
	}
	key, err := s.DecryptChannelKey(ch, kek)
	if err != nil {
		return nil, nil, err
	}
	return crypto.SealGCM(key, plain)
}

// BuildMessageDTO turns a stored message into the bot-facing shape. mentionBotID, when set, computes Mentioned for
// that bot.
func BuildMessageDTO(s *store.Store, kek []byte, msg *models.Message, mentionBot *models.User) MessageDTO {
	dto := MessageDTO{
		ID: msg.ID, ChannelID: msg.ChannelID, Type: string(msg.Type), ReplyToID: msg.ReplyToID,
		SentAt: msg.SentAt, EditedAt: msg.EditedAt,
	}
	if u, err := s.GetUser(msg.SenderID); err == nil {
		dto.Author = Author{ID: u.ID, Username: u.Username, IsBot: u.IsBot()}
	} else {
		dto.Author = Author{ID: msg.SenderID}
	}
	switch msg.Type {
	case models.MessageTypeText, models.MessageTypeBot:
		if plain, ok := Open(s, kek, msg); ok {
			if msg.Type == models.MessageTypeBot {
				var body models.BotMessageBody
				if json.Unmarshal([]byte(plain), &body) == nil {
					dto.Content, dto.Buttons = body.Text, body.Buttons
				}
			} else {
				dto.Content = plain
			}
		}
	}
	if mentionBot != nil {
		dto.Mentioned = mentions(dto.Content, mentionBot.Username)
		if !dto.Mentioned && msg.ReplyToID != "" {
			if parent, err := s.GetMessage(msg.ChannelID, msg.ReplyToID); err == nil && parent.SenderID == mentionBot.ID {
				dto.Mentioned = true
			}
		}
	}
	return dto
}

// mentions reports whether text contains @name as a whole word (case-insensitive).
func mentions(text, name string) bool {
	if text == "" || name == "" {
		return false
	}
	re := regexp.MustCompile(`(?i)(^|[^\w.-])@` + regexp.QuoteMeta(strings.ToLower(name)) + `($|[^\w-])`)
	return re.MatchString(text)
}
