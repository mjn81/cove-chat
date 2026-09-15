package store

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"nodetalk/backend/internal/crypto"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/models"
)

// Store wraps the DB with all NodeTalk repository logic — users, channels,
// messages, presence, and files.
type Store struct {
	db *db.DB
}

// New creates a Store backed by the given DB.
func New(database *db.DB) *Store {
	return &Store{db: database}
}

// ============================================================
//  Users
// ============================================================

// CreateUser hashes the password and persists a new User record.
// Returns ErrConflict if the user ID already exists.
func (s *Store) CreateUser(username, password, domain string) (*models.User, error) {
	// First check if a user with this username already exists
	if existing, _ := s.GetUserByUsername(username); existing != nil {
		return nil, fmt.Errorf("store: username already exists")
	}

	id := uuid.New().String()
	pwdHash, err := crypto.HashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("store: password hashing failed: %w", err)
	}
	u := &models.User{
		ID:        id,
		Username:  username,
		PwdHash:   pwdHash,
		Domain:    domain,
		Status:    "offline",
		CreatedAt: time.Now().UTC(),
	}
	if err := s.db.SetUser(u); err != nil {
		return nil, err
	}
	return u, nil
}

// GetUser retrieves a user by ID.
func (s *Store) GetUser(id string) (*models.User, error) {
	return s.db.GetUser(id)
}

// UpdateUserStatus is a helper to only update the active status in DB.
func (s *Store) UpdateUserStatus(userID, status string) error {
	u, err := s.GetUser(userID)
	if err != nil {
		return err
	}
	u.Status = status
	return s.db.SetUser(u)
}

// GetUserByUsername scans all users to find one with a matching username.
// For production scale, add a username→id secondary index.
func (s *Store) GetUserByUsername(username string) (*models.User, error) {
	users, err := s.db.ListUsers()
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		if u.Username == username {
			return u, nil
		}
	}
	return nil, db.ErrNotFound
}

// AuthenticateUser looks up u by username and verifies the password.
// Returns the user record on success, or an error.
func (s *Store) AuthenticateUser(username, password string) (*models.User, error) {
	u, err := s.GetUserByUsername(username)
	if err != nil {
		return nil, fmt.Errorf("store: user not found")
	}
	ok, err := crypto.VerifyPassword(password, u.PwdHash)
	if err != nil {
		return nil, fmt.Errorf("store: password verification error: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("store: invalid credentials")
	}
	return u, nil
}

// SearchUsers performs a prefix or contains match on Usernames.
// Returns an array of safe user records (passwords stripped).
func (s *Store) SearchUsers(query string) ([]*models.User, error) {
	users, err := s.db.ListUsers()
	if err != nil {
		return nil, err
	}
	var matched []*models.User
	q := strings.ToLower(query)
	for _, u := range users {
		if u.Status != "deleted" && strings.Contains(strings.ToLower(u.Username), q) {
			safeUser := &models.User{
				ID:        u.ID,
				Username:  u.Username,
				Domain:    u.Domain,
				Status:    u.Status,
				AvatarID:  u.AvatarID,
				CustomMsg: u.CustomMsg,
			}
			matched = append(matched, safeUser)
		}
	}
	return matched, nil
}

// DeleteUser fully anonymizes a user. We remove them from group channels
// so they don't clutter member lists, but we keep them in DMs so that
// the other participant can still see the conversation history.
func (s *Store) DeleteUser(userID string) error {
	// 1. Remove from Group Channels (keep DMs)
	channels, err := s.ListUserChannels(userID)
	if err != nil {
		logger.Warnf("store: DeleteUser(%s): failed to list channels, group memberships may be left behind: %v", userID, err)
	} else {
		for _, ch := range channels {
			members, merr := s.GetChannelMembers(ch.ID)
			if merr != nil {
				logger.Warnf("store: DeleteUser(%s): failed to load members of channel %s: %v", userID, ch.ID, merr)
				continue
			}
			if !ch.IsDM(len(members)) {
				if rerr := s.RemoveMemberFromChannel(ch.ID, userID, models.StatusLeft); rerr != nil {
					logger.Warnf("store: DeleteUser(%s): failed to remove membership in channel %s: %v", userID, ch.ID, rerr)
				}
			}
		}
	}

	// 2. Clear presence
	if err := s.db.DeletePresence(userID); err != nil {
		logger.Warnf("store: DeleteUser(%s): failed to clear presence: %v", userID, err)
	}

	// 3. Anonymize user record
	u, err := s.db.GetUser(userID)
	if err != nil {
		return fmt.Errorf("store: DeleteUser(%s): failed to load user record for anonymization: %w", userID, err)
	}
	u.Username = "Deleted Account"
	u.Status = "deleted"
	u.PwdHash = nil
	u.AvatarID = ""
	u.CustomMsg = ""
	u.PublicKey = nil
	if err := s.db.SetUser(u); err != nil {
		return fmt.Errorf("store: DeleteUser(%s): failed to persist anonymized user record: %w", userID, err)
	}
	return nil
}

// UpdateUser updates a user record in the DB.
func (s *Store) UpdateUser(u *models.User) error {
	return s.db.SetUser(u)
}

// ============================================================
//  Channels
// ============================================================

// CreateChannel creates a new channel (DM or group), generates its AES-256
// channel key, and writes the junction index entries for all initial members.
func (s *Store) CreateChannel(name, creatorID string, isPrivate bool, memberIDs []string, kek []byte) (*models.Channel, error) {
	// Generate a fresh AES-256 key for this channel.
	rawKey, err := crypto.GenerateAES256Key()
	if err != nil {
		return nil, fmt.Errorf("store: channel key generation failed: %w", err)
	}
	encKey, err := crypto.EncryptAES256GCM(kek, rawKey)
	if err != nil {
		return nil, fmt.Errorf("store: channel key encryption failed: %w", err)
	}

	ch := &models.Channel{
		ID:              uuid.New().String(),
		Name:            name,
		IsPrivate:       isPrivate,
		InviteLink:      uuid.New().String()[:12] + uuid.New().String()[24:], // Unique shortish link
		CreatorID:       creatorID,
		AESKeyEncrypted: encKey,
		CreatedAt:       time.Now().UTC(),
	}
	if err := s.db.SetChannel(ch); err != nil {
		return nil, err
	}

	// Create UserChannel associations
	for _, uid := range memberIDs {
		role := models.RoleMember
		if uid == creatorID {
			role = models.RoleOwner
		}
		
		uc := &models.UserChannel{
			UserID:    uid,
			ChannelID: ch.ID,
			Role:      role,
			Status:    models.StatusActive,
			JoinedAt:  time.Now().UTC(),
		}
		if err := s.db.SetUserChannel(uc); err != nil {
			return nil, fmt.Errorf("store: failed to index member %s: %w", uid, err)
		}
	}
	return ch, nil
}

// GetChannelMembers returns all active members in a channel.
func (s *Store) GetChannelMembers(channelID string) ([]*models.UserChannel, error) {
	return s.db.ListChannelMembers(channelID)
}

// GetUserChannel retrieves the role/status of a user in a channel.
func (s *Store) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	return s.db.GetUserChannel(userID, channelID)
}

// GetChannel retrieves a channel by ID.
func (s *Store) GetChannel(id string) (*models.Channel, error) {
	return s.db.GetChannel(id)
}

// GetChannelByInviteLink searches for a channel by its unique invite link.
func (s *Store) GetChannelByInviteLink(link string) (*models.Channel, error) {
	channels, err := s.db.ListAllChannels()
	if err != nil {
		return nil, err
	}
	for _, ch := range channels {
		if ch.InviteLink == link {
			return ch, nil
		}
	}
	return nil, db.ErrNotFound
}

// AddMemberToChannel adds or reactivates a user in a channel.
func (s *Store) AddMemberToChannel(channelID, userID string, role int) error {
	uc, err := s.db.GetUserChannel(userID, channelID)
	if err == nil {
		// Existing record, update status to active
		uc.Status = models.StatusActive
		uc.Role = role
		return s.db.SetUserChannel(uc)
	}

	// New record
	return s.db.SetUserChannel(&models.UserChannel{
		UserID:    userID,
		ChannelID: channelID,
		Role:      role,
		Status:    models.StatusActive,
		JoinedAt:  time.Now().UTC(),
	})
}

// ListUserChannels returns all channels a user belongs to, calculating unread counts for each.
func (s *Store) ListUserChannels(userID string) ([]*models.Channel, error) {
	channels, err := s.db.ListUserChannels(userID)
	if err != nil {
		return nil, err
	}
	for _, ch := range channels {
		if count, err := s.db.CountUnreadMessages(userID, ch.ID); err == nil {
			ch.UnreadCount = count
		}
	}
	return channels, nil
}

// UpdateChannelRead sets the LastReadAt timestamp to now for this user/channel.
func (s *Store) UpdateChannelRead(userID, channelID string) error {
	return s.db.UpdateUserChannelReadTime(userID, channelID, time.Now().UTC())
}

// ListAllChannels scans and returns all channels in the DB.
func (s *Store) ListAllChannels() ([]*models.Channel, error) {
	return s.db.ListAllChannels()
}

// UpdateChannel persists changes to a Channel record.
func (s *Store) UpdateChannel(ch *models.Channel) error {
	return s.db.SetChannel(ch)
}

// DeleteChannel removes the channel and all its member associations.
func (s *Store) DeleteChannel(id string) error {
	// 1. Remove all UserChannel associations
	members, err := s.GetChannelMembers(id)
	if err != nil {
		logger.Warnf("store: DeleteChannel(%s): failed to list members, some UserChannel records may be left behind: %v", id, err)
	} else {
		for _, m := range members {
			if derr := s.db.DeleteUserChannel(m.UserID, id); derr != nil {
				logger.Warnf("store: DeleteChannel(%s): failed to remove membership for user %s: %v", id, m.UserID, derr)
			}
		}
	}

	// 2. Delete all messages
	if err := s.db.DeleteChannelMessages(id); err != nil {
		logger.Warnf("store: DeleteChannel(%s): failed to delete messages: %v", id, err)
	}

	// 3. Delete the channel record
	return s.db.DeleteChannel(id)
}

// RemoveMemberFromChannel updates a user's status to kicked, left, or banned.
func (s *Store) RemoveMemberFromChannel(channelID, userID, status string) error {
	uc, err := s.db.GetUserChannel(userID, channelID)
	if err != nil {
		return err
	}
	uc.Status = status
	return s.db.SetUserChannel(uc)
}

// UpdateMemberRole changes a user's role in a channel.
func (s *Store) UpdateMemberRole(channelID, userID string, role int) error {
	uc, err := s.db.GetUserChannel(userID, channelID)
	if err != nil {
		return err
	}
	uc.Role = role
	return s.db.SetUserChannel(uc)
}


// DecryptChannelKey decrypts and returns the raw AES key for a channel.
func (s *Store) DecryptChannelKey(ch *models.Channel, kek []byte) ([]byte, error) {
	return crypto.DecryptAES256GCM(kek, ch.AESKeyEncrypted)
}

// ============================================================
//  Messages
// ============================================================

// SaveMessage persists an encrypted message to BadgerDB.
func (s *Store) SaveMessage(msg *models.Message) error {
	return s.db.SetMessage(msg)
}

// GetMessage retrieves a specific message.
func (s *Store) GetMessage(channelID string, messageID string) (*models.Message, error) {
	return s.db.GetMessage(channelID, messageID)
}

// UpdateMessage persists an existing message with its updated timestamp.
func (s *Store) UpdateMessage(msg *models.Message) error {
	return s.db.SetMessage(msg)
}

// DeleteMessage removes a message from the DB.
func (s *Store) DeleteMessage(channelID string, messageID string) error {
	return s.db.DeleteMessage(channelID, messageID)
}

// ListMessages returns recent messages for a channel, newest-first, up to limit.
// If before is provided, it returns messages older than that ID.
func (s *Store) ListMessages(channelID string, before string, limit int) ([]*models.Message, error) {
	return s.db.ListMessages(channelID, before, limit)
}

// ============================================================
//  Presence
// ============================================================

// SetPresence upserts a presence record for a user.
func (s *Store) SetPresence(userID, status string) error {
	return s.db.SetPresence(userID, &models.Presence{
		LastSeen:      time.Now().UTC(),
		CurrentStatus: status,
	})
}

// GetPresence returns the current presence for a user.
func (s *Store) GetPresence(userID string) (*models.Presence, error) {
	return s.db.GetPresence(userID)
}

// ============================================================
//  Files
// ============================================================

// RegisterFile persists file metadata after a successful upload.
func (s *Store) RegisterFile(ownerID, channelID, mime, storagePath string, size int64, thumbCipher, thumbNonce []byte) (*models.File, error) {
	f := &models.File{
		ID:          uuid.New().String(),
		OwnerID:     ownerID,
		ChannelID:   channelID,
		SizeBytes:   size,
		MIMEType:    mime,
		StoragePath: storagePath,
		ThumbCipher: thumbCipher,
		ThumbNonce:  thumbNonce,
		UploadedAt:  time.Now().UTC(),
	}
	if err := s.db.SetFile(f); err != nil {
		return nil, err
	}
	return f, nil
}
