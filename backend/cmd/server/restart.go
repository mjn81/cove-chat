package main

import (
	"errors"
	"os"
	"os/exec"

	"cove/backend/internal/logger"
	"cove/update"
)

// restartSelf relaunches the server from exe after the admin panel replaced the binary. It runs only after the
// graceful shutdown has finished, so the database lock and every listening port are already released.
// If the new binary cannot be started the previous version (kept as exe+".old") is restored and started instead.
//
// Fails with an error only when neither the new nor the old binary could be started.
func restartSelf(exe string) error {
	args := os.Args[1:]
	env := os.Environ()
	err := relaunch(exe, args, env)
	if err == nil {
		return nil
	}
	logger.Errorf("update: new binary failed to start (%v), rolling back", err)
	if rerr := update.Rollback(exe); rerr != nil {
		return errors.Join(err, rerr)
	}
	return relaunch(exe, args, env)
}

// startDetached launches exe as an independent child with the same stdio. Used on Windows (no exec) where the
// caller then exits, leaving the child running on the freed ports.
func startDetached(exe string, args, env []string) error {
	cmd := exec.Command(exe, args...)
	cmd.Env = env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	detach(cmd)
	return cmd.Start()
}
