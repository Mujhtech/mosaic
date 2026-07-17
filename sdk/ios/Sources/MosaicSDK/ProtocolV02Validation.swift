import Foundation

enum MosaicProtocolV02Shape {
  static func validate(_ root: [String: Any]) throws {
    try keys(
      root,
      required: [
        "schemaVersion", "id", "revision", "compatibility", "localization", "assets",
        "products", "layout",
      ],
      at: "$"
    )

    let compatibility = try object(root["compatibility"], at: "$.compatibility")
    try keys(compatibility, required: ["requiredCapabilities"], at: "$.compatibility")
    for (index, value) in try array(
      compatibility["requiredCapabilities"], at: "$.compatibility.requiredCapabilities"
    ).enumerated() {
      try keys(
        try object(value, at: "$.compatibility.requiredCapabilities[\(index)]"),
        required: ["name", "version"],
        at: "$.compatibility.requiredCapabilities[\(index)]"
      )
    }

    try localization(root["localization"], at: "$.localization")
    for (index, value) in try array(root["assets"], at: "$.assets").enumerated() {
      try asset(value, at: "$.assets[\(index)]")
    }
    for (index, value) in try array(root["products"], at: "$.products").enumerated() {
      try product(value, at: "$.products[\(index)]")
    }
    try scrollContainer(root["layout"], at: "$.layout")
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
    try keys(asset, required: ["type", "id", "source", "fallback"], at: path)
    try keys(
      try object(asset["source"], at: "\(path).source"),
      required: ["type", "key"],
      at: "\(path).source"
    )
    let fallback = try object(asset["fallback"], at: "\(path).fallback")
    try keys(fallback, required: ["type", "value"], at: "\(path).fallback")
    try localizedText(fallback["value"], at: "\(path).fallback.value")
  }

  private static func product(_ value: Any, at path: String) throws {
    let product = try object(value, at: path)
    try keys(
      product,
      required: ["id", "productId", "label"],
      optional: ["badge"],
      at: path
    )
    try localizedText(product["label"], at: "\(path).label")
    if let badge = product["badge"] {
      try localizedText(badge, at: "\(path).badge")
    }
  }

  private static func scrollContainer(_ value: Any?, at path: String) throws {
    let container = try object(value, at: path)
    try keys(
      container,
      required: ["type", "id", "axis", "safeArea", "showsIndicators", "content"],
      optional: ["background"],
      at: path
    )
    if let background = container["background"] { try color(background, at: "\(path).background") }
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
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .widthOnly)
    case "image":
      try keys(
        node,
        required: ["type", "id", "assetId", "width", "contentMode", "accessibility"],
        optional: ["aspectRatio", "height", "appearance", "outerInsets", "visibility"],
        at: path
      )
      guard (node["aspectRatio"] == nil) != (node["height"] == nil) else {
        throw invalid(path, "expected_exactly_one_image_height_mode")
      }
      try width(node["width"], at: "\(path).width")
      try imageAccessibility(node["accessibility"], at: "\(path).accessibility")
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .none)
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
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .widthOnly)
    case "productSelector":
      try productSelector(node, at: path)
    case "purchaseButton":
      try button(node, at: path, kind: .purchase)
    case "restoreButton":
      try button(node, at: path, kind: .restore)
    case "closeButton":
      try button(node, at: path, kind: .close)
    case "legalText":
      try keys(
        node,
        required: ["type", "id", "value", "typography", "accessibility"],
        optional: ["appearance", "sizing", "outerInsets", "visibility"],
        at: path
      )
      try localizedText(node["value"], at: "\(path).value")
      try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
      try textAccessibility(node["accessibility"], at: "\(path).accessibility", legal: true)
      try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .widthOnly)
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

  private enum ButtonKind { case purchase, restore, close }

  private static func button(_ node: [String: Any], at path: String, kind: ButtonKind) throws {
    var required: Set<String> = ["type", "id", "label", "typography", "action", "accessibility"]
    if kind != .close { required.insert("inProgressLabel") }
    try keys(
      node,
      required: required,
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    try localizedText(node["label"], at: "\(path).label")
    if let value = node["inProgressLabel"] {
      try localizedText(value, at: "\(path).inProgressLabel")
    }
    try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
    let action = try object(node["action"], at: "\(path).action")
    switch kind {
    case .purchase:
      try keys(action, required: ["type", "productSelectorId"], at: "\(path).action")
    case .restore, .close:
      try keys(action, required: ["type"], at: "\(path).action")
    }
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .widthOnly)
  }

  private static func productSelector(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "productReferenceIds", "initiallySelectedProductReferenceId",
        "direction", "gap", "cardStyles", "unavailableFallback", "accessibility",
      ],
      optional: ["appearance", "sizing", "outerInsets", "visibility"],
      at: path
    )
    let ids = try array(node["productReferenceIds"], at: "\(path).productReferenceIds")
    guard !ids.isEmpty else {
      throw invalid("\(path).productReferenceIds", "expected_nonempty_array")
    }
    let fallback = try object(node["unavailableFallback"], at: "\(path).unavailableFallback")
    try keys(
      fallback,
      required: ["selection", "whenNoneAvailable", "message"],
      at: "\(path).unavailableFallback"
    )
    try localizedText(fallback["message"], at: "\(path).unavailableFallback.message")
    try productCardStyles(node["cardStyles"], at: "\(path).cardStyles")
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .widthOnly)
  }

  private static func productCardStyles(_ value: Any?, at path: String) throws {
    let styles = try object(value, at: path)
    try keys(styles, required: ["default", "selected"], at: path)
    let base = try object(styles["default"], at: "\(path).default")
    try keys(
      base,
      required: [
        "background", "border", "cornerRadius", "padding", "contentGap",
        "contentAlignment", "productLabelColor", "runtimePriceColor", "badge",
      ],
      at: "\(path).default"
    )
    try color(base["background"], at: "\(path).default.background")
    try border(base["border"], at: "\(path).default.border", override: false)
    try edgeInsets(base["padding"], at: "\(path).default.padding")
    try color(base["productLabelColor"], at: "\(path).default.productLabelColor")
    try color(base["runtimePriceColor"], at: "\(path).default.runtimePriceColor")
    try badge(base["badge"], at: "\(path).default.badge", selected: false)

    let selected = try object(styles["selected"], at: "\(path).selected")
    try keys(
      selected,
      required: [],
      optional: [
        "background", "border", "cornerRadius", "padding", "contentGap",
        "contentAlignment", "productLabelColor", "runtimePriceColor", "badge",
      ],
      at: "\(path).selected"
    )
    if let value = selected["background"] { try color(value, at: "\(path).selected.background") }
    if let value = selected["border"] {
      try border(value, at: "\(path).selected.border", override: true)
    }
    if let value = selected["padding"] {
      try edgeInsetsOverride(value, at: "\(path).selected.padding")
    }
    if let value = selected["productLabelColor"] {
      try color(value, at: "\(path).selected.productLabelColor")
    }
    if let value = selected["runtimePriceColor"] {
      try color(value, at: "\(path).selected.runtimePriceColor")
    }
    if let value = selected["badge"] {
      try badge(value, at: "\(path).selected.badge", selected: true)
    }
  }

  private static func badge(_ value: Any?, at path: String, selected: Bool) throws {
    let badge = try object(value, at: path)
    let fields: Set<String> = ["background", "textColor", "border", "cornerRadius", "padding"]
    try keys(
      badge,
      required: selected ? [] : fields,
      optional: selected ? fields : [],
      at: path
    )
    if let value = badge["background"] { try color(value, at: "\(path).background") }
    if let value = badge["textColor"] { try color(value, at: "\(path).textColor") }
    if let value = badge["border"] { try border(value, at: "\(path).border", override: selected) }
    if let value = badge["padding"] {
      if selected { try edgeInsetsOverride(value, at: "\(path).padding") }
      else { try edgeInsets(value, at: "\(path).padding") }
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
    try optionalPresentation(node, at: path, appearanceKind: .container, sizingKind: .widthOnly)
  }

  private static func switchControl(_ node: [String: Any], at path: String) throws {
    try keys(
      node,
      required: [
        "type", "id", "label", "initialValue", "typography", "offTrackColor",
        "onTrackColor", "thumbColor", "accessibility",
      ],
      optional: ["appearance", "outerInsets", "visibility"],
      at: path
    )
    try localizedText(node["label"], at: "\(path).label")
    try typography(node["typography"], at: "\(path).typography", allowsTruncation: false)
    try color(node["offTrackColor"], at: "\(path).offTrackColor")
    try color(node["onTrackColor"], at: "\(path).onTrackColor")
    try color(node["thumbColor"], at: "\(path).thumbColor")
    try controlAccessibility(node["accessibility"], at: "\(path).accessibility")
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .none)
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
    try optionalPresentation(node, at: path, appearanceKind: .box, sizingKind: .widthOnly)
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
    var allowed: Set<String> = ["background", "border", "cornerRadius", "opacity"]
    allowed.insert(container ? "clipContent" : "padding")
    guard !value.isEmpty else { throw invalid(path, "expected_nonempty_object") }
    try keys(value, required: [], optional: allowed, at: path)
    if let colorValue = value["background"] { try color(colorValue, at: "\(path).background") }
    if let borderValue = value["border"] { try border(borderValue, at: "\(path).border", override: false) }
    if let padding = value["padding"] { try edgeInsets(padding, at: "\(path).padding") }
  }

  private static func sizing(_ value: Any, at path: String, allowsHeight: Bool) throws {
    let value = try object(value, at: path)
    guard !value.isEmpty else { throw invalid(path, "expected_nonempty_object") }
    try keys(
      value,
      required: [],
      optional: allowsHeight ? ["width", "height"] : ["width"],
      at: path
    )
    if let widthValue = value["width"] { try width(widthValue, at: "\(path).width") }
    if let heightValue = value["height"] { try height(heightValue, at: "\(path).height") }
  }

  private static func width(_ value: Any?, at path: String) throws {
    if let value = value as? String {
      guard value == "content" || value == "fill" else { throw invalid(path, "invalid_width") }
      return
    }
    let value = try object(value, at: path)
    try keys(value, required: ["mode", "value"], at: path)
  }

  private static func height(_ value: Any, at path: String) throws {
    if let value = value as? String {
      guard value == "content" else { throw invalid(path, "invalid_height") }
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
    guard let role = value["role"] as? String else { throw invalid("\(path).role", "expected_string") }
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
    guard let mode = value["mode"] as? String else { throw invalid("\(path).mode", "expected_string") }
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
    guard value is String else { throw invalid(path, "expected_color_string") }
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
    guard actual.isSubset(of: required.union(optional)) else { throw invalid(path, "unknown_property") }
  }

  private static func invalid(_ path: String, _ reason: String) -> MosaicProtocolError {
    .invalidShape(path: path, reason: reason)
  }
}

enum MosaicProtocolV02Semantics {
  static func validate(_ document: MosaicPaywallDocument) throws {
    guard document.schemaVersion == mosaicProtocolVersionV02 else {
      throw MosaicProtocolError.unsupportedSchemaVersion(document.schemaVersion)
    }
    guard (1...Int(Int32.max)).contains(document.revision) else {
      throw violation("protocol_invalid_revision")
    }
    try identifier(document.id)

    var declared = Set<MosaicCapabilityName>()
    for capability in document.compatibility.requiredCapabilities {
      guard capability.version == mosaicProtocolVersionV02 else {
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

    var state = State()
    state.capabilities.formUnion([.scrollContainer, .stack, .localizationCatalogs])
    try state.layoutID(document.layout.id)
    guard document.layout.type == .scrollContainer else {
      throw violation("protocol_invalid_root_layout")
    }
    if document.layout.background != nil {
      state.capabilities.formUnion([.boxStyle, .colors])
      try color(document.layout.background!)
    }

    for asset in document.assets {
      try identifier(asset.id)
      guard state.assetIDs.insert(asset.id).inserted else {
        throw violation("protocol_duplicate_asset_id")
      }
      try assetKey(asset.source.key)
      state.localizedTexts.append(asset.fallback.value)
    }
    if !document.assets.isEmpty {
      state.capabilities.formUnion([.bundledImage, .assetFallback])
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
      state.localizedTexts.append(product.label)
      state.append(product.badge)
    }
    if !document.products.isEmpty { state.capabilities.insert(.productReferences) }

    guard document.layout.content.direction == .vertical else {
      throw violation("protocol_root_stack_must_be_vertical")
    }
    guard !document.layout.content.children.isEmpty else {
      throw violation("protocol_empty_root_stack")
    }
    try state.stack(document.layout.content, carouselDepth: 0)

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
      guard state.switchIDs.contains(reference.switchID) else {
        throw violation("protocol_unknown_visibility_switch")
      }
      guard reference.nodeID != reference.switchID else {
        throw violation("protocol_self_visibility_switch")
      }
    }

    try validateLocalization(document.localization, texts: state.localizedTexts)
    if document.localization.locales.values.contains(where: { $0.direction == .rightToLeft }) {
      state.capabilities.insert(.localizationRTL)
    }

    guard state.capabilities.isSubset(of: declared) else {
      let missing = state.capabilities.subtracting(declared).first!
      throw violation("protocol_missing_capability_\(missing.rawValue)")
    }
  }

  private struct VisibilityReference {
    let nodeID: String
    let switchID: String
  }

  private struct State {
    var capabilities = Set<MosaicCapabilityName>()
    var layoutIDs = Set<String>()
    var assetIDs = Set<String>()
    var usedAssetIDs = Set<String>()
    var productReferenceIDs = Set<String>()
    var providerProductIDs = Set<String>()
    var usedProductReferenceIDs = Set<String>()
    var selectorIDs = Set<String>()
    var purchaseSelectorIDs = Set<String>()
    var switchIDs = Set<String>()
    var visibilityReferences: [VisibilityReference] = []
    var localizedTexts: [MosaicLocalizedText] = []

    mutating func layoutID(_ id: String) throws {
      try identifier(id)
      guard layoutIDs.insert(id).inserted else { throw violation("protocol_duplicate_layout_id") }
    }

    mutating func stack(_ stack: MosaicStack, carouselDepth: Int) throws {
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
      for node in stack.children { try validate(node, carouselDepth: carouselDepth) }
    }

    mutating func validate(_ node: MosaicNode, carouselDepth: Int) throws {
      switch node {
      case .verticalStack:
        throw violation("protocol_0_1_node_in_0_2_document")
      case .stack(let component):
        try stack(component, carouselDepth: carouselDepth)
      case .text(let component):
        try layoutID(component.id)
        capabilities.formUnion([.text, .typography, .colors, .accessibilityMetadata])
        localizedTexts.append(component.value)
        try textAccessibility(component.accessibility)
        append(component.accessibility.label)
        try typography(component.typography, allowsTruncation: true)
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .image(let component):
        try layoutID(component.id)
        capabilities.formUnion([.image, .sizing, .accessibilityMetadata])
        try identifier(component.assetId)
        guard (component.aspectRatio == nil) != (component.height == nil) else {
          throw violation("protocol_invalid_image_height_mode")
        }
        if let aspectRatio = component.aspectRatio {
          try finite(aspectRatio, minimum: .leastNonzeroMagnitude, maximum: 10,
            code: "protocol_invalid_image_aspect_ratio")
        }
        if let height = component.height { try positiveSize(height) }
        try width(component.width)
        usedAssetIDs.insert(component.assetId)
        if case .informative(let label) = component.accessibility { localizedTexts.append(label) }
        try presentation(id: component.id, appearance: component.appearance, sizing: nil,
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
          localizedTexts.append(item.text)
        }
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .productSelector(let component):
        try layoutID(component.id)
        capabilities.formUnion([
          .productSelector, .productFallback, .normalizedOutcome, .productCardStates,
          .colors, .boxStyle, .accessibilityMetadata,
        ])
        try logicalSize(component.gap)
        guard !component.productReferenceIds.isEmpty else {
          throw violation("protocol_empty_product_selector")
        }
        var references = Set<String>()
        for referenceID in component.productReferenceIds {
          try identifier(referenceID)
          guard references.insert(referenceID).inserted else {
            throw violation("protocol_duplicate_selector_product")
          }
          guard productReferenceIDs.contains(referenceID) else {
            throw violation("protocol_unknown_selector_product")
          }
          usedProductReferenceIDs.insert(referenceID)
        }
        guard references.contains(component.initiallySelectedProductReferenceId) else {
          throw violation("protocol_invalid_initial_selection")
        }
        try productCards(component.cardStyles)
        selectorIDs.insert(component.id)
        localizedTexts.append(component.unavailableFallback.message)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .purchaseButton(let component):
        try layoutID(component.id)
        capabilities.formUnion([
          .purchaseButton, .purchaseAction, .normalizedOutcome, .typography, .colors,
          .accessibilityMetadata,
        ])
        localizedTexts.append(component.label)
        localizedTexts.append(component.inProgressLabel)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try typography(component.typography, allowsTruncation: false)
        guard case .purchase(let selectorID) = component.action else {
          throw violation("protocol_invalid_purchase_action")
        }
        try identifier(selectorID)
        purchaseSelectorIDs.insert(selectorID)
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .restoreButton(let component):
        try layoutID(component.id)
        capabilities.formUnion([
          .restoreButton, .restoreAction, .normalizedOutcome, .typography, .colors,
          .accessibilityMetadata,
        ])
        localizedTexts.append(component.label)
        localizedTexts.append(component.inProgressLabel)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try typography(component.typography, allowsTruncation: false)
        guard component.action == .restore else { throw violation("protocol_invalid_restore_action") }
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .closeButton(let component):
        try layoutID(component.id)
        capabilities.formUnion([
          .closeButton, .closeAction, .normalizedOutcome, .typography, .colors,
          .accessibilityMetadata,
        ])
        localizedTexts.append(component.label)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try typography(component.typography, allowsTruncation: false)
        guard component.action == .close else { throw violation("protocol_invalid_close_action") }
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .legalText(let component):
        try layoutID(component.id)
        capabilities.formUnion([.legalText, .typography, .colors, .accessibilityMetadata])
        localizedTexts.append(component.value)
        try textAccessibility(component.accessibility)
        append(component.accessibility.label)
        guard component.accessibility.headingLevel == nil else {
          throw violation("protocol_legal_text_must_use_text_role")
        }
        try typography(component.typography, allowsTruncation: false)
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
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
          localizedTexts.append(page.accessibilityLabel)
          try stack(page.content, carouselDepth: carouselDepth + 1)
        }
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try presentation(id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .switchControl(let component):
        try layoutID(component.id)
        switchIDs.insert(component.id)
        capabilities.formUnion([.switchControl, .typography, .colors, .accessibilityMetadata])
        localizedTexts.append(component.label)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        try typography(component.typography, allowsTruncation: false)
        try color(component.offTrackColor)
        try color(component.onTrackColor)
        try color(component.thumbColor)
        try presentation(id: component.id, appearance: component.appearance, sizing: nil,
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
        localizedTexts.append(component.completedText)
        try textAccessibility(component.accessibility)
        append(component.accessibility.label)
        try typography(component.typography, allowsTruncation: false)
        try presentation(id: component.id, appearance: component.appearance,
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
        if let background = appearance.background { try color(background) }
        if let border = appearance.border { try borderValue(border) }
        if let radius = appearance.cornerRadius { try logicalSize(radius) }
        if let opacity = appearance.opacity {
          try finite(opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
        }
        if let padding = appearance.padding { try insets(padding) }
        if appearance.clipContent != nil { capabilities.insert(.clipping) }
      }
      if let sizing {
        capabilities.insert(.sizing)
        if let widthValue = sizing.width { try width(widthValue) }
        if let height = sizing.height {
          switch height {
          case .content: break
          case .fixed(let value): try positiveSize(value)
          }
        }
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
        visibilityReferences.append(VisibilityReference(nodeID: id, switchID: switchID))
      }
    }

    mutating func append(_ text: MosaicLocalizedText?) {
      if let text { localizedTexts.append(text) }
    }
  }

  private static func productCards(_ styles: MosaicProductCardStyles) throws {
    try color(styles.defaultStyle.background)
    try borderValue(styles.defaultStyle.border)
    try logicalSize(styles.defaultStyle.cornerRadius)
    try insets(styles.defaultStyle.padding)
    try logicalSize(styles.defaultStyle.contentGap)
    try color(styles.defaultStyle.productLabelColor)
    try color(styles.defaultStyle.runtimePriceColor)
    try color(styles.defaultStyle.badge.background)
    try color(styles.defaultStyle.badge.textColor)
    try borderValue(styles.defaultStyle.badge.border)
    try logicalSize(styles.defaultStyle.badge.cornerRadius)
    try insets(styles.defaultStyle.badge.padding)
    let selected = styles.selected.resolving(styles.defaultStyle)
    try color(selected.background)
    try borderValue(selected.border)
    try color(selected.productLabelColor)
    try color(selected.runtimePriceColor)
    try color(selected.badge.background)
    try color(selected.badge.textColor)
    try borderValue(selected.badge.border)
  }

  private static func typography(
    _ value: MosaicTypography, allowsTruncation: Bool
  ) throws {
    try finite(value.fontSize, minimum: 8, maximum: 96, code: "protocol_invalid_font_size")
    try finite(value.lineHeightMultiplier, minimum: 0.8, maximum: 3,
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

  private static func canonicalDate(_ value: String) -> Date? {
    guard value.range(
      of: "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
      options: .regularExpression
    ) != nil else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: value) else { return nil }
    return formatter.string(from: date) == value ? date : nil
  }

  private static func color(_ value: MosaicColor) throws {
    if case .literal(let raw) = value,
      raw.range(of: "^#[0-9A-F]{8}$", options: .regularExpression) == nil
    { throw violation("protocol_invalid_color") }
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
    try finite(value, minimum: .leastNonzeroMagnitude, maximum: 4096,
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
