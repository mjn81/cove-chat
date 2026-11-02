// Package updater is the desktop app's self-update engine: it checks GitHub for a newer release in the
// background, downloads it, verifies it against the release's SHA256SUMS, stages it on disk and, only when the user
// asks, swaps it in and relaunches. It builds on the shared cove/update library and has no Wails dependency so the
// whole state machine is unit-testable.
package updater

// Phase is where the update state machine currently is.
type Phase string

// Phases reported to the web UI.
const (
	PhaseIdle        Phase = "idle"        // nothing staged; see State.UpToDate for the outcome of the last check
	PhaseChecking    Phase = "checking"    // asking the update source for releases
	PhaseAvailable   Phase = "available"   // a newer release exists but nothing was downloaded (the user decides)
	PhaseDownloading Phase = "downloading" // fetching and verifying the zip
	PhaseReady       Phase = "ready"       // a verified update is staged and waits for the user's restart
	PhaseInstalling  Phase = "installing"  // swapping files and relaunching
	PhaseError       Phase = "error"       // last user-visible operation failed; see State.Error
)

// Error codes in State.Error. The web UI maps them to translated text.
const (
	ErrCheckFailed    = "check_failed"
	ErrDownloadFailed = "download_failed"
	ErrChecksum       = "checksum"
	ErrInstallFailed  = "install_failed"
	ErrUnsupported    = "unsupported"
	ErrNothingStaged  = "nothing_staged"
)

// State is the snapshot sent to the web UI (method result and the "update:state" event). JSON names are snake_case
// like every other DTO in Cove.
type State struct {
	Phase          Phase  `json:"phase"`
	CurrentVersion string `json:"current_version"`
	// LatestVersion is the staged or most recently found release; empty when none is newer.
	LatestVersion string `json:"latest_version"`
	ReleaseNotes  string `json:"release_notes"`
	ReleaseURL    string `json:"release_url"`
	// Progress is the download percentage while Phase is downloading.
	Progress int `json:"progress_percent"`
	// Error is one of the Err* codes when Phase is error.
	Error string `json:"error"`
	// CheckedAt is the RFC3339 time of the last completed check, empty before the first one.
	CheckedAt string `json:"checked_at"`
	// UpToDate is true when the last completed check found nothing newer.
	UpToDate bool `json:"up_to_date"`
	// CanInstall is false when the install location cannot be replaced (read-only folder, unsupported platform);
	// the UI then offers the download page instead of a restart button.
	CanInstall bool `json:"can_install"`
}

// Settings are the user's update preferences.
type Settings struct {
	// Enabled turns the background checks on. Manual "Check now" works regardless.
	Enabled bool `json:"enabled"`
	// IncludePrerelease offers pre-releases. Every 0.x release is a GitHub pre-release, so this defaults to on
	// while the app itself is 0.x (see DefaultIncludePrerelease).
	IncludePrerelease bool `json:"include_prerelease"`
	// AutoDownload lets background checks also download the update (default off: checking is cheap, downloading
	// is the user's call). Installing always needs a click.
	AutoDownload bool `json:"auto_download"`
	// ManifestURL is the update source; empty means GitHub only. Defaults to Cove's own domain.
	ManifestURL string `json:"manifest_url"`
}
