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
      let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
      }
      window.isHidden = true
      return image
    }

    private func sourceSnapshotURL() -> URL {
      URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("Resources")
        .appendingPathComponent("complete-paywall.png")
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
  }

  private struct SnapshotComparison {
    let differentPixelRatio: Double
  }
#endif
