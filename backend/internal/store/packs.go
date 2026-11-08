package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"cove/backend/internal/db"
	"cove/backend/internal/models"
	"github.com/google/uuid"
)

// Errors of the pack store. The handlers map them to API status codes and stable error codes.
var (
	ErrPackNotFound = errors.New("store: pack not found")
	ErrItemNotFound = errors.New("store: pack item not found")
	// ErrEmojiNameTaken means another custom emoji already uses the name.
	ErrEmojiNameTaken = errors.New("store: custom emoji name is taken")
	// ErrPackFull means the pack already holds the most items it may.
	ErrPackFull = errors.New("store: pack is full")
	// ErrTooManyPacks means the user already owns the most packs they may.
	ErrTooManyPacks = errors.New("store: too many packs")
	// ErrPackStorageFull means the user's stickers would exceed their total size quota.
	ErrPackStorageFull = errors.New("store: pack storage quota reached")
	// ErrBadOrder means a reorder request did not list exactly the pack's items.
	ErrBadOrder = errors.New("store: order must list every item exactly once")
)

// PackLimits are the quotas applied while writing. A zero field means "no limit" (admin-managed server packs and
// custom emoji are unlimited; only user packs get the configured limits).
type PackLimits struct {
	MaxPacksPerUser int
	MaxItemsPerPack int
	MaxUserBytes    int64
}

// ============================================================
//  Packs
// ============================================================

// CreatePack stores a new pack. The ID is generated unless the caller set one (the custom emoji pack has a fixed id);
// a user pack counts against lim.MaxPacksPerUser inside the same transaction as the write, so two concurrent
// requests cannot both slip past the quota.
func (s *Store) CreatePack(p *models.Pack, lim PackLimits) (*models.Pack, error) {
	now := time.Now().UTC()
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	p.Version, p.CreatedAt, p.UpdatedAt = 1, now, now
	err := s.db.Tx(func(tx *db.Tx) error {
		if ok, err := tx.Exists(db.PackKey(p.ID)); err != nil || ok {
			if err != nil {
				return err
			}
			return db.ErrConflict
		}
		if p.Scope == models.PackScopeUser && lim.MaxPacksPerUser > 0 {
			owned, _, err := ownerUsage(tx, p.OwnerID)
			if err != nil {
				return err
			}
			if owned >= lim.MaxPacksPerUser {
				return ErrTooManyPacks
			}
		}
		if p.Scope == models.PackScopeServer && p.Kind == models.PackKindSticker {
			next, err := nextServerPackOrder(tx)
			if err != nil {
				return err
			}
			p.Order = next
		}
		return tx.Set(db.PackKey(p.ID), p)
	})
	if err != nil {
		return nil, err
	}
	return p, nil
}

// nextServerPackOrder returns one more than the highest order among stored server sticker packs.
func nextServerPackOrder(tx *db.Tx) (int, error) {
	highest := -1
	err := tx.Scan(db.PackPrefix(), func(_ string, raw []byte) error {
		var p models.Pack
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		if p.Scope == models.PackScopeServer && p.Kind == models.PackKindSticker && p.Order > highest {
			highest = p.Order
		}
		return nil
	})
	return highest + 1, err
}

// GetPack returns a stored pack, or ErrPackNotFound.
func (s *Store) GetPack(id string) (*models.Pack, error) {
	var p models.Pack
	if err := s.db.GetKey(db.PackKey(id), &p); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, ErrPackNotFound
		}
		return nil, err
	}
	return &p, nil
}

// ListPacks returns every stored pack (server and user), ordered by scope, order and name.
func (s *Store) ListPacks() ([]*models.Pack, error) {
	items, err := s.db.ScanJSON(db.PackPrefix(), func() any { return new(models.Pack) })
	if err != nil {
		return nil, err
	}
	out := make([]*models.Pack, 0, len(items))
	for _, it := range items {
		out = append(out, it.(*models.Pack))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.Before(out[j].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// ListOwnedPacks returns the packs a user owns.
func (s *Store) ListOwnedPacks(userID string) ([]*models.Pack, error) {
	all, err := s.ListPacks()
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, p := range all {
		if p.Scope == models.PackScopeUser && p.OwnerID == userID {
			out = append(out, p)
		}
	}
	return out, nil
}

// UpdatePack applies fn to a stored pack in one transaction and bumps its UpdatedAt. fn must not change ID, Kind,
// Scope or OwnerID.
func (s *Store) UpdatePack(id string, fn func(*models.Pack) error) (*models.Pack, error) {
	var out models.Pack
	err := s.db.Tx(func(tx *db.Tx) error {
		if err := tx.Get(db.PackKey(id), &out); err != nil {
			return mapPackErr(err)
		}
		if err := fn(&out); err != nil {
			return err
		}
		out.UpdatedAt = time.Now().UTC()
		return tx.Set(db.PackKey(id), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func mapPackErr(err error) error {
	if errors.Is(err, db.ErrNotFound) {
		return ErrPackNotFound
	}
	return err
}

// DeletePack removes a pack with its items, its custom emoji names and every user's install of it, all in one
// transaction. It returns the removed items so the caller can delete their image files.
func (s *Store) DeletePack(id string) ([]*models.PackItem, error) {
	var removed []*models.PackItem
	err := s.db.Tx(func(tx *db.Tx) error {
		var err error
		removed, err = deletePackTx(tx, id)
		return err
	})
	return removed, err
}

func deletePackTx(tx *db.Tx, id string) ([]*models.PackItem, error) {
	var pack models.Pack
	if err := tx.Get(db.PackKey(id), &pack); err != nil {
		return nil, mapPackErr(err)
	}
	items, err := packItemsTx(tx, id)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if err := tx.Delete(db.PackItemKey(id, it.ID)); err != nil {
			return nil, err
		}
		if it.Name != "" {
			if err := tx.Delete(db.EmojiNameKey(it.Name)); err != nil {
				return nil, err
			}
		}
	}
	var installs []string
	if err := tx.Scan(db.AllUserPacksPrefix(), func(key string, raw []byte) error {
		var up models.UserPack
		if err := json.Unmarshal(raw, &up); err != nil {
			return err
		}
		if up.PackID == id {
			installs = append(installs, key)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for _, k := range installs {
		if err := tx.Delete(k); err != nil {
			return nil, err
		}
	}
	return items, tx.Delete(db.PackKey(id))
}

// DeleteUserPacks removes everything a departing user made or added: the packs they own (with items and installs
// by others) and their own installs. It returns the removed items for file cleanup.
func (s *Store) DeleteUserPacks(userID string) ([]*models.PackItem, error) {
	var removed []*models.PackItem
	err := s.db.Tx(func(tx *db.Tx) error {
		removed = nil
		var owned []string
		if err := tx.Scan(db.PackPrefix(), func(_ string, raw []byte) error {
			var p models.Pack
			if err := json.Unmarshal(raw, &p); err != nil {
				return err
			}
			if p.Scope == models.PackScopeUser && p.OwnerID == userID {
				owned = append(owned, p.ID)
			}
			return nil
		}); err != nil {
			return err
		}
		for _, id := range owned {
			items, err := deletePackTx(tx, id)
			if err != nil {
				return err
			}
			removed = append(removed, items...)
		}
		var mine []string
		if err := tx.Scan(db.UserPackPrefix(userID), func(key string, _ []byte) error {
			mine = append(mine, key)
			return nil
		}); err != nil {
			return err
		}
		for _, k := range mine {
			if err := tx.Delete(k); err != nil {
				return err
			}
		}
		return nil
	})
	return removed, err
}

// ownerUsage counts the packs a user owns and the bytes of all their items.
func ownerUsage(tx *db.Tx, userID string) (packs int, bytes int64, err error) {
	var ids []string
	err = tx.Scan(db.PackPrefix(), func(_ string, raw []byte) error {
		var p models.Pack
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		if p.Scope == models.PackScopeUser && p.OwnerID == userID {
			ids = append(ids, p.ID)
		}
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	for _, id := range ids {
		items, err := packItemsTx(tx, id)
		if err != nil {
			return 0, 0, err
		}
		for _, it := range items {
			bytes += it.SizeBytes
		}
	}
	return len(ids), bytes, nil
}

// OwnerUsage reports how many packs a user owns and how many bytes their stickers take.
func (s *Store) OwnerUsage(userID string) (packs int, bytes int64, err error) {
	err = s.db.View(func(tx *db.Tx) error {
		packs, bytes, err = ownerUsage(tx, userID)
		return err
	})
	return packs, bytes, err
}

// ============================================================
//  Built-in pack switches
// ============================================================

// GetPackState returns the admin's switches for a built-in pack; a pack the admin never touched is enabled, not
// default and in its natural order.
func (s *Store) GetPackState(id string) (*models.PackState, error) {
	var st models.PackState
	if err := s.db.GetKey(db.PackStateKey(id), &st); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return &models.PackState{PackID: id, Enabled: true}, nil
		}
		return nil, err
	}
	return &st, nil
}

// ListPackStates returns the switches the admin has set, keyed by pack id.
func (s *Store) ListPackStates() (map[string]*models.PackState, error) {
	items, err := s.db.ScanJSON(db.PackStatePrefix(), func() any { return new(models.PackState) })
	if err != nil {
		return nil, err
	}
	out := make(map[string]*models.PackState, len(items))
	for _, it := range items {
		st := it.(*models.PackState)
		out[st.PackID] = st
	}
	return out, nil
}

// UpdatePackState applies fn to a built-in pack's switches and stores them.
func (s *Store) UpdatePackState(id string, fn func(*models.PackState)) (*models.PackState, error) {
	var st models.PackState
	err := s.db.Tx(func(tx *db.Tx) error {
		st = models.PackState{PackID: id, Enabled: true}
		if err := tx.Get(db.PackStateKey(id), &st); err != nil && !errors.Is(err, db.ErrNotFound) {
			return err
		}
		fn(&st)
		st.PackID = id
		return tx.Set(db.PackStateKey(id), &st)
	})
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// SetDefaultStickerPack makes one server or built-in sticker pack the default and clears the flag everywhere else,
// in one transaction, so there is never more than one. builtin says which kind id refers to.
func (s *Store) SetDefaultStickerPack(id string, builtin bool) error {
	return s.db.Tx(func(tx *db.Tx) error {
		var stored []models.Pack
		if err := tx.Scan(db.PackPrefix(), func(_ string, raw []byte) error {
			var p models.Pack
			if err := json.Unmarshal(raw, &p); err != nil {
				return err
			}
			if p.Default {
				stored = append(stored, p)
			}
			return nil
		}); err != nil {
			return err
		}
		for _, p := range stored {
			if !builtin && p.ID == id {
				continue
			}
			p.Default = false
			if err := tx.Set(db.PackKey(p.ID), &p); err != nil {
				return err
			}
		}
		var states []models.PackState
		if err := tx.Scan(db.PackStatePrefix(), func(_ string, raw []byte) error {
			var st models.PackState
			if err := json.Unmarshal(raw, &st); err != nil {
				return err
			}
			if st.Default {
				states = append(states, st)
			}
			return nil
		}); err != nil {
			return err
		}
		for _, st := range states {
			if builtin && st.PackID == id {
				continue
			}
			st.Default = false
			if err := tx.Set(db.PackStateKey(st.PackID), &st); err != nil {
				return err
			}
		}
		if builtin {
			st := models.PackState{PackID: id, Enabled: true}
			if err := tx.Get(db.PackStateKey(id), &st); err != nil && !errors.Is(err, db.ErrNotFound) {
				return err
			}
			st.Default = true
			return tx.Set(db.PackStateKey(id), &st)
		}
		var p models.Pack
		if err := tx.Get(db.PackKey(id), &p); err != nil {
			return mapPackErr(err)
		}
		p.Default = true
		p.UpdatedAt = time.Now().UTC()
		return tx.Set(db.PackKey(id), &p)
	})
}

// ============================================================
//  Items
// ============================================================

func packItemsTx(tx *db.Tx, packID string) ([]*models.PackItem, error) {
	var out []*models.PackItem
	err := tx.Scan(db.PackItemPrefix(packID), func(_ string, raw []byte) error {
		var it models.PackItem
		if err := json.Unmarshal(raw, &it); err != nil {
			return err
		}
		out = append(out, &it)
		return nil
	})
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].ID < out[j].ID
	})
	return out, err
}

// ListPackItems returns a pack's items in display order. A pack that does not exist yields ErrPackNotFound.
func (s *Store) ListPackItems(packID string) ([]*models.PackItem, error) {
	var out []*models.PackItem
	err := s.db.View(func(tx *db.Tx) error {
		if ok, err := tx.Exists(db.PackKey(packID)); err != nil || !ok {
			if err != nil {
				return err
			}
			return ErrPackNotFound
		}
		var err error
		out, err = packItemsTx(tx, packID)
		return err
	})
	return out, err
}

// GetPackItem returns one item of a pack, or ErrItemNotFound.
func (s *Store) GetPackItem(packID, itemID string) (*models.PackItem, error) {
	var it models.PackItem
	if err := s.db.GetKey(db.PackItemKey(packID, itemID), &it); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, ErrItemNotFound
		}
		return nil, err
	}
	return &it, nil
}

// AddPackItem appends an item to a stored pack. In the same transaction it enforces the pack's size and the user's
// byte quota (lim), claims the shortcode of a custom emoji, and bumps the pack version.
func (s *Store) AddPackItem(it *models.PackItem, lim PackLimits) (*models.PackItem, error) {
	err := s.db.Tx(func(tx *db.Tx) error {
		var pack models.Pack
		if err := tx.Get(db.PackKey(it.PackID), &pack); err != nil {
			return mapPackErr(err)
		}
		existing, err := packItemsTx(tx, pack.ID)
		if err != nil {
			return err
		}
		if lim.MaxItemsPerPack > 0 && len(existing) >= lim.MaxItemsPerPack {
			return ErrPackFull
		}
		if pack.Scope == models.PackScopeUser && lim.MaxUserBytes > 0 {
			_, used, err := ownerUsage(tx, pack.OwnerID)
			if err != nil {
				return err
			}
			if used+it.SizeBytes > lim.MaxUserBytes {
				return ErrPackStorageFull
			}
		}
		if pack.Kind == models.PackKindEmojiCustom {
			name := strings.TrimSpace(it.Name)
			if name == "" {
				return fmt.Errorf("store: custom emoji needs a name")
			}
			if ok, err := tx.Exists(db.EmojiNameKey(name)); err != nil {
				return err
			} else if ok {
				return ErrEmojiNameTaken
			}
		}
		next := 0
		for _, e := range existing {
			if e.Order >= next {
				next = e.Order + 1
			}
		}
		if it.ID == "" {
			it.ID = uuid.New().String()
		}
		it.Order = next
		it.CreatedAt = time.Now().UTC()
		if err := tx.Set(db.PackItemKey(pack.ID, it.ID), it); err != nil {
			return err
		}
		if pack.Kind == models.PackKindEmojiCustom {
			if err := tx.Set(db.EmojiNameKey(it.Name), &models.EmojiName{Name: it.Name, PackID: pack.ID, ItemID: it.ID}); err != nil {
				return err
			}
		}
		pack.Version++
		pack.UpdatedAt = it.CreatedAt
		return tx.Set(db.PackKey(pack.ID), &pack)
	})
	if err != nil {
		return nil, err
	}
	return it, nil
}

// DeletePackItem removes one item (and its custom emoji name) and returns it so the caller can delete the image.
func (s *Store) DeletePackItem(packID, itemID string) (*models.PackItem, error) {
	var it models.PackItem
	err := s.db.Tx(func(tx *db.Tx) error {
		var pack models.Pack
		if err := tx.Get(db.PackKey(packID), &pack); err != nil {
			return mapPackErr(err)
		}
		if err := tx.Get(db.PackItemKey(packID, itemID), &it); err != nil {
			if errors.Is(err, db.ErrNotFound) {
				return ErrItemNotFound
			}
			return err
		}
		if err := tx.Delete(db.PackItemKey(packID, itemID)); err != nil {
			return err
		}
		if it.Name != "" {
			if err := tx.Delete(db.EmojiNameKey(it.Name)); err != nil {
				return err
			}
		}
		pack.Version++
		pack.UpdatedAt = time.Now().UTC()
		return tx.Set(db.PackKey(packID), &pack)
	})
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// ReorderPackItems sets the display order of a pack's items. ids must list every item of the pack exactly once.
func (s *Store) ReorderPackItems(packID string, ids []string) error {
	return s.db.Tx(func(tx *db.Tx) error {
		var pack models.Pack
		if err := tx.Get(db.PackKey(packID), &pack); err != nil {
			return mapPackErr(err)
		}
		items, err := packItemsTx(tx, packID)
		if err != nil {
			return err
		}
		if len(ids) != len(items) {
			return ErrBadOrder
		}
		byID := make(map[string]*models.PackItem, len(items))
		for _, it := range items {
			byID[it.ID] = it
		}
		seen := make(map[string]bool, len(ids))
		for pos, id := range ids {
			it, ok := byID[id]
			if !ok || seen[id] {
				return ErrBadOrder
			}
			seen[id] = true
			it.Order = pos
			if err := tx.Set(db.PackItemKey(packID, id), it); err != nil {
				return err
			}
		}
		pack.Version++
		pack.UpdatedAt = time.Now().UTC()
		return tx.Set(db.PackKey(packID), &pack)
	})
}

// ============================================================
//  Installs
// ============================================================

// InstallPack adds a stored pack to a user's own picker. Installing twice is fine.
func (s *Store) InstallPack(userID, packID string) error {
	return s.db.Tx(func(tx *db.Tx) error {
		if ok, err := tx.Exists(db.PackKey(packID)); err != nil || !ok {
			if err != nil {
				return err
			}
			return ErrPackNotFound
		}
		if ok, err := tx.Exists(db.UserPackKey(userID, packID)); err != nil || ok {
			return err
		}
		return tx.Set(db.UserPackKey(userID, packID), &models.UserPack{UserID: userID, PackID: packID, InstalledAt: time.Now().UTC()})
	})
}

// UninstallPack removes a pack from a user's picker (a missing install is fine).
func (s *Store) UninstallPack(userID, packID string) error {
	return s.db.DeleteKey(db.UserPackKey(userID, packID))
}

// ListInstalledPackIDs returns the ids of the packs a user added to their picker, oldest first.
func (s *Store) ListInstalledPackIDs(userID string) ([]string, error) {
	items, err := s.db.ScanJSON(db.UserPackPrefix(userID), func() any { return new(models.UserPack) })
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].(*models.UserPack).InstalledAt.Before(items[j].(*models.UserPack).InstalledAt)
	})
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.(*models.UserPack).PackID)
	}
	return out, nil
}

// IsPackInstalled reports whether the user added the pack to their picker.
func (s *Store) IsPackInstalled(userID, packID string) bool {
	var up models.UserPack
	return s.db.GetKey(db.UserPackKey(userID, packID), &up) == nil
}

// ============================================================
//  Custom emoji
// ============================================================

// EnsureCustomEmojiPack returns the server's custom emoji pack, creating it on first use.
func (s *Store) EnsureCustomEmojiPack() (*models.Pack, error) {
	if p, err := s.GetPack(models.CustomEmojiPackID); err == nil {
		return p, nil
	} else if !errors.Is(err, ErrPackNotFound) {
		return nil, err
	}
	p, err := s.CreatePack(&models.Pack{
		ID: models.CustomEmojiPackID, Kind: models.PackKindEmojiCustom, Scope: models.PackScopeServer,
		Name: "Custom emoji", Enabled: true,
	}, PackLimits{})
	if errors.Is(err, db.ErrConflict) {
		return s.GetPack(models.CustomEmojiPackID) // lost a race with another request: it exists now
	}
	return p, err
}

// ListCustomEmoji returns the server's custom emoji in display order (empty when none exist yet).
func (s *Store) ListCustomEmoji() ([]*models.PackItem, error) {
	items, err := s.ListPackItems(models.CustomEmojiPackID)
	if errors.Is(err, ErrPackNotFound) {
		return nil, nil
	}
	return items, err
}

// GetCustomEmojiByName finds a custom emoji by its shortcode, or returns ErrItemNotFound.
func (s *Store) GetCustomEmojiByName(name string) (*models.PackItem, error) {
	var idx models.EmojiName
	if err := s.db.GetKey(db.EmojiNameKey(name), &idx); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, ErrItemNotFound
		}
		return nil, err
	}
	return s.GetPackItem(idx.PackID, idx.ItemID)
}

// ============================================================
//  Files
// ============================================================

// DeleteFileRecord removes a file's metadata and returns it, so the caller can delete the stored blob. A file that
// is already gone yields (nil, nil): cleanup is best effort and must be repeatable.
func (s *Store) DeleteFileRecord(id string) (*models.File, error) {
	f, err := s.db.GetFile(id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return f, s.db.DeleteFile(id)
}
