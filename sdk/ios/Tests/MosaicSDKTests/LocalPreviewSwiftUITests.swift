import SwiftUI
import XCTest

@testable import MosaicSDK

#if canImport(MosaicExample)
  @testable import MosaicExample
#endif

@MainActor
final class LocalPreviewSwiftUITests: XCTestCase {
  #if canImport(MosaicExample)
    func testExampleIdentityIsProcessScopedStableAndContractSafe() {
      let first = ExampleProcessIdentity.clientId
      let second = ExampleProcessIdentity.clientId

      XCTAssertEqual(first, second)
      XCTAssertNotNil(
        first.range(
          of: #"^client_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
          options: .regularExpression
        )
      )
      XCTAssertLessThanOrEqual(first.count, 100)
    }
  #endif

  func testStatusPanelBuildsEveryRequiredVisibleState() throws {
    let document = try canonicalDocument()
    let draft = MosaicPreviewRenderableDraft(
      editableDocumentId: "document_swiftui_test",
      revision: MosaicLocalRevision(revisionId: "revision_swiftui_000007", sequence: 7),
      document: document,
      preview: MosaicPreviewContext(locale: "ar-EG", textScale: 3)
    )
    let issue = MosaicPreviewDraftIssue(
      kind: .unsupportedComponent,
      code: "preview.component.unsupported",
      message: "This preview client cannot render a required component.",
      location: MosaicPreviewDiagnosticLocation(
        documentPath: "/layout/content/children/1/type",
        componentId: "hero",
        property: "type"
      ),
      recovery: MosaicPreviewRecovery(
        action: .removeComponent,
        message: "Remove the unsupported block or use a supported template."
      )
    )
    let commerce = MosaicPreviewMockCommerceState(
      products: [],
      purchaseOutcome: .alreadyEntitled,
      restoreOutcome: .alreadyEntitled,
      entitlement: .active(productReferenceId: "yearly-plan")
    )

    let statuses: [MosaicPreviewConnectionStatus] = [
      .connected,
      .reconnecting(attempt: 2, delayMilliseconds: 500),
      .disconnected,
    ]
    for status in statuses {
      let panel = MosaicLocalPreviewStatusPanel(
        connectionStatus: status,
        draft: draft,
        issue: issue,
        commerce: commerce,
        latestDiagnostic: nil
      )
      XCTAssertNotNil(panel.body)
    }
  }

  func testPreviewScreenBuildsWithBundledFallbackBeforeConnection() throws {
    let configuration = try MosaicPreviewClientConfiguration(identity: previewTestIdentity())
    let client = MosaicLocalPreviewClient(
      configuration: configuration,
      connector: NeverConnectingPreviewConnector()
    )
    let view = MosaicLocalPreviewScreen(
      client: client,
      fallbackDocument: try canonicalDocument(),
      fallbackPurchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      ),
      onResult: { _ in }
    )

    XCTAssertNotNil(view.body)
  }

  func testConnectedStatusDoesNotShowAStaleConnectionFailure() {
    let connectionFailure = MosaicPreviewConnectionDiagnostic(
      id: "preview.connection.failed-1",
      code: "preview.connection.failed",
      message: "The local preview connection is unavailable.",
      recovery: nil
    )

    let connected = MosaicLocalPreviewStatusPanel(
      connectionStatus: .connected,
      draft: nil,
      issue: nil,
      commerce: nil,
      latestDiagnostic: connectionFailure
    )
    let reconnecting = MosaicLocalPreviewStatusPanel(
      connectionStatus: .reconnecting(attempt: 1, delayMilliseconds: 250),
      draft: nil,
      issue: nil,
      commerce: nil,
      latestDiagnostic: connectionFailure
    )

    XCTAssertNil(connected.visibleDiagnostic)
    XCTAssertEqual(reconnecting.visibleDiagnostic, connectionFailure)
  }

  #if canImport(UIKit)
    func testStatusPanelRendersAtAccessibilityTextSize() throws {
      importUIKitMarker()
      let panel = MosaicLocalPreviewStatusPanel(
        connectionStatus: .reconnecting(attempt: 3, delayMilliseconds: 1_000),
        draft: nil,
        issue: MosaicPreviewDraftIssue(
          kind: .invalidDocument,
          code: "preview.validation.failed",
          message: "The draft contains an invalid component or property.",
          location: MosaicPreviewDiagnosticLocation(documentPath: "/layout"),
          recovery: MosaicPreviewRecovery(
            action: .editProperty,
            message: "Fix the affected property and send a new revision."
          )
        ),
        commerce: nil,
        latestDiagnostic: nil
      )
      let controller = UIHostingController(
        rootView: panel.environment(\.sizeCategory, .accessibilityExtraExtraExtraLarge)
      )
      controller.view.frame = CGRect(x: 0, y: 0, width: 390, height: 320)
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()

      XCTAssertGreaterThan(controller.view.intrinsicContentSize.height, 0)
    }

    private func importUIKitMarker() {}
  #endif
}

#if canImport(UIKit)
  import UIKit
#endif

private struct NeverConnectingPreviewConnector: MosaicPreviewSocketConnector {
  func connect(endpoint: URL, protocols: [String]) async throws -> any MosaicPreviewSocket {
    throw URLError(.cannotConnectToHost)
  }
}
