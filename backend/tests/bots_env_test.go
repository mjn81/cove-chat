package tests

import (
	"net/http"
	"testing"

	"cove/backend/internal/bots"
	"cove/backend/internal/config"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// botEnv is a server with an owner, an admin, a plain member and the bot dispatcher wired in.
type botEnv struct {
	*adminEnv
	owner, admin, member string // session tokens
	disp                 *bots.Dispatcher
}

func newBotEnv(t *testing.T) *botEnv {
	t.Helper()
	env := newAdminEnv(t, "open")
	owner, admin, member := env.seedRoles(t)
	env.handler.IsDev = true // allow http://127.0.0.1 webhook URLs
	disp := bots.NewDispatcher(bots.Config{
		Store: env.store, KEK: env.handler.KEK,
		Enabled:      func() bool { return env.settings.Bots().Enabled },
		AllowPrivate: func() bool { return true },
		Backoff:      nil,
	})
	t.Cleanup(disp.Close)
	env.handler.Bots = disp
	return &botEnv{adminEnv: env, owner: owner, admin: admin, member: member, disp: disp}
}

// setBots changes the live Bot API policy.
func (e *botEnv) setBots(mut func(*config.BotsConfig)) {
	cfg := e.settings.Bots()
	mut(&cfg)
	e.settings.SetBots(cfg)
}

type botMade struct {
	ID    string
	Token string
}

// createBot creates a bot through the API as the holder of token and fails the test unless it is created.
func (e *botEnv) createBot(t *testing.T, token, name string, extra map[string]any) botMade {
	t.Helper()
	body := map[string]any{"username": name}
	for k, v := range extra {
		body[k] = v
	}
	resp := e.do(t, "POST", "/api/bots", token, body)
	wantStatus(t, resp, http.StatusCreated)
	var out struct {
		Bot struct {
			ID string `json:"id"`
		} `json:"bot"`
		Token string `json:"token"`
	}
	readJSON(t, resp, &out)
	if out.Token == "" || out.Bot.ID == "" {
		t.Fatalf("create bot returned no token or id: %+v", out)
	}
	return botMade{ID: out.Bot.ID, Token: out.Token}
}

// asBot sends a JSON request authenticated with a bot token.
func (e *botEnv) asBot(t *testing.T, method, path, botToken string, body any) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, jsonBody(t, orEmpty(body)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if botToken != "" {
		req.Header.Set("Authorization", "Bot "+botToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func orEmpty(v any) any {
	if v == nil {
		return struct{}{}
	}
	return v
}

// channel creates a group channel owned by the owner with the admin and member in it and returns its id.
func (e *botEnv) channel(t *testing.T, name string) string {
	t.Helper()
	resp := e.do(t, "POST", "/api/channels", e.owner, map[string]any{
		"name": name, "members": []string{e.userID(t, "admin"), e.userID(t, "member")},
	})
	wantStatus(t, resp, http.StatusCreated)
	var ch struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &ch)
	// The admin gets the channel admin role so they can install bots.
	r := e.do(t, "PATCH", "/api/channels/"+ch.ID+"/members/"+e.userID(t, "admin"), e.owner, map[string]int{"role": models.RoleAdmin})
	wantStatus(t, r, http.StatusOK)
	return ch.ID
}

// install installs bot into channel as the owner with the given scopes.
func (e *botEnv) install(t *testing.T, channelID, botID string, scopes ...string) {
	t.Helper()
	resp := e.do(t, "PUT", "/api/channels/"+channelID+"/bots/"+botID, e.owner, map[string]any{"scopes": scopes})
	wantStatus(t, resp, http.StatusOK)
}

// userMessage stores a user message with plaintext content in the channel (as if sent over the socket).
func (e *botEnv) userMessage(t *testing.T, channelID, userID, text string) *models.Message {
	t.Helper()
	nonce, ct, err := bots.Seal(e.store, e.handler.KEK, channelID, []byte(text))
	if err != nil {
		t.Fatal(err)
	}
	msg := &models.Message{ID: store.NewMessageID(), ChannelID: channelID, SenderID: userID, Type: models.MessageTypeText, Ciphertext: ct, Nonce: nonce, Compression: "none"}
	if err := e.store.SaveMessage(msg); err != nil {
		t.Fatal(err)
	}
	return msg
}
