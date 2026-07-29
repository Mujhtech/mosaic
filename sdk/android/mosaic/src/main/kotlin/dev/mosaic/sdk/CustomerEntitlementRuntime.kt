package dev.mosaic.sdk

import java.time.format.DateTimeParseException

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
    return try {
        java.time.Instant.parse(value).toEpochMilli()
    } catch (cause: DateTimeParseException) {
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
