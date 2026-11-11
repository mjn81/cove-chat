package api

import (
	"strings"
	"sync"
	"time"
)

const (
	loginMaxFailures = 20
	loginWindow      = 15 * time.Minute
	// loginGuardMaxKeys bounds the map so a flood of made-up usernames cannot grow it without limit.
	loginGuardMaxKeys = 20000
)

// loginGuard throttles wrong-password guesses per account name. The per-IP rate limit alone does not stop a
// distributed guess against one account, and Argon2id is deliberately expensive, so after loginMaxFailures failures
// inside loginWindow every further attempt for that name is refused (429) until the window passes, before any
// password hashing happens. Names that do not exist are tracked the same way, so the answer never reveals whether
// an account exists. A success clears the count.
//
// The state is ephemeral by design, like the other rate limiters: a restart resets it.
type loginGuard struct {
	mu       sync.Mutex
	failures map[string][]time.Time
}

func loginKey(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

// recent drops expired failures for key and returns the rest; callers hold g.mu.
func (g *loginGuard) recent(key string, now time.Time) []time.Time {
	kept := g.failures[key][:0]
	for _, t := range g.failures[key] {
		if now.Sub(t) < loginWindow {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(g.failures, key)
		return nil
	}
	g.failures[key] = kept
	return kept
}

func (g *loginGuard) locked(username string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.recent(loginKey(username), now)) >= loginMaxFailures
}

func (g *loginGuard) fail(username string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.failures == nil {
		g.failures = map[string][]time.Time{}
	}
	if len(g.failures) >= loginGuardMaxKeys {
		for k := range g.failures {
			g.recent(k, now)
		}
		if len(g.failures) >= loginGuardMaxKeys {
			return // still full of live entries: skip tracking rather than grow
		}
	}
	key := loginKey(username)
	g.failures[key] = append(g.recent(key, now), now)
}

func (g *loginGuard) reset(username string) {
	g.mu.Lock()
	delete(g.failures, loginKey(username))
	g.mu.Unlock()
}
