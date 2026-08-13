package dev.mosaic.sdk

import kotlinx.coroutines.delay

/**
 * The injectable time source for everything in the renderer that advances on its own.
 *
 * This mirrors the `clock` injection [MosaicPaywallState] already carries, and exists for the same
 * reason: a renderer whose only clock is the wall clock cannot be asserted against. Two members,
 * because two things need it:
 *
 *  - [isEnabled] is the on/off switch. Disabled means every motion renders at its terminal state
 *    and no frame loop is started at all, which by the terminal-state rule *is* the static
 *    rendering. Android's SHA-256 pixel goldens are zero-tolerance, so every static golden is
 *    captured with the driver disabled rather than by hoping an animation had settled.
 *  - [elapsedMilliseconds] turns a pair of frame times into the whole, non-negative elapsed time
 *    the protocol's frame resolver is specified against. The default is a plain subtraction over
 *    Compose's frame clock, which is what makes `mainClock.advanceTimeBy` pin an exact frame.
 *
 * [awaitTick] is the countdown's tick. It lived as a bare `delay(1_000)` inside a `LaunchedEffect`,
 * which meant the only way to observe a second countdown frame in a test was to wait a real second.
 * Countdown *rounding* is unchanged and still owned by [MosaicCountdownText].
 */
interface MosaicMotionDriver {
    /** False renders every authored motion at its terminal state and starts no frame loop. */
    val isEnabled: Boolean

    /**
     * Elapsed milliseconds for a frame published at [frameTimeMillis], relative to the frame time
     * at which the motion started. Never negative: a frame clock that went backwards resolves to
     * the start of the motion rather than to a frame that reads back as plausible.
     */
    fun elapsedMilliseconds(startFrameTimeMillis: Long, frameTimeMillis: Long): Long

    /** Suspends until the next countdown tick is due. */
    suspend fun awaitTick(intervalMilliseconds: Long)

    companion object {
        /** Compose's frame clock and a real delay: the shipping behaviour. */
        val Default: MosaicMotionDriver = MosaicSystemMotionDriver(isEnabled = true)

        /**
         * Motion off. Every frame is terminal, so the rendering is byte-identical to a document
         * carrying no motion at all. This is the driver every static golden is captured with.
         */
        val Disabled: MosaicMotionDriver = MosaicSystemMotionDriver(isEnabled = false)
    }
}

/** The default driver: frame-time subtraction, and a real suspending tick. */
class MosaicSystemMotionDriver(override val isEnabled: Boolean = true) : MosaicMotionDriver {
    override fun elapsedMilliseconds(startFrameTimeMillis: Long, frameTimeMillis: Long): Long =
        (frameTimeMillis - startFrameTimeMillis).coerceAtLeast(0L)

    override suspend fun awaitTick(intervalMilliseconds: Long) {
        delay(intervalMilliseconds)
    }
}

/**
 * A driver whose tick a test completes explicitly.
 *
 * [tickCount] is what a countdown test asserts against instead of sleeping: the renderer's tick loop
 * is observable without a wall-clock second passing, and [awaitTick] can be made to suspend forever
 * so that a test can pin the countdown at exactly one resolved frame.
 */
class MosaicRecordingMotionDriver(
    override val isEnabled: Boolean = true,
    /**
     * Yields by default rather than returning immediately: a tick that never suspends turns the
     * countdown's loop into a tight spin that starves the frame clock the test is waiting on.
     */
    private val onTick: suspend (Long) -> Unit = { kotlinx.coroutines.yield() },
) : MosaicMotionDriver {
    private val ticks = java.util.concurrent.atomic.AtomicInteger(0)

    val tickCount: Int get() = ticks.get()

    override fun elapsedMilliseconds(startFrameTimeMillis: Long, frameTimeMillis: Long): Long =
        (frameTimeMillis - startFrameTimeMillis).coerceAtLeast(0L)

    override suspend fun awaitTick(intervalMilliseconds: Long) {
        ticks.incrementAndGet()
        onTick(intervalMilliseconds)
    }
}
