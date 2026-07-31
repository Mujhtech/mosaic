import SwiftUI

/// Resolves an already-accepted hosted Configuration Release and renders its
/// named Placement. Resolution never performs a network request.
@MainActor
public struct MosaicPlacementPaywall: View {
  private enum LoadState {
    case loading
    case resolved(MosaicPaywallDocument)
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
      case .resolved(let document):
        MosaicPaywall(
          document: document,
          requestedLocale: requestedLocale,
          purchaseProvider: mosaic.purchaseProvider,
          imageResolver: imageResolver,
          videoResolver: videoResolver,
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
      switch await mosaic.decision(placement: placement) {
      case .paywallSelected(let document, _, _, _, _, _, _):
        state = .resolved(document)
      case .noPaywall:
        state = .noPaywall
      case .configurationUnavailable(let diagnostics):
        let code = diagnostics.last?.code ?? "delivery_configuration_unavailable"
        state = .unavailable(code)
        onResult(.configurationUnavailable)
      case .placementUnavailable(let diagnostics):
        let code = diagnostics.last?.code ?? "delivery_placement_unavailable"
        state = .unavailable(code)
        onResult(.configurationUnavailable)
      case .unsupportedDecisionContract(let diagnostics):
        let code = diagnostics.last?.code ?? "delivery_unsupported_decision_contract"
        state = .unavailable(code)
        onResult(.configurationUnavailable)
      case .evaluationFailed(let diagnostics):
        let code = diagnostics.last?.code ?? "decision_evaluation_failed"
        state = .unavailable(code)
        onResult(.renderingFailed(diagnosticCode: code))
      }
    }
  }
}
