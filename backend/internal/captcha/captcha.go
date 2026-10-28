// Package captcha issues and verifies self-hosted proof-of-work challenges for sign-up, in the ALTCHA v1
// wire format (https://altcha.org). A client must find a number n such that SHA-256(salt + n) equals the
// signed challenge. That costs CPU time, which makes mass sign-ups expensive, without any third-party
// service, tracking or user-visible puzzle. Because the format is the public ALTCHA one, the official
// widget works against this server too, and Cove's own clients ship built-in solvers.
package captcha

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Algorithm is the only hash accepted; it is part of the ALTCHA v1 format.
const Algorithm = "SHA-256"

// Difficulty names accepted in config, and the work each one asks for. The client tries about half of
// the range on average, so "medium" is roughly 50k hashes: well under a second on a phone.
const (
	DifficultyLow    = "low"
	DifficultyMedium = "medium"
	DifficultyHigh   = "high"
)

// maxPayloadNumber bounds the number in a submitted solution so a forged payload cannot make the server
// format an absurd value. It is far above the highest difficulty.
const maxPayloadNumber = 50_000_000

var (
	// ErrInvalid means the payload is malformed, forged, or not a solution to a challenge this server issued.
	ErrInvalid = errors.New("captcha: invalid solution")
	// ErrExpired means the challenge was issued longer ago than the ttl.
	ErrExpired = errors.New("captcha: challenge expired")
	// ErrReplayed means this solution was already used once.
	ErrReplayed = errors.New("captcha: solution already used")
)

// Challenge is what the server sends to the client (field names are fixed by the ALTCHA format).
type Challenge struct {
	Algorithm string `json:"algorithm"`
	// Challenge is hex(SHA-256(salt + number)) for the secret number.
	Challenge string `json:"challenge"`
	// MaxNumber is the exclusive-free upper bound of the search: the secret is in [0, MaxNumber].
	MaxNumber int `json:"maxnumber"`
	// Salt is random and carries the expiry as "?expires=<unix>".
	Salt string `json:"salt"`
	// Signature is hex(HMAC-SHA256(key, Challenge)); it stops clients inventing challenges.
	Signature string `json:"signature"`
}

// solution is the base64-encoded JSON a client submits.
type solution struct {
	Algorithm string `json:"algorithm"`
	Challenge string `json:"challenge"`
	Number    int64  `json:"number"`
	Salt      string `json:"salt"`
	Signature string `json:"signature"`
}

// MaxNumberFor maps a difficulty name to the search range; unknown names fall back to medium.
func MaxNumberFor(difficulty string) int {
	switch difficulty {
	case DifficultyLow:
		return 25_000
	case DifficultyHigh:
		return 400_000
	default:
		return 100_000
	}
}

// ValidDifficulty reports whether d is a known difficulty name.
func ValidDifficulty(d string) bool {
	return d == DifficultyLow || d == DifficultyMedium || d == DifficultyHigh
}

// Service issues and verifies challenges. Used solutions are remembered in memory until they would expire
// anyway: this is only an anti-replay window, so losing it on restart is harmless (every outstanding
// challenge is also invalidated then, because the signing key is regenerated).
type Service struct {
	key []byte
	ttl time.Duration
	now func() time.Time

	mu   sync.Mutex
	used map[string]int64 // signature -> unix expiry
}

// New creates a Service. A nil or empty key generates a random one, which is the normal case.
func New(key []byte, ttl time.Duration) *Service {
	return NewWithClock(key, ttl, time.Now)
}

// NewWithClock is New with an injectable clock (used by tests).
func NewWithClock(key []byte, ttl time.Duration, now func() time.Time) *Service {
	if len(key) == 0 {
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			panic(fmt.Sprintf("captcha: cannot read random bytes: %v", err)) // the OS entropy source is gone; nothing is safe
		}
	}
	return &Service{key: key, ttl: ttl, now: now, used: make(map[string]int64)}
}

// NewChallenge issues a challenge whose secret number lies in [0, maxNumber].
func (s *Service) NewChallenge(maxNumber int) (Challenge, error) {
	if maxNumber < 1 {
		return Challenge{}, errors.New("captcha: maxNumber must be positive")
	}
	saltBytes := make([]byte, 12)
	if _, err := rand.Read(saltBytes); err != nil {
		return Challenge{}, fmt.Errorf("captcha: random salt: %w", err)
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(maxNumber)+1))
	if err != nil {
		return Challenge{}, fmt.Errorf("captcha: random number: %w", err)
	}
	expires := s.now().Add(s.ttl).Unix()
	salt := hex.EncodeToString(saltBytes) + "?expires=" + strconv.FormatInt(expires, 10)
	challenge := digest(salt, n.Int64())
	return Challenge{
		Algorithm: Algorithm,
		Challenge: challenge,
		MaxNumber: maxNumber,
		Salt:      salt,
		Signature: s.sign(challenge),
	}, nil
}

// Verify checks a submitted solution (the base64 JSON payload) and consumes it. It returns ErrInvalid,
// ErrExpired or ErrReplayed; a nil result means the client really did the work for a challenge this
// server issued, once.
func (s *Service) Verify(payload string) error {
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return ErrInvalid
	}
	var sol solution
	if err := json.Unmarshal(raw, &sol); err != nil {
		return ErrInvalid
	}
	if sol.Algorithm != Algorithm || sol.Number < 0 || sol.Number > maxPayloadNumber {
		return ErrInvalid
	}
	expires, ok := saltExpiry(sol.Salt)
	if !ok {
		return ErrInvalid
	}
	// Recomputing the hash proves the work was done; the HMAC proves this server issued the challenge.
	if !hmac.Equal([]byte(digest(sol.Salt, sol.Number)), []byte(strings.ToLower(sol.Challenge))) {
		return ErrInvalid
	}
	if !hmac.Equal([]byte(s.sign(sol.Challenge)), []byte(strings.ToLower(sol.Signature))) {
		return ErrInvalid
	}

	now := s.now().Unix()
	if now > expires {
		return ErrExpired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for sig, exp := range s.used {
		if now > exp {
			delete(s.used, sig)
		}
	}
	key := strings.ToLower(sol.Signature)
	if _, dup := s.used[key]; dup {
		return ErrReplayed
	}
	s.used[key] = expires
	return nil
}

func (s *Service) sign(challenge string) string {
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(challenge))
	return hex.EncodeToString(mac.Sum(nil))
}

func digest(salt string, number int64) string {
	sum := sha256.Sum256([]byte(salt + strconv.FormatInt(number, 10)))
	return hex.EncodeToString(sum[:])
}

// saltExpiry reads the "expires" query value that NewChallenge appends to the salt.
func saltExpiry(salt string) (int64, bool) {
	_, query, found := strings.Cut(salt, "?")
	if !found {
		return 0, false
	}
	values, err := url.ParseQuery(query)
	if err != nil {
		return 0, false
	}
	expires, err := strconv.ParseInt(values.Get("expires"), 10, 64)
	if err != nil || expires <= 0 {
		return 0, false
	}
	return expires, true
}
