package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"cove/update"
)

func TestCheckOnlyByDefaultNeverDownloads(t *testing.T) {
	h := newHarness(t)
	h.settings.AutoDownload = false
	h.publishGood("v1.0.0")

	if err := h.m.Check(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	st := h.m.State()
	if st.Phase != PhaseAvailable || st.LatestVersion != "1.0.0" || st.ReleaseNotes != "notes v1.0.0" {
		t.Fatalf("state = %+v, want available", st)
	}
	if entries, _ := os.ReadDir(h.stage); len(entries) != 0 {
		t.Fatalf("a check-only run wrote to the staging folder: %v", entries)
	}
	if err := h.m.Install(); err == nil {
		t.Fatal("Install must refuse when nothing was downloaded")
	}

	// The user's click on Download fetches and verifies, but still does not install.
	if err := h.m.Download(t.Context()); err != nil {
		t.Fatalf("Download: %v", err)
	}
	if st := h.m.State(); st.Phase != PhaseReady {
		t.Fatalf("after Download phase = %s", st.Phase)
	}
	if h.readTarget() != oldExe || len(h.relaunch) != 0 {
		t.Fatal("downloading must not touch or restart the app")
	}
}

func TestAutoDownloadOptInDownloadsInTheBackground(t *testing.T) {
	h := newHarness(t)
	h.settings.AutoDownload = true
	h.publishGood("v1.0.0")
	if err := h.m.Check(t.Context(), false); err != nil || h.m.State().Phase != PhaseReady {
		t.Fatalf("opt-in background check = %v, %+v", err, h.m.State())
	}
	// ...but installing still waits for a click.
	if h.readTarget() != oldExe {
		t.Fatal("opt-in downloads must not install")
	}
}

func TestDownloadWithoutACheckIsRefused(t *testing.T) {
	h := newHarness(t)
	if err := h.m.Download(t.Context()); err == nil {
		t.Fatal("expected an error")
	}
	if st := h.m.State(); st.Error != ErrNothingStaged {
		t.Fatalf("state = %+v", st)
	}
}

// manifestHarness serves a manifest for version 1.0.0 whose asset is the zip below.
func manifestServer(t *testing.T, zipBytes []byte, sha string, down *bool) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/releases/manifest.json", func(w http.ResponseWriter, r *http.Request) {
		if *down {
			http.Error(w, "down", http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(update.Manifest{
			Channel: "beta", Version: "1.0.0", Notes: "from manifest",
			Assets: map[string]update.ManifestAsset{"windows-amd64": {URL: srv.URL + "/dl.zip", SHA256: sha, Size: int64(len(zipBytes))}},
		})
	})
	mux.HandleFunc("/dl.zip", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(zipBytes) })
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestManifestSourceIsUsedAndGitHubIsTheFallback(t *testing.T) {
	h := newHarness(t)
	zipBytes := zipOf(t, map[string]string{"Cove.exe": newExe})
	sum := sha256.Sum256(zipBytes)
	down := false
	ms := manifestServer(t, zipBytes, hex.EncodeToString(sum[:]), &down)
	h.settings.ManifestURL = ms.URL + "/releases/manifest.json"
	h.gh.publish("v0.9.10", true, "cove-desktop-windows-amd64.zip", zipOf(t, map[string]string{"Cove.exe": "gh"}), "")

	if err := h.m.Check(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if st := h.m.State(); st.LatestVersion != "1.0.0" || st.ReleaseNotes != "from manifest" {
		t.Fatalf("manifest not preferred: %+v", st)
	}
	if err := h.m.Download(t.Context()); err != nil || h.m.State().Phase != PhaseReady {
		t.Fatalf("Download via manifest = %v %+v", err, h.m.State())
	}

	// Manifest down: the same check falls back to GitHub (which only has 0.9.10).
	h2 := newHarness(t)
	h2.settings.ManifestURL = ms.URL + "/releases/manifest.json"
	h2.gh.publish("v0.9.10", true, "cove-desktop-windows-amd64.zip", zipOf(t, map[string]string{"Cove.exe": "gh"}), "")
	down = true
	if err := h2.m.Check(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if st := h2.m.State(); st.LatestVersion != "0.9.10" {
		t.Fatalf("fallback state = %+v", st)
	}
}

func TestManifestBadChecksumIsRefused(t *testing.T) {
	h := newHarness(t)
	zipBytes := zipOf(t, map[string]string{"Cove.exe": newExe})
	down := false
	ms := manifestServer(t, zipBytes, "0000000000000000000000000000000000000000000000000000000000000000", &down)
	h.settings.ManifestURL = ms.URL + "/releases/manifest.json"
	_ = h.m.Check(t.Context(), true)
	if err := h.m.Download(t.Context()); err == nil {
		t.Fatal("expected checksum failure")
	}
	if st := h.m.State(); st.Error != ErrChecksum {
		t.Fatalf("state = %+v", st)
	}
	if matches, _ := filepath.Glob(filepath.Join(h.stage, "*", "*.zip")); len(matches) != 0 {
		t.Fatalf("unverified file kept: %v", matches)
	}
}
