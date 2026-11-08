package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"cove/backend/internal/apistd"
	"cove/backend/internal/models"
	"cove/backend/internal/packs"
	"cove/backend/internal/store"
	"github.com/google/uuid"
)

// What an uploaded image may be after normalisation (docs/packs-api.md). Stickers are raster only: SVG, and anything
// else that is not PNG, JPEG, GIF or WebP, is refused by magic bytes, whatever the client says it is.
var (
	stickerLimits = packs.ImageLimits{MaxBytes: 512 << 10, MaxDim: 512, Formats: []string{"png", "jpeg", "gif", "webp"}}
	emojiLimits   = packs.ImageLimits{MaxBytes: 256 << 10, MaxDim: 128, Formats: []string{"png", "gif", "webp"}}
)

const (
	// maxPackUploadBytes bounds the raw upload before normalisation (the stored result is far smaller).
	maxPackUploadBytes = 4 << 20
	maxPackNameRunes   = 50
	maxPackDescRunes   = 200
	// imageSlotWait is how long an upload waits for a free normalisation slot before the server answers 503.
	imageSlotWait = 10 * time.Second
)

// imageSlots throttles image normalisation (ffmpeg) so a burst of uploads cannot exhaust the host. It is
// process-local runtime state with no persistent counterpart, like transcodeSlots.
var imageSlots = make(chan struct{}, 4)

var emojiNameRe = regexp.MustCompile(`^[a-z0-9_]{2,32}$`)

// validText trims s and checks its length in runes and that it holds no control characters.
func validText(s string, maxRunes int, required bool) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return s, !required
	}
	if utf8.RuneCountInString(s) > maxRunes || !utf8.ValidString(s) {
		return "", false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return s, true
}

// validStickerEmoji accepts the emoji a sticker stands for: a short run of symbol, joiner and modifier characters.
// Letters, spaces and control characters are refused (digits, # and * only as part of a keycap sequence).
func validStickerEmoji(s string) bool {
	n := utf8.RuneCountInString(s)
	if n == 0 || n > 16 || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.IsSpace(r) || unicode.IsLetter(r) {
			return false
		}
		isKeycapBase := r == '#' || r == '*' || (r >= '0' && r <= '9')
		if r < 0x80 && !isKeycapBase {
			return false
		}
	}
	return true
}

// ---- Pack create / update / delete ----------------------------------------------------------------------------- //

// uploadsAllowed refuses a user write while the admin has switched user uploads off.
func (h *Handler) uploadsAllowed(w http.ResponseWriter) bool {
	if h.packSettings().UserUploadsEnabled {
		return true
	}
	writeErrorCode(w, http.StatusForbidden, apistd.CodeUploadsDisabled, "Sticker uploads are turned off on this server")
	return false
}

// CreatePack godoc
//
//	@Summary     Create a sticker pack
//	@Description Creates an empty pack owned by the caller; upload stickers with `POST /api/packs/{id}/items`. Limited by the
//	@Description admin's quota (`packs.max_packs_per_user`) and refused while user uploads are switched off.
//	@Description **Access:** Authenticated (when user uploads are enabled).
//	@Tags        packs
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body CreatePackRequest true "Pack"
//	@Success     201 {object} PackResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs [post]
func (h *Handler) CreatePack(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok || !h.uploadsAllowed(w) {
		return
	}
	var body CreatePackRequest
	if !decodeJSONLimit(w, r, &body, 1<<14, "Invalid request") {
		return
	}
	name, ok1 := validText(body.Name, maxPackNameRunes, true)
	desc, ok2 := validText(body.Description, maxPackDescRunes, false)
	if !ok1 || !ok2 {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Pack name must be 1-%d characters and the description at most %d", maxPackNameRunes, maxPackDescRunes))
		return
	}
	cfg := h.packSettings()
	p, err := h.Store.CreatePack(
		&models.Pack{Kind: models.PackKindSticker, Scope: models.PackScopeUser, OwnerID: a.ID, Name: name, Description: desc, Enabled: true},
		store.PackLimits{MaxPacksPerUser: cfg.MaxPacksPerUser},
	)
	if err != nil {
		if errors.Is(err, store.ErrTooManyPacks) {
			writeErrorCode(w, http.StatusConflict, apistd.CodePackLimitReached, fmt.Sprintf("You can own at most %d sticker packs", cfg.MaxPacksPerUser))
			return
		}
		writeInternal(w, "create pack", err, "Could not create the pack")
		return
	}
	writeJSON(w, http.StatusCreated, h.storedPackResponse(p, nil, true, a, true))
}

// loadEditable loads a stored pack the caller may change. On the user route that is a pack they own; on the admin
// route any stored pack. It writes the error response itself.
func (h *Handler) loadEditable(w http.ResponseWriter, a *packActor, id string, adminRoute bool) (*models.Pack, bool) {
	p, err := h.Store.GetPack(id)
	if err != nil {
		if errors.Is(err, store.ErrPackNotFound) {
			packNotFound(w)
		} else {
			writeInternal(w, "load pack "+id, err, "Could not load the pack")
		}
		return nil, false
	}
	if adminRoute {
		return p, true
	}
	if p.Scope != models.PackScopeUser {
		// A server pack is not the caller's to change, and its existence is public anyway.
		writeErrorCode(w, http.StatusForbidden, apistd.CodeForbidden, "You can only change your own packs")
		return nil, false
	}
	if p.OwnerID != a.ID {
		writeErrorCode(w, http.StatusForbidden, apistd.CodeForbidden, "You can only change your own packs")
		return nil, false
	}
	return p, true
}

// UpdatePack godoc
//
//	@Summary     Rename a sticker pack
//	@Description Changes the name or description of a pack the caller owns. `enabled`, `default` and `order` are for admins
//	@Description (`PATCH /api/admin/packs/{id}`) and are refused here.
//	@Description **Access:** Authenticated (pack owner).
//	@Tags        packs
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string            true "Pack ID"
//	@Param       body body UpdatePackRequest true "Fields to change"
//	@Success     200 {object} PackResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id} [patch]
func (h *Handler) UpdatePack(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	h.updateStoredPack(w, r, a, nil, false)
}

// updateStoredPack applies a PATCH to a stored pack; admin is the audited admin on the admin route, nil otherwise.
func (h *Handler) updateStoredPack(w http.ResponseWriter, r *http.Request, a *packActor, admin *models.User, adminRoute bool) {
	p, ok := h.loadEditable(w, a, r.PathValue("id"), adminRoute)
	if !ok {
		return
	}
	var body UpdatePackRequest
	if !decodeJSONLimit(w, r, &body, 1<<14, "Invalid request") {
		return
	}
	managed := body.Enabled != nil || body.Default != nil || body.Order != nil
	if managed && (!adminRoute || p.Scope != models.PackScopeServer) {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "enabled, default and order can only be set on server packs by an admin")
		return
	}
	var name, desc *string
	if body.Name != nil {
		v, ok := validText(*body.Name, maxPackNameRunes, true)
		if !ok {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Pack name must be 1-%d characters", maxPackNameRunes))
			return
		}
		name = &v
	}
	if body.Description != nil {
		v, ok := validText(*body.Description, maxPackDescRunes, false)
		if !ok {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("The description can be at most %d characters", maxPackDescRunes))
			return
		}
		desc = &v
	}
	if body.Default != nil && *body.Default && p.Kind != models.PackKindSticker {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "Only sticker packs can be the default")
		return
	}
	if p.Kind == models.PackKindEmojiCustom && (name != nil || body.Enabled != nil) {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "The custom emoji set cannot be renamed or disabled")
		return
	}
	wantDefault := body.Default != nil && *body.Default

	updated, err := h.Store.UpdatePack(p.ID, func(pk *models.Pack) error {
		if name != nil {
			pk.Name = *name
		}
		if desc != nil {
			pk.Description = *desc
		}
		if body.Enabled != nil {
			pk.Enabled = *body.Enabled
			if !pk.Enabled {
				pk.Default = false // a hidden pack cannot be the one the picker opens on
			}
		}
		if body.Default != nil && !*body.Default {
			pk.Default = false
		}
		if body.Order != nil {
			pk.Order = *body.Order
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, store.ErrPackNotFound) {
			packNotFound(w)
			return
		}
		writeInternal(w, "update pack "+p.ID, err, "Could not update the pack")
		return
	}
	if wantDefault {
		if !updated.Enabled {
			writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "Enable the pack before making it the default")
			return
		}
		if err := h.Store.SetDefaultStickerPack(p.ID, false); err != nil {
			writeInternal(w, "set default pack "+p.ID, err, "Could not update the pack")
			return
		}
	}
	if admin != nil {
		h.audit(admin, "pack.update", packAuditTarget(updated))
	}
	resp, status := h.packDetail(p.ID, a)
	if status != http.StatusOK {
		writeError(w, http.StatusInternalServerError, "Could not load the pack")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func packAuditTarget(p *models.Pack) string {
	return fmt.Sprintf("%s (%s)", p.Name, p.ID)
}

// DeletePack godoc
//
//	@Summary     Delete a sticker pack
//	@Description Deletes a pack the caller owns with all its stickers, removes it from everyone's picker and deletes the
//	@Description stored images. Stickers already sent in chats keep their record but no longer load.
//	@Description **Access:** Authenticated (pack owner).
//	@Tags        packs
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Pack ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id} [delete]
func (h *Handler) DeletePack(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	h.removeStoredPack(w, a, nil, r.PathValue("id"), false)
}

func (h *Handler) removeStoredPack(w http.ResponseWriter, a *packActor, admin *models.User, id string, adminRoute bool) {
	p, ok := h.loadEditable(w, a, id, adminRoute)
	if !ok {
		return
	}
	if p.Kind == models.PackKindEmojiCustom {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "The custom emoji set cannot be deleted; remove emoji one by one")
		return
	}
	items, err := h.Store.DeletePack(p.ID)
	if err != nil {
		if errors.Is(err, store.ErrPackNotFound) {
			packNotFound(w)
			return
		}
		writeInternal(w, "delete pack "+p.ID, err, "Could not delete the pack")
		return
	}
	h.deleteItemFiles(items)
	if admin != nil {
		target := packAuditTarget(p)
		if p.OwnerID != "" {
			target += " owner=" + p.OwnerID
		}
		h.audit(admin, "pack.delete", target)
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// ---- Items ----------------------------------------------------------------------------------------------------- //

// UploadPackItem godoc
//
//	@Summary     Add a sticker to a pack
//	@Description Multipart form: `file` (PNG, JPEG, GIF or WebP; SVG and everything else is refused by magic bytes, never by
//	@Description the claimed content type) and optional `emoji` (the emoji the sticker stands for). At most 4 MB is accepted;
//	@Description the stored result is at most 512x512 and 512 KB. With ffmpeg the image is re-encoded to WebP (metadata is
//	@Description stripped, animations stay animated, at most 10 s); without it only files that already fit are accepted
//	@Description unchanged. Limited by the admin's quotas (stickers per pack, total bytes) and refused while user uploads are off.
//	@Description **Access:** Authenticated (pack owner, when user uploads are enabled).
//	@Tags        packs
//	@Accept      multipart/form-data
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id    path     string true  "Pack ID"
//	@Param       file  formData file   true  "The image"
//	@Param       emoji formData string false "Emoji this sticker maps to"
//	@Success     201 {object} ItemUploadResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Failure     503 {object} ErrorResponse
//	@Router      /api/packs/{id}/items [post]
func (h *Handler) UploadPackItem(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok || !h.uploadsAllowed(w) {
		return
	}
	p, ok := h.loadEditable(w, a, r.PathValue("id"), false)
	if !ok {
		return
	}
	h.uploadItem(w, r, a, nil, p)
}

// uploadItem validates and stores one uploaded image as an item of p. admin is the audited admin on admin routes.
func (h *Handler) uploadItem(w http.ResponseWriter, r *http.Request, a *packActor, admin *models.User, p *models.Pack) {
	custom := p.Kind == models.PackKindEmojiCustom
	if p.Kind == models.PackKindEmojiStyle {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "Emoji styles are built in")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPackUploadBytes+(64<<10))
	if err := r.ParseMultipartForm(maxPackUploadBytes); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErrorCode(w, http.StatusRequestEntityTooLarge, apistd.CodePayloadTooLarge, "The image is too large")
			return
		}
		writeError(w, http.StatusBadRequest, "Invalid upload form")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "The image file is missing")
		return
	}
	defer func() { _ = file.Close() }()

	var name, emoji string
	if custom {
		name = strings.ToLower(strings.Trim(strings.TrimSpace(r.FormValue("name")), ":"))
		if !emojiNameRe.MatchString(name) {
			writeError(w, http.StatusBadRequest, "Emoji names use 2-32 lowercase letters, digits or underscores")
			return
		}
	} else if v := strings.TrimSpace(r.FormValue("emoji")); v != "" {
		if !validStickerEmoji(v) {
			writeError(w, http.StatusBadRequest, "The emoji must be a single emoji")
			return
		}
		emoji = v
	}

	data, err := io.ReadAll(io.LimitReader(file, maxPackUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Could not read the image")
		return
	}
	if len(data) > maxPackUploadBytes {
		writeErrorCode(w, http.StatusRequestEntityTooLarge, apistd.CodePayloadTooLarge, "The image is too large")
		return
	}

	lim := stickerLimits
	if custom {
		lim = emojiLimits
	}
	out, info, ok := h.normalizeImage(w, r.Context(), data, lim)
	if !ok {
		return
	}

	fileID := uuid.New().String()
	path, size, err := h.Storage.Save(fileID, bytes.NewReader(out))
	if err != nil {
		writeInternal(w, "save pack image", err, "Could not save the image")
		return
	}
	rec, err := h.Store.RegisterFile(a.ID, "", info.MIME, path, size, nil, nil)
	if err != nil {
		_ = h.Storage.Delete(path)
		writeInternal(w, "register pack image", err, "Could not save the image")
		return
	}

	var plim store.PackLimits
	if p.Scope == models.PackScopeUser {
		cfg := h.packSettings()
		plim = store.PackLimits{MaxItemsPerPack: cfg.MaxStickersPerPack, MaxUserBytes: int64(cfg.MaxUserStorageMB) << 20}
	}
	item, err := h.Store.AddPackItem(&models.PackItem{
		PackID: p.ID, Name: name, FileID: rec.ID, Emoji: emoji, Animated: info.Animated, MIME: info.MIME,
		SizeBytes: size, Width: info.Width, Height: info.Height,
	}, plim)
	if err != nil {
		h.deleteItemFiles([]*models.PackItem{{FileID: rec.ID}})
		h.writeAddItemError(w, p.ID, err)
		return
	}
	if admin != nil {
		target := packAuditTarget(p)
		action := "pack.item.add"
		if custom {
			action, target = "emoji.add", ":"+name+":"
		}
		h.audit(admin, action, target)
	}
	pack, _ := h.Store.GetPack(p.ID)
	if pack == nil {
		pack = p
	}
	items, _ := h.Store.ListPackItems(p.ID)
	writeJSON(w, http.StatusCreated, ItemUploadResponse{Item: itemResponse(p.ID, item), Pack: h.storedPackResponse(pack, items, true, a, false)})
}

func (h *Handler) writeAddItemError(w http.ResponseWriter, packID string, err error) {
	switch {
	case errors.Is(err, store.ErrPackNotFound):
		packNotFound(w)
	case errors.Is(err, store.ErrPackFull):
		writeErrorCode(w, http.StatusConflict, apistd.CodePackLimitReached, fmt.Sprintf("A pack can hold at most %d stickers", h.packSettings().MaxStickersPerPack))
	case errors.Is(err, store.ErrPackStorageFull):
		writeErrorCode(w, http.StatusConflict, apistd.CodePackLimitReached, fmt.Sprintf("You have used all %d MB of sticker storage", h.packSettings().MaxUserStorageMB))
	case errors.Is(err, store.ErrEmojiNameTaken):
		writeErrorCode(w, http.StatusConflict, apistd.CodeEmojiNameTaken, "A custom emoji with that name already exists")
	default:
		writeInternal(w, "add pack item to "+packID, err, "Could not add the image")
	}
}

// normalizeImage validates and brings an upload within lim, throttled by imageSlots. It writes the error response
// itself and returns false on failure.
func (h *Handler) normalizeImage(w http.ResponseWriter, ctx context.Context, data []byte, lim packs.ImageLimits) ([]byte, packs.Info, bool) {
	select {
	case imageSlots <- struct{}{}:
		defer func() { <-imageSlots }()
	case <-time.After(imageSlotWait):
		writeErrorCode(w, http.StatusServiceUnavailable, apistd.CodeUnavailable, "The server is busy processing images, try again shortly")
		return nil, packs.Info{}, false
	case <-ctx.Done():
		return nil, packs.Info{}, false
	}
	out, info, err := packs.Normalize(ctx, h.FFmpegPath, data, lim)
	switch {
	case err == nil:
		return out, info, true
	case errors.Is(err, packs.ErrTooLarge):
		writeErrorCode(w, http.StatusRequestEntityTooLarge, apistd.CodePayloadTooLarge, fmt.Sprintf("The image must be at most %d KB", lim.MaxBytes>>10))
	case errors.Is(err, packs.ErrDimensions):
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeImageInvalid, fmt.Sprintf("The image must be at most %dx%d pixels", lim.MaxDim, lim.MaxDim))
	default:
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeImageInvalid, "Only PNG, JPEG, GIF and WebP images are accepted")
	}
	return nil, packs.Info{}, false
}

// DeletePackItem godoc
//
//	@Summary     Remove a sticker from a pack
//	@Description Removes one sticker and deletes its stored image.
//	@Description **Access:** Authenticated (pack owner).
//	@Tags        packs
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string true "Pack ID"
//	@Param       item path string true "Item ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id}/items/{item} [delete]
func (h *Handler) DeletePackItem(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	p, ok := h.loadEditable(w, a, r.PathValue("id"), false)
	if !ok {
		return
	}
	h.removeItem(w, nil, p, r.PathValue("item"))
}

func (h *Handler) removeItem(w http.ResponseWriter, admin *models.User, p *models.Pack, itemID string) {
	it, err := h.Store.DeletePackItem(p.ID, itemID)
	if err != nil {
		if errors.Is(err, store.ErrItemNotFound) || errors.Is(err, store.ErrPackNotFound) {
			packNotFound(w)
			return
		}
		writeInternal(w, "delete pack item", err, "Could not remove the image")
		return
	}
	h.deleteItemFiles([]*models.PackItem{it})
	if admin != nil {
		action, target := "pack.item.delete", packAuditTarget(p)
		if it.Name != "" {
			action, target = "emoji.delete", ":"+it.Name+":"
		}
		h.audit(admin, action, target)
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// ReorderPackItems godoc
//
//	@Summary     Reorder the stickers of a pack
//	@Description `item_ids` must list every sticker of the pack exactly once, in the new order.
//	@Description **Access:** Authenticated (pack owner).
//	@Tags        packs
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string              true "Pack ID"
//	@Param       body body ReorderItemsRequest true "New order"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id}/order [put]
func (h *Handler) ReorderPackItems(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	p, ok := h.loadEditable(w, a, r.PathValue("id"), false)
	if !ok {
		return
	}
	h.reorderItems(w, r, nil, p)
}

func (h *Handler) reorderItems(w http.ResponseWriter, r *http.Request, admin *models.User, p *models.Pack) {
	var body ReorderItemsRequest
	if !decodeJSONLimit(w, r, &body, 1<<16, "Invalid request") {
		return
	}
	if err := h.Store.ReorderPackItems(p.ID, body.ItemIDs); err != nil {
		switch {
		case errors.Is(err, store.ErrBadOrder):
			writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "item_ids must list every item of the pack exactly once")
		case errors.Is(err, store.ErrPackNotFound):
			packNotFound(w)
		default:
			writeInternal(w, "reorder pack items", err, "Could not reorder the pack")
		}
		return
	}
	if admin != nil {
		h.audit(admin, "pack.reorder", packAuditTarget(p))
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}
