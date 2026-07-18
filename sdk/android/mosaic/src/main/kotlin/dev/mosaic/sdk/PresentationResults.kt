package dev.mosaic.sdk

sealed interface MosaicPresentationResult {
    val wireName: String

    data class Purchased(
        val productReferenceId: String,
        val providerProductId: String,
        val transactionId: String,
    ) : MosaicPresentationResult {
        override val wireName: String = "purchased"
    }

    data class Restored(val entitlements: Set<MosaicEntitlement>) : MosaicPresentationResult {
        override val wireName: String = "restored"
    }

    data class AlreadyEntitled(
        val productReferenceId: String? = null,
        val entitlements: Set<MosaicEntitlement> = emptySet(),
    ) : MosaicPresentationResult {
        override val wireName: String = "alreadyEntitled"
    }

    data object Dismissed : MosaicPresentationResult {
        override val wireName: String = "dismissed"
    }

    data class Cancelled(val productReferenceId: String) : MosaicPresentationResult {
        override val wireName: String = "cancelled"
    }

    data class ProductUnavailable(
        val productReferenceId: String? = null,
    ) : MosaicPresentationResult {
        override val wireName: String = "productUnavailable"
    }

    data class ConfigurationUnavailable(
        val diagnosticCode: String,
    ) : MosaicPresentationResult {
        override val wireName: String = "configurationUnavailable"
    }

    data class PurchaseFailed(
        val productReferenceId: String,
        val diagnosticCode: String,
    ) : MosaicPresentationResult {
        override val wireName: String = "purchaseFailed"
    }

    data class RenderingFailed(
        val diagnosticCode: String = MosaicDiagnosticCode.RENDERING_FAILED.wireName,
    ) : MosaicPresentationResult {
        override val wireName: String = "renderingFailed"
    }
}

sealed interface MosaicInteractionOutcome {
    val wireName: String

    data class ProductSelected(val productReferenceId: String) : MosaicInteractionOutcome {
        override val wireName: String = "productSelected"
    }

    data class Purchased(val productReferenceId: String) : MosaicInteractionOutcome {
        override val wireName: String = "purchased"
    }

    data class AlreadyEntitled(val productReferenceId: String? = null) : MosaicInteractionOutcome {
        override val wireName: String = "alreadyEntitled"
    }

    data class Cancelled(val productReferenceId: String) : MosaicInteractionOutcome {
        override val wireName: String = "cancelled"
    }

    data class ProductUnavailable(
        val productReferenceId: String? = null,
    ) : MosaicInteractionOutcome {
        override val wireName: String = "productUnavailable"
    }

    data class PurchaseFailed(
        val productReferenceId: String,
        val diagnosticCode: String,
    ) : MosaicInteractionOutcome {
        override val wireName: String = "purchaseFailed"
    }

    data class Restored(val entitlements: Set<MosaicEntitlement>) : MosaicInteractionOutcome {
        override val wireName: String = "restored"
    }

    data object RestoreNoPurchases : MosaicInteractionOutcome {
        override val wireName: String = "restoreNoPurchases"
    }

    data class RestoreFailed(val diagnosticCode: String) : MosaicInteractionOutcome {
        override val wireName: String = "restoreFailed"
    }

    data object Dismissed : MosaicInteractionOutcome {
        override val wireName: String = "dismissed"
    }

}

data class MosaicPaywallEvent(
    val interaction: MosaicInteractionOutcome,
    val presentationResult: MosaicPresentationResult? = null,
)
