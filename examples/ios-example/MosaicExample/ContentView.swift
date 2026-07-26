import MosaicRevenueCat
import MosaicSDK
import MosaicStoreKit
import RevenueCat
import SwiftUI
import UIKit

@MainActor
struct ContentView: View {
  private let bootstrap = ExamplePreviewBootstrap.load()
  @State private var mode: ExampleMode = .localPreview

  var body: some View {
    VStack(spacing: 0) {
      Picker("Configuration source", selection: $mode) {
        ForEach(ExampleMode.allCases) { mode in
          Text(mode.label).tag(mode)
        }
      }
      .pickerStyle(.segmented)
      .padding()

      switch mode {
      case .localPreview:
        localPreview
      case .hosted:
        HostedConfigurationPreview()
      }
    }
  }

  @ViewBuilder
  private var localPreview: some View {
    switch bootstrap {
    case .ready(let configuration):
      RunningLocalPreview(configuration: configuration)
    case .unavailable(let message):
      ExampleUnavailableState(title: "Local preview unavailable", message: message)
    }
  }
}

private enum ExampleMode: String, CaseIterable, Identifiable {
  case localPreview
  case hosted

  var id: String { rawValue }
  var label: String { self == .localPreview ? "Local Studio" : "Hosted" }
}

private struct ExampleUnavailableState: View {
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.largeTitle)
        .foregroundStyle(.orange)
        .accessibilityHidden(true)
      Text(title)
        .font(.headline)
      Text(message)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding()
    .accessibilityElement(children: .combine)
  }
}

@MainActor
private struct RunningLocalPreview: View {
  @StateObject private var client: MosaicLocalPreviewClient
  @State private var lastEvent = "Waiting for Studio"

  init(configuration: MosaicPreviewClientConfiguration) {
    _client = StateObject(
      wrappedValue: MosaicLocalPreviewClient(configuration: configuration)
    )
  }

  var body: some View {
    VStack(spacing: 0) {
      MosaicLocalPreviewScreen(
        client: client,
        imageResolver: .missing,
        onInteraction: { interaction in
          lastEvent = "Interaction · \(interaction.name.rawValue)"
        },
        onResult: { result in
          lastEvent = "Result · \(result.name.rawValue)"
        }
      )
      .tint(Color(red: 0, green: 127 / 255, blue: 115 / 255))

      Divider()
      Text(lastEvent)
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .accessibilityLabel("Last Mosaic event: \(lastEvent)")
    }
  }
}

@MainActor
private struct HostedConfigurationPreview: View {
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var model = HostedConfigurationModel()

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text("Hosted Configuration")
            .font(.headline)
          Text(model.statusText)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
        Spacer(minLength: 8)
        Button {
          Task { await model.refresh() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .disabled(model.isLoading || model.mosaic == nil)
        Button("Identify") {
          Task { await model.identifyExampleUser() }
        }
        .buttonStyle(.bordered)
        .disabled(model.mosaic == nil)
        Button("Reset") {
          Task { await model.resetIdentity() }
        }
        .buttonStyle(.bordered)
        .disabled(model.mosaic == nil)
      }
      .padding(.horizontal)
      .padding(.bottom, 10)

      Divider()
      if let mosaic = model.mosaic {
        MosaicPlacementPaywall(
          mosaic: mosaic,
          placement: model.placement,
          imageResolver: .missing,
          onResult: { result in
            model.record(result: result)
          }
        )
        .id(model.releaseIdentity)
      } else if model.isLoading {
        ProgressView("Loading hosted configuration")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ExampleUnavailableState(
          title: "Hosted configuration unavailable",
          message: model.setupMessage
        )
      }
    }
    .task { await model.start() }
    .onChange(of: scenePhase) { phase in
      guard phase == .active else { return }
      Task { await model.refreshIfNeeded() }
    }
  }
}

@MainActor
private final class HostedConfigurationModel: ObservableObject {
  @Published private(set) var statusText = "Add hosted SDK settings to the scheme."
  @Published private(set) var isLoading = false
  @Published private(set) var releaseIdentity = "none"
  private(set) var mosaic: Mosaic?

  let placement: String
  let setupMessage: String
  private let publicSDKKey: String?
  private let baseURL: URL?
  private let applicationID: String?
  private let revenueCatPublicSDKKey: String?
  private let commerceProviderSelection: String?
  private var commerceManager: MosaicCommerceConfigurationManager?
  private var commerceProvider: (any MosaicCommerceProvider)?
  private var commerceRouter: MosaicCommerceProviderRouter?

  init(environment: [String: String] = ProcessInfo.processInfo.environment) {
    publicSDKKey = environment["MOSAIC_PUBLIC_SDK_KEY"]
    baseURL = environment["MOSAIC_SDK_BASE_URL"].flatMap(URL.init(string:))
    applicationID = environment["MOSAIC_APPLICATION_ID"]
    revenueCatPublicSDKKey = environment["REVENUECAT_PUBLIC_SDK_KEY"]
    commerceProviderSelection = environment["MOSAIC_COMMERCE_PROVIDER"]
    placement = environment["MOSAIC_PLACEMENT"] ?? "onboarding_complete"
    setupMessage =
      "Set MOSAIC_PUBLIC_SDK_KEY and MOSAIC_SDK_BASE_URL in the Xcode scheme. "
      + "Accepted Delivery v2 decisions and the bundled Delivery v1 fallback remain available during an API outage."
  }

  func start() async {
    guard mosaic == nil, let publicSDKKey, let baseURL else { return }
    isLoading = true
    defer { isLoading = false }
    do {
      let applicationVersion =
        Bundle.main.object(
          forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String
      let purchaseProvider: any MosaicPurchaseProvider
      if let applicationID, commerceProviderSelection == "storekit" {
        let provider = try MosaicStoreKitProvider(
          acceptor: ExampleStoreKitUpdateAcceptor()
        )
        let router = MosaicCommerceProviderRouter()
        commerceProvider = provider
        commerceRouter = router
        commerceManager = try MosaicCommerceConfigurationManager(
          cacheIdentifier: applicationID
        )
        purchaseProvider = router
      } else if let revenueCatPublicSDKKey, let applicationID {
        Purchases.configure(withAPIKey: revenueCatPublicSDKKey)
        let provider = try MosaicRevenueCatProvider()
        let router = MosaicCommerceProviderRouter()
        commerceProvider = provider
        commerceRouter = router
        commerceManager = try MosaicCommerceConfigurationManager(
          cacheIdentifier: applicationID
        )
        purchaseProvider = router
      } else {
        purchaseProvider = MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        )
      }
      let configured = try await Mosaic.configure(
        publicSDKKey: publicSDKKey,
        baseURL: baseURL,
        applicationVersion: applicationVersion,
        purchaseProvider: purchaseProvider
      )
      mosaic = configured
      await refreshCommerce(for: configured)
      await updateStatus(for: configured)
    } catch {
      statusText = "Hosted SDK settings are invalid. Check the key and base URL."
    }
  }

  func refresh() async {
    guard let mosaic else { return }
    isLoading = true
    _ = await mosaic.refresh()
    await refreshCommerce(for: mosaic)
    await updateStatus(for: mosaic)
    isLoading = false
  }

  func refreshIfNeeded() async {
    guard let mosaic else { return }
    _ = await mosaic.refreshIfNeeded()
    await refreshCommerce(for: mosaic)
    await updateStatus(for: mosaic)
  }

  func record(result: MosaicPresentationResult) {
    statusText = "Presentation result · \(result.name.rawValue)"
  }

  func identifyExampleUser() async {
    guard let mosaic else { return }
    do {
      try await mosaic.identify(userID: "ios_example_user")
      statusText = "Identified locally · decisions may change by assignment policy"
    } catch { statusText = "Identity update rejected safely" }
  }

  func resetIdentity() async {
    guard let mosaic else { return }
    do {
      try await mosaic.resetIdentity()
      statusText = "User identity reset · installation assignment retained"
    } catch { statusText = "Identity reset failed safely" }
  }

  private func updateStatus(for mosaic: Mosaic) async {
    switch await mosaic.configurationStatus() {
    case .available(let metadata, let source, let diagnostics):
      releaseIdentity = "\(metadata.id):\(metadata.number)"
      let diagnostic = diagnostics.last.map { " · \($0.code)" } ?? ""
      let decision = await mosaic.decision(placement: placement)
      statusText =
        "Release \(metadata.number) · \(source.rawValue) · \(decision.summary)\(diagnostic)"
    case .unavailable(let diagnostics):
      releaseIdentity = "unavailable"
      statusText = diagnostics.last?.code ?? "Configuration unavailable"
    }
  }

  private func refreshCommerce(for mosaic: Mosaic) async {
    guard let applicationID, let publicSDKKey, let baseURL,
      let commerceManager, let commerceProvider, let commerceRouter,
      let association = await mosaic.commerceConfigurationAssociation(
        applicationID: applicationID
      )
    else { return }

    switch await commerceManager.refresh(
      publicSDKKey: publicSDKKey,
      baseURL: baseURL,
      association: association
    ) {
    case .accepted(let configuration, _), .preserved(let configuration, _, _):
      do {
        try await commerceRouter.install(
          configuration: configuration,
          provider: commerceProvider
        )
        _ = await commerceRouter.loadProducts(
          identifiers: configuration.productMappings.map(\.mosaicProductID)
        )
      } catch {
        statusText = "Commerce provider configuration was rejected safely."
      }
    case .unavailable(let diagnostics):
      statusText = diagnostics.last?.code ?? "Commerce configuration unavailable"
    }
  }
}

extension MosaicPlacementDecisionResult {
  fileprivate var summary: String {
    switch self {
    case .paywallSelected(_, let paywallID, let ruleID, let fallbackPath, _, _, _):
      let rule = ruleID.map { " · rule \($0)" } ?? ""
      let fallback = fallbackPath.last.map { " · fallback \($0)" } ?? ""
      return "paywall \(paywallID)\(rule)\(fallback)"
    case .noPaywall(let ruleID, _, _, _):
      return ruleID.map { "no paywall · rule \($0)" } ?? "no paywall"
    case .placementUnavailable: return "placement unavailable"
    case .configurationUnavailable: return "configuration unavailable"
    case .unsupportedDecisionContract: return "unsupported decision contract"
    case .evaluationFailed: return "evaluation failed"
    }
  }
}

private actor ExampleStoreKitUpdateAcceptor: MosaicCommerceUpdateAcceptor {
  private var accepted = Set<String>()

  func accept(
    _ update: MosaicCommerceUpdate
  ) -> MosaicCommerceUpdateAcceptanceDisposition {
    accepted.insert(update.id)
    return .accepted
  }
}

@MainActor
private enum ExamplePreviewBootstrap {
  case ready(configuration: MosaicPreviewClientConfiguration)
  case unavailable(message: String)

  static func load() -> ExamplePreviewBootstrap {
    let environment = ProcessInfo.processInfo.environment
    let endpoint: URL
    if let source = environment["MOSAIC_PREVIEW_ENDPOINT"] {
      guard let configuredEndpoint = URL(string: source) else {
        return .unavailable(message: "MOSAIC_PREVIEW_ENDPOINT is not a valid URL.")
      }
      endpoint = configuredEndpoint
    } else {
      endpoint = MosaicPreviewDefaults.endpoint
    }

    let device = UIDevice.current
    let version =
      Bundle.main.object(
        forInfoDictionaryKey: "CFBundleShortVersionString"
      ) as? String ?? "0.2"
    let identity = MosaicPreviewClientIdentity(
      clientId: ExampleProcessIdentity.clientId,
      displayName: "Mosaic iOS local preview",
      renderer: MosaicPreviewSoftwareIdentity(id: "mosaic.ios", version: "0.2.0"),
      application: MosaicPreviewApplicationIdentity(
        id: Bundle.main.bundleIdentifier ?? "dev.mosaic.phase2.example",
        displayName: "Mosaic iOS Example",
        version: version
      ),
      device: MosaicPreviewDeviceIdentity(
        displayName: device.name,
        systemName: device.systemName,
        systemVersion: device.systemVersion
      )
    )

    do {
      return .ready(
        configuration: try MosaicPreviewClientConfiguration(
          endpoint: endpoint,
          sessionId: environment["MOSAIC_PREVIEW_SESSION_ID"]
            ?? MosaicPreviewDefaults.sessionId,
          identity: identity
        )
      )
    } catch {
      return .unavailable(
        message: "Check the local endpoint, session ID, and preview identity configuration."
      )
    }
  }
}

/// A reconnect-stable identifier scoped only to this application process.
/// It is never persisted and is not derived from a user or device identifier.
enum ExampleProcessIdentity {
  static let clientId =
    "client_ios_"
    + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
}

#Preview("Local Studio") {
  ContentView()
}
