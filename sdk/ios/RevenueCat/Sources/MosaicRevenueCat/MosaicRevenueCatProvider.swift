import Foundation
import MosaicSDK
@preconcurrency import RevenueCat

public let mosaicRevenueCatAdapterVersion = "1.0.0"

public enum MosaicRevenueCatProviderError: Error, Sendable, Equatable {
  /// Mosaic never configures RevenueCat because the host application owns API
  /// keys, App User IDs, proxy settings, and RevenueCat lifecycle.
  case purchasesNotConfigured
}

public actor MosaicRevenueCatProvider: MosaicCommerceProvider {
  public nonisolated let identity = MosaicCommerceProviderIdentity(
    id: "revenuecat",
    displayName: "RevenueCat",
    adapterVersion: mosaicRevenueCatAdapterVersion
  )
  public nonisolated let capabilities: [MosaicCommerceCapability] = [
    MosaicCommerceCapability(name: .productLoading, support: .supported),
    MosaicCommerceCapability(name: .subscriptions, support: .supported),
    MosaicCommerceCapability(name: .oneTimeNonConsumables, support: .supported),
    MosaicCommerceCapability(
      name: .trials,
      support: .conditional,
      reasonCode: "provider.platformCapabilityVaries"
    ),
    MosaicCommerceCapability(
      name: .introductoryOffers,
      support: .conditional,
      reasonCode: "provider.platformCapabilityVaries"
    ),
    MosaicCommerceCapability(
      name: .promotionalOffers,
      support: .conditional,
      reasonCode: "provider.runtimeEligibilityRequired"
    ),
    MosaicCommerceCapability(name: .restore, support: .supported),
    MosaicCommerceCapability(name: .activeEntitlementLookup, support: .supported),
    MosaicCommerceCapability(name: .pendingPurchases, support: .supported),
    MosaicCommerceCapability(
      name: .deferredPurchases,
      support: .unsupported,
      reasonCode: "provider.outcomeNotDistinct"
    ),
    MosaicCommerceCapability(
      name: .serverConfirmedTransactions,
      support: .conditional,
      reasonCode: "provider.runtimeConfirmation"
    ),
    MosaicCommerceCapability(name: .productSynchronization, support: .supported),
    MosaicCommerceCapability(name: .providerDiagnostics, support: .supported),
  ]

  private let client: any RevenueCatClient
  private var loaded: [String: RevenueCatProductSnapshot] = [:]
  private var lastDiagnostics: [MosaicCommerceDiagnostic] = []
  private var loadRevision = 0
  private var diagnosticSequence = 0

  public init() throws {
    guard Purchases.isConfigured else {
      throw MosaicRevenueCatProviderError.purchasesNotConfigured
    }
    client = LiveRevenueCatClient(purchases: Purchases.shared)
  }

  init(client: any RevenueCatClient) {
    self.client = client
  }

  public func invalidateLoadedProducts() {
    loadRevision += 1
    loaded = [:]
    lastDiagnostics = []
  }

  public func loadProducts(
    mappings: [MosaicCommerceProductMapping]
  ) async -> [MosaicCommerceResolvedProduct] {
    loadRevision += 1
    let revision = loadRevision
    loaded = [:]
    lastDiagnostics = []

    let directMappings = mappings.filter {
      if case .directProduct = $0.adapterMapping { return true }
      return false
    }
    let packageMappings = mappings.compactMap { mapping -> RevenueCatPackageTarget? in
      guard
        case .revenueCatPackage(let offering, let package) = mapping.adapterMapping
      else { return nil }
      return RevenueCatPackageTarget(
        offeringIdentifier: offering,
        packageIdentifier: package
      )
    }

    let directProducts = await client.products(
      identifiers: directMappings.map(\.providerProductReference)
    )
    let directByIdentifier = Dictionary(
      grouping: directProducts,
      by: \.providerProductIdentifier
    )

    var packages: [RevenueCatPackageTarget: RevenueCatProductSnapshot] = [:]
    var packageLoadFailure: RevenueCatFailure?
    if !packageMappings.isEmpty {
      do {
        packages = try await client.packages(targets: packageMappings)
      } catch {
        packageLoadFailure = RevenueCatFailure(error)
      }
    }

    guard revision == loadRevision else {
      return mappings.map {
        MosaicCommerceResolvedProduct(
          mosaicProductID: $0.mosaicProductID,
          product: nil,
          availability: MosaicCommerceProductAvailability(
            status: .unknown,
            reason: .temporarilyUnavailable
          )
        )
      }
    }
    if let packageLoadFailure {
      record(
        code: "commerce.providerUnavailable",
        message: "RevenueCat Offerings are temporarily unavailable.",
        severity: .error,
        retryable: true,
        providerCode: packageLoadFailure.providerCode,
        recovery: .retry
      )
    }

    return mappings.map { mapping in
      let snapshot: RevenueCatProductSnapshot?
      let unavailableReason: MosaicCommerceProductAvailabilityReason
      switch mapping.adapterMapping {
      case .directProduct:
        let matches = directByIdentifier[mapping.providerProductReference] ?? []
        snapshot = matches.count == 1 ? matches[0] : nil
        unavailableReason = .productNotFound
      case .revenueCatPackage(let offering, let package):
        let target = RevenueCatPackageTarget(
          offeringIdentifier: offering,
          packageIdentifier: package
        )
        snapshot = packages[target]
        unavailableReason = packageLoadFailure == nil ? .productNotFound : .providerUnavailable
      case .storeKitProduct, .googlePlayProduct:
        snapshot = nil
        unavailableReason = .mappingInvalid
      }

      guard let snapshot else {
        return unavailable(
          mapping: mapping,
          reason: unavailableReason,
          code: unavailableReason == .providerUnavailable
            ? "commerce.providerUnavailable"
            : "commerce.productUnavailable",
          providerCode: unavailableReason == .providerUnavailable
            ? packageLoadFailure?.providerCode ?? "provider_unavailable"
            : "product_not_found"
        )
      }
      guard snapshot.providerProductIdentifier == mapping.providerProductReference else {
        return unavailable(
          mapping: mapping,
          reason: .mappingInvalid,
          code: "commerce.mappingInvalid",
          providerCode: "product_reference_mismatch"
        )
      }

      loaded[mapping.mosaicProductID] = snapshot
      if snapshot.unknownPeriodUnit {
        recordFailure(
          code: "commerce.unsupportedSubscriptionPeriod",
          message: "RevenueCat reported a subscription period unit Mosaic does not support.",
          providerCode: "unknown_period_unit",
          mosaicProductID: mapping.mosaicProductID
        )
      }
      if snapshot.unknownOfferType {
        recordFailure(
          code: "commerce.unsupportedIntroductoryOffer",
          message: "RevenueCat reported an introductory offer type Mosaic does not support.",
          providerCode: "unknown_offer_type",
          mosaicProductID: mapping.mosaicProductID
        )
      }
      return MosaicCommerceResolvedProduct(
        mosaicProductID: mapping.mosaicProductID,
        product: MosaicProduct(
          id: mapping.mosaicProductID,
          title: snapshot.localizedTitle,
          localizedPrice: snapshot.localizedPrice,
          currencyCode: snapshot.currencyCode,
          billingPeriod: snapshot.billingPeriod,
          trial: snapshot.trial,
          introductoryOffer: snapshot.introductoryOffer
        ),
        availability: MosaicCommerceProductAvailability(status: .available)
      )
    }
  }

  public func purchase(mosaicProductID: String) async -> MosaicPurchaseResult {
    guard let product = loaded[mosaicProductID] else {
      return .productUnavailable(productID: mosaicProductID)
    }
    do {
      switch try await client.purchase(handle: product.handle) {
      case .purchased(let transactionID):
        return .purchased(productID: mosaicProductID, transactionID: transactionID)
      case .cancelled:
        return .cancelled(productID: mosaicProductID)
      }
    } catch {
      let failure = RevenueCatFailure(error)
      switch failure.kind {
      case .cancelled:
        return .cancelled(productID: mosaicProductID)
      case .pending:
        return .pending(productID: mosaicProductID, transactionID: nil)
      case .alreadyEntitled:
        return .alreadyEntitled(productID: mosaicProductID)
      case .productUnavailable:
        return .productUnavailable(productID: mosaicProductID)
      case .providerUnavailable:
        let diagnostic = recordProviderUnavailable(
          operation: "purchase",
          providerCode: failure.providerCode,
          mosaicProductID: mosaicProductID
        )
        return .providerUnavailable(
          productID: mosaicProductID,
          diagnosticCode: diagnostic.code,
          diagnostic: diagnostic
        )
      case .failed:
        let diagnostic = recordFailure(
          code: "commerce.purchaseFailed",
          message: "RevenueCat could not complete the purchase.",
          providerCode: failure.providerCode,
          mosaicProductID: mosaicProductID
        )
        return .failed(
          productID: mosaicProductID,
          diagnosticCode: diagnostic.code,
          diagnostic: diagnostic
        )
      }
    }
  }

  public func restore(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicRestoreResult {
    do {
      let activeProviderIDs = try await client.restore()
      let entitlements = mappedEntitlements(activeProviderIDs, mappings: entitlementMappings)
      return entitlements.isEmpty ? .nothingToRestore : .restored(entitlements)
    } catch {
      let failure = RevenueCatFailure(error)
      switch failure.kind {
      case .cancelled:
        return .cancelled
      case .providerUnavailable:
        let diagnostic = recordProviderUnavailable(
          operation: "restore",
          providerCode: failure.providerCode
        )
        return .providerUnavailable(
          diagnosticCode: diagnostic.code,
          diagnostic: diagnostic
        )
      default:
        let diagnostic = recordFailure(
          code: "commerce.restoreFailed",
          message: "RevenueCat could not restore purchases.",
          providerCode: failure.providerCode
        )
        return .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
      }
    }
  }

  public func activeEntitlements(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicActiveEntitlementsResult {
    do {
      let activeProviderIDs = try await client.activeEntitlements()
      return .available(mappedEntitlements(activeProviderIDs, mappings: entitlementMappings))
    } catch {
      let failure = RevenueCatFailure(error)
      switch failure.kind {
      case .providerUnavailable:
        let diagnostic = recordProviderUnavailable(
          operation: "entitlement lookup",
          providerCode: failure.providerCode
        )
        return .providerUnavailable(
          diagnosticCode: diagnostic.code,
          diagnostic: diagnostic
        )
      default:
        let diagnostic = recordFailure(
          code: "commerce.entitlementLookupFailed",
          message: "RevenueCat could not read active access.",
          providerCode: failure.providerCode
        )
        return .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
      }
    }
  }

  public func providerDiagnostics() async -> MosaicCommerceProviderDiagnostics {
    MosaicCommerceProviderDiagnostics(
      providerID: identity.id,
      health: lastDiagnostics.isEmpty ? .healthy : .degraded,
      diagnostics: lastDiagnostics
    )
  }

  private func unavailable(
    mapping: MosaicCommerceProductMapping,
    reason: MosaicCommerceProductAvailabilityReason,
    code: String,
    providerCode: String
  ) -> MosaicCommerceResolvedProduct {
    let diagnostic = MosaicCommerceDiagnostic(
      code: code,
      safeMessage: reason == .mappingInvalid
        ? "The RevenueCat Product mapping is invalid."
        : "The RevenueCat Product is unavailable.",
      severity: .warning,
      retryable: reason == .providerUnavailable,
      correlationID: nextCorrelationID(operation: "product_load"),
      providerCode: providerCode,
      mosaicProductID: mapping.mosaicProductID,
      recoveryAction: reason == .providerUnavailable ? .retry : .fixProductMapping
    )
    appendDiagnostic(diagnostic)
    return MosaicCommerceResolvedProduct(
      mosaicProductID: mapping.mosaicProductID,
      product: nil,
      availability: MosaicCommerceProductAvailability(status: .unavailable, reason: reason),
      diagnostics: [diagnostic]
    )
  }

  private func mappedEntitlements(
    _ providerIdentifiers: Set<String>,
    mappings: [MosaicCommerceEntitlementMapping]
  ) -> Set<MosaicEntitlement> {
    Set(
      mappings.compactMap { mapping in
        providerIdentifiers.contains(mapping.providerEntitlementIdentifier)
          ? MosaicEntitlement(id: mapping.mosaicEntitlementKey)
          : nil
      }
    )
  }

  private func recordProviderUnavailable(
    operation: String,
    providerCode: String,
    mosaicProductID: String? = nil
  ) -> MosaicCommerceDiagnostic {
    record(
      code: "commerce.providerUnavailable",
      message: "RevenueCat is temporarily unavailable for \(operation).",
      severity: .error,
      retryable: true,
      providerCode: providerCode,
      mosaicProductID: mosaicProductID,
      recovery: .retry
    )
  }

  @discardableResult
  private func recordFailure(
    code: String,
    message: String,
    providerCode: String,
    mosaicProductID: String? = nil
  ) -> MosaicCommerceDiagnostic {
    record(
      code: code,
      message: message,
      severity: .error,
      retryable: false,
      providerCode: providerCode,
      mosaicProductID: mosaicProductID,
      recovery: .contactProvider
    )
  }

  private func record(
    code: String,
    message: String,
    severity: MosaicCommerceDiagnosticSeverity,
    retryable: Bool,
    providerCode: String,
    mosaicProductID: String? = nil,
    recovery: MosaicCommerceRecoveryAction
  ) -> MosaicCommerceDiagnostic {
    let diagnostic = MosaicCommerceDiagnostic(
      code: code,
      safeMessage: message,
      severity: severity,
      retryable: retryable,
      correlationID: nextCorrelationID(operation: "provider"),
      providerCode: providerCode,
      mosaicProductID: mosaicProductID,
      recoveryAction: recovery
    )
    appendDiagnostic(diagnostic)
    return diagnostic
  }

  private func nextCorrelationID(operation: String) -> String {
    diagnosticSequence += 1
    return "ios_revenuecat_\(operation)_\(diagnosticSequence)"
  }

  private func appendDiagnostic(_ diagnostic: MosaicCommerceDiagnostic) {
    if lastDiagnostics.count == 32 {
      lastDiagnostics.removeFirst()
    }
    lastDiagnostics.append(diagnostic)
  }
}

struct RevenueCatPackageTarget: Hashable, Sendable {
  let offeringIdentifier: String
  let packageIdentifier: String
}

enum RevenueCatProductHandle: @unchecked Sendable {
  case product(StoreProduct)
  case package(Package)
  case test(String)
}

struct RevenueCatProductSnapshot: @unchecked Sendable {
  let providerProductIdentifier: String
  let localizedTitle: String
  let localizedPrice: String
  let currencyCode: String?
  let billingPeriod: MosaicCommercePeriod?
  let trial: MosaicCommerceTrial?
  let introductoryOffer: MosaicCommerceIntroductoryOffer?
  let handle: RevenueCatProductHandle
  /// RevenueCat reported a subscription period unit this SDK version does not
  /// know. The affected period is omitted rather than guessed.
  let unknownPeriodUnit: Bool
  /// RevenueCat reported an introductory payment mode this SDK version does not
  /// know, so the offer is neither a trial nor an introductory offer here.
  let unknownOfferType: Bool

  init(
    providerProductIdentifier: String,
    localizedTitle: String,
    localizedPrice: String,
    currencyCode: String?,
    billingPeriod: MosaicCommercePeriod?,
    trial: MosaicCommerceTrial?,
    introductoryOffer: MosaicCommerceIntroductoryOffer?,
    handle: RevenueCatProductHandle,
    unknownPeriodUnit: Bool = false,
    unknownOfferType: Bool = false
  ) {
    self.providerProductIdentifier = providerProductIdentifier
    self.localizedTitle = localizedTitle
    self.localizedPrice = localizedPrice
    self.currencyCode = currencyCode
    self.billingPeriod = billingPeriod
    self.trial = trial
    self.introductoryOffer = introductoryOffer
    self.handle = handle
    self.unknownPeriodUnit = unknownPeriodUnit
    self.unknownOfferType = unknownOfferType
  }
}

enum RevenueCatClientPurchaseResult: Sendable {
  case purchased(transactionID: String?)
  case cancelled
}

protocol RevenueCatClient: Sendable {
  func products(identifiers: [String]) async -> [RevenueCatProductSnapshot]
  func packages(
    targets: [RevenueCatPackageTarget]
  ) async throws -> [RevenueCatPackageTarget: RevenueCatProductSnapshot]
  func purchase(handle: RevenueCatProductHandle) async throws -> RevenueCatClientPurchaseResult
  func restore() async throws -> Set<String>
  func activeEntitlements() async throws -> Set<String>
}

private enum LiveRevenueCatClientError: Error {
  case unsupportedProductHandle
}

private final class LiveRevenueCatClient: RevenueCatClient, @unchecked Sendable {
  private let purchases: Purchases

  init(purchases: Purchases) {
    self.purchases = purchases
  }

  func products(identifiers: [String]) async -> [RevenueCatProductSnapshot] {
    await purchases.products(identifiers).map {
      Self.snapshot(product: $0, handle: .product($0))
    }
  }

  func packages(
    targets: [RevenueCatPackageTarget]
  ) async throws -> [RevenueCatPackageTarget: RevenueCatProductSnapshot] {
    let offerings = try await purchases.offerings()
    var result: [RevenueCatPackageTarget: RevenueCatProductSnapshot] = [:]
    for target in Set(targets) {
      guard
        let package = offerings.all[target.offeringIdentifier]?.package(
          identifier: target.packageIdentifier
        )
      else { continue }
      result[target] = Self.snapshot(
        product: package.storeProduct,
        handle: .package(package)
      )
    }
    return result
  }

  func purchase(handle: RevenueCatProductHandle) async throws
    -> RevenueCatClientPurchaseResult
  {
    let result: PurchaseResultData
    switch handle {
    case .product(let product):
      result = try await purchases.purchase(product: product)
    case .package(let package):
      result = try await purchases.purchase(package: package)
    case .test:
      // Unreachable through the public API, but a trap here would crash the
      // host application. The router sanitizes this into a safe purchase
      // failure diagnostic instead.
      throw LiveRevenueCatClientError.unsupportedProductHandle
    }
    if result.userCancelled { return .cancelled }
    return .purchased(transactionID: result.transaction?.transactionIdentifier)
  }

  func restore() async throws -> Set<String> {
    activeEntitlements(in: try await purchases.restorePurchases())
  }

  func activeEntitlements() async throws -> Set<String> {
    activeEntitlements(in: try await purchases.customerInfo())
  }

  private func activeEntitlements(in customerInfo: CustomerInfo) -> Set<String> {
    Set(customerInfo.entitlements.active.keys)
  }

  private static func snapshot(
    product: StoreProduct,
    handle: RevenueCatProductHandle
  ) -> RevenueCatProductSnapshot {
    let billingPeriod = product.subscriptionPeriod.flatMap(period)
    let discount = product.introductoryDiscount
    let trial: MosaicCommerceTrial?
    let introductoryOffer: MosaicCommerceIntroductoryOffer?
    var unknownOfferType = false
    switch discount?.paymentMode {
    case .freeTrial:
      trial = discount.flatMap { discount in
        period(discount.subscriptionPeriod).map { MosaicCommerceTrial(period: $0) }
      }
      introductoryOffer = nil
    case .payAsYouGo, .payUpFront:
      trial = nil
      introductoryOffer = discount.flatMap { discount -> MosaicCommerceIntroductoryOffer? in
        let paymentMode: MosaicCommerceIntroductoryPaymentMode =
          discount.paymentMode == .payAsYouGo ? .payAsYouGo : .payUpFront
        guard let period = period(discount.subscriptionPeriod) else { return nil }
        return MosaicCommerceIntroductoryOffer(
          localizedPrice: discount.localizedPriceString,
          period: period,
          cycles: discount.numberOfPeriods,
          paymentMode: paymentMode
        )
      }
    case nil:
      trial = nil
      introductoryOffer = nil
    @unknown default:
      // An offer exists and Mosaic cannot classify it. Stripping it silently
      // hides a trial the customer is entitled to see, so it is reported.
      trial = nil
      introductoryOffer = nil
      unknownOfferType = true
    }
    let declaredPeriods = [product.subscriptionPeriod, discount?.subscriptionPeriod]
      .compactMap { $0 }
    let readPeriods = [billingPeriod, trial?.period, introductoryOffer?.period]
      .compactMap { $0 }
    return RevenueCatProductSnapshot(
      providerProductIdentifier: product.productIdentifier,
      localizedTitle: product.localizedTitle,
      localizedPrice: product.localizedPriceString,
      currencyCode: product.currencyCode,
      billingPeriod: billingPeriod,
      trial: trial,
      introductoryOffer: introductoryOffer,
      handle: handle,
      unknownPeriodUnit: !unknownOfferType && readPeriods.count < declaredPeriods.count,
      unknownOfferType: unknownOfferType
    )
  }

  /// `nil` for a unit this SDK version does not know. Callers omit the period
  /// rather than substituting one: reporting an unknown renewal cadence as
  /// daily misstates the commercial terms of the purchase.
  private static func period(_ value: SubscriptionPeriod) -> MosaicCommercePeriod? {
    let unit: MosaicCommercePeriodUnit
    switch value.unit {
    case .day: unit = .day
    case .week: unit = .week
    case .month: unit = .month
    case .year: unit = .year
    @unknown default: return nil
    }
    return MosaicCommercePeriod(unit: unit, value: value.value)
  }
}

private struct RevenueCatFailure {
  enum Kind {
    case cancelled
    case pending
    case alreadyEntitled
    case productUnavailable
    case providerUnavailable
    case failed
  }

  let kind: Kind
  let providerCode: String

  init(_ error: Error) {
    let errorCode = (error as NSError).asErrorCode
    providerCode = Self.providerCode(for: errorCode)
    switch errorCode {
    case .purchaseCancelledError:
      kind = .cancelled
    case .paymentPendingError, .operationAlreadyInProgressForProductError:
      kind = .pending
    case .productAlreadyPurchasedError:
      kind = .alreadyEntitled
    case .productNotAvailableForPurchaseError:
      kind = .productUnavailable
    case .networkError, .offlineConnectionError, .invalidCredentialsError,
      .configurationError, .apiEndpointBlockedError, .unexpectedBackendResponseError,
      .signatureVerificationFailed:
      kind = .providerUnavailable
    default:
      kind = .failed
    }
  }

  private static func providerCode(for errorCode: ErrorCode?) -> String {
    switch errorCode {
    case .purchaseCancelledError: "purchase_cancelled"
    case .paymentPendingError: "payment_pending"
    case .operationAlreadyInProgressForProductError: "operation_already_in_progress"
    case .productAlreadyPurchasedError: "product_already_purchased"
    case .productNotAvailableForPurchaseError: "product_not_available"
    case .networkError: "network_error"
    case .offlineConnectionError: "offline_connection_error"
    case .invalidCredentialsError: "invalid_credentials"
    case .configurationError: "configuration_error"
    case .apiEndpointBlockedError: "api_endpoint_blocked"
    case .unexpectedBackendResponseError: "unexpected_backend_response"
    case .signatureVerificationFailed: "signature_verification_failed"
    default: "unknown_error"
    }
  }
}
