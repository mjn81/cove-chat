package models

import (
	"encoding/json"
	"strings"
	"time"
)

// ---- User ------------------------------------------------------------------ //

// User represents an authenticated account stored under u:{id}.
type User struct {
	ID                      string   `json:"id"`
	Username                string   `json:"username"`
	PwdHash                 []byte   `json:"pwd_hash"`                            // Argon2id SaltedHash JSON blob
	Domain                  string   `json:"domain"`                              // e.g. "localhost" or "chat.example.com"
	Status                  string   `json:"status"`                              // Active status: "online" | "away" | "dnd" | "offline"
	StatusPreference        string   `json:"status_preference"`                   // "online" | "away" | "dnd" | "offline" | "auto"
	AvatarID                string   `json:"avatar_id"`                           // Reference to file storage
	AvatarIDs               []string `json:"avatar_ids,omitempty"`                // History/gallery of avatar IDs (max 5)
	BannerColor             string   `json:"banner_color,omitempty"`              // Hex color code for profile banner (e.g. #5865F2)
	CustomMsg               string   `json:"custom_msg"`                          // Optional status message
	AllowChannelAdds        string   `json:"allow_channel_adds,omitempty"`        // "everyone" | "friends" | "nobody" (default: "everyone")
	DMPermission            string   `json:"dm_permission,omitempty"`             // "everyone" | "friends" | "nobody" (default: "everyone")
	FriendRequestPermission string   `json:"friend_request_permission,omitempty"` // "everyone" | "nobody" (default: "everyone")
	PublicKey               []byte   `json:"pub_key"`                             // Reserved for future E2EE key exchange
	// ServerRole is the account's role on the server itself (not in a channel):
	// "" (member), "admin" or "owner". It is only ever set by the server and is
	// never read from a client payload.
	ServerRole string `json:"server_role,omitempty"`
	// IsSystem marks the built-in Cove account that posts login notices and owner announcements. It has no
	// password and cannot be messaged, befriended or invited.
	IsSystem  bool      `json:"is_system,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// The built-in Cove system account.
const (
	SystemUserID   = "system:cove"
	SystemUsername = "cove"
	// SystemAvatarID is a sentinel, not a file id: clients render the bundled brand icon for it.
	SystemAvatarID = "system:cove"
)

// ---- Channel --------------------------------------------------------------- //

// Channel represents a chat channel across the platform (group or direct message).
type Channel struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description,omitempty"`
	AvatarID        string    `json:"avatar_id,omitempty"`
	IsPrivate       bool      `json:"is_private"`  // If true, hidden from public search
	InviteLink      string    `json:"invite_link"` // Unique public/private join link
	CreatorID       string    `json:"creator_id"`
	AESKeyEncrypted []byte    `json:"aes_key_enc"` // Channel AES-256 key encrypted with server KEK
	CreatedAt       time.Time `json:"created_at"`
	UnreadCount     int       `json:"unread_count"`    // Ephemeral: Populated per-user in handlers
	LastMessageAt   time.Time `json:"last_message_at"` // Ephemeral: Populated in ListUserChannels

	// Ephemeral, populated in ListUserChannels: the channel's most recent
	// message, still encrypted — lets the client render a sidebar preview
	// without a second round-trip. The server never sees the plaintext.
	LastMessageCiphertext []byte      `json:"last_message_ciphertext,omitempty"`
	LastMessageNonce      []byte      `json:"last_message_nonce,omitempty"`
	LastMessageType       MessageType `json:"last_message_type,omitempty"`
	LastMessageSenderID   string      `json:"last_message_sender_id,omitempty"`
	LastMessageID         string      `json:"last_message_id,omitempty"`
}

func (ch *Channel) IsDM(memberCount int) bool {
	return strings.TrimSpace(ch.Name) == "" && memberCount == 2
}

// ---- UserChannel (Junction Index) ------------------------------------------ //

const (
	RoleMember = 0
	RoleAdmin  = 10
	RoleOwner  = 20
)

const (
	StatusActive = "active"
	StatusKicked = "kicked"
	StatusBanned = "banned"
	StatusLeft   = "left"
)

// UserChannel is the secondary index stored under uc:{user_id}:{channel_id}.
// It enables O(1) lookup of all channels for a specific user.
type UserChannel struct {
	UserID     string    `json:"user_id"`
	ChannelID  string    `json:"channel_id"`
	Role       int       `json:"role"`   // 0=Member, 10=Admin, 20=Owner
	Status     string    `json:"status"` // "active", "kicked", "banned", "left"
	JoinedAt   time.Time `json:"joined_at"`
	LastReadAt time.Time `json:"last_read_at"`
	ClearedAt  time.Time `json:"cleared_at,omitempty"`
}

// ---- Message --------------------------------------------------------------- //

// MessageType enumerates the valid payload types for a message.
type MessageType string

const (
	MessageTypeText  MessageType = "text"
	MessageTypeFile  MessageType = "file"
	MessageTypeVoice MessageType = "voice"
	MessageTypeVideo MessageType = "video"
)

// Message is stored under m:{chan_id}:{time_nano}. The server only sees
// opaque ciphertext — it never decrypts message bodies.
type Message struct {
	ID          string      `json:"id"`
	ChannelID   string      `json:"channel_id"`
	SenderID    string      `json:"sender_id"`
	Type        MessageType `json:"type"`        // "text" | "file" | "voice" | "video"
	Ciphertext  []byte      `json:"ciphertext"`  // AES-256-GCM encrypted payload
	Nonce       []byte      `json:"nonce"`       // GCM nonce (also prepended in ciphertext)
	Compression string      `json:"compression"` // "none", "zstd", etc.
	Sig         []byte      `json:"sig"`         // Reserved: future sender signature
	SentAt      time.Time   `json:"sent_at"`
	EditedAt    *time.Time  `json:"edited_at,omitempty"`
	ReplyToID   string      `json:"reply_to_id,omitempty"`
}

// ---- Presence -------------------------------------------------------------- //

// Presence is an ephemeral record stored under p:{user_id}, updated on every
// WebSocket heartbeat. TTL is enforced by the WSS hub — stale entries are
// removed on disconnect.
type Presence struct {
	LastSeen      time.Time `json:"last_seen"`
	CurrentStatus string    `json:"current_status"` // "online" | "away" | "offline"
}

// ---- File / Media ---------------------------------------------------------- //

// File holds metadata for uploaded files, encrypted voice notes, and video messages,
// stored under f:{uuid}.
type File struct {
	ID               string    `json:"id"`
	OwnerID          string    `json:"owner_id"`
	ChannelID        string    `json:"channel_id"`
	SizeBytes        int64     `json:"size"`
	MIMEType         string    `json:"mime"` // e.g. "audio/webm", "video/webm", "image/png"
	StoragePath      string    `json:"storage_path"`
	ThumbCipher      []byte    `json:"thumb_ciphertext,omitempty"`  // Optional encrypted thumbnail
	ThumbNonce       []byte    `json:"thumb_nonce,omitempty"`       // Nonce for thumbnail
	ProcessingStatus string    `json:"processing_status,omitempty"` // "ready" | "processing" | "failed"
	DurationSec      float64   `json:"duration_sec,omitempty"`      // Duration in seconds (for audio/video)
	UploadedAt       time.Time `json:"uploaded_at"`
}

// ---- Relationship (Unified Friend / Block / Request) ----------------------- //

type RelationshipType string

const (
	RelNone      RelationshipType = "none"
	RelRequested RelationshipType = "requested"
	RelFriend    RelationshipType = "friend"
	RelBlocked   RelationshipType = "blocked"
)

// Relationship is stored under rel:{from_user_id}:{to_user_id}.
// For friends, it is bidirectional: rel:A:B = friend AND rel:B:A = friend.
// For block, it is directional: rel:A:B = blocked (A blocked B).
// For requests, from=Requester, to=Recipient: rel:A:B = requested.
// Secondary index reli:{to_user_id}:{from_user_id} provides fast inbox lookup.
type Relationship struct {
	FromUserID string           `json:"from_user_id"`
	ToUserID   string           `json:"to_user_id"`
	Type       RelationshipType `json:"type"` // "requested" | "friend" | "blocked"
	CreatedAt  time.Time        `json:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at"`
}

// ---- WebSocket Wire Types -------------------------------------------------- //

// WSMessage is the envelope sent over the WebSocket connection.
type WSMessage struct {
	Type    string          `json:"type"`    // e.g. "message", "presence", "channel_key"
	Payload json.RawMessage `json:"payload"` // Type-specific JSON
}

// ---- Session --------------------------------------------------------------- //

// Session represents an authenticated session record stored under s:{token hash}.
// Token holds the SHA-256 hash of the bearer token, never the token itself.
type Session struct {
	Token        string    `json:"token"`
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Username     string    `json:"username"`
	CreatedAt    time.Time `json:"created_at"`
	ExpiresAt    time.Time `json:"expires_at"`
	LastActiveAt time.Time `json:"last_active_at"`
	IP           string    `json:"ip,omitempty"`
	UserAgent    string    `json:"user_agent,omitempty"`
	DeviceName   string    `json:"device_name,omitempty"`
	AppName      string    `json:"app_name,omitempty"`
	Platform     string    `json:"platform,omitempty"`
	City         string    `json:"city,omitempty"`
	Country      string    `json:"country,omitempty"`
}

// ---- Server administration ------------------------------------------------- //

// Server-level roles (User.ServerRole).
const (
	ServerRoleNone  = ""
	ServerRoleAdmin = "admin"
	ServerRoleOwner = "owner"
)

// IsServerAdmin reports whether the role may use the admin panel.
func IsServerAdmin(role string) bool {
	return role == ServerRoleAdmin || role == ServerRoleOwner
}

// Where an invitation came from.
const (
	InviteSourcePanel  = "panel"
	InviteSourceConfig = "config"
)

// Invite is a registration invitation code, stored under inv:{code}.
type Invite struct {
	Code      string     `json:"code"`
	Note      string     `json:"note,omitempty"`
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"` // nil = never expires
	MaxUses   int        `json:"max_uses"`             // 0 = unlimited
	Uses      int        `json:"uses"`
	Revoked   bool       `json:"revoked"`
	Source    string     `json:"source"` // InviteSource*
}

// InviteSpec describes an invitation declared in config.toml.
type InviteSpec struct {
	Code      string
	Note      string
	ExpiresAt *time.Time
	MaxUses   int
}

// AuditEntry records one admin action, stored under aud:{time}:{id}.
type AuditEntry struct {
	ID        string    `json:"id"`
	At        time.Time `json:"at"`
	ActorID   string    `json:"actor_id"`
	ActorName string    `json:"actor_name"`
	Action    string    `json:"action"`           // e.g. "invite.create"
	Target    string    `json:"target,omitempty"` // e.g. a username or invite code (never a secret)
}
