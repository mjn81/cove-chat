package tests

import (
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"

	"cove/backend/internal/api"
)

// publicRoutes are the only routes that may answer without a session. Anything NewRouter registers that is not
// listed here must reject an anonymous request, so a new route that forgets protect(...) fails this test.
var publicRoutes = map[string]bool{
	"GET /api/version":           true,
	"GET /api/server-info":       true,
	"POST /api/register":         true,
	"POST /api/login":            true,
	"GET /api/captcha/challenge": true,
}

var routePattern = regexp.MustCompile(`mux\.Handle\("([A-Z]+ )?(/[^"]*)"`)

// registeredRoutes reads the route table straight from handler.go, so the matrix can never drift from the router.
func registeredRoutes(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile("../internal/api/handler.go")
	if err != nil {
		t.Fatalf("read handler.go: %v", err)
	}
	var routes []string
	for _, m := range routePattern.FindAllStringSubmatch(string(src), -1) {
		method := strings.TrimSpace(m[1])
		if method == "" {
			continue // the "/api/admin/" catch-all is covered by TestUnknownAdminPathsAreGuardedToo
		}
		routes = append(routes, method+" "+m[2])
	}
	if len(routes) < 50 {
		t.Fatalf("parsed only %d routes from handler.go; the pattern is out of date", len(routes))
	}
	return routes
}

var pathParam = regexp.MustCompile(`\{[a-z]+\}`)

func concretePath(route string) (method, path string) {
	method, path, _ = strings.Cut(route, " ")
	return method, pathParam.ReplaceAllString(path, "x")
}

// Every non-public route answers 401 to an anonymous caller (never 200/403/404, which would leak that the route
// or its object exists).
func TestAccessMatrix_AnonymousIsRejectedEverywhere(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	for _, route := range registeredRoutes(t) {
		if publicRoutes[route] {
			continue
		}
		method, path := concretePath(route)
		resp := mustDo(t, newJSONReq(t, method, srv.URL+path, "", nil))
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s anonymous = %d, want 401", route, resp.StatusCode)
		}
	}
}

// A cookie-authenticated mutation without the CSRF header is refused on every mutating route.
func TestAccessMatrix_CookieMutationsNeedCSRFEverywhere(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	client, _ := loginWithCookies(t, srv, "csrfowner", "password123!")
	for _, route := range registeredRoutes(t) {
		method, path := concretePath(route)
		if publicRoutes[route] || method == http.MethodGet {
			continue
		}
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", route, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s with cookie and no CSRF header = %d, want 403", route, resp.StatusCode)
		}
	}
}

// A signed-in outsider gets the same 404 for another user's private channel as for a channel that does not exist,
// on every channel-scoped route: no existence leak and no access.
func TestAccessMatrix_NonMemberSeesNothingOfAPrivateChannel(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	owner := registerAndLogin(t, srv, "chowner", "password123!")
	outsider := registerAndLogin(t, srv, "outsider", "password123!")

	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", owner,
		jsonBody(t, api.CreateChannelRequest{Name: "secret", IsPrivate: true})))
	var ch api.ChannelResponse
	decodeJSON(t, resp, &ch)
	if ch.ID == "" {
		t.Fatal("channel not created")
	}

	for _, route := range registeredRoutes(t) {
		if !strings.Contains(route, "/api/channels/{id}") {
			continue
		}
		method, _ := concretePath(route)
		real := strings.ReplaceAll(pathParam.ReplaceAllStringFunc(strings.SplitN(route, " ", 2)[1], func(p string) string {
			if p == "{id}" {
				return ch.ID
			}
			return "x"
		}), "//", "/")
		ghost := strings.Replace(real, ch.ID, "no-such-channel", 1)

		a := mustDo(t, newJSONReq(t, method, srv.URL+real, outsider, jsonBody(t, map[string]any{})))
		a.Body.Close()
		b := mustDo(t, newJSONReq(t, method, srv.URL+ghost, outsider, jsonBody(t, map[string]any{})))
		b.Body.Close()
		if a.StatusCode != http.StatusNotFound || b.StatusCode != http.StatusNotFound {
			t.Errorf("%s outsider: real channel=%d, missing channel=%d, both must be 404", route, a.StatusCode, b.StatusCode)
		}
	}
}
