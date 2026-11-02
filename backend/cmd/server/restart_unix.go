//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// relaunch replaces the process image in place. The PID stays the same, so systemd (Type=simple), launchd and
// plain shells keep supervising the same process; no supervisor "restart on exit" policy is required.
func relaunch(exe string, args, env []string) error {
	return syscall.Exec(exe, append([]string{exe}, args...), env)
}

// detach is a no-op: a child of a terminal-less service does not need extra process attributes on Unix.
func detach(_ *exec.Cmd) {}
