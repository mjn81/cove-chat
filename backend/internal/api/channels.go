package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/models"
)

// ============================
//  Channel Handlers
// ============================

// CreateChannel godoc
//	@Summary     Create a channel or direct message
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body CreateChannelRequest true "Channel payload"
//	@Success     201 {object} models.Channel
//	@Router      /api/channels [post]
func (h *Handler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	var body CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	memberSet := uniqueStrings(append(body.Members, session.UserID))

	// DM de-duplication: if this is a DM, check if it already exists
	isDM := (&models.Channel{Name: body.Name}).IsDM(len(memberSet))
	if isDM {
		existingByMe, err := h.Store.ListUserChannels(session.UserID)
		if err == nil {
			for _, ex := range existingByMe {
				if ex.Name != "" {
					continue
				}

				exMembers, _ := h.Store.GetChannelMembers(ex.ID)
				if ex.IsDM(len(exMembers)) {
					matches := 0
					for _, m1 := range memberSet {
						for _, m2 := range exMembers {
							if m1 == m2.UserID {
								matches++
							}
						}
					}
					if matches == 2 {
						writeJSON(w, http.StatusOK, h.toChannelResponse(ex, session.UserID))
						return
					}
				}
			}
		}
	}

	ch, err := h.Store.CreateChannel(body.Name, session.UserID, body.IsPrivate, memberSet, h.KEK)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "channel creation failed")
		return
	}

	// For DMs, override RoleOwner back to RoleMember (user's request)
	if isDM {
		for _, uid := range memberSet {
			if err := h.Store.AddMemberToChannel(ch.ID, uid, models.RoleMember); err != nil {
				logger.Warnf("api: CreateChannel: failed to downgrade DM member %s to RoleMember in channel %s: %v", uid, ch.ID, err)
			}
		}
	}

	// Notify all members via WebSocket
	if h.Hub != nil {
		h.Hub.BroadcastChannelCreated(ch)
	}

	writeJSON(w, http.StatusCreated, h.toChannelResponse(ch, session.UserID))
}

//	@Summary     List channels for the current user
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {array} models.Channel
//	@Router      /api/channels [get]
func (h *Handler) ListChannels(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())

	channels, err := h.Store.ListUserChannels(session.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list channels")
		return
	}
	
	resp := make([]ChannelResponse, 0)
	for _, ch := range channels {
		resp = append(resp, h.toChannelResponse(ch, session.UserID))
	}
	writeJSON(w, http.StatusOK, resp)
}

// ExploreChannels godoc
//	@Summary     Search public channels
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       q query string false "Search query"
//	@Success     200 {array} ExploreChannelResponse
//	@Router      /api/channels/explore [get]
func (h *Handler) ExploreChannels(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("q")
	allChannels, err := h.Store.ListAllChannels()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list all channels")
		return
	}

	filtered := make([]ExploreChannelResponse, 0)
	searchQuery := strings.ToLower(search)

	for _, ch := range allChannels {
		if ch.IsPrivate {
			continue // Hide private
		}
		
		members, _ := h.Store.GetChannelMembers(ch.ID)

		if search == "" || strings.Contains(strings.ToLower(ch.Name), searchQuery) {
			filtered = append(filtered, ExploreChannelResponse{
				ID:          ch.ID,
				Name:        ch.Name,
				InviteLink:  ch.InviteLink,
				MemberCount: len(members),
				CreatedAt:   ch.CreatedAt,
			})
		}
	}

	writeJSON(w, http.StatusOK, filtered)
}

// GetChannel godoc
//	@Summary     Get a channel by ID
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} models.Channel
//	@Router      /api/channels/{id} [get]
func (h *Handler) GetChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// UpdateChannel godoc
//	@Summary     Update channel settings
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string               true "Channel ID"
//	@Param       body body UpdateChannelRequest true "Update payload"
//	@Success     200 {object} ChannelResponse
//	@Router      /api/channels/{id} [patch]
func (h *Handler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())

	// Permission check: Admin or Owner
	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || uc.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var body UpdateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if body.Name != nil {
		newName := strings.TrimSpace(*body.Name)
		if newName == "" {
			writeError(w, http.StatusBadRequest, "channel name cannot be empty")
			return
		}
		ch.Name = newName
	}
	if body.IsPrivate != nil {
		ch.IsPrivate = *body.IsPrivate
	}

	if err := h.Store.UpdateChannel(ch); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update channel")
		return
	}
	
	if h.Hub != nil {
		h.Hub.BroadcastChannelUpdated(ch)
	}
	
	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// DeleteChannel godoc
//	@Summary     Delete a channel
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} StatusResponse
//	@Router      /api/channels/{id} [delete]
func (h *Handler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())

	// Permission check: Owner only for deletion
	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || uc.Role < models.RoleOwner {
		writeError(w, http.StatusForbidden, "only the owner can delete the channel")
		return
	}

	if err := h.Store.DeleteChannel(ch.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete channel")
		return
	}

	writeJSON(w, http.StatusOK, StatusResponse{Status: "channel deleted"})
}

// JoinChannel godoc
//	@Summary     Join a channel via a unique invite link
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       link path string true "Unique Channel Invite Link"
//	@Success     200 {object} StatusResponse
//	@Router      /api/join/{link} [post]
func (h *Handler) JoinChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	link := r.PathValue("link")

	ch, err := h.Store.GetChannelByInviteLink(link)
	if err != nil {
		writeError(w, http.StatusNotFound, "channel not found")
		return
	}

	// Check if already a member
	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err == nil && uc.Status == models.StatusActive {
		writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
		return
	}

	if err := h.Store.AddMemberToChannel(ch.ID, session.UserID, models.RoleMember); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to join channel")
		return
	}

	// Notify members
	if h.Hub != nil {
		h.Hub.BroadcastMemberJoined(ch.ID, session.UserID)
	}

	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// GetChannelMembers godoc
//	@Summary     List members of a channel
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {array} UserResponse
//	@Router      /api/channels/{id}/members [get]
func (h *Handler) GetChannelMembers(w http.ResponseWriter, r *http.Request) {
	ch := ChannelFromContext(r.Context())
	memberList, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeJSON(w, http.StatusOK, []UserResponse{})
		return
	}

	var members []UserResponse
	for _, m := range memberList {
		if u, err := h.Store.GetUser(m.UserID); err == nil {
			members = append(members, UserResponse{
				ID: u.ID,
				Username: u.Username,
				Domain: u.Domain,
				Status: u.Status,
				AvatarID: u.AvatarID,
			})
		}
	}
	writeJSON(w, http.StatusOK, members)
}

// AddMembers godoc
//	@Summary     Add multiple members to a channel by username
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string        true "Channel ID"
//	@Param       body body AddMembersRequest true "Members to add (by username)"
//	@Success     200 {object} StatusResponse
//	@Router      /api/channels/{id}/members [post]
func (h *Handler) AddMembers(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())

	actorUC, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || actorUC.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "insufficient permissions to add members")
		return
	}

	var body AddMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(body.UserIDs) == 0 {
		writeError(w, http.StatusBadRequest, "user_ids required")
		return
	}

	for _, uid := range body.UserIDs {
		if err := h.Store.AddMemberToChannel(ch.ID, uid, models.RoleMember); err == nil && h.Hub != nil {
			h.Hub.BroadcastMemberJoined(ch.ID, uid)
		}
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "members added"})
}

// RemoveMember godoc
//	@Summary     Remove a member from a channel
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id  path string true "Channel ID"
//	@Param       uid path string true "User ID to remove"
//	@Success     200 {object} StatusResponse
//	@Router      /api/channels/{id}/members/{uid} [delete]
func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	session    := auth.SessionFromContext(r.Context())
	ch         := ChannelFromContext(r.Context())
	targetUID  := r.PathValue("uid")

	// Get actor's role
	actorUC, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil {
		writeError(w, http.StatusForbidden, "membership error")
		return
	}

	if session.UserID == targetUID {
		if err := h.Store.RemoveMemberFromChannel(ch.ID, targetUID, models.StatusLeft); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to leave channel")
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastMemberLeft(ch.ID, targetUID)
		}
		writeJSON(w, http.StatusOK, StatusResponse{Status: "left channel"})
		return
	}

	// Case 2: Kick-out (Requires Admin/Owner)
	if actorUC.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "insufficient permissions to kick")
		return
	}

	// Target role check: cannot kick someone with equal or higher role
	targetUC, err := h.Store.GetUserChannel(targetUID, ch.ID)
	if err == nil && targetUC.Role >= actorUC.Role {
		writeError(w, http.StatusForbidden, "cannot kick user with equal or higher role")
		return
	}

	if err := h.Store.RemoveMemberFromChannel(ch.ID, targetUID, models.StatusKicked); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}
	if h.Hub != nil {
		h.Hub.BroadcastMemberLeft(ch.ID, targetUID)
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "member kicked"})
}

// UpdateMember handles promoting or demoting a member (Owner only).
func (h *Handler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	targetUID := r.PathValue("uid")

	var req struct {
		Role int `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Only Owner can change roles
	actorUC, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || actorUC.Role < models.RoleOwner {
		writeError(w, http.StatusForbidden, "only owners can manage roles")
		return
	}

	// Cannot change owner's role
	targetUC, err := h.Store.GetUserChannel(targetUID, ch.ID)
	if err != nil {
		writeError(w, http.StatusNotFound, "member not found")
		return
	}
	if targetUC.Role >= models.RoleOwner {
		writeError(w, http.StatusForbidden, "cannot change owner's role")
		return
	}

	if err := h.Store.UpdateMemberRole(ch.ID, targetUID, req.Role); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update role")
		return
	}

	if h.Hub != nil {
		h.Hub.BroadcastMemberRoleUpdated(ch.ID, targetUID, req.Role)
	}

	writeJSON(w, http.StatusOK, StatusResponse{Status: "role updated"})
}

// --- Helpers & Middleware ---

type apiContextKey int
const channelCtxKey apiContextKey = 0

func (h *Handler) RequireMember(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := auth.SessionFromContext(r.Context())
		channelID := r.PathValue("id")
		if channelID == "" {
			writeError(w, http.StatusBadRequest, "missing channel id")
			return
		}

		ch, err := h.Store.GetChannel(channelID)
		if err != nil {
			writeError(w, http.StatusNotFound, "channel not found")
			return
		}

		uc, err := h.Store.GetUserChannel(session.UserID, channelID)
		if err != nil || uc.Status != models.StatusActive {
			writeError(w, http.StatusForbidden, "not a member of this channel")
			return
		}

		ctx := context.WithValue(r.Context(), channelCtxKey, ch)
		next(w, r.WithContext(ctx))
	}
}

func ChannelFromContext(ctx context.Context) *models.Channel {
	ch, _ := ctx.Value(channelCtxKey).(*models.Channel)
	return ch
}

func (h *Handler) toChannelResponse(ch *models.Channel, userID string) ChannelResponse {
	memberNames := make(map[string]string)
	memberAvatars := make(map[string]string)
	memberDomains := make(map[string]string)
	memberStatuses := make(map[string]string)
	memberRoles := make(map[string]int)
	members, err := h.Store.GetChannelMembers(ch.ID)
	
	userRole := models.RoleMember
	if uc, err := h.Store.GetUserChannel(userID, ch.ID); err == nil {
		userRole = uc.Role
	}

	var memberIDs []string
	if err == nil {
		for _, m := range members {
			memberIDs = append(memberIDs, m.UserID)
			memberRoles[m.UserID] = m.Role
			u, err := h.Store.GetUser(m.UserID)
			if err == nil {
				memberNames[m.UserID] = u.Username
				memberAvatars[m.UserID] = u.AvatarID
				memberDomains[m.UserID] = u.Domain
				memberStatuses[m.UserID] = u.Status
			}
		}
	}

	return ChannelResponse{
		ID:             ch.ID,
		Name:           ch.Name,
		IsPrivate:      ch.IsPrivate,
		InviteLink:     ch.InviteLink,
		CreatorID:      ch.CreatorID,
		UserRole:       userRole,
		Members:        memberIDs,
		MemberNames:    memberNames,
		MemberAvatars:  memberAvatars,
		MemberDomains:  memberDomains,
		MemberStatuses: memberStatuses,
		MemberRoles:    memberRoles,
		CreatedAt:      ch.CreatedAt,
		UnreadCount:    ch.UnreadCount,
	}
}
