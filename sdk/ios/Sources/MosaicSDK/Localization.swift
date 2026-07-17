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
}
