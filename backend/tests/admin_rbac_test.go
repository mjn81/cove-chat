package tests

import (
	"net/http"
	"strings"
	"testing"
)

type accessLevel int

const (
	levelAdmin accessLevel = iota // admin and owner
	levelOwner                    // owner only
)

type adminRoute struct {
	method string
	path   string
	body   any
	level  accessLevel
}

// adminRoutes lists every /api/admin route with the role it requires. The
// RBAC matrix below runs each one as anonymous, member, admin and owner.
func adminRoutes() []adminRoute {
	pw := map[string]any{"password": testPassword}
	return []adminRoute{
		{"GET", "/api/admin/overview", nil, levelAdmin},
		{"GET", "/api/admin/config", nil, levelAdmin},
		{"PATCH", "/api/admin/config", map[string]any{"changes": map[string]any{}}, levelAdmin},
		{"GET", "/api/admin/invites", nil, levelAdmin},
		{"POST", "/api/admin/invites", map[string]any{"max_uses": 1}, levelAdmin},
		{"DELETE", "/api/admin/invites/NOSUCHCODE", nil, levelAdmin},
		{"GET", "/api/admin/audit", nil, levelAdmin},
		{"GET", "/api/admin/admins", nil, levelAdmin},
		{"PUT", "/api/admin/admins/nobody-here", pw, levelOwner},
		{"DELETE", "/api/admin/admins/nobody-here", pw, levelOwner},
		{"POST", "/api/admin/owner/transfer", map[string]any{"username": "nobody-here", "password": testPassword, "confirm": "TRANSFER"}, levelOwner},
		{"POST", "/api/admin/backup", map[string]any{"password": "wrong", "passphrase": "a-long-passphrase"}, levelOwner},
		{"POST", "/api/admin/restore", nil, levelOwner},
		{"POST", "/api/admin/reset", map[string]any{"password": "wrong", "confirm": "RESET"}, levelOwner},
		{"POST", "/api/admin/delete", map[string]any{"password": "wrong", "confirm": "chat.test"}, levelOwner},
	}
}

func errorCode(t *testing.T, resp *http.Response) string {
	t.Helper()
	var out struct {
		Error string `json:"error"`
	}
	readJSON(t, resp, &out)
	return out.Error
}

func TestAdminRoutesRBACMatrix(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, admin, member := e.seedRoles(t)

	for _, rt := range adminRoutes() {
		rt := rt
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			// Anonymous: never reaches the handler.
			if got := e.do(t, rt.method, rt.path, "", rt.body); got.StatusCode != http.StatusUnauthorized {
				t.Errorf("anonymous = %d, want 401", got.StatusCode)
			}
			// A plain member is refused with the role error, regardless of body.
			resp := e.do(t, rt.method, rt.path, member, rt.body)
			if resp.StatusCode != http.StatusForbidden || errorCode(t, resp) != "admin.errors.forbidden" {
				t.Errorf("member = %d, want 403 admin.errors.forbidden", resp.StatusCode)
			}

			// Admin: allowed on admin routes, refused on owner routes.
			resp = e.do(t, rt.method, rt.path, admin, rt.body)
			if rt.level == levelOwner {
				if resp.StatusCode != http.StatusForbidden || errorCode(t, resp) != "admin.errors.forbidden" {
					t.Errorf("admin on owner route = %d, want 403 admin.errors.forbidden", resp.StatusCode)
				}
			} else if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
				t.Errorf("admin on admin route = %d, want it to reach the handler", resp.StatusCode)
			} else {
				resp.Body.Close()
			}

			// Owner always reaches the handler (it may still reject the payload).
			resp = e.do(t, rt.method, rt.path, owner, rt.body)
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusUnauthorized || (resp.StatusCode == http.StatusForbidden && errorCodeOf(resp) == "admin.errors.forbidden") {
				t.Errorf("owner = %d, want it to reach the handler", resp.StatusCode)
			}
		})
	}
}

// errorCodeOf peeks the error code without consuming a reusable body.
func errorCodeOf(resp *http.Response) string {
	buf := make([]byte, 512)
	n, _ := resp.Body.Read(buf)
	s := string(buf[:n])
	if i := strings.Index(s, "admin.errors.forbidden"); i >= 0 {
		return "admin.errors.forbidden"
	}
	return ""
}

func TestUnknownAdminPathsAreGuardedToo(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, admin, member := e.seedRoles(t)

	if got := e.do(t, "GET", "/api/admin/some-future-route", "", nil); got.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous on unregistered admin path = %d, want 401", got.StatusCode)
	}
	if got := e.do(t, "GET", "/api/admin/some-future-route", member, nil); got.StatusCode != http.StatusForbidden {
		t.Errorf("member on unregistered admin path = %d, want 403", got.StatusCode)
	}
	if got := e.do(t, "GET", "/api/admin/some-future-route", admin, nil); got.StatusCode != http.StatusNotFound {
		t.Errorf("admin on unregistered admin path = %d, want 404", got.StatusCode)
	}
}

func TestRevokingAnAdminTakesEffectOnTheNextRequest(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, admin, _ := e.seedRoles(t)

	if got := e.do(t, "GET", "/api/admin/overview", admin, nil); got.StatusCode != http.StatusOK {
		t.Fatalf("admin before revoke = %d, want 200", got.StatusCode)
	}
	resp := e.do(t, "DELETE", "/api/admin/admins/admin", owner, map[string]any{"password": testPassword})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", resp.StatusCode)
	}
	// Same token, no re-login: the role is read from the database on every request.
	if got := e.do(t, "GET", "/api/admin/overview", admin, nil); got.StatusCode != http.StatusForbidden {
		t.Errorf("revoked admin = %d, want 403", got.StatusCode)
	}
}

func TestServerRoleCannotBeSetThroughTheProfileEndpoint(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)

	resp := e.do(t, "PATCH", "/api/users/me", member, map[string]any{"server_role": "owner", "custom_msg": "hi"})
	resp.Body.Close()

	u, _ := e.store.GetUserByUsername("member")
	if u.ServerRole != "" {
		t.Fatalf("member escalated to %q through PATCH /api/users/me", u.ServerRole)
	}
	if got := e.do(t, "GET", "/api/admin/overview", member, nil); got.StatusCode != http.StatusForbidden {
		t.Errorf("member overview = %d, want 403", got.StatusCode)
	}
}

func TestServerRoleIsOnlyVisibleToTheAccountItself(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, member := e.seedRoles(t)
	ownerID := e.userID(t, "owner")

	body := func(path, token string) string {
		resp := e.do(t, "GET", path, token, nil)
		defer resp.Body.Close()
		buf := make([]byte, 4096)
		n, _ := resp.Body.Read(buf)
		return string(buf[:n])
	}
	if !strings.Contains(body("/api/me", owner), `"server_role":"owner"`) {
		t.Error("/api/me should show the caller their own role")
	}
	for _, path := range []string{"/api/users/" + ownerID, "/api/users?q=owner", "/api/users?query=owner"} {
		if strings.Contains(body(path, member), "server_role") {
			t.Errorf("%s leaks server_role to another user", path)
		}
	}
}

func TestOwnerCannotDeleteTheirAccountButMembersCan(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, member := e.seedRoles(t)

	if got := e.do(t, "DELETE", "/api/users/me", owner, nil); got.StatusCode != http.StatusForbidden {
		t.Errorf("owner delete = %d, want 403 (transfer ownership first)", got.StatusCode)
	}
	if got := e.do(t, "DELETE", "/api/users/me", member, nil); got.StatusCode != http.StatusOK {
		t.Errorf("member delete = %d, want 200", got.StatusCode)
	}
}
