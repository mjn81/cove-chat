// Package api provides HTTP REST handlers for the NodeTalk API.
package api

import (
	"net/http"
	"time"

	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/middleware"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
)

type ChannelBroadcaster interface {
	BroadcastChannelCreated(ch *models.Channel)
	BroadcastChannelUpdated(ch *models.Channel)
	BroadcastMemberJoined(channelID string, userID string)
	BroadcastMemberLeft(channelID string, userID string)
	BroadcastMemberRoleUpdated(channelID string, userID string, role int)
	BroadcastPresence(userID string, status string)
	BroadcastRelationshipUpdate(targetUserID string, rel *models.Relationship)
	BroadcastVideoReady(fileID string, channelID string)
	BroadcastChannelDeleted(channelID string, targetUserIDs []string)
	SendChannelKey(channelID, userID string)
}

// Handler bundles all HTTP handler dependencies.
type Handler struct {
	Store               *store.Store
	Sessions            *auth.SessionStore
	Hub                 ChannelBroadcaster
	KEK                 []byte
	Storage             storage.BlobStorage
	TokenTTL            time.Duration
	MaxFileSizeMB       int
	MaxVideoSizeMB      int
	MaxVideoDurationSec int
	FFmpegPath          string
	UDPPort             int
	IsDev               bool
	FrontendOrigin      string
}


// NewRouter wires the full HTTP API with rate limiting.
func NewRouter(h *Handler, globalRPS, authRPS float64) http.Handler {
	mux := http.NewServeMux()

	authLimiter   := middleware.NewRateLimiter(authRPS, int(authRPS)*2)
	globalLimiter := middleware.NewRateLimiter(globalRPS, int(globalRPS)*2)
	protect := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(handler))
	}
	protectMember := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(h.RequireMember(handler)))
	}

	// Public
	mux.Handle("GET /api/version",   http.HandlerFunc(h.GetVersion))
	mux.Handle("POST /api/register", authLimiter.Limit(http.HandlerFunc(h.Register)))
	mux.Handle("POST /api/login",    authLimiter.Limit(http.HandlerFunc(h.Login)))

	// Protected
	mux.Handle("POST /api/logout",                       protect(h.Logout))
	mux.Handle("GET /api/me",                            protect(h.Me))
	mux.Handle("DELETE /api/users/me",                   protect(h.DeleteAccount))
	mux.Handle("PATCH /api/users/me",                    protect(h.UpdateProfile))
	mux.Handle("GET /api/users",                         protect(h.SearchUsers))
	mux.Handle("GET /api/users/{id}",                    protect(h.GetUser))
	mux.Handle("GET /api/users/{id}/presence",           protect(h.GetPresence))

	// Relationships (Friends / Blocking / Requests)
	mux.Handle("GET /api/relationships",                 protect(h.ListRelationships))
	mux.Handle("GET /api/relationships/incoming",        protect(h.ListIncomingRequests))
	mux.Handle("GET /api/users/{id}/relationship",       protect(h.GetRelationship))
	mux.Handle("PUT /api/users/{id}/relationship",       protect(h.HandleRelationshipAction))

	mux.Handle("POST /api/channels",                     protect(h.CreateChannel))
	mux.Handle("GET /api/channels",                      protect(h.ListChannels))
	mux.Handle("GET /api/channels/explore",              protect(h.ExploreChannels))
	mux.Handle("GET /api/channels/{id}",                 protectMember(h.GetChannel))
	mux.Handle("PATCH /api/channels/{id}",               protectMember(h.UpdateChannel))
	mux.Handle("DELETE /api/channels/{id}",              protectMember(h.DeleteChannel))
	mux.Handle("POST /api/join/{link}",                  protect(h.JoinChannel))
	mux.Handle("GET /api/channels/{id}/members",         protectMember(h.GetChannelMembers))
	mux.Handle("POST /api/channels/{id}/members",        protectMember(h.AddMembers))
	mux.Handle("PATCH /api/channels/{id}/members/{uid}", protectMember(h.UpdateMember))
	mux.Handle("DELETE /api/channels/{id}/members/{uid}", protectMember(h.RemoveMember))
	mux.Handle("GET /api/channels/{id}/messages",        protectMember(h.ListMessages))
	
	mux.Handle("POST /api/files",                        protect(h.UploadFile))
	mux.Handle("GET /api/files/{id}",                    protect(h.DownloadFile))

	return middleware.CORS(mux, h.IsDev, h.FrontendOrigin)
}
