package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/models"
	"cove/backend/internal/store"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// sendWS writes one client frame, failing the test on error.
func sendWS(t *testing.T, ctx context.Context, conn *websocket.Conn, typ string, payload map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(payload)
	if err := wsjson.Write(ctx, conn, &models.WSMessage{Type: typ, Payload: raw}); err != nil {
		t.Fatalf("write %s: %v", typ, err)
	}
}

// waitForMessage polls the store until a message with the given ciphertext is saved.
func waitForMessage(t *testing.T, s *store.Store, channelID string, ciphertext []byte) *models.Message {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		msgs, err := s.ListMessages(channelID, "", 50)
		if err != nil {
			t.Fatalf("list messages: %v", err)
		}
		for i := range msgs {
			if bytes.Equal(msgs[i].Ciphertext, ciphertext) {
				return msgs[i]
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	return nil
}

func newInviteChannel(t *testing.T, srvURL, token string) string {
	t.Helper()
	body := jsonBody(t, api.CreateChannelRequest{Name: "Invites", Members: []string{}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srvURL+"/api/channels", token, body))
	var ch map[string]any
	decodeJSON(t, resp, &ch)
	return ch["id"].(string)
}

func TestInviteMessage_IsStoredWithItsType(t *testing.T) {
	srv, dataStore, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	token := registerAndLogin(t, srv, "inviter", "Password123!")
	chID := newInviteChannel(t, srv.URL, token)
	conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	ch, _ := dataStore.GetChannel(chID)
	nonce, cipher := sealForChannel(t, dataStore, chID, `{"code":"`+ch.InviteLink+`"}`)
	sendWS(t, ctx, conn, "message", map[string]any{
		"channel_id": chID, "type": "invite", "ciphertext": cipher, "nonce": nonce,
	})

	msg := waitForMessage(t, dataStore, chID, cipher)
	if msg == nil {
		t.Fatal("invite message was not stored")
	}
	if msg.Type != models.MessageTypeInvite {
		t.Errorf("type = %q, want %q", msg.Type, models.MessageTypeInvite)
	}
}

func TestMessage_UnknownTypeIsRejected(t *testing.T) {
	srv, dataStore, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	token := registerAndLogin(t, srv, "typo", "Password123!")
	chID := newInviteChannel(t, srv.URL, token)
	conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	bogus := []byte("bogus-type")
	sendWS(t, ctx, conn, "message", map[string]any{"channel_id": chID, "type": "script", "ciphertext": bogus, "nonce": []byte("n")})
	// Frames from one client are handled in order, so once this follow-up is stored the bogus one was already decided.
	marker := []byte("marker")
	sendWS(t, ctx, conn, "message", map[string]any{"channel_id": chID, "type": "text", "ciphertext": marker, "nonce": []byte("n")})
	if waitForMessage(t, dataStore, chID, marker) == nil {
		t.Fatal("follow-up text message was not stored")
	}
	if msgs, _ := dataStore.ListMessages(chID, "", 50); len(msgs) != 1 {
		t.Errorf("stored %d messages, want 1 (unknown type must be rejected)", len(msgs))
	}
}

func TestInviteMessage_CannotBeEdited(t *testing.T) {
	srv, dataStore, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	token := registerAndLogin(t, srv, "editor", "Password123!")
	chID := newInviteChannel(t, srv.URL, token)
	conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	ch, _ := dataStore.GetChannel(chID)
	nonce, original := sealForChannel(t, dataStore, chID, `{"code":"`+ch.InviteLink+`"}`)
	sendWS(t, ctx, conn, "message", map[string]any{"channel_id": chID, "type": "invite", "ciphertext": original, "nonce": nonce})
	msg := waitForMessage(t, dataStore, chID, original)
	if msg == nil {
		t.Fatal("invite message was not stored")
	}

	sendWS(t, ctx, conn, "message_edit", map[string]any{
		"channel_id": chID, "message_id": msg.ID, "ciphertext": []byte("tampered"), "nonce": []byte("n"),
	})
	// Same ordering trick: a later text message proves the edit frame was handled.
	marker := []byte("after-edit")
	sendWS(t, ctx, conn, "message", map[string]any{"channel_id": chID, "type": "text", "ciphertext": marker, "nonce": []byte("n")})
	if waitForMessage(t, dataStore, chID, marker) == nil {
		t.Fatal("follow-up message was not stored")
	}

	got, err := dataStore.GetMessage(chID, msg.ID)
	if err != nil {
		t.Fatalf("get message: %v", err)
	}
	if !bytes.Equal(got.Ciphertext, original) || got.EditedAt != nil {
		t.Error("an invite message must not be editable")
	}
}
