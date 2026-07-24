import Foundation

public enum MosaicCommerceStorePlatform: String, Codable, Sendable, Equatable {
  case ios
  case android
}

public struct MosaicCommerceConfigurationAssociation: Codable, Sendable, Equatable {
  public let environmentID: String
  public let applicationID: String
  public let storePlatform: MosaicCommerceStorePlatform
  public let configurationReleaseID: String
  public let configurationReleaseDigest: String
  public let mosaicProductIDs: [String]
  public let mosaicProductTypes: [String: MosaicCommerceProductType]

  public init(
    environmentID: String,
    applicationID: String,
    storePlatform: MosaicCommerceStorePlatform,
    configurationReleaseID: String,
    configurationReleaseDigest: String,
    mosaicProductIDs: [String],
    mosaicProductTypes: [String: MosaicCommerceProductType] = [:]
  ) {
    self.environmentID = environmentID
    self.applicationID = applicationID
    self.storePlatform = storePlatform
    self.configurationReleaseID = configurationReleaseID
    self.configurationReleaseDigest = configurationReleaseDigest
    self.mosaicProductIDs = mosaicProductIDs
    self.mosaicProductTypes = mosaicProductTypes
  }
}

public enum MosaicCommerceProviderActivation: Sendable, Equatable {
  case providerConnection(id: String)
  case sdkLocal(snapshotID: String)
  case nativeStore
}

public enum MosaicCommerceAdapterMapping: Sendable, Equatable {
  case directProduct
  case revenueCatPackage(offeringIdentifier: String, packageIdentifier: String)
  case storeKitProduct
  case googlePlayProduct(basePlanID: String?, offerID: String?)
}

public enum MosaicCommerceProductType: String, Sendable, Equatable {
  case subscription
  case oneTimeNonConsumable = "one_time_non_consumable"
}

public enum MosaicCommerceRecoveryMode: String, Sendable, Equatable {
  case providerDefined
  case storeSynchronization
  case activePurchaseRecovery
}

public struct MosaicCommerceProductMapping: Sendable, Equatable {
  public let mosaicProductID: String
  public let mappingID: String
  public let providerProductReference: String
  public let adapterMapping: MosaicCommerceAdapterMapping
  public let productType: MosaicCommerceProductType?
  public let entitlementKeys: [String]

  public init(
    mosaicProductID: String,
    mappingID: String,
    providerProductReference: String,
    adapterMapping: MosaicCommerceAdapterMapping,
    productType: MosaicCommerceProductType? = nil,
    entitlementKeys: [String] = []
  ) {
    self.mosaicProductID = mosaicProductID
    self.mappingID = mappingID
    self.providerProductReference = providerProductReference
    self.adapterMapping = adapterMapping
    self.productType = productType
    self.entitlementKeys = entitlementKeys
  }
}

public struct MosaicCommerceEntitlementMapping: Sendable, Equatable {
  public let mosaicEntitlementKey: String
  public let providerEntitlementIdentifier: String

  public init(mosaicEntitlementKey: String, providerEntitlementIdentifier: String) {
    self.mosaicEntitlementKey = mosaicEntitlementKey
    self.providerEntitlementIdentifier = providerEntitlementIdentifier
  }
}

public enum MosaicCommerceFreshnessSource: String, Sendable, Equatable {
  case providerSynchronization
  case sdkLocalSnapshot
  case nativeStoreConfiguration
}

public enum MosaicCommerceFreshnessStatus: String, Sendable, Equatable {
  case fresh
  case stale
  case configured
}

public struct MosaicCommerceFreshness: Sendable, Equatable {
  public let source: MosaicCommerceFreshnessSource
  public let status: MosaicCommerceFreshnessStatus
  public let providerObservedAt: String
  public let synchronizedAt: String
  public let staleAt: String
  public let expiresAt: String?
}

public struct MosaicCommerceActiveProvider: Sendable, Equatable {
  public let identity: MosaicCommerceProviderIdentity
  public let activation: MosaicCommerceProviderActivation
  public let capabilities: [MosaicCommerceCapability]
  public let recoveryMode: MosaicCommerceRecoveryMode
}

public struct MosaicCommerceConfiguration: Sendable, Equatable {
  public let version: String
  public let id: String
  public let environmentID: String
  public let applicationID: String
  public let storePlatform: MosaicCommerceStorePlatform
  public let configurationReleaseID: String
  public let configurationReleaseDigest: String
  public let contentDigest: String
  public let activeProvider: MosaicCommerceActiveProvider
  public let productMappings: [MosaicCommerceProductMapping]
  public let entitlementMappings: [MosaicCommerceEntitlementMapping]
  public let freshness: MosaicCommerceFreshness
  public let diagnostics: [MosaicCommerceDiagnostic]
}

public enum MosaicCommerceConfigurationError: Error, Sendable, Equatable {
  case invalidJSON
  case invalidShape(path: String, reason: String)
  case unsupportedVersion(String)
  case invalidConfiguration(code: String)

  public var diagnosticCode: String {
    switch self {
    case .invalidJSON: "commerce_configuration_invalid_json"
    case .invalidShape: "commerce_configuration_invalid_shape"
    case .unsupportedVersion: "commerce_configuration_unsupported_version"
    case .invalidConfiguration(let code): code
    }
  }
}

public enum MosaicCommerceConfigurationDecoder {
  public static func decode(
    _ data: Data,
    association: MosaicCommerceConfigurationAssociation
  ) throws -> MosaicCommerceConfiguration {
    let raw: Any
    do {
      raw = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw MosaicCommerceConfigurationError.invalidJSON
    }
    let root = try CommerceValue.object(raw, path: "$")
    try CommerceValue.exactKeys(
      root,
      required: ["commerceConfigurationVersion", "configuration"],
      path: "$"
    )
    let version = try CommerceValue.string(
      root["commerceConfigurationVersion"],
      path: "$.commerceConfigurationVersion"
    )
    if version == "2" {
      return try MosaicCommerceConfigurationV2Decoder.decode(
        root,
        association: association
      )
    }
    guard version == mosaicCommerceConfigurationVersion else {
      throw MosaicCommerceConfigurationError.unsupportedVersion(version)
    }
    let configuration = try CommerceValue.object(
      root["configuration"],
      path: "$.configuration"
    )
    return try decodeConfiguration(configuration, association: association)
  }

  private static func decodeConfiguration(
    _ raw: [String: Any],
    association: MosaicCommerceConfigurationAssociation
  ) throws -> MosaicCommerceConfiguration {
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
      raw["environmentId"],
      path: "\(path).environmentId"
    )
    let applicationID = try CommerceValue.identifier(
      raw["applicationId"],
      path: "\(path).applicationId"
    )
    let platformSource = try CommerceValue.string(
      raw["storePlatform"],
      path: "\(path).storePlatform"
    )
    guard let platform = MosaicCommerceStorePlatform(rawValue: platformSource) else {
      throw CommerceValue.shape("\(path).storePlatform", "unsupported_value")
    }

    let release = try CommerceValue.object(
      raw["configurationRelease"],
      path: "\(path).configurationRelease"
    )
    try CommerceValue.exactKeys(
      release,
      required: ["id", "contentDigest"],
      path: "\(path).configurationRelease"
    )
    let releaseID = try CommerceValue.identifier(
      release["id"],
      path: "\(path).configurationRelease.id"
    )
    let releaseDigest = try CommerceValue.digest(
      release["contentDigest"],
      path: "\(path).configurationRelease.contentDigest"
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
      raw["activeProvider"],
      path: "\(path).activeProvider"
    )
    let productMappings = try decodeProductMappings(
      raw["productMappings"],
      path: "\(path).productMappings"
    )
    let entitlementMappings = try decodeEntitlementMappings(
      raw["entitlementMappings"],
      path: "\(path).entitlementMappings"
    )
    let freshness = try decodeFreshness(raw["freshness"], path: "\(path).freshness")
    let diagnostics = try decodeDiagnostics(
      raw["diagnostics"],
      count: 0...32,
      path: "\(path).diagnostics"
    )

    let actualProducts = Set(productMappings.map(\.mosaicProductID))
    guard actualProducts == Set(association.mosaicProductIDs) else {
      throw invalid("commerce_configuration_product_association_mismatch")
    }
    if productMappings.contains(where: {
      if case .revenueCatPackage = $0.adapterMapping { return true }
      return false
    }), activeProvider.identity.id != "revenuecat" {
      throw invalid("commerce_configuration_revenuecat_mapping_provider_mismatch")
    }
    try validateFreshness(freshness, activation: activeProvider.activation)

    return MosaicCommerceConfiguration(
      version: "1",
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

  private static func decodeActiveProvider(_ value: Any?, path: String) throws
    -> MosaicCommerceActiveProvider
  {
    let object = try CommerceValue.object(value, path: path)
    try CommerceValue.exactKeys(
      object,
      required: ["identity", "activation", "capabilities"],
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
        identityObject["displayName"],
        length: 1...240,
        path: "\(path).identity.displayName"
      ),
      adapterVersion: try CommerceValue.patternString(
        identityObject["adapterVersion"],
        length: 1...64,
        pattern: "^[A-Za-z0-9][A-Za-z0-9.+_-]*$",
        path: "\(path).identity.adapterVersion"
      )
    )

    let activationObject = try CommerceValue.object(
      object["activation"],
      path: "\(path).activation"
    )
    let source = try CommerceValue.string(
      activationObject["source"],
      path: "\(path).activation.source"
    )
    let activation: MosaicCommerceProviderActivation
    switch source {
    case "providerConnection":
      try CommerceValue.exactKeys(
        activationObject,
        required: ["source", "providerConnectionId"],
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
        activationObject,
        required: ["source", "localSnapshotId"],
        path: "\(path).activation"
      )
      activation = .sdkLocal(
        snapshotID: try CommerceValue.identifier(
          activationObject["localSnapshotId"],
          path: "\(path).activation.localSnapshotId"
        )
      )
    default:
      throw CommerceValue.shape("\(path).activation.source", "unsupported_value")
    }

    let values = try CommerceValue.array(
      object["capabilities"],
      count: 1...13,
      path: "\(path).capabilities"
    )
    var capabilities: [MosaicCommerceCapability] = []
    var names = Set<MosaicCommerceCapabilityName>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path).capabilities[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item,
        required: ["name", "support"],
        optional: ["reasonCode"],
        path: itemPath
      )
      let nameSource = try CommerceValue.string(item["name"], path: "\(itemPath).name")
      let supportSource = try CommerceValue.string(item["support"], path: "\(itemPath).support")
      guard let name = MosaicCommerceCapabilityName(rawValue: nameSource),
        let support = MosaicCommerceCapabilitySupport(rawValue: supportSource)
      else {
        throw CommerceValue.shape(itemPath, "unsupported_value")
      }
      guard names.insert(name).inserted else {
        throw invalid("commerce_configuration_duplicate_capability")
      }
      let reason = try item["reasonCode"].map {
        try CommerceValue.reasonCode($0, path: "\(itemPath).reasonCode")
      }
      guard
        (support == .supported && reason == nil)
          || (support != .supported && reason != nil)
      else {
        throw invalid("commerce_configuration_capability_reason_invalid")
      }
      capabilities.append(
        MosaicCommerceCapability(name: name, support: support, reasonCode: reason)
      )
    }
    return MosaicCommerceActiveProvider(
      identity: identity,
      activation: activation,
      capabilities: capabilities,
      recoveryMode: .providerDefined
    )
  }

  private static func decodeProductMappings(_ value: Any?, path: String) throws
    -> [MosaicCommerceProductMapping]
  {
    let values = try CommerceValue.array(value, count: 1...256, path: path)
    var result: [MosaicCommerceProductMapping] = []
    var productIDs = Set<String>()
    var mappingIDs = Set<String>()
    var providerTargets = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item,
        required: [
          "mosaicProductId", "mappingId", "providerProductReference", "adapterMapping",
        ],
        path: itemPath
      )
      let productID = try CommerceValue.identifier(
        item["mosaicProductId"],
        path: "\(itemPath).mosaicProductId"
      )
      let mappingID = try CommerceValue.identifier(
        item["mappingId"],
        path: "\(itemPath).mappingId"
      )
      let providerReference = try CommerceValue.opaqueIdentifier(
        item["providerProductReference"],
        path: "\(itemPath).providerProductReference"
      )
      let adapterObject = try CommerceValue.object(
        item["adapterMapping"],
        path: "\(itemPath).adapterMapping"
      )
      let kind = try CommerceValue.string(
        adapterObject["kind"],
        path: "\(itemPath).adapterMapping.kind"
      )
      let adapter: MosaicCommerceAdapterMapping
      let targetKey: String
      switch kind {
      case "directProduct":
        try CommerceValue.exactKeys(
          adapterObject,
          required: ["kind"],
          path: "\(itemPath).adapterMapping"
        )
        adapter = .directProduct
        targetKey = "\(providerReference):{\"kind\":\"directProduct\"}"
      case "revenueCatPackage":
        try CommerceValue.exactKeys(
          adapterObject,
          required: ["kind", "offeringIdentifier", "packageIdentifier"],
          path: "\(itemPath).adapterMapping"
        )
        let offering = try CommerceValue.opaqueIdentifier(
          adapterObject["offeringIdentifier"],
          path: "\(itemPath).adapterMapping.offeringIdentifier"
        )
        let package = try CommerceValue.opaqueIdentifier(
          adapterObject["packageIdentifier"],
          path: "\(itemPath).adapterMapping.packageIdentifier"
        )
        adapter = .revenueCatPackage(
          offeringIdentifier: offering,
          packageIdentifier: package
        )
        targetKey =
          "\(providerReference):{\"kind\":\"revenueCatPackage\",\"offeringIdentifier\":"
          + "\"\(offering)\",\"packageIdentifier\":\"\(package)\"}"
      default:
        throw CommerceValue.shape("\(itemPath).adapterMapping.kind", "unsupported_value")
      }
      guard productIDs.insert(productID).inserted,
        mappingIDs.insert(mappingID).inserted,
        providerTargets.insert(targetKey).inserted
      else {
        throw invalid("commerce_configuration_duplicate_product_mapping")
      }
      result.append(
        MosaicCommerceProductMapping(
          mosaicProductID: productID,
          mappingID: mappingID,
          providerProductReference: providerReference,
          adapterMapping: adapter
        )
      )
    }
    return result
  }

  private static func decodeEntitlementMappings(_ value: Any?, path: String) throws
    -> [MosaicCommerceEntitlementMapping]
  {
    let values = try CommerceValue.array(value, count: 1...128, path: path)
    var result: [MosaicCommerceEntitlementMapping] = []
    var mosaicKeys = Set<String>()
    var providerKeys = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try CommerceValue.object(value, path: itemPath)
      try CommerceValue.exactKeys(
        item,
        required: ["mosaicEntitlementKey", "providerEntitlementIdentifier"],
        path: itemPath
      )
      let mosaicKey = try CommerceValue.entitlementKey(
        item["mosaicEntitlementKey"],
        path: "\(itemPath).mosaicEntitlementKey"
      )
      let providerKey = try CommerceValue.opaqueIdentifier(
        item["providerEntitlementIdentifier"],
        path: "\(itemPath).providerEntitlementIdentifier"
      )
      guard mosaicKeys.insert(mosaicKey).inserted, providerKeys.insert(providerKey).inserted else {
        throw invalid("commerce_configuration_duplicate_entitlement_mapping")
      }
      result.append(
        MosaicCommerceEntitlementMapping(
          mosaicEntitlementKey: mosaicKey,
          providerEntitlementIdentifier: providerKey
        )
      )
    }
    return result
  }

  private static func decodeFreshness(_ value: Any?, path: String) throws
    -> MosaicCommerceFreshness
  {
    let object = try CommerceValue.object(value, path: path)
    try CommerceValue.exactKeys(
      object,
      required: ["source", "status", "providerObservedAt", "synchronizedAt", "staleAt"],
      optional: ["expiresAt"],
      path: path
    )
    let sourceValue = try CommerceValue.string(object["source"], path: "\(path).source")
    let statusValue = try CommerceValue.string(object["status"], path: "\(path).status")
    guard let source = MosaicCommerceFreshnessSource(rawValue: sourceValue),
      let status = MosaicCommerceFreshnessStatus(rawValue: statusValue)
    else {
      throw CommerceValue.shape(path, "unsupported_value")
    }
    return MosaicCommerceFreshness(
      source: source,
      status: status,
      providerObservedAt: try CommerceValue.timestamp(
        object["providerObservedAt"],
        path: "\(path).providerObservedAt"
      ),
      synchronizedAt: try CommerceValue.timestamp(
        object["synchronizedAt"],
        path: "\(path).synchronizedAt"
      ),
      staleAt: try CommerceValue.timestamp(object["staleAt"], path: "\(path).staleAt"),
      expiresAt: try object["expiresAt"].map {
        try CommerceValue.timestamp($0, path: "\(path).expiresAt")
      }
    )
  }

  private static func decodeDiagnostics(
    _ value: Any?,
    count: ClosedRange<Int>,
    path: String
  ) throws -> [MosaicCommerceDiagnostic] {
    let values = try CommerceValue.array(value, count: count, path: path)
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
      let severitySource = try CommerceValue.string(
        item["severity"],
        path: "\(itemPath).severity"
      )
      guard let severity = MosaicCommerceDiagnosticSeverity(rawValue: severitySource) else {
        throw CommerceValue.shape("\(itemPath).severity", "unsupported_value")
      }
      let retryable = try CommerceValue.boolean(
        item["retryable"],
        path: "\(itemPath).retryable"
      )
      let retryAfter = try item["retryAfterSeconds"].map {
        try CommerceValue.integer($0, range: 1...86_400, path: "\(itemPath).retryAfterSeconds")
      }
      guard retryable || retryAfter == nil else {
        throw invalid("commerce_configuration_diagnostic_retry_invalid")
      }
      let recoverySource = try item["recoveryAction"].map {
        try CommerceValue.string($0, path: "\(itemPath).recoveryAction")
      }
      let recovery: MosaicCommerceRecoveryAction?
      if let recoverySource {
        guard let value = MosaicCommerceRecoveryAction(rawValue: recoverySource) else {
          throw CommerceValue.shape("\(itemPath).recoveryAction", "unsupported_value")
        }
        recovery = value
      } else {
        recovery = nil
      }
      return MosaicCommerceDiagnostic(
        code: try CommerceValue.reasonCode(item["code"], path: "\(itemPath).code"),
        safeMessage: try CommerceValue.safeString(
          item["safeMessage"],
          length: 1...240,
          path: "\(itemPath).safeMessage"
        ),
        severity: severity,
        retryable: retryable,
        retryAfterSeconds: retryAfter,
        correlationID: try CommerceValue.identifier(
          item["correlationId"],
          path: "\(itemPath).correlationId"
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

  private static func validateFreshness(
    _ freshness: MosaicCommerceFreshness,
    activation: MosaicCommerceProviderActivation
  ) throws {
    guard let observed = CommerceValue.date(freshness.providerObservedAt),
      let synchronized = CommerceValue.date(freshness.synchronizedAt),
      let stale = CommerceValue.date(freshness.staleAt),
      synchronized >= observed,
      stale >= synchronized
    else {
      throw invalid("commerce_configuration_freshness_order_invalid")
    }
    if let expiresAt = freshness.expiresAt {
      guard let expires = CommerceValue.date(expiresAt), expires >= stale else {
        throw invalid("commerce_configuration_expiry_order_invalid")
      }
    }
    let expected: MosaicCommerceFreshnessSource
    switch activation {
    case .providerConnection: expected = .providerSynchronization
    case .sdkLocal: expected = .sdkLocalSnapshot
    case .nativeStore: expected = .nativeStoreConfiguration
    }
    guard freshness.source == expected else {
      throw invalid("commerce_configuration_freshness_source_mismatch")
    }
  }

  private static func invalid(_ code: String) -> MosaicCommerceConfigurationError {
    .invalidConfiguration(code: code)
  }
}

enum CommerceValue {
  static func object(_ value: Any?, path: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else { throw shape(path, "expected_object") }
    return value
  }

  static func array(_ value: Any?, count: ClosedRange<Int>, path: String) throws -> [Any] {
    guard let value = value as? [Any], count.contains(value.count) else {
      throw shape(path, "expected_bounded_array")
    }
    return value
  }

  static func exactKeys(
    _ object: [String: Any],
    required: Set<String>,
    optional: Set<String> = [],
    path: String
  ) throws {
    let keys = Set(object.keys)
    guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else {
      throw shape(path, "unexpected_or_missing_property")
    }
  }

  static func string(_ value: Any?, path: String) throws -> String {
    guard let value = value as? String else { throw shape(path, "expected_string") }
    return value
  }

  static func boolean(_ value: Any?, path: String) throws -> Bool {
    guard let value = value as? Bool else { throw shape(path, "expected_boolean") }
    return value
  }

  static func safeString(_ value: Any?, length: ClosedRange<Int>, path: String) throws -> String {
    let value = try string(value, path: path)
    guard length.contains(value.count),
      value.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7F })
    else {
      throw shape(path, "unsafe_or_out_of_bounds_string")
    }
    return value
  }

  static func patternString(
    _ value: Any?,
    length: ClosedRange<Int>,
    pattern: String,
    path: String
  ) throws -> String {
    let value = try safeString(value, length: length, path: path)
    guard value.range(of: pattern, options: .regularExpression) != nil else {
      throw shape(path, "pattern_mismatch")
    }
    return value
  }

  static func identifier(_ value: Any?, path: String) throws -> String {
    try patternString(
      value,
      length: 1...128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
      path: path
    )
  }

  static func entitlementKey(_ value: Any?, path: String) throws -> String {
    try patternString(
      value,
      length: 1...64,
      pattern: "^[a-z][a-z0-9_.-]*$",
      path: path
    )
  }

  static func opaqueIdentifier(_ value: Any?, path: String) throws -> String {
    try safeString(value, length: 1...256, path: path)
  }

  static func reasonCode(_ value: Any?, path: String) throws -> String {
    try patternString(
      value,
      length: 3...96,
      pattern: "^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$",
      path: path
    )
  }

  static func digest(_ value: Any?, path: String) throws -> String {
    try patternString(
      value,
      length: 71...71,
      pattern: "^sha256:[a-f0-9]{64}$",
      path: path
    )
  }

  static func timestamp(_ value: Any?, path: String) throws -> String {
    let value = try patternString(
      value,
      length: 20...32,
      pattern:
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$",
      path: path
    )
    guard date(value) != nil else { throw shape(path, "invalid_timestamp") }
    return value
  }

  static func integer(_ value: Any?, range: ClosedRange<Int>, path: String) throws -> Int {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite,
      number.doubleValue.rounded() == number.doubleValue,
      range.contains(number.intValue)
    else {
      throw shape(path, "expected_bounded_integer")
    }
    return number.intValue
  }

  static func date(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions =
      value.contains(".")
      ? [.withInternetDateTime, .withFractionalSeconds]
      : [.withInternetDateTime]
    return formatter.date(from: value)
  }

  static func shape(_ path: String, _ reason: String) -> MosaicCommerceConfigurationError {
    .invalidShape(path: path, reason: reason)
  }
}
