package db

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"cove/backend/internal/crypto"
	badger "github.com/dgraph-io/badger/v4"
)

// DB wraps a BadgerDB instance with Cove-specific key-value helpers.
type DB struct {
	bdb      *badger.DB
	once     sync.Once
	closeErr error
}

// Sentinel errors for common not-found cases.
var (
	ErrNotFound = errors.New("db: key not found")
	ErrConflict = errors.New("db: key already exists")
)

// Open initializes the BadgerDB at the given path using the supplied DEK for
// encryption at-rest (via BadgerDB's built-in EncryptionKey option).
// The DEK itself is derived via crypto.DeriveKEK and crypto.DecryptDEK.
func Open(path string, dek []byte) (*DB, error) {
	opts := badger.DefaultOptions(path).
		WithLogger(nil). // suppress chatty default logger; use structured logs instead
		WithEncryptionKey(dek).
		WithIndexCacheSize(64 << 20) // 64MB index cache

	// Badger reads every table index in its own goroutines while opening, so a damaged file panics the whole
	// process there and cannot be recovered from here. Catch the one failure we know how to recognise up front.
	if err := checkTablesIntact(path); err != nil {
		return nil, err
	}

	bdb, err := badger.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("db: failed to open BadgerDB at %s: %w", path, err)
	}
	return &DB{bdb: bdb}, nil
}

// checkTablesIntact rejects a database directory that holds a table (.sst) file that is empty or filled with zeros.
// That is what NTFS leaves behind when the machine loses power or the process is killed after a file's size was
// committed but before its data reached the disk. Reading such a table makes Badger panic with
// "slice bounds out of range", so report it as an ordinary error that says how to recover instead.
func checkTablesIntact(dir string) error {
	tables, err := filepath.Glob(filepath.Join(dir, "*.sst"))
	if err != nil {
		return fmt.Errorf("db: list tables in %s: %w", dir, err)
	}
	for _, name := range tables {
		zero, err := isAllZero(name)
		if err != nil {
			return fmt.Errorf("db: inspect table %s: %w", name, err)
		}
		if zero {
			return fmt.Errorf("db: table file %s is damaged (it contains only zeros), which usually follows a power loss or a killed process; "+
				"restore the database from a backup (\"server restore <file>\") or move %s aside to start with an empty database",
				filepath.Base(name), dir)
		}
	}
	return nil
}

// isAllZero reports whether the file is empty or every byte is zero. It stops at the first non-zero byte, so a
// healthy table costs a single small read.
func isAllZero(name string) (bool, error) {
	f, err := os.Open(name)
	if err != nil {
		return false, err
	}
	defer func() { _ = f.Close() }()
	buf := make([]byte, 64<<10)
	for {
		n, err := f.Read(buf)
		for _, b := range buf[:n] {
			if b != 0 {
				return false, nil
			}
		}
		if errors.Is(err, io.EOF) {
			return true, nil
		}
		if err != nil {
			return false, err
		}
	}
}

// Close cleanly shuts down BadgerDB, flushing pending writes.
// Safe to call multiple times (idempotent).
func (d *DB) Close() error {
	d.once.Do(func() {
		d.closeErr = d.bdb.Close()
	})
	return d.closeErr
}

// RunGC triggers a manual value-log garbage collection cycle.
// Recommended to run periodically (e.g., every 5 minutes) in a background goroutine.
func (d *DB) RunGC() error {
	return d.bdb.RunValueLogGC(0.7)
}

// ---- Generic Key-Value Helpers -------------------------------------------- //

// set marshals v to JSON and stores it at the given key.
func (d *DB) set(key string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("db: marshal error for key %q: %w", key, err)
	}
	return d.bdb.Update(func(txn *badger.Txn) error {
		return txn.Set([]byte(key), data)
	})
}

// setIfAbsent writes key only if it does not yet exist. Returns ErrConflict if
// the key is already present.
func (d *DB) setIfAbsent(key string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("db: marshal error for key %q: %w", key, err)
	}
	return d.bdb.Update(func(txn *badger.Txn) error {
		if _, err := txn.Get([]byte(key)); err == nil {
			return ErrConflict
		}
		return txn.Set([]byte(key), data)
	})
}

// get fetches the key and unmarshals the JSON value into dst.
func (d *DB) get(key string, dst any) error {
	return d.bdb.View(func(txn *badger.Txn) error {
		item, err := txn.Get([]byte(key))
		if errors.Is(err, badger.ErrKeyNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("db: get error for key %q: %w", key, err)
		}
		return item.Value(func(val []byte) error {
			return json.Unmarshal(val, dst)
		})
	})
}

// update runs a read-modify-write on one key inside a single transaction and
// retries on write conflicts, so concurrent callers (e.g. two sign-ups using
// the same invite) serialize instead of overwriting each other. fn returns
// the error to abort with; a nil error persists the mutated value.
func (d *DB) update(key string, dst any, fn func() error) error {
	var err error
	for attempt := 0; attempt < 50; attempt++ {
		err = d.bdb.Update(func(txn *badger.Txn) error {
			item, gerr := txn.Get([]byte(key))
			if errors.Is(gerr, badger.ErrKeyNotFound) {
				return ErrNotFound
			}
			if gerr != nil {
				return gerr
			}
			if verr := item.Value(func(val []byte) error { return json.Unmarshal(val, dst) }); verr != nil {
				return verr
			}
			if ferr := fn(); ferr != nil {
				return ferr
			}
			data, merr := json.Marshal(dst)
			if merr != nil {
				return merr
			}
			return txn.Set([]byte(key), data)
		})
		if !errors.Is(err, badger.ErrConflict) {
			return err
		}
	}
	return err
}

// delete removes a key from the store.
func (d *DB) delete(key string) error {
	return d.bdb.Update(func(txn *badger.Txn) error {
		return txn.Delete([]byte(key))
	})
}

// listByPrefix scans all keys that start with prefix and decodes each value
// into a new element produced by newFn. Returns a slice of decoded items.
func (d *DB) listByPrefix(prefix string, newFn func() any) ([]any, error) {
	var results []any
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefix)
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			dst := newFn()
			if err := item.Value(func(val []byte) error {
				return json.Unmarshal(val, dst)
			}); err != nil {
				return err
			}
			results = append(results, dst)
		}
		return nil
	})
	return results, err
}

// ---- Domain Key Helpers ---------------------------------------------------- //

const (
	prefixUser              = "u:"
	prefixChannel           = "c:"
	prefixUserChannel       = "uc:"
	prefixMessage           = "m:"
	prefixPresence          = "p:"
	prefixFile              = "f:"
	prefixSession           = "s:"
	prefixRelationship      = "rel:"
	prefixRelationshipInbox = "reli:"
	prefixInvite            = "inv:"
	prefixAudit             = "aud:"
	prefixKnownDevices      = "kd:"
	keyOwner                = "srv:owner"
	keyUpdateNotified       = "srv:update_notified"
	keyDEK                  = "sys:dek"
)

func userKey(id string) string     { return prefixUser + id }
func channelKey(id string) string  { return prefixChannel + id }
func ucKey(uid, cid string) string { return prefixUserChannel + uid + ":" + cid }
func presenceKey(uid string) string  { return prefixPresence + uid }
func fileKey(id string) string       { return prefixFile + id }
func sessionKey(token string) string { return prefixSession + token }
func relationshipKey(fromID, toID string) string {
	return prefixRelationship + fromID + ":" + toID
}
func relationshipInboxKey(toID, fromID string) string {
	return prefixRelationshipInbox + toID + ":" + fromID
}

// ---- DEK Bootstrap -------------------------------------------------------- //

// BootstrapDEK handles the Data Encryption Key lifecycle on server start:
//   - If a DEK blob already exists in the DB (unencrypted meta bucket), decrypt
//     it with the KEK and return the raw DEK.
//   - If no DEK exists yet, generate one, encrypt it with the KEK, persist it,
//     and return the raw DEK.
//
// The "meta" bucket used here is a separate unencrypted BadgerDB instance solely
// for storing the encrypted DEK; the main DB is opened with the raw DEK.
func BootstrapDEK(metaPath string, kek []byte) ([]byte, error) {
	metaOpts := badger.DefaultOptions(metaPath).WithLogger(nil)
	metaDB, err := badger.Open(metaOpts)
	if err != nil {
		return nil, fmt.Errorf("db: failed to open meta store: %w", err)
	}
	defer func() { _ = metaDB.Close() }()

	var encryptedDEK []byte
	err = metaDB.View(func(txn *badger.Txn) error {
		item, err := txn.Get([]byte(keyDEK))
		if errors.Is(err, badger.ErrKeyNotFound) {
			return nil // Will generate below.
		}
		if err != nil {
			return err
		}
		return item.Value(func(val []byte) error {
			encryptedDEK = make([]byte, len(val))
			copy(encryptedDEK, val)
			return nil
		})
	})
	if err != nil {
		return nil, err
	}

	if encryptedDEK == nil {
		// First run — generate and persist a DEK.
		rawDEK, err := crypto.GenerateAES256Key()
		if err != nil {
			return nil, err
		}
		encryptedDEK, err = crypto.EncryptDEK(kek, rawDEK)
		if err != nil {
			return nil, err
		}
		if err := metaDB.Update(func(txn *badger.Txn) error {
			return txn.Set([]byte(keyDEK), encryptedDEK)
		}); err != nil {
			return nil, fmt.Errorf("db: failed to persist DEK: %w", err)
		}
		return rawDEK, nil
	}

	// Existing DEK — decrypt and return it.
	return crypto.DecryptDEK(kek, encryptedDEK)
}
