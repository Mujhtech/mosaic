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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.mosaic.sdk.MosaicAndroidPreviewIdentity
import dev.mosaic.sdk.MosaicBundledImageResolver
import dev.mosaic.sdk.MosaicBundledVideoResolver
import dev.mosaic.sdk.MosaicLocalPreviewClient
import dev.mosaic.sdk.MosaicLocalPreviewConfiguration
import dev.mosaic.sdk.MosaicLocalPreviewScreen
import dev.mosaic.sdk.MosaicPaywallLoadResult

class MainActivity : ComponentActivity() {
    private lateinit var previewClient: MosaicLocalPreviewClient

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
        previewClient = MosaicLocalPreviewClient(
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
                            client = previewClient,
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
        previewClient.close()
        super.onDestroy()
    }

    companion object {
        const val PREVIEW_ENDPOINT_EXTRA = "mosaic.preview.endpoint"
        const val PREVIEW_SESSION_EXTRA = "mosaic.preview.session"
    }
}
