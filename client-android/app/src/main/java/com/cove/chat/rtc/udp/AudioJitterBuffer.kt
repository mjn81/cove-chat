package com.cove.chat.rtc.udp

import java.util.TreeMap

/** What the playout clock should do for the next 20 ms. */
sealed interface PlayoutStep {
    /** Decode and play this packet. */
    class Packet(val id: Long, val data: ByteArray) : PlayoutStep

    /** The expected frame never arrived but the next one did: rebuild the lost frame from its in-band FEC data. */
    class Recover(val nextData: ByteArray) : PlayoutStep

    /** The expected frame is missing and nothing newer helps: run packet loss concealment. */
    object Conceal : PlayoutStep

    /** Nothing to play (filling the buffer, or the sender is silent): output silence. */
    object Silence : PlayoutStep
}

/**
 * Reorders and paces the Opus frames of one sender for a fixed 20 ms playout clock (the "jitter buffer" of
 * docs/udp-media.md section 10). The UDP client's [com.cove.chat.data.udpmedia.Reassembler] already delivers audio
 * frames in id order and gives up on gaps after 300 ms; this buffer smooths arrival jitter.
 *
 * It starts playing once [targetPackets] frames are queued, so ordinary network jitter does not cause glitches, and
 * after running dry it re-buffers instead of stuttering. If it grows beyond [maxPackets] (a burst after a stall) the
 * oldest frames are dropped so latency cannot creep up. Not thread safe: the mixer thread owns it.
 */
class AudioJitterBuffer(private val targetPackets: Int = 3, private val maxPackets: Int = 10) {
    private val queue = TreeMap<Long, ByteArray>()
    private var playing = false
    private var nextId = 0L

    /** Frames currently queued. */
    val size: Int get() = queue.size

    /** Queues a frame. Frames older than what already played are ignored. */
    fun push(id: Long, data: ByteArray) {
        if (playing && id < nextId) return
        queue[id] = data
        while (queue.size > maxPackets) {
            queue.pollFirstEntry()
            if (playing) nextId = queue.firstKey()
        }
    }

    /** Advances the playout clock by one frame. */
    fun pull(): PlayoutStep {
        if (!playing) {
            if (queue.size < targetPackets) return PlayoutStep.Silence
            playing = true
            nextId = queue.firstKey()
        }
        if (queue.isEmpty()) {
            playing = false // underrun: re-buffer
            return PlayoutStep.Silence
        }
        // After a long outage the ids jump; skip ahead instead of concealing the whole gap.
        val first = queue.firstKey()
        if (first - nextId > MAX_GAP) nextId = first
        val head = queue[nextId]
        if (head != null) {
            queue.remove(nextId)
            return PlayoutStep.Packet(nextId++, head)
        }
        // Something newer exists but `nextId` does not: it is lost (the reassembler already waited for it).
        val following = queue[nextId + 1]
        nextId++
        return if (following != null) PlayoutStep.Recover(following) else PlayoutStep.Conceal
    }

    /** Forgets everything (the participant left or we rejoined). */
    fun reset() {
        queue.clear()
        playing = false
    }

    private companion object {
        const val MAX_GAP = 5L
    }
}
