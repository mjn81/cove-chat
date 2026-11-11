package api

import (
	"errors"
	"net/http"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/auth"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// publicUser is the part of a profile other users may see.
func publicUser(u *models.User) *UserResponse {
	return &UserResponse{
		ID:          u.ID,
		Username:    u.Username,
		Domain:      u.Domain,
		Status:      u.Status,
		AvatarID:    u.AvatarID,
		AvatarIDs:   u.AvatarIDs,
		BannerColor: u.BannerColor,
		CustomMsg:   u.CustomMsg,
		IsBot:       u.IsBot(),
	}
}

func relationshipResponse(rel *models.Relationship, user *models.User) RelationshipResponse {
	res := RelationshipResponse{
		FromUserID: rel.FromUserID,
		ToUserID:   rel.ToUserID,
		Type:       string(rel.Type),
		CreatedAt:  rel.CreatedAt,
		UpdatedAt:  rel.UpdatedAt,
	}
	if user != nil {
		res.User = publicUser(user)
	}
	return res
}

// ListRelationships godoc
//
//	@Summary     List the caller's relationships
//	@Description Friends, outgoing friend requests and blocked users. Paged (`{items, next_cursor}`).
//	@Description **Access:** Authenticated.
//	@Tags        relationships
//	@Produce     json
//	@Security    BearerAuth
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor from the previous page's next_cursor"
//	@Success     200 {object} RelationshipPageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/relationships [get]
func (h *Handler) ListRelationships(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	limit, cursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	rels, err := h.Store.ListRelationships(session.UserID)
	if err != nil {
		writeInternal(w, "list relationships", err, "apiErrors.relationships_load_failed")
		return
	}
	// The index is keyed by the other user's id, so the scan order is already stable for offset paging. Profiles
	// are only loaded for the page being served.
	page, next, perr := apistd.Paginate(rels, cursor, limit)
	if perr != nil {
		writeBadCursor(w, perr)
		return
	}
	res := make([]RelationshipResponse, 0, len(page))
	for _, rel := range page {
		u, _ := h.Store.GetUser(rel.ToUserID) // a vanished user just has no embedded profile
		res = append(res, relationshipResponse(rel, u))
	}
	writeJSON(w, http.StatusOK, RelationshipPageResponse{Items: res, NextCursor: next})
}

// ListIncomingRequests godoc
//
//	@Summary     List pending incoming friend requests
//	@Description Paged (`{items, next_cursor}`); each item embeds the requester's profile.
//	@Description **Access:** Authenticated.
//	@Tags        relationships
//	@Produce     json
//	@Security    BearerAuth
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor from the previous page's next_cursor"
//	@Success     200 {object} RelationshipPageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/relationships/incoming [get]
func (h *Handler) ListIncomingRequests(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	limit, cursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	reqs, err := h.Store.ListIncomingRequests(session.UserID)
	if err != nil {
		writeInternal(w, "list incoming requests", err, "apiErrors.relationships_load_failed")
		return
	}
	page, next, perr := apistd.Paginate(reqs, cursor, limit)
	if perr != nil {
		writeBadCursor(w, perr)
		return
	}
	res := make([]RelationshipResponse, 0, len(page))
	for _, req := range page {
		u, _ := h.Store.GetUser(req.FromUserID)
		res = append(res, relationshipResponse(req, u))
	}
	writeJSON(w, http.StatusOK, RelationshipPageResponse{Items: res, NextCursor: next})
}

// GetRelationship godoc
//
//	@Summary     Get the relationship with another user
//	@Description Returns type `none` when there is no relationship.
//	@Description **Access:** Authenticated.
//	@Tags        relationships
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Target user ID"
//	@Success     200 {object} RelationshipResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/users/{id}/relationship [get]
func (h *Handler) GetRelationship(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	targetID := r.PathValue("id")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "apiErrors.target_user_required")
		return
	}

	rel, err := h.Store.GetRelationship(session.UserID, targetID)
	if err != nil {
		writeInternal(w, "get relationship", err, "apiErrors.relationship_load_failed")
		return
	}
	u, _ := h.Store.GetUser(targetID)
	writeJSON(w, http.StatusOK, relationshipResponse(rel, u))
}

// relationshipActions are the values RelationshipActionRequest.Action accepts.
var relationshipActions = map[string]bool{
	"request": true, "accept": true, "decline": true, "cancel": true, "remove": true, "block": true, "unblock": true,
}

// HandleRelationshipAction godoc
//
//	@Summary     Change the relationship with another user
//	@Description `action` is one of request, accept, decline, cancel, remove, block, unblock. Rule violations (already
//	@Description friends, blocked, no pending request, ...) answer 400 with a user-facing message; the target must exist.
//	@Description **Access:** Authenticated.
//	@Tags        relationships
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string                    true "Target user ID"
//	@Param       body body RelationshipActionRequest true "Action"
//	@Success     200 {object} RelationshipResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/users/{id}/relationship [put]
func (h *Handler) HandleRelationshipAction(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	targetID := r.PathValue("id")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "apiErrors.target_user_required")
		return
	}
	if targetID == session.UserID {
		writeError(w, http.StatusBadRequest, "apiErrors.relationship_self")
		return
	}

	targetUser, err := h.Store.GetUser(targetID)
	if err != nil {
		userNotFoundOr(w, "relationship: load target", err)
		return
	}

	var body RelationshipActionRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	if !relationshipActions[body.Action] {
		// The unknown value is deliberately not echoed back.
		writeError(w, http.StatusBadRequest, "apiErrors.relationship_action_unknown")
		return
	}

	if targetUser.IsBot() && body.Action != "block" && body.Action != "unblock" {
		// Bots cannot be friends; users can still block one.
		writeError(w, http.StatusBadRequest, "apiErrors.bot_not_friendable")
		return
	}

	if err := h.applyRelationshipAction(session.UserID, targetID, body.Action); err != nil {
		if errors.Is(err, store.ErrRule) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeInternal(w, "relationship "+body.Action, err, "apiErrors.relationship_update_failed")
		return
	}

	rel, err := h.Store.GetRelationship(session.UserID, targetID)
	if err != nil {
		writeInternal(w, "relationship: reload", err, "apiErrors.relationship_load_failed")
		return
	}
	writeJSON(w, http.StatusOK, relationshipResponse(rel, targetUser))
}

// applyRelationshipAction runs one validated action and pushes the resulting change to the affected users.
func (h *Handler) applyRelationshipAction(actorID, targetID, action string) error {
	notify := func(to, from, other string, typ models.RelationshipType, withCreated bool) {
		if h.Hub == nil {
			return
		}
		rel := &models.Relationship{FromUserID: from, ToUserID: other, Type: typ}
		if withCreated {
			rel.CreatedAt = time.Now().UTC()
		}
		h.Hub.BroadcastRelationshipUpdate(to, rel)
	}

	switch action {
	case "request":
		if err := h.Store.SendFriendRequest(actorID, targetID); err != nil {
			return err
		}
		notify(targetID, actorID, targetID, models.RelRequested, true)
	case "accept":
		if err := h.Store.AcceptFriendRequest(actorID, targetID); err != nil {
			return err
		}
		notify(targetID, actorID, targetID, models.RelFriend, true)
		notify(actorID, targetID, actorID, models.RelFriend, true)
	case "decline":
		if err := h.Store.DeclineFriendRequest(actorID, targetID); err != nil {
			return err
		}
		notify(targetID, targetID, actorID, models.RelNone, false)
	case "cancel":
		if err := h.Store.CancelFriendRequest(actorID, targetID); err != nil {
			return err
		}
		notify(targetID, actorID, targetID, models.RelNone, false)
	case "remove":
		if err := h.Store.RemoveFriend(actorID, targetID); err != nil {
			return err
		}
		notify(targetID, actorID, targetID, models.RelNone, false)
		notify(actorID, targetID, actorID, models.RelNone, false)
	case "block":
		if err := h.Store.BlockUser(actorID, targetID); err != nil {
			return err
		}
		// The target learns that any friendship or request was cleared.
		notify(targetID, actorID, targetID, models.RelNone, false)
	case "unblock":
		if err := h.Store.UnblockUser(actorID, targetID); err != nil {
			return err
		}
	}
	return nil
}
