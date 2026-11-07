package tests

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/apistd"
	"cove/backend/internal/auth"
	"cove/backend/internal/mediarouter"
	"cove/backend/internal/ws"
)

// The media router must be usable as the hub's call engine.
var _ ws.RTCSignalHandler = (*mediarouter.Router)(nil)

func TestCapabilitiesForMode(t *testing.T) {
	raw := apistd.CapabilitiesForMode("raw_udp")
	for _, want := range []string{apistd.CapInviteMessages, apistd.CapWhisper, apistd.CapRawUDPVoice, apistd.CapRawUDPMedia} {
		if !slices.Contains(raw, want) {
			t.Errorf("raw_udp capabilities %v miss %q", raw, want)
		}
	}
	if slices.Contains(raw, apistd.CapWebRTCSFU) {
		t.Errorf("raw_udp must not advertise the SFU: %v", raw)
	}
	web := apistd.CapabilitiesForMode("webrtc")
	if !slices.Contains(web, apistd.CapWebRTCSFU) || slices.Contains(web, apistd.CapRawUDPMedia) || slices.Contains(web, apistd.CapRawUDPVoice) {
		t.Errorf("webrtc capabilities wrong: %v", web)
	}
	if apistd.CapRawUDPMedia != "raw_udp_media" {
		t.Error("capability name is part of the wire contract")
	}
}

func TestVersionAdvertisesRawUDPMedia(t *testing.T) {
	for mode, want := range map[string]bool{"raw_udp": true, "webrtc": false} {
		srv := testServerWith(t, func(h *api.Handler) { h.VoiceMode = mode; h.UDPPort = 9090 })
		resp := getWith(t, srv, "/api/version", "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status %d", resp.StatusCode)
		}
		var body struct {
			Capabilities []string `json:"capabilities"`
			UDPPort      int      `json:"udp_port"`
		}
		decodeJSON(t, resp, &body)
		if got := slices.Contains(body.Capabilities, "raw_udp_media"); got != want {
			t.Errorf("mode %s: raw_udp_media advertised = %v, want %v (%v)", mode, got, want, body.Capabilities)
		}
		if body.UDPPort != 9090 {
			t.Errorf("legacy udp_port field changed: %d", body.UDPPort)
		}
		srv.Close()
	}
}

// TestHubKickEndsMediaSession proves the kick path is connected: the hub's BroadcastMemberLeft (called by the kick and
// leave handlers) ends the member's UDP media session when the router is the hub's call engine.
func TestHubKickEndsMediaSession(t *testing.T) {
	ss := testServerWithStore(t)
	hub := ws.NewHub(ss.store, auth.NewSessionStore(time.Hour), make([]byte, 32), true, "")
	t.Cleanup(hub.Close)

	e := newCallEnv(t, mediarouter.Config{})
	hub.SetRTCManager(e.router)
	e.addMember("owner", "room")
	e.addMember("victim", "room")
	e.joinSignal("owner", "room")
	e.joinSignal("victim", "room")

	hub.BroadcastMemberLeft("room", "victim")

	got := e.router.ActiveRooms()["room"]
	if len(got) != 1 || got[0] != "owner" {
		t.Fatalf("after kick the call has members %v, want only the owner", got)
	}
	if _, ok := e.sender.take("victim", mediarouter.MsgEnded, time.Second); !ok {
		t.Fatal("kicked member not told")
	}
}
