package dev.mosaic.sdk

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/**
 * The reduced-motion signal, injected at the renderer boundary exactly like the clock.
 *
 * The contract owns *what* changes and the platform owns *how long*: `appear` keeps its opacity
 * change and drops its transform, `selection` applies instantly, and `loop` never leaves rest. None
 * of that is renderer-interpreted, which is why the signal is a value a test can supply rather than
 * a device setting a test would have to mutate.
 */
val LocalMosaicReducedMotion = staticCompositionLocalOf { false }

/**
 * Android's reduced-motion signal: `Settings.Global.ANIMATOR_DURATION_SCALE` of `0`.
 *
 * Compose honours the animator scale for its own animation APIs, but that does **not** extend to
 * ExoPlayer playback, which is why the `0.4` video-background rule is handled explicitly in
 * [MosaicDecorativeVideoBackground] rather than assumed to follow from this setting.
 */
fun mosaicPlatformReducedMotion(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
    ) == 0f
}.getOrDefault(false)

@Composable
internal fun rememberPlatformReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) { mosaicPlatformReducedMotion(context) }
}

/**
 * The normative control points, as a Compose curve.
 *
 * The four presets map one-to-one onto `CubicBezierEasing`, which is the whole reason the contract
 * chose cubic beziers: it is the one faithfully portable curve family across SwiftUI `timingCurve`,
 * Compose `CubicBezierEasing`, and Flutter `Cubic`. Frame values themselves come from
 * [MosaicMotionFrames], so what a renderer draws is provably the number the conformance vectors
 * record rather than a second solver's opinion of it.
 */
fun MosaicMotionEasing.toComposeEasing(): Easing = CubicBezierEasing(
    controlPointX1.toFloat(),
    controlPointY1.toFloat(),
    controlPointX2.toFloat(),
    controlPointY2.toFloat(),
)

/**
 * Elapsed milliseconds on [driver]'s timeline, from this node's first frame until [totalMilliseconds].
 *
 * The loop stops at the motion's own end rather than running forever, so a completed animation lets
 * the composition go idle: a Compose test can `waitForIdle` on settled content, and only content
 * that is still animating requires `mainClock.advanceTimeBy`. A disabled driver never starts the
 * loop and reports the terminal time immediately, which is what makes a static golden capturable.
 */
@Composable
private fun rememberMotionElapsed(
    key: Any,
    driver: MosaicMotionDriver,
    totalMilliseconds: Long,
): Long {
    // The driver is gated inside the effect rather than by an early return, so this composable makes
    // the same `remember` calls on every path. A disabled driver is a swappable input -- that is the
    // whole point of it -- and a call site whose remembered slots appear and disappear with it would
    // be reading another composable's state after the swap.
    var elapsed by remember(key, driver) {
        mutableLongStateOf(if (driver.isEnabled) 0L else totalMilliseconds)
    }
    LaunchedEffect(key, driver, totalMilliseconds) {
        if (!driver.isEnabled) {
            elapsed = totalMilliseconds
            return@LaunchedEffect
        }
        var start = Long.MIN_VALUE
        while (elapsed < totalMilliseconds) {
            withFrameMillis { frameTimeMillis ->
                if (start == Long.MIN_VALUE) start = frameTimeMillis
                elapsed = driver.elapsedMilliseconds(start, frameTimeMillis)
            }
        }
    }
    return elapsed
}

/**
 * Applies a node's authored `appear` and `loop` motion.
 *
 * Both are dropped from the modifier chain the instant their frame reports complete, rather than
 * left in place at an identity value. That is what makes the terminal state *byte-identical* to the
 * static rendering rather than merely equal in intent: a `graphicsLayer` that is still present at
 * `alpha = 1` is a compositing layer the static rendering does not have, and Android's SHA-256
 * pixel goldens are zero-tolerance.
 */
@Composable
internal fun Modifier.mosaicNodeMotion(
    nodeId: String,
    motion: MosaicNodeMotion?,
    driver: MosaicMotionDriver,
): Modifier {
    if (motion == null) return this
    val reducedMotion = LocalMosaicReducedMotion.current
    var result = this

    // Under reduced motion the contract keeps `appear`'s opacity change and drops its transform,
    // and explicitly lets the platform decide how long the remaining opacity change takes. On
    // Android the signal *is* `ANIMATOR_DURATION_SCALE == 0` — the user has asked for animations of
    // zero duration — so honouring it literally is the platform convention rather than a shortcut.
    // What is normative is that no transform occurs and that the terminal state is unchanged; a
    // zero-duration entrance satisfies both, and it is what makes the reduced-motion rendering
    // byte-identical to the static one from the first frame.
    motion.appear?.takeUnless { reducedMotion }?.let { appear ->
        val total = appear.delayMilliseconds.toLong() + appear.curve.durationMilliseconds
        val elapsed = rememberMotionElapsed("$nodeId#appear", driver, total)
        val frame = MosaicMotionFrames.appear(appear, elapsed, reducedMotion)
        if (!frame.complete) {
            val translation = frame.translateLogicalSize.dp
            result = result.graphicsLayer {
                alpha = frame.opacity.toFloat()
                translationY = translation.toPx()
            }
        }
    }

    // Fully disabled under reduced motion: the node sits at rest, which is the static rendering,
    // so no layer is introduced at all.
    motion.loop?.takeUnless { reducedMotion }?.let { loop ->
        val total = loop.curve.durationMilliseconds.toLong() * loop.repeatCount
        val elapsed = rememberMotionElapsed("$nodeId#loop", driver, total)
        val frame = MosaicMotionFrames.loop(loop, elapsed, reducedMotion = false)
        if (!frame.complete) {
            result = result.graphicsLayer {
                scaleX = frame.scale.toFloat()
                scaleY = frame.scale.toFloat()
                // A fraction of the node's resolved static opacity, not an absolute value: this
                // composes on top of the authored `appearance.opacity` the presentation modifier
                // already applied, so a node authored at 0.8 rests at 0.8 rather than at 1.0.
                alpha = frame.opacityMultiplier.toFloat()
            }
        }
    }
    return result
}

/**
 * The box style a selectable box is showing right now.
 *
 * Returns the resolved terminal style unchanged when nothing is authored, when the driver is
 * disabled, or under reduced motion — where the frame at every elapsed time is the resolved
 * Selected style exactly. The first composition is never animated: with no previous selection to
 * come from, an interpolation from a style to itself is a frame loop that draws nothing.
 */
@Composable
internal fun mosaicSelectionStyle(
    ownerId: String,
    styles: MosaicSelectionStyles,
    isSelected: Boolean,
    motion: MosaicSelectionMotion?,
    driver: MosaicMotionDriver,
): MosaicSelectionStateStyle {
    val target = styles.resolve(isSelected)
    val reducedMotion = LocalMosaicReducedMotion.current
    // Whether this box animates is an input that can change -- the driver is swappable and the
    // reduced-motion signal is injected -- so it gates the effect rather than an early return. The
    // remembered slots below are therefore the same on every path.
    val animates = motion != null && driver.isEnabled && !reducedMotion

    // The style being drawn right now. Advanced by an effect rather than recomputed in composition:
    // the interpolation is a side effect of time passing, and mutating a remembered value while
    // composing would leave the drawn style wrong whenever a composition is abandoned and retried.
    val current = remember(ownerId, styles) { mutableStateOf(target) }
    LaunchedEffect(ownerId, styles, isSelected, motion, driver, animates) {
        val from = current.value
        // First composition has no previous selection to come from, so there is nothing to animate.
        if (animates && motion != null && from != target) {
            val duration = motion.curve.durationMilliseconds.toLong()
            var start = Long.MIN_VALUE
            var elapsed = 0L
            while (elapsed < duration) {
                withFrameMillis { frameTimeMillis ->
                    if (start == Long.MIN_VALUE) start = frameTimeMillis
                    elapsed = driver.elapsedMilliseconds(start, frameTimeMillis)
                }
                current.value = MosaicMotionFrames
                    .selection(motion, elapsed, reducedMotion = false, from, target)
                    .style
            }
        }
        // The terminal state is short-circuited to the authored Selected style rather than
        // approached, so no accumulation of rounding can leave the selected card subtly wrong.
        current.value = target
    }
    // When nothing animates, the resolved style is returned directly rather than read back from the
    // effect: the effect runs *after* composition, so reading it would show the previous selection
    // for one frame — and "applies instantly" is exactly what reduced motion promises.
    return if (animates) current.value else target
}
