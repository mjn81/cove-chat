package ws

import (
	"sync"
	"time"

	"cove/backend/internal/models"
)

// Per-connection limit for client-originated events. Generous enough for a fast typist, read receipts and WebRTC
// ICE candidate bursts, yet a flooding client cannot saturate the dispatcher, the store or other users' send buffers.
const (
	clientEventsPerSecond = 30.0
	clientEventBurst      = 60.0
)

// tokenBucket is a minimal token-bucket limiter. It is per connection and used from the read pump only, but keeps a
// mutex so it stays safe if that ever changes.
type tokenBucket struct {
	mu     sync.Mutex
	tokens float64
	last   time.Time
	rate   float64
	burst  float64
}

func newTokenBucket(rate, burst float64) *tokenBucket {
	return &tokenBucket{tokens: burst, last: time.Now(), rate: rate, burst: burst}
}

// allow consumes one token and reports whether the event may proceed.
func (b *tokenBucket) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.tokens += now.Sub(b.last).Seconds() * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// effectiveStatus is the presence a user should show while connected: their explicit preference when they set one
// (dnd, away, offline, online), otherwise "online" for the automatic mode.
func effectiveStatus(u *models.User) (status string, auto bool) {
	if u != nil && u.StatusPreference != "" && u.StatusPreference != "auto" {
		return u.StatusPreference, false
	}
	return "online", true
}
