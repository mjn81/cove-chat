package api

import (
	"encoding/json"
	"net/http"
	"time"

	"cove/backend/internal/auth"
	"cove/backend/internal/models"
)

// ListRelationships returns all active outgoing relationships (friends, outgoing requests, blocked) for the caller.
func (h *Handler) ListRelationships(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	rels, err := h.Store.ListRelationships(session.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list relationships")
		return
	}

	var res []RelationshipResponse
	for _, rel := range rels {
		item := RelationshipResponse{
			FromUserID: rel.FromUserID,
			ToUserID:   rel.ToUserID,
			Type:       string(rel.Type),
			CreatedAt:  rel.CreatedAt,
			UpdatedAt:  rel.UpdatedAt,
		}
		if u, err := h.Store.GetUser(rel.ToUserID); err == nil {
			item.User = &UserResponse{
				ID:          u.ID,
				Username:    u.Username,
				Domain:      u.Domain,
				Status:      u.Status,
				AvatarID:    u.AvatarID,
				AvatarIDs:   u.AvatarIDs,
				BannerColor: u.BannerColor,
				CustomMsg:   u.CustomMsg,
			}
		}
		res = append(res, item)
	}
	if res == nil {
		res = []RelationshipResponse{}
	}
	writeJSON(w, http.StatusOK, res)
}

// ListIncomingRequests returns all pending incoming friend requests for the caller.
func (h *Handler) ListIncomingRequests(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	reqs, err := h.Store.ListIncomingRequests(session.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list incoming requests")
		return
	}

	var res []RelationshipResponse
	for _, req := range reqs {
		item := RelationshipResponse{
			FromUserID: req.FromUserID,
			ToUserID:   req.ToUserID,
			Type:       string(req.Type),
			CreatedAt:  req.CreatedAt,
			UpdatedAt:  req.UpdatedAt,
		}
		if u, err := h.Store.GetUser(req.FromUserID); err == nil {
			item.User = &UserResponse{
				ID:          u.ID,
				Username:    u.Username,
				Domain:      u.Domain,
				Status:      u.Status,
				AvatarID:    u.AvatarID,
				AvatarIDs:   u.AvatarIDs,
				BannerColor: u.BannerColor,
				CustomMsg:   u.CustomMsg,
			}
		}
		res = append(res, item)
	}
	if res == nil {
		res = []RelationshipResponse{}
	}
	writeJSON(w, http.StatusOK, res)
}

// GetRelationship retrieves relationship status between caller and specified target user.
func (h *Handler) GetRelationship(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	targetID := r.PathValue("id")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "target user id required")
		return
	}

	rel, err := h.Store.GetRelationship(session.UserID, targetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get relationship")
		return
	}

	res := RelationshipResponse{
		FromUserID: rel.FromUserID,
		ToUserID:   rel.ToUserID,
		Type:       string(rel.Type),
		CreatedAt:  rel.CreatedAt,
		UpdatedAt:  rel.UpdatedAt,
	}
	if u, err := h.Store.GetUser(targetID); err == nil {
		res.User = &UserResponse{
			ID:          u.ID,
			Username:    u.Username,
			Domain:      u.Domain,
			Status:      u.Status,
			AvatarID:    u.AvatarID,
			AvatarIDs:   u.AvatarIDs,
			BannerColor: u.BannerColor,
			CustomMsg:   u.CustomMsg,
		}
	}

	writeJSON(w, http.StatusOK, res)
}

// HandleRelationshipAction performs actions: "request", "accept", "decline", "cancel", "remove", "block", "unblock".
func (h *Handler) HandleRelationshipAction(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	targetID := r.PathValue("id")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "target user id required")
		return
	}
	if targetID == session.UserID {
		writeError(w, http.StatusBadRequest, "cannot perform relationship action on yourself")
		return
	}

	targetUser, err := h.Store.GetUser(targetID)
	if err != nil {
		writeError(w, http.StatusNotFound, "target user not found")
		return
	}

	var body RelationshipActionRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	switch body.Action {
	case "request":
		if err := h.Store.SendFriendRequest(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastRelationshipUpdate(targetID, &models.Relationship{
				FromUserID: session.UserID,
				ToUserID:   targetID,
				Type:       models.RelRequested,
				CreatedAt:  time.Now().UTC(),
			})
		}

	case "accept":
		if err := h.Store.AcceptFriendRequest(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastRelationshipUpdate(targetID, &models.Relationship{
				FromUserID: session.UserID,
				ToUserID:   targetID,
				Type:       models.RelFriend,
				CreatedAt:  time.Now().UTC(),
			})
			h.Hub.BroadcastRelationshipUpdate(session.UserID, &models.Relationship{
				FromUserID: targetID,
				ToUserID:   session.UserID,
				Type:       models.RelFriend,
				CreatedAt:  time.Now().UTC(),
			})
		}

	case "decline":
		if err := h.Store.DeclineFriendRequest(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastRelationshipUpdate(targetID, &models.Relationship{
				FromUserID: targetID,
				ToUserID:   session.UserID,
				Type:       models.RelNone,
			})
		}

	case "cancel":
		if err := h.Store.CancelFriendRequest(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastRelationshipUpdate(targetID, &models.Relationship{
				FromUserID: session.UserID,
				ToUserID:   targetID,
				Type:       models.RelNone,
			})
		}

	case "remove":
		if err := h.Store.RemoveFriend(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if h.Hub != nil {
			h.Hub.BroadcastRelationshipUpdate(targetID, &models.Relationship{
				FromUserID: session.UserID,
				ToUserID:   targetID,
				Type:       models.RelNone,
			})
			h.Hub.BroadcastRelationshipUpdate(session.UserID, &models.Relationship{
				FromUserID: targetID,
				ToUserID:   session.UserID,
				Type:       models.RelNone,
			})
		}

	case "block":
		if err := h.Store.BlockUser(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if h.Hub != nil {
			// Notify target that friendship/request was cleared
			h.Hub.BroadcastRelationshipUpdate(targetID, &models.Relationship{
				FromUserID: session.UserID,
				ToUserID:   targetID,
				Type:       models.RelNone,
			})
		}

	case "unblock":
		if err := h.Store.UnblockUser(session.UserID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

	default:
		writeError(w, http.StatusBadRequest, "unknown action: "+body.Action)
		return
	}

	// Fetch updated relationship
	rel, _ := h.Store.GetRelationship(session.UserID, targetID)
	res := RelationshipResponse{
		FromUserID: rel.FromUserID,
		ToUserID:   rel.ToUserID,
		Type:       string(rel.Type),
		CreatedAt:  rel.CreatedAt,
		UpdatedAt:  rel.UpdatedAt,
		User: &UserResponse{
			ID:          targetUser.ID,
			Username:    targetUser.Username,
			Domain:      targetUser.Domain,
			Status:      targetUser.Status,
			AvatarID:    targetUser.AvatarID,
			AvatarIDs:   targetUser.AvatarIDs,
			BannerColor: targetUser.BannerColor,
			CustomMsg:   targetUser.CustomMsg,
		},
	}
	writeJSON(w, http.StatusOK, res)
}
