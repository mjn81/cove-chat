// Package botspec holds what the example bot looks like to a Cove server: its slash commands, its action menu and its
// welcome message. The bot (main.go) registers these when it starts and the dev seed (seed/main.go) registers the same
// ones, so a freshly seeded server shows the commands even before the bot is running.
package botspec

// Name is the sample bot's username.
const Name = "covebot"

// Description is shown in Explore and in the bot settings.
const Description = "Sample bot: /ping, /roll, /poll, /counter, /menu and /help."

// WelcomeMarker starts every welcome message so the seed can tell it has already posted one.
const WelcomeMarker = "Welcome to the Cove bot lab"

// Commands is the body of PUT /api/bots/me/commands.
var Commands = map[string]any{"commands": []map[string]any{
	{"name": "ping", "description": "Check that the bot is alive"},
	{"name": "help", "description": "List what this bot can do"},
	{"name": "roll", "description": "Roll a die", "options": []map[string]any{{
		"name": "sides", "description": "Number of sides", "type": "integer", "required": true,
		"choices": []map[string]any{{"name": "d6", "value": "6"}, {"name": "d20", "value": "20"}, {"name": "d100", "value": "100"}},
	}}},
	{"name": "poll", "description": "Start a yes/no poll", "options": []map[string]any{{
		"name": "question", "description": "The question (use quotes for several words)", "type": "string", "required": true,
	}}},
	{"name": "counter", "description": "A message with a +1 button"},
	{"name": "menu", "description": "Show the bot's action menu in this channel"},
}}

// Menu is the body of PUT /api/bots/me/channels/{id}/keyboard.
var Menu = map[string]any{
	"rows": []any{
		[]map[string]any{{"label": "Roll d6", "custom_id": "roll6"}, {"label": "Roll d20", "custom_id": "roll20"}},
		[]map[string]any{{"label": "Ping", "custom_id": "ping"}, {"label": "Help", "custom_id": "help"}},
		[]map[string]any{{"label": "Hide menu", "style": "danger", "custom_id": "hide"}},
	},
	"placeholder": "Pick an action",
	"persistent":  true,
}

// Welcome is the first message in a channel the bot was installed in.
func Welcome(channel string) map[string]any {
	return map[string]any{
		"text": WelcomeMarker + " (" + channel + ")! Try /ping, /roll 20, /poll \"Pizza tonight?\", /counter, or tap a button. " +
			"Send /menu to replace your keyboard with my action menu.",
		"buttons": []any{
			[]map[string]any{{"label": "Ping", "style": "primary", "custom_id": "ping"}, {"label": "Roll d20", "custom_id": "roll20"}},
			[]map[string]any{{"label": "Bot guide", "url": "https://covechat.dev/docs/api/build-your-first-bot/"}},
		},
	}
}
