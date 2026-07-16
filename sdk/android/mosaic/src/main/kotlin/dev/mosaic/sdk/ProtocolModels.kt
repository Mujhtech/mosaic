package dev.mosaic.sdk

const val MOSAIC_PROTOCOL_VERSION: String = "0.1"

enum class MosaicCapabilityName(val wireName: String) {
    VERTICAL_LAYOUT("layout.vertical"),
    TEXT("component.text"),
    FEATURE_LIST("component.featureList"),
    PRODUCT_SELECTOR("component.productSelector"),
    PURCHASE_BUTTON("component.purchaseButton"),
    RESTORE_BUTTON("component.restoreButton"),
    CLOSE_BUTTON("component.closeButton"),
    LEGAL_TEXT("component.legalText"),
}

data class MosaicPaywallDocument(
    val schemaVersion: String,
    val id: String,
    val revision: Int,
    val compatibility: MosaicDocumentCompatibility,
    val layout: MosaicVerticalLayout,
)

data class MosaicDocumentCompatibility(
    val requiredCapabilities: List<MosaicRequiredCapability>,
)

data class MosaicRequiredCapability(
    val name: MosaicCapabilityName,
    val version: String,
)

data class MosaicVerticalLayout(
    val id: String,
    val gap: Double,
    val padding: Double,
    val children: List<MosaicComponent>,
)

sealed interface MosaicComponent {
    val id: String
    val type: String
}

data class MosaicTextComponent(
    override val id: String,
    val value: MosaicLocalizedText,
) : MosaicComponent {
    override val type: String = "text"
}

data class MosaicFeatureListComponent(
    override val id: String,
    val items: List<MosaicFeatureListItem>,
) : MosaicComponent {
    override val type: String = "featureList"
}

data class MosaicProductSelectorComponent(
    override val id: String,
    val products: List<MosaicProductReference>,
    val initiallySelectedProductId: String,
) : MosaicComponent {
    override val type: String = "productSelector"
}

data class MosaicPurchaseButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
) : MosaicComponent {
    override val type: String = "purchaseButton"
}

data class MosaicRestoreButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
) : MosaicComponent {
    override val type: String = "restoreButton"
}

data class MosaicCloseButtonComponent(
    override val id: String,
    val label: MosaicLocalizedText,
) : MosaicComponent {
    override val type: String = "closeButton"
}

data class MosaicLegalTextComponent(
    override val id: String,
    val value: MosaicLocalizedText,
) : MosaicComponent {
    override val type: String = "legalText"
}

data class MosaicLocalizedText(
    val defaultValue: String,
    val localizationKey: String,
)

data class MosaicFeatureListItem(
    val id: String,
    val text: MosaicLocalizedText,
)

data class MosaicProductReference(val productId: String)
