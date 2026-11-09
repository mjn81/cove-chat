package com.cove.chat.themes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BuiltinThemesTest {
    @Test fun elevenThemesWithUniqueIdsAndCoveFirst() {
        assertEquals(11, BuiltinThemes.ALL.size)
        assertEquals(BuiltinThemes.ALL.size, BuiltinThemes.ALL.map { it.id }.toSet().size)
        assertEquals("cove", BuiltinThemes.ALL.first().id)
    }

    @Test fun everyThemeHasAllCoreTokensAndReadablePairs() {
        for (t in BuiltinThemes.ALL) for (mode in ThemeMode.values()) {
            val tokens = BuiltinThemes.resolve(t, mode).tokens
            for (name in ThemeTokens.ALL) assertTrue("${t.id}/$mode missing $name", tokens[name] != null)
            val (errors, _) = ThemeTokens.checkReadability(tokens)
            assertTrue("${t.id}/$mode unreadable: $errors", errors.isEmpty())
        }
    }

    @Test fun darkOnlyThemeStaysDarkInLightMode() {
        val dracula = BuiltinThemes.byId("dracula")!!
        assertEquals(ThemeMode.Dark, BuiltinThemes.resolve(dracula, ThemeMode.Light).mode)
        assertFalse(BuiltinThemes.supportsBothModes(dracula))
        assertTrue(BuiltinThemes.supportsBothModes(BuiltinThemes.byId("nord")!!))
        assertEquals(ThemeMode.Light, BuiltinThemes.resolve(BuiltinThemes.byId("nord")!!, ThemeMode.Light).mode)
        assertEquals(ThemeMode.Light, BuiltinThemes.resolve(BuiltinThemes.byId("paper")!!, ThemeMode.Dark).mode)
    }

    @Test fun coveMatchesTheOriginalHardCodedColours() {
        // Spot check against Color.kt: --background (dark) #23201F, --primary (light) #C4624A.
        val rgb = ThemeColor.tripletToRgb(BuiltinThemes.COVE_DARK["background"]!!)
        val expected = intArrayOf(0x23, 0x20, 0x1F)
        for (i in 0..2) assertTrue("channel $i: ${rgb[i]}", kotlin.math.abs(rgb[i] - expected[i]) <= 2)
        val p = ThemeColor.tripletToRgb(BuiltinThemes.COVE_LIGHT["primary"]!!)
        val ep = intArrayOf(0xC4, 0x62, 0x4A)
        for (i in 0..2) assertTrue("light primary channel $i: ${p[i]}", kotlin.math.abs(p[i] - ep[i]) <= 3)
    }

    @Test fun colourMathMatchesTheWebImplementation() {
        assertEquals("0 0% 0%", ThemeColor.parse("#000")!!.value)
        assertEquals("210 50% 50%", ThemeColor.parse("210.00 50% 50%")!!.value)
        assertEquals(21.0, ThemeColor.contrast("0 0% 0%", "0 0% 100%"), 0.01)
        assertEquals("0 0% 100%", ThemeColor.pickForeground("0 0% 10%"))
        assertEquals("0 0% 4%", ThemeColor.pickForeground("0 0% 95%"))
    }
}
