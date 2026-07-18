import SwiftUI
import XCTest

@testable import MosaicSDK

@MainActor
final class AccessibilityTests: XCTestCase {
  func testProjectionPreservesRecursiveSourceOrderRolesLabelsAndSelectionState() async throws {
    let document = try canonicalDocument()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      ),
      onResult: { _ in }
    )
    await model.prepare()
    let projection = model.accessibilityProjection()

    XCTAssertEqual(projection.direction, .leftToRight)
    XCTAssertEqual(
      projection.elements.map(\.id),
      [
        "close", "hero", "headline", "subtitle", "features",
        "features.unlimited-projects", "features.native-rendering", "features.offline-ready",
        "plans", "plans.monthly-plan", "plans.yearly-plan", "purchase", "restore", "legal",
      ]
    )
    XCTAssertEqual(projection.elements.first { $0.id == "headline" }?.role, .heading(level: 1))
    XCTAssertEqual(projection.elements.first { $0.id == "hero" }?.role, .image)
    XCTAssertEqual(
      projection.elements.first { $0.id == "plans.yearly-plan" }?.isSelected,
      true
    )
    XCTAssertEqual(
      projection.elements.first { $0.id == "plans.yearly-plan" }?.value,
      "Best value, $49.99, per year"
    )
    XCTAssertEqual(projection.elements.first { $0.id == "purchase" }?.isEnabled, true)
    XCTAssertEqual(
      projection.elements.first { $0.id == "purchase" }?.hint,
      "Starts the purchase for the selected subscription plan"
    )
  }

  func testUnavailableProjectionIncludesLocalizedMessageAndDisabledPurchase() async throws {
    let document = try canonicalDocument()
    let model = MosaicPaywallModel(
      document: document,
      requestedLocale: "de-DE",
      purchaseProvider: MockMosaicPurchaseProvider(),
      onResult: { _ in }
    )
    await model.prepare()
    let projection = model.accessibilityProjection()

    XCTAssertEqual(
      projection.elements.first { $0.id == "plans.unavailable" }?.label,
      "Tarife sind vorübergehend nicht verfügbar."
    )
    XCTAssertEqual(projection.elements.first { $0.id == "purchase" }?.isEnabled, false)
  }

  func testRTLProjectionUsesArabicLabelsAndDirection() async throws {
    let document = try canonicalDocument()
    let model = MosaicPaywallModel(
      document: document,
      requestedLocale: "ar-EG",
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      ),
      onResult: { _ in }
    )
    await model.prepare()
    let projection = model.accessibilityProjection()

    XCTAssertEqual(projection.direction, .rightToLeft)
    XCTAssertEqual(projection.elements.first { $0.id == "close" }?.label, "إغلاق")
    XCTAssertEqual(
      projection.elements.first { $0.id == "plans.yearly-plan" }?.label,
      "سنوي"
    )
  }

  func testDecorativeImageIsOmittedFromAccessibilityProjection() async throws {
    var object = try canonicalFixtureObject()
    try mutateFirstNode(type: "image", in: &object) { node in
      node["accessibility"] = ["hidden": true]
    }
    var localization = try XCTUnwrap(object["localization"] as? [String: Any])
    var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
    for locale in ["en", "de", "ar"] {
      var catalog = try XCTUnwrap(locales[locale] as? [String: Any])
      var strings = try XCTUnwrap(catalog["strings"] as? [String: Any])
      strings.removeValue(forKey: "paywall.hero.alt")
      catalog["strings"] = strings
      locales[locale] = catalog
    }
    localization["locales"] = locales
    object["localization"] = localization

    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      ),
      onResult: { _ in }
    )
    await model.prepare()

    XCTAssertFalse(model.accessibilityProjection().elements.contains { $0.id == "hero" })
  }

  func testMissingLogicalAssetUsesDeclaredLocalizedPlaceholderPath() throws {
    let document = try canonicalDocument()
    let asset = try XCTUnwrap(document.assets.single)
    let resolver = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: "ar"
    )

    XCTAssertNil(MosaicImageResolver.missing.image(for: asset.source.key))
    XCTAssertEqual(asset.source.key, "mosaic.paywall.hero")
    XCTAssertEqual(
      resolver.resolve(try XCTUnwrap(asset.fallback).value),
      "الرسم التوضيحي المميز غير متاح"
    )
  }
}

extension Collection {
  fileprivate var single: Element? { count == 1 ? first : nil }
}
