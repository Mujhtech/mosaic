import Combine
import Foundation

public struct MosaicResolvedProductOption: Sendable, Equatable, Identifiable {
  public let reference: MosaicProductReference
  public let product: MosaicProduct

  public var id: String { reference.id }
}

/// Focused reference-state owner for the renderer. Mosaic supports iOS 15, so
/// the root view owns this ObservableObject with StateObject.
@MainActor
public final class MosaicPaywallModel: ObservableObject {
  public let document: MosaicPaywallDocument
  public let localization: MosaicLocalizationResolver

  @Published public private(set) var productsByReferenceID: [String: MosaicProduct] = [:]
  @Published public private(set) var selectedProductReferenceIDs: [String: String] = [:]
  @Published public private(set) var unavailableSelectorIDs: Set<String> = []
  @Published public private(set) var busyPurchaseButtonID: String?
  @Published public private(set) var busyRestoreButtonID: String?
  @Published public private(set) var isLoadingProducts = false
  @Published public private(set) var diagnostics: [MosaicDiagnostic] = []

  private let purchaseProvider: any MosaicPurchaseProvider
  private let interactionHandler: @MainActor (MosaicInteractionOutcome) -> Void
  private let resultHandler: @MainActor (MosaicPresentationResult) -> Void
  private let productReferencesByID: [String: MosaicProductReference]
  private var hasPrepared = false

  public init(
    document: MosaicPaywallDocument,
    requestedLocale: String? = nil,
    purchaseProvider: any MosaicPurchaseProvider,
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void
  ) {
    self.document = document
    localization = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: requestedLocale
    )
    self.purchaseProvider = purchaseProvider
    interactionHandler = onInteraction
    resultHandler = onResult
    productReferencesByID = Dictionary(
      uniqueKeysWithValues: document.products.map { ($0.id, $0) }
    )
  }

  public func prepare() async {
    guard !hasPrepared else { return }
    hasPrepared = true
    isLoadingProducts = true
    defer { isLoadingProducts = false }

    let providerIDs = document.products.map(\.productId)
    let loadResult = await purchaseProvider.loadProducts(identifiers: providerIDs)
    let products: [MosaicProduct]
    switch loadResult {
    case .loaded(let loaded):
      products = loaded
    case .unavailable(_, let diagnosticCode):
      products = []
      if let diagnosticCode {
        diagnostics.append(
          MosaicDiagnostic(
            code: safeDiagnosticCode(diagnosticCode, fallback: "product_provider_unavailable"),
            stage: .commerce
          )
        )
      }
    }

    let productsByProviderID = Dictionary(
      products.map { ($0.id, $0) },
      uniquingKeysWith: { first, _ in first }
    )
    productsByReferenceID = Dictionary(
      uniqueKeysWithValues: document.products.compactMap { reference in
        productsByProviderID[reference.productId].map { (reference.id, $0) }
      }
    )

    for selector in document.productSelectors {
      let available = selector.productReferenceIds.filter {
        productsByReferenceID[$0] != nil
      }
      if available.contains(selector.initiallySelectedProductReferenceId) {
        selectedProductReferenceIDs[selector.id] = selector.initiallySelectedProductReferenceId
      } else if let first = available.first {
        selectedProductReferenceIDs[selector.id] = first
      } else {
        selectedProductReferenceIDs[selector.id] = nil
        unavailableSelectorIDs.insert(selector.id)
        interactionHandler(
          .productUnavailable(
            productReferenceID: selector.initiallySelectedProductReferenceId
          )
        )
      }
    }
  }

  public func availableOptions(
    for selector: MosaicProductSelectorComponent
  ) -> [MosaicResolvedProductOption] {
    selector.productReferenceIds.compactMap { referenceID in
      guard
        let reference = productReferencesByID[referenceID],
        let product = productsByReferenceID[referenceID]
      else {
        return nil
      }
      return MosaicResolvedProductOption(reference: reference, product: product)
    }
  }

  public func selectedProductReferenceID(for selectorID: String) -> String? {
    selectedProductReferenceIDs[selectorID]
  }

  public func selectProduct(referenceID: String, in selectorID: String) {
    guard
      let selector = document.productSelector(id: selectorID),
      selector.productReferenceIds.contains(referenceID),
      productsByReferenceID[referenceID] != nil
    else {
      return
    }
    selectedProductReferenceIDs[selectorID] = referenceID
    interactionHandler(.productSelected(productReferenceID: referenceID))
  }

  public func isPurchaseEnabled(_ button: MosaicPurchaseButtonComponent) -> Bool {
    guard busyPurchaseButtonID != button.id else { return false }
    guard case .purchase(let selectorID) = button.action else { return false }
    return selectedProductReferenceIDs[selectorID] != nil
  }

  public func isRestoreEnabled(_ button: MosaicRestoreButtonComponent) -> Bool {
    busyRestoreButtonID != button.id
  }

  public func purchase(using button: MosaicPurchaseButtonComponent) async {
    guard busyPurchaseButtonID != button.id else { return }
    guard
      case .purchase(let selectorID) = button.action,
      let selector = document.productSelector(id: selectorID)
    else {
      reportRenderingFailure(code: "renderer_invalid_purchase_action")
      return
    }
    guard
      let referenceID = selectedProductReferenceIDs[selectorID],
      let reference = productReferencesByID[referenceID]
    else {
      let fallbackReferenceID = selector.initiallySelectedProductReferenceId
      let interaction = MosaicInteractionOutcome.productUnavailable(
        productReferenceID: fallbackReferenceID
      )
      interactionHandler(interaction)
      resultHandler(.productUnavailable(productReferenceID: fallbackReferenceID))
      return
    }

    busyPurchaseButtonID = button.id
    defer { busyPurchaseButtonID = nil }
    switch await purchaseProvider.purchase(productID: reference.productId) {
    case .purchased:
      interactionHandler(.purchased(productReferenceID: referenceID))
      resultHandler(.purchased(productReferenceID: referenceID))
    case .alreadyEntitled:
      interactionHandler(.alreadyEntitled(productReferenceID: referenceID))
      resultHandler(.alreadyEntitled(productReferenceID: referenceID))
    case .cancelled:
      interactionHandler(.cancelled(productReferenceID: referenceID))
      resultHandler(.cancelled(productReferenceID: referenceID))
    case .productUnavailable:
      interactionHandler(.productUnavailable(productReferenceID: referenceID))
      resultHandler(.productUnavailable(productReferenceID: referenceID))
    case .failed(_, let diagnosticCode):
      let safeCode = safeDiagnosticCode(
        diagnosticCode,
        fallback: "purchase_provider_failed"
      )
      diagnostics.append(MosaicDiagnostic(code: safeCode, stage: .commerce))
      interactionHandler(
        .purchaseFailed(productReferenceID: referenceID, diagnosticCode: safeCode)
      )
      resultHandler(
        .purchaseFailed(productReferenceID: referenceID, diagnosticCode: safeCode)
      )
    }
  }

  public func restore(using button: MosaicRestoreButtonComponent) async {
    guard busyRestoreButtonID != button.id else { return }
    guard button.action == .restore else {
      reportRenderingFailure(code: "renderer_invalid_restore_action")
      return
    }

    busyRestoreButtonID = button.id
    defer { busyRestoreButtonID = nil }
    switch await purchaseProvider.restore() {
    case .restored:
      interactionHandler(.restored)
      resultHandler(.restored)
    case .alreadyEntitled:
      interactionHandler(.alreadyEntitled(productReferenceID: nil))
      resultHandler(.alreadyEntitled(productReferenceID: nil))
    case .nothingToRestore:
      interactionHandler(.restoreNoPurchases)
    case .failed(let diagnosticCode):
      let safeCode = safeDiagnosticCode(
        diagnosticCode,
        fallback: "restore_provider_failed"
      )
      diagnostics.append(MosaicDiagnostic(code: safeCode, stage: .commerce))
      interactionHandler(.restoreFailed(diagnosticCode: safeCode))
    }
  }

  public func close(using button: MosaicCloseButtonComponent) {
    guard button.action == .close else {
      reportRenderingFailure(code: "renderer_invalid_close_action")
      return
    }
    interactionHandler(.dismissed)
    resultHandler(.dismissed)
  }

  public func reportRenderingFailure(code: String) {
    let safeCode = safeDiagnosticCode(code, fallback: "renderer_failed")
    diagnostics.append(MosaicDiagnostic(code: safeCode, stage: .rendering))
    resultHandler(.renderingFailed(diagnosticCode: safeCode))
  }
}

extension MosaicPaywallDocument {
  public var productSelectors: [MosaicProductSelectorComponent] {
    layout.content.descendants.compactMap { node in
      guard case .productSelector(let selector) = node else { return nil }
      return selector
    }
  }

  public func productSelector(id: String) -> MosaicProductSelectorComponent? {
    productSelectors.first { $0.id == id }
  }
}

extension MosaicVerticalStack {
  fileprivate var descendants: [MosaicNode] {
    children.flatMap { node in
      if case .verticalStack(let stack) = node {
        return [node] + stack.descendants
      }
      return [node]
    }
  }
}

private func safeDiagnosticCode(_ code: String, fallback: String) -> String {
  guard
    code.count <= 64,
    code.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil
  else {
    return fallback
  }
  return code
}
