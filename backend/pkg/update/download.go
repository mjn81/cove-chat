package update

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxChecksumsBytes = 1 << 20

// Progress receives the bytes written so far and the expected total (0 when unknown).
type Progress func(done, total int64)

// Staged is a downloaded and verified release asset waiting on disk.
type Staged struct {
	Release Release
	Asset   Asset
	// Path is the verified zip. The caller owns it and should remove it when finished.
	Path string
	// SHA256 is the lower-case hex digest that matched SHA256SUMS.
	SHA256 string
}

// FetchOptions controls Client.Fetch.
type FetchOptions struct {
	// Dir receives the download; it is created (0700) if missing.
	Dir string
	// MaxBytes caps the download; <= 0 means 512 MiB.
	MaxBytes int64
	// Progress is optional.
	Progress Progress
	// Current, when set, makes Fetch refuse a release that is not strictly newer (downgrade protection that
	// holds even if a caller forgets to run Select first).
	Current string
}

// Fetch downloads assetName from rel and verifies it against the release's SHA256SUMS. A release without
// SHA256SUMS, without an entry for the asset, or with a different digest is refused and nothing is left on
// disk: an unverified artifact must never reach the replacement step.
//
// Fails with ErrNotNewer, ErrAssetNotFound, ErrNoChecksums, ErrChecksumMismatch, ErrTooLarge, ErrInsecureURL or a transport error.
func (c *Client) Fetch(ctx context.Context, rel Release, assetName string, opts FetchOptions) (*Staged, error) {
	if opts.Current != "" {
		rv, err := rel.Version()
		if err != nil {
			return nil, err
		}
		cv, err := ParseVersion(opts.Current)
		if err != nil {
			return nil, err
		}
		if rv.Compare(cv) <= 0 {
			return nil, ErrNotNewer
		}
		if rel.MinVersion != "" {
			if mv, merr := ParseVersion(rel.MinVersion); merr == nil && cv.Compare(mv) < 0 {
				return nil, ErrTooOld
			}
		}
	}
	if assetName != filepath.Base(assetName) || strings.ContainsAny(assetName, `/\`) || assetName == "" {
		return nil, fmt.Errorf("update: unsafe asset name %q", assetName)
	}
	asset, ok := rel.Asset(assetName)
	if !ok {
		return nil, ErrAssetNotFound
	}
	max := opts.MaxBytes
	if max <= 0 {
		max = 512 << 20
	}
	if asset.Size > max {
		return nil, ErrTooLarge
	}
	sums := rel.Sums
	if sums == nil {
		var err error
		if sums, err = c.Checksums(ctx, rel); err != nil {
			return nil, err
		}
	}
	want, ok := sums[assetName]
	if !ok {
		return nil, ErrNoChecksums
	}
	path, got, err := c.Download(ctx, asset.URL, opts.Dir, assetName, max, opts.Progress)
	if err != nil {
		return nil, err
	}
	if !digestEqual(got, want) {
		_ = os.Remove(path)
		return nil, ErrChecksumMismatch
	}
	return &Staged{Release: rel, Asset: asset, Path: path, SHA256: got}, nil
}

func digestEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(a)), []byte(strings.ToLower(b))) == 1
}

// Download streams rawURL into dir/name through a ".part" file that is renamed on success, hashing as it goes.
//
// Returns the final path and the hex SHA-256 of what was written.
// Fails with ErrTooLarge when the body (or Content-Length) exceeds maxBytes.
func (c *Client) Download(ctx context.Context, rawURL, dir, name string, maxBytes int64, progress Progress) (string, string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", fmt.Errorf("update: create download dir: %w", err)
	}
	resp, err := c.get(ctx, rawURL, "application/octet-stream")
	if err != nil {
		return "", "", fmt.Errorf("update: download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("update: download: server answered %s", resp.Status)
	}
	if resp.ContentLength > maxBytes {
		return "", "", ErrTooLarge
	}
	final := filepath.Join(dir, name)
	part := final + ".part"
	f, err := os.OpenFile(part, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", "", fmt.Errorf("update: create %s: %w", part, err)
	}
	h := sha256.New()
	var done int64
	buf := make([]byte, 64<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			done += int64(n)
			if done > maxBytes {
				_ = f.Close()
				_ = os.Remove(part)
				return "", "", ErrTooLarge
			}
			h.Write(buf[:n])
			if _, werr := f.Write(buf[:n]); werr != nil {
				_ = f.Close()
				_ = os.Remove(part)
				return "", "", fmt.Errorf("update: write download: %w", werr)
			}
			if progress != nil {
				progress(done, resp.ContentLength)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			_ = f.Close()
			_ = os.Remove(part)
			return "", "", fmt.Errorf("update: download interrupted: %w", rerr)
		}
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(part)
		return "", "", err
	}
	_ = os.Remove(final)
	if err := os.Rename(part, final); err != nil {
		_ = os.Remove(part)
		return "", "", fmt.Errorf("update: finalize download: %w", err)
	}
	return final, hex.EncodeToString(h.Sum(nil)), nil
}

// Checksums downloads and parses the release's SHA256SUMS.
//
// Fails with ErrNoChecksums when the release has no SHA256SUMS asset.
func (c *Client) Checksums(ctx context.Context, rel Release) (map[string]string, error) {
	a, ok := rel.Asset(ChecksumsAsset)
	if !ok {
		return nil, ErrNoChecksums
	}
	resp, err := c.get(ctx, a.URL, "application/octet-stream")
	if err != nil {
		return nil, fmt.Errorf("update: fetch %s: %w", ChecksumsAsset, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update: fetch %s: server answered %s", ChecksumsAsset, resp.Status)
	}
	return ParseChecksums(io.LimitReader(resp.Body, maxChecksumsBytes))
}

// FileSHA256 returns the lower-case hex SHA-256 of a file.
func FileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// DigestEqual compares two hex digests in constant time, ignoring case.
func DigestEqual(a, b string) bool { return digestEqual(a, b) }

// ParseChecksums reads `sha256sum` output ("<hex>  <name>" or "<hex> *<name>"). Malformed lines are ignored.
//
// Returns name -> lower-case hex digest.
func ParseChecksums(r io.Reader) (map[string]string, error) {
	out := map[string]string{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) != 2 || len(fields[0]) != 64 {
			continue
		}
		if _, err := hex.DecodeString(fields[0]); err != nil {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		out[filepath.Base(name)] = strings.ToLower(fields[0])
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
