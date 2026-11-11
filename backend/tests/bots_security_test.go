package tests

import (
	"net/http"
	"testing"

	"cove/backend/internal/middleware"
	"cove/backend/internal/models"
)

// Bot API review, November 2026 (docs/security-review-2026-11.md, section "Bot API").

// SR-B1: a bot cannot take the name of the Cove system account or of a person (case-insensitively), so it cannot
// pass for either in a member list or a notification.
func TestBotSecurity_NamesCannotImpersonate(t *testing.T) {
	e := newBotEnv(t)
	if _, err := e.store.CreateUser("Helper", "password123!", "localhost"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"cove", "helper"} {
		resp := e.do(t, "POST", "/api/bots", e.admin, map[string]any{"username": name})
		if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusConflict {
			t.Errorf("bot named %q = %d, want 400 or 409", name, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

// SR-B2: deleting a channel takes the bot installs, keyboards and channel commands with it, so a bot's gateway hello
// no longer lists channels that do not exist.
func TestBotSecurity_DeletingAChannelDropsItsInstalls(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "doomed")
	bot := e.createBot(t, e.admin, "leftover", nil)
	e.install(t, ch, bot.ID, models.ScopeMessagesSend)
	resp := e.do(t, "DELETE", "/api/channels/"+ch, e.owner, nil)
	wantStatus(t, resp, http.StatusOK)
	installs, err := e.store.ListBotInstalls(bot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(installs) != 0 {
		t.Fatalf("bot still has %d install(s) in a deleted channel", len(installs))
	}
}

// SR-B3: an interaction token travels in the callback URL path, so the access log must not print it.
func TestBotSecurity_InteractionTokenIsNotLogged(t *testing.T) {
	got := middleware.LogPath("/api/interactions/0b1c/SECRET-token_value/callback")
	if got != "/api/interactions/0b1c/***/callback" {
		t.Fatalf("LogPath = %q, token not redacted", got)
	}
	if middleware.LogPath("/api/channels/abc/messages") != "/api/channels/abc/messages" {
		t.Fatal("ordinary paths must be logged as they are")
	}
}

// A person cannot send a rich `bot` message over the socket: the type is reserved for the REST path that validates
// buttons and links, so a person cannot pass off a crafted button grid as a bot's.
func TestBotSecurity_PeopleCannotSendBotMessages(t *testing.T) {
	e := newBotEnv(t)
	wsURL := e.withHub(t)
	ch := e.channel(t, "room")
	user := dialUser(t, wsURL, e.member)
	payload := e.sealed(t, ch, `{"v":1,"text":"x","buttons":[[{"label":"Open","url":"https://example.com"}]]}`)
	payload["type"] = "bot"
	userSend(t, user, "message", payload)
	// A text message after it proves the first one was processed (frames of one socket are handled in order).
	userSend(t, user, "message", e.sealed(t, ch, "marker"))
	userRead(t, user, "message")
	msgs, err := e.store.ListMessages(ch, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range msgs {
		if m.Type == models.MessageTypeBot {
			t.Fatal("a person managed to store a bot message")
		}
	}
}
