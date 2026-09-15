package middleware

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"nodetalk/backend/internal/logger"

	"golang.org/x/time/rate"
)

// responseWriter is a wrapper for http.ResponseWriter to capture status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("http.Hijacker not implemented")
	}
	return h.Hijack()
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Recover returns a middleware that recovers from panics in downstream
// handlers, logs them, and returns a 500 instead of crashing the server.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Errorf("panic recovered: %s %s | %v", r.Method, r.URL.Path, rec)
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// TrustProxyHeaders controls whether realIP() trusts CF-Connecting-IP /
// X-Real-IP / X-Forwarded-For. It must only be enabled when the server sits
// behind a reverse proxy that itself overwrites these headers — otherwise
// any client can spoof its own IP for rate-limiting and logging purposes by
// setting them directly. Set once at startup from config.
var TrustProxyHeaders = false

// Logger returns a middleware that logs incoming requests.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{w, http.StatusOK}

		next.ServeHTTP(rw, r)

		duration := time.Since(start)
		logger.Infof(
			"[%s] %s %s | %d | %v",
			r.Method,
			r.URL.Path,
			realIP(r),
			rw.status,
			duration,
		)
	})
}

// ipLimiter stores a per-IP rate limiter and when it was last used, so idle
// entries can be evicted.
type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimiter holds limiters per IP and supports different per-route limits.
type RateLimiter struct {
	mu      sync.Mutex
	clients map[string]*ipLimiter
	rps     rate.Limit
	burst   int
}

// NewRateLimiter creates a new RateLimiter with the given requests-per-second
// and burst allowance, and starts a background sweeper that evicts entries
// idle for more than 10 minutes so the client map can't grow unbounded.
func NewRateLimiter(rps float64, burst int) *RateLimiter {
	rl := &RateLimiter{
		clients: make(map[string]*ipLimiter),
		rps:     rate.Limit(rps),
		burst:   burst,
	}
	go rl.sweepIdle()
	return rl
}

// getLimiter returns the rate limiter for the given IP, creating one if needed.
func (rl *RateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if l, ok := rl.clients[ip]; ok {
		l.lastSeen = time.Now()
		return l.limiter
	}
	l := &ipLimiter{limiter: rate.NewLimiter(rl.rps, rl.burst), lastSeen: time.Now()}
	rl.clients[ip] = l
	return l.limiter
}

// idleTimeout is how long a per-IP limiter can go unused before eviction.
const idleTimeout = 10 * time.Minute

// evictIdle removes limiter entries whose last use is before cutoff.
// Factored out of sweepIdle so tests can exercise eviction without waiting
// on the real ticker.
func (rl *RateLimiter) evictIdle(cutoff time.Time) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for ip, l := range rl.clients {
		if l.lastSeen.Before(cutoff) {
			delete(rl.clients, ip)
		}
	}
}

// sweepIdle periodically removes limiter entries that haven't been used
// recently, bounding memory use under a spoofed-IP flood.
func (rl *RateLimiter) sweepIdle() {
	ticker := time.NewTicker(idleTimeout)
	defer ticker.Stop()
	for range ticker.C {
		rl.evictIdle(time.Now().Add(-idleTimeout))
	}
}

// Limit returns an HTTP middleware that enforces rate limiting per client IP.
func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := realIP(r)
		if !rl.getLimiter(ip).Allow() {
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// realIP extracts the client IP. Proxy headers (CF-Connecting-IP,
// X-Real-IP, X-Forwarded-For) are only honored when TrustProxyHeaders is
// enabled, since otherwise a client can set them directly and spoof its
// apparent IP to any other client's, bypassing per-IP rate limiting.
func realIP(r *http.Request) string {
	if TrustProxyHeaders {
		if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
			return ip
		}
		if ip := r.Header.Get("X-Real-IP"); ip != "" {
			return ip
		}
		if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
			// X-Forwarded-For can be comma-separated; take the first.
			for i := 0; i < len(ip); i++ {
				if ip[i] == ',' {
					return ip[:i]
				}
			}
			return ip
		}
	}
	// Fall back to r.RemoteAddr (strips port).
	host := r.RemoteAddr
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
}

// CORS returns a middleware that sets permissive CORS headers and handles preflight requests.
func CORS(next http.Handler, isDev bool, allowedOrigins string) http.Handler {
	// Split allowed origins by comma
	origins := make(map[string]bool)
	allowAll := false
	for _, o := range strings.Split(allowedOrigins, ",") {
		o = strings.TrimSpace(o)
		if o == "*" {
			allowAll = true
		}
		if o != "" {
			origins[o] = true
		}
	}

	// Always allow Wails desktop app origins
	origins["wails://wails.localhost"] = true // macOS/Linux
	origins["http://wails.localhost"] = true  // Windows
	origins["http://localhost:34115"] = true  // Wails dev mode default

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Credentials (cookies) are only ever allowed for an origin we
		// explicitly trust. Reflecting an arbitrary Origin — or "*" — while
		// also allowing credentials would let any website make authenticated
		// cross-origin requests against this API using the visitor's
		// session cookie, defeating the browser's same-origin protections.
		switch {
		case origin != "" && origins[origin]:
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		case allowAll:
			// Wildcard config: intentionally never combined with credentials.
			w.Header().Set("Access-Control-Allow-Origin", "*")
		case isDev && origin != "":
			// Dev convenience for an unconfigured origin: allow the request,
			// but without credentials, since it wasn't explicitly trusted.
			if allowedOrigins != "" {
				logger.Warnf("CORS: Origin mismatch. Got %q, expected one of %q. Falling back to echoing origin (no credentials) in Dev mode.", origin, allowedOrigins)
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		case origin != "":
			// Production mismatch logging
			logger.Warnf("CORS: REJECTED origin %q. Not in allowed list: %q", origin, allowedOrigins)
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		
		// 3. Handle allowed headers (Content-Type, Authorization, and any requested headers)
		requestedHeaders := r.Header.Get("Access-Control-Request-Headers")
		if requestedHeaders != "" {
			w.Header().Set("Access-Control-Allow-Headers", requestedHeaders)
		} else {
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, Authorization, X-CSRF-Token")
		}

		// 4. Intercept and Terminate OPTIONS (Preflight) requests
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// 5. Continue for actual requests
		next.ServeHTTP(w, r)
	})
}

// JSON sets the Content-Type to application/json for all responses.
func JSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}
