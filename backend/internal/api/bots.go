package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"cove/backend/internal/apistd"
	"cove/backend/internal/auth"
	"cove/backend/internal/bots"
	"cove/backend/internal/config"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// maxBotsPerChannel bounds how many bots a group channel may have installed.
const maxBotsPerChannel = 20

// caller loads the signed-in user of a request; it answers 401 itself when the account is gone.
func (h *Handler) caller(w http.ResponseWriter, r *http.Request) *models.User {
	session := auth.SessionFromContext(r.Context())
	u, err := h.Store.GetUser(session.UserID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return nil
	}
	return u
}

func canManageBot(caller *models.User, b *models.Bot) bool {
	return b.OwnerID == caller.ID || models.IsServerAdmin(caller.ServerRole)
}

// botView builds the response for a bot. private adds what only managers see (the webhook URL).
func (h *Handler) botView(b *models.Bot, u *models.User, private bool) BotResponse {
	resp := BotResponse{
		ID: b.ID, Username: u.Username, Description: b.Description, AvatarID: u.AvatarID, OwnerID: b.OwnerID,
		Public: b.Public, Disabled: b.Disabled, CreatedAt: b.CreatedAt,
	}
	if private {
		resp.WebhookURL = b.WebhookURL
	}
	if h.Bots != nil {
		resp.Online = h.Bots.Online(b.ID)
	}
	if installs, err := h.Store.ListBotInstalls(b.ID); err == nil {
		resp.InstallCount = len(installs)
	}
	if cmds, err := h.Store.ListBotCommands(b.ID, store.GlobalScope); err == nil {
		resp.CommandCount = len(cmds)
	}
	return resp
}

// loadManagedBot resolves {id} to a bot the caller owns or administers. Anything else is a 404, so the existence of
// other people's bots is not revealed.
func (h *Handler) loadManagedBot(w http.ResponseWriter, r *http.Request) (*models.User, *models.Bot, *models.User) {
	caller := h.caller(w, r)
	if caller == nil {
		return nil, nil, nil
	}
	b, err := h.Store.GetBot(r.PathValue("id"))
	if err != nil || !canManageBot(caller, b) {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return nil, nil, nil
	}
	u, err := h.Store.GetUser(b.ID)
	if err != nil {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return nil, nil, nil
	}
	return caller, b, u
}

// mayCreateBots applies the admin policy (bots.creation) to the caller.
func (h *Handler) mayCreateBots(caller *models.User) bool {
	cfg := h.botSettings()
	switch {
	case !cfg.Enabled, cfg.Creation == config.BotCreationDisabled:
		return false
	case cfg.Creation == config.BotCreationUsers:
		return true
	default:
		return models.IsServerAdmin(caller.ServerRole)
	}
}

// CreateBot godoc
//
//	@Summary     Create a bot
//	@Description Creates a bot account owned by the caller and returns its token **once**. Who may create bots is an
//	@Description admin setting (`bots.creation`: admins only by default). The token is `<bot_id>.<secret>`; only a hash is stored.
//	@Description **Access:** Authenticated (policy: Server Admin, or every user when the admin allows it).
//	@Tags        bots
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body CreateBotRequest true "Bot"
//	@Success     201 {object} CreateBotResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots [post]
func (h *Handler) CreateBot(w http.ResponseWriter, r *http.Request) {
	caller := h.caller(w, r)
	if caller == nil {
		return
	}
	if !h.botsEnabled(w) {
		return
	}
	if !h.mayCreateBots(caller) {
		writeErrorCode(w, http.StatusForbidden, apistd.CodeForbidden, "apiErrors.bot_creation_not_allowed")
		return
	}
	var body CreateBotRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !bots.ValidBotName(body.Username) {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.bot_name_invalid")
		return
	}
	if err := bots.ValidateDescription(body.Description); err != nil {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.bot_description_too_long")
		return
	}
	if err := bots.ValidateWebhookURL(body.WebhookURL, h.IsDev); err != nil {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeWebhookURLInvalid, "apiErrors.webhook_url_invalid")
		return
	}
	u, b, token, err := h.Store.CreateBot(caller.ID, body.Username, body.Description, caller.Domain, h.botSettings().MaxPerUser)
	switch {
	case errors.Is(err, store.ErrBotLimit):
		writeErrorCode(w, http.StatusConflict, apistd.CodeBotLimitReached, "apiErrors.bot_limit_reached")
		return
	case errors.Is(err, store.ErrUsernameTaken):
		writeErrorCode(w, http.StatusConflict, apistd.CodeConflict, "apiErrors.username_taken")
		return
	case err != nil:
		writeInternal(w, "create bot", err, "apiErrors.bot_create_failed")
		return
	}
	b.Public = body.Public
	secret := ""
	if body.WebhookURL != "" {
		if secret, err = store.NewWebhookSecret(); err != nil {
			writeInternal(w, "webhook secret", err, "apiErrors.bot_create_failed")
			return
		}
		b.WebhookURL, b.WebhookSecret = body.WebhookURL, secret
	}
	if b.Public || b.WebhookURL != "" {
		if err := h.Store.SaveBot(b); err != nil {
			writeInternal(w, "save bot "+b.ID, err, "apiErrors.bot_create_failed")
			return
		}
	}
	h.audit(caller, "bot.create", u.Username)
	writeJSON(w, http.StatusCreated, CreateBotResponse{Bot: h.botView(b, u, true), Token: token, WebhookSecret: secret})
}

// ListBots godoc
//
//	@Summary     List my bots
//	@Description Paged (`{items, next_cursor}`), oldest first, with what the caller may do (`can_create`). Server admins
//	@Description may pass `all=1` to list every bot on the server.
//	@Description **Access:** Authenticated.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor"
//	@Param       all    query bool   false "Admins only: every bot of the server"
//	@Success     200 {object} BotPageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots [get]
func (h *Handler) ListBots(w http.ResponseWriter, r *http.Request) {
	caller := h.caller(w, r)
	if caller == nil {
		return
	}
	limit, cursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	var list []*models.Bot
	var err error
	if r.URL.Query().Get("all") == "1" && models.IsServerAdmin(caller.ServerRole) {
		list, err = h.Store.ListAllBots()
	} else {
		list, err = h.Store.ListBotsByOwner(caller.ID)
	}
	if err != nil {
		writeInternal(w, "list bots", err, "apiErrors.bots_load_failed")
		return
	}
	mine, _ := h.Store.ListBotsByOwner(caller.ID)
	cfg := h.botSettings()
	canCreate := h.mayCreateBots(caller) && len(mine) < cfg.MaxPerUser
	items := make([]BotResponse, 0, len(list))
	for _, b := range list {
		if u, err := h.Store.GetUser(b.ID); err == nil {
			items = append(items, h.botView(b, u, true))
		}
	}
	writePage(w, items, cursor, limit, func(page []BotResponse, next string) BotPageResponse {
		return BotPageResponse{Items: page, NextCursor: next, CanCreate: canCreate, MaxPerUser: cfg.MaxPerUser, Enabled: cfg.Enabled}
	})
}

// DiscoverBots godoc
//
//	@Summary     Find public bots
//	@Description Paged list of public, enabled bots that channel admins can install, optionally filtered by `q`
//	@Description (substring of the name or description).
//	@Description **Access:** Authenticated.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       q      query string false "Filter"
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor"
//	@Success     200 {object} BotPageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/discover [get]
func (h *Handler) DiscoverBots(w http.ResponseWriter, r *http.Request) {
	caller := h.caller(w, r)
	if caller == nil {
		return
	}
	limit, cursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	all, err := h.Store.ListAllBots()
	if err != nil {
		writeInternal(w, "discover bots", err, "apiErrors.bots_load_failed")
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	cfg := h.botSettings()
	items := make([]BotResponse, 0)
	for _, b := range all {
		if b.Disabled || (!b.Public && b.OwnerID != caller.ID) {
			continue
		}
		u, err := h.Store.GetUser(b.ID)
		if err != nil {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(u.Username), q) && !strings.Contains(strings.ToLower(b.Description), q) {
			continue
		}
		items = append(items, h.botView(b, u, b.OwnerID == caller.ID))
	}
	writePage(w, items, cursor, limit, func(page []BotResponse, next string) BotPageResponse {
		return BotPageResponse{Items: page, NextCursor: next, MaxPerUser: cfg.MaxPerUser, Enabled: cfg.Enabled}
	})
}

// GetBot godoc
//
//	@Summary     Get a bot
//	@Description **Access:** Authenticated; the bot's owner or a server admin (other people's bots answer 404).
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Bot ID"
//	@Success     200 {object} BotResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/bots/{id} [get]
func (h *Handler) GetBot(w http.ResponseWriter, r *http.Request) {
	_, b, u := h.loadManagedBot(w, r)
	if b == nil {
		return
	}
	writeJSON(w, http.StatusOK, h.botView(b, u, true))
}

// UpdateBot godoc
//
//	@Summary     Update a bot
//	@Description Changes the description, avatar, visibility, enabled state and webhook. Disabling a bot closes its
//	@Description gateway connections and stops all deliveries. A new webhook secret is returned once.
//	@Description **Access:** Authenticated; the bot's owner or a server admin.
//	@Tags        bots
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string          true "Bot ID"
//	@Param       body body UpdateBotRequest true "Changes"
//	@Success     200 {object} UpdateBotResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/{id} [patch]
func (h *Handler) UpdateBot(w http.ResponseWriter, r *http.Request) {
	caller, b, u := h.loadManagedBot(w, r)
	if b == nil {
		return
	}
	if !h.botsEnabled(w) {
		return
	}
	var body UpdateBotRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	newSecret := ""
	if body.Description != nil {
		if err := bots.ValidateDescription(*body.Description); err != nil {
			writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.bot_description_too_long")
			return
		}
		b.Description = *body.Description
	}
	if body.AvatarID != nil {
		if *body.AvatarID != "" {
			f, err := h.Store.GetFile(*body.AvatarID)
			if err != nil || f.OwnerID != caller.ID {
				writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.avatar_invalid")
				return
			}
		}
		u.AvatarID = *body.AvatarID
	}
	if body.Public != nil {
		b.Public = *body.Public
	}
	if body.WebhookURL != nil {
		if err := bots.ValidateWebhookURL(*body.WebhookURL, h.IsDev); err != nil {
			writeErrorCode(w, http.StatusBadRequest, apistd.CodeWebhookURLInvalid, "apiErrors.webhook_url_invalid")
			return
		}
		b.WebhookURL = *body.WebhookURL
		if b.WebhookURL == "" {
			b.WebhookSecret = ""
		} else if b.WebhookSecret == "" {
			body.RotateWebhookSecret = true
		}
	}
	if body.RotateWebhookSecret && b.WebhookURL != "" {
		s, err := store.NewWebhookSecret()
		if err != nil {
			writeInternal(w, "webhook secret", err, "apiErrors.bot_update_failed")
			return
		}
		b.WebhookSecret, newSecret = s, s
	}
	wasDisabled := b.Disabled
	if body.Disabled != nil {
		b.Disabled = *body.Disabled
	}
	if err := h.Store.SaveBot(b); err != nil {
		writeInternal(w, "save bot "+b.ID, err, "apiErrors.bot_update_failed")
		return
	}
	if body.AvatarID != nil {
		if err := h.Store.UpdateUser(u); err != nil {
			writeInternal(w, "save bot user "+b.ID, err, "apiErrors.bot_update_failed")
			return
		}
	}
	switch {
	case b.Disabled && !wasDisabled:
		if h.Bots != nil {
			h.Bots.DisconnectBot(b.ID)
		}
		h.audit(caller, "bot.disable", u.Username)
	case !b.Disabled && wasDisabled:
		h.audit(caller, "bot.enable", u.Username)
	}
	if body.WebhookURL != nil || newSecret != "" {
		h.audit(caller, "bot.webhook_set", u.Username)
	}
	writeJSON(w, http.StatusOK, UpdateBotResponse{Bot: h.botView(b, u, true), WebhookSecret: newSecret})
}

// DeleteBot godoc
//
//	@Summary     Delete a bot
//	@Description Removes the bot, its installs, commands and keyboards, and closes its connections. Messages it sent
//	@Description stay in the history.
//	@Description **Access:** Authenticated; the bot's owner or a server admin.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Bot ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/{id} [delete]
func (h *Handler) DeleteBot(w http.ResponseWriter, r *http.Request) {
	caller, b, u := h.loadManagedBot(w, r)
	if b == nil {
		return
	}
	if h.Bots != nil {
		h.Bots.DisconnectBot(b.ID)
	}
	channels, err := h.Store.DeleteBot(b.ID)
	if err != nil {
		writeInternal(w, "delete bot "+b.ID, err, "apiErrors.bot_delete_failed")
		return
	}
	if h.Hub != nil {
		for _, ch := range channels {
			h.Hub.BroadcastMemberLeft(ch, b.ID)
		}
	}
	h.audit(caller, "bot.delete", u.Username)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// RotateBotToken godoc
//
//	@Summary     Rotate a bot's token
//	@Description Issues a new token (returned once) and invalidates the old one immediately; the bot's open gateway
//	@Description connections are closed.
//	@Description **Access:** Authenticated; the bot's owner or a server admin.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Bot ID"
//	@Success     200 {object} BotTokenResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/{id}/token [post]
func (h *Handler) RotateBotToken(w http.ResponseWriter, r *http.Request) {
	caller, b, u := h.loadManagedBot(w, r)
	if b == nil {
		return
	}
	token, err := h.Store.RotateBotToken(b.ID)
	if err != nil {
		writeInternal(w, "rotate bot token "+b.ID, err, "apiErrors.bot_update_failed")
		return
	}
	if h.Bots != nil {
		h.Bots.DisconnectBot(b.ID)
	}
	h.audit(caller, "bot.rotate_token", u.Username)
	writeJSON(w, http.StatusOK, BotTokenResponse{Token: token})
}

// ---- Channel installs ----------------------------------------------------------------------------------------- //

// ListChannelBots godoc
//
//	@Summary     List the bots installed in a channel
//	@Description Bounded by the per-channel install cap (20), so it is not paged.
//	@Description **Access:** Channel Member.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} ChannelBotsResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/bots [get]
func (h *Handler) ListChannelBots(w http.ResponseWriter, r *http.Request) {
	ch := ChannelFromContext(r.Context())
	installs, err := h.Store.ListChannelInstalls(ch.ID)
	if err != nil {
		writeInternal(w, "list installs of "+ch.ID, err, "apiErrors.bots_load_failed")
		return
	}
	out := ChannelBotsResponse{Items: []ChannelBotResponse{}}
	for _, in := range installs {
		b, err := h.Store.GetBot(in.BotID)
		u, uerr := h.Store.GetUser(in.BotID)
		if err != nil || uerr != nil {
			continue
		}
		out.Items = append(out.Items, ChannelBotResponse{Bot: h.botView(b, u, false), Scopes: in.Scopes, InstalledBy: in.InstalledBy, InstalledAt: in.InstalledAt})
	}
	writeJSON(w, http.StatusOK, out)
}

// InstallBot godoc
//
//	@Summary     Install a bot in a channel
//	@Description Adds the bot to a group channel as an ordinary member with the granted scopes (`messages.read`,
//	@Description `messages.send`, `members.read`; default `messages.send`). Calling it again changes the scopes. A bot
//	@Description is never an admin. Public bots, the caller's own bots, or any bot for a server admin can be installed.
//	@Description DMs cannot have bots installed. The bot's owner receives the messages the scopes allow in plaintext.
//	@Description **Access:** Channel Admin.
//	@Tags        bots
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id     path string             true "Channel ID"
//	@Param       bot_id path string             true "Bot ID"
//	@Param       body   body InstallBotRequest  false "Scopes"
//	@Success     200 {object} ChannelBotResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/bots/{bot_id} [put]
func (h *Handler) InstallBot(w http.ResponseWriter, r *http.Request) {
	if !h.botsEnabled(w) {
		return
	}
	caller := h.caller(w, r)
	if caller == nil {
		return
	}
	ch := ChannelFromContext(r.Context())
	if uc, err := h.Store.GetUserChannel(caller.ID, ch.ID); err != nil || uc.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "apiErrors.bot_install_admin_only")
		return
	}
	b, err := h.Store.GetBot(r.PathValue("bot_id"))
	if err != nil || b.Disabled || (!b.Public && !canManageBot(caller, b)) {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return
	}
	var body InstallBotRequest
	if r.ContentLength != 0 {
		if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
			return
		}
	}
	scopes, err := bots.ValidateScopes(body.Scopes)
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.bot_scope_invalid")
		return
	}
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeInternal(w, "members of "+ch.ID, err, "apiErrors.bots_load_failed")
		return
	}
	if ch.IsDM(len(members)) {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.bot_install_dm")
		return
	}
	installs, _ := h.Store.ListChannelInstalls(ch.ID)
	_, existing := h.Store.GetBotInstall(ch.ID, b.ID)
	if existing != nil && len(installs) >= maxBotsPerChannel {
		writeErrorCode(w, http.StatusConflict, apistd.CodeConflict, "apiErrors.bot_channel_limit")
		return
	}
	in := &models.BotInstall{BotID: b.ID, Scopes: scopes, InstalledBy: caller.ID}
	if err := h.Store.InstallBot(ch.ID, in); err != nil {
		writeInternal(w, "install bot "+b.ID+" in "+ch.ID, err, "apiErrors.bot_install_failed")
		return
	}
	u, _ := h.Store.GetUser(b.ID)
	if h.Hub != nil {
		h.Hub.BroadcastMemberJoined(ch.ID, b.ID)
	}
	if h.Bots != nil {
		h.Bots.Deliver(b.ID, bots.EventBotInstall, bots.InstallEvent{ChannelID: ch.ID, Scopes: scopes})
	}
	h.audit(caller, "bot.install", u.Username+"@"+ch.ID)
	writeJSON(w, http.StatusOK, ChannelBotResponse{Bot: h.botView(b, u, false), Scopes: scopes, InstalledBy: caller.ID, InstalledAt: in.InstalledAt})
}

// UninstallBot godoc
//
//	@Summary     Remove a bot from a channel
//	@Description Removes the bot's membership, install, channel commands and keyboard.
//	@Description **Access:** Channel Admin.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id     path string true "Channel ID"
//	@Param       bot_id path string true "Bot ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/bots/{bot_id} [delete]
func (h *Handler) UninstallBot(w http.ResponseWriter, r *http.Request) {
	caller := h.caller(w, r)
	if caller == nil {
		return
	}
	ch := ChannelFromContext(r.Context())
	if uc, err := h.Store.GetUserChannel(caller.ID, ch.ID); err != nil || uc.Role < models.RoleAdmin {
		writeError(w, http.StatusForbidden, "apiErrors.bot_install_admin_only")
		return
	}
	botID := r.PathValue("bot_id")
	if _, err := h.Store.GetBotInstall(ch.ID, botID); err != nil {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return
	}
	if err := h.Store.RemoveBotFromChannel(ch.ID, botID); err != nil {
		writeInternal(w, "uninstall bot "+botID, err, "apiErrors.bot_install_failed")
		return
	}
	u, _ := h.Store.GetUser(botID)
	if h.Bots != nil {
		h.Bots.Deliver(botID, bots.EventBotUninstall, bots.InstallEvent{ChannelID: ch.ID})
	}
	if h.Hub != nil {
		h.Hub.BroadcastMemberLeft(ch.ID, botID)
	}
	if u != nil {
		h.audit(caller, "bot.uninstall", u.Username+"@"+ch.ID)
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// ---- Commands, keyboards, interactions (human side) ------------------------------------------------------------ //

// channelBots returns the enabled bots that are active in the channel with their user records.
func (h *Handler) channelBots(ch *models.Channel) []botInChannel {
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		logger.Warnf("api: members of %s unreadable while listing bots: %v", ch.ID, err)
		return nil
	}
	var out []botInChannel
	for _, m := range members {
		u, err := h.Store.GetUser(m.UserID)
		if err != nil || !u.IsBot() {
			continue
		}
		b, err := h.Store.GetBot(u.ID)
		if err != nil || b.Disabled {
			continue
		}
		if _, ok := h.Store.BotChannelScopes(ch.ID, u.ID); !ok {
			continue
		}
		out = append(out, botInChannel{bot: b, user: u})
	}
	return out
}

type botInChannel struct {
	bot  *models.Bot
	user *models.User
}

// ListChannelCommands godoc
//
//	@Summary     List the slash commands usable in a channel
//	@Description The commands of every enabled bot installed in the channel (or the DM): its global commands, with a
//	@Description channel-specific command of the same name taking precedence. Used by the composer's autocomplete.
//	@Description Bounded by the install cap and the 100-command limit per bot and scope, so it is not paged.
//	@Description **Access:** Channel Member.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} CommandsResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/commands [get]
func (h *Handler) ListChannelCommands(w http.ResponseWriter, r *http.Request) {
	ch := ChannelFromContext(r.Context())
	out := CommandsResponse{Items: []CommandResponse{}}
	if h.botSettings().Enabled {
		for _, bc := range h.channelBots(ch) {
			byName := map[string]*models.BotCommand{}
			for _, scope := range []string{store.GlobalScope, ch.ID} {
				cmds, err := h.Store.ListBotCommands(bc.bot.ID, scope)
				if err != nil {
					continue
				}
				for _, c := range cmds {
					byName[c.Name] = c
				}
			}
			for _, c := range byName {
				out.Items = append(out.Items, CommandResponse{BotID: bc.bot.ID, BotUsername: bc.user.Username, Name: c.Name, Description: c.Description, Options: c.Options})
			}
		}
	}
	sortCommands(out.Items)
	writeJSON(w, http.StatusOK, out)
}

// ListChannelKeyboards godoc
//
//	@Summary     List the action menus active in a channel
//	@Description The reply keyboards bots set with `PUT /api/bots/me/channels/{id}/keyboard`. The web client shows the
//	@Description latest one in place of the composer's input area.
//	@Description **Access:** Channel Member.
//	@Tags        bots
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} KeyboardsResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/keyboards [get]
func (h *Handler) ListChannelKeyboards(w http.ResponseWriter, r *http.Request) {
	ch := ChannelFromContext(r.Context())
	out := KeyboardsResponse{Items: []KeyboardResponse{}}
	if h.botSettings().Enabled {
		kbs, err := h.Store.ListChannelKeyboards(ch.ID)
		if err != nil {
			writeInternal(w, "list keyboards of "+ch.ID, err, "apiErrors.bots_load_failed")
			return
		}
		for _, k := range kbs {
			if _, ok := h.Store.BotChannelScopes(ch.ID, k.BotID); !ok {
				continue
			}
			if b, err := h.Store.GetBot(k.BotID); err != nil || b.Disabled {
				continue
			}
			if u, err := h.Store.GetUser(k.BotID); err == nil {
				out.Items = append(out.Items, keyboardView(k, u.Username))
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func keyboardView(k *models.Keyboard, botUsername string) KeyboardResponse {
	return KeyboardResponse{BotID: k.BotID, BotUsername: botUsername, Rows: k.Rows, Placeholder: k.Placeholder, Persistent: k.Persistent, OneTime: k.OneTime}
}

// findBotButton finds the callback button custom_id on a bot's message.
func (h *Handler) findBotButton(ch *models.Channel, botID, messageID, customID string) bool {
	msg, err := h.Store.GetMessage(ch.ID, messageID)
	if err != nil || msg.ChannelID != ch.ID || msg.SenderID != botID || msg.Type != models.MessageTypeBot {
		return false
	}
	plain, ok := bots.Open(h.Store, h.KEK, msg)
	if !ok {
		return false
	}
	var body models.BotMessageBody
	if json.Unmarshal([]byte(plain), &body) != nil {
		return false
	}
	for _, row := range body.Buttons {
		for _, b := range row {
			if b.CustomID == customID && !b.Disabled {
				return true
			}
		}
	}
	return false
}

// CreateInteraction godoc
//
//	@Summary     Use a slash command, a bot message button or an action-menu key
//	@Description Creates an interaction for the bot and hands it to the bot's gateway or webhook; the bot answers with
//	@Description `POST /api/interactions/{id}/{token}/callback`. `type: command` is validated against the registered
//	@Description command (types, required options, choices); `button` must name a callback button that exists on that
//	@Description bot message; `keyboard` must name a key of the bot's active keyboard. Using a bot counts as contact, which
//	@Description lets the bot message the user afterwards. `delivered` is false when the bot is offline and has no webhook.
//	@Description **Access:** Channel Member.
//	@Tags        bots
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string             true "Channel ID"
//	@Param       body body InteractionRequest true "Interaction"
//	@Success     202 {object} InteractionResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/channels/{id}/interactions [post]
func (h *Handler) CreateInteraction(w http.ResponseWriter, r *http.Request) {
	if !h.botsEnabled(w) {
		return
	}
	session := auth.SessionFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	if !h.limiterFor("ia:"+session.UserID, 5, 10).Allow() {
		tooManyRequests(w)
		return
	}
	var body InteractionRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	b, err := h.Store.GetBot(body.BotID)
	if err != nil || b.Disabled {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return
	}
	if _, ok := h.Store.BotChannelScopes(ch.ID, b.ID); !ok {
		writeError(w, http.StatusNotFound, "apiErrors.bot_not_found")
		return
	}
	bad := func(msg string) { writeErrorCode(w, http.StatusBadRequest, apistd.CodeCommandInvalid, msg) }

	var data any
	messageID := ""
	switch body.Type {
	case models.InteractionCommand:
		cmd, err := h.Store.FindBotCommand(b.ID, ch.ID, body.Command)
		if err != nil {
			bad("apiErrors.command_unknown")
			return
		}
		opts, verr := bots.ValidateInvocation(cmd, body.Options)
		if verr != nil {
			bad("apiErrors.command_options_invalid: " + bots.Reason(verr))
			return
		}
		data = map[string]any{"name": cmd.Name, "options": opts}
	case models.InteractionButton:
		if body.CustomID == "" || body.MessageID == "" || !h.findBotButton(ch, b.ID, body.MessageID, body.CustomID) {
			bad("apiErrors.button_unknown")
			return
		}
		messageID = body.MessageID
		data = map[string]any{"custom_id": body.CustomID}
	case models.InteractionKeyboard:
		kb, err := h.Store.GetKeyboard(ch.ID, b.ID)
		found := false
		if err == nil {
			for _, row := range kb.Rows {
				for _, btn := range row {
					if btn.CustomID == body.CustomID && !btn.Disabled {
						found = true
					}
				}
			}
		}
		if !found {
			bad("apiErrors.button_unknown")
			return
		}
		data = map[string]any{"custom_id": body.CustomID}
	default:
		bad("apiErrors.interaction_type_unknown")
		return
	}
	raw, _ := json.Marshal(data)
	in := &models.Interaction{Type: body.Type, BotID: b.ID, ChannelID: ch.ID, UserID: session.UserID, MessageID: messageID, Data: raw}
	token, err := h.Store.CreateInteraction(in)
	if err != nil {
		writeInternal(w, "create interaction", err, "apiErrors.interaction_failed")
		return
	}
	if err := h.Store.RecordBotContact(b.ID, session.UserID); err != nil {
		logger.Warnf("api: could not record contact of bot %s with %s: %v", b.ID, session.UserID, err)
	}
	user, _ := h.Store.GetUser(session.UserID)
	delivered := false
	if h.Bots != nil && user != nil {
		delivered = h.Bots.Deliver(b.ID, bots.EventInteractionCreate, bots.InteractionEvent{
			ID: in.ID, Token: token, Type: in.Type, ChannelID: ch.ID, MessageID: messageID,
			User: bots.Author{ID: user.ID, Username: user.Username}, Data: raw, ExpiresAt: in.ExpiresAt,
		})
	}
	writeJSON(w, http.StatusAccepted, InteractionResponse{ID: in.ID, Delivered: delivered})
}

// isBotUser reports whether the account exists and is a bot.
func (h *Handler) isBotUser(id string) bool {
	u, err := h.Store.GetUser(id)
	return err == nil && u.IsBot()
}

// botSearchable reports whether a bot may appear in user search for viewer: public and enabled bots, and the
// viewer's own.
func (h *Handler) botSearchable(u *models.User, viewerID string) bool {
	b, err := h.Store.GetBot(u.ID)
	if err != nil {
		return false
	}
	return b.OwnerID == viewerID || (b.Public && !b.Disabled)
}

// checkBotMembers applies the bot rules to the member list of a new channel: a bot may only be one side of a DM the
// user opens (which counts as contact); it can never be put in a group at creation, where no scopes are granted.
// It writes the refusal itself and returns false when the list is not acceptable.
func (h *Handler) checkBotMembers(w http.ResponseWriter, creatorID string, memberIDs []string, isDM bool) bool {
	for _, id := range memberIDs {
		if id == creatorID {
			continue
		}
		u, err := h.Store.GetUser(id)
		if err != nil || !u.IsBot() {
			continue
		}
		b, berr := h.Store.GetBot(id)
		if !isDM || berr != nil || b.Disabled || !h.botSettings().Enabled || (!b.Public && b.OwnerID != creatorID && !h.isAdminUser(creatorID)) {
			writeErrorCode(w, http.StatusForbidden, apistd.CodeBotInstallRequired, "apiErrors.bot_install_required")
			return false
		}
		if err := h.Store.RecordBotContact(id, creatorID); err != nil {
			logger.Warnf("api: could not record contact of bot %s with %s: %v", id, creatorID, err)
		}
	}
	return true
}

func (h *Handler) isAdminUser(id string) bool {
	u, err := h.Store.GetUser(id)
	return err == nil && models.IsServerAdmin(u.ServerRole)
}

// deleteOwnedBots removes every bot an account owns (its owner is being deleted), closing their connections and
// telling the channels they were in. Failures are logged and do not stop the account deletion.
func (h *Handler) deleteOwnedBots(ownerID string) {
	owned, err := h.Store.ListBotsByOwner(ownerID)
	if err != nil {
		logger.Warnf("api: could not list bots of deleted account %s: %v", ownerID, err)
		return
	}
	for _, b := range owned {
		if h.Bots != nil {
			h.Bots.DisconnectBot(b.ID)
		}
		channels, err := h.Store.DeleteBot(b.ID)
		if err != nil {
			logger.Warnf("api: could not delete bot %s of deleted account %s: %v", b.ID, ownerID, err)
			continue
		}
		if h.Hub != nil {
			for _, ch := range channels {
				h.Hub.BroadcastMemberLeft(ch, b.ID)
			}
		}
	}
}
