package dev.mosaic.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.mosaic.sdk.MockMosaicPurchaseProvider
import dev.mosaic.sdk.MosaicBundledImageResolver
import dev.mosaic.sdk.MosaicCanonicalBundleSource
import dev.mosaic.sdk.MosaicLocalPaywallLoader
import dev.mosaic.sdk.MosaicMockPurchaseScenario
import dev.mosaic.sdk.MosaicMockRestoreScenario
import dev.mosaic.sdk.MosaicPaywall
import dev.mosaic.sdk.MosaicPaywallLoadResult

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loadResult = MosaicLocalPaywallLoader(
            MosaicCanonicalBundleSource(applicationContext),
        ).load(primaryDocumentJson = null)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ExampleScreen(loadResult)
                }
            }
        }
    }
}

private enum class ExampleScenario(
    val title: String,
    val purchase: MosaicMockPurchaseScenario = MosaicMockPurchaseScenario.SUCCESS,
    val restore: MosaicMockRestoreScenario = MosaicMockRestoreScenario.AUTOMATIC,
    val productsAvailable: Boolean = true,
) {
    PURCHASE_SUCCESS("Purchase succeeds"),
    PURCHASE_CANCELLED("Purchase cancels", purchase = MosaicMockPurchaseScenario.CANCELLED),
    PURCHASE_FAILURE("Purchase fails", purchase = MosaicMockPurchaseScenario.FAILURE),
    PRODUCT_UNAVAILABLE("No products", productsAvailable = false),
    ALREADY_ENTITLED("Already entitled", purchase = MosaicMockPurchaseScenario.ALREADY_ENTITLED),
    RESTORE_SUCCESS("Restore succeeds", restore = MosaicMockRestoreScenario.RESTORED),
    RESTORE_EMPTY("Restore empty", restore = MosaicMockRestoreScenario.NOTHING_TO_RESTORE),
    RESTORE_FAILURE("Restore fails", restore = MosaicMockRestoreScenario.FAILURE),
}

private data class ExampleLocale(val title: String, val tag: String)

@Composable
private fun ExampleScreen(loadResult: MosaicPaywallLoadResult) {
    val locales = remember {
        listOf(
            ExampleLocale("English", "en"),
            ExampleLocale("Long German", "de-DE"),
            ExampleLocale("Arabic RTL", "ar"),
        )
    }
    var scenario by remember { mutableStateOf(ExampleScenario.PURCHASE_SUCCESS) }
    var locale by remember { mutableStateOf(locales.first()) }
    var status by remember {
        mutableStateOf("Ready. The host keeps the screen open after callbacks.")
    }
    val provider = remember(scenario) {
        MockMosaicPurchaseProvider(
            products = if (scenario.productsAvailable) {
                MockMosaicPurchaseProvider.phase1Products()
            } else {
                emptyList()
            },
            purchaseScenario = scenario.purchase,
            restoreScenario = scenario.restore,
        )
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Mock scenario", style = MaterialTheme.typography.labelLarge)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ExampleScenario.entries.forEach { option ->
                    FilterChip(
                        selected = scenario == option,
                        onClick = {
                            scenario = option
                            status = "Scenario: ${option.title}"
                        },
                        label = { Text(option.title) },
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                locales.forEach { option ->
                    FilterChip(
                        selected = locale == option,
                        onClick = { locale = option },
                        label = { Text(option.title) },
                    )
                }
            }
            Text(status, style = MaterialTheme.typography.bodySmall)
            Text(
                "The logical hero key intentionally resolves to the protocol placeholder.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        HorizontalDivider()
        Box(modifier = Modifier.weight(1f)) {
            MosaicPaywall(
                loadResult = loadResult,
                purchaseProvider = provider,
                requestedLocale = locale.tag,
                imageResolver = MosaicBundledImageResolver.None,
                onInteraction = { status = "Interaction: ${it.wireName}" },
                onResult = { status = "Presentation result: ${it.wireName}" },
            )
        }
    }
}
