package dev.mosaic.sdk

/**
 * The Paywall Protocol contract this SDK reads: `0.4` "Motion", and nothing else.
 *
 * ADR-0028 gives every contract exactly one version until GA, so there is no version dispatch and
 * no fallback to a predecessor. Version identifiers stay exact: a document declaring anything other
 * than this string is rejected atomically and resolves through cached configuration, then the
 * bundled fallback, then configuration unavailable.
 */
const val MOSAIC_PROTOCOL_VERSION: String = "0.4"

/**
 * The exact published artifact version of `dev.mosaic.sdk:mosaic`. It is sent as
 * `Mosaic-SDK-Version` on every request and must be bumped with the Gradle module versions in the
 * same change; it is not a protocol version.
 */
const val MOSAIC_ANDROID_SDK_VERSION: String = "0.1.0-dev.7"

/**
 * Kept as a set rather than collapsed into the constant so that a parallel version at GA widens a
 * value instead of changing the shape of a public one.
 */
val MOSAIC_SUPPORTED_PROTOCOL_VERSIONS: Set<String> = setOf(MOSAIC_PROTOCOL_VERSION)

enum class MosaicCapabilityName(val wireName: String) {
    SCROLL_CONTAINER("layout.scrollContainer"),
    STACK("layout.stack"),
    SCREENS("navigation.screens"),
    SHEETS("navigation.sheets"),
    SIZING("layout.sizing"),
    HEIGHT_SIZING("layout.heightSizing"),
    OUTER_INSETS("layout.outerInsets"),
    TEXT("component.text"),
    IMAGE("component.image"),
    FEATURE_LIST("component.featureList"),
    PRODUCT_SELECTOR("component.productSelector"),
    PRODUCT_CARD("component.productCard"),
    PRODUCT_BADGE("component.productBadge"),
    BUTTON("component.button"),
    ICON("component.icon"),
    CAROUSEL("component.carousel"),
    SWITCH("component.switch"),
    COUNTDOWN("component.countdown"),
    TABS("component.tabs"),
    TIMELINE("component.timeline"),
    AWARD("component.award"),
    SOCIAL_PROOF("component.socialProof"),
    LOCALIZATION_CATALOGS("localization.catalogs"),
    LOCALIZATION_RTL("localization.rtl"),
    PRODUCT_TEMPLATE("localization.productTemplate"),
    PRODUCT_REFERENCES("product.references"),
    BUNDLED_IMAGE("asset.bundledImage"),
    REMOTE_IMAGE("asset.remoteImage"),
    BUNDLED_VIDEO("asset.bundledVideo"),
    REMOTE_VIDEO("asset.remoteVideo"),
    PURCHASE_ACTION("action.purchase"),
    RESTORE_ACTION("action.restore"),
    CLOSE_ACTION("action.close"),
    NAVIGATE_TO_ACTION("action.navigateTo"),
    NAVIGATE_BACK_ACTION("action.navigateBack"),
    OPEN_EXTERNAL_URL_ACTION("action.openExternalUrl"),
    ACCESSIBILITY_METADATA("accessibility.metadata"),
    ACCESSIBILITY_RESERVED_STRINGS("accessibility.reservedStrings"),
    ASSET_FALLBACK("fallback.asset"),
    PRODUCT_FALLBACK("fallback.product"),
    NORMALIZED_OUTCOME("outcome.normalized"),
    COLORS("style.colors"),
    DESIGN_TOKENS("style.designTokens"),
    GRADIENT_BACKGROUND("style.gradientBackground"),
    MEDIA_BACKGROUND("style.mediaBackground"),
    SHADOW("style.shadow"),
    BOX_STYLE("style.box"),
    CLIPPING("style.clipping"),
    TYPOGRAPHY("style.typography"),
    STATIC_VISIBILITY("visibility.static"),
    SWITCH_VISIBILITY("condition.switchVisibility"),
    TAB_VISIBILITY("condition.tabVisibility"),
    MOTION_APPEAR("motion.appear"),
    MOTION_SELECTION("motion.selection"),
    MOTION_LOOP("motion.loop"),
}

/**
 * The three enhancement-tier capabilities.
 *
 * Every other capability in every Mosaic contract carries `rejectDocument`. These three carry
 * `renderWithoutMotion`: a reader missing one renders the document statically and completely, which
 * the terminal-state rule guarantees is the full authored design. The value is named for motion
 * specifically so it cannot spread by imitation into a general licence to strip features a reader
 * does not understand.
 */
val MOSAIC_MOTION_CAPABILITIES: Set<MosaicCapabilityName> = setOf(
    MosaicCapabilityName.MOTION_APPEAR,
    MosaicCapabilityName.MOTION_SELECTION,
    MosaicCapabilityName.MOTION_LOOP,
)

object MosaicCapabilityCatalog {
    /**
     * Every capability Paywall Protocol `0.4` defines, which is every capability there is.
     *
     * Named `current` rather than after the version, so that adding a parallel version at GA adds a
     * second value beside this one instead of renaming a public symbol.
     */
    val current: Set<MosaicCapabilityName> = setOf(
        MosaicCapabilityName.SCROLL_CONTAINER,
        MosaicCapabilityName.SCREENS,
        MosaicCapabilityName.SHEETS,
        MosaicCapabilityName.STACK,
        MosaicCapabilityName.SIZING,
        MosaicCapabilityName.HEIGHT_SIZING,
        MosaicCapabilityName.OUTER_INSETS,
        MosaicCapabilityName.TEXT,
        MosaicCapabilityName.IMAGE,
        MosaicCapabilityName.FEATURE_LIST,
        MosaicCapabilityName.PRODUCT_SELECTOR,
        MosaicCapabilityName.PRODUCT_CARD,
        MosaicCapabilityName.PRODUCT_BADGE,
        MosaicCapabilityName.BUTTON,
        MosaicCapabilityName.ICON,
        MosaicCapabilityName.CAROUSEL,
        MosaicCapabilityName.SWITCH,
        MosaicCapabilityName.COUNTDOWN,
        MosaicCapabilityName.TABS,
        MosaicCapabilityName.TIMELINE,
        MosaicCapabilityName.AWARD,
        MosaicCapabilityName.SOCIAL_PROOF,
        MosaicCapabilityName.LOCALIZATION_CATALOGS,
        MosaicCapabilityName.LOCALIZATION_RTL,
        MosaicCapabilityName.PRODUCT_TEMPLATE,
        MosaicCapabilityName.PRODUCT_REFERENCES,
        MosaicCapabilityName.BUNDLED_IMAGE,
        MosaicCapabilityName.REMOTE_IMAGE,
        MosaicCapabilityName.BUNDLED_VIDEO,
        MosaicCapabilityName.REMOTE_VIDEO,
        MosaicCapabilityName.PURCHASE_ACTION,
        MosaicCapabilityName.RESTORE_ACTION,
        MosaicCapabilityName.CLOSE_ACTION,
        MosaicCapabilityName.NAVIGATE_TO_ACTION,
        MosaicCapabilityName.NAVIGATE_BACK_ACTION,
        MosaicCapabilityName.OPEN_EXTERNAL_URL_ACTION,
        MosaicCapabilityName.ACCESSIBILITY_METADATA,
        MosaicCapabilityName.ACCESSIBILITY_RESERVED_STRINGS,
        MosaicCapabilityName.ASSET_FALLBACK,
        MosaicCapabilityName.PRODUCT_FALLBACK,
        MosaicCapabilityName.NORMALIZED_OUTCOME,
        MosaicCapabilityName.COLORS,
        MosaicCapabilityName.DESIGN_TOKENS,
        MosaicCapabilityName.GRADIENT_BACKGROUND,
        MosaicCapabilityName.MEDIA_BACKGROUND,
        MosaicCapabilityName.SHADOW,
        MosaicCapabilityName.BOX_STYLE,
        MosaicCapabilityName.CLIPPING,
        MosaicCapabilityName.TYPOGRAPHY,
        MosaicCapabilityName.STATIC_VISIBILITY,
        MosaicCapabilityName.SWITCH_VISIBILITY,
        MosaicCapabilityName.TAB_VISIBILITY,
    ) + MOSAIC_MOTION_CAPABILITIES
}

data class MosaicCapabilityReport(
    val sdkVersion: String,
    val supportedSchemaVersions: Set<String>,
    /** Highest supported version per capability, retained for source compatibility. */
    val supportedCapabilities: Map<MosaicCapabilityName, String>,
    /** Exact supported name/version pairs. */
    val supportedCapabilityVersions: Set<MosaicRequiredCapability> = supportedCapabilities
        .mapTo(mutableSetOf()) { (name, version) -> MosaicRequiredCapability(name, version) },
) {
    fun supports(capability: MosaicRequiredCapability): Boolean =
        capability.name in supportedCapabilities && capability in supportedCapabilityVersions
}

object MosaicProtocolCapabilities {
    /**
     * What this SDK can render.
     *
     * Still reported as exact name/version pairs rather than as a bare set of names. Selecting a
     * version was never the same as satisfying it, and with one contract version the capability
     * system carries more weight rather than less: a release requiring a capability this reader
     * lacks is withheld rather than downgraded or stripped.
     */
    fun report(sdkVersion: String = MOSAIC_ANDROID_SDK_VERSION): MosaicCapabilityReport {
        val exact = MosaicCapabilityCatalog.current.mapTo(mutableSetOf()) {
            MosaicRequiredCapability(it, MOSAIC_PROTOCOL_VERSION)
        }
        return MosaicCapabilityReport(
            sdkVersion = sdkVersion,
            supportedSchemaVersions = MOSAIC_SUPPORTED_PROTOCOL_VERSIONS,
            supportedCapabilities = exact.associate { it.name to it.version },
            supportedCapabilityVersions = exact,
        )
    }
}

data class MosaicPaywallDocument(
    val schemaVersion: String,
    val id: String,
    val revision: Int,
    val compatibility: MosaicDocumentCompatibility,
    val localization: MosaicLocalization,
    val assets: List<MosaicAsset>,
    val products: List<MosaicProductReference>,
    val layout: MosaicScrollContainer,
    val initialScreenId: String = layout.id,
    val screens: List<MosaicPaywallScreen> = listOf(
        MosaicPaywallScreen(id = initialScreenId, accessibilityLabel = null, layout = layout),
    ),
    val designSystem: MosaicDesignSystem = MosaicDesignSystem.Empty,
)

enum class MosaicScreenPresentation { SCREEN, SHEET }

data class MosaicPaywallScreen(
    val id: String,
    val accessibilityLabel: MosaicLocalizedText?,
    val layout: MosaicScrollContainer,
    val presentation: MosaicScreenPresentation = MosaicScreenPresentation.SCREEN,
)

data class MosaicDocumentCompatibility(
    val requiredCapabilities: List<MosaicRequiredCapability>,
)

data class MosaicRequiredCapability(
    val name: MosaicCapabilityName,
    val version: String,
)

enum class MosaicLayoutDirection { LTR, RTL }

data class MosaicLocalization(
    val defaultLocale: String,
    val fallbackLocale: String,
    val locales: Map<String, MosaicLocaleCatalog>,
)

data class MosaicLocaleCatalog(
    val direction: MosaicLayoutDirection,
    val strings: Map<String, String>,
)

data class MosaicLocalizedText(
    val defaultValue: String,
    val localizationKey: String,
)

sealed interface MosaicAsset {
    val id: String
    val source: MosaicAssetSource
}

val MosaicAsset.sourceKey: String
    get() = when (val resolved = source) {
        is MosaicAssetSource.Bundled -> resolved.key
        is MosaicAssetSource.Remote -> resolved.url
    }

sealed interface MosaicAssetSource {
    data class Bundled(val key: String) : MosaicAssetSource
    data class Remote(val url: String) : MosaicAssetSource
}

data class MosaicImageAsset(
    override val id: String,
    val sourceKey: String,
    val placeholder: MosaicLocalizedText,
    override val source: MosaicAssetSource = MosaicAssetSource.Bundled(sourceKey),
) : MosaicAsset

data class MosaicVideoAsset(
    override val id: String,
    override val source: MosaicAssetSource,
) : MosaicAsset

data class MosaicProductReference(
    val id: String,
    val providerProductId: String,
    val label: MosaicLocalizedText,
    val badge: MosaicLocalizedText?,
)

data class MosaicScrollContainer(
    val id: String,
    val showsIndicators: Boolean,
    val content: MosaicStack,
    val background: MosaicBackground? = null,
)

data class MosaicEdgeInsets(
    val top: Double,
    val start: Double,
    val bottom: Double,
    val end: Double,
) {
    companion object {
        val Zero = MosaicEdgeInsets(0.0, 0.0, 0.0, 0.0)
    }
}

data class MosaicEdgeInsetsOverride(
    val top: Double? = null,
    val start: Double? = null,
    val bottom: Double? = null,
    val end: Double? = null,
) {
    fun resolve(base: MosaicEdgeInsets): MosaicEdgeInsets = MosaicEdgeInsets(
        top = top ?: base.top,
        start = start ?: base.start,
        bottom = bottom ?: base.bottom,
        end = end ?: base.end,
    )
}

enum class MosaicStackDirection { VERTICAL, HORIZONTAL }
enum class MosaicMainAxisDistribution { START, CENTER, END, SPACE_BETWEEN }
enum class MosaicHorizontalAlignment { START, CENTER, END, STRETCH }
enum class MosaicTextAlignment { START, CENTER, END }

sealed interface MosaicNode {
    val id: String
    val type: String

    /**
     * Authored `0.4` motion, or null.
     *
     * Null on every node of a `0.3` document and on any `0.4` node that authors none. Motion never
     * reaches the accessibility tree: a node mid-entrance is already present, focusable, and
     * announceable, and a pulsing button announces exactly what a static one announces.
     */
    val motion: MosaicNodeMotion? get() = null
}

data class MosaicStack(
    override val id: String,
    val direction: MosaicStackDirection,
    val gap: Double,
    val padding: MosaicEdgeInsets,
    val mainAxisDistribution: MosaicMainAxisDistribution,
    val crossAxisAlignment: MosaicHorizontalAlignment,
    val children: List<MosaicNode>,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
    override val type: String = "stack",
) : MosaicNode {
    val spacing: Double get() = gap
    val horizontalAlignment: MosaicHorizontalAlignment get() = crossAxisAlignment
}


enum class MosaicSemanticColor(val wireName: String) {
    TEXT_PRIMARY("text.primary"),
    TEXT_SECONDARY("text.secondary"),
    SURFACE_DEFAULT("surface.default"),
    SURFACE_ELEVATED("surface.elevated"),
    ACTION_PRIMARY("action.primary"),
    ACTION_ON_PRIMARY("action.onPrimary"),
    BORDER_DEFAULT("border.default"),
    TRANSPARENT("transparent"),
}

data class MosaicColor(val rawValue: String) {
    val semantic: MosaicSemanticColor?
        get() = MosaicSemanticColor.entries.firstOrNull { it.wireName == rawValue }

    companion object {
        fun semantic(value: MosaicSemanticColor): MosaicColor = MosaicColor(value.wireName)
    }
}

data class MosaicGradientStop(
    val position: Float,
    val color: MosaicColor,
)

sealed interface MosaicBackground {
    data class Solid(val color: MosaicColor) : MosaicBackground
    data class LinearGradient(
        val angleDegrees: Float,
        val stops: List<MosaicGradientStop>,
    ) : MosaicBackground
    data class RadialGradient(
        val centerX: Float,
        val centerY: Float,
        val radius: Float,
        val stops: List<MosaicGradientStop>,
    ) : MosaicBackground
    data class Image(
        val assetId: String,
        val contentMode: MosaicImageContentMode,
        val fallbackColor: MosaicColor,
    ) : MosaicBackground
    data class Video(
        val assetId: String,
        val posterAssetId: String?,
        val contentMode: MosaicImageContentMode,
        val fallbackColor: MosaicColor,
    ) : MosaicBackground
}

/** Source-compatible convenience for callers that only inspect a solid background. */
val MosaicBackground.rawValue: String
    get() = (this as? MosaicBackground.Solid)?.color?.rawValue.orEmpty()

data class MosaicShadow(
    val color: MosaicColor,
    val offsetX: Double,
    val offsetY: Double,
    val blurRadius: Double,
)

data class MosaicColorToken(val id: String, val name: String, val value: MosaicColor)
data class MosaicBackgroundToken(val id: String, val name: String, val value: MosaicBackground)
data class MosaicShadowToken(val id: String, val name: String, val value: MosaicShadow)

data class MosaicDesignSystem(
    val colors: List<MosaicColorToken>,
    val backgrounds: List<MosaicBackgroundToken>,
    val shadows: List<MosaicShadowToken>,
    /**
     * The fourth catalog, added by `0.4`. Required and possibly empty on a `0.4` document, and
     * absent on a `0.3` one, which the decoder enforces in both directions.
     */
    val motions: List<MosaicMotionToken> = emptyList(),
) {
    companion object {
        val Empty = MosaicDesignSystem(emptyList(), emptyList(), emptyList(), emptyList())
    }
}

data class MosaicBorder(
    val color: MosaicColor,
    val width: Double,
)

data class MosaicBorderOverride(
    val color: MosaicColor? = null,
    val width: Double? = null,
) {
    fun resolve(base: MosaicBorder): MosaicBorder = MosaicBorder(
        color = color ?: base.color,
        width = width ?: base.width,
    )
}

data class MosaicBoxAppearance(
    val background: MosaicBackground? = null,
    val border: MosaicBorder? = null,
    val cornerRadius: Double? = null,
    val opacity: Double? = null,
    val padding: MosaicEdgeInsets? = null,
    val clipContent: Boolean? = null,
    val shadow: MosaicShadow? = null,
)

sealed interface MosaicWidthSizing {
    data object Content : MosaicWidthSizing
    data object Fill : MosaicWidthSizing
    data class Fixed(val value: Double) : MosaicWidthSizing
}

sealed interface MosaicHeightSizing {
    data object Content : MosaicHeightSizing
    data object Fill : MosaicHeightSizing
    data class Fixed(val value: Double) : MosaicHeightSizing
}

data class MosaicBoxSizing(
    val width: MosaicWidthSizing? = null,
    val height: MosaicHeightSizing? = null,
)

sealed interface MosaicVisibility {
    data object Always : MosaicVisibility
    data object Hidden : MosaicVisibility
    data class SwitchValue(val switchId: String, val equals: Boolean) : MosaicVisibility

    /**
     * Visible only while [tabsId]'s runtime selection equals [equals]. A false condition removes the
     * node from layout, the accessibility tree, and focus order, exactly as a false Switch condition
     * does.
     */
    data class TabValue(val tabsId: String, val equals: String) : MosaicVisibility
}

/**
 * The runtime selection a visibility condition reads.
 *
 * Both maps are complete for the document they were built from: the decoder rejects a condition
 * naming a controller the document does not declare, so a controller absent here is a caller bug,
 * not an authoring one. [mosaicVisibilityIsSatisfied] therefore throws rather than resolving to
 * hidden — a component that silently vanishes is indistinguishable from one that was authored
 * hidden.
 */
data class MosaicSelectionState(
    val switches: Map<String, Boolean> = emptyMap(),
    val tabs: Map<String, String> = emptyMap(),
)

/** Raised when a visibility condition names a controller the supplied selection state omits. */
class MosaicVisibilityStateException(message: String) : IllegalStateException(message)

fun mosaicVisibilityIsSatisfied(
    visibility: MosaicVisibility,
    selection: MosaicSelectionState,
): Boolean = when (visibility) {
    MosaicVisibility.Always -> true
    MosaicVisibility.Hidden -> false
    is MosaicVisibility.SwitchValue -> {
        val value = selection.switches[visibility.switchId]
            ?: throw MosaicVisibilityStateException(
                "Visibility depends on Switch ${visibility.switchId}, " +
                    "which the supplied runtime state does not carry.",
            )
        value == visibility.equals
    }
    is MosaicVisibility.TabValue -> {
        val value = selection.tabs[visibility.tabsId]
            ?: throw MosaicVisibilityStateException(
                "Visibility depends on Tabs ${visibility.tabsId}, " +
                    "which the supplied runtime state does not carry.",
            )
        value == visibility.equals
    }
}

enum class MosaicTypographyStyle { DISPLAY, TITLE, HEADING, BODY, LABEL, CAPTION }
typealias MosaicTextStyle = MosaicTypographyStyle
enum class MosaicFontWeight { REGULAR, MEDIUM, SEMIBOLD, BOLD }
enum class MosaicTextOverflow { CLIP, ELLIPSIS }

data class MosaicTypography(
    val style: MosaicTypographyStyle,
    val fontSize: Double,
    val lineHeightMultiplier: Double,
    val weight: MosaicFontWeight,
    val color: MosaicColor,
    val alignment: MosaicTextAlignment,
    val maxLines: Int? = null,
    val overflow: MosaicTextOverflow? = null,
)

sealed interface MosaicTextAccessibility {
    data object Text : MosaicTextAccessibility
    data class LabelledText(val label: MosaicLocalizedText) : MosaicTextAccessibility
    data class Heading(val level: Int) : MosaicTextAccessibility
    data class LabelledHeading(val level: Int, val label: MosaicLocalizedText) : MosaicTextAccessibility

    val labelOrNull: MosaicLocalizedText?
        get() = when (this) {
            Text, is Heading -> null
            is LabelledText -> label
            is LabelledHeading -> label
        }

    val headingLevelOrNull: Int?
        get() = when (this) {
            Text, is LabelledText -> null
            is Heading -> level
            is LabelledHeading -> level
        }
}

sealed interface MosaicImageAccessibility {
    data object Decorative : MosaicImageAccessibility
    data class Informative(val label: MosaicLocalizedText) : MosaicImageAccessibility
}

data class MosaicControlAccessibility(
    val label: MosaicLocalizedText,
    val hint: MosaicLocalizedText?,
)

data class MosaicTextComponent(
    override val id: String,
    val value: MosaicLocalizedText,
    val typography: MosaicTypography,
    val accessibility: MosaicTextAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode {
    override val type: String = "text"
    val style: MosaicTextStyle get() = typography.style
    val alignment: MosaicTextAlignment get() = typography.alignment
}

enum class MosaicImageContentMode { FIT, FILL }

data class MosaicImageComponent(
    override val id: String,
    val assetId: String,
    val width: MosaicWidthSizing,
    val aspectRatio: Double?,
    val height: Double?,
    val contentMode: MosaicImageContentMode,
    val accessibility: MosaicImageAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode {
    override val type: String = "image"
}

data class MosaicFeatureListItem(
    val id: String,
    val text: MosaicLocalizedText,
    /**
     * Overrides the list's marker for this item only. Absent means the item carries the list's
     * marker; it is never a request for no glyph. A `0.3` document has no item-level marker, so
     * this is always null there.
     */
    val marker: MosaicMarker? = null,
)

data class MosaicFeatureListComponent(
    override val id: String,
    /** The glyph every item carries unless the item overrides it. */
    val marker: MosaicMarker,
    val gap: Double,
    val markerColor: MosaicColor,
    val items: List<MosaicFeatureListItem>,
    val typography: MosaicTypography,
    val accessibility: MosaicControlAccessibility,
    /**
     * The authored extent of every marker glyph, mirroring Timeline's field of the same name.
     *
     * Component-level rather than per item, exactly as marker *colour* is: an item overrides which
     * glyph it draws, never how large it is, so a list cannot end up with a ragged glyph column.
     * A `0.3` document has no such field, so this is always null there.
     */
    val markerSize: Double? = null,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode {
    override val type: String = "featureList"
    val itemSpacing: Double get() = gap

    /**
     * The extent every marker is actually drawn at.
     *
     * Unlike Timeline, where a marker is optional and `markerSize` is therefore required exactly
     * when one is declared, a Feature List always draws a glyph — `marker` is required on the
     * component — so the field is optional and the schema documents a default instead. That default
     * is the list's own `typography.fontSize`, following Timeline's precedent of falling back to
     * another authored value on the same component rather than to a constant, and **renderers must
     * not substitute a value of their own**. It is also what this renderer derived before the field
     * existed, so a list that declares no size renders exactly as it did.
     */
    val resolvedMarkerSize: Double get() = markerSize ?: typography.fontSize
}

enum class MosaicUnavailableProductSelection { FIRST_AVAILABLE }
enum class MosaicNoAvailableProductBehavior { SHOW_MESSAGE_AND_DISABLE_PURCHASE }

data class MosaicUnavailableProductFallback(
    val message: MosaicLocalizedText,
    val selection: MosaicUnavailableProductSelection = MosaicUnavailableProductSelection.FIRST_AVAILABLE,
    val whenNoneAvailable: MosaicNoAvailableProductBehavior =
        MosaicNoAvailableProductBehavior.SHOW_MESSAGE_AND_DISABLE_PURCHASE,
)

/**
 * Complete authored box state of a two-state selectable box.
 *
 * `0.3` expresses this through the neutral `selectionStateStyle` definition, which
 * `productCardStyles` now aliases, so Product Cards, Product Badges, and Tabs share one resolution
 * path instead of three that can drift.
 */
data class MosaicSelectionStateStyle(
    val background: MosaicBackground,
    val border: MosaicBorder,
    val cornerRadius: Double,
    val padding: MosaicEdgeInsets,
    val opacity: Double,
    val shadow: MosaicShadow? = null,
)

/** Recursively partial Selected state; absent leaves inherit from Default. */
data class MosaicSelectionStateStyleOverride(
    val background: MosaicBackground? = null,
    val border: MosaicBorderOverride? = null,
    val cornerRadius: Double? = null,
    val padding: MosaicEdgeInsetsOverride? = null,
    val opacity: Double? = null,
    val shadow: MosaicShadow? = null,
) {
    fun resolve(base: MosaicSelectionStateStyle): MosaicSelectionStateStyle =
        MosaicSelectionStateStyle(
            background = background ?: base.background,
            border = border?.resolve(base.border) ?: base.border,
            cornerRadius = cornerRadius ?: base.cornerRadius,
            padding = padding?.resolve(base.padding) ?: base.padding,
            opacity = opacity ?: base.opacity,
            shadow = shadow ?: base.shadow,
        )
}

data class MosaicSelectionStyles(
    val defaultStyle: MosaicSelectionStateStyle,
    val selected: MosaicSelectionStateStyleOverride,
) {
    fun resolve(selected: Boolean): MosaicSelectionStateStyle =
        if (selected) this.selected.resolve(defaultStyle) else defaultStyle
}

/** Source-compatible aliases for callers written against the Product Card-specific names. */
typealias MosaicProductCardBoxStyle = MosaicSelectionStateStyle
typealias MosaicProductCardBoxStyleOverride = MosaicSelectionStateStyleOverride
typealias MosaicProductCardBoxStyles = MosaicSelectionStyles

sealed interface MosaicProductBadgePlacement {
    data object Nested : MosaicProductBadgePlacement

    data class Overlay(
        val anchor: MosaicProductBadgeAnchor,
        val inset: Double,
    ) : MosaicProductBadgePlacement
}

enum class MosaicProductBadgeAnchor { TOP_START, TOP_END, BOTTOM_START, BOTTOM_END }

data class MosaicProductBadgeComponent(
    override val id: String,
    val placement: MosaicProductBadgePlacement,
    val direction: MosaicStackDirection,
    val gap: Double,
    val mainAxisDistribution: MosaicMainAxisDistribution,
    val crossAxisAlignment: MosaicHorizontalAlignment,
    val children: List<MosaicNode>,
    val styles: MosaicProductCardBoxStyles,
    val sizing: MosaicBoxSizing? = null,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode {
    override val type: String = "productBadge"
}

data class MosaicProductCardComponent(
    override val id: String,
    val productReferenceId: String,
    val direction: MosaicStackDirection,
    val gap: Double,
    val mainAxisDistribution: MosaicMainAxisDistribution,
    val crossAxisAlignment: MosaicHorizontalAlignment,
    val children: List<MosaicNode>,
    val styles: MosaicProductCardBoxStyles,
    val clipContent: Boolean = false,
    val accessibilityLabel: MosaicLocalizedText? = null,
    val sizing: MosaicBoxSizing? = null,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode {
    override val type: String = "productCard"
}

data class MosaicProductSelectorComponent(
    override val id: String,
    val productReferenceIds: List<String>,
    val initiallySelectedProductReferenceId: String,
    val direction: MosaicStackDirection,
    val gap: Double,
    val unavailableFallback: MosaicUnavailableProductFallback,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    /** Authored cards. */
    val cards: List<MosaicProductCardComponent> = emptyList(),
    val initialProductCardId: String = initiallySelectedProductReferenceId,
    val crossAxisAlignment: MosaicHorizontalAlignment = MosaicHorizontalAlignment.STRETCH,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode {
    override val type: String = "productSelector"
    val itemSpacing: Double get() = gap
}

sealed interface MosaicAction { val type: String }

data class MosaicPurchaseAction(val productSelectorId: String) : MosaicAction {
    override val type: String = "purchase"
}

data object MosaicRestoreAction : MosaicAction { override val type: String = "restore" }
data object MosaicCloseAction : MosaicAction { override val type: String = "close" }
data class MosaicNavigateToAction(val screenId: String) : MosaicAction {
    override val type: String = "navigateTo"
}
data object MosaicNavigateBackAction : MosaicAction { override val type: String = "navigateBack" }
data class MosaicOpenExternalUrlAction(val url: String) : MosaicAction {
    override val type: String = "openExternalUrl"
}

enum class MosaicIconName {
    CHECKMARK,
    CLOSE,
    LOCK,
    RESTORE,
    EXTERNAL_LINK,
    ARROW_BACKWARD,
    ARROW_FORWARD,
    CHEVRON_BACKWARD,
    CHEVRON_FORWARD,
}

data class MosaicIconComponent(
    override val id: String,
    val name: MosaicIconName,
    val size: Double,
    val color: MosaicColor,
    val accessibility: MosaicImageAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "icon" }

data class MosaicButtonComponent(
    override val id: String,
    val direction: MosaicStackDirection,
    val gap: Double,
    val mainAxisDistribution: MosaicMainAxisDistribution,
    val crossAxisAlignment: MosaicHorizontalAlignment,
    val children: List<MosaicNode>,
    val inProgressChildren: List<MosaicNode>?,
    val action: MosaicAction,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "button" }

data class MosaicCarouselPage(
    val id: String,
    val accessibilityLabel: MosaicLocalizedText,
    val content: MosaicStack,
)

data class MosaicCarouselComponent(
    override val id: String,
    val initialPageIndex: Int,
    val showsIndicators: Boolean,
    val pages: List<MosaicCarouselPage>,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "carousel" }

data class MosaicSwitchComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val initialValue: Boolean,
    val typography: MosaicTypography,
    val offTrackColor: MosaicColor,
    val onTrackColor: MosaicColor,
    val thumbColor: MosaicColor,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "switch" }

enum class MosaicCountdownUnit(val rank: Int) {
    DAY(3), HOUR(2), MINUTE(1), SECOND(0),
}

data class MosaicCountdownComponent(
    override val id: String,
    val endsAt: String,
    val endsAtEpochMillis: Long,
    val largestUnit: MosaicCountdownUnit,
    val smallestUnit: MosaicCountdownUnit,
    val completedText: MosaicLocalizedText,
    val typography: MosaicTypography,
    val accessibility: MosaicTextAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "countdown" }


// --- Components -------------------------------------------------------------------

enum class MosaicTabBarDirection { VERTICAL, HORIZONTAL }

data class MosaicTabEntry(
    val id: String,
    val label: MosaicLocalizedText,
    val content: MosaicStack,
)

/**
 * N labelled panels with exactly one visible at a time.
 *
 * [initialTabId] is authored, never positional: reordering [tabs] is a layout edit and must not
 * change which panel opens. [selectedLabelColor] is likewise required, so "the selected label
 * deliberately keeps the Default colour" and "no colour was ever authored" cannot share an encoding.
 */
data class MosaicTabsComponent(
    override val id: String,
    val tabBarDirection: MosaicTabBarDirection,
    val tabBarGap: Double,
    val tabBarDistribution: MosaicMainAxisDistribution,
    val gap: Double,
    val initialTabId: String,
    val tabs: List<MosaicTabEntry>,
    val styles: MosaicSelectionStyles,
    val labelTypography: MosaicTypography,
    val selectedLabelColor: MosaicColor,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "tabs" }

enum class MosaicTimelineConnectorStyle { SOLID, DASHED }

data class MosaicTimelineConnector(
    val color: MosaicColor,
    val width: Double,
    val style: MosaicTimelineConnectorStyle,
)

/**
 * Closed three-arm marker union; an unrecognised arm rejects the document.
 *
 * `0.3` carried two marker idioms: Timeline's three-arm union and Feature List's single constant
 * `"checkmark"`, which meant a list could not express a *negated* item — "not included" on a
 * comparison paywall. `0.4` consolidates them onto this one vocabulary. Marker colour and size stay
 * component-level on both components; a per-item colour is a second axis and a deliberate deferral.
 */
sealed interface MosaicMarker {
    data object Dot : MosaicMarker

    /** The item's or entry's 1-based position, formatted by the platform's locale formatting. */
    data object Ordinal : MosaicMarker
    data class Icon(val name: MosaicIconName) : MosaicMarker
}

/** Source-compatible alias for callers written against the Timeline-specific name. */
typealias MosaicTimelineMarker = MosaicMarker

data class MosaicTimelineEntry(
    val id: String,
    val title: MosaicLocalizedText,
    /** Absent means the entry has a title and nothing else; no empty second line is reserved. */
    val description: MosaicLocalizedText? = null,
    /** Absent means no glyph and an unbroken connector, not a request for a default marker. */
    val marker: MosaicTimelineMarker? = null,
)

/**
 * An ordered sequence of steps. Array order is the sequence order and is never reordered.
 *
 * [markerColor], [markerSize], and [descriptionTypography] are required exactly when an entry
 * consumes them and forbidden otherwise; the decoder enforces both directions.
 */
data class MosaicTimelineComponent(
    override val id: String,
    val gap: Double,
    val connector: MosaicTimelineConnector,
    val entries: List<MosaicTimelineEntry>,
    val titleTypography: MosaicTypography,
    val accessibility: MosaicControlAccessibility,
    val markerColor: MosaicColor? = null,
    val markerSize: Double? = null,
    val descriptionTypography: MosaicTypography? = null,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "timeline" }

/** Closed two-arm union over the existing image-asset and icon vocabularies. */
sealed interface MosaicAwardEmblem {
    val size: Double

    data class Image(val assetId: String, override val size: Double) : MosaicAwardEmblem
    data class Icon(
        val name: MosaicIconName,
        override val size: Double,
        val color: MosaicColor,
    ) : MosaicAwardEmblem
}

/** A recognition or accolade. Passive: no action, no runtime state; the emblem is decorative. */
data class MosaicAwardComponent(
    override val id: String,
    val direction: MosaicStackDirection,
    val gap: Double,
    val crossAxisAlignment: MosaicHorizontalAlignment,
    val title: MosaicLocalizedText,
    val titleTypography: MosaicTypography,
    val accessibility: MosaicControlAccessibility,
    /** Absent means the award renders its text alone, not a generic badge. */
    val emblem: MosaicAwardEmblem? = null,
    val subtitle: MosaicLocalizedText? = null,
    val subtitleTypography: MosaicTypography? = null,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "award" }

/**
 * Accessibility copy the protocol announces rather than a component referencing it.
 *
 * A renderer must never compose this copy from a string literal in any language: the 2026-08
 * fallback audit found hardcoded English shipping to production on two platforms. Presence is
 * enforced in both directions — required when the document contains the feature that reads the
 * key, forbidden when it does not — and reserved keys are exempt from the unused-key sweep because
 * no component references them by ID.
 */
object MosaicReservedAccessibilityKey {
    const val RATING: String = "mosaic.a11y.rating"
    const val IN_PROGRESS: String = "mosaic.a11y.in_progress"

    const val RATING_VALUE_PLACEHOLDER: String = "{{ rating.value }}"
    const val RATING_MAXIMUM_PLACEHOLDER: String = "{{ rating.maximum }}"

    val placeholdersByKey: Map<String, List<String>> = mapOf(
        RATING to listOf(RATING_VALUE_PLACEHOLDER, RATING_MAXIMUM_PLACEHOLDER),
        IN_PROGRESS to emptyList(),
    )

    val all: Set<String> = placeholdersByKey.keys
}

/**
 * A rating in points, as the exact string substituted into `{{ rating.value }}`.
 *
 * `value` counts steps and `maximum` counts points, so announcing `value` directly would say
 * "9 out of 5". The conversion never rounds: `value` is an integer and there are one or two steps
 * per point, so the result is a whole number or a whole number and a half.
 *
 * The form is ASCII by contract — ASCII digits, `.` as the decimal separator, no grouping, one
 * fraction digit only for a half step. A platform number formatter is deliberately not used: a
 * German locale would produce `4,5` and fail the cross-SDK conformance vectors, and formatters
 * disagree with themselves across OS versions. All locale variation lives in the authored
 * template instead.
 */
fun mosaicRatingPoints(rating: MosaicSocialProofRating): String {
    val stepsPerPoint = rating.step.stepsPerPoint
    val whole = rating.value / stepsPerPoint
    return if (rating.value % stepsPerPoint == 0) whole.toString() else "$whole.5"
}

fun mosaicRatingMaximumPoints(rating: MosaicSocialProofRating): String = rating.maximum.toString()

/** Raised when a reserved accessibility string is absent or malformed at announcement time. */
class MosaicReservedStringException(message: String) : IllegalStateException(message)

/**
 * The exact string a renderer announces for a rating.
 *
 * [template] is the resolved `mosaic.a11y.rating` string for the resolved catalog. Substitution is
 * closed to the two reserved placeholders; the template is authored copy and nothing else in it is
 * interpreted. Word order travels with the catalog, so no connective is composed here.
 */
fun mosaicResolveRatingAnnouncement(
    rating: MosaicSocialProofRating,
    template: String,
): String {
    MosaicReservedAccessibilityKey.placeholdersByKey
        .getValue(MosaicReservedAccessibilityKey.RATING)
        .forEach { placeholder ->
            if (placeholder !in template) {
                throw MosaicReservedStringException(
                    "The ${MosaicReservedAccessibilityKey.RATING} string is missing $placeholder.",
                )
            }
        }
    return template
        .replace(MosaicReservedAccessibilityKey.RATING_VALUE_PLACEHOLDER, mosaicRatingPoints(rating))
        .replace(
            MosaicReservedAccessibilityKey.RATING_MAXIMUM_PLACEHOLDER,
            mosaicRatingMaximumPoints(rating),
        )
}

enum class MosaicSocialProofRatingStep(val stepsPerPoint: Int) { WHOLE(1), HALF(2) }

/**
 * A bounded, integer-only rating. [value] counts *steps*, not points: with [step] `HALF` and
 * [maximum] 5, a [value] of 9 is four and a half out of five.
 */
data class MosaicSocialProofRating(
    val value: Int,
    val maximum: Int,
    val step: MosaicSocialProofRatingStep,
    val size: Double,
    val filledColor: MosaicColor,
    val emptyColor: MosaicColor,
) {
    val maximumSteps: Int get() = maximum * step.stepsPerPoint
    val filledPoints: Double get() = value.toDouble() / step.stepsPerPoint
}

data class MosaicSocialProofAvatar(val assetId: String, val size: Double)

/** An attributed testimonial, optionally rated and optionally illustrated. Passive. */
data class MosaicSocialProofComponent(
    override val id: String,
    val gap: Double,
    val quote: MosaicLocalizedText,
    val quoteTypography: MosaicTypography,
    val attribution: MosaicLocalizedText,
    val attributionTypography: MosaicTypography,
    val accessibility: MosaicControlAccessibility,
    /** Absent means no rating is drawn. It is neither a zero rating nor an unknown one. */
    val rating: MosaicSocialProofRating? = null,
    val avatar: MosaicSocialProofAvatar? = null,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
    override val motion: MosaicNodeMotion? = null,
) : MosaicNode { override val type: String = "socialProof" }

internal fun MosaicStack.walkDepthFirst(): Sequence<MosaicNode> = sequence {
    yield(this@walkDepthFirst)
    children.forEach { child ->
        when (child) {
            is MosaicStack -> yieldAll(child.walkDepthFirst())
            is MosaicCarouselComponent -> {
                yield(child)
                child.pages.forEach { page -> yieldAll(page.content.walkDepthFirst()) }
            }
            is MosaicTabsComponent -> {
                yield(child)
                child.tabs.forEach { tab -> yieldAll(tab.content.walkDepthFirst()) }
            }
            is MosaicButtonComponent -> {
                yield(child)
                child.children.forEach { content -> yieldAll(content.walkDepthFirst()) }
                child.inProgressChildren.orEmpty().forEach { content ->
                    yieldAll(content.walkDepthFirst())
                }
            }
            is MosaicProductSelectorComponent -> {
                yield(child)
                child.cards.forEach { card -> yieldAll(card.walkDepthFirst()) }
            }
            is MosaicProductCardComponent -> yieldAll(child.walkDepthFirst())
            is MosaicProductBadgeComponent -> yieldAll(child.walkDepthFirst())
            else -> yield(child)
        }
    }
}

private fun MosaicNode.walkDepthFirst(): Sequence<MosaicNode> = when (this) {
    is MosaicStack -> walkDepthFirst()
    is MosaicCarouselComponent -> sequence {
        yield(this@walkDepthFirst)
        pages.forEach { page -> yieldAll(page.content.walkDepthFirst()) }
    }
    is MosaicTabsComponent -> sequence {
        yield(this@walkDepthFirst)
        tabs.forEach { tab -> yieldAll(tab.content.walkDepthFirst()) }
    }
    is MosaicButtonComponent -> sequence {
        yield(this@walkDepthFirst)
        children.forEach { child -> yieldAll(child.walkDepthFirst()) }
        inProgressChildren.orEmpty().forEach { child -> yieldAll(child.walkDepthFirst()) }
    }
    is MosaicProductSelectorComponent -> sequence {
        yield(this@walkDepthFirst)
        cards.forEach { card -> yieldAll(card.walkDepthFirst()) }
    }
    is MosaicProductCardComponent -> sequence {
        yield(this@walkDepthFirst)
        children.forEach { child -> yieldAll(child.walkDepthFirst()) }
    }
    is MosaicProductBadgeComponent -> sequence {
        yield(this@walkDepthFirst)
        children.forEach { child -> yieldAll(child.walkDepthFirst()) }
    }
    else -> sequenceOf(this)
}

internal fun MosaicPaywallDocument.walkNodesDepthFirst(): Sequence<MosaicNode> = sequence {
    screens.forEach { screen -> yieldAll(screen.layout.content.walkDepthFirst()) }
}
