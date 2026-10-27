package tests

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"nodetalk/backend/internal/api"
)

const testPassphrase = "a-long-archive-passphrase"

func TestBackupIsEncryptedAndRestorable(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	resp := e.do(t, "POST", "/api/admin/backup", owner, map[string]any{"password": testPassword, "passphrase": testPassphrase})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("backup = %d, want 200", resp.StatusCode)
	}
	archive, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if len(archive) == 0 || containsBytes(archive, []byte("owner")) {
		t.Fatal("archive is empty or leaks plaintext usernames")
	}
	if _, err := api.DecryptBackup(archive, "wrong-passphrase-here"); err == nil {
		t.Error("wrong passphrase decrypted the archive")
	}
	plain, err := api.DecryptBackup(archive, testPassphrase)
	if err != nil || len(plain) == 0 {
		t.Fatalf("decrypt with the right passphrase: %v", err)
	}
	archive[len(archive)-1] ^= 0xff
	if _, err := api.DecryptBackup(archive, testPassphrase); err == nil {
		t.Error("tampered archive was accepted")
	}
}

func containsBytes(hay, needle []byte) bool {
	for i := 0; i+len(needle) <= len(hay); i++ {
		if string(hay[i:i+len(needle)]) == string(needle) {
			return true
		}
	}
	return false
}

func TestBackupValidation(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	if got := e.do(t, "POST", "/api/admin/backup", owner, map[string]any{"password": "wrong", "passphrase": testPassphrase}); got.StatusCode != http.StatusForbidden {
		t.Errorf("wrong password = %d, want 403", got.StatusCode)
	}
	if got := e.do(t, "POST", "/api/admin/backup", owner, map[string]any{"password": testPassword, "passphrase": "short"}); got.StatusCode != http.StatusBadRequest {
		t.Errorf("short passphrase = %d, want 400", got.StatusCode)
	}
}

func TestResetKeepsOnlyTheOwner(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, admin, member := e.seedRoles(t)

	upload := filepath.Join(e.dataDir, "uploads")
	_ = os.MkdirAll(upload, 0o755)
	_ = os.WriteFile(filepath.Join(upload, "blob"), []byte("x"), 0o600)

	if got := e.do(t, "POST", "/api/admin/reset", owner, map[string]any{"password": testPassword, "confirm": "nope"}); got.StatusCode != http.StatusBadRequest {
		t.Fatalf("wrong phrase = %d, want 400", got.StatusCode)
	}
	if got := e.do(t, "POST", "/api/admin/reset", owner, map[string]any{"password": testPassword, "confirm": "RESET"}); got.StatusCode != http.StatusOK {
		t.Fatalf("reset = %d, want 200", got.StatusCode)
	}

	if _, err := e.store.GetUserByUsername("member"); err == nil {
		t.Error("member survived the reset")
	}
	if got := e.do(t, "GET", "/api/me", member, nil); got.StatusCode != http.StatusUnauthorized {
		t.Errorf("member token after reset = %d, want 401", got.StatusCode)
	}
	if got := e.do(t, "GET", "/api/admin/overview", admin, nil); got.StatusCode == http.StatusOK {
		t.Error("admin token still works after reset")
	}
	if got := e.do(t, "GET", "/api/admin/overview", owner, nil); got.StatusCode != http.StatusOK {
		t.Errorf("owner after reset = %d, want 200", got.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(upload, "blob")); err == nil {
		t.Error("uploads were not wiped")
	}
	// Fresh sign-ups are open again and do not steal the owner role.
	e.mustRegister(t, "fresh")
	if u, _ := e.store.GetUserByUsername("fresh"); u.ServerRole != "" {
		t.Errorf("new account got role %q", u.ServerRole)
	}
}

func TestDeleteServerNeedsTheDomainAndStopsTheProcess(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	if got := e.do(t, "POST", "/api/admin/delete", owner, map[string]any{"password": testPassword, "confirm": "wrong.example"}); got.StatusCode != http.StatusBadRequest {
		t.Fatalf("wrong domain = %d, want 400", got.StatusCode)
	}
	select {
	case <-e.stopped:
		t.Fatal("shutdown fired without confirmation")
	default:
	}
	if got := e.do(t, "POST", "/api/admin/delete", owner, map[string]any{"password": testPassword, "confirm": "chat.test"}); got.StatusCode != http.StatusOK {
		t.Fatalf("delete = %d, want 200", got.StatusCode)
	}
	select {
	case <-e.stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not shut down")
	}
	if _, err := e.store.GetUserByUsername("owner"); err == nil {
		t.Error("owner record survived delete")
	}
}

func TestDangerousActionsLockAfterRepeatedWrongPasswords(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	var last int
	for i := 0; i < 6; i++ {
		resp := e.do(t, "POST", "/api/admin/reset", owner, map[string]any{"password": "bad", "confirm": "RESET"})
		last = resp.StatusCode
		resp.Body.Close()
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("6th wrong attempt = %d, want 429", last)
	}
	// Even the right password is refused while locked.
	if got := e.do(t, "POST", "/api/admin/reset", owner, map[string]any{"password": testPassword, "confirm": "RESET"}); got.StatusCode != http.StatusTooManyRequests {
		t.Errorf("right password while locked = %d, want 429", got.StatusCode)
	}
}

func TestBackupRestoresIntoAFreshServer(t *testing.T) {
	src := newAdminEnv(t, "open")
	owner, _, _ := src.seedRoles(t)
	resp := src.do(t, "POST", "/api/admin/backup", owner, map[string]any{"password": testPassword, "passphrase": testPassphrase})
	archive, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	plain, err := api.DecryptBackup(archive, testPassphrase)
	if err != nil {
		t.Fatal(err)
	}

	dst := newAdminEnv(t, "open")
	if err := dst.store.Restore(bytes.NewReader(plain)); err != nil {
		t.Fatalf("restore: %v", err)
	}
	u, err := dst.store.GetUserByUsername("admin")
	if err != nil || u.ServerRole != "admin" {
		t.Fatalf("restored admin = %v, %v", u, err)
	}
	if !dst.store.HasOwner() {
		t.Error("owner marker not restored")
	}
}
