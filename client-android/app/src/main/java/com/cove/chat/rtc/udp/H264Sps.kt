package com.cove.chat.rtc.udp

/**
 * Reads the picture size from the SPS NAL unit of an Annex-B H.264 access unit. MediaCodec decoders learn the size
 * from the stream, but libwebrtc's decoder wrapper wants the dimensions with every keyframe and re-initialises the
 * codec when they change, so the receiver needs them up front (and a mid-call rotation or resolution change must be
 * noticed). Only the fields that determine the size are decoded.
 */
object H264Sps {
    class Size(val width: Int, val height: Int)

    /** Whether the Annex-B data contains an IDR slice (type 5), i.e. the frame can start decoding. */
    fun containsIdr(annexB: ByteArray): Boolean = nalTypes(annexB).any { it == 5 }

    /** NAL unit types in order of appearance. */
    fun nalTypes(annexB: ByteArray): List<Int> {
        val out = ArrayList<Int>()
        var i = 0
        while (i + 3 < annexB.size) {
            if (annexB[i].toInt() == 0 && annexB[i + 1].toInt() == 0 && annexB[i + 2].toInt() == 1) {
                out.add(annexB[i + 3].toInt() and 0x1F)
                i += 3
            } else i++
        }
        return out
    }

    /** The coded picture size (after cropping) of the first SPS in [annexB], or null if there is none or it is unusable. */
    fun size(annexB: ByteArray): Size? {
        var i = 0
        while (i + 3 < annexB.size) {
            if (annexB[i].toInt() == 0 && annexB[i + 1].toInt() == 0 && annexB[i + 2].toInt() == 1 && (annexB[i + 3].toInt() and 0x1F) == 7) {
                var end = i + 4
                while (end + 2 < annexB.size && !(annexB[end].toInt() == 0 && annexB[end + 1].toInt() == 0 && (annexB[end + 2].toInt() == 1 || annexB[end + 2].toInt() == 0))) end++
                if (end + 2 >= annexB.size) end = annexB.size
                return runCatching { parse(unescape(annexB, i + 4, end)) }.getOrNull()
            }
            i++
        }
        return null
    }

    /** Removes emulation prevention bytes (00 00 03 -> 00 00). */
    private fun unescape(b: ByteArray, from: Int, to: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(to - from)
        var zeros = 0
        for (k in from until to) {
            val v = b[k].toInt() and 0xFF
            if (zeros >= 2 && v == 3) { zeros = 0; continue }
            out.write(v)
            zeros = if (v == 0) zeros + 1 else 0
        }
        return out.toByteArray()
    }

    private class Bits(val d: ByteArray) {
        var pos = 0
        fun bit(): Int {
            if (pos >= d.size * 8) throw IllegalStateException("SPS truncated")
            val v = (d[pos shr 3].toInt() shr (7 - (pos and 7))) and 1
            pos++
            return v
        }
        fun bits(n: Int): Int { var v = 0; repeat(n) { v = (v shl 1) or bit() }; return v }
        fun ue(): Int {
            var zeros = 0
            while (bit() == 0) { zeros++; if (zeros > 31) throw IllegalStateException("bad exp-golomb") }
            return if (zeros == 0) 0 else ((1 shl zeros) - 1) + bits(zeros)
        }
        fun se(): Int { val k = ue(); return if (k and 1 == 1) (k + 1) / 2 else -(k / 2) }
    }

    private fun skipScalingList(r: Bits, size: Int) {
        var last = 8
        var next = 8
        for (j in 0 until size) {
            if (next != 0) { next = (last + r.se() + 256) % 256 }
            last = if (next == 0) last else next
        }
    }

    private fun parse(rbsp: ByteArray): Size {
        val r = Bits(rbsp)
        val profile = r.bits(8)
        r.bits(8) // constraint flags + reserved
        r.bits(8) // level_idc
        r.ue() // seq_parameter_set_id
        var chromaFormat = 1
        if (profile in HIGH_PROFILES) {
            chromaFormat = r.ue()
            if (chromaFormat == 3) r.bit() // separate_colour_plane_flag
            r.ue(); r.ue() // bit depths
            r.bit() // qpprime_y_zero_transform_bypass_flag
            if (r.bit() == 1) { // seq_scaling_matrix_present_flag
                val lists = if (chromaFormat != 3) 8 else 12
                for (k in 0 until lists) if (r.bit() == 1) skipScalingList(r, if (k < 6) 16 else 64)
            }
        }
        r.ue() // log2_max_frame_num_minus4
        when (r.ue()) { // pic_order_cnt_type
            0 -> r.ue()
            1 -> { r.bit(); r.se(); r.se(); repeat(r.ue()) { r.se() } }
        }
        r.ue() // max_num_ref_frames
        r.bit() // gaps_in_frame_num_value_allowed_flag
        val widthMbs = r.ue() + 1
        val heightMapUnits = r.ue() + 1
        val frameMbsOnly = r.bit()
        if (frameMbsOnly == 0) r.bit() // mb_adaptive_frame_field_flag
        r.bit() // direct_8x8_inference_flag
        var cl = 0; var cr = 0; var ct = 0; var cb = 0
        if (r.bit() == 1) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue() }
        val subW = if (chromaFormat == 1 || chromaFormat == 2) 2 else 1
        val subH = if (chromaFormat == 1) 2 else 1
        val cropUnitX = if (chromaFormat == 0) 1 else subW
        val cropUnitY = (if (chromaFormat == 0) 1 else subH) * (2 - frameMbsOnly)
        val width = widthMbs * 16 - cropUnitX * (cl + cr)
        val height = (2 - frameMbsOnly) * heightMapUnits * 16 - cropUnitY * (ct + cb)
        if (width <= 0 || height <= 0 || width > 8192 || height > 8192) throw IllegalStateException("implausible size")
        return Size(width, height)
    }

    private val HIGH_PROFILES = setOf(100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135)
}
