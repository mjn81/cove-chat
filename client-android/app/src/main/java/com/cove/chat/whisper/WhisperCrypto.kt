package com.nodetalk.client.whisper

import android.util.Base64
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Keys derived for one Whisper session (mirrors `DerivedWhisperSecrets` in client-web/src/lib/whisperCrypto.ts). */
class WhisperSecrets(val sessionKey: ByteArray, val safetyNumber: String)

/**
 * Whisper E2EE primitives, wire-compatible with the web client: ephemeral ECDH P-256, HKDF with the
 * `nodetalk-whisper-salt-v1` salt, AES-256-GCM, and Signal-style 12x5-digit safety numbers.
 * Keys live only in memory for the duration of a session.
 */
object WhisperCrypto {
    private val random = SecureRandom()
    private val salt = "nodetalk-whisper-salt-v1".toByteArray()

    private val p256: ECParameterSpec by lazy {
        val params = AlgorithmParameters.getInstance("EC")
        params.init(ECGenParameterSpec("secp256r1"))
        params.getParameterSpec(ECParameterSpec::class.java)
    }

    fun generateKeyPair(): KeyPair =
        KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    /** Uncompressed point (0x04 || X || Y, 65 bytes) as the browser's `exportKey("raw")` produces. */
    fun exportPublicKey(key: PublicKey): ByteArray {
        val w = (key as java.security.interfaces.ECPublicKey).w
        fun fixed(v: BigInteger): ByteArray {
            val raw = v.toByteArray().let { if (it.size > 1 && it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it }
            return ByteArray(32 - raw.size) + raw
        }
        return byteArrayOf(0x04) + fixed(w.affineX) + fixed(w.affineY)
    }

    fun importPublicKey(raw: ByteArray): PublicKey {
        require(raw.size == 65 && raw[0] == 0x04.toByte()) { "invalid public key" }
        val x = BigInteger(1, raw.copyOfRange(1, 33))
        val y = BigInteger(1, raw.copyOfRange(33, 65))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), p256))
    }

    private fun hmac(alg: String, key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance(alg).apply { init(SecretKeySpec(key, alg)) }.doFinal(data)

    /** RFC 5869 HKDF (extract + expand) with the given HMAC; matches WebCrypto's HKDF. */
    private fun hkdf(alg: String, ikm: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmac(alg, salt, ikm)
        val out = java.io.ByteArrayOutputStream()
        var t = ByteArray(0)
        var counter = 1
        while (out.size() < length) {
            t = hmac(alg, prk, t + info + byteArrayOf(counter.toByte()))
            out.write(t)
            counter++
        }
        return out.toByteArray().copyOf(length)
    }

    fun deriveSecrets(privateKey: java.security.PrivateKey, remote: PublicKey, sessionId: String, userA: String, userB: String): WhisperSecrets {
        val shared = KeyAgreement.getInstance("ECDH").apply { init(privateKey); doPhase(remote, true) }.generateSecret()
        val sessionKey = hkdf("HmacSHA256", shared, "nodetalk-whisper-v1-aes-$sessionId".toByteArray(), 32)
        val sorted = listOf(userA, userB).sorted().joinToString(":")
        val fp = hkdf("HmacSHA512", shared, "nodetalk-whisper-v1-safety-number-$sorted".toByteArray(), 32)
        val groups = (0 until 12).map { i ->
            val v = ((fp[i * 2].toInt() and 0xFF) shl 8) or (fp[i * 2 + 1].toInt() and 0xFF)
            (v % 100000).toString().padStart(5, '0')
        }
        return WhisperSecrets(sessionKey, groups.joinToString(" "))
    }

    /** Returns (ciphertext, nonce), both base64, for a UTF-8 payload. */
    fun encrypt(key: ByteArray, plaintext: String): Pair<String, String> {
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce)) }
        return Base64.encodeToString(cipher.doFinal(plaintext.toByteArray()), Base64.NO_WRAP) to Base64.encodeToString(nonce, Base64.NO_WRAP)
    }

    fun decrypt(key: ByteArray, ciphertextB64: String, nonceB64: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, Base64.decode(nonceB64, Base64.NO_WRAP)))
        }
        return String(cipher.doFinal(Base64.decode(ciphertextB64, Base64.NO_WRAP)))
    }
}
