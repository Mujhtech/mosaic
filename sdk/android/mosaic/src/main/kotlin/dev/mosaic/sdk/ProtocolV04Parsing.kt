package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject

/**
 * Protocol `0.4` decoding: the motion catalog, per-node motion blocks, and the shared marker union.
 *
 * Nothing here runs for a `0.3` document. The `0.3` reader rejects a `motions` catalog, a node
 * `motion` block, and an object-shaped `marker` as unknown properties, exactly as it did before
 * `0.4` existed.
 */

/** Which motion triggers a node type may author. Structural, so an illegal pairing cannot decode. */
internal enum class MosaicMotionSlot(val wireName: String) {
    APPEAR("appear"),
    SELECTION("selection"),
    LOOP("loop"),
}

/** Any node except the screen Scroll Container, which is viewport-owned rather than authored. */
internal val nodeMotionSlots = setOf(MosaicMotionSlot.APPEAR)

/** Product Selector and Tabs: the two components that own runtime selection state. */
internal val selectableMotionSlots = setOf(MosaicMotionSlot.APPEAR, MosaicMotionSlot.SELECTION)

/** Button: the only component that may loop. */
internal val buttonMotionSlots = setOf(MosaicMotionSlot.APPEAR, MosaicMotionSlot.LOOP)

/**
 * Reads a node's optional `motion` block against the slots its component type allows.
 *
 * Returns null for a `0.3` document without inspecting the object, so the `0.3` reader's unknown-
 * property rejection still runs and a `0.3` document carrying motion is refused rather than
 * silently gaining behaviour its declared version does not have.
 */
internal fun optionalNodeMotion(
    objectValue: JsonObject,
    path: String,
    slots: Set<MosaicMotionSlot>,
): MosaicNodeMotion? {
    if (!decodingProtocolV04()) return null
    val value = objectValue.optional("motion") ?: return null
    val motionPath = "$path.motion"
    val motion = value.objectAt(motionPath)
    val allowed = slots.mapTo(mutableSetOf(), MosaicMotionSlot::wireName)
    motion.expectKeys(allowed, motionPath, optional = allowed)
    if (motion.size() == 0) {
        throw MosaicProtocolException("An authored motion block must declare a trigger at $motionPath.")
    }
    return MosaicNodeMotion(
        appear = motion.optional("appear")?.let { appearMotion(it, "$motionPath.appear") },
        selection = motion.optional("selection")?.let {
            selectionMotion(it, "$motionPath.selection")
        },
        loop = motion.optional("loop")?.let { loopMotion(it, "$motionPath.loop") },
    )
}

/**
 * `riseLogicalSize` is required with `fadeRise` and forbidden with `fade`.
 *
 * Both directions, because a rise on a `fade` is a value nothing reads and a `fadeRise` with no
 * rise would leave the renderer choosing a travel distance.
 */
internal fun appearMotion(value: JsonElement, path: String): MosaicAppearMotion {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("effect", "$path.effect")) {
        "fade" -> {
            objectValue.expectKeys(setOf("effect", "curve", "delayMilliseconds"), path)
            MosaicAppearMotion(
                effect = MosaicAppearEffect.FADE,
                curve = motionCurve(objectValue.required("curve", path), "$path.curve"),
                delayMilliseconds = objectValue.requiredMotionDuration(
                    "delayMilliseconds",
                    "$path.delayMilliseconds",
                ),
            )
        }
        "fadeRise" -> {
            objectValue.expectKeys(
                setOf("effect", "riseLogicalSize", "curve", "delayMilliseconds"),
                path,
            )
            MosaicAppearMotion(
                effect = MosaicAppearEffect.FADE_RISE,
                curve = motionCurve(objectValue.required("curve", path), "$path.curve"),
                delayMilliseconds = objectValue.requiredMotionDuration(
                    "delayMilliseconds",
                    "$path.delayMilliseconds",
                ),
                // Bounded at 64: a rise longer than the component it moves reads as a fly-in, and a
                // large authored translation is where transform-versus-layout divergence between
                // three renderers becomes visible.
                riseLogicalSize = objectValue.requiredNumber(
                    "riseLogicalSize",
                    "$path.riseLogicalSize",
                    java.math.BigDecimal.ZERO,
                    java.math.BigDecimal("64"),
                    exclusiveMinimum = true,
                ),
            )
        }
        else -> throw MosaicProtocolException("Invalid appear effect at $path.effect.")
    }
}

internal fun selectionMotion(value: JsonElement, path: String): MosaicSelectionMotion {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("curve"), path)
    return MosaicSelectionMotion(
        curve = motionCurve(objectValue.required("curve", path), "$path.curve"),
    )
}

internal fun loopMotion(value: JsonElement, path: String): MosaicLoopMotion {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("effect", "scaleAmplitude", "opacityAmplitude", "curve", "repeat"),
        path,
    )
    objectValue.requireConstant("effect", "pulse", "$path.effect")
    val repeatPath = "$path.repeat"
    val repeat = objectValue.required("repeat", path).objectAt(repeatPath)
    repeat.expectKeys(setOf("count"), repeatPath)
    return MosaicLoopMotion(
        // Positive: a pulse that does not scale is not a pulse. Ceiling 0.06 keeps the excursion
        // noticeable without overlapping neighbouring content or changing perceived hit targets.
        scaleAmplitude = objectValue.requiredNumber(
            "scaleAmplitude",
            "$path.scaleAmplitude",
            java.math.BigDecimal.ZERO,
            java.math.BigDecimal("0.06"),
            exclusiveMinimum = true,
        ),
        // Ceiling 0.2 puts the opacity floor at no less than 80% of the static rendering.
        opacityAmplitude = objectValue.requiredNumber(
            "opacityAmplitude",
            "$path.opacityAmplitude",
            java.math.BigDecimal.ZERO,
            java.math.BigDecimal("0.2"),
        ),
        curve = motionCurve(objectValue.required("curve", path), "$path.curve"),
        // 1..5, bounded above by construction: a bounded count needs no stop control because it
        // stops, so it does not rely on the operating system's reduce-motion switch as its WCAG
        // 2.2.2 stop mechanism.
        repeatCount = repeat.requiredIntegerInRange("count", "$repeatPath.count", 1..5),
    )
}

/** Inline motion, or a `motionToken` reference resolved against the document's catalog. */
internal fun motionCurve(value: JsonElement, path: String): MosaicMotion =
    resolveMotion(value, path, linkedSetOf())

internal fun resolveMotion(
    value: JsonElement,
    path: String,
    visiting: MutableSet<String>,
): MosaicMotion {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "motion" -> {
            objectValue.expectKeys(setOf("type", "durationMilliseconds", "easing"), path)
            val easing = objectValue.requiredString("easing", "$path.easing")
            MosaicMotion(
                durationMilliseconds = objectValue.requiredMotionDuration(
                    "durationMilliseconds",
                    "$path.durationMilliseconds",
                ),
                easing = MosaicMotionEasing.fromWireName(easing)
                    ?: throw MosaicProtocolException("Invalid easing preset at $path.easing."),
            )
        }
        "motionToken" -> {
            objectValue.expectKeys(setOf("type", "id"), path)
            resolveMotionToken(objectValue.requiredIdentifier("id", "$path.id"), path, visiting)
        }
        else -> throw MosaicProtocolException("Invalid motion at $path.type.")
    }
}

internal fun resolveMotionToken(
    id: String,
    path: String,
    visiting: MutableSet<String>,
): MosaicMotion {
    val token = activeDesignSystem.get()?.motions?.get(id)
        ?: throw MosaicProtocolException("Unknown motion token $id at $path.")
    // A token reached only through another token counts as used, which is why this marks on every
    // hop rather than only on the reference the node wrote.
    referencedMotionTokens.get()?.add(id)
    if (!visiting.add(id)) throw MosaicProtocolException("Cyclic motion token reference at $path.")
    return try {
        resolveMotion(token.value, "${token.path}.value", visiting)
    } finally {
        visiting.remove(id)
    }
}

/**
 * Whole milliseconds, `0…2000`.
 *
 * Integers throughout, per the `0.3` doctrine that Dart, Swift, Kotlin, and JavaScript must not
 * disagree about a rounded fraction.
 */
internal fun JsonObject.requiredMotionDuration(name: String, path: String): Int =
    requiredIntegerInRange(name, path, 0..2000)

/**
 * The marker vocabulary shared by Feature List and Timeline.
 *
 * `0.3` Feature List carries the single string constant `"checkmark"`, which is read here as the
 * equivalent icon marker so that one renderer path serves both versions. Nothing else in `0.3`
 * changes: the string remains the only accepted `0.3` form, and the union the only accepted `0.4`
 * form.
 */
internal fun marker(value: JsonElement, path: String): MosaicMarker {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("kind", "$path.kind")) {
        "dot" -> {
            objectValue.expectKeys(setOf("kind"), path)
            MosaicMarker.Dot
        }
        "ordinal" -> {
            objectValue.expectKeys(setOf("kind"), path)
            MosaicMarker.Ordinal
        }
        "icon" -> {
            objectValue.expectKeys(setOf("kind", "name"), path)
            MosaicMarker.Icon(iconName(objectValue, "name", "$path.name"))
        }
        else -> throw MosaicProtocolException("Invalid marker kind at $path.kind.")
    }
}
