// Package udpmedia implements Cove's encrypted UDP media protocol (docs/udp-media.md): the packet format, the
// per-session AEAD key schedule with rotation and replay protection, frame fragmentation and reassembly with NACK and
// keyframe logic, and a UDP client. It depends only on the standard library so the server, the desktop shell and
// tests can all share one implementation.
package udpmedia

import (
	"encoding/binary"
	"errors"
)

// Wire constants. See docs/udp-media.md section 4.
const (
	// Magic is the first byte of every v1 packet. Legacy (unencrypted) packets start with 0..3, so the formats never collide.
	Magic byte = 0xC1
	// HeaderLen is the length of the cleartext header, which is also the AEAD associated data.
	HeaderLen = 20
	// TagLen is the AES-GCM authentication tag length.
	TagLen = 16
	// MaxPacket is the largest datagram either side sends or accepts.
	MaxPacket = 1200
	// MaxPlaintext is the largest plaintext one packet can carry.
	MaxPlaintext = MaxPacket - HeaderLen - TagLen
	// MediaHeaderLen is the length of the header at the start of a MEDIA plaintext.
	MediaHeaderLen = 18
	// MaxFragmentPayload is the largest media payload in one packet.
	MaxFragmentPayload = 1100
	// MaxFragments is the largest number of packets one frame may be split into.
	MaxFragments = 64
	// HelloPlaintextLen is the minimum HELLO plaintext, so a HELLO_ACK of the same size is never an amplification.
	HelloPlaintextLen = 64
	// SessionIDLen is the length of the random session identifier.
	SessionIDLen = 8
	// MaxNackItems bounds one NACK packet.
	MaxNackItems = 32
	// AllFragments in a NACK item asks for every fragment of the frame.
	AllFragments uint16 = 0xFFFF
)

// PacketType is the second header byte.
type PacketType uint8

// Packet types.
const (
	TypeHello       PacketType = 1
	TypeHelloAck    PacketType = 2
	TypeMedia       PacketType = 3
	TypeNack        PacketType = 4
	TypeKeyframeReq PacketType = 5
	TypeBye         PacketType = 6
)

// Kind identifies a media stream of a participant.
type Kind uint8

// Stream kinds, matching the "audio" | "video" | "screen" track names of the WebSocket signalling.
const (
	KindAudio  Kind = 1
	KindVideo  Kind = 2
	KindScreen Kind = 3
)

// Valid reports whether k is a known stream kind.
func (k Kind) Valid() bool { return k >= KindAudio && k <= KindScreen }

// Name returns the signalling name of the kind ("audio", "video" or "screen"), or "" when invalid.
func (k Kind) Name() string {
	switch k {
	case KindAudio:
		return "audio"
	case KindVideo:
		return "video"
	case KindScreen:
		return "screen"
	}
	return ""
}

// Codec identifiers. They are opaque to the server.
const (
	CodecOpus uint8 = 1
	CodecVP8  uint8 = 2
	CodecH264 uint8 = 3
	CodecVP9  uint8 = 4
)

// Media flag bits.
const (
	FlagKeyframe    uint8 = 1 << 0
	FlagDiscardable uint8 = 1 << 1
)

// Errors returned by the packet layer. They never carry packet contents.
var (
	ErrShortPacket  = errors.New("udpmedia: packet too short")
	ErrBadMagic     = errors.New("udpmedia: bad magic")
	ErrTooLarge     = errors.New("udpmedia: packet too large")
	ErrWrongSession = errors.New("udpmedia: wrong session")
	ErrAuth         = errors.New("udpmedia: authentication failed")
	ErrReplay       = errors.New("udpmedia: replayed or too-old packet")
	ErrBadEpoch     = errors.New("udpmedia: unknown key epoch")
	ErrMalformed    = errors.New("udpmedia: malformed payload")
)

// Header is the cleartext, authenticated packet header.
type Header struct {
	Type      PacketType
	Epoch     uint8
	SessionID [SessionIDLen]byte
	Seq       uint64
}

// ParseHeader reads the header of a packet without authenticating it.
func ParseHeader(pkt []byte) (Header, error) {
	var h Header
	if len(pkt) > MaxPacket {
		return h, ErrTooLarge
	}
	if len(pkt) < HeaderLen+TagLen {
		return h, ErrShortPacket
	}
	if pkt[0] != Magic {
		return h, ErrBadMagic
	}
	h.Type = PacketType(pkt[1])
	h.Epoch = pkt[2]
	copy(h.SessionID[:], pkt[4:12])
	h.Seq = binary.BigEndian.Uint64(pkt[12:20])
	return h, nil
}

// appendTo writes the 20-byte header onto dst.
func (h Header) appendTo(dst []byte) []byte {
	dst = append(dst, Magic, byte(h.Type), h.Epoch, 0)
	dst = append(dst, h.SessionID[:]...)
	return binary.BigEndian.AppendUint64(dst, h.Seq)
}

// MediaHeader precedes the payload of a MEDIA packet.
type MediaHeader struct {
	Src     uint16 // participant media id; set by the server on forwarded packets
	Kind    Kind
	Codec   uint8
	Flags   uint8
	FrameID uint32
	FragIdx uint16
	FragCnt uint16
	TS      uint32
}

// Keyframe reports whether the keyframe flag is set.
func (m MediaHeader) Keyframe() bool { return m.Flags&FlagKeyframe != 0 }

// AppendMedia appends the header followed by payload to dst.
func AppendMedia(dst []byte, m MediaHeader, payload []byte) []byte {
	dst = binary.BigEndian.AppendUint16(dst, m.Src)
	dst = append(dst, byte(m.Kind), m.Codec, m.Flags, 0)
	dst = binary.BigEndian.AppendUint32(dst, m.FrameID)
	dst = binary.BigEndian.AppendUint16(dst, m.FragIdx)
	dst = binary.BigEndian.AppendUint16(dst, m.FragCnt)
	dst = binary.BigEndian.AppendUint32(dst, m.TS)
	return append(dst, payload...)
}

// ParseMedia splits a MEDIA plaintext into its header and payload (aliasing b) and validates the fields a router relies on.
func ParseMedia(b []byte) (MediaHeader, []byte, error) {
	var m MediaHeader
	if len(b) < MediaHeaderLen {
		return m, nil, ErrMalformed
	}
	m.Src = binary.BigEndian.Uint16(b[0:2])
	m.Kind = Kind(b[2])
	m.Codec = b[3]
	m.Flags = b[4]
	m.FrameID = binary.BigEndian.Uint32(b[6:10])
	m.FragIdx = binary.BigEndian.Uint16(b[10:12])
	m.FragCnt = binary.BigEndian.Uint16(b[12:14])
	m.TS = binary.BigEndian.Uint32(b[14:18])
	payload := b[MediaHeaderLen:]
	if !m.Kind.Valid() || m.FragCnt == 0 || m.FragCnt > MaxFragments || m.FragIdx >= m.FragCnt || len(payload) > MaxFragmentPayload {
		return m, nil, ErrMalformed
	}
	return m, payload, nil
}

// NackItem names one missing fragment (or, with AllFragments, a whole frame).
type NackItem struct {
	FrameID uint32
	Frag    uint16
}

// AppendNack encodes a NACK plaintext for the stream (src, kind). At most MaxNackItems items are written.
func AppendNack(dst []byte, src uint16, kind Kind, items []NackItem) []byte {
	if len(items) > MaxNackItems {
		items = items[:MaxNackItems]
	}
	dst = binary.BigEndian.AppendUint16(dst, src)
	dst = append(dst, byte(kind), byte(len(items)))
	for _, it := range items {
		dst = binary.BigEndian.AppendUint32(dst, it.FrameID)
		dst = binary.BigEndian.AppendUint16(dst, it.Frag)
	}
	return dst
}

// ParseNack decodes a NACK plaintext.
func ParseNack(b []byte) (src uint16, kind Kind, items []NackItem, err error) {
	if len(b) < 4 {
		return 0, 0, nil, ErrMalformed
	}
	src = binary.BigEndian.Uint16(b[0:2])
	kind = Kind(b[2])
	n := int(b[3])
	if !kind.Valid() || n > MaxNackItems || len(b) < 4+6*n {
		return 0, 0, nil, ErrMalformed
	}
	items = make([]NackItem, n)
	for i := range items {
		off := 4 + 6*i
		items[i] = NackItem{FrameID: binary.BigEndian.Uint32(b[off:]), Frag: binary.BigEndian.Uint16(b[off+4:])}
	}
	return src, kind, items, nil
}

// AppendKeyframeReq encodes a KEYFRAME_REQ plaintext.
func AppendKeyframeReq(dst []byte, src uint16, kind Kind) []byte {
	dst = binary.BigEndian.AppendUint16(dst, src)
	return append(dst, byte(kind))
}

// ParseKeyframeReq decodes a KEYFRAME_REQ plaintext.
func ParseKeyframeReq(b []byte) (src uint16, kind Kind, err error) {
	if len(b) < 3 || !Kind(b[2]).Valid() {
		return 0, 0, ErrMalformed
	}
	return binary.BigEndian.Uint16(b[0:2]), Kind(b[2]), nil
}

// replayWindow is a 1024-packet sliding window (as in IPsec ESP). It must only be advanced after a packet authenticates.
type replayWindow struct {
	init bool
	max  uint64
	bits [16]uint64
}

const replayWindowSize = 1024

// ok reports whether seq is unseen and inside (or ahead of) the window.
func (w *replayWindow) ok(seq uint64) bool {
	if !w.init || seq > w.max {
		return true
	}
	if w.max-seq >= replayWindowSize {
		return false
	}
	return w.bits[(seq%replayWindowSize)/64]&(1<<(seq%64)) == 0
}

// mark records seq as seen, sliding the window forward when seq is the newest.
func (w *replayWindow) mark(seq uint64) {
	if !w.init {
		w.init = true
		w.max = seq
		w.bits[(seq%replayWindowSize)/64] |= 1 << (seq % 64)
		return
	}
	if seq > w.max {
		gap := seq - w.max
		if gap >= replayWindowSize {
			w.bits = [16]uint64{}
		} else {
			for s := w.max + 1; s <= seq; s++ {
				w.bits[(s%replayWindowSize)/64] &^= 1 << (s % 64)
			}
		}
		w.max = seq
	}
	w.bits[(seq%replayWindowSize)/64] |= 1 << (seq % 64)
}
