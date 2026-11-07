package tests

import (
	"os"
	"path/filepath"
	"testing"

	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"
)

// repairFixture builds a database where user "keep" lives in an older table and user "lost" in the newest one, then
// zero-fills the newest table the way a power loss does.
func repairFixture(t *testing.T) (mainPath string, dek []byte) {
	t.Helper()
	dir := t.TempDir()
	dek, err := db.BootstrapDEK(filepath.Join(dir, "meta"), crypto.DeriveKEK("test-master-password"))
	if err != nil {
		t.Fatalf("BootstrapDEK: %v", err)
	}
	mainPath = filepath.Join(dir, "main")
	for _, u := range []*models.User{{ID: "keep", Username: "keep"}, {ID: "lost", Username: "lost"}} {
		d, err := db.Open(mainPath, dek)
		if err != nil {
			t.Fatalf("db.Open: %v", err)
		}
		if err := d.SetUser(u); err != nil {
			t.Fatalf("SetUser: %v", err)
		}
		// Close flushes the memtable into its own .sst, so each user ends up in a separate table.
		if err := d.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}
	zeroFillNewestTable(t, mainPath)
	return mainPath, dek
}

func TestRepairDropsTheDamagedTableAndKeepsTheRest(t *testing.T) {
	mainPath, dek := repairFixture(t)
	if _, err := db.Open(mainPath, dek); err == nil {
		t.Fatal("precondition: the damaged database should not open")
	}

	report, err := db.Repair(mainPath)
	if err != nil {
		t.Fatalf("Repair: %v", err)
	}
	if len(report.Removed) != 1 {
		t.Fatalf("expected exactly one damaged table removed, got %v", report.Removed)
	}
	if report.BackupDir == "" {
		t.Fatal("Repair must keep a copy of the original database")
	}
	if _, err := os.Stat(filepath.Join(report.BackupDir, report.Removed[0])); err != nil {
		t.Fatalf("the damaged file should be preserved in the backup: %v", err)
	}

	d, err := db.Open(mainPath, dek)
	if err != nil {
		t.Fatalf("db.Open after repair: %v", err)
	}
	defer func() { _ = d.Close() }()
	if u, err := d.GetUser("keep"); err != nil || u.Username != "keep" {
		t.Fatalf("user from the intact table must survive: %v %v", u, err)
	}
	if _, err := d.GetUser("lost"); err == nil {
		t.Fatal("user from the damaged table cannot be recovered")
	}
}

func TestRepairLeavesAHealthyDatabaseAlone(t *testing.T) {
	dir := t.TempDir()
	dek, err := db.BootstrapDEK(filepath.Join(dir, "meta"), crypto.DeriveKEK("test-master-password"))
	if err != nil {
		t.Fatal(err)
	}
	mainPath := filepath.Join(dir, "main")
	d, err := db.Open(mainPath, dek)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.SetUser(&models.User{ID: "u", Username: "u"}); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}

	report, err := db.Repair(mainPath)
	if err != nil {
		t.Fatalf("Repair: %v", err)
	}
	if len(report.Removed) != 0 || report.BackupDir != "" {
		t.Fatalf("a healthy database must not be touched or copied: %+v", report)
	}
}
