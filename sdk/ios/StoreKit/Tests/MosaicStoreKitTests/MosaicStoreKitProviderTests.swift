import Foundation
import MosaicSDK
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
    await provider.install(configuration: configuration, mappings: [mapping])
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

  func testUnverifiedPendingCancelledAndFailureRemainDistinctAndNeverFinish() async {
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
      await provider.install(configuration: configuration, mappings: [mapping])
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
    await provider.install(configuration: configuration, mappings: [mapping])
    _ = await provider.loadProducts(mappings: [mapping])
    Outcome.failed("commerce.purchaseFailed")
      .assert(await provider.purchase(mosaicProductID: mapping.mosaicProductID))
    let events = await order.values()
    XCTAssertEqual(events, [])
  }

  func testDuplicateUnfinishedTransactionFinishesWithoutRedelivery() async {
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

    await provider.install(configuration: configuration, mappings: [mapping])

    let events = await order.values()
    XCTAssertEqual(events, ["finish:88"])
  }

  func testEntitlementVerificationFailureNeverNormalizesToInactive() async {
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
    await provider.install(configuration: configuration, mappings: [mapping])

    guard
      case .failed(let code, _) = await provider.activeEntitlements(
        entitlementMappings: []
      )
    else {
      return XCTFail("Unverified access must fail instead of returning an empty active set.")
    }
    XCTAssertEqual(code, "commerce.entitlementLookupFailed")
  }

  private var configuration: MosaicCommerceConfigurationReference {
    .init(
      configurationID: "commerce_configuration_storekit_42",
      configurationRevision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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

private actor OrderRecorder {
  private var events: [String] = []

  func append(_ value: String) { events.append(value) }
  func values() -> [String] { events }
}

private actor AcceptorStub: MosaicCommerceUpdateAcceptor {
  let order: OrderRecorder

  init(order: OrderRecorder) { self.order = order }

  func accept(_ update: MosaicCommerceUpdate) async -> Bool {
    await order.append(
      "accept:\(update.id):\(update.activeEntitlementKeys.sorted().joined(separator: ","))"
    )
    return true
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
