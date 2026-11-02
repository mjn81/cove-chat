package update

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// ExtractFile writes the single regular file named entry from the zip to dest (mode 0755 when the archive marks
// it executable, else 0644). The match is exact on the archive path, so a release cannot smuggle in a look-alike.
//
// Fails with an error if the entry is missing, is not a regular file, or inflates beyond maxBytes.
func ExtractFile(zipPath, entry, dest string, maxBytes int64) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("update: open archive: %w", err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name != entry {
			continue
		}
		if !f.Mode().IsRegular() {
			return fmt.Errorf("update: archive entry %q is not a regular file", entry)
		}
		return writeZipFile(f, dest, maxBytes)
	}
	return fmt.Errorf("update: archive has no entry %q", entry)
}

// ExtractTree extracts the directory named prefix (for example "Cove.app") and everything below it into destDir,
// which receives it under the same name. It preserves file modes and relative symlinks that stay inside the tree
// (macOS bundles use them), and rejects absolute paths, ".." traversal ("zip slip") and oversized archives.
//
// Parameter maxBytes: total inflated size limit
// Fails with an error if the tree is absent or the archive is hostile.
func ExtractTree(zipPath, prefix, destDir string, maxBytes int64) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("update: open archive: %w", err)
	}
	defer zr.Close()
	prefix = strings.TrimSuffix(prefix, "/")
	var total int64
	found := false
	for _, f := range zr.File {
		name := strings.TrimSuffix(f.Name, "/")
		if name != prefix && !strings.HasPrefix(name, prefix+"/") {
			continue
		}
		found = true
		target, err := safeJoin(destDir, name)
		if err != nil {
			return err
		}
		mode := f.Mode()
		switch {
		case mode.IsDir() || strings.HasSuffix(f.Name, "/"):
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case mode&os.ModeSymlink != 0:
			rc, err := f.Open()
			if err != nil {
				return err
			}
			link, err := io.ReadAll(io.LimitReader(rc, 4096))
			rc.Close()
			if err != nil {
				return err
			}
			if err := checkLinkInside(destDir, target, string(link)); err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := os.Symlink(string(link), target); err != nil {
				return fmt.Errorf("update: create symlink: %w", err)
			}
		case mode.IsRegular():
			total += int64(f.UncompressedSize64)
			if total > maxBytes {
				return ErrTooLarge
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := writeZipFile(f, target, maxBytes); err != nil {
				return err
			}
		default:
			return fmt.Errorf("update: archive entry %q has an unsupported type", f.Name)
		}
	}
	if !found {
		return fmt.Errorf("update: archive has no %q", prefix)
	}
	return nil
}

func writeZipFile(f *zip.File, dest string, maxBytes int64) error {
	if int64(f.UncompressedSize64) > maxBytes {
		return ErrTooLarge
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	perm := os.FileMode(0o644)
	if f.Mode()&0o111 != 0 {
		perm = 0o755
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("update: create %s: %w", dest, err)
	}
	// The declared size is attacker-controlled metadata, so the real copy is bounded as well.
	n, err := io.Copy(out, io.LimitReader(rc, maxBytes+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > maxBytes {
		err = ErrTooLarge
	}
	if err != nil {
		_ = os.Remove(dest)
		return err
	}
	return os.Chmod(dest, perm)
}

// safeJoin joins an archive path onto root and refuses anything that escapes it.
func safeJoin(root, name string) (string, error) {
	if path.IsAbs(name) || strings.Contains(name, `\`) || filepath.IsAbs(name) {
		return "", fmt.Errorf("update: unsafe archive path %q", name)
	}
	clean := path.Clean(name)
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("update: unsafe archive path %q", name)
	}
	return filepath.Join(root, filepath.FromSlash(clean)), nil
}

// checkLinkInside makes sure a symlink created at linkPath resolves inside root.
func checkLinkInside(root, linkPath, link string) error {
	if path.IsAbs(link) || filepath.IsAbs(link) {
		return fmt.Errorf("update: absolute symlink %q in archive", link)
	}
	resolved := filepath.Join(filepath.Dir(linkPath), filepath.FromSlash(link))
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("update: symlink %q escapes the archive", link)
	}
	return nil
}
