package main

import (
	"runtime"
	"testing"

	"cove/desktop/internal/popup"
)

func TestCustomNotificationsDefaultOnWhereAvailable(t *testing.T) {
	want := runtime.GOOS == "windows" || runtime.GOOS == "linux"
	if got := customNotifications(Config{}); got != want {
		t.Fatalf("default = %v, want %v (macOS keeps native notifications)", got, want)
	}
	off := false
	if customNotifications(Config{CustomNotifications: &off}) {
		t.Fatal("an explicit off must use system notifications")
	}
}

func TestCustomNotificationsPreferencePersists(t *testing.T) {
	a, _ := testApp(t)
	a.SetCustomNotifications(false)
	if NewAppWithSecrets(newMemSecrets()).GetCustomNotifications() {
		t.Fatal("the choice must survive a restart")
	}
}

func TestNotificationTargetCarriesOnlyRouting(t *testing.T) {
	got := notificationTarget(popup.Item{Kind: popup.KindCall, ChannelID: "c1", Title: "secret", Body: "secret"})
	if len(got) != 2 || got["kind"] != "call" || got["channel_id"] != "c1" {
		t.Fatalf("target = %v", got)
	}
}
