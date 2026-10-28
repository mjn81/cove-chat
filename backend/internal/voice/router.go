package voice

import (
	"cove/backend/internal/auth"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"errors"
	"net"
	"strings"
	"sync"
)

const (
	PacketTypeRegister = 0
	PacketTypeAudio    = 1
	PacketTypeJoin     = 2
	PacketTypeLeave    = 3
	IDLength           = 36 // Updated to 36 to support UUIDs
)

// VoiceStateNotifier is an interface for broadcasting voice session changes.
type VoiceStateNotifier interface {
	BroadcastVoiceState(channelID string, activeUsers []string)
	SendVoiceState(userID string, channelID string, activeUsers []string)
}

// MembershipChecker verifies a user belongs to a channel before letting them
// join its live voice session. Implemented by *store.Store.
type MembershipChecker interface {
	GetUserChannel(userID, channelID string) (*models.UserChannel, error)
}

// Router handles UDP voice packet routing between users within channel sessions.
type Router struct {
	sessions   *auth.SessionStore
	notifier   VoiceStateNotifier
	membership MembershipChecker
	mu         sync.RWMutex
	addrMap    map[string]*net.UDPAddr    // userID -> remoteAddr
	userMap    map[string]string          // remoteAddr.String() -> userID
	active     map[string]map[string]bool // channelID -> set of userIDs joined in voice
}

// NewRouter creates a new Voice Router. membership is used to verify a user
// is actually a member of a channel before admitting them to its voice
// session — without it, any registered user could join and eavesdrop on
// (or inject audio into) an arbitrary channel's call by guessing/observing
// its ID.
func NewRouter(sessions *auth.SessionStore, notifier VoiceStateNotifier, membership MembershipChecker) *Router {
	return &Router{
		sessions:   sessions,
		notifier:   notifier,
		membership: membership,
		addrMap:    make(map[string]*net.UDPAddr),
		userMap:    make(map[string]string),
		active:     make(map[string]map[string]bool),
	}
}

func (r *Router) notifyVoiceUpdate(channelID string, targetedUserID string) {
	if r.notifier == nil {
		return
	}
	r.mu.RLock()
	participants := r.active[channelID]
	users := make([]string, 0, len(participants))
	for u := range participants {
		users = append(users, u)
	}
	r.mu.RUnlock()

	logger.Infof("voice: BROADCASTING state for channel %s. Participants: [%s]", channelID, strings.Join(users, ", "))

	r.notifier.BroadcastVoiceState(channelID, users)
	if targetedUserID != "" {
		r.notifier.SendVoiceState(targetedUserID, channelID, users)
	}
}

// HandleConn processes incoming UDP packets from a shared connection.
func (r *Router) HandleConn(conn *net.UDPConn) {
	for {
		buf := make([]byte, 8192) // Increased buffer size
		n, addr, err := conn.ReadFromUDP(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) || strings.Contains(err.Error(), "use of closed network connection") {
				return
			}
			logger.Errorf("voice: UDP read error: %v", err)
			return
		}

		if n < 1 {
			continue
		}

		// To prevent race conditions between Register and Join packets,
		// we process control packets synchronously on the main read loop.
		// Only audio packets are fanned out to goroutines.
		packetType := buf[0]
		if packetType == PacketTypeAudio {
			go r.processPacket(conn, addr, buf[:n])
		} else {
			logger.Debugf("voice: received control packet type %d from %v (len %d)", packetType, addr, n)
			r.processPacket(conn, addr, buf[:n])
		}
	}
}

func (r *Router) processPacket(conn *net.UDPConn, addr *net.UDPAddr, data []byte) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("voice: recovered from panic while processing packet from %v: %v", addr, rec)
		}
	}()

	packetType := data[0]
	payload := data[1:]

	switch packetType {
	case PacketTypeRegister:
		logger.Infof("voice: handling Register from %v", addr)
		r.handleRegister(addr, string(payload))
	case PacketTypeJoin:
		logger.Infof("voice: handling Join from %v, payload: %s", addr, string(payload))
		r.handleJoin(addr, string(payload))
	case PacketTypeLeave:
		logger.Infof("voice: handling Leave from %v", addr)
		r.handleLeave(addr, string(payload))
	case PacketTypeAudio:
		logger.Debugf("voice: handling Audio from %v (len %d)", addr, len(data))
		r.handleAudio(conn, addr, payload)
	default:
		logger.Warnf("voice: received UNKNOWN packet type %d from %v (len %d)", packetType, addr, len(data))
	}
}

func (r *Router) handleRegister(addr *net.UDPAddr, token string) {
	token = strings.TrimRight(token, "\x00")
	session, err := r.sessions.Validate(token)
	if err != nil {
		preview := token
		if len(preview) > 10 {
			preview = preview[:10]
		}
		logger.Warnf("voice: REGISTRATION FAILED for %v: %v (token: %s...)", addr, err, preview)
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Cleanup this user's old address mapping, if any.
	if oldAddr, ok := r.addrMap[session.UserID]; ok {
		delete(r.userMap, oldAddr.String())
	}

	// The address we're about to claim may still be mapped to a *different*
	// user (e.g. that user crashed/dropped without unregistering and a NAT
	// later reassigned their public address to this one). Without clearing
	// that stale reverse mapping, handleAudio would keep resolving the old
	// user's addrMap entry to this address and misroute their audio stream
	// to whoever now holds it.
	if prevUserID, ok := r.userMap[addr.String()]; ok && prevUserID != session.UserID {
		if prevAddr, ok := r.addrMap[prevUserID]; ok && prevAddr.String() == addr.String() {
			delete(r.addrMap, prevUserID)
		}
	}

	r.addrMap[session.UserID] = addr
	r.userMap[addr.String()] = session.UserID
	logger.Infof("voice: SUCCESSFUL REGISTRATION - User: %s, Port: %s", session.UserID, addr.String())
}

// RemoveUser purges a user from all voice routing state — their registered
// address and any channel voice sessions they were part of. Call this on WS
// disconnect / session expiry: without it, a client that drops without
// sending a Leave packet (crash, network loss) stays a "ghost" participant
// in the channel's voice session forever, and their addrMap/userMap entries
// leak for the life of the process.
func (r *Router) RemoveUser(userID string) {
	r.mu.Lock()
	addr, hadAddr := r.addrMap[userID]
	if hadAddr {
		delete(r.addrMap, userID)
		delete(r.userMap, addr.String())
	}

	var affectedChannels []string
	for channelID, participants := range r.active {
		if participants[userID] {
			delete(participants, userID)
			if len(participants) == 0 {
				delete(r.active, channelID)
			}
			affectedChannels = append(affectedChannels, channelID)
		}
	}
	r.mu.Unlock()

	if hadAddr {
		logger.Infof("voice: removed user %s from voice routing (disconnected)", userID)
	}
	for _, channelID := range affectedChannels {
		r.notifyVoiceUpdate(channelID, "")
	}
}

func (r *Router) handleJoin(addr *net.UDPAddr, channelID string) {
	channelID = strings.TrimRight(channelID, "\x00")
	r.mu.RLock()
	userID, ok := r.userMap[addr.String()]
	r.mu.RUnlock()
	if !ok {
		logger.Warnf("voice: join ignored for unregistered addr %v", addr)
		return
	}

	if r.membership != nil {
		if _, err := r.membership.GetUserChannel(userID, channelID); err != nil {
			logger.Warnf("voice: join REJECTED for user %s: not a member of channel %s", userID, channelID)
			return
		}
	}

	r.mu.Lock()

	if r.active[channelID] == nil {
		r.active[channelID] = make(map[string]bool)
	}
	r.active[channelID][userID] = true
	r.mu.Unlock()
	logger.Infof("voice: user %s joined channel session %s", userID, channelID)
	r.notifyVoiceUpdate(channelID, userID)
}

func (r *Router) handleLeave(addr *net.UDPAddr, channelID string) {
	channelID = strings.TrimRight(channelID, "\x00")
	r.mu.RLock()
	userID, ok := r.userMap[addr.String()]
	r.mu.RUnlock()
	if !ok {
		return
	}

	r.mu.Lock()

	if r.active[channelID] != nil {
		delete(r.active[channelID], userID)
		if len(r.active[channelID]) == 0 {
			delete(r.active, channelID)
		}
	}
	r.mu.Unlock()
	logger.Infof("voice: user %s (addr: %s) left channel %s", userID, addr.String(), channelID)
	r.notifyVoiceUpdate(channelID, "")
}

func (r *Router) handleAudio(conn *net.UDPConn, fromAddr *net.UDPAddr, payload []byte) {
	if len(payload) < IDLength {
		logger.Warnf("voice: audio packet too short from %v: %d bytes", fromAddr, len(payload))
		return
	}

	r.mu.RLock()
	senderID, ok := r.userMap[fromAddr.String()]
	r.mu.RUnlock()

	if !ok {
		// Log sparingly for audio to avoid spam, but important for debugging initial connection
		// log.Printf("voice: audio from unknown addr %v", fromAddr)
		return
	}

	channelID := string(payload[:IDLength])
	channelID = strings.TrimRight(channelID, "\x00")
	audioData := payload[IDLength:]

	// Get all participants in this channel session
	r.mu.RLock()
	participants := r.active[channelID]
	if participants == nil {
		r.mu.RUnlock()
		return
	}

	// Prepare outgoing packet: [Type=Audio][SenderID][AudioData]
	outBuf := make([]byte, 1+IDLength+len(audioData))
	outBuf[0] = PacketTypeAudio
	copy(outBuf[1:], senderID)
	copy(outBuf[1+IDLength:], audioData)

	// Collect target addresses to avoid holding lock while writing to network
	var targets []*net.UDPAddr
	for userID := range participants {
		if userID == senderID {
			continue
		}
		if addr, ok := r.addrMap[userID]; ok {
			targets = append(targets, addr)
		}
	}
	r.mu.RUnlock()

	// Fan out packets to all participants
	for _, targetAddr := range targets {
		_, _ = conn.WriteToUDP(outBuf, targetAddr)
	}
}

// GetUserAddr returns the registered UDP address for a user.
func (r *Router) GetUserAddr(userID string) (*net.UDPAddr, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	addr, ok := r.addrMap[userID]
	if !ok {
		return nil, errors.New("user not registered")
	}
	return addr, nil
}
