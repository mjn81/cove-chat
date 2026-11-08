package ws

import (
	"encoding/json"
	"errors"

	"cove/backend/internal/apistd"
	"cove/backend/internal/crypto"
	"cove/backend/internal/models"
	"cove/backend/internal/packs"
	"cove/backend/internal/store"
)

// maxStickerIDLen bounds every id in a sticker body (uuids and built-in slugs are far shorter).
const maxStickerIDLen = 128

// validateStickerMessage checks that a `sticker` message points at a real sticker the sender may use. The body is
// encrypted with the transport channel's key, which the server holds (server-trusted model), so it can be read here;
// without this check a member could forge a sticker message that names a pack, sticker or file that does not match,
// or an image that belongs to somebody else's pack.
//
// Body: {"pack_id", "sticker_id", "file_id"}.
//   - Built-in pack: it must be enabled and hold the sticker; file_id is empty or equals sticker_id (the art is served
//     from the embedded assets, there is no stored file).
//   - Server or user pack: the pack must hold the sticker and file_id must be that sticker's stored image. A server
//     pack must also be enabled. Any user pack that exists can be used: its id is unguessable like a file id, and this
//     keeps forwarding a received sticker working without installing its pack first.
func (c *Client) validateStickerMessage(transportID, compression string, nonce, ciphertext []byte) *messageRejection {
	bad := func(msg string) *messageRejection {
		return &messageRejection{Code: apistd.CodeStickerInvalid, Err: msg}
	}
	if compression != "none" {
		return bad("sticker messages cannot be compressed")
	}
	transport, err := c.hub.store.GetChannel(transportID)
	if err != nil {
		return bad("channel not found")
	}
	key, err := c.hub.store.DecryptChannelKey(transport, c.hub.kek)
	if err != nil {
		return bad("could not read sticker")
	}
	plain, err := crypto.OpenGCM(key, nonce, ciphertext)
	if err != nil {
		return bad("sticker could not be decrypted")
	}
	var body struct {
		PackID    string `json:"pack_id"`
		StickerID string `json:"sticker_id"`
		FileID    string `json:"file_id"`
	}
	if err := json.Unmarshal(plain, &body); err != nil {
		return bad("sticker body is not valid")
	}
	if body.PackID == "" || body.StickerID == "" || len(body.PackID) > maxStickerIDLen || len(body.StickerID) > maxStickerIDLen || len(body.FileID) > maxStickerIDLen {
		return bad("sticker does not name a pack and a sticker")
	}

	if cat, err := packs.Builtin(); err == nil {
		if bp, ok := cat.Pack(body.PackID); ok {
			if _, ok := bp.Item(body.StickerID); !ok || (body.FileID != "" && body.FileID != body.StickerID) {
				return bad("that sticker is not in the pack")
			}
			st, err := c.hub.store.GetPackState(bp.ID)
			if err != nil {
				return &messageRejection{Code: apistd.CodeInternal, Err: "could not check sticker"}
			}
			if !st.Enabled {
				return bad("that sticker pack is turned off")
			}
			return nil
		}
	}

	pack, err := c.hub.store.GetPack(body.PackID)
	if err != nil {
		if errors.Is(err, store.ErrPackNotFound) {
			return bad("that sticker pack does not exist")
		}
		return &messageRejection{Code: apistd.CodeInternal, Err: "could not check sticker"}
	}
	if pack.Kind != models.PackKindSticker || (pack.Scope == models.PackScopeServer && !pack.Enabled) {
		return bad("that sticker pack is not available")
	}
	item, err := c.hub.store.GetPackItem(pack.ID, body.StickerID)
	if err != nil {
		if errors.Is(err, store.ErrItemNotFound) {
			return bad("that sticker is not in the pack")
		}
		return &messageRejection{Code: apistd.CodeInternal, Err: "could not check sticker"}
	}
	if body.FileID != item.FileID {
		return bad("the sticker image does not match the pack")
	}
	return nil
}
