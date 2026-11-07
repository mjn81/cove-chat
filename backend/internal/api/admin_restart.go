package api

import (
	"net/http"
	"time"

	"cove/backend/internal/apistd"
	"cove/update"
)

// restartRefusal returns the i18n key explaining why this install cannot restart itself, or "" when it can.
// Docker and unknown installs are refused because re-executing the binary would orphan the container's or the
// service manager's process; they must be restarted by whatever supervises them.
func (u *Updater) restartRefusal() string {
	switch {
	case u.Mode == update.ModeDocker:
		return "admin.errors.restart_docker"
	case u.Mode != update.ModeBinary || u.Restart == nil:
		return "admin.errors.restart_unsupported"
	}
	return ""
}

// AdminRestart godoc
//
//	@Summary     Restart the server
//	@Description Gracefully shuts the server down and starts it again, for example to apply settings flagged as needing a restart. Answers 202 first, then restarts after a short delay; everyone is disconnected for a few seconds. Refused with 409 in docker mode (restart the container) or when the install cannot restart itself.
//	@Description **Access:** Server Owner, with their password.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body RestartRequest true "Owner password"
//	@Success     202 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     501 {object} ErrorResponse
//	@Router      /api/admin/restart [post]
func (h *Handler) AdminRestart(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body RestartRequest
	if !decodeJSONLimit(w, r, &body, 1<<10, "admin.errors.invalid_json") {
		return
	}
	// Same step-up as every other dangerous admin action: a stolen session token alone must not take the server down.
	if !h.confirmPassword(w, actor, body.Password) {
		return
	}
	if h.Updater == nil {
		writeErrorCode(w, http.StatusNotImplemented, apistd.CodeFeatureUnsupported, "admin.errors.restart_unsupported")
		return
	}
	if key := h.Updater.restartRefusal(); key != "" {
		writeErrorCode(w, http.StatusConflict, apistd.CodeFeatureUnsupported, key)
		return
	}
	h.audit(actor, "server.restart", "")
	writeJSON(w, http.StatusAccepted, StatusResponse{Status: "success"})
	// After the response so the owner's browser receives it before the connection is torn down.
	restart, delay := h.Updater.Restart, h.Updater.RestartDelay
	go func() {
		time.Sleep(delay)
		restart()
	}()
}
