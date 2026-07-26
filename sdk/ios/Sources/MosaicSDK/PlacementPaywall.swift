import SwiftUI

/// Resolves an already-accepted hosted Configuration Release and renders its
/// named Placement. Resolution never performs a network request.
@MainActor
public struct MosaicPlacementPaywall: View {
  private enum LoadState {
    case loading
    case resolved(MosaicPaywallDocument, MosaicAnalyticsPresentationInstrumentation?)
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
      case .resolved(let document, let analytics):
        MosaicPaywall(
          document: document,
          requestedLocale: requestedLocale,
          purchaseProvider: mosaic.purchaseProvider,
          imageResolver: imageResolver,
          videoResolver: videoResolver,
          analytics: analytics,
          onInteraction: onInteraction,
          onResult: onResult
        )
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
    .task(id: placement) {
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
          _ = await mosaic.recordAnalytics(
            .paywallPresented,
            correlation: .init(
              placementRequestId: placementRequestID,
              paywallPresentationId: presentationID),
            attribution: attribution, payload: .init())
          state = .resolved(
            document,
            await mosaic.analyticsPresentationInstrumentation(
              placementRequestID: placementRequestID, presentationID: presentationID,
              attribution: attribution))
        } else {
          state = .resolved(document, nil)
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
