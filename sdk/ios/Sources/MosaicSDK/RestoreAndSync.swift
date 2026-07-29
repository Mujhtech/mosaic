import Foundation

/// One observable step of a restore.
///
/// A restore is genuinely two operations — ask the store what this Apple ID
/// owns, then wait for Mosaic to validate and project it — and collapsing them
/// into a single spinner is how a restore flow starts lying to the customer.
public enum MosaicRestoreAndSyncStage: Sendable, Equatable {
  case providerRestoreStarted
  case providerRestoreFinished(MosaicRestoreResult)
  case authoritativeSyncStarted
  case authoritativeSnapshotAccepted(snapshotVersion: Int64)
  /// The native restore succeeded but Mosaic has not yet projected it. The
  /// attempt count is bounded by the cross-platform poll budget.
  case authoritativeValidationPending(attempts: Int)
  case authoritativeSyncUnavailable(MosaicCustomerUnavailableReason)
}

/// Mosaic's authoritative answer, on its own axis.
///
/// `restored` is admissible only once an accepted snapshot reflects the restored
/// source. A successful native restore whose facts have not been validated yet
/// is `validationPending`, not `restored`: the accepted snapshot is the evidence
/// that makes the outcome authoritative rather than hopeful.
public enum MosaicRestoreAndSyncOutcome: Sendable, Equatable {
  case restored(snapshotVersion: Int64)
  case noAdditionalPurchases
  case validationPending(attempts: Int)
  case identityUnresolved
  case providerUnavailable
  case cancelled
  case failed
}

public struct MosaicRestoreAndSyncResult: Sendable, Equatable {
  public let outcome: MosaicRestoreAndSyncOutcome
  public let stages: [MosaicRestoreAndSyncStage]
  /// What the native provider restore did, carried verbatim and never merged
  /// into the authoritative outcome.
  public let providerResult: MosaicRestoreResult
  /// True only when an accepted snapshot reflects this restore. It is not a
  /// restatement of `outcome`: a host uses it to decide whether to re-read
  /// entitlements, and a hopeful `true` here is how a customer gets shown access
  /// that then disappears.
  public let authoritativeEntitlementsUpdated: Bool
  public let snapshotVersion: Int64?
  public let completedAt: Date
}

/// Runs a restore across the provider and the authoritative sync surface.
struct MosaicCustomerRestoreCoordinator: Sendable {
  let client: MosaicCustomerEntitlementClient
  let clock: @Sendable () -> Date
  let sleep: @Sendable (Duration) async -> Void

  init(
    client: MosaicCustomerEntitlementClient,
    clock: @escaping @Sendable () -> Date = Date.init,
    sleep: @escaping @Sendable (Duration) async -> Void = {
      try? await Task.sleep(for: $0)
    }
  ) {
    self.client = client
    self.clock = clock
    self.sleep = sleep
  }

  func run(
    restore: @Sendable () async -> MosaicRestoreResult
  ) async -> MosaicRestoreAndSyncResult {
    var stages: [MosaicRestoreAndSyncStage] = [.providerRestoreStarted]
    // The version to beat. An accepted snapshot only counts as reflecting this
    // restore if it advanced past what was already known before it started.
    let baseline = await client.snapshot()?.snapshot.snapshotVersion

    let providerResult = await restore()
    stages.append(.providerRestoreFinished(providerResult))

    switch providerResult {
    case .cancelled:
      return finish(.cancelled, stages, providerResult, updated: false, version: baseline)
    case .providerUnavailable:
      return finish(
        .providerUnavailable, stages, providerResult, updated: false, version: baseline)
    case .failed:
      return finish(.failed, stages, providerResult, updated: false, version: baseline)
    case .nothingToRestore, .restored:
      break
    }

    stages.append(.authoritativeSyncStarted)
    // Bounded poll. Validation is asynchronous — the store confirms, Mosaic
    // ingests, projects, and reissues — so the SDK waits briefly rather than
    // either returning a stale answer or spinning indefinitely.
    var attempts = 0
    var lastUnavailable: MosaicCustomerUnavailableReason?
    let interval = Duration.milliseconds(
      Int(MosaicCustomerEntitlementPolicy.restorePollBudgetSeconds * 1000)
        / max(MosaicCustomerEntitlementPolicy.restorePollAttempts, 1))

    while attempts < MosaicCustomerEntitlementPolicy.restorePollAttempts {
      attempts += 1
      switch await client.refresh() {
      case .updated(let version), .unchanged(let version), .skippedFresh(let version),
        .preserved(let version, _):
        // A snapshot reflects this restore only if it advanced past what was
        // already known. A first-ever snapshot (no baseline) is new by
        // definition.
        if baseline.map({ version > $0 }) ?? true {
          stages.append(.authoritativeSnapshotAccepted(snapshotVersion: version))
          return finish(
            .restored(snapshotVersion: version), stages, providerResult, updated: true,
            version: version)
        }
        // Mosaic answered, but not yet with a snapshot that includes the
        // restored source.
        if attempts < MosaicCustomerEntitlementPolicy.restorePollAttempts {
          await sleep(interval)
        }
      case .unavailable(let reason, _):
        lastUnavailable = reason
        if attempts < MosaicCustomerEntitlementPolicy.restorePollAttempts {
          await sleep(interval)
        }
      case .signedOut:
        // No customer means no authoritative answer is even possible.
        stages.append(.authoritativeSyncUnavailable(.signedOut))
        return finish(
          .identityUnresolved, stages, providerResult, updated: false, version: baseline)
      }
    }

    if let lastUnavailable {
      stages.append(.authoritativeSyncUnavailable(lastUnavailable))
      let outcome: MosaicRestoreAndSyncOutcome =
        lastUnavailable == .signedOut || lastUnavailable == .notAuthorized
        ? .identityUnresolved : .validationPending(attempts: attempts)
      return finish(outcome, stages, providerResult, updated: false, version: baseline)
    }

    // The native restore found nothing and Mosaic agrees there is nothing new.
    if case .nothingToRestore = providerResult {
      return finish(
        .noAdditionalPurchases, stages, providerResult, updated: false, version: baseline)
    }
    stages.append(.authoritativeValidationPending(attempts: attempts))
    return finish(
      .validationPending(attempts: attempts), stages, providerResult, updated: false,
      version: baseline)
  }

  private func finish(
    _ outcome: MosaicRestoreAndSyncOutcome,
    _ stages: [MosaicRestoreAndSyncStage],
    _ providerResult: MosaicRestoreResult,
    updated: Bool,
    version: Int64?
  ) -> MosaicRestoreAndSyncResult {
    MosaicRestoreAndSyncResult(
      outcome: outcome,
      stages: stages,
      providerResult: providerResult,
      authoritativeEntitlementsUpdated: updated,
      snapshotVersion: version,
      completedAt: clock())
  }
}
