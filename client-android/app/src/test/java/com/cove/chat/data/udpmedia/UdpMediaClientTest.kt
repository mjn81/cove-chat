package com.cove.chat.data.udpmedia

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

/** A minimal in-test stand-in for the router: authenticates, learns the client's address, acks HELLO, records the rest. */
private class FakeServer(val ring: Keyring) {
    val socket = DatagramSocket(0, InetAddress.getByName("127.0.0.1")).also { it.soTimeout = 100 }
    val received = Channel<Pair<PacketHeader, ByteArray>>(Channel.UNLIMITED)
    @Volatile var client: InetSocketAddress? = null
    @Volatile var running = true
    @Volatile var ackHellos = true
    val helloCount = java.util.concurrent.atomic.AtomicInteger(0)
    val rejected = CopyOnWriteArrayList<UdpMediaException.Reason>()
    private val thread = Thread {
        val buf = ByteArray(2000)
        val dp = DatagramPacket(buf, buf.size)
        while (running) {
            try { dp.setLength(buf.size); socket.receive(dp) } catch (_: java.net.SocketTimeoutException) { continue } catch (_: java.io.IOException) { return@Thread }
            val (h, pt) = try { ring.open(buf, dp.length) } catch (e: UdpMediaException) { rejected += e.reason; continue }
            client = InetSocketAddress(dp.address, dp.port)
            if (h.type == PacketType.HELLO) {
                helloCount.incrementAndGet()
                if (ackHellos) send(PacketType.HELLO_ACK, pt)
            }
            received.trySend(h to pt)
        }
    }.also { it.isDaemon = true; it.start() }

    fun send(type: Int, pt: ByteArray) {
        val pkt = ring.seal(type, pt)
        val c = client ?: return
        socket.send(DatagramPacket(pkt, pkt.size, c))
    }

    fun stop() { running = false; socket.close(); thread.join(1000) }
}

class UdpMediaClientTest {
    private lateinit var scope: CoroutineScope
    private lateinit var server: FakeServer
    private lateinit var client: UdpMediaClient

    @Before fun setUp() {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        server = FakeServer(Vec.ring(Role.SERVER))
        client = UdpMediaClient(InetSocketAddress("127.0.0.1", server.socket.localPort), Vec.ring(Role.CLIENT), scope)
        client.start()
    }

    @After fun tearDown() {
        client.close()
        server.stop()
        scope.cancel()
    }

    private suspend fun nextOfType(type: Int, ms: Long = 3000): Pair<PacketHeader, ByteArray> = withTimeout(ms) {
        while (true) {
            val r = server.received.receive()
            if (r.first.type == type) return@withTimeout r
        }
        @Suppress("UNREACHABLE_CODE") error("unreachable")
    }

    @Test fun handshakeSendsPaddedHelloAndCompletesOnAck() = runBlocking {
        client.handshake(5000)
        val (_, pt) = nextOfType(PacketType.HELLO)
        assertEquals(Wire.HELLO_PLAINTEXT_LEN, pt.size) // padded so the ack is never an amplification
    }

    @Test fun handshakeTimesOutWithoutAckAndKeepsRetrying() {
        server.ackHellos = false
        try {
            runBlocking { client.handshake(1300) }
            fail("expected timeout")
        } catch (_: TimeoutCancellationException) { /* expected */ }
        assertTrue("HELLO is retried every 500 ms", server.helloCount.get() >= 2)
    }

    @Test fun sentFramesAreFragmentedEncryptedAndReassemblable() = runBlocking {
        client.handshake(5000)
        val data = ByteArray(3000) { (it * 5).toByte() }
        assertTrue(client.sendFrame(Kind.VIDEO, Codec.H264, Flags.KEYFRAME, 1234, data))
        val r = Reassembler(true)
        var frame: Frame? = null
        while (frame == null) {
            val (_, pt) = nextOfType(PacketType.MEDIA)
            val mp = MediaCodec.decode(pt)
            assertEquals(Kind.VIDEO, mp.header.kind)
            frame = r.push(mp.header, mp.payload, 0).firstOrNull()
        }
        assertArrayEquals(data, frame.data)
        assertTrue(frame.keyframe)
        assertEquals(1234L, frame.ts)
        // Frame ids count per kind.
        client.sendFrame(Kind.VIDEO, Codec.H264, 0, 1300, ByteArray(10))
        assertEquals(1L, MediaCodec.decode(nextOfType(PacketType.MEDIA).second).header.frameId)
        client.sendFrame(Kind.AUDIO, Codec.OPUS, 0, 960, ByteArray(10))
        assertEquals(0L, MediaCodec.decode(nextOfType(PacketType.MEDIA).second).header.frameId)
    }

    @Test fun oversizedFrameIsRefused() {
        assertEquals(false, client.sendFrame(Kind.VIDEO, Codec.H264, 0, 0, ByteArray(64 * 1100 + 1)))
    }

    @Test fun incomingFramesAreReassembledWithTheServerStampedSource() = runBlocking {
        client.handshake(5000)
        val data = ByteArray(2400) { it.toByte() }
        val hdr = MediaHeader(src = 7, kind = Kind.VIDEO, codec = Codec.H264, flags = Flags.KEYFRAME, frameId = 0, ts = 50)
        for (p in Fragmenter.split(hdr, data)!!.reversed()) server.send(PacketType.MEDIA, p) // reordered
        val got = withTimeout(3000) { client.frames.receive() }
        assertEquals(7, got.src)
        assertArrayEquals(data, got.frame.data)
    }

    @Test fun lostFragmentTriggersNackAndRetransmissionCompletesTheFrame() = runBlocking {
        client.handshake(5000)
        val data = ByteArray(2400) { (it * 3).toByte() }
        val parts = Fragmenter.split(MediaHeader(src = 4, kind = Kind.SCREEN, codec = Codec.H264, flags = Flags.KEYFRAME, frameId = 0), data)!!
        server.send(PacketType.MEDIA, parts[0])
        server.send(PacketType.MEDIA, parts[2]) // fragment 1 is "lost"
        val (_, nack) = nextOfType(PacketType.NACK)
        val (src, kind, items) = Control.decodeNack(nack)
        assertEquals(4, src)
        assertEquals(Kind.SCREEN, kind)
        assertTrue(items.contains(NackItem(0, 1)))
        server.send(PacketType.MEDIA, parts[1]) // retransmission
        val got = withTimeout(3000) { client.frames.receive() }
        assertArrayEquals(data, got.frame.data)
        assertTrue(client.nacksSent >= 1)
    }

    @Test fun serverKeyframeRequestIsSurfacedToTheEncoder() = runBlocking {
        client.handshake(5000)
        server.send(PacketType.KEYFRAME_REQ, Control.encodeKeyframeReq(0, Kind.SCREEN))
        assertEquals(Kind.SCREEN, withTimeout(3000) { client.keyframeRequests.receive() })
        assertEquals(1, client.keyframeRequestsReceived)
    }

    @Test fun requestKeyframeIsSentToTheServer() = runBlocking {
        client.handshake(5000)
        client.requestKeyframe(9, Kind.VIDEO)
        assertEquals(9 to Kind.VIDEO, Control.decodeKeyframeReq(nextOfType(PacketType.KEYFRAME_REQ).second))
    }

    @Test fun forgedAndReplayedDatagramsAreDropped() = runBlocking {
        client.handshake(5000)
        val attacker = DatagramSocket()
        val target = client.localPort
        val sealed = server.ring.seal(PacketType.MEDIA, MediaCodec.encode(MediaHeader(src = 2, kind = Kind.AUDIO, codec = Codec.OPUS, frameId = 0), ByteArray(5)))
        val forged = sealed.copyOf().also { it[sealed.size - 1] = (it[sealed.size - 1].toInt() xor 1).toByte() }
        attacker.send(DatagramPacket(forged, forged.size, InetAddress.getByName("127.0.0.1"), target))
        attacker.send(DatagramPacket(sealed, sealed.size, InetAddress.getByName("127.0.0.1"), target))
        attacker.send(DatagramPacket(sealed, sealed.size, InetAddress.getByName("127.0.0.1"), target)) // replay
        attacker.close()
        // Note: the client socket is connected to the server, so the OS may already drop these; either way exactly
        // zero frames may result from forged/replayed input.
        val got = kotlinx.coroutines.withTimeoutOrNull(400) { client.frames.receive() }
        assertEquals(null, got)
    }

    @Test fun closeSendsByeAndClosesChannels() = runBlocking {
        client.handshake(5000)
        client.close()
        nextOfType(PacketType.BYE)
        assertTrue(client.frames.isClosedForReceive)
        client.close() // idempotent
    }
}
