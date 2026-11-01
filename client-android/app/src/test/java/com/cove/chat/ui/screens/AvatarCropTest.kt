package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class AvatarCropTest {
    private val eps = 0.01f

    @Test
    fun startsAsTheLargestCenteredSquare() {
        val c = cropSquare(imageW = 400, imageH = 300, viewport = 300f, zoom = 1f, offsetX = 0f, offsetY = 0f)
        assertEquals(300f, c.side, eps)
        assertEquals(50f, c.left, eps)
        assertEquals(0f, c.top, eps)
    }

    @Test
    fun zoomingInShrinksTheSourceAreaAroundTheCenter() {
        val c = cropSquare(400, 300, 300f, zoom = 2f, offsetX = 0f, offsetY = 0f)
        assertEquals(150f, c.side, eps)
        assertEquals(125f, c.left, eps)
        assertEquals(75f, c.top, eps)
    }

    @Test
    fun draggingTheImageRightShowsMoreOfItsLeftSide() {
        // At zoom 2 the image is 2x wider than the viewport can show, so there is room to drag by 150px.
        val c = cropSquare(400, 300, 300f, zoom = 2f, offsetX = 100f, offsetY = 0f)
        assertEquals(75f, c.left, eps)
    }

    @Test
    fun neverShowsEmptySpaceBeyondTheImage() {
        val farRight = cropSquare(400, 300, 300f, zoom = 1f, offsetX = 5000f, offsetY = 5000f)
        assertEquals(0f, farRight.left, eps) // dragged as far as it goes
        assertEquals(0f, farRight.top, eps)
        val farLeft = cropSquare(400, 300, 300f, zoom = 1f, offsetX = -5000f, offsetY = -5000f)
        assertEquals(100f, farLeft.left, eps)
        assertEquals(0f, farLeft.top, eps) // a landscape image fits the viewport height exactly: nothing to drag vertically
    }

    @Test
    fun clampKeepsTheOffsetInsideTheDraggableRange() {
        val (x, y) = clampCropOffset(imageW = 400, imageH = 300, viewport = 300f, zoom = 1f, offsetX = 999f, offsetY = 999f)
        assertEquals(50f, x, eps)
        assertEquals(0f, y, eps)
    }

    @Test
    fun zoomIsLimited() {
        assertEquals(1f, clampZoom(0.2f), eps)
        assertEquals(MAX_CROP_ZOOM, clampZoom(100f), eps)
        assertEquals(2.5f, clampZoom(2.5f), eps)
    }
}
