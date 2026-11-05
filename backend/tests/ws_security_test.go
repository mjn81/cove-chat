package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/models"
	"cove/backend/internal/store"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// ---- helpers ------------------------------------------------------------- //

func wsDial(t *testing.T, ctx context.Context, srv *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	return c
}

func wsSend(t *testing.T, ctx context.Context, c *websocket.Conn, typ string, payload any) {
	t.Helper()
	b, _ := json.Marshal(payload)
	if err := wsjson.Write(ctx, c, &models.WSMessage{Type: typ, Payload: b}); err != nil {
		t.Fatalf("ws write %s: %v", typ, err)
	}
}

// wsSync sends a ping and returns every frame received up to the pong. Frames of one connection are handled in
// order, so once the pong arrives everything sent before it has been processed.
func wsSync(t *testing.T, ctx context.Context, c *websocket.Conn) []models.WSMessage {
	t.Helper()
	wsSend(t, ctx, c, "ping", map[string]any{})
	var seen []models.WSMessage
	for {
		var m models.WSMessage
		if err := wsjson.Read(ctx, c, &m); err != nil {
			t.Fatalf("ws read while syncing: %v", err)
		}
		if m.Type == "pong" {
			return seen
		}
		seen = append(seen, m)
	}
}

func hasType(msgs []models.WSMessage, typ string) bool {
	for _, m := range msgs {
		if m.Type == typ {
			return true
		}
	}
	return false
}

func befriend(t *testing.T, st *store.Store, a, b string) {
	t.Helper()
	if err := st.SendFriendRequest(a, b); err != nil {
		t.Fatalf("friend request: %v", err)
	}
	if err := st.AcceptFriendRequest(b, a); err != nil {
		t.Fatalf("friend accept: %v", err)
	}
}

func createGroupChannel(t *testing.T, srv *httptest.Server, token, name string, members ...string) string {
	t.Helper()
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", token,
		jsonBody(t, api.CreateChannelRequest{Name: name, Members: members})))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create channel status = %d", resp.StatusCode)
	}
	var ch map[string]any
	decodeJSON(t, resp, &ch)
	return ch["id"].(string)
}

// ---- #1 read receipt must not create memberships ------------------------- //

func TestWS_ReadReceipt_DoesNotJoinChannel(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	tokA := registerAndLogin(t, srv, "rr_alice", "Password123!")
	tokE := registerAndLogin(t, srv, "rr_eve", "Password123!")
	eve := getUser(t, srv, tokE)
	chID := createGroupChannel(t, srv, tokA, "private-ish")

	conn := wsDial(t, ctx, srv, tokE)
	wsSend(t, ctx, conn, "read_receipt", map[string]any{"channel_id": chID})
	wsSync(t, ctx, conn)

	if uc, err := st.GetUserChannel(eve.ID, chID); err == nil {
		t.Fatalf("read receipt created a membership: %+v", uc)
	}
	chans := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokE, nil))
	list := decodeItems[map[string]any](t, chans)
	if len(list) != 0 {
		t.Fatalf("eve sees %d channels, want 0", len(list))
	}
}

func TestStore_UpdateChannelRead_RequiresActiveMembership(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	tokA := registerAndLogin(t, srv, "ur_alice", "Password123!")
	alice := getUser(t, srv, tokA)
	chID := createGroupChannel(t, srv, tokA, "g")

	if err := st.UpdateChannelRead(alice.ID, chID); err != nil {
		t.Fatalf("active member should be able to mark read: %v", err)
	}
	if err := st.UpdateChannelRead("ghost-user", chID); err == nil {
		t.Fatal("non-member must not be able to mark read")
	}
	if err := st.RemoveMemberFromChannel(chID, alice.ID, models.StatusLeft); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := st.UpdateChannelRead(alice.ID, chID); err == nil {
		t.Fatal("a member who left must not be able to mark read")
	}
	if uc, _ := st.GetUserChannel(alice.ID, chID); uc != nil && uc.Status == models.StatusActive {
		t.Fatal("read path re-activated a left membership")
	}
}

// ---- #2 / #3 whisper session ownership ----------------------------------- //

func TestWS_WhisperRejectAndClose_OnlyParticipants(t *testing.T) {
	srv, st, hub, cleanup := setupWhisperTestServerHub(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	tokA := registerAndLogin(t, srv, "wr_alice", "Password123!")
	tokB := registerAndLogin(t, srv, "wr_bob", "Password123!")
	tokE := registerAndLogin(t, srv, "wr_eve", "Password123!")
	alice, bob := getUser(t, srv, tokA), getUser(t, srv, tokB)
	befriend(t, st, alice.ID, bob.ID)

	ca, cb, ce := wsDial(t, ctx, srv, tokA), wsDial(t, ctx, srv, tokB), wsDial(t, ctx, srv, tokE)
	wsSync(t, ctx, cb) // flush hello etc.

	wsSend(t, ctx, ca, "whisper_init", map[string]any{"session_id": "s1", "target_user_id": bob.ID, "pub_key": "k"})
	wsSync(t, ctx, ca)
	wsSync(t, ctx, cb)

	for _, typ := range []string{"whisper_reject", "whisper_close"} {
		wsSend(t, ctx, ce, typ, map[string]any{"session_id": "s1", "reason": "x"})
		got := wsSync(t, ctx, ce)
		if hasType(got, "whisper_error") {
			t.Fatalf("%s by a stranger must be silently ignored, got an error (oracle)", typ)
		}
		if _, ok := hub.GetWhisperSession("s1"); !ok {
			t.Fatalf("%s by a stranger removed the session", typ)
		}
		if hasType(wsSync(t, ctx, ca), typ) || hasType(wsSync(t, ctx, cb), typ) {
			t.Fatalf("%s by a stranger was relayed to the participants", typ)
		}
	}

	wsSend(t, ctx, cb, "whisper_reject", map[string]any{"session_id": "s1"})
	wsSync(t, ctx, cb)
	if _, ok := hub.GetWhisperSession("s1"); ok {
		t.Fatal("the target should still be able to reject")
	}
}

func TestWS_WhisperInit_DuplicateIDAndPendingCap(t *testing.T) {
	srv, st, hub, cleanup := setupWhisperTestServerHub(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tokA := registerAndLogin(t, srv, "wd_alice", "Password123!")
	tokB := registerAndLogin(t, srv, "wd_bob", "Password123!")
	tokE := registerAndLogin(t, srv, "wd_eve", "Password123!")
	alice, bob, eve := getUser(t, srv, tokA), getUser(t, srv, tokB), getUser(t, srv, tokE)
	befriend(t, st, alice.ID, bob.ID)
	befriend(t, st, eve.ID, bob.ID)

	ca, ce := wsDial(t, ctx, srv, tokA), wsDial(t, ctx, srv, tokE)
	wsDial(t, ctx, srv, tokB)

	wsSend(t, ctx, ca, "whisper_init", map[string]any{"session_id": "dup", "target_user_id": bob.ID, "pub_key": "alice-key"})
	wsSync(t, ctx, ca)

	// Eve (also Bob's friend) tries to overwrite Alice's pending session id.
	wsSend(t, ctx, ce, "whisper_init", map[string]any{"session_id": "dup", "target_user_id": bob.ID, "pub_key": "eve-key"})
	if !hasType(wsSync(t, ctx, ce), "whisper_error") {
		t.Fatal("re-using an existing session id must be rejected with whisper_error")
	}
	sess, ok := hub.GetWhisperSession("dup")
	if !ok || sess.InitiatorID != alice.ID || sess.PubKey != "alice-key" {
		t.Fatalf("session was hijacked: %+v", sess)
	}

	// Alice cannot pile up unlimited pending sessions.
	rejected := false
	for i := 0; i < 30; i++ {
		wsSend(t, ctx, ca, "whisper_init", map[string]any{
			"session_id": fmt.Sprintf("cap-%d", i), "target_user_id": bob.ID, "pub_key": "k",
		})
		if hasType(wsSync(t, ctx, ca), "whisper_error") {
			rejected = true
			break
		}
	}
	if !rejected {
		t.Fatal("pending whisper sessions per user are not capped")
	}
}

// ---- #4 edit/delete need an active membership ---------------------------- //

func TestWS_EditDelete_RequireActiveMembership(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	tokA := registerAndLogin(t, srv, "ed_alice", "Password123!")
	tokB := registerAndLogin(t, srv, "ed_bob", "Password123!")
	alice, bob := getUser(t, srv, tokA), getUser(t, srv, tokB)
	befriend(t, st, alice.ID, bob.ID)
	chID := createGroupChannel(t, srv, tokA, "g", bob.ID)

	ca, cb := wsDial(t, ctx, srv, tokA), wsDial(t, ctx, srv, tokB)
	wsSync(t, ctx, ca)

	mk := func(body string) string {
		m := &models.Message{ID: "m-" + body, ChannelID: chID, SenderID: bob.ID, Type: models.MessageTypeText,
			Ciphertext: []byte("c"), Nonce: []byte("n"), Compression: "none", SentAt: time.Now().UTC()}
		if err := st.SaveMessage(m); err != nil {
			t.Fatalf("save: %v", err)
		}
		return m.ID
	}
	editID, delID := mk("edit"), mk("del")

	if err := st.RemoveMemberFromChannel(chID, bob.ID, models.StatusKicked); err != nil {
		t.Fatalf("kick: %v", err)
	}

	wsSend(t, ctx, cb, "message_edit", map[string]any{"channel_id": chID, "message_id": editID, "ciphertext": []byte("x"), "nonce": []byte("y")})
	wsSend(t, ctx, cb, "message_delete", map[string]any{"channel_id": chID, "message_id": delID})
	wsSync(t, ctx, cb)
	got := wsSync(t, ctx, ca)
	if hasType(got, "message_update") || hasType(got, "message_delete") {
		t.Fatal("a kicked member's edit/delete was broadcast to the channel")
	}
	if m, err := st.GetMessage(chID, delID); err != nil || m == nil {
		t.Fatal("a kicked member deleted a message")
	}
	if m, _ := st.GetMessage(chID, editID); m == nil || string(m.Ciphertext) != "c" {
		t.Fatal("a kicked member edited a message")
	}
}

// ---- #14 ping keeps the user's status preference, events are rate limited - //

func TestWS_Ping_DoesNotOverrideStatusPreference(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	tok := registerAndLogin(t, srv, "ps_user", "Password123!")
	u := getUser(t, srv, tok)
	full, err := st.GetUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	full.StatusPreference = "dnd"
	if err := st.UpdateUser(full); err != nil {
		t.Fatal(err)
	}

	c := wsDial(t, ctx, srv, tok)
	wsSync(t, ctx, c)
	wsSync(t, ctx, c)
	p, err := st.GetPresence(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.CurrentStatus != "dnd" {
		t.Fatalf("presence after ping = %q, want dnd", p.CurrentStatus)
	}
}

func TestWS_ClientEventsAreRateLimited(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tok := registerAndLogin(t, srv, "rl_user", "Password123!")
	u := getUser(t, srv, tok)
	chID := createGroupChannel(t, srv, tok, "g")
	c := wsDial(t, ctx, srv, tok)
	wsSync(t, ctx, c)

	const n = 400
	for i := 0; i < n; i++ {
		wsSend(t, ctx, c, "message", map[string]any{"channel_id": chID, "ciphertext": []byte("c"), "nonce": []byte("n")})
	}
	time.Sleep(1500 * time.Millisecond) // let the bucket refill so the sync ping is not itself throttled
	wsSync(t, ctx, c)
	msgs, err := st.ListMessages(chID, "", 1000)
	if err != nil {
		t.Fatal(err)
	}
	_ = u
	if len(msgs) == 0 || len(msgs) >= n {
		t.Fatalf("stored %d of %d burst messages; expected the limiter to drop most but not all", len(msgs), n)
	}
}
