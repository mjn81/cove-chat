package main

import "testing"

func TestVersionFromWailsConfig(t *testing.T) {
	got := versionFromWailsConfig([]byte(`{"info":{"productVersion":" 1.2.3 "}}`))
	if got != "1.2.3" {
		t.Fatalf("got %q", got)
	}
	if versionFromWailsConfig([]byte(`not json`)) != "" {
		t.Error("garbage must yield an empty version")
	}
}

func TestAppVersionPrefersTheStampedBuildVersion(t *testing.T) {
	old := buildVersion
	t.Cleanup(func() { buildVersion = old })

	buildVersion = "v2.0.0-rc.1"
	if got := appVersion(); got != "2.0.0-rc.1" {
		t.Errorf("stamped = %q", got)
	}
	buildVersion = ""
	if got := appVersion(); got == "" || got == "0.0.0-dev" {
		t.Errorf("fallback to the embedded wails.json failed: %q", got)
	}
}
