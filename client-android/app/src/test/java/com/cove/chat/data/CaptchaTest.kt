package com.cove.chat.data

import java.security.MessageDigest
import java.util.Base64
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptchaTest {
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    /** Builds a challenge the way the server does for a known secret number. */
    private fun challengeFor(secret: Int, max: Int, algorithm: String = "SHA-256"): CaptchaChallenge {
        val salt = "0a1b2c3d4e5f60718293a4b5?expires=9999999999"
        val digest = MessageDigest.getInstance("SHA-256").digest((salt + secret).toByteArray())
        return CaptchaChallenge(algorithm, hex(digest), max, salt, "signature-from-server")
    }

    private fun decode(payload: String) =
        Json.parseToJsonElement(String(Base64.getDecoder().decode(payload))).jsonObject

    @Test
    fun `finds the secret number and echoes the server fields in the payload`() = runBlocking {
        val c = challengeFor(1234, 5000)
        val p = decode(solveCaptcha(c)!!)
        assertEquals(1234, p.getValue("number").jsonPrimitive.int)
        assertEquals(c.challenge, p.getValue("challenge").jsonPrimitive.content)
        assertEquals(c.salt, p.getValue("salt").jsonPrimitive.content)
        assertEquals(c.signature, p.getValue("signature").jsonPrimitive.content)
        assertEquals("SHA-256", p.getValue("algorithm").jsonPrimitive.content)
    }

    @Test
    fun `finds a secret at both ends of the range`() = runBlocking {
        assertEquals(0, decode(solveCaptcha(challengeFor(0, 100))!!).getValue("number").jsonPrimitive.int)
        assertEquals(100, decode(solveCaptcha(challengeFor(100, 100))!!).getValue("number").jsonPrimitive.int)
    }

    @Test
    fun `returns null when nothing in range solves it`() = runBlocking {
        assertNull(solveCaptcha(challengeFor(900, 500)))
    }

    @Test
    fun `refuses an unsupported algorithm`() = runBlocking {
        assertNull(solveCaptcha(challengeFor(1, 10, algorithm = "MD5")))
    }

    @Test
    fun `solves the hardest difficulty quickly`() = runBlocking {
        val started = System.nanoTime()
        assertTrue(solveCaptcha(challengeFor(400_000, 400_000)) != null)
        assertTrue("took ${(System.nanoTime() - started) / 1_000_000} ms", System.nanoTime() - started < 10_000_000_000L)
    }
}
