package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"nodetalk/backend/internal/config"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/store"
)

// appVersion is reported by /api/version and the admin overview.
const appVersion = "0.9.0"

// ---- DTOs ------------------------------------------------------------------ //

// AdminOverviewResponse is the dashboard shown at the top of the admin panel.
type AdminOverviewResponse struct {
	Version          string `json:"version" example:"0.9.0"`
	Domain           string `json:"domain" example:"chat.example.com"`
	Users            int    `json:"users" example:"42"`
	Channels         int    `json:"channels" example:"12"`
	Invites          int    `json:"active_invites" example:"3"`
	RegistrationMode string `json:"registration_mode" example:"invite_only"`
	UptimeSeconds    int64  `json:"uptime_seconds" example:"86400"`
	DataSizeBytes    int64  `json:"data_size_bytes" example:"10485760"`
}

// ConfigSettingResponse is one editable setting with its current value.
type ConfigSettingResponse struct {
	config.Setting
	Value any `json:"value"`
}

// AdminConfigResponse lists every editable setting.
type AdminConfigResponse struct {
	Settings []ConfigSettingResponse `json:"settings"`
}

// UpdateConfigRequest edits one or more settings. `password` is only needed
// when a change touches an owner-only setting.
type UpdateConfigRequest struct {
	Changes  map[string]any `json:"changes"`
	Password string         `json:"password,omitempty"`
}

// UpdateConfigResponse tells the panel what took effect immediately.
type UpdateConfigResponse struct {
	Applied         []string `json:"applied"`
	RestartRequired []string `json:"restart_required"`
}

// CreateInviteRequest creates an invitation code.
type CreateInviteRequest struct {
	Code      string `json:"code,omitempty" example:"WELCOME-2026"`
	Note      string `json:"note,omitempty" example:"launch party"`
	MaxUses   int    `json:"max_uses" example:"10"` // 0 = unlimited
	ExpiresAt string `json:"expires_at,omitempty" example:"2026-12-31T23:59:59Z"`
}

// InviteResponse is an invitation with its computed status.
type InviteResponse struct {
	Code      string  `json:"code"`
	Note      string  `json:"note,omitempty"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
	ExpiresAt *string `json:"expires_at"`
	MaxUses   int     `json:"max_uses"`
	Uses      int     `json:"uses"`
	Revoked   bool    `json:"revoked"`
	Source    string  `json:"source"`
	// Status is "active", "expired", "exhausted" or "revoked".
	Status string `json:"status"`
}

// InviteListResponse wraps the invite list.
type InviteListResponse struct {
	Invites []InviteResponse `json:"invites"`
}

// AuditListResponse wraps recent audit entries.
type AuditListResponse struct {
	Entries []*models.AuditEntry `json:"entries"`
}

// AdminAccountResponse is one account with a server role.
type AdminAccountResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

// AdminListResponse wraps the admins.
type AdminListResponse struct {
	Admins []AdminAccountResponse `json:"admins"`
}

// PasswordRequest carries the step-up password.
type PasswordRequest struct {
	Password string `json:"password"`
}

// TransferOwnerRequest hands the owner role to another account.
type TransferOwnerRequest struct {
	Username string `json:"username" example:"alice"`
	Password string `json:"password"`
	Confirm  string `json:"confirm" example:"TRANSFER"`
}

// ---- Overview --------------------------------------------------------------- //

// AdminOverview godoc
//	@Summary     Server overview
//	@Description Counts, uptime and registration mode for the admin dashboard.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AdminOverviewResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Router      /api/admin/overview [get]
func (h *Handler) AdminOverview(w http.ResponseWriter, r *http.Request) {
	users, _ := h.Store.ListAllUsers()
	active := 0
	for _, u := range users {
		if u.Status != "deleted" {
			active++
		}
	}
	channels, _ := h.Store.ListAllChannels()
	invites, _ := h.Store.ListInvites()
	now := time.Now()
	liveInvites := 0
	for _, inv := range invites {
		if inviteStatus(inv, now) == "active" {
			liveInvites++
		}
	}
	var uptime int64
	if !h.StartedAt.IsZero() {
		uptime = int64(time.Since(h.StartedAt).Seconds())
	}
	writeJSON(w, http.StatusOK, AdminOverviewResponse{
		Version:          appVersion,
		Domain:           h.ServerDomain,
		Users:            active,
		Channels:         len(channels),
		Invites:          liveInvites,
		RegistrationMode: h.registrationMode(),
		UptimeSeconds:    uptime,
		DataSizeBytes:    dirSize(h.DataDir),
	})
}

// dirSize adds up file sizes below dir; unreadable entries count as zero.
func dirSize(dir string) int64 {
	if dir == "" {
		return 0
	}
	var total int64
	_ = filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

// ---- Config ----------------------------------------------------------------- //

// AdminGetConfig godoc
//	@Summary     Editable server settings
//	@Description Lists the settings the panel may change with their saved values. Secrets and file paths are never included.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AdminConfigResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/config [get]
func (h *Handler) AdminGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Read(h.ConfigPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.config_unreadable")
		return
	}
	out := AdminConfigResponse{Settings: []ConfigSettingResponse{}}
	for _, s := range config.Schema() {
		out.Settings = append(out.Settings, ConfigSettingResponse{Setting: s, Value: s.Value(cfg)})
	}
	writeJSON(w, http.StatusOK, out)
}

// AdminUpdateConfig godoc
//	@Summary     Change server settings
//	@Description Validates every change, writes them into config.toml (comments are kept) and applies live-editable ones immediately. The whole request is rejected if any change is invalid.
//	@Description **Access:** Server Admin. Owner-only settings need the owner and their password.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body UpdateConfigRequest true "Settings to change"
//	@Success     200 {object} UpdateConfigResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Router      /api/admin/config [patch]
func (h *Handler) AdminUpdateConfig(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body UpdateConfigRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	changes, err := config.ValidateChanges(body.Changes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_setting: "+err.Error())
		return
	}

	needsOwner := false
	for _, c := range changes {
		if c.Setting.OwnerOnly {
			needsOwner = true
		}
	}
	if needsOwner {
		if actor.ServerRole != models.ServerRoleOwner {
			writeError(w, http.StatusForbidden, "admin.errors.owner_only_setting")
			return
		}
		if !h.confirmPassword(w, actor, body.Password) {
			return
		}
	}
	if len(changes) == 0 {
		writeJSON(w, http.StatusOK, UpdateConfigResponse{Applied: []string{}, RestartRequired: []string{}})
		return
	}
	if h.ConfigPath == "" {
		writeError(w, http.StatusInternalServerError, "admin.errors.config_unavailable")
		return
	}

	patch := make([]config.Change, len(changes))
	for i, c := range changes {
		patch[i] = c.Change
	}
	if err := config.PatchFile(h.ConfigPath, patch); err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.config_write_failed")
		return
	}

	resp := UpdateConfigResponse{Applied: []string{}, RestartRequired: []string{}}
	for _, c := range changes {
		if c.Setting.RestartRequired {
			resp.RestartRequired = append(resp.RestartRequired, c.Setting.Key)
		} else {
			resp.Applied = append(resp.Applied, c.Setting.Key)
		}
	}
	h.applyLiveSettings()
	for _, c := range changes {
		h.audit(actor, "config.update", c.Setting.Key)
	}
	writeJSON(w, http.StatusOK, resp)
}

// applyLiveSettings re-reads the saved config and pushes the live-editable
// values into the running server.
func (h *Handler) applyLiveSettings() {
	if h.Settings == nil || h.ConfigPath == "" {
		return
	}
	cfg, err := config.Read(h.ConfigPath)
	if err != nil {
		return
	}
	h.Settings.SetRegistrationMode(cfg.Registration.Mode)
	h.Settings.SetLimits(cfg.Server.MaxFileSizeMB, cfg.Server.MaxVideoSizeMB, cfg.Server.MaxVideoDurationSec)
}

// ---- Invites ---------------------------------------------------------------- //

var inviteCodeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{6,64}$`)

func inviteStatus(inv *models.Invite, now time.Time) string {
	switch {
	case inv.Revoked:
		return "revoked"
	case inv.ExpiresAt != nil && !now.Before(*inv.ExpiresAt):
		return "expired"
	case inv.MaxUses > 0 && inv.Uses >= inv.MaxUses:
		return "exhausted"
	default:
		return "active"
	}
}

func inviteView(inv *models.Invite, now time.Time) InviteResponse {
	v := InviteResponse{
		Code:      inv.Code,
		Note:      inv.Note,
		CreatedBy: inv.CreatedBy,
		CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339),
		MaxUses:   inv.MaxUses,
		Uses:      inv.Uses,
		Revoked:   inv.Revoked,
		Source:    inv.Source,
		Status:    inviteStatus(inv, now),
	}
	if inv.ExpiresAt != nil {
		s := inv.ExpiresAt.UTC().Format(time.RFC3339)
		v.ExpiresAt = &s
	}
	return v
}

// AdminListInvites godoc
//	@Summary     List invitation codes
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} InviteListResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Router      /api/admin/invites [get]
func (h *Handler) AdminListInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := h.Store.ListInvites()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	now := time.Now()
	out := InviteListResponse{Invites: []InviteResponse{}}
	for _, inv := range invites {
		out.Invites = append(out.Invites, inviteView(inv, now))
	}
	writeJSON(w, http.StatusOK, out)
}

// AdminCreateInvite godoc
//	@Summary     Create an invitation code
//	@Description Limited-use (max_uses > 0) or unlimited (max_uses = 0), with an optional expiry date. Leave `code` empty for a random one.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body CreateInviteRequest true "Invite settings"
//	@Success     201 {object} InviteResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Router      /api/admin/invites [post]
func (h *Handler) AdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body CreateInviteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if body.MaxUses < 0 || body.MaxUses > 1_000_000 {
		writeError(w, http.StatusBadRequest, "admin.errors.invite_max_uses")
		return
	}
	if len(body.Note) > 200 {
		writeError(w, http.StatusBadRequest, "admin.errors.invite_note_too_long")
		return
	}
	body.Code = strings.TrimSpace(body.Code)
	if body.Code != "" && !inviteCodeRe.MatchString(body.Code) {
		writeError(w, http.StatusBadRequest, "admin.errors.invite_code_format")
		return
	}
	inv := &models.Invite{Code: body.Code, Note: body.Note, CreatedBy: actor.ID, MaxUses: body.MaxUses}
	if body.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, body.ExpiresAt)
		if err != nil || !t.After(time.Now()) {
			writeError(w, http.StatusBadRequest, "admin.errors.invite_expiry")
			return
		}
		inv.ExpiresAt = &t
	}
	if err := h.Store.CreateInvite(inv); err != nil {
		if errors.Is(err, db.ErrConflict) {
			writeError(w, http.StatusConflict, "admin.errors.invite_exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	h.audit(actor, "invite.create", inv.Code)
	writeJSON(w, http.StatusCreated, inviteView(inv, time.Now()))
}

// AdminRevokeInvite godoc
//	@Summary     Revoke an invitation code
//	@Description Codes declared in config.toml cannot be revoked here; remove them from the file.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Param       code path string true "Invite code"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Router      /api/admin/invites/{code} [delete]
func (h *Handler) AdminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	code := r.PathValue("code")
	inv, err := h.Store.GetInvite(code)
	if err != nil {
		writeError(w, http.StatusNotFound, "admin.errors.invite_not_found")
		return
	}
	if inv.Source == models.InviteSourceConfig {
		writeError(w, http.StatusConflict, "admin.errors.invite_from_config")
		return
	}
	if err := h.Store.RevokeInvite(code); err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	h.audit(actor, "invite.revoke", code)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// ---- Audit ------------------------------------------------------------------ //

// AdminAudit godoc
//	@Summary     Recent admin actions
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AuditListResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Router      /api/admin/audit [get]
func (h *Handler) AdminAudit(w http.ResponseWriter, r *http.Request) {
	entries, err := h.Store.ListAudit(200)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	if entries == nil {
		entries = []*models.AuditEntry{}
	}
	writeJSON(w, http.StatusOK, AuditListResponse{Entries: entries})
}

// ---- Admins and ownership --------------------------------------------------- //

// AdminListAdmins godoc
//	@Summary     List admins
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} AdminListResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Router      /api/admin/admins [get]
func (h *Handler) AdminListAdmins(w http.ResponseWriter, r *http.Request) {
	admins, err := h.Store.ListAdmins()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	out := AdminListResponse{Admins: []AdminAccountResponse{}}
	for _, u := range admins {
		out.Admins = append(out.Admins, AdminAccountResponse{ID: u.ID, Username: u.Username, Role: u.ServerRole})
	}
	writeJSON(w, http.StatusOK, out)
}

// findAccount resolves {username} for the admin-management routes.
func (h *Handler) findAccount(w http.ResponseWriter, r *http.Request) *models.User {
	u, err := h.Store.GetUserByUsername(r.PathValue("username"))
	if err != nil || u.Status == "deleted" {
		writeError(w, http.StatusNotFound, "admin.errors.user_not_found")
		return nil
	}
	return u
}

// AdminGrantAdmin godoc
//	@Summary     Give an account admin access
//	@Description **Access:** Server Owner, with their password.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       username path string true "Username"
//	@Param       body body PasswordRequest true "Owner password"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Router      /api/admin/admins/{username} [put]
func (h *Handler) AdminGrantAdmin(w http.ResponseWriter, r *http.Request) {
	h.setAdminRole(w, r, models.ServerRoleAdmin, "admin.grant")
}

// AdminRevokeAdmin godoc
//	@Summary     Remove an account's admin access
//	@Description **Access:** Server Owner, with their password.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       username path string true "Username"
//	@Param       body body PasswordRequest true "Owner password"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Router      /api/admin/admins/{username} [delete]
func (h *Handler) AdminRevokeAdmin(w http.ResponseWriter, r *http.Request) {
	h.setAdminRole(w, r, models.ServerRoleNone, "admin.revoke")
}

func (h *Handler) setAdminRole(w http.ResponseWriter, r *http.Request, role, action string) {
	actor := adminActor(r)
	var body PasswordRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if !h.confirmPassword(w, actor, body.Password) {
		return
	}
	target := h.findAccount(w, r)
	if target == nil {
		return
	}
	if target.ServerRole == models.ServerRoleOwner {
		writeError(w, http.StatusBadRequest, "admin.errors.owner_role_fixed")
		return
	}
	if err := h.Store.SetServerRole(target.ID, role); err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	h.audit(actor, action, target.Username)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// AdminTransferOwner godoc
//	@Summary     Hand the owner role to another account
//	@Description The previous owner stays on as an admin. Needs the owner's password and the confirmation phrase `TRANSFER`.
//	@Description **Access:** Server Owner.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body TransferOwnerRequest true "New owner"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Router      /api/admin/owner/transfer [post]
func (h *Handler) AdminTransferOwner(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body TransferOwnerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if !h.confirmPassword(w, actor, body.Password) {
		return
	}
	if body.Confirm != "TRANSFER" {
		writeError(w, http.StatusBadRequest, "admin.errors.confirm_mismatch")
		return
	}
	target, err := h.Store.GetUserByUsername(body.Username)
	if err != nil || target.Status == "deleted" {
		writeError(w, http.StatusNotFound, "admin.errors.user_not_found")
		return
	}
	if target.ID == actor.ID {
		writeError(w, http.StatusBadRequest, "admin.errors.transfer_to_self")
		return
	}
	if err := h.Store.TransferOwnership(actor.ID, target.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "admin.errors.internal")
		return
	}
	h.audit(actor, "owner.transfer", target.Username)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

var _ = store.ErrInviteInvalid
