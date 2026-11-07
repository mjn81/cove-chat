package udpmedia

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// ReceivedFrame is a reassembled frame from another participant.
type ReceivedFrame struct {
	Src uint16 // the sender's media id from call_joined / call_participant_joined
	Frame
}

// Client is the native-client side of a UDP media session. It owns the socket, answers the handshake, sends frames,
// reassembles incoming ones and issues NACKs and keyframe requests. Create it after the WebSocket call_join /
// call_joined exchange has produced a Keyring.
type Client struct {
	conn *net.UDPConn
	ring *Keyring

	frames    chan ReceivedFrame
	keyReqs   chan Kind
	acked     chan struct{}
	ackOnce   sync.Once
	closeOnce sync.Once
	done      chan struct{}
	wg        sync.WaitGroup

	frameID [4]atomic.Uint32 // per kind, indexed by Kind

	mu         sync.Mutex
	streams    map[streamKey]*Reassembler
	lastAckAt  atomic.Int64
	sentBytes  atomic.Uint64
	dropFrames atomic.Uint64
}

type streamKey struct {
	src  uint16
	kind Kind
}

// Dial opens a UDP socket to serverAddr and starts the receive loop. Call Handshake next.
func Dial(serverAddr string, ring *Keyring) (*Client, error) {
	raddr, err := net.ResolveUDPAddr("udp", serverAddr)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return nil, err
	}
	c := &Client{
		conn:    conn,
		ring:    ring,
		frames:  make(chan ReceivedFrame, 256),
		keyReqs: make(chan Kind, 8),
		acked:   make(chan struct{}),
		done:    make(chan struct{}),
		streams: make(map[streamKey]*Reassembler),
	}
	c.wg.Add(2)
	go c.readLoop()
	go c.pollLoop()
	return c, nil
}

// Frames delivers reassembled frames from other participants. It is closed by Close. If the consumer is slower than the
// network, the oldest data is dropped rather than blocking the receive loop.
func (c *Client) Frames() <-chan ReceivedFrame { return c.frames }

// KeyframeRequests delivers the kinds the server asked this client's encoder to refresh with a keyframe.
func (c *Client) KeyframeRequests() <-chan Kind { return c.keyReqs }

// DroppedFrames counts frames discarded because the consumer of Frames was too slow.
func (c *Client) DroppedFrames() uint64 { return c.dropFrames.Load() }

// Handshake sends HELLO every 500 ms until the server's HELLO_ACK authenticates, or ctx ends. The server learns this
// client's address from the first HELLO it accepts. Afterwards the client keeps sending HELLO every 5 s as a keepalive.
func (c *Client) Handshake(ctx context.Context) error {
	if err := c.sendHello(); err != nil {
		return err
	}
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-c.acked:
			c.wg.Add(1)
			go c.keepalive()
			return nil
		case <-ctx.Done():
			return ctx.Err()
		case <-c.done:
			return net.ErrClosed
		case <-t.C:
			if err := c.sendHello(); err != nil {
				return err
			}
		}
	}
}

func (c *Client) sendHello() error {
	pt := make([]byte, HelloPlaintextLen)
	binary.BigEndian.PutUint64(pt, uint64(time.Now().UnixMilli()))
	return c.send(TypeHello, pt)
}

func (c *Client) send(t PacketType, pt []byte) error {
	pkt, err := c.ring.Seal(t, pt)
	if err != nil {
		return err
	}
	n, err := c.conn.Write(pkt)
	c.sentBytes.Add(uint64(n))
	return err
}

func (c *Client) keepalive() {
	defer c.wg.Done()
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			_ = c.sendHello()
		}
	}
}

// SendFrame fragments an encoded frame and sends it. flags may include FlagKeyframe. tsMillis is the capture time.
// The frame id is assigned here and increases by one per call per kind.
func (c *Client) SendFrame(kind Kind, codec, flags uint8, tsMillis uint32, data []byte) error {
	if !kind.Valid() {
		return ErrMalformed
	}
	id := c.frameID[kind].Add(1) - 1
	parts := Fragment(MediaHeader{Kind: kind, Codec: codec, Flags: flags, FrameID: id, TS: tsMillis}, data)
	if parts == nil {
		return ErrTooLarge
	}
	for _, p := range parts {
		if err := c.send(TypeMedia, p); err != nil {
			return err
		}
	}
	return nil
}

// RequestKeyframe asks the server to ask participant src to produce a keyframe of kind.
func (c *Client) RequestKeyframe(src uint16, kind Kind) error {
	return c.send(TypeKeyframeReq, AppendKeyframeReq(nil, src, kind))
}

// Close tells the server (BYE), stops the loops and closes the socket and the Frames channel. It is idempotent.
func (c *Client) Close() error {
	var err error
	c.closeOnce.Do(func() {
		_ = c.send(TypeBye, nil)
		close(c.done)
		err = c.conn.Close()
		c.wg.Wait()
		close(c.frames)
	})
	return err
}

func (c *Client) readLoop() {
	defer c.wg.Done()
	buf := make([]byte, MaxPacket+1)
	for {
		n, err := c.conn.Read(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			select {
			case <-c.done:
				return
			default:
				continue
			}
		}
		h, pt, err := c.ring.Open(buf[:n])
		if err != nil {
			continue // forged, replayed or stale: drop silently
		}
		switch h.Type {
		case TypeHelloAck:
			c.ackOnce.Do(func() { close(c.acked) })
			c.lastAckAt.Store(time.Now().UnixNano())
		case TypeMedia:
			mh, payload, err := ParseMedia(pt)
			if err != nil {
				continue
			}
			c.mu.Lock()
			key := streamKey{mh.Src, mh.Kind}
			r := c.streams[key]
			if r == nil {
				r = NewReassembler(mh.Kind != KindAudio)
				c.streams[key] = r
			}
			ready := r.Push(mh, payload, time.Now())
			c.mu.Unlock()
			c.deliver(mh.Src, ready)
		case TypeKeyframeReq:
			if _, kind, err := ParseKeyframeReq(pt); err == nil {
				select {
				case c.keyReqs <- kind:
				default:
				}
			}
		}
	}
}

func (c *Client) deliver(src uint16, frames []Frame) {
	for _, f := range frames {
		rf := ReceivedFrame{Src: src, Frame: f}
		select {
		case c.frames <- rf:
		default:
			select {
			case <-c.frames: // drop the oldest to keep latency low
			default:
			}
			c.dropFrames.Add(1)
			select {
			case c.frames <- rf:
			default:
			}
		}
	}
}

// pollLoop runs every reassembler's timing policy and sends NACKs and keyframe requests.
func (c *Client) pollLoop() {
	defer c.wg.Done()
	t := time.NewTicker(10 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
		}
		type pending struct {
			key   streamKey
			nacks []NackItem
			kf    bool
		}
		var work []pending
		var released []struct {
			src    uint16
			frames []Frame
		}
		c.mu.Lock()
		now := time.Now()
		for key, r := range c.streams {
			frames, nacks, needKey := r.Poll(now)
			if len(frames) > 0 {
				released = append(released, struct {
					src    uint16
					frames []Frame
				}{key.src, frames})
			}
			if len(nacks) > 0 || needKey {
				work = append(work, pending{key, nacks, needKey})
			}
		}
		c.mu.Unlock()
		for _, rel := range released {
			c.deliver(rel.src, rel.frames)
		}
		for _, w := range work {
			if len(w.nacks) > 0 {
				_ = c.send(TypeNack, AppendNack(nil, w.key.src, w.key.kind, w.nacks))
			}
			if w.kf {
				_ = c.send(TypeKeyframeReq, AppendKeyframeReq(nil, w.key.src, w.key.kind))
			}
		}
	}
}
