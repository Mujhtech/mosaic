import SwiftUI

struct MosaicPresentationAcknowledgementGate: Sendable {
  private(set) var presentationID: String?

  mutating func claim(_ candidate: String) -> Bool {
    guard presentationID != candidate else { return false }
    presentationID = candidate
    return true
  }

  mutating func reset() { presentationID = nil }
}

/// Resolves an already-accepted hosted Configuration Release and renders its
/// named Placement. Resolution never performs a network request.
@MainActor
public struct MosaicPlacementPaywall: View {
  private struct ResolvedPresentation {
    let document: MosaicPaywallDocument
    let analytics: MosaicAnalyticsPresentationInstrumentation?
    let attribution: MosaicAnalyticsAttribution?
    let experimentAttribution: MosaicAnalyticsAttribution?
    let selection: MosaicExperimentSelection?
    let fallbackReason: String?
    let releaseID: String?
  }

  private enum LoadState {
    case loading
    case resolved(ResolvedPresentation)
    case noPaywall
    case unavailable(String)
  }

  private let mosaic: Mosaic
  private let placement: String
  private let requestedLocale: String?
  private let imageResolver: MosaicImageResolver
  private let videoResolver: MosaicVideoResolver
  private let onInteraction: @MainActor (MosaicInteractionOutcome) -> Void
  private let onResult: @MainActor (MosaicPresentationResult) -> Void
  @State private var state: LoadState = .loading
  @State private var placementRequestID = MosaicAnalyticsRuntime.identifier(
    prefix: "placement_request")
  @State private var presentationID = MosaicAnalyticsRuntime.identifier(prefix: "presentation")
  @State private var generation = 0
  @State private var acknowledgementGate = MosaicPresentationAcknowledgementGate()
  @Environment(\.scenePhase) private var scenePhase

  public init(
    mosaic: Mosaic,
    placement: String,
    requestedLocale: String? = nil,
    imageResolver: MosaicImageResolver = .missing,
    videoResolver: MosaicVideoResolver = .missing,
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void
  ) {
    self.mosaic = mosaic
    self.placement = placement
    self.requestedLocale = requestedLocale
    self.imageResolver = imageResolver
    self.videoResolver = videoResolver
    self.onInteraction = onInteraction
    self.onResult = onResult
  }

  public var body: some View {
    Group {
      switch state {
      case .loading:
        ProgressView("Loading paywall")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityLabel("Loading Mosaic paywall")
      case .resolved(let resolved):
        MosaicPaywall(
          document: resolved.document,
          requestedLocale: requestedLocale,
          purchaseProvider: mosaic.purchaseProvider,
          imageResolver: imageResolver,
          videoResolver: videoResolver,
          analytics: resolved.analytics,
          onInteraction: onInteraction,
          onResult: onResult
        )
        .onAppear { acknowledge(resolved) }
      case .noPaywall:
        Color.clear
          .accessibilityHidden(true)
      case .unavailable(let diagnosticCode):
        VStack(spacing: 12) {
          Image(systemName: "rectangle.slash")
            .font(.largeTitle)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
          Text("Paywall unavailable")
            .font(.headline)
          Text("The requested placement has no safe configuration.")
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Diagnostic code: \(diagnosticCode)")
      }
    }
    .task(id: "\(placement):\(generation)") {
      let analytics = await mosaic.analyticsPlacementMetadata(placement)
      if let analytics {
        _ = await mosaic.recordAnalytics(
          .placementRequested,
          correlation: .init(placementRequestId: placementRequestID),
          attribution: .init(
            configurationReleaseId: analytics.releaseID,
            placementId: analytics.placementID,
            placementRuleSetId: analytics.ruleSetID,
            placementRuleSetVersion: UInt64(analytics.ruleSetVersion)),
          payload: .init(decisionContractVersion: "1"))
      }
      let evaluation = await mosaic.decisionForPresentation(placement: placement)
      switch evaluation.result {
      case .paywallSelected(
        let document, let paywallVersionID, let matchedRuleID, _,
        _, _, let trace):
        if let analytics,
          let paywall = await mosaic.analyticsPaywallMetadata(versionID: paywallVersionID)
        {
          let attribution = MosaicAnalyticsAttribution(
            configurationReleaseId: analytics.releaseID,
            placementId: analytics.placementID,
            placementRuleSetId: analytics.ruleSetID,
            placementRuleSetVersion: UInt64(analytics.ruleSetVersion),
            winningRuleId: matchedRuleID, paywallId: paywall.paywallID,
            paywallVersionId: paywall.versionID)
          let experiment = evaluation.experimentSelection.map {
            MosaicAnalyticsAttribution(
              configurationReleaseId: analytics.releaseID,
              placementId: analytics.placementID,
              experimentId: $0.assignment.experimentId,
              experimentVersionId: $0.assignment.experimentVersionId,
              experimentVariantId: $0.variant.id,
              experimentAllocationVersion: $0.assignment.allocationVersion)
          }
          if let selection = evaluation.experimentSelection, let experiment {
            _ = await mosaic.recordAnalytics(
              .experimentAssigned,
              correlation: .init(placementRequestId: placementRequestID),
              attribution: experiment,
              payload: .init(
                assignmentKeyType: selection.keyType.rawValue,
                bucketingAlgorithm: selection.assignment.bucketingAlgorithm,
                source: selection.source.rawValue, bucket: selection.bucket))
          }
          let rollout = trace.steps.reversed().compactMap(\.rolloutBucket).first
          let assignment = trace.steps.reversed().compactMap(\.assignmentType).first
          await emitFallbackUses(
            evaluation.fallbackUses, finalOutcome: "paywall", attribution: attribution)
          _ = await mosaic.recordAnalytics(
            .placementPaywallSelected,
            correlation: .init(placementRequestId: placementRequestID),
            attribution: attribution,
            payload: .init(
              decisionContractVersion: "1", finalOutcome: "paywall",
              assignmentKeyType: assignment == "identified_user"
                ? "identified_user" : assignment == nil ? nil : "installation",
              bucketingAlgorithm: rollout == nil ? nil : "sha256_length_prefixed_v1",
              rolloutBucket: rollout))
          state = .resolved(
            .init(
              document: document,
              analytics: await mosaic.analyticsPresentationInstrumentation(
                placementRequestID: placementRequestID, presentationID: presentationID,
                attribution: attribution,
                experimentAttribution: Self.conversionExperimentAttribution(
                  experiment: experiment,
                  fallbackReason: evaluation.experimentFallbackReason)),
              attribution: attribution, experimentAttribution: experiment,
              selection: evaluation.experimentSelection,
              fallbackReason: evaluation.experimentFallbackReason,
              releaseID: analytics.releaseID))
        } else {
          state = .resolved(
            .init(
              document: document, analytics: nil, attribution: nil,
              experimentAttribution: nil,
              selection: evaluation.experimentSelection,
              fallbackReason: evaluation.experimentFallbackReason, releaseID: nil))
        }
      case .noPaywall(let matchedRuleID, _, _, let trace):
        state = .noPaywall
        if let analytics {
          let rollout = trace.steps.reversed().compactMap(\.rolloutBucket).first
          let assignment = trace.steps.reversed().compactMap(\.assignmentType).first
          let attribution = MosaicAnalyticsAttribution(
            configurationReleaseId: analytics.releaseID,
            placementId: analytics.placementID,
            placementRuleSetId: analytics.ruleSetID,
            placementRuleSetVersion: UInt64(analytics.ruleSetVersion),
            winningRuleId: matchedRuleID)
          await emitFallbackUses(
            evaluation.fallbackUses, finalOutcome: "no_paywall", attribution: attribution)
          _ = await mosaic.recordAnalytics(
            .placementNoPaywall,
            correlation: .init(placementRequestId: placementRequestID),
            attribution: attribution,
            payload: .init(
              decisionContractVersion: "1", finalOutcome: "no_paywall",
              assignmentKeyType: assignment == "identified_user"
                ? "identified_user" : assignment == nil ? nil : "installation",
              bucketingAlgorithm: rollout == nil ? nil : "sha256_length_prefixed_v1",
              rolloutBucket: rollout))
        }
      case .configurationUnavailable(let diagnostics):
        let code = diagnostics.last?.code ?? "delivery_configuration_unavailable"
        state = .unavailable(code)
        onResult(.configurationUnavailable)
      case .placementUnavailable(let diagnostics):
        let code = diagnostics.last?.code ?? "delivery_placement_unavailable"
        state = .unavailable(code)
        onResult(.configurationUnavailable)
        if let analytics {
          let attribution = MosaicAnalyticsAttribution(
            configurationReleaseId: analytics.releaseID,
            placementId: analytics.placementID,
            placementRuleSetId: analytics.ruleSetID,
            placementRuleSetVersion: UInt64(analytics.ruleSetVersion))
          await emitFallbackUses(
            evaluation.fallbackUses, finalOutcome: "unavailable", attribution: attribution)
          _ = await mosaic.recordAnalytics(
            .placementUnavailable,
            correlation: .init(placementRequestId: placementRequestID),
            attribution: attribution,
            payload: .init(diagnosticCode: "decision.unavailable", reason: "no_safe_decision"))
        }
      case .unsupportedDecisionContract(let diagnostics):
        let code = diagnostics.last?.code ?? "delivery_unsupported_decision_contract"
        state = .unavailable(code)
        onResult(.configurationUnavailable)
      case .evaluationFailed(let diagnostics):
        let code = diagnostics.last?.code ?? "decision_evaluation_failed"
        state = .unavailable(code)
        onResult(.renderingFailed(diagnosticCode: code))
        if let analytics {
          _ = await mosaic.recordAnalytics(
            .placementEvaluationFailed,
            correlation: .init(placementRequestId: placementRequestID),
            attribution: .init(
              configurationReleaseId: analytics.releaseID,
              placementId: analytics.placementID,
              placementRuleSetId: analytics.ruleSetID,
              placementRuleSetVersion: UInt64(analytics.ruleSetVersion)),
            payload: .init(diagnosticCode: "decision.evaluation_failed", retryable: false))
        }
      }
    }
    .onChange(of: scenePhase) { phase in
      guard phase == .active else { return }
      Task {
        _ = await mosaic.refresh()
        restartPresentation()
      }
    }
  }

  private func acknowledge(_ resolved: ResolvedPresentation) {
    guard acknowledgementGate.claim(presentationID) else { return }
    Task {
      if let selection = resolved.selection, let releaseID = resolved.releaseID,
        !(await mosaic.authorizeExperimentPresentation(selection, releaseID: releaseID))
      {
        restartPresentation()
        return
      }
      guard let attribution = resolved.attribution else { return }
      _ = await mosaic.recordAnalytics(
        .paywallPresented,
        correlation: .init(
          placementRequestId: placementRequestID, paywallPresentationId: presentationID),
        attribution: attribution, payload: .init())
      guard let selection = resolved.selection, !selection.excludedFromResults,
        let experiment = resolved.experimentAttribution
      else { return }
      if let reason = resolved.fallbackReason {
        _ = await mosaic.recordAnalytics(
          .experimentFallbackPresented,
          correlation: .init(
            placementRequestId: placementRequestID, paywallPresentationId: presentationID),
          attribution: experiment,
          payload: .init(
            diagnosticCode: "experiment.\(reason)", reason: reason,
            presentedPaywallId: attribution.paywallId,
            presentedPaywallVersionId: attribution.paywallVersionId))
      } else {
        _ = await mosaic.recordAnalytics(
          .experimentExposed,
          correlation: .init(
            placementRequestId: placementRequestID, paywallPresentationId: presentationID),
          attribution: exposureAttribution(paywall: attribution, experiment: experiment),
          payload: .init(
            assignmentKeyType: selection.keyType.rawValue,
            bucketingAlgorithm: selection.assignment.bucketingAlgorithm,
            productReadiness: "ready", providerCapability: "accepted", qaOverride: false))
        await mosaic.markExperimentExposed(selection)
      }
    }
  }

  private func restartPresentation() {
    placementRequestID = MosaicAnalyticsRuntime.identifier(prefix: "placement_request")
    presentationID = MosaicAnalyticsRuntime.identifier(prefix: "presentation")
    acknowledgementGate.reset()
    state = .loading
    generation += 1
  }

  /// The Experiment tuple that a presentation's conversion events may carry.
  ///
  /// Conversion attribution joins a conversion to an exposure by equality on
  /// the Experiment columns of the conversion event itself. A fallback
  /// presentation never records a statistical exposure, so its conversions must
  /// stay tuple-free: a tuple-carrying fallback `product_selected` would
  /// otherwise displace the Variant's legitimate denominator row in
  /// `product_selection_purchase_start`.
  ///
  /// `experiment_fallback_presented` still carries the tuple. It is a
  /// diagnostic event, not a conversion.
  static func conversionExperimentAttribution(
    experiment: MosaicAnalyticsAttribution?, fallbackReason: String?
  ) -> MosaicAnalyticsAttribution? {
    fallbackReason == nil ? experiment : nil
  }

  private func exposureAttribution(
    paywall: MosaicAnalyticsAttribution, experiment: MosaicAnalyticsAttribution
  ) -> MosaicAnalyticsAttribution {
    .init(
      configurationReleaseId: paywall.configurationReleaseId,
      placementId: paywall.placementId,
      paywallId: paywall.paywallId,
      paywallVersionId: paywall.paywallVersionId,
      experimentId: experiment.experimentId,
      experimentVersionId: experiment.experimentVersionId,
      experimentVariantId: experiment.experimentVariantId,
      experimentAllocationVersion: experiment.experimentAllocationVersion)
  }

  private func emitFallbackUses(
    _ uses: [MosaicPlacementEvaluator.FallbackUse], finalOutcome: String,
    attribution: MosaicAnalyticsAttribution
  ) async {
    for use in uses {
      _ = await mosaic.recordAnalytics(
        .placementFallbackUsed,
        correlation: .init(placementRequestId: placementRequestID),
        attribution: attribution,
        payload: .init(
          finalOutcome: finalOutcome, trigger: use.trigger, fallbackKey: use.key))
    }
  }
}
