package main

import (
	"embed"
	"log"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// frontend/dist is embedded at build time via `wails build`.
// In this monorepo layout, we use a symlink 'frontend' pointing to '../client-web'.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:            "Cove",
		Width:            1280,
		Height:           820,
		MinWidth:         800,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 13, G: 14, B: 20, A: 255},

		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		// Lifecycle hooks
		OnStartup:  app.Startup,
		OnShutdown: app.Shutdown,

		// Closing hides to the tray (see window.go); only the tray's Quit really exits.
		OnBeforeClose: app.beforeClose,
		StartHidden:   startedHidden() && runtime.GOOS != "darwin",
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "com.cove.chat.desktop",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) { app.showWindow() },
		},
		OnDomReady: app.DomReady,

		// Expose App struct methods to the frontend via window.go.*
		Bind: []any{app},

		// The web UI draws its own title bar (see DesktopTitleBar) so the window reads as one surface, like
		// Telegram. Windows and Linux therefore run frameless; macOS keeps its native traffic lights inset into
		// that bar via the transparent full-size title bar below.
		Frameless: runtime.GOOS != "darwin",
		Windows: &windows.Options{
			Theme:                windows.SystemDefault,
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			ZoomFactor:           1.0,
			// Keep the web view's storage (localStorage, IndexedDB with cached keys) in the app data folder with the
			// rest of the user's data, instead of a folder named after the executable.
			WebviewUserDataPath: filepath.Join(dataDir(), "webview"),
		},

		// macOS specific
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideToolbarSeparator:       true,
				FullSizeContent:            true,
			},
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
	})
	if err != nil {
		log.Fatalf("Wails run error: %v", err)
	}
}
