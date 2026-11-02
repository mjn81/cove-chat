package main

import "testing"

func TestResolveUpdateSettingsDefaults(t *testing.T) {
	s := resolveUpdateSettings(Config{}, "0.9.9")
	if !s.Enabled || !s.IncludePrerelease {
		t.Errorf("0.x defaults = %+v, want both on (every 0.x release is a GitHub pre-release)", s)
	}
	s = resolveUpdateSettings(Config{}, "1.4.0")
	if !s.Enabled || s.IncludePrerelease {
		t.Errorf("stable defaults = %+v, want enabled with pre-releases off", s)
	}
	s = resolveUpdateSettings(Config{}, "1.4.0-rc.2")
	if !s.IncludePrerelease {
		t.Errorf("a pre-release build should default to pre-releases on: %+v", s)
	}
}

func TestResolveUpdateSettingsExplicitChoicesWin(t *testing.T) {
	off, on := false, true
	s := resolveUpdateSettings(Config{AutoUpdate: &off, UpdatePrerelease: &off}, "0.9.9")
	if s.Enabled || s.IncludePrerelease {
		t.Errorf("explicit off ignored: %+v", s)
	}
	s = resolveUpdateSettings(Config{UpdatePrerelease: &on}, "2.0.0")
	if !s.Enabled || !s.IncludePrerelease {
		t.Errorf("explicit pre-release opt-in ignored: %+v", s)
	}
}

func TestInstallTarget(t *testing.T) {
	cases := []struct{ goos, exe, want string }{
		{"windows", `C:\Apps\Cove\Cove.exe`, `C:\Apps\Cove\Cove.exe`},
		{"linux", "/opt/cove/Cove", "/opt/cove/Cove"},
		{"darwin", "/Applications/Cove.app/Contents/MacOS/Cove", "/Applications/Cove.app"},
		{"darwin", "/tmp/dev/Cove", ""}, // a bare binary is not a bundle: no automatic update
	}
	for _, c := range cases {
		if got := installTarget(c.goos, c.exe); got != c.want {
			t.Errorf("installTarget(%s, %s) = %q, want %q", c.goos, c.exe, got, c.want)
		}
	}
}
