//go:build !windows

package main

import "syscall"

// relaunch replaces the process image in place. The PID stays the same, so systemd (Type=simple), launchd and
// plain shells keep supervising the same process; no supervisor "restart on exit" policy is required.
func relaunch(exe string, args, env []string) error {
	return syscall.Exec(exe, append([]string{exe}, args...), env)
}
