package com.nodetalk.client.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 4-point spacing scale shared with the web client (Tailwind 1 = 4px). */
object Spacing {
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
}

/** The three corner radii used everywhere (web: `rounded-sm / md / lg`); circles use `CircleShape`. */
object Radius {
    val sm = 4.dp
    val md = 8.dp
    val lg = 12.dp
}

object CoveShapes {
    val sm = RoundedCornerShape(Radius.sm)
    val md = RoundedCornerShape(Radius.md)
    val lg = RoundedCornerShape(Radius.lg)
}

/**
 * Type roles (web: title / body / caption / label). Colour is not set here so call sites choose a theme colour.
 * Font family comes from the theme typography via LocalTextStyle merging at the call site.
 */
object CoveType {
    val title = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold)
    val body = TextStyle(fontSize = 15.sp)
    val caption = TextStyle(fontSize = 12.sp)
    val label = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium)
}

/** Common component heights. */
object Sizes {
    val field = 40.dp
    val button = 44.dp
    val icon = 20.dp
}
