package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"
)

// zeroFillNewestTable overwrites the newest .sst in dir with zeros of the same length, which is what NTFS leaves
// behind when the machine loses power or the process is killed after the file size was committed but before its
// data was flushed.
func zeroFillNewestTable(t *testing.T, dir string) string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(dir, "*.sst"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no .sst files in %s (err=%v)", dir, err)
	}
	newest := files[len(files)-1]
	info, err := os.Stat(newest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newest, make([]byte, info.Size()), 0o600); err != nil {
		t.Fatal(err)
	}
	return newest
}

// A zero-filled table file used to make BadgerDB panic inside its own goroutine, killing the server with a raw stack
// trace. Open must instead return an error that names the damaged file and says how to recover.
func TestDBOpenReportsCorruptTableInsteadOfPanicking(t *testing.T) {
	dir := t.TempDir()
	dek, err := db.BootstrapDEK(filepath.Join(dir, "meta"), crypto.DeriveKEK("test-master-password"))
	if err != nil {
		t.Fatalf("BootstrapDEK: %v", err)
	}
	mainPath := filepath.Join(dir, "main")

	d, err := db.Open(mainPath, dek)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	if err := d.SetUser(&models.User{ID: "u1", Username: "alice"}); err != nil {
		t.Fatalf("SetUser: %v", err)
	}
	// Close flushes the memtable into an .sst, which is the file we then damage.
	if err := d.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	damaged := zeroFillNewestTable(t, mainPath)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("db.Open panicked instead of returning an error: %v", r)
		}
	}()
	if d2, err := db.Open(mainPath, dek); err == nil {
		_ = d2.Close()
		t.Fatal("db.Open succeeded on a database with a zero-filled table file")
	} else {
		msg := err.Error()
		if !strings.Contains(msg, filepath.Base(damaged)) && !strings.Contains(msg, "corrupt") {
			t.Fatalf("error should name the damaged table or say it is corrupt, got: %v", err)
		}
		if !strings.Contains(msg, "restore") {
			t.Fatalf("error should tell the operator how to recover (restore a backup), got: %v", err)
		}
	}
}
