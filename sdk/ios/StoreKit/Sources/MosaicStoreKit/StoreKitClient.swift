import Foundation
import MosaicSDK
@preconcurrency import StoreKit

struct StoreKitProductSnapshot: Sendable {
  let handle: String
  let storeProductID: String
  let type: MosaicCommerceProductType?
  let displayName: String
  let displayPrice: String
  let currencyCode: String?
  let billingPeriod: MosaicCommercePeriod?
  let localizedPeriod: String?
  let trial: MosaicCommerceTrial?
  let introductoryOffer: MosaicCommerceIntroductoryOffer?
  /// StoreKit reported a subscription period unit this SDK version does not
  /// know. The affected period is omitted rather than guessed, and the product
  /// stays purchasable.
  let unknownPeriodUnit: Bool

  init(
    handle: String,
    storeProductID: String,
    type: MosaicCommerceProductType?,
    displayName: String,
    displayPrice: String,
    currencyCode: String?,
    billingPeriod: MosaicCommercePeriod?,
    localizedPeriod: String?,
    trial: MosaicCommerceTrial?,
    introductoryOffer: MosaicCommerceIntroductoryOffer?,
    unknownPeriodUnit: Bool = false
  ) {
    self.handle = handle
    self.storeProductID = storeProductID
    self.type = type
    self.displayName = displayName
    self.displayPrice = displayPrice
    self.currencyCode = currencyCode
    self.billingPeriod = billingPeriod
    self.localizedPeriod = localizedPeriod
    self.trial = trial
    self.introductoryOffer = introductoryOffer
    self.unknownPeriodUnit = unknownPeriodUnit
  }
}

/// Store Environment as StoreKit reports it.
///
/// `localTesting` is StoreKit Testing in Xcode, whose transactions have no App
/// Store record at all.
enum StoreKitTransactionEnvironment: Sendable, Equatable {
  case production
  case sandbox
  case localTesting
}

struct StoreKitTransaction: Sendable {
  let id: UInt64
  let storeProductID: String
  let occurredAt: Date
  /// `nil` below iOS 16, where `Transaction.environment` does not exist.
  let environment: StoreKitTransactionEnvironment?

  init(
    id: UInt64,
    storeProductID: String,
    occurredAt: Date,
    environment: StoreKitTransactionEnvironment? = nil
  ) {
    self.id = id
    self.storeProductID = storeProductID
    self.occurredAt = occurredAt
    self.environment = environment
  }

  /// The host-facing reference carried by `MosaicCommerceUpdate`.
  var safeReference: String { "storekit_\(id)" }

  /// The raw decimal provider identifier. It is carried as a string end to
  /// end: values above 2^53-1 lose precision as a double and values above
  /// 2^63-1 overflow a signed 64-bit integer.
  var providerTransactionID: String { String(id) }
}

enum StoreKitTransactionEvent: Sendable {
  case verified(StoreKitTransaction)
  case unverified
}

enum StoreKitPurchaseEvent: Sendable {
  case verified(StoreKitTransaction)
  case unverified
  case pending
  case cancelled
}

protocol StoreKitClient: Sendable {
  func products(identifiers: [String]) async throws -> [StoreKitProductSnapshot]
  func purchase(handle: String) async throws -> StoreKitPurchaseEvent
  func transactionUpdates() -> AsyncStream<StoreKitTransactionEvent>
  func unfinishedTransactions() -> AsyncStream<StoreKitTransactionEvent>
  func currentEntitlements() async throws -> [StoreKitTransactionEvent]
  func finish(transactionID: UInt64) async throws
  func synchronize() async throws
}

actor LiveStoreKitClient: StoreKitClient {
  private var productsByHandle: [String: Product] = [:]
  private var transactions: [UInt64: Transaction] = [:]

  func products(identifiers: [String]) async throws -> [StoreKitProductSnapshot] {
    let products = try await Product.products(for: identifiers)
    var snapshots: [StoreKitProductSnapshot] = []
    for product in products {
      let handle = UUID().uuidString
      productsByHandle[handle] = product
      let subscriptionPeriod = product.subscription?.subscriptionPeriod
      let period = subscriptionPeriod.flatMap(Self.period)
      let offer = product.subscription?.introductoryOffer
      let trial = offer.flatMap(Self.trial)
      let introductoryOffer = offer.flatMap(Self.introductoryOffer)
      // A period the SDK cannot name is reported, not approximated. Showing an
      // unknown renewal cadence as "daily" would misstate the commercial terms
      // of the purchase.
      let unknownPeriodUnit =
        (subscriptionPeriod != nil && period == nil)
        || (offer != nil && offer?.paymentMode == .freeTrial && trial == nil)
        || (offer != nil && offer?.paymentMode != .freeTrial && introductoryOffer == nil
          && Self.isSupportedIntroductoryMode(offer?.paymentMode))
      snapshots.append(
        StoreKitProductSnapshot(
          handle: handle,
          storeProductID: product.id,
          type: Self.productType(product.type),
          displayName: product.displayName,
          displayPrice: product.displayPrice,
          currencyCode: product.priceFormatStyle.currencyCode,
          billingPeriod: period,
          localizedPeriod: nil,
          trial: trial,
          introductoryOffer: introductoryOffer,
          unknownPeriodUnit: unknownPeriodUnit
        )
      )
    }
    return snapshots
  }

  func purchase(handle: String) async throws -> StoreKitPurchaseEvent {
    guard let product = productsByHandle[handle] else {
      throw StoreKitClientError.missingProduct
    }
    switch try await product.purchase() {
    case .success(let verification):
      switch verification {
      case .verified(let transaction):
        transactions[transaction.id] = transaction
        return .verified(Self.snapshot(transaction))
      case .unverified:
        return .unverified
      }
    case .pending:
      return .pending
    case .userCancelled:
      return .cancelled
    @unknown default:
      throw StoreKitClientError.unknownPurchaseResult
    }
  }

  nonisolated func transactionUpdates() -> AsyncStream<StoreKitTransactionEvent> {
    AsyncStream { continuation in
      let task = Task {
        for await verification in Transaction.updates {
          switch verification {
          case .verified(let transaction):
            await retain(transaction)
            continuation.yield(.verified(Self.snapshot(transaction)))
          case .unverified:
            continuation.yield(.unverified)
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  nonisolated func unfinishedTransactions() -> AsyncStream<StoreKitTransactionEvent> {
    AsyncStream { continuation in
      let task = Task {
        for await verification in Transaction.unfinished {
          switch verification {
          case .verified(let transaction):
            await retain(transaction)
            continuation.yield(.verified(Self.snapshot(transaction)))
          case .unverified:
            continuation.yield(.unverified)
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  func currentEntitlements() async throws -> [StoreKitTransactionEvent] {
    var result: [StoreKitTransactionEvent] = []
    for await verification in Transaction.currentEntitlements {
      switch verification {
      case .verified(let transaction):
        transactions[transaction.id] = transaction
        result.append(.verified(Self.snapshot(transaction)))
      case .unverified:
        result.append(.unverified)
      }
    }
    return result
  }

  func finish(transactionID: UInt64) async throws {
    guard let transaction = transactions[transactionID] else {
      throw StoreKitClientError.missingTransaction
    }
    await transaction.finish()
    transactions.removeValue(forKey: transactionID)
  }

  func synchronize() async throws {
    try await AppStore.sync()
  }

  private func retain(_ transaction: Transaction) {
    transactions[transaction.id] = transaction
  }

  /// The single narrowing point between StoreKit and Mosaic.
  ///
  /// `jwsRepresentation`, `deviceVerification`, `deviceVerificationNonce`,
  /// `appAccountToken`, and `appTransactionID` are deliberately never read, so
  /// signed or account-linking material cannot reach a Mosaic payload.
  nonisolated private static func snapshot(_ transaction: Transaction) -> StoreKitTransaction {
    StoreKitTransaction(
      id: transaction.id,
      storeProductID: transaction.productID,
      occurredAt: transaction.purchaseDate,
      environment: environment(transaction)
    )
  }

  /// `Transaction.environment` is iOS 16 and macOS 13, while the package floor
  /// is iOS 15. The gate keeps the floor rather than raising it; below the gate
  /// the environment is simply unreported.
  nonisolated private static func environment(
    _ transaction: Transaction
  ) -> StoreKitTransactionEnvironment? {
    guard #available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *) else { return nil }
    switch transaction.environment {
    case .production: return .production
    case .sandbox: return .sandbox
    case .xcode: return .localTesting
    default: return nil
    }
  }

  private static func productType(_ type: Product.ProductType) -> MosaicCommerceProductType? {
    switch type {
    case .autoRenewable: .subscription
    case .nonConsumable: .oneTimeNonConsumable
    default: nil
    }
  }

  /// `nil` for a unit this SDK version does not know. Callers omit the period
  /// rather than substituting one.
  private static func periodUnit(
    _ unit: Product.SubscriptionPeriod.Unit
  ) -> MosaicCommercePeriodUnit? {
    switch unit {
    case .day: .day
    case .week: .week
    case .month: .month
    case .year: .year
    @unknown default: nil
    }
  }

  private static func period(
    _ period: Product.SubscriptionPeriod
  ) -> MosaicCommercePeriod? {
    periodUnit(period.unit).map { MosaicCommercePeriod(unit: $0, value: period.value) }
  }

  private static func isSupportedIntroductoryMode(
    _ mode: Product.SubscriptionOffer.PaymentMode?
  ) -> Bool {
    mode == .payAsYouGo || mode == .payUpFront
  }

  private static func trial(
    _ offer: Product.SubscriptionOffer
  ) -> MosaicCommerceTrial? {
    guard offer.paymentMode == .freeTrial, let period = period(offer.period) else { return nil }
    return MosaicCommerceTrial(period: period, eligibility: .unknown)
  }

  private static func introductoryOffer(
    _ offer: Product.SubscriptionOffer
  ) -> MosaicCommerceIntroductoryOffer? {
    let mode: MosaicCommerceIntroductoryPaymentMode
    switch offer.paymentMode {
    case .payAsYouGo: mode = .payAsYouGo
    case .payUpFront: mode = .payUpFront
    default: return nil
    }
    guard let period = period(offer.period) else { return nil }
    return MosaicCommerceIntroductoryOffer(
      localizedPrice: offer.displayPrice,
      period: period,
      cycles: offer.periodCount,
      paymentMode: mode,
      eligibility: .unknown
    )
  }
}

enum StoreKitClientError: Error {
  case missingProduct
  case missingTransaction
  case unknownPurchaseResult
}

/// Classification of a StoreKit error into the outcomes Mosaic normalizes.
///
/// The adapter previously flattened everything except cancellation into one
/// non-retryable code, so a network outage and an invalid offer signature were
/// indistinguishable and neither was retried. This mirrors the RevenueCat
/// adapter's classification so the two adapters normalize the same way.
///
/// There is no `alreadyEntitled` arm: StoreKit 2 does not report re-purchase of
/// an owned product as an error, it returns a verified transaction, which the
/// purchase path already handles.
struct StoreKitFailure: Sendable, Equatable {
  enum Kind: Sendable, Equatable {
    case cancelled
    case pending
    case productUnavailable
    case providerUnavailable
    case failed
  }

  let kind: Kind
  let providerCode: String

  /// Only transport and system failures are worth retrying. An invalid offer or
  /// a disallowed purchase will fail again identically.
  var retryable: Bool { kind == .providerUnavailable }

  init(_ error: any Error) {
    (kind, providerCode) = Self.classify(error)
  }

  private static func classify(_ error: any Error) -> (Kind, String) {
    if error is CancellationError { return (.cancelled, "purchase_cancelled") }
    if let clientError = error as? StoreKitClientError {
      switch clientError {
      case .missingProduct: return (.productUnavailable, "product_not_loaded")
      case .missingTransaction: return (.failed, "transaction_not_retained")
      case .unknownPurchaseResult: return (.failed, "unknown_purchase_result")
      }
    }
    if let purchaseError = error as? Product.PurchaseError {
      switch purchaseError {
      case .productUnavailable: return (.productUnavailable, "product_unavailable")
      case .purchaseNotAllowed: return (.failed, "purchase_not_allowed")
      case .ineligibleForOffer: return (.failed, "ineligible_for_offer")
      case .invalidOfferIdentifier: return (.failed, "invalid_offer_identifier")
      case .invalidOfferPrice: return (.failed, "invalid_offer_price")
      case .invalidOfferSignature: return (.failed, "invalid_offer_signature")
      case .missingOfferParameters: return (.failed, "missing_offer_parameters")
      // Newer SDK cases are matched by name where available and otherwise fall
      // through to a named-but-unclassified failure rather than a wrong one.
      default: return (.failed, "unknown_purchase_error")
      }
    }
    if let storeKitError = error as? StoreKitError {
      switch storeKitError {
      case .userCancelled: return (.cancelled, "purchase_cancelled")
      case .networkError: return (.providerUnavailable, "network_error")
      case .systemError: return (.providerUnavailable, "system_error")
      case .notAvailableInStorefront:
        return (.productUnavailable, "not_available_in_storefront")
      case .notEntitled: return (.failed, "not_entitled")
      case .unsupported: return (.failed, "unsupported")
      case .unknown: return (.failed, "unknown_error")
      @unknown default: return (.failed, "unknown_storekit_error")
      }
    }
    if error is URLError { return (.providerUnavailable, "network_error") }
    return (.failed, "storekit_error")
  }
}
