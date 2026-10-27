package tests

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"nodetalk/backend/internal/config"
)

const sampleConfig = `# Cove Configuration File
[server]
# The public domain name of this node.
domain = "localhost"
http_port = 4000 # keep in sync with the proxy

[registration]
# open | invite_only | closed
mode = "open"

[rate_limit]
global_rps = 100
`

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPatchFileReplacesValuesAndKeepsComments(t *testing.T) {
	path := writeTemp(t, sampleConfig)

	err := config.PatchFile(path, []config.Change{
		{Section: "registration", Key: "mode", Value: "invite_only"},
		{Section: "server", Key: "http_port", Value: 8080},
	})
	if err != nil {
		t.Fatalf("PatchFile: %v", err)
	}

	raw, _ := os.ReadFile(path)
	text := string(raw)
	for _, want := range []string{
		"# Cove Configuration File",
		"# The public domain name of this node.",
		"# open | invite_only | closed",
		`mode = "invite_only"`,
		"http_port = 8080",
		`domain = "localhost"`,
		"global_rps = 100",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("patched file is missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, `mode = "open"`) {
		t.Errorf("old value still present:\n%s", text)
	}
}

func TestPatchFileAddsMissingKeyAndSection(t *testing.T) {
	path := writeTemp(t, sampleConfig)

	err := config.PatchFile(path, []config.Change{
		{Section: "server", Key: "max_file_size_mb", Value: 250},
		{Section: "admin", Key: "owner_username", Value: "alice"},
		{Section: "registration", Key: "allowed", Value: []string{"a", "b"}},
	})
	if err != nil {
		t.Fatalf("PatchFile: %v", err)
	}

	cfg := loadConfigFrom(t, path)
	if cfg.Server.MaxFileSizeMB != 250 {
		t.Errorf("max_file_size_mb = %d, want 250", cfg.Server.MaxFileSizeMB)
	}
	if cfg.Admin.OwnerUsername != "alice" {
		t.Errorf("owner_username = %q, want alice", cfg.Admin.OwnerUsername)
	}
}

func TestPatchFileKeepsKeysInsideTheirOwnSection(t *testing.T) {
	// "mode" exists under [registration]; patching [voice] mode must not touch it.
	path := writeTemp(t, sampleConfig+"\n[voice]\nmode = \"webrtc\"\n")

	if err := config.PatchFile(path, []config.Change{{Section: "voice", Key: "mode", Value: "raw_udp"}}); err != nil {
		t.Fatalf("PatchFile: %v", err)
	}
	cfg := loadConfigFrom(t, path)
	if cfg.Registration.Mode != "open" {
		t.Errorf("registration.mode changed to %q", cfg.Registration.Mode)
	}
	if cfg.Voice.Mode != "raw_udp" {
		t.Errorf("voice.mode = %q, want raw_udp", cfg.Voice.Mode)
	}
}

func TestPatchFileRejectsInvalidResultAndLeavesFileUntouched(t *testing.T) {
	path := writeTemp(t, sampleConfig)

	// A string where the schema expects an integer makes the file undecodable.
	err := config.PatchFile(path, []config.Change{{Section: "server", Key: "http_port", Value: "not-a-number"}})
	if err == nil {
		t.Fatal("expected an error for an invalid value")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != sampleConfig {
		t.Errorf("file was modified despite the error:\n%s", raw)
	}
}

func TestPatchFileEscapesStringsAndKeepsBackup(t *testing.T) {
	path := writeTemp(t, sampleConfig)

	tricky := `he said "hi" \ # not a comment`
	if err := config.PatchFile(path, []config.Change{{Section: "server", Key: "domain", Value: tricky}}); err != nil {
		t.Fatalf("PatchFile: %v", err)
	}
	// Read the backup first: loading the config below may patch the file again.
	bak, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf("expected a .bak of the previous file: %v", err)
	}
	if string(bak) != sampleConfig {
		t.Errorf(".bak does not contain the previous content")
	}
	if got := loadConfigFrom(t, path).Server.Domain; got != tricky {
		t.Errorf("domain round-trip = %q, want %q", got, tricky)
	}
}

func TestPatchFileCreatesMissingFileWithOwnerOnlyPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "new.toml")
	if err := config.PatchFile(path, []config.Change{{Section: "registration", Key: "mode", Value: "closed"}}); err != nil {
		t.Fatalf("PatchFile: %v", err)
	}
	if got := loadConfigFrom(t, path).Registration.Mode; got != "closed" {
		t.Errorf("mode = %q, want closed", got)
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(path)
		if perm := info.Mode().Perm(); perm != 0600 {
			t.Errorf("permissions = %o, want 0600", perm)
		}
	}
}

func TestLoadRejectsUnknownRegistrationMode(t *testing.T) {
	path := writeTemp(t, "[registration]\nmode = \"whatever\"\n")
	t.Setenv("NODETALK_CONFIG", path)
	t.Setenv("NODETALK_MASTER_PASSWORD", "x")
	if _, err := config.Load(); err == nil {
		t.Fatal("expected Load to reject an unknown registration mode")
	}
}

func TestLoadDefaultsToOpenRegistrationAndParsesStaticInvites(t *testing.T) {
	path := writeTemp(t, "[server]\ndomain = \"x\"\n")
	t.Setenv("NODETALK_CONFIG", path)
	t.Setenv("NODETALK_MASTER_PASSWORD", "x")
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Registration.Mode != "open" {
		t.Errorf("default mode = %q, want open", cfg.Registration.Mode)
	}

	path = writeTemp(t, `[registration]
mode = "invite_only"

[[registration.invites]]
code = "welcome-2026"
expires_at = "2026-12-31T23:59:59Z"
max_uses = 25
note = "launch"
`)
	t.Setenv("NODETALK_CONFIG", path)
	cfg, err = config.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Registration.Invites) != 1 || cfg.Registration.Invites[0].Code != "welcome-2026" || cfg.Registration.Invites[0].MaxUses != 25 {
		t.Errorf("static invites not parsed: %+v", cfg.Registration.Invites)
	}
}

// loadConfigFrom loads a config file without letting Load() mutate it (a
// master password is supplied through the environment).
func loadConfigFrom(t *testing.T, path string) *config.Config {
	t.Helper()
	t.Setenv("NODETALK_CONFIG", path)
	t.Setenv("NODETALK_MASTER_PASSWORD", "test-master-password")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load(%s): %v", path, err)
	}
	return cfg
}
