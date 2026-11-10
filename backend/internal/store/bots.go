package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"cove/backend/internal/db"
	"cove/backend/internal/models"
	"github.com/google/uuid"
)

// Errors of the bot store. The handlers map them to API status codes and stable error codes.
var (
	ErrBotNotFound = errors.New("store: bot not found")
	// ErrBotLimit means the owner already has the most bots they may.
	ErrBotLimit = errors.New("store: bot limit reached")
	// ErrInvalidBotToken is returned for a malformed, unknown or wrong token; it never says which.
	ErrInvalidBotToken = errors.New("store: invalid bot token")
	// ErrInteractionNotFound means the interaction does not exist or has expired.
	ErrInteractionNotFound = errors.New("store: interaction not found")
)

// BotTokenPrefix is how a token reads on the wire: `Authorization: Bot <bot_id>.<secret>`.
const botSecretBytes = 32

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func newSecret() (string, error) {
	raw := make([]byte, botSecretBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("store: secret generation failed: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// NewWebhookSecret returns a fresh HMAC secret for a bot's webhook.
func NewWebhookSecret() (string, error) {
	s, err := newSecret()
	if err != nil {
		return "", err
	}
	return "whsec_" + s, nil
}

// CreateBot creates the bot's user account and bot record, indexes it under its owner, and returns the token. The
// token is returned only here and on rotation; only its hash is stored. The per-owner cap is checked in the same
// transaction as the write so two concurrent requests cannot both pass it.
func (s *Store) CreateBot(ownerID, username, description, domain string, maxPerOwner int) (*models.User, *models.Bot, string, error) {
	if existing, _ := s.GetUserByUsername(username); existing != nil {
		return nil, nil, "", ErrUsernameTaken
	}
	secret, err := newSecret()
	if err != nil {
		return nil, nil, "", err
	}
	now := time.Now().UTC()
	id := uuid.New().String()
	u := &models.User{
		ID: id, Username: username, Domain: domain, Status: "online", StatusPreference: "online",
		CreatedAt: now, Kind: models.UserKindBot, OwnerID: ownerID,
	}
	b := &models.Bot{
		ID: id, OwnerID: ownerID, Description: description,
		TokenHash: hashSecret(secret), TokenCreatedAt: now, CreatedAt: now,
	}
	err = s.db.Tx(func(tx *db.Tx) error {
		if maxPerOwner > 0 {
			n := 0
			if err := tx.Scan(db.BotOwnerPrefix(ownerID), func(string, []byte) error { n++; return nil }); err != nil {
				return err
			}
			if n >= maxPerOwner {
				return ErrBotLimit
			}
		}
		if err := tx.Set(db.UserRecordKey(id), u); err != nil {
			return err
		}
		if err := tx.Set(db.BotKey(id), b); err != nil {
			return err
		}
		return tx.Set(db.BotOwnerKey(ownerID, id), struct{}{})
	})
	if err != nil {
		return nil, nil, "", err
	}
	return u, b, id + "." + secret, nil
}

// GetBot loads a bot record.
func (s *Store) GetBot(id string) (*models.Bot, error) {
	var b models.Bot
	if err := s.db.GetKey(db.BotKey(id), &b); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, ErrBotNotFound
		}
		return nil, err
	}
	return &b, nil
}

// SaveBot writes a changed bot record.
func (s *Store) SaveBot(b *models.Bot) error { return s.db.SetKey(db.BotKey(b.ID), b) }

// ListAllBots returns every bot, oldest first.
func (s *Store) ListAllBots() ([]*models.Bot, error) {
	rows, err := s.db.ScanJSON(db.BotPrefix(), func() any { return &models.Bot{} })
	if err != nil {
		return nil, err
	}
	out := make([]*models.Bot, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.(*models.Bot))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}

// ListBotsByOwner returns one owner's bots, oldest first.
func (s *Store) ListBotsByOwner(ownerID string) ([]*models.Bot, error) {
	all, err := s.ListAllBots()
	if err != nil {
		return nil, err
	}
	out := make([]*models.Bot, 0)
	for _, b := range all {
		if b.OwnerID == ownerID {
			out = append(out, b)
		}
	}
	return out, nil
}

// AuthenticateBot resolves `<bot_id>.<secret>` to the bot and its user account. Every failure is the same
// ErrInvalidBotToken, and the secret is compared in constant time. A disabled bot is returned (the caller decides
// how to answer) so it can be told apart from a wrong token only by someone who holds the right one.
func (s *Store) AuthenticateBot(token string) (*models.Bot, *models.User, error) {
	id, secret, ok := strings.Cut(token, ".")
	if !ok || id == "" || secret == "" || len(token) > 256 {
		return nil, nil, ErrInvalidBotToken
	}
	b, err := s.GetBot(id)
	if err != nil {
		// Same hashing cost as a hit, so timing does not reveal which bot ids exist.
		_ = subtle.ConstantTimeCompare([]byte(hashSecret(secret)), []byte(hashSecret("x")))
		return nil, nil, ErrInvalidBotToken
	}
	if subtle.ConstantTimeCompare([]byte(hashSecret(secret)), []byte(b.TokenHash)) != 1 {
		return nil, nil, ErrInvalidBotToken
	}
	u, err := s.GetUser(id)
	if err != nil || !u.IsBot() {
		return nil, nil, ErrInvalidBotToken
	}
	return b, u, nil
}

// RotateBotToken replaces the bot's secret and returns the new token. The old token stops working immediately.
func (s *Store) RotateBotToken(id string) (string, error) {
	b, err := s.GetBot(id)
	if err != nil {
		return "", err
	}
	secret, err := newSecret()
	if err != nil {
		return "", err
	}
	b.TokenHash = hashSecret(secret)
	b.TokenCreatedAt = time.Now().UTC()
	if err := s.SaveBot(b); err != nil {
		return "", err
	}
	return id + "." + secret, nil
}

// DeleteBot removes the bot with its user account, installs (and the memberships they created), commands,
// keyboards and contacts. The channels it was in are returned so callers can tell them it left. Messages it sent
// stay in the history.
func (s *Store) DeleteBot(id string) ([]string, error) {
	b, err := s.GetBot(id)
	if err != nil {
		return nil, err
	}
	installs, _ := s.ListBotInstalls(id)
	var channels []string
	for _, in := range installs {
		channels = append(channels, in.ChannelID)
		if err := s.RemoveBotFromChannel(in.ChannelID, id); err != nil {
			return nil, err
		}
	}
	// DM memberships (no install row): leave them so the DM does not keep a dangling member.
	if memberships, err := s.db.ListActiveMemberships(id); err == nil {
		for _, uc := range memberships {
			_ = s.db.DeleteUserChannel(id, uc.ChannelID)
		}
	}
	err = s.db.Tx(func(tx *db.Tx) error {
		for _, p := range []string{db.BotCommandsOfPrefix(id), db.BotContactPrefix(id)} {
			var keys []string
			if err := tx.Scan(p, func(k string, _ []byte) error { keys = append(keys, k); return nil }); err != nil {
				return err
			}
			for _, k := range keys {
				if err := tx.Delete(k); err != nil {
					return err
				}
			}
		}
		for _, k := range []string{db.BotKey(id), db.BotOwnerKey(b.OwnerID, id), db.UserRecordKey(id)} {
			if err := tx.Delete(k); err != nil {
				return err
			}
		}
		return nil
	})
	return channels, err
}

// ---- Installs ---------------------------------------------------------------------------------------------------- //

// InstallBot makes the bot a member of the channel (always RoleMember) and records the granted scopes. Calling it
// again updates the scopes.
func (s *Store) InstallBot(channelID string, in *models.BotInstall) error {
	if err := s.AddMemberToChannel(channelID, in.BotID, models.RoleMember); err != nil {
		return err
	}
	in.ChannelID = channelID
	if in.InstalledAt.IsZero() {
		in.InstalledAt = time.Now().UTC()
	}
	return s.db.Tx(func(tx *db.Tx) error {
		if err := tx.Set(db.BotInstallKey(channelID, in.BotID), in); err != nil {
			return err
		}
		return tx.Set(db.BotInstalledInKey(in.BotID, channelID), struct{}{})
	})
}

// GetBotInstall returns the install of a bot in a channel, or db.ErrNotFound.
func (s *Store) GetBotInstall(channelID, botID string) (*models.BotInstall, error) {
	var in models.BotInstall
	if err := s.db.GetKey(db.BotInstallKey(channelID, botID), &in); err != nil {
		return nil, err
	}
	return &in, nil
}

// RemoveBotFromChannel uninstalls: the membership, the install, the channel's commands and keyboard of the bot.
func (s *Store) RemoveBotFromChannel(channelID, botID string) error {
	if err := s.RemoveMemberFromChannel(channelID, botID, models.StatusLeft); err != nil && !errors.Is(err, db.ErrNotFound) {
		return err
	}
	return s.db.Tx(func(tx *db.Tx) error {
		var cmdKeys []string
		if err := tx.Scan(db.BotCommandPrefix(botID, channelID), func(k string, _ []byte) error { cmdKeys = append(cmdKeys, k); return nil }); err != nil {
			return err
		}
		for _, k := range append(cmdKeys, db.BotInstallKey(channelID, botID), db.BotInstalledInKey(botID, channelID), db.KeyboardKey(channelID, botID)) {
			if err := tx.Delete(k); err != nil {
				return err
			}
		}
		return nil
	})
}

// ListChannelInstalls returns the bots installed in a channel.
func (s *Store) ListChannelInstalls(channelID string) ([]*models.BotInstall, error) {
	rows, err := s.db.ScanJSON(db.BotInstallPrefix(channelID), func() any { return &models.BotInstall{} })
	if err != nil {
		return nil, err
	}
	out := make([]*models.BotInstall, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.(*models.BotInstall))
	}
	return out, nil
}

// ListBotInstalls returns the channels a bot is installed in.
func (s *Store) ListBotInstalls(botID string) ([]*models.BotInstall, error) {
	var ids []string
	err := s.db.View(func(tx *db.Tx) error {
		return tx.Scan(db.BotInstalledInPrefix(botID), func(k string, _ []byte) error {
			ids = append(ids, strings.TrimPrefix(k, db.BotInstalledInPrefix(botID)))
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	out := make([]*models.BotInstall, 0, len(ids))
	for _, ch := range ids {
		if in, err := s.GetBotInstall(ch, botID); err == nil {
			out = append(out, in)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ChannelID < out[j].ChannelID })
	return out, nil
}

// ---- Contacts ---------------------------------------------------------------------------------------------------- //

// RecordBotContact notes that the user interacted with the bot.
func (s *Store) RecordBotContact(botID, userID string) error {
	var c models.BotContact
	if err := s.db.GetKey(db.BotContactKey(botID, userID), &c); err == nil {
		return nil
	}
	return s.db.SetKey(db.BotContactKey(botID, userID), &models.BotContact{BotID: botID, UserID: userID, At: time.Now().UTC()})
}

// HasBotContact reports whether the user ever interacted with the bot.
func (s *Store) HasBotContact(botID, userID string) bool {
	var c models.BotContact
	return s.db.GetKey(db.BotContactKey(botID, userID), &c) == nil
}

// ---- Commands ---------------------------------------------------------------------------------------------------- //

// GlobalScope is the command scope of commands that apply in every channel the bot is installed in.
const GlobalScope = "global"

// ReplaceBotCommands replaces all of a bot's commands in one scope (GlobalScope or a channel id) atomically.
func (s *Store) ReplaceBotCommands(botID, scope string, cmds []*models.BotCommand) error {
	now := time.Now().UTC()
	return s.db.Tx(func(tx *db.Tx) error {
		var old []string
		if err := tx.Scan(db.BotCommandPrefix(botID, scope), func(k string, _ []byte) error { old = append(old, k); return nil }); err != nil {
			return err
		}
		for _, k := range old {
			if err := tx.Delete(k); err != nil {
				return err
			}
		}
		for _, c := range cmds {
			c.BotID, c.UpdatedAt = botID, now
			c.ChannelID = ""
			if scope != GlobalScope {
				c.ChannelID = scope
			}
			if err := tx.Set(db.BotCommandKey(botID, scope, c.Name), c); err != nil {
				return err
			}
		}
		return nil
	})
}

// ListBotCommands returns a bot's commands in one scope, sorted by name.
func (s *Store) ListBotCommands(botID, scope string) ([]*models.BotCommand, error) {
	rows, err := s.db.ScanJSON(db.BotCommandPrefix(botID, scope), func() any { return &models.BotCommand{} })
	if err != nil {
		return nil, err
	}
	out := make([]*models.BotCommand, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.(*models.BotCommand))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// DeleteBotCommand removes one command; a missing one is not an error.
func (s *Store) DeleteBotCommand(botID, scope, name string) error {
	return s.db.DeleteKey(db.BotCommandKey(botID, scope, name))
}

// FindBotCommand resolves a command for use in a channel: a channel-scoped command wins over a global one.
func (s *Store) FindBotCommand(botID, channelID, name string) (*models.BotCommand, error) {
	for _, scope := range []string{channelID, GlobalScope} {
		var c models.BotCommand
		if err := s.db.GetKey(db.BotCommandKey(botID, scope, name), &c); err == nil {
			return &c, nil
		} else if !errors.Is(err, db.ErrNotFound) {
			return nil, err
		}
	}
	return nil, db.ErrNotFound
}

// ---- Keyboards --------------------------------------------------------------------------------------------------- //

// SetKeyboard stores the action menu of a bot in a channel.
func (s *Store) SetKeyboard(k *models.Keyboard) error {
	k.UpdatedAt = time.Now().UTC()
	return s.db.SetKey(db.KeyboardKey(k.ChannelID, k.BotID), k)
}

// GetKeyboard returns the keyboard of a bot in a channel, or db.ErrNotFound.
func (s *Store) GetKeyboard(channelID, botID string) (*models.Keyboard, error) {
	var k models.Keyboard
	if err := s.db.GetKey(db.KeyboardKey(channelID, botID), &k); err != nil {
		return nil, err
	}
	return &k, nil
}

// DeleteKeyboard removes the keyboard; a missing one is not an error.
func (s *Store) DeleteKeyboard(channelID, botID string) error {
	return s.db.DeleteKey(db.KeyboardKey(channelID, botID))
}

// ListChannelKeyboards returns every keyboard active in a channel.
func (s *Store) ListChannelKeyboards(channelID string) ([]*models.Keyboard, error) {
	rows, err := s.db.ScanJSON(db.KeyboardPrefix(channelID), func() any { return &models.Keyboard{} })
	if err != nil {
		return nil, err
	}
	out := make([]*models.Keyboard, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.(*models.Keyboard))
	}
	return out, nil
}

// ---- Interactions ------------------------------------------------------------------------------------------------ //

// InteractionTTL is how long a bot may answer an interaction.
const InteractionTTL = 15 * time.Minute

// MaxInteractionResponses is the number of answers one interaction accepts (an ack and one follow-up message).
const MaxInteractionResponses = 2

// CreateInteraction stores a new interaction and returns it with the plaintext token the bot answers with.
func (s *Store) CreateInteraction(in *models.Interaction) (token string, err error) {
	token, err = newSecret()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	in.ID, in.TokenHash = uuid.New().String(), hashSecret(token)
	in.CreatedAt, in.ExpiresAt = now, now.Add(InteractionTTL)
	if err := s.db.SetKey(db.InteractionKey(in.ID), in); err != nil {
		return "", err
	}
	return token, nil
}

// UseInteraction verifies the token and the bot, counts one response and returns the interaction. It fails with
// ErrInteractionNotFound for an unknown id, a wrong token, another bot's interaction, an expired one or one that
// already took its allowed answers; the reason is never distinguished.
func (s *Store) UseInteraction(id, token, botID string, now time.Time) (*models.Interaction, error) {
	var out *models.Interaction
	err := s.db.Tx(func(tx *db.Tx) error {
		var in models.Interaction
		if err := tx.Get(db.InteractionKey(id), &in); err != nil {
			return ErrInteractionNotFound
		}
		if in.BotID != botID || now.After(in.ExpiresAt) || in.Responses >= MaxInteractionResponses ||
			subtle.ConstantTimeCompare([]byte(hashSecret(token)), []byte(in.TokenHash)) != 1 {
			return ErrInteractionNotFound
		}
		in.Responses++
		out = &in
		return tx.Set(db.InteractionKey(id), &in)
	})
	return out, err
}

// PurgeExpiredInteractions deletes interactions past their expiry and returns how many were removed.
func (s *Store) PurgeExpiredInteractions(now time.Time) (int, error) {
	rows, err := s.db.ScanJSON(db.InteractionPrefix(), func() any { return &models.Interaction{} })
	if err != nil {
		return 0, err
	}
	n := 0
	for _, r := range rows {
		in := r.(*models.Interaction)
		if now.After(in.ExpiresAt) {
			if err := s.db.DeleteKey(db.InteractionKey(in.ID)); err == nil {
				n++
			}
		}
	}
	return n, nil
}

// ---- Access ------------------------------------------------------------------------------------------------------ //

// BotChannelScopes reports what a bot may do in a channel. A group channel needs an install (its scopes apply); a DM
// the bot was opened in grants the conversation scopes implicitly. ok is false when the bot is not an active member
// or has no install, which callers answer like an unknown channel so existence is not leaked.
func (s *Store) BotChannelScopes(channelID, botID string) (scopes []string, ok bool) {
	uc, err := s.GetUserChannel(botID, channelID)
	if err != nil || uc.Status != models.StatusActive {
		return nil, false
	}
	if in, err := s.GetBotInstall(channelID, botID); err == nil {
		return in.Scopes, true
	}
	ch, err := s.GetChannel(channelID)
	if err != nil {
		return nil, false
	}
	members, err := s.GetChannelMembers(channelID)
	if err != nil || !ch.IsDM(len(members)) {
		return nil, false
	}
	return []string{models.ScopeMessagesRead, models.ScopeMessagesSend}, true
}

// HasScope reports whether scopes contains want.
func HasScope(scopes []string, want string) bool {
	for _, s := range scopes {
		if s == want {
			return true
		}
	}
	return false
}
