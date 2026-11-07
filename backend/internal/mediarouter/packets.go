package mediarouter

import (
	"net/netip"
	"sync"
	"time"

	"cove/udpmedia"
)

// cacheCapacity is how many forwarded packets per publisher are kept for NACK retransmission (docs/udp-media.md section 7).
const cacheCapacity = 512

type cacheKey struct {
	kind  udpmedia.Kind
	frame uint32
	frag  uint16
}

// packetCache is a bounded FIFO of recently forwarded MEDIA plaintexts (with src already stamped) of one publisher.
type packetCache struct {
	mu    sync.Mutex
	items map[cacheKey][]byte
	order []cacheKey
	next  int
}

func newPacketCache() *packetCache {
	return &packetCache{items: make(map[cacheKey][]byte, cacheCapacity), order: make([]cacheKey, 0, cacheCapacity)}
}

func (c *packetCache) put(k cacheKey, pt []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.items[k]; ok {
		c.items[k] = pt
		return
	}
	if len(c.order) < cacheCapacity {
		c.order = append(c.order, k)
	} else {
		delete(c.items, c.order[c.next])
		c.order[c.next] = k
		c.next = (c.next + 1) % cacheCapacity
	}
	c.items[k] = pt
}

// get returns the cached packets for one fragment, or for every cached fragment of the frame when frag is AllFragments.
// The bool is false when nothing was found.
func (c *packetCache) get(kind udpmedia.Kind, frame uint32, frag uint16) ([][]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if frag != udpmedia.AllFragments {
		pt, ok := c.items[cacheKey{kind, frame, frag}]
		if !ok {
			return nil, false
		}
		return [][]byte{pt}, true
	}
	var out [][]byte
	for i := uint16(0); i < udpmedia.MaxFragments; i++ {
		if pt, ok := c.items[cacheKey{kind, frame, i}]; ok {
			out = append(out, pt)
		}
	}
	return out, len(out) > 0
}

// handlePacket is the whole unauthenticated surface of the router. Every rejection is silent: no reply is ever sent to
// a packet that has not authenticated, so the router cannot be used for reflection or amplification.
func (r *Router) handlePacket(from netip.AddrPort, data []byte) {
	r.c.packetsIn.Add(1)
	if len(data) > udpmedia.MaxPacket {
		r.c.oversize.Add(1)
		return
	}
	if len(data) == 0 || data[0] != udpmedia.Magic {
		r.c.notCove.Add(1) // includes legacy unencrypted packets, which are intentionally no longer served
		return
	}
	h, err := udpmedia.ParseHeader(data)
	if err != nil {
		r.c.malformed.Add(1)
		return
	}
	r.mu.RLock()
	s := r.bySID[h.SessionID]
	r.mu.RUnlock()
	if s == nil {
		r.c.unknownSession.Add(1)
		return
	}
	// Traffic from a source that is not the session's learned address (including a not-yet-established session) is
	// the only kind an off-path attacker can send, so it shares a per-IP budget.
	known := s.addr.Load()
	fromKnown := known != nil && *known == from
	if !fromKnown && !r.ipAllowed(from.Addr()) {
		r.c.rate.Add(1)
		return
	}
	// Charged before decryption so a flood of forged packets cannot burn CPU beyond the session's budget.
	if !s.limiter.Allow() {
		r.c.rate.Add(1)
		return
	}
	if !fromKnown && h.Type != udpmedia.TypeHello {
		r.c.wrongAddr.Add(1)
		return
	}
	hh, pt, err := s.ring.Open(data)
	if err != nil {
		r.c.auth.Add(1)
		return
	}
	s.lastSeen.Store(time.Now().UnixNano())

	switch hh.Type {
	case udpmedia.TypeHello:
		r.onHello(s, from, pt)
	case udpmedia.TypeMedia:
		if fromKnown && s.established.Load() {
			r.onMedia(s, pt)
		}
	case udpmedia.TypeNack:
		if fromKnown && s.established.Load() {
			r.onNack(s, pt)
		}
	case udpmedia.TypeKeyframeReq:
		if fromKnown && s.established.Load() {
			r.onKeyframeReq(s, pt)
		}
	case udpmedia.TypeBye:
		if fromKnown {
			r.endSession(s, "")
		}
	default:
		r.c.malformed.Add(1)
	}
}

func (r *Router) onHello(s *session, from netip.AddrPort, pt []byte) {
	if len(pt) < udpmedia.HelloPlaintextLen || len(pt) > udpmedia.HelloPlaintextLen*4 {
		r.c.malformed.Add(1)
		return
	}
	a := from
	s.addr.Store(&a) // NAT rebind or roaming: only an authenticated HELLO can move the address
	s.established.Store(true)
	// Reply with exactly as many plaintext bytes as the request carried, so the answer is never larger than the question.
	ack := make([]byte, len(pt))
	copy(ack, pt[:8])
	r.sendTo(s, udpmedia.TypeHelloAck, ack)
}

func (r *Router) onMedia(s *session, pt []byte) {
	mh, payload, err := udpmedia.ParseMedia(pt)
	if err != nil {
		r.c.malformed.Add(1)
		return
	}
	mh.Src = s.mediaID // never trust the sender's claim
	out := udpmedia.AppendMedia(make([]byte, 0, len(pt)), mh, payload)
	s.cache.put(cacheKey{mh.Kind, mh.FrameID, mh.FragIdx}, out)
	for _, peer := range r.peers(s) {
		r.sendTo(peer, udpmedia.TypeMedia, out)
		r.c.forwarded.Add(1)
	}
}

func (r *Router) onNack(s *session, pt []byte) {
	src, kind, items, err := udpmedia.ParseNack(pt)
	if err != nil {
		r.c.malformed.Add(1)
		return
	}
	target := r.sessionByMedia(s, src)
	if target == nil || target == s {
		return
	}
	r.c.nacks.Add(1)
	missed := false
	for _, it := range items {
		pkts, ok := target.cache.get(kind, it.FrameID, it.Frag)
		if !ok {
			missed = true
			continue
		}
		for _, p := range pkts {
			if !s.resend.Allow() {
				return
			}
			r.sendTo(s, udpmedia.TypeMedia, p) // retransmit only to the requester
			r.c.resent.Add(1)
		}
	}
	if missed && kind != udpmedia.KindAudio {
		r.forwardKeyframeReq(target, s, kind)
	}
}

func (r *Router) onKeyframeReq(s *session, pt []byte) {
	src, kind, err := udpmedia.ParseKeyframeReq(pt)
	if err != nil {
		r.c.malformed.Add(1)
		return
	}
	if target := r.sessionByMedia(s, src); target != nil && target != s {
		r.forwardKeyframeReq(target, s, kind)
	}
}

// forwardKeyframeReq asks publisher to produce a keyframe of kind, at most once per 500 ms per stream.
func (r *Router) forwardKeyframeReq(publisher, requester *session, kind udpmedia.Kind) {
	now := time.Now().UnixNano()
	last := publisher.kfLast[kind].Load()
	if now-last < int64(500*time.Millisecond) || !publisher.kfLast[kind].CompareAndSwap(last, now) {
		return
	}
	r.sendTo(publisher, udpmedia.TypeKeyframeReq, udpmedia.AppendKeyframeReq(nil, requester.mediaID, kind))
}

// peers returns the other sessions of s's room that have an established UDP address.
func (r *Router) peers(s *session) []*session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rm := r.rooms[s.channelID]
	if rm == nil {
		return nil
	}
	out := make([]*session, 0, len(rm.members))
	for _, m := range rm.members {
		if m != s && m.established.Load() {
			out = append(out, m)
		}
	}
	return out
}

// sessionByMedia resolves a media id inside the requester's own room only, so a participant can never address another room.
func (r *Router) sessionByMedia(from *session, id uint16) *session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if rm := r.rooms[from.channelID]; rm != nil {
		return rm.byMedia[id]
	}
	return nil
}

// sendTo seals pt for s and writes it to s's learned UDP address.
func (r *Router) sendTo(s *session, t udpmedia.PacketType, pt []byte) {
	conn := r.conn.Load()
	addr := s.addr.Load()
	if conn == nil || addr == nil {
		return
	}
	pkt, err := s.ring.Seal(t, pt)
	if err != nil {
		return
	}
	_, _ = conn.WriteToUDPAddrPort(pkt, *addr)
}
