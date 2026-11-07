package ws

import (
	"encoding/json"
	"errors"
	"fmt"

	"cove/backend/internal/apistd"
	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"
)

// messageRejection is why the server refused an inbound chat message. Code is a stable apistd code the client can
// branch on; Err is the human-readable reason.
type messageRejection struct {
	Code string
	Err  string
}

func (r *messageRejection) Error() string { return r.Err }

// validInviteCode bounds what a code in an invite body may look like (same rule the clients use for /join/<code>).
func validInviteCode(code string) bool {
	if code == "" || len(code) > 128 {
		return false
	}
	for _, r := range code {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return true
}

// validateInviteMessage checks that an `invite` message only points at a channel the sender may actually invite to.
// The body is encrypted with the transport channel's key, which the server holds (server-trusted model), so it can
// be read here; without this check any member could forge an invite card for an arbitrary channel or code.
//
// The rule mirrors who can obtain the code over REST: the invite link of a group channel is shown only to its active
// admins and owner, while a public channel's id (also accepted by /api/join) can be shared by any active member.
func (c *Client) validateInviteMessage(transportID, compression string, nonce, ciphertext []byte) *messageRejection {
	bad := func(msg string) *messageRejection {
		return &messageRejection{Code: apistd.CodeValidationFailed, Err: msg}
	}
	if compression != "none" {
		return bad("invite messages cannot be compressed")
	}
	transport, err := c.hub.store.GetChannel(transportID)
	if err != nil {
		return bad("channel not found")
	}
	key, err := c.hub.store.DecryptChannelKey(transport, c.hub.kek)
	if err != nil {
		return bad("could not read invite")
	}
	plain, err := crypto.OpenGCM(key, nonce, ciphertext)
	if err != nil {
		return bad("invite could not be decrypted")
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(plain, &body); err != nil || !validInviteCode(body.Code) {
		return bad("invite does not contain a valid code")
	}

	target, err := c.hub.store.GetChannelByInviteLink(body.Code)
	byLink := err == nil
	if err != nil {
		if !errors.Is(err, db.ErrNotFound) {
			return &messageRejection{Code: apistd.CodeInternal, Err: "could not check invite"}
		}
		target, err = c.hub.store.GetChannel(body.Code)
		if err != nil || target.IsPrivate {
			return bad("invite points at an unknown channel")
		}
	}
	members, err := c.hub.store.GetChannelMembers(target.ID)
	if err != nil || target.IsDM(len(members)) {
		return bad("invite points at an unknown channel")
	}

	denied := &messageRejection{Code: apistd.CodeInviteNotAllowed, Err: "you cannot invite people to that channel"}
	uc, err := c.hub.store.GetUserChannel(c.UserID, target.ID)
	if err != nil || uc.Status != models.StatusActive {
		return denied
	}
	if byLink && uc.Role < models.RoleAdmin {
		return denied
	}
	return nil
}

// rejectMessage tells the sender why a message was refused (an additive `message_error` event; older clients ignore
// it) and returns the error for the server log.
func (c *Client) rejectMessage(channelID string, r *messageRejection) error {
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"code":       r.Code,
		"error":      r.Err,
	})
	select {
	case c.send <- &envelope{msg: &models.WSMessage{Type: "message_error", Payload: payload}}:
	default:
	}
	return fmt.Errorf("message rejected (%s): %s", r.Code, r.Err)
}
