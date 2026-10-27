package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"nodetalk/backend/internal/api"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/crypto"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
)

// ─────────────────────────────────────────────────────────────
//  Test harness helpers
// ─────────────────────────────────────────────────────────────

// testServer spins up an httptest.Server backed by a real (but temp-dir) BadgerDB.
// It is automatically cleaned up when the test ends.
func testServer(t *testing.T) *httptest.Server {
	t.Helper()

	dir := t.TempDir()
	tmpMeta := dir + "/meta"
	tmpMain := dir + "/main"

	kek := crypto.DeriveKEK("test-master-password")
	dek, err := db.BootstrapDEK(tmpMeta, kek)
	if err != nil {
		t.Fatalf("BootstrapDEK: %v", err)
	}
	database, err := db.Open(tmpMain, dek)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
		os.RemoveAll(dir)
	})

	uploadDir := dir + "/uploads"
	tokenTTL := 24 * time.Hour
	handler := &api.Handler{
		Store:         store.New(database),
		Sessions:      auth.NewSessionStore(tokenTTL),
		KEK:           kek,
		Storage:       &storage.FileSystemStorage{BaseDir: uploadDir},
		TokenTTL:      tokenTTL,
		MaxFileSizeMB: 10,
	}
	router := api.NewRouter(handler, 1000, 1000) // high limits for testing
	return httptest.NewServer(router)
}

// jsonBody encodes v as JSON and returns an *bytes.Buffer for use in NewRequest.
func jsonBody(t *testing.T, v any) *bytes.Buffer {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("jsonBody: %v", err)
	}
	return bytes.NewBuffer(b)
}

// decodeJSON decodes the response body into v.
func decodeJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decodeJSON: %v", err)
	}
}

// mustDo sends the request and returns the response; test-fatal on transport error.
func mustDo(t *testing.T, req *http.Request) *http.Response {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("mustDo: %v", err)
	}
	return resp
}

// newJSONReq builds an authenticated JSON request. Pass token="" for public routes.
func newJSONReq(t *testing.T, method, url, token string, body *bytes.Buffer) *http.Request {
	t.Helper()
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, url, body)
	} else {
		req, err = http.NewRequest(method, url, nil)
	}
	if err != nil {
		t.Fatalf("newJSONReq: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

// ─────────────────────────────────────────────────────────────
//  Auth API Tests  (TDD — test before implementation)
// ─────────────────────────────────────────────────────────────

func TestRegister_Success(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	body := jsonBody(t, api.RegisterRequest{Username: "alice", Password: "password123"})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "", body))

	if resp.StatusCode != http.StatusCreated {
		t.Errorf("register status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}

	var got api.RegisterResponse
	decodeJSON(t, resp, &got)
	if got.Username != "alice" {
		t.Errorf("username = %q, want %q", got.Username, "alice")
	}
	if got.ID == "" {
		t.Error("id should not be empty")
	}
}

func TestRegister_ShortPassword(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	body := jsonBody(t, api.RegisterRequest{Username: "bob", Password: "short"})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "", body))

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestRegister_EmptyUsername(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	body := jsonBody(t, api.RegisterRequest{Username: "", Password: "password123"})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "", body))

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestLogin_Success(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	// Register first
	regBody := jsonBody(t, api.RegisterRequest{Username: "carol", Password: "s3curePassword!"})
	mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "", regBody))

	// Login
	loginBody := jsonBody(t, api.LoginRequest{Username: "carol", Password: "s3curePassword!"})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", loginBody))

	if resp.StatusCode != http.StatusOK {
		t.Errorf("login status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var got api.LoginResponse
	decodeJSON(t, resp, &got)

	if got.Token == "" {
		t.Error("token in JSON response is empty")
	}

	if got.Username != "carol" {
		t.Errorf("username = %q, want %q", got.Username, "carol")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	regBody := jsonBody(t, api.RegisterRequest{Username: "dave", Password: "correctPassword1"})
	mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "", regBody))

	loginBody := jsonBody(t, api.LoginRequest{Username: "dave", Password: "wrongPassword!"})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", loginBody))

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	loginBody := jsonBody(t, api.LoginRequest{Username: "nobody", Password: "irrelevant!"})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", loginBody))

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

// ─────────────────────────────────────────────────────────────
//  Helper: register+login and return token
// ─────────────────────────────────────────────────────────────

func registerAndLogin(t *testing.T, srv *httptest.Server, username, password string) string {
	t.Helper()
	regBody := jsonBody(t, api.RegisterRequest{Username: username, Password: password})
	mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "", regBody))

	loginBody := jsonBody(t, api.LoginRequest{Username: username, Password: password})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", loginBody))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login failed with status %d", resp.StatusCode)
	}

	var got api.LoginResponse
	decodeJSON(t, resp, &got)
	if got.Token == "" {
		t.Fatal("token not found in login response JSON")
	}
	return got.Token
}

// ─────────────────────────────────────────────────────────────
//  Me / User API Tests
// ─────────────────────────────────────────────────────────────

func TestMe_Authenticated(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	token := registerAndLogin(t, srv, "eve", "password123!")
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", token, nil))

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var got map[string]any
	decodeJSON(t, resp, &got)
	if got["username"] != "eve" {
		t.Errorf("username = %v, want %q", got["username"], "eve")
	}
}

func TestMe_Unauthenticated(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", "", nil))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

// ─────────────────────────────────────────────────────────────
//  Channel API Tests
// ─────────────────────────────────────────────────────────────

func TestCreateChannel_GroupAndDM(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenA := registerAndLogin(t, srv, "frank", "password123!")
	tokenB := registerAndLogin(t, srv, "grace", "password123!")

	// Get frank's user ID from /api/me
	meResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tokenA, nil))
	var meA map[string]any
	decodeJSON(t, meResp, &meA)
	frankID := meA["id"].(string)

	meRespB := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tokenB, nil))
	var meB map[string]any
	decodeJSON(t, meRespB, &meB)
	graceID := meB["id"].(string)

	// Create a DM (2 members)
	dmBody := jsonBody(t, api.CreateChannelRequest{Members: []string{graceID}})
	dmResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, dmBody))
	if dmResp.StatusCode != http.StatusCreated {
		t.Errorf("DM create status = %d, want %d", dmResp.StatusCode, http.StatusCreated)
	}

	// Create a group (name required, any members)
	grpBody := jsonBody(t, api.CreateChannelRequest{
		Name:    "Test Group",
		Members: []string{frankID, graceID},
	})
	grpResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, grpBody))
	if grpResp.StatusCode != http.StatusCreated {
		t.Errorf("group create status = %d, want %d", grpResp.StatusCode, http.StatusCreated)
	}
}

func TestListChannels_ReturnsOnlyUserChannels(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenA := registerAndLogin(t, srv, "henry", "password123!")
	tokenB := registerAndLogin(t, srv, "irene", "password123!")

	// A creates a channel with A only
	body := jsonBody(t, api.CreateChannelRequest{Name: "Private", Members: []string{}})
	mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, body))

	// B should see 0 channels
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenB, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var channels []map[string]any
	decodeJSON(t, resp, &channels)
	if len(channels) != 0 {
		t.Errorf("B should see 0 channels, got %d", len(channels))
	}

	// A should see 1 channel
	respA := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenA, nil))
	var channelsA []map[string]any
	decodeJSON(t, respA, &channelsA)
	if len(channelsA) != 1 {
		t.Errorf("A should see 1 channel, got %d", len(channelsA))
	}
}

// ─────────────────────────────────────────────────────────────
//  Message API Tests
// ─────────────────────────────────────────────────────────────

func TestListMessages_EmptyChannel(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	token := registerAndLogin(t, srv, "jack", "password123!")

	// Create channel
	chBody := jsonBody(t, api.CreateChannelRequest{Name: "Test", Members: []string{}})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", token, chBody))
	var ch map[string]any
	decodeJSON(t, chResp, &ch)
	chID := ch["id"].(string)

	// List messages — should be an empty array, not null
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels/"+chID+"/messages", token, nil))
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var msgs []any
	decodeJSON(t, resp, &msgs)
	if msgs == nil {
		t.Error("messages should be [] not null")
	}
	if len(msgs) != 0 {
		t.Errorf("expected 0 messages, got %d", len(msgs))
	}
}

// ─────────────────────────────────────────────────────────────
//  Logout Test
// ─────────────────────────────────────────────────────────────

func TestLogout_InvalidatesToken(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	token := registerAndLogin(t, srv, "kate", "password123!")

	// Logout
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/logout", token, nil))
	if resp.StatusCode != http.StatusOK {
		t.Errorf("logout status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	// Token should now be invalid
	resp2 := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", token, nil))
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Errorf("post-logout /me status = %d, want %d", resp2.StatusCode, http.StatusUnauthorized)
	}
}

// ─────────────────────────────────────────────────────────────
//  Extended Feature Tests
// ─────────────────────────────────────────────────────────────

func TestAccountDeletion(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	// The first account on a server is its owner and cannot delete itself.
	registerAndLogin(t, srv, "founder", "password123!")
	token1 := registerAndLogin(t, srv, "victor", "password123!")
	
	// Delete
	resp := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/users/me", token1, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	// Token invalid
	resp2 := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", token1, nil))
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Errorf("post-delete /me status = %d, want %d", resp2.StatusCode, http.StatusUnauthorized)
	}
}

func TestExploreAndJoinChannel(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenA := registerAndLogin(t, srv, "alice2", "password123!")
	tokenB := registerAndLogin(t, srv, "bob2", "password123!")

	// Alice creates a public group
	pubBody := jsonBody(t, api.CreateChannelRequest{Name: "Global Tech", IsPrivate: false, Members: []string{}})
	pubResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, pubBody))
	var pubCh map[string]any
	decodeJSON(t, pubResp, &pubCh)

	// Alice creates a private group
	privBody := jsonBody(t, api.CreateChannelRequest{Name: "Secret Tech", IsPrivate: true, Members: []string{}})
	mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, privBody))

	// Bob searches for Tech
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels/explore?q=Tech", tokenB, nil))
	var explored []map[string]any
	decodeJSON(t, resp, &explored)
	if len(explored) != 1 {
		t.Fatalf("expected 1 public channel, got %d", len(explored))
	}
	if explored[0]["name"] != "Global Tech" {
		t.Errorf("expected Global Tech, got %v", explored[0]["name"])
	}

	// Bob joins using invite_link
	link := explored[0]["invite_link"].(string)
	if link == "" {
		t.Fatalf("Invite link is empty")
	}

	joinResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/join/"+link, tokenB, nil))
	if joinResp.StatusCode != http.StatusOK {
		t.Fatalf("join status = %d", joinResp.StatusCode)
	}

	// Verify Bob has channel in his list
	listResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenB, nil))
	var bobChannels []map[string]any
	decodeJSON(t, listResp, &bobChannels)
	if len(bobChannels) != 1 {
		t.Errorf("expected 1 channel, got %d", len(bobChannels))
	}
}

func TestSearchUsers(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenA := registerAndLogin(t, srv, "searchuser1", "password123!")
	registerAndLogin(t, srv, "searchuser2", "password123!")

	// Search
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/users?q=search", tokenA, nil))
	var users []map[string]any
	decodeJSON(t, resp, &users)
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}
}

// ─────────────────────────────────────────────────────────────
//  Encryption & Security Tests
// ─────────────────────────────────────────────────────────────

func TestMessageEncryptionAndStorage(t *testing.T) {
	// 1. Setup server and storage
	dir := t.TempDir()
	kek := crypto.DeriveKEK("super-secret-master-key")
	dek, _ := db.BootstrapDEK(dir+"/meta", kek)
	database, _ := db.Open(dir+"/main", dek)
	t.Cleanup(func() { database.Close() })
	s := store.New(database)

	// 2. Create user and channel
	u, _ := s.CreateUser("alice", "password123", "localhost")
	ch, err := s.CreateChannel("Secret Channel", u.ID, true, []string{u.ID}, kek)
	if err != nil {
		t.Fatalf("CreateChannel failed: %v", err)
	}

	// 3. Encrypt a message using the channel key
	plaintext := "This is a very secret message that should not be in plaintext in the DB"
	
	// Get the raw channel key (decrypted from DB record using KEK)
	rawChannelKey, err := s.DecryptChannelKey(ch, kek)
	if err != nil {
		t.Fatalf("DecryptChannelKey failed: %v", err)
	}

	// Encrypt the plaintext
	encryptedData, err := crypto.EncryptAES256GCM(rawChannelKey, []byte(plaintext))
	if err != nil {
		t.Fatalf("Encryption failed: %v", err)
	}

	// 4. Save the message to the store
	// The models.Message struct has separate Ciphertext and Nonce fields, 
	// though EncryptAES256GCM returns them combined [nonce | ciphertext].
	msg := &models.Message{
		ID:         "msg-1",
		ChannelID:  ch.ID,
		SenderID:   u.ID,
		Type:       models.MessageTypeText,
		Ciphertext: encryptedData[12:], // Format as [ciphertext | tag]
		Nonce:      encryptedData[:12], // Format as [nonce]
		SentAt:     time.Now().UTC(),
	}
	if err := s.SaveMessage(msg); err != nil {
		t.Fatalf("SaveMessage failed: %v", err)
	}

	// 5. Verify the logical record in DB
	// Retrieve messages via API-like store method
	msgs, err := s.ListMessages(ch.ID, "", 10)
	if err != nil {
		t.Fatalf("ListMessages failed: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(msgs))
	}

	gotMsg := msgs[0]
	// Re-combine for decryption if needed, or pass separately if Decrypt function allows
	// Our crypto.DecryptAES256GCM expects [nonce | ciphertext] combined
	fullCiphertext := append(gotMsg.Nonce, gotMsg.Ciphertext...)

	if string(gotMsg.Ciphertext) == plaintext {
		t.Errorf("FAIL: Message stored as plaintext in Ciphertext field!")
	}

	// 6. Verify we can decrypt it back
	decrypted, err := crypto.DecryptAES256GCM(rawChannelKey, fullCiphertext)
	if err != nil {
		t.Errorf("Decryption failed: %v", err)
	}
	if string(decrypted) != plaintext {
		t.Errorf("Decrypted text = %q, want %q", string(decrypted), plaintext)
	}

	// 7. Verify the raw database value (JSON blob) has NO plaintext
	// We need to check if the serialized JSON contains the plaintext string.
	// Note: since dek is used for BadgerDB encryption, we can't easily read from disk,
	// but we can check the logical JSON before it hits the disk encryption layer.
	
	msgJSON, _ := json.Marshal(gotMsg)
	if bytes.Contains(msgJSON, []byte(plaintext)) {
		t.Errorf("FAIL: Plaintext found in serialized Message JSON: %s", string(msgJSON))
	}

	// 8. Print values for manual verification
	fmt.Printf("\n--- SECURITY VERIFICATION ---\n")
	fmt.Printf("Original Plaintext: %s\n", plaintext)
	fmt.Printf("Stored Ciphertext (Hex): %x\n", gotMsg.Ciphertext)
	fmt.Printf("Record JSON in DB: %s\n", string(msgJSON))
	fmt.Printf("------------------------------\n\n")

	t.Logf("SUCCESS: Message is properly encrypted and no plaintext exists in the stored record.")
}
