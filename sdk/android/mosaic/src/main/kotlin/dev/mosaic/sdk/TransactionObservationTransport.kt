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

internal interface MosaicTransactionObservationTransport {
    suspend fun submit(observation: MosaicTransactionObservation): MosaicTransactionObservationTransportResult
    fun cancel() = Unit
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

    override suspend fun submit(
        observation: MosaicTransactionObservation,
    ): MosaicTransactionObservationTransportResult = withContext(Dispatchers.IO) {
        val body = MosaicTransactionObservationCodec.encode(observation)
        val request = Request.Builder()
            .url(configuration.transactionObservationURL().toString())
            .header("Authorization", "Bearer ${configuration.apiKey}")
            .header("Accept", "application/json")
            .header("Mosaic-SDK-Platform", "android")
            .header("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        try {
            val call = client.newCall(request).also { activeCall = it }
            call.execute().use { response ->
                val retryAfter = response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 300)?.times(1_000)
                when {
                    response.code == 202 -> {
                        val decoded = response.body?.string()?.let {
                            MosaicTransactionObservationCodec.decodeResult(it, observation.submissionId)
                        }
                        // An unreadable or unrecognized acknowledgement is retried rather than
                        // treated as accepted: removal must be justified by a result this SDK
                        // understands.
                        decoded?.let { MosaicTransactionObservationTransportResult.Received(it) }
                            ?: MosaicTransactionObservationTransportResult.Retryable("ingestion_timeout")
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
