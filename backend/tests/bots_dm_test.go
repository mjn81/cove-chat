package tests

import (
	"net/http"
	"testing"
)

func (e *botEnv) listedDMs(t *testing.T, token string) []string {
	t.Helper()
	resp := e.do(t, "GET", "/api/channels?limit=100", token, nil)
	wantStatus(t, resp, http.StatusOK)
	var page struct {
		Items []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"items"`
	}
	readJSON(t, resp, &page)
	var ids []string
	for _, c := range page.Items {
		if c.Name == "" {
			ids = append(ids, c.ID)
		}
	}
	return ids
}

func (e *botEnv) messageCount(t *testing.T, channel, token string) int {
	t.Helper()
	resp := e.do(t, "GET", "/api/channels/"+channel+"/messages", token, nil)
	wantStatus(t, resp, http.StatusOK)
	var page struct {
		Items []struct{ ID string } `json:"items"`
	}
	readJSON(t, resp, &page)
	return len(page.Items)
}

func TestBotDM_ClearHistoryRemoveAndStartAgain(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "chatbot", map[string]any{"public": true})

	resp := e.do(t, "POST", "/api/bots/"+b.ID+"/start", e.member, nil)
	wantStatus(t, resp, http.StatusCreated)
	var s struct {
		ChannelID string `json:"channel_id"`
	}
	readJSON(t, resp, &s)
	dm := s.ChannelID
	post := func(text string) {
		wantStatus(t, e.asBot(t, "POST", "/api/bots/me/channels/"+dm+"/messages", b.Token, map[string]any{"text": text}), http.StatusCreated)
	}
	post("one")
	post("two")
	if n := e.messageCount(t, dm, e.member); n != 2 {
		t.Fatalf("messages = %d, want 2", n)
	}

	// Access control: anonymous 401, a bot token never clears anything, a non-member sees 404, groups are refused.
	wantStatus(t, e.do(t, "POST", "/api/channels/"+dm+"/clear", "", nil), http.StatusUnauthorized)
	wantStatus(t, e.asBot(t, "POST", "/api/channels/"+dm+"/clear", b.Token, nil), http.StatusUnauthorized)
	wantStatus(t, e.do(t, "POST", "/api/channels/"+dm+"/clear", e.owner, nil), http.StatusNotFound)
	wantStatus(t, e.do(t, "POST", "/api/channels/no-such/clear", e.member, nil), http.StatusNotFound)
	group := e.channel(t, "room")
	wantStatus(t, e.do(t, "POST", "/api/channels/"+group+"/clear", e.member, nil), http.StatusBadRequest)
	if n := e.messageCount(t, dm, e.member); n != 2 {
		t.Fatalf("a refused request must not clear anything, got %d", n)
	}

	// Clear: only the caller's side is emptied, the conversation stays listed, new messages show.
	wantStatus(t, e.do(t, "POST", "/api/channels/"+dm+"/clear", e.member, nil), http.StatusOK)
	if n := e.messageCount(t, dm, e.member); n != 0 {
		t.Fatalf("after clear = %d, want 0", n)
	}
	if ids := e.listedDMs(t, e.member); len(ids) != 1 || ids[0] != dm {
		t.Fatalf("a cleared DM stays in the list, got %v", ids)
	}
	if hist := e.asBot(t, "GET", "/api/bots/me/channels/"+dm+"/messages", b.Token, nil); hist.StatusCode != http.StatusOK {
		t.Fatalf("the bot keeps its own view: %d", hist.StatusCode)
	}
	post("three")
	if n := e.messageCount(t, dm, e.member); n != 1 {
		t.Fatalf("new messages appear after a clear, got %d", n)
	}

	// Remove (existing delete-for-me): leaves the list; Start brings the SAME conversation back.
	wantStatus(t, e.do(t, "DELETE", "/api/channels/"+dm, e.member, nil), http.StatusOK)
	if ids := e.listedDMs(t, e.member); len(ids) != 0 {
		t.Fatalf("a removed DM leaves the list, got %v", ids)
	}
	resp = e.do(t, "POST", "/api/bots/"+b.ID+"/start", e.member, nil)
	wantStatus(t, resp, http.StatusOK)
	var again struct {
		ChannelID string `json:"channel_id"`
		Created   bool   `json:"created"`
	}
	readJSON(t, resp, &again)
	if again.ChannelID != dm || again.Created {
		t.Fatalf("start after remove = %+v, want the same DM %s", again, dm)
	}
	if ids := e.listedDMs(t, e.member); len(ids) != 1 || ids[0] != dm {
		t.Fatalf("the DM is back in the list, got %v", ids)
	}
	if n := e.messageCount(t, dm, e.member); n != 0 {
		t.Fatalf("old messages stay hidden after remove and start, got %d", n)
	}
}
