package dev.mosaic.sdk

/**
 * How a component's accessibility content is composed.
 *
 * Protocol 0.3 does not join announced segments. Each segment is its own accessibility element
 * inside a labelled container, and the platform screen reader supplies the pause between them.
 * A renderer that concatenates segments has invented punctuation, and any choice is wrong outside
 * Latin script — `。`, `،`, `।`, or nothing at all, depending on the language. The contract
 * therefore records `separator: null` and this model has no separator to set.
 */
enum class MosaicAccessibilityComposition { SEPARATE_ELEMENTS, SINGLE_ELEMENT }

enum class MosaicAccessibilityRole(val wireName: String) {
    GROUP("group"),
    LIST("list"),
    BUTTON("button"),
}

/** One announced segment. [itemId] names the owning list item where the container is a list. */
data class MosaicAccessibilityElement(
    val segment: String,
    val text: String,
    val itemId: String? = null,
)

/**
 * The container an assistive technology sees, and the ordered elements inside it.
 *
 * [decorative] names what must never be announced or focusable. It is part of the contract rather
 * than an implementation note: a marker, connector, emblem, avatar, or button label that reaches
 * the accessibility tree duplicates copy the container already carries.
 */
data class MosaicAccessibilityAnnouncement(
    val role: MosaicAccessibilityRole,
    val label: String,
    val value: String? = null,
    val hint: String? = null,
    val composition: MosaicAccessibilityComposition =
        MosaicAccessibilityComposition.SEPARATE_ELEMENTS,
    val elements: List<MosaicAccessibilityElement> = emptyList(),
    val decorative: List<String> = emptyList(),
)

/**
 * Social Proof announces, in order, the rating when declared, then the quote, then the attribution.
 *
 * An absent rating produces no element at all rather than an empty one, and the avatar is always
 * decorative. The rating text comes from the reserved `mosaic.a11y.rating` catalog string; when the
 * document carries no usable template the segment is omitted rather than phrased by this renderer.
 */
fun MosaicSocialProofComponent.accessibilityAnnouncement(
    localization: MosaicLocalizationResolver,
    ratingAnnouncement: String? = rating?.let { declared ->
        localization.reservedString(MosaicReservedAccessibilityKey.RATING)
            ?.let { template ->
                runCatching { mosaicResolveRatingAnnouncement(declared, template) }.getOrNull()
            }
    },
): MosaicAccessibilityAnnouncement = MosaicAccessibilityAnnouncement(
    role = MosaicAccessibilityRole.GROUP,
    label = localization.resolve(accessibility.label),
    hint = accessibility.hint?.let(localization::resolve),
    elements = buildList {
        ratingAnnouncement?.let { add(MosaicAccessibilityElement("rating", it)) }
        add(MosaicAccessibilityElement("quote", localization.resolve(quote)))
        add(MosaicAccessibilityElement("attribution", localization.resolve(attribution)))
    },
    decorative = buildList { avatar?.let { add("avatar") } },
)

/** Award announces its title, then its subtitle when declared. The emblem is always decorative. */
fun MosaicAwardComponent.accessibilityAnnouncement(
    localization: MosaicLocalizationResolver,
): MosaicAccessibilityAnnouncement = MosaicAccessibilityAnnouncement(
    role = MosaicAccessibilityRole.GROUP,
    label = localization.resolve(accessibility.label),
    hint = accessibility.hint?.let(localization::resolve),
    elements = buildList {
        add(MosaicAccessibilityElement("title", localization.resolve(title)))
        subtitle?.let { add(MosaicAccessibilityElement("subtitle", localization.resolve(it))) }
    },
    decorative = buildList { emblem?.let { add("emblem") } },
)

/**
 * Timeline is a labelled list. Each entry contributes its title, then its description when
 * declared; markers and the connector are decorative.
 */
fun MosaicTimelineComponent.accessibilityAnnouncement(
    localization: MosaicLocalizationResolver,
): MosaicAccessibilityAnnouncement = MosaicAccessibilityAnnouncement(
    role = MosaicAccessibilityRole.LIST,
    label = localization.resolve(accessibility.label),
    hint = accessibility.hint?.let(localization::resolve),
    elements = entries.flatMap { entry ->
        buildList {
            add(MosaicAccessibilityElement("title", localization.resolve(entry.title), entry.id))
            entry.description?.let {
                add(MosaicAccessibilityElement("description", localization.resolve(it), entry.id))
            }
        }
    },
    decorative = buildList {
        entries.filter { it.marker != null }.forEach { add("${it.id}.marker") }
        add("connector")
    },
)

/**
 * A Button is one accessibility element.
 *
 * Its name never changes between states: the busy state is carried by [MosaicAccessibilityAnnouncement.value],
 * resolved from the reserved `mosaic.a11y.in_progress` string, not by swapping the label. Neither
 * `children` nor `inProgressChildren` are announced in either state — the label already says what
 * the control does, and announcing the visible caption as well reads it twice.
 */
fun MosaicButtonComponent.accessibilityAnnouncement(
    localization: MosaicLocalizationResolver,
    isBusy: Boolean,
): MosaicAccessibilityAnnouncement {
    val shown = if (isBusy) inProgressChildren ?: children else children
    fun ids(node: MosaicNode): List<String> = when (node) {
        is MosaicStack -> listOf(node.id) + node.children.flatMap(::ids)
        else -> listOf(node.id)
    }
    return MosaicAccessibilityAnnouncement(
        role = MosaicAccessibilityRole.BUTTON,
        label = localization.resolve(accessibility.label),
        value = if (isBusy) busyStateDescription(localization) else null,
        hint = accessibility.hint?.let(localization::resolve),
        composition = MosaicAccessibilityComposition.SINGLE_ELEMENT,
        elements = emptyList(),
        decorative = shown.flatMap(::ids),
    )
}
