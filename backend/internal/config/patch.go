package config

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

// Change sets one key in one TOML table of the config file.
type Change struct {
	Section string // table name, e.g. "registration" or "server"
	Key     string
	Value   any // string, bool, int, int64, float64 or []string
}

var (
	sectionHeaderRe = regexp.MustCompile(`^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$`)
	arrayHeaderRe   = regexp.MustCompile(`^\s*\[\[`)
)

// PatchFile applies changes to the TOML file at path while keeping every
// comment, blank line and unrelated key exactly as the operator wrote it
// (re-encoding the whole struct would drop all of them).
//
// Safety properties, because this runs from the admin panel:
//   - the result must still decode into Config, otherwise the file is left
//     untouched and the error is returned;
//   - the previous file is kept as <path>.bak;
//   - the new file is written to a temp file in the same directory and renamed
//     over the original, so a crash can never leave a half-written config;
//   - the file is created/kept with mode 0600 (it can hold secrets).
//
// Keys are only matched inside their own [section], so "mode" under
// [voice] never touches "mode" under [registration]. A missing key is
// appended to its section, and a missing section is appended to the file.
func PatchFile(path string, changes []Change) error {
	original, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("config: read %s: %w", path, err)
	}
	existed := err == nil

	lines := splitLines(string(original))
	for _, c := range changes {
		encoded, err := encodeValue(c.Value)
		if err != nil {
			return fmt.Errorf("config: %s.%s: %w", c.Section, c.Key, err)
		}
		lines = setKey(lines, c.Section, c.Key, encoded)
	}
	patched := strings.Join(lines, "\n")
	if !strings.HasSuffix(patched, "\n") {
		patched += "\n"
	}

	// Validate before touching the real file.
	var probe Config
	if _, err := toml.Decode(patched, &probe); err != nil {
		return fmt.Errorf("config: patched file is not valid: %w", err)
	}

	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("config: create temp file: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.WriteString(patched); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("config: write temp file: %w", err)
	}
	if err := tmp.Chmod(0600); err != nil {
		// Not supported on every platform (Windows); the create mode already limits access there.
		_ = err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("config: close temp file: %w", err)
	}

	if existed {
		if err := os.WriteFile(path+".bak", original, 0600); err != nil {
			cleanup()
			return fmt.Errorf("config: write backup: %w", err)
		}
	}
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return fmt.Errorf("config: replace %s: %w", path, err)
	}
	return nil
}

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

// setKey returns lines with section.key set to the already-encoded value.
func setKey(lines []string, section, key, encoded string) []string {
	keyRe := regexp.MustCompile(`^(\s*)` + regexp.QuoteMeta(key) + `\s*=`)

	current := "" // top level before the first header
	sectionStart, sectionEnd := -1, -1
	for i, line := range lines {
		if m := sectionHeaderRe.FindStringSubmatch(line); m != nil && !strings.HasPrefix(strings.TrimSpace(line), "#") {
			if sectionStart >= 0 && sectionEnd < 0 {
				sectionEnd = i
			}
			// Array-of-table headers ([[x]]) are never a target for scalar keys.
			if arrayHeaderRe.MatchString(line) {
				current = "[[" + m[1] + "]]"
			} else {
				current = m[1]
			}
			if current == section && sectionStart < 0 {
				sectionStart = i
			}
			continue
		}
		if current == section {
			if m := keyRe.FindStringSubmatch(line); m != nil {
				lines[i] = m[1] + key + " = " + encoded
				return lines
			}
		}
	}

	if sectionStart >= 0 {
		if sectionEnd < 0 {
			sectionEnd = len(lines)
		}
		// Insert after the last non-blank line of the section.
		insertAt := sectionEnd
		for insertAt > sectionStart+1 && strings.TrimSpace(lines[insertAt-1]) == "" {
			insertAt--
		}
		out := append([]string{}, lines[:insertAt]...)
		out = append(out, key+" = "+encoded)
		return append(out, lines[insertAt:]...)
	}

	if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) != "" {
		lines = append(lines, "")
	}
	return append(lines, "["+section+"]", key+" = "+encoded)
}

// encodeValue renders a Go value as a TOML literal.
func encodeValue(v any) (string, error) {
	switch x := v.(type) {
	case string:
		return quoteString(x), nil
	case bool:
		return strconv.FormatBool(x), nil
	case int:
		return strconv.Itoa(x), nil
	case int64:
		return strconv.FormatInt(x, 10), nil
	case float64:
		return strconv.FormatFloat(x, 'g', -1, 64), nil
	case []string:
		parts := make([]string, len(x))
		for i, s := range x {
			parts[i] = quoteString(s)
		}
		return "[" + strings.Join(parts, ", ") + "]", nil
	default:
		return "", fmt.Errorf("unsupported value type %T", v)
	}
}

// quoteString writes a TOML basic string. Control characters and anything
// that could end the string early are escaped.
func quoteString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 || r == 0x7f {
				fmt.Fprintf(&b, `\u%04X`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}
