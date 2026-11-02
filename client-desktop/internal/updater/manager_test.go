package updater

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"cove/update"
)

const (
	oldExe = "OLD EXE"
	newExe = "NEW EXE"
)

func zipOf(t *testing.T, files map[string]string) []byte {
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
		_, _ = w.Write([]byte(data))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// fakeGitHub serves one release list plus its assets.
type fakeGitHub struct {
	srv      *httptest.Server
	mu       sync.Mutex
	releases []update.Release
	files    map[string][]byte
	listHits int
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	t.Helper()
	f := &fakeGitHub{files: map[string][]byte{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/mjn81/cove-chat/releases", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.listHits++
		_ = json.NewEncoder(w).Encode(f.releases)
	})
	mux.HandleFunc("/dl/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		data, ok := f.files[strings.TrimPrefix(r.URL.Path, "/dl/")]
		f.mu.Unlock()
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

// publish adds a release carrying zipName=zipBytes and a SHA256SUMS (honest unless sums is non-empty).
func (f *fakeGitHub) publish(tag string, pre bool, zipName string, zipBytes []byte, sums string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rel := update.Release{Tag: tag, Prerelease: pre, Notes: "notes " + tag, HTMLURL: "https://example.test/" + tag}
	add := func(name string, data []byte) {
		key := tag + "/" + name
		f.files[key] = data
		rel.Assets = append(rel.Assets, update.Asset{Name: name, Size: int64(len(data)), URL: f.srv.URL + "/dl/" + key})
	}
	add(zipName, zipBytes)
	if sums == "" {
		h := sha256.Sum256(zipBytes)
		sums = hex.EncodeToString(h[:]) + "  " + zipName + "\n"
	}
	if sums != "-" {
		add(update.ChecksumsAsset, []byte(sums))
	}
	f.releases = append(f.releases, rel)
}

type harness struct {
	t         *testing.T
	gh        *fakeGitHub
	m         *Manager
	target    string
	stage     string
	events    []State
	relaunch  []string
	quit      int
	relaunchE error
	settings  Settings
}

// newHarness builds a Manager for a fake "Windows" install: Target is a temp Cove.exe running version 0.9.9.
func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{t: t, gh: newFakeGitHub(t), settings: Settings{Enabled: true, IncludePrerelease: true}}
	h.stage = filepath.Join(t.TempDir(), "updates")
	dir := t.TempDir()
	h.target = filepath.Join(dir, "Cove.exe")
	if err := os.WriteFile(h.target, []byte(oldExe), 0o755); err != nil {
		t.Fatal(err)
	}
	h.rebuild()
	return h
}

func (h *harness) rebuild() {
	h.m = New(Config{
		Client:   &update.Client{APIBase: h.gh.srv.URL, AllowInsecure: true},
		Current:  "0.9.9",
		GOOS:     "windows",
		GOARCH:   "amd64",
		Target:   h.target,
		StageDir: h.stage,
		Settings: func() Settings { return h.settings },
		Emit:     func(s State) { h.events = append(h.events, s) },
		Relaunch: func(target string, pid int) error {
			h.relaunch = append(h.relaunch, fmt.Sprintf("%s|%d", target, pid))
			return h.relaunchE
		},
		Quit:        func() { h.quit++ },
		PID:         4242,
		DirWritable: func(string) bool { return true },
	})
}

func (h *harness) publishGood(tag string) {
	h.gh.publish(tag, true, "cove-desktop-windows-amd64.zip", zipOf(h.t, map[string]string{"Cove.exe": newExe}), "")
}

func (h *harness) readTarget() string {
	b, err := os.ReadFile(h.target)
	if err != nil {
		h.t.Fatal(err)
	}
	return string(b)
}

func TestCheckStagesAVerifiedUpdate(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")

	if err := h.m.Check(t.Context(), false); err != nil {
		t.Fatalf("Check: %v", err)
	}
	st := h.m.State()
	if st.Phase != PhaseReady || st.LatestVersion != "1.0.0" || st.ReleaseNotes != "notes v1.0.0" || !st.CanInstall || st.Progress != 100 {
		t.Fatalf("state = %+v", st)
	}
	if h.readTarget() != oldExe {
		t.Fatal("checking must never touch the installed app")
	}
	// The phases seen by the UI, in order.
	var seen []Phase
	for _, e := range h.events {
		if len(seen) == 0 || seen[len(seen)-1] != e.Phase {
			seen = append(seen, e.Phase)
		}
	}
	want := []Phase{PhaseChecking, PhaseDownloading, PhaseReady}
	if fmt.Sprint(seen) != fmt.Sprint(want) {
		t.Errorf("phases = %v, want %v", seen, want)
	}
}

func TestReadyStateSurvivesARestart(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	if err := h.m.Check(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	h.rebuild() // the app was closed and reopened before the user clicked
	if st := h.m.State(); st.Phase != PhaseReady || st.LatestVersion != "1.0.0" {
		t.Fatalf("state after restart = %+v", st)
	}
}

func TestStagedUpdateIsDroppedOnceNoLongerNewer(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	_ = h.m.Check(t.Context(), false)
	// The user installs 1.0.0 by hand, then reopens the app.
	h2 := New(Config{Client: h.m.cfg.Client, Current: "1.0.0", GOOS: "windows", GOARCH: "amd64", Target: h.target, StageDir: h.stage, DirWritable: func(string) bool { return true }})
	if st := h2.State(); st.Phase != PhaseIdle {
		t.Fatalf("state = %+v, want idle", st)
	}
	if entries, _ := os.ReadDir(h.stage); len(entries) != 0 {
		t.Errorf("stale staging left behind: %v", entries)
	}
}

func TestBadChecksumIsRefusedAndNothingStaged(t *testing.T) {
	h := newHarness(t)
	h.gh.publish("v1.0.0", true, "cove-desktop-windows-amd64.zip", zipOf(t, map[string]string{"Cove.exe": newExe}), strings.Repeat("0", 64)+"  cove-desktop-windows-amd64.zip\n")

	if err := h.m.Check(t.Context(), true); err == nil {
		t.Fatal("expected an error")
	}
	st := h.m.State()
	if st.Phase != PhaseError || st.Error != ErrChecksum {
		t.Fatalf("state = %+v", st)
	}
	if _, err := os.Stat(filepath.Join(h.stage, "staged.json")); err == nil {
		t.Error("an unverified download was staged")
	}
	if err := h.m.Install(); err == nil {
		t.Error("Install succeeded with nothing staged")
	}
	if h.readTarget() != oldExe || len(h.relaunch) != 0 {
		t.Error("app touched or relaunched")
	}
}

func TestAutomaticFailureDoesNotNag(t *testing.T) {
	h := newHarness(t)
	h.gh.srv.Close()
	if err := h.m.Check(t.Context(), false); err == nil {
		t.Fatal("expected an error to log")
	}
	if st := h.m.State(); st.Phase != PhaseIdle || st.Error != "" {
		t.Fatalf("background failure changed the UI state: %+v", st)
	}
	// ...but the same failure on "Check now" is shown.
	if err := h.m.Check(t.Context(), true); err == nil {
		t.Fatal("expected an error")
	}
	if st := h.m.State(); st.Phase != PhaseError || st.Error != ErrCheckFailed {
		t.Fatalf("manual failure state = %+v", st)
	}
}

func TestNothingNewIsUpToDate(t *testing.T) {
	h := newHarness(t)
	h.gh.publish("v0.9.9", true, "cove-desktop-windows-amd64.zip", zipOf(t, map[string]string{"Cove.exe": newExe}), "")
	h.gh.publish("v0.9.1", true, "cove-desktop-windows-amd64.zip", zipOf(t, map[string]string{"Cove.exe": newExe}), "")
	if err := h.m.Check(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if st := h.m.State(); st.Phase != PhaseIdle || !st.UpToDate || st.CheckedAt == "" {
		t.Fatalf("state = %+v", st)
	}
}

func TestDowngradeIsNeverOffered(t *testing.T) {
	h := newHarness(t)
	h.gh.publish("v0.8.0", true, "cove-desktop-windows-amd64.zip", zipOf(t, map[string]string{"Cove.exe": newExe}), "")
	_ = h.m.Check(t.Context(), true)
	if st := h.m.State(); st.Phase == PhaseReady || st.LatestVersion != "" {
		t.Fatalf("offered an older release: %+v", st)
	}
}

func TestDisabledSkipsBackgroundChecksButNotManualOnes(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	h.settings.Enabled = false
	if err := h.m.Check(t.Context(), false); err != nil || h.gh.listHits != 0 {
		t.Fatalf("background check ran while disabled (hits=%d, err=%v)", h.gh.listHits, err)
	}
	if err := h.m.Check(t.Context(), true); err != nil || h.m.State().Phase != PhaseReady {
		t.Fatalf("manual check = %v, state %+v", err, h.m.State())
	}
}

func TestPrereleaseSettingIsRespected(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0") // published as a pre-release by publishGood
	h.settings.IncludePrerelease = false
	if err := h.m.Check(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if st := h.m.State(); st.Phase != PhaseIdle || !st.UpToDate {
		t.Fatalf("pre-release offered although switched off: %+v", st)
	}
	h.settings.IncludePrerelease = true
	if err := h.m.Check(t.Context(), true); err != nil || h.m.State().Phase != PhaseReady {
		t.Fatalf("pre-release not offered when on: %v %+v", err, h.m.State())
	}
}

func TestWrongPlatformAssetIsSkipped(t *testing.T) {
	h := newHarness(t)
	h.gh.publish("v1.0.0", true, "cove-desktop-linux-amd64.zip", zipOf(t, map[string]string{"Cove": newExe}), "")
	_ = h.m.Check(t.Context(), true)
	if st := h.m.State(); st.Phase == PhaseReady {
		t.Fatalf("staged a linux build on windows: %+v", st)
	}
}

func TestInstallSwapsKeepsBackupAndRelaunches(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	_ = h.m.Check(t.Context(), false)

	if err := h.m.Install(); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if h.readTarget() != newExe {
		t.Errorf("target = %q, want the new exe", h.readTarget())
	}
	if b, _ := os.ReadFile(h.target + ".old"); string(b) != oldExe {
		t.Errorf(".old = %q, want the previous exe", b)
	}
	if len(h.relaunch) != 1 || h.relaunch[0] != h.target+"|4242" || h.quit != 1 {
		t.Errorf("relaunch=%v quit=%d", h.relaunch, h.quit)
	}
	if p := readPending(h.stage); p == nil || p.Version != "1.0.0" || p.Previous != "0.9.9" {
		t.Errorf("pending marker = %+v", p)
	}
	if _, err := os.Stat(filepath.Join(h.stage, "staged.json")); err == nil {
		t.Error("staging was not cleaned after install")
	}
}

func TestInstallRollsBackWhenRelaunchFails(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	_ = h.m.Check(t.Context(), false)
	h.relaunchE = fmt.Errorf("boom")

	if err := h.m.Install(); err == nil {
		t.Fatal("expected an error")
	}
	if h.readTarget() != oldExe {
		t.Errorf("target = %q, want the old exe restored", h.readTarget())
	}
	if h.quit != 0 {
		t.Error("app quit although the new copy never started")
	}
	if readPending(h.stage) != nil {
		t.Error("pending marker left behind")
	}
	if st := h.m.State(); st.Phase != PhaseError || st.Error != ErrInstallFailed {
		t.Errorf("state = %+v", st)
	}
}

func TestInstallRefusesAZipChangedAfterVerification(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	_ = h.m.Check(t.Context(), false)
	zips, _ := filepath.Glob(filepath.Join(h.stage, "*", "*.zip"))
	if len(zips) != 1 {
		t.Fatalf("staged zips = %v", zips)
	}
	if err := os.WriteFile(zips[0], zipOf(t, map[string]string{"Cove.exe": "EVIL"}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := h.m.Install(); err == nil {
		t.Fatal("tampered zip was installed")
	}
	if h.readTarget() != oldExe || len(h.relaunch) != 0 {
		t.Error("tampered update touched the app")
	}
	if st := h.m.State(); st.Error != ErrChecksum {
		t.Errorf("state = %+v", st)
	}
}

func TestInstallWithoutPermissionToWriteIsRefused(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	h.rebuildWith(func(c *Config) { c.DirWritable = func(string) bool { return false } })
	_ = h.m.Check(t.Context(), false)
	if st := h.m.State(); st.CanInstall {
		t.Fatalf("CanInstall = true for a read-only folder")
	}
	if err := h.m.Install(); err == nil {
		t.Fatal("Install ran in a read-only folder")
	}
}

func (h *harness) rebuildWith(mod func(*Config)) {
	h.rebuild()
	cfg := h.m.cfg
	mod(&cfg)
	h.m = New(cfg)
}

func TestMacBundleIsReplacedAsATree(t *testing.T) {
	h := newHarness(t)
	apps := t.TempDir()
	bundle := filepath.Join(apps, "Cove.app")
	if err := os.MkdirAll(filepath.Join(bundle, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(bundle, "Contents", "MacOS", "Cove"), []byte("old mac"), 0o755)
	h.gh.publish("v1.0.0", true, "cove-desktop-mac-universal.zip", zipOf(t, map[string]string{
		"Cove.app/Contents/MacOS/Cove": "new mac",
		"Cove.app/Contents/Info.plist": "plist",
	}), "")
	h.rebuildWith(func(c *Config) { c.GOOS, c.GOARCH, c.Target = "darwin", "arm64", bundle })

	if err := h.m.Check(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	if err := h.m.Install(); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(bundle, "Contents", "MacOS", "Cove")); string(b) != "new mac" {
		t.Errorf("bundle executable = %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(bundle+".old", "Contents", "MacOS", "Cove")); string(b) != "old mac" {
		t.Errorf("old bundle not kept: %q", b)
	}
	if left, _ := filepath.Glob(filepath.Join(apps, ".cove-update-*")); len(left) != 0 {
		t.Errorf("temp extraction left in the Applications folder: %v", left)
	}
}

func TestDecideBoot(t *testing.T) {
	cases := []struct {
		name    string
		p       *Pending
		current string
		want    BootAction
	}{
		{"no marker", nil, "1.0.0", BootNothing},
		{"first start of the new version", &Pending{Version: "1.0.0", Attempts: 0}, "1.0.0", BootObserve},
		{"second start", &Pending{Version: "1.0.0", Attempts: 1}, "1.0.0", BootObserve},
		{"keeps dying", &Pending{Version: "1.0.0", Attempts: MaxBootAttempts}, "1.0.0", BootRollback},
		{"swap never took effect", &Pending{Version: "1.0.0"}, "0.9.9", BootClear},
		{"garbage marker", &Pending{Version: "nope"}, "0.9.9", BootClear},
	}
	for _, c := range cases {
		if got := DecideBoot(c.p, c.current); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestBootCountsStartsThenRollsBack(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	_ = h.m.Check(t.Context(), false)
	if err := h.m.Install(); err != nil {
		t.Fatal(err)
	}
	h.relaunch, h.quit = nil, 0

	// Pretend to be the new 1.0.0 build that crashes repeatedly.
	crash := func() BootAction {
		m := New(Config{
			Client: h.m.cfg.Client, Current: "1.0.0", GOOS: "windows", GOARCH: "amd64", Target: h.target, StageDir: h.stage,
			Relaunch: func(target string, pid int) error { h.relaunch = append(h.relaunch, target); return nil },
			Quit:     func() { h.quit++ }, DirWritable: func(string) bool { return true },
		})
		a := m.Boot()
		if m.healthy != nil {
			m.healthy.Stop() // the build died before HealthyAfter
		}
		return a
	}
	for i := 0; i < MaxBootAttempts; i++ {
		if a := crash(); a != BootObserve {
			t.Fatalf("start %d: %v, want observe", i+1, a)
		}
	}
	if a := crash(); a != BootRollback {
		t.Fatalf("third start: %v, want rollback", a)
	}
	if h.readTarget() != oldExe {
		t.Errorf("target = %q, want the previous version restored", h.readTarget())
	}
	if len(h.relaunch) != 1 || h.quit != 1 {
		t.Errorf("relaunch=%v quit=%d", h.relaunch, h.quit)
	}
	if readPending(h.stage) != nil {
		t.Error("marker not cleared after rollback")
	}
}

func TestHealthyRemovesBackupAndMarker(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	_ = h.m.Check(t.Context(), false)
	_ = h.m.Install()

	m := New(Config{Client: h.m.cfg.Client, Current: "1.0.0", GOOS: "windows", GOARCH: "amd64", Target: h.target, StageDir: h.stage, DirWritable: func(string) bool { return true }})
	if a := m.Boot(); a != BootObserve {
		t.Fatalf("Boot = %v", a)
	}
	m.healthy.Stop()
	m.markHealthy()
	if _, err := os.Stat(h.target + ".old"); err == nil {
		t.Error(".old kept after the update proved healthy")
	}
	if readPending(h.stage) != nil {
		t.Error("marker kept after the update proved healthy")
	}
}

func TestRunChecksOnTheFirstTick(t *testing.T) {
	h := newHarness(t)
	h.publishGood("v1.0.0")
	done := make(chan struct{})
	go func() {
		h.m.Run(t.Context(), time.Millisecond, time.Hour, nil)
		close(done)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && h.m.State().Phase != PhaseReady {
		time.Sleep(10 * time.Millisecond)
	}
	if h.m.State().Phase != PhaseReady {
		t.Fatal("background loop never staged the update")
	}
}

func TestRelaunchArg(t *testing.T) {
	if pid, ok := ParseRelaunchArg([]string{"--hidden", RelaunchArg(77)}); !ok || pid != 77 {
		t.Errorf("got %d %v", pid, ok)
	}
	for _, bad := range [][]string{nil, {"--relaunch-after=abc"}, {"--relaunch-after=0"}, {"--relaunch-after=-3"}} {
		if _, ok := ParseRelaunchArg(bad); ok {
			t.Errorf("accepted %v", bad)
		}
	}
}

func TestWaitForExitReturnsImmediatelyForAGonePid(t *testing.T) {
	start := time.Now()
	WaitForExit(2147483000, 5*time.Second) // no such process
	if time.Since(start) > 2*time.Second {
		t.Error("waited for a process that does not exist")
	}
}
