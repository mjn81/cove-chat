package api

import (
	"net/http"
)

// VersionResponse represents the standard server response for the version API.
type VersionResponse struct {
	Version string `json:"version" example:"V1.0.0"`
	UDPPort int    `json:"udp_port" example:"9090"`
}

// GetVersion godoc
//	@Summary     Get the current server build version
//	@Description Returns the semantic version of the Cove backend currently running.
//	@Tags        system
//	@Produce     json
//	@Success     200 {object} VersionResponse
//	@Router      /api/version [get]
func (h *Handler) GetVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, VersionResponse{
		Version: appVersion,
		UDPPort: h.UDPPort,
	})
}
