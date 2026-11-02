package main

import (
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
)

// appMenu is the macOS menu bar. Wails' stock app menu quits through the same path as the red button, which
// OnBeforeClose turns into "hide to the Dock", so Cmd+Q and Cove > Quit never exited and the app had to be
// force-quit. Here Quit goes through QuitApp, which marks the quit as deliberate first. Other platforms have no
// menu bar and get nil.
func (a *App) appMenu() *menu.Menu {
	if runtime.GOOS != "darwin" {
		return nil
	}
	app := menu.NewMenu()
	app.AddText("Quit Cove", keys.CmdOrCtrl("q"), func(*menu.CallbackData) { a.QuitApp() })
	return menu.NewMenuFromItems(
		menu.SubMenu("Cove", app),
		menu.EditMenu(), // keeps copy, paste and select-all working in the web view
		menu.WindowMenu(),
	)
}
