package dev.mosaic.sdk.googleplay

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

internal data class GoogleBillingResult(val code: Int)

internal data class GooglePurchase(
    val products: List<String>,
    val state: Int,
    val acknowledged: Boolean,
    val token: String,
    /**
     * Google's order identifier. Null while a purchase is pending, and — per the Play Billing
     * reference — null-able in general, so nothing may depend on its presence. On a subscription
     * renewal it is the *initial* order's identifier, which makes it a subscription-level join
     * handle, never a per-transaction identity.
     */
    val orderId: String? = null,
)

internal interface GooglePlayBillingService {
    var updates: (GoogleBillingResult, List<GooglePurchase>) -> Unit
    suspend fun connect(): GoogleBillingResult
    suspend fun queryProducts(productIds: List<String>, type: String): Pair<GoogleBillingResult, List<GoogleProductCandidate>>
    fun launch(activity: Activity, product: GoogleSelectedProduct): GoogleBillingResult
    suspend fun queryPurchases(type: String): Pair<GoogleBillingResult, List<GooglePurchase>>
    suspend fun acknowledge(token: String): GoogleBillingResult
    fun close()
}

internal class AndroidGooglePlayBillingService(context: Context) : GooglePlayBillingService {
    override var updates: (GoogleBillingResult, List<GooglePurchase>) -> Unit = { _, _ -> }
    private val listener = PurchasesUpdatedListener { result, purchases ->
        updates(result.normalized(), purchases.orEmpty().map { it.normalized() })
    }
    private val client = BillingClient.newBuilder(context.applicationContext)
        .setListener(listener)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
        )
        .enableAutoServiceReconnection()
        .build()

    override suspend fun connect(): GoogleBillingResult {
        if (client.isReady) return GoogleBillingResult(BillingClient.BillingResponseCode.OK)
        return suspendCancellableCoroutine { continuation ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (continuation.isActive) continuation.resume(result.normalized())
                }

                override fun onBillingServiceDisconnected() = Unit
            })
        }
    }

    override suspend fun queryProducts(
        productIds: List<String>,
        type: String,
    ): Pair<GoogleBillingResult, List<GoogleProductCandidate>> =
        suspendCancellableCoroutine { continuation ->
            val products = productIds.map {
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(it)
                    .setProductType(type)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder().setProductList(products).build()
            client.queryProductDetailsAsync(params) { result, queryResult ->
                if (continuation.isActive) {
                    continuation.resume(
                        result.normalized() to queryResult.productDetailsList.map {
                            it.normalized(type)
                        },
                    )
                }
            }
        }

    override fun launch(
        activity: Activity,
        product: GoogleSelectedProduct,
    ): GoogleBillingResult {
        val details = product.nativeHandle as ProductDetails
        val detail = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
            .apply { product.offerToken?.let(::setOfferToken) }
            .build()
        return client.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(detail)).build(),
        ).normalized()
    }

    override suspend fun queryPurchases(
        type: String,
    ): Pair<GoogleBillingResult, List<GooglePurchase>> =
        suspendCancellableCoroutine { continuation ->
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(type).build(),
            ) { result, purchases ->
                if (continuation.isActive) {
                    continuation.resume(result.normalized() to purchases.map { it.normalized() })
                }
            }
        }

    override suspend fun acknowledge(token: String): GoogleBillingResult =
        suspendCancellableCoroutine { continuation ->
            client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
            ) { result ->
                if (continuation.isActive) continuation.resume(result.normalized())
            }
        }

    override fun close() = client.endConnection()

    private fun ProductDetails.normalized(type: String): GoogleProductCandidate {
        val oneTime = oneTimePurchaseOfferDetails?.let {
            GooglePricingPhase(
                formattedPrice = it.formattedPrice,
                currencyCode = it.priceCurrencyCode,
                priceMicros = it.priceAmountMicros,
                billingPeriod = "",
                recurrenceMode = 1,
                cycles = 1,
            )
        }
        val offers = subscriptionOfferDetails.orEmpty().map { offer ->
            GoogleOfferCandidate(
                basePlanId = offer.basePlanId,
                offerId = offer.offerId,
                offerToken = offer.offerToken,
                phases = offer.pricingPhases.pricingPhaseList.map { phase ->
                    GooglePricingPhase(
                        formattedPrice = phase.formattedPrice,
                        currencyCode = phase.priceCurrencyCode,
                        priceMicros = phase.priceAmountMicros,
                        billingPeriod = phase.billingPeriod,
                        recurrenceMode = phase.recurrenceMode,
                        cycles = phase.billingCycleCount,
                    )
                },
            )
        }
        return GoogleProductCandidate(
            productId = productId,
            productType = if (type == BillingClient.ProductType.SUBS) "subscription" else "one_time_non_consumable",
            name = name,
            oneTimePrice = oneTime,
            offers = offers,
            nativeHandle = this,
        )
    }

    private fun BillingResult.normalized() = GoogleBillingResult(responseCode)
    // orderId is the only additional Purchase value that is normalized. getOriginalJson(),
    // getSignature(), and getAccountIdentifiers() are deliberately never read: the first two are
    // equivalent to the purchase token, and the third is developer-supplied subject data.
    private fun Purchase.normalized() =
        GooglePurchase(products, purchaseState, isAcknowledged, purchaseToken, orderId)
}
