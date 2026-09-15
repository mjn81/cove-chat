package tests

import (
	"os"
	"testing"

	"nodetalk/backend/internal/config"
)

func TestLoadDefaults(t *testing.T) {
	// Note: cannot use t.Parallel() with t.Setenv
	t.Setenv("NODETALK_CONFIG", "/tmp/nodetalk_test_nonexistent.toml")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Server.HTTPPort == 0 {
		t.Error("HTTPPort should default to non-zero")
	}
	if cfg.RateLimit.GlobalRPS == 0 {
		t.Error("GlobalRPS should default to non-zero")
	}
	if cfg.Security.MasterPassword == "" {
		t.Error("MasterPassword should be auto-generated when empty")
	}
	// Clean up the potentially generated config.toml
	os.Remove("/tmp/nodetalk_test_nonexistent.toml")
}

// TestPersistedConfigHasRestrictivePermissions guards against the config
// file (which stores the master password in plaintext) being created with
// permissions wider than owner-only, since os.Create alone is subject to
// the process umask and can leave it world-readable on a permissively
// configured host.
func TestPersistedConfigHasRestrictivePermissions(t *testing.T) {
	path := "/tmp/nodetalk_test_perms.toml"
	t.Setenv("NODETALK_CONFIG", path)
	defer os.Remove(path)

	if _, err := config.Load(); err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("expected config file to be persisted: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("config file permissions = %o, want %o (owner read/write only)", perm, 0600)
	}
}

func TestEnvVarOverride(t *testing.T) {
	// Note: cannot use t.Parallel() with t.Setenv
	t.Setenv("NODETALK_CONFIG", "/tmp/nodetalk_test_env.toml")
	t.Setenv("NODETALK_MASTER_PASSWORD", "env-override-password")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Security.MasterPassword != "env-override-password" {
		t.Errorf("MasterPassword = %q, want %q", cfg.Security.MasterPassword, "env-override-password")
	}
	os.Remove("/tmp/nodetalk_test_env.toml")
}
