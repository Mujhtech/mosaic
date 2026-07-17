import Foundation

public enum MockMosaicPurchaseBehavior: Sendable, Equatable {
  /// Succeeds once, then reports the product as already entitled.
  case automatic
  case success
  case cancellation
  case failure(diagnosticCode: String)
  case unavailable
  case alreadyEntitled
}

public enum MockMosaicRestoreBehavior: Sendable, Equatable {
  /// Returns current mock entitlements, or `nothingToRestore` when empty.
  case automatic
  case success(Set<MosaicEntitlement>)
  case alreadyEntitled(Set<MosaicEntitlement>)
  case noPurchases
  case failure(diagnosticCode: String)
}

/// Deterministic provider for Phase 1 examples and tests; it never talks to a
/// store and is not a StoreKit simulator or production adapter.
public actor MockMosaicPurchaseProvider: MosaicPurchaseProvider {
  private let products: [String: MosaicProduct]
  private let purchaseBehavior: MockMosaicPurchaseBehavior
  private let restoreBehavior: MockMosaicRestoreBehavior
  private var entitlements: Set<MosaicEntitlement>

  public init(
    products: [MosaicProduct] = [],
    activeEntitlements: Set<MosaicEntitlement> = [],
    purchaseBehavior: MockMosaicPurchaseBehavior = .automatic,
    restoreBehavior: MockMosaicRestoreBehavior = .automatic
  ) {
    self.products = Dictionary(
      products.map { ($0.id, $0) },
      uniquingKeysWith: { _, replacement in replacement }
    )
    self.purchaseBehavior = purchaseBehavior
    self.restoreBehavior = restoreBehavior
    entitlements = activeEntitlements
  }

  public func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    let available = identifiers.compactMap { products[$0] }
    if available.isEmpty, !identifiers.isEmpty {
      return .unavailable(
        productIDs: identifiers,
        diagnosticCode: "mock_products_unavailable"
      )
    }
    return .loaded(available)
  }

  public func purchase(productID: String) async -> MosaicPurchaseResult {
    guard products[productID] != nil else {
      return .productUnavailable(productID: productID)
    }

    switch purchaseBehavior {
    case .automatic:
      let entitlement = MosaicEntitlement(id: productID)
      guard !entitlements.contains(entitlement) else {
        return .alreadyEntitled(productID: productID)
      }
      entitlements.insert(entitlement)
      return .purchased(productID: productID, transactionID: "mock-\(productID)")
    case .success:
      entitlements.insert(MosaicEntitlement(id: productID))
      return .purchased(productID: productID, transactionID: "mock-\(productID)")
    case .cancellation:
      return .cancelled(productID: productID)
    case .failure(let diagnosticCode):
      return .failed(productID: productID, diagnosticCode: diagnosticCode)
    case .unavailable:
      return .productUnavailable(productID: productID)
    case .alreadyEntitled:
      entitlements.insert(MosaicEntitlement(id: productID))
      return .alreadyEntitled(productID: productID)
    }
  }

  public func restore() async -> MosaicRestoreResult {
    switch restoreBehavior {
    case .automatic:
      return entitlements.isEmpty ? .nothingToRestore : .restored(entitlements)
    case .success(let restored):
      entitlements.formUnion(restored)
      return .restored(restored)
    case .alreadyEntitled(let existing):
      entitlements.formUnion(existing)
      return .alreadyEntitled(existing)
    case .noPurchases:
      return .nothingToRestore
    case .failure(let diagnosticCode):
      return .failed(diagnosticCode: diagnosticCode)
    }
  }

  public func activeEntitlements() async -> MosaicActiveEntitlementsResult {
    .active(entitlements)
  }
}

extension MosaicProduct {
  public static let phase1Monthly = MosaicProduct(
    id: "mosaic_pro_monthly",
    title: "Mosaic Pro Monthly",
    localizedPrice: "$7.99",
    localizedSubscriptionPeriod: "per month"
  )

  public static let phase1Yearly = MosaicProduct(
    id: "mosaic_pro_yearly",
    title: "Mosaic Pro Yearly",
    localizedPrice: "$49.99",
    localizedSubscriptionPeriod: "per year"
  )

  public static let phase1MockProducts: [MosaicProduct] = [
    .phase1Monthly,
    .phase1Yearly,
  ]
}
