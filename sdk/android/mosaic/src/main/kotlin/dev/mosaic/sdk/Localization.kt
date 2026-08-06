package dev.mosaic.sdk

/** Resolves RC1 strings and direction using the protocol-defined candidate order. */
class MosaicLocalizationResolver(
    private val localization: MosaicLocalization,
    requestedLocale: String?,
) {
    /**
     * Catalog keys are authored in one canonical form, but the requested locale comes from the host
     * and arrives in whatever form the platform uses. `Locale.getDefault().toLanguageTag()` carries
     * Unicode extensions on a region-override device (`en-US-u-rg-gbzzzz`), `Locale.toString()` is
     * underscore-separated (`en_US`), and a host may hand us `PT_br`. Matched raw, those miss the
     * one catalog that exists and the user silently reads the document's default language —
     * direction included, so an Egyptian Arabic device lays out left-to-right. Protocol 0.2
     * canonicalizes the requested tag before an exact lookup; an unusable request contributes no
     * candidate rather than being substituted with a plausible tag such as `en` and selecting an
     * `en` catalog the document may happen to declare. Lookup — unlike targeting — recovers the
     * leading language
     * subtag from a tag it cannot canonicalize, so `en-US-verylongsubtag` still reaches `en`.
     */
    private val canonicalRequest: String? =
        requestedLocale?.let(MosaicDeviceLocale::canonicalLookupOrNull)

    /**
     * The Protocol 0.2 order: canonical requested tag, its base language, the declared fallback
     * locale, then the declared default locale. Undeclared candidates stay in the list and are
     * skipped at lookup, matching `protocol/tools/locale-resolution-v0.2.mjs`. There is no
     * language+region reduction step in `0.2`, so `zh-Hans-CN` reduces to `zh`, never to `zh-CN`.
     */
    val localeCandidates: List<String> = buildList {
        fun addOnce(tag: String?) {
            if (!tag.isNullOrBlank() && tag !in this) add(tag)
        }

        addOnce(canonicalRequest)
        addOnce(canonicalRequest?.substringBefore('-'))
        addOnce(localization.fallbackLocale)
        addOnce(localization.defaultLocale)
    }

    val direction: MosaicLayoutDirection = localeCandidates
        .firstNotNullOfOrNull { localization.locales[it]?.direction }
        ?: checkNotNull(localization.locales[localization.defaultLocale]).direction

    fun resolve(value: MosaicLocalizedText): String = localeCandidates
        .firstNotNullOfOrNull { locale -> localization.locales[locale]?.strings?.get(value.localizationKey) }
        ?: value.defaultValue

    fun resolvedLocale(value: MosaicLocalizedText): String? = localeCandidates
        .firstOrNull { locale -> localization.locales[locale]?.strings?.containsKey(value.localizationKey) == true }
}
