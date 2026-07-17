package dev.mosaic.sdk

import java.net.URI

const val MOSAIC_LOCAL_PREVIEW_VERSION: String = "0.1"
const val MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL: String = "mosaic.local-preview.v0.1"
const val MOSAIC_LOCAL_PREVIEW_MAX_FRAME_BYTES: Int = 2 * 1024 * 1024
const val MOSAIC_LOCAL_PREVIEW_DEFAULT_MAX_DOCUMENT_BYTES: Int = 1024 * 1024
const val MOSAIC_LOCAL_PREVIEW_HEARTBEAT_MILLIS: Long = 5_000
const val MOSAIC_LOCAL_PREVIEW_TIMEOUT_MILLIS: Long = 15_000

data class MosaicLocalPreviewConfiguration(
    val endpoint: String = ANDROID_EMULATOR_ENDPOINT,
    val sessionId: String = DEFAULT_SESSION_ID,
    val client: MosaicPreviewClientIdentity,
    val maxDocumentBytes: Int = MOSAIC_LOCAL_PREVIEW_DEFAULT_MAX_DOCUMENT_BYTES,
) {
    init {
        requireLocalEndpoint(endpoint)
        require(sessionId.length in 9..100 && sessionId.matches(SESSION_ID_PATTERN)) {
            "Invalid local preview session ID."
        }
        require(client.clientId.length in 8..100 && client.clientId.matches(CLIENT_ID_PATTERN)) {
            "Invalid local preview client ID."
        }
        requireSafeDisplayName(client.displayName, "client display name")
        requireMachineIdentifier(client.renderer.id, "renderer ID")
        require(client.renderer.version.length in 1..64 && client.renderer.version.matches(VERSION_PATTERN)) {
            "Invalid local preview renderer version."
        }
        requireMachineIdentifier(client.application.id, "application ID")
        requireSafeDisplayName(client.application.displayName, "application display name")
        requireSingleLine(client.application.version, 64, "application version")
        requireSafeDisplayName(client.device.displayName, "device display name")
        requireSafeDisplayName(client.device.systemName, "device system name")
        requireSingleLine(client.device.systemVersion, 64, "device system version")
        require(maxDocumentBytes in 65_536..MOSAIC_LOCAL_PREVIEW_MAX_FRAME_BYTES) {
            "maxDocumentBytes must be between 64 KiB and 2 MiB."
        }
    }

    companion object {
        const val HOST_RELAY_ENDPOINT: String = "ws://127.0.0.1:4317/preview"
        const val ANDROID_EMULATOR_ENDPOINT: String = "ws://10.0.2.2:4317/preview"
        const val DEFAULT_SESSION_ID: String = "session_local_01"
        internal val SESSION_ID_PATTERN = Regex("^session_[A-Za-z0-9][A-Za-z0-9_-]*$")
        private val CLIENT_ID_PATTERN = Regex("^client_[A-Za-z0-9][A-Za-z0-9_-]*$")
        private val MACHINE_IDENTIFIER_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
        private val VERSION_PATTERN =
            Regex("^[0-9]+\\.[0-9]+(?:\\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$")

        private fun requireLocalEndpoint(value: String) {
            val uri = runCatching { URI(value) }.getOrNull()
            require(
                uri != null &&
                    uri.isAbsolute &&
                    uri.scheme in setOf("ws", "wss") &&
                    uri.host != null &&
                    uri.userInfo == null &&
                    uri.rawQuery == null &&
                    uri.rawFragment == null &&
                    isLocalHost(uri.host),
            ) {
                "The local preview endpoint must be a credential-free local ws:// or wss:// URL."
            }
        }

        private fun isLocalHost(rawHost: String): Boolean {
            val host = rawHost.removePrefix("[").removeSuffix("]").lowercase()
            if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
                return true
            }
            val octets = host.split('.').mapNotNull(String::toIntOrNull)
            if (octets.size == 4 && octets.all { it in 0..255 }) {
                return octets[0] == 127 ||
                    octets[0] == 10 ||
                    (octets[0] == 172 && octets[1] in 16..31) ||
                    (octets[0] == 192 && octets[1] == 168) ||
                    (octets[0] == 169 && octets[1] == 254)
            }
            return ':' in host && (
                host == "::1" ||
                    host.startsWith("fc") ||
                    host.startsWith("fd") ||
                    host.startsWith("fe8") ||
                    host.startsWith("fe9") ||
                    host.startsWith("fea") ||
                    host.startsWith("feb")
                )
        }

        private fun requireSafeDisplayName(value: String, label: String) {
            requireSingleLine(value, 80, label)
        }

        private fun requireMachineIdentifier(value: String, label: String) {
            require(value.length in 1..128 && value.matches(MACHINE_IDENTIFIER_PATTERN)) {
                "Invalid local preview $label."
            }
        }

        private fun requireSingleLine(value: String, maximum: Int, label: String) {
            require(value.isNotEmpty() && value.length <= maximum && '\r' !in value && '\n' !in value) {
                "Invalid local preview $label."
            }
        }
    }
}

data class MosaicPreviewSoftwareIdentity(
    val id: String,
    val version: String,
)

data class MosaicPreviewApplicationIdentity(
    val id: String,
    val displayName: String,
    val version: String,
)

data class MosaicPreviewDeviceIdentity(
    val displayName: String,
    val systemName: String,
    val systemVersion: String,
)

data class MosaicPreviewClientIdentity(
    val clientId: String,
    val displayName: String,
    val renderer: MosaicPreviewSoftwareIdentity,
    val application: MosaicPreviewApplicationIdentity,
    val device: MosaicPreviewDeviceIdentity,
)

enum class MosaicPreviewCapabilityName(val wireName: String) {
    LIVE_UPDATE("preview.liveUpdate"),
    MOCK_COMMERCE("preview.mockCommerce"),
    LOCALE_OVERRIDE("preview.localeOverride"),
    TEXT_SCALE("preview.textScale"),
    DIAGNOSTICS("preview.diagnostics"),
}

data class MosaicPreviewCapability(
    val name: MosaicPreviewCapabilityName,
    val version: String = MOSAIC_LOCAL_PREVIEW_VERSION,
)

data class MosaicPreviewSupportedCapability(
    val name: String,
    val version: String,
)

data class MosaicPreviewLimits(val maxDocumentBytes: Int)

data class MosaicLocalRevision(
    val revisionId: String,
    val sequence: Int,
)

data class MosaicPreviewContext(
    val locale: String,
    val textScale: Float,
)

enum class MosaicPreviewMessageType(val wireName: String) {
    CLIENT_CONNECTED("previewClientConnected"),
    CLIENT_DISCONNECTED("previewClientDisconnected"),
    CAPABILITY_REPORT("capabilityReport"),
    DRAFT_UPDATED("draftUpdated"),
    DRAFT_ACCEPTED("draftAccepted"),
    DRAFT_REJECTED("draftRejected"),
    VALIDATION_ERROR("validationError"),
    RENDER_WARNING("renderWarning"),
    RENDER_FAILURE("renderFailure"),
    MOCK_COMMERCE_STATE_CHANGED("mockCommerceStateChanged"),
    HEARTBEAT("previewHeartbeat"),
    ;

    companion object {
        fun fromWireName(value: String): MosaicPreviewMessageType? = entries.firstOrNull {
            it.wireName == value
        }
    }
}

data class MosaicPreviewMessage(
    val messageId: String,
    val sessionId: String,
    val sentAt: String,
    val payload: MosaicPreviewPayload,
    val previewProtocolVersion: String = MOSAIC_LOCAL_PREVIEW_VERSION,
) {
    val type: MosaicPreviewMessageType
        get() = payload.type
}

sealed interface MosaicPreviewPayload {
    val type: MosaicPreviewMessageType
}

data class MosaicPreviewClientConnectedPayload(
    val client: MosaicPreviewClientIdentity,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.CLIENT_CONNECTED
}

enum class MosaicPreviewDisconnectReason(val wireName: String) {
    CLOSED("closed"),
    TIMEOUT("timeout"),
    TRANSPORT_ERROR("transportError"),
    REPLACED("replaced"),
    SESSION_ENDED("sessionEnded"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

data class MosaicPreviewClientDisconnectedPayload(
    val clientId: String,
    val reason: MosaicPreviewDisconnectReason,
    val diagnostic: String? = null,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.CLIENT_DISCONNECTED
}

data class MosaicPreviewCapabilityReportPayload(
    val clientId: String,
    val supportedSchemaVersions: List<String>,
    val supportedCapabilities: List<MosaicPreviewSupportedCapability>,
    val previewCapabilities: List<MosaicPreviewCapability>,
    val limits: MosaicPreviewLimits,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.CAPABILITY_REPORT
}

/** The raw document remains an unchanged Protocol 0.1 object until the canonical decoder accepts it. */
data class MosaicPreviewDraftUpdatedPayload(
    val editableDocumentId: String,
    val revision: MosaicLocalRevision,
    val documentJson: String,
    val preview: MosaicPreviewContext,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.DRAFT_UPDATED
}

data class MosaicPreviewDraftAcceptedPayload(
    val clientId: String,
    val editableDocumentId: String,
    val revision: MosaicLocalRevision,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.DRAFT_ACCEPTED
}

enum class MosaicPreviewDraftRejectionReason(val wireName: String) {
    STALE_REVISION("staleRevision"),
    REVISION_CONFLICT("revisionConflict"),
    VALIDATION_FAILED("validationFailed"),
    UNSUPPORTED_SCHEMA_VERSION("unsupportedSchemaVersion"),
    UNSUPPORTED_CAPABILITY("unsupportedCapability"),
    DOCUMENT_TOO_LARGE("documentTooLarge"),
    RENDER_FAILED("renderFailed"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

enum class MosaicPreviewRecoveryActionName(val wireName: String) {
    EDIT_PROPERTY("editProperty"),
    REMOVE_COMPONENT("removeComponent"),
    BIND_PRODUCT("bindProduct"),
    SELECT_SUPPORTED_TEMPLATE("selectSupportedTemplate"),
    UPDATE_PREVIEW_CLIENT("updatePreviewClient"),
    RESTORE_LAST_VALID_DRAFT("restoreLastValidDraft"),
    RETRY("retry"),
    RECONNECT("reconnect"),
    INSPECT_COMPONENT("inspectComponent"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

data class MosaicPreviewRecoveryAction(
    val action: MosaicPreviewRecoveryActionName,
    val message: String,
)

data class MosaicPreviewDiagnosticLocation(
    val documentPath: String,
    val componentId: String? = null,
    val property: String? = null,
)

data class MosaicPreviewValidationDiagnostic(
    val code: String,
    val message: String,
    val location: MosaicPreviewDiagnosticLocation,
    val recovery: MosaicPreviewRecoveryAction,
)

enum class MosaicPreviewWarningSeverity(val wireName: String) {
    WARNING("warning"),
    BLOCKING("blocking"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

enum class MosaicPreviewFallback(val wireName: String) {
    KEEP_LAST_ACCEPTED_DRAFT("keepLastAcceptedDraft"),
    USE_DECLARED_ASSET_FALLBACK("useDeclaredAssetFallback"),
    USE_SELECTOR_FALLBACK("useSelectorFallback"),
    NATIVE_APPROXIMATION("nativeApproximation"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

data class MosaicPreviewCompatibilityWarning(
    val code: String,
    val severity: MosaicPreviewWarningSeverity,
    val message: String,
    val fallback: MosaicPreviewFallback,
    val recovery: MosaicPreviewRecoveryAction,
    val location: MosaicPreviewDiagnosticLocation? = null,
    val capability: MosaicPreviewSupportedCapability? = null,
)

data class MosaicPreviewRenderDiagnostic(
    val code: String,
    val message: String,
    val fallback: MosaicPreviewFallback,
    val recovery: MosaicPreviewRecoveryAction,
    val location: MosaicPreviewDiagnosticLocation? = null,
)

data class MosaicPreviewDraftRejectedPayload(
    val clientId: String,
    val editableDocumentId: String,
    val revision: MosaicLocalRevision,
    val reason: MosaicPreviewDraftRejectionReason,
    val diagnostics: List<MosaicPreviewValidationDiagnostic>,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.DRAFT_REJECTED
}

data class MosaicPreviewValidationErrorPayload(
    val clientId: String,
    val editableDocumentId: String,
    val revision: MosaicLocalRevision,
    val errors: List<MosaicPreviewValidationDiagnostic>,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.VALIDATION_ERROR
}

data class MosaicPreviewRenderWarningPayload(
    val clientId: String,
    val editableDocumentId: String,
    val revision: MosaicLocalRevision,
    val warnings: List<MosaicPreviewCompatibilityWarning>,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.RENDER_WARNING
}

data class MosaicPreviewRenderFailurePayload(
    val clientId: String,
    val editableDocumentId: String,
    val revision: MosaicLocalRevision,
    val failure: MosaicPreviewRenderDiagnostic,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.RENDER_FAILURE
}

enum class MosaicPreviewPeriodUnit(val wireName: String) {
    DAY("day"),
    WEEK("week"),
    MONTH("month"),
    YEAR("year"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

data class MosaicPreviewPeriod(val unit: MosaicPreviewPeriodUnit, val value: Int) {
    fun displayValue(): String = "${value} ${unit.wireName}${if (value == 1) "" else "s"}"
}

data class MosaicPreviewIntroductoryOffer(
    val localizedPrice: String,
    val period: MosaicPreviewPeriod,
    val cycles: Int,
)

sealed interface MosaicPreviewMockProduct {
    val productReferenceId: String

    data class AvailableSubscription(
        override val productReferenceId: String,
        val localizedPrice: String,
        val currencyCode: String,
        val billingPeriod: MosaicPreviewPeriod,
        val trialPeriod: MosaicPreviewPeriod? = null,
        val introductoryOffer: MosaicPreviewIntroductoryOffer? = null,
    ) : MosaicPreviewMockProduct

    data class AvailableNonConsumable(
        override val productReferenceId: String,
        val localizedPrice: String,
        val currencyCode: String,
    ) : MosaicPreviewMockProduct

    data class Unavailable(
        override val productReferenceId: String,
        val reason: Reason,
    ) : MosaicPreviewMockProduct {
        enum class Reason(val wireName: String) {
            NOT_CONFIGURED("notConfigured"),
            TEMPORARILY_UNAVAILABLE("temporarilyUnavailable"),
            UNSUPPORTED("unsupported"),
            ;

            companion object {
                fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
            }
        }
    }
}

enum class MosaicPreviewPurchaseOutcome(val wireName: String) {
    PURCHASED("purchased"),
    ALREADY_ENTITLED("alreadyEntitled"),
    CANCELLED("cancelled"),
    PURCHASE_FAILED("purchaseFailed"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

enum class MosaicPreviewRestoreOutcome(val wireName: String) {
    RESTORED("restored"),
    ALREADY_ENTITLED("alreadyEntitled"),
    RESTORE_NO_PURCHASES("restoreNoPurchases"),
    RESTORE_FAILED("restoreFailed"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

sealed interface MosaicPreviewMockEntitlement {
    data object None : MosaicPreviewMockEntitlement
    data class Active(val productReferenceId: String) : MosaicPreviewMockEntitlement
}

data class MosaicPreviewMockCommerceState(
    val products: List<MosaicPreviewMockProduct>,
    val purchaseOutcome: MosaicPreviewPurchaseOutcome,
    val restoreOutcome: MosaicPreviewRestoreOutcome,
    val entitlement: MosaicPreviewMockEntitlement,
)

data class MosaicPreviewMockCommerceStateChangedPayload(
    val editableDocumentId: String,
    val stateRevision: MosaicLocalRevision,
    val state: MosaicPreviewMockCommerceState,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.MOCK_COMMERCE_STATE_CHANGED
}

enum class MosaicPreviewHeartbeatKind(val wireName: String) {
    PING("ping"),
    PONG("pong"),
    ;

    companion object {
        fun fromWireName(value: String) = entries.firstOrNull { it.wireName == value }
    }
}

data class MosaicPreviewHeartbeatPayload(
    val clientId: String,
    val kind: MosaicPreviewHeartbeatKind,
    val sequence: Int,
) : MosaicPreviewPayload {
    override val type = MosaicPreviewMessageType.HEARTBEAT
}

sealed interface MosaicPreviewConnectionStatus {
    data object Disconnected : MosaicPreviewConnectionStatus
    data object Connecting : MosaicPreviewConnectionStatus
    data object Connected : MosaicPreviewConnectionStatus
    data class Reconnecting(val attempt: Int, val delayMillis: Long) : MosaicPreviewConnectionStatus
}

enum class MosaicPreviewProblemKind {
    INVALID_DOCUMENT,
    UNSUPPORTED_COMPONENT,
    RENDER_FAILURE,
    MOCK_COMMERCE,
    CONNECTION,
}

data class MosaicPreviewClientDiagnostic(
    val code: String,
    val message: String,
    val kind: MosaicPreviewProblemKind,
    val componentId: String? = null,
    val property: String? = null,
)

data class MosaicPreviewRenderState(
    val document: MosaicPaywallDocument,
    val editableDocumentId: String? = null,
    val revision: MosaicLocalRevision? = null,
    val locale: String,
    val textScale: Float,
    val isBundledFallback: Boolean,
    val isAwaitingAcknowledgement: Boolean = false,
)

data class MosaicLocalPreviewState(
    val connectionStatus: MosaicPreviewConnectionStatus = MosaicPreviewConnectionStatus.Disconnected,
    val render: MosaicPreviewRenderState? = null,
    val commerceRevision: MosaicLocalRevision? = null,
    val commerce: MosaicPreviewMockCommerceState? = null,
    val diagnostic: MosaicPreviewClientDiagnostic? = null,
    val recentDiagnostics: List<MosaicPreviewClientDiagnostic> = emptyList(),
) {
    val activeEditableDocumentId: String?
        get() = render?.editableDocumentId
}
