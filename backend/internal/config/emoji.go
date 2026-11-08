package config

import (
	"fmt"
	"strings"
)

// EmojiStyleIDs are the emoji styles a server can offer: "native" (the device's own font, no download) and the
// styles embedded in the binary (internal/packs; a test keeps the two lists in step).
var EmojiStyleIDs = []string{"native", "noto", "twemoji", "blobmoji", "fluent", "fxemoji"}

// DefaultEmojiStyle is the style users get until they pick one.
const DefaultEmojiStyle = "noto"

// EmojiConfig decides which emoji styles users can choose. Editable from the admin panel and applied live.
type EmojiConfig struct {
	// EnabledStyles lists the style ids users may pick (see EmojiStyleIDs).
	EnabledStyles []string `toml:"enabled_styles"`
	// DefaultStyle is the style new devices start with; it must be one of EnabledStyles.
	DefaultStyle string `toml:"default_style"`
}

// PacksConfig limits sticker packs that users make themselves. Editable from the admin panel and applied live.
type PacksConfig struct {
	// UserUploadsEnabled lets users create sticker packs and upload stickers. Existing packs stay usable when off.
	UserUploadsEnabled bool `toml:"user_uploads_enabled"`
	// MaxPacksPerUser caps the sticker packs one user may own.
	MaxPacksPerUser int `toml:"max_packs_per_user"`
	// MaxStickersPerPack caps the stickers in one user pack (server packs and custom emoji are admin-managed and exempt).
	MaxStickersPerPack int `toml:"max_stickers_per_pack"`
	// MaxUserStorageMB caps the total size of all stickers one user owns.
	MaxUserStorageMB int `toml:"max_user_storage_mb"`
}

// ValidateEmojiStyles checks an enabled-styles list and the default among them. At least one style must stay
// enabled (a server that wants no pictures enables only "native"), and the default must be one of them.
func ValidateEmojiStyles(enabled []string, def string) error {
	if len(enabled) == 0 {
		return fmt.Errorf("config: emoji.enabled_styles needs at least one style")
	}
	known := map[string]bool{}
	for _, id := range EmojiStyleIDs {
		known[id] = true
	}
	seen := map[string]bool{}
	for _, id := range enabled {
		if !known[id] {
			return fmt.Errorf("config: emoji.enabled_styles has unknown style %q (valid: %s)", id, strings.Join(EmojiStyleIDs, ", "))
		}
		if seen[id] {
			return fmt.Errorf("config: emoji.enabled_styles lists %q twice", id)
		}
		seen[id] = true
	}
	if !seen[def] {
		return fmt.Errorf("config: emoji.default_style %q must be one of emoji.enabled_styles", def)
	}
	return nil
}

// coerceList accepts a JSON array (or []string) of values that must all be in the setting's Options, without
// duplicates. The result is a []string so it can be written to the config file as a TOML array.
func coerceList(s Setting, v any) (any, error) {
	var raw []any
	switch x := v.(type) {
	case []string:
		for _, e := range x {
			raw = append(raw, e)
		}
	case []any:
		raw = x
	default:
		return nil, fmt.Errorf("must be a list of text values")
	}
	allowed := map[string]bool{}
	for _, o := range s.Options {
		allowed[o] = true
	}
	out := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, e := range raw {
		str, ok := e.(string)
		if !ok || !allowed[str] {
			return nil, fmt.Errorf("every entry must be one of %v", s.Options)
		}
		if seen[str] {
			return nil, fmt.Errorf("%q is listed twice", str)
		}
		seen[str] = true
		out = append(out, str)
	}
	return out, nil
}

// CheckEmojiChange validates the emoji settings as they would be after applying changes on top of current. The
// enabled list and the default depend on each other, and a combination that fails config validation would stop the
// server from starting, so the panel must refuse it before anything is written.
func CheckEmojiChange(current *Config, changes []ValidatedChange) error {
	enabled, def := current.Emoji.EnabledStyles, current.Emoji.DefaultStyle
	touched := false
	for _, c := range changes {
		switch c.Setting.Key {
		case "emoji.enabled_styles":
			enabled, touched = c.Value.([]string), true
		case "emoji.default_style":
			def, touched = c.Value.(string), true
		}
	}
	if !touched {
		return nil
	}
	return ValidateEmojiStyles(enabled, def)
}
