package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters — tuned for interactive logins on modest hardware.
// Increase time/memory for higher security at the cost of login latency.
const (
	argonTime    = 2
	argonMemory  = 64 * 1024 // 64 MB
	argonThreads = 4
	argonKeyLen  = 32 // 256-bit key
	saltLen      = 16
	nonceLen     = 12 // GCM standard nonce
)

// SaltedHash holds the Argon2id output and its salt, serialized for storage.
type SaltedHash struct {
	Hash []byte `json:"hash"`
	Salt []byte `json:"salt"`
}

// HashPassword derives an Argon2id hash from a plaintext password with a
// random salt. Returns a JSON-serialized SaltedHash suitable for BadgerDB storage.
func HashPassword(password string) ([]byte, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return nil, fmt.Errorf("crypto: salt generation failed: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return json.Marshal(SaltedHash{Hash: hash, Salt: salt})
}

// VerifyPassword checks a plaintext password against a stored SaltedHash blob.
func VerifyPassword(password string, stored []byte) (bool, error) {
	var sh SaltedHash
	if err := json.Unmarshal(stored, &sh); err != nil {
		return false, fmt.Errorf("crypto: invalid stored hash format: %w", err)
	}
	candidate := argon2.IDKey([]byte(password), sh.Salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	// Constant-time comparison to prevent timing attacks.
	if len(candidate) != len(sh.Hash) {
		return false, nil
	}
	var diff byte
	for i := range candidate {
		diff |= candidate[i] ^ sh.Hash[i]
	}
	return diff == 0, nil
}

// DeriveKEK derives the Key Encryption Key (KEK) from the master password
// using Argon2id with a deterministic domain-separation salt.
// The KEK is used to encrypt/decrypt the database DEK, never stored raw.
func DeriveKEK(masterPassword string) []byte {
	// Deterministic salt for KEK derivation — not secret, but domain-separated.
	salt := []byte("cove:kek:v1:")
	padded := make([]byte, saltLen)
	copy(padded, salt)
	return argon2.IDKey([]byte(masterPassword), padded, argonTime, argonMemory, argonThreads, argonKeyLen)
}

// GenerateAES256Key generates a cryptographically random 256-bit AES key for
// a new channel. This key is stored encrypted in the database and distributed
// to authorized clients over WSS.
func GenerateAES256Key() ([]byte, error) {
	key := make([]byte, argonKeyLen)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("crypto: key generation failed: %w", err)
	}
	return key, nil
}

// EncryptAES256GCM encrypts plaintext using AES-256-GCM with a random nonce.
// Returns the nonce prepended to the ciphertext: [nonce | ciphertext | tag].
func EncryptAES256GCM(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: cipher creation failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: GCM creation failed: %w", err)
	}
	nonce := make([]byte, nonceLen)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("crypto: nonce generation failed: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

// DecryptAES256GCM decrypts data encrypted by EncryptAES256GCM.
// Expects the format: [nonce(12) | ciphertext | tag(16)].
func DecryptAES256GCM(key, data []byte) ([]byte, error) {
	if len(data) < nonceLen {
		return nil, errors.New("crypto: ciphertext too short")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: cipher creation failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: GCM creation failed: %w", err)
	}
	nonce, ciphertext := data[:nonceLen], data[nonceLen:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

// EncryptDEK wraps the database DEK using the KEK via AES-256-GCM.
// This encrypted blob is what gets stored on disk.
func EncryptDEK(kek, dek []byte) ([]byte, error) {
	return EncryptAES256GCM(kek, dek)
}

// DecryptDEK unwraps an encrypted DEK using the KEK.
func DecryptDEK(kek, encryptedDEK []byte) ([]byte, error) {
	return DecryptAES256GCM(kek, encryptedDEK)
}
