//go:build windows

package updater

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

// processAlive waits on the process handle with a zero timeout; a missing process cannot be opened at all.
func processAlive(pid int) bool {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	ev, err := windows.WaitForSingleObject(h, 0)
	return err == nil && ev == uint32(windows.WAIT_TIMEOUT)
}

// StartNew launches the freshly installed exe detached from the old process and its console, so closing the old
// one does not take the new one with it.
func StartNew(target string, oldPID int) error {
	cmd := exec.Command(target, RelaunchArg(oldPID))
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
