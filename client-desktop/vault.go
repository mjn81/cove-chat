package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/argon2"
)

const (
	secretSession  = "session"
	secretCacheKey = "cache-key"

	// sealedPrefix marks a secret that is additionally encrypted under the passcode-derived key.
	sealedPrefix = "pc1:"
	// verifierText is encrypted under the passcode key to check a passcode without storing it.
	verifierText = "cove-lock-ok"

	minPasscodeLen = 4
	// maxFreeAttempts wrong passcodes are allowed before unlocking is throttled with growing delays.
	maxFreeAttempts = 5
	maxLockoutDelay = 15 * time.Minute
)

var (
	errLocked            = errors.New("app is locked")
	errIncorrectPasscode = errors.New("incorrect passcode")
)

// lockFile is the non-secret passcode configuration kept in the data folder: the Argon2 salt, a verifier that
// proves a passcode is right, and the auto-lock timeout. The passcode itself is never stored.
type lockFile struct {
	Salt            string `json:"salt"`
	Verifier        string `json:"verifier"`
	AutoLockMinutes int    `json:"auto_lock_minutes"`
}

// vaultState is the in-memory half of the passcode lock: the wrapping key while unlocked, and the failed-attempt
// throttle. Nothing here is persisted.
type vaultState struct {
	mu           sync.Mutex
	key          []byte
	failures     int
	blockedUntil time.Time
}

// LockStatus describes the passcode lock to the UI.
type LockStatus struct {
	Enabled         bool `json:"enabled"`
	Locked          bool `json:"locked"`
	AutoLockMinutes int  `json:"auto_lock_minutes"`
	// SecureStorage is false when the OS keystore is unavailable and secrets only live until the app quits.
	SecureStorage bool `json:"secure_storage"`
}

func lockPath() string { return filepath.Join(dataDir(), "lock.json") }

func loadLock() (*lockFile, bool) {
	b, err := os.ReadFile(lockPath())
	if err != nil {
		return nil, false
	}
	var lf lockFile
	if json.Unmarshal(b, &lf) != nil || lf.Salt == "" || lf.Verifier == "" {
		return nil, false
	}
	return &lf, true
}

func saveLock(lf *lockFile) error {
	b, err := json.Marshal(lf)
	if err != nil {
		return err
	}
	return writePrivateFile(lockPath(), b)
}

// deriveKey stretches a passcode into a 256-bit key. Argon2id with 64 MiB makes offline guessing of a short
// passcode expensive even for someone holding the keystore entries.
func deriveKey(passcode string, salt []byte) []byte {
	return argon2.IDKey([]byte(passcode), salt, 3, 64*1024, 4, 32)
}

func sealWith(key []byte, plain string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func openWith(key []byte, sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("sealed value too short")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

// unlockedKey returns the wrapping key, or errLocked when a passcode is set but not yet entered.
func (a *App) unlockedKey() ([]byte, error) {
	a.vault.mu.Lock()
	defer a.vault.mu.Unlock()
	if a.vault.key == nil {
		return nil, errLocked
	}
	return append([]byte(nil), a.vault.key...), nil
}

// readSecret returns the plaintext of a stored secret, decrypting it under the passcode key when it is sealed.
func (a *App) readSecret(name string) (string, error) {
	raw, err := a.secrets.Get(name)
	if err != nil {
		return "", err
	}
	body, sealed := strings.CutPrefix(raw, sealedPrefix)
	if !sealed {
		return raw, nil
	}
	key, err := a.unlockedKey()
	if err != nil {
		return "", err
	}
	return openWith(key, body)
}

// writeSecret stores a secret, sealing it under the passcode key whenever a passcode is set.
func (a *App) writeSecret(name, value string) error {
	if _, enabled := loadLock(); enabled {
		key, err := a.unlockedKey()
		if err != nil {
			return err
		}
		sealed, err := sealWith(key, value)
		if err != nil {
			return err
		}
		return a.secrets.Set(name, sealedPrefix+sealed)
	}
	return a.secrets.Set(name, value)
}

// GetSession returns the saved session token, or "" when signed out or while the app is locked.
func (a *App) GetSession() string {
	v, err := a.readSecret(secretSession)
	if err != nil {
		return ""
	}
	return v
}

// SaveSession stores the session token in the OS keystore so the user stays signed in across restarts.
func (a *App) SaveSession(token string) {
	if token == "" {
		a.ClearSession()
		return
	}
	_ = a.writeSecret(secretSession, token)
}

// ClearSession forgets the saved session (sign out).
func (a *App) ClearSession() {
	_ = a.secrets.Delete(secretSession)
}

// GetCacheKey returns the base64 AES-256 key the web layer uses to encrypt its on-disk message and file cache,
// creating it on first use. It lives in the keystore, so the cache files in the profile are useless without it.
func (a *App) GetCacheKey() (string, error) {
	if v, err := a.readSecret(secretCacheKey); err == nil {
		return v, nil
	} else if !errors.Is(err, errSecretNotFound) {
		return "", err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	key := base64.StdEncoding.EncodeToString(raw)
	if err := a.writeSecret(secretCacheKey, key); err != nil {
		return "", err
	}
	return key, nil
}

// migrateLegacySession moves a token left in the old plaintext session.json into the keystore and deletes the file.
func (a *App) migrateLegacySession() {
	b, err := os.ReadFile(sessionPath())
	if err != nil {
		return
	}
	if token := strings.TrimSpace(string(b)); token != "" {
		a.SaveSession(token)
	}
	_ = os.Remove(sessionPath())
}

// GetLockStatus is the bound, JSON-encoded form of lockStatus. It returns a string rather than a struct so the
// generated TypeScript bindings stay plain functions (struct returns generate namespace code the web build's
// erasable-syntax setting rejects).
func (a *App) GetLockStatus() string {
	b, _ := json.Marshal(a.lockStatus())
	return string(b)
}

// lockStatus reports whether a passcode is set, whether the app is currently locked, and the auto-lock timeout.
func (a *App) lockStatus() LockStatus {
	st := LockStatus{SecureStorage: true}
	if r, ok := a.secrets.(*resilientStore); ok {
		st.SecureStorage = r.secureStorage()
	}
	lf, enabled := loadLock()
	if !enabled {
		return st
	}
	st.Enabled = true
	st.AutoLockMinutes = lf.AutoLockMinutes
	a.vault.mu.Lock()
	st.Locked = a.vault.key == nil
	a.vault.mu.Unlock()
	return st
}

// checkPasscode verifies passcode against the verifier, applying the failed-attempt throttle, and returns the
// derived key on success.
func (a *App) checkPasscode(passcode string) ([]byte, error) {
	lf, enabled := loadLock()
	if !enabled {
		return nil, errors.New("no passcode is set")
	}
	a.vault.mu.Lock()
	if wait := time.Until(a.vault.blockedUntil); wait > 0 {
		a.vault.mu.Unlock()
		return nil, fmt.Errorf("too many attempts, try again in %d seconds", int(wait.Seconds())+1)
	}
	a.vault.mu.Unlock()

	salt, err := base64.StdEncoding.DecodeString(lf.Salt)
	if err != nil {
		return nil, err
	}
	key := deriveKey(passcode, salt)
	plain, err := openWith(key, lf.Verifier)

	a.vault.mu.Lock()
	defer a.vault.mu.Unlock()
	if err != nil || plain != verifierText {
		a.vault.failures++
		if a.vault.failures >= maxFreeAttempts {
			delay := 30 * time.Second << (a.vault.failures - maxFreeAttempts)
			if delay > maxLockoutDelay || delay <= 0 {
				delay = maxLockoutDelay
			}
			a.vault.blockedUntil = time.Now().Add(delay)
		}
		return nil, errIncorrectPasscode
	}
	a.vault.failures = 0
	a.vault.blockedUntil = time.Time{}
	return key, nil
}

// Unlock checks the passcode and, if right, keeps the derived key in memory so secrets become readable.
func (a *App) Unlock(passcode string) error {
	key, err := a.checkPasscode(passcode)
	if err != nil {
		return err
	}
	a.vault.mu.Lock()
	a.vault.key = key
	a.vault.mu.Unlock()
	return nil
}

// Lock forgets the key in memory; secrets are unreadable until the passcode is entered again. It also tells the
// web layer, which reloads so no decrypted data or token stays in the renderer's memory.
func (a *App) Lock() {
	a.vault.mu.Lock()
	wasUnlocked := a.vault.key != nil
	for i := range a.vault.key {
		a.vault.key[i] = 0
	}
	a.vault.key = nil
	a.vault.mu.Unlock()
	if _, enabled := loadLock(); enabled && wasUnlocked && a.ctx != nil {
		runtime.EventsEmit(a.ctx, "app:locked")
	}
}

// plaintextSecrets reads every secret using the current state (sealed or not).
func (a *App) plaintextSecrets() (map[string]string, error) {
	out := map[string]string{}
	for _, name := range []string{secretSession, secretCacheKey} {
		v, err := a.readSecret(name)
		if errors.Is(err, errSecretNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[name] = v
	}
	return out, nil
}

// SetPasscode turns the passcode lock on, or changes it. Changing requires the current passcode. Every secret
// is re-encrypted under the new passcode's key.
func (a *App) SetPasscode(current, next string) error {
	if utf8.RuneCountInString(next) < minPasscodeLen {
		return fmt.Errorf("passcode must be at least %d characters", minPasscodeLen)
	}
	lf, enabled := loadLock()
	autoLock := 0
	if enabled {
		autoLock = lf.AutoLockMinutes
		key, err := a.checkPasscode(current)
		if err != nil {
			return err
		}
		// The right passcode unlocks, so the sealed secrets can be read and re-encrypted below.
		a.vault.mu.Lock()
		a.vault.key = key
		a.vault.mu.Unlock()
	}
	secrets, err := a.plaintextSecrets()
	if err != nil {
		return err
	}

	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	key := deriveKey(next, salt)
	verifier, err := sealWith(key, verifierText)
	if err != nil {
		return err
	}
	if err := saveLock(&lockFile{
		Salt:            base64.StdEncoding.EncodeToString(salt),
		Verifier:        verifier,
		AutoLockMinutes: autoLock,
	}); err != nil {
		return err
	}
	a.vault.mu.Lock()
	a.vault.key = key
	a.vault.failures = 0
	a.vault.mu.Unlock()
	for name, v := range secrets {
		if err := a.writeSecret(name, v); err != nil {
			return err
		}
	}
	return nil
}

// RemovePasscode turns the lock off after verifying the current passcode; secrets go back to plain keystore
// entries (still protected by the OS keystore).
func (a *App) RemovePasscode(current string) error {
	key, err := a.checkPasscode(current)
	if err != nil {
		return err
	}
	a.vault.mu.Lock()
	a.vault.key = key
	a.vault.mu.Unlock()
	secrets, err := a.plaintextSecrets()
	if err != nil {
		return err
	}
	if err := os.Remove(lockPath()); err != nil && !os.IsNotExist(err) {
		return err
	}
	a.Lock()
	for name, v := range secrets {
		if err := a.writeSecret(name, v); err != nil {
			return err
		}
	}
	return nil
}

// SetAutoLock sets how many idle minutes lock the app (0 = never). It only applies while a passcode is set.
func (a *App) SetAutoLock(minutes int) {
	lf, enabled := loadLock()
	if !enabled {
		return
	}
	if minutes < 0 {
		minutes = 0
	}
	if minutes > 24*60 {
		minutes = 24 * 60
	}
	lf.AutoLockMinutes = minutes
	_ = saveLock(lf)
}
