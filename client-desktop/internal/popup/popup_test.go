package popup

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStackReplacesSameTagAndCapsSize(t *testing.T) {
	s := NewStack(3)
	s.Push(Item{ID: "1", Tag: "a", Title: "old"})
	s.Push(Item{ID: "2", Tag: "b"})
	got := s.Push(Item{ID: "3", Tag: "a", Title: "new"})
	if len(got) != 2 || got[0].ID != "2" || got[1].ID != "3" || got[1].Title != "new" {
		t.Fatalf("a repeated tag must replace the older popup and move to the newest slot, got %+v", got)
	}

	got = s.Push(Item{ID: "4"})
	if len(got) != 3 || got[0].ID != "2" || got[2].ID != "4" {
		t.Fatalf("beyond the cap the oldest popup is dropped, got %+v", got)
	}
}

func TestStackRemove(t *testing.T) {
	s := NewStack(5)
	s.Push(Item{ID: "1"})
	s.Push(Item{ID: "2"})
	if _, ok := s.Remove("nope"); ok {
		t.Fatal("removing an unknown id must report false")
	}
	it, ok := s.Remove("1")
	if !ok || it.ID != "1" || len(s.Items()) != 1 {
		t.Fatalf("remove = %+v %v, items %+v", it, ok, s.Items())
	}
}

func TestLayoutBottomRightDefault(t *testing.T) {
	work := Rect{X: 0, Y: 0, W: 1920, H: 1040}
	r := Layout(work, 2, BottomRight, 1)
	wantH := 2*CardHeight + Gap + 2*Padding + HeaderHeight
	if r.W != Width || r.H != wantH {
		t.Fatalf("size = %dx%d, want %dx%d", r.W, r.H, Width, wantH)
	}
	if r.X != 1920-Width-EdgeMargin || r.Y != 1040-wantH-EdgeMargin {
		t.Fatalf("position = %d,%d", r.X, r.Y)
	}
}

func TestLayoutFitsEveryVisibleCard(t *testing.T) {
	work := Rect{W: 1920, H: 1040}
	one := Layout(work, 1, BottomRight, 1)
	if one.H != CardHeight+2*Padding {
		t.Fatalf("one card has no header, height = %d", one.H)
	}
	three := Layout(work, MaxVisible, BottomRight, 1)
	want := 3*CardHeight + 2*Gap + HeaderHeight + 2*Padding
	if MaxVisible != 3 || three.H != want {
		t.Fatalf("three cards need %d px, got %d (max %d)", want, three.H, MaxVisible)
	}
	if three.H <= Layout(work, 2, BottomRight, 1).H {
		t.Fatal("each extra card must grow the window")
	}
	if three.Y+three.H+EdgeMargin != work.H {
		t.Fatalf("the stack stays anchored to the bottom edge: %+v", three)
	}
}

func TestStackClear(t *testing.T) {
	s := NewStack(3)
	s.Push(Item{ID: "1"})
	s.Push(Item{ID: "2"})
	got := s.Clear()
	if len(got) != 2 || len(s.Items()) != 0 {
		t.Fatalf("clear = %+v, left %+v", got, s.Items())
	}
}

func TestLayoutCornersAndScale(t *testing.T) {
	work := Rect{X: 100, Y: 50, W: 1000, H: 800}
	tl := Layout(work, 1, TopLeft, 2)
	if tl.X != 100+EdgeMargin*2 || tl.Y != 50+EdgeMargin*2 || tl.W != Width*2 {
		t.Fatalf("top-left at scale 2 = %+v", tl)
	}
	tr := Layout(work, 1, TopRight, 1)
	if tr.X != 100+1000-Width-EdgeMargin || tr.Y != 50+EdgeMargin {
		t.Fatalf("top-right = %+v", tr)
	}
	bl := Layout(work, 1, BottomLeft, 1)
	if bl.X != 100+EdgeMargin {
		t.Fatalf("bottom-left = %+v", bl)
	}
}

func TestLayoutNeverExceedsWorkArea(t *testing.T) {
	work := Rect{X: 0, Y: 0, W: 300, H: 200}
	r := Layout(work, 5, BottomRight, 1)
	if r.W > work.W || r.H > work.H || r.X < 0 || r.Y < 0 {
		t.Fatalf("popup %+v must stay inside %+v", r, work)
	}
}

func TestParseCorner(t *testing.T) {
	if ParseCorner("") != BottomRight || ParseCorner("bogus") != BottomRight {
		t.Fatal("unknown corners fall back to bottom-right")
	}
	if ParseCorner("top-left") != TopLeft {
		t.Fatal("top-left must parse")
	}
}

func TestSanitizeBoundsUntrustedFields(t *testing.T) {
	long := strings.Repeat("x", 5000)
	it := Sanitize(Request{Title: long, Body: long, Kind: "weird", Theme: "neon", Lang: "xx", TTLMs: 999999999})
	if len([]rune(it.Title)) > MaxTitleRunes || len([]rune(it.Body)) > MaxBodyRunes {
		t.Fatal("title and body must be truncated")
	}
	if it.Kind != KindMessage || it.Theme != "dark" {
		t.Fatalf("unknown kind/theme fall back to defaults, got %q %q", it.Kind, it.Theme)
	}
	if it.TTLMs != MaxTTL.Milliseconds() {
		t.Fatalf("ttl clamped to max, got %d", it.TTLMs)
	}
	if Sanitize(Request{Kind: KindCall}).TTLMs != DefaultCallTTL.Milliseconds() {
		t.Fatal("calls stay longer by default")
	}
	if Sanitize(Request{}).TTLMs != DefaultTTL.Milliseconds() {
		t.Fatal("default ttl")
	}
}

// ── manager ──────────────────────────────────────────────────────────────────

type fakeTransport struct {
	mu     sync.Mutex
	msgs   []Msg
	closed bool
}

func (f *fakeTransport) Send(m Msg) error { f.mu.Lock(); defer f.mu.Unlock(); f.msgs = append(f.msgs, m); return nil }
func (f *fakeTransport) Close()           { f.mu.Lock(); f.closed = true; f.mu.Unlock() }
func (f *fakeTransport) sent() []Msg      { f.mu.Lock(); defer f.mu.Unlock(); return append([]Msg(nil), f.msgs...) }

type harness struct {
	m        *Manager
	tr       *fakeTransport
	emit     func(Event)
	fallback []string
	clicks   []Item
	mu       sync.Mutex
	launches int
	failNext bool
}

func newHarness(t *testing.T, readyTimeout, idle time.Duration) *harness {
	t.Helper()
	h := &harness{}
	h.m = NewManager(Options{
		Launch: func(emit func(Event)) (Transport, error) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.launches++
			if h.failNext {
				return nil, errTest
			}
			h.tr = &fakeTransport{}
			h.emit = emit
			return h.tr, nil
		},
		Fallback: func(title, body string) { h.mu.Lock(); h.fallback = append(h.fallback, title+"|"+body); h.mu.Unlock() },
		OnClick:  func(it Item) { h.mu.Lock(); h.clicks = append(h.clicks, it); h.mu.Unlock() },
		ReadyTimeout: readyTimeout,
		IdleTimeout:  idle,
	})
	t.Cleanup(h.m.Close)
	return h
}

type testErr string

func (e testErr) Error() string { return string(e) }

const errTest = testErr("cannot launch")

func TestManagerFallsBackWhenLaunchFails(t *testing.T) {
	h := newHarness(t, time.Second, time.Minute)
	h.failNext = true
	h.m.Notify(Request{Title: "A", Body: "b"})
	if len(h.fallback) != 1 || h.fallback[0] != "A|b" {
		t.Fatalf("fallback = %v", h.fallback)
	}
}

func TestManagerQueuesUntilReadyThenFlushes(t *testing.T) {
	h := newHarness(t, time.Second, time.Minute)
	h.m.Notify(Request{Title: "A"})
	h.m.Notify(Request{Title: "B"})
	if len(h.tr.sent()) != 0 {
		t.Fatal("nothing is sent before the popup process reports ready")
	}
	h.emit(Event{Event: EventReady})
	sent := h.tr.sent()
	if len(sent) != 2 || sent[0].Op != OpShow || sent[0].Item.Title != "A" || sent[1].Item.Title != "B" {
		t.Fatalf("sent = %+v", sent)
	}
	h.m.Notify(Request{Title: "C"})
	if len(h.tr.sent()) != 3 {
		t.Fatal("once ready, notifications go straight through")
	}
	if h.launches != 1 {
		t.Fatalf("the process is reused, launches = %d", h.launches)
	}
}

func TestManagerFallsBackWhenNeverReady(t *testing.T) {
	h := newHarness(t, 30*time.Millisecond, time.Minute)
	h.m.Notify(Request{Title: "A", Body: "x"})
	time.Sleep(150 * time.Millisecond)
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.fallback) != 1 || h.fallback[0] != "A|x" {
		t.Fatalf("fallback = %v", h.fallback)
	}
	if !h.tr.closed {
		t.Fatal("the unresponsive process must be closed")
	}
}

func TestManagerFallsBackWhenProcessDiesBeforeReady(t *testing.T) {
	h := newHarness(t, time.Second, time.Minute)
	h.m.Notify(Request{Title: "A"})
	h.emit(Event{Event: EventExit})
	if len(h.fallback) != 1 {
		t.Fatalf("fallback = %v", h.fallback)
	}
	h.m.Notify(Request{Title: "B"})
	if h.launches != 2 {
		t.Fatalf("a dead process is relaunched, launches = %d", h.launches)
	}
}

func TestManagerClickReportsItemOnce(t *testing.T) {
	h := newHarness(t, time.Second, time.Minute)
	h.m.Notify(Request{Title: "A", ChannelID: "c1", Kind: KindMessage})
	h.emit(Event{Event: EventReady})
	id := h.tr.sent()[0].Item.ID
	h.emit(Event{Event: EventClick, ID: id})
	h.emit(Event{Event: EventClick, ID: id})
	if len(h.clicks) != 1 || h.clicks[0].ChannelID != "c1" {
		t.Fatalf("clicks = %+v", h.clicks)
	}
}

func TestManagerQuitsWhenIdle(t *testing.T) {
	h := newHarness(t, time.Second, 30*time.Millisecond)
	h.m.Notify(Request{Title: "A"})
	h.emit(Event{Event: EventReady})
	time.Sleep(150 * time.Millisecond)
	sent := h.tr.sent()
	if sent[len(sent)-1].Op != OpQuit || !h.tr.closed {
		t.Fatalf("idle process must be told to quit, sent %+v", sent)
	}
	h.m.Notify(Request{Title: "B"})
	if h.launches != 2 {
		t.Fatalf("relaunch after idle quit, launches = %d", h.launches)
	}
}

func TestReadEventsSkipsNoise(t *testing.T) {
	in := "wails log line\n{\"event\":\"ready\"}\n\n{\"event\":\"click\",\"id\":\"7\"}\nnot json {\n"
	var got []Event
	ReadEvents(bytes.NewBufferString(in), func(e Event) { got = append(got, e) })
	if len(got) != 2 || got[0].Event != EventReady || got[1].ID != "7" {
		t.Fatalf("events = %+v", got)
	}
}
