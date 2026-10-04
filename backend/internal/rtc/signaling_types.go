package rtc

import "github.com/pion/webrtc/v4"

// Wire message types exchanged over the existing authenticated WS hub
// (internal/ws). All are prefixed "call_" so ws/client.go can route them to
// this package without knowing their contents.
const (
	MsgJoin       = "call_join"        // client -> server: {channel_id}
	MsgJoined     = "call_joined"      // server -> client: JoinedPayload
	MsgLeave      = "call_leave"       // client -> server: {channel_id}
	MsgTrackState = "call_track_state" // bidirectional (client sends, server rebroadcasts): TrackStatePayload

	MsgPublishOffer  = "call_publish_offer"  // client -> server: SDPPayload (client's upload tracks)
	MsgPublishAnswer = "call_publish_answer" // server -> client: SDPPayload

	MsgSubscribeOffer  = "call_subscribe_offer"  // server -> client: SDPPayload (forwarded tracks)
	MsgSubscribeAnswer = "call_subscribe_answer" // client -> server: SDPPayload

	MsgICECandidate = "call_ice_candidate" // bidirectional: ICECandidatePayload

	MsgParticipantJoined = "call_participant_joined" // server -> room
	MsgParticipantLeft   = "call_participant_left"   // server -> room
	MsgError             = "call_error"              // server -> client
)

// PCTarget disambiguates which of a participant's two PeerConnections a
// message concerns, since each side runs both simultaneously.
type PCTarget string

const (
	TargetPublish   PCTarget = "publish"
	TargetSubscribe PCTarget = "subscribe"
)

type JoinPayload struct {
	ChannelID string `json:"channel_id"`
}

type ICEServerInfo struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type ParticipantInfo struct {
	UserID      string          `json:"user_id"`
	Username    string          `json:"username"`
	TrackStates map[string]bool `json:"track_states"` // "audio"|"video"|"screen" -> enabled
}

type JoinedPayload struct {
	ChannelID    string            `json:"channel_id"`
	SelfID       string            `json:"self_id"`
	ICEServers   []ICEServerInfo   `json:"ice_servers"`
	Participants []ParticipantInfo `json:"participants"`
}

type SDPPayload struct {
	ChannelID string                    `json:"channel_id"`
	SDP       webrtc.SessionDescription `json:"sdp"`
}

type ICECandidatePayload struct {
	ChannelID string                  `json:"channel_id"`
	Target    PCTarget                `json:"target"`
	Candidate webrtc.ICECandidateInit `json:"candidate"`
	// FromUserID/ToUserID are filled in by the server when relaying a
	// subscribe-side candidate — a client's publish-PC candidates concern
	// only its own connection to the server, but subscribe-PC candidates
	// are per (server, that specific subscriber), so no cross-user routing
	// is actually needed here; kept for forward-compat / debugging clarity.
}

type TrackStatePayload struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id,omitempty"` // set by server on rebroadcast
	Kind      string `json:"kind"`              // "audio" | "video" | "screen"
	Enabled   bool   `json:"enabled"`
	TrackID   string `json:"track_id,omitempty"`
	StreamID  string `json:"stream_id,omitempty"`
}

type ParticipantEventPayload struct {
	ChannelID string          `json:"channel_id"`
	User      ParticipantInfo `json:"user"`
}

type ErrorPayload struct {
	ChannelID string `json:"channel_id,omitempty"`
	Error     string `json:"error"`
}
