import Foundation

public enum MosaicProtocolError: Error, Sendable, Equatable {
  case invalidJSON
  case invalidShape(path: String, reason: String)
  case unsupportedSchemaVersion(String)
  case unsupportedCapability(name: String, version: String)
  case duplicateCapability(name: String)
  case semanticViolation(code: String)

  public var diagnosticCode: String {
    switch self {
    case .invalidJSON: "protocol_invalid_json"
    case .invalidShape: "protocol_invalid_shape"
    case .unsupportedSchemaVersion: "protocol_unsupported_schema"
    case .unsupportedCapability: "protocol_unsupported_capability"
    case .duplicateCapability: "protocol_duplicate_capability"
    case .semanticViolation(let code): code
    }
  }
}

/// A closed, atomic reader for every supported Mosaic protocol version.
///
/// This code validates the native model boundary; it is not a platform-owned
/// copy of the canonical JSON Schema. The repository schema remains the source
/// of truth and the conformance tests decode its sole canonical fixture.
public enum MosaicProtocolDecoder {
  public static func decode(_ data: Data) throws -> MosaicPaywallDocument {
    let raw: Any
    do {
      raw = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw MosaicProtocolError.invalidJSON
    }

    let root = try MosaicProtocolShape.object(raw, at: "$")
    guard let schemaVersion = root["schemaVersion"] as? String else {
      throw MosaicProtocolError.invalidShape(
        path: "$.schemaVersion",
        reason: "expected_string"
      )
    }
    guard mosaicSupportedProtocolVersions.contains(schemaVersion) else {
      throw MosaicProtocolError.unsupportedSchemaVersion(schemaVersion)
    }

    switch schemaVersion {
    case mosaicProtocolVersion:
      try MosaicProtocolShape.validate(root)
    case mosaicProtocolVersionV02:
      try MosaicProtocolV02Shape.validate(root)
    default:
      throw MosaicProtocolError.unsupportedSchemaVersion(schemaVersion)
    }

    let document: MosaicPaywallDocument
    do {
      document = try JSONDecoder().decode(MosaicPaywallDocument.self, from: data)
    } catch let error as DecodingError {
      throw MosaicProtocolError.invalidShape(
        path: decodingPath(for: error),
        reason: decodingReason(for: error)
      )
    } catch {
      throw MosaicProtocolError.invalidShape(path: "$", reason: "type_or_enum_mismatch")
    }

    switch schemaVersion {
    case mosaicProtocolVersion:
      try MosaicProtocolSemantics.validate(document)
    case mosaicProtocolVersionV02:
      try MosaicProtocolV02Semantics.validate(document)
    default:
      throw MosaicProtocolError.unsupportedSchemaVersion(schemaVersion)
    }
    return document
  }

  public static func decode(_ source: String) throws -> MosaicPaywallDocument {
    guard let data = source.data(using: .utf8) else {
      throw MosaicProtocolError.invalidJSON
    }
    return try decode(data)
  }
}

private func decodingPath(for error: DecodingError) -> String {
  let codingPath: [any CodingKey]
  switch error {
  case .dataCorrupted(let context), .keyNotFound(_, let context),
    .typeMismatch(_, let context), .valueNotFound(_, let context):
    codingPath = context.codingPath
  @unknown default:
    return "$"
  }
  return codingPath.reduce("$") { path, key in
    if let index = key.intValue { return "\(path)[\(index)]" }
    return "\(path).\(key.stringValue)"
  }
}

private func decodingReason(for error: DecodingError) -> String {
  switch error {
  case .dataCorrupted: "data_corrupted"
  case .keyNotFound(let key, _): "missing_\(key.stringValue)"
  case .typeMismatch: "type_mismatch"
  case .valueNotFound: "missing_value"
  @unknown default: "type_or_enum_mismatch"
  }
}

private enum MosaicProtocolShape {
  static func validate(_ root: [String: Any]) throws {
    try exactKeys(
      root,
      expected: [
        "schemaVersion", "id", "revision", "compatibility", "localization", "assets",
        "products", "layout",
      ],
      at: "$"
    )

    let compatibility = try object(root["compatibility"], at: "$.compatibility")
    try exactKeys(compatibility, expected: ["requiredCapabilities"], at: "$.compatibility")
    let capabilities = try nonEmptyArray(
      compatibility["requiredCapabilities"],
      at: "$.compatibility.requiredCapabilities"
    )
    for (index, value) in capabilities.enumerated() {
      let path = "$.compatibility.requiredCapabilities[\(index)]"
      try exactKeys(
        try object(value, at: path),
        expected: ["name", "version"],
        at: path
      )
    }

    let localization = try object(root["localization"], at: "$.localization")
    try exactKeys(
      localization,
      expected: ["defaultLocale", "fallbackLocale", "locales"],
      at: "$.localization"
    )
    let locales = try object(localization["locales"], at: "$.localization.locales")
    guard !locales.isEmpty else {
      throw invalid("$.localization.locales", "expected_nonempty_object")
    }
    for (locale, value) in locales {
      let path = "$.localization.locales.\(locale)"
      let catalog = try object(value, at: path)
      try exactKeys(catalog, expected: ["direction", "strings"], at: path)
      let strings = try object(catalog["strings"], at: "\(path).strings")
      guard !strings.isEmpty else {
        throw invalid("\(path).strings", "expected_nonempty_object")
      }
    }

    let assets = try array(root["assets"], at: "$.assets")
    for (index, value) in assets.enumerated() {
      let path = "$.assets[\(index)]"
      let asset = try object(value, at: path)
      try exactKeys(asset, expected: ["type", "id", "source", "fallback"], at: path)
      let sourcePath = "\(path).source"
      try exactKeys(
        try object(asset["source"], at: sourcePath),
        expected: ["type", "key"],
        at: sourcePath
      )
      let fallbackPath = "\(path).fallback"
      let fallback = try object(asset["fallback"], at: fallbackPath)
      try exactKeys(fallback, expected: ["type", "value"], at: fallbackPath)
      try localizedText(fallback["value"], at: "\(fallbackPath).value")
    }

    let products = try array(root["products"], at: "$.products")
    for (index, value) in products.enumerated() {
      let path = "$.products[\(index)]"
      let product = try object(value, at: path)
      var expected: Set<String> = ["id", "productId", "label"]
      if product["badge"] != nil {
        expected.insert("badge")
      }
      try exactKeys(product, expected: expected, at: path)
      try localizedText(product["label"], at: "\(path).label")
      if product["badge"] != nil {
        try localizedText(product["badge"], at: "\(path).badge")
      }
    }

    try scrollContainer(root["layout"], at: "$.layout")
  }

  private static func scrollContainer(_ value: Any?, at path: String) throws {
    let container = try object(value, at: path)
    try exactKeys(
      container,
      expected: ["type", "id", "axis", "safeArea", "showsIndicators", "content"],
      at: path
    )
    guard try string(container["type"], at: "\(path).type") == "scrollContainer" else {
      throw invalid("\(path).type", "expected_scroll_container")
    }
    try verticalStack(container["content"], at: "\(path).content")
  }

  private static func verticalStack(_ value: Any?, at path: String) throws {
    let stack = try object(value, at: path)
    try exactKeys(
      stack,
      expected: ["type", "id", "spacing", "padding", "horizontalAlignment", "children"],
      at: path
    )
    guard try string(stack["type"], at: "\(path).type") == "verticalStack" else {
      throw invalid("\(path).type", "expected_vertical_stack")
    }
    let paddingPath = "\(path).padding"
    try exactKeys(
      try object(stack["padding"], at: paddingPath),
      expected: ["top", "start", "bottom", "end"],
      at: paddingPath
    )
    let children = try nonEmptyArray(stack["children"], at: "\(path).children")
    for (index, child) in children.enumerated() {
      try node(child, at: "\(path).children[\(index)]")
    }
  }

  private static func node(_ value: Any, at path: String) throws {
    let component = try object(value, at: path)
    let type = try string(component["type"], at: "\(path).type")
    switch type {
    case "verticalStack":
      try verticalStack(value, at: path)
    case "text":
      try exactKeys(
        component,
        expected: ["type", "id", "value", "style", "alignment", "accessibility"],
        at: path
      )
      try localizedText(component["value"], at: "\(path).value")
      try textAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "image":
      try exactKeys(
        component,
        expected: [
          "type", "id", "assetId", "width", "aspectRatio", "contentMode", "accessibility",
        ],
        at: path
      )
      try imageAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "featureList":
      try exactKeys(
        component,
        expected: ["type", "id", "marker", "itemSpacing", "items", "accessibility"],
        at: path
      )
      let items = try nonEmptyArray(component["items"], at: "\(path).items")
      for (index, value) in items.enumerated() {
        let itemPath = "\(path).items[\(index)]"
        let item = try object(value, at: itemPath)
        try exactKeys(item, expected: ["id", "text"], at: itemPath)
        try localizedText(item["text"], at: "\(itemPath).text")
      }
      try controlAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "productSelector":
      try exactKeys(
        component,
        expected: [
          "type", "id", "productReferenceIds", "initiallySelectedProductReferenceId",
          "itemSpacing", "unavailableFallback", "accessibility",
        ],
        at: path
      )
      _ = try nonEmptyArray(
        component["productReferenceIds"],
        at: "\(path).productReferenceIds"
      )
      let fallbackPath = "\(path).unavailableFallback"
      let fallback = try object(component["unavailableFallback"], at: fallbackPath)
      try exactKeys(
        fallback,
        expected: ["selection", "whenNoneAvailable", "message"],
        at: fallbackPath
      )
      try localizedText(fallback["message"], at: "\(fallbackPath).message")
      try controlAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "purchaseButton":
      try exactKeys(
        component,
        expected: ["type", "id", "label", "inProgressLabel", "action", "accessibility"],
        at: path
      )
      try localizedText(component["label"], at: "\(path).label")
      try localizedText(component["inProgressLabel"], at: "\(path).inProgressLabel")
      try action(component["action"], expectedType: "purchase", at: "\(path).action")
      try controlAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "restoreButton":
      try exactKeys(
        component,
        expected: ["type", "id", "label", "inProgressLabel", "action", "accessibility"],
        at: path
      )
      try localizedText(component["label"], at: "\(path).label")
      try localizedText(component["inProgressLabel"], at: "\(path).inProgressLabel")
      try action(component["action"], expectedType: "restore", at: "\(path).action")
      try controlAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "closeButton":
      try exactKeys(
        component,
        expected: ["type", "id", "label", "action", "accessibility"],
        at: path
      )
      try localizedText(component["label"], at: "\(path).label")
      try action(component["action"], expectedType: "close", at: "\(path).action")
      try controlAccessibility(component["accessibility"], at: "\(path).accessibility")
    case "legalText":
      try exactKeys(
        component,
        expected: ["type", "id", "value", "alignment", "accessibility"],
        at: path
      )
      try localizedText(component["value"], at: "\(path).value")
      try textAccessibility(component["accessibility"], at: "\(path).accessibility")
    default:
      throw invalid("\(path).type", "unsupported_component")
    }
  }

  private static func localizedText(_ value: Any?, at path: String) throws {
    try exactKeys(
      try object(value, at: path),
      expected: ["default", "localizationKey"],
      at: path
    )
  }

  private static func controlAccessibility(_ value: Any?, at path: String) throws {
    let accessibility = try object(value, at: path)
    var expected: Set<String> = ["label"]
    if accessibility["hint"] != nil {
      expected.insert("hint")
    }
    try exactKeys(accessibility, expected: expected, at: path)
    try localizedText(accessibility["label"], at: "\(path).label")
    if accessibility["hint"] != nil {
      try localizedText(accessibility["hint"], at: "\(path).hint")
    }
  }

  private static func textAccessibility(_ value: Any?, at path: String) throws {
    let accessibility = try object(value, at: path)
    switch try string(accessibility["role"], at: "\(path).role") {
    case "text":
      try exactKeys(accessibility, expected: ["role"], at: path)
    case "heading":
      try exactKeys(accessibility, expected: ["role", "level"], at: path)
    default:
      throw invalid("\(path).role", "unsupported_accessibility_role")
    }
  }

  private static func imageAccessibility(_ value: Any?, at path: String) throws {
    let accessibility = try object(value, at: path)
    guard let hidden = accessibility["hidden"] as? Bool else {
      throw invalid("\(path).hidden", "expected_boolean")
    }
    if hidden {
      try exactKeys(accessibility, expected: ["hidden"], at: path)
    } else {
      try exactKeys(accessibility, expected: ["hidden", "label"], at: path)
      try localizedText(accessibility["label"], at: "\(path).label")
    }
  }

  private static func action(_ value: Any?, expectedType: String, at path: String) throws {
    let action = try object(value, at: path)
    let type = try string(action["type"], at: "\(path).type")
    guard type == expectedType else {
      throw invalid("\(path).type", "unexpected_action")
    }
    try exactKeys(
      action,
      expected: type == "purchase" ? ["type", "productSelectorId"] : ["type"],
      at: path
    )
  }

  static func object(_ value: Any?, at path: String) throws -> [String: Any] {
    guard let object = value as? [String: Any] else {
      throw invalid(path, "expected_object")
    }
    return object
  }

  private static func array(_ value: Any?, at path: String) throws -> [Any] {
    guard let array = value as? [Any] else {
      throw invalid(path, "expected_array")
    }
    return array
  }

  private static func nonEmptyArray(_ value: Any?, at path: String) throws -> [Any] {
    let values = try array(value, at: path)
    guard !values.isEmpty else {
      throw invalid(path, "expected_nonempty_array")
    }
    return values
  }

  private static func string(_ value: Any?, at path: String) throws -> String {
    guard let string = value as? String else {
      throw invalid(path, "expected_string")
    }
    return string
  }

  private static func exactKeys(
    _ object: [String: Any],
    expected: Set<String>,
    at path: String
  ) throws {
    let actual = Set(object.keys)
    guard actual == expected else {
      throw invalid(
        path, actual.subtracting(expected).isEmpty ? "missing_property" : "unknown_property")
    }
  }

  private static func invalid(_ path: String, _ reason: String) -> MosaicProtocolError {
    .invalidShape(path: path, reason: reason)
  }
}

private enum MosaicProtocolSemantics {
  static func validate(_ document: MosaicPaywallDocument) throws {
    guard document.schemaVersion == mosaicProtocolVersion else {
      throw MosaicProtocolError.unsupportedSchemaVersion(document.schemaVersion)
    }
    guard (1...Int(Int32.max)).contains(document.revision) else {
      throw violation("protocol_invalid_revision")
    }
    try identifier(document.id)

    var declaredCapabilities = Set<MosaicCapabilityName>()
    for capability in document.compatibility.requiredCapabilities {
      guard capability.version == mosaicProtocolVersion else {
        throw MosaicProtocolError.unsupportedCapability(
          name: capability.name.rawValue,
          version: capability.version
        )
      }
      guard declaredCapabilities.insert(capability.name).inserted else {
        throw MosaicProtocolError.duplicateCapability(name: capability.name.rawValue)
      }
    }

    var state = ValidationState()
    state.capabilities.formUnion([
      .scrollContainer, .localizationCatalogs, .accessibilityMetadata, .normalizedOutcome,
    ])
    try state.layoutID(document.layout.id)
    guard document.layout.type == .scrollContainer else {
      throw violation("protocol_invalid_root_layout")
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
      if let badge = product.badge {
        state.localizedTexts.append(badge)
      }
    }
    if !document.products.isEmpty {
      state.capabilities.insert(.productReferences)
    }

    try state.stack(document.layout.content)

    guard state.usedAssetIDs == state.assetIDs else {
      throw violation("protocol_asset_reference_mismatch")
    }
    guard state.usedProductReferenceIDs == state.productReferenceIDs else {
      throw violation("protocol_product_reference_mismatch")
    }
    guard state.selectorIDs == state.purchaseSelectorIDs else {
      throw violation("protocol_purchase_action_mismatch")
    }

    try validateLocalization(document.localization, texts: state.localizedTexts)
    if document.localization.locales.values.contains(where: { $0.direction == .rightToLeft }) {
      state.capabilities.insert(.localizationRTL)
    }

    guard state.capabilities == declaredCapabilities else {
      throw violation("protocol_capability_content_mismatch")
    }
  }

  private struct ValidationState {
    var capabilities = Set<MosaicCapabilityName>()
    var layoutIDs = Set<String>()
    var assetIDs = Set<String>()
    var usedAssetIDs = Set<String>()
    var productReferenceIDs = Set<String>()
    var providerProductIDs = Set<String>()
    var usedProductReferenceIDs = Set<String>()
    var selectorIDs = Set<String>()
    var purchaseSelectorIDs = Set<String>()
    var localizedTexts: [MosaicLocalizedText] = []

    mutating func layoutID(_ id: String) throws {
      try identifier(id)
      guard layoutIDs.insert(id).inserted else {
        throw violation("protocol_duplicate_layout_id")
      }
    }

    mutating func stack(_ stack: MosaicVerticalStack) throws {
      guard stack.type == .verticalStack else {
        throw violation("protocol_invalid_stack_type")
      }
      try layoutID(stack.id)
      try logicalSize(stack.spacing)
      try logicalSize(stack.padding.top)
      try logicalSize(stack.padding.start)
      try logicalSize(stack.padding.bottom)
      try logicalSize(stack.padding.end)
      guard !stack.children.isEmpty else {
        throw violation("protocol_empty_stack")
      }
      capabilities.insert(.verticalStack)
      for node in stack.children {
        try validate(node)
      }
    }

    mutating func validate(_ node: MosaicNode) throws {
      switch node {
      case .verticalStack(let stack):
        try self.stack(stack)
      case .text(let component):
        try layoutID(component.id)
        capabilities.insert(.text)
        localizedTexts.append(component.value)
        try textAccessibility(component.accessibility)
      case .image(let component):
        try layoutID(component.id)
        capabilities.insert(.image)
        try identifier(component.assetId)
        guard let aspectRatio = component.aspectRatio,
          aspectRatio.isFinite,
          aspectRatio > 0,
          aspectRatio <= 10
        else {
          throw violation("protocol_invalid_image_aspect_ratio")
        }
        usedAssetIDs.insert(component.assetId)
        if case .informative(let label) = component.accessibility {
          localizedTexts.append(label)
        }
      case .featureList(let component):
        try layoutID(component.id)
        capabilities.insert(.featureList)
        try logicalSize(component.itemSpacing)
        guard !component.items.isEmpty else {
          throw violation("protocol_empty_feature_list")
        }
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
      case .productSelector(let component):
        try layoutID(component.id)
        capabilities.formUnion([.productSelector, .productFallback])
        try logicalSize(component.itemSpacing)
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
        selectorIDs.insert(component.id)
        localizedTexts.append(component.unavailableFallback.message)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
      case .purchaseButton(let component):
        try layoutID(component.id)
        capabilities.formUnion([.purchaseButton, .purchaseAction])
        localizedTexts.append(component.label)
        localizedTexts.append(component.inProgressLabel)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        guard case .purchase(let selectorID) = component.action else {
          throw violation("protocol_invalid_purchase_action")
        }
        try identifier(selectorID)
        purchaseSelectorIDs.insert(selectorID)
      case .restoreButton(let component):
        try layoutID(component.id)
        capabilities.formUnion([.restoreButton, .restoreAction])
        localizedTexts.append(component.label)
        localizedTexts.append(component.inProgressLabel)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        guard component.action == .restore else {
          throw violation("protocol_invalid_restore_action")
        }
      case .closeButton(let component):
        try layoutID(component.id)
        capabilities.formUnion([.closeButton, .closeAction])
        localizedTexts.append(component.label)
        localizedTexts.append(component.accessibility.label)
        append(component.accessibility.hint)
        guard component.action == .close else {
          throw violation("protocol_invalid_close_action")
        }
      case .legalText(let component):
        try layoutID(component.id)
        capabilities.insert(.legalText)
        localizedTexts.append(component.value)
        try textAccessibility(component.accessibility)
      case .stack, .carousel, .switchControl, .countdown:
        throw violation("protocol_0_2_node_in_0_1_document")
      }
    }

    private mutating func append(_ text: MosaicLocalizedText?) {
      if let text {
        localizedTexts.append(text)
      }
    }
  }

  private static func validateLocalization(
    _ localization: MosaicLocalization,
    texts: [MosaicLocalizedText]
  ) throws {
    try localeTag(localization.defaultLocale)
    try localeTag(localization.fallbackLocale)
    guard !localization.locales.isEmpty,
      localization.locales[localization.defaultLocale] != nil,
      localization.locales[localization.fallbackLocale] != nil
    else {
      throw violation("protocol_missing_required_locale")
    }

    for (locale, catalog) in localization.locales {
      try localeTag(locale)
      guard !catalog.strings.isEmpty else {
        throw violation("protocol_empty_locale_catalog")
      }
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

  private static func textAccessibility(_ value: MosaicTextAccessibility) throws {
    if let level = value.headingLevel, !(1...6).contains(level) {
      throw violation("protocol_invalid_heading_level")
    }
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
    guard matches(value, localeTagPattern) else {
      throw violation("protocol_invalid_locale_tag")
    }
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

  private static func logicalSize(_ value: Double) throws {
    guard value.isFinite, value >= 0, value <= 4096 else {
      throw violation("protocol_invalid_logical_size")
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
  private static let localizationKeyPattern =
    "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$"
  private static let localeTagPattern = "^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$"
  private static let productIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
  private static let assetKeyPattern = "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
}
