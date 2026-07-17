import MosaicSDK
import SwiftUI

struct ContentView: View {
  @State private var locale = ExampleLocale.english
  @State private var scenario = ExampleScenario.purchaseSuccess
  @State private var lastEvent = "Ready"

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Picker("Locale", selection: $locale) {
            ForEach(ExampleLocale.allCases) { locale in
              Text(locale.title).tag(locale)
            }
          }
          .pickerStyle(.menu)

          Spacer()

          Picker("Mock scenario", selection: $scenario) {
            ForEach(ExampleScenario.allCases) { scenario in
              Text(scenario.title).tag(scenario)
            }
          }
          .pickerStyle(.menu)
        }

        Text(lastEvent)
          .font(.caption.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .accessibilityLabel("Last Mosaic event: \(lastEvent)")
      }
      .padding(.horizontal)
      .padding(.vertical, 10)

      Divider()

      ExamplePaywallHost(
        locale: locale.identifier,
        scenario: scenario,
        onStatus: { lastEvent = $0 }
      )
      .id("\(locale.rawValue)-\(scenario.rawValue)")
    }
  }
}

@MainActor
private struct ExamplePaywallHost: View {
  let locale: String
  let scenario: ExampleScenario
  let onStatus: @MainActor (String) -> Void
  private let loadResult: MosaicPaywallLoadResult

  init(
    locale: String,
    scenario: ExampleScenario,
    onStatus: @escaping @MainActor (String) -> Void
  ) {
    self.locale = locale
    self.scenario = scenario
    self.onStatus = onStatus
    let candidate = Bundle.main.url(
      forResource: "complete-paywall",
      withExtension: "json"
    ).flatMap { try? Data(contentsOf: $0) }
    loadResult = MosaicPaywallLoader.load(candidateData: candidate)
  }

  var body: some View {
    switch loadResult {
    case .loaded(let document, let source, _):
      MosaicPaywall(
        document: document,
        requestedLocale: locale,
        purchaseProvider: scenario.provider,
        // The example intentionally exercises the declared same-geometry
        // placeholder for mosaic.paywall.hero.
        imageResolver: .missing,
        onInteraction: { interaction in
          onStatus("interaction: \(interaction.name.rawValue)")
        },
        onResult: { result in
          // The host records the terminal outcome. It would also own sheet or
          // fullScreenCover dismissal in a modal integration.
          onStatus("result: \(result.name.rawValue) [\(source.rawValue)]")
        }
      )
    case .unavailable(let result, let diagnostics):
      VStack(spacing: 12) {
        Text("Paywall unavailable")
          .font(.headline)
        Text(result.name.rawValue)
          .font(.body.monospaced())
        Text(diagnostics.map(\.code).joined(separator: ", "))
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding()
    }
  }
}

enum ExampleLocale: String, CaseIterable, Identifiable {
  case english
  case german
  case arabic

  var id: String { rawValue }

  var title: String {
    switch self {
    case .english: "English"
    case .german: "Deutsch (long)"
    case .arabic: "العربية (RTL)"
    }
  }

  var identifier: String {
    switch self {
    case .english: "en"
    case .german: "de-DE"
    case .arabic: "ar-EG"
    }
  }
}

enum ExampleScenario: String, CaseIterable, Identifiable {
  case purchaseSuccess
  case purchaseCancellation
  case purchaseFailure
  case purchaseUnavailable
  case alreadyEntitled
  case noProducts
  case restoreSuccess
  case restoreNoPurchases
  case restoreFailure

  var id: String { rawValue }

  var title: String {
    switch self {
    case .purchaseSuccess: "Purchase success"
    case .purchaseCancellation: "Purchase cancelled"
    case .purchaseFailure: "Purchase failure"
    case .purchaseUnavailable: "Purchase unavailable"
    case .alreadyEntitled: "Already entitled"
    case .noProducts: "No products"
    case .restoreSuccess: "Restore success"
    case .restoreNoPurchases: "Restore empty"
    case .restoreFailure: "Restore failure"
    }
  }

  @MainActor
  var provider: any MosaicPurchaseProvider {
    let products: [MosaicProduct] =
      self == .noProducts ? [] : MosaicProduct.phase1MockProducts
    switch self {
    case .purchaseSuccess, .restoreNoPurchases:
      return MockMosaicPurchaseProvider(
        products: products,
        purchaseBehavior: .success,
        restoreBehavior: .noPurchases
      )
    case .purchaseCancellation:
      return MockMosaicPurchaseProvider(
        products: products,
        purchaseBehavior: .cancellation
      )
    case .purchaseFailure:
      return MockMosaicPurchaseProvider(
        products: products,
        purchaseBehavior: .failure(diagnosticCode: "mock_purchase_failed")
      )
    case .purchaseUnavailable:
      return MockMosaicPurchaseProvider(
        products: products,
        purchaseBehavior: .unavailable
      )
    case .alreadyEntitled:
      return MockMosaicPurchaseProvider(
        products: products,
        purchaseBehavior: .alreadyEntitled,
        restoreBehavior: .alreadyEntitled([MosaicEntitlement(id: "mosaic-pro")])
      )
    case .noProducts:
      return MockMosaicPurchaseProvider(products: [])
    case .restoreSuccess:
      return MockMosaicPurchaseProvider(
        products: products,
        restoreBehavior: .success([MosaicEntitlement(id: "mosaic-pro")])
      )
    case .restoreFailure:
      return MockMosaicPurchaseProvider(
        products: products,
        restoreBehavior: .failure(diagnosticCode: "mock_restore_failed")
      )
    }
  }
}

#Preview("Normal") {
  ContentView()
}

#Preview("Unavailable products") {
  ExamplePreview(locale: .english, scenario: .noProducts)
}

#Preview("Long German") {
  ExamplePreview(locale: .german, scenario: .purchaseSuccess)
}

#Preview("Arabic RTL") {
  ExamplePreview(locale: .arabic, scenario: .purchaseSuccess)
}

private struct ExamplePreview: View {
  let locale: ExampleLocale
  let scenario: ExampleScenario

  var body: some View {
    ExamplePaywallHost(locale: locale.identifier, scenario: scenario) { _ in }
  }
}
