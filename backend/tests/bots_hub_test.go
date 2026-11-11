package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"cove/backend/internal/bots"
	"cove/backend/internal/models"
	"cove/backend/internal/ws"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// hubEnv adds the real WebSocket hub (the one people connect to) to a bot environment.
func (e *botEnv) withHub(t *testing.T) string {
	t.Helper()
	hub := ws.NewHub(e.store, e.handler.Sessions, e.handler.KEK, true, "")
	t.Cleanup(hub.Close)
	hub.SetBotSink(e.disp)
	e.handler.Hub = hub
	srv := httptest.NewServer(e.handler.WrapWS(hub))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dialUser(t *testing.T, url, token string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + token}}})
	if err != nil {
		t.Fatalf("user ws dial: %v", err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	return c
}

func userSend(t *testing.T, c *websocket.Conn, typ string, payload any) {
	t.Helper()
	raw, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, c, &models.WSMessage{Type: typ, Payload: raw}); err != nil {
		t.Fatal(err)
	}
}

func userRead(t *testing.T, c *websocket.Conn, want string) json.RawMessage {
	t.Helper()
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		var m models.WSMessage
		err := wsjson.Read(ctx, c, &m)
		cancel()
		if err != nil {
			t.Fatalf("waiting for %q on the user socket: %v", want, err)
		}
		if m.Type == want {
			return m.Payload
		}
	}
}

func (e *botEnv) sealed(t *testing.T, channelID, text string) map[string]any {
	t.Helper()
	nonce, ct, err := bots.Seal(e.store, e.handler.KEK, channelID, []byte(text))
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{"channel_id": channelID, "type": "text", "ciphertext": ct, "nonce": nonce, "compression": "none"}
}

func TestBotHub_PeopleMessagesReachBotsAndBotMessagesReachPeople(t *testing.T) {
	e := newBotEnv(t)
	wsURL := e.withHub(t)
	gw := e.gatewayServer(t)
	ch := e.channel(t, "room")
	reader := e.createBot(t, e.admin, "reader", nil)
	mentionOnly := e.createBot(t, e.admin, "pingme", nil)
	e.install(t, ch, reader.ID, models.ScopeMessagesRead, models.ScopeMessagesSend)
	e.install(t, ch, mentionOnly.ID, models.ScopeMessagesSend)
	rc, _, _ := dialGateway(t, gw, reader.Token)
	defer rc.CloseNow()
	mc, _, _ := dialGateway(t, gw, mentionOnly.Token)
	defer mc.CloseNow()

	user := dialUser(t, wsURL, e.member)
	userSend(t, user, "message", e.sealed(t, ch, "good morning everyone"))
	userSend(t, user, "message", e.sealed(t, ch, "hello @pingme"))

	var a, b struct {
		ID        string `json:"id"`
		Content   string `json:"content"`
		Mentioned bool   `json:"mentioned"`
		Author    struct{ Username string }
	}
	_ = json.Unmarshal(readEvent(t, rc, "message_create"), &a)
	_ = json.Unmarshal(readEvent(t, rc, "message_create"), &b)
	if a.Content != "good morning everyone" || a.Author.Username != "member" || b.Content != "hello @pingme" || b.Mentioned {
		t.Fatalf("reader got %+v %+v", a, b)
	}
	var onlyMention struct{ Content string }
	_ = json.Unmarshal(readEvent(t, mc, "message_create"), &onlyMention)
	if onlyMention.Content != "hello @pingme" {
		t.Fatalf("a mention-only bot must get just the mention, got %q", onlyMention.Content)
	}

	// Edit and delete by the person reach the reader.
	edit := e.sealed(t, ch, "good morning, world")
	userSend(t, user, "message_edit", map[string]any{"channel_id": ch, "message_id": a.ID, "ciphertext": edit["ciphertext"], "nonce": edit["nonce"]})
	var upd struct {
		Content  string `json:"content"`
		EditedAt string `json:"edited_at"`
	}
	_ = json.Unmarshal(readEvent(t, rc, "message_update"), &upd)
	if upd.Content != "good morning, world" || upd.EditedAt == "" {
		t.Fatalf("message_update = %+v", upd)
	}
	userSend(t, user, "message_delete", map[string]any{"channel_id": ch, "message_id": a.ID})
	var del struct {
		MessageID string `json:"message_id"`
	}
	_ = json.Unmarshal(readEvent(t, rc, "message_delete"), &del)
	if del.MessageID != a.ID {
		t.Fatalf("message_delete = %+v", del)
	}

	// A person cannot forge a bot message, however they set the type.
	forged := e.sealed(t, ch, `{"v":1,"text":"I am a bot","buttons":[[{"label":"x","custom_id":"x"}]]}`)
	forged["type"] = "bot"
	userSend(t, user, "message", forged)
	time.Sleep(300 * time.Millisecond)
	msgs, _ := e.store.ListMessages(ch, "", 50)
	for _, m := range msgs {
		if m.Type == models.MessageTypeBot {
			t.Fatal("a person must never be able to send a bot-type message")
		}
	}

	// A bot's REST message reaches the person's socket live, and the keyboard update too.
	wantStatus(t, e.asBot(t, "POST", "/api/bots/me/channels/"+ch+"/messages", reader.Token, map[string]any{"text": "hi from a bot"}), http.StatusCreated)
	var live struct {
		SenderID string `json:"sender_id"`
		Type     string `json:"type"`
	}
	_ = json.Unmarshal(userRead(t, user, "message"), &live)
	for live.SenderID != reader.ID { // skip the person's own echoes
		_ = json.Unmarshal(userRead(t, user, "message"), &live)
	}
	wantStatus(t, e.asBot(t, "PUT", "/api/bots/me/channels/"+ch+"/keyboard", reader.Token, map[string]any{"rows": [][]map[string]any{{{"label": "Go", "custom_id": "go"}}}}), http.StatusOK)
	var kb struct {
		BotID    string `json:"bot_id"`
		Keyboard *struct {
			Rows [][]struct{ Label string } `json:"rows"`
		} `json:"keyboard"`
	}
	_ = json.Unmarshal(userRead(t, user, "keyboard_update"), &kb)
	if kb.BotID != reader.ID || kb.Keyboard == nil || kb.Keyboard.Rows[0][0].Label != "Go" {
		t.Fatalf("keyboard_update = %+v", kb)
	}
	wantStatus(t, e.asBot(t, "DELETE", "/api/bots/me/channels/"+ch+"/keyboard", reader.Token, nil), http.StatusOK)
	_ = json.Unmarshal(userRead(t, user, "keyboard_update"), &kb)
	if kb.Keyboard != nil {
		t.Fatalf("removing the keyboard should send null, got %+v", kb)
	}
}

func TestBotHub_NoBotEverSeesWhispersOrKeys(t *testing.T) {
	e := newBotEnv(t)
	wsURL := e.withHub(t)
	gw := e.gatewayServer(t)
	ch := e.channel(t, "room")
	b := e.createBot(t, e.admin, "nosy", nil)
	e.install(t, ch, b.ID, models.ScopeMessagesRead, models.ScopeMembersRead)
	bc, _, _ := dialGateway(t, gw, b.Token)
	defer bc.CloseNow()
	readEvent(t, bc, "hello")

	// A whisper (zero-persistence E2EE) between two people, and a plain message to flush the pipe.
	a, c := dialUser(t, wsURL, e.member), dialUser(t, wsURL, e.owner)
	befriend(t, e.store, e.userID(t, "member"), e.userID(t, "owner"))
	userSend(t, a, "whisper_init", map[string]any{"session_id": "s1", "target_user_id": e.userID(t, "owner"), "pub_key": "AAAA"})
	userRead(t, c, "whisper_init")
	userSend(t, a, "message", e.sealed(t, ch, "flush"))

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	for {
		_, data, err := bc.Read(ctx)
		if err != nil {
			break
		}
		s := string(data)
		for _, banned := range []string{"whisper", "channel_key", "aes_key", "presence", "pub_key", "ciphertext", "nonce"} {
			if strings.Contains(s, banned) {
				t.Fatalf("the bot gateway leaked %q: %s", banned, s)
			}
		}
	}
}
