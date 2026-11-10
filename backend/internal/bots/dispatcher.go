package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
	"github.com/google/uuid"
)

// Config wires a Dispatcher. Only Store and KEK are required.
type Config struct {
	Store *store.Store
	KEK   []byte
	// Enabled is consulted on every connection and delivery so the admin switch applies live. Nil means enabled.
	Enabled func() bool
	// AllowPrivate lets webhooks reach private addresses (config bots.webhook_allow_private). Nil means no.
	AllowPrivate func() bool
	// Backoff is the wait before each retry of a webhook delivery; its length is the number of retries.
	// Nil means 1 s, 5 s, 30 s, 5 min.
	Backoff []time.Duration
}

// Per-bot ephemeral limits (documented in docs/bots-api.md).
const (
	maxGatewaySessions = 3
	maxPendingWebhooks = 200
	eventQueueSize     = 1024
)

// Dispatcher fans events out to bots: through an open gateway connection when there is one, otherwise through the
// bot's webhook. Everything it keeps in memory is ephemeral by design: the open gateway connections, the webhook
// retry queue (bounded per bot, lost on restart) and the event queue. Bots recover state through the REST API.
type Dispatcher struct {
	cfg    Config
	client *http.Client

	mu       sync.RWMutex
	sessions map[string][]*gwSession // bot id -> open connections
	pending  map[string]int          // bot id -> webhook deliveries in flight or waiting to retry

	events chan func()
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewDispatcher starts a Dispatcher. Call Close to stop it.
func NewDispatcher(cfg Config) *Dispatcher {
	if cfg.Backoff == nil {
		cfg.Backoff = []time.Duration{time.Second, 5 * time.Second, 30 * time.Second, 5 * time.Minute}
	}
	if cfg.Enabled == nil {
		cfg.Enabled = func() bool { return true }
	}
	if cfg.AllowPrivate == nil {
		cfg.AllowPrivate = func() bool { return false }
	}
	ctx, cancel := context.WithCancel(context.Background())
	d := &Dispatcher{
		cfg: cfg, client: newHTTPClient(cfg.AllowPrivate),
		sessions: map[string][]*gwSession{}, pending: map[string]int{},
		events: make(chan func(), eventQueueSize), ctx: ctx, cancel: cancel,
	}
	d.wg.Add(1)
	go d.worker()
	return d
}

// Close stops the worker and every gateway connection and waits for in-flight deliveries to give up.
func (d *Dispatcher) Close() {
	d.cancel()
	d.mu.Lock()
	var all []*gwSession
	for _, l := range d.sessions {
		all = append(all, l...)
	}
	d.sessions = map[string][]*gwSession{}
	d.mu.Unlock()
	for _, s := range all {
		s.close("server shutting down")
	}
	d.wg.Wait()
}

// worker runs queued event builders one at a time, so events of one channel reach bots in the order they happened.
func (d *Dispatcher) worker() {
	defer d.wg.Done()
	for {
		select {
		case <-d.ctx.Done():
			return
		case fn := <-d.events:
			fn()
		}
	}
}

func (d *Dispatcher) enqueue(fn func()) {
	select {
	case d.events <- fn:
	default:
		logger.Warnf("bots: event queue full, dropping an event")
	}
}

func (d *Dispatcher) enabled() bool { return d.cfg.Enabled() }

// Online reports whether the bot has an open gateway connection.
func (d *Dispatcher) Online(botID string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.sessions[botID]) > 0
}

// DisconnectBot closes the bot's gateway connections (token rotated, bot disabled or deleted).
func (d *Dispatcher) DisconnectBot(botID string) {
	d.mu.Lock()
	list := d.sessions[botID]
	delete(d.sessions, botID)
	d.mu.Unlock()
	for _, s := range list {
		s.close("bot token changed or bot disabled")
	}
}

// wire is the envelope of every event.
type wire struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	BotID   string          `json:"bot_id,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

// Deliver sends one event to a bot and reports whether it was handed to a gateway connection or queued for the
// webhook. False means the bot is offline and has no webhook.
func (d *Dispatcher) Deliver(botID, eventType string, payload any) bool {
	if !d.enabled() {
		return false
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	ev := wire{ID: uuid.New().String(), Type: eventType, BotID: botID, Payload: raw}
	d.mu.RLock()
	sessions := append([]*gwSession(nil), d.sessions[botID]...)
	d.mu.RUnlock()
	if len(sessions) > 0 {
		frame, _ := json.Marshal(ev)
		sent := false
		for _, s := range sessions {
			if s.push(frame) {
				sent = true
			}
		}
		if sent {
			return true
		}
	}
	b, err := d.cfg.Store.GetBot(botID)
	if err != nil || b.Disabled || b.WebhookURL == "" {
		return false
	}
	return d.queueWebhook(b, ev)
}

func (d *Dispatcher) queueWebhook(b *models.Bot, ev wire) bool {
	d.mu.Lock()
	if d.pending[b.ID] >= maxPendingWebhooks {
		d.mu.Unlock()
		logger.Warnf("bots: webhook queue of bot %s is full, dropping %s", b.ID, ev.Type)
		return false
	}
	d.pending[b.ID]++
	d.mu.Unlock()
	body, _ := json.Marshal(ev)
	url, secret := b.WebhookURL, b.WebhookSecret
	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		defer func() {
			d.mu.Lock()
			d.pending[b.ID]--
			d.mu.Unlock()
		}()
		for attempt := 0; ; attempt++ {
			retry, err := post(d.ctx, d.client, url, secret, ev.ID, ev.Type, body)
			if err == nil {
				return
			}
			// Ids only: the error text and body never carry message content.
			logger.Debugf("bots: webhook delivery %s of bot %s failed (attempt %d): %v", ev.ID, b.ID, attempt+1, err)
			if !retry || attempt >= len(d.cfg.Backoff) {
				logger.Warnf("bots: giving up on webhook delivery %s (%s) of bot %s", ev.ID, ev.Type, b.ID)
				return
			}
			select {
			case <-time.After(d.cfg.Backoff[attempt]):
			case <-d.ctx.Done():
				return
			}
		}
	}()
	return true
}

type botAccess struct {
	user   *models.User
	scopes []string
}

// botMembers returns the bots that are active members of the channel with their scopes. Bots without an install in
// a group channel are not listed.
func (d *Dispatcher) botMembers(channelID string) []botAccess {
	members, err := d.cfg.Store.GetChannelMembers(channelID)
	if err != nil {
		return nil
	}
	var out []botAccess
	for _, m := range members {
		u, err := d.cfg.Store.GetUser(m.UserID)
		if err != nil || !u.IsBot() {
			continue
		}
		scopes, ok := d.cfg.Store.BotChannelScopes(channelID, u.ID)
		if !ok {
			continue
		}
		out = append(out, botAccess{user: u, scopes: scopes})
	}
	return out
}

// EmitMessage tells the bots in the message's channel about a created or updated message. A bot gets it when it has
// the messages.read scope, or when the message mentions it, replies to it, or sits in a DM with it. The sender
// never receives its own message. Work is queued so the caller (a user's socket or a REST handler) is not slowed.
func (d *Dispatcher) EmitMessage(eventType string, msg *models.Message) {
	if !d.enabled() {
		return
	}
	d.enqueue(func() {
		for _, b := range d.botMembers(msg.ChannelID) {
			if b.user.ID == msg.SenderID {
				continue
			}
			dto := BuildMessageDTO(d.cfg.Store, d.cfg.KEK, msg, b.user)
			if !store.HasScope(b.scopes, models.ScopeMessagesRead) && !dto.Mentioned {
				continue
			}
			d.Deliver(b.user.ID, eventType, dto)
		}
	})
}

// EmitMessageDelete tells bots with the messages.read scope that a message was removed (id only, no content).
func (d *Dispatcher) EmitMessageDelete(channelID, messageID, senderID string) {
	if !d.enabled() {
		return
	}
	d.enqueue(func() {
		for _, b := range d.botMembers(channelID) {
			if b.user.ID == senderID || !store.HasScope(b.scopes, models.ScopeMessagesRead) {
				continue
			}
			d.Deliver(b.user.ID, EventMessageDelete, DeleteEvent{ChannelID: channelID, MessageID: messageID})
		}
	})
}

// EmitMember tells bots with the members.read scope that someone joined or left the channel.
func (d *Dispatcher) EmitMember(eventType, channelID, userID string) {
	if !d.enabled() {
		return
	}
	d.enqueue(func() {
		u, err := d.cfg.Store.GetUser(userID)
		if err != nil {
			return
		}
		for _, b := range d.botMembers(channelID) {
			if b.user.ID == userID || !store.HasScope(b.scopes, models.ScopeMembersRead) {
				continue
			}
			d.Deliver(b.user.ID, eventType, MemberEvent{ChannelID: channelID, User: Author{ID: u.ID, Username: u.Username, IsBot: u.IsBot()}})
		}
	})
}
