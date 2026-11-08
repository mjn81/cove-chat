package tests

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"math/rand"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"

	"cove/backend/internal/config"
)

// ---- helpers --------------------------------------------------------------------------------------------------- //

// pngBytes makes a w x h PNG. noisy fills it with incompressible pixels so the file is big.
func pngBytes(t *testing.T, w, h int, noisy bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(7))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if noisy {
				img.Set(x, y, color.NRGBA{uint8(rng.Intn(256)), uint8(rng.Intn(256)), uint8(rng.Intn(256)), 255})
			} else {
				img.Set(x, y, color.NRGBA{200, 80, 60, 255})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func gifBytes(t *testing.T, w, h, frames int) []byte {
	t.Helper()
	g := &gif.GIF{}
	pal := []color.Color{color.Black, color.White, color.RGBA{200, 0, 0, 255}}
	for i := 0; i < frames; i++ {
		fr := image.NewPaletted(image.Rect(0, 0, w, h), pal)
		for x := 0; x < w; x++ {
			fr.SetColorIndex(x, i%h, 2)
		}
		g.Image = append(g.Image, fr)
		g.Delay = append(g.Delay, 5)
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, g); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// tinyWebP is a valid 1x1 lossless WebP.
var tinyWebP = []byte("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00")

const svgDoc = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>`

// noFFmpeg makes image normalisation use the strict fallback.
func (e *adminEnv) noFFmpeg() { e.handler.FFmpegPath = "no-such-ffmpeg-binary" }

func needFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
}

// upload sends a multipart form with one file part named "file" and extra text fields.
func (e *adminEnv) upload(t *testing.T, path, token string, fields map[string]string, filename string, data []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	if data != nil {
		fw, _ := mw.CreateFormFile("file", filename)
		_, _ = fw.Write(data)
	}
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload %s: %v", path, err)
	}
	return resp
}

func (e *adminEnv) patchConfig(t *testing.T, token string, changes map[string]any) *http.Response {
	t.Helper()
	return e.do(t, "PATCH", "/api/admin/config", token, map[string]any{"changes": changes})
}

func wantStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("%s %s = %d, want %d: %s", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode, want, body)
	}
}

func wantCode(t *testing.T, resp *http.Response, status int, code string) {
	t.Helper()
	wantStatus(t, resp, status)
	if _, got := errEnvelope(t, resp); got != code {
		t.Fatalf("error code = %q, want %q", got, code)
	}
}

type packDTO struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Scope       string `json:"scope"`
	OwnerID     string `json:"owner_id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Enabled     bool   `json:"enabled"`
	Default     bool   `json:"default"`
	Installed   bool   `json:"installed"`
	Editable    bool   `json:"editable"`
	ItemCount   int    `json:"item_count"`
	CoverURL    string `json:"cover_url"`
	Items       []itemDTO `json:"items"`
}

type itemDTO struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Emoji    string `json:"emoji"`
	URL      string `json:"url"`
	FileID   string `json:"file_id"`
	Animated bool   `json:"animated"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Bytes    int64  `json:"bytes"`
}

type packList struct {
	Items         []packDTO `json:"items"`
	DefaultPackID string    `json:"default_pack_id"`
	Quota         struct {
		UserUploadsEnabled bool  `json:"user_uploads_enabled"`
		MaxPacks           int   `json:"max_packs"`
		MaxStickersPerPack int   `json:"max_stickers_per_pack"`
		MaxStorageBytes    int64 `json:"max_storage_bytes"`
		OwnedPacks         int   `json:"owned_packs"`
		UsedStorageBytes   int64 `json:"used_storage_bytes"`
	} `json:"quota"`
}

func (e *adminEnv) createUserPack(t *testing.T, token, name string) packDTO {
	t.Helper()
	resp := e.do(t, "POST", "/api/packs", token, map[string]string{"name": name})
	wantStatus(t, resp, http.StatusCreated)
	var p packDTO
	readJSON(t, resp, &p)
	return p
}

func (e *adminEnv) uploadSticker(t *testing.T, packID, token string, data []byte) itemDTO {
	t.Helper()
	resp := e.upload(t, "/api/packs/"+packID+"/items", token, map[string]string{"emoji": "😀"}, "s.png", data)
	wantStatus(t, resp, http.StatusCreated)
	var out struct {
		Item itemDTO `json:"item"`
	}
	readJSON(t, resp, &out)
	return out.Item
}

func (e *adminEnv) get(t *testing.T, path, token string, headers map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, e.srv.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// ---- authentication on every route ------------------------------------------------------------------------------ //

func TestPacks_EveryRouteRequiresSignIn(t *testing.T) {
	e := newAdminEnv(t, "open")
	routes := []struct{ method, path string }{
		{"GET", "/api/emoji/styles"},
		{"GET", "/api/emoji/styles/noto/v/sheet.webp"},
		{"GET", "/api/emoji/custom"},
		{"GET", "/api/emoji/animated"},
		{"GET", "/api/emoji/animated/v/x.webp"},
		{"GET", "/api/stickers/builtin/cove-basics/v/x.webp"},
		{"GET", "/api/packs/attribution"},
		{"GET", "/api/packs"},
		{"POST", "/api/packs"},
		{"GET", "/api/packs/x"},
		{"PATCH", "/api/packs/x"},
		{"DELETE", "/api/packs/x"},
		{"PUT", "/api/packs/x/install"},
		{"DELETE", "/api/packs/x/install"},
		{"POST", "/api/packs/x/items"},
		{"DELETE", "/api/packs/x/items/y"},
		{"GET", "/api/packs/x/items/y/file"},
		{"PUT", "/api/packs/x/order"},
		{"GET", "/api/admin/packs"},
		{"POST", "/api/admin/packs"},
		{"PATCH", "/api/admin/packs/x"},
		{"DELETE", "/api/admin/packs/x"},
		{"POST", "/api/admin/packs/x/items"},
		{"DELETE", "/api/admin/packs/x/items/y"},
		{"PUT", "/api/admin/packs/x/order"},
		{"POST", "/api/admin/emoji"},
		{"DELETE", "/api/admin/emoji/x"},
	}
	for _, rt := range routes {
		resp := e.do(t, rt.method, rt.path, "", map[string]string{})
		wantCode(t, resp, http.StatusUnauthorized, "unauthorized")
	}
}

func TestPacks_AdminRoutesRefuseMembers(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)
	routes := []struct{ method, path string }{
		{"GET", "/api/admin/packs"}, {"POST", "/api/admin/packs"}, {"PATCH", "/api/admin/packs/x"},
		{"DELETE", "/api/admin/packs/x"}, {"POST", "/api/admin/packs/x/items"},
		{"DELETE", "/api/admin/packs/x/items/y"}, {"PUT", "/api/admin/packs/x/order"},
		{"POST", "/api/admin/emoji"}, {"DELETE", "/api/admin/emoji/x"},
	}
	for _, rt := range routes {
		resp := e.do(t, rt.method, rt.path, member, map[string]string{})
		wantCode(t, resp, http.StatusForbidden, "forbidden")
	}
}

// ---- emoji styles ------------------------------------------------------------------------------------------------ //

type stylesDTO struct {
	DefaultStyle  string   `json:"default_style"`
	EnabledStyles []string `json:"enabled_styles"`
	Styles        []struct {
		ID       string `json:"id"`
		Version  string `json:"version"`
		SheetURL string `json:"sheet_url"`
		IndexURL string `json:"index_url"`
		CellSize int    `json:"cell_size"`
		Count    int    `json:"count"`
		Default  bool   `json:"default"`
	} `json:"styles"`
}

func TestEmojiStyles_ListAndImmutableAssets(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)

	var list stylesDTO
	readJSON(t, e.get(t, "/api/emoji/styles", member, nil), &list)
	if list.DefaultStyle != "noto" || len(list.Styles) != 5 {
		t.Fatalf("default %q with %d styles, want noto with 5 (native has no assets)", list.DefaultStyle, len(list.Styles))
	}
	noto := list.Styles[0]
	if noto.ID != "noto" || !noto.Default || noto.CellSize != 64 || noto.Count < 1000 {
		t.Fatalf("noto = %+v", noto)
	}

	sheet := e.get(t, noto.SheetURL, member, nil)
	wantStatus(t, sheet, http.StatusOK)
	data, _ := io.ReadAll(sheet.Body)
	sheet.Body.Close()
	if !bytes.HasPrefix(data, []byte("RIFF")) || sheet.Header.Get("Content-Type") != "image/webp" {
		t.Fatalf("sheet is not a WebP (type %q)", sheet.Header.Get("Content-Type"))
	}
	if cc := sheet.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") || !strings.Contains(cc, "max-age=31536000") {
		t.Errorf("Cache-Control = %q, want immutable", cc)
	}
	if sheet.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}
	etag := sheet.Header.Get("ETag")
	if etag == "" {
		t.Fatal("no ETag")
	}
	again := e.get(t, noto.SheetURL, member, map[string]string{"If-None-Match": etag})
	wantStatus(t, again, http.StatusNotModified)
	again.Body.Close()

	var idx struct {
		Size  int                `json:"size"`
		Emoji map[string][]int   `json:"emoji"`
	}
	index := e.get(t, noto.IndexURL, member, nil)
	wantStatus(t, index, http.StatusOK)
	if ct := index.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("index type = %q", ct)
	}
	readJSON(t, index, &idx)
	if _, ok := idx.Emoji["1f600"]; !ok || idx.Size != 64 {
		t.Errorf("index lacks 1f600 or size: size=%d entries=%d", idx.Size, len(idx.Emoji))
	}

	// A stale version, an unknown style and an unknown file are all 404.
	for _, p := range []string{"/api/emoji/styles/noto/0000/sheet.webp", "/api/emoji/styles/nope/" + noto.Version + "/sheet.webp", "/api/emoji/styles/noto/" + noto.Version + "/other.bin"} {
		resp := e.get(t, p, member, nil)
		wantStatus(t, resp, http.StatusNotFound)
		resp.Body.Close()
	}

	// The list itself revalidates with its ETag.
	l := e.get(t, "/api/emoji/styles", member, nil)
	tag := l.Header.Get("ETag")
	l.Body.Close()
	l2 := e.get(t, "/api/emoji/styles", member, map[string]string{"If-None-Match": tag})
	wantStatus(t, l2, http.StatusNotModified)
	l2.Body.Close()
}

func TestEmojiStyles_AdminChoosesStylesAndDefault(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, member := e.seedRoles(t)

	resp := e.patchConfig(t, admin, map[string]any{"emoji.enabled_styles": []string{"native", "twemoji"}, "emoji.default_style": "twemoji"})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	var list stylesDTO
	readJSON(t, e.get(t, "/api/emoji/styles", member, nil), &list)
	if list.DefaultStyle != "twemoji" || len(list.Styles) != 1 || list.Styles[0].ID != "twemoji" || len(list.EnabledStyles) != 2 {
		t.Fatalf("after change: %+v", list)
	}

	// The choice is public, for clients that look before signing in.
	var info struct {
		EmojiStyles         []string `json:"emoji_styles"`
		DefaultEmojiStyle   string   `json:"default_emoji_style"`
		UserStickersEnabled bool     `json:"user_stickers_enabled"`
	}
	readJSON(t, e.get(t, "/api/server-info", "", nil), &info)
	if info.DefaultEmojiStyle != "twemoji" || len(info.EmojiStyles) != 2 || !info.UserStickersEnabled {
		t.Fatalf("server-info = %+v", info)
	}

	// A disabled style's assets are gone.
	resp = e.get(t, "/api/emoji/styles/noto/anything/sheet.webp", member, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}

func TestEmojiStyles_AdminSettingValidation(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, _ := e.seedRoles(t)
	before, _ := os.ReadFile(e.configPath)
	bad := []map[string]any{
		{"emoji.enabled_styles": []string{}},
		{"emoji.enabled_styles": []string{"noto", "openmoji"}},
		{"emoji.enabled_styles": []string{"noto", "noto"}},
		{"emoji.default_style": "openmoji"},
		{"emoji.enabled_styles": []string{"native"}},                                    // default noto no longer enabled
		{"emoji.enabled_styles": []string{"native", "noto"}, "emoji.default_style": "twemoji"}, // default not in the list
		{"packs.max_packs_per_user": 0},
		{"packs.max_stickers_per_pack": 100000},
		{"packs.max_user_storage_mb": "lots"},
	}
	for _, changes := range bad {
		resp := e.patchConfig(t, admin, changes)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("PATCH %v = %d, want 400", changes, resp.StatusCode)
		}
		resp.Body.Close()
	}
	after, _ := os.ReadFile(e.configPath)
	if string(before) != string(after) {
		t.Error("a rejected change modified the config file")
	}
	// Changing only the default to a style that is still enabled is fine; the file must stay loadable.
	resp := e.patchConfig(t, admin, map[string]any{"emoji.default_style": "fluent", "packs.max_stickers_per_pack": 12, "packs.user_uploads_enabled": false})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	cfg, err := config.Read(e.configPath)
	if err != nil {
		t.Fatalf("config no longer loads: %v", err)
	}
	if cfg.Emoji.DefaultStyle != "fluent" || cfg.Packs.MaxStickersPerPack != 12 || cfg.Packs.UserUploadsEnabled {
		t.Errorf("saved = %+v %+v", cfg.Emoji, cfg.Packs)
	}
}

func TestEmojiStyles_EmbeddedStylesMatchTheConfigList(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)
	var list stylesDTO
	readJSON(t, e.get(t, "/api/emoji/styles", member, nil), &list)
	got := map[string]bool{}
	for _, s := range list.Styles {
		got[s.ID] = true
	}
	for _, id := range config.EmojiStyleIDs {
		if id != "native" && !got[id] {
			t.Errorf("style %q is selectable in the config but not embedded", id)
		}
	}
}

func TestPacks_CapabilitiesAdvertised(t *testing.T) {
	e := newAdminEnv(t, "open")
	var v struct {
		Capabilities []string `json:"capabilities"`
	}
	readJSON(t, e.get(t, "/api/version", "", nil), &v)
	have := strings.Join(v.Capabilities, ",")
	for _, c := range []string{"emoji_packs", "custom_emoji", "stickers", "animated_emoji"} {
		if !strings.Contains(have, c) {
			t.Errorf("capability %s missing from %s", c, have)
		}
	}
}

// ---- built-in sticker packs --------------------------------------------------------------------------------------- //

func TestBuiltinPacks_ListDetailAndAssets(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)

	var list packList
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	var basics *packDTO
	for i := range list.Items {
		if list.Items[i].ID == "cove-basics" {
			basics = &list.Items[i]
		}
	}
	if basics == nil || basics.Scope != "builtin" || basics.ItemCount != 48 || !basics.Installed || basics.CoverURL == "" || len(basics.Items) != 0 {
		t.Fatalf("cove-basics in list = %+v", basics)
	}
	if !list.Quota.UserUploadsEnabled || list.Quota.MaxPacks != 10 || list.Quota.MaxStickersPerPack != 60 {
		t.Errorf("quota = %+v", list.Quota)
	}

	var detail packDTO
	readJSON(t, e.get(t, "/api/packs/cove-basics", member, nil), &detail)
	if len(detail.Items) != 48 || detail.Items[0].URL == "" || detail.Items[0].Emoji == "" {
		t.Fatalf("detail has %d items, first %+v", len(detail.Items), detail.Items[0])
	}
	img := e.get(t, detail.Items[0].URL, member, nil)
	wantStatus(t, img, http.StatusOK)
	data, _ := io.ReadAll(img.Body)
	img.Body.Close()
	if !bytes.HasPrefix(data, []byte("RIFF")) || !strings.Contains(img.Header.Get("Cache-Control"), "immutable") {
		t.Errorf("sticker not an immutable WebP (cache %q)", img.Header.Get("Cache-Control"))
	}
	stale := strings.Replace(detail.Items[0].URL, detail.Version, "000000000000", 1)
	resp := e.get(t, stale, member, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()

	resp = e.get(t, "/api/packs/nope", member, nil)
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")
}

func TestBuiltinPacks_AdminEnablesDisablesAndSetsDefault(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, member := e.seedRoles(t)

	// Members cannot manage packs.
	resp := e.do(t, "PATCH", "/api/admin/packs/cove-basics", member, map[string]any{"enabled": false})
	wantStatus(t, resp, http.StatusForbidden)
	resp.Body.Close()

	resp = e.do(t, "PATCH", "/api/admin/packs/cove-basics", admin, map[string]any{"default": true})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var list packList
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	if list.DefaultPackID != "cove-basics" || list.Items[0].ID != "cove-basics" {
		t.Fatalf("default = %q, first = %q", list.DefaultPackID, list.Items[0].ID)
	}

	// A disabled pack cannot be the default, and disappears from members' lists, details and images.
	resp = e.do(t, "PATCH", "/api/admin/packs/cove-moves", admin, map[string]any{"enabled": false, "default": true})
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	resp = e.do(t, "PATCH", "/api/admin/packs/cove-basics", admin, map[string]any{"enabled": false})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	list = packList{} // decoding into a used struct would keep the old default_pack_id
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	for _, p := range list.Items {
		if p.ID == "cove-basics" {
			t.Fatal("disabled pack is still in the member's list")
		}
	}
	if list.DefaultPackID != "" {
		t.Errorf("a disabled pack is still the default: %q", list.DefaultPackID)
	}
	resp = e.get(t, "/api/packs/cove-basics", member, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	resp = e.get(t, "/api/packs/cove-basics", admin, nil)
	wantStatus(t, resp, http.StatusOK) // admins still see it
	resp.Body.Close()

	// Built-in packs cannot be renamed or deleted.
	resp = e.do(t, "PATCH", "/api/admin/packs/cove-basics", admin, map[string]any{"name": "Mine"})
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/admin/packs/cove-basics", admin, nil)
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
}

func TestAnimatedEmojiAndAttribution(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)

	var anim struct {
		Version string `json:"version"`
		Items   []struct {
			Sequence string `json:"sequence"`
			ID       string `json:"id"`
			URL      string `json:"url"`
		} `json:"items"`
	}
	readJSON(t, e.get(t, "/api/emoji/animated", member, nil), &anim)
	if anim.Version == "" || len(anim.Items) < 60 {
		t.Fatalf("animated table: version %q, %d items", anim.Version, len(anim.Items))
	}
	var rocket string
	for _, it := range anim.Items {
		if it.Sequence == "1f680" {
			rocket = it.URL
		}
		if strings.Contains(it.Sequence, "fe0f") {
			t.Errorf("sequence %q contains FE0F", it.Sequence)
		}
	}
	if rocket == "" {
		t.Fatal("rocket (1f680) is not in the animated table")
	}
	img := e.get(t, rocket, member, nil)
	wantStatus(t, img, http.StatusOK)
	data, _ := io.ReadAll(img.Body)
	img.Body.Close()
	if !bytes.HasPrefix(data, []byte("RIFF")) || !strings.Contains(img.Header.Get("Cache-Control"), "immutable") {
		t.Error("animated emoji is not an immutable WebP")
	}

	var att struct {
		Items []struct{ ID, Kind, License string } `json:"items"`
	}
	readJSON(t, e.get(t, "/api/packs/attribution", member, nil), &att)
	ids := map[string]bool{}
	for _, it := range att.Items {
		ids[it.ID] = true
		if it.License == "" {
			t.Errorf("%s has no licence", it.ID)
		}
	}
	for _, want := range []string{"noto", "twemoji", "blobmoji", "fluent", "fxemoji", "cove-basics", "cove-moves"} {
		if !ids[want] {
			t.Errorf("attribution lacks %s", want)
		}
	}
	if ids["openmoji"] {
		t.Error("OpenMoji must not be shipped")
	}
}

// ---- user packs --------------------------------------------------------------------------------------------------- //

func TestUserPacks_CreateValidationAndQuota(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, member := e.seedRoles(t)

	for _, body := range []map[string]string{{"name": ""}, {"name": "   "}, {"name": strings.Repeat("x", 51)}, {"name": "bad\x07name"}, {"name": "ok", "description": strings.Repeat("d", 201)}} {
		resp := e.do(t, "POST", "/api/packs", member, body)
		wantStatus(t, resp, http.StatusBadRequest)
		resp.Body.Close()
	}
	p := e.createUserPack(t, member, "  Cats  ")
	if p.Name != "Cats" || p.Scope != "user" || p.Kind != "sticker" || !p.Editable || p.OwnerID == "" || p.Version != "v1" {
		t.Fatalf("created pack = %+v", p)
	}

	resp := e.patchConfig(t, admin, map[string]any{"packs.max_packs_per_user": 2})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	e.createUserPack(t, member, "Second")
	resp = e.do(t, "POST", "/api/packs", member, map[string]string{"name": "Third"})
	wantCode(t, resp, http.StatusConflict, "pack_limit_reached")

	// The new pack is in the owner's list, with the usage reflected in the quota.
	var list packList
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	found := false
	for _, it := range list.Items {
		found = found || it.ID == p.ID
	}
	if !found || list.Quota.OwnedPacks != 2 || list.Quota.MaxPacks != 2 {
		t.Errorf("list: found=%v quota=%+v", found, list.Quota)
	}
}

func TestUserPacks_UploadsCanBeSwitchedOff(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, member := e.seedRoles(t)
	p := e.createUserPack(t, member, "Mine")

	resp := e.patchConfig(t, admin, map[string]any{"packs.user_uploads_enabled": false})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	resp = e.do(t, "POST", "/api/packs", member, map[string]string{"name": "New"})
	wantCode(t, resp, http.StatusForbidden, "pack_uploads_disabled")
	resp = e.upload(t, "/api/packs/"+p.ID+"/items", member, nil, "a.png", pngBytes(t, 32, 32, false))
	wantCode(t, resp, http.StatusForbidden, "pack_uploads_disabled")

	// Existing packs stay usable and deletable; admins can still add to server packs.
	resp = e.get(t, "/api/packs/"+p.ID, member, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/packs/"+p.ID, member, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var info struct {
		UserStickersEnabled bool `json:"user_stickers_enabled"`
	}
	readJSON(t, e.get(t, "/api/server-info", "", nil), &info)
	if info.UserStickersEnabled {
		t.Error("server-info still says user stickers are enabled")
	}
}

func TestUserPacks_UploadStrictValidation(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, _, member := e.seedRoles(t)
	p := e.createUserPack(t, member, "Mine")
	path := "/api/packs/" + p.ID + "/items"

	// Raster images within the caps are stored unchanged.
	good := pngBytes(t, 64, 48, false)
	it := e.uploadSticker(t, p.ID, member, good)
	if it.Width != 64 || it.Height != 48 || it.Emoji != "😀" || it.FileID == "" || !strings.HasSuffix(it.URL, "/file") {
		t.Fatalf("stored item = %+v", it)
	}
	img := e.get(t, it.URL, member, nil)
	wantStatus(t, img, http.StatusOK)
	got, _ := io.ReadAll(img.Body)
	img.Body.Close()
	if !bytes.Equal(got, good) || img.Header.Get("Content-Type") != "image/png" || !strings.Contains(img.Header.Get("Cache-Control"), "immutable") {
		t.Errorf("stored image differs or has wrong headers (%q, %q)", img.Header.Get("Content-Type"), img.Header.Get("Cache-Control"))
	}
	if csp := img.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox") {
		t.Errorf("stored image CSP = %q", csp)
	}
	for name, data := range map[string][]byte{"webp": tinyWebP, "gif": gifBytes(t, 20, 20, 1), "animated gif": gifBytes(t, 20, 20, 3)} {
		resp := e.upload(t, path, member, nil, "x."+name, data)
		if resp.StatusCode != http.StatusCreated {
			t.Errorf("%s upload = %d, want 201", name, resp.StatusCode)
		}
		resp.Body.Close()
	}

	// Refused by their bytes, whatever the file name or claimed type says.
	svg := []byte(svgDoc)
	for name, data := range map[string][]byte{"svg": svg, "html as png": []byte("<html><script>1</script></html>"), "empty": {}, "text": []byte("hello"), "truncated png": good[:20]} {
		resp := e.upload(t, path, member, nil, "evil.png", data)
		if name == "empty" {
			wantStatus(t, resp, http.StatusBadRequest)
			resp.Body.Close()
			continue
		}
		wantCode(t, resp, http.StatusBadRequest, "image_invalid")
	}
	// Missing file field, bad emoji.
	resp := e.upload(t, path, member, nil, "", nil)
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	for _, em := range []string{"abc", "hi there", "<b>"} {
		resp = e.upload(t, path, member, map[string]string{"emoji": em}, "a.png", good)
		wantStatus(t, resp, http.StatusBadRequest)
		resp.Body.Close()
	}

	// Too many pixels, and too many bytes.
	resp = e.upload(t, path, member, nil, "big.png", pngBytes(t, 600, 600, false))
	wantCode(t, resp, http.StatusBadRequest, "image_invalid")
	resp = e.upload(t, path, member, nil, "heavy.png", pngBytes(t, 450, 450, true))
	wantCode(t, resp, http.StatusRequestEntityTooLarge, "payload_too_large")
	resp = e.upload(t, path, member, nil, "huge.png", pngBytes(t, 1400, 1400, true)) // over the 4 MB intake cap
	wantCode(t, resp, http.StatusRequestEntityTooLarge, "payload_too_large")
}

func TestUserPacks_UploadNormalisesWithFFmpeg(t *testing.T) {
	needFFmpeg(t)
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)
	p := e.createUserPack(t, member, "Mine")

	// An oversized PNG is shrunk to WebP within 512 px and 512 KB.
	it := e.uploadSticker(t, p.ID, member, pngBytes(t, 900, 700, false))
	if it.Width > 512 || it.Height > 512 || it.Width < 400 || it.Bytes > 512<<10 {
		t.Fatalf("normalised item = %+v", it)
	}
	img := e.get(t, it.URL, member, nil)
	data, _ := io.ReadAll(img.Body)
	img.Body.Close()
	if img.Header.Get("Content-Type") != "image/webp" || !bytes.HasPrefix(data, []byte("RIFF")) {
		t.Errorf("normalised image is %q", img.Header.Get("Content-Type"))
	}
	// A noisy photo-like image that would be over 512 KB as PNG comes out small enough.
	it = e.uploadSticker(t, p.ID, member, pngBytes(t, 400, 400, true))
	if it.Bytes > 512<<10 {
		t.Errorf("noisy image stored at %d bytes", it.Bytes)
	}
	// An animated GIF stays animated.
	it = e.uploadSticker(t, p.ID, member, gifBytes(t, 120, 120, 6))
	if !it.Animated {
		t.Errorf("animated GIF lost its animation: %+v", it)
	}
}

func TestUserPacks_ItemQuotas(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, admin, member := e.seedRoles(t)
	p := e.createUserPack(t, member, "Mine")
	resp := e.patchConfig(t, admin, map[string]any{"packs.max_stickers_per_pack": 2})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	e.uploadSticker(t, p.ID, member, pngBytes(t, 16, 16, false))
	e.uploadSticker(t, p.ID, member, pngBytes(t, 17, 17, false))
	resp = e.upload(t, "/api/packs/"+p.ID+"/items", member, nil, "c.png", pngBytes(t, 18, 18, false))
	wantCode(t, resp, http.StatusConflict, "pack_limit_reached")

	// Total storage: a 1 MB quota fills with a few big stickers, in any of the user's packs.
	resp = e.patchConfig(t, admin, map[string]any{"packs.max_stickers_per_pack": 50, "packs.max_user_storage_mb": 1})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	q := e.createUserPack(t, member, "Second")
	big := pngBytes(t, 300, 300, true) // about 270 KB each
	stored := 0
	for i := 0; i < 6; i++ {
		resp := e.upload(t, "/api/packs/"+q.ID+"/items", member, nil, "b.png", big)
		if resp.StatusCode == http.StatusCreated {
			stored++
		} else {
			wantCode(t, resp, http.StatusConflict, "pack_limit_reached")
			break
		}
		resp.Body.Close()
	}
	if stored < 2 || stored > 3 {
		t.Errorf("stored %d big stickers under a 1 MB quota, want 2 or 3", stored)
	}
}

func TestUserPacks_OnlyTheOwnerChangesAPack(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, admin, member := e.seedRoles(t)
	e.mustRegister(t, "other")
	other := e.login(t, "other")
	p := e.createUserPack(t, member, "Mine")
	it := e.uploadSticker(t, p.ID, member, pngBytes(t, 20, 20, false))

	forbidden := func(method, path string, body any) {
		t.Helper()
		resp := e.do(t, method, path, other, body)
		wantCode(t, resp, http.StatusForbidden, "forbidden")
	}
	forbidden("PATCH", "/api/packs/"+p.ID, map[string]string{"name": "Hijacked"})
	forbidden("DELETE", "/api/packs/"+p.ID, nil)
	forbidden("DELETE", "/api/packs/"+p.ID+"/items/"+it.ID, nil)
	forbidden("PUT", "/api/packs/"+p.ID+"/order", map[string]any{"item_ids": []string{it.ID}})
	resp := e.upload(t, "/api/packs/"+p.ID+"/items", other, nil, "a.png", pngBytes(t, 20, 20, false))
	wantCode(t, resp, http.StatusForbidden, "forbidden")

	// Even an admin goes through the admin routes for other people's packs; the user routes stay owner-only.
	resp = e.do(t, "DELETE", "/api/packs/"+p.ID, admin, nil)
	wantCode(t, resp, http.StatusForbidden, "forbidden")

	// Unknown pack and unknown item are 404.
	resp = e.do(t, "PATCH", "/api/packs/nope", member, map[string]string{"name": "x"})
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")
	resp = e.do(t, "DELETE", "/api/packs/"+p.ID+"/items/nope", member, nil)
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")

	// Nothing changed.
	var got packDTO
	readJSON(t, e.get(t, "/api/packs/"+p.ID, member, nil), &got)
	if got.Name != "Mine" || len(got.Items) != 1 {
		t.Errorf("pack was changed: %+v", got)
	}
}

func TestUserPacks_RenameReorderDeleteItemAndPack(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, _, member := e.seedRoles(t)
	p := e.createUserPack(t, member, "Mine")
	a := e.uploadSticker(t, p.ID, member, pngBytes(t, 20, 20, false))
	b := e.uploadSticker(t, p.ID, member, pngBytes(t, 21, 21, false))
	c := e.uploadSticker(t, p.ID, member, pngBytes(t, 22, 22, false))

	resp := e.do(t, "PATCH", "/api/packs/"+p.ID, member, map[string]any{"name": "Renamed", "description": "Cute"})
	wantStatus(t, resp, http.StatusOK)
	var renamed packDTO
	readJSON(t, resp, &renamed)
	if renamed.Name != "Renamed" {
		t.Errorf("renamed = %+v", renamed)
	}
	// Admin-only switches are refused for a user pack.
	for _, body := range []map[string]any{{"enabled": false}, {"default": true}, {"order": 3}, {"name": ""}} {
		resp := e.do(t, "PATCH", "/api/packs/"+p.ID, member, body)
		wantStatus(t, resp, http.StatusBadRequest)
		resp.Body.Close()
	}

	resp = e.do(t, "PUT", "/api/packs/"+p.ID+"/order", member, map[string]any{"item_ids": []string{c.ID, a.ID, b.ID}})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var got packDTO
	readJSON(t, e.get(t, "/api/packs/"+p.ID, member, nil), &got)
	if got.Items[0].ID != c.ID || got.Items[2].ID != b.ID {
		t.Errorf("order after reorder: %v", []string{got.Items[0].ID, got.Items[1].ID, got.Items[2].ID})
	}
	for _, ids := range [][]string{{a.ID}, {a.ID, a.ID, b.ID}, {a.ID, b.ID, "zzz"}} {
		resp := e.do(t, "PUT", "/api/packs/"+p.ID+"/order", member, map[string]any{"item_ids": ids})
		wantStatus(t, resp, http.StatusBadRequest)
		resp.Body.Close()
	}

	// Deleting an item removes its image; deleting the pack removes the rest, from storage too.
	storedFiles := func() int {
		entries, _ := os.ReadDir(e.dataDir + "/uploads")
		return len(entries)
	}
	before := storedFiles()
	resp = e.do(t, "DELETE", "/api/packs/"+p.ID+"/items/"+a.ID, member, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if after := storedFiles(); after != before-1 {
		t.Errorf("stored files %d -> %d after deleting an item, want one fewer", before, after)
	}
	resp = e.get(t, a.URL, member, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/packs/"+p.ID, member, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if left := storedFiles(); left != before-3 {
		t.Errorf("stored files = %d after deleting the pack, want %d", left, before-3)
	}
	resp = e.get(t, "/api/packs/"+p.ID, member, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}

func TestUserPacks_ShareInstallUninstall(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, _, member := e.seedRoles(t)
	e.mustRegister(t, "friend")
	friend := e.login(t, "friend")
	p := e.createUserPack(t, member, "Shared")
	it := e.uploadSticker(t, p.ID, member, pngBytes(t, 20, 20, false))

	// A user pack is not in a stranger's list, but its id (the share link) opens it and its images.
	var list packList
	readJSON(t, e.get(t, "/api/packs", friend, nil), &list)
	for _, x := range list.Items {
		if x.ID == p.ID {
			t.Fatal("someone else's pack is in the list before installing")
		}
	}
	var detail packDTO
	readJSON(t, e.get(t, "/api/packs/"+p.ID, friend, nil), &detail)
	if detail.Installed || detail.Editable || len(detail.Items) != 1 {
		t.Fatalf("stranger's view = %+v", detail)
	}
	img := e.get(t, it.URL, friend, nil)
	wantStatus(t, img, http.StatusOK)
	img.Body.Close()

	resp := e.do(t, "PUT", "/api/packs/"+p.ID+"/install", friend, nil)
	wantStatus(t, resp, http.StatusOK)
	var inst packDTO
	readJSON(t, resp, &inst)
	if !inst.Installed {
		t.Error("install response is not marked installed")
	}
	resp = e.do(t, "PUT", "/api/packs/"+p.ID+"/install", friend, nil) // idempotent
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	readJSON(t, e.get(t, "/api/packs", friend, nil), &list)
	found := false
	for _, x := range list.Items {
		found = found || x.ID == p.ID
	}
	if !found {
		t.Fatal("installed pack is missing from the list")
	}

	resp = e.do(t, "DELETE", "/api/packs/"+p.ID+"/install", friend, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	readJSON(t, e.get(t, "/api/packs", friend, nil), &list)
	for _, x := range list.Items {
		if x.ID == p.ID {
			t.Fatal("pack still listed after uninstall")
		}
	}

	// Not installable: built-in packs, unknown ids; the owner cannot "uninstall" their own pack.
	resp = e.do(t, "PUT", "/api/packs/cove-basics/install", friend, nil)
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	resp = e.do(t, "PUT", "/api/packs/nope/install", friend, nil)
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")
	resp = e.do(t, "DELETE", "/api/packs/"+p.ID+"/install", member, nil)
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
}

func TestUserPacks_DeletingTheAccountRemovesThePacks(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	e.seedRoles(t)
	e.mustRegister(t, "leaver")
	leaver := e.login(t, "leaver")
	p := e.createUserPack(t, leaver, "Going away")
	e.uploadSticker(t, p.ID, leaver, pngBytes(t, 20, 20, false))
	before, _ := os.ReadDir(e.dataDir + "/uploads")

	resp := e.do(t, "DELETE", "/api/users/me", leaver, map[string]string{"password": testPassword})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	if _, err := e.store.GetPack(p.ID); err == nil {
		t.Error("the pack survived the account")
	}
	after, _ := os.ReadDir(e.dataDir + "/uploads")
	if len(after) != len(before)-1 {
		t.Errorf("stored files %d -> %d, want one fewer", len(before), len(after))
	}
}

// ---- admin: server packs, moderation, custom emoji ---------------------------------------------------------------- //

func TestAdminPacks_ServerPackLifecycleAndDefault(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, admin, member := e.seedRoles(t)

	resp := e.do(t, "POST", "/api/admin/packs", admin, map[string]string{"name": ""})
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	resp = e.do(t, "POST", "/api/admin/packs", admin, map[string]string{"name": "Office"})
	wantStatus(t, resp, http.StatusCreated)
	var p packDTO
	readJSON(t, resp, &p)
	if p.Scope != "server" || !p.Enabled || !p.Editable {
		t.Fatalf("server pack = %+v", p)
	}

	// Server packs ignore the user quotas and show up for every user once they hold stickers.
	resp = e.upload(t, "/api/admin/packs/"+p.ID+"/items", admin, map[string]string{"emoji": "🏢"}, "a.png", pngBytes(t, 40, 40, false))
	wantStatus(t, resp, http.StatusCreated)
	var up struct{ Item itemDTO }
	readJSON(t, resp, &up)
	if up.Item.ID == "" {
		t.Fatal("no item")
	}
	var list packList
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	var seen *packDTO
	for i := range list.Items {
		if list.Items[i].ID == p.ID {
			seen = &list.Items[i]
		}
	}
	if seen == nil || !seen.Installed || seen.Editable || seen.ItemCount != 1 {
		t.Fatalf("member's view of the server pack = %+v", seen)
	}

	resp = e.do(t, "PATCH", "/api/admin/packs/"+p.ID, admin, map[string]any{"name": "HQ", "default": true, "order": 5})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	if list.DefaultPackID != p.ID || list.Items[0].ID != p.ID || list.Items[0].Name != "HQ" {
		t.Fatalf("default = %q, first = %+v", list.DefaultPackID, list.Items[0])
	}
	// Making a built-in pack the default moves the flag (never two defaults).
	resp = e.do(t, "PATCH", "/api/admin/packs/cove-moves", admin, map[string]any{"default": true})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	readJSON(t, e.get(t, "/api/packs", member, nil), &list)
	defaults := 0
	for _, x := range list.Items {
		if x.Default {
			defaults++
		}
	}
	if defaults != 1 || list.DefaultPackID != "cove-moves" {
		t.Errorf("%d defaults, default_pack_id=%q", defaults, list.DefaultPackID)
	}

	// Disabled: gone from members' pickers and details; the stickers are kept.
	resp = e.do(t, "PATCH", "/api/admin/packs/"+p.ID, admin, map[string]any{"enabled": false})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = e.get(t, "/api/packs/"+p.ID, member, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()

	// Admin removal is audited and cleans up the images.
	resp = e.do(t, "DELETE", "/api/admin/packs/"+p.ID, admin, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if _, err := e.store.GetPack(p.ID); err == nil {
		t.Error("server pack not deleted")
	}
	resp = e.do(t, "DELETE", "/api/admin/packs/"+p.ID, admin, nil)
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")
}

func TestAdminPacks_ListAndModerateUserPacks(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, admin, member := e.seedRoles(t)
	p := e.createUserPack(t, member, "Questionable")
	e.uploadSticker(t, p.ID, member, pngBytes(t, 20, 20, false))
	before, _ := os.ReadDir(e.dataDir + "/uploads")

	var all struct{ Items []packDTO }
	readJSON(t, e.do(t, "GET", "/api/admin/packs", admin, nil), &all)
	var theirs *packDTO
	scopes := map[string]int{}
	for i := range all.Items {
		scopes[all.Items[i].Scope]++
		if all.Items[i].ID == p.ID {
			theirs = &all.Items[i]
		}
	}
	if theirs == nil || theirs.OwnerID == "" || scopes["builtin"] < 2 {
		t.Fatalf("admin list: theirs=%+v scopes=%v", theirs, scopes)
	}

	// Moderation may rename a user pack but not flip server-only switches.
	resp := e.do(t, "PATCH", "/api/admin/packs/"+p.ID, admin, map[string]any{"name": "Renamed by admin"})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = e.do(t, "PATCH", "/api/admin/packs/"+p.ID, admin, map[string]any{"default": true})
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()

	resp = e.do(t, "DELETE", "/api/admin/packs/"+p.ID, admin, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	after, _ := os.ReadDir(e.dataDir + "/uploads")
	if len(after) != len(before)-1 {
		t.Errorf("stored files %d -> %d, want one fewer", len(before), len(after))
	}

	var audit struct {
		Items []struct{ Action, Target string } `json:"items"`
	}
	readJSON(t, e.do(t, "GET", "/api/admin/audit", admin, nil), &audit)
	var deleted bool
	for _, a := range audit.Items {
		if a.Action == "pack.delete" && strings.Contains(a.Target, p.ID) {
			deleted = true
		}
	}
	if !deleted {
		t.Errorf("no pack.delete entry in the audit log: %+v", audit.Items)
	}
}

func TestAdminPacks_AdminCanAddToAndReorderServerPack(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, admin, _ := e.seedRoles(t)
	resp := e.do(t, "POST", "/api/admin/packs", admin, map[string]string{"name": "Order"})
	var p packDTO
	readJSON(t, resp, &p)
	ids := []string{}
	for i := 0; i < 3; i++ {
		resp := e.upload(t, "/api/admin/packs/"+p.ID+"/items", admin, nil, "a.png", pngBytes(t, 20+i, 20, false))
		wantStatus(t, resp, http.StatusCreated)
		var up struct{ Item itemDTO }
		readJSON(t, resp, &up)
		ids = append(ids, up.Item.ID)
	}
	resp = e.do(t, "PUT", "/api/admin/packs/"+p.ID+"/order", admin, map[string]any{"item_ids": []string{ids[2], ids[1], ids[0]}})
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = e.do(t, "PUT", "/api/admin/packs/"+p.ID+"/order", admin, map[string]any{"item_ids": []string{ids[0]}})
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	var got packDTO
	readJSON(t, e.get(t, "/api/packs/"+p.ID, admin, nil), &got)
	if got.Items[0].ID != ids[2] {
		t.Errorf("order not applied: %v", got.Items)
	}
	resp = e.do(t, "DELETE", "/api/admin/packs/"+p.ID+"/items/"+ids[0], admin, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/admin/packs/"+p.ID+"/items/"+ids[0], admin, nil)
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")
}

func TestCustomEmoji_AdminManagesTheSet(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.noFFmpeg()
	_, admin, member := e.seedRoles(t)

	var empty struct {
		Version string            `json:"version"`
		Items   []json.RawMessage `json:"items"`
	}
	readJSON(t, e.get(t, "/api/emoji/custom", member, nil), &empty)
	if len(empty.Items) != 0 {
		t.Fatalf("custom emoji before adding any: %d", len(empty.Items))
	}

	// Members cannot add; admins can, with validated names and images.
	resp := e.upload(t, "/api/admin/emoji", member, map[string]string{"name": "parrot"}, "p.png", pngBytes(t, 32, 32, false))
	wantStatus(t, resp, http.StatusForbidden)
	resp.Body.Close()
	for _, name := range []string{"", "a", "Has Space", "bad-name", strings.Repeat("x", 33), "emoji!"} {
		resp := e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": name}, "p.png", pngBytes(t, 32, 32, false))
		wantStatus(t, resp, http.StatusBadRequest)
		resp.Body.Close()
	}
	resp = e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": "parrot"}, "p.svg", []byte(svgDoc))
	wantCode(t, resp, http.StatusBadRequest, "image_invalid")
	resp = e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": "parrot"}, "p.png", pngBytes(t, 200, 200, false))
	wantCode(t, resp, http.StatusBadRequest, "image_invalid") // strict mode: over 128 px
	resp = e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": "parrot"}, "p.png", pngBytes(t, 32, 32, false))
	wantStatus(t, resp, http.StatusCreated)
	resp.Body.Close()
	resp = e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": ":Wave:"}, "w.gif", gifBytes(t, 24, 24, 3)) // colons and case are normalised
	wantStatus(t, resp, http.StatusCreated)
	resp.Body.Close()

	// Names are unique across the server.
	resp = e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": "parrot"}, "p2.png", pngBytes(t, 33, 33, false))
	wantCode(t, resp, http.StatusConflict, "emoji_name_taken")

	var list struct {
		Version string `json:"version"`
		Items   []struct {
			Name     string `json:"name"`
			URL      string `json:"url"`
			Animated bool   `json:"animated"`
		} `json:"items"`
	}
	l := e.get(t, "/api/emoji/custom", member, nil)
	tag := l.Header.Get("ETag")
	readJSON(t, l, &list)
	if len(list.Items) != 2 || list.Items[0].Name != "parrot" || list.Items[1].Name != "wave" || !list.Items[1].Animated || list.Version == empty.Version {
		t.Fatalf("custom emoji = %+v", list)
	}
	not := e.get(t, "/api/emoji/custom", member, map[string]string{"If-None-Match": tag})
	wantStatus(t, not, http.StatusNotModified)
	not.Body.Close()
	img := e.get(t, list.Items[0].URL, member, nil)
	wantStatus(t, img, http.StatusOK)
	img.Body.Close()

	resp = e.do(t, "DELETE", "/api/admin/emoji/parrot", member, nil)
	wantStatus(t, resp, http.StatusForbidden)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/admin/emoji/parrot", admin, nil)
	wantStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/admin/emoji/parrot", admin, nil)
	wantCode(t, resp, http.StatusNotFound, "pack_not_found")
	// The name is free again, and the custom emoji pack itself cannot be deleted or renamed.
	resp = e.upload(t, "/api/admin/emoji", admin, map[string]string{"name": "parrot"}, "p.png", pngBytes(t, 34, 34, false))
	wantStatus(t, resp, http.StatusCreated)
	resp.Body.Close()
	resp = e.do(t, "DELETE", "/api/admin/packs/custom-emoji", admin, nil)
	wantStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
}
