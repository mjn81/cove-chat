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
