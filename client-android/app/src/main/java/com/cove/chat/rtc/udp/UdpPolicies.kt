package com.cove.chat.rtc.udp

/**
 * Sender back-off for the UDP path (docs/udp-media.md section 7). There is no bandwidth estimator in protocol v1, so
 * the only congestion signals are the receivers' keyframe requests that reach us and downlink NACK/loss counters:
 * a window with several of them steps the outgoing video down one level, and a run of calm windows steps it back up.
 * Pure, so the thresholds are unit tested.
 */
class BackoffController(
    private val maxLevel: Int = 3,
    private val stepDownAt: Int = 3,
    private val calmWindowsToRecover: Int = 5,
) {
    var level: Int = 0
        private set
    private var calm = 0

    /** Feeds the number of loss signals seen in the last window; returns the (possibly changed) level. */
    fun sample(lossSignals: Int): Int {
        if (lossSignals >= stepDownAt) {
            calm = 0
            if (level < maxLevel) level++
        } else if (lossSignals == 0 && level > 0) {
            if (++calm >= calmWindowsToRecover) { level--; calm = 0 }
        } else {
            calm = 0
        }
        return level
    }

    fun reset() { level = 0; calm = 0 }

    companion object {
        private val BITRATE = doubleArrayOf(1.0, 0.6, 0.35, 0.2)
        private val FPS = doubleArrayOf(1.0, 0.8, 0.6, 0.5)
        private val SCALE = doubleArrayOf(1.0, 1.0, 1.5, 2.0)

        /** Bitrate to encode at for the preset [bitrate] at [level]. */
        fun bitrateFor(bitrate: Int, level: Int): Int = (bitrate * BITRATE[level.coerceIn(0, 3)]).toInt()
        fun fpsFor(fps: Int, level: Int): Int = maxOf(5, (fps * FPS[level.coerceIn(0, 3)]).toInt())
        /** Divisor for the capture size (camera only; screen text stays readable, frames drop first). */
        fun scaleFor(level: Int): Double = SCALE[level.coerceIn(0, 3)]
    }
}

/** Keyframe pacing so many requests cannot make an encoder emit nothing but keyframes (same rule as the desktop client). */
class KeyframeLimiter(private val minIntervalMs: Long = 500) {
    private var lastAt = Long.MIN_VALUE

    /** True if a keyframe may be produced now; records it when allowed. */
    fun allow(nowMs: Long): Boolean {
        if (lastAt != Long.MIN_VALUE && nowMs - lastAt < minIntervalMs) return false
        lastAt = nowMs
        return true
    }
}

/** Routes the server-stamped `media_id` of incoming media to a user id and back (from the `call_*` roster events). */
class MediaDirectory {
    private val byMedia = HashMap<Int, String>()
    private val byUser = HashMap<String, Int>()

    @Synchronized fun put(mediaId: Int, userId: String) {
        byUser.remove(userId)?.let { byMedia.remove(it) }
        byMedia.remove(mediaId)?.let { byUser.remove(it) }
        byMedia[mediaId] = userId
        byUser[userId] = mediaId
    }

    @Synchronized fun userOf(mediaId: Int): String? = byMedia[mediaId]
    @Synchronized fun mediaOf(userId: String): Int? = byUser[userId]
    @Synchronized fun remove(userId: String) { byUser.remove(userId)?.let { byMedia.remove(it) } }
    @Synchronized fun clear() { byMedia.clear(); byUser.clear() }
    @Synchronized fun users(): Set<String> = byUser.keys.toSet()
}

/** Speaking indicator with a short hang time so it does not flicker (same idea as the WebRTC engine). */
class SpeakingTracker(private val hangTicks: Int = 2) {
    private val hang = HashMap<String, Int>()

    /** [active] are the users above the level threshold in this tick; returns everyone who should be shown as speaking. */
    fun tick(active: Set<String>): Set<String> {
        for (u in active) hang[u] = hangTicks
        val shown = HashSet<String>()
        val it = hang.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (e.key in active) { shown.add(e.key); continue }
            if (e.value <= 1) it.remove() else { e.setValue(e.value - 1); shown.add(e.key) }
        }
        return shown
    }

    fun clear() = hang.clear()

    companion object {
        /** RMS of 16-bit PCM normalised to 0..1. */
        fun level(pcm: ShortArray, n: Int): Double {
            if (n <= 0) return 0.0
            var sum = 0.0
            for (i in 0 until n) { val v = pcm[i] / 32768.0; sum += v * v }
            return Math.sqrt(sum / n)
        }
        const val THRESHOLD = 0.02
    }
}
