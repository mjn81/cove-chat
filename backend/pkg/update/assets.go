package update

import "fmt"

// ServerAsset names the server zip and the single binary inside it for a platform, mirroring
// .github/workflows/release.yml (linux/windows/darwin x amd64/arm64, minus windows/arm64).
//
// @returns ok=false when the release pipeline builds nothing for that platform.
func ServerAsset(goos, goarch string) (zip, entry string, ok bool) {
	switch goos {
	case "linux", "darwin":
	case "windows":
		if goarch != "amd64" {
			return "", "", false
		}
	default:
		return "", "", false
	}
	if goarch != "amd64" && goarch != "arm64" {
		return "", "", false
	}
	entry = fmt.Sprintf("cove-server-%s-%s", goos, goarch)
	if goos == "windows" {
		entry += ".exe"
	}
	return fmt.Sprintf("cove-server-%s-%s.zip", goos, goarch), entry, true
}

// DesktopAsset names the desktop zip and what it contains for a platform. On macOS the entry is the Cove.app
// bundle (a directory); elsewhere it is the single executable.
//
// @returns ok=false for platforms without a desktop build (anything but windows/amd64, linux/amd64, macOS).
func DesktopAsset(goos, goarch string) (zip, entry string, ok bool) {
	switch {
	case goos == "windows" && goarch == "amd64":
		return "cove-desktop-windows-amd64.zip", "Cove.exe", true
	case goos == "linux" && goarch == "amd64":
		return "cove-desktop-linux-amd64.zip", "Cove", true
	case goos == "darwin":
		return "cove-desktop-mac-universal.zip", "Cove.app", true
	}
	return "", "", false
}
