package main

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// systemDownloadsDir asks Windows for the real Downloads folder, which users can relocate away from
// %USERPROFILE%\Downloads.
func systemDownloadsDir() string {
	if p, err := windows.KnownFolderPath(windows.FOLDERID_Downloads, 0); err == nil && p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads")
}
