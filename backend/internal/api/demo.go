package api

import (
	"net/http"
	"sync"
	"time"

	"cove/backend/internal/middleware"
)

// signupWindow is the rolling period the per-IP demo signup limit applies to.
const signupWindow = 24 * time.Hour

// signupLimiter counts recent account creations per client IP. The zero value is ready to use.
type signupLimiter struct {
	mu   sync.Mutex
	seen map[string][]time.Time
}

// allow records a signup for ip and reports whether it is within limit per rolling window.
// A limit of 0 disables the check. Expired entries are dropped on every call so the map cannot grow unbounded.
func (l *signupLimiter) allow(ip string, limit int, now time.Time) bool {
	if limit <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.seen == nil {
		l.seen = make(map[string][]time.Time)
	}
	cutoff := now.Add(-signupWindow)
	for k, ts := range l.seen {
		kept := ts[:0]
		for _, t := range ts {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		if len(kept) == 0 {
			delete(l.seen, k)
		} else {
			l.seen[k] = kept
		}
	}
	if len(l.seen[ip]) >= limit {
		return false
	}
	l.seen[ip] = append(l.seen[ip], now)
	return true
}

// demoSignupDenied applies the [demo] sign-up limits and returns the HTTP status and i18n error key to
// reject with, or 0 when the sign-up may proceed. The per-IP slot is only consumed when the cap check passes.
func (h *Handler) demoSignupDenied(r *http.Request) (int, string) {
	if h.Demo.MaxUsers > 0 {
		users, err := h.Store.ListAllUsers()
		if err != nil {
			return http.StatusInternalServerError, "auth.errors.session_failed"
		}
		if len(users) >= h.Demo.MaxUsers {
			return http.StatusForbidden, "auth.errors.demo_full"
		}
	}
	if !h.signups.allow(middleware.ClientIP(r), h.Demo.SignupsPerIPPerDay, time.Now()) {
		return http.StatusTooManyRequests, "auth.errors.demo_signup_limit"
	}
	return 0, ""
}
