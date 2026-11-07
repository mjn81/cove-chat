package api

import (
	"fmt"
	"path/filepath"
	"strings"

	"cove/backend/internal/db"
	"cove/backend/internal/logger"
)

// formatDatabaseRepairNotice is the message the Cove account sends to admins after the server repaired its own
// database while starting. It names the files and the backup folder so an admin can act on it, and says plainly
// that some recent data may be gone.
func formatDatabaseRepairNotice(report db.RepairReport) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Cove found damaged database file(s) while starting (%s) and repaired them automatically, so the server kept running.",
		strings.Join(report.Removed, ", "))
	b.WriteString("\n\nThis usually follows a power loss or a killed process. Records that only existed in those files, typically the most recent changes, are lost; everything else is intact.")
	if report.BackupDir != "" {
		fmt.Fprintf(&b, "\n\nA copy of the original database was kept as %q next to the database folder. You can delete it once you are sure you no longer need it.", filepath.Base(report.BackupDir))
	}
	b.WriteString("\n\nIf you have an admin backup, you can restore it with \"cove-server restore <file> --force\" to bring older records back.")
	return b.String()
}

// NotifyAdminsOfDatabaseRepair tells the owner and admins, from the Cove account, that the database was repaired
// at start-up. It does nothing for an empty report. Returns the number of admins messaged.
func (h *Handler) NotifyAdminsOfDatabaseRepair(report db.RepairReport) (int, error) {
	if len(report.Removed) == 0 {
		return 0, nil
	}
	sent, err := h.notifyAdmins(formatDatabaseRepairNotice(report))
	if err != nil {
		return 0, err
	}
	logger.Infof("admin: told %d admin(s) that the database was repaired", sent)
	return sent, nil
}
