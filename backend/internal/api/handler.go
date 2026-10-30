// Package api provides HTTP REST handlers for the Cove API.
package api

import (
	"net/http"
	"time"

	"cove/backend/internal/auth"
	"cove/backend/internal/captcha"
	"cove/backend/internal/geoip"
	"cove/backend/internal/config"
	"cove/backend/internal/middleware"
	"cove/backend/internal/models"
	"cove/backend/internal/storage"
	"cove/backend/internal/store"
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
	// Geo resolves login IPs to a city/country for the active-devices list. Optional: nil means IP only.
	Geo                 geoip.Resolver
	// LoginNotifications makes the Cove account message a user when they sign in from a new device.
	LoginNotifications  bool
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

	// Admin panel and live settings. All optional: a Handler built without
	// them behaves as an open server with no admin features configured.
	Settings     *Settings // hot-applicable config (registration mode, upload limits)
	ConfigPath   string    // config.toml the panel edits
	DataDir      string    // database parent dir, used by backup/reset
	ServerDomain string    // shown to the owner and required for the delete confirmation
	StartedAt    time.Time // for the uptime shown in the overview
	Shutdown     func()    // stops the process after "delete server"

	// Demo holds the opt-in public-demo limits (config [demo]); the zero value is a normal server.
	Demo config.DemoConfig

	// Captcha issues and verifies the sign-up proof-of-work challenges. Whether it is enforced is a live
	// setting (Settings), so the admin panel can switch it on and off without a restart.
	Captcha *captcha.Service

	// signups is ephemeral by design: per-IP signup timestamps are only a short-lived abuse
	// throttle, so losing them on restart is acceptable and they need no persistence.
	signups signupLimiter

	stepUp stepUpGuard // wrong-password lockout for dangerous admin actions
}

// NewRouter wires the full HTTP API with rate limiting.
func NewRouter(h *Handler, globalRPS, authRPS float64) http.Handler {
	mux := http.NewServeMux()

	authLimiter := middleware.NewRateLimiter(authRPS, int(authRPS)*2)
	globalLimiter := middleware.NewRateLimiter(globalRPS, int(globalRPS)*2)
	protect := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(handler))
	}
	protectMember := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(h.RequireMember(handler)))
	}

	// Admin panel. The role is checked against the database on every request;
	// the catch-all keeps unregistered /api/admin/ paths behind the same guard.
	protectAdmin := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(h.requireAdmin(false, handler)))
	}
	protectOwner := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(h.requireAdmin(true, handler)))
	}
	mux.Handle("GET /api/admin/overview", protectAdmin(h.AdminOverview))
	mux.Handle("GET /api/admin/config", protectAdmin(h.AdminGetConfig))
	mux.Handle("PATCH /api/admin/config", protectAdmin(h.AdminUpdateConfig))
	mux.Handle("GET /api/admin/invites", protectAdmin(h.AdminListInvites))
	mux.Handle("POST /api/admin/invites", protectAdmin(h.AdminCreateInvite))
	mux.Handle("DELETE /api/admin/invites/{code}", protectAdmin(h.AdminRevokeInvite))
	mux.Handle("GET /api/admin/audit", protectAdmin(h.AdminAudit))
	mux.Handle("POST /api/admin/notices", protectOwner(h.AdminSendNotice))
	mux.Handle("GET /api/admin/admins", protectAdmin(h.AdminListAdmins))
	mux.Handle("PUT /api/admin/admins/{username}", protectOwner(h.AdminGrantAdmin))
	mux.Handle("DELETE /api/admin/admins/{username}", protectOwner(h.AdminRevokeAdmin))
	mux.Handle("POST /api/admin/owner/transfer", protectOwner(h.AdminTransferOwner))
	mux.Handle("POST /api/admin/backup", protectOwner(h.AdminBackup))
	mux.Handle("POST /api/admin/restore", protectOwner(h.AdminRestore))
	mux.Handle("POST /api/admin/reset", protectOwner(h.AdminReset))
	mux.Handle("POST /api/admin/delete", protectOwner(h.AdminDeleteServer))
	mux.Handle("/api/admin/", protectAdmin(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "admin.errors.not_found")
	}))

	// Public
	mux.Handle("GET /api/version", http.HandlerFunc(h.GetVersion))
	mux.Handle("GET /api/server-info", http.HandlerFunc(h.GetServerInfo))
	mux.Handle("POST /api/register", authLimiter.Limit(http.HandlerFunc(h.Register)))
	mux.Handle("POST /api/login", authLimiter.Limit(http.HandlerFunc(h.Login)))
	// Deliberately not behind authLimiter: a challenge is cheap to issue and worthless without a sign-up, which
	// has its own limit. The strict sign-in limit would turn a retry, or a shared address, into a failed check.
	mux.Handle("GET /api/captcha/challenge", http.HandlerFunc(h.GetCaptchaChallenge))

	// Protected
	mux.Handle("POST /api/logout", protect(h.Logout))
	mux.Handle("GET /api/me", protect(h.Me))
	mux.Handle("GET /api/sessions", protect(h.ListSessions))
	mux.Handle("POST /api/sessions/terminate-others", protect(h.TerminateOtherSessions))
	mux.Handle("DELETE /api/sessions/{id}", protect(h.TerminateSession))
	mux.Handle("DELETE /api/users/me", protect(h.DeleteAccount))
	mux.Handle("PATCH /api/users/me", protect(h.UpdateProfile))
	mux.Handle("GET /api/users", protect(h.SearchUsers))
	mux.Handle("GET /api/users/{id}", protect(h.GetUser))
	mux.Handle("GET /api/users/{id}/presence", protect(h.GetPresence))

	// Relationships (Friends / Blocking / Requests)
	mux.Handle("GET /api/relationships", protect(h.ListRelationships))
	mux.Handle("GET /api/relationships/incoming", protect(h.ListIncomingRequests))
	mux.Handle("GET /api/users/{id}/relationship", protect(h.GetRelationship))
	mux.Handle("PUT /api/users/{id}/relationship", protect(h.HandleRelationshipAction))

	mux.Handle("POST /api/channels", protect(h.CreateChannel))
	mux.Handle("GET /api/channels", protect(h.ListChannels))
	mux.Handle("GET /api/channels/explore", protect(h.ExploreChannels))
	mux.Handle("GET /api/channels/{id}", protectMember(h.GetChannel))
	mux.Handle("PATCH /api/channels/{id}", protectMember(h.UpdateChannel))
	mux.Handle("DELETE /api/channels/{id}", protectMember(h.DeleteChannel))
	mux.Handle("GET /api/join/{link}", protect(h.PreviewInvite))
	mux.Handle("POST /api/join/{link}", protect(h.JoinChannel))
	mux.Handle("POST /api/channels/{id}/invite/regenerate", protectMember(h.RegenerateInvite))
	mux.Handle("GET /api/channels/{id}/members", protectMember(h.GetChannelMembers))
	mux.Handle("POST /api/channels/{id}/members", protectMember(h.AddMembers))
	mux.Handle("PATCH /api/channels/{id}/members/{uid}", protectMember(h.UpdateMember))
	mux.Handle("DELETE /api/channels/{id}/members/{uid}", protectMember(h.RemoveMember))
	mux.Handle("GET /api/channels/{id}/messages", protectMember(h.ListMessages))

	mux.Handle("POST /api/files", protect(h.UploadFile))
	mux.Handle("GET /api/files/{id}", protect(h.DownloadFile))

	return middleware.CORS(mux, h.IsDev, h.FrontendOrigin)
}
