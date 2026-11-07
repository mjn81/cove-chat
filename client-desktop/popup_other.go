//go:build !windows

package main

import (
	"context"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"cove/desktop/internal/popup"
)

// linuxPanelAllowance is subtracted from the screen height because the runtime does not expose the work area
// (the screen minus panels and docks). It is a guess at a typical panel; the popup then clears most of them.
const linuxPanelAllowance = 48

// preparePopupWindow is a no-op outside Windows.
func preparePopupWindow() {}

// popupWorkArea returns the usable part of the primary screen and the display scale (1: Wails sizes windows in
// logical pixels here).
func popupWorkArea(ctx context.Context) (popup.Rect, float64) {
	screens, err := wruntime.ScreenGetAll(ctx)
	if err == nil {
		for _, s := range screens {
			if s.IsPrimary {
				return popup.Rect{W: s.Size.Width, H: s.Size.Height - linuxPanelAllowance}, 1
			}
		}
	}
	return popup.Rect{W: 1280, H: 720 - linuxPanelAllowance}, 1
}

// showPopupWindow places the window and shows it.
func showPopupWindow(ctx context.Context, r popup.Rect) {
	wruntime.WindowSetSize(ctx, r.W, r.H)
	wruntime.WindowSetPosition(ctx, r.X, r.Y)
	wruntime.WindowShow(ctx)
}

// hidePopupWindow hides the window.
func hidePopupWindow(ctx context.Context) { wruntime.WindowHide(ctx) }
