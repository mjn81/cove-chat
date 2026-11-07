package com.cove.chat.data.udpmedia

import java.security.SecureRandom
import java.util.Base64 as JBase64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** HKDF-SHA256 (RFC 5869). */
object Hkdf {
    private const val ALG = "HmacSHA256"

    fun extract(salt: ByteArray, ikm: ByteArray): ByteArray {
        val mac = Mac.getInstance(ALG)
        // RFC 5869: an empty salt is treated as a string of zeros; SecretKeySpec rejects empty keys.
        mac.init(SecretKeySpec(if (salt.isEmpty()) ByteArray(32) else salt, ALG))
        return mac.doFinal(ikm)
    }

    fun expand(prk: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance(ALG)
        mac.init(SecretKeySpec(prk, ALG))
        val out = ByteArray(length)
        var t = ByteArray(0)
        var pos = 0
        var counter = 1
        while (pos < length) {
            mac.update(t)
            mac.update(info)
            mac.update(counter.toByte())
            t = mac.doFinal()
            val n = minOf(t.size, length - pos)
            System.arraycopy(t, 0, out, pos, n)
            pos += n
            counter++
        }
        return out
    }
}

/** Which side of the session a [Keyring] serves; it decides which directional key seals and which opens. */
enum class Role { CLIENT, SERVER }

/**
 * Key material and replay state of one session, with epoch rotation. Mirrors `backend/pkg/udpmedia/keyring.go`
 * (docs/udp-media.md sections 3 and 5). Thread safe. [now] is milliseconds from any monotonic-ish clock and is
 * injectable so tests can cross the rotation interval.
 */
class Keyring(
    private val role: Role,
    val sessionId: ByteArray,
    shared: ByteArray,
    clientNonce: ByteArray,
    serverNonce: ByteArray,
    channelId: String,
    userId: String,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private class Epoch(
        val epoch: Int,
        var prk: ByteArray?,
        val sendKey: SecretKeySpec,
        val recvKey: SecretKeySpec,
        val sendSalt: ByteArray,
        val recvSalt: ByteArray,
        val born: Long,
    ) {
        var sendSeq = 0L
        val window = ReplayWindow()
    }

    private val ctx: ByteArray = "|$channelId|$userId".toByteArray(Charsets.UTF_8)
    private val random = SecureRandom()
    private var cur: Epoch
    private var prev: Epoch? = null
    private var next: Epoch? = null // derived lazily and cached so forged next-epoch packets cost no repeated HKDF work
    private var prevUntil = 0L

    init {
        require(sessionId.size == Wire.SESSION_ID_LEN)
        val salt = sessionId + clientNonce + serverNonce
        cur = derive(Hkdf.extract(salt, shared), 0, now())
    }

    /** The epoch used for sending. */
    @Synchronized fun epoch(): Int = cur.epoch

    private fun label(name: String): ByteArray = name.toByteArray(Charsets.UTF_8) + ctx

    private fun derive(prk: ByteArray, epoch: Int, born: Long): Epoch {
        val c2sKey = Hkdf.expand(prk, label("cove-udpmedia/v1/c2s/key"), 32)
        val s2cKey = Hkdf.expand(prk, label("cove-udpmedia/v1/s2c/key"), 32)
        val c2sSalt = Hkdf.expand(prk, label("cove-udpmedia/v1/c2s/salt"), 4)
        val s2cSalt = Hkdf.expand(prk, label("cove-udpmedia/v1/s2c/salt"), 4)
        val c2s = SecretKeySpec(c2sKey, "AES")
        val s2c = SecretKeySpec(s2cKey, "AES")
        return if (role == Role.CLIENT) Epoch(epoch, prk, c2s, s2c, c2sSalt, s2cSalt, born)
        else Epoch(epoch, prk, s2c, c2s, s2cSalt, c2sSalt, born)
    }

    private fun nextLocked(): Epoch {
        next?.let { return it }
        val prk = cur.prk ?: error("keyring: previous epoch key already erased")
        val n = derive(Hkdf.extract("cove-udpmedia/v1/ratchet".toByteArray(Charsets.UTF_8), prk), (cur.epoch + 1) and 0xFF, now())
        next = n
        return n
    }

    private fun commit(n: Epoch) {
        // Dropping the old pseudo-random keys gives forward secrecy for epochs older than the grace epoch.
        prev?.prk = null
        cur.prk = null
        prev = cur
        prevUntil = now() + PREV_EPOCH_GRACE_MS
        cur = n
        next = null
    }

    /** Ratchets to the next epoch now. [seal] does this automatically after the rotation interval. */
    @Synchronized fun rotate() { commit(nextLocked()) }

    private fun nonce(salt: ByteArray, seq: Long): ByteArray {
        val n = ByteArray(12)
        System.arraycopy(salt, 0, n, 0, 4)
        for (i in 0 until 8) n[4 + i] = (seq ushr (56 - 8 * i)).toByte()
        return n
    }

    /** Encrypts [plaintext] into a ready-to-send packet of [type], rotating first when due. */
    @Synchronized fun seal(type: Int, plaintext: ByteArray): ByteArray {
        if (plaintext.size > Wire.MAX_PLAINTEXT) throw UdpMediaException(UdpMediaException.Reason.TOO_LARGE)
        if (cur.sendSeq >= ROTATE_PACKETS || now() - cur.born >= ROTATE_INTERVAL_MS) rotate()
        val e = cur
        val seq = e.sendSeq++
        val header = PacketHeader(type, e.epoch, sessionId, seq).write()
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, e.sendKey, GCMParameterSpec(Wire.TAG_LEN * 8, nonce(e.sendSalt, seq)))
        c.updateAAD(header)
        return header + c.doFinal(plaintext)
    }

    /**
     * Authenticates and decrypts [pkt] (the first [len] bytes). The replay window only advances after the tag
     * verifies; a packet one epoch ahead rotates the keyring only after it authenticates.
     * @throws UdpMediaException with the reason it was dropped.
     */
    @Synchronized fun open(pkt: ByteArray, len: Int = pkt.size): Pair<PacketHeader, ByteArray> {
        val h = PacketHeader.parse(pkt, len)
        if (!h.sessionId.contentEquals(sessionId)) throw UdpMediaException(UdpMediaException.Reason.WRONG_SESSION)
        var isNext = false
        val p = prev
        val e: Epoch = when {
            h.epoch == cur.epoch -> cur
            p != null && h.epoch == p.epoch && now() < prevUntil -> p
            h.epoch == ((cur.epoch + 1) and 0xFF) -> { isNext = true; nextLocked() }
            else -> throw UdpMediaException(UdpMediaException.Reason.BAD_EPOCH)
        }
        if (!e.window.ok(h.seq)) throw UdpMediaException(UdpMediaException.Reason.REPLAY)
        val plain = try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, e.recvKey, GCMParameterSpec(Wire.TAG_LEN * 8, nonce(e.recvSalt, h.seq)))
            c.updateAAD(pkt, 0, Wire.HEADER_LEN)
            c.doFinal(pkt, Wire.HEADER_LEN, len - Wire.HEADER_LEN)
        } catch (_: AEADBadTagException) {
            throw UdpMediaException(UdpMediaException.Reason.AUTH)
        } catch (_: java.security.GeneralSecurityException) {
            throw UdpMediaException(UdpMediaException.Reason.AUTH)
        }
        e.window.mark(h.seq)
        if (isNext) commit(e)
        return h to plain
    }

    companion object {
        const val ROTATE_INTERVAL_MS = 10 * 60 * 1000L
        const val ROTATE_PACKETS = 1L shl 32
        const val PREV_EPOCH_GRACE_MS = 10_000L
    }
}

/** The client's half of the handshake, kept between sending `call_join` and receiving `call_joined`. */
class ClientJoin private constructor(private val priv: ByteArray, private val nonce: ByteArray) {
    /** Base64 (standard) public key and nonce for the `media` object of `call_join`. */
    val clientPub: String = b64(X25519.publicKey(priv))
    val clientNonce: String = b64(nonce)

    /** Derives the client keyring from the server's `media` object of `call_joined`. */
    fun complete(resp: JoinResponse, channelId: String, userId: String, now: () -> Long = System::currentTimeMillis): Keyring {
        val sid = unb64(resp.sessionId)
        val pub = unb64(resp.serverPub)
        val sn = unb64(resp.serverNonce)
        if (sid.size != Wire.SESSION_ID_LEN || sn.size != Wire.NONCE_LEN || pub.size != 32) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        val shared = X25519.sharedSecret(priv, pub)
        return Keyring(Role.CLIENT, sid, shared, nonce, sn, channelId, userId, now)
    }

    companion object {
        fun create(random: SecureRandom = SecureRandom()): ClientJoin {
            val n = ByteArray(Wire.NONCE_LEN).also { random.nextBytes(it) }
            return ClientJoin(X25519.generatePrivate(random), n)
        }
    }
}

/** The `media` object of the server's `call_joined`. */
data class JoinResponse(val sessionId: String, val serverPub: String, val serverNonce: String, val mediaId: Int, val maxPacket: Int, val epoch: Int)

private fun b64(b: ByteArray): String = JBase64.getEncoder().encodeToString(b)
private fun unb64(s: String): ByteArray = try { JBase64.getDecoder().decode(s) } catch (_: IllegalArgumentException) { throw UdpMediaException(UdpMediaException.Reason.MALFORMED) }
