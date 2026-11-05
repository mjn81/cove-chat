package tests

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/update"
)

const (
	updOld = "OLD BINARY"
	updNew = "NEW BINARY"
)

type updateEnv struct {
	*adminEnv
	gh      *fakeGitHub
	updater *api.Updater
	exe     string
	restart chan struct{}
	owner   string
	admin   string
	member  string
}

// newUpdateEnv wires a fake GitHub (one pre-release v1.0.0 with a linux/amd64 server zip) and a temp
// "executable" into the admin test server. The platform is pinned so the test is identical on every OS.
func newUpdateEnv(t *testing.T, mode update.InstallMode, sums []byte) *updateEnv {
	t.Helper()
	e := newAdminEnv(t, "open")
	u := &updateEnv{adminEnv: e, restart: make(chan struct{}, 1)}
	u.owner, u.admin, u.member = e.seedRoles(t)

	zipBytes := makeZip(t, map[string][]byte{"cove-server-linux-amd64": []byte(updNew)})
	u.gh = newFakeGitHub(t)
	u.gh.publish("v1.0.0", true, map[string][]byte{"cove-server-linux-amd64.zip": zipBytes}, sums)

	u.exe = filepath.Join(t.TempDir(), "cove-server")
	if err := os.WriteFile(u.exe, []byte(updOld), 0o755); err != nil {
		t.Fatal(err)
	}
	u.updater = &api.Updater{
		Client:      u.gh.client(),
		Current:     "0.9.9",
		ExePath:     u.exe,
		GOOS:        "linux",
		GOARCH:      "amd64",
		Mode:        mode,
		Restart:     func() { u.restart <- struct{}{} },
		MaxDownload: 1 << 20,
		CacheTTL:    time.Minute,
	}
	e.handler.Updater = u.updater
	return u
}

func (u *updateEnv) info(t *testing.T, token, query string) api.UpdateInfoResponse {
	t.Helper()
	resp := u.do(t, "GET", "/api/admin/update"+query, token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/admin/update = %d", resp.StatusCode)
	}
	var out api.UpdateInfoResponse
	readJSON(t, resp, &out)
	return out
}

// waitState polls until the job reaches one of the states.
func (u *updateEnv) waitState(t *testing.T, states ...string) api.UpdateInfoResponse {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		in := u.info(t, u.owner, "")
		for _, s := range states {
			if in.State == s {
				return in
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("update never reached %v", states)
	return api.UpdateInfoResponse{}
}

func (u *updateEnv) readExe(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(u.exe)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func (u *updateEnv) auditActions(t *testing.T) []string {
	t.Helper()
	resp := u.do(t, "GET", "/api/admin/audit", u.owner, nil)
	var out api.AuditListResponse
	readJSON(t, resp, &out)
	var actions []string
	for _, en := range out.Items {
		actions = append(actions, en.Action)
	}
	return actions
}

func TestUpdateInfoReportsLatestAndCapability(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	for _, tok := range []string{u.admin, u.owner} {
		in := u.info(t, tok, "")
		if in.CurrentVersion != "0.9.9" || in.LatestVersion != "1.0.0" || !in.UpdateAvailable {
			t.Fatalf("versions = %+v", in)
		}
		if in.ReleaseNotes != "notes for v1.0.0" || !in.Prerelease {
			t.Errorf("release metadata = %+v", in)
		}
		if in.Mode != "binary" || !in.CanUpdate || in.Reason != "" || in.State != api.UpdateStateIdle {
			t.Errorf("capability = %+v", in)
		}
	}
}

func TestUpdateInfoIsUpToDateWhenNothingNewer(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.updater.Current = "1.0.0"
	u.updater.IncludePrerelease = true // a stable 1.x build only sees the v1.0.0 pre-release when opted in
	in := u.info(t, u.owner, "")
	if in.UpdateAvailable || in.CanUpdate || in.Reason != "up_to_date" || in.LatestVersion != "1.0.0" {
		t.Errorf("info = %+v", in)
	}
}

func TestUpdateInfoSurvivesGitHubOutage(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.gh.srv.Close()
	in := u.info(t, u.owner, "")
	if in.CheckError != "admin.errors.update_check_failed" || in.UpdateAvailable || in.Mode != "binary" {
		t.Errorf("info = %+v", in)
	}
}

func TestUpdateDockerModeNeverSelfReplaces(t *testing.T) {
	u := newUpdateEnv(t, update.ModeDocker, nil)
	in := u.info(t, u.owner, "")
	if in.Mode != "docker" || in.CanUpdate || in.Reason != "docker" || in.Instructions != "docker compose pull && docker compose up -d" {
		t.Fatalf("docker info = %+v", in)
	}
	resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
	if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "admin.errors.update_docker" {
		t.Fatalf("docker POST = %d, want 409 admin.errors.update_docker", resp.StatusCode)
	}
	if u.readExe(t) != updOld {
		t.Error("docker mode touched the binary")
	}
	select {
	case <-u.restart:
		t.Error("docker mode restarted the process")
	default:
	}
}

func TestUpdateUnknownModeIsRefused(t *testing.T) {
	u := newUpdateEnv(t, update.ModeUnknown, nil)
	if in := u.info(t, u.owner, ""); in.CanUpdate || in.Reason != "unsupported" {
		t.Errorf("info = %+v", in)
	}
	resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
	if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "admin.errors.update_unsupported" {
		t.Errorf("POST = %d", resp.StatusCode)
	}
}

func TestUpdateRequiresOwnerAndAuth(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	if got := u.do(t, "GET", "/api/admin/update", "", nil); got.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous GET = %d, want 401", got.StatusCode)
	}
	if got := u.do(t, "GET", "/api/admin/update", u.member, nil); got.StatusCode != http.StatusForbidden {
		t.Errorf("member GET = %d, want 403", got.StatusCode)
	}
	for name, tok := range map[string]string{"anonymous": "", "member": u.member, "admin": u.admin} {
		want := http.StatusForbidden
		if tok == "" {
			want = http.StatusUnauthorized
		}
		if got := u.do(t, "POST", "/api/admin/update", tok, nil); got.StatusCode != want {
			t.Errorf("%s POST = %d, want %d", name, got.StatusCode, want)
		}
	}
	if u.readExe(t) != updOld {
		t.Error("an unauthorized request changed the binary")
	}
}

func TestUpdateHappyPathSwapsBinaryAndRestarts(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST = %d, want 202", resp.StatusCode)
	}
	var started api.UpdateStartResponse
	readJSON(t, resp, &started)
	if started.Version != "1.0.0" {
		t.Errorf("started = %+v", started)
	}

	u.waitState(t, api.UpdateStateRestarting)
	select {
	case <-u.restart:
	case <-time.After(5 * time.Second):
		t.Fatal("Restart was never called")
	}
	if got := u.readExe(t); got != updNew {
		t.Errorf("binary = %q, want the new one", got)
	}
	if b, _ := os.ReadFile(u.exe + ".old"); string(b) != updOld {
		t.Errorf(".old = %q, want the previous binary for rollback", b)
	}
	if _, err := os.Stat(u.exe + ".new"); err == nil {
		t.Error("staging file .new left behind")
	}

	actions := strings.Join(u.auditActions(t), ",")
	for _, want := range []string{"server.update.start", "server.update.installed"} {
		if !strings.Contains(actions, want) {
			t.Errorf("audit log %q is missing %s", actions, want)
		}
	}

	// A second click while restarting is refused rather than starting another job.
	again := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
	if again.StatusCode != http.StatusConflict {
		t.Errorf("POST while restarting = %d, want 409", again.StatusCode)
	}
}

func TestUpdateChecksumMismatchAbortsBeforeReplacing(t *testing.T) {
	bad := []byte(strings.Repeat("0", 64) + "  cove-server-linux-amd64.zip\n")
	u := newUpdateEnv(t, update.ModeBinary, bad)
	if resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW); resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST = %d, want 202", resp.StatusCode)
	}
	in := u.waitState(t, api.UpdateStateFailed)
	if in.Error != "admin.errors.update_checksum_failed" {
		t.Errorf("error = %q", in.Error)
	}
	if u.readExe(t) != updOld {
		t.Error("binary changed despite a bad checksum")
	}
	if _, err := os.Stat(u.exe + ".old"); err == nil {
		t.Error("a refused update must not create .old")
	}
	select {
	case <-u.restart:
		t.Error("restarted after a failed update")
	default:
	}
	if actions := strings.Join(u.auditActions(t), ","); !strings.Contains(actions, "server.update.failed") {
		t.Errorf("audit log %q is missing server.update.failed", actions)
	}
}

func TestUpdateMissingSumsAbortsToo(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, []byte("-")) // "-" = publish without SHA256SUMS
	// Without SHA256SUMS the release is not even offered: the platform check requires it.
	if in := u.info(t, u.owner, ""); in.UpdateAvailable {
		t.Errorf("a release without SHA256SUMS was offered: %+v", in)
	}
	resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("POST = %d, want 409", resp.StatusCode)
	}
	if u.readExe(t) != updOld {
		t.Error("binary changed")
	}
}

func TestUpdateRefusesDowngradeAndSameVersion(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	for _, cur := range []string{"1.0.0", "2.0.0"} {
		u.updater.Current = cur
		resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
		if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "admin.errors.update_up_to_date" {
			t.Errorf("current %s: POST = %d, want 409 up_to_date", cur, resp.StatusCode)
		}
	}
	if u.readExe(t) != updOld {
		t.Error("binary changed")
	}
}

func TestUpdateWrongArchitectureAssetIsSkipped(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.updater.GOARCH = "arm64" // the release only carries linux/amd64
	if in := u.info(t, u.owner, ""); in.UpdateAvailable || in.CanUpdate {
		t.Errorf("offered a release with no arm64 build: %+v", in)
	}
	if resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW); resp.StatusCode != http.StatusConflict {
		t.Errorf("POST = %d, want 409", resp.StatusCode)
	}
}

func TestUpdateRefreshIsAudited(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.info(t, u.owner, "?refresh=1")
	if actions := strings.Join(u.auditActions(t), ","); !strings.Contains(actions, "server.update.check") {
		t.Errorf("audit log %q is missing server.update.check", actions)
	}
}

func TestUpdateWithoutUpdaterConfigured(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)
	resp := e.do(t, "GET", "/api/admin/update", owner, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET = %d", resp.StatusCode)
	}
	var in api.UpdateInfoResponse
	readJSON(t, resp, &in)
	if in.CanUpdate || in.Mode != "unknown" {
		t.Errorf("info = %+v", in)
	}
	if got := e.do(t, "POST", "/api/admin/update", owner, nil); got.StatusCode != http.StatusNotImplemented {
		t.Errorf("POST = %d, want 501", got.StatusCode)
	}
}

// ownerPW is the step-up body for POST /api/admin/update (the owner re-enters their password).
var ownerPW = map[string]any{"password": testPassword}
