package tests

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

type configSetting struct {
	Key             string `json:"key"`
	Type            string `json:"type"`
	Value           any    `json:"value"`
	OwnerOnly       bool   `json:"owner_only"`
	RestartRequired bool   `json:"restart_required"`
}

func settingsByKey(t *testing.T, e *adminEnv, token string) map[string]configSetting {
	t.Helper()
	resp := e.do(t, "GET", "/api/admin/config", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET config = %d", resp.StatusCode)
	}
	var out struct {
		Settings []configSetting `json:"settings"`
	}
	readJSON(t, resp, &out)
	m := map[string]configSetting{}
	for _, s := range out.Settings {
		m[s.Key] = s
	}
	return m
}

func TestConfigEndpointNeverExposesSecrets(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	resp := e.do(t, "GET", "/api/admin/config", owner, nil)
	raw := make([]byte, 1<<16)
	n, _ := resp.Body.Read(raw)
	resp.Body.Close()
	body := strings.ToLower(string(raw[:n]))
	for _, secret := range []string{"master_password", "turn_shared_secret", "secret_key", "access_key", "database.path", "upload_dir"} {
		if strings.Contains(body, secret) {
			t.Errorf("config response mentions %q", secret)
		}
	}
}

func TestConfigPatchWritesTheFileKeepsCommentsAndAppliesLive(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, _ := e.seedRoles(t)

	resp := e.do(t, "PATCH", "/api/admin/config", admin, map[string]any{
		"changes": map[string]any{"registration.mode": "invite_only", "server.max_file_size_mb": 321},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH config = %d", resp.StatusCode)
	}
	resp.Body.Close()

	raw, _ := os.ReadFile(e.configPath)
	text := string(raw)
	if !strings.Contains(text, "# test config") {
		t.Error("comment lost from the config file")
	}
	if !strings.Contains(text, `mode = "invite_only"`) || !strings.Contains(text, "max_file_size_mb = 321") {
		t.Errorf("changes not written to the file:\n%s", text)
	}

	// Registration mode is hot: the very next sign-up already follows it.
	var info struct {
		RegistrationMode string `json:"registration_mode"`
	}
	readJSON(t, e.do(t, "GET", "/api/server-info", "", nil), &info)
	if info.RegistrationMode != "invite_only" {
		t.Errorf("server-info mode = %q after PATCH, want invite_only", info.RegistrationMode)
	}
	if code := e.register(t, "walkin", ""); code != http.StatusForbidden {
		t.Errorf("sign-up without a code after switching to invite_only = %d, want 403", code)
	}
	if got := e.settings.RegistrationMode(); got != "invite_only" {
		t.Errorf("live setting = %q", got)
	}
}

func TestConfigPatchValidation(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, admin, _ := e.seedRoles(t)
	before, _ := os.ReadFile(e.configPath)

	bad := []map[string]any{
		{"registration.mode": "sometimes"},               // not an allowed value
		{"server.max_file_size_mb": -5},                  // below the minimum
		{"server.max_file_size_mb": "huge"},              // wrong type
		{"security.master_password": "hacked"},           // secret: not editable
		{"database.path": "/etc"},                        // path: not editable
		{"totally.unknown": 1},                           // unknown key
		{"registration.mode": "closed", "voice.mode": 5}, // one bad value rejects the whole request
	}
	for _, changes := range bad {
		resp := e.do(t, "PATCH", "/api/admin/config", owner, map[string]any{"changes": changes})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("PATCH %v = %d, want 400", changes, resp.StatusCode)
		}
		resp.Body.Close()
	}
	after, _ := os.ReadFile(e.configPath)
	if string(before) != string(after) {
		t.Errorf("a rejected request modified the config file")
	}
	if e.settings.RegistrationMode() != "open" {
		t.Errorf("a rejected request changed the live registration mode")
	}

	// Owner-only keys: an admin is refused, the owner needs the password.
	resp := e.do(t, "PATCH", "/api/admin/config", admin, map[string]any{"changes": map[string]any{"server.frontend_origin": "https://x.test"}})
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("admin editing an owner-only key = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
	resp = e.do(t, "PATCH", "/api/admin/config", owner, map[string]any{"changes": map[string]any{"server.frontend_origin": "https://x.test"}})
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("owner editing an owner-only key without a password = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
	resp = e.do(t, "PATCH", "/api/admin/config", owner, map[string]any{"password": testPassword, "changes": map[string]any{"server.frontend_origin": "https://x.test"}})
	if resp.StatusCode != http.StatusOK {
		t.Errorf("owner with password editing an owner-only key = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestConfigSchemaMarksRestartAndOwnerOnlyKeys(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)
	m := settingsByKey(t, e, owner)

	if m["registration.mode"].Type != "enum" || m["registration.mode"].RestartRequired {
		t.Errorf("registration.mode should be a live enum: %+v", m["registration.mode"])
	}
	if !m["server.frontend_origin"].OwnerOnly {
		t.Errorf("server.frontend_origin should be owner-only")
	}
	if !m["rate_limit.global_rps"].RestartRequired {
		t.Errorf("rate_limit.global_rps needs a restart")
	}
}

// ---- Invites ---------------------------------------------------------------

type inviteView struct {
	Code      string  `json:"code"`
	MaxUses   int     `json:"max_uses"`
	Uses      int     `json:"uses"`
	ExpiresAt *string `json:"expires_at"`
	Status    string  `json:"status"`
	Source    string  `json:"source"`
}

func TestInviteLifecycleThroughTheAPI(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	_, admin, _ := e.seedRoles(t)

	expires := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	var limited, unlimited inviteView
	resp := e.do(t, "POST", "/api/admin/invites", admin, map[string]any{"max_uses": 2, "expires_at": expires, "note": "friends"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create limited = %d, want 201", resp.StatusCode)
	}
	readJSON(t, resp, &limited)
	resp = e.do(t, "POST", "/api/admin/invites", admin, map[string]any{"max_uses": 0, "code": "OPEN-FOR-ALL-2026"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create unlimited = %d, want 201", resp.StatusCode)
	}
	readJSON(t, resp, &unlimited)

	if len(limited.Code) != 16 || limited.MaxUses != 2 || limited.ExpiresAt == nil || limited.Status != "active" {
		t.Errorf("limited invite = %+v", limited)
	}
	if unlimited.Code != "OPEN-FOR-ALL-2026" || unlimited.MaxUses != 0 || unlimited.ExpiresAt != nil {
		t.Errorf("unlimited invite = %+v", unlimited)
	}

	// Both work for sign-ups and the counters show it.
	if code := e.register(t, "friendone", limited.Code); code != http.StatusCreated {
		t.Fatalf("sign-up with limited invite = %d", code)
	}
	e.register(t, "friendtwo", limited.Code)
	if code := e.register(t, "friendthree", limited.Code); code != http.StatusForbidden {
		t.Errorf("third use of a 2-use invite = %d, want 403", code)
	}

	var list struct {
		Invites []inviteView `json:"invites"`
	}
	readJSON(t, e.do(t, "GET", "/api/admin/invites", admin, nil), &list)
	statuses := map[string]inviteView{}
	for _, inv := range list.Invites {
		statuses[inv.Code] = inv
	}
	if statuses[limited.Code].Uses != 2 || statuses[limited.Code].Status != "exhausted" {
		t.Errorf("limited after use = %+v, want 2 uses / exhausted", statuses[limited.Code])
	}

	// Revoking stops the unlimited code immediately.
	resp = e.do(t, "DELETE", "/api/admin/invites/"+unlimited.Code, admin, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	if code := e.register(t, "toolate", unlimited.Code); code != http.StatusForbidden {
		t.Errorf("sign-up with a revoked invite = %d, want 403", code)
	}
}

func TestInviteCreationValidation(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	_, admin, _ := e.seedRoles(t)

	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	cases := []map[string]any{
		{"max_uses": -1},                        // negative
		{"max_uses": 1, "expires_at": past},     // already expired
		{"max_uses": 1, "expires_at": "soon"},   // not a date
		{"max_uses": 1, "code": "abc"},          // too short to be safe
		{"max_uses": 1, "code": "has spaces!!"}, // illegal characters
	}
	for _, body := range cases {
		resp := e.do(t, "POST", "/api/admin/invites", admin, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("create %v = %d, want 400", body, resp.StatusCode)
		}
		resp.Body.Close()
	}

	resp := e.do(t, "POST", "/api/admin/invites", admin, map[string]any{"max_uses": 1, "code": "DUPLICATE-CODE-1"})
	resp.Body.Close()
	resp = e.do(t, "POST", "/api/admin/invites", admin, map[string]any{"max_uses": 1, "code": "DUPLICATE-CODE-1"})
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("duplicate code = %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()
}

// ---- Admins, ownership, audit ------------------------------------------------

func TestOwnerManagesAdminsWithAPassword(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)
	e.mustRegister(t, "newbie")

	resp := e.do(t, "PUT", "/api/admin/admins/newbie", owner, map[string]any{"password": "wrong-password"})
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("grant with a wrong password = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
	if u, _ := e.store.GetUserByUsername("newbie"); u.ServerRole != "" {
		t.Fatalf("role changed despite the wrong password")
	}

	resp = e.do(t, "PUT", "/api/admin/admins/ghost", owner, map[string]any{"password": testPassword})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("grant to an unknown user = %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()

	resp = e.do(t, "PUT", "/api/admin/admins/newbie", owner, map[string]any{"password": testPassword})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("grant = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	if u, _ := e.store.GetUserByUsername("newbie"); u.ServerRole != "admin" {
		t.Errorf("newbie role = %q, want admin", u.ServerRole)
	}

	var list struct {
		Admins []struct {
			Username string `json:"username"`
			Role     string `json:"role"`
		} `json:"admins"`
	}
	readJSON(t, e.do(t, "GET", "/api/admin/admins", owner, nil), &list)
	if len(list.Admins) != 3 { // owner, admin, newbie
		t.Errorf("admins = %+v, want 3", list.Admins)
	}
}

func TestOwnerRoleCannotBeRemovedOrGivenAway(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	for _, method := range []string{"PUT", "DELETE"} {
		resp := e.do(t, method, "/api/admin/admins/owner", owner, map[string]any{"password": testPassword})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s on the owner = %d, want 400", method, resp.StatusCode)
		}
		resp.Body.Close()
	}
	if u, _ := e.store.GetUserByUsername("owner"); u.ServerRole != "owner" {
		t.Errorf("owner role changed to %q", u.ServerRole)
	}
}

func TestOwnershipTransfer(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, admin, _ := e.seedRoles(t)

	// Missing phrase and wrong password are both refused with no side effect.
	for _, body := range []map[string]any{
		{"username": "admin", "password": testPassword},
		{"username": "admin", "password": "nope", "confirm": "TRANSFER"},
	} {
		resp := e.do(t, "POST", "/api/admin/owner/transfer", owner, body)
		if resp.StatusCode != http.StatusForbidden && resp.StatusCode != http.StatusBadRequest {
			t.Errorf("transfer %v = %d, want 400/403", body, resp.StatusCode)
		}
		resp.Body.Close()
	}
	if u, _ := e.store.GetUserByUsername("owner"); u.ServerRole != "owner" {
		t.Fatalf("a refused transfer changed the owner")
	}

	resp := e.do(t, "POST", "/api/admin/owner/transfer", owner, map[string]any{"username": "admin", "password": testPassword, "confirm": "TRANSFER"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("transfer = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	o, _ := e.store.GetUserByUsername("owner")
	a, _ := e.store.GetUserByUsername("admin")
	if o.ServerRole != "admin" || a.ServerRole != "owner" {
		t.Errorf("after transfer roles = %q/%q, want admin/owner", o.ServerRole, a.ServerRole)
	}
	// The new owner can use owner routes; the old one can no longer.
	if got := e.do(t, "GET", "/api/admin/admins", admin, nil); got.StatusCode != http.StatusOK {
		t.Errorf("new owner list admins = %d", got.StatusCode)
	}
	resp = e.do(t, "PUT", "/api/admin/admins/member", owner, map[string]any{"password": testPassword})
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("former owner on an owner route = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAuditLogRecordsAdminActions(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, admin, _ := e.seedRoles(t)

	e.do(t, "POST", "/api/admin/invites", admin, map[string]any{"max_uses": 1, "code": "AUDITED-CODE-001"}).Body.Close()
	e.do(t, "PATCH", "/api/admin/config", admin, map[string]any{"changes": map[string]any{"registration.mode": "closed"}}).Body.Close()

	var out struct {
		Entries []struct {
			Action    string `json:"action"`
			ActorName string `json:"actor_name"`
			Target    string `json:"target"`
		} `json:"entries"`
	}
	readJSON(t, e.do(t, "GET", "/api/admin/audit", owner, nil), &out)

	seen := map[string]bool{}
	for _, en := range out.Entries {
		seen[en.Action] = true
		if strings.Contains(en.Target, testPassword) {
			t.Errorf("audit entry leaks a secret: %+v", en)
		}
	}
	for _, want := range []string{"admin.grant", "invite.create", "config.update"} {
		if !seen[want] {
			t.Errorf("audit log has no %q entry: %+v", want, out.Entries)
		}
	}
}

func TestOverviewReportsBasicCounts(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, _ := e.seedRoles(t)

	var ov struct {
		Users            int    `json:"users"`
		Channels         int    `json:"channels"`
		RegistrationMode string `json:"registration_mode"`
		Version          string `json:"version"`
		Domain           string `json:"domain"`
	}
	readJSON(t, e.do(t, "GET", "/api/admin/overview", admin, nil), &ov)
	if ov.Users != 3 || ov.RegistrationMode != "open" || ov.Version == "" || ov.Domain != "chat.test" {
		t.Errorf("overview = %+v", ov)
	}
}
