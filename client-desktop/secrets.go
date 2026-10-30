package main

import (
	"errors"
	"sync"

	"github.com/zalando/go-keyring"
)

// keyringService is the service name under which Cove's secrets appear in the OS credential store
// (Windows Credential Manager, macOS Keychain, Linux Secret Service).
const keyringService = "Cove"

// errSecretNotFound is returned by a secretStore when a name has no value.
var errSecretNotFound = errors.New("secret not found")

// secretStore keeps small secrets (the session token, the cache key) outside the app's data folder. The real
// implementation is the OS keystore, which stops other OS users, disk images and profile backups from reading
// them; tests use an in-memory fake.
type secretStore interface {
	Get(name string) (string, error)
	Set(name, value string) error
	Delete(name string) error
}

// keyringStore is the secretStore backed by the operating system's credential store.
type keyringStore struct{}

func (keyringStore) Get(name string) (string, error) {
	v, err := keyring.Get(keyringService, name)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", errSecretNotFound
	}
	return v, err
}

func (keyringStore) Set(name, value string) error { return keyring.Set(keyringService, name, value) }

func (keyringStore) Delete(name string) error {
	if err := keyring.Delete(keyringService, name); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	return nil
}

// resilientStore wraps a primary store and degrades to in-memory storage when the primary is unusable (for
// example a Linux desktop without a Secret Service). Secrets then last only until the app quits: the user has to
// sign in again after a restart, which is the safe alternative to silently writing a token to disk in the clear.
type resilientStore struct {
	primary secretStore

	mu       sync.Mutex
	mem      map[string]string
	degraded bool
}

func newResilientStore(primary secretStore) *resilientStore {
	return &resilientStore{primary: primary, mem: map[string]string{}}
}

func (r *resilientStore) Get(name string) (string, error) {
	v, err := r.primary.Get(name)
	if err == nil {
		return v, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if mv, ok := r.mem[name]; ok {
		return mv, nil
	}
	return "", errSecretNotFound
}

func (r *resilientStore) Set(name, value string) error {
	if err := r.primary.Set(name, value); err != nil {
		r.mu.Lock()
		r.degraded = true
		r.mem[name] = value
		r.mu.Unlock()
		return nil
	}
	return nil
}

func (r *resilientStore) Delete(name string) error {
	r.mu.Lock()
	delete(r.mem, name)
	r.mu.Unlock()
	return r.primary.Delete(name)
}

// secureStorage reports whether secrets are really persisted by the OS keystore.
func (r *resilientStore) secureStorage() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return !r.degraded
}
