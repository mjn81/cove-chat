package main

import (
	"bytes"
	"context"
	"net"
	"testing"
	"time"

	"cove/udpmedia"
)

// fakeServer is the smallest possible peer: it accepts the handshake like the real router, answers HELLO, and echoes
// each MEDIA packet back with src=1, which is enough to prove MediaCall drives the real protocol end to end.
func fakeServer(t *testing.T, req udpmedia.JoinRequest, channel, user string) (addr string, resp udpmedia.JoinResponse) {
	t.Helper()
	resp, ring, err := udpmedia.AcceptJoin(req, channel, user, 1)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	go func() {
		buf := make([]byte, 2048)
		for {
			n, from, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			h, pt, err := ring.Open(buf[:n])
			if err != nil {
				continue
			}
			switch h.Type {
			case udpmedia.TypeHello:
				ack, _ := ring.Seal(udpmedia.TypeHelloAck, pt)
				_, _ = conn.WriteToUDP(ack, from)
			case udpmedia.TypeMedia:
				mh, payload, err := udpmedia.ParseMedia(pt)
				if err != nil {
					continue
				}
				mh.Src = 1
				out, _ := ring.Seal(udpmedia.TypeMedia, udpmedia.AppendMedia(nil, mh, payload))
				_, _ = conn.WriteToUDP(out, from)
			}
		}
	}()
	return conn.LocalAddr().String(), resp
}

func TestMediaCallHandshakeAndEcho(t *testing.T) {
	call := NewMediaCall()
	defer call.Close()
	if err := call.SendFrame(1, udpmedia.CodecOpus, 0, 0, []byte("x")); err == nil {
		t.Fatal("SendFrame before connecting should fail")
	}
	req, err := call.Begin()
	if err != nil {
		t.Fatal(err)
	}
	addr, resp := fakeServer(t, req, "room", "me")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := call.Complete(ctx, addr, resp, "room", "me"); err != nil {
		t.Fatalf("complete: %v", err)
	}
	frame := bytes.Repeat([]byte{0xAB}, 3000) // three fragments
	if err := call.SendFrame(uint8(udpmedia.KindVideo), udpmedia.CodecH264, udpmedia.FlagKeyframe, 5, frame); err != nil {
		t.Fatal(err)
	}
	select {
	case f := <-call.Frames():
		if f.Src != 1 || !bytes.Equal(f.Data, frame) || !f.Keyframe {
			t.Fatalf("echoed frame wrong: src=%d len=%d", f.Src, len(f.Data))
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no frame came back")
	}
}

func TestMediaCallCompleteWithoutBeginFails(t *testing.T) {
	if err := NewMediaCall().Complete(context.Background(), "127.0.0.1:1", udpmedia.JoinResponse{}, "c", "u"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestMediaCallRejectsTamperedServerResponse(t *testing.T) {
	call := NewMediaCall()
	defer call.Close()
	req, _ := call.Begin()
	addr, resp := fakeServer(t, req, "room", "me")
	resp.ServerPub = "AAAA" // not a valid key
	if err := call.Complete(context.Background(), addr, resp, "room", "me"); err == nil {
		t.Fatal("accepted a malformed server key")
	}
}
