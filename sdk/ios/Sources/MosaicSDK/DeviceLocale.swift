import Foundation

/// The one canonical form of a locale tag, shared by every Mosaic boundary that
/// compares locales.
///
/// `Locale.current.identifier` is an ICU identifier, not a language tag: a
/// device with a region override reports `en_US@rg=gbzzzz`, a POSIX environment
/// reports `en_US.UTF-8`, and Java's `Locale.toString` reports
/// `en_US_#u-rg-gbzzzz`. Hosts pass those straight through. Comparing them raw
/// made analytics events fail the closed codec, `application.locale` rules
/// evaluate to unknown, and localization catalog lookups miss the only catalog
/// that existed.
///
/// `canonicalTag` implements the protocol's canonical form verbatim — see the
/// "Localization and locale resolution" section of `docs/protocol/v0.2.md` and
/// the reference implementation `protocol/tools/locale-resolution-v0.2.mjs`.
/// Placement targeting and catalog lookup deliberately share it, with exactly
/// one ruled asymmetry: only catalog lookup recovers the leading language
/// subtag (`catalogTag`).
enum MosaicDeviceLocale {
  /// The device locale for an SDK context field that must satisfy a contract
  /// bound, or `nil` when the device reports nothing representable. An absent
  /// field beats a fabricated language.
  static var currentContextTag: String? { contextTag(currentIdentifier()) }

  /// The device locale for the Placement decision context.
  ///
  /// Canonical when it can be, otherwise the device's own value unchanged: the
  /// evaluator applies this same canonicalization and must stay free to
  /// classify an unusable locale as present-but-unknown rather than receive an
  /// absent field or a substituted language.
  static var currentTargetingLocale: String {
    let identifier = currentIdentifier()
    return canonicalTag(identifier) ?? identifier
  }

  private static func currentIdentifier() -> String {
    if #available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *) {
      return Locale.current.identifier(.bcp47)
    }
    return Locale.current.identifier
  }

  /// The canonical comparison form of one locale tag, or `nil` when nothing
  /// usable remains.
  ///
  /// The value is first cut at the first `@`, `.`, or `#` — the ICU keyword,
  /// POSIX charset, and Java extension markers. Underscores then become
  /// hyphens, empty subtags are dropped, the tag is truncated at the first
  /// singleton subtag (`-u-`, `-t-`, `-x-`), the language subtag is lowercased,
  /// a four-letter script subtag is title-cased, and a two-letter or
  /// three-digit region is uppercased.
  ///
  /// Callers that match against something — a catalog key, an authored operand —
  /// must use this and treat `nil` as "not comparable", never as a match.
  static func canonicalTag(_ identifier: String) -> String? {
    var subtags: [Substring] = []
    for subtag in preCut(identifier).split(separator: "-", omittingEmptySubsequences: true) {
      // A one-character subtag introduces an extension sequence; everything
      // from there on is outside the comparable identity of a locale.
      guard subtag.count > 1 else { break }
      subtags.append(subtag)
    }
    guard (1...8).contains(subtags.count),
      matches(subtags[0], "^[A-Za-z]{2,8}$"),
      subtags.dropFirst().allSatisfy({ matches($0, "^[A-Za-z0-9]{1,8}$") })
    else { return nil }
    return subtags.enumerated().map { index, subtag -> String in
      if index == 0 { return subtag.lowercased() }
      if matches(subtag, "^[A-Za-z]{4}$") {
        return subtag.prefix(1).uppercased() + subtag.dropFirst().lowercased()
      }
      if matches(subtag, "^(?:[A-Za-z]{2}|[0-9]{3})$") { return subtag.uppercased() }
      return subtag.lowercased()
    }.joined(separator: "-")
  }

  /// The requested locale as a localization catalog candidate.
  ///
  /// Catalog lookup — and only catalog lookup — recovers the leading language
  /// subtag when the whole tag cannot be canonicalized, so
  /// `en-US-verylongsubtag` still reaches the `en` catalog. Placement targeting
  /// must not: recovering there would change which users match a Rule, while
  /// here the chain would otherwise fall through to the document's own fallback
  /// and the worst outcome is a less specific translation of the author's copy.
  static func catalogTag(_ identifier: String) -> String? {
    if let canonical = canonicalTag(identifier) { return canonical }
    guard
      let leading = preCut(identifier)
        .split(separator: "-", omittingEmptySubsequences: false).first
    else { return nil }
    return canonicalTag(String(leading))
  }

  /// The canonical tag reduced until an SDK context field will accept it, or
  /// `nil` when it cannot be.
  ///
  /// Reduction here narrows a valid but over-long tag to its language; it never
  /// rescues an uncanonicalizable one.
  static func contextTag(_ identifier: String) -> String? {
    guard let tag = canonicalTag(identifier) else { return nil }
    if isContextValid(tag) { return tag }
    guard let language = tag.split(separator: "-").first.map(String.init),
      isContextValid(language)
    else { return nil }
    return language
  }

  /// Everything before the first ICU keyword (`@`), POSIX charset (`.`), or
  /// Java extension (`#`) marker, with underscores normalized to hyphens.
  private static func preCut(_ identifier: String) -> String {
    identifier
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .prefix(while: { $0 != "@" && $0 != "." && $0 != "#" })
      .replacingOccurrences(of: "_", with: "-")
  }

  /// The intersection of the analytics event context and Placement decision
  /// context locale rules; the analytics bound is the tighter of the two.
  private static func isContextValid(_ tag: String) -> Bool {
    (2...35).contains(tag.utf8.count) && matches(tag, "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")
  }

  private static func matches(_ value: some StringProtocol, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }
}
