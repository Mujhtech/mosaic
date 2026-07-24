package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.net.URI
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CommerceConfigurationTest {
    @Test
    fun `hosted transport sends the frozen sidecar contract`() = runTest {
        val observed = AtomicReference<Request>()
        val httpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                observed.set(chain.request())
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .header("ETag", "\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"")
                    .header("Mosaic-Configuration-Release-Id", "configuration_release_5")
                    .header(
                        "Content-Type",
                        "application/vnd.mosaic.commerce-configuration+json;version=1",
                    )
                    .body("{}".toResponseBody())
                    .build()
            }
            .build()
        val transport = MosaicHTTPCommerceConfigurationTransport(
            MosaicConfiguration(
                apiKey = "sdk_public_android",
                endpoint = URI("https://example.test"),
                applicationId = "application_android",
            ).normalized(),
            httpClient,
        )

        val response = transport.fetch("\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"")

        assertTrue(response is MosaicCommerceConfigurationResponse.Modified)
        val request = observed.get()
        assertEquals(
            "/v1/sdk/commerce-configuration?applicationId=application_android",
            request.url.encodedPath + "?" + request.url.encodedQuery,
        )
        assertEquals(
            "application/vnd.mosaic.commerce-configuration+json;version=2, " +
                "application/vnd.mosaic.commerce-configuration+json;version=1;q=0.9",
            request.header("Accept"),
        )
        assertEquals("2,1", request.header("Mosaic-Commerce-Configuration-Versions"))
        assertEquals("2,1", request.header("Mosaic-Commerce-Provider-Contract-Versions"))
        assertEquals("android", request.header("Mosaic-SDK-Platform"))
        assertEquals(
            "\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"",
            request.header("If-None-Match"),
        )
        assertEquals(
            "configuration_release_5",
            (response as MosaicCommerceConfigurationResponse.Modified).configurationReleaseId,
        )
    }

    @Test
    fun `hosted transport rejects non-exact Commerce Content-Type`() = runTest {
        val contentTypes = listOf(
            "application/json",
            "application/vnd.mosaic.commerce-configuration+json",
            "application/vnd.mosaic.commerce-configuration+json;version=1;charset=utf-8",
        )
        contentTypes.forEach { contentType ->
            val httpClient = OkHttpClient.Builder()
                .addInterceptor { chain ->
                    Response.Builder()
                        .request(chain.request())
                        .protocol(Protocol.HTTP_1_1)
                        .code(200)
                        .message("OK")
                        .header("ETag", "\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"")
                        .header("Mosaic-Configuration-Release-Id", "configuration_release_5")
                        .header("Content-Type", contentType)
                        .body("{}".toResponseBody())
                        .build()
                }
                .build()
            val transport = MosaicHTTPCommerceConfigurationTransport(
                MosaicConfiguration(
                    apiKey = "sdk_public_android",
                    endpoint = URI("https://example.test"),
                    applicationId = "application_android",
                ).normalized(),
                httpClient,
            )

            assertTrue(
                "Expected $contentType to be rejected",
                transport.fetch(null) is MosaicCommerceConfigurationResponse.Failed,
            )
        }
    }

    @Test
    fun `hosted transport preserves exact validation headers on Commerce 304`() = runTest {
        val exactETag =
            "\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\""
        val httpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(304)
                    .message("Not Modified")
                    .header("ETag", exactETag)
                    .header("Mosaic-Configuration-Release-Id", "configuration_release_5")
                    .body("".toResponseBody())
                    .build()
            }
            .build()
        val transport = MosaicHTTPCommerceConfigurationTransport(
            MosaicConfiguration(
                apiKey = "sdk_public_android",
                endpoint = URI("https://example.test"),
                applicationId = "application_android",
            ).normalized(),
            httpClient,
        )

        val response =
            transport.fetch(exactETag) as MosaicCommerceConfigurationResponse.NotModified

        assertEquals(exactETag, response.etag)
        assertEquals("configuration_release_5", response.configurationReleaseId)
    }

    @Test
    fun `decodes the canonical SDK-local snapshot against its exact release scope`() {
        val release = localRelease()

        val configuration = MosaicCommerceConfigurationDecoder.decode(
            fixture("sdk-local-configuration.json"),
            release,
            "application_android",
        )

        assertEquals("acme-commerce", configuration.provider.id)
        assertTrue(configuration.activation is MosaicCommerceProviderActivation.SdkLocal)
        assertEquals(setOf("product_pro_monthly"), configuration.productMappings.keys)
        assertEquals(setOf("pro"), configuration.entitlementMappings.keys)
    }

    @Test
    fun `decodes canonical Google v2 mapping without exposing an offer token`() {
        val release = MosaicConfigurationRelease(
            id = "configuration_release_42",
            number = 42,
            environment = MosaicDeliveryEnvironment("environment_production", "production"),
            publishedAt = "2026-07-24T12:00:00Z",
            contentDigest =
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            placements = emptyMap(),
            paywallVersions = emptyMap(),
            productReferences = listOf(
                MosaicDeliveryProduct("product_pro_monthly", "subscription", "Monthly"),
                MosaicDeliveryProduct(
                    "product_pro_lifetime",
                    "one_time_non_consumable",
                    "Lifetime",
                ),
            ).associateBy { it.id },
            assetReferences = emptyMap(),
            encoded = "{}",
        )

        val configuration = MosaicCommerceConfigurationDecoder.decode(
            repositoryFile(
                "protocol/fixtures/commerce-configuration/v2/google-play-configuration.json",
            ).toFile().readText(),
            release,
            "application_android",
        )

        assertEquals("2", configuration.version)
        assertTrue(configuration.activation is MosaicCommerceProviderActivation.NativeStore)
        assertEquals("activePurchaseRecovery", configuration.recoveryMode)
        val monthly = configuration.productMappings.getValue("product_pro_monthly")
        assertEquals(setOf("pro"), monthly.entitlementKeys)
        assertEquals(
            MosaicCommerceAdapterMapping.GooglePlayProduct("monthly", "intro_7_day"),
            monthly.adapterMapping,
        )
        assertTrue("offer tokens are runtime-only", "offerToken" !in configuration.encoded)
    }

    @Test
    fun `rejects scope mismatch incomplete mappings tampering and credential fields`() {
        val release = localRelease()
        assertThrows(MosaicCommerceConfigurationException::class.java) {
            MosaicCommerceConfigurationDecoder.decode(
                fixture("sdk-local-configuration.json"),
                release,
                "another_application",
            )
        }
        assertThrows(MosaicCommerceConfigurationException::class.java) {
            MosaicCommerceConfigurationDecoder.decode(
                fixture("sdk-local-configuration.json"),
                release.copy(
                    productReferences = release.productReferences +
                        ("product_extra" to MosaicDeliveryProduct(
                            "product_extra",
                            "subscription",
                            "Extra",
                        )),
                ),
                "application_android",
            )
        }

        val tampered = JsonParser.parseString(
            fixture("sdk-local-configuration.json"),
        ).asJsonObject
        tampered.getAsJsonObject("configuration")
            .getAsJsonArray("productMappings")[0].asJsonObject
            .addProperty("providerProductReference", "tampered.product")
        assertThrows(MosaicCommerceConfigurationException::class.java) {
            MosaicCommerceConfigurationDecoder.decode(
                tampered.toString(),
                release,
                "application_android",
            )
        }

        val credential = JsonParser.parseString(
            fixture("sdk-local-configuration.json"),
        ).asJsonObject
        credential.getAsJsonObject("configuration")
            .getAsJsonObject("activeProvider")
            .addProperty("publicSdkKey", "forbidden")
        assertThrows(MosaicCommerceConfigurationException::class.java) {
            MosaicCommerceConfigurationDecoder.decode(
                credential.toString(),
                release,
                "application_android",
            )
        }
    }

    @Test
    fun `diagnostics enforce canonical required and optional value constraints`() {
        val release = localRelease()
        val validDiagnostic = JsonObject().apply {
            addProperty("code", "provider.timeout")
            addProperty("safeMessage", "The provider timed out.")
            addProperty("severity", "warning")
            addProperty("retryable", true)
            addProperty("retryAfterSeconds", 30)
            addProperty("correlationId", "commerce_lookup_01")
            addProperty("providerCode", "NETWORK_TIMEOUT")
            addProperty("mosaicProductId", "product_pro_monthly")
            addProperty("recoveryAction", "retry")
        }
        val decoded = MosaicCommerceConfigurationDecoder.decode(
            commerceWithDiagnostic(release, validDiagnostic),
            release,
            "application_android",
        )
        val diagnostic = decoded.diagnostics.single()
        assertEquals(30, diagnostic.retryAfterSeconds)
        assertEquals("NETWORK_TIMEOUT", diagnostic.providerCode)
        assertEquals("product_pro_monthly", diagnostic.mosaicProductId)
        assertEquals("retry", diagnostic.recoveryAction)

        val invalidDiagnostics = listOf(
            validDiagnostic.deepCopy().also { it.remove("correlationId") },
            validDiagnostic.deepCopy().also {
                it.addProperty("code", "provider." + "a".repeat(96))
            },
            validDiagnostic.deepCopy().also { it.addProperty("severity", "critical") },
            validDiagnostic.deepCopy().also { it.addProperty("retryAfterSeconds", 0) },
            validDiagnostic.deepCopy().also { it.addProperty("retryAfterSeconds", 1.5) },
            validDiagnostic.deepCopy().also { it.addProperty("retryAfterSeconds", 86_401) },
            validDiagnostic.deepCopy().also {
                it.addProperty("retryable", false)
            },
            validDiagnostic.deepCopy().also {
                it.addProperty("correlationId", "invalid correlation")
            },
            validDiagnostic.deepCopy().also {
                it.addProperty("providerCode", "unsafe\nprovider")
            },
            validDiagnostic.deepCopy().also {
                it.addProperty("mosaicProductId", "invalid product")
            },
            validDiagnostic.deepCopy().also {
                it.addProperty("recoveryAction", "silentlyIgnore")
            },
        )
        invalidDiagnostics.forEach { invalid ->
            assertThrows(MosaicCommerceConfigurationException::class.java) {
                MosaicCommerceConfigurationDecoder.decode(
                    commerceWithDiagnostic(release, invalid),
                    release,
                    "application_android",
                )
            }
        }
    }

    @Test
    fun `paired cache accepts a valid sidecar and preserves it on failed replacement`() = runTest {
        val releasePayload = deliveryFixture("product-reference.json")
        val release = MosaicConfigurationDeliveryDecoder.decode(releasePayload)
        val commercePayload = commerceForRelease(release)
        val cache = MemoryCache(
            MosaicCachedConfiguration("\"release-5\"", releasePayload),
        )
        val provider = RecordingConfigurableProvider()
        var candidate = MosaicCommerceConfigurationResponse.Modified(
            commercePayload,
            "\"${MosaicCommerceConfigurationDecoder.decode(
                commercePayload,
                release,
                "application_android",
            ).contentDigest}\"",
            release.id,
        )
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Failed("offline")
            },
            commerceTransport = MosaicCommerceConfigurationTransport { candidate },
            cache = cache,
            applicationId = "application_android",
            configurablePurchaseProvider = provider,
        )

        val accepted = client.refreshCommerceConfiguration()
        assertTrue(accepted is MosaicCommerceConfigurationRefreshResult.Updated)
        assertEquals(commercePayload, cache.value?.commercePayload)
        assertEquals(1, provider.accepted)
        val clearsAfterInitialLoad = provider.clearCount

        candidate = MosaicCommerceConfigurationResponse.Modified(
            "{}",
            "\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"",
            release.id,
        )
        val retained = client.refreshCommerceConfiguration()
        assertTrue(retained is MosaicCommerceConfigurationRefreshResult.Retained)
        assertEquals(commercePayload, cache.value?.commercePayload)
        assertEquals(1, provider.accepted)
        assertEquals(clearsAfterInitialLoad, provider.clearCount)
    }

    @Test
    fun `hosted Commerce response requires exact digest ETag and release header`() = runTest {
        val releasePayload = deliveryFixture("product-reference.json")
        val release = MosaicConfigurationDeliveryDecoder.decode(releasePayload)
        val commercePayload = commerceForRelease(release)
        val commerce = MosaicCommerceConfigurationDecoder.decode(
            commercePayload,
            release,
            "application_android",
        )
        val invalidResponses = listOf(
            MosaicCommerceConfigurationResponse.Modified(
                commercePayload,
                null,
                release.id,
            ),
            MosaicCommerceConfigurationResponse.Modified(
                commercePayload,
                "W/\"${commerce.contentDigest}\"",
                release.id,
            ),
            MosaicCommerceConfigurationResponse.Modified(
                commercePayload,
                "\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"",
                release.id,
            ),
            MosaicCommerceConfigurationResponse.Modified(
                commercePayload,
                "\"${commerce.contentDigest}\"",
                null,
            ),
            MosaicCommerceConfigurationResponse.Modified(
                commercePayload,
                "\"${commerce.contentDigest}\"",
                "another_release",
            ),
        )

        invalidResponses.forEach { response ->
            val client = MosaicHostedConfigurationClient(
                transport = MosaicConfigurationTransport {
                    MosaicConfigurationResponse.Failed("offline")
                },
                commerceTransport = MosaicCommerceConfigurationTransport { response },
                cache = MemoryCache(
                    MosaicCachedConfiguration("\"release-5\"", releasePayload),
                ),
                applicationId = "application_android",
            )

            assertTrue(
                client.refreshCommerceConfiguration() is
                    MosaicCommerceConfigurationRefreshResult.Unavailable,
            )
            assertEquals(null, client.acceptedConfiguration?.commerceConfiguration)
        }
    }

    @Test
    fun `Commerce 304 requires a retained release-sidecar pair`() = runTest {
        val releasePayload = deliveryFixture("product-reference.json")
        val release = MosaicConfigurationDeliveryDecoder.decode(releasePayload)
        val commercePayload = commerceForRelease(release)
        val commerce = MosaicCommerceConfigurationDecoder.decode(
            commercePayload,
            release,
            "application_android",
        )
        val exactNotModified = MosaicCommerceConfigurationResponse.NotModified(
            "\"${commerce.contentDigest}\"",
            release.id,
        )
        val withoutSidecar = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Failed("offline")
            },
            commerceTransport = MosaicCommerceConfigurationTransport {
                exactNotModified
            },
            cache = MemoryCache(
                MosaicCachedConfiguration("\"release-5\"", releasePayload),
            ),
            applicationId = "application_android",
        )
        val paired = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Failed("offline")
            },
            commerceTransport = MosaicCommerceConfigurationTransport {
                exactNotModified
            },
            cache = MemoryCache(
                MosaicCachedConfiguration(
                    "\"release-5\"",
                    releasePayload,
                    commercePayload,
                ),
            ),
            applicationId = "application_android",
        )

        assertTrue(
            withoutSidecar.refreshCommerceConfiguration() is
                MosaicCommerceConfigurationRefreshResult.Unavailable,
        )
        assertTrue(
            paired.refreshCommerceConfiguration() is
                MosaicCommerceConfigurationRefreshResult.NotModified,
        )
    }

    @Test
    fun `Commerce 304 rejects missing malformed or mismatched retained headers`() = runTest {
        val releasePayload = deliveryFixture("product-reference.json")
        val release = MosaicConfigurationDeliveryDecoder.decode(releasePayload)
        val commercePayload = commerceForRelease(release)
        val commerce = MosaicCommerceConfigurationDecoder.decode(
            commercePayload,
            release,
            "application_android",
        )
        val invalidResponses = listOf(
            MosaicCommerceConfigurationResponse.NotModified(null, release.id),
            MosaicCommerceConfigurationResponse.NotModified(
                "W/\"${commerce.contentDigest}\"",
                release.id,
            ),
            MosaicCommerceConfigurationResponse.NotModified(
                "\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"",
                release.id,
            ),
            MosaicCommerceConfigurationResponse.NotModified(
                "\"${commerce.contentDigest}\"",
                null,
            ),
            MosaicCommerceConfigurationResponse.NotModified(
                "\"${commerce.contentDigest}\"",
                "another_release",
            ),
        )

        invalidResponses.forEach { response ->
            val client = MosaicHostedConfigurationClient(
                transport = MosaicConfigurationTransport {
                    MosaicConfigurationResponse.Failed("offline")
                },
                commerceTransport = MosaicCommerceConfigurationTransport { response },
                cache = MemoryCache(
                    MosaicCachedConfiguration(
                        "\"release-5\"",
                        releasePayload,
                        commercePayload,
                    ),
                ),
                applicationId = "application_android",
            )

            val result = client.refreshCommerceConfiguration()

            assertTrue(result is MosaicCommerceConfigurationRefreshResult.Retained)
            assertEquals(
                commerce.contentDigest,
                client.acceptedConfiguration?.commerceConfiguration?.contentDigest,
            )
        }
    }

    @Test
    fun `configured provider rejects mismatched adapter identity version and capabilities`() =
        runTest {
            val release = localRelease()
            val configuration = MosaicCommerceConfigurationDecoder.decode(
                commerceForRelease(release),
                release,
                "application_android",
            )
            val mismatchedAdapters = listOf(
                HandleRecordingAdapter(
                    identity = configuration.provider.copy(id = "another-provider"),
                    capabilities = configuration.capabilities,
                ),
                HandleRecordingAdapter(
                    identity = configuration.provider.copy(adapterVersion = "9.9.9"),
                    capabilities = configuration.capabilities,
                ),
                HandleRecordingAdapter(
                    identity = configuration.provider,
                    capabilities = configuration.capabilities.dropLast(1),
                ),
                HandleRecordingAdapter(
                    identity = configuration.provider,
                    capabilities = configuration.capabilities.map {
                        if (it.name == "productLoading") {
                            it.copy(
                                support = "unsupported",
                                reasonCode = "adapter.notImplemented",
                            )
                        } else {
                            it
                        }
                    },
                ),
                HandleRecordingAdapter(
                    identity = configuration.provider,
                    capabilities = configuration.capabilities.map {
                        if (it.name == "restore") {
                            it.copy(reasonCode = "host.differentRequirement")
                        } else {
                            it
                        }
                    },
                ),
            )

            mismatchedAdapters.forEach { adapter ->
                val provider = MosaicConfiguredPurchaseProvider(adapter)

                provider.accept(configuration)

                assertTrue(
                    provider.loadProducts(configuration.productMappings.keys.toList()) is
                        MosaicProductLoadResult.Unavailable,
                )
                assertEquals(1, adapter.invalidations)
                assertTrue(adapter.loadedMappingIds.isEmpty())
            }
        }

    @Test
    fun `configuration swap invalidates native handles until exact mappings reload`() = runTest {
        val release = localRelease()
        val first = MosaicCommerceConfigurationDecoder.decode(
            commerceForRelease(release, mappingVersion = "first"),
            release,
            "application_android",
        )
        val second = MosaicCommerceConfigurationDecoder.decode(
            commerceForRelease(release, mappingVersion = "second"),
            release,
            "application_android",
        )
        val adapter = HandleRecordingAdapter(
            identity = first.provider,
            capabilities = first.capabilities,
        )
        val provider = MosaicConfiguredPurchaseProvider(adapter)

        provider.accept(first)
        assertTrue(
            provider.loadProducts(listOf("product_pro_monthly")) is
                MosaicProductLoadResult.Loaded,
        )
        assertTrue(
            provider.purchase("product_pro_monthly") is MosaicPurchaseResult.Purchased,
        )

        provider.accept(second)

        assertEquals(2, adapter.invalidations)
        assertTrue(
            provider.purchase("product_pro_monthly") is
                MosaicPurchaseResult.ProductUnavailable,
        )
        assertTrue(
            provider.loadProducts(listOf("product_pro_monthly")) is
                MosaicProductLoadResult.Loaded,
        )
        assertEquals(
            "mapping_product_pro_monthly",
            adapter.loadedMappingIds.single(),
        )
        assertTrue(
            provider.purchase("product_pro_monthly") is MosaicPurchaseResult.Purchased,
        )
    }

    private fun localRelease(): MosaicConfigurationRelease =
        MosaicConfigurationRelease(
            id = "configuration_release_local_7",
            number = 7,
            environment = MosaicDeliveryEnvironment(
                "environment_development",
                "development",
            ),
            publishedAt = "2026-07-23T12:00:00Z",
            contentDigest =
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            placements = emptyMap(),
            paywallVersions = emptyMap(),
            productReferences = mapOf(
                "product_pro_monthly" to MosaicDeliveryProduct(
                    "product_pro_monthly",
                    "subscription",
                    "Pro Monthly",
                ),
            ),
            assetReferences = emptyMap(),
            encoded = "{}",
        )

    private fun commerceForRelease(
        release: MosaicConfigurationRelease,
        mappingVersion: String = "current",
    ): String {
        val root = JsonParser.parseString(
            fixture("sdk-local-configuration.json"),
        ).asJsonObject
        val configuration = root.getAsJsonObject("configuration")
        configuration.addProperty("environmentId", release.environment.id)
        configuration.addProperty("applicationId", "application_android")
        configuration.getAsJsonObject("configurationRelease").apply {
            addProperty("id", release.id)
            addProperty("contentDigest", release.contentDigest)
        }
        configuration.add(
            "productMappings",
            JsonArray().apply {
                release.productReferences.keys.sorted().forEach { productId ->
                    add(
                        JsonObject().apply {
                            addProperty("mosaicProductId", productId)
                            addProperty("mappingId", "mapping_$productId")
                            addProperty(
                                "providerProductReference",
                                "provider.$productId.$mappingVersion",
                            )
                            add(
                                "adapterMapping",
                                JsonObject().apply {
                                    addProperty("kind", "directProduct")
                                },
                            )
                        },
                    )
                }
            },
        )
        val material = configuration.deepCopy().also { it.remove("contentDigest") }
        configuration.addProperty(
            "contentDigest",
            MosaicCommerceConfigurationDecoder.contentDigest(material),
        )
        return root.toString()
    }

    private fun commerceWithDiagnostic(
        release: MosaicConfigurationRelease,
        diagnostic: JsonObject,
    ): String {
        val root = JsonParser.parseString(commerceForRelease(release)).asJsonObject
        val configuration = root.getAsJsonObject("configuration")
        configuration.add(
            "diagnostics",
            JsonArray().apply { add(diagnostic) },
        )
        val material = configuration.deepCopy().also { it.remove("contentDigest") }
        configuration.addProperty(
            "contentDigest",
            MosaicCommerceConfigurationDecoder.contentDigest(material),
        )
        return root.toString()
    }

    private fun fixture(name: String): String =
        File(
            System.getProperty("mosaic.repositoryRoot"),
            "protocol/fixtures/commerce-configuration/v1/$name",
        ).readText()

    private fun deliveryFixture(name: String): String =
        File(
            System.getProperty("mosaic.repositoryRoot"),
            "protocol/fixtures/configuration-delivery/v1/$name",
        ).readText()

    private class MemoryCache(
        var value: MosaicCachedConfiguration?,
    ) : MosaicConfigurationCache {
        override suspend fun read(): MosaicCachedConfiguration? = value

        override suspend fun write(value: MosaicCachedConfiguration) {
            this.value = value
        }
    }

    private class RecordingConfigurableProvider : MosaicConfigurablePurchaseProvider {
        var accepted = 0
        var clearCount = 0

        override fun accept(configuration: MosaicCommerceConfiguration) {
            accepted += 1
        }

        override fun clearConfiguration() {
            clearCount += 1
        }

        override suspend fun loadProducts(productIds: List<String>) =
            MosaicProductLoadResult.Unavailable(productIds)

        override suspend fun purchase(productId: String) =
            MosaicPurchaseResult.ProductUnavailable(productId)

        override suspend fun restore() = MosaicRestoreResult.NothingToRestore

        override suspend fun activeEntitlements() =
            MosaicActiveEntitlementsResult.Available(emptySet())
    }

    private class HandleRecordingAdapter(
        override val identity: MosaicCommerceProviderIdentity,
        override val capabilities: List<MosaicCommerceProviderCapability>,
    ) : MosaicCommerceProviderAdapter {
        override val diagnostics: List<MosaicCommerceSafeDiagnostic> = emptyList()
        var loadedMappingIds: Set<String> = emptySet()
        var invalidations: Int = 0

        override fun invalidateProductHandles() {
            invalidations += 1
        }

        override suspend fun loadProducts(
            mappings: List<MosaicCommerceProductMapping>,
        ): MosaicProductLoadResult {
            loadedMappingIds = mappings.mapTo(mutableSetOf()) { it.mappingId }
            return MosaicProductLoadResult.Loaded(
                mappings.map {
                    MosaicProduct(
                        id = it.mosaicProductId,
                        title = it.mosaicProductId,
                        localizedPrice = "$9.99",
                    )
                },
            )
        }

        override suspend fun purchase(
            mapping: MosaicCommerceProductMapping,
            entitlementMappings: List<MosaicCommerceEntitlementMapping>,
        ): MosaicPurchaseResult = if (mapping.mappingId in loadedMappingIds) {
            MosaicPurchaseResult.Purchased(mapping.mosaicProductId, "transaction")
        } else {
            MosaicPurchaseResult.ProductUnavailable(mapping.mosaicProductId)
        }

        override suspend fun restore(
            entitlementMappings: List<MosaicCommerceEntitlementMapping>,
        ) = MosaicRestoreResult.NothingToRestore

        override suspend fun activeEntitlements(
            entitlementMappings: List<MosaicCommerceEntitlementMapping>,
        ) = MosaicActiveEntitlementsResult.Available(emptySet())
    }
}
