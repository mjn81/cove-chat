package rtc

import (
	"fmt"
	"net"

	"nodetalk/backend/internal/logger"

	pionturn "github.com/pion/turn/v3"
)

// turnServer wraps an embedded STUN+TURN relay (github.com/pion/turn). TURN
// is a superset of STUN — the same listeners answer plain STUN binding
// requests (for clients that only need their reflexive address) and TURN
// allocate/relay requests (for clients behind symmetric NATs/firewalls that
// need a relay). Running it in-process means NAT traversal works without
// any external STUN/TURN provider.
//
// Both a UDP and a TCP listener are started on the same port: some
// corporate/hotel firewalls block outbound UDP entirely (common enough that
// browsers themselves fall back to TURN-over-TCP), so relying on UDP-only
// TURN would leave those networks unable to connect at all despite having a
// working TURN relay available.
type turnServer struct {
	srv         *pionturn.Server
	udpConn     net.PacketConn
	tcpListener net.Listener // nil if the TCP listener failed to bind (non-fatal, see newTURNServer)
	cfg         Config
}

// newTURNServer starts the embedded relay. publicIP is required: clients
// need a reachable address for the relay allocation, so without it (e.g.
// running behind NAT with no PublicIP configured) TURN is not usable and
// callers should leave EmbeddedTURNEnabled off and rely on STUN-only /
// direct host candidates instead.
func newTURNServer(cfg Config) (*turnServer, error) {
	if cfg.TURNSharedSecret == "" {
		return nil, fmt.Errorf("rtc: embedded TURN enabled but no shared secret configured")
	}
	relayIP := net.ParseIP(cfg.PublicIP)
	if relayIP == nil {
		return nil, fmt.Errorf("rtc: embedded TURN requires a valid public_ip, got %q", cfg.PublicIP)
	}

	udpConn, err := net.ListenPacket("udp4", fmt.Sprintf("0.0.0.0:%d", cfg.TURNPort))
	if err != nil {
		return nil, fmt.Errorf("rtc: TURN UDP listener on :%d failed: %w", cfg.TURNPort, err)
	}

	authHandler := pionturn.LongTermTURNRESTAuthHandler(cfg.TURNSharedSecret, nil)
	serverConfig := pionturn.ServerConfig{
		Realm:       cfg.TURNRealm,
		AuthHandler: authHandler,
		PacketConnConfigs: []pionturn.PacketConnConfig{
			{
				PacketConn: udpConn,
				RelayAddressGenerator: &pionturn.RelayAddressGeneratorStatic{
					RelayAddress: relayIP,
					Address:      "0.0.0.0",
				},
			},
		},
	}

	// TCP fallback is best-effort: if the port is already taken on TCP (or
	// any other bind failure) we still have a fully working UDP-only TURN
	// server, so this must not fail the whole thing — just log and move on
	// without the fallback.
	var tcpListener net.Listener
	if l, tcpErr := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", cfg.TURNPort)); tcpErr != nil {
		logger.Warnf("rtc: TURN TCP fallback listener on :%d failed (continuing UDP-only): %v", cfg.TURNPort, tcpErr)
	} else {
		tcpListener = l
		serverConfig.ListenerConfigs = []pionturn.ListenerConfig{
			{
				Listener: tcpListener,
				RelayAddressGenerator: &pionturn.RelayAddressGeneratorStatic{
					RelayAddress: relayIP,
					Address:      "0.0.0.0",
				},
			},
		}
	}

	srv, err := pionturn.NewServer(serverConfig)
	if err != nil {
		_ = udpConn.Close()
		if tcpListener != nil {
			_ = tcpListener.Close()
		}
		return nil, fmt.Errorf("rtc: TURN server init failed: %w", err)
	}

	if tcpListener != nil {
		logger.Infof("rtc: embedded STUN/TURN listening on :%d (UDP+TCP, relay ip %s)", cfg.TURNPort, cfg.PublicIP)
	} else {
		logger.Infof("rtc: embedded STUN/TURN listening on :%d (UDP only, relay ip %s)", cfg.TURNPort, cfg.PublicIP)
	}
	return &turnServer{srv: srv, udpConn: udpConn, tcpListener: tcpListener, cfg: cfg}, nil
}

func (t *turnServer) Close() error {
	if t == nil || t.srv == nil {
		return nil
	}
	return t.srv.Close()
}

// mintCredentials generates a short-lived (TURNCredentialTTL) username/
// password pair scoped to userID, per the TURN REST API convention used by
// LongTermTURNRESTAuthHandler above. Called at call_join time — never a
// static credential baked into the client.
func (t *turnServer) mintCredentials(userID string) (username, password string, err error) {
	return pionturn.GenerateLongTermTURNRESTCredentials(t.cfg.TURNSharedSecret, userID, t.cfg.TURNCredentialTTL)
}

// urls returns the TURN URLs clients should try, in preference order: UDP
// first (lower overhead), then TCP as a fallback for networks that block
// outbound UDP entirely — omitted if the TCP listener failed to start.
func (t *turnServer) urls() []string {
	urls := []string{fmt.Sprintf("turn:%s:%d?transport=udp", t.cfg.PublicIP, t.cfg.TURNPort)}
	if t.tcpListener != nil {
		urls = append(urls, fmt.Sprintf("turn:%s:%d?transport=tcp", t.cfg.PublicIP, t.cfg.TURNPort))
	}
	return urls
}
