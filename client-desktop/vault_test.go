package main

import (
	"os"
	"strings"
	"sync"
	"testing"
)

// memSecrets is an in-memory secretStore standing in for the OS keystore.
type memSecrets struct {
	mu sync.Mutex
	m  map[string]string
}

func newMemSecrets() *memSecrets { return &memSecrets{m: map[string]string{}} }

func (s *memSecrets) Get(name string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.m[name]; ok {
		return v, nil
	}
	return "", errSecretNotFound
}
func (s *memSecrets) Set(name, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[name] = value
	return nil
}
func (s *memSecrets) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, name)
	return nil
}

// restart simulates quitting and relaunching the app against the same keystore and data folder.
func restart(a *App, s *memSecrets) *App { return NewAppWithSecrets(s) }

func testApp(t *testing.T) (*App, *memSecrets) {
	t.Helper()
	t.Setenv("COVE_DATA_DIR", t.TempDir())
	s := newMemSecrets()
	return NewAppWithSecrets(s), s
}

func TestSessionLivesInKeystoreNotOnDisk(t *testing.T) {
	a, secrets := testApp(t)
	a.SaveSession("tok-123")

	if _, err := os.Stat(sessionPath()); err == nil {
		t.Fatal("the token must not be written to a plaintext file")
	}
	if got := restart(a, secrets).GetSession(); got != "tok-123" {
		t.Fatalf("session after restart = %q", got)
	}
	a.ClearSession()
	if got := restart(a, secrets).GetSession(); got != "" {
		t.Fatalf("session after clear = %q", got)
	}
}

func TestLegacySessionFileMovesIntoKeystore(t *testing.T) {
	t.Setenv("COVE_DATA_DIR", t.TempDir())
	if err := os.WriteFile(sessionPath(), []byte("legacy-token"), 0o600); err != nil {
		t.Fatal(err)
	}
	secrets := newMemSecrets()
	a := NewAppWithSecrets(secrets)

	if got := a.GetSession(); got != "legacy-token" {
		t.Fatalf("migrated session = %q", got)
	}
	if _, err := os.Stat(sessionPath()); err == nil {
		t.Fatal("the plaintext session file must be deleted after migration")
	}
}

func TestCacheKeyIsRandomStableAndSized(t *testing.T) {
	a, secrets := testApp(t)
	k1, err := a.GetCacheKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(k1) != 44 { // base64 of 32 bytes
		t.Fatalf("cache key length = %d, want a base64 AES-256 key", len(k1))
	}
	if k2, _ := restart(a, secrets).GetCacheKey(); k2 != k1 {
		t.Fatal("the cache key must stay the same across restarts or the cache becomes unreadable")
	}
	b, _ := testApp(t)
	if kb, _ := b.GetCacheKey(); kb == k1 {
		t.Fatal("cache keys must be random per installation")
	}
}

func TestPasscodeProtectsSecretsAtRest(t *testing.T) {
	a, secrets := testApp(t)
	a.SaveSession("tok-123")
	key, _ := a.GetCacheKey()

	if err := a.SetPasscode("", "1234"); err != nil {
		t.Fatal(err)
	}
	for name, v := range secrets.m {
		if strings.Contains(v, "tok-123") || strings.Contains(v, key) {
			t.Fatalf("secret %q is still stored in the clear after setting a passcode", name)
		}
	}
	if got := a.GetSession(); got != "tok-123" {
		t.Fatalf("unlocked session = %q (setting a passcode leaves the app unlocked)", got)
	}

	// A relaunch starts locked: nothing is readable until the passcode is entered.
	b := restart(a, secrets)
	if st := b.lockStatus(); !st.Enabled || !st.Locked {
		t.Fatalf("status after restart = %+v", st)
	}
	if got := b.GetSession(); got != "" {
		t.Fatalf("a locked app handed out the session: %q", got)
	}
	if _, err := b.GetCacheKey(); err == nil {
		t.Fatal("a locked app handed out the cache key")
	}
	if err := b.Unlock("0000"); err == nil {
		t.Fatal("wrong passcode must not unlock")
	}
	if err := b.Unlock("1234"); err != nil {
		t.Fatal(err)
	}
	if got := b.GetSession(); got != "tok-123" {
		t.Fatalf("session after unlock = %q", got)
	}
	if k, _ := b.GetCacheKey(); k != key {
		t.Fatal("unlocking must expose the same cache key")
	}
}

func TestLockForgetsKeysInMemory(t *testing.T) {
	a, _ := testApp(t)
	a.SaveSession("tok-123")
	if err := a.SetPasscode("", "1234"); err != nil {
		t.Fatal(err)
	}
	a.Lock()
	if got := a.GetSession(); got != "" {
		t.Fatalf("session available while locked: %q", got)
	}
	if !a.lockStatus().Locked {
		t.Fatal("status must report locked")
	}
}

func TestChangeAndRemovePasscode(t *testing.T) {
	a, secrets := testApp(t)
	a.SaveSession("tok-123")
	if err := a.SetPasscode("", "1234"); err != nil {
		t.Fatal(err)
	}
	if err := a.SetPasscode("wrong", "5678"); err == nil {
		t.Fatal("changing the passcode requires the current one")
	}
	if err := a.SetPasscode("1234", "5678"); err != nil {
		t.Fatal(err)
	}
	b := restart(a, secrets)
	if err := b.Unlock("1234"); err == nil {
		t.Fatal("the old passcode must stop working")
	}
	if err := b.Unlock("5678"); err != nil {
		t.Fatal(err)
	}

	if err := b.RemovePasscode("nope"); err == nil {
		t.Fatal("removing the passcode requires the current one")
	}
	if err := b.RemovePasscode("5678"); err != nil {
		t.Fatal(err)
	}
	c := restart(b, secrets)
	if st := c.lockStatus(); st.Enabled || st.Locked {
		t.Fatalf("status after removal = %+v", st)
	}
	if got := c.GetSession(); got != "tok-123" {
		t.Fatalf("session after removing the passcode = %q", got)
	}
}

func TestPasscodeTooShortRejected(t *testing.T) {
	a, _ := testApp(t)
	if err := a.SetPasscode("", "12"); err == nil {
		t.Fatal("a 2-character passcode must be rejected")
	}
}

func TestRepeatedWrongPasscodesAreThrottled(t *testing.T) {
	a, secrets := testApp(t)
	if err := a.SetPasscode("", "1234"); err != nil {
		t.Fatal(err)
	}
	b := restart(a, secrets)
	var last error
	for i := 0; i < maxFreeAttempts+1; i++ {
		last = b.Unlock("0000")
	}
	if last == nil || !strings.Contains(last.Error(), "try again") {
		t.Fatalf("expected a throttling error after repeated failures, got %v", last)
	}
	// Even the right passcode is refused during the lock-out, so guessing cannot be sped up.
	if err := b.Unlock("1234"); err == nil {
		t.Fatal("unlock must be refused during the lock-out")
	}
}

func TestAutoLockSetting(t *testing.T) {
	a, secrets := testApp(t)
	if err := a.SetPasscode("", "1234"); err != nil {
		t.Fatal(err)
	}
	a.SetAutoLock(5)
	if got := restart(a, secrets).lockStatus().AutoLockMinutes; got != 5 {
		t.Fatalf("auto-lock minutes = %d", got)
	}
}
