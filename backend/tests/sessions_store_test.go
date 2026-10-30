package tests

import (
	"strings"
	"testing"
	"time"

	"cove/backend/internal/auth"
	"cove/backend/internal/models"
)

func TestCreateWithMetaAssignsIDAndKeepsMetadata(t *testing.T) {
	t.Parallel()
	ss := auth.NewSessionStore(time.Hour)
	meta := auth.SessionMeta{IP: "203.0.113.7", DeviceName: "Chrome on Windows", AppName: "Cove Web", City: "Tehran", Country: "Iran"}

	token, sess, err := ss.CreateWithMeta("u1", "alice", meta)
	if err != nil {
		t.Fatal(err)
	}
	if sess.ID == "" || sess.ID == token {
		t.Fatalf("session id must be a public id distinct from the token, got %q", sess.ID)
	}
	got, err := ss.Validate(token)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != sess.ID || got.Meta != meta {
		t.Fatalf("validate returned %+v, want id %s meta %+v", got, sess.ID, meta)
	}
}

func TestListByUserIsScopedAndNewestActiveFirst(t *testing.T) {
	t.Parallel()
	ss := auth.NewSessionStore(time.Hour)
	_, first, _ := ss.CreateWithMeta("u1", "alice", auth.SessionMeta{DeviceName: "old"})
	time.Sleep(5 * time.Millisecond)
	_, second, _ := ss.CreateWithMeta("u1", "alice", auth.SessionMeta{DeviceName: "new"})
	_, _, _ = ss.CreateWithMeta("u2", "bob", auth.SessionMeta{DeviceName: "other"})

	list := ss.ListByUser("u1")
	if len(list) != 2 || list[0].ID != second.ID || list[1].ID != first.ID {
		t.Fatalf("list = %+v", list)
	}
}

func TestDeleteByIDOnlyAffectsOwner(t *testing.T) {
	t.Parallel()
	ss := auth.NewSessionStore(time.Hour)
	tokenA, a, _ := ss.CreateWithMeta("u1", "alice", auth.SessionMeta{})
	tokenB, _, _ := ss.CreateWithMeta("u2", "bob", auth.SessionMeta{})

	if ss.DeleteByID("u2", a.ID) {
		t.Fatal("bob must not be able to delete alice's session")
	}
	if _, err := ss.Validate(tokenA); err != nil {
		t.Fatal("alice's session should still be valid")
	}
	if !ss.DeleteByID("u1", a.ID) {
		t.Fatal("owner delete should succeed")
	}
	if _, err := ss.Validate(tokenA); err == nil {
		t.Fatal("deleted session still validates")
	}
	if _, err := ss.Validate(tokenB); err != nil {
		t.Fatal("bob's session must be untouched")
	}
}

func TestDeleteOthersKeepsCurrent(t *testing.T) {
	t.Parallel()
	ss := auth.NewSessionStore(time.Hour)
	keepTok, keep, _ := ss.CreateWithMeta("u1", "alice", auth.SessionMeta{})
	dropTok, _, _ := ss.CreateWithMeta("u1", "alice", auth.SessionMeta{})
	otherTok, _, _ := ss.CreateWithMeta("u2", "bob", auth.SessionMeta{})

	dropped := ss.DeleteOthers("u1", keep.ID)
	if len(dropped) != 1 {
		t.Fatalf("dropped %d sessions, want 1", len(dropped))
	}
	if _, err := ss.Validate(keepTok); err != nil {
		t.Fatal("current session must survive")
	}
	if _, err := ss.Validate(dropTok); err == nil {
		t.Fatal("other session of the same user must be gone")
	}
	if _, err := ss.Validate(otherTok); err != nil {
		t.Fatal("another user's session must be untouched")
	}
}

func TestPersisterNeverSeesRawToken(t *testing.T) {
	t.Parallel()
	mp := &mockPersister{sessions: make(map[string]*models.Session)}
	ss := auth.NewSessionStore(time.Hour, mp)
	token, _, _ := ss.CreateWithMeta("u1", "alice", auth.SessionMeta{IP: "1.2.3.4"})

	for key, rec := range mp.sessions {
		if strings.Contains(key, token) || strings.Contains(rec.Token, token) {
			t.Fatal("raw bearer token was persisted; only its hash may be stored")
		}
		if rec.ID == "" || rec.IP != "1.2.3.4" {
			t.Fatalf("metadata not persisted: %+v", rec)
		}
	}

	restarted := auth.NewSessionStore(time.Hour, mp)
	if got, err := restarted.Validate(token); err != nil || got.Meta.IP != "1.2.3.4" {
		t.Fatalf("session must survive restart with metadata: %v %+v", err, got)
	}
}
