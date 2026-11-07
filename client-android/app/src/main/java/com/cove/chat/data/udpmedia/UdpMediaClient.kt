package com.cove.chat.data.udpmedia

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** A reassembled frame from another participant; [src] is the sender's `media_id`. */
class ReceivedFrame(val src: Int, val frame: Frame)

/**
 * Native-client side of a UDP media session (docs/udp-media.md): owns the socket, runs the HELLO handshake and
 * keepalive, sends frames, reassembles incoming ones and issues NACKs and keyframe requests. Create it after the
 * WebSocket `call_join` / `call_joined` exchange produced a [Keyring]. Port of Go `udpmedia.Client`.
 *
 * The socket is `connect`ed to the server, so the OS drops datagrams from any other address; the server learns our
 * address only from an authenticated HELLO, and a later HELLO from a new source address (Wi-Fi to cellular) moves it.
 */
class UdpMediaClient(
    private val server: InetSocketAddress,
    private val ring: Keyring,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val socketFactory: () -> DatagramSocket = { DatagramSocket() },
) {
    private val socket: DatagramSocket = socketFactory().also { it.connect(server) }
    private val acked = CompletableDeferred<Unit>()
    private val frameIds = Array(4) { AtomicLong(0) }
    private val streams = HashMap<Pair<Int, Kind>, Reassembler>()
    private val jobs = ArrayList<Job>()
    private val dropped = AtomicLong(0)
    private val keyframeRequestCount = AtomicInteger(0)
    private val nackSentCount = AtomicInteger(0)
    @Volatile private var closed = false

    /** Reassembled frames of other participants. The oldest is dropped when the consumer is slower than the network. */
    val frames = Channel<ReceivedFrame>(256, BufferOverflow.DROP_OLDEST)

    /** Stream kinds the server asked our encoder to refresh with a keyframe. */
    val keyframeRequests = Channel<Kind>(8, BufferOverflow.DROP_OLDEST)

    /** Local UDP port (diagnostics and tests). */
    val localPort: Int get() = socket.localPort

    /** Frames dropped because the consumer was too slow (a congestion hint). */
    val droppedFrames: Long get() = dropped.get()

    /** Keyframe requests received so far; a rising count means receivers see loss (used for bitrate backoff). */
    val keyframeRequestsReceived: Int get() = keyframeRequestCount.get()

    /** NACKs we sent, i.e. loss we observe on the downlink. */
    val nacksSent: Int get() = nackSentCount.get()

    /** Starts the receive and poll loops. Call [handshake] next. */
    fun start() {
        jobs += scope.launch(Dispatchers.IO) { readLoop() }
        jobs += scope.launch(Dispatchers.IO) { pollLoop() }
    }

    /**
     * Sends HELLO every 500 ms until the server's HELLO_ACK authenticates, or [timeoutMs] passes (then throws
     * [kotlinx.coroutines.TimeoutCancellationException]). Afterwards a 5 s HELLO keepalive keeps NAT bindings open.
     */
    suspend fun handshake(timeoutMs: Long = 10_000) {
        withTimeout(timeoutMs) {
            while (!acked.isCompleted) {
                sendHello()
                kotlinx.coroutines.withTimeoutOrNull(500) { acked.await() }
            }
        }
        jobs += scope.launch(Dispatchers.IO) {
            while (isActive && !closed) { delay(5_000); sendHello() }
        }
    }

    private fun sendHello() {
        val pt = ByteArray(Wire.HELLO_PLAINTEXT_LEN)
        val ms = clock()
        for (i in 0 until 8) pt[i] = (ms ushr (56 - 8 * i)).toByte()
        send(PacketType.HELLO, pt)
    }

    private fun send(type: Int, pt: ByteArray) {
        if (closed) return
        val pkt = ring.seal(type, pt)
        try {
            socket.send(DatagramPacket(pkt, pkt.size))
        } catch (_: java.io.IOException) {
            // Transient (network switch, ENETUNREACH): the next keepalive/HELLO retries; media is loss-tolerant.
        }
    }

    /**
     * Fragments and sends an encoded frame. [flags] may include [Flags.KEYFRAME]. The frame id is assigned here and
     * increases by one per call per kind. Returns false when the frame is too large for [Wire.MAX_FRAGMENTS] packets.
     */
    fun sendFrame(kind: Kind, codec: Int, flags: Int, tsMillis: Long, data: ByteArray, off: Int = 0, len: Int = data.size): Boolean {
        val id = frameIds[kind.id].getAndIncrement() and 0xFFFFFFFFL
        val parts = Fragmenter.split(MediaHeader(kind = kind, codec = codec, flags = flags, frameId = id, ts = tsMillis and 0xFFFFFFFFL), data, off, len)
            ?: return false
        for (p in parts) send(PacketType.MEDIA, p)
        return true
    }

    /** Asks the server to ask participant [src] for a keyframe of [kind]. */
    fun requestKeyframe(src: Int, kind: Kind) = send(PacketType.KEYFRAME_REQ, Control.encodeKeyframeReq(src, kind))

    /** Sends BYE, stops the loops and closes the socket and channels. Idempotent. */
    fun close() {
        if (closed) return
        runCatching { send(PacketType.BYE, ByteArray(0)) }
        closed = true
        jobs.forEach { it.cancel() }
        socket.close()
        frames.close()
        keyframeRequests.close()
    }

    private fun readLoop() {
        val buf = ByteArray(Wire.MAX_PACKET + 1)
        val dp = DatagramPacket(buf, buf.size)
        while (!closed) {
            try {
                dp.setLength(buf.size)
                socket.receive(dp)
            } catch (e: java.io.IOException) {
                if (closed) return
                continue
            }
            val h: PacketHeader
            val pt: ByteArray
            try {
                val r = ring.open(buf, dp.length)
                h = r.first; pt = r.second
            } catch (_: UdpMediaException) {
                continue // forged, replayed or stale: drop silently, like the server does
            }
            when (h.type) {
                PacketType.HELLO_ACK -> acked.complete(Unit)
                PacketType.MEDIA -> {
                    val mp = try { MediaCodec.decode(pt) } catch (_: UdpMediaException) { continue }
                    val ready = synchronized(streams) {
                        val key = mp.header.src to mp.header.kind
                        streams.getOrPut(key) { Reassembler(mp.header.kind != Kind.AUDIO) }.push(mp.header, mp.payload, clock())
                    }
                    deliver(mp.header.src, ready)
                }
                PacketType.KEYFRAME_REQ -> {
                    runCatching { Control.decodeKeyframeReq(pt) }.getOrNull()?.let {
                        keyframeRequestCount.incrementAndGet()
                        keyframeRequests.trySend(it.second)
                    }
                }
            }
        }
    }

    private fun deliver(src: Int, ready: List<Frame>) {
        for (f in ready) {
            // DROP_OLDEST keeps latency low; trySend only fails once the channel is closed.
            if (frames.trySend(ReceivedFrame(src, f)).isFailure && !closed) dropped.incrementAndGet()
        }
    }

    private suspend fun pollLoop() {
        while (scopeActive()) {
            delay(10)
            data class Work(val key: Pair<Int, Kind>, val nacks: List<NackItem>, val key2: Boolean)
            val released = ArrayList<Pair<Int, List<Frame>>>()
            val work = ArrayList<Work>()
            synchronized(streams) {
                val now = clock()
                for ((key, r) in streams) {
                    val res = r.poll(now)
                    if (res.frames.isNotEmpty()) released += key.first to res.frames
                    if (res.nacks.isNotEmpty() || res.needKeyframe) work += Work(key, res.nacks, res.needKeyframe)
                }
            }
            released.forEach { deliver(it.first, it.second) }
            for (w in work) {
                if (w.nacks.isNotEmpty()) { nackSentCount.addAndGet(w.nacks.size); send(PacketType.NACK, Control.encodeNack(w.key.first, w.key.second, w.nacks)) }
                if (w.key2) send(PacketType.KEYFRAME_REQ, Control.encodeKeyframeReq(w.key.first, w.key.second))
            }
        }
    }

    private fun scopeActive() = !closed && try { scope.isActive } catch (_: CancellationException) { false }

    companion object {
        /** Resolves [host] (blocking DNS; call off the main thread) into the server's media address. */
        fun resolve(host: String, port: Int): InetSocketAddress = InetSocketAddress(InetAddress.getByName(host), port)
    }
}
