import Combine
import Foundation

public struct MosaicResolvedProductOption: Sendable, Equatable, Identifiable {
  public let card: MosaicProductCardComponent?
  public let reference: MosaicProductReference
  public let product: MosaicProduct

  public var id: String { card?.id ?? reference.id }
}

/// Focused reference-state owner for the renderer. Mosaic supports iOS 15, so
/// the root view owns this ObservableObject with StateObject.
@MainActor
public final class MosaicPaywallModel: ObservableObject {
  public let document: MosaicPaywallDocument
  public let localization: MosaicLocalizationResolver

  @Published public private(set) var productsByReferenceID: [String: MosaicProduct] = [:]
  @Published public private(set) var selectedProductCardIDs: [String: String] = [:]
  @Published public private(set) var selectedProductReferenceIDs: [String: String] = [:]
  @Published public private(set) var unavailableSelectorIDs: Set<String> = []
  @Published public private(set) var switchValues: [String: Bool] = [:]
  @Published public private(set) var carouselPageIndices: [String: Int] = [:]
  @Published public private(set) var navigationHistory: [String] = []
  @Published public private(set) var busyButtonIDs: Set<String> = []
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
  private var diagnosedHiddenPurchaseButtonIDs = Set<String>()
  private var diagnosedRenderingSubjects = Set<String>()

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
    if let initialScreenID = document.initialScreenId {
      navigationHistory = [initialScreenID]
    }
    refreshHiddenPurchaseDiagnostics()
  }

  public var currentScreenID: String? { navigationHistory.last }

  public var currentScreen: MosaicScreen? {
    currentScreenID.flatMap(document.screen(id:))
  }

  public var baseScreen: MosaicScreen? {
    navigationHistory.reversed().compactMap(document.screen(id:)).first {
      $0.presentation?.type != .sheet
    } ?? document.initialScreenId.flatMap(document.screen(id:))
  }

  public var presentedSheet: MosaicScreen? {
    guard let currentScreen, currentScreen.presentation?.type == .sheet else { return nil }
    return currentScreen
  }

  public var currentLayout: MosaicScrollContainer {
    currentScreen?.layout ?? document.layout
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
      let available = availableOptions(for: selector)
      let initial: MosaicResolvedProductOption?
      if let initialCardID = selector.initialProductCardId {
        initial = available.first { $0.card?.id == initialCardID }
      } else {
        initial = available.first {
          $0.reference.id == selector.initiallySelectedProductReferenceId
        }
      }
      if let selected = initial ?? available.first {
        selectedProductCardIDs[selector.id] = selected.card?.id
        selectedProductReferenceIDs[selector.id] = selected.reference.id
      } else {
        selectedProductCardIDs[selector.id] = nil
        selectedProductReferenceIDs[selector.id] = nil
        unavailableSelectorIDs.insert(selector.id)
        interactionHandler(
          .productUnavailable(
            productReferenceID: selector.initialProductReferenceID
          )
        )
      }
    }
  }

  public func availableOptions(
    for selector: MosaicProductSelectorComponent
  ) -> [MosaicResolvedProductOption] {
    if selector.usesAuthoredCards {
      return selector.cards.compactMap { card in
        guard
          let reference = productReferencesByID[card.productReferenceId],
          let product = productsByReferenceID[card.productReferenceId]
        else { return nil }
        guard !productPriceIsBlank(product) || !productCardRequiresPrice(card) else {
          return nil
        }
        return MosaicResolvedProductOption(card: card, reference: reference, product: product)
      }
    }
    return selector.productReferenceIds.compactMap { referenceID -> MosaicResolvedProductOption? in
      guard
        let reference = productReferencesByID[referenceID],
        let product = productsByReferenceID[referenceID],
        !productPriceIsBlank(product)
      else {
        return nil
      }
      return MosaicResolvedProductOption(card: nil, reference: reference, product: product)
    }
  }

  private func productCardRequiresPrice(_ card: MosaicProductCardComponent) -> Bool {
    if let accessibility = card.accessibility,
      localizedTextUsesProductPrice(accessibility.label)
    {
      return true
    }
    return card.children.contains(where: productCardChildUsesProductPrice)
  }

  private func productCardChildUsesProductPrice(_ child: MosaicProductCardChild) -> Bool {
    switch child {
    case .node(let node):
      productCardNodeUsesProductPrice(node)
    case .badge(let badge):
      badge.children.contains(where: productCardNodeUsesProductPrice)
    }
  }

  private func productCardNodeUsesProductPrice(_ node: MosaicNode) -> Bool {
    switch node {
    case .verticalStack(let stack), .stack(let stack):
      stack.children.contains(where: productCardNodeUsesProductPrice)
    case .text(let text):
      localizedTextUsesProductPrice(text.value)
    case .image, .icon, .featureList, .productSelector, .button, .purchaseButton,
      .restoreButton, .closeButton, .legalText, .carousel, .switchControl, .countdown:
      false
    }
  }

  private func localizedTextUsesProductPrice(_ text: MosaicLocalizedText) -> Bool {
    MosaicProductTemplate.analyze(localization.resolve(text)).variables.contains("price")
  }

  private func productPriceIsBlank(_ product: MosaicProduct) -> Bool {
    product.localizedPrice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public func selectedProductCardID(for selectorID: String) -> String? {
    selectedProductCardIDs[selectorID]
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
    refreshHiddenPurchaseDiagnostics()
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
    document.isNodeVisible(
      nodeID,
      screenID: currentScreenID,
      switchValues: switchValues
    )
  }

  public func navigate(to screenID: String) {
    guard document.screen(id: screenID) != nil else {
      appendDiagnostic(code: "navigation_unknown_screen")
      return
    }
    navigationHistory.append(screenID)
    refreshHiddenPurchaseDiagnostics()
  }

  public func navigateBack() {
    guard navigationHistory.count > 1 else {
      appendDiagnostic(code: "navigation_back_at_root")
      return
    }
    navigationHistory.removeLast()
    refreshHiddenPurchaseDiagnostics()
  }

  public func dismissPresentedSheet() {
    guard presentedSheet != nil else { return }
    navigateBack()
  }

  public func recordExternalURLOpenResult(_ accepted: Bool) {
    guard !accepted else { return }
    appendDiagnostic(code: "external_url_open_failed")
  }

  public func currentDate() -> Date { clock() }

  public func selectProduct(referenceID: String, in selectorID: String) {
    guard
      let selector = document.productSelector(id: selectorID),
      let option = availableOptions(for: selector).first(where: { $0.reference.id == referenceID })
    else {
      return
    }
    selectedProductCardIDs[selectorID] = option.card?.id
    selectedProductReferenceIDs[selectorID] = referenceID
    interactionHandler(.productSelected(productReferenceID: referenceID))
  }

  public func selectProduct(cardID: String, in selectorID: String) {
    guard
      let selector = document.productSelector(id: selectorID),
      let option = availableOptions(for: selector).first(where: { $0.card?.id == cardID })
    else { return }
    selectedProductCardIDs[selectorID] = cardID
    selectedProductReferenceIDs[selectorID] = option.reference.id
    interactionHandler(.productSelected(productReferenceID: option.reference.id))
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

  public func isButtonBusy(_ buttonID: String) -> Bool {
    busyButtonIDs.contains(buttonID)
  }

  public func isButtonEnabled(_ button: MosaicButtonComponent) -> Bool {
    guard !isButtonBusy(button.id) else { return false }
    switch button.action {
    case .purchase(let selectorID):
      return isNodeVisible(selectorID) && selectedProductReferenceIDs[selectorID] != nil
    case .restore, .close, .navigateTo, .navigateBack, .openExternalURL:
      return true
    }
  }

  public func performSynchronousAction(using button: MosaicButtonComponent) {
    guard isButtonEnabled(button) else { return }
    switch button.action {
    case .close:
      interactionHandler(.dismissed)
      resultHandler(.dismissed)
    case .navigateTo(let screenID):
      navigate(to: screenID)
    case .navigateBack:
      navigateBack()
    case .purchase, .restore, .openExternalURL:
      break
    }
  }

  public func purchase(using button: MosaicButtonComponent) async {
    guard case .purchase(let selectorID) = button.action else {
      reportRenderingFailure(code: "renderer_invalid_purchase_action")
      return
    }
    await purchase(buttonID: button.id, selectorID: selectorID)
  }

  public func restore(using button: MosaicButtonComponent) async {
    guard button.action == .restore else {
      reportRenderingFailure(code: "renderer_invalid_restore_action")
      return
    }
    guard !busyButtonIDs.contains(button.id) else { return }
    busyButtonIDs.insert(button.id)
    defer { busyButtonIDs.remove(button.id) }
    await performRestore()
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
      let fallbackReferenceID = selector.initialProductReferenceID
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

  private func purchase(buttonID: String, selectorID: String) async {
    guard !busyButtonIDs.contains(buttonID) else { return }
    guard isNodeVisible(selectorID) else {
      appendDiagnostic(code: "purchase_hidden_product_selector")
      return
    }
    guard let selector = document.productSelector(id: selectorID) else {
      reportRenderingFailure(code: "renderer_invalid_purchase_action")
      return
    }
    guard
      let referenceID = selectedProductReferenceIDs[selectorID],
      let reference = productReferencesByID[referenceID]
    else {
      let fallbackReferenceID = selector.initialProductReferenceID
      interactionHandler(.productUnavailable(productReferenceID: fallbackReferenceID))
      resultHandler(.productUnavailable(productReferenceID: fallbackReferenceID))
      return
    }

    busyButtonIDs.insert(buttonID)
    defer { busyButtonIDs.remove(buttonID) }
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

  private func performRestore() async {
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

  public func reportRenderingFailure(code: String) {
    let safeCode = safeDiagnosticCode(code, fallback: "renderer_failed")
    diagnostics.append(MosaicDiagnostic(code: safeCode, stage: .rendering))
    resultHandler(.renderingFailed(diagnosticCode: safeCode))
  }

  public func recordRenderingDiagnosticOnce(_ code: String, subjectID: String) {
    let key = "\(code):\(subjectID)"
    guard diagnosedRenderingSubjects.insert(key).inserted else { return }
    appendDiagnostic(code: safeDiagnosticCode(code, fallback: "renderer_failed"))
  }

  private func appendDiagnostic(code: String) {
    diagnostics.append(MosaicDiagnostic(code: code, stage: .rendering))
  }

  private func refreshHiddenPurchaseDiagnostics() {
    let hiddenButtonIDs = Set(
      currentLayout.content.descendants.compactMap { node -> String? in
        guard case .button(let button) = node,
          case .purchase(let selectorID) = button.action,
          !isNodeVisible(selectorID)
        else { return nil }
        return button.id
      }
    )
    for _ in hiddenButtonIDs.subtracting(diagnosedHiddenPurchaseButtonIDs) {
      appendDiagnostic(code: "purchase_hidden_product_selector")
    }
    diagnosedHiddenPurchaseButtonIDs = hiddenButtonIDs
  }
}

extension MosaicPaywallDocument {
  public func screen(id: String) -> MosaicScreen? {
    screens.first { $0.id == id }
  }

  public var productSelectors: [MosaicProductSelectorComponent] {
    allNodes.compactMap { node in
      guard case .productSelector(let selector) = node else { return nil }
      return selector
    }
  }

  public func productSelector(id: String) -> MosaicProductSelectorComponent? {
    productSelectors.first { $0.id == id }
  }

  public var allNodes: [MosaicNode] {
    if schemaVersion == mosaicProtocolVersion {
      return screens.flatMap { $0.layout.content.descendants }
    }
    return layout.content.descendants
  }

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
    _ targetID: String,
    screenID: String?,
    switchValues: [String: Bool]
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
        case .button(let button):
          for child in button.children {
            if child.id == targetID { return nodeVisible && visible(child.visibility) }
            if case .stack(let nested) = child,
              let result = search(nested, ancestorsVisible: nodeVisible)
            {
              return result
            }
          }
          for child in button.inProgressChildren ?? [] {
            if child.id == targetID { return nodeVisible && visible(child.visibility) }
            if case .stack(let nested) = child,
              let result = search(nested, ancestorsVisible: nodeVisible)
            {
              return result
            }
          }
        case .carousel(let carousel):
          for page in carousel.pages {
            if page.id == targetID { return nodeVisible }
            if let result = search(page.content, ancestorsVisible: nodeVisible) { return result }
          }
        case .productSelector(let selector):
          for card in selector.cards {
            if card.id == targetID { return nodeVisible }
            for child in card.children {
              switch child {
              case .node(let childNode):
                if childNode.id == targetID {
                  return nodeVisible && visible(childNode.visibility)
                }
                if case .stack(let nested) = childNode,
                  let result = search(nested, ancestorsVisible: nodeVisible)
                {
                  return result
                }
              case .badge(let badge):
                if badge.id == targetID { return nodeVisible }
                for badgeChild in badge.children {
                  if badgeChild.id == targetID {
                    return nodeVisible && visible(badgeChild.visibility)
                  }
                  if case .stack(let nested) = badgeChild,
                    let result = search(nested, ancestorsVisible: nodeVisible)
                  {
                    return result
                  }
                }
              }
            }
          }
        default: break
        }
      }
      return nil
    }
    let activeLayout = screenID.flatMap { screen(id: $0)?.layout } ?? layout
    return search(activeLayout.content, ancestorsVisible: true) ?? false
  }
}

extension MosaicStack {
  fileprivate var descendants: [MosaicNode] {
    children.flatMap { node in
      switch node {
      case .verticalStack(let stack), .stack(let stack):
        return [node] + stack.descendants
      case .button(let button):
        return [node]
          + button.children.flatMap { $0.descendantsIncludingSelf }
          + (button.inProgressChildren ?? []).flatMap { $0.descendantsIncludingSelf }
      case .carousel(let carousel):
        return [node] + carousel.pages.flatMap { $0.content.descendants }
      case .productSelector(let selector):
        return [node] + selector.cards.flatMap(\.descendantNodes)
      default:
        return [node]
      }
    }
  }
}

extension MosaicNode {
  fileprivate var descendantsIncludingSelf: [MosaicNode] {
    switch self {
    case .verticalStack(let stack), .stack(let stack): [self] + stack.descendants
    case .button(let button):
      [self]
        + button.children.flatMap { $0.descendantsIncludingSelf }
        + (button.inProgressChildren ?? []).flatMap { $0.descendantsIncludingSelf }
    case .carousel(let carousel):
      [self] + carousel.pages.flatMap { $0.content.descendants }
    case .productSelector(let selector):
      [self] + selector.cards.flatMap(\.descendantNodes)
    default: [self]
    }
  }

  var visibility: MosaicVisibility {
    switch self {
    case .verticalStack(let value), .stack(let value): value.visibility
    case .text(let value): value.visibility
    case .image(let value): value.visibility
    case .icon(let value): value.visibility
    case .featureList(let value): value.visibility
    case .productSelector(let value): value.visibility
    case .button(let value): value.visibility
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

extension MosaicProductCardComponent {
  fileprivate var descendantNodes: [MosaicNode] {
    children.flatMap { child in
      switch child {
      case .node(let node): node.descendantsIncludingSelf
      case .badge(let badge): badge.children.flatMap(\.descendantsIncludingSelf)
      }
    }
  }
}

private func safeDiagnosticCode(_ code: String, fallback: String) -> String {
  guard
    code.count <= 96,
    code.range(
      of: "^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$",
      options: .regularExpression
    ) != nil
  else {
    return fallback
  }
  return code
}
