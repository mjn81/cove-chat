package tests

import (
	"testing"
	"time"

	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"

	"github.com/segmentio/ksuid"
)

// TestCountUnreadMessages_SameSecondAsLastRead guards against an undercount
// bug: the seek-optimization used to fabricate its start key with
// ksuid.NewRandomWithTime, whose payload is random. Since KSUIDs only carry
// second-granularity timestamps, a real unread message minted in the same
// wall-clock second as LastReadAt could sort *before* that random seek key
// and get skipped by it.Seek entirely — never visited, silently missing
// from the count. This reproduces that exact scenario with a low-valued
// KSUID payload for the unread message (the worst case for the old code)
// and asserts it's still counted.
func TestCountUnreadMessages_SameSecondAsLastRead(t *testing.T) {
	dir := t.TempDir()
	kek := crypto.DeriveKEK("unread-test-master-password")
	dek, err := db.BootstrapDEK(dir+"/meta", kek)
	if err != nil {
		t.Fatalf("bootstrap dek: %v", err)
	}
	database, err := db.Open(dir+"/main", dek)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	defer database.Close()

	userID := "reader-36-chars-uuid-mock-id-value!!"
	senderID := "sender-36-chars-uuid-mock-id-value!!"
	channelID := "channel-36-chars-uuid-mock-id-value!"

	lastRead := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	if err := database.SetUserChannel(&models.UserChannel{
		UserID:     userID,
		ChannelID:  channelID,
		Status:     "active",
		LastReadAt: lastRead,
	}); err != nil {
		t.Fatalf("SetUserChannel: %v", err)
	}

	// A real unread message sent 1ms after LastReadAt — same wall-clock
	// second — but with the all-zero (minimum-sorting) KSUID payload, the
	// worst case for a naive random-payload seek key to skip past.
	sentAt := lastRead.Add(time.Millisecond)
	msgKSUID, err := ksuid.FromParts(sentAt, make([]byte, 16))
	if err != nil {
		t.Fatalf("ksuid.FromParts: %v", err)
	}

	if err := database.SetMessage(&models.Message{
		ID:        msgKSUID.String(),
		ChannelID: channelID,
		SenderID:  senderID,
		Type:      models.MessageType("text"),
		SentAt:    sentAt,
	}); err != nil {
		t.Fatalf("SetMessage: %v", err)
	}

	count, err := database.CountUnreadMessages(userID, channelID)
	if err != nil {
		t.Fatalf("CountUnreadMessages: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 unread message minted in the same second as LastReadAt, got %d", count)
	}
}
