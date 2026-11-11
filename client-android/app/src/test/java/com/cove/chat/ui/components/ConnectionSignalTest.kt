package com.cove.chat.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionSignalTest {
    @Test
    fun offlineBeatsLatency() {
        assertEquals(ConnectionLevel.Offline, connectionLevel(false, 20))
    }

    @Test
    fun connectedWithoutASampleIsMeasuring() {
        assertEquals(ConnectionLevel.Measuring, connectionLevel(true, null))
    }

    @Test
    fun bucketsByRoundTripTime() {
        assertEquals(ConnectionLevel.Good, connectionLevel(true, 99))
        assertEquals(ConnectionLevel.Average, connectionLevel(true, 100))
        assertEquals(ConnectionLevel.Average, connectionLevel(true, 249))
        assertEquals(ConnectionLevel.Poor, connectionLevel(true, 250))
    }

    @Test
    fun litBarsFollowTheLevel() {
        assertEquals(0, connectionBars(ConnectionLevel.Offline))
        assertEquals(3, connectionBars(ConnectionLevel.Good))
        assertEquals(2, connectionBars(ConnectionLevel.Average))
        assertEquals(1, connectionBars(ConnectionLevel.Poor))
    }
}
