package tests

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"testing"
	"time"

	"cove/udpmedia"
)

// newKeyringPair returns a client and a server keyring sharing a session, built through the real handshake.
func newKeyringPair(t *testing.T) (client, server *udpmedia.Keyring) {
	t.Helper()
	cj, req, err := udpmedia.NewClientJoin()
	if err != nil {
		t.Fatal(err)
	}
	resp, srv, err := udpmedia.AcceptJoin(req, "chan-1", "user-1", 7)
	if err != nil {
		t.Fatal(err)
	}
	cli, err := cj.Complete(resp, "chan-1", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	return cli, srv
}

func TestUDPMedia_RoundTripBothDirections(t *testing.T) {
	cli, srv := newKeyringPair(t)
	for _, tc := range []struct {
		name     string
		from, to *udpmedia.Keyring
	}{{"c2s", cli, srv}, {"s2c", srv, cli}} {
		pkt, err := tc.from.Seal(udpmedia.TypeMedia, []byte("hello media"))
		if err != nil {
			t.Fatal(err)
		}
		h, pt, err := tc.to.Open(pkt)
		if err != nil {
			t.Fatalf("%s: open: %v", tc.name, err)
		}
		if string(pt) != "hello media" || h.Type != udpmedia.TypeMedia || h.Seq != 0 {
			t.Errorf("%s: got %q %+v", tc.name, pt, h)
		}
		if bytes.Contains(pkt, []byte("hello media")) {
			t.Errorf("%s: plaintext visible on the wire", tc.name)
		}
	}
}

// TestUDPMedia_KeyScheduleMatchesSpec re-derives the keys from docs/udp-media.md section 3 with raw HKDF and AES-GCM
// calls and checks the library's packet bytes match, so the document and the code cannot drift apart.
func TestUDPMedia_KeyScheduleMatchesSpec(t *testing.T) {
	shared := bytes.Repeat([]byte{0x11}, 32)
	cn := bytes.Repeat([]byte{0x22}, 16)
	sn := bytes.Repeat([]byte{0x33}, 16)
	sid := [8]byte{1, 2, 3, 4, 5, 6, 7, 8}
	ring, err := udpmedia.NewKeyring(udpmedia.RoleClient, sid, shared, cn, sn, "chan-1", "user-1")
	if err != nil {
		t.Fatal(err)
	}

	salt := append(append(append([]byte{}, sid[:]...), cn...), sn...)
	prk, err := hkdf.Extract(sha256.New, shared, salt)
	if err != nil {
		t.Fatal(err)
	}
	ctx := "|chan-1|user-1"
	key, _ := hkdf.Expand(sha256.New, prk, "cove-udpmedia/v1/c2s/key"+ctx, 32)
	nsalt, _ := hkdf.Expand(sha256.New, prk, "cove-udpmedia/v1/c2s/salt"+ctx, 4)
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)

	pkt, err := ring.Seal(udpmedia.TypeHello, []byte("spec"))
	if err != nil {
		t.Fatal(err)
	}
	hdr := append([]byte{0xC1, byte(udpmedia.TypeHello), 0, 0}, sid[:]...)
	hdr = binary.BigEndian.AppendUint64(hdr, 0)
	nonce := append(append([]byte{}, nsalt...), hdr[12:20]...)
	want := gcm.Seal(append([]byte{}, hdr...), nonce, []byte("spec"), hdr)
	if !bytes.Equal(pkt, want) {
		t.Fatalf("packet differs from the documented construction:\n got %x\nwant %x", pkt, want)
	}

	// Ratchet: epoch 1 uses HKDF-Extract(secret=prk, salt="cove-udpmedia/v1/ratchet").
	if err := ring.Rotate(); err != nil {
		t.Fatal(err)
	}
	prk1, _ := hkdf.Extract(sha256.New, prk, []byte("cove-udpmedia/v1/ratchet"))
	key1, _ := hkdf.Expand(sha256.New, prk1, "cove-udpmedia/v1/c2s/key"+ctx, 32)
	nsalt1, _ := hkdf.Expand(sha256.New, prk1, "cove-udpmedia/v1/c2s/salt"+ctx, 4)
	block1, _ := aes.NewCipher(key1)
	gcm1, _ := cipher.NewGCM(block1)
	pkt1, _ := ring.Seal(udpmedia.TypeHello, []byte("spec"))
	hdr1 := append([]byte{0xC1, byte(udpmedia.TypeHello), 1, 0}, sid[:]...)
	hdr1 = binary.BigEndian.AppendUint64(hdr1, 0)
	want1 := gcm1.Seal(append([]byte{}, hdr1...), append(append([]byte{}, nsalt1...), hdr1[12:20]...), []byte("spec"), hdr1)
	if !bytes.Equal(pkt1, want1) {
		t.Fatal("epoch 1 packet differs from the documented ratchet")
	}
}

func TestUDPMedia_TamperIsRejectedEverywhere(t *testing.T) {
	cli, srv := newKeyringPair(t)
	pkt, _ := cli.Seal(udpmedia.TypeMedia, []byte("payload-payload-payload"))
	for i := 0; i < len(pkt); i++ {
		bad := append([]byte{}, pkt...)
		bad[i] ^= 0x01
		if _, _, err := srv.Open(bad); err == nil {
			t.Fatalf("flipping byte %d was accepted", i)
		}
	}
	// A failed attempt must not burn the sequence number: the genuine packet still opens.
	if _, _, err := srv.Open(pkt); err != nil {
		t.Fatalf("genuine packet rejected after tamper attempts: %v", err)
	}
}

func TestUDPMedia_WrongKeyAndWrongSession(t *testing.T) {
	cli, _ := newKeyringPair(t)
	_, otherSrv := newKeyringPair(t)
	pkt, _ := cli.Seal(udpmedia.TypeMedia, []byte("x"))
	if _, _, err := otherSrv.Open(pkt); !errors.Is(err, udpmedia.ErrWrongSession) {
		t.Fatalf("different session: err = %v, want ErrWrongSession", err)
	}

	// Same session id, different shared secret (an attacker who guessed the id but not the key).
	sid := [8]byte{9}
	a, _ := udpmedia.NewKeyring(udpmedia.RoleClient, sid, bytes.Repeat([]byte{1}, 32), make([]byte, 16), make([]byte, 16), "c", "u")
	b, _ := udpmedia.NewKeyring(udpmedia.RoleServer, sid, bytes.Repeat([]byte{2}, 32), make([]byte, 16), make([]byte, 16), "c", "u")
	pkt, _ = a.Seal(udpmedia.TypeMedia, []byte("x"))
	if _, _, err := b.Open(pkt); !errors.Is(err, udpmedia.ErrAuth) {
		t.Fatalf("wrong key: err = %v, want ErrAuth", err)
	}

	// Same secret but bound to another room or user: keys must differ.
	c, _ := udpmedia.NewKeyring(udpmedia.RoleServer, sid, bytes.Repeat([]byte{1}, 32), make([]byte, 16), make([]byte, 16), "c", "other-user")
	pkt, _ = a.Seal(udpmedia.TypeMedia, []byte("x"))
	if _, _, err := c.Open(pkt); !errors.Is(err, udpmedia.ErrAuth) {
		t.Fatalf("different user binding: err = %v, want ErrAuth", err)
	}
}

func TestUDPMedia_NoReflection(t *testing.T) {
	cli, _ := newKeyringPair(t)
	pkt, _ := cli.Seal(udpmedia.TypeMedia, []byte("x"))
	// The client's own outbound packet must not verify as inbound (directional keys and nonce salts).
	if _, _, err := cli.Open(pkt); err == nil {
		t.Fatal("a client accepted a packet it sent itself")
	}
}

func TestUDPMedia_ReplayAndReorderWindow(t *testing.T) {
	cli, srv := newKeyringPair(t)
	pkts := make([][]byte, 20)
	for i := range pkts {
		pkts[i], _ = cli.Seal(udpmedia.TypeMedia, []byte{byte(i)})
	}
	// Deliver reversed: everything inside the window is accepted exactly once.
	for i := len(pkts) - 1; i >= 0; i-- {
		if _, pt, err := srv.Open(pkts[i]); err != nil || pt[0] != byte(i) {
			t.Fatalf("reordered packet %d: %v", i, err)
		}
	}
	for i, p := range pkts {
		if _, _, err := srv.Open(p); !errors.Is(err, udpmedia.ErrReplay) {
			t.Fatalf("replay of packet %d: err = %v, want ErrReplay", i, err)
		}
	}
}

func TestUDPMedia_TooOldPacketIsRejected(t *testing.T) {
	cli, srv := newKeyringPair(t)
	first, _ := cli.Seal(udpmedia.TypeMedia, []byte("old"))
	var last []byte
	for i := 0; i < 1100; i++ {
		last, _ = cli.Seal(udpmedia.TypeMedia, []byte("n"))
	}
	if _, _, err := srv.Open(last); err != nil {
		t.Fatal(err)
	}
	if _, _, err := srv.Open(first); !errors.Is(err, udpmedia.ErrReplay) {
		t.Fatalf("packet outside the 1024 window: err = %v, want ErrReplay", err)
	}
}

func TestUDPMedia_LossDoesNotBreakTheSession(t *testing.T) {
	cli, srv := newKeyringPair(t)
	var got int
	for i := 0; i < 500; i++ {
		pkt, _ := cli.Seal(udpmedia.TypeMedia, []byte{byte(i)})
		if i%3 == 0 {
			continue // lost
		}
		if _, _, err := srv.Open(pkt); err != nil {
			t.Fatalf("packet %d after losses: %v", i, err)
		}
		got++
	}
	if got != 500-167 {
		t.Fatalf("received %d", got)
	}
}

func TestUDPMedia_RotationByClockAndExplicit(t *testing.T) {
	cli, srv := newKeyringPair(t)
	now := time.Now()
	cli.SetClock(func() time.Time { return now })
	srv.SetClock(func() time.Time { return now })

	p0, _ := cli.Seal(udpmedia.TypeMedia, []byte("e0"))
	if _, _, err := srv.Open(p0); err != nil {
		t.Fatal(err)
	}
	now = now.Add(udpmedia.RotateInterval + time.Second)
	p1, _ := cli.Seal(udpmedia.TypeMedia, []byte("e1")) // sealing past the interval ratchets automatically
	if cli.Epoch() != 1 {
		t.Fatalf("client epoch = %d, want 1", cli.Epoch())
	}
	if _, pt, err := srv.Open(p1); err != nil || string(pt) != "e1" {
		t.Fatalf("epoch 1 packet: %v", err)
	}
	if srv.Epoch() != 1 {
		t.Fatalf("server did not follow to epoch 1 (epoch %d)", srv.Epoch())
	}
	// The server now answers under the new epoch and the client follows.
	r1, _ := srv.Seal(udpmedia.TypeMedia, []byte("reply"))
	if _, _, err := cli.Open(r1); err != nil {
		t.Fatalf("server reply after rotation: %v", err)
	}

	// Reordered packet from the previous epoch is still accepted within the grace period, then rejected.
	cliOld, srvOld := newKeyringPair(t)
	t0 := time.Now()
	cliOld.SetClock(func() time.Time { return t0 })
	srvOld.SetClock(func() time.Time { return t0 })
	oldPkt, _ := cliOld.Seal(udpmedia.TypeMedia, []byte("late"))
	if err := cliOld.Rotate(); err != nil {
		t.Fatal(err)
	}
	newPkt, _ := cliOld.Seal(udpmedia.TypeMedia, []byte("fresh"))
	if _, _, err := srvOld.Open(newPkt); err != nil {
		t.Fatal(err)
	}
	if _, _, err := srvOld.Open(oldPkt); err != nil {
		t.Fatalf("previous-epoch packet inside grace period: %v", err)
	}
	cliOld2, srvOld2 := newKeyringPair(t)
	now2 := time.Now()
	srvOld2.SetClock(func() time.Time { return now2 })
	oldPkt2, _ := cliOld2.Seal(udpmedia.TypeMedia, []byte("late"))
	_ = cliOld2.Rotate()
	newPkt2, _ := cliOld2.Seal(udpmedia.TypeMedia, []byte("fresh"))
	if _, _, err := srvOld2.Open(newPkt2); err != nil {
		t.Fatal(err)
	}
	now2 = now2.Add(udpmedia.PrevEpochGrace + time.Second)
	if _, _, err := srvOld2.Open(oldPkt2); !errors.Is(err, udpmedia.ErrBadEpoch) {
		t.Fatalf("previous-epoch packet after the grace period: err = %v, want ErrBadEpoch", err)
	}
}

func TestUDPMedia_ForgedNextEpochDoesNotRotate(t *testing.T) {
	cli, srv := newKeyringPair(t)
	good, _ := cli.Seal(udpmedia.TypeMedia, []byte("ok"))
	forged := append([]byte{}, good...)
	forged[2] = 1 // claims epoch 1 with a tag made for epoch 0
	if _, _, err := srv.Open(forged); err == nil {
		t.Fatal("forged next-epoch packet accepted")
	}
	if srv.Epoch() != 0 {
		t.Fatal("unauthenticated packet rotated the server's keys")
	}
	if _, _, err := srv.Open(good); err != nil {
		t.Fatalf("session broken by the forged packet: %v", err)
	}
	// Epochs beyond +1 are not even tried.
	forged[2] = 5
	if _, _, err := srv.Open(forged); !errors.Is(err, udpmedia.ErrBadEpoch) {
		t.Fatalf("far-future epoch: err = %v", err)
	}
}

func TestUDPMedia_RejectsMalformedAndOversize(t *testing.T) {
	_, srv := newKeyringPair(t)
	if _, _, err := srv.Open(nil); !errors.Is(err, udpmedia.ErrShortPacket) {
		t.Errorf("nil: %v", err)
	}
	if _, _, err := srv.Open(make([]byte, 35)); !errors.Is(err, udpmedia.ErrShortPacket) {
		t.Errorf("short: %v", err)
	}
	bad := make([]byte, 60)
	bad[0] = 0x01 // a legacy packet type, not our magic
	if _, _, err := srv.Open(bad); !errors.Is(err, udpmedia.ErrBadMagic) {
		t.Errorf("legacy first byte: %v", err)
	}
	if _, _, err := srv.Open(make([]byte, udpmedia.MaxPacket+1)); !errors.Is(err, udpmedia.ErrTooLarge) {
		t.Errorf("oversize: %v", err)
	}
	cli, _ := newKeyringPair(t)
	if _, err := cli.Seal(udpmedia.TypeMedia, make([]byte, udpmedia.MaxPlaintext+1)); !errors.Is(err, udpmedia.ErrTooLarge) {
		t.Errorf("sealing oversize plaintext: %v", err)
	}
	max, err := cli.Seal(udpmedia.TypeMedia, make([]byte, udpmedia.MaxPlaintext))
	if err != nil || len(max) != udpmedia.MaxPacket {
		t.Errorf("max plaintext packet = %d bytes, err %v; want %d", len(max), err, udpmedia.MaxPacket)
	}
}

func TestUDPMedia_HandshakeRejectsBadInput(t *testing.T) {
	_, req, _ := udpmedia.NewClientJoin()
	for name, mutate := range map[string]func(*udpmedia.JoinRequest){
		"empty key":     func(r *udpmedia.JoinRequest) { r.ClientPub = "" },
		"short key":     func(r *udpmedia.JoinRequest) { r.ClientPub = "AAAA" },
		"zero key":      func(r *udpmedia.JoinRequest) { r.ClientPub = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
		"bad nonce":     func(r *udpmedia.JoinRequest) { r.ClientNonce = "AAAA" },
		"not base64":    func(r *udpmedia.JoinRequest) { r.ClientNonce = "!!!" },
		"missing nonce": func(r *udpmedia.JoinRequest) { r.ClientNonce = "" },
	} {
		r := req
		mutate(&r)
		if _, _, err := udpmedia.AcceptJoin(r, "c", "u", 1); err == nil {
			t.Errorf("%s: handshake accepted", name)
		}
	}
	// Two joins never share a session id or keys.
	r1, k1, _ := udpmedia.AcceptJoin(req, "c", "u", 1)
	r2, k2, _ := udpmedia.AcceptJoin(req, "c", "u", 1)
	if r1.SessionID == r2.SessionID || r1.ServerPub == r2.ServerPub {
		t.Error("session id or server key reused")
	}
	p, _ := k1.Seal(udpmedia.TypeMedia, []byte("x"))
	if _, _, err := k2.Open(p); err == nil {
		t.Error("two sessions decrypt each other's packets")
	}
}
