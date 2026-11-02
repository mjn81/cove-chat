package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/auth"
	"cove/backend/internal/desktop"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
	"cove/backend/internal/version"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// WhisperSession tracks an active in-memory peer-to-peer E2EE session.
// The Hub only maintains routing state in RAM and NEVER sees keys, plaintext, or stores messages.
type WhisperSession struct {
	ID                string    `json:"session_id"`
	InitiatorID       string    `json:"initiator_id"`
	InitiatorUsername string    `json:"initiator_username"`
	TargetID          string    `json:"target_id"`
	PubKey            string    `json:"pub_key"`
	ExpiryMode        string    `json:"expiry_mode"` // "persistent", "5m", "1h", "24h", "session_only"
	CreatedAt         time.Time `json:"created_at"`
	Pending           bool      `json:"pending"`
}

// voiceUserRemover is the subset of *voice.Router the Hub needs to purge a
// user's voice-call state on disconnect. Declared here (rather than
// importing the voice package's concrete type) to keep ws decoupled from
// voice; wired up via SetVoiceRouter once both are constructed in main.go.
type voiceUserRemover interface {
	RemoveUser(userID string)
}

// RTCSignalHandler is the subset of *rtc.Manager the Hub needs: dispatching
// inbound "call_*" signaling messages, and cleaning up a user's active call
// state on disconnect. Declared here (rather than importing internal/rtc's
// concrete type) for the same reason as voiceUserRemover above — wired up
// via SetRTCManager once both are constructed in main.go.
type RTCSignalHandler interface {
	HandleSignal(userID, username, msgType string, payload json.RawMessage) error
	RemoveUser(userID string)
	ActiveRooms() map[string][]string
}

// Hub manages all active WebSocket connections and broadcasts messages.
type Hub struct {
	mu      sync.RWMutex
	clients map[string][]*Client // key: userID, value: slice of active connections

	whisperMu       sync.RWMutex
	whisperSessions map[string]*WhisperSession // key: session_id

	store    *store.Store
	sessions *auth.SessionStore
	kek      []byte

	voiceRouter voiceUserRemover
	rtc         RTCSignalHandler

	// background counts connection work that still reads the store (the handler goroutine and the channel-key
	// push). Close waits for it, so shutting down never closes the database underneath a live connection.
	background sync.WaitGroup

	isDev          bool
	originPatterns []string

	// minClientVersion is advertised in the hello event; set once at startup, before connections are served.
	minClientVersion string

	broadcast chan *envelope
	closed    bool
}

// Client represents a connected WebSocket peer.
type Client struct {
	UserID     string
	Username   string
	// SessionID is the public id of the session that opened this socket, so terminating that session can close it.
	SessionID  string
	RemoteAddr string
	conn       *websocket.Conn
	send       chan *envelope
	hub        *Hub
	// limiter throttles client-originated events so one connection cannot flood the hub.
	limiter *tokenBucket
}

// envelope wraps a wire message with routing metadata.
type envelope struct {
	channelID string
	senderID  string
	msg       *models.WSMessage
}

// NewHub creates and starts a Hub. isDev relaxes WebSocket Origin
// verification for local development; in production, origin patterns are
// derived from frontendOrigin (a comma-separated list, same format as the
// HTTP CORS config) so the handshake only accepts the deployed frontend(s)
// as defense-in-depth against cross-site WebSocket hijacking.
func NewHub(s *store.Store, sessions *auth.SessionStore, kek []byte, isDev bool, frontendOrigin string) *Hub {
	h := &Hub{
		clients:         make(map[string][]*Client),
		whisperSessions: make(map[string]*WhisperSession),
		store:           s,
		sessions:        sessions,
		kek:             kek,
		isDev:           isDev,
		originPatterns:  append(originPatternsFrom(frontendOrigin), desktop.Origins...),
		broadcast:       make(chan *envelope, 256),
	}
	go h.run()
	return h
}

// SetMinClientVersion sets the minimum client version advertised in the hello event. Call before serving.
func (h *Hub) SetMinClientVersion(v string) {
	h.minClientVersion = v
}

// helloMessage builds the first event of every connection: the same version/capability block as GET
// /api/version, so a client can gate features and detect a mismatch without an extra request.
func (h *Hub) helloMessage() *models.WSMessage {
	payload, _ := json.Marshal(apistd.ServerInfo{
		Version:          version.Version,
		APIVersion:       apistd.APIVersion,
		MinClientVersion: h.minClientVersion,
		Capabilities:     apistd.Capabilities(h.rtc != nil),
	})
	return &models.WSMessage{Type: "hello", Payload: payload}
}

// SetVoiceRouter wires the voice router in after construction (NewRouter
// itself takes the Hub as its VoiceStateNotifier, so the two can't be built
// in one step). Once set, a user's last WS connection dropping also purges
// their voice-call state — see unregister() in client.go.
func (h *Hub) SetVoiceRouter(r voiceUserRemover) {
	h.voiceRouter = r
}

// SetRTCManager wires the WebRTC group-calling SFU in after construction.
func (h *Hub) SetRTCManager(r RTCSignalHandler) {
	h.rtc = r
}

// originPatternsFrom converts a comma-separated list of origins (e.g.
// "https://chat.example.com,https://admin.example.com") into the
// scheme://host patterns expected by websocket.AcceptOptions.OriginPatterns.
func originPatternsFrom(frontendOrigin string) []string {
	var patterns []string
	for _, o := range strings.Split(frontendOrigin, ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			patterns = append(patterns, u.Scheme+"://"+u.Host)
		} else {
			patterns = append(patterns, o)
		}
	}
	return patterns
}

// beginBackground registers one unit of work that Close must wait for. It reports false once the hub is
// closed, in which case the caller must not start the work. Add happens under the same lock that sets the
// closed flag, so it can never race with the Wait in Close.
func (h *Hub) beginBackground() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false
	}
	h.background.Add(1)
	return true
}

// goBackground runs fn in a goroutine that Close waits for; it does nothing once the hub is closed.
func (h *Hub) goBackground(fn func()) {
	if !h.beginBackground() {
		return
	}
	go func() {
		defer h.background.Done()
		fn()
	}()
}

// Close gracefully disconnects all active WebSocket clients and waits for their teardown, so the caller can
// close the database right after it returns.
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
	h.background.Wait()
}

// DisconnectAllExcept closes every WebSocket except those of keepUserID. The
// admin "reset server" action uses it so removed accounts cannot keep a live
// connection after their data and sessions are gone.
func (h *Hub) DisconnectAllExcept(keepUserID string) {
	h.mu.Lock()
	var drop []*Client
	for uid, list := range h.clients {
		if uid == keepUserID {
			continue
		}
		drop = append(drop, list...)
		delete(h.clients, uid)
	}
	h.mu.Unlock()
	for _, c := range drop {
		_ = c.conn.Close(websocket.StatusPolicyViolation, "server reset")
	}
}

// DisconnectSession closes every WebSocket opened by the session with the given public id, used when the user
// terminates a device or a password change revokes it.
func (h *Hub) DisconnectSession(sessionID string) {
	h.mu.Lock()
	var drop []*Client
	for uid, list := range h.clients {
		kept := list[:0]
		for _, c := range list {
			if c.SessionID == sessionID {
				drop = append(drop, c)
			} else {
				kept = append(kept, c)
			}
		}
		if len(kept) == 0 {
			delete(h.clients, uid)
		} else {
			h.clients[uid] = kept
		}
	}
	h.mu.Unlock()
	for _, c := range drop {
		_ = c.conn.Close(websocket.StatusPolicyViolation, "session terminated")
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
// Authentication is via the `cove_session` cookie, an Authorization
// header, or (for the Wails desktop client, whose webview doesn't reliably
// persist httpOnly cookies) a `cove-token.<token>` WebSocket subprotocol.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token, _, err := auth.ResolveToken(r)
	if err != nil {
		http.Error(w, `{"error":"unauthorized","code":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	session, err := h.sessions.Validate(token)
	if err != nil {
		http.Error(w, `{"error":"unauthorized","code":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	opts := &websocket.AcceptOptions{}
	if h.isDev {
		// Allow any origin in development, where the frontend often runs on
		// an arbitrary local port not known ahead of time.
		opts.InsecureSkipVerify = true
	} else {
		opts.OriginPatterns = h.originPatterns
	}
	if proto, ok := auth.WSSubprotocol(r); ok {
		// Per RFC 6455, the server must echo back a subprotocol the client
		// offered for the connection to be accepted.
		opts.Subprotocols = []string{proto}
	}

	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		logger.Warnf("ws: upgrade failed for user %s: %v", session.UserID, err)
		return
	}
	// Track this connection until its teardown (which still uses the store) has finished.
	if !h.beginBackground() {
		_ = conn.Close(websocket.StatusGoingAway, "server shutting down")
		return
	}
	defer h.background.Done()
	// Set a generous read limit for encrypted file/voice payloads (20 MB).
	conn.SetReadLimit(20 << 20)

	client := &Client{
		UserID:     session.UserID,
		Username:   session.Username,
		SessionID:  session.ID,
		RemoteAddr: r.RemoteAddr,
		conn:       conn,
		send:       make(chan *envelope, 256), // Increased buffer for high volume
		hub:        h,
		limiter:    newTokenBucket(clientEventsPerSecond, clientEventBurst),
	}
	h.register(client)
	// Queued before the pumps start (the buffer is empty), so hello is always the first frame the client sees.
	client.send <- &envelope{msg: h.helloMessage()}

	// Fetch user to check their status preference
	status, isAuto := "online", true
	if u, err := h.store.GetUser(session.UserID); err == nil {
		status, isAuto = effectiveStatus(u)
	}

	_ = h.store.SetPresence(session.UserID, status)
	if isAuto {
		_ = h.store.UpdateUserStatus(session.UserID, status)
	}

	if status != "offline" {
		h.BroadcastPresence(session.UserID, status)
	}

	// Replay any pending incoming whisper invitations for this user
	h.ReplayPendingWhisperInvites(client)

	// Synchronize active voice sessions for channels this user is a member of
	if h.rtc != nil {
		go func(targetUserID string) {
			rooms := h.rtc.ActiveRooms()
			for chID, participants := range rooms {
				if len(participants) == 0 {
					continue
				}
				if _, err := h.store.GetUserChannel(targetUserID, chID); err == nil {
					h.SendVoiceState(targetUserID, chID, participants)
				}
			}
		}(session.UserID)
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
	_ = conn.Close(websocket.StatusNormalClosure, "goodbye")
}

// writePump handles outgoing messages from the Hub to the Client.
func (c *Client) writePump(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close(websocket.StatusAbnormalClosure, "write pump closed")
	}()

	// Push channel keys in background immediately
	c.hub.goBackground(func() { c.writeChannelKeys(ctx, c.hub.store, c.hub.kek) })

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
		_ = c.conn.Close(websocket.StatusAbnormalClosure, "read pump closed")
	}()

	for {
		var raw models.WSMessage
		if err := wsjson.Read(ctx, c.conn, &raw); err != nil {
			break
		}
		if c.limiter != nil && !c.limiter.allow() {
			// Dropped, not disconnected: a burst from a legitimate client (reconnect replay) recovers on its own.
			logger.Debugf("ws: rate limit exceeded for %s, dropping %q", c.UserID, raw.Type)
			continue
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

// BroadcastMessage fans out an already-persisted message (for example one authored by the Cove system account)
// to every member of its channel, exactly like a message sent by a client.
func (h *Hub) BroadcastMessage(msg *models.Message) {
	payload, _ := json.Marshal(msg)
	h.enqueue(&envelope{
		channelID: msg.ChannelID,
		senderID:  msg.SenderID,
		msg:       &models.WSMessage{Type: "message", Payload: payload},
	})
}

// broadcastEnqueueTimeout bounds how long a producer waits for room in the broadcast queue. The queue is drained
// by one dispatcher goroutine that hits the store per envelope, so under a flood it can fill up; an unbounded
// send would then stall every handler (and REST request) that tries to broadcast.
const broadcastEnqueueTimeout = 2 * time.Second

// enqueue hands an envelope to the dispatcher in order, waiting at most broadcastEnqueueTimeout. It reports false
// (and logs) when the envelope was dropped because the queue stayed full or the hub is closed.
func (h *Hub) enqueue(e *envelope) bool {
	select {
	case h.broadcast <- e:
		return true
	default:
	}
	timer := time.NewTimer(broadcastEnqueueTimeout)
	defer timer.Stop()
	select {
	case h.broadcast <- e:
		return true
	case <-timer.C:
		logger.Warnf("ws: broadcast queue full, dropping %q envelope for channel %s", e.msg.Type, e.channelID)
		return false
	}
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
	h.enqueue(&envelope{channelID: channelID, msg: msg})

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
	h.enqueue(&envelope{channelID: channelID, msg: msg})

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
	h.enqueue(&envelope{channelID: channelID, msg: msg})

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

// BroadcastChannelUpdated notifies all members that channel settings (like Name, Description, AvatarID) have changed.
func (h *Hub) BroadcastChannelUpdated(ch *models.Channel) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id":  ch.ID,
		"name":        ch.Name,
		"description": ch.Description,
		"avatar_id":   ch.AvatarID,
		"is_private":  ch.IsPrivate,
		"type":        "settings_updated",
	})
	msg := &models.WSMessage{Type: "channel_update", Payload: payload}
	h.enqueue(&envelope{channelID: ch.ID, msg: msg})
}

// BroadcastChannelDeleted notifies specified users (or channel members) that a channel has been deleted or cleared.
func (h *Hub) BroadcastChannelDeleted(channelID string, targetUserIDs []string) {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
	})
	msg := &models.WSMessage{Type: "channel_delete", Payload: payload}
	env := &envelope{msg: msg}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, uid := range targetUserIDs {
		if clients, ok := h.clients[uid]; ok {
			for _, c := range clients {
				select {
				case c.send <- env:
				default:
				}
			}
		}
	}
}

// BroadcastRelationshipUpdate notifies a specific user of a relationship change.
func (h *Hub) BroadcastRelationshipUpdate(targetUserID string, rel *models.Relationship) {
	payload, _ := json.Marshal(rel)
	msg := &models.WSMessage{Type: "relationship_update", Payload: payload}
	env := &envelope{msg: msg}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.clients[targetUserID]; ok {
		for _, c := range clients {
			select {
			case c.send <- env:
			default:
			}
		}
	}
}

// BroadcastVideoReady notifies channel members that an uploaded video is processed and ready.
func (h *Hub) BroadcastVideoReady(fileID string, channelID string) {
	payload, _ := json.Marshal(map[string]any{
		"file_id":    fileID,
		"channel_id": channelID,
		"status":     "ready",
	})
	msg := &models.WSMessage{Type: "video_ready", Payload: payload}
	if channelID != "" {
		h.enqueue(&envelope{channelID: channelID, msg: msg})
	} else {
		// Broadcast to all clients if not channel-specific
		env := &envelope{msg: msg}
		h.mu.RLock()
		defer h.mu.RUnlock()
		for _, clients := range h.clients {
			for _, c := range clients {
				select {
				case c.send <- env:
				default:
				}
			}
		}
	}
}

// BroadcastVoiceState notifies channel members of who is currently in the voice session.
func (h *Hub) BroadcastVoiceState(channelID string, activeUsers []string) {
	if activeUsers == nil {
		activeUsers = []string{}
	}
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"users":      activeUsers,
	})
	msg := &models.WSMessage{Type: "voice_update", Payload: payload}
	h.enqueue(&envelope{channelID: channelID, msg: msg})
}

// SendVoiceState notifies a specific user of who is currently in the voice session.
func (h *Hub) SendVoiceState(userID string, channelID string, activeUsers []string) {
	if activeUsers == nil {
		activeUsers = []string{}
	}
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

// maxPendingWhisperPerUser caps how many not-yet-accepted whisper invitations one user may have outstanding. Pending
// invites live in RAM only (whisper plaintext/keys are never persisted), so without a cap a single connection could
// grow the map without bound.
const maxPendingWhisperPerUser = 20

// pendingWhisperTTL is how long an unanswered invitation is held; it matches the cleanup in ReplayPendingWhisperInvites.
const pendingWhisperTTL = 30 * time.Minute

// Errors returned by RegisterWhisperSession.
var (
	// ErrWhisperSessionExists means the session id is already taken by another (or the same) session.
	ErrWhisperSessionExists = errors.New("whisper session id already in use")
	// ErrWhisperTooManyPending means the initiator has too many unanswered invitations.
	ErrWhisperTooManyPending = errors.New("too many pending whisper invitations")
)

// RegisterWhisperSession stores an active in-memory whisper session. It never replaces an existing session: ids are
// chosen by clients, so overwriting would let anyone hijack another pair's session by guessing or reusing its id.
func (h *Hub) RegisterWhisperSession(sess *WhisperSession) error {
	h.whisperMu.Lock()
	defer h.whisperMu.Unlock()
	if _, exists := h.whisperSessions[sess.ID]; exists {
		return ErrWhisperSessionExists
	}
	pending := 0
	now := time.Now().UTC()
	for _, s := range h.whisperSessions {
		if s.InitiatorID == sess.InitiatorID && s.Pending && now.Sub(s.CreatedAt) <= pendingWhisperTTL {
			pending++
		}
	}
	if pending >= maxPendingWhisperPerUser {
		return ErrWhisperTooManyPending
	}
	h.whisperSessions[sess.ID] = sess
	return nil
}

// GetWhisperSession returns a snapshot of an active whisper session. It is a copy so callers never read fields the
// hub mutates under whisperMu.
func (h *Hub) GetWhisperSession(id string) (*WhisperSession, bool) {
	h.whisperMu.RLock()
	defer h.whisperMu.RUnlock()
	sess, ok := h.whisperSessions[id]
	if !ok {
		return nil, false
	}
	cp := *sess
	return &cp, true
}

// AcceptWhisperSession marks a pending session as established when userID is its target and returns a snapshot. The
// Pending flag is written under whisperMu because CleanupUserWhisperSessions and ReplayPendingWhisperInvites read it
// concurrently.
func (h *Hub) AcceptWhisperSession(id, userID string) (*WhisperSession, bool) {
	h.whisperMu.Lock()
	defer h.whisperMu.Unlock()
	sess, ok := h.whisperSessions[id]
	if !ok || sess.TargetID != userID {
		return nil, false
	}
	sess.Pending = false
	cp := *sess
	return &cp, true
}

// RemoveWhisperSession deletes a whisper session from RAM regardless of who asks; use RemoveWhisperSessionBy for
// requests that originate from a client.
func (h *Hub) RemoveWhisperSession(id string) *WhisperSession {
	h.whisperMu.Lock()
	defer h.whisperMu.Unlock()
	sess, ok := h.whisperSessions[id]
	if ok {
		delete(h.whisperSessions, id)
	}
	return sess
}

// RemoveWhisperSessionBy deletes the session only when userID is its initiator or target, and returns nil otherwise
// (also when it does not exist), so a caller cannot tell the two cases apart.
func (h *Hub) RemoveWhisperSessionBy(id, userID string) *WhisperSession {
	h.whisperMu.Lock()
	defer h.whisperMu.Unlock()
	sess, ok := h.whisperSessions[id]
	if !ok || (sess.InitiatorID != userID && sess.TargetID != userID) {
		return nil
	}
	delete(h.whisperSessions, id)
	return sess
}

// CleanupUserWhisperSessions removes all sessions involving the user and returns them.
// Pending invitations are NOT deleted when the target disconnects, preserving them for when the target reconnects/logs in.
func (h *Hub) CleanupUserWhisperSessions(userID string) []*WhisperSession {
	h.whisperMu.Lock()
	defer h.whisperMu.Unlock()
	var closed []*WhisperSession
	for id, sess := range h.whisperSessions {
		if sess.InitiatorID == userID {
			// Initiator disconnected; their ephemeral private key is destroyed in client memory
			closed = append(closed, sess)
			delete(h.whisperSessions, id)
		} else if sess.TargetID == userID && !sess.Pending {
			// Target disconnected from an already established session
			closed = append(closed, sess)
			delete(h.whisperSessions, id)
		}
	}
	return closed
}

// ReplayPendingWhisperInvites delivers pending whisper invitations to a newly connected client.
func (h *Hub) ReplayPendingWhisperInvites(c *Client) {
	h.whisperMu.Lock()
	var toDeliver []*WhisperSession
	var toDelete []string
	now := time.Now().UTC()

	for id, sess := range h.whisperSessions {
		if sess.Pending && now.Sub(sess.CreatedAt) > 30*time.Minute {
			toDelete = append(toDelete, id)
			continue
		}
		if sess.Pending && sess.TargetID == c.UserID {
			if !h.IsUserOnline(sess.InitiatorID) {
				toDelete = append(toDelete, id)
			} else {
				toDeliver = append(toDeliver, sess)
			}
		}
	}
	for _, id := range toDelete {
		delete(h.whisperSessions, id)
	}
	h.whisperMu.Unlock()

	for _, sess := range toDeliver {
		relayedPayload, _ := json.Marshal(map[string]any{
			"session_id":         sess.ID,
			"initiator_id":       sess.InitiatorID,
			"initiator_username": sess.InitiatorUsername,
			"pub_key":            sess.PubKey,
			"expiry_mode":        sess.ExpiryMode,
		})
		msg := &models.WSMessage{
			Type:    "whisper_init",
			Payload: relayedPayload,
		}
		select {
		case c.send <- &envelope{msg: msg}:
		default:
		}
	}
}

// IsUserOnline returns true if the user has at least one active connection to the Hub.
func (h *Hub) IsUserOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	clients, ok := h.clients[userID]
	return ok && len(clients) > 0
}

// SendToUser dispatches a WSMessage to all active connections for a given user.
func (h *Hub) SendToUser(userID string, msg *models.WSMessage) bool {
	env := &envelope{msg: msg}
	h.mu.RLock()
	defer h.mu.RUnlock()
	clients, ok := h.clients[userID]
	if !ok || len(clients) == 0 {
		return false
	}
	for _, c := range clients {
		select {
		case c.send <- env:
		default:
		}
	}
	return true
}
