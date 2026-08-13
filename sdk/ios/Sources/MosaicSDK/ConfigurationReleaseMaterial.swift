import Foundation

/// Decodes the paywall, product, and asset material a Configuration Delivery
/// release carries.
///
/// This is release *material*, not a delivery version. It was previously the
/// body of the Delivery v1 decoder, which v2 reached by re-serializing its own
/// material into a synthetic v1 envelope. Under the single-version policy
/// (ADR-0028) there is only Delivery `3`, so the material rules live here under
/// their own name and are called directly — the envelope round-trip and the
/// projection chain it implied are gone.
///
/// The paywall documents it decodes are Paywall Protocol `0.4`, the one version
/// `MosaicProtocolDecoder` reads.
enum MosaicConfigurationReleaseMaterialDecoder {
  static func release(_ raw: [String: Any]) throws -> MosaicConfigurationRelease {
    let path = "$.release"
    try DeliveryValue.exactKeys(
      raw,
      expected: [
        "id", "number", "environment", "publishedAt", "contentDigest", "compatibility",
        "placements", "paywallVersions", "productReferences", "assetReferences",
      ],
      path: path
    )

    let contentDigest = try DeliveryValue.digest(
      raw["contentDigest"], path: "\(path).contentDigest")
    var releaseMaterial = raw
    releaseMaterial.removeValue(forKey: "contentDigest")
    guard contentDigest == (try DeliveryCanonicalJSON.digest(releaseMaterial)) else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_release_digest_mismatch")
    }

    let environment = try DeliveryValue.object(raw["environment"], path: "\(path).environment")
    try DeliveryValue.exactKeys(environment, expected: ["id", "key"], path: "\(path).environment")
    let metadata = MosaicConfigurationReleaseMetadata(
      id: try DeliveryValue.identifier(raw["id"], path: "\(path).id"),
      number: try DeliveryValue.integer(
        raw["number"], range: 1...9_007_199_254_740_991, path: "\(path).number"),
      environmentID: try DeliveryValue.identifier(
        environment["id"], path: "\(path).environment.id"),
      environmentKey: try DeliveryValue.environmentKey(
        environment["key"], path: "\(path).environment.key"),
      environmentMode: nil,
      publishedAt: try DeliveryValue.timestamp(raw["publishedAt"], path: "\(path).publishedAt"),
      contentDigest: contentDigest
    )

    let releaseCapabilities = try decodeCompatibility(
      raw["compatibility"], path: "\(path).compatibility")
    let placements = try decodePlacements(raw["placements"], path: "\(path).placements")
    let products = try decodeProducts(raw["productReferences"], path: "\(path).productReferences")
    let assets = try decodeAssets(raw["assetReferences"], path: "\(path).assetReferences")
    let paywalls = try decodePaywalls(raw["paywallVersions"], path: "\(path).paywallVersions")

    try validateSemantics(
      placements: placements,
      paywalls: paywalls,
      products: products,
      assets: assets,
      releaseCapabilities: releaseCapabilities
    )
    return MosaicConfigurationRelease(
      metadata: metadata,
      projectID: nil,
      placements: placements,
      placementDecisions: [],
      paywallVersions: paywalls,
      productReferences: products,
      entitlementReferences: [],
      assetReferences: assets,
      experimentAssignments: []
    )
  }

  private static func decodeCompatibility(_ value: Any?, path: String) throws
    -> Set<MosaicRequiredCapability>
  {
    let object = try DeliveryValue.object(value, path: path)
    try DeliveryValue.exactKeys(object, expected: ["paywallProtocols", "acceptance"], path: path)
    guard try DeliveryValue.string(object["acceptance"], path: "\(path).acceptance") == "atomic"
    else {
      throw MosaicConfigurationDeliveryError.invalidShape(
        path: "\(path).acceptance", reason: "expected_atomic")
    }
    let protocols = try DeliveryValue.array(
      object["paywallProtocols"], count: 1...1, path: "\(path).paywallProtocols")
    let protocolObject = try DeliveryValue.object(protocols[0], path: "\(path).paywallProtocols[0]")
    try DeliveryValue.exactKeys(
      protocolObject, expected: ["version", "requiredCapabilities"],
      path: "\(path).paywallProtocols[0]")
    let version = try DeliveryValue.string(
      protocolObject["version"], path: "\(path).paywallProtocols[0].version")
    guard version == mosaicProtocolVersion else {
      throw MosaicConfigurationDeliveryError.unsupportedPaywallProtocol(version)
    }
    let values = try DeliveryValue.array(
      protocolObject["requiredCapabilities"], count: 1...128,
      path: "\(path).paywallProtocols[0].requiredCapabilities"
    )
    var capabilities = Set<MosaicRequiredCapability>()
    let supported = Set(MosaicCapabilityCatalog.current)
    for (index, value) in values.enumerated() {
      let capabilityPath = "\(path).paywallProtocols[0].requiredCapabilities[\(index)]"
      let item = try DeliveryValue.object(value, path: capabilityPath)
      try DeliveryValue.exactKeys(item, expected: ["name", "version"], path: capabilityPath)
      let nameSource = try DeliveryValue.string(item["name"], path: "\(capabilityPath).name")
      let capabilityVersion = try DeliveryValue.string(
        item["version"], path: "\(capabilityPath).version")
      guard let name = MosaicCapabilityName(rawValue: nameSource),
        supported.contains(name), capabilityVersion == mosaicProtocolVersion
      else {
        throw MosaicConfigurationDeliveryError.unsupportedPaywallCapability(
          name: nameSource, version: capabilityVersion
        )
      }
      guard
        capabilities.insert(MosaicRequiredCapability(name: name, version: capabilityVersion))
          .inserted
      else {
        throw MosaicConfigurationDeliveryError.invalidRelease(code: "delivery_duplicate_capability")
      }
    }
    return capabilities
  }

  private static func decodePlacements(_ value: Any?, path: String) throws
    -> [MosaicConfigurationPlacement]
  {
    let values = try DeliveryValue.array(value, count: 1...256, path: path)
    var result: [MosaicConfigurationPlacement] = []
    var keys = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try DeliveryValue.object(value, path: itemPath)
      try DeliveryValue.exactKeys(item, expected: ["key", "paywallVersionId"], path: itemPath)
      let key = try DeliveryValue.placementKey(item["key"], path: "\(itemPath).key")
      guard keys.insert(key).inserted else {
        throw MosaicConfigurationDeliveryError.invalidRelease(code: "delivery_duplicate_placement")
      }
      result.append(
        MosaicConfigurationPlacement(
          key: key,
          paywallVersionID: try DeliveryValue.identifier(
            item["paywallVersionId"], path: "\(itemPath).paywallVersionId")
        ))
    }
    return result
  }

  private static func decodeProducts(_ value: Any?, path: String) throws
    -> [MosaicConfigurationProductReference]
  {
    let values = try DeliveryValue.array(value, count: 0...1024, path: path)
    var result: [MosaicConfigurationProductReference] = []
    var ids = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try DeliveryValue.object(value, path: itemPath)
      try DeliveryValue.exactKeys(
        item, expected: ["id", "type", "fallbackDisplayName"], path: itemPath)
      let id = try DeliveryValue.identifier(item["id"], path: "\(itemPath).id")
      guard ids.insert(id).inserted else {
        throw MosaicConfigurationDeliveryError.invalidRelease(code: "delivery_duplicate_product")
      }
      let typeSource = try DeliveryValue.string(item["type"], path: "\(itemPath).type")
      guard let type = MosaicConfigurationProductType(rawValue: typeSource) else {
        throw MosaicConfigurationDeliveryError.invalidShape(
          path: "\(itemPath).type", reason: "unsupported_value")
      }
      result.append(
        MosaicConfigurationProductReference(
          id: id,
          type: type,
          fallbackDisplayName: try DeliveryValue.safeString(
            item["fallbackDisplayName"], length: 1...160, path: "\(itemPath).fallbackDisplayName"
          ),
          readiness: .ready
        ))
    }
    return result
  }

  private static func decodeAssets(_ value: Any?, path: String) throws
    -> [MosaicConfigurationAssetReference]
  {
    let values = try DeliveryValue.array(value, count: 0...1024, path: path)
    var result: [MosaicConfigurationAssetReference] = []
    var ids = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try DeliveryValue.object(value, path: itemPath)
      try DeliveryValue.exactKeys(
        item, expected: ["id", "kind", "mediaType", "byteLength", "contentDigest", "url"],
        path: itemPath
      )
      let id = try DeliveryValue.identifier(item["id"], path: "\(itemPath).id")
      guard ids.insert(id).inserted else {
        throw MosaicConfigurationDeliveryError.invalidRelease(code: "delivery_duplicate_asset")
      }
      let kindSource = try DeliveryValue.string(item["kind"], path: "\(itemPath).kind")
      guard let kind = MosaicConfigurationAssetKind(rawValue: kindSource) else {
        throw MosaicConfigurationDeliveryError.invalidShape(
          path: "\(itemPath).kind", reason: "unsupported_value")
      }
      let mediaType = try DeliveryValue.patternString(
        item["mediaType"], length: 3...96, pattern: "^(image|video)/[a-z0-9][a-z0-9.+-]*$",
        path: "\(itemPath).mediaType"
      )
      guard mediaType.hasPrefix("\(kind.rawValue)/") else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_asset_media_type_mismatch")
      }
      result.append(
        MosaicConfigurationAssetReference(
          id: id,
          kind: kind,
          mediaType: mediaType,
          byteLength: try DeliveryValue.integer(
            item["byteLength"], range: 1...52_428_800, path: "\(itemPath).byteLength"),
          contentDigest: try DeliveryValue.digest(
            item["contentDigest"], path: "\(itemPath).contentDigest"),
          url: try DeliveryValue.httpsURL(item["url"], path: "\(itemPath).url")
        ))
    }
    return result
  }

  private static func decodePaywalls(_ value: Any?, path: String) throws
    -> [MosaicConfigurationPaywallVersion]
  {
    let values = try DeliveryValue.array(value, count: 1...256, path: path)
    var result: [MosaicConfigurationPaywallVersion] = []
    var ids = Set<String>()
    var paywallIDs = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try DeliveryValue.object(value, path: itemPath)
      try DeliveryValue.exactKeys(
        item,
        expected: [
          "id", "paywallId", "protocolVersion", "documentDigest", "document",
          "productReferenceIds", "assetBindings",
        ],
        path: itemPath
      )
      let id = try DeliveryValue.identifier(item["id"], path: "\(itemPath).id")
      let paywallID = try DeliveryValue.identifier(item["paywallId"], path: "\(itemPath).paywallId")
      guard ids.insert(id).inserted, paywallIDs.insert(paywallID).inserted else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_duplicate_paywall_version")
      }
      let protocolVersion = try DeliveryValue.string(
        item["protocolVersion"], path: "\(itemPath).protocolVersion")
      guard protocolVersion == mosaicProtocolVersion else {
        throw MosaicConfigurationDeliveryError.unsupportedPaywallProtocol(protocolVersion)
      }
      let documentObject = try DeliveryValue.object(item["document"], path: "\(itemPath).document")
      let documentData = try DeliveryCanonicalJSON.data(documentObject)
      let document: MosaicPaywallDocument
      do {
        document = try MosaicProtocolDecoder.decode(documentData)
      } catch let error as MosaicProtocolError {
        if case .unsupportedSchemaVersion(let version) = error {
          throw MosaicConfigurationDeliveryError.unsupportedPaywallProtocol(version)
        }
        if case .unsupportedCapability(let name, let version) = error {
          throw MosaicConfigurationDeliveryError.unsupportedPaywallCapability(
            name: name, version: version)
        }
        throw MosaicConfigurationDeliveryError.invalidRelease(code: error.diagnosticCode)
      }
      guard document.schemaVersion == protocolVersion, document.id == paywallID else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_paywall_identity_mismatch")
      }
      let documentDigest = try DeliveryValue.digest(
        item["documentDigest"], path: "\(itemPath).documentDigest")
      guard documentDigest == (try DeliveryCanonicalJSON.digest(documentObject)) else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_document_digest_mismatch")
      }
      let productIDs = try DeliveryValue.identifierArray(
        item["productReferenceIds"], count: 0...64, path: "\(itemPath).productReferenceIds"
      )
      let bindings = try decodeAssetBindings(
        item["assetBindings"], path: "\(itemPath).assetBindings")
      result.append(
        MosaicConfigurationPaywallVersion(
          id: id,
          paywallID: paywallID,
          protocolVersion: protocolVersion,
          documentDigest: documentDigest,
          document: document,
          productReferenceIDs: productIDs,
          assetBindings: bindings
        ))
    }
    return result
  }

  private static func decodeAssetBindings(_ value: Any?, path: String) throws
    -> [MosaicConfigurationAssetBinding]
  {
    let values = try DeliveryValue.array(value, count: 0...128, path: path)
    var result: [MosaicConfigurationAssetBinding] = []
    var documentIDs = Set<String>()
    var releaseIDs = Set<String>()
    for (index, value) in values.enumerated() {
      let itemPath = "\(path)[\(index)]"
      let item = try DeliveryValue.object(value, path: itemPath)
      try DeliveryValue.exactKeys(
        item, expected: ["documentAssetId", "assetReferenceId"], path: itemPath)
      let documentID = try DeliveryValue.identifier(
        item["documentAssetId"], path: "\(itemPath).documentAssetId")
      let releaseID = try DeliveryValue.identifier(
        item["assetReferenceId"], path: "\(itemPath).assetReferenceId")
      guard documentIDs.insert(documentID).inserted, releaseIDs.insert(releaseID).inserted else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_duplicate_asset_binding")
      }
      result.append(
        MosaicConfigurationAssetBinding(documentAssetID: documentID, assetReferenceID: releaseID))
    }
    return result
  }

  private static func validateSemantics(
    placements: [MosaicConfigurationPlacement],
    paywalls: [MosaicConfigurationPaywallVersion],
    products: [MosaicConfigurationProductReference],
    assets: [MosaicConfigurationAssetReference],
    releaseCapabilities: Set<MosaicRequiredCapability>
  ) throws {
    let versionIDs = Set(paywalls.map(\.id))
    let placementVersionIDs = Set(placements.map(\.paywallVersionID))
    guard placementVersionIDs == versionIDs else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_incomplete_placement_bindings")
    }
    let productIDs = Set(products.map(\.id))
    let expectedProductIDs = Set(paywalls.flatMap(\.productReferenceIDs))
    guard productIDs == expectedProductIDs else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_product_reference_mismatch")
    }
    let assetIDs = Set(assets.map(\.id))
    let expectedAssetIDs = Set(paywalls.flatMap(\.assetBindings).map(\.assetReferenceID))
    guard assetIDs == expectedAssetIDs else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_asset_reference_mismatch")
    }
    let assetByID = Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) })
    var expectedCapabilities = Set<MosaicRequiredCapability>()
    for paywall in paywalls {
      let documentProducts = Set(paywall.document.products.map(\.productId))
      guard documentProducts == Set(paywall.productReferenceIDs) else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_paywall_product_reference_mismatch")
      }
      expectedCapabilities.formUnion(paywall.document.compatibility.requiredCapabilities)
      let remoteAssets = Dictionary(
        uniqueKeysWithValues: paywall.document.assets.compactMap {
          asset -> (String, MosaicAsset)? in
          asset.source.remoteURL == nil ? nil : (asset.id, asset)
        }
      )
      guard Set(remoteAssets.keys) == Set(paywall.assetBindings.map(\.documentAssetID)) else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_remote_asset_binding_mismatch")
      }
      for binding in paywall.assetBindings {
        guard let documentAsset = remoteAssets[binding.documentAssetID],
          let releaseAsset = assetByID[binding.assetReferenceID]
        else {
          throw MosaicConfigurationDeliveryError.invalidRelease(
            code: "delivery_unknown_asset_binding")
        }
        let documentKind: MosaicConfigurationAssetKind =
          documentAsset.type == .image ? .image : .video
        guard releaseAsset.kind == documentKind,
          releaseAsset.url.absoluteString == documentAsset.source.remoteURL?.absoluteString
        else {
          throw MosaicConfigurationDeliveryError.invalidRelease(
            code: "delivery_asset_binding_mismatch")
        }
      }
    }
    guard releaseCapabilities == expectedCapabilities else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_release_capability_mismatch")
    }
  }
}
