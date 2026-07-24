package dev.mosaic.sdk.googleplay

import android.app.Activity
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.Purchase
import dev.mosaic.sdk.MosaicCommerceAdapterMapping
import dev.mosaic.sdk.MosaicCommerceConfigurationReference
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptance
import dev.mosaic.sdk.MosaicProductLoadResult
import dev.mosaic.sdk.MosaicPurchaseResult
import dev.mosaic.sdk.MosaicActiveEntitlementsResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MosaicGooglePlayAdapterTest {
    @Test
    fun `exact base plan and offer selection never falls back`() {
        val candidate = subscriptionCandidate()

        val selected = GooglePlayProductSelector.select(mapping(), candidate)
        val absent = GooglePlayProductSelector.select(
            mapping(
                detail = MosaicCommerceAdapterMapping.GooglePlayProduct(
                    "monthly",
                    "missing_offer",
                ),
            ),
            candidate,
        )
        val ambiguous = GooglePlayProductSelector.select(
            mapping(),
            candidate.copy(offers = candidate.offers + candidate.offers.single()),
        )

        assertEquals("runtime_offer_token", selected?.offerToken)
        assertEquals("$9.99", selected?.product?.localizedPrice)
        assertEquals("month", selected?.product?.trial?.period?.unit)
        assertNull(absent)
        assertNull(ambiguous)
    }

    @Test
    fun `accepted local delivery is durable before acknowledgement`() = runTest {
        val order = mutableListOf<String>()
        val service = FakeBillingService(
            candidate = subscriptionCandidate(),
            purchase = GooglePurchase(
                products = listOf("pro_subscription"),
                state = Purchase.PurchaseState.PURCHASED,
                acknowledged = false,
                token = "sensitive-token",
            ),
            order = order,
        )
        val store = RecordingDeliveryStore(order)
        val adapter = adapter(service, store) {
            order += "hostAccepted"
            true
        }
        adapter.installConfigurationReference(
            MosaicCommerceConfigurationReference("configuration", "revision"),
        )
        assertTrue(adapter.loadProducts(listOf(mapping())) is MosaicProductLoadResult.Loaded)

        val result = async { adapter.purchase(mapping(), emptyList()) }
        advanceUntilIdle()

        assertTrue(result.await() is MosaicPurchaseResult.Purchased)
        assertEquals(
            listOf("pending", "hostAccepted", "accepted", "acknowledge", "finalized"),
            order,
        )
        assertTrue(order.none { "sensitive-token" in it })
    }

    @Test
    fun `pending purchase emits pending without grants or acknowledgement`() = runTest {
        val order = mutableListOf<String>()
        val service = FakeBillingService(
            candidate = subscriptionCandidate(),
            purchase = GooglePurchase(
                products = listOf("pro_subscription"),
                state = Purchase.PurchaseState.PENDING,
                acknowledged = false,
                token = "pending-token",
            ),
            order = order,
        )
        val adapter = adapter(service, RecordingDeliveryStore(order)) { true }
        adapter.loadProducts(listOf(mapping()))

        val result = async { adapter.purchase(mapping(), emptyList()) }
        advanceUntilIdle()

        assertTrue(result.await() is MosaicPurchaseResult.Pending)
        assertTrue(order.isEmpty())
    }

    @Test
    fun `partial subscription and in-app recovery is never authoritative empty access`() = runTest {
        val service = FakeBillingService(
            candidate = subscriptionCandidate(),
            purchase = GooglePurchase(emptyList(), Purchase.PurchaseState.PENDING, false, "unused"),
            order = mutableListOf(),
            queryCodeByType = mapOf(
                BillingClient.ProductType.SUBS to BillingClient.BillingResponseCode.OK,
                BillingClient.ProductType.INAPP to BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
            ),
        )
        val adapter = adapter(service, RecordingDeliveryStore(mutableListOf())) { true }

        val result = adapter.activeEntitlements(emptyList())

        assertTrue(result is MosaicActiveEntitlementsResult.ProviderUnavailable)
    }

    private fun CoroutineScope.adapter(
        service: GooglePlayBillingService,
        store: DeliveryStore,
        acceptance: suspend (dev.mosaic.sdk.MosaicCommerceUpdate) -> Boolean,
    ) = MosaicGooglePlayAdapter(
        service = service,
        activityProvider = { Activity() },
        deliveryAcceptance = MosaicCommerceUpdateAcceptance(acceptance),
        deliveryStore = store,
        lifecycle = null,
        scope = this,
    )

    private fun mapping(
        detail: MosaicCommerceAdapterMapping.GooglePlayProduct =
            MosaicCommerceAdapterMapping.GooglePlayProduct("monthly", "intro"),
    ) = MosaicCommerceProductMapping(
        mosaicProductId = "product_pro_monthly",
        mappingId = "mapping_monthly",
        providerProductReference = "pro_subscription",
        adapterMapping = detail,
        productType = "subscription",
        entitlementKeys = setOf("pro"),
    )

    private fun subscriptionCandidate() = GoogleProductCandidate(
        productId = "pro_subscription",
        productType = "subscription",
        name = "Pro Monthly",
        oneTimePrice = null,
        offers = listOf(
            GoogleOfferCandidate(
                basePlanId = "monthly",
                offerId = "intro",
                offerToken = "runtime_offer_token",
                phases = listOf(
                    GooglePricingPhase("$0.00", "USD", 0, "P1M", 3, 1),
                    GooglePricingPhase("$9.99", "USD", 9_990_000, "P1M", 1, 0),
                ),
            ),
        ),
        nativeHandle = Any(),
    )

    private class FakeBillingService(
        private val candidate: GoogleProductCandidate,
        private val purchase: GooglePurchase,
        private val order: MutableList<String>,
        private val queryCodeByType: Map<String, Int> = emptyMap(),
    ) : GooglePlayBillingService {
        override var updates: (GoogleBillingResult, List<GooglePurchase>) -> Unit = { _, _ -> }
        override suspend fun connect() = GoogleBillingResult(BillingClient.BillingResponseCode.OK)
        override suspend fun queryProducts(
            productIds: List<String>,
            type: String,
        ) = GoogleBillingResult(BillingClient.BillingResponseCode.OK) to
            listOf(candidate)

        override fun launch(activity: Activity, product: GoogleSelectedProduct): GoogleBillingResult {
            updates(GoogleBillingResult(BillingClient.BillingResponseCode.OK), listOf(purchase))
            return GoogleBillingResult(BillingClient.BillingResponseCode.OK)
        }

        override suspend fun queryPurchases(type: String) =
            GoogleBillingResult(
                queryCodeByType[type] ?: BillingClient.BillingResponseCode.OK,
            ) to emptyList<GooglePurchase>()

        override suspend fun acknowledge(token: String): GoogleBillingResult {
            order += "acknowledge"
            return GoogleBillingResult(BillingClient.BillingResponseCode.OK)
        }

        override fun close() = Unit
    }

    private class RecordingDeliveryStore(
        private val order: MutableList<String>,
    ) : DeliveryStore {
        override fun recordPending(digest: String) {
            order += "pending"
        }
        override fun recordAccepted(digest: String) {
            order += "accepted"
        }
        override fun recordFinalized(digest: String) {
            order += "finalized"
        }
        override fun isFinalized(digest: String) = false
    }
}
