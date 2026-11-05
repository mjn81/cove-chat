package com.cove.chat.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The paged-list envelope of the API standard (section 9): `{ "items": [...], "next_cursor": "<opaque>" }`.
 * `next_cursor` is absent or empty on the last page; the cursor is opaque and only ever echoed back.
 */
@Serializable
data class PageResponse<T>(
    val items: List<T> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null
) {
    /** Whether an older/next page exists. */
    val hasMore: Boolean get() = !nextCursor.isNullOrEmpty()
}

/** Page size asked for when a client wants few round trips (the server maximum). */
const val MAX_PAGE_LIMIT = 100

/**
 * Loads every page of a list the UI needs in full (my channels, relationships) by following `next_cursor`.
 *
 * @param maxPages safety bound against a server that never ends the chain.
 * @param fetch loads one page; receives the previous page's cursor, null for the first page.
 * @return all items in server order.
 */
suspend fun <T> collectAllPages(maxPages: Int = 200, fetch: suspend (cursor: String?) -> PageResponse<T>): List<T> {
    val all = mutableListOf<T>()
    var cursor: String? = null
    repeat(maxPages) {
        val page = fetch(cursor)
        all += page.items
        if (!page.hasMore) return all
        cursor = page.nextCursor
    }
    return all
}
