package api

import (
	"cove/backend/internal/auth"
	"cove/backend/internal/models"
	"net/http"
	"strconv"
)

// ============================
//  Message Handlers
// ============================

// ListMessages godoc
//
//	@Summary     List recent messages for a channel
//	@Description Returns messages newest-first. Supports cursor pagination.
//	@Tags        messages
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id     path  string true  "Channel ID"
//	@Param       limit  query int    false "Max messages to return (default 250, max 500)"
//	@Param       before query string false "KSUID string cursor for pagination"
//	@Success     200 {array}  models.Message
//	@Router      /api/channels/{id}/messages [get]
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	limit := 250
	before := r.URL.Query().Get("before")

	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}

	msgs, err := h.Store.ListMessages(ch.ID, before, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch messages")
		return
	}
	if msgs == nil {
		msgs = []*models.Message{}
	}

	if session != nil {
		if uc, err := h.Store.GetUserChannel(session.UserID, ch.ID); err == nil && uc != nil && !uc.ClearedAt.IsZero() {
			filtered := make([]*models.Message, 0, len(msgs))
			for _, m := range msgs {
				if m.SentAt.After(uc.ClearedAt) {
					filtered = append(filtered, m)
				}
			}
			msgs = filtered
		}
	}

	writeJSON(w, http.StatusOK, msgs)
}
