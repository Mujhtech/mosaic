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
      let period = product.subscription.map {
        MosaicCommercePeriod(
          unit: Self.periodUnit($0.subscriptionPeriod.unit),
          value: $0.subscriptionPeriod.value
        )
      }
      let offer = product.subscription?.introductoryOffer
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
          trial: offer.flatMap(Self.trial),
          introductoryOffer: offer.flatMap(Self.introductoryOffer)
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

  private static func periodUnit(
    _ unit: Product.SubscriptionPeriod.Unit
  ) -> MosaicCommercePeriodUnit {
    switch unit {
    case .day: .day
    case .week: .week
    case .month: .month
    case .year: .year
    @unknown default: .day
    }
  }

  private static func trial(
    _ offer: Product.SubscriptionOffer
  ) -> MosaicCommerceTrial? {
    guard offer.paymentMode == .freeTrial else { return nil }
    return MosaicCommerceTrial(
      period: .init(
        unit: periodUnit(offer.period.unit),
        value: offer.period.value
      ),
      eligibility: .unknown
    )
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
    return MosaicCommerceIntroductoryOffer(
      localizedPrice: offer.displayPrice,
      period: .init(unit: periodUnit(offer.period.unit), value: offer.period.value),
      cycles: offer.periodCount,
      paymentMode: mode,
      eligibility: .unknown
    )
  }
}

private enum StoreKitClientError: Error {
  case missingProduct
  case missingTransaction
  case unknownPurchaseResult
}
