package tests

import (
	"net/http"
	"strconv"
	"testing"

	"cove/backend/internal/api"
	"cove/backend/internal/config"
)

func demoServer(t *testing.T, demo config.DemoConfig) string {
	t.Helper()
	return testServerWith(t, func(h *api.Handler) { h.Demo = demo }).URL
}

func register(t *testing.T, base string, n int) *http.Response {
	t.Helper()
	body := map[string]string{"username": "demo_user_" + strconv.Itoa(n), "password": "password-123"}
	return mustDo(t, newJSONReq(t, "POST", base+"/api/register", "", jsonBody(t, body)))
}

func serverInfo(t *testing.T, base string) (demo bool) {
	t.Helper()
	var info struct {
		Demo bool `json:"demo"`
	}
	decodeJSON(t, mustDo(t, newJSONReq(t, "GET", base+"/api/server-info", "", nil)), &info)
	return info.Demo
}

func TestDemo_ServerInfoReportsDemoFlag(t *testing.T) {
	if serverInfo(t, demoServer(t, config.DemoConfig{})) {
		t.Fatal("demo flag must be false when demo mode is off")
	}
	if !serverInfo(t, demoServer(t, config.DemoConfig{Enabled: true})) {
		t.Fatal("demo flag must be true when demo mode is on")
	}
}

func TestDemo_OffByDefaultAllowsUnlimitedSignups(t *testing.T) {
	base := demoServer(t, config.DemoConfig{})
	for i := 0; i < 6; i++ {
		if r := register(t, base, i); r.StatusCode != http.StatusCreated {
			t.Fatalf("signup %d: status %d, want 201", i, r.StatusCode)
		}
	}
}

func TestDemo_MaxUsersCapsRegistration(t *testing.T) {
	base := demoServer(t, config.DemoConfig{Enabled: true, MaxUsers: 2, SignupsPerIPPerDay: 100})
	for i := 0; i < 2; i++ {
		if r := register(t, base, i); r.StatusCode != http.StatusCreated {
			t.Fatalf("signup %d: status %d, want 201", i, r.StatusCode)
		}
	}
	r := register(t, base, 2)
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("signup over the cap: status %d, want 403", r.StatusCode)
	}
	var e struct {
		Error string `json:"error"`
	}
	decodeJSON(t, r, &e)
	if e.Error != "auth.errors.demo_full" {
		t.Fatalf("error = %q, want auth.errors.demo_full", e.Error)
	}
}

func TestDemo_SignupsPerIPPerDay(t *testing.T) {
	// The first account on a fresh server bootstraps the owner and is exempt from the per-IP limit.
	base := demoServer(t, config.DemoConfig{Enabled: true, MaxUsers: 100, SignupsPerIPPerDay: 2})
	for i := 0; i < 3; i++ {
		if r := register(t, base, i); r.StatusCode != http.StatusCreated {
			t.Fatalf("signup %d: status %d, want 201", i, r.StatusCode)
		}
	}
	r := register(t, base, 3)
	if r.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("signup over the per-IP limit: status %d, want 429", r.StatusCode)
	}
	var e struct {
		Error string `json:"error"`
	}
	decodeJSON(t, r, &e)
	if e.Error != "auth.errors.demo_signup_limit" {
		t.Fatalf("error = %q, want auth.errors.demo_signup_limit", e.Error)
	}
}
