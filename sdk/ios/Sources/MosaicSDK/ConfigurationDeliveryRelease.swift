import Foundation

enum MosaicConfigurationDeliveryV3Decoder {
  private static let supportedFeatures = Set(mosaicSupportedExperimentFeatures)
  private static let supportedAlgorithms: Set<String> = [
    mosaicExperimentAssignmentAlgorithm, mosaicExperimentGroupAlgorithm,
  ]

  static func decode(root: [String: Any]) throws -> MosaicConfigurationRelease {
    let release = try DeliveryValue.object(root["release"], path: "$.release")
    try DeliveryValue.exactKeys(
      release,
      expected: [
        "id", "number", "projectId", "environment", "publishedAt", "contentDigest",
        "compatibility", "placementDecisions", "paywallVersions", "productReferences",
        "entitlementReferences", "assetReferences", "experimentAssignments",
      ], path: "$.release")
    let digest = try DeliveryValue.digest(release["contentDigest"], path: "$.release.contentDigest")
    var material = release
    material.removeValue(forKey: "contentDigest")
    guard digest == (try DeliveryCanonicalJSON.digest(material)) else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_release_digest_mismatch")
    }

    let environment = try DeliveryValue.object(
      release["environment"], path: "$.release.environment")
    let modeValue = try DeliveryValue.string(
      environment["mode"], path: "$.release.environment.mode")
    guard let environmentMode = MosaicEnvironmentMode(rawValue: modeValue) else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_invalid_environment_mode")
    }
    let assignmentObjects = try DeliveryValue.array(
      release["experimentAssignments"], count: 0...128, path: "$.release.experimentAssignments")
    let assignments = try assignmentObjects.enumerated().map { index, raw in
      let object = try DeliveryValue.object(raw, path: "$.release.experimentAssignments[\(index)]")
      return try MosaicExperimentAssignmentDecoder.decodeAssignment(
        object, environmentMode: environmentMode)
    }

    let compatibility = try decodeCompatibility(release["compatibility"])
    let derivedFeatures = Set(assignments.flatMap { $0.compatibility.requiredFeatures })
    let derivedAlgorithms = Set(assignments.flatMap { $0.compatibility.bucketingAlgorithms })
    let derivedPolicies = Set(assignments.flatMap { $0.compatibility.schedulePolicies })
    guard compatibility.features == derivedFeatures,
      compatibility.algorithms == derivedAlgorithms,
      compatibility.schedulePolicies == derivedPolicies
    else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_experiment_compatibility_mismatch")
    }

    var projectedRelease = release
    projectedRelease.removeValue(forKey: "experimentAssignments")
    var projectedCompatibility = try DeliveryValue.object(
      projectedRelease["compatibility"], path: "$.release.compatibility")
    projectedCompatibility.removeValue(forKey: "experimentAssignmentContracts")
    projectedRelease["compatibility"] = projectedCompatibility
    // The authoritative digest was verified above, over the bytes the server
    // signed. The projected body is this process's own construction, so it
    // carries no digest and none is re-derived for it.
    projectedRelease.removeValue(forKey: "contentDigest")
    var base = try MosaicConfigurationReleaseDecoder.decode(
      release: projectedRelease, contentDigest: digest,
      allowUnreferencedExperimentMaterial: true)
    try validateReferences(assignments, release: base)
    base = MosaicConfigurationRelease(
      metadata: .init(
        id: base.metadata.id, number: base.metadata.number,
        environmentID: base.metadata.environmentID, environmentKey: base.metadata.environmentKey,
        environmentMode: base.metadata.environmentMode, publishedAt: base.metadata.publishedAt,
        contentDigest: digest),
      projectID: base.projectID, placementDecisions: base.placementDecisions,
      paywallVersions: base.paywallVersions,
      productReferences: base.productReferences, entitlementReferences: base.entitlementReferences,
      assetReferences: base.assetReferences, experimentAssignments: assignments)
    return base
  }

  private struct Compatibility {
    let features: Set<String>
    let algorithms: Set<String>
    let schedulePolicies: Set<String>
  }

  private static func decodeCompatibility(_ raw: Any?) throws -> Compatibility {
    let object = try DeliveryValue.object(raw, path: "$.release.compatibility")
    try DeliveryValue.exactKeys(
      object,
      expected: [
        "placementDecisionContracts", "paywallProtocols", "acceptance",
        "experimentAssignmentContracts",
      ],
      path: "$.release.compatibility")
    guard let contracts = object["experimentAssignmentContracts"] as? [[String: Any]],
      contracts.count <= 1
    else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_invalid_experiment_compatibility")
    }
    guard let contract = contracts.first else {
      return .init(features: [], algorithms: [], schedulePolicies: [])
    }
    try DeliveryValue.exactKeys(
      contract,
      expected: ["version", "requiredFeatures", "bucketingAlgorithms", "schedulePolicies"],
      path: "$.release.compatibility.experimentAssignmentContracts[0]")
    let version = try DeliveryValue.string(contract["version"], path: "experiment.version")
    guard version == "1" else {
      throw MosaicConfigurationDeliveryError.unsupportedExperimentContract(version)
    }
    let features = Set(try strings(contract["requiredFeatures"], maximum: 8))
    if let unsupported = features.subtracting(supportedFeatures).first {
      throw MosaicConfigurationDeliveryError.unsupportedExperimentFeature(unsupported)
    }
    let algorithms = Set(try strings(contract["bucketingAlgorithms"], maximum: 2))
    if let unsupported = algorithms.subtracting(supportedAlgorithms).first {
      throw MosaicConfigurationDeliveryError.unsupportedBucketingAlgorithm(unsupported)
    }
    let policies = Set(try strings(contract["schedulePolicies"], maximum: 1))
    if let unsupported = policies.subtracting([mosaicExperimentSchedulePolicy]).first {
      throw MosaicConfigurationDeliveryError.unsupportedExperimentSchedulePolicy(unsupported)
    }
    return .init(features: features, algorithms: algorithms, schedulePolicies: policies)
  }

  private static func strings(_ raw: Any?, maximum: Int) throws -> [String] {
    guard let values = raw as? [String], values.count <= maximum,
      Set(values).count == values.count
    else {
      throw MosaicConfigurationDeliveryError.invalidRelease(
        code: "delivery_invalid_experiment_compatibility")
    }
    return values
  }

  private static func validateReferences(
    _ assignments: [MosaicExperimentAssignment], release: MosaicConfigurationRelease
  ) throws {
    guard Set(assignments.map(\.experimentId)).count == assignments.count,
      Set(assignments.map(\.experimentVersionId)).count == assignments.count
    else {
      throw MosaicConfigurationDeliveryError.invalidRelease(code: "delivery_duplicate_experiment")
    }
    let paywalls = Dictionary(uniqueKeysWithValues: release.paywallVersions.map { ($0.id, $0) })
    let products = Set(release.productReferences.map(\.id))
    let placements = Dictionary(
      uniqueKeysWithValues: release.placementDecisions.map { ($0.ruleSet.placementId, $0) })
    for assignment in assignments {
      guard assignment.projectId == release.projectID,
        assignment.environmentId == release.metadata.environmentID,
        placements[assignment.placementId] != nil,
        paywalls[assignment.controlPaywallVersionId] != nil
      else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_experiment_reference_mismatch")
      }
      if let decision = placements[assignment.placementId] {
        let outcomes =
          [decision.ruleSet.defaultOutcome]
          + decision.ruleSet.rules.map(\.outcome)
          + decision.ruleSet.fallbacks.map(\.outcome)
          + decision.ruleSet.qaOverrides.map(\.outcome)
        guard
          outcomes.contains(where: {
            if case .paywall(let versionID, _) = $0 {
              return versionID == assignment.controlPaywallVersionId
            }
            return false
          })
        else {
          throw MosaicConfigurationDeliveryError.invalidRelease(
            code: "delivery_experiment_control_anchor_mismatch")
        }
      }
      for variant in assignment.variants {
        guard let paywall = paywalls[variant.paywallVersionId],
          paywall.paywallID == variant.paywallId,
          Set(variant.compatibility.requiredProductIds) == Set(paywall.productReferenceIDs),
          Set(variant.compatibility.requiredProductIds).isSubset(of: products)
        else {
          throw MosaicConfigurationDeliveryError.invalidRelease(
            code: "delivery_experiment_variant_reference_mismatch")
        }
      }
    }
    let groups = Dictionary(
      grouping: assignments.compactMap(\.mutualExclusionGroup), by: { $0.id + "\n" + $0.versionId })
    for snapshots in groups.values {
      guard let first = snapshots.first, snapshots.allSatisfy({ $0 == first }) else {
        throw MosaicConfigurationDeliveryError.invalidRelease(
          code: "delivery_experiment_group_snapshot_mismatch")
      }
    }
  }
}
