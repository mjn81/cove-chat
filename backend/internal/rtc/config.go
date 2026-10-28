// Package rtc implements a self-hosted WebRTC SFU (Selective Forwarding
// Unit) for group audio/video calling and screen sharing, scaling to small
// group calls (default cap: 10 participants) without any external media
// server, TURN provider, or signaling service — everything here runs
// in-process as part of the Cove backend binary.
//
// Design summary (see plan discussion for the full rationale):
//   - Each participant holds TWO WebRTC PeerConnections to the server:
//     a "publish" connection (their own mic/cam/screen tracks, uploaded
//     once) and a "subscribe" connection (every other participant's
//     tracks, forwarded to them). This avoids the transceiver-direction
//     edge cases of a single bidirectional connection while still only
//     costing each client one upload of each of their own tracks.
//   - The server never decodes/encodes media — it relays RTP packets
//     between the two connections, which is why this scales cheaply:
//     the cost is I/O and packet copies, not codec CPU time.
//   - Signaling rides the existing authenticated WebSocket hub
//     (internal/ws), reusing session auth and channel-membership checks —
//     no separate signaling channel or credential system.
package rtc

import "time"

// Mode selects the calling transport for a deployment.
type Mode string

const (
	// ModeWebRTC is the production, internet-capable path: the SFU in this
	// package, DTLS-SRTP encrypted, with NAT traversal via ICE/STUN/TURN.
	ModeWebRTC Mode = "webrtc"
	// ModeRawUDP keeps the original unencrypted, audio-only UDP router
	// (internal/voice) for isolated/LAN deployments. This package is not
	// used at all in that mode.
	ModeRawUDP Mode = "raw_udp"
)

// Config configures the SFU and its embedded STUN/TURN server. It is
// intentionally decoupled from internal/config's TOML types so this package
// has no dependency on the rest of the server and can be unit-tested and
// reused standalone; cmd/server/main.go maps config.VoiceConfig into this.
type Config struct {
	Mode Mode

	// MaxParticipantsPerCall bounds both server resource usage (goroutines,
	// PeerConnections, forwarded tracks) and the O(N) forwarding fan-out
	// cost per published track. Enforced at call_join time.
	MaxParticipantsPerCall int

	// WebRTC media (ICE/DTLS/SRTP) ephemeral UDP port range.
	PortMin uint16
	PortMax uint16

	// PublicIP, if set, is announced via ICE NAT 1:1 mapping so clients
	// behind the same NAT/LB/container network as the server are still
	// offered a reachable candidate.
	PublicIP string

	EmbeddedTURNEnabled bool
	TURNPort            int
	TURNRealm           string
	TURNSharedSecret    string

	// TURNCredentialTTL is how long a minted TURN credential (see turn.go)
	// remains valid — short enough to limit exposure if leaked, long enough
	// to outlast a single call's ICE negotiation and reconnects.
	TURNCredentialTTL time.Duration

	// KeyframeInterval controls how often the SFU asks each video publisher
	// for a fresh keyframe (via PLI), which is also how quickly a newly
	// joined subscriber gets a decodable picture. Shorter = faster join,
	// more bitrate; longer = the reverse. 2s is a reasonable default.
	KeyframeInterval time.Duration
}

// WithDefaults fills in zero-valued fields with sane production defaults.
// Call sites should still validate required secrets (e.g. TURNSharedSecret)
// themselves before enabling the TURN server.
func (c Config) WithDefaults() Config {
	if c.Mode == "" {
		c.Mode = ModeWebRTC
	}
	if c.MaxParticipantsPerCall <= 0 {
		c.MaxParticipantsPerCall = 10
	}
	if c.PortMin == 0 {
		c.PortMin = 50000
	}
	if c.PortMax == 0 {
		c.PortMax = 50100
	}
	if c.TURNPort == 0 {
		c.TURNPort = 3478
	}
	if c.TURNRealm == "" {
		c.TURNRealm = "cove"
	}
	if c.TURNCredentialTTL <= 0 {
		c.TURNCredentialTTL = 10 * time.Minute
	}
	if c.KeyframeInterval <= 0 {
		c.KeyframeInterval = 2 * time.Second
	}
	return c
}
