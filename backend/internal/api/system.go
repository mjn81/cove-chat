package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"cove/backend/internal/auth"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/backend/internal/store"
)

// messageBroadcaster is implemented by the WebSocket hub so a message authored by the server reaches online
// devices live. Optional, like sessionDisconnecter.
type messageBroadcaster interface {
	BroadcastMessage(msg *models.Message)
}

// maxNoticeLen bounds an owner announcement.
const maxNoticeLen = 2000

// noticeWorkers bounds concurrent deliveries when fanning an announcement out to every user.
const noticeWorkers = 8

// FormatServerLabel turns the configured server.domain into the short label shown next to "Cove" so users can
// tell which server a notice came from: lowercase host, no scheme or path, default ports dropped, and
// "localhost" when nothing is configured.
func FormatServerLabel(domain string) string {
	d := strings.ToLower(strings.TrimSpace(domain))
	scheme := ""
	if i := strings.Index(d, "://"); i >= 0 {
		scheme, d = d[:i], d[i+3:]
	}
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	if host, port, err := net.SplitHostPort(d); err == nil {
		if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
			d = host
			if strings.Contains(host, ":") {
				d = "[" + host + "]"
			}
		}
	}
	if d == "" {
		return "localhost"
	}
	return d
}

// systemDisplayName is the name of the Cove account on this server, e.g. "Cove · chat.example.com".
func (h *Handler) systemDisplayName() string {
	return "Cove · " + FormatServerLabel(h.ServerDomain)
}

// notifyUser posts text to userID's Cove chat and pushes it to their online devices.
func (h *Handler) notifyUser(userID, text string) error {
	msg, ch, created, err := h.Store.PostSystemMessage(userID, text, h.KEK)
	if err != nil {
		return err
	}
	if h.Hub == nil {
		return nil
	}
	if created {
		h.Hub.BroadcastChannelCreated(ch)
	}
	if b, ok := h.Hub.(messageBroadcaster); ok {
		b.BroadcastMessage(msg)
	}
	return nil
}

// FormatLoginNotice is the text the Cove account sends after a sign-in from a new device.
func FormatLoginNotice(meta auth.SessionMeta, at time.Time) string {
	where := "Unknown"
	switch {
	case meta.City != "" && meta.Country != "":
		where = meta.City + ", " + meta.Country
	case meta.Country != "":
		where = meta.Country
	}
	device := meta.DeviceName
	if device == "" {
		device = "Unknown device"
	}
	if meta.AppName != "" && meta.AppName != device {
		device += " (" + meta.AppName + ")"
	}
	return fmt.Sprintf("New login to your account\n\nDevice: %s\nIP address: %s\nLocation: %s\nTime: %s UTC\n\n"+
		"If this wasn't you, open Settings → Privacy → Devices, terminate that session and change your password.",
		device, meta.IP, where, at.UTC().Format("2006-01-02 15:04"))
}

// recordLogin remembers the signing-in device and, when it is new to this account, sends the login notice.
// It never fails the login: problems are only logged.
func (h *Handler) recordLogin(userID string, meta auth.SessionMeta) {
	fp := store.DeviceFingerprint(meta.DeviceName, meta.AppName, meta.Platform)
	known, first, err := h.Store.RecordDevice(userID, fp)
	if err != nil {
		logger.Warnf("api: record device for user %s: %v", userID, err)
		return
	}
	// A brand-new account has nothing to be warned about, and a known device is not news.
	if known || first || !h.LoginNotifications {
		return
	}
	if err := h.notifyUser(userID, FormatLoginNotice(meta, time.Now())); err != nil {
		logger.Warnf("api: login notice for user %s: %v", userID, err)
	}
}

// NoticeRequest is the body of an owner announcement.
type NoticeRequest struct {
	Text string `json:"text" example:"Scheduled maintenance tonight at 22:00 UTC."`
}

// NoticeResponse reports how many users an announcement reached.
type NoticeResponse struct {
	Recipients int `json:"recipients"`
	Failed     int `json:"failed"`
}

// AdminSendNotice godoc
//
//	@Summary     Send a server-wide notice
//	@Description Delivers a message from the server's Cove account to the Cove chat of every user.
//	@Description **Access:** Server Owner.
//	@Tags        admin
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body NoticeRequest true "Notice text (1-2000 characters)"
//	@Success     200 {object} NoticeResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/admin/notices [post]
func (h *Handler) AdminSendNotice(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	var body NoticeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" || len([]rune(text)) > maxNoticeLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("notice must be 1-%d characters", maxNoticeLen))
		return
	}
	users, err := h.Store.ListAllUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	var (
		wg         sync.WaitGroup
		mu         sync.Mutex
		recipients int
		failed     int
		sem        = make(chan struct{}, noticeWorkers)
	)
	for _, u := range users {
		if u.Status == "deleted" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(id string) {
			defer wg.Done()
			defer func() { <-sem }()
			err := h.notifyUser(id, text)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed++
				logger.Warnf("api: server notice to user %s: %v", id, err)
				return
			}
			recipients++
		}(u.ID)
	}
	wg.Wait()

	h.audit(actor, "notice.send", fmt.Sprintf("%d recipients", recipients))
	writeJSON(w, http.StatusOK, NoticeResponse{Recipients: recipients, Failed: failed})
}
