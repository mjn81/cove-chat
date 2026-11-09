package api

import "time"

// EmojiStyleResponse describes one emoji style the server offers: a WebP sprite sheet of `cell_size` px cells and a
// JSON index (code point sequence -> top-left corner of its cell). Both URLs embed `version`, so the files are
// immutable and cached forever.
type EmojiStyleResponse struct {
	ID          string `json:"id" example:"noto"`
	Name        string `json:"name" example:"Noto Color Emoji"`
	License     string `json:"license" example:"Apache-2.0"`
	Attribution string `json:"attribution"`
	Source      string `json:"source"`
	// Version is a content hash of the sheet and index.
	Version string `json:"version" example:"3fa9c1d2e4b7"`
	CellSize int   `json:"cell_size" example:"64"`
	Width    int   `json:"width" example:"4096"`
	Height   int   `json:"height" example:"3776"`
	// Count is how many emoji the sheet covers; the client falls back to the device font for the rest.
	Count      int    `json:"count" example:"3750"`
	SheetURL   string `json:"sheet_url" example:"/api/emoji/styles/noto/3fa9c1d2e4b7/sheet.webp"`
	IndexURL   string `json:"index_url" example:"/api/emoji/styles/noto/3fa9c1d2e4b7/index.json"`
	SheetBytes int64  `json:"sheet_bytes"`
	IndexBytes int64  `json:"index_bytes"`
	Default    bool   `json:"default"`
}

// EmojiStylesResponse lists the styles users may choose from.
type EmojiStylesResponse struct {
	// DefaultStyle is the style new devices start with. It is "native" (the device's own emoji font) or a style id.
	DefaultStyle string `json:"default_style" example:"noto"`
	// EnabledStyles lists every selectable style id, including "native" when allowed.
	EnabledStyles []string `json:"enabled_styles"`
	// Styles holds the downloadable styles among EnabledStyles ("native" has no assets).
	Styles []EmojiStyleResponse `json:"styles"`
}

// CustomEmojiResponse is one custom emoji.
type CustomEmojiResponse struct {
	Name     string `json:"name" example:"party_parrot"`
	URL      string `json:"url" example:"/api/packs/custom-emoji/items/3f2a/file"`
	FileID   string `json:"file_id"`
	Animated bool   `json:"animated"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
}

// CustomEmojiListResponse lists the server's custom emoji.
type CustomEmojiListResponse struct {
	// Version changes whenever the set changes; use it (or the ETag) to refresh a cached list.
	Version string                `json:"version" example:"v3"`
	Items   []CustomEmojiResponse `json:"items"`
}

// AnimatedEmojiEntry maps one emoji to its animation.
type AnimatedEmojiEntry struct {
	// Sequence is lower-case hex code points joined by "-" with every FE0F removed.
	Sequence string `json:"sequence" example:"1f600"`
	ID       string `json:"id" example:"grinning-face"`
	URL      string `json:"url" example:"/api/emoji/animated/9a8b7c6d5e4f/grinning-face.webp"`
}

// AnimatedEmojiResponse is the table clients use to show a message that is exactly one emoji as a big animation.
type AnimatedEmojiResponse struct {
	Version string               `json:"version" example:"9a8b7c6d5e4f"`
	Items   []AnimatedEmojiEntry `json:"items"`
}

// AttributionEntry credits one set of third-party artwork.
type AttributionEntry struct {
	ID          string `json:"id" example:"noto"`
	Name        string `json:"name"`
	Kind        string `json:"kind" enums:"emoji_style,sticker"`
	License     string `json:"license" example:"Apache-2.0"`
	Attribution string `json:"attribution"`
	Source      string `json:"source"`
}

// AttributionResponse lists the credits the About page must show.
type AttributionResponse struct {
	Items []AttributionEntry `json:"items"`
}

// PackItemResponse is one sticker or custom emoji of a pack.
type PackItemResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Emoji    string `json:"emoji,omitempty"`
	Animated bool   `json:"animated"`
	// URL is where the image is served (relative to the API base). Built-in images are immutable, versioned URLs.
	URL string `json:"url"`
	// FileID is the stored image of a server or user pack (the value a sticker message carries); empty for built-in packs.
	FileID string `json:"file_id,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
	Bytes  int64  `json:"bytes"`
	Order  int    `json:"order"`
}

// PackResponse describes a pack. Lists leave `items` out (use `item_count` and `cover_url`); the detail endpoint
// includes them.
type PackResponse struct {
	ID          string `json:"id"`
	Kind        string `json:"kind" enums:"emoji_style,emoji_custom,sticker"`
	Scope       string `json:"scope" enums:"builtin,server,user"`
	OwnerID     string `json:"owner_id,omitempty"`
	OwnerName   string `json:"owner_name,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// Version changes whenever the pack's contents change.
	Version     string `json:"version"`
	License     string `json:"license,omitempty"`
	Attribution string `json:"attribution,omitempty"`
	Enabled     bool   `json:"enabled"`
	Default     bool   `json:"default"`
	Order       int    `json:"order"`
	Animated    bool   `json:"animated"`
	// Installed is true when the pack is in the caller's picker: built-in and server packs always are (while enabled),
	// user packs when owned or added.
	Installed bool `json:"installed"`
	// Editable is true when the caller may change the pack (its owner, or an admin for any server or user pack).
	Editable  bool               `json:"editable"`
	ItemCount int                `json:"item_count"`
	CoverURL  string             `json:"cover_url,omitempty"`
	Items     []PackItemResponse `json:"items,omitempty"`
	CreatedAt *time.Time         `json:"created_at,omitempty"`
}

// PackQuotaResponse tells a client what the caller may still create.
type PackQuotaResponse struct {
	UserUploadsEnabled bool  `json:"user_uploads_enabled"`
	MaxPacks           int   `json:"max_packs"`
	MaxStickersPerPack int   `json:"max_stickers_per_pack"`
	MaxStorageBytes    int64 `json:"max_storage_bytes"`
	OwnedPacks         int   `json:"owned_packs"`
	UsedStorageBytes   int64 `json:"used_storage_bytes"`
	// StickerMaxBytes and StickerMaxSide are the per-image caps after normalisation.
	StickerMaxBytes int `json:"sticker_max_bytes"`
	StickerMaxSide  int `json:"sticker_max_side"`
}

// PackListResponse is the caller's sticker picker: built-in and server packs plus the user packs they own or added.
type PackListResponse struct {
	Items []PackResponse `json:"items"`
	// DefaultPackID is the pack the picker opens on, when one is set.
	DefaultPackID string            `json:"default_pack_id,omitempty"`
	Quota         PackQuotaResponse `json:"quota"`
}

// AdminPackListResponse lists every pack on the server for moderation and management.
type AdminPackListResponse struct {
	Items []PackResponse `json:"items"`
}

// CreatePackRequest creates an empty sticker pack.
type CreatePackRequest struct {
	Name        string `json:"name" example:"My cats"`
	Description string `json:"description,omitempty"`
}

// UpdatePackRequest changes a pack; only the fields present are applied. Enabled, Default and Order apply to
// server and built-in packs (admin only).
type UpdatePackRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
	Default     *bool   `json:"default,omitempty"`
	Order       *int    `json:"order,omitempty"`
}

// ReorderItemsRequest sets the display order of a pack's items; it must list every item id exactly once.
type ReorderItemsRequest struct {
	ItemIDs []string `json:"item_ids"`
}

// ItemUploadResponse is the stored item after an upload.
type ItemUploadResponse struct {
	Item PackItemResponse `json:"item"`
	Pack PackResponse     `json:"pack"`
}
