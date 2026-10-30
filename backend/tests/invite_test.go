package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"cove/backend/internal/api"
	"cove/backend/internal/store"
)

// inviteFixture is an owner with a public group plus a plain second user.
type inviteFixture struct {
	srv        *httptest.Server
	store      *store.Store
	ownerTok   string
	otherTok   string
	otherID    string
	channelID  string
	inviteLink string
}

// meID returns the signed-in user's ID.
func meID(t *testing.T, srv *httptest.Server, token string) string {
	t.Helper()
	var me map[string]any
	decodeJSON(t, mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", token, nil)), &me)
	id, _ := me["id"].(string)
	if id == "" {
		t.Fatal("me has no id")
	}
	return id
}

func newInviteFixture(t *testing.T) *inviteFixture {
	t.Helper()
	var st *store.Store
	srv := testServerWith(t, func(h *api.Handler) { st = h.Store })
	t.Cleanup(srv.Close)

	f := &inviteFixture{srv: srv, store: st}
	f.ownerTok = registerAndLogin(t, srv, "inviteowner", "password123!")
	f.otherTok = registerAndLogin(t, srv, "inviteother", "password123!")
	f.otherID = meID(t, srv, f.otherTok)

	body := jsonBody(t, api.CreateChannelRequest{Name: "Invite Club", IsPrivate: true, Members: []string{}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", f.ownerTok, body))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create channel status = %d", resp.StatusCode)
	}
	var ch map[string]any
	decodeJSON(t, resp, &ch)
	f.channelID = ch["id"].(string)
	f.inviteLink, _ = ch["invite_link"].(string)
	if f.inviteLink == "" {
		t.Fatal("owner must receive invite_link")
	}
	return f
}

// addMember adds the other user to the group as a plain member.
func (f *inviteFixture) addMember(t *testing.T) {
	t.Helper()
	body := jsonBody(t, api.AddMembersRequest{UserIDs: []string{f.otherID}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, f.srv.URL+"/api/channels/"+f.channelID+"/members", f.ownerTok, body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("add member status = %d", resp.StatusCode)
	}
}

func TestInvitePreview_NonMember(t *testing.T) {
	f := newInviteFixture(t)

	resp := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/"+f.inviteLink, f.otherTok, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("preview status = %d, want 200", resp.StatusCode)
	}
	var got api.InvitePreviewResponse
	decodeJSON(t, resp, &got)
	if got.ID != f.channelID || got.Name != "Invite Club" {
		t.Errorf("unexpected preview: %+v", got)
	}
	if !got.IsPrivate {
		t.Error("is_private should be true")
	}
	if got.MemberCount != 1 {
		t.Errorf("member_count = %d, want 1", got.MemberCount)
	}
	if got.AlreadyMember {
		t.Error("already_member should be false for a non-member")
	}
}

func TestInvitePreview_AlreadyMember(t *testing.T) {
	f := newInviteFixture(t)

	resp := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/"+f.inviteLink, f.ownerTok, nil))
	var got api.InvitePreviewResponse
	decodeJSON(t, resp, &got)
	if !got.AlreadyMember {
		t.Error("owner should be already_member")
	}
}

func TestInvitePreview_Unauthenticated(t *testing.T) {
	f := newInviteFixture(t)
	resp := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/"+f.inviteLink, "", nil))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestInvitePreview_UnknownLink(t *testing.T) {
	f := newInviteFixture(t)
	resp := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/nope", f.otherTok, nil))
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// dmInviteLink creates a DM between the two users and returns its stored invite link. The API hides
// it from DM members (they are plain members), so it is read from the store.
func dmInviteLink(t *testing.T, f *inviteFixture) string {
	t.Helper()
	body := jsonBody(t, api.CreateChannelRequest{Name: "", Members: []string{f.otherID}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, f.srv.URL+"/api/channels", f.ownerTok, body))
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create dm status = %d", resp.StatusCode)
	}
	var ch api.ChannelResponse
	decodeJSON(t, resp, &ch)
	stored, err := f.store.GetChannel(ch.ID)
	if err != nil || stored.InviteLink == "" {
		t.Fatalf("dm channel not stored with a link: %v", err)
	}
	return stored.InviteLink
}

func TestInvitePreview_DMLinkIs404(t *testing.T) {
	f := newInviteFixture(t)
	link := dmInviteLink(t, f)

	third := registerAndLogin(t, f.srv, "invitethird", "password123!")
	resp := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/"+link, third, nil))
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("preview status = %d, want 404", resp.StatusCode)
	}
	resp = mustDo(t, newJSONReq(t, http.MethodPost, f.srv.URL+"/api/join/"+link, third, nil))
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("join status = %d, want 404", resp.StatusCode)
	}
}

func TestRegenerateInvite_AdminOnlyAndOldLinkDies(t *testing.T) {
	f := newInviteFixture(t)
	f.addMember(t)
	url := f.srv.URL + "/api/channels/" + f.channelID + "/invite/regenerate"

	// Plain member: 403.
	resp := mustDo(t, newJSONReq(t, http.MethodPost, url, f.otherTok, nil))
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("member regenerate status = %d, want 403", resp.StatusCode)
	}
	// Unauthenticated: 401.
	resp = mustDo(t, newJSONReq(t, http.MethodPost, url, "", nil))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anon regenerate status = %d, want 401", resp.StatusCode)
	}

	// Owner: new link, old one dead.
	resp = mustDo(t, newJSONReq(t, http.MethodPost, url, f.ownerTok, nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("owner regenerate status = %d, want 200", resp.StatusCode)
	}
	var ch api.ChannelResponse
	decodeJSON(t, resp, &ch)
	if ch.InviteLink == "" || ch.InviteLink == f.inviteLink {
		t.Fatalf("invite link not rotated: %q", ch.InviteLink)
	}
	old := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/"+f.inviteLink, f.otherTok, nil))
	if old.StatusCode != http.StatusNotFound {
		t.Errorf("old link status = %d, want 404", old.StatusCode)
	}
	fresh := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/join/"+ch.InviteLink, f.otherTok, nil))
	if fresh.StatusCode != http.StatusOK {
		t.Errorf("new link status = %d, want 200", fresh.StatusCode)
	}
}

func TestInviteLink_HiddenFromPlainMembers(t *testing.T) {
	f := newInviteFixture(t)
	f.addMember(t)

	resp := mustDo(t, newJSONReq(t, http.MethodGet, f.srv.URL+"/api/channels/"+f.channelID, f.otherTok, nil))
	var ch api.ChannelResponse
	decodeJSON(t, resp, &ch)
	if ch.InviteLink != "" {
		t.Errorf("plain member must not see invite_link, got %q", ch.InviteLink)
	}
}

func TestJoin_KickedCannotRejoinButLeftCan(t *testing.T) {
	f := newInviteFixture(t)
	f.addMember(t)
	member := f.srv.URL + "/api/channels/" + f.channelID + "/members/" + f.otherID

	// Kicked by the owner -> join is 403 with a message.
	if r := mustDo(t, newJSONReq(t, http.MethodDelete, member, f.ownerTok, nil)); r.StatusCode != http.StatusOK {
		t.Fatalf("kick status = %d", r.StatusCode)
	}
	resp := mustDo(t, newJSONReq(t, http.MethodPost, f.srv.URL+"/api/join/"+f.inviteLink, f.otherTok, nil))
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("kicked join status = %d, want 403", resp.StatusCode)
	}
	var e api.ErrorResponse
	decodeJSON(t, resp, &e)
	if e.Error == "" {
		t.Error("expected an error message")
	}

	// An admin re-adding them clears the kick; then they leave voluntarily and may rejoin.
	f.addMember(t)
	if r := mustDo(t, newJSONReq(t, http.MethodDelete, member, f.otherTok, nil)); r.StatusCode != http.StatusOK {
		t.Fatalf("leave status = %d", r.StatusCode)
	}
	resp = mustDo(t, newJSONReq(t, http.MethodPost, f.srv.URL+"/api/join/"+f.inviteLink, f.otherTok, nil))
	if resp.StatusCode != http.StatusOK {
		t.Errorf("rejoin after leave status = %d, want 200", resp.StatusCode)
	}
}
