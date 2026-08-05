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

  /// The cross-SDK locale-resolution corpus. Every case must agree with the
  /// protocol's reference implementation
  /// (`protocol/tools/locale-resolution-v0.2.mjs`), so iOS cannot drift from
  /// Flutter or Compose on which catalog a device reaches.
  ///
  /// The corpus lists candidates as catalog *keys*, declared or not, while
  /// `candidateLocales` reports only the declared ones it will actually consult;
  /// the expectation is filtered accordingly.
  func testCanonicalLocaleResolutionCorpus() throws {
    let corpus = try XCTUnwrap(
      try JSONSerialization.jsonObject(with: v02FixtureData(named: "locale-resolution.json"))
        as? [String: Any])
    let declaration = try XCTUnwrap(corpus["localization"] as? [String: Any])
    let declared = try XCTUnwrap(declaration["locales"] as? [String])
    let localization = try JSONDecoder().decode(
      MosaicLocalization.self,
      from: try JSONSerialization.data(withJSONObject: [
        "defaultLocale": try XCTUnwrap(declaration["defaultLocale"]),
        "fallbackLocale": try XCTUnwrap(declaration["fallbackLocale"]),
        "locales": Dictionary(
          uniqueKeysWithValues: declared.map { ($0, ["direction": "ltr", "strings": [:]]) }),
      ]))

    let cases = try XCTUnwrap(corpus["cases"] as? [[String: Any]])
    XCTAssertEqual(cases.count, 13, "The test must exercise every corpus case.")
    for testCase in cases {
      let name = try XCTUnwrap(testCase["name"] as? String)
      let requested = try XCTUnwrap(testCase["requested"] as? String)
      let expectedCandidates = try XCTUnwrap(testCase["expectedCandidates"] as? [String])
      let resolved = MosaicLocalizationResolver(
        localization: localization, requestedLocale: requested
      ).resolvedLocale

      XCTAssertEqual(resolved.effectiveLocale, testCase["expectedCatalog"] as? String, name)
      XCTAssertEqual(
        resolved.candidateLocales, expectedCandidates.filter(declared.contains), name)
    }
  }

  /// Hosts pass whatever the platform hands them, and on Apple platforms that
  /// is an ICU identifier (`en_US`, or `en-US-u-rg-gbzzzz` under a region
  /// override), not a BCP-47 tag. Matching those raw against strict catalog
  /// keys missed every regional catalog and silently rendered the document's
  /// default language — and, for an RTL request, mirrored the layout.
  func testICUDeviceIdentifiersResolveTheSameCatalogAsTheirBCP47Tags() throws {
    var object = try canonicalFixtureObject()
    var localization = try XCTUnwrap(object["localization"] as? [String: Any])
    var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
    var regional = try XCTUnwrap(locales["en"] as? [String: Any])
    var strings = try XCTUnwrap(regional["strings"] as? [String: Any])
    strings["paywall.headline"] = "United States headline"
    regional["strings"] = strings
    locales["en-US"] = regional
    localization["locales"] = locales
    object["localization"] = localization

    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let headline = try XCTUnwrap(textComponent(id: "headline", in: document))
    // The already-normalized tag is the control: the ICU forms must resolve
    // identically to it.
    // The last three carry the ICU keyword, POSIX charset, and Java extension
    // markers. Without the pre-cut they reach the `en` catalog instead of the
    // regional one the device asked for, which the corpus alone cannot catch:
    // its document declares no `en-US`.
    for requested in [
      "en-US", "en_US", "en_US@rg=gbzzzz", "en-US-u-rg-gbzzzz", "en_US.UTF-8",
      "en_US_#u-rg-gbzzzz",
    ] {
      let resolver = MosaicLocalizationResolver(
        localization: document.localization, requestedLocale: requested)
      XCTAssertEqual(resolver.resolvedLocale.effectiveLocale, "en-US", requested)
      XCTAssertEqual(resolver.resolvedLocale.candidateLocales.prefix(2), ["en-US", "en"], requested)
      XCTAssertEqual(resolver.resolve(headline.value), "United States headline", requested)
      XCTAssertEqual(resolver.resolvedLocale.direction, .leftToRight, requested)
      // The host's own value is echoed back unchanged for diagnostics.
      XCTAssertEqual(resolver.resolvedLocale.requestedLocale, requested)
    }

    // The layout consequence: an ICU Arabic identifier must reach the RTL
    // catalog through its base language instead of falling to the LTR default.
    let arabic = MosaicLocalizationResolver(
      localization: document.localization, requestedLocale: "ar_EG@calendar=islamic")
    XCTAssertEqual(arabic.resolvedLocale.effectiveLocale, "ar")
    XCTAssertEqual(arabic.resolvedLocale.direction, .rightToLeft)

    // An unrecognizable tag stays unmatched rather than being substituted with
    // a language the host never asked for.
    let unusable = MosaicLocalizationResolver(
      localization: document.localization, requestedLocale: "@calendar=islamic")
    XCTAssertEqual(unusable.resolvedLocale.effectiveLocale, "en")
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
    let legal = try XCTUnwrap(textComponent(id: "legal", in: document))
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
    let legal = try XCTUnwrap(textComponent(id: "legal", in: document))

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

  /// Direction used to hard-default to LTR whenever the effective locale had no
  /// catalog, so an RTL document whose default locale is undeclared laid itself
  /// out mirrored, silently. Direction now follows the same fallback chain the
  /// strings do, and says so when the chain is exhausted.
  func testDirectionFollowsTheLocaleChainAndDiagnosesWhenItIsExhausted() throws {
    let declaredFallback = try JSONDecoder().decode(
      MosaicLocalization.self,
      from: Data(
        #"{"defaultLocale":"fa","fallbackLocale":"ar","locales":{"ar":{"direction":"rtl","strings":{}}}}"#
          .utf8)
    )
    let resolved = MosaicLocalizationResolver(localization: declaredFallback).resolvedLocale
    XCTAssertEqual(resolved.effectiveLocale, "ar")
    XCTAssertEqual(resolved.direction, .rightToLeft)
    XCTAssertEqual(resolved.diagnostics, [])

    let undeclared = try JSONDecoder().decode(
      MosaicLocalization.self,
      from: Data(
        #"{"defaultLocale":"fa","fallbackLocale":"fa","locales":{"en":{"direction":"ltr","strings":{}}}}"#
          .utf8)
    )
    let exhausted = MosaicLocalizationResolver(localization: undeclared).resolvedLocale
    XCTAssertEqual(exhausted.direction, .leftToRight)
    XCTAssertEqual(exhausted.diagnostics, ["localization_direction_unresolved"])
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
