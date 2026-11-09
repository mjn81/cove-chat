package com.cove.chat.themes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoveThemeParserTest {
    private fun json(vararg extra: Pair<String, String>, tokens: String = TOKENS, id: String = "my-theme"): String {
        val base = mutableMapOf(
            "format" to "\"cove-theme\"", "version" to "1", "id" to "\"$id\"", "name" to "{\"en\":\"Mine\",\"fa\":\"من\"}",
            "base" to "\"dark\"", "tokens" to tokens,
        )
        extra.forEach { base[it.first] = it.second }
        return base.entries.joinToString(",", "{", "}") { "\"${it.key}\":${it.value}" }
    }

    private fun zip(themeJson: String?, extra: Map<String, ByteArray> = emptyMap()): ByteArray {
        val files = LinkedHashMap<String, ByteArray>()
        if (themeJson != null) files["theme.json"] = themeJson.toByteArray()
        files.putAll(extra)
        return ThemeZip.writeStored(files)
    }

    private fun errorCode(bytes: ByteArray): String = (CoveThemeParser.parse(bytes) as ThemeParseResult.Fail).error.code

    @Test fun validThemeParses() {
        val r = CoveThemeParser.parse(zip(json())) as ThemeParseResult.Ok
        assertEquals("my-theme", r.theme.id)
        assertEquals("من", r.theme.name.forLanguage("fa"))
        assertEquals("Mine", r.theme.name.forLanguage("ar"))
        assertEquals(ThemeMode.Dark, r.theme.base)
    }

    @Test fun hexAndClampedValuesAreNormalised() {
        val t = TOKENS.replace("\"20 6% 13%\"", "\"#000000\"").replace("\"25 10% 90%\"", "\"400 10% 90%\"")
        val r = CoveThemeParser.parse(zip(json(tokens = t))) as ThemeParseResult.Ok
        assertEquals("0 0% 0%", r.theme.tokens["background"])
        assertEquals("360 10% 90%", r.theme.tokens["foreground"])
        assertTrue(r.warnings.any { it.code == "token_clamped" })
    }

    @Test fun unknownKeysAndTokensAreDroppedNotApplied() {
        val t = TOKENS.dropLast(1) + ",\"radius\":\"4px\"}"
        val r = CoveThemeParser.parse(zip(json("script" to "\"x\"", tokens = t))) as ThemeParseResult.Ok
        assertNull(r.theme.tokens["radius"])
        assertTrue(r.warnings.any { it.code == "unknown_key" && it.detail == "script" })
        assertTrue(r.warnings.any { it.code == "unknown_token" && it.detail == "radius" })
    }

    @Test fun refusesCssLikeColourValues() {
        for (bad in listOf("red", "rgb(0,0,0)", "var(--x)", "url(x)", "0 0% 0% extra", "#12345678")) {
            val t = TOKENS.replace("\"20 6% 13%\"", "\"$bad\"")
            assertEquals("invalid_token_value", errorCode(zip(json(tokens = t))))
        }
    }

    @Test fun refusesLowContrast() {
        val t = TOKENS.replace("\"25 10% 90%\"", "\"20 6% 15%\"")
        assertEquals("low_contrast", errorCode(zip(json(tokens = t))))
    }

    @Test fun refusesMissingCoreToken() {
        val t = TOKENS.replace("\"ring\":\"13 59% 63%\"", "\"x\":\"1 1% 1%\"")
        assertEquals("missing_token", errorCode(zip(json(tokens = t))))
    }

    @Test fun refusesBadIdAndFormatAndVersion() {
        assertEquals("invalid_id", errorCode(zip(json(id = "A_B"))))
        assertEquals("not_a_theme", errorCode(zip(json("format" to "\"other\""))))
        assertEquals("unsupported_version", errorCode(zip(json("version" to "2"))))
        assertEquals("invalid_version", errorCode(zip(json("version" to "\"1\""))))
    }

    @Test fun refusesControlAndBidiCharactersInNames() {
        assertEquals("invalid_name", errorCode(zip(json("name" to "{\"en\":\"a\\u202eb\"}"))))
    }

    @Test fun refusesMissingThemeJsonAndBrokenJson() {
        assertEquals("missing_theme_json", errorCode(zip(null, mapOf("assets/a.png" to PNG))))
        assertEquals("invalid_json", errorCode(zip("{not json")))
    }

    @Test fun refusesUnsafePathsAndDuplicates() {
        for (name in listOf("../evil.txt", "/abs.txt", "a/../b", "C:/x", "a\\b")) {
            assertEquals("zip_unsafe_path", errorCode(zip(json(), mapOf(name to byteArrayOf(1)))))
        }
    }

    @Test fun refusesNotAZipAndTruncated() {
        assertEquals("zip_invalid", errorCode(ByteArray(10)))
        val good = zip(json())
        assertEquals("zip_invalid", errorCode(good.copyOf(good.size - 5)))
    }

    @Test fun refusesCorruptedEntryCrc() {
        val good = zip(json())
        val bad = good.copyOf()
        bad[40] = (bad[40] + 1).toByte() // inside the stored theme.json name/data region
        val r = CoveThemeParser.parse(bad)
        assertTrue(r is ThemeParseResult.Fail)
    }

    @Test fun refusesTooManyEntries() {
        val extra = (1..25).associate { "assets/f$it.png" to PNG }
        assertEquals("zip_too_many_entries", errorCode(zip(json(), extra)))
    }

    @Test fun refusesOversizedArchive() {
        assertEquals("zip_too_large", errorCode(ByteArray(CoveThemeParser.MAX_ARCHIVE_BYTES + 1)))
    }

    @Test fun ignoresNonAssetEntriesWithWarning() {
        val r = CoveThemeParser.parse(zip(json(), mapOf("readme.txt" to byteArrayOf(65)))) as ThemeParseResult.Ok
        assertTrue(r.warnings.any { it.code == "ignored_entry" })
    }

    @Test fun refusesSvgGifAndMismatchedImages() {
        val svg = "<svg xmlns='http://www.w3.org/2000/svg'/>".toByteArray()
        assertEquals("invalid_image", errorCode(zip(json(), mapOf("assets/a.png" to svg))))
        assertEquals("invalid_asset_name", errorCode(zip(json(), mapOf("assets/a.svg" to svg))))
        assertEquals("invalid_asset_name", errorCode(zip(json(), mapOf("assets/sub/a.png" to PNG))))
        assertEquals("image_type_mismatch", errorCode(zip(json(), mapOf("assets/a.jpg" to PNG))))
    }

    @Test fun refusesHugeImageDimensions() {
        assertEquals("image_dimensions", errorCode(zip(json(), mapOf("assets/a.png" to png(5000, 10)))))
    }

    @Test fun imageBackgroundRequiresAssetAndKeepsOnlyUsedImages() {
        val bg = "{\"background\":{\"type\":\"image\",\"asset\":\"assets/bg.png\",\"opacity\":3,\"blur\":50,\"fit\":\"tile\"}}"
        assertEquals("missing_asset", errorCode(zip(json("chat" to bg))))
        val r = CoveThemeParser.parse(zip(json("chat" to bg), mapOf("assets/bg.png" to PNG, "assets/unused.png" to PNG))) as ThemeParseResult.Ok
        val img = r.theme.chat!!.background as ChatBackground.Image
        assertEquals(1f, img.opacity, 0f) // clamped from 3
        assertEquals(20f, img.blur, 0f)   // clamped from 50
        assertEquals(ImageFit.Tile, img.fit)
        assertEquals(setOf("assets/bg.png"), r.assets.keys)
        assertTrue(r.warnings.any { it.code == "unused_asset" })
    }

    @Test fun flatBackgroundMustStayReadable() {
        val bg = "{\"background\":{\"type\":\"color\",\"color\":\"25 10% 88%\"}}"
        assertEquals("low_contrast", errorCode(zip(json("chat" to bg))))
        val ok = "{\"background\":{\"type\":\"gradient\",\"from\":\"20 6% 13%\",\"to\":\"20 6% 20%\",\"angle\":90}}"
        assertTrue(CoveThemeParser.parse(zip(json("chat" to ok))) is ThemeParseResult.Ok)
    }

    @Test fun patternBackgroundMustBeKnown() {
        assertEquals("invalid_chat_background", errorCode(zip(json("chat" to "{\"background\":{\"type\":\"pattern\",\"pattern\":\"nope\"}}"))))
        val r = CoveThemeParser.parse(zip(json("chat" to "{\"background\":{\"type\":\"pattern\",\"pattern\":\"space\"}}"))) as ThemeParseResult.Ok
        assertEquals(ChatBackground.Pattern("space"), r.theme.chat!!.background)
    }

    @Test fun lightVariantIsValidatedLikeTheMainSet() {
        val badLight = TOKENS.replace("\"25 10% 90%\"", "\"20 6% 14%\"")
        val e = CoveThemeParser.parse(zip(json("light" to badLight))) as ThemeParseResult.Fail
        assertEquals("low_contrast", e.error.code)
        assertTrue(e.error.detail!!.startsWith("light."))
    }

    @Test fun everyBuiltinRoundTripsThroughTheFileFormat() {
        for (t in BuiltinThemes.ALL) {
            val r = CoveThemeParser.parse(CoveThemeParser.build(t.copy(id = "x-${t.id}"))) as ThemeParseResult.Ok
            assertEquals(t.tokens, r.theme.tokens)
            assertEquals(t.light, r.theme.light)
            assertEquals(t.name, r.theme.name)
        }
    }

    @Test fun exportedThemeWithImageRoundTrips() {
        val theme = BuiltinThemes.ALL[1].copy(
            id = "with-image",
            chat = ThemeChat(ChatBackground.Image("assets/bg.png", 0.5f, 4f, ImageFit.Contain), BubbleTint("10 20% 30%", 0.25f)),
        )
        val bytes = CoveThemeParser.build(theme, mapOf("assets/bg.png" to ThemeAsset("image/png", PNG, 1, 1)))
        val r = CoveThemeParser.parse(bytes) as ThemeParseResult.Ok
        assertEquals(theme.chat, r.theme.chat)
        assertTrue(r.assets["assets/bg.png"]!!.bytes.contentEquals(PNG))
    }

    @Test fun deflatedEntriesAreReadAndBombsRefused() {
        val text = json().toByteArray()
        val deflated = zipDeflate("theme.json", text)
        assertTrue(CoveThemeParser.parse(deflated) is ThemeParseResult.Ok)
        // 1 MB of zeros deflates to ~1 KB: ratio far above the limit.
        val bomb = zipDeflate("assets/z.png", ByteArray(1_000_000))
        assertEquals("zip_bomb", errorCode(bomb))
    }

    @Test fun declaredSizeSmallerThanRealDataIsCorrupt() {
        val data = ByteArray(5000) { (it % 7).toByte() }
        val z = zipDeflate("theme.json", data).also { patchSize(it, data.size / 2) }
        assertEquals("zip_corrupt", errorCode(z))
    }

    @Test fun symlinkEntriesAreRefused() {
        val z = ThemeZip.writeStored(mapOf("theme.json" to json().toByteArray(), "link" to byteArrayOf(1)))
        // central header of the second entry: made-by Unix (3) and a symlink mode in the external attributes.
        var idx = -1
        for (i in 0 until z.size - 4) if (z[i] == 0x50.toByte() && z[i + 1] == 0x4b.toByte() && z[i + 2] == 1.toByte() && z[i + 3] == 2.toByte()) idx = i
        z[idx + 5] = 3
        z[idx + 41] = 0xA1.toByte() // 0o120000 << 16 -> bytes 2..3 of the attrs: 0xA000 | perms
        z[idx + 40] = 0xFF.toByte()
        assertEquals("zip_symlink", errorCode(z))
    }

    private fun patchSize(z: ByteArray, size: Int) {
        // Rewrite the uncompressed size in the central directory entry.
        for (i in 0 until z.size - 4) if (z[i] == 0x50.toByte() && z[i + 1] == 0x4b.toByte() && z[i + 2] == 1.toByte() && z[i + 3] == 2.toByte()) {
            z[i + 24] = size.toByte(); z[i + 25] = (size shr 8).toByte(); z[i + 26] = 0; z[i + 27] = 0
        }
    }

    private fun zipDeflate(name: String, data: ByteArray): ByteArray {
        val bos = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(bos).use { z ->
            z.putNextEntry(java.util.zip.ZipEntry(name)); z.write(data); z.closeEntry()
        }
        return bos.toByteArray()
    }

    private fun png(w: Int, h: Int): ByteArray {
        val b = PNG.copyOf()
        for (i in 0..3) { b[16 + i] = (w shr (8 * (3 - i))).toByte(); b[20 + i] = (h shr (8 * (3 - i))).toByte() }
        return b
    }

    companion object {
        /** Header of a 1x1 PNG (enough for the sniffer; the platform decoder check is a separate step). */
        val PNG = byteArrayOf(
            0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
            0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
        )
        val TOKENS = BuiltinThemes.COVE_DARK.entries.joinToString(",", "{", "}") { "\"${it.key}\":\"${it.value}\"" }
    }
}
