package rtc

import (
	"sync/atomic"
	"time"

	"cove/backend/internal/logger"
)

// metrics holds process-wide SFU counters. Forwarding is the hot path (one
// increment per RTP packet relayed to each subscriber), so these are plain
// atomics rather than anything mutex-guarded — no lock contention added to
// the very path we built this whole package to keep cheap.
type metrics struct {
	joinsTotal     atomic.Uint64
	joinsRejected  atomic.Uint64 // not-a-member, over-capacity, or already-in-a-call
	packetsRead    atomic.Uint64 // RTP packets read from publishers
	packetsRelayed atomic.Uint64 // RTP packets written to subscribers (fan-out sum)
	bytesRelayed   atomic.Uint64 // payload bytes written to subscribers (fan-out sum)
}

// Stats is a point-in-time snapshot of SFU load and cumulative throughput,
// suitable for logging or exposing via an admin/metrics endpoint.
type Stats struct {
	Rooms           int    `json:"rooms"`
	Participants    int    `json:"participants"`
	PublishedTracks int    `json:"published_tracks"`
	JoinsTotal      uint64 `json:"joins_total"`
	JoinsRejected   uint64 `json:"joins_rejected"`
	PacketsRead     uint64 `json:"packets_read"`
	PacketsRelayed  uint64 `json:"packets_relayed"`
	BytesRelayed    uint64 `json:"bytes_relayed"`
}

// Stats returns a current snapshot. Safe to call at any time, including
// concurrently with active calls.
func (m *Manager) Stats() Stats {
	m.mu.RLock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		rooms = append(rooms, r)
	}
	m.mu.RUnlock()

	participants, tracks := 0, 0
	for _, r := range rooms {
		ps := r.participantsSnapshot()
		participants += len(ps)
		for _, p := range ps {
			p.mu.Lock()
			tracks += len(p.publishedTracks)
			p.mu.Unlock()
		}
	}

	return Stats{
		Rooms:           len(rooms),
		Participants:    participants,
		PublishedTracks: tracks,
		JoinsTotal:      m.metricsState.joinsTotal.Load(),
		JoinsRejected:   m.metricsState.joinsRejected.Load(),
		PacketsRead:     m.metricsState.packetsRead.Load(),
		PacketsRelayed:  m.metricsState.packetsRelayed.Load(),
		BytesRelayed:    m.metricsState.bytesRelayed.Load(),
	}
}

// runStatsLogger periodically logs a Stats snapshot until stopped, but only
// while there's actually a call in progress — an idle server shouldn't
// spam logs every interval forever.
func (m *Manager) runStatsLogger(interval time.Duration, stop <-chan struct{}) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s := m.Stats()
			if s.Rooms == 0 {
				continue
			}
			logger.Infof("rtc: stats rooms=%d participants=%d tracks=%d packets_relayed=%d bytes_relayed=%d joins_total=%d joins_rejected=%d",
				s.Rooms, s.Participants, s.PublishedTracks, s.PacketsRelayed, s.BytesRelayed, s.JoinsTotal, s.JoinsRejected)
		}
	}
}
