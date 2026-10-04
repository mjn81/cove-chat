package rtc

import (
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

// TestInterceptors_NACKAndTWCCAreNegotiated guards the interceptor wiring
// documented in NewManager: without it, packet loss on a publisher's
// connection means a permanently glitchy stream for everyone it's forwarded
// to (no retransmission) and no congestion feedback for the browser's
// encoder to react to (it'll just keep sending at a bitrate the network
// can't sustain). Both are negotiated via SDP attributes on the offer this
// package's shared webrtc.API produces — if a future refactor drops
// RegisterDefaultInterceptors (or reorders it after codec registration in a
// way that breaks it), those attributes disappear silently; there's no
// runtime error, just quietly worse call quality under real network
// conditions. This test would catch that.
func TestInterceptors_NACKAndTWCCAreNegotiated(t *testing.T) {
	sender := newFakeSender()
	membership := &fakeMembership{allowed: map[string]bool{}}

	mgr, err := NewManager(Config{}, membership, sender)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Stop()

	pc, err := mgr.api.NewPeerConnection(mgr.webrtcConfig())
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	defer pc.Close()

	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo); err != nil {
		t.Fatalf("AddTransceiverFromKind(video): %v", err)
	}
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio); err != nil {
		t.Fatalf("AddTransceiverFromKind(audio): %v", err)
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("CreateOffer: %v", err)
	}
	sdp := offer.SDP

	// NACK generic feedback (lost-packet retransmission) must be advertised
	// for video — this is the interceptor exercised on every forwarded
	// video/screen-share track.
	if !strings.Contains(sdp, "a=rtcp-fb:") || !strings.Contains(sdp, " nack\r\n") {
		t.Error("offer SDP does not advertise NACK (a=rtcp-fb: ... nack) — retransmission is not wired")
	}

	// transport-cc (TWCC) congestion control feedback must be advertised —
	// without it, publishers' encoders get no signal to adapt bitrate.
	if !strings.Contains(sdp, "transport-cc") {
		t.Error("offer SDP does not advertise transport-cc — congestion control feedback is not wired")
	}
}
