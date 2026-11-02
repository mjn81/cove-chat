package tests

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/update"
)

// elfHeader builds the first bytes of a Linux executable for the given e_machine, enough for platform sniffing.
func elfHeader(machine uint16, payload string) []byte {
	h := make([]byte, 64)
	copy(h, "\x7fELF")
	h[4], h[5] = 2, 1 // 64-bit, little-endian
	binary.LittleEndian.PutUint16(h[18:20], machine)
	return append(h, payload...)
}

func sha(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// upload sends a multipart request to the upload endpoint.
func (u *updateEnv) upload(t *testing.T, token string, fields map[string]string, filename string, file []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	// The password goes first: the server checks it before it reads the (large) file part. A test can override it.
	pw, ok := fields["password"]
	if !ok {
		pw = testPassword
	}
	_ = mw.WriteField("password", pw)
	for k, v := range fields {
		if k != "password" {
			_ = mw.WriteField(k, v)
		}
	}
	if file != nil {
		fw, _ := mw.CreateFormFile("file", filename)
		_, _ = fw.Write(file)
	}
	_ = mw.Close()
	req, _ := http.NewRequest("POST", u.srv.URL+"/api/admin/update/upload", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func (u *updateEnv) goodZip(t *testing.T) []byte {
	return makeZip(t, map[string][]byte{"cove-server-linux-amd64": []byte(updNew)})
}

func TestUploadRequiresOwner(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	z := u.goodZip(t)
	f := map[string]string{"version": "1.0.0"}
	for name, tc := range map[string]struct {
		tok  string
		want int
	}{"anonymous": {"", http.StatusUnauthorized}, "member": {u.member, http.StatusForbidden}, "admin": {u.admin, http.StatusForbidden}} {
		if got := u.upload(t, tc.tok, f, "a.zip", z); got.StatusCode != tc.want {
			t.Errorf("%s = %d, want %d", name, got.StatusCode, tc.want)
		}
	}
}

func TestUploadThenApplyHappyPath(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	z := u.goodZip(t)
	resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0", "sha256": sha(z)}, "cove-server-linux-amd64.zip", z)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload = %d (%s)", resp.StatusCode, errorCode(t, resp))
	}
	var out api.UpdateUploadResponse
	readJSON(t, resp, &out)
	if out.Upload.Version != "1.0.0" || !out.Upload.Verified || out.Upload.Kind != "zip" {
		t.Fatalf("upload = %+v", out)
	}
	if in := u.info(t, u.owner, ""); in.Uploaded == nil || in.Uploaded.Version != "1.0.0" {
		t.Fatalf("info.uploaded = %+v", in.Uploaded)
	}
	if u.readExe(t) != updOld {
		t.Fatal("uploading alone must not change the binary")
	}

	apply := u.do(t, "POST", "/api/admin/update", u.owner, map[string]string{"source": "upload", "password": testPassword})
	if apply.StatusCode != http.StatusAccepted {
		t.Fatalf("apply = %d (%s)", apply.StatusCode, errorCode(t, apply))
	}
	u.waitState(t, api.UpdateStateRestarting)
	select {
	case <-u.restart:
	case <-time.After(5 * time.Second):
		t.Fatal("no restart")
	}
	if u.readExe(t) != updNew {
		t.Error("binary not replaced")
	}
	if b, _ := os.ReadFile(u.exe + ".old"); string(b) != updOld {
		t.Error(".old missing for rollback")
	}
	actions := strings.Join(u.auditActions(t), ",")
	for _, want := range []string{"server.update.upload", "server.update.start", "server.update.installed"} {
		if !strings.Contains(actions, want) {
			t.Errorf("audit %q missing %s", actions, want)
		}
	}
}

func TestUploadPlainBinaryWithSumsFile(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	bin := elfHeader(0x3e, "payload")
	sums := sha(bin) + "  cove-server-linux-amd64\n"
	resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0", "sums": sums}, "cove-server-linux-amd64", bin)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload = %d (%s)", resp.StatusCode, errorCode(t, resp))
	}
	if r := u.do(t, "POST", "/api/admin/update", u.owner, map[string]string{"source": "upload", "password": testPassword}); r.StatusCode != http.StatusAccepted {
		t.Fatalf("apply = %d", r.StatusCode)
	}
	u.waitState(t, api.UpdateStateRestarting)
	<-u.restart
	if u.readExe(t) != string(bin) {
		t.Error("plain binary not installed")
	}
}

func TestUploadWithoutChecksumIsAllowedButUnverified(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0"}, "a.zip", u.goodZip(t))
	var out api.UpdateUploadResponse
	readJSON(t, resp, &out)
	if resp.StatusCode != http.StatusOK || out.Upload.Verified {
		t.Fatalf("resp %d %+v", resp.StatusCode, out)
	}
}

func TestUploadRejections(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	good := u.goodZip(t)
	arm := makeZip(t, map[string][]byte{"cove-server-linux-arm64": []byte("x")})
	extra := makeZip(t, map[string][]byte{"cove-server-linux-amd64": []byte("x"), "README": []byte("y")})
	cases := []struct {
		name   string
		fields map[string]string
		file   []byte
		status int
		key    string
	}{
		{"bad checksum", map[string]string{"version": "1.0.0", "sha256": strings.Repeat("0", 64)}, good, 400, "admin.errors.update_checksum_failed"},
		{"sums without entry", map[string]string{"version": "1.0.0", "sums": strings.Repeat("a", 64) + "  other.zip\n"}, good, 400, "admin.errors.update_no_checksums"},
		{"wrong architecture zip", map[string]string{"version": "1.0.0"}, arm, 400, "admin.errors.update_upload_wrong_platform"},
		{"wrong architecture binary", map[string]string{"version": "1.0.0"}, elfHeader(0xb7, "x"), 400, "admin.errors.update_upload_wrong_platform"},
		{"windows exe on linux", map[string]string{"version": "1.0.0"}, append([]byte("MZ"), make([]byte, 200)...), 400, "admin.errors.update_upload_invalid"},
		{"extra files in zip", map[string]string{"version": "1.0.0"}, extra, 400, "admin.errors.update_upload_invalid"},
		{"not an executable", map[string]string{"version": "1.0.0"}, []byte("hello"), 400, "admin.errors.update_upload_invalid"},
		{"missing version", map[string]string{}, good, 400, "admin.errors.update_upload_version"},
		{"same version", map[string]string{"version": "0.9.9"}, good, 409, "admin.errors.update_up_to_date"},
		{"downgrade", map[string]string{"version": "0.1.0"}, good, 409, "admin.errors.update_up_to_date"},
	}
	for _, c := range cases {
		resp := u.upload(t, u.owner, c.fields, "x.zip", c.file)
		if resp.StatusCode != c.status || errorCode(t, resp) != c.key {
			t.Errorf("%s: got %d, want %d %s", c.name, resp.StatusCode, c.status, c.key)
		}
	}
	if resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0"}, "", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("no file = %d, want 400", resp.StatusCode)
	}
	if in := u.info(t, u.owner, ""); in.Uploaded != nil {
		t.Error("a rejected upload was staged")
	}
	if r := u.do(t, "POST", "/api/admin/update", u.owner, map[string]string{"source": "upload", "password": testPassword}); r.StatusCode != http.StatusConflict || errorCode(t, r) != "admin.errors.update_no_upload" {
		t.Errorf("apply without upload = %d", r.StatusCode)
	}
}

func TestUploadSizeLimit(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.updater.MaxDownload = 4 << 10
	big := elfHeader(0x3e, strings.Repeat("a", 64<<10))
	resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0"}, "big", big)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload = %d, want 413", resp.StatusCode)
	}
	if u.readExe(t) != updOld {
		t.Error("binary changed")
	}
}

func TestUploadRefusedInDockerAndUnknownMode(t *testing.T) {
	for _, mode := range []update.InstallMode{update.ModeDocker, update.ModeUnknown} {
		u := newUpdateEnv(t, mode, nil)
		resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0"}, "a.zip", u.goodZip(t))
		if resp.StatusCode != http.StatusConflict {
			t.Errorf("%s upload = %d, want 409", mode, resp.StatusCode)
		}
	}
	u := newUpdateEnv(t, update.ModeDocker, nil)
	resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0"}, "a.zip", u.goodZip(t))
	if errorCode(t, resp) != "admin.errors.update_docker" {
		t.Error("docker upload should explain that self-update is impossible")
	}
}

// ---- admin notifications ----

func adminMessages(t *testing.T, u *updateEnv, username string) []string {
	t.Helper()
	return coveMessages(t, u.store, u.handler.KEK, u.userID(t, username))
}

func TestAdminsAreToldOncePerVersionAndUsersNever(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.handler.NotifyUpdates = true
	u.handler.FrontendOrigin = "https://chat.test"

	sent, err := u.handler.NotifyAdminsOfUpdate(context.Background())
	if err != nil || sent != 2 {
		t.Fatalf("first check sent %d (%v), want 2 (owner + admin)", sent, err)
	}
	for _, name := range []string{"owner", "admin"} {
		msgs := adminMessages(t, u, name)
		if len(msgs) != 1 || !strings.Contains(msgs[0], "1.0.0") || !strings.Contains(msgs[0], "notes for v1.0.0") || !strings.Contains(msgs[0], "https://chat.test/?settings=admin") {
			t.Errorf("%s messages = %q", name, msgs)
		}
	}
	if msgs := adminMessages(t, u, "member"); len(msgs) != 0 {
		t.Errorf("a regular user was messaged: %q", msgs)
	}

	if sent, _ := u.handler.NotifyAdminsOfUpdate(context.Background()); sent != 0 {
		t.Errorf("same version announced twice (sent %d)", sent)
	}
	if last, _ := u.store.LastNotifiedUpdate(); last != "1.0.0" {
		t.Errorf("persisted last notified = %q", last)
	}

	// A newer release is a new announcement.
	zipBytes := makeZip(t, map[string][]byte{"cove-server-linux-amd64": []byte("n")})
	u.gh.publish("v1.1.0", true, map[string][]byte{"cove-server-linux-amd64.zip": zipBytes}, nil)
	u.updater.CacheTTL = 0
	if sent, _ := u.handler.NotifyAdminsOfUpdate(context.Background()); sent != 2 {
		t.Errorf("new version sent %d, want 2", sent)
	}
	if msgs := adminMessages(t, u, "owner"); len(msgs) != 2 {
		t.Errorf("owner messages = %d, want 2", len(msgs))
	}
}

func TestNotificationsCanBeSwitchedOffAndSkipUpToDate(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.handler.NotifyUpdates = false
	if sent, _ := u.handler.NotifyAdminsOfUpdate(context.Background()); sent != 0 {
		t.Errorf("sent %d while disabled", sent)
	}
	u.handler.NotifyUpdates = true
	u.updater.Current = "1.0.0"
	u.updater.IncludePrerelease = true
	if sent, _ := u.handler.NotifyAdminsOfUpdate(context.Background()); sent != 0 {
		t.Errorf("sent %d although up to date", sent)
	}
}

func TestUpdateNotifierLoopStopsOnCancel(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	u.handler.NotifyUpdates = true
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		u.handler.RunUpdateNotifier(ctx, time.Millisecond, time.Hour)
		close(done)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if last, _ := u.store.LastNotifiedUpdate(); last == "1.0.0" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("notifier did not stop after cancel")
	}
	if last, _ := u.store.LastNotifiedUpdate(); last != "1.0.0" {
		t.Errorf("loop never notified (last=%q)", last)
	}
}
