package config

import (
	"fmt"
	"math"
	"os"
	"sort"

	"github.com/BurntSushi/toml"
)

// Setting describes one config key the admin panel may edit. Anything not
// listed here (master password, TURN secret, S3 keys, database and upload
// paths) can never be read or written through the panel.
type Setting struct {
	Key     string   `json:"key"`     // "section.key", e.g. "registration.mode"
	Section string   `json:"section"` // TOML table
	Name    string   `json:"name"`    // TOML key
	Group   string   `json:"group"`   // panel grouping
	Type    string   `json:"type"`    // "enum" | "int" | "bool" | "string"
	Options []string `json:"options,omitempty"`
	Min     int      `json:"min,omitempty"`
	Max     int      `json:"max,omitempty"`
	// OwnerOnly keys change network exposure or session security, so only the
	// owner (with their password) may touch them.
	OwnerOnly bool `json:"owner_only"`
	// RestartRequired keys are saved to the file but only take effect after a
	// restart. The others are applied live.
	RestartRequired bool `json:"restart_required"`

	get func(*Config) any
}

// Value returns the setting's current value in c.
func (s Setting) Value(c *Config) any { return s.get(c) }

var schema = []Setting{
	{Key: "registration.mode", Group: "registration", Type: "enum",
		Options: []string{RegistrationOpen, RegistrationInviteOnly, RegistrationClosed},
		get:     func(c *Config) any { return c.Registration.Mode }},

	{Key: "server.max_file_size_mb", Group: "limits", Type: "int", Min: 1, Max: 4096,
		get: func(c *Config) any { return c.Server.MaxFileSizeMB }},
	{Key: "server.max_video_size_mb", Group: "limits", Type: "int", Min: 1, Max: 2048,
		get: func(c *Config) any { return c.Server.MaxVideoSizeMB }},
	{Key: "server.max_video_duration_sec", Group: "limits", Type: "int", Min: 5, Max: 900,
		get: func(c *Config) any { return c.Server.MaxVideoDurationSec }},

	{Key: "rate_limit.global_rps", Group: "limits", Type: "int", Min: 1, Max: 100000, RestartRequired: true,
		get: func(c *Config) any { return c.RateLimit.GlobalRPS }},
	{Key: "rate_limit.auth_rps", Group: "limits", Type: "int", Min: 1, Max: 1000, RestartRequired: true,
		get: func(c *Config) any { return c.RateLimit.AuthRPS }},

	{Key: "voice.mode", Group: "calls", Type: "enum", Options: []string{"webrtc", "raw_udp"}, RestartRequired: true,
		get: func(c *Config) any { return c.Voice.Mode }},
	{Key: "voice.max_participants_per_call", Group: "calls", Type: "int", Min: 2, Max: 200, RestartRequired: true,
		get: func(c *Config) any { return c.Voice.MaxParticipantsPerCall }},
	{Key: "voice.public_ip", Group: "calls", Type: "string", RestartRequired: true,
		get: func(c *Config) any { return c.Voice.PublicIP }},
	{Key: "voice.embedded_turn_enabled", Group: "calls", Type: "bool", RestartRequired: true,
		get: func(c *Config) any { return c.Voice.EmbeddedTURNEnabled }},

	{Key: "server.domain", Group: "network", Type: "string", OwnerOnly: true, RestartRequired: true,
		get: func(c *Config) any { return c.Server.Domain }},
	{Key: "server.frontend_origin", Group: "network", Type: "string", OwnerOnly: true, RestartRequired: true,
		get: func(c *Config) any { return c.Server.FrontendOrigin }},
	{Key: "server.trust_proxy_headers", Group: "network", Type: "bool", OwnerOnly: true, RestartRequired: true,
		get: func(c *Config) any { return c.Server.TrustProxyHeaders }},
	{Key: "server.http_port", Group: "network", Type: "int", Min: 1, Max: 65535, OwnerOnly: true, RestartRequired: true,
		get: func(c *Config) any { return c.Server.HTTPPort }},
	{Key: "server.dev", Group: "network", Type: "bool", OwnerOnly: true, RestartRequired: true,
		get: func(c *Config) any { return c.Server.Dev }},
	{Key: "security.token_expire_hours", Group: "security", Type: "int", Min: 1, Max: 8760, OwnerOnly: true, RestartRequired: true,
		get: func(c *Config) any { return c.Security.TokenExpireHours }},
}

func init() {
	for i := range schema {
		s := &schema[i]
		for j := 0; j < len(s.Key); j++ {
			if s.Key[j] == '.' {
				s.Section, s.Name = s.Key[:j], s.Key[j+1:]
				break
			}
		}
	}
}

// Schema returns the editable settings in display order (a copy, safe to modify).
func Schema() []Setting { return append([]Setting(nil), schema...) }

// LookupSetting finds an editable setting by its "section.key".
func LookupSetting(key string) (Setting, bool) {
	for _, s := range schema {
		if s.Key == key {
			return s, true
		}
	}
	return Setting{}, false
}

// Read decodes the config file at path on top of the defaults without any
// side effects (no secret generation, no rewriting). The admin panel uses it
// to show what is saved on disk, including values that still await a restart.
func Read(path string) (*Config, error) {
	cfg := defaults()
	if _, err := toml.DecodeFile(path, cfg); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("config: failed to decode %s: %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// ValidatedChange is one accepted edit plus the schema entry it matched.
type ValidatedChange struct {
	Change
	Setting Setting
}

// ValidateChanges checks a whole edit request against the schema. It is
// all-or-nothing: the first problem rejects everything, so a half-applied
// request can never reach the file. JSON numbers arrive as float64 and are
// converted to int here.
func ValidateChanges(raw map[string]any) ([]ValidatedChange, error) {
	keys := make([]string, 0, len(raw))
	for k := range raw {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]ValidatedChange, 0, len(keys))
	for _, key := range keys {
		s, ok := LookupSetting(key)
		if !ok {
			return nil, fmt.Errorf("%q is not an editable setting", key)
		}
		val, err := coerce(s, raw[key])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", key, err)
		}
		out = append(out, ValidatedChange{Change: Change{Section: s.Section, Key: s.Name, Value: val}, Setting: s})
	}
	return out, nil
}

func coerce(s Setting, v any) (any, error) {
	switch s.Type {
	case "bool":
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("must be true or false")
		}
		return b, nil
	case "int":
		f, ok := v.(float64)
		if !ok || f != math.Trunc(f) {
			return nil, fmt.Errorf("must be a whole number")
		}
		n := int(f)
		if n < s.Min || n > s.Max {
			return nil, fmt.Errorf("must be between %d and %d", s.Min, s.Max)
		}
		return n, nil
	case "enum":
		str, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("must be text")
		}
		for _, o := range s.Options {
			if o == str {
				return str, nil
			}
		}
		return nil, fmt.Errorf("must be one of %v", s.Options)
	case "string":
		str, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("must be text")
		}
		if len(str) > 512 {
			return nil, fmt.Errorf("is too long")
		}
		return str, nil
	}
	return nil, fmt.Errorf("unsupported type %q", s.Type)
}
