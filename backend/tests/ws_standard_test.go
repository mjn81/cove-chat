package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"

	"cove/backend/internal/api"
	"cove/backend/internal/apistd"
)

// echoUpgrade stands in for the WebSocket hub: it only completes the upgrade.
var echoUpgrade = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	_ = c.Close(websocket.StatusNormalClosure, "")
})

func wsWrapperServer(t *testing.T, enforce bool) (apiSrv, wsSrv *httptest.Server) {
	t.Helper()
	var h *api.Handler
	apiSrv = testServerWithLimits(t, 1, 1, func(hh *api.Handler) {
		h = hh
		hh.MinClientVersion = "0.10.0"
		hh.EnforceMinClient = enforce
	})
	wsSrv = httptest.NewServer(h.WrapWS(echoUpgrade))
	t.Cleanup(wsSrv.Close)
	return apiSrv, wsSrv
}

// The WebSocket mount lives outside NewRouter, but its upgrade must still advertise the API/server version.
func TestWSUpgrade_CarriesVersionHeadersEvenForOutdatedClients(t *testing.T) {
	_, wsSrv := wsWrapperServer(t, true) // hard minimum on: the upgrade must still go through
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, "ws"+wsSrv.URL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{apistd.HeaderClient: []string{"web/0.1.0 (api 1)"}},
	})
	if err != nil {
		t.Fatalf("an outdated client must still be able to upgrade (its hello explains the problem): %v", err)
	}
	_ = conn.Close(websocket.StatusNormalClosure, "")
	if resp.Header.Get(apistd.HeaderAPIVersion) == "" || resp.Header.Get(apistd.HeaderServerVersion) == "" {
		t.Fatalf("upgrade response lacks version headers: %v", resp.Header)
	}
}

// The upgrade shares the API's per-IP bucket, so /ws cannot be used to dodge the limit.
func TestWSUpgrade_SharesTheAPIRateLimit(t *testing.T) {
	apiSrv, wsSrv := wsWrapperServer(t, false)
	// burst is 2: one API call and one upgrade attempt use it up.
	if r := mustDo(t, newJSONReq(t, http.MethodGet, apiSrv.URL+"/api/captcha/challenge", "", nil)); r.StatusCode == http.StatusTooManyRequests {
		t.Fatal("first API call should not be limited")
	}
	get := func() *http.Response {
		req, _ := http.NewRequest(http.MethodGet, wsSrv.URL+"/ws", nil)
		return mustDo(t, req)
	}
	get()
	r := get()
	if r.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("third request from the same IP = %d, want 429", r.StatusCode)
	}
	if r.Header.Get(apistd.HeaderAPIVersion) == "" {
		t.Fatal("a rate-limited upgrade must still carry the version headers")
	}
	if _, code := errEnvelope(t, r); code != apistd.CodeRateLimited {
		t.Fatalf("code = %q", code)
	}
}
