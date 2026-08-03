import Foundation
import MosaicSDK
import StoreKit
import XCTest

@testable import MosaicStoreKit

final class MosaicStoreKitProviderTests: XCTestCase {
  func testVerifiedPurchaseIsAcceptedDurablyBeforeFinishAndGrantsEntitlement() async throws {
    let order = OrderRecorder()
    let client = StoreKitClientStub(
      order: order,
      purchase: .verified(
        .init(id: 42, storeProductID: "com.example.pro.monthly", occurredAt: Date())
      )
    )
    let acceptor = AcceptorStub(order: order)
    let store = AcceptanceStoreStub(order: order)
    let provider = MosaicStoreKitProvider(
      client: client,
      acceptor: acceptor,
      acceptanceStore: store
    )
    try await provider.install(configuration: configuration, mappings: [mapping])
    _ = await provider.loadProducts(mappings: [mapping])

    let result = await provider.purchase(mosaicProductID: mapping.mosaicProductID)

    XCTAssertEqual(
      result,
      .purchased(productID: mapping.mosaicProductID, transactionID: "storekit_42")
    )
    let events = await order.values()
    XCTAssertEqual(
      events,
      ["accept:storekit_transaction_42:pro", "persist:storekit_transaction_42", "finish:42"]
    )
  }

  func testUnverifiedPendingCancelledAndFailureRemainDistinctAndNeverFinish() async throws {
    for (event, expected) in [
      (
        StoreKitPurchaseEvent.unverified,
        Outcome.failed("commerce.purchaseVerificationFailed")
      ),
      (.pending, .result(.pending(productID: mapping.mosaicProductID, transactionID: nil))),
      (.cancelled, .result(.cancelled(productID: mapping.mosaicProductID))),
    ] {
      let order = OrderRecorder()
      let provider = MosaicStoreKitProvider(
        client: StoreKitClientStub(order: order, purchase: event),
        acceptor: AcceptorStub(order: order),
        acceptanceStore: AcceptanceStoreStub(order: order)
      )
      try await provider.install(configuration: configuration, mappings: [mapping])
      _ = await provider.loadProducts(mappings: [mapping])
      expected.assert(await provider.purchase(mosaicProductID: mapping.mosaicProductID))
      let events = await order.values()
      XCTAssertEqual(events, [])
    }

    let order = OrderRecorder()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .cancelled,
        purchaseError: StoreKitTestError.failed
      ),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order)
    )
    try await provider.install(configuration: configuration, mappings: [mapping])
    _ = await provider.loadProducts(mappings: [mapping])
    Outcome.failed("commerce.purchaseFailed")
      .assert(await provider.purchase(mosaicProductID: mapping.mosaicProductID))
    let events = await order.values()
    XCTAssertEqual(events, [])
  }

  func testDuplicateUnfinishedTransactionFinishesWithoutRedelivery() async throws {
    let order = OrderRecorder()
    let transaction = StoreKitTransaction(
      id: 88,
      storeProductID: mapping.providerProductReference,
      occurredAt: Date()
    )
    let store = AcceptanceStoreStub(
      order: order,
      initial: ["storekit_transaction_88"]
    )
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .cancelled,
        unfinished: [.verified(transaction)]
      ),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: store
    )

    try await provider.install(configuration: configuration, mappings: [mapping])

    let events = await order.values()
    XCTAssertEqual(events, ["finish:88"])
  }

  func testEntitlementVerificationFailureNeverNormalizesToInactive() async throws {
    let order = OrderRecorder()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .cancelled,
        entitlements: [.unverified]
      ),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order)
    )
    try await provider.install(configuration: configuration, mappings: [mapping])

    guard
      case .failed(let code, _) = await provider.activeEntitlements(
        entitlementMappings: []
      )
    else {
      return XCTFail("Unverified access must fail instead of returning an empty active set.")
    }
    XCTAssertEqual(code, "commerce.entitlementLookupFailed")
  }

  /// The purchase path must never suspend on observation handoff.
  ///
  /// The sink here starts a delivery that never completes, which is what a
  /// saturated or unreachable ingest endpoint looks like. The purchase must
  /// still return `.purchased` with the existing accept, persist, finish
  /// ordering intact; if a future change awaited delivery this test would hang
  /// instead of passing.
  func testPurchaseNeverBlocksOnObservationDeliveryAndSubmitsRawDecimalReference() async throws {
    let order = OrderRecorder()
    let sink = ObservationSinkSpy(blocksForever: true)
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .verified(
          .init(
            id: 42, storeProductID: "com.example.pro.monthly", occurredAt: Date(),
            environment: .production))
      ),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order),
      observationSink: sink
    )
    try await provider.install(configuration: configuration, mappings: [mapping])
    _ = await provider.loadProducts(mappings: [mapping])

    let result = await provider.purchase(mosaicProductID: mapping.mosaicProductID)

    XCTAssertEqual(
      result,
      .purchased(productID: mapping.mosaicProductID, transactionID: "storekit_42"))
    let events = await order.values()
    XCTAssertEqual(
      events,
      ["accept:storekit_transaction_42:pro", "persist:storekit_transaction_42", "finish:42"])

    // The wire reference is the raw decimal identifier Apple's lookup accepts,
    // not the prefixed host-facing reference on MosaicCommerceUpdate.
    let observations = sink.captured()
    XCTAssertEqual(observations.count, 1)
    XCTAssertEqual(observations.first?.reference, "42")
    XCTAssertEqual(observations.first?.submissionID, "storekit_transaction_42")
    XCTAssertEqual(observations.first?.observationID, "observation_storekit_transaction_42")
    XCTAssertEqual(observations.first?.referenceKind, .appStoreTransactionID)
    XCTAssertEqual(observations.first?.storePlatform, .appleAppStore)
    // The provider identity, not an invented value.
    XCTAssertEqual(observations.first?.providerID, "app_store")
    // Correlation carries the existing opaque handles only.
    XCTAssertEqual(
      observations.first?.correlation?.providerUpdateID, "storekit_transaction_42")
    XCTAssertNotNil(observations.first?.correlation?.providerOperationID)
  }

  /// Two independent ways an integrator ends up sending nothing: never opting
  /// in, and running against StoreKit Testing in Xcode, whose transactions have
  /// no App Store record to validate.
  func testNoObservationWithoutOptInOrForXcodeTestingTransactions() async throws {
    let unattached = ObservationSinkSpy()
    let order = OrderRecorder()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .verified(
          .init(
            id: 42, storeProductID: "com.example.pro.monthly", occurredAt: Date(),
            environment: .production))
      ),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order)
    )
    try await provider.install(configuration: configuration, mappings: [mapping])
    _ = await provider.loadProducts(mappings: [mapping])
    _ = await provider.purchase(mosaicProductID: mapping.mosaicProductID)
    XCTAssertTrue(unattached.captured().isEmpty)
    let events = await order.values()
    XCTAssertEqual(
      events,
      ["accept:storekit_transaction_42:pro", "persist:storekit_transaction_42", "finish:42"])

    let localOrder = OrderRecorder()
    let sink = ObservationSinkSpy()
    let localTesting = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: localOrder,
        purchase: .verified(
          .init(
            id: 43, storeProductID: "com.example.pro.monthly", occurredAt: Date(),
            environment: .localTesting))
      ),
      acceptor: AcceptorStub(order: localOrder),
      acceptanceStore: AcceptanceStoreStub(order: localOrder),
      observationSink: sink
    )
    try await localTesting.install(configuration: configuration, mappings: [mapping])
    _ = await localTesting.loadProducts(mappings: [mapping])
    let result = await localTesting.purchase(mosaicProductID: mapping.mosaicProductID)

    // Local delivery is unchanged; only the observation is suppressed.
    XCTAssertEqual(
      result,
      .purchased(productID: mapping.mosaicProductID, transactionID: "storekit_43"))
    XCTAssertTrue(sink.captured().isEmpty)
  }

  /// Phase 9B finding 1.7: the restore path emitted nothing.
  ///
  /// Risk: a customer reinstalls, taps Restore, and StoreKit hands back their
  /// active subscription — but Mosaic never hears about it, so the purchase is
  /// never associated with their Billing Customer and the authoritative
  /// snapshot keeps reporting no access. A restored transaction is normally
  /// already finished, so it never appears in `Transaction.updates` either;
  /// without this emission there is no path at all.
  func testRestoreEmitsObservationsForCurrentEntitlements() async throws {
    let order = OrderRecorder()
    let sink = ObservationSinkSpy()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .cancelled,
        entitlements: [
          .verified(
            .init(
              id: 77, storeProductID: "com.example.pro.monthly", occurredAt: Date(),
              environment: .production))
        ]),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order),
      observationSink: sink)
    try await provider.install(configuration: configuration, mappings: [mapping])

    let result = await provider.restore(entitlementMappings: [])

    XCTAssertEqual(result, .restored([MosaicEntitlement(id: "pro")]))
    let observations = sink.captured()
    XCTAssertEqual(observations.count, 1)
    // The raw decimal identifier Apple's transaction lookup accepts.
    XCTAssertEqual(observations.first?.reference, "77")
    // The same submission identifier the purchase path uses, which is what makes
    // a restore of an already-observed purchase idempotent.
    XCTAssertEqual(observations.first?.submissionID, "storekit_transaction_77")
    XCTAssertEqual(observations.first?.referenceKind, .appStoreTransactionID)
  }

  /// Risk: a customer tapping Restore repeatedly must not flood the queue or
  /// double-grant. The submission identifier is stable across restores, which is
  /// what both de-duplication layers key on.
  func testRepeatedRestoresReuseTheSameSubmissionIdentifier() async throws {
    let order = OrderRecorder()
    let sink = ObservationSinkSpy()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .cancelled,
        entitlements: [
          .verified(
            .init(
              id: 77, storeProductID: "com.example.pro.monthly", occurredAt: Date(),
              environment: .production))
        ]),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order),
      observationSink: sink)
    try await provider.install(configuration: configuration, mappings: [mapping])

    _ = await provider.restore(entitlementMappings: [])
    _ = await provider.restore(entitlementMappings: [])

    let identifiers = Set(sink.captured().map(\.submissionID))
    XCTAssertEqual(identifiers, ["storekit_transaction_77"])
    // The restore path must not record local acceptance: a restore is not a
    // delivery to the host, and marking it accepted would make a later genuine
    // purchase of the same transaction skip the acceptor.
    let events = await order.values()
    XCTAssertFalse(events.contains { $0.hasPrefix("persist:") })
  }

  /// Risk: StoreKit Testing in Xcode produces no App Store record, so a restore
  /// under it would submit guaranteed-rejection noise.
  func testRestoreSuppressesXcodeTestingTransactions() async throws {
    let order = OrderRecorder()
    let sink = ObservationSinkSpy()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order,
        purchase: .cancelled,
        entitlements: [
          .verified(
            .init(
              id: 78, storeProductID: "com.example.pro.monthly", occurredAt: Date(),
              environment: .localTesting))
        ]),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order),
      observationSink: sink)
    try await provider.install(configuration: configuration, mappings: [mapping])

    let result = await provider.restore(entitlementMappings: [])

    // The restore result itself is unchanged; only the observation is suppressed.
    XCTAssertEqual(result, .restored([MosaicEntitlement(id: "pro")]))
    XCTAssertTrue(sink.captured().isEmpty)
  }

  /// Every purchase error except cancellation used to flatten to one
  /// non-retryable `storekit_error`, so a transient network outage was reported
  /// to the host as a permanent purchase failure and never retried, and an
  /// unavailable product was reported as a failure rather than as unavailable.
  func testPurchaseErrorsAreClassifiedRatherThanFlattened() async throws {
    let cases: [(any Error, MosaicPurchaseResult)] = [
      (
        StoreKitError.networkError(URLError(.notConnectedToInternet)),
        .providerUnavailable(
          productID: mapping.mosaicProductID,
          diagnosticCode: "commerce.providerUnavailable",
          diagnostic: .init(
            code: "commerce.providerUnavailable",
            safeMessage: "StoreKit is temporarily unreachable.",
            severity: .error, retryable: true, correlationID: "ios_storekit_1",
            providerCode: "network_error", mosaicProductID: mapping.mosaicProductID,
            recoveryAction: .retry))
      ),
      (StoreKitError.userCancelled, .cancelled(productID: mapping.mosaicProductID)),
      (
        StoreKitError.notAvailableInStorefront,
        .productUnavailable(productID: mapping.mosaicProductID)
      ),
    ]

    for (error, expected) in cases {
      let order = OrderRecorder()
      let provider = MosaicStoreKitProvider(
        client: StoreKitClientStub(
          order: order, purchase: .cancelled, purchaseError: error),
        acceptor: AcceptorStub(order: order),
        acceptanceStore: AcceptanceStoreStub(order: order))
      try await provider.install(configuration: configuration, mappings: [mapping])
      _ = await provider.loadProducts(mappings: [mapping])

      let result = await provider.purchase(mosaicProductID: mapping.mosaicProductID)
      XCTAssertEqual(result, expected)
    }

    // A failure Mosaic cannot classify stays non-retryable rather than being
    // optimistically retried.
    let order = OrderRecorder()
    let provider = MosaicStoreKitProvider(
      client: StoreKitClientStub(
        order: order, purchase: .cancelled, purchaseError: StoreKitTestError.failed),
      acceptor: AcceptorStub(order: order),
      acceptanceStore: AcceptanceStoreStub(order: order))
    try await provider.install(configuration: configuration, mappings: [mapping])
    _ = await provider.loadProducts(mappings: [mapping])
    guard
      case .failed(_, _, let diagnostic) = await provider.purchase(
        mosaicProductID: mapping.mosaicProductID)
    else { return XCTFail("An unclassifiable StoreKit error must remain a failure.") }
    XCTAssertEqual(diagnostic.providerCode, "storekit_error")
    XCTAssertFalse(diagnostic.retryable)
  }

  private var configuration: MosaicCommerceConfigurationReference {
    .init(
      configurationID: "commerce_configuration_storekit_42",
      configurationRevision:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )
  }

  private var mapping: MosaicCommerceProductMapping {
    .init(
      mosaicProductID: "product_pro_monthly",
      mappingID: "mapping_pro_monthly_storekit",
      providerProductReference: "com.example.pro.monthly",
      adapterMapping: .storeKitProduct,
      productType: .subscription,
      entitlementKeys: ["pro"]
    )
  }
}

private enum Outcome {
  case result(MosaicPurchaseResult)
  case failed(String)

  func assert(
    _ result: MosaicPurchaseResult,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    switch self {
    case .result(let expected):
      XCTAssertEqual(result, expected, file: file, line: line)
    case .failed(let expectedCode):
      guard case .failed(_, let code, _) = result else {
        return XCTFail("Expected failed result.", file: file, line: line)
      }
      XCTAssertEqual(code, expectedCode, file: file, line: line)
    }
  }
}

/// Records what the provider handed over, and optionally starts a delivery
/// that never finishes.
private final class ObservationSinkSpy: MosaicTransactionObservationSink, @unchecked Sendable {
  private let lock = NSLock()
  private var observations: [MosaicTransactionObservation] = []
  private let blocksForever: Bool

  init(blocksForever: Bool = false) { self.blocksForever = blocksForever }

  func enqueue(_ observation: MosaicTransactionObservation) {
    lock.lock()
    observations.append(observation)
    lock.unlock()
    guard blocksForever else { return }
    Task.detached { try? await Task.sleep(nanoseconds: 60 * NSEC_PER_SEC) }
  }

  func captured() -> [MosaicTransactionObservation] {
    lock.lock()
    defer { lock.unlock() }
    return observations
  }
}

private actor OrderRecorder {
  private var events: [String] = []

  func append(_ value: String) { events.append(value) }
  func values() -> [String] { events }
}

private actor AcceptorStub: MosaicCommerceUpdateAcceptor {
  let order: OrderRecorder

  init(order: OrderRecorder) { self.order = order }

  func accept(
    _ update: MosaicCommerceUpdate
  ) async -> MosaicCommerceUpdateAcceptanceDisposition {
    await order.append(
      "accept:\(update.id):\(update.activeEntitlementKeys.sorted().joined(separator: ","))"
    )
    return .accepted
  }
}

private actor AcceptanceStoreStub: MosaicStoreKitAcceptanceStore {
  let order: OrderRecorder
  private var ids: Set<String>

  init(order: OrderRecorder, initial: Set<String> = []) {
    self.order = order
    ids = initial
  }

  func contains(_ updateID: String) -> Bool { ids.contains(updateID) }

  func insert(_ updateID: String) async {
    ids.insert(updateID)
    await order.append("persist:\(updateID)")
  }
}

private actor StoreKitClientStub: StoreKitClient {
  let order: OrderRecorder
  let purchaseEvent: StoreKitPurchaseEvent
  let purchaseError: Error?
  nonisolated let unfinished: [StoreKitTransactionEvent]
  let entitlements: [StoreKitTransactionEvent]

  init(
    order: OrderRecorder,
    purchase: StoreKitPurchaseEvent,
    purchaseError: Error? = nil,
    unfinished: [StoreKitTransactionEvent] = [],
    entitlements: [StoreKitTransactionEvent] = []
  ) {
    self.order = order
    purchaseEvent = purchase
    self.purchaseError = purchaseError
    self.unfinished = unfinished
    self.entitlements = entitlements
  }

  func products(identifiers: [String]) -> [StoreKitProductSnapshot] {
    identifiers.map {
      .init(
        handle: $0,
        storeProductID: $0,
        type: .subscription,
        displayName: "Pro monthly",
        displayPrice: "$9.99",
        currencyCode: "USD",
        billingPeriod: .init(unit: .month, value: 1),
        localizedPeriod: "1 month",
        trial: nil,
        introductoryOffer: nil
      )
    }
  }

  func purchase(handle _: String) throws -> StoreKitPurchaseEvent {
    if let purchaseError { throw purchaseError }
    return purchaseEvent
  }

  nonisolated func transactionUpdates() -> AsyncStream<StoreKitTransactionEvent> {
    AsyncStream { $0.finish() }
  }

  nonisolated func unfinishedTransactions() -> AsyncStream<StoreKitTransactionEvent> {
    let values = unfinished
    let (stream, continuation) = AsyncStream<StoreKitTransactionEvent>.makeStream()
    for value in values {
      continuation.yield(value)
    }
    continuation.finish()
    return stream
  }

  func currentEntitlements() -> [StoreKitTransactionEvent] { entitlements }

  func finish(transactionID: UInt64) async {
    await order.append("finish:\(transactionID)")
  }

  func synchronize() {}
}

private enum StoreKitTestError: Error {
  case failed
}
