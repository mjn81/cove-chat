package tests

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/captcha"
)

// solve brute-forces a challenge the way every client does and returns the payload for /api/register.
func solve(t *testing.T, ch captcha.Challenge) string {
	t.Helper()
	for n := 0; n <= ch.MaxNumber; n++ {
		sum := sha256.Sum256([]byte(ch.Salt + strconv.Itoa(n)))
		if hex.EncodeToString(sum[:]) == ch.Challenge {
			raw, err := json.Marshal(map[string]any{
				"algorithm": ch.Algorithm, "challenge": ch.Challenge, "number": n, "salt": ch.Salt, "signature": ch.Signature,
			})
			if err != nil {
				t.Fatal(err)
			}
			return base64.StdEncoding.EncodeToString(raw)
		}
	}
	t.Fatalf("no solution within maxnumber %d", ch.MaxNumber)
	return ""
}

func mustChallenge(t *testing.T, s *captcha.Service, maxNumber int) captcha.Challenge {
	t.Helper()
	ch, err := s.NewChallenge(maxNumber)
	if err != nil {
		t.Fatalf("NewChallenge: %v", err)
	}
	return ch
}

// ── service ───────────────────────────────────────────────────────────────

func TestCaptcha_SolvedChallengeVerifiesOnceOnly(t *testing.T) {
	s := captcha.New(nil, time.Minute)
	payload := solve(t, mustChallenge(t, s, 2000))
	if err := s.Verify(payload); err != nil {
		t.Fatalf("a correct solution must verify: %v", err)
	}
	if err := s.Verify(payload); err != captcha.ErrReplayed {
		t.Fatalf("a replayed solution must be refused, got %v", err)
	}
}

func TestCaptcha_TamperedPayloadsAreRejected(t *testing.T) {
	s := captcha.New(nil, time.Minute)
	ch := mustChallenge(t, s, 2000)
	good := solve(t, ch)

	decode := func() map[string]any {
		raw, _ := base64.StdEncoding.DecodeString(good)
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		return m
	}
	encode := func(m map[string]any) string {
		raw, _ := json.Marshal(m)
		return base64.StdEncoding.EncodeToString(raw)
	}

	wrongNumber := decode()
	wrongNumber["number"] = wrongNumber["number"].(float64) + 1
	wrongSignature := decode()
	wrongSignature["signature"] = strings.Repeat("0", 64)
	wrongSalt := decode()
	wrongSalt["salt"] = "deadbeef?expires=9999999999"
	wrongAlgorithm := decode()
	wrongAlgorithm["algorithm"] = "MD5"

	for name, payload := range map[string]string{
		"wrong number":    encode(wrongNumber),
		"wrong signature": encode(wrongSignature),
		"wrong salt":      encode(wrongSalt),
		"wrong algorithm": encode(wrongAlgorithm),
		"not base64":      "%%%",
		"not json":        base64.StdEncoding.EncodeToString([]byte("nope")),
		"empty":           "",
	} {
		if err := s.Verify(payload); err == nil {
			t.Errorf("%s: tampered payload must be rejected", name)
		}
	}
	// None of the failed attempts may have burned the real solution.
	if err := s.Verify(good); err != nil {
		t.Fatalf("the genuine solution should still verify after failed forgeries: %v", err)
	}
}

func TestCaptcha_ChallengeSignedByAnotherKeyIsRejected(t *testing.T) {
	issuer := captcha.New([]byte("key-one-key-one-key-one-key-one!"), time.Minute)
	other := captcha.New([]byte("key-two-key-two-key-two-key-two!"), time.Minute)
	if err := other.Verify(solve(t, mustChallenge(t, issuer, 2000))); err == nil {
		t.Fatal("a challenge issued by another server key must not verify")
	}
}

func TestCaptcha_ExpiredChallengeIsRejected(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	s := captcha.NewWithClock(nil, time.Minute, func() time.Time { return now })
	payload := solve(t, mustChallenge(t, s, 2000))
	now = now.Add(61 * time.Second)
	if err := s.Verify(payload); err != captcha.ErrExpired {
		t.Fatalf("a solution older than the ttl must be refused as expired, got %v", err)
	}
}

func TestCaptcha_DifficultyMapsToIncreasingWork(t *testing.T) {
	low, medium, high := captcha.MaxNumberFor("low"), captcha.MaxNumberFor("medium"), captcha.MaxNumberFor("high")
	if low >= medium || medium >= high {
		t.Fatalf("difficulty must grow: low=%d medium=%d high=%d", low, medium, high)
	}
	if captcha.MaxNumberFor("bogus") != medium {
		t.Fatal("an unknown difficulty falls back to medium")
	}
}

// ── API ───────────────────────────────────────────────────────────────────

func captchaAPIServer(t *testing.T, enabled bool) (base string, svc *captcha.Service) {
	t.Helper()
	svc = captcha.New(nil, 5*time.Minute)
	srv := testServerWith(t, func(h *api.Handler) {
		h.Captcha = svc
		h.Settings = api.NewSettings(api.SettingsInit{
			RegistrationMode: "open", MaxFileSizeMB: 10, MaxVideoSizeMB: 50, MaxVideoDurationSec: 60,
			CaptchaEnabled: enabled, CaptchaDifficulty: "low",
		})
	})
	return srv.URL, svc
}

func fetchChallenge(t *testing.T, base string) captcha.Challenge {
	t.Helper()
	resp := mustDo(t, newJSONReq(t, "GET", base+"/api/captcha/challenge", "", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET challenge = %d, want 200", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("challenges must not be cached, Cache-Control = %q", cc)
	}
	var ch captcha.Challenge
	decodeJSON(t, resp, &ch)
	return ch
}

func registerCaptcha(t *testing.T, base string, n int, payload string) *http.Response {
	t.Helper()
	body := map[string]string{"username": "captcha_user_" + strconv.Itoa(n), "password": "password-123"}
	if payload != "" {
		body["captcha"] = payload
	}
	return mustDo(t, newJSONReq(t, "POST", base+"/api/register", "", jsonBody(t, body)))
}

func TestCaptchaAPI_ServerInfoAnnouncesRequirement(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		base, _ := captchaAPIServer(t, enabled)
		// On a fresh server the first account is exempt, so the requirement only shows once an owner exists.
		if r := registerCaptcha(t, base, 0, ""); r.StatusCode != http.StatusCreated {
			t.Fatalf("owner bootstrap: %d", r.StatusCode)
		}
		var info struct {
			Required bool `json:"captcha_required"`
		}
		decodeJSON(t, mustDo(t, newJSONReq(t, "GET", base+"/api/server-info", "", nil)), &info)
		if info.Required != enabled {
			t.Errorf("enabled=%v: captcha_required = %v", enabled, info.Required)
		}
	}
}

func TestCaptchaAPI_ChallengeEndpointOnlyWhenEnabled(t *testing.T) {
	base, _ := captchaAPIServer(t, true)
	ch := fetchChallenge(t, base)
	if ch.Algorithm != "SHA-256" || ch.Challenge == "" || ch.Salt == "" || ch.Signature == "" || ch.MaxNumber <= 0 {
		t.Fatalf("incomplete challenge: %+v", ch)
	}

	off, _ := captchaAPIServer(t, false)
	if r := mustDo(t, newJSONReq(t, "GET", off+"/api/captcha/challenge", "", nil)); r.StatusCode != http.StatusNotFound {
		t.Fatalf("challenge with the check disabled = %d, want 404", r.StatusCode)
	}
}

func TestCaptchaAPI_RegisterRequiresASolvedChallenge(t *testing.T) {
	base, _ := captchaAPIServer(t, true)

	// The first account bootstraps the owner and is exempt, so an operator can always set a server up.
	if r := registerCaptcha(t, base, 0, ""); r.StatusCode != http.StatusCreated {
		t.Fatalf("bootstrap sign-up without a solution: %d, want 201", r.StatusCode)
	}

	r := registerCaptcha(t, base, 1, "")
	if r.StatusCode != http.StatusBadRequest || errorKey(t, r) != "auth.errors.captcha_required" {
		t.Fatalf("missing solution should be 400 captcha_required")
	}
	r = registerCaptcha(t, base, 2, base64.StdEncoding.EncodeToString([]byte(`{"algorithm":"SHA-256"}`)))
	if r.StatusCode != http.StatusForbidden || errorKey(t, r) != "auth.errors.captcha_failed" {
		t.Fatalf("bad solution should be 403 captcha_failed, got %d", r.StatusCode)
	}

	payload := solve(t, fetchChallenge(t, base))
	if r := registerCaptcha(t, base, 3, payload); r.StatusCode != http.StatusCreated {
		t.Fatalf("valid solution: %d, want 201", r.StatusCode)
	}
	r = registerCaptcha(t, base, 4, payload)
	if r.StatusCode != http.StatusForbidden || errorKey(t, r) != "auth.errors.captcha_failed" {
		t.Fatalf("a reused solution must be refused with 403 captcha_failed, got %d", r.StatusCode)
	}
}

func TestCaptchaAPI_DisabledServerIgnoresTheField(t *testing.T) {
	base, _ := captchaAPIServer(t, false)
	for i := 0; i < 3; i++ {
		if r := registerCaptcha(t, base, i, ""); r.StatusCode != http.StatusCreated {
			t.Fatalf("sign-up %d with the check off: %d, want 201", i, r.StatusCode)
		}
	}
}

// ── admin ─────────────────────────────────────────────────────────────────

func TestCaptchaAdmin_TogglesLiveFromTheAdminPanel(t *testing.T) {
	e := newAdminEnv(t, "open")
	e.handler.Captcha = captcha.New(nil, 5*time.Minute)
	_, admin, _ := e.seedRoles(t)

	for _, key := range []string{"captcha.enabled", "captcha.difficulty"} {
		s, ok := settingsByKey(t, e, admin)[key]
		if !ok {
			t.Fatalf("%s is not exposed in the admin config", key)
		}
		if s.OwnerOnly || s.RestartRequired {
			t.Errorf("%s should be editable by an admin and apply live: %+v", key, s)
		}
	}

	if r := e.do(t, "GET", "/api/captcha/challenge", "", nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("challenge before enabling = %d, want 404", r.StatusCode)
	}
	resp := e.do(t, "PATCH", "/api/admin/config", admin, map[string]any{
		"changes": map[string]any{"captcha.enabled": true, "captcha.difficulty": "low"},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH captcha = %d", resp.StatusCode)
	}
	if r := e.do(t, "GET", "/api/captcha/challenge", "", nil); r.StatusCode != http.StatusOK {
		t.Fatalf("challenge after enabling = %d, want 200 (the toggle must apply without a restart)", r.StatusCode)
	}
	if code := e.register(t, "needs_a_solution", ""); code != http.StatusBadRequest {
		t.Fatalf("sign-up without a solution after enabling = %d, want 400", code)
	}

	bad := e.do(t, "PATCH", "/api/admin/config", admin, map[string]any{"changes": map[string]any{"captcha.difficulty": "impossible"}})
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown difficulty must be rejected with 400, got %d", bad.StatusCode)
	}
}

// errorKey returns the i18n key from an ErrorResponse body.
func errorKey(t *testing.T, r *http.Response) string {
	t.Helper()
	var e struct {
		Error string `json:"error"`
	}
	decodeJSON(t, r, &e)
	return e.Error
}
