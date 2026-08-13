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
import androidx.compose.ui.graphics.drawscope.clipRect
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
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.CollectionItemInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.collectionItemInfo
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
    // A dangling assetId is a non-conforming document, not a crash: the declared placeholder (or an
    // empty frame when the asset itself is missing) is shown and the failure is diagnosed.
    val asset = document.assets.filterIsInstance<MosaicImageAsset>().firstOrNull { it.id == component.assetId }
    val bundledKey = (asset?.source as? MosaicAssetSource.Bundled)?.key
    val remoteUrl = (asset?.source as? MosaicAssetSource.Remote)?.url
    val bitmap = remember(bundledKey, imageResolver) {
        bundledKey?.let { runCatching { imageResolver.resolve(it) }.getOrNull() }
    }
    var remoteFailed by remember(remoteUrl) { mutableStateOf(false) }
    val unavailable = asset == null ||
        bundledKey != null && bitmap == null ||
        remoteUrl == null && bundledKey == null ||
        remoteFailed
    LaunchedEffect(unavailable, component.id) {
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
    // `appearance.clipContent` is an optional boolean in `schema/v0.3/paywall.schema.json` with no
    // schema default, so an absent value means "do not clip" — the same reading as SwiftUI
    // (`clipContent == true`) and Flutter (`clipContent ?? false`). Images additionally clip when a
    // corner radius is authored, mirroring the Flutter renderer's image-only `forceClip`, so a
    // rounded image frame cannot leak square pixels on one platform only.
    val clipsContent = component.appearance?.clipContent == true ||
        (component.appearance?.cornerRadius ?: 0.0) > 0.0
    if (clipsContent) frameModifier = frameModifier.clip(
        androidx.compose.foundation.shape.RoundedCornerShape(
            (component.appearance?.cornerRadius ?: MOSAIC_DEFAULT_CORNER_RADIUS).dp,
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
            asset?.let {
                Text(
                    text = localization.resolve(it.placeholder),
                    modifier = Modifier.padding(24.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
            }
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
        component.items.forEachIndexed { index, item ->
            Row(
                modifier = Modifier.fillMaxWidth().testTag("mosaic-feature-${item.id}"),
                verticalAlignment = Alignment.Top,
            ) {
                // An absent item marker means the item carries the list's marker; it is never a
                // request for no glyph. Marker colour and size stay component-level, exactly as
                // they are on Timeline — an authored `markerSize` when there is one, and the list's
                // own font size when there is not.
                MosaicMarkerGlyph(
                    marker = item.marker ?: component.marker,
                    ownerId = item.id,
                    ordinal = index + 1,
                    size = component.resolvedMarkerSize,
                    color = component.markerColor,
                    typography = component.typography,
                    localization = localization,
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
    // A Product Selector the commerce state never saw (a state built from a different document)
    // must degrade to its own authored unavailable message, never throw inside composition.
    val selectorState = state.selectorStates[component.id]
    if (selectorState == null) {
        LaunchedEffect(component.id) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.RENDERING_SELECTOR_UNAVAILABLE,
                    "A Product Selector has no commerce state; its unavailable message is shown.",
                ),
            )
        }
        Text(
            text = localization.resolve(component.unavailableFallback.message),
            modifier = modifier
                .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
                .testTag("mosaic-products-unavailable"),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }
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
                val cardWidth = option.card.sizing?.width
                val cardHeight = option.card.sizing?.height
                val cardModifier = Modifier
                    .then(
                        if (cardWidth is MosaicWidthSizing.Fill) {
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
    // `selection` is authored on the Product Selector -- the component that owns the runtime
    // selection state -- and interpolates the card's own authored Default and Selected box styles.
    val style = mosaicSelectionStyle(
        ownerId = card.id,
        styles = card.styles,
        isSelected = isSelected,
        motion = selector.motion?.selection,
        driver = state.motionDriver,
    )
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
                                selector.motion?.selection,
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
                                selector.motion?.selection,
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
                            selector.motion?.selection,
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
    selectionMotion: MosaicSelectionMotion? = null,
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
            selectionMotion,
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
    selectionMotion: MosaicSelectionMotion? = null,
) {
    // A badge follows its card's selection, so it follows the same authored curve.
    val style = mosaicSelectionStyle(
        ownerId = badge.id,
        styles = badge.styles,
        isSelected = selected,
        motion = selectionMotion,
        driver = state.motionDriver,
    )
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

// --- Protocol 0.3 components -------------------------------------------------------------------

/**
 * Tabs renders one tab control per entry and exactly one panel.
 *
 * Compose semantics: the container is the tab list, each control carries [Role.Tab] with its
 * selected state and is named by its authored label, and the visible panel carries the same label
 * as its pane title. There is no second authored string, so the control name and the panel name
 * cannot drift.
 */
@Composable
internal fun RenderTabs(
    component: MosaicTabsComponent,
    state: MosaicPaywallState,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    onEvent: (MosaicPaywallEvent) -> Unit,
    modifier: Modifier,
) {
    // The state carries a selection for every Tabs component in its own document. A state built
    // from a different document degrades to the authored initial tab and diagnoses, rather than
    // throwing inside composition.
    val selectedId = state.selectedTabId(component.id)
    LaunchedEffect(component.id, selectedId) {
        if (selectedId == null) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.RENDERING_FAILED,
                    "A Tabs component has no runtime selection; its authored initial tab is shown.",
                ),
            )
        }
    }
    val activeId = selectedId ?: component.initialTabId
    val active = component.tabs.firstOrNull { it.id == activeId } ?: component.tabs.first()

    Column(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            .testTag("mosaic-node-${component.id}"),
        verticalArrangement = Arrangement.spacedBy(component.gap.dp),
    ) {
        val controls: @Composable () -> Unit = {
            component.tabs.forEach { tab ->
                MosaicTabControl(
                    component = component,
                    tab = tab,
                    isSelected = tab.id == active.id,
                    localization = localization,
                    driver = state.motionDriver,
                    onSelect = { state.selectTab(component.id, tab.id) },
                )
            }
        }
        val barModifier = Modifier
            .selectableGroup()
            .semantics {
                contentDescription = component.accessibility.resolvedDescriptions(localization)
            }
            .testTag("mosaic-tabbar-${component.id}")
        if (component.tabBarDirection == MosaicTabBarDirection.HORIZONTAL) {
            Row(
                modifier = barModifier.fillMaxWidth(),
                horizontalArrangement = component.tabBarHorizontalArrangement(),
                verticalAlignment = Alignment.CenterVertically,
            ) { controls() }
        } else {
            Column(
                modifier = barModifier,
                verticalArrangement = component.tabBarVerticalArrangement(),
                horizontalAlignment = Alignment.Start,
            ) { controls() }
        }
        val panelLabel = localization.resolve(active.label)
        Box(
            Modifier
                .fillMaxWidth()
                .semantics { paneTitle = panelLabel }
                .testTag("mosaic-tabpanel-${active.id}"),
        ) {
            RenderStack(
                active.content,
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

@Composable
private fun MosaicTabControl(
    component: MosaicTabsComponent,
    tab: MosaicTabEntry,
    isSelected: Boolean,
    localization: MosaicLocalizationResolver,
    driver: MosaicMotionDriver,
    onSelect: () -> Unit,
) {
    // Tabs `selection` animates the tab control's style, not the panel swap: `0.3` visibility
    // semantics remove a hidden node from layout, the accessibility tree, and focus order, and
    // animating a removal would need a "present but not focusable" third state that does not exist.
    val style = mosaicSelectionStyle(
        ownerId = tab.id,
        styles = component.styles,
        isSelected = isSelected,
        motion = component.motion?.selection,
        driver = driver,
    )
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(style.cornerRadius.dp)
    val label = localization.resolve(tab.label)
    var controlModifier: Modifier = Modifier
    style.shadow?.let { shadow ->
        controlModifier = controlModifier.dropShadow(
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
        modifier = controlModifier
            .alpha(style.opacity.toFloat())
            .selectable(selected = isSelected, role = Role.Tab, onClick = onSelect)
            .semantics {
                selected = isSelected
                contentDescription = label
            }
            .testTag("mosaic-tab-${tab.id}"),
        shape = shape,
        color = (style.background as? MosaicBackground.Solid)?.color?.toComposeColor()
            ?: Color.Transparent,
        border = BorderStroke(style.border.width.dp, style.border.color.toComposeColor()),
    ) {
        Box(Modifier.mosaicBackground(style.background, shape).clearAndSetSemantics { }) {
            MosaicBackgroundMedia(style.background, Modifier.matchParentSize(), tab.id)
            MosaicStyledText(
                value = label,
                // `selectedLabelColor` is required, so the selected colour is always authored:
                // the Default colour is never reused as a stand-in for an unstated intent.
                typography = if (isSelected) {
                    component.labelTypography.copy(color = component.selectedLabelColor)
                } else {
                    component.labelTypography
                },
                modifier = Modifier.padding(style.padding.toPaddingValues()),
            )
        }
    }
}

/**
 * Timeline renders a labelled ordered list. Each entry announces its title then its description;
 * markers and connectors are decorative and carry no semantics.
 */
@Composable
internal fun RenderTimeline(
    component: MosaicTimelineComponent,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    // `markerSize` when any entry declares a marker, `connector.width` when none does. Both the
    // connector and the markers are centred in this gutter.
    val gutterWidth = component.markerSize ?: component.connector.width
    val announcement = component.accessibilityAnnouncement(localization)
    Column(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            // Unmerged: the container carries only the list label, and each entry's title and
            // description stay separate elements. Merging would concatenate them into one string
            // with whatever separator this renderer chose.
            .semantics {
                contentDescription = announcement.label
                collectionInfo = CollectionInfo(component.entries.size, 1)
            }
            .testTag("mosaic-node-${component.id}"),
    ) {
        component.entries.forEachIndexed { index, entry ->
            val isLast = index == component.entries.lastIndex
            val title = localization.resolve(entry.title)
            val description = entry.description?.let(localization::resolve)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(IntrinsicSize.Min)
                    .semantics {
                        collectionItemInfo = CollectionItemInfo(index, 1, 0, 1)
                    }
                    .testTag("mosaic-timeline-entry-${entry.id}"),
            ) {
                MosaicTimelineGutter(
                    component = component,
                    entry = entry,
                    ordinal = index + 1,
                    isFirst = index == 0,
                    isLast = isLast,
                    localization = localization,
                    modifier = Modifier
                        .width(gutterWidth.dp)
                        .fillMaxHeight()
                        .clearAndSetSemantics { },
                )
                Spacer(Modifier.width(12.dp))
                // The inter-entry gap is padding on the content, not on the row, so the gutter --
                // and therefore the connector -- spans it. That is what makes the run continuous
                // without treating a markerless entry as a special case.
                Column(
                    Modifier
                        .weight(1f)
                        .padding(bottom = if (isLast) 0.dp else component.gap.dp),
                ) {
                    MosaicStyledText(value = title, typography = component.titleTypography)
                    // An absent description draws no second line and reserves no space for one.
                    if (description != null && component.descriptionTypography != null) {
                        MosaicStyledText(
                            value = description,
                            typography = component.descriptionTypography,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MosaicTimelineGutter(
    component: MosaicTimelineComponent,
    entry: MosaicTimelineEntry,
    ordinal: Int,
    isFirst: Boolean,
    isLast: Boolean,
    localization: MosaicLocalizationResolver,
    modifier: Modifier,
) {
    val markerSize = component.markerSize ?: 0.0
    val markerColor = component.markerColor?.toComposeColor() ?: Color.Transparent
    val connectorColor = component.connector.color.toComposeColor()
    val connectorWidth = component.connector.width
    val dashed = component.connector.style == MosaicTimelineConnectorStyle.DASHED
    val hasMarker = entry.marker != null
    // The connector is one continuous run drawn first; markers are drawn over it, so an opaque
    // marker occludes the segment behind it and an absent one changes nothing.
    Box(modifier, contentAlignment = Alignment.TopCenter) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = connectorWidth.dp.toPx()
            val centre = markerSize.dp.toPx() / 2f
            // Head and tail are decided independently: a marker's centre when that terminal entry
            // declares one, the entry's content edge when it does not.
            val start = if (isFirst && hasMarker) centre else 0f
            val end = if (isLast && hasMarker) centre else size.height
            if (end > start) {
                drawLine(
                    color = connectorColor,
                    start = Offset(size.width / 2f, start),
                    end = Offset(size.width / 2f, end),
                    strokeWidth = stroke,
                    pathEffect = if (dashed) {
                        androidx.compose.ui.graphics.PathEffect.dashPathEffect(
                            floatArrayOf(stroke * 3f, stroke * 3f),
                        )
                    } else {
                        null
                    },
                )
            }
        }
        entry.marker?.let { marker ->
            MosaicMarkerGlyph(
                marker = marker,
                ownerId = entry.id,
                ordinal = ordinal,
                size = markerSize,
                color = requireNotNull(component.markerColor),
                typography = component.titleTypography,
                localization = localization,
            )
        }
    }
}

/**
 * The one marker renderer, shared by Timeline entries and Feature List items.
 *
 * `0.4` consolidated the two marker vocabularies onto a single union so a Feature List can express
 * a negated item; rendering them through one path is what keeps that a real consolidation rather
 * than two implementations of one union. Markers are always decorative: the announced content is
 * the entry's or item's text, and a glyph read aloud beside it would say the same thing twice.
 */
@Composable
internal fun MosaicMarkerGlyph(
    marker: MosaicMarker,
    ownerId: String,
    ordinal: Int,
    size: Double,
    color: MosaicColor,
    typography: MosaicTypography,
    localization: MosaicLocalizationResolver,
) {
    // Resolved once, in composition: a semantic colour reads the Material scheme, which the draw
    // scope of a Canvas cannot do.
    val resolved = color.toComposeColor()
    when (marker) {
        MosaicMarker.Dot -> Canvas(Modifier.size(size.dp).clearAndSetSemantics { }) {
            drawCircle(resolved, radius = this.size.minDimension / 2f)
        }
        MosaicMarker.Ordinal -> Box(
            Modifier.size(size.dp).clearAndSetSemantics { },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                // Locale number formatting, so an Arabic catalog is free to render Arabic-Indic
                // digits without the protocol carrying a second numeral vocabulary.
                text = localization.formatInteger(ordinal),
                color = resolved,
                style = typography.toComposeTextStyle().copy(
                    fontSize = (size * 0.7).sp,
                    lineHeight = size.sp,
                    color = resolved,
                ),
                textAlign = TextAlign.Center,
            )
        }
        is MosaicMarker.Icon -> RenderIcon(
            MosaicIconComponent(
                id = "$ownerId-marker",
                name = marker.name,
                size = size,
                color = color,
                accessibility = MosaicImageAccessibility.Decorative,
            ),
            localization,
            Modifier,
        )
    }
}

/** Award renders its emblem and text as one group; the emblem is always decorative. */
@Composable
internal fun RenderAward(
    component: MosaicAwardComponent,
    document: MosaicPaywallDocument,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    modifier: Modifier,
) {
    val title = localization.resolve(component.title)
    val subtitle = component.subtitle?.let(localization::resolve)
    val announcement = component.accessibilityAnnouncement(localization)
    val presented = modifier
        .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
        // Unmerged, and the title and subtitle Text nodes are the elements. An absent subtitle
        // contributes no element rather than an empty one.
        .semantics { contentDescription = announcement.containerDescription() }
        .testTag("mosaic-node-${component.id}")
    val content: @Composable () -> Unit = {
        component.emblem?.let { emblem ->
            MosaicAwardEmblemContent(
                emblem = emblem,
                ownerId = component.id,
                document = document,
                imageResolver = imageResolver,
                localization = localization,
                diagnostics = diagnostics,
            )
        }
        MosaicStyledText(value = title, typography = component.titleTypography)
        // An absent subtitle renders nothing; `subtitleTypography` cannot exist without it.
        if (subtitle != null && component.subtitleTypography != null) {
            MosaicStyledText(value = subtitle, typography = component.subtitleTypography)
        }
    }
    if (component.direction == MosaicStackDirection.VERTICAL) {
        Column(
            modifier = presented,
            verticalArrangement = Arrangement.spacedBy(component.gap.dp),
            horizontalAlignment = component.crossAxisAlignment.toHorizontal(),
        ) { content() }
    } else {
        Row(
            modifier = presented,
            horizontalArrangement = Arrangement.spacedBy(component.gap.dp),
            verticalAlignment = component.crossAxisAlignment.toVertical(),
        ) { content() }
    }
}

@Composable
private fun MosaicAwardEmblemContent(
    emblem: MosaicAwardEmblem,
    ownerId: String,
    document: MosaicPaywallDocument,
    imageResolver: MosaicBundledImageResolver,
    localization: MosaicLocalizationResolver,
    diagnostics: MosaicDiagnosticSink,
) {
    when (emblem) {
        is MosaicAwardEmblem.Icon -> RenderIcon(
            MosaicIconComponent(
                id = "$ownerId-emblem",
                name = emblem.name,
                size = emblem.size,
                color = emblem.color,
                accessibility = MosaicImageAccessibility.Decorative,
            ),
            localization,
            Modifier,
        )
        is MosaicAwardEmblem.Image -> RenderImage(
            MosaicImageComponent(
                id = "$ownerId-emblem",
                assetId = emblem.assetId,
                width = MosaicWidthSizing.Fixed(emblem.size),
                aspectRatio = 1.0,
                height = emblem.size,
                contentMode = MosaicImageContentMode.FIT,
                accessibility = MosaicImageAccessibility.Decorative,
                sizing = MosaicBoxSizing(
                    width = MosaicWidthSizing.Fixed(emblem.size),
                    height = MosaicHeightSizing.Fixed(emblem.size),
                ),
            ),
            document,
            localization,
            imageResolver,
            diagnostics,
            Modifier,
        )
    }
}

/**
 * Social Proof announces, in order, the rating when present, then the quote, then the attribution.
 * The avatar is always decorative.
 */
@Composable
internal fun RenderSocialProof(
    component: MosaicSocialProofComponent,
    document: MosaicPaywallDocument,
    localization: MosaicLocalizationResolver,
    imageResolver: MosaicBundledImageResolver,
    diagnostics: MosaicDiagnosticSink,
    modifier: Modifier,
) {
    val quote = localization.resolve(component.quote)
    val attribution = localization.resolve(component.attribution)
    val ratingAnnouncement = component.rating?.let(localization::ratingAnnouncementOrNull)
    val announcement = component.accessibilityAnnouncement(localization, ratingAnnouncement)
    val diagnostics = LocalMosaicDiagnostics.current
    LaunchedEffect(component.id, component.rating, ratingAnnouncement) {
        if (component.rating != null && ratingAnnouncement == null) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.RENDERING_FAILED,
                    "The reserved ${MosaicReservedAccessibilityKey.RATING} string is unusable; " +
                        "the rating was not announced.",
                ),
            )
        }
    }
    Column(
        modifier = modifier
            .mosaicPresentation(component.appearance, component.sizing, component.outerInsets)
            // Unmerged: rating, quote, and attribution stay three elements in that order.
            .semantics { contentDescription = announcement.containerDescription() }
            .testTag("mosaic-node-${component.id}"),
        verticalArrangement = Arrangement.spacedBy(component.gap.dp),
    ) {
        // An absent rating draws no symbols and contributes no element: it is neither a zero
        // rating nor an unknown one.
        component.rating?.let { rating ->
            Row(
                // The symbols are decorative; the element is the reserved-string announcement.
                modifier = Modifier
                    .then(
                        if (ratingAnnouncement == null) {
                            Modifier.clearAndSetSemantics { }
                        } else {
                            Modifier.semantics(mergeDescendants = true) {
                                contentDescription = ratingAnnouncement
                            }
                        },
                    )
                    .testTag("mosaic-rating-${component.id}"),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                repeat(rating.maximum) { index ->
                    MosaicRatingStar(rating = rating, pointIndex = index)
                }
            }
        }
        MosaicStyledText(value = quote, typography = component.quoteTypography)
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            component.avatar?.let { avatar ->
                RenderImage(
                    MosaicImageComponent(
                        id = "${component.id}-avatar",
                        assetId = avatar.assetId,
                        width = MosaicWidthSizing.Fixed(avatar.size),
                        aspectRatio = 1.0,
                        height = avatar.size,
                        contentMode = MosaicImageContentMode.FILL,
                        accessibility = MosaicImageAccessibility.Decorative,
                        appearance = MosaicBoxAppearance(cornerRadius = avatar.size / 2.0),
                        sizing = MosaicBoxSizing(
                            width = MosaicWidthSizing.Fixed(avatar.size),
                            height = MosaicHeightSizing.Fixed(avatar.size),
                        ),
                    ),
                    document,
                    localization,
                    imageResolver,
                    diagnostics,
                    Modifier,
                )
            }
            MosaicStyledText(
                value = attribution,
                typography = component.attributionTypography,
            )
        }
    }
}

@Composable
private fun MosaicRatingStar(rating: MosaicSocialProofRating, pointIndex: Int) {
    val filled = rating.filledColor.toComposeColor()
    val empty = rating.emptyColor.toComposeColor()
    // `value` counts steps, so a half step fills exactly half of one symbol.
    val fraction = (rating.value - pointIndex * rating.step.stepsPerPoint)
        .coerceIn(0, rating.step.stepsPerPoint)
        .toFloat() / rating.step.stepsPerPoint
    Canvas(Modifier.size(rating.size.dp).clearAndSetSemantics { }) {
        val star = mosaicStarPath(size.minDimension)
        drawPath(star, empty)
        if (fraction > 0f) {
            clipRect(right = size.minDimension * fraction) { drawPath(star, filled) }
        }
    }
}

private fun mosaicStarPath(extent: Float): Path {
    val centre = extent / 2f
    val outer = extent / 2f
    val inner = outer * 0.42f
    return Path().apply {
        repeat(10) { index ->
            val radius = if (index % 2 == 0) outer else inner
            val angle = Math.toRadians((-90 + index * 36).toDouble())
            val x = centre + (radius * cos(angle)).toFloat()
            val y = centre + (radius * sin(angle)).toFloat()
            if (index == 0) moveTo(x, y) else lineTo(x, y)
        }
        close()
    }
}

internal fun MosaicHorizontalAlignment.toHorizontal(): Alignment.Horizontal = when (this) {
    MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
    MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
    MosaicHorizontalAlignment.END -> Alignment.End
}

internal fun MosaicHorizontalAlignment.toVertical(): Alignment.Vertical = when (this) {
    MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
    MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
    MosaicHorizontalAlignment.END -> Alignment.Bottom
}

internal fun MosaicTabsComponent.tabBarHorizontalArrangement(): Arrangement.Horizontal =
    when (tabBarDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(tabBarGap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER ->
            Arrangement.spacedBy(tabBarGap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(tabBarGap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicTabsComponent.tabBarVerticalArrangement(): Arrangement.Vertical =
    when (tabBarDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(tabBarGap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER ->
            Arrangement.spacedBy(tabBarGap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(tabBarGap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

private fun MosaicLocalizationResolver.numberLocale(): java.util.Locale =
    catalogLocale?.let(java.util.Locale::forLanguageTag) ?: java.util.Locale.getDefault()

internal fun MosaicLocalizationResolver.formatInteger(value: Int): String =
    java.text.NumberFormat.getIntegerInstance(numberLocale()).format(value)

/**
 * The rating announcement, phrased entirely by the authored catalog.
 *
 * The renderer composes no connective — not "out of", not "/", not one in any other language. It
 * reads `mosaic.a11y.rating` from the resolved catalog and substitutes the two reserved
 * placeholders, so word order travels with the translation. Returns null when the catalog does not
 * carry a usable template, which the decoder rejects; the caller then omits the rating from the
 * announcement and diagnoses rather than inventing a phrase.
 */
internal fun MosaicLocalizationResolver.ratingAnnouncementOrNull(
    rating: MosaicSocialProofRating,
): String? {
    val template = reservedString(MosaicReservedAccessibilityKey.RATING) ?: return null
    return runCatching { mosaicResolveRatingAnnouncement(rating, template) }.getOrNull()
}

/**
 * The container's accessible name.
 *
 * The label alone in every canonical case. Compose has no hint slot on a passive group, so an
 * authored hint is appended here rather than dropped; the contract keeps the two separate, which is
 * why [MosaicAccessibilityAnnouncement] does too and the conformance vectors assert them apart.
 */
internal fun MosaicAccessibilityAnnouncement.containerDescription(): String =
    if (hint == null) label else "$label. $hint"
