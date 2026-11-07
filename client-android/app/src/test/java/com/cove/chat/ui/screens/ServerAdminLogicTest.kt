package com.cove.chat.ui.screens

import com.cove.chat.data.model.ServerUpdateInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAdminLogicTest {
    private fun info(state: String, current: String = "0.10.0") = ServerUpdateInfo(currentVersion = current, state = state)

    @Test fun mirrorsServerJobWhenNotTheStarter() {
        assertEquals(ServerUpdateStage.DOWNLOADING, serverUpdateStage(info("downloading"), null, false))
        assertEquals(ServerUpdateStage.IDLE, serverUpdateStage(info("failed"), null, false))
        assertEquals(ServerUpdateStage.IDLE, serverUpdateStage(null, null, true))
    }

    @Test fun starterTracksTargetVersion() {
        assertEquals(ServerUpdateStage.DONE, serverUpdateStage(info("idle", "0.11.0"), "0.11.0", false))
        assertEquals(ServerUpdateStage.DOWNLOADING, serverUpdateStage(info("idle", "0.10.0"), "0.11.0", false))
        assertEquals(ServerUpdateStage.FAILED, serverUpdateStage(info("failed"), "0.11.0", false))
        assertEquals(ServerUpdateStage.RECONNECTING, serverUpdateStage(info("restarting"), "0.11.0", true))
        assertEquals(ServerUpdateStage.INSTALLING, serverUpdateStage(info("installing"), "0.11.0", false))
    }

    @Test fun busyOnlyWhileRunning() {
        assertTrue(isUpdateBusy(ServerUpdateStage.RECONNECTING))
        assertFalse(isUpdateBusy(ServerUpdateStage.DONE))
        assertFalse(isUpdateBusy(ServerUpdateStage.FAILED))
        assertFalse(isUpdateBusy(ServerUpdateStage.IDLE))
    }

    @Test fun checksumInputIsClassified() {
        val digest = "A".repeat(64)
        assertEquals("a".repeat(64), classifyChecksumInput("  $digest \n").sha256)
        val sums = "$digest  cove-server.zip"
        assertEquals(sums, classifyChecksumInput(sums).sums)
        assertNull(classifyChecksumInput("   ").sha256)
        assertNull(classifyChecksumInput("   ").sums)
    }

    @Test fun releaseNotesAreShortened() {
        assertEquals("short", previewReleaseNotes(" short "))
        assertEquals("abc…", previewReleaseNotes("abcdef", 3))
    }

    @Test fun restartStage() {
        assertEquals(ServerRestartStage.IDLE, serverRestartStage(false, true, 5, 100))
        assertEquals(ServerRestartStage.RESTARTING, serverRestartStage(true, false, null, 100))
        assertEquals(ServerRestartStage.DONE, serverRestartStage(true, true, 500, 100))
        assertEquals(ServerRestartStage.DONE, serverRestartStage(true, false, 3, 100))
        assertEquals(ServerRestartStage.RESTARTING, serverRestartStage(true, false, 120, 100))
    }
}
