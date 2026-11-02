package com.cove.chat.data

import com.cove.chat.data.model.ErrorBody
import com.cove.chat.data.model.ServerVersion
import com.cove.chat.data.remote.ApiStandard
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiStandardTest {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    @Test fun clientHeaderCarriesPlatformVersionAndApi() {
        assertEquals("android/0.9.9 (api 1)", ApiStandard.clientHeader("0.9.9"))
    }

    @Test fun unknownMessageTypesAreNotRenderable() {
        listOf("text", "file", "voice", "video", "invite").forEach { assertTrue(ApiStandard.isKnownMessageType(it)) }
        assertFalse(ApiStandard.isKnownMessageType("poll"))
    }

    @Test fun versionsCompareNumerically() {
        assertEquals(1, ApiStandard.compareVersions("0.9.10", "0.9.9"))
        assertEquals(0, ApiStandard.compareVersions("v1.0", "1.0.0"))
        assertEquals(-1, ApiStandard.compareVersions("0.8.0-rc.1", "0.9.0"))
        assertNull(ApiStandard.compareVersions("abc", "1.0.0"))
    }

    @Test fun missingOrInvalidMinimumNeverFlagsOutdated() {
        assertFalse(ApiStandard.isBelowMinimum("0.9.0", null))
        assertFalse(ApiStandard.isBelowMinimum("0.9.0", ""))
        assertFalse(ApiStandard.isBelowMinimum("0.9.0", "soon"))
        assertTrue(ApiStandard.isBelowMinimum("0.9.0", "0.9.1"))
    }

    @Test fun capabilitiesToleratesOldServers() {
        assertFalse(ApiStandard.hasCapability(null, "invite_messages"))
        assertTrue(ApiStandard.hasCapability(listOf("whisper", "future"), "whisper"))
    }

    @Test fun clientOutdatedIsDetectedByStatusOrCode() {
        assertTrue(ApiStandard.isClientOutdated(426, null))
        assertTrue(ApiStandard.isClientOutdated(400, "client_outdated"))
        assertFalse(ApiStandard.isClientOutdated(401, "unauthorized"))
    }

    @Test fun errorEnvelopeParsesCodeAndDetailsAndIgnoresUnknownKeys() {
        val body = json.decodeFromString<ErrorBody>(
            """{"error":"old","code":"client_outdated","details":{"min_client_version":"1.0.0"},"future":1}"""
        )
        assertEquals("client_outdated", body.code)
        assertEquals("1.0.0", ApiStandard.minClientVersion(body.details))
    }

    @Test fun legacyErrorBodyWithoutCodeStillParses() {
        val body = json.decodeFromString<ErrorBody>("""{"error":"nope"}""")
        assertEquals("", body.code)
        assertNull(ApiStandard.minClientVersion(body.details))
    }

    @Test fun versionPayloadParsesWithAndWithoutNewFields() {
        val old = json.decodeFromString<ServerVersion>("""{"version":"0.9.0","udp_port":9090}""")
        assertEquals(emptyList<String>(), old.capabilities)
        val new = json.decodeFromString<ServerVersion>(
            """{"version":"0.9.9","udp_port":9090,"api_version":1,"min_client_version":"0.9.0","capabilities":["whisper"],"extra":true}"""
        )
        assertEquals(1, new.apiVersion)
        assertEquals("0.9.0", new.minClientVersion)
        assertEquals(listOf("whisper"), new.capabilities)
    }
}
