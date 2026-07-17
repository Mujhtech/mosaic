package dev.mosaic.sdk

const val MOSAIC_PROTOCOL_VERSION: String = "0.1"
const val MOSAIC_ANDROID_SDK_VERSION: String = "0.1.0-dev.3"

enum class MosaicCapabilityName(val wireName: String) {
    SCROLL_CONTAINER("layout.scrollContainer"),
    VERTICAL_STACK("layout.verticalStack"),
    TEXT("component.text"),
    IMAGE("component.image"),
    FEATURE_LIST("component.featureList"),
    PRODUCT_SELECTOR("component.productSelector"),
    PURCHASE_BUTTON("component.purchaseButton"),
    RESTORE_BUTTON("component.restoreButton"),
    CLOSE_BUTTON("component.closeButton"),
    LEGAL_TEXT("component.legalText"),
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
}

data class MosaicCapabilityReport(
    val sdkVersion: String,
    val supportedSchemaVersions: Set<String>,
    val supportedCapabilities: Map<MosaicCapabilityName, String>,
)

object MosaicProtocolCapabilities {
    fun report(sdkVersion: String = MOSAIC_ANDROID_SDK_VERSION): MosaicCapabilityReport =
        MosaicCapabilityReport(
            sdkVersion = sdkVersion,
            supportedSchemaVersions = setOf(MOSAIC_PROTOCOL_VERSION),
            supportedCapabilities = MosaicCapabilityName.entries.associateWith {
                MOSAIC_PROTOCOL_VERSION
            },
        )
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

enum class MosaicLayoutDirection {
    LTR,
    RTL,
}

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
    val content: MosaicVerticalStack,
)

data class MosaicEdgeInsets(
    val top: Double,
    val start: Double,
    val bottom: Double,
    val end: Double,
)

enum class MosaicHorizontalAlignment {
    START,
    CENTER,
    END,
    STRETCH,
}

enum class MosaicTextAlignment {
    START,
    CENTER,
    END,
}

enum class MosaicTextStyle {
    TITLE,
    BODY,
    CAPTION,
}

sealed interface MosaicNode {
    val id: String
    val type: String
}

data class MosaicVerticalStack(
    override val id: String,
    val spacing: Double,
    val padding: MosaicEdgeInsets,
    val horizontalAlignment: MosaicHorizontalAlignment,
    val children: List<MosaicNode>,
) : MosaicNode {
    override val type: String = "verticalStack"
}

sealed interface MosaicTextAccessibility {
    data object Text : MosaicTextAccessibility

    data class Heading(val level: Int) : MosaicTextAccessibility
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
    val style: MosaicTextStyle,
    val alignment: MosaicTextAlignment,
    val accessibility: MosaicTextAccessibility,
) : MosaicNode {
    override val type: String = "text"
}

enum class MosaicImageContentMode {
    FIT,
    FILL,
}

data class MosaicImageComponent(
    override val id: String,
    val assetId: String,
    val aspectRatio: Double,
    val contentMode: MosaicImageContentMode,
    val accessibility: MosaicImageAccessibility,
) : MosaicNode {
    override val type: String = "image"
}

data class MosaicFeatureListItem(
    val id: String,
    val text: MosaicLocalizedText,
)

data class MosaicFeatureListComponent(
    override val id: String,
    val itemSpacing: Double,
    val items: List<MosaicFeatureListItem>,
    val accessibility: MosaicControlAccessibility,
) : MosaicNode {
    override val type: String = "featureList"
}

data class MosaicUnavailableProductFallback(
    val message: MosaicLocalizedText,
)

data class MosaicProductSelectorComponent(
    override val id: String,
    val productReferenceIds: List<String>,
    val initiallySelectedProductReferenceId: String,
    val itemSpacing: Double,
    val unavailableFallback: MosaicUnavailableProductFallback,
    val accessibility: MosaicControlAccessibility,
) : MosaicNode {
    override val type: String = "productSelector"
}

sealed interface MosaicAction {
    val type: String
}

data class MosaicPurchaseAction(val productSelectorId: String) : MosaicAction {
    override val type: String = "purchase"
}

data object MosaicRestoreAction : MosaicAction {
    override val type: String = "restore"
}

data object MosaicCloseAction : MosaicAction {
    override val type: String = "close"
}

data class MosaicPurchaseButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val inProgressLabel: MosaicLocalizedText,
    val action: MosaicPurchaseAction,
    val accessibility: MosaicControlAccessibility,
) : MosaicNode {
    override val type: String = "purchaseButton"
}

data class MosaicRestoreButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val inProgressLabel: MosaicLocalizedText,
    val action: MosaicRestoreAction,
    val accessibility: MosaicControlAccessibility,
) : MosaicNode {
    override val type: String = "restoreButton"
}

data class MosaicCloseButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
    val action: MosaicCloseAction,
    val accessibility: MosaicControlAccessibility,
) : MosaicNode {
    override val type: String = "closeButton"
}

data class MosaicLegalTextComponent(
    override val id: String,
    val value: MosaicLocalizedText,
    val alignment: MosaicTextAlignment,
    val accessibility: MosaicTextAccessibility,
) : MosaicNode {
    override val type: String = "legalText"
}

internal fun MosaicVerticalStack.walkDepthFirst(): Sequence<MosaicNode> = sequence {
    yield(this@walkDepthFirst)
    children.forEach { child ->
        if (child is MosaicVerticalStack) {
            yieldAll(child.walkDepthFirst())
        } else {
            yield(child)
        }
    }
}
