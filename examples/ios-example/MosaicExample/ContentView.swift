import MosaicSDK
import SwiftUI
import UIKit

@MainActor
struct ContentView: View {
  private let bootstrap = ExamplePreviewBootstrap.load()

  var body: some View {
    switch bootstrap {
    case .ready(let configuration):
      RunningLocalPreview(configuration: configuration)
    case .unavailable(let message):
      VStack(spacing: 12) {
        Image(systemName: "exclamationmark.triangle.fill")
          .font(.largeTitle)
          .foregroundStyle(.orange)
          .accessibilityHidden(true)
        Text("Local preview unavailable")
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
