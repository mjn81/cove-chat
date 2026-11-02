package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultManifestURL is Cove's own update control point, published by the website build next to every release.
// GitHub stays the fallback when it is unreachable.
const DefaultManifestURL = "https://covechat.dev/releases/manifest.json"

const maxManifestBytes = 1 << 20

// ErrBadManifest is returned for a manifest that is malformed or unsafe.
var ErrBadManifest = errors.New("update: invalid release manifest")

// ErrTooOld means the running version is below the manifest's min_version: it must install an intermediate release
// first, so a direct self-update is refused.
var ErrTooOld = errors.New("update: running version is older than the release's min_version")

// ManifestAsset is one downloadable file in a manifest.
type ManifestAsset struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Manifest is the JSON document served at DefaultManifestURL (or any mirror). Platform keys:
// windows-amd64, darwin-universal, linux-amd64 (desktop), server-<os>-<arch>, android.
type Manifest struct {
	// Channel is "stable" or "beta"; anything but stable is treated as a pre-release.
	Channel    string                   `json:"channel"`
	Version    string                   `json:"version"`
	ReleasedAt time.Time                `json:"released_at"`
	Notes      string                   `json:"notes"`
	ReleaseURL string                   `json:"release_url,omitempty"`
	MinVersion string                   `json:"min_version,omitempty"`
	Assets     map[string]ManifestAsset `json:"assets"`
}

// AssetNameForKey maps a manifest platform key to the file name the release workflow uses, so manifest-sourced
// releases look exactly like GitHub-sourced ones to the rest of the library.
func AssetNameForKey(key, version string) (string, bool) {
	switch {
	case strings.HasPrefix(key, "server-"):
		return "cove-" + key + ".zip", true
	case key == "windows-amd64":
		return "cove-desktop-windows-amd64.zip", true
	case key == "linux-amd64":
		return "cove-desktop-linux-amd64.zip", true
	case key == "darwin-universal":
		return "cove-desktop-mac-universal.zip", true
	case key == "android":
		return "cove-android-" + version + ".apk", true
	}
	return "", false
}

// validate checks the document and returns a normalized copy of the version.
func (m *Manifest) validate(allowInsecure bool) error {
	if _, err := ParseVersion(m.Version); err != nil {
		return fmt.Errorf("%w: version: %v", ErrBadManifest, err)
	}
	if m.MinVersion != "" {
		if _, err := ParseVersion(m.MinVersion); err != nil {
			return fmt.Errorf("%w: min_version: %v", ErrBadManifest, err)
		}
	}
	if len(m.Assets) == 0 {
		return fmt.Errorf("%w: no assets", ErrBadManifest)
	}
	for key, a := range m.Assets {
		if len(a.SHA256) != 64 {
			return fmt.Errorf("%w: %s has no valid sha256", ErrBadManifest, key)
		}
		if !isHex(a.SHA256) {
			return fmt.Errorf("%w: %s sha256 is not hex", ErrBadManifest, key)
		}
		u, err := url.Parse(a.URL)
		if err != nil || (u.Scheme != "https" && !(allowInsecure && u.Scheme == "http")) {
			return fmt.Errorf("%w: %s url must be https", ErrBadManifest, key)
		}
		if a.Size < 0 {
			return fmt.Errorf("%w: %s size", ErrBadManifest, key)
		}
	}
	return nil
}

func isHex(s string) bool {
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

// Release converts the manifest into the Release shape the rest of the library consumes. The checksums travel in
// Release.Sums, so Fetch verifies against the manifest instead of downloading a SHA256SUMS file.
func (m *Manifest) Release() Release {
	r := Release{
		Tag:         "v" + strings.TrimPrefix(m.Version, "v"),
		Name:        "Cove " + m.Version,
		Notes:       m.Notes,
		HTMLURL:     m.ReleaseURL,
		Prerelease:  m.Channel != "" && m.Channel != "stable",
		PublishedAt: m.ReleasedAt,
		MinVersion:  m.MinVersion,
		Sums:        map[string]string{},
	}
	for key, a := range m.Assets {
		name, ok := AssetNameForKey(key, strings.TrimPrefix(m.Version, "v"))
		if !ok {
			continue
		}
		r.Assets = append(r.Assets, Asset{Name: name, Size: a.Size, URL: a.URL})
		r.Sums[name] = strings.ToLower(a.SHA256)
	}
	return r
}

// FetchManifest downloads and validates a manifest.
//
// Fails with ErrBadManifest for malformed content, ErrInsecureURL for a non-HTTPS manifest URL, or a transport error.
func (c *Client) FetchManifest(ctx context.Context, manifestURL string) (*Manifest, error) {
	resp, err := c.get(ctx, manifestURL, "application/json")
	if err != nil {
		return nil, fmt.Errorf("update: fetch manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return nil, fmt.Errorf("update: fetch manifest: server answered %s", resp.Status)
	}
	var m Manifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxManifestBytes)).Decode(&m); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadManifest, err)
	}
	if err := m.validate(c.AllowInsecure); err != nil {
		return nil, err
	}
	return &m, nil
}

// SourceName tells where a release list came from.
type SourceName string

// Release list sources.
const (
	SourceManifest SourceName = "manifest"
	SourceGitHub   SourceName = "github"
)

// LoadReleases returns the releases to choose from, trying the manifest first (when ManifestURL is set) and the
// GitHub releases API second (unless NoGitHubFallback). A manifest that is reachable but invalid also falls back:
// a broken mirror must not stop updates.
//
// Fails with the last error when every enabled source failed.
func (c *Client) LoadReleases(ctx context.Context) ([]Release, SourceName, error) {
	var manifestErr error
	if c.ManifestURL != "" {
		m, err := c.FetchManifest(ctx, c.ManifestURL)
		if err == nil {
			return []Release{m.Release()}, SourceManifest, nil
		}
		manifestErr = err
		if c.NoGitHubFallback {
			return nil, SourceManifest, manifestErr
		}
	}
	rels, err := c.ListReleases(ctx)
	if err != nil {
		if manifestErr != nil {
			return nil, SourceGitHub, errors.Join(manifestErr, err)
		}
		return nil, SourceGitHub, err
	}
	return rels, SourceGitHub, nil
}
