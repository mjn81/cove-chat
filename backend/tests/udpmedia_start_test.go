package tests

import (
	"net"
	"testing"
	"time"

	"cove/backend/internal/mediarouter"
)

// freeUDPPort returns a UDP port that is currently unused on all interfaces.
func freeUDPPort(t *testing.T) int {
	t.Helper()
	c, err := net.ListenUDP("udp", &net.UDPAddr{})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

// The old unencrypted router is gone: in webrtc mode nothing may listen on server.udp_port.
func TestMediaRouterStart_WebRTCModeOpensNoUDPSocket(t *testing.T) {
	port := freeUDPPort(t)
	e := newCallEnv(t, mediarouter.Config{})
	r, conn, err := mediarouter.Start("webrtc", port, mediarouter.Config{}, e.members, e.sender)
	if err != nil || r != nil || conn != nil {
		t.Fatalf("webrtc mode must not start a UDP router: r=%v conn=%v err=%v", r, conn, err)
	}
	// The port must still be bindable, proving nothing holds it.
	probe, err := net.ListenUDP("udp", &net.UDPAddr{Port: port})
	if err != nil {
		t.Fatalf("port %d should be free in webrtc mode: %v", port, err)
	}
	probe.Close()
}

func TestMediaRouterStart_RawUDPModeServesOnPort(t *testing.T) {
	port := freeUDPPort(t)
	e := newCallEnv(t, mediarouter.Config{})
	r, conn, err := mediarouter.Start("raw_udp", port, mediarouter.Config{}, e.members, e.sender)
	if err != nil || r == nil || conn == nil {
		t.Fatalf("raw_udp mode must start the router: err=%v", err)
	}
	defer r.Stop()
	defer conn.Close()
	if got := conn.LocalAddr().(*net.UDPAddr).Port; got != port {
		t.Fatalf("listening on %d, want %d", got, port)
	}

	// A legacy-format Register datagram ([0x00]+token) gets no reply: the old format is not served.
	c, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_, _ = c.Write(append([]byte{0}, []byte("legacy-session-token")...))
	_ = c.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if n, err := c.Read(make([]byte, 2048)); err == nil {
		t.Fatalf("legacy datagram got a %d-byte reply", n)
	}
}

func TestMediaRouterStart_RawUDPWithoutPortOpensNoSocket(t *testing.T) {
	e := newCallEnv(t, mediarouter.Config{})
	r, conn, err := mediarouter.Start("raw_udp", 0, mediarouter.Config{}, e.members, e.sender)
	if err != nil || conn != nil {
		t.Fatalf("port 0 must not open a socket: conn=%v err=%v", conn, err)
	}
	if r == nil {
		t.Fatal("router is still needed for call signalling bookkeeping")
	}
	r.Stop()
}
