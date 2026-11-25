package com.cove.chat.ui.components

import com.cove.chat.data.remote.ApiErrors
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RussianTranslationsTest {
    private val cyrillic = Regex("[а-яА-ЯёЁ]")
    private val placeholder = Regex("\\{\\{?[a-z]+\\}?\\}")

    @After fun resetLanguage() {
        AppLanguage.code = "en"
    }

    private fun ru(text: String): String {
        AppLanguage.code = "ru"
        return AppLanguage.translate(text)
    }

    @Test fun hasEveryKeyThatPersianAndArabicHave() {
        val missing = (Translations.fa.keys + Translations.ar.keys) - Translations.ru.keys
        assertTrue("ru is missing ${missing.size}: $missing", missing.isEmpty())
    }

    @Test fun coversEveryAdminAndApiErrorString() {
        val missing = (AdminEn.values + ApiErrors.en.values).filter { it !in Translations.ru }
        assertTrue("ru is missing: $missing", missing.isEmpty())
    }

    @Test fun valuesAreRussianRatherThanEnglishCopies() {
        // Product names, file names and endonyms that are written the same way in Russian.
        val unchanged = setOf("Cove Client", "config.toml", "English", "Bluetooth", "Whisper")
        val copies = Translations.ru.filter { (k, v) -> k !in unchanged && !cyrillic.containsMatchIn(v) }
        assertTrue("not translated: $copies", copies.isEmpty())
    }

    @Test fun placeholdersAndOuterSpacesSurvive() {
        for ((english, russian) in Translations.ru) {
            assertEquals(english, placeholder.findAll(english).map { it.value }.toSet(), placeholder.findAll(russian).map { it.value }.toSet())
            assertEquals("leading space of '$english'", english.startsWith(" "), russian.startsWith(" "))
            assertEquals("trailing space of '$english'", english.endsWith(" "), russian.endsWith(" "))
        }
    }

    @Test fun tableLookupUsesRussian() {
        assertEquals("Отмена", ru("Cancel"))
        assertEquals("Русский", ru("Russian"))
    }

    @Test fun russianIsLeftToRight() {
        AppLanguage.code = "ru"
        assertTrue(!AppLanguage.isRtl)
    }

    @Test fun stringsFoundEnglishOnADeviceAreTranslated() {
        assertEquals("Написать в #Команда", ru("Message #Команда"))
        assertEquals("Написать @bob", ru("Message @bob"))
        assertEquals("Скачать 4,7 MB", ru("Download 4,7 MB"))
        for (key in listOf("Profile photos", "Description (optional)", "Add photo", "Download Voice Note", "made with ❤️ by ")) {
            assertTrue(key, cyrillic.containsMatchIn(ru(key)))
        }
    }

    @Test fun countsUsePluralForms() {
        assertEquals("1 участник", ru("1 members"))
        assertEquals("3 участника", ru("3 members"))
        assertEquals("11 участников", ru("11 members"))
        assertEquals("21 участник", ru("21 members"))
        assertEquals("Добавить 1 участника", ru("Add 1 member"))
        assertEquals("Добавить 2 участников", ru("Add 2 members"))
        assertEquals("Добавить 21 участника", ru("Add 21 members"))
        assertEquals("2 минуты назад", ru("2 min ago"))
        assertEquals("5 часов назад", ru("5 h ago"))
        assertEquals("21 день назад", ru("21 d ago"))
        assertEquals("Приватный · 4 участника", ru("Private · 4 members"))
        assertEquals("2 команды", ru("2 commands"))
        assertEquals("В 21 канале", ru("In 21 channels"))
        assertEquals("В 5 каналах", ru("In 5 channels"))
        assertEquals("Достигнут лимит: 21 бот.", ru("You have reached the limit of 21 bots."))
    }

    @Test fun everyPatternRendersRussian() {
        val samples = listOf(
            "Created Jan 5", "Message #general", "Download 4,7 MB", "Add 5 members", "Couldn't add bob: nope", "5 min ago", "5 h ago", "5 d ago",
            "Too many attempts. Try again in 5 s", "Sign bob out of your account?", "5 members", "5 in call",
            "Public · 5 members", "ADMIN — 5", "Pending (5)", "Replying to bob", "Welcome to #general!",
            "This is the start of the #general channel.", "This is the beginning of your direct message history with bob.",
            "Connecting to: host", "Start a Whisper with bob",
            "bob wants to start an end-to-end encrypted Whisper. Nothing is stored on the server.", "Waiting for bob to accept…",
            "If this matches the number on bob's device, nobody is intercepting your Whisper.", "Friend request sent to bob.",
            "Voice message · 0:05", "Recording  0:05", "Sent a file: a.txt", "You: hi",
            "Sent a voice message (play it on the web or desktop client)", "Sent a photo",
            "Clear your messages with bob? This only affects your side; bob keeps its own copy. The chat stays in your list.",
            "Remove the chat with bob from your list? You can start it again from Explore > Bots; the old messages stay hidden.",
            "Block bob? It can no longer message you or be started until you unblock it.", "bob blocked", "5 commands",
            "bob is offline right now. It will answer when it is back.", "Manage bob", "Remove bob from this channel?", "Remove bob",
            "Delete bob? It is removed from every channel and its token stops working. Its past messages stay.",
            "bob is offline and cannot answer right now.", "In 5 channels", "You have reached the limit of 5 bots.",
            "Missing value for \"x\".", "\"x\" has an invalid value.", "Unexpected value \"x\".", "\"x\" must be one of its listed choices.",
        )
        val used = mutableSetOf<Pattern>()
        for (sample in samples) {
            used += Translations.patterns.first { it.regex.matches(sample) }
            val out = ru(sample)
            assertTrue("$sample -> $out", cyrillic.containsMatchIn(out))
        }
        assertEquals("every pattern needs a sample", Translations.patterns.size, used.size)
    }
}
