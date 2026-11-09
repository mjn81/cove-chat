package com.cove.chat.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class RootRouteTest {
    @Test fun signOutLandsOnLoginOrServerSelection() {
        assertEquals("login", rootAfterSignOut(hasServer = true))
        assertEquals("server", rootAfterSignOut(hasServer = false))
    }
}
