package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"context"
	"net/http"
	"sync"
	"time"

	"cove/backend/internal/auth"
	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
)

type adminActorKey struct{}

// adminActor returns the signed-in admin or owner that requireAdmin loaded.
// It is only ever set by the middleware below, so handlers that call it are
// guaranteed to be running behind the role check.
func adminActor(r *http.Request) *models.User {
	u, _ := r.Context().Value(adminActorKey{}).(*models.User)
	return u
}

// requireAdmin runs after Sessions.Require. It loads the caller from the
// database on EVERY request (the role is never cached in the session), so
// revoking an admin is effective immediately. ownerOnly additionally demands
// the owner role. Both failures answer the same 403 so the response does not
// reveal which role would have been enough.
func (h *Handler) requireAdmin(ownerOnly bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := auth.SessionFromContext(r.Context())
		if session == nil {
			writeError(w, http.StatusUnauthorized, "auth.errors.unauthorized")
			return
		}
		u, err := h.Store.GetUser(session.UserID)
		if err != nil && !errors.Is(err, db.ErrNotFound) {
			// A storage failure is not proof the caller is a non-admin; do not report it as a refusal.
			writeInternal(w, "admin guard: load user", err, "admin.errors.internal")
			return
		}
		if err != nil || !models.IsServerAdmin(u.ServerRole) || (ownerOnly && u.ServerRole != models.ServerRoleOwner) {
			writeError(w, http.StatusForbidden, "admin.errors.forbidden")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), adminActorKey{}, u)))
	}
}

// ---- Step-up: re-enter the password for dangerous actions ------------------ //

const (
	stepUpMaxFailures = 5
	stepUpWindow      = 10 * time.Minute
)

// stepUpGuard limits wrong-password guesses per admin account. A stolen
// session token must not be usable to brute-force the password through the
// admin endpoints, so five failures lock step-up for ten minutes.
type stepUpGuard struct {
	mu       sync.Mutex
	failures map[string][]time.Time
}

func (g *stepUpGuard) locked(userID string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.recent(userID, now)) >= stepUpMaxFailures
}

func (g *stepUpGuard) fail(userID string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.failures == nil {
		g.failures = map[string][]time.Time{}
	}
	g.failures[userID] = append(g.recent(userID, now), now)
}

func (g *stepUpGuard) reset(userID string) {
	g.mu.Lock()
	delete(g.failures, userID)
	g.mu.Unlock()
}

// recent drops expired failures; callers hold g.mu.
func (g *stepUpGuard) recent(userID string, now time.Time) []time.Time {
	kept := g.failures[userID][:0]
	for _, t := range g.failures[userID] {
		if now.Sub(t) < stepUpWindow {
			kept = append(kept, t)
		}
	}
	if g.failures != nil {
		g.failures[userID] = kept
	}
	return kept
}

// confirmPassword checks the actor's current password for a dangerous action
// and writes the error response itself when it does not match. It returns
// true when the caller may proceed.
func (h *Handler) confirmPassword(w http.ResponseWriter, actor *models.User, password string) bool {
	if status, key := h.checkStepUp(actor, password); status != 0 {
		writeError(w, status, key)
		return false
	}
	return true
}

// checkStepUp is confirmPassword without the response: it returns the HTTP status and error key to reject with, or
// 0 when the password is right. Streaming handlers use it to decide before they read a large request body.
func (h *Handler) checkStepUp(actor *models.User, password string) (int, string) {
	now := time.Now()
	if h.stepUp.locked(actor.ID, now) {
		return http.StatusTooManyRequests, "admin.errors.too_many_attempts"
	}
	ok := false
	if password != "" && actor.PwdHash != nil {
		ok, _ = crypto.VerifyPassword(password, actor.PwdHash)
	}
	if !ok {
		h.stepUp.fail(actor.ID, now)
		logger.Warnf("admin: wrong password for step-up by user %s", actor.ID)
		return http.StatusForbidden, "admin.errors.password_invalid"
	}
	h.stepUp.reset(actor.ID)
	return 0, ""
}

// inviteRef is how an invite code appears in logs and the audit trail: a short digest, never the code itself. A
// code is a sign-up credential, and both sinks outlive the invite and are readable by more people than the code is
// meant for. The digest is enough to correlate an entry with the invite an admin is looking at.
func inviteRef(code string) string {
	sum := sha256.Sum256([]byte(code))
	return "invite#" + hex.EncodeToString(sum[:4])
}

// audit records an admin action in the log and the audit trail. Targets are
// names or codes, never passwords or secrets.
func (h *Handler) audit(actor *models.User, action, target string) {
	logger.Infof("admin: %s by %s (%s) target=%q", action, actor.Username, actor.ID, target)
	if err := h.Store.Audit(actor, action, target); err != nil {
		logger.Warnf("admin: could not write audit entry for %s: %v", action, err)
	}
}
