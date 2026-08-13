import Foundation
import XCTest

@testable import MosaicSDK

final class ExperimentTests: XCTestCase {
  func testCanonicalDeliveryV3AndAssignmentFixturesDecodeAtomically() throws {
    let release = try MosaicConfigurationDeliveryDecoder.decode(
      phase5FixtureData("configuration-delivery/v3/experiment-release.json"))
    XCTAssertEqual(release.metadata.id, "release_experiment")
    XCTAssertEqual(release.experimentAssignments.count, 1)
    XCTAssertEqual(
      release.experimentAssignments.first?.experimentVersionId, "experiment_version_checkout_1")
    XCTAssertThrowsError(
      try MosaicConfigurationDeliveryDecoder.decode(
        phase5FixtureData("configuration-delivery/v3/invalid/malformed-allocation.json")))
    XCTAssertThrowsError(
      try MosaicConfigurationDeliveryDecoder.decode(
        phase5FixtureData("configuration-delivery/v3/invalid/unsupported-experiment-contract.json"))
    )

    let running = try MosaicExperimentAssignmentDecoder.decode(
      phase5FixtureData("experiment-assignment/v1/running-ab.json"), environmentMode: .production)
    XCTAssertEqual(running.variants.count, 2)
    XCTAssertThrowsError(
      try MosaicExperimentAssignmentDecoder.decode(
        phase5FixtureData("experiment-assignment/v1/invalid/malformed-allocation.json"),
        environmentMode: .production))
  }

  func testCanonicalBucketsIdentityAndScheduleBoundariesAreExact() throws {
    let vectors = try canonicalBucketVectors()
    for vector in vectors.assignments {
      XCTAssertEqual(
        MosaicExperimentAssignmentEngine.bucket(
          domain: "mosaic-experiment-assignment", values: vector.values),
        vector.bucket, vector.name)
    }
    for vector in vectors.groups {
      XCTAssertEqual(
        MosaicExperimentAssignmentEngine.bucket(
          domain: "mosaic-experiment-group", values: vector.values),
        vector.bucket, vector.name)
    }
    let installationVector = try XCTUnwrap(
      vectors.assignments.first { $0.values.contains("installation_001") })

    let assignment = try assignmentWithoutGroup()
    let identity = MosaicIdentitySnapshot(
      installationID: "installation_001", userID: nil, attributes: [:], generation: 0)
    let start = try XCTUnwrap(
      MosaicExperimentAssignmentDecoder.timestamp(assignment.schedule.startsAt))
    guard
      case .selected(let selected) = MosaicExperimentAssignmentEngine.evaluate(
        assignment, identity: identity, trustedTime: start)
    else { return XCTFail("Inclusive start should select the canonical Treatment.") }
    XCTAssertEqual(selected.variant.id, "variant_treatment_a")
    XCTAssertEqual(selected.bucket, installationVector.bucket)
    XCTAssertEqual(selected.keyType, .installation)

    XCTAssertEqual(
      MosaicExperimentAssignmentEngine.evaluate(
        assignment, identity: identity, trustedTime: nil),
      .normalPlacement(.timeUnreliable))

    let qaData = try phase5FixtureData("experiment-assignment/v1/staging-qa.json")
    let qa = try MosaicExperimentAssignmentDecoder.decode(qaData, environmentMode: .staging)
    let qaIdentity = MosaicIdentitySnapshot(
      installationID: "installation_qa", userID: "customer_42", attributes: [:], generation: 0)
    let qaStart = try XCTUnwrap(
      MosaicExperimentAssignmentDecoder.timestamp("2026-07-26T12:00:00.000Z"))
    guard
      case .selected(let override) = MosaicExperimentAssignmentEngine.evaluate(
        qa, identity: qaIdentity, trustedTime: qaStart,
        qaSelectorDigests: Set(["sha256:" + String(repeating: "a", count: 64)]))
    else { return XCTFail("Valid staging selector should apply the QA override.") }
    XCTAssertEqual(override.source, .qaOverride)
    XCTAssertTrue(override.excludedFromResults)
    let end = try XCTUnwrap(qa.schedule.endsAt.flatMap(MosaicExperimentAssignmentDecoder.timestamp))
    XCTAssertEqual(
      MosaicExperimentAssignmentEngine.evaluate(qa, identity: qaIdentity, trustedTime: end),
      .normalPlacement(.expired))
    XCTAssertThrowsError(
      try MosaicExperimentAssignmentDecoder.decode(qaData, environmentMode: .production))
  }

  func testAnalyticsV2CanonicalExperimentEventsAndAllOrNoneAttribution() throws {
    for fixture in [
      "experiment-assigned.json", "experiment-exposed.json",
      "experiment-fallback-presented.json", "experiment-assignment-failed.json",
      "product-selection-attributed.json", "purchase-started-attributed.json",
    ] {
      XCTAssertNoThrow(
        try MosaicAnalyticsCodec.decodeEvent(
          phase5FixtureData("analytics-event/v2/\(fixture)")), fixture)
    }
    XCTAssertEqual(
      try MosaicAnalyticsCodec.decodeBatch(
        phase5FixtureData("analytics-event/v2/batches/experiment-journey.json")
      )
      .analyticsEventContractVersion,
      "2")
    // Named explicitly: the canonical invalid/ directories also contain
    // `rejection-layers.json` metadata, which is not an event fixture.
    for fixture in [
      "partial-experiment-attribution.json",
      "experiment-exposure-unrelated-correlation.json",
      "experiment-fallback-unrelated-attribution.json",
    ] {
      XCTAssertThrowsError(
        try MosaicAnalyticsCodec.decodeEvent(
          phase5FixtureData("analytics-event/v2/invalid/\(fixture)")), fixture)
    }
  }

  func testPresentationAcknowledgementIsExactlyOncePerRequest() {
    var gate = MosaicPresentationAcknowledgementGate()
    XCTAssertTrue(gate.claim("presentation_1"))
    XCTAssertFalse(gate.claim("presentation_1"))
    XCTAssertTrue(gate.claim("presentation_2"))
    gate.reset()
    XCTAssertTrue(gate.claim("presentation_2"))
  }

  func testAssignmentStoreIsBoundedAndClearsOnlyChangedIdentityMaterial() async throws {
    let persistence = MosaicExperimentMemoryPersistence()
    let store = MosaicExperimentAssignmentStore(persistence: persistence)
    let assignment = try assignmentWithoutGroup()
    let now = Date(timeIntervalSince1970: 1_790_510_400)
    for index in 0..<300 {
      let identity = MosaicIdentitySnapshot(
        installationID: "installation_\(index)", userID: nil, attributes: [:], generation: 0)
      guard
        case .selected(let selection) = MosaicExperimentAssignmentEngine.evaluate(
          assignment, identity: identity, trustedTime: now)
      else { continue }
      await store.record(selection, at: now.addingTimeInterval(TimeInterval(index)))
    }
    var diagnostics = await store.diagnostics()
    XCTAssertEqual(diagnostics.count, 256)
    await store.clearUserBound()
    diagnostics = await store.diagnostics()
    XCTAssertEqual(diagnostics.count, 256)
    await store.clearInstallationBound()
    diagnostics = await store.diagnostics()
    XCTAssertEqual(diagnostics.count, 0)

    let qa = try MosaicExperimentAssignmentDecoder.decode(
      phase5FixtureData("experiment-assignment/v1/staging-qa.json"), environmentMode: .staging)
    let qaIdentity = MosaicIdentitySnapshot(
      installationID: "qa_installation", userID: "qa_user", attributes: [:], generation: 0)
    let qaTime = try XCTUnwrap(
      MosaicExperimentAssignmentDecoder.timestamp("2026-07-26T12:00:00.000Z"))
    guard
      case .selected(let qaSelection) = MosaicExperimentAssignmentEngine.evaluate(
        qa, identity: qaIdentity, trustedTime: qaTime,
        qaSelectorDigests: Set(["sha256:" + String(repeating: "a", count: 64)]))
    else { return XCTFail("Expected QA selection") }
    await store.record(qaSelection, at: qaTime)
    diagnostics = await store.diagnostics()
    XCTAssertEqual(diagnostics.count, 0)

    let completedPersistence = MosaicExperimentMemoryPersistence()
    let completedStore = MosaicExperimentAssignmentStore(persistence: completedPersistence)
    let identity = MosaicIdentitySnapshot(
      installationID: "completed_installation", userID: nil, attributes: [:], generation: 0)
    guard
      case .selected(let completedSelection) = MosaicExperimentAssignmentEngine.evaluate(
        assignment, identity: identity, trustedTime: now)
    else { return XCTFail("Expected deterministic assignment") }
    let expired = now.addingTimeInterval(-181 * 24 * 60 * 60)
    await completedStore.record(completedSelection, at: expired)
    let persistedSource = await completedPersistence.load().first?.source
    XCTAssertEqual(persistedSource, .deterministic)
    await completedStore.reconcile(assignments: [], trustedTime: expired, recordedAt: expired)
    await completedStore.reconcile(assignments: [], trustedTime: now, recordedAt: now)
    let completedDiagnostics = await completedStore.diagnostics()
    XCTAssertEqual(completedDiagnostics.count, 0)
  }

  func testHostedAssignmentRegistrySharesOneActorAndSerializesConcurrentWrites() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "mosaic-experiment-registry-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let registry = MosaicExperimentAssignmentStoreRegistry()
    let baseURL = try XCTUnwrap(URL(string: "https://api.example.test"))
    let first = try await registry.store(
      baseURL: baseURL, publicSDKKey: "public_registry_test", rootDirectory: root)
    let second = try await registry.store(
      baseURL: baseURL, publicSDKKey: "public_registry_test", rootDirectory: root)
    XCTAssertTrue(first === second)

    let assignment = try assignmentWithoutGroup()
    let now = Date(timeIntervalSince1970: 1_790_510_400)
    let identities = ["registry_installation_1", "registry_installation_2"].map {
      MosaicIdentitySnapshot(installationID: $0, userID: nil, attributes: [:], generation: 0)
    }
    let selections = identities.compactMap { identity -> MosaicExperimentSelection? in
      guard
        case .selected(let selection) = MosaicExperimentAssignmentEngine.evaluate(
          assignment, identity: identity, trustedTime: now)
      else { return nil }
      return selection
    }
    XCTAssertEqual(selections.count, 2)
    async let firstWrite: Void = first.record(selections[0], at: now)
    async let secondWrite: Void = second.record(selections[1], at: now)
    _ = await (firstWrite, secondWrite)
    let diagnostics = await first.diagnostics()
    XCTAssertEqual(diagnostics.count, 2)
  }

  private func assignmentWithoutGroup() throws -> MosaicExperimentAssignment {
    let data = try phase5FixtureData("experiment-assignment/v1/running-ab.json")
    var root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    var assignment = try XCTUnwrap(root["assignment"] as? [String: Any])
    assignment.removeValue(forKey: "mutualExclusionGroup")
    var compatibility = try XCTUnwrap(assignment["compatibility"] as? [String: Any])
    let requiredFeatures = try XCTUnwrap(compatibility["requiredFeatures"] as? [String])
    compatibility["requiredFeatures"] = requiredFeatures.filter {
      $0 != "group.mutual_exclusion"
    }
    compatibility["bucketingAlgorithms"] = [mosaicExperimentAssignmentAlgorithm]
    assignment["compatibility"] = compatibility
    root["assignment"] = assignment
    return try MosaicExperimentAssignmentDecoder.decode(
      JSONSerialization.data(withJSONObject: root), environmentMode: .production)
  }
}
