package com.cove.chat.bots

import com.cove.chat.bots.BotLogic.KeyboardMode
import com.cove.chat.bots.BotLogic.Parsed
import com.cove.chat.bots.BotLogic.Reason
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BotLogicTest {
    private fun cmd(name: String, bot: String = "dice", options: List<CommandOption> = emptyList()) =
        ChannelCommand("$bot-id", bot, name, name, options)

    private val roll = cmd(
        "roll", "dice", listOf(
            CommandOption("sides", "n", "integer", true, listOf(CommandChoice("d6", "6"), CommandChoice("d20", "20"))),
            CommandOption("loud", "l", "boolean"),
            CommandOption("note", "n", "string")
        )
    )
    private val ping = cmd("ping")

    // ── bot messages ──

    @Test fun parsesTextAndButtons() {
        val body = BotLogic.parseBotMessage(
            """{"v":1,"text":"pick","buttons":[[{"label":"Yes","custom_id":"y","style":"primary"},{"label":"Docs","url":"https://example.com"}]]}"""
        )!!
        assertEquals("pick", body.text)
        assertEquals(2, body.buttons[0].size)
        assertEquals("primary", body.buttons[0][0].style)
        assertEquals("y", body.buttons[0][0].customId)
    }

    @Test fun rejectsBodiesThatAreNotBotMessages() {
        for (bad in listOf(null, "", "plain text", "[1,2]", """{"v":1}""", """{"text":5}""")) assertNull(bad.toString(), BotLogic.parseBotMessage(bad))
    }

    @Test fun dropsMalformedAndUnsafeButtons() {
        val body = BotLogic.parseBotMessage(
            """{"text":"x","buttons":[[
              {"label":"both","custom_id":"a","url":"https://e.com"},
              {"label":"neither"},
              {"label":"js","url":"javascript:alert(1)"},
              {"label":"  ","custom_id":"b"},
              {"label":"ok","custom_id":"ok","style":"weird"}],"nope",[]]}"""
        )!!
        assertEquals(1, body.buttons.size)
        assertEquals(listOf(BotButton("ok", "secondary", "ok", null, false)), body.buttons[0])
    }

    @Test fun capsTheGridAtFiveByFive() {
        val row = (0 until 8).joinToString(",") { """{"label":"b$it","custom_id":"b$it"}""" }
        val grid = (0 until 8).joinToString(",") { "[$row]" }
        val body = BotLogic.parseBotMessage("""{"text":"x","buttons":[$grid]}""")!!
        assertEquals(5, body.buttons.size)
        assertEquals(5, body.buttons[0].size)
    }

    @Test fun onlyHttpAndHttpsLinksAreSafe() {
        assertTrue(BotLogic.isSafeButtonUrl("https://example.com/a?b=1"))
        assertTrue(BotLogic.isSafeButtonUrl("http://example.com"))
        for (bad in listOf("javascript:alert(1)", "data:text/html,hi", "ftp://x.y", "not a url", "//example.com", "https://u:p@example.com", "", "intent://x#Intent;end"))
            assertFalse(bad, BotLogic.isSafeButtonUrl(bad))
    }

    @Test fun previewAndNames() {
        assertEquals("hello", BotLogic.preview("""{"text":"hello"}"""))
        assertEquals("", BotLogic.preview("garbage"))
        for (ok in listOf("ab", "pingbot", "my-bot_2", "a.b")) assertTrue(ok, BotLogic.isValidBotName(ok))
        for (bad in listOf("", "a", "Admin", "-bot", "has space", "a".repeat(33), "bot!")) assertFalse(bad, BotLogic.isValidBotName(bad))
    }

    // ── slash commands ──

    @Test fun slashQueryIsTheNameBeingTyped() {
        assertEquals("", BotLogic.slashQuery("/"))
        assertEquals("ro", BotLogic.slashQuery("/ro"))
        assertNull(BotLogic.slashQuery("/roll "))
        assertNull(BotLogic.slashQuery("hi /x"))
        assertNull(BotLogic.slashQuery(""))
    }

    @Test fun filterPutsPrefixMatchesFirstAndCaps() {
        val cs = listOf(cmd("reroll"), cmd("roll"), cmd("rock"), cmd("ping"))
        assertEquals(listOf("roll", "rock", "reroll"), BotLogic.filterCommands(cs, "ro").map { it.name })
        assertEquals(4, BotLogic.filterCommands(cs, "").size)
        assertEquals(8, BotLogic.filterCommands((0 until 20).map { cmd("c$it") }, "c").size)
    }

    @Test fun tokenizerKeepsQuotedPartsTogether() {
        assertEquals(listOf("a", "b c", "note:x y", "z w"), BotLogic.tokenizeArgs("""a "b c" note:"x y" 'z w'"""))
        assertEquals(emptyList<String>(), BotLogic.tokenizeArgs("   "))
        assertEquals(listOf(""), BotLogic.tokenizeArgs("\"\""))
    }

    @Test fun unknownCommandsAndPlainTextAreOrdinaryMessages() {
        val cs = listOf(roll, ping)
        for (t in listOf("hello", "/shrug", "/")) assertEquals(t, Parsed.None, BotLogic.parseSlashInput(t, cs))
    }

    @Test fun parsesOptionsByNameAndPosition() {
        val cs = listOf(roll, ping)
        assertEquals(Parsed.Ok(ping, emptyMap()), BotLogic.parseSlashInput("/ping", cs))
        val r = BotLogic.parseSlashInput("""/roll 20 loud:yes note:"big one"""", cs) as Parsed.Ok
        assertEquals(JsonPrimitive(20L), r.options["sides"])
        assertEquals(JsonPrimitive(true), r.options["loud"])
        assertEquals(JsonPrimitive("big one"), r.options["note"])
        assertEquals(JsonPrimitive(6L), (BotLogic.parseSlashInput("/roll sides:6", cs) as Parsed.Ok).options["sides"])
    }

    @Test fun reportsMissingInvalidAndOutOfChoiceValues() {
        val cs = listOf(roll)
        fun err(t: String) = BotLogic.parseSlashInput(t, cs) as Parsed.Error
        assertEquals(Reason.Missing to "sides", err("/roll").let { it.reason to it.option })
        assertEquals(Reason.Invalid to "sides", err("/roll abc").let { it.reason to it.option })
        assertEquals(Reason.NotAChoice to "sides", err("/roll 7").let { it.reason to it.option })
        assertEquals(Reason.UnknownOption, err("/roll 6 yes extra more").reason)
    }

    @Test fun pickingABotWhenTwoShareAName() {
        val a = cmd("ping", "dice")
        val b = cmd("ping", "other")
        val r = BotLogic.parseSlashInput("/ping@other", listOf(a, b)) as Parsed.Ok
        assertEquals("other", r.command.botUsername)
        assertEquals(Parsed.None, BotLogic.parseSlashInput("/ping@nobody", listOf(a, b)))
        assertEquals("/ping@other ", BotLogic.commandInsertText(b, listOf(a, b)))
        assertEquals("/roll ", BotLogic.commandInsertText(roll, listOf(roll, ping)))
    }

    @Test fun resolvesUserOptions() {
        val hug = cmd("hug", "b", listOf(CommandOption("who", "w", "user", true)))
        val ok = BotLogic.parseSlashInput("/hug @alice", listOf(hug)) { if (it == "alice") "id-1" else null } as Parsed.Ok
        assertEquals(JsonPrimitive("id-1"), ok.options["who"])
        assertEquals(Reason.Invalid, (BotLogic.parseSlashInput("/hug @bob", listOf(hug)) { null } as Parsed.Error).reason)
    }

    @Test fun usageLineMarksRequiredAndOptional() {
        assertEquals("/roll <sides> [loud] [note]", BotLogic.usageLine(roll))
        assertEquals("/ping", BotLogic.usageLine(ping))
    }

    // ── action menu ──

    private fun kb(botId: String = "b1", persistent: Boolean = false, oneTime: Boolean = false, label: String = "A") =
        BotKeyboard(botId, "bot", listOf(listOf(BotButton(label, customId = "a"))), persistent = persistent, oneTime = oneTime)

    @Test fun noKeyboardShowsNothing() {
        assertEquals(BotLogic.KeyboardView(false, false), BotLogic.keyboardView(null, null))
    }

    @Test fun newKeyboardOpensAsTheMenuAndOnlyPersistentOnesKeepAToggle() {
        assertEquals(BotLogic.KeyboardView(true, false), BotLogic.keyboardView(kb(), null))
        assertEquals(BotLogic.KeyboardView(true, false), BotLogic.keyboardView(kb(), KeyboardMode.Menu))
        assertEquals(BotLogic.KeyboardView(false, false), BotLogic.keyboardView(kb(), KeyboardMode.Typing))
        assertEquals(BotLogic.KeyboardView(false, true), BotLogic.keyboardView(kb(persistent = true), KeyboardMode.Typing))
    }

    @Test fun oneTimeKeyboardsCloseAfterAPress() {
        assertEquals(KeyboardMode.Typing, BotLogic.modeAfterPress(kb(oneTime = true), null))
        assertNull(BotLogic.modeAfterPress(kb(), null))
        assertEquals(KeyboardMode.Menu, BotLogic.modeAfterPress(kb(), KeyboardMode.Menu))
    }

    @Test fun signatureChangesWithTheButtonsNotThePlaceholder() {
        val a = BotLogic.keyboardSignature(kb())
        assertEquals(a, BotLogic.keyboardSignature(kb().copy(placeholder = "x")))
        assertTrue(a != BotLogic.keyboardSignature(kb(label = "B")))
    }

    @Test fun keyboardUpdatesReplaceOrRemoveABotsKeyboard() {
        val one = kb("b1")
        val two = kb("b2")
        val replaced = BotLogic.applyKeyboardUpdate(listOf(one, two), KeyboardUpdate("c", "b1", kb("b1", label = "Z")))
        assertEquals(listOf("b2", "b1"), replaced.map { it.botId })
        assertEquals(listOf("b2"), BotLogic.applyKeyboardUpdate(replaced, KeyboardUpdate("c", "b1", null)).map { it.botId })
        assertEquals("b1", BotLogic.pickActiveKeyboard(listOf(one, two))?.botId)
        assertNull(BotLogic.pickActiveKeyboard(emptyList()))
    }

    @Test fun scopeLabelKey() {
        assertEquals("messages_send", BotLogic.scopeLabelKey(BotScopes.SEND))
    }
}
