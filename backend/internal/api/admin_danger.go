package api

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"golang.org/x/crypto/argon2"

	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/models"
)

// backupMagic prefixes every archive so restore can reject foreign files early.
var backupMagic = []byte("COVEBK1")

// BackupRequest asks for an encrypted copy of the server data.
type BackupRequest struct {
	Password   string `json:"password"`
	Passphrase string `json:"passphrase"`
}

// ResetRequest wipes all data except the owner account.
type ResetRequest struct {
	Password string `json:"password"`
	Confirm  string `json:"confirm" example:"RESET"`
}

// DeleteServerRequest wipes everything and stops the server.
type DeleteServerRequest struct {
	Password string `json:"password"`
	Confirm  string `json:"confirm" example:"chat.example.com"`
}

// blobWiper is implemented by storage backends that can drop every blob.
type blobWiper interface{ Wipe() error }

// EncryptBackup seals plain with a key derived from passphrase (Argon2id,
// AES-256-GCM). Layout: magic | salt(16) | nonce(12) | ciphertext. The
// passphrase is independent of the server keys so an archive stays readable
// on a fresh install.
func EncryptBackup(plain []byte, passphrase string) ([]byte, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	gcm, err := backupGCM(passphrase, salt)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := append(append(append([]byte{}, backupMagic...), salt...), nonce...)
	return gcm.Seal(out, nonce, plain, backupMagic), nil
}

// DecryptBackup reverses EncryptBackup; a wrong passphrase or tampering fails.
func DecryptBackup(data []byte, passphrase string) ([]byte, error) {
	hdr := len(backupMagic) + 16 + 12
	if len(data) < hdr || !bytes.Equal(data[:len(backupMagic)], backupMagic) {
		return nil, os.ErrInvalid
	}
	salt := data[len(backupMagic) : len(backupMagic)+16]
	nonce := data[len(backupMagic)+16 : hdr]
	gcm, err := backupGCM(passphrase, salt)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, data[hdr:], backupMagic)
}

func backupGCM(passphrase string, salt []byte) (cipher.AEAD, error) {
	key := argon2.IDKey([]byte(passphrase), salt, 3, 64*1024, 2, 32)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// AdminBackup godoc
//
//	@Summary     Download an encrypted backup
//	@Description Returns a passphrase-encrypted snapshot of the database (messages stay ciphertext). Restore it with the server CLI.
//	@Description **Access:** Server Owner, with their password.
//	@Tags        admin
//	@Accept      json
//	@Produce     application/octet-stream
//	@Security    BearerAuth
//	@Param       body body BackupRequest true "Password and archive passphrase (min 12 chars)"
//	@Success     200 {file} file
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/backup [post]
func (h *Handler) AdminBackup(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body BackupRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if !h.confirmPassword(w, actor, body.Password) {
		return
	}
	if len(body.Passphrase) < 12 {
		writeError(w, http.StatusBadRequest, "admin.errors.passphrase_short")
		return
	}
	var buf bytes.Buffer
	if err := h.Store.Backup(&buf); err != nil {
		logger.Errorf("admin: backup failed: %v", err)
		writeError(w, http.StatusInternalServerError, "admin.errors.backup_failed")
		return
	}
	sealed, err := EncryptBackup(buf.Bytes(), body.Passphrase)
	if err != nil {
		logger.Errorf("admin: backup encryption failed: %v", err)
		writeError(w, http.StatusInternalServerError, "admin.errors.backup_failed")
		return
	}
	h.audit(actor, "backup.download", "")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="cove-`+time.Now().UTC().Format("20060102-150405")+`.cove-backup"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(sealed)
}

// AdminReset godoc
//
//	@Summary     Reset server data
//	@Description Deletes all users except the owner, plus channels, messages, files, invites and sessions. Settings in config.toml are kept. Cannot be undone.
//	@Description **Access:** Server Owner, with their password and the phrase `RESET`.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body ResetRequest true "Confirmation"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/reset [post]
func (h *Handler) AdminReset(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body ResetRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if !h.confirmPassword(w, actor, body.Password) {
		return
	}
	if body.Confirm != "RESET" {
		writeError(w, http.StatusBadRequest, "admin.errors.confirm_mismatch")
		return
	}
	owner := *actor
	owner.ServerRole = models.ServerRoleOwner
	if err := h.Store.ResetKeepOwner(&owner); err != nil {
		logger.Errorf("admin: reset failed: %v", err)
		writeError(w, http.StatusInternalServerError, "admin.errors.reset_failed")
		return
	}
	h.Sessions.DeleteExcept(owner.ID)
	if wp, ok := h.Storage.(blobWiper); ok {
		if err := wp.Wipe(); err != nil {
			logger.Warnf("admin: reset could not wipe uploads: %v", err)
		}
	}
	h.audit(actor, "server.reset", "")
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// AdminDeleteServer godoc
//
//	@Summary     Delete the server
//	@Description Wipes every account, message and upload, then stops the process. Cannot be undone; take a backup first.
//	@Description **Access:** Server Owner, with their password and the server domain typed as confirmation.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body DeleteServerRequest true "Confirmation"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/delete [post]
func (h *Handler) AdminDeleteServer(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body DeleteServerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if !h.confirmPassword(w, actor, body.Password) {
		return
	}
	if h.ServerDomain == "" || body.Confirm != h.ServerDomain {
		writeError(w, http.StatusBadRequest, "admin.errors.confirm_mismatch")
		return
	}
	if err := h.Store.WipeAll(); err != nil {
		logger.Errorf("admin: delete server failed: %v", err)
		writeError(w, http.StatusInternalServerError, "admin.errors.delete_failed")
		return
	}
	if wp, ok := h.Storage.(blobWiper); ok {
		_ = wp.Wipe()
	}
	h.Sessions.DeleteExcept("")
	logger.Warnf("admin: server deleted by %s (%s)", actor.Username, actor.ID)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
	if h.Shutdown != nil {
		// After the response is flushed so the owner sees the confirmation.
		go func() {
			time.Sleep(500 * time.Millisecond)
			h.Shutdown()
		}()
	}
}
