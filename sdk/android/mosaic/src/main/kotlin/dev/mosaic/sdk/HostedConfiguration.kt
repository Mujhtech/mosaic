package dev.mosaic.sdk

import android.content.Context
import com.google.gson.Gson
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

data class MosaicCachedConfiguration(val etag: String?, val payload: String)

interface MosaicConfigurationCache {
    suspend fun read(): MosaicCachedConfiguration?
    suspend fun write(value: MosaicCachedConfiguration)
}

class MosaicFileConfigurationCache(
    context: Context,
    configuration: MosaicConfiguration,
) : MosaicConfigurationCache {
    private val directory = File(
        context.applicationContext.filesDir,
        "mosaic/configuration-v1/${mosaicConfigurationCacheNamespace(configuration)}",
    )
    private val entry = File(directory, "accepted-release.json")

    override suspend fun read(): MosaicCachedConfiguration? = withContext(Dispatchers.IO) {
        if (!entry.isFile) return@withContext null
        val cached = Gson().fromJson(entry.readText(), MosaicCachedConfiguration::class.java)
            ?: throw IOException("The Mosaic configuration cache record is invalid.")
        if (!mosaicIsStrongETag(cached.etag)) {
            throw IOException("The Mosaic configuration cache ETag is invalid.")
        }
        cached
    }

    override suspend fun write(value: MosaicCachedConfiguration) = withContext(Dispatchers.IO) {
        require(mosaicIsStrongETag(value.etag)) { "The Mosaic configuration cache ETag must be strong." }
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw IOException("Could not create the Mosaic configuration cache directory.")
        }
        val temporary = File.createTempFile("accepted-release-", ".tmp", directory)
        try {
            FileOutputStream(temporary).use { output ->
                OutputStreamWriter(output, Charsets.UTF_8).buffered().use { writer ->
                    writer.write(Gson().toJson(value))
                    writer.flush()
                    output.fd.sync()
                }
            }
            if (!temporary.renameTo(entry)) {
                throw IOException("Could not atomically store Mosaic configuration.")
            }
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }
}

sealed interface MosaicConfigurationResponse {
    data class Modified(val payload: String, val etag: String?) : MosaicConfigurationResponse
    data object NotModified : MosaicConfigurationResponse
    data class Failed(val reason: String) : MosaicConfigurationResponse
}

fun interface MosaicConfigurationTransport {
    suspend fun fetch(etag: String?): MosaicConfigurationResponse
}

class MosaicHTTPConfigurationTransport(
    private val configuration: MosaicConfiguration,
    private val capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : MosaicConfigurationTransport {
    override suspend fun fetch(etag: String?): MosaicConfigurationResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(configuration.configurationURL().toString())
            .header("Authorization", "Bearer ${configuration.apiKey}")
            .header("Accept", "application/vnd.mosaic.configuration+json;version=1")
            .header("Mosaic-SDK-Platform", "android")
            .header("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
            .header("Mosaic-Configuration-Versions", MOSAIC_CONFIGURATION_DELIVERY_VERSION)
            .header("Mosaic-Paywall-Protocol-Versions", MOSAIC_SUPPORTED_PROTOCOL_VERSIONS.sorted().joinToString(","))
            .header("Mosaic-Paywall-Capabilities", capabilityReport.configurationDeliveryCapabilitiesHeader())
            .apply { configuration.applicationVersion?.let { header("Mosaic-App-Version", it) } }
            .apply { etag?.let { header("If-None-Match", it) } }
            .build()
        try {
            client.newCall(request).execute().use { response ->
                when (response.code) {
                    304 -> MosaicConfigurationResponse.NotModified
                    200 -> response.body?.string()?.let { MosaicConfigurationResponse.Modified(it, response.header("ETag")) }
                        ?: MosaicConfigurationResponse.Failed("The configuration response was empty.")
                    else -> MosaicConfigurationResponse.Failed("Configuration request failed with HTTP ${response.code}.")
                }
            }
        } catch (error: IOException) {
            MosaicConfigurationResponse.Failed(error.message ?: "Configuration request failed.")
        }
    }
}

enum class MosaicConfigurationSource { REMOTE, CACHE, BUNDLED_FALLBACK }

data class MosaicAcceptedConfiguration(
    val release: MosaicConfigurationRelease,
    val source: MosaicConfigurationSource,
    val etag: String,
)

sealed interface MosaicConfigurationRefreshResult {
    data class Updated(val configuration: MosaicAcceptedConfiguration) : MosaicConfigurationRefreshResult
    data class NotModified(val configuration: MosaicAcceptedConfiguration) : MosaicConfigurationRefreshResult
    data class Retained(
        val configuration: MosaicAcceptedConfiguration,
        val diagnosticCode: String,
    ) : MosaicConfigurationRefreshResult
    data class Unavailable(val diagnosticCode: String) : MosaicConfigurationRefreshResult
}

sealed interface MosaicPlacementResult {
    data class Available(
        val document: MosaicPaywallDocument,
        val source: MosaicConfigurationSource,
        val releaseId: String?,
        val releaseNumber: Long?,
    ) : MosaicPlacementResult
    data class PlacementUnavailable(val key: String) : MosaicPlacementResult
    data object ConfigurationUnavailable : MosaicPlacementResult
}

/** Serializes refreshes so an older response can never replace a newer accepted release. */
class MosaicHostedConfigurationClient(
    private val transport: MosaicConfigurationTransport,
    private val cache: MosaicConfigurationCache,
    private val bundledFallback: MosaicPaywallDocumentSource? = null,
    private val capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    private val diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
) {
    private val refreshLock = Mutex()
    @Volatile private var accepted: MosaicAcceptedConfiguration? = null

    val acceptedConfiguration: MosaicAcceptedConfiguration?
        get() = accepted

    suspend fun refresh(): MosaicConfigurationRefreshResult = refreshLock.withLock {
        loadValidCache()
        val response = try {
            transport.fetch(accepted?.etag)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_TRANSPORT_FAILED)
        }
        when (response) {
            is MosaicConfigurationResponse.Modified -> {
                val responseETag = response.etag
                if (!mosaicIsStrongETag(responseETag)) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_ETAG_REJECTED)
                }
                val acceptedETag = requireNotNull(responseETag)
                val candidate = try {
                    MosaicConfigurationDeliveryDecoder.decode(response.payload, capabilityReport)
                } catch (_: RuntimeException) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_RELEASE_REJECTED)
                }
                val current = accepted
                if (current != null && !candidate.belongsToSameEnvironmentAs(current.release)) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_RELEASE_REJECTED)
                }
                if (current != null && candidate.number < current.release.number) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_RELEASE_REJECTED)
                }
                try {
                    cache.write(MosaicCachedConfiguration(acceptedETag, response.payload))
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_CACHE_WRITE_FAILED)
                }
                val updated = MosaicAcceptedConfiguration(
                    release = candidate,
                    source = MosaicConfigurationSource.REMOTE,
                    etag = acceptedETag,
                )
                accepted = updated
                MosaicConfigurationRefreshResult.Updated(updated)
            }
            MosaicConfigurationResponse.NotModified -> {
                val current = accepted
                if (current == null) {
                    retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_UNEXPECTED_NOT_MODIFIED)
                } else {
                    MosaicConfigurationRefreshResult.NotModified(current)
                }
            }
            is MosaicConfigurationResponse.Failed ->
                retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_TRANSPORT_FAILED)
        }
    }

    suspend fun paywall(placement: String, refresh: Boolean = false): MosaicPlacementResult {
        if (refresh) refresh() else loadValidCache()
        accepted?.let { configuration ->
            val delivered = configuration.release.paywall(placement)
                ?: return MosaicPlacementResult.PlacementUnavailable(placement)
            return MosaicPlacementResult.Available(
                delivered.document,
                configuration.source,
                configuration.release.id,
                configuration.release.number,
            )
        }
        val fallbackSource = bundledFallback
        if (fallbackSource == null) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_BUNDLED_FALLBACK_MISSING,
                "No valid Mosaic configuration is available.",
            )
            return MosaicPlacementResult.ConfigurationUnavailable
        }
        val fallback = runCatching { fallbackSource.read() }
            .getOrNull()
            ?.let { runCatching { MosaicProtocolDecoder.decode(it, capabilityReport) }.getOrNull() }
        if (fallback == null) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_BUNDLED_FALLBACK_REJECTED,
                "No valid Mosaic configuration is available.",
            )
        }
        return fallback?.let { MosaicPlacementResult.Available(it, MosaicConfigurationSource.BUNDLED_FALLBACK, null, null) }
            ?: MosaicPlacementResult.ConfigurationUnavailable
    }

    private suspend fun loadValidCache(): MosaicAcceptedConfiguration? {
        accepted?.let { return it }
        val cached = try {
            cache.read()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_CACHE_REJECTED,
                "The cached Mosaic configuration was unavailable or invalid.",
            )
            return null
        } ?: return null
        val cachedETag = cached.etag
        if (!mosaicIsStrongETag(cachedETag)) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_CACHE_REJECTED,
                "The cached Mosaic configuration was unavailable or invalid.",
            )
            return null
        }
        val acceptedETag = requireNotNull(cachedETag)
        val release = try {
            MosaicConfigurationDeliveryDecoder.decode(cached.payload, capabilityReport)
        } catch (_: RuntimeException) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_CACHE_REJECTED,
                "The cached Mosaic configuration was unavailable or invalid.",
            )
            return null
        }
        return MosaicAcceptedConfiguration(release, MosaicConfigurationSource.CACHE, acceptedETag).also {
            accepted = it
        }
    }

    private fun retainOrUnavailable(code: MosaicDiagnosticCode): MosaicConfigurationRefreshResult {
        val current = accepted
        diagnose(code, "The last accepted Mosaic configuration was preserved.")
        return if (current == null) {
            MosaicConfigurationRefreshResult.Unavailable(code.wireName)
        } else {
            MosaicConfigurationRefreshResult.Retained(current, code.wireName)
        }
    }

    private fun diagnose(code: MosaicDiagnosticCode, message: String) {
        diagnostics.record(MosaicDiagnostic(code, message))
    }
}

internal fun mosaicConfigurationCacheNamespace(configuration: MosaicConfiguration): String {
    val identity = "${configuration.configurationURL()}\n${configuration.apiKey.trim()}"
    return MessageDigest.getInstance("SHA-256")
        .digest(identity.toByteArray(Charsets.UTF_8))
        .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

internal fun mosaicIsStrongETag(value: String?): Boolean =
    value != null &&
        value.length >= 2 &&
        value.first() == '"' &&
        value.last() == '"' &&
        !value.startsWith("W/") &&
        value.drop(1).dropLast(1).all { character ->
            character == '\u0021' ||
                character in '\u0023'..'\u007e' ||
                character.code in 0x80..0xff
        }

private fun MosaicConfigurationRelease.belongsToSameEnvironmentAs(other: MosaicConfigurationRelease): Boolean =
    environment.id == other.environment.id && environment.key == other.environment.key

private fun MosaicCapabilityReport.configurationDeliveryCapabilitiesHeader(): String =
    supportedCapabilityVersions
        .sortedWith(compareBy({ it.name.wireName }, { it.version }))
        .joinToString(separator = ",") { capability ->
            "${capability.name.wireName}@${capability.version}"
        }

private fun MosaicConfiguration.configurationURL(): URI {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    val normalized = base.toString().trimEnd('/')
    return URI("$normalized/v1/sdk/configuration")
}
