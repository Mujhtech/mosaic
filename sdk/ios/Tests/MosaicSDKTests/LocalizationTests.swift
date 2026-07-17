import Foundation
import XCTest

@testable import MosaicSDK

final class LocalizationTests: XCTestCase {
  func testUsesExactRequestedLocaleBeforeBaseLanguage() throws {
    var object = try canonicalFixtureObject()
    var localization = try XCTUnwrap(object["localization"] as? [String: Any])
    var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
    var regional = try XCTUnwrap(locales["de"] as? [String: Any])
    var strings = try XCTUnwrap(regional["strings"] as? [String: Any])
    strings["paywall.headline"] = "Exakte regionale Übersetzung"
    regional["strings"] = strings
    locales["de-DE"] = regional
    localization["locales"] = locales
    object["localization"] = localization

    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let resolver = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: "de-DE"
    )
    let headline = try XCTUnwrap(textComponent(id: "headline", in: document))

    XCTAssertEqual(resolver.resolvedLocale.candidateLocales.prefix(2), ["de-DE", "de"])
    XCTAssertEqual(resolver.resolve(headline.value), "Exakte regionale Übersetzung")
    XCTAssertEqual(resolver.resolvedLocale.direction, .leftToRight)
  }

  func testUsesBaseLanguageForLongGermanLocalization() throws {
    let document = try canonicalDocument()
    let resolver = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: "de-AT"
    )
    let subtitle = try XCTUnwrap(textComponent(id: "subtitle", in: document))
    let resolved = resolver.resolve(subtitle.value)

    XCTAssertEqual(resolver.resolvedLocale.effectiveLocale, "de")
    XCTAssertGreaterThan(resolved.count, subtitle.value.defaultValue.count)
    XCTAssertTrue(resolved.contains("Jetpack Compose"))
  }

  func testFallsFromFallbackLocaleToDefaultLocalePerKey() throws {
    var object = try canonicalFixtureObject()
    var localization = try XCTUnwrap(object["localization"] as? [String: Any])
    var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
    locales["fr"] = [
      "direction": "ltr",
      "strings": ["paywall.legal": "Mentions légales de remplacement"],
    ]
    localization["fallbackLocale"] = "fr"
    localization["locales"] = locales
    object["localization"] = localization

    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let resolver = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: "es-MX"
    )
    let legal = try XCTUnwrap(legalText(in: document))
    let headline = try XCTUnwrap(textComponent(id: "headline", in: document))

    XCTAssertEqual(resolver.resolvedLocale.candidateLocales, ["fr", "en"])
    XCTAssertEqual(resolver.resolve(legal.value), "Mentions légales de remplacement")
    XCTAssertEqual(resolver.resolve(headline.value), headline.value.defaultValue)
  }

  func testArabicDirectionComesFromFirstDeclaredCandidateIndependentlyOfTextFallback() throws {
    var object = try canonicalFixtureObject()
    var localization = try XCTUnwrap(object["localization"] as? [String: Any])
    var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
    var arabic = try XCTUnwrap(locales["ar"] as? [String: Any])
    var strings = try XCTUnwrap(arabic["strings"] as? [String: Any])
    strings.removeValue(forKey: "paywall.legal")
    arabic["strings"] = strings
    locales["ar"] = arabic
    localization["locales"] = locales
    object["localization"] = localization

    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let resolver = MosaicLocalizationResolver(
      localization: document.localization,
      requestedLocale: "ar-EG"
    )
    let headline = try XCTUnwrap(textComponent(id: "headline", in: document))
    let legal = try XCTUnwrap(legalText(in: document))

    XCTAssertEqual(resolver.resolvedLocale.effectiveLocale, "ar")
    XCTAssertEqual(resolver.resolvedLocale.direction, .rightToLeft)
    XCTAssertEqual(resolver.resolve(headline.value), "افتح جميع مزايا Mosaic Pro")
    XCTAssertEqual(resolver.resolve(legal.value), legal.value.defaultValue)
  }

  func testUsesInlineDefaultAfterAllCatalogCandidatesMiss() throws {
    let localizationData = Data(
      #"{"defaultLocale":"en","fallbackLocale":"en","locales":{"en":{"direction":"ltr","strings":{"other.key":"Other"}}}}"#
        .utf8
    )
    let textData = Data(
      #"{"default":"Inline value","localizationKey":"missing.key"}"#.utf8
    )
    let localization = try JSONDecoder().decode(MosaicLocalization.self, from: localizationData)
    let text = try JSONDecoder().decode(MosaicLocalizedText.self, from: textData)

    XCTAssertEqual(
      MosaicLocalizationResolver(localization: localization).resolve(text),
      "Inline value"
    )
  }
}

private func textComponent(
  id: String,
  in document: MosaicPaywallDocument
) -> MosaicTextComponent? {
  for node in flattenedNodes(document.layout.content) {
    if case .text(let text) = node, text.id == id { return text }
  }
  return nil
}

private func legalText(in document: MosaicPaywallDocument) -> MosaicLegalTextComponent? {
  for node in flattenedNodes(document.layout.content) {
    if case .legalText(let legal) = node { return legal }
  }
  return nil
}
