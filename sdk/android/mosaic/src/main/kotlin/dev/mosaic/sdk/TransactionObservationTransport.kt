package dev.mosaic.sdk

import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

internal sealed interface MosaicTransactionObservationTransportResult {
    data class Received(val result: MosaicTransactionObservationResult) :
        MosaicTransactionObservationTransportResult

    data class Retryable(val safeCode: String, val retryAfterMillis: Long? = null) :
        MosaicTransactionObservationTransportResult
}

/**
 * Supplies the current Customer Access Token, if there is one, at the moment of a request.
 *
 * It is a *source* rather than a value because the token is read at send time, never at enqueue
 * time. An observation may sit in the durable queue across a sign-in, an app restart, or several
 * days offline, so a token captured when the purchase completed would be expired or simply wrong by
 * the time the observation is delivered.
 */
internal fun interface MosaicCustomerTokenSource {
    suspend fun currentCustomerToken(): MosaicCustomerAccessToken?
}

/** Header carrying the Customer Access Token that binds a submission to a Billing Customer. */
internal const val MOSAIC_CUSTOMER_TOKEN_HEADER = "Mosaic-Customer-Token"

/**
 * Builds the observation request headers.
 *
 * Extracted so the binding rule is testable without a live socket. Two credentials with different
 * meanings travel here: the public SDK key says which application build is reporting, and the
 * customer token says whose purchase it is. The customer token is **optional** — an anonymous
 * submission is valid and is what an unidentified user produces — so a missing token omits the
 * header rather than failing or delaying the submission.
 */
internal fun mosaicObservationHeaders(
    apiKey: String,
    customerToken: MosaicCustomerAccessToken?,
): Map<String, String> = buildMap {
    put("Authorization", "Bearer $apiKey")
    put("Accept", "application/json")
    put("Mosaic-SDK-Platform", "android")
    put("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
    customerToken?.let { put(MOSAIC_CUSTOMER_TOKEN_HEADER, it.value) }
}

internal interface MosaicTransactionObservationTransport {
    suspend fun submit(observation: MosaicTransactionObservation): MosaicTransactionObservationTransportResult
    fun cancel() = Unit

    /**
     * Binds a customer-token source. Optional by default: a transport that never talks to Mosaic's
     * observation endpoint has nothing to bind, and an unbound transport submits anonymously.
     */
    fun bindCustomerTokenSource(source: MosaicCustomerTokenSource) = Unit
}

/**
 * Submits one observation to the public SDK observation endpoint. The request carries the Mosaic
 * public SDK key only; no store credential exists in any SDK, and the trusted server endpoint (which
 * may carry a raw token) is deliberately not reachable from here.
 */
internal class MosaicHTTPTransactionObservationTransport(
    private val configuration: MosaicConfiguration,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : MosaicTransactionObservationTransport {
    @Volatile private var activeCall: okhttp3.Call? = null
    @Volatile private var customerTokenSource: MosaicCustomerTokenSource? = null

    override fun bindCustomerTokenSource(source: MosaicCustomerTokenSource) {
        customerTokenSource = source
    }

    override suspend fun submit(
        observation: MosaicTransactionObservation,
    ): MosaicTransactionObservationTransportResult = withContext(Dispatchers.IO) {
        val body = MosaicTransactionObservationCodec.encode(observation)
        // Read at send time, and never allowed to fail the submission. This path is fire and
        // forget: a token backend that is down, slow, or absent must cost the binding, not the
        // observation, so the request proceeds anonymously rather than being dropped or retried.
        val customerToken = runCatching { customerTokenSource?.currentCustomerToken() }.getOrNull()
        val request = Request.Builder()
            .url(configuration.transactionObservationURL().toString())
            .apply { mosaicObservationHeaders(configuration.apiKey, customerToken).forEach(::header) }
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        try {
            val call = client.newCall(request).also { activeCall = it }
            call.execute().use { response ->
                val retryAfter = response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 300)?.times(1_000)
                when {
                    response.code in 200..299 -> {
                        val decoded = response.body?.string()?.let {
                            MosaicTransactionObservationCodec.decodeResult(it, observation.submissionId)
                        }
                        // An unreadable or unrecognized acknowledgement is retried rather than
                        // treated as accepted: removal must be justified by a result this SDK
                        // understands.
                        decoded?.let {
                            MosaicTransactionObservationTransportResult.Received(
                                // The record's own retryAfterSeconds wins; the transport header is
                                // only consulted when the contract record did not state one.
                                if (it is MosaicTransactionObservationResult.RetryableFailure &&
                                    it.retryAfterSeconds == null
                                ) {
                                    it.copy(retryAfterSeconds = retryAfter?.div(1_000)?.toInt())
                                } else {
                                    it
                                },
                            )
                        } ?: MosaicTransactionObservationTransportResult.Retryable("ingestion_timeout", retryAfter)
                    }
                    response.code == 429 ->
                        MosaicTransactionObservationTransportResult.Retryable("rate_limited", retryAfter)
                    // 4xx other than 429 cannot be fixed by resubmitting the identical document.
                    response.code in 400..499 -> MosaicTransactionObservationTransportResult.Received(
                        MosaicTransactionObservationResult.PermanentlyRejected(
                            if (response.code == 401 || response.code == 403) {
                                "authority_not_allowed"
                            } else {
                                "observation_schema_invalid"
                            },
                        ),
                    )
                    else -> MosaicTransactionObservationTransportResult.Retryable(
                        "service_temporarily_unavailable",
                        retryAfter,
                    )
                }
            }
        } catch (_: IOException) {
            MosaicTransactionObservationTransportResult.Retryable("service_temporarily_unavailable")
        } finally {
            activeCall = null
        }
    }

    override fun cancel() { activeCall?.cancel() }
}

private fun MosaicConfiguration.transactionObservationURL(): URI {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    return URI("${base.toString().trimEnd('/')}/v1/sdk/billing/observations")
}
