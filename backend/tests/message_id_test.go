package tests

import (
	"testing"

	"cove/backend/internal/store"
)

// KSUIDs only order by whole seconds, so messages created in the same second used to sort randomly.
func TestNewMessageIDIsStrictlyIncreasing(t *testing.T) {
	prev := store.NewMessageID()
	for i := 0; i < 5000; i++ {
		next := store.NewMessageID()
		if next <= prev {
			t.Fatalf("id %d (%s) does not sort after the previous one (%s)", i, next, prev)
		}
		prev = next
	}
}
