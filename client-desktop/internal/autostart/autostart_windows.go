//go:build windows

package autostart

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

// Enabled reports whether Cove is registered to start at login.
func Enabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue("Cove")
	return err == nil
}

// Set registers (or removes) Cove under HKCU\...\Run for the current user only; no admin rights needed.
func Set(enabled bool, exe string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if enabled {
		return k.SetStringValue("Cove", windowsRunValue(exe))
	}
	if err := k.DeleteValue("Cove"); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}
