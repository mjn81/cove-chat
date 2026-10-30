//go:build windows

package tray

// platformAvailable: the Windows notification area is always present.
func platformAvailable() bool { return true }
