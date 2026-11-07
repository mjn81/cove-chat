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
 * Datagrams from any address other than the server are dropped; the server learns our address only from an
 * authenticated HELLO, and a later HELLO from a new source address (Wi-Fi to cellular) moves it ([probe] sends one
 * right away after a network change).
 */
class UdpMediaClient(
    private val server: InetSocketAddress,
    private val ring: Keyring,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val socketFactory: () -> DatagramSocket = { DatagramSocket() },
) {
    // Deliberately NOT connect()ed: on Android a connected UDP socket keeps the route it had at connect time, so after a
    // Wi-Fi/cellular hand-over it would keep sending into the dead interface. An unconnected socket routes every send
    // afresh; replies are filtered by source address in the read loop instead.
    private val socket: DatagramSocket = socketFactory()
    private val acked = CompletableDeferred<Unit>()
    private val frameIds = Array(4) { AtomicLong(0) }
    private val streams = HashMap<Pair<Int, Kind>, Reassembler>()
    private val jobs = ArrayList<Job>()
    // Android forbids socket I/O on the main thread (NetworkOnMainThreadException) and callers include the UI thread
    // (keyframe requests, BYE on hang-up), so every send goes through one background thread. It also keeps sequence
    // numbers and the wire order of a frame's fragments identical.
    private val sender = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "udp-media-send").apply { isDaemon = true } }
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

    /** Sends a HELLO now so the server learns a new source address quickly after a network change. */
    fun probe() = sendHello()

    private fun sendHello() {
        val pt = ByteArray(Wire.HELLO_PLAINTEXT_LEN)
        val ms = clock()
        for (i in 0 until 8) pt[i] = (ms ushr (56 - 8 * i)).toByte()
        send(PacketType.HELLO, pt)
    }

    private fun send(type: Int, pt: ByteArray) {
        if (closed) return
        try {
            sender.execute { sendNow(type, pt) }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            // closing
        }
    }

    private fun sendNow(type: Int, pt: ByteArray) {
        try {
            val pkt = ring.seal(type, pt)
            socket.send(DatagramPacket(pkt, pkt.size, server))
        } catch (_: java.io.IOException) {
            // Transient (network switch, ENETUNREACH): the next keepalive/HELLO retries; media is loss-tolerant.
        } catch (_: UdpMediaException) {
            // Oversized plaintext: nothing sensible to do with a single bad packet.
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
        closed = true
        jobs.forEach { it.cancel() }
        // BYE and the socket close run on the sender thread, after anything already queued, without blocking the caller.
        sender.execute { sendNow(PacketType.BYE, ByteArray(0)); socket.close() }
        sender.shutdown()
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
            if (dp.port != server.port || dp.address != server.address) continue // not from the server
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
