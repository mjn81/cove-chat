package com.cove.chat.data.update

import java.io.File
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateLogicTest {
    private val hex = "a".repeat(64)

    private fun manifest(
        version: String = "0.10.0",
        channel: String = "beta",
        url: String = "https://example.test/cove.apk",
        sha: String = hex,
        min: String? = null,
        key: String = "android",
    ) = """
        {"channel":"$channel","version":"$version","released_at":"2026-11-02T10:00:00Z","notes":"n","release_url":"https://example.test/r",
         ${if (min != null) "\"min_version\":\"$min\"," else ""}
         "assets":{"$key":{"url":"$url","sha256":"$sha","size":123}}}
    """.trimIndent()

    @Test
    fun `compares versions like the Go updater`() {
        fun cmp(a: String, b: String) = SemVer.parse(a)!!.compareTo(SemVer.parse(b)!!)
        assertTrue(cmp("0.9.10", "0.9.9") > 0)
        assertTrue(cmp("0.10.0", "0.9.99") > 0)
        assertTrue(cmp("1.0.0", "1.0.0-rc.1") > 0)
        assertTrue(cmp("1.0.0-rc.2", "1.0.0-rc.10") < 0)
        assertTrue(cmp("1.0.0-alpha", "1.0.0-alpha.1") < 0)
        assertEquals(0, cmp("v2.0.0+build5", "2.0.0"))
    }

    @Test
    fun `rejects malformed versions`() {
        listOf("", "1.2", "x.y.z", "1.2.3-", "01.2.3", "1.2.3-a..b").forEach { assertNull(it, SemVer.parse(it)) }
    }

    @Test
    fun `parses a valid manifest`() {
        val m = UpdateLogic.parseManifest(manifest())
        assertNotNull(m)
        assertEquals("0.10.0", m!!.version)
        assertEquals(hex, m.assets.getValue("android").sha256)
    }

    @Test
    fun `rejects unsafe or broken manifests so the caller falls back to GitHub`() {
        assertNull(UpdateLogic.parseManifest("not json"))
        assertNull(UpdateLogic.parseManifest("""{"error":"no release"}"""))
        assertNull(UpdateLogic.parseManifest(manifest(url = "http://example.test/cove.apk")))
        assertNull(UpdateLogic.parseManifest(manifest(sha = "short")))
        assertNull(UpdateLogic.parseManifest(manifest(version = "banana")))
        assertNull(UpdateLogic.parseManifest(manifest(min = "nope")))
    }

    @Test
    fun `offers only a strictly newer apk`() {
        val m = UpdateLogic.parseManifest(manifest())!!
        assertEquals("0.10.0", UpdateLogic.offerFrom(m, "0.9.9", true)?.version)
        assertNull("same version", UpdateLogic.offerFrom(m, "0.10.0", true))
        assertNull("downgrade", UpdateLogic.offerFrom(m, "0.11.0", true))
    }

    @Test
    fun `hides pre-releases from stable users unless they opt in`() {
        val beta = UpdateLogic.parseManifest(manifest(version = "1.1.0", channel = "beta"))!!
        assertNull(UpdateLogic.offerFrom(beta, "1.0.0", UpdateLogic.allowPrerelease("1.0.0", false)))
        assertNotNull(UpdateLogic.offerFrom(beta, "1.0.0", UpdateLogic.allowPrerelease("1.0.0", true)))
        assertNotNull("0.x builds are offered pre-releases by default", UpdateLogic.offerFrom(beta.copy(version = "0.10.0"), "0.9.9", UpdateLogic.allowPrerelease("0.9.9", false)))
    }

    @Test
    fun `needs an android asset and respects min_version`() {
        assertNull(UpdateLogic.offerFrom(UpdateLogic.parseManifest(manifest(key = "windows-amd64"))!!, "0.9.9", true))
        val gated = UpdateLogic.offerFrom(UpdateLogic.parseManifest(manifest(min = "0.9.5"))!!, "0.9.0", true)!!
        assertFalse(gated.directInstall)
        assertTrue(UpdateLogic.offerFrom(UpdateLogic.parseManifest(manifest(min = "0.9.5"))!!, "0.9.9", true)!!.directInstall)
    }

    @Test
    fun `parses sha256sum output`() {
        val sums = UpdateLogic.parseSums("${hex}  cove-android-0.10.0.apk\n${"B".repeat(64)} *other.zip\njunk")
        assertEquals(hex, sums["cove-android-0.10.0.apk"])
        assertEquals("b".repeat(64), sums["other.zip"])
        assertEquals(2, sums.size)
    }

    private val releases = """
        [
          {"tag_name":"v0.9.10","draft":false,"prerelease":true,"html_url":"https://g/r1","body":"old","assets":[
             {"name":"cove-android-0.9.10.apk","size":1,"browser_download_url":"https://g/a1"},{"name":"SHA256SUMS","size":1,"browser_download_url":"https://g/s1"}]},
          {"tag_name":"v0.10.0","draft":false,"prerelease":true,"html_url":"https://g/r2","body":"new","assets":[
             {"name":"cove-android-0.10.0.apk","size":9,"browser_download_url":"https://g/a2"},{"name":"SHA256SUMS","size":1,"browser_download_url":"https://g/s2"}]},
          {"tag_name":"v0.11.0","draft":true,"prerelease":true,"html_url":"https://g/r3","body":"draft","assets":[
             {"name":"cove-android-0.11.0.apk","size":1,"browser_download_url":"https://g/a3"},{"name":"SHA256SUMS","size":1,"browser_download_url":"https://g/s3"}]},
          {"tag_name":"v0.12.0","draft":false,"prerelease":true,"html_url":"https://g/r4","body":"still uploading","assets":[
             {"name":"cove-server-linux-amd64.zip","size":1,"browser_download_url":"https://g/z"}]}
        ]
    """.trimIndent()

    @Test
    fun `picks the highest complete github release`() {
        val pick = UpdateLogic.pickGitHubRelease(releases, "0.9.9", true)!!
        assertEquals("0.10.0", pick.version)
        assertEquals("https://g/s2", pick.sumsUrl)
        val offer = UpdateLogic.offerFromGitHub(pick, "$hex  cove-android-0.10.0.apk\n")!!
        assertEquals(hex, offer.sha256)
        assertEquals("https://g/a2", offer.apkUrl)
        assertNull("no checksum for the apk means no offer", UpdateLogic.offerFromGitHub(pick, "$hex  other.apk\n"))
    }

    @Test
    fun `github fallback honours the pre-release and downgrade rules`() {
        assertNull(UpdateLogic.pickGitHubRelease(releases, "1.0.0", false))
        assertNull(UpdateLogic.pickGitHubRelease(releases, "0.10.0", true))
        assertNull(UpdateLogic.pickGitHubRelease("garbage", "0.9.9", true))
    }

    @Test
    fun `verifies the downloaded file against the expected sha256`() {
        val f = File.createTempFile("cove", ".apk")
        try {
            f.writeBytes("payload".toByteArray())
            val expected = MessageDigest.getInstance("SHA-256").digest("payload".toByteArray()).joinToString("") { "%02x".format(it) }
            assertTrue(UpdateLogic.verify(f, expected))
            assertTrue(UpdateLogic.verify(f, expected.uppercase()))
            assertFalse(UpdateLogic.verify(f, hex))
        } finally {
            f.delete()
        }
    }

    @Test
    fun `auto download needs both the opt-in and unmetered wifi`() {
        assertFalse(UpdateLogic.mayAutoDownload(optedIn = false, unmeteredWifi = true))
        assertFalse(UpdateLogic.mayAutoDownload(optedIn = true, unmeteredWifi = false))
        assertTrue(UpdateLogic.mayAutoDownload(optedIn = true, unmeteredWifi = true))
    }

    @Test
    fun `checks at most once a day`() {
        val day = 24L * 60 * 60 * 1000
        assertTrue(UpdateLogic.checkDue(0, 1_000))
        assertFalse(UpdateLogic.checkDue(1_000, 1_000 + day - 1))
        assertTrue(UpdateLogic.checkDue(1_000, 1_000 + day))
        assertTrue("clock moved backwards", UpdateLogic.checkDue(5_000, 1_000))
    }
}
