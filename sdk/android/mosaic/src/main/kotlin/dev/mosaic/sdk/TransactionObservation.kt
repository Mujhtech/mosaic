package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser

/**
 * Optional, opt-in Transaction Observation handoff (Billing Ingestion Contract 1).
 *
 * A Transaction Observation is a *trigger*, never proof. The SDK reports a bounded provider
 * reference so Mosaic's server can start its own validation with its own credentials sooner than a
 * store notification would arrive. Nothing in this file can claim, imply, or be read as a validated
 * transaction: there is deliberately no result member named validated, verified or confirmed, and a
 * submission outcome never changes a local [MosaicPurchaseResult].
 *
 * The frozen contract under `protocol/schema/billing-ingestion/v1/` is the authority for both the
 * request and the response record; the canonical fixture
 * `protocol/fixtures/billing-ingestion/v1/google-client-observation.json` is asserted verbatim.
 *
 * What is structurally impossible to carry here: a Google Play purchase token, `originalJson`, a
 * purchase signature, obfuscated account or profile identifiers, any credential, and any
 * client-asserted Store Environment — classification is a server-side decision made from verified
 * provider metadata, and the contract rejects a client observation that asserts one.
 */
sealed interface MosaicTransactionObservationResult {
    /** The observation is well formed and queued for server-side validation. Nothing more. */
    data object AcceptedForValidation : MosaicTransactionObservationResult

    /** The identical submission was already recorded. Idempotent, not an error. */
    data object Duplicate : MosaicTransactionObservationResult

    /** Resubmitting the identical document cannot succeed. */
    data class PermanentlyRejected(val code: String) : MosaicTransactionObservationResult

    /** Transient. The identical document is resubmitted later from the durable queue. */
    data class RetryableFailure(
        val code: String,
        val retryAfterSeconds: Int? = null,
    ) : MosaicTransactionObservationResult
}

internal const val MOSAIC_BILLING_INGESTION_CONTRACT_VERSION = "1"
internal const val MOSAIC_RECORD_CLIENT_OBSERVATION = "clientTransactionObservation"
internal const val MOSAIC_RECORD_SUBMISSION_RESULT = "observationSubmissionResult"

/** Reference kinds for the Google Play token digest and order handle, frozen by the contract. */
internal const val MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST = "google_play_token_digest"
internal const val MOSAIC_REFERENCE_GOOGLE_PLAY_ORDER_ID = "google_play_order_id"
internal const val MOSAIC_STORE_PLATFORM_GOOGLE_PLAY = "google_play"

/**
 * The only authority a client may ever assert. It is emitted by the codec rather than carried as a
 * settable field, so no call site can raise this SDK's authority above an untrusted observation.
 */
internal const val MOSAIC_SOURCE_AUTHORITY_CLIENT = "client_observation"

/** SDK context, mirroring the Analytics Event context vocabulary. It carries no tenant identity. */
internal data class MosaicTransactionObservationContext(
    val platform: String = "android",
    val sdkFamily: String = "android",
    val sdkVersion: String = MOSAIC_ANDROID_SDK_VERSION,
    val applicationVersion: String? = null,
    val operatingSystemVersion: String? = null,
)

/** Correlation to Analytics Events uses the existing opaque handles only. */
internal data class MosaicTransactionObservationCorrelation(
    val purchaseAttemptId: String? = null,
    val providerUpdateId: String? = null,
) {
    val isEmpty: Boolean get() = purchaseAttemptId == null && providerUpdateId == null
}

/**
 * One submittable observation. This is the complete set of values that ever leaves the device for
 * this feature; there is no free-form field, no provider payload, and no host-supplied text.
 */
internal data class MosaicTransactionObservation(
    /** Stable record identity, generated once and persisted; unchanged across every retry. */
    val observationId: String,
    /** Deterministic deduplication key, derived from the reference and the outcome. */
    val submissionId: String,
    val providerId: String,
    val referenceKind: String,
    val reference: String,
    val providerOrderReference: String? = null,
    val observedAt: String,
    val context: MosaicTransactionObservationContext,
    val correlation: MosaicTransactionObservationCorrelation? = null,
    /** A claim only. The server resolves the Mosaic Product independently. */
    val claimedMosaicProductId: String? = null,
    val storePlatform: String = MOSAIC_STORE_PLATFORM_GOOGLE_PLAY,
)

/** Bounds mirroring the frozen contract. Everything else is rejected before it can be queued. */
internal object MosaicTransactionObservationBounds {
    private val IDENTIFIER = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val GOOGLE_TOKEN_DIGEST = Regex("^[a-f0-9]{64}$")
    private val TIMESTAMP =
        Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$")
    private val VERSION = Regex("^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$")
    private val OPERATING_SYSTEM_VERSION = Regex("^[A-Za-z0-9][A-Za-z0-9.+_ -]{0,63}$")

    /** `providerOrderReference` value pattern; a purchase token cannot satisfy the 128 bound. */
    private val ORDER_REFERENCE = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

    fun isValidIdentifier(value: String): Boolean = IDENTIFIER.matches(value)

    fun isValidReference(referenceKind: String, value: String): Boolean = when (referenceKind) {
        MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST -> GOOGLE_TOKEN_DIGEST.matches(value)
        else -> false
    }

    fun isValidOrderReference(value: String): Boolean = ORDER_REFERENCE.matches(value)

    fun isValidTimestamp(value: String): Boolean = TIMESTAMP.matches(value)

    fun isSubmittable(observation: MosaicTransactionObservation): Boolean =
        isValidIdentifier(observation.observationId) &&
            isValidIdentifier(observation.submissionId) &&
            isValidIdentifier(observation.providerId) &&
            observation.storePlatform == MOSAIC_STORE_PLATFORM_GOOGLE_PLAY &&
            isValidReference(observation.referenceKind, observation.reference) &&
            isValidTimestamp(observation.observedAt) &&
            (observation.providerOrderReference?.let(::isValidOrderReference) != false) &&
            (observation.claimedMosaicProductId?.let(::isValidIdentifier) != false) &&
            isValidContext(observation.context) &&
            isValidCorrelation(observation.correlation)

    private fun isValidContext(context: MosaicTransactionObservationContext): Boolean =
        context.platform == "android" &&
            context.sdkFamily == "android" &&
            VERSION.matches(context.sdkVersion) &&
            (context.applicationVersion?.let(VERSION::matches) != false) &&
            (context.operatingSystemVersion?.let(OPERATING_SYSTEM_VERSION::matches) != false)

    private fun isValidCorrelation(correlation: MosaicTransactionObservationCorrelation?): Boolean =
        correlation == null ||
            (
                !correlation.isEmpty &&
                    (correlation.purchaseAttemptId?.let(::isValidIdentifier) != false) &&
                    (correlation.providerUpdateId?.let(::isValidIdentifier) != false)
                )
}

/**
 * Field-by-field codec for the contract's record envelopes. Nothing is bound reflectively, so no
 * consumer R8 keep rule is required and no field can reach the wire by accident.
 */
internal object MosaicTransactionObservationCodec {
    private val STATUSES = setOf(
        "accepted_for_validation",
        "duplicate",
        "permanently_rejected",
        "retryable_failure",
    )

    fun encode(observation: MosaicTransactionObservation): String = JsonObject().apply {
        addProperty("billingIngestionContractVersion", MOSAIC_BILLING_INGESTION_CONTRACT_VERSION)
        addProperty("recordType", MOSAIC_RECORD_CLIENT_OBSERVATION)
        add("payload", encodePayload(observation))
    }.toString()

    private fun encodePayload(observation: MosaicTransactionObservation): JsonObject = JsonObject().apply {
        addProperty("observationId", observation.observationId)
        addProperty("submissionId", observation.submissionId)
        addProperty("providerId", observation.providerId)
        addProperty("storePlatform", observation.storePlatform)
        add("transactionReference", reference(observation.referenceKind, observation.reference))
        observation.providerOrderReference?.let {
            add("providerOrderReference", reference(MOSAIC_REFERENCE_GOOGLE_PLAY_ORDER_ID, it))
        }
        addProperty("observedAt", observation.observedAt)
        addProperty("sourceAuthority", MOSAIC_SOURCE_AUTHORITY_CLIENT)
        add(
            "context",
            JsonObject().apply {
                addProperty("platform", observation.context.platform)
                addProperty("sdkFamily", observation.context.sdkFamily)
                addProperty("sdkVersion", observation.context.sdkVersion)
                observation.context.applicationVersion?.let { addProperty("applicationVersion", it) }
                observation.context.operatingSystemVersion?.let { addProperty("operatingSystemVersion", it) }
            },
        )
        // The contract requires at least one member, so an empty correlation is omitted entirely.
        observation.correlation?.takeIf { !it.isEmpty }?.let { correlation ->
            add(
                "correlation",
                JsonObject().apply {
                    correlation.purchaseAttemptId?.let { addProperty("purchaseAttemptId", it) }
                    correlation.providerUpdateId?.let { addProperty("providerUpdateId", it) }
                },
            )
        }
        observation.claimedMosaicProductId?.let { addProperty("claimedMosaicProductId", it) }
    }

    private fun reference(kind: String, value: String): JsonObject = JsonObject().apply {
        addProperty("referenceKind", kind)
        addProperty("value", value)
    }

    fun decode(source: String): MosaicTransactionObservation {
        val root = JsonParser.parseString(source).asJsonObject
        require(root.keySet() == setOf("billingIngestionContractVersion", "recordType", "payload"))
        require(
            root.get("billingIngestionContractVersion").asString ==
                MOSAIC_BILLING_INGESTION_CONTRACT_VERSION,
        )
        require(root.get("recordType").asString == MOSAIC_RECORD_CLIENT_OBSERVATION)
        val payload = root.getAsJsonObject("payload")
        require(
            payload.keySet().all {
                it in setOf(
                    "observationId", "submissionId", "providerId", "storePlatform",
                    "transactionReference", "providerOrderReference", "observedAt",
                    "sourceAuthority", "context", "correlation", "claimedMosaicProductId",
                )
            },
        )
        require(payload.get("sourceAuthority").asString == MOSAIC_SOURCE_AUTHORITY_CLIENT)
        val transactionReference = payload.getAsJsonObject("transactionReference")
        val orderReference = payload.getAsJsonObject("providerOrderReference")
        require(
            orderReference == null ||
                orderReference.get("referenceKind").asString == MOSAIC_REFERENCE_GOOGLE_PLAY_ORDER_ID,
        )
        val context = payload.getAsJsonObject("context")
        require(
            context.keySet().all {
                it in setOf(
                    "platform", "sdkFamily", "sdkVersion", "applicationVersion", "operatingSystemVersion",
                )
            },
        )
        val correlation = payload.getAsJsonObject("correlation")
        require(
            correlation == null ||
                correlation.keySet().all { it in setOf("purchaseAttemptId", "providerUpdateId") },
        )
        val observation = MosaicTransactionObservation(
            observationId = payload.get("observationId").asString,
            submissionId = payload.get("submissionId").asString,
            providerId = payload.get("providerId").asString,
            storePlatform = payload.get("storePlatform").asString,
            referenceKind = transactionReference.get("referenceKind").asString,
            reference = transactionReference.get("value").asString,
            providerOrderReference = orderReference?.get("value")?.asString,
            observedAt = payload.get("observedAt").asString,
            context = MosaicTransactionObservationContext(
                platform = context.get("platform").asString,
                sdkFamily = context.get("sdkFamily").asString,
                sdkVersion = context.get("sdkVersion").asString,
                applicationVersion = context.get("applicationVersion")?.asString,
                operatingSystemVersion = context.get("operatingSystemVersion")?.asString,
            ),
            correlation = correlation?.let {
                MosaicTransactionObservationCorrelation(
                    purchaseAttemptId = it.get("purchaseAttemptId")?.asString,
                    providerUpdateId = it.get("providerUpdateId")?.asString,
                )
            },
            claimedMosaicProductId = payload.get("claimedMosaicProductId")?.asString,
        )
        require(MosaicTransactionObservationBounds.isSubmittable(observation))
        return observation
    }

    /**
     * Reads the contract's submission-result record. An unrecognized record type, contract version,
     * or status is not decoded: an observation is only ever removed from the queue on a result this
     * SDK understands, so a future, malformed, or spoofed response retries rather than silently
     * discarding the handoff. The status set has no member meaning validated.
     */
    fun decodeResult(source: String, submissionId: String): MosaicTransactionObservationResult? {
        val payload = runCatching {
            val root = JsonParser.parseString(source).asJsonObject
            if (root.get("billingIngestionContractVersion")?.asString !=
                MOSAIC_BILLING_INGESTION_CONTRACT_VERSION
            ) {
                return null
            }
            if (root.get("recordType")?.asString != MOSAIC_RECORD_SUBMISSION_RESULT) return null
            root.getAsJsonObject("payload")
        }.getOrNull() ?: return null
        val echoed = runCatching { payload.get("submissionId")?.asString }.getOrNull()
        if (echoed != null && echoed != submissionId) return null
        val status = runCatching { payload.get("status")?.asString }.getOrNull()
            ?.takeIf { it in STATUSES } ?: return null
        val code = runCatching { payload.get("code")?.asString }.getOrNull()
            ?.takeIf { MosaicTransactionObservationBounds.isValidIdentifier(it) }
        // The body's retryAfterSeconds is the authority; a transport header is only the fallback.
        val retryAfterSeconds = runCatching { payload.get("retryAfterSeconds")?.asInt }.getOrNull()
            ?.takeIf { it in 1..86_400 }
        return when (status) {
            "accepted_for_validation" -> MosaicTransactionObservationResult.AcceptedForValidation
            "duplicate" -> MosaicTransactionObservationResult.Duplicate
            "permanently_rejected" ->
                MosaicTransactionObservationResult.PermanentlyRejected(code ?: "observation_schema_invalid")
            else -> MosaicTransactionObservationResult.RetryableFailure(
                code ?: "service_temporarily_unavailable",
                retryAfterSeconds,
            )
        }
    }
}
