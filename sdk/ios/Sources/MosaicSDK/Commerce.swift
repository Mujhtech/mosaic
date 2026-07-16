public struct MosaicProduct: Sendable, Equatable {
  public let id: String
  public let title: String
  public let localizedPrice: String

  public init(id: String, title: String, localizedPrice: String) {
    self.id = id
    self.title = title
    self.localizedPrice = localizedPrice
  }
}

public struct MosaicEntitlement: Sendable, Hashable {
  public let id: String

  public init(id: String) {
    self.id = id
  }
}

public enum MosaicProductLoadResult: Sendable, Equatable {
  case loaded([MosaicProduct])
  case unavailable(productIDs: [String], message: String?)
}

public enum MosaicPurchaseResult: Sendable, Equatable {
  case purchased(productID: String, transactionID: String)
  case alreadyEntitled(productID: String)
  case cancelled(productID: String)
  case productUnavailable(productID: String)
  case failed(productID: String, message: String)
}

public enum MosaicRestoreResult: Sendable, Equatable {
  case restored(Set<MosaicEntitlement>)
  case nothingToRestore
  case failed(message: String)
}

public enum MosaicActiveEntitlementsResult: Sendable, Equatable {
  case active(Set<MosaicEntitlement>)
  case unavailable(message: String)
}

/// Implemented by RevenueCat, StoreKit, or app-owned purchase adapters.
public protocol MosaicPurchaseProvider: Sendable {
  func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult
  func purchase(productID: String) async -> MosaicPurchaseResult
  func restore() async -> MosaicRestoreResult
  func activeEntitlements() async -> MosaicActiveEntitlementsResult
}
