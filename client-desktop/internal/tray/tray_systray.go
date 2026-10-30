//go:build windows || linux

// Package tray puts Cove in the system tray on Windows and Linux (Wails v2 has no tray API). macOS has no
// tray here: the Dock icon and the app-level hide cover the same job without fighting Wails for the main thread.
package tray

import (
	"runtime"

	"fyne.io/systray"
)

// Toggle is a checkable menu entry that flips a saved preference.
type Toggle struct {
	Label    string
	Checked  bool
	OnToggle func(enabled bool)
}

// Options configures the tray icon and its menu.
type Options struct {
	// Icon is an .ico on Windows and a PNG on Linux.
	Icon      []byte
	Tooltip   string
	ShowLabel string
	// Toggles are shown between "open" and "quit".
	Toggles   []Toggle
	QuitLabel string
	OnShow    func()
	OnQuit    func()
}

// menuEntry is one row of the themed tray menu (used on Windows, where the classic menu cannot be styled).
type menuEntry struct {
	label   string
	sep     bool
	toggle  bool
	checked bool
	run     func(enabled bool)
}

// entries lists the menu rows in order: open, the toggles, quit.
func (o Options) entries() []menuEntry {
	rows := []menuEntry{{label: o.ShowLabel, run: func(bool) { o.OnShow() }}}
	if len(o.Toggles) > 0 {
		rows = append(rows, menuEntry{sep: true})
	}
	for _, t := range o.Toggles {
		rows = append(rows, menuEntry{label: t.Label, toggle: true, checked: t.Checked, run: t.OnToggle})
	}
	return append(rows, menuEntry{sep: true}, menuEntry{label: o.QuitLabel, run: func(bool) { o.OnQuit() }})
}

// Start adds the tray icon and returns whether it is usable. It must be called after the Wails app is running;
// the tray runs its own message loop on a separate goroutine.
func Start(o Options) bool {
	if !platformAvailable() {
		return false
	}
	prepareMenuTheme()
	// The tray window and its message pump must live on one OS thread: Win32 delivers a window's messages only to
	// the thread that created it. RunWithExternalLoop pumps from a different goroutine than the one that built the
	// window, so clicks were silently dropped; Run on a thread locked to this goroutine keeps both together.
	go func() {
		runtime.LockOSThread()
		systray.Run(func() {
			systray.SetIcon(o.Icon)
			systray.SetTooltip(o.Tooltip)
			systray.SetOnTapped(o.OnShow)
			installMenu(o)
			show := systray.AddMenuItem(o.ShowLabel, "")
			if len(o.Toggles) > 0 {
				systray.AddSeparator()
			}
			for _, t := range o.Toggles {
				item := systray.AddMenuItemCheckbox(t.Label, "", t.Checked)
				go func(item *systray.MenuItem, t Toggle) {
					for range item.ClickedCh {
						next := !item.Checked()
						if next {
							item.Check()
						} else {
							item.Uncheck()
						}
						t.OnToggle(next)
					}
				}(item, t)
			}
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
	}()
	return true
}

// SetIcon replaces the tray icon, for example when Windows switches between its light and dark theme.
func SetIcon(icon []byte) { systray.SetIcon(icon) }

// Stop removes the tray icon so no ghost icon is left behind after the process exits.
func Stop() { systray.Quit() }
