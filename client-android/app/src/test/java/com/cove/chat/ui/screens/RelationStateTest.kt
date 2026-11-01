package com.cove.chat.ui.screens

import com.cove.chat.data.model.Relationship
import org.junit.Assert.assertEquals
import org.junit.Test

class RelationStateTest {
    private fun outgoing(to: String, type: String) = Relationship(fromUserId = "me", toUserId = to, type = type)
    private fun incomingFrom(from: String) = Relationship(fromUserId = from, toUserId = "me", type = "requested")

    @Test
    fun strangersAreNone() {
        assertEquals(RelationState.None, relationStateOf("u1", emptyList(), emptyList()))
    }

    @Test
    fun readsFriendRequestedAndBlockedFromOutgoing() {
        assertEquals(RelationState.Friend, relationStateOf("u1", listOf(outgoing("u1", "friend")), emptyList()))
        assertEquals(RelationState.Requested, relationStateOf("u1", listOf(outgoing("u1", "requested")), emptyList()))
        assertEquals(RelationState.Blocked, relationStateOf("u1", listOf(outgoing("u1", "blocked")), emptyList()))
    }

    @Test
    fun ignoresRelationshipsWithOtherUsers() {
        assertEquals(RelationState.None, relationStateOf("u1", listOf(outgoing("u2", "friend")), listOf(incomingFrom("u3"))))
    }

    @Test
    fun incomingRequestIsDetected() {
        assertEquals(RelationState.Incoming, relationStateOf("u1", emptyList(), listOf(incomingFrom("u1"))))
    }

    @Test
    fun blockWinsOverAPendingIncomingRequest() {
        assertEquals(RelationState.Blocked, relationStateOf("u1", listOf(outgoing("u1", "blocked")), listOf(incomingFrom("u1"))))
    }
}
