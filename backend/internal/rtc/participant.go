package rtc

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"nodetalk/backend/internal/logger"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// trackKind classifies a published track for the room roster / UI, derived
// from the track's Kind() (audio/video) plus, for video, the client-chosen
// MediaStream ID or Track ID. Contract: a screen-share track MUST be added
// with its MediaStream or Track ID set to or containing "screen" (e.g.
// `pc.addTrack(track, screenStream)`) so the SFU can tell it apart from
// the camera track — both are otherwise just "video" tracks to WebRTC.
type trackKind string

const (
	kindAudio  trackKind = "audio"
	kindVideo  trackKind = "video"
	kindScreen trackKind = "screen"
)

func classifyTrack(remote *webrtc.TrackRemote) trackKind {
	streamID := strings.ToLower(remote.StreamID())
	trackID := strings.ToLower(remote.ID())
	if streamID == "screen" || trackID == "screen" || strings.Contains(streamID, "screen") || strings.Contains(trackID, "screen") {
		return kindScreen
	}
	if remote.Kind() == webrtc.RTPCodecTypeAudio {
		return kindAudio
	}
	return kindVideo
}

func (p *Participant) classifyTrack(remote *webrtc.TrackRemote) trackKind {
	streamID := strings.ToLower(remote.StreamID())
	trackID := strings.ToLower(remote.ID())
	if streamID == "screen" || trackID == "screen" || strings.Contains(streamID, "screen") || strings.Contains(trackID, "screen") {
		return kindScreen
	}

	p.mu.Lock()
	screenTrackID := p.screenTrackID
	screenStreamID := p.screenStreamID
	isScreenState := p.trackStates[string(kindScreen)]
	isVideoState := p.trackStates[string(kindVideo)]
	hasExistingVideo := false
	hasExistingAudio := false
	for _, pt := range p.publishedTracks {
		if pt.kind == kindVideo {
			hasExistingVideo = true
		}
		if pt.kind == kindAudio {
			hasExistingAudio = true
		}
	}
	p.mu.Unlock()

	if screenTrackID != "" && (remote.ID() == screenTrackID || strings.Contains(remote.ID(), screenTrackID)) {
		return kindScreen
	}
	if screenStreamID != "" && (remote.StreamID() == screenStreamID || strings.Contains(remote.StreamID(), screenStreamID)) {
		return kindScreen
	}

	if remote.Kind() == webrtc.RTPCodecTypeAudio {
		if hasExistingAudio {
			return kindScreen
		}
		return kindAudio
	}

	if isScreenState && !isVideoState {
		return kindScreen
	}
	if hasExistingVideo {
		return kindScreen
	}
	return kindVideo
}

// publishedTrack is one track a participant is uploading, and the set of
// per-subscriber local tracks the SFU is forwarding it through.
type publishedTrack struct {
	key    string // participant.publishedTracks key, so onEnded can remove itself
	kind   trackKind
	remote *webrtc.TrackRemote

	mu      sync.Mutex
	forward map[string]*webrtc.TrackLocalStaticRTP // subscriber userID -> local track on their subscribePC
	senders map[string]*webrtc.RTPSender           // subscriber userID -> the RTPSender, needed to RemoveTrack later

	stop chan struct{} // closed to stop the forwarding goroutine
}

// Participant holds the two server-side PeerConnections for one user in one
// call (see package doc for why there are two), plus the bookkeeping needed
// to forward tracks and serialize subscribe-side renegotiation.
type Participant struct {
	UserID   string
	Username string

	mgr  *Manager
	room *Room

	publishPC   *webrtc.PeerConnection
	subscribePC *webrtc.PeerConnection

	mu              sync.Mutex
	publishedTracks map[string]*publishedTrack // keyed by remote.ID()+":"+remote.StreamID()
	trackStates     map[string]bool            // "audio"|"video"|"screen" -> enabled (mute state for roster/UI)
	screenTrackID   string
	screenStreamID  string

	pendingPublishCandidates   []webrtc.ICECandidateInit
	pendingSubscribeCandidates []webrtc.ICECandidateInit

	negoMu       sync.Mutex
	negoInFlight bool
	negoPending  bool

	// closing is set before either PeerConnection is torn down, so a track's
	// forwardTrack loop exiting as a *side effect* of that (rather than the
	// client actually stopping just that one track) knows to skip its
	// individual per-track cleanup — room.removeParticipant already does
	// the bulk unwind in that case, and doing both would race on the same
	// subscriber PCs.
	closing   atomic.Bool
	closeOnce sync.Once
}

func newParticipant(mgr *Manager, room *Room, userID, username string) (*Participant, error) {
	p := &Participant{
		UserID:          userID,
		Username:        username,
		mgr:             mgr,
		room:            room,
		publishedTracks: make(map[string]*publishedTrack),
		trackStates:     map[string]bool{string(kindAudio): true, string(kindVideo): false, string(kindScreen): false},
	}

	publishPC, err := mgr.api.NewPeerConnection(mgr.webrtcConfig())
	if err != nil {
		return nil, fmt.Errorf("rtc: create publish PC: %w", err)
	}
	subscribePC, err := mgr.api.NewPeerConnection(mgr.webrtcConfig())
	if err != nil {
		_ = publishPC.Close()
		return nil, fmt.Errorf("rtc: create subscribe PC: %w", err)
	}
	p.publishPC = publishPC
	p.subscribePC = subscribePC

	p.wireCallbacks()
	return p, nil
}

func (p *Participant) wireCallbacks() {
	// Publish PC: this participant's own mic/cam/screen tracks flow IN here.
	// The client is always the offerer for this connection (it decides when
	// to add/remove its own tracks), so we never renegotiate it ourselves.
	p.publishPC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		p.mgr.send(p.UserID, MsgICECandidate, ICECandidatePayload{
			ChannelID: p.room.channelID,
			Target:    TargetPublish,
			Candidate: c.ToJSON(),
		})
	})
	p.publishPC.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			logger.Infof("rtc: publish PC for %s in room %s state=%s", p.UserID, p.room.channelID, s)
		}
	})
	p.publishPC.OnTrack(p.onPublishedTrack)

	// Subscribe PC: every OTHER participant's forwarded tracks flow OUT
	// here. The SERVER is always the offerer (it decides what to forward),
	// so OnNegotiationNeeded drives the offer/answer cycle from this side.
	p.subscribePC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		p.mgr.send(p.UserID, MsgICECandidate, ICECandidatePayload{
			ChannelID: p.room.channelID,
			Target:    TargetSubscribe,
			Candidate: c.ToJSON(),
		})
	})
	p.subscribePC.OnNegotiationNeeded(func() {
		p.requestSubscribeRenegotiation()
	})
	p.subscribePC.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			logger.Infof("rtc: subscribe PC for %s in room %s state=%s", p.UserID, p.room.channelID, s)
		}
	})
}

// onPublishedTrack is called by pion for each new track the client starts
// sending on the publish PC (mic, camera, and later screen-share — each is
// its own call since they're independent RTP streams/transceivers).
func (p *Participant) onPublishedTrack(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
	kind := p.classifyTrack(remote)
	trackKey := remote.ID() + ":" + remote.StreamID()

	logger.Infof("rtc: %s started publishing %s track (%s) in room %s", p.UserID, kind, trackKey, p.room.channelID)

	pt := &publishedTrack{
		key:     trackKey,
		kind:    kind,
		remote:  remote,
		forward: make(map[string]*webrtc.TrackLocalStaticRTP),
		senders: make(map[string]*webrtc.RTPSender),
		stop:    make(chan struct{}),
	}

	p.mu.Lock()
	p.publishedTracks[trackKey] = pt
	shouldBroadcast := true
	if kind == kindAudio && !p.trackStates[string(kindAudio)] {
		shouldBroadcast = false
	} else {
		p.trackStates[string(kind)] = true
	}
	p.mu.Unlock()

	// Drain RTCP on the receiver so interceptors (NACK, TWCC) actually run —
	// required by pion even though we don't inspect the packets ourselves.
	go drainRTCPReceiver(receiver)

	p.room.onParticipantPublished(p, pt)
	if shouldBroadcast {
		p.room.broadcastTrackState(p.UserID, kind, true)
	}

	go forwardTrack(p, pt)
}

// onTrackEnded runs once a published track's RTP stream stops for good
// (client stopped/removed just that track and renegotiated, or the whole
// publish connection is going away). It unwires the track from every
// current subscriber and updates the roster — without this, muting a
// camera or ending a screen share mid-call left dead forwarded tracks on
// every other participant's subscribe connection until they left entirely.
func (p *Participant) onTrackEnded(pt *publishedTrack) {
	if p.closing.Load() {
		// The whole participant is being torn down; room.removeParticipant
		// already unwinds every published track in bulk. Doing it again
		// here would race on the same subscriber PeerConnections.
		return
	}

	p.mu.Lock()
	delete(p.publishedTracks, pt.key)
	p.trackStates[string(pt.kind)] = false
	p.mu.Unlock()

	for userID, sender := range pt.snapshotSenders() {
		sub, err := p.room.getParticipant(userID)
		if err != nil {
			continue
		}
		if err := sub.subscribePC.RemoveTrack(sender); err != nil {
			logger.Debugf("rtc: remove ended track from %s's subscribe PC: %v", userID, err)
		}
	}

	p.room.broadcastTrackState(p.UserID, pt.kind, false)
	logger.Infof("rtc: %s stopped publishing %s track (%s) in room %s", p.UserID, pt.kind, pt.key, p.room.channelID)
}

// requestSubscribeRenegotiation serializes offer/answer cycles on the
// subscribe PC: only one offer may be outstanding at a time (the signaling
// state must be "stable" before creating a new one), so a negotiation
// requested while one is already in flight is coalesced into a single
// follow-up round once the current one's answer arrives.
func (p *Participant) requestSubscribeRenegotiation() {
	p.negoMu.Lock()
	if p.negoInFlight {
		p.negoPending = true
		p.negoMu.Unlock()
		return
	}
	p.negoInFlight = true
	p.negoMu.Unlock()

	p.sendSubscribeOffer()
}

func (p *Participant) sendSubscribeOffer() {
	offer, err := p.subscribePC.CreateOffer(nil)
	if err != nil {
		logger.Errorf("rtc: create subscribe offer for %s: %v", p.UserID, err)
		p.clearNegoInFlight()
		return
	}
	if err := p.subscribePC.SetLocalDescription(offer); err != nil {
		logger.Errorf("rtc: set local subscribe offer for %s: %v", p.UserID, err)
		p.clearNegoInFlight()
		return
	}
	p.mgr.send(p.UserID, MsgSubscribeOffer, SDPPayload{
		ChannelID: p.room.channelID,
		SDP:       *p.subscribePC.LocalDescription(),
	})
}

// onSubscribeAnswer applies the client's answer to a subscribe offer and
// fires the next queued renegotiation, if any arrived while this one was
// outstanding.
func (p *Participant) onSubscribeAnswer(sdp webrtc.SessionDescription) error {
	if err := p.subscribePC.SetRemoteDescription(sdp); err != nil {
		p.clearNegoInFlight()
		return err
	}
	p.flushPendingCandidates(p.subscribePC, &p.pendingSubscribeCandidates)

	p.negoMu.Lock()
	p.negoInFlight = false
	pending := p.negoPending
	p.negoPending = false
	p.negoMu.Unlock()

	if pending {
		p.requestSubscribeRenegotiation()
	}

	// Request immediate keyframes for all video/screen tracks forwarded to this subscriber
	// so their newly stable decoder immediately gets decodable I-frames
	p.room.requestKeyframes("")
	time.AfterFunc(350*time.Millisecond, func() {
		p.room.requestKeyframes("")
	})

	return nil
}

func (p *Participant) clearNegoInFlight() {
	p.negoMu.Lock()
	p.negoInFlight = false
	pending := p.negoPending
	p.negoPending = false
	p.negoMu.Unlock()
	if pending {
		p.requestSubscribeRenegotiation()
	}
}

func (p *Participant) onPublishOffer(sdp webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	if err := p.publishPC.SetRemoteDescription(sdp); err != nil {
		return webrtc.SessionDescription{}, err
	}
	p.flushPendingCandidates(p.publishPC, &p.pendingPublishCandidates)

	answer, err := p.publishPC.CreateAnswer(nil)
	if err != nil {
		return webrtc.SessionDescription{}, err
	}
	if err := p.publishPC.SetLocalDescription(answer); err != nil {
		return webrtc.SessionDescription{}, err
	}
	return *p.publishPC.LocalDescription(), nil
}

func (p *Participant) addICECandidate(target PCTarget, candidate webrtc.ICECandidateInit) error {
	var pc *webrtc.PeerConnection
	var pending *[]webrtc.ICECandidateInit
	if target == TargetPublish {
		pc, pending = p.publishPC, &p.pendingPublishCandidates
	} else {
		pc, pending = p.subscribePC, &p.pendingSubscribeCandidates
	}

	if pc.RemoteDescription() == nil {
		p.mu.Lock()
		*pending = append(*pending, candidate)
		p.mu.Unlock()
		return nil
	}
	return pc.AddICECandidate(candidate)
}

func (p *Participant) flushPendingCandidates(pc *webrtc.PeerConnection, pending *[]webrtc.ICECandidateInit) {
	p.mu.Lock()
	toFlush := *pending
	*pending = nil
	p.mu.Unlock()
	for _, c := range toFlush {
		if err := pc.AddICECandidate(c); err != nil {
			logger.Warnf("rtc: flush pending ICE candidate for %s: %v", p.UserID, err)
		}
	}
}

// setTrackState updates the mute/enabled flag the roster reports for this
// participant, and optionally records the screen share track/stream IDs.
func (p *Participant) setTrackState(kind trackKind, enabled bool, trackID, streamID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.trackStates[string(kind)] = enabled
	if kind == kindScreen {
		if enabled {
			p.screenTrackID = trackID
			p.screenStreamID = streamID
		} else {
			p.screenTrackID = ""
			p.screenStreamID = ""
		}
	}
}

func (p *Participant) info() ParticipantInfo {
	p.mu.Lock()
	states := make(map[string]bool, len(p.trackStates))
	for k, v := range p.trackStates {
		states[k] = v
	}
	p.mu.Unlock()
	return ParticipantInfo{UserID: p.UserID, Username: p.Username, TrackStates: states}
}

// close tears down both PeerConnections and every forwarding goroutine this
// participant owns. Safe to call more than once.
func (p *Participant) close() {
	p.closeOnce.Do(func() {
		p.closing.Store(true)

		p.mu.Lock()
		tracks := make([]*publishedTrack, 0, len(p.publishedTracks))
		for _, pt := range p.publishedTracks {
			tracks = append(tracks, pt)
		}
		p.mu.Unlock()

		for _, pt := range tracks {
			close(pt.stop)
		}
		_ = p.publishPC.Close()
		_ = p.subscribePC.Close()
	})
}

// drainRTCPReceiver reads (and discards) RTCP from an RTPReceiver. Pion's
// interceptors (NACK, TWCC) are wired into this read path, so — even though
// we don't use the packets ourselves — this loop MUST run for the whole
// life of the track or retransmission/congestion-control simply won't work.
func drainRTCPReceiver(receiver *webrtc.RTPReceiver) {
	buf := make([]byte, 1500)
	for {
		if _, _, err := receiver.Read(buf); err != nil {
			return
		}
	}
}

// drainRTCPSender reads RTCP packets arriving from a subscriber. It inspects
// incoming feedback for PictureLossIndication (PLI) and FullIntraRequest (FIR)
// packets and forwards them to the publisher so that a subscriber whose decoder
// joins mid-stream or drops frames receives an immediate keyframe.
func drainRTCPSender(sender *webrtc.RTPSender, pubPC *webrtc.PeerConnection, pubSSRC webrtc.SSRC) {
	for {
		pkts, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		for _, pkt := range pkts {
			switch pkt.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				if pubPC != nil && pubSSRC != 0 {
					requestKeyframe(pubPC, pubSSRC)
				}
			}
		}
	}
}

// requestKeyframe asks a publisher for a fresh keyframe via PLI. Used when
// a new subscriber starts receiving an already-in-progress video track, so
// they don't have to wait out the periodic interval PLI to get a decodable
// picture.
func requestKeyframe(pc *webrtc.PeerConnection, ssrc webrtc.SSRC) {
	_ = pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(ssrc)}})
}
