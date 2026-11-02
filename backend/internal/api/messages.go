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

// maxMessagePage is the largest page ListMessages will return.
const maxMessagePage = 500

// ListMessages godoc
//
//	@Summary     List recent messages for a channel
//	@Description Returns messages newest-first as a bare JSON array. Supports cursor pagination with `before`; an invalid `limit` is rejected with 400.
//	@Description **Access:** Channel Member.
//	@Tags        messages
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id     path  string true  "Channel ID"
//	@Param       limit  query int    false "Max messages to return (1-500, default 250)"
//	@Param       before query string false "KSUID string cursor for pagination"
//	@Success     200 {array}  models.Message
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/messages [get]
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	limit := 250
	before := r.URL.Query().Get("before")

	if l := r.URL.Query().Get("limit"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n < 1 || n > maxMessagePage {
			writeError(w, http.StatusBadRequest, "limit must be a number between 1 and 500")
			return
		}
		limit = n
	}

	msgs, err := h.Store.ListMessages(ch.ID, before, limit)
	if err != nil {
		writeInternal(w, "list messages of channel "+ch.ID, err, "could not fetch messages")
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
