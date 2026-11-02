package tests

import (
	"encoding/json"
	"errors"
	"testing"

	"cove/backend/internal/models"
	"cove/backend/internal/rtc"
)

type statusMembership struct{ status string }

func (m statusMembership) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	if m.status == "" {
		return nil, errors.New("not found")
	}
	return &models.UserChannel{UserID: userID, ChannelID: channelID, Status: m.status}, nil
}

type nopSender struct{}

func (nopSender) SendToUser(string, *models.WSMessage) bool { return true }
func (nopSender) BroadcastVoiceState(string, []string)      {}

func joinStats(t *testing.T, status string) rtc.Stats {
	t.Helper()
	mgr, err := rtc.NewManager(rtc.Config{MaxParticipantsPerCall: 4}, statusMembership{status: status}, nopSender{})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	t.Cleanup(mgr.Stop)
	body, _ := json.Marshal(map[string]string{"channel_id": "chan-1"})
	if err := mgr.HandleSignal("u1", "user1", rtc.MsgJoin, body); err != nil {
		t.Fatalf("HandleSignal: %v", err)
	}
	return mgr.Stats()
}

// Kicked, left and banned members keep a junction record, but must not be able to join (or listen in on) a call.
func TestRTCJoin_RequiresActiveMembership(t *testing.T) {
	for _, status := range []string{models.StatusKicked, models.StatusLeft, "banned", ""} {
		s := joinStats(t, status)
		if s.JoinsTotal != 0 || s.JoinsRejected != 1 {
			t.Errorf("status %q: joins=%d rejected=%d, want 0/1", status, s.JoinsTotal, s.JoinsRejected)
		}
	}
	if s := joinStats(t, models.StatusActive); s.JoinsTotal != 1 || s.JoinsRejected != 0 {
		t.Errorf("active member: joins=%d rejected=%d, want 1/0", s.JoinsTotal, s.JoinsRejected)
	}
}
