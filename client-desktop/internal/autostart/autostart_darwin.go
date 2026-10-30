//go:build darwin

package autostart

import (
	"os"
	"path/filepath"
)

func plistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", "com.cove.chat.desktop.plist"), nil
}

// Enabled reports whether the LaunchAgent exists.
func Enabled() bool {
	p, err := plistPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// Set writes or removes the LaunchAgent; macOS picks it up at the next login.
func Set(enabled bool, exe string) error {
	p, err := plistPath()
	if err != nil {
		return err
	}
	if !enabled {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(launchAgentPlist(exe)), 0o644)
}
