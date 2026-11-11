package api

import (
	"net/http"
	"time"

	"cove/backend/internal/auth"
)

// ClearHistory godoc
//
//	@Summary     Clear a direct message's history for yourself
//	@Description Hides every message sent so far from the caller only and keeps the conversation in their list. The
//	@Description other side (a person or a bot) keeps everything, and nobody else can clear your side. Direct messages
//	@Description only; to remove the conversation from your list use `DELETE /api/channels/{id}`.
//	@Description **Access:** Channel Member (own side only).
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/clear [post]
func (h *Handler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeInternal(w, "clear history "+ch.ID+": members", err, "apiErrors.members_load_failed")
		return
	}
	if !ch.IsDM(len(members)) {
		writeError(w, http.StatusBadRequest, "apiErrors.clear_dm_only")
		return
	}
	if err := h.Store.ClearHistoryForUser(session.UserID, ch.ID, time.Now().UTC()); err != nil {
		writeInternal(w, "clear history "+ch.ID, err, "apiErrors.channel_clear_failed")
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}
