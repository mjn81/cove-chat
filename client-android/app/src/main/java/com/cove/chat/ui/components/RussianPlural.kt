package com.cove.chat.ui.components

/**
 * Picks the Russian (CLDR `ru`) plural form for a whole number: [one] for 1, 21, 31…, [few] for 2–4, 22–24…,
 * [many] for 0, 5–20, 25–30….
 *
 * [count] is the digit string a translation pattern captured. Only its last two digits decide the form, so numbers
 * too large for a `Long` still work.
 */
fun ruPlural(count: String, one: String, few: String, many: String): String {
    val tail = count.takeLast(2).toIntOrNull() ?: return many
    // 11–14 end in 1–4 but take the "many" form.
    if (tail in 11..14) return many
    return when (tail % 10) {
        1 -> one
        2, 3, 4 -> few
        else -> many
    }
}
