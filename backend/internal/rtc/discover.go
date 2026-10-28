package rtc

import (
	"fmt"
	"time"

	"cove/backend/internal/logger"

	"github.com/pion/stun/v4"
)

// defaultDiscoverySTUNServers are queried, in order, by DiscoverPublicIP.
// These are only ever used for the one-shot "what's my public IP" bootstrap
// lookup below — never for relaying media, which stays entirely on our own
// embedded TURN server (see turn.go). A STUN binding request is the
// standard (RFC 5389), minimal way to learn this: a public IP is only
// knowable from a vantage point outside your own NAT, so *some* external
// query is unavoidable for auto-detection — this is that one bootstrap
// query, not an ongoing dependency.
var defaultDiscoverySTUNServers = []string{
	"stun:stun.l.google.com:19302",
	"stun:stun.cloudflare.com:3478",
}

// DiscoverPublicIP resolves the server's public IP via a single STUN
// binding request, trying each server in turn until one responds. Used
// when voice.public_ip is set to "auto" in config. Returns an error if
// every server fails or times out — callers should treat that as "auto
// detection isn't available here" (e.g. an isolated/offline network) and
// fall back to running without a public IP, not as fatal.
func DiscoverPublicIP(servers []string, timeout time.Duration) (string, error) {
	if len(servers) == 0 {
		servers = defaultDiscoverySTUNServers
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	var lastErr error
	for _, server := range servers {
		ip, err := discoverViaSTUNServer(server, timeout)
		if err == nil {
			return ip, nil
		}
		logger.Debugf("rtc: public IP discovery via %s failed: %v", server, err)
		lastErr = err
	}
	return "", fmt.Errorf("rtc: public IP auto-detection failed against all %d STUN server(s): %w", len(servers), lastErr)
}

func discoverViaSTUNServer(server string, timeout time.Duration) (string, error) {
	uri, err := stun.ParseURI(server)
	if err != nil {
		return "", fmt.Errorf("parse STUN URI %q: %w", server, err)
	}

	client, err := stun.DialURI(uri, &stun.DialConfig{})
	if err != nil {
		return "", fmt.Errorf("dial %s: %w", server, err)
	}
	defer client.Close()

	type result struct {
		ip  string
		err error
	}
	done := make(chan result, 1)

	message := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
	if err := client.Start(message, func(ev stun.Event) {
		if ev.Error != nil {
			done <- result{err: ev.Error}
			return
		}
		var xorAddr stun.XORMappedAddress
		if err := xorAddr.GetFrom(ev.Message); err != nil {
			done <- result{err: fmt.Errorf("decode XOR-MAPPED-ADDRESS: %w", err)}
			return
		}
		done <- result{ip: xorAddr.IP.String()}
	}); err != nil {
		return "", fmt.Errorf("send binding request to %s: %w", server, err)
	}

	select {
	case res := <-done:
		return res.ip, res.err
	case <-time.After(timeout):
		return "", fmt.Errorf("timed out waiting for %s", server)
	}
}
