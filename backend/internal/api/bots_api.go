package api

import (
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/bots"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

func sortCommands(items []CommandResponse) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].BotUsername != items[j].BotUsername {
			return items[i].BotUsername < items[j].BotUsername
		}
		return items[i].Name < items[j].Name
	})
}

// botFail is a refusal of a bot request with its status, stable code and message.
type botFail struct {
	status int
	code   string
	msg    string
}

func (f *botFail) write(w http.ResponseWriter) { writeErrorCode(w, f.status, f.code, f.msg) }

// botMessagePerChannelRPS bounds how fast one bot may post into one channel.
const botMessagePerChannelRPS = 5

// sealBotMessage validates the content and returns the message type and the plaintext to encrypt.
func sealBotMessage(text string, buttons [][]models.Button) (models.MessageType, []byte, [][]models.Button, *botFail) {
	rows, err := bots.ValidateMessage(text, buttons)
	if err != nil {
		return "", nil, nil, &botFail{http.StatusBadRequest, apistd.CodeValidationFailed, bots.Reason(err)}
	}
	if len(rows) == 0 {
		return models.MessageTypeText, []byte(text), nil, nil
	}
	body := botBodyJSON(text, rows)
	if len(body) > bots.MaxRichBodyBytes {
		return "", nil, nil, &botFail{http.StatusRequestEntityTooLarge, apistd.CodePayloadTooLarge, "message is too large"}
	}
	return models.MessageTypeBot, body, rows, nil
}

// canBotSpeakIn applies the DM rules: in a DM the bot may only write to a user who interacted with it and who has not
// blocked it or closed DMs.
func (h *Handler) canBotSpeakIn(ch *models.Channel, bot *models.User) *botFail {
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil || !ch.IsDM(len(members)) {
		return nil
	}
	for _, m := range members {
		if m.UserID == bot.ID {
			continue
		}
		if !h.Store.HasBotContact(bot.ID, m.UserID) {
			return &botFail{http.StatusForbidden, apistd.CodeBotContactRequired, "apiErrors.bot_contact_required"}
		}
		if ok, _ := h.Store.CanSendDM(bot.ID, m.UserID); !ok {
			return &botFail{http.StatusForbidden, apistd.CodeForbidden, "apiErrors.dm_not_allowed"}
		}
	}
	return nil
}

// sendBotMessage encrypts and stores a message from the bot, broadcasts it to the channel's members and tells the
// other bots. Callers have already checked access and scope.
func (h *Handler) sendBotMessage(ch *models.Channel, bot *models.User, text string, buttons [][]models.Button, replyTo string) (*models.Message, *botFail) {
	typ, plain, _, fail := sealBotMessage(text, buttons)
	if fail != nil {
		return nil, fail
	}
	if fail := h.canBotSpeakIn(ch, bot); fail != nil {
		return nil, fail
	}
	if replyTo != "" {
		if m, err := h.Store.GetMessage(ch.ID, replyTo); err != nil || m.ChannelID != ch.ID {
			return nil, &botFail{http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.reply_not_found"}
		}
	}
	nonce, ct, err := bots.Seal(h.Store, h.KEK, ch.ID, plain)
	if err != nil {
		logger.Errorf("api: seal bot message in %s: %v", ch.ID, err)
		return nil, &botFail{http.StatusInternalServerError, apistd.CodeInternal, "apiErrors.message_send_failed"}
	}
	msg := &models.Message{
		ID: store.NewMessageID(), ChannelID: ch.ID, SenderID: bot.ID, Type: typ,
		Ciphertext: ct, Nonce: nonce, Compression: "none", ReplyToID: replyTo, SentAt: time.Now().UTC(),
	}
	if err := h.Store.SaveMessage(msg); err != nil {
		logger.Errorf("api: save bot message in %s: %v", ch.ID, err)
		return nil, &botFail{http.StatusInternalServerError, apistd.CodeInternal, "apiErrors.message_send_failed"}
	}
	if h.Hub != nil {
		h.Hub.PublishMessage("message", msg)
	}
	if h.Bots != nil {
		h.Bots.EmitMessage(bots.EventMessageCreate, msg)
	}
	return msg, nil
}

// editBotMessage replaces the content of one of the bot's own messages (the type follows the content: buttons make
// it a `bot` message, none a plain text one).
func (h *Handler) editBotMessage(ch *models.Channel, bot *models.User, messageID, text string, buttons [][]models.Button) (*models.Message, *botFail) {
	msg, err := h.Store.GetMessage(ch.ID, messageID)
	if err != nil || msg.ChannelID != ch.ID {
		return nil, &botFail{http.StatusNotFound, apistd.CodeNotFound, "apiErrors.message_not_found"}
	}
	if msg.SenderID != bot.ID {
		return nil, &botFail{http.StatusForbidden, apistd.CodeForbidden, "apiErrors.cannot_edit_others_message"}
	}
	typ, plain, _, fail := sealBotMessage(text, buttons)
	if fail != nil {
		return nil, fail
	}
	nonce, ct, err := bots.Seal(h.Store, h.KEK, ch.ID, plain)
	if err != nil {
		logger.Errorf("api: seal bot edit in %s: %v", ch.ID, err)
		return nil, &botFail{http.StatusInternalServerError, apistd.CodeInternal, "apiErrors.message_send_failed"}
	}
	now := time.Now().UTC()
	msg.Type, msg.Ciphertext, msg.Nonce, msg.Compression, msg.EditedAt = typ, ct, nonce, "none", &now
	if err := h.Store.UpdateMessage(msg); err != nil {
		logger.Errorf("api: update bot message in %s: %v", ch.ID, err)
		return nil, &botFail{http.StatusInternalServerError, apistd.CodeInternal, "apiErrors.message_send_failed"}
	}
	if h.Hub != nil {
		h.Hub.PublishMessage("message_update", msg)
	}
	if h.Bots != nil {
		h.Bots.EmitMessage(bots.EventMessageUpdate, msg)
	}
	return msg, nil
}

// GetBotMe godoc
//
//	@Summary     The bot's own profile
//	@Description **Access:** Bot (`Authorization: Bot <token>`).
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Success     200 {object} BotResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/bots/me [get]
func (h *Handler) GetBotMe(w http.ResponseWriter, r *http.Request) {
	b, u := BotFromContext(r.Context())
	writeJSON(w, http.StatusOK, h.botView(b, u, true))
}

// ListBotChannels godoc
//
//	@Summary     Channels the bot is in
//	@Description Paged, ordered by channel id: the group channels it is installed in and the DMs opened with it.
//	@Description **Access:** Bot.
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor"
//	@Success     200 {object} BotChannelPageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels [get]
func (h *Handler) ListBotChannels(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	limit, cursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	channels, err := h.Store.ListUserChannels(u.ID)
	if err != nil {
		writeInternal(w, "list channels of bot "+u.ID, err, "apiErrors.channels_load_failed")
		return
	}
	sort.Slice(channels, func(i, j int) bool { return channels[i].ID < channels[j].ID })
	items := make([]BotChannelResponse, 0, len(channels))
	for _, ch := range channels {
		scopes, ok := h.Store.BotChannelScopes(ch.ID, u.ID)
		if !ok {
			continue
		}
		members, _ := h.Store.GetChannelMembers(ch.ID)
		items = append(items, BotChannelResponse{ID: ch.ID, Name: ch.Name, IsDM: ch.IsDM(len(members)), Scopes: scopes})
	}
	writePage(w, items, cursor, limit, func(page []BotChannelResponse, next string) BotChannelPageResponse {
		return BotChannelPageResponse{Items: page, NextCursor: next}
	})
}

func commandsOf(b *models.Bot, in []models.BotCommand) []*models.BotCommand {
	out := make([]*models.BotCommand, len(in))
	for i := range in {
		c := in[i]
		c.BotID = b.ID
		out[i] = &c
	}
	return out
}

func (h *Handler) setCommands(w http.ResponseWriter, r *http.Request, scope string) {
	b, _ := BotFromContext(r.Context())
	var body SetCommandsRequest
	if !decodeJSONLimit(w, r, &body, 512<<10, "apiErrors.invalid_json") {
		return
	}
	cmds := commandsOf(b, body.Commands)
	if err := bots.ValidateCommands(cmds); err != nil {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeCommandInvalid, bots.Reason(err))
		return
	}
	if err := h.Store.ReplaceBotCommands(b.ID, scope, cmds); err != nil {
		writeInternal(w, "set commands of "+b.ID, err, "apiErrors.command_save_failed")
		return
	}
	h.writeCommands(w, b.ID, scope)
}

func (h *Handler) writeCommands(w http.ResponseWriter, botID, scope string) {
	cmds, err := h.Store.ListBotCommands(botID, scope)
	if err != nil {
		writeInternal(w, "list commands of "+botID, err, "apiErrors.command_save_failed")
		return
	}
	out := BotCommandsResponse{Items: make([]models.BotCommand, 0, len(cmds))}
	for _, c := range cmds {
		out.Items = append(out.Items, *c)
	}
	writeJSON(w, http.StatusOK, out)
}

// SetGlobalCommands godoc
//
//	@Summary     Register the bot's global slash commands
//	@Description Replaces the whole set. Global commands are usable in every channel the bot is installed in. Names are
//	@Description 1-32 characters of a-z 0-9 _ -; at most 100 commands, 25 options each, 25 choices per option.
//	@Description **Access:** Bot.
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       body body SetCommandsRequest true "Commands"
//	@Success     200 {object} BotCommandsResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/commands [put]
func (h *Handler) SetGlobalCommands(w http.ResponseWriter, r *http.Request) {
	h.setCommands(w, r, store.GlobalScope)
}

// ListGlobalCommands godoc
//
//	@Summary     List the bot's global slash commands
//	@Description **Access:** Bot.
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Success     200 {object} BotCommandsResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/commands [get]
func (h *Handler) ListGlobalCommands(w http.ResponseWriter, r *http.Request) {
	b, _ := BotFromContext(r.Context())
	h.writeCommands(w, b.ID, store.GlobalScope)
}

// DeleteGlobalCommand godoc
//
//	@Summary     Delete one global slash command
//	@Description **Access:** Bot.
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Param       name path string true "Command name"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/commands/{name} [delete]
func (h *Handler) DeleteGlobalCommand(w http.ResponseWriter, r *http.Request) {
	b, _ := BotFromContext(r.Context())
	if err := h.Store.DeleteBotCommand(b.ID, store.GlobalScope, r.PathValue("name")); err != nil {
		writeInternal(w, "delete command of "+b.ID, err, "apiErrors.command_save_failed")
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// SetChannelCommands godoc
//
//	@Summary     Register slash commands for one channel
//	@Description Replaces the bot's commands scoped to this channel; a channel command wins over a global one of the same name.
//	@Description **Access:** Bot (installed in the channel, or the DM).
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       id   path string             true "Channel ID"
//	@Param       body body SetCommandsRequest true "Commands"
//	@Success     200 {object} BotCommandsResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/commands [put]
func (h *Handler) SetChannelCommands(w http.ResponseWriter, r *http.Request) {
	h.setCommands(w, r, ChannelFromContext(r.Context()).ID)
}

// PostBotMessage godoc
//
//	@Summary     Send a message
//	@Description Posts text (up to 4000 characters) and optionally up to 5x5 buttons. With buttons the message type is
//	@Description `bot`. The server encrypts it with the channel key; the bot never handles keys. In a DM the bot may only
//	@Description write to a user who interacted with it. At most 5 messages per second per channel.
//	@Description **Access:** Bot with the `messages.send` scope in the channel.
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       id   path string            true "Channel ID"
//	@Param       body body BotMessageRequest true "Message"
//	@Success     201 {object} BotMessageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/messages [post]
func (h *Handler) PostBotMessage(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	var body BotMessageRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	// Invalid requests are refused before they use up the posting budget.
	if _, _, _, fail := sealBotMessage(body.Text, body.Buttons); fail != nil {
		fail.write(w)
		return
	}
	if !h.limiterFor("botmsg:"+u.ID+":"+ch.ID, botMessagePerChannelRPS, botMessagePerChannelRPS).Allow() {
		tooManyRequests(w)
		return
	}
	msg, fail := h.sendBotMessage(ch, u, body.Text, body.Buttons, body.ReplyToID)
	if fail != nil {
		fail.write(w)
		return
	}
	writeJSON(w, http.StatusCreated, BotMessageResponse{ID: msg.ID, ChannelID: ch.ID, SentAt: msg.SentAt})
}

// EditBotMessage godoc
//
//	@Summary     Edit one of the bot's own messages
//	@Description Replaces text and buttons; sending no buttons turns a `bot` message back into plain text.
//	@Description **Access:** Bot with the `messages.send` scope; only its own messages (403 otherwise).
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       id   path string            true "Channel ID"
//	@Param       mid  path string            true "Message ID"
//	@Param       body body BotMessageRequest true "New content"
//	@Success     200 {object} BotMessageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/messages/{mid} [patch]
func (h *Handler) EditBotMessage(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	var body BotMessageRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	msg, fail := h.editBotMessage(ch, u, r.PathValue("mid"), body.Text, body.Buttons)
	if fail != nil {
		fail.write(w)
		return
	}
	writeJSON(w, http.StatusOK, BotMessageResponse{ID: msg.ID, ChannelID: ch.ID, SentAt: msg.SentAt})
}

// DeleteBotMessage godoc
//
//	@Summary     Delete one of the bot's own messages
//	@Description **Access:** Bot with the `messages.send` scope; only its own messages (403 otherwise).
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Param       id  path string true "Channel ID"
//	@Param       mid path string true "Message ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/messages/{mid} [delete]
func (h *Handler) DeleteBotMessage(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	msg, err := h.Store.GetMessage(ch.ID, r.PathValue("mid"))
	if err != nil || msg.ChannelID != ch.ID {
		writeError(w, http.StatusNotFound, "apiErrors.message_not_found")
		return
	}
	if msg.SenderID != u.ID {
		writeError(w, http.StatusForbidden, "apiErrors.cannot_delete_others_message")
		return
	}
	if err := h.Store.DeleteMessage(ch.ID, msg.ID); err != nil {
		writeInternal(w, "delete bot message "+msg.ID, err, "apiErrors.message_delete_failed")
		return
	}
	if h.Hub != nil {
		h.Hub.PublishChannelEvent(ch.ID, "message_delete", map[string]string{"channel_id": ch.ID, "message_id": msg.ID})
	}
	if h.Bots != nil {
		h.Bots.EmitMessageDelete(ch.ID, msg.ID, u.ID)
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// ListBotMessages godoc
//
//	@Summary     Channel history for a bot
//	@Description Paged (`{items, next_cursor}`), newest first, with plaintext. Only for bots that were granted
//	@Description `messages.read`.
//	@Description **Access:** Bot with the `messages.read` scope in the channel.
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Param       id     path  string true  "Channel ID"
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor"
//	@Success     200 {object} BotMessagePageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/messages [get]
func (h *Handler) ListBotMessages(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	limit, rawCursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	before, err := apistd.DecodeCursor(msgCursorKind, rawCursor)
	if err != nil {
		writeBadCursor(w, err)
		return
	}
	msgs, err := h.Store.ListMessages(ch.ID, before, limit+1)
	if err != nil {
		writeInternal(w, "list messages of "+ch.ID, err, "apiErrors.messages_load_failed")
		return
	}
	hasMore := len(msgs) > limit
	if hasMore {
		msgs = msgs[:limit]
	}
	out := BotMessagePageResponse{Items: make([]bots.MessageDTO, 0, len(msgs))}
	for _, m := range msgs {
		out.Items = append(out.Items, bots.BuildMessageDTO(h.Store, h.KEK, m, u))
	}
	if hasMore && len(msgs) > 0 {
		out.NextCursor = apistd.EncodeCursor(msgCursorKind, msgs[len(msgs)-1].ID)
	}
	writeJSON(w, http.StatusOK, out)
}

// ListBotMembers godoc
//
//	@Summary     Channel members for a bot
//	@Description Paged, ordered by user id. Only id, username and `is_bot`: no roles, avatars or status.
//	@Description **Access:** Bot with the `members.read` scope in the channel.
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Param       id     path  string true  "Channel ID"
//	@Param       limit  query int    false "Page size (1-100, default 50)"
//	@Param       cursor query string false "Opaque cursor"
//	@Success     200 {object} BotMemberPageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/members [get]
func (h *Handler) ListBotMembers(w http.ResponseWriter, r *http.Request) {
	ch := ChannelFromContext(r.Context())
	limit, cursor, ok := pageParams(w, r)
	if !ok {
		return
	}
	members, err := h.Store.GetChannelMembers(ch.ID)
	if err != nil {
		writeInternal(w, "members of "+ch.ID, err, "apiErrors.members_load_failed")
		return
	}
	sort.Slice(members, func(i, j int) bool { return members[i].UserID < members[j].UserID })
	items := make([]BotMemberResponse, 0, len(members))
	for _, m := range members {
		if u, err := h.Store.GetUser(m.UserID); err == nil {
			items = append(items, BotMemberResponse{ID: u.ID, Username: u.Username, IsBot: u.IsBot()})
		}
	}
	writePage(w, items, cursor, limit, func(page []BotMemberResponse, next string) BotMemberPageResponse {
		return BotMemberPageResponse{Items: page, NextCursor: next}
	})
}

// SetKeyboard godoc
//
//	@Summary     Show an action menu in a channel
//	@Description Replaces the composer's input area with a grid of buttons (at most 8x8, callback buttons only) for every
//	@Description member until the bot removes it or a member dismisses it. `one_time` hides it after the first press,
//	@Description `persistent` keeps its toggle available. Presses arrive as `keyboard` interactions.
//	@Description **Access:** Bot with the `messages.send` scope in the channel.
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       id   path string          true "Channel ID"
//	@Param       body body KeyboardRequest true "Keyboard"
//	@Success     200 {object} KeyboardResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/keyboard [put]
func (h *Handler) SetKeyboard(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	var body KeyboardRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	if fail := h.canBotSpeakIn(ch, u); fail != nil {
		fail.write(w)
		return
	}
	k := &models.Keyboard{ChannelID: ch.ID, BotID: u.ID, Rows: body.Rows, Placeholder: body.Placeholder, Persistent: body.Persistent, OneTime: body.OneTime}
	if err := bots.ValidateKeyboard(k); err != nil {
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, bots.Reason(err))
		return
	}
	if err := h.Store.SetKeyboard(k); err != nil {
		writeInternal(w, "set keyboard "+ch.ID, err, "apiErrors.keyboard_save_failed")
		return
	}
	view := keyboardView(k, u.Username)
	if h.Hub != nil {
		h.Hub.PublishChannelEvent(ch.ID, "keyboard_update", map[string]any{"channel_id": ch.ID, "bot_id": u.ID, "keyboard": view})
	}
	writeJSON(w, http.StatusOK, view)
}

// DeleteKeyboard godoc
//
//	@Summary     Remove the bot's action menu from a channel
//	@Description **Access:** Bot with the `messages.send` scope in the channel.
//	@Tags        bot-api
//	@Produce     json
//	@Security    BotAuth
//	@Param       id path string true "Channel ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/channels/{id}/keyboard [delete]
func (h *Handler) DeleteKeyboard(w http.ResponseWriter, r *http.Request) {
	_, u := BotFromContext(r.Context())
	ch := ChannelFromContext(r.Context())
	if err := h.Store.DeleteKeyboard(ch.ID, u.ID); err != nil {
		writeInternal(w, "delete keyboard "+ch.ID, err, "apiErrors.keyboard_save_failed")
		return
	}
	if h.Hub != nil {
		h.Hub.PublishChannelEvent(ch.ID, "keyboard_update", map[string]any{"channel_id": ch.ID, "bot_id": u.ID, "keyboard": nil})
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// OpenBotDM godoc
//
//	@Summary     Open a DM with a user
//	@Description Only for a user who interacted with the bot first (opened a DM with it, used a command or pressed a
//	@Description button); otherwise 403 `bot_contact_required`. Also 403 when the user blocked the bot or disallows DMs.
//	@Description **Access:** Bot.
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       body body BotDMRequest true "User"
//	@Success     200 {object} BotDMResponse
//	@Success     201 {object} BotDMResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/bots/me/dm [post]
func (h *Handler) OpenBotDM(w http.ResponseWriter, r *http.Request) {
	_, bot := BotFromContext(r.Context())
	var body BotDMRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	target, err := h.Store.GetUser(body.UserID)
	if err != nil || target.IsBot() || target.IsSystem {
		writeError(w, http.StatusNotFound, "apiErrors.user_not_found")
		return
	}
	if !h.Store.HasBotContact(bot.ID, target.ID) {
		writeErrorCode(w, http.StatusForbidden, apistd.CodeBotContactRequired, "apiErrors.bot_contact_required")
		return
	}
	if ok, _ := h.Store.CanSendDM(bot.ID, target.ID); !ok {
		writeError(w, http.StatusForbidden, "apiErrors.dm_not_allowed")
		return
	}
	if existing := h.findDM(bot.ID, target.ID); existing != nil {
		writeJSON(w, http.StatusOK, BotDMResponse{ChannelID: existing.ID})
		return
	}
	ch, err := h.Store.CreateChannel("", bot.ID, true, []string{bot.ID, target.ID}, h.KEK)
	if err != nil {
		writeInternal(w, "create bot DM", err, "apiErrors.channel_create_failed")
		return
	}
	for _, uid := range []string{bot.ID, target.ID} {
		if err := h.Store.AddMemberToChannel(ch.ID, uid, models.RoleMember); err != nil {
			logger.Warnf("api: bot DM %s: could not set member role of %s: %v", ch.ID, uid, err)
		}
	}
	if h.Hub != nil {
		h.Hub.BroadcastChannelCreated(ch)
	}
	writeJSON(w, http.StatusCreated, BotDMResponse{ChannelID: ch.ID})
}

// findDM returns the existing two-person unnamed channel between a and b, if any.
func (h *Handler) findDM(a, b string) *models.Channel {
	chans, err := h.Store.ListUserChannels(a)
	if err != nil {
		return nil
	}
	for _, c := range chans {
		if strings.TrimSpace(c.Name) != "" {
			continue
		}
		members, err := h.Store.GetChannelMembers(c.ID)
		if err != nil || !c.IsDM(len(members)) {
			continue
		}
		for _, m := range members {
			if m.UserID == b {
				return c
			}
		}
	}
	return nil
}

// InteractionCallback godoc
//
//	@Summary     Answer an interaction
//	@Description Answers a command, button press or keyboard key with `message` (a new message), `update_message` (edit
//	@Description the message the button was on) or `ack` (silent acknowledgement; one follow-up `message` may come
//	@Description later). The token comes with the interaction event and is valid for 15 minutes and two answers.
//	@Description A wrong, expired or used-up token is 404 `interaction_expired`.
//	@Description **Access:** Bot (the bot the interaction was addressed to) with the interaction token.
//	@Tags        bot-api
//	@Accept      json
//	@Produce     json
//	@Security    BotAuth
//	@Param       id    path string                      true "Interaction ID"
//	@Param       token path string                      true "Interaction token"
//	@Param       body  body InteractionCallbackRequest  true "Answer"
//	@Success     200 {object} BotMessageResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/interactions/{id}/{token}/callback [post]
func (h *Handler) InteractionCallback(w http.ResponseWriter, r *http.Request) {
	b, u := BotFromContext(r.Context())
	var body InteractionCallbackRequest
	if !decodeJSON(w, r, &body, "apiErrors.invalid_json") {
		return
	}
	switch body.Type {
	case "message", "update_message":
		if _, _, _, fail := sealBotMessage(body.Text, body.Buttons); fail != nil {
			fail.write(w)
			return
		}
	case "ack":
	default:
		writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.interaction_type_unknown")
		return
	}
	in, err := h.Store.UseInteraction(r.PathValue("id"), r.PathValue("token"), b.ID, time.Now())
	if err != nil {
		if errors.Is(err, store.ErrInteractionNotFound) {
			writeErrorCode(w, http.StatusNotFound, apistd.CodeInteractionExpired, "apiErrors.interaction_expired")
			return
		}
		writeInternal(w, "use interaction", err, "apiErrors.interaction_failed")
		return
	}
	ch, err := h.Store.GetChannel(in.ChannelID)
	if err != nil {
		writeError(w, http.StatusNotFound, "apiErrors.channel_not_found")
		return
	}
	scopes, ok := h.Store.BotChannelScopes(ch.ID, u.ID)
	if !ok {
		writeError(w, http.StatusNotFound, "apiErrors.channel_not_found")
		return
	}
	if body.Type == "ack" {
		writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
		return
	}
	if !store.HasScope(scopes, models.ScopeMessagesSend) {
		writeError(w, http.StatusForbidden, "apiErrors.bot_scope_missing")
		return
	}
	var msg *models.Message
	var fail *botFail
	if body.Type == "update_message" {
		if in.MessageID == "" {
			writeErrorCode(w, http.StatusBadRequest, apistd.CodeValidationFailed, "apiErrors.interaction_no_message")
			return
		}
		msg, fail = h.editBotMessage(ch, u, in.MessageID, body.Text, body.Buttons)
	} else {
		msg, fail = h.sendBotMessage(ch, u, body.Text, body.Buttons, "")
	}
	if fail != nil {
		fail.write(w)
		return
	}
	writeJSON(w, http.StatusOK, BotMessageResponse{ID: msg.ID, ChannelID: ch.ID, SentAt: msg.SentAt})
}
