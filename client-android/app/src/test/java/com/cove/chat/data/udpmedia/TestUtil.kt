package com.cove.chat.data.udpmedia

fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

/** Inputs shared with `backend/tests/udpmedia_vectors_test.go`. */
object Vec {
    val sid = ByteArray(8) { (0xA0 + it).toByte() }
    val shared = ByteArray(32) { it.toByte() }
    val clientNonce = ByteArray(16) { (0x10 + it).toByte() }
    val serverNonce = ByteArray(16) { (0x20 + it).toByte() }
    const val CHANNEL = "chan-1"
    const val USER = "user-1"
    val plain = ByteArray(40) { (it * 3).toByte() }

    fun ring(role: Role, now: () -> Long = { 0L }) = Keyring(role, sid, shared, clientNonce, serverNonce, CHANNEL, USER, now)
}
