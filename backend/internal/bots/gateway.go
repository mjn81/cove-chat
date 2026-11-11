package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/logger"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// GatewaySubprotocolPrefix lets a client that cannot set headers (a browser) offer the bot token as a WebSocket
// subprotocol, "cove-bot.<token>", instead of the Authorization header. Tokens never travel in the URL.
const GatewaySubprotocolPrefix = "cove-bot."

const gatewayHeartbeat = 30 * time.Second

// gwSession is one open gateway connection of a bot.
type gwSession struct {
	id   string
	conn *websocket.Conn
	out  chan []byte
	once sync.Once
	done chan struct{}
}

// push queues a frame without blocking; a connection that cannot keep up loses events (the bot can re-read state
// through the REST API) instead of stalling the dispatcher.
func (s *gwSession) push(frame []byte) bool {
	select {
	case s.out <- frame:
		return true
	default:
		return false
	}
}

func (s *gwSession) close(reason string) {
	s.once.Do(func() {
		close(s.done)
		_ = s.conn.Close(websocket.StatusPolicyViolation, reason)
	})
}

// botToken reads the bot token from `Authorization: Bot <token>` or the cove-bot.<token> subprotocol.
func botToken(r *http.Request) (token, subprotocol string) {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bot ") {
		return strings.TrimSpace(h[4:]), ""
	}
	for _, p := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		p = strings.TrimSpace(p)
		if rest, ok := strings.CutPrefix(p, GatewaySubprotocolPrefix); ok && rest != "" {
			return rest, p
		}
	}
	return "", ""
}

// BotToken extracts the bot token of a REST request (`Authorization: Bot <token>`).
func BotToken(r *http.Request) string {
	t, _ := botToken(r)
	return t
}

// GatewayHandler serves the bot WebSocket (mounted at /gateway/bot). Authentication is the handshake itself; the
// first frame is hello. The gateway is one-way: bots act through the REST API, and frames they send are ignored.
func (d *Dispatcher) GatewayHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !d.enabled() {
			apistd.WriteError(w, http.StatusForbidden, apistd.CodeBotsDisabled, "bots are switched off on this server", nil)
			return
		}
		token, proto := botToken(r)
		bot, user, err := d.cfg.Store.AuthenticateBot(token)
		if err != nil {
			apistd.WriteError(w, http.StatusUnauthorized, apistd.CodeUnauthorized, "unauthorized", nil)
			return
		}
		if bot.Disabled {
			apistd.WriteError(w, http.StatusForbidden, apistd.CodeForbidden, "this bot is disabled", nil)
			return
		}
		d.mu.RLock()
		open := len(d.sessions[bot.ID])
		d.mu.RUnlock()
		if open >= maxGatewaySessions {
			apistd.WriteError(w, http.StatusConflict, apistd.CodeConflict, "too many open connections for this bot", nil)
			return
		}
		opts := &websocket.AcceptOptions{}
		if proto != "" {
			opts.Subprotocols = []string{proto}
		}
		conn, err := websocket.Accept(w, r, opts)
		if err != nil {
			logger.Warnf("bots: gateway upgrade failed for bot %s: %v", bot.ID, err)
			return
		}
		conn.SetReadLimit(64 << 10)
		s := &gwSession{id: uuid.New().String(), conn: conn, out: make(chan []byte, 256), done: make(chan struct{})}
		d.mu.Lock()
		d.sessions[bot.ID] = append(d.sessions[bot.ID], s)
		d.mu.Unlock()
		d.wg.Add(1)
		defer d.wg.Done()
		defer func() {
			d.removeSession(bot.ID, s)
			s.close("goodbye")
		}()

		installs, _ := d.cfg.Store.ListBotInstalls(bot.ID)
		channels := make([]string, 0, len(installs))
		for _, in := range installs {
			channels = append(channels, in.ChannelID)
		}
		hello, _ := json.Marshal(wire{ID: uuid.New().String(), Type: "hello", BotID: bot.ID, Payload: mustJSON(map[string]any{
			"session_id":   s.id,
			"heartbeat_ms": gatewayHeartbeat.Milliseconds(),
			"bot":          Author{ID: user.ID, Username: user.Username, IsBot: true},
			"channels":     channels,
			"api_version":  apistd.APIVersion,
		})})
		s.out <- hello

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		go d.writeLoop(ctx, s)
		// Reading is required so the library answers pings and notices a close; the content is ignored.
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				return
			}
		}
	})
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func (d *Dispatcher) removeSession(botID string, s *gwSession) {
	d.mu.Lock()
	defer d.mu.Unlock()
	list := d.sessions[botID]
	for i, x := range list {
		if x == s {
			d.sessions[botID] = append(list[:i:i], list[i+1:]...)
			break
		}
	}
	if len(d.sessions[botID]) == 0 {
		delete(d.sessions, botID)
	}
}

func (d *Dispatcher) writeLoop(ctx context.Context, s *gwSession) {
	tick := time.NewTicker(gatewayHeartbeat)
	defer tick.Stop()
	defer s.close("write loop ended")
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.done:
			return
		case frame := <-s.out:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := s.conn.Write(wctx, websocket.MessageText, frame)
			cancel()
			if err != nil {
				return
			}
		case <-tick.C:
			pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := s.conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
