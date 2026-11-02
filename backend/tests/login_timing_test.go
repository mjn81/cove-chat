package tests

import (
	"net/http"
	"sort"
	"testing"
	"time"
)

// An unknown username must cost as much as a wrong password (a dummy Argon2id verify), otherwise response time
// tells an attacker which usernames exist.
func TestLogin_UnknownUserCostsAsMuchAsWrongPassword(t *testing.T) {
	srv := testServer(t)
	registerAndLogin(t, srv, "timing_user", "password123!")

	measure := func(user string) time.Duration {
		var ds []time.Duration
		for i := 0; i < 5; i++ {
			start := time.Now()
			resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/login", "", jsonBody(t, map[string]string{"username": user, "password": "wrong-password"})))
			resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("login %s = %d, want 401", user, resp.StatusCode)
			}
			ds = append(ds, time.Since(start))
		}
		sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
		return ds[len(ds)/2]
	}
	known, unknown := measure("timing_user"), measure("no_such_user_zz")
	if unknown < known/2 {
		t.Fatalf("unknown user answered in %v vs %v for a wrong password: usernames can be enumerated by timing", unknown, known)
	}
}
