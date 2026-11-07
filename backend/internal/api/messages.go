package api

import (
	"net/http"

	"cove/backend/internal/apistd"
	"cove/backend/internal/auth"
	"cove/backend/internal/models"
)

// ============================
//  Message Handlers
// ============================

// msgCursorKind namespaces message cursors; the value is the id of the oldest message of the page just served.
const msgCursorKind = "msg"

// ListMessages godoc
//
//	@Summary     List messages of a channel
//	@Description Paged (`{items, next_cursor}`), **newest first**: the first page is the latest messages and
//	@Description `next_cursor` points at the next older page (it encodes the position of the oldest message returned).
//	@Description `next_cursor` is empty when the start of the conversation was reached. A malformed `cursor` or an
//	@Description out-of-range `limit` is rejected with 400 `validation_failed`.
//	@Description **Access:** Channel Member.
//	@Tags        messages
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id     path  string true  "Channel ID"
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor from the previous page's next_cursor"
//	@Success     200 {object} MessagePageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/messages [get]
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	limit, rawCursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	before, err := apistd.DecodeCursor(msgCursorKind, rawCursor)
	if err != nil {
		writeBadCursor(w, err)
		return
	}

	// One extra row tells us whether an older page exists without a second query.
	msgs, err := h.Store.ListMessages(ch.ID, before, limit+1)
	if err != nil {
		writeInternal(w, "list messages of channel "+ch.ID, err, "apiErrors.messages_load_failed")
		return
	}
	hasMore := len(msgs) > limit
	if hasMore {
		msgs = msgs[:limit]
	}
	if msgs == nil {
		msgs = []*models.Message{}
	}

	// Messages are newest-first, so everything older than the user's "clear history" mark is a suffix: once one is
	// dropped there is nothing further to page to.
	if session != nil {
		if uc, err := h.Store.GetUserChannel(session.UserID, ch.ID); err == nil && uc != nil && !uc.ClearedAt.IsZero() {
			filtered := make([]*models.Message, 0, len(msgs))
			for _, m := range msgs {
				if m.SentAt.After(uc.ClearedAt) {
					filtered = append(filtered, m)
				}
			}
			if len(filtered) < len(msgs) {
				hasMore = false
			}
			msgs = filtered
		}
	}

	next := ""
	if hasMore && len(msgs) > 0 {
		next = apistd.EncodeCursor(msgCursorKind, msgs[len(msgs)-1].ID)
	}
	writeJSON(w, http.StatusOK, MessagePageResponse{Items: msgs, NextCursor: next})
}
