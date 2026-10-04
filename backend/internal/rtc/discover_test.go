package rtc

import (
	"net"
	"testing"
	"time"
)

// TestDiscoverPublicIP_AllServersUnreachable is fully deterministic and
// network-independent: 192.0.2.0/24 is reserved by RFC 5737 specifically
// for documentation/testing and is guaranteed non-routable, so this proves
// the bounded-timeout failure path (every server fails/times out ->
// DiscoverPublicIP returns an error rather than hanging or panicking)
// without depending on any real network access.
func TestDiscoverPublicIP_AllServersUnreachable(t *testing.T) {
	start := time.Now()
	ip, err := DiscoverPublicIP([]string{"stun:192.0.2.1:9"}, 500*time.Millisecond)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatalf("expected an error for an unreachable STUN server, got ip=%q", ip)
	}
	if ip != "" {
		t.Fatalf("expected empty IP on failure, got %q", ip)
	}
	// Must respect the timeout rather than hanging on the library's own
	// (potentially much longer) internal retransmission schedule.
	if elapsed > 3*time.Second {
		t.Fatalf("DiscoverPublicIP took %v, expected it to bail out near the 500ms timeout", elapsed)
	}
}

// TestDiscoverPublicIP_InvalidURI guards against a malformed configured
// STUN server crashing discovery instead of just failing that one entry.
func TestDiscoverPublicIP_InvalidURI(t *testing.T) {
	_, err := DiscoverPublicIP([]string{"not-a-stun-uri"}, 500*time.Millisecond)
	if err == nil {
		t.Fatal("expected an error for a malformed STUN URI")
	}
}

// TestDiscoverPublicIP_LiveSTUNServer is a best-effort live-network check:
// it exercises the real default STUN servers and confirms a plausible
// public IP comes back. Skipped (not failed) if there's no outbound network
// access in this environment, since that's an environment property, not a
// regression in the code being tested.
func TestDiscoverPublicIP_LiveSTUNServer(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in -short mode")
	}

	ip, err := DiscoverPublicIP(nil, 5*time.Second)
	if err != nil {
		t.Skipf("no outbound network access to a public STUN server in this environment: %v", err)
	}

	parsed := net.ParseIP(ip)
	if parsed == nil {
		t.Fatalf("DiscoverPublicIP returned an unparseable IP: %q", ip)
	}
	if parsed.IsPrivate() || parsed.IsLoopback() || parsed.IsUnspecified() {
		t.Fatalf("DiscoverPublicIP returned a non-public address: %q (STUN should reflect the address as seen from outside any NAT)", ip)
	}
}
