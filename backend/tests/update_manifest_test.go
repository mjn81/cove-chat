package tests

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cove/update"
)

// manifestServer serves a manifest at /releases/manifest.json plus the asset it points to.
type manifestServer struct {
	srv      *httptest.Server
	manifest update.Manifest
	zip      []byte
	status   int // 0 = 200
}

func newManifestServer(t *testing.T, version, channel string, zipBytes []byte, sha string) *manifestServer {
	t.Helper()
	ms := &manifestServer{zip: zipBytes}
	mux := http.NewServeMux()
	mux.HandleFunc("/releases/manifest.json", func(w http.ResponseWriter, r *http.Request) {
		if ms.status != 0 {
			http.Error(w, "down", ms.status)
			return
		}
		_ = json.NewEncoder(w).Encode(ms.manifest)
	})
	mux.HandleFunc("/dl/app.zip", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(ms.zip) })
	ms.srv = httptest.NewServer(mux)
	t.Cleanup(ms.srv.Close)
	if sha == "" {
		h := sha256.Sum256(zipBytes)
		sha = hex.EncodeToString(h[:])
	}
	ms.manifest = update.Manifest{
		Channel: channel, Version: version, Notes: "manifest notes",
		Assets: map[string]update.ManifestAsset{
			"server-linux-amd64": {URL: ms.srv.URL + "/dl/app.zip", SHA256: sha, Size: int64(len(zipBytes))},
			"linux-amd64":        {URL: ms.srv.URL + "/dl/app.zip", SHA256: sha, Size: int64(len(zipBytes))},
		},
	}
	return ms
}

func (ms *manifestServer) client(gh *fakeGitHub) *update.Client {
	c := &update.Client{ManifestURL: ms.srv.URL + "/releases/manifest.json", AllowInsecure: true}
	if gh != nil {
		c.APIBase = gh.srv.URL
	} else {
		c.APIBase = "http://127.0.0.1:1" // nothing listens: GitHub unreachable
	}
	return c
}

func TestManifestIsPreferredOverGitHub(t *testing.T) {
	ms := newManifestServer(t, "1.2.0", "beta", makeZip(t, map[string][]byte{"cove-server-linux-amd64": []byte("x")}), "")
	gh := newFakeGitHub(t)
	gh.publish("v9.9.9", false, map[string][]byte{"a.zip": []byte("x")}, nil)

	rels, src, err := ms.client(gh).LoadReleases(context.Background())
	if err != nil || src != update.SourceManifest || len(rels) != 1 || rels[0].Tag != "v1.2.0" {
		t.Fatalf("got %+v from %s, %v", rels, src, err)
	}
	if !rels[0].Prerelease || rels[0].Notes != "manifest notes" {
		t.Errorf("release = %+v", rels[0])
	}
	// Selection works on a manifest release and does not need a SHA256SUMS asset.
	got, err := update.Select(rels, update.SelectOptions{Current: "1.0.0", IncludePrerelease: true, RequireAssets: []string{"cove-server-linux-amd64.zip", update.ChecksumsAsset}})
	if err != nil || got.Tag != "v1.2.0" {
		t.Fatalf("Select = %q, %v", got.Tag, err)
	}
}

func TestFallsBackToGitHubWhenManifestUnreachableOrBroken(t *testing.T) {
	ms := newManifestServer(t, "1.2.0", "stable", makeZip(t, map[string][]byte{"x": []byte("x")}), "")
	gh := newFakeGitHub(t)
	gh.publish("v1.1.0", false, map[string][]byte{"a.zip": []byte("x")}, nil)

	ms.status = http.StatusServiceUnavailable
	rels, src, err := ms.client(gh).LoadReleases(context.Background())
	if err != nil || src != update.SourceGitHub || rels[0].Tag != "v1.1.0" {
		t.Fatalf("unreachable manifest: %v %s %v", rels, src, err)
	}

	ms.status = 0
	ms.manifest.Assets["server-linux-amd64"] = update.ManifestAsset{URL: "http://x", SHA256: "short"}
	_, src, err = ms.client(gh).LoadReleases(context.Background())
	if err != nil || src != update.SourceGitHub {
		t.Fatalf("invalid manifest should fall back: %s %v", src, err)
	}
}

func TestNoFallbackModeStaysOffGitHub(t *testing.T) {
	ms := newManifestServer(t, "1.2.0", "stable", makeZip(t, map[string][]byte{"x": []byte("x")}), "")
	gh := newFakeGitHub(t)
	gh.publish("v1.1.0", false, map[string][]byte{"a.zip": []byte("x")}, nil)
	ms.status = http.StatusBadGateway
	c := ms.client(gh)
	c.NoGitHubFallback = true
	if _, _, err := c.LoadReleases(context.Background()); err == nil {
		t.Fatal("expected an error without fallback")
	}
}

func TestBothSourcesUnreachable(t *testing.T) {
	ms := newManifestServer(t, "1.2.0", "stable", makeZip(t, map[string][]byte{"x": []byte("x")}), "")
	ms.status = http.StatusInternalServerError
	if _, _, err := ms.client(nil).LoadReleases(context.Background()); err == nil {
		t.Fatal("expected an error when manifest and GitHub are both down")
	}
}

func TestManifestChecksumIsEnforced(t *testing.T) {
	zipBytes := makeZip(t, map[string][]byte{"cove-server-linux-amd64": []byte("x")})
	ms := newManifestServer(t, "1.2.0", "stable", zipBytes, strings.Repeat("0", 64))
	rels, _, err := ms.client(nil).LoadReleases(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, err = ms.client(nil).Fetch(context.Background(), rels[0], "cove-server-linux-amd64.zip", update.FetchOptions{Dir: t.TempDir(), Current: "1.0.0"})
	if !errors.Is(err, update.ErrChecksumMismatch) {
		t.Fatalf("err = %v, want ErrChecksumMismatch", err)
	}

	good := newManifestServer(t, "1.2.0", "stable", zipBytes, "")
	rels, _, _ = good.client(nil).LoadReleases(context.Background())
	if _, err := good.client(nil).Fetch(context.Background(), rels[0], "cove-server-linux-amd64.zip", update.FetchOptions{Dir: t.TempDir(), Current: "1.0.0"}); err != nil {
		t.Fatalf("good manifest checksum rejected: %v", err)
	}
}

func TestManifestMinVersionBlocksDirectUpgrade(t *testing.T) {
	zipBytes := makeZip(t, map[string][]byte{"x": []byte("x")})
	ms := newManifestServer(t, "2.0.0", "stable", zipBytes, "")
	ms.manifest.MinVersion = "1.5.0"
	rels, _, _ := ms.client(nil).LoadReleases(context.Background())
	_, err := ms.client(nil).Fetch(context.Background(), rels[0], "cove-server-linux-amd64.zip", update.FetchOptions{Dir: t.TempDir(), Current: "1.0.0"})
	if !errors.Is(err, update.ErrTooOld) {
		t.Fatalf("err = %v, want ErrTooOld", err)
	}
}

func TestManifestRejectsPlainHTTPAssetsInProduction(t *testing.T) {
	ms := newManifestServer(t, "1.2.0", "stable", makeZip(t, map[string][]byte{"x": []byte("x")}), "")
	c := ms.client(nil)
	c.AllowInsecure = false
	if _, err := c.FetchManifest(context.Background(), c.ManifestURL); !errors.Is(err, update.ErrInsecureURL) {
		t.Fatalf("err = %v, want ErrInsecureURL", err)
	}
}
