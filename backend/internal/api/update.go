package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"cove/backend/internal/logger"
	"cove/update"
)

const (
	maxReleaseNotesBytes = 16 << 10
	updateCheckTimeout   = 15 * time.Second
	updateJobTimeout     = 15 * time.Minute
)

// Updater holds the server self-update logic. All fields are optional except Current; NewUpdater fills in
// production defaults and tests build the struct directly with a fake GitHub, temp executable and Restart hook.
//
// Its mutable state (release-list cache, running job) is ephemeral on purpose: it only throttles GitHub API
// calls and reports progress of a job that ends with a process restart, so persisting it would add nothing.
type Updater struct {
	Client  *update.Client
	Current string // running version, e.g. "0.9.9"
	ExePath string // the executable to replace; captured at start-up because /proc/self/exe moves with the rename
	GOOS    string
	GOARCH  string
	Mode    update.InstallMode
	// IncludePrerelease opts in to pre-releases; they are also offered automatically while Current is 0.x.
	IncludePrerelease bool
	// Restart is invoked once the new binary is in place. It must shut the server down gracefully and re-exec
	// ExePath. Nil leaves the process running (the owner restarts manually).
	Restart      func()
	RestartDelay time.Duration // lets the HTTP response and the "restarting" state reach the browser first
	MaxDownload  int64
	CacheTTL     time.Duration

	mu        sync.Mutex
	releases  []update.Release
	source    update.SourceName
	fetchedAt time.Time
	job       updateJob
	uploaded  *stagedUpload
}

type updateJob struct {
	state    string
	percent  int
	errKey   string
	targetTo string
}

// NewUpdater builds the production updater for the running binary. restart is called after a successful swap.
func NewUpdater(current string, restart func()) *Updater {
	exe, _ := os.Executable()
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return &Updater{
		Client:       &update.Client{UserAgent: "cove-server/" + current, ManifestURL: update.DefaultManifestURL},
		Current:      current,
		ExePath:      exe,
		GOOS:         runtime.GOOS,
		GOARCH:       runtime.GOARCH,
		Mode:         update.DetectInstallMode(update.OSProbe(), exe),
		Restart:      restart,
		RestartDelay: 1500 * time.Millisecond,
		MaxDownload:  256 << 20,
		CacheTTL:     10 * time.Minute,
	}
}

// requiredAssets are the files a release must carry for this platform to be considered.
func (u *Updater) requiredAssets() (zipName, entry string, require []string, ok bool) {
	zipName, entry, ok = update.ServerAsset(u.GOOS, u.GOARCH)
	if !ok {
		return "", "", nil, false
	}
	return zipName, entry, []string{zipName, update.ChecksumsAsset}, true
}

// listReleases returns the cached release list, refetching when stale or forced. GitHub allows only 60
// unauthenticated calls per hour per IP, hence the cache.
func (u *Updater) listReleases(ctx context.Context, force bool) ([]update.Release, time.Time, error) {
	u.mu.Lock()
	ttl := u.CacheTTL
	if !force && u.releases != nil && time.Since(u.fetchedAt) < ttl {
		rels, at := u.releases, u.fetchedAt
		u.mu.Unlock()
		return rels, at, nil
	}
	u.mu.Unlock()

	rels, source, err := u.Client.LoadReleases(ctx)
	if err != nil {
		u.mu.Lock()
		stale, at := u.releases, u.fetchedAt
		u.mu.Unlock()
		return stale, at, err
	}
	u.mu.Lock()
	u.releases, u.fetchedAt, u.source = rels, time.Now(), source
	at := u.fetchedAt
	u.mu.Unlock()
	return rels, at, nil
}

func (u *Updater) info(ctx context.Context, force bool) UpdateInfoResponse {
	resp := UpdateInfoResponse{CurrentVersion: u.Current, Mode: string(u.Mode), State: UpdateStateIdle}
	_, _, require, platformOK := u.requiredAssets()

	rels, at, err := u.listReleases(ctx, force)
	if err != nil {
		logger.Warnf("admin: update check failed: %v", err)
		resp.CheckError = "admin.errors.update_check_failed"
	}
	if !at.IsZero() {
		resp.CheckedAt = at.UTC().Format(time.RFC3339)
	}
	includePre := update.AllowPrerelease(u.Current, u.IncludePrerelease)
	if latest, lerr := update.Newest(rels, includePre, require); lerr == nil {
		resp.LatestVersion = trimV(latest.Tag)
		resp.ReleaseNotes = truncate(latest.Notes, maxReleaseNotesBytes)
		resp.ReleaseURL = latest.HTMLURL
		resp.Prerelease = latest.Prerelease
		if !latest.PublishedAt.IsZero() {
			resp.PublishedAt = latest.PublishedAt.UTC().Format(time.RFC3339)
		}
	}
	_, selErr := update.Select(rels, update.SelectOptions{Current: u.Current, IncludePrerelease: includePre, RequireAssets: require})
	resp.UpdateAvailable = selErr == nil

	u.mu.Lock()
	job := u.job
	resp.Source = string(u.source)
	if up := u.uploaded; up != nil {
		resp.Uploaded = &UpdateUploadInfo{Version: up.version, Verified: up.verified, SHA256: up.sha256, Kind: up.kind, SizeBytes: up.size}
	}
	u.mu.Unlock()
	if job.state != "" {
		resp.State, resp.ProgressPercent, resp.Error = job.state, job.percent, job.errKey
	}

	switch {
	case u.Mode == update.ModeDocker:
		resp.Reason = "docker"
		resp.Instructions = DockerUpdateInstructions
	case u.Mode != update.ModeBinary || !platformOK:
		resp.Reason = "unsupported"
	case job.state == UpdateStateDownloading || job.state == UpdateStateInstalling || job.state == UpdateStateRestarting:
		resp.Reason = "busy"
	case !resp.UpdateAvailable:
		resp.Reason = "up_to_date"
	default:
		resp.CanUpdate = true
	}
	return resp
}

// start validates and launches the update job.
//
// @returns the version being installed, or an HTTP status and i18n error key when it cannot start.
func (u *Updater) start(ctx context.Context, fromUpload bool, audit func(action, target string)) (string, int, string) {
	switch u.Mode {
	case update.ModeDocker:
		return "", http.StatusConflict, "admin.errors.update_docker"
	case update.ModeBinary:
	default:
		return "", http.StatusConflict, "admin.errors.update_unsupported"
	}
	zipName, entry, require, ok := u.requiredAssets()
	if !ok {
		return "", http.StatusConflict, "admin.errors.update_unsupported"
	}

	u.mu.Lock()
	if s := u.job.state; s == UpdateStateDownloading || s == UpdateStateInstalling || s == UpdateStateRestarting {
		u.mu.Unlock()
		return "", http.StatusConflict, "admin.errors.update_in_progress"
	}
	if fromUpload {
		up := u.uploaded
		if up == nil {
			u.mu.Unlock()
			return "", http.StatusConflict, "admin.errors.update_no_upload"
		}
		u.job = updateJob{state: UpdateStateInstalling, percent: 100, targetTo: up.version}
		u.mu.Unlock()
		audit("server.update.start", up.version+" (uploaded)")
		go u.runUpload(up, entry, audit)
		return up.version, http.StatusAccepted, ""
	}
	// Claim the slot before the (slow) network lookup so two clicks cannot start two jobs.
	u.job = updateJob{state: UpdateStateDownloading}
	u.mu.Unlock()

	rels, _, err := u.listReleases(ctx, true)
	if err != nil && rels == nil {
		u.setJob(updateJob{})
		logger.Warnf("admin: update lookup failed: %v", err)
		return "", http.StatusBadGateway, "admin.errors.update_check_failed"
	}
	rel, err := update.Select(rels, update.SelectOptions{
		Current:           u.Current,
		IncludePrerelease: update.AllowPrerelease(u.Current, u.IncludePrerelease),
		RequireAssets:     require,
	})
	if err != nil {
		u.setJob(updateJob{})
		return "", http.StatusConflict, "admin.errors.update_up_to_date"
	}
	target := trimV(rel.Tag)
	u.setJob(updateJob{state: UpdateStateDownloading, targetTo: target})
	audit("server.update.start", target)

	go u.run(rel, zipName, entry, audit)
	return target, http.StatusAccepted, ""
}

func (u *Updater) setJob(j updateJob) {
	u.mu.Lock()
	u.job = j
	u.mu.Unlock()
}

func (u *Updater) fail(target, key string, audit func(string, string)) {
	u.setJob(updateJob{state: UpdateStateFailed, errKey: key, targetTo: target})
	audit("server.update.failed", target)
}

// run downloads, verifies and swaps the binary, then asks the process to restart. Any failure before the swap
// leaves the current binary untouched.
func (u *Updater) run(rel update.Release, zipName, entry string, audit func(action, target string)) {
	target := trimV(rel.Tag)
	ctx, cancel := context.WithTimeout(context.Background(), updateJobTimeout)
	defer cancel()

	dir, err := os.MkdirTemp("", "cove-update-")
	if err != nil {
		logger.Errorf("admin: update temp dir: %v", err)
		u.fail(target, "admin.errors.update_failed", audit)
		return
	}
	defer func() { _ = os.RemoveAll(dir) }()

	staged, err := u.Client.Fetch(ctx, rel, zipName, update.FetchOptions{
		Dir:      dir,
		MaxBytes: u.MaxDownload,
		Current:  u.Current,
		Progress: func(done, total int64) {
			if total <= 0 {
				return
			}
			u.mu.Lock()
			u.job.percent = int(done * 100 / total)
			u.mu.Unlock()
		},
	})
	if err != nil {
		logger.Errorf("admin: update to %s refused: %v", target, err)
		u.fail(target, updateErrorKey(err), audit)
		return
	}

	u.setJob(updateJob{state: UpdateStateInstalling, percent: 100, targetTo: target})
	u.install(target, staged.Path, entry, audit)
}

// install swaps the binary found in the zip into place and asks the process to restart.
func (u *Updater) install(target, zipPath, entry string, audit func(action, target string)) {
	newPath := u.ExePath + update.NewSuffix
	if err := update.ExtractFile(zipPath, entry, newPath, u.MaxDownload*2); err != nil {
		_ = os.Remove(newPath)
		logger.Errorf("admin: update extract: %v", err)
		u.fail(target, "admin.errors.update_failed", audit)
		return
	}
	u.swap(target, newPath, audit)
}

// swap renames newPath over the executable (keeping the old one as .old) and restarts.
func (u *Updater) swap(target, newPath string, audit func(action, target string)) {
	if _, err := update.ReplacePath(u.ExePath, newPath); err != nil {
		logger.Errorf("admin: update replace: %v", err)
		u.fail(target, "admin.errors.update_failed", audit)
		return
	}

	u.setJob(updateJob{state: UpdateStateRestarting, percent: 100, targetTo: target})
	audit("server.update.installed", target)
	logger.Infof("admin: server binary replaced with %s (previous kept as %s), restarting", target, u.ExePath+update.OldSuffix)
	if u.Restart != nil {
		time.Sleep(u.RestartDelay)
		u.Restart()
	}
}

func updateErrorKey(err error) string {
	switch {
	case errors.Is(err, update.ErrChecksumMismatch):
		return "admin.errors.update_checksum_failed"
	case errors.Is(err, update.ErrNoChecksums):
		return "admin.errors.update_no_checksums"
	case errors.Is(err, update.ErrTooOld):
		return "admin.errors.update_too_old"
	default:
		return "admin.errors.update_download_failed"
	}
}

func trimV(tag string) string {
	if len(tag) > 0 && tag[0] == 'v' {
		return tag[1:]
	}
	return tag
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && s[cut]&0xC0 == 0x80 { // do not split a UTF-8 sequence
		cut--
	}
	return s[:cut]
}

// ---- Handlers --------------------------------------------------------------- //

// AdminGetUpdate godoc
//
//	@Summary     Server update status
//	@Description Reports the running version, the newest GitHub release with its notes, how this install was deployed (`binary`, `docker` or `unknown`) and whether it can update itself. In docker mode the manual command is returned instead. `?refresh=1` bypasses the 10-minute release cache and is audited. Also reports the progress of a running update.
//	@Description **Access:** Server Admin.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Param       refresh query string false "Pass 1 to re-check GitHub now"
//	@Success     200 {object} UpdateInfoResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Router      /api/admin/update [get]
func (h *Handler) AdminGetUpdate(w http.ResponseWriter, r *http.Request) {
	if h.Updater == nil {
		writeJSON(w, http.StatusOK, UpdateInfoResponse{
			CurrentVersion: appVersion, Mode: string(update.ModeUnknown), State: UpdateStateIdle, Reason: "unsupported",
		})
		return
	}
	force := r.URL.Query().Get("refresh") == "1"
	if force {
		h.audit(adminActor(r), "server.update.check", "")
	}
	ctx, cancel := context.WithTimeout(r.Context(), updateCheckTimeout)
	defer cancel()
	writeJSON(w, http.StatusOK, h.Updater.info(ctx, force))
}

// AdminStartUpdate godoc
//
//	@Summary     Update the server
//	@Description Downloads the newest release for this platform, verifies it against the release's SHA256SUMS, replaces the server binary (keeping the old one as `.old`) and restarts the process. Returns 202 immediately; poll `GET /api/admin/update` for progress. Refused with 409 in docker mode (use `docker compose pull && docker compose up -d`), when the install cannot be updated, when already up to date, or while another update runs. A failed checksum aborts before anything is replaced.
//	@Description **Access:** Server Owner.
//	@Tags        admin
//	@Produce     json
//	@Security    BearerAuth
//	@Param       body body UpdateStartRequest false "Optional. source=upload installs the release uploaded with POST /api/admin/update/upload instead of downloading"
//	@Success     202 {object} UpdateStartResponse
//	@Failure     400 {object} ErrorResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     403 {object} ErrorResponse
//	@Failure     409 {object} ErrorResponse
//	@Failure     501 {object} ErrorResponse
//	@Failure     502 {object} ErrorResponse
//	@Router      /api/admin/update [post]
func (h *Handler) AdminStartUpdate(w http.ResponseWriter, r *http.Request) {
	if h.Updater == nil {
		writeError(w, http.StatusNotImplemented, "admin.errors.update_unsupported")
		return
	}
	actor := adminActor(r)
	ctx, cancel := context.WithTimeout(r.Context(), updateCheckTimeout)
	defer cancel()
	var body UpdateStartRequest
	// The body is optional: an empty one (or none) means "download the latest release".
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	if body.Source != "" && body.Source != "release" && body.Source != "upload" {
		writeError(w, http.StatusBadRequest, "admin.errors.invalid_json")
		return
	}
	version, code, key := h.Updater.start(ctx, body.Source == "upload", func(action, target string) { h.audit(actor, action, target) })
	if key != "" {
		writeError(w, code, key)
		return
	}
	writeJSON(w, code, UpdateStartResponse{Status: "success", Version: version, State: UpdateStateDownloading})
}
