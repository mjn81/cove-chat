package db

// Key layout of the Bot API (docs/design/bot-api-plan.md):
//
//	bot:{bot_id}                       models.Bot             bot record (identity is the User with the same id)
//	botown:{owner_id}:{bot_id}         struct{}               index of a user's bots
//	bi:{channel_id}:{bot_id}           models.BotInstall      installs, by channel
//	bii:{bot_id}:{channel_id}          struct{}               installs, by bot
//	bc:{bot_id}:{user_id}              models.BotContact      users that interacted with a bot
//	bcmd:{bot_id}:{scope}:{name}       models.BotCommand      slash commands, scope = "global" or a channel id
//	bkb:{channel_id}:{bot_id}          models.Keyboard        action menu a bot shows in a channel
//	bint:{interaction_id}              models.Interaction     pending interactions
const (
	prefixBot        = "bot:"
	prefixBotOwner   = "botown:"
	prefixBotInstall = "bi:"
	prefixBotInstBy  = "bii:"
	prefixBotContact = "bc:"
	prefixBotCommand = "bcmd:"
	prefixKeyboard   = "bkb:"
	prefixInteract   = "bint:"
)

// BotKey is the key of a bot record.
func BotKey(botID string) string { return prefixBot + botID }

// BotPrefix is the prefix shared by all bot records.
func BotPrefix() string { return prefixBot }

// BotOwnerKey is the owner-index key of one bot.
func BotOwnerKey(ownerID, botID string) string { return prefixBotOwner + ownerID + ":" + botID }

// BotOwnerPrefix is the prefix shared by one owner's bots.
func BotOwnerPrefix(ownerID string) string { return prefixBotOwner + ownerID + ":" }

// BotInstallKey is the key of a bot install in a channel.
func BotInstallKey(channelID, botID string) string { return prefixBotInstall + channelID + ":" + botID }

// BotInstallPrefix is the prefix shared by all installs in a channel.
func BotInstallPrefix(channelID string) string { return prefixBotInstall + channelID + ":" }

// BotInstalledInKey is the by-bot index key of an install.
func BotInstalledInKey(botID, channelID string) string { return prefixBotInstBy + botID + ":" + channelID }

// BotInstalledInPrefix is the prefix shared by all channels a bot is installed in.
func BotInstalledInPrefix(botID string) string { return prefixBotInstBy + botID + ":" }

// BotContactKey is the key of a bot/user contact.
func BotContactKey(botID, userID string) string { return prefixBotContact + botID + ":" + userID }

// BotContactPrefix is the prefix shared by all contacts of a bot.
func BotContactPrefix(botID string) string { return prefixBotContact + botID + ":" }

// BotCommandKey is the key of one slash command; scope is "global" or a channel id.
func BotCommandKey(botID, scope, name string) string {
	return prefixBotCommand + botID + ":" + scope + ":" + name
}

// BotCommandPrefix is the prefix shared by a bot's commands in one scope.
func BotCommandPrefix(botID, scope string) string { return prefixBotCommand + botID + ":" + scope + ":" }

// BotCommandsOfPrefix is the prefix shared by all commands of a bot, in every scope.
func BotCommandsOfPrefix(botID string) string { return prefixBotCommand + botID + ":" }

// KeyboardKey is the key of a bot's keyboard in a channel.
func KeyboardKey(channelID, botID string) string { return prefixKeyboard + channelID + ":" + botID }

// KeyboardPrefix is the prefix shared by all keyboards of a channel.
func KeyboardPrefix(channelID string) string { return prefixKeyboard + channelID + ":" }

// InteractionKey is the key of a pending interaction.
func InteractionKey(id string) string { return prefixInteract + id }

// InteractionPrefix is the prefix shared by all interactions.
func InteractionPrefix() string { return prefixInteract }

// UserRecordKey is the key of a user record, for transactions that must write a user together with other keys.
func UserRecordKey(id string) string { return userKey(id) }
