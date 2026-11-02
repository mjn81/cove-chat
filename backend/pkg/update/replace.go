package update

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// Suffixes of the sibling paths ReplacePath manages next to the target.
const (
	NewSuffix = ".new"
	OldSuffix = ".old"
)

// ReplacePath atomically swaps target for staged using renames only:
//
//  1. staged is moved (or, for a file on another filesystem, copied) to target+".new" so the final step is a
//     same-directory rename;
//  2. target is renamed to target+".old" (any previous ".old" is deleted first). Windows refuses to overwrite or
//     delete a running .exe but does allow renaming it, which is why the old copy is moved aside instead;
//  3. target+".new" is renamed to target.
//
// If step 3 fails the old copy is put back, so a failure never leaves the install without a target. The ".old"
// copy is kept so Rollback can undo a bad update. Works for files and, with a same-filesystem staged path, for
// directories such as a macOS .app bundle.
//
// Returns the path of the kept old copy.
func ReplacePath(target, staged string) (string, error) {
	info, err := os.Stat(staged)
	if err != nil {
		return "", fmt.Errorf("update: staged item: %w", err)
	}
	if _, err := os.Lstat(target); err != nil {
		return "", fmt.Errorf("update: current install: %w", err)
	}
	newPath, oldPath := target+NewSuffix, target+OldSuffix

	if staged != newPath {
		if err := os.RemoveAll(newPath); err != nil {
			return "", fmt.Errorf("update: clear %s: %w", newPath, err)
		}
		if err := os.Rename(staged, newPath); err != nil {
			if info.IsDir() {
				return "", fmt.Errorf("update: move staged directory next to the install (it must be on the same filesystem): %w", err)
			}
			if cerr := copyFile(staged, newPath, 0o755); cerr != nil {
				return "", fmt.Errorf("update: copy staged file: %w", cerr)
			}
			_ = os.Remove(staged)
		}
	}
	if !info.IsDir() {
		if err := os.Chmod(newPath, 0o755); err != nil {
			_ = os.Remove(newPath)
			return "", err
		}
	}

	if err := os.RemoveAll(oldPath); err != nil {
		_ = os.RemoveAll(newPath)
		return "", fmt.Errorf("update: remove previous backup %s: %w", oldPath, err)
	}
	if err := os.Rename(target, oldPath); err != nil {
		_ = os.RemoveAll(newPath)
		return "", fmt.Errorf("update: move current install aside: %w", err)
	}
	if err := os.Rename(newPath, target); err != nil {
		if rerr := os.Rename(oldPath, target); rerr != nil {
			return "", errors.Join(fmt.Errorf("update: install new version: %w", err), fmt.Errorf("update: restore old version FAILED: %w", rerr))
		}
		_ = os.RemoveAll(newPath)
		return "", fmt.Errorf("update: install new version (old one restored): %w", err)
	}
	return oldPath, nil
}

// Rollback undoes ReplacePath: the current target is moved to target+".failed" (then removed if possible) and
// target+".old" takes its place.
//
// Fails with an error when there is no ".old" copy to go back to.
func Rollback(target string) error {
	oldPath := target + OldSuffix
	if _, err := os.Lstat(oldPath); err != nil {
		return fmt.Errorf("update: nothing to roll back to: %w", err)
	}
	failed := target + ".failed"
	_ = os.RemoveAll(failed)
	if _, err := os.Lstat(target); err == nil {
		if err := os.Rename(target, failed); err != nil {
			return fmt.Errorf("update: move broken install aside: %w", err)
		}
	}
	if err := os.Rename(oldPath, target); err != nil {
		return fmt.Errorf("update: restore previous version: %w", err)
	}
	_ = os.RemoveAll(failed) // may fail on Windows while the broken binary is still running; harmless
	return nil
}

// CleanupOld removes target+".old" and target+".new" leftovers, typically on the first start after an update
// once the new version has proven it runs. Errors are ignored: a locked file is retried next start.
func CleanupOld(target string) {
	_ = os.RemoveAll(target + OldSuffix)
	_ = os.RemoveAll(target + NewSuffix)
	_ = os.RemoveAll(target + ".failed")
}

func copyFile(src, dst string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
}
