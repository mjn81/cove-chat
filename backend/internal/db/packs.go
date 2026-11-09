package db

import (
	"encoding/json"
	"errors"
	"fmt"

	badger "github.com/dgraph-io/badger/v4"
)

// Key layout of the emoji and sticker packs (docs/packs-api.md):
//
//	pk:{pack_id}             models.Pack        stored (server and user) packs
//	pki:{pack_id}:{item_id}  models.PackItem    stickers and custom emoji
//	pks:{pack_id}            models.PackState   admin switches for built-in packs
//	upk:{user_id}:{pack_id}  models.UserPack    packs a user added to their own picker
//	pkn:{name}               models.EmojiName   unique custom emoji names
const (
	prefixPack      = "pk:"
	prefixPackItem  = "pki:"
	prefixPackState = "pks:"
	prefixUserPack  = "upk:"
	prefixEmojiName = "pkn:"
)

// PackKey is the key of a stored pack.
func PackKey(packID string) string { return prefixPack + packID }

// PackPrefix is the prefix shared by all stored packs.
func PackPrefix() string { return prefixPack }

// PackItemKey is the key of one item of a pack.
func PackItemKey(packID, itemID string) string { return prefixPackItem + packID + ":" + itemID }

// PackItemPrefix is the prefix shared by all items of a pack.
func PackItemPrefix(packID string) string { return prefixPackItem + packID + ":" }

// PackStateKey is the key of a built-in pack's admin switches.
func PackStateKey(packID string) string { return prefixPackState + packID }

// PackStatePrefix is the prefix shared by all built-in pack switches.
func PackStatePrefix() string { return prefixPackState }

// UserPackKey is the key recording that a user installed a pack.
func UserPackKey(userID, packID string) string { return prefixUserPack + userID + ":" + packID }

// UserPackPrefix is the prefix of everything a user installed.
func UserPackPrefix(userID string) string { return prefixUserPack + userID + ":" }

// AllUserPacksPrefix is the prefix shared by every install record.
func AllUserPacksPrefix() string { return prefixUserPack }

// EmojiNameKey is the key of a custom emoji name in the uniqueness index.
func EmojiNameKey(name string) string { return prefixEmojiName + name }

// Tx is one read-write database transaction, so a change that spans several keys (a pack, its items, its name index)
// lands all together or not at all. Values are JSON like everywhere else in the store.
type Tx struct{ txn *badger.Txn }

// Get loads key into dst; it returns ErrNotFound when the key does not exist.
func (t *Tx) Get(key string, dst any) error {
	item, err := t.txn.Get([]byte(key))
	if errors.Is(err, badger.ErrKeyNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("db: get error for key %q: %w", key, err)
	}
	return item.Value(func(val []byte) error { return json.Unmarshal(val, dst) })
}

// Exists reports whether key is present.
func (t *Tx) Exists(key string) (bool, error) {
	_, err := t.txn.Get([]byte(key))
	if errors.Is(err, badger.ErrKeyNotFound) {
		return false, nil
	}
	return err == nil, err
}

// Set stores v as JSON under key.
func (t *Tx) Set(key string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("db: marshal error for key %q: %w", key, err)
	}
	return t.txn.Set([]byte(key), data)
}

// Delete removes key (a missing key is not an error).
func (t *Tx) Delete(key string) error { return t.txn.Delete([]byte(key)) }

// Scan calls fn for every key with the prefix, in key order, with the raw JSON value. Returning an error stops it.
func (t *Tx) Scan(prefix string, fn func(key string, raw []byte) error) error {
	opts := badger.DefaultIteratorOptions
	opts.Prefix = []byte(prefix)
	it := t.txn.NewIterator(opts)
	defer it.Close()
	for it.Rewind(); it.ValidForPrefix([]byte(prefix)); it.Next() {
		item := it.Item()
		if err := item.Value(func(val []byte) error { return fn(string(item.Key()), val) }); err != nil {
			return err
		}
	}
	return nil
}

// Tx runs fn in one read-write transaction and retries it when Badger reports a write conflict, so concurrent
// callers serialise instead of overwriting each other. fn must be safe to run more than once.
func (d *DB) Tx(fn func(*Tx) error) error {
	var err error
	for attempt := 0; attempt < 50; attempt++ {
		err = d.bdb.Update(func(txn *badger.Txn) error { return fn(&Tx{txn: txn}) })
		if !errors.Is(err, badger.ErrConflict) {
			return err
		}
	}
	return err
}

// View runs fn in one read-only transaction (a consistent snapshot across keys).
func (d *DB) View(fn func(*Tx) error) error {
	return d.bdb.View(func(txn *badger.Txn) error { return fn(&Tx{txn: txn}) })
}

// ScanJSON decodes every value under prefix into a new element made by newFn (a read-only convenience).
func (d *DB) ScanJSON(prefix string, newFn func() any) ([]any, error) { return d.listByPrefix(prefix, newFn) }

// SetKey stores v as JSON under key.
func (d *DB) SetKey(key string, v any) error { return d.set(key, v) }

// GetKey loads key into dst (ErrNotFound when absent).
func (d *DB) GetKey(key string, dst any) error { return d.get(key, dst) }

// DeleteKey removes key.
func (d *DB) DeleteKey(key string) error { return d.delete(key) }

// DeleteFile removes a file metadata record (the blob itself is the storage layer's job).
func (d *DB) DeleteFile(id string) error { return d.delete(fileKey(id)) }
