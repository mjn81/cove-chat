//go:build !windows

package main

// systemUsesLightTheme: only Windows has a themed taskbar icon; elsewhere the OS draws the icon itself.
func systemUsesLightTheme() bool { return false }

// startTaskbarTheme is a no-op outside Windows.
func (a *App) startTaskbarTheme() {}
