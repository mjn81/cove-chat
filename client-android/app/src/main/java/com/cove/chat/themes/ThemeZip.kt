package com.cove.chat.themes

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.Inflater

/** Limits applied while reading an untrusted archive (see `docs/covetheme-format.md`). */
data class ZipLimits(
    val maxArchiveBytes: Int,
    val maxEntries: Int,
    val maxEntryBytes: Int,
    val maxTotalBytes: Long,
    val maxRatio: Int,
    /** Entries up to this expanded size are exempt from the ratio rule (tiny JSON compresses well legitimately). */
    val ratioFloorBytes: Int,
)

/** Outcome of [ThemeZip.read]. */
sealed interface ZipResult {
    data class Ok(val entries: Map<String, ByteArray>) : ZipResult
    data class Fail(val error: ThemeIssue) : ZipResult
}

/**
 * Hardened ZIP reader for untrusted archives (port of `themes/utils/zip-reader.ts`): everything is validated from the
 * central directory before any data is inflated, and inflation writes into a buffer of exactly the declared size.
 * ZIP64, multi-disk archives, encrypted entries, symlinks and methods other than stored/deflate are refused.
 */
object ThemeZip {
    private const val EOCD_SIG = 0x06054b50
    private const val CEN_SIG = 0x02014b50
    private const val LOC_SIG = 0x04034b50
    private const val MAX_NAME_BYTES = 200

    private fun fail(code: String, detail: String? = null) = ZipResult.Fail(ThemeIssue(code, detail))

    /** CRC-32 of [data] (exposed for tests that build archives by hand). */
    fun crc32(data: ByteArray): Long = CRC32().also { it.update(data) }.value

    private fun isSafeName(name: String): Boolean {
        if (name.isEmpty() || name.length > MAX_NAME_BYTES) return false
        if (name.any { it.code < 0x20 || it.code == 0x7f || it == '\\' }) return false
        if (name.startsWith("/") || (name.length >= 2 && name[0].isLetter() && name[1] == ':')) return false
        val trimmed = name.removeSuffix("/")
        return trimmed.split('/').all { it.isNotEmpty() && it != "." && it != ".." }
    }

    private class Central(
        val name: String, val method: Int, val crc: Long, val compressedSize: Long, val size: Long, val offset: Long, val isDir: Boolean,
    )

    /** Reads the archive; returns the file entries (directories omitted) or the first problem found. */
    fun read(bytes: ByteArray, limits: ZipLimits): ZipResult {
        if (bytes.size > limits.maxArchiveBytes) return fail("zip_too_large")
        if (bytes.size < 22) return fail("zip_invalid")
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        fun u16(o: Int) = buf.getShort(o).toInt() and 0xffff
        fun u32(o: Int) = buf.getInt(o).toLong() and 0xffffffffL

        var eocd = -1
        val min = maxOf(0, bytes.size - 22 - 0xffff)
        var i = bytes.size - 22
        while (i >= min) { if (buf.getInt(i) == EOCD_SIG) { eocd = i; break }; i-- }
        if (eocd < 0) return fail("zip_invalid")

        val diskNo = u16(eocd + 4)
        val cdDisk = u16(eocd + 6)
        val entriesOnDisk = u16(eocd + 8)
        val totalEntries = u16(eocd + 10)
        val cdSize = u32(eocd + 12)
        val cdOffset = u32(eocd + 16)
        if (totalEntries == 0xffff || cdSize == 0xffffffffL || cdOffset == 0xffffffffL) return fail("zip_unsupported", "zip64")
        if (diskNo != 0 || cdDisk != 0 || entriesOnDisk != totalEntries) return fail("zip_unsupported", "multi-disk")
        if (totalEntries > limits.maxEntries) return fail("zip_too_many_entries")
        if (cdOffset + cdSize > eocd) return fail("zip_invalid")

        val central = ArrayList<Central>()
        var p = cdOffset.toInt()
        repeat(totalEntries) {
            if (p + 46 > eocd || buf.getInt(p) != CEN_SIG) return fail("zip_invalid")
            val madeBy = u16(p + 4)
            val flags = u16(p + 8)
            val method = u16(p + 10)
            val crc = u32(p + 16)
            val compressedSize = u32(p + 20)
            val size = u32(p + 24)
            val nameLen = u16(p + 28)
            val extraLen = u16(p + 30)
            val commentLen = u16(p + 32)
            val externalAttrs = u32(p + 38)
            val offset = u32(p + 42)
            if (nameLen > MAX_NAME_BYTES) return fail("zip_unsafe_path")
            if (p + 46 + nameLen + extraLen + commentLen > eocd) return fail("zip_invalid")
            val name = try {
                Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes, p + 46, nameLen)).toString()
            } catch (e: java.nio.charset.CharacterCodingException) { return fail("zip_unsafe_path") }
            if (!isSafeName(name)) return fail("zip_unsafe_path")
            if (flags and 1 != 0 || flags and 0x40 != 0) return fail("zip_encrypted")
            // "Version made by" high byte 3 = Unix: the file mode is in the top half of the external attributes.
            if (madeBy ushr 8 == 3 && ((externalAttrs ushr 16) and 0xF000L) == 0xA000L) return fail("zip_symlink", name)
            if (method != 0 && method != 8) return fail("zip_unsupported", "method $method")
            if (compressedSize == 0xffffffffL || size == 0xffffffffL || offset == 0xffffffffL) return fail("zip_unsupported", "zip64")
            central += Central(name, method, crc, compressedSize, size, offset, name.endsWith("/"))
            p += 46 + nameLen + extraLen + commentLen
        }

        val seen = HashSet<String>()
        var total = 0L
        for (e in central) {
            if (!seen.add(e.name.lowercase())) return fail("zip_duplicate", e.name)
            if (e.isDir) continue
            if (e.size > limits.maxEntryBytes) return fail("zip_bomb", e.name)
            total += e.size
            if (total > limits.maxTotalBytes) return fail("zip_bomb")
            if (e.size > limits.ratioFloorBytes && e.size.toDouble() / maxOf(1L, e.compressedSize) > limits.maxRatio) return fail("zip_bomb", e.name)
        }

        // Locate each entry's data and make sure no two entries share bytes (overlap is how "quine" bombs multiply).
        class Span(val start: Long, val end: Long, val entry: Central, val dataStart: Int)
        val spans = ArrayList<Span>()
        for (e in central) {
            if (e.isDir) continue
            if (e.offset + 30 > cdOffset || buf.getInt(e.offset.toInt()) != LOC_SIG) return fail("zip_invalid", e.name)
            val dataStart = e.offset.toInt() + 30 + u16(e.offset.toInt() + 26) + u16(e.offset.toInt() + 28)
            val end = dataStart + e.compressedSize
            if (end > cdOffset) return fail("zip_invalid", e.name)
            spans += Span(e.offset, end, e, dataStart)
        }
        spans.sortBy { it.start }
        for (k in 1 until spans.size) if (spans[k].start < spans[k - 1].end) return fail("zip_overlap")

        val entries = LinkedHashMap<String, ByteArray>()
        for (s in spans) {
            val e = s.entry
            val data: ByteArray
            if (e.method == 0) {
                if (e.compressedSize != e.size) return fail("zip_corrupt", e.name)
                data = bytes.copyOfRange(s.dataStart, s.dataStart + e.size.toInt())
            } else {
                val out = ByteArray(e.size.toInt())
                val inflater = Inflater(true)
                try {
                    inflater.setInput(bytes, s.dataStart, e.compressedSize.toInt())
                    var n = 0
                    // Fixed-size output: a stream that tries to inflate past the declared size never gets more room.
                    while (n < out.size) {
                        val r = inflater.inflate(out, n, out.size - n)
                        if (r == 0) { if (inflater.finished() || inflater.needsInput() || inflater.needsDictionary()) break }
                        n += r
                    }
                    if (n != out.size || !inflater.finished() && inflater.inflate(ByteArray(1)) != 0) return fail("zip_corrupt", e.name)
                } catch (ex: java.util.zip.DataFormatException) {
                    return fail("zip_corrupt", e.name)
                } finally { inflater.end() }
                data = out
            }
            if (crc32(data) != e.crc) return fail("zip_corrupt", e.name)
            entries[e.name] = data
        }
        return ZipResult.Ok(entries)
    }

    /** Writes a ZIP with stored (uncompressed) entries: enough for `.covetheme` export (images are already compressed). */
    fun writeStored(files: Map<String, ByteArray>): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val central = java.io.ByteArrayOutputStream()
        fun le(os: java.io.ByteArrayOutputStream, v: Long, n: Int) { for (b in 0 until n) os.write(((v ushr (8 * b)) and 0xff).toInt()) }
        for ((name, data) in files) {
            val nameBytes = name.toByteArray(Charsets.UTF_8)
            val crc = crc32(data)
            val offset = out.size().toLong()
            le(out, LOC_SIG.toLong() and 0xffffffffL, 4); le(out, 20, 2); le(out, 0x0800, 2); le(out, 0, 2); le(out, 0, 2); le(out, 0x21, 2)
            le(out, crc, 4); le(out, data.size.toLong(), 4); le(out, data.size.toLong(), 4); le(out, nameBytes.size.toLong(), 2); le(out, 0, 2)
            out.write(nameBytes); out.write(data)
            le(central, CEN_SIG.toLong() and 0xffffffffL, 4); le(central, 20, 2); le(central, 20, 2); le(central, 0x0800, 2); le(central, 0, 2)
            le(central, 0, 2); le(central, 0x21, 2); le(central, crc, 4); le(central, data.size.toLong(), 4); le(central, data.size.toLong(), 4)
            le(central, nameBytes.size.toLong(), 2); le(central, 0, 2); le(central, 0, 2); le(central, 0, 2); le(central, 0, 2); le(central, 0, 4)
            le(central, offset, 4); central.write(nameBytes)
        }
        val cdOffset = out.size().toLong()
        out.write(central.toByteArray())
        le(out, EOCD_SIG.toLong() and 0xffffffffL, 4); le(out, 0, 2); le(out, 0, 2); le(out, files.size.toLong(), 2); le(out, files.size.toLong(), 2)
        le(out, central.size().toLong(), 4); le(out, cdOffset, 4); le(out, 0, 2)
        return out.toByteArray()
    }
}
