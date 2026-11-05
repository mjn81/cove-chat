//go:build !windows

package updater

import (
	"os/exec"
	"runtime"
	"syscall"
)

// processAlive probes with signal 0: ESRCH means the process is gone, EPERM means it exists under another user.
func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// StartNew launches the freshly installed app. On macOS it goes through LaunchServices (`open -n`), which is how a
// .app bundle must be started to get its dock icon, activation and entitlements; on Linux the binary is run in its
// own session so it outlives the old process.
func StartNew(target string, oldPID int) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-n", target, "--args", RelaunchArg(oldPID)).Start()
	}
	cmd := exec.Command(target, RelaunchArg(oldPID))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
