package tests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"cove/backend/internal/api"
)

// fakeCaptcha accepts exactly one token and can simulate an unreachable verification service.
type fakeCaptcha struct {
	good string
	err  error
	seen []string
}

func (f *fakeCaptcha) Verify(_ context.Context, token, ip string) (bool, error) {
	f.seen = append(f.seen, token+"|"+ip)
	if f.err != nil {
		return false, f.err
	}
	return token == f.good, nil
}

func captchaServer(t *testing.T, c api.CaptchaVerifier) string {
	t.Helper()
	return testServerWith(t, func(h *api.Handler) {
		h.Captcha = c
		h.TurnstileSiteKey = "site-key-123"
	}).URL
}

func registerWithToken(t *testing.T, base string, n int, token string) *http.Response {
	t.Helper()
	body := map[string]string{"username": "captcha_user_" + strconv.Itoa(n), "password": "password-123"}
	if token != "" {
		body["turnstile_token"] = token
	}
	return mustDo(t, newJSONReq(t, "POST", base+"/api/register", "", jsonBody(t, body)))
}

func errorKey(t *testing.T, r *http.Response) string {
	t.Helper()
	var e struct {
		Error string `json:"error"`
	}
	decodeJSON(t, r, &e)
	return e.Error
}

func TestTurnstile_ServerInfoExposesSiteKeyOnlyWhenConfigured(t *testing.T) {
	var on, off struct {
		Key string `json:"turnstile_site_key"`
	}
	decodeJSON(t, mustDo(t, newJSONReq(t, "GET", captchaServer(t, &fakeCaptcha{good: "ok"})+"/api/server-info", "", nil)), &on)
	if on.Key != "site-key-123" {
		t.Fatalf("site key = %q, want site-key-123", on.Key)
	}
	decodeJSON(t, mustDo(t, newJSONReq(t, "GET", testServer(t).URL+"/api/server-info", "", nil)), &off)
	if off.Key != "" {
		t.Fatalf("site key must be empty without a verifier, got %q", off.Key)
	}
}

func TestTurnstile_RegisterRequiresValidToken(t *testing.T) {
	f := &fakeCaptcha{good: "ok-token"}
	base := captchaServer(t, f)

	// The first account bootstraps the owner and is exempt, so the operator can always set the server up.
	if r := registerWithToken(t, base, 0, ""); r.StatusCode != http.StatusCreated {
		t.Fatalf("bootstrap signup without a token: %d, want 201", r.StatusCode)
	}

	r := registerWithToken(t, base, 1, "")
	if r.StatusCode != http.StatusBadRequest || errorKey(t, r) != "auth.errors.captcha_required" {
		t.Fatalf("missing token should be 400 captcha_required")
	}
	r = registerWithToken(t, base, 2, "wrong")
	if r.StatusCode != http.StatusForbidden || errorKey(t, r) != "auth.errors.captcha_failed" {
		t.Fatalf("bad token should be 403 captcha_failed")
	}
	if r := registerWithToken(t, base, 3, "ok-token"); r.StatusCode != http.StatusCreated {
		t.Fatalf("good token: %d, want 201", r.StatusCode)
	}
}

func TestTurnstile_VerifierOutageFailsClosed(t *testing.T) {
	base := captchaServer(t, &fakeCaptcha{good: "x", err: errors.New("network down")})
	if r := registerWithToken(t, base, 0, ""); r.StatusCode != http.StatusCreated {
		t.Fatalf("bootstrap signup must not depend on the verifier: %d", r.StatusCode)
	}
	r := registerWithToken(t, base, 1, "any")
	if r.StatusCode != http.StatusServiceUnavailable || errorKey(t, r) != "auth.errors.captcha_unavailable" {
		t.Fatalf("verifier outage should fail closed with 503 captcha_unavailable, got %d", r.StatusCode)
	}
}

func TestTurnstileVerifier_SiteverifyContract(t *testing.T) {
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		got = r.PostForm
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": r.PostForm.Get("response") == "good"})
	}))
	t.Cleanup(srv.Close)
	v := api.NewTurnstileVerifierAt("s3cret", srv.URL)

	ok, err := v.Verify(context.Background(), "good", "203.0.113.7")
	if err != nil || !ok {
		t.Fatalf("good token: ok=%v err=%v", ok, err)
	}
	if got.Get("secret") != "s3cret" || got.Get("response") != "good" || got.Get("remoteip") != "203.0.113.7" {
		t.Fatalf("siteverify form = %v", got)
	}
	if ok, err := v.Verify(context.Background(), "bad", "203.0.113.7"); err != nil || ok {
		t.Fatalf("bad token: ok=%v err=%v", ok, err)
	}
}

func TestTurnstileVerifier_NonOKStatusIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	if _, err := api.NewTurnstileVerifierAt("s", srv.URL).Verify(context.Background(), "t", "1.1.1.1"); err == nil {
		t.Fatal("a 500 from the verification service must be an error, not a rejection")
	}
}
