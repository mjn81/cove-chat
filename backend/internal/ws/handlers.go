package ws

import (
	"encoding/json"
	"fmt"
	"time"

	"nodetalk/backend/internal/models"
	"github.com/segmentio/ksuid"
)

// handleChatMessage persists and broadcasts an incoming encrypted chat message.
func (c *Client) handleChatMessage(raw *models.WSMessage) error {
	var body struct {
		ChannelID   string             `json:"channel_id"`
		Type        models.MessageType `json:"type"`
		Ciphertext  []byte             `json:"ciphertext"`
		Nonce       []byte             `json:"nonce"`
		Compression string             `json:"compression"`
		ReplyToID   string             `json:"reply_to_id"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid message payload: %w", err)
	}
	if body.ChannelID == "" || body.Ciphertext == nil {
		return fmt.Errorf("missing channel_id or ciphertext")
	}
	if body.Type == "" {
		body.Type = models.MessageTypeText
	}
	if body.Compression == "" {
		body.Compression = "none"
	}

	// Membership check
	uc, err := c.hub.store.GetUserChannel(c.UserID, body.ChannelID)
	if err != nil || uc.Status != models.StatusActive {
		return fmt.Errorf("not an active member of channel: %s", body.ChannelID)
	}

	// For DMs, check blocking and DM privacy permission
	ch, chErr := c.hub.store.GetChannel(body.ChannelID)
	if chErr == nil {
		members, merr := c.hub.store.GetChannelMembers(body.ChannelID)
		if merr == nil && ch.IsDM(len(members)) {
			var otherUserID string
			for _, m := range members {
				if m.UserID != c.UserID {
					otherUserID = m.UserID
					break
				}
			}
			if otherUserID != "" {
				canSend, reason := c.hub.store.CanSendDM(c.UserID, otherUserID)
				if !canSend {
					return fmt.Errorf("cannot send direct message: %s", reason)
				}
			}
		}
	}

	now := time.Now().UTC()
	msg := &models.Message{
		ID:          ksuid.New().String(),
		ChannelID:   body.ChannelID,
		SenderID:    c.UserID,
		Type:        body.Type,
		Ciphertext:  body.Ciphertext,
		Nonce:       body.Nonce,
		Compression: body.Compression,
		ReplyToID:   body.ReplyToID,
		SentAt:      now,
	}
	if err := c.hub.store.SaveMessage(msg); err != nil {
		return fmt.Errorf("persist message: %w", err)
	}

	outPayload, _ := json.Marshal(msg)
	outMsg := &models.WSMessage{Type: "message", Payload: outPayload}

	// Enqueued synchronously (not backgrounded) so messages from this client
	// enter the broadcast channel in the order they were sent — a goroutine
	// per send would let scheduling reorder them ahead of an edit/delete
	// for the same channel.
	c.hub.broadcast <- &envelope{
		channelID: body.ChannelID,
		senderID:  c.UserID,
		msg:       outMsg,
	}
	return nil
}

// handleEditMessage updates an existing message's ciphertext.
func (c *Client) handleEditMessage(raw *models.WSMessage) error {
	var body struct {
		ChannelID  string `json:"channel_id"`
		MessageID  string `json:"message_id"`
		Ciphertext []byte `json:"ciphertext"`
		Nonce      []byte `json:"nonce"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid message_edit payload: %w", err)
	}

	msg, err := c.hub.store.GetMessage(body.ChannelID, body.MessageID)
	if err != nil {
		return fmt.Errorf("message not found")
	}

	if msg.SenderID != c.UserID {
		return fmt.Errorf("permission denied: cannot edit someone else's message")
	}

	now := time.Now().UTC()
	msg.Ciphertext = body.Ciphertext
	msg.Nonce = body.Nonce
	msg.EditedAt = &now

	if err := c.hub.store.UpdateMessage(msg); err != nil {
		return fmt.Errorf("update message: %w", err)
	}

	outPayload, _ := json.Marshal(msg)
	outMsg := &models.WSMessage{Type: "message_update", Payload: outPayload}

	c.hub.broadcast <- &envelope{
		channelID: body.ChannelID,
		senderID:  c.UserID,
		msg:       outMsg,
	}
	return nil
}

// handleDeleteMessage removes a message from the DB and notifies clients.
func (c *Client) handleDeleteMessage(raw *models.WSMessage) error {
	var body struct {
		ChannelID string `json:"channel_id"`
		MessageID string `json:"message_id"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid message_delete payload: %w", err)
	}

	msg, err := c.hub.store.GetMessage(body.ChannelID, body.MessageID)
	if err != nil {
		return fmt.Errorf("message not found")
	}

	if msg.SenderID != c.UserID {
		return fmt.Errorf("permission denied: cannot delete someone else's message")
	}

	if err := c.hub.store.DeleteMessage(body.ChannelID, body.MessageID); err != nil {
		return fmt.Errorf("delete message: %w", err)
	}

	outPayload, _ := json.Marshal(map[string]any{
		"channel_id": body.ChannelID,
		"message_id": body.MessageID,
	})
	outMsg := &models.WSMessage{Type: "message_delete", Payload: outPayload}

	c.hub.broadcast <- &envelope{
		channelID: body.ChannelID,
		senderID:  c.UserID,
		msg:       outMsg,
	}
	return nil
}

// handleReadReceipt updates the last read timestamp for the channel.
func (c *Client) handleReadReceipt(raw *models.WSMessage) error {
	var body struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid read_receipt payload: %w", err)
	}
	if body.ChannelID == "" {
		return fmt.Errorf("missing channel_id")
	}
	return c.hub.store.UpdateChannelRead(c.UserID, body.ChannelID)
}

// ---- Whisper (Zero-Persistence E2EE Relay) -------------------------------- //

// sendWhisperError sends a whisper_error event back to this client.
func (c *Client) sendWhisperError(sessionID, errMsg string) {
	payload, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"error":      errMsg,
	})
	msg := &models.WSMessage{Type: "whisper_error", Payload: payload}
	select {
	case c.send <- &envelope{msg: msg}:
	default:
	}
}

// handleWhisperInit handles an initiation request for an E2EE session.
// Validates friendship, checks that the target user is online,
// registers the session in Hub RAM, and blindly relays the public key.
func (c *Client) handleWhisperInit(raw *models.WSMessage) error {
	var body struct {
		SessionID    string `json:"session_id"`
		TargetUserID string `json:"target_user_id"`
		PubKey       string `json:"pub_key"`     // base64 encoded ephemeral public key
		ExpiryMode   string `json:"expiry_mode"` // "persistent", "5m", "1h", "24h", "session_only"
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid whisper_init payload: %w", err)
	}
	if body.SessionID == "" || body.TargetUserID == "" || body.PubKey == "" {
		c.sendWhisperError(body.SessionID, "Missing required fields in whisper_init")
		return nil
	}
	if body.TargetUserID == c.UserID {
		c.sendWhisperError(body.SessionID, "Cannot start a Whisper session with yourself")
		return nil
	}
	if body.ExpiryMode == "" {
		body.ExpiryMode = "persistent"
	}

	// 1. Enforce friends-only requirement
	if !c.hub.store.AreFriends(c.UserID, body.TargetUserID) {
		c.sendWhisperError(body.SessionID, "Whisper sessions can only be initiated with friends")
		return nil
	}

	// 2. Register session in Hub (pure RAM, zero DB) as pending
	sess := &WhisperSession{
		ID:                body.SessionID,
		InitiatorID:       c.UserID,
		InitiatorUsername: c.Username,
		TargetID:          body.TargetUserID,
		PubKey:            body.PubKey,
		ExpiryMode:        body.ExpiryMode,
		CreatedAt:         time.Now().UTC(),
		Pending:           true,
	}
	c.hub.RegisterWhisperSession(sess)

	// 3. Relay whisper_init to target user if online (server NEVER derives keys).
	// If the target is offline, the pending invite is held in Hub RAM and automatically
	// replayed when the target logs in / connects.
	if c.hub.IsUserOnline(body.TargetUserID) {
		relayedPayload, _ := json.Marshal(map[string]any{
			"session_id":         body.SessionID,
			"initiator_id":       c.UserID,
			"initiator_username": c.Username,
			"pub_key":            body.PubKey,
			"expiry_mode":        body.ExpiryMode,
		})
		relayedMsg := &models.WSMessage{
			Type:    "whisper_init",
			Payload: relayedPayload,
		}
		c.hub.SendToUser(body.TargetUserID, relayedMsg)
	}
	return nil
}

// handleWhisperAccept relays the responder's public key back to the initiator.
func (c *Client) handleWhisperAccept(raw *models.WSMessage) error {
	var body struct {
		SessionID string `json:"session_id"`
		PubKey    string `json:"pub_key"` // base64 encoded ephemeral public key
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid whisper_accept payload: %w", err)
	}

	sess, ok := c.hub.GetWhisperSession(body.SessionID)
	if !ok {
		c.sendWhisperError(body.SessionID, "Whisper session expired or not found")
		return nil
	}
	if sess.TargetID != c.UserID {
		c.sendWhisperError(body.SessionID, "Unauthorized accept attempt")
		return nil
	}

	sess.Pending = false

	relayedPayload, _ := json.Marshal(map[string]any{
		"session_id":      sess.ID,
		"target_id":       c.UserID,
		"target_username": c.Username,
		"pub_key":         body.PubKey,
		"expiry_mode":     sess.ExpiryMode,
	})
	relayedMsg := &models.WSMessage{
		Type:    "whisper_accept",
		Payload: relayedPayload,
	}

	if !c.hub.SendToUser(sess.InitiatorID, relayedMsg) {
		c.hub.RemoveWhisperSession(body.SessionID)
		c.sendWhisperError(body.SessionID, "Initiator is no longer online")
	}
	return nil
}

// handleWhisperReject notifies the initiator that the session was declined.
func (c *Client) handleWhisperReject(raw *models.WSMessage) error {
	var body struct {
		SessionID string `json:"session_id"`
		Reason    string `json:"reason,omitempty"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid whisper_reject payload: %w", err)
	}

	sess := c.hub.RemoveWhisperSession(body.SessionID)
	if sess == nil {
		return nil
	}

	otherID := sess.InitiatorID
	if c.UserID == sess.InitiatorID {
		otherID = sess.TargetID
	}

	relayedPayload, _ := json.Marshal(map[string]any{
		"session_id":  sess.ID,
		"rejecter_id": c.UserID,
		"reason":      body.Reason,
	})
	relayedMsg := &models.WSMessage{
		Type:    "whisper_reject",
		Payload: relayedPayload,
	}
	c.hub.SendToUser(otherID, relayedMsg)
	return nil
}

// handleWhisperMsg blindly relays an encrypted message to the other participant.
// Server does NOT store, decrypt, or log the ciphertext.
func (c *Client) handleWhisperMsg(raw *models.WSMessage) error {
	var body struct {
		SessionID  string `json:"session_id"`
		Ciphertext string `json:"ciphertext"` // base64
		Nonce      string `json:"nonce"`      // base64
		ExpiresAt  *int64 `json:"expires_at,omitempty"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid whisper_msg payload: %w", err)
	}
	if body.SessionID == "" || body.Ciphertext == "" || body.Nonce == "" {
		return fmt.Errorf("missing required fields in whisper_msg")
	}

	sess, ok := c.hub.GetWhisperSession(body.SessionID)
	if !ok {
		c.sendWhisperError(body.SessionID, "Whisper session not active or has ended")
		return nil
	}
	if c.UserID != sess.InitiatorID && c.UserID != sess.TargetID {
		c.sendWhisperError(body.SessionID, "Not a participant in this whisper session")
		return nil
	}

	recipientID := sess.TargetID
	if c.UserID == sess.TargetID {
		recipientID = sess.InitiatorID
	}

	relayedPayload, _ := json.Marshal(map[string]any{
		"session_id": sess.ID,
		"sender_id":  c.UserID,
		"ciphertext": body.Ciphertext,
		"nonce":      body.Nonce,
		"sent_at":    time.Now().UTC().UnixMilli(),
		"expires_at": body.ExpiresAt,
	})
	relayedMsg := &models.WSMessage{
		Type:    "whisper_msg",
		Payload: relayedPayload,
	}

	if !c.hub.SendToUser(recipientID, relayedMsg) {
		c.sendWhisperError(body.SessionID, "Peer is currently disconnected")
	}
	return nil
}

// handleWhisperClose ends the whisper session and notifies the peer.
func (c *Client) handleWhisperClose(raw *models.WSMessage) error {
	var body struct {
		SessionID string `json:"session_id"`
		Reason    string `json:"reason,omitempty"`
	}
	if err := json.Unmarshal(raw.Payload, &body); err != nil {
		return fmt.Errorf("invalid whisper_close payload: %w", err)
	}

	sess := c.hub.RemoveWhisperSession(body.SessionID)
	if sess == nil {
		return nil
	}

	otherID := sess.TargetID
	if c.UserID == sess.TargetID {
		otherID = sess.InitiatorID
	}

	relayedPayload, _ := json.Marshal(map[string]any{
		"session_id": sess.ID,
		"closer_id":  c.UserID,
		"reason":     body.Reason,
	})
	relayedMsg := &models.WSMessage{
		Type:    "whisper_close",
		Payload: relayedPayload,
	}
	c.hub.SendToUser(otherID, relayedMsg)
	return nil
}

