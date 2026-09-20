package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/store"

	"github.com/coder/websocket/wsjson"
)

func (h *Hub) register(c *Client) {
	h.mu.Lock()
	h.clients[c.UserID] = append(h.clients[c.UserID], c)
	h.mu.Unlock()
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	clients, ok := h.clients[c.UserID]
	if !ok {
		h.mu.Unlock()
		return
	}

	for i, client := range clients {
		if client == c {
			// Remove the client from the slice
			h.clients[c.UserID] = append(clients[:i], clients[i+1:]...)
			close(c.send)
			break
		}
	}

	stillConnected := len(h.clients[c.UserID]) > 0
	if !stillConnected {
		delete(h.clients, c.UserID)
	}
	h.mu.Unlock()

	// If user has no more active connections, clean up any whisper sessions,
	// purge stale voice-call state (a client that crashes/drops without
	// sending a voice Leave packet would otherwise stay a ghost participant
	// forever), and notify peers.
	if !stillConnected {
		if h.voiceRouter != nil {
			h.voiceRouter.RemoveUser(c.UserID)
		}
		closedSessions := h.CleanupUserWhisperSessions(c.UserID)
		for _, sess := range closedSessions {
			peerID := sess.TargetID
			if peerID == c.UserID {
				peerID = sess.InitiatorID
			}
			payload, _ := json.Marshal(map[string]any{
				"session_id": sess.ID,
				"reason":     "peer_disconnected",
			})
			h.SendToUser(peerID, &models.WSMessage{
				Type:    "whisper_close",
				Payload: payload,
			})
		}
	}
}

// writeChannelKeys pushes all decrypted AES channel keys to the client so it
// can decrypt incoming messages immediately.
func (c *Client) writeChannelKeys(ctx context.Context, s *store.Store, kek []byte) {
	channels, err := s.ListUserChannels(c.UserID)
	if err != nil {
		logger.Errorf("ws: writeChannelKeys list error for %s: %v", c.UserID, err)
		return
	}
	for _, ch := range channels {
		rawKey, err := s.DecryptChannelKey(ch, kek)
		if err != nil {
			logger.Errorf("ws: cannot decrypt key for channel %s: %v", ch.ID, err)
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"channel_id": ch.ID,
			"aes_key":    rawKey,
		})
		msg := &models.WSMessage{Type: "channel_key", Payload: payload}
		writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_ = wsjson.Write(writeCtx, c.conn, msg)
		cancel()
	}
}

// handleMessage routes inbound WSS frames.
func (c *Client) handleMessage(ctx context.Context, msg *models.WSMessage) error {
	switch msg.Type {
	case "message":
		return c.handleChatMessage(msg)
	case "message_edit":
		return c.handleEditMessage(msg)
	case "message_delete":
		return c.handleDeleteMessage(msg)
	case "read_receipt":
		return c.handleReadReceipt(msg)
	case "whisper_init":
		return c.handleWhisperInit(msg)
	case "whisper_accept":
		return c.handleWhisperAccept(msg)
	case "whisper_reject":
		return c.handleWhisperReject(msg)
	case "whisper_msg":
		return c.handleWhisperMsg(msg)
	case "whisper_close":
		return c.handleWhisperClose(msg)
	case "ping":
		pongMsg := &models.WSMessage{Type: "pong"}
		select {
		case c.send <- &envelope{msg: pongMsg}:
		default:
		}
		return c.hub.store.SetPresence(c.UserID, "online")
	default:
		return fmt.Errorf("unknown message type: %s", msg.Type)
	}
}
