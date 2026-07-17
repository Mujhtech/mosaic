package dev.mosaic.sdk

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Rule
import org.junit.Test

class LocalPreviewComposeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun statusPanelShowsConnectionRevisionRtlScaleCommerceAndRecoveryState() {
        val document = canonicalInstrumentedDocument()
        var state by mutableStateOf(
            MosaicLocalPreviewState(
                connectionStatus = MosaicPreviewConnectionStatus.Connected,
                render = MosaicPreviewRenderState(
                    document = document,
                    editableDocumentId = "document_phase2_demo",
                    revision = MosaicLocalRevision("revision_000042", 42),
                    locale = "ar",
                    textScale = 2f,
                    isBundledFallback = false,
                ),
                commerceRevision = MosaicLocalRevision("revision_commerce_000003", 3),
                commerce = MosaicPreviewMockCommerceState(
                    products = emptyList(),
                    purchaseOutcome = MosaicPreviewPurchaseOutcome.ALREADY_ENTITLED,
                    restoreOutcome = MosaicPreviewRestoreOutcome.ALREADY_ENTITLED,
                    entitlement = MosaicPreviewMockEntitlement.Active("yearly-plan"),
                ),
                diagnostic = MosaicPreviewClientDiagnostic(
                    code = "compatibility.unsupportedComponent",
                    message = "Remove the unsupported block.",
                    kind = MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT,
                    componentId = "custom-block",
                ),
            ),
        )
        compose.setContent {
            MaterialTheme { MosaicLocalPreviewStatusPanel(state) }
        }

        compose.onNodeWithTag("mosaic-preview-connection-status")
            .assertTextContains("Connected", substring = true)
        compose.onNodeWithTag("mosaic-preview-revision-status")
            .assertTextContains("Live revision 42", substring = true)
        compose.onNodeWithTag("mosaic-preview-context-status")
            .assertTextContains("ar · RTL · text scale 2.0×", substring = true)
        compose.onNodeWithTag("mosaic-preview-commerce-status")
            .assertTextContains("alreadyEntitled · entitlement active: yearly-plan", substring = true)
        compose.onNodeWithTag("mosaic-preview-diagnostic-status")
            .assertTextContains("Unsupported component", substring = true)

        compose.runOnIdle {
            state = state.copy(
                connectionStatus = MosaicPreviewConnectionStatus.Reconnecting(3, 1_000),
                diagnostic = MosaicPreviewClientDiagnostic(
                    code = "validation.invalidDocument",
                    message = "Fix the highlighted property.",
                    kind = MosaicPreviewProblemKind.INVALID_DOCUMENT,
                    property = "productReferenceIds",
                ),
            )
        }
        compose.onNodeWithTag("mosaic-preview-connection-status")
            .assertTextContains("Reconnecting (attempt 3)", substring = true)
        compose.onNodeWithTag("mosaic-preview-diagnostic-status")
            .assertTextContains("Invalid document", substring = true)

        compose.runOnIdle {
            state = state.copy(connectionStatus = MosaicPreviewConnectionStatus.Disconnected)
        }
        compose.onNodeWithTag("mosaic-preview-connection-status")
            .assertTextContains("Disconnected", substring = true)
    }

    private fun canonicalInstrumentedDocument(): MosaicPaywallDocument {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val source = context.assets.open(MosaicCanonicalBundleSource.ASSET_NAME)
            .bufferedReader(Charsets.UTF_8)
            .use { it.readText() }
        return MosaicProtocolDecoder.decode(source)
    }
}
