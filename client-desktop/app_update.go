package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"cove/desktop/internal/updater"
	"cove/update"
)

// Timing of the background update checks: a first look shortly after start-up (so launching is never slowed down),
// then a few times a day. GitHub allows 60 unauthenticated API calls an hour per IP, far above this.
const (
	updateFirstCheckDelay = 30 * time.Second
	updateCheckInterval   = 6 * time.Hour
)

// updateEvent is the Wails event the web UI listens to; its payload is an updater.State.
const updateEvent = "update:state"

// updateState groups the updater's runtime pieces so App stays readable.
type updateState struct {
	mu     sync.Mutex // guards the two preference fields in App.config that the background loop reads
	mgr    *updater.Manager
	cancel context.CancelFunc
}

// UpdateSettings is the pair of preferences shown in the desktop settings.
type UpdateSettings = updater.Settings

// updateSettings resolves the saved preferences: both default to on, except pre-releases, which default to on
// only while the app itself is a 0.x/pre-release build (every 0.x release is a GitHub pre-release).
func (a *App) updateSettings() updater.Settings {
	a.upd.mu.Lock()
	defer a.upd.mu.Unlock()
	return resolveUpdateSettings(a.config, appVersion())
}

// resolveUpdateSettings applies the defaults for unset config values.
func resolveUpdateSettings(c Config, version string) updater.Settings {
	s := updater.Settings{Enabled: true, IncludePrerelease: update.AllowPrerelease(version, false)}
	if c.AutoUpdate != nil {
		s.Enabled = *c.AutoUpdate
	}
	if c.UpdatePrerelease != nil {
		s.IncludePrerelease = *c.UpdatePrerelease
	}
	return s
}

// installTarget returns what an update replaces: the executable on Windows and Linux, the enclosing Cove.app bundle
// on macOS (exe is .../Cove.app/Contents/MacOS/Cove there). It returns "" when the layout is not a bundle, e.g.
// a bare binary run during development, in which case updates stay manual.
func installTarget(goos, exe string) string {
	if goos != "darwin" {
		return exe
	}
	dir := path.Dir(path.Dir(path.Dir(exe)))
	if strings.HasSuffix(dir, ".app") && path.Base(path.Dir(exe)) == "MacOS" {
		return dir
	}
	return ""
}

// startUpdater creates the update manager, finishes or rolls back a previous update, and starts the background
// checks. Called from Startup once the Wails context exists, because state changes are pushed as events.
func (a *App) startUpdater() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	mgr := updater.New(updater.Config{
		Client:   &update.Client{UserAgent: "cove-desktop/" + appVersion()},
		Current:  appVersion(),
		Target:   installTarget(runtime.GOOS, exe),
		StageDir: filepath.Join(dataDir(), "updates"),
		Settings: a.updateSettings,
		Emit: func(s updater.State) {
			if a.ctx != nil {
				wruntime.EventsEmit(a.ctx, updateEvent, s)
			}
		},
		Relaunch: updater.StartNew,
		Quit:     a.QuitApp,
	})
	ctx, cancel := context.WithCancel(context.Background())
	a.upd.mgr, a.upd.cancel = mgr, cancel
	mgr.Boot()
	go mgr.Run(ctx, updateFirstCheckDelay, updateCheckInterval, func(err error) {
		// Background failures are expected offline; keep them out of the UI.
		log.Printf("update check failed: %v", err)
	})
}

// stopUpdater ends the background loop.
func (a *App) stopUpdater() {
	if a.upd.cancel != nil {
		a.upd.cancel()
	}
}

// ── Exported Go→JS bindings ──────────────────────────────────────────────────

// GetUpdateState returns the updater's current state as JSON (an updater.State). The web UI also receives every
// change as an "update:state" event.
func (a *App) GetUpdateState() string {
	if a.upd.mgr == nil {
		return "{}"
	}
	data, _ := json.Marshal(a.upd.mgr.State())
	return string(data)
}

// CheckForUpdate is the "Check now" button. It starts a check (and, when something newer exists, the download) in
// the background and returns immediately; progress arrives as "update:state" events. Works even when background
// checks are switched off.
func (a *App) CheckForUpdate() {
	if a.upd.mgr == nil {
		return
	}
	go func() {
		if err := a.upd.mgr.Check(context.Background(), true); err != nil {
			log.Printf("manual update check failed: %v", err)
		}
	}()
}

// InstallUpdateAndRestart swaps in the staged update and relaunches. The web UI asks the user first and warns when
// a call or an unsent message is open; nothing in Go ever restarts the app on its own.
func (a *App) InstallUpdateAndRestart() error {
	if a.upd.mgr == nil {
		return updater.ErrBusy
	}
	return a.upd.mgr.Install()
}

// GetUpdateSettings returns the update preferences as JSON ({"enabled": bool, "include_prerelease": bool}).
func (a *App) GetUpdateSettings() string {
	data, _ := json.Marshal(a.updateSettings())
	return string(data)
}

// SetUpdateSettings saves the update preferences.
func (a *App) SetUpdateSettings(enabled, includePrerelease bool) {
	a.upd.mu.Lock()
	a.config.AutoUpdate = &enabled
	a.config.UpdatePrerelease = &includePrerelease
	a.upd.mu.Unlock()
	a.saveConfig()
}
