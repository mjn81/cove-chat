package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"cove/backend/internal/apistd"
	"cove/backend/internal/logger"
	"cove/backend/internal/version"
)

// ClientVersionConfig drives the minimum-client check. The zero value stamps headers and never rejects.
type ClientVersionConfig struct {
	// MinClientVersion is the oldest client semver the admin still supports ("" disables the check).
	MinClientVersion string
	// Enforce turns the warning into a hard 426. It also rejects callers that sent no X-Cove-Client at all,
	// because an admin asking for a hard minimum cannot vouch for an unidentified one.
	Enforce bool
}

// exemptFromMinimum reports requests that must stay reachable for an outdated client, so it can read the
// server's version and explain the problem instead of failing blind. Anything outside /api (static files) and
// the WebSocket upgrade (whose hello event carries the same information) is never blocked, and CORS preflights
// carry no client header.
func exemptFromMinimum(r *http.Request) bool {
	p := r.URL.Path
	return r.Method == http.MethodOptions ||
		!strings.HasPrefix(p, "/api/") ||
		p == "/api/version" || p == "/api/server-info"
}

// ClientVersion stamps X-Cove-API-Version / X-Cove-Server-Version on every response, parses X-Cove-Client, and
// applies the minimum-client policy (docs/api-standard.md section 7). An absent or unparsable header is
// tolerated: old clients and curl keep working unless the admin enabled a hard minimum.
func ClientVersion(cfg ClientVersionConfig, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(apistd.HeaderAPIVersion, strconv.Itoa(apistd.APIVersion))
		w.Header().Set(apistd.HeaderServerVersion, version.Version)

		client := apistd.ParseClient(r.Header.Get(apistd.HeaderClient))
		if cfg.MinClientVersion != "" && apistd.BelowMinimum(client, cfg.MinClientVersion, cfg.Enforce) {
			if cfg.Enforce && !exemptFromMinimum(r) {
				logger.Debugf("client below minimum rejected: %s %s", r.Method, r.URL.Path)
				writeClientOutdated(w, cfg.MinClientVersion)
				return
			}
			if client.Known {
				w.Header().Set(apistd.HeaderClientOutdated, "1")
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeClientOutdated(w http.ResponseWriter, min string) {
	apistd.WriteError(w, http.StatusUpgradeRequired, apistd.CodeClientOutdated,
		"This version of Cove is too old for this server. Please update the app.",
		map[string]string{"min_client_version": min})
}
