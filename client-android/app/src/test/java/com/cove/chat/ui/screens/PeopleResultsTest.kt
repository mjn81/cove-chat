package com.cove.chat.ui.screens

import com.cove.chat.data.model.UserSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class PeopleResultsTest {
    private fun user(id: String) = UserSummary(id = id, username = id)

    @Test
    fun dropsYourselfAndPeopleYouAlreadyHaveADmWith() {
        val found = listOf(user("me"), user("sara"), user("omar"))
        val people = peopleToStart(found, me = "me", dmPeers = setOf("sara"))
        assertEquals(listOf("omar"), people.map { it.id })
    }

    @Test
    fun keepsTheServersOrder() {
        val found = listOf(user("b"), user("a"), user("c"))
        assertEquals(listOf("b", "a", "c"), peopleToStart(found, me = "me", dmPeers = emptySet()).map { it.id })
    }

    @Test
    fun showsPeopleOnlyOnAllAndDirectMessagesOnceSomethingIsTyped() {
        assertEquals(true, showsPeople(SearchFilter.All, "sa"))
        assertEquals(true, showsPeople(SearchFilter.Dms, "sa"))
        assertEquals(false, showsPeople(SearchFilter.Channels, "sa"))
        assertEquals(false, showsPeople(SearchFilter.Explore, "sa"))
        assertEquals(false, showsPeople(SearchFilter.All, ""))
        assertEquals(false, showsPeople(SearchFilter.Dms, "   "))
    }
}
