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
internal fun RenderCarousel(
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
internal fun RenderCountdown(
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

/**
 * The corner radius used when `appearance.cornerRadius` is absent.
 *
 * `cornerRadius` is an optional `logicalSize` in `schema/v0.3/paywall.schema.json` with no schema
 * default, so an absent value is square. Both other renderers read it that way — SwiftUI
 * `appearance?.cornerRadius ?? 0` and Flutter `appearance?.cornerRadius ?? 0` — and every Android
 * surface must agree, so an unstyled Button, TextButton, and purchase Button look identical across
 * platforms rather than picking three different Material-flavoured radii.
 */
internal const val MOSAIC_DEFAULT_CORNER_RADIUS: Double = 0.0

@Composable
internal fun Modifier.mosaicPresentation(
    appearance: MosaicBoxAppearance?,
    sizing: MosaicBoxSizing?,
    outerInsets: MosaicEdgeInsets?,
): Modifier {
    var result = mosaicOuterAndSizing(sizing, outerInsets)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(
        (appearance?.cornerRadius ?: MOSAIC_DEFAULT_CORNER_RADIUS).dp,
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
    // `clipContent` is an optional boolean with no schema default: absent means "do not clip",
    // matching SwiftUI (`clipContent == true`) and Flutter (`clipContent ?? false`).
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
internal fun Modifier.mosaicOuterAndSizing(
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
internal fun Modifier.mosaicBackground(background: MosaicBackground?, shape: Shape): Modifier {
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

internal fun Modifier.mosaicWidth(width: MosaicWidthSizing): Modifier = when (width) {
    MosaicWidthSizing.Content -> this
    MosaicWidthSizing.Fill -> fillMaxWidth()
    is MosaicWidthSizing.Fixed -> width(width.value.dp)
}

@Composable
internal fun MosaicTypography.toComposeTextStyle(): androidx.compose.ui.text.TextStyle {
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
internal fun MosaicColor.toComposeColor(): Color {
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
    val rgba = rawValue.removePrefix("#").toLongOrNull(16)
    if (rgba == null) {
        // Transparent stays the last-resort render, but an unparseable literal is a document defect
        // that would otherwise erase a surface invisibly. Diagnose it once per distinct raw value.
        val diagnostics = LocalMosaicDiagnostics.current
        LaunchedEffect(rawValue) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.RENDERING_COLOR_UNRESOLVED,
                    "A paywall colour literal could not be parsed; transparent was used.",
                ),
            )
        }
        return Color.Transparent
    }
    return Color(
        red = ((rgba shr 24) and 0xFF).toInt(),
        green = ((rgba shr 16) and 0xFF).toInt(),
        blue = ((rgba shr 8) and 0xFF).toInt(),
        alpha = (rgba and 0xFF).toInt(),
    )
}

internal fun MosaicEdgeInsets.toPaddingValues(): androidx.compose.foundation.layout.PaddingValues =
    androidx.compose.foundation.layout.PaddingValues(
        start = start.dp,
        top = top.dp,
        end = end.dp,
        bottom = bottom.dp,
    )

internal fun MosaicStack.verticalArrangement(): Arrangement.Vertical = when (mainAxisDistribution) {
    MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
    MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
    MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
    MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
}

internal fun MosaicStack.horizontalArrangement(): Arrangement.Horizontal = when (mainAxisDistribution) {
    MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
    MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
    MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
    MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
}

internal fun MosaicStack.composeHorizontalAlignment(): Alignment.Horizontal = when (crossAxisAlignment) {
    MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
    MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
    MosaicHorizontalAlignment.END -> Alignment.End
}

internal fun MosaicStack.composeVerticalAlignment(): Alignment.Vertical = when (crossAxisAlignment) {
    MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
    MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
    MosaicHorizontalAlignment.END -> Alignment.Bottom
}

internal fun MosaicButtonComponent.verticalArrangement(): Arrangement.Vertical =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicButtonComponent.horizontalArrangement(): Arrangement.Horizontal =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicButtonComponent.composeHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

internal fun MosaicButtonComponent.composeVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

internal fun MosaicProductSelectorComponent.selectorVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

internal fun MosaicProductSelectorComponent.selectorHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

internal fun MosaicProductCardComponent.verticalArrangement(): Arrangement.Vertical =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicProductCardComponent.horizontalArrangement(): Arrangement.Horizontal =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicProductCardComponent.composeHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

internal fun MosaicProductCardComponent.composeVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

internal fun MosaicProductBadgeComponent.verticalArrangement(): Arrangement.Vertical =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Top)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterVertically)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.Bottom)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicProductBadgeComponent.horizontalArrangement(): Arrangement.Horizontal =
    when (mainAxisDistribution) {
        MosaicMainAxisDistribution.START -> Arrangement.spacedBy(gap.dp, Alignment.Start)
        MosaicMainAxisDistribution.CENTER -> Arrangement.spacedBy(gap.dp, Alignment.CenterHorizontally)
        MosaicMainAxisDistribution.END -> Arrangement.spacedBy(gap.dp, Alignment.End)
        MosaicMainAxisDistribution.SPACE_BETWEEN -> Arrangement.SpaceBetween
    }

internal fun MosaicProductBadgeComponent.composeHorizontalAlignment(): Alignment.Horizontal =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Start
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterHorizontally
        MosaicHorizontalAlignment.END -> Alignment.End
    }

internal fun MosaicProductBadgeComponent.composeVerticalAlignment(): Alignment.Vertical =
    when (crossAxisAlignment) {
        MosaicHorizontalAlignment.START, MosaicHorizontalAlignment.STRETCH -> Alignment.Top
        MosaicHorizontalAlignment.CENTER -> Alignment.CenterVertically
        MosaicHorizontalAlignment.END -> Alignment.Bottom
    }

internal fun MosaicProductBadgeAnchor.toComposeAlignment(): Alignment = when (this) {
    MosaicProductBadgeAnchor.TOP_START -> Alignment.TopStart
    MosaicProductBadgeAnchor.TOP_END -> Alignment.TopEnd
    MosaicProductBadgeAnchor.BOTTOM_START -> Alignment.BottomStart
    MosaicProductBadgeAnchor.BOTTOM_END -> Alignment.BottomEnd
}

internal fun MosaicProductCardComponent.accessibilityDescription(
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

/**
 * The busy state announced by TalkBack while a Button's `inProgressChildren` are shown.
 *
 * It comes from the reserved `mosaic.a11y.in_progress` string, which Protocol 0.3 requires in the
 * default catalog of any document declaring `inProgressChildren`, and never from a literal: an
 * untranslated English "In progress" read aloud inside an Arabic or Japanese paywall was a live
 * defect in the 2026-08 fallback audit. Null means the document declares no usable translation,
 * which the decoder rejects; no phrase is invented in its place.
 */
internal fun MosaicButtonComponent.busyStateDescription(
    localization: MosaicLocalizationResolver,
): String? = localization.reservedString(MosaicReservedAccessibilityKey.IN_PROGRESS)

/**
 * [value] and [maximum] are read inside the draw scope, not during composition, so scrolling
 * invalidates only this Canvas rather than the enclosing paywall tree.
 */
@Composable
internal fun MosaicScrollIndicator(
    value: () -> Int,
    maximum: () -> Int,
    modifier: Modifier = Modifier,
) {
    val direction = LocalLayoutDirection.current
    Canvas(modifier) {
        val maximum = maximum()
        val visibleFraction = (size.height / (size.height + maximum)).coerceIn(0.08f, 1f)
        val thumbHeight = size.height * visibleFraction
        val travel = size.height - thumbHeight
        val top = if (maximum == 0) 0f else travel * (value().toFloat() / maximum)
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

internal fun MosaicTextAlignment.toCompose(): TextAlign = when (this) {
    MosaicTextAlignment.START -> TextAlign.Start
    MosaicTextAlignment.CENTER -> TextAlign.Center
    MosaicTextAlignment.END -> TextAlign.End
}

internal fun MosaicControlAccessibility.resolvedDescriptions(
    localization: MosaicLocalizationResolver,
): String = buildList {
    add(localization.resolve(label))
    hint?.let { add(localization.resolve(it)) }
}.joinToString(". ")
