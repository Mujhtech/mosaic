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

@Composable
internal fun RenderText(
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
internal fun MosaicStyledText(
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
internal fun RenderImage(
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
internal fun RenderFeatureList(
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
internal fun RenderProductSelector(
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
internal fun RenderProductCard(
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
internal fun RenderProductCardChild(
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
internal fun RenderProductBadge(
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
internal fun RenderLegacyProductCard(
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
internal fun RenderPurchaseButton(
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
        onClick = { scope.launch { onEvent(state.purchase(component.action.productSelectorId, component.id)) } },
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
internal fun RenderRestoreButton(
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
        onClick = { scope.launch { onEvent(state.restore(component.id)) } },
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
internal fun RenderCloseButton(
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
        onClick = { onEvent(state.close(component.id)) },
    )
}

@Composable
internal fun StyledTextButton(
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
internal fun RenderLegalText(
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
internal fun RenderSwitch(
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
