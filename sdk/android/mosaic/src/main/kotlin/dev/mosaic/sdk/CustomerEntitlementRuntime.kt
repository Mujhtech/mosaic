package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonParser
import java.text.ParseException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Authoritative Entitlement Contract 1 reader policy.
 *
 * Everything above the runtime class in this file is a pure function of its inputs, because both
 * policies are pinned by cross-implementation reference vectors that Go, Dart, Swift, and Kotlin
 * must all satisfy identically. Keeping them free of clocks, files, and coroutines is what lets the
 * JVM suite drive the vector tables directly rather than through a simulated device.
 */

/** RFC 3339 UTC with exactly three fractional digits and a literal Z. Nothing else is admissible. */
private val MOSAIC_CONTRACT_TIMESTAMP =
    Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")

/**
 * Parses a contract timestamp, rejecting any other precision.
 *
 * The precision is not cosmetic: `contentDigest` is computed over the canonical serialization, so
 * the same instant written with two-digit or six-digit fractions digests differently and would make
 * two producers of identical state disagree.
 */
internal fun mosaicContractInstantMillis(value: String): Long {
    require(MOSAIC_CONTRACT_TIMESTAMP.matches(value)) {
        "A Mosaic contract timestamp must have exactly three fractional digits and a literal Z."
    }
    // Parsed with the same `SimpleDateFormat` the rest of the SDK uses rather than `java.time`,
    // which needs API 26 or desugaring; Mosaic supports API 24 without either. The shape is already
    // fixed by the pattern above, so this call only has to reject impossible dates.
    return try {
        mosaicAnalyticsTimestampMillis(value)
    } catch (cause: ParseException) {
        throw IllegalArgumentException("A Mosaic contract timestamp must be a valid UTC instant.", cause)
    }
}

/** The binding and ordering members the acceptance gate compares. Nothing else participates. */
internal data class MosaicCustomerSnapshotBinding(
    val contractVersion: String,
    val billingCustomerId: String,
    val projectId: String,
    val environmentId: String,
    val snapshotVersion: Long,
    val asOfEpochMillis: Long,
    val contentDigestValid: Boolean,
)

internal enum class MosaicCustomerCacheAction { REPLACE, PRESERVE, CLEAR }

internal data class MosaicCustomerCacheDecision(
    val accepted: Boolean,
    /** Exactly the reason vocabulary of `entitlement-cache-decision-vectors.json`. */
    val reason: String,
    val action: MosaicCustomerCacheAction,
    val rejection: MosaicCustomerSnapshotRejection?,
)

/**
 * The cache acceptance gate.
 *
 * The check order is normative and the vectors pin it. Binding is compared **before** version for a
 * specific reason: snapshot versions are monotonic per customer *per Environment*, so a staging
 * snapshot legitimately starts at 1. Diagnosing that as a version regression would be the wrong
 * diagnosis and would preserve a production cache under a staging identity. A binding mismatch is
 * also the one rejection that clears rather than preserves, because continuing to serve the previous
 * customer's access after an identity change is precisely the leak this rule exists to prevent.
 *
 * Acceptance is atomic. A rejected document contributes nothing: the reader never keeps the entries
 * it understood from a record it refused.
 */
internal object MosaicCustomerEntitlementAcceptance {
    const val SUPPORTED_CONTRACT_VERSION: String = "1"

    fun decide(
        cached: MosaicCustomerSnapshotBinding?,
        incoming: MosaicCustomerSnapshotBinding,
    ): MosaicCustomerCacheDecision {
        // 1. Exact-match reading. A "2" document is as unreadable to a "1" reader as "9.9" would be;
        //    numeric ordering never implies support. This runs first because a document in an
        //    unknown version cannot be trusted to have interpretable binding fields.
        if (incoming.contractVersion != SUPPORTED_CONTRACT_VERSION) {
            return reject(
                "unsupported_contract_version",
                MosaicCustomerCacheAction.PRESERVE,
                MosaicCustomerSnapshotRejection.UNSUPPORTED_CONTRACT_VERSION,
            )
        }

        // 2. Customer binding, across all three members. Each clears the cache.
        if (cached != null) {
            if (cached.billingCustomerId != incoming.billingCustomerId) {
                return reject(
                    "customer_mismatch",
                    MosaicCustomerCacheAction.CLEAR,
                    MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH,
                )
            }
            if (cached.projectId != incoming.projectId) {
                return reject(
                    "project_mismatch",
                    MosaicCustomerCacheAction.CLEAR,
                    MosaicCustomerSnapshotRejection.PROJECT_MISMATCH,
                )
            }
            if (cached.environmentId != incoming.environmentId) {
                return reject(
                    "environment_mismatch",
                    MosaicCustomerCacheAction.CLEAR,
                    MosaicCustomerSnapshotRejection.ENVIRONMENT_MISMATCH,
                )
            }
        }

        // 3. Corruption in transit or at rest. The snapshot is discarded whole, never partially
        //    applied, and the last good cache stands.
        if (!incoming.contentDigestValid) {
            return reject(
                "content_digest_mismatch",
                MosaicCustomerCacheAction.PRESERVE,
                MosaicCustomerSnapshotRejection.CONTENT_DIGEST_MISMATCH,
            )
        }

        if (cached == null) {
            return MosaicCustomerCacheDecision(
                accepted = true,
                reason = "no_cached_snapshot",
                action = MosaicCustomerCacheAction.REPLACE,
                rejection = null,
            )
        }

        // 4. Equal is not newer. A 304 is the correct way to confirm a current snapshot; it slides
        //    freshness without re-accepting anything, so "accepted" always means the state advanced.
        if (incoming.snapshotVersion <= cached.snapshotVersion) {
            return reject(
                "snapshot_version_not_newer",
                MosaicCustomerCacheAction.PRESERVE,
                MosaicCustomerSnapshotRejection.SNAPSHOT_VERSION_NOT_NEWER,
            )
        }

        // 5. A higher version evaluated at an earlier instant means the server projected from a
        //    stale read: the version would move forward while the evidence moved backward.
        if (incoming.asOfEpochMillis < cached.asOfEpochMillis) {
            return reject(
                "as_of_regression",
                MosaicCustomerCacheAction.PRESERVE,
                MosaicCustomerSnapshotRejection.AS_OF_REGRESSION,
            )
        }

        return MosaicCustomerCacheDecision(
            accepted = true,
            reason = "newer_snapshot_version",
            action = MosaicCustomerCacheAction.REPLACE,
            rejection = null,
        )
    }

    private fun reject(
        reason: String,
        action: MosaicCustomerCacheAction,
        rejection: MosaicCustomerSnapshotRejection,
    ) = MosaicCustomerCacheDecision(accepted = false, reason = reason, action = action, rejection = rejection)
}

/** How a cached snapshot stands against the device clock, plus whether that clock can be trusted. */
internal data class MosaicCustomerFreshnessEvaluation(
    val state: MosaicCustomerEntitlementCacheState,
    val clockUnreliable: Boolean,
)

/**
 * The offline access policy.
 *
 * One interface with one shipped implementation, so the policy is a single named object rather than
 * a decision scattered across the runtime. Bounded grace is the shipped policy (OD-5); a strict
 * policy is the same fields with a grace window of zero, which is why there is no separate mode.
 */
internal fun interface MosaicCustomerOfflinePolicy {
    fun evaluate(
        window: MosaicCustomerEntitlementFreshnessWindow,
        deviceNowEpochMillis: Long,
    ): MosaicCustomerFreshnessEvaluation
}

internal object MosaicCustomerBoundedGracePolicy : MosaicCustomerOfflinePolicy {
    /**
     * Applied in the direction that favours the user: a boundary is crossed only once the device
     * clock exceeds it by more than the tolerance. An implementation comparing boundaries exactly
     * flaps between two states for every device whose clock is a few seconds fast.
     */
    const val CLOCK_SKEW_TOLERANCE_SECONDS: Long = 60

    private const val TOLERANCE_MILLIS = CLOCK_SKEW_TOLERANCE_SECONDS * 1_000

    override fun evaluate(
        window: MosaicCustomerEntitlementFreshnessWindow,
        deviceNowEpochMillis: Long,
    ): MosaicCustomerFreshnessEvaluation {
        // A device claiming a time meaningfully before issuance cannot measure this cache's age. A
        // naive implementation computes a negative age, concludes "fresh", and hands unlimited
        // offline access to anyone willing to move their clock back. Unreliability is not a fifth
        // state: it forces expired-equivalent behaviour and is reported as a diagnostic.
        if (deviceNowEpochMillis < window.issuedAtEpochMillis - TOLERANCE_MILLIS) {
            return MosaicCustomerFreshnessEvaluation(
                MosaicCustomerEntitlementCacheState.EXPIRED,
                clockUnreliable = true,
            )
        }

        val graceMillis = window.staleGraceSeconds.toLong() * 1_000
        val state = when {
            deviceNowEpochMillis <= window.refreshAfterEpochMillis + TOLERANCE_MILLIS ->
                MosaicCustomerEntitlementCacheState.FRESH
            deviceNowEpochMillis <= window.validUntilEpochMillis + TOLERANCE_MILLIS ->
                MosaicCustomerEntitlementCacheState.REFRESH_RECOMMENDED
            // With a grace window of zero this band is empty, so validUntil is a hard edge.
            deviceNowEpochMillis <= window.validUntilEpochMillis + graceMillis + TOLERANCE_MILLIS ->
                MosaicCustomerEntitlementCacheState.STALE_WITHIN_GRACE
            else -> MosaicCustomerEntitlementCacheState.EXPIRED
        }
        return MosaicCustomerFreshnessEvaluation(state, clockUnreliable = false)
    }
}

/** Device time Mosaic is willing to measure a cache age against. Null means "cannot be trusted". */
internal fun interface MosaicCustomerTrustedTime {
    fun nowEpochMillis(): Long?
}

/**
 * The authoritative entitlement runtime.
 *
 * It owns exactly one piece of state — the accepted snapshot and the window governing it — and
 * publishes it as a [StateFlow] so a Compose host observes identity transitions rather than
 * polling. `Loading` and `SignedOut` are explicit states for that reason: an identity change must be
 * *observable* without ever emitting the previous customer's grants, and a nullable snapshot cannot
 * express the difference between "no answer yet" and "no customer".
 *
 * Nothing here reports `inactive` from a failure. A rejection, a transport error, an unreadable
 * clock, and an expired cache all produce `unknown`, because a reader that collapses "I could not
 * find out" into "you do not have it" turns every outage into a mass revocation experienced by
 * paying customers.
 */
class MosaicCustomerEntitlementRuntime internal constructor(
    private val transport: MosaicCustomerEntitlementTransport,
    private val cache: MosaicCustomerEntitlementCache,
    private val session: MosaicCustomerTokenSession,
    private val trustedTime: MosaicCustomerTrustedTime,
    private val diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    private val policy: MosaicCustomerOfflinePolicy = MosaicCustomerBoundedGracePolicy,
    private val correlationId: () -> String = { "customer-sync-" + UUID.randomUUID() },
) {
    private val state = MutableStateFlow<MosaicCustomerEntitlementSnapshotState>(
        MosaicCustomerEntitlementSnapshotState.Loading,
    )

    /** The observable authoritative state, with the current value replayed to every new collector. */
    val customerEntitlements: StateFlow<MosaicCustomerEntitlementSnapshotState> = state.asStateFlow()

    private val stateMutex = Mutex()
    private val identityMutationLock = Mutex()

    private var accepted: MosaicCachedCustomerEntitlements? = null
    private var bindingDigest: String? = null
    private var identityGeneration = 0
    private var inFlight: CompletableDeferred<MosaicCustomerEntitlementSyncResult>? = null

    private var acceptedCount = 0L
    private var rejectedCount = 0L
    private var lastRejection: MosaicCustomerSnapshotRejection? = null
    private var lastUnavailableReason: MosaicCustomerEntitlementUnavailableReason? = null
    private var clockUnreliable = false

    // ------------------------------------------------------------------------------------------
    // Reading
    // ------------------------------------------------------------------------------------------

    /**
     * Answers one focused access question, never as a boolean.
     *
     * An absent entry in an accepted snapshot is a real `inactive`: Mosaic looked and found no
     * qualifying source. An absent *snapshot* is not, and yields `unknown`.
     */
    suspend fun checkCustomerEntitlement(entitlementKey: String): MosaicCustomerEntitlementCheck {
        loadCacheIfNeeded()
        return stateMutex.withLock { currentCheck(entitlementKey) }
    }

    suspend fun customerEntitlementDiagnostics(): MosaicCustomerEntitlementDiagnostics {
        loadCacheIfNeeded()
        return stateMutex.withLock {
            val cached = accepted
            val evaluation = cached?.let(::evaluate)
            MosaicCustomerEntitlementDiagnostics(
                configured = true,
                cacheState = evaluation?.state ?: MosaicCustomerEntitlementCacheState.MISSING,
                snapshotVersion = cached?.snapshot?.snapshotVersion,
                asOf = cached?.snapshot?.asOf,
                clockUnreliable = evaluation?.clockUnreliable ?: clockUnreliable,
                lastRejection = lastRejection,
                lastUnavailableReason = lastUnavailableReason,
                acceptedSnapshotCount = acceptedCount,
                rejectedSnapshotCount = rejectedCount,
            )
        }
    }

    // ------------------------------------------------------------------------------------------
    // Synchronizing
    // ------------------------------------------------------------------------------------------

    /**
     * Synchronizes with Mosaic, collapsing concurrent callers onto one request.
     *
     * The deduplication is the same shape as the token session's, and for the same reason: a
     * foreground transition, a purchase completion, and a host-initiated refresh routinely coincide,
     * and three identical conditional reads help nobody.
     */
    suspend fun refreshCustomerEntitlements(): MosaicCustomerEntitlementSyncResult {
        loadCacheIfNeeded()
        var owned: CompletableDeferred<MosaicCustomerEntitlementSyncResult>? = null
        val deferred = stateMutex.withLock {
            inFlight ?: CompletableDeferred<MosaicCustomerEntitlementSyncResult>()
                .also { inFlight = it; owned = it }
        }
        val own = owned ?: return deferred.await()

        val generation = stateMutex.withLock { identityGeneration }
        val result = runCatching { sync(generation) }.getOrElse {
            MosaicCustomerEntitlementSyncResult.Unavailable(
                MosaicCustomerEntitlementUnavailableReason.TRANSPORT_UNAVAILABLE,
            )
        }
        stateMutex.withLock { if (inFlight === own) inFlight = null }
        own.complete(result)
        return result
    }

    private suspend fun sync(generation: Int): MosaicCustomerEntitlementSyncResult {
        val issued = when (val token = session.token()) {
            is MosaicCustomerAccessTokenResult.Issued -> token
            MosaicCustomerAccessTokenResult.SignedOut -> return signedOut(generation)
            is MosaicCustomerAccessTokenResult.Unavailable -> return unavailable(
                generation,
                MosaicCustomerEntitlementUnavailableReason.TOKEN_UNAVAILABLE,
                MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_TOKEN_UNAVAILABLE,
                token.retryAfterSeconds,
            )
        }

        val cached = stateMutex.withLock { accepted }
        val body = MosaicCustomerEntitlementCodec.encodeSyncRequest(
            correlationId = correlationId(),
            knownSnapshotVersion = cached?.snapshot?.snapshotVersion,
            entityTag = cached?.snapshot?.entityTag,
            requestedEntitlementKeys = emptyList(),
        )

        var response = transport.sync(issued.token, body)
        if (response is MosaicCustomerEntitlementTransportResult.Unauthorized) {
            // Exactly one retry per attempt, after a forced refresh. More would turn a revoked
            // token into a retry storm against the host's backend; fewer would make every ordinary
            // token expiry look like a sign-out.
            session.invalidate(issued.token)
            response = when (val refreshed = session.token(forceRefresh = true)) {
                is MosaicCustomerAccessTokenResult.Issued -> transport.sync(refreshed.token, body)
                MosaicCustomerAccessTokenResult.SignedOut -> return signedOut(generation)
                is MosaicCustomerAccessTokenResult.Unavailable -> return unavailable(
                    generation,
                    MosaicCustomerEntitlementUnavailableReason.TOKEN_UNAVAILABLE,
                    MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_TOKEN_UNAVAILABLE,
                    refreshed.retryAfterSeconds,
                )
            }
            if (response is MosaicCustomerEntitlementTransportResult.Unauthorized) {
                // A second refusal is a real authorization answer. The state is published as
                // unavailable — never inactive — and the customer is neither switched nor cleared:
                // the host's backend, not this SDK, decides who this device is.
                unavailable(
                    generation,
                    MosaicCustomerEntitlementUnavailableReason.UNAUTHORIZED,
                    MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_UNAUTHORIZED,
                )
                return MosaicCustomerEntitlementSyncResult.Unauthorized(
                    MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_UNAUTHORIZED.wireName,
                )
            }
        }

        return when (response) {
            is MosaicCustomerEntitlementTransportResult.Record -> acceptRecord(generation, response)
            // Preserve, slide nothing. The cache keeps running out its own clock.
            is MosaicCustomerEntitlementTransportResult.NotModified -> preserveCache(generation)
            is MosaicCustomerEntitlementTransportResult.Unauthorized -> unavailable(
                generation,
                MosaicCustomerEntitlementUnavailableReason.UNAUTHORIZED,
                MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_UNAUTHORIZED,
            )
            is MosaicCustomerEntitlementTransportResult.Unavailable -> unavailable(
                generation,
                MosaicCustomerEntitlementUnavailableReason.TRANSPORT_UNAVAILABLE,
                MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_TRANSPORT_FAILED,
                response.retryAfterSeconds,
            )
        }
    }

    private suspend fun acceptRecord(
        generation: Int,
        response: MosaicCustomerEntitlementTransportResult.Record,
    ): MosaicCustomerEntitlementSyncResult {
        when (val decoded = MosaicCustomerEntitlementCodec.decodeRecord(response.body)) {
            is MosaicCustomerRecordDecoding.Unreadable -> return reject(generation, decoded.rejection)
            // The unchanged answer is a contract record, not an HTTP status. It carries its own
            // refreshed window, so the confirmation and the freshness it grants are one document
            // that the content digest and the schema both cover.
            is MosaicCustomerRecordDecoding.Unchanged -> return confirmCache(generation, decoded.unchanged)
            is MosaicCustomerRecordDecoding.Snapshot -> {
                val snapshot = decoded.snapshot
                // The HTTP validator must identify the record it accompanies. A weak validator is
                // discarded by the transport, so a missing tag here means the response could not be
                // conditionally revalidated and its identity is unproven.
                if (response.entityTag == null || response.entityTag != snapshot.entityTag) {
                    return reject(generation, MosaicCustomerSnapshotRejection.WEAK_ENTITY_TAG)
                }
                val cached = stateMutex.withLock { accepted }
                val decision = MosaicCustomerEntitlementAcceptance.decide(
                    cached = cached?.let(::binding),
                    incoming = MosaicCustomerSnapshotBinding(
                        contractVersion = MosaicCustomerEntitlementCodec.CONTRACT_VERSION,
                        billingCustomerId = snapshot.billingCustomerId,
                        projectId = snapshot.projectId,
                        environmentId = snapshot.environmentId,
                        snapshotVersion = snapshot.snapshotVersion,
                        asOfEpochMillis = snapshot.asOfEpochMillis,
                        contentDigestValid = decoded.contentDigestValid,
                    ),
                )
                if (!decision.accepted) {
                    return reject(generation, decision.rejection ?: MosaicCustomerSnapshotRejection.MALFORMED_RECORD)
                }

                val entry = MosaicCachedCustomerEntitlements(snapshot, snapshot.freshness)
                return stateMutex.withLock {
                    // A snapshot that arrived for the identity we were signed in as when the request
                    // started is discarded after a logout or an identity change: it is not this
                    // customer's, and emitting it is precisely the leak the binding rules exist for.
                    if (generation != identityGeneration) {
                        return@withLock MosaicCustomerEntitlementSyncResult.Rejected(
                            MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH,
                            null,
                        )
                    }
                    persist(entry, response.body)
                    accepted = entry
                    acceptedCount += 1
                    val evaluation = evaluate(entry)
                    publish(entry, evaluation)
                    MosaicCustomerEntitlementSyncResult.Updated(entry.snapshot, evaluation.state)
                }
            }
        }
    }

    /**
     * Keeps the cache exactly as it is.
     *
     * The window is untouched, so a device answered only by intermediaries still expires on
     * schedule: staying offline-valid requires an answer Mosaic actually produced.
     */
    private suspend fun preserveCache(generation: Int): MosaicCustomerEntitlementSyncResult =
        stateMutex.withLock {
            if (generation != identityGeneration) {
                return@withLock MosaicCustomerEntitlementSyncResult.Rejected(
                    MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH,
                    null,
                )
            }
            val cached = accepted ?: return@withLock unavailableLocked(
                MosaicCustomerEntitlementUnavailableReason.NEVER_SYNCHRONIZED,
                MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_TRANSPORT_FAILED,
            )
            val evaluation = evaluate(cached)
            publish(cached, evaluation)
            MosaicCustomerEntitlementSyncResult.Unchanged(cached.snapshot, evaluation.state)
        }

    /**
     * A confirmed-current snapshot: freshness slides, nothing is re-accepted, nothing new is emitted.
     *
     * The confirmation is checked against the cache it claims to confirm. An unchanged record for a
     * different customer, Project, Environment, or version is not a confirmation of anything this
     * device holds, and sliding a window on its say-so would extend offline access on the strength
     * of a record about somebody else.
     */
    private suspend fun confirmCache(
        generation: Int,
        unchanged: MosaicCustomerSnapshotUnchanged,
    ): MosaicCustomerEntitlementSyncResult = stateMutex.withLock {
        if (generation != identityGeneration) {
            return@withLock MosaicCustomerEntitlementSyncResult.Rejected(
                MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH,
                null,
            )
        }
        val cached = accepted
            // A 304 without a cache is a protocol violation, not evidence of anything about a
            // customer, so it reports "never synchronized" rather than a state.
            ?: return@withLock unavailableLocked(
                MosaicCustomerEntitlementUnavailableReason.NEVER_SYNCHRONIZED,
                MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_TRANSPORT_FAILED,
            )
        val confirmsCache = unchanged.billingCustomerId == cached.snapshot.billingCustomerId &&
            unchanged.projectId == cached.snapshot.projectId &&
            unchanged.environmentId == cached.snapshot.environmentId &&
            unchanged.snapshotVersion == cached.snapshot.snapshotVersion &&
            unchanged.entityTag == cached.snapshot.entityTag
        if (!confirmsCache) {
            rejectedCount += 1
            lastRejection = MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_SNAPSHOT_REJECTED,
                    "An unchanged record did not identify the cached snapshot; freshness was not slid.",
                ),
            )
            publish(cached, evaluate(cached))
            return@withLock MosaicCustomerEntitlementSyncResult.Rejected(
                MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH,
                cached.snapshot,
            )
        }
        val slid = MosaicCachedCustomerEntitlements(
            cached.snapshot,
            MosaicCustomerEntitlementFreshnessWindow(
                // Issuance stays the cached snapshot's own: the confirmation extends how long the
                // snapshot may be served, it does not restate when the snapshot was produced.
                issuedAt = cached.window.issuedAt,
                refreshAfter = unchanged.freshness.refreshAfter,
                validUntil = unchanged.freshness.validUntil,
                staleGraceSeconds = unchanged.freshness.staleGraceSeconds,
            ),
        )
        accepted = slid
        persist(slid, null)
        val evaluation = evaluate(slid)
        publish(slid, evaluation)
        MosaicCustomerEntitlementSyncResult.Unchanged(slid.snapshot, evaluation.state)
    }

    private suspend fun reject(
        generation: Int,
        rejection: MosaicCustomerSnapshotRejection,
    ): MosaicCustomerEntitlementSyncResult = stateMutex.withLock {
        rejectedCount += 1
        lastRejection = rejection
        if (rejection.clearsCache) {
            // The one rejection that clears. Continuing to serve the previous customer's access
            // after an identity change is the leak this rule exists to prevent, and it is severe
            // enough to be reported as an error rather than a note.
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_BINDING_MISMATCH,
                    "A Customer Entitlement Snapshot was bound to a different customer, Project, or " +
                        "Environment. The cached snapshot was cleared and access is reported as unknown.",
                ),
            )
            bindingDigest?.let(cache::clear)
            cache.clearAll()
            accepted = null
            lastUnavailableReason = MosaicCustomerEntitlementUnavailableReason.SNAPSHOT_REJECTED
            state.value = MosaicCustomerEntitlementSnapshotState.Unavailable(
                MosaicCustomerEntitlementUnavailableReason.SNAPSHOT_REJECTED,
            )
            return@withLock MosaicCustomerEntitlementSyncResult.Rejected(rejection, null)
        }
        diagnostics.record(
            MosaicDiagnostic(
                MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_SNAPSHOT_REJECTED,
                "A Customer Entitlement Snapshot was rejected (${rejection.wireName}). The previously " +
                    "accepted snapshot is preserved and access is never reported as inactive.",
            ),
        )
        // A rejected record contributes nothing: not one entry, not one field. The cache stands.
        val cached = accepted
        if (cached == null) {
            lastUnavailableReason = MosaicCustomerEntitlementUnavailableReason.SNAPSHOT_REJECTED
            state.value = MosaicCustomerEntitlementSnapshotState.Unavailable(
                MosaicCustomerEntitlementUnavailableReason.SNAPSHOT_REJECTED,
            )
        } else {
            publish(cached, evaluate(cached))
        }
        MosaicCustomerEntitlementSyncResult.Rejected(rejection, cached?.snapshot)
    }

    private suspend fun signedOut(generation: Int): MosaicCustomerEntitlementSyncResult =
        stateMutex.withLock {
            if (generation == identityGeneration) {
                accepted = null
                state.value = MosaicCustomerEntitlementSnapshotState.SignedOut
            }
            MosaicCustomerEntitlementSyncResult.SignedOut
        }

    private suspend fun unavailable(
        generation: Int,
        reason: MosaicCustomerEntitlementUnavailableReason,
        code: MosaicDiagnosticCode,
        retryAfterSeconds: Int? = null,
    ): MosaicCustomerEntitlementSyncResult = stateMutex.withLock {
        if (generation != identityGeneration) {
            return@withLock MosaicCustomerEntitlementSyncResult.Unavailable(reason, retryAfterSeconds)
        }
        unavailableLocked(reason, code, retryAfterSeconds)
    }

    private fun unavailableLocked(
        reason: MosaicCustomerEntitlementUnavailableReason,
        code: MosaicDiagnosticCode,
        retryAfterSeconds: Int? = null,
    ): MosaicCustomerEntitlementSyncResult {
        lastUnavailableReason = reason
        diagnostics.record(
            MosaicDiagnostic(code, "Mosaic could not confirm authoritative entitlements (${reason.wireName})."),
        )
        // A failure to reach Mosaic never revokes a valid cache: the cached snapshot keeps serving
        // for as long as its own window says it may.
        val cached = accepted
        if (cached != null) {
            publish(cached, evaluate(cached))
        } else {
            state.value = MosaicCustomerEntitlementSnapshotState.Unavailable(reason)
        }
        return MosaicCustomerEntitlementSyncResult.Unavailable(reason, retryAfterSeconds)
    }

    // ------------------------------------------------------------------------------------------
    // Identity
    // ------------------------------------------------------------------------------------------

    /**
     * Binds this device to a Billing Customer the host's backend has authenticated.
     *
     * The order is the whole safety argument: bump the generation so anything in flight is orphaned,
     * publish `Loading` **before** reading anything so no stale grant is ever observable across the
     * transition, swap the token, isolate the on-device directory, and only then sync. The Phase 6
     * installation identity is untouched — a person signing in is not a new installation.
     */
    suspend fun identifyCustomer(billingCustomerId: String): MosaicCustomerEntitlementSyncResult {
        require(billingCustomerId.isNotBlank()) { "A Billing Customer identifier must not be blank." }
        identityMutationLock.withLock {
            val digest = MosaicCustomerEntitlementCache.bindingDigest(billingCustomerId)
            stateMutex.withLock {
                identityGeneration += 1
                inFlight?.complete(MosaicCustomerEntitlementSyncResult.SignedOut)
                inFlight = null
                accepted = null
                state.value = MosaicCustomerEntitlementSnapshotState.Loading
                if (bindingDigest != digest) {
                    cache.retainOnly(digest)
                    cache.writePointer(digest)
                }
                bindingDigest = digest
                cacheLoaded = false
            }
            session.reset(billingCustomerId)
        }
        return refreshCustomerEntitlements()
    }

    /**
     * Signs the customer out.
     *
     * Everything the previous customer's snapshot could tell a subsequent user is deleted, not
     * merely hidden: "unreachable but present" is still a readable record of what somebody paid for
     * on a device they may have handed to someone else.
     */
    suspend fun signOutCustomer() {
        identityMutationLock.withLock {
            stateMutex.withLock {
                identityGeneration += 1
                inFlight?.complete(MosaicCustomerEntitlementSyncResult.SignedOut)
                inFlight = null
                accepted = null
                bindingDigest = null
                cacheLoaded = true
                state.value = MosaicCustomerEntitlementSnapshotState.SignedOut
                cache.clearAll()
            }
            session.clear()
        }
    }

    // ------------------------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------------------------

    private var cacheLoaded = false

    private suspend fun loadCacheIfNeeded() {
        stateMutex.withLock {
            if (cacheLoaded) return@withLock
            cacheLoaded = true
            val digest = bindingDigest ?: cache.pointer() ?: return@withLock
            bindingDigest = digest
            // No cache for this identity yet. The state stays `Loading` rather than becoming
            // unavailable: nothing has failed, Mosaic simply has not answered about this person
            // before, and publishing a failure here would make every first sign-in look like one.
            val stored = cache.read(digest) ?: return@withLock
            val decoded = MosaicCustomerEntitlementCodec.decodeCacheRecord(stored)
            if (decoded == null) {
                // Truncated or tampered. It is discarded whole rather than partially read, and the
                // result is unknown rather than inactive.
                rejectedCount += 1
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_CACHE_INVALID,
                        "The cached Customer Entitlement Snapshot could not be read and was discarded.",
                    ),
                )
                cache.clear(digest)
                state.value = MosaicCustomerEntitlementSnapshotState.Unavailable(
                    MosaicCustomerEntitlementUnavailableReason.SNAPSHOT_REJECTED,
                )
                return@withLock
            }
            accepted = decoded
            publish(decoded, evaluate(decoded))
        }
    }

    private fun persist(entry: MosaicCachedCustomerEntitlements, record: String?) {
        val digest = bindingDigest
            ?: MosaicCustomerEntitlementCache.bindingDigest(entry.snapshot.billingCustomerId)
                .also { bindingDigest = it; runCatching { cache.writePointer(it) } }
        // A 304 slides the window without carrying a record, so the stored document is re-encoded
        // from what is already on disk rather than reconstructed from the decoded model — a
        // reconstruction could not reproduce the exact bytes the contentDigest was computed over.
        val source = record ?: storedRecord(digest) ?: return
        runCatching {
            cache.write(digest, MosaicCustomerEntitlementCodec.encodeCacheRecord(source, entry.window))
        }
    }

    private fun storedRecord(digest: String): String? = cache.read(digest)?.let { stored ->
        runCatching {
            val root = JsonParser.parseString(stored).asJsonObject
            GsonBuilder().disableHtmlEscaping().create().toJson(root.getAsJsonObject("body").get("record"))
        }.getOrNull()
    }

    private fun binding(entry: MosaicCachedCustomerEntitlements) = MosaicCustomerSnapshotBinding(
        contractVersion = MosaicCustomerEntitlementCodec.CONTRACT_VERSION,
        billingCustomerId = entry.snapshot.billingCustomerId,
        projectId = entry.snapshot.projectId,
        environmentId = entry.snapshot.environmentId,
        snapshotVersion = entry.snapshot.snapshotVersion,
        asOfEpochMillis = entry.snapshot.asOfEpochMillis,
        contentDigestValid = true,
    )

    private fun evaluate(entry: MosaicCachedCustomerEntitlements): MosaicCustomerFreshnessEvaluation {
        // No trusted instant means the cache's age cannot be measured at all, which is the same
        // safety position as an expired cache: unknown, never inactive, never silently served.
        val now = trustedTime.nowEpochMillis()
            ?: return MosaicCustomerFreshnessEvaluation(
                MosaicCustomerEntitlementCacheState.EXPIRED,
                clockUnreliable = true,
            )
        return policy.evaluate(entry.window, now)
    }

    private fun publish(
        entry: MosaicCachedCustomerEntitlements,
        evaluation: MosaicCustomerFreshnessEvaluation,
    ) {
        clockUnreliable = evaluation.clockUnreliable
        if (evaluation.clockUnreliable) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_CLOCK_UNRELIABLE,
                    "The device clock cannot measure the age of the cached snapshot; access is unknown.",
                ),
            )
        }
        state.value = when (evaluation.state) {
            MosaicCustomerEntitlementCacheState.FRESH,
            MosaicCustomerEntitlementCacheState.REFRESH_RECOMMENDED,
            -> MosaicCustomerEntitlementSnapshotState.Available(entry.snapshot, evaluation.state)
            MosaicCustomerEntitlementCacheState.STALE_WITHIN_GRACE ->
                MosaicCustomerEntitlementSnapshotState.Available(
                    // Previously active Entitlements stay active inside the grace window and must be
                    // surfaced as stale, so the flag travels with the entry rather than beside it.
                    entry.snapshot.markedStale(),
                    evaluation.state,
                )
            else -> {
                val reason = if (evaluation.clockUnreliable) {
                    MosaicCustomerEntitlementUnavailableReason.CLOCK_UNRELIABLE
                } else {
                    MosaicCustomerEntitlementUnavailableReason.CACHE_EXPIRED
                }
                lastUnavailableReason = reason
                MosaicCustomerEntitlementSnapshotState.Unavailable(reason, entry.snapshot)
            }
        }
    }

    private fun currentCheck(entitlementKey: String): MosaicCustomerEntitlementCheck {
        // Freshness is re-evaluated against the clock at the moment of the question, not at the
        // moment of the last sync. A cache that was fresh when it arrived and has since crossed
        // `validUntil` must answer as stale or unknown even though nothing has been fetched since,
        // and republishing keeps the observable state and the answer from ever disagreeing.
        accepted?.let { publish(it, evaluate(it)) }
        val current = state.value
        return when (current) {
            MosaicCustomerEntitlementSnapshotState.Loading -> unknownCheck(
                entitlementKey,
                MosaicCustomerEntitlementExplanationCode.PROVIDER_UNAVAILABLE,
                MosaicCustomerUncertaintyReason.STALE_VALIDATION,
                MosaicCustomerEntitlementCacheState.MISSING,
            )
            MosaicCustomerEntitlementSnapshotState.SignedOut -> MosaicCustomerEntitlementCheck(
                entitlementKey = entitlementKey,
                state = MosaicCustomerEntitlementState.Unavailable(
                    MosaicCustomerEntitlementExplanation(
                        MosaicCustomerEntitlementExplanationCode.IDENTITY_UNRESOLVED,
                    ),
                    MosaicCustomerUncertainty(
                        MosaicCustomerUncertaintyReason.IDENTITY_UNRESOLVED,
                        since = null,
                    ).definite(),
                ),
                sourceCount = 0,
                snapshotVersion = null,
                asOf = null,
                cacheState = MosaicCustomerEntitlementCacheState.MISSING,
            )
            is MosaicCustomerEntitlementSnapshotState.Unavailable -> unknownCheck(
                entitlementKey,
                MosaicCustomerEntitlementExplanationCode.PROVIDER_EVIDENCE_STALE,
                MosaicCustomerUncertaintyReason.STALE_VALIDATION,
                when (current.reason) {
                    MosaicCustomerEntitlementUnavailableReason.CACHE_EXPIRED,
                    MosaicCustomerEntitlementUnavailableReason.CLOCK_UNRELIABLE,
                    -> MosaicCustomerEntitlementCacheState.EXPIRED
                    MosaicCustomerEntitlementUnavailableReason.SNAPSHOT_REJECTED ->
                        MosaicCustomerEntitlementCacheState.INVALID
                    else -> MosaicCustomerEntitlementCacheState.MISSING
                },
                snapshotVersion = current.lastKnown?.snapshotVersion,
                asOf = current.lastKnown?.asOf,
            )
            is MosaicCustomerEntitlementSnapshotState.Available -> {
                // The snapshot published under a grace window already carries its staleness on the
                // entries, so a check never has to recompute it and the two can never disagree.
                val entry = current.snapshot.entry(entitlementKey)
                MosaicCustomerEntitlementCheck(
                    entitlementKey = entitlementKey,
                    // An absent entry is not a decision. A sync may have been narrowed with
                    // `requestedEntitlementKeys`, an Entitlement may have been defined after this
                    // snapshot was projected, or the key may simply be misspelled — and none of
                    // those is Mosaic saying the customer does not have it. `inactive` is reported
                    // only when a snapshot carries an entry that says so, so that a typo in a key
                    // can never silently revoke a paying customer's access.
                    state = entry?.state ?: MosaicCustomerEntitlementState.Unknown(
                        MosaicCustomerEntitlementExplanation(
                            MosaicCustomerEntitlementExplanationCode.NO_QUALIFYING_SOURCE,
                        ),
                        MosaicCustomerUncertainty(MosaicCustomerUncertaintyReason.MISSING_FACT).definite(),
                    ),
                    sourceCount = entry?.sourceCount ?: 0,
                    snapshotVersion = current.snapshot.snapshotVersion,
                    asOf = current.snapshot.asOf,
                    cacheState = current.cacheState,
                    isTestSource = entry?.sourceIds.orEmpty()
                        .mapNotNull(current.snapshot::source)
                        .any { it.isTestSource },
                )
            }
        }
    }

    private fun unknownCheck(
        entitlementKey: String,
        explanation: MosaicCustomerEntitlementExplanationCode,
        reason: MosaicCustomerUncertaintyReason,
        cacheState: MosaicCustomerEntitlementCacheState,
        snapshotVersion: Long? = null,
        asOf: String? = null,
    ) = MosaicCustomerEntitlementCheck(
        entitlementKey = entitlementKey,
        state = MosaicCustomerEntitlementState.Unknown(
            MosaicCustomerEntitlementExplanation(explanation),
            MosaicCustomerUncertainty(reason).definite(),
        ),
        sourceCount = 0,
        snapshotVersion = snapshotVersion,
        asOf = asOf,
        cacheState = cacheState,
    )
}

/** A non-definite state must remain explainable, so a locally produced uncertainty states when. */
private fun MosaicCustomerUncertainty.definite(): MosaicCustomerUncertainty =
    if (since != null) this else copy(since = mosaicAnalyticsTimestamp(System.currentTimeMillis()))

/**
 * Marks previously active Entitlements as stale.
 *
 * A grace-window grant is still a grant, and the contract requires it to be surfaced as stale rather
 * than silently served: the host is entitled to decide that an irreversible action needs a
 * server-confirmed answer instead.
 */
private fun MosaicCustomerEntitlementSnapshot.markedStale(): MosaicCustomerEntitlementSnapshot =
    copy(
        entries = entries.map { entry ->
            when (val current = entry.state) {
                is MosaicCustomerEntitlementState.Active -> entry.copy(state = current.copy(isStale = true))
                else -> entry
            }
        },
    )
