package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageSelectionTest {
    private fun mine(type: String = "text") = SelectedMessage("me", type)
    private fun theirs(type: String = "text") = SelectedMessage("other", type)

    @Test
    fun deleteIsOfferedOnlyWhenEverySelectedMessageIsYours() {
        assertTrue(selectionActions(listOf(mine(), mine("voice")), isAdmin = false).canDelete(me = "me"))
        assertFalse(selectionActions(listOf(mine(), theirs()), isAdmin = false).canDelete(me = "me"))
        assertFalse(selectionActions(listOf(theirs()), isAdmin = false).canDelete(me = "me"))
    }

    @Test
    fun adminsCanAlsoDeleteOthersMessages() {
        assertTrue(selectionActions(listOf(mine(), theirs()), isAdmin = true).canDelete(me = "me"))
    }

    @Test
    fun forwardWorksForTextAndMediaButCopyNeedsEveryMessageToBeText() {
        val allText = selectionActions(listOf(mine(), theirs()), isAdmin = false)
        assertTrue(allText.canForward)
        assertTrue(allText.canCopy)
        val mixed = selectionActions(listOf(mine(), theirs("voice"), theirs("file"), theirs("video"), theirs("invite")), isAdmin = false)
        assertTrue(mixed.canForward)
        assertFalse(mixed.canCopy)
        assertFalse(selectionActions(listOf(mine(), theirs("sticker")), isAdmin = false).canForward)
    }

    @Test
    fun replyAndEditNeedExactlyOneMessage() {
        assertTrue(selectionActions(listOf(theirs()), isAdmin = false).canReply)
        assertFalse(selectionActions(listOf(theirs(), mine()), isAdmin = false).canReply)
        assertTrue(selectionActions(listOf(mine()), isAdmin = false).canEdit(me = "me"))
        assertFalse(selectionActions(listOf(theirs()), isAdmin = false).canEdit(me = "me"))
        assertFalse(selectionActions(listOf(mine("voice")), isAdmin = false).canEdit(me = "me"))
    }

    @Test
    fun anEmptySelectionOffersNothing() {
        val none = selectionActions(emptyList(), isAdmin = true)
        assertFalse(none.canDelete(me = "me"))
        assertFalse(none.canForward)
        assertFalse(none.canCopy)
        assertFalse(none.canReply)
    }

    @Test
    fun togglingAddsAndRemovesAnId() {
        assertEquals(setOf("a"), toggleSelected(emptySet(), "a"))
        assertEquals(setOf("a", "b"), toggleSelected(setOf("a"), "b"))
        assertEquals(setOf("b"), toggleSelected(setOf("a", "b"), "a"))
    }
}
