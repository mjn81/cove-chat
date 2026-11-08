// Package popup holds the platform-independent parts of Cove's custom notification popups (Windows and Linux):
// the stack of visible popups, where they sit on screen, the protocol spoken between the main app and the popup
// process, and the manager that launches that process and falls back to the system notification if it fails.
//
// Wails 2 has a single window per process, so the popups live in a second, tiny Wails process (the same
// executable started with --notif-popup) that the main process feeds over a pipe. Nothing here touches the GUI,
// which keeps it testable.
package popup

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Flag is the command-line argument that starts the popup process instead of the app.
const Flag = "--notif-popup"

// Notification kinds. They decide the default lifetime and what clicking the popup opens.
const (
	KindMessage = "message"
	KindCall    = "call"
	KindWhisper = "whisper"
)

// Geometry in device-independent pixels (multiplied by the display scale on screen).
const (
	Width      = 360
	CardHeight = 76
	Gap        = 4
	// HeaderHeight is the full-width "Close all" button above the cards (followed by one Gap), shown from
	// HeaderMinCards cards up.
	HeaderHeight   = 32
	HeaderMinCards = 2
	Padding        = 0
	EdgeMargin     = 12
	// MaxVisible is how many popups stack before the oldest is dropped.
	MaxVisible = 3
)

// Lifetimes. The popup UI runs the timer (it knows about hover); the values travel with the item.
const (
	DefaultTTL     = 6 * time.Second
	DefaultCallTTL = 30 * time.Second
	MaxTTL         = 60 * time.Second
)

// Bounds on untrusted text, so one huge message cannot blow up the window.
const (
	MaxTitleRunes = 120
	MaxBodyRunes  = 300
	// MaxSubtitleRunes bounds the secondary line (the channel).
	MaxSubtitleRunes = 120
	// MaxAvatarBytes bounds the sender's avatar data URL; the web client sends a ~64 px thumbnail.
	MaxAvatarBytes = 48 * 1024
	// Tones is the number of letter-avatar colours the popup page defines.
	Tones = 5
)

// avatarPrefixes are the only data URLs accepted as an avatar: raster images, never SVG or anything scriptable.
var avatarPrefixes = []string{"data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,"}

// Rect is a rectangle in screen pixels.
type Rect struct{ X, Y, W, H int }

// Corner is the screen corner the popups stack from.
type Corner string

// Supported corners.
const (
	BottomRight Corner = "bottom-right"
	BottomLeft  Corner = "bottom-left"
	TopRight    Corner = "top-right"
	TopLeft     Corner = "top-left"
)

// ParseCorner maps a saved setting to a corner, defaulting to the bottom-right.
func ParseCorner(s string) Corner {
	switch c := Corner(s); c {
	case BottomRight, BottomLeft, TopRight, TopLeft:
		return c
	}
	return BottomRight
}

// Request is what the web client sends: the text to show plus the context needed to render and route it.
// It carries only what the system notification would have shown.
type Request struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	// Subtitle is secondary context shown after the title, such as "#channel".
	Subtitle string `json:"subtitle"`
	// Avatar is the sender's photo as a small image data URL. Without one the popup draws Initial on a Tone
	// colour; with neither (or System) it shows the Cove icon, which is reserved for Cove's own notices.
	Avatar    string `json:"avatar"`
	Initial   string `json:"initial"`
	Tone      int    `json:"tone"`
	System    bool   `json:"system"`
	Kind      string `json:"kind"`
	ChannelID string `json:"channel_id"`
	// Tag makes a newer popup replace an older one (e.g. several messages from one chat).
	Tag string `json:"tag"`
	// Theme is "light" or "dark", Lang the UI language: the popup is a separate web view with no access to the
	// app's settings, so the main window passes them along.
	Theme string `json:"theme"`
	Lang  string `json:"lang"`
	// Tokens are the active theme's resolved colours (CSS custom property name without "--" -> "H S% L%"), so the
	// popup can match a custom theme. Empty for the default look.
	Tokens map[string]string `json:"tokens,omitempty"`
	TTLMs  int64             `json:"ttl_ms"`
}

// Item is a popup on screen: a sanitised Request with an id.
type Item struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Subtitle  string `json:"subtitle,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Initial   string `json:"initial,omitempty"`
	Tone      int    `json:"tone"`
	System    bool   `json:"system,omitempty"`
	Kind      string `json:"kind"`
	ChannelID string `json:"channel_id,omitempty"`
	Tag       string `json:"tag,omitempty"`
	Theme     string `json:"theme"`
	Lang      string `json:"lang"`
	// Tokens: see Request.Tokens; already filtered by Sanitize.
	Tokens map[string]string `json:"tokens,omitempty"`
	// Dir is the text direction of the popup's chrome: "rtl" for Arabic.
	Dir string `json:"dir"`
	// Corner is the screen corner the stack sits in; the popup page slides cards in from that side.
	Corner string `json:"corner,omitempty"`
	TTLMs  int64  `json:"ttl_ms"`
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// Sanitize bounds and normalises a Request. The id is assigned by the manager.
func Sanitize(r Request) Item {
	it := Item{
		Title:     truncate(r.Title, MaxTitleRunes),
		Body:      truncate(r.Body, MaxBodyRunes),
		Subtitle:  truncate(r.Subtitle, MaxSubtitleRunes),
		Initial:   truncate(r.Initial, 1),
		System:    r.System,
		Avatar:    validAvatar(r.Avatar),
		Kind:      r.Kind,
		ChannelID: truncate(r.ChannelID, 64),
		Tag:       truncate(r.Tag, 96),
		Theme:     "dark",
		Lang:      "en",
		Dir:       "ltr",
	}
	if r.Tone > 0 && r.Tone < Tones {
		it.Tone = r.Tone
	}
	switch it.Kind {
	case KindMessage, KindCall, KindWhisper:
	default:
		it.Kind = KindMessage
	}
	if r.Theme == "light" {
		it.Theme = "light"
	}
	it.Tokens = sanitizeTokens(r.Tokens)
	switch r.Lang {
	case "fa", "ar":
		it.Lang = r.Lang
	}
	if it.Lang == "ar" {
		it.Dir = "rtl"
	}
	ttl := time.Duration(r.TTLMs) * time.Millisecond
	if ttl <= 0 {
		ttl = DefaultTTL
		if it.Kind == KindCall {
			ttl = DefaultCallTTL
		}
	}
	if ttl > MaxTTL {
		ttl = MaxTTL
	}
	it.TTLMs = ttl.Milliseconds()
	return it
}

// MaxThemeTokens bounds how many theme colours a popup request may carry (the web client defines 28).
const MaxThemeTokens = 40

var (
	tokenNameRE  = regexp.MustCompile(`^[a-z]+(-[a-z]+){0,3}$`)
	tokenValueRE = regexp.MustCompile(`^\d{1,3}(\.\d{1,2})? \d{1,3}(\.\d{1,2})?% \d{1,3}(\.\d{1,2})?%$`)
)

// sanitizeTokens keeps only entries shaped like theme colours: a lowercase dashed name and an "H S% L%" triplet.
// The popup page applies them with style.setProperty after validating them again; this keeps hostile or garbled
// values from travelling any further. Returns nil when nothing survives.
func sanitizeTokens(in map[string]string) map[string]string {
	var out map[string]string
	for name, value := range in {
		if len(out) >= MaxThemeTokens {
			break
		}
		if len(name) > 40 || !tokenNameRE.MatchString(name) || !tokenValueRE.MatchString(value) {
			continue
		}
		if out == nil {
			out = make(map[string]string)
		}
		out[name] = value
	}
	return out
}

// validAvatar returns the avatar data URL if it is a small raster image, otherwise "".
func validAvatar(s string) string {
	if len(s) > MaxAvatarBytes {
		return ""
	}
	for _, p := range avatarPrefixes {
		if strings.HasPrefix(s, p) {
			return s
		}
	}
	return ""
}

// Stack is the ordered set of visible popups, oldest first.
type Stack struct {
	max   int
	items []Item
}

// NewStack creates a stack holding at most max popups.
func NewStack(max int) *Stack { return &Stack{max: max} }

// Push adds a popup as the newest. An older popup with the same non-empty tag is replaced, and the oldest is
// dropped when the stack is full. It returns the resulting list.
func (s *Stack) Push(it Item) []Item {
	if it.Tag != "" {
		s.items = filter(s.items, func(o Item) bool { return o.Tag != it.Tag })
	}
	s.items = append(s.items, it)
	if over := len(s.items) - s.max; over > 0 {
		s.items = s.items[over:]
	}
	return s.Items()
}

// Remove drops a popup by id and returns it.
func (s *Stack) Remove(id string) (Item, bool) {
	for i, it := range s.items {
		if it.ID == id {
			s.items = append(s.items[:i:i], s.items[i+1:]...)
			return it, true
		}
	}
	return Item{}, false
}

// Clear removes every popup and returns them.
func (s *Stack) Clear() []Item {
	out := s.items
	s.items = nil
	return out
}

// Items returns a copy of the visible popups, oldest first.
func (s *Stack) Items() []Item { return append([]Item(nil), s.items...) }

func filter(in []Item, keep func(Item) bool) []Item {
	out := make([]Item, 0, len(in))
	for _, it := range in {
		if keep(it) {
			out = append(out, it)
		}
	}
	return out
}

// Layout returns the window rectangle for n stacked popups inside a work area (the screen minus taskbars and
// panels), anchored to a corner. scale is the display scale factor (1 = 96 dpi).
func Layout(work Rect, n int, corner Corner, scale float64) Rect {
	if n < 1 {
		n = 1
	}
	px := func(v int) int { return int(float64(v)*scale + 0.5) }
	w := px(Width)
	h := px(2*Padding) + n*px(CardHeight) + (n-1)*px(Gap)
	if n >= HeaderMinCards {
		h += px(HeaderHeight) + px(Gap)
	}
	margin := px(EdgeMargin)
	if w > work.W {
		w = work.W
	}
	if h > work.H {
		h = work.H
	}
	r := Rect{W: w, H: h}
	switch corner {
	case BottomLeft, TopLeft:
		r.X = work.X + margin
	default:
		r.X = work.X + work.W - w - margin
	}
	switch corner {
	case TopLeft, TopRight:
		r.Y = work.Y + margin
	default:
		r.Y = work.Y + work.H - h - margin
	}
	if r.X < work.X {
		r.X = work.X
	}
	if r.Y < work.Y {
		r.Y = work.Y
	}
	return r
}

// ── protocol ─────────────────────────────────────────────────────────────────

// Operations the main process sends to the popup process.
const (
	OpShow = "show"
	OpQuit = "quit"
)

// Msg is a command from the main process to the popup process (one JSON object per line on its stdin).
type Msg struct {
	Op   string `json:"op"`
	Item Item   `json:"item,omitempty"`
}

// Events the popup process reports (one JSON object per line on its stdout).
const (
	EventReady   = "ready"
	EventClick   = "click"
	EventDismiss = "dismiss"
	// EventExit is synthesised by the launcher when the process ends.
	EventExit = "exit"
)

// Event is a report from the popup process.
type Event struct {
	Event string `json:"event"`
	ID    string `json:"id,omitempty"`
}

// ReadEvents decodes events from r until it ends. Lines that are not JSON objects (the web view runtime may log
// to stdout) are ignored.
func ReadEvents(r io.Reader, handle func(Event)) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 4096), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var e Event
		if json.Unmarshal([]byte(line), &e) == nil && e.Event != "" {
			handle(e)
		}
	}
}

// ── manager ──────────────────────────────────────────────────────────────────

// Transport is the channel to a running popup process.
type Transport interface {
	Send(Msg) error
	// Close stops the process; it is safe to call more than once.
	Close()
}

// Options configures a Manager.
type Options struct {
	// Launch starts the popup process. emit must be called for each event it reports, and with EventExit when it
	// ends.
	Launch func(emit func(Event)) (Transport, error)
	// Fallback shows a system notification. It is used whenever the popup cannot be shown.
	Fallback func(title, body string)
	// OnClick is called when the user clicks a popup.
	OnClick func(Item)
	// ReadyTimeout is how long to wait for a freshly launched process before falling back.
	ReadyTimeout time.Duration
	// IdleTimeout is how long the process stays alive with no new notification; it holds a web view, which is
	// not free.
	IdleTimeout time.Duration
}

// Manager owns the popup process: it launches it lazily, queues notifications while it starts, routes clicks,
// stops it when idle and falls back to the system notification on any failure.
type Manager struct {
	opts Options

	mu      sync.Mutex
	tr      Transport
	gen     int
	ready   bool
	pending []Item
	live    map[string]Item
	readyT  *time.Timer
	idleT   *time.Timer
	nextID  atomic.Uint64
	closed  bool
}

// NewManager creates a manager; nothing is launched until the first Notify.
func NewManager(o Options) *Manager {
	if o.ReadyTimeout <= 0 {
		o.ReadyTimeout = 8 * time.Second
	}
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = 3 * time.Minute
	}
	return &Manager{opts: o, live: map[string]Item{}}
}

// Notify shows a popup, or the system notification when that is not possible.
func (m *Manager) Notify(r Request) {
	it := Sanitize(r)
	it.ID = fmt.Sprintf("n%d", m.nextID.Add(1))

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		m.opts.Fallback(it.Title, it.Body)
		return
	}
	if m.tr == nil {
		gen := m.gen + 1
		tr, err := m.opts.Launch(func(e Event) { m.handle(gen, e) })
		if err != nil {
			m.mu.Unlock()
			m.opts.Fallback(it.Title, it.Body)
			return
		}
		m.gen, m.tr, m.ready = gen, tr, false
		m.readyT = time.AfterFunc(m.opts.ReadyTimeout, func() { m.readyTimeout(gen) })
	}
	if !m.ready {
		m.pending = append(m.pending, it)
		m.mu.Unlock()
		return
	}
	err := m.sendLocked(it)
	var failed []Item
	if err != nil {
		failed = m.dropLocked(it)
	}
	m.mu.Unlock()
	for _, f := range failed {
		m.opts.Fallback(f.Title, f.Body)
	}
}

// sendLocked delivers one item to a ready process and re-arms the idle timer.
func (m *Manager) sendLocked(it Item) error {
	if err := m.tr.Send(Msg{Op: OpShow, Item: it}); err != nil {
		return err
	}
	m.live[it.ID] = it
	m.armIdleLocked()
	return nil
}

func (m *Manager) armIdleLocked() {
	if m.idleT != nil {
		m.idleT.Stop()
	}
	gen := m.gen
	m.idleT = time.AfterFunc(m.opts.IdleTimeout, func() { m.idle(gen) })
}

// dropLocked discards the current process and returns the items that never reached the screen.
func (m *Manager) dropLocked(extra ...Item) []Item {
	lost := append(append([]Item(nil), m.pending...), extra...)
	if m.readyT != nil {
		m.readyT.Stop()
	}
	if m.idleT != nil {
		m.idleT.Stop()
	}
	if m.tr != nil {
		m.tr.Close()
	}
	m.tr, m.ready, m.pending = nil, false, nil
	m.live = map[string]Item{}
	return lost
}

func (m *Manager) handle(gen int, e Event) {
	m.mu.Lock()
	if gen != m.gen || m.tr == nil {
		m.mu.Unlock()
		return
	}
	switch e.Event {
	case EventReady:
		if m.ready {
			m.mu.Unlock()
			return
		}
		m.ready = true
		if m.readyT != nil {
			m.readyT.Stop()
		}
		pending := m.pending
		m.pending = nil
		var lost []Item
		for i, it := range pending {
			if err := m.sendLocked(it); err != nil {
				lost = append(lost, pending[i:]...)
				lost = append(lost, m.dropLocked()...)
				break
			}
		}
		m.mu.Unlock()
		for _, f := range lost {
			m.opts.Fallback(f.Title, f.Body)
		}
	case EventClick:
		it, ok := m.live[e.ID]
		delete(m.live, e.ID)
		m.mu.Unlock()
		if ok && m.opts.OnClick != nil {
			m.opts.OnClick(it)
		}
	case EventDismiss:
		delete(m.live, e.ID)
		m.mu.Unlock()
	case EventExit:
		lost := m.dropLocked()
		m.mu.Unlock()
		for _, f := range lost {
			m.opts.Fallback(f.Title, f.Body)
		}
	default:
		m.mu.Unlock()
	}
}

func (m *Manager) readyTimeout(gen int) {
	m.mu.Lock()
	if gen != m.gen || m.ready || m.tr == nil {
		m.mu.Unlock()
		return
	}
	lost := m.dropLocked()
	m.mu.Unlock()
	for _, f := range lost {
		m.opts.Fallback(f.Title, f.Body)
	}
}

func (m *Manager) idle(gen int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen != m.gen || m.tr == nil || !m.ready {
		return
	}
	_ = m.tr.Send(Msg{Op: OpQuit})
	m.dropLocked()
}

// Close stops the popup process. Later notifications use the fallback.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	if m.tr != nil && m.ready {
		_ = m.tr.Send(Msg{Op: OpQuit})
	}
	m.dropLocked()
}
