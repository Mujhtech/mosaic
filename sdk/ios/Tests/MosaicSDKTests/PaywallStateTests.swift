import XCTest

@testable import MosaicSDK

@MainActor
final class PaywallStateTests: XCTestCase {
  func testProductSelectionAndConfiguredAvailabilityFallback() async throws {
    let document = try canonicalDocument()
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: [.phase1Monthly]),
      onInteraction: recorder.record,
      onResult: recorder.record
    )
    await model.prepare()

    let selector = try XCTUnwrap(document.productSelectors.single)
    XCTAssertEqual(model.availableOptions(for: selector).map(\.id), ["monthly-plan"])
    XCTAssertEqual(model.selectedProductReferenceID(for: selector.id), "monthly-plan")
    XCTAssertTrue(model.unavailableSelectorIDs.isEmpty)

    model.selectProduct(referenceID: "monthly-plan", in: selector.id)
    XCTAssertEqual(
      recorder.interactions.last,
      .productSelected(productReferenceID: "monthly-plan")
    )
  }

  func testNoProductsShowsFallbackDisablesPurchaseAndEmitsUnavailable() async throws {
    let document = try canonicalDocument()
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(),
      onInteraction: recorder.record,
      onResult: recorder.record
    )
    await model.prepare()

    let selector = try XCTUnwrap(document.productSelectors.single)
    let purchase = try purchaseButton(in: document)
    XCTAssertTrue(model.availableOptions(for: selector).isEmpty)
    XCTAssertNil(model.selectedProductReferenceID(for: selector.id))
    XCTAssertTrue(model.unavailableSelectorIDs.contains(selector.id))
    XCTAssertFalse(model.isPurchaseEnabled(purchase))
    XCTAssertEqual(
      recorder.interactions,
      [.productUnavailable(productReferenceID: "yearly-plan")]
    )

    await model.purchase(using: purchase)
    XCTAssertEqual(recorder.results, [.productUnavailable(productReferenceID: "yearly-plan")])
  }

  func testMapsEveryPurchaseProviderOutcomeToNormalizedInteractionAndPresentation() async throws {
    try await assertPurchase(
      behavior: .success,
      interaction: .purchased(productReferenceID: "yearly-plan"),
      presentation: .purchased(productReferenceID: "yearly-plan")
    )
    try await assertPurchase(
      behavior: .alreadyEntitled,
      interaction: .alreadyEntitled(productReferenceID: "yearly-plan"),
      presentation: .alreadyEntitled(productReferenceID: "yearly-plan")
    )
    try await assertPurchase(
      behavior: .cancellation,
      interaction: .cancelled(productReferenceID: "yearly-plan"),
      presentation: .cancelled(productReferenceID: "yearly-plan")
    )
    try await assertPurchase(
      behavior: .unavailable,
      interaction: .productUnavailable(productReferenceID: "yearly-plan"),
      presentation: .productUnavailable(productReferenceID: "yearly-plan")
    )
    try await assertPurchase(
      behavior: .failure(diagnosticCode: "Sensitive provider detail!"),
      interaction: .purchaseFailed(
        productReferenceID: "yearly-plan",
        diagnosticCode: "purchase_provider_failed"
      ),
      presentation: .purchaseFailed(
        productReferenceID: "yearly-plan",
        diagnosticCode: "purchase_provider_failed"
      )
    )
  }

  func testRestoreSuccessAndAlreadyEntitledAreTerminal() async throws {
    try await assertRestore(
      behavior: .success([MosaicEntitlement(id: "pro")]),
      interaction: .restored,
      presentation: .restored
    )
    try await assertRestore(
      behavior: .alreadyEntitled([MosaicEntitlement(id: "pro")]),
      interaction: .alreadyEntitled(productReferenceID: nil),
      presentation: .alreadyEntitled(productReferenceID: nil)
    )
  }

  func testRestoreNoPurchasesAndFailureRemainNonterminal() async throws {
    let noPurchases = try await exerciseRestore(.noPurchases)
    XCTAssertEqual(noPurchases.interactions, [.restoreNoPurchases])
    XCTAssertTrue(noPurchases.results.isEmpty)

    let failed = try await exerciseRestore(
      .failure(diagnosticCode: "Raw restore provider error!")
    )
    XCTAssertEqual(
      failed.interactions,
      [.restoreFailed(diagnosticCode: "restore_provider_failed")]
    )
    XCTAssertTrue(failed.results.isEmpty)
  }

  func testCloseMapsToDismissedWithoutOwningHostDismissal() throws {
    let document = try canonicalDocument()
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(),
      onInteraction: recorder.record,
      onResult: recorder.record
    )

    model.close(using: try closeButton(in: document))

    XCTAssertEqual(recorder.interactions, [.dismissed])
    XCTAssertEqual(recorder.results, [.dismissed])
  }

  func testRenderingFailureIsTerminalAndSanitizesDiagnostics() throws {
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: try canonicalDocument(),
      purchaseProvider: MockMosaicPurchaseProvider(),
      onInteraction: recorder.record,
      onResult: recorder.record
    )

    model.reportRenderingFailure(code: "Raw renderer detail!")

    XCTAssertTrue(recorder.interactions.isEmpty)
    XCTAssertEqual(
      recorder.results,
      [.renderingFailed(diagnosticCode: "renderer_failed")]
    )
    XCTAssertEqual(
      model.diagnostics,
      [MosaicDiagnostic(code: "renderer_failed", stage: .rendering)]
    )
  }

  func testBusyStateDisablesTheActivePurchaseUntilProviderReturns() async throws {
    let document = try canonicalDocument()
    let provider = DeferredPurchaseProvider(products: [.phase1Monthly, .phase1Yearly])
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: provider,
      onInteraction: recorder.record,
      onResult: recorder.record
    )
    await model.prepare()
    let button = try purchaseButton(in: document)

    let operation = Task { await model.purchase(using: button) }
    while model.busyPurchaseButtonID == nil {
      await Task.yield()
    }
    XCTAssertEqual(model.busyPurchaseButtonID, button.id)
    XCTAssertFalse(model.isPurchaseEnabled(button))

    await provider.completePurchase(
      with: .purchased(productID: "mosaic_pro_yearly", transactionID: "deferred")
    )
    await operation.value
    XCTAssertNil(model.busyPurchaseButtonID)
    XCTAssertEqual(recorder.results, [.purchased(productReferenceID: "yearly-plan")])
  }

  func testUnifiedButtonUsesProgressContentAndRejectsDuplicateAsyncActions() async throws {
    let document = try v02Document()
    let provider = DeferredPurchaseProvider(products: MosaicProduct.phase1MockProducts)
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: provider,
      onInteraction: recorder.record,
      onResult: recorder.record
    )
    await model.prepare()
    let button = try XCTUnwrap(
      document.allNodes.compactMap { node -> MosaicButtonComponent? in
        guard case .button(let value) = node, value.action.type == .purchase else { return nil }
        return value
      }.first)
    let progressIDs = try XCTUnwrap(button.inProgressChildren).map(\.id)

    let operation = Task { await model.purchase(using: button) }
    while !model.isButtonBusy(button.id) { await Task.yield() }
    XCTAssertFalse(model.isButtonEnabled(button))
    XCTAssertEqual(button.content(isInProgress: true).map(\.id), progressIDs)

    await model.purchase(using: button)
    let purchaseRequestCount = await provider.purchaseRequestCount()
    XCTAssertEqual(purchaseRequestCount, 1)

    await provider.completePurchase(
      with: .purchased(productID: "mosaic_pro_yearly", transactionID: "deferred-v02")
    )
    await operation.value
    XCTAssertFalse(model.isButtonBusy(button.id))
    XCTAssertEqual(recorder.results, [.purchased(productReferenceID: "yearly-plan")])
  }

  func testNormalizedPresentationNamesExactlyMatchRC1() {
    XCTAssertEqual(
      MosaicPresentationOutcomeName.allCases.map(\.rawValue),
      [
        "purchased", "restored", "alreadyEntitled", "dismissed", "cancelled",
        "productUnavailable", "configurationUnavailable", "purchaseFailed",
        "renderingFailed",
      ]
    )
  }

  private func assertPurchase(
    behavior: MockMosaicPurchaseBehavior,
    interaction: MosaicInteractionOutcome,
    presentation: MosaicPresentationResult
  ) async throws {
    let document = try canonicalDocument()
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts,
        purchaseBehavior: behavior
      ),
      onInteraction: recorder.record,
      onResult: recorder.record
    )
    await model.prepare()
    await model.purchase(using: try purchaseButton(in: document))

    XCTAssertEqual(recorder.interactions, [interaction])
    XCTAssertEqual(recorder.results, [presentation])
  }

  private func assertRestore(
    behavior: MockMosaicRestoreBehavior,
    interaction: MosaicInteractionOutcome,
    presentation: MosaicPresentationResult
  ) async throws {
    let recorder = try await exerciseRestore(behavior)
    XCTAssertEqual(recorder.interactions, [interaction])
    XCTAssertEqual(recorder.results, [presentation])
  }

  private func exerciseRestore(
    _ behavior: MockMosaicRestoreBehavior
  ) async throws -> OutcomeRecorder {
    let document = try canonicalDocument()
    let recorder = OutcomeRecorder()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts,
        restoreBehavior: behavior
      ),
      onInteraction: recorder.record,
      onResult: recorder.record
    )
    await model.prepare()
    await model.restore(using: try restoreButton(in: document))
    return recorder
  }
}

@MainActor
private final class OutcomeRecorder {
  private(set) var interactions: [MosaicInteractionOutcome] = []
  private(set) var results: [MosaicPresentationResult] = []

  func record(_ outcome: MosaicInteractionOutcome) {
    interactions.append(outcome)
  }

  func record(_ result: MosaicPresentationResult) {
    results.append(result)
  }
}

private actor DeferredPurchaseProvider: MosaicPurchaseProvider {
  let products: [MosaicProduct]
  private var purchaseContinuation: CheckedContinuation<MosaicPurchaseResult, Never>?
  private var purchaseRequests = 0

  init(products: [MosaicProduct]) {
    self.products = products
  }

  func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    .loaded(products.filter { identifiers.contains($0.id) })
  }

  func purchase(productID: String) async -> MosaicPurchaseResult {
    purchaseRequests += 1
    return await withCheckedContinuation { continuation in
      purchaseContinuation = continuation
    }
  }

  func purchaseRequestCount() -> Int { purchaseRequests }

  func completePurchase(with result: MosaicPurchaseResult) {
    purchaseContinuation?.resume(returning: result)
    purchaseContinuation = nil
  }

  func restore() async -> MosaicRestoreResult { .nothingToRestore }

  func activeEntitlements() async -> MosaicActiveEntitlementsResult { .active([]) }
}

extension Collection {
  fileprivate var single: Element? { count == 1 ? first : nil }
}
