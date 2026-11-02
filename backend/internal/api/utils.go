package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"cove/backend/internal/apistd"
	"cove/backend/internal/logger"
)

// ============================
//  Response & utility helpers
// ============================

// maxJSONBody is the default cap for a JSON request body. Every real payload in this API is a few hundred bytes;
// the cap only exists so a client cannot make the server buffer an arbitrarily large body.
const maxJSONBody = 1 << 20

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
	apistd.WriteError(w, status, machineCode, msg, nil)
}

// writeInternal logs err (with the operation it belongs to) and answers 500 with a generic message. The error text
// is never sent to the client: it can carry database or filesystem details.
func writeInternal(w http.ResponseWriter, op string, err error, msg string) {
	logger.Errorf("api: %s: %v", op, err)
	writeErrorCode(w, http.StatusInternalServerError, apistd.CodeInternal, msg)
}

// decodeJSON reads a JSON body of at most maxJSONBody bytes into v. On failure it writes the response itself (413
// payload_too_large for an oversize body, otherwise 400 with invalidMsg) and returns false.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any, invalidMsg string) bool {
	return decodeJSONLimit(w, r, v, maxJSONBody, invalidMsg)
}

// decodeJSONLimit is decodeJSON with an explicit byte cap.
func decodeJSONLimit(w http.ResponseWriter, r *http.Request, v any, limit int64, invalidMsg string) bool {
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(v)
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeErrorCode(w, http.StatusRequestEntityTooLarge, apistd.CodePayloadTooLarge, "request body too large")
		return false
	}
	writeError(w, http.StatusBadRequest, invalidMsg)
	return false
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
