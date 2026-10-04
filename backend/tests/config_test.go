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

// TestVoiceDefaultsAndTURNSecretGenerated guards the new [voice] section:
// sane defaults for a fresh install, and — since embedded_turn_enabled
// defaults to true — a random TURN shared secret generated and persisted
// the same way as master_password, never left empty or defaulted to a
// fixed value.
func TestVoiceDefaultsAndTURNSecretGenerated(t *testing.T) {
	path := "/tmp/nodetalk_test_voice.toml"
	t.Setenv("NODETALK_CONFIG", path)
	defer os.Remove(path)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Voice.Mode != "webrtc" {
		t.Errorf("Voice.Mode = %q, want %q", cfg.Voice.Mode, "webrtc")
	}
	if cfg.Voice.MaxParticipantsPerCall != 10 {
		t.Errorf("Voice.MaxParticipantsPerCall = %d, want 10", cfg.Voice.MaxParticipantsPerCall)
	}
	// "webrtc" mode is the internet-capable engine — genuinely isolated/
	// air-gapped deployments are expected to use mode = "raw_udp" instead,
	// so it's fine for this default to assume internet access and
	// auto-detect the public IP via STUN rather than requiring manual setup.
	if cfg.Voice.PublicIP != "auto" {
		t.Errorf("Voice.PublicIP = %q, want %q", cfg.Voice.PublicIP, "auto")
	}
	if cfg.Voice.TURNSharedSecret == "" {
		t.Error("Voice.TURNSharedSecret should be auto-generated when embedded TURN is enabled")
	}

	// Reloading from the now-persisted file must reuse the same secret
	// rather than regenerating a new one on every restart.
	cfg2, err := config.Load()
	if err != nil {
		t.Fatalf("second Load() error = %v", err)
	}
	if cfg2.Voice.TURNSharedSecret != cfg.Voice.TURNSharedSecret {
		t.Error("TURN shared secret changed across reloads instead of being persisted")
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
