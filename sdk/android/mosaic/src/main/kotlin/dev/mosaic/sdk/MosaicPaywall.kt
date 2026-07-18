package dev.mosaic.sdk

import android.net.Uri
import android.view.ViewGroup
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.media3.ui.AspectRatioFrameLayout
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.cos
import kotlin.math.sin

val MosaicHeadingLevelKey = SemanticsPropertyKey<Int>("MosaicHeadingLevel")
var SemanticsPropertyReceiver.mosaicHeadingLevel by MosaicHeadingLevelKey
val MosaicResolvedLayoutDirectionKey = SemanticsPropertyKey<String>("MosaicResolvedLayoutDirection")
var SemanticsPropertyReceiver.mosaicResolvedLayoutDirection by MosaicResolvedLayoutDirectionKey

private val LocalMosaicProduct = staticCompositionLocalOf<MosaicAvailableProduct?> { null }
private val LocalMosaicDocument = staticCompositionLocalOf<MosaicPaywallDocument?> { null }
private val LocalMosaicImageResolver = staticCompositionLocalOf { MosaicBundledImageResolver.None }
private val LocalMosaicVideoResolver = staticCompositionLocalOf { MosaicBundledVideoResolver.None }
private val LocalMosaicDiagnostics = staticCompositionLocalOf { MosaicDiagnosticSink.None }

internal object MosaicProductTemplate {
    private val pattern = Regex("\\{\\{\\s*product\\.(name|price)\\s*\\}\\}")

    fun resolve(
        value: String,
        providerTitle: String,
        referenceLabel: String,
        localizedPrice: String,
    ): String {
        val name = providerTitle.takeIf(String::isNotBlank) ?: referenceLabel
        return pattern.replace(value) { match ->
            if (match.groupValues[1] == "name") name else localizedPrice
        }
    }
}

/** Resolve and decode logical bundled keys outside composition; return null on any failure. */
fun interface MosaicBundledImageResolver {
    fun resolve(key: String): ImageBitmap?

    companion object {
        val None = MosaicBundledImageResolver { null }
    }
}

/** Resolves a logical bundled video key to a host-owned content/file/resource URI. */
fun interface MosaicBundledVideoResolver {
    fun resolve(key: String): Uri?

    companion object {
        val None = MosaicBundledVideoResolver { null }
    }
}

@Composable
fun MosaicPaywall(
    loadResult: MosaicPaywallLoadResult,
    purchaseProvider: MosaicPurchaseProvider,
    onResult: (MosaicPresentationResult) -> Unit,
    modifier: Modifier = Modifier,
    requestedLocale: String? = null,
    previewTextScale: Float? = null,
    imageResolver: MosaicBundledImageResolver = MosaicBundledImageResolver.None,
    videoResolver: MosaicBundledVideoResolver = MosaicBundledVideoResolver.None,
    diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    clock: () -> Long = System::currentTimeMillis,
    onInteraction: (MosaicInteractionOutcome) -> Unit = {},
) {
    when (loadResult) {
        is MosaicPaywallLoadResult.Loaded -> MosaicPaywall(
            document = loadResult.document,
            purchaseProvider = purchaseProvider,
            onResult = onResult,
            modifier = modifier,
            requestedLocale = requestedLocale,
            previewTextScale = previewTextScale,
            imageResolver = imageResolver,
            videoResolver = videoResolver,
            diagnostics = diagnostics,
            clock = clock,
            onInteraction = onInteraction,
        )
        is MosaicPaywallLoadResult.ConfigurationUnavailable -> {
            LaunchedEffect(loadResult) { onResult(loadResult.presentationResult) }
            Box(modifier = modifier.testTag("mosaic-configuration-unavailable"))
        }
    }
}

@Composable
fun MosaicPaywall(
    document: MosaicPaywallDocument,
    purchaseProvider: MosaicPurchaseProvider,
    onResult: (MosaicPresentationResult) -> Unit,
    modifier: Modifier = Modifier,
    requestedLocale: String? = null,
    previewTextScale: Float? = null,
    imageResolver: MosaicBundledImageResolver = MosaicBundledImageResolver.None,
    videoResolver: MosaicBundledVideoResolver = MosaicBundledVideoResolver.None,
    diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    clock: () -> Long = System::currentTimeMillis,
    onInteraction: (MosaicInteractionOutcome) -> Unit = {},
) {
    val state = remember(document, purchaseProvider, diagnostics) {
        MosaicPaywallState(document, purchaseProvider, diagnostics, clock)
    }
    val dispatch: (MosaicPaywallEvent) -> Unit = { event ->
        onInteraction(event.interaction)
        event.presentationResult?.let(onResult)
    }
    LaunchedEffect(state, requestedLocale) {
        state.loadProducts(requestedLocale).forEach(dispatch)
    }
    MosaicPaywallContent(
        state = state,
        requestedLocale = requestedLocale,
        previewTextScale = previewTextScale,
        imageResolver = imageResolver,
        videoResolver = videoResolver,
        diagnostics = diagnostics,
        onEvent = dispatch,
        modifier = modifier,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MosaicPaywallContent(
    state: MosaicPaywallState,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier = Modifier,
    requestedLocale: String? = null,
    previewTextScale: Float? = null,
    imageResolver: MosaicBundledImageResolver = MosaicBundledImageResolver.None,
    videoResolver: MosaicBundledVideoResolver = MosaicBundledVideoResolver.None,
    diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
) {
    val document = state.document
    val localization = remember(document.localization, requestedLocale) {
        MosaicLocalizationResolver(document.localization, requestedLocale)
    }
    val layoutDirection = if (localization.direction == MosaicLayoutDirection.RTL) {
        LayoutDirection.Rtl
    } else {
        LayoutDirection.Ltr
    }
    val hostDensity = LocalDensity.current
    val previewDensity = remember(hostDensity.density, hostDensity.fontScale, previewTextScale) {
        previewTextScale?.let { Density(hostDensity.density, it.coerceIn(0.5f, 3f)) } ?: hostDensity
    }

    CompositionLocalProvider(
        LocalLayoutDirection provides layoutDirection,
        LocalDensity provides previewDensity,
        LocalMosaicDocument provides document,
        LocalMosaicImageResolver provides imageResolver,
        LocalMosaicVideoResolver provides videoResolver,
        LocalMosaicDiagnostics provides diagnostics,
    ) {
        val current = state.currentScreen
        if (current.presentation == MosaicScreenPresentation.SHEET) {
            MosaicScreenContent(
                screen = state.backgroundScreen,
                state = state,
                localization = localization,
                imageResolver = imageResolver,
                diagnostics = diagnostics,
                onEvent = onEvent,
                layoutDirection = layoutDirection,
                modifier = modifier,
            )
            ModalBottomSheet(
                onDismissRequest = { state.navigateBack() },
                dragHandle = null,
            ) {
                MosaicScreenContent(
                    screen = current,
                    state = state,
                    localization = localization,
                    imageResolver = imageResolver,
                    diagnostics = diagnostics,
                    onEvent = onEvent,
                    layoutDirection = layoutDirection,
                    modifier = Modifier.fillMaxWidth(),
                    isSheet = true,
                )
            }
        } else {
            MosaicScreenContent(
                screen = current,
                state = state,
                localization = localization,
                imageResolver = imageResolver,
                diagnostics = diagnostics,
                onEvent = onEvent,
                layoutDirection = layoutDirection,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun MosaicScreenContent(
    screen: MosaicPaywallScreen,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    layoutDirection: LayoutDirection,
    modifier: Modifier,
    isSheet: Boolean = false,
) {
    val layout = screen.layout
    val scrollState = remember(screen.id) { androidx.compose.foundation.ScrollState(0) }
    Box(
        modifier = modifier
            .then(if (isSheet) Modifier.fillMaxWidth() else Modifier.fillMaxSize())
            .mosaicBackground(layout.background, RectangleShape)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .semantics {
                mosaicResolvedLayoutDirection = if (layoutDirection == LayoutDirection.Rtl) "rtl" else "ltr"
                screen.accessibilityLabel?.let { paneTitle = localization.resolve(it) }
            }
            .testTag(if (isSheet) "mosaic-sheet" else "mosaic-paywall"),
    ) {
        MosaicBackgroundMedia(
            background = layout.background,
            modifier = Modifier.matchParentSize(),
            ownerId = screen.id,
        )
        Column(
            modifier = Modifier
                .then(if (isSheet) Modifier.fillMaxWidth() else Modifier.fillMaxSize())
                .verticalScroll(scrollState),
        ) {
            RenderNode(
                node = layout.content,
                state = state,
                localization = localization,
                imageResolver = imageResolver,
                diagnostics = diagnostics,
                onEvent = onEvent,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (layout.showsIndicators && scrollState.maxValue > 0) {
            MosaicScrollIndicator(
                value = scrollState.value,
                maximum = scrollState.maxValue,
                modifier = Modifier.fillMaxSize().clearAndSetSemantics { },
            )
        }
    }
}

@Composable
private fun MosaicBackgroundMedia(
    background: MosaicBackground?,
    modifier: Modifier,
    ownerId: String,
) {
    when (background) {
        is MosaicBackground.Image -> MosaicDecorativeImageBackground(background, modifier, ownerId)
        is MosaicBackground.Video -> MosaicDecorativeVideoBackground(background, modifier, ownerId)
        else -> Unit
    }
}

@Composable
private fun MosaicDecorativeImageBackground(
    background: MosaicBackground.Image,
    modifier: Modifier,
    ownerId: String,
) {
    val document = LocalMosaicDocument.current ?: return
    val resolver = LocalMosaicImageResolver.current
    val diagnostics = LocalMosaicDiagnostics.current
    val asset = document.assets.filterIsInstance<MosaicImageAsset>()
        .firstOrNull { it.id == background.assetId }
    val bundledSource = asset?.source as? MosaicAssetSource.Bundled
    val bitmap = remember(bundledSource?.key, resolver) {
        bundledSource?.key?.let { runCatching { resolver.resolve(it) }.getOrNull() }
    }
    var remoteFailed by remember(asset) { mutableStateOf(false) }
    val failed = asset == null || bundledSource != null && bitmap == null || remoteFailed
    Box(
        modifier = modifier
            .background(background.fallbackColor.toComposeColor())
            .clearAndSetSemantics { },
    ) {
        when (val source = asset?.source) {
            is MosaicAssetSource.Bundled -> {
                bitmap?.let {
                    Image(
                        bitmap = it,
                        contentDescription = null,
                        contentScale = background.contentMode.toContentScale(),
                        modifier = Modifier.matchParentSize(),
                    )
                }
            }
            is MosaicAssetSource.Remote -> AsyncImage(
                model = source.url,
                contentDescription = null,
                contentScale = background.contentMode.toContentScale(),
                onSuccess = { remoteFailed = false },
                onError = { remoteFailed = true },
                modifier = Modifier.matchParentSize(),
            )
            null -> Unit
        }
    }
    LaunchedEffect(failed, ownerId) {
        if (failed) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.MEDIA_BACKGROUND_UNAVAILABLE,
                    "A decorative image background was unavailable; its fallback colour is shown.",
                ),
            )
        }
    }
}

@Composable
@androidx.annotation.OptIn(UnstableApi::class)
private fun MosaicDecorativeVideoBackground(
    background: MosaicBackground.Video,
    modifier: Modifier,
    ownerId: String,
) {
    val document = LocalMosaicDocument.current ?: return
    val diagnostics = LocalMosaicDiagnostics.current
    val resolver = LocalMosaicVideoResolver.current
    val asset = document.assets.filterIsInstance<MosaicVideoAsset>()
        .firstOrNull { it.id == background.assetId }
    val uri = remember(asset, resolver) {
        when (val source = asset?.source) {
            is MosaicAssetSource.Bundled -> runCatching { resolver.resolve(source.key) }.getOrNull()
            is MosaicAssetSource.Remote -> Uri.parse(source.url)
            null -> null
        }
    }
    var failed by remember(uri) { mutableStateOf(uri == null) }
    Box(
        modifier = modifier
            .background(background.fallbackColor.toComposeColor())
            .clearAndSetSemantics { },
    ) {
        background.posterAssetId?.let { posterId ->
            MosaicDecorativeImageBackground(
                background = MosaicBackground.Image(
                    assetId = posterId,
                    contentMode = background.contentMode,
                    fallbackColor = background.fallbackColor,
                ),
                modifier = Modifier.matchParentSize(),
                ownerId = "$ownerId-poster",
            )
        }
        if (uri != null && !failed) {
            val context = LocalContext.current
            val player = remember(uri) {
                ExoPlayer.Builder(context).build().apply {
                    volume = 0f
                    repeatMode = Player.REPEAT_MODE_ONE
                    playWhenReady = true
                    setMediaItem(MediaItem.fromUri(uri))
                    prepare()
                }
            }
            DisposableEffect(player) {
                val listener = object : Player.Listener {
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        failed = true
                    }
                }
                player.addListener(listener)
                onDispose {
                    player.removeListener(listener)
                    player.release()
                }
            }
            AndroidView(
                factory = { viewContext ->
                    PlayerView(viewContext).apply {
                        useController = false
                        this.player = player
                        resizeMode = when (background.contentMode) {
                            MosaicImageContentMode.FIT -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                            MosaicImageContentMode.FILL -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        }
                        setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
                    }
                },
                modifier = Modifier.matchParentSize(),
            )
        }
    }
    LaunchedEffect(failed, ownerId) {
        if (failed) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.MEDIA_BACKGROUND_UNAVAILABLE,
                    "A decorative video background was unavailable; its poster or fallback colour is shown.",
                ),
            )
        }
    }
}

private fun MosaicImageContentMode.toContentScale(): ContentScale = when (this) {
    MosaicImageContentMode.FIT -> ContentScale.Fit
    MosaicImageContentMode.FILL -> ContentScale.Crop
}

@Composable
private fun RenderStack(
    stack: MosaicStack,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!state.isVisible(stack.visibility)) return
    val presented = modifier
        .mosaicPresentation(stack.appearance, stack.sizing, stack.outerInsets)
        .padding(
            start = stack.padding.start.dp,
            top = stack.padding.top.dp,
            end = stack.padding.end.dp,
            bottom = stack.padding.bottom.dp,
        )
        .testTag("mosaic-node-${stack.id}")
    if (stack.direction == MosaicStackDirection.VERTICAL) {
        Column(
            modifier = presented,
            verticalArrangement = stack.verticalArrangement(),
            horizontalAlignment = stack.composeHorizontalAlignment(),
        ) {
            stack.children.forEach { child ->
                RenderNode(
                    child,
                    state,
                    localization,
                    imageResolver,
                    diagnostics,
                    onEvent,
                    if (stack.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                        Modifier.fillMaxWidth()
                    } else {
                        Modifier
                    },
                )
            }
        }
    } else {
        Row(
            modifier = presented,
            horizontalArrangement = stack.horizontalArrangement(),
            verticalAlignment = stack.composeVerticalAlignment(),
        ) {
            stack.children.forEach { child ->
                RenderNode(
                    child,
                    state,
                    localization,
                    imageResolver,
                    diagnostics,
                    onEvent,
                    if (stack.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH &&
                        stack.sizing?.height is MosaicHeightSizing.Fixed
                    ) {
                        Modifier.fillMaxHeight()
                    } else {
                        Modifier
                    },
                )
            }
        }
    }
}

@Composable
private fun RenderNode(
    node: MosaicNode,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    if (!state.isVisible(node.visibilityOrAlways())) return
    val mediaBackground = node.appearanceOrNull()?.background
        ?.takeIf { it is MosaicBackground.Image || it is MosaicBackground.Video }
    if (mediaBackground != null) {
        Box(modifier) {
            MosaicBackgroundMedia(mediaBackground, Modifier.matchParentSize(), node.id)
            RenderNodeCore(
                node,
                state,
                localization,
                imageResolver,
                diagnostics,
                onEvent,
                Modifier,
            )
        }
        return
    }
    RenderNodeCore(node, state, localization, imageResolver, diagnostics, onEvent, modifier)
}

@Composable
private fun RenderNodeCore(
    node: MosaicNode,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    when (node) {
        is MosaicStack -> RenderStack(node, state, localization, imageResolver, diagnostics, onEvent, modifier)
        is MosaicTextComponent -> RenderText(node, localization, modifier)
        is MosaicImageComponent -> RenderImage(
            node,
            state.document,
            localization,
            imageResolver,
            diagnostics,
            modifier,
        )
        is MosaicFeatureListComponent -> RenderFeatureList(node, localization, modifier)
        is MosaicProductSelectorComponent -> RenderProductSelector(
            node,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
        is MosaicPurchaseButtonComponent -> RenderPurchaseButton(
            node,
            state,
            localization,
            onEvent,
            modifier,
        )
        is MosaicRestoreButtonComponent -> RenderRestoreButton(node, state, localization, onEvent, modifier)
        is MosaicCloseButtonComponent -> RenderCloseButton(node, state, localization, onEvent, modifier)
        is MosaicLegalTextComponent -> RenderLegalText(node, localization, modifier)
        is MosaicCarouselComponent -> RenderCarousel(
            node,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
        is MosaicSwitchComponent -> RenderSwitch(node, state, localization, modifier)
        is MosaicCountdownComponent -> RenderCountdown(node, state, localization, modifier)
        is MosaicButtonComponent -> RenderButton(
            node,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
        is MosaicIconComponent -> RenderIcon(node, localization, modifier)
        is MosaicProductCardComponent,
        is MosaicProductBadgeComponent,
        -> Unit // Strict decoding only exposes these through Product Selector-owned rendering.
    }
}

private fun MosaicNode.appearanceOrNull(): MosaicBoxAppearance? = when (this) {
    is MosaicStack -> appearance
    is MosaicTextComponent -> appearance
    is MosaicImageComponent -> appearance
    is MosaicIconComponent -> appearance
    is MosaicFeatureListComponent -> appearance
    is MosaicProductSelectorComponent -> appearance
    is MosaicButtonComponent -> appearance
    is MosaicCarouselComponent -> appearance
    is MosaicSwitchComponent -> appearance
    is MosaicCountdownComponent -> appearance
    is MosaicPurchaseButtonComponent -> appearance
    is MosaicRestoreButtonComponent -> appearance
    is MosaicCloseButtonComponent -> appearance
    is MosaicLegalTextComponent -> appearance
    is MosaicProductCardComponent,
    is MosaicProductBadgeComponent,
    -> null
}

@Composable
private fun RenderButton(
    component: MosaicButtonComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val isBusy = when (component.action) {
        is MosaicPurchaseAction -> component.action.productSelectorId in state.purchaseBusySelectorIds
        MosaicRestoreAction -> state.isRestoreBusy
        else -> false
    }
    val enabled = when (val action = component.action) {
        is MosaicPurchaseAction -> {
            val selector = state.selectorStates[action.productSelectorId]
            selector?.selectedProductReferenceId != null &&
                state.isNodeVisible(action.productSelectorId) &&
                !isBusy
        }
        MosaicRestoreAction -> !isBusy
        else -> true
    }
    val appearance = component.appearance
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(
        (appearance?.cornerRadius ?: 0.0).dp,
    )
    Button(
        onClick = {
            when (val action = component.action) {
                is MosaicPurchaseAction -> scope.launch { onEvent(state.purchase(action.productSelectorId)) }
                MosaicRestoreAction -> scope.launch { onEvent(state.restore()) }
                MosaicCloseAction -> onEvent(state.close())
                is MosaicNavigateToAction -> state.navigateTo(action.screenId)
                MosaicNavigateBackAction -> state.navigateBack()
                is MosaicOpenExternalUrlAction -> {
                    val opened = runCatching { uriHandler.openUri(action.url) }.isSuccess
                    state.recordExternalUrlResult(opened)
                }
            }
        },
        enabled = enabled,
        modifier = modifier
            .mosaicPresentation(
                appearance = appearance?.copy(border = null, padding = null),
                sizing = component.sizing,
                outerInsets = component.outerInsets,
            )
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
                if (isBusy) stateDescription = component.busyStateDescription(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        shape = shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = (appearance?.background as? MosaicBackground.Solid)?.color?.toComposeColor()
                ?: Color.Transparent,
        ),
        border = appearance?.border?.let { BorderStroke(it.width.dp, it.color.toComposeColor()) },
        contentPadding = appearance?.padding?.toPaddingValues() ?: PaddingValues(0.dp),
    ) {
        val children = if (isBusy) component.inProgressChildren ?: component.children else component.children
        Box(Modifier.clearAndSetSemantics { }) {
            if (component.direction == MosaicStackDirection.VERTICAL) {
                Column(
                    verticalArrangement = component.verticalArrangement(),
                    horizontalAlignment = component.composeHorizontalAlignment(),
                ) {
                    children.forEach { child ->
                        RenderNode(
                            child,
                            state,
                            localization,
                            imageResolver,
                            diagnostics,
                            onEvent,
                            if (component.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                                Modifier.fillMaxWidth()
                            } else {
                                Modifier
                            },
                        )
                    }
                }
            } else {
                Row(
                    horizontalArrangement = component.horizontalArrangement(),
                    verticalAlignment = component.composeVerticalAlignment(),
                ) {
                    children.forEach { child ->
                        RenderNode(
                            child,
                            state,
                            localization,
                            imageResolver,
                            diagnostics,
                            onEvent,
                            Modifier,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RenderIcon(
    component: MosaicIconComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    val layoutDirection = LocalLayoutDirection.current
    val informativeLabel = (component.accessibility as? MosaicImageAccessibility.Informative)
        ?.label
        ?.let(localization::resolve)
    val semanticsModifier = if (informativeLabel == null) {
        Modifier.clearAndSetSemantics { }
    } else {
        Modifier.semantics { contentDescription = informativeLabel }
    }
    val iconColor = component.color.toComposeColor()
    Canvas(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .size(component.size.dp)
            .then(semanticsModifier)
            .testTag("mosaic-node-${component.id}"),
    ) {
        val strokeWidth = max(1.5f, size.minDimension * 0.085f)
        val color = iconColor
        val mirror = layoutDirection == LayoutDirection.Rtl && component.name in setOf(
            MosaicIconName.ARROW_BACKWARD,
            MosaicIconName.ARROW_FORWARD,
            MosaicIconName.CHEVRON_BACKWARD,
            MosaicIconName.CHEVRON_FORWARD,
        )
        val drawGlyph: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit = {
            when (component.name) {
                MosaicIconName.CHECKMARK -> drawPath(
                    Path().apply {
                        moveTo(size.width * 0.18f, size.height * 0.52f)
                        lineTo(size.width * 0.42f, size.height * 0.76f)
                        lineTo(size.width * 0.84f, size.height * 0.26f)
                    },
                    color,
                    style = Stroke(strokeWidth, cap = StrokeCap.Round),
                )
                MosaicIconName.CLOSE -> {
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * 0.22f, size.height * 0.22f),
                        androidx.compose.ui.geometry.Offset(size.width * 0.78f, size.height * 0.78f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * 0.78f, size.height * 0.22f),
                        androidx.compose.ui.geometry.Offset(size.width * 0.22f, size.height * 0.78f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                }
                MosaicIconName.LOCK -> {
                    drawRoundRect(
                        color,
                        topLeft = androidx.compose.ui.geometry.Offset(size.width * 0.2f, size.height * 0.42f),
                        size = androidx.compose.ui.geometry.Size(size.width * 0.6f, size.height * 0.46f),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.width * 0.08f),
                        style = Stroke(strokeWidth),
                    )
                    drawArc(
                        color,
                        startAngle = 180f,
                        sweepAngle = 180f,
                        useCenter = false,
                        topLeft = androidx.compose.ui.geometry.Offset(size.width * 0.3f, size.height * 0.12f),
                        size = androidx.compose.ui.geometry.Size(size.width * 0.4f, size.height * 0.55f),
                        style = Stroke(strokeWidth, cap = StrokeCap.Round),
                    )
                }
                MosaicIconName.RESTORE -> {
                    drawArc(
                        color,
                        startAngle = -55f,
                        sweepAngle = 285f,
                        useCenter = false,
                        topLeft = androidx.compose.ui.geometry.Offset(size.width * 0.16f, size.height * 0.16f),
                        size = androidx.compose.ui.geometry.Size(size.width * 0.68f, size.height * 0.68f),
                        style = Stroke(strokeWidth, cap = StrokeCap.Round),
                    )
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * 0.18f, size.height * 0.2f),
                        androidx.compose.ui.geometry.Offset(size.width * 0.2f, size.height * 0.45f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                }
                MosaicIconName.EXTERNAL_LINK -> {
                    drawRoundRect(
                        color,
                        topLeft = androidx.compose.ui.geometry.Offset(size.width * 0.14f, size.height * 0.3f),
                        size = androidx.compose.ui.geometry.Size(size.width * 0.56f, size.height * 0.56f),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.width * 0.05f),
                        style = Stroke(strokeWidth),
                    )
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * 0.45f, size.height * 0.55f),
                        androidx.compose.ui.geometry.Offset(size.width * 0.84f, size.height * 0.16f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * 0.58f, size.height * 0.16f),
                        androidx.compose.ui.geometry.Offset(size.width * 0.84f, size.height * 0.16f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * 0.84f, size.height * 0.16f),
                        androidx.compose.ui.geometry.Offset(size.width * 0.84f, size.height * 0.42f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                }
                MosaicIconName.ARROW_BACKWARD,
                MosaicIconName.ARROW_FORWARD,
                MosaicIconName.CHEVRON_BACKWARD,
                MosaicIconName.CHEVRON_FORWARD,
                -> {
                    val pointsLeft = component.name == MosaicIconName.ARROW_BACKWARD ||
                        component.name == MosaicIconName.CHEVRON_BACKWARD
                    val startX = if (pointsLeft) 0.72f else 0.28f
                    val endX = if (pointsLeft) 0.28f else 0.72f
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * startX, size.height * 0.22f),
                        androidx.compose.ui.geometry.Offset(size.width * endX, size.height * 0.5f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width * endX, size.height * 0.5f),
                        androidx.compose.ui.geometry.Offset(size.width * startX, size.height * 0.78f),
                        strokeWidth,
                        StrokeCap.Round,
                    )
                    if (component.name == MosaicIconName.ARROW_BACKWARD ||
                        component.name == MosaicIconName.ARROW_FORWARD
                    ) {
                        drawLine(
                            color,
                            androidx.compose.ui.geometry.Offset(size.width * endX, size.height * 0.5f),
                            androidx.compose.ui.geometry.Offset(size.width * (1f - endX * 0.45f), size.height * 0.5f),
                            strokeWidth,
                            StrokeCap.Round,
                        )
                    }
                }
            }
        }
        if (mirror) {
            scale(scaleX = -1f, scaleY = 1f, pivot = center) { drawGlyph() }
        } else {
            drawGlyph()
        }
    }
}

@Composable
private fun RenderText(
    component: MosaicTextComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    val product = LocalMosaicProduct.current
    val localizedValue = localization.resolve(component.value)
    MosaicStyledText(
        value = product?.let {
            MosaicProductTemplate.resolve(
                localizedValue,
                it.storeProduct.title,
                localization.resolve(it.reference.label),
                it.storeProduct.localizedPrice,
            )
        } ?: localizedValue,
        typography = component.typography,
        accessibility = component.accessibility,
        localization = localization,
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .testTag("mosaic-node-${component.id}"),
    )
}

@Composable
private fun MosaicStyledText(
    value: String,
    typography: MosaicTypography,
    modifier: Modifier = Modifier,
    accessibility: MosaicTextAccessibility? = null,
    localization: MosaicLocalizationResolver? = null,
) {
    Text(
        text = value,
        modifier = modifier.then(
            if (accessibility != null) {
                Modifier.semantics {
                    accessibility.headingLevelOrNull?.let { level ->
                        heading()
                        mosaicHeadingLevel = level
                    }
                    if (localization != null) {
                        accessibility.labelOrNull?.let { label ->
                            contentDescription = localization.resolve(label)
                        }
                    }
                }
            } else {
                Modifier
            },
        ),
        style = typography.toComposeTextStyle(),
        textAlign = typography.alignment.toCompose(),
        maxLines = typography.maxLines ?: Int.MAX_VALUE,
        overflow = when (typography.overflow) {
            MosaicTextOverflow.ELLIPSIS -> TextOverflow.Ellipsis
            MosaicTextOverflow.CLIP, null -> TextOverflow.Clip
        },
    )
}

@Composable
private fun RenderImage(
    component: MosaicImageComponent,
    document: MosaicPaywallDocument,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    modifier: Modifier,
) {
    val asset = document.assets.filterIsInstance<MosaicImageAsset>().first { it.id == component.assetId }
    val bundledKey = (asset.source as? MosaicAssetSource.Bundled)?.key
    val remoteUrl = (asset.source as? MosaicAssetSource.Remote)?.url
    val bitmap = remember(bundledKey, imageResolver) {
        bundledKey?.let { runCatching { imageResolver.resolve(it) }.getOrNull() }
    }
    var remoteFailed by remember(remoteUrl) { mutableStateOf(false) }
    val unavailable = bundledKey != null && bitmap == null || remoteUrl == null && bundledKey == null || remoteFailed
    LaunchedEffect(unavailable, asset.id) {
        if (unavailable) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.IMAGE_UNAVAILABLE,
                    "A bundled paywall image was unavailable; its declared placeholder is shown.",
                ),
            )
        }
    }
    val semanticModifier = when (val accessibility = component.accessibility) {
        MosaicImageAccessibility.Decorative -> Modifier.clearAndSetSemantics { }
        is MosaicImageAccessibility.Informative -> Modifier.semantics(mergeDescendants = true) {
            contentDescription = localization.resolve(accessibility.label)
        }
    }
    var frameModifier = modifier
            .mosaicOuterAndSizing(component.sizing, component.outerInsets)
            .then(if (component.sizing == null) Modifier.mosaicWidth(component.width) else Modifier)
        .then(
            component.aspectRatio?.let { Modifier.aspectRatio(it.toFloat()) }
                ?: component.height?.let { Modifier.height(it.dp) }
                ?: Modifier,
        )
            .mosaicPresentation(component.appearance, null, null)
        .then(semanticModifier)
        .testTag("mosaic-node-${component.id}")
    if (component.appearance?.clipContent != false) frameModifier = frameModifier.clip(
        androidx.compose.foundation.shape.RoundedCornerShape(
            (component.appearance?.cornerRadius ?: 0.0).dp,
        ),
    )

    if (bitmap != null) {
        Image(
            bitmap = bitmap,
            contentDescription = null,
            contentScale = when (component.contentMode) {
                MosaicImageContentMode.FIT -> ContentScale.Fit
                MosaicImageContentMode.FILL -> ContentScale.Crop
            },
            modifier = frameModifier,
        )
    } else if (remoteUrl != null && !remoteFailed) {
        AsyncImage(
            model = remoteUrl,
            contentDescription = null,
            contentScale = component.contentMode.toContentScale(),
            onError = { remoteFailed = true },
            modifier = frameModifier,
        )
    } else {
        Box(
            modifier = frameModifier.background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = localization.resolve(asset.placeholder),
                modifier = Modifier.padding(24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun RenderFeatureList(
    component: MosaicFeatureListComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    Column(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .semantics(mergeDescendants = true) {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        verticalArrangement = Arrangement.spacedBy(component.gap.dp),
    ) {
        component.items.forEach { item ->
            Row(
                modifier = Modifier.fillMaxWidth().testTag("mosaic-feature-${item.id}"),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = "✓",
                    modifier = Modifier.clearAndSetSemantics { },
                    color = component.markerColor.toComposeColor(),
                    style = component.typography.toComposeTextStyle(),
                )
                Spacer(Modifier.width(10.dp))
                MosaicStyledText(
                    value = localization.resolve(item.text),
                    typography = component.typography,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun RenderProductSelector(
    component: MosaicProductSelectorComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val selectorState = state.selectorStates.getValue(component.id)
    val containerModifier = modifier
        .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
        .selectableGroup()
        .semantics {
            contentDescription = component.accessibility.resolvedDescriptions(localization)
        }
        .testTag("mosaic-node-${component.id}")

    when {
        selectorState.isLoading -> Box(containerModifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(
                modifier = Modifier.size(32.dp).testTag("mosaic-products-loading"),
            )
        }
        selectorState.options.isEmpty() -> Text(
            text = localization.resolve(component.unavailableFallback.message),
            modifier = containerModifier.testTag("mosaic-products-unavailable"),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
        )
        component.direction == MosaicStackDirection.HORIZONTAL -> Row(
            modifier = if (component.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                containerModifier.height(IntrinsicSize.Max)
            } else {
                containerModifier
            },
            horizontalArrangement = Arrangement.spacedBy(component.gap.dp),
            verticalAlignment = component.selectorVerticalAlignment(),
        ) {
            selectorState.options.forEach { option ->
                val cardWidth = option.card?.sizing?.width
                val cardHeight = option.card?.sizing?.height
                val cardModifier = Modifier
                    .then(
                        if (option.card == null || cardWidth is MosaicWidthSizing.Fill) {
                            Modifier.weight(1f)
                        } else {
                            Modifier
                        },
                    )
                    .then(
                        if (
                            component.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH &&
                            cardHeight !is MosaicHeightSizing.Fixed
                        ) {
                            Modifier.fillMaxHeight()
                        } else {
                            Modifier
                        },
                    )
                if (option.card != null) {
                    RenderProductCard(
                        component,
                        option.card,
                        option,
                        selectorState.selectedProductCardId == option.productCardId,
                        state,
                        localization,
                        imageResolver,
                        diagnostics,
                        onEvent,
                        cardModifier,
                    )
                } else {
                    RenderLegacyProductCard(
                        component,
                        option,
                        selectorState.selectedProductReferenceId == option.reference.id,
                        state,
                        localization,
                        onEvent,
                        cardModifier,
                    )
                }
            }
        }
        else -> Column(
            modifier = containerModifier,
            verticalArrangement = Arrangement.spacedBy(component.gap.dp),
            horizontalAlignment = component.selectorHorizontalAlignment(),
        ) {
            selectorState.options.forEach { option ->
                val cardModifier = if (
                    component.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH
                ) {
                    Modifier.fillMaxWidth()
                } else {
                    Modifier
                }
                if (option.card != null) {
                    RenderProductCard(
                        component,
                        option.card,
                        option,
                        selectorState.selectedProductCardId == option.productCardId,
                        state,
                        localization,
                        imageResolver,
                        diagnostics,
                        onEvent,
                        cardModifier,
                    )
                } else {
                    RenderLegacyProductCard(
                        component,
                        option,
                        selectorState.selectedProductReferenceId == option.reference.id,
                        state,
                        localization,
                        onEvent,
                        cardModifier,
                    )
                }
            }
        }
    }
}

@Composable
private fun RenderProductCard(
    selector: MosaicProductSelectorComponent,
    card: MosaicProductCardComponent,
    option: MosaicAvailableProduct,
    isSelected: Boolean,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val style = card.styles.resolve(isSelected)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(style.cornerRadius.dp)
    var cardModifier = modifier.mosaicOuterAndSizing(card.sizing, null)
    style.shadow?.let { shadow ->
        cardModifier = cardModifier.dropShadow(
            shape,
            Shadow(
                radius = shadow.blurRadius.dp,
                spread = 0.dp,
                color = shadow.color.toComposeColor(),
                offset = DpOffset(shadow.offsetX.dp, shadow.offsetY.dp),
            ),
        )
    }
    Surface(
        modifier = cardModifier
            .alpha(style.opacity.toFloat())
            .selectable(
                selected = isSelected,
                role = Role.RadioButton,
                onClick = {
                    state.selectProduct(selector.id, card.id)?.let(onEvent)
                },
            )
            .semantics {
                selected = isSelected
                contentDescription = card.accessibilityDescription(option, state, localization)
            }
            .testTag("mosaic-product-${card.id}"),
        shape = shape,
        color = (style.background as? MosaicBackground.Solid)?.color?.toComposeColor()
            ?: Color.Transparent,
        border = BorderStroke(style.border.width.dp, style.border.color.toComposeColor()),
    ) {
        CompositionLocalProvider(LocalMosaicProduct provides option) {
            Box(
                Modifier
                    .mosaicBackground(style.background, shape)
                    .clearAndSetSemantics { },
            ) {
                MosaicBackgroundMedia(
                    style.background,
                    Modifier.matchParentSize(),
                    card.id,
                )
                val contentModifier = Modifier.padding(style.padding.toPaddingValues())
                val nestedChildren = card.children.filterNot { child ->
                    child is MosaicProductBadgeComponent &&
                        child.placement is MosaicProductBadgePlacement.Overlay
                }
                if (card.direction == MosaicStackDirection.VERTICAL) {
                    Column(
                        modifier = contentModifier.then(
                            if (card.sizing?.width is MosaicWidthSizing.Fill) {
                                Modifier.fillMaxWidth()
                            } else {
                                Modifier
                            },
                        ),
                        verticalArrangement = card.verticalArrangement(),
                        horizontalAlignment = card.composeHorizontalAlignment(),
                    ) {
                        nestedChildren.forEach { child ->
                            RenderProductCardChild(
                                child,
                                isSelected,
                                state,
                                localization,
                                imageResolver,
                                diagnostics,
                                onEvent,
                                if (card.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                                    Modifier.fillMaxWidth()
                                } else {
                                    Modifier
                                },
                            )
                        }
                    }
                } else {
                    Row(
                        modifier = contentModifier.then(
                            if (card.sizing?.width is MosaicWidthSizing.Fill) {
                                Modifier.fillMaxWidth()
                            } else {
                                Modifier
                            },
                        ).then(
                            if (card.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                                Modifier.height(IntrinsicSize.Max)
                            } else {
                                Modifier
                            },
                        ),
                        horizontalArrangement = card.horizontalArrangement(),
                        verticalAlignment = card.composeVerticalAlignment(),
                    ) {
                        nestedChildren.forEach { child ->
                            RenderProductCardChild(
                                child,
                                isSelected,
                                state,
                                localization,
                                imageResolver,
                                diagnostics,
                                onEvent,
                                if (card.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                                    Modifier.fillMaxHeight()
                                } else {
                                    Modifier
                                },
                            )
                        }
                    }
                }
                card.children.filterIsInstance<MosaicProductBadgeComponent>()
                    .forEach { badge ->
                        val placement = badge.placement as? MosaicProductBadgePlacement.Overlay
                            ?: return@forEach
                        RenderProductBadge(
                            badge,
                            isSelected,
                            state,
                            localization,
                            imageResolver,
                            diagnostics,
                            onEvent,
                            Modifier
                                .align(placement.anchor.toComposeAlignment())
                                .padding(placement.inset.dp),
                        )
                    }
            }
        }
    }
}

@Composable
private fun RenderProductCardChild(
    child: MosaicNode,
    selected: Boolean,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    if (child is MosaicProductBadgeComponent) {
        RenderProductBadge(
            child,
            selected,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
    } else {
        RenderNode(
            child,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
    }
}

@Composable
private fun RenderProductBadge(
    badge: MosaicProductBadgeComponent,
    selected: Boolean,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val style = badge.styles.resolve(selected)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(style.cornerRadius.dp)
    var badgeModifier = modifier.mosaicOuterAndSizing(badge.sizing, null)
    style.shadow?.let { shadow ->
        badgeModifier = badgeModifier.dropShadow(
            shape,
            Shadow(
                radius = shadow.blurRadius.dp,
                spread = 0.dp,
                color = shadow.color.toComposeColor(),
                offset = DpOffset(shadow.offsetX.dp, shadow.offsetY.dp),
            ),
        )
    }
    Surface(
        modifier = badgeModifier.alpha(style.opacity.toFloat()).testTag("mosaic-node-${badge.id}"),
        shape = shape,
        color = (style.background as? MosaicBackground.Solid)?.color?.toComposeColor()
            ?: Color.Transparent,
        border = BorderStroke(style.border.width.dp, style.border.color.toComposeColor()),
    ) {
        Box(Modifier.mosaicBackground(style.background, shape)) {
            MosaicBackgroundMedia(style.background, Modifier.matchParentSize(), badge.id)
            val contentModifier = Modifier.padding(style.padding.toPaddingValues())
            if (badge.direction == MosaicStackDirection.VERTICAL) {
                Column(
                    modifier = contentModifier,
                verticalArrangement = badge.verticalArrangement(),
                horizontalAlignment = badge.composeHorizontalAlignment(),
                ) {
                    badge.children.forEach { child ->
                    RenderNode(
                        child,
                        state,
                        localization,
                        imageResolver,
                        diagnostics,
                        onEvent,
                        if (badge.crossAxisAlignment == MosaicHorizontalAlignment.STRETCH) {
                            Modifier.fillMaxWidth()
                        } else {
                            Modifier
                        },
                    )
                    }
                }
            } else {
                Row(
                    modifier = contentModifier,
                horizontalArrangement = badge.horizontalArrangement(),
                verticalAlignment = badge.composeVerticalAlignment(),
                ) {
                    badge.children.forEach { child ->
                    RenderNode(
                        child,
                        state,
                        localization,
                        imageResolver,
                        diagnostics,
                        onEvent,
                        Modifier,
                    )
                    }
                }
            }
        }
    }
}

@Composable
private fun RenderLegacyProductCard(
    component: MosaicProductSelectorComponent,
    option: MosaicAvailableProduct,
    isSelected: Boolean,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val style = component.cardStyles.resolve(isSelected)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(style.cornerRadius.dp)
    Surface(
        modifier = modifier
            .selectable(
                selected = isSelected,
                role = Role.RadioButton,
                onClick = { state.selectProduct(component.id, option.reference.id)?.let(onEvent) },
            )
            .semantics {
                selected = isSelected
                contentDescription = buildList {
                    add(localization.resolve(option.reference.label))
                    option.reference.badge?.let { add(localization.resolve(it)) }
                    add(option.storeProduct.localizedPrice)
                }.joinToString(", ")
            }
            .testTag("mosaic-product-${option.reference.id}"),
        shape = shape,
        color = style.background.toComposeColor(),
        border = BorderStroke(style.border.width.dp, style.border.color.toComposeColor()),
    ) {
        Row(
            modifier = Modifier.padding(style.padding.toPaddingValues()).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(style.contentGap.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = localization.resolve(option.reference.label),
                modifier = Modifier.weight(1f),
                color = style.productLabelColor.toComposeColor(),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = option.storeProduct.localizedPrice,
                color = style.runtimePriceColor.toComposeColor(),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}

@Composable
private fun RenderPurchaseButton(
    component: MosaicPurchaseButtonComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    val selector = state.selectorStates.getValue(component.action.productSelectorId)
    val isBusy = component.action.productSelectorId in state.purchaseBusySelectorIds
    val appearance = component.appearance
    Button(
        onClick = { scope.launch { onEvent(state.purchase(component.action.productSelectorId)) } },
        enabled = selector.selectedProductReferenceId != null &&
            state.isNodeVisible(component.action.productSelectorId) &&
            !isBusy,
        modifier = modifier
            .mosaicOuterAndSizing(component.sizing, component.outerInsets)
            .alpha((appearance?.opacity ?: 1.0).toFloat())
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
                if (isBusy) stateDescription = localization.resolve(component.inProgressLabel)
            }
            .testTag("mosaic-node-${component.id}"),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(
            (appearance?.cornerRadius ?: 10.0).dp,
        ),
        colors = ButtonDefaults.buttonColors(
            containerColor = (appearance?.background as? MosaicBackground.Solid)?.color?.toComposeColor()
                ?: MaterialTheme.colorScheme.primary,
            contentColor = component.typography.color.toComposeColor(),
        ),
        border = appearance?.border?.let {
            BorderStroke(it.width.dp, it.color.toComposeColor())
        },
        contentPadding = appearance?.padding?.toPaddingValues()
            ?: ButtonDefaults.ContentPadding,
    ) {
        if (isBusy) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp).clearAndSetSemantics { },
                color = component.typography.color.toComposeColor(),
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.width(8.dp))
        }
        MosaicStyledText(
            value = localization.resolve(if (isBusy) component.inProgressLabel else component.label),
            typography = component.typography,
        )
    }
}

@Composable
private fun RenderRestoreButton(
    component: MosaicRestoreButtonComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    val isBusy = state.isRestoreBusy
    StyledTextButton(
        label = localization.resolve(if (isBusy) component.inProgressLabel else component.label),
        typography = component.typography,
        appearance = component.appearance,
        sizing = component.sizing,
        outerInsets = component.outerInsets,
        enabled = !isBusy,
        modifier = modifier
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
                if (isBusy) stateDescription = localization.resolve(component.inProgressLabel)
            }
            .testTag("mosaic-node-${component.id}"),
        onClick = { scope.launch { onEvent(state.restore()) } },
        leading = if (isBusy) {
            {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp).clearAndSetSemantics { },
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.width(8.dp))
            }
        } else {
            null
        },
    )
}

@Composable
private fun RenderCloseButton(
    component: MosaicCloseButtonComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    StyledTextButton(
        label = localization.resolve(component.label),
        typography = component.typography,
        appearance = component.appearance,
        sizing = component.sizing,
        outerInsets = component.outerInsets,
        enabled = true,
        modifier = modifier
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        onClick = { onEvent(state.close()) },
    )
}

@Composable
private fun StyledTextButton(
    label: String,
    typography: MosaicTypography,
    appearance: MosaicBoxAppearance?,
    sizing: MosaicBoxSizing?,
    outerInsets: MosaicEdgeInsets?,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
    leading: (@Composable () -> Unit)? = null,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .mosaicOuterAndSizing(sizing, outerInsets)
            .alpha((appearance?.opacity ?: 1.0).toFloat()),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(
            (appearance?.cornerRadius ?: 9.0).dp,
        ),
        colors = ButtonDefaults.textButtonColors(
            containerColor = (appearance?.background as? MosaicBackground.Solid)?.color?.toComposeColor()
                ?: Color.Transparent,
            contentColor = typography.color.toComposeColor(),
        ),
        border = appearance?.border?.let { BorderStroke(it.width.dp, it.color.toComposeColor()) },
        contentPadding = appearance?.padding?.toPaddingValues() ?: ButtonDefaults.TextButtonContentPadding,
    ) {
        leading?.invoke()
        MosaicStyledText(value = label, typography = typography)
    }
}

@Composable
private fun RenderLegalText(
    component: MosaicLegalTextComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    MosaicStyledText(
        value = localization.resolve(component.value),
        typography = component.typography,
        accessibility = component.accessibility,
        localization = localization,
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .testTag("mosaic-node-${component.id}"),
    )
}

@Composable
private fun RenderSwitch(
    component: MosaicSwitchComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    val checked = state.switchValue(component.id)
    Row(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .toggleable(
                value = checked,
                role = Role.Switch,
                onValueChange = { state.setSwitchValue(component.id, it) },
            )
            .semantics(mergeDescendants = true) {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MosaicStyledText(
            value = localization.resolve(component.label),
            typography = component.typography,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = component.thumbColor.toComposeColor(),
                uncheckedThumbColor = component.thumbColor.toComposeColor(),
                checkedTrackColor = component.onTrackColor.toComposeColor(),
                uncheckedTrackColor = component.offTrackColor.toComposeColor(),
            ),
        )
    }
}

@Composable
private fun RenderCarousel(
    component: MosaicCarouselComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    val pagerState = rememberPagerState(
        initialPage = state.carouselPageIndex(component.id),
        pageCount = { component.pages.size },
    )
    LaunchedEffect(pagerState.currentPage) {
        state.setCarouselPageIndex(component.id, pagerState.currentPage)
    }
    Column(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth()) {
            component.pages.forEach { page ->
                RenderStack(
                    page.content,
                    state,
                    localization,
                    imageResolver,
                    diagnostics,
                    onEvent,
                    Modifier.fillMaxWidth().alpha(0f).clearAndSetSemantics { },
                )
            }
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.matchParentSize(),
                beyondViewportPageCount = 1,
            ) { pageIndex ->
                val page = component.pages[pageIndex]
                Box(
                    Modifier.fillMaxSize().semantics {
                        contentDescription = localization.resolve(page.accessibilityLabel)
                    },
                ) {
                    RenderStack(
                        page.content,
                        state,
                        localization,
                        imageResolver,
                        diagnostics,
                        onEvent,
                        Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        if (component.showsIndicators) {
            Row(
                modifier = Modifier.align(Alignment.CenterHorizontally).clearAndSetSemantics { },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                component.pages.indices.forEach { index ->
                    Box(
                        Modifier
                            .size(if (index == pagerState.currentPage) 8.dp else 6.dp)
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(999.dp))
                            .background(
                                if (index == pagerState.currentPage) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.outlineVariant
                                },
                            ),
                    )
                }
            }
        }
    }
}

@Composable
private fun RenderCountdown(
    component: MosaicCountdownComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    var now by remember(component.id, component.endsAtEpochMillis) {
        mutableLongStateOf(state.currentTimeMillis())
    }
    LaunchedEffect(component.id, component.endsAtEpochMillis) {
        while (now < component.endsAtEpochMillis) {
            delay(1_000)
            now = state.currentTimeMillis()
        }
    }
    MosaicStyledText(
        value = MosaicCountdownText.resolve(
            component,
            now,
            localization.resolve(component.completedText),
        ),
        typography = component.typography,
        accessibility = component.accessibility,
        localization = localization,
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .testTag("mosaic-node-${component.id}"),
    )
}

object MosaicCountdownText {
    fun resolve(
        component: MosaicCountdownComponent,
        nowEpochMillis: Long,
        completedText: String,
    ): String {
        var remaining = max(0L, (component.endsAtEpochMillis - nowEpochMillis) / 1_000L)
        if (remaining <= 0) return completedText
        val units = listOf(
            Triple(MosaicCountdownUnit.DAY, 86_400L, "d"),
            Triple(MosaicCountdownUnit.HOUR, 3_600L, "h"),
            Triple(MosaicCountdownUnit.MINUTE, 60L, "m"),
            Triple(MosaicCountdownUnit.SECOND, 1L, "s"),
        )
        return buildList {
            units.forEach { (unit, divisor, suffix) ->
                if (unit.rank <= component.largestUnit.rank && unit.rank >= component.smallestUnit.rank) {
                    add("${remaining / divisor}$suffix")
                    remaining %= divisor
                }
            }
        }.joinToString(" ")
    }
}

@Composable
private fun Modifier.mosaicPresentation(
    appearance: MosaicBoxAppearance?,
    sizing: MosaicBoxSizing?,
    outerInsets: MosaicEdgeInsets?,
): Modifier {
    var result = mosaicOuterAndSizing(sizing, outerInsets)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(
        (appearance?.cornerRadius ?: 0.0).dp,
    )
    appearance?.shadow?.let { shadow ->
        result = result.dropShadow(
            shape = shape,
            shadow = Shadow(
                radius = shadow.blurRadius.dp,
                spread = 0.dp,
                color = shadow.color.toComposeColor(),
                offset = DpOffset(shadow.offsetX.dp, shadow.offsetY.dp),
            ),
        )
    }
    if (appearance?.clipContent == true) result = result.clip(shape)
    result = result.mosaicBackground(appearance?.background, shape)
    appearance?.border?.let {
        result = result.border(it.width.dp, it.color.toComposeColor(), shape)
    }
    appearance?.opacity?.let { result = result.alpha(it.toFloat()) }
    appearance?.padding?.let {
        result = result.padding(
            start = it.start.dp,
            top = it.top.dp,
            end = it.end.dp,
            bottom = it.bottom.dp,
        )
    }
    return result
}

@Composable
private fun Modifier.mosaicOuterAndSizing(
    sizing: MosaicBoxSizing?,
    outerInsets: MosaicEdgeInsets?,
): Modifier {
    var result = this
    outerInsets?.let {
        result = result.padding(
            start = it.start.dp,
            top = it.top.dp,
            end = it.end.dp,
            bottom = it.bottom.dp,
        )
    }
    if (sizing != null) {
        val diagnostics = LocalMosaicDiagnostics.current
        val widthReported = remember(sizing) { AtomicBoolean(false) }
        val heightReported = remember(sizing) { AtomicBoolean(false) }
        result = result.layout { measurable, constraints ->
            var childConstraints = constraints
            childConstraints = when (val width = sizing.width) {
                MosaicWidthSizing.Content, null -> childConstraints.copy(minWidth = 0)
                MosaicWidthSizing.Fill -> if (constraints.hasBoundedWidth) {
                    childConstraints.copy(minWidth = constraints.maxWidth)
                } else {
                    if (widthReported.compareAndSet(false, true)) {
                        diagnostics.record(
                            MosaicDiagnostic(
                                MosaicDiagnosticCode.LAYOUT_UNBOUNDED_FILL,
                                "Width Fill used Fit because its parent width is unbounded.",
                            ),
                        )
                    }
                    childConstraints.copy(minWidth = 0)
                }
                is MosaicWidthSizing.Fixed -> {
                    val pixels = width.value.dp.roundToPx().coerceAtLeast(1)
                    childConstraints.copy(minWidth = pixels, maxWidth = pixels)
                }
            }
            childConstraints = when (val height = sizing.height) {
                MosaicHeightSizing.Content, null -> childConstraints.copy(minHeight = 0)
                MosaicHeightSizing.Fill -> if (constraints.hasBoundedHeight) {
                    childConstraints.copy(minHeight = constraints.maxHeight)
                } else {
                    if (heightReported.compareAndSet(false, true)) {
                        diagnostics.record(
                            MosaicDiagnostic(
                                MosaicDiagnosticCode.LAYOUT_UNBOUNDED_FILL,
                                "Height Fill used Fit because its parent height is unbounded.",
                            ),
                        )
                    }
                    childConstraints.copy(minHeight = 0)
                }
                is MosaicHeightSizing.Fixed -> {
                    val pixels = height.value.dp.roundToPx().coerceAtLeast(1)
                    childConstraints.copy(minHeight = pixels, maxHeight = pixels)
                }
            }
            val placeable = measurable.measure(childConstraints)
            layout(placeable.width, placeable.height) { placeable.placeRelative(0, 0) }
        }
    }
    if (sizing?.width is MosaicWidthSizing.Fixed || sizing?.height is MosaicHeightSizing.Fixed) {
        result = result.clipToBounds()
    }
    return result
}

@Composable
private fun Modifier.mosaicBackground(background: MosaicBackground?, shape: Shape): Modifier {
    if (background == null) return this
    return when (background) {
        is MosaicBackground.Solid -> background(background.color.toComposeColor(), shape)
        is MosaicBackground.LinearGradient -> {
            val colorStops = background.stops.map { it.position to it.color.toComposeColor() }.toTypedArray()
            drawWithCache {
                val direction = MosaicGradientGeometry.direction(background.angleDegrees)
                val half = (size.width + size.height) / 2f
                val center = Offset(size.width / 2f, size.height / 2f)
                val brush = Brush.linearGradient(
                    colorStops = colorStops,
                    start = center - direction * half,
                    end = center + direction * half,
                )
                val outline = shape.createOutline(size, layoutDirection, this)
                onDrawBehind {
                    when (outline) {
                        is Outline.Rectangle -> drawRect(brush)
                        is Outline.Rounded -> drawRoundRect(
                            brush,
                            cornerRadius = outline.roundRect.topLeftCornerRadius,
                        )
                        is Outline.Generic -> drawPath(outline.path, brush)
                    }
                }
            }
        }
        is MosaicBackground.RadialGradient -> {
            val colorStops = background.stops.map { it.position to it.color.toComposeColor() }.toTypedArray()
            drawWithCache {
                val brush = Brush.radialGradient(
                    colorStops = colorStops,
                    center = Offset(size.width * background.centerX, size.height * background.centerY),
                    radius = max(size.width, size.height) * background.radius,
                )
                val outline = shape.createOutline(size, layoutDirection, this)
                onDrawBehind {
                    when (outline) {
                        is Outline.Rectangle -> drawRect(brush)
                        is Outline.Rounded -> drawRoundRect(
                            brush,
                            cornerRadius = outline.roundRect.topLeftCornerRadius,
                        )
                        is Outline.Generic -> drawPath(outline.path, brush)
                    }
                }
            }
        }
        is MosaicBackground.Image,
        is MosaicBackground.Video,
        -> this // The media layer owns its fallback so successful media remains visible.
    }
}

internal object MosaicGradientGeometry {
    /** Physical direction: 0° right, 90° down, clockwise, independent of layout direction. */
    fun direction(angleDegrees: Float): Offset {
        val normalized = ((angleDegrees % 360f) + 360f) % 360f
        val radians = Math.toRadians(normalized.toDouble())
        return Offset(cos(radians).toFloat(), sin(radians).toFloat())
    }
}

private fun Modifier.mosaicWidth(width: MosaicWidthSizing): Modifier = when (width) {
    MosaicWidthSizing.Content -> this
    MosaicWidthSizing.Fill -> fillMaxWidth()
    is MosaicWidthSizing.Fixed -> width(width.value.dp)
}

@Composable
private fun MosaicTypography.toComposeTextStyle(): androidx.compose.ui.text.TextStyle {
    val base = when (style) {
        MosaicTypographyStyle.DISPLAY -> MaterialTheme.typography.displayMedium
        MosaicTypographyStyle.TITLE -> MaterialTheme.typography.headlineMedium
        MosaicTypographyStyle.HEADING -> MaterialTheme.typography.titleLarge
        MosaicTypographyStyle.BODY -> MaterialTheme.typography.bodyLarge
        MosaicTypographyStyle.LABEL -> MaterialTheme.typography.labelLarge
        MosaicTypographyStyle.CAPTION -> MaterialTheme.typography.bodySmall
    }
    return base.copy(
        fontSize = fontSize.sp,
        lineHeight = (fontSize * lineHeightMultiplier).sp,
        fontWeight = when (weight) {
            MosaicFontWeight.REGULAR -> FontWeight.Normal
            MosaicFontWeight.MEDIUM -> FontWeight.Medium
            MosaicFontWeight.SEMIBOLD -> FontWeight.SemiBold
            MosaicFontWeight.BOLD -> FontWeight.Bold
        },
        color = color.toComposeColor(),
        textAlign = alignment.toCompose(),
    )
}

@Composable
private fun MosaicColor.toComposeColor(): Color {
    semantic?.let { semantic ->
        return when (semantic) {
            MosaicSemanticColor.TEXT_PRIMARY -> MaterialTheme.colorScheme.onSurface
            MosaicSemanticColor.TEXT_SECONDARY -> MaterialTheme.colorScheme.onSurfaceVariant
            MosaicSemanticColor.SURFACE_DEFAULT -> MaterialTheme.colorScheme.surface
            MosaicSemanticColor.SURFACE_ELEVATED -> MaterialTheme.colorScheme.surfaceContainer
            MosaicSemanticColor.ACTION_PRIMARY -> MaterialTheme.colorScheme.primary
            MosaicSemanticColor.ACTION_ON_PRIMARY -> MaterialTheme.colorScheme.onPrimary
            MosaicSemanticColor.BORDER_DEFAULT -> MaterialTheme.colorScheme.outline
            MosaicSemanticColor.TRANSPARENT -> Color.Transparent
        }
    }
    val rgba = rawValue.removePrefix("#").toLongOrNull(16) ?: return Color.Transparent
    return Color(
        red = ((rgba shr 24) and 0xFF).toInt(),
        green = ((rgba shr 16) and 0xFF).toInt(),
        blue = ((rgba shr 8) and 0xFF).toInt(),
        alpha = (rgba and 0xFF).toInt(),
    )
}

private fun MosaicEdgeInsets.toPaddingValues(): androidx.compose.foundation.layout.PaddingValues =
    androidx.compose.foundation.layout.PaddingValues(
        start = start.dp,
        top = top.dp,
        end = end.dp,
        bottom = bottom.dp,
    )

private fun MosaicStack.verticalArrangement(): Arrangement.Vertical = when (mainAxisDistribution) {
    MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
    MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
    MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
    MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
}

private fun MosaicStack.horizontalArrangement(): Arrangement.Horizontal = when (mainAxisDistribution) {
    MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
    MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
    MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
    MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
}

private fun MosaicStack.composeHorizontalAlignment(): Alignment.Horizontal = when (crossAxisAlignment) {
    MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
    MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
    MosaicHorizontalAlignment.END -> Alignment.End
}

private fun MosaicStack.composeVerticalAlignment(): Alignment.Vertical = when (crossAxisAlignment) {
    MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
    MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
    MosaicHorizontalAlignment.END -> Alignment.Bottom
}

private fun MosaicButtonComponent.verticalArrangement(): Arrangement.Vertical =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicButtonComponent.horizontalArrangement(): Arrangement.Horizontal =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicButtonComponent.composeHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

private fun MosaicButtonComponent.composeVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

private fun MosaicProductSelectorComponent.selectorVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

private fun MosaicProductSelectorComponent.selectorHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

private fun MosaicProductCardComponent.verticalArrangement(): Arrangement.Vertical =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicProductCardComponent.horizontalArrangement(): Arrangement.Horizontal =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicProductCardComponent.composeHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

private fun MosaicProductCardComponent.composeVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

private fun MosaicProductBadgeComponent.verticalArrangement(): Arrangement.Vertical =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicProductBadgeComponent.horizontalArrangement(): Arrangement.Horizontal =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicProductBadgeComponent.composeHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

private fun MosaicProductBadgeComponent.composeVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

private fun MosaicProductBadgeAnchor.toComposeAlignment(): Alignment = when (this) {
    MosaicProductBadgeAnchor.TOP_START -> Alignment.TopStart
    MosaicProductBadgeAnchor.TOP_END -> Alignment.TopEnd
    MosaicProductBadgeAnchor.BOTTOM_START -> Alignment.BottomStart
    MosaicProductBadgeAnchor.BOTTOM_END -> Alignment.BottomEnd
}

private fun MosaicProductCardComponent.accessibilityDescription(
    product: MosaicAvailableProduct,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
): String {
    fun resolve(value: MosaicLocalizedText): String = MosaicProductTemplate.resolve(
        localization.resolve(value),
        product.storeProduct.title,
        localization.resolve(product.reference.label),
        product.storeProduct.localizedPrice,
    )
    accessibilityLabel?.let { return resolve(it) }

    fun collect(node: MosaicNode, values: MutableList<String>) {
        when (node) {
            is MosaicStack -> node.children.forEach { collect(it, values) }
            is MosaicTextComponent -> values += resolve(node.value)
            is MosaicImageComponent -> {
                val accessibility = node.accessibility
                if (accessibility is MosaicImageAccessibility.Informative) {
                    values += localization.resolve(accessibility.label)
                }
            }
            is MosaicIconComponent -> {
                val accessibility = node.accessibility
                if (accessibility is MosaicImageAccessibility.Informative) {
                    values += localization.resolve(accessibility.label)
                }
            }
            is MosaicFeatureListComponent -> node.items.forEach { values += localization.resolve(it.text) }
            is MosaicCountdownComponent -> values += MosaicCountdownText.resolve(
                node,
                state.currentTimeMillis(),
                localization.resolve(node.completedText),
            )
            is MosaicProductBadgeComponent -> node.children.forEach { collect(it, values) }
            else -> Unit
        }
    }
    return buildList { children.forEach { collect(it, this) } }
        .filter(String::isNotBlank)
        .joinToString(", ")
        .ifBlank {
            listOf(
                product.storeProduct.title.takeIf(String::isNotBlank)
                    ?: localization.resolve(product.reference.label),
                product.storeProduct.localizedPrice,
            ).joinToString(", ")
        }
}

private fun MosaicButtonComponent.busyStateDescription(
    localization: MosaicLocalizationResolver,
): String {
    fun firstText(nodes: List<MosaicNode>): String? {
        nodes.forEach { node ->
            when (node) {
                is MosaicTextComponent -> localization.resolve(node.value)
                    .takeIf(String::isNotBlank)
                    ?.let { return it }
                is MosaicStack -> firstText(node.children)?.let { return it }
                else -> Unit
            }
        }
        return null
    }

    return firstText(inProgressChildren ?: children) ?: "In progress"
}

private fun MosaicProductCardStyle.cardHorizontalAlignment(): Alignment.Horizontal =
    when (contentAlignment) {
        MosaicProductCardContentAlignment.START,
        MosaicProductCardContentAlignment.SPACE_BETWEEN -> Alignment.Start
        MosaicProductCardContentAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicProductCardContentAlignment.END -> Alignment.End
    }

@Composable
private fun MosaicScrollIndicator(
    value: Int,
    maximum: Int,
    modifier: Modifier = Modifier,
) {
    val direction = LocalLayoutDirection.current
    Canvas(modifier) {
        val visibleFraction = (size.height / (size.height + maximum)).coerceIn(0.08f, 1f)
        val thumbHeight = size.height * visibleFraction
        val travel = size.height - thumbHeight
        val top = if (maximum == 0) 0f else travel * (value.toFloat() / maximum)
        val width = 3.dp.toPx()
        val x = if (direction == LayoutDirection.Ltr) size.width - width else 0f
        drawRoundRect(
            color = Color.Black.copy(alpha = 0.28f),
            topLeft = androidx.compose.ui.geometry.Offset(x, top),
            size = androidx.compose.ui.geometry.Size(width, thumbHeight),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(width / 2, width / 2),
        )
    }
}

private fun MosaicTextAlignment.toCompose(): TextAlign = when (this) {
    MosaicTextAlignment.START -> TextAlign.Start
    MosaicTextAlignment.CENTER -> TextAlign.Center
    MosaicTextAlignment.END -> TextAlign.End
}

private fun MosaicControlAccessibility.resolvedDescriptions(
    localization: MosaicLocalizationResolver,
): String = buildList {
    add(localization.resolve(label))
    hint?.let { add(localization.resolve(it)) }
}.joinToString(". ")
