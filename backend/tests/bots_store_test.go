package tests

import (
	"errors"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/bots"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

func TestBotStore_CreateTokenAuthRotate(t *testing.T) {
	s := newPackStore(t)
	u, b, token, err := s.CreateBot("owner1", "helper", "does things", "chat.test", 5)
	if err != nil {
		t.Fatal(err)
	}
	if !u.IsBot() || u.OwnerID != "owner1" || b.ID != u.ID {
		t.Fatalf("bot user not set up: %+v %+v", u, b)
	}
	if strings.Contains(b.TokenHash, token) || b.TokenHash == "" {
		t.Fatal("the stored value must be a hash, never the token")
	}
	if !strings.HasPrefix(token, b.ID+".") {
		t.Fatalf("token should be <id>.<secret>, got %q", token)
	}

	gotBot, gotUser, err := s.AuthenticateBot(token)
	if err != nil || gotBot.ID != b.ID || gotUser.ID != u.ID {
		t.Fatalf("valid token refused: %v", err)
	}
	for _, bad := range []string{"", "nodot", b.ID + ".", b.ID + ".wrong", "unknown." + strings.Split(token, ".")[1], strings.Repeat("a", 300)} {
		if _, _, err := s.AuthenticateBot(bad); !errors.Is(err, store.ErrInvalidBotToken) {
			t.Fatalf("token %q must be refused with ErrInvalidBotToken, got %v", bad, err)
		}
	}

	newToken, err := s.RotateBotToken(b.ID)
	if err != nil || newToken == token {
		t.Fatalf("rotate: %v", err)
	}
	if _, _, err := s.AuthenticateBot(token); err == nil {
		t.Fatal("the old token must stop working at once")
	}
	if _, _, err := s.AuthenticateBot(newToken); err != nil {
		t.Fatalf("new token refused: %v", err)
	}
}

func TestBotStore_BotsCannotLogInWithAPassword(t *testing.T) {
	s := newPackStore(t)
	if _, _, _, err := s.CreateBot("o", "robot", "", "chat.test", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateUser("robot", ""); !errors.Is(err, store.ErrInvalidCredentials) {
		t.Fatalf("a bot must never authenticate as a user, got %v", err)
	}
	if _, err := s.AuthenticateUser("robot", "anything"); !errors.Is(err, store.ErrInvalidCredentials) {
		t.Fatalf("a bot must never authenticate as a user, got %v", err)
	}
}

func TestBotStore_OwnerCapAndUniqueName(t *testing.T) {
	s := newPackStore(t)
	for _, n := range []string{"a1", "a2"} {
		if _, _, _, err := s.CreateBot("o", n, "", "d", 2); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := s.CreateBot("o", "a3", "", "d", 2); !errors.Is(err, store.ErrBotLimit) {
		t.Fatalf("third bot should hit the cap, got %v", err)
	}
	if _, _, _, err := s.CreateBot("other", "a1", "", "d", 2); !errors.Is(err, store.ErrUsernameTaken) {
		t.Fatalf("duplicate name should be refused, got %v", err)
	}
	if _, _, _, err := s.CreateBot("other", "b1", "", "d", 2); err != nil {
		t.Fatalf("another owner has their own cap: %v", err)
	}
}

func TestBotStore_InstallUninstallDelete(t *testing.T) {
	s := newPackStore(t)
	owner, _ := s.CreateUser("owner", "pw-long-enough", "d")
	ch, err := s.CreateChannel("room", owner.ID, false, []string{owner.ID}, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	u, _, _, err := s.CreateBot(owner.ID, "robot", "", "d", 5)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.InstallBot(ch.ID, &models.BotInstall{BotID: u.ID, Scopes: []string{models.ScopeMessagesSend}, InstalledBy: owner.ID}); err != nil {
		t.Fatal(err)
	}
	uc, err := s.GetUserChannel(u.ID, ch.ID)
	if err != nil || uc.Role != models.RoleMember || uc.Status != models.StatusActive {
		t.Fatalf("an installed bot must be an active plain member: %+v %v", uc, err)
	}
	in, err := s.GetBotInstall(ch.ID, u.ID)
	if err != nil || !in.HasScope(models.ScopeMessagesSend) || in.HasScope(models.ScopeMessagesRead) {
		t.Fatalf("install scopes wrong: %+v %v", in, err)
	}
	if err := s.ReplaceBotCommands(u.ID, ch.ID, []*models.BotCommand{{Name: "here", Description: "d"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetKeyboard(&models.Keyboard{ChannelID: ch.ID, BotID: u.ID, Rows: [][]models.Button{{{Label: "a", CustomID: "a"}}}}); err != nil {
		t.Fatal(err)
	}

	if err := s.RemoveBotFromChannel(ch.ID, u.ID); err != nil {
		t.Fatal(err)
	}
	if uc, _ := s.GetUserChannel(u.ID, ch.ID); uc != nil && uc.Status == models.StatusActive {
		t.Fatal("uninstalled bot must not stay a member")
	}
	if _, err := s.GetBotInstall(ch.ID, u.ID); err == nil {
		t.Fatal("install row should be gone")
	}
	if cmds, _ := s.ListBotCommands(u.ID, ch.ID); len(cmds) != 0 {
		t.Fatal("channel commands should be gone")
	}
	if _, err := s.GetKeyboard(ch.ID, u.ID); err == nil {
		t.Fatal("keyboard should be gone")
	}

	if err := s.InstallBot(ch.ID, &models.BotInstall{BotID: u.ID, Scopes: []string{models.ScopeMessagesSend}, InstalledBy: owner.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteBot(u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetBot(u.ID); !errors.Is(err, store.ErrBotNotFound) {
		t.Fatal("bot record should be gone")
	}
	if _, err := s.GetUser(u.ID); err == nil {
		t.Fatal("bot user should be gone")
	}
}

func TestBotStore_CommandsReplaceAndResolve(t *testing.T) {
	s := newPackStore(t)
	if err := s.ReplaceBotCommands("b", store.GlobalScope, []*models.BotCommand{{Name: "ping", Description: "global"}, {Name: "help", Description: "h"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceBotCommands("b", "ch1", []*models.BotCommand{{Name: "ping", Description: "local"}}); err != nil {
		t.Fatal(err)
	}
	c, err := s.FindBotCommand("b", "ch1", "ping")
	if err != nil || c.Description != "local" {
		t.Fatalf("a channel command must win over the global one: %+v %v", c, err)
	}
	c, _ = s.FindBotCommand("b", "ch2", "ping")
	if c == nil || c.Description != "global" {
		t.Fatalf("other channels see the global command: %+v", c)
	}
	// Replacing removes commands that are no longer listed.
	if err := s.ReplaceBotCommands("b", store.GlobalScope, []*models.BotCommand{{Name: "only", Description: "x"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindBotCommand("b", "ch2", "help"); err == nil {
		t.Fatal("replaced command set must drop old commands")
	}
}

func TestBotStore_InteractionTokenRules(t *testing.T) {
	s := newPackStore(t)
	in := &models.Interaction{Type: models.InteractionCommand, BotID: "b", ChannelID: "c", UserID: "u"}
	tok, err := s.CreateInteraction(in)
	if err != nil || tok == "" || in.ID == "" {
		t.Fatalf("create: %v", err)
	}
	now := time.Now()
	if _, err := s.UseInteraction(in.ID, "wrong", "b", now); !errors.Is(err, store.ErrInteractionNotFound) {
		t.Fatal("wrong token must be refused")
	}
	if _, err := s.UseInteraction(in.ID, tok, "other-bot", now); !errors.Is(err, store.ErrInteractionNotFound) {
		t.Fatal("another bot must not answer")
	}
	if _, err := s.UseInteraction(in.ID, tok, "b", now.Add(store.InteractionTTL+time.Minute)); !errors.Is(err, store.ErrInteractionNotFound) {
		t.Fatal("expired interaction must be refused")
	}
	for i := 0; i < store.MaxInteractionResponses; i++ {
		if _, err := s.UseInteraction(in.ID, tok, "b", now); err != nil {
			t.Fatalf("response %d refused: %v", i+1, err)
		}
	}
	if _, err := s.UseInteraction(in.ID, tok, "b", now); !errors.Is(err, store.ErrInteractionNotFound) {
		t.Fatal("answers beyond the allowed count must be refused")
	}
	n, err := s.PurgeExpiredInteractions(now.Add(store.InteractionTTL + time.Hour))
	if err != nil || n != 1 {
		t.Fatalf("purge removed %d, %v", n, err)
	}
}

// ---- pure validation --------------------------------------------------------------------------------------------- //

func TestBotsValidate_Names(t *testing.T) {
	for _, ok := range []string{"ab", "pingbot", "my-bot_2", "a.b"} {
		if !bots.ValidBotName(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "a", "Admin", "-bot", "has space", strings.Repeat("a", 33), "bot!", "ربات"} {
		if bots.ValidBotName(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

func TestBotsValidate_Scopes(t *testing.T) {
	got, err := bots.ValidateScopes(nil)
	if err != nil || len(got) != 1 || got[0] != models.ScopeMessagesSend {
		t.Fatalf("default scope: %v %v", got, err)
	}
	got, err = bots.ValidateScopes([]string{"members.read", "messages.read", "members.read"})
	if err != nil || len(got) != 2 {
		t.Fatalf("dedupe: %v %v", got, err)
	}
	if _, err := bots.ValidateScopes([]string{"admin"}); err == nil {
		t.Fatal("unknown scope must be refused")
	}
}

func TestBotsValidate_WebhookURL(t *testing.T) {
	cases := []struct {
		url string
		dev bool
		ok  bool
	}{
		{"", false, true},
		{"https://bot.example.com/hook", false, true},
		{"http://bot.example.com/hook", false, false},
		{"http://localhost:9000/hook", false, false},
		{"http://localhost:9000/hook", true, true},
		{"http://127.0.0.1:9000", true, true},
		{"http://10.0.0.1/x", true, false},
		{"https://user:pw@example.com", false, false},
		{"ftp://example.com", false, false},
		{"javascript:alert(1)", false, false},
		{"https://", false, false},
	}
	for _, c := range cases {
		err := bots.ValidateWebhookURL(c.url, c.dev)
		if (err == nil) != c.ok {
			t.Errorf("%q dev=%v: ok=%v, err=%v", c.url, c.dev, c.ok, err)
		}
	}
}

func TestBotsValidate_Buttons(t *testing.T) {
	good := [][]models.Button{{{Label: "Yes", CustomID: "yes", Style: "primary"}, {Label: "Docs", URL: "https://example.com"}}}
	out, err := bots.ValidateMessage("hi", good)
	if err != nil || out[0][0].Style != models.ButtonPrimary {
		t.Fatalf("good buttons refused: %v", err)
	}
	if out2, _ := bots.ValidateMessage("hi", [][]models.Button{{{Label: "x", CustomID: "x", Style: "weird"}}}); out2[0][0].Style != models.ButtonSecondary {
		t.Fatal("unknown style should fall back to secondary")
	}
	bad := map[string][][]models.Button{
		"both id and url": {{{Label: "x", CustomID: "a", URL: "https://e.com"}}},
		"neither":         {{{Label: "x"}}},
		"javascript url":  {{{Label: "x", URL: "javascript:alert(1)"}}},
		"data url":        {{{Label: "x", URL: "data:text/html,hi"}}},
		"empty label":     {{{Label: "  ", CustomID: "a"}}},
		"long label":      {{{Label: strings.Repeat("a", 81), CustomID: "a"}}},
		"long id":         {{{Label: "x", CustomID: strings.Repeat("a", 101)}}},
		"space in id":     {{{Label: "x", CustomID: "a b"}}},
		"duplicate id":    {{{Label: "x", CustomID: "a"}, {Label: "y", CustomID: "a"}}},
		"empty row":       {{}},
		"too many rows":   {{{Label: "1", CustomID: "1"}}, {{Label: "2", CustomID: "2"}}, {{Label: "3", CustomID: "3"}}, {{Label: "4", CustomID: "4"}}, {{Label: "5", CustomID: "5"}}, {{Label: "6", CustomID: "6"}}},
		"too many cols":   {{{Label: "1", CustomID: "1"}, {Label: "2", CustomID: "2"}, {Label: "3", CustomID: "3"}, {Label: "4", CustomID: "4"}, {Label: "5", CustomID: "5"}, {Label: "6", CustomID: "6"}}},
	}
	for name, rows := range bad {
		if _, err := bots.ValidateMessage("hi", rows); err == nil {
			t.Errorf("%s: should be refused", name)
		}
	}
	if _, err := bots.ValidateMessage("", nil); err == nil {
		t.Error("an empty message must be refused")
	}
	if _, err := bots.ValidateMessage(strings.Repeat("a", 4001), nil); err == nil {
		t.Error("text over the limit must be refused")
	}
	if _, err := bots.ValidateMessage("bad\x00byte", nil); err == nil {
		t.Error("control characters must be refused")
	}
}

func TestBotsValidate_Keyboard(t *testing.T) {
	k := &models.Keyboard{Rows: [][]models.Button{{{Label: "A", CustomID: "a"}, {Label: "B", CustomID: "b"}}}, Placeholder: "Pick"}
	if err := bots.ValidateKeyboard(k); err != nil {
		t.Fatal(err)
	}
	if err := bots.ValidateKeyboard(&models.Keyboard{Rows: [][]models.Button{{{Label: "A", URL: "https://e.com"}}}}); err == nil {
		t.Fatal("keyboard buttons are callbacks only")
	}
	if err := bots.ValidateKeyboard(&models.Keyboard{}); err == nil {
		t.Fatal("empty keyboard must be refused")
	}
	if err := bots.ValidateKeyboard(&models.Keyboard{Rows: k.Rows, Placeholder: strings.Repeat("p", 65)}); err == nil {
		t.Fatal("long placeholder must be refused")
	}
}

func TestBotsValidate_CommandDefinitions(t *testing.T) {
	ok := &models.BotCommand{Name: "roll", Description: "Roll dice", Options: []models.CommandOption{
		{Name: "sides", Description: "n", Type: models.OptionInteger, Required: true, Choices: []models.CommandChoice{{Name: "d6", Value: "6"}, {Name: "d20", Value: "20"}}},
		{Name: "note", Description: "n", Type: models.OptionString},
	}}
	if err := bots.ValidateCommand(ok); err != nil {
		t.Fatal(err)
	}
	bad := map[string]*models.BotCommand{
		"upper name":     {Name: "Roll", Description: "d"},
		"no description": {Name: "x", Description: ""},
		"unknown type":   {Name: "x", Description: "d", Options: []models.CommandOption{{Name: "o", Description: "d", Type: "object"}}},
		"required after": {Name: "x", Description: "d", Options: []models.CommandOption{{Name: "a", Description: "d", Type: "string"}, {Name: "b", Description: "d", Type: "string", Required: true}}},
		"duplicate opt":  {Name: "x", Description: "d", Options: []models.CommandOption{{Name: "a", Description: "d", Type: "string"}, {Name: "a", Description: "d", Type: "string"}}},
		"bad choice":     {Name: "x", Description: "d", Options: []models.CommandOption{{Name: "a", Description: "d", Type: "integer", Choices: []models.CommandChoice{{Name: "n", Value: "abc"}}}}},
		"bool choices":   {Name: "x", Description: "d", Options: []models.CommandOption{{Name: "a", Description: "d", Type: "boolean", Choices: []models.CommandChoice{{Name: "n", Value: "true"}}}}},
	}
	for name, c := range bad {
		if err := bots.ValidateCommand(c); err == nil {
			t.Errorf("%s: should be refused", name)
		}
	}
	if err := bots.ValidateCommands([]*models.BotCommand{{Name: "a", Description: "d"}, {Name: "a", Description: "d"}}); err == nil {
		t.Error("duplicate command names must be refused")
	}
	many := make([]*models.BotCommand, 101)
	for i := range many {
		many[i] = &models.BotCommand{Name: "c" + strings.Repeat("x", i%5) + string(rune('a'+i%26)), Description: "d"}
	}
	if err := bots.ValidateCommands(many); err == nil {
		t.Error("more than 100 commands must be refused")
	}
}

func TestBotsValidate_Invocation(t *testing.T) {
	cmd := &models.BotCommand{Name: "roll", Options: []models.CommandOption{
		{Name: "sides", Type: models.OptionInteger, Required: true, Choices: []models.CommandChoice{{Name: "d6", Value: "6"}, {Name: "d20", Value: "20"}}},
		{Name: "loud", Type: models.OptionBoolean},
		{Name: "note", Type: models.OptionString},
	}}
	got, err := bots.ValidateInvocation(cmd, map[string]any{"sides": float64(20), "loud": true, "note": "hi"})
	if err != nil || got["sides"] != int64(20) || got["loud"] != true || got["note"] != "hi" {
		t.Fatalf("valid invocation refused or mistyped: %v %v", got, err)
	}
	if got, err := bots.ValidateInvocation(cmd, map[string]any{"sides": "6"}); err != nil || got["sides"] != int64(6) {
		t.Fatalf("string numbers are accepted: %v %v", got, err)
	}
	bad := map[string]map[string]any{
		"missing required": {},
		"not a choice":     {"sides": float64(7)},
		"wrong type":       {"sides": "abc"},
		"unknown option":   {"sides": float64(6), "evil": "x"},
		"object value":     {"sides": float64(6), "note": map[string]any{"a": 1}},
		"too long":         {"sides": float64(6), "note": strings.Repeat("a", 2001)},
	}
	for name, in := range bad {
		if _, err := bots.ValidateInvocation(cmd, in); err == nil {
			t.Errorf("%s: should be refused", name)
		}
	}
}
