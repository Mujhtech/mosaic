#if canImport(UIKit)
  import SwiftUI
  import UIKit
  import XCTest

  @testable import MosaicSDK

  @MainActor
  final class SwiftUISnapshotTests: XCTestCase {
    func testCanonicalPaywallMatchesDeterministicSwiftUIGolden() async throws {
      let document = try canonicalDocument()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        onResult: { _ in }
      )
      await model.prepare()

      let image = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .environment(\.sizeCategory, .large)
          .background(Color.white),
        size: CGSize(width: 390, height: 844)
      )
      let snapshotURL = sourceSnapshotURL()

      if ProcessInfo.processInfo.environment["MOSAIC_RECORD_SNAPSHOTS"] == "1" {
        try FileManager.default.createDirectory(
          at: snapshotURL.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try XCTUnwrap(image.pngData()).write(to: snapshotURL, options: .atomic)
        return
      }

      guard FileManager.default.fileExists(atPath: snapshotURL.path) else {
        throw XCTSkip(
          "The iOS golden has not been recorded in this checkout. "
            + "Run the documented MOSAIC_RECORD_SNAPSHOTS=1 simulator command first."
        )
      }
      let expected = try XCTUnwrap(UIImage(contentsOfFile: snapshotURL.path))
      let comparison = try compare(actual: image, expected: expected)
      XCTAssertLessThanOrEqual(
        comparison.differentPixelRatio,
        0.005,
        "SwiftUI golden changed: \(comparison.differentPixelRatio * 100)% pixels differ. "
          + "Record intentionally with MOSAIC_RECORD_SNAPSHOTS=1 after review."
      )
    }

    func testProtocolV02CompleteFixtureMatchesDeterministicSwiftUIGolden() async throws {
      let document = try v02Document()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        clock: { Date(timeIntervalSince1970: 1_893_455_998) },
        onResult: { _ in }
      )
      await model.prepare()

      let image = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .environment(\.sizeCategory, .large)
          .background(Color.white),
        size: CGSize(width: 390, height: 844)
      )
      let snapshotURL = sourceSnapshotURL(named: "complete-paywall-v02.png")

      if ProcessInfo.processInfo.environment["MOSAIC_RECORD_SNAPSHOTS"] == "1" {
        try FileManager.default.createDirectory(
          at: snapshotURL.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try XCTUnwrap(image.pngData()).write(to: snapshotURL, options: .atomic)
        return
      }

      guard FileManager.default.fileExists(atPath: snapshotURL.path) else {
        throw XCTSkip(
          "The Protocol 0.2 iOS golden has not been recorded. "
            + "Run the documented MOSAIC_RECORD_SNAPSHOTS=1 simulator command first."
        )
      }
      let expected = try XCTUnwrap(UIImage(contentsOfFile: snapshotURL.path))
      let comparison = try compare(actual: image, expected: expected)
      XCTAssertLessThanOrEqual(
        comparison.differentPixelRatio,
        0.005,
        "Protocol 0.2 SwiftUI golden changed: \(comparison.differentPixelRatio * 100)% pixels differ."
      )
    }

    func testProtocolV02HorizontalProductSelectorPlacesCardsSideBySide() async throws {
      let document = try v02DocumentWithProductSelectorFirst()
      let selector = try XCTUnwrap(document.productSelectors.first)
      XCTAssertEqual(selector.direction, .horizontal)

      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        clock: { Date(timeIntervalSince1970: 1_893_455_998) },
        onResult: { _ in }
      )
      await model.prepare()

      let size = CGSize(width: 390, height: 320)
      let image = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .environment(\.sizeCategory, .large)
          .background(Color.white),
        size: size
      )
      let monthly = try XCTUnwrap(
        pixelBounds(in: image, red: 255, green: 0, blue: 0)
      )
      let yearly = try XCTUnwrap(
        pixelBounds(in: image, red: 0, green: 255, blue: 0)
      )
      XCTAssertLessThanOrEqual(monthly.maxX, yearly.minX)
      XCTAssertGreaterThan(
        min(monthly.maxY, yearly.maxY),
        max(monthly.minY, yearly.minY),
        "Horizontal cards should occupy overlapping vertical space without wrapping."
      )
    }

    func testHorizontalStackChildWidthFillFallsBackToFitWithDiagnostic() async throws {
      let document = try v02DocumentWithHorizontalCloseButton(width: "fill")
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        onResult: { _ in }
      )
      await model.prepare()

      _ = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .background(Color.white),
        size: CGSize(width: 390, height: 320)
      )

      XCTAssertEqual(
        model.diagnostics.filter { $0.code == "layout.unboundedFill" }.count,
        1,
        "A horizontal Stack must treat its width main axis as unbounded and degrade Fill to Fit."
      )
    }

    func testNestedFixedWidthStackReestablishesBoundedWidthForItsChildren() async throws {
      let document = try v02DocumentWithFixedWidthNestedStackInHorizontalStack()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        onResult: { _ in }
      )
      await model.prepare()

      _ = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .background(Color.white),
        size: CGSize(width: 390, height: 320)
      )

      XCTAssertFalse(
        model.diagnostics.contains { $0.code == "layout.unboundedFill" },
        "A fixed nested width must give a vertical Stack's children a genuinely bounded cross axis."
      )
    }

    func testProtocolV02NavigateToSheetUsesNativeModalOverTheBaseScreen() async throws {
      let document = try v02DocumentWithBundledSheetVideo()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        onResult: { _ in }
      )
      await model.prepare()
      model.navigate(to: "details")

      XCTAssertEqual(model.baseScreen?.id, "offer")
      XCTAssertEqual(model.presentedSheet?.id, "details")

      let size = CGSize(width: 390, height: 844)
      let controller = UIHostingController(
        rootView: MosaicPaywall(model: model, imageResolver: .missing)
          .frame(width: size.width, height: size.height)
      )
      let window = UIWindow(frame: CGRect(origin: .zero, size: size))
      window.rootViewController = controller
      window.isHidden = false
      controller.view.frame = window.bounds
      controller.view.layoutIfNeeded()
      try await Task.sleep(nanoseconds: 250_000_000)

      XCTAssertNotNil(
        controller.presentedViewController,
        "A protocol Sheet must use native modal presentation over its base Screen."
      )
      XCTAssertTrue(
        model.diagnostics.contains { $0.code == "media_video_background_unavailable" },
        "An unavailable decorative sheet video must fall back safely and diagnose."
      )
      window.isHidden = true
    }

    func testLongGermanAtAccessibilityTextSizeRendersWithoutFailure() async throws {
      let document = try canonicalDocument()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "de-DE",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        onResult: { _ in }
      )
      await model.prepare()

      let image = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .environment(\.sizeCategory, .accessibilityExtraExtraExtraLarge)
          .background(Color.white),
        size: CGSize(width: 390, height: 844)
      )

      XCTAssertEqual(image.size, CGSize(width: 390, height: 844))
      XCTAssertTrue(
        try rgbaPixels(image).contains { $0 < 240 },
        "The accessibility-size renderer should produce visible paywall content."
      )
    }

    func testProtocolV02ArabicRTLAtAccessibilityTextSizeRendersWithoutFailure() async throws {
      let document = try v02Document()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "ar-EG",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        clock: { Date(timeIntervalSince1970: 1_893_455_998) },
        onResult: { _ in }
      )
      await model.prepare()

      let image = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.layoutDirection, .rightToLeft)
          .environment(\.sizeCategory, .accessibilityExtraExtraExtraLarge)
          .background(Color.white),
        size: CGSize(width: 390, height: 844)
      )

      XCTAssertEqual(image.size, CGSize(width: 390, height: 844))
      XCTAssertTrue(
        try rgbaPixels(image).contains { $0 < 240 },
        "The Protocol 0.2 RTL accessibility-size renderer should produce visible content."
      )
    }

    private func render<V: View>(_ view: V, size: CGSize) -> UIImage {
      let controller = UIHostingController(
        rootView: view.frame(width: size.width, height: size.height))
      let window = UIWindow(frame: CGRect(origin: .zero, size: size))
      window.rootViewController = controller
      window.isHidden = false
      controller.view.frame = window.bounds
      controller.view.backgroundColor = .white
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()
      RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))

      let format = UIGraphicsImageRendererFormat.default()
      format.scale = 1
      format.opaque = true
      let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
        if !controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true) {
          controller.view.layer.render(in: context.cgContext)
        }
      }
      window.isHidden = true
      return image
    }

    private func sourceSnapshotURL(named name: String = "complete-paywall.png") -> URL {
      URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("Resources")
        .appendingPathComponent(name)
    }

    private func compare(actual: UIImage, expected: UIImage) throws -> SnapshotComparison {
      guard actual.size == expected.size else {
        return SnapshotComparison(differentPixelRatio: 1)
      }
      let actualPixels = try rgbaPixels(actual)
      let expectedPixels = try rgbaPixels(expected)
      guard actualPixels.count == expectedPixels.count else {
        return SnapshotComparison(differentPixelRatio: 1)
      }

      var differentPixels = 0
      let pixelCount = actualPixels.count / 4
      for offset in stride(from: 0, to: actualPixels.count, by: 4) {
        let channelDelta = (0..<4).reduce(0) { total, channel in
          total
            + abs(Int(actualPixels[offset + channel]) - Int(expectedPixels[offset + channel]))
        }
        if channelDelta > 16 {
          differentPixels += 1
        }
      }
      return SnapshotComparison(
        differentPixelRatio: Double(differentPixels) / Double(max(pixelCount, 1))
      )
    }

    private func rgbaPixels(_ image: UIImage) throws -> [UInt8] {
      let cgImage = try XCTUnwrap(image.cgImage)
      let width = cgImage.width
      let height = cgImage.height
      var pixels = [UInt8](repeating: 0, count: width * height * 4)
      let colorSpace = CGColorSpaceCreateDeviceRGB()
      let context = try XCTUnwrap(
        CGContext(
          data: &pixels,
          width: width,
          height: height,
          bitsPerComponent: 8,
          bytesPerRow: width * 4,
          space: colorSpace,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
      )
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      return pixels
    }

    private func v02DocumentWithProductSelectorFirst() throws -> MosaicPaywallDocument {
      let data = try v02FixtureData()
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: data) as? [String: Any]
      )
      let initialScreenID = try XCTUnwrap(object["initialScreenId"] as? String)
      var screens = try XCTUnwrap(object["screens"] as? [[String: Any]])
      let initialScreenIndex = try XCTUnwrap(
        screens.firstIndex { $0["id"] as? String == initialScreenID }
      )
      var initialScreen = screens[initialScreenIndex]
      var layout = try XCTUnwrap(initialScreen["layout"] as? [String: Any])
      var content = try XCTUnwrap(layout["content"] as? [String: Any])
      var children = try XCTUnwrap(content["children"] as? [[String: Any]])
      let selectorIndex = try XCTUnwrap(
        children.firstIndex { $0["type"] as? String == "productSelector" }
      )
      var selector = children.remove(at: selectorIndex)
      var cards = try XCTUnwrap(selector["cards"] as? [[String: Any]])
      for index in cards.indices {
        let referenceID = cards[index]["productReferenceId"] as? String
        guard referenceID == "monthly-plan" || referenceID == "yearly-plan" else { continue }
        let color = referenceID == "monthly-plan" ? "#FF0000FF" : "#00FF00FF"
        var styles = try XCTUnwrap(cards[index]["styles"] as? [String: Any])
        var defaultStyle = try XCTUnwrap(styles["default"] as? [String: Any])
        defaultStyle["background"] = ["type": "color", "value": color]
        defaultStyle["border"] = ["color": color, "width": 1]
        defaultStyle["cornerRadius"] = 0
        styles["default"] = defaultStyle
        var selectedStyle = try XCTUnwrap(styles["selected"] as? [String: Any])
        selectedStyle["background"] = ["type": "color", "value": color]
        selectedStyle["border"] = ["color": color, "width": 1]
        selectedStyle["cornerRadius"] = 0
        styles["selected"] = selectedStyle
        cards[index]["styles"] = styles
      }
      selector["cards"] = cards
      children.insert(selector, at: 0)
      content["children"] = children
      layout["content"] = content
      initialScreen["layout"] = layout
      screens[initialScreenIndex] = initialScreen
      object["screens"] = screens
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func v02DocumentWithBundledSheetVideo() throws -> MosaicPaywallDocument {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v02FixtureData()) as? [String: Any]
      )
      var screens = try XCTUnwrap(object["screens"] as? [[String: Any]])
      let sheetIndex = try XCTUnwrap(
        screens.firstIndex { screen in
          (screen["presentation"] as? [String: Any])?["type"] as? String == "sheet"
        }
      )
      var sheet = screens[sheetIndex]
      var layout = try XCTUnwrap(sheet["layout"] as? [String: Any])
      layout["background"] = ["type": "backgroundToken", "id": "ambient-video"]
      sheet["layout"] = layout
      screens[sheetIndex] = sheet
      object["screens"] = screens
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func v02DocumentWithHorizontalCloseButton(width: String) throws
      -> MosaicPaywallDocument
    {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v02FixtureData()) as? [String: Any]
      )
      try mutateV02Node(id: "close", in: &object) { close in
        close["sizing"] = ["width": width, "height": "fit"]
      }
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func v02DocumentWithFixedWidthNestedStackInHorizontalStack() throws
      -> MosaicPaywallDocument
    {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v02FixtureData()) as? [String: Any]
      )
      try mutateV02Node(id: "close-actions", in: &object) { closeActions in
        guard var close = (closeActions["children"] as? [[String: Any]])?.first else {
          return
        }
        close["sizing"] = ["width": "fill", "height": "fit"]
        closeActions["children"] = [
          [
            "type": "stack",
            "id": "fixed-width-close-container",
            "direction": "vertical",
            "gap": 0,
            "padding": ["top": 0, "start": 0, "bottom": 0, "end": 0],
            "mainAxisDistribution": "start",
            "crossAxisAlignment": "stretch",
            "sizing": [
              "width": ["mode": "fixed", "value": 120],
              "height": "fit",
            ],
            "children": [close],
          ]
        ]
      }
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func pixelBounds(
      in image: UIImage,
      red: UInt8,
      green: UInt8,
      blue: UInt8
    ) throws -> CGRect? {
      let cgImage = try XCTUnwrap(image.cgImage)
      let pixels = try rgbaPixels(image)
      var minX = cgImage.width
      var minY = cgImage.height
      var maxX = -1
      var maxY = -1

      for y in 0..<cgImage.height {
        for x in 0..<cgImage.width {
          let offset = (y * cgImage.width + x) * 4
          if pixels[offset] == red,
            pixels[offset + 1] == green,
            pixels[offset + 2] == blue,
            pixels[offset + 3] == 255
          {
            minX = min(minX, x)
            minY = min(minY, y)
            maxX = max(maxX, x)
            maxY = max(maxY, y)
          }
        }
      }

      guard maxX >= minX, maxY >= minY else {
        return nil
      }
      return CGRect(
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      )
    }
  }

  private struct SnapshotComparison {
    let differentPixelRatio: Double
  }
#endif
