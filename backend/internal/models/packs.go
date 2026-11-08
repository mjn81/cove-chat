package models

import "time"

// PackKind says what a pack holds.
type PackKind string

const (
	// PackKindEmojiStyle is a full emoji set drawn in one art style (a sprite sheet). Always built in.
	PackKindEmojiStyle PackKind = "emoji_style"
	// PackKindEmojiCustom holds the server's custom emoji, sent as :name: in ordinary text.
	PackKindEmojiCustom PackKind = "emoji_custom"
	// PackKindSticker is a pack of stickers sent as `sticker` messages.
	PackKindSticker PackKind = "sticker"
)

// Valid reports whether k is a known pack kind.
func (k PackKind) Valid() bool {
	switch k {
	case PackKindEmojiStyle, PackKindEmojiCustom, PackKindSticker:
		return true
	}
	return false
}

// PackScope says who owns a pack and where it lives.
type PackScope string

const (
	// PackScopeBuiltin packs are embedded in the server binary (internal/packs) and never stored in the database;
	// only the admin's switches for them are (PackState).
	PackScopeBuiltin PackScope = "builtin"
	// PackScopeServer packs are managed by the server admins and shown to every user.
	PackScopeServer PackScope = "server"
	// PackScopeUser packs belong to the user who made them; others add them from a share card.
	PackScopeUser PackScope = "user"
)

// Valid reports whether s is a known pack scope.
func (s PackScope) Valid() bool {
	switch s {
	case PackScopeBuiltin, PackScopeServer, PackScopeUser:
		return true
	}
	return false
}

// CustomEmojiPackID is the id of the single server pack that holds the custom emoji (kind emoji_custom).
const CustomEmojiPackID = "custom-emoji"

// Pack is a stored (server or user) pack, kept under pk:{id}. Built-in packs are not stored: see PackState.
type Pack struct {
	ID          string    `json:"id"`
	Kind        PackKind  `json:"kind"`
	Scope       PackScope `json:"scope"`
	OwnerID     string    `json:"owner_id,omitempty"` // empty for server packs
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	// Version counts changes to the pack's contents (items added, removed, reordered); clients re-fetch when it moves.
	Version     int    `json:"version"`
	License     string `json:"license,omitempty"`
	Attribution string `json:"attribution,omitempty"`
	// Enabled packs are offered to users; a disabled server pack disappears from the picker but keeps its items.
	Enabled bool `json:"enabled"`
	// Default marks the one server pack the picker opens on (at most one stored pack is default).
	Default bool `json:"default,omitempty"`
	// Order sorts server packs in the picker (low first).
	Order     int       `json:"order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PackItem is one sticker or custom emoji of a stored pack, kept under pki:{pack_id}:{id}.
type PackItem struct {
	ID     string `json:"id"`
	PackID string `json:"pack_id"`
	// Name is the shortcode of a custom emoji ("party_parrot" for :party_parrot:); empty for stickers.
	Name string `json:"name,omitempty"`
	// FileID is the stored image (a channel-less models.File readable by any signed-in user, like an avatar).
	FileID string `json:"file_id"`
	// Emoji is the emoji a sticker stands for, used to suggest it while typing; empty for custom emoji.
	Emoji     string `json:"emoji,omitempty"`
	Order     int    `json:"order"`
	Animated  bool   `json:"animated,omitempty"`
	MIME      string `json:"mime"`
	SizeBytes int64  `json:"size"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// PackState holds the admin's switches for a built-in pack, kept under pks:{pack id}. A missing record means the
// defaults: enabled, not default, natural order.
type PackState struct {
	PackID  string `json:"pack_id"`
	Enabled bool   `json:"enabled"`
	Default bool   `json:"default"`
	Order   int    `json:"order"`
}

// UserPack records that a user added a pack to their own picker, kept under upk:{user_id}:{pack_id}.
type UserPack struct {
	UserID      string    `json:"user_id"`
	PackID      string    `json:"pack_id"`
	InstalledAt time.Time `json:"installed_at"`
}

// EmojiName is the unique-name index of custom emoji, kept under pkn:{name}.
type EmojiName struct {
	Name   string `json:"name"`
	PackID string `json:"pack_id"`
	ItemID string `json:"item_id"`
}
