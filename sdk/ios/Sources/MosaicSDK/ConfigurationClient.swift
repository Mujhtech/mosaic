import Foundation

public enum MosaicConfigurationSource: String, Sendable, Equatable {
  case remote
  case cache
  case bundled
}

public enum MosaicConfigurationBundledFallback: Sendable, Equatable {
  case packaged
  case data(Data?)
}

public enum MosaicConfigurationStatus: Sendable, Equatable {
  case available(
    metadata: MosaicConfigurationReleaseMetadata,
    source: MosaicConfigurationSource,
    diagnostics: [MosaicDiagnostic]
  )
  case unavailable(diagnostics: [MosaicDiagnostic])
}

public enum MosaicConfigurationRefreshResult: Sendable, Equatable {
  case updated(metadata: MosaicConfigurationReleaseMetadata)
  case notModified(metadata: MosaicConfigurationReleaseMetadata)
  case skippedFresh(metadata: MosaicConfigurationReleaseMetadata)
  case preserved(
    metadata: MosaicConfigurationReleaseMetadata,
    source: MosaicConfigurationSource,
    diagnostic: MosaicDiagnostic
  )
  case unavailable(diagnostics: [MosaicDiagnostic])
}

public enum MosaicPlacementResolution: Sendable, Equatable {
  case resolved(
    document: MosaicPaywallDocument,
    paywallVersionID: String,
    release: MosaicConfigurationReleaseMetadata,
    source: MosaicConfigurationSource
  )
  case unavailable(diagnostics: [MosaicDiagnostic])
}

struct MosaicDecisionRequirements: Sendable {
  let productIDs: [String]
  let entitlementKeys: [String]
}

actor MosaicConfigurationClient {
  private struct AcceptedRelease: Sendable {
    let release: MosaicConfigurationRelease
    let source: MosaicConfigurationSource
    let data: Data
    let etag: String?
    let refreshAfter: Date
  }

  private let publicSDKKey: String
  private let configurationURL: URL
  private let applicationVersion: String?
  private let requestTimeout: TimeInterval
  private let transport: any MosaicConfigurationTransport
  private let store: any MosaicConfigurationCacheStore
  private let bundledFallback: MosaicConfigurationBundledFallback
  private let clock: @Sendable () -> Date

  private var accepted: AcceptedRelease?
  private var diagnostics: [MosaicDiagnostic] = []
  private var inFlightRefresh: (id: Int, task: Task<MosaicConfigurationRefreshResult, Never>)?
  private var refreshSequence = 0

  init(
    publicSDKKey: String,
    baseURL: URL,
    applicationVersion: String?,
    requestTimeout: TimeInterval,
    bundledFallback: MosaicConfigurationBundledFallback,
    transport: any MosaicConfigurationTransport,
    store: any MosaicConfigurationCacheStore,
    clock: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.publicSDKKey = publicSDKKey
    configurationURL =
      baseURL
      .appendingPathComponent("v1", isDirectory: true)
      .appendingPathComponent("sdk", isDirectory: true)
      .appendingPathComponent("configuration", isDirectory: false)
    self.applicationVersion = applicationVersion
    self.requestTimeout = requestTimeout
    self.bundledFallback = bundledFallback
    self.transport = transport
    self.store = store
    self.clock = clock
  }

  func bootstrap() async {
    do {
      if let record = try await store.load() {
        do {
          let release = try MosaicConfigurationDeliveryDecoder.decode(record.releaseData)
          accepted = AcceptedRelease(
            release: release,
            source: .cache,
            data: record.releaseData,
            etag: record.etag,
            refreshAfter: record.refreshAfter
          )
        } catch {
          recordDiagnostic(
            code: deliveryCode(error, fallback: "delivery_cached_release_rejected"), stage: .cache)
        }
      }
    } catch {
      recordDiagnostic(code: "delivery_cache_read_failed", stage: .cache)
    }
    if accepted == nil {
      loadBundledFallback()
    }
  }

  func status() -> MosaicConfigurationStatus {
    guard let accepted else { return .unavailable(diagnostics: diagnostics) }
    return .available(
      metadata: accepted.release.metadata,
      source: accepted.source,
      diagnostics: diagnostics
    )
  }

  func resolve(placement key: String) -> MosaicPlacementResolution {
    guard key.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else {
      let diagnostic = MosaicDiagnostic(code: "delivery_invalid_placement", stage: .placement)
      recordDiagnostic(diagnostic)
      return .unavailable(diagnostics: diagnostics)
    }
    guard let accepted else {
      let diagnostic = MosaicDiagnostic(
        code: "delivery_configuration_unavailable", stage: .placement)
      recordDiagnostic(diagnostic)
      return .unavailable(diagnostics: diagnostics)
    }
    guard let paywall = accepted.release.paywall(forPlacement: key) else {
      let diagnostic = MosaicDiagnostic(code: "delivery_placement_unavailable", stage: .placement)
      recordDiagnostic(diagnostic)
      return .unavailable(diagnostics: diagnostics)
    }
    return .resolved(
      document: paywall.document,
      paywallVersionID: paywall.id,
      release: accepted.release.metadata,
      source: accepted.source
    )
  }

  func decisionRequirements(placement key: String) -> MosaicDecisionRequirements {
    guard let release = accepted?.release, let decision = release.decision(forPlacement: key) else {
      return .init(productIDs: [], entitlementKeys: [])
    }
    var products = Set<String>()
    var entitlements = Set<String>()
    func inspect(_ node: MosaicConditionNode) {
      switch node {
      case .condition(let source, _, _):
        switch source {
        case .productAvailability(let id), .productReadiness(let id): products.insert(id)
        case .entitlementState(let key): entitlements.insert(key)
        default: break
        }
      case .all(let children), .any(let children):
        for child in children { inspect(child) }
      case .not(let child): inspect(child)
      }
    }
    for rule in decision.ruleSet.rules { inspect(rule.conditions) }
    let paywallIDs = Set(
      ([decision.ruleSet.defaultOutcome]
        + decision.ruleSet.rules.map(\.outcome)
        + decision.ruleSet.fallbacks.map(\.outcome)
        + decision.ruleSet.qaOverrides.map(\.outcome)).compactMap { outcome in
          if case .paywall(let id, _) = outcome { return id }
          return nil
        }
    )
    for paywall in release.paywallVersions where paywallIDs.contains(paywall.id) {
      products.formUnion(paywall.productReferenceIDs)
    }
    return .init(productIDs: products.sorted(), entitlementKeys: entitlements.sorted())
  }

  func attributeDefinitions() -> [MosaicAttributeDefinition]? {
    guard let release = accepted?.release, !release.placementDecisions.isEmpty else { return nil }
    var byKey: [String: MosaicAttributeDefinition] = [:]
    for definition in release.placementDecisions.flatMap({ $0.ruleSet.attributeDefinitions }) {
      if let existing = byKey[definition.key], existing != definition { return [] }
      byKey[definition.key] = definition
    }
    return byKey.values.sorted { $0.key < $1.key }
  }

  func decide(
    placement key: String, context: MosaicDecisionContext, identity: MosaicIdentitySnapshot
  ) -> MosaicPlacementDecisionResult {
    guard key.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else {
      let diagnostic = MosaicDiagnostic(code: "delivery_invalid_placement", stage: .placement)
      recordDiagnostic(diagnostic)
      return .placementUnavailable(diagnostics: diagnostics)
    }
    guard let accepted else {
      let diagnostic = MosaicDiagnostic(
        code: "delivery_configuration_unavailable", stage: .placement)
      recordDiagnostic(diagnostic)
      return .configurationUnavailable(diagnostics: diagnostics)
    }
    guard let decision = accepted.release.decision(forPlacement: key) else {
      if let paywall = accepted.release.paywall(forPlacement: key) {
        return .paywallSelected(
          document: paywall.document, paywallVersionID: paywall.id, matchedRuleID: nil,
          fallbackPath: [], release: accepted.release.metadata, source: accepted.source,
          trace: .init(steps: [
            .init(
              code: "legacy_binding_selected", ruleID: nil, safeLabel: nil, result: nil,
              assignmentType: nil, rolloutBucket: nil, fallbackKey: nil)
          ]))
      }
      let diagnostic = MosaicDiagnostic(code: "delivery_placement_unavailable", stage: .placement)
      recordDiagnostic(diagnostic)
      return .placementUnavailable(diagnostics: diagnostics)
    }
    let readiness = Dictionary(
      uniqueKeysWithValues: accepted.release.productReferences.map { ($0.id, $0.readiness) })
    let output = MosaicPlacementEvaluator.evaluate(
      decision: decision, context: context, identity: identity, productReadiness: readiness)
    switch output.outcome {
    case .paywall:
      let resolution = resolveAvailablePaywall(
        output.outcome, decision: decision, release: accepted.release, context: context,
        matchedRuleID: output.matchedRuleID, initialPath: output.fallbackPath,
        initialTrace: output.trace)
      switch resolution.outcome {
      case .paywall(let versionID, _):
        guard let paywall = resolution.paywall else {
          let diagnostic = MosaicDiagnostic(code: "decision_content_unavailable", stage: .placement)
          recordDiagnostic(diagnostic)
          return .evaluationFailed(diagnostics: diagnostics)
        }
        return .paywallSelected(
          document: paywall.document, paywallVersionID: versionID,
          matchedRuleID: output.matchedRuleID,
          fallbackPath: resolution.path, release: accepted.release.metadata,
          source: accepted.source,
          trace: resolution.trace)
      case .noPaywall:
        return .noPaywall(
          matchedRuleID: output.matchedRuleID, release: accepted.release.metadata,
          source: accepted.source, trace: resolution.trace)
      case .unavailable(let reason):
        let diagnostic = MosaicDiagnostic(code: "decision_\(reason)", stage: .placement)
        recordDiagnostic(diagnostic)
        return .placementUnavailable(diagnostics: diagnostics)
      case .fallback:
        let diagnostic = MosaicDiagnostic(code: "decision_fallback_unresolved", stage: .placement)
        recordDiagnostic(diagnostic)
        return .evaluationFailed(diagnostics: diagnostics)
      }
    case .noPaywall:
      return .noPaywall(
        matchedRuleID: output.matchedRuleID, release: accepted.release.metadata,
        source: accepted.source, trace: output.trace)
    case .unavailable(let reason):
      let diagnostic = MosaicDiagnostic(code: "decision_\(reason)", stage: .placement)
      recordDiagnostic(diagnostic)
      return .placementUnavailable(diagnostics: diagnostics)
    case .fallback:
      let diagnostic = MosaicDiagnostic(code: "decision_fallback_unresolved", stage: .placement)
      recordDiagnostic(diagnostic)
      return .evaluationFailed(diagnostics: diagnostics)
    }
  }

  private struct AvailablePaywallResolution {
    let outcome: MosaicDecisionOutcome
    let paywall: MosaicConfigurationPaywallVersion?
    let path: [String]
    let trace: MosaicDecisionTrace
  }

  private func resolveAvailablePaywall(
    _ outcome: MosaicDecisionOutcome, decision: MosaicPlacementDecision,
    release: MosaicConfigurationRelease, context: MosaicDecisionContext, matchedRuleID: String?,
    initialPath: [String], initialTrace: MosaicDecisionTrace
  ) -> AvailablePaywallResolution {
    let fallbacks = Dictionary(
      uniqueKeysWithValues: decision.ruleSet.fallbacks.map { ($0.key, $0) })
    let readiness = Dictionary(
      uniqueKeysWithValues: release.productReferences.map { ($0.id, $0.readiness) })
    var current = outcome
    var path = initialPath
    var steps = initialTrace.steps
    var namedFallbackCount = 0
    while namedFallbackCount <= 8 {
      switch current {
      case .fallback(let key):
        guard namedFallbackCount < 8, let fallback = fallbacks[key] else {
          return .init(
            outcome: .unavailable(reason: "no_safe_decision"), paywall: nil, path: path,
            trace: .init(steps: steps))
        }
        namedFallbackCount += 1
        path.append(key)
        if steps.count < 256 {
          steps.append(
            .init(
              code: "fallback_selected", ruleID: matchedRuleID, safeLabel: fallback.safeLabel,
              result: nil, assignmentType: nil, rolloutBucket: nil, fallbackKey: key))
        }
        current = fallback.outcome
      case .paywall(let versionID, let unavailableFallback):
        guard let paywall = release.paywallVersions.first(where: { $0.id == versionID }) else {
          guard let unavailableFallback else {
            return .init(
              outcome: .unavailable(reason: "content_unavailable"), paywall: nil, path: path,
              trace: .init(steps: steps))
          }
          current = .fallback(key: unavailableFallback)
          continue
        }
        let commerceReady = paywall.productReferenceIDs.allSatisfy {
          readiness[$0] == .ready && context.products[$0] == .available
        }
        guard commerceReady else {
          guard let unavailableFallback else {
            return .init(
              outcome: .unavailable(reason: "commerce_unavailable"), paywall: nil, path: path,
              trace: .init(steps: steps))
          }
          current = .fallback(key: unavailableFallback)
          continue
        }
        return .init(
          outcome: current, paywall: paywall, path: path, trace: .init(steps: steps))
      case .noPaywall, .unavailable:
        return .init(outcome: current, paywall: nil, path: path, trace: .init(steps: steps))
      }
    }
    return .init(
      outcome: .unavailable(reason: "no_safe_decision"), paywall: nil, path: path,
      trace: .init(steps: steps))
  }

  func commerceConfigurationAssociation(
    applicationID: String,
    storePlatform: MosaicCommerceStorePlatform
  ) -> MosaicCommerceConfigurationAssociation? {
    guard let accepted else { return nil }
    return MosaicCommerceConfigurationAssociation(
      environmentID: accepted.release.metadata.environmentID,
      applicationID: applicationID,
      storePlatform: storePlatform,
      configurationReleaseID: accepted.release.metadata.id,
      configurationReleaseDigest: accepted.release.metadata.contentDigest,
      mosaicProductIDs: accepted.release.productReferences.map(\.id),
      mosaicProductTypes: Dictionary(
        uniqueKeysWithValues: accepted.release.productReferences.map {
          (
            $0.id,
            $0.type == .subscription ? .subscription : .oneTimeNonConsumable
          )
        }
      )
    )
  }

  func refreshIfNeeded() async -> MosaicConfigurationRefreshResult {
    if let accepted, clock() < accepted.refreshAfter {
      return .skippedFresh(metadata: accepted.release.metadata)
    }
    return await refresh()
  }

  func refresh() async -> MosaicConfigurationRefreshResult {
    if let task = inFlightRefresh?.task { return await task.value }
    refreshSequence += 1
    let id = refreshSequence
    let task = Task { await performRefresh() }
    inFlightRefresh = (id, task)
    let result = await task.value
    if inFlightRefresh?.id == id { inFlightRefresh = nil }
    return result
  }

  private func performRefresh() async -> MosaicConfigurationRefreshResult {
    var headers = [
      "Accept": "application/vnd.mosaic.configuration+json",
      "Authorization": "Bearer \(publicSDKKey)",
      "Mosaic-SDK-Platform": "ios",
      "Mosaic-SDK-Version": mosaicSDKVersion,
      "Mosaic-Configuration-Versions": mosaicSupportedConfigurationDeliveryVersions.joined(
        separator: ","),
      "Mosaic-Placement-Decision-Versions": mosaicSupportedPlacementDecisionVersions.joined(
        separator: ","),
      "Mosaic-Decision-Features": MosaicConfigurationDeliveryV2Decoder.supportedCapabilityFeatures
        .joined(separator: ","),
      "Mosaic-Bucketing-Algorithms": mosaicSupportedBucketingAlgorithms.joined(separator: ","),
      "Mosaic-Paywall-Protocol-Versions": mosaicSupportedProtocolVersions.joined(separator: ","),
      "Mosaic-Paywall-Capabilities": MosaicCapabilityCatalog.v02.map {
        "\($0.rawValue)@\(mosaicProtocolVersion)"
      }.joined(separator: ","),
    ]
    if let applicationVersion { headers["Mosaic-App-Version"] = applicationVersion }
    if let etag = accepted?.etag { headers["If-None-Match"] = etag }

    let response: MosaicConfigurationHTTPResponse
    do {
      response = try await transport.fetch(
        MosaicConfigurationHTTPRequest(
          url: configurationURL,
          headers: headers,
          timeout: requestTimeout
        ))
    } catch {
      return preserveOrUnavailable(
        MosaicDiagnostic(code: "delivery_network_unavailable", stage: .deliveryTransport)
      )
    }

    switch response.statusCode {
    case 304:
      guard let current = accepted, current.etag != nil else {
        return preserveOrUnavailable(
          MosaicDiagnostic(code: "delivery_unexpected_not_modified", stage: .deliveryTransport)
        )
      }
      let refreshAfter = freshnessDate(cacheControl: response.cacheControl, now: clock())
      accepted = AcceptedRelease(
        release: current.release,
        source: current.source,
        data: current.data,
        etag: current.etag,
        refreshAfter: refreshAfter
      )
      if let etag = current.etag {
        try? await store.save(
          MosaicConfigurationCacheRecord(
            etag: etag,
            releaseData: current.data,
            storedAt: clock(),
            refreshAfter: refreshAfter
          ))
      }
      return .notModified(metadata: current.release.metadata)

    case 200:
      guard let etag = response.etag, isStrongETag(etag) else {
        return preserveOrUnavailable(
          MosaicDiagnostic(code: "delivery_missing_strong_etag", stage: .deliveryTransport)
        )
      }
      let candidate: MosaicConfigurationRelease
      do {
        candidate = try MosaicConfigurationDeliveryDecoder.decode(response.data)
      } catch {
        return preserveOrUnavailable(
          MosaicDiagnostic(
            code: deliveryCode(error, fallback: "delivery_release_rejected"),
            stage: .deliveryValidation
          )
        )
      }
      if let current = accepted, current.source != .bundled {
        guard candidate.metadata.environmentID == current.release.metadata.environmentID else {
          return preserveOrUnavailable(
            MosaicDiagnostic(code: "delivery_environment_mismatch", stage: .deliveryValidation)
          )
        }
        guard candidate.metadata.number >= current.release.metadata.number else {
          return preserveOrUnavailable(
            MosaicDiagnostic(code: "delivery_release_stale", stage: .deliveryValidation)
          )
        }
      }
      let now = clock()
      let refreshAfter = freshnessDate(cacheControl: response.cacheControl, now: now)
      do {
        try await store.save(
          MosaicConfigurationCacheRecord(
            etag: etag,
            releaseData: response.data,
            storedAt: now,
            refreshAfter: refreshAfter
          ))
      } catch {
        return preserveOrUnavailable(
          MosaicDiagnostic(code: "delivery_cache_write_failed", stage: .cache)
        )
      }
      accepted = AcceptedRelease(
        release: candidate,
        source: .remote,
        data: response.data,
        etag: etag,
        refreshAfter: refreshAfter
      )
      return .updated(metadata: candidate.metadata)

    default:
      return preserveOrUnavailable(
        MosaicDiagnostic(code: "delivery_http_\(response.statusCode)", stage: .deliveryTransport)
      )
    }
  }

  private func loadBundledFallback() {
    let data: Data?
    switch bundledFallback {
    case .packaged:
      data = try? MosaicPackagedConfigurationRelease.data()
    case .data(let value):
      data = value
    }
    guard let data else {
      recordDiagnostic(code: "delivery_bundled_fallback_missing", stage: .fallbackLookup)
      return
    }
    do {
      let release = try MosaicConfigurationDeliveryDecoder.decode(data)
      accepted = AcceptedRelease(
        release: release,
        source: .bundled,
        data: data,
        etag: nil,
        refreshAfter: .distantPast
      )
    } catch {
      recordDiagnostic(
        code: deliveryCode(error, fallback: "delivery_bundled_fallback_rejected"),
        stage: .fallbackValidation)
    }
  }

  private func preserveOrUnavailable(_ diagnostic: MosaicDiagnostic)
    -> MosaicConfigurationRefreshResult
  {
    recordDiagnostic(diagnostic)
    guard let accepted else { return .unavailable(diagnostics: diagnostics) }
    return .preserved(
      metadata: accepted.release.metadata,
      source: accepted.source,
      diagnostic: diagnostic
    )
  }

  private func recordDiagnostic(code: String, stage: MosaicDiagnosticStage) {
    recordDiagnostic(MosaicDiagnostic(code: code, stage: stage))
  }

  private func recordDiagnostic(_ diagnostic: MosaicDiagnostic) {
    diagnostics.append(diagnostic)
    if diagnostics.count > 32 { diagnostics.removeFirst(diagnostics.count - 32) }
  }

  private func deliveryCode(_ error: Error, fallback: String) -> String {
    (error as? MosaicConfigurationDeliveryError)?.diagnosticCode ?? fallback
  }

  private func isStrongETag(_ value: String) -> Bool {
    value.range(of: "^\"[^\"\\r\\n]+\"$", options: .regularExpression) != nil
  }

  private func freshnessDate(cacheControl: String?, now: Date) -> Date {
    guard let cacheControl,
      let match = cacheControl.range(of: "(?:^|,)\\s*max-age=([0-9]+)", options: .regularExpression)
    else { return now.addingTimeInterval(60) }
    let directive = String(cacheControl[match])
    guard let separator = directive.lastIndex(of: "="),
      let seconds = TimeInterval(directive[directive.index(after: separator)...])
    else { return now.addingTimeInterval(60) }
    return now.addingTimeInterval(min(max(seconds, 1), 86_400))
  }
}

private enum MosaicPackagedConfigurationRelease {
  static func data() throws -> Data {
    guard
      let url = MosaicResourceBundle.bundle.url(
        forResource: "complete-paywall",
        withExtension: "json",
        subdirectory: "v0.2"
      )
        ?? MosaicResourceBundle.bundle.url(
          forResource: "complete-paywall",
          withExtension: "json"
        )
    else { throw CocoaError(.fileNoSuchFile) }
    let documentData = try Data(contentsOf: url)
    let document = try DeliveryValueForFallback.object(
      JSONSerialization.jsonObject(with: documentData)
    )
    let decoded = try MosaicProtocolDecoder.decode(documentData)
    let documentDigest = try DeliveryCanonicalJSON.digest(document)

    let products: [[String: Any]] = decoded.products.map { product in
      [
        "id": product.productId,
        "type": product.productId.localizedCaseInsensitiveContains("lifetime")
          ? "one_time_non_consumable" : "subscription",
        "fallbackDisplayName": product.label.defaultValue,
      ]
    }
    var assetReferences: [[String: Any]] = []
    var assetBindings: [[String: Any]] = []
    for asset in decoded.assets {
      guard let remoteURL = asset.source.remoteURL else { continue }
      let referenceID = "bundled_\(asset.id)"
      let kind = asset.type == .image ? "image" : "video"
      assetReferences.append([
        "id": referenceID,
        "kind": kind,
        "mediaType": kind == "image" ? "image/webp" : "video/mp4",
        "byteLength": 1,
        "contentDigest": try DeliveryCanonicalJSON.digest(remoteURL.absoluteString),
        "url": remoteURL.absoluteString,
      ])
      assetBindings.append([
        "documentAssetId": asset.id,
        "assetReferenceId": referenceID,
      ])
    }

    var release: [String: Any] = [
      "id": "configuration_release_bundled",
      "number": 1,
      "environment": ["id": "environment_bundled", "key": "bundled"],
      "publishedAt": "2026-07-22T00:00:00Z",
      "compatibility": [
        "paywallProtocols": [
          [
            "version": mosaicProtocolVersion,
            "requiredCapabilities": decoded.compatibility.requiredCapabilities.map {
              ["name": $0.name.rawValue, "version": $0.version]
            },
          ]
        ],
        "acceptance": "atomic",
      ],
      "placements": [
        [
          "key": "onboarding_complete",
          "paywallVersionId": "paywall_version_bundled",
        ]
      ],
      "paywallVersions": [
        [
          "id": "paywall_version_bundled",
          "paywallId": decoded.id,
          "protocolVersion": decoded.schemaVersion,
          "documentDigest": documentDigest,
          "document": document,
          "productReferenceIds": decoded.products.map(\.productId),
          "assetBindings": assetBindings,
        ]
      ],
      "productReferences": products,
      "assetReferences": assetReferences,
    ]
    release["contentDigest"] = try DeliveryCanonicalJSON.digest(release)
    return try DeliveryCanonicalJSON.data([
      "configurationDeliveryVersion": mosaicConfigurationDeliveryVersion,
      "release": release,
    ])
  }
}

private enum DeliveryValueForFallback {
  static func object(_ value: Any) throws -> [String: Any] {
    guard let value = value as? [String: Any] else {
      throw MosaicConfigurationDeliveryError.invalidJSON
    }
    return value
  }
}
