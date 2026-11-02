// Package update is the shared self-update library used by the Cove server and the desktop app.
//
// It lives in its own module (cove/update) because client-desktop is a separate Go module and Go's
// `internal` rule forbids importing cove/backend/internal/... across modules. The package is stdlib-only,
// holds no global state and takes its HTTP client and API base URL as parameters so tests can use httptest.
//
// The flow is: ListReleases -> Select (highest semver, never a downgrade) -> Fetch (download the platform
// zip, refuse to continue unless it matches the release's SHA256SUMS) -> ExtractFile / ExtractZip ->
// ReplacePath (rename-swap that keeps the old copy as ".old" for Rollback).
package update
