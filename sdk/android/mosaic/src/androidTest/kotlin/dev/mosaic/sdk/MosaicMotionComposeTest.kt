package dev.mosaic.sdk

import android.graphics.Bitmap
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.security.MessageDigest
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Rule
import org.junit.Test

/**
 * Protocol `0.4` motion in the Compose renderer.
 *
 * Every test here pins frames with `mainClock.autoAdvance = false` and `advanceTimeBy`. That is not
 * a style preference: `waitForIdle` on a document whose Button is mid-pulse is a wait on content
 * that is deliberately still moving, and a test that waited on a wall clock would assert whatever
 * frame the machine happened to reach.
 *
 * Comparisons are made between two paywalls composed **side by side in one composition**, selected
 * by a state flag rather than by a second `setContent` — a Compose test rule accepts content once,
 * and swapping the state object keeps the surrounding composable identity (and therefore the scroll
 * position) intact.
 *
 * The rule under test throughout is the one the whole contract rests on: **every animation's
 * terminal state is byte-identical to the static rendering**. It is what makes the
 * `renderWithoutMotion` fallback provably lossless, and Android's SHA-256 goldens are the only
 * assertion in this repository strict enough to catch a violation of it.
 */
class MosaicMotionComposeTest {
    @get:Rule
    val compose = createComposeRule()

    /**
     * The terminal frame equals the driver-disabled rendering, pixel for pixel.
     *
     * This is the load-bearing assertion. A `graphicsLayer` left in the chain at `alpha = 1`, a
     * pulse resting at `1.0001` scale, or an entrance settling at `0.9999` opacity would all look
     * correct to a human and all fail here.
     */
    @Test
    fun terminalFrameDigestEqualsTheDriverDisabledStaticDigest() {
        val switch = setSwitchablePaywall()

        // Longer than the longest authored total on this screen -- a 900ms cycle repeated three
        // times -- so every primitive has genuinely reached its terminal frame.
        compose.mainClock.advanceTimeBy(6_000)
        val animated = digestOf("mosaic-paywall")

        switch.useAnimatedDriver = false
        compose.mainClock.advanceTimeBy(64)
        val static = digestOf("mosaic-paywall")

        assertEquals(
            "A finished animation must be byte-identical to the static rendering.",
            static,
            animated,
        )
    }

    /**
     * The static golden itself, captured with the motion driver disabled.
     *
     * The goldens are zero-tolerance, so capturing one while anything is animating records a frame
     * rather than a rendering. Disabling the driver is what makes the capture deterministic instead
     * of merely usually settled.
     */
    @Test
    fun protocolV04StaticRenderingMatchesCommittedPixelBaseline() {
        val switch = setSwitchablePaywall()
        switch.useAnimatedDriver = false
        compose.mainClock.advanceTimeBy(64)
        val digest = digestOf("mosaic-paywall")

        val expected = InstrumentationRegistry.getInstrumentation().context
            .assets.open("mosaic-paywall-v04-golden.sha256")
            .bufferedReader().use { it.readText().trim() }
        assumeFalse(
            "No Protocol 0.4 pixel baseline is recorded. Review the render, then commit: $digest",
            expected == GOLDEN_UNRECORDED,
        )
        assertEquals("Update only after intentional renderer review. Actual: $digest", expected, digest)
    }

    /**
     * An entrance is genuinely mid-flight at a pinned time and settled at its authored end.
     *
     * Asserting that the mid-flight frame *differs* from the terminal one is what distinguishes a
     * renderer that animates from one that jumps straight to the end and passes the terminal
     * assertion vacuously.
     */
    @Test
    fun appearIsMidFlightAtAPinnedFrameAndSettledAtItsAuthoredEnd() {
        val switch = setSwitchablePaywall()

        // The headline's entrance is a 240ms decelerate fadeRise with no delay. Half way through it
        // is neither absent nor arrived.
        compose.mainClock.advanceTimeBy(120)
        val midFlight = digestOf("mosaic-paywall")
        // Past the last authored delay (240ms) plus the longest entrance curve (240ms).
        compose.mainClock.advanceTimeBy(6_000)
        val settled = digestOf("mosaic-paywall")

        assertNotEquals("A mid-entrance frame must differ from the settled one.", settled, midFlight)

        switch.useAnimatedDriver = false
        compose.mainClock.advanceTimeBy(64)
        assertEquals("An entrance must end at its static rendering.", digestOf("mosaic-paywall"), settled)
    }

    /**
     * Reduced motion: `appear` keeps its opacity change and drops its transform at *every* instant,
     * including the start frame.
     *
     * The rendered geometry is therefore the node's laid-out geometry from the first frame onwards,
     * which is what resolves the iOS-replace versus Android-remove divergence without per-platform
     * clauses: the contract owns what changes, and the platform owns how long.
     */
    @Test
    fun reducedMotionAppearNeverTranslatesTheNode() {
        setSwitchablePaywall(reducedMotion = true)

        compose.mainClock.advanceTimeBy(16)
        val startBounds = boundsOf("mosaic-node-headline")
        compose.mainClock.advanceTimeBy(120)
        val midBounds = boundsOf("mosaic-node-headline")
        compose.mainClock.advanceTimeBy(6_000)
        val endBounds = boundsOf("mosaic-node-headline")

        assertEquals("Reduced motion must not translate an entering node.", endBounds, startBounds)
        assertEquals("Reduced motion must not translate an entering node.", endBounds, midBounds)
    }

    /**
     * Reduced motion renders the static document from its first frame.
     *
     * `appear` is opacity-only, `selection` applies instantly, and `loop` never leaves rest — so
     * with nothing animating, the whole document is already at its terminal state. That is the
     * second assertion the terminal-state rule buys for free.
     */
    @Test
    fun reducedMotionRendersTheWholeDocumentAtRestImmediately() {
        val switch = setSwitchablePaywall(reducedMotion = true)

        compose.mainClock.advanceTimeBy(64)
        val reduced = digestOf("mosaic-paywall")

        switch.useAnimatedDriver = false
        compose.mainClock.advanceTimeBy(64)
        val static = digestOf("mosaic-paywall")

        assertEquals("Reduced motion must render the static document.", static, reduced)
    }

    /**
     * A selection change interpolates, and lands exactly on the authored style.
     *
     * Compared as pixel digests of the card itself, because the closed interpolable field list is
     * mostly paint rather than geometry: the card's outer width is decided by its Product Selector,
     * so a bounds comparison would miss a background colour, a border width, a corner radius, and
     * the discrete padding switch alike. The two risks are a renderer that snaps (no intermediate
     * frame at all) and one that drifts (a final frame near the authored Selected style rather than
     * equal to it, leaving the selected card subtly wrong forever).
     */
    @Test
    fun selectionInterpolatesAndLandsOnTheAuthoredStyle() {
        val switch = setSwitchablePaywall(startAnimated = false)
        // Scrolled into view while the driver is disabled, so nothing on the screen is animating
        // and settling is a plain `waitForIdle` rather than a wait on looping content.
        compose.onNodeWithTag("mosaic-product-plans-monthly-plan-card", useUnmergedTree = true)
            .performScrollTo()
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        switch.useAnimatedDriver = true
        compose.mainClock.advanceTimeBy(6_000)

        assertTrue(
            "The card under test must be laid out.",
            boundsOf("mosaic-product-plans-yearly-plan-card").width > 0f,
        )
        val selected = digestOf("mosaic-product-plans-yearly-plan-card")
        compose.onNodeWithTag("mosaic-product-plans-monthly-plan-card", useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.OnClick)

        // The authored selection curve is 160ms. Sampled across it rather than at one guessed
        // instant: which frame the effect's first `withFrameMillis` lands on is a scheduling detail,
        // and pinning the assertion to it would make this test fail for a reason that is not a
        // regression. What the contract requires is that *some* frame is neither endpoint.
        val sampled = buildList {
            repeat(12) {
                compose.mainClock.advanceTimeBy(16)
                add(digestOf("mosaic-product-plans-yearly-plan-card"))
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
        val deselected = digestOf("mosaic-product-plans-yearly-plan-card")

        assertNotEquals("Deselecting a card must change how it is drawn.", selected, deselected)
        assertTrue(
            "A selection must interpolate: no frame between the two endpoints was drawn.",
            sampled.any { it != selected && it != deselected },
        )
        assertEquals(
            "A selection must land on the authored style and stay there.",
            deselected,
            digestOf("mosaic-product-plans-yearly-plan-card"),
        )
    }

    /**
     * Reduced motion applies a selection instantly: the frame at every elapsed time is the resolved
     * style exactly, so there is no intermediate frame to observe.
     */
    @Test
    fun reducedMotionAppliesSelectionInstantly() {
        setSwitchablePaywall(reducedMotion = true, startAnimated = false)
        compose.onNodeWithTag("mosaic-product-plans-monthly-plan-card", useUnmergedTree = true)
            .performScrollTo()
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false

        val selected = digestOf("mosaic-product-plans-yearly-plan-card")
        compose.onNodeWithTag("mosaic-product-plans-monthly-plan-card", useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.mainClock.advanceTimeBy(16)
        val immediate = digestOf("mosaic-product-plans-yearly-plan-card")
        compose.mainClock.advanceTimeBy(2_000)
        val settled = digestOf("mosaic-product-plans-yearly-plan-card")

        assertNotEquals("Deselecting a card must change how it is drawn.", selected, settled)
        assertEquals(
            "Reduced motion must apply a selection with no intermediate frame.",
            settled,
            immediate,
        )
    }

    /**
     * Motion never reaches the accessibility tree.
     *
     * A node mid-entrance is already present, focusable, and announceable, and a pulsing Button
     * announces exactly what a static one announces. Asserted mid-flight rather than at rest,
     * because at rest there is nothing left to get wrong.
     */
    @Test
    fun motionDoesNotChangeWhatIsAnnouncedOrReachable() {
        setSwitchablePaywall()

        compose.mainClock.advanceTimeBy(120)
        val midFlight = announcementOf("mosaic-node-purchase")
        compose.mainClock.advanceTimeBy(6_000)
        val settled = announcementOf("mosaic-node-purchase")

        assertEquals(settled, midFlight)
        assertTrue("A pulsing Button must still announce something.", settled.isNotEmpty())
    }

    /**
     * The countdown's tick is the motion driver's, not a wall-clock delay.
     *
     * Before this, the only way to observe a second countdown frame was to wait a real second, so
     * nothing asserted the loop at all. Rounding is unchanged and stays [MosaicCountdownText]'s.
     */
    @Test
    fun countdownTicksThroughTheInjectedDriver() {
        val driver = MosaicRecordingMotionDriver(
            isEnabled = true,
            onTick = { kotlinx.coroutines.delay(1) },
        )
        val document = protocolV04Bundle()
        val countdown = document.walkNodesDepthFirst()
            .filterIsInstance<MosaicCountdownComponent>()
            .first()
        val state = MosaicPaywallState(
            document,
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            clock = { countdown.endsAtEpochMillis - 30_000L },
            motionDriver = driver,
        )
        runBlocking { state.loadProducts() }
        // The Countdown is behind a Switch condition; a false condition removes it from layout
        // entirely, so the tick loop only exists once the Switch is off.
        state.setSwitchValue("show-offer-details", false)
        compose.setContent {
            MaterialTheme { MosaicPaywallContent(state = state, onEvent = {}, reducedMotion = true) }
        }

        compose.waitUntil(5_000) { driver.tickCount > 2 }
        assertTrue(driver.tickCount > 2)
    }

    /**
     * The pulse is already running while the entrance plays.
     *
     * The canonical purchase Button authors both `appear` (behind a 240ms delay) and `loop`, and the
     * contract fixes their time origin as node entry. Proved by rendering the same document twice —
     * once as authored, once with only that Button's `loop` removed — and pinning the *same*
     * mid-entrance frame in both. A renderer that started the pulse only once the entrance had
     * finished would draw the two identically at that instant; a conforming one cannot.
     *
     * The two states share one driver instance, so swapping between them preserves the remembered
     * entrance clock: the only thing that differs between the captures is the pulse.
     */
    @Test
    fun theLoopRunsDuringTheEntranceRatherThanAfterIt() {
        compose.mainClock.autoAdvance = true
        val driver = pinnedCountdown(MosaicMotionDriver.Default)
        val document = protocolV04Bundle()
        val withLoop = motionState(driver, document)
        val withoutLoop = motionState(driver, document.withoutPurchaseLoop())
        val settled = motionState(pinnedCountdown(MosaicMotionDriver.Disabled), document)
        runBlocking {
            withLoop.loadProducts()
            withoutLoop.loadProducts()
            settled.loadProducts()
        }
        var shown by mutableStateOf(0)
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(
                    state = when (shown) {
                        0 -> settled
                        1 -> withLoop
                        else -> withoutLoop
                    },
                    onEvent = {},
                    reducedMotion = false,
                )
            }
        }
        // Scrolled into view with motion disabled, so settling waits on nothing that is moving.
        compose.onNodeWithTag("mosaic-node-purchase", useUnmergedTree = true).performScrollTo()
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false

        // Node entry for the animated tree is this frame; 360ms in, the 240ms-delayed entrance is
        // half way through its curve and the 900ms pulse is 40% through its first cycle.
        shown = 1
        compose.mainClock.advanceTimeBy(360)
        val pulsing = digestOf("mosaic-node-purchase")

        shown = 2
        compose.mainClock.advanceTimeBy(16)
        val notPulsing = digestOf("mosaic-node-purchase")

        assertNotEquals(
            "The pulse must already be running mid-entrance, not gated on it finishing.",
            notPulsing,
            pulsing,
        )
    }

    /**
     * A genuine screen re-entry replays the entrance and the pulse, from node entry.
     *
     * `repeat.count` bounds a pulse **per screen entry**, not per document lifetime: a customer who
     * leaves the offer and comes back is arriving at the screen again, and the call to action it
     * draws attention to is exactly as new to them as it was the first time. The opposite reading —
     * three cycles ever — would make the pulse a property of the paywall session, which nothing in
     * the schema expresses and which no renderer could implement without persisting per-node play
     * counts across navigation.
     *
     * Measured as the Button's transformed origin rather than as pixels. A `graphicsLayer` scale
     * about the centre moves the top-left corner, and `positionInRoot` maps through layer transforms
     * without clipping to the viewport — so this holds for a Button laid out below the fold, which
     * matters here because a genuine re-entry also resets the screen's scroll offset and a capture
     * or a bounds comparison would then be measuring an empty rectangle.
     *
     * Driven by `screen-round-trip.json`, the canonical fixture authored for exactly this: two
     * Screen-presentation screens that navigate to each other, each carrying an entrance and a
     * bounded loop. The complete paywall cannot express the case — it declares one Screen, and its
     * second surface is a sheet, which the ruling makes explicitly *not* an entry.
     */
    @Test
    fun aGenuineScreenReEntryReplaysThePulseFromNodeEntry() {
        compose.mainClock.autoAdvance = true
        val state = motionState(
            pinnedCountdown(MosaicMotionDriver.Default),
            v04Fixture("screen-round-trip.json"),
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, onEvent = {}, reducedMotion = false)
            }
        }
        // A bounded pulse stops, so the start screen genuinely settles rather than needing a guessed
        // wait: `waitForIdle` here is a wait on content that has finished moving.
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false

        val rest = positionOf("mosaic-node-view-details")
        compose.mainClock.advanceTimeBy(2_000)
        assertEquals(
            "A pulse that has played its authored cycles must stay at rest.",
            rest,
            positionOf("mosaic-node-view-details"),
        )

        compose.runOnUiThread { state.navigateTo("details") }
        compose.mainClock.advanceTimeBy(16)
        compose.runOnUiThread { state.navigateBack() }
        // 1350ms after re-entry is the peak of the second of the Button's three 900ms cycles, and
        // past the screen's 240ms entrance, so the pulse is the only thing still moving. It is also
        // past the *first* cycle, which is what makes this a fresh budget rather than a resumption:
        // a renderer that carried the spent budget across the round trip would draw the Button at
        // rest here.
        compose.mainClock.advanceTimeBy(1_350)
        val replaying = positionOf("mosaic-node-view-details")
        compose.mainClock.advanceTimeBy(6_000)
        val settled = positionOf("mosaic-node-view-details")

        assertNotEquals(
            "Re-entering a screen must replay its Button's pulse from node entry.",
            rest,
            replaying,
        )
        assertEquals(
            "A replayed pulse must rest exactly where the first one rested.",
            rest,
            settled,
        )
    }

    /**
     * A sheet round trip is not a re-entry: neither presenting nor dismissing replays the screen
     * beneath, and the pulse budget does not reset across the round trip.
     *
     * Presenting a Sheet does not leave the screen underneath — it is still on screen, behind the
     * sheet — so nothing about it has been re-entered. Both halves are asserted because the failure
     * modes are separate: a renderer can hold the screen through the presentation and still rebuild
     * it on dismissal, and a customer who opens a details sheet and closes it would then watch the
     * whole paywall fade in again and the call to action pulse a second three times.
     *
     * The purchase Button's origin is unaffected by the sheet's own slide — the sheet is a separate
     * composition root — so a plain equality holds here.
     */
    @Test
    fun aSheetRoundTripIsNotAReEntryForTheScreenBeneathIt() {
        compose.mainClock.autoAdvance = true
        val document = protocolV04Bundle().withInertDetailsBackground()
        val state = motionState(pinnedCountdown(MosaicMotionDriver.Default), document)
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, onEvent = {}, reducedMotion = false)
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        val rest = positionOf("mosaic-node-purchase")

        compose.runOnUiThread { state.navigateTo("details") }
        // Past the peak of what would be the second of three 900ms cycles, so a pulse restarted by
        // the presentation would be at maximum excursion here rather than merely somewhere.
        compose.mainClock.advanceTimeBy(1_350)
        assertEquals(
            "Presenting a sheet must not replay the motion of the screen behind it.",
            rest,
            positionOf("mosaic-node-purchase"),
        )

        compose.runOnUiThread { state.navigateBack() }
        compose.mainClock.advanceTimeBy(1_350)
        assertEquals(
            "Dismissing a sheet must not replay the motion of the screen behind it.",
            rest,
            positionOf("mosaic-node-purchase"),
        )
    }

    /**
     * ...but the sheet's own content *is* a genuine entry, once per presentation.
     *
     * The other half of the same ruling, and the regression this file most needs after the screen
     * content was hoisted to a single call site: hoisting the *sheet's* content out with it would
     * make a second presentation reuse the first one's clocks and show a customer a sheet whose
     * entrance never plays again.
     *
     * Measured as the offset between the pulsing Button and a motionless sibling on the same sheet.
     * The sheet slides in under its own Material animation, which translates the whole composition
     * root; a difference of two origins inside that root cancels the translation, leaving the pulse
     * as the only thing that can move them relative to each other. Sampled across the cycle rather
     * than pinned to one instant, because which frame the sheet settles on is a Material scheduling
     * detail this contract says nothing about.
     */
    @Test
    fun aSheetsOwnContentIsAGenuineEntryOnEveryPresentation() {
        compose.mainClock.autoAdvance = true
        val document = protocolV04Bundle().withInertDetailsBackground()
        val state = motionState(pinnedCountdown(MosaicMotionDriver.Default), document)
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, onEvent = {}, reducedMotion = false)
            }
        }
        compose.runOnUiThread { state.navigateTo("details") }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        // Its single 900ms cycle has played out, so this is the sheet at rest.
        compose.mainClock.advanceTimeBy(2_000)
        val rest = sheetPulseOffset()

        compose.runOnUiThread { state.navigateBack() }
        compose.mainClock.advanceTimeBy(16)
        compose.runOnUiThread { state.navigateTo("details") }
        val sampled = buildList {
            repeat(60) {
                compose.mainClock.advanceTimeBy(16)
                add(sheetPulseOffset())
            }
        }
        compose.mainClock.advanceTimeBy(6_000)

        assertTrue(
            "Presenting a sheet again must replay its own content's pulse from node entry.",
            sampled.any { it != rest },
        )
        assertEquals(
            "A replayed pulse must rest exactly where the first one rested.",
            rest,
            sheetPulseOffset(),
        )
    }

    /**
     * The pulsing Button's origin relative to a motionless sibling on the same sheet, which is what
     * makes the measurement independent of where the sheet itself currently sits.
     */
    private fun sheetPulseOffset(): Offset =
        positionOf("mosaic-node-privacy-policy") - positionOf("mosaic-node-details-back")

    /** A paywall whose motion driver can be swapped without a second `setContent`. */
    private class DriverSwitch {
        var useAnimatedDriver by mutableStateOf(true)
    }

    private fun setSwitchablePaywall(
        reducedMotion: Boolean = false,
        startAnimated: Boolean = true,
    ): DriverSwitch {
        // Frames are pinned by default. A test that has to scroll first starts on the disabled
        // driver instead, so that the settling wait happens while nothing is animating.
        compose.mainClock.autoAdvance = !startAnimated
        val switch = DriverSwitch()
        switch.useAnimatedDriver = startAnimated
        val animated = motionState(pinnedCountdown(MosaicMotionDriver.Default))
        val static = motionState(pinnedCountdown(MosaicMotionDriver.Disabled))
        runBlocking {
            animated.loadProducts()
            static.loadProducts()
        }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(
                    state = if (switch.useAnimatedDriver) animated else static,
                    onEvent = {},
                    reducedMotion = reducedMotion,
                    modifier = Modifier.size(width = 360.dp, height = 640.dp),
                )
            }
        }
        return switch
    }

    private fun digestOf(tag: String): String {
        val bitmap: Bitmap = compose.onNodeWithTag(tag, useUnmergedTree = true)
            .captureToImage()
            .asAndroidBitmap()
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val digest = MessageDigest.getInstance("SHA-256")
        pixels.forEach { pixel ->
            digest.update((pixel ushr 24).toByte())
            digest.update((pixel ushr 16).toByte())
            digest.update((pixel ushr 8).toByte())
            digest.update(pixel.toByte())
        }
        return "${bitmap.width}x${bitmap.height} " +
            digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * What TalkBack would read, as a value.
     *
     * A `SemanticsConfiguration` prints its own identity, so comparing two of them by string can
     * never succeed; the contract is about the announced name and state, so that is what is
     * compared.
     */
    private fun announcementOf(tag: String): List<String?> {
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
        return listOf(
            node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(),
            node.config.getOrNull(SemanticsProperties.StateDescription),
            node.config.getOrNull(SemanticsProperties.Role)?.toString(),
            node.config.getOrNull(SemanticsProperties.Disabled)?.toString(),
            node.config.contains(SemanticsActions.OnClick).toString(),
        )
    }

    private fun boundsOf(tag: String) = compose
        .onNodeWithTag(tag, useUnmergedTree = true)
        .fetchSemanticsNode()
        .boundsInRoot

    /**
     * Where the node's own origin lands in root coordinates, layer transforms included.
     *
     * Unclipped, unlike [boundsOf] and unlike a capture, so a node laid out below the fold is still
     * measurable — and a scale about the centre is observable there, because it moves the origin.
     */
    private fun positionOf(tag: String) = compose
        .onNodeWithTag(tag, useUnmergedTree = true)
        .fetchSemanticsNode()
        .positionInRoot

    /**
     * The canonical details screen with its remote video background dropped.
     *
     * Nothing here asserts on that background, and mounting an ExoPlayer against a network URL
     * inside a clock-pinned test would buy nothing but a source of nondeterminism.
     */
    private fun MosaicPaywallDocument.withInertDetailsBackground(): MosaicPaywallDocument = copy(
        screens = screens.map { screen ->
            if (screen.id != "details") {
                screen
            } else {
                screen.copy(layout = screen.layout.copy(background = null))
            }
        },
    )


    private fun motionState(
        driver: MosaicMotionDriver,
        document: MosaicPaywallDocument = protocolV04Bundle(),
    ) = MosaicPaywallState(
        document,
        MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
        clock = { 1_893_455_998_000L },
        motionDriver = driver,
    )

    /**
     * A tick that never completes pins the countdown at exactly one resolved frame, so a digest
     * comparison is measuring motion rather than a clock that moved between two captures.
     */
    private fun pinnedCountdown(driver: MosaicMotionDriver): MosaicMotionDriver =
        object : MosaicMotionDriver by driver {
            override suspend fun awaitTick(intervalMilliseconds: Long): Unit = awaitCancellation()
        }

    /** The canonical document with only the purchase Button's pulse removed. */
    private fun MosaicPaywallDocument.withoutPurchaseLoop(): MosaicPaywallDocument {
        fun replace(node: MosaicNode): MosaicNode = when (node) {
            is MosaicStack -> node.copy(children = node.children.map(::replace))
            is MosaicButtonComponent -> if (node.id == "purchase") {
                node.copy(motion = node.motion?.copy(loop = null))
            } else {
                node.copy(children = node.children.map(::replace))
            }
            is MosaicTabsComponent -> node.copy(
                tabs = node.tabs.map { it.copy(content = replace(it.content) as MosaicStack) },
            )
            is MosaicCarouselComponent -> node.copy(
                pages = node.pages.map { it.copy(content = replace(it.content) as MosaicStack) },
            )
            else -> node
        }
        val updated = screens.map { screen ->
            screen.copy(
                layout = screen.layout.copy(content = replace(screen.layout.content) as MosaicStack),
            )
        }
        return copy(
            screens = updated,
            layout = updated.first { it.id == initialScreenId }.layout,
        )
    }

    private fun protocolV04Bundle(): MosaicPaywallDocument = v04Fixture("complete-paywall.json")

    /** Any canonical `0.4` fixture the build copies into this suite's assets. */
    private fun v04Fixture(name: String): MosaicPaywallDocument {
        val context = InstrumentationRegistry.getInstrumentation().context
        val source = context.assets.open("mosaic/v0.4/$name")
            .bufferedReader().use { it.readText() }
        return MosaicProtocolDecoder.decode(source)
    }

    private companion object {
        const val GOLDEN_UNRECORDED = "unrecorded"
    }
}
