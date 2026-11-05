package main

import (
	_ "embed"
	"encoding/json"
	"strings"
)

// buildVersion is stamped by the release build (-ldflags "-X main.buildVersion=1.2.3-rc.1"), so pre-release
// suffixes survive; wails.json's productVersion cannot carry them (Windows file metadata is numeric only).
var buildVersion string

// wailsConfig is embedded as the fallback for plain `wails build` / `wails dev`, where nothing sets buildVersion.
// scripts/sync-version.mjs keeps its productVersion equal to the root VERSION file.
//
//go:embed wails.json
var wailsConfig []byte

// versionFromWailsConfig reads info.productVersion from wails.json.
func versionFromWailsConfig(data []byte) string {
	var cfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if json.Unmarshal(data, &cfg) != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Info.ProductVersion)
}

// appVersion is the running desktop version: the stamped build version, else wails.json, else a dev placeholder
// (which sorts below every release, so a dev build is always offered the newest one).
func appVersion() string {
	if v := strings.TrimPrefix(strings.TrimSpace(buildVersion), "v"); v != "" {
		return v
	}
	if v := versionFromWailsConfig(wailsConfig); v != "" {
		return v
	}
	return "0.0.0-dev"
}
