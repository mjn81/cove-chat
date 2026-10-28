package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"cove/backend/internal/auth"
	"cove/backend/internal/config"
	"cove/backend/internal/store"
)

// ============================
//  Auth Handlers
// ============================

// Register godoc
//
//	@Summary     Register a new account
//	@Description Creates a new Cove user account. Depends on the server's registration mode:
//	@Description **open** lets anyone sign up, **invite_only** needs a valid invite_code, **closed** refuses everyone.
//	@Description The very first account on a fresh server is always accepted and becomes the server owner.
//	@Description **Access:** Public.
//	@Tags        auth
//	@Accept      json
//	@Produce     json
//	@Param       body body RegisterRequest true "Registration payload"
//	@Success     201 {object} RegisterResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse "registration closed, invite required or invite not valid"
//	@Failure     409 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/register [post]
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "auth.errors.invalid_json")
		return
	}
	if len(body.Username) < 3 || len(body.Password) < 8 {
		writeError(w, http.StatusBadRequest, "auth.errors.invalid_length")
		return
	}

	mode := h.registrationMode()
	// A fresh server has no owner yet; its first account must always be able
	// to register, otherwise a closed or invite-only server could never be set up.
	bootstrap := !h.Store.HasOwner()

	reservedCode := ""
	if !bootstrap {
		switch mode {
		case config.RegistrationClosed:
			writeError(w, http.StatusForbidden, "auth.errors.registration_closed")
			return
		case config.RegistrationInviteOnly:
			code := body.InviteCode
			if code == "" {
				writeError(w, http.StatusForbidden, "auth.errors.invite_required")
				return
			}
			// Take the use first (atomically); give it back if the account is not created.
			if err := h.Store.ReserveInviteUse(code, time.Now()); err != nil {
				if errors.Is(err, store.ErrInviteInvalid) {
					writeError(w, http.StatusForbidden, "auth.errors.invite_invalid")
				} else {
					writeError(w, http.StatusInternalServerError, "auth.errors.session_failed")
				}
				return
			}
			reservedCode = code
		}
	}

	u, err := h.Store.CreateUser(body.Username, body.Password, "localhost")
	if err != nil {
		if reservedCode != "" {
			h.Store.ReleaseInviteUse(reservedCode)
		}
		writeError(w, http.StatusConflict, "auth.errors.username_taken")
		return
	}

	// Claim ownership if still unclaimed. Exactly one concurrent first
	// sign-up wins; a loser on a non-open server must not stay registered.
	if bootstrap {
		claimed, cerr := h.Store.ClaimOwner(u)
		if cerr != nil {
			_ = h.Store.PurgeUser(u.ID)
			writeError(w, http.StatusInternalServerError, "auth.errors.session_failed")
			return
		}
		if !claimed && mode != config.RegistrationOpen {
			_ = h.Store.PurgeUser(u.ID)
			if mode == config.RegistrationClosed {
				writeError(w, http.StatusForbidden, "auth.errors.registration_closed")
			} else {
				writeError(w, http.StatusForbidden, "auth.errors.invite_required")
			}
			return
		}
	}
	writeJSON(w, http.StatusCreated, RegisterResponse{ID: u.ID, Username: u.Username})
}

// Login godoc
//
//	@Summary     Log in and obtain a session token
//	@Tags        auth
//	@Accept      json
//	@Produce     json
//	@Param       body body LoginRequest true "Login credentials"
//	@Success     200 {object} LoginResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Router      /api/login [post]
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "auth.errors.invalid_json")
		return
	}
	u, err := h.Store.AuthenticateUser(body.Username, body.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "auth.errors.invalid_credentials")
		return
	}
	token, err := h.Sessions.Create(u.ID, u.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "auth.errors.session_failed")
		return
	}
	csrfToken, err := auth.GenerateCSRFToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "auth.errors.session_failed")
		return
	}
	// Set cookies for the web client. The desktop (Wails) client ignores
	// these and continues to use the `token` field below via the
	// Authorization header — see auth.SetSessionCookies for why this
	// cookie+CSRF scheme is architecturally unusable cross-origin, not just
	// a stopgap.
	auth.SetSessionCookies(w, token, csrfToken, h.TokenTTL, !h.IsDev)

	writeJSON(w, http.StatusOK, LoginResponse{
		ID:               u.ID,
		Username:         u.Username,
		Domain:           u.Domain,
		Status:           u.Status,
		StatusPreference: u.StatusPreference,
		AvatarID:         u.AvatarID,
		BannerColor:      u.BannerColor,
		CustomMsg:        u.CustomMsg,
		ServerRole:       u.ServerRole,
		Token:            token,
	})
}

// Logout godoc
//
//	@Summary     Log out and invalidate session
//	@Tags        auth
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} StatusResponse
//	@Router      /api/logout [post]
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	token, _, _ := auth.ResolveToken(r)
	session := auth.SessionFromContext(r.Context())
	if session != nil {
		_ = h.Store.SetPresence(session.UserID, "offline")
	}
	h.Sessions.Delete(token)
	auth.ClearSessionCookies(w, !h.IsDev)

	writeJSON(w, http.StatusOK, StatusResponse{Status: "logged out"})
}
