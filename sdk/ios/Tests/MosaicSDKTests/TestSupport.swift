import Foundation
import XCTest

@testable import MosaicSDK

func previewTestIdentity() -> MosaicPreviewClientIdentity {
  MosaicPreviewClientIdentity(
    clientId: "client_ios_tests",
    displayName: "iOS test preview",
    renderer: MosaicPreviewSoftwareIdentity(id: "mosaic.ios", version: "0.1.0"),
    application: MosaicPreviewApplicationIdentity(
      id: "mosaic.ios.tests",
      displayName: "Mosaic iOS Tests",
      version: "0.1.0"
    ),
    device: MosaicPreviewDeviceIdentity(
      displayName: "Test device",
      systemName: "iOS",
      systemVersion: "18.0"
    )
  )
}

func canonicalFixtureURL(filePath: StaticString = #filePath) throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: "\(filePath)").deletingLastPathComponent()

  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("v0.1")
      .appendingPathComponent("complete-paywall.json")
    if fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }
    directory.deleteLastPathComponent()
  }

  throw CanonicalFixtureLookupError.notFound
}

func canonicalFixtureData() throws -> Data {
  try Data(contentsOf: canonicalFixtureURL())
}

func v02FixtureURL(named name: String = "complete-paywall.json") throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()

  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("v0.2")
      .appendingPathComponent(name)
    if fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }
    directory.deleteLastPathComponent()
  }

  throw CanonicalFixtureLookupError.notFound
}

func v02FixtureData(named name: String = "complete-paywall.json") throws -> Data {
  try Data(contentsOf: v02FixtureURL(named: name))
}

func v02Document(named name: String = "complete-paywall.json") throws
  -> MosaicPaywallDocument
{
  try MosaicProtocolDecoder.decode(v02FixtureData(named: name))
}

func localPreviewFlowURL(filePath: StaticString = #filePath) throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: "\(filePath)").deletingLastPathComponent()

  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("local-preview")
      .appendingPathComponent("v0.1")
      .appendingPathComponent("session-flow.messages.json")
    if fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }
    directory.deleteLastPathComponent()
  }

  throw CanonicalFixtureLookupError.notFound
}

func localPreviewFlowObjects() throws -> [[String: Any]] {
  guard
    let values = try JSONSerialization.jsonObject(
      with: Data(contentsOf: localPreviewFlowURL())
    ) as? [[String: Any]]
  else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return values
}

func localPreviewMessageSource(at index: Int) throws -> String {
  let values = try localPreviewFlowObjects()
  guard values.indices.contains(index) else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  let data = try JSONSerialization.data(withJSONObject: values[index], options: [.sortedKeys])
  guard let source = String(data: data, encoding: .utf8) else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return source
}

func canonicalFixtureObject() throws -> [String: Any] {
  guard
    let object = try JSONSerialization.jsonObject(with: canonicalFixtureData())
      as? [String: Any]
  else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return object
}

func encoded(_ object: [String: Any]) throws -> Data {
  try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}

func canonicalFixtureReplacing(_ original: String, with replacement: String) throws -> String {
  let source = try String(contentsOf: canonicalFixtureURL(), encoding: .utf8)
  guard source.contains(original) else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return source.replacingOccurrences(of: original, with: replacement)
}

func mutateFirstNode(
  type: String,
  in object: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) throws {
  guard var layout = object["layout"] as? [String: Any],
    var content = layout["content"] as? [String: Any]
  else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  guard mutateFirstNode(type: type, in: &content, mutation: mutation) else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  layout["content"] = content
  object["layout"] = layout
}

func mutateFirstV02Node(
  type: String,
  in object: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) throws {
  guard var screens = object["screens"] as? [[String: Any]] else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  for index in screens.indices {
    guard var layout = screens[index]["layout"] as? [String: Any],
      var content = layout["content"] as? [String: Any]
    else { continue }
    if mutateFirstV02Node(type: type, in: &content, mutation: mutation) {
      layout["content"] = content
      screens[index]["layout"] = layout
      object["screens"] = screens
      return
    }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

func mutateV02Node(
  id: String,
  in object: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) throws {
  var value: Any = object
  guard mutateV02Node(id: id, in: &value, mutation: mutation),
    let updated = value as? [String: Any]
  else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  object = updated
}

private func mutateV02Node(
  id: String,
  in value: inout Any,
  mutation: (inout [String: Any]) -> Void
) -> Bool {
  if var object = value as? [String: Any] {
    if object["id"] as? String == id {
      mutation(&object)
      value = object
      return true
    }
    for key in object.keys {
      guard var nested = object[key] else { continue }
      if mutateV02Node(id: id, in: &nested, mutation: mutation) {
        object[key] = nested
        value = object
        return true
      }
    }
  } else if var values = value as? [Any] {
    for index in values.indices {
      var nested = values[index]
      if mutateV02Node(id: id, in: &nested, mutation: mutation) {
        values[index] = nested
        value = values
        return true
      }
    }
  }
  return false
}

private func mutateFirstV02Node(
  type: String,
  in stack: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) -> Bool {
  guard var children = stack["children"] as? [[String: Any]] else { return false }
  for index in children.indices {
    if children[index]["type"] as? String == type {
      mutation(&children[index])
      stack["children"] = children
      return true
    }
    let childType = children[index]["type"] as? String
    if childType == "stack" {
      var nested = children[index]
      if mutateFirstV02Node(type: type, in: &nested, mutation: mutation) {
        children[index] = nested
        stack["children"] = children
        return true
      }
    } else if childType == "carousel",
      var pages = children[index]["pages"] as? [[String: Any]]
    {
      for pageIndex in pages.indices {
        guard var content = pages[pageIndex]["content"] as? [String: Any] else { continue }
        if mutateFirstV02Node(type: type, in: &content, mutation: mutation) {
          pages[pageIndex]["content"] = content
          children[index]["pages"] = pages
          stack["children"] = children
          return true
        }
      }
    } else if childType == "button" {
      for key in ["children", "inProgressChildren"] {
        guard var buttonChildren = children[index][key] as? [[String: Any]] else { continue }
        var wrapper: [String: Any] = ["children": buttonChildren]
        if mutateFirstV02Node(type: type, in: &wrapper, mutation: mutation),
          let updated = wrapper["children"] as? [[String: Any]]
        {
          buttonChildren = updated
          children[index][key] = buttonChildren
          stack["children"] = children
          return true
        }
      }
    } else if childType == "productSelector" {
      guard let cards = children[index]["cards"] as? [[String: Any]] else { continue }
      var wrapper: [String: Any] = ["children": cards]
      if mutateFirstV02Node(type: type, in: &wrapper, mutation: mutation),
        let updated = wrapper["children"] as? [[String: Any]]
      {
        children[index]["cards"] = updated
        stack["children"] = children
        return true
      }
    } else if childType == "productCard" || childType == "productBadge" {
      guard let descendants = children[index]["children"] as? [[String: Any]] else { continue }
      var wrapper: [String: Any] = ["children": descendants]
      if mutateFirstV02Node(type: type, in: &wrapper, mutation: mutation),
        let updated = wrapper["children"] as? [[String: Any]]
      {
        children[index]["children"] = updated
        stack["children"] = children
        return true
      }
    }
  }
  return false
}

private func mutateFirstNode(
  type: String,
  in stack: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) -> Bool {
  guard var children = stack["children"] as? [[String: Any]] else { return false }
  for index in children.indices {
    if children[index]["type"] as? String == type {
      mutation(&children[index])
      stack["children"] = children
      return true
    }
    if children[index]["type"] as? String == "verticalStack" {
      var nested = children[index]
      if mutateFirstNode(type: type, in: &nested, mutation: mutation) {
        children[index] = nested
        stack["children"] = children
        return true
      }
    }
  }
  return false
}

func flattenedNodes(_ stack: MosaicVerticalStack) -> [MosaicNode] {
  stack.children.flatMap { node in
    if case .verticalStack(let nested) = node {
      return [node] + flattenedNodes(nested)
    }
    return [node]
  }
}

func canonicalDocument() throws -> MosaicPaywallDocument {
  try MosaicProtocolDecoder.decode(canonicalFixtureData())
}

func purchaseButton(in document: MosaicPaywallDocument) throws -> MosaicPurchaseButtonComponent {
  for node in flattenedNodes(document.layout.content) {
    if case .purchaseButton(let button) = node { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

func restoreButton(in document: MosaicPaywallDocument) throws -> MosaicRestoreButtonComponent {
  for node in flattenedNodes(document.layout.content) {
    if case .restoreButton(let button) = node { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

func closeButton(in document: MosaicPaywallDocument) throws -> MosaicCloseButtonComponent {
  for node in flattenedNodes(document.layout.content) {
    if case .closeButton(let button) = node { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

enum CanonicalFixtureLookupError: Error {
  case invalidShape
  case notFound
}
