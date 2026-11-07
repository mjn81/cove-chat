package com.cove.chat.data.udpmedia

import java.math.BigInteger
import java.security.SecureRandom

/**
 * X25519 (RFC 7748) in plain Kotlin. The platform only offers it from API 33 and the client supports API 26, so the
 * handshake cannot rely on a provider. The private key is ephemeral (one per call join) and the ladder uses a
 * conditional swap with no secret-dependent branches; BigInteger arithmetic itself is not constant time, which is an
 * accepted trade-off for a per-call ephemeral key (the peer is the trusted server, not a local attacker).
 */
object X25519 {
    private val P: BigInteger = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19))
    private val A24: BigInteger = BigInteger.valueOf(121665)
    private val BASE: ByteArray = ByteArray(32).also { it[0] = 9 }

    /** A fresh random private key (32 bytes). */
    fun generatePrivate(random: SecureRandom = SecureRandom()): ByteArray = ByteArray(32).also { random.nextBytes(it) }

    /** The public key for [priv]. */
    fun publicKey(priv: ByteArray): ByteArray = scalarMult(priv, BASE)

    /**
     * The shared secret. Throws [UdpMediaException] (MALFORMED) for an all-zero result, which a low-order peer key
     * produces; the server does the same, so neither side derives keys from a known secret.
     */
    fun sharedSecret(priv: ByteArray, peerPub: ByteArray): ByteArray {
        if (peerPub.size != 32) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        val out = scalarMult(priv, peerPub)
        if (out.all { it == 0.toByte() }) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        return out
    }

    /** RFC 7748 `X25519(k, u)`. */
    fun scalarMult(k: ByteArray, u: ByteArray): ByteArray {
        require(k.size == 32 && u.size == 32) { "X25519 inputs are 32 bytes" }
        val kc = k.copyOf()
        kc[0] = (kc[0].toInt() and 248).toByte()
        kc[31] = ((kc[31].toInt() and 127) or 64).toByte()
        val scalar = fromLittleEndian(kc)
        val uc = u.copyOf()
        uc[31] = (uc[31].toInt() and 127).toByte() // mask the unused top bit
        val x1 = fromLittleEndian(uc).mod(P)

        var x2 = BigInteger.ONE
        var z2 = BigInteger.ZERO
        var x3 = x1
        var z3 = BigInteger.ONE
        var swap = 0
        for (t in 254 downTo 0) {
            val bit = if (scalar.testBit(t)) 1 else 0
            swap = swap xor bit
            if (swap == 1) { val tx = x2; x2 = x3; x3 = tx; val tz = z2; z2 = z3; z3 = tz }
            swap = bit

            val a = x2.add(z2).mod(P)
            val aa = a.multiply(a).mod(P)
            val b = x2.subtract(z2).mod(P)
            val bb = b.multiply(b).mod(P)
            val e = aa.subtract(bb).mod(P)
            val c = x3.add(z3).mod(P)
            val d = x3.subtract(z3).mod(P)
            val da = d.multiply(a).mod(P)
            val cb = c.multiply(b).mod(P)
            x3 = da.add(cb).mod(P).let { it.multiply(it).mod(P) }
            z3 = x1.multiply(da.subtract(cb).mod(P).let { it.multiply(it).mod(P) }).mod(P)
            x2 = aa.multiply(bb).mod(P)
            z2 = e.multiply(aa.add(A24.multiply(e)).mod(P)).mod(P)
        }
        if (swap == 1) { val tx = x2; x2 = x3; x3 = tx; val tz = z2; z2 = z3; z3 = tz }
        val result = x2.multiply(z2.modPow(P.subtract(BigInteger.valueOf(2)), P)).mod(P)
        return toLittleEndian(result)
    }

    private fun fromLittleEndian(b: ByteArray): BigInteger = BigInteger(1, b.reversedArray())

    private fun toLittleEndian(v: BigInteger): ByteArray {
        val be = v.toByteArray() // big-endian, possibly with a leading sign byte or fewer than 32 bytes
        val out = ByteArray(32)
        for (i in be.indices) {
            val idx = be.size - 1 - i
            if (i < 32) out[i] = be[idx]
        }
        return out
    }
}
