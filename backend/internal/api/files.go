package api

import (
	"bytes"
	"context"
	"errors"
	"time"
	"cove/backend/internal/auth"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/storage"
	"encoding/base64"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// ---- Files ----------------------------------------------------------------- //

// allowedUploadMIMETypes restricts what a stored file can be labeled as,
// regardless of what the uploader claims via the multipart Content-Type
// header. The actual bytes are sniffed with http.DetectContentType and
// checked against this allowlist so a malicious upload can't be served
// back and browser-sniffed as text/html (stored XSS) or another active
// content type. E2E-encrypted attachment ciphertext is opaque binary and
// falls back to application/octet-stream, which is on the allowlist.
var allowedUploadMIMETypes = map[string]bool{
	"application/octet-stream": true,
	"image/jpeg":               true,
	"image/png":                true,
	"image/gif":                true,
	"image/webp":               true,
	"image/svg+xml":            false, // explicitly excluded: can carry inline <script>
	"video/mp4":                true,
	"video/webm":               true,
	"video/quicktime":          true,
	"audio/mpeg":               true,
	"audio/ogg":                true,
	"audio/wav":                true,
	"audio/webm":               true,
	"application/pdf":          true,
}

// sniffUploadContentType detects the real content type from the file's
// leading bytes and returns it alongside a reader that replays those bytes
// so the full stream can still be saved. If the sniffed type isn't on the
// allowlist, it's downgraded to application/octet-stream.
func sniffUploadContentType(file io.Reader) (string, io.Reader, error) {
	head := make([]byte, 512)
	n, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", nil, err
	}
	head = head[:n]
	sniffed := http.DetectContentType(head)
	if idx := strings.IndexByte(sniffed, ';'); idx != -1 {
		sniffed = sniffed[:idx]
	}
	if !allowedUploadMIMETypes[sniffed] {
		sniffed = "application/octet-stream"
	}
	return sniffed, io.MultiReader(bytes.NewReader(head), file), nil
}

const (
	// ffmpegTimeout bounds one transcode (and one probe): a corrupt or hostile video must not pin a CPU forever.
	ffmpegTimeout = 10 * time.Minute
	// ffprobeTimeout bounds the duration probe that runs inside the upload request.
	ffprobeTimeout = 15 * time.Second
	// maxConcurrentTranscodes limits parallel ffmpeg processes so a burst of video uploads cannot exhaust the host.
	maxConcurrentTranscodes = 2
)

// transcodeSlots is a counting semaphore for ffmpeg. It is process-local runtime state with no persistent
// counterpart: the pending work itself is recorded on each file (processing_status), only the throttle is in RAM.
var transcodeSlots = make(chan struct{}, maxConcurrentTranscodes)

func getVideoDuration(path string) (float64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), ffprobeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path)
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	var d float64
	_, err = fmt.Sscanf(strings.TrimSpace(string(out)), "%f", &d)
	return d, err
}

// UploadFile godoc
//
//	@Summary     Upload an encrypted file or video message
//	@Description Multipart form: `file` (required), `channel_id` (optional; the caller must be an active member), `is_video`
//	@Description (`true` for video messages, which are probed and transcoded in the background), `thumb_ciphertext` and
//	@Description `thumb_nonce` (base64, optional). The stored content type is sniffed from the bytes, never taken from
//	@Description the client. The response never contains the server-side storage path.
//	@Description **Access:** Authenticated (channel uploads: Channel Member).
//	@Tags        files
//	@Accept      multipart/form-data
//	@Produce     json
//	@Security    BearerAuth
//	@Param       file             formData file   true  "The (already encrypted) file"
//	@Param       channel_id       formData string false "Channel the file belongs to"
//	@Param       is_video         formData bool   false "Treat the upload as a video message"
//	@Param       thumb_ciphertext formData string false "Base64 encrypted thumbnail"
//	@Param       thumb_nonce      formData string false "Base64 thumbnail nonce"
//	@Success     201 {object} UploadFileResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     413 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/files [post]
func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())

	// Limit upload size
	maxFileMB, _, _ := h.limits()
	maxBytes := int64(maxFileMB) << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	if err := r.ParseMultipartForm(maxBytes); err != nil {
		// Only a body over the limit is "too large"; a malformed form is the client's mistake, not a size problem.
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("file too large (max %dMB)", maxFileMB))
			return
		}
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	channelID := r.FormValue("channel_id")
	if channelID != "" {
		// A kicked or departed member keeps a membership record, so the status must be checked, not just its presence.
		if uc, err := h.Store.GetUserChannel(session.UserID, channelID); err != nil || uc.Status != models.StatusActive {
			writeError(w, http.StatusForbidden, "not a member of this channel")
			return
		}
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file in multipart form")
		return
	}
	defer file.Close()

	claimedContentType := header.Header.Get("Content-Type")
	isVideo := r.FormValue("is_video") == "true" || strings.HasPrefix(claimedContentType, "video/")

	// Pre-check video size limit
	_, maxVideoSize, _ := h.limits()
	if maxVideoSize <= 0 {
		maxVideoSize = 50
	}
	maxVideoBytes := int64(maxVideoSize) << 20
	if isVideo && header.Size > maxVideoBytes {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("video message exceeds maximum allowed size of %dMB", maxVideoSize))
		return
	}

	// Never trust the client-supplied Content-Type for what gets stored and
	// later served back — sniff the real bytes so a malicious upload can't
	// be mislabeled and browser-sniffed into an active content type (XSS)
	// on download.
	contentType, sniffedReader, err := sniffUploadContentType(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read uploaded file")
		return
	}

	fileID := uuid.New().String()
	storagePath, size, err := h.Storage.Save(fileID, sniffedReader)
	if err != nil {
		writeInternal(w, "save upload", err, "failed to save file")
		return
	}

	_, _, maxDuration := h.limits()
	if maxDuration <= 0 {
		maxDuration = 60
	}

	var durationSec float64
	processingStatus := "ready"

	if isVideo {
		// Inspect duration with ffprobe if file system storage
		if d, err := getVideoDuration(storagePath); err == nil && d > 0 {
			durationSec = d
			if d > float64(maxDuration) {
				_ = os.Remove(storagePath)
				writeError(w, http.StatusBadRequest, fmt.Sprintf("video message duration (%.1fs) exceeds limit of %d seconds", d, maxDuration))
				return
			}
		}
		processingStatus = "processing"
	}

	thumbCipher, _ := base64.StdEncoding.DecodeString(r.FormValue("thumb_ciphertext"))
	thumbNonce, _ := base64.StdEncoding.DecodeString(r.FormValue("thumb_nonce"))

	f, err := h.Store.RegisterFile(session.UserID, channelID, contentType, storagePath, size, thumbCipher, thumbNonce)
	if err != nil {
		// The blob was already written to disk; without this it's orphaned
		// forever with no DB record pointing to it.
		_ = h.Storage.Delete(storagePath)
		writeInternal(w, "register file", err, "failed to register file metadata")
		return
	}

	f.DurationSec = durationSec
	f.ProcessingStatus = processingStatus
	if err := h.Store.UpdateFile(f); err != nil {
		logger.Warnf("api: upload %s: could not store duration/status: %v", f.ID, err)
	}

	if isVideo {
		go h.transcodeVideo(f)
	}

	writeJSON(w, http.StatusCreated, newUploadFileResponse(f))
}

// transcodeVideo re-encodes an uploaded video to web-friendly MP4 in the background. At most
// maxConcurrentTranscodes run at once (the rest wait their turn, their files stay "processing"), each is killed after
// ffmpegTimeout, and on any failure the original is served unchanged.
func (h *Handler) transcodeVideo(targetFile *models.File) {
	transcodeSlots <- struct{}{}
	defer func() { <-transcodeSlots }()

	ffmpegBin := h.FFmpegPath
	if ffmpegBin == "" {
		ffmpegBin = "ffmpeg"
	}
	ctx, cancel := context.WithTimeout(context.Background(), ffmpegTimeout)
	defer cancel()

	outputPath := targetFile.StoragePath + ".transcoded.mp4"
	cmd := exec.CommandContext(ctx, ffmpegBin, "-y", "-i", targetFile.StoragePath, "-c:v", "libx264", "-preset", "fast", "-crf", "28", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath)
	if err := cmd.Run(); err == nil {
		if fi, err := os.Stat(outputPath); err == nil {
			_ = os.Rename(outputPath, targetFile.StoragePath)
			targetFile.SizeBytes = fi.Size()
			targetFile.MIMEType = "video/mp4"
		} else {
			// ffmpeg reported success but the output it should have
			// produced isn't there — don't silently mark this "ready"
			// as if the transcode happened (it didn't touch
			// StoragePath), and don't leak whatever partial file may
			// still be at outputPath.
			logger.Warnf("ffmpeg transcode for %s: output missing after supposed success: %v (serving original)", targetFile.ID, err)
			_ = os.Remove(outputPath)
		}
	} else {
		logger.Warnf("ffmpeg transcode for %s: %v (serving original)", targetFile.ID, err)
		_ = os.Remove(outputPath)
	}
	targetFile.ProcessingStatus = "ready"
	if err := h.Store.UpdateFile(targetFile); err != nil {
		logger.Warnf("api: transcode %s: could not store final status: %v", targetFile.ID, err)
	}
	if h.Hub != nil {
		h.Hub.BroadcastVideoReady(targetFile.ID, targetFile.ChannelID)
	}
}

// DownloadFile godoc
//
//	@Summary     Download a stored file
//	@Description Returns the raw (still encrypted) bytes with the stored content type, always as an attachment. Files that
//	@Description belong to a private channel are only served to its members; files without a channel (avatars) to any
//	@Description signed-in user.
//	@Description **Access:** Authenticated (files of private channels: Channel Member).
//	@Tags        files
//	@Produce     application/octet-stream
//	@Security    BearerAuth
//	@Param       id path string true "File ID"
//	@Success     200 {file} file
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Failure     500 {object} ErrorResponse
//	@Router      /api/files/{id} [get]
func (h *Handler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())
	fileID := r.PathValue("id")
	f, err := h.Store.GetFile(fileID)
	if err != nil {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	// Files with no channel (e.g. user avatars) are visible to any authenticated user.
	// For channel-scoped attachments: if channel is private, verify membership.
	// Fails CLOSED — if the channel lookup errors (e.g. the channel was
	// deleted but its file records weren't purged), we must not skip the
	// membership check, since that would let anyone with the file's UUID
	// read a formerly-private attachment.
	if f.ChannelID != "" && f.OwnerID != session.UserID {
		ch, err := h.Store.GetChannel(f.ChannelID)
		if err != nil {
			writeError(w, http.StatusForbidden, "not authorized to access this file")
			return
		}
		if ch.IsPrivate {
			if uc, err := h.Store.GetUserChannel(session.UserID, f.ChannelID); err != nil || uc.Status != models.StatusActive {
				writeError(w, http.StatusForbidden, "not authorized to access this file")
				return
			}
		}
	}

	rc, err := h.Storage.Open(f.StoragePath)
	if err != nil {
		writeInternal(w, "open file "+f.ID, err, "failed to open file storage")
		return
	}
	defer rc.Close()

	// Force the browser to trust our declared Content-Type instead of
	// sniffing the bytes, and never render a fetched file inline as a
	// top-level document — both are required to prevent a malicious upload
	// from being interpreted as HTML/script (stored XSS) when downloaded.
	// Setting Content-Type before ServeFile also stops it from sniffing the
	// file's on-disk bytes itself (it only sniffs when the header is unset).
	w.Header().Set("Content-Type", f.MIMEType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "attachment")

	if _, ok := h.Storage.(*storage.FileSystemStorage); ok {
		http.ServeFile(w, r, f.StoragePath)
		return
	}

	w.Header().Set("Content-Length", fmt.Sprintf("%d", f.SizeBytes))
	// A client that disconnects mid-download is expected; there is nobody left to report the error to.
	_, _ = io.Copy(w, rc)
}
