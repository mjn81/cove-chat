package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"

	"cove/backend/internal/auth"
	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/store"
	"cove/backend/internal/ws"
)

// prodHub is a production-mode hub (no dev origin bypass) that only lists a web origin, like a real deployment.
func prodHub(t *testing.T) (srv *httptest.Server, token string) {
	t.Helper()
	dir := t.TempDir()
	kek := crypto.DeriveKEK("ws-origin-test")
	dek, err := db.BootstrapDEK(dir+"/meta", kek)
	if err != nil {
		t.Fatalf("bootstrap dek: %v", err)
	}
	database, err := db.Open(dir+"/main", dek)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	dataStore := store.New(database)
	sessions := auth.NewSessionStore(time.Hour)
	hub := ws.NewHub(dataStore, sessions, kek, false, "https://chat.example.test")

	u, err := dataStore.CreateUser("origin_user", "password-123", "localhost")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token, err = sessions.Create(u.ID, u.Username)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/ws", hub)
	srv = httptest.NewServer(mux)
	t.Cleanup(func() {
		srv.Close()
		hub.Close()
		_ = database.Close()
	})
	return srv, token
}

func dialWithOrigin(t *testing.T, srv *httptest.Server, token, origin string) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h := http.Header{"Authorization": []string{"Bearer " + token}}
	if origin != "" {
		h.Set("Origin", origin)
	}
	conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{HTTPHeader: h})
	if err == nil {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}
	return err
}

// The desktop shell connects with its own origin, which is never the server's frontend_origin. REST already
// allows it (CORS); the WebSocket must too, or the desktop app logs in but stays offline and cannot decrypt.
func TestWS_ProductionAcceptsDesktopOriginsAndConfiguredWebOrigin(t *testing.T) {
	srv, token := prodHub(t)
	for _, origin := range []string{
		"https://chat.example.test", // the configured web origin
		"http://wails.localhost",    // desktop on Windows
		"https://wails.localhost",   // desktop on newer WebView2 setups
		"wails://wails.localhost",   // desktop on macOS and Linux
		"",                          // native clients (Android) send no Origin
	} {
		if err := dialWithOrigin(t, srv, token, origin); err != nil {
			t.Errorf("origin %q should be accepted: %v", origin, err)
		}
	}
}

func TestWS_ProductionStillRejectsForeignOrigins(t *testing.T) {
	srv, token := prodHub(t)
	for _, origin := range []string{"https://evil.example", "http://localhost:34115", "http://wails.localhost.evil.example"} {
		if err := dialWithOrigin(t, srv, token, origin); err == nil {
			t.Errorf("origin %q must be rejected", origin)
		}
	}
}
