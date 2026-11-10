package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/api"
)

// Regression tests for the findings of the 2026-11 security review (docs/security-review-2026-11.md).

func jsonReq(t *testing.T, method, url, token string, v any) *http.Response {
	t.Helper()
	return mustDo(t, newJSONReq(t, method, url, token, jsonBody(t, v)))
}

// SR-01: deleting an account must end every session of that account, not only the one that asked.
func TestSecurityReview_DeleteAccountRevokesEverySession(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	registerAndLogin(t, srv, "founder", testPassword)
	registerAndLogin(t, srv, "victim", testPassword)
	// A second device of the same account.
	resp := jsonReq(t, http.MethodPost, srv.URL+"/api/login", "", api.LoginRequest{Username: "victim", Password: testPassword})
	var second api.LoginResponse
	decodeJSON(t, resp, &second)

	first := registerAndLogin(t, srv, "victim", testPassword) // logs in again (register is a no-op 409)
	del := jsonReq(t, http.MethodDelete, srv.URL+"/api/users/me", first, api.DeleteAccountRequest{Password: testPassword})
	if del.StatusCode != http.StatusOK {
		t.Fatalf("delete = %d", del.StatusCode)
	}
	me := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", second.Token, nil))
	if me.StatusCode != http.StatusUnauthorized {
		t.Fatalf("another device of a deleted account still has a live session: /api/me = %d, want 401", me.StatusCode)
	}
}

// SR-02: signing out must also close the session's live WebSocket.
func TestSecurityReview_LogoutClosesTheLiveSocket(t *testing.T) {
	srv, _, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	tok := registerAndLogin(t, srv, "sockuser", testPassword)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c := wsDial(t, ctx, srv, tok)
	wsSync(t, ctx, c)

	out := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/logout", tok, nil))
	if out.StatusCode != http.StatusOK {
		t.Fatalf("logout = %d", out.StatusCode)
	}
	readCtx, readCancel := context.WithTimeout(ctx, 2*time.Second)
	defer readCancel()
	for {
		var m json.RawMessage
		if _, data, err := c.Read(readCtx); err != nil {
			if readCtx.Err() != nil {
				t.Fatal("the WebSocket of a signed-out session is still open")
			}
			return // closed by the server
		} else {
			m = data
			_ = m
		}
	}
}

// SR-03: usernames cannot be blank, huge, carry control/bidi characters, or differ from an existing one only by case.
func TestSecurityReview_UsernameRules(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	registerAndLogin(t, srv, "Founder", testPassword)
	cases := map[string]int{
		"   ":                    http.StatusBadRequest,
		strings.Repeat("a", 200): http.StatusBadRequest,
		"adm‮in":                 http.StatusBadRequest, // right-to-left override
		"bob​":                   http.StatusBadRequest, // zero-width space
		"line\nbreak":            http.StatusBadRequest,
		" padded ":               http.StatusBadRequest,
		"founder":                http.StatusConflict, // differs from "Founder" only by case
		"ماهان":                  http.StatusCreated,  // a real Persian name is fine
		"alice_01":               http.StatusCreated,
	}
	for name, want := range cases {
		r := jsonReq(t, http.MethodPost, srv.URL+"/api/register", "", api.RegisterRequest{Username: name, Password: testPassword})
		r.Body.Close()
		if r.StatusCode != want {
			t.Errorf("register %q = %d, want %d", name, r.StatusCode, want)
		}
	}
}

// SR-04: free-text profile fields are bounded.
func TestSecurityReview_ProfileTextIsBounded(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	tok := registerAndLogin(t, srv, "bio_user", testPassword)
	huge := strings.Repeat("x", 100_000)
	for _, body := range []map[string]any{{"custom_msg": huge}, {"banner_color": huge}} {
		r := jsonReq(t, http.MethodPatch, srv.URL+"/api/users/me", tok, body)
		r.Body.Close()
		if r.StatusCode != http.StatusBadRequest {
			t.Errorf("oversized profile field %v = %d, want 400", firstKey(body), r.StatusCode)
		}
	}
}

func firstKey(m map[string]any) string {
	for k := range m {
		return k
	}
	return ""
}

// SR-05: a chat message ciphertext has a size cap, so one member cannot fill the database with 20 MB frames.
func TestSecurityReview_OversizedMessageIsNotStored(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	tok := registerAndLogin(t, srv, "chatty", testPassword)
	chID := createGroupChannel(t, srv, tok, "big")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := wsDial(t, ctx, srv, tok)
	wsSync(t, ctx, c)
	wsSend(t, ctx, c, "message", map[string]any{
		"channel_id": chID, "type": "text", "nonce": make([]byte, 12), "ciphertext": make([]byte, 3<<20),
	})
	wsSync(t, ctx, c)
	msgs, err := st.ListMessages(chID, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 0 {
		t.Fatalf("a %d byte ciphertext was stored", len(msgs[0].Ciphertext))
	}
}

// SR-06: bytes that are not a real video must never reach ffmpeg, whatever the uploader claims with is_video.
// (A text playlist makes ffmpeg read local files or fetch URLs.)
func TestSecurityReview_NonVideoIsNeverTranscoded(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	tok := registerAndLogin(t, srv, "vid_user", testPassword)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("is_video", "true")
	fw, _ := mw.CreateFormFile("file", "clip.mp4")
	_, _ = fw.Write([]byte("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n"))
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/files", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+tok)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload = %d", resp.StatusCode)
	}
	var f api.UploadFileResponse
	decodeJSON(t, resp, &f)
	if f.ProcessingStatus == "processing" {
		t.Fatal("a text playlist labelled as video was queued for ffmpeg")
	}
}

// SR-07: repeated wrong passwords for one account are throttled even when they come from many addresses.
func TestSecurityReview_LoginFailuresForOneAccountAreThrottled(t *testing.T) {
	srv := testServerWithLimits(t, 100000, 100000, nil)
	defer srv.Close()
	registerAndLogin(t, srv, "target", testPassword)
	var last int
	for i := 0; i < 30; i++ {
		r := jsonReq(t, http.MethodPost, srv.URL+"/api/login", "", api.LoginRequest{Username: "target", Password: "wrong-password"})
		r.Body.Close()
		last = r.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("30 wrong passwords in a row ended with %d, want 429", last)
	}
}
