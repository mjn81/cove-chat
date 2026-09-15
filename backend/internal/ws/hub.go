package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/store"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// Hub manages all active WebSocket connections and broadcasts messages.
type Hub struct {
	mu      sync.RWMutex
	clients map[string][]*Client // key: userID, value: slice of active connections

	store    *store.Store
	sessions *auth.SessionStore
	kek      []byte

	broadcast chan *envelope
	closed    bool
}

// Client represents a connected WebSocket peer.
type Client struct {
	UserID     string
	Username   string
	RemoteAddr string
	conn       *websocket.Conn
	send       chan *envelope
	hub        *Hub
}

// envelope wraps a wire message with routing metadata.
type envelope struct {
	channelID string
	senderID  string
	msg       *models.WSMessage
}

// NewHub creates and starts a Hub.
func NewHub(s *store.Store, sessions *auth.SessionStore, kek []byte) *Hub {
	h := &Hub{
		clients:   make(map[string][]*Client),
		store:     s,
		sessions:  sessions,
		kek:       kek,
		broadcast: make(chan *envelope, 256),
	}
	go h.run()
	return h
}

// Close gracefully disconnects all active WebSocket clients.
func (h *Hub) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true
	var allClients []*Client
	for _, clientList := range h.clients {
		allClients = append(allClients, clientList...)
	}
	h.clients = make(map[string][]*Client)
	h.mu.Unlock()

	for _, c := range allClients {
		_ = c.conn.Close(websocket.StatusGoingAway, "server shutting down")
	}
}

// run is the Hub's main event loop — dispatches inbound envelopes to the
// correct channel members, one at a time and in the order they were
// submitted. This guarantees clients observe messages, edits, and deletes
// for a given channel in the order they were sent — fanning each envelope
// out in its own goroutine (as before) let goroutine scheduling and
// per-envelope DB latency reorder deliveries, so a fast edit could reach
// clients before the original message.
func (h *Hub) run() {
	for env := range h.broadcast {
		h.dispatch(env)
	}
}

// dispatch delivers one envelope to every member of its channel.
func (h *Hub) dispatch(e *envelope) {
	members, err := h.store.GetChannelMembers(e.channelID)
	if err != nil {
		logger.Warnf("ws: dropping envelope for channel %s: failed to load members: %v", e.channelID, err)
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, m := range members {
		if clients, ok := h.clients[m.UserID]; ok {
			for _, c := range clients {
				select {
				case c.send <- e:
				default:
					logger.Warnf("ws: send buffer full for user %s, dropping envelope", m.UserID)
				}
			}
		}
	}
}

// ServeHTTP upgrades an HTTP request to a WebSocket connection.
// Authentication is via the `nodetalk_session` cookie or a `token` query parameter.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token, _, err := auth.ResolveToken(r)
	if err != nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	session, err := h.sessions.Validate(token)
	if err != nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Allow any origin in development; restrict with OriginPatterns in production.
		InsecureSkipVerify: true,
	})
	if err != nil {
		logger.Warnf("ws: upgrade failed for user %s: %v", session.UserID, err)
		return
	}
	// Set a generous read limit for file/voice payloads (5 MB).
	conn.SetReadLimit(5 << 20)

	client := &Client{
		UserID:     session.UserID,
		Username:   session.Username,
		RemoteAddr: r.RemoteAddr,
		conn:       conn,
		send:       make(chan *envelope, 256), // Increased buffer for high volume
		hub:        h,
	}
	h.register(client)

	// Fetch user to check their status preference
	effectiveStatus := "online"
	isAuto := true
	if u, err := h.store.GetUser(session.UserID); err == nil {
		if u.StatusPreference != "" && u.StatusPreference != "auto" {
			effectiveStatus = u.StatusPreference
			isAuto = false
		}
	}

	_ = h.store.SetPresence(session.UserID, effectiveStatus)
	if isAuto {
		_ = h.store.UpdateUserStatus(session.UserID, effectiveStatus)
	}

	if effectiveStatus != "offline" {
		h.BroadcastPresence(session.UserID, effectiveStatus)
	}

	// Formalize the Read/Write pumps as dedicated goroutines.
	// This ensures that slow network connections don't block the Hub.
	go client.writePump(r.Context())
	client.readPump(r.Context())

	// Cleanup on disconnect
	h.unregister(client)

	h.mu.RLock()
	_, stillConnected := h.clients[session.UserID]
	h.mu.RUnlock()

	if !stillConnected {
		_ = h.store.SetPresence(session.UserID, "offline")
		if u, err := h.store.GetUser(session.UserID); err == nil {
			if u.StatusPreference == "auto" || u.StatusPreference == "" {
				_ = h.store.UpdateUserStatus(session.UserID, "offline")
			}
		}
		h.BroadcastPresence(session.UserID, "offline")
	}
	conn.Close(websocket.StatusNormalClosure, "goodbye")
}

// writePump handles outgoing messages from the Hub to the Client.
func (c *Client) writePump(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close(websocket.StatusAbnormalClosure, "write pump closed")
	}()

	// Push channel keys in background immediately
	go c.writeChannelKeys(ctx, c.hub.store, c.hub.kek)

	for {
		select {
		case <-ctx.Done():
			return
		case env, ok := <-c.send:
			if !ok {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := wsjson.Write(writeCtx, c.conn, env.msg)
			cancel()
			if err != nil {
				return
			}
		case <-ticker.C:
			// Heartbeat
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.conn.Ping(writeCtx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// readPump handles incoming messages from the Client to the Hub.
func (c *Client) readPump(ctx context.Context) {
	defer func() {
		c.conn.Close(websocket.StatusAbnormalClosure, "read pump closed")
	}()

	for {
		var raw models.WSMessage
		if err := wsjson.Read(ctx, c.conn, &raw); err != nil {
			break
		}
		if err := c.handleMessage(ctx, &raw); err != nil {
			logger.Warnf("ws: handle error for %s: %v", c.UserID, err)
		}
	}
}

// BroadcastChannelCreated notifies all connected clients of a user's status change.
func (h *Hub) BroadcastChannelCreated(ch *models.Channel) {
	rawKey, err := h.store.DecryptChannelKey(ch, h.kek)
	if err != nil {
		logger.Errorf("ws: cannot decrypt key for new channel %s: %v", ch.ID, err)
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"channel_id": ch.ID,
		"aes_key":    rawKey,
	})
	msg := &models.WSMessage{Type: "channel_key", Payload: payload}
	env := &envelope{msg: msg}

	members, err := h.store.GetChannelMembers(ch.ID)
	if err != nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, m := range members {
		if clients, ok := h.clients[m.UserID]; ok {
			for _, c := range clients {
				select {
				case c.send <- env:
				default:
				}
			}
		}
	}
}

// SendChannelKey pushes a specific channel's AES key to a specific user.
func (h *Hub) SendChannelKey(channelID, userID string) {
	ch, err := h.store.GetChannel(channelID)
	if err != nil {
		return
	}

	rawKey, err := h.store.DecryptChannelKey(ch, h.kek)
	if err != nil {
		logger.Errorf("ws: cannot decrypt key for channel %s: %v", channelID, err)
		return
	}

	payload, _ := json.Marshal(map[string]any{
		"channel_id": ch.ID,
		"aes_key":    rawKey,
	})
	msg := &models.WSMessage{Type: "channel_key", Payload: payload}
	env := &envelope{msg: msg}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.clients[userID]; ok {
		for _, c := range clients {
			select {
			case c.send <- env:
			default:
			}
		}
	}
}

// BroadcastPresence notifies all connected clients of a user's status change.
func (h *Hub) BroadcastPresence(userID, status string) {
	payload, _ := json.Marshal(map[string]string{
		"user_id": userID,
		"status":  status,
	})
	msg := &models.WSMessage{Type: "presence", Payload: payload}
	env := &envelope{msg: msg}

	h.mu.RLock()
	for _, clients := range h.clients {
		for _, c := range clients {
			select {
			case c.send <- env:
			default:
			}
		}
	}
	h.mu.RUnlock()
}

// BroadcastMemberJoined notifies channel members that a new user has joined,
// and ensures the new member receives the channel's AES key.
func (h *Hub) BroadcastMemberJoined(channelID string, userID string) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"user_id":    userID,
		"type":       "member_joined",
	})
	msg := &models.WSMessage{Type: "channel_update", Payload: payload}
	h.broadcast <- &envelope{channelID: channelID, msg: msg}

	// Also send the AES key to the joining user immediately.
	h.SendChannelKey(channelID, userID)
}

// BroadcastMemberLeft notifies channel members that a user has left or been kicked.
func (h *Hub) BroadcastMemberLeft(channelID string, userID string) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"user_id":    userID,
		"type":       "member_left",
	})
	msg := &models.WSMessage{Type: "channel_update", Payload: payload}
	// Broadcast to remaining members
	h.broadcast <- &envelope{channelID: channelID, msg: msg}

	// Also send targeted notification to the user who left/was kicked 
	// so their UI can react (e.g. remove channel from sidebar)
	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.clients[userID]; ok {
		for _, c := range clients {
			kickPayload, _ := json.Marshal(map[string]any{
				"channel_id": channelID,
				"type":       "kicked",
			})
			kickMsg := &models.WSMessage{Type: "channel_update", Payload: kickPayload}
			select {
			case c.send <- &envelope{msg: kickMsg}:
			default:
			}
		}
	}
}

// BroadcastMemberRoleUpdated notifies all members that a user's role has changed.
// This is important for the affected user to gain/lose permissions in real-time.
func (h *Hub) BroadcastMemberRoleUpdated(channelID string, userID string, role int) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"user_id":    userID,
		"role":       role,
		"type":       "role_updated",
	})
	msg := &models.WSMessage{Type: "channel_update", Payload: payload}
	// Broadcast to everyone in the channel
	h.broadcast <- &envelope{channelID: channelID, msg: msg}

	// Also send targeted notification to the user who was updated
	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.clients[userID]; ok {
		for _, c := range clients {
			select {
			case c.send <- &envelope{msg: msg}:
			default:
			}
		}
	}
}

// BroadcastChannelUpdated notifies all members that channel settings (like Name) have changed.
func (h *Hub) BroadcastChannelUpdated(ch *models.Channel) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": ch.ID,
		"name":       ch.Name,
		"is_private": ch.IsPrivate,
		"type":       "settings_updated",
	})
	msg := &models.WSMessage{Type: "channel_update", Payload: payload}
	h.broadcast <- &envelope{channelID: ch.ID, msg: msg}
}
// BroadcastVoiceState notifies channel members of who is currently in the voice session.
func (h *Hub) BroadcastVoiceState(channelID string, activeUsers []string) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"users":      activeUsers,
	})
	msg := &models.WSMessage{Type: "voice_update", Payload: payload}
	h.broadcast <- &envelope{channelID: channelID, msg: msg}
}

// SendVoiceState notifies a specific user of who is currently in the voice session.
func (h *Hub) SendVoiceState(userID string, channelID string, activeUsers []string) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"users":      activeUsers,
	})
	msg := &models.WSMessage{Type: "voice_update", Payload: payload}
	env := &envelope{msg: msg}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.clients[userID]; ok {
		for _, c := range clients {
			select {
			case c.send <- env:
			default:
			}
		}
	}
}
