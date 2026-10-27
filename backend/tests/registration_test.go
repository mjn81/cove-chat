package tests

import (
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nodetalk/backend/internal/models"
)

func ptrTime(t time.Time) *time.Time { return &t }

func TestFirstRegisteredUserBecomesOwnerOnlyOnce(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.mustRegister(t, "alice")
	e.mustRegister(t, "bob")

	var me struct {
		ServerRole string `json:"server_role"`
	}
	readJSON(t, e.do(t, "GET", "/api/me", e.login(t, "alice"), nil), &me)
	if me.ServerRole != models.ServerRoleOwner {
		t.Errorf("first user server_role = %q, want owner", me.ServerRole)
	}
	me.ServerRole = ""
	readJSON(t, e.do(t, "GET", "/api/me", e.login(t, "bob"), nil), &me)
	if me.ServerRole != "" {
		t.Errorf("second user server_role = %q, want none", me.ServerRole)
	}
}

func TestConcurrentFirstRegistrationsCreateExactlyOneOwner(t *testing.T) {
	e := newAdminEnv(t, "open")
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e.register(t, "user"+string(rune('a'+i)), "")
		}(i)
	}
	wg.Wait()

	users, _ := e.store.ListAllUsers()
	owners := 0
	for _, u := range users {
		if u.ServerRole == models.ServerRoleOwner {
			owners++
		}
	}
	if owners != 1 {
		t.Errorf("owners = %d, want exactly 1", owners)
	}
}

func TestClosedRegistrationBlocksEveryoneAfterTheOwner(t *testing.T) {
	e := newAdminEnv(t, "closed")
	if code := e.register(t, "founder", ""); code != http.StatusCreated {
		t.Fatalf("founder on a fresh closed server = %d, want 201 (bootstrap)", code)
	}
	if code := e.register(t, "latecomer", ""); code != http.StatusForbidden {
		t.Errorf("registration while closed = %d, want 403", code)
	}
}

func TestInviteOnlyRequiresAValidCode(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	e.mustRegister(t, "founder") // bootstrap owner

	if code := e.register(t, "nocode", ""); code != http.StatusForbidden {
		t.Errorf("no code = %d, want 403", code)
	}
	if code := e.register(t, "badcode", "does-not-exist"); code != http.StatusForbidden {
		t.Errorf("unknown code = %d, want 403", code)
	}

	if err := e.store.CreateInvite(&models.Invite{Code: "GOODCODE12345678", CreatedBy: "x", MaxUses: 0}); err != nil {
		t.Fatal(err)
	}
	if code := e.register(t, "invited", "GOODCODE12345678"); code != http.StatusCreated {
		t.Errorf("valid code = %d, want 201", code)
	}
}

func TestInviteLimitedUsesRunOut(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	e.mustRegister(t, "founder")
	_ = e.store.CreateInvite(&models.Invite{Code: "LIMITED000000001", CreatedBy: "x", MaxUses: 2})

	for _, name := range []string{"one", "two"} {
		if code := e.register(t, name, "LIMITED000000001"); code != http.StatusCreated {
			t.Fatalf("%s = %d, want 201", name, code)
		}
	}
	if code := e.register(t, "three", "LIMITED000000001"); code != http.StatusForbidden {
		t.Errorf("third use = %d, want 403", code)
	}
	inv, _ := e.store.GetInvite("LIMITED000000001")
	if inv.Uses != 2 {
		t.Errorf("uses = %d, want 2", inv.Uses)
	}
}

func TestInviteUnlimitedNeverRunsOut(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	e.mustRegister(t, "founder")
	_ = e.store.CreateInvite(&models.Invite{Code: "UNLIMITED0000001", CreatedBy: "x", MaxUses: 0})

	for _, name := range []string{"usr1", "usr2", "usr3", "usr4", "usr5"} {
		if code := e.register(t, name, "UNLIMITED0000001"); code != http.StatusCreated {
			t.Fatalf("%s = %d, want 201", name, code)
		}
	}
}

func TestInviteExpiryAndRevocation(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	e.mustRegister(t, "founder")

	_ = e.store.CreateInvite(&models.Invite{Code: "EXPIRED000000001", CreatedBy: "x", ExpiresAt: ptrTime(time.Now().Add(-time.Minute))})
	if code := e.register(t, "late", "EXPIRED000000001"); code != http.StatusForbidden {
		t.Errorf("expired code = %d, want 403", code)
	}

	_ = e.store.CreateInvite(&models.Invite{Code: "FUTURE0000000001", CreatedBy: "x", ExpiresAt: ptrTime(time.Now().Add(time.Hour))})
	if code := e.register(t, "ontime", "FUTURE0000000001"); code != http.StatusCreated {
		t.Errorf("not-yet-expired code = %d, want 201", code)
	}

	_ = e.store.CreateInvite(&models.Invite{Code: "REVOKED000000001", CreatedBy: "x"})
	if err := e.store.RevokeInvite("REVOKED000000001"); err != nil {
		t.Fatal(err)
	}
	if code := e.register(t, "revoked", "REVOKED000000001"); code != http.StatusForbidden {
		t.Errorf("revoked code = %d, want 403", code)
	}
}

func TestFailedRegistrationDoesNotConsumeAnInviteUse(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	e.mustRegister(t, "founder")
	_ = e.store.CreateInvite(&models.Invite{Code: "ONEUSE0000000001", CreatedBy: "x", MaxUses: 1})

	// Username "founder" is taken, so this must fail with 409 and leave the use intact.
	if code := e.register(t, "founder", "ONEUSE0000000001"); code != http.StatusConflict {
		t.Fatalf("duplicate username = %d, want 409", code)
	}
	if code := e.register(t, "realone", "ONEUSE0000000001"); code != http.StatusCreated {
		t.Errorf("the use should still be available, got %d", code)
	}
}

func TestInviteRaceNeverExceedsMaxUses(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	e.mustRegister(t, "founder")
	_ = e.store.CreateInvite(&models.Invite{Code: "RACE000000000001", CreatedBy: "x", MaxUses: 1})

	var created atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if e.register(t, "racer"+string(rune('a'+i)), "RACE000000000001") == http.StatusCreated {
				created.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if created.Load() != 1 {
		t.Errorf("accounts created with a 1-use invite = %d, want exactly 1", created.Load())
	}
}

func TestServerInfoIsPublicAndReportsRegistrationMode(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	var info struct {
		RegistrationMode string `json:"registration_mode"`
	}
	resp := e.do(t, "GET", "/api/server-info", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("server-info = %d, want 200", resp.StatusCode)
	}
	readJSON(t, resp, &info)
	if info.RegistrationMode != "invite_only" {
		t.Errorf("registration_mode = %q, want invite_only", info.RegistrationMode)
	}
}

func TestStaticInvitesFromConfigAreSeededOnce(t *testing.T) {
	e := newAdminEnv(t, "invite_only")
	specs := []models.InviteSpec{{Code: "welcome-2026", MaxUses: 3, Note: "launch"}}

	if err := e.store.SeedConfigInvites(specs); err != nil {
		t.Fatal(err)
	}
	e.mustRegister(t, "founder")
	if code := e.register(t, "wel1", "welcome-2026"); code != http.StatusCreated {
		t.Fatalf("config invite = %d, want 201", code)
	}

	// A restart re-seeds; it must not reset the use counter.
	if err := e.store.SeedConfigInvites(specs); err != nil {
		t.Fatal(err)
	}
	inv, _ := e.store.GetInvite("welcome-2026")
	if inv.Uses != 1 || inv.Source != models.InviteSourceConfig {
		t.Errorf("after re-seed uses=%d source=%q, want 1/config", inv.Uses, inv.Source)
	}
}
