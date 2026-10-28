package tests

import (
	"cove/backend/internal/auth"
	"cove/backend/internal/models"
	"cove/backend/internal/voice"
	"errors"
	"net"
	"testing"
	"time"
)

// fakeMembership lets tests control which (user, channel) pairs are
// "members" without standing up a real store.
type fakeMembership struct {
	allowed map[string]bool // "userID:channelID" -> allowed
}

func (f *fakeMembership) GetUserChannel(userID, channelID string) (*models.UserChannel, error) {
	if f.allowed[userID+":"+channelID] {
		return &models.UserChannel{UserID: userID, ChannelID: channelID}, nil
	}
	return nil, errors.New("not a member")
}

func TestVoiceRouter_ChannelSession(t *testing.T) {
	// 1. Setup SessionStore
	sessions := auth.NewSessionStore(1 * time.Hour)
	user1ID := "user1-36-chars-uuid-mock-id-value!!!"
	user2ID := "user2-36-chars-uuid-mock-id-value!!!"
	user3ID := "user3-36-chars-uuid-mock-id-value!!!"
	token1, _ := sessions.Create(user1ID, "user1")
	token2, _ := sessions.Create(user2ID, "user2")
	token3, _ := sessions.Create(user3ID, "user3")

	// 2. Setup Router
	router := voice.NewRouter(sessions, nil, nil)

	// 3. Setup UDP listener
	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer conn.Close()

	serverAddr := conn.LocalAddr().(*net.UDPAddr)
	go router.HandleConn(conn)

	// 4. Setup Clients
	dial := func() *net.UDPConn {
		c, err := net.DialUDP("udp", nil, serverAddr)
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		return c
	}
	c1 := dial()
	defer c1.Close()
	c2 := dial()
	defer c2.Close()
	c3 := dial()
	defer c3.Close()

	// 5. Register & Join Channel
	channelID := "channel-36-chars-uuid-mock-id-value!"

	registerAndJoin := func(c *net.UDPConn, token string) {
		c.Write(append([]byte{voice.PacketTypeRegister}, []byte(token)...))
		time.Sleep(10 * time.Millisecond)
		c.Write(append([]byte{voice.PacketTypeJoin}, []byte(channelID)...))
		time.Sleep(10 * time.Millisecond)
	}

	registerAndJoin(c1, token1)
	registerAndJoin(c2, token2)
	registerAndJoin(c3, token3)

	// 6. Test Broadcasting
	audioPayload := []byte("hello-channel")

	// C1 sends audio to the channel
	pkt := append([]byte{voice.PacketTypeAudio}, []byte(channelID)...)
	pkt = append(pkt, audioPayload...)
	c1.Write(pkt)

	// C2 and C3 should receive the audio
	verifyReceive := func(c *net.UDPConn, expectedSender string) {
		buf := make([]byte, 1024)
		c.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		n, _, err := c.ReadFromUDP(buf)
		if err != nil {
			t.Fatalf("client failed to receive audio: %v", err)
		}
		if buf[0] != voice.PacketTypeAudio {
			t.Errorf("expected PacketTypeAudio, got %d", buf[0])
		}
		senderID := string(buf[1 : 1+voice.IDLength])
		if senderID != expectedSender {
			t.Errorf("expected senderID %s, got %s", expectedSender, senderID)
		}
		receivedAudio := buf[1+voice.IDLength : n]
		if string(receivedAudio) != string(audioPayload) {
			t.Errorf("expected audio %s, got %s", string(audioPayload), string(receivedAudio))
		}
	}

	verifyReceive(c2, user1ID)
	verifyReceive(c3, user1ID)

	// 7. Test Leave
	c2.Write(append([]byte{voice.PacketTypeLeave}, []byte(channelID)...))
	time.Sleep(10 * time.Millisecond)

	c1.Write(pkt) // C1 sends audio again

	// C3 should still receive it
	verifyReceive(c3, user1ID)

	// C2 should NOT receive it (timeout)
	c2.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	_, _, err = c2.ReadFromUDP(make([]byte, 1024))
	if err == nil {
		t.Error("C2 received audio after leaving channel")
	}
}

// TestVoiceRouter_ShortRegisterTokenDoesNotCrash guards against a
// slice-out-of-range panic: a Register packet whose token payload is
// shorter than the 10-byte log preview used to slice it (e.g. a single
// garbage byte) previously panicked the UDP read loop, which — since Go
// crashes the whole process on an unrecovered panic in any goroutine —
// took down the entire server (HTTP API, WS hub, and voice router) from a
// single malformed packet. The router must log the failed validation and
// keep serving other clients instead.
func TestVoiceRouter_ShortRegisterTokenDoesNotCrash(t *testing.T) {
	sessions := auth.NewSessionStore(1 * time.Hour)
	router := voice.NewRouter(sessions, nil, nil)

	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer conn.Close()

	serverAddr := conn.LocalAddr().(*net.UDPAddr)
	go router.HandleConn(conn)

	attacker, err := net.DialUDP("udp", nil, serverAddr)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer attacker.Close()

	// A Register packet with a 1-byte (invalid, too-short-to-slice) token.
	attacker.Write([]byte{voice.PacketTypeRegister, 'x'})
	time.Sleep(20 * time.Millisecond)

	// The router must still be alive and able to serve a legitimate client.
	user1ID := "user1-36-chars-uuid-mock-id-value!!!"
	token1, _ := sessions.Create(user1ID, "user1")

	victim, err := net.DialUDP("udp", nil, serverAddr)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer victim.Close()

	victim.Write(append([]byte{voice.PacketTypeRegister}, []byte(token1)...))
	time.Sleep(20 * time.Millisecond)

	addrOf, err := router.GetUserAddr(user1ID)
	if err != nil {
		t.Fatalf("router did not survive malformed packet: registration failed: %v", err)
	}
	if addrOf == nil {
		t.Fatal("registered address is nil")
	}
}

// TestVoiceRouter_JoinRejectedForNonMember guards against an IDOR where any
// registered user could join an arbitrary channel's live voice session
// (eavesdropping on/injecting audio into a channel they aren't a member of)
// just by naming its ID in a Join packet. With a membership checker wired
// in, an unauthorized join must be silently dropped and never receive
// audio from the channel it wasn't allowed into.
func TestVoiceRouter_JoinRejectedForNonMember(t *testing.T) {
	sessions := auth.NewSessionStore(1 * time.Hour)
	memberID := "member-36-chars-uuid-mock-id-value!!"
	outsiderID := "outsider-36-chars-uuid-mock-id-value"
	memberToken, _ := sessions.Create(memberID, "member")
	outsiderToken, _ := sessions.Create(outsiderID, "outsider")

	channelID := "channel-36-chars-uuid-mock-id-value!"
	membership := &fakeMembership{allowed: map[string]bool{
		memberID + ":" + channelID: true,
		// outsiderID is deliberately absent.
	}}

	router := voice.NewRouter(sessions, nil, membership)

	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer conn.Close()

	serverAddr := conn.LocalAddr().(*net.UDPAddr)
	go router.HandleConn(conn)

	dial := func() *net.UDPConn {
		c, err := net.DialUDP("udp", nil, serverAddr)
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		return c
	}
	memberConn := dial()
	defer memberConn.Close()
	outsiderConn := dial()
	defer outsiderConn.Close()

	registerAndJoin := func(c *net.UDPConn, token string) {
		c.Write(append([]byte{voice.PacketTypeRegister}, []byte(token)...))
		time.Sleep(10 * time.Millisecond)
		c.Write(append([]byte{voice.PacketTypeJoin}, []byte(channelID)...))
		time.Sleep(10 * time.Millisecond)
	}

	registerAndJoin(memberConn, memberToken)
	registerAndJoin(outsiderConn, outsiderToken) // should be rejected

	audioPayload := []byte("secret-audio")
	pkt := append([]byte{voice.PacketTypeAudio}, []byte(channelID)...)
	pkt = append(pkt, audioPayload...)
	memberConn.Write(pkt)

	// The outsider must NOT receive the member's audio.
	outsiderConn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	_, _, err = outsiderConn.ReadFromUDP(make([]byte, 1024))
	if err == nil {
		t.Fatal("outsider received audio from a channel they were rejected from joining")
	}
}

// TestVoiceRouter_RemoveUser guards against a user who crashes/disconnects
// without sending a Leave packet becoming a permanent "ghost" participant:
// RemoveUser (wired from the WS hub's disconnect path) must purge them from
// the active channel session and from address routing so no more audio is
// misrouted to or expected from them.
func TestVoiceRouter_RemoveUser(t *testing.T) {
	sessions := auth.NewSessionStore(1 * time.Hour)
	user1ID := "user1-36-chars-uuid-mock-id-value!!!"
	user2ID := "user2-36-chars-uuid-mock-id-value!!!"
	token1, _ := sessions.Create(user1ID, "user1")
	token2, _ := sessions.Create(user2ID, "user2")

	router := voice.NewRouter(sessions, nil, nil)

	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer conn.Close()

	serverAddr := conn.LocalAddr().(*net.UDPAddr)
	go router.HandleConn(conn)

	dial := func() *net.UDPConn {
		c, err := net.DialUDP("udp", nil, serverAddr)
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		return c
	}
	c1 := dial()
	defer c1.Close()
	c2 := dial()
	defer c2.Close()

	channelID := "channel-36-chars-uuid-mock-id-value!"
	registerAndJoin := func(c *net.UDPConn, token string) {
		c.Write(append([]byte{voice.PacketTypeRegister}, []byte(token)...))
		time.Sleep(10 * time.Millisecond)
		c.Write(append([]byte{voice.PacketTypeJoin}, []byte(channelID)...))
		time.Sleep(10 * time.Millisecond)
	}
	registerAndJoin(c1, token1)
	registerAndJoin(c2, token2)

	// Simulate user1 crashing/disconnecting without ever sending Leave.
	router.RemoveUser(user1ID)

	if _, err := router.GetUserAddr(user1ID); err == nil {
		t.Fatal("RemoveUser did not clear the user's registered address")
	}

	// user2 sends audio; since user1 was purged from the channel's active
	// set, they must not be counted as a target (nothing to assert on the
	// wire directly here, but a stale entry would previously have kept
	// user1 in BroadcastVoiceState's participant list forever).
	c2.Write(append([]byte{voice.PacketTypeAudio}, append([]byte(channelID), []byte("hello")...)...))
	time.Sleep(20 * time.Millisecond)

	// A fresh registration reusing user1's old identity-adjacent state
	// should behave normally (no leftover state causes a panic or wrong
	// routing) — smoke check that the router is still healthy.
	if addrOf, err := router.GetUserAddr(user2ID); err != nil || addrOf == nil {
		t.Fatalf("router unhealthy after RemoveUser: %v", err)
	}
}
