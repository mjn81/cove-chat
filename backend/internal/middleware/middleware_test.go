package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newCORSHandler(isDev bool, allowedOrigins string) http.Handler {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return CORS(next, isDev, allowedOrigins)
}

// TestCORS_ExplicitOrigin_AllowsCredentials verifies that a browser origin
// explicitly listed in frontend_origin gets both a matching
// Access-Control-Allow-Origin and Access-Control-Allow-Credentials — this is
// required for the cookie-based web auth flow to work at all.
func TestCORS_ExplicitOrigin_AllowsCredentials(t *testing.T) {
	h := newCORSHandler(false, "https://app.example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Errorf("Allow-Origin = %q, want the explicit origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Allow-Credentials = %q, want %q for an explicitly trusted origin", got, "true")
	}
}

// TestCORS_Wildcard_NeverAllowsCredentials is the regression test for the
// finding this fix addresses: reflecting an arbitrary Origin (or "*") while
// also allowing credentials would let any website make authenticated
// cross-origin requests using a visitor's session cookie. A wildcard
// configuration must never be paired with Allow-Credentials.
func TestCORS_Wildcard_NeverAllowsCredentials(t *testing.T) {
	h := newCORSHandler(false, "*")

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Origin", "https://totally-untrusted.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Allow-Origin = %q, want literal wildcard", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("Allow-Credentials = %q, want empty (never set) for a wildcard config", got)
	}
}

// TestCORS_DevFallback_UnconfiguredOrigin_NeverAllowsCredentials covers the
// dev-mode convenience path for an origin that was NOT explicitly listed: it
// may be reflected back (for local development ergonomics), but must still
// never receive Allow-Credentials, since it wasn't a trusted origin.
func TestCORS_DevFallback_UnconfiguredOrigin_NeverAllowsCredentials(t *testing.T) {
	h := newCORSHandler(true, "https://app.example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Origin", "http://random-dev-origin.test")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://random-dev-origin.test" {
		t.Errorf("Allow-Origin = %q, want the reflected dev-mode origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("Allow-Credentials = %q, want empty (never set) for an unconfigured origin, even in dev", got)
	}
}

// TestCORS_UnknownOrigin_Production_Rejected verifies that in production
// (isDev: false) an origin outside the allowed list gets no CORS headers at
// all — a browser will then block the response from being read.
func TestCORS_UnknownOrigin_Production_Rejected(t *testing.T) {
	h := newCORSHandler(false, "https://app.example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Origin", "https://totally-untrusted.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Allow-Origin = %q, want empty for an untrusted production origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("Allow-Credentials = %q, want empty for an untrusted production origin", got)
	}
}

// TestRealIP_IgnoresForwardedHeadersByDefault guards against IP spoofing via
// forwarded headers: unless TrustProxyHeaders is explicitly enabled (because
// the server sits behind a reverse proxy that overwrites these itself), a
// client could set X-Forwarded-For directly to spoof its rate-limit/log
// identity and either evade or frame another client.
func TestRealIP_IgnoresForwardedHeadersByDefault(t *testing.T) {
	old := TrustProxyHeaders
	TrustProxyHeaders = false
	defer func() { TrustProxyHeaders = old }()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:1234"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	req.Header.Set("X-Real-IP", "5.6.7.8")

	if got := realIP(req); got != "203.0.113.5" {
		t.Errorf("realIP = %q, want RemoteAddr %q (forwarded headers must be ignored by default)", got, "203.0.113.5")
	}
}

func TestRealIP_TrustsForwardedHeadersWhenEnabled(t *testing.T) {
	old := TrustProxyHeaders
	TrustProxyHeaders = true
	defer func() { TrustProxyHeaders = old }()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:1234"
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 9.9.9.9")

	if got := realIP(req); got != "1.2.3.4" {
		t.Errorf("realIP = %q, want first X-Forwarded-For entry %q", got, "1.2.3.4")
	}
}

// TestRateLimiter_EvictIdle_RemovesStaleEntriesOnly guards against the
// unbounded memory growth a spoofed-IP flood could otherwise cause: every
// distinct IP gets a permanent limiter entry unless idle ones are evicted.
// A recently-used entry must survive the same sweep.
func TestRateLimiter_EvictIdle_RemovesStaleEntriesOnly(t *testing.T) {
	rl := &RateLimiter{
		clients: make(map[string]*ipLimiter),
		rps:     10,
		burst:   10,
	}
	rl.getLimiter("1.2.3.4") // will be made stale below
	rl.getLimiter("5.6.7.8") // stays recently used

	rl.mu.Lock()
	if len(rl.clients) != 2 {
		rl.mu.Unlock()
		t.Fatalf("expected 2 tracked clients, got %d", len(rl.clients))
	}
	rl.clients["1.2.3.4"].lastSeen = time.Now().Add(-idleTimeout - time.Minute)
	rl.mu.Unlock()

	rl.evictIdle(time.Now().Add(-idleTimeout))

	rl.mu.Lock()
	defer rl.mu.Unlock()
	if _, stillThere := rl.clients["1.2.3.4"]; stillThere {
		t.Error("stale entry for 1.2.3.4 was not evicted")
	}
	if _, stillThere := rl.clients["5.6.7.8"]; !stillThere {
		t.Error("recently-used entry for 5.6.7.8 was incorrectly evicted")
	}
}
