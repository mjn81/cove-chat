package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/geoip"
	"cove/backend/internal/middleware"

	"github.com/coder/websocket"
)

const chromeWindowsUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

type stubGeo struct{}

func (stubGeo) Lookup(ip string) geoip.Location {
	if ip == "203.0.113.7" {
		return geoip.Location{City: "Tehran", Country: "Iran"}
	}
	return geoip.Location{}
}

// loginAs logs an existing user in again with custom client headers, returning the new token.
func loginAs(t *testing.T, srv *httptest.Server, user, pw string, headers map[string]string) string {
	t.Helper()
	req := newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", jsonBody(t, api.LoginRequest{Username: user, Password: pw}))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", resp.StatusCode)
	}
	var got api.LoginResponse
	decodeJSON(t, resp, &got)
	return got.Token
}

func listSessions(t *testing.T, srv *httptest.Server, token string) []api.SessionResponse {
	t.Helper()
	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/sessions", token, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d", resp.StatusCode)
	}
	var out []api.SessionResponse
	decodeJSON(t, resp, &out)
	return out
}

func TestSessions_RequireAuth(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/sessions"},
		{http.MethodDelete, "/api/sessions/abc"},
		{http.MethodPost, "/api/sessions/terminate-others"},
	} {
		resp := mustDo(t, newJSONReq(t, tc.method, srv.URL+tc.path, "", nil))
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s = %d, want 401", tc.method, tc.path, resp.StatusCode)
		}
	}
}

func TestSessions_LoginRecordsDeviceAndMarksCurrent(t *testing.T) {
	srv := testServerWith(t, func(h *api.Handler) { h.Geo = stubGeo{} })
	defer srv.Close()
	middleware.TrustProxyHeaders = true
	t.Cleanup(func() { middleware.TrustProxyHeaders = false })

	registerAndLogin(t, srv, "devuser", "Password123!")
	desktop := loginAs(t, srv, "devuser", "Password123!", map[string]string{
		"X-Cove-Device":   "Cove Desktop on Windows 10",
		"X-Cove-App":      "Cove Desktop 0.9.0",
		"X-Forwarded-For": "203.0.113.7",
		"User-Agent":      chromeWindowsUA,
	})
	browser := loginAs(t, srv, "devuser", "Password123!", map[string]string{"User-Agent": chromeWindowsUA})

	list := listSessions(t, srv, desktop)
	if len(list) != 3 {
		t.Fatalf("sessions = %d, want 3", len(list))
	}
	var current, desktopRow, browserRow *api.SessionResponse
	for i := range list {
		if list[i].Current {
			current = &list[i]
		}
		switch list[i].DeviceName {
		case "Cove Desktop on Windows 10":
			desktopRow = &list[i]
		case "Chrome on Windows":
			browserRow = &list[i]
		}
	}
	if current == nil || desktopRow == nil || current.ID != desktopRow.ID {
		t.Fatalf("the requesting session must be flagged current: %+v", list)
	}
	if desktopRow.AppName != "Cove Desktop 0.9.0" || desktopRow.IP != "203.0.113.7" ||
		desktopRow.City != "Tehran" || desktopRow.Country != "Iran" {
		t.Errorf("desktop row = %+v", desktopRow)
	}
	if browserRow == nil {
		t.Errorf("browser session should get a device name parsed from its User-Agent: %+v", list)
	}
	_ = browser
}

func TestSessions_TerminateOneKicksThatTokenOnly(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	first := registerAndLogin(t, srv, "termuser", "Password123!")
	second := loginAs(t, srv, "termuser", "Password123!", nil)

	var secondID string
	for _, s := range listSessions(t, srv, first) {
		if !s.Current {
			secondID = s.ID
		}
	}
	resp := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/sessions/"+secondID, first, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("terminate status = %d", resp.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", second, nil)); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("terminated session still works: %d", r.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", first, nil)); r.StatusCode != http.StatusOK {
		t.Errorf("current session must survive: %d", r.StatusCode)
	}
}

func TestSessions_CannotTerminateAnotherUsersSession(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	alice := registerAndLogin(t, srv, "alice_s", "Password123!")
	bob := registerAndLogin(t, srv, "bob_s", "Password123!")

	aliceID := listSessions(t, srv, alice)[0].ID
	resp := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/sessions/"+aliceID, bob, nil))
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (must not reveal other users' sessions)", resp.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", alice, nil)); r.StatusCode != http.StatusOK {
		t.Error("alice's session was affected by bob")
	}
	if n := len(listSessions(t, srv, bob)); n != 1 {
		t.Errorf("bob sees %d sessions, want only his own", n)
	}
}

func TestSessions_TerminateOthersKeepsCurrent(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	keep := registerAndLogin(t, srv, "othersuser", "Password123!")
	other := loginAs(t, srv, "othersuser", "Password123!", nil)

	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/sessions/terminate-others", keep, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", other, nil)); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("other session should be gone: %d", r.StatusCode)
	}
	if n := len(listSessions(t, srv, keep)); n != 1 {
		t.Errorf("sessions left = %d, want 1", n)
	}
}

func TestSessions_PasswordChangeRevokesOtherSessions(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	current := registerAndLogin(t, srv, "pwduser", "Password123!")
	stale := loginAs(t, srv, "pwduser", "Password123!", nil)

	req := newJSONReq(t, http.MethodPatch, srv.URL+"/api/users/me", current, jsonBody(t, map[string]string{
		"old_password": "Password123!", "password": "NewPassword456!",
	}))
	if resp := mustDo(t, req); resp.StatusCode != http.StatusOK {
		t.Fatalf("password change status = %d", resp.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", stale, nil)); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("other sessions must be revoked after a password change: %d", r.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", current, nil)); r.StatusCode != http.StatusOK {
		t.Errorf("the session that changed the password must survive: %d", r.StatusCode)
	}
}

func TestSessions_TerminateClosesLiveWebSocket(t *testing.T) {
	srv, _, cleanup := setupWhisperTestServer(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	keep := registerAndLogin(t, srv, "wsuser", "Password123!")
	victim := loginAs(t, srv, "wsuser", "Password123!", nil)

	conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + victim}},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.CloseNow()

	var victimID string
	for _, s := range listSessions(t, srv, keep) {
		if !s.Current {
			victimID = s.ID
		}
	}
	mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/sessions/"+victimID, keep, nil))

	for {
		if _, _, err := conn.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("socket of a terminated session stayed open")
			}
			return // closed by the server, as required
		}
	}
}

func TestClientIP_HandlesIPv6AndForwardedList(t *testing.T) {
	middleware.TrustProxyHeaders = false
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "[2001:db8::1]:51234"
	if got := middleware.ClientIP(r); got != "2001:db8::1" {
		t.Errorf("ipv6 remote = %q", got)
	}

	middleware.TrustProxyHeaders = true
	t.Cleanup(func() { middleware.TrustProxyHeaders = false })
	r.Header.Set("X-Forwarded-For", " 198.51.100.4 , 10.0.0.1")
	if got := middleware.ClientIP(r); got != "198.51.100.4" {
		t.Errorf("xff = %q, want trimmed first hop", got)
	}
}
