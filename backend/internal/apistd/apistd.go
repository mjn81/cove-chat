// Package apistd holds the constants and pure helpers of the Cove client/server API standard
// (docs/api-standard.md): the API version, header names, the stable error-code registry,
// capability names and the version comparison used for the minimum-client check.
package apistd

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// APIVersion is the integer version of the client/server contract. It is bumped only on a breaking change
// (a removed or re-typed field, a changed meaning); additive changes never bump it.
const APIVersion = 2

// Header names. The client announces itself with HeaderClient; the server stamps the other two on every response.
const (
	HeaderClient        = "X-Cove-Client"
	HeaderAPIVersion    = "X-Cove-API-Version"
	HeaderServerVersion = "X-Cove-Server-Version"
	// HeaderClientOutdated is set to "1" on a response when the caller is below min_client_version but the
	// server only warns (soft enforcement), so clients can show a banner without a separate request.
	HeaderClientOutdated = "X-Cove-Client-Outdated"
)

// Stable machine-readable error codes. Clients branch on these, never on the human message.
const (
	CodeClientOutdated     = "client_outdated"
	CodeServerOutdated     = "server_outdated"
	CodeFeatureUnsupported = "feature_unsupported"
	CodeUnauthorized       = "unauthorized"
	CodeForbidden          = "forbidden"
	CodeNotFound           = "not_found"
	CodeValidationFailed   = "validation_failed"
	CodeRateLimited        = "rate_limited"
	CodeConflict           = "conflict"
	CodePayloadTooLarge    = "payload_too_large"
	CodeInternal           = "internal"
	CodeMethodNotAllowed   = "method_not_allowed"
	CodeUnavailable        = "service_unavailable"
	// CodeInviteNotAllowed means the sender may not invite people to the channel an invite message points at.
	CodeInviteNotAllowed = "invite_not_allowed"
	// CodePackNotFound means the pack (or its item) does not exist or is not available to the caller.
	CodePackNotFound = "pack_not_found"
	// CodePackLimitReached means a per-user quota (packs, stickers per pack, total size) or a pack's size is reached.
	CodePackLimitReached = "pack_limit_reached"
	// CodeEmojiNameTaken means another custom emoji already uses the shortcode.
	CodeEmojiNameTaken = "emoji_name_taken"
	// CodeUploadsDisabled means the admin switched user sticker uploads off.
	CodeUploadsDisabled = "pack_uploads_disabled"
	// CodeImageInvalid means an uploaded sticker or emoji image is not an allowed raster image or is out of bounds.
	CodeImageInvalid = "image_invalid"
	// CodeStickerInvalid means a sticker message points at a pack, sticker or file that does not match.
	CodeStickerInvalid = "sticker_invalid"
	// CodeBotsDisabled means the admin switched the Bot API off (or, for creation, to a policy that excludes the caller).
	CodeBotsDisabled = "bots_disabled"
	// CodeBotLimitReached means the owner already has the most bots the admin allows.
	CodeBotLimitReached = "bot_limit_reached"
	// CodeBotInstallRequired means a bot cannot be added to a channel as an ordinary member; it must be installed.
	CodeBotInstallRequired = "bot_install_required"
	// CodeBotContactRequired means a bot may not message a user who has not interacted with it.
	CodeBotContactRequired = "bot_contact_required"
	// CodeCommandInvalid means a slash command definition or an invocation does not match its definition.
	CodeCommandInvalid = "command_invalid"
	// CodeWebhookURLInvalid means a bot webhook URL is not an acceptable HTTPS endpoint.
	CodeWebhookURLInvalid = "webhook_url_invalid"
	// CodeInteractionExpired means an interaction token is unknown, expired or already used up.
	CodeInteractionExpired = "interaction_expired"
)

// Capability names advertised in GET /api/version and the WebSocket hello event.
const (
	CapInviteMessages = "invite_messages"
	CapWhisper        = "whisper"
	CapWebRTCSFU      = "webrtc_sfu"
	CapRawUDPVoice    = "raw_udp_voice"
	// CapRawUDPMedia means calls (audio, video, screen share) run over the encrypted UDP media protocol, which only
	// native clients can speak (docs/udp-media.md). Web clients must disable their call buttons when it is present.
	CapRawUDPMedia = "raw_udp_media"
	// CapEmojiPacks means the server serves emoji styles (sprite sheets) under /api/emoji/styles.
	CapEmojiPacks = "emoji_packs"
	// CapCustomEmoji means the server has a custom emoji set (:name: shortcodes) under /api/emoji/custom.
	CapCustomEmoji = "custom_emoji"
	// CapStickers means sticker packs and the `sticker` message type are supported (docs/packs-api.md).
	CapStickers = "stickers"
	// CapAnimatedEmoji means the server serves the animated emoji table under /api/emoji/animated.
	CapAnimatedEmoji = "animated_emoji"
	// CapBots means the Bot API exists: bot accounts, slash commands, interactive messages and the bot gateway
	// (docs/bots-api.md). Clients hide bot UI without it.
	CapBots = "bots"
)

// CodeForStatus maps an HTTP status to the generic error code used when a handler did not pick a specific one.
func CodeForStatus(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return CodeUnauthorized
	case http.StatusForbidden:
		return CodeForbidden
	case http.StatusNotFound:
		return CodeNotFound
	case http.StatusMethodNotAllowed:
		return CodeMethodNotAllowed
	case http.StatusConflict:
		return CodeConflict
	case http.StatusNotImplemented:
		return CodeFeatureUnsupported
	case http.StatusRequestEntityTooLarge:
		return CodePayloadTooLarge
	case http.StatusTooManyRequests:
		return CodeRateLimited
	case http.StatusUpgradeRequired:
		return CodeClientOutdated
	case http.StatusServiceUnavailable:
		return CodeUnavailable
	}
	if status >= 500 {
		return CodeInternal
	}
	return CodeValidationFailed
}

// Capabilities lists what this server supports. webrtc reports whether the in-process SFU is running; otherwise
// calls fall back to the audio-only UDP router.
func Capabilities(webrtc bool) []string {
	caps := []string{CapInviteMessages, CapWhisper, CapEmojiPacks, CapCustomEmoji, CapStickers, CapAnimatedEmoji, CapBots}
	if webrtc {
		caps = append(caps, CapWebRTCSFU)
	} else {
		caps = append(caps, CapRawUDPVoice)
	}
	return caps
}

// CapabilitiesForMode lists capabilities for a configured voice mode ("webrtc" or "raw_udp"). In raw_udp mode the
// encrypted UDP media router is the calling engine, so raw_udp_media is advertised next to raw_udp_voice.
func CapabilitiesForMode(mode string) []string {
	if mode == "raw_udp" {
		return append(Capabilities(false), CapRawUDPMedia)
	}
	return Capabilities(true)
}

// Client is what a request's X-Cove-Client header says about the caller.
type Client struct {
	// Known is false when the header is absent or unparsable (old clients, curl). Such callers are tolerated.
	Known      bool
	Platform   string
	Version    string
	APIVersion int // 0 when the header carries no "(api n)" part
}

var clientRe = regexp.MustCompile(`^([A-Za-z0-9_.-]+)/([0-9A-Za-z.+-]+)(?:\s*\(api\s+(\d+)\))?`)

// ParseClient parses "<platform>/<semver> (api <n>)". It never fails: garbage yields Client{Known: false}.
func ParseClient(header string) Client {
	m := clientRe.FindStringSubmatch(strings.TrimSpace(header))
	if m == nil {
		return Client{}
	}
	c := Client{Known: true, Platform: strings.ToLower(m[1]), Version: m[2]}
	if m[3] != "" {
		c.APIVersion, _ = strconv.Atoi(m[3])
	}
	return c
}

// parseSemver reads MAJOR.MINOR.PATCH, ignoring any pre-release or build suffix.
func parseSemver(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if v == "" || len(parts) > 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// CompareVersions returns -1, 0 or 1 comparing semvers a and b, and false when either is unparsable.
func CompareVersions(a, b string) (int, bool) {
	pa, okA := parseSemver(a)
	pb, okB := parseSemver(b)
	if !okA || !okB {
		return 0, false
	}
	for i := range pa {
		switch {
		case pa[i] < pb[i]:
			return -1, true
		case pa[i] > pb[i]:
			return 1, true
		}
	}
	return 0, true
}

// BelowMinimum reports whether c is older than min. An empty or unparsable min never rejects. A caller that sent
// no usable header counts as below the minimum only when strict is true (the admin asked for a hard minimum).
func BelowMinimum(c Client, min string, strict bool) bool {
	if _, ok := parseSemver(min); !ok {
		return false
	}
	if !c.Known {
		return strict
	}
	cmp, ok := CompareVersions(c.Version, min)
	if !ok {
		return strict
	}
	return cmp < 0
}

// ServerInfo is the version/capability block shared by GET /api/version and the WebSocket hello event.
type ServerInfo struct {
	Version          string   `json:"version" example:"0.9.9"`
	APIVersion       int      `json:"api_version" example:"1"`
	MinClientVersion string   `json:"min_client_version" example:"0.9.0"`
	Capabilities     []string `json:"capabilities"`
}

// Envelope is the JSON body of every non-2xx response (docs/api-standard.md section 4).
type Envelope struct {
	Error   string            `json:"error"`
	Code    string            `json:"code"`
	Details map[string]string `json:"details,omitempty"`
}

// WriteError writes the standard error envelope as application/json. It is the single writer shared by the
// handlers, the auth and rate-limit middleware, the client-version check and the WebSocket upgrade, so a client
// can always parse a failure the same way. An empty code is derived from the status.
func WriteError(w http.ResponseWriter, status int, code, msg string, details map[string]string) {
	if code == "" {
		code = CodeForStatus(status)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Envelope{Error: msg, Code: code, Details: details})
}
