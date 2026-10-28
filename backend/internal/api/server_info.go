package api

import "net/http"

// ServerInfoResponse is the public description of this server that login and
// register screens need before anyone is signed in.
type ServerInfoResponse struct {
	// RegistrationMode is "open", "invite_only" or "closed".
	RegistrationMode string `json:"registration_mode" example:"invite_only"`
	// NeedsOwner is true on a fresh server: the next account created becomes the owner.
	NeedsOwner bool `json:"needs_owner" example:"false"`
	// Demo is true on a public demo instance; clients show a notice that data resets and is not private.
	Demo bool `json:"demo" example:"false"`
	// TurnstileSiteKey is set when sign-ups need a Cloudflare Turnstile token; the register page renders the widget with it.
	TurnstileSiteKey string `json:"turnstile_site_key,omitempty" example:"0x4AAAAAAAexample"`
}

// GetServerInfo godoc
//
//	@Summary     Public server information
//	@Description Tells clients whether sign-up is open, invite-only or closed, so the register screen can show the right form.
//	@Description **Access:** Public.
//	@Tags        system
//	@Produce     json
//	@Success     200 {object} ServerInfoResponse
//	@Router      /api/server-info [get]
func (h *Handler) GetServerInfo(w http.ResponseWriter, r *http.Request) {
	info := ServerInfoResponse{
		RegistrationMode: h.registrationMode(),
		NeedsOwner:       !h.Store.HasOwner(),
		Demo:             h.Demo.Enabled,
	}
	if h.Captcha != nil {
		info.TurnstileSiteKey = h.TurnstileSiteKey
	}
	writeJSON(w, http.StatusOK, info)
}
