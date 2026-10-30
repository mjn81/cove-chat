//go:build windows

package main

import (
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"cove/desktop/internal/tray"
)

var (
	user32            = windows.NewLazySystemDLL("user32.dll")
	procLoadImageW    = user32.NewProc("LoadImageW")
	procSendMessageW  = user32.NewProc("SendMessageW")
	procGetMetrics    = user32.NewProc("GetSystemMetrics")
	procEnumWindows   = user32.NewProc("EnumWindows")
	procGetClassNameW = user32.NewProc("GetClassNameW")
	procGetWindowPID  = user32.NewProc("GetWindowThreadProcessId")
)

const (
	wmSetIcon      = 0x0080
	iconSmall      = 0
	iconBig        = 1
	imageIcon      = 1
	lrLoadFromFile = 0x00000010
	smCxIcon       = 11
	smCxSmIcon     = 49
	// wailsWindowClass is the window class Wails 2 registers for its main window.
	wailsWindowClass = "wailsWindow"
	// themePollInterval is how often the Windows theme setting is re-read; there is no hook for it from here.
	themePollInterval = 2 * time.Second
)

// systemUsesLightTheme reports whether the Windows taskbar and tray are drawn light. The setting is
// SystemUsesLightTheme under HKCU\...\Themes\Personalize (0 = dark, 1 = light); it is missing on builds old
// enough to have only a dark taskbar.
func systemUsesLightTheme() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue("SystemUsesLightTheme")
	return err == nil && v == 1
}

// findAppWindow returns this process's Wails window, or 0 when it does not exist yet.
func findAppWindow() windows.HWND {
	pid := windows.GetCurrentProcessId()
	var found windows.HWND
	cb := syscall.NewCallback(func(hwnd windows.HWND, _ uintptr) uintptr {
		var owner uint32
		procGetWindowPID.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&owner)))
		if owner != pid {
			return 1
		}
		var class [64]uint16
		n, _, _ := procGetClassNameW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&class[0])), uintptr(len(class)))
		if windows.UTF16ToString(class[:n]) == wailsWindowClass {
			found = hwnd
			return 0 // stop enumerating
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	return found
}

// iconFile writes the embedded .ico to the app's data folder (once) and returns its path. LoadImage can pick the
// best-sized image from an .ico file, which keeps the taskbar icon sharp at every DPI.
func iconFile(name string, ico []byte) (string, error) {
	dir := filepath.Join(dataDir(), "icons")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if cur, err := os.ReadFile(path); err == nil && len(cur) == len(ico) {
		return path, nil
	}
	return path, os.WriteFile(path, ico, 0o600)
}

// loadIcon loads the icon at the given pixel size from an .ico file and returns its HICON, or 0.
func loadIcon(path string, size uintptr) uintptr {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0
	}
	h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p)), imageIcon, size, size, lrLoadFromFile)
	return h
}

var (
	iconMu    sync.Mutex
	iconCache = map[bool][2]uintptr{} // light taskbar -> {small, big}
)

// iconHandles returns (and caches) the small and large HICONs for a taskbar theme.
func iconHandles(light bool) (small, big uintptr, ok bool) {
	iconMu.Lock()
	defer iconMu.Unlock()
	if h, hit := iconCache[light]; hit {
		return h[0], h[1], true
	}
	name := "cove-dark.ico"
	if light {
		name = "cove-light.ico"
	}
	path, err := iconFile(name, iconForTheme(light))
	if err != nil {
		return 0, 0, false
	}
	cxSmall, _, _ := procGetMetrics.Call(smCxSmIcon)
	cxBig, _, _ := procGetMetrics.Call(smCxIcon)
	small, big = loadIcon(path, cxSmall), loadIcon(path, cxBig)
	if small == 0 && big == 0 {
		return 0, 0, false
	}
	iconCache[light] = [2]uintptr{small, big}
	return small, big, true
}

// applyThemeIcon sets the window (taskbar, Alt+Tab, title) and tray icons to the tone for the current theme.
// It reports false when the window does not exist yet, so the caller retries.
func applyThemeIcon(light bool) bool {
	hwnd := findAppWindow()
	if hwnd == 0 {
		return false
	}
	small, big, ok := iconHandles(light)
	if !ok {
		return true // nothing more to try; do not spin on a broken icon file
	}
	procSendMessageW.Call(uintptr(hwnd), wmSetIcon, iconSmall, small)
	procSendMessageW.Call(uintptr(hwnd), wmSetIcon, iconBig, big)
	tray.SetIcon(iconForTheme(light))
	return true
}

// startTaskbarTheme keeps the taskbar and tray icon matched to the Windows theme: it applies the right tone as
// soon as the window exists and again whenever the user switches between light and dark.
func (a *App) startTaskbarTheme() {
	go func() {
		applied, have := false, false
		for {
			light := systemUsesLightTheme()
			if !have || light != applied {
				if applyThemeIcon(light) {
					applied, have = light, true
				}
			}
			select {
			case <-a.ctx.Done():
				return
			case <-time.After(themePollInterval):
			}
		}
	}()
}
