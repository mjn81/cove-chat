package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/auth"
	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"
	"cove/backend/internal/storage"
	"cove/backend/internal/store"
	"cove/backend/internal/ws"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func setupWhisperTestServer(t *testing.T) (*httptest.Server, *store.Store, func()) {
	dir := t.TempDir()
	kek := crypto.DeriveKEK("whisper-test-kek")
	dek, err := db.BootstrapDEK(dir+"/meta", kek)
	if err != nil {
		t.Fatalf("bootstrap dek: %v", err)
	}
	database, err := db.Open(dir+"/main", dek)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}

	dataStore := store.New(database)
	sessions := auth.NewSessionStore(24 * time.Hour)
	hub := ws.NewHub(dataStore, sessions, kek, true, "http://localhost:5173")

	handler := &api.Handler{
		Store:         dataStore,
		Sessions:      sessions,
		Hub:           hub,
		KEK:           kek,
		Storage:       &storage.FileSystemStorage{BaseDir: dir + "/uploads"},
		TokenTTL:      24 * time.Hour,
		MaxFileSizeMB: 10,
		IsDev:         true,
	}

	rootMux := http.NewServeMux()
	rootMux.Handle("/ws", hub)
	rootMux.Handle("/", api.NewRouter(handler, 10000, 10000))

	srv := httptest.NewServer(rootMux)

	cleanup := func() {
		srv.Close()
		hub.Close()
		database.Close()
		os.RemoveAll(dir)
	}
	return srv, dataStore, cleanup
}

func getUser(t *testing.T, srv *httptest.Server, token string) models.User {
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", token, nil))
	var u models.User
	decodeJSON(t, resp, &u)
	return u
}

func TestWhisperRelay_FriendsOnlyAndLifecycle(t *testing.T) {
	srv, dataStore, cleanup := setupWhisperTestServer(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Register Alice, Bob, and Eve
	tokenAlice := registerAndLogin(t, srv, "alice_whisper", "Password123!")
	tokenBob := registerAndLogin(t, srv, "bob_whisper", "Password123!")
	tokenEve := registerAndLogin(t, srv, "eve_whisper", "Password123!")

	userAlice := getUser(t, srv, tokenAlice)
	userBob := getUser(t, srv, tokenBob)
	_ = getUser(t, srv, tokenEve)

	// Make Alice and Bob mutual friends in store
	if err := dataStore.SendFriendRequest(userAlice.ID, userBob.ID); err != nil {
		t.Fatalf("send friend request failed: %v", err)
	}
	if err := dataStore.AcceptFriendRequest(userBob.ID, userAlice.ID); err != nil {
		t.Fatalf("accept friend request failed: %v", err)
	}
	if !dataStore.AreFriends(userAlice.ID, userBob.ID) {
		t.Fatalf("alice and bob are not friends")
	}

	// Eve is NOT a friend of Bob.

	// 2. Connect Alice, Bob, and Eve to WebSocket
	wsURL := "ws" + srv.URL[4:] + "/ws"

	connAlice, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + tokenAlice}},
	})
	if err != nil {
		t.Fatalf("alice ws dial failed: %v", err)
	}
	defer connAlice.Close(websocket.StatusNormalClosure, "")

	connBob, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + tokenBob}},
	})
	if err != nil {
		t.Fatalf("bob ws dial failed: %v", err)
	}
	defer connBob.Close(websocket.StatusNormalClosure, "")

	connEve, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + tokenEve}},
	})
	if err != nil {
		t.Fatalf("eve ws dial failed: %v", err)
	}
	defer connEve.Close(websocket.StatusNormalClosure, "")

	// 3. TEST: Eve attempts to initiate Whisper with Bob (NOT FRIENDS -> MUST FAIL)
	eveInitPayload, _ := json.Marshal(map[string]any{
		"session_id":     "sess-eve-bob",
		"target_user_id": userBob.ID,
		"pub_key":        "fake-pubkey-eve",
		"expiry_mode":    "persistent",
	})
	if err := wsjson.Write(ctx, connEve, &models.WSMessage{
		Type:    "whisper_init",
		Payload: eveInitPayload,
	}); err != nil {
		t.Fatalf("failed to write eve whisper_init: %v", err)
	}

	// Eve should receive whisper_error
	var eveResp models.WSMessage
	for {
		if err := wsjson.Read(ctx, connEve, &eveResp); err != nil {
			t.Fatalf("failed to read from eve: %v", err)
		}
		if eveResp.Type == "whisper_error" {
			var errPayload struct {
				SessionID string `json:"session_id"`
				Error     string `json:"error"`
			}
			json.Unmarshal(eveResp.Payload, &errPayload)
			if errPayload.Error != "Whisper sessions can only be initiated with friends" {
				t.Fatalf("unexpected error message: %s", errPayload.Error)
			}
			break
		}
	}

	// 4. TEST: Alice initiates Whisper with Bob (ARE FRIENDS -> MUST SUCCEED)
	sessionID := "sess-alice-bob-123"
	aliceInitPayload, _ := json.Marshal(map[string]any{
		"session_id":     sessionID,
		"target_user_id": userBob.ID,
		"pub_key":        "alice-ephemeral-ecdh-pubkey",
		"expiry_mode":    "persistent",
	})
	if err := wsjson.Write(ctx, connAlice, &models.WSMessage{
		Type:    "whisper_init",
		Payload: aliceInitPayload,
	}); err != nil {
		t.Fatalf("failed to write alice whisper_init: %v", err)
	}

	// Bob should receive whisper_init relayed from server
	var bobInitMsg models.WSMessage
	for {
		if err := wsjson.Read(ctx, connBob, &bobInitMsg); err != nil {
			t.Fatalf("failed to read from bob: %v", err)
		}
		if bobInitMsg.Type == "whisper_init" {
			var initBody struct {
				SessionID string `json:"session_id"`
				Initiator string `json:"initiator_id"`
				PubKey    string `json:"pub_key"`
			}
			json.Unmarshal(bobInitMsg.Payload, &initBody)
			if initBody.SessionID != sessionID || initBody.Initiator != userAlice.ID {
				t.Fatalf("mismatched whisper_init relay: %+v", initBody)
			}
			break
		}
	}

	// 5. Bob sends whisper_accept
	bobAcceptPayload, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"pub_key":    "bob-ephemeral-ecdh-pubkey",
	})
	if err := wsjson.Write(ctx, connBob, &models.WSMessage{
		Type:    "whisper_accept",
		Payload: bobAcceptPayload,
	}); err != nil {
		t.Fatalf("failed to write bob whisper_accept: %v", err)
	}

	// Alice should receive whisper_accept relayed from Bob
	var aliceAcceptMsg models.WSMessage
	for {
		if err := wsjson.Read(ctx, connAlice, &aliceAcceptMsg); err != nil {
			t.Fatalf("failed to read from alice: %v", err)
		}
		if aliceAcceptMsg.Type == "whisper_accept" {
			var acceptBody struct {
				SessionID string `json:"session_id"`
				TargetID  string `json:"target_id"`
				PubKey    string `json:"pub_key"`
			}
			json.Unmarshal(aliceAcceptMsg.Payload, &acceptBody)
			if acceptBody.SessionID != sessionID || acceptBody.TargetID != userBob.ID {
				t.Fatalf("mismatched whisper_accept relay: %+v", acceptBody)
			}
			break
		}
	}

	// 6. Alice sends whisper_msg (blind relay)
	aliceMsgPayload, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"ciphertext": "base64-ciphertext-secret-hello",
		"nonce":      "base64-nonce-12bytes",
	})
	if err := wsjson.Write(ctx, connAlice, &models.WSMessage{
		Type:    "whisper_msg",
		Payload: aliceMsgPayload,
	}); err != nil {
		t.Fatalf("failed to write alice whisper_msg: %v", err)
	}

	// Bob should receive the encrypted message verbatim
	var bobRecvMsg models.WSMessage
	for {
		if err := wsjson.Read(ctx, connBob, &bobRecvMsg); err != nil {
			t.Fatalf("failed to read whisper_msg from bob: %v", err)
		}
		if bobRecvMsg.Type == "whisper_msg" {
			var msgBody struct {
				SessionID  string `json:"session_id"`
				SenderID   string `json:"sender_id"`
				Ciphertext string `json:"ciphertext"`
				Nonce      string `json:"nonce"`
			}
			json.Unmarshal(bobRecvMsg.Payload, &msgBody)
			if msgBody.SessionID != sessionID || msgBody.SenderID != userAlice.ID || msgBody.Ciphertext != "base64-ciphertext-secret-hello" {
				t.Fatalf("unexpected whisper_msg received by bob: %+v", msgBody)
			}
			break
		}
	}

	// 7. Alice closes session
	closePayload, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"reason":     "burned",
	})
	if err := wsjson.Write(ctx, connAlice, &models.WSMessage{
		Type:    "whisper_close",
		Payload: closePayload,
	}); err != nil {
		t.Fatalf("failed to write whisper_close: %v", err)
	}

	// Bob should receive whisper_close
	var bobCloseMsg models.WSMessage
	for {
		if err := wsjson.Read(ctx, connBob, &bobCloseMsg); err != nil {
			t.Fatalf("failed to read whisper_close from bob: %v", err)
		}
		if bobCloseMsg.Type == "whisper_close" {
			var closeBody struct {
				SessionID string `json:"session_id"`
				CloserID  string `json:"closer_id"`
				Reason    string `json:"reason"`
			}
			json.Unmarshal(bobCloseMsg.Payload, &closeBody)
			if closeBody.SessionID != sessionID || closeBody.CloserID != userAlice.ID || closeBody.Reason != "burned" {
				t.Fatalf("unexpected whisper_close: %+v", closeBody)
			}
			break
		}
	}
}

func TestWhisperRelay_OfflineTargetDeliveredOnLogin(t *testing.T) {
	srv, dataStore, cleanup := setupWhisperTestServer(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Register Alice and Bob, make them friends
	tokenAlice := registerAndLogin(t, srv, "alice_offline_test", "Password123!")
	tokenBob := registerAndLogin(t, srv, "bob_offline_test", "Password123!")

	userAlice := getUser(t, srv, tokenAlice)
	userBob := getUser(t, srv, tokenBob)

	if err := dataStore.SendFriendRequest(userAlice.ID, userBob.ID); err != nil {
		t.Fatalf("send friend request failed: %v", err)
	}
	if err := dataStore.AcceptFriendRequest(userBob.ID, userAlice.ID); err != nil {
		t.Fatalf("accept friend request failed: %v", err)
	}

	// 2. Only Alice connects to WebSocket initially. Bob remains offline / logged out!
	wsURL := "ws" + srv.URL[4:] + "/ws"
	connAlice, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + tokenAlice}},
	})
	if err != nil {
		t.Fatalf("alice ws dial failed: %v", err)
	}
	defer connAlice.Close(websocket.StatusNormalClosure, "")

	// 3. Alice initiates Whisper with Bob while Bob is offline
	sessionID := "sess-offline-test-456"
	aliceInitPayload, _ := json.Marshal(map[string]any{
		"session_id":     sessionID,
		"target_user_id": userBob.ID,
		"pub_key":        "alice-ephemeral-ecdh-pubkey-offline",
		"expiry_mode":    "persistent",
	})
	if err := wsjson.Write(ctx, connAlice, &models.WSMessage{
		Type:    "whisper_init",
		Payload: aliceInitPayload,
	}); err != nil {
		t.Fatalf("failed to write alice whisper_init: %v", err)
	}

	// Small pause to ensure the message was processed in Hub RAM
	time.Sleep(50 * time.Millisecond)

	// 4. Bob now logs in and connects to WebSocket
	connBob, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + tokenBob}},
	})
	if err != nil {
		t.Fatalf("bob ws dial failed: %v", err)
	}
	defer connBob.Close(websocket.StatusNormalClosure, "")

	// 5. Bob MUST receive the replayed whisper_init message upon connecting!
	var bobInitMsg models.WSMessage
	foundInit := false
	for i := 0; i < 5; i++ {
		if err := wsjson.Read(ctx, connBob, &bobInitMsg); err != nil {
			t.Fatalf("failed to read from bob: %v", err)
		}
		if bobInitMsg.Type == "whisper_init" {
			var initBody struct {
				SessionID string `json:"session_id"`
				Initiator string `json:"initiator_id"`
				PubKey    string `json:"pub_key"`
			}
			json.Unmarshal(bobInitMsg.Payload, &initBody)
			if initBody.SessionID != sessionID || initBody.Initiator != userAlice.ID {
				t.Fatalf("mismatched whisper_init replayed on login: %+v", initBody)
			}
			foundInit = true
			break
		}
	}
	if !foundInit {
		t.Fatalf("bob did not receive replayed whisper_init upon login")
	}

	// 6. Bob accepts the session
	bobAcceptPayload, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"pub_key":    "bob-ephemeral-ecdh-pubkey-accepted",
	})
	if err := wsjson.Write(ctx, connBob, &models.WSMessage{
		Type:    "whisper_accept",
		Payload: bobAcceptPayload,
	}); err != nil {
		t.Fatalf("failed to write bob whisper_accept: %v", err)
	}

	// 7. Alice receives whisper_accept
	var aliceAcceptMsg models.WSMessage
	for {
		if err := wsjson.Read(ctx, connAlice, &aliceAcceptMsg); err != nil {
			t.Fatalf("failed to read from alice: %v", err)
		}
		if aliceAcceptMsg.Type == "whisper_accept" {
			var acceptBody struct {
				SessionID string `json:"session_id"`
				TargetID  string `json:"target_id"`
				PubKey    string `json:"pub_key"`
			}
			json.Unmarshal(aliceAcceptMsg.Payload, &acceptBody)
			if acceptBody.SessionID != sessionID || acceptBody.TargetID != userBob.ID {
				t.Fatalf("mismatched whisper_accept: %+v", acceptBody)
			}
			break
		}
	}
}
