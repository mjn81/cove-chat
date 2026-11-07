package tests

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"cove/backend/internal/models"
	"cove/backend/internal/rtc"
)

// liveMembership is a membership source whose answers change during a test (a member getting kicked).
type liveMembership struct {
	mu     sync.Mutex
	status map[string]string // userID -> status; absent = no record
}

func (m *liveMembership) set(userID, status string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if status == "" {
		delete(m.status, userID)
		return
	}
	m.status[userID] = status
}

func (m *liveMembership) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.status[userID]
	if !ok {
		return nil, errors.New("not found")
	}
	return &models.UserChannel{UserID: userID, ChannelID: channelID, Status: st}, nil
}

// recordingSender remembers every event delivered to each user.
type recordingSender struct {
	mu   sync.Mutex
	sent map[string][]string
}

func (s *recordingSender) SendToUser(userID string, msg *models.WSMessage) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent[userID] = append(s.sent[userID], msg.Type)
	return true
}
func (s *recordingSender) BroadcastVoiceState(string, []string) {}
func (s *recordingSender) count(userID, typ string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, t := range s.sent[userID] {
		if t == typ {
			n++
		}
	}
	return n
}

func newSignalFixture(t *testing.T) (*rtc.Manager, *liveMembership, *recordingSender) {
	t.Helper()
	mem := &liveMembership{status: map[string]string{"alice": models.StatusActive, "bob": models.StatusActive}}
	snd := &recordingSender{sent: map[string][]string{}}
	mgr, err := rtc.NewManager(rtc.Config{MaxParticipantsPerCall: 4}, mem, snd)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mgr.Stop)
	return mgr, mem, snd
}

func signal(t *testing.T, mgr *rtc.Manager, user, typ string, payload any) {
	t.Helper()
	raw, _ := json.Marshal(payload)
	if err := mgr.HandleSignal(user, user, typ, raw); err != nil {
		t.Fatalf("%s from %s: %v", typ, user, err)
	}
}

func inCall(mgr *rtc.Manager, user string) bool {
	for _, ids := range mgr.ActiveRooms() {
		for _, id := range ids {
			if id == user {
				return true
			}
		}
	}
	return false
}

// Signaling from someone who never joined (a non-member included) must not reach the room.
func TestRTCSignals_NonParticipantIsIgnored(t *testing.T) {
	mgr, mem, snd := newSignalFixture(t)
	signal(t, mgr, "alice", rtc.MsgJoin, map[string]string{"channel_id": "c1"})
	mem.set("mallory", "") // no membership record at all

	signal(t, mgr, "mallory", rtc.MsgTrackState, rtc.TrackStatePayload{ChannelID: "c1", Kind: "audio", Enabled: false})
	signal(t, mgr, "mallory", rtc.MsgRequestKeyframe, map[string]string{"channel_id": "c1"})
	signal(t, mgr, "mallory", rtc.MsgPublishOffer, map[string]any{"channel_id": "c1", "sdp": map[string]string{"type": "offer", "sdp": "v=0"}})

	if n := snd.count("alice", rtc.MsgTrackState); n != 0 {
		t.Errorf("a non-participant's track state reached the room (%d events)", n)
	}
	if inCall(mgr, "mallory") {
		t.Error("non-participant ended up in the call")
	}
}

// A member who is removed while in a call is dropped at their next signal, and signals do not take effect.
func TestRTCSignals_KickedMemberIsEvictedOnNextSignal(t *testing.T) {
	mgr, mem, snd := newSignalFixture(t)
	signal(t, mgr, "alice", rtc.MsgJoin, map[string]string{"channel_id": "c1"})
	signal(t, mgr, "bob", rtc.MsgJoin, map[string]string{"channel_id": "c1"})
	if !inCall(mgr, "alice") || !inCall(mgr, "bob") {
		t.Fatal("setup: both should be in the call")
	}

	mem.set("alice", models.StatusKicked)
	signal(t, mgr, "alice", rtc.MsgTrackState, rtc.TrackStatePayload{ChannelID: "c1", Kind: "audio", Enabled: true})

	if snd.count("bob", rtc.MsgTrackState) != 0 {
		t.Error("a kicked member's track state was rebroadcast to the room")
	}
	if inCall(mgr, "alice") {
		t.Error("kicked member is still in the call after signalling")
	}
	if !inCall(mgr, "bob") {
		t.Error("the other participant must stay in the call")
	}
}

// The REST kick/leave path evicts the member from a running call immediately.
func TestRTCRemoveUserFromChannel_EvictsOnlyThatChannel(t *testing.T) {
	mgr, _, _ := newSignalFixture(t)
	signal(t, mgr, "alice", rtc.MsgJoin, map[string]string{"channel_id": "c1"})
	signal(t, mgr, "bob", rtc.MsgJoin, map[string]string{"channel_id": "c1"})

	mgr.RemoveUserFromChannel("alice", "other-channel")
	if !inCall(mgr, "alice") {
		t.Fatal("removing from a different channel must not end alice's call")
	}
	mgr.RemoveUserFromChannel("alice", "c1")
	if inCall(mgr, "alice") || !inCall(mgr, "bob") {
		t.Errorf("after eviction: alice in call=%v, bob in call=%v", inCall(mgr, "alice"), inCall(mgr, "bob"))
	}
}
