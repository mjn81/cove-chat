package bots

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"syscall"
	"time"
)

// Webhook delivery headers.
const (
	HeaderSignature = "X-Cove-Signature"
	HeaderTimestamp = "X-Cove-Timestamp"
	HeaderDelivery  = "X-Cove-Delivery"
	HeaderEvent     = "X-Cove-Event"
)

// Sign returns the signature header value for a webhook body: "sha256=" and the hex HMAC-SHA256, keyed with the
// bot's webhook secret, of "<timestamp>.<body>". Receivers recompute it and reject old timestamps.
func Sign(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// errBlockedAddress is returned when a webhook resolves to an address the server must not call.
var errBlockedAddress = errors.New("webhook target address is not allowed")

// blockedIP reports whether ip is loopback, private, link-local (which includes the cloud metadata address),
// unspecified, multicast or carrier-grade NAT space.
func blockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
		if ip4[0] == 100 && ip4[1]&0xC0 == 64 { // 100.64.0.0/10
			return true
		}
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast()
}

// BlockedAddress is blockedIP for callers outside the package (tests, URL pre-checks).
func BlockedAddress(ip net.IP) bool { return blockedIP(ip) }

// newHTTPClient builds the client webhooks use. The address check runs in the dialer's Control hook, after DNS
// resolution and on the very address being connected to, so DNS rebinding cannot slip a private address past it.
// Redirects are never followed (a redirect could point at an internal address) and no proxy is used.
func newHTTPClient(allowPrivate func() bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if !allowPrivate() && blockedIP(net.ParseIP(host)) {
				return errBlockedAddress
			}
			return nil
		},
	}
	return &http.Client{
		Timeout:       5 * time.Second,
		Transport:     &http.Transport{DialContext: dialer.DialContext, DisableKeepAlives: true},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// retryable reports whether a webhook response status deserves another attempt.
func retryable(status int) bool {
	return status >= 500 || status == http.StatusRequestTimeout || status == http.StatusTooManyRequests
}

// post delivers one body once. It returns (retry, error): retry is false for a success and for a permanent refusal.
func post(ctx context.Context, c *http.Client, url, secret, deliveryID, event string, body []byte) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Cove-Webhook/1")
	req.Header.Set(HeaderTimestamp, ts)
	req.Header.Set(HeaderSignature, Sign(secret, ts, body))
	req.Header.Set(HeaderDelivery, deliveryID)
	req.Header.Set(HeaderEvent, event)
	resp, err := c.Do(req)
	if err != nil {
		return !errors.Is(err, errBlockedAddress), err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return false, nil
	}
	return retryable(resp.StatusCode), fmt.Errorf("webhook answered %d", resp.StatusCode)
}
