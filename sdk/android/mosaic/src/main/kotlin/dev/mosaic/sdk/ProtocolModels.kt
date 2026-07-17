package dev.mosaic.sdk

/** Protocol 0.1 remains readable; 0.2 is the latest native renderer contract. */
const val MOSAIC_PROTOCOL_VERSION: String = "0.1"
const val MOSAIC_PROTOCOL_VERSION_V02: String = "0.2"
const val MOSAIC_LATEST_PROTOCOL_VERSION: String = MOSAIC_PROTOCOL_VERSION_V02
const val MOSAIC_ANDROID_SDK_VERSION: String = "0.2.0-dev.1"

val MOSAIC_SUPPORTED_PROTOCOL_VERSIONS: Set<String> = setOf(
    MOSAIC_PROTOCOL_VERSION,
    MOSAIC_PROTOCOL_VERSION_V02,
)

enum class MosaicCapabilityName(val wireName: String) {
    SCROLL_CONTAINER("layout.scrollContainer"),
    VERTICAL_STACK("layout.verticalStack"),
    STACK("layout.stack"),
    SIZING("layout.sizing"),
    OUTER_INSETS("layout.outerInsets"),
    TEXT("component.text"),
    IMAGE("component.image"),
    FEATURE_LIST("component.featureList"),
    PRODUCT_SELECTOR("component.productSelector"),
    PURCHASE_BUTTON("component.purchaseButton"),
    RESTORE_BUTTON("component.restoreButton"),
    CLOSE_BUTTON("component.closeButton"),
    LEGAL_TEXT("component.legalText"),
    CAROUSEL("component.carousel"),
    SWITCH("component.switch"),
    COUNTDOWN("component.countdown"),
    LOCALIZATION_CATALOGS("localization.catalogs"),
    LOCALIZATION_RTL("localization.rtl"),
    PRODUCT_REFERENCES("product.references"),
    BUNDLED_IMAGE("asset.bundledImage"),
    PURCHASE_ACTION("action.purchase"),
    RESTORE_ACTION("action.restore"),
    CLOSE_ACTION("action.close"),
    ACCESSIBILITY_METADATA("accessibility.metadata"),
    ASSET_FALLBACK("fallback.asset"),
    PRODUCT_FALLBACK("fallback.product"),
    NORMALIZED_OUTCOME("outcome.normalized"),
    COLORS("style.colors"),
    BOX_STYLE("style.box"),
    CLIPPING("style.clipping"),
    TYPOGRAPHY("style.typography"),
    PRODUCT_CARD_STATES("style.productCardStates"),
    STATIC_VISIBILITY("visibility.static"),
    SWITCH_VISIBILITY("condition.switchVisibility"),
}

object MosaicCapabilityCatalog {
    val v01: Set<MosaicCapabilityName> = setOf(
        MosaicCapabilityName.SCROLL_CONTAINER,
        MosaicCapabilityName.VERTICAL_STACK,
        MosaicCapabilityName.TEXT,
        MosaicCapabilityName.IMAGE,
        MosaicCapabilityName.FEATURE_LIST,
        MosaicCapabilityName.PRODUCT_SELECTOR,
        MosaicCapabilityName.PURCHASE_BUTTON,
        MosaicCapabilityName.RESTORE_BUTTON,
        MosaicCapabilityName.CLOSE_BUTTON,
        MosaicCapabilityName.LEGAL_TEXT,
        MosaicCapabilityName.LOCALIZATION_CATALOGS,
        MosaicCapabilityName.LOCALIZATION_RTL,
        MosaicCapabilityName.PRODUCT_REFERENCES,
        MosaicCapabilityName.BUNDLED_IMAGE,
        MosaicCapabilityName.PURCHASE_ACTION,
        MosaicCapabilityName.RESTORE_ACTION,
        MosaicCapabilityName.CLOSE_ACTION,
        MosaicCapabilityName.ACCESSIBILITY_METADATA,
        MosaicCapabilityName.ASSET_FALLBACK,
        MosaicCapabilityName.PRODUCT_FALLBACK,
        MosaicCapabilityName.NORMALIZED_OUTCOME,
    )

    val v02: Set<MosaicCapabilityName> = setOf(
        MosaicCapabilityName.SCROLL_CONTAINER,
        MosaicCapabilityName.STACK,
        MosaicCapabilityName.SIZING,
        MosaicCapabilityName.OUTER_INSETS,
        MosaicCapabilityName.TEXT,
        MosaicCapabilityName.IMAGE,
        MosaicCapabilityName.FEATURE_LIST,
        MosaicCapabilityName.PRODUCT_SELECTOR,
        MosaicCapabilityName.PURCHASE_BUTTON,
        MosaicCapabilityName.RESTORE_BUTTON,
        MosaicCapabilityName.CLOSE_BUTTON,
        MosaicCapabilityName.LEGAL_TEXT,
        MosaicCapabilityName.CAROUSEL,
        MosaicCapabilityName.SWITCH,
        MosaicCapabilityName.COUNTDOWN,
        MosaicCapabilityName.LOCALIZATION_CATALOGS,
        MosaicCapabilityName.LOCALIZATION_RTL,
        MosaicCapabilityName.PRODUCT_REFERENCES,
        MosaicCapabilityName.BUNDLED_IMAGE,
        MosaicCapabilityName.PURCHASE_ACTION,
        MosaicCapabilityName.RESTORE_ACTION,
        MosaicCapabilityName.CLOSE_ACTION,
        MosaicCapabilityName.ACCESSIBILITY_METADATA,
        MosaicCapabilityName.ASSET_FALLBACK,
        MosaicCapabilityName.PRODUCT_FALLBACK,
        MosaicCapabilityName.NORMALIZED_OUTCOME,
        MosaicCapabilityName.COLORS,
        MosaicCapabilityName.BOX_STYLE,
        MosaicCapabilityName.CLIPPING,
        MosaicCapabilityName.TYPOGRAPHY,
        MosaicCapabilityName.PRODUCT_CARD_STATES,
        MosaicCapabilityName.STATIC_VISIBILITY,
        MosaicCapabilityName.SWITCH_VISIBILITY,
    )
}

data class MosaicCapabilityReport(
    val sdkVersion: String,
    val supportedSchemaVersions: Set<String>,
    /** Highest supported version per capability, retained for source compatibility. */
    val supportedCapabilities: Map<MosaicCapabilityName, String>,
    /** Exact supported name/version pairs, including shared 0.1 and 0.2 capabilities. */
    val supportedCapabilityVersions: Set<MosaicRequiredCapability> = supportedCapabilities
        .mapTo(mutableSetOf()) { (name, version) -> MosaicRequiredCapability(name, version) },
) {
    fun supports(capability: MosaicRequiredCapability): Boolean =
        capability.name in supportedCapabilities && capability in supportedCapabilityVersions
}

object MosaicProtocolCapabilities {
    fun report(sdkVersion: String = MOSAIC_ANDROID_SDK_VERSION): MosaicCapabilityReport {
        val exact = buildSet {
            MosaicCapabilityCatalog.v01.forEach {
                add(MosaicRequiredCapability(it, MOSAIC_PROTOCOL_VERSION))
            }
            MosaicCapabilityCatalog.v02.forEach {
                add(MosaicRequiredCapability(it, MOSAIC_PROTOCOL_VERSION_V02))
            }
        }
        val highest = MosaicCapabilityName.entries.associateWith { capability ->
            if (capability in MosaicCapabilityCatalog.v02) {
                MOSAIC_PROTOCOL_VERSION_V02
            } else {
                MOSAIC_PROTOCOL_VERSION
            }
        }
        return MosaicCapabilityReport(
            sdkVersion = sdkVersion,
            supportedSchemaVersions = MOSAIC_SUPPORTED_PROTOCOL_VERSIONS,
            supportedCapabilities = highest,
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
    val assets: List<MosaicImageAsset>,
    val products: List<MosaicProductReference>,
    val layout: MosaicScrollContainer,
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

data class MosaicImageAsset(
    val id: String,
    val sourceKey: String,
    val placeholder: MosaicLocalizedText,
)

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
    val background: MosaicColor? = null,
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
    override val type: String = "stack",
) : MosaicNode {
    val spacing: Double get() = gap
    val horizontalAlignment: MosaicHorizontalAlignment get() = crossAxisAlignment
}

typealias MosaicVerticalStack = MosaicStack

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
    val background: MosaicColor? = null,
    val border: MosaicBorder? = null,
    val cornerRadius: Double? = null,
    val opacity: Double? = null,
    val padding: MosaicEdgeInsets? = null,
    val clipContent: Boolean? = null,
)

sealed interface MosaicWidthSizing {
    data object Content : MosaicWidthSizing
    data object Fill : MosaicWidthSizing
    data class Fixed(val value: Double) : MosaicWidthSizing
}

sealed interface MosaicHeightSizing {
    data object Content : MosaicHeightSizing
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
) {
    companion object {
        fun legacy(
            style: MosaicTypographyStyle,
            alignment: MosaicTextAlignment,
        ): MosaicTypography = when (style) {
            MosaicTypographyStyle.DISPLAY -> MosaicTypography(
                style, 40.0, 1.1, MosaicFontWeight.BOLD,
                MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY), alignment,
            )
            MosaicTypographyStyle.TITLE -> MosaicTypography(
                style, 34.0, 1.18, MosaicFontWeight.BOLD,
                MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY), alignment,
            )
            MosaicTypographyStyle.HEADING -> MosaicTypography(
                style, 22.0, 1.25, MosaicFontWeight.SEMIBOLD,
                MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY), alignment,
            )
            MosaicTypographyStyle.BODY -> MosaicTypography(
                style, 17.0, 1.35, MosaicFontWeight.REGULAR,
                MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY), alignment,
            )
            MosaicTypographyStyle.LABEL -> MosaicTypography(
                style, 16.0, 1.25, MosaicFontWeight.SEMIBOLD,
                MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY), alignment,
            )
            MosaicTypographyStyle.CAPTION -> MosaicTypography(
                style, 13.0, 1.3, MosaicFontWeight.REGULAR,
                MosaicColor.semantic(MosaicSemanticColor.TEXT_SECONDARY), alignment,
            )
        }
    }
}

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
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
) : MosaicNode {
    override val type: String = "image"
}

data class MosaicFeatureListItem(
    val id: String,
    val text: MosaicLocalizedText,
)

enum class MosaicFeatureMarker { CHECKMARK }

data class MosaicFeatureListComponent(
    override val id: String,
    val marker: MosaicFeatureMarker,
    val gap: Double,
    val markerColor: MosaicColor,
    val items: List<MosaicFeatureListItem>,
    val typography: MosaicTypography,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
) : MosaicNode {
    override val type: String = "featureList"
    val itemSpacing: Double get() = gap
}

enum class MosaicUnavailableProductSelection { FIRST_AVAILABLE }
enum class MosaicNoAvailableProductBehavior { SHOW_MESSAGE_AND_DISABLE_PURCHASE }

data class MosaicUnavailableProductFallback(
    val message: MosaicLocalizedText,
    val selection: MosaicUnavailableProductSelection = MosaicUnavailableProductSelection.FIRST_AVAILABLE,
    val whenNoneAvailable: MosaicNoAvailableProductBehavior =
        MosaicNoAvailableProductBehavior.SHOW_MESSAGE_AND_DISABLE_PURCHASE,
)

enum class MosaicProductCardContentAlignment { START, CENTER, END, SPACE_BETWEEN }

data class MosaicProductCardBadgeStyle(
    val background: MosaicColor,
    val textColor: MosaicColor,
    val border: MosaicBorder,
    val cornerRadius: Double,
    val padding: MosaicEdgeInsets,
)

data class MosaicProductCardBadgeStyleOverride(
    val background: MosaicColor? = null,
    val textColor: MosaicColor? = null,
    val border: MosaicBorderOverride? = null,
    val cornerRadius: Double? = null,
    val padding: MosaicEdgeInsetsOverride? = null,
) {
    fun resolve(base: MosaicProductCardBadgeStyle): MosaicProductCardBadgeStyle =
        MosaicProductCardBadgeStyle(
            background = background ?: base.background,
            textColor = textColor ?: base.textColor,
            border = border?.resolve(base.border) ?: base.border,
            cornerRadius = cornerRadius ?: base.cornerRadius,
            padding = padding?.resolve(base.padding) ?: base.padding,
        )
}

data class MosaicProductCardStyle(
    val background: MosaicColor,
    val border: MosaicBorder,
    val cornerRadius: Double,
    val padding: MosaicEdgeInsets,
    val contentGap: Double,
    val contentAlignment: MosaicProductCardContentAlignment,
    val productLabelColor: MosaicColor,
    val runtimePriceColor: MosaicColor,
    val badge: MosaicProductCardBadgeStyle,
) {
    companion object {
        val Legacy = MosaicProductCardStyle(
            background = MosaicColor.semantic(MosaicSemanticColor.SURFACE_ELEVATED),
            border = MosaicBorder(MosaicColor.semantic(MosaicSemanticColor.BORDER_DEFAULT), 1.0),
            cornerRadius = 14.0,
            padding = MosaicEdgeInsets(14.0, 14.0, 14.0, 14.0),
            contentGap = 12.0,
            contentAlignment = MosaicProductCardContentAlignment.SPACE_BETWEEN,
            productLabelColor = MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY),
            runtimePriceColor = MosaicColor.semantic(MosaicSemanticColor.TEXT_PRIMARY),
            badge = MosaicProductCardBadgeStyle(
                background = MosaicColor.semantic(MosaicSemanticColor.SURFACE_DEFAULT),
                textColor = MosaicColor.semantic(MosaicSemanticColor.ACTION_PRIMARY),
                border = MosaicBorder(MosaicColor.semantic(MosaicSemanticColor.BORDER_DEFAULT), 0.0),
                cornerRadius = 999.0,
                padding = MosaicEdgeInsets(3.0, 7.0, 3.0, 7.0),
            ),
        )
    }
}

data class MosaicProductCardStyleOverride(
    val background: MosaicColor? = null,
    val border: MosaicBorderOverride? = null,
    val cornerRadius: Double? = null,
    val padding: MosaicEdgeInsetsOverride? = null,
    val contentGap: Double? = null,
    val contentAlignment: MosaicProductCardContentAlignment? = null,
    val productLabelColor: MosaicColor? = null,
    val runtimePriceColor: MosaicColor? = null,
    val badge: MosaicProductCardBadgeStyleOverride? = null,
) {
    fun resolve(base: MosaicProductCardStyle): MosaicProductCardStyle = MosaicProductCardStyle(
        background = background ?: base.background,
        border = border?.resolve(base.border) ?: base.border,
        cornerRadius = cornerRadius ?: base.cornerRadius,
        padding = padding?.resolve(base.padding) ?: base.padding,
        contentGap = contentGap ?: base.contentGap,
        contentAlignment = contentAlignment ?: base.contentAlignment,
        productLabelColor = productLabelColor ?: base.productLabelColor,
        runtimePriceColor = runtimePriceColor ?: base.runtimePriceColor,
        badge = badge?.resolve(base.badge) ?: base.badge,
    )
}

data class MosaicProductCardStyles(
    val defaultStyle: MosaicProductCardStyle,
    val selected: MosaicProductCardStyleOverride,
) {
    fun resolve(selected: Boolean): MosaicProductCardStyle =
        if (selected) this.selected.resolve(defaultStyle) else defaultStyle

    companion object {
        val Legacy = MosaicProductCardStyles(
            defaultStyle = MosaicProductCardStyle.Legacy,
            selected = MosaicProductCardStyleOverride(
                background = MosaicColor.semantic(MosaicSemanticColor.SURFACE_DEFAULT),
                border = MosaicBorderOverride(
                    color = MosaicColor.semantic(MosaicSemanticColor.ACTION_PRIMARY),
                    width = 2.0,
                ),
            ),
        )
    }
}

data class MosaicProductSelectorComponent(
    override val id: String,
    val productReferenceIds: List<String>,
    val initiallySelectedProductReferenceId: String,
    val direction: MosaicStackDirection,
    val gap: Double,
    val cardStyles: MosaicProductCardStyles,
    val unavailableFallback: MosaicUnavailableProductFallback,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
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

data class MosaicPurchaseButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val inProgressLabel: MosaicLocalizedText,
    val typography: MosaicTypography,
    val action: MosaicPurchaseAction,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
) : MosaicNode { override val type: String = "purchaseButton" }

data class MosaicRestoreButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val inProgressLabel: MosaicLocalizedText,
    val typography: MosaicTypography,
    val action: MosaicRestoreAction,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
) : MosaicNode { override val type: String = "restoreButton" }

data class MosaicCloseButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val typography: MosaicTypography,
    val action: MosaicCloseAction,
    val accessibility: MosaicControlAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
) : MosaicNode { override val type: String = "closeButton" }

data class MosaicLegalTextComponent(
    override val id: String,
    val value: MosaicLocalizedText,
    val typography: MosaicTypography,
    val accessibility: MosaicTextAccessibility,
    val appearance: MosaicBoxAppearance? = null,
    val sizing: MosaicBoxSizing? = null,
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
) : MosaicNode {
    override val type: String = "legalText"
    val alignment: MosaicTextAlignment get() = typography.alignment
}

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
    val outerInsets: MosaicEdgeInsets? = null,
    val visibility: MosaicVisibility = MosaicVisibility.Always,
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
) : MosaicNode { override val type: String = "countdown" }

internal fun MosaicStack.walkDepthFirst(): Sequence<MosaicNode> = sequence {
    yield(this@walkDepthFirst)
    children.forEach { child ->
        when (child) {
            is MosaicStack -> yieldAll(child.walkDepthFirst())
            is MosaicCarouselComponent -> {
                yield(child)
                child.pages.forEach { page -> yieldAll(page.content.walkDepthFirst()) }
            }
            else -> yield(child)
        }
    }
}
