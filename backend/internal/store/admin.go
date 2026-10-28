package store

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"cove/backend/internal/db"
	"cove/backend/internal/models"
	"github.com/google/uuid"
)

// ErrInviteInvalid is returned for every reason an invite cannot be used
// (unknown, revoked, expired, used up). One error on purpose: callers show a
// single generic message so codes cannot be probed.
var ErrInviteInvalid = errors.New("store: invite code is not valid")

// ============================================================
//  Owner and roles
// ============================================================

// ListAllUsers returns every account (including anonymized deleted ones).
func (s *Store) ListAllUsers() ([]*models.User, error) { return s.db.ListUsers() }

// HasOwner reports whether the server already has an owner.
func (s *Store) HasOwner() bool {
	_, err := s.db.OwnerID()
	return err == nil
}

// OwnerID returns the owner's user ID.
func (s *Store) OwnerID() (string, error) { return s.db.OwnerID() }

// ClaimOwner makes u the owner if the server has none yet. It is safe to call
// concurrently: exactly one caller wins. On success u.ServerRole is persisted.
func (s *Store) ClaimOwner(u *models.User) (bool, error) {
	claimed, err := s.db.ClaimOwner(u.ID)
	if err != nil || !claimed {
		return false, err
	}
	u.ServerRole = models.ServerRoleOwner
	return true, s.db.SetUser(u)
}

// SetServerRole sets a non-owner role ("" or "admin"). The owner role can only
// change hands through TransferOwnership.
func (s *Store) SetServerRole(userID, role string) error {
	if role != models.ServerRoleNone && role != models.ServerRoleAdmin {
		return fmt.Errorf("store: role %q cannot be assigned directly", role)
	}
	u, err := s.db.GetUser(userID)
	if err != nil {
		return err
	}
	if u.ServerRole == models.ServerRoleOwner {
		return errors.New("store: the owner role can only be moved with a transfer")
	}
	u.ServerRole = role
	return s.db.SetUser(u)
}

// TransferOwnership moves the owner role from one account to another. The
// previous owner becomes an admin so they keep access to the panel.
func (s *Store) TransferOwnership(fromID, toID string) error {
	cur, err := s.db.OwnerID()
	if err != nil || cur != fromID {
		return errors.New("store: caller is not the owner")
	}
	to, err := s.db.GetUser(toID)
	if err != nil {
		return err
	}
	from, err := s.db.GetUser(fromID)
	if err != nil {
		return err
	}
	to.ServerRole = models.ServerRoleOwner
	from.ServerRole = models.ServerRoleAdmin
	if err := s.db.SetUser(to); err != nil {
		return err
	}
	if err := s.db.SetUser(from); err != nil {
		return err
	}
	return s.db.SetOwnerID(toID)
}

// ListAdmins returns accounts holding the admin or owner role.
func (s *Store) ListAdmins() ([]*models.User, error) {
	users, err := s.db.ListUsers()
	if err != nil {
		return nil, err
	}
	var out []*models.User
	for _, u := range users {
		if models.IsServerAdmin(u.ServerRole) {
			out = append(out, u)
		}
	}
	return out, nil
}

// PurgeUser removes a user record entirely. Only for undoing a sign-up that
// lost the first-owner race while registration is closed.
func (s *Store) PurgeUser(id string) error { return s.db.DeleteUserRecord(id) }

// ============================================================
//  Invitations
// ============================================================

// inviteAlphabet avoids look-alike characters (0/O, 1/I/L) so codes survive being read aloud.
const inviteAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// GenerateInviteCode returns 16 random characters (about 79 bits).
func GenerateInviteCode() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 16)
	for i, x := range b {
		out[i] = inviteAlphabet[int(x)%len(inviteAlphabet)]
	}
	return string(out), nil
}

// CreateInvite stores a new invite. A blank code is replaced by a random one.
func (s *Store) CreateInvite(inv *models.Invite) error {
	inv.Code = strings.TrimSpace(inv.Code)
	if inv.Code == "" {
		code, err := GenerateInviteCode()
		if err != nil {
			return err
		}
		inv.Code = code
	}
	if inv.MaxUses < 0 {
		return errors.New("store: max uses cannot be negative")
	}
	if inv.CreatedAt.IsZero() {
		inv.CreatedAt = time.Now().UTC()
	}
	if inv.Source == "" {
		inv.Source = models.InviteSourcePanel
	}
	return s.db.CreateInvite(inv)
}

// GetInvite fetches an invite by code.
func (s *Store) GetInvite(code string) (*models.Invite, error) { return s.db.GetInvite(code) }

// ListInvites returns all invites, newest first.
func (s *Store) ListInvites() ([]*models.Invite, error) { return s.db.ListInvites() }

// RevokeInvite disables an invite without deleting its history.
func (s *Store) RevokeInvite(code string) error {
	_, err := s.db.UpdateInvite(code, func(inv *models.Invite) error {
		inv.Revoked = true
		return nil
	})
	return err
}

// inviteUsable reports whether inv can still be redeemed at time now.
func inviteUsable(inv *models.Invite, now time.Time) bool {
	if inv.Revoked {
		return false
	}
	if inv.ExpiresAt != nil && !now.Before(*inv.ExpiresAt) {
		return false
	}
	return inv.MaxUses == 0 || inv.Uses < inv.MaxUses
}

// ReserveInviteUse atomically takes one use of the invite. Check and
// increment happen in one transaction, so N concurrent sign-ups on an invite
// with M uses left can never succeed more than M times. Release the use with
// ReleaseInviteUse if the account then fails to be created.
func (s *Store) ReserveInviteUse(code string, now time.Time) error {
	_, err := s.db.UpdateInvite(strings.TrimSpace(code), func(inv *models.Invite) error {
		if !inviteUsable(inv, now) {
			return ErrInviteInvalid
		}
		inv.Uses++
		return nil
	})
	if errors.Is(err, db.ErrNotFound) {
		return ErrInviteInvalid
	}
	return err
}

// ReleaseInviteUse gives back a use taken by ReserveInviteUse.
func (s *Store) ReleaseInviteUse(code string) {
	_, _ = s.db.UpdateInvite(strings.TrimSpace(code), func(inv *models.Invite) error {
		if inv.Uses > 0 {
			inv.Uses--
		}
		return nil
	})
}

// SeedConfigInvites reconciles invites declared in config.toml with the
// database: new codes are created, changed limits/expiry/note are updated
// (use counts are kept), and config invites that were removed from the file
// are revoked. Panel-created invites are never touched.
func (s *Store) SeedConfigInvites(specs []models.InviteSpec) error {
	wanted := make(map[string]bool, len(specs))
	for _, sp := range specs {
		code := strings.TrimSpace(sp.Code)
		if code == "" {
			continue
		}
		wanted[code] = true
		_, err := s.db.UpdateInvite(code, func(inv *models.Invite) error {
			if inv.Source != models.InviteSourceConfig {
				return fmt.Errorf("store: code %q already exists as a panel invite", code)
			}
			inv.ExpiresAt, inv.MaxUses, inv.Note = sp.ExpiresAt, sp.MaxUses, sp.Note
			inv.Revoked = false
			return nil
		})
		if errors.Is(err, db.ErrNotFound) {
			err = s.db.CreateInvite(&models.Invite{
				Code:      code,
				Note:      sp.Note,
				CreatedBy: "config",
				CreatedAt: time.Now().UTC(),
				ExpiresAt: sp.ExpiresAt,
				MaxUses:   sp.MaxUses,
				Source:    models.InviteSourceConfig,
			})
		}
		if err != nil {
			return err
		}
	}

	existing, err := s.db.ListInvites()
	if err != nil {
		return err
	}
	for _, inv := range existing {
		if inv.Source == models.InviteSourceConfig && !wanted[inv.Code] && !inv.Revoked {
			if err := s.RevokeInvite(inv.Code); err != nil {
				return err
			}
		}
	}
	return nil
}

// ============================================================
//  Audit log
// ============================================================

// Audit records an admin action. Never put secrets in action or target.
func (s *Store) Audit(actor *models.User, action, target string) error {
	e := &models.AuditEntry{
		ID:     uuid.New().String(),
		At:     time.Now().UTC(),
		Action: action,
		Target: target,
	}
	if actor != nil {
		e.ActorID, e.ActorName = actor.ID, actor.Username
	}
	return s.db.AppendAudit(e)
}

// ListAudit returns the newest entries first.
func (s *Store) ListAudit(limit int) ([]*models.AuditEntry, error) { return s.db.ListAudit(limit) }

// Backup writes a snapshot of the whole database to w.
func (s *Store) Backup(w io.Writer) error { return s.db.Backup(w) }

// Restore loads a snapshot made by Backup.
func (s *Store) Restore(r io.Reader) error { return s.db.Restore(r) }

// RestoreReplace replaces ALL data with a snapshot made by Backup. The caller
// must have decrypted and validated the archive first: once DropAll runs there
// is no way back.
func (s *Store) RestoreReplace(r io.Reader) error {
	if err := s.db.DropAll(); err != nil {
		return err
	}
	return s.db.Restore(r)
}

// ResetKeepOwner wipes all data except the given owner account.
func (s *Store) ResetKeepOwner(owner *models.User) error { return s.db.ResetKeepUser(owner) }

// WipeAll removes every record, including the owner.
func (s *Store) WipeAll() error { return s.db.DropAll() }

// RecoverOwner makes the named account the owner (config `admin.owner_username`).
// It is the recovery path for a lost owner login: whoever can edit config.toml
// on the host already controls the server. A missing user or an account that
// already holds the role is a no-op.
func (s *Store) RecoverOwner(username string) error {
	u, err := s.GetUserByUsername(username)
	if err != nil || u == nil {
		return nil
	}
	cur, _ := s.db.OwnerID()
	if cur == u.ID {
		return nil
	}
	if prev, err := s.db.GetUser(cur); err == nil && cur != "" {
		prev.ServerRole = models.ServerRoleAdmin
		if err := s.db.SetUser(prev); err != nil {
			return err
		}
	}
	u.ServerRole = models.ServerRoleOwner
	if err := s.db.SetUser(u); err != nil {
		return err
	}
	return s.db.SetOwnerID(u.ID)
}
