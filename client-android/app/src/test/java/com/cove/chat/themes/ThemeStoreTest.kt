package com.cove.chat.themes

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ThemeStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun bytes(id: String) = CoveThemeParser.build(BuiltinThemes.byId("nord")!!.copy(id = id, name = LocalizedName("Mine $id")))

    @Test fun installLoadListDelete() {
        val store = ThemeStore(File(tmp.root, "themes"))
        val r = store.install(bytes("my-theme")) as InstallResult.Installed
        assertEquals(false, r.replaced)
        assertEquals("my-theme", store.load("my-theme")!!.definition.id)
        assertEquals(listOf("my-theme"), store.list().map { it.definition.id })
        assertEquals(true, (store.install(bytes("my-theme")) as InstallResult.Installed).replaced)
        assertTrue(store.delete("my-theme"))
        assertNull(store.load("my-theme"))
    }

    @Test fun reservedBuiltinIdsAreRefused() {
        val store = ThemeStore(File(tmp.root, "themes"))
        val r = store.install(CoveThemeParser.build(BuiltinThemes.byId("nord")!!)) as InstallResult.Refused
        assertEquals("reserved_id", r.error.code)
    }

    @Test fun undecodableImageRefusesTheTheme() {
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)
        val theme = BuiltinThemes.byId("nord")!!.copy(id = "img-theme", chat = ThemeChat(ChatBackground.Image("assets/a.png", 1f, 0f, ImageFit.Cover)))
        val archive = CoveThemeParser.build(theme, mapOf("assets/a.png" to ThemeAsset("image/png", png, 1, 1)))
        val strict = ThemeStore(File(tmp.root, "a")) { false }
        assertEquals("image_undecodable", (strict.install(archive) as InstallResult.Refused).error.code)
        val lenient = ThemeStore(File(tmp.root, "b")) { true }
        assertNotNull((lenient.install(archive) as InstallResult.Installed).theme.assets["assets/a.png"])
    }

    @Test fun tamperedStoredFileIsNotLoaded() {
        val dir = File(tmp.root, "themes").apply { mkdirs() }
        File(dir, "evil.covetheme").writeBytes(byteArrayOf(1, 2, 3))
        File(dir, "other.covetheme").writeBytes(bytes("different-id")) // id does not match the file name
        val store = ThemeStore(dir)
        assertNull(store.load("evil"))
        assertNull(store.load("other"))
        assertTrue(store.list().isEmpty())
    }

    @Test fun idsThatCouldEscapeTheFolderAreRejected() {
        val store = ThemeStore(File(tmp.root, "themes"))
        assertNull(store.load("../x"))
        assertEquals(false, store.delete("../x"))
    }

    @Test fun builtinsExportAsCopies() {
        val store = ThemeStore(File(tmp.root, "themes"))
        val (name, data) = store.exportBytes(BuiltinThemes.byId("dracula")!!)
        assertEquals("dracula-copy.covetheme", name)
        assertTrue(CoveThemeParser.parse(data) is ThemeParseResult.Ok)
    }
}
