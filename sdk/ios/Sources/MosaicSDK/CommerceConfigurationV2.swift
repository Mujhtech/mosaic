import Foundation

enum MosaicCommerceConfigurationV2Decoder {
  static func decode(
    _ root: [String: Any],
    association: MosaicCommerceConfigurationAssociation
  ) throws -> MosaicCommerceConfiguration {
    let raw = try CommerceValue.object(root["configuration"], path: "$.configuration")
    let path = "$.configuration"
    try CommerceValue.exactKeys(
      raw,
      required: [
        "id", "environmentId", "applicationId", "storePlatform",
        "configurationRelease", "contentDigest", "activeProvider", "productMappings",
        "entitlementMappings", "freshness", "diagnostics",
      ],
      path: path
    )

    let contentDigest = try CommerceValue.digest(
      raw["contentDigest"],
      path: "\(path).contentDigest"
    )
    var material = raw
    material.removeValue(forKey: "contentDigest")
    guard contentDigest == (try DeliveryCanonicalJSON.digest(material)) else {
      throw invalid("commerce_configuration_digest_mismatch")
    }

    let environmentID = try CommerceValue.identifier(
      raw["environmentId"], path: "\(path).environmentId"
    )
    let applicationID = try CommerceValue.identifier(
      raw["applicationId"], path: "\(path).applicationId"
    )
    guard
      let platform = MosaicCommerceStorePlatform(
        rawValue: try CommerceValue.string(raw["storePlatform"], path: "\(path).storePlatform")
      )
    else {
      throw CommerceValue.shape("\(path).storePlatform", "unsupported_value")
    }
    let release = try CommerceValue.object(
      raw["configurationRelease"], path: "\(path).configurationRelease"
    )
    try CommerceValue.exactKeys(
      release,
      required: ["id", "contentDigest"],
      path: "\(path).configurationRelease"
    )
    let releaseID = try CommerceValue.identifier(
      release["id"], path: "\(path).configurationRelease.id"
    )
    let releaseDigest = try CommerceValue.digest(
      release["contentDigest"], path: "\(path).configurationRelease.contentDigest"
    )
    guard environmentID == association.environmentID,
      applicationID == association.applicationID,
      platform == association.storePlatform,
      releaseID == association.configurationReleaseID,
      releaseDigest == association.configurationReleaseDigest
    else {
      throw invalid("commerce_configuration_association_mismatch")
    }

    let activeProvider = try decodeActiveProvider(
      raw["activeProvider"], platform: platform, path: "\(path).activeProvider"
    )
    let productMappings = try decodeProductMappings(
      raw["productMappings"], providerID: activeProvider.identity.id,
      path: "\(path).productMappings"
    )
    let entitlementMappings = try decodeEntitlementMappings(
      raw["entitlementMappings"], path: "\(path).entitlementMappings"
    )
    let freshness = try decodeFreshness(
      raw["freshness"], activation: activeProvider.activation, path: "\(path).freshness"
    )
    let diagnostics = try decodeDiagnostics(raw["diagnostics"], path: "\(path).diagnostics")
    guard Set(productMappings.map(\.mosaicProductID)) == Set(association.mosaicProductIDs) else {
      throw invalid("commerce_configuration_product_association_mismatch")
    }
    guard association.mosaicProductTypes.count == association.mosaicProductIDs.count,
      productMappings.allSatisfy({
        association.mosaicProductTypes[$0.mosaicProductID] == $0.productType
      })
    else {
      throw invalid("commerce_configuration_product_type_association_mismatch")
    }

    return MosaicCommerceConfiguration(
      version: "2",
      id: try CommerceValue.identifier(raw["id"], path: "\(path).id"),
      environmentID: environmentID,
      applicationID: applicationID,
      storePlatform: platform,
      configurationReleaseID: releaseID,
      configurationReleaseDigest: releaseDigest,
      contentDigest: contentDigest,
      activeProvider: activeProvider,
      productMappings: productMappings,
      entitlementMappings: entitlementMappings,
      freshness: freshness,
      diagnostics: diagnostics
    )
  }

  private static func decodeActiveProvider(
    _ value: Any?,
    platform: MosaicCommerceStorePlatform,
    path: String
  ) throws -> MosaicCommerceActiveProvider {
    let object = try CommerceValue.object(value, path: path)
    try CommerceValue.exactKeys(
      object,
      required: ["identity", "activation", "capabilities", "recoveryMode"],
      path: path
    )
    let identityObject = try CommerceValue.object(object["identity"], path: "\(path).identity")
    try CommerceValue.exactKeys(
      identityObject,
      required: ["id", "displayName", "adapterVersion"],
      path: "\(path).identity"
    )
    let identity = MosaicCommerceProviderIdentity(
      id: try CommerceValue.identifier(identityObject["id"], path: "\(path).identity.id"),
      displayName: try CommerceValue.safeString(
        identityObject["displayName"], length: 1...240, path: "\(path).identity.displayName"
      ),
      adapterVersion: try CommerceValue.patternString(
        identityObject["adapterVersion"], length: 1...64,
        pattern: "^[A-Za-z0-9][A-Za-z0-9.+_-]*$",
        path: "\(path).identity.adapterVersion"
      )
    )
    let activationObject = try CommerceValue.object(
      object["activation"], path: "\(path).activation"
    )
    let source = try CommerceValue.string(
      activationObject["source"], path: "\(path).activation.source"
    )
    let activation: MosaicCommerceProviderActivation
    switch source {
    case "providerConnection":
      try CommerceValue.exactKeys(
        activationObject, required: ["source", "providerConnectionId"],
        path: "\(path).activation"
      )
      activation = .providerConnection(
        id: try CommerceValue.identifier(
          activationObject["providerConnectionId"],
          path: "\(path).activation.providerConnectionId"
        )
      )
    case "sdkLocal":
      try CommerceValue.exactKeys(
        activationObject, required: ["source", "localSnapshotId"], path: "\(path).activation"
      )
      activation = .sdkLocal(
        snapshotID: try CommerceValue.identifier(
          activationObject["localSnapshotId"],
          path: "\(path).activation.localSnapshotId"
        )
      )
    case "nativeStore":
      try CommerceValue.exactKeys(
        activationObject, required: ["source"], path: "\(path).activation"
      )
      guard (platform == .ios && identity.id == "app_store")
        || (platform == .android && identity.id == "google_play")
      else {
        throw invalid("commerce_configuration_native_provider_platform_mismatch")
      }
      activation = .nativeStore
    default:
      throw CommerceValue.shape("\(path).activation.source", "unsupported_value")
    }

    let capabilityValues = try CommerceValue.array(
      object["capabilities"], count: 1...19, path: "\(path).capabilities"
    )
    var names = Set<MosaicCommerceCapabilityName>()
    let capabilities = try capabilityValues.enumerated().map { index, value in
      let itemPath = "\(path).capabilities[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item, required: ["name", "support"], optional: ["reasonCode"], path: itemPath
      )
      guard
        let name = MosaicCommerceCapabilityName(
          rawValue: try CommerceValue.string(item["name"], path: "\(itemPath).name")
        ),
        let support = MosaicCommerceCapabilitySupport(
          rawValue: try CommerceValue.string(item["support"], path: "\(itemPath).support")
        ),
        names.insert(name).inserted
      else {
        throw CommerceValue.shape(itemPath, "unsupported_or_duplicate_value")
      }
      let reason = try item["reasonCode"].map {
        try CommerceValue.reasonCode($0, path: "\(itemPath).reasonCode")
      }
      guard (support == .supported && reason == nil)
        || (support != .supported && reason != nil)
      else {
        throw invalid("commerce_configuration_capability_reason_invalid")
      }
      return MosaicCommerceCapability(name: name, support: support, reasonCode: reason)
    }
    guard
      let recoveryMode = MosaicCommerceRecoveryMode(
        rawValue: try CommerceValue.string(
          object["recoveryMode"], path: "\(path).recoveryMode"
        )
      )
    else {
      throw CommerceValue.shape("\(path).recoveryMode", "unsupported_value")
    }
    if case .nativeStore = activation {
      let expectedRecovery: MosaicCommerceRecoveryMode =
        platform == .ios ? .storeSynchronization : .activePurchaseRecovery
      guard recoveryMode == expectedRecovery else {
        throw invalid("commerce_configuration_native_recovery_mode_mismatch")
      }
      let expected = nativeCapabilityMatrix(providerID: identity.id)
      guard capabilities.count == MosaicCommerceCapabilityName.allCases.count,
        expected.count == MosaicCommerceCapabilityName.allCases.count,
        capabilities.allSatisfy({
          expected[$0.name] == NativeCapabilityExpectation(
            support: $0.support,
            reasonCode: $0.reasonCode
          )
        })
      else {
        throw invalid("commerce_configuration_native_capability_matrix_mismatch")
      }
    }
    return MosaicCommerceActiveProvider(
      identity: identity,
      activation: activation,
      capabilities: capabilities,
      recoveryMode: recoveryMode
    )
  }

  private static func decodeProductMappings(
    _ value: Any?,
    providerID: String,
    path: String
  ) throws -> [MosaicCommerceProductMapping] {
    let values = try CommerceValue.array(value, count: 1...256, path: path)
    var productIDs = Set<String>()
    var mappingIDs = Set<String>()
    var providerProductReferences = Set<String>()
    var providerTargets = Set<String>()
    return try values.enumerated().map { index, value in
      let itemPath = "\(path)[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item,
        required: [
          "mosaicProductId", "mappingId", "productType", "entitlementKeys",
          "providerProductReference", "adapterMapping",
        ],
        path: itemPath
      )
      let productID = try CommerceValue.identifier(
        item["mosaicProductId"], path: "\(itemPath).mosaicProductId"
      )
      let mappingID = try CommerceValue.identifier(
        item["mappingId"], path: "\(itemPath).mappingId"
      )
      guard productIDs.insert(productID).inserted, mappingIDs.insert(mappingID).inserted else {
        throw invalid("commerce_configuration_duplicate_product_mapping")
      }
      guard
        let productType = MosaicCommerceProductType(
          rawValue: try CommerceValue.string(
            item["productType"], path: "\(itemPath).productType"
          )
        )
      else {
        throw CommerceValue.shape("\(itemPath).productType", "unsupported_value")
      }
      let entitlementValues = try CommerceValue.array(
        item["entitlementKeys"], count: 1...32, path: "\(itemPath).entitlementKeys"
      )
      var entitlementSet = Set<String>()
      let entitlementKeys = try entitlementValues.enumerated().map { entitlementIndex, value in
        let key = try CommerceValue.entitlementKey(
          value, path: "\(itemPath).entitlementKeys[\(entitlementIndex)]"
        )
        guard entitlementSet.insert(key).inserted else {
          throw invalid("commerce_configuration_duplicate_product_entitlement")
        }
        return key
      }
      let providerReference = try CommerceValue.opaqueIdentifier(
        item["providerProductReference"], path: "\(itemPath).providerProductReference"
      )
      let adapterObject = try CommerceValue.object(
        item["adapterMapping"], path: "\(itemPath).adapterMapping"
      )
      let kind = try CommerceValue.string(
        adapterObject["kind"], path: "\(itemPath).adapterMapping.kind"
      )
      let adapter: MosaicCommerceAdapterMapping
      switch kind {
      case "directProduct":
        try CommerceValue.exactKeys(adapterObject, required: ["kind"], path: "\(itemPath).adapterMapping")
        adapter = .directProduct
      case "revenueCatPackage":
        try CommerceValue.exactKeys(
          adapterObject,
          required: ["kind", "offeringIdentifier", "packageIdentifier"],
          path: "\(itemPath).adapterMapping"
        )
        adapter = .revenueCatPackage(
          offeringIdentifier: try CommerceValue.opaqueIdentifier(
            adapterObject["offeringIdentifier"],
            path: "\(itemPath).adapterMapping.offeringIdentifier"
          ),
          packageIdentifier: try CommerceValue.opaqueIdentifier(
            adapterObject["packageIdentifier"],
            path: "\(itemPath).adapterMapping.packageIdentifier"
          )
        )
      case "storeKitProduct":
        try CommerceValue.exactKeys(adapterObject, required: ["kind"], path: "\(itemPath).adapterMapping")
        guard providerID == "app_store" else {
          throw invalid("commerce_configuration_storekit_mapping_provider_mismatch")
        }
        adapter = .storeKitProduct
      case "googlePlayProduct":
        try CommerceValue.exactKeys(
          adapterObject, required: ["kind"], optional: ["basePlanId", "offerId"],
          path: "\(itemPath).adapterMapping"
        )
        guard providerID == "google_play" else {
          throw invalid("commerce_configuration_google_mapping_provider_mismatch")
        }
        let basePlanID = try adapterObject["basePlanId"].map {
          try CommerceValue.opaqueIdentifier($0, path: "\(itemPath).adapterMapping.basePlanId")
        }
        let offerID = try adapterObject["offerId"].map {
          try CommerceValue.opaqueIdentifier($0, path: "\(itemPath).adapterMapping.offerId")
        }
        guard productType == .subscription ? basePlanID != nil : basePlanID == nil && offerID == nil
        else {
          throw invalid("commerce_configuration_google_selector_invalid")
        }
        adapter = .googlePlayProduct(basePlanID: basePlanID, offerID: offerID)
      default:
        throw CommerceValue.shape("\(itemPath).adapterMapping.kind", "unsupported_value")
      }
      let targetKey: String =
        switch adapter {
        case .directProduct:
          "\(providerReference):directProduct"
        case .revenueCatPackage(let offering, let package):
          "\(providerReference):revenueCatPackage:\(offering):\(package)"
        case .storeKitProduct:
          "\(providerReference):storeKitProduct"
        case .googlePlayProduct(let basePlan, let offer):
          "\(providerReference):googlePlayProduct:\(basePlan ?? ""):\(offer ?? "")"
        }
      guard providerTargets.insert(targetKey).inserted else {
        throw invalid("commerce_configuration_duplicate_provider_product_target")
      }
      if providerID == "app_store" || providerID == "google_play" {
        guard providerProductReferences.insert(providerReference).inserted else {
          throw invalid("commerce_configuration_duplicate_native_provider_product")
        }
        let nativeMappingMatches =
          providerID == "app_store"
          ? {
            if case .storeKitProduct = adapter { return true }
            return false
          }()
          : {
            if case .googlePlayProduct = adapter { return true }
            return false
          }()
        guard nativeMappingMatches else {
          throw invalid("commerce_configuration_native_mapping_kind_mismatch")
        }
      }
      return MosaicCommerceProductMapping(
        mosaicProductID: productID,
        mappingID: mappingID,
        providerProductReference: providerReference,
        adapterMapping: adapter,
        productType: productType,
        entitlementKeys: entitlementKeys
      )
    }
  }

  private static func decodeEntitlementMappings(
    _ value: Any?,
    path: String
  ) throws -> [MosaicCommerceEntitlementMapping] {
    let values = try CommerceValue.array(value, count: 0...128, path: path)
    var mosaicKeys = Set<String>()
    var providerKeys = Set<String>()
    return try values.enumerated().map { index, value in
      let itemPath = "\(path)[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item,
        required: ["mosaicEntitlementKey", "providerEntitlementIdentifier"],
        path: itemPath
      )
      let mosaicKey = try CommerceValue.entitlementKey(
        item["mosaicEntitlementKey"], path: "\(itemPath).mosaicEntitlementKey"
      )
      let providerKey = try CommerceValue.opaqueIdentifier(
        item["providerEntitlementIdentifier"],
        path: "\(itemPath).providerEntitlementIdentifier"
      )
      guard mosaicKeys.insert(mosaicKey).inserted, providerKeys.insert(providerKey).inserted else {
        throw invalid("commerce_configuration_duplicate_entitlement_mapping")
      }
      return MosaicCommerceEntitlementMapping(
        mosaicEntitlementKey: mosaicKey,
        providerEntitlementIdentifier: providerKey
      )
    }
  }

  private static func decodeFreshness(
    _ value: Any?,
    activation: MosaicCommerceProviderActivation,
    path: String
  ) throws -> MosaicCommerceFreshness {
    let object = try CommerceValue.object(value, path: path)
    let source = try CommerceValue.string(object["source"], path: "\(path).source")
    if source == "nativeStoreConfiguration" {
      try CommerceValue.exactKeys(
        object, required: ["source", "status", "configuredAt"],
        optional: ["observation"], path: path
      )
      guard case .nativeStore = activation else {
        throw invalid("commerce_configuration_freshness_source_mismatch")
      }
      let statusSource = try CommerceValue.string(object["status"], path: "\(path).status")
      guard let status = MosaicCommerceFreshnessStatus(rawValue: statusSource) else {
        throw CommerceValue.shape("\(path).status", "unsupported_value")
      }
      let configuredAt = try CommerceValue.timestamp(
        object["configuredAt"], path: "\(path).configuredAt"
      )
      var observedAt = configuredAt
      var expiresAt: String?
      if let observationValue = object["observation"] {
        let observation = try CommerceValue.object(
          observationValue, path: "\(path).observation"
        )
        try CommerceValue.exactKeys(
          observation, required: ["environment", "observedAt"],
          optional: ["expiresAt"], path: "\(path).observation"
        )
        let environment = try CommerceValue.string(
          observation["environment"], path: "\(path).observation.environment"
        )
        guard ["test", "production", "unknown"].contains(environment) else {
          throw CommerceValue.shape("\(path).observation.environment", "unsupported_value")
        }
        observedAt = try CommerceValue.timestamp(
          observation["observedAt"], path: "\(path).observation.observedAt"
        )
        expiresAt = try observation["expiresAt"].map {
          try CommerceValue.timestamp($0, path: "\(path).observation.expiresAt")
        }
      }
      guard (status == .configured) == (object["observation"] == nil) else {
        throw invalid("commerce_configuration_native_freshness_observation_invalid")
      }
      if let expiresAt {
        guard let observed = Self.date(observedAt), let expires = Self.date(expiresAt),
          expires >= observed
        else {
          throw invalid("commerce_configuration_native_freshness_order_invalid")
        }
      }
      return MosaicCommerceFreshness(
        source: .nativeStoreConfiguration,
        status: status,
        providerObservedAt: observedAt,
        synchronizedAt: configuredAt,
        staleAt: expiresAt ?? configuredAt,
        expiresAt: expiresAt
      )
    }
    try CommerceValue.exactKeys(
      object,
      required: ["source", "status", "providerObservedAt", "synchronizedAt", "staleAt"],
      optional: ["expiresAt"], path: path
    )
    guard let freshnessSource = MosaicCommerceFreshnessSource(rawValue: source),
      let status = MosaicCommerceFreshnessStatus(
        rawValue: try CommerceValue.string(object["status"], path: "\(path).status")
      )
    else {
      throw CommerceValue.shape(path, "unsupported_value")
    }
    let expected: MosaicCommerceFreshnessSource =
      switch activation {
      case .providerConnection: .providerSynchronization
      case .sdkLocal: .sdkLocalSnapshot
      case .nativeStore: .nativeStoreConfiguration
      }
    guard freshnessSource == expected else {
      throw invalid("commerce_configuration_freshness_source_mismatch")
    }
    return MosaicCommerceFreshness(
      source: freshnessSource,
      status: status,
      providerObservedAt: try CommerceValue.timestamp(
        object["providerObservedAt"], path: "\(path).providerObservedAt"
      ),
      synchronizedAt: try CommerceValue.timestamp(
        object["synchronizedAt"], path: "\(path).synchronizedAt"
      ),
      staleAt: try CommerceValue.timestamp(object["staleAt"], path: "\(path).staleAt"),
      expiresAt: try object["expiresAt"].map {
        try CommerceValue.timestamp($0, path: "\(path).expiresAt")
      }
    )
  }

  private struct NativeCapabilityExpectation: Equatable {
    let support: MosaicCommerceCapabilitySupport
    let reasonCode: String?
  }

  private static func nativeCapabilityMatrix(
    providerID: String
  ) -> [MosaicCommerceCapabilityName: NativeCapabilityExpectation] {
    guard providerID == "app_store" else { return [:] }
    return [
      .productLoading: .init(support: .supported, reasonCode: nil),
      .subscriptions: .init(support: .supported, reasonCode: nil),
      .oneTimeNonConsumables: .init(support: .supported, reasonCode: nil),
      .trials: .init(support: .supported, reasonCode: nil),
      .introductoryOffers: .init(support: .supported, reasonCode: nil),
      .promotionalOffers: .init(
        support: .conditional, reasonCode: "provider.configurationRequired"),
      .restore: .init(support: .supported, reasonCode: nil),
      .activeEntitlementLookup: .init(support: .supported, reasonCode: nil),
      .pendingPurchases: .init(support: .supported, reasonCode: nil),
      .deferredPurchases: .init(
        support: .unsupported, reasonCode: "provider.outcomeUnavailable"),
      .serverConfirmedTransactions: .init(
        support: .unsupported, reasonCode: "provider.serverValidationExcluded"),
      .productSynchronization: .init(
        support: .unsupported, reasonCode: "provider.serverSynchronizationUnavailable"),
      .providerDiagnostics: .init(support: .supported, reasonCode: nil),
      .basePlans: .init(
        support: .unsupported, reasonCode: "provider.capabilityUnavailable"),
      .explicitOffers: .init(
        support: .unsupported, reasonCode: "provider.capabilityUnavailable"),
      .storeSynchronization: .init(support: .supported, reasonCode: nil),
      .activePurchaseRecovery: .init(
        support: .unsupported, reasonCode: "provider.recoveryModeUnavailable"),
      .asynchronousCommerceUpdates: .init(support: .supported, reasonCode: nil),
      .localDeliveryAcceptance: .init(support: .supported, reasonCode: nil),
    ]
  }

  private static func date(_ value: String) -> Date? {
    ISO8601DateFormatter().date(from: value)
  }

  private static func decodeDiagnostics(
    _ value: Any?,
    path: String
  ) throws -> [MosaicCommerceDiagnostic] {
    let values = try CommerceValue.array(value, count: 0...32, path: path)
    return try values.enumerated().map { index, value in
      let itemPath = "\(path)[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item,
        required: ["code", "safeMessage", "severity", "retryable", "correlationId"],
        optional: [
          "retryAfterSeconds", "providerCode", "mosaicProductId", "recoveryAction",
        ],
        path: itemPath
      )
      guard let severity = MosaicCommerceDiagnosticSeverity(
        rawValue: try CommerceValue.string(item["severity"], path: "\(itemPath).severity")
      ) else {
        throw CommerceValue.shape("\(itemPath).severity", "unsupported_value")
      }
      let retryable = try CommerceValue.boolean(item["retryable"], path: "\(itemPath).retryable")
      let retryAfter = try item["retryAfterSeconds"].map {
        try CommerceValue.integer(
          $0, range: 1...86_400, path: "\(itemPath).retryAfterSeconds"
        )
      }
      guard retryable || retryAfter == nil else {
        throw invalid("commerce_configuration_diagnostic_retry_invalid")
      }
      let recovery = try item["recoveryAction"].map {
        guard let action = MosaicCommerceRecoveryAction(
          rawValue: try CommerceValue.string($0, path: "\(itemPath).recoveryAction")
        ) else {
          throw CommerceValue.shape("\(itemPath).recoveryAction", "unsupported_value")
        }
        return action
      }
      return MosaicCommerceDiagnostic(
        code: try CommerceValue.reasonCode(item["code"], path: "\(itemPath).code"),
        safeMessage: try CommerceValue.safeString(
          item["safeMessage"], length: 1...240, path: "\(itemPath).safeMessage"
        ),
        severity: severity,
        retryable: retryable,
        retryAfterSeconds: retryAfter,
        correlationID: try CommerceValue.identifier(
          item["correlationId"], path: "\(itemPath).correlationId"
        ),
        providerCode: try item["providerCode"].map {
          try CommerceValue.safeString($0, length: 1...128, path: "\(itemPath).providerCode")
        },
        mosaicProductID: try item["mosaicProductId"].map {
          try CommerceValue.identifier($0, path: "\(itemPath).mosaicProductId")
        },
        recoveryAction: recovery
      )
    }
  }

  private static func invalid(_ code: String) -> MosaicCommerceConfigurationError {
    .invalidConfiguration(code: code)
  }
}
