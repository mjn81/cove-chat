package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"cove/desktop/internal/popup"
	"cove/desktop/internal/tray"
)

// Config holds the application configuration.
type Config struct {
	ServerURL string `json:"server_url"`
	// CloseToTray keeps Cove running in the background when the window is closed. Nil means the default (on).
	CloseToTray *bool `json:"close_to_tray,omitempty"`
	// AutoUpdate turns the background update checks on. Nil means the default (on).
	AutoUpdate *bool `json:"auto_update,omitempty"`
	// UpdatePrerelease offers pre-releases. Nil means on while the app is a 0.x/pre-release build, off otherwise.
	UpdatePrerelease *bool `json:"update_prerelease,omitempty"`
	// AutoDownload lets the background check also download updates. Nil means off: checking is automatic,
	// downloading and installing are the user's choice.
	AutoDownload *bool `json:"auto_download,omitempty"`
	// UpdateManifestURL overrides the update source (mirrors, air-gapped networks). Empty means Cove's own domain.
	UpdateManifestURL string `json:"update_manifest_url,omitempty"`
	// CustomNotifications shows Cove's own popups instead of system notifications (Windows and Linux). Nil means on.
	CustomNotifications *bool `json:"custom_notifications,omitempty"`
	// NotificationCorner is the screen corner popups stack from; empty means bottom-right.
	NotificationCorner string `json:"notification_corner,omitempty"`
}

// App is the Wails application struct.
type App struct {
	ctx          context.Context
	config       Config
	voiceManager *VoiceManager
	secrets      secretStore
	vault        vaultState
	win          windowState
	upd          updateState
	popupOnce    sync.Once
	popups       *popup.Manager
}

// NewApp creates the application struct.
func NewApp() *App { return NewAppWithSecrets(newResilientStore(keyringStore{})) }

// NewAppWithSecrets creates the application struct on top of a given secret store (the OS keystore in
// production, an in-memory fake in tests), then loads the saved config and migrates any legacy plaintext session.
func NewAppWithSecrets(secrets secretStore) *App {
	app := &App{secrets: secrets}
	app.loadConfig()
	app.migrateLegacySession()
	return app
}

func configPath() string { return filepath.Join(dataDir(), "config.json") }

// loadConfig loads the configuration from the app data folder.
func (a *App) loadConfig() {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &a.config)
}

// saveConfig persists the configuration to the app data folder.
func (a *App) saveConfig() {
	data, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		return
	}
	_ = writePrivateFile(configPath(), data)
}

// Startup is called when the Wails app starts.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.startTray()
	a.startTaskbarTheme()
	a.startUpdater()
}

// DomReady is called after the frontend DOM is fully loaded.
func (a *App) DomReady(ctx context.Context) {
}

// Shutdown is called when the Wails app is about to exit.
func (a *App) Shutdown(ctx context.Context) {
	a.stopUpdater()
	a.notifier().Close()
	tray.Stop()
}

// ── Exported Go→JS bindings ──────────────────────────────────────────────────

// GetServerURL returns the saved server URL.
func (a *App) GetServerURL() string {
	return a.config.ServerURL
}

// SaveServerURL saves the server URL and persists it.
func (a *App) SaveServerURL(url string) {
	a.config.ServerURL = url
	a.saveConfig()
}

// AppVersion returns the desktop app version.
func (a *App) AppVersion() string {
	return appVersion()
}
