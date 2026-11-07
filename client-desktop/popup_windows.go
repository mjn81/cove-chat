//go:build windows

package main

import (
	"context"
	"unsafe"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"cove/desktop/internal/popup"
)

var (
	procSystemParametersInfo = user32.NewProc("SystemParametersInfoW")
	procGetDpiForSystem      = user32.NewProc("GetDpiForSystem")
	procSetWindowPos         = user32.NewProc("SetWindowPos")
	procGetWindowLongPtr     = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr     = user32.NewProc("SetWindowLongPtrW")
)

const (
	spiGetWorkArea = 0x0030
	gwlExStyle     = ^uintptr(19) // -20
	wsExToolWindow = 0x00000080
	wsExNoActivate = 0x08000000
	wsExAppWindow  = 0x00040000
	swpNoActivate  = 0x0010
	swpShowWindow  = 0x0040
	swpFrameChange = 0x0020
)

// hwndTopmost is HWND_TOPMOST (-1).
var hwndTopmost = ^uintptr(0)

// preparePopupWindow makes the popup window a tool window that never takes focus: it does not appear in the
// taskbar or Alt+Tab, and clicking it does not pull focus away from whatever the user is typing in.
func preparePopupWindow() {
	hwnd := findAppWindow()
	if hwnd == 0 {
		return
	}
	style, _, _ := procGetWindowLongPtr.Call(uintptr(hwnd), gwlExStyle)
	style = (style | wsExToolWindow | wsExNoActivate) &^ wsExAppWindow
	procSetWindowLongPtr.Call(uintptr(hwnd), gwlExStyle, style)
	procSetWindowPos.Call(uintptr(hwnd), hwndTopmost, 0, 0, 0, 0, 0x0001|0x0002|swpNoActivate|swpFrameChange) // SWP_NOSIZE|SWP_NOMOVE
}

// popupWorkArea returns the primary monitor's work area (excluding the taskbar) in physical pixels, and the
// display scale. The process is per-monitor DPI aware, so these are real pixels.
func popupWorkArea(context.Context) (popup.Rect, float64) {
	var rc struct{ Left, Top, Right, Bottom int32 }
	ok, _, _ := procSystemParametersInfo.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&rc)), 0)
	if ok == 0 {
		return popup.Rect{W: 1280, H: 680}, 1
	}
	scale := 1.0
	if dpi, _, _ := procGetDpiForSystem.Call(); dpi != 0 {
		scale = float64(dpi) / 96
	}
	return popup.Rect{X: int(rc.Left), Y: int(rc.Top), W: int(rc.Right - rc.Left), H: int(rc.Bottom - rc.Top)}, scale
}

// showPopupWindow places the window topmost without activating it, and shows it.
func showPopupWindow(_ context.Context, r popup.Rect) {
	hwnd := findAppWindow()
	if hwnd == 0 {
		return
	}
	procSetWindowPos.Call(uintptr(hwnd), hwndTopmost, uintptr(r.X), uintptr(r.Y), uintptr(r.W), uintptr(r.H), swpNoActivate|swpShowWindow)
}

// hidePopupWindow hides the window.
func hidePopupWindow(ctx context.Context) { wruntime.WindowHide(ctx) }
