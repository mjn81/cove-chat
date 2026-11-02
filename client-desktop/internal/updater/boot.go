package updater

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"cove/update"
)

// HealthyAfter is how long a freshly updated app must keep running before the update is considered good and the
// ".old" backup is deleted.
const HealthyAfter = 60 * time.Second

// MaxBootAttempts is how many starts of a new version may end before HealthyAfter before it is rolled back.
const MaxBootAttempts = 2

func runtimeOSArch() (string, string) { return runtime.GOOS, runtime.GOARCH }

// Pending is the marker written right before relaunching into a new version. It lives until the new version has
// run for HealthyAfter, so a build that crashes on start can be detected by the next launch and rolled back.
type Pending struct {
	Version  string `json:"version"`  // the version that was installed
	Previous string `json:"previous"` // the version it replaced (kept as ".old")
	Attempts int    `json:"attempts"` // how many times the new version has started
}

// BootAction is what to do about a pending marker at start-up.
type BootAction int

// Boot actions returned by DecideBoot.
const (
	BootNothing  BootAction = iota // no update in flight
	BootObserve                    // we are the new version: count this start and wait for HealthyAfter
	BootRollback                   // the new version keeps dying: restore the previous one
	BootClear                      // marker is stale (we are not the version it names): just delete it
)

// DecideBoot is the rollback policy as a pure function so it can be tested exhaustively.
//
// A marker naming another version than the one running means the swap never took effect (or a rollback already
// happened), so it is discarded. Otherwise the start is counted; once MaxBootAttempts starts have already failed to
// reach HealthyAfter, the next one rolls back instead of trying again.
func DecideBoot(p *Pending, current string) BootAction {
	if p == nil {
		return BootNothing
	}
	if c, err := update.CompareVersions(p.Version, current); err != nil || c != 0 {
		return BootClear
	}
	if p.Attempts >= MaxBootAttempts {
		return BootRollback
	}
	return BootObserve
}

func pendingPath(dir string) string { return filepath.Join(dir, "pending.json") }

func writePending(dir string, p Pending) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return os.WriteFile(pendingPath(dir), data, 0o600)
}

func readPending(dir string) *Pending {
	data, err := os.ReadFile(pendingPath(dir))
	if err != nil {
		return nil
	}
	var p Pending
	if json.Unmarshal(data, &p) != nil {
		return nil
	}
	return &p
}

func clearPending(dir string) { _ = os.Remove(pendingPath(dir)) }

// Boot must be called once at start-up. It finishes or undoes a previous update:
//
//   - first start of a new version: count it and schedule the "healthy" confirmation;
//   - a new version that never stayed up: roll back to ".old", relaunch it and quit;
//   - a stale marker: delete it.
//
// It returns the action taken so the caller can log it.
func (m *Manager) Boot() BootAction {
	p := readPending(m.cfg.StageDir)
	action := DecideBoot(p, m.cfg.Current)
	switch action {
	case BootClear:
		clearPending(m.cfg.StageDir)
	case BootObserve:
		p.Attempts++
		_ = writePending(m.cfg.StageDir, *p)
		m.mu.Lock()
		m.healthy = time.AfterFunc(HealthyAfter, m.markHealthy)
		m.mu.Unlock()
	case BootRollback:
		clearPending(m.cfg.StageDir)
		if err := update.Rollback(m.cfg.Target); err != nil {
			return action
		}
		if m.cfg.Relaunch != nil && m.cfg.Relaunch(m.cfg.Target, m.cfg.PID) == nil && m.cfg.Quit != nil {
			m.cfg.Quit()
		}
	}
	return action
}

// markHealthy confirms the update: the marker goes away and the backup copy is deleted.
func (m *Manager) markHealthy() {
	clearPending(m.cfg.StageDir)
	update.CleanupOld(m.cfg.Target)
}
