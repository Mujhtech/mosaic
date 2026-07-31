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
      .appendingPathComponent("v0.2")
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

func deliveryFixtureURL(named name: String = "valid-release.json") throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("configuration-delivery")
      .appendingPathComponent("v1")
      .appendingPathComponent(name)
    if fileManager.fileExists(atPath: candidate.path) { return candidate }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

func deliveryFixtureData(named name: String = "valid-release.json") throws -> Data {
  try Data(contentsOf: deliveryFixtureURL(named: name))
}

func phase5FixtureData(_ relativePath: String) throws -> Data {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent("protocol/fixtures").appendingPathComponent(
      relativePath)
    if fileManager.fileExists(atPath: candidate.path) { return try Data(contentsOf: candidate) }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

func analyticsFixtureData(_ relativePath: String) throws -> Data {
  try phase5FixtureData("analytics-event/v1/\(relativePath)")
}

/// One canonical bucketing vector from
/// `protocol/fixtures/experiment-assignment/v1/assignment-vectors.json`.
struct CanonicalBucketVector {
  let name: String
  let values: [String]
  let bucket: Int
}

/// The canonical assignment and mutual-exclusion group bucketing vectors.
///
/// Reading them keeps the Swift bucketing implementation bound to the shared
/// protocol contract instead of numbers copied into this test target.
func canonicalBucketVectors() throws -> (
  assignments: [CanonicalBucketVector],
  groups: [CanonicalBucketVector]
) {
  let object = try JSONSerialization.jsonObject(
    with: phase5FixtureData("experiment-assignment/v1/assignment-vectors.json"))
  guard let root = object as? [String: Any] else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  func vectors(_ key: String) throws -> [CanonicalBucketVector] {
    guard let entries = root[key] as? [[String: Any]], !entries.isEmpty else {
      throw CanonicalFixtureLookupError.invalidShape
    }
    return try entries.map { entry in
      guard let name = entry["name"] as? String,
        let values = entry["values"] as? [String],
        let bucket = entry["bucket"] as? Int
      else { throw CanonicalFixtureLookupError.invalidShape }
      return CanonicalBucketVector(name: name, values: values, bucket: bucket)
    }
  }
  return (try vectors("assignmentVectors"), try vectors("groupVectors"))
}

/// The shared cross-SDK billing reference vectors.
///
/// Reading them keeps the Swift reference handling bound to the same values
/// Flutter, Android, and the backend assert against, instead of numbers copied
/// into this test target.
func billingReferenceVectors() throws -> [String: Any] {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent(
      "packages/test-fixtures/src/billing-reference-vectors.json")
    if fileManager.fileExists(atPath: candidate.path) {
      guard
        let root = try JSONSerialization.jsonObject(with: Data(contentsOf: candidate))
          as? [String: Any]
      else { throw CanonicalFixtureLookupError.invalidShape }
      return root
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

/// One shared cross-implementation reference-vector file from
/// `packages/test-fixtures/src/`.
///
/// Reading the file the backend, Flutter, and Android also read is the only way
/// the four implementations can be shown to agree; copying the values into this
/// target would let Swift drift silently.
func entitlementReferenceVectors(_ name: String) throws -> [String: Any] {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent(
      "packages/test-fixtures/src/\(name)")
    if fileManager.fileExists(atPath: candidate.path) {
      guard
        let root = try JSONSerialization.jsonObject(with: Data(contentsOf: candidate))
          as? [String: Any]
      else { throw CanonicalFixtureLookupError.invalidShape }
      return root
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

func entitlementVectorList(_ file: String) throws -> [[String: Any]] {
  guard let vectors = try entitlementReferenceVectors(file)["vectors"] as? [[String: Any]],
    !vectors.isEmpty
  else { throw CanonicalFixtureLookupError.invalidShape }
  return vectors
}

/// One canonical Authoritative Entitlement v1 fixture.
func authoritativeEntitlementFixtureData(_ relativePath: String) throws -> Data {
  try phase5FixtureData("authoritative-entitlement/v1/\(relativePath)")
}

func authoritativeEntitlementV2FixtureData(_ relativePath: String) throws -> Data {
  try phase5FixtureData("authoritative-entitlement/v2/\(relativePath)")
}

/// Builds an iOS-local v2 wrapper around a contract-valid v1 snapshot. The
/// canonical authority digest is recomputed so transition tests exercise epoch
/// ordering rather than corruption handling.
func authoritativeEntitlementV2SnapshotVariant(
  authorityEpoch: Int64,
  authorityKind: MosaicCustomerAccessAuthorityKind,
  transitionState: MosaicCustomerAccessTransitionState,
  snapshotVersion: Int64,
  applicationID: String = "fixture-application-ios",
  minimumAppVersion: String = "4.0.0"
) throws -> Data {
  guard
    let v1Root = try JSONSerialization.jsonObject(
      with: authoritativeEntitlementFixtureData("snapshots/active-subscription.json"))
      as? [String: Any],
    var snapshot = v1Root["payload"] as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }
  snapshot["snapshotVersion"] = snapshotVersion
  if snapshotVersion == 0 {
    snapshot.removeValue(forKey: "previousSnapshotVersion")
  } else {
    snapshot["previousSnapshotVersion"] = max(0, snapshotVersion - 1)
  }
  var snapshotDigestInput = snapshot
  snapshotDigestInput.removeValue(forKey: "contentDigest")
  snapshot["contentDigest"] = try MosaicCustomerCanonicalJSON.digest(snapshotDigestInput)

  var authority: [String: Any] = [
    "authorityEpoch": authorityEpoch,
    "authorityKind": authorityKind.rawValue,
    "scope": [
      "projectId": "fixture-project-mosaic",
      "environmentId": "fixture-environment-production",
      "applicationId": applicationID,
      "platform": "ios",
    ],
    "transitionState": transitionState.rawValue,
  ]
  if authorityKind != .source {
    authority["cutoverAt"] = "2026-07-29T10:00:00.000Z"
  }
  let authorityDigest = try MosaicCustomerCanonicalJSON.digest([
    "authority": authority,
    "snapshot": snapshot,
  ])
  return try MosaicCustomerCanonicalJSON.data([
    "authoritativeEntitlementContractVersion": "2",
    "recordType": "customerEntitlementSnapshot",
    "payload": [
      "authority": authority,
      "snapshot": snapshot,
      "snapshotAuthorityDigest": authorityDigest,
      "minimumSupport": [
        "minimumContractVersion": "2",
        "minimumSdkVersion": "2.0.0",
        "supportedAppVersionWindow": ["minimumInclusive": minimumAppVersion],
        "requiredCapabilities": [
          "authority_epoch", "authority_scope", "urgent_authority_sync",
          "mosaic_authoritative_targeting",
        ],
      ],
    ],
  ])
}

func authoritativeEntitlementFixtureNames(in subdirectory: String) throws -> [String] {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent(
      "protocol/fixtures/authoritative-entitlement/v1/\(subdirectory)")
    if fileManager.fileExists(atPath: candidate.path) {
      return try fileManager.contentsOfDirectory(atPath: candidate.path)
        .filter { $0.hasSuffix(".json") }
        .sorted()
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

/// Builds an iOS-local, contract-valid snapshot variant without adding or
/// modifying a canonical shared fixture. The content digest is recomputed after
/// the mutation so sync tests exercise the acceptance gate rather than the
/// corruption path.
func authoritativeEntitlementSnapshotVariant(
  _ fixtureName: String = "active-subscription.json",
  mutation: (inout [String: Any]) -> Void
) throws -> Data {
  guard
    var root = try JSONSerialization.jsonObject(
      with: authoritativeEntitlementFixtureData("snapshots/\(fixtureName)")) as? [String: Any],
    var payload = root["payload"] as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }

  mutation(&payload)
  var digestInput = payload
  digestInput.removeValue(forKey: "contentDigest")
  payload["contentDigest"] = try MosaicCustomerCanonicalJSON.digest(digestInput)
  root["payload"] = payload
  return try MosaicCustomerCanonicalJSON.data(root)
}

func neverProjectedEntitlementPlaceholderData() throws -> Data {
  try authoritativeEntitlementSnapshotVariant { payload in
    payload["snapshotId"] = "pending.fixture-customer-0001"
    payload["snapshotVersion"] = 0
    payload.removeValue(forKey: "previousSnapshotVersion")
    payload["entries"] = []
    payload["sources"] = []
    payload["projectionStatus"] = [
      "state": "pending",
      "lastProjectedAt": "2026-07-28T11:00:00.000Z",
      "pendingFactCount": 0,
    ]
    payload["changeReason"] = "initial_projection"
    payload["entityTag"] = "pending-cs-0001-v0"
  }
}

/// Parses a contract timestamp in a test without going through the decoder
/// under test.
func contractTimestamp(_ value: String) throws -> Date {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  guard let date = formatter.date(from: value) else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return date
}

func commerceConfigurationFixtureData(
  named name: String = "revenuecat-configuration.json"
) throws -> Data {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("commerce-configuration")
      .appendingPathComponent("v1")
      .appendingPathComponent(name)
    if fileManager.fileExists(atPath: candidate.path) {
      return try Data(contentsOf: candidate)
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

func commerceConfigurationV2FixtureData(
  named name: String = "storekit-configuration.json"
) throws -> Data {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("commerce-configuration")
      .appendingPathComponent("v2")
      .appendingPathComponent(name)
    if fileManager.fileExists(atPath: candidate.path) {
      return try Data(contentsOf: candidate)
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
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
      .appendingPathComponent("v0.2")
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
  if object["screens"] != nil {
    let mutateV02: (String, inout [String: Any], (inout [String: Any]) -> Void) throws -> Void =
      mutateFirstV02Node
    try mutateV02(type, &object, mutation)
    return
  }
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
    switch node {
    case .verticalStack(let nested), .stack(let nested):
      return [node] + flattenedNodes(nested)
    default:
      return [node]
    }
  }
}

func canonicalDocument() throws -> MosaicPaywallDocument {
  try MosaicProtocolDecoder.decode(canonicalFixtureData())
}

func purchaseButton(in document: MosaicPaywallDocument) throws -> MosaicButtonComponent {
  for node in document.allNodes {
    if case .button(let button) = node, button.action.type == .purchase { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

func restoreButton(in document: MosaicPaywallDocument) throws -> MosaicButtonComponent {
  for node in document.allNodes {
    if case .button(let button) = node, button.action.type == .restore { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

func closeButton(in document: MosaicPaywallDocument) throws -> MosaicButtonComponent {
  for node in document.allNodes {
    if case .button(let button) = node, button.action.type == .close { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

enum CanonicalFixtureLookupError: Error {
  case invalidShape
  case notFound
}
