package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"sync"
	"time"

	"cove/udpmedia"
)

// EventMediaFrames and EventMediaKeyframe are the Wails events the web layer listens to during a UDP call.
const (
	EventMediaFrames   = "media:frames"
	EventMediaKeyframe = "media:keyframe"
)

// frameRecordHeader is src(2) kind(1) codec(1) flags(1) ts(4) len(4).
const frameRecordHeader = 13

// maxBatchBytes bounds one decoded batch coming from the webview (a few frames of at most 70 KB each).
const maxBatchBytes = 1 << 20

// PackedFrame is one frame in the batch format shared with client-web/src/rtc/media-batch.ts.
type PackedFrame struct {
	Src   uint16
	Kind  uint8
	Codec uint8
	Flags uint8
	TS    uint32
	Data  []byte
}

// PackFrames encodes frames as consecutive records. One batch crosses the Wails bridge as a single base64 string,
// which costs far less than a JSON object per frame.
func PackFrames(frames []PackedFrame) []byte {
	n := 0
	for _, f := range frames {
		n += frameRecordHeader + len(f.Data)
	}
	out := make([]byte, 0, n)
	for _, f := range frames {
		out = binary.BigEndian.AppendUint16(out, f.Src)
		out = append(out, f.Kind, f.Codec, f.Flags)
		out = binary.BigEndian.AppendUint32(out, f.TS)
		out = binary.BigEndian.AppendUint32(out, uint32(len(f.Data)))
		out = append(out, f.Data...)
	}
	return out
}

// UnpackFrames decodes PackFrames output, rejecting truncated or oversized input.
func UnpackFrames(b []byte) ([]PackedFrame, error) {
	var out []PackedFrame
	for len(b) > 0 {
		if len(b) < frameRecordHeader {
			return nil, errors.New("media batch: truncated header")
		}
		n := int(binary.BigEndian.Uint32(b[9:13]))
		if n < 0 || len(b)-frameRecordHeader < n {
			return nil, errors.New("media batch: truncated frame")
		}
		out = append(out, PackedFrame{
			Src: binary.BigEndian.Uint16(b[0:2]), Kind: b[2], Codec: b[3], Flags: b[4],
			TS: binary.BigEndian.Uint32(b[5:9]), Data: append([]byte(nil), b[frameRecordHeader:frameRecordHeader+n]...),
		})
		b = b[frameRecordHeader+n:]
	}
	return out, nil
}

// MediaBridge is the Wails-bound object the web layer uses for calls on an air-gapped server. Signalling stays in
// the web layer; this type owns the UDP session and moves encoded frames in batches.
type MediaBridge struct {
	call *MediaCall
	emit func(event string, data ...any)

	mu   sync.Mutex
	stop chan struct{}
}

// NewMediaBridge returns a bridge that publishes events through emit (runtime.EventsEmit in production).
func NewMediaBridge(emit func(event string, data ...any)) *MediaBridge {
	return &MediaBridge{call: NewMediaCall(), emit: emit}
}

// Begin returns the "media" object for call_join.
func (b *MediaBridge) Begin() (udpmedia.JoinRequest, error) { return b.call.Begin() }

// Complete finishes the handshake from the call_joined "media" object and starts delivering frames as events.
// serverAddr is "host:udp_port".
func (b *MediaBridge) Complete(serverAddr string, resp udpmedia.JoinResponse, channelID, userID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := b.call.Complete(ctx, serverAddr, resp, channelID, userID); err != nil {
		return err
	}
	b.startPumps()
	return nil
}

func (b *MediaBridge) startPumps() {
	b.mu.Lock()
	if b.stop != nil {
		close(b.stop)
	}
	stop := make(chan struct{})
	b.stop = stop
	b.mu.Unlock()
	frames, keys := b.call.Frames(), b.call.KeyframeRequests()
	go func() {
		t := time.NewTicker(10 * time.Millisecond)
		defer t.Stop()
		var pending []PackedFrame
		flush := func() {
			if len(pending) > 0 {
				b.emit(EventMediaFrames, base64.StdEncoding.EncodeToString(PackFrames(pending)))
				pending = pending[:0]
			}
		}
		for {
			select {
			case <-stop:
				return
			case f, ok := <-frames:
				if !ok {
					flush()
					return
				}
				pending = append(pending, PackedFrame{Src: f.Src, Kind: uint8(f.Kind), Codec: f.Codec, Flags: flagsOf(f.Keyframe), TS: f.TS, Data: f.Data})
			case k := <-keys:
				b.emit(EventMediaKeyframe, int(k))
			case <-t.C:
				flush()
			}
		}
	}()
}

func flagsOf(keyframe bool) uint8 {
	if keyframe {
		return udpmedia.FlagKeyframe
	}
	return 0
}

// SendFrames sends a base64 batch of frames (PackFrames layout) produced by the webview's encoders.
func (b *MediaBridge) SendFrames(batch string) error {
	raw, err := base64.StdEncoding.DecodeString(batch)
	if err != nil {
		return err
	}
	if len(raw) > maxBatchBytes {
		return errors.New("media batch too large")
	}
	frames, err := UnpackFrames(raw)
	if err != nil {
		return err
	}
	for _, f := range frames {
		if err := b.call.SendFrame(f.Kind, f.Codec, f.Flags, f.TS, f.Data); err != nil {
			return err
		}
	}
	return nil
}

// RequestKeyframe asks the publisher with media id src to refresh its kind (2 camera, 3 screen) with a keyframe.
func (b *MediaBridge) RequestKeyframe(src uint16, kind uint8) error {
	c, err := b.call.active()
	if err != nil {
		return err
	}
	return c.RequestKeyframe(src, udpmedia.Kind(kind))
}

// Close ends the session and the event pumps. Safe to call repeatedly.
func (b *MediaBridge) Close() {
	b.mu.Lock()
	if b.stop != nil {
		close(b.stop)
		b.stop = nil
	}
	b.mu.Unlock()
	b.call.Close()
}
