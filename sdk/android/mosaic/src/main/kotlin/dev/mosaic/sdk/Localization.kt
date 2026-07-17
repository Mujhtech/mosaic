package dev.mosaic.sdk

/** Resolves RC1 strings and direction using the protocol-defined candidate order. */
class MosaicLocalizationResolver(
    private val localization: MosaicLocalization,
    requestedLocale: String?,
) {
    val localeCandidates: List<String> = buildList {
        fun addOnce(tag: String?) {
            if (!tag.isNullOrBlank() && tag !in this) add(tag)
        }

        if (requestedLocale.isNullOrBlank()) {
            addOnce(localization.defaultLocale)
            addOnce(localization.fallbackLocale)
        } else {
            addOnce(requestedLocale)
            val baseLanguage = requestedLocale.substringBefore('-')
            if (baseLanguage.matches(Regex("^[a-z]{2,3}$"))) addOnce(baseLanguage)
            addOnce(localization.fallbackLocale)
            addOnce(localization.defaultLocale)
        }
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
