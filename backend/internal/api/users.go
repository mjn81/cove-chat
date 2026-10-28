package api

import (
	"cove/backend/internal/auth"
	"cove/backend/internal/crypto"
	"cove/backend/internal/models"
	"encoding/json"
	"net/http"
)

// ============================
//  User Handlers
// ============================

// Me godoc
//
//	@Summary     Get current authenticated user
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} UserResponse
//	@Router      /api/me [get]
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	u, err := h.Store.GetUser(session.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, UserResponse{
		ID:                      u.ID,
		Username:                u.Username,
		Domain:                  u.Domain,
		Status:                  u.Status,
		StatusPreference:        u.StatusPreference,
		AvatarID:                u.AvatarID,
		AvatarIDs:               u.AvatarIDs,
		BannerColor:             u.BannerColor,
		CustomMsg:               u.CustomMsg,
		AllowChannelAdds:        u.AllowChannelAdds,
		DMPermission:            u.DMPermission,
		FriendRequestPermission: u.FriendRequestPermission,
		ServerRole:              u.ServerRole,
	})
}

// DeleteAccount godoc
//
//	@Summary     Delete current user account
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} StatusResponse
//	@Router      /api/users/me [delete]
func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	token, _, _ := auth.ResolveToken(r)

	// The owner cannot vanish from under the server: they must hand the role
	// over first, otherwise nobody could ever reach the admin panel again.
	if me, err := h.Store.GetUser(session.UserID); err == nil && me.ServerRole == models.ServerRoleOwner {
		writeError(w, http.StatusForbidden, "admin.errors.owner_cannot_delete")
		return
	}

	if err := h.Store.DeleteUser(session.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete account")
		return
	}

	h.Sessions.Delete(token)
	auth.ClearSessionCookies(w, !h.IsDev)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "account deleted"})
}

// UpdateProfile godoc
//
//	@Summary     Update current user profile
//	@Tags        users
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body UpdateUserRequest true "Update payload"
//	@Success     200 {object} UserResponse
//	@Router      /api/users/me [patch]
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	var body UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	u, err := h.Store.GetUser(session.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	if body.Username != "" && body.Username != u.Username {
		if len(body.Username) < 3 {
			writeError(w, http.StatusBadRequest, "username too short")
			return
		}
		// Check if username is already taken by someone else
		existing, _ := h.Store.GetUserByUsername(body.Username)
		if existing != nil && existing.ID != u.ID {
			writeError(w, http.StatusConflict, "username already taken")
			return
		}
		u.Username = body.Username
		if session != nil {
			token, _, _ := auth.ResolveToken(r)
			if token != "" {
				h.Sessions.UpdateUsername(token, u.Username)
			}
		}
	}

	if body.Password != "" {
		if len(body.Password) < 8 {
			writeError(w, http.StatusBadRequest, "password too short")
			return
		}
		// Verify old password
		valid, err := crypto.VerifyPassword(body.OldPassword, u.PwdHash)
		if err != nil || !valid {
			writeError(w, http.StatusBadRequest, "invalid current password")
			return
		}

		pwdHash, err := crypto.HashPassword(body.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to hash password")
			return
		}
		u.PwdHash = pwdHash
	}

	if body.AvatarID != nil {
		u.AvatarID = *body.AvatarID
		if u.AvatarID != "" {
			exists := false
			for _, id := range u.AvatarIDs {
				if id == u.AvatarID {
					exists = true
					break
				}
			}
			if !exists {
				u.AvatarIDs = append([]string{u.AvatarID}, u.AvatarIDs...)
				if len(u.AvatarIDs) > 5 {
					u.AvatarIDs = u.AvatarIDs[:5]
				}
			}
		}
	}
	if body.AvatarIDs != nil {
		gallery := *body.AvatarIDs
		if len(gallery) > 5 {
			gallery = gallery[:5]
		}
		u.AvatarIDs = gallery
		if len(gallery) > 0 {
			u.AvatarID = gallery[0]
		} else {
			u.AvatarID = ""
		}
	}
	if body.BannerColor != nil {
		u.BannerColor = *body.BannerColor
	}
	if body.CustomMsg != nil {
		u.CustomMsg = *body.CustomMsg
	}
	if body.AllowChannelAdds != nil {
		val := *body.AllowChannelAdds
		if val == "everyone" || val == "friends" || val == "nobody" {
			u.AllowChannelAdds = val
		}
	}
	if body.DMPermission != nil {
		val := *body.DMPermission
		if val == "everyone" || val == "friends" || val == "nobody" {
			u.DMPermission = val
		}
	}
	if body.FriendRequestPermission != nil {
		val := *body.FriendRequestPermission
		if val == "everyone" || val == "nobody" {
			u.FriendRequestPermission = val
		}
	}
	if body.StatusPreference != nil {
		u.StatusPreference = *body.StatusPreference
		// If preference is manual, update active status to match
		if u.StatusPreference != "auto" {
			u.Status = u.StatusPreference
		} else {
			// If setting to auto, assume online while they are making the change
			u.Status = "online"
		}

		// Update presence in store
		_ = h.Store.SetPresence(u.ID, u.Status)
		// Broadcast to all clients
		if h.Hub != nil {
			h.Hub.BroadcastPresence(u.ID, u.Status)
		}
	}

	if err := h.Store.UpdateUser(u); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}

	writeJSON(w, http.StatusOK, UserResponse{
		ID:                      u.ID,
		Username:                u.Username,
		Domain:                  u.Domain,
		Status:                  u.Status,
		StatusPreference:        u.StatusPreference,
		AvatarID:                u.AvatarID,
		AvatarIDs:               u.AvatarIDs,
		BannerColor:             u.BannerColor,
		CustomMsg:               u.CustomMsg,
		AllowChannelAdds:        u.AllowChannelAdds,
		DMPermission:            u.DMPermission,
		FriendRequestPermission: u.FriendRequestPermission,
	})
}

// SearchUsers godoc
//
//	@Summary     Search globally for users by username
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Param       q query string false "Search query to filter by username"
//	@Success     200 {array} UserResponse
//	@Router      /api/users [get]
func (h *Handler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, []UserResponse{})
		return
	}
	users, err := h.Store.SearchUsers(q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}

	var res []UserResponse
	for _, u := range users {
		res = append(res, UserResponse{
			ID:          u.ID,
			Username:    u.Username,
			Domain:      u.Domain,
			Status:      u.Status,
			AvatarID:    u.AvatarID,
			AvatarIDs:   u.AvatarIDs,
			BannerColor: u.BannerColor,
			CustomMsg:   u.CustomMsg,
		})
	}
	if res == nil {
		res = []UserResponse{}
	}
	writeJSON(w, http.StatusOK, res)
}

// GetUser godoc
//
//	@Summary     Get a user by ID
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "User ID"
//	@Success     200 {object} UserResponse
//	@Router      /api/users/{id} [get]
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := h.Store.GetUser(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	resp := UserResponse{
		ID:               u.ID,
		Username:         u.Username,
		Domain:           u.Domain,
		Status:           u.Status,
		StatusPreference: u.StatusPreference,
		AvatarID:         u.AvatarID,
		AvatarIDs:        u.AvatarIDs,
		BannerColor:      u.BannerColor,
		CustomMsg:        u.CustomMsg,
	}
	session := auth.SessionFromContext(r.Context())
	if session != nil && session.UserID == u.ID {
		resp.AllowChannelAdds = u.AllowChannelAdds
		resp.DMPermission = u.DMPermission
		resp.FriendRequestPermission = u.FriendRequestPermission
	}
	writeJSON(w, http.StatusOK, resp)
}

// ============================
//  Presence Handlers
// ============================

// GetPresence godoc
//
//	@Summary     Get presence status for a user
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "User ID"
//	@Success     200 {object} models.Presence
//	@Router      /api/users/{id}/presence [get]
func (h *Handler) GetPresence(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	p, err := h.Store.GetPresence(userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "presence not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}
