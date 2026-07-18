package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Strict Protocol 0.2 reader. JSON Schema in `protocol/` remains canonical. */
internal object MosaicProtocolV02Decoder {
    private val identifierPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
    private val localizationKeyPattern = Regex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$")
    private val localeTagPattern = Regex("^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
    private val providerProductIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    private val bundledAssetKeyPattern = Regex("^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
    private val literalColorPattern = Regex("^#[0-9A-F]{8}$")
    private val productTemplatePattern = Regex("\\{\\{\\s*product\\.(name|price)\\s*\\}\\}")
    private val externalUrlPattern = Regex(
        """^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$""",
    )
    private val utcTimestampPattern = Regex(
        "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])" +
            "T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
    )
    private val capabilitiesByWireName = MosaicCapabilityName.entries.associateBy { it.wireName }
    private val activeDesignSystem = ThreadLocal<RawDesignSystem?>()

    private data class RawToken(
        val id: String,
        val name: String,
        val value: JsonElement,
        val path: String,
    )

    private data class RawDesignSystem(
        val colors: LinkedHashMap<String, RawToken>,
        val backgrounds: LinkedHashMap<String, RawToken>,
        val shadows: LinkedHashMap<String, RawToken>,
    )

    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport,
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
        root.expectKeys(
            setOf(
                "schemaVersion", "id", "revision", "compatibility", "localization",
                "designSystem", "assets", "products", "initialScreenId", "screens",
            ),
            "$",
        )
        root.requireConstant("schemaVersion", MOSAIC_PROTOCOL_VERSION, "$.schemaVersion")
        val rawDesignSystem = rawDesignSystem(root.required("designSystem", "$"))
        activeDesignSystem.set(rawDesignSystem)
        try {
            val initialScreenId = root.requiredIdentifier("initialScreenId", "$.initialScreenId")
            val screens = root.required("screens", "$")
                .boundedArrayAt("$.screens", 1, 10)
                .mapIndexed { index, value -> screen(value, "$.screens[$index]") }
            val initialScreen = screens.singleOrNull { it.id == initialScreenId }
                ?: throw MosaicProtocolException("initialScreenId must reference exactly one declared screen.")
            if (initialScreen.presentation != MosaicScreenPresentation.SCREEN) {
                throw MosaicProtocolException("initialScreenId must reference a Screen presentation.")
            }
            val document = MosaicPaywallDocument(
                schemaVersion = MOSAIC_PROTOCOL_VERSION,
                id = root.requiredIdentifier("id", "$.id"),
                revision = root.requiredPositiveInteger("revision", "$.revision"),
                compatibility = compatibility(root.required("compatibility", "$"), capabilityReport),
                localization = localization(root.required("localization", "$")),
                assets = root.required("assets", "$").arrayAt("$.assets").mapIndexed { index, value ->
                    asset(value, "$.assets[$index]")
                },
                products = root.required("products", "$").arrayAt("$.products").mapIndexed { index, value ->
                    productReference(value, "$.products[$index]")
                },
                layout = initialScreen.layout,
                initialScreenId = initialScreenId,
                screens = screens,
                designSystem = designSystem(rawDesignSystem),
            )
            validateDocumentSemantics(document, root, capabilityReport)
            return document
        } finally {
            activeDesignSystem.remove()
        }
    }

    private fun compatibility(
        value: JsonElement,
        capabilityReport: MosaicCapabilityReport,
    ): MosaicDocumentCompatibility {
        val path = "$.compatibility"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("requiredCapabilities"), path)
        val entries = objectValue.required("requiredCapabilities", path)
            .boundedArrayAt("$path.requiredCapabilities", 1, 64)
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
            if (name !in MosaicCapabilityCatalog.v02 ||
                version != MOSAIC_PROTOCOL_VERSION ||
                !capabilityReport.supports(required)
            ) {
                throw MosaicProtocolException(
                    "Unsupported capability $wireName@$version at $capabilityPath.",
                )
            }
            if (!seen.add(name)) {
                throw MosaicProtocolException("Duplicate capability $wireName at $capabilityPath.")
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
        if (localeObject.size() !in 1..100) {
            throw MosaicProtocolException("Expected 1 to 100 locales at $path.locales.")
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
        if (stringsObject.size() !in 1..5000) {
            throw MosaicProtocolException("Invalid localized string count at $path.strings.")
        }
        val strings = buildMap {
            stringsObject.entrySet().forEach { (key, stringElement) ->
                validateLocalizationKey(key, "$path.strings")
                put(key, stringElement.stringAt("$path.strings.$key", 1, 5000))
            }
        }
        return MosaicLocaleCatalog(direction, strings)
    }

    private fun asset(value: JsonElement, path: String): MosaicAsset {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "image" -> imageAsset(objectValue, path)
            "video" -> videoAsset(objectValue, path)
            else -> throw MosaicProtocolException("Unsupported asset type at $path.type.")
        }
    }

    private fun assetSource(value: JsonElement, path: String): MosaicAssetSource {
        val source = value.objectAt(path)
        return when (source.requiredString("type", "$path.type")) {
            "bundled" -> {
                source.expectKeys(setOf("type", "key"), path)
                val key = source.requiredString("key", "$path.key").also {
                    if (it.codePointLength() !in 1..256 || !bundledAssetKeyPattern.matches(it)) {
                        throw MosaicProtocolException("Invalid bundled asset key at $path.key.")
                    }
                }
                MosaicAssetSource.Bundled(key)
            }
            "remote" -> {
                source.expectKeys(setOf("type", "url"), path)
                MosaicAssetSource.Remote(
                    validateExternalUrl(source.requiredString("url", "$path.url"), "$path.url"),
                )
            }
            else -> throw MosaicProtocolException("Unsupported asset source at $path.type.")
        }
    }

    private fun imageAsset(objectValue: JsonObject, path: String): MosaicImageAsset {
        objectValue.expectKeys(setOf("type", "id", "source", "fallback"), path)
        val sourcePath = "$path.source"
        val source = assetSource(objectValue.required("source", path), sourcePath)
        val fallbackPath = "$path.fallback"
        val fallback = objectValue.required("fallback", path).objectAt(fallbackPath)
        fallback.expectKeys(setOf("type", "value"), fallbackPath)
        fallback.requireConstant("type", "placeholder", "$fallbackPath.type")
        return MosaicImageAsset(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            sourceKey = when (source) {
                is MosaicAssetSource.Bundled -> source.key
                is MosaicAssetSource.Remote -> source.url
            },
            placeholder = localizedText(fallback.required("value", fallbackPath), "$fallbackPath.value"),
            source = source,
        )
    }

    private fun videoAsset(objectValue: JsonObject, path: String): MosaicVideoAsset {
        objectValue.expectKeys(setOf("type", "id", "source"), path)
        return MosaicVideoAsset(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            source = assetSource(objectValue.required("source", path), "$path.source"),
        )
    }

    private fun productReference(value: JsonElement, path: String): MosaicProductReference {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("id", "productId", "label"), path)
        val providerProductId = objectValue.requiredString("productId", "$path.productId").also {
            if (it.codePointLength() !in 1..256 || !providerProductIdPattern.matches(it)) {
                throw MosaicProtocolException("Invalid provider product ID at $path.productId.")
            }
        }
        return MosaicProductReference(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            providerProductId = providerProductId,
            label = localizedText(objectValue.required("label", path), "$path.label"),
            badge = null,
        )
    }

    private fun scrollContainer(value: JsonElement, path: String): MosaicScrollContainer {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("type", "id", "axis", "safeArea", "showsIndicators", "background", "content"),
            path,
            optional = setOf("background"),
        )
        objectValue.requireConstant("type", "scrollContainer", "$path.type")
        objectValue.requireConstant("axis", "vertical", "$path.axis")
        objectValue.requireConstant("safeArea", "respect", "$path.safeArea")
        return MosaicScrollContainer(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            showsIndicators = objectValue.requiredBoolean("showsIndicators", "$path.showsIndicators"),
            background = objectValue.optional("background")?.let { background(it, "$path.background") },
            content = stack(objectValue.required("content", path), "$path.content"),
        )
    }

    private fun screen(value: JsonElement, path: String): MosaicPaywallScreen {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("id", "accessibilityLabel", "presentation", "layout"),
            path,
            optional = setOf("accessibilityLabel"),
        )
        return MosaicPaywallScreen(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            accessibilityLabel = objectValue.optional("accessibilityLabel")?.let {
                localizedText(it, "$path.accessibilityLabel")
            },
            presentation = screenPresentation(objectValue.required("presentation", path), "$path.presentation"),
            layout = scrollContainer(objectValue.required("layout", path), "$path.layout"),
        )
    }

    private fun screenPresentation(value: JsonElement, path: String): MosaicScreenPresentation {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type"), path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "screen" -> MosaicScreenPresentation.SCREEN
            "sheet" -> MosaicScreenPresentation.SHEET
            else -> throw MosaicProtocolException("Unsupported screen presentation at $path.type.")
        }
    }

    private fun stack(value: JsonElement, path: String): MosaicStack {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf(
                "type", "id", "direction", "gap", "padding", "mainAxisDistribution",
                "crossAxisAlignment", "appearance", "sizing", "outerInsets", "visibility",
                "children",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        objectValue.requireConstant("type", "stack", "$path.type")
        val children = objectValue.required("children", path).boundedArrayAt("$path.children", 0, 500)
        return MosaicStack(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
            mainAxisDistribution = mainAxisDistribution(
                objectValue,
                "mainAxisDistribution",
                "$path.mainAxisDistribution",
            ),
            crossAxisAlignment = crossAxisAlignment(
                objectValue,
                "crossAxisAlignment",
                "$path.crossAxisAlignment",
            ),
            children = children.mapIndexed { index, child -> node(child, "$path.children[$index]") },
            appearance = objectValue.optional("appearance")?.let {
                containerAppearance(it, "$path.appearance")
            },
            sizing = objectValue.optional("sizing")?.let { safeBoxSizing(it, "$path.sizing") },
            outerInsets = objectValue.optional("outerInsets")?.let {
                edgeInsets(it, "$path.outerInsets")
            },
            visibility = objectValue.optional("visibility")?.let {
                visibility(it, "$path.visibility")
            } ?: MosaicVisibility.Always,
        )
    }

    private fun node(value: JsonElement, path: String): MosaicNode {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "stack" -> stack(value, path)
            "text" -> textComponent(objectValue, path)
            "image" -> imageComponent(objectValue, path)
            "icon" -> iconComponent(objectValue, path)
            "featureList" -> featureListComponent(objectValue, path)
            "productSelector" -> productSelectorComponent(objectValue, path)
            "button" -> buttonComponent(objectValue, path)
            "carousel" -> carouselComponent(objectValue, path)
            "switch" -> switchComponent(objectValue, path)
            "countdown" -> countdownComponent(objectValue, path)
            else -> throw MosaicProtocolException("Unsupported Protocol 0.2 component at $path.type.")
        }
    }

    private fun textComponent(objectValue: JsonObject, path: String): MosaicTextComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "value", "typography", "appearance", "sizing", "outerInsets",
                "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        return MosaicTextComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            value = localizedText(objectValue.required("value", path), "$path.value"),
            typography = typography(objectValue.required("typography", path), "$path.typography", true),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = textAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun imageComponent(objectValue: JsonObject, path: String): MosaicImageComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "assetId", "aspectRatio", "contentMode", "appearance", "sizing",
                "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("aspectRatio", "appearance", "sizing", "outerInsets", "visibility"),
        )
        val sizing = optionalWidthSizing(objectValue, path)
        return MosaicImageComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            assetId = objectValue.requiredIdentifier("assetId", "$path.assetId"),
            width = sizing?.width ?: MosaicWidthSizing.Content,
            aspectRatio = if (objectValue.hasNonNull("aspectRatio")) {
                objectValue.requiredNumber(
                    "aspectRatio", "$path.aspectRatio", BigDecimal.ZERO, BigDecimal.TEN, true,
                )
            } else {
                null
            },
            height = (sizing?.height as? MosaicHeightSizing.Fixed)?.value,
            contentMode = imageContentMode(objectValue, "contentMode", "$path.contentMode"),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = sizing,
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = imageAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun iconComponent(objectValue: JsonObject, path: String): MosaicIconComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "name", "size", "color", "appearance", "sizing", "outerInsets",
                "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val name = when (objectValue.requiredString("name", "$path.name")) {
            "checkmark" -> MosaicIconName.CHECKMARK
            "close" -> MosaicIconName.CLOSE
            "lock" -> MosaicIconName.LOCK
            "restore" -> MosaicIconName.RESTORE
            "externalLink" -> MosaicIconName.EXTERNAL_LINK
            "arrowBackward" -> MosaicIconName.ARROW_BACKWARD
            "arrowForward" -> MosaicIconName.ARROW_FORWARD
            "chevronBackward" -> MosaicIconName.CHEVRON_BACKWARD
            "chevronForward" -> MosaicIconName.CHEVRON_FORWARD
            else -> throw MosaicProtocolException("Invalid icon name at $path.name.")
        }
        return MosaicIconComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            name = name,
            size = objectValue.requiredPositiveLogicalSize("size", "$path.size"),
            color = color(objectValue.required("color", path), "$path.color"),
            accessibility = imageAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
        )
    }

    private fun buttonComponent(objectValue: JsonObject, path: String): MosaicButtonComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "direction", "gap", "mainAxisDistribution",
                "crossAxisAlignment", "children", "inProgressChildren", "appearance", "sizing",
                "outerInsets", "visibility", "action", "accessibility",
            ),
            path,
            optional = setOf(
                "inProgressChildren", "appearance", "sizing", "outerInsets", "visibility",
            ),
        )
        val children = objectValue.required("children", path)
            .boundedArrayAt("$path.children", 1, 500)
            .mapIndexed { index, child -> node(child, "$path.children[$index]") }
        val inProgressChildren = objectValue.optional("inProgressChildren")?.let { childrenValue ->
            childrenValue.boundedArrayAt("$path.inProgressChildren", 1, 500)
                .mapIndexed { index, child -> node(child, "$path.inProgressChildren[$index]") }
        }
        return MosaicButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            mainAxisDistribution = mainAxisDistribution(
                objectValue,
                "mainAxisDistribution",
                "$path.mainAxisDistribution",
            ),
            crossAxisAlignment = crossAxisAlignment(
                objectValue,
                "crossAxisAlignment",
                "$path.crossAxisAlignment",
            ),
            children = children,
            inProgressChildren = inProgressChildren,
            action = buttonAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
        )
    }

    private fun featureListComponent(objectValue: JsonObject, path: String): MosaicFeatureListComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "marker", "gap", "markerColor", "items", "typography",
                "appearance", "sizing", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        objectValue.requireConstant("marker", "checkmark", "$path.marker")
        val items = objectValue.required("items", path).boundedArrayAt("$path.items", 1, 100)
        return MosaicFeatureListComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            marker = MosaicFeatureMarker.CHECKMARK,
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            markerColor = color(objectValue.required("markerColor", path), "$path.markerColor"),
            items = items.mapIndexed { index, item -> featureListItem(item, "$path.items[$index]") },
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
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
                "type", "id", "direction", "gap", "crossAxisAlignment",
                "initialProductCardId", "cards", "appearance", "sizing", "outerInsets",
                "visibility", "unavailableFallback", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val cards = objectValue.required("cards", path)
            .boundedArrayAt("$path.cards", 1, 20)
            .mapIndexed { index, element -> productCardComponent(element, "$path.cards[$index]") }
        val initialProductCardId = objectValue.requiredIdentifier(
            "initialProductCardId",
            "$path.initialProductCardId",
        )
        return MosaicProductSelectorComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            productReferenceIds = cards.map(MosaicProductCardComponent::productReferenceId),
            initiallySelectedProductReferenceId = cards
                .firstOrNull { it.id == initialProductCardId }
                ?.productReferenceId
                ?: cards.first().productReferenceId,
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            cardStyles = MosaicProductCardStyles.Legacy,
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            unavailableFallback = unavailableProductFallback(
                objectValue.required("unavailableFallback", path),
                "$path.unavailableFallback",
            ),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
            cards = cards,
            initialProductCardId = initialProductCardId,
            crossAxisAlignment = crossAxisAlignment(
                objectValue,
                "crossAxisAlignment",
                "$path.crossAxisAlignment",
            ),
        )
    }

    private fun productCardComponent(value: JsonElement, path: String): MosaicProductCardComponent {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf(
                "type", "id", "productReferenceId", "direction", "gap",
                "mainAxisDistribution", "crossAxisAlignment", "children", "styles",
                "sizing", "clipContent", "accessibility",
            ),
            path,
            optional = setOf("sizing", "clipContent", "accessibility"),
        )
        objectValue.requireConstant("type", "productCard", "$path.type")
        if (objectValue.hasNonNull("clipContent") &&
            objectValue.requiredBoolean("clipContent", "$path.clipContent")
        ) {
            throw MosaicProtocolException("Product Card clipContent must be false at $path.clipContent.")
        }
        val children = objectValue.required("children", path)
            .boundedArrayAt("$path.children", 1, 500)
            .mapIndexed { index, child -> productCardChild(child, "$path.children[$index]") }
        return MosaicProductCardComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            productReferenceId = objectValue.requiredIdentifier(
                "productReferenceId",
                "$path.productReferenceId",
            ),
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            mainAxisDistribution = mainAxisDistribution(
                objectValue,
                "mainAxisDistribution",
                "$path.mainAxisDistribution",
            ),
            crossAxisAlignment = crossAxisAlignment(
                objectValue,
                "crossAxisAlignment",
                "$path.crossAxisAlignment",
            ),
            children = children,
            styles = productCardBoxStyles(objectValue.required("styles", path), "$path.styles"),
            clipContent = false,
            accessibilityLabel = objectValue.optional("accessibility")?.let {
                val accessibility = it.objectAt("$path.accessibility")
                accessibility.expectKeys(setOf("label"), "$path.accessibility")
                localizedText(accessibility.required("label", "$path.accessibility"), "$path.accessibility.label")
            },
            sizing = optionalWidthSizing(objectValue, path),
        )
    }

    private fun productCardChild(value: JsonElement, path: String): MosaicNode {
        val objectValue = value.objectAt(path)
        return if (objectValue.get("type")?.asString == "productBadge") {
            productBadgeComponent(value, path)
        } else {
            node(value, path)
        }
    }

    private fun productBadgeComponent(value: JsonElement, path: String): MosaicProductBadgeComponent {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf(
                "type", "id", "placement", "direction", "gap", "mainAxisDistribution",
                "crossAxisAlignment", "children", "styles", "sizing",
            ),
            path,
            optional = setOf("sizing"),
        )
        objectValue.requireConstant("type", "productBadge", "$path.type")
        return MosaicProductBadgeComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            placement = productBadgePlacement(
                objectValue.required("placement", path),
                "$path.placement",
            ),
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            mainAxisDistribution = mainAxisDistribution(
                objectValue,
                "mainAxisDistribution",
                "$path.mainAxisDistribution",
            ),
            crossAxisAlignment = crossAxisAlignment(
                objectValue,
                "crossAxisAlignment",
                "$path.crossAxisAlignment",
            ),
            children = objectValue.required("children", path)
                .boundedArrayAt("$path.children", 1, 10)
                .mapIndexed { index, child -> node(child, "$path.children[$index]") },
            styles = productCardBoxStyles(objectValue.required("styles", path), "$path.styles"),
            sizing = optionalWidthSizing(objectValue, path),
        )
    }

    private fun productBadgePlacement(value: JsonElement, path: String): MosaicProductBadgePlacement {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("mode", "$path.mode")) {
            "nested" -> {
                objectValue.expectKeys(setOf("mode"), path)
                MosaicProductBadgePlacement.Nested
            }
            "overlay" -> {
                objectValue.expectKeys(setOf("mode", "anchor", "inset"), path)
                val anchor = when (objectValue.requiredString("anchor", "$path.anchor")) {
                    "topStart" -> MosaicProductBadgeAnchor.TOP_START
                    "topEnd" -> MosaicProductBadgeAnchor.TOP_END
                    "bottomStart" -> MosaicProductBadgeAnchor.BOTTOM_START
                    "bottomEnd" -> MosaicProductBadgeAnchor.BOTTOM_END
                    else -> throw MosaicProtocolException("Invalid Product Badge anchor at $path.anchor.")
                }
                MosaicProductBadgePlacement.Overlay(
                    anchor,
                    objectValue.requiredNumber(
                        "inset",
                        "$path.inset",
                        BigDecimal.ZERO,
                        BigDecimal("64"),
                        false,
                    ),
                )
            }
            else -> throw MosaicProtocolException("Invalid Product Badge placement at $path.mode.")
        }
    }

    private fun productCardBoxStyles(value: JsonElement, path: String): MosaicProductCardBoxStyles {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("default", "selected"), path)
        return MosaicProductCardBoxStyles(
            defaultStyle = productCardBoxDefaultStyle(
                objectValue.required("default", path),
                "$path.default",
            ),
            selected = productCardBoxSelectedStyle(
                objectValue.required("selected", path),
                "$path.selected",
            ),
        )
    }

    private fun productCardBoxDefaultStyle(
        value: JsonElement,
        path: String,
    ): MosaicProductCardBoxStyle {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
            path,
            optional = setOf("shadow"),
        )
        return MosaicProductCardBoxStyle(
            background = background(objectValue.required("background", path), "$path.background"),
            border = border(objectValue.required("border", path), "$path.border"),
            cornerRadius = objectValue.requiredLogicalSize("cornerRadius", "$path.cornerRadius"),
            padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
            opacity = objectValue.requiredNumber(
                "opacity",
                "$path.opacity",
                BigDecimal.ZERO,
                BigDecimal.ONE,
                false,
            ),
            shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
        )
    }

    private fun productCardBoxSelectedStyle(
        value: JsonElement,
        path: String,
    ): MosaicProductCardBoxStyleOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
            path,
            optional = setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
        )
        return MosaicProductCardBoxStyleOverride(
            background = objectValue.optional("background")?.let { background(it, "$path.background") },
            border = objectValue.optional("border")?.let { borderOverride(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            padding = objectValue.optional("padding")?.let {
                edgeInsetsOverride(it, "$path.padding")
            },
            opacity = objectValue.optional("opacity")?.let {
                objectValue.requiredNumber(
                    "opacity",
                    "$path.opacity",
                    BigDecimal.ZERO,
                    BigDecimal.ONE,
                    false,
                )
            },
            shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
        )
    }

    private fun unavailableProductFallback(
        value: JsonElement,
        path: String,
    ): MosaicUnavailableProductFallback {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("selection", "whenNoneAvailable", "message"), path)
        objectValue.requireConstant("selection", "firstAvailable", "$path.selection")
        objectValue.requireConstant(
            "whenNoneAvailable",
            "showMessageAndDisablePurchase",
            "$path.whenNoneAvailable",
        )
        return MosaicUnavailableProductFallback(
            message = localizedText(objectValue.required("message", path), "$path.message"),
        )
    }

    private fun carouselComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicCarouselComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "initialPageIndex", "showsIndicators", "pages", "appearance",
                "sizing", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val pages = objectValue.required("pages", path).boundedArrayAt("$path.pages", 2, 20)
            .mapIndexed { index, page -> carouselPage(page, "$path.pages[$index]") }
        return MosaicCarouselComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            initialPageIndex = objectValue.requiredIntegerInRange(
                "initialPageIndex",
                "$path.initialPageIndex",
                0..19,
            ),
            showsIndicators = objectValue.requiredBoolean("showsIndicators", "$path.showsIndicators"),
            pages = pages,
            appearance = objectValue.optional("appearance")?.let {
                containerAppearance(it, "$path.appearance")
            },
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun carouselPage(value: JsonElement, path: String): MosaicCarouselPage {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("id", "accessibilityLabel", "content"), path)
        return MosaicCarouselPage(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            accessibilityLabel = localizedText(
                objectValue.required("accessibilityLabel", path),
                "$path.accessibilityLabel",
            ),
            content = stack(objectValue.required("content", path), "$path.content"),
        )
    }

    private fun switchComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicSwitchComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "label", "initialValue", "typography", "offTrackColor",
                "onTrackColor", "thumbColor", "appearance", "sizing", "outerInsets", "visibility",
                "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        return MosaicSwitchComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            initialValue = objectValue.requiredBoolean("initialValue", "$path.initialValue"),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            offTrackColor = color(objectValue.required("offTrackColor", path), "$path.offTrackColor"),
            onTrackColor = color(objectValue.required("onTrackColor", path), "$path.onTrackColor"),
            thumbColor = color(objectValue.required("thumbColor", path), "$path.thumbColor"),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun countdownComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicCountdownComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "endsAt", "largestUnit", "smallestUnit", "completedText",
                "typography", "appearance", "sizing", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val endsAt = objectValue.requiredString("endsAt", "$path.endsAt")
        val endsAtEpochMillis = parseCanonicalUtcTimestamp(endsAt, "$path.endsAt")
        return MosaicCountdownComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            endsAt = endsAt,
            endsAtEpochMillis = endsAtEpochMillis,
            largestUnit = countdownUnit(objectValue, "largestUnit", "$path.largestUnit"),
            smallestUnit = countdownUnit(objectValue, "smallestUnit", "$path.smallestUnit"),
            completedText = localizedText(
                objectValue.required("completedText", path),
                "$path.completedText",
            ),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = textAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun typography(
        value: JsonElement,
        path: String,
        supportsOverflow: Boolean,
    ): MosaicTypography {
        val objectValue = value.objectAt(path)
        val common = setOf(
            "style", "fontSize", "lineHeightMultiplier", "weight", "color", "alignment",
        )
        val expected = if (supportsOverflow) common + setOf("maxLines", "overflow") else common
        val optional = if (supportsOverflow) setOf("maxLines", "overflow") else emptySet()
        objectValue.expectKeys(expected, path, optional)
        val hasMaxLines = objectValue.hasNonNull("maxLines")
        val hasOverflow = objectValue.hasNonNull("overflow")
        if (hasMaxLines != hasOverflow) {
            throw MosaicProtocolException("maxLines and overflow must be declared together at $path.")
        }
        return MosaicTypography(
            style = typographyStyle(objectValue, "style", "$path.style"),
            fontSize = objectValue.requiredNumber(
                "fontSize", "$path.fontSize", BigDecimal("8"), BigDecimal("96"),
            ),
            lineHeightMultiplier = objectValue.requiredNumber(
                "lineHeightMultiplier",
                "$path.lineHeightMultiplier",
                BigDecimal("0.8"),
                BigDecimal("3"),
            ),
            weight = fontWeight(objectValue, "weight", "$path.weight"),
            color = color(objectValue.required("color", path), "$path.color"),
            alignment = textAlignment(objectValue, "alignment", "$path.alignment"),
            maxLines = if (hasMaxLines) {
                objectValue.requiredIntegerInRange("maxLines", "$path.maxLines", 1..100)
            } else {
                null
            },
            overflow = if (hasOverflow) {
                textOverflow(objectValue, "overflow", "$path.overflow")
            } else {
                null
            },
        )
    }

    private fun boxAppearance(value: JsonElement, path: String): MosaicBoxAppearance {
        val objectValue = value.objectAt(path)
        if (objectValue.size() == 0) throw MosaicProtocolException("Empty appearance at $path.")
        objectValue.expectKeys(
            setOf("background", "border", "cornerRadius", "opacity", "padding", "shadow"),
            path,
            optional = setOf("background", "border", "cornerRadius", "opacity", "padding", "shadow"),
        )
        return MosaicBoxAppearance(
            background = objectValue.optional("background")?.let { background(it, "$path.background") },
            border = objectValue.optional("border")?.let { border(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            opacity = objectValue.optionalNumber(
                "opacity", "$path.opacity", BigDecimal.ZERO, BigDecimal.ONE,
            ),
            padding = objectValue.optional("padding")?.let { edgeInsets(it, "$path.padding") },
            shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
        )
    }

    private fun containerAppearance(value: JsonElement, path: String): MosaicBoxAppearance {
        val objectValue = value.objectAt(path)
        if (objectValue.size() == 0) throw MosaicProtocolException("Empty appearance at $path.")
        objectValue.expectKeys(
            setOf("background", "border", "cornerRadius", "opacity", "clipContent", "shadow"),
            path,
            optional = setOf("background", "border", "cornerRadius", "opacity", "clipContent", "shadow"),
        )
        return MosaicBoxAppearance(
            background = objectValue.optional("background")?.let { background(it, "$path.background") },
            border = objectValue.optional("border")?.let { border(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            opacity = objectValue.optionalNumber(
                "opacity", "$path.opacity", BigDecimal.ZERO, BigDecimal.ONE,
            ),
            clipContent = objectValue.optionalBoolean("clipContent", "$path.clipContent"),
            shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
        )
    }

    private fun border(value: JsonElement, path: String): MosaicBorder {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("color", "width"), path)
        return MosaicBorder(
            color = color(objectValue.required("color", path), "$path.color"),
            width = objectValue.requiredLogicalSize("width", "$path.width"),
        )
    }

    private fun borderOverride(value: JsonElement, path: String): MosaicBorderOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("color", "width"),
            path,
            optional = setOf("color", "width"),
        )
        return MosaicBorderOverride(
            color = objectValue.optional("color")?.let { color(it, "$path.color") },
            width = objectValue.optionalLogicalSize("width", "$path.width"),
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

    private fun edgeInsetsOverride(value: JsonElement, path: String): MosaicEdgeInsetsOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("top", "start", "bottom", "end"),
            path,
            optional = setOf("top", "start", "bottom", "end"),
        )
        return MosaicEdgeInsetsOverride(
            top = objectValue.optionalLogicalSize("top", "$path.top"),
            start = objectValue.optionalLogicalSize("start", "$path.start"),
            bottom = objectValue.optionalLogicalSize("bottom", "$path.bottom"),
            end = objectValue.optionalLogicalSize("end", "$path.end"),
        )
    }

    private fun safeBoxSizing(value: JsonElement, path: String): MosaicBoxSizing {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("width", "height"), path)
        return MosaicBoxSizing(
            width = widthSizing(objectValue.required("width", path), "$path.width"),
            height = heightSizing(objectValue.required("height", path), "$path.height"),
        )
    }

    private fun widthSizing(value: JsonElement, path: String): MosaicWidthSizing {
        if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
            return when (value.asString) {
                "fit" -> MosaicWidthSizing.Content
                "fill" -> MosaicWidthSizing.Fill
                else -> throw MosaicProtocolException("Invalid width sizing at $path.")
            }
        }
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("mode", "value"), path)
        objectValue.requireConstant("mode", "fixed", "$path.mode")
        return MosaicWidthSizing.Fixed(
            objectValue.requiredPositiveLogicalSize("value", "$path.value"),
        )
    }

    private fun heightSizing(value: JsonElement, path: String): MosaicHeightSizing {
        if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
            return when (value.asString) {
                "fit" -> MosaicHeightSizing.Content
                "fill" -> MosaicHeightSizing.Fill
                else -> throw MosaicProtocolException("Invalid height sizing at $path.")
            }
        }
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("mode", "value"), path)
        objectValue.requireConstant("mode", "fixed", "$path.mode")
        return MosaicHeightSizing.Fixed(
            objectValue.requiredPositiveLogicalSize("value", "$path.value"),
        )
    }

    private fun visibility(value: JsonElement, path: String): MosaicVisibility {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("mode", "$path.mode")) {
            "always" -> {
                objectValue.expectKeys(setOf("mode"), path)
                MosaicVisibility.Always
            }
            "hidden" -> {
                objectValue.expectKeys(setOf("mode"), path)
                MosaicVisibility.Hidden
            }
            "switch" -> {
                objectValue.expectKeys(setOf("mode", "switchId", "equals"), path)
                MosaicVisibility.SwitchValue(
                    switchId = objectValue.requiredIdentifier("switchId", "$path.switchId"),
                    equals = objectValue.requiredBoolean("equals", "$path.equals"),
                )
            }
            else -> throw MosaicProtocolException("Invalid visibility mode at $path.mode.")
        }
    }

    private fun rawDesignSystem(value: JsonElement): RawDesignSystem {
        val path = "$.designSystem"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("colors", "backgrounds", "shadows"), path)

        fun tokens(name: String): LinkedHashMap<String, RawToken> {
            val tokenPath = "$path.$name"
            val values = objectValue.required(name, path).boundedArrayAt(tokenPath, 0, 256)
            val result = linkedMapOf<String, RawToken>()
            val names = mutableSetOf<String>()
            values.forEachIndexed { index, element ->
                val itemPath = "$tokenPath[$index]"
                val item = element.objectAt(itemPath)
                item.expectKeys(setOf("id", "name", "value"), itemPath)
                val id = item.requiredIdentifier("id", "$itemPath.id")
                val displayName = item.requiredString("name", "$itemPath.name").also {
                    if (it.codePointLength() !in 1..80) {
                        throw MosaicProtocolException("Invalid design token name at $itemPath.name.")
                    }
                }
                if (result.containsKey(id)) {
                    throw MosaicProtocolException("Duplicate $name token ID $id at $itemPath.id.")
                }
                if (!names.add(displayName)) {
                    throw MosaicProtocolException("Duplicate $name token name at $itemPath.name.")
                }
                result[id] = RawToken(id, displayName, item.required("value", itemPath), itemPath)
            }
            return result
        }

        return RawDesignSystem(tokens("colors"), tokens("backgrounds"), tokens("shadows"))
    }

    private fun designSystem(raw: RawDesignSystem): MosaicDesignSystem = MosaicDesignSystem(
        colors = raw.colors.values.map { token ->
            MosaicColorToken(token.id, token.name, resolveColorToken(token.id, token.path, linkedSetOf()))
        },
        backgrounds = raw.backgrounds.values.map { token ->
            MosaicBackgroundToken(
                token.id,
                token.name,
                resolveBackgroundToken(token.id, token.path, linkedSetOf()),
            )
        },
        shadows = raw.shadows.values.map { token ->
            MosaicShadowToken(token.id, token.name, resolveShadowToken(token.id, token.path, linkedSetOf()))
        },
    )

    private fun color(value: JsonElement, path: String): MosaicColor =
        resolveColor(value, path, linkedSetOf())

    private fun resolveColor(
        value: JsonElement,
        path: String,
        visiting: MutableSet<String>,
    ): MosaicColor {
        if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
            val raw = value.stringAt(path, 1, 64)
            val semantic = MosaicSemanticColor.entries.any { it.wireName == raw }
            if (!semantic && !literalColorPattern.matches(raw)) {
                throw MosaicProtocolException("Invalid or noncanonical color at $path.")
            }
            return MosaicColor(raw)
        }
        val reference = value.objectAt(path)
        reference.expectKeys(setOf("type", "id"), path)
        reference.requireConstant("type", "colorToken", "$path.type")
        return resolveColorToken(reference.requiredIdentifier("id", "$path.id"), path, visiting)
    }

    private fun resolveColorToken(id: String, path: String, visiting: MutableSet<String>): MosaicColor {
        val token = activeDesignSystem.get()?.colors?.get(id)
            ?: throw MosaicProtocolException("Unknown colour token $id at $path.")
        if (!visiting.add(id)) throw MosaicProtocolException("Cyclic colour token reference at $path.")
        return try {
            resolveColor(token.value, "${token.path}.value", visiting)
        } finally {
            visiting.remove(id)
        }
    }

    private fun background(value: JsonElement, path: String): MosaicBackground =
        resolveBackground(value, path, linkedSetOf())

    private fun resolveBackground(
        value: JsonElement,
        path: String,
        visiting: MutableSet<String>,
    ): MosaicBackground {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "color" -> {
                objectValue.expectKeys(setOf("type", "value"), path)
                MosaicBackground.Solid(color(objectValue.required("value", path), "$path.value"))
            }
            "linearGradient" -> {
                objectValue.expectKeys(setOf("type", "angle", "stops"), path)
                MosaicBackground.LinearGradient(
                    objectValue.requiredNumber(
                        "angle", "$path.angle", BigDecimal.ZERO, BigDecimal("360"), false,
                    ).toFloat(),
                    gradientStops(objectValue.required("stops", path), "$path.stops"),
                )
            }
            "radialGradient" -> {
                objectValue.expectKeys(setOf("type", "center", "radius", "stops"), path)
                val center = objectValue.required("center", path).objectAt("$path.center")
                center.expectKeys(setOf("x", "y"), "$path.center")
                MosaicBackground.RadialGradient(
                    center.requiredNumber(
                        "x", "$path.center.x", BigDecimal.ZERO, BigDecimal.ONE, false,
                    ).toFloat(),
                    center.requiredNumber(
                        "y", "$path.center.y", BigDecimal.ZERO, BigDecimal.ONE, false,
                    ).toFloat(),
                    objectValue.requiredNumber(
                        "radius", "$path.radius", BigDecimal.ZERO, BigDecimal("2"), true,
                    ).toFloat(),
                    gradientStops(objectValue.required("stops", path), "$path.stops"),
                )
            }
            "image" -> {
                objectValue.expectKeys(setOf("type", "assetId", "contentMode", "fallbackColor"), path)
                MosaicBackground.Image(
                    objectValue.requiredIdentifier("assetId", "$path.assetId"),
                    imageContentMode(objectValue, "contentMode", "$path.contentMode"),
                    color(objectValue.required("fallbackColor", path), "$path.fallbackColor"),
                )
            }
            "video" -> {
                objectValue.expectKeys(
                    setOf("type", "assetId", "posterAssetId", "contentMode", "fallbackColor"),
                    path,
                    optional = setOf("posterAssetId"),
                )
                MosaicBackground.Video(
                    objectValue.requiredIdentifier("assetId", "$path.assetId"),
                    objectValue.optional("posterAssetId")?.let {
                        objectValue.requiredIdentifier("posterAssetId", "$path.posterAssetId")
                    },
                    imageContentMode(objectValue, "contentMode", "$path.contentMode"),
                    color(objectValue.required("fallbackColor", path), "$path.fallbackColor"),
                )
            }
            "backgroundToken" -> {
                objectValue.expectKeys(setOf("type", "id"), path)
                resolveBackgroundToken(
                    objectValue.requiredIdentifier("id", "$path.id"),
                    path,
                    visiting,
                )
            }
            else -> throw MosaicProtocolException("Invalid background at $path.type.")
        }
    }

    private fun resolveBackgroundToken(
        id: String,
        path: String,
        visiting: MutableSet<String>,
    ): MosaicBackground {
        val token = activeDesignSystem.get()?.backgrounds?.get(id)
            ?: throw MosaicProtocolException("Unknown background token $id at $path.")
        if (!visiting.add(id)) throw MosaicProtocolException("Cyclic background token reference at $path.")
        return try {
            resolveBackground(token.value, "${token.path}.value", visiting)
        } finally {
            visiting.remove(id)
        }
    }

    private fun gradientStops(value: JsonElement, path: String): List<MosaicGradientStop> {
        val stops = value.boundedArrayAt(path, 2, 8).mapIndexed { index, stopElement ->
            val stopPath = "$path[$index]"
            val stop = stopElement.objectAt(stopPath)
            stop.expectKeys(setOf("position", "color"), stopPath)
            MosaicGradientStop(
                stop.requiredNumber(
                    "position", "$stopPath.position", BigDecimal.ZERO, BigDecimal.ONE, false,
                ).toFloat(),
                color(stop.required("color", stopPath), "$stopPath.color"),
            )
        }
        if (stops.zipWithNext().any { (left, right) -> left.position >= right.position }) {
            throw MosaicProtocolException("Gradient stops must be strictly ordered at $path.")
        }
        return stops
    }

    private fun shadow(value: JsonElement, path: String): MosaicShadow =
        resolveShadow(value, path, linkedSetOf())

    private fun resolveShadow(
        value: JsonElement,
        path: String,
        visiting: MutableSet<String>,
    ): MosaicShadow {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "shadow" -> {
                objectValue.expectKeys(
                    setOf("type", "color", "offsetX", "offsetY", "blurRadius"), path,
                )
                MosaicShadow(
                    color(objectValue.required("color", path), "$path.color"),
                    objectValue.requiredNumber(
                        "offsetX", "$path.offsetX", BigDecimal("-4096"), BigDecimal("4096"), false,
                    ),
                    objectValue.requiredNumber(
                        "offsetY", "$path.offsetY", BigDecimal("-4096"), BigDecimal("4096"), false,
                    ),
                    objectValue.requiredLogicalSize("blurRadius", "$path.blurRadius"),
                )
            }
            "shadowToken" -> {
                objectValue.expectKeys(setOf("type", "id"), path)
                resolveShadowToken(objectValue.requiredIdentifier("id", "$path.id"), path, visiting)
            }
            else -> throw MosaicProtocolException("Invalid shadow at $path.type.")
        }
    }

    private fun resolveShadowToken(
        id: String,
        path: String,
        visiting: MutableSet<String>,
    ): MosaicShadow {
        val token = activeDesignSystem.get()?.shadows?.get(id)
            ?: throw MosaicProtocolException("Unknown shadow token $id at $path.")
        if (!visiting.add(id)) throw MosaicProtocolException("Cyclic shadow token reference at $path.")
        return try {
            resolveShadow(token.value, "${token.path}.value", visiting)
        } finally {
            visiting.remove(id)
        }
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
                objectValue.expectKeys(
                    setOf("role", "label"),
                    path,
                    optional = setOf("label"),
                )
                objectValue.optional("label")?.let {
                    MosaicTextAccessibility.LabelledText(localizedText(it, "$path.label"))
                } ?: MosaicTextAccessibility.Text
            }
            "heading" -> {
                objectValue.expectKeys(
                    setOf("role", "level", "label"),
                    path,
                    optional = setOf("label"),
                )
                val level = objectValue.requiredIntegerInRange("level", "$path.level", 1..6)
                objectValue.optional("label")?.let {
                    MosaicTextAccessibility.LabelledHeading(
                        level,
                        localizedText(it, "$path.label"),
                    )
                } ?: MosaicTextAccessibility.Heading(level)
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

    private fun buttonAction(value: JsonElement, path: String): MosaicAction {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "purchase" -> purchaseAction(value, path)
            "restore" -> restoreAction(value, path)
            "close" -> closeAction(value, path)
            "navigateTo" -> {
                objectValue.expectKeys(setOf("type", "screenId"), path)
                MosaicNavigateToAction(
                    objectValue.requiredIdentifier("screenId", "$path.screenId"),
                )
            }
            "navigateBack" -> {
                objectValue.expectKeys(setOf("type"), path)
                MosaicNavigateBackAction
            }
            "openExternalUrl" -> {
                objectValue.expectKeys(setOf("type", "url"), path)
                MosaicOpenExternalUrlAction(
                    validateExternalUrl(objectValue.requiredString("url", "$path.url"), "$path.url"),
                )
            }
            else -> throw MosaicProtocolException("Invalid button action at $path.type.")
        }
    }

    private fun validateExternalUrl(rawUrl: String, path: String): String {
        val match = externalUrlPattern.matchEntire(rawUrl)
        if (rawUrl.codePointLength() !in 1..2048 || match == null) {
            throw MosaicProtocolException("Invalid external URL at $path.")
        }
        val parsed = try {
            URI(rawUrl)
        } catch (_: Exception) {
            throw MosaicProtocolException("Invalid external URL at $path.")
        }
        val rawHost = match.groupValues[1]
        val rawPort = match.groupValues[2].takeIf(String::isNotEmpty)?.toInt()
        if (parsed.scheme != "https" || parsed.host.isNullOrBlank() || parsed.userInfo != null ||
            rawHost.contains("..") || !rawHost.equals(parsed.host, ignoreCase = true) ||
            (rawPort != null && rawPort > 65535)
        ) {
            throw MosaicProtocolException(
                "External URLs must be absolute HTTPS URLs without credentials at $path.",
            )
        }
        return rawUrl
    }

    private fun optionalBoxAppearance(objectValue: JsonObject, path: String): MosaicBoxAppearance? =
        objectValue.optional("appearance")?.let { boxAppearance(it, "$path.appearance") }

    private fun optionalWidthSizing(objectValue: JsonObject, path: String): MosaicBoxSizing? =
        objectValue.optional("sizing")?.let { safeBoxSizing(it, "$path.sizing") }

    private fun optionalOuterInsets(objectValue: JsonObject, path: String): MosaicEdgeInsets? =
        objectValue.optional("outerInsets")?.let { edgeInsets(it, "$path.outerInsets") }

    private fun optionalVisibility(objectValue: JsonObject, path: String): MosaicVisibility =
        objectValue.optional("visibility")?.let { visibility(it, "$path.visibility") }
            ?: MosaicVisibility.Always

    private fun validateDocumentSemantics(
        document: MosaicPaywallDocument,
        root: JsonObject,
        capabilityReport: MosaicCapabilityReport,
    ) {
        if (document.localization.defaultLocale !in document.localization.locales) {
            throw MosaicProtocolException("The default locale is not declared.")
        }
        if (document.localization.fallbackLocale !in document.localization.locales) {
            throw MosaicProtocolException("The fallback locale is not declared.")
        }
        requireUnique(document.screens.map(MosaicPaywallScreen::id), "screen IDs")
        if (document.screens.size > 1 && document.screens.any { it.accessibilityLabel == null }) {
            throw MosaicProtocolException("Every screen requires an accessibilityLabel in a multi-screen document.")
        }
        document.screens.forEach { screen ->
            if (screen.layout.content.direction != MosaicStackDirection.VERTICAL) {
                throw MosaicProtocolException("Root scroll content must be a vertical stack on screen ${screen.id}.")
            }
            if (screen.layout.content.children.isEmpty()) {
                throw MosaicProtocolException("Root scroll content must contain at least one child on screen ${screen.id}.")
            }
        }

        val nodesByScreen = document.screens.associate { screen ->
            screen.id to screen.layout.content.walkDepthFirst().toList()
        }
        val nodes = nodesByScreen.values.flatten()
        val pages = nodes.filterIsInstance<MosaicCarouselComponent>().flatMap { it.pages }
        requireUnique(
            document.screens.map { it.layout.id } +
                nodes.map(MosaicNode::id) +
                pages.map(MosaicCarouselPage::id),
            "layout/component/page IDs",
        )
        nodes.filterIsInstance<MosaicFeatureListComponent>().forEach { featureList ->
            requireUnique(featureList.items.map(MosaicFeatureListItem::id), "feature IDs in ${featureList.id}")
        }
        requireUnique(document.assets.map(MosaicAsset::id), "asset IDs")
        requireUnique(document.products.map(MosaicProductReference::id), "product reference IDs")
        requireUnique(document.products.map(MosaicProductReference::providerProductId), "provider product IDs")

        validateAssetReferences(document, nodes)
        validateProductReferences(document, nodesByScreen)
        validateLocalizationSemantics(document, nodes)
        validateProductTemplates(document)
        validateRuntimeSemantics(document, nodesByScreen)

        val derived = deriveCapabilities(document, root)
        val declared = document.compatibility.requiredCapabilities.map(MosaicRequiredCapability::name).toSet()
        if (declared != derived) {
            val missing = derived - declared
            val unused = declared - derived
            throw MosaicProtocolException(
                "Capability declarations do not match document content " +
                    "(missing=${missing.map { it.wireName }.sorted()}, " +
                    "unused=${unused.map { it.wireName }.sorted()}).",
            )
        }
        document.compatibility.requiredCapabilities.forEach { required ->
            if (!capabilityReport.supports(required)) {
                throw MosaicProtocolException(
                    "The Android SDK does not support ${required.name.wireName}@${required.version}.",
                )
            }
        }
    }

    private fun validateAssetReferences(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ) {
        val assetsById = document.assets.associateBy(MosaicAsset::id)
        val used = mutableSetOf<String>()
        nodes.filterIsInstance<MosaicImageComponent>().forEach { image ->
            val asset = assetsById[image.assetId]
            if (asset !is MosaicImageAsset) {
                throw MosaicProtocolException("Image ${image.id} references an unknown asset.")
            }
            used += image.assetId
        }
        fun validateBackground(owner: String, background: MosaicBackground?) {
            when (background) {
                is MosaicBackground.Image -> {
                    if (assetsById[background.assetId] !is MosaicImageAsset) {
                        throw MosaicProtocolException("$owner references a non-image background asset.")
                    }
                    used += background.assetId
                }
                is MosaicBackground.Video -> {
                    if (assetsById[background.assetId] !is MosaicVideoAsset) {
                        throw MosaicProtocolException("$owner references a non-video background asset.")
                    }
                    used += background.assetId
                    background.posterAssetId?.let { posterId ->
                        if (assetsById[posterId] !is MosaicImageAsset) {
                            throw MosaicProtocolException("$owner references a non-image poster asset.")
                        }
                        used += posterId
                    }
                }
                else -> Unit
            }
        }
        document.designSystem.backgrounds.forEach { token ->
            validateBackground("Background token ${token.id}", token.value)
        }
        document.screens.forEach { screen ->
            validateBackground("Screen ${screen.id}", screen.layout.background)
        }
        nodes.forEach { node ->
            validateBackground("${node.type} ${node.id}", node.appearanceOrNull()?.background)
            when (node) {
                is MosaicProductCardComponent -> {
                    validateBackground("Product Card ${node.id} Default", node.styles.defaultStyle.background)
                    validateBackground("Product Card ${node.id} Selected", node.styles.selected.background)
                }
                is MosaicProductBadgeComponent -> {
                    validateBackground("Product Badge ${node.id} Default", node.styles.defaultStyle.background)
                    validateBackground("Product Badge ${node.id} Selected", node.styles.selected.background)
                }
                else -> Unit
            }
        }
        if (used != assetsById.keys) {
            throw MosaicProtocolException("Asset declarations must be used exactly by the document.")
        }
    }

    private fun validateProductReferences(
        document: MosaicPaywallDocument,
        nodesByScreen: Map<String, List<MosaicNode>>,
    ) {
        val nodes = nodesByScreen.values.flatten()
        val productsById = document.products.associateBy(MosaicProductReference::id)
        val selectors = nodes.filterIsInstance<MosaicProductSelectorComponent>()
        val usedProductIds = mutableSetOf<String>()
        selectors.forEach { selector ->
            requireUnique(selector.cards.map(MosaicProductCardComponent::id), "Product Card IDs in ${selector.id}")
            requireUnique(
                selector.cards.map(MosaicProductCardComponent::productReferenceId),
                "product references in ${selector.id}",
            )
            selector.cards.forEach { card ->
                val referenceId = card.productReferenceId
                if (referenceId !in productsById) {
                    throw MosaicProtocolException(
                        "Product selector ${selector.id} references an unknown product.",
                    )
                }
                usedProductIds += referenceId
            }
            if (selector.cards.none { it.id == selector.initialProductCardId }) {
                throw MosaicProtocolException(
                    "Product selector ${selector.id} initially selects an undeclared Product Card.",
                )
            }
        }
        if (usedProductIds != productsById.keys) {
            throw MosaicProtocolException("Product declarations must be used exactly by the document.")
        }
        nodesByScreen.forEach { (screenId, screenNodes) ->
            val selectorsById = screenNodes.filterIsInstance<MosaicProductSelectorComponent>()
                .associateBy(MosaicProductSelectorComponent::id)
            val purchases = screenNodes.filterIsInstance<MosaicButtonComponent>()
                .filter { it.action is MosaicPurchaseAction }
            purchases.forEach { button ->
                val targetId = (button.action as MosaicPurchaseAction).productSelectorId
                if (targetId !in selectorsById) {
                    throw MosaicProtocolException(
                        "Purchase button ${button.id} must reference a product selector on screen $screenId.",
                    )
                }
            }
            selectorsById.values.forEach { selector ->
                if (purchases.none {
                        (it.action as MosaicPurchaseAction).productSelectorId == selector.id
                    }
                ) {
                    throw MosaicProtocolException("Product selector ${selector.id} has no purchase action.")
                }
            }
        }
    }

    private fun validateLocalizationSemantics(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ) {
        val values = buildList {
            document.screens.forEach { screen -> screen.accessibilityLabel?.let(::add) }
            document.assets.filterIsInstance<MosaicImageAsset>().forEach { add(it.placeholder) }
            document.products.forEach { product ->
                add(product.label)
                product.badge?.let(::add)
            }
            nodes.forEach { node ->
                when (node) {
                    is MosaicStack -> Unit
                    is MosaicButtonComponent -> addControlAccessibility(node.accessibility)
                    is MosaicIconComponent -> {
                        val accessibility = node.accessibility
                        if (accessibility is MosaicImageAccessibility.Informative) add(accessibility.label)
                    }
                    is MosaicTextComponent -> {
                        add(node.value)
                        node.accessibility.labelOrNull?.let(::add)
                    }
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
                    is MosaicProductCardComponent -> node.accessibilityLabel?.let(::add)
                    is MosaicProductBadgeComponent -> Unit
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
                    is MosaicLegalTextComponent -> {
                        add(node.value)
                        node.accessibility.labelOrNull?.let(::add)
                    }
                    is MosaicCarouselComponent -> {
                        addControlAccessibility(node.accessibility)
                        node.pages.forEach { add(it.accessibilityLabel) }
                    }
                    is MosaicSwitchComponent -> {
                        add(node.label)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicCountdownComponent -> {
                        add(node.completedText)
                        node.accessibility.labelOrNull?.let(::add)
                    }
                }
            }
        }
        val defaultStrings = checkNotNull(
            document.localization.locales[document.localization.defaultLocale],
        ).strings
        val referencedKeys = values.map(MosaicLocalizedText::localizationKey).toSet()
        if (defaultStrings.keys != referencedKeys) {
            throw MosaicProtocolException(
                "Default locale keys must exactly match the document's localized values.",
            )
        }
        values.forEach { value ->
            if (defaultStrings[value.localizationKey] != value.defaultValue) {
                throw MosaicProtocolException("Inline defaults must equal the default locale catalog.")
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

    private data class ProductTemplateAnalysis(
        val malformed: Boolean,
        val variables: List<String>,
    )

    private fun analyzeProductTemplate(value: String): ProductTemplateAnalysis {
        val variables = mutableListOf<String>()
        val remainder = productTemplatePattern.replace(value) { match ->
            variables += match.groupValues[1]
            ""
        }
        return ProductTemplateAnalysis(
            malformed = "{{" in remainder || "}}" in remainder,
            variables = variables,
        )
    }

    private fun localizedValues(
        document: MosaicPaywallDocument,
        text: MosaicLocalizedText,
    ): List<String> = buildList {
        add(text.defaultValue)
        document.localization.locales.values.forEach { catalog ->
            catalog.strings[text.localizationKey]?.let(::add)
        }
    }

    private fun validateProductTemplates(document: MosaicPaywallDocument) {
        fun validate(text: MosaicLocalizedText, allowed: Boolean, owner: String) {
            localizedValues(document, text).forEach { value ->
                val analysis = analyzeProductTemplate(value)
                if (analysis.malformed) {
                    throw MosaicProtocolException("$owner contains a malformed product template expression.")
                }
                if (!allowed && analysis.variables.isNotEmpty()) {
                    throw MosaicProtocolException(
                        "$owner uses a product template outside Product Card Text or accessibility.",
                    )
                }
            }
        }

        fun validateControl(accessibility: MosaicControlAccessibility, owner: String) {
            validate(accessibility.label, false, "$owner accessibility label")
            accessibility.hint?.let { validate(it, false, "$owner accessibility hint") }
        }

        fun visit(node: MosaicNode, insideProductCard: Boolean) {
            when (node) {
                is MosaicStack -> node.children.forEach { visit(it, insideProductCard) }
                is MosaicTextComponent -> {
                    validate(node.value, insideProductCard, "Text ${node.id}")
                    node.accessibility.labelOrNull?.let {
                        validate(it, false, "Text ${node.id} accessibility label")
                    }
                }
                is MosaicImageComponent -> {
                    val accessibility = node.accessibility
                    if (accessibility is MosaicImageAccessibility.Informative) {
                        validate(accessibility.label, false, "Image ${node.id} accessibility label")
                    }
                }
                is MosaicIconComponent -> {
                    val accessibility = node.accessibility
                    if (accessibility is MosaicImageAccessibility.Informative) {
                        validate(accessibility.label, false, "Icon ${node.id} accessibility label")
                    }
                }
                is MosaicFeatureListComponent -> {
                    node.items.forEach { validate(it.text, false, "Feature ${it.id}") }
                    validateControl(node.accessibility, "Feature List ${node.id}")
                }
                is MosaicProductSelectorComponent -> {
                    validate(node.unavailableFallback.message, false, "Product Selector ${node.id} fallback")
                    validateControl(node.accessibility, "Product Selector ${node.id}")
                    node.cards.forEach { visit(it, false) }
                }
                is MosaicProductCardComponent -> {
                    node.accessibilityLabel?.let {
                        validate(it, true, "Product Card ${node.id} accessibility label")
                    }
                    node.children.forEach { visit(it, true) }
                }
                is MosaicProductBadgeComponent -> node.children.forEach { visit(it, insideProductCard) }
                is MosaicButtonComponent -> {
                    validateControl(node.accessibility, "Button ${node.id}")
                    node.children.forEach { visit(it, false) }
                    node.inProgressChildren.orEmpty().forEach { visit(it, false) }
                }
                is MosaicCarouselComponent -> {
                    validateControl(node.accessibility, "Carousel ${node.id}")
                    node.pages.forEach { page ->
                        validate(page.accessibilityLabel, false, "Carousel page ${page.id}")
                        visit(page.content, false)
                    }
                }
                is MosaicSwitchComponent -> {
                    validate(node.label, false, "Switch ${node.id} label")
                    validateControl(node.accessibility, "Switch ${node.id}")
                }
                is MosaicCountdownComponent -> {
                    validate(node.completedText, false, "Countdown ${node.id} completion")
                    node.accessibility.labelOrNull?.let {
                        validate(it, false, "Countdown ${node.id} accessibility label")
                    }
                }
                is MosaicPurchaseButtonComponent,
                is MosaicRestoreButtonComponent,
                is MosaicCloseButtonComponent,
                is MosaicLegalTextComponent,
                -> Unit // Retired specialized nodes cannot occur in a strict Protocol 0.2 document.
            }
        }

        document.assets.filterIsInstance<MosaicImageAsset>().forEach {
            validate(it.placeholder, false, "Asset ${it.id} fallback")
        }
        document.products.forEach { validate(it.label, false, "Product ${it.id} label") }
        document.screens.forEach { screen ->
            screen.accessibilityLabel?.let { validate(it, false, "Screen ${screen.id} label") }
            visit(screen.layout.content, false)
        }
    }

    private fun documentUsesProductTemplates(document: MosaicPaywallDocument): Boolean {
        fun uses(text: MosaicLocalizedText): Boolean = localizedValues(document, text).any { value ->
            analyzeProductTemplate(value).variables.isNotEmpty()
        }
        return document.walkNodesDepthFirst().any { node ->
            (node is MosaicTextComponent && uses(node.value) &&
                document.walkNodesDepthFirst().any { ancestor ->
                    ancestor is MosaicProductCardComponent && ancestor.containsNode(node.id)
                }) ||
                (node is MosaicProductCardComponent && node.accessibilityLabel?.let(::uses) == true)
        }
    }

    private fun MosaicProductCardComponent.containsNode(targetId: String): Boolean {
        fun contains(node: MosaicNode): Boolean = when (node) {
            is MosaicStack -> node.id == targetId || node.children.any(::contains)
            is MosaicProductBadgeComponent -> node.id == targetId || node.children.any(::contains)
            else -> node.id == targetId
        }
        return children.any(::contains)
    }

    private fun validateRuntimeSemantics(
        document: MosaicPaywallDocument,
        nodesByScreen: Map<String, List<MosaicNode>>,
    ) {
        nodesByScreen.values.flatten().filterIsInstance<MosaicProductSelectorComponent>()
            .forEach { selector ->
                selector.cards.forEach(::validateProductCardStructure)
            }
        val screenIds = document.screens.map(MosaicPaywallScreen::id).toSet()
        val forwardEdges = document.screens.associate { it.id to mutableSetOf<String>() }
        document.screens.forEach { screen ->
            val nodes = nodesByScreen.getValue(screen.id)
            val switches = nodes.filterIsInstance<MosaicSwitchComponent>()
                .associateBy(MosaicSwitchComponent::id)
            nodes.forEach { node ->
                val nodeVisibility = node.visibilityOrAlways()
                if (nodeVisibility is MosaicVisibility.SwitchValue) {
                    if (nodeVisibility.switchId !in switches) {
                        throw MosaicProtocolException(
                            "${node.type} ${node.id} visibility must reference a switch on screen ${screen.id}.",
                        )
                    }
                    if (nodeVisibility.switchId == node.id) {
                        throw MosaicProtocolException("${node.type} ${node.id} visibility references itself.")
                    }
                }
                when (node) {
                    is MosaicCarouselComponent -> {
                        if (node.initialPageIndex !in node.pages.indices) {
                            throw MosaicProtocolException(
                                "Carousel ${node.id} initialPageIndex must reference an existing page.",
                            )
                        }
                    }
                    is MosaicCountdownComponent -> {
                        if (node.largestUnit.rank < node.smallestUnit.rank) {
                            throw MosaicProtocolException(
                                "Countdown ${node.id} largestUnit must not be smaller than smallestUnit.",
                            )
                        }
                    }
                    is MosaicButtonComponent -> {
                        if (node.inProgressChildren != null &&
                            node.action !is MosaicPurchaseAction &&
                            node.action !is MosaicRestoreAction
                        ) {
                            throw MosaicProtocolException(
                                "Button ${node.id} may only declare inProgressChildren for purchase or restore.",
                            )
                        }
                        node.children.forEach { validatePassiveButtonChild(node.id, it) }
                        node.inProgressChildren.orEmpty().forEach {
                            validatePassiveButtonChild(node.id, it)
                        }
                        val action = node.action
                        if (action is MosaicNavigateToAction) {
                            if (action.screenId !in screenIds) {
                                throw MosaicProtocolException(
                                    "Button ${node.id} navigates to an unknown screen.",
                                )
                            }
                            if (action.screenId == screen.id) {
                                throw MosaicProtocolException(
                                    "Button ${node.id} cannot navigate to its own screen.",
                                )
                            }
                            forwardEdges.getValue(screen.id) += action.screenId
                        }
                    }
                    else -> Unit
                }
            }
            validateNoNestedCarousel(screen.layout.content, insideCarousel = false)
        }
        validateScreenGraph(document.initialScreenId, screenIds, forwardEdges)
    }

    private fun validateProductCardStructure(card: MosaicProductCardComponent) {
        if (card.children.count { it is MosaicProductBadgeComponent } > 1) {
            throw MosaicProtocolException(
                "Product Card ${card.id} may contain at most one direct Product Badge.",
            )
        }
        var descendantCount = 0
        var maximumStackDepth = 0

        fun visit(node: MosaicNode, stackDepth: Int, badgeAllowed: Boolean) {
            descendantCount += 1
            when (node) {
                is MosaicStack -> {
                    val nextDepth = stackDepth + 1
                    maximumStackDepth = maxOf(maximumStackDepth, nextDepth)
                    node.children.forEach { visit(it, nextDepth, badgeAllowed = false) }
                }
                is MosaicProductBadgeComponent -> {
                    if (!badgeAllowed) {
                        throw MosaicProtocolException(
                            "Product Badge ${node.id} must be a direct Product Card child.",
                        )
                    }
                    node.children.forEach { visit(it, stackDepth, badgeAllowed = false) }
                }
                is MosaicTextComponent,
                is MosaicImageComponent,
                is MosaicIconComponent,
                is MosaicFeatureListComponent,
                is MosaicCountdownComponent,
                -> Unit
                else -> throw MosaicProtocolException(
                    "Product Card ${card.id} contains interactive or unsupported child ${node.id}.",
                )
            }
        }

        card.children.forEach { visit(it, stackDepth = 0, badgeAllowed = true) }
        if (descendantCount > 20) {
            throw MosaicProtocolException("Product Card ${card.id} exceeds 20 passive descendants.")
        }
        if (maximumStackDepth > 4) {
            throw MosaicProtocolException("Product Card ${card.id} exceeds nested Stack depth 4.")
        }
    }

    private fun validatePassiveButtonChild(buttonId: String, node: MosaicNode) {
        when (node) {
            is MosaicButtonComponent,
            is MosaicProductSelectorComponent,
            is MosaicSwitchComponent,
            is MosaicCarouselComponent,
            -> throw MosaicProtocolException(
                "Button $buttonId contains interactive or paged component ${node.id}.",
            )
            is MosaicStack -> node.children.forEach { validatePassiveButtonChild(buttonId, it) }
            else -> Unit
        }
    }

    private fun validateScreenGraph(
        initialScreenId: String,
        screenIds: Set<String>,
        forwardEdges: Map<String, Set<String>>,
    ) {
        val reachable = mutableSetOf<String>()
        val pending = ArrayDeque<String>()
        pending += initialScreenId
        while (pending.isNotEmpty()) {
            val current = pending.removeFirst()
            if (!reachable.add(current)) continue
            forwardEdges[current].orEmpty().forEach(pending::addLast)
        }
        if (reachable != screenIds) {
            throw MosaicProtocolException(
                "Every screen must be reachable from initialScreenId; unreachable=${(screenIds - reachable).sorted()}.",
            )
        }

        val active = mutableSetOf<String>()
        val complete = mutableSetOf<String>()
        fun visit(screenId: String) {
            if (screenId in complete) return
            if (!active.add(screenId)) {
                throw MosaicProtocolException("navigateTo actions must form an acyclic forward graph.")
            }
            forwardEdges[screenId].orEmpty().forEach(::visit)
            active -= screenId
            complete += screenId
        }
        screenIds.forEach(::visit)
    }

    private fun validateNoNestedCarousel(stack: MosaicStack, insideCarousel: Boolean) {
        stack.children.forEach { child ->
            when (child) {
                is MosaicStack -> validateNoNestedCarousel(child, insideCarousel)
                is MosaicCarouselComponent -> {
                    if (insideCarousel) {
                        throw MosaicProtocolException("Carousel ${child.id} cannot be nested in a carousel.")
                    }
                    child.pages.forEach { validateNoNestedCarousel(it.content, insideCarousel = true) }
                }
                is MosaicButtonComponent -> {
                    child.children.filterIsInstance<MosaicStack>().forEach {
                        validateNoNestedCarousel(it, insideCarousel)
                    }
                    child.inProgressChildren.orEmpty().filterIsInstance<MosaicStack>().forEach {
                        validateNoNestedCarousel(it, insideCarousel)
                    }
                }
                else -> Unit
            }
        }
    }

    private fun MosaicNode.visibilityOrAlways(): MosaicVisibility = when (this) {
        is MosaicStack -> visibility
        is MosaicTextComponent -> visibility
        is MosaicImageComponent -> visibility
        is MosaicFeatureListComponent -> visibility
        is MosaicProductSelectorComponent -> visibility
        is MosaicPurchaseButtonComponent -> visibility
        is MosaicRestoreButtonComponent -> visibility
        is MosaicCloseButtonComponent -> visibility
        is MosaicLegalTextComponent -> visibility
        is MosaicCarouselComponent -> visibility
        is MosaicSwitchComponent -> visibility
        is MosaicCountdownComponent -> visibility
        is MosaicButtonComponent -> visibility
        is MosaicIconComponent -> visibility
        is MosaicProductCardComponent,
        is MosaicProductBadgeComponent,
        -> MosaicVisibility.Always
    }

    private fun MosaicNode.appearanceOrNull(): MosaicBoxAppearance? = when (this) {
        is MosaicStack -> appearance
        is MosaicTextComponent -> appearance
        is MosaicImageComponent -> appearance
        is MosaicIconComponent -> appearance
        is MosaicFeatureListComponent -> appearance
        is MosaicProductSelectorComponent -> appearance
        is MosaicButtonComponent -> appearance
        is MosaicCarouselComponent -> appearance
        is MosaicSwitchComponent -> appearance
        is MosaicCountdownComponent -> appearance
        is MosaicPurchaseButtonComponent -> appearance
        is MosaicRestoreButtonComponent -> appearance
        is MosaicCloseButtonComponent -> appearance
        is MosaicLegalTextComponent -> appearance
        is MosaicProductCardComponent,
        is MosaicProductBadgeComponent,
        -> null
    }

    private fun deriveCapabilities(
        document: MosaicPaywallDocument,
        root: JsonObject,
    ): Set<MosaicCapabilityName> = buildSet {
        add(MosaicCapabilityName.LOCALIZATION_CATALOGS)
        add(MosaicCapabilityName.SCREENS)
        if (document.screens.any { it.presentation == MosaicScreenPresentation.SHEET }) {
            add(MosaicCapabilityName.SHEETS)
        }
        if (documentUsesProductTemplates(document)) add(MosaicCapabilityName.PRODUCT_TEMPLATE)
        if (document.localization.locales.values.any { it.direction == MosaicLayoutDirection.RTL }) {
            add(MosaicCapabilityName.LOCALIZATION_RTL)
        }
        if (document.products.isNotEmpty()) add(MosaicCapabilityName.PRODUCT_REFERENCES)
        document.assets.forEach { asset ->
            when (asset) {
                is MosaicImageAsset -> {
                    add(MosaicCapabilityName.ASSET_FALLBACK)
                    when (asset.source) {
                        is MosaicAssetSource.Bundled -> add(MosaicCapabilityName.BUNDLED_IMAGE)
                        is MosaicAssetSource.Remote -> add(MosaicCapabilityName.REMOTE_IMAGE)
                    }
                }
                is MosaicVideoAsset -> when (asset.source) {
                    is MosaicAssetSource.Bundled -> add(MosaicCapabilityName.BUNDLED_VIDEO)
                    is MosaicAssetSource.Remote -> add(MosaicCapabilityName.REMOTE_VIDEO)
                }
            }
        }
        val designSystem = root.getAsJsonObject("designSystem")
        if (designSystem.entrySet().any { (_, value) -> value.asJsonArray.size() > 0 }) {
            add(MosaicCapabilityName.DESIGN_TOKENS)
        }
        if (objectContainsType(root, setOf("linearGradient", "radialGradient"))) {
            add(MosaicCapabilityName.GRADIENT_BACKGROUND)
        }
        if (objectContainsField(root, "fallbackColor")) {
            add(MosaicCapabilityName.MEDIA_BACKGROUND)
        }
        if (objectContainsField(root, "shadow") || objectContainsType(root, setOf("shadowToken"))) {
            add(MosaicCapabilityName.SHADOW)
        }
        root.getAsJsonArray("screens").forEach { screenElement ->
            val screen = screenElement.asJsonObject
            if (screen.hasNonNull("accessibilityLabel")) {
                add(MosaicCapabilityName.ACCESSIBILITY_METADATA)
            }
            walkRawNodes(screen.getAsJsonObject("layout")).forEach { node ->
            when (node.requiredString("type", "$.screens.layout.type")) {
                "scrollContainer" -> add(MosaicCapabilityName.SCROLL_CONTAINER)
                "stack" -> add(MosaicCapabilityName.STACK)
                "text" -> add(MosaicCapabilityName.TEXT)
                "image" -> add(MosaicCapabilityName.IMAGE)
                "icon" -> add(MosaicCapabilityName.ICON)
                "featureList" -> add(MosaicCapabilityName.FEATURE_LIST)
                "productSelector" -> add(MosaicCapabilityName.PRODUCT_SELECTOR)
                "productCard" -> add(MosaicCapabilityName.PRODUCT_CARD)
                "productBadge" -> add(MosaicCapabilityName.PRODUCT_BADGE)
                "button" -> add(MosaicCapabilityName.BUTTON)
                "carousel" -> add(MosaicCapabilityName.CAROUSEL)
                "switch" -> add(MosaicCapabilityName.SWITCH)
                "countdown" -> add(MosaicCapabilityName.COUNTDOWN)
            }
            val type = node.get("type")?.asString
            if (node.hasNonNull("accessibility") || type == "carousel") {
                add(MosaicCapabilityName.ACCESSIBILITY_METADATA)
            }
            if (node.hasNonNull("typography")) add(MosaicCapabilityName.TYPOGRAPHY)
            if (node.hasNonNull("appearance") ||
                node.hasNonNull("styles") ||
                node.hasNonNull("padding") ||
                (type == "scrollContainer" && node.hasNonNull("background"))
            ) {
                add(MosaicCapabilityName.BOX_STYLE)
            }
            if (node.hasNonNull("sizing")) {
                add(MosaicCapabilityName.SIZING)
                add(MosaicCapabilityName.HEIGHT_SIZING)
            }
            if (node.hasNonNull("outerInsets")) add(MosaicCapabilityName.OUTER_INSETS)
            if (node.getAsJsonObjectOrNull("appearance")?.has("clipContent") == true) {
                add(MosaicCapabilityName.CLIPPING)
            }
            node.getAsJsonObjectOrNull("sizing")?.let { sizing ->
                if (sizing.entrySet().any { (_, axis) ->
                        axis.isJsonObject && axis.asJsonObject.get("mode")?.asString == "fixed"
                    }
                ) {
                    add(MosaicCapabilityName.CLIPPING)
                }
            }
            node.getAsJsonObjectOrNull("visibility")?.let { visibility ->
                if (visibility.get("mode")?.asString == "switch") {
                    add(MosaicCapabilityName.SWITCH_VISIBILITY)
                } else {
                    add(MosaicCapabilityName.STATIC_VISIBILITY)
                }
            }
            if (objectUsesColor(node)) add(MosaicCapabilityName.COLORS)
            if (type == "productSelector") {
                add(MosaicCapabilityName.PRODUCT_FALLBACK)
                add(MosaicCapabilityName.NORMALIZED_OUTCOME)
                add(MosaicCapabilityName.PRODUCT_CARD_STATES)
            }
            if (type == "productCard" || type == "productBadge") {
                add(MosaicCapabilityName.PRODUCT_CARD_STATES)
            }
            node.getAsJsonObjectOrNull("action")?.get("type")?.asString?.let { action ->
                when (action) {
                    "purchase" -> {
                        add(MosaicCapabilityName.PURCHASE_ACTION)
                        add(MosaicCapabilityName.NORMALIZED_OUTCOME)
                    }
                    "restore" -> {
                        add(MosaicCapabilityName.RESTORE_ACTION)
                        add(MosaicCapabilityName.NORMALIZED_OUTCOME)
                    }
                    "close" -> {
                        add(MosaicCapabilityName.CLOSE_ACTION)
                        add(MosaicCapabilityName.NORMALIZED_OUTCOME)
                    }
                    "navigateTo" -> add(MosaicCapabilityName.NAVIGATE_TO_ACTION)
                    "navigateBack" -> add(MosaicCapabilityName.NAVIGATE_BACK_ACTION)
                    "openExternalUrl" -> add(MosaicCapabilityName.OPEN_EXTERNAL_URL_ACTION)
                }
            }
        }
        }
    }

    private fun walkRawNodes(root: JsonObject): Sequence<JsonObject> = sequence {
        yield(root)
        when (root.get("type")?.asString) {
            "scrollContainer" -> yieldAll(walkRawNodes(root.getAsJsonObject("content")))
            "stack" -> root.getAsJsonArray("children").forEach { child ->
                yieldAll(walkRawNodes(child.asJsonObject))
            }
            "carousel" -> root.getAsJsonArray("pages").forEach { page ->
                yieldAll(walkRawNodes(page.asJsonObject.getAsJsonObject("content")))
            }
            "button" -> {
                root.getAsJsonArray("children").forEach { child ->
                    yieldAll(walkRawNodes(child.asJsonObject))
                }
                if (root.hasNonNull("inProgressChildren")) {
                    root.getAsJsonArray("inProgressChildren").forEach { child ->
                        yieldAll(walkRawNodes(child.asJsonObject))
                    }
                }
            }
            "productSelector" -> root.getAsJsonArray("cards").forEach { card ->
                yieldAll(walkRawNodes(card.asJsonObject))
            }
            "productCard", "productBadge" -> root.getAsJsonArray("children").forEach { child ->
                yieldAll(walkRawNodes(child.asJsonObject))
            }
        }
    }

    private val colorFieldNames = setOf(
        "background", "color", "markerColor", "offTrackColor", "onTrackColor",
        "productLabelColor", "runtimePriceColor", "textColor", "thumbColor",
    )

    private fun objectUsesColor(value: JsonElement): Boolean = when {
        value.isJsonArray -> value.asJsonArray.any(::objectUsesColor)
        value.isJsonObject -> value.asJsonObject.entrySet().any { (key, entry) ->
            (key in colorFieldNames &&
                (entry.isJsonPrimitive && entry.asJsonPrimitive.isString ||
                    entry.isJsonObject && entry.asJsonObject.get("type")?.asString == "colorToken")) ||
                objectUsesColor(entry)
        }
        else -> false
    }

    private fun objectContainsType(value: JsonElement, types: Set<String>): Boolean = when {
        value.isJsonArray -> value.asJsonArray.any { objectContainsType(it, types) }
        value.isJsonObject -> {
            val objectValue = value.asJsonObject
            objectValue.get("type")?.takeIf { it.isJsonPrimitive }?.asString in types ||
                objectValue.entrySet().any { (_, entry) -> objectContainsType(entry, types) }
        }
        else -> false
    }

    private fun objectContainsField(value: JsonElement, field: String): Boolean = when {
        value.isJsonArray -> value.asJsonArray.any { objectContainsField(it, field) }
        value.isJsonObject -> value.asJsonObject.has(field) ||
            value.asJsonObject.entrySet().any { (_, entry) -> objectContainsField(entry, field) }
        else -> false
    }

    private fun stackDirection(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "vertical" -> MosaicStackDirection.VERTICAL
            "horizontal" -> MosaicStackDirection.HORIZONTAL
            else -> throw MosaicProtocolException("Invalid stack direction at $path.")
        }

    private fun mainAxisDistribution(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "start" -> MosaicMainAxisDistribution.START
            "center" -> MosaicMainAxisDistribution.CENTER
            "end" -> MosaicMainAxisDistribution.END
            "spaceBetween" -> MosaicMainAxisDistribution.SPACE_BETWEEN
            else -> throw MosaicProtocolException("Invalid main-axis distribution at $path.")
        }

    private fun crossAxisAlignment(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "start" -> MosaicHorizontalAlignment.START
            "center" -> MosaicHorizontalAlignment.CENTER
            "end" -> MosaicHorizontalAlignment.END
            "stretch" -> MosaicHorizontalAlignment.STRETCH
            else -> throw MosaicProtocolException("Invalid cross-axis alignment at $path.")
        }

    private fun textAlignment(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "start" -> MosaicTextAlignment.START
            "center" -> MosaicTextAlignment.CENTER
            "end" -> MosaicTextAlignment.END
            else -> throw MosaicProtocolException("Invalid text alignment at $path.")
        }

    private fun typographyStyle(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "display" -> MosaicTypographyStyle.DISPLAY
            "title" -> MosaicTypographyStyle.TITLE
            "heading" -> MosaicTypographyStyle.HEADING
            "body" -> MosaicTypographyStyle.BODY
            "label" -> MosaicTypographyStyle.LABEL
            "caption" -> MosaicTypographyStyle.CAPTION
            else -> throw MosaicProtocolException("Invalid typography style at $path.")
        }

    private fun fontWeight(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "regular" -> MosaicFontWeight.REGULAR
            "medium" -> MosaicFontWeight.MEDIUM
            "semibold" -> MosaicFontWeight.SEMIBOLD
            "bold" -> MosaicFontWeight.BOLD
            else -> throw MosaicProtocolException("Invalid font weight at $path.")
        }

    private fun textOverflow(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "clip" -> MosaicTextOverflow.CLIP
            "ellipsis" -> MosaicTextOverflow.ELLIPSIS
            else -> throw MosaicProtocolException("Invalid text overflow at $path.")
        }

    private fun imageContentMode(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "fit" -> MosaicImageContentMode.FIT
            "fill" -> MosaicImageContentMode.FILL
            else -> throw MosaicProtocolException("Invalid image content mode at $path.")
        }

    private fun productCardContentAlignment(
        objectValue: JsonObject,
        name: String,
        path: String,
    ) = when (objectValue.requiredString(name, path)) {
        "start" -> MosaicProductCardContentAlignment.START
        "center" -> MosaicProductCardContentAlignment.CENTER
        "end" -> MosaicProductCardContentAlignment.END
        "spaceBetween" -> MosaicProductCardContentAlignment.SPACE_BETWEEN
        else -> throw MosaicProtocolException("Invalid product-card alignment at $path.")
    }

    private fun countdownUnit(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "day" -> MosaicCountdownUnit.DAY
            "hour" -> MosaicCountdownUnit.HOUR
            "minute" -> MosaicCountdownUnit.MINUTE
            "second" -> MosaicCountdownUnit.SECOND
            else -> throw MosaicProtocolException("Invalid countdown unit at $path.")
        }

    private fun parseCanonicalUtcTimestamp(value: String, path: String): Long {
        if (!utcTimestampPattern.matches(value)) {
            throw MosaicProtocolException("Countdown timestamp is not canonical UTC at $path.")
        }
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val parsed = runCatching { format.parse(value) }.getOrNull()
            ?: throw MosaicProtocolException("Countdown timestamp is invalid at $path.")
        if (format.format(parsed) != value) {
            throw MosaicProtocolException("Countdown timestamp is not canonical UTC at $path.")
        }
        return parsed.time
    }

    private fun requireUnique(values: List<String>, description: String) {
        if (values.toSet().size != values.size) {
            throw MosaicProtocolException("Duplicate $description are not allowed.")
        }
    }

    private fun JsonObject.required(name: String, path: String): JsonElement = get(name)
        ?.takeUnless { it is JsonNull }
        ?: throw MosaicProtocolException("Missing property $name at $path.")

    private fun JsonObject.optional(name: String): JsonElement? = get(name)?.takeUnless { it is JsonNull }

    private fun JsonObject.hasNonNull(name: String): Boolean =
        has(name) && get(name) !is JsonNull

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

    private fun JsonObject.optionalBoolean(name: String, path: String): Boolean? =
        optional(name)?.let { value ->
            if (!value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
                throw MosaicProtocolException("Expected a boolean at $path.")
            }
            value.asBoolean
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
        val result = runCatching { number.intValueExact() }.getOrElse {
            throw MosaicProtocolException("Expected an integer at $path.")
        }
        if (result !in range) throw MosaicProtocolException("Integer is outside its range at $path.")
        return result
    }

    private fun JsonObject.requiredLogicalSize(name: String, path: String): Double = requiredNumber(
        name,
        path,
        BigDecimal.ZERO,
        BigDecimal("4096"),
    )

    private fun JsonObject.requiredPositiveLogicalSize(name: String, path: String): Double =
        requiredNumber(
            name,
            path,
            BigDecimal.ZERO,
            BigDecimal("4096"),
            exclusiveMinimum = true,
        )

    private fun JsonObject.optionalLogicalSize(name: String, path: String): Double? =
        optionalNumber(name, path, BigDecimal.ZERO, BigDecimal("4096"))

    private fun JsonObject.requiredNumber(
        name: String,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean = false,
    ): Double {
        val decimal = requiredDecimal(name, path)
        return checkedNumber(decimal, path, minimum, maximum, exclusiveMinimum)
    }

    private fun JsonObject.optionalNumber(
        name: String,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean = false,
    ): Double? = optional(name)?.let { value ->
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
            throw MosaicProtocolException("Expected a number at $path.")
        }
        val decimal = runCatching { value.asBigDecimal }.getOrElse {
            throw MosaicProtocolException("Expected a finite JSON number at $path.")
        }
        checkedNumber(decimal, path, minimum, maximum, exclusiveMinimum)
    }

    private fun checkedNumber(
        decimal: BigDecimal,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean,
    ): Double {
        val below = if (exclusiveMinimum) decimal <= minimum else decimal < minimum
        if (below || decimal > maximum) {
            throw MosaicProtocolException("Number is outside its range at $path.")
        }
        return decimal.toDouble().also { number ->
            if (!number.isFinite()) throw MosaicProtocolException("Expected a finite number at $path.")
        }
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
        if (!identifierPattern.matches(it)) throw MosaicProtocolException("Invalid identifier at $path.")
    }

    private fun validateLocalizationKey(value: String, path: String) {
        if (value.codePointLength() > 256 || !localizationKeyPattern.matches(value)) {
            throw MosaicProtocolException("Invalid localization key at $path.")
        }
    }

    private fun validateLocaleTag(value: String, path: String) {
        if (!localeTagPattern.matches(value)) {
            throw MosaicProtocolException("Invalid locale tag at $path.")
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

    private fun JsonElement.boundedArrayAt(path: String, minimum: Int, maximum: Int): JsonArray =
        arrayAt(path).also {
            if (it.size() !in minimum..maximum) {
                throw MosaicProtocolException("Array size is outside its range at $path.")
            }
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
        actual.forEach { key ->
            if (get(key) is JsonNull) {
                throw MosaicProtocolException("Null is not allowed for $key at $path.")
            }
        }
    }

    private fun JsonObject.getAsJsonObjectOrNull(name: String): JsonObject? =
        get(name)?.takeIf { it.isJsonObject }?.asJsonObject

    private fun String.codePointLength(): Int = codePointCount(0, length)
}
