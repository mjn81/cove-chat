package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"cove/backend/internal/logger"
	"cove/backend/internal/middleware"
)

// turnstileEndpoint is Cloudflare's server-side token verification URL.
const turnstileEndpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// maxCaptchaTokenLen bounds the token accepted from clients; Cloudflare documents tokens of at most 2048 characters.
const maxCaptchaTokenLen = 2048

// CaptchaVerifier checks a bot-protection token produced in the client. ok is false for a token that is
// invalid, expired or reused; err is non-nil only when the verification service itself could not be reached,
// so callers can fail closed without blaming the user.
type CaptchaVerifier interface {
	Verify(ctx context.Context, token, ip string) (ok bool, err error)
}

type turnstileVerifier struct {
	secret   string
	endpoint string
	client   *http.Client
}

// NewTurnstileVerifier returns a verifier backed by Cloudflare Turnstile using the given secret key.
func NewTurnstileVerifier(secret string) CaptchaVerifier {
	return NewTurnstileVerifierAt(secret, turnstileEndpoint)
}

// NewTurnstileVerifierAt is NewTurnstileVerifier against a custom siteverify endpoint (used by tests).
func NewTurnstileVerifierAt(secret, endpoint string) CaptchaVerifier {
	return &turnstileVerifier{secret: secret, endpoint: endpoint, client: &http.Client{Timeout: 5 * time.Second}}
}

// Verify implements CaptchaVerifier.
func (v *turnstileVerifier) Verify(ctx context.Context, token, ip string) (bool, error) {
	form := url.Values{"secret": {v.secret}, "response": {token}}
	if ip != "" {
		form.Set("remoteip", ip)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return false, fmt.Errorf("build siteverify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := v.client.Do(req)
	if err != nil {
		return false, fmt.Errorf("siteverify request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("siteverify returned status %d", resp.StatusCode)
	}
	var out struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out); err != nil {
		return false, fmt.Errorf("decode siteverify response: %w", err)
	}
	return out.Success, nil
}

// captchaDenied applies the sign-up bot check and returns the HTTP status and i18n error key to reject with,
// or 0 when the sign-up may proceed. It fails closed: if the verification service is unreachable, sign-ups
// are refused with 503 rather than waved through.
func (h *Handler) captchaDenied(r *http.Request, token string) (int, string) {
	if token == "" {
		return http.StatusBadRequest, "auth.errors.captcha_required"
	}
	if len(token) > maxCaptchaTokenLen {
		return http.StatusForbidden, "auth.errors.captcha_failed"
	}
	ok, err := h.Captcha.Verify(r.Context(), token, middleware.ClientIP(r))
	if err != nil {
		logger.Warnf("turnstile verification unavailable: %v", err)
		return http.StatusServiceUnavailable, "auth.errors.captcha_unavailable"
	}
	if !ok {
		return http.StatusForbidden, "auth.errors.captcha_failed"
	}
	return 0, ""
}
