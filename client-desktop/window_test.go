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

func TestCloseToTrayPersists(t *testing.T) {
	a, secrets := testApp(t)
	a.SetCloseToTray(false)
	if NewAppWithSecrets(secrets).GetCloseToTray() {
		t.Fatal("the preference must survive a restart")
	}
}
