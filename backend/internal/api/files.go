package api

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/storage"
	"github.com/google/uuid"
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

func getVideoDuration(path string) (float64, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path)
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	var d float64
	_, err = fmt.Sscanf(strings.TrimSpace(string(out)), "%f", &d)
	return d, err
}

// UploadFile handles encrypted binary uploads and video messages.
func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	session := auth.SessionFromContext(r.Context())

	// Limit upload size
	maxBytes := int64(h.MaxFileSizeMB) << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("file too large (max %dMB)", h.MaxFileSizeMB))
		return
	}

	channelID := r.FormValue("channel_id")
	if channelID != "" {
		if _, err := h.Store.GetUserChannel(session.UserID, channelID); err != nil {
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
	maxVideoSize := h.MaxVideoSizeMB
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
		writeError(w, http.StatusInternalServerError, "failed to save file")
		return
	}

	maxDuration := h.MaxVideoDurationSec
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
		writeError(w, http.StatusInternalServerError, "failed to register file metadata")
		return
	}

	f.DurationSec = durationSec
	f.ProcessingStatus = processingStatus
	_ = h.Store.UpdateFile(f)

	if isVideo {
		// Launch background transcoding
		go func(targetFile *models.File) {
			ffmpegBin := h.FFmpegPath
			if ffmpegBin == "" {
				ffmpegBin = "ffmpeg"
			}
			outputPath := targetFile.StoragePath + ".transcoded.mp4"
			cmd := exec.Command(ffmpegBin, "-y", "-i", targetFile.StoragePath, "-c:v", "libx264", "-preset", "fast", "-crf", "28", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath)
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
			_ = h.Store.UpdateFile(targetFile)
			if h.Hub != nil {
				h.Hub.BroadcastVideoReady(targetFile.ID, targetFile.ChannelID)
			}
		}(f)
	}

	writeJSON(w, http.StatusCreated, f)
}

// DownloadFile retrieves raw binary or encrypted bytes.
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
			if _, err := h.Store.GetUserChannel(session.UserID, f.ChannelID); err != nil {
				writeError(w, http.StatusForbidden, "not authorized to access this file")
				return
			}
		}
	}

	rc, err := h.Storage.Open(f.StoragePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open file storage")
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
	io.Copy(w, rc)
}

