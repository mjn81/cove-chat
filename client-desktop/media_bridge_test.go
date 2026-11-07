package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"sync"
	"testing"
	"time"

	"cove/udpmedia"
)

func TestPackBatchFixture(t *testing.T) {
	// Record layout: src u16, kind u8, codec u8, flags u8, ts u32, len u32, data. Pinned in client-web media-batch.test.ts.
	got := PackFrames([]PackedFrame{
		{Src: 7, Kind: 1, Codec: 1, Flags: 0, TS: 9, Data: []byte("abc")},
		{Src: 258, Kind: 3, Codec: 3, Flags: 1, TS: 1, Data: nil},
	})
	want, _ := hex.DecodeString("0007010100" + "00000009" + "00000003" + "616263" + "0102" + "03030100000001" + "00000000")
	if !bytes.Equal(got, want) {
		t.Fatalf("pack = %x, want %x", got, want)
	}
	back, err := UnpackFrames(got)
	if err != nil || len(back) != 2 || back[0].Src != 7 || string(back[0].Data) != "abc" || back[1].Src != 258 || back[1].Kind != 3 {
		t.Fatalf("unpack = %+v, %v", back, err)
	}
}

func TestUnpackRejectsTruncated(t *testing.T) {
	good := PackFrames([]PackedFrame{{Src: 1, Kind: 1, Codec: 1, TS: 1, Data: []byte("hello")}})
	for n := 1; n < len(good); n++ {
		if _, err := UnpackFrames(good[:n]); err == nil {
			t.Fatalf("accepted truncated batch of %d bytes", n)
		}
	}
}

func TestMediaBridgeEchoEmitsBatches(t *testing.T) {
	var mu sync.Mutex
	var batches []string
	b := NewMediaBridge(func(event string, data ...any) {
		if event != EventMediaFrames {
			return
		}
		mu.Lock()
		batches = append(batches, data[0].(string))
		mu.Unlock()
	})
	defer b.Close()
	req, err := b.Begin()
	if err != nil {
		t.Fatal(err)
	}
	addr, resp := fakeServer(t, req, "room", "me")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := b.call.Complete(ctx, addr, resp, "room", "me"); err != nil {
		t.Fatal(err)
	}
	b.startPumps()

	payload := bytes.Repeat([]byte{7}, 2500)
	batch := PackFrames([]PackedFrame{{Kind: uint8(udpmedia.KindVideo), Codec: udpmedia.CodecH264, Flags: udpmedia.FlagKeyframe, TS: 5, Data: payload}})
	if err := b.SendFrames(base64.StdEncoding.EncodeToString(batch)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(batches)
		mu.Unlock()
		if n > 0 {
			raw, _ := base64.StdEncoding.DecodeString(batches[0])
			fr, err := UnpackFrames(raw)
			if err != nil || len(fr) != 1 || !bytes.Equal(fr[0].Data, payload) || fr[0].Src != 1 || fr[0].Flags&udpmedia.FlagKeyframe == 0 {
				t.Fatalf("bad echoed batch: %v %+v", err, fr)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no media:frames event")
}

func TestSendFramesRejectsGarbage(t *testing.T) {
	b := NewMediaBridge(func(string, ...any) {})
	if err := b.SendFrames("!!notbase64"); err == nil {
		t.Fatal("expected error")
	}
}
