//go:build windows

package main

import (
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows itself has to accept the icon files: LoadImage picks the right-sized image out of the .ico, which is
// what gives a sharp taskbar icon at every DPI. A malformed .ico would load as nothing and leave the old icon.
func TestWindowsCanLoadBothThemeIconsAtTaskbarSizes(t *testing.T) {
	t.Setenv("COVE_DATA_DIR", t.TempDir())
	for _, light := range []bool{true, false} {
		small, big, ok := iconHandles(light)
		if !ok || small == 0 || big == 0 {
			t.Errorf("light=%v: Windows could not load the icon (small=%v big=%v ok=%v)", light, small, big, ok)
		}
	}
}

func TestIconFileIsWrittenOnceAndReused(t *testing.T) {
	t.Setenv("COVE_DATA_DIR", t.TempDir())
	first, err := iconFile("probe.ico", iconForTheme(true))
	if err != nil {
		t.Fatal(err)
	}
	second, err := iconFile("probe.ico", iconForTheme(true))
	if err != nil || first != second {
		t.Fatalf("second call = %q, %v; want the same path %q", second, err, first)
	}
}

func TestThemeLookupAndWindowSearchAreSafeWithoutAWindow(t *testing.T) {
	_ = systemUsesLightTheme() // reads the registry; either answer is valid, it just must not panic
	if findAppWindow() != 0 {
		t.Error("a test process has no Wails window, so none should be found")
	}
	if applyThemeIcon(true) {
		t.Error("applyThemeIcon must report false (retry later) while there is no window")
	}
}

// A real Win32 window with the class Wails uses stands in for the app window, so the actual WM_SETICON calls are
// exercised: after applyThemeIcon the window must report exactly the icons for the chosen theme.
func TestApplyThemeIconSetsTheWindowIcons(t *testing.T) {
	t.Setenv("COVE_DATA_DIR", t.TempDir())
	runtime.LockOSThread() // SendMessage runs the window procedure on the creating thread, which must be this one
	defer runtime.UnlockOSThread()

	var (
		kernel32          = windows.NewLazySystemDLL("kernel32.dll")
		procRegisterClass = user32.NewProc("RegisterClassExW")
		procCreateWindow  = user32.NewProc("CreateWindowExW")
		procDestroyWindow = user32.NewProc("DestroyWindow")
		procDefWindowProc = user32.NewProc("DefWindowProcW")
		procModuleHandle  = kernel32.NewProc("GetModuleHandleW")
	)
	hInst, _, _ := procModuleHandle.Call(0)
	className, _ := windows.UTF16PtrFromString(wailsWindowClass)

	type wndClassEx struct {
		Size       uint32
		Style      uint32
		WndProc    uintptr
		ClsExtra   int32
		WndExtra   int32
		Instance   uintptr
		Icon       uintptr
		Cursor     uintptr
		Background uintptr
		MenuName   *uint16
		ClassName  *uint16
		IconSm     uintptr
	}
	wc := wndClassEx{WndProc: procDefWindowProc.Addr(), Instance: hInst, ClassName: className}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if atom, _, err := procRegisterClass.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		t.Fatalf("RegisterClassEx: %v", err)
	}
	hwnd, _, err := procCreateWindow.Call(0, uintptr(unsafe.Pointer(className)), 0, 0, 0, 0, 0, 0, 0, 0, hInst, 0) // exStyle, class, name, style, x, y, w, h, parent, menu, instance, param
	if hwnd == 0 {
		t.Fatalf("CreateWindowEx: %v", err)
	}
	defer procDestroyWindow.Call(hwnd)

	const wmGetIcon = 0x007F
	for _, light := range []bool{true, false} {
		if !applyThemeIcon(light) {
			t.Fatalf("light=%v: applyThemeIcon did not find the window", light)
		}
		wantSmall, wantBig, ok := iconHandles(light)
		if !ok {
			t.Fatalf("light=%v: no icon handles", light)
		}
		gotSmall, _, _ := procSendMessageW.Call(hwnd, wmGetIcon, iconSmall, 0)
		gotBig, _, _ := procSendMessageW.Call(hwnd, wmGetIcon, iconBig, 0)
		if gotSmall != wantSmall || gotBig != wantBig {
			t.Errorf("light=%v: window icons = (%#x, %#x), want (%#x, %#x)", light, gotSmall, gotBig, wantSmall, wantBig)
		}
	}
	// The two themes must really use different icons, or the switch would be invisible.
	lightSmall, lightBig, _ := iconHandles(true)
	darkSmall, darkBig, _ := iconHandles(false)
	if lightSmall == darkSmall || lightBig == darkBig {
		t.Error("light and dark taskbar icons resolved to the same handles")
	}
}
