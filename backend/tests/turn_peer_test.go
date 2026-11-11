package tests

import (
	"net"
	"testing"

	"cove/backend/internal/rtc"
)

// SR-08: the embedded TURN relay must not let a call participant aim relayed UDP at the server itself or its
// link-local neighbours (cloud metadata, loopback-only services). Public and LAN peers stay allowed: clients on a
// LAN legitimately relay to each other.
func TestSecurityReview_TURNPeerFilter(t *testing.T) {
	denied := []string{"127.0.0.1", "127.8.8.8", "::1", "0.0.0.0", "169.254.169.254", "fe80::1", "224.0.0.1", "ff02::1"}
	allowed := []string{"8.8.8.8", "203.0.113.7", "192.168.1.20", "10.1.2.3", "2001:db8::1"}
	for _, s := range denied {
		if rtc.AllowTURNPeer(net.ParseIP(s)) {
			t.Errorf("TURN peer %s must be refused", s)
		}
	}
	for _, s := range allowed {
		if !rtc.AllowTURNPeer(net.ParseIP(s)) {
			t.Errorf("TURN peer %s must be allowed", s)
		}
	}
	if rtc.AllowTURNPeer(nil) {
		t.Error("a nil peer must be refused")
	}
}
