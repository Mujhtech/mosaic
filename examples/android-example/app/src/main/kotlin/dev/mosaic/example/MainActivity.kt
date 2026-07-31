package dev.mosaic.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import dev.mosaic.sdk.MosaicAndroidPreviewIdentity
import dev.mosaic.sdk.MosaicBundledImageResolver
import dev.mosaic.sdk.MosaicBundledVideoResolver
import dev.mosaic.sdk.MosaicLocalPreviewClient
import dev.mosaic.sdk.MosaicLocalPreviewConfiguration
import dev.mosaic.sdk.MosaicLocalPreviewScreen
import dev.mosaic.sdk.MosaicConfiguredPurchaseProvider
import dev.mosaic.sdk.MockMosaicPurchaseProvider
import dev.mosaic.sdk.Mosaic
import dev.mosaic.sdk.MosaicPaywallLoadResult
import dev.mosaic.sdk.MosaicPaywall
import dev.mosaic.sdk.MosaicPlacementResult
import dev.mosaic.sdk.MosaicPurchaseProvider
import dev.mosaic.sdk.revenuecat.MosaicRevenueCatAdapter
import java.net.URI

class MainActivity : ComponentActivity() {
    private var previewClient: MosaicLocalPreviewClient? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val requestedEndpoint = intent.getStringExtra(PREVIEW_ENDPOINT_EXTRA)
        val endpoint = requestedEndpoint?.takeIf {
            it.startsWith("ws://") || it.startsWith("wss://")
        } ?: MosaicLocalPreviewConfiguration.ANDROID_EMULATOR_ENDPOINT
        val requestedSession = intent.getStringExtra(PREVIEW_SESSION_EXTRA)
        val session = requestedSession?.takeIf {
            it.length in 9..100 && it.startsWith("session_")
        } ?: MosaicLocalPreviewConfiguration.DEFAULT_SESSION_ID
        val sdkKey = intent.getStringExtra(SDK_KEY_EXTRA)?.takeIf(String::isNotBlank)
        if (sdkKey != null) {
            showHostedPaywall(sdkKey)
            return
        }
        val client = MosaicLocalPreviewClient(
            configuration = MosaicLocalPreviewConfiguration(
                endpoint = endpoint,
                sessionId = session,
                client = MosaicAndroidPreviewIdentity.create(
                    context = applicationContext,
                    clientId = "client_android_example",
                    displayName = "Android example preview",
                ),
            ),
            fallback = MosaicPaywallLoadResult.ConfigurationUnavailable(),
        )
        previewClient = client

        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = Color(0xFF007F73),
                    surface = Color.White,
                    background = Color.White,
                ),
            ) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    var hostStatus by remember {
                        mutableStateOf("Waiting for Studio.")
                    }
                    Column(modifier = Modifier.fillMaxSize()) {
                        Text(
                            hostStatus,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                        MosaicLocalPreviewScreen(
                            client = client,
                            imageResolver = MosaicBundledImageResolver.None,
                            videoResolver = MosaicBundledVideoResolver.None,
                            onInteraction = { hostStatus = "Interaction: ${it.wireName}" },
                            onResult = { hostStatus = "Presentation result: ${it.wireName}" },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        previewClient?.close()
        super.onDestroy()
    }

    private fun showHostedPaywall(sdkKey: String) {
        val endpoint = intent.getStringExtra(SDK_ENDPOINT_EXTRA)?.let(URI::create)
        val applicationId = intent.getStringExtra(APPLICATION_ID_EXTRA)?.takeIf(String::isNotBlank)
        val purchaseProvider = configuredHostedProvider()
        val mosaic = Mosaic.configure(
            sdkKey,
            purchaseProvider,
            endpoint,
            applicationId = applicationId,
        )
        val hosted = mosaic.hostedConfiguration(applicationContext)
        val placement = intent.getStringExtra(PLACEMENT_EXTRA)?.takeIf(String::isNotBlank)
            ?: "onboarding_complete"
        setContent {
            MaterialTheme {
                var result by remember { mutableStateOf<MosaicPlacementResult?>(null) }
                LaunchedEffect(hosted, placement) {
                    hosted.refresh()
                    result = hosted.paywall(placement)
                }
                when (val current = result) {
                    is MosaicPlacementResult.Available -> MosaicPaywall(
                        document = current.document,
                        purchaseProvider = purchaseProvider,
                        onResult = {},
                        modifier = Modifier.fillMaxSize(),
                    )
                    is MosaicPlacementResult.PlacementUnavailable -> Text("Placement unavailable: ${current.key}")
                    MosaicPlacementResult.ConfigurationUnavailable -> Text("Configuration unavailable")
                    null -> Text("Loading hosted configuration…")
                }
            }
        }
    }

    private fun configuredHostedProvider(): MosaicPurchaseProvider {
        val revenueCatPublicKey =
            intent.getStringExtra(REVENUECAT_PUBLIC_KEY_EXTRA)?.takeIf(String::isNotBlank)
                ?: return MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products())
        Purchases.configure(
            PurchasesConfiguration.Builder(applicationContext, revenueCatPublicKey).build(),
        )
        return MosaicConfiguredPurchaseProvider(
            MosaicRevenueCatAdapter(Purchases.sharedInstance) { this },
        )
    }

    companion object {
        const val PREVIEW_ENDPOINT_EXTRA = "mosaic.preview.endpoint"
        const val PREVIEW_SESSION_EXTRA = "mosaic.preview.session"
        const val SDK_KEY_EXTRA = "mosaic.sdk.key"
        const val SDK_ENDPOINT_EXTRA = "mosaic.sdk.endpoint"
        const val PLACEMENT_EXTRA = "mosaic.placement"
        const val APPLICATION_ID_EXTRA = "mosaic.application.id"
        const val REVENUECAT_PUBLIC_KEY_EXTRA = "revenuecat.public.sdk.key"
    }
}
