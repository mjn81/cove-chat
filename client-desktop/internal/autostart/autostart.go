// Package autostart registers Cove to start when the user logs in, minimised to the tray (--hidden).
package autostart

import (
	"fmt"
	"strings"
)

// HiddenFlag makes the app start without showing its window.
const HiddenFlag = "--hidden"

// desktopEntry is the freedesktop autostart file for exe.
func desktopEntry(exe string) string {
	return fmt.Sprintf("[Desktop Entry]\nType=Application\nName=Cove\nComment=Self-hosted, encrypted communication\nExec=%s %s\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
		quoteExec(exe), HiddenFlag)
}

// quoteExec quotes a path for a .desktop Exec line, where spaces and a few characters need escaping.
func quoteExec(exe string) string {
	if !strings.ContainsAny(exe, " \t\"'\\$`") {
		return exe
	}
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "`", "\\`", "$", `\$`)
	return `"` + r.Replace(exe) + `"`
}

// launchAgentPlist is the macOS LaunchAgent that starts exe at login.
func launchAgentPlist(exe string) string {
	esc := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(exe)
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>com.cove.chat.desktop</string>
	<key>ProgramArguments</key>
	<array><string>` + esc + `</string><string>` + HiddenFlag + `</string></array>
	<key>RunAtLoad</key><true/>
</dict>
</plist>
`
}

// windowsRunValue is the registry value that starts exe at login.
func windowsRunValue(exe string) string { return `"` + exe + `" ` + HiddenFlag }
