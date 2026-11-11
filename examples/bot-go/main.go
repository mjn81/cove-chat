// Command bot-go is a small example bot for a Cove server (docs/bots-api.md).
//
// It shows every part of the Bot API a typical bot needs:
//
//   - connecting to the gateway (or receiving signed webhooks) and reconnecting with backoff,
//   - registering slash commands (/ping, /help, /roll, /poll, /counter, /menu),
//   - answering interactions with a message, an edited message (update_message) and an acknowledgement,
//   - buttons on a message (a counter and a poll) and the keyboard-replacing action menu,
//   - greeting a person who starts a chat with it from Explore (bot_start) and replying to mentions.
//
// Configuration comes from the environment, or from a .env.local file next to the program (written by the dev seed,
// `make dev-seed-bots`; never committed):
//
//	COVE_URL             base URL of the server, e.g. https://chat.example.com (required)
//	COVE_BOT_TOKEN       the token shown once when the bot was created (required)
//	COVE_WEBHOOK_ADDR    listen address (e.g. :8080) to receive webhooks instead of using the gateway
//	COVE_WEBHOOK_SECRET  the webhook signing secret (required with COVE_WEBHOOK_ADDR)
//
// The token and secret are read from the environment only and are never logged.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"time"

	"example.com/cove-bot/internal/botspec"

	"github.com/coder/websocket"
)

// ---- API client -------------------------------------------------------------------------------------------------- //

type client struct {
	base  *url.URL
	token string
	http  *http.Client
}

// call sends a JSON request authenticated as the bot and decodes a JSON answer into out (when not nil).
func (c *client) call(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base.JoinPath(path).String(), body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bot "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Cove-Client", "examplebot/0.2 (api 2)")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("%s %s: %s: %s", method, path, resp.Status, strings.TrimSpace(string(msg)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// ---- Wire types (only the fields this bot uses) ------------------------------------------------------------------ //

type button struct {
	Label    string `json:"label"`
	Style    string `json:"style,omitempty"`
	CustomID string `json:"custom_id,omitempty"`
	URL      string `json:"url,omitempty"`
}

type message struct {
	Text    string     `json:"text,omitempty"`
	Buttons [][]button `json:"buttons,omitempty"`
}

type event struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type interaction struct {
	ID        string `json:"id"`
	Token     string `json:"token"`
	Type      string `json:"type"` // command | button | keyboard
	ChannelID string `json:"channel_id"`
	MessageID string `json:"message_id"`
	User      struct {
		Username string `json:"username"`
	} `json:"user"`
	Data struct {
		Name     string         `json:"name"`
		Options  map[string]any `json:"options"`
		CustomID string         `json:"custom_id"`
	} `json:"data"`
}

type incoming struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	Content   string `json:"content"`
	Mentioned bool   `json:"mentioned"`
	Author    struct {
		Username string `json:"username"`
		IsBot    bool   `json:"is_bot"`
	} `json:"author"`
}

type started struct {
	ChannelID string `json:"channel_id"`
	User      struct {
		Username string `json:"username"`
	} `json:"user"`
}

// ---- The bot ----------------------------------------------------------------------------------------------------- //

type poll struct {
	question string
	votes    map[string]string // username -> yes | no
}

type bot struct {
	api *client

	mu       sync.Mutex
	counters map[string]int   // message id -> count (in memory: a real bot would persist state)
	polls    map[string]*poll // message id -> poll
}

func (b *bot) registerCommands(ctx context.Context) error {
	return b.api.call(ctx, http.MethodPut, "/api/bots/me/commands", botspec.Commands, nil)
}

// answer replies to an interaction. kind is "message", "update_message" or "ack". It returns the id of the message
// the answer created or changed (empty for an ack).
func (b *bot) answer(ctx context.Context, in interaction, kind string, m message) string {
	body := map[string]any{"type": kind, "text": m.Text, "buttons": m.Buttons}
	var out struct {
		ID string `json:"id"`
	}
	path := "/api/interactions/" + in.ID + "/" + in.Token + "/callback"
	if err := b.api.call(ctx, http.MethodPost, path, body, &out); err != nil {
		log.Printf("answering interaction %s: %v", in.ID, err)
	}
	return out.ID
}

func (b *bot) say(ctx context.Context, channelID string, m message) {
	if err := b.api.call(ctx, http.MethodPost, "/api/bots/me/channels/"+channelID+"/messages", m, nil); err != nil {
		log.Printf("posting in %s: %v", channelID, err)
	}
}

func (b *bot) setMenu(ctx context.Context, channelID string) {
	if err := b.api.call(ctx, http.MethodPut, "/api/bots/me/channels/"+channelID+"/keyboard", botspec.Menu, nil); err != nil {
		log.Printf("setting keyboard: %v", err)
	}
}

func counterMessage(n int) message {
	return message{
		Text:    fmt.Sprintf("Count: %d", n),
		Buttons: [][]button{{{Label: "+1", Style: "primary", CustomID: "inc"}, {Label: "Reset", Style: "danger", CustomID: "reset"}}},
	}
}

func pollMessage(p *poll) message {
	var yes, no int
	for _, v := range p.votes {
		if v == "yes" {
			yes++
		} else {
			no++
		}
	}
	return message{
		Text:    fmt.Sprintf("Poll: %s\nYes: %d · No: %d", p.question, yes, no),
		Buttons: [][]button{{{Label: "Yes", Style: "primary", CustomID: "vote:yes"}, {Label: "No", CustomID: "vote:no"}}},
	}
}

const helpText = "I can: /ping, /roll <sides>, /poll <question>, /counter and /menu (an action menu that replaces your keyboard). " +
	"Buttons on my messages talk back to me too."

func roll(sides int) int {
	if sides < 2 {
		sides = 6
	}
	return rand.Intn(sides) + 1
}

func (b *bot) onInteraction(ctx context.Context, in interaction) {
	switch in.Type {
	case "command":
		switch in.Data.Name {
		case "ping":
			b.answer(ctx, in, "message", message{Text: "Pong! Hello, " + in.User.Username + "."})
		case "help":
			b.answer(ctx, in, "message", message{Text: helpText})
		case "roll":
			sides, _ := in.Data.Options["sides"].(float64)
			b.answer(ctx, in, "message", message{Text: fmt.Sprintf("%s rolled a %d (d%d).", in.User.Username, roll(int(sides)), int(sides))})
		case "poll":
			q, _ := in.Data.Options["question"].(string)
			p := &poll{question: q, votes: map[string]string{}}
			if id := b.answer(ctx, in, "message", pollMessage(p)); id != "" {
				b.mu.Lock()
				b.polls[id] = p
				b.mu.Unlock()
			}
		case "counter":
			b.answer(ctx, in, "message", counterMessage(0))
		case "menu":
			b.answer(ctx, in, "ack", message{})
			b.setMenu(ctx, in.ChannelID)
		}
	case "button":
		b.onButton(ctx, in)
	case "keyboard":
		switch in.Data.CustomID {
		case "roll6":
			b.answer(ctx, in, "message", message{Text: fmt.Sprintf("%s rolled a %d.", in.User.Username, roll(6))})
		case "roll20":
			b.answer(ctx, in, "message", message{Text: fmt.Sprintf("%s rolled a %d.", in.User.Username, roll(20))})
		case "ping":
			b.answer(ctx, in, "message", message{Text: "Pong!"})
		case "help":
			b.answer(ctx, in, "message", message{Text: helpText})
		case "hide":
			b.answer(ctx, in, "ack", message{})
			if err := b.api.call(ctx, http.MethodDelete, "/api/bots/me/channels/"+in.ChannelID+"/keyboard", nil, nil); err != nil {
				log.Printf("removing keyboard: %v", err)
			}
		}
	}
}

// onButton handles presses on the buttons of this bot's messages (the welcome message, the counter and polls).
func (b *bot) onButton(ctx context.Context, in interaction) {
	id := in.Data.CustomID
	switch {
	case id == "ping":
		b.answer(ctx, in, "message", message{Text: "Pong! Hello, " + in.User.Username + "."})
	case id == "roll20":
		b.answer(ctx, in, "message", message{Text: fmt.Sprintf("%s rolled a %d.", in.User.Username, roll(20))})
	case strings.HasPrefix(id, "vote:"):
		b.mu.Lock()
		p := b.polls[in.MessageID]
		if p != nil {
			p.votes[in.User.Username] = strings.TrimPrefix(id, "vote:")
		}
		b.mu.Unlock()
		if p == nil {
			b.answer(ctx, in, "message", message{Text: "That poll is from before I restarted; start a new one with /poll."})
			return
		}
		// update_message edits the message the button was on.
		b.answer(ctx, in, "update_message", pollMessage(p))
	default: // inc | reset
		b.mu.Lock()
		n := b.counters[in.MessageID]
		if id == "inc" {
			n++
		} else {
			n = 0
		}
		b.counters[in.MessageID] = n
		b.mu.Unlock()
		b.answer(ctx, in, "update_message", counterMessage(n))
	}
}

func (b *bot) onMessage(ctx context.Context, m incoming) {
	// Without the messages.read scope the bot only gets messages that mention it or reply to it.
	if !m.Mentioned || m.Author.IsBot {
		return
	}
	b.say(ctx, m.ChannelID, message{Text: "You called, " + m.Author.Username + "? " + helpText})
}

// onStart greets a person who started a chat from Explore and offers the action menu in that DM.
func (b *bot) onStart(ctx context.Context, s started) {
	b.say(ctx, s.ChannelID, message{
		Text:    "Hi " + s.User.Username + "! I'm " + botspec.Name + ". " + helpText,
		Buttons: [][]button{{{Label: "Ping", Style: "primary", CustomID: "ping"}, {Label: "Roll d20", CustomID: "roll20"}}},
	})
	b.setMenu(ctx, s.ChannelID)
}

// handle dispatches one event (from the gateway or a webhook). Unknown events are ignored on purpose: a newer server
// may send more.
func (b *bot) handle(ctx context.Context, ev event) {
	switch ev.Type {
	case "interaction_create":
		var in interaction
		if json.Unmarshal(ev.Payload, &in) == nil {
			b.onInteraction(ctx, in)
		}
	case "message_create":
		var m incoming
		if json.Unmarshal(ev.Payload, &m) == nil {
			b.onMessage(ctx, m)
		}
	case "bot_start":
		var s started
		if json.Unmarshal(ev.Payload, &s) == nil {
			b.onStart(ctx, s)
		}
	}
}

// ---- Transport: gateway ------------------------------------------------------------------------------------------ //

func (b *bot) runGateway(ctx context.Context) {
	wsURL := *b.api.base
	wsURL.Scheme = map[string]string{"https": "wss", "http": "ws"}[wsURL.Scheme]
	wsURL.Path = "/gateway/bot"
	backoff := time.Second
	for ctx.Err() == nil {
		err := b.gatewayOnce(ctx, wsURL.String())
		log.Printf("gateway closed: %v (reconnecting in %s)", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (b *bot) gatewayOnce(ctx context.Context, wsURL string) error {
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bot " + b.api.token}}})
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)
	log.Print("connected to the gateway")
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var ev event
		if json.Unmarshal(data, &ev) != nil {
			continue
		}
		go b.handle(ctx, ev)
	}
}

// ---- Transport: webhook ------------------------------------------------------------------------------------------ //

// verifySignature checks X-Cove-Signature = "sha256=" + hex(HMAC-SHA256(secret, timestamp + "." + body)) in constant
// time and rejects timestamps more than five minutes old.
func verifySignature(secret, timestamp, signature string, body []byte) bool {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || time.Since(time.Unix(ts, 0)).Abs() > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(signature))
}

func (b *bot) webhookHandler(ctx context.Context, secret string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil || !verifySignature(secret, r.Header.Get("X-Cove-Timestamp"), r.Header.Get("X-Cove-Signature"), body) {
			http.Error(w, "bad signature", http.StatusUnauthorized)
			return
		}
		var ev event
		if json.Unmarshal(body, &ev) != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		// Answer fast (the server waits 5 seconds) and do the work in the background; the server retries on 5xx.
		w.WriteHeader(http.StatusNoContent)
		go b.handle(ctx, ev)
	})
}

// ---- main -------------------------------------------------------------------------------------------------------- //

// loadDotEnv reads KEY=VALUE lines from path into the environment without overriding variables that are already set.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

func main() {
	loadDotEnv(".env.local")
	base, err := url.Parse(os.Getenv("COVE_URL"))
	token := os.Getenv("COVE_BOT_TOKEN")
	if err != nil || base.Host == "" || token == "" {
		log.Fatal("set COVE_URL (for example https://chat.example.com) and COVE_BOT_TOKEN, or run `make dev-seed-bots` for a local server")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	b := &bot{
		api:      &client{base: base, token: token, http: &http.Client{Timeout: 15 * time.Second}},
		counters: map[string]int{}, polls: map[string]*poll{},
	}
	if err := b.registerCommands(ctx); err != nil {
		log.Fatalf("registering commands: %v", err)
	}
	log.Print("commands registered")

	if addr := os.Getenv("COVE_WEBHOOK_ADDR"); addr != "" {
		secret := os.Getenv("COVE_WEBHOOK_SECRET")
		if secret == "" {
			log.Fatal("COVE_WEBHOOK_SECRET is required with COVE_WEBHOOK_ADDR")
		}
		srv := &http.Server{Addr: addr, Handler: b.webhookHandler(ctx, secret), ReadHeaderTimeout: 5 * time.Second}
		go func() {
			<-ctx.Done()
			_ = srv.Shutdown(context.Background())
		}()
		log.Printf("listening for webhooks on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
		return
	}
	b.runGateway(ctx)
}
