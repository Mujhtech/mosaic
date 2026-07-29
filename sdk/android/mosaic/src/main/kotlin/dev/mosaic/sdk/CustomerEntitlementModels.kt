package dev.mosaic.sdk

/**
 * Authoritative Entitlement Contract 1 reader models.
 *
 * These types describe what **Mosaic** says a Billing Customer may access, projected server-side
 * from validated provider facts. They are deliberately a separate namespace from the frozen
 * provider-observed commerce types ([MosaicEntitlement], [MosaicActiveEntitlementsResult]): a
 * provider-observed entitlement is what a store told this device a moment ago, an authoritative
 * entitlement is what Mosaic has validated and is willing to be held to. Neither replaces the
 * other in Phase 9B, and no existing symbol changes meaning.
 *
 * Two rules from the contract are structural here rather than documented:
 *
 * 1. **There is no boolean convenience API anywhere.** `unknown` and `unavailable` are real
 *    answers, and a `Boolean` has nowhere to put them; every `Boolean` accessor a reader might
 *    add would collapse "Mosaic could not answer" into "you do not have it".
 * 2. **A reason is present whenever the state is not [MosaicCustomerEntitlementState.Active].**
 *    Inactive carries the explanation that justifies it; unknown and unavailable additionally
 *    carry the uncertainty that says why the answer is not definitive.
 */

/** Closed explanation vocabulary. A reader may render its own copy for a code, never invent one. */
enum class MosaicCustomerEntitlementExplanationCode(val wireName: String) {
    ACTIVE_SUBSCRIPTION_PERIOD("active_subscription_period"),
    ACTIVE_TRIAL_PERIOD("active_trial_period"),
    ACTIVE_GRACE_PERIOD("active_grace_period"),
    ACTIVE_BILLING_RETRY_ALLOWANCE("active_billing_retry_allowance"),
    PERMANENT_ONE_TIME_PURCHASE("permanent_one_time_purchase"),
    FAMILY_SHARED_SOURCE("family_shared_source"),
    SCHEDULED_PAUSE_NOT_YET_EFFECTIVE("scheduled_pause_not_yet_effective"),
    SUBSCRIPTION_CANCELLED_ACCESS_UNTIL_PERIOD_END("subscription_cancelled_access_until_period_end"),
    SUBSCRIPTION_EXPIRED("subscription_expired"),
    SUBSCRIPTION_PAUSED("subscription_paused"),
    SUBSCRIPTION_REVOKED("subscription_revoked"),
    SUBSCRIPTION_REFUNDED("subscription_refunded"),
    SUBSCRIPTION_SUPERSEDED("subscription_superseded"),
    GRANT_VERSION_ENDED("grant_version_ended"),
    NO_QUALIFYING_SOURCE("no_qualifying_source"),
    IDENTITY_UNRESOLVED("identity_unresolved"),
    PRODUCT_UNRESOLVED("product_unresolved"),
    CONFLICTING_FACTS("conflicting_facts"),
    PROJECTION_FAILED("projection_failed"),
    PROVIDER_EVIDENCE_STALE("provider_evidence_stale"),
    PROVIDER_UNAVAILABLE("provider_unavailable"),
    BILLING_DISABLED("billing_disabled"),
    UNSUPPORTED_PROVIDER_STATE("unsupported_provider_state"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerEntitlementExplanationCode::wireName)
        fun from(value: String): MosaicCustomerEntitlementExplanationCode? = byWireName[value]
    }
}

enum class MosaicCustomerUncertaintyReason(val wireName: String) {
    NONE("none"),
    PROVIDER_UNAVAILABLE("provider_unavailable"),
    MISSING_FACT("missing_fact"),
    IDENTITY_UNRESOLVED("identity_unresolved"),
    PRODUCT_UNRESOLVED("product_unresolved"),
    CONFLICTING_FACTS("conflicting_facts"),
    PROJECTION_FAILED("projection_failed"),
    STALE_VALIDATION("stale_validation"),
    UNSUPPORTED_PROVIDER_STATE("unsupported_provider_state"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerUncertaintyReason::wireName)
        fun from(value: String): MosaicCustomerUncertaintyReason? = byWireName[value]
    }
}

enum class MosaicCustomerExpectedResolution(val wireName: String) {
    AUTOMATIC_RETRY("automatic_retry"),
    NEXT_PROVIDER_NOTIFICATION("next_provider_notification"),
    NEXT_PROJECTION_RUN("next_projection_run"),
    OPERATOR_ACTION("operator_action"),
    CUSTOMER_ACTION("customer_action"),
    NONE_EXPECTED("none_expected"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerExpectedResolution::wireName)
        fun from(value: String): MosaicCustomerExpectedResolution? = byWireName[value]
    }
}

/** Why a state is not definitive. A definitive state carries [MosaicCustomerUncertaintyReason.NONE]. */
data class MosaicCustomerUncertainty(
    val reason: MosaicCustomerUncertaintyReason,
    val since: String? = null,
    val expectedResolution: MosaicCustomerExpectedResolution? = null,
    val diagnosticCode: String? = null,
) {
    internal companion object {
        val Definite = MosaicCustomerUncertainty(MosaicCustomerUncertaintyReason.NONE)
    }
}

data class MosaicCustomerEntitlementExplanation(
    val code: MosaicCustomerEntitlementExplanationCode,
    val sourceId: String? = null,
    val safeSummary: String? = null,
)

/**
 * The authoritative state of one Entitlement.
 *
 * [Unavailable] says Mosaic could not answer — billing disabled for the Environment, a projection
 * failure, an outage. It is a service state and can never appear inside an accepted snapshot; it is
 * produced only at read time. [Unknown] says Mosaic looked and is not confident. Neither is ever
 * reported as [Inactive], which is a claim about a person.
 */
sealed interface MosaicCustomerEntitlementState {
    val explanation: MosaicCustomerEntitlementExplanation

    data class Active(
        override val explanation: MosaicCustomerEntitlementExplanation,
        val effectiveStart: String?,
        /**
         * Present only when [endKnown] is true. `endKnown == true` with a null end means the
         * Entitlement is permanent, which is why a reader must branch on both members and never
         * render "expires" from a null end.
         */
        val effectiveEnd: String?,
        val endKnown: Boolean,
        /** True while access is being served from a cache past `validUntil` under bounded grace. */
        val isStale: Boolean = false,
    ) : MosaicCustomerEntitlementState

    data class Inactive(
        override val explanation: MosaicCustomerEntitlementExplanation,
    ) : MosaicCustomerEntitlementState

    data class Unknown(
        override val explanation: MosaicCustomerEntitlementExplanation,
        val uncertainty: MosaicCustomerUncertainty,
    ) : MosaicCustomerEntitlementState

    data class Unavailable(
        override val explanation: MosaicCustomerEntitlementExplanation,
        val uncertainty: MosaicCustomerUncertainty,
    ) : MosaicCustomerEntitlementState
}

enum class MosaicCustomerSourceType(val wireName: String) {
    ACTIVE_SUBSCRIPTION("active_subscription"),
    TRIAL("trial"),
    GRACE_PERIOD("grace_period"),
    BILLING_RETRY("billing_retry"),
    ONE_TIME_NON_CONSUMABLE("one_time_non_consumable"),
    FAMILY_SHARED("family_shared"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerSourceType::wireName)
        fun from(value: String): MosaicCustomerSourceType? = byWireName[value]
    }
}

enum class MosaicCustomerSourceState(val wireName: String) {
    GRANTING("granting"),
    NOT_GRANTING("not_granting"),
    UNKNOWN("unknown"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerSourceState::wireName)
        fun from(value: String): MosaicCustomerSourceState? = byWireName[value]
    }
}

enum class MosaicCustomerStorePlatform(val wireName: String) {
    APPLE_APP_STORE("apple_app_store"),
    GOOGLE_PLAY("google_play"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerStorePlatform::wireName)
        fun from(value: String): MosaicCustomerStorePlatform? = byWireName[value]
    }
}

/**
 * One reason a Billing Customer holds, or may hold, access.
 *
 * Mosaic Product and Subscription Instance identity live here and nowhere else. Duplicating them
 * onto the entry would create two places that can disagree when several sources grant one
 * Entitlement, and the entry is the one a reader trusts.
 */
data class MosaicCustomerEntitlementSource(
    val sourceId: String,
    val sourceType: MosaicCustomerSourceType,
    val subscriptionInstanceId: String?,
    val oneTimePurchaseInstanceId: String?,
    val mosaicProductId: String,
    val grantVersionId: String,
    val sourceSnapshotId: String,
    val storePlatform: MosaicCustomerStorePlatform?,
    val start: String,
    val end: String?,
    val sourceState: MosaicCustomerSourceState,
    val uncertainty: MosaicCustomerUncertainty,
    val explanationCode: MosaicCustomerEntitlementExplanationCode,
    /**
     * True for an Apple sandbox transaction or a Google Play license-tester purchase. On Google this
     * flag is the only thing separating a test grant from a paid one, so every surface reports it.
     */
    val isTestSource: Boolean,
)

data class MosaicCustomerEntitlementEntry(
    val entitlementId: String,
    val entitlementKey: String,
    val state: MosaicCustomerEntitlementState,
    val sourceIds: List<String>,
    val sourceCount: Int,
    val refreshRecommendedAt: String?,
)

enum class MosaicCustomerProjectionState(val wireName: String) {
    CURRENT("current"),
    PENDING("pending"),
    STALE("stale"),
    DEGRADED("degraded"),
    FAILED("failed"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerProjectionState::wireName)
        fun from(value: String): MosaicCustomerProjectionState? = byWireName[value]
    }
}

data class MosaicCustomerProjectionStatus(
    val state: MosaicCustomerProjectionState,
    val lastProjectedAt: String,
    val pendingFactCount: Int? = null,
    val diagnosticCode: String? = null,
)

enum class MosaicCustomerSnapshotChangeReason(val wireName: String) {
    INITIAL_PROJECTION("initial_projection"),
    SUBSCRIPTION_STATE_CHANGED("subscription_state_changed"),
    SUBSCRIPTION_PERIOD_CHANGED("subscription_period_changed"),
    RENEWAL_INTENT_CHANGED("renewal_intent_changed"),
    SOURCE_ADDED("source_added"),
    SOURCE_ENDED("source_ended"),
    REFUND_APPLIED("refund_applied"),
    REVOCATION_APPLIED("revocation_applied"),
    GRANT_VERSION_CHANGED("grant_version_changed"),
    IDENTITY_CHANGED("identity_changed"),
    IDENTITY_CONFLICT_OPENED("identity_conflict_opened"),
    IDENTITY_CONFLICT_RESOLVED("identity_conflict_resolved"),
    PROJECTION_REPLAYED("projection_replayed"),
    PROJECTION_RULE_UPGRADED("projection_rule_upgraded"),
    PROJECTION_RECOVERED("projection_recovered"),
    PROJECTION_FAILED("projection_failed"),
    MANUAL_REPROJECTION("manual_reprojection"),
    ;

    internal companion object {
        private val byWireName = entries.associateBy(MosaicCustomerSnapshotChangeReason::wireName)
        fun from(value: String): MosaicCustomerSnapshotChangeReason? = byWireName[value]
    }
}

data class MosaicCustomerEntitlementDiagnostic(
    val code: String,
    val safeMessage: String,
    val severity: String,
    val retryable: Boolean,
    val correlationId: String,
    val retryAfterSeconds: Int? = null,
    val recoveryAction: String? = null,
)

/**
 * The freshness window a reader evaluates the cache against.
 *
 * It is held separately from the snapshot because a `snapshotUnchanged` response slides the window
 * without producing a new snapshot: a confirmed-current snapshot must not expire merely because it
 * was confirmed instead of resent.
 */
data class MosaicCustomerEntitlementFreshnessWindow(
    val issuedAt: String,
    val refreshAfter: String,
    val validUntil: String,
    val staleGraceSeconds: Int,
) {
    internal val issuedAtEpochMillis: Long = mosaicContractInstantMillis(issuedAt)
    internal val refreshAfterEpochMillis: Long = mosaicContractInstantMillis(refreshAfter)
    internal val validUntilEpochMillis: Long = mosaicContractInstantMillis(validUntil)
}

/** The immutable authoritative view of one Billing Customer's access at one snapshot version. */
data class MosaicCustomerEntitlementSnapshot(
    val snapshotId: String,
    val billingCustomerId: String,
    val projectId: String,
    val environmentId: String,
    val snapshotVersion: Long,
    val previousSnapshotVersion: Long?,
    val projectionRuleVersion: Int,
    val asOf: String,
    val freshness: MosaicCustomerEntitlementFreshnessWindow,
    val entityTag: String,
    val contentDigest: String,
    val entries: List<MosaicCustomerEntitlementEntry>,
    val sources: List<MosaicCustomerEntitlementSource>,
    val projectionStatus: MosaicCustomerProjectionStatus,
    val changeReason: MosaicCustomerSnapshotChangeReason,
    val correlationId: String,
    val diagnostics: List<MosaicCustomerEntitlementDiagnostic>,
) {
    internal val asOfEpochMillis: Long = mosaicContractInstantMillis(asOf)

    fun entry(entitlementKey: String): MosaicCustomerEntitlementEntry? =
        entries.firstOrNull { it.entitlementKey == entitlementKey }

    fun source(sourceId: String): MosaicCustomerEntitlementSource? =
        sources.firstOrNull { it.sourceId == sourceId }
}

/** The conditional-request answer confirming a cached snapshot is still current. */
internal data class MosaicCustomerSnapshotUnchanged(
    val billingCustomerId: String,
    val projectId: String,
    val environmentId: String,
    val snapshotVersion: Long,
    val entityTag: String,
    val asOf: String,
    val freshness: MosaicCustomerEntitlementFreshnessWindow,
    val projectionStatus: MosaicCustomerProjectionStatus,
    val correlationId: String,
)

/**
 * How a cached snapshot stands against the device clock.
 *
 * Clock unreliability is deliberately **not** a member. An unreliable clock forces
 * expired-equivalent behaviour and is surfaced through diagnostics, because it describes the device
 * rather than the cache and adding it here would make every reader branch on a fifth case whose
 * correct handling is identical to [EXPIRED].
 */
enum class MosaicCustomerEntitlementCacheState(val wireName: String) {
    FRESH("fresh"),
    REFRESH_RECOMMENDED("refreshRecommended"),
    STALE_WITHIN_GRACE("staleWithinGrace"),
    EXPIRED("expired"),
    MISSING("missing"),
    INVALID("invalid"),
    DIFFERENT_CUSTOMER("differentCustomer"),
}

/** Why the authoritative surface cannot state a customer's access. Never "inactive". */
enum class MosaicCustomerEntitlementUnavailableReason(val wireName: String) {
    /** No `customerAccessTokenProvider` was configured, so the feature is inert. */
    NOT_CONFIGURED("customer.entitlements.notConfigured"),
    TOKEN_UNAVAILABLE("customer.entitlements.tokenUnavailable"),
    UNAUTHORIZED("customer.entitlements.unauthorized"),
    TRANSPORT_UNAVAILABLE("customer.entitlements.transportUnavailable"),
    SNAPSHOT_REJECTED("customer.entitlements.snapshotRejected"),
    CACHE_EXPIRED("customer.entitlements.cacheExpired"),
    CLOCK_UNRELIABLE("customer.entitlements.clockUnreliable"),
    NEVER_SYNCHRONIZED("customer.entitlements.neverSynchronized"),
}

/** The observable authoritative state. Identity transitions are visible without stale grants. */
sealed interface MosaicCustomerEntitlementSnapshotState {
    /** No answer yet, or an identity mutation is in progress. Never serves a previous customer. */
    data object Loading : MosaicCustomerEntitlementSnapshotState

    data object SignedOut : MosaicCustomerEntitlementSnapshotState

    data class Available(
        val snapshot: MosaicCustomerEntitlementSnapshot,
        val cacheState: MosaicCustomerEntitlementCacheState,
    ) : MosaicCustomerEntitlementSnapshotState

    data class Unavailable(
        val reason: MosaicCustomerEntitlementUnavailableReason,
        val lastKnown: MosaicCustomerEntitlementSnapshot? = null,
    ) : MosaicCustomerEntitlementSnapshotState
}

/** Why a document was refused. Every member yields `unknown`, never `inactive`. */
enum class MosaicCustomerSnapshotRejection(val wireName: String) {
    UNSUPPORTED_CONTRACT_VERSION("unsupported_contract_version"),
    CUSTOMER_MISMATCH("customer_mismatch"),
    PROJECT_MISMATCH("project_mismatch"),
    ENVIRONMENT_MISMATCH("environment_mismatch"),
    CONTENT_DIGEST_MISMATCH("content_digest_mismatch"),
    SNAPSHOT_VERSION_NOT_NEWER("snapshot_version_not_newer"),
    AS_OF_REGRESSION("as_of_regression"),
    MALFORMED_RECORD("malformed_record"),
    WEAK_ENTITY_TAG("weak_entity_tag"),
    ;

    /** The one rejection that clears rather than preserves the cache. */
    val clearsCache: Boolean
        get() = this == CUSTOMER_MISMATCH || this == PROJECT_MISMATCH || this == ENVIRONMENT_MISMATCH
}

/** The outcome of one authoritative sync attempt. */
sealed interface MosaicCustomerEntitlementSyncResult {
    data class Updated(
        val snapshot: MosaicCustomerEntitlementSnapshot,
        val cacheState: MosaicCustomerEntitlementCacheState,
    ) : MosaicCustomerEntitlementSyncResult

    /** The server confirmed the cached snapshot; freshness slid, nothing was re-accepted. */
    data class Unchanged(
        val snapshot: MosaicCustomerEntitlementSnapshot,
        val cacheState: MosaicCustomerEntitlementCacheState,
    ) : MosaicCustomerEntitlementSyncResult

    data class Rejected(
        val rejection: MosaicCustomerSnapshotRejection,
        val lastKnown: MosaicCustomerEntitlementSnapshot?,
    ) : MosaicCustomerEntitlementSyncResult

    /** The customer token was refused after exactly one forced-refresh retry. */
    data class Unauthorized(val diagnosticCode: String) : MosaicCustomerEntitlementSyncResult

    data object SignedOut : MosaicCustomerEntitlementSyncResult

    data class Unavailable(
        val reason: MosaicCustomerEntitlementUnavailableReason,
        val retryAfterSeconds: Int? = null,
    ) : MosaicCustomerEntitlementSyncResult
}

/** The answer to one focused access question. Never a bare boolean. */
data class MosaicCustomerEntitlementCheck(
    val entitlementKey: String,
    val state: MosaicCustomerEntitlementState,
    val sourceCount: Int,
    val snapshotVersion: Long?,
    val asOf: String?,
    val cacheState: MosaicCustomerEntitlementCacheState,
    val isTestSource: Boolean = false,
)

/** Bounded, secret-free operational view of the authoritative entitlement runtime. */
data class MosaicCustomerEntitlementDiagnostics(
    val configured: Boolean,
    val cacheState: MosaicCustomerEntitlementCacheState,
    val snapshotVersion: Long?,
    val asOf: String?,
    val clockUnreliable: Boolean,
    val lastRejection: MosaicCustomerSnapshotRejection?,
    val lastUnavailableReason: MosaicCustomerEntitlementUnavailableReason?,
    val acceptedSnapshotCount: Long,
    val rejectedSnapshotCount: Long,
)
