import SwiftUI

/// Native SwiftUI host for a running Local Preview client.
@MainActor
public struct MosaicLocalPreviewScreen: View {
  @ObservedObject private var client: MosaicLocalPreviewClient

  private let fallbackDocument: MosaicPaywallDocument?
  private let fallbackPurchaseProvider: (any MosaicPurchaseProvider)?
  private let showsBundledFallback: Bool
  private let imageResolver: MosaicImageResolver
  private let onInteraction: @MainActor (MosaicInteractionOutcome) -> Void
  private let onResult: @MainActor (MosaicPresentationResult) -> Void

  public init(
    client: MosaicLocalPreviewClient,
    fallbackDocument: MosaicPaywallDocument,
    fallbackPurchaseProvider: any MosaicPurchaseProvider,
    showsBundledFallback: Bool = true,
    imageResolver: MosaicImageResolver = .missing,
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void = { _ in }
  ) {
    self.client = client
    self.fallbackDocument = fallbackDocument
    self.fallbackPurchaseProvider = fallbackPurchaseProvider
    self.showsBundledFallback = showsBundledFallback
    self.imageResolver = imageResolver
    self.onInteraction = onInteraction
    self.onResult = onResult
  }

  public init(
    client: MosaicLocalPreviewClient,
    imageResolver: MosaicImageResolver = .missing,
    onInteraction: @escaping @MainActor (MosaicInteractionOutcome) -> Void = { _ in },
    onResult: @escaping @MainActor (MosaicPresentationResult) -> Void = { _ in }
  ) {
    self.client = client
    fallbackDocument = nil
    fallbackPurchaseProvider = nil
    showsBundledFallback = false
    self.imageResolver = imageResolver
    self.onInteraction = onInteraction
    self.onResult = onResult
  }

  public var body: some View {
    VStack(spacing: 0) {
      MosaicLocalPreviewStatusPanel(
        connectionStatus: client.connectionStatus,
        draft: client.draftForRendering,
        issue: client.draftIssue,
        commerce: client.mockCommerceState,
        latestDiagnostic: client.diagnostics.last,
        onReconnect: { client.connect() }
      )
      Divider()
      previewContent
    }
    .task {
      client.connect()
    }
    .onDisappear {
      Task { await client.disconnect() }
    }
  }

  @ViewBuilder
  private var previewContent: some View {
    if let draft = client.draftForRendering {
      MosaicPaywall(
        document: draft.document,
        requestedLocale: draft.preview.locale,
        purchaseProvider: client.purchaseProvider,
        imageResolver: imageResolver,
        onInteraction: onInteraction,
        onResult: onResult
      )
      .environment(\.sizeCategory, contentSizeCategory(for: draft.preview.textScale))
      .id(renderIdentity(draft))
      .task(id: draft.revision) {
        await Task.yield()
        await client.markRevisionLive(draft.revision)
      }
    } else if showsBundledFallback, let fallbackDocument, let fallbackPurchaseProvider {
      MosaicPaywall(
        document: fallbackDocument,
        requestedLocale: fallbackDocument.localization.defaultLocale,
        purchaseProvider: fallbackPurchaseProvider,
        imageResolver: imageResolver,
        onInteraction: onInteraction,
        onResult: onResult
      )
      .overlay(alignment: .top) {
        Text("Bundled fallback")
          .font(.caption.weight(.semibold))
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(.regularMaterial, in: Capsule())
          .padding(.top, 8)
          .accessibilityLabel("Showing the bundled fallback paywall")
      }
    } else {
      MosaicPreviewConnectionState(
        status: client.connectionStatus,
        hasIssue: client.draftIssue != nil,
        onReconnect: { client.connect() }
      )
    }
  }

  private func renderIdentity(_ draft: MosaicPreviewRenderableDraft) -> String {
    let commerce = client.mockCommerceRevision?.revisionId ?? "commerce_none"
    return "\(draft.editableDocumentId):\(draft.revision.revisionId):\(commerce)"
  }

  private func contentSizeCategory(for textScale: Double) -> ContentSizeCategory {
    switch textScale {
    case ..<0.75: .extraSmall
    case ..<0.9: .medium
    case ..<1.1: .large
    case ..<1.3: .extraLarge
    case ..<1.5: .extraExtraLarge
    case ..<1.75: .extraExtraExtraLarge
    case ..<2: .accessibilityMedium
    case ..<2.25: .accessibilityLarge
    case ..<2.5: .accessibilityExtraLarge
    case ..<2.75: .accessibilityExtraExtraLarge
    default: .accessibilityExtraExtraExtraLarge
    }
  }
}

private struct MosaicPreviewConnectionState: View {
  let status: MosaicPreviewConnectionStatus
  let hasIssue: Bool
  let onReconnect: @MainActor () -> Void

  var body: some View {
    VStack(spacing: 14) {
      if isLoading {
        ProgressView()
          .controlSize(.large)
        Text(title)
          .font(.headline)
        Text(message)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      } else {
        Image(systemName: "wifi.exclamationmark")
          .font(.system(size: 36))
          .foregroundStyle(.orange)
          .accessibilityHidden(true)
        Text(title)
          .font(.headline)
        Text(message)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        Button("Try again", action: onReconnect)
          .buttonStyle(.borderedProminent)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(24)
    .accessibilityElement(children: .contain)
  }

  private var isLoading: Bool {
    switch status {
    case .connecting, .reconnecting, .connected: true
    case .disconnected: false
    }
  }

  private var title: String {
    if hasIssue { return "Design unavailable" }
    switch status {
    case .connecting, .reconnecting: return "Connecting to Studio"
    case .connected: return "Waiting for your design"
    case .disconnected: return "Can't connect to Studio"
    }
  }

  private var message: String {
    if hasIssue { return "Studio sent a design this renderer could not display." }
    switch status {
    case .connecting, .reconnecting: return "Keep Studio open while the preview connects."
    case .connected: return "Connected. Send or edit a design in Studio to preview it here."
    case .disconnected: return "Open Studio and confirm both apps use the same preview session."
    }
  }
}

public struct MosaicLocalPreviewStatusPanel: View {
  public let connectionStatus: MosaicPreviewConnectionStatus
  public let draft: MosaicPreviewRenderableDraft?
  public let issue: MosaicPreviewDraftIssue?
  public let commerce: MosaicPreviewMockCommerceState?
  public let latestDiagnostic: MosaicPreviewConnectionDiagnostic?
  private let onReconnect: (@MainActor () -> Void)?

  public init(
    connectionStatus: MosaicPreviewConnectionStatus,
    draft: MosaicPreviewRenderableDraft?,
    issue: MosaicPreviewDraftIssue?,
    commerce: MosaicPreviewMockCommerceState?,
    latestDiagnostic: MosaicPreviewConnectionDiagnostic?,
    onReconnect: (@MainActor () -> Void)? = nil
  ) {
    self.connectionStatus = connectionStatus
    self.draft = draft
    self.issue = issue
    self.commerce = commerce
    self.latestDiagnostic = latestDiagnostic
    self.onReconnect = onReconnect
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Circle()
          .fill(connectionColor)
          .frame(width: 10, height: 10)
          .accessibilityHidden(true)
        Text(connectionLabel)
          .font(.headline)
        Spacer(minLength: 8)
        if let draft {
          Text("Revision \(draft.revision.sequence)")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        if case .disconnected = connectionStatus, let onReconnect {
          Button(action: onReconnect) {
            Label("Reconnect", systemImage: "arrow.clockwise")
          }
          .buttonStyle(.bordered)
          .controlSize(.small)
        }
      }

      if let draft {
        HStack(spacing: 12) {
          Label(draft.preview.locale, systemImage: "globe")
          Label(
            draft.document.localization.locales[
              MosaicLocalizationResolver(
                localization: draft.document.localization,
                requestedLocale: draft.preview.locale
              ).resolvedLocale.effectiveLocale
            ]?.direction == .rightToLeft ? "RTL" : "LTR",
            systemImage: "text.alignleft"
          )
          Label(
            "\(draft.preview.textScale.formatted(.number.precision(.fractionLength(1))))× text",
            systemImage: "textformat.size"
          )
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
      }

      if let commerce {
        Text(commerceLabel(commerce))
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Mock commerce: \(commerceLabel(commerce))")
      }

      if let issue {
        MosaicPreviewIssueRow(issue: issue)
      } else if let visibleDiagnostic {
        Text(visibleDiagnostic.message)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .accessibilityLabel("Preview diagnostic: \(visibleDiagnostic.message)")
      }
    }
    .padding(.horizontal)
    .padding(.vertical, 10)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Mosaic preview status")
  }

  private var connectionLabel: String {
    switch connectionStatus {
    case .disconnected: "Disconnected"
    case .connecting: "Connecting"
    case .connected: "Connected"
    case .reconnecting(let attempt, _): "Reconnecting · attempt \(attempt)"
    }
  }

  private var connectionColor: Color {
    switch connectionStatus {
    case .connected: .green
    case .connecting, .reconnecting: .orange
    case .disconnected: .secondary
    }
  }

  var visibleDiagnostic: MosaicPreviewConnectionDiagnostic? {
    guard let latestDiagnostic else { return nil }
    if case .connected = connectionStatus,
      latestDiagnostic.code.hasPrefix("preview.connection.")
    {
      return nil
    }
    return latestDiagnostic
  }

  private func commerceLabel(_ commerce: MosaicPreviewMockCommerceState) -> String {
    let entitlement = commerce.entitlement.productReferenceId.map { "active: \($0)" } ?? "none"
    return "Mock purchase: \(commerce.purchaseOutcome.rawValue) · entitlement: \(entitlement)"
  }
}

private struct MosaicPreviewIssueRow: View {
  let issue: MosaicPreviewDraftIssue

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Label(title, systemImage: "exclamationmark.triangle.fill")
        .font(.caption.weight(.semibold))
      Text(issue.message)
        .font(.caption)
      Text(issue.recovery.message)
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(8)
    .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    .accessibilityElement(children: .combine)
  }

  private var title: String {
    switch issue.kind {
    case .invalidDocument: "Invalid document"
    case .unsupportedComponent: "Unsupported component"
    case .renderFailure: "Render failure"
    }
  }
}
