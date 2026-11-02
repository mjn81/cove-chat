package api

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"cove/backend/internal/auth"
	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

const (
	// minUserSearchRunes is the shortest search term accepted; one letter would just enumerate the user base.
	minUserSearchRunes = 2
	// maxUserSearchResults caps a search so the (bare-array) response stays bounded.
	maxUserSearchResults = 50
)

// Allowed values of the profile enums. Anything else is a 400, never silently ignored.
var (
	statusPreferences      = map[string]bool{"auto": true, "online": true, "away": true, "dnd": true, "offline": true}
	channelAddPermissions  = map[string]bool{"everyone": true, "friends": true, "nobody": true}
	dmPermissions          = channelAddPermissions
	friendRequestPermitted = map[string]bool{"everyone": true, "nobody": true}
)

// userNotFoundOr writes 404 when err is a missing record and a logged 500 for any other failure.
func userNotFoundOr(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeInternal(w, op, err, "could not load user")
}

// ============================
//  User Handlers
// ============================

// Me godoc
//
//	@Summary     Get current authenticated user
//	@Description **Access:** Authenticated.
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} UserResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/me [get]
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	u, err := h.Store.GetUser(session.UserID)
	if err != nil {
		userNotFoundOr(w, "me", err)
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
//	@Description Deletes the caller's account. The server owner must transfer ownership first.
//	@Description **Access:** Authenticated (self only).
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
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
		writeInternal(w, "delete account "+session.UserID, err, "failed to delete account")
		return
	}

	h.Sessions.Delete(token)
	auth.ClearSessionCookies(w, !h.IsDev)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// UpdateProfile godoc
//
//	@Summary     Update current user profile
//	@Description Partial update: only the fields present are changed. Changing the password needs `old_password` and signs
//	@Description out every other device. Enumerated fields reject unknown values with `validation_failed`:
//	@Description `status_preference` auto|online|away|dnd|offline, `allow_channel_adds` and `dm_permission`
//	@Description everyone|friends|nobody, `friend_request_permission` everyone|nobody.
//	@Description **Access:** Authenticated (self only).
//	@Tags        users
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body UpdateUserRequest true "Update payload"
//	@Success     200 {object} UserResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/users/me [patch]
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	var body UpdateUserRequest
	if !decodeJSON(w, r, &body, "invalid JSON") {
		return
	}
	if msg := validateProfileEnums(&body); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	u, err := h.Store.GetUser(session.UserID)
	if err != nil {
		userNotFoundOr(w, "update profile", err)
		return
	}
	passwordChanged := false

	if body.Username != "" && body.Username != u.Username {
		if len(body.Username) < 3 {
			writeError(w, http.StatusBadRequest, "username too short")
			return
		}
		if store.IsReservedUsername(body.Username) {
			writeError(w, http.StatusBadRequest, "username is reserved")
			return
		}
		// Check if username is already taken by someone else
		existing, lerr := h.Store.GetUserByUsername(body.Username)
		if lerr != nil && !errors.Is(lerr, db.ErrNotFound) {
			writeInternal(w, "update profile: username lookup", lerr, "failed to update profile")
			return
		}
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
			writeInternal(w, "update profile: hash password", err, "failed to update profile")
			return
		}
		u.PwdHash = pwdHash
		passwordChanged = true
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
		u.AllowChannelAdds = *body.AllowChannelAdds
	}
	if body.DMPermission != nil {
		u.DMPermission = *body.DMPermission
	}
	if body.FriendRequestPermission != nil {
		u.FriendRequestPermission = *body.FriendRequestPermission
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
		writeInternal(w, "update profile: save", err, "failed to update profile")
		return
	}
	if passwordChanged {
		// A new password must lock out anyone holding the old one's sessions; the device making the change stays in.
		h.disconnectSessions(h.Sessions.DeleteOthers(session.UserID, session.ID)...)
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

// validateProfileEnums returns a message for the first enumerated field holding a value outside its whitelist, or
// "" when all are acceptable.
func validateProfileEnums(b *UpdateUserRequest) string {
	switch {
	case b.StatusPreference != nil && !statusPreferences[*b.StatusPreference]:
		return "invalid status_preference"
	case b.AllowChannelAdds != nil && !channelAddPermissions[*b.AllowChannelAdds]:
		return "invalid allow_channel_adds"
	case b.DMPermission != nil && !dmPermissions[*b.DMPermission]:
		return "invalid dm_permission"
	case b.FriendRequestPermission != nil && !friendRequestPermitted[*b.FriendRequestPermission]:
		return "invalid friend_request_permission"
	}
	return ""
}

// SearchUsers godoc
//
//	@Summary     Search globally for users by username
//	@Description Case-insensitive substring match. The query must be at least 2 characters (shorter ones return an empty
//	@Description array) and at most 50 users are returned, as a bare JSON array.
//	@Description **Access:** Authenticated.
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Param       q query string false "Search query to filter by username (min 2 characters)"
//	@Success     200 {array} UserResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/users [get]
func (h *Handler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) < minUserSearchRunes {
		writeJSON(w, http.StatusOK, []UserResponse{})
		return
	}
	users, err := h.Store.SearchUsers(q)
	if err != nil {
		writeInternal(w, "search users", err, "search failed")
		return
	}
	if len(users) > maxUserSearchResults {
		users = users[:maxUserSearchResults]
	}

	res := make([]UserResponse, 0, len(users))
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
	writeJSON(w, http.StatusOK, res)
}

// GetUser godoc
//
//	@Summary     Get a user by ID
//	@Description Public profile of any user. Privacy settings are only included for the caller's own account.
//	@Description **Access:** Authenticated.
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "User ID"
//	@Success     200 {object} UserResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/users/{id} [get]
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := h.Store.GetUser(id)
	if err != nil {
		userNotFoundOr(w, "get user "+id, err)
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
//	@Description **Access:** Authenticated.
//	@Tags        users
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "User ID"
//	@Success     200 {object} PresenceResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/users/{id}/presence [get]
func (h *Handler) GetPresence(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	p, err := h.Store.GetPresence(userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "presence not found")
			return
		}
		writeInternal(w, "get presence "+userID, err, "could not load presence")
		return
	}
	writeJSON(w, http.StatusOK, PresenceResponse{LastSeen: p.LastSeen, CurrentStatus: p.CurrentStatus})
}
