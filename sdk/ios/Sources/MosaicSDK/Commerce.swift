import Foundation

/// Runtime store data. Protocol documents contain only opaque provider IDs and
/// never persist these localized values.
public struct MosaicProduct: Sendable, Equatable, Identifiable {
  public let id: String
  public let title: String
  public let localizedPrice: String
  public let localizedSubscriptionPeriod: String?
  public let currencyCode: String?
  public let billingPeriod: MosaicCommercePeriod?
  public let trial: MosaicCommerceTrial?
  public let introductoryOffer: MosaicCommerceIntroductoryOffer?

  public init(
    id: String,
    title: String,
    localizedPrice: String,
    localizedSubscriptionPeriod: String? = nil,
    currencyCode: String? = nil,
    billingPeriod: MosaicCommercePeriod? = nil,
    trial: MosaicCommerceTrial? = nil,
    introductoryOffer: MosaicCommerceIntroductoryOffer? = nil
  ) {
    self.id = id
    self.title = title
    self.localizedPrice = localizedPrice
    self.localizedSubscriptionPeriod = localizedSubscriptionPeriod
    self.currencyCode = currencyCode
    self.billingPeriod = billingPeriod
    self.trial = trial
    self.introductoryOffer = introductoryOffer
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
  case unavailable(
    productIDs: [String],
    diagnosticCode: String?,
    diagnostic: MosaicCommerceDiagnostic? = nil
  )
}

public enum MosaicPurchaseResult: Sendable, Equatable {
  case purchased(productID: String, transactionID: String?)
  case pending(productID: String, transactionID: String?)
  case deferred(productID: String)
  case alreadyEntitled(productID: String)
  case cancelled(productID: String)
  case productUnavailable(productID: String)
  case providerUnavailable(
    productID: String,
    diagnosticCode: String,
    diagnostic: MosaicCommerceDiagnostic
  )
  case failed(
    productID: String,
    diagnosticCode: String,
    diagnostic: MosaicCommerceDiagnostic
  )
}

public enum MosaicRestoreResult: Sendable, Equatable {
  case restored(Set<MosaicEntitlement>)
  case nothingToRestore
  case cancelled
  case providerUnavailable(
    diagnosticCode: String,
    diagnostic: MosaicCommerceDiagnostic
  )
  case failed(
    diagnosticCode: String,
    diagnostic: MosaicCommerceDiagnostic
  )
}

public enum MosaicActiveEntitlementsResult: Sendable, Equatable {
  case available(Set<MosaicEntitlement>)
  case unknown(
    diagnosticCode: String?,
    diagnostic: MosaicCommerceDiagnostic? = nil
  )
  case providerUnavailable(
    diagnosticCode: String,
    diagnostic: MosaicCommerceDiagnostic
  )
  case failed(
    diagnosticCode: String,
    diagnostic: MosaicCommerceDiagnostic
  )
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
  case purchasePending
  case purchaseDeferred
  case restored
  case alreadyEntitled
  case dismissed
  case cancelled
  case restoreCancelled
  case productUnavailable
  case providerUnavailable
  case purchaseFailed
  case restoreNoPurchases
  case restoreFailed
}

public enum MosaicInteractionOutcome: Sendable, Equatable {
  case productSelected(productReferenceID: String)
  case purchased(productReferenceID: String)
  case purchasePending(productReferenceID: String)
  case purchaseDeferred(productReferenceID: String)
  case restored
  case alreadyEntitled(productReferenceID: String?)
  case dismissed
  case cancelled(productReferenceID: String)
  case restoreCancelled
  case productUnavailable(productReferenceID: String)
  case providerUnavailable(productReferenceID: String?, diagnosticCode: String)
  case purchaseFailed(productReferenceID: String, diagnosticCode: String)
  case restoreNoPurchases
  case restoreFailed(diagnosticCode: String)

  public var name: MosaicInteractionOutcomeName {
    switch self {
    case .productSelected: .productSelected
    case .purchased: .purchased
    case .purchasePending: .purchasePending
    case .purchaseDeferred: .purchaseDeferred
    case .restored: .restored
    case .alreadyEntitled: .alreadyEntitled
    case .dismissed: .dismissed
    case .cancelled: .cancelled
    case .restoreCancelled: .restoreCancelled
    case .productUnavailable: .productUnavailable
    case .providerUnavailable: .providerUnavailable
    case .purchaseFailed: .purchaseFailed
    case .restoreNoPurchases: .restoreNoPurchases
    case .restoreFailed: .restoreFailed
    }
  }
}

public enum MosaicPresentationOutcomeName: String, Sendable, CaseIterable {
  case purchased
  case purchasePending
  case purchaseDeferred
  case restored
  case alreadyEntitled
  case dismissed
  case cancelled
  case restoreCancelled
  case productUnavailable
  case providerUnavailable
  case configurationUnavailable
  case purchaseFailed
  case renderingFailed
}

public enum MosaicPresentationResult: Sendable, Equatable {
  case purchased(productReferenceID: String)
  case purchasePending(productReferenceID: String)
  case purchaseDeferred(productReferenceID: String)
  case restored
  case alreadyEntitled(productReferenceID: String?)
  case dismissed
  case cancelled(productReferenceID: String)
  case restoreCancelled
  case productUnavailable(productReferenceID: String)
  case providerUnavailable(productReferenceID: String?, diagnosticCode: String)
  case configurationUnavailable
  case purchaseFailed(productReferenceID: String, diagnosticCode: String)
  case renderingFailed(diagnosticCode: String)

  public var name: MosaicPresentationOutcomeName {
    switch self {
    case .purchased: .purchased
    case .purchasePending: .purchasePending
    case .purchaseDeferred: .purchaseDeferred
    case .restored: .restored
    case .alreadyEntitled: .alreadyEntitled
    case .dismissed: .dismissed
    case .cancelled: .cancelled
    case .restoreCancelled: .restoreCancelled
    case .productUnavailable: .productUnavailable
    case .providerUnavailable: .providerUnavailable
    case .configurationUnavailable: .configurationUnavailable
    case .purchaseFailed: .purchaseFailed
    case .renderingFailed: .renderingFailed
    }
  }
}
