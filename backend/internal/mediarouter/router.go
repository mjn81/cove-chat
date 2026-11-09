// Package mediarouter is the server side of Cove's encrypted UDP media path (docs/udp-media.md), used when
// voice.mode = "raw_udp". Call control (join, leave, roster, track state, keyframe requests) rides the authenticated
// WebSocket hub with the same call_* events as the WebRTC SFU, so the room and permission rules are shared; media rides
// one UDP socket where every participant has a private AES-256-GCM session with the server, which re-encrypts each
// packet for every other member of the room.
package mediarouter

import (
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"cove/backend/internal/models"
	"cove/udpmedia"

	"golang.org/x/time/rate"
)

// MembershipChecker verifies a user is an active member of a channel. Implemented by *store.Store.
type MembershipChecker interface {
	GetUserChannel(userID, channelID string) (*models.UserChannel, error)
}

// Sender delivers signalling to a user's WebSocket connections and announces who is in a call. Implemented by *ws.Hub.
type Sender interface {
	SendToUser(userID string, msg *models.WSMessage) bool
	BroadcastVoiceState(channelID string, activeUsers []string)
}

// Config tunes limits and timers. The zero value of a field selects its default.
type Config struct {
	// MaxParticipantsPerCall caps a room (voice.max_participants_per_call).
	MaxParticipantsPerCall int
	// MaxSessions caps concurrent media sessions on the server.
	MaxSessions int
	// SessionPPS and SessionBurst are the per-session packet budget, charged before decryption.
	SessionPPS   float64
	SessionBurst int
	// ResendPPS is the per-session budget for NACK retransmissions.
	ResendPPS float64
	// UnknownSourcePPS is the per-source-IP budget for packets that do not belong to a known session address.
	UnknownSourcePPS float64
	// HelloTimeout is how long a joined session may take to say HELLO; IdleTimeout how long an established one may be silent.
	HelloTimeout time.Duration
	IdleTimeout  time.Duration
	// SweepInterval is how often timeouts are checked; MembershipInterval how often membership is re-verified.
	SweepInterval      time.Duration
	MembershipInterval time.Duration
}

func (c Config) withDefaults() Config {
	def := func(v *float64, d float64) {
		if *v == 0 {
			*v = d
		}
	}
	if c.MaxParticipantsPerCall == 0 {
		c.MaxParticipantsPerCall = 50
	}
	if c.MaxSessions == 0 {
		c.MaxSessions = 2000
	}
	def(&c.SessionPPS, 3000)
	if c.SessionBurst == 0 {
		c.SessionBurst = 6000
	}
	def(&c.ResendPPS, 500)
	def(&c.UnknownSourcePPS, 100)
	if c.HelloTimeout == 0 {
		c.HelloTimeout = 30 * time.Second
	}
	if c.IdleTimeout == 0 {
		c.IdleTimeout = 20 * time.Second
	}
	if c.SweepInterval == 0 {
		c.SweepInterval = time.Second
	}
	if c.MembershipInterval == 0 {
		c.MembershipInterval = 10 * time.Second
	}
	return c
}

// Stats are monotonically increasing counters, exposed for tests and metrics. They never contain packet contents.
type Stats struct {
	PacketsIn uint64
	Forwarded uint64
	DroppedOversize,
	DroppedNotCove,
	DroppedUnknownSession,
	DroppedAuth,
	DroppedRate,
	DroppedWrongAddr,
	DroppedMalformed uint64
	NacksServed uint64
	Resent      uint64
	ReadErrors  uint64
}

type counters struct {
	packetsIn, forwarded                                     atomic.Uint64
	oversize, notCove, unknownSession, auth, rate, wrongAddr atomic.Uint64
	malformed, nacks, resent, readErrors                     atomic.Uint64
}

// session is one participant's call session.
type session struct {
	userID, username, channelID string
	mediaID                     uint16
	sid                         [udpmedia.SessionIDLen]byte
	ring                        *udpmedia.Keyring
	created                     time.Time

	addr        atomic.Pointer[netip.AddrPort]
	established atomic.Bool
	lastSeen    atomic.Int64 // unix nanos of the last authenticated packet
	limiter     *rate.Limiter
	resend      *rate.Limiter
	kfLast      [4]atomic.Int64 // unix nanos of the last keyframe request forwarded to this publisher, per kind
	cache       *packetCache

	tracks map[string]bool // guarded by Router.mu
	// stopped has bit k set once the participant announced (call_track_state, enabled=false) that stream kind k ended.
	// Uplink media of a stopped kind is dropped, so frames still in flight when a share stops cannot reach the other
	// participants after they removed the tile. Cleared when the kind is enabled again. Read on the hot path, so atomic.
	stopped atomic.Uint32
}

// room is one active call.
type room struct {
	channelID string
	members   map[string]*session // by user id
	byMedia   map[uint16]*session
	nextMedia uint16
}

// Router is the encrypted media router. Create with New, wire it to the hub (HandleSignal, RemoveUser, ActiveRooms,
// EvictMember) and run Serve on the UDP socket.
type Router struct {
	cfg    Config
	member MembershipChecker
	sender Sender

	mu     sync.RWMutex
	rooms  map[string]*room
	byUser map[string]*session
	bySID  map[[udpmedia.SessionIDLen]byte]*session

	conn atomic.Pointer[net.UDPConn]
	stop chan struct{}
	once sync.Once
	wg   sync.WaitGroup

	ipMu       sync.Mutex
	ipLimiters map[netip.Addr]*rate.Limiter

	c counters
}

// New builds a Router.
func New(cfg Config, member MembershipChecker, sender Sender) *Router {
	return &Router{
		cfg:        cfg.withDefaults(),
		member:     member,
		sender:     sender,
		rooms:      make(map[string]*room),
		byUser:     make(map[string]*session),
		bySID:      make(map[[udpmedia.SessionIDLen]byte]*session),
		stop:       make(chan struct{}),
		ipLimiters: make(map[netip.Addr]*rate.Limiter),
	}
}

// Stats returns a snapshot of the counters.
func (r *Router) Stats() Stats {
	return Stats{
		PacketsIn: r.c.packetsIn.Load(), Forwarded: r.c.forwarded.Load(),
		DroppedOversize: r.c.oversize.Load(), DroppedNotCove: r.c.notCove.Load(),
		DroppedUnknownSession: r.c.unknownSession.Load(), DroppedAuth: r.c.auth.Load(),
		DroppedRate: r.c.rate.Load(), DroppedWrongAddr: r.c.wrongAddr.Load(),
		DroppedMalformed: r.c.malformed.Load(), NacksServed: r.c.nacks.Load(), Resent: r.c.resent.Load(), ReadErrors: r.c.readErrors.Load(),
	}
}

// Serve reads packets from conn until it is closed or Stop is called. It also runs the timeout and membership sweeper.
func (r *Router) Serve(conn *net.UDPConn) {
	r.conn.Store(conn)
	// Add under the same lock Stop takes, so a Stop that races a just-starting Serve never Waits while we Add.
	r.mu.Lock()
	select {
	case <-r.stop:
		r.mu.Unlock()
		return
	default:
	}
	r.wg.Add(1)
	r.mu.Unlock()
	go r.sweepLoop()
	buf := make([]byte, udpmedia.MaxPacket+1) // +1 so oversize datagrams are detectable
	for {
		n, from, err := conn.ReadFromUDPAddrPort(buf)
		if err != nil {
			select {
			case <-r.stop:
				return
			default:
			}
			if isClosed(err) {
				return
			}
			// Not fatal: Windows reports oversize datagrams (WSAEMSGSIZE) and ICMP port-unreachable from a vanished
			// client (WSAECONNRESET) as read errors. Counting instead of logging keeps a flood from filling the log.
			r.c.readErrors.Add(1)
			continue
		}
		// Dual-stack sockets report IPv4 peers as 4-in-6; normalise so an address compares equal across reads.
		r.handlePacket(netip.AddrPortFrom(from.Addr().Unmap(), from.Port()), buf[:n])
	}
}

func isClosed(err error) bool {
	return err != nil && (errorsIs(err, net.ErrClosed))
}

// Stop ends Serve's sweeper, drops every session and refuses further joins. It does not close the socket.
func (r *Router) Stop() {
	r.once.Do(func() {
		r.mu.Lock()
		close(r.stop)
		r.rooms = make(map[string]*room)
		r.byUser = make(map[string]*session)
		r.bySID = make(map[[udpmedia.SessionIDLen]byte]*session)
		r.mu.Unlock()
	})
	r.wg.Wait()
}

// ipAllowed charges one packet against the per-source-IP budget used for traffic that is not from a session's address.
func (r *Router) ipAllowed(ip netip.Addr) bool {
	r.ipMu.Lock()
	defer r.ipMu.Unlock()
	l := r.ipLimiters[ip]
	if l == nil {
		if len(r.ipLimiters) >= 10000 {
			return false // table full: fail closed rather than grow without bound under a spoofed-source flood
		}
		l = rate.NewLimiter(rate.Limit(r.cfg.UnknownSourcePPS), int(r.cfg.UnknownSourcePPS)*2)
		r.ipLimiters[ip] = l
	}
	return l.Allow()
}

func (r *Router) sweepLoop() {
	defer r.wg.Done()
	t := time.NewTicker(r.cfg.SweepInterval)
	defer t.Stop()
	lastMembership := time.Now()
	for {
		select {
		case <-r.stop:
			return
		case <-t.C:
		}
		now := time.Now()
		checkMembers := now.Sub(lastMembership) >= r.cfg.MembershipInterval
		if checkMembers {
			lastMembership = now
			r.ipMu.Lock()
			clear(r.ipLimiters)
			r.ipMu.Unlock()
		}
		r.mu.RLock()
		all := make([]*session, 0, len(r.byUser))
		for _, s := range r.byUser {
			all = append(all, s)
		}
		r.mu.RUnlock()
		for _, s := range all {
			switch {
			case !s.established.Load() && now.Sub(s.created) > r.cfg.HelloTimeout:
				r.endSession(s, "media connection could not be established")
			case s.established.Load() && now.Sub(time.Unix(0, s.lastSeen.Load())) > r.cfg.IdleTimeout:
				r.endSession(s, "media connection lost")
			case checkMembers && !r.isActiveMember(s.userID, s.channelID):
				r.endSession(s, "removed from channel")
			}
		}
	}
}
