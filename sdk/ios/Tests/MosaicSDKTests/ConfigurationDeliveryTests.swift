import Foundation
import XCTest

@testable import MosaicSDK

final class ConfigurationDeliveryTests: XCTestCase {
  /// A release decodes atomically and resolves a placement to the paywall its
  /// decision names.
  ///
  /// Placement resolution runs through `placementDecisions`: a delivery release
  /// carries decision rule sets rather than the flat placement-to-paywall table
  /// the retired first delivery version used, so `decision(forPlacement:)` is the
  /// lookup that has meaning here.
  func testCanonicalReleaseDecodesAtomicallyAndResolvesPlacement() throws {
    let release = try MosaicConfigurationDeliveryDecoder.decode(deliveryFixtureData())

    XCTAssertEqual(release.metadata.id, "release_rich")
    XCTAssertEqual(release.metadata.environmentKey, "production")
    XCTAssertEqual(release.metadata.environmentMode, .production)
    XCTAssertEqual(release.paywallVersions.count, 1)
    XCTAssertEqual(release.paywallVersions.first?.protocolVersion, mosaicProtocolVersion)
    XCTAssertEqual(release.paywallVersions.first?.document.id, "phase1-complete-paywall")

    let decision = try XCTUnwrap(release.decision(forPlacement: "upgrade_prompt"))
    XCTAssertEqual(
      decision.ruleSet.defaultOutcome,
      .paywall(versionID: "paywall_version_complete", unavailableFallbackKey: nil))
    XCTAssertNil(release.decision(forPlacement: "unknown_placement"))
  }

  func testMalformedAndUnsupportedCanonicalCandidatesAreRejectedAsCompleteReleases() throws {
    for name in [
      "invalid/malformed-release.json",
      "invalid/incomplete-release.json",
      "invalid/unsupported-contract-version.json",
      "invalid/unsupported-paywall-protocol.json",
    ] {
      XCTAssertThrowsError(
        try MosaicConfigurationDeliveryDecoder.decode(deliveryFixtureData(named: name)),
        "Expected \(name) to be rejected atomically."
      )
    }
  }

  func testEveryCanonicalDeliveryReleaseDecodesItsAuthoritativeEnvironmentMode() throws {
    let advanced = try MosaicConfigurationDeliveryDecoder.decode(
      phase5FixtureData("configuration-delivery/v3/advanced-release.json")
    )
    XCTAssertEqual(advanced.projectID, "project_alpha")
    XCTAssertEqual(advanced.placementDecisions.map(\.ruleSet.placementKey), ["export_pdf"])
    XCTAssertEqual(advanced.paywallVersions.count, 3)
    XCTAssertEqual(advanced.productReferences.first?.readiness, .ready)
    XCTAssertEqual(advanced.metadata.environmentMode, .production)

    let noPaywall = try MosaicConfigurationDeliveryDecoder.decode(
      phase5FixtureData("configuration-delivery/v3/no-paywall-release.json")
    )
    XCTAssertTrue(noPaywall.paywallVersions.isEmpty)
    XCTAssertEqual(noPaywall.placementDecisions.first?.ruleSet.defaultOutcome, .noPaywall)
    XCTAssertEqual(noPaywall.metadata.environmentMode, .production)

    let staging = try MosaicConfigurationDeliveryDecoder.decode(
      phase5FixtureData("configuration-delivery/v3/staging-qa-override-release.json")
    )
    XCTAssertEqual(staging.metadata.environmentKey, "staging")
    XCTAssertEqual(staging.metadata.environmentMode, .staging)
    XCTAssertEqual(staging.placementDecisions.first?.ruleSet.qaOverrides.count, 1)
  }

  /// Every fixture in the canonical invalid delivery corpus, read from the
  /// directory rather than from a list copied into this file.
  ///
  /// The list this replaced named thirteen of the twenty-one fixtures on disk,
  /// so eight rejections the corpus declares were never exercised while the test
  /// still claimed "every". A floor keeps a truncated or renamed corpus from
  /// passing as an empty loop.
  func testEveryCanonicalInvalidDeliveryCandidateRejectsAtomically() throws {
    let names = try deliveryFixtureNames(in: "invalid")
    XCTAssertGreaterThanOrEqual(names.count, 21)

    for name in names {
      XCTAssertThrowsError(
        try MosaicConfigurationDeliveryDecoder.decode(
          deliveryFixtureData(named: "invalid/\(name)")
        ), "Expected \(name) to reject the complete candidate")
    }
  }

  func testEveryCanonicalInvalidPlacementDecisionFixtureRejectsStrictValidation() throws {
    for name in [
      "unsupported-operator", "invalid-condition-type", "duplicate-priority", "fallback-cycle",
      "incompatible-source-operator", "missing-unavailable-fallback", "underdeclared-features",
      "overdeclared-features", "qa-override-over-24h",
    ] {
      XCTAssertThrowsError(
        try MosaicConfigurationReleaseDecoder.validateDecisionFixture(
          phase5FixtureData("placement-decision/v1/invalid/\(name).json")
        ), "Expected \(name) to reject standalone Rule Set validation")
    }
  }
}

final class ConfigurationClientTests: XCTestCase {
  func testValid200PersistsAnd304PreservesTheAcceptedReleaseAndETag() async throws {
    let valid = try deliveryFixtureData()
    let transport = QueuedConfigurationTransport(steps: [
      .response(
        status: 200, data: valid, etag: "\"release-one\"", cacheControl: "private, max-age=60"),
      .response(
        status: 304, data: Data(), etag: "\"release-one\"", cacheControl: "private, max-age=60"),
    ])
    let store = MemoryConfigurationStore()
    let client = try makeClient(transport: transport, store: store, fallback: .data(nil))
    await client.bootstrap()

    guard case .updated(let metadata) = await client.refresh() else {
      return XCTFail("Expected a valid 200 release to be accepted.")
    }
    XCTAssertEqual(metadata.id, "release_rich")
    guard case .notModified(let unchanged) = await client.refresh() else {
      return XCTFail("Expected 304 to preserve the accepted release.")
    }
    XCTAssertEqual(unchanged, metadata)
    let requests = await transport.requests()
    XCTAssertEqual(requests.count, 2)
    XCTAssertNil(requests[0].headers["If-None-Match"])
    XCTAssertEqual(requests[1].headers["If-None-Match"], "\"release-one\"")
    XCTAssertEqual(requests[0].headers["Authorization"], "Bearer public_test_key")
    XCTAssertEqual(requests[0].headers["Mosaic-SDK-Platform"], "ios")
    XCTAssertEqual(
      requests[0].headers["Mosaic-Configuration-Versions"], mosaicConfigurationDeliveryVersion)
    XCTAssertEqual(requests[0].headers["Mosaic-Placement-Decision-Versions"], "1")
    XCTAssertEqual(requests[0].headers["Mosaic-Bucketing-Algorithms"], "sha256_length_prefixed_v1")
    XCTAssertEqual(requests[0].headers["Mosaic-Experiment-Assignment-Versions"], "1")
    XCTAssertEqual(
      requests[0].headers["Mosaic-Experiment-Features"],
      mosaicSupportedExperimentFeatures.joined(separator: ","))
    XCTAssertEqual(
      requests[0].headers["Mosaic-Experiment-Bucketing-Algorithms"],
      [mosaicExperimentAssignmentAlgorithm, mosaicExperimentGroupAlgorithm].joined(separator: ","))
    XCTAssertEqual(
      requests[0].headers["Mosaic-Experiment-Schedule-Policies"],
      mosaicExperimentSchedulePolicy)
    XCTAssertEqual(
      requests[0].headers["Mosaic-Paywall-Capabilities"],
      MosaicCapabilityCatalog.current.map { "\($0.rawValue)@\(mosaicProtocolVersion)" }.joined(
        separator: ",")
    )
    let storedRecord = await store.record()
    XCTAssertNotNil(storedRecord)
  }

  func testUnsupportedAndMalformedRefreshesPreserveTheAcceptedReleaseOffline() async throws {
    let invalidNames = [
      "unsupported-operator", "invalid-condition-type", "duplicate-priority", "fallback-cycle",
      "incompatible-source-operator", "missing-unavailable-fallback", "underdeclared-features",
      "overdeclared-features", "release-underdeclared-compatibility",
      "release-overdeclared-compatibility", "qa-override-over-24h",
      "production-qa-override", "invalid-environment-mode",
    ]
    let invalidSteps: [QueuedConfigurationTransport.Step] = try invalidNames.enumerated().map {
      index, name in
      .response(
        status: 200,
        data: try phase5FixtureData("configuration-delivery/v3/invalid/\(name).json"),
        etag: "\"invalid-\(index)\"", cacheControl: nil)
    }
    let transport = QueuedConfigurationTransport(
      steps: [
        .response(
          status: 200,
          data: try phase5FixtureData("configuration-delivery/v3/advanced-release.json"),
          etag: "\"phase-five\"", cacheControl: nil)
      ] + invalidSteps)
    let client = try makeClient(
      transport: transport, store: MemoryConfigurationStore(), fallback: .data(nil))
    await client.bootstrap()
    guard case .updated = await client.refresh() else { return XCTFail("Expected v2 acceptance") }
    for name in invalidNames {
      guard case .preserved = await client.refresh() else {
        return XCTFail("Expected \(name) to preserve the LKG")
      }
    }
    let identity = MosaicIdentitySnapshot(
      installationID: "install_01", userID: nil, attributes: [:], generation: 0)
    let context = MosaicDecisionContext(
      platform: "ios", applicationVersion: "2.10.0", applicationLocale: "en-US",
      entitlements: ["pro": .inactive], products: ["product_export_pro": .available])
    guard
      case .paywallSelected(_, let versionID, let ruleID, _, _, let source, _) =
        await client.decide(placement: "export_pdf", context: context, identity: identity)
    else { return XCTFail("Expected cached local decision") }
    XCTAssertEqual(versionID, "paywall_version_ios")
    XCTAssertEqual(ruleID, "rule_ios_rollout")
    XCTAssertEqual(source, .remote)

    let fallbackEvaluation = await client.decideForPresentation(
      placement: "export_pdf",
      context: MosaicDecisionContext(
        platform: "ios", applicationVersion: "2.10.0", applicationLocale: "en-US",
        entitlements: ["pro": .unknown], products: ["product_export_pro": .unavailable]),
      identity: identity)
    guard
      case .paywallSelected(_, let fallbackVersionID, _, let fallbackPath, _, _, _) =
        fallbackEvaluation.result
    else { return XCTFail("Expected the exact Product-unavailable fallback") }
    XCTAssertEqual(fallbackVersionID, "paywall_version_fallback")
    XCTAssertEqual(fallbackPath, ["product_unavailable"])
    XCTAssertEqual(
      fallbackEvaluation.fallbackUses,
      [.init(trigger: "product_unavailable", key: "product_unavailable")])
  }

  func testMalformedAndUnsupportedRefreshesPreserveThePreviousCompleteRelease() async throws {
    let transport = QueuedConfigurationTransport(steps: [
      .response(
        status: 200,
        data: try deliveryFixtureData(),
        etag: "\"release-one\"",
        cacheControl: nil
      ),
      .response(
        status: 200,
        data: try deliveryFixtureData(named: "invalid/malformed-release.json"),
        etag: "\"release-two\"",
        cacheControl: nil
      ),
      .response(
        status: 200,
        data: try deliveryFixtureData(named: "invalid/unsupported-paywall-protocol.json"),
        etag: "\"release-three\"",
        cacheControl: nil
      ),
    ])
    let store = MemoryConfigurationStore()
    let client = try makeClient(transport: transport, store: store, fallback: .data(nil))
    await client.bootstrap()
    _ = await client.refresh()

    guard case .preserved(let malformedMetadata, _, _) = await client.refresh() else {
      return XCTFail("Malformed refresh must preserve the previous release.")
    }
    guard case .preserved(let unsupportedMetadata, _, _) = await client.refresh() else {
      return XCTFail("Unsupported refresh must preserve the previous release.")
    }
    XCTAssertEqual(malformedMetadata.id, "release_rich")
    XCTAssertEqual(unsupportedMetadata.id, "release_rich")
    guard
      case .paywallSelected(let document, _, _, _, let release, _, _) =
        await client.decide(
          placement: "upgrade_prompt", context: deliveryDecisionContext(),
          identity: deliveryIdentity())
    else { return XCTFail("The last known valid Placement should remain resolvable.") }
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(release.id, "release_rich")
  }

  func testFailedRefreshPreservesAFileCacheAcrossClientReconstruction() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let baseURL = try XCTUnwrap(URL(string: "https://mosaic.example"))
    let firstStore = try MosaicConfigurationFileStore(
      baseURL: baseURL,
      publicSDKKey: "public_test_key",
      rootDirectory: root
    )
    let first = MosaicConfigurationClient(
      publicSDKKey: "public_test_key",
      baseURL: baseURL,
      applicationVersion: "1.0.0",
      requestTimeout: 5,
      bundledFallback: .data(nil),
      transport: QueuedConfigurationTransport(steps: [
        .response(
          status: 200,
          data: try deliveryFixtureData(),
          etag: "\"release-one\"",
          cacheControl: nil
        )
      ]),
      store: firstStore
    )
    await first.bootstrap()
    _ = await first.refresh()

    let reconstructed = MosaicConfigurationClient(
      publicSDKKey: "public_test_key",
      baseURL: baseURL,
      applicationVersion: "1.0.0",
      requestTimeout: 5,
      bundledFallback: .data(nil),
      transport: QueuedConfigurationTransport(steps: [.failure]),
      store: try MosaicConfigurationFileStore(
        baseURL: baseURL,
        publicSDKKey: "public_test_key",
        rootDirectory: root
      )
    )
    await reconstructed.bootstrap()
    guard case .preserved(let metadata, let source, _) = await reconstructed.refresh() else {
      return XCTFail("A network failure must preserve the reconstructed cache.")
    }
    XCTAssertEqual(metadata.id, "release_rich")
    XCTAssertEqual(source, .cache)
  }

  func testBundledFallbackAndExplicitUnavailableResolution() async throws {
    let bundled = try makeClient(
      transport: QueuedConfigurationTransport(steps: []),
      store: MemoryConfigurationStore(),
      fallback: .data(try deliveryFixtureData())
    )
    await bundled.bootstrap()
    guard
      case .paywallSelected(_, _, _, _, _, let source, _) =
        await bundled.decide(
          placement: "upgrade_prompt", context: deliveryDecisionContext(),
          identity: deliveryIdentity())
    else { return XCTFail("Expected the complete bundled release to resolve its Placement.") }
    XCTAssertEqual(source, .bundled)

    let unavailable = try makeClient(
      transport: QueuedConfigurationTransport(steps: []),
      store: MemoryConfigurationStore(),
      fallback: .data(nil)
    )
    await unavailable.bootstrap()
    guard
      case .configurationUnavailable(let diagnostics) =
        await unavailable.decide(
          placement: "upgrade_prompt", context: deliveryDecisionContext(),
          identity: deliveryIdentity())
    else { return XCTFail("Expected explicit unavailable without cache or bundle.") }
    XCTAssertEqual(diagnostics.last?.code, "delivery_configuration_unavailable")
  }

  func testConcurrentRefreshesCoalesceIntoOneTransportRequest() async throws {
    let transport = QueuedConfigurationTransport(
      steps: [
        .response(
          status: 200,
          data: try deliveryFixtureData(),
          etag: "\"release-one\"",
          cacheControl: nil
        )
      ],
      delayNanoseconds: 50_000_000
    )
    let client = try makeClient(
      transport: transport,
      store: MemoryConfigurationStore(),
      fallback: .data(nil)
    )
    await client.bootstrap()

    async let first = client.refresh()
    async let second = client.refresh()
    async let third = client.refresh()
    _ = await (first, second, third)

    let requestCount = await transport.requests().count
    XCTAssertEqual(requestCount, 1)
  }

  func testRemoteReleaseMayReplaceASyntheticBundledEnvironment() async throws {
    let client = try makeClient(
      transport: QueuedConfigurationTransport(steps: [
        .response(
          status: 200,
          data: try deliveryFixtureData(),
          etag: "\"release-one\"",
          cacheControl: nil
        )
      ]),
      store: MemoryConfigurationStore(),
      fallback: .data(try releaseData(environmentID: "environment_bundle"))
    )
    await client.bootstrap()

    guard case .updated(let metadata) = await client.refresh() else {
      return XCTFail("A hosted release must replace a synthetic bundled Environment.")
    }
    XCTAssertEqual(metadata.environmentID, "environment_production")
  }

  func testOlderAndCrossEnvironmentResponsesPreserveTheAcceptedHostedRelease() async throws {
    let transport = QueuedConfigurationTransport(steps: [
      // Accepted first because it carries the highest release number.
      .response(
        status: 200,
        data: try deliveryFixtureData(),
        etag: "\"release-three\"",
        cacheControl: nil
      ),
      // An older release number, so it is stale rather than a replacement.
      .response(
        status: 200,
        data: try deliveryFixtureData(named: "advanced-release.json"),
        etag: "\"release-one\"",
        cacheControl: nil
      ),
      .response(
        status: 200,
        data: try releaseData(environmentID: "environment_other"),
        etag: "\"release-four\"",
        cacheControl: nil
      ),
    ])
    let store = MemoryConfigurationStore()
    let client = try makeClient(transport: transport, store: store, fallback: .data(nil))
    await client.bootstrap()
    guard case .updated(let accepted) = await client.refresh() else {
      return XCTFail("Expected the release-three fixture to be accepted.")
    }

    guard case .preserved(let afterStale, _, let staleDiagnostic) = await client.refresh() else {
      return XCTFail("An older release must preserve the current release.")
    }
    XCTAssertEqual(afterStale, accepted)
    XCTAssertEqual(staleDiagnostic.code, "delivery_release_stale")

    guard
      case .preserved(let afterCrossEnvironment, _, let environmentDiagnostic) =
        await client.refresh()
    else {
      return XCTFail("A cross-Environment response must preserve the current release.")
    }
    XCTAssertEqual(afterCrossEnvironment, accepted)
    XCTAssertEqual(environmentDiagnostic.code, "delivery_environment_mismatch")
    let saveCount = await store.saveCount()
    XCTAssertEqual(saveCount, 1)
  }

  private func makeClient(
    transport: any MosaicConfigurationTransport,
    store: any MosaicConfigurationCacheStore,
    fallback: MosaicConfigurationBundledFallback
  ) throws -> MosaicConfigurationClient {
    MosaicConfigurationClient(
      publicSDKKey: "public_test_key",
      baseURL: try XCTUnwrap(URL(string: "https://mosaic.example")),
      applicationVersion: "1.0.0",
      requestTimeout: 5,
      bundledFallback: fallback,
      transport: transport,
      store: store,
      clock: { Date(timeIntervalSince1970: 1_768_953_600) }
    )
  }
}

/// The decision inputs these delivery tests share. Placement resolution runs
/// through the decision evaluator, which needs a context and an identity.
private func deliveryDecisionContext() -> MosaicDecisionContext {
  MosaicDecisionContext(
    platform: "ios", applicationVersion: "2.10.0", applicationLocale: "en-US",
    entitlements: [:],
    // The canonical release's paywall references all three products, and a
    // decision withholds a paywall whose commerce is unavailable.
    products: [
      "mosaic_pro_monthly": .available,
      "mosaic_pro_yearly": .available,
      "mosaic_pro_lifetime": .available,
    ])
}

private func deliveryIdentity() -> MosaicIdentitySnapshot {
  MosaicIdentitySnapshot(
    installationID: "install_01", userID: nil, attributes: [:], generation: 0)
}

private func releaseData(environmentID: String) throws -> Data {
  let raw = try JSONSerialization.jsonObject(with: deliveryFixtureData())
  var envelope = try XCTUnwrap(raw as? [String: Any])
  var release = try XCTUnwrap(envelope["release"] as? [String: Any])
  var environment = try XCTUnwrap(release["environment"] as? [String: Any])
  environment["id"] = environmentID
  release["environment"] = environment
  // A decision rule set names the Environment it was published for, so moving
  // the release without moving them would make the candidate internally
  // inconsistent and be rejected as a broken reference rather than as the
  // cross-Environment response this exercises.
  if let decisions = release["placementDecisions"] as? [[String: Any]] {
    release["placementDecisions"] = try decisions.map { envelope -> [String: Any] in
      var envelope = envelope
      var ruleSet = try XCTUnwrap(envelope["ruleSet"] as? [String: Any])
      ruleSet["environmentId"] = environmentID
      envelope["ruleSet"] = ruleSet
      return envelope
    }
  }
  release.removeValue(forKey: "contentDigest")
  release["contentDigest"] = try DeliveryCanonicalJSON.digest(release)
  envelope["release"] = release
  return try JSONSerialization.data(withJSONObject: envelope)
}

private actor MemoryConfigurationStore: MosaicConfigurationCacheStore {
  private var value: MosaicConfigurationCacheRecord?
  private var saves = 0

  func load() -> MosaicConfigurationCacheRecord? { value }
  func save(_ record: MosaicConfigurationCacheRecord) {
    saves += 1
    value = record
  }
  func record() -> MosaicConfigurationCacheRecord? { value }
  func saveCount() -> Int { saves }
}

private actor QueuedConfigurationTransport: MosaicConfigurationTransport {
  enum Step: Sendable {
    case response(status: Int, data: Data, etag: String?, cacheControl: String?)
    case failure
  }

  private var steps: [Step]
  private var capturedRequests: [MosaicConfigurationHTTPRequest] = []
  private let delayNanoseconds: UInt64

  init(steps: [Step], delayNanoseconds: UInt64 = 0) {
    self.steps = steps
    self.delayNanoseconds = delayNanoseconds
  }

  func fetch(_ request: MosaicConfigurationHTTPRequest) async throws
    -> MosaicConfigurationHTTPResponse
  {
    capturedRequests.append(request)
    if delayNanoseconds > 0 { try await Task.sleep(nanoseconds: delayNanoseconds) }
    guard !steps.isEmpty else { throw URLError(.cannotLoadFromNetwork) }
    switch steps.removeFirst() {
    case .failure:
      throw URLError(.cannotLoadFromNetwork)
    case .response(let status, let data, let etag, let cacheControl):
      return MosaicConfigurationHTTPResponse(
        statusCode: status,
        data: data,
        etag: etag,
        cacheControl: cacheControl
      )
    }
  }

  func requests() -> [MosaicConfigurationHTTPRequest] { capturedRequests }
}
