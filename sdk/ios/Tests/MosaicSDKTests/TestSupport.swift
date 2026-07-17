import Foundation
import XCTest

@testable import MosaicSDK

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
