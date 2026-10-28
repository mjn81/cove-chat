package tests

import (
	"regexp"
	"testing"

	"cove/backend/internal/version"
)

// semver accepts MAJOR.MINOR.PATCH with an optional pre-release suffix such as -rc.1 or -beta.2.
var semver = regexp.MustCompile(`^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$`)

func TestVersion_DefaultIsSemver(t *testing.T) {
	if !semver.MatchString(version.Version) {
		t.Fatalf("version.Version = %q, want MAJOR.MINOR.PATCH[-pre]", version.Version)
	}
}

func TestVersion_DisplayIsPrefixed(t *testing.T) {
	want := "Cove v" + version.Version
	if got := version.Display(); got != want {
		t.Fatalf("Display() = %q, want %q", got, want)
	}
}
