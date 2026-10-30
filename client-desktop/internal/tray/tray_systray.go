//go:build windows || linux

// Package tray puts Cove in the system tray on Windows and Linux (Wails v2 has no tray API). macOS has no
// tray here: the Dock icon and the app-level hide cover the same job without fighting Wails for the main thread.
package tray

import "fyne.io/systray"

// Options configures the tray icon and its menu.
type Options struct {
	// Icon is an .ico on Windows and a PNG on Linux.
	Icon      []byte
	Tooltip   string
	ShowLabel string
	QuitLabel string
	OnShow    func()
	OnQuit    func()
}

// Start adds the tray icon and returns whether it is usable. It must be called after the Wails app is running;
// the tray runs its own message loop on a separate goroutine.
func Start(o Options) bool {
	if !platformAvailable() {
		return false
	}
	start, _ := systray.RunWithExternalLoop(func() {
		systray.SetIcon(o.Icon)
		systray.SetTooltip(o.Tooltip)
		systray.SetOnTapped(o.OnShow)
		show := systray.AddMenuItem(o.ShowLabel, "")
		systray.AddSeparator()
		quit := systray.AddMenuItem(o.QuitLabel, "")
		go func() {
			for {
				select {
				case <-show.ClickedCh:
					o.OnShow()
				case <-quit.ClickedCh:
					o.OnQuit()
					return
				}
			}
		}()
	}, func() {})
	start()
	return true
}

// SetIcon replaces the tray icon, for example when Windows switches between its light and dark theme.
func SetIcon(icon []byte) { systray.SetIcon(icon) }
