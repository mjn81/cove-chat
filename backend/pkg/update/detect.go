package update

import (
	"os"
	"path/filepath"
	"strings"
)

// InstallMode says how the running server was installed, which decides whether it may replace itself.
type InstallMode string

// Install modes.
const (
	// ModeBinary is a plain executable (run by hand, systemd, a Windows service...) in a writable directory.
	ModeBinary InstallMode = "binary"
	// ModeDocker is a container: the image is the unit of deployment, so the binary must never be replaced in place.
	ModeDocker InstallMode = "docker"
	// ModeUnknown is anything we cannot safely update (go run, read-only install dir, ...).
	ModeUnknown InstallMode = "unknown"
)

// Probe abstracts the host so DetectInstallMode is testable.
type Probe struct {
	Exists      func(path string) bool
	ReadFile    func(path string) ([]byte, error)
	Getenv      func(key string) string
	DirWritable func(dir string) bool
	TempDir     string
}

// OSProbe inspects the real host.
func OSProbe() Probe {
	return Probe{
		Exists:   func(p string) bool { _, err := os.Stat(p); return err == nil },
		ReadFile: os.ReadFile,
		Getenv:   os.Getenv,
		DirWritable: func(dir string) bool {
			f, err := os.CreateTemp(dir, ".cove-write-test-*")
			if err != nil {
				return false
			}
			name := f.Name()
			_ = f.Close()
			_ = os.Remove(name)
			return true
		},
		TempDir: os.TempDir(),
	}
}

// DetectInstallMode classifies the running install. Container detection looks for /.dockerenv, container
// markers in /proc/1/cgroup, and COVE_IN_DOCKER=1 for runtimes that expose neither (an explicit override).
//
// Parameter exe: absolute path of the running executable
func DetectInstallMode(p Probe, exe string) InstallMode {
	if p.Exists("/.dockerenv") || p.Getenv("COVE_IN_DOCKER") == "1" {
		return ModeDocker
	}
	if b, err := p.ReadFile("/proc/1/cgroup"); err == nil {
		s := string(b)
		if strings.Contains(s, "docker") || strings.Contains(s, "kubepods") || strings.Contains(s, "containerd") || strings.Contains(s, "/lxc/") {
			return ModeDocker
		}
	}
	if exe == "" {
		return ModeUnknown
	}
	// `go run` builds into a throwaway directory under the temp dir; replacing that would be pointless.
	if strings.Contains(filepath.ToSlash(exe), "/go-build") ||
		(p.TempDir != "" && strings.HasPrefix(filepath.Clean(exe), filepath.Clean(p.TempDir)+string(filepath.Separator))) {
		return ModeUnknown
	}
	if !p.DirWritable(filepath.Dir(exe)) {
		return ModeUnknown
	}
	return ModeBinary
}
