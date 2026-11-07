package udpmedia

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Role says which side of the session a Keyring serves; it decides which directional key seals and which opens.
type Role int

// Roles.
const (
	RoleClient Role = iota
	RoleServer
)

const (
	// RotateInterval is how long one epoch's keys are used before the sender ratchets.
	RotateInterval = 10 * time.Minute
	// RotatePackets is the packet count after which the sender ratchets (far below the 96-bit nonce limit).
	RotatePackets = uint64(1) << 32
	// PrevEpochGrace is how long the previous epoch still opens packets after a rotation, for reordered packets.
	PrevEpochGrace = 10 * time.Second
	// NonceLen is the length of the client and server handshake nonces.
	NonceLen = 16
)

// epochKeys is the key material of one epoch.
type epochKeys struct {
	epoch    uint8
	prk      []byte
	send     cipher.AEAD
	recv     cipher.AEAD
	sendSalt [4]byte
	recvSalt [4]byte
	sendSeq  uint64
	window   replayWindow
	born     time.Time
}

// Keyring holds a session's keys for the current epoch (and briefly the previous one) and seals and opens packets.
// It is safe for concurrent use.
type Keyring struct {
	mu        sync.Mutex
	role      Role
	sid       [SessionIDLen]byte
	ctx       string
	cur       *epochKeys
	prev      *epochKeys
	next      *epochKeys // derived lazily and cached so forged next-epoch packets cost no repeated HKDF work
	prevUntil time.Time
	now       func() time.Time
}

// SetClock replaces the time source; tests use it to cross the rotation interval without sleeping.
func (k *Keyring) SetClock(now func() time.Time) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.now = now
}

// SessionID returns the session identifier carried in every packet header.
func (k *Keyring) SessionID() [SessionIDLen]byte { return k.sid }

// Epoch returns the epoch used for sending.
func (k *Keyring) Epoch() uint8 {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.cur.epoch
}

// NewKeyring derives the epoch-0 keys of a session from the ECDH shared secret and the handshake values
// (docs/udp-media.md section 3). channelID and userID bind the keys to the room and the user.
func NewKeyring(role Role, sid [SessionIDLen]byte, shared, clientNonce, serverNonce []byte, channelID, userID string) (*Keyring, error) {
	salt := make([]byte, 0, SessionIDLen+len(clientNonce)+len(serverNonce))
	salt = append(salt, sid[:]...)
	salt = append(salt, clientNonce...)
	salt = append(salt, serverNonce...)
	prk, err := hkdf.Extract(sha256.New, shared, salt)
	if err != nil {
		return nil, fmt.Errorf("udpmedia: extract: %w", err)
	}
	k := &Keyring{role: role, sid: sid, ctx: "|" + channelID + "|" + userID, now: time.Now}
	if k.cur, err = k.deriveEpoch(prk, 0, k.now()); err != nil {
		return nil, err
	}
	return k, nil
}

func expand(prk []byte, label, ctx string, n int) ([]byte, error) {
	return hkdf.Expand(sha256.New, prk, label+ctx, n)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// deriveEpoch expands a pseudo-random key into the four directional values.
func (k *Keyring) deriveEpoch(prk []byte, epoch uint8, born time.Time) (*epochKeys, error) {
	c2sKey, err := expand(prk, "cove-udpmedia/v1/c2s/key", k.ctx, 32)
	if err != nil {
		return nil, err
	}
	s2cKey, err := expand(prk, "cove-udpmedia/v1/s2c/key", k.ctx, 32)
	if err != nil {
		return nil, err
	}
	c2sSalt, err := expand(prk, "cove-udpmedia/v1/c2s/salt", k.ctx, 4)
	if err != nil {
		return nil, err
	}
	s2cSalt, err := expand(prk, "cove-udpmedia/v1/s2c/salt", k.ctx, 4)
	if err != nil {
		return nil, err
	}
	c2s, err := newGCM(c2sKey)
	if err != nil {
		return nil, err
	}
	s2c, err := newGCM(s2cKey)
	if err != nil {
		return nil, err
	}
	e := &epochKeys{epoch: epoch, prk: prk, born: born}
	if k.role == RoleClient {
		e.send, e.recv = c2s, s2c
		copy(e.sendSalt[:], c2sSalt)
		copy(e.recvSalt[:], s2cSalt)
	} else {
		e.send, e.recv = s2c, c2s
		copy(e.sendSalt[:], s2cSalt)
		copy(e.recvSalt[:], c2sSalt)
	}
	return e, nil
}

// ratchet derives the keys of the epoch after e. The old pseudo-random key is not kept by the new epoch.
func (k *Keyring) ratchet(e *epochKeys) (*epochKeys, error) {
	next, err := hkdf.Extract(sha256.New, e.prk, []byte("cove-udpmedia/v1/ratchet"))
	if err != nil {
		return nil, err
	}
	return k.deriveEpoch(next, e.epoch+1, k.now())
}

func (k *Keyring) commit(next *epochKeys) {
	// Dropping the reference to the old pseudo-random key gives forward secrecy for epochs older than prev.
	if k.prev != nil {
		k.prev.prk = nil
	}
	k.cur.prk = nil
	k.prev = k.cur
	k.prevUntil = k.now().Add(PrevEpochGrace)
	k.cur = next
	k.next = nil
}

func (k *Keyring) nextLocked() (*epochKeys, error) {
	if k.next == nil {
		n, err := k.ratchet(k.cur)
		if err != nil {
			return nil, err
		}
		k.next = n
	}
	return k.next, nil
}

// Rotate ratchets to the next epoch now. Sealing does this automatically after RotateInterval or RotatePackets.
func (k *Keyring) Rotate() error {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.rotateLocked()
}

func (k *Keyring) rotateLocked() error {
	next, err := k.nextLocked()
	if err != nil {
		return err
	}
	k.commit(next)
	return nil
}

// Seal encrypts plaintext into a ready-to-send packet of the given type. It rotates the epoch first when due.
func (k *Keyring) Seal(t PacketType, plaintext []byte) ([]byte, error) {
	if len(plaintext) > MaxPlaintext {
		return nil, ErrTooLarge
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.cur.sendSeq >= RotatePackets || k.now().Sub(k.cur.born) >= RotateInterval {
		if err := k.rotateLocked(); err != nil {
			return nil, err
		}
	}
	e := k.cur
	h := Header{Type: t, Epoch: e.epoch, SessionID: k.sid, Seq: e.sendSeq}
	e.sendSeq++
	pkt := h.appendTo(make([]byte, 0, HeaderLen+len(plaintext)+TagLen))
	var nonce [12]byte
	copy(nonce[:4], e.sendSalt[:])
	binary.BigEndian.PutUint64(nonce[4:], h.Seq)
	return e.send.Seal(pkt, nonce[:], plaintext, pkt[:HeaderLen]), nil
}

// Open authenticates and decrypts pkt. On success it returns the header and plaintext and records the sequence
// number in the replay window. A packet one epoch ahead rotates the keyring only after it authenticates.
func (k *Keyring) Open(pkt []byte) (Header, []byte, error) {
	h, err := ParseHeader(pkt)
	if err != nil {
		return h, nil, err
	}
	if h.SessionID != k.sid {
		return h, nil, ErrWrongSession
	}
	k.mu.Lock()
	defer k.mu.Unlock()

	var e *epochKeys
	isNext := false
	switch {
	case h.Epoch == k.cur.epoch:
		e = k.cur
	case k.prev != nil && h.Epoch == k.prev.epoch && k.now().Before(k.prevUntil):
		e = k.prev
	case h.Epoch == k.cur.epoch+1:
		if e, err = k.nextLocked(); err != nil {
			return h, nil, err
		}
		isNext = true
	default:
		return h, nil, ErrBadEpoch
	}
	if !e.window.ok(h.Seq) {
		return h, nil, ErrReplay
	}
	var nonce [12]byte
	copy(nonce[:4], e.recvSalt[:])
	binary.BigEndian.PutUint64(nonce[4:], h.Seq)
	plain, err := e.recv.Open(nil, nonce[:], pkt[HeaderLen:], pkt[:HeaderLen])
	if err != nil {
		return h, nil, ErrAuth
	}
	e.window.mark(h.Seq)
	if isNext {
		k.commit(e)
	}
	return h, plain, nil
}

// JoinRequest is the "media" object of a client's call_join message.
type JoinRequest struct {
	ClientPub   string `json:"client_pub"`   // base64 X25519 public key
	ClientNonce string `json:"client_nonce"` // base64, NonceLen bytes
}

// JoinResponse is the "media" object of the server's call_joined message.
type JoinResponse struct {
	SessionID   string `json:"session_id"`   // base64, SessionIDLen bytes
	ServerPub   string `json:"server_pub"`   // base64 X25519 public key
	ServerNonce string `json:"server_nonce"` // base64, NonceLen bytes
	MediaID     uint16 `json:"media_id"`     // this participant's source id on forwarded media
	MaxPacket   int    `json:"max_packet"`
	Epoch       uint8  `json:"epoch"`
}

// ClientJoin is the client's half of the handshake, kept between sending call_join and receiving call_joined.
type ClientJoin struct {
	priv  *ecdh.PrivateKey
	nonce []byte
}

// NewClientJoin generates the ephemeral key pair and nonce and returns the request to send in call_join.
func NewClientJoin() (*ClientJoin, JoinRequest, error) {
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, JoinRequest{}, err
	}
	nonce := make([]byte, NonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return nil, JoinRequest{}, err
	}
	enc := base64.StdEncoding
	return &ClientJoin{priv: priv, nonce: nonce},
		JoinRequest{ClientPub: enc.EncodeToString(priv.PublicKey().Bytes()), ClientNonce: enc.EncodeToString(nonce)}, nil
}

// Complete derives the client's keyring from the server's call_joined response.
func (c *ClientJoin) Complete(resp JoinResponse, channelID, userID string) (*Keyring, error) {
	enc := base64.StdEncoding
	sidB, err1 := enc.DecodeString(resp.SessionID)
	pubB, err2 := enc.DecodeString(resp.ServerPub)
	nonceB, err3 := enc.DecodeString(resp.ServerNonce)
	if err := errors.Join(err1, err2, err3); err != nil || len(sidB) != SessionIDLen || len(nonceB) != NonceLen {
		return nil, ErrMalformed
	}
	pub, err := ecdh.X25519().NewPublicKey(pubB)
	if err != nil {
		return nil, ErrMalformed
	}
	shared, err := c.priv.ECDH(pub)
	if err != nil {
		return nil, ErrMalformed
	}
	var sid [SessionIDLen]byte
	copy(sid[:], sidB)
	return NewKeyring(RoleClient, sid, shared, c.nonce, nonceB, channelID, userID)
}

// AcceptJoin is the server side: it validates the client's request, creates the ephemeral key pair, and returns the
// response for call_joined together with the server's keyring. mediaID is the participant's source id in the room.
func AcceptJoin(req JoinRequest, channelID, userID string, mediaID uint16) (JoinResponse, *Keyring, error) {
	enc := base64.StdEncoding
	pubB, err1 := enc.DecodeString(req.ClientPub)
	nonceB, err2 := enc.DecodeString(req.ClientNonce)
	if err := errors.Join(err1, err2); err != nil || len(nonceB) != NonceLen {
		return JoinResponse{}, nil, ErrMalformed
	}
	clientPub, err := ecdh.X25519().NewPublicKey(pubB)
	if err != nil {
		return JoinResponse{}, nil, ErrMalformed
	}
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return JoinResponse{}, nil, err
	}
	shared, err := priv.ECDH(clientPub)
	if err != nil {
		// X25519 rejects low-order points with an all-zero result; refuse them rather than derive keys from a known secret.
		return JoinResponse{}, nil, ErrMalformed
	}
	serverNonce := make([]byte, NonceLen)
	var sid [SessionIDLen]byte
	if _, err := rand.Read(serverNonce); err != nil {
		return JoinResponse{}, nil, err
	}
	if _, err := rand.Read(sid[:]); err != nil {
		return JoinResponse{}, nil, err
	}
	kr, err := NewKeyring(RoleServer, sid, shared, nonceB, serverNonce, channelID, userID)
	if err != nil {
		return JoinResponse{}, nil, err
	}
	return JoinResponse{
		SessionID:   enc.EncodeToString(sid[:]),
		ServerPub:   enc.EncodeToString(priv.PublicKey().Bytes()),
		ServerNonce: enc.EncodeToString(serverNonce),
		MediaID:     mediaID,
		MaxPacket:   MaxPacket,
		Epoch:       0,
	}, kr, nil
}
