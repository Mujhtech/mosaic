package dev.mosaic.sdk

/**
 * The `0.4` semantic rules, mirroring `validateMotionCatalog` and `validateMotionSemantics` in
 * `protocol/tools/validation-v0.4.mjs`.
 *
 * Structural rules — which trigger a node type may author, the amplitude ceilings, the `1…5` repeat
 * bound, `riseLogicalSize` presence — are enforced during decoding, where the schema enforces them.
 * What is left here is everything whose subject is the document rather than a node.
 */

/** A pulse cycle floor of 500 ms caps the fundamental at 2 Hz and the perceived rate at 1 Hz. */
internal const val MOSAIC_LOOP_MINIMUM_DURATION_MILLISECONDS: Int = 500

internal fun validateMotionSemantics(
    document: MosaicPaywallDocument,
    rawDesignSystem: RawDesignSystem,
    referencedMotionTokenIds: Set<String>,
) {
    validateMotionCatalogUse(rawDesignSystem, referencedMotionTokenIds)
    document.screens.forEach { screen ->
        validateScreenMotion(screen)
    }
}

/**
 * An unreferenced motion token rejects the document; an unreferenced colour does not.
 *
 * The asymmetry is deliberate and is called out here so nobody later "fixes" the other three
 * catalogs to match. An unreferenced colour is inert: being wrong about a colour nothing draws costs
 * nothing. The safety constraint on a *motion* lives at its reference site — the flash-safety floor
 * is checked where a `loop` names a curve — so a motion token nothing references has never been
 * checked against anything and sits in the catalog looking like an approved timing value. The next
 * author to reach for it inherits a duration no rule has ever seen.
 */
private fun validateMotionCatalogUse(
    rawDesignSystem: RawDesignSystem,
    referencedMotionTokenIds: Set<String>,
) {
    val unused = rawDesignSystem.motions.keys - referencedMotionTokenIds
    if (unused.isNotEmpty()) {
        throw MosaicProtocolException(
            "Motion token catalog declares unused motions ${unused.sorted().joinToString()}.",
        )
    }
}

private fun validateScreenMotion(screen: MosaicPaywallScreen) {
    val loopingButtonIds = mutableListOf<String>()

    fun visit(node: MosaicNode, animatedAncestor: MosaicNode?) {
        val motion = node.motion
        val appear = motion?.appear
        if (appear != null && animatedAncestor != null) {
            // Two entrance opacities multiply, and the three renderers compose that product at
            // different points in their pipelines. Rejecting is cheaper than pinning an arithmetic
            // no platform agrees on, and an author who wants a group to fade in puts the appear on
            // the group.
            throw MosaicProtocolException(
                "${node.type} ${node.id} declares appear motion inside " +
                    "${animatedAncestor.type} ${animatedAncestor.id}, which already declares one.",
            )
        }
        motion?.loop?.let { loop ->
            loopingButtonIds += node.id
            if (loop.curve.durationMilliseconds < MOSAIC_LOOP_MINIMUM_DURATION_MILLISECONDS) {
                throw MosaicProtocolException(
                    "Button ${node.id} loop motion resolves to " +
                        "${loop.curve.durationMilliseconds}ms, below the " +
                        "${MOSAIC_LOOP_MINIMUM_DURATION_MILLISECONDS}ms flash-safety floor.",
                )
            }
        }
        val ancestor = if (appear != null) node else animatedAncestor
        node.motionChildren().forEach { child -> visit(child, ancestor) }
    }

    visit(screen.layout.content, animatedAncestor = null)
    if (loopingButtonIds.size > 1) {
        throw MosaicProtocolException(
            "Screen ${screen.id} declares loop motion on ${loopingButtonIds.size} buttons " +
                "(${loopingButtonIds.joinToString()}); at most one is permitted.",
        )
    }
}

/**
 * Every way a node owns another node.
 *
 * `0.4` adds no container and no new child collection — motion is a property of a node, not a place
 * one can hide — so this is the `0.3` tree. It is spelled out rather than reusing
 * `walkDepthFirst` because the nesting rule needs the ancestor chain, which a flattened walk has
 * already thrown away.
 */
private fun MosaicNode.motionChildren(): List<MosaicNode> = when (this) {
    is MosaicStack -> children
    is MosaicButtonComponent -> children + inProgressChildren.orEmpty()
    is MosaicCarouselComponent -> pages.map(MosaicCarouselPage::content)
    is MosaicTabsComponent -> tabs.map(MosaicTabEntry::content)
    is MosaicProductSelectorComponent -> cards
    is MosaicProductCardComponent -> children
    is MosaicProductBadgeComponent -> children
    else -> emptyList()
}
