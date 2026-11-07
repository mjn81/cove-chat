package main

import (
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"

	"github.com/gen2brain/beeep"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"cove/desktop/internal/popup"
)

// openNotificationEvent is the Wails event the main window listens for to open the chat a clicked popup is about.
const openNotificationEvent = "notification:open"

// customNotificationsAvailable reports whether this platform can show Cove's own popups. macOS keeps its native
// notification centre, which is what Mac users expect.
func customNotificationsAvailable() bool { return runtime.GOOS == "windows" || runtime.GOOS == "linux" }

// customNotifications reports whether popups are in use: available and not switched off. It defaults to on.
func customNotifications(c Config) bool {
	return customNotificationsAvailable() && (c.CustomNotifications == nil || *c.CustomNotifications)
}

// notificationTarget is what the main window receives when a popup is clicked: enough to open the right chat.
// It repeats nothing beyond the ids already on the popup.
func notificationTarget(it popup.Item) map[string]string {
	return map[string]string{"kind": it.Kind, "channel_id": it.ChannelID}
}

// notifier returns the popup manager, creating it on first use.
func (a *App) notifier() *popup.Manager {
	a.popupOnce.Do(func() {
		a.popups = popup.NewManager(popup.Options{
			Launch:   launchPopupProcess,
			Fallback: systemNotify,
			OnClick:  a.openFromNotification,
		})
	})
	return a.popups
}

// openFromNotification brings the main window forward and tells the web UI which chat to open.
func (a *App) openFromNotification(it popup.Item) {
	if a.ctx == nil {
		return
	}
	a.showWindow()
	wruntime.EventsEmit(a.ctx, openNotificationEvent, notificationTarget(it))
}

// systemNotify shows the operating system's own notification.
func systemNotify(title, message string) { _ = beeep.Notify(title, message, "") }

// ShowNotification shows a plain desktop notification (kept for older web builds; see ShowDesktopNotification).
func (a *App) ShowNotification(title, message string) {
	a.ShowDesktopNotification(popup.Request{Title: title, Body: message})
}

// ShowDesktopNotification shows a notification as Cove's popup, or as the system notification when popups are
// off, unavailable, or cannot be created.
func (a *App) ShowDesktopNotification(req popup.Request) {
	if customNotifications(a.config) {
		a.notifier().Notify(req)
		return
	}
	systemNotify(req.Title, req.Body)
}

// CustomNotificationsAvailable reports whether the popup style can be chosen on this platform.
func (a *App) CustomNotificationsAvailable() bool { return customNotificationsAvailable() }

// GetCustomNotifications returns whether notifications appear as Cove popups instead of system notifications.
func (a *App) GetCustomNotifications() bool { return customNotifications(a.config) }

// SetCustomNotifications saves the notification style.
func (a *App) SetCustomNotifications(enabled bool) {
	a.config.CustomNotifications = &enabled
	a.saveConfig()
}

// procTransport is the pipe to a running popup process.
type procTransport struct {
	cmd  *exec.Cmd
	mu   sync.Mutex
	in   io.WriteCloser
	done chan struct{}
}

// Send writes one command as a JSON line.
func (p *procTransport) Send(m popup.Msg) error {
	line, err := json.Marshal(m)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	_, err = p.in.Write(append(line, '\n'))
	return err
}

// Close ends the process: closing its stdin makes it quit on its own, and it is killed if it does not.
func (p *procTransport) Close() {
	p.mu.Lock()
	_ = p.in.Close()
	p.mu.Unlock()
	go func() {
		select {
		case <-p.done:
		case <-time.After(3 * time.Second):
			_ = p.cmd.Process.Kill()
		}
	}()
}

// launchPopupProcess starts this executable again in popup mode.
func launchPopupProcess(emit func(popup.Event)) (popup.Transport, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(exe, popup.Flag)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	tr := &procTransport{cmd: cmd, in: in, done: make(chan struct{})}
	go func() {
		popup.ReadEvents(out, emit)
		_ = cmd.Wait()
		close(tr.done)
		emit(popup.Event{Event: popup.EventExit})
	}()
	return tr, nil
}
