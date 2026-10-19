package com.nodetalk.client.crypto

import android.util.Base64
import com.github.luben.zstd.Zstd
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Manages client-side encryption, decryption, and compression for NodeTalk.
 * Implements AES-256-GCM matching the web client (Web Crypto API) and Go backend.
 */
object CryptoManager {
    private const val GCM_TAG_LENGTH_BITS = 128
    private const val GCM_IV_LENGTH_BYTES = 12
    private val secureRandom = SecureRandom()

    // In-memory channel keys registry (channelId -> 32-byte AES key)
    // Keys are distributed over authenticated WSS and never saved to persistent storage.
    private val channelKeys = ConcurrentHashMap<String, ByteArray>()

    private val _keyVersion = MutableStateFlow(0)

    /** Bumped whenever a channel key arrives so the UI can re-run decryption of "[encrypted]" bodies. */
    val keyVersion: StateFlow<Int> = _keyVersion.asStateFlow()

    fun setChannelKey(channelId: String, rawKey: ByteArray) {
        channelKeys[channelId] = rawKey
        _keyVersion.update { it + 1 }
    }

    fun setChannelKeyBase64(channelId: String, base64Key: String) {
        try {
            val keyBytes = Base64.decode(base64Key, Base64.NO_WRAP)
            setChannelKey(channelId, keyBytes)
        } catch (_: Exception) {}
    }

    fun getChannelKey(channelId: String): ByteArray? {
        return channelKeys[channelId]
    }

    fun clearKeys() {
        channelKeys.clear()
        _keyVersion.update { it + 1 }
    }

    /**
     * Encrypts plaintext string using AES-256-GCM.
     * @return Pair(base64Ciphertext, base64Nonce), or null when the channel key has not arrived yet
     */
    fun encryptMessage(channelId: String, plaintext: String): Pair<String, String>? {
        // Never fall back to plaintext: without the server-distributed key the message is not sent.
        val keyBytes = channelKeys[channelId] ?: return null
        val iv = ByteArray(GCM_IV_LENGTH_BYTES)
        secureRandom.nextBytes(iv)

        val secretKey: SecretKey = SecretKeySpec(keyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)

        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return Pair(
            Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            Base64.encodeToString(iv, Base64.NO_WRAP)
        )
    }

    /**
     * Decrypts AES-256-GCM ciphertext payload with nonce.
     */
    fun decryptMessage(channelId: String, base64Ciphertext: String, base64Nonce: String): String {
        val keyBytes = channelKeys[channelId] ?: return "[encrypted]"

        return try {
            val iv = Base64.decode(base64Nonce, Base64.NO_WRAP)
            val ciphertext = Base64.decode(base64Ciphertext, Base64.NO_WRAP)

            val secretKey: SecretKey = SecretKeySpec(keyBytes, "AES")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)

            val decrypted = cipher.doFinal(ciphertext)
            String(decrypted, Charsets.UTF_8)
        } catch (e: Exception) {
            "[decryption failed]"
        }
    }

    /** AES-256-GCM over raw bytes (file payloads). Returns (ciphertext, nonce) or null without a channel key. */
    fun encryptBytes(channelId: String, data: ByteArray): Pair<ByteArray, ByteArray>? {
        val keyBytes = channelKeys[channelId] ?: return null
        val iv = ByteArray(GCM_IV_LENGTH_BYTES).also { secureRandom.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
        return Pair(cipher.doFinal(data), iv)
    }

    /** Inverse of [encryptBytes]; null when the key is missing or authentication fails. */
    fun decryptBytes(channelId: String, data: ByteArray, nonce: ByteArray): ByteArray? {
        val keyBytes = channelKeys[channelId] ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(GCM_TAG_LENGTH_BITS, nonce))
            cipher.doFinal(data)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Compresses bytes using Zstandard (matches web client @bokuweb/zstd-wasm Level 10).
     */
    fun compress(data: ByteArray, level: Int = 10): ByteArray {
        return Zstd.compress(data, level)
    }

    /**
     * Decompresses Zstandard-compressed bytes.
     */
    fun decompress(compressed: ByteArray, originalSize: Int): ByteArray {
        val decompressed = ByteArray(originalSize)
        Zstd.decompress(decompressed, compressed)
        return decompressed
    }
}
