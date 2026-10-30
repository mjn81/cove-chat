//go:build linux

package tray

import "github.com/godbus/dbus/v5"

// platformAvailable reports whether a StatusNotifier host is running. Without one (a stock GNOME session without
// the AppIndicator extension) the icon would be invisible, so closing the window must quit instead of hiding it
// to a tray the user cannot reach.
func platformAvailable() bool {
	conn, err := dbus.SessionBus()
	if err != nil {
		return false
	}
	var has bool
	if err := conn.BusObject().Call("org.freedesktop.DBus.NameHasOwner", 0, "org.kde.StatusNotifierWatcher").Store(&has); err != nil {
		return false
	}
	return has
}

// prepareMenuTheme: Linux panels draw the menu themselves.
func prepareMenuTheme() {}

// installMenu: Linux keeps the panel-drawn menu, which already follows the desktop theme.
func installMenu(Options) {}
