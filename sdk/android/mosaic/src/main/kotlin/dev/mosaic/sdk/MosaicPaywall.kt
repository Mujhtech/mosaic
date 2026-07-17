package dev.mosaic.sdk

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

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
    onInteraction: (MosaicInteractionOutcome) -> Unit = {},
) {
    val state = remember(document, purchaseProvider, diagnostics) {
        MosaicPaywallState(document, purchaseProvider, diagnostics)
    }
    val dispatch: (MosaicPaywallEvent) -> Unit = { event ->
        onInteraction(event.interaction)
        event.presentationResult?.let(onResult)
    }

    LaunchedEffect(state) {
        state.loadProducts().forEach(dispatch)
    }

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
    val layoutDirection = when (localization.direction) {
        MosaicLayoutDirection.LTR -> LayoutDirection.Ltr
        MosaicLayoutDirection.RTL -> LayoutDirection.Rtl
    }
    val scrollState = rememberScrollState()
    val hostDensity = LocalDensity.current
    val previewDensity = remember(hostDensity.density, hostDensity.fontScale, previewTextScale) {
        if (previewTextScale == null) {
            hostDensity
        } else {
            Density(hostDensity.density, previewTextScale.coerceIn(0.5f, 3f))
        }
    }

    CompositionLocalProvider(
        LocalLayoutDirection provides layoutDirection,
        LocalDensity provides previewDensity,
    ) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .semantics {
                    mosaicResolvedLayoutDirection = if (layoutDirection == LayoutDirection.Rtl) {
                        "rtl"
                    } else {
                        "ltr"
                    }
                }
                .testTag("mosaic-paywall"),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState),
            ) {
                RenderVerticalStack(
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
                    modifier = Modifier
                    .fillMaxSize()
                        .clearAndSetSemantics { },
                )
            }
        }
    }
}

@Composable
private fun RenderVerticalStack(
    stack: MosaicVerticalStack,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val horizontalAlignment = when (stack.horizontalAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }
    Column(
        modifier = modifier
            .padding(
                start = stack.padding.start.dp,
                top = stack.padding.top.dp,
                end = stack.padding.end.dp,
                bottom = stack.padding.bottom.dp,
            )
            .testTag("mosaic-node-${stack.id}"),
        verticalArrangement = Arrangement.spacedBy(stack.spacing.dp),
        horizontalAlignment = horizontalAlignment,
    ) {
        stack.children.forEach { child ->
            val childModifier = if (stack.horizontalAlignment == MosaicHorizontalAlignment.STRETCH) {
                Modifier.fillMaxWidth()
            } else {
                Modifier
            }
            RenderNode(
                node = child,
                state = state,
                localization = localization,
                imageResolver = imageResolver,
                diagnostics = diagnostics,
                onEvent = onEvent,
                modifier = childModifier,
            )
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
    when (node) {
        is MosaicVerticalStack -> RenderVerticalStack(
            node,
            state,
            localization,
            imageResolver,
            diagnostics,
            onEvent,
            modifier,
        )
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
        is MosaicRestoreButtonComponent -> RenderRestoreButton(
            node,
            state,
            localization,
            onEvent,
            modifier,
        )
        is MosaicCloseButtonComponent -> RenderCloseButton(
            node,
            state,
            localization,
            onEvent,
            modifier,
        )
        is MosaicLegalTextComponent -> RenderLegalText(node, localization, modifier)
    }
}

@Composable
private fun RenderText(
    component: MosaicTextComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    val semanticsModifier = when (val accessibility = component.accessibility) {
        MosaicTextAccessibility.Text -> Modifier
        is MosaicTextAccessibility.Heading -> Modifier.semantics {
            heading()
            mosaicHeadingLevel = accessibility.level
        }
    }
    Text(
        text = localization.resolve(component.value),
        modifier = modifier
            .then(semanticsModifier)
            .testTag("mosaic-node-${component.id}"),
        style = when (component.style) {
            MosaicTextStyle.TITLE -> MaterialTheme.typography.headlineMedium
            MosaicTextStyle.BODY -> MaterialTheme.typography.bodyLarge
            MosaicTextStyle.CAPTION -> MaterialTheme.typography.bodySmall
        },
        textAlign = component.alignment.toCompose(),
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
    val frameModifier = modifier
        .fillMaxWidth()
        .aspectRatio(component.aspectRatio.toFloat())
        .clip(MaterialTheme.shapes.medium)
        .then(semanticModifier)
        .testTag("mosaic-node-${component.id}")

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
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        verticalArrangement = Arrangement.spacedBy(component.itemSpacing.dp),
    ) {
        component.items.forEach { item ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("mosaic-feature-${item.id}"),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = "✓",
                    modifier = Modifier.clearAndSetSemantics { },
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyLarge,
                )
                Spacer(Modifier.size(12.dp))
                Text(
                    text = localization.resolve(item.text),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
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
    Column(
        modifier = modifier
            .selectableGroup()
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
        verticalArrangement = Arrangement.spacedBy(component.itemSpacing.dp),
    ) {
        when {
            selectorState.isLoading -> CircularProgressIndicator(
                modifier = Modifier
                    .size(32.dp)
                    .align(Alignment.CenterHorizontally)
                    .testTag("mosaic-products-loading"),
            )
            selectorState.options.isEmpty() -> Text(
                text = localization.resolve(component.unavailableFallback.message),
                modifier = Modifier.testTag("mosaic-products-unavailable"),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
            else -> selectorState.options.forEach { option ->
                val selected = selectorState.selectedProductReferenceId == option.reference.id
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = selected,
                            role = Role.RadioButton,
                            onClick = {
                                state.selectProduct(component.id, option.reference.id)?.let(onEvent)
                            },
                        )
                        .testTag("mosaic-product-${option.reference.id}"),
                    shape = MaterialTheme.shapes.medium,
                    color = if (selected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                    border = BorderStroke(
                        1.dp,
                        if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    ),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = localization.resolve(option.reference.label),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            option.reference.badge?.let { badge ->
                                Text(
                                    text = localization.resolve(badge),
                                    color = MaterialTheme.colorScheme.primary,
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                        Text(
                            text = buildString {
                                append(option.storeProduct.localizedPrice)
                                option.storeProduct.subscriptionPeriod?.let { append(" / ").append(it) }
                            },
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                }
            }
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
    val visibleLabel = localization.resolve(if (isBusy) component.inProgressLabel else component.label)
    Button(
        onClick = {
            scope.launch { onEvent(state.purchase(component.action.productSelectorId)) }
        },
        enabled = selector.selectedProductReferenceId != null && !isBusy,
        modifier = modifier
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
                if (isBusy) stateDescription = localization.resolve(component.inProgressLabel)
            }
            .testTag("mosaic-node-${component.id}"),
    ) {
        if (isBusy) {
            CircularProgressIndicator(
                modifier = Modifier
                    .size(18.dp)
                    .clearAndSetSemantics { },
                color = MaterialTheme.colorScheme.onPrimary,
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.size(8.dp))
        }
        Text(visibleLabel)
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
    val visibleLabel = localization.resolve(if (isBusy) component.inProgressLabel else component.label)
    TextButton(
        onClick = { scope.launch { onEvent(state.restore()) } },
        enabled = !isBusy,
        modifier = modifier
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
                if (isBusy) stateDescription = localization.resolve(component.inProgressLabel)
            }
            .testTag("mosaic-node-${component.id}"),
    ) {
        if (isBusy) {
            CircularProgressIndicator(
                modifier = Modifier
                    .size(18.dp)
                    .clearAndSetSemantics { },
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.size(8.dp))
        }
        Text(visibleLabel)
    }
}

@Composable
private fun RenderCloseButton(
    component: MosaicCloseButtonComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    TextButton(
        onClick = { onEvent(state.close()) },
        modifier = modifier
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-node-${component.id}"),
    ) {
        Text(localization.resolve(component.label))
    }
}

@Composable
private fun RenderLegalText(
    component: MosaicLegalTextComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    Text(
        text = localization.resolve(component.value),
        modifier = modifier.testTag("mosaic-node-${component.id}"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
        textAlign = component.alignment.toCompose(),
    )
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
