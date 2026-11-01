package com.cove.chat.ui.screens

import com.cove.chat.data.model.UserSummary

/**
 * People the search can start a conversation with: the server's matches for the query, minus yourself and anyone who
 * already has a direct message with you (those appear under Direct Messages instead). Mirrors the web search.
 *
 * @param dmPeers ids of the other member of each of your direct messages.
 */
fun peopleToStart(found: List<UserSummary>, me: String, dmPeers: Set<String>): List<UserSummary> =
    found.filter { it.id != me && it.id !in dmPeers }

/** People only appear on All and Direct Messages, and only once something has been typed. */
internal fun showsPeople(filter: SearchFilter, query: String): Boolean =
    query.isNotBlank() && (filter == SearchFilter.All || filter == SearchFilter.Dms)
