package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"

	"cove/backend/internal/mediarouter"
	"cove/backend/internal/models"
	"cove/udpmedia"
)

// callSender records WebSocket messages the router would deliver, per user.
type callSender struct {
	mu    sync.Mutex
	msgs  map[string][]*models.WSMessage
	voice map[string][]string
}

func (s *callSender) SendToUser(userID string, msg *models.WSMessage) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.msgs == nil {
		s.msgs = map[string][]*models.WSMessage{}
	}
	s.msgs[userID] = append(s.msgs[userID], msg)
	return true
}

func (s *callSender) BroadcastVoiceState(channelID string, users []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.voice == nil {
		s.voice = map[string][]string{}
	}
	s.voice[channelID] = append([]string(nil), users...)
}

func (s *callSender) voiceState(ch string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.voice[ch]...)
}

// take removes and returns the first queued message of the given type for user, waiting up to d.
func (s *callSender) take(user, typ string, d time.Duration) (json.RawMessage, bool) {
	deadline := time.Now().Add(d)
	for {
		s.mu.Lock()
		for i, m := range s.msgs[user] {
			if m.Type == typ {
				s.msgs[user] = append(s.msgs[user][:i:i], s.msgs[user][i+1:]...)
				s.mu.Unlock()
				return m.Payload, true
			}
		}
		s.mu.Unlock()
		if time.Now().After(deadline) {
			return nil, false
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// callMembers is a mutable membership source returning a channel-membership status per user.
type callMembers struct {
	mu     sync.Mutex
	status map[string]string // "user:channel" -> status
}

func (m *callMembers) set(user, ch, status string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status == nil {
		m.status = map[string]string{}
	}
	m.status[user+":"+ch] = status
}

func (m *callMembers) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.status[userID+":"+channelID]
	if !ok {
		return nil, context.Canceled // any error: not a member
	}
	return &models.UserChannel{UserID: userID, ChannelID: channelID, Status: st}, nil
}

type callEnv struct {
	t       *testing.T
	router  *mediarouter.Router
	sender  *callSender
	members *callMembers
	conn    *net.UDPConn
	addr    string
}

func newCallEnv(t *testing.T, cfg mediarouter.Config) *callEnv {
	t.Helper()
	e := &callEnv{t: t, sender: &callSender{}, members: &callMembers{}}
	e.router = mediarouter.New(cfg, e.members, e.sender)
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	e.conn = conn
	e.addr = conn.LocalAddr().String()
	done := make(chan struct{})
	go func() { e.router.Serve(conn); close(done) }()
	t.Cleanup(func() {
		_ = conn.Close()
		e.router.Stop()
		<-done
	})
	return e
}

func (e *callEnv) addMember(user, ch string) { e.members.set(user, ch, models.StatusActive) }

type party struct {
	user, ch string
	mediaID  uint16
	resp     udpmedia.JoinResponse
	ring     *udpmedia.Keyring
	client   *udpmedia.Client
	joined   mediarouter.JoinedPayload
}

// joinSignal performs the WebSocket half of joining and returns the party with its keyring but no UDP client.
func (e *callEnv) joinSignal(user, ch string) *party {
	e.t.Helper()
	cj, req, err := udpmedia.NewClientJoin()
	if err != nil {
		e.t.Fatal(err)
	}
	payload, _ := json.Marshal(mediarouter.JoinPayload{ChannelID: ch, Media: &req})
	if err := e.router.HandleSignal(user, user+"-name", mediarouter.MsgJoin, payload); err != nil {
		e.t.Fatal(err)
	}
	raw, ok := e.sender.take(user, mediarouter.MsgJoined, 2*time.Second)
	if !ok {
		e.t.Fatalf("%s: no call_joined", user)
	}
	p := &party{user: user, ch: ch}
	if err := json.Unmarshal(raw, &p.joined); err != nil {
		e.t.Fatal(err)
	}
	p.resp = p.joined.Media
	p.mediaID = p.resp.MediaID
	if p.ring, err = cj.Complete(p.resp, ch, user); err != nil {
		e.t.Fatal(err)
	}
	return p
}

// join completes signalling, opens a UDP client and performs the HELLO handshake.
func (e *callEnv) join(user, ch string) *party {
	e.t.Helper()
	p := e.joinSignal(user, ch)
	c, err := udpmedia.Dial(e.addr, p.ring)
	if err != nil {
		e.t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Handshake(ctx); err != nil {
		e.t.Fatalf("%s: handshake: %v", user, err)
	}
	p.client = c
	e.t.Cleanup(func() { _ = c.Close() })
	return p
}

func (p *party) recv(d time.Duration) (udpmedia.ReceivedFrame, bool) {
	select {
	case f, ok := <-p.client.Frames():
		return f, ok
	case <-time.After(d):
		return udpmedia.ReceivedFrame{}, false
	}
}

func (p *party) expectNothing(t *testing.T, d time.Duration) {
	t.Helper()
	if f, ok := p.recv(d); ok {
		t.Fatalf("%s unexpectedly received a frame from %d (%d bytes)", p.user, f.Src, len(f.Data))
	}
}

func TestMediaRouter_JoinRequiresActiveMembership(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("alice", "room")
	e.members.set("kicked", "room", models.StatusKicked)

	for _, user := range []string{"stranger", "kicked"} {
		_, req, _ := udpmedia.NewClientJoin()
		payload, _ := json.Marshal(mediarouter.JoinPayload{ChannelID: "room", Media: &req})
		_ = e.router.HandleSignal(user, user, mediarouter.MsgJoin, payload)
		if _, ok := e.sender.take(user, mediarouter.MsgJoined, 100*time.Millisecond); ok {
			t.Fatalf("%s received keys for a channel they are not an active member of", user)
		}
		if _, ok := e.sender.take(user, mediarouter.MsgError, time.Second); !ok {
			t.Fatalf("%s got no call_error", user)
		}
	}
	if rooms := e.router.ActiveRooms(); len(rooms) != 0 {
		t.Fatalf("rejected joins created rooms: %v", rooms)
	}
}

func TestMediaRouter_JoinWithoutMediaIsRefused(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("web", "room")
	payload, _ := json.Marshal(mediarouter.JoinPayload{ChannelID: "room"})
	_ = e.router.HandleSignal("web", "web", mediarouter.MsgJoin, payload)
	if _, ok := e.sender.take("web", mediarouter.MsgError, time.Second); !ok {
		t.Fatal("a join without a media handshake (web client) was not refused")
	}
	if len(e.router.ActiveRooms()) != 0 {
		t.Fatal("room created")
	}
}

func TestMediaRouter_WebRTCSignalsAreRejected(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	if err := e.router.HandleSignal("u", "u", "call_publish_offer", []byte(`{}`)); err == nil {
		t.Fatal("WebRTC-only signalling accepted in raw_udp mode")
	}
	if err := e.router.HandleSignal("u", "u", mediarouter.MsgJoin, []byte(`not json`)); err == nil {
		t.Fatal("malformed join accepted")
	}
}

func TestMediaRouter_ThreeParticipantsForwarding(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	for _, u := range []string{"a", "b", "c"} {
		e.addMember(u, "room")
	}
	e.addMember("x", "other")
	a, b, c := e.join("a", "room"), e.join("b", "room"), e.join("c", "room")
	x := e.join("x", "other")

	audio := mkFrame(160, 1)
	video := mkFrame(9000, 2) // 9 fragments
	screen := mkFrame(3000, 3)
	if err := a.client.SendFrame(udpmedia.KindAudio, udpmedia.CodecOpus, 0, 20, audio); err != nil {
		t.Fatal(err)
	}
	if err := a.client.SendFrame(udpmedia.KindVideo, udpmedia.CodecH264, udpmedia.FlagKeyframe, 40, video); err != nil {
		t.Fatal(err)
	}
	if err := a.client.SendFrame(udpmedia.KindScreen, udpmedia.CodecVP8, udpmedia.FlagKeyframe, 60, screen); err != nil {
		t.Fatal(err)
	}

	want := map[udpmedia.Kind][]byte{udpmedia.KindAudio: audio, udpmedia.KindVideo: video, udpmedia.KindScreen: screen}
	for _, rcv := range []*party{b, c} {
		got := map[udpmedia.Kind][]byte{}
		for len(got) < 3 {
			f, ok := rcv.recv(2 * time.Second)
			if !ok {
				t.Fatalf("%s received only %d of 3 streams", rcv.user, len(got))
			}
			if f.Src != a.mediaID {
				t.Errorf("%s: frame src = %d, want %d", rcv.user, f.Src, a.mediaID)
			}
			got[f.Kind] = f.Data
		}
		for k, w := range want {
			if !bytes.Equal(got[k], w) {
				t.Errorf("%s: kind %d payload differs after forwarding", rcv.user, k)
			}
		}
	}
	a.expectNothing(t, 150*time.Millisecond) // no echo to the sender
	x.expectNothing(t, 50*time.Millisecond)  // other rooms never see it
	if got := e.sender.voiceState("room"); len(got) != 3 {
		t.Errorf("voice state = %v", got)
	}
}

func TestMediaRouter_ServerStampsSourceAndIgnoresSpoofedSrc(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	for _, u := range []string{"a", "b", "c"} {
		e.addMember(u, "room")
	}
	a, b, c := e.joinSignal("a", "room"), e.join("b", "room"), e.join("c", "room")
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	hello, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, udpmedia.HelloPlaintextLen))
	conn.Write(hello)
	conn.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 2000)
	if n, err := conn.Read(buf); err != nil {
		t.Fatalf("no hello ack: %v", err)
	} else if _, _, err := a.ring.Open(buf[:n]); err != nil {
		t.Fatalf("hello ack: %v", err)
	}
	// "a" claims to be c (or anyone) in the media header.
	pt := udpmedia.AppendMedia(nil, udpmedia.MediaHeader{Src: c.mediaID, Kind: udpmedia.KindAudio, Codec: udpmedia.CodecOpus, FrameID: 0, FragCnt: 1}, []byte("spoof"))
	pkt, _ := a.ring.Seal(udpmedia.TypeMedia, pt)
	conn.Write(pkt)
	f, ok := b.recv(time.Second)
	if !ok || f.Src != a.mediaID || string(f.Data) != "spoof" {
		t.Fatalf("receiver saw src %d (ok=%v), want the true sender %d", f.Src, ok, a.mediaID)
	}
	if f, ok := c.recv(time.Second); !ok || f.Src != a.mediaID {
		t.Fatalf("c saw src %d (ok=%v), want the true sender %d", f.Src, ok, a.mediaID)
	}
}

func TestMediaRouter_UnauthenticatedTrafficGetsNoReplyAndNoForwarding(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	a := e.join("a", "room")
	b := e.join("b", "room")
	_ = a

	attacker, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer attacker.Close()
	cliOther, _ := newKeyringPair(t)
	forgeSid, _ := cliOther.Seal(udpmedia.TypeHello, make([]byte, 64))
	b64, _ := a.ring.Seal(udpmedia.TypeMedia, udpmedia.AppendMedia(nil, udpmedia.MediaHeader{Kind: udpmedia.KindAudio, FragCnt: 1}, []byte("x")))
	tampered := append([]byte{}, b64...)
	tampered[len(tampered)-1] ^= 1
	helloBase, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
	tamperedHello := append([]byte{}, helloBase...)
	tamperedHello[len(tamperedHello)-1] ^= 1
	badSid := append([]byte{}, b64...)
	badSid[5] ^= 0xFF
	attacks := [][]byte{
		nil, {0}, {0xC1}, bytes.Repeat([]byte{0xC1}, 40), bytes.Repeat([]byte{0xC1}, udpmedia.MaxPacket+1),
		{voiceLegacyRegister, 't', 'o', 'k'}, forgeSid, tampered, tamperedHello, badSid,
	}
	for _, p := range attacks {
		attacker.Write(p)
	}
	attacker.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
	if n, err := attacker.Read(make([]byte, 2000)); err == nil {
		t.Fatalf("server answered unauthenticated traffic with %d bytes", n)
	}
	b.expectNothing(t, 100*time.Millisecond)
	st := e.router.Stats()
	if st.DroppedNotCove == 0 || st.DroppedUnknownSession == 0 || st.DroppedAuth == 0 || st.DroppedOversize == 0 {
		t.Errorf("drop counters not incremented: %+v", st)
	}
}

const voiceLegacyRegister = 0 // first byte of a legacy, unencrypted Register packet

func TestMediaRouter_ReplayedPacketIsNotForwardedTwice(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	a := e.joinSignal("a", "room")
	b := e.join("b", "room")
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	hello, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
	conn.Write(hello)
	time.Sleep(50 * time.Millisecond)
	pkt, _ := a.ring.Seal(udpmedia.TypeMedia, udpmedia.AppendMedia(nil, udpmedia.MediaHeader{Kind: udpmedia.KindAudio, Codec: udpmedia.CodecOpus, FragCnt: 1}, []byte("once")))
	for i := 0; i < 5; i++ {
		conn.Write(pkt)
	}
	if _, ok := b.recv(time.Second); !ok {
		t.Fatal("original packet not delivered")
	}
	b.expectNothing(t, 200*time.Millisecond)
	if e.router.Stats().Forwarded != 1 {
		t.Fatalf("forwarded %d times, want 1", e.router.Stats().Forwarded)
	}
}

func TestMediaRouter_HelloReplyNeverLargerThanRequest(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	a := e.joinSignal("a", "room")
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	for _, n := range []int{udpmedia.HelloPlaintextLen, 100, 256} {
		pkt, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, n))
		conn.Write(pkt)
		conn.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 2000)
		got, err := conn.Read(buf)
		if err != nil {
			t.Fatalf("no ack for %d-byte hello: %v", n, err)
		}
		if got > len(pkt) {
			t.Errorf("reply of %d bytes to a %d-byte request is an amplification", got, len(pkt))
		}
	}
	// A hello below the minimum size is ignored, so tiny probes cannot elicit anything either.
	short, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 8))
	conn.Write(short)
	conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, err := conn.Read(make([]byte, 2000)); err == nil {
		t.Error("short hello was answered")
	}
}

func TestMediaRouter_MediaOnlyFromLearnedAddressHelloMovesIt(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	a := e.joinSignal("a", "room")
	b := e.join("b", "room")
	dial := func() *net.UDPConn {
		c, err := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		return c
	}
	home, roamed := dial(), dial()
	hello := func(c *net.UDPConn) {
		p, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
		c.Write(p)
	}
	media := func(c *net.UDPConn, id uint32) {
		pt := udpmedia.AppendMedia(nil, udpmedia.MediaHeader{Kind: udpmedia.KindAudio, Codec: udpmedia.CodecOpus, FrameID: id, FragCnt: 1}, []byte("m"))
		p, _ := a.ring.Seal(udpmedia.TypeMedia, pt)
		c.Write(p)
	}
	hello(home)
	time.Sleep(50 * time.Millisecond)
	media(roamed, 0) // authentic packet, wrong source address: dropped
	b.expectNothing(t, 150*time.Millisecond)
	if e.router.Stats().DroppedWrongAddr == 0 {
		t.Error("wrong-address drop not counted")
	}
	hello(roamed) // NAT rebind: an authentic HELLO moves the address
	time.Sleep(50 * time.Millisecond)
	media(roamed, 1)
	if _, ok := b.recv(time.Second); !ok {
		t.Fatal("media from the new address after HELLO was not forwarded")
	}
	media(home, 2) // the old address no longer counts
	b.expectNothing(t, 150*time.Millisecond)
}

func TestMediaRouter_OversizeDatagramDropped(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	a := e.joinSignal("a", "room")
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	huge := append([]byte{}, make([]byte, udpmedia.MaxPacket+1)...)
	p, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
	copy(huge, p)
	conn.Write(huge)
	conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, err := conn.Read(make([]byte, 2000)); err == nil {
		t.Fatal("oversize datagram answered")
	}
	if e.router.Stats().DroppedOversize != 1 {
		t.Fatalf("oversize drops = %d", e.router.Stats().DroppedOversize)
	}
}

func TestMediaRouter_PerSessionRateLimit(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{SessionPPS: 50, SessionBurst: 100})
	e.addMember("a", "room")
	a := e.joinSignal("a", "room")
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	for i := 0; i < 2000; i++ {
		p, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
		conn.Write(p)
	}
	time.Sleep(300 * time.Millisecond)
	if e.router.Stats().DroppedRate < 1000 {
		t.Fatalf("flood not limited: %+v", e.router.Stats())
	}
}

func TestMediaRouter_NackRetransmitsAfterLossOnTheDownlink(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	a := e.join("a", "room")

	// B reaches the server through a proxy that drops one large server-to-client datagram.
	bs := e.joinSignal("b", "room")
	largeSeen := 0
	proxy := newLossyProxy(t, e.addr, func(size int) bool {
		if size <= 300 {
			return false // HELLO_ACKs and other small control packets
		}
		largeSeen++
		return largeSeen == 2 // lose exactly the second media fragment
	})
	bc, err := udpmedia.Dial(proxy.addr(), bs.ring)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bc.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := bc.Handshake(ctx); err != nil {
		t.Fatal(err)
	}
	b := &party{user: "b", client: bc}

	video := mkFrame(6000, 5)
	if err := a.client.SendFrame(udpmedia.KindVideo, udpmedia.CodecH264, udpmedia.FlagKeyframe, 1, video); err != nil {
		t.Fatal(err)
	}
	f, ok := b.recv(3 * time.Second)
	if !ok || !bytes.Equal(f.Data, video) {
		t.Fatalf("frame not recovered after downlink loss (ok=%v)", ok)
	}
	if proxy.dropped() != 1 {
		t.Fatalf("proxy dropped %d packets, want 1", proxy.dropped())
	}
	if e.router.Stats().Resent == 0 {
		t.Fatal("recovery did not come from a server retransmission")
	}
}

func TestMediaRouter_KeyframeRequestIsRelayedToPublisherAndRateLimited(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	a, b := e.join("a", "room"), e.join("b", "room")
	for i := 0; i < 5; i++ {
		if err := b.client.RequestKeyframe(a.mediaID, udpmedia.KindVideo); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case k := <-a.client.KeyframeRequests():
		if k != udpmedia.KindVideo {
			t.Fatalf("kind = %d", k)
		}
	case <-time.After(time.Second):
		t.Fatal("publisher never received the keyframe request")
	}
	select {
	case <-a.client.KeyframeRequests():
		t.Fatal("keyframe requests were not rate limited")
	case <-time.After(150 * time.Millisecond):
	}
	// The WebSocket event reaches the same publisher.
	time.Sleep(550 * time.Millisecond)
	p, _ := json.Marshal(mediarouter.KeyframeRequestPayload{ChannelID: "room", UserID: "a"})
	if err := e.router.HandleSignal("b", "b", mediarouter.MsgRequestKeyframe, p); err != nil {
		t.Fatal(err)
	}
	select {
	case <-a.client.KeyframeRequests():
	case <-time.After(time.Second):
		t.Fatal("call_request_keyframe did not reach the publisher")
	}
}

func TestMediaRouter_NackCannotCrossRooms(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("x", "other")
	a, x := e.join("a", "room"), e.join("x", "other")
	_ = a.client.SendFrame(udpmedia.KindVideo, udpmedia.CodecVP8, udpmedia.FlagKeyframe, 1, mkFrame(500, 1))
	time.Sleep(100 * time.Millisecond)
	// x asks for a's frame using a's media id: ids are only resolved inside the requester's own room.
	_ = x.client.RequestKeyframe(a.mediaID, udpmedia.KindVideo)
	select {
	case <-a.client.KeyframeRequests():
		t.Fatal("a keyframe request crossed rooms")
	case <-time.After(200 * time.Millisecond):
	}
}

func TestMediaRouter_TrackStateBroadcast(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	e.addMember("c", "other")
	a, _ := e.join("a", "room"), e.join("b", "room")
	e.join("c", "other")
	// The roster given to b includes a; a was told b joined.
	if raw, ok := e.sender.take("a", mediarouter.MsgParticipantJoined, time.Second); !ok {
		t.Fatal("a was not told b joined")
	} else {
		var ev mediarouter.ParticipantEventPayload
		_ = json.Unmarshal(raw, &ev)
		if ev.User.UserID != "b" || ev.User.MediaID == 0 {
			t.Errorf("participant event = %+v", ev)
		}
	}
	send := func(user, ch, kind string, on bool) {
		p, _ := json.Marshal(mediarouter.TrackStatePayload{ChannelID: ch, Kind: kind, Enabled: on})
		_ = e.router.HandleSignal(user, user, mediarouter.MsgTrackState, p)
	}
	send("a", "room", "screen", true)
	raw, ok := e.sender.take("b", mediarouter.MsgTrackState, time.Second)
	if !ok {
		t.Fatal("track state not broadcast")
	}
	var ts mediarouter.TrackStatePayload
	_ = json.Unmarshal(raw, &ts)
	if ts.UserID != "a" || ts.Kind != "screen" || !ts.Enabled {
		t.Errorf("track state = %+v", ts)
	}
	if _, ok := e.sender.take("c", mediarouter.MsgTrackState, 100*time.Millisecond); ok {
		t.Error("track state leaked to another room")
	}
	if _, ok := e.sender.take("a", mediarouter.MsgTrackState, 100*time.Millisecond); ok {
		t.Error("track state echoed to its sender")
	}
	send("a", "room", "bogus", true)        // invalid kind
	send("a", "other", "video", true)       // not in that call
	send("outsider", "room", "video", true) // not in any call
	if _, ok := e.sender.take("b", mediarouter.MsgTrackState, 150*time.Millisecond); ok {
		t.Error("invalid track state was broadcast")
	}
	_ = a
}

func TestMediaRouter_LeaveByteAndRemoveUser(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	for _, u := range []string{"a", "b", "c"} {
		e.addMember(u, "room")
	}
	a, b, c := e.join("a", "room"), e.join("b", "room"), e.join("c", "room")

	// BYE over UDP ends a's session and tells the others.
	_ = a.client.Close()
	if _, ok := e.sender.take("b", mediarouter.MsgParticipantLeft, 2*time.Second); !ok {
		t.Fatal("BYE did not produce call_participant_left")
	}
	waitFor(t, func() bool { return len(e.sender.voiceState("room")) == 2 })

	// A dropped WebSocket (hub calls RemoveUser) does the same.
	e.router.RemoveUser("b")
	if _, ok := e.sender.take("c", mediarouter.MsgParticipantLeft, 2*time.Second); !ok {
		t.Fatal("RemoveUser did not notify the room")
	}
	_ = b
	_ = c
	e.router.RemoveUser("c")
	waitFor(t, func() bool { return len(e.router.ActiveRooms()) == 0 })
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestMediaRouter_KickedMemberLosesMediaImmediately(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("owner", "room")
	e.addMember("victim", "room")
	owner, victim := e.join("owner", "room"), e.join("victim", "room")

	e.router.EvictMember("room", "victim")
	e.members.set("victim", "room", models.StatusKicked)

	if raw, ok := e.sender.take("victim", mediarouter.MsgEnded, time.Second); !ok {
		t.Fatal("kicked member was not told the call ended")
	} else if !bytes.Contains(raw, []byte("removed")) {
		t.Errorf("reason = %s", raw)
	}
	if _, ok := e.sender.take("owner", mediarouter.MsgParticipantLeft, time.Second); !ok {
		t.Fatal("remaining members were not told")
	}
	// Neither direction works any more.
	_ = owner.client.SendFrame(udpmedia.KindAudio, udpmedia.CodecOpus, 0, 1, mkFrame(100, 1))
	victim.expectNothing(t, 200*time.Millisecond)
	before := e.router.Stats().Forwarded
	_ = victim.client.SendFrame(udpmedia.KindAudio, udpmedia.CodecOpus, 0, 1, mkFrame(100, 2))
	owner.expectNothing(t, 200*time.Millisecond)
	if e.router.Stats().Forwarded != before {
		t.Fatal("kicked member's media was still forwarded")
	}
	// A kicked member cannot simply join again.
	_, req, _ := udpmedia.NewClientJoin()
	payload, _ := json.Marshal(mediarouter.JoinPayload{ChannelID: "room", Media: &req})
	_ = e.router.HandleSignal("victim", "victim", mediarouter.MsgJoin, payload)
	if _, ok := e.sender.take("victim", mediarouter.MsgJoined, 150*time.Millisecond); ok {
		t.Fatal("kicked member re-joined")
	}
}

func TestMediaRouter_MembershipSweepEvictsRemovedMembers(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{SweepInterval: 20 * time.Millisecond, MembershipInterval: 40 * time.Millisecond})
	e.addMember("a", "room")
	e.addMember("b", "room")
	e.join("a", "room")
	e.join("b", "room")
	// Removed through some path that does not call EvictMember (ban, channel deletion, leaving on another device).
	e.members.set("b", "room", models.StatusKicked)
	if _, ok := e.sender.take("b", mediarouter.MsgEnded, 2*time.Second); !ok {
		t.Fatal("sweep did not evict a member who is no longer active")
	}
	if got := e.router.ActiveRooms()["room"]; len(got) != 1 || got[0] != "a" {
		t.Fatalf("room members = %v", got)
	}
}

func TestMediaRouter_TimeoutsForNeverEstablishedAndSilentSessions(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{SweepInterval: 20 * time.Millisecond, HelloTimeout: 100 * time.Millisecond, IdleTimeout: 150 * time.Millisecond})
	e.addMember("ghost", "room")
	e.addMember("quiet", "room")
	e.joinSignal("ghost", "room") // never says HELLO
	if _, ok := e.sender.take("ghost", mediarouter.MsgEnded, 2*time.Second); !ok {
		t.Fatal("session without HELLO was not reaped")
	}
	q := e.join("quiet", "room")
	_ = q // client keepalive is 5 s, so it falls silent for the idle timeout
	if _, ok := e.sender.take("quiet", mediarouter.MsgEnded, 2*time.Second); !ok {
		t.Fatal("silent session was not reaped")
	}
	waitFor(t, func() bool { return len(e.router.ActiveRooms()) == 0 })
}

func TestMediaRouter_RoomCapacityAndReplacingStaleSession(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{MaxParticipantsPerCall: 2})
	for _, u := range []string{"a", "b", "c"} {
		e.addMember(u, "room")
	}
	a1 := e.joinSignal("a", "room")
	e.joinSignal("b", "room")
	_, req, _ := udpmedia.NewClientJoin()
	payload, _ := json.Marshal(mediarouter.JoinPayload{ChannelID: "room", Media: &req})
	_ = e.router.HandleSignal("c", "c", mediarouter.MsgJoin, payload)
	if _, ok := e.sender.take("c", mediarouter.MsgError, time.Second); !ok {
		t.Fatal("full room accepted a third participant")
	}
	// A second join by the same user replaces the first (reload) rather than counting twice.
	a2 := e.joinSignal("a", "room")
	if a1.resp.SessionID == a2.resp.SessionID {
		t.Fatal("session id reused")
	}
	if got := e.router.ActiveRooms()["room"]; len(got) != 2 {
		t.Fatalf("members = %v", got)
	}
	old, _ := a1.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	conn.Write(old)
	conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, err := conn.Read(make([]byte, 2000)); err == nil {
		t.Fatal("replaced session still answers")
	}
}

func TestMediaRouter_RotationMidCallKeepsMediaFlowing(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	e.addMember("a", "room")
	e.addMember("b", "room")
	a, b := e.join("a", "room"), e.join("b", "room")

	// A forged packet claiming the next epoch must not disturb a live session.
	conn, _ := net.DialUDP("udp", nil, e.conn.LocalAddr().(*net.UDPAddr))
	defer conn.Close()
	forged, _ := a.ring.Seal(udpmedia.TypeHello, make([]byte, 64))
	forged[2] = 1
	conn.Write(forged)

	if err := a.ring.Rotate(); err != nil {
		t.Fatal(err)
	}
	if err := b.ring.Rotate(); err != nil {
		t.Fatal(err)
	}
	data := mkFrame(3000, 9)
	if err := a.client.SendFrame(udpmedia.KindVideo, udpmedia.CodecVP8, udpmedia.FlagKeyframe, 1, data); err != nil {
		t.Fatal(err)
	}
	f, ok := b.recv(2 * time.Second)
	if !ok || !bytes.Equal(f.Data, data) {
		t.Fatal("media did not flow after both ends rotated keys")
	}
	if a.ring.Epoch() != 1 {
		t.Fatalf("epoch = %d", a.ring.Epoch())
	}
}

func TestMediaRouter_ConcurrentSendersUnderRace(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	users := []string{"p1", "p2", "p3", "p4"}
	parties := make([]*party, len(users))
	for i, u := range users {
		e.addMember(u, "room")
		parties[i] = e.join(u, "room")
	}
	const frames = 40
	var wg sync.WaitGroup
	for _, p := range parties {
		wg.Add(1)
		go func(p *party) {
			defer wg.Done()
			for i := 0; i < frames; i++ {
				_ = p.client.SendFrame(udpmedia.KindAudio, udpmedia.CodecOpus, 0, uint32(i), mkFrame(120, int64(i)))
				time.Sleep(2 * time.Millisecond)
			}
		}(p)
	}
	wg.Wait()
	for _, p := range parties {
		got := map[uint16]int{}
		deadline := time.After(3 * time.Second)
		for total := 0; total < frames*(len(parties)-1); {
			select {
			case f := <-p.client.Frames():
				got[f.Src]++
				total++
			case <-deadline:
				// Audio is allowed to lose a little on a busy loopback; demand the vast majority from every sender.
				total = frames * len(parties)
			}
		}
		for _, q := range parties {
			if q == p {
				if got[q.mediaID] != 0 {
					t.Errorf("%s received its own audio", p.user)
				}
				continue
			}
			if got[q.mediaID] < frames*8/10 {
				t.Errorf("%s got only %d/%d frames from %s", p.user, got[q.mediaID], frames, q.user)
			}
		}
	}
}
