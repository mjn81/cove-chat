package tests

import (
	"os"
	"path/filepath"
	"testing"

	"cove/backend/internal/config"
	"cove/update"
)

func TestUpdateConfigDefaultsAndOverrides(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("[update]\nmanifest_url = \"https://mirror.test/m.json\"\ngithub_fallback = false\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Update.ManifestURL != "https://mirror.test/m.json" || cfg.Update.GitHubFallback || !cfg.Update.NotifyAdmins {
		t.Errorf("update config = %+v", cfg.Update)
	}

	def, err := config.Read(filepath.Join(dir, "missing.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if def.Update.ManifestURL != update.DefaultManifestURL || !def.Update.GitHubFallback || !def.Update.NotifyAdmins {
		t.Errorf("defaults = %+v", def.Update)
	}
}

func TestUpdateSettingsAreOwnerOnlyEditable(t *testing.T) {
	for _, key := range []string{"update.manifest_url", "update.github_fallback"} {
		s, ok := config.LookupSetting(key)
		if !ok || !s.OwnerOnly || !s.RestartRequired {
			t.Errorf("%s = %+v ok=%v, want owner-only + restart", key, s, ok)
		}
	}
	if _, ok := config.LookupSetting("update.notify_admins"); !ok {
		t.Error("update.notify_admins is not editable")
	}
}
