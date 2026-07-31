package dev.mosaic.sdk

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.launch

/**
 * What the native provider restore itself did, independently of what Mosaic could conclude from it.
 *
 * The two axes are separate because they answer different questions and routinely disagree: a
 * native restore can complete perfectly while Mosaic has not yet validated the recovered purchases,
 * and reporting that as success would promise an authoritative answer that does not exist yet.
 */
enum class MosaicCustomerRestoreProviderOutcome {
    COMPLETED,
    NO_PURCHASES_FOUND,
    CANCELLED,
    FAILED,
    UNSUPPORTED,
    NOT_ATTEMPTED,
}

/** The outcome of a restore composed with an authoritative synchronization. */
sealed interface MosaicCustomerSyncResult {
    val providerOutcome: MosaicCustomerRestoreProviderOutcome

    /**
     * The only success. It is produced when — and only when — Mosaic accepted a snapshot that
     * reflects the recovery, which is what makes the outcome authoritative rather than hopeful.
     */
    data class AuthoritativeEntitlementsUpdated(
        override val providerOutcome: MosaicCustomerRestoreProviderOutcome,
        val snapshot: MosaicCustomerEntitlementSnapshot,
    ) : MosaicCustomerSyncResult

    /**
     * The device recovered purchases and Mosaic has not confirmed them yet.
     *
     * This is not a failure and must not be presented as one: validation is asynchronous, and the
     * snapshot will advance on its own. It is reported honestly so a host does not tell someone
     * their purchase was restored when Mosaic would still answer `unknown`.
     */
    data class NativeRecoveryCompleted(
        override val providerOutcome: MosaicCustomerRestoreProviderOutcome,
        val validationPending: Boolean = true,
    ) : MosaicCustomerSyncResult

    data class NoAdditionalPurchases(
        override val providerOutcome: MosaicCustomerRestoreProviderOutcome,
    ) : MosaicCustomerSyncResult

    data object Cancelled : MosaicCustomerSyncResult {
        override val providerOutcome = MosaicCustomerRestoreProviderOutcome.CANCELLED
    }

    data class ProviderUnavailable(
        override val providerOutcome: MosaicCustomerRestoreProviderOutcome,
        val diagnosticCode: String,
    ) : MosaicCustomerSyncResult

    data class Failed(
        override val providerOutcome: MosaicCustomerRestoreProviderOutcome,
        val diagnosticCode: String,
    ) : MosaicCustomerSyncResult

    /** The store recovered purchases but Mosaic cannot say whose they are. Never "not entitled". */
    data class CustomerUnavailable(
        override val providerOutcome: MosaicCustomerRestoreProviderOutcome,
        val reason: MosaicCustomerEntitlementUnavailableReason,
    ) : MosaicCustomerSyncResult

    data object SignedOut : MosaicCustomerSyncResult {
        override val providerOutcome = MosaicCustomerRestoreProviderOutcome.NOT_ATTEMPTED
    }
}

/** Cross-platform poll bound: three attempts inside roughly six seconds. */
internal const val MOSAIC_CUSTOMER_RESTORE_POLL_ATTEMPTS = 3
internal const val MOSAIC_CUSTOMER_RESTORE_POLL_INTERVAL_MILLIS = 2_000L

/**
 * Restores through the provider, then waits briefly for Mosaic to catch up.
 *
 * The recovery itself is the existing Commerce Provider Contract path — on Google Play, the
 * `queryPurchases` recovery — and it is untouched here. Acknowledgement in particular is not
 * involved: Google's refund window is governed by the adapter, and nothing in this function delays
 * or re-runs it. Observations reach Mosaic through the Transaction Observation runtime that already
 * exists, so this function adds a wait, not a second submission path.
 *
 * The poll is bounded rather than open-ended because validation is genuinely asynchronous. Waiting
 * longer would make a restore button feel broken; not waiting at all would report
 * `validationPending` for every restore that was about to succeed a second later.
 */
internal suspend fun mosaicRestoreAndSyncCustomerEntitlements(
    runtime: MosaicCustomerEntitlementRuntime,
    provider: MosaicPurchaseProvider,
    pollAttempts: Int = MOSAIC_CUSTOMER_RESTORE_POLL_ATTEMPTS,
    pollIntervalMillis: Long = MOSAIC_CUSTOMER_RESTORE_POLL_INTERVAL_MILLIS,
): MosaicCustomerSyncResult {
    val versionBefore = (runtime.customerEntitlements.value as? MosaicCustomerEntitlementSnapshotState.Available)
        ?.snapshot?.snapshotVersion

    val restore = runCatching { provider.restore() }.getOrElse {
        return MosaicCustomerSyncResult.Failed(
            MosaicCustomerRestoreProviderOutcome.FAILED,
            MosaicDiagnosticCode.RESTORE_FAILED.wireName,
        )
    }

    when (val outcome = restore.providerOutcome()) {
        MosaicCustomerRestoreProviderOutcome.CANCELLED -> return MosaicCustomerSyncResult.Cancelled
        MosaicCustomerRestoreProviderOutcome.FAILED -> return MosaicCustomerSyncResult.Failed(
            outcome,
            restore.diagnosticCode(),
        )
        MosaicCustomerRestoreProviderOutcome.UNSUPPORTED,
        MosaicCustomerRestoreProviderOutcome.NOT_ATTEMPTED,
        -> return MosaicCustomerSyncResult.ProviderUnavailable(outcome, restore.diagnosticCode())
        MosaicCustomerRestoreProviderOutcome.NO_PURCHASES_FOUND -> {
            // Still worth one sync: the store found nothing new on this device, but Mosaic may hold
            // a newer projection from another device or from a server-side notification.
            val synced = runtime.refreshCustomerEntitlements()
            return synced.asUpdated(outcome, versionBefore)
                ?: MosaicCustomerSyncResult.NoAdditionalPurchases(outcome)
        }
        MosaicCustomerRestoreProviderOutcome.COMPLETED -> Unit
    }

    repeat(pollAttempts) { attempt ->
        val result = runtime.refreshCustomerEntitlements()
        when (result) {
            is MosaicCustomerEntitlementSyncResult.SignedOut -> return MosaicCustomerSyncResult.SignedOut
            is MosaicCustomerEntitlementSyncResult.Unauthorized -> return MosaicCustomerSyncResult.CustomerUnavailable(
                MosaicCustomerRestoreProviderOutcome.COMPLETED,
                MosaicCustomerEntitlementUnavailableReason.UNAUTHORIZED,
            )
            else -> Unit
        }
        result.asUpdated(MosaicCustomerRestoreProviderOutcome.COMPLETED, versionBefore)?.let { return it }
        if (attempt < pollAttempts - 1) delay(pollIntervalMillis)
    }

    // The device recovered purchases Mosaic has not validated yet. Saying so is the honest answer;
    // claiming a restore would promise an entitlement the SDK has no evidence for.
    return MosaicCustomerSyncResult.NativeRecoveryCompleted(
        MosaicCustomerRestoreProviderOutcome.COMPLETED,
        validationPending = true,
    )
}

/** An accepted snapshot counts only when it actually advanced past the version the restore started at. */
private fun MosaicCustomerEntitlementSyncResult.asUpdated(
    providerOutcome: MosaicCustomerRestoreProviderOutcome,
    versionBefore: Long?,
): MosaicCustomerSyncResult.AuthoritativeEntitlementsUpdated? {
    val snapshot = (this as? MosaicCustomerEntitlementSyncResult.Updated)?.snapshot ?: return null
    if (versionBefore != null && snapshot.snapshotVersion <= versionBefore) return null
    return MosaicCustomerSyncResult.AuthoritativeEntitlementsUpdated(providerOutcome, snapshot)
}

private fun MosaicRestoreResult.providerOutcome(): MosaicCustomerRestoreProviderOutcome = when (this) {
    is MosaicRestoreResult.Detailed -> when (outcome) {
        MosaicCommerceRecoveryOutcome.RESTORED -> MosaicCustomerRestoreProviderOutcome.COMPLETED
        MosaicCommerceRecoveryOutcome.NOTHING_TO_RESTORE -> MosaicCustomerRestoreProviderOutcome.NO_PURCHASES_FOUND
        MosaicCommerceRecoveryOutcome.CANCELLED -> MosaicCustomerRestoreProviderOutcome.CANCELLED
        MosaicCommerceRecoveryOutcome.PROVIDER_UNAVAILABLE -> MosaicCustomerRestoreProviderOutcome.UNSUPPORTED
        MosaicCommerceRecoveryOutcome.FAILED -> MosaicCustomerRestoreProviderOutcome.FAILED
    }
    is MosaicRestoreResult.Restored -> MosaicCustomerRestoreProviderOutcome.COMPLETED
    MosaicRestoreResult.NothingToRestore -> MosaicCustomerRestoreProviderOutcome.NO_PURCHASES_FOUND
    MosaicRestoreResult.Cancelled -> MosaicCustomerRestoreProviderOutcome.CANCELLED
    is MosaicRestoreResult.ProviderUnavailable -> MosaicCustomerRestoreProviderOutcome.UNSUPPORTED
    is MosaicRestoreResult.Failed -> MosaicCustomerRestoreProviderOutcome.FAILED
}

private fun MosaicRestoreResult.diagnosticCode(): String = when (this) {
    is MosaicRestoreResult.ProviderUnavailable -> diagnosticCode
    is MosaicRestoreResult.Failed -> diagnosticCode
    is MosaicRestoreResult.Detailed -> metadata.diagnostics.firstOrNull()?.code
        ?: MosaicDiagnosticCode.RESTORE_FAILED.wireName
    else -> MosaicDiagnosticCode.RESTORE_FAILED.wireName
}

/**
 * Refreshes authoritative entitlements shortly after a purchase completes.
 *
 * Three properties are load-bearing, and they are the same ones the Transaction Observation runtime
 * protects:
 *
 * 1. **It never blocks or delays a purchase.** This is a *subscriber* to the adapter's update flow
 *    with its own bounded buffer, so a hung, slow, or hostile endpoint degrades to a missed refresh
 *    rather than to a stalled purchase. Nothing on the purchase path ever awaits it.
 * 2. **It coalesces.** A purchase commonly produces several updates, and a foreground transition
 *    frequently coincides; one refresh answers all of them.
 * 3. **It changes nothing about entitlement.** The refresh either produces an accepted snapshot or
 *    it does not; a failure here is invisible to the purchase result.
 */
internal class MosaicCustomerPurchaseRefresh(
    private val runtime: MosaicCustomerEntitlementRuntime,
    private val debounceMillis: Long = 1_500,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val pending = AtomicBoolean(false)

    fun collect(updates: Flow<MosaicCommerceUpdate>) {
        scope.launch {
            updates
                // An explicit subscriber buffer: the emitting adapter is never suspended by this
                // collector, and the oldest update is dropped rather than the newest, because the
                // newest is the one worth refreshing for.
                .buffer(capacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
                .collect { update -> observe(update) }
        }
    }

    fun collectPurchaseCompletions(updates: Flow<Unit>) {
        scope.launch {
            updates.buffer(capacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
                .collect { observePurchaseCompletion() }
        }
    }

    private fun observePurchaseCompletion() {
        if (!pending.compareAndSet(false, true)) return
        scope.launch {
            delay(debounceMillis)
            pending.set(false)
            runCatching { runtime.refreshCustomerEntitlements() }
        }
    }

    private fun observe(update: MosaicCommerceUpdate) {
        if (update.outcome != MosaicCommerceUpdateOutcome.PURCHASED &&
            update.outcome != MosaicCommerceUpdateOutcome.ENTITLEMENTS_CHANGED
        ) {
            return
        }
        observePurchaseCompletion()
    }

    fun close() {
        scope.cancel()
    }
}
