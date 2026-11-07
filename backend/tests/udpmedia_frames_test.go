package tests

import (
	"bytes"
	"math/rand"
	"testing"
	"time"

	"cove/udpmedia"
)

func mkFrame(n int, seed int64) []byte {
	b := make([]byte, n)
	rand.New(rand.NewSource(seed)).Read(b)
	return b
}

// pushAll feeds fragments of one frame into r and returns what was delivered.
func pushAll(t *testing.T, r *udpmedia.Reassembler, parts [][]byte, order []int, now time.Time) []udpmedia.Frame {
	t.Helper()
	var out []udpmedia.Frame
	for _, i := range order {
		h, payload, err := udpmedia.ParseMedia(parts[i])
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, r.Push(h, payload, now)...)
	}
	return out
}

func seq(n int) []int {
	o := make([]int, n)
	for i := range o {
		o[i] = i
	}
	return o
}

func TestUDPMedia_FragmentReassembleInOrderShuffledAndDuplicated(t *testing.T) {
	for _, size := range []int{0, 1, 1100, 1101, 5000, 64 * 1100} {
		data := mkFrame(size, int64(size))
		parts := udpmedia.Fragment(udpmedia.MediaHeader{Kind: udpmedia.KindVideo, Codec: udpmedia.CodecH264, Flags: udpmedia.FlagKeyframe, FrameID: 9, TS: 77}, data)
		if parts == nil {
			t.Fatalf("size %d: fragment returned nil", size)
		}
		for _, p := range parts {
			if len(p) > udpmedia.MaxPlaintext {
				t.Fatalf("fragment of %d bytes exceeds a packet", len(p))
			}
		}
		order := rand.New(rand.NewSource(1)).Perm(len(parts))
		dup := append(append([]int{}, order...), order...) // every fragment twice
		now := time.Now()
		for name, ord := range map[string][]int{"in order": seq(len(parts)), "shuffled": order, "duplicated": dup} {
			r := udpmedia.NewReassembler(true)
			got := pushAll(t, r, parts, ord, now)
			if len(got) != 1 || !bytes.Equal(got[0].Data, data) || got[0].ID != 9 || !got[0].Keyframe || got[0].TS != 77 || got[0].Codec != udpmedia.CodecH264 {
				t.Fatalf("size %d (%s): got %d frames", size, name, len(got))
			}
		}
	}
	if udpmedia.Fragment(udpmedia.MediaHeader{Kind: udpmedia.KindVideo}, make([]byte, 64*1100+1)) != nil {
		t.Fatal("a frame needing more than 64 fragments was accepted")
	}
}

func TestUDPMedia_ParseMediaRejectsMalformed(t *testing.T) {
	good := udpmedia.AppendMedia(nil, udpmedia.MediaHeader{Kind: udpmedia.KindAudio, FragCnt: 1}, []byte("x"))
	if _, _, err := udpmedia.ParseMedia(good); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(b []byte) []byte{
		"short":         func(b []byte) []byte { return b[:10] },
		"kind 0":        func(b []byte) []byte { b[2] = 0; return b },
		"kind 9":        func(b []byte) []byte { b[2] = 9; return b },
		"frag_cnt 0":    func(b []byte) []byte { b[12], b[13] = 0, 0; return b },
		"frag_cnt 65":   func(b []byte) []byte { b[12], b[13] = 0, 65; return b },
		"idx >= cnt":    func(b []byte) []byte { b[10], b[11] = 0, 1; return b },
		"payload large": func(b []byte) []byte { return append(b, make([]byte, udpmedia.MaxFragmentPayload)...) },
	}
	for name, mut := range cases {
		if _, _, err := udpmedia.ParseMedia(mut(append([]byte{}, good...))); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestUDPMedia_NackAndKeyframeCodecs(t *testing.T) {
	items := []udpmedia.NackItem{{FrameID: 1, Frag: 2}, {FrameID: 0xFFFFFFFF, Frag: udpmedia.AllFragments}}
	b := udpmedia.AppendNack(nil, 5, udpmedia.KindScreen, items)
	src, kind, got, err := udpmedia.ParseNack(b)
	if err != nil || src != 5 || kind != udpmedia.KindScreen || len(got) != 2 || got[1] != items[1] {
		t.Fatalf("nack round trip: %v %v %v %v", src, kind, got, err)
	}
	if _, _, _, err := udpmedia.ParseNack(b[:len(b)-1]); err == nil {
		t.Error("truncated nack accepted")
	}
	big := make([]udpmedia.NackItem, 100)
	if _, _, got, _ := udpmedia.ParseNack(udpmedia.AppendNack(nil, 1, udpmedia.KindAudio, big)); len(got) != udpmedia.MaxNackItems {
		t.Errorf("nack item cap: %d", len(got))
	}
	s, k, err := udpmedia.ParseKeyframeReq(udpmedia.AppendKeyframeReq(nil, 300, udpmedia.KindVideo))
	if err != nil || s != 300 || k != udpmedia.KindVideo {
		t.Error("keyframe request round trip")
	}
	if _, _, err := udpmedia.ParseKeyframeReq([]byte{0, 1, 77}); err == nil {
		t.Error("keyframe request with bad kind accepted")
	}
}

func frameParts(id uint32, n int, key bool) [][]byte {
	var flags uint8
	if key {
		flags = udpmedia.FlagKeyframe
	}
	return udpmedia.Fragment(udpmedia.MediaHeader{Kind: udpmedia.KindVideo, Codec: udpmedia.CodecVP8, Flags: flags, FrameID: id}, mkFrame(n, int64(id)))
}

func TestUDPMedia_ReassemblerNacksMissingFragmentThenRecovers(t *testing.T) {
	r := udpmedia.NewReassembler(true)
	t0 := time.Now()
	parts := frameParts(1, 4000, true) // 4 fragments
	pushAll(t, r, parts, []int{0, 1, 3}, t0)

	if _, nacks, _ := r.Poll(t0.Add(5 * time.Millisecond)); len(nacks) != 0 {
		t.Fatalf("NACK sent before the reorder grace period: %v", nacks)
	}
	_, nacks, _ := r.Poll(t0.Add(25 * time.Millisecond))
	if len(nacks) != 1 || nacks[0].FrameID != 1 || nacks[0].Frag != 2 {
		t.Fatalf("nacks = %v, want frame 1 frag 2", nacks)
	}
	if _, again, _ := r.Poll(t0.Add(30 * time.Millisecond)); len(again) != 0 {
		t.Fatalf("NACK repeated inside the interval: %v", again)
	}
	if _, again, _ := r.Poll(t0.Add(70 * time.Millisecond)); len(again) != 1 {
		t.Fatalf("NACK not repeated after the interval: %v", again)
	}
	got := pushAll(t, r, parts, []int{2}, t0.Add(80*time.Millisecond)) // the retransmission arrives
	if len(got) != 1 || !bytes.Equal(got[0].Data, mkFrame(4000, 1)) {
		t.Fatal("frame not recovered after retransmission")
	}
}

func TestUDPMedia_ReassemblerWholeFrameLossAndOrdering(t *testing.T) {
	r := udpmedia.NewReassembler(true)
	t0 := time.Now()
	if got := pushAll(t, r, frameParts(1, 500, true), []int{0}, t0); len(got) != 1 {
		t.Fatal("first keyframe not delivered")
	}
	// Frame 2 never arrives; frame 3 does and must be held back (decoding order), and frame 2 requested whole.
	if got := pushAll(t, r, frameParts(3, 500, false), []int{0}, t0.Add(time.Millisecond)); len(got) != 0 {
		t.Fatal("frame 3 delivered before frame 2")
	}
	_, nacks, _ := r.Poll(t0.Add(40 * time.Millisecond))
	if len(nacks) != 1 || nacks[0].FrameID != 2 || nacks[0].Frag != udpmedia.AllFragments {
		t.Fatalf("nacks = %v, want whole frame 2", nacks)
	}
	// The retransmission fills the gap: both frames are released in order.
	got := pushAll(t, r, frameParts(2, 500, false), []int{0}, t0.Add(50*time.Millisecond))
	if len(got) != 2 || got[0].ID != 2 || got[1].ID != 3 {
		t.Fatalf("released %v, want frames 2 then 3", got)
	}
}

func TestUDPMedia_ReassemblerGivesUpAndAsksForKeyframe(t *testing.T) {
	r := udpmedia.NewReassembler(true)
	t0 := time.Now()
	pushAll(t, r, frameParts(1, 500, true), []int{0}, t0)
	pushAll(t, r, frameParts(3, 500, false), []int{0}, t0.Add(time.Millisecond))
	frames, _, need := r.Poll(t0.Add(400 * time.Millisecond)) // frame 2 never came
	if !need {
		t.Fatal("no keyframe request after giving up on a frame")
	}
	if len(frames) != 0 {
		t.Fatal("a delta frame was delivered although its reference is missing")
	}
	if _, _, again := r.Poll(t0.Add(500 * time.Millisecond)); again {
		t.Fatal("keyframe request not rate limited")
	}
	// Delta frames stay suppressed until the keyframe arrives, then decoding resumes.
	if got := pushAll(t, r, frameParts(4, 500, false), []int{0}, t0.Add(520*time.Millisecond)); len(got) != 0 {
		t.Fatal("delta frame delivered while waiting for a keyframe")
	}
	got := pushAll(t, r, frameParts(5, 500, true), []int{0}, t0.Add(530*time.Millisecond))
	if len(got) != 1 || got[0].ID != 5 || !got[0].Keyframe {
		t.Fatalf("keyframe not delivered: %v", got)
	}
}

func TestUDPMedia_ReassemblerAudioSkipsWithoutKeyframe(t *testing.T) {
	r := udpmedia.NewReassembler(false)
	t0 := time.Now()
	audio := func(id uint32) [][]byte {
		return udpmedia.Fragment(udpmedia.MediaHeader{Kind: udpmedia.KindAudio, Codec: udpmedia.CodecOpus, FrameID: id}, mkFrame(80, int64(id)))
	}
	pushAll(t, r, audio(1), []int{0}, t0)
	pushAll(t, r, audio(3), []int{0}, t0)
	frames, _, need := r.Poll(t0.Add(400 * time.Millisecond))
	if need {
		t.Fatal("audio must never request a keyframe")
	}
	if len(frames) != 1 || frames[0].ID != 3 {
		t.Fatalf("audio frame 3 not released after the loss of frame 2: %v", frames)
	}
}

func TestUDPMedia_ReassemblerHandlesWraparoundLateAndDuplicates(t *testing.T) {
	r := udpmedia.NewReassembler(false)
	t0 := time.Now()
	one := func(id uint32) [][]byte {
		return udpmedia.Fragment(udpmedia.MediaHeader{Kind: udpmedia.KindAudio, Codec: udpmedia.CodecOpus, FrameID: id}, []byte{byte(id)})
	}
	var ids []uint32
	for _, id := range []uint32{0xFFFFFFFE, 0xFFFFFFFF, 0, 1} {
		for _, f := range pushAll(t, r, one(id), []int{0}, t0) {
			ids = append(ids, f.ID)
		}
	}
	if len(ids) != 4 || ids[2] != 0 || ids[3] != 1 {
		t.Fatalf("delivery across wraparound: %v", ids)
	}
	if got := pushAll(t, r, one(0xFFFFFFFF), []int{0}, t0); len(got) != 0 {
		t.Fatal("a late duplicate was delivered twice")
	}
}

func TestUDPMedia_ReassemblerBoundsMemoryUnderHugeGap(t *testing.T) {
	r := udpmedia.NewReassembler(true)
	t0 := time.Now()
	pushAll(t, r, frameParts(1, 100, true), []int{0}, t0)
	// A hostile or very late sender jumps far ahead with incomplete frames: pending state must stay bounded.
	for i := uint32(0); i < 10000; i++ {
		pushAll(t, r, frameParts(1000+i*2, 3000, false), []int{0}, t0)
	}
	if n := r.PendingFrames(); n > 129 {
		t.Fatalf("%d frames buffered", n)
	}
}
