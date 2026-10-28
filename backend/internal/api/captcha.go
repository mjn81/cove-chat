package api

import (
	"net/http"

	"cove/backend/internal/logger"
)

// maxCaptchaPayloadLen bounds the solution accepted from clients; a real payload is a few hundred bytes.
const maxCaptchaPayloadLen = 4096

// captchaOn reports whether sign-ups currently need a solved challenge. It is a live setting (the admin
// panel can flip it without a restart) and needs the challenge service to exist.
func (h *Handler) captchaOn() bool {
	if h.Captcha == nil || h.Settings == nil {
		return false
	}
	enabled, _ := h.Settings.Captcha()
	return enabled
}

// GetCaptchaChallenge godoc
//
//	@Summary     Get a sign-up proof-of-work challenge
//	@Description Returns an ALTCHA v1 challenge. The client searches for the number n in [0, maxnumber] with
//	@Description SHA-256(salt + n) equal to `challenge`, then sends the base64 JSON
//	@Description {algorithm, challenge, number, salt, signature} as `captcha` when registering.
//	@Description Each solution works once and expires after a few minutes. Returns 404 when the check is off.
//	@Description **Access:** Public.
//	@Tags        auth
//	@Produce     json
//	@Success     200 {object} CaptchaChallengeResponse
//	@Failure     404 {object} ErrorResponse "the sign-up check is not enabled on this server"
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/captcha/challenge [get]
func (h *Handler) GetCaptchaChallenge(w http.ResponseWriter, r *http.Request) {
	if !h.captchaOn() {
		writeError(w, http.StatusNotFound, "auth.errors.captcha_disabled")
		return
	}
	_, maxNumber := h.Settings.Captcha()
	ch, err := h.Captcha.NewChallenge(maxNumber)
	if err != nil {
		logger.Errorf("captcha challenge: %v", err)
		writeError(w, http.StatusInternalServerError, "auth.errors.session_failed")
		return
	}
	// A challenge is single use, so no cache may hand the same one to two clients.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, CaptchaChallengeResponse(ch))
}

// captchaDenied checks the solution sent with a sign-up and returns the HTTP status and i18n error key to
// reject with, or 0 when the sign-up may proceed. Any problem with a present payload (forged, expired,
// reused) is one generic failure so the endpoint does not help someone tune an attack.
func (h *Handler) captchaDenied(payload string) (int, string) {
	if payload == "" {
		return http.StatusBadRequest, "auth.errors.captcha_required"
	}
	if len(payload) > maxCaptchaPayloadLen {
		return http.StatusForbidden, "auth.errors.captcha_failed"
	}
	if err := h.Captcha.Verify(payload); err != nil {
		return http.StatusForbidden, "auth.errors.captcha_failed"
	}
	return 0, ""
}
