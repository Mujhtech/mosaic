package dev.mosaic.sdk

/**
 * Protocol 0.4 authored motion, as values.
 *
 * Everything here is pure Kotlin with no Compose and no Android dependency, for the same reason the
 * countdown resolver is: motion is the first thing in the protocol whose contract is *a value at an
 * instant* rather than a value, and three renderers will not agree by coincidence. The arithmetic
 * that has to match `protocol/fixtures/v0.4/motion-frames.json` therefore lives where a JVM unit
 * test can drive every recorded frame through it.
 *
 * One rule holds in every branch below and is what makes the `renderWithoutMotion` tier lossless:
 * **every animation's terminal state is byte-identical to the static rendering.** It is
 * short-circuited rather than approached, so no accumulation of rounding can leave a price at
 * 0.9999 opacity or a card at 1.0001 scale.
 */

/**
 * The four easing presets. Control points are normative and fixture-pinned in
 * `docs/protocol/v0.4.md`; they map exactly onto Compose `CubicBezierEasing`, SwiftUI
 * `timingCurve`, and Flutter `Cubic`, which is the whole reason for choosing cubic beziers.
 * Authored control points and springs are excluded by the contract, not merely unimplemented.
 */
enum class MosaicMotionEasing(
    val wireName: String,
    val controlPointX1: Double,
    val controlPointY1: Double,
    val controlPointX2: Double,
    val controlPointY2: Double,
) {
    LINEAR("linear", 0.0, 0.0, 1.0, 1.0),
    STANDARD("standard", 0.4, 0.0, 0.2, 1.0),
    DECELERATE("decelerate", 0.0, 0.0, 0.2, 1.0),
    ACCELERATE("accelerate", 0.4, 0.0, 1.0, 1.0),
    ;

    companion object {
        internal fun fromWireName(value: String): MosaicMotionEasing? =
            entries.firstOrNull { it.wireName == value }
    }
}

/**
 * A duration and an easing as one composite, because neither is meaningful without the other.
 * Durations are whole milliseconds so that Dart, Swift, Kotlin, and JavaScript cannot disagree
 * about a rounded fraction; `0` is legal and means the change applies instantly.
 */
data class MosaicMotion(
    val durationMilliseconds: Int,
    val easing: MosaicMotionEasing,
)

data class MosaicMotionToken(val id: String, val name: String, val value: MosaicMotion)

enum class MosaicAppearEffect { FADE, FADE_RISE }

/**
 * Plays once when the node first enters a screen.
 *
 * [riseLogicalSize] is present exactly for [MosaicAppearEffect.FADE_RISE] and absent for
 * [MosaicAppearEffect.FADE]; the decoder enforces both directions, so a null rise on a fadeRise is
 * unreachable for an accepted document. The node travels *to* its laid-out position, so its final
 * geometry is its static geometry.
 */
data class MosaicAppearMotion(
    val effect: MosaicAppearEffect,
    val curve: MosaicMotion,
    val delayMilliseconds: Int,
    val riseLogicalSize: Double? = null,
)

/** Interpolates the authored Default and Selected box styles when the runtime selection changes. */
data class MosaicSelectionMotion(val curve: MosaicMotion)

/**
 * A bounded call-to-action pulse: [repeatCount] cycles, then permanent rest.
 *
 * There is no forever mode anywhere in the contract. An unbounded pulse would rely on the operating
 * system's reduce-motion switch as its WCAG 2.2.2 stop mechanism, which leaves a user who has not
 * enabled that switch with no stop mechanism at all; a bounded count needs no stop control because
 * it stops.
 */
data class MosaicLoopMotion(
    val scaleAmplitude: Double,
    val opacityAmplitude: Double,
    val curve: MosaicMotion,
    val repeatCount: Int,
)

/**
 * The motion block a node may carry.
 *
 * One model for all three trigger vocabularies; which members may be authored is decided per node
 * type at decode time (`appear` on any node but the screen Scroll Container, `selection` on Product
 * Selector and Tabs, `loop` on Button), so an unreachable combination cannot survive decoding.
 */
data class MosaicNodeMotion(
    val appear: MosaicAppearMotion? = null,
    val selection: MosaicSelectionMotion? = null,
    val loop: MosaicLoopMotion? = null,
)

/**
 * Raised when a motion frame is asked for at an elapsed time that cannot be trusted.
 *
 * Following the `resolveV03CountdownState` precedent, a bad clock throws rather than resolving:
 * arithmetic on a bad clock yields a frame that reads back as entirely plausible.
 */
class MosaicMotionClockException(message: String) : IllegalArgumentException(message)

/** The frame an `appear` motion must be showing at an exact elapsed time. */
data class MosaicAppearFrame(
    val complete: Boolean,
    val progress: Double,
    val opacity: Double,
    val translateLogicalSize: Double,
)

/** The frame a `selection` motion must be showing at an exact elapsed time. */
data class MosaicSelectionFrame(
    val complete: Boolean,
    val progress: Double,
    val style: MosaicSelectionStateStyle,
)

/** The frame a `loop` motion must be showing at an exact elapsed time. */
data class MosaicLoopFrame(
    val complete: Boolean,
    val cycle: Int,
    val cyclePhase: Double,
    val excursion: Double,
    val scale: Double,
    val opacityMultiplier: Double,
)

object MosaicMotionFrames {
    /**
     * Eased progress in `0…1` for a fraction of a curve's duration.
     *
     * Newton-Raphson with a bisection fallback, matching `resolveV04MotionFrame` step for step: the
     * conformance vectors are generated by that implementation and reconciled against it, so a
     * different-but-equivalent solver is a different set of numbers.
     */
    fun easedProgress(easing: MosaicMotionEasing, fraction: Double): Double {
        if (fraction <= 0.0) return 0.0
        if (fraction >= 1.0) return 1.0
        val x1 = easing.controlPointX1
        val y1 = easing.controlPointY1
        val x2 = easing.controlPointX2
        val y2 = easing.controlPointY2

        fun axis(a: Double, b: Double, t: Double): Double {
            val inverse = 1.0 - t
            return 3.0 * inverse * inverse * t * a + 3.0 * inverse * t * t * b + t * t * t
        }

        fun curveX(t: Double) = axis(x1, x2, t)
        fun curveY(t: Double) = axis(y1, y2, t)
        fun slopeX(t: Double): Double {
            val inverse = 1.0 - t
            return 3.0 * inverse * inverse * x1 +
                6.0 * inverse * t * (x2 - x1) +
                3.0 * t * t * (1.0 - x2)
        }

        var parameter = fraction
        repeat(8) {
            val error = curveX(parameter) - fraction
            if (kotlin.math.abs(error) < 1e-12) return curveY(parameter)
            val derivative = slopeX(parameter)
            if (kotlin.math.abs(derivative) < 1e-9) return@repeat
            parameter -= error / derivative
        }
        var low = 0.0
        var high = 1.0
        parameter = fraction
        repeat(64) {
            val value = curveX(parameter)
            if (kotlin.math.abs(value - fraction) < 1e-12) return@repeat
            if (value > fraction) high = parameter else low = parameter
            parameter = (low + high) / 2.0
        }
        return curveY(parameter)
    }

    fun appear(
        motion: MosaicAppearMotion,
        elapsedMilliseconds: Long,
        reducedMotion: Boolean,
    ): MosaicAppearFrame {
        requireClock(elapsedMilliseconds)
        val rise = if (motion.effect == MosaicAppearEffect.FADE_RISE) {
            motion.riseLogicalSize ?: 0.0
        } else {
            0.0
        }
        val start = motion.delayMilliseconds.toLong()
        val end = start + motion.curve.durationMilliseconds
        if (elapsedMilliseconds >= end) {
            return MosaicAppearFrame(
                complete = true,
                progress = 1.0,
                opacity = 1.0,
                translateLogicalSize = 0.0,
            )
        }
        if (elapsedMilliseconds <= start) {
            return MosaicAppearFrame(
                complete = false,
                progress = 0.0,
                opacity = 0.0,
                // Reduced motion is opacity only: the transform is dropped at every instant,
                // including the start frame, so nothing ever moves.
                translateLogicalSize = if (reducedMotion) 0.0 else round4(rise),
            )
        }
        val fraction =
            (elapsedMilliseconds - start).toDouble() / motion.curve.durationMilliseconds.toDouble()
        val progress = easedProgress(motion.curve.easing, fraction)
        return MosaicAppearFrame(
            complete = false,
            progress = round4(progress),
            opacity = round4(progress),
            translateLogicalSize = if (reducedMotion) 0.0 else round4(rise * (1.0 - progress)),
        )
    }

    fun selection(
        motion: MosaicSelectionMotion,
        elapsedMilliseconds: Long,
        reducedMotion: Boolean,
        resolvedFrom: MosaicSelectionStateStyle,
        resolvedTo: MosaicSelectionStateStyle,
    ): MosaicSelectionFrame {
        requireClock(elapsedMilliseconds)
        // Reduced motion applies the change instantly: the frame at every elapsed time is the
        // resolved Selected style exactly.
        if (reducedMotion || elapsedMilliseconds >= motion.curve.durationMilliseconds) {
            return MosaicSelectionFrame(complete = true, progress = 1.0, style = resolvedTo)
        }
        val progress = easedProgress(
            motion.curve.easing,
            elapsedMilliseconds.toDouble() / motion.curve.durationMilliseconds.toDouble(),
        )
        return MosaicSelectionFrame(
            complete = false,
            progress = round4(progress),
            style = interpolateSelectionStyle(resolvedFrom, resolvedTo, progress),
        )
    }

    fun loop(
        motion: MosaicLoopMotion,
        elapsedMilliseconds: Long,
        reducedMotion: Boolean,
    ): MosaicLoopFrame {
        requireClock(elapsedMilliseconds)
        val atRest = MosaicLoopFrame(
            complete = true,
            cycle = motion.repeatCount,
            cyclePhase = 0.0,
            excursion = 0.0,
            scale = 1.0,
            opacityMultiplier = 1.0,
        )
        // Fully disabled under reduced motion: the node sits at rest, which is the static rendering.
        if (reducedMotion) return atRest.copy(cycle = 0)
        val cycleMilliseconds = motion.curve.durationMilliseconds.toLong()
        val totalMilliseconds = cycleMilliseconds * motion.repeatCount
        if (elapsedMilliseconds >= totalMilliseconds) return atRest
        val cycle = (elapsedMilliseconds / cycleMilliseconds).toInt()
        val cyclePhase =
            (elapsedMilliseconds - cycle * cycleMilliseconds).toDouble() / cycleMilliseconds.toDouble()
        // One pulse is an excursion out and back. The easing shapes each half, so the excursion is 0
        // at both ends of every cycle -- which is what makes a cycle boundary and the terminal frame
        // the same static rendering rather than two near misses.
        val halfPhase = if (cyclePhase < 0.5) cyclePhase * 2.0 else (1.0 - cyclePhase) * 2.0
        val excursion = easedProgress(motion.curve.easing, halfPhase)
        return MosaicLoopFrame(
            complete = false,
            cycle = cycle,
            cyclePhase = round4(cyclePhase),
            excursion = round4(excursion),
            scale = round4(1.0 + motion.scaleAmplitude * excursion),
            opacityMultiplier = round4(1.0 - motion.opacityAmplitude * excursion),
        )
    }

    private fun requireClock(elapsedMilliseconds: Long) {
        if (elapsedMilliseconds < 0) {
            throw MosaicMotionClockException(
                "Motion frame resolution requires a whole, non-negative elapsed time in milliseconds.",
            )
        }
    }

    /**
     * Emitted numbers carry four decimal places.
     *
     * Continuous interpolation cannot be byte-pinned across three platform bezier solvers, so the
     * contract discretizes instead and renderers conform within `toleranceAbsolute: 0.001`.
     */
    internal fun round4(value: Double): Double {
        val rounded = Math.round(value * 10000.0) / 10000.0
        return if (rounded == 0.0) 0.0 else rounded
    }
}

/**
 * The closed interpolable field list.
 *
 * A semantic colour name resolves against the renderer's theme and a `colorToken` resolves against
 * the document; neither has a numeric value the protocol can average, so rather than invent one the
 * change applies at the half-way point. Padding is structural: interpolating it relayouts the
 * subtree every frame on three layout engines that disagree about when that is legal.
 */
internal fun interpolateSelectionStyle(
    from: MosaicSelectionStateStyle,
    to: MosaicSelectionStateStyle,
    progress: Double,
): MosaicSelectionStateStyle = MosaicSelectionStateStyle(
    background = interpolateBackground(from.background, to.background, progress),
    border = MosaicBorder(
        color = interpolateColor(from.border.color, to.border.color, progress),
        width = MosaicMotionFrames.round4(
            from.border.width + (to.border.width - from.border.width) * progress,
        ),
    ),
    cornerRadius = MosaicMotionFrames.round4(
        from.cornerRadius + (to.cornerRadius - from.cornerRadius) * progress,
    ),
    padding = if (progress < 0.5) from.padding else to.padding,
    opacity = MosaicMotionFrames.round4(from.opacity + (to.opacity - from.opacity) * progress),
    shadow = interpolateShadow(from.shadow, to.shadow, progress),
)

internal fun interpolateColor(
    from: MosaicColor,
    to: MosaicColor,
    progress: Double,
): MosaicColor {
    if (from == to) return to
    if (!literalColorPattern.matches(from.rawValue) || !literalColorPattern.matches(to.rawValue)) {
        return if (progress < 0.5) from else to
    }
    val mixed = StringBuilder("#")
    var offset = 1
    while (offset < 9) {
        val start = from.rawValue.substring(offset, offset + 2).toInt(16)
        val end = to.rawValue.substring(offset, offset + 2).toInt(16)
        val channel = Math.round(start + (end - start) * progress).toInt()
        mixed.append(channel.toString(16).uppercase().padStart(2, '0'))
        offset += 2
    }
    return MosaicColor(mixed.toString())
}

private fun interpolateBackground(
    from: MosaicBackground,
    to: MosaicBackground,
    progress: Double,
): MosaicBackground = if (from is MosaicBackground.Solid && to is MosaicBackground.Solid) {
    MosaicBackground.Solid(interpolateColor(from.color, to.color, progress))
} else {
    // A background *kind* change switches discretely at the half-way point.
    if (progress < 0.5) from else to
}

private fun interpolateShadow(
    from: MosaicShadow?,
    to: MosaicShadow?,
    progress: Double,
): MosaicShadow? = when {
    from == null && to == null -> null
    from != null && to != null -> MosaicShadow(
        color = interpolateColor(from.color, to.color, progress),
        offsetX = MosaicMotionFrames.round4(from.offsetX + (to.offsetX - from.offsetX) * progress),
        offsetY = MosaicMotionFrames.round4(from.offsetY + (to.offsetY - from.offsetY) * progress),
        blurRadius = MosaicMotionFrames.round4(
            from.blurRadius + (to.blurRadius - from.blurRadius) * progress,
        ),
    )
    else -> if (progress < 0.5) from else to
}
