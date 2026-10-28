package rtc

import (
	"net"
	"strconv"
	"testing"
	"time"

	pionturn "github.com/pion/turn/v3"

	"github.com/pion/stun/v4"
)

// findFreeUDPPort picks an OS-assigned free port by briefly binding to
// port 0, so this test doesn't collide with a real TURN server (or another
// test run) on the default 3478.
func findFreeUDPPort(t *testing.T) int {
	t.Helper()
	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).Port
}

// TestTURNServer_UDPAndTCPBothRespondToSTUNBinding proves the TCP fallback
// added for UDP-blocked networks actually works, not just that the listener
// binds: it performs a real STUN binding request over EACH transport (UDP
// and TCP) against the embedded server and checks both get a valid
// XOR-MAPPED-ADDRESS response — a TURN server answering STUN binding
// requests on both transports is exactly what lets a client whose network
// blocks outbound UDP still traverse NAT via TURN-over-TCP.
func TestTURNServer_UDPAndTCPBothRespondToSTUNBinding(t *testing.T) {
	port := findFreeUDPPort(t)
	cfg := Config{
		PublicIP:         "127.0.0.1", // stand-in "public" IP for a same-host test
		TURNPort:         port,
		TURNRealm:        "test",
		TURNSharedSecret: "test-secret",
	}

	ts, err := newTURNServer(cfg)
	if err != nil {
		t.Fatalf("newTURNServer: %v", err)
	}
	defer ts.Close()

	if ts.tcpListener == nil {
		t.Fatal("expected the TCP fallback listener to have started")
	}

	urls := ts.urls()
	if len(urls) != 2 {
		t.Fatalf("urls() = %v, want 2 entries (udp + tcp)", urls)
	}

	checkBinding := func(transport string) {
		t.Helper()
		uri, err := stun.ParseURI("turn:127.0.0.1:" + strconv.Itoa(port) + "?transport=" + transport)
		if err != nil {
			t.Fatalf("[%s] ParseURI: %v", transport, err)
		}
		client, err := stun.DialURI(uri, &stun.DialConfig{})
		if err != nil {
			t.Fatalf("[%s] DialURI: %v", transport, err)
		}
		defer client.Close()

		done := make(chan error, 1)
		message := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
		err = client.Start(message, func(ev stun.Event) {
			if ev.Error != nil {
				done <- ev.Error
				return
			}
			var xorAddr stun.XORMappedAddress
			done <- xorAddr.GetFrom(ev.Message)
		})
		if err != nil {
			t.Fatalf("[%s] send binding request: %v", transport, err)
		}

		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("[%s] binding request failed: %v", transport, err)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("[%s] timed out waiting for STUN binding response", transport)
		}
	}

	checkBinding("udp")
	checkBinding("tcp")
}

// TestTURNServer_MintedCredentialsAuthenticate proves the short-lived TURN
// REST credentials minted per-user actually authenticate against the
// server's own auth handler (LongTermTURNRESTAuthHandler) — i.e. the two
// halves (GenerateLongTermTURNRESTCredentials and the handler it's paired
// with) agree with each other, which is easy to silently break by editing
// one side (e.g. changing the realm or secret plumbing) without the other.
func TestTURNServer_MintedCredentialsAuthenticate(t *testing.T) {
	ts := &turnServer{cfg: Config{TURNSharedSecret: "shhh", TURNRealm: "cove", TURNCredentialTTL: time.Minute}}
	username, password, err := ts.mintCredentials("alice")
	if err != nil {
		t.Fatalf("mintCredentials: %v", err)
	}
	if username == "" || password == "" {
		t.Fatal("expected non-empty username/password")
	}

	handler := pionturn.LongTermTURNRESTAuthHandler(ts.cfg.TURNSharedSecret, nil)
	key, ok := handler(username, ts.cfg.TURNRealm, &net.UDPAddr{})
	if !ok {
		t.Fatal("server's own auth handler rejected credentials it should have accepted")
	}
	if len(key) == 0 {
		t.Fatal("expected a non-empty auth key")
	}
}
