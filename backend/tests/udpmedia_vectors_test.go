package tests

import (
	"bytes"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"cove/udpmedia"
)

// Exact-byte vectors for ports of the protocol (docs/udp-media.md). Native clients copy these hex strings into their own
// tests, so any change to the key schedule or packet layout must be deliberate: it breaks every port.
//
// Inputs: shared secret 0x00..0x1f, session id 0xA0..0xA7, client nonce 0x10..0x1f, server nonce 0x20..0x2f,
// channel "chan-1", user "user-1".
const (
	vecChannel = "chan-1"
	vecUser    = "user-1"
)

// Pinned outputs (generated once from the reference implementation; see the inputs above).
const (
	vecC2SKey  = "bf32d49e944023c19e748a0eb82776d79ceff18408d1a4de307475836186c108"
	vecS2CKey  = "3d2847a52f982509982d9093cab7ade816c55ad8a7d19bedbb2dd56407962170"
	vecC2SSalt = "7d8ec2ae"
	vecS2CSalt = "16a7f268"

	vecClientSeq0Media  = "c1030000a0a1a2a3a4a5a6a700000000000000003c003883f5c22a4c93f1a6e7c18184b4254907ce7834cd4d67f01bdb08df8cdd62eeb67ed127ffb34dc0046fe2a574ad1c42e34a9958f57f"
	vecClientSeq1Hello  = "c1010000a0a1a2a3a4a5a6a70000000000000001e6c7dbbdce3adc7ef0eafe7f0007f5e7"
	vecServerSeq0Ack    = "c1020000a0a1a2a3a4a5a6a70000000000000000384f54bb6b63df3e7a4a37d2f502a396c6bedd84e1b58d327a22776dd240dfd9d2d50182636e7d45590ab6f6d83f66597cde6224b11b23a0"
	vecClientEpoch1Seq0 = "c1030100a0a1a2a3a4a5a6a7000000000000000068912a01b7a1542c2ee53a745b04c6127e9280303cc0b4a6675efa822c2fca911a6da8d2a229493562e9a512fe428512d4dcd0745e633ee0"
)

func vecInputs() (sid [8]byte, shared, cn, sn []byte) {
	shared = make([]byte, 32)
	for i := range shared {
		shared[i] = byte(i)
	}
	for i := range sid {
		sid[i] = 0xA0 + byte(i)
	}
	cn = make([]byte, 16)
	sn = make([]byte, 16)
	for i := range cn {
		cn[i] = 0x10 + byte(i)
		sn[i] = 0x20 + byte(i)
	}
	return
}

func vecPlain() []byte {
	p := make([]byte, 40)
	for i := range p {
		p[i] = byte(i * 3)
	}
	return p
}

// vecKeys derives the epoch-0 keys independently of the library, to pin the HKDF labels.
func vecKeys(t *testing.T) (c2sKey, s2cKey, c2sSalt, s2cSalt []byte) {
	t.Helper()
	sid, shared, cn, sn := vecInputs()
	salt := append(append(append([]byte{}, sid[:]...), cn...), sn...)
	prk, err := hkdf.Extract(sha256.New, shared, salt)
	if err != nil {
		t.Fatal(err)
	}
	ctx := "|" + vecChannel + "|" + vecUser
	ex := func(label string, n int) []byte {
		b, err := hkdf.Expand(sha256.New, prk, label+ctx, n)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	return ex("cove-udpmedia/v1/c2s/key", 32), ex("cove-udpmedia/v1/s2c/key", 32), ex("cove-udpmedia/v1/c2s/salt", 4), ex("cove-udpmedia/v1/s2c/salt", 4)
}

func TestUDPMediaVectors_KeyScheduleAndPackets(t *testing.T) {
	sid, shared, cn, sn := vecInputs()
	c2sKey, s2cKey, c2sSalt, s2cSalt := vecKeys(t)
	wantHex := func(name string, got []byte, want string) {
		t.Helper()
		if hex.EncodeToString(got) != want {
			t.Errorf("%s = %x, want %s", name, got, want)
		}
	}
	wantHex("c2s_key", c2sKey, vecC2SKey)
	wantHex("s2c_key", s2cKey, vecS2CKey)
	wantHex("c2s_salt", c2sSalt, vecC2SSalt)
	wantHex("s2c_salt", s2cSalt, vecS2CSalt)

	cli, err := udpmedia.NewKeyring(udpmedia.RoleClient, sid, shared, cn, sn, vecChannel, vecUser)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := udpmedia.NewKeyring(udpmedia.RoleServer, sid, shared, cn, sn, vecChannel, vecUser)
	if err != nil {
		t.Fatal(err)
	}
	p0, _ := cli.Seal(udpmedia.TypeMedia, vecPlain())
	wantHex("client seq0 media", p0, vecClientSeq0Media)
	p1, _ := cli.Seal(udpmedia.TypeHello, nil)
	wantHex("client seq1 hello", p1, vecClientSeq1Hello)
	s0, _ := srv.Seal(udpmedia.TypeHelloAck, vecPlain())
	wantHex("server seq0 ack", s0, vecServerSeq0Ack)
	if err := cli.Rotate(); err != nil {
		t.Fatal(err)
	}
	e1, _ := cli.Seal(udpmedia.TypeMedia, vecPlain())
	wantHex("client epoch1 seq0", e1, vecClientEpoch1Seq0)

	// The server must open exactly these bytes.
	if _, pt, err := srv.Open(p0); err != nil || !bytes.Equal(pt, vecPlain()) {
		t.Fatalf("server open seq0: %v", err)
	}
}

func TestUDPMediaVectors_X25519RFC7748(t *testing.T) {
	// RFC 7748 section 6.1 Diffie-Hellman test, used by the Kotlin port (no platform X25519 below API 33).
	dec := func(s string) []byte { b, _ := hex.DecodeString(s); return b }
	curve := ecdh.X25519()
	alice, _ := curve.NewPrivateKey(dec("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"))
	bob, _ := curve.NewPrivateKey(dec("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"))
	if hex.EncodeToString(alice.PublicKey().Bytes()) != "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a" {
		t.Fatal("alice public mismatch")
	}
	s, err := alice.ECDH(bob.PublicKey())
	if err != nil || hex.EncodeToString(s) != "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742" {
		t.Fatalf("shared mismatch: %x %v", s, err)
	}
}
