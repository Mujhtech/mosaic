package dev.mosaic.sdk

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max

val MosaicHeadingLevelKey = SemanticsPropertyKey<Int>("MosaicHeadingLevel")
var SemanticsPropertyReceiver.mosaicHeadingLevel by MosaicHeadingLevelKey
val MosaicResolvedLayoutDirectionKey = SemanticsPropertyKey<String>("MosaicResolvedLayoutDirection")
var SemanticsPropertyReceiver.mosaicResolvedLayoutDirection by MosaicResolvedLayoutDirectionKey

/** Resolve and decode logical bundled keys outside composition; return null on any failure. */
fun interface MosaicBundledImageResolver {
    fun resolve(key: String): ImageBitmap?

    companion object {
        val None = MosaicBundledImageResolver { null }
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
    LaunchedEffect(state) { state.loadProducts().forEach(dispatch) }
    MosaicPaywallContent(
        state = state,
        requestedLocale = requestedLocale,
        previewTextScale = previewTextScale,
        imageResolver = imageResolver,
        diagnostics = diagnostics,
        onEvent = dispatch,
        modifier = modifier,
    )
}

@Composable
fun MosaicPaywallContent(
    state: MosaicPaywallState,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier = Modifier,
    requestedLocale: String? = null,
    previewTextScale: Float? = null,
    imageResolver: MosaicBundledImageResolver = MosaicBundledImageResolver.None,
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
    val scrollState = rememberScrollState()
    val hostDensity = LocalDensity.current
    val previewDensity = remember(hostDensity.density, hostDensity.fontScale, previewTextScale) {
        previewTextScale?.let { Density(hostDensity.density, it.coerceIn(0.5f, 3f)) } ?: hostDensity
    }
    val background = document.layout.background?.toComposeColor()

    CompositionLocalProvider(
        LocalLayoutDirection provides layoutDirection,
        LocalDensity provides previewDensity,
    ) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .then(if (background != null) Modifier.background(background) else Modifier)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .semantics {
                    mosaicResolvedLayoutDirection = if (layoutDirection == LayoutDirection.Rtl) "rtl" else "ltr"
                }
                .testTag("mosaic-paywall"),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState),
            ) {
                RenderStack(
                    stack = document.layout.content,
                    state = state,
                    localization = localization,
                    imageResolver = imageResolver,
                    diagnostics = diagnostics,
                    onEvent = onEvent,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (document.layout.showsIndicators && scrollState.maxValue > 0) {
                MosaicScrollIndicator(
                    value = scrollState.value,
                    maximum = scrollState.maxValue,
                    modifier = Modifier.fillMaxSize().clearAndSetSemantics { },
                )
            }
        }
    }
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
    }
}

@Composable
private fun RenderText(
    component: MosaicTextComponent,
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
    val asset = document.assets.first { it.id == component.assetId }
    val bitmap = remember(asset.sourceKey, imageResolver) {
        runCatching { imageResolver.resolve(asset.sourceKey) }.getOrNull()
    }
    LaunchedEffect(bitmap, asset.id) {
        if (bitmap == null) {
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
        .mosaicWidth(component.width)
        .then(
            component.aspectRatio?.let { Modifier.aspectRatio(it.toFloat()) }
                ?: Modifier.height(checkNotNull(component.height).dp),
        )
        .mosaicPresentation(component.appearance, null, component.outerInsets)
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
            modifier = containerModifier.height(IntrinsicSize.Max),
            horizontalArrangement = Arrangement.spacedBy(component.gap.dp),
        ) {
            selectorState.options.forEach { option ->
                RenderProductCard(
                    component,
                    option,
                    selectorState.selectedProductReferenceId == option.reference.id,
                    state,
                    localization,
                    onEvent,
                    Modifier.weight(1f).fillMaxHeight(),
                )
            }
        }
        else -> Column(
            modifier = containerModifier,
            verticalArrangement = Arrangement.spacedBy(component.gap.dp),
        ) {
            selectorState.options.forEach { option ->
                RenderProductCard(
                    component,
                    option,
                    selectorState.selectedProductReferenceId == option.reference.id,
                    state,
                    localization,
                    onEvent,
                    Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun RenderProductCard(
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
                onClick = {
                    state.selectProduct(component.id, option.reference.id)?.let(onEvent)
                },
            )
            .semantics {
                selected = isSelected
                contentDescription = buildList {
                    add(localization.resolve(option.reference.label))
                    option.reference.badge?.let { add(localization.resolve(it)) }
                    add(option.storeProduct.localizedPrice)
                    option.storeProduct.subscriptionPeriod?.let(::add)
                }.joinToString(", ")
            }
            .testTag("mosaic-product-${option.reference.id}"),
        shape = shape,
        color = style.background.toComposeColor(),
        border = BorderStroke(style.border.width.dp, style.border.color.toComposeColor()),
    ) {
        val contentModifier = Modifier.padding(
            start = style.padding.start.dp,
            top = style.padding.top.dp,
            end = style.padding.end.dp,
            bottom = style.padding.bottom.dp,
        )
        if (style.contentAlignment == MosaicProductCardContentAlignment.SPACE_BETWEEN) {
            Row(
                modifier = contentModifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(style.contentGap.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ProductCardLabel(option, style, localization, Modifier.weight(1f))
                ProductCardPrice(option, style)
            }
        } else {
            Column(
                modifier = contentModifier.fillMaxWidth(),
                horizontalAlignment = style.cardHorizontalAlignment(),
                verticalArrangement = Arrangement.spacedBy(style.contentGap.dp),
            ) {
                ProductCardLabel(option, style, localization)
                ProductCardPrice(option, style)
            }
        }
    }
}

@Composable
private fun ProductCardLabel(
    option: MosaicAvailableProduct,
    style: MosaicProductCardStyle,
    localization: MosaicLocalizationResolver,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = style.cardHorizontalAlignment()) {
        Text(
            text = localization.resolve(option.reference.label),
            color = style.productLabelColor.toComposeColor(),
            style = MaterialTheme.typography.titleMedium,
        )
        option.reference.badge?.let { badge ->
            val badgeStyle = style.badge
            Surface(
                modifier = Modifier.padding(top = 4.dp),
                color = badgeStyle.background.toComposeColor(),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(badgeStyle.cornerRadius.dp),
                border = BorderStroke(
                    badgeStyle.border.width.dp,
                    badgeStyle.border.color.toComposeColor(),
                ),
            ) {
                Text(
                    text = localization.resolve(badge),
                    modifier = Modifier.padding(
                        start = badgeStyle.padding.start.dp,
                        top = badgeStyle.padding.top.dp,
                        end = badgeStyle.padding.end.dp,
                        bottom = badgeStyle.padding.bottom.dp,
                    ),
                    color = badgeStyle.textColor.toComposeColor(),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        option.storeProduct.subscriptionPeriod?.let { period ->
            Text(
                text = period,
                color = style.runtimePriceColor.toComposeColor().copy(alpha = 0.82f),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun ProductCardPrice(option: MosaicAvailableProduct, style: MosaicProductCardStyle) {
    Text(
        text = option.storeProduct.localizedPrice,
        color = style.runtimePriceColor.toComposeColor(),
        style = MaterialTheme.typography.titleMedium,
    )
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
            containerColor = appearance?.background?.toComposeColor()
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
            containerColor = appearance?.background?.toComposeColor() ?: Color.Transparent,
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
    Row(
        modifier = modifier
            .mosaicPresentation(component.appearance, null, component.outerInsets)
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
            checked = state.switchValue(component.id),
            onCheckedChange = { state.setSwitchValue(component.id, it) },
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
    if (appearance?.clipContent == true) result = result.clip(shape)
    appearance?.background?.let { result = result.background(it.toComposeColor(), shape) }
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
    sizing?.width?.let { result = result.mosaicWidth(it) }
    sizing?.height?.let { height ->
        if (height is MosaicHeightSizing.Fixed) result = result.height(height.value.dp)
    }
    return result
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
