//go:build !windows

package main

import (
	"os"
	"path/filepath"
)

// systemDownloadsDir is ~/Downloads, the default on macOS and most Linux desktops.
func systemDownloadsDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads")
}
