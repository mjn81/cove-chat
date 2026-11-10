package config

import "fmt"

// Who may create bot accounts (bots.creation).
const (
	BotCreationAdmins   = "admins"   // only server admins and the owner (default)
	BotCreationUsers    = "users"    // every signed-in user
	BotCreationDisabled = "disabled" // nobody; existing bots keep working
)

// BotsConfig controls the Bot API (docs/design/bot-api-plan.md). Every field is editable from the admin panel and
// applied live.
type BotsConfig struct {
	// Enabled switches the whole Bot API (management, bot endpoints, gateway, webhooks) on or off.
	Enabled bool `toml:"enabled"`
	// Creation decides who may create bots: "admins" (default), "users" or "disabled".
	Creation string `toml:"creation"`
	// MaxPerUser caps the bots one account may own.
	MaxPerUser int `toml:"max_per_user"`
	// WebhookAllowPrivate lets webhook URLs resolve to private, loopback and link-local addresses. Off by default so a
	// bot owner cannot make the server call into its own network (SSRF).
	WebhookAllowPrivate bool `toml:"webhook_allow_private"`
	// RateLimitRPS is the sustained request rate allowed per bot token on the REST API.
	RateLimitRPS int `toml:"rate_limit_rps"`
}

// DefaultBots is the safe default: the API is on, but only admins may create bots.
func DefaultBots() BotsConfig {
	return BotsConfig{Enabled: true, Creation: BotCreationAdmins, MaxPerUser: 5, RateLimitRPS: 25}
}

// ValidateBots rejects unknown creation modes and out-of-range limits.
func ValidateBots(b BotsConfig) error {
	switch b.Creation {
	case BotCreationAdmins, BotCreationUsers, BotCreationDisabled:
	default:
		return fmt.Errorf("config: bots.creation must be %q, %q or %q, got %q", BotCreationAdmins, BotCreationUsers, BotCreationDisabled, b.Creation)
	}
	if b.MaxPerUser < 1 || b.MaxPerUser > 50 {
		return fmt.Errorf("config: bots.max_per_user must be 1..50")
	}
	if b.RateLimitRPS < 1 || b.RateLimitRPS > 500 {
		return fmt.Errorf("config: bots.rate_limit_rps must be 1..500")
	}
	return nil
}
