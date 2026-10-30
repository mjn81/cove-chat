package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"cove/backend/internal/models"
)

// Cookie names and header used for the web client's httpOnly-cookie session.
// The desktop (Wails) client continues to use the Authorization header
// instead, since Wails' webview does not reliably persist httpOnly cookies.
const (
	SessionCookieName = "cove_session"
	CSRFCookieName    = "cove_csrf"
	CSRFHeaderName    = "X-CSRF-Token"
)

// SessionMeta describes the device behind a session, shown to the user in the active-devices list.
type SessionMeta struct {
	IP         string
	UserAgent  string
	DeviceName string
	AppName    string
	Platform   string
	City       string
	Country    string
}

// Session represents an authenticated server-side session stored in memory.
// Values handed out by the store are copies, so callers can read them without locking.
type Session struct {
	// ID is a public identifier safe to show to the user (unlike the bearer token), used to terminate a session.
	ID           string
	UserID       string
	Username     string
	CreatedAt    time.Time
	ExpiresAt    time.Time
	LastActiveAt time.Time
	Meta         SessionMeta
}

// SessionPersister defines optional persistence for sessions across server restarts.
type SessionPersister interface {
	SetSession(s *models.Session) error
	DeleteSession(token string) error
	ListSessions() ([]*models.Session, error)
}

const (
	// lastActiveGranularity bounds how often a request refreshes LastActiveAt in memory.
	lastActiveGranularity = time.Minute
	// lastActivePersistEvery bounds how often that refresh is written to the database.
	lastActivePersistEvery = 5 * time.Minute
)

// hashToken returns the storage key for a bearer token. Only this SHA-256 hash is kept in memory and in the
// database, so a leaked database or backup cannot be replayed as live sessions.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newSessionID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("auth: session id generation failed: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (s *Session) toModel(tokenHash string) *models.Session {
	return &models.Session{
		Token:        tokenHash,
		ID:           s.ID,
		UserID:       s.UserID,
		Username:     s.Username,
		CreatedAt:    s.CreatedAt,
		ExpiresAt:    s.ExpiresAt,
		LastActiveAt: s.LastActiveAt,
		IP:           s.Meta.IP,
		UserAgent:    s.Meta.UserAgent,
		DeviceName:   s.Meta.DeviceName,
		AppName:      s.Meta.AppName,
		Platform:     s.Meta.Platform,
		City:         s.Meta.City,
		Country:      s.Meta.Country,
	}
}

func sessionFromModel(m *models.Session) *Session {
	return &Session{
		ID:           m.ID,
		UserID:       m.UserID,
		Username:     m.Username,
		CreatedAt:    m.CreatedAt,
		ExpiresAt:    m.ExpiresAt,
		LastActiveAt: m.LastActiveAt,
		Meta: SessionMeta{
			IP: m.IP, UserAgent: m.UserAgent, DeviceName: m.DeviceName, AppName: m.AppName,
			Platform: m.Platform, City: m.City, Country: m.Country,
		},
	}
}

// SessionStore is an in-memory session registry with TTL-based expiry and optional persistence.
// It is keyed by the SHA-256 hash of the bearer token.
type SessionStore struct {
	mu        sync.RWMutex
	sessions  map[string]*Session
	persistAt map[string]time.Time
	ttl       time.Duration
	persister SessionPersister
}

// NewSessionStore creates a new SessionStore, hydrates valid sessions if a persister is provided,
// and starts the background expiry sweeper.
func NewSessionStore(ttl time.Duration, persister ...SessionPersister) *SessionStore {
	ss := &SessionStore{
		sessions:  make(map[string]*Session),
		persistAt: make(map[string]time.Time),
		ttl:       ttl,
	}
	if len(persister) > 0 && persister[0] != nil {
		ss.persister = persister[0]
		if saved, err := ss.persister.ListSessions(); err == nil {
			now := time.Now()
			for _, m := range saved {
				if m == nil {
					continue
				}
				if !now.Before(m.ExpiresAt) || m.ID == "" {
					// Expired, or a legacy row keyed by a raw token that can no longer be matched.
					_ = ss.persister.DeleteSession(m.Token)
					continue
				}
				ss.sessions[m.Token] = sessionFromModel(m)
			}
		}
	}
	go ss.sweepExpired()
	return ss
}

// Create generates a secure random token, stores the session, and returns the token string.
func (ss *SessionStore) Create(userID, username string) (string, error) {
	token, _, err := ss.CreateWithMeta(userID, username, SessionMeta{})
	return token, err
}

// CreateWithMeta is Create plus the device metadata shown in the active-devices list. It also returns a copy
// of the new session so callers can read its public ID.
func (ss *SessionStore) CreateWithMeta(userID, username string, meta SessionMeta) (string, Session, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", Session{}, fmt.Errorf("auth: token generation failed: %w", err)
	}
	id, err := newSessionID()
	if err != nil {
		return "", Session{}, err
	}
	token := base64.URLEncoding.EncodeToString(raw)
	now := time.Now()
	s := &Session{
		ID:           id,
		UserID:       userID,
		Username:     username,
		CreatedAt:    now,
		ExpiresAt:    now.Add(ss.ttl),
		LastActiveAt: now,
		Meta:         meta,
	}
	key := hashToken(token)
	ss.mu.Lock()
	ss.sessions[key] = s
	ss.persistAt[key] = now
	ss.mu.Unlock()

	if ss.persister != nil {
		_ = ss.persister.SetSession(s.toModel(key))
	}
	return token, *s, nil
}

// Validate returns a copy of the session associated with token, or an error if it is invalid or expired.
// It also refreshes the session's last-active time.
func (ss *SessionStore) Validate(token string) (*Session, error) {
	key := hashToken(token)
	ss.mu.RLock()
	s, ok := ss.sessions[key]
	var snapshot Session
	if ok {
		snapshot = *s
	}
	ss.mu.RUnlock()
	if !ok {
		return nil, errors.New("auth: invalid session token")
	}
	now := time.Now()
	if now.After(snapshot.ExpiresAt) {
		ss.deleteKey(key)
		return nil, errors.New("auth: session expired")
	}
	if now.Sub(snapshot.LastActiveAt) >= lastActiveGranularity {
		ss.touch(key, now)
		snapshot.LastActiveAt = now
	}
	return &snapshot, nil
}

// touch records activity, writing through to the database only every lastActivePersistEvery.
func (ss *SessionStore) touch(key string, now time.Time) {
	ss.mu.Lock()
	s, ok := ss.sessions[key]
	if !ok {
		ss.mu.Unlock()
		return
	}
	s.LastActiveAt = now
	persist := ss.persister != nil && now.Sub(ss.persistAt[key]) >= lastActivePersistEvery
	var rec *models.Session
	if persist {
		ss.persistAt[key] = now
		rec = s.toModel(key)
	}
	ss.mu.Unlock()
	if rec != nil {
		_ = ss.persister.SetSession(rec)
	}
}

func (ss *SessionStore) deleteKey(key string) {
	ss.mu.Lock()
	delete(ss.sessions, key)
	delete(ss.persistAt, key)
	ss.mu.Unlock()
	if ss.persister != nil {
		_ = ss.persister.DeleteSession(key)
	}
}

// Delete removes a session (logout).
func (ss *SessionStore) Delete(token string) {
	ss.deleteKey(hashToken(token))
}

// ListByUser returns copies of the user's live sessions, most recently active first.
func (ss *SessionStore) ListByUser(userID string) []Session {
	now := time.Now()
	ss.mu.RLock()
	var out []Session
	for _, s := range ss.sessions {
		if s.UserID == userID && now.Before(s.ExpiresAt) {
			out = append(out, *s)
		}
	}
	ss.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool { return out[i].LastActiveAt.After(out[j].LastActiveAt) })
	return out
}

// DeleteByID ends the session with the given public id, but only if it belongs to userID, so one user can never
// terminate another's session. It reports whether a session was removed.
func (ss *SessionStore) DeleteByID(userID, id string) bool {
	ss.mu.Lock()
	var key string
	for k, s := range ss.sessions {
		if s.ID == id && s.UserID == userID {
			key = k
			break
		}
	}
	if key == "" {
		ss.mu.Unlock()
		return false
	}
	delete(ss.sessions, key)
	delete(ss.persistAt, key)
	ss.mu.Unlock()
	if ss.persister != nil {
		_ = ss.persister.DeleteSession(key)
	}
	return true
}

// DeleteOthers ends every session of userID except keepID and returns the ids it removed, so the caller can
// also close their live WebSockets.
func (ss *SessionStore) DeleteOthers(userID, keepID string) []string {
	ss.mu.Lock()
	var keys, ids []string
	for k, s := range ss.sessions {
		if s.UserID == userID && s.ID != keepID {
			keys = append(keys, k)
			ids = append(ids, s.ID)
			delete(ss.sessions, k)
			delete(ss.persistAt, k)
		}
	}
	ss.mu.Unlock()
	if ss.persister != nil {
		for _, k := range keys {
			_ = ss.persister.DeleteSession(k)
		}
	}
	return ids
}

// UpdateUsername updates the cached username for active session.
func (ss *SessionStore) UpdateUsername(token, newUsername string) {
	key := hashToken(token)
	ss.mu.Lock()
	var rec *models.Session
	if s, ok := ss.sessions[key]; ok {
		s.Username = newUsername
		if ss.persister != nil {
			rec = s.toModel(key)
		}
	}
	ss.mu.Unlock()
	if rec != nil {
		_ = ss.persister.SetSession(rec)
	}
}

// sweepExpired runs every hour to purge expired sessions.
func (ss *SessionStore) sweepExpired() {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		ss.mu.Lock()
		for key, s := range ss.sessions {
			if now.After(s.ExpiresAt) {
				delete(ss.sessions, key)
				delete(ss.persistAt, key)
				if ss.persister != nil {
					_ = ss.persister.DeleteSession(key)
				}
			}
		}
		ss.mu.Unlock()
	}
}

// ---- HTTP Helpers ---------------------------------------------------------- //

// wsAuthSubprotocolPrefix marks the WebSocket subprotocol a client can offer
// to authenticate the handshake without putting the token in the URL, where
// it would leak into access logs, proxy logs, and browser history. Used only
// by the Wails desktop client, whose webview doesn't reliably persist
// httpOnly cookies. The token's base64url padding ('=') is stripped by the
// client since '=' isn't a legal character in an HTTP token / WS subprotocol
// value, and restored here.
const wsAuthSubprotocolPrefix = "cove-token."

// wsAuthSubprotocol scans the Sec-WebSocket-Protocol header for a
// "cove-token.<token>" entry. It returns the exact subprotocol string
// (which must be echoed back to the client verbatim per RFC 6455 to accept
// the connection) and the decoded session token.
func wsAuthSubprotocol(r *http.Request) (proto, token string, ok bool) {
	header := r.Header.Get("Sec-WebSocket-Protocol")
	if header == "" {
		return "", "", false
	}
	for _, p := range strings.Split(header, ",") {
		p = strings.TrimSpace(p)
		rest, found := strings.CutPrefix(p, wsAuthSubprotocolPrefix)
		if !found || rest == "" {
			continue
		}
		if pad := len(rest) % 4; pad != 0 {
			rest += strings.Repeat("=", 4-pad)
		}
		return p, rest, true
	}
	return "", "", false
}

// WSSubprotocol reports the subprotocol a client offered for token auth (if
// any), so the WebSocket handshake can echo it back per RFC 6455.
func WSSubprotocol(r *http.Request) (string, bool) {
	proto, _, ok := wsAuthSubprotocol(r)
	return proto, ok
}

// BearerToken extracts the token from the `Authorization: Bearer <token>`
// header. This is the desktop/API client path — it never reads the session
// cookie. Tokens are never accepted via URL query parameter: query strings
// land in server access logs, proxy logs, and browser history.
func BearerToken(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	if len(h) >= 8 && h[:7] == "Bearer " {
		return h[7:], nil
	}
	return "", errors.New("auth: missing or malformed token")
}

// ResolveToken extracts the session token from an incoming request, preferring
// the Authorization header (desktop/API clients), then the WebSocket
// subprotocol auth scheme (desktop client's WS handshake), and falling back
// to the httpOnly session cookie (web client). viaCookie reports whether the
// cookie was the source, which callers use to decide whether CSRF protection
// applies (bearer-token requests can't be forged cross-site the way ambient
// cookies can).
func ResolveToken(r *http.Request) (token string, viaCookie bool, err error) {
	if t, berr := BearerToken(r); berr == nil {
		return t, false, nil
	}
	if _, t, ok := wsAuthSubprotocol(r); ok {
		return t, false, nil
	}
	if c, cerr := r.Cookie(SessionCookieName); cerr == nil && c.Value != "" {
		return c.Value, true, nil
	}
	return "", false, errors.New("auth: missing or malformed token")
}

// isMutatingMethod reports whether an HTTP method can change server state,
// and therefore needs CSRF protection when authenticated via ambient cookie.
func isMutatingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// validCSRF implements the double-submit-cookie check: the client must echo
// the (non-httpOnly, JS-readable) CSRF cookie value back as a header. A
// cross-site attacker can trigger the cookie-bearing request but cannot read
// the cookie value to put it in the header, since that's blocked by the
// browser's same-origin policy.
func validCSRF(r *http.Request) bool {
	cookie, err := r.Cookie(CSRFCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	header := r.Header.Get(CSRFHeaderName)
	if header == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) == 1
}

// GenerateCSRFToken creates a new random CSRF token to pair with a session.
func GenerateCSRFToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("auth: csrf token generation failed: %w", err)
	}
	return base64.URLEncoding.EncodeToString(raw), nil
}

// SetSessionCookies writes the httpOnly session cookie and the readable CSRF
// cookie for the web client. secure should be true whenever the server is
// reachable over HTTPS (i.e. !devMode).
//
// Always SameSite=Lax. An earlier version of this function issued
// SameSite=None for requests from a recognized Wails-desktop origin, on the
// reasoning that Wails' webview serves the frontend from a different origin
// than this API, so a Lax cookie (sent only on top-level navigations) would
// never ride along on a normal fetch/XHR call. That's true, but it doesn't
// help: the CSRF cookie is non-httpOnly specifically so client JS can read
// it via document.cookie and echo it back as a header, and document.cookie
// only ever exposes cookies scoped to the CURRENT page's own origin — a page
// running on a different origin (wails://…, localhost:34115) can never read
// it, regardless of SameSite. That's basic cookie scoping (RFC 6265), not a
// SameSite question, so no SameSite value makes this cookie+CSRF scheme work
// for a cross-origin client. The desktop client is architecturally stuck on
// Bearer-token auth for as long as it's served from a different origin than
// the API — fixing that for real means reverse-proxying /api under the
// Wails asset-server's own origin, not a cookie-attribute tweak.
func SetSessionCookies(w http.ResponseWriter, token, csrfToken string, ttl time.Duration, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    csrfToken,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookies expires both auth cookies (logout / account deletion).
func ClearSessionCookies(w http.ResponseWriter, secure bool) {
	for _, name := range []string{SessionCookieName, CSRFCookieName} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			Expires:  time.Unix(0, 0),
			MaxAge:   -1,
			HttpOnly: name == SessionCookieName,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
	}
}

// Require is an HTTP middleware that enforces session authentication.
// On success, the session is written to the request context via the sessionKey.
func (ss *SessionStore) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, viaCookie, err := ResolveToken(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		session, err := ss.Validate(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if viaCookie && isMutatingMethod(r.Method) {
			if !validCSRF(r) {
				writeError(w, http.StatusForbidden, "csrf validation failed")
				return
			}
		}
		// Attach session into context for downstream handlers.
		ctx := withSession(r.Context(), session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// DeleteExcept ends every session that does not belong to userID. The admin
// "reset server" action uses it so only the owner stays signed in.
func (ss *SessionStore) DeleteExcept(userID string) {
	ss.mu.Lock()
	var drop []string
	for token, s := range ss.sessions {
		if s.UserID != userID {
			drop = append(drop, token)
			delete(ss.sessions, token)
			delete(ss.persistAt, token)
		}
	}
	ss.mu.Unlock()
	if ss.persister != nil {
		for _, t := range drop {
			_ = ss.persister.DeleteSession(t)
		}
	}
}
