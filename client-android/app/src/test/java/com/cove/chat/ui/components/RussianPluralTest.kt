package com.cove.chat.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class RussianPluralTest {
    private fun form(n: Long) = ruPlural(n.toString(), "one", "few", "many")

    @Test fun one() = listOf(1L, 21, 31, 101, 1001).forEach { assertEquals("n=$it", "one", form(it)) }

    @Test fun few() = listOf(2L, 3, 4, 22, 24, 102, 1003).forEach { assertEquals("n=$it", "few", form(it)) }

    @Test fun many() = listOf(0L, 5, 9, 10, 11, 12, 14, 20, 25, 30, 100, 111, 112, 114).forEach { assertEquals("n=$it", "many", form(it)) }

    @Test fun digitsLongerThanALongStillResolve() {
        assertEquals("one", ruPlural("100000000000000000000001", "one", "few", "many"))
    }
}
