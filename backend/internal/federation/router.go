// Package federation provides the inter-node communication router for Cove.
//
// Cove uses Matrix-style addressing via the :domain suffix, e.g.:
//
//	alice:node1.example.com -> bob:node2.example.com
//
// Federation is opt-in — nodes default to local-only mode (air-gap friendly).
// This package is a Phase 2 stub to be fully implemented after the local
// messaging pipeline is complete and stable.
package federation

import (
	"context"
	"cove/backend/internal/logger"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Router handles outbound message delivery to remote Cove nodes.
// Remote nodes are addressed as "user:domain" in the recipient field.
type Router struct {
	localDomain string
	httpClient  *http.Client
}

// NewRouter creates a federation Router for the given local domain.
func NewRouter(localDomain string) *Router {
	return &Router{
		localDomain: localDomain,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// IsRemote reports whether a recipient address belongs to another node.
// Format: "username:domain" — if domain differs from local, it is remote.
func (r *Router) IsRemote(recipient string) bool {
	parts := strings.SplitN(recipient, ":", 2)
	if len(parts) != 2 {
		return false // local username, no domain suffix
	}
	return parts[1] != r.localDomain
}

// ParseRecipient splits a "username:domain" address into its components.
func ParseRecipient(recipient string) (username, domain string, err error) {
	parts := strings.SplitN(recipient, ":", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("federation: invalid recipient %q — expected user:domain format", recipient)
	}
	return parts[0], parts[1], nil
}

// FederatedMessage is the envelope sent between Cove nodes over HTTPS.
type FederatedMessage struct {
	FromNode    string `json:"from_node"`
	ToNode      string `json:"to_node"`
	SenderID    string `json:"sender_id"`
	RecipientID string `json:"recipient_id"`
	ChannelID   string `json:"channel_id"`
	Type        string `json:"type"`       // "text" | "file" | "voice"
	Ciphertext  []byte `json:"ciphertext"` // Already encrypted — node cannot read
	Nonce       []byte `json:"nonce"`
	SentAt      int64  `json:"sent_at"` // Unix nano
}

// Deliver sends a federated message to the target node.
// Target node URL is derived as https://{domain}/api/fed/inbound.
//
// TODO(phase2):
//   - Implement node-to-node authentication (shared secret or mTLS).
//   - Add retry with exponential backoff for transient failures.
//   - Implement delivery receipts.
//   - Implement node discovery via DNS SRV records (_cove._tcp.domain).
func (r *Router) Deliver(ctx context.Context, msg *FederatedMessage) error {
	targetURL := fmt.Sprintf("https://%s/api/fed/inbound", msg.ToNode)
	logger.Infof("federation: [STUB] would deliver message to %s", targetURL)
	// TODO: marshal msg, POST to targetURL with auth headers.
	return fmt.Errorf("federation: not yet implemented — target: %s", targetURL)
}

// InboundHandler returns an http.Handler that accepts messages from remote nodes.
// Remote nodes POST a FederatedMessage to /api/fed/inbound.
//
// TODO(phase2): Verify node signature, route to local WSS hub.
func InboundHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Placeholder: accept and acknowledge but don't process yet.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		_, _ = w.Write([]byte(`{"error":"federation inbound not yet implemented"}`))
	})
}
