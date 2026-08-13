package dev.mosaic.sdk

/**
 * Whether a decorative video background plays, as a value.
 *
 * Pure Kotlin with no Compose and no Android dependency, and deliberately so: the decision it makes
 * is version-gated protocol behaviour, and the Compose test that would otherwise be its only cover
 * is an instrumentation test that does not run in CI. A rule nothing in CI can fail is a rule that
 * regresses silently, which is exactly how the gate this type exists for went in unguarded.
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
         * ADR-0027 ruling 3: the reduced-motion fix ships as specified `0.4` behaviour, not as a
         * `0.3` defect patch.
         *
         * A `0.3` document therefore keeps `0.3`'s behaviour and still plays — `0.3` specified video
         * backgrounds as always muted, autoplaying, looping, and control-free, and the live exposure
         * that creates stays open and tracked until `0.4` lands and is accepted, rather than being
         * quietly closed by a renderer. iOS and Flutter draw the same version gate; a renderer that
         * applied it to every version would be the odd one out and would change what an already
         * published `0.3` paywall does.
         *
         * The gate is on the *document's* declared version rather than on the SDK's newest supported
         * one, because the question is what contract the author wrote against.
         *
         * Unavailability is assessed independently of the preference: a missing or unplayable asset
         * is a fact about the document, and an operator debugging a `0.4` paywall on a reduced-motion
         * device should still be told the video could not be resolved.
         */
        fun resolve(
            hasSource: Boolean,
            playbackFailed: Boolean,
            schemaVersion: String?,
            reducedMotion: Boolean,
        ): MosaicVideoBackgroundPresentation {
            val unavailable = !hasSource || playbackFailed
            val reducedMotionStops = reducedMotion && schemaVersion == MOSAIC_PROTOCOL_V04_VERSION
            return if (unavailable || reducedMotionStops) Still(unavailable) else Play
        }
    }
}
