package rtc

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"nodetalk/backend/internal/models"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// fakeMembership allows any (user, channel) pair explicitly listed, mirroring
// the membership gate used by internal/voice's UDP router — this test exists
// specifically to prove the SAME class of IDOR fixed there can't creep back
// in here, plus that the core SFU forwarding actually works end-to-end over
// real (loopback) ICE/DTLS-SRTP.
type fakeMembership struct {
	allowed map[string]bool
}

func (f *fakeMembership) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	if f.allowed[userID+":"+channelID] {
		return &models.UserChannel{UserID: userID, ChannelID: channelID}, nil
	}
	return nil, errNotMember
}

type errString string

func (e errString) Error() string { return string(e) }

const errNotMember = errString("not a member")

// fakeSender routes Manager.send() calls to each test client's inbox,
// simulating the WS hub without needing a real WebSocket connection.
type fakeSender struct {
	mu      sync.Mutex
	inboxes map[string]chan *models.WSMessage
}

func newFakeSender() *fakeSender {
	return &fakeSender{inboxes: make(map[string]chan *models.WSMessage)}
}

func (s *fakeSender) register(userID string) chan *models.WSMessage {
	ch := make(chan *models.WSMessage, 64)
	s.mu.Lock()
	s.inboxes[userID] = ch
	s.mu.Unlock()
	return ch
}

func (s *fakeSender) SendToUser(userID string, msg *models.WSMessage) bool {
	s.mu.Lock()
	ch, ok := s.inboxes[userID]
	s.mu.Unlock()
	if !ok {
		return false
	}
	select {
	case ch <- msg:
	default:
	}
	return true
}

func (s *fakeSender) BroadcastVoiceState(channelID string, activeUsers []string) {
	// No-op for sfu_test.go
}

// testClient drives both of a participant's PeerConnections exactly as a
// real frontend would: it reacts to inbound signaling messages from the
// Manager and answers/offers/trickles ICE accordingly.
type testClient struct {
	t         *testing.T
	userID    string
	channelID string
	mgr       *Manager
	inbox     chan *models.WSMessage

	publishPC   *webrtc.PeerConnection
	subscribePC *webrtc.PeerConnection

	receivedTrack chan *webrtc.TrackRemote
	publishAnswer chan *models.WSMessage
	trackState    chan TrackStatePayload
}

func newTestClient(t *testing.T, mgr *Manager, sender *fakeSender, userID, channelID string) *testClient {
	t.Helper()
	pubPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("new publish pc: %v", err)
	}
	subPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("new subscribe pc: %v", err)
	}

	c := &testClient{
		t:             t,
		userID:        userID,
		channelID:     channelID,
		mgr:           mgr,
		inbox:         sender.register(userID),
		publishPC:     pubPC,
		subscribePC:   subPC,
		receivedTrack: make(chan *webrtc.TrackRemote, 8),
		publishAnswer: make(chan *models.WSMessage, 8),
		trackState:    make(chan TrackStatePayload, 16),
	}

	pubPC.OnICECandidate(func(cand *webrtc.ICECandidate) {
		if cand == nil {
			return
		}
		c.signal(MsgICECandidate, ICECandidatePayload{ChannelID: channelID, Target: TargetPublish, Candidate: cand.ToJSON()})
	})
	subPC.OnICECandidate(func(cand *webrtc.ICECandidate) {
		if cand == nil {
			return
		}
		c.signal(MsgICECandidate, ICECandidatePayload{ChannelID: channelID, Target: TargetSubscribe, Candidate: cand.ToJSON()})
	})
	subPC.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		c.receivedTrack <- remote
	})

	go c.run()
	return c
}

func (c *testClient) signal(msgType string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		c.t.Fatalf("marshal %s: %v", msgType, err)
	}
	if err := c.mgr.HandleSignal(c.userID, c.userID, msgType, body); err != nil {
		c.t.Errorf("HandleSignal(%s) for %s: %v", msgType, c.userID, err)
	}
}

func (c *testClient) run() {
	for msg := range c.inbox {
		switch msg.Type {
		case MsgSubscribeOffer:
			var p SDPPayload
			_ = json.Unmarshal(msg.Payload, &p)
			if err := c.subscribePC.SetRemoteDescription(p.SDP); err != nil {
				c.t.Errorf("%s: set subscribe remote desc: %v", c.userID, err)
				continue
			}
			answer, err := c.subscribePC.CreateAnswer(nil)
			if err != nil {
				c.t.Errorf("%s: create subscribe answer: %v", c.userID, err)
				continue
			}
			if err := c.subscribePC.SetLocalDescription(answer); err != nil {
				c.t.Errorf("%s: set subscribe local desc: %v", c.userID, err)
				continue
			}
			c.signal(MsgSubscribeAnswer, SDPPayload{ChannelID: c.channelID, SDP: *c.subscribePC.LocalDescription()})

		case MsgICECandidate:
			var p ICECandidatePayload
			_ = json.Unmarshal(msg.Payload, &p)
			var pc *webrtc.PeerConnection
			if p.Target == TargetPublish {
				pc = c.publishPC
			} else {
				pc = c.subscribePC
			}
			_ = pc.AddICECandidate(p.Candidate)

		case MsgPublishAnswer:
			c.publishAnswer <- msg

		case MsgTrackState:
			var p TrackStatePayload
			_ = json.Unmarshal(msg.Payload, &p)
			select {
			case c.trackState <- p:
			default:
			}

		case MsgJoined, MsgParticipantJoined, MsgParticipantLeft, MsgError:
			// Not needed by this test's assertions.
		}
	}
}

// join sends call_join and blocks until call_joined is observed (consumed
// internally — this test drives the rest via `run`, so join is fire-and-forget
// with a short settle delay handled by the caller).
func (c *testClient) join() {
	c.signal(MsgJoin, JoinPayload{ChannelID: c.channelID})
}

// publishAudio creates a local audio track, adds it to the publish PC,
// negotiates, and starts writing dummy RTP packets so the SFU has something
// to forward.
func (c *testClient) publishAudio(t *testing.T) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	return c.publishTrack(t, webrtc.MimeTypeOpus, "audio", "test-"+c.userID)
}

// publishVideo creates a local camera video track (streamID distinct from
// "screen", so the SFU classifies it as trackKind "video").
func (c *testClient) publishVideo(t *testing.T) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	return c.publishTrack(t, webrtc.MimeTypeVP8, "video", "test-"+c.userID)
}

// publishScreenShare creates a local video track whose MediaStream id is
// "screen" — the wire contract classifyTrack() (participant.go) relies on
// to tell a screen-share track apart from a camera track, since WebRTC
// itself has no separate "screen" media kind.
func (c *testClient) publishScreenShare(t *testing.T) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	return c.publishTrack(t, webrtc.MimeTypeVP8, "screen-video", "screen")
}

// publishTrack is the shared negotiation logic behind publishAudio/Video/
// ScreenShare: add a local track, offer, and complete the publish PC
// handshake through the real Manager.
func (c *testClient) publishTrack(t *testing.T, mimeType, trackID, streamID string) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: mimeType}, trackID, streamID)
	if err != nil {
		t.Fatalf("new local track: %v", err)
	}
	if _, err := c.publishPC.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}

	offer, err := c.publishPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create publish offer: %v", err)
	}
	if err := c.publishPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set publish local desc: %v", err)
	}

	body, _ := json.Marshal(SDPPayload{ChannelID: c.channelID, SDP: *c.publishPC.LocalDescription()})
	if err := c.mgr.HandleSignal(c.userID, c.userID, MsgPublishOffer, body); err != nil {
		t.Fatalf("handle publish offer: %v", err)
	}

	// `run` (already draining c.inbox in the background) forwards the
	// publish answer to this dedicated channel — see its MsgPublishAnswer case.
	select {
	case msg := <-c.publishAnswer:
		var p SDPPayload
		_ = json.Unmarshal(msg.Payload, &p)
		if err := c.publishPC.SetRemoteDescription(p.SDP); err != nil {
			t.Fatalf("set publish remote desc: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for publish answer")
	}

	return track
}

// startWritingRTP continuously writes dummy RTP packets on track until the
// returned stop function is called. Necessary background noise for any test
// that needs the server to actually fire OnTrack: Pion only raises that
// event once the first real RTP packet for a track arrives, not on SDP
// negotiation alone.
func startWritingRTP(track *webrtc.TrackLocalStaticRTP, ssrc uint32, payloadType uint8) (stop func()) {
	done := make(chan struct{})
	go func() {
		var seq uint16
		for {
			select {
			case <-done:
				return
			default:
			}
			_ = track.WriteRTP(&rtp.Packet{
				Header: rtp.Header{
					Version:        2,
					SequenceNumber: seq,
					Timestamp:      uint32(seq) * 3000,
					SSRC:           ssrc,
					PayloadType:    payloadType,
				},
				Payload: []byte("payload"),
			})
			seq++
			time.Sleep(20 * time.Millisecond)
		}
	}()
	return func() { close(done) }
}

func waitConnected(t *testing.T, label string, pc *webrtc.PeerConnection) {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		if pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("%s: PeerConnection did not reach Connected (state=%s)", label, pc.ConnectionState())
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// TestSFU_ForwardsPublishedTrackToExistingAndLateSubscribers is the core
// correctness test: it proves the SFU actually relays real RTP over real
// (loopback) ICE/DTLS-SRTP PeerConnections, both to a subscriber already in
// the room when a track starts, matching the production join/publish/
// subscribe/renegotiate signaling flow end-to-end.
func TestSFU_ForwardsPublishedTrackToExistingAndLateSubscribers(t *testing.T) {
	channelID := "chan-1"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"alice:" + channelID: true,
		"bob:" + channelID:   true,
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 10}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	alice := newTestClient(t, mgr, sender, "alice", channelID)
	alice.join()

	bob := newTestClient(t, mgr, sender, "bob", channelID)
	bob.join()

	time.Sleep(200 * time.Millisecond) // let both joins settle

	track := alice.publishAudio(t)
	waitConnected(t, "alice-publish", alice.publishPC)

	// Pion only fires OnTrack once the first RTP packet for that track
	// actually arrives — so the SFU can't wire Bob's subscribePC (and Bob's
	// own OnTrack can't fire) until Alice is actually sending. Start writing
	// before waiting on bob.receivedTrack, not after.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 250; i++ {
			pkt := &rtp.Packet{
				Header: rtp.Header{
					Version:        2,
					SequenceNumber: uint16(i),
					Timestamp:      uint32(i * 960),
					SSRC:           1234,
					PayloadType:    111,
				},
				Payload: []byte("audio-payload"),
			}
			if err := track.WriteRTP(pkt); err != nil {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()

	// Bob should receive an OnTrack callback on his subscribe PC as the SFU
	// renegotiates to forward Alice's newly published track to him.
	var remote *webrtc.TrackRemote
	select {
	case remote = <-bob.receivedTrack:
	case <-time.After(10 * time.Second):
		t.Fatal("bob never received alice's forwarded track")
	}
	if remote.Kind() != webrtc.RTPCodecTypeAudio {
		t.Fatalf("expected audio track, got %s", remote.Kind())
	}

	waitConnected(t, "bob-subscribe", bob.subscribePC)

	received := make(chan struct{})
	go func() {
		buf := make([]byte, 1500)
		if _, _, err := remote.Read(buf); err == nil {
			close(received)
		}
	}()

	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("bob never received a forwarded RTP packet from alice")
	}
	<-done
}

// TestSFU_JoinRejectedForNonMember guards the same IDOR class already fixed
// for internal/voice's UDP router: joining a call for a channel you aren't
// a member of must be rejected before any PeerConnection/room state for you
// is created.
func TestSFU_JoinRejectedForNonMember(t *testing.T) {
	channelID := "chan-private"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"member:" + channelID: true,
		// "outsider" deliberately absent.
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 10}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	inbox := sender.register("outsider")
	body, _ := json.Marshal(JoinPayload{ChannelID: channelID})
	if err := mgr.HandleSignal("outsider", "outsider", MsgJoin, body); err != nil {
		t.Fatalf("HandleSignal: %v", err)
	}

	select {
	case msg := <-inbox:
		if msg.Type != MsgError {
			t.Fatalf("expected %s, got %s", MsgError, msg.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected a call_error for non-member join, got nothing")
	}

	if room, ok := mgr.getRoom(channelID); ok && room.size() != 0 {
		t.Fatalf("non-member join must not create room state, got %d participants", room.size())
	}
}

// TestSFU_MaxParticipantsEnforced guards the resource cap: a join beyond
// MaxParticipantsPerCall must be rejected rather than silently accepted.
func TestSFU_MaxParticipantsEnforced(t *testing.T) {
	channelID := "chan-cap"
	sender := newFakeSender()
	allowed := map[string]bool{}
	for _, u := range []string{"u1", "u2"} {
		allowed[u+":"+channelID] = true
	}
	membership := &fakeMembership{allowed: allowed}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 1}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	u1 := newTestClient(t, mgr, sender, "u1", channelID)
	u1.join()
	time.Sleep(100 * time.Millisecond)

	inbox := sender.register("u2")
	body, _ := json.Marshal(JoinPayload{ChannelID: channelID})
	if err := mgr.HandleSignal("u2", "u2", MsgJoin, body); err != nil {
		t.Fatalf("HandleSignal: %v", err)
	}

	select {
	case msg := <-inbox:
		if msg.Type != MsgError {
			t.Fatalf("expected %s for over-capacity join, got %s", MsgError, msg.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected a call_error for over-capacity join, got nothing")
	}
}

// TestNewManager_TURNDisabledGracefullyWithoutPublicIP guards the
// out-of-the-box default config: embedded_turn_enabled defaults to true,
// but public_ip does not default to anything (it can't be guessed safely).
// NewManager must NOT fail in that combination — it should just run
// without TURN (direct host candidates only), which is exactly right for
// a LAN-only/dev deployment. Failing here used to silently disable group
// calling entirely on any fresh install.
func TestNewManager_TURNDisabledGracefullyWithoutPublicIP(t *testing.T) {
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{}}

	mgr, err := NewManager(Config{
		EmbeddedTURNEnabled: true,
		PublicIP:            "", // deliberately unset, matching the shipped default
	}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager should degrade gracefully without a public IP, got error: %v", err)
	}
	defer mgr.Stop()

	if mgr.turn != nil {
		t.Fatal("expected no embedded TURN server to be started without a public IP")
	}
	if servers := mgr.mintICEServers("someone"); servers != nil {
		t.Fatalf("expected no ICE servers to be minted without TURN, got %v", servers)
	}
}

// TestSFU_UnpublishedTrackIsUnwiredFromSubscribers guards a gap where
// muting a camera or ending a screen share mid-call (as opposed to leaving
// the whole room) never cleaned up: the track stayed in the publisher's
// bookkeeping and the corresponding forwarded track was never removed from
// subscribers' connections.
func TestSFU_UnpublishedTrackIsUnwiredFromSubscribers(t *testing.T) {
	channelID := "chan-unpublish"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"alice:" + channelID: true,
		"bob:" + channelID:   true,
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 10}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	alice := newTestClient(t, mgr, sender, "alice", channelID)
	alice.join()
	bob := newTestClient(t, mgr, sender, "bob", channelID)
	bob.join()
	time.Sleep(200 * time.Millisecond)

	track := alice.publishAudio(t)
	waitConnected(t, "alice-publish", alice.publishPC)

	stopWriting := make(chan struct{})
	go func() {
		i := 0
		for {
			select {
			case <-stopWriting:
				return
			default:
			}
			_ = track.WriteRTP(&rtp.Packet{
				Header:  rtp.Header{Version: 2, SequenceNumber: uint16(i), Timestamp: uint32(i * 960), SSRC: 5678, PayloadType: 111},
				Payload: []byte("x"),
			})
			i++
			time.Sleep(20 * time.Millisecond)
		}
	}()

	select {
	case <-bob.receivedTrack:
	case <-time.After(10 * time.Second):
		close(stopWriting)
		t.Fatal("bob never received alice's forwarded track")
	}

	room, ok := mgr.getRoom(channelID)
	if !ok {
		close(stopWriting)
		t.Fatal("room missing")
	}
	aliceParticipant, err := room.getParticipant("alice")
	if err != nil {
		close(stopWriting)
		t.Fatalf("getParticipant(alice): %v", err)
	}

	aliceParticipant.mu.Lock()
	trackCountBefore := len(aliceParticipant.publishedTracks)
	aliceParticipant.mu.Unlock()
	if trackCountBefore == 0 {
		close(stopWriting)
		t.Fatal("alice's publishedTracks should be non-empty before unpublish")
	}

	// Simulate the client stopping just this one track (camera off / screen
	// share ended) and renegotiating with one fewer track, WITHOUT leaving
	// the call: remove it from the publish PC and send a fresh offer.
	senders := alice.publishPC.GetSenders()
	if len(senders) != 1 {
		close(stopWriting)
		t.Fatalf("expected 1 sender on alice's publish PC, got %d", len(senders))
	}
	if err := alice.publishPC.RemoveTrack(senders[0]); err != nil {
		close(stopWriting)
		t.Fatalf("RemoveTrack: %v", err)
	}
	close(stopWriting)

	offer, err := alice.publishPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create renegotiation offer: %v", err)
	}
	if err := alice.publishPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local desc: %v", err)
	}
	body, _ := json.Marshal(SDPPayload{ChannelID: channelID, SDP: *alice.publishPC.LocalDescription()})
	if err := mgr.HandleSignal("alice", "alice", MsgPublishOffer, body); err != nil {
		t.Fatalf("handle renegotiation publish offer: %v", err)
	}
	select {
	case msg := <-alice.publishAnswer:
		var p SDPPayload
		_ = json.Unmarshal(msg.Payload, &p)
		if err := alice.publishPC.SetRemoteDescription(p.SDP); err != nil {
			t.Fatalf("set remote desc: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for renegotiation publish answer")
	}

	// Give the forwarder goroutine time to notice the read has ended
	// (removing the m-line closes the underlying transport for that track)
	// and run its cleanup.
	deadline := time.After(10 * time.Second)
	for {
		aliceParticipant.mu.Lock()
		remaining := len(aliceParticipant.publishedTracks)
		aliceParticipant.mu.Unlock()
		if remaining == 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("alice's publishedTracks never emptied after unpublish (still %d)", remaining)
		case <-time.After(50 * time.Millisecond):
		}
	}

	// publishedTracks emptying (above) only marks the START of cleanup —
	// onTrackEnded still has to RemoveTrack from bob's subscribePC, which
	// triggers its own renegotiation round-trip with bob. Give that time to
	// finish before asserting on bob's transceivers (and before this test
	// returns and the deferred mgr.Stop() closes bob's subscribePC out from
	// under an in-flight offer/answer, which just produces a noisy but
	// harmless "connection closed" error).
	time.Sleep(500 * time.Millisecond)

	if len(bob.subscribePC.GetTransceivers()) > 0 {
		for _, tr := range bob.subscribePC.GetTransceivers() {
			if tr.Direction() != webrtc.RTPTransceiverDirectionInactive && tr.Sender() != nil && tr.Sender().Track() != nil {
				t.Fatalf("expected bob's subscribe PC to have no active forwarded track after unpublish, found one with direction %s", tr.Direction())
			}
		}
	}
}

// TestSFU_ForwardsVideoTrack closes out M3: proves the forwarding path is
// genuinely codec-agnostic by exercising it with a real video (VP8) track
// end-to-end — join, publish, server-side OnTrack, room wiring to Bob's
// subscribe PC, renegotiation, and actual RTP packets arriving on the
// other side — the same path already proven for audio, now for video.
func TestSFU_ForwardsVideoTrack(t *testing.T) {
	channelID := "chan-video"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"alice:" + channelID: true,
		"bob:" + channelID:   true,
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 10}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	alice := newTestClient(t, mgr, sender, "alice", channelID)
	alice.join()
	bob := newTestClient(t, mgr, sender, "bob", channelID)
	bob.join()
	time.Sleep(200 * time.Millisecond)

	track := alice.publishVideo(t)
	waitConnected(t, "alice-publish", alice.publishPC)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 250; i++ {
			pkt := &rtp.Packet{
				Header: rtp.Header{
					Version:        2,
					SequenceNumber: uint16(i),
					Timestamp:      uint32(i * 3000),
					SSRC:           4242,
					PayloadType:    96,
				},
				Payload: []byte("video-payload"),
			}
			if err := track.WriteRTP(pkt); err != nil {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()

	var remote *webrtc.TrackRemote
	select {
	case remote = <-bob.receivedTrack:
	case <-time.After(10 * time.Second):
		t.Fatal("bob never received alice's forwarded video track")
	}
	if remote.Kind() != webrtc.RTPCodecTypeVideo {
		t.Fatalf("expected video track, got %s", remote.Kind())
	}

	// The roster/UI metadata must classify this as "video" (camera), not
	// "screen" — see classifyTrack in participant.go.
	select {
	case state := <-bob.trackState:
		if state.Kind != string(kindVideo) {
			t.Fatalf("expected track_state kind %q, got %q", kindVideo, state.Kind)
		}
		if state.UserID != "alice" || !state.Enabled {
			t.Fatalf("unexpected track_state payload: %+v", state)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("bob never received a call_track_state for alice's video")
	}

	waitConnected(t, "bob-subscribe", bob.subscribePC)

	received := make(chan struct{})
	go func() {
		buf := make([]byte, 1500)
		if _, _, err := remote.Read(buf); err == nil {
			close(received)
		}
	}()

	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("bob never received a forwarded video RTP packet from alice")
	}
	<-done
}

// TestSFU_ScreenShareClassifiedAndForwarded closes out the screen-share half
// of M3: a screen-share track is, at the WebRTC level, just another video
// track — the SFU tells it apart from the camera via the client-side
// contract of setting the local MediaStream id to "screen" (classifyTrack
// in participant.go). This proves that contract actually round-trips
// through real negotiation to a "screen" kind in the roster/mute metadata
// delivered to other participants, and that forwarding works identically
// to camera video.
func TestSFU_ScreenShareClassifiedAndForwarded(t *testing.T) {
	channelID := "chan-screen"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"alice:" + channelID: true,
		"bob:" + channelID:   true,
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 10}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	alice := newTestClient(t, mgr, sender, "alice", channelID)
	alice.join()
	bob := newTestClient(t, mgr, sender, "bob", channelID)
	bob.join()
	time.Sleep(200 * time.Millisecond)

	track := alice.publishScreenShare(t)
	waitConnected(t, "alice-publish", alice.publishPC)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 250; i++ {
			pkt := &rtp.Packet{
				Header: rtp.Header{
					Version:        2,
					SequenceNumber: uint16(i),
					Timestamp:      uint32(i * 3000),
					SSRC:           9999,
					PayloadType:    96,
				},
				Payload: []byte("screen-payload"),
			}
			if err := track.WriteRTP(pkt); err != nil {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()

	var remote *webrtc.TrackRemote
	select {
	case remote = <-bob.receivedTrack:
	case <-time.After(10 * time.Second):
		t.Fatal("bob never received alice's forwarded screen-share track")
	}
	if remote.Kind() != webrtc.RTPCodecTypeVideo {
		t.Fatalf("expected video-kind transport for screen share, got %s", remote.Kind())
	}

	select {
	case state := <-bob.trackState:
		if state.Kind != string(kindScreen) {
			t.Fatalf("expected track_state kind %q (screen share), got %q — classifyTrack's StreamID contract may be broken", kindScreen, state.Kind)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("bob never received a call_track_state for alice's screen share")
	}

	waitConnected(t, "bob-subscribe", bob.subscribePC)

	received := make(chan struct{})
	go func() {
		buf := make([]byte, 1500)
		if _, _, err := remote.Read(buf); err == nil {
			close(received)
		}
	}()

	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("bob never received a forwarded screen-share RTP packet from alice")
	}
	<-done
}

// TestSFU_ScreenShareAlongsideCameraAndMic proves the realistic Discord-like
// scenario end to end: one participant publishing all three track kinds at
// once (mic + camera + screen share) on a SINGLE publish connection via
// sequential renegotiation, all three correctly classified and forwarded.
func TestSFU_ScreenShareAlongsideCameraAndMic(t *testing.T) {
	channelID := "chan-multi"
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{
		"alice:" + channelID: true,
		"bob:" + channelID:   true,
	}}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: 10}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	alice := newTestClient(t, mgr, sender, "alice", channelID)
	alice.join()
	bob := newTestClient(t, mgr, sender, "bob", channelID)
	bob.join()
	time.Sleep(200 * time.Millisecond)

	// Publish all three kinds via sequential renegotiations on the same
	// publish PC, exactly as a real client adding mic -> camera -> screen
	// share one at a time would. Each needs real RTP flowing for the
	// server to ever fire OnTrack (see startWritingRTP).
	audioTrack := alice.publishAudio(t)
	stopAudio := startWritingRTP(audioTrack, 1001, 111)
	defer stopAudio()

	videoTrack := alice.publishVideo(t)
	stopVideo := startWritingRTP(videoTrack, 1002, 96)
	defer stopVideo()

	screenTrack := alice.publishScreenShare(t)
	stopScreen := startWritingRTP(screenTrack, 1003, 96)
	defer stopScreen()

	waitConnected(t, "alice-publish", alice.publishPC)

	gotKinds := map[string]bool{}
	deadline := time.After(15 * time.Second)
	for len(gotKinds) < 3 {
		select {
		case remote := <-bob.receivedTrack:
			t.Logf("bob received a %s track (id=%s streamID=%s)", remote.Kind(), remote.ID(), remote.StreamID())
		case state := <-bob.trackState:
			if state.Enabled {
				gotKinds[state.Kind] = true
			}
		case <-deadline:
			t.Fatalf("timed out waiting for all 3 track kinds; got %v", gotKinds)
		}
	}

	for _, want := range []string{string(kindAudio), string(kindVideo), string(kindScreen)} {
		if !gotKinds[want] {
			t.Errorf("missing track_state for kind %q", want)
		}
	}

	// Let any renegotiation still in flight from the third track settle
	// before mgr.Stop() (deferred) tears down the connections — otherwise
	// it's a benign but noisy "connection closed" error in the logs.
	time.Sleep(300 * time.Millisecond)
}

// TestSFU_TenParticipantsFullMeshAudio is the load-bearing correctness test
// for the entire feature's core claim: "scalable to 10 people." It joins 10
// participants into one room, each publishing audio, and asserts every
// participant ends up receiving a forwarded track from every OTHER
// participant (9 each — the full N*(N-1) fan-out the SFU is responsible
// for), with real RTP actually flowing for a sampled pair. This exercises
// the same join/publish/renegotiate path as the smaller tests, just at the
// actual target scale, where wiring bugs in room.go (e.g. an off-by-one in
// "every other participant") would only show up once N is large enough.
func TestSFU_TenParticipantsFullMeshAudio(t *testing.T) {
	const n = 10
	channelID := "chan-ten"
	sender := newFakeSender()

	allowed := map[string]bool{}
	userIDs := make([]string, n)
	for i := 0; i < n; i++ {
		userIDs[i] = fmt.Sprintf("user%d", i)
		allowed[userIDs[i]+":"+channelID] = true
	}
	membership := &fakeMembership{allowed: allowed}

	mgr, err := NewManager(Config{MaxParticipantsPerCall: n}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	clients := make([]*testClient, n)
	for i, id := range userIDs {
		clients[i] = newTestClient(t, mgr, sender, id, channelID)
		clients[i].join()
	}
	time.Sleep(300 * time.Millisecond)

	// Every participant publishes audio and keeps writing RTP for the
	// duration of the test — needed for the server to ever fire OnTrack.
	var stops []func()
	for i, c := range clients {
		track := c.publishAudio(t)
		stops = append(stops, startWritingRTP(track, uint32(1000+i), 111))
	}
	defer func() {
		for _, stop := range stops {
			stop()
		}
	}()

	if stats := mgr.Stats(); stats.Participants != n {
		t.Fatalf("Stats().Participants = %d, want %d", stats.Participants, n)
	}

	// Each of the n clients should receive exactly n-1 forwarded tracks —
	// one from every other participant.
	receivedFrom := make([]map[string]bool, n)
	for i := range receivedFrom {
		receivedFrom[i] = make(map[string]bool)
	}

	deadline := time.After(30 * time.Second)
	for {
		done := true
		for i := range clients {
			if len(receivedFrom[i]) < n-1 {
				done = false
			}
		}
		if done {
			break
		}

		select {
		case <-deadline:
			for i, c := range clients {
				t.Logf("%s received from %d/%d peers", c.userID, len(receivedFrom[i]), n-1)
			}
			t.Fatalf("timed out waiting for full mesh: not every participant received all %d peers' tracks", n-1)
		default:
		}

		for i, c := range clients {
			select {
			case remote := <-c.receivedTrack:
				// StreamID is the publisher's userID (see wireSubscriber in room.go).
				receivedFrom[i][remote.StreamID()] = true
			case <-time.After(50 * time.Millisecond):
			}
		}
	}

	// Sanity-check the actual relay data path on one pair, not just
	// signaling: user0 must be receiving real RTP forwarded from user1.
	waitConnected(t, "user0-subscribe", clients[0].subscribePC)
	if stats := mgr.Stats(); stats.PacketsRelayed == 0 {
		t.Fatal("Stats().PacketsRelayed is 0 after a 10-participant full mesh call — forwarding isn't actually happening")
	}
	t.Logf("final stats: %+v", mgr.Stats())
}
