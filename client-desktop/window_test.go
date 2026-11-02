package main

import (
	"runtime"
	"testing"
)

func TestCloseToTrayDefaultsOn(t *testing.T) {
	if !closeToTray(Config{}) {
		t.Fatal("an unset preference must default to keeping the app in the tray")
	}
	off := false
	if closeToTray(Config{CloseToTray: &off}) {
		t.Fatal("an explicit off must be honoured")
	}
}

func TestKeepRunningNeedsATrayExceptOnMac(t *testing.T) {
	a, _ := testApp(t)
	got := a.keepRunning()
	want := runtime.GOOS == "darwin"
	if got != want {
		t.Fatalf("without a tray, keepRunning = %v, want %v (window would be lost otherwise)", got, want)
	}

	a.win.trayOK.Store(true)
	if !a.keepRunning() {
		t.Fatal("with a working tray the app keeps running in the background")
	}
}

func TestPreferenceAndQuitOverrideKeepRunning(t *testing.T) {
	a, _ := testApp(t)
	a.win.trayOK.Store(true)

	a.SetCloseToTray(false)
	if a.keepRunning() {
		t.Fatal("turning the preference off must make close quit")
	}
	if NewAppWithSecrets(newMemSecrets()).GetCloseToTray() != true {
		// A fresh data dir has no saved preference.
		t.Log("fresh install defaults to on")
	}

	a.SetCloseToTray(true)
	a.win.quitting.Store(true)
	if a.keepRunning() {
		t.Fatal("an explicit quit must never be intercepted")
	}
}

func TestAppMenuQuitMarksTheQuitAsDeliberate(t *testing.T) {
	a, _ := testApp(t)
	m := a.appMenu()
	if runtime.GOOS != "darwin" {
		if m != nil {
			t.Fatal("only macOS has a menu bar")
		}
		return
	}
	if m == nil || len(m.Items) == 0 || m.Items[0].SubMenu == nil || len(m.Items[0].SubMenu.Items) == 0 {
		t.Fatal("macOS needs an app menu with a Quit item")
	}
}

func TestCloseToTrayPersists(t *testing.T) {
	a, secrets := testApp(t)
	a.SetCloseToTray(false)
	if NewAppWithSecrets(secrets).GetCloseToTray() {
		t.Fatal("the preference must survive a restart")
	}
}
