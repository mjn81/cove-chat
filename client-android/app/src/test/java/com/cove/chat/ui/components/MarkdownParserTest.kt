package com.cove.chat.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownParserTest {
    private fun t(s: String) = MdInline.Text(s)

    @Test
    fun safeHrefAllowsOnlyHttpHttpsAndMailto() {
        assertEquals("https://example.com/a?b=1", safeHref("https://example.com/a?b=1"))
        assertEquals("mailto:a@b.co", safeHref("mailto:a@b.co"))
        assertNull(safeHref("javascript:alert(1)"))
        assertNull(safeHref("  JaVaScRiPt:alert(1)"))
        assertNull(safeHref("data:text/html;base64,AAAA"))
        assertNull(safeHref("file:///etc/passwd"))
        assertNull(safeHref("/relative"))
        assertNull(safeHref("https://x.com/a b"))
    }

    @Test
    fun parsesEmphasisAndCode() {
        assertEquals(
            listOf(
                t("a "), MdInline.Styled(MdInline.Kind.Bold, listOf(t("b"))), t(" "),
                MdInline.Styled(MdInline.Kind.Italic, listOf(t("c"))), t(" "),
                MdInline.Styled(MdInline.Kind.Strike, listOf(t("e"))), t(" "), MdInline.Code("f")
            ),
            parseInline("a **b** *c* ~~e~~ `f`")
        )
    }

    @Test
    fun leavesCasualMarkersAlone() {
        for (s in listOf("2 * 3 * 4", "snake_case_name", "a ** b", "**unclosed", "price is 5*", "~~")) {
            assertEquals(s, listOf(t(s)), parseInline(s))
        }
    }

    @Test
    fun nestsEmphasis() {
        assertEquals(
            listOf(MdInline.Styled(MdInline.Kind.Bold, listOf(t("a "), MdInline.Styled(MdInline.Kind.Italic, listOf(t("b")))))),
            parseInline("**a *b***")
        )
    }

    @Test
    fun linksOnlyForSafeTargets() {
        assertEquals(listOf(MdInline.Link("https://x.com", listOf(t("site")))), parseInline("[site](https://x.com)"))
        assertEquals(listOf(t("click")), parseInline("[click](javascript:alert(1))"))
    }

    @Test
    fun autoLinksKeepMarkersOut() {
        assertEquals(
            listOf(MdInline.Styled(MdInline.Kind.Bold, listOf(MdInline.Auto("https://x.com/a_b_c", "https://x.com/a_b_c")))),
            parseInline("**https://x.com/a_b_c**")
        )
        assertEquals(
            listOf(t("hi "), MdInline.Mention("@john_doe"), t(" "), MdInline.Auto("me@x.org", "mailto:me@x.org")),
            parseInline("hi @john_doe me@x.org")
        )
    }

    @Test
    fun rawHtmlStaysLiteral() {
        val s = "<img src=x onerror=alert(1)>"
        assertEquals(listOf(t(s)), parseInline(s))
    }

    @Test
    fun chatKeepsNewlinesAndDoesNotMakeHeadingsOrLists() {
        assertEquals(listOf<MdBlock>(MdBlock.Text(listOf(t("# hi\n- x")))), parseMarkdown("# hi\n- x"))
    }

    @Test
    fun extractsFencedCodeAndTreatsUnclosedFenceAsText() {
        assertEquals(
            listOf(MdBlock.Text(listOf(t("before"))), MdBlock.Code("const a = 1;\n**x**", "ts"), MdBlock.Text(listOf(t("after")))),
            parseMarkdown("before\n```ts\nconst a = 1;\n**x**\n```\nafter")
        )
        assertEquals(listOf<MdBlock>(MdBlock.Text(listOf(t("```\nnope")))), parseMarkdown("```\nnope"))
    }

    @Test
    fun parsesQuotes() {
        val q = parseMarkdown("> hi\n> second").single() as MdBlock.Quote
        assertEquals(listOf<MdBlock>(MdBlock.Text(listOf(t("hi\nsecond")))), q.children)
    }

    @Test
    fun parsesReleasePleaseNotes() {
        val md = listOf(
            "## [0.11.2](https://github.com/o/r/compare/v0.11.1...v0.11.2) (2026-11-10)",
            "",
            "### Features",
            "",
            "* **web:** add themes ([#12](https://github.com/o/r/issues/12)) ([abc1234](https://github.com/o/r/commit/abc1234))",
            "* plain item"
        ).joinToString("\n")
        val blocks = parseMarkdown(md, MdMode.Document)
        assertEquals(3, blocks.size)
        assertTrue(blocks[0] is MdBlock.Heading && blocks[1] is MdBlock.Heading)
        val list = blocks[2] as MdBlock.ListBlock
        assertEquals(2, list.items.size)
        val first = list.items[0][0] as MdBlock.Text
        assertEquals(MdInline.Styled(MdInline.Kind.Bold, listOf(t("web:"))), first.children[0])
        val hrefs = first.children.filterIsInstance<MdInline.Link>().map { it.href }
        assertEquals(listOf("https://github.com/o/r/issues/12", "https://github.com/o/r/commit/abc1234"), hrefs)
    }

    @Test
    fun nestsListsByIndentation() {
        val list = parseMarkdown("1. one\n   - nested\n2. two", MdMode.Document).single() as MdBlock.ListBlock
        assertTrue(list.ordered)
        assertEquals(2, list.items.size)
        assertEquals(listOf("Text", "ListBlock"), list.items[0].map { it::class.simpleName })
    }

    @Test
    fun survivesHostileInput() {
        val nasty = "[".repeat(500) + "*".repeat(500) + "`".repeat(50) + ">".repeat(20) + "\n- ".repeat(100)
        parseMarkdown(nasty, MdMode.Document)
        parseMarkdown(nasty, MdMode.Chat)
    }

    @Test
    fun stripMarkdownRemovesMarkers() {
        assertEquals("hi code x z", stripMarkdown("**hi** `code` [x](https://a.b) ~~z~~"))
        assertEquals("quoted block", stripMarkdown("> quoted\n```\nblock\n```"))
    }
}
