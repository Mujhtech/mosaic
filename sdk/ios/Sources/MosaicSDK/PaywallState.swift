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
  @Published public private(set) var switchValues: [String: Bool] = [:]
  @Published public private(set) var carouselPageIndices: [String: Int] = [:]
  @Published public private(set) var busyPurchaseButtonID: String?
  @Published public private(set) var busyRestoreButtonID: String?
  @Published public private(set) var isLoadingProducts = false
  @Published public private(set) var diagnostics: [MosaicDiagnostic] = []

  private let purchaseProvider: any MosaicPurchaseProvider
  private let interactionHandler: @MainActor (MosaicInteractionOutcome) -> Void
  private let resultHandler: @MainActor (MosaicPresentationResult) -> Void
  private let productReferencesByID: [String: MosaicProductReference]
  private let clock: @Sendable () -> Date
  private var hasPrepared = false

  public init(
    document: MosaicPaywallDocument,
    requestedLocale: String? = nil,
    purchaseProvider: any MosaicPurchaseProvider,
    clock: @escaping @Sendable () -> Date = { Date() },
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void
  ) {
    self.document = document
    localization = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: requestedLocale
    )
    self.purchaseProvider = purchaseProvider
    self.clock = clock
    interactionHandler = onInteraction
    resultHandler = onResult
    productReferencesByID = Dictionary(
      uniqueKeysWithValues: document.products.map { ($0.id, $0) }
    )
    switchValues = Dictionary(
      uniqueKeysWithValues: document.switches.map { ($0.id, $0.initialValue) }
    )
    carouselPageIndices = Dictionary(
      uniqueKeysWithValues: document.carousels.map { ($0.id, $0.initialPageIndex) }
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

  public func switchValue(for switchID: String) -> Bool {
    switchValues[switchID] ?? false
  }

  public func setSwitchValue(_ value: Bool, for switchID: String) {
    guard document.switches.contains(where: { $0.id == switchID }) else { return }
    switchValues[switchID] = value
  }

  public func carouselPageIndex(for carouselID: String) -> Int {
    carouselPageIndices[carouselID] ?? 0
  }

  public func setCarouselPageIndex(_ index: Int, for carouselID: String) {
    guard
      let carousel = document.carousels.first(where: { $0.id == carouselID }),
      carousel.pages.indices.contains(index)
    else { return }
    carouselPageIndices[carouselID] = index
  }

  public func isVisible(_ visibility: MosaicVisibility) -> Bool {
    switch visibility {
    case .always: true
    case .hidden: false
    case .switchValue(let switchID, let equals): switchValue(for: switchID) == equals
    }
  }

  public func isNodeVisible(_ nodeID: String) -> Bool {
    document.isNodeVisible(nodeID, switchValues: switchValues)
  }

  public func currentDate() -> Date { clock() }

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
    guard isNodeVisible(selectorID) else { return false }
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
    allNodes.compactMap { node in
      guard case .productSelector(let selector) = node else { return nil }
      return selector
    }
  }

  public func productSelector(id: String) -> MosaicProductSelectorComponent? {
    productSelectors.first { $0.id == id }
  }

  public var allNodes: [MosaicNode] { layout.content.descendants }

  public var switches: [MosaicSwitchComponent] {
    allNodes.compactMap { node in
      guard case .switchControl(let value) = node else { return nil }
      return value
    }
  }

  public var carousels: [MosaicCarouselComponent] {
    allNodes.compactMap { node in
      guard case .carousel(let value) = node else { return nil }
      return value
    }
  }

  fileprivate func isNodeVisible(
    _ targetID: String, switchValues: [String: Bool]
  ) -> Bool {
    func visible(_ visibility: MosaicVisibility) -> Bool {
      switch visibility {
      case .always: true
      case .hidden: false
      case .switchValue(let switchID, let equals): switchValues[switchID] == equals
      }
    }

    func search(_ stack: MosaicStack, ancestorsVisible: Bool) -> Bool? {
      let stackVisible = ancestorsVisible && visible(stack.visibility)
      if stack.id == targetID { return stackVisible }
      for node in stack.children {
        let nodeVisible = stackVisible && visible(node.visibility)
        if node.id == targetID { return nodeVisible }
        switch node {
        case .stack(let nested), .verticalStack(let nested):
          if let result = search(nested, ancestorsVisible: stackVisible) { return result }
        case .carousel(let carousel):
          for page in carousel.pages {
            if page.id == targetID { return nodeVisible }
            if let result = search(page.content, ancestorsVisible: nodeVisible) { return result }
          }
        default: break
        }
      }
      return nil
    }
    return search(layout.content, ancestorsVisible: true) ?? false
  }
}

extension MosaicStack {
  fileprivate var descendants: [MosaicNode] {
    children.flatMap { node in
      switch node {
      case .verticalStack(let stack), .stack(let stack):
        return [node] + stack.descendants
      case .carousel(let carousel):
        return [node] + carousel.pages.flatMap { $0.content.descendants }
      default:
        return [node]
      }
    }
  }
}

extension MosaicNode {
  var visibility: MosaicVisibility {
    switch self {
    case .verticalStack(let value), .stack(let value): value.visibility
    case .text(let value): value.visibility
    case .image(let value): value.visibility
    case .featureList(let value): value.visibility
    case .productSelector(let value): value.visibility
    case .purchaseButton(let value): value.visibility
    case .restoreButton(let value): value.visibility
    case .closeButton(let value): value.visibility
    case .legalText(let value): value.visibility
    case .carousel(let value): value.visibility
    case .switchControl(let value): value.visibility
    case .countdown(let value): value.visibility
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
