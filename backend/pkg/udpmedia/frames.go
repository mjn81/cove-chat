package udpmedia

import (
	"sort"
	"time"
)

// Frame is one reassembled encoded audio, video or screen frame.
type Frame struct {
	ID       uint32
	Kind     Kind
	Codec    uint8
	Keyframe bool
	TS       uint32
	Data     []byte
}

// Fragment splits an encoded frame into MEDIA plaintexts (media header + payload), each at most MediaHeaderLen +
// MaxFragmentPayload bytes. hdr supplies Kind, Codec, Flags, FrameID and TS; fragment fields are filled in. It returns
// nil when the frame needs more than MaxFragments packets.
func Fragment(hdr MediaHeader, frame []byte) [][]byte {
	cnt := (len(frame) + MaxFragmentPayload - 1) / MaxFragmentPayload
	if cnt == 0 {
		cnt = 1
	}
	if cnt > MaxFragments {
		return nil
	}
	out := make([][]byte, 0, cnt)
	for i := 0; i < cnt; i++ {
		lo := i * MaxFragmentPayload
		hi := min(lo+MaxFragmentPayload, len(frame))
		h := hdr
		h.FragIdx = uint16(i)
		h.FragCnt = uint16(cnt)
		out = append(out, AppendMedia(make([]byte, 0, MediaHeaderLen+hi-lo), h, frame[lo:hi]))
	}
	return out
}

// Reassembler turns the MEDIA packets of one stream (one sender and kind) back into frames, in frame-id order,
// tolerating loss, duplication and reordering. Poll drives retransmission requests and the give-up policy. It is not
// safe for concurrent use.
type Reassembler struct {
	// RequireKeyframe is true for video and screen: after a skipped frame, frames are dropped until a keyframe arrives.
	RequireKeyframe bool
	// MaxLatency is how long an incomplete frame is waited for before it is skipped.
	MaxLatency time.Duration
	// NackInterval limits how often the same gap is re-requested; NackAfter delays the first request so plain reordering
	// does not trigger retransmissions.
	NackInterval time.Duration
	NackAfter    time.Duration

	started     bool
	waitKey     bool
	next        uint32
	pending     map[uint32]*partial
	newerSeenAt time.Time // when a frame newer than `next` first arrived while `next` was missing entirely
	lastKeyReq  time.Time
	lastNack    map[nackKey]time.Time
}

type nackKey struct {
	frame uint32
	frag  uint16
}

type partial struct {
	hdr   MediaHeader
	frags [][]byte
	got   int
	first time.Time
}

const maxPendingFrames = 128

// NewReassembler returns a Reassembler with LAN-oriented defaults (300 ms latency budget, NACK after 20 ms, every 40 ms).
func NewReassembler(requireKeyframe bool) *Reassembler {
	return &Reassembler{
		RequireKeyframe: requireKeyframe,
		MaxLatency:      300 * time.Millisecond,
		NackInterval:    40 * time.Millisecond,
		NackAfter:       20 * time.Millisecond,
		pending:         make(map[uint32]*partial),
		lastNack:        make(map[nackKey]time.Time),
		waitKey:         requireKeyframe,
	}
}

// before reports whether a precedes b in wrapping frame-id order.
func before(a, b uint32) bool { return int32(a-b) < 0 }

// Push adds one packet and returns any frames that became deliverable, in order. Malformed or stale packets are ignored.
func (r *Reassembler) Push(h MediaHeader, payload []byte, now time.Time) []Frame {
	if h.FragCnt == 0 || h.FragIdx >= h.FragCnt || h.FragCnt > MaxFragments {
		return nil
	}
	if !r.started {
		r.started = true
		r.next = h.FrameID
	}
	if before(h.FrameID, r.next) {
		return nil // late or duplicate of something already delivered or skipped
	}
	if h.FrameID-r.next > maxPendingFrames {
		// The sender is far ahead (long outage): resynchronise on this frame instead of buffering unboundedly.
		r.resync(h.FrameID)
	}
	p := r.pending[h.FrameID]
	if p == nil {
		p = &partial{hdr: h, frags: make([][]byte, h.FragCnt), first: now}
		r.pending[h.FrameID] = p
	}
	if int(h.FragCnt) != len(p.frags) || p.frags[h.FragIdx] != nil {
		return nil
	}
	p.frags[h.FragIdx] = append([]byte(nil), payload...)
	p.got++
	if h.Keyframe() {
		p.hdr.Flags |= FlagKeyframe
	}
	out := r.drain()
	// Start the clock on a wholly missing head-of-line frame when the first newer packet arrives, not at the next Poll.
	if len(r.pending) > 0 && r.pending[r.next] == nil && r.newerSeenAt.IsZero() {
		r.newerSeenAt = now
	}
	return out
}

func (r *Reassembler) resync(id uint32) {
	r.next = id
	clear(r.pending)
	clear(r.lastNack)
	r.newerSeenAt = time.Time{}
	if r.RequireKeyframe {
		r.waitKey = true
	}
}

// drain delivers consecutive complete frames starting at r.next.
func (r *Reassembler) drain() []Frame {
	var out []Frame
	for {
		p := r.pending[r.next]
		if p == nil || p.got != len(p.frags) {
			return out
		}
		delete(r.pending, r.next)
		id := r.next
		r.next++
		r.newerSeenAt = time.Time{}
		if r.waitKey && !p.hdr.Keyframe() {
			continue // cannot decode without the reference frame
		}
		if p.hdr.Keyframe() {
			r.waitKey = false
		}
		var n int
		for _, f := range p.frags {
			n += len(f)
		}
		data := make([]byte, 0, n)
		for _, f := range p.frags {
			data = append(data, f...)
		}
		out = append(out, Frame{ID: id, Kind: p.hdr.Kind, Codec: p.hdr.Codec, Keyframe: p.hdr.Keyframe(), TS: p.hdr.TS, Data: data})
	}
}

// Poll applies the timing policy. It returns frames released by skipping hopeless gaps, NACK items for fragments worth
// re-requesting, and whether the caller should send a keyframe request now (rate limited to one per 500 ms).
func (r *Reassembler) Poll(now time.Time) (frames []Frame, nacks []NackItem, needKeyframe bool) {
	if !r.started {
		return nil, nil, false
	}
	// Note when the head of line is wholly missing but something newer exists.
	if len(r.pending) > 0 && r.pending[r.next] == nil && r.newerSeenAt.IsZero() {
		r.newerSeenAt = now
	}
	skipped := false
	for len(r.pending) > 0 {
		head := r.pending[r.next]
		var waited time.Duration
		switch {
		case head != nil:
			waited = now.Sub(head.first)
		case !r.newerSeenAt.IsZero():
			waited = now.Sub(r.newerSeenAt)
		}
		if waited < r.MaxLatency {
			break
		}
		delete(r.pending, r.next)
		r.next++
		r.newerSeenAt = time.Time{}
		skipped = true
		if r.RequireKeyframe {
			r.waitKey = true
		}
		frames = append(frames, r.drain()...)
		if r.pending[r.next] == nil && len(r.pending) > 0 {
			r.newerSeenAt = now
		}
	}
	if skipped && !r.RequireKeyframe {
		skipped = false // audio is concealed, not resynchronised
	}
	nacks = r.collectNacks(now)
	if (skipped || (r.waitKey && r.RequireKeyframe && len(r.pending) > 0)) && now.Sub(r.lastKeyReq) >= 500*time.Millisecond {
		r.lastKeyReq = now
		needKeyframe = true
	}
	return frames, nacks, needKeyframe
}

func (r *Reassembler) collectNacks(now time.Time) []NackItem {
	var out []NackItem
	add := func(it NackItem) {
		k := nackKey{it.FrameID, it.Frag}
		if t, ok := r.lastNack[k]; ok && now.Sub(t) < r.NackInterval {
			return
		}
		r.lastNack[k] = now
		out = append(out, it)
	}
	if len(r.pending) > 0 && r.pending[r.next] == nil && !r.newerSeenAt.IsZero() && now.Sub(r.newerSeenAt) >= r.NackAfter {
		add(NackItem{FrameID: r.next, Frag: AllFragments})
	}
	ids := make([]uint32, 0, len(r.pending))
	for id := range r.pending {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return before(ids[i], ids[j]) })
	for _, id := range ids {
		p := r.pending[id]
		if p.got == len(p.frags) || now.Sub(p.first) < r.NackAfter {
			continue
		}
		for i, f := range p.frags {
			if f == nil {
				add(NackItem{FrameID: id, Frag: uint16(i)})
			}
		}
	}
	if len(out) > MaxNackItems {
		out = out[:MaxNackItems]
	}
	// Forget bookkeeping for frames already delivered or skipped.
	for k := range r.lastNack {
		if before(k.frame, r.next) {
			delete(r.lastNack, k)
		}
	}
	return out
}

// PendingFrames returns how many frames are currently buffered incomplete or out of order.
func (r *Reassembler) PendingFrames() int { return len(r.pending) }
