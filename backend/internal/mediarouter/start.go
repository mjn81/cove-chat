package mediarouter

import (
	"fmt"
	"net"

	"cove/backend/internal/logger"
)

// ModeRawUDP is the voice.mode value that selects this router; every other mode opens no UDP socket here.
const ModeRawUDP = "raw_udp"

// Start builds the router and opens its UDP socket on port when mode is "raw_udp". In any other mode (the default
// "webrtc" SFU) it returns nil, nil, nil and nothing listens on server.udp_port. With port 0 the router is still
// returned, without a socket, so call signalling stays consistent while media is unavailable. The caller owns the
// returned router (Stop) and connection (Close).
func Start(mode string, port int, cfg Config, member MembershipChecker, sender Sender) (*Router, *net.UDPConn, error) {
	if mode != ModeRawUDP {
		return nil, nil, nil
	}
	r := New(cfg, member, sender)
	if port <= 0 {
		logger.Warn("voice.mode = raw_udp but server.udp_port is 0: media is unavailable")
		return r, nil, nil
	}
	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: port})
	if err != nil {
		return r, nil, fmt.Errorf("listen UDP :%d: %w", port, err)
	}
	logger.Infof("encrypted UDP media router on :%d", port)
	go r.Serve(conn)
	return r, conn, nil
}
