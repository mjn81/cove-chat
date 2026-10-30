package com.cove.chat.data.local

import android.content.Context
import com.cove.chat.ui.screens.clearImageCache
import java.io.File

/** Everything this device caches for the signed-in account, and how to remove it. */
object LocalData {
    /**
     * Deletes the decrypted attachments, video and voice caches in `cacheDir`, the persisted whisper sessions and
     * the in-memory image cache. Called on sign-out and when the server ends the session, so a signed-out phone
     * keeps no readable content from the account. The session token itself is removed separately by
     * [PreferencesManager.clearAuth].
     */
    fun wipe(context: Context) {
        runCatching { context.cacheDir.listFiles()?.forEach { it.deleteRecursively() } }
        runCatching { File(context.filesDir, "whisper").deleteRecursively() }
        clearImageCache()
    }
}
