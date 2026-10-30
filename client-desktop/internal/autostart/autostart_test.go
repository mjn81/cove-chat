package autostart

import (
	"strings"
	"testing"
)

func TestDesktopEntryStartsHiddenAndQuotesSpaces(t *testing.T) {
	e := desktopEntry("/opt/My Apps/Cove")
	if !strings.Contains(e, `Exec="/opt/My Apps/Cove" --hidden`) {
		t.Fatalf("entry = %q", e)
	}
	if plain := desktopEntry("/usr/bin/cove"); !strings.Contains(plain, "Exec=/usr/bin/cove --hidden") {
		t.Fatalf("plain path must not be quoted: %q", plain)
	}
}

func TestWindowsRunValueQuotesPath(t *testing.T) {
	got := windowsRunValue(`C:\Program Files\Cove\Cove.exe`)
	if got != `"C:\Program Files\Cove\Cove.exe" --hidden` {
		t.Fatalf("value = %q", got)
	}
}

func TestLaunchAgentEscapesAndRunsAtLoad(t *testing.T) {
	p := launchAgentPlist("/Applications/Cove & Co/Cove")
	for _, want := range []string{"<key>RunAtLoad</key><true/>", "/Applications/Cove &amp; Co/Cove", "--hidden", "com.cove.chat.desktop"} {
		if !strings.Contains(p, want) {
			t.Errorf("plist missing %q", want)
		}
	}
}
