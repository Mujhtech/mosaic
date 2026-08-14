#if canImport(UIKit)
  import AVFoundation
  import SwiftUI
  import UIKit
  import XCTest

  @testable import MosaicSDK

  @MainActor
  final class SwiftUISnapshotTests: XCTestCase {
    /// The one canonical full-paywall golden.
    ///
    /// This previously had a sibling that rendered `canonicalDocument()`
    /// against a separate baseline. Both helpers resolve to
    /// `protocol/fixtures/v0.4/complete-paywall.json`, so the two tests rendered
    /// the same document and produced byte-identical output. They are now one
    /// test with one baseline.
    ///
    /// The clock is pinned because the fixture's Countdown resolves against it.
    func testCanonicalFixtureMatchesDeterministicSwiftUIGolden() async throws {
      let document = try v04Document()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        clock: { Date(timeIntervalSince1970: 1_893_455_998) },
        // A golden records the settled paywall, so motion is disabled rather
        // than raced. The default driver runs the entrance in real time against
        // a 50 ms capture window, so a golden taken through it records whichever
        // frame the entrance happened to be on — for the canonical document that
        // is its first, with the headline, subtitle, and feature list still at
        // opacity zero. The terminal-state test proves the two agree.
        motionDriver: .disabled(),
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
      let snapshotURL = sourceSnapshotURL(named: "complete-paywall.png")

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
          "The Protocol iOS golden has not been recorded. "
            + "Run the documented MOSAIC_RECORD_SNAPSHOTS=1 simulator command first."
        )
      }
      let expected = try XCTUnwrap(UIImage(contentsOfFile: snapshotURL.path))
      let comparison = try compare(actual: image, expected: expected)
      XCTAssertLessThanOrEqual(
        comparison.differentPixelRatio,
        0.005,
        "Protocol SwiftUI golden changed: \(comparison.differentPixelRatio * 100)% pixels differ."
      )
    }

    /// A second golden covering the four Protocol components.
    ///
    /// The full-paywall golden renders into a fixed 390-by-844 frame, so it
    /// captures only the top of the scroll view — the new components sit below
    /// the fold and appear in none of its pixels. A golden that does not
    /// contain a component cannot detect a regression in it, so this one hoists
    /// them to the top of the root stack and uses a taller frame.
    func testPresentationComponentsMatchDeterministicSwiftUIGolden() async throws {
      let document = try v04DocumentWithPresentationComponentsFirst()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        clock: { Date(timeIntervalSince1970: 1_893_455_998) },
        // A golden records the settled paywall, so motion is disabled rather
        // than raced. The default driver runs the entrance in real time against
        // a 50 ms capture window, so a golden taken through it records whichever
        // frame the entrance happened to be on — for the canonical document that
        // is its first, with the headline, subtitle, and feature list still at
        // opacity zero. The terminal-state test proves the two agree.
        motionDriver: .disabled(),
        onResult: { _ in }
      )
      await model.prepare()

      let image = render(
        MosaicPaywall(model: model, imageResolver: .missing)
          .environment(\.colorScheme, .light)
          .environment(\.sizeCategory, .large)
          .background(Color.white),
        size: CGSize(width: 390, height: 1_000)
      )
      let snapshotURL = sourceSnapshotURL(named: "presentation-components.png")

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
          "The Protocol presentation-component golden has not been recorded. "
            + "Run the documented MOSAIC_RECORD_SNAPSHOTS=1 simulator command first."
        )
      }
      let expected = try XCTUnwrap(UIImage(contentsOfFile: snapshotURL.path))
      let comparison = try compare(actual: image, expected: expected)
      XCTAssertLessThanOrEqual(
        comparison.differentPixelRatio,
        0.005,
        "Protocol presentation-component golden changed: "
          + "\(comparison.differentPixelRatio * 100)% pixels differ."
      )
    }

    func testHorizontalProductSelectorPlacesCardsSideBySide() async throws {
      let document = try v04DocumentWithProductSelectorFirst()
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
      let document = try v04DocumentWithHorizontalCloseButton(width: "fill")
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
      let document = try v04DocumentWithFixedWidthNestedStackInHorizontalStack()
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

    func testNavigateToSheetUsesNativeModalOverTheBaseScreen() async throws {
      let document = try v04DocumentWithBundledSheetVideo()
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

    /// The terminal frame of every authored motion renders exactly the static
    /// rendering.
    ///
    /// This is the pixel-level half of the rule the whole `renderWithoutMotion`
    /// enhancement tier rests on: a reader that cannot animate draws what an
    /// animating reader ends at. It compares two renders of the same `0.4`
    /// document in-process — the driver disabled, which is how every static
    /// golden is captured, against a controlled driver wound past the end of the
    /// longest authored motion — so it needs no new baseline file and cannot go
    /// stale against one.
    func testProtocolV04MotionAtItsEndRendersTheStaticDocument() async throws {
      let size = CGSize(width: 390, height: 844)
      let document = try v04Document()
      func image(
        driver: @escaping @autoclosure () -> MosaicMotionDriver,
        advanceTo: Int? = nil
      ) async -> UIImage {
        let driver = driver()
        let model = MosaicPaywallModel(
          document: document,
          requestedLocale: "en",
          purchaseProvider: MockMosaicPurchaseProvider(
            products: MosaicProduct.phase1MockProducts
          ),
          clock: { Date(timeIntervalSince1970: 1_893_455_998) },
          motionDriver: driver,
          onResult: { _ in }
        )
        await model.prepare()
        // After `prepare`, which is what stamps each surface's entry origin at
        // the driver's current time. Winding the clock forward only now is what
        // makes the elapsed time *since entry* reach the end of the motion; a
        // driver constructed already at the end stamps its entry there too and
        // sits at the entrance's first frame forever.
        if let advanceTo { driver.advance(to: advanceTo) }
        return render(
          MosaicPaywall(
            model: model,
            imageResolver: .missing,
            motionAccessibility: .unrestricted
          )
          .environment(\.colorScheme, .light)
          .environment(\.sizeCategory, .large)
          .background(Color.white),
          size: size
        )
      }

      let staticRendering = await image(driver: .disabled())
      // Past the last delay plus the longest curve, and past three 900 ms pulse
      // cycles, so nothing authored is still running.
      let ended = await image(driver: .controlled(), advanceTo: 60_000)
      let comparison = try compare(actual: ended, expected: staticRendering)
      XCTAssertEqual(
        comparison.differentPixelRatio, 0,
        "A finished animation must be byte-identical to the static rendering."
      )
    }

    /// Under reduced motion a video background does not play: the declared
    /// poster is drawn and no player is built at all.
    ///
    /// Protects the accessibility ruling (ADR-0027, ruling 3) — an autoplaying
    /// paywall video can invalidate a customer's App Store Reduced Motion
    /// declaration.
    ///
    /// The hierarchy walk is the load-bearing assertion. This test previously
    /// checked only that no unavailable-video diagnostic was recorded, which is
    /// equally true of a video that plays perfectly, so it passed with the guard
    /// deleted. `AVPlayerLayer` is the layer class the renderer's player view
    /// installs, so its absence is the SwiftUI equivalent of Flutter's
    /// `findsNothing`: nothing was constructed, rather than constructed and
    /// paused. The decision itself is pinned in `MotionDriverTests`, which runs
    /// on the development host as well as the Simulator.
    func testReducedMotionRendersVideoBackgroundPosterWithoutPlayback() async throws {
      let document = try v04DocumentWithVideoBackgroundOnTheOfferScreen()
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: "en",
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts
        ),
        onResult: { _ in }
      )
      await model.prepare()

      // The decision the background view consumes, for the exact document and
      // preference rendered below: the poster, and not because anything failed.
      XCTAssertEqual(document.schemaVersion, mosaicProtocolVersion)
      XCTAssertEqual(
        MosaicVideoBackgroundPresentation.resolve(
          resolvedSource: URL(string: "https://cdn.mosaic.dev/video/sheet.mp4"),
          posterID: "remote-texture",
          accessibility: .reduced
        ),
        .still(posterID: "remote-texture", recordsUnavailable: false)
      )

      let views = hostedViews(
        MosaicPaywall(
          model: model,
          imageResolver: .missing,
          motionAccessibility: .reduced
        )
        .environment(\.colorScheme, .light)
        .background(Color.white),
        size: CGSize(width: 390, height: 844)
      )

      XCTAssertFalse(
        views.contains { $0.layer is AVPlayerLayer },
        "Reduced motion must build no player, not build one and pause it."
      )
      XCTAssertFalse(
        model.diagnostics.contains { $0.code == "media_video_background_unavailable" },
        "A video suppressed by reduced motion has not failed and must not diagnose."
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

    func testArabicRTLAtAccessibilityTextSizeRendersWithoutFailure() async throws {
      let document = try v04Document()
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
        "The Protocol RTL accessibility-size renderer should produce visible content."
      )
    }

    /// Hosts `view` and returns every `UIView` built underneath it.
    ///
    /// For assertions about what the renderer constructed rather than what it
    /// looks like. Pixels cannot distinguish a video paused on its first frame
    /// from a poster, and a diagnostic cannot distinguish either from a video
    /// that played.
    private func hostedViews<V: View>(_ view: V, size: CGSize) -> [UIView] {
      let controller = UIHostingController(
        rootView: view.frame(width: size.width, height: size.height))
      let window = UIWindow(frame: CGRect(origin: .zero, size: size))
      window.rootViewController = controller
      window.isHidden = false
      controller.view.frame = window.bounds
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()
      RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))

      var views: [UIView] = []
      var pending = [controller.view!]
      while let next = pending.popLast() {
        views.append(next)
        pending.append(contentsOf: next.subviews)
      }
      window.isHidden = true
      return views
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

    /// Baselines are recorded at scale 1 into a fixed 390x844 frame, so they are
    /// independent of the Simulator device. They are not independent of the
    /// runtime's native control rendering: the current baselines were recorded
    /// on Xcode 26.5 with the iOS 26.5 Simulator runtime. Compare and re-record
    /// on that runtime.
    private func sourceSnapshotURL(named name: String) -> URL {
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

    private func v04DocumentWithProductSelectorFirst() throws -> MosaicPaywallDocument {
      let data = try v04FixtureData()
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
        // The probe measures pure-colour pixels, so the card must be fully
        // opaque. The fixture authors an unselected opacity below 1, which
        // composites the marker colour into something the probe cannot see:
        // the measurement would then report a one-pixel border row instead of
        // the card, and the layout assertion would fail for a reason that has
        // nothing to do with layout.
        defaultStyle["opacity"] = 1
        styles["default"] = defaultStyle
        var selectedStyle = try XCTUnwrap(styles["selected"] as? [String: Any])
        selectedStyle["background"] = ["type": "color", "value": color]
        selectedStyle["border"] = ["color": color, "width": 1]
        selectedStyle["cornerRadius"] = 0
        selectedStyle["opacity"] = 1
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

    /// Hoists the Tabs, Timeline, Award, and Social Proof components to the top
    /// of the initial screen so a fixed-frame render contains them. Only child
    /// order changes; every component keeps its authored content and styling.
    private func v04DocumentWithPresentationComponentsFirst() throws -> MosaicPaywallDocument {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any]
      )
      let initialScreenID = try XCTUnwrap(object["initialScreenId"] as? String)
      var screens = try XCTUnwrap(object["screens"] as? [[String: Any]])
      let index = try XCTUnwrap(
        screens.firstIndex { $0["id"] as? String == initialScreenID }
      )
      var screen = screens[index]
      var layout = try XCTUnwrap(screen["layout"] as? [String: Any])
      var content = try XCTUnwrap(layout["content"] as? [String: Any])
      let children = try XCTUnwrap(content["children"] as? [[String: Any]])
      let hoisted = Set(["tabs", "timeline", "award", "socialProof"])
      // A node conditioned on tab selection must stay with its Tabs component,
      // and the whole reorder must remain a valid document, so the partition
      // preserves relative order within each group.
      let promoted = children.filter { hoisted.contains($0["type"] as? String ?? "") }
      let remainder = children.filter { !hoisted.contains($0["type"] as? String ?? "") }
      XCTAssertEqual(promoted.count, 7, "Expected the fixture's seven 0.3 components.")
      content["children"] = promoted + remainder
      layout["content"] = content
      screen["layout"] = layout
      screens[index] = screen
      object["screens"] = screens
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    /// The canonical `0.4` document with the poster-carrying video background
    /// moved onto the base screen.
    ///
    /// The fixture declares it on the `details` sheet, which is presented into a
    /// separate hierarchy; the base screen is what a hosting controller can be
    /// walked from.
    /// The canonical document with the `details` sheet's video background pointed
    /// at a *bundled* asset whose key no resolver maps.
    ///
    /// The fixture authors that sheet with a remote video, which always resolves
    /// to its URL — whether it would actually load is the player's question — so
    /// it can never exercise the unavailable-media path. A bundled key is
    /// unresolvable by lookup alone, which is what makes the decorative-video
    /// fallback and its diagnostic reachable.
    private func v04DocumentWithBundledSheetVideo() throws -> MosaicPaywallDocument {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any]
      )
      var assets = try XCTUnwrap(object["assets"] as? [[String: Any]])
      let index = try XCTUnwrap(assets.firstIndex { $0["id"] as? String == "remote-sheet-video" })
      // Only the asset's *source* changes. Repointing the background at another
      // asset would orphan this one, and an unreferenced asset is itself a
      // semantic violation.
      assets[index]["source"] = ["type": "bundled", "key": "mosaic.sheet.video"]
      object["assets"] = assets
      // With no remote video left, declaring the capability would be an unused
      // declaration, which the semantic validator rejects in both directions.
      var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
      let capabilities = try XCTUnwrap(
        compatibility["requiredCapabilities"] as? [[String: Any]])
      compatibility["requiredCapabilities"] = capabilities.filter {
        $0["name"] as? String != MosaicCapabilityName.remoteVideo.rawValue
      }
      object["compatibility"] = compatibility
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func v04DocumentWithVideoBackgroundOnTheOfferScreen() throws
      -> MosaicPaywallDocument
    {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any]
      )
      var screens = try XCTUnwrap(object["screens"] as? [[String: Any]])
      let index = try XCTUnwrap(screens.firstIndex { $0["id"] as? String == "offer" })
      var screen = screens[index]
      var layout = try XCTUnwrap(screen["layout"] as? [String: Any])
      layout["background"] = ["type": "backgroundToken", "id": "sheet-video"]
      screen["layout"] = layout
      screens[index] = screen
      object["screens"] = screens
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func v04DocumentWithHorizontalCloseButton(width: String) throws
      -> MosaicPaywallDocument
    {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any]
      )
      try mutateNode(id: "close", in: &object) { close in
        close["sizing"] = ["width": width, "height": "fit"]
      }
      return try MosaicProtocolDecoder.decode(
        JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      )
    }

    private func v04DocumentWithFixedWidthNestedStackInHorizontalStack() throws
      -> MosaicPaywallDocument
    {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any]
      )
      try mutateNode(id: "close-actions", in: &object) { closeActions in
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
