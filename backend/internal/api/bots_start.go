package api

import (
	"net/http"

	"cove/backend/internal/bots"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
)

// StartBotResponse is the DM a person opened with a bot from Explore.
type StartBotResponse struct {
	ChannelID string `json:"channel_id"`
	// Created is false when the DM already existed.
	Created bool `json:"created"`
	// Delivered is false when the bot is offline and has no webhook, so nothing will answer the start event.
	Delivered bool `json:"delivered"`
}

// StartBot godoc
//
//	@Summary     Start a chat with a bot
//	@Description Opens the DM with a public (or own) bot, creating it if needed, records that the caller used the bot
//	@Description (which lets the bot message them) and sends the bot a `bot_start` event, like a Start button. Idempotent.
//	@Description Private bots of other people, disabled bots and unknown ids answer 404.
//	@Description **Access:** Authenticated.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Bot ID"
//	@Success     200 {object} StartBotResponse
//	@Success     201 {object} StartBotResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/{id}/start [post]
func (h *Handler) StartBot(w http.ResponseWriter, r *http.Request) {
	caller := h.caller(w, r)
	if caller == nil {
		return
	}
	if !h.botsEnabled(w) {
		return
	}
	b, err := h.Store.GetBot(r.PathValue("id"))
	if err != nil || b.Disabled || (!b.Public && !canManageBot(caller, b)) {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return
	}
	botUser, err := h.Store.GetUser(b.ID)
	if err != nil {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return
	}
	// Someone who blocked the bot must unblock it first; the bot-side rules (DM permission) apply as for any user.
	if h.Store.IsBlocked(caller.ID, botUser.ID) {
		writeError(w, http.StatusForbidden, "apiErrors.dm_not_allowed")
		return
	}
	if ok, _ := h.Store.CanSendDM(caller.ID, botUser.ID); !ok {
		writeError(w, http.StatusForbidden, "apiErrors.dm_not_allowed")
		return
	}
	// Starting counts as the person initiating: it is what lets the bot write to them.
	if err := h.Store.RecordBotContact(b.ID, caller.ID); err != nil {
		writeInternal(w, "record bot contact", err, "apiErrors.interaction_failed")
		return
	}
	created := false
	ch := h.findDM(caller.ID, botUser.ID)
	if ch == nil {
		ch, err = h.Store.CreateChannel("", caller.ID, true, []string{caller.ID, botUser.ID}, h.KEK)
		if err != nil {
			writeInternal(w, "create bot DM", err, "apiErrors.channel_create_failed")
			return
		}
		for _, uid := range []string{caller.ID, botUser.ID} {
			if err := h.Store.AddMemberToChannel(ch.ID, uid, models.RoleMember); err != nil {
				logger.Warnf("api: bot DM %s: could not set member role of %s: %v", ch.ID, uid, err)
			}
		}
		if h.Hub != nil {
			h.Hub.BroadcastChannelCreated(ch)
		}
		created = true
	}
	delivered := false
	if h.Bots != nil {
		delivered = h.Bots.Deliver(b.ID, bots.EventBotStart, bots.StartEvent{
			ChannelID: ch.ID, User: bots.Author{ID: caller.ID, Username: caller.Username},
		})
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, StartBotResponse{ChannelID: ch.ID, Created: created, Delivered: delivered})
}
