package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class DayLabelTest {
    private val today = LocalDate.of(2026, 3, 20)

    @Test fun relativeDaysStayAsSourceStrings() {
        assertEquals("Today", dayLabel(today, "ru", today))
        assertEquals("Yesterday", dayLabel(today.minusDays(1), "ru", today))
    }

    @Test fun russianDatesUseRussianNamesAndOrder() {
        assertEquals("пн, 5 января", dayLabel(LocalDate.of(2026, 1, 5), "ru", today))
        assertEquals("пт, 3 января 2025 г.", dayLabel(LocalDate.of(2025, 1, 3), "ru", today))
    }

    @Test fun otherLanguagesKeepTheEnglishFormat() {
        assertEquals("Mon, Jan 5", dayLabel(LocalDate.of(2026, 1, 5), "en", today))
        assertEquals("Fri, Jan 3, 2025", dayLabel(LocalDate.of(2025, 1, 3), "fa", today))
    }
}
