package tests

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// newPackStore opens a real BadgerDB in a temp dir (no mocks) and returns a store on it.
func newPackStore(t *testing.T) *store.Store {
	t.Helper()
	dir := t.TempDir()
	kek := crypto.DeriveKEK("pack-store-test")
	dek, err := db.BootstrapDEK(filepath.Join(dir, "meta"), kek)
	if err != nil {
		t.Fatal(err)
	}
	database, err := db.Open(filepath.Join(dir, "main"), dek)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return store.New(database)
}

func userPack(owner, name string) *models.Pack {
	return &models.Pack{Kind: models.PackKindSticker, Scope: models.PackScopeUser, OwnerID: owner, Name: name, Enabled: true}
}

func stickerItem(packID, fileID string, size int64) *models.PackItem {
	return &models.PackItem{PackID: packID, FileID: fileID, Emoji: "😀", MIME: "image/webp", SizeBytes: size}
}

func TestPackStore_CreateGetListDelete(t *testing.T) {
	s := newPackStore(t)
	p, err := s.CreatePack(userPack("u1", "Mine"), store.PackLimits{})
	if err != nil {
		t.Fatal(err)
	}
	if p.ID == "" || p.Version != 1 || p.CreatedAt.IsZero() {
		t.Fatalf("pack not initialised: %+v", p)
	}
	got, err := s.GetPack(p.ID)
	if err != nil || got.Name != "Mine" {
		t.Fatalf("GetPack = %+v, %v", got, err)
	}
	if _, err := s.GetPack("nope"); !errors.Is(err, store.ErrPackNotFound) {
		t.Fatalf("missing pack error = %v, want ErrPackNotFound", err)
	}
	owned, _ := s.ListOwnedPacks("u1")
	other, _ := s.ListOwnedPacks("u2")
	if len(owned) != 1 || len(other) != 0 {
		t.Fatalf("owned = %d, other = %d", len(owned), len(other))
	}
	if _, err := s.DeletePack(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetPack(p.ID); !errors.Is(err, store.ErrPackNotFound) {
		t.Fatalf("pack still there after delete: %v", err)
	}
}

func TestPackStore_PacksPerUserQuota(t *testing.T) {
	s := newPackStore(t)
	lim := store.PackLimits{MaxPacksPerUser: 2}
	for i := 0; i < 2; i++ {
		if _, err := s.CreatePack(userPack("u1", "p"), lim); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.CreatePack(userPack("u1", "third"), lim); !errors.Is(err, store.ErrTooManyPacks) {
		t.Fatalf("third pack error = %v, want ErrTooManyPacks", err)
	}
	if _, err := s.CreatePack(userPack("u2", "other user"), lim); err != nil {
		t.Fatalf("another user must have their own quota: %v", err)
	}
}

func TestPackStore_ItemsQuotaOrderAndVersion(t *testing.T) {
	s := newPackStore(t)
	p, _ := s.CreatePack(userPack("u1", "Mine"), store.PackLimits{})
	lim := store.PackLimits{MaxItemsPerPack: 2, MaxUserBytes: 100}

	a, err := s.AddPackItem(stickerItem(p.ID, "f1", 40), lim)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.AddPackItem(stickerItem(p.ID, "f2", 40), lim)
	if err != nil {
		t.Fatal(err)
	}
	if a.Order != 0 || b.Order != 1 {
		t.Fatalf("orders = %d, %d, want 0, 1", a.Order, b.Order)
	}
	if _, err := s.AddPackItem(stickerItem(p.ID, "f3", 1), lim); !errors.Is(err, store.ErrPackFull) {
		t.Fatalf("third item error = %v, want ErrPackFull", err)
	}
	got, _ := s.GetPack(p.ID)
	if got.Version != 3 { // created at 1, two items added
		t.Fatalf("version = %d, want 3", got.Version)
	}

	// The byte quota spans all of the user's packs.
	p2, _ := s.CreatePack(userPack("u1", "Second"), store.PackLimits{})
	if _, err := s.AddPackItem(stickerItem(p2.ID, "f4", 30), lim); !errors.Is(err, store.ErrPackStorageFull) {
		t.Fatalf("over-quota error = %v, want ErrPackStorageFull", err)
	}
	packs, bytes, _ := s.OwnerUsage("u1")
	if packs != 2 || bytes != 80 {
		t.Fatalf("usage = %d packs, %d bytes; want 2, 80", packs, bytes)
	}

	if _, err := s.AddPackItem(stickerItem("missing", "f", 1), lim); !errors.Is(err, store.ErrPackNotFound) {
		t.Fatalf("item for a missing pack = %v", err)
	}
}

func TestPackStore_DeleteItemAndReorder(t *testing.T) {
	s := newPackStore(t)
	p, _ := s.CreatePack(userPack("u1", "Mine"), store.PackLimits{})
	var ids []string
	for _, f := range []string{"a", "b", "c"} {
		it, err := s.AddPackItem(stickerItem(p.ID, f, 1), store.PackLimits{})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, it.ID)
	}
	if err := s.ReorderPackItems(p.ID, []string{ids[2], ids[0], ids[1]}); err != nil {
		t.Fatal(err)
	}
	items, _ := s.ListPackItems(p.ID)
	if items[0].ID != ids[2] || items[1].ID != ids[0] || items[2].ID != ids[1] {
		t.Fatalf("order after reorder wrong: %v", []string{items[0].FileID, items[1].FileID, items[2].FileID})
	}
	for _, bad := range [][]string{{ids[0]}, {ids[0], ids[0], ids[1]}, {ids[0], ids[1], "zzz"}} {
		if err := s.ReorderPackItems(p.ID, bad); !errors.Is(err, store.ErrBadOrder) {
			t.Errorf("reorder %v = %v, want ErrBadOrder", bad, err)
		}
	}
	removed, err := s.DeletePackItem(p.ID, ids[0])
	if err != nil || removed.FileID != "a" {
		t.Fatalf("DeletePackItem = %+v, %v", removed, err)
	}
	if _, err := s.DeletePackItem(p.ID, ids[0]); !errors.Is(err, store.ErrItemNotFound) {
		t.Fatalf("second delete = %v, want ErrItemNotFound", err)
	}
}

func TestPackStore_DeletePackRemovesItemsInstallsAndNames(t *testing.T) {
	s := newPackStore(t)
	emoji, err := s.EnsureCustomEmojiPack()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddPackItem(&models.PackItem{PackID: emoji.ID, Name: "party", FileID: "fe", MIME: "image/png", SizeBytes: 5}, store.PackLimits{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddPackItem(&models.PackItem{PackID: emoji.ID, Name: "party", FileID: "fe2", MIME: "image/png"}, store.PackLimits{}); !errors.Is(err, store.ErrEmojiNameTaken) {
		t.Fatalf("duplicate name = %v, want ErrEmojiNameTaken", err)
	}
	if _, err := s.AddPackItem(&models.PackItem{PackID: emoji.ID, FileID: "fe3", MIME: "image/png"}, store.PackLimits{}); err == nil {
		t.Fatal("a custom emoji without a name must be refused")
	}

	p, _ := s.CreatePack(userPack("u1", "Mine"), store.PackLimits{})
	_, _ = s.AddPackItem(stickerItem(p.ID, "f1", 1), store.PackLimits{})
	if err := s.InstallPack("u2", p.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.InstallPack("u2", p.ID); err != nil {
		t.Fatalf("installing twice must be fine: %v", err)
	}
	if err := s.InstallPack("u2", "ghost"); !errors.Is(err, store.ErrPackNotFound) {
		t.Fatalf("installing a missing pack = %v", err)
	}
	if ids, _ := s.ListInstalledPackIDs("u2"); len(ids) != 1 || ids[0] != p.ID {
		t.Fatalf("installed = %v", ids)
	}

	removed, err := s.DeletePack(p.ID)
	if err != nil || len(removed) != 1 || removed[0].FileID != "f1" {
		t.Fatalf("DeletePack removed %+v, err %v", removed, err)
	}
	if ids, _ := s.ListInstalledPackIDs("u2"); len(ids) != 0 {
		t.Fatalf("install survived pack deletion: %v", ids)
	}

	// Deleting the custom emoji pack frees its names.
	if _, err := s.DeletePack(emoji.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCustomEmojiByName("party"); !errors.Is(err, store.ErrItemNotFound) {
		t.Fatalf("name index survived: %v", err)
	}
}

func TestPackStore_DefaultStickerPackIsExclusive(t *testing.T) {
	s := newPackStore(t)
	mk := func(name string) *models.Pack {
		p, err := s.CreatePack(&models.Pack{Kind: models.PackKindSticker, Scope: models.PackScopeServer, Name: name, Enabled: true}, store.PackLimits{})
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	a, b := mk("A"), mk("B")
	if a.Order != 0 || b.Order != 1 {
		t.Fatalf("server pack order = %d, %d, want 0, 1", a.Order, b.Order)
	}
	if err := s.SetDefaultStickerPack(a.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := s.SetDefaultStickerPack("cove-basics", true); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetPack(a.ID); got.Default {
		t.Fatal("stored pack kept the default flag after a built-in pack became default")
	}
	if st, _ := s.GetPackState("cove-basics"); !st.Default || !st.Enabled {
		t.Fatalf("built-in state = %+v", st)
	}
	if err := s.SetDefaultStickerPack(b.ID, false); err != nil {
		t.Fatal(err)
	}
	if st, _ := s.GetPackState("cove-basics"); st.Default {
		t.Fatal("built-in pack kept the default flag")
	}
	if got, _ := s.GetPack(b.ID); !got.Default {
		t.Fatal("pack B is not default")
	}
	if err := s.SetDefaultStickerPack("ghost", false); !errors.Is(err, store.ErrPackNotFound) {
		t.Fatalf("default for a missing pack = %v", err)
	}
}

func TestPackStore_DeleteUserPacks(t *testing.T) {
	s := newPackStore(t)
	p, _ := s.CreatePack(userPack("u1", "Mine"), store.PackLimits{})
	_, _ = s.AddPackItem(stickerItem(p.ID, "f1", 1), store.PackLimits{})
	theirs, _ := s.CreatePack(userPack("u2", "Theirs"), store.PackLimits{})
	_ = s.InstallPack("u1", theirs.ID)
	_ = s.InstallPack("u2", p.ID)

	removed, err := s.DeleteUserPacks("u1")
	if err != nil || len(removed) != 1 {
		t.Fatalf("DeleteUserPacks = %+v, %v", removed, err)
	}
	if _, err := s.GetPack(p.ID); !errors.Is(err, store.ErrPackNotFound) {
		t.Fatal("owned pack survived")
	}
	if _, err := s.GetPack(theirs.ID); err != nil {
		t.Fatalf("someone else's pack was removed: %v", err)
	}
	if ids, _ := s.ListInstalledPackIDs("u1"); len(ids) != 0 {
		t.Fatalf("installs of the leaving user survived: %v", ids)
	}
	if ids, _ := s.ListInstalledPackIDs("u2"); len(ids) != 0 {
		t.Fatalf("others' installs of the removed pack survived: %v", ids)
	}
}

// Many concurrent uploads by one user must never overshoot the quota: the check and the write share a transaction.
func TestPackStore_QuotaHoldsUnderConcurrency(t *testing.T) {
	s := newPackStore(t)
	p, _ := s.CreatePack(userPack("u1", "Mine"), store.PackLimits{})
	lim := store.PackLimits{MaxItemsPerPack: 5}
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.AddPackItem(stickerItem(p.ID, "f", 1), lim); err == nil {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	items, _ := s.ListPackItems(p.ID)
	if ok != 5 || len(items) != 5 {
		t.Fatalf("accepted %d, stored %d; want exactly 5", ok, len(items))
	}
}
