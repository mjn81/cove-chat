// Package version exposes the build version of the Cove server.
package version

// Version is the semantic version of this build. It is a var, not a const, so release builds
// can stamp it with -ldflags "-X cove/backend/internal/version.Version=1.2.3" from the root
// VERSION file; the value below is only the fallback for plain `go build` / `go test`.
var Version = "0.9.0"

// Display returns the human-readable form used in the startup banner, e.g. "Cove v0.9.0".
func Display() string {
	return "Cove v" + Version
}
