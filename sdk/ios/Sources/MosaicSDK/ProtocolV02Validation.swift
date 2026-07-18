import Foundation

private let mosaicV02ExternalURLPattern =
  #"^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$"#

private func isSafeMosaicV02ExternalURL(_ raw: String) -> Bool {
  guard raw.unicodeScalars.count <= 2048,
    raw.range(of: mosaicV02ExternalURLPattern, options: .regularExpression) != nil
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

enum MosaicProtocolV02Shape {
  static func validate(_ root: [String: Any]) throws {
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

  private static func screen(
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

  private static func designSystem(_ value: Any?, at path: String) throws {
    let system = try object(value, at: path)
    try keys(system, required: ["colors", "backgrounds", "shadows"], at: path)
    let colors = try array(system["colors"], at: "\(path).colors")
    let backgrounds = try array(system["backgrounds"], at: "\(path).backgrounds")
    let shadows = try array(system["shadows"], at: "\(path).shadows")
    guard colors.count <= 256, backgrounds.count <= 256, shadows.count <= 256 else {
      throw invalid(path, "too_many_design_tokens")
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

  private static func localization(_ value: Any?, at path: String) throws {
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

  private static func asset(_ value: Any, at path: String) throws {
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
      guard let raw = source["url"] as? String, isSafeMosaicV02ExternalURL(raw) else {
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

  private static func product(_ value: Any, at path: String) throws {
    let product = try object(value, at: path)
    try keys(
      product,
      required: ["id", "productId", "label"],
      at: path
    )
    try localizedText(product["label"], at: "\(path).label")
  }

  private static func scrollContainer(_ value: Any?, at path: String) throws {
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

  private static func stack(_ value: Any?, at path: String) throws {
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
    try edgeInsets(stack["padding"], at: "\(path).padding")
    try optionalPresentation(stack, at: path, appearanceKind: .container, sizingKind: .box)
    for (index, child) in try array(stack["children"], at: "\(path).children").enumerated() {
      try node(child, at: "\(path).children[\(index)]")
    }
  }

  private static func node(_ value: Any, at path: String) throws {
    let node = try object(value, at: path)
    guard let type = node["type"] as? String else {
      throw invalid("\(path).type", "expected_string")
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
      try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
      let items = try array(node["items"], at: "\(path).items")
      guard !items.isEmpty else { throw invalid("\(path).items", "expected_nonempty_array") }
      for (index, value) in items.enumerated() {
        let itemPath = "\(path).items[\(index)]"
        let item = try object(value, at: itemPath)
        try keys(item, required: ["id", "text"], at: itemPath)
        try localizedText(item["text"], at: "\(itemPath).text")
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
    default:
      throw invalid("\(path).type", "unsupported_component")
    }
  }

  private static func button(_ node: [String: Any], at path: String) throws {
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
        isSafeMosaicV02ExternalURL(url)
      else { throw invalid("\(path).action.url", "invalid_external_url") }
    default:
      throw invalid("\(path).action.type", "unsupported_action")
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .box)
  }

  private static func productSelector(_ node: [String: Any], at path: String) throws {
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

  private static func productCard(_ value: Any, at path: String) throws {
    let card = try object(value, at: path)
    try keys(
      card,
      required: [
        "type", "id", "productReferenceId", "direction", "gap", "mainAxisDistribution",
        "crossAxisAlignment", "children", "styles",
      ],
      optional: ["sizing", "clipContent", "accessibility"],
      at: path
    )
    guard card["type"] as? String == "productCard" else {
      throw invalid("\(path).type", "expected_product_card")
    }
    let children = try array(card["children"], at: "\(path).children")
    guard !children.isEmpty else { throw invalid("\(path).children", "expected_nonempty_array") }
    for (index, child) in children.enumerated() {
      try productCardChild(child, at: "\(path).children[\(index)]")
    }
    try authoredProductStyles(card["styles"], at: "\(path).styles")
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

  private static func productCardChild(_ value: Any, at path: String) throws {
    let child = try object(value, at: path)
    if child["type"] as? String == "productBadge" {
      try productBadge(child, at: path)
    } else {
      try productCardPassiveNode(child, at: path)
    }
  }

  private static func productCardPassiveNode(_ node: [String: Any], at path: String) throws {
    switch node["type"] as? String {
    case "stack":
      try productCardPassiveStack(node, at: path)
    case "text", "image", "icon", "featureList", "countdown":
      try self.node(node, at: path)
    default:
      throw invalid("\(path).type", "unsupported_product_card_child")
    }
  }

  private static func productCardPassiveStack(_ stack: [String: Any], at path: String) throws {
    try keys(
      stack,
      required: [
        "type", "id", "direction", "gap", "padding", "mainAxisDistribution",
        "crossAxisAlignment", "children",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    try edgeInsets(stack["padding"], at: "\(path).padding")
    try optionalPresentation(stack, at: path, appearanceKind: .container, sizingKind: .box)
    for (index, child) in try array(stack["children"], at: "\(path).children").enumerated() {
      try productCardPassiveNode(
        try object(child, at: "\(path).children[\(index)]"),
        at: "\(path).children[\(index)]"
      )
    }
  }

  private static func productBadge(_ badge: [String: Any], at path: String) throws {
    try keys(
      badge,
      required: [
        "type", "id", "placement", "direction", "gap", "mainAxisDistribution",
        "crossAxisAlignment", "children", "styles",
      ],
      optional: ["sizing"],
      at: path
    )
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
    try authoredProductStyles(badge["styles"], at: "\(path).styles")
    if let sizing = badge["sizing"] {
      try self.sizing(sizing, at: "\(path).sizing", allowsHeight: true)
    }
  }

  private static func authoredProductStyles(_ value: Any?, at path: String) throws {
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

  private static func carousel(_ node: [String: Any], at path: String) throws {
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

  private static func switchControl(_ node: [String: Any], at path: String) throws {
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

  private static func countdown(_ node: [String: Any], at path: String) throws {
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

  private static func optionalPresentation(
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

  private static func appearance(_ value: Any, at path: String, container: Bool) throws {
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

  private static func sizing(_ value: Any, at path: String, allowsHeight: Bool) throws {
    let value = try object(value, at: path)
    guard !value.isEmpty else { throw invalid(path, "expected_nonempty_object") }
    try keys(value, required: ["width", "height"], at: path)
    if let widthValue = value["width"] { try width(widthValue, at: "\(path).width") }
    if let heightValue = value["height"] { try height(heightValue, at: "\(path).height") }
  }

  private static func width(_ value: Any?, at path: String) throws {
    if let value = value as? String {
      guard value == "fit" || value == "fill" else { throw invalid(path, "invalid_width") }
      return
    }
    let value = try object(value, at: path)
    try keys(value, required: ["mode", "value"], at: path)
  }

  private static func height(_ value: Any, at path: String) throws {
    if let value = value as? String {
      guard value == "fit" || value == "fill" else { throw invalid(path, "invalid_height") }
      return
    }
    let value = try object(value, at: path)
    try keys(value, required: ["mode", "value"], at: path)
  }

  private static func typography(_ value: Any?, at path: String, allowsTruncation: Bool) throws {
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

  private static func controlAccessibility(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    try keys(value, required: ["label"], optional: ["hint"], at: path)
    try localizedText(value["label"], at: "\(path).label")
    if let hint = value["hint"] { try localizedText(hint, at: "\(path).hint") }
  }

  private static func textAccessibility(_ value: Any?, at path: String, legal: Bool) throws {
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

  private static func imageAccessibility(_ value: Any?, at path: String) throws {
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

  private static func visibility(_ value: Any, at path: String) throws {
    let value = try object(value, at: path)
    guard let mode = value["mode"] as? String else {
      throw invalid("\(path).mode", "expected_string")
    }
    switch mode {
    case "always", "hidden": try keys(value, required: ["mode"], at: path)
    case "switch": try keys(value, required: ["mode", "switchId", "equals"], at: path)
    default: throw invalid("\(path).mode", "invalid_visibility_mode")
    }
  }

  private static func border(_ value: Any?, at path: String, override: Bool) throws {
    let value = try object(value, at: path)
    try keys(
      value,
      required: override ? [] : ["color", "width"],
      optional: override ? ["color", "width"] : [],
      at: path
    )
    if let colorValue = value["color"] { try color(colorValue, at: "\(path).color") }
  }

  private static func edgeInsets(_ value: Any?, at path: String) throws {
    try keys(
      try object(value, at: path),
      required: ["top", "start", "bottom", "end"],
      at: path
    )
  }

  private static func edgeInsetsOverride(_ value: Any, at path: String) throws {
    try keys(
      try object(value, at: path),
      required: [],
      optional: ["top", "start", "bottom", "end"],
      at: path
    )
  }

  private static func localizedText(_ value: Any?, at path: String) throws {
    try keys(
      try object(value, at: path),
      required: ["default", "localizationKey"],
      at: path
    )
  }

  private static func color(_ value: Any?, at path: String) throws {
    if value is String { return }
    let token = try object(value, at: path)
    try keys(token, required: ["type", "id"], at: path)
    guard token["type"] as? String == "colorToken" else {
      throw invalid(path, "expected_color")
    }
  }

  private static func background(_ value: Any?, at path: String) throws {
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

  private static func gradientStops(_ value: Any?, at path: String) throws {
    let stops = try array(value, at: path)
    guard (2...8).contains(stops.count) else { throw invalid(path, "expected_2_to_8_items") }
    for (index, raw) in stops.enumerated() {
      let stopPath = "\(path)[\(index)]"
      let stop = try object(raw, at: stopPath)
      try keys(stop, required: ["position", "color"], at: stopPath)
      try color(stop["color"], at: "\(stopPath).color")
    }
  }

  private static func shadow(_ value: Any?, at path: String) throws {
    let value = try object(value, at: path)
    switch value["type"] as? String {
    case "shadow":
      try keys(value, required: ["type", "color", "offsetX", "offsetY", "blurRadius"], at: path)
      try color(value["color"], at: "\(path).color")
    case "shadowToken": try keys(value, required: ["type", "id"], at: path)
    default: throw invalid("\(path).type", "invalid_shadow_type")
    }
  }

  private static func object(_ value: Any?, at path: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else { throw invalid(path, "expected_object") }
    return value
  }

  private static func array(_ value: Any?, at path: String) throws -> [Any] {
    guard let value = value as? [Any] else { throw invalid(path, "expected_array") }
    return value
  }

  private static func keys(
    _ object: [String: Any],
    required: Set<String>,
    optional: Set<String> = [],
    at path: String
  ) throws {
    let actual = Set(object.keys)
    guard required.isSubset(of: actual) else { throw invalid(path, "missing_property") }
    guard actual.isSubset(of: required.union(optional)) else {
      throw invalid(path, "unknown_property")
    }
  }

  private static func containsAuthoredStaticVisibility(in value: Any) -> Bool {
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

  private static func invalid(_ path: String, _ reason: String) -> MosaicProtocolError {
    .invalidShape(path: path, reason: reason)
  }
}

enum MosaicProtocolV02Semantics {
  static func validate(_ document: MosaicPaywallDocument) throws {
    guard document.schemaVersion == mosaicProtocolVersion else {
      throw MosaicProtocolError.unsupportedSchemaVersion(document.schemaVersion)
    }
    guard (1...Int(Int32.max)).contains(document.revision) else {
      throw violation("protocol_invalid_revision")
    }
    try identifier(document.id)

    var declared = Set<MosaicCapabilityName>()
    for capability in document.compatibility.requiredCapabilities {
      guard capability.version == mosaicProtocolVersion else {
        throw MosaicProtocolError.unsupportedCapability(
          name: capability.name.rawValue, version: capability.version)
      }
      guard MosaicCapabilityCatalog.v02.contains(capability.name) else {
        throw MosaicProtocolError.unsupportedCapability(
          name: capability.name.rawValue, version: capability.version)
      }
      guard declared.insert(capability.name).inserted else {
        throw MosaicProtocolError.duplicateCapability(name: capability.name.rawValue)
      }
    }

    guard let designSystem = document.designSystem else {
      throw violation("protocol_missing_design_system")
    }
    try validateDesignSystem(designSystem, document: document)

    var state = State(document: document)
    state.capabilities.formUnion([.scrollContainer, .stack, .screens, .localizationCatalogs])
    if !designSystem.colors.isEmpty || !designSystem.backgrounds.isEmpty
      || !designSystem.shadows.isEmpty
    {
      state.capabilities.insert(.designTokens)
    }

    for asset in document.assets {
      try identifier(asset.id)
      guard state.assetIDs.insert(asset.id).inserted else {
        throw violation("protocol_duplicate_asset_id")
      }
      state.assetTypes[asset.id] = asset.type
      switch asset.source {
      case .bundled(let key):
        try assetKey(key)
        state.capabilities.insert(asset.type == .image ? .bundledImage : .bundledVideo)
      case .remote(let url):
        guard isSafeMosaicV02ExternalURL(url.absoluteString) else {
          throw violation("protocol_invalid_remote_asset_url")
        }
        state.capabilities.insert(asset.type == .image ? .remoteImage : .remoteVideo)
      }
      if let fallback = asset.fallback {
        guard asset.type == .image else { throw violation("protocol_video_asset_has_fallback") }
        state.localizedText(fallback.value)
        state.capabilities.insert(.assetFallback)
      } else if asset.type == .image {
        throw violation("protocol_image_asset_missing_fallback")
      }
    }
    for token in designSystem.backgrounds { try state.background(token.value) }
    for token in designSystem.shadows {
      state.capabilities.insert(.shadow)
      try state.shadow(token.value)
    }

    for product in document.products {
      try identifier(product.id)
      try providerProductID(product.productId)
      guard state.productReferenceIDs.insert(product.id).inserted else {
        throw violation("protocol_duplicate_product_reference_id")
      }
      guard state.providerProductIDs.insert(product.productId).inserted else {
        throw violation("protocol_duplicate_provider_product_id")
      }
      state.localizedText(product.label)
      state.localizedText(product.badge)
    }
    if !document.products.isEmpty { state.capabilities.insert(.productReferences) }

    guard (1...10).contains(document.screens.count) else {
      throw violation("protocol_invalid_screen_count")
    }
    for screen in document.screens {
      try identifier(screen.id)
      guard state.screenIDs.insert(screen.id).inserted else {
        throw violation("protocol_duplicate_screen_id")
      }
    }
    guard let initialScreenID = document.initialScreenId,
      state.screenIDs.contains(initialScreenID)
    else { throw violation("protocol_unknown_initial_screen") }
    guard document.screen(id: initialScreenID)?.presentation?.type == .screen else {
      throw violation("protocol_initial_screen_must_be_screen")
    }

    for screen in document.screens {
      state.currentScreenID = screen.id
      if let label = screen.accessibilityLabel {
        state.localizedText(label)
      } else if document.screens.count > 1 {
        throw violation("protocol_missing_screen_accessibility_label")
      }
      guard let presentation = screen.presentation else {
        throw violation("protocol_missing_screen_presentation")
      }
      if presentation.type == .sheet { state.capabilities.insert(.sheets) }
      try state.layoutID(screen.layout.id)
      guard screen.layout.type == .scrollContainer else {
        throw violation("protocol_invalid_root_layout")
      }
      if let background = screen.layout.background {
        state.capabilities.formUnion([.boxStyle, .colors])
        try state.background(background)
      }
      guard screen.layout.content.direction == .vertical else {
        throw violation("protocol_root_stack_must_be_vertical")
      }
      guard !screen.layout.content.children.isEmpty else {
        throw violation("protocol_empty_root_stack")
      }
      try state.stack(screen.layout.content, carouselDepth: 0)
    }
    state.currentScreenID = nil

    guard state.usedAssetIDs == state.assetIDs else {
      throw violation("protocol_asset_reference_mismatch")
    }
    guard state.usedProductReferenceIDs == state.productReferenceIDs else {
      throw violation("protocol_product_reference_mismatch")
    }
    guard state.selectorIDs == state.purchaseSelectorIDs else {
      throw violation("protocol_purchase_action_mismatch")
    }

    for reference in state.visibilityReferences {
      guard state.switchScreenByID[reference.switchID] == reference.screenID else {
        throw violation("protocol_unknown_visibility_switch")
      }
      guard reference.nodeID != reference.switchID else {
        throw violation("protocol_self_visibility_switch")
      }
    }
    for reference in state.purchaseReferences {
      guard state.selectorScreenByID[reference.selectorID] == reference.screenID else {
        throw violation("protocol_purchase_selector_must_share_screen")
      }
    }
    for target in state.navigationEdges.values.flatMap(\.self) {
      guard state.screenIDs.contains(target) else {
        throw violation("protocol_unknown_navigation_screen")
      }
    }
    try validateNavigationGraph(
      initialScreenID: initialScreenID,
      screenIDs: state.screenIDs,
      edges: state.navigationEdges
    )

    try validateLocalization(
      document.localization,
      texts: state.localizedTextEntries.map(\.text)
    )
    let usesProductTemplate = try validateProductTemplates(
      document.localization,
      entries: state.localizedTextEntries
    )
    if usesProductTemplate { state.capabilities.insert(.productTemplate) }
    if document.localization.locales.values.contains(where: { $0.direction == .rightToLeft }) {
      state.capabilities.insert(.localizationRTL)
    }

    if let missing = state.capabilities.subtracting(declared).first {
      throw violation("protocol_missing_capability_\(missing.rawValue)")
    }
    let unused = declared.subtracting(state.capabilities)
    guard unused.isSubset(of: [.staticVisibility]) else {
      throw violation("protocol_unused_capability")
    }
  }

  private struct VisibilityReference {
    let nodeID: String
    let switchID: String
    let screenID: String
  }

  private struct PurchaseReference {
    let selectorID: String
    let screenID: String
  }

  private struct LocalizedTextEntry {
    let text: MosaicLocalizedText
    let productTemplateAllowed: Bool
  }

  private struct State {
    var capabilities = Set<MosaicCapabilityName>()
    var screenIDs = Set<String>()
    var layoutIDs = Set<String>()
    var assetIDs = Set<String>()
    var assetTypes: [String: MosaicAssetType] = [:]
    var usedAssetIDs = Set<String>()
    var productReferenceIDs = Set<String>()
    var providerProductIDs = Set<String>()
    var usedProductReferenceIDs = Set<String>()
    var selectorIDs = Set<String>()
    var purchaseSelectorIDs = Set<String>()
    var selectorScreenByID: [String: String] = [:]
    var switchScreenByID: [String: String] = [:]
    var visibilityReferences: [VisibilityReference] = []
    var purchaseReferences: [PurchaseReference] = []
    var navigationEdges: [String: Set<String>] = [:]
    var localizedTextEntries: [LocalizedTextEntry] = []
    var currentScreenID: String?
    let document: MosaicPaywallDocument

    mutating func layoutID(_ id: String) throws {
      try identifier(id)
      guard layoutIDs.insert(id).inserted else { throw violation("protocol_duplicate_layout_id") }
    }

    mutating func stack(
      _ stack: MosaicStack,
      carouselDepth: Int,
      productCardContext: Bool = false
    ) throws {
      guard stack.type == .stack else { throw violation("protocol_invalid_stack_type") }
      try layoutID(stack.id)
      try logicalSize(stack.gap)
      try insets(stack.padding)
      capabilities.formUnion([.stack, .boxStyle])
      try presentation(
        id: stack.id,
        appearance: stack.appearance,
        sizing: stack.sizing,
        outerInsets: stack.outerInsets,
        visibility: stack.visibility
      )
      for node in stack.children {
        try validate(
          node,
          carouselDepth: carouselDepth,
          productCardContext: productCardContext
        )
      }
    }

    mutating func validate(
      _ node: MosaicNode,
      carouselDepth: Int,
      productCardContext: Bool = false
    ) throws {
      if productCardContext, !isPassiveProductCardNode(node) {
        throw violation("protocol_interactive_product_card_descendant")
      }
      switch node {
      case .verticalStack:
        throw violation("protocol_0_1_node_in_0_2_document")
      case .stack(let component):
        try stack(
          component,
          carouselDepth: carouselDepth,
          productCardContext: productCardContext
        )
      case .text(let component):
        try layoutID(component.id)
        capabilities.formUnion([.text, .typography, .colors, .accessibilityMetadata])
        localizedText(component.value, productTemplateAllowed: productCardContext)
        try textAccessibility(component.accessibility)
        localizedText(component.accessibility.label)
        try typography(component.typography, allowsTruncation: true)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .image(let component):
        try layoutID(component.id)
        capabilities.formUnion([.image, .accessibilityMetadata])
        try identifier(component.assetId)
        if let aspectRatio = component.aspectRatio {
          try finite(
            aspectRatio, minimum: .leastNonzeroMagnitude, maximum: 10,
            code: "protocol_invalid_image_aspect_ratio")
        }
        usedAssetIDs.insert(component.assetId)
        guard assetTypes[component.assetId] == .image else {
          throw violation("protocol_image_component_requires_image_asset")
        }
        if case .informative(let label) = component.accessibility { localizedText(label) }
        try presentation(
          id: component.id, appearance: component.appearance, sizing: component.sizing,
          outerInsets: component.outerInsets, visibility: component.visibility)
      case .icon(let component):
        try layoutID(component.id)
        capabilities.formUnion([.icon, .colors, .accessibilityMetadata])
        try positiveSize(component.size)
        try color(component.color)
        if case .informative(let label) = component.accessibility { localizedText(label) }
        try presentation(
          id: component.id, appearance: component.appearance, sizing: component.sizing,
          outerInsets: component.outerInsets, visibility: component.visibility)
      case .featureList(let component):
        try layoutID(component.id)
        capabilities.formUnion([.featureList, .typography, .colors, .accessibilityMetadata])
        try logicalSize(component.gap)
        try color(component.markerColor)
        try typography(component.typography, allowsTruncation: false)
        guard !component.items.isEmpty else { throw violation("protocol_empty_feature_list") }
        var itemIDs = Set<String>()
        for item in component.items {
          try identifier(item.id)
          guard itemIDs.insert(item.id).inserted else {
            throw violation("protocol_duplicate_feature_id")
          }
          localizedText(item.text)
        }
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .productSelector(let component):
        try layoutID(component.id)
        capabilities.formUnion([
          .productSelector, .productFallback, .normalizedOutcome, .productCardStates,
          .colors, .boxStyle, .accessibilityMetadata,
        ])
        try logicalSize(component.gap)
        guard !component.cards.isEmpty else {
          throw violation("protocol_empty_product_selector")
        }
        var references = Set<String>()
        var cardIDs = Set<String>()
        for card in component.cards {
          let referenceID = card.productReferenceId
          try identifier(referenceID)
          guard references.insert(referenceID).inserted else {
            throw violation("protocol_duplicate_selector_product")
          }
          guard productReferenceIDs.contains(referenceID) else {
            throw violation("protocol_unknown_selector_product")
          }
          usedProductReferenceIDs.insert(referenceID)
          guard cardIDs.insert(card.id).inserted else {
            throw violation("protocol_duplicate_product_card_id")
          }
          try productCard(card)
        }
        guard let initialProductCardID = component.initialProductCardId,
          cardIDs.contains(initialProductCardID)
        else {
          throw violation("protocol_invalid_initial_selection")
        }
        selectorIDs.insert(component.id)
        selectorScreenByID[component.id] = try screenID()
        localizedText(component.unavailableFallback.message)
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .button(let component):
        try layoutID(component.id)
        capabilities.formUnion([.button, .accessibilityMetadata])
        try logicalSize(component.gap)
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        guard !component.children.isEmpty else { throw violation("protocol_empty_button_content") }
        guard !component.children.contains(where: containsInteractiveNode) else {
          throw violation("protocol_interactive_button_descendant")
        }
        for child in component.children { try validate(child, carouselDepth: carouselDepth) }
        if let inProgressChildren = component.inProgressChildren {
          guard !inProgressChildren.isEmpty else {
            throw violation("protocol_empty_button_progress_content")
          }
          guard !inProgressChildren.contains(where: containsInteractiveNode) else {
            throw violation("protocol_interactive_button_descendant")
          }
          for child in inProgressChildren { try validate(child, carouselDepth: carouselDepth) }
        }
        let currentScreenID = try screenID()
        switch component.action {
        case .purchase(let selectorID):
          capabilities.formUnion([.purchaseAction, .normalizedOutcome])
          try identifier(selectorID)
          purchaseSelectorIDs.insert(selectorID)
          purchaseReferences.append(
            PurchaseReference(selectorID: selectorID, screenID: currentScreenID))
        case .restore:
          capabilities.formUnion([.restoreAction, .normalizedOutcome])
        case .close:
          capabilities.formUnion([.closeAction, .normalizedOutcome])
        case .navigateTo(let targetScreenID):
          capabilities.insert(.navigateToAction)
          try identifier(targetScreenID)
          navigationEdges[currentScreenID, default: []].insert(targetScreenID)
        case .navigateBack:
          capabilities.insert(.navigateBackAction)
        case .openExternalURL(let url):
          capabilities.insert(.openExternalURLAction)
          try externalURL(url)
        }
        if component.inProgressChildren != nil,
          component.action.type != .purchase && component.action.type != .restore
        {
          throw violation("protocol_progress_content_requires_async_action")
        }
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .purchaseButton, .restoreButton, .closeButton, .legalText:
        throw violation("protocol_0_1_node_in_0_2_document")
      case .carousel(let component):
        try layoutID(component.id)
        capabilities.formUnion([.carousel, .accessibilityMetadata])
        guard carouselDepth == 0 else { throw violation("protocol_nested_carousel") }
        guard (2...20).contains(component.pages.count),
          component.pages.indices.contains(component.initialPageIndex)
        else { throw violation("protocol_invalid_carousel_pages") }
        var pageIDs = Set<String>()
        for page in component.pages {
          try identifier(page.id)
          guard layoutIDs.insert(page.id).inserted, pageIDs.insert(page.id).inserted else {
            throw violation("protocol_duplicate_layout_id")
          }
          localizedText(page.accessibilityLabel)
          try stack(page.content, carouselDepth: carouselDepth + 1)
        }
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .switchControl(let component):
        try layoutID(component.id)
        switchScreenByID[component.id] = try screenID()
        capabilities.formUnion([.switchControl, .typography, .colors, .accessibilityMetadata])
        localizedText(component.label)
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try typography(component.typography, allowsTruncation: false)
        try color(component.offTrackColor)
        try color(component.onTrackColor)
        try color(component.thumbColor)
        try presentation(
          id: component.id, appearance: component.appearance, sizing: component.sizing,
          outerInsets: component.outerInsets, visibility: component.visibility)
      case .countdown(let component):
        try layoutID(component.id)
        capabilities.formUnion([.countdown, .typography, .colors, .accessibilityMetadata])
        guard component.largestUnit.rank >= component.smallestUnit.rank else {
          throw violation("protocol_invalid_countdown_unit_order")
        }
        guard canonicalDate(component.endsAt) != nil else {
          throw violation("protocol_invalid_countdown_timestamp")
        }
        localizedText(component.completedText)
        try textAccessibility(component.accessibility)
        localizedText(component.accessibility.label)
        try typography(component.typography, allowsTruncation: false)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      }
    }

    mutating func presentation(
      id: String,
      appearance: MosaicBoxAppearance?,
      sizing: MosaicBoxSizing?,
      outerInsets: MosaicEdgeInsets?,
      visibility: MosaicVisibility
    ) throws {
      if let appearance {
        capabilities.insert(.boxStyle)
        if appearance.background != nil || appearance.border != nil { capabilities.insert(.colors) }
        if let background = appearance.background { try self.background(background) }
        if let border = appearance.border { try borderValue(border) }
        if let radius = appearance.cornerRadius { try logicalSize(radius) }
        if let opacity = appearance.opacity {
          try finite(opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
        }
        if let padding = appearance.padding { try insets(padding) }
        if appearance.clipContent != nil { capabilities.insert(.clipping) }
        if let shadow = appearance.shadow {
          capabilities.insert(.shadow)
          try self.shadow(shadow)
        }
      }
      if let sizing {
        try validateSizing(sizing)
      }
      if let outerInsets {
        capabilities.insert(.outerInsets)
        try insets(outerInsets)
      }
      switch visibility {
      case .always: break
      case .hidden: capabilities.insert(.staticVisibility)
      case .switchValue(let switchID, _):
        capabilities.insert(.switchVisibility)
        visibilityReferences.append(
          VisibilityReference(nodeID: id, switchID: switchID, screenID: try screenID()))
      }
    }

    mutating func validateSizing(_ sizing: MosaicBoxSizing) throws {
      capabilities.formUnion([.sizing, .heightSizing])
      guard let widthValue = sizing.width, let height = sizing.height else {
        throw violation("protocol_incomplete_box_sizing")
      }
      if case .content = widthValue {
        throw violation("protocol_candidate_content_sizing_not_supported")
      }
      try width(widthValue)
      switch height {
      case .content: throw violation("protocol_candidate_content_sizing_not_supported")
      case .fit, .fill: break
      case .fixed(let value): try positiveSize(value)
      }
    }

    private func screenID() throws -> String {
      guard let currentScreenID else { throw violation("protocol_missing_validation_screen") }
      return currentScreenID
    }

    private func containsInteractiveNode(_ node: MosaicNode) -> Bool {
      switch node {
      case .button, .productSelector, .switchControl, .carousel:
        true
      case .stack(let stack), .verticalStack(let stack):
        stack.children.contains(where: containsInteractiveNode)
      default:
        false
      }
    }

    private func isPassiveProductCardNode(_ node: MosaicNode) -> Bool {
      switch node {
      case .stack, .text, .image, .icon, .featureList, .countdown:
        true
      case .verticalStack, .productSelector, .button, .purchaseButton, .restoreButton,
        .closeButton, .legalText, .carousel, .switchControl:
        false
      }
    }

    mutating func productCard(_ card: MosaicProductCardComponent) throws {
      try layoutID(card.id)
      capabilities.formUnion([
        .productCard, .productCardStates, .boxStyle, .colors,
      ])
      try logicalSize(card.gap)
      guard !card.children.isEmpty else { throw violation("protocol_empty_product_card") }
      guard card.clipContent == nil || card.clipContent == false else {
        throw violation("protocol_invalid_product_card_clipping")
      }
      let badges = card.children.compactMap { child -> MosaicProductBadgeComponent? in
        guard case .badge(let badge) = child else { return nil }
        return badge
      }
      guard badges.count <= 1 else { throw violation("protocol_multiple_product_badges") }

      let productCardMetrics = card.children.reduce(into: ProductCardMetrics()) { result, child in
        result.merge(metrics(for: child, stackDepth: 0))
      }
      guard productCardMetrics.descendantCount <= 20 else {
        throw violation("protocol_product_card_descendant_limit")
      }
      guard productCardMetrics.maximumStackDepth <= 4 else {
        throw violation("protocol_product_card_stack_depth")
      }

      try authoredProductStyles(card.styles)
      if let sizing = card.sizing { try validateSizing(sizing) }
      if let accessibility = card.accessibility {
        localizedText(accessibility.label, productTemplateAllowed: true)
      }
      for child in card.children {
        switch child {
        case .node(let node):
          try validate(node, carouselDepth: 0, productCardContext: true)
        case .badge(let badge):
          try productBadge(badge)
        }
      }
    }

    mutating func productBadge(_ badge: MosaicProductBadgeComponent) throws {
      try layoutID(badge.id)
      capabilities.formUnion([
        .productBadge, .productCardStates, .boxStyle, .colors,
      ])
      try logicalSize(badge.gap)
      guard (1...10).contains(badge.children.count) else {
        throw violation("protocol_invalid_product_badge_children")
      }
      if case .overlay(_, let inset) = badge.placement {
        try finite(
          inset,
          minimum: 0,
          maximum: 64,
          code: "protocol_invalid_product_badge_inset"
        )
      }
      try authoredProductStyles(badge.styles)
      if let sizing = badge.sizing { try validateSizing(sizing) }
      for child in badge.children {
        try validate(child, carouselDepth: 0, productCardContext: true)
      }
    }

    func color(_ value: MosaicColor) throws {
      try MosaicProtocolV02Semantics.color(value)
      guard document.resolvedColor(value) != nil else {
        throw violation("protocol_unknown_or_cyclic_color_token")
      }
    }

    func borderValue(_ value: MosaicBorder) throws {
      try color(value.color)
      try logicalSize(value.width)
    }

    func typography(_ value: MosaicTypography, allowsTruncation: Bool) throws {
      try MosaicProtocolV02Semantics.typography(value, allowsTruncation: allowsTruncation)
      try color(value.color)
    }

    mutating func background(_ value: MosaicBackground) throws {
      guard let resolved = document.resolvedBackground(value) else {
        throw violation("protocol_unknown_or_cyclic_background_token")
      }
      if case .token = value { capabilities.insert(.designTokens) }
      switch resolved {
      case .color(let color): try self.color(color)
      case .linearGradient(let angle, let stops):
        capabilities.insert(.gradientBackground)
        try finite(angle, minimum: 0, maximum: 360, code: "protocol_invalid_gradient_angle")
        guard (2...8).contains(stops.count) else {
          throw violation("protocol_invalid_gradient_stops")
        }
        for stop in stops { try self.color(stop.color) }
        var prior = -Double.infinity
        for stop in stops {
          guard stop.position >= 0, stop.position <= 1, stop.position > prior else {
            throw violation("protocol_invalid_gradient_stops")
          }
          prior = stop.position
        }
      case .radialGradient(let center, let radius, let stops):
        capabilities.insert(.gradientBackground)
        try finite(center.x, minimum: 0, maximum: 1, code: "protocol_invalid_gradient_center")
        try finite(center.y, minimum: 0, maximum: 1, code: "protocol_invalid_gradient_center")
        try finite(
          radius, minimum: .leastNonzeroMagnitude, maximum: 2,
          code: "protocol_invalid_gradient_radius")
        guard (2...8).contains(stops.count) else {
          throw violation("protocol_invalid_gradient_stops")
        }
        for stop in stops { try self.color(stop.color) }
        var prior = -Double.infinity
        for stop in stops {
          guard stop.position >= 0, stop.position <= 1, stop.position > prior else {
            throw violation("protocol_invalid_gradient_stops")
          }
          prior = stop.position
        }
      case .image(let assetID, _, let fallback):
        capabilities.insert(.mediaBackground)
        guard assetTypes[assetID] == .image else {
          throw violation("protocol_image_background_requires_image_asset")
        }
        usedAssetIDs.insert(assetID)
        try self.color(fallback)
      case .video(let assetID, let posterID, _, let fallback):
        capabilities.insert(.mediaBackground)
        guard assetTypes[assetID] == .video else {
          throw violation("protocol_video_background_requires_video_asset")
        }
        usedAssetIDs.insert(assetID)
        if let posterID {
          guard assetTypes[posterID] == .image else {
            throw violation("protocol_video_poster_requires_image_asset")
          }
          usedAssetIDs.insert(posterID)
        }
        try self.color(fallback)
      case .token: preconditionFailure("Resolved background cannot remain a token")
      }
    }

    func shadow(_ value: MosaicShadow) throws {
      guard let resolved = document.resolvedShadow(value) else {
        throw violation("protocol_unknown_or_cyclic_shadow_token")
      }
      guard case .value(let color, let x, let y, let blur) = resolved else {
        throw violation("protocol_invalid_shadow")
      }
      try self.color(color)
      try finite(x, minimum: -4096, maximum: 4096, code: "protocol_invalid_shadow_offset")
      try finite(y, minimum: -4096, maximum: 4096, code: "protocol_invalid_shadow_offset")
      try logicalSize(blur)
    }

    mutating func authoredProductStyles(_ styles: MosaicAuthoredProductStyles) throws {
      let base = styles.defaultStyle
      try background(base.background)
      try borderValue(base.border)
      try logicalSize(base.cornerRadius)
      try insets(base.padding)
      try finite(base.opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
      if let shadow = base.shadow {
        capabilities.insert(.shadow)
        try self.shadow(shadow)
      }
      let selected = styles.selected.resolving(base)
      try background(selected.background)
      try borderValue(selected.border)
      try logicalSize(selected.cornerRadius)
      try insets(selected.padding)
      try finite(selected.opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
      if let shadow = selected.shadow {
        capabilities.insert(.shadow)
        try self.shadow(shadow)
      }
    }

    private struct ProductCardMetrics {
      var descendantCount = 0
      var maximumStackDepth = 0

      mutating func merge(_ other: ProductCardMetrics) {
        descendantCount += other.descendantCount
        maximumStackDepth = max(maximumStackDepth, other.maximumStackDepth)
      }
    }

    private func metrics(
      for child: MosaicProductCardChild,
      stackDepth: Int
    ) -> ProductCardMetrics {
      switch child {
      case .node(let node): metrics(for: node, stackDepth: stackDepth)
      case .badge(let badge):
        badge.children.reduce(
          into: ProductCardMetrics(descendantCount: 1, maximumStackDepth: stackDepth)
        ) { result, child in
          result.merge(metrics(for: child, stackDepth: stackDepth))
        }
      }
    }

    private func metrics(for node: MosaicNode, stackDepth: Int) -> ProductCardMetrics {
      switch node {
      case .stack(let stack):
        let nextDepth = stackDepth + 1
        return stack.children.reduce(
          into: ProductCardMetrics(descendantCount: 1, maximumStackDepth: nextDepth)
        ) { result, child in
          result.merge(metrics(for: child, stackDepth: nextDepth))
        }
      default:
        return ProductCardMetrics(
          descendantCount: 1,
          maximumStackDepth: stackDepth
        )
      }
    }

    mutating func localizedText(
      _ text: MosaicLocalizedText?,
      productTemplateAllowed: Bool = false
    ) {
      if let text {
        localizedTextEntries.append(
          LocalizedTextEntry(text: text, productTemplateAllowed: productTemplateAllowed)
        )
      }
    }
  }

  private static func validateNavigationGraph(
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

  private static func validateDesignSystem(
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

  private static func externalURL(_ url: URL) throws {
    guard isSafeMosaicV02ExternalURL(url.absoluteString) else {
      throw violation("protocol_invalid_external_url")
    }
  }

  private static func typography(
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

  private static func textAccessibility(_ value: MosaicTextAccessibility) throws {
    if let level = value.headingLevel, !(1...6).contains(level) {
      throw violation("protocol_invalid_heading_level")
    }
  }

  private static func validateLocalization(
    _ localization: MosaicLocalization, texts: [MosaicLocalizedText]
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
    guard Set(defaultCatalog.keys) == usedKeys else {
      throw violation("protocol_default_catalog_key_mismatch")
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

  private static func validateProductTemplates(
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

  private static func canonicalDate(_ value: String) -> Date? {
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

  private static func color(_ value: MosaicColor) throws {
    if case .literal(let raw) = value,
      raw.range(of: "^#[0-9A-F]{8}$", options: .regularExpression) == nil
    {
      throw violation("protocol_invalid_color")
    }
  }

  private static func borderValue(_ value: MosaicBorder) throws {
    try color(value.color)
    try logicalSize(value.width)
  }

  private static func width(_ value: MosaicWidthSizing) throws {
    if case .fixed(let value) = value { try positiveSize(value) }
  }

  private static func insets(_ value: MosaicEdgeInsets) throws {
    try logicalSize(value.top)
    try logicalSize(value.start)
    try logicalSize(value.bottom)
    try logicalSize(value.end)
  }

  private static func positiveSize(_ value: Double) throws {
    try finite(
      value, minimum: .leastNonzeroMagnitude, maximum: 4096,
      code: "protocol_invalid_positive_logical_size")
  }

  private static func logicalSize(_ value: Double) throws {
    try finite(value, minimum: 0, maximum: 4096, code: "protocol_invalid_logical_size")
  }

  private static func finite(
    _ value: Double, minimum: Double, maximum: Double, code: String
  ) throws {
    guard value.isFinite, value >= minimum, value <= maximum else { throw violation(code) }
  }

  private static func localizedText(_ value: MosaicLocalizedText) throws {
    try textValue(value.defaultValue)
    try localizationKey(value.localizationKey)
  }

  private static func identifier(_ value: String) throws {
    guard value.count <= 128, matches(value, identifierPattern) else {
      throw violation("protocol_invalid_identifier")
    }
  }

  private static func localizationKey(_ value: String) throws {
    guard value.count <= 256, matches(value, localizationKeyPattern) else {
      throw violation("protocol_invalid_localization_key")
    }
  }

  private static func localeTag(_ value: String) throws {
    guard matches(value, localeTagPattern) else { throw violation("protocol_invalid_locale_tag") }
  }

  private static func providerProductID(_ value: String) throws {
    guard value.count <= 256, matches(value, productIDPattern) else {
      throw violation("protocol_invalid_provider_product_id")
    }
  }

  private static func assetKey(_ value: String) throws {
    guard value.count <= 256, matches(value, assetKeyPattern) else {
      throw violation("protocol_invalid_asset_key")
    }
  }

  private static func textValue(_ value: String) throws {
    guard !value.isEmpty, value.count <= 5000 else {
      throw violation("protocol_invalid_localized_value")
    }
  }

  private static func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }

  private static func violation(_ code: String) -> MosaicProtocolError {
    .semanticViolation(code: code)
  }

  private static let identifierPattern = "^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$"
  private static let localizationKeyPattern = "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$"
  private static let localeTagPattern = "^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$"
  private static let productIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
  private static let assetKeyPattern = "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
}
