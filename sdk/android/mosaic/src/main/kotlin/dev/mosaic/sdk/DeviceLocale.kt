package dev.mosaic.sdk

import java.util.Locale

/**
 * The canonical comparison form of a locale tag, and the device locale in that form.
 *
 * Protocol 0.3 and Placement Decision 1 share one rule, deliberately: Placement targeting and
 * localization catalog lookup must not disagree about what "the same locale" is. Underscores become
 * hyphens, empty subtags are dropped, the tag is truncated at the first singleton subtag, the
 * language is lowercased, a script subtag is title case, and a two-letter or three-digit region is
 * uppercased. See `docs/protocol/v0.3.md` ("Localization and locale resolution") and the reference
 * implementations `protocol/tools/locale-resolution-v0.3.mjs` and
 * `protocol/tools/placement-decision-validation-v1.mjs`.
 *
 * Truncation is what this exists for. `Locale.getDefault().toLanguageTag()` is well-formed BCP-47,
 * but Android reports regional preferences as Unicode extensions, so a device with a region
 * override or a non-default calendar reports `en-US-u-rg-gbzzzz` or
 * `en-US-u-ca-japanese-fw-mon-mu-celsius`. Those pass the analytics locale pattern — every subtag
 * is 1-8 alphanumerics — but they are not `en-US`: `application.locale` rules miss, catalog lookup
 * misses, and the longer forms exceed the analytics context's 35-byte bound, which makes the event
 * unencodable and loses it. Every locale the SDK sends or matches comes through here.
 */
internal object MosaicDeviceLocale {
    /**
     * The current device locale in canonical form, or `null` when the platform reports nothing
     * usable.
     *
     * Null, never a substituted tag. `application.locale` is optional in both the Placement
     * decision context and the analytics event context, and an absent locale makes every locale
     * condition evaluate UNKNOWN through the three-valued evaluator. Substituting a plausible tag
     * such as `en` would instead be a claim: a device whose locale Mosaic cannot read would be
     * targeted, bucketed, and reported as an English device, and `does_not_exist` — the Rule that
     * asks "did this host report a locale at all" — would silently stop matching it.
     *
     * Never recovers a language subtag from a tag that cannot be canonicalized either: Placement
     * targeting must not retarget a malformed tag onto its broader language, because that changes
     * which users match a Rule. Catalog lookup does recover — see [canonicalLookupOrNull].
     */
    val current: String? get() = canonicalOrNull(rawDeviceTag())

    /**
     * The current device locale for the analytics event context, whose 35-byte bound is tighter
     * than the canonical form allows, or `null` when nothing usable is reported. A canonical tag
     * past the bound degrades to its language subtag, because an event that cannot be encoded is an
     * event that is lost; that degradation is bounded by what the device actually reported and
     * never invents a locale. Targeting reads [current] instead, so this bound never moves anyone
     * between Rules.
     */
    val currentForEventContext: String? get() = boundedDeviceTag()

    /**
     * The canonical form of one language tag or legacy `Locale.toString()` identifier, or `null`
     * when nothing usable remains.
     *
     * Callers that must tell "the host gave me nothing usable" apart from "the host asked for
     * English" need that null. Localization resolution is one: an unusable request contributes no
     * candidate rather than selecting an `en` catalog the document may happen to declare.
     */
    fun canonicalOrNull(identifier: String): String? {
        val subtags = mutableListOf<String>()
        for (subtag in preCut(identifier).replace('_', '-').split('-')) {
            if (subtag.isEmpty()) continue
            // A one-character subtag opens an extension or private-use sequence (`-u-`, `-t-`,
            // `-x-`); everything from there on is device detail, not locale identity.
            if (subtag.length == 1) break
            subtags.add(subtag)
        }
        if (subtags.isEmpty() || subtags.size > 8) return null
        if (!LANGUAGE_PATTERN.matches(subtags.first())) return null
        if (subtags.drop(1).any { !SUBTAG_PATTERN.matches(it) }) return null
        return subtags.mapIndexed { index, subtag ->
            when {
                index == 0 -> subtag.lowercase(Locale.ROOT)
                SCRIPT_PATTERN.matches(subtag) ->
                    subtag.lowercase(Locale.ROOT).replaceFirstChar { it.titlecase(Locale.ROOT) }
                REGION_PATTERN.matches(subtag) -> subtag.uppercase(Locale.ROOT)
                else -> subtag.lowercase(Locale.ROOT)
            }
        }.joinToString("-")
    }

    /**
     * The requested locale as a **catalog lookup** candidate.
     *
     * Lookup recovers the leading language subtag when the whole tag cannot be canonicalized, so
     * `en-US-verylongsubtag` still reaches the `en` catalog. Placement targeting deliberately does
     * not: recovery there would change which users match a Rule, whereas here the chain would
     * otherwise fall through to the document's own fallback and the worst outcome of recovery is a
     * less specific translation of the author's own copy.
     */
    fun canonicalLookupOrNull(identifier: String): String? =
        canonicalOrNull(identifier)
            ?: canonicalOrNull(preCut(identifier).replace('_', '-').substringBefore('-'))

    /**
     * A host reports an ICU identifier, not a language tag. `en_US@rg=gbzzzz` (keyword),
     * `en_US.UTF-8` (POSIX charset), and `en_US_#u-rg-gbzzzz` (Java `Locale.toString`) all denote
     * `en-US`; without the cut the remainder fails the subtag grammar and the whole tag is unusable.
     */
    private fun preCut(identifier: String): String =
        identifier.trim().takeWhile { it != '@' && it != '.' && it != '#' }

    private fun rawDeviceTag(): String =
        runCatching { Locale.getDefault().toLanguageTag() }.getOrNull().orEmpty()

    private fun boundedDeviceTag(): String? {
        val canonical = canonicalOrNull(rawDeviceTag()) ?: return null
        // The analytics event context bounds the locale at 35 bytes on top of the pattern, and a
        // long variant chain can still exceed that after truncation. Degrading to the language
        // subtag the device itself reported keeps the event encodable instead of losing it to the
        // bound. If even that will not fit, the field is omitted rather than invented: `locale` is
        // optional in the event context, so an absent locale is reportable and a wrong one is not.
        return canonical.takeIf(::withinContextBound)
            ?: canonical.substringBefore('-').takeIf(::withinContextBound)
    }

    /**
     * The intersection of the analytics event context and Placement decision context locale rules;
     * the analytics bound is the tighter of the two.
     */
    private fun withinContextBound(tag: String): Boolean =
        tag.toByteArray(Charsets.UTF_8).size in 2..35

    private val LANGUAGE_PATTERN = Regex("^[A-Za-z]{2,8}$")
    private val SUBTAG_PATTERN = Regex("^[A-Za-z0-9]{1,8}$")
    private val SCRIPT_PATTERN = Regex("^[A-Za-z]{4}$")
    private val REGION_PATTERN = Regex("^(?:[A-Za-z]{2}|[0-9]{3})$")
}
