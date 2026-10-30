package store

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"cove/backend/internal/crypto"
	"cove/backend/internal/db"
	"cove/backend/internal/models"

	"github.com/segmentio/ksuid"
)

// maxKnownDevices bounds the per-user list of device fingerprints used to decide whether a login is new.
const maxKnownDevices = 20

// IsReservedUsername reports whether name collides (case-insensitively) with the built-in Cove system account,
// so nobody can register or rename themselves into impersonating it.
func IsReservedUsername(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), models.SystemUsername)
}

// EnsureSystemUser creates the Cove system account if it does not exist yet. It has no password hash, so it can
// never log in, and refuses messages, friend requests and invitations. Safe to call repeatedly and after a
// database reset or restore.
func (s *Store) EnsureSystemUser() (*models.User, error) {
	if u, err := s.db.GetUser(models.SystemUserID); err == nil {
		return u, nil
	}
	u := &models.User{
		ID:                      models.SystemUserID,
		Username:                models.SystemUsername,
		Status:                  "online",
		StatusPreference:        "online",
		AvatarID:                models.SystemAvatarID,
		IsSystem:                true,
		AllowChannelAdds:        "nobody",
		DMPermission:            "nobody",
		FriendRequestPermission: "nobody",
		CreatedAt:               time.Now().UTC(),
	}
	if err := s.db.SetUser(u); err != nil {
		return nil, fmt.Errorf("store: create system user: %w", err)
	}
	return u, nil
}

// FindSystemDM returns the existing Cove <-> userID direct message, or db.ErrNotFound.
func (s *Store) FindSystemDM(userID string) (*models.Channel, error) {
	chans, err := s.db.ListUserChannels(userID)
	if err != nil {
		return nil, err
	}
	for _, ch := range chans {
		members, err := s.db.ListChannelMembers(ch.ID)
		if err != nil || !ch.IsDM(len(members)) {
			continue
		}
		for _, m := range members {
			if m.UserID == models.SystemUserID {
				return ch, nil
			}
		}
	}
	return nil, db.ErrNotFound
}

// EnsureSystemDM returns the user's Cove DM, creating it (and the Cove account) when missing. created reports
// whether a new channel was made, so the caller can push its key to the user's online devices.
func (s *Store) EnsureSystemDM(userID string, kek []byte) (ch *models.Channel, created bool, err error) {
	if _, err := s.EnsureSystemUser(); err != nil {
		return nil, false, err
	}
	if ch, err := s.FindSystemDM(userID); err == nil {
		return ch, false, nil
	} else if !errors.Is(err, db.ErrNotFound) {
		return nil, false, err
	}
	ch, err = s.CreateChannel("", models.SystemUserID, true, []string{models.SystemUserID, userID}, kek)
	if err != nil {
		return nil, false, err
	}
	// CreateChannel makes the creator owner; DM members are plain members.
	for _, uid := range []string{models.SystemUserID, userID} {
		if err := s.AddMemberToChannel(ch.ID, uid, models.RoleMember); err != nil {
			return nil, false, err
		}
	}
	return ch, true, nil
}

// PostSystemMessage writes a text message from the Cove account into userID's Cove DM, encrypted with the
// channel key exactly like a client message (separate nonce, no compression) so every client can read it.
func (s *Store) PostSystemMessage(userID, text string, kek []byte) (msg *models.Message, ch *models.Channel, created bool, err error) {
	ch, created, err = s.EnsureSystemDM(userID, kek)
	if err != nil {
		return nil, nil, false, err
	}
	key, err := s.DecryptChannelKey(ch, kek)
	if err != nil {
		return nil, nil, false, fmt.Errorf("store: decrypt system channel key: %w", err)
	}
	nonce, ct, err := crypto.SealGCM(key, []byte(text))
	if err != nil {
		return nil, nil, false, err
	}
	msg = &models.Message{
		ID:          ksuid.New().String(),
		ChannelID:   ch.ID,
		SenderID:    models.SystemUserID,
		Type:        models.MessageTypeText,
		Ciphertext:  ct,
		Nonce:       nonce,
		Compression: "none",
		SentAt:      time.Now().UTC(),
	}
	if err := s.SaveMessage(msg); err != nil {
		return nil, nil, false, err
	}
	return msg, ch, created, nil
}

// DeviceFingerprint identifies a kind of client (not a network location), so signing in again from the same app
// on the same OS from a new IP is not treated as a new device.
func DeviceFingerprint(device, app, platform string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(device + "|" + app + "|" + platform)))
	return hex.EncodeToString(sum[:8])
}

// RecordDevice remembers fingerprint for userID. known reports whether it was seen before; first reports that the
// user had no devices on record at all (a brand-new account), which callers treat as "nothing to warn about".
func (s *Store) RecordDevice(userID, fingerprint string) (known, first bool, err error) {
	devices, err := s.db.GetKnownDevices(userID)
	if err != nil {
		return false, false, err
	}
	for _, d := range devices {
		if d == fingerprint {
			return true, false, nil
		}
	}
	devices = append(devices, fingerprint)
	if len(devices) > maxKnownDevices {
		devices = devices[len(devices)-maxKnownDevices:]
	}
	return false, len(devices) == 1, s.db.SetKnownDevices(userID, devices)
}
