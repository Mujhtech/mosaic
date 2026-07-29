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

internal sealed interface MosaicCustomerEntitlementTransportResult {
    /**
     * A contract record: either a `customerEntitlementSnapshot` or a `snapshotUnchanged`.
     *
     * There is deliberately no separate not-modified member. Conditional revalidation is expressed
     * **inside the contract** — the request states `knownSnapshotVersion` and `entityTag`, and the
     * server answers with a `snapshotUnchanged` record over `200` — rather than through HTTP
     * status codes and side-band headers. One path decodes one document, and freshness always comes
     * from the record that carries it, so a proxy that strips or rewrites a header cannot change how
     * long a device believes its cache is valid.
     */
    data class Record(
        val body: String,
        val entityTag: String?,
    ) : MosaicCustomerEntitlementTransportResult

    /**
     * A bare `304` with no body.
     *
     * Nothing in this SDK asks for one — conditional revalidation lives in the request body — so it
     * comes from an intermediary rather than from Mosaic. It is honoured to the extent it can be:
     * the cache is preserved, because a 304 is not evidence of a change. It slides **nothing**. Only
     * the `snapshotUnchanged` record, which carries refreshed windows Mosaic actually vouched for,
     * can extend how long a device serves access offline; letting a cache-layer 304 do it would let
     * a proxy grant unconfirmed offline access indefinitely.
     */
    data object NotModified : MosaicCustomerEntitlementTransportResult

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
        requestBody: String,
    ): MosaicCustomerEntitlementTransportResult = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(configuration.customerEntitlementsURL().toString())
            // The token is a bearer credential. It exists in this request and in memory, and
            // nowhere else: it is never persisted, never logged, and never put in a query string
            // where proxies and server access logs would record it.
            .header("Authorization", "Bearer ${token.value}")
            .header("Mosaic-SDK-Key", configuration.apiKey)
            .header("Accept", "application/json")
            .header("Mosaic-SDK-Platform", "android")
            .header("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
            // The sync request is a contract record, so it always has a body and is always a POST.
            // Conditional revalidation travels in that body rather than in `If-None-Match`.
            .post(requestBody.toRequestBody("application/json".toMediaType()))
            .build()

        try {
            val call = client.newCall(request).also { activeCall = it }
            call.execute().use { response ->
                val retryAfter = response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 300)?.toInt()
                val tag = response.header("ETag")
                    ?.takeIf(::mosaicIsStrongETag)
                    ?.trim('"')
                when {
                    response.code == 304 -> MosaicCustomerEntitlementTransportResult.NotModified
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
                            MosaicCustomerEntitlementTransportResult.Record(body, tag)
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
}

private fun MosaicConfiguration.customerEntitlementsURL(): URI {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    return URI("${base.toString().trimEnd('/')}/v1/sdk/billing/entitlements")
}
