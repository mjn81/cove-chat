package api

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"cove/backend/internal/logger"
	"cove/update"
)

// maxUploadFieldBytes bounds the small text parts of the upload form (version, sha256, SHA256SUMS).
const maxUploadFieldBytes = 64 << 10

// stagedUpload is a manually uploaded release waiting for the owner to apply it. It is ephemeral on purpose: it is
// a temp file whose only consumer is the apply step of this same process, and it is worthless after a restart.
type stagedUpload struct {
	version  string
	sha256   string
	kind     string // "zip" or "binary"
	path     string
	verified bool
	size     int64
}

// sniffBinary reads the platform an executable was built for from its header, without running it. It understands
// ELF (Linux), PE (Windows) and Mach-O (macOS, including universal binaries, reported with an empty arch).
func sniffBinary(head []byte) (goos, goarch string, ok bool) {
	switch {
	case len(head) >= 20 && string(head[:4]) == "\x7fELF":
		machine := binary.LittleEndian.Uint16(head[18:20])
		if head[5] == 2 { // big-endian ELF
			machine = binary.BigEndian.Uint16(head[18:20])
		}
		switch machine {
		case 0x3e:
			return "linux", "amd64", true
		case 0xb7:
			return "linux", "arm64", true
		}
		return "linux", "other", true
	case len(head) >= 0x40 && head[0] == 'M' && head[1] == 'Z':
		off := int(binary.LittleEndian.Uint32(head[0x3c:0x40]))
		if off < 0 || off+6 > len(head) || string(head[off:off+4]) != "PE\x00\x00" {
			return "", "", false
		}
		switch binary.LittleEndian.Uint16(head[off+4 : off+6]) {
		case 0x8664:
			return "windows", "amd64", true
		case 0xaa64:
			return "windows", "arm64", true
		}
		return "windows", "other", true
	case len(head) >= 8 && (string(head[:4]) == "\xcf\xfa\xed\xfe" || string(head[:4]) == "\xce\xfa\xed\xfe"):
		switch binary.LittleEndian.Uint32(head[4:8]) {
		case 0x01000007:
			return "darwin", "amd64", true
		case 0x0100000c:
			return "darwin", "arm64", true
		}
		return "darwin", "other", true
	case len(head) >= 4 && string(head[:4]) == "\xca\xfe\xba\xbe":
		return "darwin", "", true // universal binary: contains every architecture
	}
	return "", "", false
}

func isZip(head []byte) bool { return len(head) >= 4 && string(head[:4]) == "PK\x03\x04" }

// removeUpload deletes a staged upload's file.
func (s *stagedUpload) remove() {
	if s != nil && s.path != "" {
		_ = os.RemoveAll(filepath.Dir(s.path))
	}
}

// uploadForm is what the multipart request carried.
type uploadForm struct {
	version, sha256, sums string
	filename, path        string
	size                  int64
	sum                   string // sha-256 of the file as received
}

// readUploadForm streams the multipart body to disk. The file part is never held in memory: it goes through a
// size-capped copy into a private temp directory while being hashed. Text parts are bounded to 64 KiB.
//
// Returns an HTTP status and error key on failure (413 for oversize).
func (u *Updater) readUploadForm(mr *multipart.Reader) (*uploadForm, int, string) {
	f := &uploadForm{}
	dir, err := os.MkdirTemp("", "cove-upload-")
	if err != nil {
		logger.Errorf("admin: upload temp dir: %v", err)
		return nil, http.StatusInternalServerError, "admin.errors.update_failed"
	}
	fail := func(code int, key string) (*uploadForm, int, string) {
		_ = os.RemoveAll(dir)
		return nil, code, key
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				return fail(http.StatusRequestEntityTooLarge, "admin.errors.update_upload_too_large")
			}
			return fail(http.StatusBadRequest, "admin.errors.invalid_upload")
		}
		switch part.FormName() {
		case "file":
			if f.path != "" {
				return fail(http.StatusBadRequest, "admin.errors.invalid_upload")
			}
			f.filename = filepath.Base(part.FileName())
			f.path = filepath.Join(dir, "upload.bin")
			out, err := os.OpenFile(f.path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				return fail(http.StatusInternalServerError, "admin.errors.update_failed")
			}
			h := sha256.New()
			n, cerr := io.Copy(io.MultiWriter(out, h), io.LimitReader(part, u.MaxDownload+1))
			if clerr := out.Close(); cerr == nil {
				cerr = clerr
			}
			if cerr != nil {
				var tooBig *http.MaxBytesError
				if errors.As(cerr, &tooBig) {
					return fail(http.StatusRequestEntityTooLarge, "admin.errors.update_upload_too_large")
				}
				return fail(http.StatusBadRequest, "admin.errors.invalid_upload")
			}
			if n > u.MaxDownload {
				return fail(http.StatusRequestEntityTooLarge, "admin.errors.update_upload_too_large")
			}
			f.size, f.sum = n, hex.EncodeToString(h.Sum(nil))
		case "version", "sha256", "sums":
			b, err := io.ReadAll(io.LimitReader(part, maxUploadFieldBytes+1))
			if err != nil || len(b) > maxUploadFieldBytes {
				return fail(http.StatusBadRequest, "admin.errors.invalid_upload")
			}
			switch part.FormName() {
			case "version":
				f.version = strings.TrimSpace(string(b))
			case "sha256":
				f.sha256 = strings.TrimSpace(string(b))
			default:
				f.sums = string(b)
			}
		default:
			_, _ = io.Copy(io.Discard, io.LimitReader(part, maxUploadFieldBytes))
		}
	}
	if f.path == "" {
		return fail(http.StatusBadRequest, "admin.errors.invalid_upload")
	}
	return f, 0, ""
}

// stageUpload validates a received form against this platform and, if everything holds, makes it the staged
// upload. Nothing from the file is executed: the version comes from the form, the platform from the zip's entry
// name or the executable header, and integrity from the supplied checksum.
//
// Returns the staged upload, or an HTTP status and error key. The temp file is deleted on every failure.
func (u *Updater) stageUpload(f *uploadForm) (*stagedUpload, int, string) {
	fail := func(code int, key string) (*stagedUpload, int, string) {
		_ = os.RemoveAll(filepath.Dir(f.path))
		return nil, code, key
	}
	zipName, entry, ok := update.ServerAsset(u.GOOS, u.GOARCH)
	if !ok {
		return fail(http.StatusConflict, "admin.errors.update_unsupported")
	}
	ver, err := update.ParseVersion(f.version)
	if err != nil {
		return fail(http.StatusBadRequest, "admin.errors.update_upload_version")
	}
	if c, cerr := update.CompareVersions(ver.String(), u.Current); cerr != nil || c <= 0 {
		return fail(http.StatusConflict, "admin.errors.update_up_to_date")
	}

	head := make([]byte, 4096)
	fh, err := os.Open(f.path)
	if err != nil {
		return fail(http.StatusInternalServerError, "admin.errors.update_failed")
	}
	n, _ := io.ReadFull(fh, head)
	_ = fh.Close()
	head = head[:n]

	kind := "binary"
	if isZip(head) {
		kind = "zip"
		if code, key := u.checkZip(f.path, entry); key != "" {
			return fail(code, key)
		}
	} else {
		goos, goarch, known := sniffBinary(head)
		if !known {
			return fail(http.StatusBadRequest, "admin.errors.update_upload_invalid")
		}
		if goos != u.GOOS || (goarch != "" && goarch != u.GOARCH) {
			return fail(http.StatusBadRequest, "admin.errors.update_upload_wrong_platform")
		}
	}

	want := strings.ToLower(f.sha256)
	if want == "" && f.sums != "" {
		sums, perr := update.ParseChecksums(strings.NewReader(f.sums))
		if perr != nil {
			return fail(http.StatusBadRequest, "admin.errors.update_no_checksums")
		}
		for _, name := range []string{f.filename, zipName, entry} {
			if d, found := sums[name]; found {
				want = d
				break
			}
		}
		if want == "" {
			return fail(http.StatusBadRequest, "admin.errors.update_no_checksums")
		}
	}
	verified := false
	if want != "" {
		if len(want) != 64 || !update.DigestEqual(want, f.sum) {
			return fail(http.StatusBadRequest, "admin.errors.update_checksum_failed")
		}
		verified = true
	}

	return &stagedUpload{version: ver.String(), sha256: f.sum, kind: kind, path: f.path, verified: verified, size: f.size}, 0, ""
}

// checkZip requires the archive to hold exactly one regular file: the binary for this platform.
func (u *Updater) checkZip(path, entry string) (int, string) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return http.StatusBadRequest, "admin.errors.update_upload_invalid"
	}
	defer func() { _ = zr.Close() }()
	if len(zr.File) != 1 {
		return http.StatusBadRequest, "admin.errors.update_upload_invalid"
	}
	f := zr.File[0]
	if f.Name != entry {
		if strings.HasPrefix(f.Name, "cove-server-") {
			return http.StatusBadRequest, "admin.errors.update_upload_wrong_platform"
		}
		return http.StatusBadRequest, "admin.errors.update_upload_invalid"
	}
	if !f.Mode().IsRegular() || int64(f.UncompressedSize64) > u.MaxDownload*2 {
		return http.StatusBadRequest, "admin.errors.update_upload_invalid"
	}
	return 0, ""
}

// runUpload applies the staged upload: same swap, rollback copy and restart as a downloaded release.
func (u *Updater) runUpload(up *stagedUpload, entry string, audit func(action, target string)) {
	defer func() {
		u.mu.Lock()
		if u.uploaded == up {
			u.uploaded = nil
		}
		u.mu.Unlock()
	}()
	if up.kind == "zip" {
		u.install(up.version, up.path, entry, audit)
		return
	}
	newPath := u.ExePath + update.NewSuffix
	if err := copyExecutable(up.path, newPath); err != nil {
		_ = os.Remove(newPath)
		logger.Errorf("admin: update copy uploaded binary: %v", err)
		u.fail(up.version, "admin.errors.update_failed", audit)
		return
	}
	u.swap(up.version, newPath, audit)
}

func copyExecutable(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return err
}

// AdminUploadUpdate godoc
//
//	@Summary     Upload a server release manually
//	@Description For non-Docker installs without internet access (air-gapped): upload the `cove-server-<os>-<arch>.zip` from a release, or the plain binary, together with its version and optionally its SHA-256 (or the release's SHA256SUMS). The file is streamed to disk (never held in memory), must contain exactly the binary for this platform, and is checked against the checksum when one is given. Nothing is executed. Apply it afterwards with `POST /api/admin/update` and `{"source":"upload"}`. Docker installs are refused: pull the new image instead.
//	@Description **Access:** Server Owner.
//	@Tags        admin
//	@Accept      multipart/form-data
//	@Produce     json
//	@Security    BearerAuth
//	@Param       file    formData file   true  "Release zip or plain server binary"
//	@Param       version formData string true  "Version of the uploaded release, e.g. 0.10.0"
//	@Param       sha256  formData string false "Expected SHA-256 of the uploaded file (hex)"
//	@Param       sums    formData string false "Contents of the release's SHA256SUMS file"
//	@Success     200 {object} UpdateUploadResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     501 {object} ErrorResponse
//	@Router      /api/admin/update/upload [post]
func (h *Handler) AdminUploadUpdate(w http.ResponseWriter, r *http.Request) {
	u := h.Updater
	if u == nil {
		writeError(w, http.StatusNotImplemented, "admin.errors.update_unsupported")
		return
	}
	switch u.Mode {
	case update.ModeDocker:
		writeError(w, http.StatusConflict, "admin.errors.update_docker")
		return
	case update.ModeBinary:
	default:
		writeError(w, http.StatusConflict, "admin.errors.update_unsupported")
		return
	}
	u.mu.Lock()
	busy := u.job.state == UpdateStateDownloading || u.job.state == UpdateStateInstalling || u.job.state == UpdateStateRestarting
	u.mu.Unlock()
	if busy {
		writeError(w, http.StatusConflict, "admin.errors.update_in_progress")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, u.MaxDownload+maxUploadFieldBytes*4)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_upload")
		return
	}
	form, code, key := u.readUploadForm(mr)
	if key != "" {
		writeError(w, code, key)
		return
	}
	up, code, key := u.stageUpload(form)
	if key != "" {
		writeError(w, code, key)
		return
	}

	u.mu.Lock()
	old := u.uploaded
	u.uploaded = up
	u.mu.Unlock()
	old.remove()

	h.audit(adminActor(r), "server.update.upload", up.version)
	writeJSON(w, http.StatusOK, UpdateUploadResponse{Status: "success", Upload: UpdateUploadInfo{
		Version: up.version, Verified: up.verified, SHA256: up.sha256, Kind: up.kind, SizeBytes: up.size,
	}})
}
