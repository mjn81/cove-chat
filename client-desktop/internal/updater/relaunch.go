package updater

import (
	"strconv"
	"strings"
	"time"
)

// RelaunchFlag is passed to the new copy of the app so it waits for the old process to exit before it takes the
// single-instance lock; without it the new instance would just poke the still-running old one and quit.
const RelaunchFlag = "--relaunch-after="

// RelaunchArg builds the flag for the old process id.
func RelaunchArg(pid int) string { return RelaunchFlag + strconv.Itoa(pid) }

// ParseRelaunchArg finds --relaunch-after=<pid> in the process arguments.
//
// Returns the pid and true when present and valid.
func ParseRelaunchArg(args []string) (int, bool) {
	for _, a := range args {
		if v, ok := strings.CutPrefix(a, RelaunchFlag); ok {
			if pid, err := strconv.Atoi(v); err == nil && pid > 0 {
				return pid, true
			}
		}
	}
	return 0, false
}

// WaitForExit blocks until the process with this pid is gone or the timeout passes. It is called at the very start
// of main() when the app was relaunched by the updater.
func WaitForExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}
