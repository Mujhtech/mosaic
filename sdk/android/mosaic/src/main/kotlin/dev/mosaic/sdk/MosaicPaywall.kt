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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
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

internal val LocalMosaicProduct = staticCompositionLocalOf<MosaicAvailableProduct?> { null }
internal val LocalMosaicDocument = staticCompositionLocalOf<MosaicPaywallDocument?> { null }
internal val LocalMosaicImageResolver = staticCompositionLocalOf { MosaicBundledImageResolver.None }
internal val LocalMosaicVideoResolver = staticCompositionLocalOf { MosaicBundledVideoResolver.None }
internal val LocalMosaicDiagnostics = staticCompositionLocalOf { MosaicDiagnosticSink.None }

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
    analyticsRuntime: MosaicAnalyticsRuntime? = null,
    analyticsContext: MosaicAnalyticsPresentationContext? = null,
    motionDriver: MosaicMotionDriver = MosaicMotionDriver.Default,
    reducedMotion: Boolean? = null,
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
            analyticsRuntime = analyticsRuntime,
            analyticsContext = analyticsContext,
            motionDriver = motionDriver,
            reducedMotion = reducedMotion,
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
    analyticsRuntime: MosaicAnalyticsRuntime? = null,
    analyticsContext: MosaicAnalyticsPresentationContext? = null,
    motionDriver: MosaicMotionDriver = MosaicMotionDriver.Default,
    reducedMotion: Boolean? = null,
) {
    val state = remember(
        document,
        purchaseProvider,
        diagnostics,
        analyticsRuntime,
        analyticsContext,
        motionDriver,
    ) {
        MosaicPaywallState(
            document,
            purchaseProvider,
            diagnostics,
            clock,
            analyticsRuntime,
            analyticsContext,
            motionDriver,
        )
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
        reducedMotion = reducedMotion,
        modifier = modifier.onGloballyPositioned { state.presented() },
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
    /**
     * Null derives the signal from `Settings.Global.ANIMATOR_DURATION_SCALE`. A supplied value is
     * what a test asserts against; the setting is not something a test should have to mutate.
     */
    reducedMotion: Boolean? = null,
) {
    val document = state.document
    val resolvedReducedMotion = reducedMotion ?: rememberPlatformReducedMotion()
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
        LocalMosaicReducedMotion provides resolvedReducedMotion,
    ) {
        val current = state.currentScreenOrNull
        if (current == null) {
            LaunchedEffect(state, state.currentScreenId) {
                state.reportRenderingFailure("rendering.screen_unavailable")?.let(onEvent)
            }
            Box(modifier = modifier.testTag("mosaic-rendering-failed"))
            return@CompositionLocalProvider
        }
        // One call site for the full-screen content, whether or not a sheet is over it. Two call
        // sites in two branches of an `if` are two *groups*: switching branches disposes one and
        // composes the other, so presenting a sheet would tear the screen behind it down and build
        // it again — resetting its scroll offset, restarting its `appear` entrances, and replaying a
        // bounded pulse whose cycle bound is per screen *entry*. The screen behind a sheet never
        // left, so none of that is a re-entry.
        val sheet = current.takeIf { it.presentation == MosaicScreenPresentation.SHEET }
        MosaicScreenContent(
            screen = if (sheet == null) current else state.backgroundScreen,
            state = state,
            localization = localization,
            imageResolver = imageResolver,
            diagnostics = diagnostics,
            onEvent = onEvent,
            layoutDirection = layoutDirection,
            modifier = modifier,
        )
        if (sheet != null) {
            ModalBottomSheet(
                onDismissRequest = { state.navigateBack() },
                dragHandle = null,
            ) {
                MosaicScreenContent(
                    screen = sheet,
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
        }
    }
}

@Composable
internal fun MosaicScreenContent(
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
        // The visibility gate is derived so only a scrollability change, not each scrolled pixel,
        // invalidates this composable; the indicator itself reads scroll offset in the draw phase.
        val showsIndicator by remember(scrollState, layout.showsIndicators) {
            derivedStateOf { layout.showsIndicators && scrollState.maxValue > 0 }
        }
        if (showsIndicator) {
            MosaicScrollIndicator(
                value = { scrollState.value },
                maximum = { scrollState.maxValue },
                modifier = Modifier.fillMaxSize().clearAndSetSemantics { },
            )
        }
    }
}

@Composable
internal fun MosaicBackgroundMedia(
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
internal fun MosaicDecorativeImageBackground(
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
internal fun MosaicDecorativeVideoBackground(
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
    /*
     * Protocol 0.4: under reduced motion a video background does not play.
     *
     * `0.3` specified video backgrounds as always muted, autoplaying, looping, and control-free, and
     * no SDK read the platform signal — which means a Mosaic paywall could invalidate a customer's
     * App Store Reduced Motion declaration, since Apple's criteria cover "any other ongoing motion".
     * This is handled explicitly rather than left to the animator scale: Compose honours
     * `ANIMATOR_DURATION_SCALE` for its own animation APIs, and that does not reach ExoPlayer
     * playback at all.
     *
     * The declared poster is rendered if available and otherwise the declared fallback colour —
     * deliberately the same resolution order the existing missing-media policy already uses, so this
     * reuses a path three renderers have implemented rather than introducing a fourth outcome. No
     * frame of the video is shown, playback is not started and paused, and no control is offered.
     */
    val reducedMotion = LocalMosaicReducedMotion.current
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
        if (uri != null && !failed && !reducedMotion) {
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
                modifier = Modifier.matchParentSize().testTag("mosaic-video-$ownerId"),
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

internal fun MosaicImageContentMode.toContentScale(): ContentScale = when (this) {
    MosaicImageContentMode.FIT -> ContentScale.Fit
    MosaicImageContentMode.FILL -> ContentScale.Crop
}

@Composable
internal fun RenderStack(
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
internal fun RenderNode(
    node: MosaicNode,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    if (!state.isVisible(node.visibilityOrAlways())) return
    // Motion wraps the whole node, including any media background it owns, and is applied here
    // rather than inside each component renderer so that one node cannot be animated twice and a
    // newly added component cannot silently be the one that is never animated at all.
    val animated = modifier.mosaicNodeMotion(node.id, node.motion, state.motionDriver)
    val mediaBackground = node.appearanceOrNull()?.background
        ?.takeIf { it is MosaicBackground.Image || it is MosaicBackground.Video }
    if (mediaBackground != null) {
        Box(animated) {
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
    RenderNodeCore(node, state, localization, imageResolver, diagnostics, onEvent, animated)
}

@Composable
internal fun RenderNodeCore(
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
        is MosaicTabsComponent -> RenderTabs(
            node,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
        is MosaicTimelineComponent -> RenderTimeline(node, localization, modifier)
        is MosaicAwardComponent -> RenderAward(
            node,
            state.document,
            localization,
            imageResolver,
            diagnostics,
            modifier,
        )
        is MosaicSocialProofComponent -> RenderSocialProof(
            node,
            state.document,
            localization,
            imageResolver,
            diagnostics,
            modifier,
        )
        is MosaicProductCardComponent,
        is MosaicProductBadgeComponent,
        -> {
            // Strict decoding only exposes these through Product Selector-owned rendering, so
            // reaching one here means the tree was assembled outside that path. Skipping it is the
            // safe render, but skipping it silently is not: the author sees an absent card with no
            // explanation. Diagnose once per node id, like LAYOUT_UNBOUNDED_FILL.
            LaunchedEffect(node.id) {
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.RENDERING_COMPONENT_SKIPPED,
                        "A ${node.type} outside a Product Selector was skipped.",
                    ),
                )
            }
        }
    }
}

internal fun MosaicNode.appearanceOrNull(): MosaicBoxAppearance? = when (this) {
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
    is MosaicTabsComponent -> appearance
    is MosaicTimelineComponent -> appearance
    is MosaicAwardComponent -> appearance
    is MosaicSocialProofComponent -> appearance
    // Product Cards and Badges declare no `appearance` in `schema/v0.3/paywall.schema.json`; they
    // carry `styles`, resolved per selection state by their Product Selector-owned renderer. Null
    // here is the contract, not a dropped value.
    is MosaicProductCardComponent,
    is MosaicProductBadgeComponent,
    -> null
}

@Composable
internal fun RenderButton(
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
    val announcement = component.accessibilityAnnouncement(localization, isBusy)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(
        (appearance?.cornerRadius ?: MOSAIC_DEFAULT_CORNER_RADIUS).dp,
    )
    Button(
        onClick = {
            when (val action = component.action) {
                is MosaicPurchaseAction -> scope.launch { onEvent(state.purchase(action.productSelectorId, component.id)) }
                MosaicRestoreAction -> scope.launch { onEvent(state.restore(component.id)) }
                MosaicCloseAction -> onEvent(state.close(component.id))
                is MosaicNavigateToAction -> { state.recordAction("navigate_to", component.id); state.navigateTo(action.screenId) }
                MosaicNavigateBackAction -> { state.recordAction("navigate_back", component.id); state.navigateBack() }
                is MosaicOpenExternalUrlAction -> {
                    state.recordAction("open_external_url", component.id)
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
            // A Button is one accessibility element. Its name is the authored label and does not
            // change between states; the busy state is the reserved `mosaic.a11y.in_progress`
            // string in `stateDescription`. Swapping the name would read as a different control.
            .semantics {
                contentDescription = announcement.containerDescription()
                announcement.value?.let { stateDescription = it }
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
        // Neither `children` nor `inProgressChildren` are announced in either state: the label
        // already says what the control does, and the visible caption would be read twice.
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
internal fun RenderIcon(
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
