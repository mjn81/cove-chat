package tests

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"nodetalk/backend/internal/api"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/crypto"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
)

// ─────────────────────────────────────────────────────────────
//  Cookie / CSRF auth tests
// ─────────────────────────────────────────────────────────────

// testServerDev is like testServer but with IsDev: true, matching how the
// server actually runs during local development (GO_ENV=development), where
// the session/CSRF cookies are issued without the Secure flag. httptest
// serves over plain HTTP, so without this a browser-realistic cookie jar
// would silently refuse to store/replay a Secure cookie and every
// cookie-authenticated request would look unauthenticated — exercise the
// cookie flow against this harness, not the plain testServer.
func testServerDev(t *testing.T) *httptest.Server {
	t.Helper()

	dir := t.TempDir()
	kek := crypto.DeriveKEK("test-master-password")
	dek, err := db.BootstrapDEK(dir+"/meta", kek)
	if err != nil {
		t.Fatalf("BootstrapDEK: %v", err)
	}
	database, err := db.Open(dir+"/main", dek)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
		os.RemoveAll(dir)
	})

	tokenTTL := 24 * time.Hour
	handler := &api.Handler{
		Store:         store.New(database),
		Sessions:      auth.NewSessionStore(tokenTTL),
		KEK:           kek,
		Storage:       &storage.FileSystemStorage{BaseDir: dir + "/uploads"},
		TokenTTL:      tokenTTL,
		MaxFileSizeMB: 10,
		IsDev:         true,
	}
	router := api.NewRouter(handler, 1000, 1000)
	return httptest.NewServer(router)
}

// cookieClient returns an http.Client with its own cookie jar, so cookies set
// by the server (Set-Cookie on /api/login) are captured and replayed on
// subsequent requests — this is how the web client authenticates.
func cookieClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New: %v", err)
	}
	return &http.Client{Jar: jar}
}

// loginWithCookies logs in and returns the client (holding the session +
// CSRF cookies) plus the CSRF token value, read directly off the response.
func loginWithCookies(t *testing.T, srv *httptest.Server, username, password string) (*http.Client, string) {
	t.Helper()
	client := cookieClient(t)

	regBody := jsonBody(t, api.RegisterRequest{Username: username, Password: password})
	regReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/register", regBody)
	regReq.Header.Set("Content-Type", "application/json")
	if _, err := client.Do(regReq); err != nil {
		t.Fatalf("register: %v", err)
	}

	loginBody := jsonBody(t, api.LoginRequest{Username: username, Password: password})
	loginReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/login", loginBody)
	loginReq.Header.Set("Content-Type", "application/json")
	loginResp, err := client.Do(loginReq)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want 200", loginResp.StatusCode)
	}
	loginResp.Body.Close()

	var csrf string
	for _, c := range loginResp.Cookies() {
		if c.Name == "nodetalk_csrf" {
			csrf = c.Value
		}
	}
	if csrf == "" {
		t.Fatal("nodetalk_csrf cookie not set on login")
	}
	return client, csrf
}

func TestLogin_SetsSessionAndCSRFCookies(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	client := cookieClient(t)
	regBody := jsonBody(t, api.RegisterRequest{Username: "cookieuser1", Password: "password123"})
	regReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/register", regBody)
	regReq.Header.Set("Content-Type", "application/json")
	client.Do(regReq)

	loginBody := jsonBody(t, api.LoginRequest{Username: "cookieuser1", Password: "password123"})
	loginReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/login", loginBody)
	loginReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(loginReq)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()

	var sawSession, sawCSRF bool
	for _, c := range resp.Cookies() {
		switch c.Name {
		case "nodetalk_session":
			sawSession = true
			if !c.HttpOnly {
				t.Error("nodetalk_session cookie must be HttpOnly")
			}
			// testServer runs with IsDev: false (the zero value), matching a
			// production deployment — cookies must be Secure in that case.
			if !c.Secure {
				t.Error("nodetalk_session cookie must be Secure when not in dev mode")
			}
		case "nodetalk_csrf":
			sawCSRF = true
			if c.HttpOnly {
				t.Error("nodetalk_csrf cookie must NOT be HttpOnly (client needs to read it)")
			}
			if !c.Secure {
				t.Error("nodetalk_csrf cookie must be Secure when not in dev mode")
			}
		}
	}
	if !sawSession {
		t.Error("login response did not set nodetalk_session cookie")
	}
	if !sawCSRF {
		t.Error("login response did not set nodetalk_csrf cookie")
	}
}

// TestLogin_AlwaysUsesSameSiteLax_RegardlessOfOrigin locks in a corrected
// design decision. An earlier version of this fix issued SameSite=None for
// requests from a recognized Wails origin, reasoning that the desktop
// webview's frontend origin differs from the API origin, so SameSite=Lax
// cookies (sent only on top-level navigations) would never reach the API on
// a normal fetch/XHR call. That reasoning about SameSite=Lax was correct,
// but the fix was still wrong: the CSRF cookie (non-httpOnly, meant to be
// read via document.cookie and echoed back as a header) is scoped to the
// API's own origin — a page running on a DIFFERENT origin (wails://…,
// localhost:34115) can never read it via document.cookie, regardless of
// SameSite. That's basic cookie-scoping (RFC 6265), not a SameSite
// question, and no SameSite value fixes it. So a cross-origin client could
// never complete this cookie+CSRF-double-submit flow no matter what — the
// SameSite=None branch was real but functionally dead code, and widened the
// cookie's exposure for no benefit. Every login must get the strictly safer
// SameSite=Lax; the desktop (Wails) client is architecturally stuck on
// Bearer-token auth for as long as it's served from a different origin than
// the API (fixing that for real would mean reverse-proxying /api under the
// Wails asset-server origin, not a cookie-attribute tweak).
func TestLogin_AlwaysUsesSameSiteLax_RegardlessOfOrigin(t *testing.T) {
	for _, origin := range []string{"http://localhost:5173", "wails://wails.localhost", "http://localhost:34115"} {
		t.Run(origin, func(t *testing.T) {
			srv := testServer(t)
			defer srv.Close()

			client := cookieClient(t)
			username := "samesiteuser_" + strings.NewReplacer(":", "_", "/", "_", ".", "_").Replace(origin)
			regBody := jsonBody(t, api.RegisterRequest{Username: username, Password: "password123"})
			regReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/register", regBody)
			regReq.Header.Set("Content-Type", "application/json")
			client.Do(regReq)

			loginBody := jsonBody(t, api.LoginRequest{Username: username, Password: "password123"})
			loginReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/login", loginBody)
			loginReq.Header.Set("Content-Type", "application/json")
			loginReq.Header.Set("Origin", origin)
			resp, err := client.Do(loginReq)
			if err != nil {
				t.Fatalf("login: %v", err)
			}
			defer resp.Body.Close()

			var sawSession bool
			for _, c := range resp.Cookies() {
				if c.Name == "nodetalk_session" {
					sawSession = true
					if c.SameSite != http.SameSiteLaxMode {
						t.Errorf("nodetalk_session SameSite = %v, want SameSiteLaxMode for origin %q", c.SameSite, origin)
					}
				}
			}
			if !sawSession {
				t.Fatal("login response did not set nodetalk_session cookie")
			}
		})
	}
}

func TestMe_AuthenticatedViaCookieAlone(t *testing.T) {
	srv := testServerDev(t)
	defer srv.Close()

	client, _ := loginWithCookies(t, srv, "cookieuser2", "password123")

	// No Authorization header at all — the cookie jar carries the session.
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/me", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestMutatingRequest_ViaCookie_RequiresCSRFHeader(t *testing.T) {
	srv := testServerDev(t)
	defer srv.Close()

	client, csrf := loginWithCookies(t, srv, "cookieuser3", "password123")

	body := jsonBody(t, map[string]string{"custom_msg": "hello"})
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/api/users/me", body)
	req.Header.Set("Content-Type", "application/json")
	// Deliberately omit X-CSRF-Token.
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("PATCH /api/users/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status without CSRF header = %d, want 403", resp.StatusCode)
	}

	// Same request, this time with the correct CSRF header, should succeed.
	body2 := jsonBody(t, map[string]string{"custom_msg": "hello"})
	req2, _ := http.NewRequest(http.MethodPatch, srv.URL+"/api/users/me", body2)
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-CSRF-Token", csrf)
	resp2, err := client.Do(req2)
	if err != nil {
		t.Fatalf("PATCH /api/users/me (with csrf): %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Errorf("status with correct CSRF header = %d, want 200", resp2.StatusCode)
	}
}

func TestMutatingRequest_ViaCookie_WrongCSRFTokenRejected(t *testing.T) {
	srv := testServerDev(t)
	defer srv.Close()

	client, _ := loginWithCookies(t, srv, "cookieuser4", "password123")

	body := jsonBody(t, map[string]string{"custom_msg": "hello"})
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/api/users/me", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", "not-the-real-token")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("PATCH /api/users/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status with wrong CSRF token = %d, want 403", resp.StatusCode)
	}
}

func TestBearerToken_DoesNotRequireCSRF(t *testing.T) {
	// Desktop/API clients authenticate with a Bearer token, not an ambient
	// cookie, so CSRF (which only defends against ambient-credential misuse)
	// must not apply to them.
	srv := testServer(t)
	defer srv.Close()

	token := registerAndLogin(t, srv, "beareruser1", "password123!")
	body := jsonBody(t, map[string]string{"custom_msg": "hello"})
	req := newJSONReq(t, http.MethodPatch, srv.URL+"/api/users/me", token, body)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestLogout_ClearsCookiesAndInvalidatesSession(t *testing.T) {
	srv := testServerDev(t)
	defer srv.Close()

	client, csrf := loginWithCookies(t, srv, "cookieuser5", "password123")

	logoutReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/logout", nil)
	logoutReq.Header.Set("X-CSRF-Token", csrf)
	resp, err := client.Do(logoutReq)
	if err != nil {
		t.Fatalf("logout: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logout status = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	meReq, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/me", nil)
	meResp, err := client.Do(meReq)
	if err != nil {
		t.Fatalf("GET /api/me after logout: %v", err)
	}
	defer meResp.Body.Close()
	if meResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("post-logout /api/me status = %d, want 401", meResp.StatusCode)
	}
}

// ─────────────────────────────────────────────────────────────
//  AddMembers authorization tests
// ─────────────────────────────────────────────────────────────

func TestAddMembers_RegularMemberForbidden(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	ownerToken := registerAndLogin(t, srv, "am_owner", "password123!")
	memberToken := registerAndLogin(t, srv, "am_member", "password123!")
	outsiderToken := registerAndLogin(t, srv, "am_outsider", "password123!")

	memberID := mustUserID(t, srv, memberToken)
	outsiderID := mustUserID(t, srv, outsiderToken)

	// Owner creates a private channel and adds "member" directly at creation.
	chBody := jsonBody(t, api.CreateChannelRequest{Name: "AM Test", IsPrivate: true, Members: []string{memberID}})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", ownerToken, chBody))
	var ch map[string]any
	decodeJSON(t, chResp, &ch)
	chID := ch["id"].(string)

	// A regular (non-admin) member tries to add the outsider — must be forbidden.
	addBody := jsonBody(t, api.AddMembersRequest{UserIDs: []string{outsiderID}})
	addResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels/"+chID+"/members", memberToken, addBody))
	if addResp.StatusCode != http.StatusForbidden {
		t.Errorf("regular member AddMembers status = %d, want 403", addResp.StatusCode)
	}

	// The owner performing the same action must succeed.
	addBody2 := jsonBody(t, api.AddMembersRequest{UserIDs: []string{outsiderID}})
	addResp2 := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels/"+chID+"/members", ownerToken, addBody2))
	if addResp2.StatusCode != http.StatusOK {
		t.Errorf("owner AddMembers status = %d, want 200", addResp2.StatusCode)
	}
}

func mustUserID(t *testing.T, srv *httptest.Server, token string) string {
	t.Helper()
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", token, nil))
	var me map[string]any
	decodeJSON(t, resp, &me)
	id, _ := me["id"].(string)
	if id == "" {
		t.Fatal("could not resolve user id from /api/me")
	}
	return id
}

// ─────────────────────────────────────────────────────────────
//  File download IDOR tests
// ─────────────────────────────────────────────────────────────

func uploadFile(t *testing.T, srv *httptest.Server, token, channelID, content string) string {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", "test.txt")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	fw.Write([]byte(content))
	if channelID != "" {
		w.WriteField("channel_id", channelID)
	}
	w.Close()

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/files", &buf)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201", resp.StatusCode)
	}
	var got map[string]any
	decodeJSON(t, resp, &got)
	id, _ := got["id"].(string)
	if id == "" {
		t.Fatal("upload response missing file id")
	}
	return id
}

func TestDownloadFile_ChannelScoped_NonMemberForbidden(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	ownerToken := registerAndLogin(t, srv, "file_owner", "password123!")
	outsiderToken := registerAndLogin(t, srv, "file_outsider", "password123!")

	chBody := jsonBody(t, api.CreateChannelRequest{Name: "File Test", IsPrivate: true, Members: []string{}})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", ownerToken, chBody))
	var ch map[string]any
	decodeJSON(t, chResp, &ch)
	chID := ch["id"].(string)

	fileID := uploadFile(t, srv, ownerToken, chID, "top secret contents")

	// Non-member must be forbidden.
	outsiderResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/files/"+fileID, outsiderToken, nil))
	if outsiderResp.StatusCode != http.StatusForbidden {
		t.Errorf("non-member download status = %d, want 403", outsiderResp.StatusCode)
	}

	// The owner must still be able to fetch it.
	ownerResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/files/"+fileID, ownerToken, nil))
	if ownerResp.StatusCode != http.StatusOK {
		t.Errorf("owner download status = %d, want 200", ownerResp.StatusCode)
	}
}

func TestDownloadFile_ChannelScoped_MemberAllowed(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	ownerToken := registerAndLogin(t, srv, "file_owner2", "password123!")
	memberToken := registerAndLogin(t, srv, "file_member2", "password123!")
	memberID := mustUserID(t, srv, memberToken)

	chBody := jsonBody(t, api.CreateChannelRequest{Name: "File Test 2", IsPrivate: true, Members: []string{memberID}})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", ownerToken, chBody))
	var ch map[string]any
	decodeJSON(t, chResp, &ch)
	chID := ch["id"].(string)

	fileID := uploadFile(t, srv, ownerToken, chID, "shared file contents")

	memberResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/files/"+fileID, memberToken, nil))
	if memberResp.StatusCode != http.StatusOK {
		t.Errorf("member download status = %d, want 200", memberResp.StatusCode)
	}
}

func TestDownloadFile_Unscoped_AnyAuthenticatedUserAllowed(t *testing.T) {
	// Files with no channel_id (e.g. avatars) are intentionally visible to
	// any authenticated user, matching how avatars are shown platform-wide.
	srv := testServer(t)
	defer srv.Close()

	ownerToken := registerAndLogin(t, srv, "avatar_owner", "password123!")
	otherToken := registerAndLogin(t, srv, "avatar_viewer", "password123!")

	fileID := uploadFile(t, srv, ownerToken, "", "avatar bytes")

	otherResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/files/"+fileID, otherToken, nil))
	if otherResp.StatusCode != http.StatusOK {
		t.Errorf("unscoped file download status = %d, want 200", otherResp.StatusCode)
	}
}

func TestUploadFile_ChannelScoped_NonMemberForbidden(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	ownerToken := registerAndLogin(t, srv, "upload_owner", "password123!")
	outsiderToken := registerAndLogin(t, srv, "upload_outsider", "password123!")

	chBody := jsonBody(t, api.CreateChannelRequest{Name: "Upload Test", IsPrivate: true, Members: []string{}})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", ownerToken, chBody))
	var ch map[string]any
	decodeJSON(t, chResp, &ch)
	chID := ch["id"].(string)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "test.txt")
	fw.Write([]byte("attempted upload"))
	w.WriteField("channel_id", chID)
	w.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/files", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+outsiderToken)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-member upload status = %d, want 403", resp.StatusCode)
	}
}

// ─────────────────────────────────────────────────────────────
//  Error-propagation regression tests
// ─────────────────────────────────────────────────────────────

// TestDeleteUser_ReturnsErrorWhenAnonymizationFails guards a real behavior
// fix: DeleteUser previously always returned nil regardless of whether the
// final anonymization write succeeded, so a failed account deletion could
// be reported to the caller as a success while the account was left
// completely untouched.
func TestDeleteUser_ReturnsErrorWhenAnonymizationFails(t *testing.T) {
	dir := t.TempDir()
	kek := crypto.DeriveKEK("test-master-password")
	dek, err := db.BootstrapDEK(dir+"/meta", kek)
	if err != nil {
		t.Fatalf("BootstrapDEK: %v", err)
	}
	database, err := db.Open(dir+"/main", dek)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	s := store.New(database)

	if err := s.DeleteUser("nonexistent-user-id"); err == nil {
		t.Fatal("expected DeleteUser to return an error for a user that doesn't exist, got nil")
	}
}
