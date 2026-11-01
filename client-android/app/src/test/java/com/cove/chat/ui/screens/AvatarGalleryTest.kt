package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class AvatarGalleryTest {
    @Test
    fun usesTheListWhenThereIsOne() {
        assertEquals(listOf("a", "b"), galleryOf("a", listOf("a", "b")))
    }

    @Test
    fun olderAccountsOnlyHaveTheSinglePhoto() {
        assertEquals(listOf("a"), galleryOf("a", null))
        assertEquals(listOf("a"), galleryOf("a", emptyList()))
        assertEquals(emptyList<String>(), galleryOf(null, null))
        assertEquals(emptyList<String>(), galleryOf("", null))
    }

    @Test
    fun aNewPhotoBecomesTheMainOneAndTheOldestFallsOffAtTheLimit() {
        assertEquals(listOf("n", "a", "b"), galleryAfterUpload(listOf("a", "b"), "n"))
        val full = listOf("1", "2", "3", "4", "5")
        assertEquals(listOf("n", "1", "2", "3", "4"), galleryAfterUpload(full, "n"))
        assertEquals(MAX_AVATARS, galleryAfterUpload(full, "n").size)
    }

    @Test
    fun promotingMovesAPhotoToTheFrontKeepingTheRestInOrder() {
        assertEquals(listOf("c", "a", "b"), promoteInGallery(listOf("a", "b", "c"), "c"))
        assertEquals(listOf("a", "b"), promoteInGallery(listOf("a", "b"), "a"))
    }

    @Test
    fun removingTheMainPhotoLetsTheNextOneTakeOver() {
        assertEquals(listOf("b", "c"), galleryAfterRemove(listOf("a", "b", "c"), "a"))
        assertEquals(listOf("a", "c"), galleryAfterRemove(listOf("a", "b", "c"), "b"))
        assertEquals(emptyList<String>(), galleryAfterRemove(listOf("a"), "a"))
    }
}
