package com.cove.chat.themes

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RussianThemeTest {
    private val cyrillic = Regex("[а-яА-ЯёЁ]")

    /** The same names as the web client's built-in themes. */
    @Test fun builtInThemesHaveRussianNames() {
        assertEquals(
            listOf(
                "Cove", "Фиолетовая ночь", "Горизонт", "Багрянец", "Nord", "Catppuccin", "Dracula", "Solarized",
                "Gruvbox", "Черный AMOLED", "Бумага",
            ),
            BuiltinThemes.ALL.map { it.name.forLanguage("ru") },
        )
    }

    @Test fun russianNameIsExported() {
        val name = CoveThemeParser.toJson(BuiltinThemes.byId("paper")!!)["name"]!!.jsonObject
        assertEquals(BuiltinThemes.byId("paper")!!.name.ru, name["ru"]!!.jsonPrimitive.content)
    }

    @Test fun russianNameIsOptionalAndSurvivesARoundTrip() {
        val mine = BuiltinThemes.byId("nord")!!.copy(id = "mine", name = LocalizedName("Mine", ru = "Моя"))
        val parsed = CoveThemeParser.parse(CoveThemeParser.build(mine)) as ThemeParseResult.Ok
        assertEquals("Моя", parsed.theme.name.forLanguage("ru"))
        assertTrue(parsed.warnings.toString(), parsed.warnings.isEmpty())
        assertNull(LocalizedName("Mine").ru)
        assertEquals("Mine", LocalizedName("Mine").forLanguage("ru"))
    }

    @Test fun everyIssueHasRussianText() {
        assertEquals(emptySet<String>(), ThemeIssueText.codes("en") - ThemeIssueText.codes("ru"))
        val text = ThemeIssueText.message(ThemeIssue("missing_token", "ring"), "ru")
        assertTrue(text, cyrillic.containsMatchIn(text) && "ring" in text)
    }
}
