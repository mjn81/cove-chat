package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"cove/backend/internal/desktop"
	"cove/backend/internal/middleware"
)

// What the desktop shell really sends as its page origin (Wails v2.12): Windows serves the app from
// http://wails.localhost, macOS and Linux from wails://wails. A wrong value here is invisible on the developer's
// own OS but makes the whole app fail to connect ("could not reach the server") on the other.
var realDesktopOrigins = []string{"http://wails.localhost", "wails://wails"}

func corsServer() http.Handler {
	return middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), false, "https://chat.example.test")
}

func TestCORS_AllowsEveryDesktopOriginWithCredentials(t *testing.T) {
	for _, origin := range append(append([]string{}, realDesktopOrigins...), "https://wails.localhost", "https://chat.example.test") {
		for _, method := range []string{http.MethodGet, http.MethodOptions} {
			req := httptest.NewRequest(method, "/api/version", nil)
			req.Header.Set("Origin", origin)
			rec := httptest.NewRecorder()
			corsServer().ServeHTTP(rec, req)
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
				t.Errorf("%s from %q: Access-Control-Allow-Origin = %q, want it echoed", method, origin, got)
			}
			if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
				t.Errorf("%s from %q: credentials must be allowed for a trusted origin", method, origin)
			}
		}
	}
}

func TestCORS_StillRejectsForeignOrigins(t *testing.T) {
	for _, origin := range []string{"https://evil.example", "wails://wails.evil.example", "http://wails.localhost.evil.example", "null"} {
		req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		corsServer().ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %q must not be allowed, got Access-Control-Allow-Origin %q", origin, got)
		}
	}
}

func TestDesktopOriginsListCoversTheRealOnes(t *testing.T) {
	listed := map[string]bool{}
	for _, o := range desktop.Origins {
		listed[o] = true
	}
	for _, want := range realDesktopOrigins {
		if !listed[want] {
			t.Errorf("desktop.Origins is missing the real origin %q", want)
		}
	}
}
