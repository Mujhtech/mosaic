/// Deterministic provider for examples and tests; it never talks to a store.
public actor MockMosaicPurchaseProvider: MosaicPurchaseProvider {
  private let products: [String: MosaicProduct]
  private var entitlements: Set<MosaicEntitlement>

  public init(
    products: [MosaicProduct] = [],
    activeEntitlements: Set<MosaicEntitlement> = []
  ) {
    self.products = Dictionary(
      products.map { ($0.id, $0) },
      uniquingKeysWith: { _, replacement in replacement }
    )
    entitlements = activeEntitlements
  }

  public func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    let missing = identifiers.filter { products[$0] == nil }
    guard missing.isEmpty else {
      return .unavailable(
        productIDs: missing,
        message: "One or more mock products are unavailable."
      )
    }
    return .loaded(identifiers.compactMap { products[$0] })
  }

  public func purchase(productID: String) async -> MosaicPurchaseResult {
    guard products[productID] != nil else {
      return .productUnavailable(productID: productID)
    }
    let entitlement = MosaicEntitlement(id: productID)
    guard !entitlements.contains(entitlement) else {
      return .alreadyEntitled(productID: productID)
    }
    entitlements.insert(entitlement)
    return .purchased(productID: productID, transactionID: "mock-\(productID)")
  }

  public func restore() async -> MosaicRestoreResult {
    entitlements.isEmpty ? .nothingToRestore : .restored(entitlements)
  }

  public func activeEntitlements() async -> MosaicActiveEntitlementsResult {
    .active(entitlements)
  }
}
