package tests

import (
	"net/http"
	"testing"

	"cove/backend/internal/api"
)

// Files attached to a channel are served to that channel's active members only, public channels included: a public
// channel is browsable in explore, but its messages (and so its attachments) are not readable without joining.
func TestDownloadFile_PublicChannel_MembersOnly(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	owner := registerAndLogin(t, srv, "pubfile_owner", "password123!")
	member := registerAndLogin(t, srv, "pubfile_member", "password123!")
	outsider := registerAndLogin(t, srv, "pubfile_outsider", "password123!")
	memberID := mustUserID(t, srv, member)

	body := jsonBody(t, api.CreateChannelRequest{Name: "Public files", IsPrivate: false, Members: []string{memberID}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", owner, body))
	var ch map[string]any
	decodeJSON(t, resp, &ch)
	fileID := uploadFile(t, srv, owner, ch["id"].(string), "public channel attachment")

	get := func(token string) int {
		return mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/files/"+fileID, token, nil)).StatusCode
	}
	if got := get(member); got != http.StatusOK {
		t.Errorf("member = %d, want 200", got)
	}
	if got := get(owner); got != http.StatusOK {
		t.Errorf("uploader/owner = %d, want 200", got)
	}
	if got := get(outsider); got != http.StatusForbidden {
		t.Errorf("non-member = %d, want 403", got)
	}
	if got := get(""); got != http.StatusUnauthorized {
		t.Errorf("unauthenticated = %d, want 401", got)
	}
}

// A user who was removed from a channel loses access to its files, including ones they uploaded themselves.
func TestDownloadFile_RemovedUploaderLosesAccess(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	owner := registerAndLogin(t, srv, "rmfile_owner", "password123!")
	member := registerAndLogin(t, srv, "rmfile_member", "password123!")
	memberID := mustUserID(t, srv, member)

	body := jsonBody(t, api.CreateChannelRequest{Name: "Removal", IsPrivate: false, Members: []string{memberID}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", owner, body))
	var ch map[string]any
	decodeJSON(t, resp, &ch)
	chID := ch["id"].(string)
	fileID := uploadFile(t, srv, member, chID, "my upload")

	del := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/channels/"+chID+"/members/"+memberID, owner, nil))
	if del.StatusCode >= 300 {
		t.Fatalf("remove member status = %d", del.StatusCode)
	}
	if got := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/files/"+fileID, member, nil)).StatusCode; got != http.StatusForbidden {
		t.Errorf("removed uploader = %d, want 403", got)
	}
}
