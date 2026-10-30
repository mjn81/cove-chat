package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/gen2brain/beeep"
)

// Config holds the application configuration.
type Config struct {
	ServerURL string `json:"server_url"`
	// CloseToTray keeps Cove running in the background when the window is closed. Nil means the default (on).
	CloseToTray *bool `json:"close_to_tray,omitempty"`
}

// App is the Wails application struct.
type App struct {
	ctx          context.Context
	config       Config
	voiceManager *VoiceManager
	secrets      secretStore
	vault        vaultState
	win          windowState
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
}

// DomReady is called after the frontend DOM is fully loaded.
func (a *App) DomReady(ctx context.Context) {
}

// Shutdown is called when the Wails app is about to exit.
func (a *App) Shutdown(ctx context.Context) {
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
	return "0.9.0"
}

// ShowNotification shows a native desktop notification.
func (a *App) ShowNotification(title, message string) {
	// beeep.Notify is cross-platform.
	_ = beeep.Notify(title, message, "")
}

