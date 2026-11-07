package com.cove.chat.rtc.udp

import com.cove.chat.rtc.CallTransport
import com.cove.chat.rtc.CallTransportChoice
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UdpSignalsTest {
    private fun obj(s: String) = Json.parseToJsonElement(s).jsonObject

    @Test fun joinPayloadCarriesTheMediaBlock() {
        val p = UdpSignals.joinPayload("c1", "PUB", "NONCE")
        assertEquals("c1", p["channel_id"]!!.jsonPrimitive.content)
        val m = p["media"]!!.jsonObject
        assertEquals("PUB", m["client_pub"]!!.jsonPrimitive.content)
        assertEquals("NONCE", m["client_nonce"]!!.jsonPrimitive.content)
    }

    @Test fun parsesCallJoinedFromTheDocumentedShape() {
        val j = UdpSignals.joined(obj("""{ "channel_id":"c1","self_id":"u9",
            "media":{"session_id":"AAAAAAAAAAA=","server_pub":"cHVi","server_nonce":"bm9uY2U=","media_id":3,"max_packet":1200,"epoch":0},
            "participants":[{"user_id":"u1","username":"ann","media_id":1,"track_states":{"audio":true,"video":true}},
                            {"user_id":"u2","username":"bob","media_id":2,"track_states":{"audio":false,"screen":true}},
                            {"username":"nobody"}]}"""))!!
        assertEquals("u9", j.selfId)
        assertEquals(3, j.media.mediaId)
        assertEquals(1200, j.media.maxPacket)
        assertEquals(2, j.participants.size)
        val ann = j.participants[0]
        assertEquals(1, ann.mediaId); assertTrue(ann.audio); assertTrue(ann.video); assertFalse(ann.screen)
        val bob = j.participants[1]
        assertFalse(bob.audio); assertTrue(bob.screen)
    }

    @Test fun webRtcModeAnswerHasNoMediaBlockAndIsRejected() {
        assertNull(UdpSignals.joined(obj("""{"channel_id":"c1","self_id":"u","participants":[],"ice_servers":[]}""")))
        assertNull(UdpSignals.joined(obj("""{"channel_id":"c1","media":{}}""")))
    }

    @Test fun participantDefaultsMatchTheServer() {
        val p = UdpSignals.participant(obj("""{"user_id":"u1"}"""))!!
        assertTrue("audio defaults on", p.audio); assertFalse(p.video); assertFalse(p.screen)
        assertNull(p.mediaId)
        assertEquals("User", p.username)
    }

    @Test fun participantEventAndTrackState() {
        val (ch, u) = UdpSignals.participantEvent(obj("""{"channel_id":"c","user":{"user_id":"u","username":"x","media_id":4,"track_states":{}}}"""))
        assertEquals("c", ch); assertEquals(4, u!!.mediaId)
        assertEquals(Triple("u", "video", true), UdpSignals.trackState(obj("""{"user_id":"u","kind":"video","enabled":true}""")))
        assertNull(UdpSignals.trackState(obj("""{"kind":"video","enabled":true}""")))
        assertNull(UdpSignals.trackState(obj("""{"user_id":"u","kind":"video"}""")))
    }

    @Test fun errorTextPrefersErrorThenReason() {
        assertEquals("call is full", UdpSignals.errorText(obj("""{"error":"call is full"}""")))
        assertEquals("kicked", UdpSignals.errorText(obj("""{"reason":"kicked"}""")))
        assertNull(UdpSignals.errorText(obj("""{"reason":""}""")))
    }

    @Test fun mediaEndpointUsesTheServerHostAndAdvertisedPort() {
        assertEquals("cove.example" to 9090, UdpSignals.mediaEndpoint("https://cove.example", 9090))
        assertEquals("10.0.0.5" to 9191, UdpSignals.mediaEndpoint("http://10.0.0.5:8080", 9191))
        assertEquals("::1" to 9090, UdpSignals.mediaEndpoint("http://[::1]:8080", 9090))
        assertNull(UdpSignals.mediaEndpoint("", 9090))
    }

    @Test fun transportIsChosenFromCapabilitiesNotVersions() {
        assertEquals(CallTransport.WebRtc, CallTransportChoice.forCapabilities(listOf("webrtc_sfu")))
        assertEquals(CallTransport.EncryptedUdp, CallTransportChoice.forCapabilities(listOf("raw_udp_voice", "raw_udp_media")))
        assertEquals(CallTransport.WebRtc, CallTransportChoice.forCapabilities(emptyList()))
        assertEquals(CallTransport.WebRtc, CallTransportChoice.forCapabilities(null))
        // A legacy server advertising only raw_udp_voice cannot do encrypted media: stay on the existing path.
        assertEquals(CallTransport.WebRtc, CallTransportChoice.forCapabilities(listOf("raw_udp_voice")))
        assertEquals(CallTransport.WebRtc, CallTransportChoice.forCapabilities(listOf("webrtc_sfu", "raw_udp_media")))
    }
}
