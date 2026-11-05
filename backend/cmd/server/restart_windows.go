//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

// createNewProcessGroup stops a Ctrl+C aimed at the old console process from also killing the relaunched server.
const createNewProcessGroup = 0x00000200

// relaunch starts the new binary as a child; Windows has no exec, so main exits right after it returns.
func relaunch(exe string, args, env []string) error {
	return startDetached(exe, args, env)
}

func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}

// startDetached launches exe as an independent child with the same stdio. Windows has no exec, so the caller then
// exits and leaves the child running on the freed ports.
func startDetached(exe string, args, env []string) error {
	cmd := exec.Command(exe, args...)
	cmd.Env = env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	detach(cmd)
	return cmd.Start()
}
