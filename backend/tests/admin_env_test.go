package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"nodetalk/backend/internal/api"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/crypto"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
)

const testPassword = "correct-horse-battery"

// adminEnv is a full server (real BadgerDB in a temp dir, real config file)
// for registration and admin-panel tests.
type adminEnv struct {
	srv        *httptest.Server
	store      *store.Store
	handler    *api.Handler
	settings   *api.Settings
	configPath string
	dataDir    string
	stopped    chan struct{}
	stopOnce   sync.Once
}

// newAdminEnv starts a server whose registration mode is `mode`.
func newAdminEnv(t *testing.T, mode string) *adminEnv {
	t.Helper()
	dir := t.TempDir()

	kek := crypto.DeriveKEK("test-master-password")
	dek, err := db.BootstrapDEK(filepath.Join(dir, "meta"), kek)
	if err != nil {
		t.Fatalf("BootstrapDEK: %v", err)
	}
	database, err := db.Open(filepath.Join(dir, "main"), dek)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	cfgPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(cfgPath, []byte("# test config\n[registration]\nmode = \""+mode+"\"\n"), 0600); err != nil {
		t.Fatal(err)
	}

	env := &adminEnv{stopped: make(chan struct{}), configPath: cfgPath, dataDir: dir}
	env.store = store.New(database)
	env.settings = api.NewSettings(api.SettingsInit{
		RegistrationMode:    mode,
		MaxFileSizeMB:       10,
		MaxVideoSizeMB:      50,
		MaxVideoDurationSec: 60,
	})
	tokenTTL := 24 * time.Hour
	env.handler = &api.Handler{
		Store:         env.store,
		Sessions:      auth.NewSessionStore(tokenTTL),
		KEK:           kek,
		Storage:       &storage.FileSystemStorage{BaseDir: filepath.Join(dir, "uploads")},
		TokenTTL:      tokenTTL,
		MaxFileSizeMB: 10,
		Settings:      env.settings,
		ConfigPath:    cfgPath,
		DataDir:       dir,
		ServerDomain:  "chat.test",
		Shutdown:      func() { env.stopOnce.Do(func() { close(env.stopped) }) },
	}
	env.srv = httptest.NewServer(api.NewRouter(env.handler, 1000, 1000))
	t.Cleanup(env.srv.Close)
	return env
}

// do sends a JSON request, optionally authenticated with a bearer token.
func (e *adminEnv) do(t *testing.T, method, path, token string, body any) *http.Response {
	t.Helper()
	var buf = jsonBody(t, body)
	if body == nil {
		buf = jsonBody(t, struct{}{})
	}
	req, err := http.NewRequest(method, e.srv.URL+path, buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

// register attempts a sign-up and returns the HTTP status.
func (e *adminEnv) register(t *testing.T, username, inviteCode string) int {
	t.Helper()
	body := map[string]string{"username": username, "password": testPassword}
	if inviteCode != "" {
		body["invite_code"] = inviteCode
	}
	resp := e.do(t, "POST", "/api/register", "", body)
	defer resp.Body.Close()
	return resp.StatusCode
}

// mustRegister registers and fails the test if the server refuses.
func (e *adminEnv) mustRegister(t *testing.T, username string) {
	t.Helper()
	if code := e.register(t, username, ""); code != http.StatusCreated {
		t.Fatalf("register %s = %d, want 201", username, code)
	}
}

// login returns a bearer token.
func (e *adminEnv) login(t *testing.T, username string) string {
	t.Helper()
	resp := e.do(t, "POST", "/api/login", "", map[string]string{"username": username, "password": testPassword})
	var out struct {
		Token string `json:"token"`
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s = %d", username, resp.StatusCode)
	}
	decodeJSON(t, resp, &out)
	return out.Token
}

// userID looks a user up by name.
func (e *adminEnv) userID(t *testing.T, username string) string {
	t.Helper()
	u, err := e.store.GetUserByUsername(username)
	if err != nil || u == nil {
		t.Fatalf("user %s not found: %v", username, err)
	}
	return u.ID
}

// seedRoles creates owner "owner", admin "admin", plain member "member" and
// returns their tokens (owner first, so the first-user rule makes them owner).
func (e *adminEnv) seedRoles(t *testing.T) (owner, admin, member string) {
	t.Helper()
	e.mustRegister(t, "owner")
	// The remaining accounts are created in the store so seeding works in
	// every registration mode (invite-only and closed refuse open sign-ups).
	for _, name := range []string{"admin", "member"} {
		if _, err := e.store.CreateUser(name, testPassword, "chat.test"); err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}
	owner = e.login(t, "owner")
	resp := e.do(t, "PUT", "/api/admin/admins/admin", owner, map[string]string{"password": testPassword})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("grant admin = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	return owner, e.login(t, "admin"), e.login(t, "member")
}

func readJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decode: %v", err)
	}
}
