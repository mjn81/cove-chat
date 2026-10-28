package api

import (
	"sync"

	"cove/backend/internal/config"
)

// SettingsInit seeds Settings from the loaded config.
type SettingsInit struct {
	RegistrationMode    string
	MaxFileSizeMB       int
	MaxVideoSizeMB      int
	MaxVideoDurationSec int
}

// Settings holds the configuration values that can change while the server
// runs (edited from the admin panel). Request handlers read them through the
// accessors, so a change applies to the very next request without a restart.
// Everything else in config.toml still needs a restart.
type Settings struct {
	mu   sync.RWMutex
	init SettingsInit
}

// NewSettings creates the live settings. An empty or unknown registration
// mode falls back to "open", matching the config default.
func NewSettings(init SettingsInit) *Settings {
	switch init.RegistrationMode {
	case config.RegistrationOpen, config.RegistrationInviteOnly, config.RegistrationClosed:
	default:
		init.RegistrationMode = config.RegistrationOpen
	}
	return &Settings{init: init}
}

// RegistrationMode returns "open", "invite_only" or "closed".
func (s *Settings) RegistrationMode() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.init.RegistrationMode
}

// SetRegistrationMode updates the mode; invalid values are ignored and reported.
func (s *Settings) SetRegistrationMode(mode string) bool {
	switch mode {
	case config.RegistrationOpen, config.RegistrationInviteOnly, config.RegistrationClosed:
	default:
		return false
	}
	s.mu.Lock()
	s.init.RegistrationMode = mode
	s.mu.Unlock()
	return true
}

// Limits returns the upload and video limits currently in force.
func (s *Settings) Limits() (maxFileMB, maxVideoMB, maxVideoSec int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.init.MaxFileSizeMB, s.init.MaxVideoSizeMB, s.init.MaxVideoDurationSec
}

// SetLimits replaces the upload and video limits; non-positive values are ignored.
func (s *Settings) SetLimits(maxFileMB, maxVideoMB, maxVideoSec int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxFileMB > 0 {
		s.init.MaxFileSizeMB = maxFileMB
	}
	if maxVideoMB > 0 {
		s.init.MaxVideoSizeMB = maxVideoMB
	}
	if maxVideoSec > 0 {
		s.init.MaxVideoDurationSec = maxVideoSec
	}
}

// registrationMode is the mode the handlers use; handlers built without
// Settings (older tests, tools) behave as an open server.
func (h *Handler) registrationMode() string {
	if h.Settings == nil {
		return config.RegistrationOpen
	}
	return h.Settings.RegistrationMode()
}

// limits returns the upload/video limits: live settings when present,
// otherwise the values the Handler was built with.
func (h *Handler) limits() (maxFileMB, maxVideoMB, maxVideoSec int) {
	if h.Settings != nil {
		return h.Settings.Limits()
	}
	return h.MaxFileSizeMB, h.MaxVideoSizeMB, h.MaxVideoDurationSec
}
