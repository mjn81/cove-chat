package main

import (
	"context"
	"errors"
	"sync"
	"time"

	"cove/udpmedia"
)

// MediaCall is the desktop side of one call on an air-gapped server (voice.mode = "raw_udp", docs/udp-media.md).
// It wraps the shared protocol client: the web layer does the WebSocket signalling (call_join / call_joined) and
// hands the server's response here; this type then owns the encrypted UDP session. It deliberately has no Wails or
// capture dependency, so it is unit tested without a window. Capture, encoding, decoding and rendering still have to
// be connected to SendFrame and Frames (see docs/udp-media.md section 10); until then the web client keeps its call
// buttons disabled on such servers.
type MediaCall struct {
	mu     sync.Mutex
	join   *udpmedia.ClientJoin
	client *udpmedia.Client
}

// NewMediaCall returns an idle MediaCall.
func NewMediaCall() *MediaCall { return &MediaCall{} }

// Begin generates the ephemeral key pair and returns the "media" object to put in the call_join message.
func (m *MediaCall) Begin() (udpmedia.JoinRequest, error) {
	cj, req, err := udpmedia.NewClientJoin()
	if err != nil {
		return udpmedia.JoinRequest{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.join = cj
	return req, nil
}

// Complete derives the session keys from the call_joined "media" object, opens the UDP socket to serverAddr
// ("host:udp_port", the port comes from GET /api/version) and performs the HELLO handshake.
func (m *MediaCall) Complete(ctx context.Context, serverAddr string, resp udpmedia.JoinResponse, channelID, userID string) error {
	m.mu.Lock()
	cj := m.join
	m.join = nil
	m.mu.Unlock()
	if cj == nil {
		return errors.New("media call: Begin must be called first")
	}
	ring, err := cj.Complete(resp, channelID, userID)
	if err != nil {
		return err
	}
	c, err := udpmedia.Dial(serverAddr, ring)
	if err != nil {
		return err
	}
	hctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := c.Handshake(hctx); err != nil {
		_ = c.Close()
		return err
	}
	m.mu.Lock()
	old := m.client
	m.client = c
	m.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

func (m *MediaCall) active() (*udpmedia.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil {
		return nil, errors.New("media call: not connected")
	}
	return m.client, nil
}

// SendFrame sends one encoded frame (kind 1 audio, 2 video, 3 screen; codec ids in docs/udp-media.md).
func (m *MediaCall) SendFrame(kind, codec, flags uint8, tsMillis uint32, data []byte) error {
	c, err := m.active()
	if err != nil {
		return err
	}
	return c.SendFrame(udpmedia.Kind(kind), codec, flags, tsMillis, data)
}

// Frames returns the channel of frames from other participants, or nil when not connected.
func (m *MediaCall) Frames() <-chan udpmedia.ReceivedFrame {
	c, err := m.active()
	if err != nil {
		return nil
	}
	return c.Frames()
}

// KeyframeRequests returns the channel of kinds the local encoder should refresh with a keyframe, or nil.
func (m *MediaCall) KeyframeRequests() <-chan udpmedia.Kind {
	c, err := m.active()
	if err != nil {
		return nil
	}
	return c.KeyframeRequests()
}

// Close ends the UDP session (sending BYE). It is safe to call repeatedly.
func (m *MediaCall) Close() {
	m.mu.Lock()
	c := m.client
	m.client = nil
	m.join = nil
	m.mu.Unlock()
	if c != nil {
		_ = c.Close()
	}
}
