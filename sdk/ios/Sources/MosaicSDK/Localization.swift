import Foundation

public struct MosaicResolvedLocale: Sendable, Equatable {
  public let requestedLocale: String?
  public let candidateLocales: [String]
  public let effectiveLocale: String
  public let direction: MosaicLayoutDirection
  /// Diagnostic codes the presentation records for this resolution. Empty when
  /// the direction came from a declared catalog.
  public let diagnostics: [String]

  public init(
    requestedLocale: String?,
    candidateLocales: [String],
    effectiveLocale: String,
    direction: MosaicLayoutDirection,
    diagnostics: [String] = []
  ) {
    self.requestedLocale = requestedLocale
    self.candidateLocales = candidateLocales
    self.effectiveLocale = effectiveLocale
    self.direction = direction
    self.diagnostics = diagnostics
  }
}

/// Resolves protocol strings and layout direction using the exact RC1 chain:
/// requested tag, base language, fallback locale, default locale, then inline
/// default. Direction comes from the first declared candidate independently of
/// whether that catalog contains a particular string.
public struct MosaicLocalizationResolver: Sendable, Equatable {
  public let localization: MosaicLocalization
  public let resolvedLocale: MosaicResolvedLocale

  public init(localization: MosaicLocalization, requestedLocale: String? = nil) {
    self.localization = localization

    var candidates: [String] = []
    func appendDeclared(_ locale: String) {
      guard localization.locales[locale] != nil, !candidates.contains(locale) else {
        return
      }
      candidates.append(locale)
    }

    if let requestedLocale, !requestedLocale.isEmpty {
      // Hosts pass what the platform hands them, which is an ICU identifier
      // (`en_US`, `PT_br`, `en-US-u-rg-gbzzzz`), while catalog keys are authored
      // in one canonical spelling. Protocol 0.3 canonicalizes the requested tag
      // before an exact lookup; matching raw would miss the only catalog that
      // exists. A tag that canonicalizes to nothing contributes no candidate
      // rather than matching anything.
      if let tag = MosaicDeviceLocale.catalogTag(requestedLocale) {
        appendDeclared(tag)
        if let base = tag.split(separator: "-", maxSplits: 1).first {
          appendDeclared(String(base))
        }
      }
      appendDeclared(localization.fallbackLocale)
      appendDeclared(localization.defaultLocale)
    } else {
      appendDeclared(localization.defaultLocale)
      appendDeclared(localization.fallbackLocale)
    }

    let effectiveLocale = candidates.first ?? localization.defaultLocale
    // Direction follows the same chain as strings do. Defaulting an RTL
    // document to LTR because its effective locale has no catalog mirrors the
    // layout, so the chain is exhausted first and the shortfall is diagnosed
    // rather than silently assumed.
    let directionChain =
      candidates + [effectiveLocale, localization.fallbackLocale, localization.defaultLocale]
    let declaredDirection = directionChain.lazy
      .compactMap { localization.locales[$0]?.direction }
      .first
    resolvedLocale = MosaicResolvedLocale(
      requestedLocale: requestedLocale,
      candidateLocales: candidates,
      effectiveLocale: effectiveLocale,
      direction: declaredDirection ?? .leftToRight,
      diagnostics: declaredDirection == nil ? ["localization_direction_unresolved"] : []
    )
  }

  public func resolve(_ value: MosaicLocalizedText) -> String {
    for locale in resolvedLocale.candidateLocales {
      if let resolved = localization.locales[locale]?.strings[value.localizationKey] {
        return resolved
      }
    }
    return value.defaultValue
  }

  /// Resolves a key the protocol reads directly.
  ///
  /// Reserved keys carry no inline `default`, because no component references
  /// them. An absent key returns `nil` so the caller announces nothing rather
  /// than substituting a literal in a language it cannot know; the semantic
  /// validator already rejects a document that omits a key it consumes.
  public func resolve(reserved key: MosaicReservedAccessibilityKey) -> String? {
    for locale in resolvedLocale.candidateLocales {
      if let resolved = localization.locales[locale]?.strings[key.rawValue] {
        return resolved
      }
    }
    return nil
  }

  public func resolve(
    _ value: MosaicLocalizedText,
    for option: MosaicResolvedProductOption
  ) -> String {
    let localized = resolve(value)
    let fallbackName = resolve(option.reference.label)
    let providerName = option.product.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return MosaicProductTemplate.interpolate(
      localized,
      productName: providerName.isEmpty ? fallbackName : option.product.title,
      localizedPrice: option.product.localizedPrice
    )
  }
}

enum MosaicProductTemplate {
  private static let expression = try? NSRegularExpression(
    pattern: #"\{\{\s*product\.(name|price)\s*\}\}"#
  )

  struct Analysis: Equatable {
    let variables: [String]
    let malformed: Bool
  }

  static func analyze(_ value: String) -> Analysis {
    guard let expression else { return Analysis(variables: [], malformed: true) }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    let matches = expression.matches(in: value, range: range)
    let variables = matches.compactMap { match -> String? in
      guard let range = Range(match.range(at: 1), in: value) else { return nil }
      return String(value[range])
    }
    let remainder = expression.stringByReplacingMatches(
      in: value, range: range, withTemplate: ""
    )
    return Analysis(
      variables: variables,
      malformed: remainder.contains("{{") || remainder.contains("}}")
    )
  }

  static func interpolate(
    _ value: String,
    productName: String,
    localizedPrice: String
  ) -> String {
    guard let expression else { return value }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    var result = value
    for match in expression.matches(in: value, range: range).reversed() {
      guard
        let fullRange = Range(match.range(at: 0), in: result),
        let variableRange = Range(match.range(at: 1), in: value)
      else { continue }
      result.replaceSubrange(
        fullRange,
        with: value[variableRange] == "name" ? productName : localizedPrice
      )
    }
    return result
  }
}
