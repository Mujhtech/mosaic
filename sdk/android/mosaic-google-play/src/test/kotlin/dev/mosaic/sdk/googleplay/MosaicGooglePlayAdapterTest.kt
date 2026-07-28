package dev.mosaic.sdk.googleplay

import android.app.Activity
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.Purchase
import dev.mosaic.sdk.MosaicCommerceAdapterMapping
import dev.mosaic.sdk.MosaicCommerceAdapterConfiguration
import dev.mosaic.sdk.MosaicCommerceConfigurationReference
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptance
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptanceDisposition
import dev.mosaic.sdk.MosaicProductLoadResult
import dev.mosaic.sdk.MosaicPurchaseResult
import dev.mosaic.sdk.MosaicActiveEntitlementsResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
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
            MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
        }
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
        val adapter = adapter(service, RecordingDeliveryStore(order)) {
            MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
        }
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
        val adapter = adapter(service, RecordingDeliveryStore(mutableListOf())) {
            MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
        }

        val result = adapter.activeEntitlements(emptyList())

        assertTrue(result is MosaicActiveEntitlementsResult.ProviderUnavailable)
    }

    /**
     * The single rule this whole feature rests on: the raw purchase token never leaves the device.
     * A refactor that maps `purchaseToken` (or `originalJson`, which contains it) into the commerce
     * update would be invisible in every other test and would put credential-grade material on the
     * wire and into host logs. The order reference is carried verbatim beside the digest — never
     * instead of it — because the digest is the idempotency and correlation key.
     */
    @Test
    fun `a purchased update carries the digest and the order reference and never the raw token`() = runTest {
        val token = "sensitive-token-value"
        val order = mutableListOf<String>()
        val service = FakeBillingService(
            candidate = subscriptionCandidate(),
            purchase = GooglePurchase(
                products = listOf("pro_subscription"),
                state = Purchase.PurchaseState.PURCHASED,
                acknowledged = false,
                token = token,
                orderId = "GPA.1111-2222-3333-44444",
            ),
            order = order,
        )
        val adapter = adapter(service, RecordingDeliveryStore(order)) {
            MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
        }
        val observed = mutableListOf<dev.mosaic.sdk.MosaicCommerceUpdate>()
        val collector = launch { adapter.commerceUpdates.collect { observed += it } }
        advanceUntilIdle()
        adapter.loadProducts(listOf(mapping()))

        val result = async { adapter.purchase(mapping(), emptyList()) }
        advanceUntilIdle()
        assertTrue(result.await() is MosaicPurchaseResult.Purchased)

        val update = observed.single()
        assertEquals(tokenDigest(token), update.transactionReference)
        assertEquals("GPA.1111-2222-3333-44444", update.providerOrderReference)
        // The purchased update is only visible to subscribers after the transaction is finalized,
        // so an observation can never be reported ahead of Google Play acknowledgement.
        assertEquals(listOf("pending", "accepted", "acknowledge", "finalized"), order)
        assertTrue(token !in update.toString())
        assertTrue(adapter.diagnostics.none { token in it.toString() })
        collector.cancel()
    }

    /**
     * A Transaction Observation is best effort and must never sit on the purchase path. If any
     * subscriber to the update stream could back-pressure it, a slow, hung, or hostile endpoint
     * would stall the paywall and — far worse — could push Google Play acknowledgement past the
     * three-day refund window (three minutes for licence testers). The purchase must complete while
     * a subscriber is still suspended.
     */
    @Test
    fun `a purchase completes while an update subscriber is still suspended`() = runTest {
        val order = mutableListOf<String>()
        val service = FakeBillingService(
            candidate = subscriptionCandidate(),
            purchase = GooglePurchase(
                products = listOf("pro_subscription"),
                state = Purchase.PurchaseState.PURCHASED,
                acknowledged = false,
                token = "sensitive-token",
                orderId = "GPA.1111-2222-3333-44444",
            ),
            order = order,
        )
        val adapter = adapter(service, RecordingDeliveryStore(order)) {
            MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
        }
        val suspended = CompletableDeferred<Unit>()
        val collector = launch { adapter.commerceUpdates.collect { suspended.await() } }
        advanceUntilIdle()
        adapter.loadProducts(listOf(mapping()))

        val result = async { adapter.purchase(mapping(), emptyList()) }
        advanceUntilIdle()

        assertTrue(result.await() is MosaicPurchaseResult.Purchased)
        assertTrue("acknowledge" in order)
        assertTrue(!suspended.isCompleted)
        collector.cancel()
    }

    /**
     * The Google reference derivation is a documented cross-SDK contract, not an implementation
     * detail: Mosaic's server recomputes the identical digest to join a store notification to this
     * observation, so a platform-default or UTF-16 encoding would agree on every ASCII token and
     * silently break correlation on any other one. These are the shared vectors every SDK asserts.
     */
    @Test
    fun `the token digest reproduces the shared cross-SDK reference vectors`() {
        val vectors = billingReferenceVectors()

        assertEquals(4, vectors.size)
        vectors.forEach { (token, digest) -> assertEquals(digest, tokenDigest(token)) }
        assertTrue(
            vectors.keys.any { token -> token.any { it.code > 127 } },
        )
    }

    /** Reads token/digest pairs from the shared generated vectors without adding a JSON dependency. */
    private fun billingReferenceVectors(): Map<String, String> {
        val source = java.nio.file.Files.readAllBytes(
            repositoryFile("packages/test-fixtures/src/billing-reference-vectors.json"),
        ).toString(Charsets.UTF_8)
        val google = source.substringAfter("\"googlePlayTokenDigest\"").substringBefore("\"appStoreTransactionId\"")
        return Regex("\"token\": \"([^\"]+)\"[\\s\\S]*?\"digest\": \"([a-f0-9]{64})\"")
            .findAll(google)
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    private fun repositoryFile(relativePath: String): java.nio.file.Path {
        System.getProperty("mosaic.repositoryRoot")?.let { root ->
            val configured = java.nio.file.Path.of(root).resolve(relativePath)
            if (java.nio.file.Files.exists(configured)) return configured
        }
        var directory: java.nio.file.Path? = java.nio.file.Path.of("").toAbsolutePath()
        while (directory != null) {
            val candidate = directory.resolve(relativePath)
            if (java.nio.file.Files.exists(candidate)) return candidate
            directory = directory.parent
        }
        error("Cannot locate $relativePath in the Mosaic repository.")
    }

    private fun CoroutineScope.adapter(
        service: GooglePlayBillingService,
        store: DeliveryStore,
        acceptance: suspend (dev.mosaic.sdk.MosaicCommerceUpdate) ->
            dev.mosaic.sdk.MosaicCommerceUpdateAcceptanceDisposition,
    ): MosaicGooglePlayAdapter = MosaicGooglePlayAdapter(
        service = service,
        activityProvider = { Activity() },
        deliveryAcceptance = MosaicCommerceUpdateAcceptance(acceptance),
        deliveryStore = store,
        lifecycle = null,
        scope = this,
    ).also {
        it.installConfiguration(
            MosaicCommerceAdapterConfiguration(
                MosaicCommerceConfigurationReference("configuration", "revision"),
                listOf(mapping()),
            ),
        )
    }

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
        override suspend fun recordPending(digest: String) {
            order += "pending"
        }
        override suspend fun recordAccepted(digest: String) {
            order += "accepted"
        }
        override suspend fun recordFinalized(digest: String) {
            order += "finalized"
        }
        override suspend fun isFinalized(digest: String) = false
    }
}
