package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// restUpload posts one image to a pack-items endpoint of a plain test server and returns the stored item.
func restUpload(t *testing.T, srv *httptest.Server, token, path string, data []byte) (id, fileID string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "s.png")
	_, _ = fw.Write(data)
	_ = mw.WriteField("emoji", "😀")
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload %s = %d", path, resp.StatusCode)
	}
	var out struct {
		Item struct {
			ID     string `json:"id"`
			FileID string `json:"file_id"`
		} `json:"item"`
	}
	decodeJSON(t, resp, &out)
	return out.Item.ID, out.Item.FileID
}

func restJSON(t *testing.T, srv *httptest.Server, method, path, token string, body any, out any) int {
	t.Helper()
	var buf *bytes.Buffer
	if body != nil {
		buf = jsonBody(t, body)
	}
	resp := mustDo(t, newJSONReq(t, method, srv.URL+path, token, buf))
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

// sendSticker seals a sticker body for the channel, sends it and reports whether it was stored and any rejection.
func sendSticker(t *testing.T, ctx context.Context, conn *wsConn, st *store.Store, chID string, body any, compression string) (stored bool, rejection map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	nonce, ct := sealForChannel(t, st, chID, string(raw))
	payload := map[string]any{"channel_id": chID, "type": "sticker", "ciphertext": ct, "nonce": nonce}
	if compression != "" {
		payload["compression"] = compression
	}
	sendWS(t, ctx, conn.Conn, "message", payload)
	rejection = waitForWSEvent(conn, "message_error", 700*time.Millisecond)
	return waitForMessage(t, st, chID, ct) != nil, rejection
}


func TestStickerMessage_ValidationAndAccess(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	owner := registerAndLogin(t, srv, "stk_owner", "Password123!") // first account on the server: owner
	alice := registerAndLogin(t, srv, "stk_alice", "Password123!")
	chID := newNamedChannel(t, srv.URL, alice, "Stickers", true)
	conn := dialWS(t, ctx, srv.URL, alice)
	defer conn.Close(1000, "")

	var basics struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	restJSON(t, srv, "GET", "/api/packs/cove-basics", alice, nil, &basics)
	basicID := basics.Items[0].ID

	// Built-in pack: valid with or without file_id, rejected for a sticker that is not in the pack.
	stored, rej := sendSticker(t, ctx, conn, st, chID, map[string]string{"pack_id": "cove-basics", "sticker_id": basicID}, "")
	if !stored || rej != nil {
		t.Fatalf("built-in sticker: stored=%v rejection=%v", stored, rej)
	}
	if stored, _ := sendSticker(t, ctx, conn, st, chID, map[string]string{"pack_id": "cove-basics", "sticker_id": basicID, "file_id": basicID}, ""); !stored {
		t.Error("built-in sticker with file_id = sticker_id was refused")
	}
	for name, body := range map[string]any{
		"unknown sticker":     map[string]string{"pack_id": "cove-basics", "sticker_id": "nope"},
		"unknown pack":        map[string]string{"pack_id": "nope", "sticker_id": basicID},
		"wrong file id":       map[string]string{"pack_id": "cove-basics", "sticker_id": basicID, "file_id": "other"},
		"missing sticker":     map[string]string{"pack_id": "cove-basics"},
		"missing pack":        map[string]string{"sticker_id": basicID},
		"empty":               map[string]string{},
		"overlong id":         map[string]string{"pack_id": string(bytes.Repeat([]byte("a"), 300)), "sticker_id": "x"},
		"not an object":       []string{"cove-basics"},
	} {
		stored, rej := sendSticker(t, ctx, conn, st, chID, body, "")
		if stored || rej == nil || rej["code"] != "sticker_invalid" {
			t.Errorf("%s: stored=%v rejection=%v, want a sticker_invalid rejection", name, stored, rej)
		}
	}
	if stored, rej := sendSticker(t, ctx, conn, st, chID, map[string]string{"pack_id": "cove-basics", "sticker_id": basicID}, "zstd"); stored || rej == nil {
		t.Errorf("compressed sticker: stored=%v rejection=%v", stored, rej)
	}

	// User pack: needs the stored image of that very sticker.
	var mine, theirs struct {
		ID string `json:"id"`
	}
	restJSON(t, srv, "POST", "/api/packs", alice, map[string]string{"name": "Mine"}, &mine)
	restJSON(t, srv, "POST", "/api/packs", alice, map[string]string{"name": "Other"}, &theirs)
	itemA, fileA := restUpload(t, srv, alice, "/api/packs/"+mine.ID+"/items", pngBytes(t, 40, 40, false))
	_, fileB := restUpload(t, srv, alice, "/api/packs/"+theirs.ID+"/items", pngBytes(t, 41, 41, false))

	if stored, rej := sendSticker(t, ctx, conn, st, chID, map[string]string{"pack_id": mine.ID, "sticker_id": itemA, "file_id": fileA}, ""); !stored || rej != nil {
		t.Fatalf("user sticker: stored=%v rejection=%v", stored, rej)
	}
	for name, body := range map[string]any{
		"file of another pack": map[string]string{"pack_id": mine.ID, "sticker_id": itemA, "file_id": fileB},
		"missing file id":      map[string]string{"pack_id": mine.ID, "sticker_id": itemA},
		"sticker of another":   map[string]string{"pack_id": theirs.ID, "sticker_id": itemA, "file_id": fileA},
	} {
		stored, rej := sendSticker(t, ctx, conn, st, chID, body, "")
		if stored || rej == nil || rej["code"] != "sticker_invalid" {
			t.Errorf("%s: stored=%v rejection=%v", name, stored, rej)
		}
	}

	// A disabled server pack cannot be used any more, a disabled built-in pack neither.
	var server struct {
		ID string `json:"id"`
	}
	restJSON(t, srv, "POST", "/api/admin/packs", owner, map[string]string{"name": "Office"}, &server)
	itemS, fileS := restUpload(t, srv, owner, "/api/admin/packs/"+server.ID+"/items", pngBytes(t, 42, 42, false))
	body := map[string]string{"pack_id": server.ID, "sticker_id": itemS, "file_id": fileS}
	if stored, rej := sendSticker(t, ctx, conn, st, chID, body, ""); !stored || rej != nil {
		t.Fatalf("server sticker: stored=%v rejection=%v", stored, rej)
	}
	restJSON(t, srv, "PATCH", "/api/admin/packs/"+server.ID, owner, map[string]any{"enabled": false}, nil)
	if stored, rej := sendSticker(t, ctx, conn, st, chID, body, ""); stored || rej == nil {
		t.Errorf("disabled server pack: stored=%v rejection=%v", stored, rej)
	}
	restJSON(t, srv, "PATCH", "/api/admin/packs/cove-basics", owner, map[string]any{"enabled": false}, nil)
	if stored, rej := sendSticker(t, ctx, conn, st, chID, map[string]string{"pack_id": "cove-basics", "sticker_id": basicID}, ""); stored || rej == nil {
		t.Errorf("disabled built-in pack: stored=%v rejection=%v", stored, rej)
	}

	// A deleted pack's stickers are refused.
	restJSON(t, srv, "DELETE", "/api/packs/"+mine.ID, alice, nil, nil)
	if stored, rej := sendSticker(t, ctx, conn, st, chID, map[string]string{"pack_id": mine.ID, "sticker_id": itemA, "file_id": fileA}, ""); stored || rej == nil {
		t.Errorf("deleted pack: stored=%v rejection=%v", stored, rej)
	}
}

func TestStickerMessage_RequiresMembershipAndCannotBeEdited(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_ = registerAndLogin(t, srv, "stk2_owner", "Password123!")
	alice := registerAndLogin(t, srv, "stk2_alice", "Password123!")
	eve := registerAndLogin(t, srv, "stk2_eve", "Password123!")
	chID := newNamedChannel(t, srv.URL, alice, "Private", true)
	var basics struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	restJSON(t, srv, "GET", "/api/packs/cove-basics", alice, nil, &basics)
	body := map[string]string{"pack_id": "cove-basics", "sticker_id": basics.Items[0].ID}

	// Eve is not a member of the channel: the same membership rule as for any other message applies.
	eveConn := dialWS(t, ctx, srv.URL, eve)
	defer eveConn.Close(1000, "")
	if stored, _ := sendSticker(t, ctx, eveConn, st, chID, body, ""); stored {
		t.Error("a non-member could send a sticker into the channel")
	}

	conn := dialWS(t, ctx, srv.URL, alice)
	defer conn.Close(1000, "")
	raw, _ := json.Marshal(body)
	nonce, ct := sealForChannel(t, st, chID, string(raw))
	sendWS(t, ctx, conn.Conn, "message", map[string]any{"channel_id": chID, "type": "sticker", "ciphertext": ct, "nonce": nonce})
	msg := waitForMessage(t, st, chID, ct)
	if msg == nil || msg.Type != models.MessageTypeSticker {
		t.Fatalf("sticker message = %+v", msg)
	}

	sendWS(t, ctx, conn.Conn, "message_edit", map[string]any{"channel_id": chID, "message_id": msg.ID, "ciphertext": []byte("tampered"), "nonce": []byte("n")})
	marker := []byte("after-edit")
	sendWS(t, ctx, conn.Conn, "message", map[string]any{"channel_id": chID, "type": "text", "ciphertext": marker, "nonce": []byte("n")})
	if waitForMessage(t, st, chID, marker) == nil {
		t.Fatal("follow-up message was not stored")
	}
	got, _ := st.GetMessage(chID, msg.ID)
	if !bytes.Equal(got.Ciphertext, ct) || got.EditedAt != nil {
		t.Error("a sticker message must not be editable")
	}
}

func TestMessageType_StickerIsValid(t *testing.T) {
	if !models.MessageTypeSticker.Valid() || models.MessageTypeSticker != "sticker" {
		t.Fatal("sticker must be a valid message type")
	}
}
