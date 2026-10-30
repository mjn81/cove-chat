package main

import (
	"context"
	_ "embed"
	"os"
	"runtime"
	"slices"
	"sync/atomic"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"cove/desktop/internal/autostart"
	"cove/desktop/internal/tray"
)

//go:embed build/appicon.png
var trayIconPNG []byte

// windowState tracks the pieces of close-to-tray that are decided at runtime.
type windowState struct {
	quitting atomic.Bool // set when the user really quits (tray menu, Quit), so the close is not intercepted
	trayOK   atomic.Bool // the tray icon exists and can bring the window back
}

// startedHidden reports whether the app was launched with --hidden (autostart): minimised to the tray.
func startedHidden() bool { return slices.Contains(os.Args[1:], autostart.HiddenFlag) }

// closeToTray reports whether the saved preference keeps the app running in the background. It defaults to on.
func closeToTray(c Config) bool { return c.CloseToTray == nil || *c.CloseToTray }

// keepRunning decides whether closing the window hides it instead of quitting. Windows and Linux need a working
// tray icon to get the window back; macOS always has the Dock icon.
func (a *App) keepRunning() bool {
	if !closeToTray(a.config) || a.win.quitting.Load() {
		return false
	}
	return runtime.GOOS == "darwin" || a.win.trayOK.Load()
}

// hideWindow sends the app to the background. With a passcode set it also locks first, so a window left in the
// tray never holds unlocked data.
func (a *App) hideWindow() {
	if _, enabled := loadLock(); enabled {
		a.Lock()
	}
	if runtime.GOOS == "darwin" {
		wruntime.Hide(a.ctx) // hides the whole app; a Dock click brings it back
		return
	}
	wruntime.WindowHide(a.ctx)
}

// showWindow brings the window back from the tray or from a second launch.
func (a *App) showWindow() {
	wruntime.WindowUnminimise(a.ctx)
	wruntime.Show(a.ctx)
	wruntime.WindowShow(a.ctx)
}

// beforeClose runs when the OS asks the window to close (Alt+F4, the macOS red button, the taskbar). Returning
// true cancels the close; the window is hidden instead when the app should keep running in the background.
func (a *App) beforeClose(context.Context) (prevent bool) {
	if a.keepRunning() {
		a.hideWindow()
		return true
	}
	return false
}

// startTray adds the tray icon and records whether it works. Called once the Wails runtime is ready.
func (a *App) startTray() {
	// Windows draws the tray on a light or dark bar, so it gets the glyph icon in the matching tone (and is switched
	// again if the theme changes, see startTaskbarTheme); Linux panels take the PNG.
	icon := trayIconPNG
	if runtime.GOOS == "windows" {
		icon = iconForTheme(systemUsesLightTheme())
	}
	ok := tray.Start(tray.Options{
		Icon:      icon,
		Tooltip:   "Cove",
		ShowLabel: "Open Cove",
		Toggles: []tray.Toggle{
			{Label: "Keep running when closed", Checked: closeToTray(a.config), OnToggle: a.SetCloseToTray},
			{Label: "Start with " + osName(), Checked: autostart.Enabled(), OnToggle: func(on bool) { _ = a.SetAutostart(on) }},
		},
		QuitLabel: "Quit Cove",
		OnShow:    a.showWindow,
		OnQuit:    a.QuitApp,
	})
	a.win.trayOK.Store(ok)
	// Autostart launches hidden, but without a tray nobody could ever reopen the window: show it.
	if startedHidden() && !ok && runtime.GOOS != "darwin" {
		a.showWindow()
	}
}

// CloseWindow is the title bar's close button: it hides to the tray when the app should keep running, otherwise
// it quits.
func (a *App) CloseWindow() {
	if a.keepRunning() {
		a.hideWindow()
		return
	}
	a.QuitApp()
}

// QuitApp really exits, bypassing close-to-tray (tray menu "Quit Cove").
func (a *App) QuitApp() {
	a.win.quitting.Store(true)
	// A wedged web view (a renderer crash) can leave the normal shutdown waiting forever, which is how a "crashed"
	// Cove used to linger in the tray with no window. If the graceful quit has not finished shortly, exit anyway.
	time.AfterFunc(4*time.Second, func() {
		tray.Stop()
		os.Exit(0)
	})
	wruntime.Quit(a.ctx)
}

// osName is the platform's word for "log in" in the tray's start-up toggle.
func osName() string {
	switch runtime.GOOS {
	case "darwin":
		return "login"
	case "linux":
		return "login"
	}
	return "Windows"
}

// GetCloseToTray returns whether closing the window keeps Cove running in the background.
func (a *App) GetCloseToTray() bool { return closeToTray(a.config) }

// SetCloseToTray saves the close-to-tray preference.
func (a *App) SetCloseToTray(enabled bool) {
	a.config.CloseToTray = &enabled
	a.saveConfig()
}

// GetAutostart returns whether Cove starts when the user logs in.
func (a *App) GetAutostart() bool { return autostart.Enabled() }

// SetAutostart turns start-at-login on or off. Cove then starts minimised to the tray.
func (a *App) SetAutostart(enabled bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return autostart.Set(enabled, exe)
}
