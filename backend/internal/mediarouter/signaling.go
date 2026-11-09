package mediarouter

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/udpmedia"

	"golang.org/x/time/rate"
)

// WebSocket event names. The client-to-server and room events deliberately equal the WebRTC SFU's so permission rules
// and client plumbing are shared; MsgEnded is additive and tells a client its call session was closed by the server.
const (
	MsgJoin              = "call_join"
	MsgJoined            = "call_joined"
	MsgLeave             = "call_leave"
	MsgTrackState        = "call_track_state"
	MsgRequestKeyframe   = "call_request_keyframe"
	MsgParticipantJoined = "call_participant_joined"
	MsgParticipantLeft   = "call_participant_left"
	MsgError             = "call_error"
	MsgEnded             = "call_ended"
)

// JoinPayload is the body of call_join and call_leave. Media is required to join in raw_udp mode.
type JoinPayload struct {
	ChannelID string                `json:"channel_id"`
	Media     *udpmedia.JoinRequest `json:"media,omitempty"`
}

// ParticipantInfo describes one call member.
type ParticipantInfo struct {
	UserID      string          `json:"user_id"`
	Username    string          `json:"username"`
	MediaID     uint16          `json:"media_id"`
	TrackStates map[string]bool `json:"track_states"`
}

// JoinedPayload is the body of call_joined.
type JoinedPayload struct {
	ChannelID    string                `json:"channel_id"`
	SelfID       string                `json:"self_id"`
	Media        udpmedia.JoinResponse `json:"media"`
	Participants []ParticipantInfo     `json:"participants"`
}

// ParticipantEventPayload is the body of call_participant_joined / call_participant_left.
type ParticipantEventPayload struct {
	ChannelID string          `json:"channel_id"`
	User      ParticipantInfo `json:"user"`
}

// TrackStatePayload is the body of call_track_state in both directions.
type TrackStatePayload struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id,omitempty"` // set by the server on rebroadcast
	Kind      string `json:"kind"`              // audio | video | screen
	Enabled   bool   `json:"enabled"`
	TrackID   string `json:"track_id,omitempty"`
	StreamID  string `json:"stream_id,omitempty"`
}

// KeyframeRequestPayload is the body of call_request_keyframe.
type KeyframeRequestPayload struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id,omitempty"`
}

// ErrorPayload is the body of call_error and call_ended.
type ErrorPayload struct {
	ChannelID string `json:"channel_id,omitempty"`
	Error     string `json:"error,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

func errorsIs(err, target error) bool { return errors.Is(err, target) }

// HandleSignal is the entry point the hub calls for every call_* event. userID and username come from the
// authenticated session, never from the payload.
func (r *Router) HandleSignal(userID, username, msgType string, raw json.RawMessage) error {
	switch msgType {
	case MsgJoin:
		var p JoinPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("mediarouter: invalid %s payload: %w", msgType, err)
		}
		r.handleJoin(userID, username, p)
	case MsgLeave:
		var p JoinPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("mediarouter: invalid %s payload: %w", msgType, err)
		}
		r.mu.RLock()
		s := r.byUser[userID]
		r.mu.RUnlock()
		if s != nil && s.channelID == p.ChannelID {
			r.endSession(s, "")
		}
	case MsgTrackState:
		var p TrackStatePayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("mediarouter: invalid %s payload: %w", msgType, err)
		}
		r.handleTrackState(userID, p)
	case MsgRequestKeyframe:
		var p KeyframeRequestPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("mediarouter: invalid %s payload: %w", msgType, err)
		}
		r.handleKeyframeRequest(userID, p)
	default:
		// WebRTC-only events (offers, answers, ICE) have no meaning on this transport.
		return fmt.Errorf("mediarouter: unsupported signal type %q in raw_udp mode", msgType)
	}
	return nil
}

func (r *Router) isActiveMember(userID, channelID string) bool {
	uc, err := r.member.GetUserChannel(userID, channelID)
	return err == nil && uc != nil && uc.Status == models.StatusActive
}

func (r *Router) send(userID, msgType string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		logger.Errorf("mediarouter: marshal %s: %v", msgType, err)
		return
	}
	r.sender.SendToUser(userID, &models.WSMessage{Type: msgType, Payload: body})
}

func (r *Router) sendError(userID, channelID, msg string) {
	r.send(userID, MsgError, ErrorPayload{ChannelID: channelID, Error: msg})
}

func (s *session) info() ParticipantInfo {
	t := make(map[string]bool, len(s.tracks))
	for k, v := range s.tracks {
		t[k] = v
	}
	return ParticipantInfo{UserID: s.userID, Username: s.username, MediaID: s.mediaID, TrackStates: t}
}

func (r *Router) handleJoin(userID, username string, p JoinPayload) {
	// A kicked, banned or departed member keeps a junction record, so existence alone is not membership.
	if !r.isActiveMember(userID, p.ChannelID) {
		r.sendError(userID, p.ChannelID, "not a member of this channel")
		return
	}
	if p.Media == nil {
		r.sendError(userID, p.ChannelID, "this server needs a native client for calls")
		return
	}
	// One call session per user: a second join replaces a stale one (client reload, missed leave).
	r.mu.RLock()
	old := r.byUser[userID]
	r.mu.RUnlock()
	if old != nil {
		r.endSession(old, "")
	}

	r.mu.Lock()
	select {
	case <-r.stop:
		r.mu.Unlock()
		r.sendError(userID, p.ChannelID, "calling is not available")
		return
	default:
	}
	rm := r.rooms[p.ChannelID]
	if (rm != nil && len(rm.members) >= r.cfg.MaxParticipantsPerCall) || len(r.byUser) >= r.cfg.MaxSessions {
		r.mu.Unlock()
		r.sendError(userID, p.ChannelID, "call is full")
		return
	}
	if rm == nil {
		rm = &room{channelID: p.ChannelID, members: map[string]*session{}, byMedia: map[uint16]*session{}, nextMedia: 1}
	}
	mediaID := rm.allocMediaID()
	resp, ring, err := udpmedia.AcceptJoin(*p.Media, p.ChannelID, userID, mediaID)
	if err != nil {
		r.mu.Unlock()
		r.sendError(userID, p.ChannelID, "invalid media handshake")
		return
	}
	s := &session{
		userID: userID, username: username, channelID: p.ChannelID, mediaID: mediaID,
		sid: ring.SessionID(), ring: ring, created: time.Now(),
		limiter: rate.NewLimiter(rate.Limit(r.cfg.SessionPPS), r.cfg.SessionBurst),
		resend:  rate.NewLimiter(rate.Limit(r.cfg.ResendPPS), int(r.cfg.ResendPPS)),
		cache:   newPacketCache(),
		tracks:  map[string]bool{},
	}
	s.lastSeen.Store(time.Now().UnixNano())
	existing := make([]ParticipantInfo, 0, len(rm.members))
	for _, m := range rm.members {
		existing = append(existing, m.info())
	}
	rm.members[userID] = s
	rm.byMedia[mediaID] = s
	r.rooms[p.ChannelID] = rm
	r.byUser[userID] = s
	r.bySID[s.sid] = s
	ids := rm.userIDs()
	others := rm.otherUserIDs(userID)
	self := s.info()
	r.mu.Unlock()

	r.send(userID, MsgJoined, JoinedPayload{ChannelID: p.ChannelID, SelfID: userID, Media: resp, Participants: existing})
	for _, o := range others {
		r.send(o, MsgParticipantJoined, ParticipantEventPayload{ChannelID: p.ChannelID, User: self})
	}
	r.sender.BroadcastVoiceState(p.ChannelID, ids)
	logger.Infof("mediarouter: %s joined room %s (%d participants)", userID, p.ChannelID, len(ids))
}

func (rm *room) allocMediaID() uint16 {
	for {
		id := rm.nextMedia
		rm.nextMedia++
		if rm.nextMedia == 0 {
			rm.nextMedia = 1
		}
		if _, used := rm.byMedia[id]; !used && id != 0 {
			return id
		}
	}
}

func (rm *room) userIDs() []string {
	out := make([]string, 0, len(rm.members))
	for id := range rm.members {
		out = append(out, id)
	}
	return out
}

func (rm *room) otherUserIDs(self string) []string {
	out := make([]string, 0, len(rm.members))
	for id := range rm.members {
		if id != self {
			out = append(out, id)
		}
	}
	return out
}

// endSession removes a session, tells the rest of the room, and, when reason is non-empty, tells its owner the call
// was closed by the server. Safe to call more than once for the same session.
func (r *Router) endSession(s *session, reason string) {
	r.mu.Lock()
	if r.byUser[s.userID] != s {
		r.mu.Unlock()
		return
	}
	delete(r.byUser, s.userID)
	delete(r.bySID, s.sid)
	var remaining []string
	if rm := r.rooms[s.channelID]; rm != nil {
		delete(rm.members, s.userID)
		delete(rm.byMedia, s.mediaID)
		remaining = rm.userIDs()
		if len(rm.members) == 0 {
			delete(r.rooms, s.channelID)
		}
	}
	info := s.info()
	r.mu.Unlock()

	if reason != "" {
		r.send(s.userID, MsgEnded, ErrorPayload{ChannelID: s.channelID, Reason: reason})
	}
	for _, o := range remaining {
		r.send(o, MsgParticipantLeft, ParticipantEventPayload{ChannelID: s.channelID, User: ParticipantInfo{UserID: info.UserID, MediaID: info.MediaID}})
	}
	r.sender.BroadcastVoiceState(s.channelID, remaining)
	logger.Infof("mediarouter: %s left room %s (%d remain)", s.userID, s.channelID, len(remaining))
}

// RemoveUser ends the user's call session; the hub calls it when their last WebSocket connection drops.
func (r *Router) RemoveUser(userID string) {
	r.mu.RLock()
	s := r.byUser[userID]
	r.mu.RUnlock()
	if s != nil {
		r.endSession(s, "")
	}
}

// EvictMember ends the user's session if it is in channelID. The hub calls it when a member is kicked or leaves, so
// they lose media immediately instead of at the next membership sweep.
func (r *Router) EvictMember(channelID, userID string) {
	r.mu.RLock()
	s := r.byUser[userID]
	r.mu.RUnlock()
	if s != nil && s.channelID == channelID {
		r.endSession(s, "removed from channel")
	}
}

// RemoveUserFromChannel satisfies ws.RTCSignalHandler: the hub calls it when a member leaves or is kicked.
func (r *Router) RemoveUserFromChannel(userID, channelID string) { r.EvictMember(channelID, userID) }

// ActiveRooms maps channel id to the user ids in its call.
func (r *Router) ActiveRooms() map[string][]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string][]string, len(r.rooms))
	for id, rm := range r.rooms {
		if len(rm.members) > 0 {
			out[id] = rm.userIDs()
		}
	}
	return out
}

func (r *Router) handleTrackState(userID string, p TrackStatePayload) {
	kind := map[string]udpmedia.Kind{"audio": udpmedia.KindAudio, "video": udpmedia.KindVideo, "screen": udpmedia.KindScreen}[p.Kind]
	if !kind.Valid() {
		return
	}
	r.mu.Lock()
	s := r.byUser[userID]
	if s == nil || s.channelID != p.ChannelID {
		r.mu.Unlock()
		return
	}
	s.tracks[p.Kind] = p.Enabled
	if p.Enabled {
		s.stopped.And(^(uint32(1) << kind))
	} else {
		s.stopped.Or(uint32(1) << kind)
	}
	others := r.rooms[s.channelID].otherUserIDs(userID)
	r.mu.Unlock()
	p.UserID = userID
	for _, o := range others {
		r.send(o, MsgTrackState, p)
	}
}

func (r *Router) handleKeyframeRequest(userID string, p KeyframeRequestPayload) {
	r.mu.RLock()
	s := r.byUser[userID]
	var target *session
	if s != nil && s.channelID == p.ChannelID {
		if rm := r.rooms[s.channelID]; rm != nil {
			target = rm.members[p.UserID]
		}
	}
	r.mu.RUnlock()
	if target == nil || target == s || !target.established.Load() {
		return
	}
	r.forwardKeyframeReq(target, s, udpmedia.KindVideo)
	r.forwardKeyframeReq(target, s, udpmedia.KindScreen)
}
