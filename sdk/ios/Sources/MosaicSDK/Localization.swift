import Foundation

public struct MosaicResolvedLocale: Sendable, Equatable {
  public let requestedLocale: String?
  public let candidateLocales: [String]
  public let effectiveLocale: String
  public let direction: MosaicLayoutDirection
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
      appendDeclared(requestedLocale)
      if let base = requestedLocale.split(separator: "-", maxSplits: 1).first {
        appendDeclared(String(base))
      }
      appendDeclared(localization.fallbackLocale)
      appendDeclared(localization.defaultLocale)
    } else {
      appendDeclared(localization.defaultLocale)
      appendDeclared(localization.fallbackLocale)
    }

    let effectiveLocale = candidates.first ?? localization.defaultLocale
    let direction = localization.locales[effectiveLocale]?.direction ?? .leftToRight
    resolvedLocale = MosaicResolvedLocale(
      requestedLocale: requestedLocale,
      candidateLocales: candidates,
      effectiveLocale: effectiveLocale,
      direction: direction
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
