@preconcurrency import Flutter
import Foundation
import MosaicSDK
import MosaicStoreKit

public final class MosaicNativeStorePlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let instance = MosaicNativeStorePlugin()
    let channel = FlutterMethodChannel(
      name: "dev.mosaic/native_store/commerce_v1",
      binaryMessenger: registrar.messenger()
    )
    channel.setMethodCallHandler(instance.handle)
    Task { @MainActor in
      await StoreKitProcessBridge.shared.attach(channel)
    }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard let arguments = call.arguments as? [String: Any],
      arguments["codecVersion"] as? Int == 1
    else {
      result(FlutterError(
        code: "codec_version",
        message: "Unsupported Mosaic channel codec.",
        details: nil
      ))
      return
    }
    Task { @MainActor in
      do {
        let bridge = StoreKitProcessBridge.shared
        let value: Any?
        switch call.method {
        case "profile":
          value = try await bridge.profile()
        case "activate":
          value = try await bridge.activate(arguments)
        case "loadProducts":
          value = try await bridge.loadProducts(arguments)
        case "purchase":
          value = try await bridge.purchase(arguments)
        case "restore":
          value = try await bridge.restore()
        case "activeEntitlements":
          value = try await bridge.activeEntitlements()
        case "diagnostics":
          value = try await bridge.diagnostics()
        case "invalidate":
          await bridge.invalidate()
          value = nil
        case "close":
          await bridge.close()
          value = nil
        default:
          throw BridgeError.invalidRequest
        }
        result(value)
      } catch {
        result(FlutterError(
          code: "provider_unavailable",
          message: "The Mosaic StoreKit adapter is unavailable.",
          details: nil
        ))
      }
    }
  }
}

@MainActor
private final class StoreKitProcessBridge {
  static let shared = StoreKitProcessBridge()

  private var provider: MosaicStoreKitProvider?
  private var channels: [FlutterMethodChannel] = []
  private var mappings: [MosaicCommerceProductMapping] = []
  private var updateTask: Task<Void, Never>?

  func attach(_ channel: FlutterMethodChannel) async {
    channels.append(channel)
    do {
      _ = try adapter()
      startUpdateDelivery()
    } catch {
      // The Dart surface reports a stable unavailable outcome on first use.
    }
  }

  func activate(_ arguments: [String: Any]) async throws -> [String: Any] {
    guard arguments["providerId"] as? String == "app_store",
      let reference = arguments["configuration"] as? [String: Any],
      let configurationID = reference["configurationId"] as? String,
      let revision = reference["configurationRevision"] as? String,
      let rawMappings = arguments["mappings"] as? [[String: Any]]
    else { throw BridgeError.invalidRequest }
    let decoded = try rawMappings.map(decodeMapping)
    let provider = try adapter()
    await provider.invalidateLoadedProducts()
    try await provider.install(
      configuration: MosaicCommerceConfigurationReference(
        configurationID: configurationID,
        configurationRevision: revision
      ),
      mappings: decoded
    )
    mappings = decoded
    startUpdateDelivery()
    return ["status": "ready"]
  }

  func profile() throws -> [String: Any] {
    let provider = try adapter()
    return [
      "provider": [
        "id": provider.identity.id,
        "displayName": provider.identity.displayName,
        "adapterVersion": provider.identity.adapterVersion,
      ],
      "capabilities": provider.capabilities.map { capability in
        var value: [String: Any] = [
          "name": capability.name.rawValue,
          "support": capability.support.rawValue,
        ]
        value["reasonCode"] = capability.reasonCode
        return value.compactMapValues { $0 }
      },
      "recoveryMode": "storeSynchronization",
    ]
  }

  func loadProducts(_ arguments: [String: Any]) async throws -> [String: Any] {
    guard let productIDs = arguments["productIds"] as? [String] else {
      throw BridgeError.invalidRequest
    }
    let selected = try productIDs.map { productID in
      guard let mapping = mappings.first(where: { $0.mosaicProductID == productID }) else {
        throw BridgeError.invalidRequest
      }
      return mapping
    }
    let resolved = await adapter().loadProducts(mappings: selected)
    return [
      "products": resolved.map { item in
        guard item.availability.status == .available, let product = item.product,
          let mapping = selected.first(where: { $0.mosaicProductID == item.mosaicProductID })
        else {
          return [
            "mosaicProductId": item.mosaicProductID,
            "availability": item.availability.status.rawValue,
          ]
        }
        return encodeProduct(mapping: mapping, product: product)
      }
    ]
  }

  func purchase(_ arguments: [String: Any]) async throws -> [String: Any] {
    guard let productID = arguments["mosaicProductId"] as? String else {
      throw BridgeError.invalidRequest
    }
    return encodePurchase(await adapter().purchase(mosaicProductID: productID))
  }

  func restore() async throws -> [String: Any] {
    encodeRecovery(await adapter().recover(entitlementMappings: []))
  }

  func activeEntitlements() async throws -> [String: Any] {
    encodeEntitlements(await adapter().activeEntitlements(entitlementMappings: []))
  }

  func diagnostics() async throws -> [String: Any] {
    let value = await adapter().providerDiagnostics()
    return [
      "providerId": value.providerID,
      "health": value.health.rawValue,
      "diagnostics": value.diagnostics.map(encodeDiagnostic),
    ]
  }

  func invalidate() async {
    await provider?.invalidateLoadedProducts()
    mappings = []
  }

  func close() async {
    updateTask?.cancel()
    updateTask = nil
    await provider?.invalidateLoadedProducts()
    provider = nil
    mappings = []
  }

  func accept(
    _ update: MosaicCommerceUpdate
  ) async -> MosaicCommerceUpdateAcceptanceDisposition {
    guard let channel = channels.last else { return .deliveryFailed }
    return await withCheckedContinuation { continuation in
      channel.invokeMethod("commerceUpdate", arguments: encodeUpdate(update)) { response in
        let disposition = (response as? String)
          .flatMap(MosaicCommerceUpdateAcceptanceDisposition.init(rawValue:))
          ?? .deliveryFailed
        continuation.resume(returning: disposition)
      }
    }
  }

  private func adapter() throws -> MosaicStoreKitProvider {
    if let provider { return provider }
    let created = try MosaicStoreKitProvider(
      acceptor: FlutterCommerceUpdateAcceptor()
    )
    provider = created
    return created
  }

  private func startUpdateDelivery() {
    guard updateTask == nil, let provider else { return }
    updateTask = Task { [weak self] in
      let updates = await provider.commerceUpdates
      for await update in updates {
        guard !Task.isCancelled, let self, let channel = self.channels.last else {
          return
        }
        channel.invokeMethod("commerceUpdateReplay", arguments: encodeUpdate(update))
      }
    }
  }
}

private final class FlutterCommerceUpdateAcceptor:
  MosaicCommerceUpdateAcceptor, @unchecked Sendable
{
  func accept(
    _ update: MosaicCommerceUpdate
  ) async throws -> MosaicCommerceUpdateAcceptanceDisposition {
    await StoreKitProcessBridge.shared.accept(update)
  }
}

private func decodeMapping(_ value: [String: Any]) throws
  -> MosaicCommerceProductMapping
{
  guard let productID = value["mosaicProductId"] as? String,
    let mappingID = value["mappingId"] as? String,
    let reference = value["providerProductReference"] as? String,
    let productTypeValue = value["productType"] as? String,
    let productType = MosaicCommerceProductType(rawValue: productTypeValue),
    let grants = value["entitlementKeys"] as? [String],
    let adapter = value["adapterMapping"] as? [String: Any],
    adapter["kind"] as? String == "storeKitProduct"
  else { throw BridgeError.invalidRequest }
  return MosaicCommerceProductMapping(
    mosaicProductID: productID,
    mappingID: mappingID,
    providerProductReference: reference,
    adapterMapping: .storeKitProduct,
    productType: productType,
    entitlementKeys: grants
  )
}

private func encodeProduct(
  mapping: MosaicCommerceProductMapping,
  product: MosaicProduct
) -> [String: Any] {
  var metadata: [String: Any] = [
    "localizedDisplayName": product.title,
    "localizedPrice": product.localizedPrice,
  ]
  metadata["localizedPeriod"] = product.localizedSubscriptionPeriod
  metadata["currencyCode"] = product.currencyCode
  metadata["billingPeriod"] = product.billingPeriod.map(encodePeriod)
  metadata["trial"] = product.trial.map(encodeTrial)
  metadata["introductoryOffer"] = product.introductoryOffer.map(encodeIntroductoryOffer)
  return [
    "mosaicProductId": mapping.mosaicProductID,
    "productType": mapping.productType?.rawValue as Any,
    "entitlementKeys": mapping.entitlementKeys,
    "availability": "available",
    "metadata": metadata.compactMapValues { $0 },
  ]
}

private func encodePeriod(_ value: MosaicCommercePeriod) -> [String: Any] {
  ["unit": value.unit.rawValue, "value": value.value]
}

private func encodeTrial(_ value: MosaicCommerceTrial) -> [String: Any] {
  var result: [String: Any] = ["period": encodePeriod(value.period)]
  result["eligibility"] = value.eligibility?.rawValue
  return result.compactMapValues { $0 }
}

private func encodeIntroductoryOffer(
  _ value: MosaicCommerceIntroductoryOffer
) -> [String: Any] {
  var result: [String: Any] = [
    "localizedPrice": value.localizedPrice,
    "period": encodePeriod(value.period),
    "cycles": value.cycles,
    "paymentMode": value.paymentMode.rawValue,
  ]
  result["eligibility"] = value.eligibility?.rawValue
  return result.compactMapValues { $0 }
}

private func encodePurchase(_ value: MosaicPurchaseResult) -> [String: Any] {
  switch value {
  case .purchased(_, let transaction):
    return ["outcome": "purchased", "transactionReference": transaction as Any]
  case .pending:
    return ["outcome": "pending"]
  case .deferred:
    return ["outcome": "deferred"]
  case .alreadyEntitled:
    return ["outcome": "alreadyEntitled"]
  case .cancelled:
    return ["outcome": "cancelled"]
  case .productUnavailable:
    return ["outcome": "productUnavailable"]
  case .providerUnavailable(_, _, let diagnostic):
    return ["outcome": "providerUnavailable", "diagnostics": [encodeDiagnostic(diagnostic)]]
  case .failed(_, _, let diagnostic):
    return ["outcome": "failed", "diagnostics": [encodeDiagnostic(diagnostic)]]
  }
}

private func encodeRestore(_ value: MosaicRestoreResult) -> [String: Any] {
  switch value {
  case .restored(let entitlements):
    return [
      "outcome": "restored",
      "activeEntitlementKeys": entitlements.map(\.id),
    ]
  case .nothingToRestore: return ["outcome": "nothingToRestore"]
  case .cancelled: return ["outcome": "cancelled"]
  case .providerUnavailable: return ["outcome": "providerUnavailable"]
  case .failed: return ["outcome": "failed"]
  }
}

private func encodeRecovery(
  _ value: MosaicCommerceRecoveryResult
) -> [String: Any] {
  [
    "outcome": value.outcome.rawValue,
    "activeEntitlementKeys": value.activeEntitlements.map(\.id),
    "operationId": value.operationID,
    "providerId": value.providerID,
    "recoveryMode": value.recoveryMode.rawValue,
    "completedAt": utcFormatter.string(from: value.completedAt),
    "diagnostics": value.diagnostics.map(encodeDiagnostic),
  ]
}

private func encodeEntitlements(
  _ value: MosaicActiveEntitlementsResult
) -> [String: Any] {
  switch value {
  case .available(let entitlements):
    return [
      "outcome": "available",
      "activeEntitlementKeys": entitlements.map(\.id),
    ]
  case .unknown: return ["outcome": "unknown"]
  case .providerUnavailable: return ["outcome": "providerUnavailable"]
  case .failed: return ["outcome": "failed"]
  }
}

private func encodeUpdate(_ value: MosaicCommerceUpdate) -> [String: Any] {
  var result: [String: Any] = [
    "updateId": value.id,
    "providerId": value.providerID,
    "mosaicProductId": value.mosaicProductID,
    "configuration": [
      "configurationId": value.configuration.configurationID,
      "configurationRevision": value.configuration.configurationRevision,
    ],
    "outcome": value.outcome.rawValue,
    "activeEntitlementKeys": Array(value.activeEntitlementKeys),
    "occurredAt": utcFormatter.string(from: value.occurredAt),
    "diagnostics": value.diagnostics.map(encodeDiagnostic),
  ]
  result["operationId"] = value.operationID
  result["transactionReference"] = value.transactionReference
  return result.compactMapValues { $0 }
}

private func encodeDiagnostic(_ value: MosaicCommerceDiagnostic) -> [String: Any] {
  var result: [String: Any] = [
    "code": value.code,
    "safeMessage": value.safeMessage,
    "severity": value.severity.rawValue,
    "retryable": value.retryable,
    "correlationId": value.correlationID,
  ]
  result["retryAfterSeconds"] = value.retryAfterSeconds
  result["providerCode"] = value.providerCode
  result["mosaicProductId"] = value.mosaicProductID
  result["recoveryAction"] = value.recoveryAction?.rawValue
  return result.compactMapValues { $0 }
}

private let utcFormatter: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  return formatter
}()

private enum BridgeError: Error {
  case invalidRequest
}
