package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal

/** Strict JSON reader/writer for exact Local Preview sessions. */
internal val previewMessageIdPattern = Regex("^msg_[A-Za-z0-9][A-Za-z0-9_-]*$")
internal val previewSessionIdPattern = Regex("^session_[A-Za-z0-9][A-Za-z0-9_-]*$")
internal val previewClientIdPattern = Regex("^client_[A-Za-z0-9][A-Za-z0-9_-]*$")
internal val previewDocumentIdPattern = Regex("^document_[A-Za-z0-9][A-Za-z0-9_-]*$")
internal val previewRevisionIdPattern = Regex("^revision_[A-Za-z0-9][A-Za-z0-9_-]*$")
internal val previewMachineIdentifierPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
internal val previewComponentIdPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
internal val previewDiagnosticCodePattern = Regex("^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$")
internal val previewSemanticVersionPattern =
    Regex("^[0-9]+\\.[0-9]+(?:\\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$")
internal val previewLocalePattern = Regex("^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
internal val previewUtcTimestampPattern = Regex(
    "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$",
)
internal val previewJsonPointerPattern = Regex("^(?:/(?:[^~/]|~[01])*)*$")
internal val previewPropertyPattern = Regex("^[A-Za-z][A-Za-z0-9]*$")
internal val previewCurrencyPattern = Regex("^[A-Z]{3}$")


object MosaicLocalPreviewCodec {
    fun decode(
        source: String,
        expectedVersion: String = MOSAIC_LOCAL_PREVIEW_VERSION,
    ): MosaicPreviewMessage {
        requireSupportedVersion(expectedVersion)
        if (source.toByteArray(Charsets.UTF_8).size > MOSAIC_LOCAL_PREVIEW_MAX_FRAME_BYTES) {
            throw MosaicPreviewCodecException("The preview frame exceeds the 2 MiB limit.")
        }
        val root = try {
            JsonParser.parseString(source).previewObjectAt("$")
        } catch (error: MosaicPreviewCodecException) {
            throw error
        } catch (_: JsonParseException) {
            throw MosaicPreviewCodecException("The preview frame is not valid JSON.")
        } catch (_: IllegalStateException) {
            throw MosaicPreviewCodecException("The preview frame must contain one JSON object.")
        }
        root.previewExpectKeys(
            setOf("previewProtocolVersion", "messageId", "sessionId", "sentAt", "type", "payload"),
            "$",
        )
        val version = root.previewRequiredString("previewProtocolVersion", "$.previewProtocolVersion")
        if (version != expectedVersion) {
            throw MosaicPreviewCodecException("Unsupported local preview protocol version.")
        }
        val messageId = root.previewRequiredPatternString(
            "messageId",
            "$.messageId",
            5,
            100,
            previewMessageIdPattern,
        )
        val sessionId = root.previewRequiredPatternString(
            "sessionId",
            "$.sessionId",
            9,
            100,
            previewSessionIdPattern,
        )
        val sentAt = root.previewRequiredPatternString(
            "sentAt",
            "$.sentAt",
            20,
            32,
            previewUtcTimestampPattern,
        )
        val typeValue = root.previewRequiredString("type", "$.type")
        val type = MosaicPreviewMessageType.fromWireName(typeValue)
            ?: throw MosaicPreviewCodecException("Unknown preview message type at $.type.")
        val payloadObject = root.previewRequired("payload", "$").previewObjectAt("$.payload")
        val payload = decodePayload(type, payloadObject, expectedVersion)
        return MosaicPreviewMessage(
            messageId = messageId,
            sessionId = sessionId,
            sentAt = sentAt,
            payload = payload,
            previewProtocolVersion = version,
        )
    }

    fun encode(
        message: MosaicPreviewMessage,
        expectedVersion: String = MOSAIC_LOCAL_PREVIEW_VERSION,
    ): String {
        requireSupportedVersion(expectedVersion)
        if (message.previewProtocolVersion != expectedVersion) {
            throw MosaicPreviewCodecException("Unsupported local preview protocol version.")
        }
        val root = JsonObject().apply {
            addProperty("previewProtocolVersion", message.previewProtocolVersion)
            addProperty("messageId", message.messageId)
            addProperty("sessionId", message.sessionId)
            addProperty("sentAt", message.sentAt)
            addProperty("type", message.type.wireName)
            add("payload", encodePayload(message.payload))
        }
        // Re-run the strict reader so callers cannot emit an invalid local-preview frame.
        return root.toString().also { decode(it, expectedVersion) }
    }

    private fun decodePayload(
        type: MosaicPreviewMessageType,
        payload: JsonObject,
        expectedVersion: String,
    ): MosaicPreviewPayload = when (type) {
        MosaicPreviewMessageType.CLIENT_CONNECTED -> decodeClientConnected(payload)
        MosaicPreviewMessageType.CLIENT_DISCONNECTED -> decodeClientDisconnected(payload)
        MosaicPreviewMessageType.CAPABILITY_REPORT -> decodeCapabilityReport(payload, expectedVersion)
        MosaicPreviewMessageType.DRAFT_UPDATED -> decodeDraftUpdated(payload)
        MosaicPreviewMessageType.DRAFT_ACCEPTED -> decodeDraftAccepted(payload)
        MosaicPreviewMessageType.DRAFT_REJECTED -> decodeDraftRejected(payload)
        MosaicPreviewMessageType.VALIDATION_ERROR -> decodeValidationError(payload)
        MosaicPreviewMessageType.RENDER_WARNING -> decodeRenderWarning(payload)
        MosaicPreviewMessageType.RENDER_FAILURE -> decodeRenderFailure(payload)
        MosaicPreviewMessageType.MOCK_COMMERCE_STATE_CHANGED -> decodeMockCommerceChanged(payload)
        MosaicPreviewMessageType.HEARTBEAT -> decodeHeartbeat(payload)
    }

    private fun decodeClientConnected(payload: JsonObject): MosaicPreviewClientConnectedPayload {
        payload.previewExpectKeys(setOf("client"), "$.payload")
        return MosaicPreviewClientConnectedPayload(
            client = decodeClientIdentity(payload.previewRequired("client", "$.payload"), "$.payload.client"),
        )
    }

    private fun decodeClientDisconnected(payload: JsonObject): MosaicPreviewClientDisconnectedPayload {
        payload.previewExpectKeys(
            setOf("clientId", "reason", "diagnostic"),
            "$.payload",
            previewOptional = setOf("diagnostic"),
        )
        val reasonValue = payload.previewRequiredString("reason", "$.payload.reason")
        return MosaicPreviewClientDisconnectedPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            reason = MosaicPreviewDisconnectReason.fromWireName(reasonValue)
                ?: throw MosaicPreviewCodecException("Invalid disconnect reason at $.payload.reason."),
            diagnostic = payload.previewOptional("diagnostic")?.previewSafeTextAt("$.payload.diagnostic"),
        )
    }

    private fun decodeCapabilityReport(
        payload: JsonObject,
        expectedVersion: String,
    ): MosaicPreviewCapabilityReportPayload {
        payload.previewExpectKeys(
            setOf(
                "clientId",
                "supportedSchemaVersions",
                "supportedCapabilities",
                "previewCapabilities",
                "limits",
            ),
            "$.payload",
        )
        val schemaVersions = payload.previewRequired("supportedSchemaVersions", "$.payload")
            .previewArrayAt("$.payload.supportedSchemaVersions")
            .previewBounded(1, 16, "$.payload.supportedSchemaVersions")
            .mapIndexed { index, value -> value.previewSemanticVersionAt("$.payload.supportedSchemaVersions/$index") }
            .also { previewRequireUnique(it, "$.payload.supportedSchemaVersions") }
        val capabilities = payload.previewRequired("supportedCapabilities", "$.payload")
            .previewArrayAt("$.payload.supportedCapabilities")
            .previewBounded(1, 128, "$.payload.supportedCapabilities")
            .mapIndexed { index, value ->
                decodeSupportedCapability(value, "$.payload.supportedCapabilities/$index")
            }
            .also { previewRequireUnique(it, "$.payload.supportedCapabilities") }
        val previewCapabilities = payload.previewRequired("previewCapabilities", "$.payload")
            .previewArrayAt("$.payload.previewCapabilities")
            .previewBounded(1, 32, "$.payload.previewCapabilities")
            .mapIndexed { index, value ->
                val path = "$.payload.previewCapabilities/$index"
                val objectValue = value.previewObjectAt(path)
                objectValue.previewExpectKeys(setOf("name", "version"), path)
                val nameValue = objectValue.previewRequiredString("name", "$path.name")
                val name = MosaicPreviewCapabilityName.entries.firstOrNull { it.wireName == nameValue }
                    ?: throw MosaicPreviewCodecException("Unknown preview capability at $path.name.")
                val version = objectValue.previewRequiredString("version", "$path.version")
                if (version != expectedVersion) {
                    throw MosaicPreviewCodecException("Unsupported preview capability version at $path.version.")
                }
                MosaicPreviewCapability(name, version)
            }
            .also { previewRequireUnique(it, "$.payload.previewCapabilities") }
        val limitsPath = "$.payload.limits"
        val limits = payload.previewRequired("limits", "$.payload").previewObjectAt(limitsPath)
        limits.previewExpectKeys(setOf("maxDocumentBytes"), limitsPath)
        return MosaicPreviewCapabilityReportPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            supportedSchemaVersions = schemaVersions,
            supportedCapabilities = capabilities,
            previewCapabilities = previewCapabilities,
            limits = MosaicPreviewLimits(
                limits.previewRequiredInteger("maxDocumentBytes", "$limitsPath.maxDocumentBytes", 65_536..2_097_152),
            ),
        )
    }

    private fun requireSupportedVersion(version: String) {
        if (version != MOSAIC_LOCAL_PREVIEW_VERSION) {
            throw MosaicPreviewCodecException("Unsupported local preview protocol version.")
        }
    }

    private fun decodeDraftUpdated(payload: JsonObject): MosaicPreviewDraftUpdatedPayload {
        payload.previewExpectKeys(
            setOf("editableDocumentId", "revision", "document", "preview"),
            "$.payload",
        )
        val document = payload.previewRequired("document", "$.payload").previewObjectAt("$.payload.document")
        val previewPath = "$.payload.preview"
        val preview = payload.previewRequired("preview", "$.payload").previewObjectAt(previewPath)
        preview.previewExpectKeys(setOf("locale", "textScale"), previewPath)
        return MosaicPreviewDraftUpdatedPayload(
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.previewRequired("revision", "$.payload"), "$.payload.revision"),
            documentJson = document.toString(),
            preview = MosaicPreviewContext(
                locale = preview.previewRequiredPatternString(
                    "locale",
                    "$previewPath.locale",
                    2,
                    7,
                    previewLocalePattern,
                ),
                textScale = preview.previewRequiredNumber("textScale", "$previewPath.textScale", 0.5..3.0).toFloat(),
            ),
        )
    }

    private fun decodeDraftAccepted(payload: JsonObject): MosaicPreviewDraftAcceptedPayload {
        payload.previewExpectKeys(setOf("clientId", "editableDocumentId", "revision"), "$.payload")
        return MosaicPreviewDraftAcceptedPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.previewRequired("revision", "$.payload"), "$.payload.revision"),
        )
    }

    private fun decodeDraftRejected(payload: JsonObject): MosaicPreviewDraftRejectedPayload {
        payload.previewExpectKeys(
            setOf("clientId", "editableDocumentId", "revision", "reason", "diagnostics"),
            "$.payload",
        )
        val reasonValue = payload.previewRequiredString("reason", "$.payload.reason")
        val diagnostics = payload.previewRequired("diagnostics", "$.payload")
            .previewArrayAt("$.payload.diagnostics")
            .previewBounded(1, 50, "$.payload.diagnostics")
            .mapIndexed { index, value ->
                decodeValidationDiagnostic(value, "$.payload.diagnostics/$index")
            }
        return MosaicPreviewDraftRejectedPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.previewRequired("revision", "$.payload"), "$.payload.revision"),
            reason = MosaicPreviewDraftRejectionReason.fromWireName(reasonValue)
                ?: throw MosaicPreviewCodecException("Invalid rejection reason at $.payload.reason."),
            diagnostics = diagnostics,
        )
    }

    private fun decodeValidationError(payload: JsonObject): MosaicPreviewValidationErrorPayload {
        payload.previewExpectKeys(setOf("clientId", "editableDocumentId", "revision", "errors"), "$.payload")
        val errors = payload.previewRequired("errors", "$.payload")
            .previewArrayAt("$.payload.errors")
            .previewBounded(1, 100, "$.payload.errors")
            .mapIndexed { index, value ->
                decodeValidationDiagnostic(value, "$.payload.errors/$index")
            }
        return MosaicPreviewValidationErrorPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.previewRequired("revision", "$.payload"), "$.payload.revision"),
            errors = errors,
        )
    }

    private fun decodeRenderWarning(payload: JsonObject): MosaicPreviewRenderWarningPayload {
        payload.previewExpectKeys(setOf("clientId", "editableDocumentId", "revision", "warnings"), "$.payload")
        val warnings = payload.previewRequired("warnings", "$.payload")
            .previewArrayAt("$.payload.warnings")
            .previewBounded(1, 50, "$.payload.warnings")
            .mapIndexed { index, value -> decodeCompatibilityWarning(value, "$.payload.warnings/$index") }
        return MosaicPreviewRenderWarningPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.previewRequired("revision", "$.payload"), "$.payload.revision"),
            warnings = warnings,
        )
    }

    private fun decodeRenderFailure(payload: JsonObject): MosaicPreviewRenderFailurePayload {
        payload.previewExpectKeys(setOf("clientId", "editableDocumentId", "revision", "failure"), "$.payload")
        return MosaicPreviewRenderFailurePayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.previewRequired("revision", "$.payload"), "$.payload.revision"),
            failure = decodeRenderDiagnostic(payload.previewRequired("failure", "$.payload"), "$.payload.failure"),
        )
    }

    private fun decodeMockCommerceChanged(payload: JsonObject): MosaicPreviewMockCommerceStateChangedPayload {
        payload.previewExpectKeys(setOf("editableDocumentId", "stateRevision", "state"), "$.payload")
        return MosaicPreviewMockCommerceStateChangedPayload(
            editableDocumentId = payload.previewRequiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            stateRevision = decodeRevision(
                payload.previewRequired("stateRevision", "$.payload"),
                "$.payload.stateRevision",
            ),
            state = decodeCommerceState(payload.previewRequired("state", "$.payload"), "$.payload.state"),
        )
    }

    private fun decodeHeartbeat(payload: JsonObject): MosaicPreviewHeartbeatPayload {
        payload.previewExpectKeys(setOf("clientId", "kind", "sequence"), "$.payload")
        val kindValue = payload.previewRequiredString("kind", "$.payload.kind")
        return MosaicPreviewHeartbeatPayload(
            clientId = payload.previewRequiredClientId("clientId", "$.payload.clientId"),
            kind = MosaicPreviewHeartbeatKind.fromWireName(kindValue)
                ?: throw MosaicPreviewCodecException("Invalid heartbeat kind at $.payload.kind."),
            sequence = payload.previewRequiredInteger("sequence", "$.payload.sequence", 0..Int.MAX_VALUE),
        )
    }

    private fun decodeClientIdentity(value: JsonElement, path: String): MosaicPreviewClientIdentity {
        val identity = value.previewObjectAt(path)
        identity.previewExpectKeys(setOf("clientId", "displayName", "renderer", "application", "device"), path)
        val renderer = identity.previewRequired("renderer", path).previewObjectAt("$path.renderer")
        renderer.previewExpectKeys(setOf("id", "version"), "$path.renderer")
        val application = identity.previewRequired("application", path).previewObjectAt("$path.application")
        application.previewExpectKeys(setOf("id", "displayName", "version"), "$path.application")
        val device = identity.previewRequired("device", path).previewObjectAt("$path.device")
        device.previewExpectKeys(setOf("displayName", "systemName", "systemVersion"), "$path.device")
        return MosaicPreviewClientIdentity(
            clientId = identity.previewRequiredClientId("clientId", "$path.clientId"),
            displayName = identity.previewRequiredSafeDisplayName("displayName", "$path.displayName"),
            renderer = MosaicPreviewSoftwareIdentity(
                id = renderer.previewRequiredMachineIdentifier("id", "$path.renderer.id"),
                version = renderer.previewRequiredSemanticVersion("version", "$path.renderer.version"),
            ),
            application = MosaicPreviewApplicationIdentity(
                id = application.previewRequiredMachineIdentifier("id", "$path.application.id"),
                displayName = application.previewRequiredSafeDisplayName("displayName", "$path.application.displayName"),
                version = application.previewRequiredSingleLine("version", "$path.application.version", 1, 64),
            ),
            device = MosaicPreviewDeviceIdentity(
                displayName = device.previewRequiredSafeDisplayName("displayName", "$path.device.displayName"),
                systemName = device.previewRequiredSafeDisplayName("systemName", "$path.device.systemName"),
                systemVersion = device.previewRequiredSingleLine("systemVersion", "$path.device.systemVersion", 1, 64),
            ),
        )
    }

    private fun decodeRevision(value: JsonElement, path: String): MosaicLocalRevision {
        val revision = value.previewObjectAt(path)
        revision.previewExpectKeys(setOf("revisionId", "sequence"), path)
        return MosaicLocalRevision(
            revisionId = revision.previewRequiredPatternString(
                "revisionId",
                "$path.revisionId",
                10,
                100,
                previewRevisionIdPattern,
            ),
            sequence = revision.previewRequiredInteger("sequence", "$path.sequence", 1..Int.MAX_VALUE),
        )
    }

    private fun decodeSupportedCapability(value: JsonElement, path: String): MosaicPreviewSupportedCapability {
        val capability = value.previewObjectAt(path)
        capability.previewExpectKeys(setOf("name", "version"), path)
        return MosaicPreviewSupportedCapability(
            name = capability.previewRequiredMachineIdentifier("name", "$path.name"),
            version = capability.previewRequiredSemanticVersion("version", "$path.version"),
        )
    }

    private fun decodeRecovery(value: JsonElement, path: String): MosaicPreviewRecoveryAction {
        val recovery = value.previewObjectAt(path)
        recovery.previewExpectKeys(setOf("action", "message"), path)
        val actionValue = recovery.previewRequiredString("action", "$path.action")
        return MosaicPreviewRecoveryAction(
            action = MosaicPreviewRecoveryActionName.fromWireName(actionValue)
                ?: throw MosaicPreviewCodecException("Invalid recovery action at $path.action."),
            message = recovery.previewRequired("message", path).previewSafeTextAt("$path.message"),
        )
    }

    private fun decodeLocation(value: JsonElement, path: String): MosaicPreviewDiagnosticLocation {
        val location = value.previewObjectAt(path)
        location.previewExpectKeys(
            setOf("documentPath", "componentId", "property"),
            path,
            previewOptional = setOf("componentId", "property"),
        )
        return MosaicPreviewDiagnosticLocation(
            documentPath = location.previewRequiredPatternString(
                "documentPath",
                "$path.documentPath",
                0,
                512,
                previewJsonPointerPattern,
            ),
            componentId = location.previewOptional("componentId")?.previewPatternStringAt(
                "$path.componentId",
                1,
                128,
                previewComponentIdPattern,
            ),
            property = location.previewOptional("property")?.previewPatternStringAt(
                "$path.property",
                1,
                128,
                previewPropertyPattern,
            ),
        )
    }

    private fun decodeValidationDiagnostic(
        value: JsonElement,
        path: String,
    ): MosaicPreviewValidationDiagnostic {
        val diagnostic = value.previewObjectAt(path)
        diagnostic.previewExpectKeys(setOf("code", "message", "location", "recovery"), path)
        return MosaicPreviewValidationDiagnostic(
            code = diagnostic.previewRequiredPatternString(
                "code",
                "$path.code",
                3,
                96,
                previewDiagnosticCodePattern,
            ),
            message = diagnostic.previewRequired("message", path).previewSafeTextAt("$path.message"),
            location = decodeLocation(diagnostic.previewRequired("location", path), "$path.location"),
            recovery = decodeRecovery(diagnostic.previewRequired("recovery", path), "$path.recovery"),
        )
    }

    private fun decodeCompatibilityWarning(
        value: JsonElement,
        path: String,
    ): MosaicPreviewCompatibilityWarning {
        val warning = value.previewObjectAt(path)
        warning.previewExpectKeys(
            setOf("code", "severity", "message", "location", "capability", "fallback", "recovery"),
            path,
            previewOptional = setOf("location", "capability"),
        )
        val severityValue = warning.previewRequiredString("severity", "$path.severity")
        val severity = MosaicPreviewWarningSeverity.fromWireName(severityValue)
            ?: throw MosaicPreviewCodecException("Invalid warning severity at $path.severity.")
        val fallbackValue = warning.previewRequiredString("fallback", "$path.fallback")
        val fallback = MosaicPreviewFallback.fromWireName(fallbackValue)
            ?: throw MosaicPreviewCodecException("Invalid warning fallback at $path.fallback.")
        if (severity == MosaicPreviewWarningSeverity.BLOCKING &&
            fallback != MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT
        ) {
            throw MosaicPreviewCodecException("A blocking warning must keep the last accepted draft.")
        }
        return MosaicPreviewCompatibilityWarning(
            code = warning.previewRequiredPatternString("code", "$path.code", 3, 96, previewDiagnosticCodePattern),
            severity = severity,
            message = warning.previewRequired("message", path).previewSafeTextAt("$path.message"),
            location = warning.previewOptional("location")?.let { decodeLocation(it, "$path.location") },
            capability = warning.previewOptional("capability")?.let {
                decodeSupportedCapability(it, "$path.capability")
            },
            fallback = fallback,
            recovery = decodeRecovery(warning.previewRequired("recovery", path), "$path.recovery"),
        )
    }

    private fun decodeRenderDiagnostic(value: JsonElement, path: String): MosaicPreviewRenderDiagnostic {
        val diagnostic = value.previewObjectAt(path)
        diagnostic.previewExpectKeys(
            setOf("code", "message", "location", "fallback", "recovery"),
            path,
            previewOptional = setOf("location"),
        )
        val fallback = diagnostic.previewRequiredString("fallback", "$path.fallback")
        if (fallback != MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT.wireName) {
            throw MosaicPreviewCodecException("A render failure must keep the last accepted draft.")
        }
        return MosaicPreviewRenderDiagnostic(
            code = diagnostic.previewRequiredPatternString("code", "$path.code", 3, 96, previewDiagnosticCodePattern),
            message = diagnostic.previewRequired("message", path).previewSafeTextAt("$path.message"),
            location = diagnostic.previewOptional("location")?.let { decodeLocation(it, "$path.location") },
            fallback = MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT,
            recovery = decodeRecovery(diagnostic.previewRequired("recovery", path), "$path.recovery"),
        )
    }

    private fun decodeCommerceState(value: JsonElement, path: String): MosaicPreviewMockCommerceState {
        val state = value.previewObjectAt(path)
        state.previewExpectKeys(setOf("products", "purchaseOutcome", "restoreOutcome", "entitlement"), path)
        val products = state.previewRequired("products", path).previewArrayAt("$path.products")
            .previewBounded(0, 50, "$path.products")
            .mapIndexed { index, product -> decodeMockProduct(product, "$path.products/$index") }
        val purchaseValue = state.previewRequiredString("purchaseOutcome", "$path.purchaseOutcome")
        val restoreValue = state.previewRequiredString("restoreOutcome", "$path.restoreOutcome")
        return MosaicPreviewMockCommerceState(
            products = products,
            purchaseOutcome = MosaicPreviewPurchaseOutcome.fromWireName(purchaseValue)
                ?: throw MosaicPreviewCodecException("Invalid purchase outcome at $path.purchaseOutcome."),
            restoreOutcome = MosaicPreviewRestoreOutcome.fromWireName(restoreValue)
                ?: throw MosaicPreviewCodecException("Invalid restore outcome at $path.restoreOutcome."),
            entitlement = decodeEntitlement(state.previewRequired("entitlement", path), "$path.entitlement"),
        )
    }

    private fun decodeMockProduct(value: JsonElement, path: String): MosaicPreviewMockProduct {
        val product = value.previewObjectAt(path)
        val availability = product.previewRequiredString("availability", "$path.availability")
        return when (availability) {
            "available" -> when (product.previewRequiredString("kind", "$path.kind")) {
                "subscription" -> {
                    product.previewExpectKeys(
                        setOf(
                            "productReferenceId",
                            "availability",
                            "kind",
                            "localizedPrice",
                            "currencyCode",
                            "billingPeriod",
                            "trialPeriod",
                            "introductoryOffer",
                        ),
                        path,
                        previewOptional = setOf("trialPeriod", "introductoryOffer"),
                    )
                    MosaicPreviewMockProduct.AvailableSubscription(
                        productReferenceId = product.previewRequiredComponentId(
                            "productReferenceId",
                            "$path.productReferenceId",
                        ),
                        localizedPrice = product.previewRequiredSafeDisplayName(
                            "localizedPrice",
                            "$path.localizedPrice",
                        ),
                        currencyCode = product.previewRequiredPatternString(
                            "currencyCode",
                            "$path.currencyCode",
                            3,
                            3,
                            previewCurrencyPattern,
                        ),
                        billingPeriod = decodePeriod(product.previewRequired("billingPeriod", path), "$path.billingPeriod"),
                        trialPeriod = product.previewOptional("trialPeriod")?.let {
                            decodePeriod(it, "$path.trialPeriod")
                        },
                        introductoryOffer = product.previewOptional("introductoryOffer")?.let {
                            decodeIntroductoryOffer(it, "$path.introductoryOffer")
                        },
                    )
                }
                "nonConsumable" -> {
                    product.previewExpectKeys(
                        setOf(
                            "productReferenceId",
                            "availability",
                            "kind",
                            "localizedPrice",
                            "currencyCode",
                        ),
                        path,
                    )
                    MosaicPreviewMockProduct.AvailableNonConsumable(
                        productReferenceId = product.previewRequiredComponentId(
                            "productReferenceId",
                            "$path.productReferenceId",
                        ),
                        localizedPrice = product.previewRequiredSafeDisplayName(
                            "localizedPrice",
                            "$path.localizedPrice",
                        ),
                        currencyCode = product.previewRequiredPatternString(
                            "currencyCode",
                            "$path.currencyCode",
                            3,
                            3,
                            previewCurrencyPattern,
                        ),
                    )
                }
                else -> throw MosaicPreviewCodecException("Invalid mock product kind at $path.kind.")
            }
            "unavailable" -> {
                product.previewExpectKeys(setOf("productReferenceId", "availability", "reason"), path)
                val reasonValue = product.previewRequiredString("reason", "$path.reason")
                MosaicPreviewMockProduct.Unavailable(
                    productReferenceId = product.previewRequiredComponentId(
                        "productReferenceId",
                        "$path.productReferenceId",
                    ),
                    reason = MosaicPreviewMockProduct.Unavailable.Reason.fromWireName(reasonValue)
                        ?: throw MosaicPreviewCodecException("Invalid unavailable reason at $path.reason."),
                )
            }
            else -> throw MosaicPreviewCodecException("Invalid mock product availability at $path.availability.")
        }
    }

    private fun decodePeriod(value: JsonElement, path: String): MosaicPreviewPeriod {
        val period = value.previewObjectAt(path)
        period.previewExpectKeys(setOf("unit", "value"), path)
        val unitValue = period.previewRequiredString("unit", "$path.unit")
        return MosaicPreviewPeriod(
            unit = MosaicPreviewPeriodUnit.fromWireName(unitValue)
                ?: throw MosaicPreviewCodecException("Invalid mock period unit at $path.unit."),
            value = period.previewRequiredInteger("value", "$path.value", 1..120),
        )
    }

    private fun decodeIntroductoryOffer(value: JsonElement, path: String): MosaicPreviewIntroductoryOffer {
        val offer = value.previewObjectAt(path)
        offer.previewExpectKeys(setOf("localizedPrice", "period", "cycles"), path)
        return MosaicPreviewIntroductoryOffer(
            localizedPrice = offer.previewRequiredSafeDisplayName("localizedPrice", "$path.localizedPrice"),
            period = decodePeriod(offer.previewRequired("period", path), "$path.period"),
            cycles = offer.previewRequiredInteger("cycles", "$path.cycles", 1..120),
        )
    }

    private fun decodeEntitlement(value: JsonElement, path: String): MosaicPreviewMockEntitlement {
        val entitlement = value.previewObjectAt(path)
        return when (entitlement.previewRequiredString("status", "$path.status")) {
            "none" -> {
                entitlement.previewExpectKeys(setOf("status"), path)
                MosaicPreviewMockEntitlement.None
            }
            "active" -> {
                entitlement.previewExpectKeys(setOf("status", "productReferenceId"), path)
                MosaicPreviewMockEntitlement.Active(
                    entitlement.previewRequiredComponentId("productReferenceId", "$path.productReferenceId"),
                )
            }
            else -> throw MosaicPreviewCodecException("Invalid mock entitlement status at $path.status.")
        }
    }

    private fun encodePayload(payload: MosaicPreviewPayload): JsonObject = when (payload) {
        is MosaicPreviewClientConnectedPayload -> previewObjectOf("client" to encodeClient(payload.client))
        is MosaicPreviewClientDisconnectedPayload -> previewObjectOf(
            "clientId" to previewJson(payload.clientId),
            "reason" to previewJson(payload.reason.wireName),
            "diagnostic" to payload.diagnostic?.let(::previewJson),
        )
        is MosaicPreviewCapabilityReportPayload -> previewObjectOf(
            "clientId" to previewJson(payload.clientId),
            "supportedSchemaVersions" to previewArrayOf(payload.supportedSchemaVersions.map(::previewJson)),
            "supportedCapabilities" to previewArrayOf(payload.supportedCapabilities.map(::encodeCapability)),
            "previewCapabilities" to previewArrayOf(payload.previewCapabilities.map(::encodePreviewCapability)),
            "limits" to previewObjectOf("maxDocumentBytes" to previewJson(payload.limits.maxDocumentBytes)),
        )
        is MosaicPreviewDraftUpdatedPayload -> previewObjectOf(
            "editableDocumentId" to previewJson(payload.editableDocumentId),
            "revision" to encodeRevision(payload.revision),
            "document" to previewParseDocument(payload.documentJson),
            "preview" to previewObjectOf(
                "locale" to previewJson(payload.preview.locale),
                "textScale" to previewJson(payload.preview.textScale),
            ),
        )
        is MosaicPreviewDraftAcceptedPayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        )
        is MosaicPreviewDraftRejectedPayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply {
            addProperty("reason", payload.reason.wireName)
            add("diagnostics", previewArrayOf(payload.diagnostics.map(::encodeValidationDiagnostic)))
        }
        is MosaicPreviewValidationErrorPayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply { add("errors", previewArrayOf(payload.errors.map(::encodeValidationDiagnostic))) }
        is MosaicPreviewRenderWarningPayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply { add("warnings", previewArrayOf(payload.warnings.map(::encodeWarning))) }
        is MosaicPreviewRenderFailurePayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply { add("failure", encodeRenderDiagnostic(payload.failure)) }
        is MosaicPreviewMockCommerceStateChangedPayload -> previewObjectOf(
            "editableDocumentId" to previewJson(payload.editableDocumentId),
            "stateRevision" to encodeRevision(payload.stateRevision),
            "state" to encodeCommerceState(payload.state),
        )
        is MosaicPreviewHeartbeatPayload -> previewObjectOf(
            "clientId" to previewJson(payload.clientId),
            "kind" to previewJson(payload.kind.wireName),
            "sequence" to previewJson(payload.sequence),
        )
    }

    private fun encodeClient(client: MosaicPreviewClientIdentity) = previewObjectOf(
        "clientId" to previewJson(client.clientId),
        "displayName" to previewJson(client.displayName),
        "renderer" to previewObjectOf(
            "id" to previewJson(client.renderer.id),
            "version" to previewJson(client.renderer.version),
        ),
        "application" to previewObjectOf(
            "id" to previewJson(client.application.id),
            "displayName" to previewJson(client.application.displayName),
            "version" to previewJson(client.application.version),
        ),
        "device" to previewObjectOf(
            "displayName" to previewJson(client.device.displayName),
            "systemName" to previewJson(client.device.systemName),
            "systemVersion" to previewJson(client.device.systemVersion),
        ),
    )

    private fun encodeCapability(capability: MosaicPreviewSupportedCapability) = previewObjectOf(
        "name" to previewJson(capability.name),
        "version" to previewJson(capability.version),
    )

    private fun encodePreviewCapability(capability: MosaicPreviewCapability) = previewObjectOf(
        "name" to previewJson(capability.name.wireName),
        "version" to previewJson(capability.version),
    )

    private fun encodeRevision(revision: MosaicLocalRevision) = previewObjectOf(
        "revisionId" to previewJson(revision.revisionId),
        "sequence" to previewJson(revision.sequence),
    )

    private fun revisionTarget(clientId: String, documentId: String, revision: MosaicLocalRevision) =
        previewObjectOf(
            "clientId" to previewJson(clientId),
            "editableDocumentId" to previewJson(documentId),
            "revision" to encodeRevision(revision),
        )

    private fun encodeRecovery(recovery: MosaicPreviewRecoveryAction) = previewObjectOf(
        "action" to previewJson(recovery.action.wireName),
        "message" to previewJson(recovery.message),
    )

    private fun encodeLocation(location: MosaicPreviewDiagnosticLocation) = previewObjectOf(
        "documentPath" to previewJson(location.documentPath),
        "componentId" to location.componentId?.let(::previewJson),
        "property" to location.property?.let(::previewJson),
    )

    private fun encodeValidationDiagnostic(diagnostic: MosaicPreviewValidationDiagnostic) = previewObjectOf(
        "code" to previewJson(diagnostic.code),
        "message" to previewJson(diagnostic.message),
        "location" to encodeLocation(diagnostic.location),
        "recovery" to encodeRecovery(diagnostic.recovery),
    )

    private fun encodeWarning(warning: MosaicPreviewCompatibilityWarning) = previewObjectOf(
        "code" to previewJson(warning.code),
        "severity" to previewJson(warning.severity.wireName),
        "message" to previewJson(warning.message),
        "location" to warning.location?.let(::encodeLocation),
        "capability" to warning.capability?.let(::encodeCapability),
        "fallback" to previewJson(warning.fallback.wireName),
        "recovery" to encodeRecovery(warning.recovery),
    )

    private fun encodeRenderDiagnostic(diagnostic: MosaicPreviewRenderDiagnostic) = previewObjectOf(
        "code" to previewJson(diagnostic.code),
        "message" to previewJson(diagnostic.message),
        "location" to diagnostic.location?.let(::encodeLocation),
        "fallback" to previewJson(diagnostic.fallback.wireName),
        "recovery" to encodeRecovery(diagnostic.recovery),
    )

    private fun encodeCommerceState(state: MosaicPreviewMockCommerceState) = previewObjectOf(
        "products" to previewArrayOf(state.products.map(::encodeMockProduct)),
        "purchaseOutcome" to previewJson(state.purchaseOutcome.wireName),
        "restoreOutcome" to previewJson(state.restoreOutcome.wireName),
        "entitlement" to when (val entitlement = state.entitlement) {
            MosaicPreviewMockEntitlement.None -> previewObjectOf("status" to previewJson("none"))
            is MosaicPreviewMockEntitlement.Active -> previewObjectOf(
                "status" to previewJson("active"),
                "productReferenceId" to previewJson(entitlement.productReferenceId),
            )
        },
    )

    private fun encodeMockProduct(product: MosaicPreviewMockProduct): JsonObject = when (product) {
        is MosaicPreviewMockProduct.AvailableSubscription -> previewObjectOf(
            "productReferenceId" to previewJson(product.productReferenceId),
            "availability" to previewJson("available"),
            "kind" to previewJson("subscription"),
            "localizedPrice" to previewJson(product.localizedPrice),
            "currencyCode" to previewJson(product.currencyCode),
            "billingPeriod" to encodePeriod(product.billingPeriod),
            "trialPeriod" to product.trialPeriod?.let(::encodePeriod),
            "introductoryOffer" to product.introductoryOffer?.let {
                previewObjectOf(
                    "localizedPrice" to previewJson(it.localizedPrice),
                    "period" to encodePeriod(it.period),
                    "cycles" to previewJson(it.cycles),
                )
            },
        )
        is MosaicPreviewMockProduct.AvailableNonConsumable -> previewObjectOf(
            "productReferenceId" to previewJson(product.productReferenceId),
            "availability" to previewJson("available"),
            "kind" to previewJson("nonConsumable"),
            "localizedPrice" to previewJson(product.localizedPrice),
            "currencyCode" to previewJson(product.currencyCode),
        )
        is MosaicPreviewMockProduct.Unavailable -> previewObjectOf(
            "productReferenceId" to previewJson(product.productReferenceId),
            "availability" to previewJson("unavailable"),
            "reason" to previewJson(product.reason.wireName),
        )
    }

    private fun encodePeriod(period: MosaicPreviewPeriod) = previewObjectOf(
        "unit" to previewJson(period.unit.wireName),
        "value" to previewJson(period.value),
    )

}

class MosaicPreviewCodecException(message: String) : IllegalArgumentException(message)
