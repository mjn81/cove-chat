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

// DefaultRepo and DefaultAPIBase point at the official Cove releases.
const (
	DefaultRepo    = "mjn81/cove-chat"
	DefaultAPIBase = "https://api.github.com"
	// ChecksumsAsset is the checksum manifest the release workflow attaches next to the binaries.
	ChecksumsAsset = "SHA256SUMS"

	maxReleaseListBytes = 8 << 20
)

// Errors callers can match with errors.Is.
var (
	ErrNoRelease        = errors.New("update: no suitable release found")
	ErrNotNewer         = errors.New("update: release is not newer than the running version (downgrades are refused)")
	ErrAssetNotFound    = errors.New("update: release has no asset for this platform")
	ErrNoChecksums      = errors.New("update: release has no usable SHA256SUMS entry for the asset")
	ErrChecksumMismatch = errors.New("update: downloaded file does not match SHA256SUMS")
	ErrTooLarge         = errors.New("update: download exceeds the size limit")
	ErrInsecureURL      = errors.New("update: refusing a non-HTTPS download URL")
)

// Asset is one downloadable file attached to a release.
type Asset struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	URL  string `json:"browser_download_url"`
}

// Release is a GitHub release reduced to the fields the updater needs.
type Release struct {
	Tag         string    `json:"tag_name"`
	Name        string    `json:"name"`
	Notes       string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []Asset   `json:"assets"`
}

// Version parses the release tag.
func (r Release) Version() (Version, error) { return ParseVersion(r.Tag) }

// Asset returns the asset with the exact name.
func (r Release) Asset(name string) (Asset, bool) {
	for _, a := range r.Assets {
		if a.Name == name {
			return a, true
		}
	}
	return Asset{}, false
}

// Client talks to the GitHub releases API. The zero value is usable and targets the official repository.
type Client struct {
	// APIBase is the GitHub API root (default DefaultAPIBase); tests point it at httptest.
	APIBase string
	// Repo is "owner/name" (default DefaultRepo).
	Repo string
	// HTTP is the client used for every request (default http.DefaultClient). Callers bound downloads
	// with the context rather than a client timeout, since a large zip on a slow link is legitimate.
	HTTP *http.Client
	// UserAgent is sent on every request; GitHub rejects requests without one.
	UserAgent string
	// AllowInsecure permits http:// URLs. It exists for tests only: production downloads must be HTTPS.
	AllowInsecure bool
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) get(ctx context.Context, rawURL, accept string) (*http.Response, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("update: bad URL: %w", err)
	}
	if u.Scheme != "https" && !c.AllowInsecure {
		return nil, ErrInsecureURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	ua := c.UserAgent
	if ua == "" {
		ua = "cove-updater"
	}
	req.Header.Set("User-Agent", ua)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	return c.httpClient().Do(req)
}

// ListReleases fetches the most recent releases (drafts are dropped).
//
// @throws an error for transport failures, non-200 answers (including GitHub rate limiting) or invalid JSON.
func (c *Client) ListReleases(ctx context.Context) ([]Release, error) {
	base := strings.TrimRight(c.APIBase, "/")
	if base == "" {
		base = DefaultAPIBase
	}
	repo := c.Repo
	if repo == "" {
		repo = DefaultRepo
	}
	resp, err := c.get(ctx, base+"/repos/"+repo+"/releases?per_page=30", "application/vnd.github+json")
	if err != nil {
		return nil, fmt.Errorf("update: list releases: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return nil, fmt.Errorf("update: list releases: GitHub answered %s", resp.Status)
	}
	var all []Release
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxReleaseListBytes)).Decode(&all); err != nil {
		return nil, fmt.Errorf("update: decode releases: %w", err)
	}
	out := all[:0]
	for _, r := range all {
		if !r.Draft {
			out = append(out, r)
		}
	}
	return out, nil
}

// SelectOptions narrows which release Select may return.
type SelectOptions struct {
	// Current is the running version; only strictly newer releases qualify.
	Current string
	// IncludePrerelease lets pre-releases (GitHub's flag or a -tag) compete. Use AllowPrerelease to derive it.
	IncludePrerelease bool
	// RequireAssets lists asset names the release must carry, so a release whose uploads are still in
	// progress, or that has no build for this platform, is skipped rather than chosen.
	RequireAssets []string
}

// AllowPrerelease decides whether pre-releases should be offered: when the user opted in, or while the running
// build is itself a 0.x or pre-release build (every 0.x release is published as a GitHub pre-release).
func AllowPrerelease(current string, optIn bool) bool {
	if optIn {
		return true
	}
	v, err := ParseVersion(current)
	if err != nil {
		return false
	}
	return v.Major == 0 || v.IsPrerelease()
}

// Select returns the highest-semver release that is newer than opts.Current. The releases list is used rather
// than /releases/latest because that endpoint ignores pre-releases and every current Cove build is one.
//
// @returns ErrNoRelease if nothing newer qualifies; an unparseable current version is an error.
func Select(releases []Release, opts SelectOptions) (Release, error) {
	cur, err := ParseVersion(opts.Current)
	if err != nil {
		return Release{}, err
	}
	return pick(releases, &cur, opts.IncludePrerelease, opts.RequireAssets)
}

// Newest is like Select without the "newer than current" rule; callers use it to display the latest
// published version even when the running build is already up to date.
func Newest(releases []Release, includePrerelease bool, requireAssets []string) (Release, error) {
	return pick(releases, nil, includePrerelease, requireAssets)
}

func pick(releases []Release, above *Version, includePre bool, require []string) (Release, error) {
	var best Release
	var bestV Version
	found := false
	for _, r := range releases {
		if r.Draft {
			continue
		}
		v, err := r.Version()
		if err != nil {
			continue
		}
		if (r.Prerelease || v.IsPrerelease()) && !includePre {
			continue
		}
		if above != nil && v.Compare(*above) <= 0 {
			continue
		}
		if !hasAssets(r, require) {
			continue
		}
		if !found || v.Compare(bestV) > 0 {
			best, bestV, found = r, v, true
		}
	}
	if !found {
		return Release{}, ErrNoRelease
	}
	return best, nil
}

func hasAssets(r Release, names []string) bool {
	for _, n := range names {
		if _, ok := r.Asset(n); !ok {
			return false
		}
	}
	return true
}
