package tests

import (
	"encoding/json"
	"net/http"
	"testing"

	"cove/backend/internal/bots"
	"cove/backend/internal/config"
	"cove/backend/internal/models"
)

type discovered struct {
	Items []struct {
		ID           string `json:"id"`
		Username     string `json:"username"`
		Description  string `json:"description"`
		CommandCount int    `json:"command_count"`
		Public       bool   `json:"public"`
	} `json:"items"`
}

func (e *botEnv) discover(t *testing.T, token, q string) discovered {
	t.Helper()
	resp := e.do(t, "GET", "/api/bots/discover?q="+q, token, nil)
	wantStatus(t, resp, http.StatusOK)
	var d discovered
	readJSON(t, resp, &d)
	return d
}

func TestBotExplore_ListsOnlyPublicEnabledBotsWithCommandCounts(t *testing.T) {
	e := newBotEnv(t)
	pub := e.createBot(t, e.admin, "pubbot", map[string]any{"public": true, "description": "rolls dice"})
	e.createBot(t, e.admin, "privbot", nil)
	off := e.createBot(t, e.admin, "offbot", map[string]any{"public": true})
	wantStatus(t, e.do(t, "PATCH", "/api/bots/"+off.ID, e.admin, map[string]any{"disabled": true}), http.StatusOK)
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/commands", pub.Token, map[string]any{"commands": []map[string]any{
		{"name": "roll", "description": "r"}, {"name": "ping", "description": "p"}}}), http.StatusOK)

	wantStatus(t, e.do(t, "GET", "/api/bots/discover", "", nil), http.StatusUnauthorized)

	d := e.discover(t, e.member, "")
	if len(d.Items) != 1 || d.Items[0].Username != "pubbot" || d.Items[0].CommandCount != 2 || d.Items[0].Description != "rolls dice" {
		t.Fatalf("a member sees only the public enabled bot with its command count, got %+v", d.Items)
	}
	if d := e.discover(t, e.member, "dice"); len(d.Items) != 1 {
		t.Fatalf("search by description: %+v", d.Items)
	}
	if d := e.discover(t, e.member, "nomatch"); len(d.Items) != 0 {
		t.Fatalf("search miss: %+v", d.Items)
	}
	wantStatus(t, e.do(t, "GET", "/api/bots/discover?limit=0", e.member, nil), http.StatusBadRequest)
	// The owner also sees their own private bot.
	if d := e.discover(t, e.admin, ""); len(d.Items) != 2 {
		t.Fatalf("the owner sees public and own private bots: %+v", d.Items)
	}
}

func TestBotStart_OpensTheDMOnceRecordsContactAndTellsTheBot(t *testing.T) {
	e := newBotEnv(t)
	hook := newHookServer(t)
	resp := e.do(t, "POST", "/api/bots", e.admin, map[string]any{"username": "starter", "public": true, "webhook_url": hook.srv.URL})
	wantStatus(t, resp, http.StatusCreated)
	var made struct {
		Bot           struct{ ID string } `json:"bot"`
		Token         string              `json:"token"`
		WebhookSecret string              `json:"webhook_secret"`
	}
	readJSON(t, resp, &made)
	hook.secret.Store(made.WebhookSecret)
	memberID := e.userID(t, "member")

	wantStatus(t, e.do(t, "POST", "/api/bots/"+made.Bot.ID+"/start", "", nil), http.StatusUnauthorized)
	wantStatus(t, e.do(t, "POST", "/api/bots/no-such-bot/start", e.member, nil), http.StatusNotFound)

	// The bot cannot write to the person before they start it.
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/dm", made.Token, map[string]any{"user_id": memberID}), http.StatusForbidden)

	resp = e.do(t, "POST", "/api/bots/"+made.Bot.ID+"/start", e.member, nil)
	wantStatus(t, resp, http.StatusCreated)
	var s struct {
		ChannelID string `json:"channel_id"`
		Created   bool   `json:"created"`
		Delivered bool   `json:"delivered"`
	}
	readJSON(t, resp, &s)
	if s.ChannelID == "" || !s.Created || !s.Delivered {
		t.Fatalf("start = %+v", s)
	}
	ev := hook.next(t, bots.EventBotStart)
	var payload struct {
		ChannelID string                    `json:"channel_id"`
		User      struct{ Username string } `json:"user"`
	}
	_ = json.Unmarshal(ev.Payload, &payload)
	if !ev.sigOK || payload.ChannelID != s.ChannelID || payload.User.Username != "member" {
		t.Fatalf("bot_start event = %+v (sig ok %v)", payload, ev.sigOK)
	}

	// Idempotent: the same DM comes back (200) and the bot is told again.
	resp = e.do(t, "POST", "/api/bots/"+made.Bot.ID+"/start", e.member, nil)
	wantStatus(t, resp, http.StatusOK)
	var again struct {
		ChannelID string `json:"channel_id"`
		Created   bool   `json:"created"`
	}
	readJSON(t, resp, &again)
	if again.ChannelID != s.ChannelID || again.Created {
		t.Fatalf("second start = %+v, want the same DM", again)
	}

	// Contact exists now: the bot may write in the DM.
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/channels/"+s.ChannelID+"/messages", made.Token, map[string]any{"text": "Welcome!"}), http.StatusCreated)
	chans, _ := e.store.ListUserChannels(memberID)
	dms := 0
	for _, c := range chans {
		if c.Name == "" {
			dms++
		}
	}
	if dms != 1 {
		t.Fatalf("exactly one DM should exist, got %d", dms)
	}
}

func TestBotStart_RefusesPrivateDisabledAndSwitchedOffBots(t *testing.T) {
	e := newBotEnv(t)
	priv := e.createBot(t, e.admin, "secretbot", nil)
	off := e.createBot(t, e.admin, "sleepbot", map[string]any{"public": true})
	wantStatus(t, e.do(t, "PATCH", "/api/bots/"+off.ID, e.admin, map[string]any{"disabled": true}), http.StatusOK)

	wantStatus(t, e.do(t, "POST", "/api/bots/"+priv.ID+"/start", e.member, nil), http.StatusNotFound)
	wantStatus(t, e.do(t, "POST", "/api/bots/"+off.ID+"/start", e.member, nil), http.StatusNotFound)
	// A private bot can be started by its owner.
	wantStatus(t, e.do(t, "POST", "/api/bots/"+priv.ID+"/start", e.admin, nil), http.StatusCreated)

	pub := e.createBot(t, e.admin, "openbot", map[string]any{"public": true})
	e.setBots(func(c *config.BotsConfig) { c.Enabled = false })
	wantStatus(t, e.do(t, "POST", "/api/bots/"+pub.ID+"/start", e.member, nil), http.StatusForbidden)
	e.setBots(func(c *config.BotsConfig) { c.Enabled = true })

	// A person who blocked the bot cannot start it (and the bot cannot reach them).
	wantStatus(t, e.do(t, "PUT", "/api/users/"+pub.ID+"/relationship", e.member, map[string]any{"action": "block"}), http.StatusOK)
	wantStatus(t, e.do(t, "POST", "/api/bots/"+pub.ID+"/start", e.member, nil), http.StatusForbidden)
	_ = models.UserKindBot
}
