package dev.mosaic.sdk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
fun MosaicLocalPreviewScreen(
    client: MosaicLocalPreviewClient,
    onResult: (MosaicPresentationResult) -> Unit,
    modifier: Modifier = Modifier,
    imageResolver: MosaicBundledImageResolver = MosaicBundledImageResolver.None,
    diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    onInteraction: (MosaicInteractionOutcome) -> Unit = {},
) {
    val state by client.state.collectAsState()
    Column(modifier = modifier.fillMaxSize()) {
        MosaicLocalPreviewStatusPanel(
            state = state,
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
        )
        HorizontalDivider()
        Box(modifier = Modifier.weight(1f)) {
            MosaicLocalPreviewPaywall(
                client = client,
                onResult = onResult,
                imageResolver = imageResolver,
                diagnostics = diagnostics,
                onInteraction = onInteraction,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
fun MosaicLocalPreviewPaywall(
    client: MosaicLocalPreviewClient,
    onResult: (MosaicPresentationResult) -> Unit,
    modifier: Modifier = Modifier,
    imageResolver: MosaicBundledImageResolver = MosaicBundledImageResolver.None,
    diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    onInteraction: (MosaicInteractionOutcome) -> Unit = {},
) {
    DisposableEffect(client) {
        client.start()
        onDispose(client::stop)
    }
    val state by client.state.collectAsState()
    val render = state.render
    if (render == null) {
        LaunchedEffect(Unit) {
            onResult(MosaicPresentationResult.ConfigurationUnavailable("preview.configurationUnavailable"))
        }
        Box(modifier = modifier.testTag("mosaic-preview-configuration-unavailable"))
        return
    }

    val reportingResolver = remember(render.document, imageResolver, client) {
        val assetIdsByKey = render.document.assets.groupBy(MosaicImageAsset::sourceKey)
            .mapValues { (_, assets) -> assets.map(MosaicImageAsset::id).toSet() }
        val componentIdsByAsset = render.document.layout.content.walkDepthFirst()
            .filterIsInstance<MosaicImageComponent>()
            .groupBy(MosaicImageComponent::assetId)
            .mapValues { (_, components) -> components.map(MosaicImageComponent::id) }
        MosaicBundledImageResolver { key ->
            val image = runCatching { imageResolver.resolve(key) }.getOrNull()
            if (image == null) {
                assetIdsByKey[key].orEmpty().flatMap { componentIdsByAsset[it].orEmpty() }
                    .forEach(client::reportAssetFallback)
            }
            image
        }
    }

    LaunchedEffect(render.editableDocumentId, render.revision, render.isAwaitingAcknowledgement) {
        if (render.isAwaitingAcknowledgement) {
            val documentId = render.editableDocumentId
            val revision = render.revision
            if (documentId != null && revision != null) {
                client.confirmDisplayedDraft(documentId, revision)
            }
        }
    }

    key(render.revision?.revisionId, state.commerceRevision?.revisionId) {
        MosaicPaywall(
            document = render.document,
            purchaseProvider = client.purchaseProvider,
            requestedLocale = render.locale,
            previewTextScale = render.textScale,
            imageResolver = reportingResolver,
            diagnostics = diagnostics,
            onInteraction = onInteraction,
            onResult = onResult,
            modifier = modifier,
        )
    }
}

@Composable
fun MosaicLocalPreviewStatusPanel(
    state: MosaicLocalPreviewState,
    modifier: Modifier = Modifier,
) {
    val connection = when (val status = state.connectionStatus) {
        MosaicPreviewConnectionStatus.Connected -> "Connected"
        MosaicPreviewConnectionStatus.Connecting -> "Connecting"
        MosaicPreviewConnectionStatus.Disconnected -> "Disconnected"
        is MosaicPreviewConnectionStatus.Reconnecting ->
            "Reconnecting (attempt ${status.attempt})"
    }
    val render = state.render
    val direction = render?.let {
        when (MosaicLocalizationResolver(it.document.localization, it.locale).direction) {
            MosaicLayoutDirection.LTR -> "LTR"
            MosaicLayoutDirection.RTL -> "RTL"
        }
    }
    val entitlement = when (val active = state.commerce?.entitlement) {
        null -> "not received"
        MosaicPreviewMockEntitlement.None -> "none"
        is MosaicPreviewMockEntitlement.Active -> "active: ${active.productReferenceId}"
    }
    val diagnosticLabel = state.diagnostic?.let { diagnostic ->
        val category = when (diagnostic.kind) {
            MosaicPreviewProblemKind.INVALID_DOCUMENT -> "Invalid document"
            MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT -> "Unsupported component"
            MosaicPreviewProblemKind.RENDER_FAILURE -> "Render failure"
            MosaicPreviewProblemKind.MOCK_COMMERCE -> "Mock commerce issue"
            MosaicPreviewProblemKind.CONNECTION -> "Connection diagnostic"
        }
        "$category: ${diagnostic.message}"
    }

    Card(modifier = modifier.testTag("mosaic-preview-status-panel")) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                "Local preview · $connection",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.testTag("mosaic-preview-connection-status"),
            )
            Text(
                if (render?.revision == null) {
                    "Bundled fallback"
                } else {
                    "Live revision ${render.revision.sequence} · ${render.revision.revisionId}"
                },
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("mosaic-preview-revision-status"),
            )
            if (render != null) {
                Text(
                    "Locale ${render.locale} · $direction · text scale ${render.textScale}×",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("mosaic-preview-context-status"),
                )
            }
            Text(
                "Mock purchase ${state.commerce?.purchaseOutcome?.wireName ?: "not received"} · " +
                    "entitlement $entitlement",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("mosaic-preview-commerce-status"),
            )
            diagnosticLabel?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("mosaic-preview-diagnostic-status"),
                )
            }
        }
    }
}
