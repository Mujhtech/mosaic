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

/**
 * The refreshed freshness window a response carries in headers.
 *
 * It travels as headers as well as inside the record because a `304` has no body: without it, a
 * device that keeps confirming the same version would expire its cache while demonstrably in contact
 * with the server.
 */
internal data class MosaicCustomerFreshnessHeaders(
    val refreshAfter: String,
    val validUntil: String,
    val staleGraceSeconds: Int,
)

internal sealed interface MosaicCustomerEntitlementTransportResult {
    data class Record(
        val body: String,
        val entityTag: String?,
        val freshness: MosaicCustomerFreshnessHeaders?,
    ) : MosaicCustomerEntitlementTransportResult

    data class NotModified(
        val entityTag: String?,
        val freshness: MosaicCustomerFreshnessHeaders?,
    ) : MosaicCustomerEntitlementTransportResult

    /** The customer token was refused. The caller retries exactly once, after a forced refresh. */
    data object Unauthorized : MosaicCustomerEntitlementTransportResult

    data class Unavailable(
        val safeCode: String,
        val retryAfterSeconds: Int? = null,
    ) : MosaicCustomerEntitlementTransportResult
}

internal fun interface MosaicCustomerEntitlementTransport {
    suspend fun sync(
        token: MosaicCustomerAccessToken,
        entityTag: String?,
        requestBody: String,
    ): MosaicCustomerEntitlementTransportResult
}

/**
 * The one authenticated read the SDK makes on a customer's behalf.
 *
 * Two credentials travel together and mean different things: the customer token in `Authorization`
 * says *who*, and the public SDK key in `Mosaic-SDK-Key` says *which application build*. The public
 * key alone can never select a customer, which is the whole reason Mosaic Billing requires the host
 * to run a backend.
 */
internal class MosaicHTTPCustomerEntitlementTransport(
    private val configuration: MosaicConfiguration,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : MosaicCustomerEntitlementTransport {
    @Volatile
    private var activeCall: okhttp3.Call? = null

    override suspend fun sync(
        token: MosaicCustomerAccessToken,
        entityTag: String?,
        requestBody: String,
    ): MosaicCustomerEntitlementTransportResult = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url(configuration.customerEntitlementsURL().toString())
            // The token is a bearer credential. It exists in this request and in memory, and
            // nowhere else: it is never persisted, never logged, and never put in a query string
            // where proxies and server access logs would record it.
            .header("Authorization", "Bearer ${token.value}")
            .header("Mosaic-SDK-Key", configuration.apiKey)
            .header("Accept", "application/json")
            .header("Mosaic-SDK-Platform", "android")
            .header("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
            .post(requestBody.toRequestBody("application/json".toMediaType()))
        entityTag?.let { builder.header("If-None-Match", "\"$it\"") }

        try {
            val call = client.newCall(builder.build()).also { activeCall = it }
            call.execute().use { response ->
                val retryAfter = response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 300)?.toInt()
                val tag = response.header("ETag")
                    ?.takeIf(::mosaicIsStrongETag)
                    ?.trim('"')
                val freshness = response.freshnessHeaders()
                when {
                    response.code == 304 -> MosaicCustomerEntitlementTransportResult.NotModified(tag, freshness)
                    response.code in 200..299 -> {
                        val contentType = response.body?.contentType()
                        if (contentType?.type != "application" || contentType.subtype != "json") {
                            // A captive portal or a misrouted proxy answers 200 with HTML. Parsing
                            // that would produce a malformed-record rejection and an alarming
                            // diagnostic; naming it as a transport failure is the honest report.
                            return@use MosaicCustomerEntitlementTransportResult.Unavailable(
                                "customer.entitlements.unexpectedContentType",
                            )
                        }
                        val body = response.body?.source()?.let { source ->
                            // Bounded read: an unbounded response body is a memory attack on a
                            // client that must keep working on a low-end device.
                            source.request((MosaicCustomerEntitlementCodec.MAX_RECORD_BYTES + 1).toLong())
                            source.buffer.snapshot().utf8()
                        }
                        if (body == null ||
                            body.toByteArray(Charsets.UTF_8).size > MosaicCustomerEntitlementCodec.MAX_RECORD_BYTES
                        ) {
                            MosaicCustomerEntitlementTransportResult.Unavailable(
                                "customer.entitlements.responseTooLarge",
                            )
                        } else {
                            MosaicCustomerEntitlementTransportResult.Record(body, tag, freshness)
                        }
                    }
                    response.code == 401 || response.code == 403 ->
                        MosaicCustomerEntitlementTransportResult.Unauthorized
                    response.code == 429 -> MosaicCustomerEntitlementTransportResult.Unavailable(
                        "customer.entitlements.rateLimited",
                        retryAfter,
                    )
                    // A 4xx cannot be fixed by resending the identical request, but it is still
                    // "Mosaic did not answer", never "this customer has no access".
                    response.code in 400..499 -> MosaicCustomerEntitlementTransportResult.Unavailable(
                        "customer.entitlements.requestRejected",
                    )
                    else -> MosaicCustomerEntitlementTransportResult.Unavailable(
                        "customer.entitlements.serviceUnavailable",
                        retryAfter,
                    )
                }
            }
        } catch (_: IOException) {
            MosaicCustomerEntitlementTransportResult.Unavailable("customer.entitlements.serviceUnavailable")
        } finally {
            activeCall = null
        }
    }

    fun cancel() {
        activeCall?.cancel()
    }

    private fun okhttp3.Response.freshnessHeaders(): MosaicCustomerFreshnessHeaders? {
        val refreshAfter = header("Mosaic-Refresh-After") ?: return null
        val validUntil = header("Mosaic-Valid-Until") ?: return null
        val grace = header("Mosaic-Stale-Grace-Seconds")?.toIntOrNull() ?: 0
        // Header-borne freshness is validated exactly like the record's own: an unparseable header
        // slides nothing rather than corrupting the window it was meant to extend.
        return runCatching {
            mosaicContractInstantMillis(refreshAfter)
            mosaicContractInstantMillis(validUntil)
            require(grace in 0..MosaicCustomerEntitlementCodec.MAX_CACHE_HORIZON_SECONDS.toInt())
            MosaicCustomerFreshnessHeaders(refreshAfter, validUntil, grace)
        }.getOrNull()
    }
}

private fun MosaicConfiguration.customerEntitlementsURL(): URI {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    return URI("${base.toString().trimEnd('/')}/v1/sdk/billing/entitlements")
}
