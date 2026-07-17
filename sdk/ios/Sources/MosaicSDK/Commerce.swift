import Foundation

/// Runtime store data. Protocol documents contain only opaque provider IDs and
/// never persist these localized values.
public struct MosaicProduct: Sendable, Equatable, Identifiable {
  public let id: String
  public let title: String
  public let localizedPrice: String
  public let localizedSubscriptionPeriod: String?

  public init(
    id: String,
    title: String,
    localizedPrice: String,
    localizedSubscriptionPeriod: String? = nil
  ) {
    self.id = id
    self.title = title
    self.localizedPrice = localizedPrice
    self.localizedSubscriptionPeriod = localizedSubscriptionPeriod
  }
}

public struct MosaicEntitlement: Sendable, Hashable {
  public let id: String

  public init(id: String) {
    self.id = id
  }
}

public enum MosaicProductLoadResult: Sendable, Equatable {
  /// Providers may return a subset. The renderer omits missing products and
  /// applies the protocol selector fallback deterministically.
  case loaded([MosaicProduct])
  case unavailable(productIDs: [String], diagnosticCode: String?)
}

public enum MosaicPurchaseResult: Sendable, Equatable {
  case purchased(productID: String, transactionID: String)
  case alreadyEntitled(productID: String)
  case cancelled(productID: String)
  case productUnavailable(productID: String)
  case failed(productID: String, diagnosticCode: String)
}

public enum MosaicRestoreResult: Sendable, Equatable {
  case restored(Set<MosaicEntitlement>)
  case alreadyEntitled(Set<MosaicEntitlement>)
  case nothingToRestore
  case failed(diagnosticCode: String)
}

public enum MosaicActiveEntitlementsResult: Sendable, Equatable {
  case active(Set<MosaicEntitlement>)
  case unavailable(diagnosticCode: String)
}

/// Implemented later by RevenueCat, StoreKit, or app-owned adapters. Phase 1
/// uses only the deterministic mock implementation.
public protocol MosaicPurchaseProvider: Sendable {
  func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult
  func purchase(productID: String) async -> MosaicPurchaseResult
  func restore() async -> MosaicRestoreResult
  func activeEntitlements() async -> MosaicActiveEntitlementsResult
}

public enum MosaicInteractionOutcomeName: String, Sendable, CaseIterable {
  case productSelected
  case purchased
  case restored
  case alreadyEntitled
  case dismissed
  case cancelled
  case productUnavailable
  case purchaseFailed
  case restoreNoPurchases
  case restoreFailed
}

public enum MosaicInteractionOutcome: Sendable, Equatable {
  case productSelected(productReferenceID: String)
  case purchased(productReferenceID: String)
  case restored
  case alreadyEntitled(productReferenceID: String?)
  case dismissed
  case cancelled(productReferenceID: String)
  case productUnavailable(productReferenceID: String)
  case purchaseFailed(productReferenceID: String, diagnosticCode: String)
  case restoreNoPurchases
  case restoreFailed(diagnosticCode: String)

  public var name: MosaicInteractionOutcomeName {
    switch self {
    case .productSelected: .productSelected
    case .purchased: .purchased
    case .restored: .restored
    case .alreadyEntitled: .alreadyEntitled
    case .dismissed: .dismissed
    case .cancelled: .cancelled
    case .productUnavailable: .productUnavailable
    case .purchaseFailed: .purchaseFailed
    case .restoreNoPurchases: .restoreNoPurchases
    case .restoreFailed: .restoreFailed
    }
  }
}

public enum MosaicPresentationOutcomeName: String, Sendable, CaseIterable {
  case purchased
  case restored
  case alreadyEntitled
  case dismissed
  case cancelled
  case productUnavailable
  case configurationUnavailable
  case purchaseFailed
  case renderingFailed
}

public enum MosaicPresentationResult: Sendable, Equatable {
  case purchased(productReferenceID: String)
  case restored
  case alreadyEntitled(productReferenceID: String?)
  case dismissed
  case cancelled(productReferenceID: String)
  case productUnavailable(productReferenceID: String)
  case configurationUnavailable
  case purchaseFailed(productReferenceID: String, diagnosticCode: String)
  case renderingFailed(diagnosticCode: String)

  public var name: MosaicPresentationOutcomeName {
    switch self {
    case .purchased: .purchased
    case .restored: .restored
    case .alreadyEntitled: .alreadyEntitled
    case .dismissed: .dismissed
    case .cancelled: .cancelled
    case .productUnavailable: .productUnavailable
    case .configurationUnavailable: .configurationUnavailable
    case .purchaseFailed: .purchaseFailed
    case .renderingFailed: .renderingFailed
    }
  }
}
