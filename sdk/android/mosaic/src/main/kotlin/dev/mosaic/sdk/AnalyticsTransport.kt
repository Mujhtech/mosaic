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

internal sealed interface MosaicAnalyticsTransportResult {
    data class Received(val response: MosaicAnalyticsIngestionResponse) : MosaicAnalyticsTransportResult
    data class Retryable(val safeCode: String, val retryAfterMillis: Long? = null) : MosaicAnalyticsTransportResult
}

internal interface MosaicAnalyticsTransport {
    suspend fun send(batch: MosaicAnalyticsBatch): MosaicAnalyticsTransportResult
    fun cancel() = Unit
}

internal class MosaicHTTPAnalyticsTransport(
    private val configuration: MosaicConfiguration,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : MosaicAnalyticsTransport {
    @Volatile private var activeCall: okhttp3.Call? = null
    override suspend fun send(batch: MosaicAnalyticsBatch): MosaicAnalyticsTransportResult = withContext(Dispatchers.IO) {
        val body = MosaicAnalyticsCodec.encodeBatch(batch)
        if (body.toByteArray(Charsets.UTF_8).size > 512 * 1024) {
            return@withContext MosaicAnalyticsTransportResult.Retryable("analytics.batch_too_large")
        }
        val request = Request.Builder()
            .url(configuration.analyticsURL().toString())
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
                if (response.code != 200) {
                    return@withContext MosaicAnalyticsTransportResult.Retryable(
                        if (response.code == 429) "rate_limited" else "service_temporarily_unavailable",
                        retryAfter,
                    )
                }
                val decoded = response.body?.string()?.let { runCatching { MosaicAnalyticsCodec.decodeResponse(it) }.getOrNull() }
                    ?: return@withContext MosaicAnalyticsTransportResult.Retryable("ingestion_timeout")
                MosaicAnalyticsTransportResult.Received(decoded)
            }
        } catch (_: IOException) {
            MosaicAnalyticsTransportResult.Retryable("service_temporarily_unavailable")
        } finally {
            activeCall = null
        }
    }

    override fun cancel() { activeCall?.cancel() }
}

private fun MosaicConfiguration.analyticsURL(): URI {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    return URI("${base.toString().trimEnd('/')}/v1/sdk/events/batch")
}
