package api

import (
	"net/http"

	"cove/backend/internal/apistd"
)

// VersionResponse represents the standard server response for the version API. version and udp_port predate the
// API standard and stay so old clients keep working; the rest is additive (docs/api-standard.md).
type VersionResponse struct {
	Version string `json:"version" example:"V1.0.0"`
	UDPPort int    `json:"udp_port" example:"9090"`
	// APIVersion is the integer client/server contract version, bumped only on breaking changes.
	APIVersion int `json:"api_version" example:"2"`
	// MinClientVersion is the oldest client semver the admin supports; empty when none is set.
	MinClientVersion string `json:"min_client_version" example:"0.9.0"`
	// Capabilities names the optional features this server supports; clients gate UI on these, not on versions.
	Capabilities []string `json:"capabilities" example:"invite_messages,whisper,webrtc_sfu"`
}

// GetVersion godoc
//
//	@Summary     Get the current server build version
//	@Description Returns the semantic version of the Cove backend currently running, the API version,
//	@Description the minimum supported client version and the capabilities the server advertises.
//	@Description **Access:** Public.
//	@Tags        system
//	@Produce     json
//	@Success     200 {object} VersionResponse
//	@Router      /api/version [get]
func (h *Handler) GetVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, VersionResponse{
		Version:          appVersion,
		UDPPort:          h.UDPPort,
		APIVersion:       apistd.APIVersion,
		MinClientVersion: h.MinClientVersion,
		Capabilities:     apistd.Capabilities(h.VoiceMode != "raw_udp"),
	})
}
