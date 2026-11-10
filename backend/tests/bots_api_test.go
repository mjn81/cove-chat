package tests

import (
	"net/http"
	"strings"
	"testing"

	"cove/backend/internal/apistd"
	"cove/backend/internal/config"
	"cove/backend/internal/models"
)

// ---- creation policy ------------------------------------------------------------------------------------------- //

func TestBots_CreationPolicy(t *testing.T) {
	e := newBotEnv(t)

	resp := e.do(t, "POST", "/api/bots", "", map[string]any{"username": "nobody"})
	wantStatus(t, resp, http.StatusUnauthorized)

	// Default policy: admins only.
	resp = e.do(t, "POST", "/api/bots", e.member, map[string]any{"username": "membot"})
	wantCode(t, resp, http.StatusForbidden, apistd.CodeForbidden)
	e.createBot(t, e.admin, "adminbot", nil)
	e.createBot(t, e.owner, "ownerbot", nil)

	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationUsers })
	e.createBot(t, e.member, "membot", nil)

	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationDisabled })
	resp = e.do(t, "POST", "/api/bots", e.owner, map[string]any{"username": "latebot"})
	wantStatus(t, resp, http.StatusForbidden)

	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationUsers; c.Enabled = false })
	resp = e.do(t, "POST", "/api/bots", e.owner, map[string]any{"username": "latebot"})
	wantCode(t, resp, http.StatusForbidden, apistd.CodeBotsDisabled)
}

func TestBots_CreateValidationCapAndDuplicates(t *testing.T) {
	e := newBotEnv(t)
	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationUsers; c.MaxPerUser = 2 })

	for name, body := range map[string]map[string]any{
		"upper case":    {"username": "Bad"},
		"too short":     {"username": "a"},
		"spaces":        {"username": "a b"},
		"long desc":     {"username": "okname", "description": strings.Repeat("x", 401)},
		"http webhook":  {"username": "okname", "webhook_url": "http://example.com/hook"},
		"junk webhook":  {"username": "okname", "webhook_url": "javascript:alert(1)"},
		"creds in hook": {"username": "okname", "webhook_url": "https://u:p@example.com/"},
	} {
		resp := e.do(t, "POST", "/api/bots", e.member, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
		resp.Body.Close()
	}
	resp := e.do(t, "POST", "/api/bots", e.member, map[string]any{"username": "okname", "webhook_url": "javascript:x"})
	wantCode(t, resp, http.StatusBadRequest, apistd.CodeWebhookURLInvalid)

	e.createBot(t, e.member, "one", nil)
	e.createBot(t, e.member, "two", nil)
	resp = e.do(t, "POST", "/api/bots", e.member, map[string]any{"username": "three"})
	wantCode(t, resp, http.StatusConflict, apistd.CodeBotLimitReached)

	// A name that is already a person's, or another bot's.
	resp = e.do(t, "POST", "/api/bots", e.owner, map[string]any{"username": "member"})
	wantStatus(t, resp, http.StatusConflict)
	resp = e.do(t, "POST", "/api/bots", e.owner, map[string]any{"username": "one"})
	wantStatus(t, resp, http.StatusConflict)
}

func TestBots_TokenShownOnceAndAuthenticates(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "pingbot", map[string]any{"description": "pings"})

	resp := e.asBot(t, "GET", "/api/bots/me", b.Token, nil)
	wantStatus(t, resp, http.StatusOK)
	var me struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	readJSON(t, resp, &me)
	if me.ID != b.ID || me.Username != "pingbot" {
		t.Fatalf("@me = %+v", me)
	}

	// The owner's view of the bot never contains the token or the secret hash.
	resp = e.do(t, "GET", "/api/bots/"+b.ID, e.admin, nil)
	wantStatus(t, resp, http.StatusOK)
	var raw map[string]any
	readJSON(t, resp, &raw)
	for k := range raw {
		if strings.Contains(k, "token") || strings.Contains(k, "secret") || strings.Contains(k, "hash") {
			t.Fatalf("GET must not expose %q", k)
		}
	}
}

func TestBots_WebhookSecretOnCreateAndRotate(t *testing.T) {
	e := newBotEnv(t)
	resp := e.do(t, "POST", "/api/bots", e.admin, map[string]any{"username": "hooky", "webhook_url": "https://example.com/hook"})
	wantStatus(t, resp, http.StatusCreated)
	var out struct {
		WebhookSecret string `json:"webhook_secret"`
		Bot           struct {
			ID string `json:"id"`
		} `json:"bot"`
	}
	readJSON(t, resp, &out)
	if !strings.HasPrefix(out.WebhookSecret, "whsec_") {
		t.Fatalf("expected a webhook secret, got %q", out.WebhookSecret)
	}
	resp = e.do(t, "PATCH", "/api/bots/"+out.Bot.ID, e.admin, map[string]any{"rotate_webhook_secret": true})
	wantStatus(t, resp, http.StatusOK)
	var upd struct {
		WebhookSecret string `json:"webhook_secret"`
	}
	readJSON(t, resp, &upd)
	if upd.WebhookSecret == "" || upd.WebhookSecret == out.WebhookSecret {
		t.Fatal("rotating must return a new secret")
	}
	// Clearing the URL clears the secret; a plain GET never shows it.
	resp = e.do(t, "PATCH", "/api/bots/"+out.Bot.ID, e.admin, map[string]any{"webhook_url": ""})
	wantStatus(t, resp, http.StatusOK)
	b, _ := e.store.GetBot(out.Bot.ID)
	if b.WebhookURL != "" || b.WebhookSecret != "" {
		t.Fatalf("webhook not cleared: %+v", b)
	}
}

// ---- access tier ------------------------------------------------------------------------------------------------ //

// botRoutes is every route of the Bot tier; they must reject anything but a bot token.
var botRoutes = []struct{ method, path string }{
	{"GET", "/api/bots/me"},
	{"GET", "/api/bots/me/commands"},
	{"PUT", "/api/bots/me/commands"},
	{"DELETE", "/api/bots/me/commands/x"},
	{"GET", "/api/bots/me/channels"},
	{"PUT", "/api/bots/me/channels/c1/commands"},
	{"POST", "/api/bots/me/channels/c1/messages"},
	{"GET", "/api/bots/me/channels/c1/messages"},
	{"PATCH", "/api/bots/me/channels/c1/messages/m1"},
	{"DELETE", "/api/bots/me/channels/c1/messages/m1"},
	{"GET", "/api/bots/me/channels/c1/members"},
	{"PUT", "/api/bots/me/channels/c1/keyboard"},
	{"DELETE", "/api/bots/me/channels/c1/keyboard"},
	{"POST", "/api/bots/me/dm"},
	{"POST", "/api/interactions/i1/tok/callback"},
}

func TestBots_BotRoutesRequireABotToken(t *testing.T) {
	e := newBotEnv(t)
	for _, rt := range botRoutes {
		// No credential.
		resp := e.asBot(t, rt.method, rt.path, "", nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without credentials: %d, want 401", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
		// A person's session token is not a bot token, whatever the scheme.
		resp = e.do(t, rt.method, rt.path, e.owner, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s with a user session: %d, want 401", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
		resp = e.asBot(t, rt.method, rt.path, e.owner, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s with a user token under the Bot scheme: %d, want 401", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

func TestBots_BotTokenReachesNothingElse(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "snoop", nil)
	ch := e.channel(t, "room")
	e.install(t, ch, b.ID, models.ScopeMessagesRead, models.ScopeMessagesSend, models.ScopeMembersRead)

	// Under the Bot scheme AND (as a bug-check) under Bearer: user routes, management routes and admin routes all refuse.
	routes := []struct{ method, path string }{
		{"GET", "/api/me"}, {"GET", "/api/channels"}, {"GET", "/api/channels/" + ch},
		{"GET", "/api/channels/" + ch + "/messages"}, {"GET", "/api/channels/" + ch + "/members"},
		{"POST", "/api/channels/" + ch + "/interactions"}, {"PUT", "/api/channels/" + ch + "/bots/" + b.ID},
		{"GET", "/api/bots"}, {"POST", "/api/bots"}, {"POST", "/api/bots/" + b.ID + "/token"},
		{"GET", "/api/admin/overview"}, {"GET", "/api/admin/audit"}, {"PATCH", "/api/admin/config"},
		{"POST", "/api/files"}, {"GET", "/api/users"}, {"POST", "/api/logout"},
	}
	for _, rt := range routes {
		resp := e.asBot(t, rt.method, rt.path, b.Token, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("bot token (Bot scheme) on %s %s: %d, want 401", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
		resp = e.do(t, rt.method, rt.path, b.Token, nil) // Bearer scheme
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("bot token (Bearer scheme) on %s %s: %d, want 401", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
	// The bot cannot sign in as a person either.
	resp := e.do(t, "POST", "/api/login", "", map[string]string{"username": "snoop", "password": ""})
	wantStatus(t, resp, http.StatusUnauthorized)
	resp = e.do(t, "POST", "/api/login", "", map[string]string{"username": "snoop", "password": testPassword})
	wantStatus(t, resp, http.StatusUnauthorized)
}

func TestBots_MalformedBotTokens(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "pingbot", nil)
	secret := strings.SplitN(b.Token, ".", 2)[1]
	for _, tok := range []string{"x", b.ID, b.ID + ".", "." + secret, b.ID + ".nope", "nope." + secret, strings.Repeat("a", 5000)} {
		resp := e.asBot(t, "GET", "/api/bots/me", tok, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("token %.20q: %d, want 401", tok, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

// ---- ownership, rotate, disable, delete -------------------------------------------------------------------------- //

func TestBots_OwnershipRules(t *testing.T) {
	e := newBotEnv(t)
	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationUsers })
	mine := e.createBot(t, e.member, "mine", nil)

	// A stranger (the admin is not the owner and a server admin may manage anything; use a fresh plain user).
	if _, err := e.store.CreateUser("stranger", testPassword, "chat.test"); err != nil {
		t.Fatal(err)
	}
	stranger := e.login(t, "stranger")
	for _, rt := range []struct{ method, path string }{
		{"GET", "/api/bots/" + mine.ID}, {"PATCH", "/api/bots/" + mine.ID}, {"DELETE", "/api/bots/" + mine.ID}, {"POST", "/api/bots/" + mine.ID + "/token"},
	} {
		resp := e.do(t, rt.method, rt.path, stranger, map[string]any{})
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("stranger %s %s: %d, want 404", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
		resp = e.do(t, rt.method, rt.path, "", nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("anonymous %s %s: %d, want 401", rt.method, rt.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
	// A server admin may manage someone else's bot.
	resp := e.do(t, "GET", "/api/bots/"+mine.ID, e.admin, nil)
	wantStatus(t, resp, http.StatusOK)

	// The list shows only my bots; admins can ask for all.
	e.createBot(t, e.owner, "ownersbot", nil)
	var page struct {
		Items     []struct{ Username string } `json:"items"`
		CanCreate bool                        `json:"can_create"`
	}
	resp = e.do(t, "GET", "/api/bots", e.member, nil)
	readJSON(t, resp, &page)
	if len(page.Items) != 1 || page.Items[0].Username != "mine" || !page.CanCreate {
		t.Fatalf("member list = %+v", page)
	}
	resp = e.do(t, "GET", "/api/bots?all=1", e.member, nil)
	readJSON(t, resp, &page)
	if len(page.Items) != 1 {
		t.Fatalf("all=1 must be ignored for non-admins, got %d items", len(page.Items))
	}
	resp = e.do(t, "GET", "/api/bots?all=1", e.admin, nil)
	readJSON(t, resp, &page)
	if len(page.Items) != 2 {
		t.Fatalf("admin all=1 should list every bot, got %d", len(page.Items))
	}
	resp = e.do(t, "GET", "/api/bots?limit=0", e.member, nil)
	wantStatus(t, resp, http.StatusBadRequest)
}

func TestBots_RotateDisableDelete(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "rotator", nil)

	resp := e.do(t, "POST", "/api/bots/"+b.ID+"/token", e.admin, nil)
	wantStatus(t, resp, http.StatusOK)
	var rot struct {
		Token string `json:"token"`
	}
	readJSON(t, resp, &rot)
	if rot.Token == "" || rot.Token == b.Token {
		t.Fatal("rotation must return a new token")
	}
	resp = e.asBot(t, "GET", "/api/bots/me", b.Token, nil)
	wantStatus(t, resp, http.StatusUnauthorized)
	resp = e.asBot(t, "GET", "/api/bots/me", rot.Token, nil)
	wantStatus(t, resp, http.StatusOK)

	resp = e.do(t, "PATCH", "/api/bots/"+b.ID, e.admin, map[string]any{"disabled": true})
	wantStatus(t, resp, http.StatusOK)
	resp = e.asBot(t, "GET", "/api/bots/me", rot.Token, nil)
	wantStatus(t, resp, http.StatusForbidden)
	resp = e.do(t, "PATCH", "/api/bots/"+b.ID, e.admin, map[string]any{"disabled": false})
	wantStatus(t, resp, http.StatusOK)
	resp = e.asBot(t, "GET", "/api/bots/me", rot.Token, nil)
	wantStatus(t, resp, http.StatusOK)

	resp = e.do(t, "DELETE", "/api/bots/"+b.ID, e.admin, nil)
	wantStatus(t, resp, http.StatusOK)
	resp = e.asBot(t, "GET", "/api/bots/me", rot.Token, nil)
	wantStatus(t, resp, http.StatusUnauthorized)
	resp = e.do(t, "GET", "/api/bots/"+b.ID, e.admin, nil)
	wantStatus(t, resp, http.StatusNotFound)
}

func TestBots_PerBotRateLimit(t *testing.T) {
	e := newBotEnv(t)
	e.setBots(func(c *config.BotsConfig) { c.RateLimitRPS = 1 })
	b := e.createBot(t, e.admin, "chatty", nil)
	limited := false
	for i := 0; i < 6; i++ {
		resp := e.asBot(t, "GET", "/api/bots/me", b.Token, nil)
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
			if resp.Header.Get("Retry-After") == "" {
				t.Error("429 should carry Retry-After")
			}
		}
		resp.Body.Close()
	}
	if !limited {
		t.Fatal("a burst beyond the per-bot rate must be answered 429")
	}
}

// ---- install ---------------------------------------------------------------------------------------------------- //

func TestBots_InstallRules(t *testing.T) {
	e := newBotEnv(t)
	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationUsers })
	ch := e.channel(t, "room")
	owned := e.createBot(t, e.owner, "ownedbot", nil)
	other := e.createBot(t, e.member, "memberbot", nil)

	// A plain member cannot install, an unauthenticated caller neither.
	resp := e.do(t, "PUT", "/api/channels/"+ch+"/bots/"+owned.ID, e.member, nil)
	wantStatus(t, resp, http.StatusForbidden)
	resp = e.do(t, "PUT", "/api/channels/"+ch+"/bots/"+owned.ID, "", nil)
	wantStatus(t, resp, http.StatusUnauthorized)

	// A channel admin who is not a server admin cannot install somebody else's private bot...
	if _, err := e.store.CreateUser("cadmin", testPassword, "chat.test"); err != nil {
		t.Fatal(err)
	}
	cadmin := e.login(t, "cadmin")
	wantStatus(t, e.do(t, "POST", "/api/channels/"+ch+"/members", e.owner, map[string]any{"user_ids": []string{e.userID(t, "cadmin")}}), http.StatusOK)
	wantStatus(t, e.do(t, "PATCH", "/api/channels/"+ch+"/members/"+e.userID(t, "cadmin"), e.owner, map[string]int{"role": models.RoleAdmin}), http.StatusOK)
	resp = e.do(t, "PUT", "/api/channels/"+ch+"/bots/"+other.ID, cadmin, nil)
	wantStatus(t, resp, http.StatusNotFound)
	// ... unless it is public.
	resp = e.do(t, "PATCH", "/api/bots/"+other.ID, e.member, map[string]any{"public": true})
	wantStatus(t, resp, http.StatusOK)
	resp = e.do(t, "PUT", "/api/channels/"+ch+"/bots/"+other.ID, cadmin, map[string]any{"scopes": []string{"messages.read"}})
	wantStatus(t, resp, http.StatusOK)

	resp = e.do(t, "PUT", "/api/channels/"+ch+"/bots/"+owned.ID, e.owner, map[string]any{"scopes": []string{"admin"}})
	wantStatus(t, resp, http.StatusBadRequest)
	resp = e.do(t, "PUT", "/api/channels/"+ch+"/bots/no-such-bot", e.owner, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp = e.do(t, "PUT", "/api/channels/no-such-channel/bots/"+owned.ID, e.owner, nil)
	wantStatus(t, resp, http.StatusNotFound)

	e.install(t, ch, owned.ID, models.ScopeMessagesSend)
	uc, err := e.store.GetUserChannel(owned.ID, ch)
	if err != nil || uc.Role != models.RoleMember {
		t.Fatalf("an installed bot is a plain member, got %+v %v", uc, err)
	}

	// Listing: any member sees the installs with scopes.
	var list struct {
		Items []struct {
			Bot    struct{ Username string } `json:"bot"`
			Scopes []string                  `json:"scopes"`
		} `json:"items"`
	}
	resp = e.do(t, "GET", "/api/channels/"+ch+"/bots", e.member, nil)
	readJSON(t, resp, &list)
	if len(list.Items) != 2 {
		t.Fatalf("installs = %+v", list.Items)
	}
	resp = e.do(t, "GET", "/api/channels/"+ch+"/bots", "", nil)
	wantStatus(t, resp, http.StatusUnauthorized)

	// Uninstall.
	resp = e.do(t, "DELETE", "/api/channels/"+ch+"/bots/"+owned.ID, e.member, nil)
	wantStatus(t, resp, http.StatusForbidden)
	resp = e.do(t, "DELETE", "/api/channels/"+ch+"/bots/"+owned.ID, e.owner, nil)
	wantStatus(t, resp, http.StatusOK)
	resp = e.do(t, "DELETE", "/api/channels/"+ch+"/bots/"+owned.ID, e.owner, nil)
	wantStatus(t, resp, http.StatusNotFound)
	resp = e.asBot(t, "GET", "/api/bots/me/channels/"+ch+"/commands", owned.Token, nil)
	if resp.StatusCode == http.StatusOK {
		t.Fatal("an uninstalled bot must lose access")
	}
}

func TestBots_NoInstallInDMsAndNoRolesOrKicks(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "helper", nil)

	// A DM between two people.
	resp := e.do(t, "POST", "/api/channels", e.owner, map[string]any{"members": []string{e.userID(t, "member")}})
	wantStatus(t, resp, http.StatusCreated)
	var dm struct {
		ID string `json:"id"`
	}
	readJSON(t, resp, &dm)
	// Nobody is an admin of a DM, so the install is refused (403) before the "not in a DM" rule (400) is reached.
	resp = e.do(t, "PUT", "/api/channels/"+dm.ID+"/bots/"+b.ID, e.owner, nil)
	if resp.StatusCode != http.StatusForbidden && resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("installing into a DM = %d, want 403 or 400", resp.StatusCode)
	}
	resp.Body.Close()

	ch := e.channel(t, "room")
	e.install(t, ch, b.ID)
	// Not through the add-member route.
	b2 := e.createBot(t, e.admin, "second", nil)
	resp = e.do(t, "POST", "/api/channels/"+ch+"/members", e.owner, map[string]any{"user_ids": []string{b2.ID}})
	wantStatus(t, resp, http.StatusOK)
	var added struct {
		Added   []string                  `json:"added"`
		Skipped []struct{ Reason string } `json:"skipped"`
	}
	readJSON(t, resp, &added)
	if len(added.Added) != 0 || len(added.Skipped) != 1 || added.Skipped[0].Reason != apistd.CodeBotInstallRequired {
		t.Fatalf("a bot must not be added as an ordinary member: %+v", added)
	}
	// A bot is never promoted and never kicked like a person.
	resp = e.do(t, "PATCH", "/api/channels/"+ch+"/members/"+b.ID, e.owner, map[string]int{"role": models.RoleAdmin})
	wantCode(t, resp, http.StatusBadRequest, apistd.CodeBotInstallRequired)
	resp = e.do(t, "DELETE", "/api/channels/"+ch+"/members/"+b.ID, e.owner, nil)
	wantCode(t, resp, http.StatusBadRequest, apistd.CodeBotInstallRequired)
	// No bots in a brand-new group.
	resp = e.do(t, "POST", "/api/channels", e.owner, map[string]any{"name": "g", "members": []string{b.ID}})
	wantCode(t, resp, http.StatusForbidden, apistd.CodeBotInstallRequired)
}

func TestBots_AuditTrailAndCapability(t *testing.T) {
	e := newBotEnv(t)
	b := e.createBot(t, e.admin, "audited", map[string]any{"webhook_url": "https://example.com/h"})
	ch := e.channel(t, "room")
	e.install(t, ch, b.ID)
	e.do(t, "POST", "/api/bots/"+b.ID+"/token", e.admin, nil).Body.Close()
	e.do(t, "PATCH", "/api/bots/"+b.ID, e.admin, map[string]any{"disabled": true}).Body.Close()
	e.do(t, "DELETE", "/api/channels/"+ch+"/bots/"+b.ID, e.owner, nil).Body.Close()
	e.do(t, "DELETE", "/api/bots/"+b.ID, e.admin, nil).Body.Close()

	resp := e.do(t, "GET", "/api/admin/audit?limit=100", e.owner, nil)
	var audit struct {
		Items []struct {
			Action string `json:"action"`
			Target string `json:"target"`
		} `json:"items"`
	}
	readJSON(t, resp, &audit)
	seen := map[string]bool{}
	for _, it := range audit.Items {
		seen[it.Action] = true
		if strings.Contains(it.Target, ".") && len(it.Target) > 60 {
			t.Errorf("audit target looks like a token: %q", it.Target)
		}
	}
	for _, want := range []string{"bot.create", "bot.install", "bot.rotate_token", "bot.disable", "bot.uninstall", "bot.delete"} {
		if !seen[want] {
			t.Errorf("audit log is missing %q (have %v)", want, seen)
		}
	}

	resp = e.get(t, "/api/version", "", nil)
	var v struct {
		Capabilities []string `json:"capabilities"`
	}
	readJSON(t, resp, &v)
	found := false
	for _, c := range v.Capabilities {
		if c == apistd.CapBots {
			found = true
		}
	}
	if !found {
		t.Fatalf("capabilities %v must include %q", v.Capabilities, apistd.CapBots)
	}
}

func TestBots_AdminSettingsApplyLive(t *testing.T) {
	e := newBotEnv(t)
	resp := e.patchConfig(t, e.admin, map[string]any{"bots.creation": "users", "bots.max_per_user": 1})
	wantStatus(t, resp, http.StatusOK)
	e.createBot(t, e.member, "livebot", nil) // allowed now
	resp = e.do(t, "POST", "/api/bots", e.member, map[string]any{"username": "secondbot"})
	wantCode(t, resp, http.StatusConflict, apistd.CodeBotLimitReached)
	resp = e.patchConfig(t, e.admin, map[string]any{"bots.creation": "everyone"})
	wantStatus(t, resp, http.StatusBadRequest)
	resp = e.patchConfig(t, e.admin, map[string]any{"bots.max_per_user": 0})
	wantStatus(t, resp, http.StatusBadRequest)
	// Letting webhooks reach private networks is an owner-only decision.
	resp = e.patchConfig(t, e.admin, map[string]any{"bots.webhook_allow_private": true})
	wantStatus(t, resp, http.StatusForbidden)
	resp = e.patchConfig(t, e.member, map[string]any{"bots.creation": "users"})
	wantStatus(t, resp, http.StatusForbidden)
}

func TestBots_DeletingTheOwnerDeletesTheirBots(t *testing.T) {
	e := newBotEnv(t)
	e.setBots(func(c *config.BotsConfig) { c.Creation = config.BotCreationUsers })
	b := e.createBot(t, e.member, "orphan", nil)
	ch := e.channel(t, "room")
	e.install(t, ch, b.ID)

	resp := e.do(t, "DELETE", "/api/users/me", e.member, map[string]string{"password": testPassword})
	wantStatus(t, resp, http.StatusOK)

	wantStatus(t, e.asBot(t, "GET", "/api/bots/me", b.Token, nil), http.StatusUnauthorized)
	if _, err := e.store.GetBot(b.ID); err == nil {
		t.Fatal("the bot record must be gone with its owner")
	}
	if uc, err := e.store.GetUserChannel(b.ID, ch); err == nil && uc.Status == models.StatusActive {
		t.Fatal("the bot must not stay in the channel")
	}
}
