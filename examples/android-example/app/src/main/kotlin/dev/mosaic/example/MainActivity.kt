package dev.mosaic.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import dev.mosaic.sdk.MosaicPlacementDecisionResult
import dev.mosaic.sdk.MosaicPlacement
import dev.mosaic.sdk.MosaicPurchaseProvider
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptance
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptanceDisposition
import dev.mosaic.sdk.MosaicCustomerAccessToken
import dev.mosaic.sdk.MosaicCustomerAccessTokenProvider
import dev.mosaic.sdk.MosaicCustomerAccessTokenResult
import dev.mosaic.sdk.MosaicCustomerEntitlementSnapshotState
import dev.mosaic.sdk.MosaicCustomerEntitlementState
import dev.mosaic.sdk.MosaicCustomerSyncResult
import kotlinx.coroutines.launch
import dev.mosaic.sdk.googleplay.MosaicGooglePlayAdapter
import dev.mosaic.sdk.revenuecat.MosaicRevenueCatAdapter
import java.net.URI

class MainActivity : ComponentActivity() {
    private var previewClient: MosaicLocalPreviewClient? = null
    private var googlePlayAdapter: MosaicGooglePlayAdapter? = null

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
        googlePlayAdapter?.close()
        super.onDestroy()
    }

    private fun showHostedPaywall(sdkKey: String) {
        val endpoint = intent.getStringExtra(SDK_ENDPOINT_EXTRA)?.let(URI::create)
        val applicationId = intent.getStringExtra(APPLICATION_ID_EXTRA)?.takeIf(String::isNotBlank)
        val purchaseProvider = configuredHostedProvider()
        // Stands in for the application backend Mosaic Billing requires. A real app calls its own
        // authenticated server, which mints the token through Mosaic's trusted API; a public SDK key
        // can never select a Billing Customer, so there is no client-only version of this.
        val customerToken = intent.getStringExtra(CUSTOMER_TOKEN_EXTRA)?.takeIf { it.length >= 16 }
        val customerId = intent.getStringExtra(CUSTOMER_ID_EXTRA)?.takeIf(String::isNotBlank)
        val tokenProvider = customerToken?.let { value ->
            MosaicCustomerAccessTokenProvider { _ ->
                MosaicCustomerAccessTokenResult.Issued(MosaicCustomerAccessToken(value), customerId)
            }
        }
        val mosaic = Mosaic.configure(
            sdkKey,
            purchaseProvider,
            endpoint,
            applicationId = applicationId,
            analyticsCollectionEnabled = intent.getBooleanExtra(ANALYTICS_ENABLED_EXTRA, false),
            // Off by default, exactly as the SDK ships it. The handoff only starts a server-side
            // validation sooner; the example never treats it as proof of anything.
            transactionObservationEnabled =
                intent.getBooleanExtra(TRANSACTION_OBSERVATION_ENABLED_EXTRA, false),
            // Null unless a token was supplied, which leaves authoritative entitlements inert.
            customerAccessTokenProvider = tokenProvider,
        )
        val hosted = mosaic.hostedConfiguration(applicationContext)
        val placement = intent.getStringExtra(PLACEMENT_EXTRA)?.takeIf(String::isNotBlank)
            ?: "onboarding_complete"
        setContent {
            MaterialTheme {
                var analyticsStatus by remember { mutableStateOf("Analytics disabled or waiting.") }
                var observationStatus by remember { mutableStateOf("Transaction observations disabled.") }
                LaunchedEffect(hosted, placement) {
                    hosted.refresh()
                    if (intent.getBooleanExtra(ANALYTICS_FLUSH_EXTRA, false)) hosted.flushAnalytics()
                    val diagnostics = hosted.analyticsDiagnostics()
                    analyticsStatus = "Analytics queue: ${diagnostics.queuedEventCount} events · ${diagnostics.queuedBytes} bytes"
                    val observations = hosted.transactionObservationDiagnostics()
                    // Queued/accepted counts only. "Accepted" means Mosaic queued the observation
                    // for validation; it never means the transaction was validated.
                    observationStatus = "Observation queue: ${observations.queuedCount} queued · " +
                        "${observations.acceptedCount} accepted for validation · " +
                        "${observations.droppedCount} dropped · ${observations.lastSafeCode ?: "no code"}"
                }
                // The authoritative state is observed, not polled: identity changes and background
                // refreshes both move it, and a Compose host should see both without asking.
                val authoritative by hosted.customerEntitlements.collectAsState()
                var restoreStatus by remember { mutableStateOf("") }
                val scope = rememberCoroutineScope()

                Column(Modifier.fillMaxSize()) {
                    Text(analyticsStatus, modifier = Modifier.padding(12.dp))
                    Text(observationStatus, modifier = Modifier.padding(horizontal = 12.dp))
                    Text(
                        describeAuthoritative(authoritative) + restoreStatus,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                    if (tokenProvider != null) {
                        Button(
                            onClick = {
                                scope.launch {
                                    restoreStatus = " · restoring…"
                                    // Two axes, reported separately: what the store did, and what
                                    // Mosaic could conclude from it.
                                    restoreStatus = when (val result = hosted.restoreAndSyncCustomerEntitlements()) {
                                        is MosaicCustomerSyncResult.AuthoritativeEntitlementsUpdated ->
                                            " · restored, snapshot ${result.snapshot.snapshotVersion}"
                                        is MosaicCustomerSyncResult.NativeRecoveryCompleted ->
                                            " · recovered, Mosaic validation pending"
                                        is MosaicCustomerSyncResult.NoAdditionalPurchases ->
                                            " · no additional purchases"
                                        else -> " · restore: ${result.providerOutcome}"
                                    }
                                }
                            },
                            modifier = Modifier.padding(horizontal = 12.dp),
                        ) {
                            Text("Restore and sync")
                        }
                    }
                    MosaicPlacement(
                        client = hosted,
                        placement = placement,
                        purchaseProvider = purchaseProvider,
                        // Country is intentionally omitted unless the host has an explicit trusted value.
                        onDecision = { decision ->
                            when (decision) {
                                is MosaicPlacementDecisionResult.Available -> Unit
                                is MosaicPlacementDecisionResult.NoPaywall -> Unit
                                is MosaicPlacementDecisionResult.PlacementUnavailable -> Unit
                                is MosaicPlacementDecisionResult.EvaluationFailed -> Unit
                                MosaicPlacementDecisionResult.ConfigurationUnavailable -> Unit
                            }
                        },
                        onResult = {},
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }

    private fun configuredHostedProvider(): MosaicPurchaseProvider {
        if (intent.getBooleanExtra(GOOGLE_PLAY_PROVIDER_EXTRA, false)) {
            val adapter = MosaicGooglePlayAdapter.create(
                application,
                MosaicCommerceUpdateAcceptance {
                    // The example's in-process stream is its local delivery boundary.
                    MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
                },
            )
            googlePlayAdapter = adapter
            return MosaicConfiguredPurchaseProvider(adapter)
        }
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
        const val GOOGLE_PLAY_PROVIDER_EXTRA = "mosaic.google.play"
        const val ANALYTICS_ENABLED_EXTRA = "mosaic.analytics.enabled"
        const val ANALYTICS_FLUSH_EXTRA = "mosaic.analytics.flush"
        const val TRANSACTION_OBSERVATION_ENABLED_EXTRA = "mosaic.observations.enabled"
        const val CUSTOMER_TOKEN_EXTRA = "mosaic.customer.token"
        const val CUSTOMER_ID_EXTRA = "mosaic.customer.id"
    }
}

/**
 * Renders the four authoritative states distinctly.
 *
 * `unknown` and `unavailable` are deliberately not shown as "no access": they mean Mosaic could not
 * answer, and an app that renders them as a denial revokes paying customers during an outage.
 */
private fun describeAuthoritative(state: MosaicCustomerEntitlementSnapshotState): String = when (state) {
    MosaicCustomerEntitlementSnapshotState.Loading -> "Authoritative: waiting for Mosaic."
    MosaicCustomerEntitlementSnapshotState.SignedOut ->
        "Authoritative: no customer (pass mosaic.customer.token to enable)."
    is MosaicCustomerEntitlementSnapshotState.Unavailable ->
        "Authoritative: unavailable (${state.reason.wireName}) · " +
            "last known snapshot ${state.lastKnown?.snapshotVersion ?: "none"}"
    is MosaicCustomerEntitlementSnapshotState.Available -> {
        val pro = state.snapshot.entry("pro")?.state
        val access = when (pro) {
            is MosaicCustomerEntitlementState.Active -> if (pro.isStale) "active (stale)" else "active"
            is MosaicCustomerEntitlementState.Inactive -> "inactive"
            is MosaicCustomerEntitlementState.Unknown -> "unknown"
            is MosaicCustomerEntitlementState.Unavailable -> "unavailable"
            null -> "no entry"
        }
        "Authoritative pro: $access · snapshot ${state.snapshot.snapshotVersion} · " +
            "cache ${state.cacheState.wireName}"
    }
}
