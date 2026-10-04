package rtc

import (
	"fmt"
	"sync"

	"nodetalk/backend/internal/logger"

	"github.com/pion/webrtc/v4"
)

// Room is one active call, scoped to a channel ID. It owns the set of
// participants and is the thing that actually wires the SFU together: when
// a participant publishes a track, the Room adds it to every other
// participant's subscribe connection; when a participant leaves, the Room
// unwinds all of that.
type Room struct {
	channelID string
	mgr       *Manager

	mu           sync.RWMutex
	participants map[string]*Participant
}

func newRoom(mgr *Manager, channelID string) *Room {
	return &Room{
		channelID:    channelID,
		mgr:          mgr,
		participants: make(map[string]*Participant),
	}
}

func (r *Room) size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.participants)
}

func (r *Room) participantsSnapshot() []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		out = append(out, p)
	}
	return out
}

func (r *Room) roster() []ParticipantInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ParticipantInfo, 0, len(r.participants))
	for _, p := range r.participants {
		out = append(out, p.info())
	}
	return out
}

func (r *Room) participantIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.participants))
	for id := range r.participants {
		out = append(out, id)
	}
	return out
}

// addParticipant registers a new participant and immediately wires every
// currently-published track from every OTHER participant into this one's
// subscribe connection, so their very first subscribe offer already
// reflects the full current call state.
func (r *Room) addParticipant(p *Participant) {
	r.mu.Lock()
	existing := make([]*Participant, 0, len(r.participants))
	for _, other := range r.participants {
		existing = append(existing, other)
	}
	r.participants[p.UserID] = p
	r.mu.Unlock()

	for _, other := range existing {
		other.mu.Lock()
		tracks := make([]*publishedTrack, 0, len(other.publishedTracks))
		for _, pt := range other.publishedTracks {
			tracks = append(tracks, pt)
		}
		other.mu.Unlock()

		for _, pt := range tracks {
			r.wireSubscriber(p, other, pt)
		}
	}
}

// onParticipantPublished wires a newly published track from `publisher`
// into every OTHER current room member's subscribe connection.
func (r *Room) onParticipantPublished(publisher *Participant, pt *publishedTrack) {
	r.mu.RLock()
	subscribers := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		if p.UserID != publisher.UserID {
			subscribers = append(subscribers, p)
		}
	}
	r.mu.RUnlock()

	for _, sub := range subscribers {
		r.wireSubscriber(sub, publisher, pt)
	}
}

// wireSubscriber adds one publisher's track as a new local track on one
// subscriber's subscribe PC, triggering that subscriber's renegotiation.
func (r *Room) wireSubscriber(subscriber, publisher *Participant, pt *publishedTrack) {
	streamID := publisher.UserID
	if pt.kind == kindScreen {
		streamID = publisher.UserID + ":screen"
	}
	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		pt.remote.Codec().RTPCodecCapability,
		pt.remote.ID(),
		streamID,
	)
	if err != nil {
		logger.Errorf("rtc: create local track for forwarding: %v", err)
		return
	}

	sender, err := subscriber.subscribePC.AddTrack(localTrack)
	if err != nil {
		logger.Errorf("rtc: add forwarded track to %s's subscribe PC: %v", subscriber.UserID, err)
		return
	}
	go drainRTCPSender(sender)

	pt.addSubscriber(subscriber.UserID, localTrack, sender)

	// New subscriber, existing video stream: ask the publisher for a fresh
	// keyframe immediately rather than waiting for the periodic interval
	// PLI, so this subscriber isn't stuck looking at a blank frame.
	if pt.kind == kindVideo || pt.kind == kindScreen {
		requestKeyframe(publisher.publishPC, pt.remote.SSRC())
	}
}

// removeParticipant tears the given participant out of the room: unwires
// every track they were forwarding to others, unwires every track others
// were forwarding to them (implicit — closing their subscribePC does that),
// closes both of their PeerConnections, and notifies everyone left.
func (r *Room) removeParticipant(userID string) {
	r.mu.Lock()
	p, ok := r.participants[userID]
	if ok {
		delete(r.participants, userID)
	}
	remaining := make([]*Participant, 0, len(r.participants))
	for _, other := range r.participants {
		remaining = append(remaining, other)
	}
	r.mu.Unlock()

	if !ok {
		return
	}

	// Unwire this participant's published tracks from every remaining
	// subscriber's subscribe PC.
	p.mu.Lock()
	tracks := make([]*publishedTrack, 0, len(p.publishedTracks))
	for _, pt := range p.publishedTracks {
		tracks = append(tracks, pt)
	}
	p.mu.Unlock()

	for _, pt := range tracks {
		for _, other := range remaining {
			if sender, ok := pt.removeSubscriber(other.UserID); ok {
				if err := other.subscribePC.RemoveTrack(sender); err != nil {
					logger.Debugf("rtc: remove track from %s's subscribe PC: %v", other.UserID, err)
				}
			}
		}
	}

	p.close()
	logger.Infof("rtc: %s left room %s (%d remaining)", userID, r.channelID, len(remaining))
}

func (r *Room) broadcastTrackState(userID string, kind trackKind, enabled bool) {
	r.mu.RLock()
	targets := make([]string, 0, len(r.participants))
	for id := range r.participants {
		if id != userID {
			targets = append(targets, id)
		}
	}
	r.mu.RUnlock()

	payload := TrackStatePayload{ChannelID: r.channelID, UserID: userID, Kind: string(kind), Enabled: enabled}
	for _, id := range targets {
		r.mgr.send(id, MsgTrackState, payload)
	}
}

func (r *Room) broadcastParticipantEvent(msgType string, self string, info ParticipantInfo) {
	r.mu.RLock()
	targets := make([]string, 0, len(r.participants))
	for id := range r.participants {
		if id != self {
			targets = append(targets, id)
		}
	}
	r.mu.RUnlock()

	payload := ParticipantEventPayload{ChannelID: r.channelID, User: info}
	for _, id := range targets {
		r.mgr.send(id, msgType, payload)
	}
}

func (r *Room) getParticipant(userID string) (*Participant, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.participants[userID]
	if !ok {
		return nil, fmt.Errorf("rtc: %s is not in room %s", userID, r.channelID)
	}
	return p, nil
}
