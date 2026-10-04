package rtc

import (
	"testing"
	"time"
)

// TestManagerStats_TracksJoinsAndForwarding is a focused unit test that
// Stats() actually reflects join outcomes (accepted vs rejected) and real
// forwarding activity, since these numbers are the whole point of the
// hardening pass — a metric nobody can trust is worse than no metric.
func TestManagerStats_TracksJoinsAndForwarding(t *testing.T) {
	channelID := "chan-stats"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"alice:" + channelID: true,
		"bob:" + channelID:   true,
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 1}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	alice := newTestClient(t, mgr, sender, "alice", channelID)
	alice.join()
	time.Sleep(100 * time.Millisecond)

	// bob's join should be rejected: MaxParticipantsPerCall is 1.
	bobInbox := sender.register("bob")
	body := []byte(`{"channel_id":"` + channelID + `"}`)
	if err := mgr.HandleSignal("bob", "bob", MsgJoin, body); err != nil {
		t.Fatalf("HandleSignal: %v", err)
	}
	select {
	case <-bobInbox:
	case <-time.After(2 * time.Second):
		t.Fatal("expected bob's join to be rejected")
	}

	stats := mgr.Stats()
	if stats.JoinsTotal != 1 {
		t.Errorf("JoinsTotal = %d, want 1", stats.JoinsTotal)
	}
	if stats.JoinsRejected != 1 {
		t.Errorf("JoinsRejected = %d, want 1", stats.JoinsRejected)
	}
	if stats.Rooms != 1 || stats.Participants != 1 {
		t.Errorf("Rooms/Participants = %d/%d, want 1/1", stats.Rooms, stats.Participants)
	}

	track := alice.publishAudio(t)
	waitConnected(t, "alice-publish", alice.publishPC)
	stop := startWritingRTP(track, 1, 111)
	defer stop()

	deadline := time.After(10 * time.Second)
	for {
		s := mgr.Stats()
		if s.PacketsRead > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("PacketsRead never became non-zero after publishing")
		case <-time.After(50 * time.Millisecond):
		}
	}

	if mgr.Stats().PublishedTracks != 1 {
		t.Errorf("PublishedTracks = %d, want 1", mgr.Stats().PublishedTracks)
	}
}
