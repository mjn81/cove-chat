//go:build windows

package tray

import (
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// A themed pop-up menu for the tray icon. The classic Win32 menu cannot take Cove's colours, so the right-click menu
// is a small borderless window painted with GDI in the app's warm palette (light or dark, following Windows).
// It lives on its own locked OS thread with its own message loop, and closes when it loses focus.

var (
	user32 = windows.NewLazySystemDLL("user32.dll")
	gdi32  = windows.NewLazySystemDLL("gdi32.dll")
	dwmapi = windows.NewLazySystemDLL("dwmapi.dll")
	shcore = windows.NewLazySystemDLL("shcore.dll")

	pRegisterClassEx     = user32.NewProc("RegisterClassExW")
	pCreateWindowEx      = user32.NewProc("CreateWindowExW")
	pDefWindowProc       = user32.NewProc("DefWindowProcW")
	pGetMessage          = user32.NewProc("GetMessageW")
	pTranslateMessage    = user32.NewProc("TranslateMessage")
	pDispatchMessage     = user32.NewProc("DispatchMessageW")
	pPostMessage         = user32.NewProc("PostMessageW")
	pShowWindow          = user32.NewProc("ShowWindow")
	pSetWindowPos        = user32.NewProc("SetWindowPos")
	pSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	pGetCursorPos        = user32.NewProc("GetCursorPos")
	pBeginPaint          = user32.NewProc("BeginPaint")
	pEndPaint            = user32.NewProc("EndPaint")
	pInvalidateRect      = user32.NewProc("InvalidateRect")
	pGetClientRect       = user32.NewProc("GetClientRect")
	pFillRect            = user32.NewProc("FillRect")
	pDrawText            = user32.NewProc("DrawTextW")
	pSetWindowRgn        = user32.NewProc("SetWindowRgn")
	pMonitorFromPoint    = user32.NewProc("MonitorFromPoint")
	pGetMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	pLoadCursor          = user32.NewProc("LoadCursorW")
	pTrackMouseEvent     = user32.NewProc("TrackMouseEvent")
	pGetDC               = user32.NewProc("GetDC")
	pReleaseDC           = user32.NewProc("ReleaseDC")

	pCreateSolidBrush    = gdi32.NewProc("CreateSolidBrush")
	pCreatePen           = gdi32.NewProc("CreatePen")
	pDeleteObject        = gdi32.NewProc("DeleteObject")
	pSelectObject        = gdi32.NewProc("SelectObject")
	pSetBkMode           = gdi32.NewProc("SetBkMode")
	pSetTextColor        = gdi32.NewProc("SetTextColor")
	pRoundRect           = gdi32.NewProc("RoundRect")
	pMoveToEx            = gdi32.NewProc("MoveToEx")
	pLineTo              = gdi32.NewProc("LineTo")
	pCreateFont          = gdi32.NewProc("CreateFontW")
	pCreateRoundRectRgn  = gdi32.NewProc("CreateRoundRectRgn")
	pCreateCompatibleDC  = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBmp = gdi32.NewProc("CreateCompatibleBitmap")
	pBitBlt              = gdi32.NewProc("BitBlt")
	pDeleteDC            = gdi32.NewProc("DeleteDC")
	pGetDeviceCaps       = gdi32.NewProc("GetDeviceCaps")

	pDwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
	pGetDpiForMonitor      = shcore.NewProc("GetDpiForMonitor")
)

const (
	wmDestroy    = 0x0002
	wmPaint      = 0x000F
	wmEraseBkgnd = 0x0014
	wmActivate   = 0x0006
	wmKeyDown    = 0x0100
	wmMouseMove  = 0x0200
	wmLButtonUp  = 0x0202
	wmMouseLeave = 0x02A3
	wmApp        = 0x8000 // posted by the tray thread: open the menu at the cursor

	waInactive = 0

	wsPopup         = 0x80000000
	wsExToolWindow  = 0x00000080
	wsExTopmost     = 0x00000008
	swHide          = 0
	swShowNoActive  = 4
	swpNoActivate   = 0x0010
	swpShowWindow   = 0x0040
	hwndTopmost     = ^uintptr(0)
	vkEscape        = 0x1B
	idcArrow        = 32512
	monitorNearest  = 2
	transparentMode = 1
	psSolid         = 0
	tmeLeave        = 0x2
	srcCopy         = 0x00CC0020
	logPixelsY      = 90
	dtLeftVCenter   = 0x0004 | 0x0020 | 0x8000 // DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX
	dwmCornerPref   = 33
	dwmRound        = 2
)

type (
	point struct{ X, Y int32 }
	rect  struct{ Left, Top, Right, Bottom int32 }

	wndClassEx struct {
		Size, Style                uint32
		WndProc                    uintptr
		ClsExtra, WndExtra         int32
		Instance, Icon, Cursor, Bg windows.Handle
		MenuName, ClassName        *uint16
		IconSm                     windows.Handle
	}
	msg struct {
		Hwnd           windows.Handle
		Message        uint32
		WParam, LParam uintptr
		Time           uint32
		Pt             point
		LPrivate       uint32
	}
	paintStruct struct {
		Hdc       windows.Handle
		Erase     int32
		Paint     rect
		Restore   int32
		IncUpdate int32
		Reserved  [32]byte
	}
	monitorInfo struct {
		Size    uint32
		Monitor rect
		Work    rect
		Flags   uint32
	}
	trackMouse struct {
		Size, Flags uint32
		Hwnd        windows.Handle
		HoverTime   uint32
	}
)

// palette is one theme's colours as COLORREF (0x00BBGGRR).
type palette struct{ bg, border, text, muted, hover, accent uint32 }

func rgb(r, g, b uint32) uint32 { return r | g<<8 | b<<16 }

// The warm neutrals and terracotta accent shared with the web and Android clients.
var (
	darkPalette  = palette{bg: rgb(38, 34, 32), border: rgb(66, 59, 55), text: rgb(236, 231, 227), muted: rgb(160, 150, 143), hover: rgb(58, 52, 49), accent: rgb(217, 130, 106)}
	lightPalette = palette{bg: rgb(252, 250, 248), border: rgb(228, 220, 214), text: rgb(43, 37, 34), muted: rgb(120, 109, 102), hover: rgb(240, 233, 228), accent: rgb(196, 98, 74)}
)

// usesLightTheme reads the Windows "apps" theme.
func usesLightTheme() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue("AppsUseLightTheme")
	return err == nil && v == 1
}

type popup struct {
	hwnd    windows.Handle
	entries []menuEntry
	hover   int
	tracked bool
	pal     palette
	dpi     int32
	rowsY   []int32 // top of each row, plus the end, in pixels
	width   int32
}

var menu popup // one tray menu per process

func (p *popup) px(v int32) int32 { return v * p.dpi / 96 }

// layout computes the row positions and the popup size for the current DPI.
func (p *popup) layout() (w, h int32) {
	pad := p.px(6)
	y := pad
	p.rowsY = p.rowsY[:0]
	for _, e := range p.entries {
		p.rowsY = append(p.rowsY, y)
		if e.sep {
			y += p.px(9)
		} else {
			y += p.px(32)
		}
	}
	p.rowsY = append(p.rowsY, y)
	return p.px(236), y + pad
}

func (p *popup) rowAt(y int32) int {
	for i, e := range p.entries {
		if !e.sep && y >= p.rowsY[i] && y < p.rowsY[i+1] {
			return i
		}
	}
	return -1
}

func wndProc(hwnd windows.Handle, m uint32, wParam, lParam uintptr) uintptr {
	p := &menu
	switch m {
	case wmApp:
		p.open()
		return 0
	case wmEraseBkgnd:
		return 1
	case wmPaint:
		p.paint(hwnd)
		return 0
	case wmMouseMove:
		if !p.tracked {
			tm := trackMouse{Size: uint32(unsafe.Sizeof(trackMouse{})), Flags: tmeLeave, Hwnd: hwnd}
			pTrackMouseEvent.Call(uintptr(unsafe.Pointer(&tm)))
			p.tracked = true
		}
		if i := p.rowAt(int32(int16(lParam >> 16))); i != p.hover {
			p.hover = i
			pInvalidateRect.Call(uintptr(hwnd), 0, 0)
		}
		return 0
	case wmMouseLeave:
		p.tracked = false
		p.hover = -1
		pInvalidateRect.Call(uintptr(hwnd), 0, 0)
		return 0
	case wmLButtonUp:
		if i := p.rowAt(int32(int16(lParam >> 16))); i >= 0 {
			e := &p.entries[i]
			if e.toggle {
				e.checked = !e.checked
			}
			pShowWindow.Call(uintptr(hwnd), swHide)
			// Run off the menu thread: handlers may block (quit) or call back into Wails.
			go e.run(e.checked)
		}
		return 0
	case wmKeyDown:
		if wParam == vkEscape {
			pShowWindow.Call(uintptr(hwnd), swHide)
		}
		return 0
	case wmActivate:
		if wParam&0xFFFF == waInactive {
			pShowWindow.Call(uintptr(hwnd), swHide)
		}
		return 0
	}
	r, _, _ := pDefWindowProc.Call(uintptr(hwnd), uintptr(m), wParam, lParam)
	return r
}

// open sizes and places the menu next to the cursor (the tray icon), kept inside the monitor's work area.
func (p *popup) open() {
	var cur point
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&cur)))
	mon, _, _ := pMonitorFromPoint.Call(uintptr(*(*int64)(unsafe.Pointer(&cur))), monitorNearest)
	var dx, dy uint32 = 96, 96
	pGetDpiForMonitor.Call(mon, 0, uintptr(unsafe.Pointer(&dx)), uintptr(unsafe.Pointer(&dy)))
	p.dpi = int32(dx)
	if p.dpi == 0 {
		p.dpi = 96
	}
	if usesLightTheme() {
		p.pal = lightPalette
	} else {
		p.pal = darkPalette
	}
	p.hover = -1
	w, h := p.layout()
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	pGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&mi)))
	x, y := cur.X-w/2, cur.Y-h-p.px(8)
	if y < mi.Work.Top {
		y = cur.Y + p.px(8)
	}
	x = min(max(x, mi.Work.Left+p.px(8)), mi.Work.Right-w-p.px(8))
	y = min(max(y, mi.Work.Top+p.px(8)), mi.Work.Bottom-h-p.px(8))

	radius := p.px(12)
	rgn, _, _ := pCreateRoundRectRgn.Call(0, 0, uintptr(w+1), uintptr(h+1), uintptr(radius), uintptr(radius))
	pSetWindowRgn.Call(uintptr(p.hwnd), rgn, 0) // the system owns the region from here
	pSetWindowPos.Call(uintptr(p.hwnd), hwndTopmost, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpShowWindow)
	pSetForegroundWindow.Call(uintptr(p.hwnd))
	pInvalidateRect.Call(uintptr(p.hwnd), 0, 0)
}

func (p *popup) paint(hwnd windows.Handle) {
	var ps paintStruct
	hdc, _, _ := pBeginPaint.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&ps)))
	defer pEndPaint.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&ps)))
	var rc rect
	pGetClientRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&rc)))

	// Draw off-screen first so hovering does not flicker.
	mem, _, _ := pCreateCompatibleDC.Call(hdc)
	bmp, _, _ := pCreateCompatibleBmp.Call(hdc, uintptr(rc.Right), uintptr(rc.Bottom))
	old, _, _ := pSelectObject.Call(mem, bmp)
	defer func() {
		pBitBlt.Call(hdc, 0, 0, uintptr(rc.Right), uintptr(rc.Bottom), mem, 0, 0, srcCopy)
		pSelectObject.Call(mem, old)
		pDeleteObject.Call(bmp)
		pDeleteDC.Call(mem)
	}()

	pal := p.pal
	bgBrush, _, _ := pCreateSolidBrush.Call(uintptr(pal.bg))
	defer pDeleteObject.Call(bgBrush)
	pFillRect.Call(mem, uintptr(unsafe.Pointer(&rc)), bgBrush)

	// 1px rounded border.
	borderPen, _, _ := pCreatePen.Call(psSolid, 1, uintptr(pal.border))
	oldPen, _, _ := pSelectObject.Call(mem, borderPen)
	oldBrush, _, _ := pSelectObject.Call(mem, bgBrush)
	r := uintptr(p.px(12))
	pRoundRect.Call(mem, 0, 0, uintptr(rc.Right), uintptr(rc.Bottom), r, r)
	pSelectObject.Call(mem, oldPen)
	pSelectObject.Call(mem, oldBrush)
	pDeleteObject.Call(borderPen)

	face, _ := syscall.UTF16PtrFromString("Segoe UI")
	font, _, _ := pCreateFont.Call(uintptr(-p.px(15)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5 /* CLEARTYPE */, 0, uintptr(unsafe.Pointer(face)))
	oldFont, _, _ := pSelectObject.Call(mem, font)
	defer func() { pSelectObject.Call(mem, oldFont); pDeleteObject.Call(font) }()
	pSetBkMode.Call(mem, transparentMode)

	inset := p.px(6)
	for i, e := range p.entries {
		top, bottom := p.rowsY[i], p.rowsY[i+1]
		if e.sep {
			pen, _, _ := pCreatePen.Call(psSolid, 1, uintptr(pal.border))
			o, _, _ := pSelectObject.Call(mem, pen)
			mid := uintptr((top + bottom) / 2)
			pMoveToEx.Call(mem, uintptr(p.px(14)), mid, 0)
			pLineTo.Call(mem, uintptr(rc.Right-p.px(14)), mid)
			pSelectObject.Call(mem, o)
			pDeleteObject.Call(pen)
			continue
		}
		if i == p.hover {
			hb, _, _ := pCreateSolidBrush.Call(uintptr(pal.hover))
			hp, _, _ := pCreatePen.Call(psSolid, 1, uintptr(pal.hover))
			ob, _, _ := pSelectObject.Call(mem, hb)
			op, _, _ := pSelectObject.Call(mem, hp)
			rr := uintptr(p.px(8))
			pRoundRect.Call(mem, uintptr(inset), uintptr(top), uintptr(rc.Right-inset), uintptr(bottom), rr, rr)
			pSelectObject.Call(mem, ob)
			pSelectObject.Call(mem, op)
			pDeleteObject.Call(hb)
			pDeleteObject.Call(hp)
		}
		if e.toggle && e.checked {
			pen, _, _ := pCreatePen.Call(psSolid, uintptr(max(2, p.px(2))), uintptr(pal.accent))
			o, _, _ := pSelectObject.Call(mem, pen)
			cx, cy := p.px(22), (top+bottom)/2
			pMoveToEx.Call(mem, uintptr(cx-p.px(5)), uintptr(cy), 0)
			pLineTo.Call(mem, uintptr(cx-p.px(1)), uintptr(cy+p.px(4)))
			pLineTo.Call(mem, uintptr(cx+p.px(6)), uintptr(cy-p.px(4)))
			pSelectObject.Call(mem, o)
			pDeleteObject.Call(pen)
		}
		label, _ := syscall.UTF16FromString(e.label)
		pSetTextColor.Call(mem, uintptr(pal.text))
		tr := rect{Left: p.px(38), Top: top, Right: rc.Right - p.px(14), Bottom: bottom}
		pDrawText.Call(mem, uintptr(unsafe.Pointer(&label[0])), uintptr(len(label)-1), uintptr(unsafe.Pointer(&tr)), dtLeftVCenter)
	}
}

// startMenu creates the themed menu and returns a function that opens it at the cursor. It returns nil if the
// window could not be created, in which case the caller keeps the classic menu.
func startMenu(o Options) func() {
	for _, e := range o.entries() {
		menu.entries = append(menu.entries, e)
	}
	ready := make(chan bool, 1)
	go func() {
		runtime.LockOSThread()
		class, _ := syscall.UTF16PtrFromString("CoveTrayMenu")
		instRaw, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
		inst := windows.Handle(instRaw)
		cursor, _, _ := pLoadCursor.Call(0, idcArrow)
		wc := wndClassEx{
			Size: uint32(unsafe.Sizeof(wndClassEx{})), WndProc: syscall.NewCallback(wndProc),
			Instance: inst, Cursor: windows.Handle(cursor), ClassName: class,
		}
		if a, _, _ := pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); a == 0 {
			ready <- false
			return
		}
		h, _, _ := pCreateWindowEx.Call(wsExToolWindow|wsExTopmost, uintptr(unsafe.Pointer(class)), 0, wsPopup, 0, 0, 10, 10, 0, 0, uintptr(inst), 0)
		if h == 0 {
			ready <- false
			return
		}
		menu.hwnd = windows.Handle(h)
		pref := int32(dwmRound)
		pDwmSetWindowAttribute.Call(h, dwmCornerPref, uintptr(unsafe.Pointer(&pref)), 4)
		ready <- true
		var m msg
		for {
			if r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0); int32(r) <= 0 {
				return
			}
			pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			pDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()
	if !<-ready {
		return nil
	}
	return func() { pPostMessage.Call(uintptr(menu.hwnd), wmApp, 0, 0) }
}
