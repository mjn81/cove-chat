package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// downloadsDir is the user's Downloads folder; COVE_DOWNLOADS_DIR overrides it for tests.
func downloadsDir() string {
	if d := os.Getenv("COVE_DOWNLOADS_DIR"); d != "" {
		return d
	}
	return systemDownloadsDir()
}

// windowsReserved are device names Windows refuses as file names, with or without an extension.
var windowsReserved = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// sanitizeFilename turns an attacker-controlled file name into a safe base name: no directories (so "../x"
// cannot escape the downloads folder), no characters Windows forbids, no trailing dots or spaces, no reserved
// device names.
func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, `\`, "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`<>:"|?*`, r) {
			return '_'
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if name == "" {
		return "file"
	}
	stem := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if windowsReserved[stem] {
		name = "_" + name
	}
	return name
}

// uniquePath returns dir/name, or "name (1).ext", "name (2).ext"… if that already exists, so a download never
// overwrites an earlier one.
func uniquePath(dir, name string) string {
	candidate := filepath.Join(dir, name)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
		candidate = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
	}
}

// SaveFile writes a downloaded file into <Downloads>/Cove without asking, Telegram-style, and returns the
// final path so the UI can offer to reveal it.
func (a *App) SaveFile(filename string, base64Data string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(downloadsDir(), "Cove")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := uniquePath(dir, sanitizeFilename(filename))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// RevealFile shows a downloaded file in the system file manager. Only paths inside the Cove downloads folder are
// accepted, since the argument comes from the web layer.
func (a *App) RevealFile(path string) error {
	root := filepath.Join(downloadsDir(), "Cove")
	rel, err := filepath.Rel(root, filepath.Clean(path))
	if err != nil || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("path is outside the downloads folder")
	}
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", "/select,", filepath.Clean(path)).Start()
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}
