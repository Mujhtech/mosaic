import Foundation

private let mosaicV03ExternalURLPattern =
  #"^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$"#

func isSafeMosaicV03ExternalURL(_ raw: String) -> Bool {
  guard raw.unicodeScalars.count <= 2048,
    raw.range(of: mosaicV03ExternalURLPattern, options: .regularExpression) != nil
  else { return false }

  let afterScheme = raw.dropFirst("https://".count)
  let authority = String(afterScheme.prefix { !"/?#".contains($0) })
  let authorityParts = authority.split(separator: ":", omittingEmptySubsequences: false)
  let host = authorityParts.first.map(String.init) ?? ""
  let port = authorityParts.count == 2 ? Int(authorityParts[1]) : nil
  guard authorityParts.count <= 2,
    !host.isEmpty,
    !host.contains(".."),
    authorityParts.count == 1
      || (authorityParts[1].count >= 1 && authorityParts[1].count <= 5 && port != nil),
    port.map({ $0 <= 65_535 }) ?? true,
    let parsed = URL(string: raw),
    parsed.scheme == "https",
    parsed.host?.lowercased() == host.lowercased(),
    parsed.user == nil,
    parsed.password == nil
  else { return false }
  return true
}

/// The shape gate for every supported contract.
///
/// `0.4` is a pure superset of `0.3` apart from two removals, so this is one
/// validator parameterized by version rather than two that would have to be
/// kept in step by hand. Every version-specific branch below names the contract
/// it belongs to.
struct MosaicProtocolShape {
  let version: MosaicSchemaVersion

  static func validate(_ root: [String: Any], version: MosaicSchemaVersion) throws {
    try MosaicProtocolShape(version: version).document(root)
  }

  private func document(_ root: [String: Any]) throws {
    try keys(
      root,
      required: [
        "schemaVersion", "id", "revision", "compatibility", "localization", "assets",
        "products", "designSystem", "initialScreenId", "screens",
      ],
      at: "$"
    )

    let compatibility = try object(root["compatibility"], at: "$.compatibility")
    try keys(compatibility, required: ["requiredCapabilities"], at: "$.compatibility")
    let requiredCapabilities = try array(
      compatibility["requiredCapabilities"], at: "$.compatibility.requiredCapabilities"
    )
    for (index, value) in requiredCapabilities.enumerated() {
      try keys(
        try object(value, at: "$.compatibility.requiredCapabilities[\(index)]"),
        required: ["name", "version"],
        at: "$.compatibility.requiredCapabilities[\(index)]"
      )
    }

    try localization(root["localization"], at: "$.localization")
    try designSystem(root["designSystem"], at: "$.designSystem")
    for (index, value) in try array(root["assets"], at: "$.assets").enumerated() {
      try asset(value, at: "$.assets[\(index)]")
    }
    for (index, value) in try array(root["products"], at: "$.products").enumerated() {
      try product(value, at: "$.products[\(index)]")
    }
    let screens = try array(root["screens"], at: "$.screens")
    guard (1...10).contains(screens.count) else {
      throw invalid("$.screens", "expected_1_to_10_items")
    }
    for (index, value) in screens.enumerated() {
      try screen(value, at: "$.screens[\(index)]", requiresAccessibilityLabel: screens.count > 1)
    }

    // Decoding intentionally defaults an omitted visibility to `.always`, so retain the
    // authored-vs-default distinction while the raw JSON tree is still available.
    let declaresStaticVisibility = try requiredCapabilities.contains { value in
      try object(value, at: "$.compatibility.requiredCapabilities")["name"] as? String
        == MosaicCapabilityName.staticVisibility.rawValue
    }
    guard declaresStaticVisibility == containsAuthoredStaticVisibility(in: root) else {
      throw MosaicProtocolError.semanticViolation(
        code: declaresStaticVisibility
          ? "protocol_unused_capability"
          : "protocol_missing_capability_\(MosaicCapabilityName.staticVisibility.rawValue)"
      )
    }
  }

  private func screen(
    _ value: Any,
    at path: String,
    requiresAccessibilityLabel: Bool
  ) throws {
    let screen = try object(value, at: path)
    try keys(
      screen,
      required: requiresAccessibilityLabel
        ? ["id", "accessibilityLabel", "presentation", "layout"]
        : ["id", "presentation", "layout"],
      optional: requiresAccessibilityLabel ? [] : ["accessibilityLabel"],
      at: path
    )
    if let accessibilityLabel = screen["accessibilityLabel"] {
      try localizedText(accessibilityLabel, at: "\(path).accessibilityLabel")
    }
    let presentation = try object(screen["presentation"], at: "\(path).presentation")
    try keys(presentation, required: ["type"], at: "\(path).presentation")
    guard let presentationType = presentation["type"] as? String,
      presentationType == "screen" || presentationType == "sheet"
    else { throw invalid("\(path).presentation.type", "invalid_presentation_type") }
    try scrollContainer(screen["layout"], at: "\(path).layout")
  }

  private func designSystem(_ value: Any?, at path: String) throws {
    let system = try object(value, at: path)
    // The motion catalog is required in `0.4` and unknown in `0.3`, so an
    // absent catalog and a `0.3` document are different failures.
    try keys(
      system,
      required: version.supportsMotion
        ? ["colors", "backgrounds", "shadows", "motions"]
        : ["colors", "backgrounds", "shadows"],
      at: path
    )
    let colors = try array(system["colors"], at: "\(path).colors")
    let backgrounds = try array(system["backgrounds"], at: "\(path).backgrounds")
    let shadows = try array(system["shadows"], at: "\(path).shadows")
    let motions = try array(system["motions"] ?? [], at: "\(path).motions")
    guard colors.count <= 256, backgrounds.count <= 256, shadows.count <= 256,
      motions.count <= 256
    else {
      throw invalid(path, "too_many_design_tokens")
    }
    for (index, raw) in motions.enumerated() {
      let tokenPath = "\(path).motions[\(index)]"
      let token = try object(raw, at: tokenPath)
      try keys(token, required: ["id", "name", "value"], at: tokenPath)
      try motionCurve(token["value"], at: "\(tokenPath).value")
    }
    for (index, raw) in colors.enumerated() {
      let tokenPath = "\(path).colors[\(index)]"
      let token = try object(raw, at: tokenPath)
      try keys(token, required: ["id", "name", "value"], at: tokenPath)
      try color(token["value"], at: "\(tokenPath).value")
    }
    for (index, raw) in backgrounds.enumerated() {
      let tokenPath = "\(path).backgrounds[\(index)]"
      let token = try object(raw, at: tokenPath)
      try keys(token, required: ["id", "name", "value"], at: tokenPath)
      try background(token["value"], at: "\(tokenPath).value")
    }
    for (index, raw) in shadows.enumerated() {
      let tokenPath = "\(path).shadows[\(index)]"
      let token = try object(raw, at: tokenPath)
      try keys(token, required: ["id", "name", "value"], at: tokenPath)
      try shadow(token["value"], at: "\(tokenPath).value")
    }
  }

  private func localization(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    try keys(
      value,
      required: ["defaultLocale", "fallbackLocale", "locales"],
      at: path
    )
    let locales = try object(value["locales"], at: "\(path).locales")
    guard !locales.isEmpty else { throw invalid("\(path).locales", "expected_nonempty_object") }
    for (locale, raw) in locales {
      let catalogPath = "\(path).locales.\(locale)"
      let catalog = try object(raw, at: catalogPath)
      try keys(catalog, required: ["direction", "strings"], at: catalogPath)
      let strings = try object(catalog["strings"], at: "\(catalogPath).strings")
      guard !strings.isEmpty else {
        throw invalid("\(catalogPath).strings", "expected_nonempty_object")
      }
    }
  }

  private func asset(_ value: Any, at path: String) throws {
    let asset = try object(value, at: path)
    guard let type = asset["type"] as? String, type == "image" || type == "video" else {
      throw invalid("\(path).type", "invalid_asset_type")
    }
    try keys(
      asset,
      required: type == "image" ? ["type", "id", "source", "fallback"] : ["type", "id", "source"],
      at: path)
    let source = try object(asset["source"], at: "\(path).source")
    switch source["type"] as? String {
    case "bundled": try keys(source, required: ["type", "key"], at: "\(path).source")
    case "remote":
      try keys(source, required: ["type", "url"], at: "\(path).source")
      guard let raw = source["url"] as? String, isSafeMosaicV03ExternalURL(raw) else {
        throw invalid("\(path).source.url", "invalid_remote_asset_url")
      }
    default: throw invalid("\(path).source.type", "invalid_asset_source")
    }
    if let rawFallback = asset["fallback"] {
      let fallback = try object(rawFallback, at: "\(path).fallback")
      try keys(fallback, required: ["type", "value"], at: "\(path).fallback")
      try localizedText(fallback["value"], at: "\(path).fallback.value")
    }
  }

  private func product(_ value: Any, at path: String) throws {
    let product = try object(value, at: path)
    try keys(
      product,
      required: ["id", "productId", "label"],
      at: path
    )
    try localizedText(product["label"], at: "\(path).label")
  }

  private func scrollContainer(_ value: Any?, at path: String) throws {
    let container = try object(value, at: path)
    try keys(
      container,
      required: ["type", "id", "axis", "safeArea", "showsIndicators", "content"],
      optional: ["background"],
      at: path
    )
    if let value = container["background"] { try background(value, at: "\(path).background") }
    try stack(container["content"], at: "\(path).content")
  }

  private func stack(_ value: Any?, at path: String) throws {
    let stack = try object(value, at: path)
    try keys(
      stack,
      required: [
        "type", "id", "direction", "gap", "padding", "mainAxisDistribution",
        "crossAxisAlignment", "children",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    // The root content stack of a screen is reached directly rather than through
    // `node(_:at:)`, so its motion is validated here too.
    if let value = stack["motion"] {
      try motion(value, at: "\(path).motion", allows: motionMembers(forNodeType: "stack"))
    }
    try edgeInsets(stack["padding"], at: "\(path).padding")
    try optionalPresentation(stack, at: path, appearanceKind: .container, sizingKind: .box)
    for (index, child) in try array(stack["children"], at: "\(path).children").enumerated() {
      try node(child, at: "\(path).children[\(index)]")
    }
  }

  private func node(_ value: Any, at path: String) throws {
    let node = try object(value, at: path)
    guard let type = node["type"] as? String else {
      throw invalid("\(path).type", "expected_string")
    }
    if let value = node["motion"] {
      try motion(value, at: "\(path).motion", allows: motionMembers(forNodeType: type))
    }
    switch type {
    case "stack":
      try stack(value, at: path)
    case "text":
      try keys(
        node,
        required: ["type", "id", "value", "typography", "accessibility"],
        optional: ["appearance", "sizing", "outerInsets", "visibility"],
        at: path
      )
      try localizedText(node["value"], at: "\(path).value")
      try typography(node["typography"], at: "\(path).typography", allowsTruncation: true)
      try textAccessibility(node["accessibility"], at: "\(path).accessibility", legal: false)
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
    case "image":
      try keys(
        node,
        required: ["type", "id", "assetId", "contentMode", "accessibility"],
        optional: ["aspectRatio", "appearance", "sizing", "outerInsets", "visibility"],
        at: path
      )
      try imageAccessibility(node["accessibility"], at: "\(path).accessibility")
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
    case "icon":
      try keys(
        node,
        required: ["type", "id", "name", "size", "color", "accessibility"],
        optional: ["appearance", "sizing", "outerInsets", "visibility"],
        at: path
      )
      try color(node["color"], at: "\(path).color")
      try imageAccessibility(node["accessibility"], at: "\(path).accessibility")
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
    case "featureList":
      try keys(
        node,
        required: [
          "type", "id", "marker", "gap", "markerColor", "items", "typography",
          "accessibility",
        ],
        optional: ["appearance", "sizing", "outerInsets", "visibility"],
        at: path
      )
      try color(node["markerColor"], at: "\(path).markerColor")
      // `0.3` carries the single constant `"checkmark"`, so a list cannot
      // express a negated item; `0.4` consolidated onto Timeline's union and
      // lets an item override the list's glyph.
      if version.supportsMotion {
        try marker(node["marker"] as Any, at: "\(path).marker")
      } else if node["marker"] as? String != MosaicIconName.checkmark.rawValue {
        throw invalid("\(path).marker", "invalid_marker_kind")
      }
      try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
      let items = try array(node["items"], at: "\(path).items")
      guard !items.isEmpty else { throw invalid("\(path).items", "expected_nonempty_array") }
      for (index, value) in items.enumerated() {
        let itemPath = "\(path).items[\(index)]"
        let item = try object(value, at: itemPath)
        try keys(
          item,
          required: ["id", "text"],
          optional: version.supportsMotion ? ["marker"] : [],
          at: itemPath
        )
        try localizedText(item["text"], at: "\(itemPath).text")
        if let value = item["marker"] { try marker(value, at: "\(itemPath).marker") }
      }
      try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
    case "productSelector":
      try productSelector(node, at: path)
    case "button":
      try button(node, at: path)
    case "carousel":
      try carousel(node, at: path)
    case "switch":
      try switchControl(node, at: path)
    case "countdown":
      try countdown(node, at: path)
    case "tabs":
      try tabs(node, at: path)
    case "timeline":
      try timeline(node, at: path)
    case "award":
      try award(node, at: path)
    case "socialProof":
      try socialProof(node, at: path)
    default:
      throw invalid("\(path).type", "unsupported_component")
    }
  }

  private func tabs(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "tabBarDirection", "tabBarGap", "tabBarDistribution", "gap",
        "initialTabId", "tabs", "styles", "labelTypography", "selectedLabelColor",
        "accessibility",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    let entries = try array(node["tabs"], at: "\(path).tabs")
    guard (2...8).contains(entries.count) else {
      throw invalid("\(path).tabs", "expected_2_to_8_items")
    }
    for (index, raw) in entries.enumerated() {
      let entryPath = "\(path).tabs[\(index)]"
      let entry = try object(raw, at: entryPath)
      try keys(entry, required: ["id", "label", "content"], at: entryPath)
      try localizedText(entry["label"], at: "\(entryPath).label")
      try stack(entry["content"], at: "\(entryPath).content")
    }
    try selectionStyles(node["styles"], at: "\(path).styles")
    try typography(node["labelTypography"], at: "\(path).labelTypography", allowsTruncation: false)
    try color(node["selectedLabelColor"], at: "\(path).selectedLabelColor")
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .container, sizingKind: .box)
  }

  private func timeline(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: ["type", "id", "orientation", "gap", "connector", "entries", "titleTypography",
        "accessibility"],
      optional: [
        "markerColor", "markerSize", "descriptionTypography", "appearance", "sizing",
        "outerInsets", "visibility",
      ],
      at: path
    )
    guard node["orientation"] as? String == "vertical" else {
      throw invalid("\(path).orientation", "invalid_timeline_orientation")
    }
    let connectorPath = "\(path).connector"
    let connector = try object(node["connector"], at: connectorPath)
    try keys(connector, required: ["color", "width", "style"], at: connectorPath)
    try color(connector["color"], at: "\(connectorPath).color")
    guard let connectorStyle = connector["style"] as? String,
      connectorStyle == "solid" || connectorStyle == "dashed"
    else { throw invalid("\(connectorPath).style", "invalid_timeline_connector_style") }

    let entries = try array(node["entries"], at: "\(path).entries")
    guard (2...12).contains(entries.count) else {
      throw invalid("\(path).entries", "expected_2_to_12_items")
    }
    for (index, raw) in entries.enumerated() {
      let entryPath = "\(path).entries[\(index)]"
      let entry = try object(raw, at: entryPath)
      try keys(
        entry, required: ["id", "title"], optional: ["description", "marker"], at: entryPath)
      try localizedText(entry["title"], at: "\(entryPath).title")
      if let value = entry["description"] {
        try localizedText(value, at: "\(entryPath).description")
      }
      if let value = entry["marker"] { try marker(value, at: "\(entryPath).marker") }
    }
    if let value = node["markerColor"] { try color(value, at: "\(path).markerColor") }
    try typography(node["titleTypography"], at: "\(path).titleTypography", allowsTruncation: false)
    if let value = node["descriptionTypography"] {
      try typography(value, at: "\(path).descriptionTypography", allowsTruncation: false)
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  /// The marker union Feature List and Timeline share from `0.4` onwards.
  private func marker(_ value: Any, at path: String) throws {
    let marker = try object(value, at: path)
    switch marker["kind"] as? String {
    case "dot", "ordinal":
      try keys(marker, required: ["kind"], at: path)
    case "icon":
      try keys(marker, required: ["kind", "name"], at: path)
    default:
      throw invalid("\(path).kind", "invalid_marker_kind")
    }
  }

  // MARK: - Motion

  /// Which motion members a node may carry.
  ///
  /// The constraint is by trigger rather than by taste: `selection` needs
  /// runtime selection state to interpolate between, and `loop` is bounded to
  /// the one control a paywall exists to draw attention to.
  private func motionMembers(forNodeType type: String) -> Set<String> {
    switch type {
    case "button": ["appear", "loop"]
    case "productSelector", "tabs": ["appear", "selection"]
    default: ["appear"]
    }
  }

  private func motion(_ value: Any, at path: String, allows members: Set<String>) throws {
    guard version.supportsMotion else { throw invalid(path, "unsupported_property") }
    let motion = try object(value, at: path)
    guard !motion.isEmpty else { throw invalid(path, "expected_nonempty_object") }
    try keys(motion, required: [], optional: members, at: path)
    if let value = motion["appear"] { try appearMotion(value, at: "\(path).appear") }
    if let value = motion["selection"] {
      let selection = try object(value, at: "\(path).selection")
      try keys(selection, required: ["curve"], at: "\(path).selection")
      try motionCurve(selection["curve"], at: "\(path).selection.curve")
    }
    if let value = motion["loop"] { try loopMotion(value, at: "\(path).loop") }
  }

  private func appearMotion(_ value: Any, at path: String) throws {
    let appear = try object(value, at: path)
    // `riseLogicalSize` is required with `fadeRise` and forbidden with `fade`.
    // Both directions are enforced: a rise on a fade is a value nothing reads,
    // and a `fadeRise` without one has no distance to travel.
    switch appear["effect"] as? String {
    case "fade":
      try keys(appear, required: ["effect", "curve", "delayMilliseconds"], at: path)
    case "fadeRise":
      try keys(
        appear,
        required: ["effect", "riseLogicalSize", "curve", "delayMilliseconds"],
        at: path
      )
      try boundedNumber(
        appear["riseLogicalSize"], at: "\(path).riseLogicalSize",
        minimum: 0, maximum: 64, exclusiveMinimum: true)
    default:
      throw invalid("\(path).effect", "invalid_appear_effect")
    }
    try motionDuration(appear["delayMilliseconds"], at: "\(path).delayMilliseconds")
    try motionCurve(appear["curve"], at: "\(path).curve")
  }

  private func loopMotion(_ value: Any, at path: String) throws {
    let loop = try object(value, at: path)
    try keys(
      loop,
      required: ["effect", "scaleAmplitude", "opacityAmplitude", "curve", "repeat"],
      at: path
    )
    guard loop["effect"] as? String == "pulse" else {
      throw invalid("\(path).effect", "invalid_loop_effect")
    }
    // Flash safety is enforced rather than advised. A looping colour change is
    // inexpressible by construction: `pulse` carries only scale and opacity.
    try boundedNumber(
      loop["scaleAmplitude"], at: "\(path).scaleAmplitude",
      minimum: 0, maximum: 0.06, exclusiveMinimum: true)
    try boundedNumber(
      loop["opacityAmplitude"], at: "\(path).opacityAmplitude",
      minimum: 0, maximum: 0.2, exclusiveMinimum: false)
    let repeats = try object(loop["repeat"], at: "\(path).repeat")
    try keys(repeats, required: ["count"], at: "\(path).repeat")
    guard let count = integer(repeats["count"]), (1...5).contains(count) else {
      throw invalid("\(path).repeat.count", "invalid_loop_repeat_count")
    }
    try motionCurve(loop["curve"], at: "\(path).curve")
  }

  private func motionCurve(_ value: Any?, at path: String) throws {
    let curve = try object(value, at: path)
    switch curve["type"] as? String {
    case "motion":
      try keys(curve, required: ["type", "durationMilliseconds", "easing"], at: path)
      try motionDuration(curve["durationMilliseconds"], at: "\(path).durationMilliseconds")
      guard let easing = curve["easing"] as? String,
        MosaicMotionEasing(rawValue: easing) != nil
      else { throw invalid("\(path).easing", "invalid_motion_easing") }
    case "motionToken":
      try keys(curve, required: ["type", "id"], at: path)
    default:
      throw invalid("\(path).type", "invalid_motion_type")
    }
  }

  /// Durations are whole milliseconds in `0...2000`. Integers throughout, per
  /// the `0.3` doctrine that four runtimes must not disagree about a rounded
  /// fraction.
  private func motionDuration(_ value: Any?, at path: String) throws {
    guard let milliseconds = integer(value), (0...2000).contains(milliseconds) else {
      throw invalid(path, "invalid_motion_duration")
    }
  }

  private func boundedNumber(
    _ value: Any?,
    at path: String,
    minimum: Double,
    maximum: Double,
    exclusiveMinimum: Bool
  ) throws {
    guard let number = value as? NSNumber else { throw invalid(path, "expected_number") }
    let amount = number.doubleValue
    guard amount.isFinite, amount <= maximum,
      exclusiveMinimum ? amount > minimum : amount >= minimum
    else { throw invalid(path, "value_out_of_range") }
  }

  /// A JSON number that carries no fraction. `NSNumber` is checked rather than
  /// cast to `Int` because `12.0` bridges to `Int` happily and is not an
  /// authored integer.
  private func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFNumberIsFloatType(number) == false else {
      return nil
    }
    return number.intValue
  }

  private func award(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "direction", "gap", "crossAxisAlignment", "title", "titleTypography",
        "accessibility",
      ],
      optional: [
        "emblem", "subtitle", "subtitleTypography", "appearance", "sizing", "outerInsets",
        "visibility",
      ],
      at: path
    )
    if let value = node["emblem"] { try awardEmblem(value, at: "\(path).emblem") }
    try localizedText(node["title"], at: "\(path).title")
    try typography(node["titleTypography"], at: "\(path).titleTypography", allowsTruncation: false)
    // `dependentRequired` in both directions: a subtitle with no typography
    // would leave the renderer choosing a style, and typography with no
    // subtitle is a value nothing reads.
    guard (node["subtitle"] == nil) == (node["subtitleTypography"] == nil) else {
      throw invalid(path, "subtitle_and_typography_must_appear_together")
    }
    if let value = node["subtitle"] { try localizedText(value, at: "\(path).subtitle") }
    if let value = node["subtitleTypography"] {
      try typography(value, at: "\(path).subtitleTypography", allowsTruncation: false)
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private func awardEmblem(_ value: Any, at path: String) throws {
    let emblem = try object(value, at: path)
    switch emblem["type"] as? String {
    case "image":
      try keys(emblem, required: ["type", "assetId", "size"], at: path)
    case "icon":
      try keys(emblem, required: ["type", "name", "size", "color"], at: path)
      try color(emblem["color"], at: "\(path).color")
    default:
      throw invalid("\(path).type", "invalid_award_emblem")
    }
  }

  private func socialProof(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "gap", "quote", "quoteTypography", "attribution",
        "attributionTypography", "accessibility",
      ],
      optional: ["rating", "avatar", "appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    try localizedText(node["quote"], at: "\(path).quote")
    try typography(node["quoteTypography"], at: "\(path).quoteTypography", allowsTruncation: false)
    try localizedText(node["attribution"], at: "\(path).attribution")
    try typography(
      node["attributionTypography"], at: "\(path).attributionTypography", allowsTruncation: false)
    if let value = node["rating"] {
      let ratingPath = "\(path).rating"
      let rating = try object(value, at: ratingPath)
      try keys(
        rating,
        required: ["symbol", "value", "maximum", "step", "size", "filledColor", "emptyColor"],
        at: ratingPath
      )
      guard rating["symbol"] as? String == "star" else {
        throw invalid("\(ratingPath).symbol", "invalid_rating_symbol")
      }
      guard let step = rating["step"] as? String, step == "whole" || step == "half" else {
        throw invalid("\(ratingPath).step", "invalid_rating_step")
      }
      // Integers only. A JSON `4.5` would otherwise reach four runtimes that
      // each round it independently.
      for key in ["value", "maximum"] {
        guard let number = rating[key] as? NSNumber,
          CFNumberIsFloatType(number) == false
        else { throw invalid("\(ratingPath).\(key)", "expected_integer") }
      }
      try color(rating["filledColor"], at: "\(ratingPath).filledColor")
      try color(rating["emptyColor"], at: "\(ratingPath).emptyColor")
    }
    if let value = node["avatar"] {
      let avatarPath = "\(path).avatar"
      try keys(try object(value, at: avatarPath), required: ["assetId", "size"], at: avatarPath)
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private func button(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "direction", "gap", "mainAxisDistribution", "crossAxisAlignment",
        "children", "action", "accessibility",
      ],
      optional: ["inProgressChildren", "appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    let children = try array(node["children"], at: "\(path).children")
    guard !children.isEmpty else { throw invalid("\(path).children", "expected_nonempty_array") }
    for (index, child) in children.enumerated() {
      try self.node(child, at: "\(path).children[\(index)]")
    }
    if let value = node["inProgressChildren"] {
      let children = try array(value, at: "\(path).inProgressChildren")
      guard !children.isEmpty else {
        throw invalid("\(path).inProgressChildren", "expected_nonempty_array")
      }
      for (index, child) in children.enumerated() {
        try self.node(child, at: "\(path).inProgressChildren[\(index)]")
      }
    }
    let action = try object(node["action"], at: "\(path).action")
    guard let type = action["type"] as? String else {
      throw invalid("\(path).action.type", "expected_string")
    }
    switch type {
    case "purchase":
      try keys(action, required: ["type", "productSelectorId"], at: "\(path).action")
    case "restore", "close", "navigateBack":
      try keys(action, required: ["type"], at: "\(path).action")
    case "navigateTo":
      try keys(action, required: ["type", "screenId"], at: "\(path).action")
    case "openExternalUrl":
      try keys(action, required: ["type", "url"], at: "\(path).action")
      guard let url = action["url"] as? String,
        isSafeMosaicV03ExternalURL(url)
      else { throw invalid("\(path).action.url", "invalid_external_url") }
    default:
      throw invalid("\(path).action.type", "unsupported_action")
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private func productSelector(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "direction", "gap", "crossAxisAlignment", "initialProductCardId",
        "cards", "unavailableFallback", "accessibility",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    let cards = try array(node["cards"], at: "\(path).cards")
    guard (1...20).contains(cards.count) else {
      throw invalid("\(path).cards", "expected_1_to_20_items")
    }
    for (index, card) in cards.enumerated() {
      try productCard(card, at: "\(path).cards[\(index)]")
    }
    let fallback = try object(node["unavailableFallback"], at: "\(path).unavailableFallback")
    try keys(
      fallback,
      required: ["selection", "whenNoneAvailable", "message"],
      at: "\(path).unavailableFallback"
    )
    try localizedText(fallback["message"], at: "\(path).unavailableFallback.message")
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private func productCard(_ value: Any, at path: String) throws {
    let card = try object(value, at: path)
    try keys(
      card,
      required: [
        "type", "id", "productReferenceId", "direction", "gap", "mainAxisDistribution",
        "crossAxisAlignment", "children", "styles",
      ],
      // Product Card admits motion without admitting visibility, so it names the
      // key rather than inheriting it.
      optional: version.supportsMotion
        ? ["sizing", "clipContent", "accessibility", "motion"]
        : ["sizing", "clipContent", "accessibility"],
      at: path
    )
    guard card["type"] as? String == "productCard" else {
      throw invalid("\(path).type", "expected_product_card")
    }
    if let value = card["motion"] {
      try motion(value, at: "\(path).motion", allows: motionMembers(forNodeType: "productCard"))
    }
    let children = try array(card["children"], at: "\(path).children")
    guard !children.isEmpty else { throw invalid("\(path).children", "expected_nonempty_array") }
    for (index, child) in children.enumerated() {
      try productCardChild(child, at: "\(path).children[\(index)]")
    }
    try selectionStyles(card["styles"], at: "\(path).styles")
    if let sizing = card["sizing"] {
      try self.sizing(sizing, at: "\(path).sizing", allowsHeight: true)
    }
    if let clipContent = card["clipContent"], (clipContent as? Bool) != false {
      throw invalid("\(path).clipContent", "expected_false")
    }
    if let accessibility = card["accessibility"] {
      let accessibility = try object(accessibility, at: "\(path).accessibility")
      try keys(accessibility, required: ["label"], at: "\(path).accessibility")
      try localizedText(accessibility["label"], at: "\(path).accessibility.label")
    }
  }

  private func productCardChild(_ value: Any, at path: String) throws {
    let child = try object(value, at: path)
    if child["type"] as? String == "productBadge" {
      try productBadge(child, at: path)
    } else {
      try productCardPassiveNode(child, at: path)
    }
  }

  private func productCardPassiveNode(_ node: [String: Any], at path: String) throws {
    switch node["type"] as? String {
    case "stack":
      try productCardPassiveStack(node, at: path)
    case "text", "image", "icon", "featureList", "countdown", "timeline", "award",
      "socialProof":
      try self.node(node, at: path)
    default:
      throw invalid("\(path).type", "unsupported_product_card_child")
    }
  }

  private func productCardPassiveStack(_ stack: [String: Any], at path: String) throws {
    try keys(
      stack,
      required: [
        "type", "id", "direction", "gap", "padding", "mainAxisDistribution",
        "crossAxisAlignment", "children",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    if let value = stack["motion"] {
      try motion(value, at: "\(path).motion", allows: motionMembers(forNodeType: "stack"))
    }
    try edgeInsets(stack["padding"], at: "\(path).padding")
    try optionalPresentation(stack, at: path, appearanceKind: .container, sizingKind: .box)
    for (index, child) in try array(stack["children"], at: "\(path).children").enumerated() {
      try productCardPassiveNode(
        try object(child, at: "\(path).children[\(index)]"),
        at: "\(path).children[\(index)]"
      )
    }
  }

  private func productBadge(_ badge: [String: Any], at path: String) throws {
    try keys(
      badge,
      required: [
        "type", "id", "placement", "direction", "gap", "mainAxisDistribution",
        "crossAxisAlignment", "children", "styles",
      ],
      optional: version.supportsMotion ? ["sizing", "motion"] : ["sizing"],
      at: path
    )
    if let value = badge["motion"] {
      try motion(value, at: "\(path).motion", allows: motionMembers(forNodeType: "productBadge"))
    }
    let placement = try object(badge["placement"], at: "\(path).placement")
    switch placement["mode"] as? String {
    case "nested":
      try keys(placement, required: ["mode"], at: "\(path).placement")
    case "overlay":
      try keys(placement, required: ["mode", "anchor", "inset"], at: "\(path).placement")
    default:
      throw invalid("\(path).placement.mode", "invalid_badge_placement")
    }
    let children = try array(badge["children"], at: "\(path).children")
    guard (1...10).contains(children.count) else {
      throw invalid("\(path).children", "expected_1_to_10_items")
    }
    for (index, child) in children.enumerated() {
      try productCardPassiveNode(
        try object(child, at: "\(path).children[\(index)]"),
        at: "\(path).children[\(index)]"
      )
    }
    try selectionStyles(badge["styles"], at: "\(path).styles")
    if let sizing = badge["sizing"] {
      try self.sizing(sizing, at: "\(path).sizing", allowsHeight: true)
    }
  }

  /// The neutral `selectionStyles` shape that `0.3` gave Product Card, Product
  /// Badge, and Tabs. `productCardStyles` is an alias of it in the schema, so it
  /// is validated here once.
  private func selectionStyles(_ value: Any?, at path: String) throws {
    let styles = try object(value, at: path)
    try keys(styles, required: ["default", "selected"], at: path)
    let base = try object(styles["default"], at: "\(path).default")
    try keys(
      base,
      required: ["background", "border", "cornerRadius", "padding", "opacity"],
      optional: ["shadow"],
      at: "\(path).default"
    )
    try background(base["background"], at: "\(path).default.background")
    if let value = base["shadow"] { try shadow(value, at: "\(path).default.shadow") }
    try border(base["border"], at: "\(path).default.border", override: false)
    try edgeInsets(base["padding"], at: "\(path).default.padding")

    let selected = try object(styles["selected"], at: "\(path).selected")
    try keys(
      selected,
      required: [],
      optional: ["background", "border", "cornerRadius", "padding", "opacity", "shadow"],
      at: "\(path).selected"
    )
    if let value = selected["background"] {
      try background(value, at: "\(path).selected.background")
    }
    if let value = selected["shadow"] { try shadow(value, at: "\(path).selected.shadow") }
    if let value = selected["border"] {
      try border(value, at: "\(path).selected.border", override: true)
    }
    if let value = selected["padding"] {
      try edgeInsetsOverride(value, at: "\(path).selected.padding")
    }
  }

  private func carousel(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: ["type", "id", "initialPageIndex", "showsIndicators", "pages", "accessibility"],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    let pages = try array(node["pages"], at: "\(path).pages")
    guard (2...20).contains(pages.count) else {
      throw invalid("\(path).pages", "expected_2_to_20_items")
    }
    for (index, raw) in pages.enumerated() {
      let pagePath = "\(path).pages[\(index)]"
      let page = try object(raw, at: pagePath)
      try keys(page, required: ["id", "accessibilityLabel", "content"], at: pagePath)
      try localizedText(page["accessibilityLabel"], at: "\(pagePath).accessibilityLabel")
      try stack(page["content"], at: "\(pagePath).content")
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .container, sizingKind: .box)
  }

  private func switchControl(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "label", "initialValue", "typography", "offTrackColor",
        "onTrackColor", "thumbColor", "accessibility",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    try localizedText(node["label"], at: "\(path).label")
    try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
    try color(node["offTrackColor"], at: "\(path).offTrackColor")
    try color(node["onTrackColor"], at: "\(path).onTrackColor")
    try color(node["thumbColor"], at: "\(path).thumbColor")
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private func countdown(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "endsAt", "largestUnit", "smallestUnit", "completedText",
        "typography", "accessibility",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    try localizedText(node["completedText"], at: "\(path).completedText")
    try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
    try textAccessibility(node["accessibility"], at: "\(path).accessibility", legal: false)
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private enum AppearanceKind { case none, box, container }
  private enum SizingKind { case none, widthOnly, box }

  private func optionalPresentation(
    _ node: [String: Any],
    at path: String,
    appearanceKind: AppearanceKind,
    sizingKind: SizingKind
  ) throws {
    if let value = node["appearance"] {
      switch appearanceKind {
      case .none: throw invalid("\(path).appearance", "unsupported_property")
      case .box: try appearance(value, at: "\(path).appearance", container: false)
      case .container: try appearance(value, at: "\(path).appearance", container: true)
      }
    }
    if let value = node["sizing"] {
      switch sizingKind {
      case .none: throw invalid("\(path).sizing", "unsupported_property")
      case .widthOnly: try sizing(value, at: "\(path).sizing", allowsHeight: false)
      case .box: try sizing(value, at: "\(path).sizing", allowsHeight: true)
      }
    }
    if let value = node["outerInsets"] { try edgeInsets(value, at: "\(path).outerInsets") }
    if let value = node["visibility"] { try visibility(value, at: "\(path).visibility") }
  }

  private func appearance(_ value: Any, at path: String, container: Bool) throws {
    let value = try object(value, at: path)
    var allowed: Set<String> = ["background", "border", "cornerRadius", "opacity", "shadow"]
    allowed.insert(container ? "clipContent" : "padding")
    guard !value.isEmpty else { throw invalid(path, "expected_nonempty_object") }
    try keys(value, required: [], optional: allowed, at: path)
    if let backgroundValue = value["background"] {
      try background(backgroundValue, at: "\(path).background")
    }
    if let shadowValue = value["shadow"] { try shadow(shadowValue, at: "\(path).shadow") }
    if let borderValue = value["border"] {
      try border(borderValue, at: "\(path).border", override: false)
    }
    if let padding = value["padding"] { try edgeInsets(padding, at: "\(path).padding") }
  }

  private func sizing(_ value: Any, at path: String, allowsHeight: Bool) throws {
    let value = try object(value, at: path)
    guard !value.isEmpty else { throw invalid(path, "expected_nonempty_object") }
    try keys(value, required: ["width", "height"], at: path)
    if let widthValue = value["width"] { try width(widthValue, at: "\(path).width") }
    if let heightValue = value["height"] { try height(heightValue, at: "\(path).height") }
  }

  private func width(_ value: Any?, at path: String) throws {
    if let value = value as? String {
      guard value == "fit" || value == "fill" else { throw invalid(path, "invalid_width") }
      return
    }
    let value = try object(value, at: path)
    try keys(value, required: ["mode", "value"], at: path)
  }

  private func height(_ value: Any, at path: String) throws {
    if let value = value as? String {
      guard value == "fit" || value == "fill" else { throw invalid(path, "invalid_height") }
      return
    }
    let value = try object(value, at: path)
    try keys(value, required: ["mode", "value"], at: path)
  }

  private func typography(_ value: Any?, at path: String, allowsTruncation: Bool) throws {
    let typography = try object(value, at: path)
    try keys(
      typography,
      required: ["style", "fontSize", "lineHeightMultiplier", "weight", "color", "alignment"],
      optional: allowsTruncation ? ["maxLines", "overflow"] : [],
      at: path
    )
    guard (typography["maxLines"] == nil) == (typography["overflow"] == nil) else {
      throw invalid(path, "max_lines_and_overflow_must_appear_together")
    }
    try color(typography["color"], at: "\(path).color")
  }

  private func controlAccessibility(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    try keys(value, required: ["label"], optional: ["hint"], at: path)
    try localizedText(value["label"], at: "\(path).label")
    if let hint = value["hint"] { try localizedText(hint, at: "\(path).hint") }
  }

  private func textAccessibility(_ value: Any?, at path: String, legal: Bool) throws {
    let value = try object(value, at: path)
    guard let role = value["role"] as? String else {
      throw invalid("\(path).role", "expected_string")
    }
    if role == "text" {
      try keys(value, required: ["role"], optional: ["label"], at: path)
    } else if role == "heading", !legal {
      try keys(value, required: ["role", "level"], optional: ["label"], at: path)
    } else {
      throw invalid("\(path).role", legal ? "legal_text_requires_text_role" : "invalid_text_role")
    }
    if let label = value["label"] { try localizedText(label, at: "\(path).label") }
  }

  private func imageAccessibility(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    guard let hidden = value["hidden"] as? Bool else {
      throw invalid("\(path).hidden", "expected_boolean")
    }
    try keys(
      value,
      required: hidden ? ["hidden"] : ["hidden", "label"],
      at: path
    )
    if let label = value["label"] { try localizedText(label, at: "\(path).label") }
  }

  private func visibility(_ value: Any, at path: String) throws {
    let value = try object(value, at: path)
    guard let mode = value["mode"] as? String else {
      throw invalid("\(path).mode", "expected_string")
    }
    switch mode {
    case "always", "hidden": try keys(value, required: ["mode"], at: path)
    case "switch": try keys(value, required: ["mode", "switchId", "equals"], at: path)
    case "tab": try keys(value, required: ["mode", "tabsId", "equals"], at: path)
    default: throw invalid("\(path).mode", "invalid_visibility_mode")
    }
  }

  private func border(_ value: Any?, at path: String, override: Bool) throws {
    let value = try object(value, at: path)
    try keys(
      value,
      required: override ? [] : ["color", "width"],
      optional: override ? ["color", "width"] : [],
      at: path
    )
    if let colorValue = value["color"] { try color(colorValue, at: "\(path).color") }
  }

  private func edgeInsets(_ value: Any?, at path: String) throws {
    try keys(
      try object(value, at: path),
      required: ["top", "start", "bottom", "end"],
      at: path
    )
  }

  private func edgeInsetsOverride(_ value: Any, at path: String) throws {
    try keys(
      try object(value, at: path),
      required: [],
      optional: ["top", "start", "bottom", "end"],
      at: path
    )
  }

  private func localizedText(_ value: Any?, at path: String) throws {
    try keys(
      try object(value, at: path),
      required: ["default", "localizationKey"],
      at: path
    )
  }

  private func color(_ value: Any?, at path: String) throws {
    if value is String { return }
    let token = try object(value, at: path)
    try keys(token, required: ["type", "id"], at: path)
    guard token["type"] as? String == "colorToken" else {
      throw invalid(path, "expected_color")
    }
  }

  private func background(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    guard let type = value["type"] as? String else {
      throw invalid("\(path).type", "expected_string")
    }
    switch type {
    case "color":
      try keys(value, required: ["type", "value"], at: path)
      try color(value["value"], at: "\(path).value")
    case "linearGradient":
      try keys(value, required: ["type", "angle", "stops"], at: path)
      try gradientStops(value["stops"], at: "\(path).stops")
    case "radialGradient":
      try keys(value, required: ["type", "center", "radius", "stops"], at: path)
      try keys(
        try object(value["center"], at: "\(path).center"), required: ["x", "y"],
        at: "\(path).center")
      try gradientStops(value["stops"], at: "\(path).stops")
    case "image":
      try keys(value, required: ["type", "assetId", "contentMode", "fallbackColor"], at: path)
      try color(value["fallbackColor"], at: "\(path).fallbackColor")
    case "video":
      try keys(
        value,
        required: ["type", "assetId", "contentMode", "fallbackColor"],
        optional: ["posterAssetId"], at: path)
      try color(value["fallbackColor"], at: "\(path).fallbackColor")
    case "backgroundToken": try keys(value, required: ["type", "id"], at: path)
    default: throw invalid("\(path).type", "invalid_background_type")
    }
  }

  private func gradientStops(_ value: Any?, at path: String) throws {
    let stops = try array(value, at: path)
    guard (2...8).contains(stops.count) else { throw invalid(path, "expected_2_to_8_items") }
    for (index, raw) in stops.enumerated() {
      let stopPath = "\(path)[\(index)]"
      let stop = try object(raw, at: stopPath)
      try keys(stop, required: ["position", "color"], at: stopPath)
      try color(stop["color"], at: "\(stopPath).color")
    }
  }

  private func shadow(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    switch value["type"] as? String {
    case "shadow":
      try keys(value, required: ["type", "color", "offsetX", "offsetY", "blurRadius"], at: path)
      try color(value["color"], at: "\(path).color")
    case "shadowToken": try keys(value, required: ["type", "id"], at: path)
    default: throw invalid("\(path).type", "invalid_shadow_type")
    }
  }

  private func object(_ value: Any?, at path: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else { throw invalid(path, "expected_object") }
    return value
  }

  private func array(_ value: Any?, at path: String) throws -> [Any] {
    guard let value = value as? [Any] else { throw invalid(path, "expected_array") }
    return value
  }

  private func keys(
    _ object: [String: Any],
    required: Set<String>,
    optional: Set<String> = [],
    at path: String
  ) throws {
    let actual = Set(object.keys)
    guard required.isSubset(of: actual) else { throw invalid(path, "missing_property") }
    guard actual.isSubset(of: permitted(required, optional)) else {
      throw invalid(path, "unknown_property")
    }
  }

  /// Every authored node in `0.4` may carry a `motion` block, and an authored
  /// node is exactly a shape that admits `visibility`.
  ///
  /// Deriving the allowance from that rather than repeating `"motion"` at
  /// sixteen call sites means a component added later cannot silently reject
  /// authored motion, and `0.3` cannot silently start accepting it. Product Card
  /// and Product Badge admit motion without admitting visibility, so they name
  /// the key themselves.
  private func permitted(_ required: Set<String>, _ optional: Set<String>) -> Set<String> {
    let all = required.union(optional)
    guard version.supportsMotion, all.contains("visibility") else { return all }
    return all.union(["motion"])
  }

  private func containsAuthoredStaticVisibility(in value: Any) -> Bool {
    if let values = value as? [Any] {
      return values.contains(where: containsAuthoredStaticVisibility)
    }
    guard let object = value as? [String: Any] else { return false }
    if let visibility = object["visibility"] as? [String: Any],
      let mode = visibility["mode"] as? String,
      mode == "always" || mode == "hidden"
    {
      return true
    }
    return object.values.contains(where: containsAuthoredStaticVisibility)
  }

  private func invalid(_ path: String, _ reason: String) -> MosaicProtocolError {
    .invalidShape(path: path, reason: reason)
  }
}
