package store

import (
	"sync"

	"github.com/segmentio/ksuid"
)

var (
	messageIDMu   sync.Mutex
	lastMessageID ksuid.KSUID
)

// NewMessageID returns a time-sortable message ID that is strictly greater than every ID this process issued before.
// A plain KSUID only orders by whole seconds, so two messages sent in the same second would sort in random order
// in the channel (message keys are ordered by ID). Bumping to the next KSUID in sort order keeps send order.
// The state is in memory because it only needs to cover the current process: after a restart the clock has moved on.
func NewMessageID() string {
	messageIDMu.Lock()
	defer messageIDMu.Unlock()
	id := ksuid.New()
	if ksuid.Compare(id, lastMessageID) <= 0 {
		id = lastMessageID.Next()
	}
	lastMessageID = id
	return id.String()
}
