package com.cove.chat.data

import com.cove.chat.data.remote.ApiErrors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiErrorsTest {
    private val identity: (String) -> String = { it }

    @Test fun keyBecomesEnglishText() {
        assertEquals("Channel not found.", ApiErrors.localize("apiErrors.channel_not_found", identity))
    }

    @Test fun detailIsFilledIn() {
        assertEquals("File is too large (max 10 MB).", ApiErrors.localize("apiErrors.file_too_large: 10", identity))
    }

    @Test fun translatorSeesTheEnglishText() {
        val out = ApiErrors.localize("apiErrors.search_failed", { ApiErrors.fa[it] ?: it })
        assertEquals(ApiErrors.fa["Search failed."], out)
    }

    @Test fun otherMessagesAreUntouched() {
        assertEquals("channel not found", ApiErrors.localize("channel not found", identity))
        assertEquals("admin.errors.forbidden", ApiErrors.localize("admin.errors.forbidden", identity))
    }

    @Test fun everyEnglishEntryHasBothTranslations() {
        for ((_, english) in ApiErrors.en) {
            assertTrue("fa missing: $english", ApiErrors.fa.containsKey(english))
            assertTrue("ar missing: $english", ApiErrors.ar.containsKey(english))
        }
    }
}
