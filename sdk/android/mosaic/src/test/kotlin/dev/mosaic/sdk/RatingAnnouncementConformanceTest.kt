package dev.mosaic.sdk

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/**
 * The cross-SDK conformance corpus for the Social Proof rating announcement.
 *
 * Binding it here is what forces this SDK to *read* `mosaic.a11y.rating` rather than compose its
 * own phrasing: a renderer that invented "4.5 / 5" or "4.5 out of 5" would satisfy an
 * eyeball review and fail these vectors, and one that used a platform number formatter would pass
 * the English cases and fail the German one on the decimal separator alone. `expectedAnnouncement`
 * is asserted byte for byte.
 */
class RatingAnnouncementConformanceTest {
    /**
     * A corpus that has silently emptied reconciles perfectly against zero cases and reports
     * success over nothing. The floor is the count `docs/protocol/v0.3.md` declares.
     */
    private val declaredCaseFloor = 10

    @Test
    fun `announcements match the canonical vectors byte for byte`() {
        val corpus = JsonParser.parseString(
            Files.readAllBytes(
                repositoryFile("protocol/fixtures/v0.3/rating-announcement.json"),
            ).toString(Charsets.UTF_8),
        ).asJsonObject
        val cases = corpus.getAsJsonArray("cases")
        assertTrue(
            "The rating-announcement corpus holds ${cases.size()} cases, below its declared " +
                "floor of $declaredCaseFloor.",
            cases.size() >= declaredCaseFloor,
        )
        // The placeholders this SDK substitutes are the ones the corpus declares, so a renamed
        // placeholder is a failure here rather than a silent no-op substitution.
        assertEquals(
            MosaicReservedAccessibilityKey.placeholdersByKey
                .getValue(MosaicReservedAccessibilityKey.RATING),
            corpus.getAsJsonArray("placeholders").map { it.asString },
        )

        cases.forEach { element ->
            val case = element.asJsonObject
            val id = case.get("id").asString
            val rating = socialProofRating(case.get("rating"), "$.rating")
            val template = case.get("template").asString

            assertEquals("$id points", case.get("points").asString, mosaicRatingPoints(rating))
            assertEquals(
                "$id maximum",
                case.get("maximumPoints").asString,
                mosaicRatingMaximumPoints(rating),
            )
            assertEquals(
                "$id announcement",
                case.get("expectedAnnouncement").asString,
                mosaicResolveRatingAnnouncement(rating, template),
            )
        }
    }

    /**
     * A translation missing a placeholder announces a rating with no number in it. The decoder
     * rejects such a catalog, so this guards the announcement path against a template that reached
     * it another way: it must refuse, never emit a half-substituted string.
     */
    @Test
    fun `a template missing a placeholder is refused rather than half substituted`() {
        val rating = MosaicSocialProofRating(
            value = 9,
            maximum = 5,
            step = MosaicSocialProofRatingStep.HALF,
            size = 16.0,
            filledColor = MosaicColor.semantic(MosaicSemanticColor.ACTION_PRIMARY),
            emptyColor = MosaicColor.semantic(MosaicSemanticColor.BORDER_DEFAULT),
        )
        assertThrows(MosaicReservedStringException::class.java) {
            mosaicResolveRatingAnnouncement(rating, "{{ rating.value }} stars")
        }
        assertThrows(MosaicReservedStringException::class.java) {
            mosaicResolveRatingAnnouncement(rating, "out of {{ rating.maximum }} stars")
        }
        // Word order travels with the catalog: the renderer contributes no connective at all.
        assertEquals(
            "5 中 4.5",
            mosaicResolveRatingAnnouncement(rating, "{{ rating.maximum }} 中 {{ rating.value }}"),
        )
    }
}
