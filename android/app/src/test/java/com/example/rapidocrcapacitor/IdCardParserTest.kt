package com.example.rapidocrcapacitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IdCardParserTest {
    @Test
    fun extractsValid18And15DigitNumbers() {
        val lines = listOf(
            "公民身份号码 110105 1949 1231 002x",
            "旧号码 130503-670401-001",
        )

        assertEquals(
            listOf("11010519491231002X", "130503670401001"),
            IdCardParser.extract(lines),
        )
    }

    @Test
    fun normalizesFullWidthCharactersAndDeduplicates() {
        val lines = listOf(
            "身份证 １１０１０５１９４９１２３１００２ｘ",
            "身份证 11010519491231002X",
            "OCR混淆 11O1O519491231OO2X",
        )

        assertEquals(listOf("11010519491231002X"), IdCardParser.extract(lines))
    }

    @Test
    fun rejectsBadChecksumDateAndSequence() {
        val lines = listOf(
            "错误校验位 11010119900101123X",
            "错误日期 110105199902300021",
            "错误顺序码 11010519491231000X",
        )

        assertTrue(IdCardParser.extract(lines).isEmpty())
    }

    @Test
    fun doesNotJoinNumbersAcrossLinesOrLabels() {
        val lines = listOf(
            "编号 110105194",
            "日期 91231002X",
            "出生 1949年12月31日 序号 002",
        )

        assertTrue(IdCardParser.extract(lines).isEmpty())
    }
}
