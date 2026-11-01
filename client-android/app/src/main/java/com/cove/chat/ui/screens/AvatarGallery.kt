package com.cove.chat.ui.screens

/** Users can keep up to this many profile photos (the backend trims to the same number). */
const val MAX_AVATARS = 5

/**
 * A user's profile photos, main one first. Older accounts only have the single `avatar_id`, so it stands in when the
 * list is empty. Mirrors `getGallery` in client-web.
 */
fun galleryOf(avatarId: String?, avatarIds: List<String>?): List<String> =
    if (!avatarIds.isNullOrEmpty()) avatarIds else listOfNotNull(avatarId?.takeIf { it.isNotBlank() })

/** Makes [id] the first (main) photo and keeps the others in order. */
fun promoteInGallery(gallery: List<String>, id: String): List<String> = listOf(id) + gallery.filter { it != id }

/** The gallery after uploading [newId]: it becomes the main photo and the oldest one falls off at the limit. */
fun galleryAfterUpload(gallery: List<String>, newId: String): List<String> = promoteInGallery(gallery, newId).take(MAX_AVATARS)

/** The gallery after deleting [id]. The backend treats the first entry as the main photo, so the next one takes over. */
fun galleryAfterRemove(gallery: List<String>, id: String): List<String> = gallery.filter { it != id }
