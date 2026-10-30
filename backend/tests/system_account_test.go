package tests

import (
	"crypto/aes"
	"crypto/cipher"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cove/backend/internal/api"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// noticeServer is a test server with login notices on and a configured domain. The returned store lets tests read
// what the Cove account wrote.
func noticeServer(t *testing.T, domain string) (*httptest.Server, *store.Store, []byte) {
	t.Helper()
	var st *store.Store
	var kek []byte
	srv := testServerWith(t, func(h *api.Handler) {
		h.LoginNotifications = true
		h.ServerDomain = domain
		st, kek = h.Store, h.KEK
	})
	return srv, st, kek
}

// coveMessages decrypts every message the Cove account sent to userID, oldest first.
func coveMessages(t *testing.T, st *store.Store, kek []byte, userID string) []string {
	t.Helper()
	chans, err := st.ListUserChannels(userID)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, ch := range chans {
		members, _ := st.GetChannelMembers(ch.ID)
		isCove := false
		for _, m := range members {
			if m.UserID == models.SystemUserID {
				isCove = true
			}
		}
		if !isCove {
			continue
		}
		key, err := st.DecryptChannelKey(ch, kek)
		if err != nil {
			t.Fatal(err)
		}
		msgs, _ := st.ListMessages(ch.ID, "", 50)
		for i := len(msgs) - 1; i >= 0; i-- {
			block, _ := aes.NewCipher(key)
			gcm, _ := cipher.NewGCM(block)
			pt, err := gcm.Open(nil, msgs[i].Nonce, msgs[i].Ciphertext, nil)
			if err != nil {
				t.Fatalf("message is not decryptable the way the client decrypts it: %v", err)
			}
			if msgs[i].SenderID != models.SystemUserID {
				t.Fatalf("sender = %s, want the Cove account", msgs[i].SenderID)
			}
			out = append(out, string(pt))
		}
	}
	return out
}

func userIDOf(t *testing.T, srv *httptest.Server, token string) string {
	t.Helper()
	return getUser(t, srv, token).ID
}

func TestLoginNotice_FirstLoginIsSilentNewDeviceNotifies(t *testing.T) {
	srv, st, kek := noticeServer(t, "chat.example.com")
	defer srv.Close()

	first := registerAndLogin(t, srv, "noticeuser", "Password123!")
	uid := userIDOf(t, srv, first)
	if got := coveMessages(t, st, kek, uid); len(got) != 0 {
		t.Fatalf("first-ever login must not notify, got %v", got)
	}

	loginAs(t, srv, "noticeuser", "Password123!", map[string]string{
		"X-Cove-Device": "Cove Desktop on Windows 10",
		"X-Cove-App":    "Cove Desktop 0.9.0",
	})
	got := coveMessages(t, st, kek, uid)
	if len(got) != 1 {
		t.Fatalf("messages = %v, want exactly one login notice", got)
	}
	for _, want := range []string{"Cove Desktop on Windows 10", "Settings"} {
		if !strings.Contains(got[0], want) {
			t.Errorf("notice %q is missing %q", got[0], want)
		}
	}

	loginAs(t, srv, "noticeuser", "Password123!", map[string]string{
		"X-Cove-Device": "Cove Desktop on Windows 10",
		"X-Cove-App":    "Cove Desktop 0.9.0",
	})
	if again := coveMessages(t, st, kek, uid); len(again) != 1 {
		t.Fatalf("a known device must not notify again, got %d messages", len(again))
	}
}

func TestLoginNotice_OffByDefault(t *testing.T) {
	var st *store.Store
	srv := testServerWith(t, func(h *api.Handler) { st = h.Store })
	defer srv.Close()

	tok := registerAndLogin(t, srv, "quietuser", "Password123!")
	loginAs(t, srv, "quietuser", "Password123!", map[string]string{"X-Cove-Device": "Other"})
	chans, _ := st.ListUserChannels(userIDOf(t, srv, tok))
	if len(chans) != 0 {
		t.Fatalf("no system DM expected when notifications are disabled, got %d channels", len(chans))
	}
}

func TestCoveAccount_ReservedNameAndHiddenFromSearch(t *testing.T) {
	srv, _, _ := noticeServer(t, "localhost")
	defer srv.Close()

	for _, name := range []string{"cove", "Cove", "COVE"} {
		resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/register", "",
			jsonBody(t, api.RegisterRequest{Username: name, Password: "Password123!"})))
		if resp.StatusCode < 400 {
			t.Errorf("registering %q must be rejected, got %d", name, resp.StatusCode)
		}
	}

	tok := registerAndLogin(t, srv, "searcher", "Password123!")
	loginAs(t, srv, "searcher", "Password123!", map[string]string{"X-Cove-Device": "Second"}) // creates the Cove account

	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/users?q=cove", tok, nil))
	var found []api.UserResponse
	decodeJSON(t, resp, &found)
	for _, u := range found {
		if strings.EqualFold(u.Username, "cove") {
			t.Fatalf("the system account must not be searchable: %+v", found)
		}
	}

	// A user may not rename themselves to the reserved name either.
	patch := mustDo(t, newJSONReq(t, http.MethodPatch, srv.URL+"/api/users/me", tok,
		jsonBody(t, map[string]string{"username": "Cove"})))
	if patch.StatusCode < 400 {
		t.Errorf("renaming to the reserved name must be rejected, got %d", patch.StatusCode)
	}
}

func TestCoveAccount_UsersCannotMessageOrFriendIt(t *testing.T) {
	srv, st, _ := noticeServer(t, "localhost")
	defer srv.Close()

	tok := registerAndLogin(t, srv, "replier", "Password123!")
	uid := userIDOf(t, srv, tok)
	loginAs(t, srv, "replier", "Password123!", map[string]string{"X-Cove-Device": "Second"})

	if ok, _ := st.CanSendDM(uid, models.SystemUserID); ok {
		t.Error("users must not be able to send direct messages to the Cove account")
	}
	if err := st.SendFriendRequest(uid, models.SystemUserID); err == nil {
		t.Error("friend requests to the Cove account must be rejected")
	}
}

func TestCoveAccount_ChannelShowsServerLabelAndBrandAvatar(t *testing.T) {
	srv, _, _ := noticeServer(t, "https://Chat.Example.com/")
	defer srv.Close()

	tok := registerAndLogin(t, srv, "labeluser", "Password123!")
	loginAs(t, srv, "labeluser", "Password123!", map[string]string{"X-Cove-Device": "Second"})

	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tok, nil))
	var chans []api.ChannelResponse
	decodeJSON(t, resp, &chans)
	if len(chans) != 1 {
		t.Fatalf("channels = %d, want the Cove DM", len(chans))
	}
	ch := chans[0]
	if got := ch.MemberNames[models.SystemUserID]; got != "Cove · chat.example.com" {
		t.Errorf("display name = %q", got)
	}
	if got := ch.MemberAvatars[models.SystemUserID]; got != models.SystemAvatarID {
		t.Errorf("avatar = %q, want the brand sentinel", got)
	}
	if !ch.MemberSystem[models.SystemUserID] {
		t.Error("channel must flag the Cove member as a system account")
	}
}

func TestFormatServerLabel(t *testing.T) {
	cases := map[string]string{
		"chat.example.com":             "chat.example.com",
		"https://Chat.Example.com/":    "chat.example.com",
		"http://chat.example.com":      "chat.example.com",
		"chat.example.com:8443":        "chat.example.com:8443",
		"https://chat.example.com:443": "chat.example.com",
		"http://chat.example.com:80":   "chat.example.com",
		"localhost":                    "localhost",
		"  ":                           "localhost",
		"":                             "localhost",
		"[::1]:4000":                   "[::1]:4000",
	}
	for in, want := range cases {
		if got := api.FormatServerLabel(in); got != want {
			t.Errorf("FormatServerLabel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOwnerNotice_AccessControlAndValidation(t *testing.T) {
	srv, _, _ := noticeServer(t, "localhost")
	defer srv.Close()

	owner := registerAndLogin(t, srv, "theowner", "Password123!") // first account claims ownership
	member := registerAndLogin(t, srv, "justamember", "Password123!")

	post := func(tok string, body any) *http.Response {
		return mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/admin/notices", tok, jsonBody(t, body)))
	}
	if r := post("", map[string]string{"text": "hi"}); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauthenticated = %d, want 401", r.StatusCode)
	}
	if r := post(member, map[string]string{"text": "hi"}); r.StatusCode != http.StatusForbidden {
		t.Errorf("member = %d, want 403", r.StatusCode)
	}
	if r := post(owner, map[string]string{"text": "   "}); r.StatusCode != http.StatusBadRequest {
		t.Errorf("blank text = %d, want 400", r.StatusCode)
	}
	if r := post(owner, map[string]string{"text": strings.Repeat("x", 2001)}); r.StatusCode != http.StatusBadRequest {
		t.Errorf("too long = %d, want 400", r.StatusCode)
	}
}

func TestOwnerNotice_DeliveredToEveryUserOnce(t *testing.T) {
	srv, st, kek := noticeServer(t, "localhost")
	defer srv.Close()

	owner := registerAndLogin(t, srv, "boss", "Password123!")
	a := registerAndLogin(t, srv, "usera", "Password123!")
	b := registerAndLogin(t, srv, "userb", "Password123!")

	resp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/admin/notices", owner,
		jsonBody(t, map[string]string{"text": "Maintenance tonight at 22:00 UTC"})))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out api.NoticeResponse
	decodeJSON(t, resp, &out)
	if out.Recipients != 3 || out.Failed != 0 {
		t.Fatalf("recipients = %d failed = %d, want 3/0 (the Cove account itself is not a recipient)", out.Recipients, out.Failed)
	}
	for _, tok := range []string{owner, a, b} {
		got := coveMessages(t, st, kek, userIDOf(t, srv, tok))
		if len(got) != 1 || got[0] != "Maintenance tonight at 22:00 UTC" {
			t.Errorf("user got %v, want the notice exactly once", got)
		}
	}

	entries, _ := st.ListAudit(10)
	found := false
	for _, e := range entries {
		if e.Action == "notice.send" {
			found = true
		}
	}
	if !found {
		t.Error("sending a server notice must be written to the audit log")
	}
}
