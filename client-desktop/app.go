package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/gen2brain/beeep"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Config holds the application configuration.
type Config struct {
	ServerURL string `json:"server_url"`
}

// App is the Wails application struct.
type App struct {
	ctx          context.Context
	config       Config
	voiceManager *VoiceManager
}

// NewApp creates the application struct.
func NewApp() *App {
	app := &App{}
	app.loadConfig()
	return app
}

// loadConfig loads the configuration from the user's config directory.
func (a *App) loadConfig() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		// Fallback to home if config dir is not available
		home, err := os.UserHomeDir()
		if err != nil {
			return
		}
		configDir = filepath.Join(home, ".cove")
	} else {
		configDir = filepath.Join(configDir, "Cove")
	}

	configPath := filepath.Join(configDir, "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &a.config)
}

// saveConfig saves the configuration to the user's config directory.
func (a *App) saveConfig() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		home, err := os.UserHomeDir()
		if err != nil {
			return
		}
		configDir = filepath.Join(home, ".cove")
	} else {
		configDir = filepath.Join(configDir, "Cove")
	}

	_ = os.MkdirAll(configDir, 0755)

	configPath := filepath.Join(configDir, "config.json")
	data, _ := json.MarshalIndent(a.config, "", "  ")
	_ = os.WriteFile(configPath, data, 0644)
}

// Startup is called when the Wails app starts.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
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

// SaveFile opens a save dialog and writes the data to the chosen path.
func (a *App) SaveFile(filename string, base64Data string) error {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: filename,
		Title:           "Save File",
	})
	if err != nil {
		return err
	}
	if path == "" {
		return nil // User cancelled
	}

	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// ShowNotification shows a native desktop notification.
func (a *App) ShowNotification(title, message string) {
	// beeep.Notify is cross-platform.
	_ = beeep.Notify(title, message, "")
}

