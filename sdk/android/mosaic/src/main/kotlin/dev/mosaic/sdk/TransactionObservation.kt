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
 * What is structurally impossible to carry here: a Google Play purchase token, `originalJson`, a
 * purchase signature, obfuscated account or profile identifiers, or any credential. The Google
 * reference is the SHA-256 digest of the token, which cannot be reversed, and every field is bounded
 * by the contract's `safeProviderCode` charset before it can be queued.
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

/** Reference kind for the Google Play token digest, as frozen by Billing Ingestion Contract 1. */
internal const val MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST = "google_play_token_digest"

/**
 * The client never classifies the Store Environment. A device-side guess is untrusted and the
 * contract's readerPolicy forbids an unclassified environment from aggregating with production, so
 * the honest value is the only correct one.
 */
internal const val MOSAIC_STORE_ENVIRONMENT_UNCLASSIFIED = "unclassified"

/**
 * One submittable observation. This is the complete set of values that ever leaves the device for
 * this feature; there is no free-form field, no provider payload, and no host-supplied text.
 */
internal data class MosaicTransactionObservation(
    val submissionId: String,
    val referenceKind: String,
    val reference: String,
    val providerOrderReference: String? = null,
    val storeEnvironment: String = MOSAIC_STORE_ENVIRONMENT_UNCLASSIFIED,
    val observedAt: String,
)

/** Bounds mirroring the frozen contract. Everything else is rejected before it can be queued. */
internal object MosaicTransactionObservationBounds {
    private val IDENTIFIER = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val GOOGLE_TOKEN_DIGEST = Regex("^[a-f0-9]{64}$")
    private val TIMESTAMP =
        Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$")

    /** `providerOrderReference` value pattern; a purchase token cannot satisfy the 128 bound. */
    private val ORDER_REFERENCE = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

    fun isValidSubmissionId(value: String): Boolean = IDENTIFIER.matches(value)

    fun isValidReference(referenceKind: String, value: String): Boolean = when (referenceKind) {
        MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST -> GOOGLE_TOKEN_DIGEST.matches(value)
        else -> false
    }

    fun isValidOrderReference(value: String): Boolean = ORDER_REFERENCE.matches(value)

    fun isValidTimestamp(value: String): Boolean = TIMESTAMP.matches(value)

    fun isSubmittable(observation: MosaicTransactionObservation): Boolean =
        isValidSubmissionId(observation.submissionId) &&
            isValidReference(observation.referenceKind, observation.reference) &&
            isValidTimestamp(observation.observedAt) &&
            observation.storeEnvironment in STORE_ENVIRONMENTS &&
            (observation.providerOrderReference?.let(::isValidOrderReference) != false)

    private val STORE_ENVIRONMENTS = setOf("sandbox", "production", MOSAIC_STORE_ENVIRONMENT_UNCLASSIFIED)
}

/**
 * Field-by-field codec. Nothing is bound reflectively, so no consumer R8 keep rule is required and
 * no field can be added to the wire by accident.
 */
internal object MosaicTransactionObservationCodec {
    private val OUTCOMES = setOf(
        "accepted_for_validation",
        "duplicate",
        "permanently_rejected",
        "retryable_failure",
    )

    fun encode(observation: MosaicTransactionObservation): String = JsonObject().apply {
        addProperty("submissionId", observation.submissionId)
        addProperty("referenceKind", observation.referenceKind)
        addProperty("reference", observation.reference)
        observation.providerOrderReference?.let { addProperty("providerOrderReference", it) }
        addProperty("storeEnvironment", observation.storeEnvironment)
        addProperty("observedAt", observation.observedAt)
    }.toString()

    fun decode(source: String): MosaicTransactionObservation {
        val root = JsonParser.parseString(source).asJsonObject
        require(
            root.keySet().all {
                it in setOf(
                    "submissionId", "referenceKind", "reference",
                    "providerOrderReference", "storeEnvironment", "observedAt",
                )
            },
        )
        val observation = MosaicTransactionObservation(
            submissionId = root.get("submissionId").asString,
            referenceKind = root.get("referenceKind").asString,
            reference = root.get("reference").asString,
            providerOrderReference = root.get("providerOrderReference")?.asString,
            storeEnvironment = root.get("storeEnvironment").asString,
            observedAt = root.get("observedAt").asString,
        )
        require(MosaicTransactionObservationBounds.isSubmittable(observation))
        return observation
    }

    /**
     * Reads the submission result. An unrecognized outcome is not decoded: an observation is only
     * ever removed from the queue on a result this SDK understands, so a future or malformed
     * response retries rather than silently discarding the handoff.
     */
    fun decodeResult(source: String, submissionId: String): MosaicTransactionObservationResult? {
        val payload = runCatching {
            JsonParser.parseString(source).asJsonObject.getAsJsonObject("data")
        }.getOrNull() ?: return null
        val echoed = runCatching { payload.get("submissionId")?.asString }.getOrNull()
        if (echoed != null && echoed != submissionId) return null
        val outcome = runCatching { payload.get("outcome")?.asString }.getOrNull()
            ?.takeIf { it in OUTCOMES } ?: return null
        val code = runCatching { payload.get("code")?.asString }.getOrNull()
            ?.takeIf { MosaicTransactionObservationBounds.isValidSubmissionId(it) }
        return when (outcome) {
            "accepted_for_validation" -> MosaicTransactionObservationResult.AcceptedForValidation
            "duplicate" -> MosaicTransactionObservationResult.Duplicate
            "permanently_rejected" ->
                MosaicTransactionObservationResult.PermanentlyRejected(code ?: "observation_schema_invalid")
            else -> MosaicTransactionObservationResult.RetryableFailure(code ?: "service_temporarily_unavailable")
        }
    }
}
