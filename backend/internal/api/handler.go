// Package api provides HTTP REST handlers for the Cove API.
package api

import (
	"net/http"
	"sync"
	"time"

	"cove/backend/internal/bots"

	"cove/backend/internal/auth"
	"cove/backend/internal/captcha"
	"cove/backend/internal/config"
	"cove/backend/internal/geoip"
	"cove/backend/internal/middleware"
	"cove/backend/internal/models"
	"cove/backend/internal/packs"
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
	// PublishMessage broadcasts a message created or changed over REST (by a bot) to the channel's members.
	PublishMessage(eventType string, msg *models.Message)
	// PublishChannelEvent broadcasts a JSON event (keyboard updates) to the channel's members.
	PublishChannelEvent(channelID, eventType string, payload any)
}

// Handler bundles all HTTP handler dependencies.
type Handler struct {
	Store    *store.Store
	Sessions *auth.SessionStore
	Hub      ChannelBroadcaster
	// Geo resolves login IPs to a city/country for the active-devices list. Optional: nil means IP only.
	Geo geoip.Resolver
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

	// API standard (docs/api-standard.md): the oldest client the admin supports, whether that is a hard 426 or only
	// a warning, and the calling engine ("webrtc" | "raw_udp") that decides the advertised capabilities.
	MinClientVersion string
	EnforceMinClient bool
	VoiceMode        string

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

	// globalLimiter is the per-IP limiter NewRouter builds for the API; WrapWS reuses it so the WebSocket upgrade
	// shares the same bucket. Ephemeral by design, like every rate limiter.
	globalLimiter *middleware.RateLimiter

	// Updater powers GET/POST /api/admin/update (server self-update). Nil reports "unsupported".
	Updater *Updater
	// NotifyUpdates makes the update notifier message the owner and admins about each new release.
	NotifyUpdates bool

	// Bots delivers events to bots (gateway and webhooks) and tracks which bots are online. Nil means no bot ever
	// receives an event (older tests); the REST side of the Bot API still works.
	Bots *bots.Dispatcher

	// botLimiters holds the per-bot (and per-bot-per-channel) token buckets. Ephemeral by design, like every limiter.
	botLimiters sync.Map

	// Packs overrides the built-in emoji and sticker assets (tests); nil means the ones embedded in the binary.
	Packs *packs.Catalog
}

// NewRouter wires the full HTTP API with rate limiting.
func NewRouter(h *Handler, globalRPS, authRPS float64) http.Handler {
	mux := http.NewServeMux()

	authLimiter := middleware.NewRateLimiter(authRPS, int(authRPS)*2)
	globalLimiter := middleware.NewRateLimiter(globalRPS, int(globalRPS)*2)
	h.globalLimiter = globalLimiter
	protect := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(handler))
	}
	protectMember := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.Sessions.Require(h.RequireMember(handler)))
	}

	// Bot access tier: only `Authorization: Bot <token>` is accepted (see bots_auth.go). A route is reachable by a
	// bot only if it is wrapped in one of these two; every other wrapper rejects bot tokens.
	protectBot := func(handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.requireBot(handler))
	}
	protectBotChannel := func(scope string, handler http.HandlerFunc) http.Handler {
		return globalLimiter.Limit(h.requireBotChannel(scope, handler))
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
	mux.Handle("GET /api/admin/update", protectAdmin(h.AdminGetUpdate))
	mux.Handle("POST /api/admin/update", protectOwner(h.AdminStartUpdate))
	mux.Handle("POST /api/admin/update/upload", protectOwner(h.AdminUploadUpdate))
	mux.Handle("POST /api/admin/restart", protectOwner(h.AdminRestart))
	// Emoji packs and stickers (docs/packs-api.md). Admin management first; the catch-all below stays last.
	mux.Handle("GET /api/admin/packs", protectAdmin(h.AdminListPacks))
	mux.Handle("POST /api/admin/packs", protectAdmin(h.AdminCreatePack))
	mux.Handle("PATCH /api/admin/packs/{id}", protectAdmin(h.AdminUpdatePack))
	mux.Handle("DELETE /api/admin/packs/{id}", protectAdmin(h.AdminDeletePack))
	mux.Handle("POST /api/admin/packs/{id}/items", protectAdmin(h.AdminUploadPackItem))
	mux.Handle("DELETE /api/admin/packs/{id}/items/{item}", protectAdmin(h.AdminDeletePackItem))
	mux.Handle("PUT /api/admin/packs/{id}/order", protectAdmin(h.AdminReorderPackItems))
	mux.Handle("POST /api/admin/emoji", protectAdmin(h.AdminAddCustomEmoji))
	mux.Handle("DELETE /api/admin/emoji/{name}", protectAdmin(h.AdminDeleteCustomEmoji))
	mux.Handle("/api/admin/", protectAdmin(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "admin.errors.not_found")
	}))

	// Public
	mux.Handle("GET /api/version", http.HandlerFunc(h.GetVersion))
	mux.Handle("GET /api/server-info", http.HandlerFunc(h.GetServerInfo))
	mux.Handle("POST /api/register", authLimiter.Limit(http.HandlerFunc(h.Register)))
	mux.Handle("POST /api/login", authLimiter.Limit(http.HandlerFunc(h.Login)))
	// Deliberately not behind authLimiter: a challenge is cheap to issue and worthless without a sign-up, which
	// has its own limit, and the strict sign-in limit would turn a retry or a shared address into a failed check.
	// It still gets the general per-IP limit so the endpoint (which signs a fresh challenge per call) cannot be
	// used to burn CPU or fill the one-use cache.
	mux.Handle("GET /api/captcha/challenge", globalLimiter.Limit(http.HandlerFunc(h.GetCaptchaChallenge)))

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

	// Emoji styles, custom emoji, animated emoji and stickers. Asset URLs carry a content version and are immutable.
	mux.Handle("GET /api/emoji/styles", protect(h.ListEmojiStyles))
	mux.Handle("GET /api/emoji/styles/{style}/{version}/{file}", protect(h.GetEmojiStyleAsset))
	mux.Handle("GET /api/emoji/custom", protect(h.ListCustomEmoji))
	mux.Handle("GET /api/emoji/animated", protect(h.ListAnimatedEmoji))
	mux.Handle("GET /api/emoji/animated/{version}/{file}", protect(h.GetAnimatedEmojiAsset))
	mux.Handle("GET /api/stickers/builtin/{pack}/{version}/{file}", protect(h.GetBuiltinSticker))
	mux.Handle("GET /api/packs/attribution", protect(h.GetPackAttribution))
	mux.Handle("GET /api/packs", protect(h.ListPacks))
	mux.Handle("POST /api/packs", protect(h.CreatePack))
	mux.Handle("GET /api/packs/{id}", protect(h.GetPack))
	mux.Handle("PATCH /api/packs/{id}", protect(h.UpdatePack))
	mux.Handle("DELETE /api/packs/{id}", protect(h.DeletePack))
	mux.Handle("PUT /api/packs/{id}/install", protect(h.InstallPack))
	mux.Handle("DELETE /api/packs/{id}/install", protect(h.UninstallPack))
	mux.Handle("POST /api/packs/{id}/items", protect(h.UploadPackItem))
	mux.Handle("DELETE /api/packs/{id}/items/{item}", protect(h.DeletePackItem))
	mux.Handle("GET /api/packs/{id}/items/{item}/file", protect(h.GetPackItemFile))
	mux.Handle("PUT /api/packs/{id}/order", protect(h.ReorderPackItems))

	// Bots (docs/bots-api.md). Management uses the user's session; /api/bots/me/... is the Bot tier.
	mux.Handle("POST /api/bots", protect(h.CreateBot))
	mux.Handle("GET /api/bots", protect(h.ListBots))
	mux.Handle("GET /api/bots/discover", protect(h.DiscoverBots))
	mux.Handle("GET /api/bots/{id}", protect(h.GetBot))
	mux.Handle("PATCH /api/bots/{id}", protect(h.UpdateBot))
	mux.Handle("DELETE /api/bots/{id}", protect(h.DeleteBot))
	mux.Handle("POST /api/bots/{id}/token", protect(h.RotateBotToken))
	mux.Handle("GET /api/channels/{id}/bots", protectMember(h.ListChannelBots))
	mux.Handle("PUT /api/channels/{id}/bots/{bot_id}", protectMember(h.InstallBot))
	mux.Handle("DELETE /api/channels/{id}/bots/{bot_id}", protectMember(h.UninstallBot))
	mux.Handle("GET /api/channels/{id}/commands", protectMember(h.ListChannelCommands))
	mux.Handle("GET /api/channels/{id}/keyboards", protectMember(h.ListChannelKeyboards))
	mux.Handle("POST /api/channels/{id}/interactions", protectMember(h.CreateInteraction))
	mux.Handle("GET /api/bots/me", protectBot(h.GetBotMe))
	mux.Handle("GET /api/bots/me/commands", protectBot(h.ListGlobalCommands))
	mux.Handle("PUT /api/bots/me/commands", protectBot(h.SetGlobalCommands))
	mux.Handle("DELETE /api/bots/me/commands/{name}", protectBot(h.DeleteGlobalCommand))
	mux.Handle("GET /api/bots/me/channels", protectBot(h.ListBotChannels))
	mux.Handle("PUT /api/bots/me/channels/{id}/commands", protectBotChannel("", h.SetChannelCommands))
	mux.Handle("POST /api/bots/me/channels/{id}/messages", protectBotChannel(models.ScopeMessagesSend, h.PostBotMessage))
	mux.Handle("GET /api/bots/me/channels/{id}/messages", protectBotChannel(models.ScopeMessagesRead, h.ListBotMessages))
	mux.Handle("PATCH /api/bots/me/channels/{id}/messages/{mid}", protectBotChannel(models.ScopeMessagesSend, h.EditBotMessage))
	mux.Handle("DELETE /api/bots/me/channels/{id}/messages/{mid}", protectBotChannel(models.ScopeMessagesSend, h.DeleteBotMessage))
	mux.Handle("GET /api/bots/me/channels/{id}/members", protectBotChannel(models.ScopeMembersRead, h.ListBotMembers))
	mux.Handle("PUT /api/bots/me/channels/{id}/keyboard", protectBotChannel(models.ScopeMessagesSend, h.SetKeyboard))
	mux.Handle("DELETE /api/bots/me/channels/{id}/keyboard", protectBotChannel(models.ScopeMessagesSend, h.DeleteKeyboard))
	mux.Handle("POST /api/bots/me/dm", protectBot(h.OpenBotDM))
	mux.Handle("POST /api/interactions/{id}/{token}/callback", protectBot(h.InteractionCallback))

	mux.Handle("POST /api/files", protect(h.UploadFile))
	mux.Handle("GET /api/files/{id}", protect(h.DownloadFile))

	return middleware.CORS(middleware.ClientVersion(middleware.ClientVersionConfig{
		MinClientVersion: h.MinClientVersion,
		Enforce:          h.EnforceMinClient,
	}, mux), h.IsDev, h.FrontendOrigin)
}

// WrapWS puts the WebSocket upgrade handler (mounted at /ws outside NewRouter) under the same API-standard
// treatment as the REST routes: X-Cove-API-Version / X-Cove-Server-Version on the 101 (and on a 429) and the
// same per-IP rate limit bucket. The minimum-client check never blocks it (the path is outside /api/); an outdated
// client learns about the problem from the hello event. Call it after NewRouter so the shared limiter exists.
func (h *Handler) WrapWS(next http.Handler) http.Handler {
	if h.globalLimiter != nil {
		next = h.globalLimiter.Limit(next)
	}
	return middleware.ClientVersion(middleware.ClientVersionConfig{
		MinClientVersion: h.MinClientVersion,
		Enforce:          h.EnforceMinClient,
	}, next)
}
