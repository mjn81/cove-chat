//go:build !windows && !linux && !darwin

package autostart

import "errors"

// Enabled is always false on unsupported platforms.
func Enabled() bool { return false }

// Set is unsupported here.
func Set(bool, string) error { return errors.New("autostart is not supported on this platform") }
