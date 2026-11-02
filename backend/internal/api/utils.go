package api

import (
	"encoding/json"
	"net/http"

	"cove/backend/internal/apistd"
)

// ============================
//  Response & utility helpers
// ============================

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError sends the standard error envelope. The stable machine code is derived from the HTTP status; use
// writeErrorCode when a handler needs a more specific one from the registry in internal/apistd.
func writeError(w http.ResponseWriter, code int, msg string) {
	writeErrorCode(w, code, apistd.CodeForStatus(code), msg)
}

// writeErrorCode is writeError with an explicit registry code (for example apistd.CodeFeatureUnsupported).
func writeErrorCode(w http.ResponseWriter, status int, machineCode, msg string) {
	writeJSON(w, status, ErrorResponse{Error: msg, Code: machineCode})
}

func uniqueStrings(s []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(s))
	for _, v := range s {
		if _, ok := seen[v]; !ok {
			seen[v] = struct{}{}
			out = append(out, v)
		}
	}
	return out
}
