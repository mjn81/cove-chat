package com.cove.chat.ui.screens

import com.cove.chat.data.model.Relationship

/** How the signed-in user relates to someone else; mirrors web `relation-state.ts`. */
enum class RelationState { None, Friend, Requested, Incoming, Blocked }

/**
 * Works out the relationship with [userId] from the two lists the API returns: relationships the user created
 * ([outgoing]: friend / requested / blocked) and friend requests addressed to them ([incoming]). A block always wins
 * over a pending incoming request, so a blocked person can never be accepted by accident from a profile.
 */
fun relationStateOf(userId: String, outgoing: List<Relationship>, incoming: List<Relationship>): RelationState {
    when (outgoing.firstOrNull { it.toUserId == userId }?.type) {
        "friend" -> return RelationState.Friend
        "requested" -> return RelationState.Requested
        "blocked" -> return RelationState.Blocked
    }
    return if (incoming.any { it.fromUserId == userId }) RelationState.Incoming else RelationState.None
}
