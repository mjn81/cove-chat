package tests

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"cove/update"
)

// fakeGitHub serves a release list plus the asset files it advertises. zips maps asset name -> bytes;
// sums overrides the SHA256SUMS body (nil = computed honestly from zips).
type fakeGitHub struct {
	srv      *httptest.Server
	releases []update.Release
	files    map[string][]byte
}

func makeZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		hdr := &zip.FileHeader{Name: name, Method: zip.Deflate}
		hdr.SetMode(0o755)
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(data)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sumsFor(files map[string][]byte) []byte {
	var b strings.Builder
	for name, data := range files {
		h := sha256.Sum256(data)
		fmt.Fprintf(&b, "%s  %s\n", hex.EncodeToString(h[:]), name)
	}
	return []byte(b.String())
}

// newFakeGitHub publishes one release per (tag, prerelease) with the given zips and honest checksums.
func newFakeGitHub(t *testing.T) *fakeGitHub {
	t.Helper()
	f := &fakeGitHub{files: map[string][]byte{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/mjn81/cove-chat/releases", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(f.releases)
	})
	mux.HandleFunc("/dl/", func(w http.ResponseWriter, r *http.Request) {
		data, ok := f.files[strings.TrimPrefix(r.URL.Path, "/dl/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGitHub) client() *update.Client {
	return &update.Client{APIBase: f.srv.URL, AllowInsecure: true}
}

// publish adds a release whose assets are the given files (+ an honest SHA256SUMS unless sums is non-nil).
// File names are prefixed with the tag in the store so several releases can coexist on one server.
func (f *fakeGitHub) publish(tag string, pre bool, assets map[string][]byte, sums []byte) {
	rel := update.Release{Tag: tag, Prerelease: pre, Notes: "notes for " + tag}
	add := func(name string, data []byte) {
		key := tag + "/" + name
		f.files[key] = data
		rel.Assets = append(rel.Assets, update.Asset{Name: name, Size: int64(len(data)), URL: f.srv.URL + "/dl/" + key})
	}
	for n, d := range assets {
		add(n, d)
	}
	if sums == nil {
		sums = sumsFor(assets)
	}
	if sums != nil && string(sums) != "-" {
		add(update.ChecksumsAsset, sums)
	}
	f.releases = append(f.releases, rel)
}

func TestVersionCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"v0.9.9", "0.9.10", -1},
		{"1.0.0", "1.0.0-rc.1", 1},
		{"1.0.0-rc.2", "1.0.0-rc.10", -1},
		{"1.0.0-alpha", "1.0.0-alpha.1", -1},
		{"2.0.0+build5", "2.0.0", 0},
		{"0.10.0", "0.9.0", 1},
	}
	for _, c := range cases {
		got, err := update.CompareVersions(c.a, c.b)
		if err != nil || got != c.want {
			t.Errorf("Compare(%s,%s) = %d,%v want %d", c.a, c.b, got, err, c.want)
		}
	}
	for _, bad := range []string{"", "1.2", "x.y.z", "1.2.3-", "01.2.3"} {
		if _, err := update.ParseVersion(bad); err == nil {
			t.Errorf("ParseVersion(%q) accepted", bad)
		}
	}
}

func TestSelectPicksHighestSemverNotListOrder(t *testing.T) {
	rels := []update.Release{
		{Tag: "v0.9.10", Prerelease: true},
		{Tag: "v0.10.0", Prerelease: true},
		{Tag: "v0.9.9", Prerelease: true},
		{Tag: "v1.0.0-rc.1", Prerelease: true},
		{Tag: "v0.11.0", Draft: true},
		{Tag: "not-a-version"},
	}
	got, err := update.Select(rels, update.SelectOptions{Current: "0.9.9", IncludePrerelease: true})
	if err != nil || got.Tag != "v1.0.0-rc.1" {
		t.Fatalf("with prereleases got %q,%v want v1.0.0-rc.1", got.Tag, err)
	}
	if _, err := update.Select(rels, update.SelectOptions{Current: "0.9.9"}); !errors.Is(err, update.ErrNoRelease) {
		t.Fatalf("stable-only should find nothing, got %v", err)
	}
	got, _ = update.Select(append(rels, update.Release{Tag: "v0.9.11"}), update.SelectOptions{Current: "0.9.9"})
	if got.Tag != "v0.9.11" {
		t.Fatalf("stable release should win when prereleases are off, got %q", got.Tag)
	}
	if _, err := update.Select(rels, update.SelectOptions{Current: "1.0.0-rc.1", IncludePrerelease: true}); !errors.Is(err, update.ErrNoRelease) {
		t.Fatalf("already newest must not offer itself, got %v", err)
	}
}

func TestAllowPrerelease(t *testing.T) {
	if !update.AllowPrerelease("0.9.9", false) {
		t.Error("0.x builds should allow pre-releases by default")
	}
	if update.AllowPrerelease("1.2.0", false) {
		t.Error("stable 1.x should not allow pre-releases unless opted in")
	}
	if !update.AllowPrerelease("1.2.0", true) {
		t.Error("opt-in must allow pre-releases")
	}
}

func TestSelectSkipsReleasesWithoutThePlatformAsset(t *testing.T) {
	rels := []update.Release{
		{Tag: "v2.0.0", Assets: []update.Asset{{Name: "cove-server-linux-arm64.zip"}, {Name: update.ChecksumsAsset}}},
		{Tag: "v1.5.0", Assets: []update.Asset{{Name: "cove-server-linux-amd64.zip"}, {Name: update.ChecksumsAsset}}},
	}
	got, err := update.Select(rels, update.SelectOptions{Current: "1.0.0", RequireAssets: []string{"cove-server-linux-amd64.zip", update.ChecksumsAsset}})
	if err != nil || got.Tag != "v1.5.0" {
		t.Fatalf("got %q,%v want v1.5.0 (v2.0.0 has only the arm64 build)", got.Tag, err)
	}
}

func TestPlatformAssets(t *testing.T) {
	z, e, ok := update.ServerAsset("windows", "amd64")
	if !ok || z != "cove-server-windows-amd64.zip" || e != "cove-server-windows-amd64.exe" {
		t.Errorf("windows server asset = %q %q %v", z, e, ok)
	}
	if _, _, ok := update.ServerAsset("windows", "arm64"); ok {
		t.Error("windows/arm64 is not built by the release workflow")
	}
	if _, _, ok := update.ServerAsset("freebsd", "amd64"); ok {
		t.Error("freebsd should be unsupported")
	}
	if z, e, ok := update.DesktopAsset("darwin", "arm64"); !ok || z != "cove-desktop-mac-universal.zip" || e != "Cove.app" {
		t.Errorf("mac desktop asset = %q %q %v", z, e, ok)
	}
	if _, _, ok := update.DesktopAsset("linux", "arm64"); ok {
		t.Error("linux/arm64 desktop is not published")
	}
}

func TestListReleasesDropsDraftsAndReportsHTTPErrors(t *testing.T) {
	f := newFakeGitHub(t)
	f.publish("v1.0.0", false, map[string][]byte{"a.zip": []byte("x")}, nil)
	f.releases = append(f.releases, update.Release{Tag: "v9.9.9", Draft: true})
	got, err := f.client().ListReleases(context.Background())
	if err != nil || len(got) != 1 || got[0].Tag != "v1.0.0" {
		t.Fatalf("got %+v, %v", got, err)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "rate limited", http.StatusForbidden) }))
	defer bad.Close()
	if _, err := (&update.Client{APIBase: bad.URL, AllowInsecure: true}).ListReleases(context.Background()); err == nil {
		t.Error("a 403 from GitHub must surface as an error")
	}
	if _, err := (&update.Client{APIBase: bad.URL}).ListReleases(context.Background()); !errors.Is(err, update.ErrInsecureURL) {
		t.Errorf("http:// without AllowInsecure = %v, want ErrInsecureURL", err)
	}
}

func fetchFixture(t *testing.T, tag string, assets map[string][]byte, sums []byte) (*fakeGitHub, update.Release) {
	f := newFakeGitHub(t)
	f.publish(tag, true, assets, sums)
	return f, f.releases[0]
}

func TestFetchVerifiesChecksumAndReportsProgress(t *testing.T) {
	zipBytes := makeZip(t, map[string][]byte{"bin": []byte("new binary")})
	f, rel := fetchFixture(t, "v1.1.0", map[string][]byte{"app.zip": zipBytes}, nil)

	var last int64
	st, err := f.client().Fetch(context.Background(), rel, "app.zip", update.FetchOptions{
		Dir: t.TempDir(), Current: "1.0.0", Progress: func(done, total int64) { last = done },
	})
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if last != int64(len(zipBytes)) {
		t.Errorf("progress ended at %d, want %d", last, len(zipBytes))
	}
	got, _ := os.ReadFile(st.Path)
	if !bytes.Equal(got, zipBytes) {
		t.Error("staged file differs from the served bytes")
	}
}

func TestFetchRefusesBadChecksum(t *testing.T) {
	zipBytes := makeZip(t, map[string][]byte{"bin": []byte("new binary")})
	wrong := []byte(strings.Repeat("0", 64) + "  app.zip\n")
	f, rel := fetchFixture(t, "v1.1.0", map[string][]byte{"app.zip": zipBytes}, wrong)

	dir := t.TempDir()
	_, err := f.client().Fetch(context.Background(), rel, "app.zip", update.FetchOptions{Dir: dir})
	if !errors.Is(err, update.ErrChecksumMismatch) {
		t.Fatalf("err = %v, want ErrChecksumMismatch", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("a rejected download left %d file(s) behind", len(entries))
	}
}

func TestFetchRefusesMissingSumsAndMissingEntry(t *testing.T) {
	zipBytes := makeZip(t, map[string][]byte{"bin": []byte("x")})

	f, rel := fetchFixture(t, "v1.1.0", map[string][]byte{"app.zip": zipBytes}, []byte("-"))
	if _, err := f.client().Fetch(context.Background(), rel, "app.zip", update.FetchOptions{Dir: t.TempDir()}); !errors.Is(err, update.ErrNoChecksums) {
		t.Errorf("no SHA256SUMS = %v, want ErrNoChecksums", err)
	}

	other := []byte(strings.Repeat("a", 64) + "  other.zip\n")
	f, rel = fetchFixture(t, "v1.1.0", map[string][]byte{"app.zip": zipBytes}, other)
	if _, err := f.client().Fetch(context.Background(), rel, "app.zip", update.FetchOptions{Dir: t.TempDir()}); !errors.Is(err, update.ErrNoChecksums) {
		t.Errorf("no entry for asset = %v, want ErrNoChecksums", err)
	}
}

func TestFetchRefusesDowngradeWrongAssetAndOversize(t *testing.T) {
	zipBytes := makeZip(t, map[string][]byte{"bin": []byte("x")})
	f, rel := fetchFixture(t, "v1.1.0", map[string][]byte{"app.zip": zipBytes}, nil)
	c := f.client()

	if _, err := c.Fetch(context.Background(), rel, "app.zip", update.FetchOptions{Dir: t.TempDir(), Current: "1.1.0"}); !errors.Is(err, update.ErrNotNewer) {
		t.Errorf("same version = %v, want ErrNotNewer", err)
	}
	if _, err := c.Fetch(context.Background(), rel, "app.zip", update.FetchOptions{Dir: t.TempDir(), Current: "2.0.0"}); !errors.Is(err, update.ErrNotNewer) {
		t.Errorf("downgrade = %v, want ErrNotNewer", err)
	}
	if _, err := c.Fetch(context.Background(), rel, "nope.zip", update.FetchOptions{Dir: t.TempDir()}); !errors.Is(err, update.ErrAssetNotFound) {
		t.Errorf("missing asset = %v, want ErrAssetNotFound", err)
	}
	if _, err := c.Fetch(context.Background(), rel, "app.zip", update.FetchOptions{Dir: t.TempDir(), MaxBytes: 10}); !errors.Is(err, update.ErrTooLarge) {
		t.Errorf("oversize = %v, want ErrTooLarge", err)
	}
	if _, err := c.Fetch(context.Background(), rel, "../app.zip", update.FetchOptions{Dir: t.TempDir()}); err == nil {
		t.Error("path traversal in the asset name was accepted")
	}
}

func TestDownloadEnforcesLimitWhenContentLengthLies(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Transfer-Encoding", "chunked") // no Content-Length
		_, _ = w.Write(bytes.Repeat([]byte("a"), 4096))
	}))
	defer srv.Close()
	c := &update.Client{AllowInsecure: true}
	if _, _, err := c.Download(context.Background(), srv.URL, t.TempDir(), "x.zip", 1024, nil); !errors.Is(err, update.ErrTooLarge) {
		t.Errorf("err = %v, want ErrTooLarge", err)
	}
}

func TestExtractFileAndZipSlip(t *testing.T) {
	dir := t.TempDir()
	zp := filepath.Join(dir, "a.zip")
	_ = os.WriteFile(zp, makeZip(t, map[string][]byte{"cove-server": []byte("payload")}), 0o600)
	dest := filepath.Join(dir, "out")
	if err := update.ExtractFile(zp, "cove-server", dest, 1<<20); err != nil {
		t.Fatalf("ExtractFile: %v", err)
	}
	if b, _ := os.ReadFile(dest); string(b) != "payload" {
		t.Errorf("content = %q", b)
	}
	if err := update.ExtractFile(zp, "missing", filepath.Join(dir, "m"), 1<<20); err == nil {
		t.Error("missing entry accepted")
	}
	if err := update.ExtractFile(zp, "cove-server", filepath.Join(dir, "small"), 3); !errors.Is(err, update.ErrTooLarge) {
		t.Errorf("inflate limit = %v, want ErrTooLarge", err)
	}

	evil := filepath.Join(dir, "evil.zip")
	_ = os.WriteFile(evil, makeZip(t, map[string][]byte{"Cove.app/../../escape": []byte("x")}), 0o600)
	if err := update.ExtractTree(evil, "Cove.app", filepath.Join(dir, "tree"), 1<<20); err == nil {
		t.Error("zip-slip path accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "escape")); err == nil {
		t.Error("zip-slip wrote outside the destination")
	}
}

func TestExtractTreeKeepsLayout(t *testing.T) {
	dir := t.TempDir()
	zp := filepath.Join(dir, "mac.zip")
	_ = os.WriteFile(zp, makeZip(t, map[string][]byte{
		"Cove.app/Contents/MacOS/Cove":  []byte("exe"),
		"Cove.app/Contents/Info.plist":  []byte("plist"),
		"Other.app/Contents/Info.plist": []byte("not wanted"),
	}), 0o600)
	dest := filepath.Join(dir, "stage")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := update.ExtractTree(zp, "Cove.app", dest, 1<<20); err != nil {
		t.Fatalf("ExtractTree: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "Cove.app", "Contents", "MacOS", "Cove")); string(b) != "exe" {
		t.Error("bundle executable missing")
	}
	if _, err := os.Stat(filepath.Join(dest, "Other.app")); err == nil {
		t.Error("extracted something outside the requested prefix")
	}
	if err := update.ExtractTree(zp, "Missing.app", dest, 1<<20); err == nil {
		t.Error("missing tree accepted")
	}
}

func TestReplacePathKeepsOldAndRollsBack(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "cove")
	staged := filepath.Join(t.TempDir(), "downloaded")
	_ = os.WriteFile(target, []byte("v1"), 0o755)
	_ = os.WriteFile(staged, []byte("v2"), 0o600)

	old, err := update.ReplacePath(target, staged)
	if err != nil {
		t.Fatalf("ReplacePath: %v", err)
	}
	if b, _ := os.ReadFile(target); string(b) != "v2" {
		t.Errorf("target = %q, want v2", b)
	}
	if b, _ := os.ReadFile(old); string(b) != "v1" || old != target+".old" {
		t.Errorf("old copy %q = %q", old, b)
	}
	if runtime.GOOS != "windows" {
		if fi, _ := os.Stat(target); fi.Mode()&0o111 == 0 {
			t.Error("new binary is not executable")
		}
	}

	// A second update replaces the previous backup instead of failing on it.
	_ = os.WriteFile(staged, []byte("v3"), 0o600)
	if _, err := update.ReplacePath(target, staged); err != nil {
		t.Fatalf("second ReplacePath: %v", err)
	}
	if b, _ := os.ReadFile(target + ".old"); string(b) != "v2" {
		t.Errorf("backup after second update = %q, want v2", b)
	}

	if err := update.Rollback(target); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if b, _ := os.ReadFile(target); string(b) != "v2" {
		t.Errorf("after rollback target = %q, want v2", b)
	}
	if err := update.Rollback(target); err == nil {
		t.Error("rollback with no .old should fail")
	}
}

func TestReplacePathLeavesTargetAloneWhenStagedMissing(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "cove")
	_ = os.WriteFile(target, []byte("v1"), 0o755)
	if _, err := update.ReplacePath(target, filepath.Join(dir, "does-not-exist")); err == nil {
		t.Fatal("expected an error")
	}
	if b, _ := os.ReadFile(target); string(b) != "v1" {
		t.Errorf("target damaged: %q", b)
	}
	if _, err := os.Stat(target + ".old"); err == nil {
		t.Error("a failed replace must not create .old")
	}
}

func TestReplacePathDirectory(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "Cove.app")
	_ = os.MkdirAll(filepath.Join(target, "Contents"), 0o755)
	_ = os.WriteFile(filepath.Join(target, "Contents", "v"), []byte("1"), 0o644)
	staged := filepath.Join(dir, "stage")
	_ = os.MkdirAll(filepath.Join(staged, "Contents"), 0o755)
	_ = os.WriteFile(filepath.Join(staged, "Contents", "v"), []byte("2"), 0o644)

	if _, err := update.ReplacePath(target, staged); err != nil {
		t.Fatalf("ReplacePath dir: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(target, "Contents", "v")); string(b) != "2" {
		t.Errorf("bundle not replaced: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(target+".old", "Contents", "v")); string(b) != "1" {
		t.Errorf("old bundle not kept: %q", b)
	}
	update.CleanupOld(target)
	if _, err := os.Stat(target + ".old"); err == nil {
		t.Error("CleanupOld left .old behind")
	}
}

func TestDetectInstallMode(t *testing.T) {
	base := update.Probe{
		Exists:      func(string) bool { return false },
		ReadFile:    func(string) ([]byte, error) { return nil, os.ErrNotExist },
		Getenv:      func(string) string { return "" },
		DirWritable: func(string) bool { return true },
		TempDir:     "/tmp",
	}
	if m := update.DetectInstallMode(base, "/opt/cove/cove-server"); m != update.ModeBinary {
		t.Errorf("plain install = %s", m)
	}
	docker := base
	docker.Exists = func(p string) bool { return p == "/.dockerenv" }
	if m := update.DetectInstallMode(docker, "/app/cove-server"); m != update.ModeDocker {
		t.Errorf(".dockerenv = %s", m)
	}
	cg := base
	cg.ReadFile = func(string) ([]byte, error) { return []byte("0::/docker/abc123\n"), nil }
	if m := update.DetectInstallMode(cg, "/app/cove-server"); m != update.ModeDocker {
		t.Errorf("cgroup = %s", m)
	}
	env := base
	env.Getenv = func(k string) string {
		if k == "COVE_IN_DOCKER" {
			return "1"
		}
		return ""
	}
	if m := update.DetectInstallMode(env, "/app/cove-server"); m != update.ModeDocker {
		t.Errorf("env override = %s", m)
	}
	ro := base
	ro.DirWritable = func(string) bool { return false }
	if m := update.DetectInstallMode(ro, "/usr/bin/cove"); m != update.ModeUnknown {
		t.Errorf("read-only dir = %s", m)
	}
	if m := update.DetectInstallMode(base, "/tmp/go-build123/b001/exe/server"); m != update.ModeUnknown {
		t.Errorf("go run = %s", m)
	}
}
