package tests

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"cove/backend/internal/api"
	"cove/backend/internal/apistd"
	"cove/update"
)

func TestCodeForStatus_NotImplementedIsFeatureUnsupported(t *testing.T) {
	if got := apistd.CodeForStatus(http.StatusNotImplemented); got != apistd.CodeFeatureUnsupported {
		t.Fatalf("501 -> %q, want feature_unsupported", got)
	}
}

// Every envelope, whichever layer writes it, is application/json with a code.
func TestEnvelopes_AreJSONWithCodeFromEveryLayer(t *testing.T) {
	srv, _, cleanup := setupWhisperTestServer(t)
	defer cleanup()

	check := func(name string, resp *http.Response, status int, code string) {
		t.Helper()
		if resp.StatusCode != status {
			t.Fatalf("%s status = %d, want %d", name, resp.StatusCode, status)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Fatalf("%s content type = %q, want application/json", name, ct)
		}
		if _, got := errEnvelope(t, resp); got != code {
			t.Fatalf("%s code = %q, want %q", name, got, code)
		}
	}

	// WebSocket upgrade without credentials (hub.go).
	resp, err := http.Get(srv.URL + "/ws")
	if err != nil {
		t.Fatal(err)
	}
	check("ws unauthorized", resp, http.StatusUnauthorized, "unauthorized")

	// Auth middleware (auth.go).
	resp, err = http.Get(srv.URL + "/api/me")
	if err != nil {
		t.Fatal(err)
	}
	check("session required", resp, http.StatusUnauthorized, "unauthorized")
}

func TestRateLimitEnvelopeIsJSONWithCode(t *testing.T) {
	srv := testServerWithLimits(t, 1, 1000, nil)
	var last *http.Response
	for i := 0; i < 10; i++ {
		resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/captcha/challenge", "", nil))
		if resp.StatusCode == http.StatusTooManyRequests {
			last = resp
			break
		}
		resp.Body.Close()
	}
	if last == nil {
		t.Fatal("never rate limited")
	}
	if ct := last.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("429 content type = %q", ct)
	}
	if _, code := errEnvelope(t, last); code != "rate_limited" {
		t.Fatalf("429 code = %q", code)
	}
}

func TestUpdate_UnsupportedAndDockerCarryFeatureUnsupportedCode(t *testing.T) {
	u := newUpdateEnv(t, update.ModeDocker, nil)
	resp := u.do(t, "POST", "/api/admin/update", u.owner, ownerPW)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("docker update = %d, want 409", resp.StatusCode)
	}
	if _, code := errEnvelope(t, resp); code != "feature_unsupported" {
		t.Fatalf("docker code = %q, want feature_unsupported", code)
	}

	none := newUpdateEnv(t, update.ModeBinary, nil)
	none.handler.Updater = nil
	resp = none.do(t, "POST", "/api/admin/update", none.owner, ownerPW)
	if resp.StatusCode != http.StatusNotImplemented {
		t.Fatalf("no updater = %d, want 501", resp.StatusCode)
	}
	if _, code := errEnvelope(t, resp); code != "feature_unsupported" {
		t.Fatalf("501 code = %q, want feature_unsupported", code)
	}
}

func TestOversizeJSONBodyIs413(t *testing.T) {
	srv := testServer(t)
	tok := registerAndLogin(t, srv, "big_json", testPassword)
	huge := `{"name":"` + strings.Repeat("a", 2<<20) + `"}`
	for name, req := range map[string]*http.Request{
		"login":          newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", bytes.NewBufferString(huge)),
		"create channel": newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tok, bytes.NewBufferString(huge)),
		"profile":        newJSONReq(t, http.MethodPatch, srv.URL+"/api/users/me", tok, bytes.NewBufferString(huge)),
	} {
		resp := mustDo(t, req)
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Fatalf("%s oversize = %d, want 413", name, resp.StatusCode)
		}
		if _, code := errEnvelope(t, resp); code != "payload_too_large" {
			t.Fatalf("%s code = %q", name, code)
		}
	}
}

func TestChannels_InputBounds(t *testing.T) {
	srv := testServer(t)
	tok := registerAndLogin(t, srv, "bounds_owner", testPassword)
	chID := createGroupChannel(t, srv, tok, "ok")

	long := strings.Repeat("n", 101)
	if r := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tok, jsonBody(t, api.CreateChannelRequest{Name: long}))); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("101-char name = %d, want 400", r.StatusCode)
	}
	if r := mustDo(t, newJSONReq(t, http.MethodPatch, srv.URL+"/api/channels/"+chID, tok, jsonBody(t, map[string]any{"name": long}))); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("101-char rename = %d, want 400", r.StatusCode)
	}
	// Names are trimmed.
	r := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tok, jsonBody(t, api.CreateChannelRequest{Name: "  padded  "})))
	var ch map[string]any
	decodeJSON(t, r, &ch)
	if ch["name"] != "padded" {
		t.Fatalf("name = %q, want it trimmed", ch["name"])
	}

	ids := make([]string, 201)
	for i := range ids {
		ids[i] = "u" + strings.Repeat("x", i%5) + string(rune('a'+i%26)) + string(rune('a'+i/26%26))
	}
	if r := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels/"+chID+"/members", tok, jsonBody(t, api.AddMembersRequest{UserIDs: uniqueIDs(ids, 201)}))); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("201 user_ids = %d, want 400", r.StatusCode)
	}
}

func uniqueIDs(base []string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = base[i%len(base)] + "-" + string(rune('A'+i%26)) + string(rune('A'+i/26))
	}
	return out
}

func TestMessages_InvalidLimitIs400(t *testing.T) {
	srv := testServer(t)
	tok := registerAndLogin(t, srv, "lim_user", testPassword)
	chID := createGroupChannel(t, srv, tok, "g")
	for _, q := range []string{"abc", "0", "-5", "101", "500"} {
		r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels/"+chID+"/messages?limit="+q, tok, nil))
		if r.StatusCode != http.StatusBadRequest {
			t.Fatalf("limit=%s = %d, want 400", q, r.StatusCode)
		}
	}
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels/"+chID+"/messages?limit=100", tok, nil)); r.StatusCode != http.StatusOK {
		t.Fatalf("limit=100 = %d, want 200", r.StatusCode)
	}
}

// A channel you are not in is indistinguishable from one that does not exist.
func TestNonMemberAndMissingChannelAreBoth404(t *testing.T) {
	srv := testServer(t)
	tokA := registerAndLogin(t, srv, "nm_owner", testPassword)
	tokE := registerAndLogin(t, srv, "nm_eve", testPassword)
	chID := createGroupChannel(t, srv, tokA, "secret")

	bodyOf := func(id string) (int, string) {
		resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels/"+id+"/messages", tokE, nil))
		return resp.StatusCode, rawBody(t, resp)
	}
	sMissing, bMissing := bodyOf("no-such-channel")
	sOutsider, bOutsider := bodyOf(chID)
	if sMissing != http.StatusNotFound || sOutsider != http.StatusNotFound {
		t.Fatalf("missing = %d, outsider = %d, want both 404", sMissing, sOutsider)
	}
	if bMissing != bOutsider {
		t.Fatalf("responses differ and leak existence:\n%s\n%s", bMissing, bOutsider)
	}
}

func TestRelationships_ErrorHandling(t *testing.T) {
	srv := testServer(t)
	tokA := registerAndLogin(t, srv, "rel_a", testPassword)
	tokB := registerAndLogin(t, srv, "rel_b", testPassword)
	bID := meID(t, srv, tokB)

	put := func(target, action string) *http.Response {
		return mustDo(t, newJSONReq(t, http.MethodPut, srv.URL+"/api/users/"+target+"/relationship", tokA, jsonBody(t, map[string]any{"action": action})))
	}
	// Unknown action: 400 and the value is not reflected back.
	resp := put(bID, "<script>alert(1)</script>")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown action = %d, want 400", resp.StatusCode)
	}
	if msg, _ := errEnvelope(t, resp); strings.Contains(msg, "script") {
		t.Fatalf("unknown action echoed back: %q", msg)
	}
	// Missing target: 404.
	if r := put("ghost-user", "request"); r.StatusCode != http.StatusNotFound {
		t.Fatalf("missing target = %d, want 404", r.StatusCode)
	}
	// Rule violation: 400 with the user-facing message.
	if r := put(bID, "request"); r.StatusCode != http.StatusOK {
		t.Fatalf("first request = %d", r.StatusCode)
	}
	resp = put(bID, "request")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("duplicate request = %d, want 400", resp.StatusCode)
	}
	if msg, _ := errEnvelope(t, resp); msg != "friend request already sent" {
		t.Fatalf("rule message = %q", msg)
	}
}
