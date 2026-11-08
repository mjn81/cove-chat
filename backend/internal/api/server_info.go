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
	// CaptchaRequired is true when sign-up needs a solved proof-of-work challenge (GET /api/captcha/challenge).
	// It is false while the server still has no owner, because that first account is always allowed.
	CaptchaRequired bool `json:"captcha_required" example:"false"`
	// EmojiStyles lists the emoji style ids users may pick ("native" is the device's own font). Additive.
	EmojiStyles []string `json:"emoji_styles"`
	// DefaultEmojiStyle is the style new devices start with; it is one of EmojiStyles.
	DefaultEmojiStyle string `json:"default_emoji_style" example:"noto"`
	// UserStickersEnabled is false when the admin switched user-made sticker packs off.
	UserStickersEnabled bool `json:"user_stickers_enabled" example:"true"`
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
	info.CaptchaRequired = h.captchaOn() && !info.NeedsOwner
	emoji := h.emojiSettings()
	info.EmojiStyles, info.DefaultEmojiStyle = emoji.EnabledStyles, emoji.DefaultStyle
	info.UserStickersEnabled = h.packSettings().UserUploadsEnabled
	writeJSON(w, http.StatusOK, info)
}
