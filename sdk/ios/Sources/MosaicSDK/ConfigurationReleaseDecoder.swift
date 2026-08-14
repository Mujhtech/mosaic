import Foundation

/// The placement-decision, entitlement, and release-envelope rules a
/// Configuration Delivery release body must satisfy.
///
/// Named for what it decodes rather than for a delivery version: Delivery `3` is
/// the only version (ADR-0028), and it reaches these rules by stripping its
/// experiment material and handing the remaining release body straight here.
enum MosaicConfigurationReleaseDecoder {
  private static let supportedFeatures: Set<String> = [
    "condition.all", "condition.any", "condition.not",
    "operator.equals", "operator.not_equals", "operator.in", "operator.not_in",
    "operator.greater_than", "operator.greater_than_or_equal", "operator.less_than",
    "operator.less_than_or_equal",
    "operator.exists", "operator.does_not_exist", "operator.contains_any", "operator.contains_all",
    "operator.locale_matches",
    "outcome.paywall", "outcome.no_paywall", "outcome.fallback", "outcome.unavailable",
    "source.device.platform", "source.device.os_version", "source.application.version",
    "source.application.locale",
    "source.context.country", "source.environment.id", "source.environment.key",
    "source.identity.user_present",
    "source.user_attribute", "source.entitlement_state", "source.product_availability",
    "source.product_readiness",
    "source.provider_capability", "override.qa",
  ]
  static var supportedCapabilityFeatures: [String] { supportedFeatures.sorted() }

  static func validateDecisionFixture(_ data: Data) throws {
    guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw MosaicConfigurationDeliveryError.invalidJSON
    }
    try validateDecision(raw, path: "$")
    let decision = try JSONDecoder().decode(
      MosaicPlacementDecision.self, from: DeliveryCanonicalJSON.data(raw))
    _ = try validateRuleSetSemantics(decision.ruleSet, environmentMode: .staging)
  }

  static func decode(
    release: [String: Any],
    contentDigest: String,
    allowUnreferencedExperimentMaterial: Bool = false
  ) throws -> MosaicConfigurationRelease {
    try exact(
      release,
      [
        "id", "number", "projectId", "environment", "publishedAt", "compatibility",
        "placementDecisions", "paywallVersions", "productReferences", "entitlementReferences",
        "assetReferences",
      ], "$.release")
    // The release body arrives with its `contentDigest` already verified and
    // stripped by the delivery decoder, which is the only layer holding the bytes
    // the server signed.
    let projectID = try identifier(release["projectId"], "$.release.projectId")
    let environment = try object(release["environment"], "$.release.environment")
    try exact(environment, ["id", "key", "mode"], "$.release.environment")
    let environmentID = try identifier(environment["id"], "$.release.environment.id")
    let environmentKey = try environmentKey(environment["key"], "$.release.environment.key")
    guard
      let environmentMode = MosaicEnvironmentMode(
        rawValue: try string(environment["mode"], "$.release.environment.mode"))
    else { throw invalid("delivery_invalid_environment_mode") }
    let compatibility = try decodeCompatibility(release["compatibility"])

    let decisionValues = try array(
      release["placementDecisions"], 1...256, "$.release.placementDecisions")
    var decisions: [MosaicPlacementDecision] = []
    var placementKeys = Set<String>()
    var placementIDs = Set<String>()
    var ruleSetIDs = Set<String>()
    var releaseFeatures = Set<String>()
    var releaseAlgorithms = Set<String>()
    for (index, raw) in decisionValues.enumerated() {
      let path = "$.release.placementDecisions[\(index)]"
      try validateDecision(raw, path: path)
      let data = try DeliveryCanonicalJSON.data(raw)
      let decision: MosaicPlacementDecision
      do { decision = try JSONDecoder().decode(MosaicPlacementDecision.self, from: data) } catch {
        throw invalid("decision_decode_failed")
      }
      guard decision.placementDecisionVersion == "1" else {
        throw MosaicConfigurationDeliveryError.unsupportedDecisionContract(
          decision.placementDecisionVersion)
      }
      let set = decision.ruleSet
      guard set.projectId == projectID, set.environmentId == environmentID,
        set.environmentKey == environmentKey
      else { throw invalid("decision_release_ownership_mismatch") }
      let derivedCompatibility = try validateRuleSetSemantics(
        set, environmentMode: environmentMode)
      guard placementKeys.insert(set.placementKey).inserted,
        placementIDs.insert(set.placementId).inserted, ruleSetIDs.insert(set.id).inserted
      else { throw invalid("decision_duplicate_identity") }
      guard Set(set.compatibility.requiredFeatures).isSubset(of: supportedFeatures) else {
        throw MosaicConfigurationDeliveryError.unsupportedDecisionFeature(
          Set(set.compatibility.requiredFeatures).subtracting(supportedFeatures).first
            ?? "decision_feature_mismatch")
      }
      releaseFeatures.formUnion(derivedCompatibility.features)
      releaseAlgorithms.formUnion(derivedCompatibility.algorithms)
      decisions.append(decision)
    }
    guard releaseFeatures == Set(compatibility.features),
      releaseAlgorithms == Set(compatibility.algorithms)
    else { throw invalid("decision_release_compatibility_mismatch") }

    let productValues = try array(
      release["productReferences"], 0...1024, "$.release.productReferences")
    let products = try productValues.enumerated().map {
      index, raw -> MosaicConfigurationProductReference in
      let path = "$.release.productReferences[\(index)]"
      let value = try object(raw, path)
      try exact(value, ["id", "type", "fallbackDisplayName", "readiness"], path)
      guard
        let type = MosaicConfigurationProductType(
          rawValue: try string(value["type"], path + ".type")),
        let readiness = MosaicProductReadiness(
          rawValue: try string(value["readiness"], path + ".readiness"))
      else { throw invalid("delivery_product_reference_invalid") }
      return .init(
        id: try identifier(value["id"], path + ".id"), type: type,
        fallbackDisplayName: try safeString(
          value["fallbackDisplayName"], 1...160, path + ".fallbackDisplayName"),
        readiness: readiness)
    }
    guard Set(products.map(\.id)).count == products.count else {
      throw invalid("delivery_duplicate_product")
    }

    let entitlementValues = try array(
      release["entitlementReferences"], 0...1024, "$.release.entitlementReferences")
    let entitlements = try entitlementValues.enumerated().map {
      index, raw -> MosaicConfigurationEntitlementReference in
      let path = "$.release.entitlementReferences[\(index)]"
      let value = try object(raw, path)
      try exact(value, ["id", "key"], path)
      return .init(
        id: try identifier(value["id"], path + ".id"), key: try key(value["key"], path + ".key"))
    }
    guard Set(entitlements.map(\.id)).count == entitlements.count,
      Set(entitlements.map(\.key)).count == entitlements.count
    else { throw invalid("delivery_duplicate_entitlement") }

    let paywallValues = try array(release["paywallVersions"], 0...256, "$.release.paywallVersions")
    let assets = try array(release["assetReferences"], 0...1024, "$.release.assetReferences")
    let base = try decodePaywallMaterial(
      release: release, paywalls: paywallValues, products: productValues, assets: assets,
      compatibility: compatibility.paywallCompatibility, contentDigest: contentDigest)
    let paywalls = base?.paywallVersions ?? []
    let assetReferences = base?.assetReferences ?? []
    let paywallIDs = Set(paywalls.map(\.id))
    let productIDs = Set(products.map(\.id))
    let entitlementKeys = Set(entitlements.map(\.key))
    for decision in decisions {
      try validateReferences(
        decision, paywallIDs: paywallIDs, productIDs: productIDs, entitlementKeys: entitlementKeys)
    }
    let referencedPaywalls = Set(decisions.flatMap { referencedPaywallIDs($0.ruleSet) })
    guard
      allowUnreferencedExperimentMaterial
        ? referencedPaywalls.isSubset(of: paywallIDs) : referencedPaywalls == paywallIDs
    else {
      throw invalid("delivery_paywall_reference_mismatch")
    }
    let referencedProducts = Set(paywalls.flatMap(\.productReferenceIDs)).union(
      decisions.flatMap { referencedProductIDs($0.ruleSet) })
    guard
      allowUnreferencedExperimentMaterial
        ? referencedProducts.isSubset(of: productIDs) : referencedProducts == productIDs
    else {
      throw invalid("delivery_product_reference_mismatch")
    }
    let referencedEntitlements = Set(decisions.flatMap { referencedEntitlementKeys($0.ruleSet) })
    guard referencedEntitlements == entitlementKeys else {
      throw invalid("delivery_entitlement_reference_mismatch")
    }
    guard !paywalls.isEmpty || assets.isEmpty else {
      throw invalid("delivery_asset_reference_mismatch")
    }

    let metadata = MosaicConfigurationReleaseMetadata(
      id: try identifier(release["id"], "$.release.id"),
      number: try integer(release["number"], 1...9_007_199_254_740_991, "$.release.number"),
      environmentID: environmentID, environmentKey: environmentKey,
      environmentMode: environmentMode,
      publishedAt: try timestamp(release["publishedAt"], "$.release.publishedAt"),
      contentDigest: contentDigest)
    return .init(
      metadata: metadata, projectID: projectID, placementDecisions: decisions,
      paywallVersions: paywalls, productReferences: products, entitlementReferences: entitlements,
      assetReferences: assetReferences, experimentAssignments: [])
  }

  private struct Compatibility {
    let features: [String]
    let algorithms: [String]
    let paywallCompatibility: [String: Any]
  }
  private static func decodeCompatibility(_ raw: Any?) throws -> Compatibility {
    let value = try object(raw, "$.release.compatibility")
    try exact(
      value, ["placementDecisionContracts", "paywallProtocols", "acceptance"],
      "$.release.compatibility")
    guard try string(value["acceptance"], "$.release.compatibility.acceptance") == "atomic" else {
      throw invalid("delivery_acceptance_not_atomic")
    }
    let decisions = try array(
      value["placementDecisionContracts"], 1...1,
      "$.release.compatibility.placementDecisionContracts")
    let decision = try object(decisions[0], "$.release.compatibility.placementDecisionContracts[0]")
    try exact(
      decision, ["version", "requiredFeatures", "bucketingAlgorithms"],
      "$.release.compatibility.placementDecisionContracts[0]")
    let version = try string(
      decision["version"], "$.release.compatibility.placementDecisionContracts[0].version")
    guard version == "1" else {
      throw MosaicConfigurationDeliveryError.unsupportedDecisionContract(version)
    }
    let features = try strings(
      decision["requiredFeatures"], 0...64,
      "$.release.compatibility.placementDecisionContracts[0].requiredFeatures")
    if let unsupported = Set(features).subtracting(supportedFeatures).first {
      throw MosaicConfigurationDeliveryError.unsupportedDecisionFeature(unsupported)
    }
    let algorithms = try strings(
      decision["bucketingAlgorithms"], 0...1,
      "$.release.compatibility.placementDecisionContracts[0].bucketingAlgorithms")
    if let unsupported = algorithms.first(where: {
      !mosaicSupportedBucketingAlgorithms.contains($0)
    }) {
      throw MosaicConfigurationDeliveryError.unsupportedBucketingAlgorithm(unsupported)
    }
    let protocols = try array(
      value["paywallProtocols"], 1...1, "$.release.compatibility.paywallProtocols")
    let paywall = try object(protocols[0], "$.release.compatibility.paywallProtocols[0]")
    return .init(features: features, algorithms: algorithms, paywallCompatibility: paywall)
  }

  private static func decodePaywallMaterial(
    release: [String: Any], paywalls: [Any], products: [Any], assets: [Any],
    compatibility: [String: Any], contentDigest: String
  ) throws -> MosaicConfigurationRelease? {
    guard !paywalls.isEmpty else { return nil }
    let paywallProductIDs = Set(
      try paywalls.flatMap { raw -> [String] in
        let item = try object(raw, "paywall")
        return try (item["productReferenceIds"] as? [Any] ?? []).map {
          try string($0, "paywall.productReferenceIds")
        }
      })
    let materialProducts = try products.compactMap { raw -> [String: Any]? in
      var item = try object(raw, "product")
      guard let id = item["id"] as? String, paywallProductIDs.contains(id) else { return nil }
      item.removeValue(forKey: "readiness")
      return item
    }
    var releaseMaterial: [String: Any] = [
      "id": release["id"]!, "number": release["number"]!,
      "environment": [
        "id": try object(release["environment"], "$.release.environment")["id"]!,
        "key": try object(release["environment"], "$.release.environment")["key"]!,
      ],
      "publishedAt": release["publishedAt"]!,
      "compatibility": ["paywallProtocols": [compatibility], "acceptance": "atomic"],
      "paywallVersions": paywalls, "productReferences": materialProducts,
      "assetReferences": assets,
    ]
    // The digest is carried through rather than recomputed: this material is
    // this process's own re-assembly, and only the delivery decoder held the
    // bytes the server signed.
    return try MosaicConfigurationReleaseMaterialDecoder.release(
      releaseMaterial, contentDigest: contentDigest)
  }

  private static func validateDecision(_ raw: Any, path: String) throws {
    guard try DeliveryCanonicalJSON.data(raw).count <= 262_144 else {
      throw invalid("decision_document_too_large")
    }
    let envelope = try object(raw, path)
    try exact(envelope, ["placementDecisionVersion", "ruleSet"], path)
    guard
      try string(envelope["placementDecisionVersion"], path + ".placementDecisionVersion") == "1"
    else {
      throw MosaicConfigurationDeliveryError.unsupportedDecisionContract(
        try string(envelope["placementDecisionVersion"], path + ".placementDecisionVersion"))
    }
    let set = try object(envelope["ruleSet"], path + ".ruleSet")
    try exact(
      set,
      [
        "id", "version", "projectId", "environmentId", "environmentKey", "placementId",
        "placementKey", "enabled", "assignmentPolicy", "attributeDefinitions", "fallbacks", "rules",
        "defaultOutcome", "qaOverrides", "compatibility",
      ], path + ".ruleSet")
    _ = try identifier(set["id"], path)
    _ = try integer(set["version"], 1...Int64.max, path)
    _ = try identifier(set["projectId"], path)
    _ = try identifier(set["environmentId"], path)
    _ = try environmentKey(set["environmentKey"], path)
    _ = try identifier(set["placementId"], path)
    _ = try key(set["placementKey"], path)
    guard set["enabled"] is Bool,
      ["installation", "identified_user", "identified_user_or_installation"].contains(
        try string(set["assignmentPolicy"], path))
    else { throw invalid("decision_invalid_ruleset") }
    let definitions = try array(set["attributeDefinitions"], 0...32, path)
    let fallbacks = try array(set["fallbacks"], 0...32, path)
    let rules = try array(set["rules"], 0...100, path)
    let overrides = try array(set["qaOverrides"], 0...32, path)
    let compatibility = try object(set["compatibility"], path + ".compatibility")
    try exact(
      compatibility, ["requiredFeatures", "bucketingAlgorithms"], path + ".compatibility")
    _ = try strings(
      compatibility["requiredFeatures"], 0...64, path + ".compatibility.requiredFeatures")
    let algorithms = try strings(
      compatibility["bucketingAlgorithms"], 0...1,
      path + ".compatibility.bucketingAlgorithms")
    if let unsupported = algorithms.first(where: {
      !mosaicSupportedBucketingAlgorithms.contains($0)
    }) {
      throw MosaicConfigurationDeliveryError.unsupportedBucketingAlgorithm(unsupported)
    }
    var definitionKeys = Set<String>()
    for raw in definitions {
      let value = try object(raw, path)
      try exact(value, ["key", "type", "sensitivity", "allowedOperators"], path)
      guard definitionKeys.insert(try key(value["key"], path)).inserted else {
        throw invalid("decision_duplicate_attribute_definition")
      }
      _ = try strings(value["allowedOperators"], 1...13, path)
    }
    var ruleIDs = Set<String>()
    var priorities = Set<Int64>()
    for raw in rules {
      let value = try object(raw, path)
      try exactOptional(
        value, required: ["id", "priority", "enabled", "conditions", "outcome"],
        optional: ["safeLabel", "rollout"], path)
      let priority = try integer(value["priority"], 0...9999, path)
      guard ruleIDs.insert(try identifier(value["id"], path)).inserted,
        priorities.insert(priority).inserted
      else {
        throw invalid("decision_duplicate_priority")
      }
      try validateCondition(value["conditions"]!, depth: 1, leaves: 0, path: path)
      try validateOutcome(value["outcome"]!, path: path)
      if let rollout = value["rollout"] {
        let r = try object(rollout, path)
        try exact(r, ["algorithm", "thresholdBasisPoints"], path)
        guard try string(r["algorithm"], path) == "sha256_length_prefixed_v1" else {
          throw invalid("decision_unsupported_bucketing_algorithm")
        }
        _ = try integer(r["thresholdBasisPoints"], 0...10000, path)
      }
    }
    var fallbackKeys = Set<String>()
    var edges: [String: String] = [:]
    for raw in fallbacks {
      let value = try object(raw, path)
      try exactOptional(value, required: ["key", "outcome"], optional: ["safeLabel"], path)
      let fallbackKey = try key(value["key"], path)
      guard fallbackKeys.insert(fallbackKey).inserted else {
        throw invalid("decision_duplicate_fallback")
      }
      try validateOutcome(value["outcome"]!, path: path)
      if let target = fallbackTarget(value["outcome"]!) { edges[fallbackKey] = target }
    }
    for start in fallbackKeys {
      var seen = Set<String>()
      var current: String? = start
      while let key = current {
        guard seen.insert(key).inserted else { throw invalid("decision_fallback_cycle") }
        guard seen.count <= 8 else { throw invalid("decision_fallback_depth_exceeded") }
        current = edges[key]
      }
    }
    try validateOutcome(set["defaultOutcome"]!, path: path)
    var overrideIDs = Set<String>()
    var overrideDigests = Set<String>()
    for raw in overrides {
      let value = try object(raw, path)
      try exact(
        value, ["id", "selectorDigest", "safeLabel", "startsAt", "expiresAt", "outcome"], path)
      guard overrideIDs.insert(try identifier(value["id"], path)).inserted,
        overrideDigests.insert(try string(value["selectorDigest"], path)).inserted
      else { throw invalid("decision_duplicate_qa_override") }
      try validateOutcome(value["outcome"]!, path: path)
    }
    let allOutcomeValues =
      [set["defaultOutcome"]!]
      + rules.compactMap { ($0 as? [String: Any])?["outcome"] }
      + fallbacks.compactMap { ($0 as? [String: Any])?["outcome"] }
      + overrides.compactMap { ($0 as? [String: Any])?["outcome"] }
    for outcome in allOutcomeValues {
      if let target = fallbackTarget(outcome), !fallbackKeys.contains(target) {
        throw invalid("decision_unknown_fallback")
      }
    }
  }

  @discardableResult private static func validateCondition(
    _ raw: Any, depth: Int, leaves: Int, path: String
  ) throws -> Int {
    guard depth <= 5 else { throw invalid("decision_condition_depth_exceeded") }
    let value = try object(raw, path)
    let type = try string(value["type"], path + ".type")
    if type == "condition" {
      try exactOptional(
        value, required: ["type", "source", "operator"], optional: ["operand"], path)
      let op = try string(value["operator"], path)
      guard MosaicDecisionOperator(rawValue: op) != nil else {
        throw invalid("decision_unsupported_operator")
      }
      let requiresOperand = op != "exists" && op != "does_not_exist"
      guard requiresOperand == (value["operand"] != nil) else {
        throw invalid("decision_invalid_operand")
      }
      let source = try object(value["source"], path)
      let kind = try string(source["kind"], path)
      switch kind {
      case "device.platform", "device.os_version", "application.version", "application.locale",
        "context.country", "environment.id", "environment.key", "identity.user_present":
        try exact(source, ["kind"], path)
      case "user_attribute", "entitlement_state":
        try exact(source, ["kind", "key"], path)
        _ = try key(source["key"], path)
      case "product_availability", "product_readiness":
        try exact(source, ["kind", "productId"], path)
        _ = try identifier(source["productId"], path)
      case "provider_capability":
        try exact(source, ["kind", "capability"], path)
        guard
          ["product_loading", "purchase", "restore", "entitlement_lookup"].contains(
            try string(source["capability"], path))
        else { throw invalid("decision_unsupported_provider_capability") }
      default: throw invalid("decision_unsupported_source")
      }
      if let operand = value["operand"] { try validateTypedValue(operand, path: path) }
      guard leaves + 1 <= 64 else { throw invalid("decision_condition_leaves_exceeded") }
      return leaves + 1
    }
    if type == "not" {
      try exact(value, ["type", "child"], path)
      return try validateCondition(value["child"]!, depth: depth + 1, leaves: leaves, path: path)
    }
    guard type == "all" || type == "any" else { throw invalid("decision_invalid_condition_type") }
    try exact(value, ["type", "children"], path)
    let children = try array(value["children"], 2...16, path)
    var count = leaves
    for child in children {
      count = try validateCondition(child, depth: depth + 1, leaves: count, path: path)
    }
    return count
  }

  private static func validateTypedValue(_ raw: Any, path: String) throws {
    let value = try object(raw, path)
    try exact(value, ["type", "value"], path)
    let type = try string(value["type"], path)
    switch type {
    case "string":
      guard let string = value["value"] as? String, Data(string.utf8).count <= 256 else {
        throw invalid("decision_invalid_typed_value")
      }
    case "boolean":
      guard value["value"] is Bool else { throw invalid("decision_invalid_typed_value") }
    case "number":
      guard let number = value["value"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
        number.doubleValue.isFinite
      else { throw invalid("decision_non_finite_number") }
    case "timestamp":
      let rawTimestamp = try timestamp(value["value"], path)
      guard exactDate(rawTimestamp) != nil else { throw invalid("decision_invalid_typed_value") }
    case "semantic_version":
      guard let version = value["value"] as? String, (1...128).contains(version.count),
        validSemanticVersion(version)
      else {
        throw invalid("decision_invalid_typed_value")
      }
    case "string_list":
      let values = try strings(value["value"], 1...16, path)
      guard values.allSatisfy({ Data($0.utf8).count <= 128 }) else {
        throw invalid("decision_invalid_typed_value")
      }
    default: throw invalid("decision_invalid_typed_value")
    }
  }
  private static func validateOutcome(_ raw: Any, path: String) throws {
    let value = try object(raw, path)
    let type = try string(value["type"], path)
    switch type {
    case "paywall":
      try exactOptional(
        value, required: ["type", "paywallVersionId"], optional: ["unavailableFallbackKey"], path)
      _ = try identifier(value["paywallVersionId"], path)
      if let fallback = value["unavailableFallbackKey"] { _ = try key(fallback, path) }
    case "no_paywall": try exact(value, ["type"], path)
    case "fallback":
      try exact(value, ["type", "key"], path)
      _ = try key(value["key"], path)
    case "unavailable":
      try exact(value, ["type", "reason"], path)
      guard
        [
          "no_safe_decision", "configuration_incompatible", "content_unavailable",
          "commerce_unavailable",
        ].contains(try string(value["reason"], path))
      else { throw invalid("decision_invalid_unavailable_reason") }
    default: throw invalid("decision_unsupported_outcome")
    }
  }
  private static func fallbackTarget(_ raw: Any) -> String? {
    guard let value = raw as? [String: Any] else { return nil }
    if value["type"] as? String == "fallback" { return value["key"] as? String }
    if value["type"] as? String == "paywall" {
      return value["unavailableFallbackKey"] as? String
    }
    return nil
  }

  private static func validateReferences(
    _ decision: MosaicPlacementDecision, paywallIDs: Set<String>, productIDs: Set<String>,
    entitlementKeys: Set<String>
  ) throws {
    let set = decision.ruleSet
    let fallbackKeys = Set(set.fallbacks.map(\.key))
    func outcome(_ value: MosaicDecisionOutcome) throws {
      switch value {
      case .paywall(let id, let key):
        guard paywallIDs.contains(id), key.map(fallbackKeys.contains) ?? true else {
          throw invalid("decision_unknown_paywall_or_fallback")
        }
      case .fallback(let key):
        guard fallbackKeys.contains(key) else { throw invalid("decision_unknown_fallback") }
      default: break
      }
    }
    try outcome(set.defaultOutcome)
    for value in set.fallbacks { try outcome(value.outcome) }
    for rule in set.rules {
      try outcome(rule.outcome)
      try sources(rule.conditions)
    }
    for value in set.qaOverrides { try outcome(value.outcome) }
    func sources(_ node: MosaicConditionNode) throws {
      switch node {
      case .condition(let source, _, _):
        switch source {
        case .productAvailability(let id), .productReadiness(let id):
          guard productIDs.contains(id) else { throw invalid("decision_unknown_product") }
        case .entitlementState(let key):
          guard entitlementKeys.contains(key) else { throw invalid("decision_unknown_entitlement") }
        case .userAttribute(let key):
          guard set.attributeDefinitions.contains(where: { $0.key == key }) else {
            throw invalid("decision_unknown_attribute")
          }
        default: break
        }
      case .all(let children), .any(let children): for child in children { try sources(child) }
      case .not(let child): try sources(child)
      }
    }
  }

  private struct DerivedCompatibility {
    let features: Set<String>
    let algorithms: Set<String>
  }

  private static func validateRuleSetSemantics(
    _ set: MosaicDecisionRuleSet, environmentMode: MosaicEnvironmentMode
  ) throws -> DerivedCompatibility {
    let definitions = Dictionary(
      uniqueKeysWithValues: set.attributeDefinitions.map { ($0.key, $0) })
    for definition in set.attributeDefinitions {
      guard
        definition.allowedOperators.allSatisfy({
          allowedAttributeOperator($0, type: definition.type)
        })
      else { throw invalid("decision_attribute_operator_type_mismatch") }
    }
    func validate(_ node: MosaicConditionNode) throws {
      switch node {
      case .all(let children), .any(let children):
        for child in children { try validate(child) }
      case .not(let child): try validate(child)
      case .condition(let source, let op, let operand):
        let existence = op == .exists || op == .doesNotExist
        switch source {
        case .devicePlatform:
          guard equalityOrMembershipOperator(op),
            closedStringOperand(operand, operator: op, values: ["ios", "android"])
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .deviceOSVersion, .applicationVersion:
          guard versionOperator(op), existence || validSemanticVersionOperand(operand)
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .applicationLocale:
          // Only a `locale_matches` range is bound by the authored grammar. An
          // operand with no canonical form under the direct operators is a
          // runtime unknown, not an invalid document, so rejecting the release
          // would discard rules the contract says are valid.
          guard localeOperator(op), existence || stringOperand(operand, operator: op),
            op != .localeMatches || validLocaleOperand(operand, operator: op)
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .country:
          guard equalityOrMembershipOrExistenceOperator(op),
            existence || canonicalStringOperand(operand, operator: op, pattern: "^[A-Z]{2}$")
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .environmentID, .environmentKey:
          guard equalityOrMembershipOperator(op), stringOperand(operand, operator: op)
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .userPresent:
          guard op == .equals || op == .notEquals, case .boolean? = operand
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .entitlementState:
          guard equalityOrMembershipOperator(op),
            closedStringOperand(
              operand, operator: op,
              values: ["active", "inactive", "unknown", "provider_unavailable", "failed"])
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .productAvailability:
          guard equalityOrMembershipOperator(op),
            closedStringOperand(
              operand, operator: op,
              values: ["available", "unavailable", "unknown", "provider_unavailable", "failed"])
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .productReadiness:
          guard equalityOperator(op),
            closedStringOperand(operand, operator: op, values: ["ready", "not_ready"])
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .providerCapability:
          guard equalityOperator(op),
            closedStringOperand(
              operand, operator: op, values: ["available", "unavailable", "unknown"])
          else { throw invalid("decision_operator_source_type_mismatch") }
        case .userAttribute(let key):
          guard let definition = definitions[key], definition.allowedOperators.contains(op),
            allowedAttributeOperator(op, type: definition.type),
            existence
              || operandMatchesAttribute(
                operand, type: definition.type, membership: op == .in || op == .notIn)
          else { throw invalid("decision_attribute_condition_mismatch") }
        }
      }
    }
    for rule in set.rules { try validate(rule.conditions) }
    guard set.qaOverrides.isEmpty || environmentMode != .production else {
      throw invalid("decision_production_qa_override")
    }
    for override in set.qaOverrides {
      guard
        override.selectorDigest.range(of: "^sha256:[a-f0-9]{64}$", options: .regularExpression)
          != nil,
        let start = exactDate(override.startsAt),
        let end = exactDate(override.expiresAt),
        start < end, end.timeIntervalSince(start) <= 86_400
      else { throw invalid("decision_invalid_qa_override") }
    }

    let derived = deriveCompatibility(set)
    guard Set(set.compatibility.requiredFeatures) == derived.features else {
      throw invalid("decision_ruleset_feature_mismatch")
    }
    guard Set(set.compatibility.bucketingAlgorithms) == derived.algorithms else {
      throw invalid("decision_ruleset_algorithm_mismatch")
    }
    return derived
  }

  private static func equalityOperator(_ op: MosaicDecisionOperator) -> Bool {
    op == .equals || op == .notEquals
  }
  private static func equalityOrMembershipOperator(_ op: MosaicDecisionOperator) -> Bool {
    equalityOperator(op) || op == .in || op == .notIn
  }
  private static func equalityOrMembershipOrExistenceOperator(_ op: MosaicDecisionOperator) -> Bool
  {
    equalityOrMembershipOperator(op) || op == .exists || op == .doesNotExist
  }
  private static func localeOperator(_ op: MosaicDecisionOperator) -> Bool {
    equalityOrMembershipOrExistenceOperator(op) || op == .localeMatches
  }
  private static func versionOperator(_ op: MosaicDecisionOperator) -> Bool {
    [
      .equals, .notEquals, .greaterThan, .greaterThanOrEqual, .lessThan, .lessThanOrEqual, .exists,
      .doesNotExist,
    ].contains(op)
  }
  private static func stringOperand(
    _ operand: MosaicTypedValue?, operator op: MosaicDecisionOperator
  ) -> Bool {
    if op == .in || op == .notIn, case .stringList? = operand { return true }
    if op != .in && op != .notIn, case .string? = operand { return true }
    return false
  }
  private static func validSemanticVersionOperand(_ operand: MosaicTypedValue?) -> Bool {
    if case .semanticVersion(let value)? = operand { return validSemanticVersion(value) }
    return false
  }
  private static func allowedAttributeOperator(_ op: MosaicDecisionOperator, type: String) -> Bool {
    switch type {
    case "string":
      return [.equals, .notEquals, .in, .notIn, .exists, .doesNotExist].contains(op)
    case "boolean":
      return [.equals, .notEquals, .exists, .doesNotExist].contains(op)
    case "number", "timestamp", "semantic_version":
      return [
        .equals, .notEquals, .greaterThan, .greaterThanOrEqual, .lessThan, .lessThanOrEqual,
        .exists, .doesNotExist,
      ].contains(op)
    case "string_list":
      return [.containsAny, .containsAll, .exists, .doesNotExist].contains(op)
    default: return false
    }
  }
  private static func operandMatchesAttribute(
    _ operand: MosaicTypedValue?, type: String, membership: Bool
  ) -> Bool {
    if membership { return stringOperand(operand, operator: .in) }
    switch (type, operand) {
    case ("string", .string?), ("boolean", .boolean?), ("number", .number?),
      ("timestamp", .timestamp?), ("semantic_version", .semanticVersion?),
      ("string_list", .stringList?):
      return true
    default: return false
    }
  }

  private static func closedStringOperand(
    _ operand: MosaicTypedValue?, operator op: MosaicDecisionOperator, values: Set<String>
  ) -> Bool {
    switch operand {
    case .string(let value)?: return op != .in && op != .notIn && values.contains(value)
    case .stringList(let list)?:
      return (op == .in || op == .notIn) && list.allSatisfy(values.contains)
    default: return false
    }
  }

  private static func canonicalStringOperand(
    _ operand: MosaicTypedValue?, operator op: MosaicDecisionOperator, pattern: String
  ) -> Bool {
    let values: [String]
    switch operand {
    case .string(let value)?:
      guard op != .in && op != .notIn else { return false }
      values = [value]
    case .stringList(let list)?:
      guard op == .in || op == .notIn else { return false }
      values = list
    default: return false
    }
    return values.allSatisfy { $0.range(of: pattern, options: .regularExpression) != nil }
  }

  private static func validLocaleOperand(
    _ operand: MosaicTypedValue?, operator op: MosaicDecisionOperator
  ) -> Bool {
    canonicalStringOperand(
      operand, operator: op,
      pattern: "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")
  }

  private static func validSemanticVersion(_ value: String) -> Bool {
    guard
      let match = value.range(
        of:
          "^(0|[1-9][0-9]*)(?:\\.(0|[1-9][0-9]*))?(?:\\.(0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
        options: .regularExpression), match == value.startIndex..<value.endIndex
    else { return false }
    let withoutBuild = value.split(separator: "+", maxSplits: 1)[0]
    let parts = withoutBuild.split(separator: "-", maxSplits: 1)
    guard
      parts.count < 2
        || parts[1].split(separator: ".").allSatisfy({ identifier in
          !(identifier.count > 1 && identifier.first == "0" && identifier.allSatisfy(\.isNumber))
        })
    else { return false }
    return true
  }

  private static func exactDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value), formatter.string(from: date) == value else {
      return nil
    }
    return date
  }

  private static func deriveCompatibility(_ set: MosaicDecisionRuleSet) -> DerivedCompatibility {
    var features = Set<String>()
    var algorithms = Set<String>()
    func add(_ outcome: MosaicDecisionOutcome) {
      switch outcome {
      case .paywall: features.insert("outcome.paywall")
      case .noPaywall: features.insert("outcome.no_paywall")
      case .fallback: features.insert("outcome.fallback")
      case .unavailable: features.insert("outcome.unavailable")
      }
    }
    func visit(_ node: MosaicConditionNode) {
      switch node {
      case .all(let children):
        features.insert("condition.all")
        children.forEach(visit)
      case .any(let children):
        features.insert("condition.any")
        children.forEach(visit)
      case .not(let child):
        features.insert("condition.not")
        visit(child)
      case .condition(let source, let op, _):
        features.insert("source.\(sourceFeature(source))")
        features.insert("operator.\(op.rawValue)")
      }
    }
    add(set.defaultOutcome)
    for fallback in set.fallbacks { add(fallback.outcome) }
    for override in set.qaOverrides {
      features.insert("override.qa")
      add(override.outcome)
    }
    for rule in set.rules {
      add(rule.outcome)
      visit(rule.conditions)
      if let rollout = rule.rollout { algorithms.insert(rollout.algorithm) }
    }
    return .init(features: features, algorithms: algorithms)
  }

  private static func sourceFeature(_ source: MosaicDecisionSource) -> String {
    switch source {
    case .devicePlatform: "device.platform"
    case .deviceOSVersion: "device.os_version"
    case .applicationVersion: "application.version"
    case .applicationLocale: "application.locale"
    case .country: "context.country"
    case .environmentID: "environment.id"
    case .environmentKey: "environment.key"
    case .userPresent: "identity.user_present"
    case .userAttribute: "user_attribute"
    case .entitlementState: "entitlement_state"
    case .productAvailability: "product_availability"
    case .productReadiness: "product_readiness"
    case .providerCapability: "provider_capability"
    }
  }
  private static func referencedPaywallIDs(_ set: MosaicDecisionRuleSet) -> [String] {
    func ids(_ value: MosaicDecisionOutcome) -> [String] {
      if case .paywall(let id, _) = value { return [id] }
      return []
    }
    return ids(set.defaultOutcome) + set.rules.flatMap { ids($0.outcome) }
      + set.fallbacks.flatMap { ids($0.outcome) } + set.qaOverrides.flatMap { ids($0.outcome) }
  }

  private static func referencedProductIDs(_ set: MosaicDecisionRuleSet) -> [String] {
    referencedSourceValues(set) { source in
      switch source {
      case .productAvailability(let id), .productReadiness(let id): id
      default: nil
      }
    }
  }

  private static func referencedEntitlementKeys(_ set: MosaicDecisionRuleSet) -> [String] {
    referencedSourceValues(set) { source in
      if case .entitlementState(let key) = source { return key }
      return nil
    }
  }

  private static func referencedSourceValues(
    _ set: MosaicDecisionRuleSet, transform: (MosaicDecisionSource) -> String?
  ) -> [String] {
    func values(_ node: MosaicConditionNode) -> [String] {
      switch node {
      case .condition(let source, _, _): transform(source).map { [$0] } ?? []
      case .all(let children), .any(let children): children.flatMap(values)
      case .not(let child): values(child)
      }
    }
    return set.rules.flatMap { values($0.conditions) }
  }

  private static func object(_ value: Any?, _ path: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else { throw shape(path) }
    return value
  }
  private static func array(_ value: Any?, _ range: ClosedRange<Int>, _ path: String) throws
    -> [Any]
  {
    guard let value = value as? [Any], range.contains(value.count) else { throw shape(path) }
    return value
  }
  private static func string(_ value: Any?, _ path: String) throws -> String {
    guard let value = value as? String else { throw shape(path) }
    return value
  }
  private static func strings(_ value: Any?, _ range: ClosedRange<Int>, _ path: String) throws
    -> [String]
  {
    let values = try array(value, range, path)
    let strings = try values.map { try string($0, path) }
    guard Set(strings).count == strings.count else {
      throw invalid("delivery_duplicate_compatibility_value")
    }
    return strings
  }
  private static func safeString(_ value: Any?, _ range: ClosedRange<Int>, _ path: String) throws
    -> String
  {
    let value = try string(value, path)
    guard range.contains(value.count),
      value.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7f })
    else { throw shape(path) }
    return value
  }
  private static func identifier(_ value: Any?, _ path: String) throws -> String {
    let value = try string(value, path)
    guard value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", options: .regularExpression) != nil
    else { throw shape(path) }
    return value
  }
  private static func key(_ value: Any?, _ path: String) throws -> String {
    let value = try string(value, path)
    guard value.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else {
      throw shape(path)
    }
    return value
  }
  private static func environmentKey(_ value: Any?, _ path: String) throws -> String {
    let value = try string(value, path)
    guard value.range(of: "^[a-z][a-z0-9_-]{0,63}$", options: .regularExpression) != nil else {
      throw shape(path)
    }
    return value
  }
  private static func integer(_ value: Any?, _ range: ClosedRange<Int64>, _ path: String) throws
    -> Int64
  {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.rounded() == number.doubleValue, range.contains(number.int64Value)
    else { throw shape(path) }
    return number.int64Value
  }
  private static func timestamp(_ value: Any?, _ path: String) throws -> String {
    let value = try string(value, path)
    guard
      value.range(
        of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
        options: .regularExpression) != nil
    else { throw shape(path) }
    return value
  }
  private static func exact(_ object: [String: Any], _ keys: Set<String>, _ path: String) throws {
    guard Set(object.keys) == keys else { throw shape(path) }
  }
  private static func exactOptional(
    _ object: [String: Any], required: Set<String>, optional: Set<String>, _ path: String
  ) throws {
    let keys = Set(object.keys)
    guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else {
      throw shape(path)
    }
  }
  private static func invalid(_ code: String) -> MosaicConfigurationDeliveryError {
    .invalidRelease(code: code)
  }
  private static func shape(_ path: String) -> MosaicConfigurationDeliveryError {
    .invalidShape(path: path, reason: "unexpected_or_missing_property")
  }
}
