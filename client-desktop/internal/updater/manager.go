package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cove/update"
)

// ErrBusy is returned when a check or install is already running.
var ErrBusy = errors.New("updater: another update operation is running")

// Config wires a Manager to its environment. Everything that touches the outside world is injectable so tests
// run against httptest and temp directories on any OS.
type Config struct {
	// Client reaches GitHub. Its AllowInsecure must stay false in production.
	Client *update.Client
	// Current is the running version, e.g. "0.9.9".
	Current string
	// GOOS and GOARCH select the release asset; default to the running platform when empty.
	GOOS, GOARCH string
	// Target is what gets replaced: the executable on Windows and Linux, the Cove.app bundle on macOS.
	Target string
	// StageDir holds the verified download, the staged manifest and the post-update marker.
	StageDir string
	// Settings returns the live preferences; nil means enabled with pre-releases allowed.
	Settings func() Settings
	// Emit receives every state change (the app forwards it to the web UI as an event). Optional.
	Emit func(State)
	// Relaunch starts the new copy of the app, telling it to wait for oldPID to exit first. Required for Install.
	Relaunch func(target string, oldPID int) error
	// Quit asks the running app to exit once the new copy has been started. Required for Install.
	Quit func()
	// PID is this process's id (default os.Getpid()).
	PID int
	// MaxDownload caps the zip size (default 300 MiB).
	MaxDownload int64
	// DirWritable reports whether the install directory accepts new files (default: try to create one).
	DirWritable func(dir string) bool
}

// Manager runs the update state machine. Create one with New.
type Manager struct {
	cfg Config

	mu           sync.Mutex
	state        State
	busy         bool
	staged       *stagedManifest
	found        *foundRelease
	lastProgress int
	healthy      *time.Timer
}

// foundRelease is what the last check chose, kept so the user's Download click does not need another lookup.
type foundRelease struct {
	rel     update.Release
	zipName string
	entry   string
	version string
}

// stagedManifest describes a verified download waiting for the user's restart.
type stagedManifest struct {
	Version string `json:"version"`
	Zip     string `json:"zip"`
	SHA256  string `json:"sha256"`
	Entry   string `json:"entry"`
	Notes   string `json:"notes"`
	URL     string `json:"url"`
}

// New builds a Manager and restores a previously staged update from disk, so "update ready" survives a restart of
// the app that happens before the user clicks the button.
func New(cfg Config) *Manager {
	if cfg.GOOS == "" || cfg.GOARCH == "" {
		cfg.GOOS, cfg.GOARCH = runtimeOSArch()
	}
	if cfg.Settings == nil {
		cfg.Settings = func() Settings { return Settings{Enabled: true, IncludePrerelease: true} }
	}
	if cfg.PID == 0 {
		cfg.PID = os.Getpid()
	}
	if cfg.MaxDownload <= 0 {
		cfg.MaxDownload = 300 << 20
	}
	if cfg.DirWritable == nil {
		cfg.DirWritable = update.OSProbe().DirWritable
	}
	m := &Manager{cfg: cfg}
	_, _, platformOK := update.DesktopAsset(cfg.GOOS, cfg.GOARCH)
	m.state = State{
		Phase:          PhaseIdle,
		CurrentVersion: cfg.Current,
		CanInstall:     platformOK && cfg.Target != "" && m.targetWritable(),
	}
	m.loadStaged()
	return m
}

// targetWritable checks that the swap can happen: the new copy and the ".old" backup are created beside Target.
func (m *Manager) targetWritable() bool {
	if _, err := os.Lstat(m.cfg.Target); err != nil {
		return false
	}
	return m.cfg.DirWritable(filepath.Dir(m.cfg.Target))
}

// State returns a snapshot of the current state.
func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

func (m *Manager) manifestPath() string { return filepath.Join(m.cfg.StageDir, "staged.json") }

// update mutates the state under the lock and emits the result outside it.
func (m *Manager) update(f func(s *State)) {
	m.mu.Lock()
	f(&m.state)
	snap := m.state
	m.mu.Unlock()
	if m.cfg.Emit != nil {
		m.cfg.Emit(snap)
	}
}

// loadStaged restores a staged update, dropping it when it is no longer newer than the running version (the user
// updated by hand) or its files are gone.
func (m *Manager) loadStaged() {
	data, err := os.ReadFile(m.manifestPath())
	if err != nil {
		return
	}
	var sm stagedManifest
	if json.Unmarshal(data, &sm) != nil {
		m.purgeStaged()
		return
	}
	newer, cerr := update.CompareVersions(sm.Version, m.cfg.Current)
	if cerr != nil || newer <= 0 {
		m.purgeStaged()
		return
	}
	if _, err := os.Stat(sm.Zip); err != nil {
		m.purgeStaged()
		return
	}
	m.staged = &sm
	m.state.Phase = PhaseReady
	m.state.LatestVersion = sm.Version
	m.state.ReleaseNotes = sm.Notes
	m.state.ReleaseURL = sm.URL
}

// purgeStaged deletes every downloaded update and the manifest.
func (m *Manager) purgeStaged() {
	m.staged = nil
	_ = os.Remove(m.manifestPath())
	entries, _ := os.ReadDir(m.cfg.StageDir)
	for _, e := range entries {
		if e.IsDir() {
			_ = os.RemoveAll(filepath.Join(m.cfg.StageDir, e.Name()))
		}
	}
}

// Check looks for a newer release. It only DOWNLOADS when the user opted in to automatic downloads (and this is a
// background check); otherwise the state becomes "available" and the user's click on Download (see Download) starts
// the transfer. Installing always needs a click.
//
// manual is true for the user's "Check now": it runs even when background checks are off, and its failures are
// shown. Automatic failures are only logged by the caller (a flaky network must not nag), and leave the previous
// state alone.
func (m *Manager) Check(ctx context.Context, manual bool) error {
	s := m.cfg.Settings()
	if !manual && !s.Enabled {
		return nil
	}
	prev, ok := m.begin()
	if !ok {
		return ErrBusy
	}
	defer m.end()

	fail := func(code string, err error) error { return m.failWith(manual, prev, code, err) }
	zipName, entry, platformOK := update.DesktopAsset(m.cfg.GOOS, m.cfg.GOARCH)
	if !platformOK {
		return fail(ErrUnsupported, fmt.Errorf("updater: no desktop build for %s/%s", m.cfg.GOOS, m.cfg.GOARCH))
	}
	m.update(func(st *State) { st.Phase, st.Error, st.Progress = PhaseChecking, "", 0 })

	m.cfg.Client.ManifestURL = s.ManifestURL
	rels, _, err := m.cfg.Client.LoadReleases(ctx)
	if err != nil {
		return fail(ErrCheckFailed, err)
	}
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	rel, err := update.Select(rels, update.SelectOptions{
		Current:           m.cfg.Current,
		IncludePrerelease: s.IncludePrerelease,
		RequireAssets:     []string{zipName, update.ChecksumsAsset},
	})
	if errors.Is(err, update.ErrNoRelease) {
		m.mu.Lock()
		hasStaged := m.staged != nil
		m.found = nil
		m.mu.Unlock()
		m.update(func(st *State) {
			st.CheckedAt, st.UpToDate, st.Progress, st.Error = checkedAt, !hasStaged, 0, ""
			if hasStaged {
				st.Phase = PhaseReady
			} else {
				st.Phase, st.LatestVersion, st.ReleaseNotes, st.ReleaseURL = PhaseIdle, "", "", ""
			}
		})
		return nil
	}
	if err != nil {
		return fail(ErrCheckFailed, err)
	}
	version := strings.TrimPrefix(rel.Tag, "v")

	m.mu.Lock()
	alreadyStaged := m.staged != nil && m.staged.Version == version
	m.found = &foundRelease{rel: rel, zipName: zipName, entry: entry, version: version}
	m.mu.Unlock()
	m.update(func(st *State) {
		st.LatestVersion, st.ReleaseNotes, st.ReleaseURL = version, rel.Notes, rel.HTMLURL
		st.CheckedAt, st.UpToDate, st.Progress, st.Error = checkedAt, false, 0, ""
		st.Phase = PhaseAvailable
		if alreadyStaged {
			st.Phase, st.Progress = PhaseReady, 100
		}
	})
	if alreadyStaged || manual || !s.AutoDownload {
		return nil
	}
	return m.fetch(ctx, false, prev)
}

// Download fetches and verifies the update found by the last check. It is what the user's Download click calls, so
// failures are shown. Nothing is installed: the result is the "ready" state.
func (m *Manager) Download(ctx context.Context) error {
	prev, ok := m.begin()
	if !ok {
		return ErrBusy
	}
	defer m.end()
	m.mu.Lock()
	found := m.found
	m.mu.Unlock()
	if found == nil {
		return m.failWith(true, prev, ErrNothingStaged, errors.New("updater: no update has been found yet"))
	}
	return m.fetch(ctx, true, prev)
}

// begin claims the busy flag and returns the state to fall back to.
func (m *Manager) begin() (State, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busy || m.state.Phase == PhaseInstalling {
		return State{}, false
	}
	m.busy = true
	return m.state, true
}

func (m *Manager) end() {
	m.mu.Lock()
	m.busy = false
	m.mu.Unlock()
}

// failWith reports a failure: shown to the user when shown is true, otherwise the previous state is restored.
func (m *Manager) failWith(shown bool, prev State, code string, err error) error {
	if shown {
		m.update(func(st *State) { st.Phase, st.Error, st.Progress = PhaseError, code, 0 })
	} else {
		m.update(func(st *State) { *st = prev })
	}
	return err
}

// fetch downloads the release recorded by Check, verifies it and stages it.
func (m *Manager) fetch(ctx context.Context, shown bool, prev State) error {
	m.mu.Lock()
	found := m.found
	m.mu.Unlock()
	m.update(func(st *State) { st.Phase, st.Progress, st.Error = PhaseDownloading, 0, "" })
	m.lastProgress = -1
	staged, err := m.cfg.Client.Fetch(ctx, found.rel, found.zipName, update.FetchOptions{
		Dir:      filepath.Join(m.cfg.StageDir, found.version),
		MaxBytes: m.cfg.MaxDownload,
		Current:  m.cfg.Current,
		Progress: func(done, total int64) { m.progress(done, total) },
	})
	if err != nil {
		code := ErrDownloadFailed
		if errors.Is(err, update.ErrChecksumMismatch) || errors.Is(err, update.ErrNoChecksums) {
			code = ErrChecksum
		}
		return m.failWith(shown, prev, code, err)
	}

	sm := &stagedManifest{Version: found.version, Zip: staged.Path, SHA256: staged.SHA256, Entry: found.entry, Notes: found.rel.Notes, URL: found.rel.HTMLURL}
	if err := m.saveStaged(sm); err != nil {
		return m.failWith(shown, prev, ErrDownloadFailed, err)
	}
	m.update(func(st *State) { st.Phase, st.Progress = PhaseReady, 100 })
	return nil
}

// progress emits download progress, but only when the whole percentage changes.
func (m *Manager) progress(done, total int64) {
	if total <= 0 {
		return
	}
	pct := int(done * 100 / total)
	m.mu.Lock()
	same := pct == m.lastProgress
	m.lastProgress = pct
	m.mu.Unlock()
	if !same {
		m.update(func(st *State) { st.Progress = pct })
	}
}

// saveStaged records the verified download, replacing any older staged update.
func (m *Manager) saveStaged(sm *stagedManifest) error {
	data, err := json.MarshalIndent(sm, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(m.manifestPath(), data, 0o600); err != nil {
		return err
	}
	m.mu.Lock()
	m.staged = sm
	m.mu.Unlock()
	entries, _ := os.ReadDir(m.cfg.StageDir)
	for _, e := range entries {
		if e.IsDir() && e.Name() != sm.Version {
			_ = os.RemoveAll(filepath.Join(m.cfg.StageDir, e.Name()))
		}
	}
	return nil
}

// Install swaps the staged update in and relaunches. The caller (the UI) is responsible for asking the user first,
// especially while a call or an unsent message is open: this method never decides to restart on its own.
//
// The zip is hashed again here, so a file that was modified on disk between download and click is refused.
func (m *Manager) Install() error {
	if m.cfg.Relaunch == nil {
		return errors.New("updater: no relaunch hook configured")
	}
	m.mu.Lock()
	if m.busy {
		m.mu.Unlock()
		return ErrBusy
	}
	if m.state.Phase != PhaseReady || m.staged == nil {
		m.mu.Unlock()
		return errors.New("updater: no verified update is staged")
	}
	if !m.state.CanInstall {
		m.mu.Unlock()
		return errors.New("updater: this install location cannot be updated automatically")
	}
	m.busy = true
	sm := *m.staged
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.busy = false
		m.mu.Unlock()
	}()

	m.update(func(st *State) { st.Phase, st.Error = PhaseInstalling, "" })
	failed := func(code string, err error) error {
		m.update(func(st *State) { st.Phase, st.Error = PhaseError, code })
		return err
	}

	sum, err := fileSHA256(sm.Zip)
	if err != nil || sum != sm.SHA256 {
		m.mu.Lock()
		m.purgeStaged()
		m.mu.Unlock()
		return failed(ErrChecksum, fmt.Errorf("updater: staged file changed on disk (hash mismatch): %v", err))
	}
	if err := m.apply(sm); err != nil {
		return failed(ErrInstallFailed, err)
	}
	if err := writePending(m.cfg.StageDir, Pending{Version: sm.Version, Previous: m.cfg.Current}); err != nil {
		_ = update.Rollback(m.cfg.Target)
		return failed(ErrInstallFailed, err)
	}
	if err := m.cfg.Relaunch(m.cfg.Target, m.cfg.PID); err != nil {
		_ = update.Rollback(m.cfg.Target)
		clearPending(m.cfg.StageDir)
		return failed(ErrInstallFailed, fmt.Errorf("updater: relaunch failed, previous version restored: %w", err))
	}
	m.mu.Lock()
	m.purgeStaged()
	m.mu.Unlock()
	if m.cfg.Quit != nil {
		m.cfg.Quit()
	}
	return nil
}

// apply extracts the staged zip next to the target and swaps it in, keeping the old copy as ".old" for rollback.
// On macOS the unit is the whole Cove.app bundle; elsewhere it is the single executable.
func (m *Manager) apply(sm stagedManifest) error {
	limit := m.cfg.MaxDownload * 3
	target := m.cfg.Target
	if m.cfg.GOOS == "darwin" {
		// Extract beside the bundle (same filesystem) so the swap is a pair of renames.
		tmp, err := os.MkdirTemp(filepath.Dir(target), ".cove-update-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)
		if err := update.ExtractTree(sm.Zip, sm.Entry, tmp, limit); err != nil {
			return err
		}
		_, err = update.ReplacePath(target, filepath.Join(tmp, sm.Entry))
		return err
	}
	newPath := target + update.NewSuffix
	if err := update.ExtractFile(sm.Zip, sm.Entry, newPath, limit); err != nil {
		_ = os.Remove(newPath)
		return err
	}
	_, err := update.ReplacePath(target, newPath)
	return err
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Run checks shortly after start-up and then every interval until ctx ends. It is meant to run in its own
// goroutine. Automatic failures only leave a log line via onError; the state keeps whatever was staged.
func (m *Manager) Run(ctx context.Context, firstDelay, interval time.Duration, onError func(error)) {
	timer := time.NewTimer(firstDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := m.Check(ctx, false); err != nil && !errors.Is(err, ErrBusy) && onError != nil {
				onError(err)
			}
			timer.Reset(interval)
		}
	}
}
