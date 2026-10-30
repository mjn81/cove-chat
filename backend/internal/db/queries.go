package db

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"time"

	"cove/backend/internal/models"
	"github.com/segmentio/ksuid"

	badger "github.com/dgraph-io/badger/v4"
)

// ============================================================
//  Users
// ============================================================

// SetUser writes a User record to BadgerDB.
func (d *DB) SetUser(u *models.User) error {
	return d.set(userKey(u.ID), u)
}

// GetUser retrieves a User by ID.
func (d *DB) GetUser(id string) (*models.User, error) {
	var u models.User
	if err := d.get(userKey(id), &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// ListUsers returns every user stored in the database.
// This is a full scan — add a username→id index if the user count grows large.
func (d *DB) ListUsers() ([]*models.User, error) {
	var users []*models.User
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefixUser)
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			var u models.User
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &u)
			}); err != nil {
				return err
			}
			users = append(users, &u)
		}
		return nil
	})
	return users, err
}

// ============================================================
//  Channels
// ============================================================

// SetChannel writes a Channel record to BadgerDB.
func (d *DB) SetChannel(ch *models.Channel) error {
	return d.set(channelKey(ch.ID), ch)
}

// GetChannel retrieves a Channel by ID.
func (d *DB) GetChannel(id string) (*models.Channel, error) {
	var ch models.Channel
	if err := d.get(channelKey(id), &ch); err != nil {
		return nil, err
	}
	return &ch, nil
}

// ListAllChannels scans and returns all channels in the database.
func (d *DB) ListAllChannels() ([]*models.Channel, error) {
	var channels []*models.Channel
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefixChannel)
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			var ch models.Channel
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &ch)
			}); err != nil {
				return err
			}
			channels = append(channels, &ch)
		}
		return nil
	})
	return channels, err
}

// DeleteChannel removes a Channel record from BadgerDB.
func (d *DB) DeleteChannel(id string) error {
	return d.delete(channelKey(id))
}

// SetUserChannel writes the junction index entry for a user↔channel mapping.
func (d *DB) SetUserChannel(uc *models.UserChannel) error {
	if uc.JoinedAt.IsZero() {
		uc.JoinedAt = time.Now().UTC()
	}
	return d.set(ucKey(uc.UserID, uc.ChannelID), uc)
}

// GetUserChannel retrieves a junction entry.
func (d *DB) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	var uc models.UserChannel
	if err := d.get(ucKey(userID, channelID), &uc); err != nil {
		return nil, err
	}
	// Migration/Safety: Ensure IDs are set
	if uc.UserID == "" {
		uc.UserID = userID
	}
	if uc.ChannelID == "" {
		uc.ChannelID = channelID
	}
	return &uc, nil
}

// DeleteUserChannel removes the junction index entry for a user↔channel mapping.
func (d *DB) DeleteUserChannel(userID, channelID string) error {
	return d.bdb.Update(func(txn *badger.Txn) error {
		return txn.Delete([]byte(ucKey(userID, channelID)))
	})
}

// UpdateUserChannelReadTime updates the last read timestamp for a user in a channel.
func (d *DB) UpdateUserChannelReadTime(userID, channelID string, t time.Time) error {
	uc, err := d.GetUserChannel(userID, channelID)
	if err != nil {
		uc = &models.UserChannel{
			UserID:    userID,
			ChannelID: channelID,
			JoinedAt:  time.Now().UTC(),
			Status:    models.StatusActive,
			Role:      models.RoleMember,
		}
	}
	uc.LastReadAt = t
	return d.SetUserChannel(uc)
}

// CountUnreadMessages counts how many messages in a channel are strictly newer than the user's LastReadAt.
func (d *DB) CountUnreadMessages(userID, channelID string) (int, error) {
	var uc models.UserChannel
	if err := d.get(ucKey(userID, channelID), &uc); err != nil {
		return 0, nil
	}

	count := 0
	prefix := []byte(fmt.Sprintf("%s%s:", prefixMessage, channelID))

	err := d.bdb.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		// Optimize: Create a KSUID with the last read timestamp to seek directly
		// to unread messages. Since KSUIDs are K-Sortable, this will skip most
		// read messages.
		//
		// KSUIDs only carry SECOND-granularity timestamps; ordering among
		// KSUIDs from the same second is decided by their random payload. Using
		// NewRandomWithTime here (a random payload) meant the seek key could
		// sort *after* a real unread message minted in the same wall-clock
		// second as LastReadAt, silently skipping it and undercounting. Seeking
		// from one second earlier with the all-zero (minimum) payload guarantees
		// the seek key sorts at or before every KSUID from LastReadAt's second,
		// so no same-second message can be skipped; the SentAt.After() filter
		// below still excludes anything actually already read.
		startKey := prefix
		if !uc.LastReadAt.IsZero() {
			k, err := ksuid.FromParts(uc.LastReadAt.Add(-time.Second), make([]byte, 16))
			if err == nil {
				startKey = []byte(fmt.Sprintf("%s%s:%s", prefixMessage, channelID, k.String()))
			}
		}

		for it.Seek(startKey); it.ValidForPrefix(prefix); it.Next() {
			item := it.Item()
			var m models.Message
			err := item.Value(func(val []byte) error {
				return json.Unmarshal(val, &m)
			})
			if err != nil {
				continue
			}

			if m.SenderID == userID {
				continue
			}

			if m.SentAt.After(uc.LastReadAt) {
				count++
			}
		}
		return nil
	})

	return count, err
}

// ListUserChannels fetches all channels a user belongs to and is active in.
func (d *DB) ListUserChannels(userID string) ([]*models.Channel, error) {
	prefix := prefixUserChannel + userID + ":"
	var channels []*models.Channel

	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefix)
		it := txn.NewIterator(opts)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			var uc models.UserChannel
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &uc)
			}); err != nil {
				return err
			}

			// Only return channels where the user is active
			if uc.Status != models.StatusActive {
				continue
			}

			var ch models.Channel
			item, err := txn.Get([]byte(channelKey(uc.ChannelID)))
			if errors.Is(err, badger.ErrKeyNotFound) {
				continue // Orphan index
			}
			if err != nil {
				return err
			}
			if err := item.Value(func(val []byte) error {
				return json.Unmarshal(val, &ch)
			}); err != nil {
				return err
			}
			channels = append(channels, &ch)
		}
		return nil
	})
	return channels, err
}

// ListChannelMembers returns all users currently in a channel.
func (d *DB) ListChannelMembers(channelID string) ([]*models.UserChannel, error) {
	var members []*models.UserChannel
	// Note: uc is indexed by user_id:channel_id, so listing members for a channelID
	// requires a full scan of uc or a secondary index cid:uid.
	// For now, Cove uses a small-scale approach, but we should add cid:uid index if scaled.
	// RE-EVALUATION: Actually, we scan all uc:* keys to find members of this CID.
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefixUserChannel)
		it := txn.NewIterator(opts)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			var uc models.UserChannel
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &uc)
			}); err != nil {
				return err
			}
			if uc.ChannelID == channelID && uc.Status == models.StatusActive {
				members = append(members, &uc)
			}
		}
		return nil
	})
	return members, err
}

// ============================================================
//  Messages
// ============================================================

// GetMessage retrieves a single message by its channel ID and its formatted ID string.
func (d *DB) GetMessage(channelID string, messageID string) (*models.Message, error) {
	key := fmt.Sprintf("%s%s:%s", prefixMessage, channelID, messageID)
	var msg models.Message
	if err := d.get(key, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// DeleteMessage removes a single message record.
func (d *DB) DeleteMessage(channelID string, messageID string) error {
	key := fmt.Sprintf("%s%s:%s", prefixMessage, channelID, messageID)
	return d.delete(key)
}

// SetMessage writes a message record to BadgerDB using a time-ordered key.
func (d *DB) SetMessage(msg *models.Message) error {
	key := fmt.Sprintf("%s%s:%s", prefixMessage, msg.ChannelID, msg.ID)
	return d.set(key, msg)
}

// DeleteChannelMessages removes all messages for a specific channel.
func (d *DB) DeleteChannelMessages(channelID string) error {
	prefix := []byte(fmt.Sprintf("%s%s:", prefixMessage, channelID))
	return d.bdb.Update(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = prefix
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			if err := txn.Delete(it.Item().Key()); err != nil {
				return err
			}
		}
		return nil
	})
}

// ListMessages returns up to `limit` messages for a channel, newest-first.
// If before is provided, it strictly returns messages older than that ID.
func (d *DB) ListMessages(channelID string, before string, limit int) ([]*models.Message, error) {
	prefix := []byte(fmt.Sprintf("%s%s:", prefixMessage, channelID))
	var msgs []*models.Message

	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Reverse = true
		opts.Prefix = prefix
		it := txn.NewIterator(opts)
		defer it.Close()

		var seekKey []byte
		if before != "" {
			seekKey = []byte(fmt.Sprintf("%s%s:%s", prefixMessage, channelID, before))
		} else {
			// Start from the very end of the channel's messages
			seekKey = append(append([]byte{}, prefix...), 0xFF)
		}

		isFirst := true
		for it.Seek(seekKey); it.Valid() && len(msgs) < limit; it.Next() {
			item := it.Item()
			key := string(item.Key())

			// If we provided a 'before' cursor, skip the message that matches the cursor exactly
			if isFirst && before != "" && key == string(seekKey) {
				isFirst = false
				continue
			}
			isFirst = false

			var m models.Message
			if err := item.Value(func(val []byte) error {
				return json.Unmarshal(val, &m)
			}); err != nil {
				return err
			}
			msgs = append(msgs, &m)
		}
		return nil
	})
	return msgs, err
}

// ============================================================
//  Presence
// ============================================================

// SetPresence writes a Presence record for a user.
func (d *DB) SetPresence(userID string, p *models.Presence) error {
	return d.set(presenceKey(userID), p)
}

// GetPresence retrieves a Presence record for a user.
func (d *DB) GetPresence(userID string) (*models.Presence, error) {
	var p models.Presence
	if err := d.get(presenceKey(userID), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DeletePresence deletes a Presence record.
func (d *DB) DeletePresence(userID string) error {
	return d.bdb.Update(func(txn *badger.Txn) error {
		return txn.Delete([]byte(presenceKey(userID)))
	})
}

// ============================================================
//  Files
// ============================================================

// SetFile writes a File metadata record to BadgerDB.
func (d *DB) SetFile(f *models.File) error {
	return d.set(fileKey(f.ID), f)
}

// GetFile retrieves a File metadata record by ID.
func (d *DB) GetFile(id string) (*models.File, error) {
	var f models.File
	if err := d.get(fileKey(id), &f); err != nil {
		return nil, err
	}
	return &f, nil
}

// ============================================================
//  Sessions
// ============================================================

// SetSession writes a Session record to BadgerDB.
func (d *DB) SetSession(s *models.Session) error {
	return d.set(sessionKey(s.Token), s)
}

// GetSession retrieves a Session record by token.
func (d *DB) GetSession(token string) (*models.Session, error) {
	var s models.Session
	if err := d.get(sessionKey(token), &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// DeleteSession deletes a Session record by token.
func (d *DB) DeleteSession(token string) error {
	return d.delete(sessionKey(token))
}

// ListSessions returns all stored session records.
func (d *DB) ListSessions() ([]*models.Session, error) {
	var sessions []*models.Session
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefixSession)
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			var s models.Session
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &s)
			}); err != nil {
				return err
			}
			sessions = append(sessions, &s)
		}
		return nil
	})
	return sessions, err
}

// ============================================================
//  Relationships (Friend / Block / Request)
// ============================================================

// SetRelationship writes a Relationship record to BadgerDB.
func (d *DB) SetRelationship(rel *models.Relationship) error {
	return d.set(relationshipKey(rel.FromUserID, rel.ToUserID), rel)
}

// GetRelationship retrieves a Relationship by fromID and toID.
func (d *DB) GetRelationship(fromID, toID string) (*models.Relationship, error) {
	var rel models.Relationship
	if err := d.get(relationshipKey(fromID, toID), &rel); err != nil {
		return nil, err
	}
	return &rel, nil
}

// DeleteRelationship removes a Relationship record.
func (d *DB) DeleteRelationship(fromID, toID string) error {
	return d.delete(relationshipKey(fromID, toID))
}

// ListRelationshipsByUser returns all outgoing relationships for a user (rel:fromID:*).
func (d *DB) ListRelationshipsByUser(userID string) ([]*models.Relationship, error) {
	var list []*models.Relationship
	prefix := prefixRelationship + userID + ":"
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefix)
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			var rel models.Relationship
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &rel)
			}); err != nil {
				return err
			}
			list = append(list, &rel)
		}
		return nil
	})
	return list, err
}

// SetRelationshipInbox writes to the incoming request index (reli:toID:fromID).
func (d *DB) SetRelationshipInbox(rel *models.Relationship) error {
	return d.set(relationshipInboxKey(rel.ToUserID, rel.FromUserID), rel)
}

// DeleteRelationshipInbox removes an incoming request from the inbox index.
func (d *DB) DeleteRelationshipInbox(toID, fromID string) error {
	return d.delete(relationshipInboxKey(toID, fromID))
}

// ListIncomingRequests returns all pending incoming requests for a user (reli:toUserID:*).
func (d *DB) ListIncomingRequests(toUserID string) ([]*models.Relationship, error) {
	var list []*models.Relationship
	prefix := prefixRelationshipInbox + toUserID + ":"
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefix)
		it := txn.NewIterator(opts)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			var rel models.Relationship
			if err := it.Item().Value(func(val []byte) error {
				return json.Unmarshal(val, &rel)
			}); err != nil {
				return err
			}
			list = append(list, &rel)
		}
		return nil
	})
	return list, err
}

// ============================================================
//  Server administration: owner, invites, audit
// ============================================================

// ClaimOwner records userID as the server owner if nobody has claimed it yet.
// The write is conditional, so concurrent first sign-ups produce exactly one owner.
func (d *DB) ClaimOwner(userID string) (bool, error) {
	err := d.setIfAbsent(keyOwner, userID)
	if errors.Is(err, ErrConflict) {
		return false, nil
	}
	return err == nil, err
}

// OwnerID returns the owner's user ID, or ErrNotFound if the server has none yet.
func (d *DB) OwnerID() (string, error) {
	var id string
	err := d.get(keyOwner, &id)
	return id, err
}

// SetOwnerID overwrites the owner record (ownership transfer).
func (d *DB) SetOwnerID(userID string) error { return d.set(keyOwner, userID) }

// CreateInvite stores a new invite; ErrConflict if the code exists.
func (d *DB) CreateInvite(inv *models.Invite) error { return d.setIfAbsent(prefixInvite+inv.Code, inv) }

// SetInvite overwrites an invite record.
func (d *DB) SetInvite(inv *models.Invite) error { return d.set(prefixInvite+inv.Code, inv) }

// GetInvite fetches one invite.
func (d *DB) GetInvite(code string) (*models.Invite, error) {
	var inv models.Invite
	if err := d.get(prefixInvite+code, &inv); err != nil {
		return nil, err
	}
	return &inv, nil
}

// UpdateInvite applies fn to an invite atomically.
func (d *DB) UpdateInvite(code string, fn func(*models.Invite) error) (*models.Invite, error) {
	var inv models.Invite
	err := d.update(prefixInvite+code, &inv, func() error { return fn(&inv) })
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// ListInvites returns every invite, newest first.
func (d *DB) ListInvites() ([]*models.Invite, error) {
	items, err := d.listByPrefix(prefixInvite, func() any { return &models.Invite{} })
	if err != nil {
		return nil, err
	}
	out := make([]*models.Invite, 0, len(items))
	for _, it := range items {
		out = append(out, it.(*models.Invite))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// AppendAudit stores one audit entry. Keys sort by time, so listing is chronological.
func (d *DB) AppendAudit(e *models.AuditEntry) error {
	return d.set(fmt.Sprintf("%s%019d:%s", prefixAudit, e.At.UnixNano(), e.ID), e)
}

// ListAudit returns the newest `limit` audit entries, newest first.
func (d *DB) ListAudit(limit int) ([]*models.AuditEntry, error) {
	var out []*models.AuditEntry
	err := d.bdb.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte(prefixAudit)
		opts.Reverse = true
		it := txn.NewIterator(opts)
		defer it.Close()
		// Reverse iteration must seek past the prefix range to start at its last key.
		for it.Seek(append([]byte(prefixAudit), 0xFF)); it.ValidForPrefix([]byte(prefixAudit)) && len(out) < limit; it.Next() {
			var e models.AuditEntry
			if err := it.Item().Value(func(val []byte) error { return json.Unmarshal(val, &e) }); err != nil {
				return err
			}
			out = append(out, &e)
		}
		return nil
	})
	return out, err
}

// DeleteUserRecord removes a user record outright (used only to undo a sign-up that lost the owner race).
func (d *DB) DeleteUserRecord(id string) error { return d.delete(userKey(id)) }

// ---- Admin: backup / reset ------------------------------------------------ //

// Backup streams a consistent snapshot of every key to w (Badger backup format).
func (d *DB) Backup(w io.Writer) error {
	_, err := d.bdb.Backup(w, 0)
	return err
}

// Restore loads a snapshot produced by Backup into the (normally empty) database.
func (d *DB) Restore(r io.Reader) error { return d.bdb.Load(r, 256) }

// ResetKeepUser deletes every key and then re-creates only the given account
// and the owner marker, so the owner can sign straight back in.
func (d *DB) ResetKeepUser(u *models.User) error {
	if err := d.bdb.DropAll(); err != nil {
		return fmt.Errorf("db: drop all: %w", err)
	}
	if err := d.SetUser(u); err != nil {
		return err
	}
	return d.SetOwnerID(u.ID)
}

// DropAll removes every key.
func (d *DB) DropAll() error { return d.bdb.DropAll() }

// ============================================================
//  Known devices (login notice throttling)
// ============================================================

// GetKnownDevices returns the device fingerprints a user has signed in from, oldest first.
func (d *DB) GetKnownDevices(userID string) ([]string, error) {
	var out []string
	if err := d.get(prefixKnownDevices+userID, &out); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// SetKnownDevices replaces a user's device fingerprint list.
func (d *DB) SetKnownDevices(userID string, devices []string) error {
	return d.set(prefixKnownDevices+userID, devices)
}
