package com.cove.chat.data.udpmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.spec.NamedParameterSpec
import java.security.spec.XECPrivateKeySpec
import java.security.interfaces.XECPublicKey
import javax.crypto.KeyAgreement

class X25519Test {
    // RFC 7748 section 6.1
    private val alicePriv = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
    private val alicePub = "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"
    private val bobPriv = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
    private val bobPub = "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"
    private val shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"

    @Test fun publicKeysMatchRfc() {
        assertEquals(alicePub, X25519.publicKey(alicePriv).toHex())
        assertEquals(bobPub, X25519.publicKey(bobPriv).toHex())
    }

    @Test fun sharedSecretMatchesRfcBothWays() {
        assertEquals(shared, X25519.sharedSecret(alicePriv, hex(bobPub)).toHex())
        assertEquals(shared, X25519.sharedSecret(bobPriv, hex(alicePub)).toHex())
    }

    // RFC 7748 section 5.2, first vector
    @Test fun scalarMultVector() {
        val k = hex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4")
        val u = hex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c")
        assertEquals("c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552", X25519.scalarMult(k, u).toHex())
    }

    @Test fun randomKeysAgree() {
        val a = X25519.generatePrivate()
        val b = X25519.generatePrivate()
        assertEquals(X25519.sharedSecret(a, X25519.publicKey(b)).toHex(), X25519.sharedSecret(b, X25519.publicKey(a)).toHex())
    }

    @Test fun lowOrderPointIsRejected() {
        assertThrows(UdpMediaException::class.java) { X25519.sharedSecret(alicePriv, ByteArray(32)) }
    }

    /** The JVM running the unit tests has XDH, so cross-check the ladder against it on random keys. */
    @Test fun matchesTheJdkImplementation() {
        val kpg = KeyPairGenerator.getInstance("X25519")
        repeat(5) {
            val peer = kpg.generateKeyPair()
            val u = (peer.public as XECPublicKey).u.toByteArray()
            val raw = ByteArray(32)
            for (i in u.indices) if (i < 32) raw[i] = u[u.size - 1 - i]
            val priv = X25519.generatePrivate()
            val jdkPriv = KeyFactory.getInstance("X25519").generatePrivate(XECPrivateKeySpec(NamedParameterSpec.X25519, priv))
            val jdk = KeyAgreement.getInstance("X25519").also { it.init(jdkPriv); it.doPhase(peer.public, true) }.generateSecret()
            assertEquals(jdk.toHex(), X25519.sharedSecret(priv, raw).toHex())
        }
    }
}
