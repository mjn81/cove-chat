package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"cove/backend/internal/api"
	"cove/backend/internal/apistd"
	"cove/backend/internal/models"
	"cove/backend/internal/version"
)

// errBody is the standard error envelope (docs/api-standard.md).
type errBody struct {
	Error   string            `json:"error"`
	Code    string            `json:"code"`
	Details map[string]string `json:"details"`
}

func getWith(t *testing.T, srv *httptest.Server, path, clientHeader string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if clientHeader != "" {
		req.Header.Set(apistd.HeaderClient, clientHeader)
	}
	return mustDo(t, req)
}

func TestAPIStandard_VersionPayload(t *testing.T) {
	srv := testServerWith(t, func(h *api.Handler) {
		h.UDPPort = 9090
		h.MinClientVersion = "0.9.0"
		h.VoiceMode = "webrtc"
	})
	defer srv.Close()

	resp := getWith(t, srv, "/api/version", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body struct {
		Version          string   `json:"version"`
		UDPPort          int      `json:"udp_port"`
		APIVersion       int      `json:"api_version"`
		MinClientVersion string   `json:"min_client_version"`
		Capabilities     []string `json:"capabilities"`
	}
	decodeJSON(t, resp, &body)
	if body.Version != version.Version || body.UDPPort != 9090 {
		t.Errorf("legacy fields changed: %+v", body)
	}
	if body.APIVersion != apistd.APIVersion || body.MinClientVersion != "0.9.0" {
		t.Errorf("new fields wrong: %+v", body)
	}
	want := map[string]bool{"invite_messages": false, "whisper": false, "webrtc_sfu": false}
	for _, c := range body.Capabilities {
		want[c] = true
	}
	for c, ok := range want {
		if !ok {
			t.Errorf("capability %q missing from %v", c, body.Capabilities)
		}
	}
}

func TestAPIStandard_HeadersOnEveryResponse(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	// success, 401 (protected), 404 (unknown route)
	for _, path := range []string{"/api/version", "/api/me", "/api/nope"} {
		resp := getWith(t, srv, path, "")
		if got := resp.Header.Get(apistd.HeaderAPIVersion); got != "2" {
			t.Errorf("%s: %s = %q", path, apistd.HeaderAPIVersion, got)
		}
		if got := resp.Header.Get(apistd.HeaderServerVersion); got != version.Version {
			t.Errorf("%s: %s = %q", path, apistd.HeaderServerVersion, got)
		}
		_ = resp.Body.Close()
	}
}

func TestAPIStandard_ErrorEnvelopeHasCode(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()
	resp := getWith(t, srv, "/api/me", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var e errBody
	decodeJSON(t, resp, &e)
	if e.Code != apistd.CodeUnauthorized || e.Error == "" {
		t.Errorf("envelope = %+v", e)
	}
}

func TestAPIStandard_CodeForStatus(t *testing.T) {
	cases := map[int]string{
		400: "validation_failed", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
		413: "payload_too_large", 426: "client_outdated", 429: "rate_limited", 500: "internal", 502: "internal",
	}
	for status, want := range cases {
		if got := apistd.CodeForStatus(status); got != want {
			t.Errorf("CodeForStatus(%d) = %q, want %q", status, got, want)
		}
	}
}

func TestAPIStandard_ParseClientAndCompare(t *testing.T) {
	c := apistd.ParseClient("android/0.9.9 (api 1)")
	if !c.Known || c.Platform != "android" || c.Version != "0.9.9" || c.APIVersion != 1 {
		t.Errorf("parsed = %+v", c)
	}
	if apistd.ParseClient("garbage ¯\\_(ツ)_/¯").Known {
		t.Error("garbage must be unknown, not an error")
	}
	if cmp, ok := apistd.CompareVersions("0.9.10", "0.9.9"); !ok || cmp != 1 {
		t.Errorf("0.9.10 vs 0.9.9 = %d %v", cmp, ok)
	}
}

func enforcing(min string, hard bool) func(h *api.Handler) {
	return func(h *api.Handler) {
		h.MinClientVersion = min
		h.EnforceMinClient = hard
	}
}

func TestAPIStandard_OutdatedClientGets426WhenEnforced(t *testing.T) {
	srv := testServerWith(t, enforcing("1.0.0", true))
	defer srv.Close()

	resp := getWith(t, srv, "/api/me", "web/0.9.0 (api 1)")
	if resp.StatusCode != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426", resp.StatusCode)
	}
	if resp.Header.Get(apistd.HeaderAPIVersion) == "" {
		t.Error("426 must still carry the version headers")
	}
	var e errBody
	decodeJSON(t, resp, &e)
	if e.Code != apistd.CodeClientOutdated || e.Error == "" || e.Details["min_client_version"] != "1.0.0" {
		t.Errorf("envelope = %+v", e)
	}
}

func TestAPIStandard_CurrentClientPassesWhenEnforced(t *testing.T) {
	srv := testServerWith(t, enforcing("1.0.0", true))
	defer srv.Close()
	resp := getWith(t, srv, "/api/me", "web/1.0.0 (api 1)")
	if resp.StatusCode != http.StatusUnauthorized { // reached the handler, just not logged in
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestAPIStandard_NoHeaderAllowedUnlessHardMinimum(t *testing.T) {
	soft := testServerWith(t, enforcing("1.0.0", false))
	defer soft.Close()
	if resp := getWith(t, soft, "/api/me", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no header, soft: status = %d, want 401", resp.StatusCode)
	}
	// A known-but-old client is only warned about, never blocked, when enforcement is off.
	resp := getWith(t, soft, "/api/me", "web/0.1.0 (api 1)")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("old client, soft: status = %d, want 401", resp.StatusCode)
	}
	if resp.Header.Get(apistd.HeaderClientOutdated) != "1" {
		t.Error("soft mode should flag the response with " + apistd.HeaderClientOutdated)
	}

	hard := testServerWith(t, enforcing("1.0.0", true))
	defer hard.Close()
	if resp := getWith(t, hard, "/api/me", ""); resp.StatusCode != http.StatusUpgradeRequired {
		t.Errorf("no header, hard: status = %d, want 426", resp.StatusCode)
	}
}

func TestAPIStandard_UnknownHeaderTolerated(t *testing.T) {
	srv := testServerWith(t, enforcing("", false))
	defer srv.Close()
	for _, h := range []string{"???", "toaster", "x/y/z (api banana)"} {
		if resp := getWith(t, srv, "/api/version", h); resp.StatusCode != http.StatusOK {
			t.Errorf("header %q: status = %d", h, resp.StatusCode)
		}
	}
}

func TestAPIStandard_ExemptPathsNeverBlocked(t *testing.T) {
	srv := testServerWith(t, enforcing("99.0.0", true))
	defer srv.Close()
	for _, p := range []string{"/api/version", "/api/server-info"} {
		if resp := getWith(t, srv, p, "web/0.0.1 (api 1)"); resp.StatusCode == http.StatusUpgradeRequired {
			t.Errorf("%s must stay reachable so the client can explain the mismatch", p)
		}
	}
}

func TestAPIStandard_WSHelloAndUnknownEventTolerated(t *testing.T) {
	srv, token := prodHub(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	var first models.WSMessage
	if err := wsjson.Read(ctx, conn, &first); err != nil {
		t.Fatalf("read hello: %v", err)
	}
	if first.Type != "hello" {
		t.Fatalf("first event = %q, want hello", first.Type)
	}
	if string(first.Payload) == "" {
		t.Fatal("hello has no payload")
	}

	// A event type from a newer client must be ignored without dropping the connection.
	if err := wsjson.Write(ctx, conn, models.WSMessage{Type: "from_the_future", Payload: []byte(`{"x":1}`)}); err != nil {
		t.Fatalf("write unknown: %v", err)
	}
	if err := wsjson.Write(ctx, conn, models.WSMessage{Type: "ping", Payload: []byte(`{}`)}); err != nil {
		t.Fatalf("write ping: %v", err)
	}
	for {
		var m models.WSMessage
		if err := wsjson.Read(ctx, conn, &m); err != nil {
			t.Fatalf("connection died after unknown event: %v", err)
		}
		if m.Type == "pong" {
			return
		}
	}
}
