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


internal fun validateDocumentSemantics(
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
    // A tab ID names a control, a panel, and the value a tab-visibility condition compares
    // against, so it shares the one layout namespace.
    val tabEntries = nodes.filterIsInstance<MosaicTabsComponent>().flatMap { it.tabs }
    requireUnique(
        document.screens.map { it.layout.id } +
            nodes.map(MosaicNode::id) +
            pages.map(MosaicCarouselPage::id) +
            tabEntries.map(MosaicTabEntry::id),
        "layout/component/page/tab IDs",
    )
    nodes.filterIsInstance<MosaicFeatureListComponent>().forEach { featureList ->
        requireUnique(featureList.items.map(MosaicFeatureListItem::id), "feature IDs in ${featureList.id}")
    }
    nodes.filterIsInstance<MosaicTimelineComponent>().forEach { timeline ->
        requireUnique(timeline.entries.map(MosaicTimelineEntry::id), "entry IDs in ${timeline.id}")
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

internal fun validateAssetReferences(
    document: MosaicPaywallDocument,
    nodes: List<MosaicNode>,
) {
    val assetsById = document.assets.associateBy(MosaicAsset::id)
    val used = mutableSetOf<String>()
    // Every place a component names an image asset, so an added component cannot leave its asset
    // uncounted and then be reported as unused.
    val imageAssetReferences: (MosaicNode) -> List<Pair<String, String>> = { node ->
        when (node) {
            is MosaicImageComponent -> listOf(node.assetId to "Image ${node.id}")
            is MosaicAwardComponent -> when (val emblem = node.emblem) {
                is MosaicAwardEmblem.Image -> listOf(emblem.assetId to "Award ${node.id} emblem")
                else -> emptyList()
            }
            is MosaicSocialProofComponent -> node.avatar?.let {
                listOf(it.assetId to "Social Proof ${node.id} avatar")
            }.orEmpty()
            else -> emptyList()
        }
    }
    nodes.forEach { node ->
        imageAssetReferences(node).forEach { (assetId, owner) ->
            if (assetsById[assetId] !is MosaicImageAsset) {
                throw MosaicProtocolException(
                    "$owner references an unknown or non-image asset.",
                    violation = MosaicProtocolViolation.INVALID_REFERENCE,
                )
            }
            used += assetId
        }
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
        validateBackground("${node.type} ${node.id}", node.semanticAppearanceOrNull()?.background)
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

internal fun validateProductReferences(
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
                    violation = MosaicProtocolViolation.INVALID_REFERENCE,
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

internal fun validateLocalizationSemantics(
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
                is MosaicTabsComponent -> {
                    node.tabs.forEach { add(it.label) }
                    addControlAccessibility(node.accessibility)
                }
                is MosaicTimelineComponent -> {
                    node.entries.forEach { entry ->
                        add(entry.title)
                        entry.description?.let(::add)
                    }
                    addControlAccessibility(node.accessibility)
                }
                is MosaicAwardComponent -> {
                    add(node.title)
                    node.subtitle?.let(::add)
                    addControlAccessibility(node.accessibility)
                }
                is MosaicSocialProofComponent -> {
                    add(node.quote)
                    add(node.attribution)
                    addControlAccessibility(node.accessibility)
                }
            }
        }
    }
    val defaultStrings = checkNotNull(
        document.localization.locales[document.localization.defaultLocale],
    ).strings
    val referencedKeys = values.map(MosaicLocalizedText::localizationKey).toSet()
    // Reserved keys are consumed by the protocol, not referenced by a component, so the exact-match
    // sweep would flag every one of them as unused.
    if (defaultStrings.keys - MosaicReservedAccessibilityKey.all != referencedKeys) {
        throw MosaicProtocolException(
            "Default locale keys must exactly match the document's localized values.",
        )
    }
    validateReservedAccessibilityStrings(document, nodes)
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

/**
 * Reserved accessibility strings, both directions.
 *
 * A missing key would leave the renderer inventing a phrase — the exact defect the fallback audit
 * found shipping as hardcoded English. A lingering one is copy nothing reads, which is how stale
 * strings survive a redesign.
 */
internal fun validateReservedAccessibilityStrings(
    document: MosaicPaywallDocument,
    nodes: List<MosaicNode>,
) {
    val consumers = mapOf(
        MosaicReservedAccessibilityKey.RATING to nodes.any {
            it is MosaicSocialProofComponent && it.rating != null
        },
        MosaicReservedAccessibilityKey.IN_PROGRESS to nodes.any {
            it is MosaicButtonComponent && it.inProgressChildren != null
        },
    )
    val defaultStrings = checkNotNull(
        document.localization.locales[document.localization.defaultLocale],
    ).strings
    consumers.forEach { (key, consumed) ->
        val declared = key in defaultStrings
        if (consumed && !declared) {
            throw MosaicProtocolException(
                "The default locale catalog must declare the reserved key $key.",
            )
        }
        if (!consumed && declared) {
            throw MosaicProtocolException(
                "The default locale catalog declares reserved key $key but nothing announces it.",
            )
        }
        if (!declared) return@forEach
        val placeholders = MosaicReservedAccessibilityKey.placeholdersByKey.getValue(key)
        document.localization.locales.forEach { (tag, catalog) ->
            val value = catalog.strings[key] ?: return@forEach
            placeholders.forEach { placeholder ->
                // A translation that drops a placeholder announces a rating with no number in it.
                if (value.split(placeholder).size - 1 != 1) {
                    throw MosaicProtocolException(
                        "Locale $tag key $key must contain $placeholder exactly once.",
                    )
                }
            }
            val residue = placeholders.fold(value) { text, placeholder ->
                text.replace(placeholder, "")
            }
            if ("{{" in residue || "}}" in residue) {
                throw MosaicProtocolException(
                    "Locale $tag key $key contains an unsupported template expression.",
                )
            }
        }
    }
}

internal fun MutableList<MosaicLocalizedText>.addControlAccessibility(
    accessibility: MosaicControlAccessibility,
) {
    add(accessibility.label)
    accessibility.hint?.let(::add)
}

internal data class ProductTemplateAnalysis(
    val malformed: Boolean,
    val variables: List<String>,
)

internal fun analyzeProductTemplate(value: String): ProductTemplateAnalysis {
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

internal fun localizedValues(
    document: MosaicPaywallDocument,
    text: MosaicLocalizedText,
): List<String> = buildList {
    add(text.defaultValue)
    document.localization.locales.values.forEach { catalog ->
        catalog.strings[text.localizationKey]?.let(::add)
    }
}

internal fun validateProductTemplates(document: MosaicPaywallDocument) {
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
            is MosaicTabsComponent -> {
                validateControl(node.accessibility, "Tabs ${node.id}")
                node.tabs.forEach { tab ->
                    validate(tab.label, false, "Tab ${tab.id} label")
                    visit(tab.content, insideProductCard)
                }
            }
            is MosaicTimelineComponent -> {
                validateControl(node.accessibility, "Timeline ${node.id}")
                node.entries.forEach { entry ->
                    validate(entry.title, false, "Timeline entry ${entry.id} title")
                    entry.description?.let {
                        validate(it, false, "Timeline entry ${entry.id} description")
                    }
                }
            }
            is MosaicAwardComponent -> {
                validateControl(node.accessibility, "Award ${node.id}")
                validate(node.title, false, "Award ${node.id} title")
                node.subtitle?.let { validate(it, false, "Award ${node.id} subtitle") }
            }
            is MosaicSocialProofComponent -> {
                validateControl(node.accessibility, "Social Proof ${node.id}")
                validate(node.quote, false, "Social Proof ${node.id} quote")
                validate(node.attribution, false, "Social Proof ${node.id} attribution")
            }
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

internal fun documentUsesProductTemplates(document: MosaicPaywallDocument): Boolean {
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

internal fun MosaicProductCardComponent.containsNode(targetId: String): Boolean {
    fun contains(node: MosaicNode): Boolean = when (node) {
        is MosaicStack -> node.id == targetId || node.children.any(::contains)
        is MosaicProductBadgeComponent -> node.id == targetId || node.children.any(::contains)
        else -> node.id == targetId
    }
    return children.any(::contains)
}

internal fun validateRuntimeSemantics(
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
        val tabsById = nodes.filterIsInstance<MosaicTabsComponent>()
            .associateBy(MosaicTabsComponent::id)
        val descendantIdsByTabs = tabsById.mapValues { (_, tabs) ->
            tabs.tabs.flatMap { tab -> tab.content.walkDepthFirst().map(MosaicNode::id) }.toSet()
        }
        nodes.forEach { node ->
            val nodeVisibility = node.semanticVisibilityOrAlways()
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
            if (nodeVisibility is MosaicVisibility.TabValue) {
                val controller = tabsById[nodeVisibility.tabsId]
                    ?: throw MosaicProtocolException(
                        "${node.type} ${node.id} visibility must reference a Tabs component on " +
                            "screen ${screen.id}.",
                    )
                // Inside a panel the condition is already decided by the panel: comparing against
                // the owning tab is vacuously true and against any other tab is unsatisfiable.
                // Both are dead layout, so both reject rather than render.
                if (controller.id == node.id ||
                    node.id in descendantIdsByTabs.getValue(controller.id)
                ) {
                    throw MosaicProtocolException(
                        "${node.type} ${node.id} visibility cannot reference the Tabs component " +
                            "it belongs to.",
                    )
                }
                if (controller.tabs.none { it.id == nodeVisibility.equals }) {
                    throw MosaicProtocolException(
                        "${node.type} ${node.id} visibility references undeclared tab " +
                            "${nodeVisibility.equals} of tabs ${controller.id}.",
                    )
                }
            }
            when (node) {
                is MosaicTabsComponent -> {
                    if (node.tabs.none { it.id == node.initialTabId }) {
                        throw MosaicProtocolException(
                            "Tabs ${node.id} initialTabId must name one of its declared tabs.",
                        )
                    }
                }
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

internal fun validateProductCardStructure(card: MosaicProductCardComponent) {
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
            is MosaicTimelineComponent,
            is MosaicAwardComponent,
            is MosaicSocialProofComponent,
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

internal fun validatePassiveButtonChild(buttonId: String, node: MosaicNode) {
    when (node) {
        is MosaicButtonComponent,
        is MosaicProductSelectorComponent,
        is MosaicSwitchComponent,
        is MosaicCarouselComponent,
        is MosaicTabsComponent,
        -> throw MosaicProtocolException(
            "Button $buttonId contains interactive or paged component ${node.id}.",
        )
        is MosaicStack -> node.children.forEach { validatePassiveButtonChild(buttonId, it) }
        else -> Unit
    }
}

internal fun validateScreenGraph(
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

internal fun validateNoNestedCarousel(stack: MosaicStack, insideCarousel: Boolean) {
    stack.children.forEach { child ->
        when (child) {
            is MosaicStack -> validateNoNestedCarousel(child, insideCarousel)
            is MosaicCarouselComponent -> {
                if (insideCarousel) {
                    throw MosaicProtocolException("Carousel ${child.id} cannot be nested in a carousel.")
                }
                child.pages.forEach { validateNoNestedCarousel(it.content, insideCarousel = true) }
            }
            is MosaicTabsComponent -> child.tabs.forEach {
                validateNoNestedCarousel(it.content, insideCarousel)
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

internal fun MosaicNode.semanticVisibilityOrAlways(): MosaicVisibility = when (this) {
    is MosaicStack -> visibility
    is MosaicTextComponent -> visibility
    is MosaicImageComponent -> visibility
    is MosaicFeatureListComponent -> visibility
    is MosaicProductSelectorComponent -> visibility
    is MosaicCarouselComponent -> visibility
    is MosaicSwitchComponent -> visibility
    is MosaicCountdownComponent -> visibility
    is MosaicButtonComponent -> visibility
    is MosaicIconComponent -> visibility
    is MosaicTabsComponent -> visibility
    is MosaicTimelineComponent -> visibility
    is MosaicAwardComponent -> visibility
    is MosaicSocialProofComponent -> visibility
    is MosaicProductCardComponent,
    is MosaicProductBadgeComponent,
    -> MosaicVisibility.Always
}

internal fun MosaicNode.semanticAppearanceOrNull(): MosaicBoxAppearance? = when (this) {
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
    is MosaicTabsComponent -> appearance
    is MosaicTimelineComponent -> appearance
    is MosaicAwardComponent -> appearance
    is MosaicSocialProofComponent -> appearance
    is MosaicProductCardComponent,
    is MosaicProductBadgeComponent,
    -> null
}

internal fun deriveCapabilities(
    document: MosaicPaywallDocument,
    root: JsonObject,
): Set<MosaicCapabilityName> = buildSet {
    val isV04Document = document.schemaVersion == MOSAIC_PROTOCOL_V04_VERSION
    add(MosaicCapabilityName.LOCALIZATION_CATALOGS)
    add(MosaicCapabilityName.SCREENS)
    if (document.screens.any { it.presentation == MosaicScreenPresentation.SHEET }) {
        add(MosaicCapabilityName.SHEETS)
    }
    if (documentUsesProductTemplates(document)) add(MosaicCapabilityName.PRODUCT_TEMPLATE)
    val defaultCatalogKeys = document.localization.locales[document.localization.defaultLocale]
        ?.strings?.keys.orEmpty()
    if (defaultCatalogKeys.any { it in MosaicReservedAccessibilityKey.all }) {
        add(MosaicCapabilityName.ACCESSIBILITY_RESERVED_STRINGS)
    }
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
    // The three *style* catalogs only. `motions` is the fourth catalog in the same object but it is
    // not a style token: motion is covered by `motion.appear`, `motion.selection`, and `motion.loop`,
    // which are derived from the nodes that author it. Deriving `style.designTokens` from a
    // motions-only design system would demand a capability for a catalog that renders nothing, and
    // would reject a document the reference validator accepts. Every fixture before the two-Screen
    // round trip also declared colours, so a catalog-agnostic check agreed with the contract by
    // coincidence rather than by construction.
    if (
        setOf("colors", "backgrounds", "shadows")
            .any { name -> (designSystem.getAsJsonArray(name)?.size() ?: 0) > 0 }
    ) {
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
            "tabs" -> add(MosaicCapabilityName.TABS)
            "timeline" -> add(MosaicCapabilityName.TIMELINE)
            "award" -> add(MosaicCapabilityName.AWARD)
            "socialProof" -> add(MosaicCapabilityName.SOCIAL_PROOF)
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
            when (visibility.get("mode")?.asString) {
                "switch" -> add(MosaicCapabilityName.SWITCH_VISIBILITY)
                "tab" -> add(MosaicCapabilityName.TAB_VISIBILITY)
                else -> add(MosaicCapabilityName.STATIC_VISIBILITY)
            }
        }
        if (objectUsesColor(node)) add(MosaicCapabilityName.COLORS)
        if (type == "productSelector") {
            add(MosaicCapabilityName.PRODUCT_FALLBACK)
            add(MosaicCapabilityName.NORMALIZED_OUTCOME)
        }
        // Derived exactly when `component.productSelector`, `component.productCard`, or
        // `component.productBadge` is derived, which is why `0.4` removes it: a capability that
        // cannot vary independently of another carries no information.
        if (isV04Document) {
            node.getAsJsonObjectOrNull("motion")?.let { motion ->
                if (motion.hasNonNull("appear")) add(MosaicCapabilityName.MOTION_APPEAR)
                if (motion.hasNonNull("selection")) add(MosaicCapabilityName.MOTION_SELECTION)
                if (motion.hasNonNull("loop")) add(MosaicCapabilityName.MOTION_LOOP)
            }
        } else if (type == "productSelector" || type == "productCard" || type == "productBadge") {
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
