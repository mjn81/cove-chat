package config

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"github.com/BurntSushi/toml"
)

// Config holds all server configuration values.
type Config struct {
	Server    ServerConfig    `toml:"server"`
	Security  SecurityConfig  `toml:"security"`
	Database  DatabaseConfig  `toml:"database"`
	Storage   StorageConfig   `toml:"storage"`
	RateLimit RateLimitConfig `toml:"rate_limit"`
	Voice     VoiceConfig     `toml:"voice"`
}

// VoiceConfig selects and configures the group audio/video calling engine.
//
// Mode "webrtc" is the production, internet-capable path: a self-hosted SFU
// (internal/rtc) using DTLS-SRTP encrypted media, with an embedded STUN/TURN
// server for NAT traversal — no external signaling/media services involved.
//
// Mode "raw_udp" keeps the original unencrypted, audio-only UDP packet
// router (internal/voice) for isolated/LAN deployments where every client
// can already reach the server directly and the DTLS/ICE overhead of
// WebRTC isn't wanted. It has no video/screen-share support by design.
type VoiceConfig struct {
	Mode string `toml:"mode"` // "webrtc" (default) | "raw_udp"

	MaxParticipantsPerCall int `toml:"max_participants_per_call"`

	// WebRTC media (ICE/DTLS/SRTP) UDP port range. Firewall this range on
	// the host; each active track negotiation uses one ephemeral port.
	WebRTCPortMin int `toml:"webrtc_port_min"`
	WebRTCPortMax int `toml:"webrtc_port_max"`

	// PublicIP is announced to clients as a server-reflexive candidate via
	// ICE's NAT 1:1 mapping. Required whenever the process is behind NAT/a
	// cloud load balancer/Docker port mapping — otherwise clients will only
	// ever be offered the container's private IP, which they can't reach.
	//
	// Mode "webrtc" is the internet-capable calling engine, so it's fine —
	// and the default — for it to assume outbound internet access is
	// available. A deployment with no internet egress at all (genuinely
	// isolated/air-gapped) should set Mode to "raw_udp" instead
	// (internal/voice's plain UDP router), not run "webrtc" with this unset.
	//
	//   "auto"    - (default) discover it via a one-time STUN query at
	//             startup (see internal/rtc/discover.go). A public IP can
	//             only ever be learned from a vantage point outside your own
	//             NAT, so this does mean one outbound UDP request at boot —
	//             never anything ongoing, and never used for relaying media.
	//             Falls back to running without a public IP (same as "") if
	//             every STUN server is unreachable, rather than failing.
	//   ""        - don't announce one; only for direct/LAN "webrtc" mode
	//             deployments where the bind address is already reachable.
	//   "1.2.3.4" - explicit manual value (e.g. one you already looked up
	//             from your cloud provider's own metadata service).
	PublicIP string `toml:"public_ip"`
	// PublicIPDiscoverySTUNServers overrides the STUN servers tried for
	// "auto" above, in order (default: Google's and Cloudflare's public STUN).
	PublicIPDiscoverySTUNServers []string `toml:"public_ip_discovery_stun_servers"`

	// EmbeddedTURNEnabled starts our own STUN+TURN relay (github.com/pion/turn)
	// in-process on EmbeddedTURNPort. This is what lets WebRTC calls work
	// across restrictive NATs/firewalls without depending on any external
	// TURN provider — the relay is just another goroutine in this binary.
	EmbeddedTURNEnabled bool   `toml:"embedded_turn_enabled"`
	EmbeddedTURNPort    int    `toml:"embedded_turn_port"`
	TURNRealm           string `toml:"turn_realm"`
	// TURNSharedSecret drives short-lived (HMAC-derived) TURN credentials
	// minted per call-join, per the TURN REST API convention — never a
	// static shared username/password baked into the client. Generated
	// randomly on first run and persisted, like the master password.
	TURNSharedSecret string `toml:"turn_shared_secret"`
}

type ServerConfig struct {
	Domain         string `toml:"domain"`
	HTTPPort       int    `toml:"http_port"`
	UDPPort        int    `toml:"udp_port"`
	MaxFileSizeMB       int    `toml:"max_file_size_mb"`
	MaxVideoSizeMB      int    `toml:"max_video_size_mb"`
	MaxVideoDurationSec int    `toml:"max_video_duration_sec"`
	FFmpegPath          string `toml:"ffmpeg_path"`
	Dev                 bool   `toml:"dev"`
	FrontendOrigin      string `toml:"frontend_origin"`
	// TrustProxyHeaders enables reading the client IP from CF-Connecting-IP /
	// X-Real-IP / X-Forwarded-For. Only enable this when the server sits
	// behind a reverse proxy that overwrites these headers itself — otherwise
	// any client can spoof its own rate-limit/log IP by setting them directly.
	TrustProxyHeaders bool `toml:"trust_proxy_headers"`
}

type SecurityConfig struct {
	MasterPassword   string `toml:"master_password"`
	TokenExpireHours int    `toml:"token_expire_hours"`
}

type DatabaseConfig struct {
	Path string `toml:"path"`
}

type StorageConfig struct {
	UploadDir string    `toml:"upload_dir"`
	S3        *S3Config `toml:"s3"`
}

type S3Config struct {
	Enabled   bool   `toml:"enabled"`
	Endpoint  string `toml:"endpoint"`
	Region    string `toml:"region"`
	Bucket    string `toml:"bucket"`
	AccessKey string `toml:"access_key"`
	SecretKey string `toml:"secret_key"`
}

type RateLimitConfig struct {
	GlobalRPS int `toml:"global_rps"`
	AuthRPS   int `toml:"auth_rps"`
}

const configPath = "config.toml"

// Load reads config.toml, applying defaults where values are missing.
// If a master_password is not set, it generates one, prints it to the terminal,
// and persists it back into config.toml.
func Load() (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Domain:         "localhost",
			HTTPPort:       4000,
			UDPPort:        9090,
			MaxFileSizeMB:       100, // Default 100MB
			MaxVideoSizeMB:      50,  // Default 50MB
			MaxVideoDurationSec: 60,  // Default 60 seconds
			FFmpegPath:          "ffmpeg",
			Dev:                 false,
			FrontendOrigin:    "http://localhost:5173",
			TrustProxyHeaders: false,
		},
		Security: SecurityConfig{
			MasterPassword:   "",
			TokenExpireHours: 24,
		},
		Database: DatabaseConfig{
			Path: "./data/db",
		},
		Storage: StorageConfig{
			UploadDir: "./data/uploads",
			S3: &S3Config{
				Enabled: false,
			},
		},
		RateLimit: RateLimitConfig{
			GlobalRPS: 100,
			AuthRPS:   5,
		},
		Voice: VoiceConfig{
			Mode:                   "webrtc",
			MaxParticipantsPerCall: 10,
			WebRTCPortMin:          50000,
			WebRTCPortMax:          50100,
			// "webrtc" mode is the internet-capable path — a deployment
			// that genuinely has no internet egress (air-gapped/isolated)
			// should use Mode "raw_udp" instead (internal/voice), not
			// "webrtc" with this left empty. So it's safe, and more useful
			// out of the box, to default to auto-detecting the public IP
			// via STUN here rather than requiring every operator to set it
			// manually before calls work across NAT.
			PublicIP:            "auto",
			EmbeddedTURNEnabled: true,
			EmbeddedTURNPort:    3478,
			TURNRealm:           "nodetalk",
		},
	}

	// Allow config path to be overridden via environment variable.
	path := configPath
	if envPath := os.Getenv("NODETALK_CONFIG"); envPath != "" {
		path = envPath
	}

	if _, err := toml.DecodeFile(path, cfg); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("config: failed to decode %s: %w", path, err)
	}

	// Override master password from environment if set (12-Factor App pattern).
	if envPwd := os.Getenv("NODETALK_MASTER_PASSWORD"); envPwd != "" {
		cfg.Security.MasterPassword = envPwd
	}

	// Dev mode override (keeps development convenience)
	if os.Getenv("NODE_ENV") == "development" || os.Getenv("GO_ENV") == "development" {
		cfg.Server.Dev = true
	}

	// If still unset, generate a secure random password and persist it.
	if cfg.Security.MasterPassword == "" {
		pwd, err := generateMasterPassword()
		if err != nil {
			return nil, fmt.Errorf("config: failed to generate master password: %w", err)
		}
		cfg.Security.MasterPassword = pwd
		printPasswordWarning(pwd)
		if err := cfg.persist(path); err != nil {
			// Non-fatal — just warn, the server can still run.
			fmt.Fprintf(os.Stderr, "WARNING: Could not persist master password to %s: %v\n", path, err)
			fmt.Fprintln(os.Stderr, "Store the password shown above manually in config.toml or NODETALK_MASTER_PASSWORD.")
		}
	}

	// The embedded TURN server's short-lived credentials are HMAC-derived
	// from this secret (see internal/rtc/turn.go) — generate and persist it
	// the same way as the master password if it's missing, rather than
	// shipping with (or defaulting to) any fixed value.
	if cfg.Voice.EmbeddedTURNEnabled && cfg.Voice.TURNSharedSecret == "" {
		secret, err := generateMasterPassword() // same shape: 32 random bytes, base64url
		if err != nil {
			return nil, fmt.Errorf("config: failed to generate TURN shared secret: %w", err)
		}
		cfg.Voice.TURNSharedSecret = secret
		if err := cfg.persist(path); err != nil {
			fmt.Fprintf(os.Stderr, "WARNING: Could not persist TURN shared secret to %s: %v\n", path, err)
		}
	}

	return cfg, nil
}

// generateMasterPassword creates a cryptographically secure 32-byte random
// string encoded as URL-safe Base64.
func generateMasterPassword() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// printPasswordWarning prints the generated master password to the terminal
// in a highly visible format so the operator cannot miss it.
func printPasswordWarning(pwd string) {
	border := "================================================================"
	fmt.Println()
	fmt.Println(border)
	fmt.Println("  !!  NODETALK: MASTER PASSWORD GENERATED — ACTION REQUIRED  !!")
	fmt.Println(border)
	fmt.Printf("  Password: %s\n", pwd)
	fmt.Println()
	fmt.Println("  This password has been saved to config.toml.")
	fmt.Println("  BACK IT UP. Losing it makes the database UNRECOVERABLE.")
	fmt.Println(border)
	fmt.Println()
}

// persist writes the current configuration back to the TOML file. The file
// contains the master password in plaintext, so it's created with 0600
// (owner read/write only) rather than relying on the process umask, which
// on a permissively-configured host could leave it world-readable.
func (c *Config) persist(path string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(c)
}
