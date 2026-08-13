package dev.mosaic.sdk

/**
 * Whether a decorative video background plays, as a value.
 *
 * Pure Kotlin with no Compose and no Android dependency, and deliberately so: the decision it makes
 * is protocol behaviour, and the Compose test that would otherwise be its only cover is an
 * instrumentation test that does not run in CI. A rule nothing in CI can fail is a rule that
 * regresses silently, which is exactly how the rule this type exists for went in unguarded.
 *
 * The shape mirrors iOS's `MosaicVideoBackgroundPresentation.resolve`. Android has no analogue of
 * Apple's separate Video Autoplay switch, so reduced motion is the only preference read here.
 */
internal sealed interface MosaicVideoBackgroundPresentation {
    /** A player is constructed and the resolved source plays, muted and looping. */
    data object Play : MosaicVideoBackgroundPresentation

    /**
     * No player is constructed. The declared poster is drawn when one is declared, and the declared
     * fallback colour otherwise.
     *
     * [recordsUnavailable] separates the two reasons for arriving here: media that could not be
     * resolved or could not play, which diagnoses, and a user preference, which does not — a
     * customer who asked for less motion has not encountered a broken paywall.
     */
    data class Still(val recordsUnavailable: Boolean) : MosaicVideoBackgroundPresentation

    companion object {
        /**
         * ADR-0027 ruling 3, now unconditional: under reduced motion a decorative video background
         * does not play.
         *
         * The rule carried a document-version gate while `0.3` and `0.4` were both readable, so an
         * already published `0.3` paywall would not silently change behaviour. ADR-0028 deleted
         * `0.3`, which leaves the gate constant — every document this reader accepts declares
         * [MOSAIC_PROTOCOL_VERSION] — so the parameter is gone rather than kept as a value that can
         * only take one value.
         *
         * Unavailability is assessed independently of the preference: a missing or unplayable asset
         * is a fact about the document, and an operator debugging a paywall on a reduced-motion
         * device should still be told the video could not be resolved.
         */
        fun resolve(
            hasSource: Boolean,
            playbackFailed: Boolean,
            reducedMotion: Boolean,
        ): MosaicVideoBackgroundPresentation {
            val unavailable = !hasSource || playbackFailed
            return if (unavailable || reducedMotion) Still(unavailable) else Play
        }
    }
}
