package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/auth"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/packs"
	"cove/backend/internal/store"
)

// immutableCache is what every versioned asset URL gets: the version is in the path, so the bytes behind it never
// change. "private" because the endpoints are authenticated and shared caches must not hand them to anyone else.
const immutableCache = "private, max-age=31536000, immutable"

// catalog returns the built-in assets: the Handler's own (tests), or the ones embedded in the binary.
func (h *Handler) catalog() (*packs.Catalog, error) {
	if h.Packs != nil {
		return h.Packs, nil
	}
	return packs.Builtin()
}

// packActor is who is calling a pack endpoint.
type packActor struct {
	ID    string
	Name  string
	Admin bool
}

// actor loads the caller. Admin is decided from the database on every request, like the admin guard does.
func (h *Handler) actor(w http.ResponseWriter, r *http.Request) (*packActor, bool) {
	session := auth.SessionFromContext(r.Context())
	u, err := h.Store.GetUser(session.UserID)
	if err != nil {
		writeInternal(w, "packs: load caller "+session.UserID, err, "Could not load your account")
		return nil, false
	}
	return &packActor{ID: u.ID, Name: u.Username, Admin: models.IsServerAdmin(u.ServerRole)}, true
}

func packNotFound(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusNotFound, apistd.CodePackNotFound, "Pack not found")
}

// ---- JSON with ETag -------------------------------------------------------------------------------------------- //

// writeJSONETag answers with v and a content-hash ETag; a repeat request with a matching If-None-Match gets 304
// without a body. The lists behind it are small but fetched often (every app start), so this keeps them cheap.
func writeJSONETag(w http.ResponseWriter, r *http.Request, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		writeInternal(w, "marshal response", err, "Could not build the response")
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if match := r.Header.Get("If-None-Match"); match != "" && etagMatches(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(append(body, '\n'))
}

func etagMatches(header, etag string) bool {
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "*" || part == etag || strings.TrimPrefix(part, "W/") == etag {
			return true
		}
	}
	return false
}

// serveImmutable serves an asset whose URL carries its version. ServeContent adds Range and If-None-Match handling
// from the ETag set here.
func serveImmutable(w http.ResponseWriter, r *http.Request, f io.ReadSeeker, contentType, etag string) {
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", immutableCache)
	h.Set("ETag", `"`+etag+`"`)
	// Stored uploads are re-validated rasters, but a stray navigation to one must still never run anything.
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	http.ServeContent(w, r, "", time.Time{}, f)
}

// ---- Emoji styles ---------------------------------------------------------------------------------------------- //

func styleResponse(s *packs.Style, def string) EmojiStyleResponse {
	base := "/api/emoji/styles/" + s.ID + "/" + s.Version
	return EmojiStyleResponse{
		ID: s.ID, Name: s.Name, License: s.License, Attribution: s.Attribution, Source: s.Source,
		Version: s.Version, CellSize: s.CellSize, Width: s.Width, Height: s.Height, Count: s.Count,
		SheetURL: base + "/sheet.webp", IndexURL: base + "/index.json",
		SheetBytes: s.SheetBytes, IndexBytes: s.IndexBytes, Default: s.ID == def,
	}
}

// ListEmojiStyles godoc
//
//	@Summary     Emoji styles this server offers
//	@Description Returns the styles the admin enabled, the default one, and for each downloadable style a WebP sprite
//	@Description sheet plus a JSON index (code point sequence to cell corner) at immutable, versioned URLs. `native`
//	@Description (the device's own emoji font) has no assets. Clients bundle at most the default style and download the
//	@Description others on demand. The same choice is visible without signing in at `GET /api/server-info`.
//	@Description **Access:** Authenticated.
//	@Tags        emoji
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} EmojiStylesResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/emoji/styles [get]
func (h *Handler) ListEmojiStyles(w http.ResponseWriter, r *http.Request) {
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "emoji styles: catalog", err, "Emoji assets are unavailable")
		return
	}
	cfg := h.emojiSettings()
	out := EmojiStylesResponse{DefaultStyle: cfg.DefaultStyle, EnabledStyles: cfg.EnabledStyles, Styles: []EmojiStyleResponse{}}
	for _, s := range cat.Styles {
		if slices.Contains(cfg.EnabledStyles, s.ID) {
			out.Styles = append(out.Styles, styleResponse(s, cfg.DefaultStyle))
		}
	}
	writeJSONETag(w, r, out)
}

// GetEmojiStyleAsset godoc
//
//	@Summary     Download an emoji style's sprite sheet or index
//	@Description `file` is `sheet.webp` or `index.json`. The URL contains the content version from `GET /api/emoji/styles`,
//	@Description so the response is immutable (`Cache-Control: private, max-age=31536000, immutable`, ETag). A style the
//	@Description admin has not enabled, or a stale version, is 404.
//	@Description **Access:** Authenticated.
//	@Tags        emoji
//	@Produce     image/webp
//	@Produce     json
//	@Security    BearerAuth
//	@Param       style   path string true "Style id"
//	@Param       version path string true "Content version"
//	@Param       file    path string true "sheet.webp or index.json"
//	@Success     200 {file} file
//	@Success     304
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/emoji/styles/{style}/{version}/{file} [get]
func (h *Handler) GetEmojiStyleAsset(w http.ResponseWriter, r *http.Request) {
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "emoji asset: catalog", err, "Emoji assets are unavailable")
		return
	}
	s, ok := cat.Style(r.PathValue("style"))
	if !ok || s.Version != r.PathValue("version") || !slices.Contains(h.emojiSettings().EnabledStyles, s.ID) {
		writeError(w, http.StatusNotFound, "Emoji style not found")
		return
	}
	var path, ctype string
	switch r.PathValue("file") {
	case "sheet.webp":
		path, ctype = s.SheetPath, "image/webp"
	case "index.json":
		path, ctype = s.IndexPath, "application/json"
	default:
		writeError(w, http.StatusNotFound, "Emoji style not found")
		return
	}
	f, err := cat.Open(path)
	if err != nil {
		writeInternal(w, "emoji asset: open "+path, err, "Emoji assets are unavailable")
		return
	}
	defer func() { _ = f.Close() }()
	serveImmutable(w, r, f, ctype, s.ID+"-"+s.Version+"-"+r.PathValue("file"))
}

// ---- Animated emoji -------------------------------------------------------------------------------------------- //

// ListAnimatedEmoji godoc
//
//	@Summary     Animated emoji table
//	@Description Maps an emoji (code point sequence, lower-case hex joined by `-`, every FE0F removed) to an animated
//	@Description WebP. A message that is exactly one emoji with an entry here is shown as a big animation on the client;
//	@Description the message stays plain Unicode on the wire. Images are the Cove Moves animations (256 px).
//	@Description **Access:** Authenticated.
//	@Tags        emoji
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AnimatedEmojiResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/emoji/animated [get]
func (h *Handler) ListAnimatedEmoji(w http.ResponseWriter, r *http.Request) {
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "animated emoji: catalog", err, "Emoji assets are unavailable")
		return
	}
	out := AnimatedEmojiResponse{Version: cat.AnimatedVersion, Items: []AnimatedEmojiEntry{}}
	for _, a := range cat.Animated {
		out.Items = append(out.Items, AnimatedEmojiEntry{
			Sequence: a.Sequence, ID: a.ID, URL: "/api/emoji/animated/" + cat.AnimatedVersion + "/" + a.ID + ".webp",
		})
	}
	writeJSONETag(w, r, out)
}

// GetAnimatedEmojiAsset godoc
//
//	@Summary     Download one animated emoji
//	@Description `file` is `<id>.webp` from the table. Immutable, versioned URL (see `GET /api/emoji/animated`).
//	@Description **Access:** Authenticated.
//	@Tags        emoji
//	@Produce     image/webp
//	@Security    BearerAuth
//	@Param       version path string true "Content version"
//	@Param       file    path string true "<id>.webp"
//	@Success     200 {file} file
//	@Success     304
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/emoji/animated/{version}/{file} [get]
func (h *Handler) GetAnimatedEmojiAsset(w http.ResponseWriter, r *http.Request) {
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "animated emoji: catalog", err, "Emoji assets are unavailable")
		return
	}
	id, ok := strings.CutSuffix(r.PathValue("file"), ".webp")
	pack, found := cat.Pack(cat.AnimatedPackID)
	if !ok || !found || cat.AnimatedVersion != r.PathValue("version") {
		writeError(w, http.StatusNotFound, "Animation not found")
		return
	}
	item, found := pack.Item(id)
	if !found {
		writeError(w, http.StatusNotFound, "Animation not found")
		return
	}
	h.serveBuiltinFile(w, r, cat, item, "anim-"+pack.Version+"-"+item.ID)
}

func (h *Handler) serveBuiltinFile(w http.ResponseWriter, r *http.Request, cat *packs.Catalog, item *packs.Sticker, etag string) {
	f, err := cat.Open(item.File)
	if err != nil {
		writeInternal(w, "builtin asset: open "+item.File, err, "Sticker assets are unavailable")
		return
	}
	defer func() { _ = f.Close() }()
	serveImmutable(w, r, f, "image/webp", etag)
}

// ---- Attribution ----------------------------------------------------------------------------------------------- //

// GetPackAttribution godoc
//
//	@Summary     Credits for the built-in emoji and stickers
//	@Description The licence credits the About page must show (generated with the assets by `make emoji/build`).
//	@Description **Access:** Authenticated.
//	@Tags        emoji
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AttributionResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/attribution [get]
func (h *Handler) GetPackAttribution(w http.ResponseWriter, r *http.Request) {
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "attribution: catalog", err, "Emoji assets are unavailable")
		return
	}
	out := AttributionResponse{Items: []AttributionEntry{}}
	for _, s := range cat.Styles {
		out.Items = append(out.Items, AttributionEntry{ID: s.ID, Name: s.Name, Kind: string(models.PackKindEmojiStyle), License: s.License, Attribution: s.Attribution, Source: s.Source})
	}
	for _, p := range cat.Packs {
		out.Items = append(out.Items, AttributionEntry{ID: p.ID, Name: p.Name, Kind: string(models.PackKindSticker), License: p.License, Attribution: p.Attribution, Source: p.Source})
	}
	writeJSONETag(w, r, out)
}

// ---- Custom emoji ---------------------------------------------------------------------------------------------- //

func itemFileURL(packID, itemID string) string {
	return "/api/packs/" + packID + "/items/" + itemID + "/file"
}

// ListCustomEmoji godoc
//
//	@Summary     Custom emoji
//	@Description The server's custom emoji. They travel as `:name:` inside ordinary text messages (no message type);
//	@Description a client resolves the shortcode with this list and shows the text unchanged when it is unknown.
//	@Description `version` changes whenever the set changes; the response also carries an ETag.
//	@Description **Access:** Authenticated.
//	@Tags        emoji
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} CustomEmojiListResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/emoji/custom [get]
func (h *Handler) ListCustomEmoji(w http.ResponseWriter, r *http.Request) {
	items, err := h.Store.ListCustomEmoji()
	if err != nil {
		writeInternal(w, "list custom emoji", err, "Could not load custom emoji")
		return
	}
	version := "v0"
	if p, err := h.Store.GetPack(models.CustomEmojiPackID); err == nil {
		version = fmt.Sprintf("v%d", p.Version)
	}
	out := CustomEmojiListResponse{Version: version, Items: []CustomEmojiResponse{}}
	for _, it := range items {
		out.Items = append(out.Items, CustomEmojiResponse{
			Name: it.Name, URL: itemFileURL(models.CustomEmojiPackID, it.ID), FileID: it.FileID,
			Animated: it.Animated, Width: it.Width, Height: it.Height,
		})
	}
	writeJSONETag(w, r, out)
}

// ---- Pack DTO builders ----------------------------------------------------------------------------------------- //

func builtinItemURL(p *packs.StickerPack, it *packs.Sticker) string {
	return "/api/stickers/builtin/" + p.ID + "/" + p.Version + "/" + it.ID + ".webp"
}

func (h *Handler) builtinPackResponse(p *packs.StickerPack, st *models.PackState, hasState bool, a *packActor, full bool) PackResponse {
	order := p.Order
	if hasState && st.Order != 0 {
		order = st.Order
	}
	out := PackResponse{
		ID: p.ID, Kind: string(models.PackKindSticker), Scope: string(models.PackScopeBuiltin), Name: p.Name,
		Version: p.Version, License: p.License, Attribution: p.Attribution, Enabled: st.Enabled, Default: st.Default,
		Order: order, Animated: p.Animated, Installed: st.Enabled, Editable: a != nil && a.Admin, ItemCount: len(p.Items),
	}
	if len(p.Items) > 0 {
		out.CoverURL = builtinItemURL(p, &p.Items[0])
	}
	if full {
		for i := range p.Items {
			it := &p.Items[i]
			out.Items = append(out.Items, PackItemResponse{
				ID: it.ID, Name: it.Name, Emoji: it.Emoji, Animated: it.Animated, URL: builtinItemURL(p, it), Bytes: it.Bytes, Order: i,
			})
		}
	}
	return out
}

func itemResponse(packID string, it *models.PackItem) PackItemResponse {
	return PackItemResponse{
		ID: it.ID, Name: it.Name, Emoji: it.Emoji, Animated: it.Animated, URL: itemFileURL(packID, it.ID),
		FileID: it.FileID, Width: it.Width, Height: it.Height, Bytes: it.SizeBytes, Order: it.Order,
	}
}

// storedPackResponse builds the DTO of a server or user pack. items is the pack's items (always loaded: the count and
// cover come from them); full says whether to include them in the response.
func (h *Handler) storedPackResponse(p *models.Pack, items []*models.PackItem, installed bool, a *packActor, full bool) PackResponse {
	created := p.CreatedAt
	animated := false
	for _, it := range items {
		animated = animated || it.Animated
	}
	out := PackResponse{
		ID: p.ID, Kind: string(p.Kind), Scope: string(p.Scope), OwnerID: p.OwnerID, Name: p.Name, Description: p.Description,
		Version: fmt.Sprintf("v%d", p.Version), License: p.License, Attribution: p.Attribution, Enabled: p.Enabled,
		Default: p.Default, Order: p.Order, Animated: animated, Installed: installed,
		Editable:  a != nil && (a.Admin || (p.Scope == models.PackScopeUser && p.OwnerID == a.ID)),
		ItemCount: len(items), CreatedAt: &created,
	}
	if p.OwnerID != "" {
		if u, err := h.Store.GetUser(p.OwnerID); err == nil {
			out.OwnerName = u.Username
		}
	}
	if len(items) > 0 {
		out.CoverURL = itemFileURL(p.ID, items[0].ID)
	}
	if full {
		for _, it := range items {
			out.Items = append(out.Items, itemResponse(p.ID, it))
		}
	}
	return out
}

// ---- Pack list and detail -------------------------------------------------------------------------------------- //

// visibleStoredPack decides who may open a stored pack by id. Server packs follow their enabled switch (admins see
// all). A user pack is readable by any signed-in user who knows its unguessable id, which is what makes share cards
// work: the recipient has to look at a pack before adding it.
func visibleStoredPack(p *models.Pack, a *packActor) bool {
	if a.Admin {
		return true
	}
	if p.Scope == models.PackScopeServer {
		return p.Enabled
	}
	return p.Scope == models.PackScopeUser
}

func (h *Handler) quotaFor(userID string) PackQuotaResponse {
	cfg := h.packSettings()
	packsOwned, used, _ := h.Store.OwnerUsage(userID)
	return PackQuotaResponse{
		UserUploadsEnabled: cfg.UserUploadsEnabled, MaxPacks: cfg.MaxPacksPerUser, MaxStickersPerPack: cfg.MaxStickersPerPack,
		MaxStorageBytes: int64(cfg.MaxUserStorageMB) << 20, OwnedPacks: packsOwned, UsedStorageBytes: used,
		StickerMaxBytes: stickerLimits.MaxBytes, StickerMaxSide: stickerLimits.MaxDim,
	}
}

// ListPacks godoc
//
//	@Summary     The caller's sticker picker
//	@Description Built-in and server sticker packs that are enabled (shown to everyone), plus user packs the caller owns
//	@Description or added. Items are left out (`item_count`, `cover_url`); fetch a pack for them. Order: default pack
//	@Description first, then built-in, server and user packs, each by `order`. `quota` tells the client what the caller may
//	@Description still create.
//	@Description **Access:** Authenticated.
//	@Tags        packs
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} PackListResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs [get]
func (h *Handler) ListPacks(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "list packs: catalog", err, "Sticker assets are unavailable")
		return
	}
	states, err := h.Store.ListPackStates()
	if err != nil {
		writeInternal(w, "list packs: states", err, "Could not load packs")
		return
	}
	var out []PackResponse
	for _, p := range cat.Packs {
		st, has := states[p.ID]
		if !has {
			st = &models.PackState{PackID: p.ID, Enabled: true}
		}
		if st.Enabled {
			out = append(out, h.builtinPackResponse(p, st, has, a, false))
		}
	}
	stored, err := h.Store.ListPacks()
	if err != nil {
		writeInternal(w, "list packs: stored", err, "Could not load packs")
		return
	}
	installedIDs, err := h.Store.ListInstalledPackIDs(a.ID)
	if err != nil {
		writeInternal(w, "list packs: installs", err, "Could not load packs")
		return
	}
	for _, p := range stored {
		if p.Kind != models.PackKindSticker {
			continue
		}
		mine := p.Scope == models.PackScopeUser && (p.OwnerID == a.ID || slices.Contains(installedIDs, p.ID))
		if (p.Scope != models.PackScopeServer || !p.Enabled) && !mine {
			continue
		}
		items, err := h.Store.ListPackItems(p.ID)
		if err != nil {
			writeInternal(w, "list packs: items "+p.ID, err, "Could not load packs")
			return
		}
		out = append(out, h.storedPackResponse(p, items, true, a, false))
	}
	scopeRank := map[string]int{string(models.PackScopeBuiltin): 0, string(models.PackScopeServer): 1, string(models.PackScopeUser): 2}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Default != out[j].Default {
			return out[i].Default
		}
		if scopeRank[out[i].Scope] != scopeRank[out[j].Scope] {
			return scopeRank[out[i].Scope] < scopeRank[out[j].Scope]
		}
		return out[i].Order < out[j].Order
	})
	resp := PackListResponse{Items: out, Quota: h.quotaFor(a.ID)}
	if resp.Items == nil {
		resp.Items = []PackResponse{}
	}
	for _, p := range resp.Items {
		if p.Default {
			resp.DefaultPackID = p.ID
		}
	}
	writeJSONETag(w, r, resp)
}

// GetPack godoc
//
//	@Summary     A sticker pack with its items
//	@Description Works for built-in packs, server packs (while enabled) and any user pack, whose unguessable id acts as a
//	@Description share link. Admins can open disabled packs too.
//	@Description **Access:** Authenticated.
//	@Tags        packs
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Pack ID"
//	@Success     200 {object} PackResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id} [get]
func (h *Handler) GetPack(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	resp, status := h.packDetail(r.PathValue("id"), a)
	switch status {
	case http.StatusOK:
		writeJSONETag(w, r, resp)
	case http.StatusNotFound:
		packNotFound(w)
	default:
		writeError(w, http.StatusInternalServerError, "Could not load the pack")
	}
}

// packDetail loads a pack with its items for a caller, or reports 404 when it does not exist or is not visible.
func (h *Handler) packDetail(id string, a *packActor) (PackResponse, int) {
	cat, err := h.catalog()
	if err != nil {
		logger.Errorf("api: pack detail: catalog: %v", err)
		return PackResponse{}, http.StatusInternalServerError
	}
	if bp, ok := cat.Pack(id); ok {
		st, err := h.Store.GetPackState(id)
		if err != nil {
			logger.Errorf("api: pack detail: state %s: %v", id, err)
			return PackResponse{}, http.StatusInternalServerError
		}
		if !st.Enabled && !a.Admin {
			return PackResponse{}, http.StatusNotFound
		}
		states, _ := h.Store.ListPackStates()
		_, has := states[id]
		return h.builtinPackResponse(bp, st, has, a, true), http.StatusOK
	}
	p, err := h.Store.GetPack(id)
	if errors.Is(err, store.ErrPackNotFound) {
		return PackResponse{}, http.StatusNotFound
	}
	if err != nil {
		logger.Errorf("api: pack detail: load %s: %v", id, err)
		return PackResponse{}, http.StatusInternalServerError
	}
	if !visibleStoredPack(p, a) {
		return PackResponse{}, http.StatusNotFound
	}
	items, err := h.Store.ListPackItems(id)
	if err != nil {
		logger.Errorf("api: pack detail: items %s: %v", id, err)
		return PackResponse{}, http.StatusInternalServerError
	}
	return h.storedPackResponse(p, items, p.Scope == models.PackScopeServer || p.OwnerID == a.ID || h.Store.IsPackInstalled(a.ID, id), a, true), http.StatusOK
}

// ---- Image serving --------------------------------------------------------------------------------------------- //

// GetBuiltinSticker godoc
//
//	@Summary     Download a built-in sticker
//	@Description `file` is `<sticker id>.webp`. The URL carries the pack's content version (see the `url` of a pack item),
//	@Description so the response is immutable. A disabled pack is 404 for everyone but admins.
//	@Description **Access:** Authenticated.
//	@Tags        packs
//	@Produce     image/webp
//	@Security    BearerAuth
//	@Param       pack    path string true "Built-in pack id"
//	@Param       version path string true "Content version"
//	@Param       file    path string true "<sticker id>.webp"
//	@Success     200 {file} file
//	@Success     304
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/stickers/builtin/{pack}/{version}/{file} [get]
func (h *Handler) GetBuiltinSticker(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	cat, err := h.catalog()
	if err != nil {
		writeInternal(w, "builtin sticker: catalog", err, "Sticker assets are unavailable")
		return
	}
	p, found := cat.Pack(r.PathValue("pack"))
	id, isWebp := strings.CutSuffix(r.PathValue("file"), ".webp")
	if !found || !isWebp || p.Version != r.PathValue("version") {
		packNotFound(w)
		return
	}
	st, err := h.Store.GetPackState(p.ID)
	if err != nil {
		writeInternal(w, "builtin sticker: state", err, "Could not load the sticker")
		return
	}
	item, found := p.Item(id)
	if !found || (!st.Enabled && !a.Admin) {
		packNotFound(w)
		return
	}
	h.serveBuiltinFile(w, r, cat, item, "sticker-"+p.Version+"-"+item.ID)
}

// GetPackItemFile godoc
//
//	@Summary     Download a sticker or custom emoji image
//	@Description Serves the stored image of a server or user pack item with an immutable cache (an item's image never
//	@Description changes; replacing it makes a new item). Privacy trade-off: like avatars, these images are not tied to a
//	@Description channel, so any signed-in user who knows the unguessable ids can load them. That is what lets a sticker
//	@Description show in every conversation without re-encrypting it per channel.
//	@Description **Access:** Authenticated (server packs while enabled, any user pack).
//	@Tags        packs
//	@Produce     image/webp
//	@Security    BearerAuth
//	@Param       id   path string true "Pack ID"
//	@Param       item path string true "Item ID"
//	@Success     200 {file} file
//	@Success     304
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id}/items/{item}/file [get]
func (h *Handler) GetPackItemFile(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	p, err := h.Store.GetPack(r.PathValue("id"))
	if err != nil || !visibleStoredPack(p, a) {
		if err != nil && !errors.Is(err, store.ErrPackNotFound) {
			writeInternal(w, "pack item file: load pack", err, "Could not load the image")
			return
		}
		packNotFound(w)
		return
	}
	// The custom emoji pack has to be readable by everyone while enabled; admins may keep it off with its flag.
	it, err := h.Store.GetPackItem(p.ID, r.PathValue("item"))
	if err != nil {
		if errors.Is(err, store.ErrItemNotFound) {
			packNotFound(w)
			return
		}
		writeInternal(w, "pack item file: load item", err, "Could not load the image")
		return
	}
	f, err := h.Store.GetFile(it.FileID)
	if err != nil {
		packNotFound(w)
		return
	}
	rc, err := h.Storage.Open(f.StoragePath)
	if err != nil {
		writeInternal(w, "pack item file: open "+f.ID, err, "Could not load the image")
		return
	}
	defer func() { _ = rc.Close() }()
	ctype := f.MIMEType
	switch ctype {
	case "image/webp", "image/png", "image/gif", "image/jpeg":
	default:
		ctype = "application/octet-stream"
	}
	if rs, ok := rc.(io.ReadSeeker); ok {
		serveImmutable(w, r, rs, ctype, "file-"+f.ID)
		return
	}
	// Storage back-ends that cannot seek (S3) are buffered: sticker images are at most a few hundred kilobytes.
	data, err := io.ReadAll(io.LimitReader(rc, 8<<20))
	if err != nil {
		writeInternal(w, "pack item file: read "+f.ID, err, "Could not load the image")
		return
	}
	serveImmutable(w, r, bytes.NewReader(data), ctype, "file-"+f.ID)
}

// ---- Install --------------------------------------------------------------------------------------------------- //

// InstallPack godoc
//
//	@Summary     Add a user pack to the caller's picker
//	@Description Used by the "Add" button of a shared pack card. Built-in and server packs are always in the picker, so
//	@Description they cannot be installed (400). Installing a pack twice is fine.
//	@Description **Access:** Authenticated.
//	@Tags        packs
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Pack ID"
//	@Success     200 {object} PackResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id}/install [put]
func (h *Handler) InstallPack(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	p, err := h.Store.GetPack(id)
	if err != nil && !errors.Is(err, store.ErrPackNotFound) {
		writeInternal(w, "install pack: load", err, "Could not add the pack")
		return
	}
	if h.packIsAlwaysAvailable(id, p) {
		// Built-in and server packs are not installable; say so for ones that exist, 404 otherwise.
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "This pack is always available and cannot be added")
		return
	}
	if err != nil || p.Scope != models.PackScopeUser || p.Kind != models.PackKindSticker {
		packNotFound(w)
		return
	}
	if err := h.Store.InstallPack(a.ID, id); err != nil {
		if errors.Is(err, store.ErrPackNotFound) {
			packNotFound(w)
			return
		}
		writeInternal(w, "install pack", err, "Could not add the pack")
		return
	}
	resp, status := h.packDetail(id, a)
	if status != http.StatusOK {
		writeError(w, http.StatusInternalServerError, "Could not load the pack")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// packIsAlwaysAvailable reports whether id names a built-in pack or a stored server sticker pack.
func (h *Handler) packIsAlwaysAvailable(id string, stored *models.Pack) bool {
	if cat, err := h.catalog(); err == nil {
		if _, ok := cat.Pack(id); ok {
			return true
		}
	}
	return stored != nil && stored.Scope == models.PackScopeServer && stored.Kind == models.PackKindSticker
}

// UninstallPack godoc
//
//	@Summary     Remove a pack from the caller's picker
//	@Description Removes a pack added with install. The owner of a pack cannot uninstall it (delete it instead, 400).
//	@Description Removing a pack that is not installed succeeds.
//	@Description **Access:** Authenticated.
//	@Tags        packs
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Pack ID"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/packs/{id}/install [delete]
func (h *Handler) UninstallPack(w http.ResponseWriter, r *http.Request) {
	a, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if p, err := h.Store.GetPack(id); err == nil && p.OwnerID == a.ID {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "You own this pack: delete it instead")
		return
	}
	if err := h.Store.UninstallPack(a.ID, id); err != nil {
		writeInternal(w, "uninstall pack", err, "Could not remove the pack")
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// ---- File cleanup ---------------------------------------------------------------------------------------------- //

// deleteItemFiles removes the stored image (record and blob) of each item. It is best effort and repeatable: the
// pack data is already gone, so a failure here only leaves an orphan blob, which is logged.
func (h *Handler) deleteItemFiles(items []*models.PackItem) {
	for _, it := range items {
		f, err := h.Store.DeleteFileRecord(it.FileID)
		if err != nil {
			logger.Warnf("packs: delete file record %s: %v", it.FileID, err)
			continue
		}
		if f == nil {
			continue
		}
		if err := h.Storage.Delete(f.StoragePath); err != nil {
			logger.Warnf("packs: delete blob of file %s: %v", f.ID, err)
		}
	}
}

// cleanupUserPacks drops everything a deleted account made or added and removes the stored images.
func (h *Handler) cleanupUserPacks(userID string) {
	items, err := h.Store.DeleteUserPacks(userID)
	if err != nil {
		logger.Warnf("packs: clean up packs of %s: %v", userID, err)
		return
	}
	h.deleteItemFiles(items)
}
