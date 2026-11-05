package api

import (
	"errors"
	"mime/multipart"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"io"
	"net/http"
	"os"
	"time"

	"golang.org/x/crypto/argon2"

	"cove/backend/internal/logger"
	"cove/backend/internal/models"
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
	if !decodeJSONLimit(w, r, &body, 1<<12, "admin.errors.invalid_json") {
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
	if !decodeJSONLimit(w, r, &body, 1<<12, "admin.errors.invalid_json") {
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
	if d, ok := h.Hub.(interface{ DisconnectAllExcept(string) }); ok {
		d.DisconnectAllExcept(owner.ID)
	}
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
	if !decodeJSONLimit(w, r, &body, 1<<12, "admin.errors.invalid_json") {
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

// maxRestoreBytes bounds an uploaded backup; the archive is decrypted in memory.
const maxRestoreBytes = 1 << 30

// AdminRestore godoc
//
//	@Summary     Restore a backup
//	@Description Replaces ALL current data with the contents of a backup made by the panel. Everyone is signed out, including the caller. Cannot be undone; take a backup first.
//	@Description The form is read as a stream so the password is checked before the (up to 1 GiB) archive is read:
//	@Description send `password` and `confirm` BEFORE `file`.
//	@Description **Access:** Server Owner, with their password, the archive passphrase and the phrase `RESTORE`.
//	@Tags        admin
//	@Accept      multipart/form-data
//	@Produce     json
//	@Security    BearerAuth
//	@Param       password   formData string true  "Owner password (must precede file)"
//	@Param       confirm    formData string true  "Must be RESTORE (must precede file)"
//	@Param       passphrase formData string true  "Passphrase chosen when the backup was made"
//	@Param       file       formData file   true  "The .cove-backup file (last)"
//	@Success     200 {object} StatusResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/admin/restore [post]
func (h *Handler) AdminRestore(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxRestoreBytes)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_upload")
		return
	}

	// fail maps a read error to 413 (body over the cap) or 400 (anything else malformed).
	fail := func(err error) {
		code := http.StatusBadRequest
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			code = http.StatusRequestEntityTooLarge
		}
		writeError(w, code, "admin.errors.invalid_upload")
	}
	// field reads a small text part.
	field := func(p *multipart.Part) (string, error) {
		b, err := io.ReadAll(io.LimitReader(p, 4096))
		return string(b), err
	}

	var (
		passphrase string
		confirm    string
		sealed     []byte
		verified   bool
	)
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			fail(err)
			return
		}
		switch part.FormName() {
		case "password":
			pw, err := field(part)
			if err != nil {
				fail(err)
				return
			}
			// Decide now, before any further byte of the form is read: a wrong password must not cost the server
			// a gigabyte of upload.
			if status, key := h.checkStepUp(actor, pw); status != 0 {
				writeError(w, status, key)
				return
			}
			verified = true
		case "confirm":
			if confirm, err = field(part); err != nil {
				fail(err)
				return
			}
		case "passphrase":
			if passphrase, err = field(part); err != nil {
				fail(err)
				return
			}
		case "file":
			if !verified {
				// Either no password was sent, or it came after the file; both are refused without reading on.
				if status, key := h.checkStepUp(actor, ""); status != 0 {
					writeError(w, status, key)
				}
				return
			}
			if confirm != "RESTORE" {
				writeError(w, http.StatusBadRequest, "admin.errors.confirm_mismatch")
				return
			}
			if sealed, err = io.ReadAll(part); err != nil {
				fail(err)
				return
			}
		default:
			_, _ = io.Copy(io.Discard, io.LimitReader(part, 4096))
		}
	}
	if !verified {
		if status, key := h.checkStepUp(actor, ""); status != 0 {
			writeError(w, status, key)
		}
		return
	}
	if confirm != "RESTORE" {
		writeError(w, http.StatusBadRequest, "admin.errors.confirm_mismatch")
		return
	}
	if sealed == nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_upload")
		return
	}
	// Decrypt BEFORE touching the database: a wrong passphrase or a damaged
	// file must leave the current data exactly as it was.
	plain, err := DecryptBackup(sealed, passphrase)
	if err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.backup_unreadable")
		return
	}
	if err := h.Store.RestoreReplace(bytes.NewReader(plain)); err != nil {
		logger.Errorf("admin: restore failed: %v", err)
		writeError(w, http.StatusInternalServerError, "admin.errors.restore_failed")
		return
	}
	h.Sessions.DeleteExcept("")
	if d, ok := h.Hub.(interface{ DisconnectAllExcept(string) }); ok {
		d.DisconnectAllExcept("")
	}
	h.audit(actor, "server.restore", "")
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}
