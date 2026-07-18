import Foundation

/// Local-only provider driven by `mockCommerceStateChanged` messages.
///
/// Product-reference IDs are resolved through the active validated document.
/// No StoreKit product, receipt, transaction, or credential enters this boundary.
public actor MosaicPreviewPurchaseProvider: MosaicPurchaseProvider {
  private struct Binding: Sendable {
    let productReferenceId: String
    let providerProductId: String
    let title: String
  }

  private var bindingsByProviderId: [String: Binding] = [:]
  private var productsByReferenceId: [String: MosaicPreviewMockProduct] = [:]
  private var purchaseOutcome = MosaicPreviewPurchaseOutcome.purchaseFailed
  private var restoreOutcome = MosaicPreviewRestoreOutcome.restoreFailed
  private var activeProductReferenceId: String?

  public init() {}

  public func apply(
    state: MosaicPreviewMockCommerceState,
    document: MosaicPaywallDocument
  ) {
    bindingsByProviderId = Dictionary(
      uniqueKeysWithValues: document.products.map { reference in
        (
          reference.productId,
          Binding(
            productReferenceId: reference.id,
            providerProductId: reference.productId,
            title: reference.label.defaultValue
          )
        )
      }
    )
    productsByReferenceId = Dictionary(
      uniqueKeysWithValues: state.products.map { ($0.productReferenceId, $0) }
    )
    purchaseOutcome = state.purchaseOutcome
    restoreOutcome = state.restoreOutcome
    activeProductReferenceId = state.entitlement.productReferenceId
  }

  public func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    let loaded = identifiers.compactMap { identifier -> MosaicProduct? in
      guard
        let binding = bindingsByProviderId[identifier],
        let mock = productsByReferenceId[binding.productReferenceId],
        mock.isAvailable,
        let localizedPrice = mock.localizedPrice
      else {
        return nil
      }
      let period: String?
      switch mock {
      case .subscription(_, _, _, let billingPeriod, _, _):
        period = "per \(billingPeriod.displayValue)"
      case .nonConsumable, .unavailable:
        period = nil
      }
      return MosaicProduct(
        id: binding.providerProductId,
        title: binding.title,
        localizedPrice: localizedPrice,
        localizedSubscriptionPeriod: period
      )
    }
    if loaded.isEmpty, !identifiers.isEmpty {
      return .unavailable(
        productIDs: identifiers,
        diagnosticCode: "preview.products.unavailable"
      )
    }
    return .loaded(loaded)
  }

  public func purchase(productID: String) async -> MosaicPurchaseResult {
    guard
      let binding = bindingsByProviderId[productID],
      let product = productsByReferenceId[binding.productReferenceId],
      product.isAvailable
    else {
      return .productUnavailable(productID: productID)
    }
    if activeProductReferenceId == binding.productReferenceId {
      return .alreadyEntitled(productID: productID)
    }
    switch purchaseOutcome {
    case .purchased:
      activeProductReferenceId = binding.productReferenceId
      return .purchased(
        productID: productID,
        transactionID: "preview-\(binding.productReferenceId)"
      )
    case .alreadyEntitled:
      activeProductReferenceId = binding.productReferenceId
      return .alreadyEntitled(productID: productID)
    case .cancelled:
      return .cancelled(productID: productID)
    case .purchaseFailed:
      return .failed(productID: productID, diagnosticCode: "preview.purchase.failed")
    }
  }

  public func restore() async -> MosaicRestoreResult {
    switch restoreOutcome {
    case .restored:
      guard let entitlements = activeEntitlementSet(), !entitlements.isEmpty else {
        return .nothingToRestore
      }
      return .restored(entitlements)
    case .alreadyEntitled:
      guard let entitlements = activeEntitlementSet(), !entitlements.isEmpty else {
        return .nothingToRestore
      }
      return .alreadyEntitled(entitlements)
    case .restoreNoPurchases:
      return .nothingToRestore
    case .restoreFailed:
      return .failed(diagnosticCode: "preview.restore.failed")
    }
  }

  public func activeEntitlements() async -> MosaicActiveEntitlementsResult {
    .active(activeEntitlementSet() ?? [])
  }

  private func activeEntitlementSet() -> Set<MosaicEntitlement>? {
    guard
      let activeProductReferenceId,
      let binding = bindingsByProviderId.values.first(where: {
        $0.productReferenceId == activeProductReferenceId
      })
    else {
      return []
    }
    return [MosaicEntitlement(id: binding.providerProductId)]
  }
}
