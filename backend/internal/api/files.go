package api

import (
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

	contentType := header.Header.Get("Content-Type")
	isVideo := r.FormValue("is_video") == "true" || strings.HasPrefix(contentType, "video/")

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

	fileID := uuid.New().String()
	storagePath, size, err := h.Storage.Save(fileID, file)
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
	if f.ChannelID != "" && f.OwnerID != session.UserID {
		ch, err := h.Store.GetChannel(f.ChannelID)
		if err == nil && ch.IsPrivate {
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

	if _, ok := h.Storage.(*storage.FileSystemStorage); ok {
		http.ServeFile(w, r, f.StoragePath)
		return
	}

	w.Header().Set("Content-Type", f.MIMEType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", f.SizeBytes))
	io.Copy(w, rc)
}

