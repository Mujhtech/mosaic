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
        Menu("Analytics") {
          Button("Queue demo events") { Task { await model.queueAnalyticsDemo() } }
          Button("Flush now") { Task { await model.flushAnalytics() } }
          Button("Experiment diagnostics") {
            Task { await model.showExperimentDiagnostics() }
          }
        }
        .disabled(model.mosaic == nil)
        Menu("Observations") {
          Button("Queue diagnostics") { Task { await model.showObservationDiagnostics() } }
          Button("Flush now") { Task { await model.flushObservations() } }
          Button("Queue development sample") {
            Task { await model.queueSampleObservation() }
          }
        }
        .disabled(model.mosaic == nil)
      }
      .padding(.horizontal)
      .padding(.bottom, 10)

      Divider()
      CustomerEntitlementsPanel(model: model)
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
final class HostedConfigurationModel: ObservableObject {
  @Published private(set) var statusText = "Add hosted SDK settings to the scheme."
  @Published private(set) var isLoading = false
  @Published private(set) var releaseIdentity = "none"
  @Published private(set) var entitlementSummary = "No customer token provider configured."
  @Published private(set) var authoritySummary = "Authority not established."
  @Published private(set) var restoreStages: [String] = []
  @Published var customerSelection: ExampleCustomerTokenProvider.State = .signedOut {
    didSet {
      guard customerSelection != oldValue else { return }
      Task { await applyCustomerSelection() }
    }
  }
  private(set) var mosaic: Mosaic?
  let customerTokenProvider = ExampleCustomerTokenProvider()
  private var entitlementObservation: Task<Void, Never>?
  private var authorityObservation: Task<Void, Never>?

  let placement: String
  let setupMessage: String
  private let publicSDKKey: String?
  private let baseURL: URL?
  private let applicationID: String?
  private let revenueCatPublicSDKKey: String?
  private let commerceProviderSelection: String?
  /// On by default, exactly as the SDK default is. `MOSAIC_ANALYTICS_ENABLED=0`
  /// demonstrates the explicit host opt-out. Ingestion is still gated by the
  /// Environment's server-side collection setting, and a real host application
  /// is responsible for whatever end-user consent it owes.
  private let analyticsEnabled: Bool
  private let transactionObservationsEnabled: Bool
  private var storeKitProvider: MosaicStoreKitProvider?
  private var commerceManager: MosaicCommerceConfigurationManager?
  private var commerceProvider: (any MosaicCommerceProvider)?
  private var commerceRouter: MosaicCommerceProviderRouter?

  init(environment: [String: String] = ProcessInfo.processInfo.environment) {
    publicSDKKey = environment["MOSAIC_PUBLIC_SDK_KEY"]
    baseURL = environment["MOSAIC_SDK_BASE_URL"].flatMap(URL.init(string:))
    applicationID = environment["MOSAIC_APPLICATION_ID"]
    revenueCatPublicSDKKey = environment["REVENUECAT_PUBLIC_SDK_KEY"]
    commerceProviderSelection = environment["MOSAIC_COMMERCE_PROVIDER"]
    analyticsEnabled = environment["MOSAIC_ANALYTICS_ENABLED"] != "0"
    transactionObservationsEnabled = environment["MOSAIC_TRANSACTION_OBSERVATIONS"] == "1"
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
        storeKitProvider = provider
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
        applicationID: applicationID,
        applicationVersion: applicationVersion,
        transactionObservations: transactionObservationsEnabled ? .enabled : .disabled,
        purchaseProvider: purchaseProvider,
        customerTokenProvider: customerTokenProvider
      )
      mosaic = configured
      // Collection is on by default, so the enabled path calls nothing.
      if !analyticsEnabled {
        await configured.setAnalyticsCollection(hostEnabled: false)
      }
      // The provider exists before `configure`, so the observation sink is
      // attached afterwards. It is nil unless observations were opted in.
      await storeKitProvider?.attachTransactionObservationSink(
        configured.transactionObservationSink())
      await refreshCommerce(for: configured)
      await updateStatus(for: configured)
      observeEntitlements(configured)
      observeAuthority(configured)
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

  func queueAnalyticsDemo() async {
    guard let mosaic else { return }
    let presentationID = "presentation_ios_demo_\(UUID().uuidString.lowercased())"
    for action in ["navigate_to", "navigate_back", "open_external_url", "close"] {
      _ = await mosaic.recordAnalytics(
        .paywallActionSelected,
        correlation: .init(paywallPresentationId: presentationID),
        payload: .init(action: action))
    }
    let diagnostics = await mosaic.analyticsDiagnostics()
    statusText =
      "Analytics queue · \(diagnostics.queuedEventCount) events · \(diagnostics.queuedBytes) bytes"
  }

  func flushAnalytics() async {
    guard let mosaic else { return }
    let result = await mosaic.flushAnalytics()
    let diagnostics = await mosaic.analyticsDiagnostics()
    statusText =
      "Analytics \(String(describing: result)) · \(diagnostics.queuedEventCount) retained"
  }

  func showObservationDiagnostics() async {
    guard let mosaic else { return }
    let diagnostics = await mosaic.transactionObservationDiagnostics()
    guard diagnostics.mode == .enabled else {
      statusText = "Observations off · set MOSAIC_TRANSACTION_OBSERVATIONS=1"
      return
    }
    statusText =
      "Observations · \(diagnostics.queuedCount) queued · "
      + "\(diagnostics.acceptedForValidationCount) accepted for validation · "
      + "\(diagnostics.duplicateCount) duplicate · "
      + "\(diagnostics.permanentlyRejectedCount) rejected · "
      + (diagnostics.lastSafeCode ?? "no code")
  }

  func flushObservations() async {
    guard let mosaic else { return }
    let result = await mosaic.flushTransactionObservations()
    let diagnostics = await mosaic.transactionObservationDiagnostics()
    statusText =
      "Observations \(String(describing: result)) · \(diagnostics.queuedCount) retained"
  }

  /// Queues one synthetic observation for the canonical fixture reference.
  ///
  /// This exists only because StoreKit Testing in Xcode produces transactions
  /// with no App Store record, which the SDK deliberately never observes. A
  /// real purchase in sandbox or production is observed automatically and
  /// needs no host code at all.
  func queueSampleObservation() async {
    guard let mosaic, let sink = mosaic.transactionObservationSink() else {
      statusText = "Observations off · set MOSAIC_TRANSACTION_OBSERVATIONS=1"
      return
    }
    guard
      let observation = MosaicTransactionObservation(
        submissionID: "storekit_transaction_2000000900000001",
        referenceKind: .appStoreTransactionID,
        reference: "2000000900000001")
    else { return }
    sink.enqueue(observation)
    statusText = "Observation queued · development sample only, never proof"
  }

  func showExperimentDiagnostics() async {
    guard let mosaic else { return }
    let diagnostics = await mosaic.experimentDiagnostics()
    let time = diagnostics.trustedTimeReliable ? "trusted time" : "time unavailable"
    statusText =
      "Experiments · \(diagnostics.activeAssignmentCount) active · "
      + "\(diagnostics.persistedAssignmentCount) persisted · \(time)"
  }

  // MARK: Authoritative entitlements

  /// Watches the update stream rather than polling. Each identity transition
  /// emits its own state, so the UI never has to infer "the previous user's
  /// grants no longer apply" from silence.
  private func observeEntitlements(_ mosaic: Mosaic) {
    entitlementObservation?.cancel()
    entitlementObservation = Task { [weak self] in
      for await update in await mosaic.customerEntitlementUpdates() {
        guard let self, !Task.isCancelled else { return }
        self.apply(update)
      }
    }
  }

  private func observeAuthority(_ mosaic: Mosaic) {
    authorityObservation?.cancel()
    authorityObservation = Task { [weak self] in
      for await update in await mosaic.customerAccessAuthorityUpdates() {
        guard let self, !Task.isCancelled else { return }
        self.apply(update)
      }
    }
  }

  private func apply(_ update: MosaicCustomerAccessAuthorityUpdate) {
    switch update {
    case .authority(let authority, let support):
      authoritySummary =
        "epoch \(authority.epoch) · \(authority.kind.rawValue) · "
        + "\(authority.transitionState.rawValue) · min app "
        + support.supportedAppVersionWindow.minimumInclusive
    case .unavailable(let reason, let support):
      authoritySummary =
        "Unavailable · \(reason.rawValue)"
        + (support.map { " · requires SDK \($0.minimumSDKVersion)+" } ?? "")
    case .signedOut:
      authoritySummary = "Signed out · authority unavailable"
    case .cleared(let reason):
      authoritySummary = "Cleared · \(reason.rawValue)"
    }
  }

  private func apply(_ update: MosaicCustomerEntitlementUpdate) {
    switch update {
    case .loading:
      entitlementSummary = "Loading…"
    case .signedOut:
      entitlementSummary = "Signed out · no customer, so no authoritative answer."
    case .cleared(let reason):
      entitlementSummary = "Cleared · \(reason.rawValue)"
    case .unavailable(let reason):
      // Never "no access": unavailable is about Mosaic, not about the customer.
      entitlementSummary = "Unavailable · \(reason.rawValue) · this is not 'inactive'"
    case .snapshot(let value):
      let pro = value.snapshot.entry(forKey: "pro")
      let state = pro.map { "\($0.state.rawValue)" } ?? "no pro entry"
      entitlementSummary =
        "v\(value.snapshot.snapshotVersion) · \(describe(value.cacheState)) · pro: \(state)"
        + " · \(value.snapshot.entries.count) entries"
    }
  }

  private func describe(_ state: MosaicCustomerEntitlementCacheState) -> String {
    switch state {
    case .fresh: "fresh"
    case .refreshRecommended: "refresh recommended"
    case .staleWithinGrace(let until): "STALE within grace until \(until)"
    case .expired: "expired"
    case .missing: "no cache"
    case .invalid: "cache invalid"
    case .differentCustomer: "different customer"
    case .authorityUnknown: "authority unknown"
    }
  }

  private func applyCustomerSelection() async {
    guard let mosaic else { return }
    await customerTokenProvider.set(customerSelection)
    restoreStages = []
    // Identity changes go through the SDK so the token generation is bumped,
    // in-flight work is cancelled, and the cache is cleared before any read.
    do {
      switch customerSelection {
      case .signedOut:
        try await mosaic.resetIdentity()
      case .customerA:
        try await mosaic.identify(userID: "ios_example_customer_a")
      case .customerB:
        try await mosaic.identify(userID: "ios_example_customer_b")
      case .backendFailing:
        _ = await mosaic.refreshCustomerEntitlements()
      }
    } catch {
      entitlementSummary = "Identity update rejected safely"
    }
  }

  func refreshEntitlements() async {
    guard let mosaic else { return }
    let result = await mosaic.refreshCustomerEntitlements()
    let diagnostics = await mosaic.customerEntitlementDiagnostics()
    statusText =
      "Entitlements \(String(describing: result)) · "
      + "\(diagnostics.acceptedSnapshotCount) accepted · "
      + "\(diagnostics.rejectedSnapshotCount) rejected · "
      + (diagnostics.lastRejectionReason ?? "no rejection")
  }

  func restoreAndSync() async {
    guard let mosaic else { return }
    restoreStages = ["running…"]
    let result = await mosaic.restoreAndSyncCustomerEntitlements()
    restoreStages = result.stages.map(Self.describe)
    statusText =
      "Restore · \(String(describing: result.outcome)) · "
      + "authoritatively updated: \(result.authoritativeEntitlementsUpdated)"
  }

  func clearCustomerState() async {
    guard let mosaic else { return }
    await mosaic.clearCustomerState()
    restoreStages = []
  }

  private static func describe(_ stage: MosaicRestoreAndSyncStage) -> String {
    switch stage {
    case .providerRestoreStarted: "provider restore started"
    case .providerRestoreFinished(let result): "provider restore · \(String(describing: result))"
    case .authoritativeSyncStarted: "authoritative sync started"
    case .authoritativeSnapshotAccepted(let version): "snapshot accepted · v\(version)"
    case .authoritativeValidationPending(let attempts): "validation pending · \(attempts) attempts"
    case .authoritativeSyncUnavailable(let reason): "sync unavailable · \(reason.rawValue)"
    }
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

/// Stands in for the host application's own backend.
///
/// In a real app this calls an authenticated endpoint on your server, which
/// asks Mosaic for a Customer Access Token with its `secret_server` key and
/// returns it. Mosaic Billing requires an application backend: a public SDK key
/// identifies an application and can never select a Billing Customer, so there
/// is no anonymous mode to fall back to.
///
/// The example mints a fake token so the sign-in, sign-out, and switch-customer
/// flows can be exercised without a server. It also models the two failure modes
/// worth seeing in a demo: a signed-out user and a backend that cannot answer.
actor ExampleCustomerTokenProvider: MosaicCustomerTokenProvider {
  enum State: String, CaseIterable, Identifiable {
    case signedOut
    case customerA
    case customerB
    case backendFailing

    var id: String { rawValue }

    var label: String {
      switch self {
      case .signedOut: "Signed out"
      case .customerA: "Customer A"
      case .customerB: "Customer B"
      case .backendFailing: "Backend failing"
      }
    }
  }

  private var state: State = .signedOut
  private(set) var forcedRefreshCount = 0

  func set(_ state: State) { self.state = state }
  func current() -> State { state }

  func customerAccessToken(forceRefresh: Bool) async -> MosaicCustomerTokenResult {
    if forceRefresh { forcedRefreshCount += 1 }
    switch state {
    case .signedOut: return .signedOut
    case .backendFailing: return .unavailable
    case .customerA: return .token(MosaicCustomerAccessToken("mcat_example_customer_a"))
    case .customerB: return .token(MosaicCustomerAccessToken("mcat_example_customer_b"))
    }
  }
}

/// Shows what the SDK can honestly say about authoritative access, including the
/// states that are easy to forget: stale-but-serving, expired, and unavailable.
@MainActor
struct CustomerEntitlementsPanel: View {
  @ObservedObject var model: HostedConfigurationModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Authoritative entitlements")
          .font(.subheadline.weight(.semibold))
        Spacer(minLength: 8)
        Picker("Customer", selection: $model.customerSelection) {
          ForEach(ExampleCustomerTokenProvider.State.allCases) { state in
            Text(state.label).tag(state)
          }
        }
        .pickerStyle(.menu)
        .accessibilityLabel("Simulated customer session")
      }

      Text(model.entitlementSummary)
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel("Entitlement state: \(model.entitlementSummary)")

      Text(model.authoritySummary)
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel("Access authority: \(model.authoritySummary)")

      if !model.restoreStages.isEmpty {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(Array(model.restoreStages.enumerated()), id: \.offset) { _, stage in
            Text("• \(stage)")
              .font(.caption2.monospaced())
              .foregroundStyle(.secondary)
          }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Restore stages: \(model.restoreStages.joined(separator: ", "))")
      }

      HStack(spacing: 8) {
        Button("Refresh") { Task { await model.refreshEntitlements() } }
          .buttonStyle(.bordered)
        Button("Restore & sync") { Task { await model.restoreAndSync() } }
          .buttonStyle(.bordered)
        Button("Clear") { Task { await model.clearCustomerState() } }
          .buttonStyle(.bordered)
      }
      .disabled(model.mosaic == nil)
    }
    .padding(.horizontal)
    .padding(.bottom, 8)
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
