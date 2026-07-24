package dev.mosaic.sdk.googleplay

import dev.mosaic.sdk.MosaicCommerceAdapterMapping
import dev.mosaic.sdk.MosaicCommerceOffer
import dev.mosaic.sdk.MosaicCommercePeriod
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicProduct

internal data class GooglePricingPhase(
    val formattedPrice: String,
    val currencyCode: String,
    val priceMicros: Long,
    val billingPeriod: String,
    val recurrenceMode: Int,
    val cycles: Int,
)

internal data class GoogleOfferCandidate(
    val basePlanId: String,
    val offerId: String?,
    val offerToken: String,
    val phases: List<GooglePricingPhase>,
)

internal data class GoogleProductCandidate(
    val productId: String,
    val productType: String,
    val name: String,
    val oneTimePrice: GooglePricingPhase?,
    val offers: List<GoogleOfferCandidate>,
    val nativeHandle: Any,
)

internal data class GoogleSelectedProduct(
    val product: MosaicProduct,
    val offerToken: String?,
    val nativeHandle: Any,
)

internal object GooglePlayProductSelector {
    fun select(
        mapping: MosaicCommerceProductMapping,
        candidate: GoogleProductCandidate,
    ): GoogleSelectedProduct? {
        if (mapping.providerProductReference != candidate.productId ||
            mapping.productType != candidate.productType
        ) return null
        val detail = mapping.adapterMapping as? MosaicCommerceAdapterMapping.GooglePlayProduct
            ?: return null
        return if (mapping.productType == "one_time_non_consumable") {
            if (detail.basePlanId != null || detail.offerId != null) return null
            val price = candidate.oneTimePrice ?: return null
            GoogleSelectedProduct(
                MosaicProduct(
                    id = mapping.mosaicProductId,
                    title = candidate.name,
                    localizedPrice = price.formattedPrice,
                    currencyCode = price.currencyCode,
                    type = mapping.productType,
                    entitlementKeys = mapping.entitlementKeys,
                ),
                null,
                candidate.nativeHandle,
            )
        } else {
            val matches = candidate.offers.filter {
                it.basePlanId == detail.basePlanId && it.offerId == detail.offerId
            }
            if (matches.size != 1) return null
            val offer = matches.single()
            normalizeSubscription(mapping, candidate, offer)
        }
    }

    private fun normalizeSubscription(
        mapping: MosaicCommerceProductMapping,
        candidate: GoogleProductCandidate,
        offer: GoogleOfferCandidate,
    ): GoogleSelectedProduct? {
        val recurring = offer.phases.filter { it.recurrenceMode == 1 }
        if (recurring.size != 1) return null
        val base = recurring.single()
        val basePeriod = period(base.billingPeriod) ?: return null
        val zero = offer.phases.filter { it.priceMicros == 0L && it.recurrenceMode != 1 }
        if (zero.size > 1) return null
        val paidIntro = offer.phases.filter { it.priceMicros > 0L && it.recurrenceMode != 1 }
        if (paidIntro.size > 1) return null
        val trial = zero.singleOrNull()?.let {
            MosaicCommerceOffer(
                localizedPrice = null,
                period = period(it.billingPeriod) ?: return null,
                cycles = it.cycles.coerceAtLeast(1),
            )
        }
        val intro = paidIntro.singleOrNull()?.let {
            MosaicCommerceOffer(
                localizedPrice = it.formattedPrice,
                period = period(it.billingPeriod) ?: return null,
                cycles = it.cycles.coerceAtLeast(1),
                paymentMode = if (it.recurrenceMode == 2) "payAsYouGo" else "payUpFront",
            )
        }
        return GoogleSelectedProduct(
            MosaicProduct(
                id = mapping.mosaicProductId,
                title = candidate.name,
                localizedPrice = base.formattedPrice,
                subscriptionPeriod = base.billingPeriod,
                currencyCode = base.currencyCode,
                type = mapping.productType,
                entitlementKeys = mapping.entitlementKeys,
                trial = trial,
                introductoryOffer = intro,
            ),
            offer.offerToken,
            candidate.nativeHandle,
        )
    }

    private fun period(iso: String): MosaicCommercePeriod? {
        val match = Regex("^P([0-9]+)([DWMY])$").matchEntire(iso) ?: return null
        val value = match.groupValues[1].toIntOrNull()?.takeIf { it in 1..120 } ?: return null
        val unit = when (match.groupValues[2]) {
            "D" -> "day"
            "W" -> "week"
            "M" -> "month"
            "Y" -> "year"
            else -> return null
        }
        return MosaicCommercePeriod(unit, value)
    }
}
