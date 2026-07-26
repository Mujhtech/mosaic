package dev.mosaic.sdk

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/**
 * Evaluates a Placement from the accepted offline release, then renders only the selected native
 * Paywall. Targeting rules never enter the renderer.
 */
@Composable
fun MosaicPlacement(
    client: MosaicHostedConfigurationClient,
    placement: String,
    purchaseProvider: MosaicPurchaseProvider,
    onDecision: (MosaicPlacementDecisionResult) -> Unit,
    onResult: (MosaicPresentationResult) -> Unit,
    modifier: Modifier = Modifier,
    country: String? = null,
    requestedLocale: String? = null,
    diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
) {
    var decision by remember(client, placement, country) { mutableStateOf<MosaicPlacementDecisionResult?>(null) }
    LaunchedEffect(client, placement, country) {
        decision = client.decidePlacement(placement = placement, country = country).also(onDecision)
    }
    when (val current = decision) {
        is MosaicPlacementDecisionResult.Available -> MosaicPaywall(
            document = current.document,
            purchaseProvider = if (current.resolvedProducts.isEmpty()) {
                purchaseProvider
            } else {
                MosaicResolvedProductProvider(current.resolvedProducts, purchaseProvider)
            },
            onResult = onResult,
            modifier = modifier,
            requestedLocale = requestedLocale,
            diagnostics = diagnostics,
        )
        is MosaicPlacementDecisionResult.NoPaywall -> Box(modifier.testTag("mosaic-no-paywall"))
        is MosaicPlacementDecisionResult.PlacementUnavailable,
        is MosaicPlacementDecisionResult.EvaluationFailed,
        MosaicPlacementDecisionResult.ConfigurationUnavailable,
        null,
        -> Box(modifier.testTag("mosaic-placement-empty"))
    }
}

/** Reuses the decision's single Product observation while delegating all mutations. */
private class MosaicResolvedProductProvider(
    products: List<MosaicProduct>,
    private val delegate: MosaicPurchaseProvider,
) : MosaicPurchaseProvider {
    private val products = products.associateBy { it.id }

    override suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult {
        val available = productIds.mapNotNull(products::get)
        return MosaicProductLoadResult.Loaded(available, productIds.filterNot(products::containsKey).toSet())
    }

    override suspend fun purchase(productId: String) = delegate.purchase(productId)
    override suspend fun restore() = delegate.restore()
    override suspend fun activeEntitlements() = delegate.activeEntitlements()
}
