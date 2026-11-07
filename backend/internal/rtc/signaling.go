package rtc

import (
	"encoding/json"
	"fmt"

	"cove/backend/internal/logger"
	"cove/backend/internal/models"

	"github.com/pion/webrtc/v4"
)

// HandleSignal is the single entry point ws/client.go calls for every
// "call_*" WS message type. userID/username come from the already-
// authenticated session (see ws.Client), never from the payload — a client
// cannot claim to be someone else here any more than it can over chat.
func (m *Manager) HandleSignal(userID, username, msgType string, raw json.RawMessage) error {
	switch msgType {
	case MsgJoin:
		var p JoinPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		return m.handleJoin(userID, username, p.ChannelID)

	case MsgLeave:
		var p JoinPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		m.handleLeave(userID, p.ChannelID)
		return nil

	case MsgPublishOffer:
		var p SDPPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		return m.handlePublishOffer(userID, p.ChannelID, p.SDP)

	case MsgSubscribeAnswer:
		var p SDPPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		return m.handleSubscribeAnswer(userID, p.ChannelID, p.SDP)

	case MsgICECandidate:
		var p ICECandidatePayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		return m.handleICECandidate(userID, p.ChannelID, p.Target, p.Candidate)

	case MsgTrackState:
		var p TrackStatePayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		return m.handleTrackState(userID, p.ChannelID, p.Kind, p.Enabled, p.TrackID, p.StreamID)

	case MsgRequestKeyframe:
		var p KeyframeRequestPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return fmt.Errorf("rtc: invalid %s payload: %w", msgType, err)
		}
		return m.handleKeyframeRequest(userID, p.ChannelID, p.UserID)

	default:
		return fmt.Errorf("rtc: unknown signal type %q", msgType)
	}
}

func (m *Manager) handleJoin(userID, username, channelID string) error {
	// A kicked/left/banned member keeps a junction record, so existence alone is not membership.
	if uc, err := m.membership.GetUserChannel(userID, channelID); err != nil || uc == nil || uc.Status != models.StatusActive {
		m.metricsState.joinsRejected.Add(1)
		m.sendError(userID, channelID, "not a member of this channel")
		return nil
	}

	// A user has at most one call session. A second call_join means the client lost its own state (page reload
	// while the SharedWorker kept the WebSocket, or a missed leave), so the stale session is torn down and replaced
	// instead of rejecting the join and stranding the client without a PeerConnection.
	m.mu.Lock()
	existingChannel, inCall := m.userRooms[userID]
	m.mu.Unlock()
	if inCall {
		m.handleLeave(userID, existingChannel)
	}

	room := m.getOrCreateRoom(channelID)
	if room.size() >= m.cfg.MaxParticipantsPerCall {
		m.metricsState.joinsRejected.Add(1)
		m.sendError(userID, channelID, "call is full")
		return nil
	}

	participant, err := newParticipant(m, room, userID, username)
	if err != nil {
		m.metricsState.joinsRejected.Add(1)
		logger.Errorf("rtc: create participant for %s: %v", userID, err)
		m.sendError(userID, channelID, "failed to join call")
		return nil
	}

	m.metricsState.joinsTotal.Add(1)
	room.addParticipant(participant)

	m.mu.Lock()
	m.userRooms[userID] = channelID
	m.mu.Unlock()

	m.send(userID, MsgJoined, JoinedPayload{
		ChannelID:    channelID,
		SelfID:       userID,
		ICEServers:   m.mintICEServers(userID),
		Participants: room.roster(),
	})
	room.broadcastParticipantEvent(MsgParticipantJoined, userID, participant.info())
	m.sender.BroadcastVoiceState(channelID, room.participantIDs())

	logger.Infof("rtc: %s joined room %s (%d participants)", userID, channelID, room.size())
	return nil
}

func (m *Manager) handleLeave(userID, channelID string) {
	room, ok := m.getRoom(channelID)
	if !ok {
		return
	}

	room.removeParticipant(userID)

	m.mu.Lock()
	if m.userRooms[userID] == channelID {
		delete(m.userRooms, userID)
	}
	m.mu.Unlock()

	m.dropRoomIfEmpty(channelID)
	room.broadcastParticipantEvent(MsgParticipantLeft, userID, ParticipantInfo{UserID: userID})

	remaining := []string{}
	if r, ok := m.getRoom(channelID); ok {
		remaining = r.participantIDs()
	}
	m.sender.BroadcastVoiceState(channelID, remaining)
}

func (m *Manager) handlePublishOffer(userID, channelID string, sdp webrtc.SessionDescription) error {
	_, participant, ok := m.activeParticipant(userID, channelID)
	if !ok {
		m.sendError(userID, channelID, "not in a call")
		return nil
	}

	answer, err := participant.onPublishOffer(sdp)
	if err != nil {
		logger.Errorf("rtc: publish offer from %s: %v", userID, err)
		m.sendError(userID, channelID, "failed to negotiate publish connection")
		return nil
	}

	m.send(userID, MsgPublishAnswer, SDPPayload{ChannelID: channelID, SDP: answer})
	return nil
}

func (m *Manager) handleSubscribeAnswer(userID, channelID string, sdp webrtc.SessionDescription) error {
	_, participant, ok := m.activeParticipant(userID, channelID)
	if !ok {
		return nil
	}
	if err := participant.onSubscribeAnswer(sdp); err != nil {
		logger.Errorf("rtc: subscribe answer from %s: %v", userID, err)
	}
	return nil
}

func (m *Manager) handleICECandidate(userID, channelID string, target PCTarget, candidate webrtc.ICECandidateInit) error {
	_, participant, ok := m.activeParticipant(userID, channelID)
	if !ok {
		return nil
	}
	return participant.addICECandidate(target, candidate)
}

func (m *Manager) handleTrackState(userID, channelID, kind string, enabled bool, trackID, streamID string) error {
	room, participant, ok := m.activeParticipant(userID, channelID)
	if !ok {
		return nil
	}
	participant.setTrackState(trackKind(kind), enabled, trackID, streamID)
	room.broadcastTrackState(userID, trackKind(kind), enabled)
	return nil
}

func (m *Manager) handleKeyframeRequest(requesterID, channelID, targetUserID string) error {
	// Only someone in the call may ask for keyframes of it.
	room, _, ok := m.activeParticipant(requesterID, channelID)
	if !ok {
		return nil
	}
	room.requestKeyframes(targetUserID)
	return nil
}

// activeParticipant returns the room and participant for a signal sent after joining. The sender must be in the call
// AND still an active member of the channel: a member who was kicked, banned or left while connected keeps their
// PeerConnection, so membership is re-checked here (the same rule as the REST routes) and a stale participant is
// evicted instead of being allowed to keep signalling or listening in.
func (m *Manager) activeParticipant(userID, channelID string) (*Room, *Participant, bool) {
	room, ok := m.getRoom(channelID)
	if !ok {
		return nil, nil, false
	}
	participant, err := room.getParticipant(userID)
	if err != nil {
		return nil, nil, false
	}
	if uc, err := m.membership.GetUserChannel(userID, channelID); err != nil || uc == nil || uc.Status != models.StatusActive {
		m.RemoveUserFromChannel(userID, channelID)
		m.sendError(userID, channelID, "not a member of this channel")
		return nil, nil, false
	}
	return room, participant, true
}

// RemoveUserFromChannel ends the user's call in channelID, if they are in it. The Hub calls it when a member is
// kicked or leaves the channel, so they stop receiving media right away instead of at their next signal.
func (m *Manager) RemoveUserFromChannel(userID, channelID string) {
	m.mu.Lock()
	inThatCall := m.userRooms[userID] == channelID
	m.mu.Unlock()
	if inThatCall {
		m.handleLeave(userID, channelID)
	}
}

// RemoveUser is called from ws.Hub's disconnect path (the same place that
// already cleans up the raw-UDP voice router and Whisper sessions) so a
// client that crashes/drops mid-call doesn't leave a ghost participant, an
// open PeerConnection, or a leaked forwarding goroutine behind — the same
// class of bug fixed for the UDP voice router applies here and is handled
// the same way: unconditional cleanup on disconnect, not just on a
// well-behaved "leave".
func (m *Manager) RemoveUser(userID string) {
	m.mu.Lock()
	channelID, inCall := m.userRooms[userID]
	if inCall {
		delete(m.userRooms, userID)
	}
	m.mu.Unlock()

	if !inCall {
		return
	}
	m.handleLeave(userID, channelID)
}
