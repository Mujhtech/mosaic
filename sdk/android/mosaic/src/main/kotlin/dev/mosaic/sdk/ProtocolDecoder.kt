package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal

/**
 * Strict, hand-written reader for Mosaic Protocol 0.1 and dispatcher for Protocol 0.2.
 *
 * JSON Schema remains canonical in `protocol/`; this SDK deliberately does not maintain a schema
 * copy. The reader mirrors RC1's closed wire contract and enforces its cross-field semantics before
 * returning a renderable document.
 */
object MosaicProtocolDecoder {
    private val identifierPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
    private val localizationKeyPattern = Regex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$")
    private val localeTagPattern = Regex("^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
    private val providerProductIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    private val bundledAssetKeyPattern = Regex("^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
    private val capabilitiesByWireName = MosaicCapabilityName.entries.associateBy { it.wireName }

    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    ): MosaicPaywallDocument {
        val root = try {
            JsonParser.parseString(source).objectAt("$")
        } catch (error: MosaicProtocolException) {
            throw error
        } catch (error: JsonParseException) {
            throw MosaicProtocolException("Invalid JSON.", error)
        } catch (error: IllegalStateException) {
            throw MosaicProtocolException("Invalid JSON document shape.", error)
        }

        val schemaVersion = root.requiredString("schemaVersion", "$.schemaVersion")
        if (schemaVersion == MOSAIC_PROTOCOL_VERSION_V02) {
            if (schemaVersion !in capabilityReport.supportedSchemaVersions) {
                throw MosaicProtocolException(
                    "Unsupported schemaVersion $schemaVersion at $.schemaVersion.",
                )
            }
            return MosaicProtocolV02Decoder.decode(source, capabilityReport)
        }
        if (schemaVersion != MOSAIC_PROTOCOL_VERSION || schemaVersion !in capabilityReport.supportedSchemaVersions) {
            throw MosaicProtocolException(
                "Unsupported schemaVersion $schemaVersion at $.schemaVersion.",
            )
        }
        root.expectKeys(
            setOf(
                "schemaVersion",
                "id",
                "revision",
                "compatibility",
                "localization",
                "assets",
                "products",
                "layout",
            ),
            "$",
        )

        val document = MosaicPaywallDocument(
            schemaVersion = schemaVersion,
            id = root.requiredIdentifier("id", "$.id"),
            revision = root.requiredPositiveInteger("revision", "$.revision"),
            compatibility = compatibility(
                root.required("compatibility", "$"),
                capabilityReport,
            ),
            localization = localization(root.required("localization", "$")),
            assets = root.required("assets", "$").arrayAt("$.assets").mapIndexed { index, value ->
                imageAsset(value, "$.assets[$index]")
            },
            products = root.required("products", "$").arrayAt("$.products").mapIndexed { index, value ->
                productReference(value, "$.products[$index]")
            },
            layout = scrollContainer(root.required("layout", "$"), "$.layout"),
        )
        validateDocumentSemantics(document, capabilityReport)
        return document
    }

    private fun compatibility(
        value: JsonElement,
        capabilityReport: MosaicCapabilityReport,
    ): MosaicDocumentCompatibility {
        val path = "$.compatibility"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("requiredCapabilities"), path)
        val entries = objectValue.required("requiredCapabilities", path)
            .nonEmptyArrayAt("$path.requiredCapabilities")
        val seen = mutableSetOf<MosaicCapabilityName>()
        val capabilities = entries.mapIndexed { index, element ->
            val capabilityPath = "$path.requiredCapabilities[$index]"
            val capability = element.objectAt(capabilityPath)
            capability.expectKeys(setOf("name", "version"), capabilityPath)
            val wireName = capability.requiredString("name", "$capabilityPath.name")
            val version = capability.requiredString("version", "$capabilityPath.version")
            val name = capabilitiesByWireName[wireName]
                ?: throw MosaicProtocolException(
                    "Unsupported capability $wireName@$version at $capabilityPath.",
                )
            val required = MosaicRequiredCapability(name, version)
            if (version != MOSAIC_PROTOCOL_VERSION || !capabilityReport.supports(required)) {
                throw MosaicProtocolException(
                    "Unsupported capability $wireName@$version at $capabilityPath.",
                )
            }
            if (!seen.add(name)) {
                throw MosaicProtocolException(
                    "Duplicate capability $wireName@$version at $capabilityPath.",
                )
            }
            required
        }
        return MosaicDocumentCompatibility(capabilities)
    }

    private fun localization(value: JsonElement): MosaicLocalization {
        val path = "$.localization"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("defaultLocale", "fallbackLocale", "locales"), path)
        val localeObject = objectValue.required("locales", path).objectAt("$path.locales")
        if (localeObject.size() == 0) {
            throw MosaicProtocolException("Expected at least one locale at $path.locales.")
        }
        val locales = buildMap {
            localeObject.entrySet().forEach { (tag, catalogElement) ->
                validateLocaleTag(tag, "$path.locales")
                put(tag, localeCatalog(catalogElement, "$path.locales.$tag"))
            }
        }
        return MosaicLocalization(
            defaultLocale = objectValue.requiredLocaleTag("defaultLocale", "$path.defaultLocale"),
            fallbackLocale = objectValue.requiredLocaleTag("fallbackLocale", "$path.fallbackLocale"),
            locales = locales,
        )
    }

    private fun localeCatalog(value: JsonElement, path: String): MosaicLocaleCatalog {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("direction", "strings"), path)
        val direction = when (objectValue.requiredString("direction", "$path.direction")) {
            "ltr" -> MosaicLayoutDirection.LTR
            "rtl" -> MosaicLayoutDirection.RTL
            else -> throw MosaicProtocolException("Invalid layout direction at $path.direction.")
        }
        val stringsObject = objectValue.required("strings", path).objectAt("$path.strings")
        if (stringsObject.size() == 0) {
            throw MosaicProtocolException("Expected at least one localized string at $path.strings.")
        }
        val strings = buildMap {
            stringsObject.entrySet().forEach { (key, stringElement) ->
                validateLocalizationKey(key, "$path.strings")
                put(key, stringElement.stringAt("$path.strings.$key", minLength = 1, maxLength = 5000))
            }
        }
        return MosaicLocaleCatalog(direction, strings)
    }

    private fun imageAsset(value: JsonElement, path: String): MosaicImageAsset {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type", "id", "source", "fallback"), path)
        objectValue.requireConstant("type", "image", "$path.type")

        val sourcePath = "$path.source"
        val source = objectValue.required("source", path).objectAt(sourcePath)
        source.expectKeys(setOf("type", "key"), sourcePath)
        source.requireConstant("type", "bundled", "$sourcePath.type")
        val key = source.requiredString("key", "$sourcePath.key").also {
            if (it.codePointLength() !in 1..256 || !bundledAssetKeyPattern.matches(it)) {
                throw MosaicProtocolException("Invalid bundled asset key $it at $sourcePath.key.")
            }
        }

        val fallbackPath = "$path.fallback"
        val fallback = objectValue.required("fallback", path).objectAt(fallbackPath)
        fallback.expectKeys(setOf("type", "value"), fallbackPath)
        fallback.requireConstant("type", "placeholder", "$fallbackPath.type")
        return MosaicImageAsset(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            sourceKey = key,
            placeholder = localizedText(fallback.required("value", fallbackPath), "$fallbackPath.value"),
        )
    }

    private fun productReference(value: JsonElement, path: String): MosaicProductReference {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("id", "productId", "label", "badge"), path, optional = setOf("badge"))
        val providerProductId = objectValue.requiredString("productId", "$path.productId").also {
            if (it.codePointLength() !in 1..256 || !providerProductIdPattern.matches(it)) {
                throw MosaicProtocolException("Invalid provider product ID $it at $path.productId.")
            }
        }
        return MosaicProductReference(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            providerProductId = providerProductId,
            label = localizedText(objectValue.required("label", path), "$path.label"),
            badge = objectValue.optional("badge")?.let { localizedText(it, "$path.badge") },
        )
    }

    private fun scrollContainer(value: JsonElement, path: String): MosaicScrollContainer {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("type", "id", "axis", "safeArea", "showsIndicators", "content"),
            path,
        )
        objectValue.requireConstant("type", "scrollContainer", "$path.type")
        objectValue.requireConstant("axis", "vertical", "$path.axis")
        objectValue.requireConstant("safeArea", "respect", "$path.safeArea")
        return MosaicScrollContainer(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            showsIndicators = objectValue.requiredBoolean("showsIndicators", "$path.showsIndicators"),
            content = verticalStack(objectValue.required("content", path), "$path.content"),
        )
    }

    private fun verticalStack(value: JsonElement, path: String): MosaicVerticalStack {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("type", "id", "spacing", "padding", "horizontalAlignment", "children"),
            path,
        )
        objectValue.requireConstant("type", "verticalStack", "$path.type")
        val children = objectValue.required("children", path).nonEmptyArrayAt("$path.children")
        return MosaicVerticalStack(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            direction = MosaicStackDirection.VERTICAL,
            gap = objectValue.requiredLogicalSize("spacing", "$path.spacing"),
            padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
            mainAxisDistribution = MosaicMainAxisDistribution.START,
            crossAxisAlignment = when (
                objectValue.requiredString("horizontalAlignment", "$path.horizontalAlignment")
            ) {
                "start" -> MosaicHorizontalAlignment.START
                "center" -> MosaicHorizontalAlignment.CENTER
                "end" -> MosaicHorizontalAlignment.END
                "stretch" -> MosaicHorizontalAlignment.STRETCH
                else -> throw MosaicProtocolException(
                    "Invalid horizontal alignment at $path.horizontalAlignment.",
                )
            },
            children = children.mapIndexed { index, child -> node(child, "$path.children[$index]") },
            type = "verticalStack",
        )
    }

    private fun edgeInsets(value: JsonElement, path: String): MosaicEdgeInsets {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("top", "start", "bottom", "end"), path)
        return MosaicEdgeInsets(
            top = objectValue.requiredLogicalSize("top", "$path.top"),
            start = objectValue.requiredLogicalSize("start", "$path.start"),
            bottom = objectValue.requiredLogicalSize("bottom", "$path.bottom"),
            end = objectValue.requiredLogicalSize("end", "$path.end"),
        )
    }

    private fun node(value: JsonElement, path: String): MosaicNode {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "verticalStack" -> verticalStack(value, path)
            "text" -> textComponent(objectValue, path)
            "image" -> imageComponent(objectValue, path)
            "featureList" -> featureListComponent(objectValue, path)
            "productSelector" -> productSelectorComponent(objectValue, path)
            "purchaseButton" -> purchaseButtonComponent(objectValue, path)
            "restoreButton" -> restoreButtonComponent(objectValue, path)
            "closeButton" -> closeButtonComponent(objectValue, path)
            "legalText" -> legalTextComponent(objectValue, path)
            else -> throw MosaicProtocolException("Unsupported component at $path.type.")
        }
    }

    private fun textComponent(objectValue: JsonObject, path: String): MosaicTextComponent {
        objectValue.expectKeys(setOf("type", "id", "value", "style", "alignment", "accessibility"), path)
        return MosaicTextComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            value = localizedText(objectValue.required("value", path), "$path.value"),
            typography = MosaicTypography.legacy(
                style = when (objectValue.requiredString("style", "$path.style")) {
                "title" -> MosaicTextStyle.TITLE
                "body" -> MosaicTextStyle.BODY
                "caption" -> MosaicTextStyle.CAPTION
                else -> throw MosaicProtocolException("Invalid text style at $path.style.")
                },
                alignment = textAlignment(objectValue, "alignment", "$path.alignment"),
            ),
            accessibility = textAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun imageComponent(objectValue: JsonObject, path: String): MosaicImageComponent {
        objectValue.expectKeys(
            setOf("type", "id", "assetId", "width", "aspectRatio", "contentMode", "accessibility"),
            path,
        )
        objectValue.requireConstant("width", "fill", "$path.width")
        return MosaicImageComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            assetId = objectValue.requiredIdentifier("assetId", "$path.assetId"),
            width = MosaicWidthSizing.Fill,
            aspectRatio = objectValue.requiredNumber(
                "aspectRatio",
                "$path.aspectRatio",
                minimum = BigDecimal.ZERO,
                maximum = BigDecimal.TEN,
                exclusiveMinimum = true,
            ),
            height = null,
            contentMode = when (objectValue.requiredString("contentMode", "$path.contentMode")) {
                "fit" -> MosaicImageContentMode.FIT
                "fill" -> MosaicImageContentMode.FILL
                else -> throw MosaicProtocolException("Invalid image content mode at $path.contentMode.")
            },
            accessibility = imageAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun featureListComponent(objectValue: JsonObject, path: String): MosaicFeatureListComponent {
        objectValue.expectKeys(
            setOf("type", "id", "marker", "itemSpacing", "items", "accessibility"),
            path,
        )
        objectValue.requireConstant("marker", "checkmark", "$path.marker")
        val items = objectValue.required("items", path).nonEmptyArrayAt("$path.items")
        return MosaicFeatureListComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            marker = MosaicFeatureMarker.CHECKMARK,
            gap = objectValue.requiredLogicalSize("itemSpacing", "$path.itemSpacing"),
            markerColor = MosaicColor.semantic(MosaicSemanticColor.ACTION_PRIMARY),
            items = items.mapIndexed { index, item -> featureListItem(item, "$path.items[$index]") },
            typography = MosaicTypography.legacy(
                MosaicTypographyStyle.BODY,
                MosaicTextAlignment.START,
            ),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun featureListItem(value: JsonElement, path: String): MosaicFeatureListItem {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("id", "text"), path)
        return MosaicFeatureListItem(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            text = localizedText(objectValue.required("text", path), "$path.text"),
        )
    }

    private fun productSelectorComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicProductSelectorComponent {
        objectValue.expectKeys(
            setOf(
                "type",
                "id",
                "productReferenceIds",
                "initiallySelectedProductReferenceId",
                "itemSpacing",
                "unavailableFallback",
                "accessibility",
            ),
            path,
        )
        val productIds = objectValue.required("productReferenceIds", path)
            .nonEmptyArrayAt("$path.productReferenceIds")
            .mapIndexed { index, element ->
                element.identifierAt("$path.productReferenceIds[$index]")
            }
        val fallbackPath = "$path.unavailableFallback"
        val fallback = objectValue.required("unavailableFallback", path).objectAt(fallbackPath)
        fallback.expectKeys(setOf("selection", "whenNoneAvailable", "message"), fallbackPath)
        fallback.requireConstant("selection", "firstAvailable", "$fallbackPath.selection")
        fallback.requireConstant(
            "whenNoneAvailable",
            "showMessageAndDisablePurchase",
            "$fallbackPath.whenNoneAvailable",
        )
        return MosaicProductSelectorComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            productReferenceIds = productIds,
            initiallySelectedProductReferenceId = objectValue.requiredIdentifier(
                "initiallySelectedProductReferenceId",
                "$path.initiallySelectedProductReferenceId",
            ),
            direction = MosaicStackDirection.VERTICAL,
            gap = objectValue.requiredLogicalSize("itemSpacing", "$path.itemSpacing"),
            cardStyles = MosaicProductCardStyles.Legacy,
            unavailableFallback = MosaicUnavailableProductFallback(
                localizedText(fallback.required("message", fallbackPath), "$fallbackPath.message"),
            ),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun purchaseButtonComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicPurchaseButtonComponent {
        objectValue.expectKeys(
            setOf("type", "id", "label", "inProgressLabel", "action", "accessibility"),
            path,
        )
        return MosaicPurchaseButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            inProgressLabel = localizedText(
                objectValue.required("inProgressLabel", path),
                "$path.inProgressLabel",
            ),
            typography = MosaicTypography.legacy(
                MosaicTypographyStyle.LABEL,
                MosaicTextAlignment.CENTER,
            ),
            action = purchaseAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun restoreButtonComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicRestoreButtonComponent {
        objectValue.expectKeys(
            setOf("type", "id", "label", "inProgressLabel", "action", "accessibility"),
            path,
        )
        return MosaicRestoreButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            inProgressLabel = localizedText(
                objectValue.required("inProgressLabel", path),
                "$path.inProgressLabel",
            ),
            typography = MosaicTypography.legacy(
                MosaicTypographyStyle.LABEL,
                MosaicTextAlignment.CENTER,
            ),
            action = restoreAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun closeButtonComponent(objectValue: JsonObject, path: String): MosaicCloseButtonComponent {
        objectValue.expectKeys(setOf("type", "id", "label", "action", "accessibility"), path)
        return MosaicCloseButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            typography = MosaicTypography.legacy(
                MosaicTypographyStyle.LABEL,
                MosaicTextAlignment.CENTER,
            ),
            action = closeAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun legalTextComponent(objectValue: JsonObject, path: String): MosaicLegalTextComponent {
        objectValue.expectKeys(
            setOf("type", "id", "value", "alignment", "accessibility"),
            path,
        )
        return MosaicLegalTextComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            value = localizedText(objectValue.required("value", path), "$path.value"),
            typography = MosaicTypography.legacy(
                MosaicTypographyStyle.CAPTION,
                textAlignment(objectValue, "alignment", "$path.alignment"),
            ),
            accessibility = textAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun localizedText(value: JsonElement, path: String): MosaicLocalizedText {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("default", "localizationKey"), path)
        return MosaicLocalizedText(
            defaultValue = objectValue.requiredString("default", "$path.default").also {
                if (it.codePointLength() !in 1..5000) {
                    throw MosaicProtocolException("Invalid localized default length at $path.default.")
                }
            },
            localizationKey = objectValue.requiredLocalizationKey(
                "localizationKey",
                "$path.localizationKey",
            ),
        )
    }

    private fun textAccessibility(value: JsonElement, path: String): MosaicTextAccessibility {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("role", "$path.role")) {
            "text" -> {
                objectValue.expectKeys(setOf("role"), path)
                MosaicTextAccessibility.Text
            }
            "heading" -> {
                objectValue.expectKeys(setOf("role", "level"), path)
                MosaicTextAccessibility.Heading(
                    objectValue.requiredIntegerInRange("level", "$path.level", 1..6),
                )
            }
            else -> throw MosaicProtocolException("Invalid text accessibility role at $path.role.")
        }
    }

    private fun imageAccessibility(value: JsonElement, path: String): MosaicImageAccessibility {
        val objectValue = value.objectAt(path)
        val hidden = objectValue.requiredBoolean("hidden", "$path.hidden")
        return if (hidden) {
            objectValue.expectKeys(setOf("hidden"), path)
            MosaicImageAccessibility.Decorative
        } else {
            objectValue.expectKeys(setOf("hidden", "label"), path)
            MosaicImageAccessibility.Informative(
                localizedText(objectValue.required("label", path), "$path.label"),
            )
        }
    }

    private fun controlAccessibility(value: JsonElement, path: String): MosaicControlAccessibility {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("label", "hint"), path, optional = setOf("hint"))
        return MosaicControlAccessibility(
            label = localizedText(objectValue.required("label", path), "$path.label"),
            hint = objectValue.optional("hint")?.let { localizedText(it, "$path.hint") },
        )
    }

    private fun purchaseAction(value: JsonElement, path: String): MosaicPurchaseAction {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type", "productSelectorId"), path)
        objectValue.requireConstant("type", "purchase", "$path.type")
        return MosaicPurchaseAction(
            objectValue.requiredIdentifier("productSelectorId", "$path.productSelectorId"),
        )
    }

    private fun restoreAction(value: JsonElement, path: String): MosaicRestoreAction {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type"), path)
        objectValue.requireConstant("type", "restore", "$path.type")
        return MosaicRestoreAction
    }

    private fun closeAction(value: JsonElement, path: String): MosaicCloseAction {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type"), path)
        objectValue.requireConstant("type", "close", "$path.type")
        return MosaicCloseAction
    }

    private fun textAlignment(
        objectValue: JsonObject,
        name: String,
        path: String,
    ): MosaicTextAlignment = when (objectValue.requiredString(name, path)) {
        "start" -> MosaicTextAlignment.START
        "center" -> MosaicTextAlignment.CENTER
        "end" -> MosaicTextAlignment.END
        else -> throw MosaicProtocolException("Invalid text alignment at $path.")
    }

    private fun validateDocumentSemantics(
        document: MosaicPaywallDocument,
        capabilityReport: MosaicCapabilityReport,
    ) {
        if (document.localization.defaultLocale !in document.localization.locales) {
            throw MosaicProtocolException("The default locale is not declared.")
        }
        if (document.localization.fallbackLocale !in document.localization.locales) {
            throw MosaicProtocolException("The fallback locale is not declared.")
        }

        val nodes = document.layout.content.walkDepthFirst().toList()
        requireUnique(
            listOf(document.layout.id) + nodes.map(MosaicNode::id),
            "layout/component IDs",
        )
        nodes.filterIsInstance<MosaicFeatureListComponent>().forEach { featureList ->
            requireUnique(featureList.items.map(MosaicFeatureListItem::id), "feature IDs in ${featureList.id}")
        }
        requireUnique(document.assets.map(MosaicImageAsset::id), "asset IDs")
        requireUnique(document.products.map(MosaicProductReference::id), "product reference IDs")
        requireUnique(document.products.map(MosaicProductReference::providerProductId), "provider product IDs")

        val assetsById = document.assets.associateBy(MosaicImageAsset::id)
        val usedAssetIds = nodes.filterIsInstance<MosaicImageComponent>().map { image ->
            if (image.assetId !in assetsById) {
                throw MosaicProtocolException("Image ${image.id} references an unknown asset.")
            }
            image.assetId
        }.toSet()
        if (usedAssetIds != assetsById.keys) {
            throw MosaicProtocolException("Asset declarations must be used exactly by the document.")
        }

        val productsById = document.products.associateBy(MosaicProductReference::id)
        val selectors = nodes.filterIsInstance<MosaicProductSelectorComponent>()
        val usedProductIds = mutableSetOf<String>()
        selectors.forEach { selector ->
            requireUnique(selector.productReferenceIds, "product references in ${selector.id}")
            selector.productReferenceIds.forEach { referenceId ->
                if (referenceId !in productsById) {
                    throw MosaicProtocolException(
                        "Product selector ${selector.id} references an unknown product.",
                    )
                }
                usedProductIds += referenceId
            }
            if (selector.initiallySelectedProductReferenceId !in selector.productReferenceIds) {
                throw MosaicProtocolException(
                    "Product selector ${selector.id} initially selects an undeclared product.",
                )
            }
        }
        if (usedProductIds != productsById.keys) {
            throw MosaicProtocolException("Product declarations must be used exactly by the document.")
        }

        val selectorsById = selectors.associateBy(MosaicProductSelectorComponent::id)
        val purchaseActions = nodes.filterIsInstance<MosaicPurchaseButtonComponent>().map { it.action }
        purchaseActions.forEach { action ->
            if (action.productSelectorId !in selectorsById) {
                throw MosaicProtocolException("Purchase action references an unknown product selector.")
            }
        }
        selectors.forEach { selector ->
            if (purchaseActions.none { it.productSelectorId == selector.id }) {
                throw MosaicProtocolException("Product selector ${selector.id} has no purchase action.")
            }
        }

        validateLocalizationSemantics(document, nodes)

        val derived = deriveCapabilities(document, nodes)
        val declared = document.compatibility.requiredCapabilities.map(MosaicRequiredCapability::name).toSet()
        if (declared != derived) {
            throw MosaicProtocolException("Capability declarations do not match document content.")
        }
        declared.forEach { capability ->
            if (!capabilityReport.supports(
                    MosaicRequiredCapability(capability, MOSAIC_PROTOCOL_VERSION),
                )
            ) {
                throw MosaicProtocolException("The Android SDK does not support ${capability.wireName}@0.1.")
            }
        }
    }

    private fun validateLocalizationSemantics(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ) {
        val localizedValues = buildList {
            document.assets.forEach { add(it.placeholder) }
            document.products.forEach { product ->
                add(product.label)
                product.badge?.let(::add)
            }
            nodes.forEach { node ->
                when (node) {
                    is MosaicVerticalStack -> Unit
                    is MosaicTextComponent -> add(node.value)
                    is MosaicImageComponent -> {
                        val accessibility = node.accessibility
                        if (accessibility is MosaicImageAccessibility.Informative) add(accessibility.label)
                    }
                    is MosaicFeatureListComponent -> {
                        node.items.forEach { add(it.text) }
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicProductSelectorComponent -> {
                        add(node.unavailableFallback.message)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicPurchaseButtonComponent -> {
                        add(node.label)
                        add(node.inProgressLabel)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicRestoreButtonComponent -> {
                        add(node.label)
                        add(node.inProgressLabel)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicCloseButtonComponent -> {
                        add(node.label)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicLegalTextComponent -> add(node.value)
                    is MosaicCarouselComponent,
                    is MosaicSwitchComponent,
                    is MosaicCountdownComponent -> throw MosaicProtocolException(
                        "Protocol 0.2 component in a Protocol 0.1 document.",
                    )
                }
            }
        }
        val defaultStrings = checkNotNull(
            document.localization.locales[document.localization.defaultLocale],
        ).strings
        val referencedKeys = localizedValues.map(MosaicLocalizedText::localizationKey).toSet()
        if (defaultStrings.keys != referencedKeys) {
            throw MosaicProtocolException(
                "Default locale keys must exactly match the document's localized values.",
            )
        }
        localizedValues.forEach { value ->
            if (defaultStrings[value.localizationKey] != value.defaultValue) {
                throw MosaicProtocolException(
                    "Inline defaults must equal the default locale catalog.",
                )
            }
        }
        document.localization.locales.forEach { (tag, catalog) ->
            if (!defaultStrings.keys.containsAll(catalog.strings.keys)) {
                throw MosaicProtocolException("Locale $tag declares a key absent from the default locale.")
            }
        }
    }

    private fun MutableList<MosaicLocalizedText>.addControlAccessibility(
        accessibility: MosaicControlAccessibility,
    ) {
        add(accessibility.label)
        accessibility.hint?.let(::add)
    }

    private fun deriveCapabilities(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ): Set<MosaicCapabilityName> = buildSet {
        add(MosaicCapabilityName.SCROLL_CONTAINER)
        add(MosaicCapabilityName.LOCALIZATION_CATALOGS)
        add(MosaicCapabilityName.NORMALIZED_OUTCOME)
        if (document.localization.locales.values.any { it.direction == MosaicLayoutDirection.RTL }) {
            add(MosaicCapabilityName.LOCALIZATION_RTL)
        }
        if (document.assets.isNotEmpty()) {
            add(MosaicCapabilityName.BUNDLED_IMAGE)
            add(MosaicCapabilityName.ASSET_FALLBACK)
        }
        if (document.products.isNotEmpty()) add(MosaicCapabilityName.PRODUCT_REFERENCES)
        nodes.forEach { node ->
            when (node) {
                is MosaicVerticalStack -> add(MosaicCapabilityName.VERTICAL_STACK)
                is MosaicTextComponent -> add(MosaicCapabilityName.TEXT)
                is MosaicImageComponent -> add(MosaicCapabilityName.IMAGE)
                is MosaicFeatureListComponent -> add(MosaicCapabilityName.FEATURE_LIST)
                is MosaicProductSelectorComponent -> {
                    add(MosaicCapabilityName.PRODUCT_SELECTOR)
                    add(MosaicCapabilityName.PRODUCT_FALLBACK)
                }
                is MosaicPurchaseButtonComponent -> {
                    add(MosaicCapabilityName.PURCHASE_BUTTON)
                    add(MosaicCapabilityName.PURCHASE_ACTION)
                }
                is MosaicRestoreButtonComponent -> {
                    add(MosaicCapabilityName.RESTORE_BUTTON)
                    add(MosaicCapabilityName.RESTORE_ACTION)
                }
                is MosaicCloseButtonComponent -> {
                    add(MosaicCapabilityName.CLOSE_BUTTON)
                    add(MosaicCapabilityName.CLOSE_ACTION)
                }
                is MosaicLegalTextComponent -> add(MosaicCapabilityName.LEGAL_TEXT)
                is MosaicCarouselComponent,
                is MosaicSwitchComponent,
                is MosaicCountdownComponent -> throw MosaicProtocolException(
                    "Protocol 0.2 component in a Protocol 0.1 document.",
                )
            }
            if (node !is MosaicVerticalStack) add(MosaicCapabilityName.ACCESSIBILITY_METADATA)
        }
    }

    private fun requireUnique(values: List<String>, description: String) {
        if (values.toSet().size != values.size) {
            throw MosaicProtocolException("Duplicate $description are not allowed.")
        }
    }

    private fun JsonObject.required(name: String, path: String): JsonElement = get(name)
        ?.takeUnless { it is JsonNull }
        ?: throw MosaicProtocolException("Missing property $name at $path.")

    private fun JsonObject.optional(name: String): JsonElement? = get(name)

    private fun JsonObject.requiredString(name: String, path: String): String =
        required(name, path.substringBeforeLast('.', path)).stringAt(path)

    private fun JsonObject.requiredIdentifier(name: String, path: String): String =
        required(name, path.substringBeforeLast('.', path)).identifierAt(path)

    private fun JsonObject.requiredLocalizationKey(name: String, path: String): String =
        requiredString(name, path).also { validateLocalizationKey(it, path) }

    private fun JsonObject.requiredLocaleTag(name: String, path: String): String =
        requiredString(name, path).also { validateLocaleTag(it, path) }

    private fun JsonObject.requiredBoolean(name: String, path: String): Boolean {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
            throw MosaicProtocolException("Expected a boolean at $path.")
        }
        return value.asBoolean
    }

    private fun JsonObject.requiredPositiveInteger(name: String, path: String): Int {
        val number = requiredDecimal(name, path)
        if (number.stripTrailingZeros().scale() > 0 ||
            number < BigDecimal.ONE ||
            number > BigDecimal(Int.MAX_VALUE)
        ) {
            throw MosaicProtocolException("Expected a 32-bit positive integer at $path.")
        }
        return number.intValueExact()
    }

    private fun JsonObject.requiredIntegerInRange(name: String, path: String, range: IntRange): Int {
        val number = requiredDecimal(name, path)
        if (number.stripTrailingZeros().scale() > 0) {
            throw MosaicProtocolException("Expected an integer at $path.")
        }
        val value = runCatching { number.intValueExact() }.getOrElse {
            throw MosaicProtocolException("Expected an integer at $path.")
        }
        if (value !in range) throw MosaicProtocolException("Integer is outside its range at $path.")
        return value
    }

    private fun JsonObject.requiredLogicalSize(name: String, path: String): Double = requiredNumber(
        name = name,
        path = path,
        minimum = BigDecimal.ZERO,
        maximum = BigDecimal(4096),
    )

    private fun JsonObject.requiredNumber(
        name: String,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean = false,
    ): Double {
        val decimal = requiredDecimal(name, path)
        val belowMinimum = if (exclusiveMinimum) decimal <= minimum else decimal < minimum
        if (belowMinimum || decimal > maximum) {
            throw MosaicProtocolException("Number is outside its range at $path.")
        }
        val number = decimal.toDouble()
        if (!number.isFinite() || (exclusiveMinimum && number <= 0.0)) {
            throw MosaicProtocolException("Expected a finite representable number at $path.")
        }
        return number
    }

    private fun JsonObject.requiredDecimal(name: String, path: String): BigDecimal {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
            throw MosaicProtocolException("Expected a number at $path.")
        }
        return runCatching { value.asBigDecimal }.getOrElse {
            throw MosaicProtocolException("Expected a finite JSON number at $path.")
        }
    }

    private fun JsonObject.requireConstant(name: String, expected: String, path: String) {
        if (requiredString(name, path) != expected) {
            throw MosaicProtocolException("Expected $expected at $path.")
        }
    }

    private fun JsonElement.stringAt(
        path: String,
        minLength: Int = 0,
        maxLength: Int = Int.MAX_VALUE,
    ): String {
        if (!isJsonPrimitive || !asJsonPrimitive.isString) {
            throw MosaicProtocolException("Expected a string at $path.")
        }
        return asString.also { value ->
            if (value.codePointLength() !in minLength..maxLength) {
                throw MosaicProtocolException("String length is outside its range at $path.")
            }
        }
    }

    private fun JsonElement.identifierAt(path: String): String = stringAt(path, 1, 128).also {
        if (!identifierPattern.matches(it)) {
            throw MosaicProtocolException("Invalid identifier $it at $path.")
        }
    }

    private fun validateLocalizationKey(value: String, path: String) {
        if (value.codePointLength() > 256 || !localizationKeyPattern.matches(value)) {
            throw MosaicProtocolException("Invalid localization key $value at $path.")
        }
    }

    private fun validateLocaleTag(value: String, path: String) {
        if (!localeTagPattern.matches(value)) {
            throw MosaicProtocolException("Invalid locale tag $value at $path.")
        }
    }

    private fun JsonElement.objectAt(path: String): JsonObject {
        if (!isJsonObject) throw MosaicProtocolException("Expected an object at $path.")
        return asJsonObject
    }

    private fun JsonElement.arrayAt(path: String): JsonArray {
        if (!isJsonArray) throw MosaicProtocolException("Expected an array at $path.")
        return asJsonArray
    }

    private fun JsonElement.nonEmptyArrayAt(path: String): JsonArray = arrayAt(path).also {
        if (it.isEmpty) throw MosaicProtocolException("Expected a non-empty array at $path.")
    }

    private fun JsonObject.expectKeys(
        expected: Set<String>,
        path: String,
        optional: Set<String> = emptySet(),
    ) {
        val actual = keySet()
        val required = expected - optional
        val missing = required - actual
        val unknown = actual - expected
        if (missing.isNotEmpty()) {
            throw MosaicProtocolException("Missing properties ${missing.sorted().joinToString()} at $path.")
        }
        if (unknown.isNotEmpty()) {
            throw MosaicProtocolException("Unknown properties ${unknown.sorted().joinToString()} at $path.")
        }
    }

    private fun String.codePointLength(): Int = codePointCount(0, length)
}

class MosaicProtocolException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
