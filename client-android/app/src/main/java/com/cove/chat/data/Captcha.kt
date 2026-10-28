package com.cove.chat.data

import java.security.MessageDigest
import java.util.Base64
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A sign-up proof-of-work challenge from `GET /api/captcha/challenge` (ALTCHA v1 format). The client finds the
 * number n in `[0, maxnumber]` with SHA-256(salt + n) equal to [challenge]. Mirrors `client-web/src/lib/altcha.ts`.
 */
@Serializable
data class CaptchaChallenge(
    val algorithm: String,
    val challenge: String,
    val maxnumber: Int,
    val salt: String,
    val signature: String,
)

/** Attempts between cancellation checks, so a closed screen stops burning CPU quickly. */
private const val CHECK_EVERY = 4096

/**
 * Solves [c] by brute force and returns the base64 payload to send as `captcha` when registering.
 * Run it on a background dispatcher (for example `Dispatchers.Default`): the work is pure CPU.
 *
 * @return the payload, or null when the algorithm is unsupported or no number in range solves the challenge.
 * @throws kotlinx.coroutines.CancellationException when the calling coroutine is cancelled.
 */
suspend fun solveCaptcha(c: CaptchaChallenge): String? {
    if (c.algorithm != "SHA-256" || c.challenge.length != 64) return null
    val target = ByteArray(32) { i -> c.challenge.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    val prefix = c.salt.toByteArray(Charsets.UTF_8)
    val md = MessageDigest.getInstance("SHA-256")
    val started = System.nanoTime()

    for (n in 0..c.maxnumber) {
        if (n % CHECK_EVERY == 0) coroutineContext.ensureActive()
        md.update(prefix)
        if (MessageDigest.isEqual(md.digest(n.toString().toByteArray(Charsets.US_ASCII)), target)) {
            val json = buildJsonObject {
                put("algorithm", c.algorithm)
                put("challenge", c.challenge)
                put("number", n)
                put("salt", c.salt)
                put("signature", c.signature)
                put("took", (System.nanoTime() - started) / 1_000_000)
            }
            return Base64.getEncoder().encodeToString(json.toString().toByteArray(Charsets.UTF_8))
        }
    }
    return null
}
