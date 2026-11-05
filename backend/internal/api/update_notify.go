package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/update"
)

// maxNoticeNotes caps the release notes quoted in the admin message.
const maxNoticeNotes = 400

// updateAdminLink is where admins land to install: the web client opens Settings > Admin when it sees ?settings=admin.
func (h *Handler) updateAdminLink() string {
	base := strings.TrimRight(h.FrontendOrigin, "/")
	if base == "" {
		base = "https://" + FormatServerLabel(h.ServerDomain)
	}
	return base + "/?settings=admin"
}

// formatUpdateNotice is the message the Cove account sends to admins about a new release.
func (h *Handler) formatUpdateNotice(info UpdateInfoResponse) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Cove %s is available (this server runs %s).", info.LatestVersion, info.CurrentVersion)
	if notes := strings.TrimSpace(info.ReleaseNotes); notes != "" {
		r := []rune(notes)
		if len(r) > maxNoticeNotes {
			notes = string(r[:maxNoticeNotes]) + "…"
		}
		b.WriteString("\n\nWhat's new:\n" + notes)
	}
	b.WriteString("\n\nOpen Settings → Admin → Overview → Server update to install it: " + h.updateAdminLink())
	return b.String()
}

// NotifyAdminsOfUpdate checks for a newer release and, if the owner and admins have not been told about that
// version yet, messages each of them from the Cove account. Regular users are never contacted. The last announced
// version is stored in the database, so a restart or a second server process does not repeat the message.
//
// Returns the number of admins messaged (0 when there was nothing new or notifications are off).
func (h *Handler) NotifyAdminsOfUpdate(ctx context.Context) (int, error) {
	if h.Updater == nil || !h.NotifyUpdates {
		return 0, nil
	}
	info := h.Updater.info(ctx, false)
	if !info.UpdateAvailable || info.LatestVersion == "" {
		return 0, nil
	}
	last, err := h.Store.LastNotifiedUpdate()
	if err != nil {
		return 0, fmt.Errorf("read last notified update: %w", err)
	}
	if last != "" {
		if c, cerr := update.CompareVersions(info.LatestVersion, last); cerr == nil && c <= 0 {
			return 0, nil
		}
	}
	admins, err := h.Store.ListAdmins()
	if err != nil {
		return 0, fmt.Errorf("list admins: %w", err)
	}
	text := h.formatUpdateNotice(info)
	sent := 0
	for _, a := range admins {
		if a.Status == "deleted" || !models.IsServerAdmin(a.ServerRole) {
			continue
		}
		if err := h.notifyUser(a.ID, text); err != nil {
			logger.Warnf("admin: update notice to user %s: %v", a.ID, err)
			continue
		}
		sent++
	}
	if sent > 0 {
		if err := h.Store.SetLastNotifiedUpdate(info.LatestVersion); err != nil {
			return sent, fmt.Errorf("remember notified update: %w", err)
		}
		logger.Infof("admin: told %d admin(s) that Cove %s is available", sent, info.LatestVersion)
	}
	return sent, nil
}

// RunUpdateNotifier checks for releases after firstDelay and then every interval until ctx ends. It is the only
// goroutine the feature starts; main cancels ctx during graceful shutdown and waits on done.
func (h *Handler) RunUpdateNotifier(ctx context.Context, firstDelay, interval time.Duration) {
	timer := time.NewTimer(firstDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			cctx, cancel := context.WithTimeout(ctx, updateCheckTimeout)
			if _, err := h.NotifyAdminsOfUpdate(cctx); err != nil {
				logger.Warnf("admin: update notifier: %v", err)
			}
			cancel()
			timer.Reset(interval)
		}
	}
}
