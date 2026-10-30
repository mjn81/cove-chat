//go:build !windows && !linux

// Package tray is a no-op outside Windows and Linux (macOS uses the Dock).
package tray

// Options mirrors the Windows/Linux type so callers compile on every platform.
// Toggle mirrors the Windows/Linux type.
type Toggle struct {
	Label    string
	Checked  bool
	OnToggle func(enabled bool)
}

type Options struct {
	Icon      []byte
	Tooltip   string
	ShowLabel string
	Toggles   []Toggle
	QuitLabel string
	OnShow    func()
	OnQuit    func()
}

// Start is a no-op where there is no tray.
func Start(Options) bool { return false }

// SetIcon is a no-op where there is no tray.
func SetIcon([]byte) {}

// Stop is a no-op where there is no tray.
func Stop() {}
