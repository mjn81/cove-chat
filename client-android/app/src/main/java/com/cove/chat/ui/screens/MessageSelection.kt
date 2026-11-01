package com.cove.chat.ui.screens

/** The two facts about a selected message that decide which bulk actions make sense. */
data class SelectedMessage(val senderId: String, val type: String)

/**
 * What the selection bar offers for the current selection (Telegram-style): delete only when the user may delete
 * every selected message, forward and copy only when all of them are text, reply and edit only for a single message.
 */
class SelectionActions internal constructor(
    private val selected: List<SelectedMessage>,
    private val isAdmin: Boolean
) {
    /** Delete shows when every selected message is the user's own, or the user is a channel admin. */
    fun canDelete(me: String): Boolean = selected.isNotEmpty() && selected.all { it.senderId == me || isAdmin }

    /** Forward shows when every selected message can be re-sent (see [isForwardable]). */
    val canForward: Boolean get() = selected.isNotEmpty() && selected.all { isForwardable(it.type) }

    /** Copy needs plain text from every message. */
    val canCopy: Boolean get() = selected.isNotEmpty() && selected.all { it.type == "text" }
    val canReply: Boolean get() = selected.size == 1

    /** Edit shows for exactly one text message of the user's own. */
    fun canEdit(me: String): Boolean = selected.size == 1 && selected[0].senderId == me && selected[0].type == "text"
}

/** Message types that can be forwarded: text, invitations, and every media message (re-encrypted for the target chat). */
fun isForwardable(type: String): Boolean = type == "text" || type == "invite" || type == "file" || type == "voice" || type == "video"

/** Builds the [SelectionActions] for [selected]; [isAdmin] is true for channel admins and owners. */
fun selectionActions(selected: List<SelectedMessage>, isAdmin: Boolean) = SelectionActions(selected, isAdmin)

/** Adds [id] to the selection, or removes it when it is already selected. */
fun toggleSelected(current: Set<String>, id: String): Set<String> = if (id in current) current - id else current + id
