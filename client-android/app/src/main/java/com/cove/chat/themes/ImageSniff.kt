package com.cove.chat.themes

/** What a header sniff learned about an image. */
data class SniffedImage(val mime: String, val width: Int, val height: Int)

/**
 * Identifies PNG, JPEG and WebP from their first bytes and reads the pixel size from the header (port of
 * `themes/utils/image-sniff.ts`). Everything else (SVG, GIF, HTML, archives) is null whatever the file name says.
 */
object ImageSniff {
    private fun u8(b: ByteArray, o: Int) = b[o].toInt() and 0xff
    private fun be32(b: ByteArray, o: Int) = (u8(b, o).toLong() shl 24) or (u8(b, o + 1).toLong() shl 16) or (u8(b, o + 2).toLong() shl 8) or u8(b, o + 3).toLong()
    private fun be16(b: ByteArray, o: Int) = (u8(b, o) shl 8) or u8(b, o + 1)
    private fun le16(b: ByteArray, o: Int) = u8(b, o) or (u8(b, o + 1) shl 8)
    private fun le24(b: ByteArray, o: Int) = u8(b, o) or (u8(b, o + 1) shl 8) or (u8(b, o + 2) shl 16)
    private fun ascii(b: ByteArray, o: Int, s: String) = s.indices.all { u8(b, o + it) == s[it].code }

    private fun clampInt(v: Long) = if (v > Int.MAX_VALUE) Int.MAX_VALUE else v.toInt()

    private fun png(b: ByteArray): SniffedImage? {
        val sig = intArrayOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        if (b.size < 24 || !sig.indices.all { u8(b, it) == sig[it] } || !ascii(b, 12, "IHDR")) return null
        return SniffedImage("image/png", clampInt(be32(b, 16)), clampInt(be32(b, 20)))
    }

    private fun jpeg(b: ByteArray): SniffedImage? {
        if (b.size < 4 || u8(b, 0) != 0xff || u8(b, 1) != 0xd8 || u8(b, 2) != 0xff) return null
        var o = 2
        while (o + 4 <= b.size) {
            if (u8(b, o) != 0xff) return null
            val marker = u8(b, o + 1)
            if (marker == 0xff) { o += 1; continue }
            val len = be16(b, o + 2)
            // SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
            if (marker in 0xc0..0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc) {
                if (o + 9 > b.size) return null
                return SniffedImage("image/jpeg", be16(b, o + 7), be16(b, o + 5))
            }
            if (len < 2) return null
            o += 2 + len
        }
        return null
    }

    private fun webp(b: ByteArray): SniffedImage? {
        if (b.size < 25 || !ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP")) return null
        if (ascii(b, 12, "VP8X")) {
            if (b.size < 30) return null
            return SniffedImage("image/webp", le24(b, 24) + 1, le24(b, 27) + 1)
        }
        if (ascii(b, 12, "VP8L")) {
            if (u8(b, 20) != 0x2f) return null
            val bits = (u8(b, 21).toLong()) or (u8(b, 22).toLong() shl 8) or (u8(b, 23).toLong() shl 16) or (u8(b, 24).toLong() shl 24)
            return SniffedImage("image/webp", ((bits and 0x3fff) + 1).toInt(), (((bits ushr 14) and 0x3fff) + 1).toInt())
        }
        if (ascii(b, 12, "VP8 ")) {
            if (b.size < 30) return null
            if (u8(b, 23) != 0x9d || u8(b, 24) != 0x01 || u8(b, 25) != 0x2a) return null
            return SniffedImage("image/webp", le16(b, 26) and 0x3fff, le16(b, 28) and 0x3fff)
        }
        return null
    }

    /** The type and size, or null for anything that is not a well-formed header of an allowed type. */
    fun sniff(bytes: ByteArray): SniffedImage? {
        val found = png(bytes) ?: jpeg(bytes) ?: webp(bytes)
        if (found == null || found.width < 1 || found.height < 1) return null
        return found
    }

    /** True when [bytes] starts like an animated WebP (VP8X with the animation flag) - used by the sticker views. */
    fun isAnimatedWebp(bytes: ByteArray): Boolean =
        bytes.size >= 21 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP") && ascii(bytes, 12, "VP8X") && (u8(bytes, 20) and 0x02) != 0
}
