package tests

import (
	"net/http"
	"testing"

	"cove/backend/internal/api"
)

func TestDeleteAccount_RequiresCurrentPassword(t *testing.T) {
	srv := testServer(t)
	registerAndLogin(t, srv, "del_founder", "password123!") // first account is the owner
	tok := registerAndLogin(t, srv, "del_victim", "password123!")

	del := func(token string, body *api.DeleteAccountRequest) *http.Response {
		var req *http.Request
		if body == nil {
			req = newJSONReq(t, http.MethodDelete, srv.URL+"/api/users/me", token, nil)
		} else {
			req = newJSONReq(t, http.MethodDelete, srv.URL+"/api/users/me", token, jsonBody(t, body))
		}
		return mustDo(t, req)
	}

	if r := del("", &api.DeleteAccountRequest{Password: "password123!"}); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", r.StatusCode)
	}
	if r := del(tok, nil); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("no body = %d, want 400", r.StatusCode)
	}
	r := del(tok, &api.DeleteAccountRequest{})
	if r.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty password = %d, want 400", r.StatusCode)
	}
	if _, code := errEnvelope(t, r); code != "validation_failed" {
		t.Fatalf("empty password code = %q", code)
	}
	r = del(tok, &api.DeleteAccountRequest{Password: "not-my-password"})
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong password = %d, want 403", r.StatusCode)
	}
	if _, code := errEnvelope(t, r); code != "forbidden" {
		t.Fatalf("wrong password code = %q", code)
	}
	if me := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tok, nil)); me.StatusCode != http.StatusOK {
		t.Fatalf("account must survive a rejected delete, /me = %d", me.StatusCode)
	}

	if r := del(tok, &api.DeleteAccountRequest{Password: "password123!"}); r.StatusCode != http.StatusOK {
		t.Fatalf("correct password = %d, want 200", r.StatusCode)
	}
	if me := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tok, nil)); me.StatusCode != http.StatusUnauthorized {
		t.Fatalf("/me after delete = %d, want 401", me.StatusCode)
	}
}

func TestDeleteAccount_WrongPasswordLocksOut(t *testing.T) {
	e := newAdminEnv(t, "open")
	_, _, member := e.seedRoles(t)
	for i := 0; i < 5; i++ {
		e.do(t, "DELETE", "/api/users/me", member, map[string]string{"password": "nope"}).Body.Close()
	}
	r := e.do(t, "DELETE", "/api/users/me", member, map[string]string{"password": testPassword})
	if r.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("after repeated wrong passwords = %d, want 429 (step-up lockout)", r.StatusCode)
	}
}
