package api

import (
	"errors"
	"net/http"
	"sort"

	"cove/backend/internal/apistd"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// adminPackActor is the admin as a pack caller.
func adminPackActor(r *http.Request) (*packActor, *models.User) {
	u := adminActor(r)
	return &packActor{ID: u.ID, Name: u.Username, Admin: true}, u
}

// AdminListPacks godoc
//
//	@Summary     List every pack on the server
//	@Description Built-in sticker packs, server packs and all user packs with their owners, enabled and default flags,
//	@Description for management and moderation. Items are left out. The custom emoji set is listed as kind `emoji_custom`.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AdminPackListResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/packs [get]
func (h *Handler) AdminListPacks(w http.ResponseWriter, r *http.Request) {
	a, _ := adminPackActor(r)
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "admin packs: catalog", err, "Sticker assets are unavailable")
		return
	}
	states, err := h.Store.ListPackStates()
	if err != nil {
		writeInternal(w, "admin packs: states", err, "Could not load packs")
		return
	}
	out := []PackResponse{}
	for _, p := range cat.Packs {
		st, has := states[p.ID]
		if !has {
			st = &models.PackState{PackID: p.ID, Enabled: true}
		}
		out = append(out, h.builtinPackResponse(p, st, has, a, false))
	}
	stored, err := h.Store.ListPacks()
	if err != nil {
		writeInternal(w, "admin packs: stored", err, "Could not load packs")
		return
	}
	for _, p := range stored {
		items, err := h.Store.ListPackItems(p.ID)
		if err != nil {
			writeInternal(w, "admin packs: items "+p.ID, err, "Could not load packs")
			return
		}
		out = append(out, h.storedPackResponse(p, items, false, a, false))
	}
	rank := map[string]int{string(models.PackScopeBuiltin): 0, string(models.PackScopeServer): 1, string(models.PackScopeUser): 2}
	sort.SliceStable(out, func(i, j int) bool {
		if rank[out[i].Scope] != rank[out[j].Scope] {
			return rank[out[i].Scope] < rank[out[j].Scope]
		}
		return out[i].Order < out[j].Order
	})
	writeJSON(w, http.StatusOK, AdminPackListResponse{Items: out})
}

// AdminCreatePack godoc
//
//	@Summary     Create a server sticker pack
//	@Description Creates an empty pack that every user sees (when enabled). Add stickers with `POST /api/admin/packs/{id}/items`.
//	@Description Server packs are not subject to the user quotas.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body CreatePackRequest true "Pack"
//	@Success     201 {object} PackResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/packs [post]
func (h *Handler) AdminCreatePack(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	var body CreatePackRequest
	if !decodeJSONLimit(w, r, &body, 1<<14, "Invalid request") {
		return
	}
	name, ok1 := validText(body.Name, maxPackNameRunes, true)
	desc, ok2 := validText(body.Description, maxPackDescRunes, false)
	if !ok1 || !ok2 {
		writeError(w, http.StatusBadRequest, "Invalid pack name or description")
		return
	}
	p, err := h.Store.CreatePack(&models.Pack{Kind: models.PackKindSticker, Scope: models.PackScopeServer, Name: name, Description: desc, Enabled: true}, store.PackLimits{})
	if err != nil {
		writeInternal(w, "admin create pack", err, "Could not create the pack")
		return
	}
	h.audit(admin, "pack.create", packAuditTarget(p))
	writeJSON(w, http.StatusCreated, h.storedPackResponse(p, nil, true, a, true))
}

// AdminUpdatePack godoc
//
//	@Summary     Change a pack
//	@Description Server packs: rename, `enabled`, `default` (at most one pack is the default; the others lose the flag) and
//	@Description `order`. Built-in sticker packs: `enabled`, `default` and `order` only (their art is fixed). User packs:
//	@Description name and description only (moderation). A disabled pack disappears from pickers but keeps its items.
//	@Description **Access:** Server Admin.
//	@Tags        admin
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
//	@Router      /api/admin/packs/{id} [patch]
func (h *Handler) AdminUpdatePack(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	id := r.PathValue("id")
	if cat, err := h.catalog(); err == nil {
		if _, ok := cat.Pack(id); ok {
			h.updateBuiltinPack(w, r, a, admin, id)
			return
		}
	}
	h.updateStoredPack(w, r, a, admin, true)
}

func (h *Handler) updateBuiltinPack(w http.ResponseWriter, r *http.Request, a *packActor, admin *models.User, id string) {
	var body UpdatePackRequest
	if !decodeJSONLimit(w, r, &body, 1<<14, "Invalid request") {
		return
	}
	if body.Name != nil || body.Description != nil {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "Built-in packs cannot be renamed")
		return
	}
	cur, err := h.Store.GetPackState(id)
	if err != nil {
		writeInternal(w, "update builtin pack state", err, "Could not update the pack")
		return
	}
	enabled := cur.Enabled
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	if body.Default != nil && *body.Default && !enabled {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "Enable the pack before making it the default")
		return
	}
	if _, err := h.Store.UpdatePackState(id, func(st *models.PackState) {
		st.Enabled = enabled
		if !enabled || (body.Default != nil && !*body.Default) {
			st.Default = false
		}
		if body.Order != nil {
			st.Order = *body.Order
		}
	}); err != nil {
		writeInternal(w, "update builtin pack state", err, "Could not update the pack")
		return
	}
	if body.Default != nil && *body.Default {
		if err := h.Store.SetDefaultStickerPack(id, true); err != nil {
			writeInternal(w, "set default builtin pack", err, "Could not update the pack")
			return
		}
	}
	h.audit(admin, "pack.update", id)
	resp, status := h.packDetail(id, a)
	if status != http.StatusOK {
		writeError(w, http.StatusInternalServerError, "Could not load the pack")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// AdminDeletePack godoc
//
//	@Summary     Delete any pack
//	@Description Removes a server or user pack with its stickers and stored images and drops it from every picker. The
//	@Description action is written to the audit log with the pack and its owner. Built-in packs cannot be deleted (disable
//	@Description them instead) and neither can the custom emoji set (remove emoji one by one).
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Pack ID"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/packs/{id} [delete]
func (h *Handler) AdminDeletePack(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	id := r.PathValue("id")
	if cat, err := h.catalog(); err == nil {
		if _, ok := cat.Pack(id); ok {
			writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "Built-in packs cannot be deleted; disable them instead")
			return
		}
	}
	h.removeStoredPack(w, a, admin, id, true)
}

// AdminUploadPackItem godoc
//
//	@Summary     Add a sticker to a server pack
//	@Description Same upload rules as `POST /api/packs/{id}/items` (PNG, JPEG, GIF or WebP, at most 512x512 and 512 KB after
//	@Description normalisation) without the per-user quotas. Works on any stored pack for moderation.
//	@Description **Access:** Server Admin.
//	@Tags        admin
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
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Failure     503 {object} ErrorResponse
//	@Router      /api/admin/packs/{id}/items [post]
func (h *Handler) AdminUploadPackItem(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	p, ok := h.loadEditable(w, a, r.PathValue("id"), true)
	if !ok {
		return
	}
	h.uploadItem(w, r, a, admin, p)
}

// AdminDeletePackItem godoc
//
//	@Summary     Remove a sticker from any pack
//	@Description Removes one sticker and deletes its stored image.
//	@Description **Access:** Server Admin.
//	@Tags        admin
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
//	@Router      /api/admin/packs/{id}/items/{item} [delete]
func (h *Handler) AdminDeletePackItem(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	p, ok := h.loadEditable(w, a, r.PathValue("id"), true)
	if !ok {
		return
	}
	h.removeItem(w, admin, p, r.PathValue("item"))
}

// AdminReorderPackItems godoc
//
//	@Summary     Reorder the stickers of any pack
//	@Description `item_ids` must list every item of the pack exactly once, in the new order.
//	@Description **Access:** Server Admin.
//	@Tags        admin
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
//	@Router      /api/admin/packs/{id}/order [put]
func (h *Handler) AdminReorderPackItems(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	p, ok := h.loadEditable(w, a, r.PathValue("id"), true)
	if !ok {
		return
	}
	h.reorderItems(w, r, admin, p)
}

// AdminAddCustomEmoji godoc
//
//	@Summary     Add a custom emoji
//	@Description Multipart form: `name` (2-32 lowercase letters, digits or underscores, optionally wrapped in colons; unique on
//	@Description the server) and `file` (PNG, WebP or GIF). Stored at most 128x128 and 256 KB after normalisation. Users send
//	@Description it as `:name:` in ordinary text.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Accept      multipart/form-data
//	@Produce     json
//	@Security    BearerAuth
//	@Param       name formData string true "Shortcode, for example party_parrot"
//	@Param       file formData file   true "The image"
//	@Success     201 {object} ItemUploadResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Failure     503 {object} ErrorResponse
//	@Router      /api/admin/emoji [post]
func (h *Handler) AdminAddCustomEmoji(w http.ResponseWriter, r *http.Request) {
	a, admin := adminPackActor(r)
	p, err := h.Store.EnsureCustomEmojiPack()
	if err != nil {
		writeInternal(w, "ensure custom emoji pack", err, "Could not add the emoji")
		return
	}
	h.uploadItem(w, r, a, admin, p)
}

// AdminDeleteCustomEmoji godoc
//
//	@Summary     Remove a custom emoji
//	@Description Removes the emoji and its image; the shortcode becomes free again. Messages that contain it keep the text.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Param       name path string true "Shortcode without colons"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/emoji/{name} [delete]
func (h *Handler) AdminDeleteCustomEmoji(w http.ResponseWriter, r *http.Request) {
	_, admin := adminPackActor(r)
	it, err := h.Store.GetCustomEmojiByName(r.PathValue("name"))
	if err != nil {
		if errors.Is(err, store.ErrItemNotFound) {
			packNotFound(w)
			return
		}
		writeInternal(w, "load custom emoji", err, "Could not remove the emoji")
		return
	}
	pack, err := h.Store.GetPack(it.PackID)
	if err != nil {
		writeInternal(w, "load custom emoji pack", err, "Could not remove the emoji")
		return
	}
	h.removeItem(w, admin, pack, it.ID)
}
