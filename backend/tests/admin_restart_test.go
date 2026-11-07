package tests

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/update"
)

// restartCalled reports whether the Restart hook ran within a short window.
func restartCalled(u *updateEnv, wait time.Duration) bool {
	select {
	case <-u.restart:
		return true
	case <-time.After(wait):
		return false
	}
}

func TestRestartHappyPathRestartsOnceAfterResponding(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.updater.RestartDelay = 10 * time.Millisecond
	resp := u.do(t, "POST", "/api/admin/restart", u.owner, ownerPW)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST = %d, want 202", resp.StatusCode)
	}
	var out api.StatusResponse
	readJSON(t, resp, &out)
	if out.Status != "success" {
		t.Errorf("body = %+v", out)
	}
	if !restartCalled(u, 2*time.Second) {
		t.Fatal("restart hook was not called")
	}
	if restartCalled(u, 100*time.Millisecond) {
		t.Error("restart hook called more than once")
	}
	if actions := strings.Join(u.auditActions(t), ","); !strings.Contains(actions, "server.restart") {
		t.Errorf("audit log %q is missing server.restart", actions)
	}
}

func TestRestartWrongOrMissingPassword(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	for name, body := range map[string]any{
		"wrong":   map[string]any{"password": "not-the-password"},
		"missing": map[string]any{},
		"empty":   nil,
	} {
		resp := u.do(t, "POST", "/api/admin/restart", u.owner, body)
		if resp.StatusCode == http.StatusAccepted || resp.StatusCode < 400 || resp.StatusCode >= 500 {
			t.Errorf("%s password: status %d, want 4xx", name, resp.StatusCode)
		}
	}
	if restartCalled(u, 100*time.Millisecond) {
		t.Error("restart ran without a valid password")
	}
}

func TestRestartRequiresOwnerAndAuth(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	for name, tc := range map[string]struct {
		tok  string
		want int
	}{"anonymous": {"", http.StatusUnauthorized}, "member": {u.member, http.StatusForbidden}, "admin": {u.admin, http.StatusForbidden}} {
		if got := u.do(t, "POST", "/api/admin/restart", tc.tok, ownerPW); got.StatusCode != tc.want {
			t.Errorf("%s = %d, want %d", name, got.StatusCode, tc.want)
		}
	}
	if restartCalled(u, 100*time.Millisecond) {
		t.Error("restart ran for an unauthorized caller")
	}
}

func TestRestartRefusedWhenInstallCannotRestartItself(t *testing.T) {
	cases := map[string]struct {
		mode update.InstallMode
		key  string
	}{
		"docker":  {update.ModeDocker, "admin.errors.restart_docker"},
		"unknown": {update.ModeUnknown, "admin.errors.restart_unsupported"},
	}
	for name, tc := range cases {
		u := newUpdateEnv(t, tc.mode, nil)
		resp := u.do(t, "POST", "/api/admin/restart", u.owner, ownerPW)
		if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != tc.key {
			t.Errorf("%s: status %d, want 409 %s", name, resp.StatusCode, tc.key)
		}
		if restartCalled(u, 100*time.Millisecond) {
			t.Errorf("%s: restart ran", name)
		}
	}
}

func TestRestartWithoutUpdaterIsUnsupported(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)
	if got := e.do(t, "POST", "/api/admin/restart", owner, ownerPW); got.StatusCode != http.StatusNotImplemented {
		t.Errorf("POST = %d, want 501", got.StatusCode)
	}
}

func TestUpdateInfoReportsCanRestart(t *testing.T) {
	if in := newUpdateEnv(t, update.ModeBinary, nil); !in.info(t, in.owner, "").CanRestart {
		t.Error("binary install should report can_restart")
	}
	if in := newUpdateEnv(t, update.ModeDocker, nil); in.info(t, in.owner, "").CanRestart {
		t.Error("docker install must not report can_restart")
	}
}
