package com.cove.chat.data.udpmedia

/** One reassembled encoded audio, video or screen frame. */
class Frame(val id: Long, val kind: Kind, val codec: Int, val keyframe: Boolean, val ts: Long, val data: ByteArray)

object Fragmenter {
    /**
     * Splits an encoded frame into MEDIA plaintexts. [hdr] supplies kind, codec, flags, frame id and ts; fragment
     * fields are filled in. Returns null when the frame needs more than [Wire.MAX_FRAGMENTS] packets.
     */
    fun split(hdr: MediaHeader, frame: ByteArray, off: Int = 0, len: Int = frame.size): List<ByteArray>? {
        val cnt = maxOf(1, (len + Wire.MAX_FRAGMENT_PAYLOAD - 1) / Wire.MAX_FRAGMENT_PAYLOAD)
        if (cnt > Wire.MAX_FRAGMENTS) return null
        return List(cnt) { i ->
            val lo = off + i * Wire.MAX_FRAGMENT_PAYLOAD
            val hi = minOf(lo + Wire.MAX_FRAGMENT_PAYLOAD, off + len)
            MediaCodec.encode(hdr.copy(fragIdx = i, fragCnt = cnt), frame, lo, hi - lo)
        }
    }
}

/** What [Reassembler.poll] decided. */
class PollResult(val frames: List<Frame>, val nacks: List<NackItem>, val needKeyframe: Boolean)

/**
 * Turns the MEDIA packets of one stream (one sender and kind) back into frames in frame-id order, tolerating loss,
 * duplication and reordering (docs/udp-media.md section 7). Port of the Go `Reassembler`; times are milliseconds from
 * any monotonic clock. Not thread safe.
 */
class Reassembler(
    private val requireKeyframe: Boolean,
    private val maxLatencyMs: Long = 300,
    private val nackIntervalMs: Long = 40,
    private val nackAfterMs: Long = 20,
) {
    private class Partial(val hdr: MediaHeader, val frags: Array<ByteArray?>, val first: Long) {
        var got = 0
        var keyframe = hdr.keyframe
    }

    private var started = false
    private var waitKey = requireKeyframe
    private var next = 0L
    private val pending = HashMap<Long, Partial>()
    private var newerSeenAt = NONE // when a frame newer than `next` first arrived while `next` was missing entirely
    private var lastKeyReq = NONE
    private var lastWaitDropAt = NONE // last time a delta frame was dropped for lack of a keyframe
    private val lastNack = HashMap<Pair<Long, Int>, Long>()

    /** Frames currently buffered incomplete or out of order. */
    val pendingFrames: Int get() = pending.size

    /** Frame ids are 32-bit and wrap, so ordering is signed 32-bit distance. */
    private fun before(a: Long, b: Long): Boolean = (a - b).toInt() < 0
    private fun inc(v: Long): Long = (v + 1) and MASK32

    /** Adds one packet and returns any frames that became deliverable, in order. Bad or stale packets are ignored. */
    fun push(h: MediaHeader, payload: ByteArray, now: Long): List<Frame> {
        if (h.fragCnt == 0 || h.fragIdx >= h.fragCnt || h.fragCnt > Wire.MAX_FRAGMENTS) return emptyList()
        if (!started) { started = true; next = h.frameId }
        if (before(h.frameId, next)) return emptyList() // late or duplicate of something already delivered or skipped
        if (((h.frameId - next) and MASK32) > MAX_PENDING) resync(h.frameId) // long outage: do not buffer unboundedly
        var p = pending[h.frameId]
        if (p == null) { p = Partial(h, arrayOfNulls(h.fragCnt), now); pending[h.frameId] = p }
        if (h.fragCnt != p.frags.size || p.frags[h.fragIdx] != null) return emptyList()
        p.frags[h.fragIdx] = payload.copyOf()
        p.got++
        if (h.keyframe) p.keyframe = true
        val out = drain(now)
        if (pending.isNotEmpty() && pending[next] == null && newerSeenAt == NONE) newerSeenAt = now
        return out
    }

    private fun resync(id: Long) {
        next = id
        pending.clear()
        lastNack.clear()
        newerSeenAt = NONE
        if (requireKeyframe) waitKey = true
    }

    private fun drain(now: Long): List<Frame> {
        val out = ArrayList<Frame>()
        while (true) {
            val p = pending[next] ?: return out
            if (p.got != p.frags.size) return out
            pending.remove(next)
            val id = next
            next = inc(next)
            newerSeenAt = NONE
            if (waitKey && !p.keyframe) { lastWaitDropAt = now; continue } // cannot decode without the reference frame
            if (p.keyframe) waitKey = false
            var n = 0
            for (f in p.frags) n += f!!.size
            val data = ByteArray(n)
            var pos = 0
            for (f in p.frags) { System.arraycopy(f!!, 0, data, pos, f.size); pos += f.size }
            out.add(Frame(id, p.hdr.kind, p.hdr.codec, p.keyframe, p.hdr.ts, data))
        }
    }

    /**
     * Applies the timing policy: frames released by skipping hopeless gaps, NACK items worth re-requesting, and
     * whether to send a keyframe request now (at most one per 500 ms).
     */
    fun poll(now: Long): PollResult {
        if (!started) return PollResult(emptyList(), emptyList(), false)
        if (pending.isNotEmpty() && pending[next] == null && newerSeenAt == NONE) newerSeenAt = now
        val frames = ArrayList<Frame>()
        var skipped = false
        while (pending.isNotEmpty()) {
            val head = pending[next]
            val waited = when {
                head != null -> now - head.first
                newerSeenAt != NONE -> now - newerSeenAt
                else -> 0L
            }
            if (waited < maxLatencyMs) break
            pending.remove(next)
            next = inc(next)
            newerSeenAt = NONE
            skipped = true
            if (requireKeyframe) waitKey = true
            frames.addAll(drain(now))
            if (pending[next] == null && pending.isNotEmpty()) newerSeenAt = now
        }
        if (skipped && !requireKeyframe) skipped = false // audio is concealed, not resynchronised
        val nacks = collectNacks(now)
        var needKey = false
        // Unlike a bare pending check, a live stream that keeps delivering undecodable delta frames keeps asking (the
        // first request or its relayed keyframe may have been lost); a silent stream (camera off) does not.
        val starving = waitKey && requireKeyframe && (pending.isNotEmpty() || (lastWaitDropAt != NONE && now - lastWaitDropAt < 1000))
        if ((skipped || starving) && (lastKeyReq == NONE || now - lastKeyReq >= 500)) {
            lastKeyReq = now
            needKey = true
        }
        return PollResult(frames, nacks, needKey)
    }

    private fun collectNacks(now: Long): List<NackItem> {
        val out = ArrayList<NackItem>()
        fun add(it: NackItem) {
            val k = it.frameId to it.frag
            val t = lastNack[k]
            if (t != null && now - t < nackIntervalMs) return
            lastNack[k] = now
            out.add(it)
        }
        if (pending.isNotEmpty() && pending[next] == null && newerSeenAt != NONE && now - newerSeenAt >= nackAfterMs) {
            add(NackItem(next, Wire.ALL_FRAGMENTS))
        }
        val ids = pending.keys.sortedWith { a, b -> if (a == b) 0 else if (before(a, b)) -1 else 1 }
        for (id in ids) {
            val p = pending[id]!!
            if (p.got == p.frags.size || now - p.first < nackAfterMs) continue
            for (i in p.frags.indices) if (p.frags[i] == null) add(NackItem(id, i))
        }
        val capped = if (out.size > Wire.MAX_NACK_ITEMS) out.subList(0, Wire.MAX_NACK_ITEMS).toList() else out
        lastNack.keys.removeAll { before(it.first, next) } // forget bookkeeping for frames already delivered or skipped
        return capped
    }

    private companion object {
        const val NONE = Long.MIN_VALUE
        const val MASK32 = 0xFFFFFFFFL
        const val MAX_PENDING = 128L
    }
}
