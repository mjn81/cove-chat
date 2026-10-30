//go:build windows

package tray

import (
	"fyne.io/systray"
	"syscall"

	"golang.org/x/sys/windows"
)

// platformAvailable: the Windows notification area is always present.
func platformAvailable() bool { return true }

// prepareMenuTheme makes the tray's pop-up menu follow the system light/dark theme (dark surface, rounded corners
// on Windows 11) instead of the always-light classic menu. It uses the undocumented uxtheme ordinals every
// dark-mode-aware Win32 app uses (135 = SetPreferredAppMode, 136 = FlushMenuThemes); if they are missing, as on
// older builds, the menu simply stays the default one.
func prepareMenuTheme() {
	ux, err := windows.LoadLibrary("uxtheme.dll")
	if err != nil {
		return
	}
	setMode, err1 := windows.GetProcAddressByOrdinal(ux, 135)
	flush, err2 := windows.GetProcAddressByOrdinal(ux, 136)
	if err1 != nil || err2 != nil {
		return
	}
	const allowDark = 1 // follow the system setting
	_, _, _ = syscall.SyscallN(setMode, allowDark)
	_, _, _ = syscall.SyscallN(flush)
}

// installMenu replaces the classic right-click menu with the themed one. If it cannot be created the classic menu
// stays, so the tray is never left without a menu.
func installMenu(o Options) {
	if open := startMenu(o); open != nil {
		systray.SetOnSecondaryTapped(open)
	}
}
