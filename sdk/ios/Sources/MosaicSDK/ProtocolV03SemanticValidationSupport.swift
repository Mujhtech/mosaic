import Foundation

extension MosaicProtocolV03Semantics {
  static func validateNavigationGraph(
    initialScreenID: String,
    screenIDs: Set<String>,
    edges: [String: Set<String>]
  ) throws {
    var reachable = Set<String>()
    func collectReachable(_ screenID: String) {
      guard reachable.insert(screenID).inserted else { return }
      for target in edges[screenID, default: []] { collectReachable(target) }
    }
    collectReachable(initialScreenID)
    guard reachable == screenIDs else { throw violation("protocol_unreachable_screen") }

    var visiting = Set<String>()
    var visited = Set<String>()
    func visit(_ screenID: String) throws {
      if visiting.contains(screenID) { throw violation("protocol_navigation_cycle") }
      guard !visited.contains(screenID) else { return }
      visiting.insert(screenID)
      for target in edges[screenID, default: []] { try visit(target) }
      visiting.remove(screenID)
      visited.insert(screenID)
    }
    for screenID in screenIDs { try visit(screenID) }
  }

  static func validateDesignSystem(
    _ designSystem: MosaicDesignSystem,
    document: MosaicPaywallDocument
  ) throws {
    guard designSystem.colors.count <= 256, designSystem.backgrounds.count <= 256,
      designSystem.shadows.count <= 256
    else { throw violation("protocol_design_token_limit") }

    func validateNames<T>(
      _ values: [T],
      id: (T) -> String,
      name: (T) -> String
    ) throws {
      var ids = Set<String>()
      var names = Set<String>()
      for value in values {
        let tokenID = id(value)
        try identifier(tokenID)
        guard ids.insert(tokenID).inserted else {
          throw violation("protocol_duplicate_design_token_id")
        }
        let tokenName = name(value)
        guard !tokenName.isEmpty, tokenName.count <= 80, names.insert(tokenName).inserted else {
          throw violation("protocol_invalid_design_token_name")
        }
      }
    }

    try validateNames(designSystem.colors, id: \.id, name: \.name)
    try validateNames(designSystem.backgrounds, id: \.id, name: \.name)
    try validateNames(designSystem.shadows, id: \.id, name: \.name)
    for token in designSystem.colors {
      guard let resolved = document.resolvedColor(token.value) else {
        throw violation("protocol_unknown_or_cyclic_color_token")
      }
      try color(resolved)
    }
    for token in designSystem.backgrounds {
      guard document.resolvedBackground(token.value) != nil else {
        throw violation("protocol_unknown_or_cyclic_background_token")
      }
    }
    for token in designSystem.shadows {
      guard document.resolvedShadow(token.value) != nil else {
        throw violation("protocol_unknown_or_cyclic_shadow_token")
      }
    }
  }

  /// The flash-safety floor for a looping motion, in milliseconds.
  ///
  /// A 500 ms cycle caps the pulse's fundamental at 2 Hz and its perceived rate
  /// at 1 Hz, an order of magnitude below the three-per-second threshold WCAG
  /// 2.3.1 draws. It lives in the semantic layer rather than the schema because
  /// the duration lives on a token and the constraint belongs to the reference
  /// site: the same 240 ms token is legitimate for an entrance and illegitimate
  /// for a pulse.
  static let loopMinimumDurationMilliseconds = 500

  /// The `0.4` motion rules that a single node cannot answer on its own.
  static func validateMotion(
    document: MosaicPaywallDocument,
    entries: [MotionEntry]
  ) throws {
    let catalog = document.designSystem?.motions ?? []

    var ids = Set<String>()
    var names = Set<String>()
    for token in catalog {
      try identifier(token.id)
      guard ids.insert(token.id).inserted else {
        throw violation("protocol_duplicate_design_token_id")
      }
      guard !token.name.isEmpty, token.name.count <= 80, names.insert(token.name).inserted else {
        throw violation("protocol_invalid_design_token_name")
      }
      // Resolution covers both an unknown target and a reference cycle: the
      // resolver refuses to revisit a token it is already inside.
      guard document.resolvedMotionCurve(token.value) != nil else {
        throw violation("protocol_unknown_or_cyclic_motion_token")
      }
    }

    // Seeded only from node reference sites. A token's own value is followed
    // afterwards, from those roots, so reachability is transitive rather than
    // one hop: a token referenced only from another *unused* token's value is
    // itself unused, and seeding the catalog's edges here would have called it
    // used.
    var referenced = Set<String>()
    var loopsByScreen: [String: [String]] = [:]

    for entry in entries {
      let motion = entry.motion
      if let appear = motion.appear {
        guard entry.appearAncestorID == nil else {
          throw violation("protocol_nested_appear_motion")
        }
        try motionCurve(appear.curve, document: document, referenced: &referenced)
      }
      if let selection = motion.selection {
        try motionCurve(selection.curve, document: document, referenced: &referenced)
      }
      guard let loop = motion.loop else { continue }
      loopsByScreen[entry.screenID, default: []].append(entry.nodeID)
      let resolved = try motionCurve(loop.curve, document: document, referenced: &referenced)
      guard resolved.durationMilliseconds >= loopMinimumDurationMilliseconds else {
        throw violation("protocol_loop_motion_below_flash_floor")
      }
    }

    // A protocol that lets you pulse six things is a toolkit; one that lets you
    // pulse the thing is a paywall protocol.
    guard loopsByScreen.values.allSatisfy({ $0.count <= 1 }) else {
      throw violation("protocol_multiple_loop_motions_on_screen")
    }

    // Deliberately asymmetric with the colour, background, and shadow catalogs,
    // which carry no unused-token check. Those are inert values. A motion token
    // is a duration whose flash safety is checked at its *reference* site, so a
    // token nothing reaches has never been checked against anything and sits in
    // the catalog looking approved. An alias chain hanging off nothing is the
    // same hazard wearing one more hop.
    // Ids are already proven unique above, so a plain assignment loses nothing.
    var valuesByID: [String: MosaicMotionCurve] = [:]
    for token in catalog { valuesByID[token.id] = token.value }
    var reachable = Set<String>()
    var pending = Array(referenced)
    while let id = pending.popLast() {
      guard reachable.insert(id).inserted else { continue }
      if let next = valuesByID[id]?.tokenID { pending.append(next) }
    }
    guard ids.subtracting(reachable).isEmpty else {
      throw violation("protocol_unused_motion_token")
    }
  }

  @discardableResult
  private static func motionCurve(
    _ curve: MosaicMotionCurve,
    document: MosaicPaywallDocument,
    referenced: inout Set<String>
  ) throws -> MosaicResolvedMotionCurve {
    if let id = curve.tokenID { referenced.insert(id) }
    guard let resolved = document.resolvedMotionCurve(curve) else {
      throw violation("protocol_unknown_or_cyclic_motion_token")
    }
    return resolved
  }

  static func externalURL(_ url: URL) throws {
    guard isSafeMosaicV03ExternalURL(url.absoluteString) else {
      throw violation("protocol_invalid_external_url")
    }
  }

  static func typography(
    _ value: MosaicTypography, allowsTruncation: Bool
  ) throws {
    try finite(value.fontSize, minimum: 8, maximum: 96, code: "protocol_invalid_font_size")
    try finite(
      value.lineHeightMultiplier, minimum: 0.8, maximum: 3,
      code: "protocol_invalid_line_height")
    guard allowsTruncation || (value.maxLines == nil && value.overflow == nil) else {
      throw violation("protocol_truncation_not_supported")
    }
    guard (value.maxLines == nil) == (value.overflow == nil) else {
      throw violation("protocol_incomplete_truncation")
    }
    if let maxLines = value.maxLines, !(1...100).contains(maxLines) {
      throw violation("protocol_invalid_max_lines")
    }
    try color(value.color)
  }

  static func textAccessibility(_ value: MosaicTextAccessibility) throws {
    if let level = value.headingLevel, !(1...6).contains(level) {
      throw violation("protocol_invalid_heading_level")
    }
  }

  static func validateLocalization(
    _ localization: MosaicLocalization,
    texts: [MosaicLocalizedText],
    consumedReservedKeys: Set<MosaicReservedAccessibilityKey>
  ) throws {
    try localeTag(localization.defaultLocale)
    try localeTag(localization.fallbackLocale)
    guard !localization.locales.isEmpty,
      localization.locales[localization.defaultLocale] != nil,
      localization.locales[localization.fallbackLocale] != nil
    else { throw violation("protocol_missing_required_locale") }

    for (locale, catalog) in localization.locales {
      try localeTag(locale)
      guard !catalog.strings.isEmpty else { throw violation("protocol_empty_locale_catalog") }
      for (key, value) in catalog.strings {
        try localizationKey(key)
        try textValue(value)
      }
    }
    let defaultCatalog = localization.locales[localization.defaultLocale]!.strings
    let usedKeys = Set(texts.map(\.localizationKey))
    let reservedKeyNames = Set(MosaicReservedAccessibilityKey.allCases.map(\.rawValue))
    // Reserved keys are read by the protocol rather than referenced by a
    // component, so the unused sweep would flag every one of them. They are
    // checked separately, in both directions.
    guard Set(defaultCatalog.keys).subtracting(reservedKeyNames) == usedKeys else {
      throw violation("protocol_default_catalog_key_mismatch")
    }
    for key in MosaicReservedAccessibilityKey.allCases {
      let consumed = consumedReservedKeys.contains(key)
      let declared = defaultCatalog[key.rawValue] != nil
      guard consumed == declared else {
        throw violation(
          consumed
            ? "protocol_missing_reserved_accessibility_key"
            : "protocol_unused_reserved_accessibility_key"
        )
      }
      guard declared else { continue }
      // Every declared translation must carry each placeholder exactly once. A
      // translation that drops one silently announces a rating with no number
      // in it, and one that repeats it announces the number twice.
      for catalog in localization.locales.values {
        guard let value = catalog.strings[key.rawValue] else { continue }
        for placeholder in key.placeholders {
          guard value.components(separatedBy: placeholder).count == 2 else {
            throw violation("protocol_invalid_reserved_accessibility_placeholder")
          }
        }
        let residue = key.placeholders.reduce(value) {
          $0.replacingOccurrences(of: $1, with: "")
        }
        guard !residue.contains("{{"), !residue.contains("}}") else {
          throw violation("protocol_invalid_reserved_accessibility_template")
        }
      }
    }
    for text in texts {
      try localizedText(text)
      guard defaultCatalog[text.localizationKey] == text.defaultValue else {
        throw violation("protocol_inline_default_mismatch")
      }
    }
    for catalog in localization.locales.values {
      guard Set(catalog.strings.keys).isSubset(of: Set(defaultCatalog.keys)) else {
        throw violation("protocol_translation_key_mismatch")
      }
    }
  }

  static func validateProductTemplates(
    _ localization: MosaicLocalization,
    entries: [LocalizedTextEntry]
  ) throws -> Bool {
    var usesTemplate = false
    for entry in entries {
      let text = entry.text
      var values = [text.defaultValue]
      values.append(
        contentsOf: localization.locales.values.compactMap {
          $0.strings[text.localizationKey]
        }
      )
      for value in values {
        let analysis = MosaicProductTemplate.analyze(value)
        guard !analysis.malformed else {
          throw violation("protocol_invalid_product_template")
        }
        guard analysis.variables.isEmpty || entry.productTemplateAllowed else {
          throw violation("protocol_product_template_outside_card")
        }
        usesTemplate = usesTemplate || !analysis.variables.isEmpty
      }
    }
    return usesTemplate
  }

  static func canonicalDate(_ value: String) -> Date? {
    guard
      value.range(
        of:
          "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
        options: .regularExpression
      ) != nil
    else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: value) else { return nil }
    return formatter.string(from: date) == value ? date : nil
  }

  static func color(_ value: MosaicColor) throws {
    if case .literal(let raw) = value,
      raw.range(of: "^#[0-9A-F]{8}$", options: .regularExpression) == nil
    {
      throw violation("protocol_invalid_color")
    }
  }

  static func borderValue(_ value: MosaicBorder) throws {
    try color(value.color)
    try logicalSize(value.width)
  }

  static func width(_ value: MosaicWidthSizing) throws {
    if case .fixed(let value) = value { try positiveSize(value) }
  }

  static func insets(_ value: MosaicEdgeInsets) throws {
    try logicalSize(value.top)
    try logicalSize(value.start)
    try logicalSize(value.bottom)
    try logicalSize(value.end)
  }

  static func positiveSize(_ value: Double) throws {
    try finite(
      value, minimum: .leastNonzeroMagnitude, maximum: 4096,
      code: "protocol_invalid_positive_logical_size")
  }

  static func logicalSize(_ value: Double) throws {
    try finite(value, minimum: 0, maximum: 4096, code: "protocol_invalid_logical_size")
  }

  static func finite(
    _ value: Double, minimum: Double, maximum: Double, code: String
  ) throws {
    guard value.isFinite, value >= minimum, value <= maximum else { throw violation(code) }
  }

  static func localizedText(_ value: MosaicLocalizedText) throws {
    try textValue(value.defaultValue)
    try localizationKey(value.localizationKey)
  }

  static func identifier(_ value: String) throws {
    guard value.count <= 128, matches(value, identifierPattern) else {
      throw violation("protocol_invalid_identifier")
    }
  }

  static func localizationKey(_ value: String) throws {
    guard value.count <= 256, matches(value, localizationKeyPattern) else {
      throw violation("protocol_invalid_localization_key")
    }
  }

  static func localeTag(_ value: String) throws {
    guard matches(value, localeTagPattern) else { throw violation("protocol_invalid_locale_tag") }
  }

  static func providerProductID(_ value: String) throws {
    guard value.count <= 256, matches(value, productIDPattern) else {
      throw violation("protocol_invalid_provider_product_id")
    }
  }

  static func assetKey(_ value: String) throws {
    guard value.count <= 256, matches(value, assetKeyPattern) else {
      throw violation("protocol_invalid_asset_key")
    }
  }

  static func textValue(_ value: String) throws {
    guard !value.isEmpty, value.count <= 5000 else {
      throw violation("protocol_invalid_localized_value")
    }
  }

  static func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }

  static func violation(_ code: String) -> MosaicProtocolError {
    .semanticViolation(code: code)
  }

  static let identifierPattern = "^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$"
  static let localizationKeyPattern = "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$"
  static let localeTagPattern = "^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$"
  static let productIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
  static let assetKeyPattern = "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
}
