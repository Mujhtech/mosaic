import Foundation

public enum MosaicProtocolError: Error, Sendable, Equatable {
  case invalidJSON(String)
  case invalidShape(String)
  case unsupportedSchemaVersion(String)
  case unsupportedCapability(name: String, version: String)
  case duplicateCapability(name: String, version: String)
  case decodingFailed(String)
}

/// Strict reader for the repository's protocol 0.1 document shape.
public enum MosaicProtocolDecoder {
  public static func decode(_ data: Data) throws -> MosaicPaywallDocument {
    do {
      let raw = try JSONSerialization.jsonObject(with: data)
      try MosaicProtocolShape.validate(raw)
      let document = try JSONDecoder().decode(MosaicPaywallDocument.self, from: data)
      guard document.schemaVersion == mosaicProtocolVersion else {
        throw MosaicProtocolError.unsupportedSchemaVersion(document.schemaVersion)
      }

      var seen = Set<String>()
      for capability in document.compatibility.requiredCapabilities {
        guard capability.version == mosaicProtocolVersion else {
          throw MosaicProtocolError.unsupportedCapability(
            name: capability.name.rawValue,
            version: capability.version
          )
        }
        let key = "\(capability.name.rawValue)@\(capability.version)"
        guard seen.insert(key).inserted else {
          throw MosaicProtocolError.duplicateCapability(
            name: capability.name.rawValue,
            version: capability.version
          )
        }
      }
      try validateSemantics(document)
      return document
    } catch let error as MosaicProtocolError {
      throw error
    } catch let error as DecodingError {
      throw MosaicProtocolError.decodingFailed(String(describing: error))
    } catch {
      throw MosaicProtocolError.invalidJSON(String(describing: error))
    }
  }

  public static func decode(_ source: String) throws -> MosaicPaywallDocument {
    guard let data = source.data(using: .utf8) else {
      throw MosaicProtocolError.invalidJSON("Input is not valid UTF-8.")
    }
    return try decode(data)
  }

  private static func validateSemantics(_ document: MosaicPaywallDocument) throws {
    guard (1...Int(Int32.max)).contains(document.revision) else {
      throw MosaicProtocolError.invalidShape(
        "revision must be an integer from 1 through \(Int32.max)."
      )
    }
    try validateIdentifier(document.id, at: "$.id")
    try validateIdentifier(document.layout.id, at: "$.layout.id")
    guard document.layout.gap.isFinite, document.layout.gap >= 0 else {
      throw MosaicProtocolError.invalidShape("gap must be nonnegative at $.layout.gap.")
    }
    guard document.layout.padding.isFinite, document.layout.padding >= 0 else {
      throw MosaicProtocolError.invalidShape("padding must be nonnegative at $.layout.padding.")
    }

    var expectedCapabilities: Set<MosaicCapabilityName> = [.verticalLayout]
    for (index, component) in document.layout.children.enumerated() {
      expectedCapabilities.insert(capability(for: component.kind))
      try validate(component, at: "$.layout.children[\(index)]")
    }
    let declaredCapabilities = Set(
      document.compatibility.requiredCapabilities.map(\.name)
    )
    guard declaredCapabilities == expectedCapabilities else {
      throw MosaicProtocolError.invalidShape(
        "Capability declarations do not match document content."
      )
    }
  }

  private static func capability(for kind: MosaicComponentKind) -> MosaicCapabilityName {
    switch kind {
    case .text: .text
    case .featureList: .featureList
    case .productSelector: .productSelector
    case .purchaseButton: .purchaseButton
    case .restoreButton: .restoreButton
    case .closeButton: .closeButton
    case .legalText: .legalText
    }
  }

  private static func validate(_ component: MosaicComponent, at path: String) throws {
    switch component {
    case .text(let text):
      try validateIdentifier(text.id, at: "\(path).id")
      try validate(text.value, at: "\(path).value")
    case .featureList(let featureList):
      try validateIdentifier(featureList.id, at: "\(path).id")
      for (index, item) in featureList.items.enumerated() {
        try validateIdentifier(item.id, at: "\(path).items[\(index)].id")
        try validate(item.text, at: "\(path).items[\(index)].text")
      }
    case .productSelector(let selector):
      try validateIdentifier(selector.id, at: "\(path).id")
      let productIDs = selector.products.map(\.productId)
      for (index, productID) in productIDs.enumerated() {
        try validateProductID(productID, at: "\(path).products[\(index)].productId")
      }
      try validateProductID(
        selector.initiallySelectedProductId,
        at: "\(path).initiallySelectedProductId"
      )
      guard Set(productIDs).count == productIDs.count else {
        throw MosaicProtocolError.invalidShape(
          "Product selector \(selector.id) contains duplicate product IDs."
        )
      }
      guard productIDs.contains(selector.initiallySelectedProductId) else {
        throw MosaicProtocolError.invalidShape(
          "Product selector \(selector.id) initially selects an undeclared product."
        )
      }
    case .purchaseButton(let button):
      try validateIdentifier(button.id, at: "\(path).id")
      try validate(button.label, at: "\(path).label")
    case .restoreButton(let button):
      try validateIdentifier(button.id, at: "\(path).id")
      try validate(button.label, at: "\(path).label")
    case .closeButton(let button):
      try validateIdentifier(button.id, at: "\(path).id")
      try validate(button.label, at: "\(path).label")
    case .legalText(let legalText):
      try validateIdentifier(legalText.id, at: "\(path).id")
      try validate(legalText.value, at: "\(path).value")
    }
  }

  private static func validate(_ text: MosaicLocalizedText, at path: String) throws {
    guard !text.defaultValue.isEmpty else {
      throw MosaicProtocolError.invalidShape("Expected nonempty text at \(path).default.")
    }
    guard matches(text.localizationKey, pattern: localizationKeyPattern) else {
      throw MosaicProtocolError.invalidShape(
        "Invalid localization key at \(path).localizationKey."
      )
    }
  }

  private static func validateIdentifier(_ value: String, at path: String) throws {
    guard matches(value, pattern: identifierPattern) else {
      throw MosaicProtocolError.invalidShape("Invalid identifier at \(path).")
    }
  }

  private static func validateProductID(_ value: String, at path: String) throws {
    guard matches(value, pattern: productIDPattern) else {
      throw MosaicProtocolError.invalidShape("Invalid product ID at \(path).")
    }
  }

  private static func matches(_ value: String, pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }

  private static let identifierPattern = "^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$"
  private static let localizationKeyPattern =
    "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$"
  private static let productIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
}

private enum MosaicProtocolShape {
  static func validate(_ value: Any) throws {
    let root = try object(value, at: "$")
    try exactKeys(
      root,
      expected: ["schemaVersion", "id", "revision", "compatibility", "layout"],
      at: "$"
    )

    let compatibility = try object(root["compatibility"], at: "$.compatibility")
    try exactKeys(
      compatibility,
      expected: ["requiredCapabilities"],
      at: "$.compatibility"
    )
    let capabilities = try nonEmptyArray(
      compatibility["requiredCapabilities"],
      at: "$.compatibility.requiredCapabilities"
    )
    for (index, capabilityValue) in capabilities.enumerated() {
      let path = "$.compatibility.requiredCapabilities[\(index)]"
      let capability = try object(capabilityValue, at: path)
      try exactKeys(capability, expected: ["name", "version"], at: path)
    }

    let layout = try object(root["layout"], at: "$.layout")
    try exactKeys(
      layout,
      expected: ["type", "id", "gap", "padding", "children"],
      at: "$.layout"
    )
    let children = try nonEmptyArray(layout["children"], at: "$.layout.children")
    for (index, childValue) in children.enumerated() {
      try validateComponent(childValue, at: "$.layout.children[\(index)]")
    }
  }

  private static func validateComponent(_ value: Any, at path: String) throws {
    let component = try object(value, at: path)
    let type = try string(component["type"], at: "\(path).type")
    switch type {
    case "text", "legalText":
      try exactKeys(component, expected: ["type", "id", "value"], at: path)
      try validateLocalizedText(component["value"], at: "\(path).value")
    case "featureList":
      try exactKeys(component, expected: ["type", "id", "items"], at: path)
      let items = try nonEmptyArray(component["items"], at: "\(path).items")
      for (index, itemValue) in items.enumerated() {
        let itemPath = "\(path).items[\(index)]"
        let item = try object(itemValue, at: itemPath)
        try exactKeys(item, expected: ["id", "text"], at: itemPath)
        try validateLocalizedText(item["text"], at: "\(itemPath).text")
      }
    case "productSelector":
      try exactKeys(
        component,
        expected: ["type", "id", "products", "initiallySelectedProductId"],
        at: path
      )
      let products = try nonEmptyArray(component["products"], at: "\(path).products")
      for (index, productValue) in products.enumerated() {
        let productPath = "\(path).products[\(index)]"
        let product = try object(productValue, at: productPath)
        try exactKeys(product, expected: ["productId"], at: productPath)
      }
    case "purchaseButton", "restoreButton", "closeButton":
      try exactKeys(component, expected: ["type", "id", "label"], at: path)
      try validateLocalizedText(component["label"], at: "\(path).label")
    default:
      throw MosaicProtocolError.invalidShape(
        "Unsupported component \(type) at \(path).type."
      )
    }
  }

  private static func validateLocalizedText(_ value: Any?, at path: String) throws {
    let text = try object(value, at: path)
    try exactKeys(text, expected: ["default", "localizationKey"], at: path)
  }

  private static func object(_ value: Any?, at path: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else {
      throw MosaicProtocolError.invalidShape("Expected an object at \(path).")
    }
    return value
  }

  private static func nonEmptyArray(_ value: Any?, at path: String) throws -> [Any] {
    guard let value = value as? [Any], !value.isEmpty else {
      throw MosaicProtocolError.invalidShape("Expected a non-empty array at \(path).")
    }
    return value
  }

  private static func string(_ value: Any?, at path: String) throws -> String {
    guard let value = value as? String else {
      throw MosaicProtocolError.invalidShape("Expected a string at \(path).")
    }
    return value
  }

  private static func exactKeys(
    _ object: [String: Any],
    expected: Set<String>,
    at path: String
  ) throws {
    let actual = Set(object.keys)
    let missing = expected.subtracting(actual).sorted()
    let unknown = actual.subtracting(expected).sorted()
    guard missing.isEmpty else {
      throw MosaicProtocolError.invalidShape(
        "Missing properties \(missing.joined(separator: ", ")) at \(path)."
      )
    }
    guard unknown.isEmpty else {
      throw MosaicProtocolError.invalidShape(
        "Unknown properties \(unknown.joined(separator: ", ")) at \(path)."
      )
    }
  }
}
