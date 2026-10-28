package rtc

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"cove/backend/internal/logger"
	"cove/backend/internal/models"

	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/intervalpli"
	"github.com/pion/webrtc/v4"
)

// MembershipChecker verifies a user belongs to a channel before letting them
// join its call — the same gate internal/voice's UDP router uses, applied
// here to prevent the exact class of IDOR that was found and fixed there
// (joining/eavesdropping on a call for a channel you're not a member of).
type MembershipChecker interface {
	GetUserChannel(userID, channelID string) (*models.UserChannel, error)
}

// Sender delivers a signaling message to a specific user's WS connection(s).
// Implemented by *ws.Hub; kept as an interface so this package has no
// dependency on internal/ws (avoiding an import cycle, since ws depends on
// this package to dispatch "call_*" messages here).
type Sender interface {
	SendToUser(userID string, msg *models.WSMessage) bool
	BroadcastVoiceState(channelID string, activeUsers []string)
}

// Manager is the SFU's top-level entry point: one per server process,
// created in cmd/server/main.go and wired into the WS hub. It owns the
// shared webrtc.API (codecs + interceptors + ICE/port settings, expensive
// to build so it's built once and reused for every PeerConnection), the
// embedded TURN server, and the registry of active rooms.
type Manager struct {
	cfg        Config
	membership MembershipChecker
	sender     Sender
	api        *webrtc.API
	turn       *turnServer

	mu        sync.RWMutex
	rooms     map[string]*Room  // channelID -> Room
	userRooms map[string]string // userID -> channelID (a user may only be in one call at a time)

	metricsState metrics
	stopStats    chan struct{}
}

// NewManager builds the shared WebRTC API and, if configured, starts the
// embedded STUN/TURN server. Returns an error only for genuine
// misconfiguration (e.g. TURN enabled without a public IP) — callers in
// ModeRawUDP should simply not construct a Manager at all.
func NewManager(cfg Config, membership MembershipChecker, sender Sender) (*Manager, error) {
	cfg = cfg.WithDefaults()

	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("rtc: register codecs: %w", err)
	}

	// RegisterDefaultInterceptors wires up NACK generation+response (lost
	// packet retransmission), RTCP sender/receiver reports, and TWCC
	// (transport-wide congestion control feedback, which is what lets each
	// publisher's own browser encoder adapt its bitrate down on a bad
	// link — the actual adaptation happens client-side; the server's job is
	// just making sure the feedback loop is wired). Left at Pion's defaults
	// (e.g. a 1024-packet NACK retransmission buffer per sender) rather than
	// hand-tuned: those defaults are already sane for typical calls, and
	// changing buffer sizes without real traffic/loss data to justify a
	// specific number would be guessing, not tuning. See
	// TestInterceptors_NACKAndTWCCAreNegotiated for a regression test that
	// this wiring hasn't silently regressed.
	registry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, registry); err != nil {
		return nil, fmt.Errorf("rtc: register default interceptors: %w", err)
	}
	// Periodically requests a keyframe from every video publisher so
	// forwarded streams stay decodable/seekable for subscribers without us
	// having to hand-track "does anyone need a keyframe right now" — see
	// requestKeyframe() for the on-join fast path on top of this.
	pliFactory, err := intervalpli.NewReceiverInterceptor(intervalpli.GeneratorInterval(cfg.KeyframeInterval))
	if err != nil {
		return nil, fmt.Errorf("rtc: create PLI interceptor: %w", err)
	}
	registry.Add(pliFactory)

	settingEngine := webrtc.SettingEngine{}
	if err := settingEngine.SetEphemeralUDPPortRange(cfg.PortMin, cfg.PortMax); err != nil {
		return nil, fmt.Errorf("rtc: set UDP port range: %w", err)
	}
	settingEngine.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	if cfg.PublicIP != "" {
		// Tells our own ICE agent to announce PublicIP instead of (or in
		// addition to) the interface-local address it actually bound —
		// required whenever the process sits behind NAT/a container port
		// mapping/a cloud load balancer, or clients could never reach it.
		settingEngine.SetNAT1To1IPs([]string{cfg.PublicIP}, webrtc.ICECandidateTypeHost)
	}

	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithInterceptorRegistry(registry),
		webrtc.WithSettingEngine(settingEngine),
	)

	m := &Manager{
		cfg:        cfg,
		membership: membership,
		sender:     sender,
		api:        api,
		rooms:      make(map[string]*Room),
		userRooms:  make(map[string]string),
		stopStats:  make(chan struct{}),
	}
	go m.runStatsLogger(30*time.Second, m.stopStats)

	if cfg.EmbeddedTURNEnabled && cfg.PublicIP == "" {
		// TURN is meaningless without a reachable relay address — but this
		// must not be a hard failure: it's the out-of-the-box default
		// (embedded_turn_enabled defaults to true, public_ip does not
		// default to anything, since we can't safely guess it), and a
		// LAN-only/dev deployment with no NAT to traverse should still get
		// working calls via direct host candidates.
		logger.Warnf("rtc: embedded_turn_enabled is true but public_ip is not set — starting WITHOUT TURN (host/STUN candidates only). Set voice.public_ip in config.toml for NAT traversal.")
	} else if cfg.EmbeddedTURNEnabled {
		t, err := newTURNServer(cfg)
		if err != nil {
			return nil, err
		}
		m.turn = t
	}

	return m, nil
}

// Stop shuts down the embedded TURN server and every active room/call. Call
// once at server shutdown.
func (m *Manager) Stop() {
	close(m.stopStats)

	m.mu.Lock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		rooms = append(rooms, r)
	}
	m.rooms = make(map[string]*Room)
	m.userRooms = make(map[string]string)
	m.mu.Unlock()

	for _, r := range rooms {
		for _, p := range r.participantsSnapshot() {
			p.close()
		}
	}
	if m.turn != nil {
		_ = m.turn.Close()
	}
}

func (m *Manager) webrtcConfig() webrtc.Configuration {
	// Deliberately empty: the server announces its own reachable address
	// via SettingEngine's NAT1To1IPs (set once, above) rather than
	// STUN-discovering itself, and never needs to relay through its own
	// TURN server. The TURN/STUN server list sent to CLIENTS (which do need
	// it) is generated separately — see mintICEServers.
	return webrtc.Configuration{}
}

func (m *Manager) mintICEServers(userID string) []ICEServerInfo {
	if m.turn == nil {
		return []ICEServerInfo{}
	}
	username, password, err := m.turn.mintCredentials(userID)
	if err != nil {
		logger.Errorf("rtc: mint TURN credentials for %s: %v", userID, err)
		return []ICEServerInfo{}
	}
	return []ICEServerInfo{
		{URLs: []string{fmt.Sprintf("stun:%s:%d", m.cfg.PublicIP, m.cfg.TURNPort)}},
		{URLs: m.turn.urls(), Username: username, Credential: password},
	}
}

func (m *Manager) send(userID, msgType string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		logger.Errorf("rtc: marshal %s payload: %v", msgType, err)
		return
	}
	m.sender.SendToUser(userID, &models.WSMessage{Type: msgType, Payload: body})
}

func (m *Manager) sendError(userID, channelID, errMsg string) {
	m.send(userID, MsgError, ErrorPayload{ChannelID: channelID, Error: errMsg})
}

// getOrCreateRoom returns the room for channelID, creating it if this is
// the first participant to join a call there.
func (m *Manager) getOrCreateRoom(channelID string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[channelID]
	if !ok {
		r = newRoom(m, channelID)
		m.rooms[channelID] = r
	}
	return r
}

func (m *Manager) getRoom(channelID string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.rooms[channelID]
	return r, ok
}

// dropRoomIfEmpty removes a room from the registry once its last
// participant has left, so an idle call doesn't hold resources forever.
func (m *Manager) dropRoomIfEmpty(channelID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[channelID]; ok && r.size() == 0 {
		delete(m.rooms, channelID)
	}
}

// ActiveRooms returns a snapshot map of channelID -> list of active participant user IDs.
func (m *Manager) ActiveRooms() map[string][]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make(map[string][]string, len(m.rooms))
	for chID, room := range m.rooms {
		pIDs := room.participantIDs()
		if len(pIDs) > 0 {
			res[chID] = pIDs
		}
	}
	return res
}
