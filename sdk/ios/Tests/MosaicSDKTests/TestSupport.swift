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
      .appendingPathComponent("v0.4")
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

func v04FixtureURL(named name: String = "complete-paywall.json") throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()

  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("v0.4")
      .appendingPathComponent(name)
    if fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }
    directory.deleteLastPathComponent()
  }

  throw CanonicalFixtureLookupError.notFound
}

func v04FixtureData(named name: String = "complete-paywall.json") throws -> Data {
  try Data(contentsOf: v04FixtureURL(named: name))
}

func v04Document(named name: String = "complete-paywall.json") throws -> MosaicPaywallDocument {
  try MosaicProtocolDecoder.decode(v04FixtureData(named: name))
}

func v04FixtureNames(in subdirectory: String) throws -> [String] {
  let directory = try v04FixtureURL(named: "complete-paywall.json")
    .deletingLastPathComponent()
    .appendingPathComponent(subdirectory)
  return try FileManager.default.contentsOfDirectory(atPath: directory.path)
    .filter { $0.hasSuffix(".json") }
    .sorted()
}

/// One canonical Configuration Delivery fixture. `rich-release.json` is the
/// ordinary single-paywall release.
func deliveryFixtureURL(named name: String = "rich-release.json") throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("configuration-delivery")
      .appendingPathComponent("v3")
      .appendingPathComponent(name)
    if fileManager.fileExists(atPath: candidate.path) { return candidate }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

/// The canonical Configuration Delivery fixture names in one corpus directory.
func deliveryFixtureNames(in subdirectory: String) throws -> [String] {
  let directory = try deliveryFixtureURL()
    .deletingLastPathComponent()
    .appendingPathComponent(subdirectory)
  return try FileManager.default.contentsOfDirectory(atPath: directory.path)
    .filter { $0.hasSuffix(".json") }
    .sorted()
}

func deliveryFixtureData(named name: String = "rich-release.json") throws -> Data {
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
  try phase5FixtureData("analytics-event/v2/\(relativePath)")
}

/// The canonical Analytics Event fixture names in one corpus directory.
func analyticsFixtureNames(in subdirectory: String) throws -> [String] {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent(
      "protocol/fixtures/analytics-event/v2/\(subdirectory)")
    if fileManager.fileExists(atPath: candidate.path) {
      return try fileManager.contentsOfDirectory(atPath: candidate.path)
        .filter { $0.hasSuffix(".json") }
        .sorted()
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
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

/// One canonical Authoritative Entitlement fixture. The contract carries a
/// single version (ADR-0028), so there is one accessor.
func authoritativeEntitlementFixtureData(_ relativePath: String) throws -> Data {
  try phase5FixtureData("authoritative-entitlement/v2/\(relativePath)")
}

/// One canonical Authoritative Entitlement snapshot record, by scenario name.
///
/// Most scenarios live under `snapshots/`. The two that are not scenario
/// variants sit at the corpus root: `ios-full-snapshot.json` is the ordinary
/// active-subscription snapshot and `snapshot-unchanged.json` is the unchanged
/// confirmation. Mapping them here keeps every suite naming the scenario rather
/// than the file layout.
func entitlementSnapshotData(_ name: String) throws -> Data {
  switch name {
  case "active-subscription.json":
    try authoritativeEntitlementFixtureData("ios-full-snapshot.json")
  case "snapshot-unchanged.json":
    try authoritativeEntitlementFixtureData("snapshot-unchanged.json")
  default:
    try authoritativeEntitlementFixtureData("snapshots/\(name)")
  }
}

/// Mutates the body of a canonical entitlement record without recomputing any
/// digest.
///
/// The body is `payload.snapshot` on a snapshot record and `payload.unchanged`
/// on a confirmation. Digests are deliberately left stale: callers use this to
/// prove either that a mutation is rejected outright or that the content digest
/// notices it. A variant that must be *accepted* goes through
/// `authoritativeEntitlementSnapshotVariant`, which recomputes both digests.
func mutatedEntitlementRecord(
  _ name: String,
  _ mutation: (inout [String: Any]) -> Void
) throws -> Data {
  guard
    var root = try JSONSerialization.jsonObject(with: try entitlementSnapshotData(name))
      as? [String: Any],
    var payload = root["payload"] as? [String: Any],
    let bodyKey = ["snapshot", "unchanged"].first(where: { payload[$0] is [String: Any] }),
    var body = payload[bodyKey] as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }
  mutation(&body)
  payload[bodyKey] = body
  root["payload"] = payload
  return try JSONSerialization.data(withJSONObject: root)
}

/// One body of a canonical entitlement record: `snapshot` on a snapshot record,
/// `unchanged` on a confirmation.
func authoritativeEntitlementRecordBody(_ name: String, key: String) throws -> [String: Any] {
  guard
    let root = try JSONSerialization.jsonObject(with: entitlementSnapshotData(name))
      as? [String: Any],
    let payload = root["payload"] as? [String: Any],
    let body = payload[key] as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }
  return body
}

/// The `snapshot` a v2 record wraps.
///
/// v2 nests what used to be the whole payload under `payload.snapshot`, beside
/// `authority`, `snapshotAuthorityDigest`, and `minimumSupport`. Tests that
/// assert on snapshot fields go through here so the extra hop is stated once.
func authoritativeEntitlementSnapshot(_ relativePath: String) throws -> [String: Any] {
  guard
    let root = try JSONSerialization.jsonObject(
      with: entitlementSnapshotData(relativePath)) as? [String: Any],
    let payload = root["payload"] as? [String: Any],
    let snapshot = payload["snapshot"] as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }
  return snapshot
}

/// Builds an iOS-local authority wrapper around the canonical active-subscription
/// snapshot. The canonical authority digest is recomputed so transition tests
/// exercise epoch ordering rather than corruption handling.
func authoritativeEntitlementAuthoritySnapshotVariant(
  authorityEpoch: Int64,
  authorityKind: MosaicCustomerAccessAuthorityKind,
  transitionState: MosaicCustomerAccessTransitionState,
  snapshotVersion: Int64,
  applicationID: String = "fixture-application-ios",
  minimumAppVersion: String = "4.0.0"
) throws -> Data {
  var snapshot = try authoritativeEntitlementSnapshot("active-subscription.json")
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
      "protocol/fixtures/authoritative-entitlement/v2/\(subdirectory)")
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
/// modifying a canonical shared fixture.
///
/// The mutation applies to the inner `payload.snapshot`. Both digests are
/// recomputed afterwards — the snapshot's own `contentDigest` and the
/// `snapshotAuthorityDigest` over `{authority, snapshot}` — so sync tests
/// exercise the acceptance gate rather than the corruption path.
func authoritativeEntitlementSnapshotVariant(
  _ fixtureName: String = "active-subscription.json",
  mutation: (inout [String: Any]) -> Void
) throws -> Data {
  guard
    var root = try JSONSerialization.jsonObject(
      with: entitlementSnapshotData(fixtureName)) as? [String: Any],
    var payload = root["payload"] as? [String: Any],
    var snapshot = payload["snapshot"] as? [String: Any],
    let authority = payload["authority"]
  else { throw CanonicalFixtureLookupError.invalidShape }

  mutation(&snapshot)
  var digestInput = snapshot
  digestInput.removeValue(forKey: "contentDigest")
  snapshot["contentDigest"] = try MosaicCustomerCanonicalJSON.digest(digestInput)
  payload["snapshot"] = snapshot
  payload["snapshotAuthorityDigest"] = try MosaicCustomerCanonicalJSON.digest([
    "authority": authority, "snapshot": snapshot,
  ])
  root["payload"] = payload
  return try MosaicCustomerCanonicalJSON.data(root)
}

/// The never-projected placeholder for the canonical customer: `snapshotVersion`
/// 0, no entries, no sources, projection pending.
///
/// Synthesized rather than read from `source-snapshot.json`, which is the
/// corpus's *source-authority* scenario and belongs to a different customer.
/// Tests that replace the placeholder with version one need both records to
/// describe the same customer, or the replacement is a binding mismatch rather
/// than the monotonic replacement being exercised.
func neverProjectedEntitlementPlaceholderData() throws -> Data {
  try authoritativeEntitlementSnapshotVariant { snapshot in
    snapshot["snapshotId"] = "pending.fixture-customer-0001"
    snapshot["snapshotVersion"] = 0
    snapshot.removeValue(forKey: "previousSnapshotVersion")
    snapshot["entries"] = []
    snapshot["sources"] = []
    snapshot["projectionStatus"] = [
      "state": "pending",
      "lastProjectedAt": "2026-07-28T11:00:00.000Z",
      "pendingFactCount": 0,
    ]
    snapshot["changeReason"] = "initial_projection"
    snapshot["entityTag"] = "pending-cs-0001-v0"
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

/// One canonical Commerce Configuration fixture. `storekit-configuration.json`
/// is the iOS-relevant one and supersedes the retired RevenueCat fixture.
func commerceConfigurationFixtureData(
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
      .appendingPathComponent("v0.4")
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

/// Mutates the first node of a type in a document.
///
/// Every document declares `screens`; the retired top-level `layout` shape an
/// earlier contract also accepted no longer exists.
func mutateFirstNode(
  type: String,
  in object: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) throws {
  // Disambiguates from the private same-named stack walker below.
  let mutate: (String, inout [String: Any], (inout [String: Any]) -> Void) throws -> Void =
    mutateFirstNodeOfType
  try mutate(type, &object, mutation)
}

func mutateFirstNodeOfType(
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
    if mutateFirstNodeOfType(type: type, in: &content, mutation: mutation) {
      layout["content"] = content
      screens[index]["layout"] = layout
      object["screens"] = screens
      return
    }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

func mutateNode(
  id: String,
  in object: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) throws {
  var value: Any = object
  guard mutateNode(id: id, in: &value, mutation: mutation),
    let updated = value as? [String: Any]
  else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  object = updated
}

private func mutateNode(
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
      if mutateNode(id: id, in: &nested, mutation: mutation) {
        object[key] = nested
        value = object
        return true
      }
    }
  } else if var values = value as? [Any] {
    for index in values.indices {
      var nested = values[index]
      if mutateNode(id: id, in: &nested, mutation: mutation) {
        values[index] = nested
        value = values
        return true
      }
    }
  }
  return false
}

private func mutateFirstNodeOfType(
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
      if mutateFirstNodeOfType(type: type, in: &nested, mutation: mutation) {
        children[index] = nested
        stack["children"] = children
        return true
      }
    } else if childType == "carousel",
      var pages = children[index]["pages"] as? [[String: Any]]
    {
      for pageIndex in pages.indices {
        guard var content = pages[pageIndex]["content"] as? [String: Any] else { continue }
        if mutateFirstNodeOfType(type: type, in: &content, mutation: mutation) {
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
        if mutateFirstNodeOfType(type: type, in: &wrapper, mutation: mutation),
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
      if mutateFirstNodeOfType(type: type, in: &wrapper, mutation: mutation),
        let updated = wrapper["children"] as? [[String: Any]]
      {
        children[index]["cards"] = updated
        stack["children"] = children
        return true
      }
    } else if childType == "productCard" || childType == "productBadge" {
      guard let descendants = children[index]["children"] as? [[String: Any]] else { continue }
      var wrapper: [String: Any] = ["children": descendants]
      if mutateFirstNodeOfType(type: type, in: &wrapper, mutation: mutation),
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


func flattenedNodes(_ stack: MosaicStack) -> [MosaicNode] {
  stack.children.flatMap { node in
    switch node {
    case .stack(let nested):
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
