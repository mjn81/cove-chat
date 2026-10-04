package rtc

import (
	"encoding/json"
	"fmt"

	"nodetalk/backend/internal/logger"

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

	default:
		return fmt.Errorf("rtc: unknown signal type %q", msgType)
	}
}

func (m *Manager) handleJoin(userID, username, channelID string) error {
	if _, err := m.membership.GetUserChannel(userID, channelID); err != nil {
		m.metricsState.joinsRejected.Add(1)
		m.sendError(userID, channelID, "not a member of this channel")
		return nil
	}

	m.mu.Lock()
	if existingChannel, inCall := m.userRooms[userID]; inCall {
		m.mu.Unlock()
		m.metricsState.joinsRejected.Add(1)
		if existingChannel == channelID {
			m.sendError(userID, channelID, "already in this call")
		} else {
			m.sendError(userID, channelID, "already in another call")
		}
		return nil
	}
	m.mu.Unlock()

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
	room, ok := m.getRoom(channelID)
	if !ok {
		m.sendError(userID, channelID, "not in a call")
		return nil
	}
	participant, err := room.getParticipant(userID)
	if err != nil {
		m.sendError(userID, channelID, "not in this call")
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
	room, ok := m.getRoom(channelID)
	if !ok {
		return nil
	}
	participant, err := room.getParticipant(userID)
	if err != nil {
		return nil
	}
	if err := participant.onSubscribeAnswer(sdp); err != nil {
		logger.Errorf("rtc: subscribe answer from %s: %v", userID, err)
	}
	return nil
}

func (m *Manager) handleICECandidate(userID, channelID string, target PCTarget, candidate webrtc.ICECandidateInit) error {
	room, ok := m.getRoom(channelID)
	if !ok {
		return nil
	}
	participant, err := room.getParticipant(userID)
	if err != nil {
		return nil
	}
	return participant.addICECandidate(target, candidate)
}

func (m *Manager) handleTrackState(userID, channelID, kind string, enabled bool, trackID, streamID string) error {
	room, ok := m.getRoom(channelID)
	if !ok {
		return nil
	}
	participant, err := room.getParticipant(userID)
	if err != nil {
		return nil
	}
	participant.setTrackState(trackKind(kind), enabled, trackID, streamID)
	room.broadcastTrackState(userID, trackKind(kind), enabled)
	return nil
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
