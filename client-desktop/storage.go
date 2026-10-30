package main

import (
	"os"
	"path/filepath"
)

// dataDir returns the folder that holds everything the desktop app persists (server URL, session, web storage),
// like Telegram's tdata: %APPDATA%\Cove, ~/Library/Application Support/Cove or ~/.config/Cove. COVE_DATA_DIR
// overrides it for tests and portable installs.
func dataDir() string {
	if d := os.Getenv("COVE_DATA_DIR"); d != "" {
		return d
	}
	if base, err := os.UserConfigDir(); err == nil {
		return filepath.Join(base, "Cove")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".cove")
	}
	return ""
}

// writePrivateFile writes data atomically (temp file + rename) so a crash or force-kill can never leave a
// half-written config or session behind, with owner-only permissions because the session file holds a token.
func writePrivateFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func sessionPath() string { return filepath.Join(dataDir(), "session.json") }
