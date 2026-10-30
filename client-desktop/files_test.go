package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSanitizeFilename(t *testing.T) {
	cases := map[string]string{
		"photo.png":          "photo.png",
		`..\..\evil.exe`:     "evil.exe",
		"../../etc/passwd":   "passwd",
		`bad:name*?"<>|.txt`: "bad_name______.txt",
		"  spaced.txt. ":     "spaced.txt",
		"":                   "file",
		"..":                 "file",
		"CON":                "_CON",
		"nul.txt":            "_nul.txt",
		"گزارش نهایی.pdf":    "گزارش نهایی.pdf",
	}
	for in, want := range cases {
		if got := sanitizeFilename(in); got != want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUniquePathAddsCounter(t *testing.T) {
	dir := t.TempDir()
	first := uniquePath(dir, "a.txt")
	if first != filepath.Join(dir, "a.txt") {
		t.Fatalf("first = %q", first)
	}
	if err := os.WriteFile(first, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	second := uniquePath(dir, "a.txt")
	if second != filepath.Join(dir, "a (1).txt") {
		t.Fatalf("second = %q", second)
	}
}

func TestServerURLPersistsOnDisk(t *testing.T) {
	t.Setenv("COVE_DATA_DIR", t.TempDir())
	NewApp().SaveServerURL("https://chat.example.com")
	if got := NewApp().GetServerURL(); got != "https://chat.example.com" {
		t.Fatalf("server url after restart = %q", got)
	}
}

func TestSaveFileGoesToDownloadsFolder(t *testing.T) {
	dl := t.TempDir()
	t.Setenv("COVE_DOWNLOADS_DIR", dl)
	a := NewApp()
	path, err := a.SaveFile("../hello.txt", "aGk=") // "hi"
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dl, "Cove", "hello.txt")
	if path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
	if b, _ := os.ReadFile(path); string(b) != "hi" {
		t.Fatalf("content = %q", b)
	}
	again, _ := a.SaveFile("hello.txt", "aGk=")
	if again != filepath.Join(dl, "Cove", "hello (1).txt") {
		t.Fatalf("second save = %q", again)
	}
}
