package api

import (
	"context"
	"net/http"
	"strconv"

	"cove/backend/internal/apistd"
	"cove/backend/internal/bots"
	"cove/backend/internal/models"
	"cove/backend/internal/store"

	"golang.org/x/time/rate"
)

type botCtxKeyType int

const (
	botCtxKey botCtxKeyType = iota
	botUserCtxKey
	botScopesCtxKey
)

// BotFromContext returns the bot a `Authorization: Bot` request authenticated as (set by requireBot).
func BotFromContext(ctx context.Context) (*models.Bot, *models.User) {
	b, _ := ctx.Value(botCtxKey).(*models.Bot)
	u, _ := ctx.Value(botUserCtxKey).(*models.User)
	return b, u
}

// botsEnabled answers 403 bots_disabled and returns false when the admin switched the Bot API off.
func (h *Handler) botsEnabled(w http.ResponseWriter) bool {
	if h.botSettings().Enabled {
		return true
	}
	writeErrorCode(w, http.StatusForbidden, apistd.CodeBotsDisabled, "apiErrors.bots_disabled")
	return false
}

// limiterFor returns the token bucket stored under key, creating it with rps and burst.
func (h *Handler) limiterFor(key string, rps float64, burst int) *rate.Limiter {
	if v, ok := h.botLimiters.Load(key); ok {
		return v.(*rate.Limiter)
	}
	v, _ := h.botLimiters.LoadOrStore(key, rate.NewLimiter(rate.Limit(rps), burst))
	return v.(*rate.Limiter)
}

func tooManyRequests(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(1))
	writeErrorCode(w, http.StatusTooManyRequests, apistd.CodeRateLimited, "apiErrors.rate_limited")
}

// requireBot is the Bot access tier: it accepts only `Authorization: Bot <token>`. Session cookies and Bearer
// tokens are never accepted here, and Sessions.Require never accepts a Bot token, so a credential of one kind
// cannot reach a route of the other. Every failure to identify the bot is the same 401.
func (h *Handler) requireBot(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bots.BotToken(r)
		bot, user, err := h.Store.AuthenticateBot(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !h.botsEnabled(w) {
			return
		}
		if bot.Disabled {
			writeError(w, http.StatusForbidden, "apiErrors.bot_disabled")
			return
		}
		rps := float64(h.botSettings().RateLimitRPS)
		if !h.limiterFor("bot:"+bot.ID, rps, int(rps)*2).Allow() {
			tooManyRequests(w)
			return
		}
		ctx := context.WithValue(r.Context(), botCtxKey, bot)
		ctx = context.WithValue(ctx, botUserCtxKey, user)
		next(w, r.WithContext(ctx))
	}
}

// requireBotChannel runs after requireBot for routes under /api/bots/me/channels/{id}: the bot must be an active
// member with an install (or the DM it was opened in) and hold scope (empty means any install). A channel the bot
// has no access to answers 404, never 403, so channel ids cannot be probed.
func (h *Handler) requireBotChannel(scope string, next http.HandlerFunc) http.HandlerFunc {
	return h.requireBot(func(w http.ResponseWriter, r *http.Request) {
		_, user := BotFromContext(r.Context())
		ch, err := h.Store.GetChannel(r.PathValue("id"))
		if err != nil {
			writeError(w, http.StatusNotFound, "apiErrors.channel_not_found")
			return
		}
		scopes, ok := h.Store.BotChannelScopes(ch.ID, user.ID)
		if !ok {
			writeError(w, http.StatusNotFound, "apiErrors.channel_not_found")
			return
		}
		if scope != "" && !store.HasScope(scopes, scope) {
			writeError(w, http.StatusForbidden, "apiErrors.bot_scope_missing")
			return
		}
		ctx := context.WithValue(r.Context(), channelCtxKey, ch)
		ctx = context.WithValue(ctx, botScopesCtxKey, scopes)
		next(w, r.WithContext(ctx))
	})
}
