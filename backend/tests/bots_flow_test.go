package tests

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/bots"
	"cove/backend/internal/config"
	"cove/backend/internal/models"

	"github.com/coder/websocket"
)

// ---- messages --------------------------------------------------------------------------------------------------- //

func TestBotMessages_ScopesAndAccess(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	other := e.channel(t, "elsewhere")
	b := e.createBot(t, e.admin, "talker", nil)
	e.install(t, ch, b.ID, models.ScopeMessagesSend)
	base := "/api/bots/me/channels/" + ch

	// Allowed with messages.send.
	resp := e.asBot(t, "POST", base+"/messages", b.Token, map[string]any{"text": "hello"})
	wantStatus(t, resp, http.StatusCreated)
	// Missing scopes are 403, not 404 (the bot is installed, it just was not granted these).
	wantStatus(t, e.asBot(t, "GET", base+"/messages", b.Token, nil), http.StatusForbidden)
	wantStatus(t, e.asBot(t, "GET", base+"/members", b.Token, nil), http.StatusForbidden)
	// A channel the bot is not in answers 404 for every route, so ids cannot be probed.
	for _, rt := range []struct{ method, path string }{
		{"POST", "/api/bots/me/channels/" + other + "/messages"},
		{"GET", "/api/bots/me/channels/" + other + "/messages"},
		{"GET", "/api/bots/me/channels/" + other + "/members"},
		{"PUT", "/api/bots/me/channels/" + other + "/keyboard"},
		{"PUT", "/api/bots/me/channels/" + other + "/commands"},
		{"POST", "/api/bots/me/channels/no-such/messages"},
	} {
		resp := e.asBot(t, rt.method, rt.path, b.Token, map[string]any{"text": "x"})
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s: %d, want 404", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
	// Upgrading the install unlocks the rest.
	e.install(t, ch, b.ID, models.ScopeMessagesSend, models.ScopeMessagesRead, models.ScopeMembersRead)
	wantStatus(t, e.asBot(t, "GET", base+"/messages", b.Token, nil), http.StatusOK)
	wantStatus(t, e.asBot(t, "GET", base+"/members", b.Token, nil), http.StatusOK)
}

func TestBotMessages_SendEncryptsAndHistoryDecrypts(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "talker", nil)
	e.install(t, ch, b.ID, models.ScopeMessagesSend, models.ScopeMessagesRead)
	base := "/api/bots/me/channels/" + ch + "/messages"

	resp := e.asBot(t, "POST", base, b.Token, map[string]any{"text": "plain hello"})
	wantStatus(t, resp, http.StatusCreated)
	var plain struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &plain)
	resp = e.asBot(t, "POST", base, b.Token, map[string]any{"text": "pick one", "buttons": [][]map[string]any{{{"label": "Yes", "custom_id": "yes", "style": "primary"}, {"label": "Docs", "url": "https://example.com"}}}})
	wantStatus(t, resp, http.StatusCreated)
	var rich struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &rich)

	// What is stored is ciphertext (server-trusted: the server can open it with the channel key, nothing else can).
	m1, err := e.store.GetMessage(ch, plain.ID)
	if err != nil || m1.Type != models.MessageTypeText || strings.Contains(string(m1.Ciphertext), "plain hello") || m1.SenderID != b.ID {
		t.Fatalf("stored plain message wrong: %+v %v", m1, err)
	}
	m2, _ := e.store.GetMessage(ch, rich.ID)
	if m2.Type != models.MessageTypeBot {
		t.Fatalf("a message with buttons must be type bot, got %q", m2.Type)
	}
	body, ok := bots.Open(e.store, e.handler.KEK, m2)
	var parsed models.BotMessageBody
	if !ok || json.Unmarshal([]byte(body), &parsed) != nil || parsed.V != 1 || parsed.Text != "pick one" || len(parsed.Buttons[0]) != 2 || parsed.Buttons[0][0].Style != "primary" {
		t.Fatalf("rich body wrong: %q %+v", body, parsed)
	}

	// History: newest first, decrypted, with the author marked as a bot.
	resp = e.asBot(t, "GET", base+"?limit=1", b.Token, nil)
	var page struct {
		Items []struct {
			ID      string `json:"id"`
			Type    string `json:"type"`
			Content string `json:"content"`
			Author  struct {
				IsBot bool `json:"is_bot"`
			} `json:"author"`
		} `json:"items"`
		NextCursor string `json:"next_cursor"`
	}
	readJSON(t, resp, &page)
	if len(page.Items) != 1 || page.Items[0].ID != rich.ID || page.Items[0].Content != "pick one" || !page.Items[0].Author.IsBot || page.NextCursor == "" {
		t.Fatalf("history page 1 = %+v", page)
	}
	resp = e.asBot(t, "GET", base+"?limit=1&cursor="+page.NextCursor, b.Token, nil)
	readJSON(t, resp, &page)
	if len(page.Items) != 1 || page.Items[0].Content != "plain hello" {
		t.Fatalf("history page 2 = %+v", page)
	}
	wantStatus(t, e.asBot(t, "GET", base+"?limit=500", b.Token, nil), http.StatusBadRequest)
	wantStatus(t, e.asBot(t, "GET", base+"?cursor=garbage", b.Token, nil), http.StatusBadRequest)
}

func TestBotMessages_Validation(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "talker", nil)
	e.install(t, ch, b.ID)
	base := "/api/bots/me/channels/" + ch + "/messages"
	cases := map[string]map[string]any{
		"empty":           {},
		"blank":           {"text": "   "},
		"too long":        {"text": strings.Repeat("a", 4001)},
		"js url button":   {"text": "x", "buttons": [][]map[string]any{{{"label": "a", "url": "javascript:alert(1)"}}}},
		"both id and url": {"text": "x", "buttons": [][]map[string]any{{{"label": "a", "custom_id": "a", "url": "https://e.com"}}}},
		"reply unknown":   {"text": "x", "reply_to_id": "nope"},
	}
	for name, body := range cases {
		resp := e.asBot(t, "POST", base, b.Token, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, resp.StatusCode)
		}
		resp.Body.Close()
	}
	// Oversized JSON body.
	resp := e.asBot(t, "POST", base, b.Token, map[string]any{"text": strings.Repeat("a", 2<<20)})
	wantStatus(t, resp, http.StatusRequestEntityTooLarge)
}

func TestBotMessages_PerChannelRateLimit(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "spammer", nil)
	e.install(t, ch, b.ID)
	base := "/api/bots/me/channels/" + ch + "/messages"
	limited := 0
	for i := 0; i < 12; i++ {
		resp := e.asBot(t, "POST", base, b.Token, map[string]any{"text": "spam"})
		if resp.StatusCode == http.StatusTooManyRequests {
			limited++
		}
		resp.Body.Close()
	}
	if limited == 0 {
		t.Fatal("a burst of messages into one channel must hit the per-channel limit")
	}
}

func TestBotMessages_EditAndDeleteOnlyOwn(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "editor", nil)
	e.install(t, ch, b.ID)
	base := "/api/bots/me/channels/" + ch + "/messages"

	resp := e.asBot(t, "POST", base, b.Token, map[string]any{"text": "v1", "buttons": [][]map[string]any{{{"label": "a", "custom_id": "a"}}}})
	var mine struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &mine)

	// Edit: buttons off turns it back into plain text and marks it edited.
	resp = e.asBot(t, "PATCH", base+"/"+mine.ID, b.Token, map[string]any{"text": "v2"})
	wantStatus(t, resp, http.StatusOK)
	m, _ := e.store.GetMessage(ch, mine.ID)
	if m.Type != models.MessageTypeText || m.EditedAt == nil {
		t.Fatalf("edit did not apply: %+v", m)
	}
	if got, _ := bots.Open(e.store, e.handler.KEK, m); got != "v2" {
		t.Fatalf("edited content = %q", got)
	}
	wantStatus(t, e.asBot(t, "PATCH", base+"/"+mine.ID, b.Token, map[string]any{"text": ""}), http.StatusBadRequest)

	// Someone else's message: 403 for edit and delete, and it is untouched.
	theirs := e.userMessage(t, ch, e.userID(t, "member"), "not yours")
	wantStatus(t, e.asBot(t, "PATCH", base+"/"+theirs.ID, b.Token, map[string]any{"text": "hijack"}), http.StatusForbidden)
	wantStatus(t, e.asBot(t, "DELETE", base+"/"+theirs.ID, b.Token, nil), http.StatusForbidden)
	if got, _ := e.store.GetMessage(ch, theirs.ID); got == nil {
		t.Fatal("the person's message must survive")
	}
	wantStatus(t, e.asBot(t, "PATCH", base+"/nope", b.Token, map[string]any{"text": "x"}), http.StatusNotFound)
	wantStatus(t, e.asBot(t, "DELETE", base+"/nope", b.Token, nil), http.StatusNotFound)

	wantStatus(t, e.asBot(t, "DELETE", base+"/"+mine.ID, b.Token, nil), http.StatusOK)
	if _, err := e.store.GetMessage(ch, mine.ID); err == nil {
		t.Fatal("own message should be deleted")
	}
}

func TestBotMembers_OnlyIdentity(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "census", nil)
	e.install(t, ch, b.ID, models.ScopeMembersRead)
	resp := e.asBot(t, "GET", "/api/bots/me/channels/"+ch+"/members", b.Token, nil)
	wantStatus(t, resp, http.StatusOK)
	var raw struct {
		Items []map[string]any `json:"items"`
	}
	readJSON(t, resp, &raw)
	if len(raw.Items) != 4 { // owner, admin, member, the bot
		t.Fatalf("members = %d", len(raw.Items))
	}
	for _, m := range raw.Items {
		for k := range m {
			if k != "id" && k != "username" && k != "is_bot" {
				t.Errorf("a bot must only see id, username and is_bot, got field %q", k)
			}
		}
	}
}

// ---- commands --------------------------------------------------------------------------------------------------- //

func TestBotCommands_RegisterListAndAutocomplete(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	other := e.channel(t, "other")
	b := e.createBot(t, e.admin, "cmdbot", nil)
	e.install(t, ch, b.ID)
	e.install(t, other, b.ID)

	good := map[string]any{"commands": []map[string]any{
		{"name": "roll", "description": "Roll dice", "options": []map[string]any{{"name": "sides", "description": "n", "type": "integer", "required": true, "choices": []map[string]any{{"name": "d6", "value": "6"}}}}},
		{"name": "ping", "description": "Ping"},
	}}
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/commands", b.Token, good), http.StatusOK)
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/commands", b.Token, map[string]any{"commands": []map[string]any{{"name": "BAD NAME", "description": "x"}}}), http.StatusBadRequest)
	resp := e.asBot(t, "PUT", "/api/bots/me/commands", b.Token, map[string]any{"commands": []map[string]any{{"name": "a", "description": "x"}, {"name": "a", "description": "y"}}})
	wantCode(t, resp, http.StatusBadRequest, apistd.CodeCommandInvalid)

	// A channel command overrides the global one of the same name, only there.
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/channels/"+ch+"/commands", b.Token, map[string]any{"commands": []map[string]any{{"name": "ping", "description": "Local ping"}}}), http.StatusOK)

	list := func(channel, token string) []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		BotUsername string `json:"bot_username"`
	} {
		resp := e.do(t, "GET", "/api/channels/"+channel+"/commands", token, nil)
		wantStatus(t, resp, http.StatusOK)
		var out struct {
			Items []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				BotUsername string `json:"bot_username"`
			} `json:"items"`
		}
		readJSON(t, resp, &out)
		return out.Items
	}
	items := list(ch, e.member)
	if len(items) != 2 || items[0].Name != "ping" || items[0].Description != "Local ping" || items[1].Name != "roll" || items[0].BotUsername != "cmdbot" {
		t.Fatalf("commands in room = %+v", items)
	}
	if items := list(other, e.member); items[0].Description != "Ping" {
		t.Fatalf("other channel must see the global ping, got %+v", items)
	}
	wantStatus(t, e.do(t, "GET", "/api/channels/"+ch+"/commands", "", nil), http.StatusUnauthorized)
	// A non-member sees nothing of the channel (404).
	if _, err := e.store.CreateUser("outsider", testPassword, "chat.test"); err != nil {
		t.Fatal(err)
	}
	wantStatus(t, e.do(t, "GET", "/api/channels/"+ch+"/commands", e.login(t, "outsider"), nil), http.StatusNotFound)

	wantStatus(t, e.asBot(t, "DELETE", "/api/bots/me/commands/roll", b.Token, nil), http.StatusOK)
	if items := list(other, e.member); len(items) != 1 {
		t.Fatalf("after delete: %+v", items)
	}
	// A disabled bot's commands disappear from autocomplete.
	wantStatus(t, e.do(t, "PATCH", "/api/bots/"+b.ID, e.admin, map[string]any{"disabled": true}), http.StatusOK)
	if items := list(ch, e.member); len(items) != 0 {
		t.Fatalf("disabled bot must not offer commands: %+v", items)
	}
}

// ---- interactions: webhook transport ---------------------------------------------------------------------------- //

// hookServer records webhook deliveries and checks their signatures.
type hookServer struct {
	srv    *httptest.Server
	secret atomic.Value
	events chan hookEvent
	fail   atomic.Int32 // number of requests to answer 500 before succeeding
	calls  atomic.Int32
}

type hookEvent struct {
	Type    string          `json:"type"`
	BotID   string          `json:"bot_id"`
	Payload json.RawMessage `json:"payload"`
	sigOK   bool
	header  http.Header
}

func newHookServer(t *testing.T) *hookServer {
	t.Helper()
	h := &hookServer{events: make(chan hookEvent, 32)}
	h.secret.Store("")
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		h.calls.Add(1)
		if h.fail.Load() > 0 {
			h.fail.Add(-1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var ev hookEvent
		_ = json.Unmarshal(body, &ev)
		ev.header = r.Header.Clone()
		ev.sigOK = r.Header.Get(bots.HeaderSignature) == bots.Sign(h.secret.Load().(string), r.Header.Get(bots.HeaderTimestamp), body)
		h.events <- ev
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(h.srv.Close)
	return h
}

func (h *hookServer) next(t *testing.T, want string) hookEvent {
	t.Helper()
	for {
		select {
		case ev := <-h.events:
			if ev.Type == want {
				return ev
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("no %q event arrived", want)
		}
	}
}

// webhookBot creates a bot whose webhook is the test server, installed in a new channel with the given scopes.
func (e *botEnv) webhookBot(t *testing.T, name string, hook *hookServer, scopes ...string) (botMade, string) {
	t.Helper()
	resp := e.do(t, "POST", "/api/bots", e.admin, map[string]any{"username": name, "webhook_url": hook.srv.URL})
	wantStatus(t, resp, http.StatusCreated)
	var out struct {
		Bot struct {
			ID string `json:"id"`
		} `json:"bot"`
		Token         string `json:"token"`
		WebhookSecret string `json:"webhook_secret"`
	}
	readJSON(t, resp, &out)
	hook.secret.Store(out.WebhookSecret)
	ch := e.channel(t, "room-"+name)
	e.install(t, ch, out.Bot.ID, scopes...)
	return botMade{ID: out.Bot.ID, Token: out.Token}, ch
}

func TestBotInteractions_CommandRoundTripOverWebhook(t *testing.T) {
	e := newBotEnv(t)
	hook := newHookServer(t)
	b, ch := e.webhookBot(t, "echobot", hook, models.ScopeMessagesSend)
	hook.next(t, bots.EventBotInstall)

	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/commands", b.Token, map[string]any{"commands": []map[string]any{
		{"name": "roll", "description": "Roll", "options": []map[string]any{
			{"name": "sides", "description": "n", "type": "integer", "required": true, "choices": []map[string]any{{"name": "d6", "value": "6"}, {"name": "d20", "value": "20"}}},
			{"name": "note", "description": "n", "type": "string"}}},
	}}), http.StatusOK)

	invoke := func(token string, body map[string]any) *http.Response {
		return e.do(t, "POST", "/api/channels/"+ch+"/interactions", token, body)
	}
	// Validation against the registered definition.
	for name, body := range map[string]map[string]any{
		"unknown command": {"type": "command", "bot_id": b.ID, "command": "nope"},
		"missing option":  {"type": "command", "bot_id": b.ID, "command": "roll"},
		"not a choice":    {"type": "command", "bot_id": b.ID, "command": "roll", "options": map[string]any{"sides": 7}},
		"unknown option":  {"type": "command", "bot_id": b.ID, "command": "roll", "options": map[string]any{"sides": 6, "evil": "x"}},
		"bad type":        {"type": "wat", "bot_id": b.ID},
	} {
		resp := invoke(e.member, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, resp.StatusCode)
		}
		resp.Body.Close()
	}
	wantStatus(t, invoke("", map[string]any{"type": "command", "bot_id": b.ID, "command": "roll"}), http.StatusUnauthorized)
	wantStatus(t, invoke(e.member, map[string]any{"type": "command", "bot_id": "ghost", "command": "roll"}), http.StatusNotFound)
	// A bot that is not installed here cannot be invoked here.
	notHere := e.createBot(t, e.admin, "elsewhere", nil)
	wantStatus(t, invoke(e.member, map[string]any{"type": "command", "bot_id": notHere.ID, "command": "x"}), http.StatusNotFound)

	resp := invoke(e.member, map[string]any{"type": "command", "bot_id": b.ID, "command": "roll", "options": map[string]any{"sides": 20, "note": "hi"}})
	wantStatus(t, resp, http.StatusAccepted)
	var ack struct {
		ID        string `json:"id"`
		Delivered bool   `json:"delivered"`
	}
	readJSON(t, resp, &ack)
	if !ack.Delivered {
		t.Fatal("a webhook bot is reachable")
	}
	ev := hook.next(t, bots.EventInteractionCreate)
	if !ev.sigOK {
		t.Fatal("webhook signature must verify with the secret shown at creation")
	}
	if ev.header.Get(bots.HeaderDelivery) == "" || ev.header.Get(bots.HeaderEvent) != bots.EventInteractionCreate || ev.header.Get(bots.HeaderTimestamp) == "" {
		t.Fatalf("missing delivery headers: %v", ev.header)
	}
	var ie struct {
		ID, Token, Type string
		User            struct{ Username string }
		Data            struct {
			Name    string
			Options map[string]any
		}
	}
	if err := json.Unmarshal(ev.Payload, &ie); err != nil {
		t.Fatal(err)
	}
	if ie.ID != ack.ID || ie.Token == "" || ie.Type != "command" || ie.User.Username != "member" || ie.Data.Name != "roll" || ie.Data.Options["sides"] != float64(20) || ie.Data.Options["note"] != "hi" {
		t.Fatalf("interaction payload = %+v", ie)
	}
	// Using the bot made the person a contact (so the bot may DM them later).
	if !e.store.HasBotContact(b.ID, e.userID(t, "member")) {
		t.Fatal("an interaction must record contact")
	}

	cb := "/api/interactions/" + ie.ID + "/" + ie.Token + "/callback"
	wantStatus(t, e.asBot(t, "POST", "/api/interactions/"+ie.ID+"/wrong-token/callback", b.Token, map[string]any{"type": "message", "text": "x"}), http.StatusNotFound)
	other := e.createBot(t, e.admin, "intruder", nil)
	wantStatus(t, e.asBot(t, "POST", cb, other.Token, map[string]any{"type": "message", "text": "x"}), http.StatusNotFound)
	wantStatus(t, e.asBot(t, "POST", cb, b.Token, map[string]any{"type": "bogus"}), http.StatusBadRequest)
	wantStatus(t, e.asBot(t, "POST", cb, b.Token, map[string]any{"type": "message", "text": ""}), http.StatusBadRequest)
	resp = e.asBot(t, "POST", cb, b.Token, map[string]any{"type": "message", "text": "You rolled 14"})
	wantStatus(t, resp, http.StatusOK)
	var sent struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &sent)
	if m, err := e.store.GetMessage(ch, sent.ID); err != nil || m.SenderID != b.ID {
		t.Fatalf("the answer must be posted as the bot: %+v %v", m, err)
	}
	// Two answers at most (an ack plus one message): the third is refused.
	wantStatus(t, e.asBot(t, "POST", cb, b.Token, map[string]any{"type": "ack"}), http.StatusOK)
	resp = e.asBot(t, "POST", cb, b.Token, map[string]any{"type": "message", "text": "again"})
	wantCode(t, resp, http.StatusNotFound, apistd.CodeInteractionExpired)
}

func TestBotInteractions_ButtonsAndUpdateMessage(t *testing.T) {
	e := newBotEnv(t)
	hook := newHookServer(t)
	b, ch := e.webhookBot(t, "counter", hook, models.ScopeMessagesSend)
	hook.next(t, bots.EventBotInstall)

	resp := e.asBot(t, "POST", "/api/bots/me/channels/"+ch+"/messages", b.Token, map[string]any{"text": "count: 0", "buttons": [][]map[string]any{{{"label": "+1", "custom_id": "inc"}, {"label": "Site", "url": "https://example.com"}}}})
	wantStatus(t, resp, http.StatusCreated)
	var msg struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &msg)
	press := func(custom, msgID string) *http.Response {
		return e.do(t, "POST", "/api/channels/"+ch+"/interactions", e.member, map[string]any{"type": "button", "bot_id": b.ID, "message_id": msgID, "custom_id": custom})
	}
	wantStatus(t, press("nope", msg.ID), http.StatusBadRequest)      // no such button
	wantStatus(t, press("inc", "no-message"), http.StatusBadRequest) // no such message
	// A URL button is not a callback.
	wantStatus(t, press("https://example.com", msg.ID), http.StatusBadRequest)
	// A button of somebody else's message cannot be spoofed onto the bot.
	theirs := e.userMessage(t, ch, e.userID(t, "owner"), "inc")
	wantStatus(t, press("inc", theirs.ID), http.StatusBadRequest)

	wantStatus(t, press("inc", msg.ID), http.StatusAccepted)
	ev := hook.next(t, bots.EventInteractionCreate)
	var ie struct {
		ID        string `json:"id"`
		Token     string `json:"token"`
		MessageID string `json:"message_id"`
		Type      string `json:"type"`
		Data      struct {
			CustomID string `json:"custom_id"`
		}
	}
	_ = json.Unmarshal(ev.Payload, &ie)
	if ie.Type != "button" || ie.Data.CustomID != "inc" || ie.MessageID != msg.ID {
		t.Fatalf("button interaction = %+v", ie)
	}
	resp = e.asBot(t, "POST", "/api/interactions/"+ie.ID+"/"+ie.Token+"/callback", b.Token, map[string]any{"type": "update_message", "text": "count: 1", "buttons": [][]map[string]any{{{"label": "+1", "custom_id": "inc"}}}})
	wantStatus(t, resp, http.StatusOK)
	m, _ := e.store.GetMessage(ch, msg.ID)
	got, _ := bots.Open(e.store, e.handler.KEK, m)
	if !strings.Contains(got, "count: 1") || m.EditedAt == nil {
		t.Fatalf("update_message did not edit the original: %q", got)
	}
}

func TestBotInteractions_OfflineBotIsReportedNotDelivered(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "sleeper", nil) // no gateway, no webhook
	e.install(t, ch, b.ID)
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/commands", b.Token, map[string]any{"commands": []map[string]any{{"name": "hi", "description": "x"}}}), http.StatusOK)
	resp := e.do(t, "POST", "/api/channels/"+ch+"/interactions", e.member, map[string]any{"type": "command", "bot_id": b.ID, "command": "hi"})
	wantStatus(t, resp, http.StatusAccepted)
	var ack struct {
		Delivered bool `json:"delivered"`
	}
	readJSON(t, resp, &ack)
	if ack.Delivered {
		t.Fatal("nobody can receive it, delivered must be false")
	}
	// Per-user rate limit on interactions.
	limited := false
	for i := 0; i < 20; i++ {
		r := e.do(t, "POST", "/api/channels/"+ch+"/interactions", e.member, map[string]any{"type": "command", "bot_id": b.ID, "command": "hi"})
		if r.StatusCode == http.StatusTooManyRequests {
			limited = true
		}
		r.Body.Close()
	}
	if !limited {
		t.Fatal("hammering a bot must be rate limited per user")
	}
}

// ---- keyboards -------------------------------------------------------------------------------------------------- //

func TestBotKeyboards_SetListPressRemove(t *testing.T) {
	e := newBotEnv(t)
	hook := newHookServer(t)
	b, ch := e.webhookBot(t, "menubot", hook, models.ScopeMessagesSend)
	hook.next(t, bots.EventBotInstall)
	base := "/api/bots/me/channels/" + ch + "/keyboard"

	kb := map[string]any{"rows": [][]map[string]any{{{"label": "Start", "custom_id": "start"}, {"label": "Stop", "custom_id": "stop", "style": "danger"}}}, "placeholder": "Choose", "persistent": true}
	// URL buttons are not allowed in keyboards; empty keyboards neither.
	wantStatus(t, e.asBot(t, "PUT", base, b.Token, map[string]any{"rows": [][]map[string]any{{{"label": "x", "url": "https://e.com"}}}}), http.StatusBadRequest)
	wantStatus(t, e.asBot(t, "PUT", base, b.Token, map[string]any{"rows": [][]map[string]any{}}), http.StatusBadRequest)
	wantStatus(t, e.asBot(t, "PUT", base, b.Token, kb), http.StatusOK)

	resp := e.do(t, "GET", "/api/channels/"+ch+"/keyboards", e.member, nil)
	wantStatus(t, resp, http.StatusOK)
	var list struct {
		Items []struct {
			BotUsername string `json:"bot_username"`
			Placeholder string `json:"placeholder"`
			Persistent  bool   `json:"persistent"`
			Rows        [][]struct {
				Label string
				Style string
			} `json:"rows"`
		} `json:"items"`
	}
	readJSON(t, resp, &list)
	if len(list.Items) != 1 || list.Items[0].BotUsername != "menubot" || list.Items[0].Placeholder != "Choose" || !list.Items[0].Persistent || list.Items[0].Rows[0][1].Style != "danger" {
		t.Fatalf("keyboards = %+v", list)
	}
	wantStatus(t, e.do(t, "GET", "/api/channels/"+ch+"/keyboards", "", nil), http.StatusUnauthorized)

	press := func(custom string) *http.Response {
		return e.do(t, "POST", "/api/channels/"+ch+"/interactions", e.member, map[string]any{"type": "keyboard", "bot_id": b.ID, "custom_id": custom})
	}
	wantStatus(t, press("unknown-key"), http.StatusBadRequest)
	wantStatus(t, press("start"), http.StatusAccepted)
	ev := hook.next(t, bots.EventInteractionCreate)
	var ie struct {
		Type string
		Data struct {
			CustomID string `json:"custom_id"`
		}
	}
	_ = json.Unmarshal(ev.Payload, &ie)
	if ie.Type != "keyboard" || ie.Data.CustomID != "start" {
		t.Fatalf("keyboard press = %+v", ie)
	}

	wantStatus(t, e.asBot(t, "DELETE", base, b.Token, nil), http.StatusOK)
	resp = e.do(t, "GET", "/api/channels/"+ch+"/keyboards", e.member, nil)
	readJSON(t, resp, &list)
	if len(list.Items) != 0 {
		t.Fatalf("keyboard should be gone: %+v", list)
	}
	wantStatus(t, press("start"), http.StatusBadRequest)
}

// ---- DMs -------------------------------------------------------------------------------------------------------- //

func TestBotDMs_ContactRule(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "dmbot", map[string]any{"public": true})
	memberID := e.userID(t, "member")

	// The bot cannot open a DM with somebody who never interacted with it.
	resp := e.asBot(t, "POST", "/api/bots/me/dm", b.Token, map[string]any{"user_id": memberID})
	wantCode(t, resp, http.StatusForbidden, apistd.CodeBotContactRequired)
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/dm", b.Token, map[string]any{"user_id": "ghost"}), http.StatusNotFound)
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/dm", b.Token, map[string]any{"user_id": b.ID}), http.StatusNotFound) // bots do not DM bots

	// The person opens a DM with the (public) bot: that is contact, and the bot can write there.
	resp = e.do(t, "POST", "/api/channels", e.member, map[string]any{"members": []string{b.ID}})
	wantStatus(t, resp, http.StatusCreated)
	var dm struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &dm)
	resp = e.asBot(t, "POST", "/api/bots/me/channels/"+dm.ID+"/messages", b.Token, map[string]any{"text": "welcome"})
	wantStatus(t, resp, http.StatusCreated)

	// Now the bot may (re)open the DM, and gets the same channel back.
	resp = e.asBot(t, "POST", "/api/bots/me/dm", b.Token, map[string]any{"user_id": memberID})
	wantStatus(t, resp, http.StatusOK)
	var again struct {
		ChannelID string `json:"channel_id"`
	}
	readJSON(t, resp, &again)
	if again.ChannelID != dm.ID {
		t.Fatalf("DM = %q, want the existing %q", again.ChannelID, dm.ID)
	}

	// If the person blocks the bot, it can no longer write.
	wantStatus(t, e.do(t, "PUT", "/api/users/"+b.ID+"/relationship", e.member, map[string]any{"action": "block"}), http.StatusOK)
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/channels/"+dm.ID+"/messages", b.Token, map[string]any{"text": "still there?"}), http.StatusForbidden)
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/dm", b.Token, map[string]any{"user_id": memberID}), http.StatusForbidden)
}

func TestBotDMs_PrivateBotsAndFriendship(t *testing.T) {
	e := newBotEnv(t)
	priv := e.createBot(t, e.admin, "privbot", nil)
	// A person cannot open a DM with somebody else's private bot.
	wantStatus(t, e.do(t, "POST", "/api/channels", e.member, map[string]any{"members": []string{priv.ID}}), http.StatusForbidden)
	// Bots cannot be befriended; blocking is allowed.
	wantStatus(t, e.do(t, "PUT", "/api/users/"+priv.ID+"/relationship", e.member, map[string]any{"action": "request"}), http.StatusBadRequest)
	// Search: private bots stay hidden from other people, public ones show with is_bot.
	e.createBot(t, e.admin, "pubbot", map[string]any{"public": true})
	resp := e.do(t, "GET", "/api/users?q=bot", e.member, nil)
	var found struct {
		Items []struct {
			Username string `json:"username"`
			IsBot    bool   `json:"is_bot"`
		} `json:"items"`
	}
	readJSON(t, resp, &found)
	if len(found.Items) != 1 || found.Items[0].Username != "pubbot" || !found.Items[0].IsBot {
		t.Fatalf("search = %+v", found.Items)
	}
}

func TestBots_MemberListsMarkBots(t *testing.T) {
	e := newBotEnv(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "marked", nil)
	e.install(t, ch, b.ID)
	resp := e.do(t, "GET", "/api/channels/"+ch, e.member, nil)
	var c struct {
		MemberBots map[string]bool `json:"member_bots"`
	}
	readJSON(t, resp, &c)
	if !c.MemberBots[b.ID] || len(c.MemberBots) != 1 {
		t.Fatalf("member_bots = %+v", c.MemberBots)
	}
	resp = e.do(t, "GET", "/api/channels/"+ch+"/members", e.member, nil)
	var members struct {
		Items []struct {
			ID    string `json:"id"`
			IsBot bool   `json:"is_bot"`
		} `json:"items"`
	}
	readJSON(t, resp, &members)
	n := 0
	for _, m := range members.Items {
		if m.IsBot {
			n++
			if m.ID != b.ID {
				t.Errorf("wrong member marked as bot: %s", m.ID)
			}
		}
	}
	if n != 1 {
		t.Fatalf("exactly one member should be marked as a bot, got %d", n)
	}
}

// ---- gateway ---------------------------------------------------------------------------------------------------- //

func (e *botEnv) gatewayServer(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(e.handler.WrapWS(e.disp.GatewayHandler()))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dialGateway(t *testing.T, url, token string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bot " + token}}})
}

func readEvent(t *testing.T, c *websocket.Conn, want string) json.RawMessage {
	t.Helper()
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_, data, err := c.Read(ctx)
		cancel()
		if err != nil {
			t.Fatalf("waiting for %q: %v", want, err)
		}
		var ev struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		_ = json.Unmarshal(data, &ev)
		if ev.Type == want {
			return ev.Payload
		}
	}
}

func TestBotGateway_AuthAndHello(t *testing.T) {
	e := newBotEnv(t)
	url := e.gatewayServer(t)
	b := e.createBot(t, e.admin, "gwbot", nil)

	if _, resp, err := dialGateway(t, url, "bad.token"); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad token should be 401, got %v %v", resp, err)
	}
	// A person's session token is not accepted.
	if _, resp, err := dialGateway(t, url, e.owner); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("user token should be 401, got %v %v", resp, err)
	}
	c, _, err := dialGateway(t, url, b.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	var hello struct {
		Bot struct{ Username string } `json:"bot"`
	}
	_ = json.Unmarshal(readEvent(t, c, "hello"), &hello)
	if hello.Bot.Username != "gwbot" {
		t.Fatalf("hello = %+v", hello)
	}
	if !e.disp.Online(b.ID) {
		t.Fatal("bot should be online while connected")
	}
	// Rotating the token closes the connection.
	wantStatus(t, e.do(t, "POST", "/api/bots/"+b.ID+"/token", e.admin, nil), http.StatusOK)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			break
		}
	}
	// At most three connections per bot.
	var conns []*websocket.Conn
	var tok string
	resp := e.do(t, "POST", "/api/bots/"+b.ID+"/token", e.admin, nil)
	var rot struct {
		Token string `json:"token"`
	}
	readJSON(t, resp, &rot)
	tok = rot.Token
	for i := 0; i < 3; i++ {
		cc, _, err := dialGateway(t, url, tok)
		if err != nil {
			t.Fatalf("connection %d: %v", i+1, err)
		}
		conns = append(conns, cc)
	}
	if _, resp, err := dialGateway(t, url, tok); err == nil || resp == nil || resp.StatusCode != http.StatusConflict {
		t.Fatalf("the 4th connection should be 409, got %v %v", resp, err)
	}
	for _, cc := range conns {
		cc.CloseNow()
	}
	// Switched off by the admin.
	e.setBots(func(c *config.BotsConfig) { c.Enabled = false })
	if _, resp, err := dialGateway(t, url, tok); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("disabled API should be 403, got %v %v", resp, err)
	}
}

func TestBotGateway_MessageFiltering(t *testing.T) {
	e := newBotEnv(t)
	url := e.gatewayServer(t)
	ch := e.channel(t, "room")
	reader := e.createBot(t, e.admin, "reader", nil)   // messages.read
	listener := e.createBot(t, e.admin, "listen", nil) // messages.send only: needs a mention
	speaker := e.createBot(t, e.admin, "speaker", nil)
	e.install(t, ch, reader.ID, models.ScopeMessagesRead, models.ScopeMessagesSend, models.ScopeMembersRead)
	e.install(t, ch, listener.ID, models.ScopeMessagesSend)
	e.install(t, ch, speaker.ID, models.ScopeMessagesSend)

	rc, _, err := dialGateway(t, url, reader.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.CloseNow()
	lc, _, err := dialGateway(t, url, listener.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer lc.CloseNow()
	sc, _, err := dialGateway(t, url, speaker.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer sc.CloseNow()

	post := func(text string) {
		wantStatus(t, e.asBot(t, "POST", "/api/bots/me/channels/"+ch+"/messages", speaker.Token, map[string]any{"text": text}), http.StatusCreated)
	}
	post("just chatting")
	post("hey @listen are you there")

	// The reader (messages.read) sees both, in order, with plaintext.
	var m1, m2 struct {
		Content   string `json:"content"`
		Mentioned bool   `json:"mentioned"`
		Author    struct{ Username string }
	}
	_ = json.Unmarshal(readEvent(t, rc, "message_create"), &m1)
	_ = json.Unmarshal(readEvent(t, rc, "message_create"), &m2)
	if m1.Content != "just chatting" || m2.Content != "hey @listen are you there" || m1.Author.Username != "speaker" {
		t.Fatalf("reader events: %+v %+v", m1, m2)
	}
	// The listener (no read scope) only gets the mention.
	var lm struct {
		Content   string `json:"content"`
		Mentioned bool   `json:"mentioned"`
	}
	_ = json.Unmarshal(readEvent(t, lc, "message_create"), &lm)
	if lm.Content != "hey @listen are you there" || !lm.Mentioned {
		t.Fatalf("listener must only receive the mention: %+v", lm)
	}
	// The speaker never receives its own messages: the next event it sees is something else.
	e.disp.EmitMember(bots.EventMemberJoin, ch, e.userID(t, "member")) // speaker has no members.read: nothing
	post("@speaker talking to myself")
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
	defer cancel()
	if _, data, err := sc.Read(ctx); err == nil && strings.Contains(string(data), "message_create") {
		t.Fatalf("a bot must not receive its own message: %s", data)
	}
}

func TestBotGateway_MemberEventsNeedTheScope(t *testing.T) {
	e := newBotEnv(t)
	url := e.gatewayServer(t)
	ch := e.channel(t, "room")
	with := e.createBot(t, e.admin, "withscope", nil)
	without := e.createBot(t, e.admin, "noscope", nil)
	e.install(t, ch, with.ID, models.ScopeMessagesSend, models.ScopeMembersRead)
	e.install(t, ch, without.ID, models.ScopeMessagesSend)
	wc, _, _ := dialGateway(t, url, with.Token)
	defer wc.CloseNow()
	nc, _, _ := dialGateway(t, url, without.Token)
	defer nc.CloseNow()

	e.disp.EmitMember(bots.EventMemberJoin, ch, e.userID(t, "member"))
	var ev struct {
		ChannelID string `json:"channel_id"`
		User      struct{ Username string }
	}
	_ = json.Unmarshal(readEvent(t, wc, "member_join"), &ev)
	if ev.ChannelID != ch || ev.User.Username != "member" {
		t.Fatalf("member_join = %+v", ev)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	for {
		_, data, err := nc.Read(ctx)
		if err != nil {
			break
		}
		if strings.Contains(string(data), "member_join") {
			t.Fatal("a bot without members.read must not get member events")
		}
	}
}

func TestBotGateway_InteractionGoesOverTheSocketAndEscapesNobodyElse(t *testing.T) {
	e := newBotEnv(t)
	url := e.gatewayServer(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "live", nil)
	spy := e.createBot(t, e.admin, "spy", nil)
	e.install(t, ch, b.ID)
	e.install(t, ch, spy.ID, models.ScopeMessagesRead)
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/commands", b.Token, map[string]any{"commands": []map[string]any{{"name": "hi", "description": "x"}}}), http.StatusOK)
	bc, _, _ := dialGateway(t, url, b.Token)
	defer bc.CloseNow()
	sc, _, _ := dialGateway(t, url, spy.Token)
	defer sc.CloseNow()

	resp := e.do(t, "POST", "/api/channels/"+ch+"/interactions", e.member, map[string]any{"type": "command", "bot_id": b.ID, "command": "hi"})
	wantStatus(t, resp, http.StatusAccepted)
	var ie struct{ ID, Token string }
	_ = json.Unmarshal(readEvent(t, bc, "interaction_create"), &ie)
	if ie.ID == "" || ie.Token == "" {
		t.Fatal("the bot gets the interaction with its token")
	}
	// Another bot, even with read access, never sees interaction tokens.
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	for {
		_, data, err := sc.Read(ctx)
		if err != nil {
			break
		}
		if strings.Contains(string(data), ie.Token) {
			t.Fatal("an interaction token leaked to another bot")
		}
	}
}

// ---- webhook delivery ------------------------------------------------------------------------------------------- //

func TestBotWebhook_RetriesOnServerErrors(t *testing.T) {
	e := newBotEnv(t)
	hook := newHookServer(t)
	disp := bots.NewDispatcher(bots.Config{
		Store: e.store, KEK: e.handler.KEK, AllowPrivate: func() bool { return true },
		Backoff: []time.Duration{10 * time.Millisecond, 10 * time.Millisecond, 10 * time.Millisecond},
	})
	defer disp.Close()
	b, _ := e.webhookBot(t, "retrybot", hook, models.ScopeMessagesSend)
	hook.next(t, bots.EventBotInstall)

	hook.fail.Store(2)
	if !disp.Deliver(b.ID, "ping", map[string]string{"hello": "world"}) {
		t.Fatal("delivery should be queued")
	}
	ev := hook.next(t, "ping")
	if !ev.sigOK {
		t.Fatal("retried delivery must still be signed")
	}
	if got := hook.calls.Load(); got < 3 {
		t.Fatalf("expected 2 failures then a success, got %d calls", got)
	}
	// Permanent refusals (4xx) are not retried.
}

func TestBotWebhook_PrivateAddressesBlockedUnlessAllowed(t *testing.T) {
	e := newBotEnv(t)
	hook := newHookServer(t) // listens on 127.0.0.1
	b, _ := e.webhookBot(t, "ssrfbot", hook, models.ScopeMessagesSend)
	hook.next(t, bots.EventBotInstall)

	strict := bots.NewDispatcher(bots.Config{
		Store: e.store, KEK: e.handler.KEK, AllowPrivate: func() bool { return false },
		Backoff: []time.Duration{},
	})
	defer strict.Close()
	before := hook.calls.Load()
	strict.Deliver(b.ID, "ping", map[string]string{"a": "b"})
	time.Sleep(300 * time.Millisecond)
	if hook.calls.Load() != before {
		t.Fatal("a webhook that resolves to a loopback address must not be called when private targets are not allowed")
	}
}

func TestBotWebhook_AddressPolicy(t *testing.T) {
	for _, c := range []struct {
		ip      string
		blocked bool
	}{
		{"127.0.0.1", true}, {"::1", true}, {"10.1.2.3", true}, {"192.168.0.5", true}, {"172.16.0.1", true},
		{"169.254.169.254", true}, {"100.64.0.1", true}, {"0.0.0.0", true}, {"fe80::1", true}, {"fd00::1", true},
		{"8.8.8.8", false}, {"1.1.1.1", false}, {"2606:4700::1111", false},
	} {
		if got := bots.BlockedAddress(net.ParseIP(c.ip)); got != c.blocked {
			t.Errorf("%s blocked=%v, want %v", c.ip, got, c.blocked)
		}
	}
}

func TestBotWebhook_SignatureIsReproducible(t *testing.T) {
	a := bots.Sign("s3cret", "1700000000", []byte(`{"x":1}`))
	if a != bots.Sign("s3cret", "1700000000", []byte(`{"x":1}`)) || !strings.HasPrefix(a, "sha256=") {
		t.Fatal("signature must be deterministic and prefixed")
	}
	for _, other := range []string{bots.Sign("other", "1700000000", []byte(`{"x":1}`)), bots.Sign("s3cret", "1700000001", []byte(`{"x":1}`)), bots.Sign("s3cret", "1700000000", []byte(`{"x":2}`))} {
		if other == a {
			t.Fatal("secret, timestamp and body must all be covered by the signature")
		}
	}
}
