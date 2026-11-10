// Package bots implements the pure parts of the Bot API: input validation, event payloads, the gateway and the
// webhook sender. HTTP handlers live in internal/api; persistence in internal/store.
package bots

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"cove/backend/internal/models"
)

// Limits, all enforced before anything touches the store. They are part of the documented contract (docs/bots-api.md).
const (
	MaxTextRunes        = 4000
	MaxDescriptionRunes = 400
	MaxButtonRows       = 5
	MaxButtonsPerRow    = 5
	MaxKeyboardRows     = 8
	MaxKeyboardCols     = 8
	MaxLabelRunes       = 80
	MaxCustomIDBytes    = 100
	MaxURLBytes         = 2048
	MaxCommands         = 100
	MaxOptions          = 25
	MaxChoices          = 25
	MaxPlaceholderRunes = 64
	MaxOptionValueRunes = 2000
	// MaxRichBodyBytes caps the encoded JSON body of a `bot` message.
	MaxRichBodyBytes = 16 << 10
)

var (
	botNameRe  = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{1,31}$`)
	cmdNameRe  = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
	customIDRe = regexp.MustCompile(`^[\x21-\x7e]+$`) // printable ASCII, no spaces
)

// ErrInvalid wraps every validation failure; its message is safe to show to the API caller.
var ErrInvalid = errors.New("invalid")

func bad(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Reason returns the caller-facing text of a validation error.
func Reason(err error) string { return strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ") }

// ValidBotName reports whether name is an acceptable bot username: 2-32 lower-case letters, digits, `_`, `.`, `-`,
// starting with a letter or digit. Lower case only, so a bot cannot imitate a person by capitalisation.
func ValidBotName(name string) bool { return botNameRe.MatchString(name) }

// ValidateDescription bounds a bot description.
func ValidateDescription(d string) error {
	if utf8.RuneCountInString(d) > MaxDescriptionRunes {
		return bad("description is longer than %d characters", MaxDescriptionRunes)
	}
	return nil
}

// ValidateScopes normalises an install scope list: unknown scopes are rejected, duplicates dropped, and an empty list
// means the default (`messages.send`).
func ValidateScopes(in []string) ([]string, error) {
	if len(in) == 0 {
		return []string{models.ScopeMessagesSend}, nil
	}
	known := map[string]bool{}
	for _, s := range models.AllBotScopes {
		known[s] = true
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !known[s] {
			return nil, bad("unknown scope %q", s)
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out, nil
}

// ValidateWebhookURL accepts only absolute HTTPS URLs without credentials. Plain http is accepted for loopback when
// allowLoopbackHTTP (development servers). An empty URL is valid and means "no webhook".
func ValidateWebhookURL(raw string, allowLoopbackHTTP bool) error {
	if raw == "" {
		return nil
	}
	if len(raw) > MaxURLBytes {
		return bad("webhook URL is too long")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" {
		return bad("webhook URL is not a valid address")
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		host := u.Hostname()
		if allowLoopbackHTTP && (host == "localhost" || host == "127.0.0.1" || host == "::1") {
			return nil
		}
		return bad("webhook URL must use https")
	}
	return bad("webhook URL must use https")
}

func validSafeURL(raw string) bool {
	if raw == "" || len(raw) > MaxURLBytes {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

func cleanText(s string) bool {
	for _, r := range s {
		if r == 0 || (r < 0x20 && r != '\n' && r != '\t' && r != '\r') {
			return false
		}
	}
	return utf8.ValidString(s)
}

// ValidateButtons checks a button grid and returns it with unknown styles normalised to "secondary". maxRows and
// maxCols bound the grid; urlAllowed is false for keyboards, whose buttons are always callbacks.
func ValidateButtons(rows [][]models.Button, maxRows, maxCols int, urlAllowed bool) ([][]models.Button, error) {
	if len(rows) > maxRows {
		return nil, bad("at most %d button rows", maxRows)
	}
	out := make([][]models.Button, 0, len(rows))
	ids := map[string]bool{}
	for _, row := range rows {
		if len(row) == 0 || len(row) > maxCols {
			return nil, bad("each button row needs 1 to %d buttons", maxCols)
		}
		nr := make([]models.Button, 0, len(row))
		for _, b := range row {
			if n := utf8.RuneCountInString(strings.TrimSpace(b.Label)); n < 1 || n > MaxLabelRunes || !cleanText(b.Label) {
				return nil, bad("a button label must be 1 to %d characters", MaxLabelRunes)
			}
			hasID, hasURL := b.CustomID != "", b.URL != ""
			if hasID == hasURL {
				return nil, bad("a button needs exactly one of custom_id or url")
			}
			if hasURL {
				if !urlAllowed || !validSafeURL(b.URL) {
					return nil, bad("a button url must be an http or https address")
				}
			} else {
				if len(b.CustomID) > MaxCustomIDBytes || !customIDRe.MatchString(b.CustomID) {
					return nil, bad("custom_id must be 1 to %d printable characters without spaces", MaxCustomIDBytes)
				}
				if ids[b.CustomID] {
					return nil, bad("custom_id %q is used twice", b.CustomID)
				}
				ids[b.CustomID] = true
			}
			switch b.Style {
			case models.ButtonPrimary, models.ButtonSecondary, models.ButtonDanger:
			default:
				b.Style = models.ButtonSecondary
			}
			b.Label = strings.TrimSpace(b.Label)
			nr = append(nr, b)
		}
		out = append(out, nr)
	}
	return out, nil
}

// ValidateMessage checks the content a bot wants to post. A message needs text or buttons.
func ValidateMessage(text string, buttons [][]models.Button) ([][]models.Button, error) {
	if !cleanText(text) {
		return nil, bad("text contains invalid characters")
	}
	if utf8.RuneCountInString(text) > MaxTextRunes {
		return nil, bad("text is longer than %d characters", MaxTextRunes)
	}
	if strings.TrimSpace(text) == "" && len(buttons) == 0 {
		return nil, bad("a message needs text or buttons")
	}
	if len(buttons) == 0 {
		return nil, nil
	}
	return ValidateButtons(buttons, MaxButtonRows, MaxButtonsPerRow, true)
}

// ValidateKeyboard checks and normalises an action menu.
func ValidateKeyboard(k *models.Keyboard) error {
	if len(k.Rows) == 0 {
		return bad("a keyboard needs at least one row")
	}
	if utf8.RuneCountInString(k.Placeholder) > MaxPlaceholderRunes || !cleanText(k.Placeholder) {
		return bad("placeholder is longer than %d characters", MaxPlaceholderRunes)
	}
	rows, err := ValidateButtons(k.Rows, MaxKeyboardRows, MaxKeyboardCols, false)
	if err != nil {
		return err
	}
	k.Rows = rows
	return nil
}

// ValidateCommand checks one command definition.
func ValidateCommand(c *models.BotCommand) error {
	if !cmdNameRe.MatchString(c.Name) {
		return bad("command name %q must be 1 to 32 characters of a-z, 0-9, _ or -", c.Name)
	}
	if n := utf8.RuneCountInString(c.Description); n < 1 || n > 100 || !cleanText(c.Description) {
		return bad("command %q needs a description of 1 to 100 characters", c.Name)
	}
	if len(c.Options) > MaxOptions {
		return bad("command %q has more than %d options", c.Name, MaxOptions)
	}
	seen := map[string]bool{}
	optionalSeen := false
	for i := range c.Options {
		o := &c.Options[i]
		if !cmdNameRe.MatchString(o.Name) {
			return bad("option name %q must be 1 to 32 characters of a-z, 0-9, _ or -", o.Name)
		}
		if seen[o.Name] {
			return bad("option %q is defined twice", o.Name)
		}
		seen[o.Name] = true
		if n := utf8.RuneCountInString(o.Description); n < 1 || n > 100 || !cleanText(o.Description) {
			return bad("option %q needs a description of 1 to 100 characters", o.Name)
		}
		switch o.Type {
		case models.OptionString, models.OptionInteger, models.OptionNumber, models.OptionBoolean, models.OptionUser:
		default:
			return bad("option %q has unknown type %q", o.Name, o.Type)
		}
		if o.Required && optionalSeen {
			return bad("required option %q must come before optional ones", o.Name)
		}
		if !o.Required {
			optionalSeen = true
		}
		if len(o.Choices) > 0 {
			if o.Type == models.OptionBoolean || o.Type == models.OptionUser {
				return bad("option %q cannot have choices", o.Name)
			}
			if len(o.Choices) > MaxChoices {
				return bad("option %q has more than %d choices", o.Name, MaxChoices)
			}
			for _, ch := range o.Choices {
				if n := utf8.RuneCountInString(ch.Name); n < 1 || n > 100 || !cleanText(ch.Name) {
					return bad("a choice name of option %q must be 1 to 100 characters", o.Name)
				}
				if _, err := parseOptionValue(o.Type, ch.Value); err != nil {
					return bad("choice %q of option %q is not a valid %s", ch.Name, o.Name, o.Type)
				}
			}
		}
	}
	return nil
}

// ValidateCommands checks a whole command set: at most MaxCommands, unique names, each valid.
func ValidateCommands(cmds []*models.BotCommand) error {
	if len(cmds) > MaxCommands {
		return bad("at most %d commands", MaxCommands)
	}
	seen := map[string]bool{}
	for _, c := range cmds {
		if err := ValidateCommand(c); err != nil {
			return err
		}
		if seen[c.Name] {
			return bad("command %q is defined twice", c.Name)
		}
		seen[c.Name] = true
	}
	return nil
}

func parseOptionValue(typ, raw string) (any, error) {
	switch typ {
	case models.OptionInteger:
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return nil, err
		}
		return n, nil
	case models.OptionNumber:
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, errors.New("not a finite number")
		}
		return f, nil
	case models.OptionBoolean:
		b, err := strconv.ParseBool(raw)
		if err != nil {
			return nil, err
		}
		return b, nil
	default:
		return raw, nil
	}
}

// ValidateInvocation checks the options a user supplied against the command definition and returns them with their
// types normalised (a map of option name to string, int64, float64 or bool). Unknown options, missing required ones
// and values outside the declared choices are rejected, so a bot only ever sees well-typed input. Values arrive as
// JSON scalars or strings.
func ValidateInvocation(cmd *models.BotCommand, given map[string]any) (map[string]any, error) {
	defs := map[string]models.CommandOption{}
	for _, o := range cmd.Options {
		defs[o.Name] = o
	}
	for name := range given {
		if _, ok := defs[name]; !ok {
			return nil, bad("unknown option %q", name)
		}
	}
	out := map[string]any{}
	for _, o := range cmd.Options {
		v, ok := given[o.Name]
		if !ok || v == nil || v == "" {
			if o.Required {
				return nil, bad("option %q is required", o.Name)
			}
			continue
		}
		raw, err := scalarString(v)
		if err != nil {
			return nil, bad("option %q must be a single value", o.Name)
		}
		if utf8.RuneCountInString(raw) > MaxOptionValueRunes || !cleanText(raw) {
			return nil, bad("option %q is too long or has invalid characters", o.Name)
		}
		val, err := parseOptionValue(o.Type, raw)
		if err != nil {
			return nil, bad("option %q must be a %s", o.Name, o.Type)
		}
		if len(o.Choices) > 0 {
			match := false
			for _, ch := range o.Choices {
				if cv, _ := parseOptionValue(o.Type, ch.Value); cv == val {
					match = true
					break
				}
			}
			if !match {
				return nil, bad("option %q must be one of its choices", o.Name)
			}
		}
		out[o.Name] = val
	}
	return out, nil
}

func scalarString(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case bool:
		return strconv.FormatBool(t), nil
	case float64:
		if t == math.Trunc(t) && math.Abs(t) < 1e15 {
			return strconv.FormatInt(int64(t), 10), nil
		}
		return strconv.FormatFloat(t, 'f', -1, 64), nil
	case int:
		return strconv.Itoa(t), nil
	case int64:
		return strconv.FormatInt(t, 10), nil
	}
	return "", errors.New("not a scalar")
}
