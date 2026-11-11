package com.cove.chat.ui.components

/**
 * Safe Markdown subset shared by chat messages and GitHub release notes. A port of client-web `lib/markdown.ts`:
 * keep the two grammars in step. The parser only builds a typed tree (no HTML anywhere), so raw HTML stays literal text,
 * and links are limited to http(s) and mailto.
 */
sealed interface MdInline {
    data class Text(val value: String) : MdInline
    data class Code(val value: String) : MdInline
    data class Styled(val kind: Kind, val children: List<MdInline>) : MdInline
    data class Link(val href: String, val children: List<MdInline>) : MdInline
    /** A bare URL or email found in the text. */
    data class Auto(val value: String, val href: String) : MdInline
    data class Mention(val value: String) : MdInline

    enum class Kind { Bold, Italic, Strike }
}

sealed interface MdBlock {
    data class Text(val children: List<MdInline>) : MdBlock
    data class Code(val value: String, val lang: String) : MdBlock
    data class Quote(val children: List<MdBlock>) : MdBlock
    data class Heading(val level: Int, val children: List<MdInline>) : MdBlock
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<List<MdBlock>>) : MdBlock
    data object Rule : MdBlock
}

/** `Chat` keeps every newline and adds only code blocks and quotes; `Document` is the fuller subset for release notes. */
enum class MdMode { Chat, Document }

private const val MAX_DEPTH = 4
private const val PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

/** The URL when it is safe to open (http, https or mailto), otherwise null: `javascript:`, `data:`, `file:`, relative paths… are refused. */
fun safeHref(raw: String): String? {
    val url = raw.trim()
    if (url.isEmpty() || url.any { it.isWhitespace() || it == '<' || it == '>' || it == '"' || it.code < 32 }) return null
    val lower = url.lowercase()
    return when {
        lower.startsWith("http://") -> url.takeIf { url.length > 7 && url[7] != '/' }
        lower.startsWith("https://") -> url.takeIf { url.length > 8 && url[8] != '/' }
        lower.startsWith("mailto:") -> url.takeIf { url.length > 7 }
        else -> null
    }
}

private fun isSpace(c: Char?) = c == null || c.isWhitespace()
private fun isWord(c: Char?) = c != null && c.isLetterOrDigit()

private fun findBracketEnd(s: String, open: Int): Int {
    var depth = 0
    var i = open
    while (i < s.length) {
        when (s[i]) {
            '\\' -> i++
            '`' -> {
                val end = s.indexOf('`', i + 1)
                if (end != -1) i = end
            }
            '[' -> depth++
            ']' -> if (--depth == 0) return i
        }
        i++
    }
    return -1
}

private fun parseLinkTarget(s: String, open: Int): Pair<String, Int>? {
    var depth = 0
    var i = open
    while (i < s.length) {
        when (s[i]) {
            '\\' -> i++
            '\n' -> return null
            '(' -> depth++
            ')' -> if (--depth == 0) {
                var inner = s.substring(open + 1, i).trim()
                Regex("""^(\S+)\s+("[^"]*"|'[^']*')$""").find(inner)?.let { inner = it.groupValues[1] }
                if (inner.startsWith("<") && inner.endsWith(">")) inner = inner.substring(1, inner.length - 1)
                return inner to i + 1
            }
        }
        i++
    }
    return null
}

private fun findClosing(s: String, from: Int, delim: String): Int {
    val intraword = delim[0] == '_'
    var i = from
    while (i < s.length) {
        val c = s[i]
        if (c == '\\') { i += 2; continue }
        if (c == '`') {
            val end = s.indexOf('`', i + 1)
            if (end != -1) i = end
            i++; continue
        }
        if (!s.startsWith(delim, i)) { i++; continue }
        val prev = s.getOrNull(i - 1)
        if (isSpace(prev) || i == from) { i++; continue }
        if (delim.length == 1 && (s.getOrNull(i + 1) == delim[0] || prev == delim[0])) { i++; continue }
        // In a run like `***` the closer is the last two characters, so the inner single marker can close first.
        if (delim.length == 2 && s.getOrNull(i + 2) == delim[0]) { i++; continue }
        if (intraword && isWord(s.getOrNull(i + delim.length))) { i++; continue }
        return i
    }
    return -1
}

/** Parses inline Markdown; [inLink] is true inside a link label (no auto-links or nested links). */
fun parseInline(s: String, inLink: Boolean = false, depth: Int = 0): List<MdInline> {
    val out = ArrayList<MdInline>()
    val buf = StringBuilder()
    fun flush() {
        if (buf.isEmpty()) return
        val prev = out.lastOrNull()
        if (prev is MdInline.Text) out[out.lastIndex] = MdInline.Text(prev.value + buf) else out.add(MdInline.Text(buf.toString()))
        buf.setLength(0)
    }

    var i = 0
    while (i < s.length) {
        val c = s[i]

        if (c == '\\' && i + 1 < s.length && s[i + 1] in PUNCT) {
            buf.append(s[i + 1]); i += 2; continue
        }

        if (c == '`') {
            var run = 1
            while (s.getOrNull(i + run) == '`') run++
            val fence = "`".repeat(run)
            val end = s.indexOf(fence, i + run)
            if (end != -1 && s.getOrNull(end + run) != '`') {
                var code = s.substring(i + run, end)
                if (Regex("^ .*[^ ].* $").matches(code)) code = code.substring(1, code.length - 1)
                flush(); out.add(MdInline.Code(code))
                i = end + run; continue
            }
            buf.append(fence); i += run; continue
        }

        if (!inLink && !isWord(s.getOrNull(i - 1)) && c != '_' && c != '*' && c != '~' && c != '[' && c != '!') {
            val hit = matchAutoLinkAt(s, i)
            if (hit != null) {
                flush()
                out.add(
                    when (val t = hit.first) {
                        is MessageToken.Mention -> MdInline.Mention(t.value)
                        is MessageToken.Link -> MdInline.Auto(t.value, t.href)
                        is MessageToken.Plain -> MdInline.Text(t.value)
                    }
                )
                i += hit.second; continue
            }
        }

        if (c == '!' && s.getOrNull(i + 1) == '[') {
            // Images are never fetched (privacy): the alt text stands in, linked if the target is safe.
            val end = findBracketEnd(s, i + 1)
            val target = if (end != -1 && s.getOrNull(end + 1) == '(') parseLinkTarget(s, end + 1) else null
            if (target != null) {
                val alt = s.substring(i + 2, end).ifEmpty { target.first }
                val href = safeHref(target.first)
                flush()
                out.add(if (href != null && !inLink) MdInline.Link(href, listOf(MdInline.Text(alt))) else MdInline.Text(alt))
                i = target.second; continue
            }
        }

        if (c == '[') {
            val end = findBracketEnd(s, i)
            val target = if (end != -1 && s.getOrNull(end + 1) == '(') parseLinkTarget(s, end + 1) else null
            if (target != null) {
                val label = s.substring(i + 1, end)
                val href = safeHref(target.first)
                flush()
                if (href != null && !inLink && label.isNotBlank()) out.add(MdInline.Link(href, parseInline(label, true, depth + 1)))
                else out.addAll(parseInline(label, true, depth + 1)) // unsafe target: only the label survives
                i = target.second; continue
            }
        }

        if ((c == '*' || c == '_' || c == '~') && depth < MAX_DEPTH) {
            val double = s.getOrNull(i + 1) == c
            val delim = if (double) "$c$c" else "$c"
            val kind = when {
                c == '~' -> if (double) MdInline.Kind.Strike else null
                double -> MdInline.Kind.Bold
                else -> MdInline.Kind.Italic
            }
            val after = s.getOrNull(i + delim.length)
            val opens = kind != null && !isSpace(after) && after != c && !(c == '_' && isWord(s.getOrNull(i - 1)))
            if (opens) {
                val close = findClosing(s, i + delim.length, delim)
                if (close != -1) {
                    flush()
                    out.add(MdInline.Styled(kind!!, parseInline(s.substring(i + delim.length, close), inLink, depth + 1)))
                    i = close + delim.length; continue
                }
            }
            // Not an opener: emit the whole run so `**` is not retried as two italics.
            var run = 1
            while (s.getOrNull(i + run) == c) run++
            buf.append(c.toString().repeat(run)); i += run; continue
        }

        buf.append(c); i++
    }
    flush()
    return out
}

private val FENCE_OPEN = Regex("""^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$""")
private val HEADING = Regex("""^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$""")
private val HR = Regex("""^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$""")
private val LIST_ITEM = Regex("""^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$""")
private val QUOTE = Regex("""^ {0,3}>[ \t]?(.*)$""")

private fun indentOf(s: String) = s.length - s.trimStart().length

/** Parses block structure of [source] in the given [mode]. */
fun parseMarkdown(source: String, mode: MdMode = MdMode.Chat): List<MdBlock> =
    parseBlocks(source.replace("\r\n", "\n").replace('\r', '\n').split('\n'), mode, 0)

private fun parseBlocks(lines: List<String>, mode: MdMode, depth: Int): List<MdBlock> {
    val doc = mode == MdMode.Document
    val blocks = ArrayList<MdBlock>()
    var text = ArrayList<String>()

    fun flushText() {
        if (text.isEmpty()) return
        if (doc) {
            var para = ArrayList<String>()
            fun endPara() {
                if (para.isNotEmpty()) blocks.add(MdBlock.Text(parseInline(para.joinToString("\n"))))
                para = ArrayList()
            }
            for (l in text) if (l.isNotBlank()) para.add(l.trim()) else endPara()
            endPara()
        } else {
            val joined = text.joinToString("\n")
            if (joined.isNotBlank()) blocks.add(MdBlock.Text(parseInline(joined)))
        }
        text = ArrayList()
    }

    var i = 0
    while (i < lines.size) {
        val line = lines[i]

        val fence = FENCE_OPEN.find(line)
        if (fence != null) {
            val marker = fence.groupValues[1]
            var end = -1
            for (j in i + 1 until lines.size) {
                val t = lines[j].trim()
                if (t.length >= marker.length && t[0] == marker[0] && t.all { it == '`' || it == '~' }) { end = j; break }
            }
            if (end != -1) {
                flushText()
                blocks.add(MdBlock.Code(lines.subList(i + 1, end).joinToString("\n"), fence.groupValues[2]))
                i = end + 1; continue
            }
        }

        if (depth < MAX_DEPTH && QUOTE.containsMatchIn(line)) {
            val inner = ArrayList<String>()
            while (i < lines.size && QUOTE.containsMatchIn(lines[i])) {
                inner.add(QUOTE.find(lines[i])!!.groupValues[1]); i++
            }
            flushText()
            blocks.add(MdBlock.Quote(parseBlocks(inner, mode, depth + 1)))
            continue
        }

        if (doc) {
            val heading = HEADING.find(line)
            if (heading != null) {
                flushText()
                blocks.add(MdBlock.Heading(heading.groupValues[1].length, parseInline(heading.groupValues[2])))
                i++; continue
            }
            if (HR.matches(line)) { flushText(); blocks.add(MdBlock.Rule); i++; continue }
            if (LIST_ITEM.matches(line) && depth < MAX_DEPTH) {
                flushText()
                val (list, next) = parseList(lines, i, mode, depth)
                blocks.add(list); i = next; continue
            }
        }

        text.add(line); i++
    }
    flushText()
    return blocks
}

private fun parseList(lines: List<String>, start: Int, mode: MdMode, depth: Int): Pair<MdBlock, Int> {
    val first = LIST_ITEM.find(lines[start])!!
    val base = indentOf(lines[start])
    val ordered = first.groupValues[2].any { it.isDigit() }
    val items = ArrayList<List<MdBlock>>()
    var i = start

    while (i < lines.size) {
        val m = LIST_ITEM.find(lines[i]) ?: break
        if (indentOf(lines[i]) != base || m.groupValues[2].any { it.isDigit() } != ordered) break
        val body = arrayListOf(m.groupValues[3])
        i++
        while (i < lines.size) {
            val l = lines[i]
            if (l.isBlank()) {
                val nextNonBlank = lines.drop(i + 1).firstOrNull { it.isNotBlank() }
                if (nextNonBlank != null && indentOf(nextNonBlank) > base) { body.add(""); i++; continue }
                break
            }
            if (indentOf(l) > base) {
                body.add(l.substring(minOf(indentOf(l), base + 2))); i++
            } else if (!LIST_ITEM.matches(l) && !HEADING.matches(l) && !QUOTE.containsMatchIn(l) && !FENCE_OPEN.matches(l) && body.last() != "") {
                body.add(l.trim()); i++ // lazy continuation of the item's paragraph
            } else break
        }
        items.add(parseBlocks(body, mode, depth + 1))
        if (i < lines.size && lines[i].isBlank()) {
            val nxt = lines.drop(i).indexOfFirst { it.isNotBlank() }
            if (nxt != -1 && LIST_ITEM.matches(lines[i + nxt]) && indentOf(lines[i + nxt]) == base) i += nxt
        }
    }
    val startNum = if (ordered) first.groupValues[2].takeWhile { it.isDigit() }.toIntOrNull() ?: 1 else 1
    return MdBlock.ListBlock(ordered, startNum, items) to i
}

private fun inlineToPlain(nodes: List<MdInline>): String = nodes.joinToString("") {
    when (it) {
        is MdInline.Text -> it.value
        is MdInline.Code -> it.value
        is MdInline.Auto -> it.value
        is MdInline.Mention -> it.value
        is MdInline.Styled -> inlineToPlain(it.children)
        is MdInline.Link -> inlineToPlain(it.children)
    }
}

private fun blockToPlain(b: MdBlock): String = when (b) {
    is MdBlock.Text -> inlineToPlain(b.children)
    is MdBlock.Heading -> inlineToPlain(b.children)
    is MdBlock.Code -> b.value
    is MdBlock.Quote -> b.children.joinToString(" ") { blockToPlain(it) }
    is MdBlock.ListBlock -> b.items.joinToString(" ") { item -> item.joinToString(" ") { blockToPlain(it) } }
    MdBlock.Rule -> ""
}

/** Strips Markdown markers for one-line previews (reply bars, notifications) so `**hi**` shows as `hi`. */
fun stripMarkdown(source: String): String =
    parseMarkdown(source, MdMode.Chat).joinToString(" ") { blockToPlain(it) }.replace(Regex("\\s+"), " ").trim()
