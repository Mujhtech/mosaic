package dev.mosaic.sdk

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MosaicPaywallComposeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun canonicalBundleRendersNativeAccessibleControlsAndInteractions() {
        val results = CopyOnWriteArrayList<MosaicPresentationResult>()
        val interactions = CopyOnWriteArrayList<MosaicInteractionOutcome>()
        compose.setPaywall(
            provider = MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            onResult = results::add,
            onInteraction = interactions::add,
        )
        compose.waitForProducts()

        compose.onNodeWithTag("mosaic-node-headline", useUnmergedTree = true)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
            .assert(SemanticsMatcher.expectValue(MosaicHeadingLevelKey, 1))
        compose.onNodeWithTag("mosaic-node-hero", useUnmergedTree = true)
            .assertContentDescriptionContains("A mosaic of native mobile paywall screens")
        compose.onNodeWithTag("mosaic-product-plans-yearly-plan-card", useUnmergedTree = true)
            .assertIsSelected()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
        compose.onNodeWithTag("mosaic-node-purchase", useUnmergedTree = true)
            .assertIsEnabled()
            .assert(hasClickAction())
        compose.onNodeWithTag("mosaic-node-restore", useUnmergedTree = true).assertIsEnabled()
        compose.onNodeWithTag("mosaic-node-close", useUnmergedTree = true).assert(hasClickAction())

        compose.onNodeWithTag("mosaic-product-plans-monthly-plan-card", useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.waitUntil(5_000) {
            interactions.firstOrNull()?.wireName == "productSelected"
        }
        compose.onNodeWithTag("mosaic-product-plans-monthly-plan-card", useUnmergedTree = true)
            .assertIsSelected()
        compose.onNodeWithTag("mosaic-node-purchase", useUnmergedTree = true)
            .performScrollTo()
            .performClick()
        compose.waitUntil(5_000) { results.isNotEmpty() }

        assertEquals("productSelected", interactions.first().wireName)
        assertEquals("purchased", results.single().wireName)
        assertEquals(
            "monthly-plan",
            (results.single() as MosaicPresentationResult.Purchased).productReferenceId,
        )
    }

    @Test
    fun unavailableProductsShowFallbackDisablePurchaseAndNotifyHost() {
        val results = CopyOnWriteArrayList<MosaicPresentationResult>()
        val interactions = CopyOnWriteArrayList<MosaicInteractionOutcome>()
        compose.setPaywall(
            provider = MockMosaicPurchaseProvider(),
            onResult = results::add,
            onInteraction = interactions::add,
        )
        compose.waitUntil(5_000) { interactions.isNotEmpty() }
        compose.waitForIdle()

        compose.onNodeWithText("Plans are temporarily unavailable.").assertExists()
        compose.onNodeWithTag("mosaic-node-purchase", useUnmergedTree = true)
            .assertIsNotEnabled()
        assertTrue(results.isEmpty())
        assertEquals("productUnavailable", interactions.single().wireName)
        assertEquals(
            "yearly-plan",
            (interactions.single() as MosaicInteractionOutcome.ProductUnavailable).productReferenceId,
        )
    }

    @Test
    fun arabicUsesRtlAndMissingImageUsesLocalizedSameRatioPlaceholder() {
        compose.setPaywall(
            provider = MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            requestedLocale = "ar",
        )
        compose.waitForProducts()

        compose.onNodeWithTag("mosaic-paywall", useUnmergedTree = true)
            .assert(SemanticsMatcher.expectValue(MosaicResolvedLayoutDirectionKey, "rtl"))
        compose.onNodeWithText("افتح جميع مزايا Mosaic Pro", useUnmergedTree = true)
            .assertExists()
        compose.onNodeWithText("الرسم التوضيحي المميز غير متاح", useUnmergedTree = true)
            .assertExists()

        val bounds: Rect = compose.onNodeWithTag("mosaic-node-hero", useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot
        assertEquals(16f / 9f, bounds.width / bounds.height, 0.02f)
    }

    @Test
    fun longGermanAtLargeFontScaleRemainsScrollableAndReachable() {
        val state = MosaicPaywallState(
            canonicalBundle(),
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(density.density, fontScale = 2f),
            ) {
                MaterialTheme {
                    MosaicPaywallContent(
                        state = state,
                        requestedLocale = "de-DE",
                        onEvent = {},
                    )
                }
            }
        }

        compose.onNodeWithText(
            "Schalte sämtliche professionellen Funktionen",
            substring = true,
            useUnmergedTree = true,
        ).assertExists()
        compose.onNodeWithTag("mosaic-node-legal", useUnmergedTree = true)
            .performScrollTo()
            .assertExists()
    }

    @Test
    fun purchaseExposesDisabledBusyAndLocalizedStateDescription() {
        val gate = CompletableDeferred<Unit>()
        val delegate = MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products())
        val provider = object : MosaicPurchaseProvider by delegate {
            override suspend fun purchase(productId: String): MosaicPurchaseResult {
                gate.await()
                return delegate.purchase(productId)
            }
        }
        val state = MosaicPaywallState(canonicalBundle(), provider)
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, onEvent = {})
            }
        }

        compose.onNodeWithTag("mosaic-node-purchase", useUnmergedTree = true)
            .performScrollTo()
            .performClick()
        compose.waitUntil(5_000) {
            "plans" in state.purchaseBusySelectorIds
        }
        compose.onNodeWithTag("mosaic-node-purchase", useUnmergedTree = true)
            .assertIsNotEnabled()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Processing purchase…",
                ),
            )
        gate.complete(Unit)
        compose.waitUntil(5_000) {
            "plans" !in state.purchaseBusySelectorIds
        }
    }

    @Test
    fun protocolV02RendersNativeStatefulControlsAndHiddenSemantics() {
        val document = protocolV02Bundle()
        val selector = document.layout.content.walkDepthFirst()
            .filterIsInstance<MosaicProductSelectorComponent>()
            .single()
        assertEquals(MosaicStackDirection.HORIZONTAL, selector.direction)
        val state = MosaicPaywallState(
            document,
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            clock = { 1_893_455_998_000L },
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, requestedLocale = "en", onEvent = {})
            }
        }

        compose.onNodeWithTag("mosaic-node-show-offer-details")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Switch))
            .assertIsOn()
        compose.onNodeWithTag("mosaic-node-offer-highlights", useUnmergedTree = true)
            .assertExists()
        compose.onNodeWithText("Update without an app release")
            .assertExists()
        compose.onNodeWithTag("mosaic-node-offer-countdown", useUnmergedTree = true)
            .assertDoesNotExist()
        compose.onNodeWithTag("mosaic-product-plans-yearly-plan-card", useUnmergedTree = true)
            .assertIsSelected()
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton),
            )
            .assertContentDescriptionContains("Mosaic Pro Yearly", substring = true)
            .assertContentDescriptionContains("$79.99", substring = true)

        val monthly = compose.onNodeWithTag(
            "mosaic-product-plans-monthly-plan-card",
            useUnmergedTree = true,
        ).fetchSemanticsNode().boundsInRoot
        val yearly = compose.onNodeWithTag(
            "mosaic-product-plans-yearly-plan-card",
            useUnmergedTree = true,
        ).fetchSemanticsNode().boundsInRoot
        assertEquals(monthly.top.toDouble(), yearly.top.toDouble(), 1.0)
        assertTrue(monthly.right <= yearly.left)
        assertEquals(monthly.width.toDouble(), yearly.width.toDouble(), 1.0)

        compose.onNodeWithTag("mosaic-node-show-offer-details")
            .performClick()
        compose.waitUntil(5_000) { !state.switchValue("show-offer-details") }
        compose.onNodeWithTag("mosaic-node-offer-highlights", useUnmergedTree = true)
            .assertDoesNotExist()
        compose.onNodeWithTag("mosaic-node-offer-countdown", useUnmergedTree = true)
            .assertExists()
    }

    @Test
    fun protocolV02NavigateToPresentsANativeSheetOverTheCurrentScreenAndBackDismissesIt() {
        val state = MosaicPaywallState(
            protocolV02Bundle(),
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, onEvent = {})
            }
        }

        compose.onNodeWithTag("mosaic-node-view-details", useUnmergedTree = true)
            .performScrollTo()
            .performClick()
        compose.waitUntil(5_000) { state.currentScreenId == "details" }
        compose.onNodeWithTag("mosaic-paywall", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("mosaic-sheet", useUnmergedTree = true).assertExists()
        assertEquals("offer", state.backgroundScreen.id)

        compose.onNodeWithTag("mosaic-node-details-back", useUnmergedTree = true)
            .performScrollTo()
            .performClick()
        compose.waitUntil(5_000) { state.currentScreenId == "offer" }
        compose.onNodeWithTag("mosaic-sheet", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun protocolV02VerticalSelectorUsesFullWidthSourceOrderedRadioTargets() {
        val document = protocolV02Bundle().withSelectorDirection(MosaicStackDirection.VERTICAL)
        val state = MosaicPaywallState(
            document,
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(state = state, onEvent = {})
            }
        }

        val monthly = compose.onNodeWithTag(
            "mosaic-product-plans-monthly-plan-card",
            useUnmergedTree = true,
        ).fetchSemanticsNode().boundsInRoot
        val yearly = compose.onNodeWithTag(
            "mosaic-product-plans-yearly-plan-card",
            useUnmergedTree = true,
        ).fetchSemanticsNode().boundsInRoot
        assertTrue(monthly.bottom <= yearly.top)
        assertEquals(monthly.left.toDouble(), yearly.left.toDouble(), 1.0)
        assertEquals(monthly.width.toDouble(), yearly.width.toDouble(), 1.0)
    }

    @Test
    fun protocolV02ArabicRtlAtLargeFontScaleRemainsReachable() {
        val state = MosaicPaywallState(
            protocolV02Bundle(),
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            clock = { 1_893_455_998_000L },
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
                MaterialTheme {
                    MosaicPaywallContent(
                        state = state,
                        requestedLocale = "ar-EG",
                        onEvent = {},
                    )
                }
            }
        }

        compose.onNodeWithTag("mosaic-paywall", useUnmergedTree = true)
            .assert(SemanticsMatcher.expectValue(MosaicResolvedLayoutDirectionKey, "rtl"))
        compose.onNodeWithTag("mosaic-node-show-offer-details")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Switch))
        compose.onNodeWithTag("mosaic-node-legal", useUnmergedTree = true)
            .performScrollTo()
            .assertExists()
    }

    @Test
    fun protocolV02ScreenshotMatchesCommittedPixelBaseline() {
        val state = MosaicPaywallState(
            protocolV02Bundle(),
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            clock = { 1_893_455_998_000L },
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(
                    state = state,
                    onEvent = {},
                    modifier = Modifier.size(width = 360.dp, height = 640.dp),
                )
            }
        }
        compose.waitForIdle()

        val image = compose.onNodeWithTag("mosaic-paywall", useUnmergedTree = true).captureToImage()
        val bitmap = image.asAndroidBitmap()
        recordRendererScreenshot(bitmap, "mosaic-paywall-v02.png")
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val digest = MessageDigest.getInstance("SHA-256")
        pixels.forEach { pixel ->
            digest.update((pixel ushr 24).toByte())
            digest.update((pixel ushr 16).toByte())
            digest.update((pixel ushr 8).toByte())
            digest.update(pixel.toByte())
        }
        val actual = "${bitmap.width}x${bitmap.height} " +
            digest.digest().joinToString("") { "%02x".format(it) }
        val expected = InstrumentationRegistry.getInstrumentation().context
            .assets.open("mosaic-paywall-v02-golden.sha256")
            .bufferedReader().use { it.readText().trim() }

        assertEquals("Update only after intentional renderer review. Actual: $actual", expected, actual)
        assertTrue(pixels.toSet().size > 16)
    }

    @Test
    fun bundledFallbackMatchesCurrentProtocolV02PixelBaseline() {
        val document = canonicalBundle()
        assertEquals(MOSAIC_PROTOCOL_VERSION_V02, document.schemaVersion)
        val state = MosaicPaywallState(
            document,
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            clock = { 1_893_455_998_000L },
        )
        runBlocking { state.loadProducts() }
        compose.setContent {
            MaterialTheme {
                MosaicPaywallContent(
                    state = state,
                    onEvent = {},
                    modifier = Modifier.size(width = 360.dp, height = 640.dp),
                )
            }
        }
        compose.waitForIdle()

        val image = compose.onNodeWithTag("mosaic-paywall", useUnmergedTree = true).captureToImage()
        val bitmap = image.asAndroidBitmap()
        recordRendererScreenshot(bitmap, "mosaic-bundled-fallback-v02.png")
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val digest = MessageDigest.getInstance("SHA-256")
        pixels.forEach { pixel ->
            digest.update((pixel ushr 24).toByte())
            digest.update((pixel ushr 16).toByte())
            digest.update((pixel ushr 8).toByte())
            digest.update(pixel.toByte())
        }
        val actual = "${bitmap.width}x${bitmap.height} " +
            digest.digest().joinToString("") { "%02x".format(it) }
        val expected = InstrumentationRegistry.getInstrumentation().context
            .assets.open("mosaic-paywall-v02-golden.sha256")
            .bufferedReader().use { it.readText().trim() }

        assertEquals("Update only after intentional renderer review. Actual: $actual", expected, actual)
        assertTrue(pixels.toSet().size > 16)
    }

    private fun ComposeContentTestRule.setPaywall(
        provider: MosaicPurchaseProvider,
        requestedLocale: String? = "en",
        onResult: (MosaicPresentationResult) -> Unit = {},
        onInteraction: (MosaicInteractionOutcome) -> Unit = {},
    ) {
        setContent {
            MaterialTheme {
                MosaicPaywall(
                    document = canonicalBundle(),
                    purchaseProvider = provider,
                    requestedLocale = requestedLocale,
                    onResult = onResult,
                    onInteraction = onInteraction,
                )
            }
        }
    }

    private fun ComposeContentTestRule.waitForProducts() {
        waitUntil(5_000) {
            val loadingFinished = runCatching {
                onNodeWithTag("mosaic-products-loading", useUnmergedTree = true)
                    .fetchSemanticsNode()
            }.isFailure
            val available = runCatching {
                onNodeWithTag("mosaic-product-plans-yearly-plan-card", useUnmergedTree = true)
                    .fetchSemanticsNode()
            }.isSuccess
            val unavailable = runCatching {
                onNodeWithTag("mosaic-products-unavailable", useUnmergedTree = true)
                    .fetchSemanticsNode()
            }.isSuccess
            loadingFinished && (available || unavailable)
        }
        onNodeWithTag("mosaic-products-loading", useUnmergedTree = true).assertDoesNotExist()
    }

    private fun canonicalBundle(): MosaicPaywallDocument {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val source = checkNotNull(MosaicCanonicalBundleSource(context).read())
        return MosaicProtocolDecoder.decode(source)
    }

    private fun protocolV02Bundle(): MosaicPaywallDocument {
        val context = InstrumentationRegistry.getInstrumentation().context
        val source = context.assets.open("mosaic/v0.2/complete-paywall.json")
            .bufferedReader().use { it.readText() }
        return MosaicProtocolDecoder.decode(source)
    }

    private fun MosaicPaywallDocument.withSelectorDirection(
        direction: MosaicStackDirection,
    ): MosaicPaywallDocument {
        fun replace(node: MosaicNode): MosaicNode = when (node) {
            is MosaicStack -> node.copy(children = node.children.map(::replace))
            is MosaicCarouselComponent -> node.copy(
                pages = node.pages.map { page ->
                    page.copy(content = replace(page.content) as MosaicStack)
                },
            )
            is MosaicButtonComponent -> node.copy(
                children = node.children.map(::replace),
                inProgressChildren = node.inProgressChildren?.map(::replace),
            )
            is MosaicProductSelectorComponent -> node.copy(
                direction = direction,
                crossAxisAlignment = MosaicHorizontalAlignment.STRETCH,
            )
            else -> node
        }
        val updatedScreens = screens.map { screen ->
            screen.copy(
                layout = screen.layout.copy(content = replace(screen.layout.content) as MosaicStack),
            )
        }
        return copy(
            screens = updatedScreens,
            layout = updatedScreens.first { it.id == initialScreenId }.layout,
        )
    }

    private fun recordRendererScreenshot(bitmap: Bitmap, name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        if (InstrumentationRegistry.getArguments().getString("mosaic.recordRendererScreenshots") != "1") {
            return
        }
        val directory = checkNotNull(instrumentation.targetContext.getExternalFilesDir(null))
        FileOutputStream(File(directory, name)).use { output ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
        }
    }
}
