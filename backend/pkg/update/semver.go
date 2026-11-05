package update

import (
	"fmt"
	"strconv"
	"strings"
)

// Version is a parsed semantic version (https://semver.org). Build metadata is ignored for precedence.
type Version struct {
	Major, Minor, Patch uint64
	Pre                 []string // dot-separated pre-release identifiers; empty for a stable release
}

// ParseVersion parses "1.2.3", "v1.2.3" and "1.2.3-rc.1+build5".
//
// Returns an error for anything that is not MAJOR.MINOR.PATCH with an optional pre-release.
func ParseVersion(s string) (Version, error) {
	raw := strings.TrimSpace(s)
	s = strings.TrimPrefix(raw, "v")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	var v Version
	core, pre, hasPre := strings.Cut(s, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return v, fmt.Errorf("invalid version %q", raw)
	}
	nums := [3]*uint64{&v.Major, &v.Minor, &v.Patch}
	for i, p := range parts {
		n, err := strconv.ParseUint(p, 10, 64)
		if err != nil || (len(p) > 1 && p[0] == '0') {
			return Version{}, fmt.Errorf("invalid version %q", raw)
		}
		*nums[i] = n
	}
	if hasPre {
		if pre == "" {
			return Version{}, fmt.Errorf("invalid version %q", raw)
		}
		v.Pre = strings.Split(pre, ".")
		for _, id := range v.Pre {
			if id == "" {
				return Version{}, fmt.Errorf("invalid version %q", raw)
			}
		}
	}
	return v, nil
}

// IsPrerelease reports whether the version carries a pre-release tag such as -rc.1.
func (v Version) IsPrerelease() bool { return len(v.Pre) > 0 }

// String renders the canonical form without a leading "v".
func (v Version) String() string {
	s := fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
	if len(v.Pre) > 0 {
		s += "-" + strings.Join(v.Pre, ".")
	}
	return s
}

// Compare returns -1, 0 or 1 following semver precedence (a stable release outranks its own pre-releases).
func (v Version) Compare(o Version) int {
	for _, p := range [][2]uint64{{v.Major, o.Major}, {v.Minor, o.Minor}, {v.Patch, o.Patch}} {
		if p[0] != p[1] {
			if p[0] < p[1] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(v.Pre) == 0 && len(o.Pre) == 0:
		return 0
	case len(v.Pre) == 0:
		return 1
	case len(o.Pre) == 0:
		return -1
	}
	for i := 0; i < len(v.Pre) && i < len(o.Pre); i++ {
		if c := comparePreID(v.Pre[i], o.Pre[i]); c != 0 {
			return c
		}
	}
	switch {
	case len(v.Pre) < len(o.Pre):
		return -1
	case len(v.Pre) > len(o.Pre):
		return 1
	}
	return 0
}

// comparePreID orders numeric identifiers numerically and below alphanumeric ones, as semver specifies.
func comparePreID(a, b string) int {
	an, aerr := strconv.ParseUint(a, 10, 64)
	bn, berr := strconv.ParseUint(b, 10, 64)
	switch {
	case aerr == nil && berr == nil:
		if an < bn {
			return -1
		} else if an > bn {
			return 1
		}
		return 0
	case aerr == nil:
		return -1
	case berr == nil:
		return 1
	}
	return strings.Compare(a, b)
}

// CompareVersions compares two version strings.
//
// @returns -1 if a < b, 0 if equal, 1 if a > b.
func CompareVersions(a, b string) (int, error) {
	va, err := ParseVersion(a)
	if err != nil {
		return 0, err
	}
	vb, err := ParseVersion(b)
	if err != nil {
		return 0, err
	}
	return va.Compare(vb), nil
}
