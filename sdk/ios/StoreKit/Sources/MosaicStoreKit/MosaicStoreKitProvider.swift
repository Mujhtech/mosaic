import Foundation
import MosaicSDK
@preconcurrency import StoreKit

public let mosaicStoreKitAdapterVersion = "1.0.0"

public actor MosaicStoreKitProvider:
  MosaicAsynchronousCommerceProvider, MosaicCommerceRecoveryProvider
{
  public nonisolated let identity = MosaicCommerceProviderIdentity(
    id: "app_store",
    displayName: "StoreKit",
    adapterVersion: mosaicStoreKitAdapterVersion
  )

  public nonisolated let capabilities: [MosaicCommerceCapability] = [
    .init(name: .productLoading, support: .supported),
    .init(name: .subscriptions, support: .supported),
    .init(name: .oneTimeNonConsumables, support: .supported),
    .init(name: .trials, support: .supported),
    .init(name: .introductoryOffers, support: .supported),
    .init(
      name: .promotionalOffers,
      support: .conditional,
      reasonCode: "provider.configurationRequired"
    ),
    .init(name: .restore, support: .supported),
    .init(name: .activeEntitlementLookup, support: .supported),
    .init(name: .pendingPurchases, support: .supported),
    .init(
      name: .deferredPurchases,
      support: .unsupported,
      reasonCode: "provider.outcomeUnavailable"
    ),
    .init(
      name: .serverConfirmedTransactions,
      support: .unsupported,
      reasonCode: "provider.serverValidationExcluded"
    ),
    .init(
      name: .productSynchronization,
      support: .unsupported,
      reasonCode: "provider.serverSynchronizationUnavailable"
    ),
    .init(name: .providerDiagnostics, support: .supported),
    .init(
      name: .basePlans,
      support: .unsupported,
      reasonCode: "provider.capabilityUnavailable"
    ),
    .init(
      name: .explicitOffers,
      support: .unsupported,
      reasonCode: "provider.capabilityUnavailable"
    ),
    .init(name: .storeSynchronization, support: .supported),
    .init(
      name: .activePurchaseRecovery,
      support: .unsupported,
      reasonCode: "provider.recoveryModeUnavailable"
    ),
    .init(name: .asynchronousCommerceUpdates, support: .supported),
    .init(name: .localDeliveryAcceptance, support: .supported),
  ]

  public var commerceUpdates: AsyncStream<MosaicCommerceUpdate> {
    get async { updates }
  }

  private let client: any StoreKitClient
  private let acceptor: any MosaicCommerceUpdateAcceptor
  private let acceptanceStore: any MosaicStoreKitAcceptanceStore
  private let updates: AsyncStream<MosaicCommerceUpdate>
  private let updateContinuation: AsyncStream<MosaicCommerceUpdate>.Continuation

  private var configuration: MosaicCommerceConfigurationReference?
  private var mappingsByMosaicID: [String: MosaicCommerceProductMapping] = [:]
  private var mappingsByStoreID: [String: MosaicCommerceProductMapping] = [:]
  private var loaded: [String: StoreKitProductSnapshot] = [:]
  private var loadGeneration = 0
  private var installGeneration = 0
  private var diagnostics: [MosaicCommerceDiagnostic] = []
  private var diagnosticSequence = 0
  private var observerTask: Task<Void, Never>?
  private var observationSink: (any MosaicTransactionObservationSink)?

  public init(
    acceptor: any MosaicCommerceUpdateAcceptor,
    acceptanceStore: (any MosaicStoreKitAcceptanceStore)? = nil
  ) throws {
    self.acceptor = acceptor
    self.acceptanceStore =
      try acceptanceStore ?? MosaicStoreKitFileAcceptanceStore.defaultStore()
    client = LiveStoreKitClient()
    (updates, updateContinuation) = AsyncStream.makeStream(
      bufferingPolicy: .bufferingNewest(64)
    )
  }

  init(
    client: any StoreKitClient,
    acceptor: any MosaicCommerceUpdateAcceptor,
    acceptanceStore: any MosaicStoreKitAcceptanceStore,
    observationSink: (any MosaicTransactionObservationSink)? = nil
  ) {
    self.client = client
    self.acceptor = acceptor
    self.acceptanceStore = acceptanceStore
    self.observationSink = observationSink
    (updates, updateContinuation) = AsyncStream.makeStream(
      bufferingPolicy: .bufferingNewest(64)
    )
  }

  /// Opts this provider in to the Mosaic transaction-observation handoff.
  ///
  /// Observations are off unless a sink is attached. Pass
  /// `Mosaic.transactionObservationSink()`, which is `nil` unless the host
  /// configured `transactionObservations: .enabled`. Attaching a sink never
  /// changes a purchase result, a restore result, or the reported capability
  /// matrix: a StoreKit-verified purchase is still a local result, and
  /// `serverConfirmedTransactions` stays `unsupported`.
  public func attachTransactionObservationSink(
    _ sink: (any MosaicTransactionObservationSink)?
  ) {
    observationSink = sink
  }

  deinit {
    observerTask?.cancel()
    updateContinuation.finish()
  }

  public func install(
    configuration: MosaicCommerceConfigurationReference,
    mappings: [MosaicCommerceProductMapping]
  ) async throws {
    guard Self.isDigest(configuration.configurationRevision) else {
      throw MosaicStoreKitInstallationError.invalidConfigurationRevision
    }
    var mosaicIDs = Set<String>()
    var mappingIDs = Set<String>()
    var storeIDs = Set<String>()
    var nextByMosaicID: [String: MosaicCommerceProductMapping] = [:]
    var nextByStoreID: [String: MosaicCommerceProductMapping] = [:]
    for mapping in mappings {
      guard case .storeKitProduct = mapping.adapterMapping,
        mapping.productType == .subscription
          || mapping.productType == .oneTimeNonConsumable,
        !mapping.entitlementKeys.isEmpty,
        mosaicIDs.insert(mapping.mosaicProductID).inserted,
        mappingIDs.insert(mapping.mappingID).inserted,
        storeIDs.insert(mapping.providerProductReference).inserted
      else {
        throw MosaicStoreKitInstallationError.invalidOrDuplicateMapping
      }
      nextByMosaicID[mapping.mosaicProductID] = mapping
      nextByStoreID[mapping.providerProductReference] = mapping
    }

    installGeneration += 1
    loadGeneration += 1
    loaded = [:]
    self.configuration = configuration
    mappingsByMosaicID = nextByMosaicID
    mappingsByStoreID = nextByStoreID
    startObserverIfNeeded()
    await recoverUnfinished()
  }

  public func invalidateLoadedProducts() {
    loadGeneration += 1
    loaded = [:]
  }

  public func loadProducts(
    mappings: [MosaicCommerceProductMapping]
  ) async -> [MosaicCommerceResolvedProduct] {
    loadGeneration += 1
    let generation = loadGeneration
    loaded = [:]
    let requested = mappings.filter {
      guard case .storeKitProduct = $0.adapterMapping else { return false }
      return true
    }
    let snapshots: [StoreKitProductSnapshot]
    do {
      snapshots = try await client.products(
        identifiers: requested.map(\.providerProductReference)
      )
    } catch {
      return mappings.map { unavailable($0, reason: .providerUnavailable) }
    }
    guard generation == loadGeneration else {
      return mappings.map { unavailable($0, reason: .temporarilyUnavailable) }
    }
    let byID = Dictionary(grouping: snapshots, by: \.storeProductID)
    return mappings.map { mapping in
      guard case .storeKitProduct = mapping.adapterMapping,
        mapping.productType == .subscription || mapping.productType == .oneTimeNonConsumable
      else {
        return unavailable(mapping, reason: .unsupportedProductType)
      }
      let candidates = byID[mapping.providerProductReference] ?? []
      guard candidates.count == 1, let snapshot = candidates.first else {
        return unavailable(
          mapping,
          reason: candidates.isEmpty ? .productNotFound : .mappingInvalid
        )
      }
      guard let storeType = snapshot.type else {
        return unavailable(mapping, reason: .unsupportedProductType)
      }
      guard storeType == mapping.productType else {
        return unavailable(mapping, reason: .mappingInvalid)
      }
      loaded[mapping.mosaicProductID] = snapshot
      if snapshot.unknownPeriodUnit {
        // The product stays purchasable. Only the period text is omitted, so
        // the paywall cannot state a renewal cadence Mosaic could not read.
        record(
          code: "commerce.unsupportedSubscriptionPeriod",
          message: "StoreKit reported a subscription period unit Mosaic does not support.",
          providerCode: "unknown_period_unit",
          retryable: false,
          mosaicProductID: mapping.mosaicProductID
        )
      }
      return MosaicCommerceResolvedProduct(
        mosaicProductID: mapping.mosaicProductID,
        product: MosaicProduct(
          id: mapping.mosaicProductID,
          title: snapshot.displayName,
          localizedPrice: snapshot.displayPrice,
          localizedSubscriptionPeriod: snapshot.localizedPeriod,
          currencyCode: snapshot.currencyCode,
          billingPeriod: snapshot.billingPeriod,
          trial: snapshot.trial,
          introductoryOffer: snapshot.introductoryOffer
        ),
        availability: .init(status: .available)
      )
    }
  }

  public func purchase(mosaicProductID: String) async -> MosaicPurchaseResult {
    guard let snapshot = loaded[mosaicProductID],
      let mapping = mappingsByMosaicID[mosaicProductID],
      let configuration
    else {
      return .productUnavailable(productID: mosaicProductID)
    }
    let operationID = "storekit_purchase_\(UUID().uuidString.lowercased())"
    let generation = installGeneration
    do {
      switch try await client.purchase(handle: snapshot.handle) {
      case .verified(let transaction):
        let accepted = await acceptAndFinish(
          transaction,
          mapping: mapping,
          configuration: configuration,
          installGeneration: generation,
          operationID: operationID,
          emitsUpdate: false
        )
        return accepted
          ? .purchased(
            productID: mosaicProductID,
            transactionID: transaction.safeReference
          )
          : failed(
            productID: mosaicProductID,
            code: "commerce.localDeliveryFailed",
            providerCode: "local_acceptance_rejected",
            retryable: true
          )
      case .unverified:
        return failed(
          productID: mosaicProductID,
          code: "commerce.purchaseVerificationFailed",
          providerCode: "unverified_transaction",
          retryable: false
        )
      case .pending:
        return .pending(productID: mosaicProductID, transactionID: nil)
      case .cancelled:
        return .cancelled(productID: mosaicProductID)
      }
    } catch {
      let failure = StoreKitFailure(error)
      switch failure.kind {
      case .cancelled:
        return .cancelled(productID: mosaicProductID)
      case .pending:
        return .pending(productID: mosaicProductID, transactionID: nil)
      case .productUnavailable:
        return .productUnavailable(productID: mosaicProductID)
      case .providerUnavailable:
        let diagnostic = record(
          code: "commerce.providerUnavailable",
          message: "StoreKit is temporarily unreachable.",
          providerCode: failure.providerCode,
          retryable: true,
          mosaicProductID: mosaicProductID
        )
        return .providerUnavailable(
          productID: mosaicProductID,
          diagnosticCode: diagnostic.code,
          diagnostic: diagnostic
        )
      case .failed:
        return failed(
          productID: mosaicProductID,
          code: "commerce.purchaseFailed",
          providerCode: failure.providerCode,
          retryable: failure.retryable
        )
      }
    }
  }

  public func restore(
    entitlementMappings _: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicRestoreResult {
    await recover(entitlementMappings: []).restoreResult
  }

  public func recover(
    entitlementMappings _: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicCommerceRecoveryResult {
    let operationID = "storekit_recovery_\(UUID().uuidString.lowercased())"
    let completed:
      (
        outcome: MosaicCommerceRecoveryOutcome,
        entitlements: Set<MosaicEntitlement>,
        diagnostics: [MosaicCommerceDiagnostic]
      )
    do {
      try await client.synchronize()
      switch await currentEntitlements() {
      case .success(let resolved):
        // The restore gap this closes: without emitting here, a fresh device
        // that restores a subscription submits nothing to Mosaic, so the
        // purchase is never associated with the Billing Customer and the
        // authoritative snapshot never learns the customer has access. The
        // purchase path emits on acceptance; the restore path had no
        // equivalent, because a restored transaction is usually already
        // finished and so never appears in `Transaction.updates`.
        observeRestored(resolved.transactions, operationID: operationID)
        completed =
          resolved.keys.isEmpty
          ? (.nothingToRestore, [], [])
          : (.restored, Set(resolved.keys.map(MosaicEntitlement.init(id:))), [])
      case .failure(let error):
        completed = recoveryFailure(error)
      }
    } catch {
      completed = recoveryFailure(error)
    }
    return MosaicCommerceRecoveryResult(
      operationID: operationID,
      providerID: identity.id,
      outcome: completed.outcome,
      recoveryMode: .storeSynchronization,
      activeEntitlements: completed.entitlements,
      completedAt: Date(),
      diagnostics: completed.diagnostics
    )
  }

  public func activeEntitlements(
    entitlementMappings _: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicActiveEntitlementsResult {
    switch await currentEntitlementKeys() {
    case .success(let keys):
      return .available(Set(keys.map(MosaicEntitlement.init(id:))))
    case .failure:
      let diagnostic = record(
        code: "commerce.entitlementLookupFailed",
        message: "StoreKit could not verify active access.",
        providerCode: "verification_failed",
        retryable: true
      )
      return .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
    }
  }

  public func providerDiagnostics() -> MosaicCommerceProviderDiagnostics {
    .init(
      providerID: identity.id,
      health: diagnostics.isEmpty ? .healthy : .degraded,
      diagnostics: diagnostics
    )
  }

  private func startObserverIfNeeded() {
    guard observerTask == nil else { return }
    let stream = client.transactionUpdates()
    observerTask = Task { [weak self] in
      for await event in stream {
        guard !Task.isCancelled else { return }
        await self?.processObserved(event)
      }
    }
  }

  private func recoverUnfinished() async {
    for await event in client.unfinishedTransactions() {
      await processObserved(event)
    }
  }

  private func processObserved(_ event: StoreKitTransactionEvent) async {
    guard case .verified(let transaction) = event,
      let mapping = mappingsByStoreID[transaction.storeProductID],
      let configuration
    else {
      if case .unverified = event {
        _ = record(
          code: "commerce.purchaseVerificationFailed",
          message: "StoreKit returned an unverified transaction.",
          providerCode: "unverified_transaction",
          retryable: false
        )
      }
      return
    }
    _ = await acceptAndFinish(
      transaction,
      mapping: mapping,
      configuration: configuration,
      installGeneration: installGeneration,
      operationID: nil,
      emitsUpdate: true
    )
  }

  private func acceptAndFinish(
    _ transaction: StoreKitTransaction,
    mapping: MosaicCommerceProductMapping,
    configuration: MosaicCommerceConfigurationReference,
    installGeneration: Int,
    operationID: String?,
    emitsUpdate: Bool
  ) async -> Bool {
    let updateID = "storekit_transaction_\(transaction.id)"
    do {
      if try await acceptanceStore.contains(updateID) {
        guard isCurrent(installGeneration, configuration: configuration) else {
          recordStaleConfiguration(mapping: mapping)
          return false
        }
        try await client.finish(transactionID: transaction.id)
        return true
      }
      let update = MosaicCommerceUpdate(
        id: updateID,
        operationID: operationID,
        providerID: identity.id,
        mosaicProductID: mapping.mosaicProductID,
        configuration: configuration,
        outcome: .purchased,
        transactionReference: transaction.safeReference,
        activeEntitlementKeys: Set(mapping.entitlementKeys),
        occurredAt: transaction.occurredAt
      )
      let disposition = try await acceptor.accept(update)
      guard disposition.authorizesFinalization else {
        switch disposition {
        case .rejectedStaleConfiguration:
          recordStaleConfiguration(mapping: mapping)
        case .deliveryFailed:
          _ = record(
            code: "commerce.localDeliveryFailed",
            message: "StoreKit purchase delivery is waiting to be retried.",
            providerCode: "local_acceptance_delivery_failed",
            retryable: true,
            mosaicProductID: mapping.mosaicProductID
          )
        case .accepted, .alreadyAccepted:
          break
        }
        return false
      }
      guard isCurrent(installGeneration, configuration: configuration) else {
        recordStaleConfiguration(mapping: mapping)
        return false
      }
      try await acceptanceStore.insert(updateID)
      guard isCurrent(installGeneration, configuration: configuration) else {
        recordStaleConfiguration(mapping: mapping)
        return false
      }
      // One choke point covers foreground purchases, `Transaction.updates`,
      // and unfinished-transaction recovery, and inherits the acceptance
      // store's de-duplication. The call is synchronous by contract so the
      // purchase path cannot suspend on it.
      observe(transaction, updateID: updateID, operationID: operationID)
      if emitsUpdate {
        updateContinuation.yield(update)
      }
      try await client.finish(transactionID: transaction.id)
      return true
    } catch {
      _ = record(
        code: "commerce.localDeliveryFailed",
        message: "StoreKit purchase delivery is waiting to be retried.",
        providerCode: "acceptance_or_finish_failed",
        retryable: true,
        mosaicProductID: mapping.mosaicProductID
      )
      return false
    }
  }

  /// Hands one locally accepted transaction to the observation queue.
  ///
  /// The submitted reference is the raw decimal `Transaction.id`, which is what
  /// Apple's transaction lookup accepts; the prefixed `safeReference` stays on
  /// the host-facing `MosaicCommerceUpdate`. Nothing else about the transaction
  /// is submitted — in particular the Store Environment is read here only to
  /// suppress Xcode transactions, and is never asserted on the wire. Sandbox
  /// and production classification is the server's job during validation.
  private func observe(
    _ transaction: StoreKitTransaction, updateID: String, operationID: String?
  ) {
    guard let observationSink else { return }
    // StoreKit Testing in Xcode produces no App Store record, so submitting one
    // would be guaranteed rejection noise.
    guard transaction.environment != .localTesting else { return }
    guard
      let observation = MosaicTransactionObservation(
        submissionID: updateID,
        referenceKind: .appStoreTransactionID,
        reference: transaction.providerTransactionID,
        providerID: identity.id,
        // Correlation uses the existing opaque handles only, so a validated
        // fact can be joined to the purchase attempt that triggered it.
        correlation: MosaicTransactionObservationCorrelation(
          providerOperationID: operationID, providerUpdateID: updateID)
      )
    else { return }
    observationSink.enqueue(observation)
  }

  /// Emits one observation per restored, mapped transaction.
  ///
  /// Idempotence comes from the two layers that already provide it, so a
  /// customer tapping Restore repeatedly cannot flood the queue or double-grant:
  /// the submission identifier is the same `storekit_transaction_<id>` the
  /// purchase path uses, the observation queue drops a submission identifier it
  /// already holds, and the server de-duplicates by transaction reference during
  /// validation.
  ///
  /// The acceptance store is deliberately *not* written here. It records local
  /// delivery to the host, and a restore is not a delivery; marking these
  /// accepted would make a later genuine purchase of the same transaction skip
  /// the acceptor.
  private func observeRestored(
    _ transactions: [StoreKitTransaction], operationID: String
  ) {
    for transaction in transactions {
      observe(
        transaction,
        updateID: "storekit_transaction_\(transaction.id)",
        operationID: operationID)
    }
  }

  private func currentEntitlementKeys() async -> Result<Set<String>, Error> {
    switch await currentEntitlements() {
    case .success(let resolved): .success(resolved.keys)
    case .failure(let error): .failure(error)
    }
  }

  private func currentEntitlements() async -> Result<
    (keys: Set<String>, transactions: [StoreKitTransaction]), Error
  > {
    do {
      let events = try await client.currentEntitlements()
      var keys = Set<String>()
      var transactions: [StoreKitTransaction] = []
      for event in events {
        guard case .verified(let transaction) = event else {
          return .failure(StoreKitProviderFailure.unverifiedEntitlement)
        }
        guard let mapping = mappingsByStoreID[transaction.storeProductID] else {
          continue
        }
        keys.formUnion(mapping.entitlementKeys)
        transactions.append(transaction)
      }
      return .success((keys, transactions))
    } catch {
      return .failure(error)
    }
  }

  private func unavailable(
    _ mapping: MosaicCommerceProductMapping,
    reason: MosaicCommerceProductAvailabilityReason
  ) -> MosaicCommerceResolvedProduct {
    .init(
      mosaicProductID: mapping.mosaicProductID,
      product: nil,
      availability: .init(status: .unavailable, reason: reason)
    )
  }

  private func failed(
    productID: String,
    code: String,
    providerCode: String,
    retryable: Bool
  ) -> MosaicPurchaseResult {
    let diagnostic = record(
      code: code,
      message: retryable
        ? "StoreKit purchase delivery is waiting to be retried."
        : "StoreKit could not complete the purchase.",
      providerCode: providerCode,
      retryable: retryable,
      mosaicProductID: productID
    )
    return .failed(
      productID: productID,
      diagnosticCode: diagnostic.code,
      diagnostic: diagnostic
    )
  }

  private func restoreFailure() -> MosaicRestoreResult {
    let diagnostic = restoreFailureDiagnostic(StoreKitFailure(StoreKitProviderFailure.unspecified))
    return .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
  }

  /// Classifies a recovery error the same way the purchase path classifies a
  /// purchase error, so a network outage during restore is reported as a
  /// retryable provider outage rather than a permanent restore failure.
  private func recoveryFailure(
    _ error: any Error
  ) -> (
    outcome: MosaicCommerceRecoveryOutcome,
    entitlements: Set<MosaicEntitlement>,
    diagnostics: [MosaicCommerceDiagnostic]
  ) {
    let failure = StoreKitFailure(error)
    switch failure.kind {
    case .cancelled:
      return (.cancelled, [], [])
    case .providerUnavailable:
      return (.providerUnavailable, [], [restoreFailureDiagnostic(failure)])
    case .pending, .productUnavailable, .failed:
      return (.failed, [], [restoreFailureDiagnostic(failure)])
    }
  }

  private func restoreFailureDiagnostic(
    _ failure: StoreKitFailure
  ) -> MosaicCommerceDiagnostic {
    record(
      code: failure.kind == .providerUnavailable
        ? "commerce.providerUnavailable" : "commerce.restoreFailed",
      message: "StoreKit could not synchronize purchases.",
      providerCode: failure.providerCode,
      retryable: failure.retryable
    )
  }

  private func isCurrent(
    _ generation: Int,
    configuration: MosaicCommerceConfigurationReference
  ) -> Bool {
    generation == installGeneration && self.configuration == configuration
  }

  private func recordStaleConfiguration(
    mapping: MosaicCommerceProductMapping
  ) {
    _ = record(
      code: "commerce.staleConfigurationUpdate",
      message: "StoreKit purchase delivery belongs to a replaced configuration.",
      providerCode: "stale_configuration",
      retryable: false,
      mosaicProductID: mapping.mosaicProductID
    )
  }

  private nonisolated static func isDigest(_ value: String) -> Bool {
    value.range(
      of: "^sha256:[0-9a-f]{64}$",
      options: .regularExpression
    ) != nil
  }

  @discardableResult
  private func record(
    code: String,
    message: String,
    providerCode: String,
    retryable: Bool,
    mosaicProductID: String? = nil
  ) -> MosaicCommerceDiagnostic {
    diagnosticSequence += 1
    let diagnostic = MosaicCommerceDiagnostic(
      code: code,
      safeMessage: message,
      severity: .error,
      retryable: retryable,
      correlationID: "ios_storekit_\(diagnosticSequence)",
      providerCode: providerCode,
      mosaicProductID: mosaicProductID,
      recoveryAction: retryable ? .retry : .contactProvider
    )
    if diagnostics.count == 32 { diagnostics.removeFirst() }
    diagnostics.append(diagnostic)
    return diagnostic
  }
}

public enum MosaicStoreKitInstallationError: Error, Sendable, Equatable {
  case invalidConfigurationRevision
  case invalidOrDuplicateMapping
}

enum StoreKitProviderFailure: Error {
  case unverifiedEntitlement
  /// A restore failure with no underlying error to classify.
  case unspecified
}
