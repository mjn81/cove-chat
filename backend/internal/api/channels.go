package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"cove/backend/internal/auth"
	"cove/backend/internal/db"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
)

// Input bounds for channel endpoints. They are generous for real use and exist so a client cannot store or
// iterate over unbounded data.
const (
	maxChannelNameRunes = 100
	maxChannelDescRunes = 500
	maxMembersPerCall   = 200
)

// validChannelText trims s and reports whether it fits in max runes.
func validChannelText(s string, max int) (string, bool) {
	s = strings.TrimSpace(s)
	return s, utf8.RuneCountInString(s) <= max
}

// ============================
//  Channel Handlers
// ============================

// CreateChannel godoc
//
//	@Summary     Create a channel or direct message
//	@Description Creates a group channel (name required) or, with exactly one other member and no name, a direct message.
//	@Description Asking for a DM that already exists returns that conversation with **200** instead of **201**.
//	@Description Members who block the caller or whose privacy settings forbid it are silently left out.
//	@Description **Access:** Authenticated.
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body CreateChannelRequest true "Channel payload"
//	@Success     200 {object} ChannelResponse "an existing direct message with that user"
//	@Success     201 {object} ChannelResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels [post]
func (h *Handler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	var body CreateChannelRequest
	if !decodeJSON(w, r, &body, "invalid JSON body") {
		return
	}
	var ok bool
	if body.Name, ok = validChannelText(body.Name, maxChannelNameRunes); !ok {
		writeError(w, http.StatusBadRequest, "channel name is too long")
		return
	}
	if body.Description, ok = validChannelText(body.Description, maxChannelDescRunes); !ok {
		writeError(w, http.StatusBadRequest, "channel description is too long")
		return
	}
	if len(body.Members) > maxMembersPerCall {
		writeError(w, http.StatusBadRequest, "too many members")
		return
	}

	memberSet := uniqueStrings(append(body.Members, session.UserID))
	for _, id := range memberSet {
		if id == models.SystemUserID {
			writeError(w, http.StatusForbidden, "this account cannot be added to chats")
			return
		}
	}

	// DM de-duplication: if this is a DM, check if it already exists
	isDM := (&models.Channel{Name: body.Name}).IsDM(len(memberSet))
	if isDM {
		existingByMe, err := h.Store.ListUserChannels(session.UserID)
		if err != nil {
			// Not fatal: worst case a second DM is created, which the sidebar merges. Still worth knowing about.
			logger.Warnf("api: CreateChannel: DM dedupe lookup for %s failed: %v", session.UserID, err)
		}
		for _, ex := range existingByMe {
			if ex.Name != "" {
				continue
			}
			exMembers, merr := h.Store.GetChannelMembers(ex.ID)
			if merr != nil {
				logger.Warnf("api: CreateChannel: members of %s unreadable during DM dedupe: %v", ex.ID, merr)
				continue
			}
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

	// Filter non-creator members by privacy setting
	var allowedMembers []string
	for _, uid := range memberSet {
		if uid == session.UserID {
			allowedMembers = append(allowedMembers, uid)
			continue
		}
		if ok, _ := h.Store.CanAddToChannel(session.UserID, uid); ok {
			allowedMembers = append(allowedMembers, uid)
		}
	}
	memberSet = allowedMembers

	ch, err := h.Store.CreateChannel(body.Name, session.UserID, body.IsPrivate, memberSet, h.KEK)
	if err != nil {
		writeInternal(w, "create channel", err, "channel creation failed")
		return
	}
	if body.Description != "" || body.AvatarID != "" {
		ch.Description = body.Description
		ch.AvatarID = body.AvatarID
		if err := h.Store.UpdateChannel(ch); err != nil {
			// The channel exists; only its description/avatar were lost. Tell the log, not the user.
			logger.Warnf("api: CreateChannel: could not save description/avatar of %s: %v", ch.ID, err)
		}
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

// ListChannels godoc
//
//	@Summary     List channels for the current user
//	@Description Bounded list of the caller's channels and direct messages, returned as a bare JSON array.
//	@Description **Access:** Authenticated.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {array} ChannelResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels [get]
func (h *Handler) ListChannels(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())

	channels, err := h.Store.ListUserChannels(session.UserID)
	if err != nil {
		writeInternal(w, "list channels", err, "could not list channels")
		return
	}

	resp := make([]ChannelResponse, 0)
	for _, ch := range channels {
		resp = append(resp, h.toChannelResponse(ch, session.UserID))
	}
	writeJSON(w, http.StatusOK, resp)
}

// ExploreChannels godoc
//
//	@Summary     Search public channels
//	@Description Lists public (non-private) group channels whose name contains `q`. The result carries no invite link:
//	@Description a public channel is joined with `POST /api/join/{link}` using its **id**.
//	@Description **Access:** Authenticated.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       q query string false "Search query"
//	@Success     200 {array} ExploreChannelResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/explore [get]
func (h *Handler) ExploreChannels(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("q")
	allChannels, err := h.Store.ListAllChannels()
	if err != nil {
		writeInternal(w, "explore channels", err, "could not list all channels")
		return
	}

	filtered := make([]ExploreChannelResponse, 0)
	searchQuery := strings.ToLower(search)

	for _, ch := range allChannels {
		if ch.IsPrivate {
			continue // Hide private
		}

		members, merr := h.Store.GetChannelMembers(ch.ID)
		if merr != nil {
			logger.Warnf("api: explore: members of %s unreadable: %v", ch.ID, merr)
		}

		if search == "" || strings.Contains(strings.ToLower(ch.Name), searchQuery) {
			filtered = append(filtered, ExploreChannelResponse{
				ID:          ch.ID,
				Name:        ch.Name,
				Description: ch.Description,
				AvatarID:    ch.AvatarID,
				MemberCount: len(members),
				CreatedAt:   ch.CreatedAt,
			})
		}
	}

	writeJSON(w, http.StatusOK, filtered)
}

// GetChannel godoc
//
//	@Summary     Get a channel by ID
//	@Description **Access:** Channel Member.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} ChannelResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/channels/{id} [get]
func (h *Handler) GetChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// UpdateChannel godoc
//
//	@Summary     Update channel settings
//	@Description **Access:** Channel Admin.
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string               true "Channel ID"
//	@Param       body body UpdateChannelRequest true "Update payload"
//	@Success     200 {object} ChannelResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
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
	if !decodeJSON(w, r, &body, "invalid JSON body") {
		return
	}

	if body.Name != nil {
		newName, ok := validChannelText(*body.Name, maxChannelNameRunes)
		if newName == "" {
			writeError(w, http.StatusBadRequest, "channel name cannot be empty")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "channel name is too long")
			return
		}
		ch.Name = newName
	}
	if body.Description != nil {
		desc, ok := validChannelText(*body.Description, maxChannelDescRunes)
		if !ok {
			writeError(w, http.StatusBadRequest, "channel description is too long")
			return
		}
		ch.Description = desc
	}
	if body.AvatarID != nil {
		ch.AvatarID = *body.AvatarID
	}
	if body.IsPrivate != nil {
		ch.IsPrivate = *body.IsPrivate
	}

	if err := h.Store.UpdateChannel(ch); err != nil {
		writeInternal(w, "update channel "+ch.ID, err, "failed to update channel")
		return
	}

	if h.Hub != nil {
		h.Hub.BroadcastChannelUpdated(ch)
	}

	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// DeleteChannel godoc
//
//	@Summary     Delete or clear a channel/direct message
//	@Description In a group channel only the owner may delete, always for everyone. In a direct message either side may
//	@Description clear it for themselves, or delete it for both with `for_both=true`.
//	@Description **Access:** Channel Member (group channels: Channel Owner).
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Param       for_both query bool false "If true, permanently deletes for all participants (owner required for group channels)"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id} [delete]
func (h *Handler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())

	// Fetch members before deletion for permission checks and WS broadcast
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeInternal(w, "delete channel "+ch.ID+": members", err, "failed to get channel members")
		return
	}

	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || uc.Status != models.StatusActive {
		writeError(w, http.StatusForbidden, "not an active member of this channel")
		return
	}

	isDM := ch.IsDM(len(members))
	forBoth := r.URL.Query().Get("for_both") == "true" || r.URL.Query().Get("for_everyone") == "true"

	if !isDM {
		// Group channels can only be deleted by the owner, and are always deleted for everyone
		if uc.Role < models.RoleOwner {
			writeError(w, http.StatusForbidden, "only the owner can delete the channel")
			return
		}
		forBoth = true
	}

	if forBoth {
		var memberIDs []string
		for _, m := range members {
			memberIDs = append(memberIDs, m.UserID)
		}

		if err := h.Store.DeleteChannel(ch.ID); err != nil {
			writeInternal(w, "delete channel "+ch.ID, err, "failed to delete channel")
			return
		}

		if h.Hub != nil {
			h.Hub.BroadcastChannelDeleted(ch.ID, memberIDs)
		}

		writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
		return
	}

	// Delete only for the requesting user (DM only)
	now := time.Now().UTC()
	if err := h.Store.ClearChannelForUser(session.UserID, ch.ID, now); err != nil {
		writeInternal(w, "clear channel "+ch.ID, err, "failed to clear channel")
		return
	}

	// Notify only the requesting user's connected clients
	if h.Hub != nil {
		h.Hub.BroadcastChannelDeleted(ch.ID, []string{session.UserID})
	}

	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// JoinChannel godoc
//
//	@Summary     Join a channel via a unique invite link or a public channel's id
//	@Description Joins the channel and returns it. `link` is the channel's invite link, or the id of a public (non-private)
//	@Description group channel as listed by explore. Members who were kicked cannot rejoin through a link; members who left can.
//	@Description **Access:** Authenticated.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       link path string true "Unique Channel Invite Link, or a public channel ID"
//	@Success     200 {object} ChannelResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/join/{link} [post]
func (h *Handler) JoinChannel(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())

	ch, _, ok := h.groupByInviteLink(w, r.PathValue("link"))
	if !ok {
		return
	}

	// Check if already a member
	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err == nil && uc.Status == models.StatusActive {
		writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
		return
	}
	// A kick is an admin decision: the public link must not undo it (an admin can still re-add the user).
	if err == nil && uc.Status == models.StatusKicked {
		writeError(w, http.StatusForbidden, "you were removed from this channel and cannot rejoin with its link")
		return
	}

	if err := h.Store.AddMemberToChannel(ch.ID, session.UserID, models.RoleMember); err != nil {
		writeInternal(w, "join channel "+ch.ID, err, "failed to join channel")
		return
	}

	// Notify members
	if h.Hub != nil {
		h.Hub.BroadcastMemberJoined(ch.ID, session.UserID)
	}

	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// groupByInviteLink resolves an invite link (or, for a public channel, its id) to a group channel and its active
// member count. Unknown links, private channels addressed by id, and DMs all answer 404, so a link never reveals a
// direct conversation. A public channel's id is accepted because explore no longer hands out its invite link; the
// channel is already listed to everyone there, so this grants nothing new.
func (h *Handler) groupByInviteLink(w http.ResponseWriter, link string) (*models.Channel, int, bool) {
	ch, err := h.Store.GetChannelByInviteLink(link)
	if err != nil {
		if !errors.Is(err, db.ErrNotFound) {
			writeInternal(w, "invite link lookup", err, "could not load channel")
			return nil, 0, false
		}
		byID, idErr := h.Store.GetChannel(link)
		if idErr != nil || byID.IsPrivate {
			writeError(w, http.StatusNotFound, "channel not found")
			return nil, 0, false
		}
		ch = byID
	}
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeInternal(w, "invite link: list members of channel "+ch.ID, err, "could not load channel")
		return nil, 0, false
	}
	if ch.IsDM(len(members)) {
		writeError(w, http.StatusNotFound, "channel not found")
		return nil, 0, false
	}
	return ch, len(members), true
}

// PreviewInvite godoc
//
//	@Summary     Preview the channel behind an invite link
//	@Description Returns public-facing details so a client can show a join card before joining. Direct messages are never previewable.
//	@Description **Access:** Authenticated.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       link path string true "Unique Channel Invite Link, or a public channel ID"
//	@Success     200 {object} InvitePreviewResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/join/{link} [get]
func (h *Handler) PreviewInvite(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())

	ch, count, ok := h.groupByInviteLink(w, r.PathValue("link"))
	if !ok {
		return
	}
	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	writeJSON(w, http.StatusOK, InvitePreviewResponse{
		ID:            ch.ID,
		Name:          ch.Name,
		Description:   ch.Description,
		AvatarID:      ch.AvatarID,
		IsPrivate:     ch.IsPrivate,
		MemberCount:   count,
		AlreadyMember: err == nil && uc.Status == models.StatusActive,
	})
}

// RegenerateInvite godoc
//
//	@Summary     Replace a channel's invite link
//	@Description Issues a new random invite link; the previous link stops working immediately.
//	@Description **Access:** Channel Admin.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} ChannelResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/invite/regenerate [post]
func (h *Handler) RegenerateInvite(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())

	uc, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || uc.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}
	if err := h.Store.RegenerateInviteLink(ch); err != nil {
		writeInternal(w, "regenerate invite for channel "+ch.ID, err, "failed to regenerate invite link")
		return
	}
	if h.Hub != nil {
		h.Hub.BroadcastChannelUpdated(ch)
	}
	writeJSON(w, http.StatusOK, h.toChannelResponse(ch, session.UserID))
}

// GetChannelMembers godoc
//
//	@Summary     List members of a channel
//	@Description Bounded list returned as a bare JSON array.
//	@Description **Access:** Channel Member.
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {array} UserResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/members [get]
func (h *Handler) GetChannelMembers(w http.ResponseWriter, r *http.Request) {
	ch := ChannelFromContext(r.Context())
	memberList, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeInternal(w, "list members of channel "+ch.ID, err, "could not list members")
		return
	}

	members := make([]UserResponse, 0, len(memberList))
	for _, m := range memberList {
		u, err := h.Store.GetUser(m.UserID)
		if err != nil {
			logger.Warnf("api: members of %s: user %s unreadable: %v", ch.ID, m.UserID, err)
			continue
		}
		members = append(members, UserResponse{
			ID:       u.ID,
			Username: u.Username,
			Domain:   u.Domain,
			Status:   u.Status,
			AvatarID: u.AvatarID,
		})
	}
	writeJSON(w, http.StatusOK, members)
}

// AddMembers godoc
//
//	@Summary     Add multiple members to a channel by user id
//	@Description Adds up to 200 users. Users who block the caller or whose privacy settings forbid it are reported in `skipped`.
//	@Description **Access:** Channel Admin.
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string        true "Channel ID"
//	@Param       body body AddMembersRequest true "Members to add (by user id)"
//	@Success     200 {object} AddMembersResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
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
	if !decodeJSON(w, r, &body, "invalid JSON body") {
		return
	}
	if len(body.UserIDs) == 0 {
		writeError(w, http.StatusBadRequest, "user_ids required")
		return
	}
	if len(body.UserIDs) > maxMembersPerCall {
		writeError(w, http.StatusBadRequest, "too many user_ids")
		return
	}

	added := []string{}
	skipped := []SkippedMember{}

	for _, uid := range uniqueStrings(body.UserIDs) {
		canAdd, reason := h.Store.CanAddToChannel(session.UserID, uid)
		if !canAdd {
			skipped = append(skipped, SkippedMember{UserID: uid, Reason: reason})
			continue
		}
		if err := h.Store.AddMemberToChannel(ch.ID, uid, models.RoleMember); err != nil {
			logger.Errorf("api: add member %s to channel %s: %v", uid, ch.ID, err)
			skipped = append(skipped, SkippedMember{UserID: uid, Reason: "failed to add to channel"})
			continue
		}
		added = append(added, uid)
		if h.Hub != nil {
			h.Hub.BroadcastMemberJoined(ch.ID, uid)
		}
	}
	writeJSON(w, http.StatusOK, AddMembersResponse{Added: added, Skipped: skipped})
}

// RemoveMember godoc
//
//	@Summary     Remove a member from a channel
//	@Description Any member can remove themselves (leave). Removing someone else needs an admin or owner with a strictly higher role than the target.
//	@Description **Access:** Channel Member (self) or Channel Admin (others).
//	@Tags        channels
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id  path string true "Channel ID"
//	@Param       uid path string true "User ID to remove"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/members/{uid} [delete]
func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	targetUID := r.PathValue("uid")

	// Get actor's role
	actorUC, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil {
		writeError(w, http.StatusForbidden, "membership error")
		return
	}

	if session.UserID == targetUID {
		if err := h.Store.RemoveMemberFromChannel(ch.ID, targetUID, models.StatusLeft); err != nil {
			writeInternal(w, "leave channel "+ch.ID, err, "failed to leave channel")
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastMemberLeft(ch.ID, targetUID)
		}
		writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
		return
	}

	// Case 2: Kick-out (Requires Admin/Owner)
	if actorUC.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "insufficient permissions to kick")
		return
	}

	// Target role check: cannot kick someone with equal or higher role
	targetUC, err := h.Store.GetUserChannel(targetUID, ch.ID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "member not found")
		} else {
			writeInternal(w, "kick: load member "+targetUID, err, "failed to remove member")
		}
		return
	}
	if targetUC.Role >= actorUC.Role {
		writeError(w, http.StatusForbidden, "cannot kick user with equal or higher role")
		return
	}

	if err := h.Store.RemoveMemberFromChannel(ch.ID, targetUID, models.StatusKicked); err != nil {
		writeInternal(w, "kick member from channel "+ch.ID, err, "failed to remove member")
		return
	}
	if h.Hub != nil {
		h.Hub.BroadcastMemberLeft(ch.ID, targetUID)
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// UpdateMember godoc
//
//	@Summary     Update a channel member's role
//	@Description Promotes a member to admin (10) or demotes an admin to member (0). Ownership cannot be granted here and
//	@Description the owner's own role cannot be changed; any other role value is rejected with `validation_failed`.
//	@Description **Access:** Channel Owner.
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string              true "Channel ID"
//	@Param       uid  path string              true "Target user ID"
//	@Param       body body UpdateMemberRequest true "New role"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/members/{uid} [patch]
func (h *Handler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	targetUID := r.PathValue("uid")

	// Only Owner can change roles
	actorUC, err := h.Store.GetUserChannel(session.UserID, ch.ID)
	if err != nil || actorUC.Role < models.RoleOwner {
		writeError(w, http.StatusForbidden, "only owners can manage roles")
		return
	}

	var req UpdateMemberRequest
	if !decodeJSON(w, r, &req, "invalid request body") {
		return
	}
	if req.Role != models.RoleMember && req.Role != models.RoleAdmin {
		writeError(w, http.StatusBadRequest, "role must be 0 (member) or 10 (admin)")
		return
	}

	// Cannot change owner's role
	targetUC, err := h.Store.GetUserChannel(targetUID, ch.ID)
	if err != nil || targetUC.Status != models.StatusActive {
		writeError(w, http.StatusNotFound, "member not found")
		return
	}
	if targetUC.Role >= models.RoleOwner {
		writeError(w, http.StatusForbidden, "cannot change owner's role")
		return
	}

	if err := h.Store.UpdateMemberRole(ch.ID, targetUID, req.Role); err != nil {
		writeInternal(w, "update role in channel "+ch.ID, err, "failed to update role")
		return
	}

	if h.Hub != nil {
		h.Hub.BroadcastMemberRoleUpdated(ch.ID, targetUID, req.Role)
	}

	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// --- Helpers & Middleware ---

type apiContextKey int

const channelCtxKey apiContextKey = 0

// RequireMember loads the channel named by {id} and requires the caller to be an active member. A missing channel
// and a channel the caller is not in both answer 404, so the response never reveals whether a channel exists.
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
			writeError(w, http.StatusNotFound, "channel not found")
			return
		}

		ctx := context.WithValue(r.Context(), channelCtxKey, ch)
		next(w, r.WithContext(ctx))
	}
}

// ChannelFromContext returns the channel RequireMember loaded for this request.
func ChannelFromContext(ctx context.Context) *models.Channel {
	ch, _ := ctx.Value(channelCtxKey).(*models.Channel)
	return ch
}

func (h *Handler) toChannelResponse(ch *models.Channel, userID string) ChannelResponse {
	lastMessageAt := ch.LastMessageAt
	if lastMessageAt.IsZero() {
		lastMessageAt = ch.CreatedAt
	}

	memberNames := make(map[string]string)
	memberAvatars := make(map[string]string)
	memberDomains := make(map[string]string)
	memberStatuses := make(map[string]string)
	memberRoles := make(map[string]int)
	memberSystem := make(map[string]bool)
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
				if u.IsSystem {
					// The system account's name carries this server's domain so users know who is notifying them.
					memberNames[m.UserID] = h.systemDisplayName()
					memberSystem[m.UserID] = true
				}
				memberAvatars[m.UserID] = u.AvatarID
				memberDomains[m.UserID] = u.Domain
				memberStatuses[m.UserID] = u.Status
			}
		}
	}

	// The link is a join credential: only admins and the owner get to see (and re-share) it.
	inviteLink := ""
	if userRole >= models.RoleAdmin {
		inviteLink = ch.InviteLink
	}

	return ChannelResponse{
		ID:                    ch.ID,
		Name:                  ch.Name,
		Description:           ch.Description,
		AvatarID:              ch.AvatarID,
		IsPrivate:             ch.IsPrivate,
		InviteLink:            inviteLink,
		CreatorID:             ch.CreatorID,
		UserRole:              userRole,
		Members:               memberIDs,
		MemberNames:           memberNames,
		MemberAvatars:         memberAvatars,
		MemberDomains:         memberDomains,
		MemberStatuses:        memberStatuses,
		MemberRoles:           memberRoles,
		MemberSystem:          memberSystem,
		CreatedAt:             ch.CreatedAt,
		UnreadCount:           ch.UnreadCount,
		LastMessageAt:         lastMessageAt,
		LastMessageCiphertext: ch.LastMessageCiphertext,
		LastMessageNonce:      ch.LastMessageNonce,
		LastMessageType:       string(ch.LastMessageType),
		LastMessageSenderID:   ch.LastMessageSenderID,
		LastMessageID:         ch.LastMessageID,
	}
}
