package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"cove/desktop/internal/popup"
)

// popupItemsEvent carries the current list of popups to the popup page.
const popupItemsEvent = "popup:items"

// PopupApp is bound to the popup page. The same type is also bound in the main window (with no state, so every
// method is a no-op there) so that `wails generate module` emits its JS bindings next to App's.
type PopupApp struct {
	ctx    context.Context
	mu     sync.Mutex
	stack  *popup.Stack
	corner popup.Corner
	out    *json.Encoder
}

// report writes an event for the main process to stdout.
func (p *PopupApp) report(e popup.Event) {
	p.mu.Lock()
	defer p.mu.Unlock()
	_ = p.out.Encode(e)
}

// PopupItems returns the popups currently on screen, oldest first.
func (p *PopupApp) PopupItems() []popup.Item {
	if p.stack == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stack.Items()
}

// PopupDismiss removes a popup (its timer ran out or the user closed it).
func (p *PopupApp) PopupDismiss(id string) {
	if p.stack == nil {
		return
	}
	p.remove(id)
	p.report(popup.Event{Event: popup.EventDismiss, ID: id})
}

// PopupClick reports a click on a popup to the main process, which opens the chat, and removes the popup.
func (p *PopupApp) PopupClick(id string) {
	if p.stack == nil {
		return
	}
	p.remove(id)
	p.report(popup.Event{Event: popup.EventClick, ID: id})
}

func (p *PopupApp) remove(id string) {
	p.mu.Lock()
	_, ok := p.stack.Remove(id)
	p.mu.Unlock()
	if ok {
		p.apply()
	}
}

// apply sizes and places the window for the current stack, shows it, or hides it when it is empty.
func (p *PopupApp) apply() {
	p.mu.Lock()
	items := p.stack.Items()
	p.mu.Unlock()

	wruntime.EventsEmit(p.ctx, popupItemsEvent, items)
	if len(items) == 0 {
		hidePopupWindow(p.ctx)
		return
	}
	work, scale := popupWorkArea(p.ctx)
	showPopupWindow(p.ctx, popup.Layout(work, len(items), p.corner, scale))
}

// show adds a popup sent by the main process.
func (p *PopupApp) show(it popup.Item) {
	p.mu.Lock()
	p.stack.Push(it)
	p.mu.Unlock()
	p.apply()
}

// serve reads commands from the main process until it quits or goes away; losing stdin means the main app
// died, so the popup process must not outlive it.
func (p *PopupApp) serve() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 4096), 1<<20)
	for sc.Scan() {
		var m popup.Msg
		if json.Unmarshal(sc.Bytes(), &m) != nil {
			continue
		}
		switch m.Op {
		case popup.OpShow:
			p.show(m.Item)
		case popup.OpQuit:
			wruntime.Quit(p.ctx)
			return
		}
	}
	wruntime.Quit(p.ctx)
	time.AfterFunc(3*time.Second, func() { os.Exit(0) })
}

// runPopupProcess is the entry point of the popup process (started with --notif-popup): a frameless,
// always-on-top, initially hidden window that renders popup.html and is driven over stdin/stdout.
func runPopupProcess() {
	var cfg Config
	if data, err := os.ReadFile(configPath()); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	p := &PopupApp{
		stack:  popup.NewStack(popup.MaxVisible),
		corner: popup.ParseCorner(cfg.NotificationCorner),
		out:    json.NewEncoder(os.Stdout),
	}
	err := wails.Run(&options.App{
		Title:            "Cove notification",
		Width:            popup.Width,
		Height:           popup.CardHeight,
		Frameless:        true,
		AlwaysOnTop:      true,
		StartHidden:      true,
		DisableResize:    true,
		BackgroundColour: &options.RGBA{R: 13, G: 14, B: 20, A: 255},
		AssetServer: &assetserver.Options{
			Assets: assets,
			// The popup is its own page; "/" would otherwise serve the whole app.
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/" || r.URL.Path == "/index.html" {
						r.URL.Path = "/popup.html"
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		OnStartup: func(ctx context.Context) {
			p.ctx = ctx
			go p.serve()
		},
		OnDomReady: func(context.Context) {
			preparePopupWindow()
			p.report(popup.Event{Event: popup.EventReady})
		},
		Bind: []any{p},
		Windows: &windows.Options{
			// A separate profile: the main app's web view holds a lock on its own.
			WebviewUserDataPath: filepath.Join(dataDir(), "webview-popup"),
			ZoomFactor:          1.0,
		},
	})
	if err != nil {
		log.Printf("popup process: %v", err)
		os.Exit(1)
	}
}
