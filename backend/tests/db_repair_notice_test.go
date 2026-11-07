package tests

import (
	"strings"
	"testing"

	"cove/backend/internal/db"
	"cove/update"
)

// When the server repaired its database at start-up, the owner and admins hear about it from the Cove account,
// naming what was dropped and where the original copy is. Regular users are never contacted.
func TestAdminsAreToldWhenTheDatabaseWasAutoRepaired(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	report := db.RepairReport{Removed: []string{"000011.sst"}, BackupDir: "/srv/cove/data/db/main.bak-20261107-133303"}

	sent, err := u.handler.NotifyAdminsOfDatabaseRepair(report)
	if err != nil || sent != 2 {
		t.Fatalf("sent %d (%v), want 2 (owner + admin)", sent, err)
	}
	for _, name := range []string{"owner", "admin"} {
		msgs := adminMessages(t, u, name)
		if len(msgs) != 1 {
			t.Fatalf("%s messages = %q", name, msgs)
		}
		for _, want := range []string{"000011.sst", "main.bak-20261107-133303", "repaired", "lost"} {
			if !strings.Contains(msgs[0], want) {
				t.Errorf("%s notice is missing %q: %q", name, want, msgs[0])
			}
		}
	}
	if msgs := adminMessages(t, u, "member"); len(msgs) != 0 {
		t.Errorf("a regular user was messaged: %q", msgs)
	}
}

func TestNoNoticeWhenNothingWasRepaired(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	if sent, err := u.handler.NotifyAdminsOfDatabaseRepair(db.RepairReport{}); err != nil || sent != 0 {
		t.Fatalf("sent %d (%v) for an empty report, want 0", sent, err)
	}
	if msgs := adminMessages(t, u, "owner"); len(msgs) != 0 {
		t.Errorf("owner was messaged without a repair: %q", msgs)
	}
}
