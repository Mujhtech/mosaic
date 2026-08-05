import Foundation
import XCTest

@testable import MosaicSDK

final class PlacementDecisionTests: XCTestCase {
  func testCanonicalEvaluatorCasesPreserveThreeStatePriorityFallbackAndNoPaywall() throws {
    let root = try XCTUnwrap(
      try JSONSerialization.jsonObject(
        with: phase5FixtureData("placement-decision/v1/evaluator-conformance.json"))
        as? [String: Any])
    let decisionData = try JSONSerialization.data(
      withJSONObject: try XCTUnwrap(root["decision"]), options: [.sortedKeys])
    let decision = try JSONDecoder().decode(MosaicPlacementDecision.self, from: decisionData)
    let readiness = ["product_export_pro": MosaicProductReadiness.ready]
    let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
    XCTAssertEqual(cases.count, 34, "The test must exercise every canonical evaluator case.")

    for testCase in cases {
      let name = try XCTUnwrap(testCase["name"] as? String)
      let assignment = try XCTUnwrap(testCase["assignment"] as? [String: Any])
      let assignmentType = try XCTUnwrap(assignment["type"] as? String)
      let assignmentValue = try XCTUnwrap(assignment["value"] as? String)
      let identity = MosaicIdentitySnapshot(
        installationID: assignmentType == "installation" ? assignmentValue : "fixture_installation",
        userID: assignmentType == "identified_user" ? assignmentValue : nil,
        attributes: [:], generation: 0)
      let expected = try XCTUnwrap(testCase["expected"] as? [String: Any])
      let context = try decisionContext(try XCTUnwrap(testCase["context"] as? [String: Any]))

      let result = MosaicPlacementEvaluator.evaluate(
        decision: decision, context: context, identity: identity, productReadiness: readiness)

      XCTAssertEqual(result.matchedRuleID, expected["matchedRuleId"] as? String, name)
      XCTAssertEqual(result.fallbackPath, expected["fallbackPath"] as? [String] ?? [], name)
      XCTAssertEqual(result.outcome, try expectedOutcome(expected), name)
      if let expectedBucket = expected["rolloutBucket"] as? Int {
        XCTAssertEqual(
          result.trace.steps.first(where: { $0.rolloutBucket != nil })?.rolloutBucket,
          expectedBucket,
          name)
      }
    }
  }

  func testMalformedSemanticVersionRemainsUnknownAcrossOperatorsAndNegation() {
    let malformed = "1.2.3+"
    let cases: [(MosaicDecisionOperator, MosaicTypedValue)] = [
      (.equals, .semanticVersion(malformed)),
      (.notEquals, .semanticVersion("1.2.3")),
      (.greaterThan, .semanticVersion("1.2.3")),
      (.greaterThanOrEqual, .semanticVersion("1.2.3")),
      (.lessThan, .semanticVersion("1.2.3")),
      (.lessThanOrEqual, .semanticVersion("1.2.3")),
      (.in, .stringList([malformed, "1.2.3"])),
      (.notIn, .stringList(["1.2.3"])),
    ]

    for (op, operand) in cases {
      let condition = MosaicConditionNode.not(
        .condition(source: .applicationVersion, operator: op, operand: operand))
      let decision = decision(with: condition)
      let result = MosaicPlacementEvaluator.evaluate(
        decision: decision,
        context: MosaicDecisionContext(applicationVersion: malformed),
        identity: MosaicIdentitySnapshot(
          installationID: "installation", userID: nil, attributes: [:], generation: 0),
        productReadiness: [:])

      XCTAssertNil(result.matchedRuleID, op.rawValue)
      XCTAssertEqual(result.outcome, .noPaywall, op.rawValue)
      XCTAssertEqual(result.trace.steps.first?.result, .unknown, op.rawValue)
    }
  }

  /// Catalog lookup recovers the leading language subtag of a tag it cannot
  /// canonicalize; targeting must not. Recovering here would silently retarget a
  /// malformed locale onto a broader language Rule, which is a monetization
  /// decision. The corpus pins the present-but-unknown case but not this
  /// asymmetry, so it is pinned here.
  func testTargetingNeverRecoversTheLanguageSubtagThatCatalogLookupDoes() {
    let unnormalizable = "en-US-verylongsubtag"
    // The asymmetry is only meaningful if the two really do disagree.
    XCTAssertNil(MosaicDeviceLocale.canonicalTag(unnormalizable))
    XCTAssertEqual(MosaicDeviceLocale.catalogTag(unnormalizable), "en")

    let identity = MosaicIdentitySnapshot(
      installationID: "installation", userID: nil, attributes: [:], generation: 0)
    let context = MosaicDecisionContext(applicationLocale: unnormalizable)
    for op in [MosaicDecisionOperator.localeMatches, .equals, .in] {
      let operand: MosaicTypedValue = op == .in ? .stringList(["en", "en-US"]) : .string("en")
      let matching = MosaicPlacementEvaluator.evaluate(
        decision: decision(
          with: .condition(source: .applicationLocale, operator: op, operand: operand)),
        context: context, identity: identity, productReadiness: [:])
      XCTAssertNil(matching.matchedRuleID, op.rawValue)
      XCTAssertEqual(matching.trace.steps.first?.result, .unknown, op.rawValue)
    }

    // Present, though: an unusable locale is not an absent one.
    let exists = MosaicPlacementEvaluator.evaluate(
      decision: decision(
        with: .condition(source: .applicationLocale, operator: .exists, operand: nil)),
      context: context, identity: identity, productReadiness: [:])
    XCTAssertEqual(exists.trace.steps.first?.result, .true)
    let absent = MosaicPlacementEvaluator.evaluate(
      decision: decision(
        with: .condition(source: .applicationLocale, operator: .doesNotExist, operand: nil)),
      context: context, identity: identity, productReadiness: [:])
    XCTAssertEqual(absent.trace.steps.first?.result, .false)
  }

  func testCanonicalRolloutVectorsUseExactUTF8LengthPrefixedBuckets() throws {
    let root = try XCTUnwrap(
      try JSONSerialization.jsonObject(
        with: phase5FixtureData("placement-decision/v1/rollout-vectors.json")) as? [String: Any])
    let vectors = try XCTUnwrap(root["vectors"] as? [[String: Any]])
    for vector in vectors {
      let bucket = MosaicRolloutBucketer.bucket(
        projectID: try XCTUnwrap(vector["projectId"] as? String),
        environmentID: try XCTUnwrap(vector["environmentId"] as? String),
        placementID: try XCTUnwrap(vector["placementId"] as? String),
        ruleID: try XCTUnwrap(vector["ruleId"] as? String),
        assignmentType: try XCTUnwrap(vector["assignmentKeyType"] as? String),
        assignmentValue: try XCTUnwrap(vector["assignmentKeyValue"] as? String))
      XCTAssertEqual(bucket, try XCTUnwrap(vector["bucket"] as? Int))
    }
  }

  func testIdentityPersistsAndUserResetRetainsInstallationWhileInstallationResetRotatesIt()
    async throws
  {
    let persistence = MosaicMemoryIdentityPersistence()
    let first = MosaicIdentityStore(persistence: persistence)
    let initial = await first.snapshot()
    try await first.identify("user_123")
    try await first.replaceAttributes(
      ["student": .boolean(true)],
      definitions: [
        .init(key: "student", type: "boolean", sensitivity: .standard, allowedOperators: [.equals])
      ])
    let reconstructed = MosaicIdentityStore(persistence: persistence)
    let identified = await reconstructed.snapshot()
    XCTAssertEqual(identified.installationID, initial.installationID)
    XCTAssertEqual(identified.userID, "user_123")
    try await reconstructed.resetUser()
    let anonymous = await reconstructed.snapshot()
    XCTAssertEqual(anonymous.installationID, initial.installationID)
    XCTAssertNil(anonymous.userID)
    XCTAssertTrue(anonymous.attributes.isEmpty)
    try await reconstructed.resetInstallation()
    let reset = await reconstructed.snapshot()
    XCTAssertNotEqual(reset.installationID, initial.installationID)
  }
}

private func decision(with condition: MosaicConditionNode) -> MosaicPlacementDecision {
  MosaicPlacementDecision(
    placementDecisionVersion: "1",
    ruleSet: MosaicDecisionRuleSet(
      id: "ruleset", version: 1, projectId: "project", environmentId: "environment",
      environmentKey: "production", placementId: "placement", placementKey: "placement",
      enabled: true, assignmentPolicy: .installation, attributeDefinitions: [], fallbacks: [],
      rules: [
        MosaicDecisionRule(
          id: "malformed_semantic_version", priority: 1, enabled: true, safeLabel: nil,
          conditions: condition, rollout: nil,
          outcome: .paywall(versionID: "unexpected", unavailableFallbackKey: nil))
      ],
      defaultOutcome: .noPaywall, qaOverrides: [],
      compatibility: MosaicDecisionCompatibility(requiredFeatures: [], bucketingAlgorithms: [])))
}

private func decisionContext(_ source: [String: Any]) throws -> MosaicDecisionContext {
  var attributes: [String: MosaicTypedValue] = [:]
  for (key, value) in source["attributes"] as? [String: Any] ?? [:] {
    attributes[key] = try JSONDecoder().decode(
      MosaicTypedValue.self, from: JSONSerialization.data(withJSONObject: value))
  }
  let entitlements = try (source["entitlements"] as? [String: String] ?? [:]).mapValues {
    try XCTUnwrap(MosaicEntitlementDecisionState(rawValue: $0))
  }
  let products = try (source["products"] as? [String: String] ?? [:]).mapValues {
    try XCTUnwrap(MosaicProductDecisionAvailability(rawValue: $0))
  }
  return MosaicDecisionContext(
    platform: source["platform"] as? String,
    applicationVersion: source["applicationVersion"] as? String,
    applicationLocale: source["applicationLocale"] as? String,
    country: source["country"] as? String,
    attributes: attributes,
    entitlements: entitlements,
    products: products)
}

private func expectedOutcome(_ expected: [String: Any]) throws -> MosaicDecisionOutcome {
  try JSONDecoder().decode(
    MosaicDecisionOutcome.self,
    from: JSONSerialization.data(withJSONObject: try XCTUnwrap(expected["outcome"])))
}
