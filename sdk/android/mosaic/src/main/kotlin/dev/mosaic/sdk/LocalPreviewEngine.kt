package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Transport-independent Local Preview state machine.
 *
 * Document and commerce revisions are ordered independently. A rejected document advances the
 * highest-seen sequence but never replaces the last accepted render state.
 */
class MosaicLocalPreviewEngine(
    private val clientId: String,
    fallback: MosaicPaywallLoadResult,
    private val capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    private val maxDocumentBytes: Int = MOSAIC_LOCAL_PREVIEW_DEFAULT_MAX_DOCUMENT_BYTES,
) {
    private sealed interface DraftTerminal {
        data object Accepted : DraftTerminal
        data class Rejected(
            val reason: MosaicPreviewDraftRejectionReason,
            val diagnostics: List<MosaicPreviewValidationDiagnostic>,
        ) : DraftTerminal
    }

    private data class DraftRecord(
        val revision: MosaicLocalRevision,
        var terminal: DraftTerminal? = null,
    )

    private data class CommerceRecord(
        val revision: MosaicLocalRevision,
        val state: MosaicPreviewMockCommerceState,
    )

    private val fallbackRender = (fallback as? MosaicPaywallLoadResult.Loaded)?.document?.let { document ->
        MosaicPreviewRenderState(
            document = document,
            locale = document.localization.defaultLocale,
            textScale = 1f,
            isBundledFallback = true,
        )
    }
    private var lastAcceptedRender: MosaicPreviewRenderState? = fallbackRender
    private val drafts = mutableMapOf<String, DraftRecord>()
    private val commerce = mutableMapOf<String, CommerceRecord>()
    private val warningsByRevision = mutableMapOf<Pair<String, Int>, MutableList<MosaicPreviewCompatibilityWarning>>()
    private val reportedAssetWarnings = mutableSetOf<Triple<String, Int, String>>()
    private val reportedProductWarnings = mutableSetOf<Triple<String, Int, Int>>()

    val purchaseProvider = MosaicLocalPreviewPurchaseProvider()

    private val mutableState = MutableStateFlow(MosaicLocalPreviewState(render = fallbackRender))
    val state: StateFlow<MosaicLocalPreviewState> = mutableState.asStateFlow()

    @Synchronized
    fun updateConnection(status: MosaicPreviewConnectionStatus) {
        mutableState.value = mutableState.value.copy(connectionStatus = status)
    }

    @Synchronized
    fun recordConnectionDiagnostic(code: String, message: String) {
        recordDiagnostic(
            MosaicPreviewClientDiagnostic(
                code = code,
                message = sanitizeDiagnostic(message),
                kind = MosaicPreviewProblemKind.CONNECTION,
            ),
        )
    }

    @Synchronized
    fun process(message: MosaicPreviewMessage): List<MosaicPreviewPayload> = when (val payload = message.payload) {
        is MosaicPreviewDraftUpdatedPayload -> processDraft(payload)
        is MosaicPreviewMockCommerceStateChangedPayload -> {
            processCommerce(payload)
        }
        else -> emptyList()
    }

    @Synchronized
    fun confirmDraftIsLive(editableDocumentId: String, revision: MosaicLocalRevision): List<MosaicPreviewPayload> {
        val record = drafts[editableDocumentId] ?: return emptyList()
        if (record.revision != revision) return emptyList()
        if (record.terminal == DraftTerminal.Accepted) {
            return listOf(accepted(editableDocumentId, revision))
        }
        if (record.terminal != null) return emptyList()
        val render = mutableState.value.render
        if (render?.editableDocumentId != editableDocumentId || render.revision != revision) return emptyList()

        record.terminal = DraftTerminal.Accepted
        lastAcceptedRender = render.copy(isAwaitingAcknowledgement = false)
        mutableState.value = mutableState.value.copy(
            render = lastAcceptedRender,
            diagnostic = null,
        )
        val warnings = warningsByRevision.remove(editableDocumentId to revision.sequence).orEmpty()
        return buildList {
            if (warnings.isNotEmpty()) {
                add(
                    MosaicPreviewRenderWarningPayload(
                        clientId = clientId,
                        editableDocumentId = editableDocumentId,
                        revision = revision,
                        warnings = warnings,
                    ),
                )
            }
            add(accepted(editableDocumentId, revision))
        }
    }

    @Synchronized
    fun reportAssetFallback(componentId: String): List<MosaicPreviewPayload> {
        val render = mutableState.value.render ?: return emptyList()
        val documentId = render.editableDocumentId ?: return emptyList()
        val revision = render.revision ?: return emptyList()
        if (!reportedAssetWarnings.add(Triple(documentId, revision.sequence, componentId))) {
            return emptyList()
        }
        val warning = MosaicPreviewCompatibilityWarning(
            code = "render.assetFallback",
            severity = MosaicPreviewWarningSeverity.WARNING,
            message = "The bundled image was unavailable, so its declared placeholder is visible.",
            location = MosaicPreviewDiagnosticLocation(
                documentPath = componentPointer(render.document, componentId),
                componentId = componentId,
                property = "assetId",
            ),
            fallback = MosaicPreviewFallback.USE_DECLARED_ASSET_FALLBACK,
            recovery = MosaicPreviewRecoveryAction(
                MosaicPreviewRecoveryActionName.INSPECT_COMPONENT,
                "Check that the host application bundles the image key used by this component.",
            ),
        )
        return listOf(
            MosaicPreviewRenderWarningPayload(
                clientId = clientId,
                editableDocumentId = documentId,
                revision = revision,
                warnings = listOf(warning),
            ),
        )
    }

    @Synchronized
    fun reportRenderFailure(
        editableDocumentId: String,
        revision: MosaicLocalRevision,
    ): List<MosaicPreviewPayload> {
        val record = drafts[editableDocumentId] ?: return emptyList()
        if (record.revision != revision || record.terminal != null) return emptyList()
        val diagnostic = MosaicPreviewValidationDiagnostic(
            code = "render.failed",
            message = "The preview client could not render this revision.",
            location = MosaicPreviewDiagnosticLocation(documentPath = "/layout"),
            recovery = MosaicPreviewRecoveryAction(
                MosaicPreviewRecoveryActionName.RETRY,
                "Retry the revision or restore the last accepted draft.",
            ),
        )
        record.terminal = DraftTerminal.Rejected(
            MosaicPreviewDraftRejectionReason.RENDER_FAILED,
            listOf(diagnostic),
        )
        purchaseProvider.clear()
        mutableState.value = mutableState.value.copy(
            render = lastAcceptedRender,
            commerce = null,
            commerceRevision = null,
            diagnostic = MosaicPreviewClientDiagnostic(
                code = diagnostic.code,
                message = diagnostic.message,
                kind = MosaicPreviewProblemKind.RENDER_FAILURE,
            ),
        )
        lastAcceptedRender?.let(::applyCommerceForRender)
        return listOf(
            MosaicPreviewRenderFailurePayload(
                clientId = clientId,
                editableDocumentId = editableDocumentId,
                revision = revision,
                failure = MosaicPreviewRenderDiagnostic(
                    code = diagnostic.code,
                    message = diagnostic.message,
                    location = diagnostic.location,
                    fallback = MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT,
                    recovery = diagnostic.recovery,
                ),
            ),
            rejected(
                editableDocumentId,
                revision,
                MosaicPreviewDraftRejectionReason.RENDER_FAILED,
                listOf(diagnostic),
            ),
        )
    }

    @Synchronized
    private fun processDraft(payload: MosaicPreviewDraftUpdatedPayload): List<MosaicPreviewPayload> {
        val previous = drafts[payload.editableDocumentId]
        if (previous != null) {
            when {
                payload.revision.sequence < previous.revision.sequence -> {
                    val diagnostic = orderingDiagnostic(stale = true)
                    return listOf(
                        rejected(
                            payload.editableDocumentId,
                            payload.revision,
                            MosaicPreviewDraftRejectionReason.STALE_REVISION,
                            listOf(diagnostic),
                        ),
                    )
                }
                payload.revision.sequence == previous.revision.sequence &&
                    payload.revision.revisionId != previous.revision.revisionId -> {
                    val diagnostic = orderingDiagnostic(stale = false)
                    return listOf(
                        rejected(
                            payload.editableDocumentId,
                            payload.revision,
                            MosaicPreviewDraftRejectionReason.REVISION_CONFLICT,
                            listOf(diagnostic),
                        ),
                    )
                }
                payload.revision == previous.revision -> return when (val terminal = previous.terminal) {
                    DraftTerminal.Accepted -> listOf(accepted(payload.editableDocumentId, payload.revision))
                    is DraftTerminal.Rejected -> listOf(
                        rejected(
                            payload.editableDocumentId,
                            payload.revision,
                            terminal.reason,
                            terminal.diagnostics,
                        ),
                    )
                    null -> emptyList()
                }
            }
        }

        // Highest-seen advances before validation, as required by the frozen contract.
        val record = DraftRecord(payload.revision)
        drafts[payload.editableDocumentId] = record
        return when (val validation = validateDraft(payload)) {
            is DraftValidation.Valid -> {
                val render = MosaicPreviewRenderState(
                    document = validation.document,
                    editableDocumentId = payload.editableDocumentId,
                    revision = payload.revision,
                    locale = payload.preview.locale,
                    textScale = payload.preview.textScale,
                    isBundledFallback = false,
                    isAwaitingAcknowledgement = true,
                )
                mutableState.value = mutableState.value.copy(render = render, diagnostic = null)
                applyCommerceForRender(render)
                emptyList()
            }
            is DraftValidation.Rejected -> {
                record.terminal = DraftTerminal.Rejected(validation.reason, validation.diagnostics)
                val problem = MosaicPreviewClientDiagnostic(
                    code = validation.diagnostics.first().code,
                    message = validation.diagnostics.first().message,
                    kind = validation.problemKind,
                    componentId = validation.diagnostics.first().location.componentId,
                    property = validation.diagnostics.first().location.property,
                )
                recordDiagnostic(problem)
                buildList {
                    validation.warning?.let {
                        add(
                            MosaicPreviewRenderWarningPayload(
                                clientId = clientId,
                                editableDocumentId = payload.editableDocumentId,
                                revision = payload.revision,
                                warnings = listOf(it),
                            ),
                        )
                    }
                    add(
                        MosaicPreviewValidationErrorPayload(
                            clientId = clientId,
                            editableDocumentId = payload.editableDocumentId,
                            revision = payload.revision,
                            errors = validation.diagnostics,
                        ),
                    )
                    add(
                        rejected(
                            payload.editableDocumentId,
                            payload.revision,
                            validation.reason,
                            validation.diagnostics,
                        ),
                    )
                }
            }
        }
    }

    @Synchronized
    private fun processCommerce(
        payload: MosaicPreviewMockCommerceStateChangedPayload,
    ): List<MosaicPreviewPayload> {
        val previous = commerce[payload.editableDocumentId]
        if (previous != null) {
            when {
                payload.stateRevision.sequence < previous.revision.sequence -> {
                    recordDiagnostic(
                        MosaicPreviewClientDiagnostic(
                            code = "preview.staleCommerceRevision",
                            message = "The preview client already received a newer mock commerce revision.",
                            kind = MosaicPreviewProblemKind.MOCK_COMMERCE,
                        ),
                    )
                    return emptyList()
                }
                payload.stateRevision.sequence == previous.revision.sequence &&
                    payload.stateRevision.revisionId != previous.revision.revisionId -> {
                    recordDiagnostic(
                        MosaicPreviewClientDiagnostic(
                            code = "preview.commerceRevisionConflict",
                            message = "The mock commerce revision conflicts with one already received.",
                            kind = MosaicPreviewProblemKind.MOCK_COMMERCE,
                        ),
                    )
                    return emptyList()
                }
                payload.stateRevision == previous.revision -> return emptyList()
            }
        }
        commerce[payload.editableDocumentId] = CommerceRecord(payload.stateRevision, payload.state)
        val render = mutableState.value.render
        return if (render?.editableDocumentId == payload.editableDocumentId) {
            applyCommerceForRender(render)
        } else {
            emptyList()
        }
    }

    private fun applyCommerceForRender(render: MosaicPreviewRenderState): List<MosaicPreviewPayload> {
        val documentId = render.editableDocumentId ?: return emptyList()
        val record = commerce[documentId] ?: run {
            purchaseProvider.clear()
            mutableState.value = mutableState.value.copy(commerce = null, commerceRevision = null)
            return emptyList()
        }
        val references = render.document.products.map(MosaicProductReference::id).toSet()
        val received = record.state.products.map(MosaicPreviewMockProduct::productReferenceId)
        val entitlementReference = (record.state.entitlement as? MosaicPreviewMockEntitlement.Active)
            ?.productReferenceId
        if (received.size != received.toSet().size || received.toSet() != references ||
            entitlementReference?.let { it !in references } == true
        ) {
            purchaseProvider.clear()
            recordDiagnostic(
                MosaicPreviewClientDiagnostic(
                    code = "preview.invalidMockCommerce",
                    message = "Mock products must match every product bound by the current document.",
                    kind = MosaicPreviewProblemKind.MOCK_COMMERCE,
                    property = "products",
                ),
            )
            return emptyList()
        }
        purchaseProvider.update(render.document, record.state)
        mutableState.value = mutableState.value.copy(
            commerceRevision = record.revision,
            commerce = record.state,
        )
        val unavailable = record.state.products.filterIsInstance<MosaicPreviewMockProduct.Unavailable>()
        if (unavailable.isNotEmpty() && render.revision != null &&
            reportedProductWarnings.add(
                Triple(documentId, render.revision.sequence, record.revision.sequence),
            )
        ) {
            val warning = MosaicPreviewCompatibilityWarning(
                code = "render.productFallback",
                severity = MosaicPreviewWarningSeverity.WARNING,
                message = "One or more mock products are unavailable, so selector fallback is active.",
                fallback = MosaicPreviewFallback.USE_SELECTOR_FALLBACK,
                recovery = MosaicPreviewRecoveryAction(
                    MosaicPreviewRecoveryActionName.BIND_PRODUCT,
                    "Choose an available mock product or update its preview state.",
                ),
            )
            if (render.isAwaitingAcknowledgement) {
                warningsByRevision.getOrPut(documentId to render.revision.sequence) { mutableListOf() }
                    .add(warning)
            } else {
                return listOf(
                    MosaicPreviewRenderWarningPayload(
                        clientId = clientId,
                        editableDocumentId = documentId,
                        revision = render.revision,
                        warnings = listOf(warning),
                    ),
                )
            }
        }
        return emptyList()
    }

    private sealed interface DraftValidation {
        data class Valid(val document: MosaicPaywallDocument) : DraftValidation
        data class Rejected(
            val reason: MosaicPreviewDraftRejectionReason,
            val diagnostics: List<MosaicPreviewValidationDiagnostic>,
            val problemKind: MosaicPreviewProblemKind,
            val warning: MosaicPreviewCompatibilityWarning? = null,
        ) : DraftValidation
    }

    private fun validateDraft(payload: MosaicPreviewDraftUpdatedPayload): DraftValidation {
        if (payload.documentJson.toByteArray(Charsets.UTF_8).size > maxDocumentBytes) {
            return rejectedValidation(
                reason = MosaicPreviewDraftRejectionReason.DOCUMENT_TOO_LARGE,
                code = "validation.documentTooLarge",
                message = "The paywall document exceeds this preview client's size limit.",
                recovery = MosaicPreviewRecoveryActionName.RESTORE_LAST_VALID_DRAFT,
            )
        }
        val root = runCatching { JsonParser.parseString(payload.documentJson).asJsonObject }.getOrNull()
            ?: return rejectedValidation(
                reason = MosaicPreviewDraftRejectionReason.VALIDATION_FAILED,
                code = "validation.invalidDocument",
                message = "The paywall document is not a valid JSON object.",
                recovery = MosaicPreviewRecoveryActionName.RESTORE_LAST_VALID_DRAFT,
            )

        val schemaVersion = root.stringProperty("schemaVersion")
        if (schemaVersion != MOSAIC_PROTOCOL_VERSION ||
            schemaVersion !in capabilityReport.supportedSchemaVersions
        ) {
            val diagnostic = validationDiagnostic(
                code = "compatibility.unsupportedSchemaVersion",
                message = "This preview client does not support the document schema version.",
                pointer = "/schemaVersion",
                property = "schemaVersion",
                recovery = MosaicPreviewRecoveryActionName.SELECT_SUPPORTED_TEMPLATE,
            )
            return DraftValidation.Rejected(
                reason = MosaicPreviewDraftRejectionReason.UNSUPPORTED_SCHEMA_VERSION,
                diagnostics = listOf(diagnostic),
                problemKind = MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT,
                warning = blockingWarning(
                    diagnostic,
                    capability = null,
                    recovery = MosaicPreviewRecoveryActionName.UPDATE_PREVIEW_CLIENT,
                ),
            )
        }

        findUnsupportedCapability(root)?.let { capability ->
            val diagnostic = validationDiagnostic(
                code = "compatibility.unsupportedCapability",
                message = "This preview client does not support a capability required by the document.",
                pointer = capability.pointer,
                property = "name",
                recovery = MosaicPreviewRecoveryActionName.UPDATE_PREVIEW_CLIENT,
            )
            return DraftValidation.Rejected(
                reason = MosaicPreviewDraftRejectionReason.UNSUPPORTED_CAPABILITY,
                diagnostics = listOf(diagnostic),
                problemKind = MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT,
                warning = blockingWarning(
                    diagnostic,
                    MosaicPreviewSupportedCapability(capability.name, capability.version),
                    MosaicPreviewRecoveryActionName.UPDATE_PREVIEW_CLIENT,
                ),
            )
        }

        findUnknownComponent(root)?.let { issue ->
            val diagnostic = validationDiagnostic(
                code = "compatibility.unsupportedComponent",
                message = "This preview client cannot render the affected component.",
                pointer = issue.pointer,
                componentId = issue.componentId,
                property = "type",
                recovery = MosaicPreviewRecoveryActionName.REMOVE_COMPONENT,
            )
            return DraftValidation.Rejected(
                reason = MosaicPreviewDraftRejectionReason.UNSUPPORTED_CAPABILITY,
                diagnostics = listOf(diagnostic),
                problemKind = MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT,
                warning = blockingWarning(
                    diagnostic,
                    MosaicPreviewSupportedCapability("component.${issue.type}", MOSAIC_PROTOCOL_VERSION),
                    MosaicPreviewRecoveryActionName.REMOVE_COMPONENT,
                ),
            )
        }

        findInvalidReference(root)?.let { issue ->
            return DraftValidation.Rejected(
                reason = MosaicPreviewDraftRejectionReason.VALIDATION_FAILED,
                diagnostics = listOf(
                    validationDiagnostic(
                        code = "validation.invalidReference",
                        message = issue.message,
                        pointer = issue.pointer,
                        componentId = issue.componentId,
                        property = issue.property,
                        recovery = MosaicPreviewRecoveryActionName.EDIT_PROPERTY,
                    ),
                ),
                problemKind = MosaicPreviewProblemKind.INVALID_DOCUMENT,
            )
        }

        return try {
            DraftValidation.Valid(MosaicProtocolDecoder.decode(payload.documentJson, capabilityReport))
        } catch (error: MosaicProtocolException) {
            val pointer = protocolPathToPointer(error.message.orEmpty())
            val location = locateComponent(root, pointer)
            val code = when {
                error.message.orEmpty().contains("Unknown properties") -> "validation.unknownProperty"
                error.message.orEmpty().contains("references an unknown") -> "validation.invalidReference"
                error.message.orEmpty().contains("Unsupported component") -> "compatibility.unsupportedComponent"
                else -> "validation.invalidDocument"
            }
            DraftValidation.Rejected(
                reason = MosaicPreviewDraftRejectionReason.VALIDATION_FAILED,
                diagnostics = listOf(
                    validationDiagnostic(
                        code = code,
                        message = when (code) {
                            "validation.unknownProperty" -> "The document contains an unsupported property."
                            "validation.invalidReference" -> "The component references an undeclared item."
                            else -> "The paywall document does not satisfy Protocol 0.1."
                        },
                        pointer = pointer,
                        componentId = location.componentId,
                        property = location.property,
                        recovery = MosaicPreviewRecoveryActionName.EDIT_PROPERTY,
                    ),
                ),
                problemKind = if (code == "compatibility.unsupportedComponent") {
                    MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT
                } else {
                    MosaicPreviewProblemKind.INVALID_DOCUMENT
                },
            )
        }
    }

    private fun rejectedValidation(
        reason: MosaicPreviewDraftRejectionReason,
        code: String,
        message: String,
        recovery: MosaicPreviewRecoveryActionName,
    ) = DraftValidation.Rejected(
        reason = reason,
        diagnostics = listOf(validationDiagnostic(code, message, "", recovery = recovery)),
        problemKind = MosaicPreviewProblemKind.INVALID_DOCUMENT,
    )

    private data class CapabilityIssue(val name: String, val version: String, val pointer: String)

    private fun findUnsupportedCapability(root: JsonObject): CapabilityIssue? {
        val values = root.getAsJsonObject("compatibility")
            ?.getAsJsonArray("requiredCapabilities") ?: return null
        val supported = capabilityReport.supportedCapabilities.mapKeys { it.key.wireName }
        values.forEachIndexed { index, value ->
            val item = value.takeIf(JsonElement::isJsonObject)?.asJsonObject ?: return@forEachIndexed
            val name = item.stringProperty("name") ?: return@forEachIndexed
            val version = item.stringProperty("version") ?: return@forEachIndexed
            val capabilityName = MosaicCapabilityName.entries.firstOrNull { it.wireName == name }
            if (capabilityName == null || supported[name] != version) {
                return CapabilityIssue(name, version, "/compatibility/requiredCapabilities/$index/name")
            }
        }
        return null
    }

    private data class ComponentIssue(val type: String, val componentId: String?, val pointer: String)
    private val supportedComponentTypes = setOf(
        "verticalStack",
        "text",
        "image",
        "featureList",
        "productSelector",
        "purchaseButton",
        "restoreButton",
        "closeButton",
        "legalText",
    )

    private fun findUnknownComponent(root: JsonObject): ComponentIssue? {
        val content = root.getAsJsonObject("layout")?.getAsJsonObject("content") ?: return null
        fun walk(node: JsonObject, pointer: String): ComponentIssue? {
            val type = node.stringProperty("type") ?: return null
            if (type !in supportedComponentTypes) {
                return ComponentIssue(type, node.stringProperty("id"), "$pointer/type")
            }
            if (type == "verticalStack") {
                node.getAsJsonArray("children")?.forEachIndexed { index, child ->
                    if (child.isJsonObject) walk(child.asJsonObject, "$pointer/children/$index")?.let { return it }
                }
            }
            return null
        }
        return walk(content, "/layout/content")
    }

    private data class ReferenceIssue(
        val message: String,
        val pointer: String,
        val componentId: String?,
        val property: String,
    )

    private fun findInvalidReference(root: JsonObject): ReferenceIssue? {
        val productIds = root.getAsJsonArray("products")?.mapNotNull {
            it.takeIf(JsonElement::isJsonObject)?.asJsonObject?.stringProperty("id")
        }?.toSet().orEmpty()
        val assetIds = root.getAsJsonArray("assets")?.mapNotNull {
            it.takeIf(JsonElement::isJsonObject)?.asJsonObject?.stringProperty("id")
        }?.toSet().orEmpty()
        val selectorIds = mutableSetOf<String>()
        val nodes = mutableListOf<Pair<JsonObject, String>>()
        val content = root.getAsJsonObject("layout")?.getAsJsonObject("content")
        fun collect(node: JsonObject, pointer: String) {
            nodes += node to pointer
            if (node.stringProperty("type") == "productSelector") {
                node.stringProperty("id")?.let(selectorIds::add)
            }
            if (node.stringProperty("type") == "verticalStack") {
                node.getAsJsonArray("children")?.forEachIndexed { index, child ->
                    if (child.isJsonObject) collect(child.asJsonObject, "$pointer/children/$index")
                }
            }
        }
        if (content != null) collect(content, "/layout/content")
        nodes.forEach { (node, pointer) ->
            val id = node.stringProperty("id")
            when (node.stringProperty("type")) {
                "productSelector" -> node.getAsJsonArray("productReferenceIds")?.forEachIndexed { index, value ->
                    val reference = value.takeIf(JsonElement::isJsonPrimitive)?.asString
                    if (reference != null && reference !in productIds) {
                        return ReferenceIssue(
                            "This product selector references an undeclared product.",
                            "$pointer/productReferenceIds/$index",
                            id,
                            "productReferenceIds",
                        )
                    }
                }
                "image" -> node.stringProperty("assetId")?.takeIf { it !in assetIds }?.let {
                    return ReferenceIssue(
                        "This image references an undeclared asset.",
                        "$pointer/assetId",
                        id,
                        "assetId",
                    )
                }
                "purchaseButton" -> node.getAsJsonObject("action")?.stringProperty("productSelectorId")
                    ?.takeIf { it !in selectorIds }?.let {
                        return ReferenceIssue(
                            "This purchase action references an undeclared product selector.",
                            "$pointer/action/productSelectorId",
                            id,
                            "productSelectorId",
                        )
                    }
            }
        }
        return null
    }

    private data class LocatedComponent(val componentId: String?, val property: String?)

    private fun locateComponent(root: JsonObject, pointer: String): LocatedComponent {
        if (pointer.isEmpty()) return LocatedComponent(null, null)
        val segments = pointer.split('/').drop(1).map { it.replace("~1", "/").replace("~0", "~") }
        var current: JsonElement = root
        var componentId: String? = null
        segments.dropLast(1).forEach { segment ->
            current = when {
                current.isJsonObject -> current.asJsonObject.get(segment) ?: return@forEach
                current.isJsonArray -> segment.toIntOrNull()?.let(current.asJsonArray::get) ?: return@forEach
                else -> return@forEach
            }
            if (current.isJsonObject) current.asJsonObject.stringProperty("id")?.let { componentId = it }
        }
        val property = segments.lastOrNull()?.takeIf { it.matches(Regex("^[A-Za-z][A-Za-z0-9]*$")) }
            ?: segments.dropLast(1).lastOrNull()?.takeIf { it.matches(Regex("^[A-Za-z][A-Za-z0-9]*$")) }
        return LocatedComponent(componentId, property)
    }

    private fun protocolPathToPointer(message: String): String {
        val start = message.lastIndexOf("$.")
        if (start < 0) return ""
        var path = message.substring(start + 1).removeSuffix(".")
        path = path.replace(Regex("\\[([0-9]+)]"), "/$1")
        path = path.replace('.', '/')
        return path.takeIf { it.startsWith('/') } ?: ""
    }

    private fun componentPointer(document: MosaicPaywallDocument, componentId: String): String {
        fun walk(stack: MosaicVerticalStack, pointer: String): String? {
            stack.children.forEachIndexed { index, node ->
                val childPointer = "$pointer/children/$index"
                if (node.id == componentId) return childPointer
                if (node is MosaicVerticalStack) walk(node, childPointer)?.let { return it }
            }
            return null
        }
        return walk(document.layout.content, "/layout/content") ?: "/layout"
    }

    private fun blockingWarning(
        diagnostic: MosaicPreviewValidationDiagnostic,
        capability: MosaicPreviewSupportedCapability?,
        recovery: MosaicPreviewRecoveryActionName,
    ) = MosaicPreviewCompatibilityWarning(
        code = diagnostic.code,
        severity = MosaicPreviewWarningSeverity.BLOCKING,
        message = diagnostic.message,
        location = diagnostic.location,
        capability = capability,
        fallback = MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT,
        recovery = MosaicPreviewRecoveryAction(
            recovery,
            diagnostic.recovery.message,
        ),
    )

    private fun validationDiagnostic(
        code: String,
        message: String,
        pointer: String,
        componentId: String? = null,
        property: String? = null,
        recovery: MosaicPreviewRecoveryActionName,
    ) = MosaicPreviewValidationDiagnostic(
        code = code,
        message = message,
        location = MosaicPreviewDiagnosticLocation(pointer, componentId, property),
        recovery = MosaicPreviewRecoveryAction(
            recovery,
            when (recovery) {
                MosaicPreviewRecoveryActionName.REMOVE_COMPONENT ->
                    "Remove the unsupported component or choose a supported block."
                MosaicPreviewRecoveryActionName.UPDATE_PREVIEW_CLIENT ->
                    "Update the preview client or remove the unsupported capability."
                MosaicPreviewRecoveryActionName.SELECT_SUPPORTED_TEMPLATE ->
                    "Choose a template that uses Protocol 0.1."
                MosaicPreviewRecoveryActionName.RESTORE_LAST_VALID_DRAFT ->
                    "Keep the last valid preview and send a corrected increasing revision."
                else -> "Select the affected component and correct the highlighted property."
            },
        ),
    )

    private fun orderingDiagnostic(stale: Boolean) = if (stale) {
        validationDiagnostic(
            code = "preview.staleRevision",
            message = "The preview client already received a newer revision.",
            pointer = "",
            recovery = MosaicPreviewRecoveryActionName.RESTORE_LAST_VALID_DRAFT,
        )
    } else {
        validationDiagnostic(
            code = "preview.revisionConflict",
            message = "This sequence conflicts with a revision already received by the preview client.",
            pointer = "",
            recovery = MosaicPreviewRecoveryActionName.RESTORE_LAST_VALID_DRAFT,
        )
    }

    private fun accepted(documentId: String, revision: MosaicLocalRevision) =
        MosaicPreviewDraftAcceptedPayload(clientId, documentId, revision)

    private fun rejected(
        documentId: String,
        revision: MosaicLocalRevision,
        reason: MosaicPreviewDraftRejectionReason,
        diagnostics: List<MosaicPreviewValidationDiagnostic>,
    ) = MosaicPreviewDraftRejectedPayload(clientId, documentId, revision, reason, diagnostics)

    private fun recordDiagnostic(diagnostic: MosaicPreviewClientDiagnostic) {
        val recent = (listOf(diagnostic) + mutableState.value.recentDiagnostics).take(10)
        mutableState.value = mutableState.value.copy(
            diagnostic = diagnostic,
            recentDiagnostics = recent,
        )
    }

    private fun sanitizeDiagnostic(message: String): String = message
        .replace('\r', ' ')
        .replace('\n', ' ')
        .take(512)
        .ifBlank { "The local preview connection needs attention." }

    private fun JsonObject.stringProperty(name: String): String? = get(name)?.takeIf {
        it.isJsonPrimitive && it.asJsonPrimitive.isString
    }?.asString
}
