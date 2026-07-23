package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.io.File
import java.io.IOException
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody

class ConfigurationDeliveryTest {
    @Test
    fun `decodes the canonical delivery fixture and resolves its placement`() {
        val release = MosaicConfigurationDeliveryDecoder.decode(validRelease())

        assertEquals(1, release.number)
        assertEquals("navigation-only", release.paywall("onboarding_complete")?.document?.id)
    }

    @Test
    fun `HTTP transport sends the complete exact Protocol 0_2 capability catalog`() = runTest {
        val observed = AtomicReference<Request>()
        val httpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                observed.set(chain.request())
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .header("ETag", "\"release-transport-test\"")
                    .body("{}".toResponseBody("application/json".toMediaType()))
                    .build()
            }
            .build()
        val transport = MosaicHTTPConfigurationTransport(
            configuration = MosaicConfiguration("sdk_public_android"),
            client = httpClient,
        )

        val response = transport.fetch(etag = null)

        assertTrue(response is MosaicConfigurationResponse.Modified)
        val actual = observed.get().header("Mosaic-Paywall-Capabilities")
            ?.split(',')
            .orEmpty()
        val expected = MosaicCapabilityCatalog.v02
            .map { capability -> "${capability.wireName}@$MOSAIC_PROTOCOL_VERSION" }
            .sorted()
        assertEquals(expected, actual)
        assertEquals(expected.size, actual.toSet().size)
    }

    @Test(expected = MosaicConfigurationDeliveryException::class)
    fun `rejects unknown envelope fields`() {
        val json = JsonParser.parseString(validRelease()).asJsonObject
        json.addProperty("futureField", true)

        MosaicConfigurationDeliveryDecoder.decode(json.toString())
    }

    @Test
    fun `preserves a valid cache when a remote candidate is malformed`() = runTest {
        val cached = MemoryCache(MosaicCachedConfiguration("\"release-1\"", validRelease()))
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Modified("{}", "\"release-2\"")
            },
            cache = cached,
        )

        val result = client.refresh()

        assertTrue(result is MosaicConfigurationRefreshResult.Retained)
        assertEquals(1L, (result as MosaicConfigurationRefreshResult.Retained).configuration.release.number)
        assertEquals("\"release-1\"", cached.value?.etag)
    }

    @Test
    fun `304 preserves and resolves the cached release`() = runTest {
        val cached = MemoryCache(MosaicCachedConfiguration("\"release-1\"", validRelease()))
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport { MosaicConfigurationResponse.NotModified },
            cache = cached,
        )

        val refresh = client.refresh()
        val result = client.paywall("onboarding_complete")

        assertTrue(refresh is MosaicConfigurationRefreshResult.NotModified)
        assertTrue(result is MosaicPlacementResult.Available)
        assertEquals(MosaicConfigurationSource.CACHE, (result as MosaicPlacementResult.Available).source)
    }

    @Test
    fun `unsupported remote release cannot replace a valid cache`() = runTest {
        val unsupported = JsonParser.parseString(validRelease()).asJsonObject.apply {
            addProperty("configurationDeliveryVersion", "2")
        }.toString()
        val cached = MemoryCache(MosaicCachedConfiguration("\"release-1\"", validRelease()))
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Modified(unsupported, "\"release-2\"")
            },
            cache = cached,
        )

        val result = client.refresh()

        assertTrue(result is MosaicConfigurationRefreshResult.Retained)
        assertEquals(1L, (result as MosaicConfigurationRefreshResult.Retained).configuration.release.number)
        assertEquals("\"release-1\"", cached.value?.etag)
    }

    @Test
    fun `cache survives client reconstruction`() = runTest {
        val calls = AtomicInteger()
        val cache = MemoryCache(MosaicCachedConfiguration("\"release-1\"", validRelease()))
        val reconstructed = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                calls.incrementAndGet()
                MosaicConfigurationResponse.Failed("offline")
            },
            cache = cache,
        )

        val result = reconstructed.paywall("onboarding_complete")

        assertTrue(result is MosaicPlacementResult.Available)
        assertEquals(MosaicConfigurationSource.CACHE, (result as MosaicPlacementResult.Available).source)
        assertEquals(0, calls.get())
    }

    @Test
    fun `concurrent refreshes serialize cache replacement`() = runTest {
        val calls = AtomicInteger()
        val cache = MemoryCache(null)
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                calls.incrementAndGet()
                MosaicConfigurationResponse.Modified(validRelease(), "\"release-1\"")
            },
            cache = cache,
        )

        val releases = coroutineScope { List(4) { async { client.refresh() } }.awaitAll() }

        assertTrue(
            releases.all {
                it is MosaicConfigurationRefreshResult.Updated && it.configuration.release.number == 1L
            },
        )
        assertEquals(4, calls.get())
        assertEquals(1L, MosaicConfigurationDeliveryDecoder.decode(cache.value!!.payload).number)
    }

    @Test
    fun `cache namespaces isolate endpoints and public SDK keys without exposing either`() {
        val publicKey = "sdk_public_project_alpha"
        val first = MosaicConfiguration(publicKey, URI("https://api.example.test"))
        val same = MosaicConfiguration(publicKey, URI("https://api.example.test/"))
        val anotherKey = MosaicConfiguration("sdk_public_project_beta", URI("https://api.example.test"))
        val anotherEndpoint = MosaicConfiguration(publicKey, URI("https://self-hosted.example.test"))

        val namespace = mosaicConfigurationCacheNamespace(first)

        assertEquals(namespace, mosaicConfigurationCacheNamespace(same))
        assertNotEquals(namespace, mosaicConfigurationCacheNamespace(anotherKey))
        assertNotEquals(namespace, mosaicConfigurationCacheNamespace(anotherEndpoint))
        assertTrue(namespace.matches(Regex("^[a-f0-9]{64}$")))
        assertFalse(namespace.contains(publicKey))
        assertFalse(namespace.contains("example.test"))
    }

    @Test
    fun `missing and weak ETags reject otherwise valid remote releases`() = runTest {
        listOf<String?>(null, "W/\"release-2\"").forEach { etag ->
            val diagnostics = mutableListOf<MosaicDiagnostic>()
            val cache = MemoryCache(null)
            val client = MosaicHostedConfigurationClient(
                transport = MosaicConfigurationTransport {
                    MosaicConfigurationResponse.Modified(fixture("placement-binding.json"), etag)
                },
                cache = cache,
                diagnostics = MosaicDiagnosticSink(diagnostics::add),
            )

            val result = client.refresh()

            assertTrue(result is MosaicConfigurationRefreshResult.Unavailable)
            assertEquals(
                MosaicDiagnosticCode.CONFIGURATION_REFRESH_ETAG_REJECTED.wireName,
                (result as MosaicConfigurationRefreshResult.Unavailable).diagnosticCode,
            )
            assertNull(client.acceptedConfiguration)
            assertNull(cache.value)
            assertEquals(MosaicDiagnosticCode.CONFIGURATION_REFRESH_ETAG_REJECTED, diagnostics.single().code)
        }
    }

    @Test
    fun `cache write failure retains the prior release and reports a safe structured diagnostic`() = runTest {
        val original = MosaicCachedConfiguration("\"release-1\"", validRelease())
        val cache = MemoryCache(original, failWrites = true)
        val diagnostics = mutableListOf<MosaicDiagnostic>()
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Modified(fixture("placement-binding.json"), "\"release-2\"")
            },
            cache = cache,
            diagnostics = MosaicDiagnosticSink(diagnostics::add),
        )

        val result = client.refresh()

        assertTrue(result is MosaicConfigurationRefreshResult.Retained)
        result as MosaicConfigurationRefreshResult.Retained
        assertEquals(1L, result.configuration.release.number)
        assertEquals(MosaicConfigurationSource.CACHE, result.configuration.source)
        assertEquals(MosaicDiagnosticCode.CONFIGURATION_CACHE_WRITE_FAILED.wireName, result.diagnosticCode)
        assertEquals(1L, client.acceptedConfiguration?.release?.number)
        assertEquals(original, cache.value)
        assertEquals(MosaicDiagnosticCode.CONFIGURATION_CACHE_WRITE_FAILED, diagnostics.single().code)
        assertFalse(diagnostics.single().message.contains("sdk_public"))
    }

    @Test
    fun `an older remote release cannot replace a newer cached release`() = runTest {
        val cached = MemoryCache(
            MosaicCachedConfiguration("\"release-3\"", fixture("multiple-paywalls.json")),
        )
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Modified(validRelease(), "\"release-1\"")
            },
            cache = cached,
        )

        val result = client.refresh()

        assertTrue(result is MosaicConfigurationRefreshResult.Retained)
        assertEquals(3L, (result as MosaicConfigurationRefreshResult.Retained).configuration.release.number)
        assertEquals("\"release-3\"", cached.value?.etag)
    }

    @Test
    fun `uses bundled fallback only when remote and cache are unavailable`() = runTest {
        val release = MosaicConfigurationDeliveryDecoder.decode(validRelease())
        val fallbackJson = release.paywall("onboarding_complete")!!.document.let {
            JsonParser.parseString(validRelease()).asJsonObject
                .getAsJsonObject("release")
                .getAsJsonArray("paywallVersions")[0].asJsonObject
                .get("document").toString()
        }
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport { MosaicConfigurationResponse.Failed("offline") },
            cache = MemoryCache(null),
            bundledFallback = MosaicPaywallDocumentSource { fallbackJson },
        )

        val result = client.paywall("onboarding_complete")

        assertTrue(result is MosaicPlacementResult.Available)
        assertEquals(
            MosaicConfigurationSource.BUNDLED_FALLBACK,
            (result as MosaicPlacementResult.Available).source,
        )
    }

    private fun validRelease(): String {
        return fixture("valid-release.json")
    }

    private fun fixture(name: String): String {
        val root = System.getProperty("mosaic.repositoryRoot")
        return File(root, "protocol/fixtures/configuration-delivery/v1/$name").readText()
    }

    private class MemoryCache(
        var value: MosaicCachedConfiguration?,
        private val failWrites: Boolean = false,
    ) : MosaicConfigurationCache {
        override suspend fun read(): MosaicCachedConfiguration? = value
        override suspend fun write(value: MosaicCachedConfiguration) {
            if (failWrites) throw IOException("simulated cache write failure")
            this.value = value
        }
    }
}
