package api

// Server self-update states reported by GET /api/admin/update.
const (
	UpdateStateIdle        = "idle"
	UpdateStateDownloading = "downloading"
	UpdateStateInstalling  = "installing"
	UpdateStateRestarting  = "restarting"
	UpdateStateFailed      = "failed"
)

// DockerUpdateInstructions is the exact command an operator runs to update a container install.
const DockerUpdateInstructions = "docker compose pull && docker compose up -d"

// UpdateInfoResponse describes the running build, the newest release and whether this install can update itself.
type UpdateInfoResponse struct {
	CurrentVersion  string `json:"current_version" example:"0.9.9"`
	LatestVersion   string `json:"latest_version" example:"0.10.0"` // empty when no release could be determined
	UpdateAvailable bool   `json:"update_available" example:"true"`
	ReleaseNotes    string `json:"release_notes"` // GitHub release body (Markdown), truncated to 16 KiB
	ReleaseURL      string `json:"release_url,omitempty"`
	Prerelease      bool   `json:"prerelease"`
	PublishedAt     string `json:"published_at,omitempty"` // RFC3339
	CheckedAt       string `json:"checked_at,omitempty"`   // RFC3339; when the release list was last fetched
	// CheckError is an i18n key set when GitHub could not be reached; everything else is still filled in.
	CheckError string `json:"check_error,omitempty" example:"admin.errors.update_check_failed"`

	// Mode is "binary" (plain executable), "docker" (container, never self-replaced) or "unknown".
	Mode string `json:"mode" example:"binary" enums:"binary,docker,unknown"`
	// CanUpdate is true only when the button may be used right now: binary mode, a newer release and no job running.
	CanUpdate bool `json:"can_update" example:"true"`
	// Reason explains a false CanUpdate with an i18n key suffix: docker, unsupported, up_to_date, busy.
	Reason string `json:"reason,omitempty" example:"docker"`
	// Instructions is the manual command, set in docker mode.
	Instructions string `json:"instructions,omitempty" example:"docker compose pull && docker compose up -d"`

	// State is the progress of an update started with POST: idle, downloading, installing, restarting or failed.
	State           string `json:"state" example:"idle" enums:"idle,downloading,installing,restarting,failed"`
	ProgressPercent int    `json:"progress_percent" example:"42"`
	// Error is an i18n key describing why the last update attempt failed.
	Error string `json:"error,omitempty" example:"admin.errors.update_checksum_failed"`
}

// UpdateStartResponse acknowledges that an update job was accepted; poll GET /api/admin/update for progress.
type UpdateStartResponse struct {
	Status  string `json:"status" example:"success"`
	Version string `json:"version" example:"0.10.0"` // the release being installed
	State   string `json:"state" example:"downloading"`
}
