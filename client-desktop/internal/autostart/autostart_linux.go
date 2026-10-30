//go:build linux

package autostart

import (
	"os"
	"path/filepath"
)

func entryPath() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg, "autostart", "cove.desktop"), nil
}

// Enabled reports whether the autostart entry exists.
func Enabled() bool {
	p, err := entryPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// Set writes or removes ~/.config/autostart/cove.desktop.
func Set(enabled bool, exe string) error {
	p, err := entryPath()
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
	return os.WriteFile(p, []byte(desktopEntry(exe)), 0o644)
}
