package rtc

import (
	"errors"
	"io"

	"cove/backend/internal/logger"

	"github.com/pion/webrtc/v4"
)

// forwardTrack is the SFU's core loop: read RTP packets from one publisher's
// track and copy them, unmodified, into every current subscriber's local
// track. One goroutine per published track — with up to 10 participants x
// 3 tracks each, that's at most ~30 concurrent forwarders per room, each
// doing nothing but a blocking read and a handful of writes. No decoding,
// no encoding, no per-packet allocation beyond what ReadRTP itself does.
func forwardTrack(p *Participant, pt *publishedTrack) {
	defer logger.Debugf("rtc: forwarder for track %s stopped", pt.remote.ID())
	defer p.onTrackEnded(pt)

	for {
		select {
		case <-pt.stop:
			return
		default:
		}

		pkt, _, err := pt.remote.ReadRTP()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				logger.Debugf("rtc: track %s read ended: %v", pt.remote.ID(), err)
			}
			return
		}
		p.mgr.metricsState.packetsRead.Add(1)

		for _, lt := range pt.snapshotForwardTargets() {
			if writeErr := lt.WriteRTP(pkt); writeErr != nil && !errors.Is(writeErr, io.ErrClosedPipe) {
				logger.Debugf("rtc: forward write to %s failed: %v", lt.ID(), writeErr)
				continue
			}
			p.mgr.metricsState.packetsRelayed.Add(1)
			p.mgr.metricsState.bytesRelayed.Add(uint64(len(pkt.Payload)))
		}
	}
}

func (pt *publishedTrack) snapshotForwardTargets() []*webrtc.TrackLocalStaticRTP {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	targets := make([]*webrtc.TrackLocalStaticRTP, 0, len(pt.forward))
	for _, lt := range pt.forward {
		targets = append(targets, lt)
	}
	return targets
}

func (pt *publishedTrack) addSubscriber(userID string, lt *webrtc.TrackLocalStaticRTP, sender *webrtc.RTPSender) {
	pt.mu.Lock()
	pt.forward[userID] = lt
	pt.senders[userID] = sender
	pt.mu.Unlock()
}

func (pt *publishedTrack) removeSubscriber(userID string) (*webrtc.RTPSender, bool) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	sender, ok := pt.senders[userID]
	delete(pt.forward, userID)
	delete(pt.senders, userID)
	return sender, ok
}

func (pt *publishedTrack) snapshotSenders() map[string]*webrtc.RTPSender {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	out := make(map[string]*webrtc.RTPSender, len(pt.senders))
	for k, v := range pt.senders {
		out[k] = v
	}
	return out
}
