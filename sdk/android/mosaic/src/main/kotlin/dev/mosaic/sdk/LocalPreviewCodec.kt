package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal

/** Strict JSON reader/writer for the frozen, platform-neutral Local Preview 0.1 contract. */
object MosaicLocalPreviewCodec {
    private val messageIdPattern = Regex("^msg_[A-Za-z0-9][A-Za-z0-9_-]*$")
    private val sessionIdPattern = Regex("^session_[A-Za-z0-9][A-Za-z0-9_-]*$")
    private val clientIdPattern = Regex("^client_[A-Za-z0-9][A-Za-z0-9_-]*$")
    private val documentIdPattern = Regex("^document_[A-Za-z0-9][A-Za-z0-9_-]*$")
    private val revisionIdPattern = Regex("^revision_[A-Za-z0-9][A-Za-z0-9_-]*$")
    private val machineIdentifierPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    private val componentIdPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
    private val diagnosticCodePattern = Regex("^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$")
    private val semanticVersionPattern =
        Regex("^[0-9]+\\.[0-9]+(?:\\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$")
    private val localePattern = Regex("^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
    private val utcTimestampPattern = Regex(
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$",
    )
    private val jsonPointerPattern = Regex("^(?:/(?:[^~/]|~[01])*)*$")
    private val propertyPattern = Regex("^[A-Za-z][A-Za-z0-9]*$")
    private val currencyPattern = Regex("^[A-Z]{3}$")

    fun decode(source: String): MosaicPreviewMessage {
        if (source.toByteArray(Charsets.UTF_8).size > MOSAIC_LOCAL_PREVIEW_MAX_FRAME_BYTES) {
            throw MosaicPreviewCodecException("The preview frame exceeds the 2 MiB limit.")
        }
        val root = try {
            JsonParser.parseString(source).objectAt("$")
        } catch (error: MosaicPreviewCodecException) {
            throw error
        } catch (_: JsonParseException) {
            throw MosaicPreviewCodecException("The preview frame is not valid JSON.")
        } catch (_: IllegalStateException) {
            throw MosaicPreviewCodecException("The preview frame must contain one JSON object.")
        }
        root.expectKeys(
            setOf("previewProtocolVersion", "messageId", "sessionId", "sentAt", "type", "payload"),
            "$",
        )
        val version = root.requiredString("previewProtocolVersion", "$.previewProtocolVersion")
        if (version != MOSAIC_LOCAL_PREVIEW_VERSION) {
            throw MosaicPreviewCodecException("Unsupported local preview protocol version.")
        }
        val messageId = root.requiredPatternString(
            "messageId",
            "$.messageId",
            5,
            100,
            messageIdPattern,
        )
        val sessionId = root.requiredPatternString(
            "sessionId",
            "$.sessionId",
            9,
            100,
            sessionIdPattern,
        )
        val sentAt = root.requiredPatternString(
            "sentAt",
            "$.sentAt",
            20,
            32,
            utcTimestampPattern,
        )
        val typeValue = root.requiredString("type", "$.type")
        val type = MosaicPreviewMessageType.fromWireName(typeValue)
            ?: throw MosaicPreviewCodecException("Unknown preview message type at $.type.")
        val payloadObject = root.required("payload", "$").objectAt("$.payload")
        val payload = decodePayload(type, payloadObject)
        return MosaicPreviewMessage(
            messageId = messageId,
            sessionId = sessionId,
            sentAt = sentAt,
            payload = payload,
            previewProtocolVersion = version,
        )
    }

    fun encode(message: MosaicPreviewMessage): String {
        if (message.previewProtocolVersion != MOSAIC_LOCAL_PREVIEW_VERSION) {
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
        return root.toString().also(::decode)
    }

    private fun decodePayload(
        type: MosaicPreviewMessageType,
        payload: JsonObject,
    ): MosaicPreviewPayload = when (type) {
        MosaicPreviewMessageType.CLIENT_CONNECTED -> decodeClientConnected(payload)
        MosaicPreviewMessageType.CLIENT_DISCONNECTED -> decodeClientDisconnected(payload)
        MosaicPreviewMessageType.CAPABILITY_REPORT -> decodeCapabilityReport(payload)
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
        payload.expectKeys(setOf("client"), "$.payload")
        return MosaicPreviewClientConnectedPayload(
            client = decodeClientIdentity(payload.required("client", "$.payload"), "$.payload.client"),
        )
    }

    private fun decodeClientDisconnected(payload: JsonObject): MosaicPreviewClientDisconnectedPayload {
        payload.expectKeys(
            setOf("clientId", "reason", "diagnostic"),
            "$.payload",
            optional = setOf("diagnostic"),
        )
        val reasonValue = payload.requiredString("reason", "$.payload.reason")
        return MosaicPreviewClientDisconnectedPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            reason = MosaicPreviewDisconnectReason.fromWireName(reasonValue)
                ?: throw MosaicPreviewCodecException("Invalid disconnect reason at $.payload.reason."),
            diagnostic = payload.optional("diagnostic")?.safeTextAt("$.payload.diagnostic"),
        )
    }

    private fun decodeCapabilityReport(payload: JsonObject): MosaicPreviewCapabilityReportPayload {
        payload.expectKeys(
            setOf(
                "clientId",
                "supportedSchemaVersions",
                "supportedCapabilities",
                "previewCapabilities",
                "limits",
            ),
            "$.payload",
        )
        val schemaVersions = payload.required("supportedSchemaVersions", "$.payload")
            .arrayAt("$.payload.supportedSchemaVersions")
            .bounded(1, 16, "$.payload.supportedSchemaVersions")
            .mapIndexed { index, value -> value.semanticVersionAt("$.payload.supportedSchemaVersions/$index") }
            .also { requireUnique(it, "$.payload.supportedSchemaVersions") }
        val capabilities = payload.required("supportedCapabilities", "$.payload")
            .arrayAt("$.payload.supportedCapabilities")
            .bounded(1, 128, "$.payload.supportedCapabilities")
            .mapIndexed { index, value ->
                decodeSupportedCapability(value, "$.payload.supportedCapabilities/$index")
            }
            .also { requireUnique(it, "$.payload.supportedCapabilities") }
        val previewCapabilities = payload.required("previewCapabilities", "$.payload")
            .arrayAt("$.payload.previewCapabilities")
            .bounded(1, 32, "$.payload.previewCapabilities")
            .mapIndexed { index, value ->
                val path = "$.payload.previewCapabilities/$index"
                val objectValue = value.objectAt(path)
                objectValue.expectKeys(setOf("name", "version"), path)
                val nameValue = objectValue.requiredString("name", "$path.name")
                val name = MosaicPreviewCapabilityName.entries.firstOrNull { it.wireName == nameValue }
                    ?: throw MosaicPreviewCodecException("Unknown preview capability at $path.name.")
                val version = objectValue.requiredString("version", "$path.version")
                if (version != MOSAIC_LOCAL_PREVIEW_VERSION) {
                    throw MosaicPreviewCodecException("Unsupported preview capability version at $path.version.")
                }
                MosaicPreviewCapability(name, version)
            }
            .also { requireUnique(it, "$.payload.previewCapabilities") }
        val limitsPath = "$.payload.limits"
        val limits = payload.required("limits", "$.payload").objectAt(limitsPath)
        limits.expectKeys(setOf("maxDocumentBytes"), limitsPath)
        return MosaicPreviewCapabilityReportPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            supportedSchemaVersions = schemaVersions,
            supportedCapabilities = capabilities,
            previewCapabilities = previewCapabilities,
            limits = MosaicPreviewLimits(
                limits.requiredInteger("maxDocumentBytes", "$limitsPath.maxDocumentBytes", 65_536..2_097_152),
            ),
        )
    }

    private fun decodeDraftUpdated(payload: JsonObject): MosaicPreviewDraftUpdatedPayload {
        payload.expectKeys(
            setOf("editableDocumentId", "revision", "document", "preview"),
            "$.payload",
        )
        val document = payload.required("document", "$.payload").objectAt("$.payload.document")
        val previewPath = "$.payload.preview"
        val preview = payload.required("preview", "$.payload").objectAt(previewPath)
        preview.expectKeys(setOf("locale", "textScale"), previewPath)
        return MosaicPreviewDraftUpdatedPayload(
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.required("revision", "$.payload"), "$.payload.revision"),
            documentJson = document.toString(),
            preview = MosaicPreviewContext(
                locale = preview.requiredPatternString(
                    "locale",
                    "$previewPath.locale",
                    2,
                    7,
                    localePattern,
                ),
                textScale = preview.requiredNumber("textScale", "$previewPath.textScale", 0.5..3.0).toFloat(),
            ),
        )
    }

    private fun decodeDraftAccepted(payload: JsonObject): MosaicPreviewDraftAcceptedPayload {
        payload.expectKeys(setOf("clientId", "editableDocumentId", "revision"), "$.payload")
        return MosaicPreviewDraftAcceptedPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.required("revision", "$.payload"), "$.payload.revision"),
        )
    }

    private fun decodeDraftRejected(payload: JsonObject): MosaicPreviewDraftRejectedPayload {
        payload.expectKeys(
            setOf("clientId", "editableDocumentId", "revision", "reason", "diagnostics"),
            "$.payload",
        )
        val reasonValue = payload.requiredString("reason", "$.payload.reason")
        val diagnostics = payload.required("diagnostics", "$.payload")
            .arrayAt("$.payload.diagnostics")
            .bounded(1, 50, "$.payload.diagnostics")
            .mapIndexed { index, value ->
                decodeValidationDiagnostic(value, "$.payload.diagnostics/$index")
            }
        return MosaicPreviewDraftRejectedPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.required("revision", "$.payload"), "$.payload.revision"),
            reason = MosaicPreviewDraftRejectionReason.fromWireName(reasonValue)
                ?: throw MosaicPreviewCodecException("Invalid rejection reason at $.payload.reason."),
            diagnostics = diagnostics,
        )
    }

    private fun decodeValidationError(payload: JsonObject): MosaicPreviewValidationErrorPayload {
        payload.expectKeys(setOf("clientId", "editableDocumentId", "revision", "errors"), "$.payload")
        val errors = payload.required("errors", "$.payload")
            .arrayAt("$.payload.errors")
            .bounded(1, 100, "$.payload.errors")
            .mapIndexed { index, value ->
                decodeValidationDiagnostic(value, "$.payload.errors/$index")
            }
        return MosaicPreviewValidationErrorPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.required("revision", "$.payload"), "$.payload.revision"),
            errors = errors,
        )
    }

    private fun decodeRenderWarning(payload: JsonObject): MosaicPreviewRenderWarningPayload {
        payload.expectKeys(setOf("clientId", "editableDocumentId", "revision", "warnings"), "$.payload")
        val warnings = payload.required("warnings", "$.payload")
            .arrayAt("$.payload.warnings")
            .bounded(1, 50, "$.payload.warnings")
            .mapIndexed { index, value -> decodeCompatibilityWarning(value, "$.payload.warnings/$index") }
        return MosaicPreviewRenderWarningPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.required("revision", "$.payload"), "$.payload.revision"),
            warnings = warnings,
        )
    }

    private fun decodeRenderFailure(payload: JsonObject): MosaicPreviewRenderFailurePayload {
        payload.expectKeys(setOf("clientId", "editableDocumentId", "revision", "failure"), "$.payload")
        return MosaicPreviewRenderFailurePayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            revision = decodeRevision(payload.required("revision", "$.payload"), "$.payload.revision"),
            failure = decodeRenderDiagnostic(payload.required("failure", "$.payload"), "$.payload.failure"),
        )
    }

    private fun decodeMockCommerceChanged(payload: JsonObject): MosaicPreviewMockCommerceStateChangedPayload {
        payload.expectKeys(setOf("editableDocumentId", "stateRevision", "state"), "$.payload")
        return MosaicPreviewMockCommerceStateChangedPayload(
            editableDocumentId = payload.requiredDocumentId(
                "editableDocumentId",
                "$.payload.editableDocumentId",
            ),
            stateRevision = decodeRevision(
                payload.required("stateRevision", "$.payload"),
                "$.payload.stateRevision",
            ),
            state = decodeCommerceState(payload.required("state", "$.payload"), "$.payload.state"),
        )
    }

    private fun decodeHeartbeat(payload: JsonObject): MosaicPreviewHeartbeatPayload {
        payload.expectKeys(setOf("clientId", "kind", "sequence"), "$.payload")
        val kindValue = payload.requiredString("kind", "$.payload.kind")
        return MosaicPreviewHeartbeatPayload(
            clientId = payload.requiredClientId("clientId", "$.payload.clientId"),
            kind = MosaicPreviewHeartbeatKind.fromWireName(kindValue)
                ?: throw MosaicPreviewCodecException("Invalid heartbeat kind at $.payload.kind."),
            sequence = payload.requiredInteger("sequence", "$.payload.sequence", 0..Int.MAX_VALUE),
        )
    }

    private fun decodeClientIdentity(value: JsonElement, path: String): MosaicPreviewClientIdentity {
        val identity = value.objectAt(path)
        identity.expectKeys(setOf("clientId", "displayName", "renderer", "application", "device"), path)
        val renderer = identity.required("renderer", path).objectAt("$path.renderer")
        renderer.expectKeys(setOf("id", "version"), "$path.renderer")
        val application = identity.required("application", path).objectAt("$path.application")
        application.expectKeys(setOf("id", "displayName", "version"), "$path.application")
        val device = identity.required("device", path).objectAt("$path.device")
        device.expectKeys(setOf("displayName", "systemName", "systemVersion"), "$path.device")
        return MosaicPreviewClientIdentity(
            clientId = identity.requiredClientId("clientId", "$path.clientId"),
            displayName = identity.requiredSafeDisplayName("displayName", "$path.displayName"),
            renderer = MosaicPreviewSoftwareIdentity(
                id = renderer.requiredMachineIdentifier("id", "$path.renderer.id"),
                version = renderer.requiredSemanticVersion("version", "$path.renderer.version"),
            ),
            application = MosaicPreviewApplicationIdentity(
                id = application.requiredMachineIdentifier("id", "$path.application.id"),
                displayName = application.requiredSafeDisplayName("displayName", "$path.application.displayName"),
                version = application.requiredSingleLine("version", "$path.application.version", 1, 64),
            ),
            device = MosaicPreviewDeviceIdentity(
                displayName = device.requiredSafeDisplayName("displayName", "$path.device.displayName"),
                systemName = device.requiredSafeDisplayName("systemName", "$path.device.systemName"),
                systemVersion = device.requiredSingleLine("systemVersion", "$path.device.systemVersion", 1, 64),
            ),
        )
    }

    private fun decodeRevision(value: JsonElement, path: String): MosaicLocalRevision {
        val revision = value.objectAt(path)
        revision.expectKeys(setOf("revisionId", "sequence"), path)
        return MosaicLocalRevision(
            revisionId = revision.requiredPatternString(
                "revisionId",
                "$path.revisionId",
                10,
                100,
                revisionIdPattern,
            ),
            sequence = revision.requiredInteger("sequence", "$path.sequence", 1..Int.MAX_VALUE),
        )
    }

    private fun decodeSupportedCapability(value: JsonElement, path: String): MosaicPreviewSupportedCapability {
        val capability = value.objectAt(path)
        capability.expectKeys(setOf("name", "version"), path)
        return MosaicPreviewSupportedCapability(
            name = capability.requiredMachineIdentifier("name", "$path.name"),
            version = capability.requiredSemanticVersion("version", "$path.version"),
        )
    }

    private fun decodeRecovery(value: JsonElement, path: String): MosaicPreviewRecoveryAction {
        val recovery = value.objectAt(path)
        recovery.expectKeys(setOf("action", "message"), path)
        val actionValue = recovery.requiredString("action", "$path.action")
        return MosaicPreviewRecoveryAction(
            action = MosaicPreviewRecoveryActionName.fromWireName(actionValue)
                ?: throw MosaicPreviewCodecException("Invalid recovery action at $path.action."),
            message = recovery.required("message", path).safeTextAt("$path.message"),
        )
    }

    private fun decodeLocation(value: JsonElement, path: String): MosaicPreviewDiagnosticLocation {
        val location = value.objectAt(path)
        location.expectKeys(
            setOf("documentPath", "componentId", "property"),
            path,
            optional = setOf("componentId", "property"),
        )
        return MosaicPreviewDiagnosticLocation(
            documentPath = location.requiredPatternString(
                "documentPath",
                "$path.documentPath",
                0,
                512,
                jsonPointerPattern,
            ),
            componentId = location.optional("componentId")?.patternStringAt(
                "$path.componentId",
                1,
                128,
                componentIdPattern,
            ),
            property = location.optional("property")?.patternStringAt(
                "$path.property",
                1,
                128,
                propertyPattern,
            ),
        )
    }

    private fun decodeValidationDiagnostic(
        value: JsonElement,
        path: String,
    ): MosaicPreviewValidationDiagnostic {
        val diagnostic = value.objectAt(path)
        diagnostic.expectKeys(setOf("code", "message", "location", "recovery"), path)
        return MosaicPreviewValidationDiagnostic(
            code = diagnostic.requiredPatternString(
                "code",
                "$path.code",
                3,
                96,
                diagnosticCodePattern,
            ),
            message = diagnostic.required("message", path).safeTextAt("$path.message"),
            location = decodeLocation(diagnostic.required("location", path), "$path.location"),
            recovery = decodeRecovery(diagnostic.required("recovery", path), "$path.recovery"),
        )
    }

    private fun decodeCompatibilityWarning(
        value: JsonElement,
        path: String,
    ): MosaicPreviewCompatibilityWarning {
        val warning = value.objectAt(path)
        warning.expectKeys(
            setOf("code", "severity", "message", "location", "capability", "fallback", "recovery"),
            path,
            optional = setOf("location", "capability"),
        )
        val severityValue = warning.requiredString("severity", "$path.severity")
        val severity = MosaicPreviewWarningSeverity.fromWireName(severityValue)
            ?: throw MosaicPreviewCodecException("Invalid warning severity at $path.severity.")
        val fallbackValue = warning.requiredString("fallback", "$path.fallback")
        val fallback = MosaicPreviewFallback.fromWireName(fallbackValue)
            ?: throw MosaicPreviewCodecException("Invalid warning fallback at $path.fallback.")
        if (severity == MosaicPreviewWarningSeverity.BLOCKING &&
            fallback != MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT
        ) {
            throw MosaicPreviewCodecException("A blocking warning must keep the last accepted draft.")
        }
        return MosaicPreviewCompatibilityWarning(
            code = warning.requiredPatternString("code", "$path.code", 3, 96, diagnosticCodePattern),
            severity = severity,
            message = warning.required("message", path).safeTextAt("$path.message"),
            location = warning.optional("location")?.let { decodeLocation(it, "$path.location") },
            capability = warning.optional("capability")?.let {
                decodeSupportedCapability(it, "$path.capability")
            },
            fallback = fallback,
            recovery = decodeRecovery(warning.required("recovery", path), "$path.recovery"),
        )
    }

    private fun decodeRenderDiagnostic(value: JsonElement, path: String): MosaicPreviewRenderDiagnostic {
        val diagnostic = value.objectAt(path)
        diagnostic.expectKeys(
            setOf("code", "message", "location", "fallback", "recovery"),
            path,
            optional = setOf("location"),
        )
        val fallback = diagnostic.requiredString("fallback", "$path.fallback")
        if (fallback != MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT.wireName) {
            throw MosaicPreviewCodecException("A render failure must keep the last accepted draft.")
        }
        return MosaicPreviewRenderDiagnostic(
            code = diagnostic.requiredPatternString("code", "$path.code", 3, 96, diagnosticCodePattern),
            message = diagnostic.required("message", path).safeTextAt("$path.message"),
            location = diagnostic.optional("location")?.let { decodeLocation(it, "$path.location") },
            fallback = MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT,
            recovery = decodeRecovery(diagnostic.required("recovery", path), "$path.recovery"),
        )
    }

    private fun decodeCommerceState(value: JsonElement, path: String): MosaicPreviewMockCommerceState {
        val state = value.objectAt(path)
        state.expectKeys(setOf("products", "purchaseOutcome", "restoreOutcome", "entitlement"), path)
        val products = state.required("products", path).arrayAt("$path.products")
            .bounded(0, 50, "$path.products")
            .mapIndexed { index, product -> decodeMockProduct(product, "$path.products/$index") }
        val purchaseValue = state.requiredString("purchaseOutcome", "$path.purchaseOutcome")
        val restoreValue = state.requiredString("restoreOutcome", "$path.restoreOutcome")
        return MosaicPreviewMockCommerceState(
            products = products,
            purchaseOutcome = MosaicPreviewPurchaseOutcome.fromWireName(purchaseValue)
                ?: throw MosaicPreviewCodecException("Invalid purchase outcome at $path.purchaseOutcome."),
            restoreOutcome = MosaicPreviewRestoreOutcome.fromWireName(restoreValue)
                ?: throw MosaicPreviewCodecException("Invalid restore outcome at $path.restoreOutcome."),
            entitlement = decodeEntitlement(state.required("entitlement", path), "$path.entitlement"),
        )
    }

    private fun decodeMockProduct(value: JsonElement, path: String): MosaicPreviewMockProduct {
        val product = value.objectAt(path)
        val availability = product.requiredString("availability", "$path.availability")
        return when (availability) {
            "available" -> when (product.requiredString("kind", "$path.kind")) {
                "subscription" -> {
                    product.expectKeys(
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
                        optional = setOf("trialPeriod", "introductoryOffer"),
                    )
                    MosaicPreviewMockProduct.AvailableSubscription(
                        productReferenceId = product.requiredComponentId(
                            "productReferenceId",
                            "$path.productReferenceId",
                        ),
                        localizedPrice = product.requiredSafeDisplayName(
                            "localizedPrice",
                            "$path.localizedPrice",
                        ),
                        currencyCode = product.requiredPatternString(
                            "currencyCode",
                            "$path.currencyCode",
                            3,
                            3,
                            currencyPattern,
                        ),
                        billingPeriod = decodePeriod(product.required("billingPeriod", path), "$path.billingPeriod"),
                        trialPeriod = product.optional("trialPeriod")?.let {
                            decodePeriod(it, "$path.trialPeriod")
                        },
                        introductoryOffer = product.optional("introductoryOffer")?.let {
                            decodeIntroductoryOffer(it, "$path.introductoryOffer")
                        },
                    )
                }
                "nonConsumable" -> {
                    product.expectKeys(
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
                        productReferenceId = product.requiredComponentId(
                            "productReferenceId",
                            "$path.productReferenceId",
                        ),
                        localizedPrice = product.requiredSafeDisplayName(
                            "localizedPrice",
                            "$path.localizedPrice",
                        ),
                        currencyCode = product.requiredPatternString(
                            "currencyCode",
                            "$path.currencyCode",
                            3,
                            3,
                            currencyPattern,
                        ),
                    )
                }
                else -> throw MosaicPreviewCodecException("Invalid mock product kind at $path.kind.")
            }
            "unavailable" -> {
                product.expectKeys(setOf("productReferenceId", "availability", "reason"), path)
                val reasonValue = product.requiredString("reason", "$path.reason")
                MosaicPreviewMockProduct.Unavailable(
                    productReferenceId = product.requiredComponentId(
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
        val period = value.objectAt(path)
        period.expectKeys(setOf("unit", "value"), path)
        val unitValue = period.requiredString("unit", "$path.unit")
        return MosaicPreviewPeriod(
            unit = MosaicPreviewPeriodUnit.fromWireName(unitValue)
                ?: throw MosaicPreviewCodecException("Invalid mock period unit at $path.unit."),
            value = period.requiredInteger("value", "$path.value", 1..120),
        )
    }

    private fun decodeIntroductoryOffer(value: JsonElement, path: String): MosaicPreviewIntroductoryOffer {
        val offer = value.objectAt(path)
        offer.expectKeys(setOf("localizedPrice", "period", "cycles"), path)
        return MosaicPreviewIntroductoryOffer(
            localizedPrice = offer.requiredSafeDisplayName("localizedPrice", "$path.localizedPrice"),
            period = decodePeriod(offer.required("period", path), "$path.period"),
            cycles = offer.requiredInteger("cycles", "$path.cycles", 1..120),
        )
    }

    private fun decodeEntitlement(value: JsonElement, path: String): MosaicPreviewMockEntitlement {
        val entitlement = value.objectAt(path)
        return when (entitlement.requiredString("status", "$path.status")) {
            "none" -> {
                entitlement.expectKeys(setOf("status"), path)
                MosaicPreviewMockEntitlement.None
            }
            "active" -> {
                entitlement.expectKeys(setOf("status", "productReferenceId"), path)
                MosaicPreviewMockEntitlement.Active(
                    entitlement.requiredComponentId("productReferenceId", "$path.productReferenceId"),
                )
            }
            else -> throw MosaicPreviewCodecException("Invalid mock entitlement status at $path.status.")
        }
    }

    private fun encodePayload(payload: MosaicPreviewPayload): JsonObject = when (payload) {
        is MosaicPreviewClientConnectedPayload -> objectOf("client" to encodeClient(payload.client))
        is MosaicPreviewClientDisconnectedPayload -> objectOf(
            "clientId" to json(payload.clientId),
            "reason" to json(payload.reason.wireName),
            "diagnostic" to payload.diagnostic?.let(::json),
        )
        is MosaicPreviewCapabilityReportPayload -> objectOf(
            "clientId" to json(payload.clientId),
            "supportedSchemaVersions" to arrayOf(payload.supportedSchemaVersions.map(::json)),
            "supportedCapabilities" to arrayOf(payload.supportedCapabilities.map(::encodeCapability)),
            "previewCapabilities" to arrayOf(payload.previewCapabilities.map(::encodePreviewCapability)),
            "limits" to objectOf("maxDocumentBytes" to json(payload.limits.maxDocumentBytes)),
        )
        is MosaicPreviewDraftUpdatedPayload -> objectOf(
            "editableDocumentId" to json(payload.editableDocumentId),
            "revision" to encodeRevision(payload.revision),
            "document" to parseDocument(payload.documentJson),
            "preview" to objectOf(
                "locale" to json(payload.preview.locale),
                "textScale" to json(payload.preview.textScale),
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
            add("diagnostics", arrayOf(payload.diagnostics.map(::encodeValidationDiagnostic)))
        }
        is MosaicPreviewValidationErrorPayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply { add("errors", arrayOf(payload.errors.map(::encodeValidationDiagnostic))) }
        is MosaicPreviewRenderWarningPayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply { add("warnings", arrayOf(payload.warnings.map(::encodeWarning))) }
        is MosaicPreviewRenderFailurePayload -> revisionTarget(
            payload.clientId,
            payload.editableDocumentId,
            payload.revision,
        ).apply { add("failure", encodeRenderDiagnostic(payload.failure)) }
        is MosaicPreviewMockCommerceStateChangedPayload -> objectOf(
            "editableDocumentId" to json(payload.editableDocumentId),
            "stateRevision" to encodeRevision(payload.stateRevision),
            "state" to encodeCommerceState(payload.state),
        )
        is MosaicPreviewHeartbeatPayload -> objectOf(
            "clientId" to json(payload.clientId),
            "kind" to json(payload.kind.wireName),
            "sequence" to json(payload.sequence),
        )
    }

    private fun encodeClient(client: MosaicPreviewClientIdentity) = objectOf(
        "clientId" to json(client.clientId),
        "displayName" to json(client.displayName),
        "renderer" to objectOf(
            "id" to json(client.renderer.id),
            "version" to json(client.renderer.version),
        ),
        "application" to objectOf(
            "id" to json(client.application.id),
            "displayName" to json(client.application.displayName),
            "version" to json(client.application.version),
        ),
        "device" to objectOf(
            "displayName" to json(client.device.displayName),
            "systemName" to json(client.device.systemName),
            "systemVersion" to json(client.device.systemVersion),
        ),
    )

    private fun encodeCapability(capability: MosaicPreviewSupportedCapability) = objectOf(
        "name" to json(capability.name),
        "version" to json(capability.version),
    )

    private fun encodePreviewCapability(capability: MosaicPreviewCapability) = objectOf(
        "name" to json(capability.name.wireName),
        "version" to json(capability.version),
    )

    private fun encodeRevision(revision: MosaicLocalRevision) = objectOf(
        "revisionId" to json(revision.revisionId),
        "sequence" to json(revision.sequence),
    )

    private fun revisionTarget(clientId: String, documentId: String, revision: MosaicLocalRevision) =
        objectOf(
            "clientId" to json(clientId),
            "editableDocumentId" to json(documentId),
            "revision" to encodeRevision(revision),
        )

    private fun encodeRecovery(recovery: MosaicPreviewRecoveryAction) = objectOf(
        "action" to json(recovery.action.wireName),
        "message" to json(recovery.message),
    )

    private fun encodeLocation(location: MosaicPreviewDiagnosticLocation) = objectOf(
        "documentPath" to json(location.documentPath),
        "componentId" to location.componentId?.let(::json),
        "property" to location.property?.let(::json),
    )

    private fun encodeValidationDiagnostic(diagnostic: MosaicPreviewValidationDiagnostic) = objectOf(
        "code" to json(diagnostic.code),
        "message" to json(diagnostic.message),
        "location" to encodeLocation(diagnostic.location),
        "recovery" to encodeRecovery(diagnostic.recovery),
    )

    private fun encodeWarning(warning: MosaicPreviewCompatibilityWarning) = objectOf(
        "code" to json(warning.code),
        "severity" to json(warning.severity.wireName),
        "message" to json(warning.message),
        "location" to warning.location?.let(::encodeLocation),
        "capability" to warning.capability?.let(::encodeCapability),
        "fallback" to json(warning.fallback.wireName),
        "recovery" to encodeRecovery(warning.recovery),
    )

    private fun encodeRenderDiagnostic(diagnostic: MosaicPreviewRenderDiagnostic) = objectOf(
        "code" to json(diagnostic.code),
        "message" to json(diagnostic.message),
        "location" to diagnostic.location?.let(::encodeLocation),
        "fallback" to json(diagnostic.fallback.wireName),
        "recovery" to encodeRecovery(diagnostic.recovery),
    )

    private fun encodeCommerceState(state: MosaicPreviewMockCommerceState) = objectOf(
        "products" to arrayOf(state.products.map(::encodeMockProduct)),
        "purchaseOutcome" to json(state.purchaseOutcome.wireName),
        "restoreOutcome" to json(state.restoreOutcome.wireName),
        "entitlement" to when (val entitlement = state.entitlement) {
            MosaicPreviewMockEntitlement.None -> objectOf("status" to json("none"))
            is MosaicPreviewMockEntitlement.Active -> objectOf(
                "status" to json("active"),
                "productReferenceId" to json(entitlement.productReferenceId),
            )
        },
    )

    private fun encodeMockProduct(product: MosaicPreviewMockProduct): JsonObject = when (product) {
        is MosaicPreviewMockProduct.AvailableSubscription -> objectOf(
            "productReferenceId" to json(product.productReferenceId),
            "availability" to json("available"),
            "kind" to json("subscription"),
            "localizedPrice" to json(product.localizedPrice),
            "currencyCode" to json(product.currencyCode),
            "billingPeriod" to encodePeriod(product.billingPeriod),
            "trialPeriod" to product.trialPeriod?.let(::encodePeriod),
            "introductoryOffer" to product.introductoryOffer?.let {
                objectOf(
                    "localizedPrice" to json(it.localizedPrice),
                    "period" to encodePeriod(it.period),
                    "cycles" to json(it.cycles),
                )
            },
        )
        is MosaicPreviewMockProduct.AvailableNonConsumable -> objectOf(
            "productReferenceId" to json(product.productReferenceId),
            "availability" to json("available"),
            "kind" to json("nonConsumable"),
            "localizedPrice" to json(product.localizedPrice),
            "currencyCode" to json(product.currencyCode),
        )
        is MosaicPreviewMockProduct.Unavailable -> objectOf(
            "productReferenceId" to json(product.productReferenceId),
            "availability" to json("unavailable"),
            "reason" to json(product.reason.wireName),
        )
    }

    private fun encodePeriod(period: MosaicPreviewPeriod) = objectOf(
        "unit" to json(period.unit.wireName),
        "value" to json(period.value),
    )

    private fun parseDocument(source: String): JsonElement = try {
        JsonParser.parseString(source).also {
            if (!it.isJsonObject) throw MosaicPreviewCodecException("The preview document must be an object.")
        }
    } catch (error: MosaicPreviewCodecException) {
        throw error
    } catch (_: Exception) {
        throw MosaicPreviewCodecException("The preview document is not valid JSON.")
    }

    private fun objectOf(vararg entries: Pair<String, JsonElement?>): JsonObject = JsonObject().apply {
        entries.forEach { (key, value) -> if (value != null) add(key, value) }
    }

    private fun arrayOf(values: List<JsonElement>): JsonArray = JsonArray().apply {
        values.forEach(::add)
    }
    private fun json(value: String): JsonElement = com.google.gson.JsonPrimitive(value)
    private fun json(value: Number): JsonElement = com.google.gson.JsonPrimitive(value)

    private fun JsonObject.required(name: String, path: String): JsonElement = get(name)
        ?: throw MosaicPreviewCodecException("Missing property $name at $path.")

    private fun JsonObject.optional(name: String): JsonElement? = get(name)

    private fun JsonObject.requiredString(name: String, path: String): String =
        required(name, path.substringBeforeLast('.', path)).stringAt(path)

    private fun JsonObject.requiredPatternString(
        name: String,
        path: String,
        minLength: Int,
        maxLength: Int,
        pattern: Regex,
    ): String = required(name, path.substringBeforeLast('.', path))
        .patternStringAt(path, minLength, maxLength, pattern)

    private fun JsonObject.requiredSingleLine(
        name: String,
        path: String,
        minLength: Int,
        maxLength: Int,
    ): String = required(name, path.substringBeforeLast('.', path)).singleLineAt(path, minLength, maxLength)

    private fun JsonObject.requiredSafeDisplayName(name: String, path: String): String =
        requiredSingleLine(name, path, 1, 80)

    private fun JsonObject.requiredMachineIdentifier(name: String, path: String): String =
        requiredPatternString(name, path, 1, 128, machineIdentifierPattern)

    private fun JsonObject.requiredSemanticVersion(name: String, path: String): String =
        requiredPatternString(name, path, 1, 64, semanticVersionPattern)

    private fun JsonObject.requiredClientId(name: String, path: String): String =
        requiredPatternString(name, path, 8, 100, clientIdPattern)

    private fun JsonObject.requiredDocumentId(name: String, path: String): String =
        requiredPatternString(name, path, 10, 100, documentIdPattern)

    private fun JsonObject.requiredComponentId(name: String, path: String): String =
        requiredPatternString(name, path, 1, 128, componentIdPattern)

    private fun JsonObject.requiredInteger(name: String, path: String, range: IntRange): Int =
        required(name, path.substringBeforeLast('.', path)).integerAt(path, range)

    private fun JsonObject.requiredNumber(name: String, path: String, range: ClosedRange<Double>): Double =
        required(name, path.substringBeforeLast('.', path)).numberAt(path, range)

    private fun JsonElement.stringAt(path: String): String {
        if (!isJsonPrimitive || !asJsonPrimitive.isString) {
            throw MosaicPreviewCodecException("Expected a string at $path.")
        }
        return asString
    }

    private fun JsonElement.patternStringAt(
        path: String,
        minLength: Int,
        maxLength: Int,
        pattern: Regex,
    ): String = singleLineAt(path, minLength, maxLength).also {
        if (!pattern.matches(it)) throw MosaicPreviewCodecException("Invalid string value at $path.")
    }

    private fun JsonElement.singleLineAt(path: String, minLength: Int, maxLength: Int): String =
        stringAt(path).also {
            if (it.codePointCount(0, it.length) !in minLength..maxLength || '\r' in it || '\n' in it) {
                throw MosaicPreviewCodecException("Invalid string length or line break at $path.")
            }
        }

    private fun JsonElement.safeTextAt(path: String): String = singleLineAt(path, 1, 512)

    private fun JsonElement.semanticVersionAt(path: String): String =
        patternStringAt(path, 1, 64, semanticVersionPattern)

    private fun JsonElement.integerAt(path: String, range: IntRange): Int {
        if (!isJsonPrimitive || !asJsonPrimitive.isNumber) {
            throw MosaicPreviewCodecException("Expected an integer at $path.")
        }
        val decimal = runCatching { asBigDecimal }.getOrNull()
            ?: throw MosaicPreviewCodecException("Expected an integer at $path.")
        val normalized = decimal.stripTrailingZeros()
        if (normalized.scale() > 0 || decimal < BigDecimal(range.first) || decimal > BigDecimal(range.last)) {
            throw MosaicPreviewCodecException("Integer is outside its range at $path.")
        }
        return decimal.toInt()
    }

    private fun JsonElement.numberAt(path: String, range: ClosedRange<Double>): Double {
        if (!isJsonPrimitive || !asJsonPrimitive.isNumber) {
            throw MosaicPreviewCodecException("Expected a number at $path.")
        }
        val value = runCatching { asBigDecimal.toDouble() }.getOrNull()
            ?: throw MosaicPreviewCodecException("Expected a number at $path.")
        if (!value.isFinite() || value !in range) {
            throw MosaicPreviewCodecException("Number is outside its range at $path.")
        }
        return value
    }

    private fun JsonElement.objectAt(path: String): JsonObject {
        if (!isJsonObject) throw MosaicPreviewCodecException("Expected an object at $path.")
        return asJsonObject
    }

    private fun JsonElement.arrayAt(path: String): JsonArray {
        if (!isJsonArray) throw MosaicPreviewCodecException("Expected an array at $path.")
        return asJsonArray
    }

    private fun JsonArray.bounded(min: Int, max: Int, path: String): JsonArray = also {
        if (size() !in min..max) throw MosaicPreviewCodecException("Array size is outside its range at $path.")
    }

    private fun JsonObject.expectKeys(
        expected: Set<String>,
        path: String,
        optional: Set<String> = emptySet(),
    ) {
        val actual = keySet()
        val missing = (expected - optional) - actual
        val unknown = actual - expected
        if (missing.isNotEmpty()) {
            throw MosaicPreviewCodecException("Missing properties ${missing.sorted().joinToString()} at $path.")
        }
        if (unknown.isNotEmpty()) {
            throw MosaicPreviewCodecException("Unknown properties ${unknown.sorted().joinToString()} at $path.")
        }
    }

    private fun <T> requireUnique(values: List<T>, path: String) {
        if (values.distinct().size != values.size) {
            throw MosaicPreviewCodecException("Duplicate entries are not allowed at $path.")
        }
    }
}

class MosaicPreviewCodecException(message: String) : IllegalArgumentException(message)
